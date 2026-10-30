// Builds the Acme Sales report pages. Rebuild: node _viz/build.js (save in Desktop first if open)
const fs = require('fs');
const path = require('path');
const pbir = require('../../../skills/viz-it/scripts/pbir.js');
const { C, M, topN, sortBy, measureColors, colors } = pbir;

const projectDir = path.join(__dirname, '..');
const reportName = fs.readdirSync(projectDir).find(d => d.endsWith('.Report'));
const r = pbir.report(path.join(projectDir, reportName), { themeName: 'Acme Sales' });
const L = r.layout;
const S = p => M('Sales', p), CU = p => C('Customers', p), PR = p => C('Products', p), D = p => C('Date', p);

{
  const p = r.page('Sales overview');
  p.header('Sales overview', 'Order value by order date, GBP. Fiscal year starts in April');
  p.slicerRow([[D('Fiscal Year'), 'Fiscal year'], [CU('Region'), 'Region'], [CU('Segment'), 'Segment'], [PR('Category'), 'Category']]);
  p.cardRow([[S('Sales R12'), 'Sales, last 12 months'], [S('Sales R12 vs PY %'), 'vs the 12 months before'], [S('Margin %'), 'Margin'], [S('Sales FYTD'), 'Fiscal year to date'], [S('Customers Buying'), 'Customers buying']]);
  const [a, b] = L.cols(1100, '*');
  p.line([a.x, L.rowA.y, a.w, L.rowA.h], 'Sales by month', 'This year and the same month last year', [D('Year Month'), 'Month'],
    [[S('Sales'), 'Sales'], [S('Sales PY'), 'Last year']], { colors: measureColors([[S('Sales'), colors.BLUE], [S('Sales PY'), colors.NEUTRAL]]) });
  p.bar('clusteredBarChart', [b.x, L.rowA.y, b.w, L.rowA.h], 'Sales by category', 'Share of all categories in the tooltip', [PR('Category'), 'Category'],
    [[S('Sales'), 'Sales']], { sort: sortBy(S('Sales')), labels: {} });
  const [c, d] = L.cols(900, '*');
  p.bar('columnChart', [c.x, L.rowB.y, c.w, L.rowB.h], 'Sales by region and segment', null, [CU('Region'), 'Region'], [[S('Sales'), 'Sales']],
    { series: [CU('Segment'), 'Segment'], sort: sortBy(S('Sales')) });
  p.table([d.x, L.rowB.y, d.w, L.rowB.h], 'Top 15 customers', 'By sales in the last 12 months', [[CU('CustomerName'), 'Customer'], [CU('Country'), 'Country'],
    [S('Sales R12'), 'Sales, last 12 months'], [S('Sales R12 vs PY %'), 'vs 12 months before'], [S('Margin %'), 'Margin'], [S('Order Lines'), 'Lines']],
    { sort: sortBy(S('Sales R12')), filters: [topN(CU('CustomerName'), S('Sales R12'), 15)] });
}
r.write();
