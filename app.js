const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const STORAGE_KEYS = {
  config: "ran4.schedule.config",
  schedule: "ran4.schedule.data",
  interests: "ran4.schedule.interests",
  favorites: "ran4.schedule.favorites",
  notified: "ran4.schedule.notified"
};
const DEFAULT_CONFIG = {
  meetingFolderUrl: "",
  finalFolderUrl: "",
  resultsFolderUrl: "",
  pollSeconds: 60,
  leadMinutes: 10,
  notificationsEnabled: false
};
const NS = {
  drawing: "http://schemas.openxmlformats.org/drawingml/2006/main",
  presentation: "http://schemas.openxmlformats.org/presentationml/2006/main"
};

const state = {
  schedule: null,
  scheduleHash: "",
  config: loadJson(STORAGE_KEYS.config, DEFAULT_CONFIG),
  interests: loadJson(STORAGE_KEYS.interests, []),
  favorites: loadJson(STORAGE_KEYS.favorites, []),
  selectedDay: 0,
  selectedAgenda: null,
  changedSlots: new Set(),
  pollTimer: null,
  alertTimer: null,
  polling: false
};

const ui = {
  title: document.querySelector("#meeting-title"),
  subtitle: document.querySelector("#meeting-subtitle"),
  sourceMode: document.querySelector("#source-mode"),
  lastUpdated: document.querySelector("#last-updated"),
  status: document.querySelector("#status"),
  dayTabs: document.querySelector("#day-tabs"),
  schedule: document.querySelector("#schedule"),
  search: document.querySelector("#search"),
  tags: document.querySelector("#interest-tags"),
  interestInput: document.querySelector("#interest-input"),
  leadTime: document.querySelector("#lead-time"),
  notificationButton: document.querySelector("#notifications-enable"),
  notificationHelp: document.querySelector("#notification-help"),
  settings: document.querySelector("#settings-dialog"),
  meetingFolder: document.querySelector("#meeting-folder"),
  finalFolder: document.querySelector("#final-folder"),
  resultsFolder: document.querySelector("#results-folder"),
  resultsDialog: document.querySelector("#results-dialog"),
  resultsAgenda: document.querySelector("#results-agenda"),
  resultsDocument: document.querySelector("#results-document"),
  resultsStatus: document.querySelector("#results-status"),
  resultsContent: document.querySelector("#results-content"),
  pollInterval: document.querySelector("#poll-interval")
};

function loadJson(key, fallback) {
  try {
    const stored = localStorage.getItem(key);
    if (!stored) return Array.isArray(fallback) ? [] : { ...fallback };
    const value = JSON.parse(stored);
    if (Array.isArray(fallback)) return Array.isArray(value) ? value : [];
    return value && typeof value === "object" && !Array.isArray(value)
      ? { ...fallback, ...value }
      : { ...fallback };
  } catch (error) {
    console.error(`Could not read ${key} from local storage.`, error);
    return Array.isArray(fallback) ? [] : { ...fallback };
  }
}

function saveJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    setStatus(`Could not save settings: ${error.message}`, true);
  }
}

