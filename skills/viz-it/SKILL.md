---
name: viz-it
description: Claude takes the wheel and builds Power BI report pages end to end - converts a .pbix to a .pbip project if needed, reads the model, adds any missing measures, generates clean pages of visuals from a short build script, opens them in Power BI Desktop, screenshots every page and fixes what looks wrong. The user does not touch a file. Use for /viz-it, "make the visuals", "build a dashboard/page/report", "add a chart of X", "visualise this model".
---

# /viz-it: build the visuals, hands-off

Load `pbi-core` first; `<core>` below means its folder, `../pbi-core` next to this skill. The user should not have to do anything except answer at most one question about what the report is for. You open files, convert formats, write measures, generate pages, drive Desktop and check the result yourself.

Arguments are optional: a file or folder, and a request ("sales by region and month", "a page for the warehouse team"). No request = you design a sensible report from the model.

Tell the user what you are doing in one line per stage. Stages: find, convert, understand, plan, measures, build, load, check, finish.

## 1. Find

`node <core>/scripts/scan.js <arg or .>`. Pick the target: the one the user named, else the only report, else ask (list names with page counts). Note whether Desktop has it open.

## 2. Convert to a PBIR project (only if needed)

The pages are written as PBIR files, so the target must be a `.pbip` whose report is PBIR (`<Name>.Report/definition/pages/`). The scan says which format each file is.

| Scan says | Do |
|---|---|
| `.pbip`, report `PBIR` | Nothing. |
| `.pbix` | Convert: `references/drive-desktop.md` § Save as .pbip. The .pbix stays untouched as the old copy; from now on the .pbip is the file to open. Tell the user that in one sentence. If the scan warns about path length, save the project to a short folder instead of next to the .pbix. |
| `.pbip`, report `PBIR-Legacy` | Upgrade: `references/drive-desktop.md` § Turn on PBIR. |
| Model is `model.bim` | Fine for reading. To add measures with Desktop closed, prefer the MCP route or turn on TMDL (same section). |
| No model, thin report | Visuals can still be built; measures must already exist in the published model. Check fields against the MCP (`ConnectFabric`) if available. |

Back up first: copy the project (or .pbix) to `.pbi-backups/<yyyy-mm-dd-hhmm>/`.

## 3. Understand the model

`node <core>/scripts/scan.js <project> --detail`. From it, work out:

- the fact table(s) (most rows/columns, foreign keys, numeric columns) and what one row is
- the date table (marked date table, or a table of dates joined to the fact) and its month/year columns, and whether month names have a sort-by column
- the dimensions people slice by (customer, product, region, site, person)
- existing measures worth showing (visible, formatted, used), and what is missing

## 4. Plan the pages

If the user asked for something specific, plan exactly that. If not, plan from the model using `references/design.md` (default: one overview page + one detail page per main subject, plus an optional "How to read" page). Write the plan as a short list (page: visuals). Show it in one message and carry on building without waiting; the user can redirect later. Ask first only if the purpose is genuinely unclear and the model has no obvious main fact table.

## 5. Add missing measures

Visuals should bind explicit measures, not raw columns summed by Desktop. For each missing one, write DAX that follows `../audit-measures/references/review-checklist.md` (DIVIDE, correct totals, Table[Column] / [Measure] style), with a format string and a one-line description.

| Situation | How |
|---|---|
| Desktop has the file open and the MCP is available | `measure_operations` create on the open model, then focus Desktop and Ctrl+S so TMDL on disk matches. |
| Desktop closed, TMDL model | Append to the fact table's `.tmdl` file: see `references/visual-recipes.md` § Measures in TMDL. |
| Published model / thin report | Don't. Use existing measures and tell the user which ones would help. |

Run `node <core>/scripts/scan.js <project> --detail` again: the new measures must appear with no `unresolved` references.

## 6. Build

1. Copy `scripts/pbir.js` and `scripts/build-template.js` into `<project folder>/_viz/` (keep an existing `_viz/build.js`: edit it instead). The copy makes the build reproducible without this skill.
2. Write the pages in `_viz/build.js` with the library API (`references/visual-recipes.md`). Exact table, column and measure names from the scan; case matters.
3. If Desktop has the project open: focus it and press Ctrl+S **before** running the build (otherwise Desktop's next save overwrites the new files).
4. `node _viz/build.js` then `node <core>/scripts/check.js <project>.pbip --layout`. Fix every ERROR and every overlap WARN in `build.js`, rebuild, re-check until clean.

The build only replaces pages it created (this build's pages and those in `_viz/generated-pages.json`) and empty pages. The user's own pages stay as they are, after the generated ones, and so does the report's theme, background and images when such pages exist. After the build, prove it: their page files and `report.json` must be unchanged (compare checksums taken before the build).

## 7. Load in Desktop

`references/drive-desktop.md` § Reload. In short: Desktop open → click "Apply external changes"; otherwise close and reopen the `.pbip` with `desktop.ps1`. If Desktop shows a list of problems, click Copy details, read the clipboard, fix, rebuild, reload.

If visuals are empty because the project has no cached data (fresh from git or a new conversion), press Refresh. If Refresh asks for credentials, stop and ask the user to sign in; never type credentials.

## 8. Check every page on screen

For each generated page: go to it, screenshot (maximised window), zoom into anything unclear, and check against `references/design.md` § Visual check. Typical fixes: wrong sort (months alphabetical), truncated titles, unreadable labels, legends overlapping, cards showing raw decimals, blank visuals (wrong field or filter), visuals too crowded for their box.

Fix in `build.js` (or the model), rebuild, reload, re-check. Loop until every page passes or three rounds have passed; then list what still looks off.

## 9. Finish

1. Focus Desktop, Ctrl+S.
2. Tell the user: the pages built (one line each), measures added, where the backup is, and that `node _viz/build.js` rebuilds the pages after a change to the build file.
3. Offer `/data-who` to write the explainer for the new pages.
