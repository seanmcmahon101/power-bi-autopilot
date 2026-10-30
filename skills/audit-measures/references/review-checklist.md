# Measure review checklist

For each measure, answer these. A "no" is a finding. Write the finding as what the reader of the report would see go wrong.

## Does it answer the question its name asks?

- Name says "Sales": does it sum the column the business means by sales (invoiced? shipped? ordered? net of returns?) Check the CLAUDE.md glossary.
- Name says "%" or "Rate": is it a ratio of two measures, and is the denominator the right population?
- Name says "Avg": average of what, per what? `AVERAGE(T[x])` averages rows; "average per customer" needs `AVERAGEX(VALUES(Customer[ID]), [Total])`.
- Name says "YTD", "LY", "Last 30 days": does the date logic use the right date column (order date vs ship date) and the date table?
- Two measures with near-identical names: do they agree, or is one stale?

## Does it behave on totals and filters?

- Ratios and averages must be computed at the total too, not summed: check that a matrix total of `[Margin %]` would be total margin / total sales, not a sum of percentages.
- Row-by-row multiplication (`qty * price`) needs SUMX over the table, not `SUM(qty) * SUM(price)`.
- `ALL(Table)` / `REMOVEFILTERS` removes the reader's slicers too. Intended (a "% of total") or a bug?
- `ALLSELECTED` behaves differently in tables vs cards. Is that intended?
- `CALCULATE([m], T[col] = "x")` replaces any existing filter on `T[col]`. If a slicer on that column should still apply, it needs `KEEPFILTERS`.
- Filters on a fact table column vs a dimension column: will a slicer on the dimension reach it? (Check the relationships in the scan: direction and active/inactive.)
- Inactive relationships are used only with `USERELATIONSHIP`. Is one needed?

## Blanks, zeros and errors

- Returns blank vs 0: `+ 0` forces a row for every item in a table (often thousands of rows of zeros). Only use it on cards.
- Division by a measure that can be blank or zero uses DIVIDE.
- `SELECTEDVALUE` with no default returns blank when several values are selected. Is that handled?
- `FIRSTNONBLANK` / `LASTNONBLANK` on unsorted text columns: intended?

## Dates

- Time intelligence (TOTALYTD, SAMEPERIODLASTYEAR, DATEADD) needs a date table, marked as a date table, with contiguous dates covering the data.
- A fiscal year that doesn't start in January needs the year-end argument (`TOTALYTD([m], 'Date'[Date], "31/3")`) or a fiscal calendar.
- `TODAY()` in the service is UTC.
- Placeholder dates in source data (1900-01-01, 2079-06-06, 9999-12-31) distort min/max/average date logic.

## Speed (only flag when the model is large or the measure is used a lot)

- Iterators (SUMX, FILTER) over the whole fact table where a column filter would do.
- The same sub-expression repeated: use a VAR.
- `DISTINCTCOUNT` on a high-cardinality column in a measure used in big tables.
- Calculated columns that could be measures, or the other way round.

## Housekeeping

- Format string fits the value (currency symbol, %, decimals).
- Display folder puts it with its siblings.
- Description says what it counts and what it excludes, in one line.
- Hidden helper measures are referenced by something; otherwise unused.
