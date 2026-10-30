// Builds this project's generated report pages. Lives in <project>/_viz/ next to its copy of pbir.js.
// Rebuild after any change:  node _viz/build.js   (save in Power BI Desktop first if the project is open)
// Field names must match the model exactly: node <pbi-core>/scripts/scan.js <project> --detail
const fs = require('fs');
const path = require('path');
const pbir = require('./pbir.js');
const { C, M, inFilter, cmpFilter, between, topN, sortBy, measureColors, valueColors, colors } = pbir;

const projectDir = path.join(__dirname, '..');
const reportName = fs.readdirSync(projectDir).find(d => d.endsWith('.Report'));
const r = pbir.report(path.join(projectDir, reportName), { themeName: reportName.replace(/\.Report$/, '') });
const L = r.layout;

// ---------- fields (one place to rename) ----------
// const SALES = p => M('Sales', p), CUST = p => C('Customer', p), DATE = p => C('Date', p);

// ---------- 1. Overview ----------
{
  const p = r.page('Overview');
  p.header('TITLE', 'units, scope, exclusions');
  // p.slicerRow([[DATE('Year'), 'Year'], [CUST('Region'), 'Region', { search: true }]]);
  // p.cardRow([[SALES('Total Sales'), 'Sales'], [SALES('Orders'), 'Orders']]);
  // const [a, b] = L.cols(1100, '*');
  // p.line([a.x, L.rowA.y, a.w, L.rowA.h], 'Sales by month', 'GBP', [DATE('Year Month'), 'Month'], [[SALES('Total Sales'), 'Sales']]);
  // p.bar('barChart', [b.x, L.rowA.y, b.w, L.rowA.h], 'Top 10 customers', 'By sales', [CUST('Customer Name'), 'Customer'],
  //   [[SALES('Total Sales'), 'Sales']], { sort: sortBy(SALES('Total Sales')), filters: [topN(CUST('Customer Name'), SALES('Total Sales'), 10)] });
}

r.write();
