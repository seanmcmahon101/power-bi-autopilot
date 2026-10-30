// Builds this project's semantic model. Lives in <project>/_model/ next to its copy of tmdl.js.
// Rebuild after any change, with Power BI Desktop CLOSED:  node _model/build.js   then open the .pbip and Refresh.
// Column lists come from: node <model-it>/scripts/profile.js <data files>
const fs = require('fs');
const path = require('path');
const tm = require('./tmdl.js');
const { csv, excel, sql, m, dax } = tm;

const projectDir = path.join(__dirname, '..');
const modelName = fs.readdirSync(projectDir).find(d => d.endsWith('.SemanticModel'));
const model = tm.model(path.join(projectDir, modelName));
model.parameter('DataFolder', 'FULL\\PATH\\TO\\DATA\\');

// ---------- tables ----------
// const sales = model.table('Sales', {
//   description: 'One row per ...',
//   source: csv('sales.csv'),
//   columns: [['OrderID', 'int', { key: true }], ['OrderDate', 'date'], ['CustomerID', 'text'], ['Quantity', 'int'], ['UnitPrice', 'decimal', { noSum: true }]],
// });
// model.table('Customers', { source: excel('customers.xlsx', 'Customers'), columns: [['CustomerID', 'text', { key: true }], ['Region', 'text']] });
// model.dateTable('Date', { from: ['Sales[OrderDate]'], fiscalYearStartMonth: 1 });

// ---------- relationships (many side first) ----------
// model.relationship('Sales[CustomerID]', 'Customers[CustomerID]');
// model.relationship('Sales[OrderDate]', 'Date[Date]');

// ---------- measures ----------
// sales
//   .measure('Sales', dax.sumProduct('Sales', 'Quantity', 'UnitPrice'), { format: '£#,0', folder: 'Sales', description: '...' })
//   .measure('Sales R12', dax.rolling('Sales', 12), { format: '£#,0.0', folder: 'Time', description: 'Last 12 months.' });

model.write();
