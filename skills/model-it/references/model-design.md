# Model design rules

A good Power BI model is a star: fact tables of events (orders, shipments, readings) in the middle, dimension tables of things (customers, products, dates) around them, one-to-many relationships from each dimension to the facts, filters flowing from dimensions to facts only.

## Tables

- **One fact table per event type**, at its natural grain (one row per order line, per reading). Don't pre-aggregate unless the source is too big; measures aggregate.
- **Dimensions have a unique key** and the descriptive columns people slice by. If a key repeats, it's not a dimension yet: dedupe it in the source query or pick the right key.
- **Flat files with everything in one sheet** (customer name, region, product on every row) are fine as a single fact table for small data. Split out a dimension when a slicer or a second fact table needs it.
- **Keep columns people use.** Drop free-text notes, internal IDs nobody filters by, and duplicated columns; every column costs memory and clutters the field list.
- **Hide technical columns** (keys, sort columns) so the field list shows what readers need. Keys stay visible only if people search by them.
- Name tables and columns in the business's words (`Customers`, `Order Date`), not the source's (`CUST_MSTR_V`, `ORD_DT`), unless the team knows the source names.

## The date table

Always build one with `model.dateTable(...)`, even if the data has only one date column:

- covers whole years from the first to the last date in the data (plus one year for a fiscal calendar), so time intelligence works
- marked as the date table (`dataCategory: Time`, `Date` is the key)
- month and day names sort correctly (sort-by columns are set)
- `Months Ago` / `Weeks Ago` for rolling page filters, `Has Data` so year-to-date and rolling measures stop at the last real date
- fiscal year columns when the business year doesn't start in January (ask: UK companies often run April to March)

Relate every date column people analyse by to it. Only one relationship between two tables can be active: make the main date (usually order or transaction date) active, the others inactive, and add measures that switch with `USERELATIONSHIP`.

Auto date/time is turned off in new projects: it adds a hidden date table per date column and bloats the model.

## Relationships

- Many-to-one, from the fact's foreign key to the dimension's key; single direction (dimension filters fact).
- Both directions only for a real need (a dimension filtered by another through a fact), and never in a loop. Prefer a measure with `CROSSFILTER` to a both-ways relationship.
- Many-to-many between two facts: add a shared dimension instead.
- Fact keys with no match in the dimension appear as "(Blank)" in visuals. Report the count; fix in the source when possible.

## Measures

- Every number on a page is an explicit measure with a format string and a one-line description. No implicit sums.
- Base measures first (`Sales`, `Units`, `Cost`), then measures built from them (`Margin`, `Margin %`, time variants). Reuse; never repeat a calculation.
- Row-by-row maths (qty x price, qty x cost from another table with `RELATED`) uses `SUMX`.
- Ratios use `DIVIDE` and are computed from the totals, never averaged.
- **Time comparisons need a period.** Prior-year and year-on-year measures compare like with like only when a month or year is in context (a chart axis, a slicer). For cards and tables without a date, use the rolling patterns ("last 12 months vs the 12 before") or year-to-date; both stop at the last date with data.
- Money shown on headline cards: give the measure one decimal (`£#,0.0`). The new card visual auto-scales to K/M and rounds to the format's decimals, so `£#,0` turns £1.62M into "£2M". Measures used in tables keep `£#,0`.
- Put measures on the fact table they summarise, in display folders (`Sales`, `Margin`, `Time`).

## Sources

- Files are read through one text parameter, `DataFolder`, so moving the data means changing one value (Transform data > Edit parameters), not every query.
- SQL: select only the columns the model needs, in the query; let the database filter and join where it can.
- Don't make one table's query read another table's query (`Source = OtherQuery`): every refresh then re-reads the other source. Join in the database, or relate the tables in the model and use `RELATED` / `LOOKUPVALUE` in DAX.
- Keep types explicit (the generator does): text codes stay text, dates are dates, money is decimal.
