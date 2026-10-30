# Visual recipes: the pbir.js API and what Desktop accepts

Every recipe here has been opened in Power BI Desktop. Stay inside them; when you need something new, build it once by hand in Desktop, save, and copy the JSON it wrote.

## Skeleton

```js
const path = require('path');
const pbir = require('./pbir.js');
const { C, M, inFilter, cmpFilter, between, topN, sortBy, measureColors, valueColors, colors } = pbir;

const r = pbir.report(path.join(__dirname, '..', 'Sales.Report'), { themeName: 'Sales' });
const L = r.layout;                     // 1920 x 1080 grid: X0, W, GAP, header, slicers, cards, rowA, rowB, cols(), split()

const p = r.page('Overview');           // page name is a hash of the display name: stable across rebuilds
p.header('Sales overview', 'Invoiced sales, GBP, excluding intercompany');
p.slicerRow([[C('Date', 'Year'), 'Year'], [C('Customer', 'Region'), 'Region', { search: true }]]);
p.cardRow([[M('Sales', 'Total Sales'), 'Sales'], [M('Sales', 'Orders'), 'Orders'], [M('Sales', 'Margin %'), 'Margin']]);
const [a, b] = L.cols(1100, '*');
p.line([a.x, L.rowA.y, a.w, L.rowA.h], 'Sales by month', 'GBP', [C('Date', 'Year Month'), 'Month'], [[M('Sales', 'Total Sales'), 'Sales']]);
p.bar('barChart', [b.x, L.rowA.y, b.w, L.rowA.h], 'Top 10 customers', 'By sales', [C('Customer', 'Customer Name'), 'Customer'],
  [[M('Sales', 'Total Sales'), 'Sales']], { sort: sortBy(M('Sales', 'Total Sales')), filters: [topN(C('Customer', 'Customer Name'), M('Sales', 'Total Sales'), 10)] });
r.write();
```

`C(table, column)` and `M(table, measure)` use the exact names from `scan.js --detail`. A field is `f` or `[f, 'Display name']`; value lists are `[[f, 'Name'], ...]`. The display name renames the field in that visual only, so model names can stay technical.

## Page methods

| Method | Visual | Notes |
|---|---|---|
| `header(title, subtitle, {nav})` | textbox + page tabs | `nav: false` drops the tabs |
| `slicer(pos, field, label, opts)` / `slicerRow(list, w=300)` | slicer | opts: `mode` 'Dropdown' / 'Basic', `single`, `search`, `select: [values]` (preselected) |
| `card(pos, measure, label, opts)` / `cardRow(list, y, h)` | `cardVisual` | one measure per card. opts: `valueSize`, `hideLabel`, `bare`, `filters` |
| `bar(type, pos, title, sub, cat, vals, opts)` | `clusteredColumnChart`, `clusteredBarChart`, `columnChart` (stacked), `barChart` (stacked) | opts: `series`, `colors`, `sort`, `labels: {}` (show data labels), `valueAxis`, `filters` |
| `line(pos, title, sub, cat, vals, opts)` | `lineChart` | sorted by the category ascending by default; opts: `markers`, `colors`, `sort`, `filters` |
| `combo(pos, title, sub, cat, columns, lines, opts)` | `lineClusteredColumnComboChart` | columns on the left axis, lines on the right |
| `table(pos, title, sub, cols, opts)` | `tableEx` | opts: `sort`, `totals`, `widths: [[field, px]]`, `filters` |
| `matrix(pos, title, sub, rows, columns, vals, opts)` | `pivotTable` | opts: `subtotals`, `sort`, `filters` |
| `waterfall(pos, title, sub, cat, val, opts)` | `waterfallChart` | increase blue, decrease red, total grey |
| `note(pos, heading, lines)` | framed textbox | "How to read" panels |
| `textbox(pos, paragraphs)` / `add(type, pos, visual, filters)` | anything | raw escape hatch |

Page options: `r.page('Name', { filters: [...], hidden: true })`. Report options: `pbir.report(dir, { themeName, palette: [hex...], replaceAll, theme })`.

What `r.write()` touches:

- **Pages:** it deletes and rewrites only its own pages: the ones in this build, plus the ones listed in `_viz/generated-pages.json` from the last build (so a page removed from the build disappears). Empty pages (Desktop's blank "Page 1") go too. Every other page stays exactly as it was. `replaceAll: true` drops all other pages; use it only on a report that is entirely generated.
- **Theme:** the generated theme is applied only when the report has no pages of its own left, or its custom theme is already the generated one. A report with the user's own pages keeps its theme, images and background untouched; generated visuals set their own colours and fonts, so they look the same either way. `theme: true` forces the theme (it restyles the user's pages: ask first), `theme: false` never writes it.

## Filters

| Helper | Meaning |
|---|---|
| `inFilter(C(...), ['A', 'B'])` | keep only these values (numbers become whole-number literals) |
| `cmpFilter(C(...), kind, value)` | kind 0 =, 1 >, 2 >=, 3 <, 4 <= |
| `between(C(...), lo, hi)` | lo <= x <= hi |
| `topN(C(...), M(...), n)` | top n values of the column ranked by the measure |

For rolling periods ("last 12 weeks") don't hand-write relative-date JSON: add a column such as `Weeks Ago = INT(DATEDIFF('Date'[Week Start], TODAY(), DAY) / 7)` to the date table and use `between(C('Date', 'Weeks Ago'), 0, 11)`.

## Colours

`colors` has ink/grey tones and the categorical palette in order: BLUE, ORANGE, AQUA, YELLOW, PINK, GREEN, VIOLET, RED, plus DARK_BLUE / LIGHT_BLUE for a two-tone pair (e.g. firm vs forecast) and NEUTRAL for "comparison / total".

- one colour per measure: `colors: measureColors([[M('S', 'Actual'), colors.BLUE], [M('S', 'Budget'), colors.NEUTRAL]])`
- one colour per category value: `colors: valueColors(C('S', 'Status'), [['Late', colors.RED], ['On time', colors.BLUE]])`

## Gotchas Desktop enforces (all hit in real builds)

- Stacked bar = `barChart`, stacked column = `columnChart`. `stackedBarChart` does not exist ("custom visual not found"). `check.js` catches it.
- A `cardVisual` with several measures wraps unpredictably: one card per measure.
- `cardVisual` applies automatic display units on top of the format string, with no per-card setting. Use plain formats (`£#,0.0`, shows £86.5M); a scaled format like `£#,0.0,,"M"` gets divided twice. If you do scale in DAX format strings, the commas go left of the decimal point: `£#,0,,.0"m"`.
- Slicer `strictSingleSelect: true` auto-selects "(Blank)" and can blank the page. The library uses `singleSelect` only.
- TopN filters: the outer condition must use `"Table": {"SourceRef": {"Source": "subquery"}}`, not `TableRef`. The `topN` helper does.
- Legend position `TopLeft` overlaps the plot area; the library uses `Top`.
- A sort on a measure that is not in the visual is ignored (it sorts by category instead). Sort by a field the visual shows.
- Month names sort alphabetically unless the column has a sort-by column in the model (`sortByColumn: 'Month Number'` in TMDL). Check the scan; if missing, set it in the model or use a `Year Month` text column that sorts correctly ("2026-01").
- Theme colour references (`ThemeDataColor`) use ColorId = position in `dataColors` + 2. The library uses hex colours, so this only matters when editing Desktop-made JSON.
- The "÷" character renders as "+" in visual titles. Write "/".
- Page names that change on every build break Desktop's in-place reload. `r.page()` hashes the display name, so renaming a page's display name gives it a new page (and a fresh reload).
- Every visual and page folder name equals the `name` in its JSON; the library guarantees it.

## Measures in TMDL (Desktop closed)

Append inside the table block, before its first `column` line, indented with tabs:

```
	/// Invoiced sales in GBP, intercompany excluded.
	measure 'Total Sales' = SUM ( Sales[Amount GBP] )
		formatString: £#,0
		displayFolder: Sales
		lineageTag: <new GUID>

	measure 'Margin %' =
			VAR s = [Total Sales]
			RETURN DIVIDE ( s - [Total Cost], s )
		formatString: 0.0%
		lineageTag: <new GUID>
```

- `///` line = description. Single-line DAX goes after `=`; multi-line DAX starts on the next line, indented one tab more than the properties (3 tabs inside a table).
- `lineageTag`: a fresh GUID per measure (`node -e "console.log(crypto.randomUUID())"`).
- Names with spaces or symbols are wrapped in single quotes; a quote inside a name is doubled.
- New calculated columns written into TMDL appear empty until a refresh (Refresh in Desktop).