function setStatus(message, isError = false) {
  ui.status.textContent = message;
  ui.status.classList.toggle("error", isError);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

function translateScheduleLabels(schedule) {
  for (const day of schedule.days || []) {
    for (const slot of day.slots || []) {
      slot.sessions = slot.sessions.map((text) => text
        .replaceAll("\uCEE4\uD53C \uD0C0\uC784", "Coffee Break")
        .replaceAll("\uC810\uC2EC\uC2DC\uAC04", "Lunch Break"));
    }
  }
  return schedule;
}

function getTodayInSeoul() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function isMeetingDay(date = getTodayInSeoul()) {
  return Boolean(state.schedule?.dates?.start && state.schedule?.dates?.end
    && date >= state.schedule.dates.start && date <= state.schedule.dates.end);
}

function getFolderUrl() {
  return isMeetingDay() ? state.config.meetingFolderUrl : state.config.finalFolderUrl;
}

function getDayIndexForToday() {
  if (!isMeetingDay()) return 0;
  const start = new Date(`${state.schedule.dates.start}T00:00:00+09:00`);
  const today = new Date(`${getTodayInSeoul()}T00:00:00+09:00`);
  return Math.min(DAY_NAMES.length - 1, Math.max(0, Math.floor((today - start) / 86400000)));
}

function getMeetingDate(dayIndex) {
  if (!state.schedule?.dates?.start) return "";
  const start = new Date(`${state.schedule.dates.start}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() + dayIndex);
  return start.toISOString().slice(0, 10);
}

function isSlotCompleted(dayIndex, time) {
  const range = parseTimeRange(time);
  if (!range) return false;
  const date = getMeetingDate(dayIndex);
  if (!date) return false;
  const today = getTodayInSeoul();
  if (date < today) return true;
  if (date > today) return false;
  return currentMeetingMinute() >= range.endMinutes + 20;
}

function formatUpdatedAt(value) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function renderHeader() {
  if (!state.schedule) return;
  ui.title.textContent = `${state.schedule.meeting || "RAN4"} Schedule`;
  ui.subtitle.textContent = [
    state.schedule.location,
    state.schedule.dates?.start && state.schedule.dates?.end
      ? `${state.schedule.dates.start} – ${state.schedule.dates.end}`
      : ""
  ].filter(Boolean).join(" · ");
  ui.lastUpdated.textContent = `Last updated ${formatUpdatedAt(state.schedule.updatedAt)}`;
  ui.sourceMode.textContent = isMeetingDay() ? "MEETING WEEK" : "LATEST SCHEDULE";
}

function renderDayTabs() {
  ui.dayTabs.innerHTML = DAY_LABELS.map((label, index) => `
    <button class="day-tab" type="button" role="tab" id="day-tab-${index}"
      aria-selected="${index === state.selectedDay}" aria-controls="schedule"
      data-day-index="${index}">${label}</button>
  `).join("");
  ui.dayTabs.querySelectorAll("[data-day-index]").forEach((button) => {
    button.addEventListener("click", () => {
      state.selectedDay = Number(button.dataset.dayIndex);
      renderDayTabs();
      renderSchedule();
    });
  });
}

function parseTimeRange(value) {
  const match = value.match(/(\d{1,2}):(\d{2})\s*[-–]\s*(?:(\d{1,2}):(\d{2})|(EOM))/i);
  if (!match) return null;
  return {
    startMinutes: Number(match[1]) * 60 + Number(match[2]),
    endMinutes: match[5] ? 24 * 60 : Number(match[3]) * 60 + Number(match[4])
  };
}

function slotMatchesSearch(slot, search) {
  if (!search) return true;
  return slot.sessions.some((session) => session.toLocaleLowerCase().includes(search));
}

function sessionKey(day, time, room) {
  return `${day}|${time}|${room}`;
}

function sessionHasInterest(text, key) {
  const value = text.toLocaleLowerCase();
  return state.favorites.includes(key)
    || state.interests.some((term) => value.includes(term.toLocaleLowerCase()));
}

function renderSchedule() {
  if (!state.schedule) return;
  const day = state.schedule.days?.find((item) => item.day === DAY_NAMES[state.selectedDay])
    || state.schedule.days?.[state.selectedDay];
  if (!day) {
    ui.schedule.innerHTML = '<p class="empty-message">No schedule is available for this day.</p>';
    return;
  }
  const search = ui.search.value.trim().toLocaleLowerCase();
  const matchingSlots = day.slots.filter((slot) => slotMatchesSearch(slot, search));
  if (!matchingSlots.length) {
    ui.schedule.innerHTML = '<p class="empty-message">No matching sessions found.</p>';
    return;
  }
  const rooms = day.rooms;
  const dayIndex = state.schedule.days.indexOf(day);
  ui.schedule.style.setProperty("--room-count", rooms.length);
  const heading = `<div class="schedule-heading"><div>TIME</div>${rooms.map((room) =>
    `<div>${escapeHtml(room)}</div>`).join("")}</div>`;
  const rows = matchingSlots.map((slot) => {
    const range = parseTimeRange(slot.time);
    const currentMinute = currentMeetingMinute();
    const isCurrent = isMeetingDay() && range && currentMinute >= range.startMinutes && currentMinute < range.endMinutes;
    const cells = rooms.map((room, index) => {
      const text = slot.sessions[index] || "";
      if (!text.trim()) return '<div class="empty-cell"></div>';
      const key = sessionKey(day.day, slot.time, room);
      const favorite = state.favorites.includes(key);
      const interested = sessionHasInterest(text, key);
      const changed = state.changedSlots.has(key);
      const completed = isSlotCompleted(dayIndex, slot.time);
      const agendaContent = completed
        ? `<button class="session-open" type="button" data-open-agenda="${escapeHtml(key)}"><span>${escapeHtml(text)}</span><span class="completed-badge">Completed · View results</span></button>`
        : `<p class="session-text">${escapeHtml(text)}</p>`;
      return `<div class="session-cell"><article class="session-card${interested ? " interested" : ""}${changed ? " updated" : ""}">
        <button class="star-button" type="button" aria-label="${favorite ? "Remove from favorites" : "Add to favorites"}"
          aria-pressed="${favorite}" data-favorite="${escapeHtml(key)}">${favorite ? "★" : "☆"}</button>
        ${agendaContent}
      </article></div>`;
    }).join("");
    return `<div class="time-row${isCurrent ? " now-row" : ""}"><div class="time-label">${escapeHtml(slot.time)}</div>${cells}</div>`;
  }).join("");
  ui.schedule.innerHTML = heading + rows;
  ui.schedule.querySelectorAll("[data-favorite]").forEach((button) => {
    button.addEventListener("click", () => toggleFavorite(button.dataset.favorite));
  });
  ui.schedule.querySelectorAll("[data-open-agenda]").forEach((button) => {
    button.addEventListener("click", () => openAgendaResults(button.dataset.openAgenda));
  });
}

function currentMeetingMinute() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Seoul",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Number(value.hour) * 60 + Number(value.minute);
}

function toggleFavorite(key) {
  state.favorites = state.favorites.includes(key)
    ? state.favorites.filter((item) => item !== key)
    : [...state.favorites, key];
  saveJson(STORAGE_KEYS.favorites, state.favorites);
  renderSchedule();
}

function renderInterestTags() {
  ui.tags.innerHTML = state.interests.map((term) => `
    <span class="interest-tag">${escapeHtml(term)}
      <button type="button" aria-label="Remove keyword ${escapeHtml(term)}" data-remove-interest="${escapeHtml(term)}">×</button>
    </span>
  `).join("");
  ui.tags.querySelectorAll("[data-remove-interest]").forEach((button) => {
    button.addEventListener("click", () => {
      state.interests = state.interests.filter((term) => term !== button.dataset.removeInterest);
      saveJson(STORAGE_KEYS.interests, state.interests);
      renderInterestTags();
      renderSchedule();
    });
  });
}

function addInterest(term) {
  const value = term.trim();
  if (!value || state.interests.some((item) => item.toLocaleLowerCase() === value.toLocaleLowerCase())) return;
  state.interests.push(value);
  saveJson(STORAGE_KEYS.interests, state.interests);
  renderInterestTags();
  renderSchedule();
}

function countScheduleChanges(previous, next) {
  const oldSlots = new Map();
  for (const day of previous.days || []) {
    for (const slot of day.slots || []) {
      for (let index = 0; index < day.rooms.length; index += 1) {
        oldSlots.set(sessionKey(day.day, slot.time, day.rooms[index]), slot.sessions[index] || "");
      }
    }
  }
  let changed = 0;
  const changedKeys = new Set();
  for (const day of next.days || []) {
    for (const slot of day.slots || []) {
      for (let index = 0; index < day.rooms.length; index += 1) {
        const key = sessionKey(day.day, slot.time, day.rooms[index]);
        if (oldSlots.has(key) && oldSlots.get(key) !== (slot.sessions[index] || "")) {
          changed += 1;
          changedKeys.add(key);
        }
      }
    }
  }
  return { changed, changedKeys };
}

function contentHash(schedule) {
  return JSON.stringify({
    meeting: schedule.meeting,
    location: schedule.location,
    dates: schedule.dates,
    days: schedule.days
  });
}

function setSchedule(schedule, sourceLabel, previous = state.schedule) {
  if (!schedule?.days?.length) throw new Error("No meeting schedule was found in the PowerPoint.");
  translateScheduleLabels(schedule);
  const result = previous ? countScheduleChanges(previous, schedule) : { changed: 0, changedKeys: new Set() };
  state.schedule = schedule;
  state.scheduleHash = contentHash(schedule);
  state.changedSlots = result.changedKeys;
  saveJson(STORAGE_KEYS.schedule, schedule);
  renderHeader();
  renderDayTabs();
  renderSchedule();
  setStatus(result.changed
    ? `${sourceLabel}: ${result.changed} schedule entries changed.`
    : `${sourceLabel}: Schedule checked.`);
  if (result.changed && state.config.notificationsEnabled && "Notification" in window
    && Notification.permission === "granted") {
    new Notification("RAN4 schedule update", { body: `${result.changed} schedule entries changed.` });
  }
}

function decodeXmlText(element) {
  const paragraphs = Array.from(element.getElementsByTagNameNS(NS.drawing, "p"));
  if (!paragraphs.length) return Array.from(element.getElementsByTagNameNS(NS.drawing, "t"))
    .map((node) => node.textContent || "").join("").trim();
  return paragraphs.map((paragraph) =>
    Array.from(paragraph.getElementsByTagNameNS(NS.drawing, "t"))
      .map((node) => node.textContent || "").join("").trim()
  ).filter(Boolean).join("\n").trim();
}

async function readZipEntry(data, view, entry) {
  const offset = entry.localOffset;
  if (view.getUint32(offset, true) !== 0x04034b50) throw new Error("Invalid ZIP entry in the Office document.");
  const nameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const start = offset + 30 + nameLength + extraLength;
  const compressed = data.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return compressed;
  if (entry.method !== 8 || typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot read the compressed Office document. Use the latest Chrome or Edge.");
  }
  const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function unzipOfficePackage(file) {
  const data = new Uint8Array(await file.arrayBuffer());
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let eocd = -1;
  for (let offset = data.length - 22; offset >= Math.max(0, data.length - 65557); offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("Could not find the Office document ZIP directory.");
  const entries = new Map();
  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("The Office document ZIP directory is corrupted.");
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(data.subarray(offset + 46, offset + 46 + nameLength));
    entries.set(name, { method, compressedSize, localOffset });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return {
    async text(name) {
      const entry = entries.get(name);
      if (!entry) return "";
      return new TextDecoder().decode(await readZipEntry(data, view, entry));
    },
    names: [...entries.keys()]
  };
}

function parseSlide(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("Could not read PowerPoint slide XML.");
  const shapes = Array.from(doc.getElementsByTagNameNS(NS.presentation, "sp"));
  const text = shapes.map(decodeXmlText).filter(Boolean);
  const day = DAY_NAMES.find((name) => text.includes(name));
  const table = doc.getElementsByTagNameNS(NS.drawing, "tbl")[0];
  if (!day || !table) return { day, text };
  const rows = Array.from(table.getElementsByTagNameNS(NS.drawing, "tr"));
  const cellsForRow = (row) => Array.from(row.children)
    .filter((child) => child.localName === "tc")
    .map(decodeXmlText);
  const headers = cellsForRow(rows[0]).slice(1).map((value) => value.trim());
  const slots = rows.slice(1).map((row) => {
    const values = cellsForRow(row);
    return {
      time: (values[0] || "").replace(/\s+/g, " ").trim(),
      sessions: headers.map((_, index) => (values[index + 1] || "").trim())
    };
  }).filter((slot) => slot.time);
  return { day, rooms: headers, slots, text };
}

function parseMeetingDetails(titleText) {
  const allText = titleText.join(" ");
  const dateMatch = allText.match(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})\s*[-–]\s*(\d{1,2}),?\s+(\d{4})\b/);
  const month = dateMatch ? new Date(`${dateMatch[1]} 1, ${dateMatch[4]}`).getMonth() + 1 : null;
  const dateValue = (day) => `${dateMatch[4]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const meetingMatch = allText.match(/RAN4#\s*[\w-]+/i);
  const locationMatch = allText.match(/\b(Jeju,\s*South Korea)\b/i);
  return {
    meeting: meetingMatch?.[0]?.replace(/\s+/g, "") || "RAN4",
    location: locationMatch?.[0] || "",
    dates: dateMatch && month ? { start: dateValue(dateMatch[2]), end: dateValue(dateMatch[3]) } : {},
    timezone: "Asia/Seoul"
  };
}

async function parsePptx(file, modifiedAt = "") {
  const archive = await unzipOfficePackage(file);
  const slideNames = archive.names.filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((left, right) => Number(left.match(/slide(\d+)/)[1]) - Number(right.match(/slide(\d+)/)[1]));
  if (!slideNames.length) throw new Error("No slides were found in the PowerPoint.");
  const slides = [];
  for (const name of slideNames) slides.push(parseSlide(await archive.text(name)));
  const details = parseMeetingDetails(slides[0].text || []);
  const days = slides.filter((slide) => slide.day && slide.rooms && slide.slots);
  return {
    ...details,
    source: file.name || file.url || "schedule.pptx",
    updatedAt: modifiedAt || new Date().toISOString(),
    days
  };
}

function findAgenda(key) {
  for (const day of state.schedule.days || []) {
    const dayIndex = state.schedule.days.indexOf(day);
    for (const slot of day.slots || []) {
      for (let index = 0; index < day.rooms.length; index += 1) {
        if (sessionKey(day.day, slot.time, day.rooms[index]) === key) {
          return { day, dayIndex, slot, room: day.rooms[index], text: slot.sessions[index] || "" };
        }
      }
    }
  }
  return null;
}

function agendaTokens(text) {
  return [...new Set((text.match(/\[?\d{3,4}(?:-[A-Za-z])?\]?|[A-Za-z][A-Za-z0-9_-]{2,}/g) || [])
    .map((token) => token.toLocaleLowerCase().replace(/^\[|\]$/g, "")))];
}

function documentRelevance(filename, tokens) {
  const name = decodeURIComponent(filename).toLocaleLowerCase();
  return tokens.reduce((score, token) => score + (name.includes(token) ? token.length > 4 ? 3 : 2 : 0), 0);
}

async function listResultDocuments(folderUrl, tokens) {
  const response = await fetch(folderUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load the results folder (HTTP ${response.status}).`);
  const html = await response.text();
  const baseUrl = new URL(folderUrl, location.href);
  const documents = Array.from(new DOMParser().parseFromString(html, "text/html").querySelectorAll("a[href]"))
    .map((anchor) => {
      const url = new URL(anchor.getAttribute("href"), baseUrl);
      return { url, name: decodeURIComponent(url.pathname.split("/").pop() || anchor.textContent.trim()) };
    })
    .filter((item) => /^https?:$/.test(item.url.protocol) && /\.docx$/i.test(item.url.pathname));
  const unique = [...new Map(documents.map((item) => [item.url.href, item])).values()];
  return unique.map((item) => ({
    ...item,
    relevance: documentRelevance(item.name, tokens)
  })).sort((left, right) => right.relevance - left.relevance || left.name.localeCompare(right.name));
}

async function parseDocx(file) {
  const archive = await unzipOfficePackage(file);
  const xml = await archive.text("word/document.xml");
  if (!xml) throw new Error("No document body was found in the DOCX.");
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("Could not read the DOCX body.");
  const wordNamespace = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  return Array.from(document.getElementsByTagNameNS(wordNamespace, "p"))
    .map((paragraph) => Array.from(paragraph.getElementsByTagNameNS(wordNamespace, "t"))
      .map((text) => text.textContent || "").join("").replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function analyzeDiscussion(paragraphs, agendaText) {
  const terms = agendaTokens(agendaText).filter((token) => token.length >= 4 || /\d/.test(token));
  const agreementPattern = /\b(agreement|agreed|agree|consensus|conclusion|decision|decided|approved|endorse(?:d|ment)?)\b/i;
  const discussionPattern = /\b(discussion|discussed|proposal|proposed|comment|concern|view|position|observation|noted|clarification)\b/i;
  const scored = paragraphs.map((text, index) => {
    const normalized = text.toLocaleLowerCase();
    const matches = terms.filter((term) => normalized.includes(term));
    return { text, index, matches, isAgreement: agreementPattern.test(text), isDiscussion: discussionPattern.test(text) };
  });
  const agreements = scored.filter((item) => item.isAgreement)
    .sort((left, right) => right.matches.length - left.matches.length || left.index - right.index)
    .slice(0, 8);
  const related = scored.filter((item) => item.matches.length && (item.isDiscussion || !item.isAgreement))
    .sort((left, right) => right.matches.length - left.matches.length || left.index - right.index)
    .slice(0, 10);
  return {
    agreements,
    discussion: related,
    hasTopicMatch: scored.some((item) => item.matches.length > 0)
  };
}

function renderAnalysis(documentName, paragraphs) {
  const analysis = analyzeDiscussion(paragraphs, state.selectedAgenda.text);
  const renderExcerpt = (item) => `<li>${escapeHtml(item.text)}</li>`;
  const agreementContent = analysis.agreements.length
    ? `<ul>${analysis.agreements.map(renderExcerpt).join("")}</ul>`
    : '<p class="muted">No agreement or conclusion phrases found. Please review the source document.</p>';
  const discussionContent = analysis.discussion.length
    ? `<ul>${analysis.discussion.map(renderExcerpt).join("")}</ul>`
    : '<p class="muted">No discussion passages matching this agenda were found.</p>';
  ui.resultsContent.innerHTML = `
    <p class="document-name">Analyzed document: <strong>${escapeHtml(documentName)}</strong></p>
    ${analysis.hasTopicMatch ? "" : '<p class="analysis-warning">No passages matched the agenda keywords. Agreement candidates below are from the full document.</p>'}
    <h3>Agreement / Conclusion Candidates</h3>${agreementContent}
    <h3>Related Discussion Excerpts</h3>${discussionContent}
    <details><summary>View full extracted text</summary><pre>${escapeHtml(paragraphs.join("\n\n"))}</pre></details>
  `;
  ui.resultsStatus.textContent = `Read ${paragraphs.length} paragraphs locally. Please verify the excerpts in the source document.`;
}

async function analyzeSelectedDocument() {
  const documentUrl = ui.resultsDocument.value;
  if (!documentUrl || !state.selectedAgenda) return;
  const option = ui.resultsDocument.selectedOptions[0];
  const name = option?.textContent || new URL(documentUrl).pathname.split("/").pop() || "Results document";
  ui.resultsStatus.textContent = `Reading ${name}…`;
  ui.resultsContent.innerHTML = "";
  try {
    const response = await fetch(documentUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load the DOCX document (HTTP ${response.status}).`);
    const paragraphs = await parseDocx(await response.blob());
    if (!paragraphs.length) throw new Error("No readable text was found in the DOCX body.");
    renderAnalysis(name, paragraphs);
  } catch (error) {
    ui.resultsStatus.textContent = `Document analysis failed: ${error.message}`;
    ui.resultsStatus.classList.add("error");
  }
}

async function openAgendaResults(key) {
  const agenda = findAgenda(key);
  if (!agenda) {
    setStatus("Could not find the selected agenda in the schedule.", true);
    return;
  }
  state.selectedAgenda = agenda;
  ui.resultsAgenda.textContent = `${agenda.day} · ${agenda.slot.time} · ${agenda.room}\n${agenda.text}`;
  ui.resultsDocument.innerHTML = '<option value="">Loading documents…</option>';
  ui.resultsContent.innerHTML = "";
  ui.resultsStatus.classList.remove("error");
  ui.resultsStatus.textContent = "Searching for results documents…";
  ui.resultsDialog.showModal();
  if (!state.config.resultsFolderUrl) {
    ui.resultsDocument.innerHTML = '<option value="">Results folder URL is not configured</option>';
    ui.resultsStatus.textContent = "Enter the meeting results DOCX folder URL in Settings.";
    return;
  }
  try {
    const documents = await listResultDocuments(state.config.resultsFolderUrl, agendaTokens(agenda.text));
    if (!documents.length) {
      ui.resultsDocument.innerHTML = '<option value="">No DOCX files found</option>';
      ui.resultsStatus.textContent = "No DOCX files were found in the results folder.";
      return;
    }
    ui.resultsDocument.innerHTML = '<option value="">Select a results document</option>'
      + documents.map((item) => `<option value="${escapeHtml(item.url.href)}">${escapeHtml(item.name)}${item.relevance ? ` · Relevance ${item.relevance}` : ""}</option>`).join("");
    ui.resultsStatus.textContent = `Found ${documents.length} DOCX files, sorted by filename relevance.`;
  } catch (error) {
    ui.resultsDocument.innerHTML = '<option value="">Could not load document list</option>';
    ui.resultsStatus.textContent = `Could not check the results folder: ${error.message}`;
    ui.resultsStatus.classList.add("error");
  }
}

function filenameVersion(name) {
  const values = name.match(/\d+/g);
  return values ? values.map((part) => Number(part)) : [];
}

function compareVersions(left, right) {
  const a = filenameVersion(left);
  const b = filenameVersion(right);
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference) return difference;
  }
  return left.localeCompare(right);
}

async function findLatestPptx(folderUrl) {
  const response = await fetch(folderUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Could not load the folder listing (HTTP ${response.status}).`);
  const html = await response.text();
  const baseUrl = new URL(folderUrl, location.href);
  const links = Array.from(new DOMParser().parseFromString(html, "text/html").querySelectorAll("a[href]"))
    .map((anchor) => new URL(anchor.getAttribute("href"), baseUrl))
    .filter((url) => url.origin === baseUrl.origin && /\.pptx$/i.test(url.pathname));
  const unique = [...new Map(links.map((url) => [url.href, url])).values()];
  if (!unique.length) throw new Error("No PowerPoint files found in the folder. Check that the folder listing is publicly accessible.");
  const records = await Promise.all(unique.map(async (url) => {
    try {
      const head = await fetch(url, { method: "HEAD", cache: "no-store" });
      const modifiedAt = head.headers.get("last-modified") || "";
      return { url, modifiedAt, modifiedTime: Date.parse(modifiedAt) || 0 };
    } catch {
      console.warn(`Could not read last-modified metadata for ${url.href}; using its filename to order schedule files.`);
      return { url, modifiedAt: "", modifiedTime: 0 };
    }
  }));
  records.sort((left, right) => left.modifiedTime - right.modifiedTime
    || compareVersions(left.url.pathname, right.url.pathname));
  return records[records.length - 1];
}

async function pollFolder() {
  if (state.polling) return;
  const folderUrl = getFolderUrl();
  if (!folderUrl) {
    ui.sourceMode.textContent = isMeetingDay() ? "MEETING WEEK · LOCAL" : "LATEST · LOCAL";
    return;
  }
  state.polling = true;
  try {
    const latest = await findLatestPptx(folderUrl);
    const response = await fetch(latest.url, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not download the schedule PowerPoint (HTTP ${response.status}).`);
    const blob = await response.blob();
    const file = new File([blob], latest.url.pathname.split("/").pop() || "schedule.pptx", {
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation"
    });
    const schedule = await parsePptx(file, latest.modifiedAt || "");
    const sameFile = state.schedule?.source === schedule.source
      && state.scheduleHash === contentHash(schedule);
    if (!sameFile) setSchedule(schedule, `Found ${schedule.source} in folder`);
    ui.sourceMode.textContent = isMeetingDay() ? "MEETING WEEK · LIVE" : "LATEST · LIVE";
  } catch (error) {
    setStatus(`Schedule folder check failed: ${error.message}`, true);
    ui.sourceMode.textContent = "FOLDER CHECK NEEDED";
  } finally {
    state.polling = false;
  }
}

