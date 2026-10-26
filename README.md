# RAN4 Meeting Schedule

Static English-language schedule viewer, preloaded with the latest available RAN4#120bis schedule.

## Run locally

Serve this folder over HTTP (do not open `index.html` directly, because the browser blocks local JSON and PPTX requests):

```powershell
python -m http.server 8000
```

Open `http://localhost:8000`. The same static files can be hosted on GitHub Pages.

## Publish with GitHub Pages

Create a **public** repository named `ran4-schedule` under `middole-dev`, then push this project to the `main` branch. The included GitHub Actions workflow deploys the site automatically after each push. In the repository, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions** if Pages is not already configured. If Pages is enabled after the initial push, rerun the failed workflow from the **Actions** tab.

The default site URL will be `https://middole-dev.github.io/ran4-schedule/`. Personal folder URLs, alert keywords, and favorites are stored in the visitor's browser and are not included in this repository. The schedule JSON is publicly served as part of the site.

To synchronize updates after the first push:

```powershell
git add .
git commit -m "Update RAN4 schedule"
git push
```

The push starts a deployment automatically. Check the **Actions** tab to see its status and the deployed site URL.

## Automatic schedule updates

GitHub Actions checks the public 3GPP RAN4#120bis history folder every 15 minutes:

`https://www.3gpp.org/FTP/tsg_ran/WG4_Radio/TSGR4_120bis/Inbox/Meeting_Arrangements/History/`

It selects the newest schedule PowerPoint using the directory's modified time, parses its weekday tables into `schedule.json`, and deploys the updated site when the schedule changes. The file name is used to break ties when multiple files have the same modified time. An open site checks the published `schedule.json` every five minutes, so it can display an update without a manual refresh. Scheduled GitHub Actions can be delayed, so updates are not guaranteed to appear exactly 15 minutes after upload.

During meeting week, `10.10.10.10` is a private network address. GitHub-hosted runners cannot access it, so the public site cannot monitor that server directly. A browser on the meeting network may use the existing **Settings** folder URL while it is open, if the server permits browser access and CORS; that updates only that visitor's browser. To publish internal-only changes to everyone automatically, the schedule must also be copied to a public source, or a secured self-hosted runner/relay must be installed on the meeting network. Do not publish private meeting documents or credentials.

## Completed agenda results

A session becomes clickable 20 minutes after its scheduled end (using Korea Standard Time). Set the meeting-results folder in **Settings**; it must expose links to `.docx` files and permit browser reads (including CORS for a different origin). Clicking a completed session lists those documents, with filename matches to the agenda identifiers first. Choose a document to inspect it.

DOCX text is extracted and analyzed in the browser. Agreement/conclusion terms and agenda-keyword passages are shown as source excerpts, alongside the full extracted text. This is local phrase matching, not an AI-generated summary; verify the cited context in the document. PDF and PPTX meeting-result documents are not supported in this view.

## Personal alerts

Add agenda terms (for example, a work-item name or agenda identifier) and enable browser notifications. Alerts are sent before matching time blocks while this page is open. Notification permission and interests are stored in this browser only; web-push alerts while the page is closed are not included.

## Manual update

Use **Open PPTX** to load a schedule file. This replaces the schedule stored in this browser. Folder polling can subsequently replace it with the latest file from the configured folder.
