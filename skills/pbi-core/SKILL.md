---
name: pbi-core
description: Shared Power BI know-how and scripts behind /init-pbi, /model-it, /data-who, /viz-it, /audit-measures and /mcp-it - file formats (.pbix, .pbip, PBIR, TMDL), the scan/check scripts, Desktop window control, and how to talk to Power BI beginners. Load it before reading or writing any Power BI project file.
user-invocable: false
---

# Power BI core

The other skills in this pack lean on this one. Read it once per session before touching Power BI files.

## Who you are working for

Assume the user has never opened a TMDL or PBIR file and does not want to. Take the wheel: find the files, pick the format, run the scripts, drive Power BI Desktop, check your own work. Ask only for decisions that are genuinely theirs (what the report is for, which numbers matter, whether to delete something), one question at a time, in plain words.

Translate jargon the first time it appears:

| Say | Means |
|---|---|
| model / semantic model | the tables, relationships and calculations behind the report |
| measure | a saved calculation, e.g. Total Sales |
| column | a field in a table, e.g. Customer Name |
| visual | one chart, card, table or slicer on a page |
| slicer | an on-page filter the reader clicks |
| refresh | re-reading the data from its source |
| publish | uploading to the Power BI service so others can see it |

## File formats

| What you see | What it is | Can Claude edit it? |
|---|---|---|
| `Name.pbix` | One zipped file: report + data. | Report layout: readable. Model: compressed binary, readable only through Desktop + the MCP. Edit by converting to `.pbip` (see `/viz-it`). |
| `Name.pbip` + `Name.Report/` + `Name.SemanticModel/` | Power BI Project: the same thing as plain text files. | Yes, this is the working format. |
| `Name.Report/definition/pages/<page>/visuals/<visual>/visual.json` | **PBIR**: one JSON file per page and per visual. | Yes. |
| `Name.Report/report.json` (no `definition/pages`) | **PBIR-Legacy**: the whole report in one file with JSON-inside-strings. | Read only. Re-save from Desktop with PBIR on before writing. |
| `Name.SemanticModel/definition/*.tmdl` | **TMDL**: the model as indented text, one file per table. | Yes. |
| `Name.SemanticModel/model.bim` | TMSL: the model as one JSON file. | Read; write only small changes. |
| `definition.pbir` with `byConnection` | Thin report: the model lives in the Power BI service. | Report yes; model only via the MCP (`ConnectFabric`). |
| `.pbi/` folders, `cache.abf` | Desktop's local cache and settings. | Never edit; keep out of git. |

Path length rule: a project's deepest file (a `visual.json`) sits about 87 characters below `<folder>\<name>`, and Windows stops at 260 characters unless long paths are enabled. Desktop then fails to save or open without a clear error. Keep projects in short folders; `scan.js` warns before a conversion, `check.js` errors on long paths.

Folder name rule: every page and visual folder name must equal the `name` inside its JSON. `pages/pages.json` lists the page order. Names are case-sensitive everywhere: `Entity` = exact table name, `Property` = exact column or measure name.

## Scripts (in this skill's `scripts/` folder; Node 18+ and Windows PowerShell)

| Command | Use it to |
|---|---|
| `node scan.js <folder or file>` | see every project and .pbix, their formats, sources, and whether Desktop has them open |
| `node scan.js <...> --detail` | list every table, column, measure (with DAX), relationship, page and visual with its fields. Read this before writing anything. |
| `node scan.js <...> --json out.json` | the full inventory for other scripts |
| `node check.js <X.Report or .pbip> [--layout]` | pre-flight a PBIR report: JSON, names, pages.json, fields missing from the model, wrong visual types, known-bad settings; `--layout` adds overlap checks for generated pages. Exit 1 = errors. |
| `powershell -NoProfile -ExecutionPolicy Bypass -File desktop.ps1 find\|status\|open\|focus\|close` | find the Desktop install, list open windows, open a file and wait for it, bring a window forward (maximised), ask it to close |

## Power BI Desktop rules

- **Desktop owns the files it has open.** When it saves, it overwrites whatever is on disk. Before writing report or model files for an open project, save in Desktop first (Ctrl+S), then write, then reload (below). Never write while it has unsaved edits.
- **Reload after an outside edit:** with the project open, Desktop shows an "Apply external changes" bar after report files change; click it. If it doesn't appear, or model (TMDL) files changed, close Desktop and reopen the `.pbip`.
- **Opening files:** `desktop.ps1 open -Path <file>`. Do not launch "Power BI Desktop" from the Start menu or by app name: that opens a new empty window. To get back to an open file, `desktop.ps1 focus -Match <name>`.
- **Seeing the screen:** use the computer-use tools (request access to "Power BI Desktop"). Take a screenshot after every action that changes the screen, and zoom in on error icons and messages.
- **Errors on open:** Desktop lists every problem in a dialog with **Copy details**. Click it, read the clipboard, fix the files, reopen.
- **Model edits while Desktop is open:** use the powerbi-modeling MCP (connect to the open file), then Ctrl+S so the TMDL on disk catches up. With Desktop closed, edit the TMDL directly.

## Safety

- Copy the project folder to `.pbi-backups/<yyyy-mm-dd-hhmm>/` before the first write in a session. Tell the user where it is.
- Never delete a page, visual, measure, column or table the user made without asking. Generated pages are fine to regenerate.
- **Published models:** an MCP edit to a model in the Power BI service (over XMLA) stops that model ever being downloaded as .pbix again, and the next publish from Desktop overwrites the edit. Get an explicit yes for that, naming both effects.
- Data sources, credentials and gateways belong to the user. Never type passwords or keys; ask the user to do sign-ins themselves.