function startPolling() {
  if (state.pollTimer) clearInterval(state.pollTimer);
  pollFolder();
  state.pollTimer = setInterval(pollFolder, Math.max(30, Number(state.config.pollSeconds) || 60) * 1000);
}

function sendInterestAlerts() {
  if (!state.config.notificationsEnabled || !state.schedule || (!state.interests.length && !state.favorites.length)
    || !("Notification" in window) || Notification.permission !== "granted"
    || !isMeetingDay()) return;
  const dayIndex = getDayIndexForToday();
  const day = state.schedule.days?.find((item) => item.day === DAY_NAMES[dayIndex]);
  if (!day) return;
  const now = Date.now();
  const lead = Math.max(1, Number(state.config.leadMinutes) || 10) * 60000;
  const notified = loadJson(STORAGE_KEYS.notified, []);
  const retained = notified.filter((item) => now - item.sentAt < 36 * 60 * 60 * 1000);
  for (const slot of day.slots) {
    const range = parseTimeRange(slot.time);
    if (!range) continue;
    const start = new Date(`${getTodayInSeoul()}T${String(Math.floor(range.startMinutes / 60)).padStart(2, "0")}:${String(range.startMinutes % 60).padStart(2, "0")}:00+09:00`).getTime();
    if (start <= now || start - now > lead) continue;
    day.rooms.forEach((room, index) => {
      const text = slot.sessions[index] || "";
      const matching = state.interests.filter((term) => text.toLocaleLowerCase().includes(term.toLocaleLowerCase()));
      const favorite = state.favorites.includes(sessionKey(day.day, slot.time, room));
      if (!matching.length && !favorite) return;
      const key = `${getTodayInSeoul()}|${slot.time}|${room}|${matching.join(",")}`;
      if (retained.some((item) => item.key === key)) return;
      new Notification(`RAN4 agenda in ${state.config.leadMinutes} minutes`, {
        body: `${matching.length ? matching.join(", ") : "Starred agenda"} · ${slot.time} · ${room}\n${text.slice(0, 180)}`,
        tag: key
      });
      retained.push({ key, sentAt: now });
    });
  }
  saveJson(STORAGE_KEYS.notified, retained);
}

