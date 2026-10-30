---
name: init-pbi
description: Get a folder ready for Power BI work with Claude - find every report and model, check Power BI Desktop, Node and the Power BI MCP (installing the MCP via /mcp-it if missing), set up git hygiene for .pbip projects, write a Power BI section into CLAUDE.md, tidy the existing .md files, and ask the user for the business context Claude can't see. Run once per project, again after big changes.
disable-model-invocation: true
---

# /init-pbi: get this folder ready for Power BI work

Load `pbi-core` first; `<core>` below means its folder, `../pbi-core` next to this skill. This is a conversation, not a script: explore, show what you found in plain words, ask what only the user knows, then write. The user may be a Power BI beginner; never make them name a file format.

## 1. Explore (no questions yet)

Run these from the folder root:

1. `node <core>/scripts/scan.js . --detail` for projects, loose .pbix files, formats, sources, and whether Desktop has any of them open. Long output: read it, don't echo it.
2. Tooling:
   - `powershell -NoProfile -ExecutionPolicy Bypass -File <core>/scripts/desktop.ps1 find` (Desktop installed? which version?)
   - `node --version` (needs 18+)
   - `claude mcp list` (look for a powerbi-modeling server), and whether this session has `mcp__powerbi-modeling__*` tools
   - whether computer-use tools are available (needed by `/viz-it` to drive Desktop)
3. Repo state: `git status` (is it a repo?), `.gitignore` contents.
4. Every `.md` file at the root and one level down (`CLAUDE.md`, `AGENTS.md`, `README.md`, notes). Read them all.

## 2. Show the findings

One short block, in this shape, using the user's own file names:

```
Found
  Sales Dashboard.pbix              report + data in one file (Claude can read the layout; to edit it, /viz-it converts it to a project)
  Finance/Budget.pbip               project: 4 pages, 27 visuals, model with 9 tables and 41 measures, data from SQL Server sql01/Finance
Tools
  Power BI Desktop 2.159 (Store)    ok
  Node 22                           ok
  Power BI MCP                      missing
  Git                               this folder is not a git repo
Notes
  CLAUDE.md                         212 lines, half of it describes files Claude can read itself
```

Flag anything surprising: models with broken references, a report pointing at a model that isn't here, two copies of the same report.

## 3. Fix the tooling

- **MCP missing:** say why it matters in one line ("lets me read and change the model while Desktop has it open") and run the `/mcp-it` skill. It needs the user's OK for the licence; that question belongs to it.
- **Desktop missing:** the skills still read .pbip files, but nothing can be opened or checked visually. Point to https://aka.ms/pbidesktopstore.
- **Node missing:** ask before `winget install OpenJS.NodeJS.LTS`.

## 4. Repo hygiene

- Not a git repo: recommend it ("git keeps every version of the report files, so any change can be undone") and ask before `git init`. Do not commit unless the user asks.
- `.gitignore`: make sure these lines exist (Desktop writes them for new projects, older projects lack them). Add only missing lines:

```
**/.pbi/localSettings.json
**/.pbi/cache.abf
.pbi-backups/
```

- `.pbix` files in git are large binaries. Mention it once if any are tracked. Don't change it.

## 5. Ask what Claude can't see

Ask these **one at a time**. Lead with your best guess from the files so the user can answer "yes". Skip any the files already answer.

1. **Purpose and readers.** "Budget.pbip looks like a monthly budget vs actual report for the finance team. Right? Who reads it, and what decision does it help them make?"
2. **Published?** "Is any of this published to the Power BI service? Which workspace?" (affects whether model edits are local or live; see the XMLA warning in pbi-core)
3. **Words that mean something specific here.** "Any terms with a house meaning? For example, does 'sales' mean invoiced or shipped?" Collect 3-10 glossary entries, or none.
4. **Off limits.** "Anything I must never change? For example a page another team owns, a published model, a data source path."
5. **House style.** "Any brand colours, fonts or page size to stick to? If not I'll use a clean neutral style."

## 6. Write the CLAUDE.md section

Add (or replace) one `## Power BI` section in the root `CLAUDE.md`, using `references/claude-md-section.md` as the template. Fill it from the scan and the answers. Keep it short: what Claude can't work out from the files. Don't paste the table/measure inventory: `scan.js --detail` gives it fresh every time.

## 7. Tidy the existing .md files

Work out what to change in `CLAUDE.md` / `AGENTS.md` (and only those two; other .md files are the user's documents):

- Remove what the files already show (folder listings, column lists, measure definitions), and what is stale against the scan.
- Remove duplicates, and rules already in a skill this pack provides.
- Put long reference material (more than ~30 lines on one topic) in its own file and link to it.
- Keep anything that records a decision, a gotcha, or a "never do X". When unsure, keep it.

Show the user a short list of the changes, with line counts before and after, and get a yes before rewriting. Never delete a user's note without saying so.

## 8. Next steps

End with the one or two skills that fit what you found, e.g.:

- only data files (Excel, CSV) or a database, no report yet: `/model-it`
- a .pbix and the user wants new pages: `/viz-it`
- an existing report nobody explained: `/data-who`
- a model with many measures or broken references: `/audit-measures`
