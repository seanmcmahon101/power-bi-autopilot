# Design rules for generated reports

The goal: a report that looks like a careful analyst made it. Calm, aligned, every element earns its place. No decoration for its own sake.

## Default report when the user gives no brief

1. **Overview** page
   - header: what the report covers, and the units and scope in the subtitle ("Open orders, GBP, firm lines only")
   - slicer row: date (year or month) plus the 1-3 dimensions people filter by most
   - card row: 4-6 headline measures, the most important first
   - row A: trend over time (line, or column for monthly totals) left, ~60% width; top 10 of the main dimension (bar chart, sorted) right
   - row B: breakdown by a second dimension left; detail table right (key columns + 2-4 measures, sorted by the main measure)
2. One **detail page** per further subject the model covers (each fact table, or a natural split such as Customers / Products).
3. **How to read** page (`note` panels): what each headline number means, where the data comes from, what is excluded. Add it when the report is for other people, or when measures have non-obvious rules.

Fewer, clearer visuals beat more. Six to eight data visuals per page is the ceiling.

## Choosing the visual

| Question | Visual |
|---|---|
| How much, overall? | card |
| How does it change over time? | line (continuous), column (per-period totals) |
| Which are biggest? | bar chart, sorted descending, top 10-15 |
| Part of a whole, 2-4 parts | stacked bar/column; avoid pies and donuts |
| How did we get from A to B? | waterfall |
| Two measures, different scales, over time | combo |
| Exact numbers, look-ups | table (sorted), matrix for two dimensions |

## Words

- Titles say what the visual shows, in sentence case: "Sales by month", "Top 10 customers by open orders". No "Dashboard", "Chart of", "Overview of".
- Subtitles carry units, scope and exclusions: "GBP, last 12 complete months".
- Display names for fields are short and plain: "Customer", not "Customer Name (Master)".
- Use the business's own words (CLAUDE.md glossary) and the same word for the same thing on every page.

## Colour and numbers

- Neutral page, white panels, one accent colour (BLUE) for single-series charts. Extra colours only when they mean something: series, status, good/bad.
- Same measure = same colour on every page.
- Formats: currency `£#,0` (or the user's currency), counts `#,0`, percentages `0.0%`, no decimals on large values.
- Never use red/green alone to carry meaning; pair with labels or position.

## Layout

- Use `r.layout`: left margin 32 px, 12 px gaps, rows aligned across the page. Don't place visuals by eye.
- Most important top-left; reading order top-left to bottom-right.
- Give tables enough width for their longest text column (`widths`), or drop a column.

## Visual check (each page, on screen)

Pass only if all are true:

- [ ] Every visual shows data: no grey X, no "Can't display", no warning triangles, no unexpected "(Blank)" bars.
- [ ] Numbers are formatted (currency, separators, %), with no long decimals.
- [ ] Time runs left to right in date order; months are not alphabetical.
- [ ] Bars are sorted by value unless the order means something.
- [ ] Titles and subtitles fit; no "..." truncation that hides meaning.
- [ ] Axis labels are readable; no label soup (too many categories: add a top-N filter).
- [ ] Legends don't cover data; single-series charts have no legend.
- [ ] Slicers show sensible values and preselections; the page is not filtered to nothing.
- [ ] Nothing overlaps; edges line up across the page.
- [ ] The page answers its title's question at a glance.
