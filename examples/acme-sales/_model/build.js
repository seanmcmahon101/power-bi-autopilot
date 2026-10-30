// Builds the Acme Sales semantic model. Run with Power BI Desktop closed: node _model/build.js
const path = require('path');
const tm = require('../../../skills/model-it/scripts/tmdl.js');
const { csv, excel, dax } = tm;

const model = tm.model(path.join(__dirname, '..', 'Acme Sales.SemanticModel'));
// the data files sit in ../data; Power Query needs the full path, ending in a backslash
model.parameter('DataFolder', path.join(__dirname, '..', 'data') + path.sep);

const sales = model.table('Sales', {
  description: 'One row per order line. Sales value = quantity x unit price (net of customer discount).',
  source: csv('sales.csv'),
  columns: [['OrderLineID', 'int', { key: true }], ['OrderDate', 'date'], ['ShipDate', 'date'], ['CustomerID', 'text'], ['ProductID', 'text'],
    ['Quantity', 'int'], ['UnitPrice', 'decimal', { format: '£#,0.00', noSum: true }]],
});
model.table('Customers', {
  description: 'One row per customer.',
  source: csv('customers.csv'),
  columns: [['CustomerID', 'text', { key: true }], ['CustomerName', 'text'], ['Region', 'text'], ['Country', 'text'], ['Segment', 'text']],
});
model.table('Products', {
  description: 'One row per product, from products.xlsx.',
  source: excel('products.xlsx', 'Products'),
  columns: [['ProductID', 'text', { key: true }], ['ProductName', 'text'], ['Category', 'text'], ['Subcategory', 'text'],
    ['UnitCost', 'decimal', { format: '£#,0.00', noSum: true }], ['ListPrice', 'decimal', { format: '£#,0.00', noSum: true }]],
});
model.dateTable('Date', { from: ['Sales[OrderDate]', 'Sales[ShipDate]'], fiscalYearStartMonth: 4 });

model.relationship('Sales[CustomerID]', 'Customers[CustomerID]');
model.relationship('Sales[ProductID]', 'Products[ProductID]');
model.relationship('Sales[OrderDate]', 'Date[Date]');
model.relationship('Sales[ShipDate]', 'Date[Date]', { active: false });

sales
  .measure('Sales', dax.sumProduct('Sales', 'Quantity', 'UnitPrice'), { format: '£#,0', folder: 'Sales', description: 'Order value: quantity x unit price, GBP, by order date.' })
  .measure('Units', dax.sum('Sales', 'Quantity'), { format: '#,0', folder: 'Sales', description: 'Units ordered.' })
  .measure('Order Lines', dax.count('Sales'), { format: '#,0', folder: 'Sales', description: 'Number of order lines.' })
  .measure('Customers Buying', dax.distinct('Sales', 'CustomerID'), { format: '#,0', folder: 'Sales', description: 'Customers with at least one order line.' })
  .measure('Cost', 'SUMX ( Sales, Sales[Quantity] * RELATED ( Products[UnitCost] ) )', { format: '£#,0', folder: 'Margin', description: 'Quantity x product unit cost, GBP.' })
  .measure('Margin', '[Sales] - [Cost]', { format: '£#,0', folder: 'Margin', description: 'Sales minus cost, GBP.' })
  .measure('Margin %', dax.ratio('Margin', 'Sales'), { format: '0.0%', folder: 'Margin', description: 'Margin as a share of sales.' })
  .measure('Sales PY', dax.priorYear('Sales'), { format: '£#,0', folder: 'Time', description: 'Sales in the same period last year.' })
  .measure('Sales YoY %', dax.changePct('Sales', 'Sales PY'), { format: '+0.0%;-0.0%;0.0%', folder: 'Time', description: 'Change in sales vs the same period last year.' })
  .measure('Sales R12', dax.rolling('Sales', 12), { format: '£#,0.0', folder: 'Time', description: 'Sales in the 12 months up to the last date with data in view.' })
  .measure('Sales R12 PY', dax.rollingPriorYear('Sales', 12), { format: '£#,0.0', folder: 'Time', description: 'The same 12 months one year earlier.' })
  .measure('Sales R12 vs PY %', dax.changePct('Sales R12', 'Sales R12 PY'), { format: '+0.0%;-0.0%;0.0%', folder: 'Time', description: 'Last 12 months vs the 12 months before.' })
  .measure('Sales FYTD', dax.ytd('Sales', 'Date', '31/3'), { format: '£#,0.0', folder: 'Time', description: 'Sales from 1 April (fiscal year start) to date.' })
  .measure('Sales by Ship Date', "CALCULATE ( [Sales], USERELATIONSHIP ( Sales[ShipDate], 'Date'[Date] ) )", { format: '£#,0', folder: 'Time', description: 'Sales dated by ship date instead of order date.' })
  .measure('Share of Category', dax.shareOf('Sales', 'Products', 'Category'), { format: '0.0%', folder: 'Sales', description: 'Sales as a share of all categories, other filters kept.' });

model.write();
