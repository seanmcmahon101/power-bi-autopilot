# Model recipes: the tmdl.js API

Every recipe here has been loaded and refreshed in Power BI Desktop (see `examples/acme-sales` in the repo).

## Skeleton

```js
// _model/build.js - run with Desktop closed: node _model/build.js
const path = require('path');
const tm = require('./tmdl.js');
const { csv, excel, sql, m, dax } = tm;

const model = tm.model(path.join(__dirname, '..', 'Sales.SemanticModel'));
model.parameter('DataFolder', 'C:\\data\\sales\\');           // first parameter = folder for csv()/excel() file names

const sales = model.table('Sales', {
  description: 'One row per order line.',
  source: csv('sales.csv'),
  columns: [['OrderID', 'int', { key: true }], ['OrderDate', 'date'], ['CustomerID', 'text'], ['Quantity', 'int'], ['UnitPrice', 'decimal', { format: '£#,0.00', noSum: true }]],
});
model.table('Customers', { source: excel('customers.xlsx', 'Customers'), columns: [['CustomerID', 'text', { key: true }], ['Region', 'text']] });
model.dateTable('Date', { from: ['Sales[OrderDate]'], fiscalYearStartMonth: 4 });

model.relationship('Sales[CustomerID]', 'Customers[CustomerID]');
model.relationship('Sales[OrderDate]', 'Date[Date]');

sales.measure('Sales', dax.sumProduct('Sales', 'Quantity', 'UnitPrice'), { format: '£#,0', folder: 'Sales', description: 'Quantity x unit price, GBP.' });
model.write();
```

## Tables and columns

`model.table(name, { source, columns, description, hidden })`. Column: `[name, type, options]`.

| Type | Power Query | Model | Default summarize |
|---|---|---|---|
| `int` | Int64.Type | int64 | sum |
| `decimal` | type number | double | sum |
| `currency` | Currency.Type | decimal (fixed 4 dp) | sum |
| `date` | type date | dateTime, Short Date | none |
| `datetime` | type datetime | dateTime | none |
| `text` | type text | string | none |
| `bool` | type logical | boolean | none |

Options: `key` (no summing; names ending ID/Key/Code are treated as keys anyway), `noSum` (prices, rates, anything that shouldn't add up), `format`, `hidden`, `sortBy: 'Other column'`, `description`.

The generated query selects exactly the listed columns, in that order, so extra source columns are ignored and a missing one fails the refresh with its name.

## Sources

| Helper | Reads |
|---|---|
| `csv('file.csv', { delimiter, encoding, culture })` | a CSV/TXT file; UTF-8, comma and en-US number/date parsing by default |
| `excel('file.xlsx', 'Sheet name', { culture })` | a sheet, first row as headers |
| `excel('file.xlsx', null, { table: 'tblSales' })` | an Excel table (keeps its own headers) |
| `sql('server', 'database', 'SELECT ...')` | a SQL Server query; types come from the database |
| `m('let ... in ...')` | any other Power Query expression, written in full |

A file name without a folder is read from the first `model.parameter`; an absolute path is read as is. `culture` matters for text dates like 31/03/2026 (`'en-GB'`) vs 03/31/2026 (`'en-US'`); ISO dates (2026-03-31) parse anywhere.

## Date table

`model.dateTable('Date', { from: ['Fact[DateCol]', ...], fiscalYearStartMonth })` writes a calculated table covering whole years across every listed column, marked as the date table, with: Date, Year, Quarter, Year Quarter, Month, Year Month (sorted correctly), Week Start, Day of Week, Months Ago, Weeks Ago, Has Data (on or before the last date of the first `from` column) and, with a fiscal start month, Fiscal Year (named by the year it ends, FY2026 = Apr 2025 to Mar 2026), Fiscal Quarter, Fiscal Month Number.

## Relationships

`model.relationship('Fact[Key]', 'Dim[Key]', { active: false, both: true })`: many side first. Inactive relationships are used by measures through `USERELATIONSHIP ( Fact[OtherDate], 'Date'[Date] )`.

## Measure patterns (`dax.*`)

| Pattern | DAX it writes | Use |
|---|---|---|
| `sum(t, c)`, `count(t)`, `distinct(t, c)` | SUM / COUNTROWS / DISTINCTCOUNT | base measures |
| `sumProduct(t, a, b)` | `SUMX ( t, t[a] * t[b] )` | qty x price |
| `ratio(num, den)` | `DIVIDE ( [num], [den] )` | margin %, conversion |
| `priorYear(m)` | same period last year, up to the last date with data | charts by month/year |
| `change(m, prior)`, `changePct(m, prior)` | difference / % difference, blank when there is no current value | YoY |
| `ytd(m, 'Date', '31/3')` | year to date (fiscal year end optional), stopping at the last date with data | cards, tables |
| `rolling(m, 12)` | last 12 months up to the latest date with data in view | cards and tables with no date |
| `rollingPriorYear(m, 12)` | the same 12 months a year earlier | with `changePct` for "vs previous 12 months" |
| `shareOf(m, t, c)` | share of the total across one column, other filters kept | % of category |

The time patterns need the date table (they use its `Has Data` column). Chain measures with `table.measure(...).measure(...)`.

## What write() touches

Only what this build made: its tables (files in `definition/tables/`), its relationships (named `gen_...`), its parameters, and their `ref table` lines in `model.tmdl`. All are listed in `_model/generated-model.json`, so a table removed from the build is removed from the model too. A table with the same name that the build didn't make stops the run.

## Gotchas found while building

- Write table names in DAX quoted (`'Date'[Date]`): an unquoted `Date` clashes with the DATE function. The patterns always quote.
- A report with no `themeCollection` fails to load ("Failed to load the report"); the project template keeps Desktop's base theme for that reason.
- Model (TMDL) changes don't reload through "Apply external changes": close Desktop without saving, run the build, reopen.
- After the first open, Desktop needs **Refresh now** (twice if both bars show: once for calculated tables, once for data).