function updateNotificationButton() {
  const supported = "Notification" in window;
  ui.notificationButton.disabled = !supported;
  ui.notificationButton.textContent = state.config.notificationsEnabled ? "Disable browser alerts" : "Enable browser alerts";
  ui.notificationHelp.textContent = !supported
    ? "This browser does not support notifications."
    : Notification.permission === "denied"
      ? "Allow notifications for this site in your browser settings."
      : "Browser alerts are delivered while this page is open.";
}

function fillSettings() {
  ui.meetingFolder.value = state.config.meetingFolderUrl;
  ui.finalFolder.value = state.config.finalFolderUrl;
  ui.resultsFolder.value = state.config.resultsFolderUrl;
  ui.pollInterval.value = String(state.config.pollSeconds);
  ui.leadTime.value = String(state.config.leadMinutes);
}

async function enableNotifications() {
  if (!("Notification" in window)) return;
  if (state.config.notificationsEnabled) {
    state.config.notificationsEnabled = false;
  } else {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") {
      setStatus("Browser notification permission was not granted.", true);
      updateNotificationButton();
      return;
    }
    state.config.notificationsEnabled = true;
  }
  saveJson(STORAGE_KEYS.config, state.config);
  updateNotificationButton();
}

document.querySelector("#interest-form").addEventListener("submit", (event) => {
  event.preventDefault();
  addInterest(ui.interestInput.value);
  ui.interestInput.value = "";
});
ui.search.addEventListener("input", renderSchedule);
ui.leadTime.addEventListener("change", () => {
  state.config.leadMinutes = Number(ui.leadTime.value);
  saveJson(STORAGE_KEYS.config, state.config);
});
ui.notificationButton.addEventListener("click", enableNotifications);
document.querySelector("#settings-open").addEventListener("click", () => {
  fillSettings();
  ui.settings.showModal();
});
document.querySelector("#settings-close").addEventListener("click", () => ui.settings.close());
document.querySelector("#settings-cancel").addEventListener("click", () => ui.settings.close());
document.querySelector("#results-close").addEventListener("click", () => ui.resultsDialog.close());
ui.resultsDocument.addEventListener("change", analyzeSelectedDocument);
document.querySelector("#settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  state.config.meetingFolderUrl = ui.meetingFolder.value.trim();
  state.config.finalFolderUrl = ui.finalFolder.value.trim();
  state.config.resultsFolderUrl = ui.resultsFolder.value.trim();
  state.config.pollSeconds = Number(ui.pollInterval.value);
  state.config.leadMinutes = Number(ui.leadTime.value);
  saveJson(STORAGE_KEYS.config, state.config);
  ui.settings.close();
  startPolling();
});
document.querySelector("#today-button").addEventListener("click", () => {
  state.selectedDay = getDayIndexForToday();
  renderDayTabs();
  renderSchedule();
});
document.querySelector("#pptx-upload").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    const schedule = await parsePptx(file);
    setSchedule(schedule, `Imported ${file.name}`);
  } catch (error) {
    setStatus(`Could not read the PowerPoint: ${error.message}`, true);
  } finally {
    event.target.value = "";
  }
});

async function initialize() {
  ui.leadTime.value = String(state.config.leadMinutes || 10);
  renderInterestTags();
  updateNotificationButton();
  try {
    const saved = localStorage.getItem(STORAGE_KEYS.schedule);
    if (saved) state.schedule = JSON.parse(saved);
    if (!state.schedule) {
      const response = await fetch("./schedule.json");
      if (!response.ok) throw new Error(`Could not load the initial schedule (HTTP ${response.status}).`);
      state.schedule = await response.json();
    }
    translateScheduleLabels(state.schedule);
    state.scheduleHash = contentHash(state.schedule);
    state.selectedDay = getDayIndexForToday();
    renderHeader();
    renderDayTabs();
    renderSchedule();
    setStatus("Initial schedule loaded.");
    startPolling();
  } catch (error) {
    setStatus(`Could not load the initial schedule: ${error.message}`, true);
  }
  state.alertTimer = setInterval(sendInterestAlerts, 15000);
}

initialize();
