---
name: data-who
description: Explain a Power BI report or dashboard in plain English - one paragraph on what it is for and how to read it, then a page-by-page, visual-by-visual breakdown, every number defined from its DAX, where the data comes from, and the traps. Works on .pbip projects and .pbix files. Use for /data-who, "explain this dashboard", "what does this report show", "what does this measure mean", or handing a report over to someone new.
---

# /data-who: explain the dashboard

Load `pbi-core` first; `<core>` below means its folder, `../pbi-core` next to this skill. Arguments are optional: a file or folder, a page name to explain only that page, and an audience ("for a new starter", "for the board"). Default audience: a smart colleague who has never seen this report and doesn't know Power BI.

## 1. Find the report

- Argument given: use it. Otherwise `node <core>/scripts/scan.js .` and pick the only report; if there are several, ask which one (list them by name with page counts).
- Run `node <core>/scripts/scan.js <target> --detail` and read all of it.

## 2. Get the model, whatever the format

| Situation | How to read the calculations |
|---|---|
| `.pbip` with a `.SemanticModel` folder | The scan already has every table, measure (with DAX) and relationship. |
| `.pbix` | The scan reads the pages and visuals. The model inside is binary: if the powerbi-modeling MCP is available, open the file (`desktop.ps1 open`), connect the MCP to it by file name, and list tables, measures (with expressions) and relationships. Without the MCP, explain from the layout and measure names only, and say clearly that the calculations were not read. |
| Thin report (live connection) | Connect the MCP to the published model (`ConnectFabric` with workspace + model name) if available; otherwise layout only, as above. |

Read only. This skill never changes a file.

## 3. Work out what it is for

Before writing, answer these for yourself from the evidence (titles, page names, measure names and DAX, filters, descriptions, CLAUDE.md glossary):

- Which business question does each page answer? Who would ask it?
- What is the grain of the main table (one row per order line? per day per item?)
- Which filters are fixed (report, page and visual filters the reader can't see) and which are the reader's (slicers)?
- What would a reader most likely misread?

## 4. Write it

Structure, in this order:

**In one paragraph:** what the report is, who it is for, the question it answers, where the data comes from and how fresh it is, and the one thing to know before trusting the numbers. 4-6 sentences, no jargon.

**How to use it:** the slicers and what they do, drill-through or tooltip pages, anything hidden that changes the numbers (page filters, "top 10" filters, excluded values). Say "fixed filter you can't see" when a filter is not on a slicer.

**Page by page:** for each visible page, a heading with its name, one line on its purpose, then each visual in reading order (top-left to bottom-right):

- *<Visual title>* (chart type in plain words: "bar chart", "table", "headline number"): what it shows, what each axis/column/colour means, and what to look for. Skip decoration (shapes, logos, the page title, the page tabs).

**What the numbers mean:** a glossary of every measure on the pages, alphabetical. For each: the plain-English definition worked out from the DAX (what it adds up, which rows it includes or excludes, which date it uses), its format, and a warning if the name and the logic disagree. Example: *Open Order Book*: total value in GBP of order lines not yet shipped, firm orders only (forecast lines excluded).

**Where the data comes from:** each source (system, server, file or SharePoint path), which tables it feeds, the relationships in one line each ("each order line belongs to one customer"), refresh schedule if known.

**Watch-outs:** traps found while reading: fixed filters, measures that ignore slicers (ALL / REMOVEFILTERS), TODAY() logic, dates that are placeholders, broken references (any `unresolved` ref in the scan), hidden pages, measures with the same name on different logic.

Rules:

- Plain words first, the technical name in brackets once: "headline number (card)".
- Quote titles and measure names exactly so the user can find them on screen.
- Never guess silently. If something is unclear from the files, say "probably ... (not confirmed)" and add it to an **Open questions** list at the end.
- Respect the audience argument: board = shorter, outcomes first; analyst = keep the DAX notes.

## 5. Deliver

- Save the full write-up as `<Report name> - explained.md` next to the report (overwrite your own earlier version, not anything else).
- In chat, show the one-paragraph summary and the page list with one line each, then the path of the full file.
- If the scan found broken references or unused measures, mention it in one line and suggest `/audit-measures`.
