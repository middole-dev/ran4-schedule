#!/usr/bin/env python3
"""Fetch the newest RAN4 schedule from the public 3GPP history folder."""

from __future__ import annotations

import argparse
import datetime as dt
import html.parser
import json
import re
import sys
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from io import BytesIO
from pathlib import Path

HISTORY_URL = (
    "https://www.3gpp.org/FTP/tsg_ran/WG4_Radio/TSGR4_120bis/"
    "Inbox/Meeting_Arrangements/History/"
)
USER_AGENT = "RAN4-Schedule-Updater/1.0 (+https://github.com/middole-dev/ran4-schedule)"
NS = {
    "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
}
DAY_NAMES = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday")


class DirectoryListingParser(html.parser.HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[dict[str, object]] = []
        self._row: dict[str, object] | None = None
        self._cell_parts: list[str] | None = None
        self._anchor: dict[str, str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = dict(attrs)
        if tag == "tr":
            self._row = {"cells": [], "files": []}
        elif tag == "td" and self._row is not None:
            self._cell_parts = []
        elif tag == "a" and self._row is not None and "href" in attributes:
            self._anchor = {"href": attributes["href"] or "", "text": ""}

    def handle_data(self, data: str) -> None:
        if self._cell_parts is not None:
            self._cell_parts.append(data)
        if self._anchor is not None:
            self._anchor["text"] += data

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._anchor is not None:
            if self._row is not None:
                files = self._row["files"]
                assert isinstance(files, list)
                files.append(self._anchor.copy())
            self._anchor = None
        elif tag == "td" and self._cell_parts is not None:
            if self._row is not None:
                cells = self._row["cells"]
                assert isinstance(cells, list)
                cells.append(" ".join(" ".join(self._cell_parts).split()))
            self._cell_parts = None
        elif tag == "tr" and self._row is not None:
            self.rows.append(self._row)
            self._row = None


def natural_key(value: str) -> list[object]:
    return [int(part) if part.isdigit() else part.casefold() for part in re.split(r"(\d+)", value)]


def parse_listing(content: str, base_url: str = HISTORY_URL) -> list[dict[str, object]]:
    parser = DirectoryListingParser()
    parser.feed(content)
    schedules: list[dict[str, object]] = []
    schedule_pattern = re.compile(r"^RAN4_.*meeting_schedule.*\.pptx$", re.IGNORECASE)
    for row in parser.rows:
        cells = row["cells"]
        files = row["files"]
        assert isinstance(cells, list) and isinstance(files, list)
        timestamp = next(
            (match.group(0) for cell in cells if (match := re.search(r"\d{4}/\d{2}/\d{2}\s+\d{1,2}:\d{2}", cell))),
            None,
        )
        for item in files:
            href = urllib.parse.urljoin(base_url, item["href"])
            name = urllib.parse.unquote(urllib.parse.urlparse(href).path.rsplit("/", 1)[-1])
            if schedule_pattern.fullmatch(name) and timestamp:
                modified = dt.datetime.strptime(timestamp, "%Y/%m/%d %H:%M")
                schedules.append({
                    "name": name,
                    "url": href,
                    "modified": modified,
                    "modifiedText": timestamp,
                })
    if not schedules:
        raise ValueError("No RAN4 meeting schedule PowerPoint files found in the 3GPP history listing.")
    return schedules


def select_latest(schedules: list[dict[str, object]]) -> dict[str, object]:
    return max(schedules, key=lambda item: (item["modified"], natural_key(str(item["name"]))))


def _shape_paragraphs(shape: ET.Element) -> list[str]:
    body = shape.find("p:txBody", NS)
    if body is None:
        return []
    return [
        "".join(text.text or "" for text in paragraph.findall(".//a:t", NS)).strip()
        for paragraph in body.findall("a:p", NS)
    ]


def _cell_text(cell: ET.Element) -> str:
    paragraphs = [
        "".join(text.text or "" for text in paragraph.findall(".//a:t", NS)).strip()
        for paragraph in cell.findall(".//a:p", NS)
    ]
    return "\n".join(text for text in paragraphs if text)


def parse_pptx(data: bytes, filename: str, source_modified_at: str) -> dict[str, object]:
    with zipfile.ZipFile(BytesIO(data)) as archive:
        slide_names = sorted(
            (name for name in archive.namelist() if re.fullmatch(r"ppt/slides/slide\d+\.xml", name)),
            key=lambda name: int(re.search(r"slide(\d+)", name).group(1)),  # type: ignore[union-attr]
        )
        if not slide_names:
            raise ValueError("No slides were found in the schedule PowerPoint.")

        slides: list[dict[str, object]] = []
        title_text: list[str] = []
        for index, slide_name in enumerate(slide_names):
            root = ET.fromstring(archive.read(slide_name))
            shape_text = [
                "\n".join(paragraph for paragraph in _shape_paragraphs(shape) if paragraph)
                for shape in root.findall(".//p:sp", NS)
            ]
            if index == 0:
                title_text = shape_text
                continue
            day = next((name for name in DAY_NAMES if name in shape_text), None)
            table = root.find(".//a:tbl", NS)
            if day is None or table is None:
                continue
            rows = table.findall("a:tr", NS)
            if len(rows) < 2:
                continue
            headers = [_cell_text(cell).strip() for cell in rows[0].findall("a:tc", NS)][1:]
            if not headers:
                continue
            slots = []
            for row in rows[1:]:
                values = [_cell_text(cell) for cell in row.findall("a:tc", NS)]
                if not values or not values[0].strip():
                    continue
                slots.append({
                    "time": re.sub(r"\s+", " ", values[0]).strip(),
                    "sessions": [
                        values[position + 1].strip() if position + 1 < len(values) else ""
                        for position in range(len(headers))
                    ],
                })
            slides.append({"day": day, "rooms": headers, "slots": slots})

    all_title_text = " ".join(title_text)
    date_match = re.search(
        r"\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*[-–]\s*(\d{1,2}),?\s+(\d{4})\b",
        all_title_text,
    )
    dates: dict[str, str] = {}
    if date_match:
        month = dt.datetime.strptime(date_match.group(1)[:3], "%b").month
        dates = {
            "start": f"{date_match.group(4)}-{month:02d}-{int(date_match.group(2)):02d}",
            "end": f"{date_match.group(4)}-{month:02d}-{int(date_match.group(3)):02d}",
        }
    meeting_match = re.search(r"RAN4#\s*[\w-]+", all_title_text, re.IGNORECASE)
    location_match = re.search(r"\b(Jeju,\s*South Korea)\b", all_title_text, re.IGNORECASE)
    if not slides:
        raise ValueError("No weekday schedule tables were found in the PowerPoint.")
    if len(slides) != len(DAY_NAMES):
        raise ValueError(f"Expected {len(DAY_NAMES)} weekday schedules; found {len(slides)}.")
    for day in slides:
        if any(len(slot["sessions"]) != len(day["rooms"]) for slot in day["slots"]):
            raise ValueError(f"Room/session counts do not match for {day['day']}.")

    return {
        "meeting": meeting_match.group(0).replace(" ", "") if meeting_match else "RAN4",
        "location": location_match.group(0) if location_match else "",
        "dates": dates,
        "timezone": "Asia/Seoul",
        "source": filename,
        "sourceUrl": urllib.parse.urljoin(HISTORY_URL, urllib.parse.quote(filename)),
        "sourceModifiedAt": source_modified_at,
        "updatedAt": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "days": slides,
    }


def fetch(url: str) -> bytes:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": USER_AGENT, "Referer": "https://www.3gpp.org/"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def update_schedule(output: Path, history_url: str = HISTORY_URL) -> tuple[bool, dict[str, object]]:
    listing = fetch(history_url).decode("utf-8", errors="replace")
    latest = select_latest(parse_listing(listing, history_url))
    data = fetch(str(latest["url"]))
    schedule = parse_pptx(data, str(latest["name"]), str(latest["modifiedText"]))
    serialized = json.dumps(schedule, ensure_ascii=False, indent=2) + "\n"
    existing = output.read_text(encoding="utf-8") if output.exists() else ""
    try:
        existing_data = json.loads(existing)
    except json.JSONDecodeError:
        existing_data = None
    comparable = dict(schedule)
    comparable["updatedAt"] = ""
    previous_comparable = dict(existing_data) if isinstance(existing_data, dict) else {}
    previous_comparable["updatedAt"] = ""
    changed = comparable != previous_comparable
    if changed:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(serialized, encoding="utf-8", newline="\n")
    return changed, schedule


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("schedule.json"))
    parser.add_argument("--history-url", default=HISTORY_URL)
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()
    try:
        changed, schedule = update_schedule(args.output, args.history_url)
    except (OSError, ValueError, zipfile.BadZipFile, ET.ParseError) as error:
        print(f"Schedule update failed: {error}", file=sys.stderr)
        return 1
    print(
        f"{'Updated' if changed else 'Unchanged'} schedule from "
        f"{schedule['source']} (3GPP modified: {schedule['sourceModifiedAt']})."
    )
    if args.github_output:
        with args.github_output.open("a", encoding="utf-8", newline="\n") as output:
            output.write(f"changed={'true' if changed else 'false'}\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
