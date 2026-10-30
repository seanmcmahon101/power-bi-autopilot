---
name: model-it
description: Claude builds the Power BI semantic model from raw data - profiles Excel, CSV or SQL sources, designs a star schema, creates the .pbip project if there isn't one, writes the tables, Power Query, a proper date table, relationships and measures from a short build script, then opens it in Power BI Desktop, refreshes and checks the numbers against the source. Use for /model-it, "build a model from this data", "turn these spreadsheets into a Power BI model", "start a report from scratch", or when /viz-it finds no model.
---

# /model-it: build the model from raw data

Load `pbi-core` first; `<core>` below means its folder, `../pbi-core` next to this skill. Same promise as `/viz-it`: the user answers at most a question or two about what the report must answer; you do the rest and prove it works.

Arguments are optional: data files or a folder, a SQL source, and the purpose ("sales by customer and month").

One line to the user per stage: find, profile, design, project, build, load, verify, hand over.

## 1. Find the data

- Files: the argument, else Excel/CSV files in the folder (`node <core>/scripts/scan.js .` shows existing Power BI files; list data files yourself). Ask which ones if it's ambiguous.
- SQL: server and database from the user or CLAUDE.md. Get column names and types from `INFORMATION_SCHEMA.COLUMNS` (or `SELECT TOP 0`) with whatever SQL access the session has; never guess a schema.
- Note where the files live. The model reads them by path, so they must stay put (or be moved somewhere stable first, with the user's OK).

## 2. Profile

```
node <this skill>/scripts/profile.js <files or folder> --json <scratch>/profile.json
```

For every CSV and Excel sheet it reports rows, column types, blanks, distinct counts, keys, ranges, a fact/dimension guess, joins between files (with the % of values that match), and a ready `columns: [...]` line per table. Read it all. Things to settle before designing:

- Grain: what one row of each fact table is.
- Keys: a dimension needs a unique key; a join under 100% means orphans (a "(Blank)" member in visuals). Tell the user how many.
- Types: a mostly-numeric column profiled as text has stray values; codes with leading zeros must stay text; dates as text in odd formats need the right culture.
- Repeated or blank headers (the profile names them like Power Query: `LINE_1`, `Column7`).

## 3. Design the star

Read `references/model-design.md`. Write the design as a short list and show it in one message, then carry on (ask only if the purpose is unclear):

```
Sales (fact, one row per order line): OrderDate, ShipDate, CustomerID, ProductID, Quantity, UnitPrice
Customers (dimension, key CustomerID) · Products (dimension, key ProductID) · Date (calendar, fiscal year from April)
Sales -> Customers, Sales -> Products, Sales[OrderDate] -> Date, Sales[ShipDate] -> Date (inactive)
Measures: Sales, Units, Order Lines, Margin %, Sales R12 vs PY %, Sales FYTD, ...
```

## 4. Get a project

| Situation | Do |
|---|---|
| No .pbip yet | `node <this skill>/scripts/new-project.js <short folder> "<Name>" [--culture en-US]`. Creates a blank PBIR + TMDL project from the template, no Desktop needed. Keep the folder short (path limit, see pbi-core). |
| A .pbix | Convert it first (`/viz-it` step 2), then add to its model. |
| A .pbip with a model | Add to it. The generator refuses to overwrite a table it didn't create. |

Desktop must be closed on this project while the model files are written: `desktop.ps1 status`, then save and close it if open.

## 5. Build

1. Copy `scripts/tmdl.js` and `scripts/build-template.js` to `<project folder>/_model/` (edit an existing `_model/build.js` instead of replacing it).
2. Write `_model/build.js`: `references/model-recipes.md` has the API, source types, date table options and measure patterns. Use the profile's `columns` lines and exact names.
3. `node _model/build.js`. It prints each table and refuses with a clear message if something is off (unknown type, relationship to a missing column, a user table in the way).
4. `node <core>/scripts/scan.js <project> --detail`: every table, column, relationship and measure present, no `unresolved` references. `node <core>/scripts/check.js <project>.pbip`: clean.

## 6. Load in Desktop

`desktop.ps1 open -Path <project>.pbip`, focus. Desktop shows "Some of the tables have incomplete or no data" (and, the first time, "calculated objects need to be manually refreshed"): click **Refresh now** on each bar until both are gone. An error dialog means a source or M problem: read it (screenshot, zoom), fix `build.js`, close Desktop without saving, rebuild, reopen.

Credentials prompts for databases or SharePoint belong to the user: ask them to sign in.

## 7. Verify the numbers

Don't stop at "it loaded". For every table, open Table view (the grid icon on the left), select the table and read the row count in the status bar (bottom left): it must match the profile. For the headline measures, put them on a quick page (`/viz-it`, or the user's report) or run a DAX query through the MCP, and compare two or three of them with the same sums computed straight from the source (a small Node script over the CSV, or SQL). Write down the pairs you compared.

Then check the model's behaviour, not just totals: a date slicer moves the time measures, a dimension slicer filters the fact (relationship direction), year-to-date and rolling cards show sensible values with no date selected.

## 8. Hand over

1. In Desktop: Ctrl+S (this also stores the loaded data in the project cache), then close or keep it open for `/viz-it`.
2. Tell the user: tables and row counts, relationships, measures (name: plain-English meaning), the numbers you verified against the source, where the build script is (`node _model/build.js` rebuilds after an edit, with Desktop closed), and that the data paths are in the `DataFolder` parameter (Transform data > Edit parameters).
3. Offer `/viz-it` for the report pages and `/audit-measures` if they want a second look at the DAX.
