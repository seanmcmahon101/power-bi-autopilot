// Semantic model generator. A build script declares tables, sources, a date table, relationships and
// measures; this writes the TMDL files Power BI Desktop loads. Run it with Desktop CLOSED, then open
// the .pbip and Refresh.
//
//   const tm = require('./tmdl.js');
//   const model = tm.model('C:/work/Sales.SemanticModel');
//   model.parameter('DataFolder', 'C:\\work\\data\\');
//   const sales = model.table('Sales', { source: tm.csv('sales.csv'), columns: [['OrderID', 'int', { key: true }], ['OrderDate', 'date'], ['Amount', 'decimal']] });
//   sales.measure('Total Sales', 'SUM ( Sales[Amount] )', { format: '£#,0', description: 'Invoiced value, GBP' });
//   model.dateTable('Date', { from: ['Sales[OrderDate]'] });
//   model.relationship('Sales[OrderDate]', 'Date[Date]');
//   model.write();
//
// Column types: int, decimal, currency, date, datetime, text, bool. Only tables, relationships and
// parameters this build made (listed in generated-model.json next to the build script) are ever
// replaced or removed; anything else in the model is left alone.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---------- naming ----------
const q = name => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`;
const colRef = (t, c) => `${q(t)}.${q(c)}`;
// always quoted: unquoted names like Date clash with DAX function names
const daxTable = t => `'${t.replace(/'/g, "''")}'`;
const daxCol = (t, c) => `${daxTable(t)}[${c.replace(/]/g, ']]')}]`;
// stable lineage tags, so rebuilding doesn't churn identities
const tag = (...parts) => {
  const h = crypto.createHash('md5').update(parts.join('|')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const parseRef = ref => { const m = ref.match(/^'?(.+?)'?\[(.+)\]$/); if (!m) throw new Error(`write columns as Table[Column], got "${ref}"`); return { table: m[1], column: m[2] }; };
const mString = s => `"${String(s).replace(/"/g, '""')}"`;

const TYPES = {
  int: { tmdl: 'int64', m: 'Int64.Type', sum: true },
  decimal: { tmdl: 'double', m: 'type number', sum: true },
  currency: { tmdl: 'decimal', m: 'Currency.Type', sum: true },
  date: { tmdl: 'dateTime', m: 'type date', format: 'Short Date', date: true },
  datetime: { tmdl: 'dateTime', m: 'type datetime', format: 'General Date' },
  text: { tmdl: 'string', m: 'type text' },
  bool: { tmdl: 'boolean', m: 'type logical' },
};

// ---------- sources: each returns a function (tableName, columns, model) -> M lines ----------
const typedTail = (step, columns, culture) => {
  const names = columns.map(c => mString(c.name)).join(', ');
  const types = columns.map(c => `{${mString(c.name)}, ${TYPES[c.type].m}}`).join(', ');
  return [
    `    Typed = Table.TransformColumnTypes(${step}, {${types}}, ${mString(culture)}),`,
    `    Result = Table.SelectColumns(Typed, {${names}})`,
    'in',
    '    Result',
  ];
};
const fileExpr = (file, model) => model.folderParam && !path.isAbsolute(file) ? `File.Contents(${model.folderParam} & ${mString(file)})` : `File.Contents(${mString(file)})`;

// csv('sales.csv') reads from the folder parameter; an absolute path reads that file
function csv(file, opts = {}) {
  return (table, columns, model) => [
    'let',
    `    Source = Csv.Document(${fileExpr(file, model)}, [Delimiter = ${mString(opts.delimiter || ',')}, Encoding = ${opts.encoding || 65001}, QuoteStyle = QuoteStyle.Csv]),`,
    '    Headers = Table.PromoteHeaders(Source, [PromoteAllScalars = true]),',
    ...typedTail('Headers', columns, opts.culture || 'en-US'),
  ];
}
// excel('products.xlsx', 'Sheet1') reads a sheet; { table: 'tblName' } reads an Excel table instead
function excel(file, sheet, opts = {}) {
  return (table, columns, model) => [
    'let',
    `    Source = Excel.Workbook(${fileExpr(file, model)}, null, true),`,
    opts.table ? `    Data = Source{[Item = ${mString(opts.table)}, Kind = "Table"]}[Data],` : `    Sheet = Source{[Item = ${mString(sheet)}, Kind = "Sheet"]}[Data],`,
    ...(opts.table ? [] : ['    Data = Table.PromoteHeaders(Sheet, [PromoteAllScalars = true]),']),
    ...typedTail('Data', columns, opts.culture || 'en-US'),
  ];
}
// sql('server', 'database', 'SELECT ...'): the database sets the types; columns must match the query's names
function sql(server, database, query) {
  return (table, columns) => [
    'let',
    `    Source = Sql.Database(${mString(server)}, ${mString(database)}, [Query = ${mString(query.replace(/\r?\n/g, ' '))}]),`,
    `    Result = Table.SelectColumns(Source, {${columns.map(c => mString(c.name)).join(', ')}})`,
    'in',
    '    Result',
  ];
}
// any other M: give the whole let ... in expression
const m = expression => () => expression.split(/\r?\n/);

// ---------- DAX patterns for common measures ----------
const dax = {
  sum: (t, c) => `SUM ( ${daxCol(t, c)} )`,
  count: t => `COUNTROWS ( ${daxTable(t)} )`,
  distinct: (t, c) => `DISTINCTCOUNT ( ${daxCol(t, c)} )`,
  // row-by-row multiply, e.g. qty x price
  sumProduct: (t, a, b) => `SUMX ( ${daxTable(t)}, ${daxCol(t, a)} * ${daxCol(t, b)} )`,
  ratio: (num, den) => `DIVIDE ( [${num}], [${den}] )`,
  // Time intelligence below only looks at dates up to the last date with data (the date table's
  // 'Has Data' column), so year-to-date and rolling totals don't run into empty future dates.
  // Year to date; fiscalYearEnd like "31/3" or "6/30" (day/month order follows the model culture).
  ytd: (measure, date = 'Date', fiscalYearEnd) => `CALCULATE ( [${measure}], CALCULATETABLE ( DATESYTD ( ${daxCol(date, 'Date')}${fiscalYearEnd ? `, "${fiscalYearEnd}"` : ''} ), ${daxCol(date, 'Has Data')} = TRUE () ) )`,
  // same period last year; needs a period in context (month, year): with none it spans every date
  priorYear: (measure, date = 'Date') => `CALCULATE ( [${measure}], CALCULATETABLE ( SAMEPERIODLASTYEAR ( ${daxCol(date, 'Date')} ), ${daxCol(date, 'Has Data')} = TRUE () ) )`,
  change: (measure, prior) => `VAR cur = [${measure}]\nVAR prev = [${prior}]\nRETURN IF ( NOT ISBLANK ( cur ) && NOT ISBLANK ( prev ), cur - prev )`,
  changePct: (measure, prior) => `VAR cur = [${measure}]\nVAR prev = [${prior}]\nRETURN IF ( NOT ISBLANK ( cur ), DIVIDE ( cur - prev, prev ) )`,
  // last N months up to the latest date with data in view: works on a card with no date filter
  rolling: (measure, months = 12, date = 'Date') => `CALCULATE ( [${measure}], CALCULATETABLE ( DATESINPERIOD ( ${daxCol(date, 'Date')}, MAX ( ${daxCol(date, 'Date')} ), -${months}, MONTH ), ${daxCol(date, 'Has Data')} = TRUE () ) )`,
  // the same N months one year earlier, for "rolling 12 vs prior 12" headline cards
  rollingPriorYear: (measure, months = 12, date = 'Date') => `CALCULATE ( [${measure}], CALCULATETABLE ( DATEADD ( DATESINPERIOD ( ${daxCol(date, 'Date')}, MAX ( ${daxCol(date, 'Date')} ), -${months}, MONTH ), -1, YEAR ), ${daxCol(date, 'Has Data')} = TRUE () ) )`,
  // share of the total across one column, keeping every other filter
  shareOf: (measure, t, c) => `DIVIDE ( [${measure}], CALCULATE ( [${measure}], REMOVEFILTERS ( ${daxCol(t, c)} ) ) )`,
};

// ---------- model ----------
class Table {
  constructor(model, name, spec) {
    this.model = model; this.name = name; this.spec = spec; this.measures = [];
    this.columns = (spec.columns || []).map(c => Array.isArray(c) ? { name: c[0], type: c[1], ...(c[2] || {}) } : c);
    for (const c of this.columns) if (!TYPES[c.type]) throw new Error(`${name}[${c.name}]: unknown type "${c.type}" (use ${Object.keys(TYPES).join(', ')})`);
  }
  // opts: format, folder, description, hidden
  measure(name, expression, opts = {}) { this.measures.push({ name, expression, ...opts }); return this; }
}

function model(semanticModelDir) {
  const def = path.join(semanticModelDir, 'definition');
  if (!fs.existsSync(path.join(def, 'model.tmdl')))
    throw new Error(`${semanticModelDir} has no definition/model.tmdl. Create the project first (new-project.js) or save it from Desktop as .pbip.`);
  const mdl = {
    dir: semanticModelDir, def, tables: [], relationships: [], parameters: [], folderParam: null,
    parameter(name, value) { mdl.parameters.push({ name, value }); if (!mdl.folderParam) mdl.folderParam = name; return mdl; },
    table(name, spec) { const t = new Table(mdl, name, spec); mdl.tables.push(t); return t; },
    // from: list of 'Table[DateColumn]' that the calendar must cover. opts: fiscalYearStartMonth (1-12), name
    dateTable(name = 'Date', opts = {}) { const t = new Table(mdl, name, { dateTable: true, ...opts }); mdl.tables.push(t); return t; },
    // from (many side) -> to (one side). opts: active, both (cross-filter both ways)
    relationship(from, to, opts = {}) { mdl.relationships.push({ from: parseRef(from), to: parseRef(to), active: opts.active !== false, both: !!opts.both }); return mdl; },
    write(opts = {}) { writeModel(mdl, opts); },
  };
  return mdl;
}

// ---------- TMDL text ----------
function measureLines(t, ms) {
  const L = [];
  if (ms.description) for (const d of ms.description.split('\n')) L.push(`\t/// ${d}`);
  const lines = ms.expression.trim().split(/\r?\n/);
  if (lines.length === 1) L.push(`\tmeasure ${q(ms.name)} = ${lines[0]}`);
  else { L.push(`\tmeasure ${q(ms.name)} =`); for (const l of lines) L.push(`\t\t\t${l}`); }
  if (ms.format) L.push(`\t\tformatString: ${ms.format}`);
  if (ms.folder) L.push(`\t\tdisplayFolder: ${ms.folder}`);
  if (ms.hidden) L.push('\t\tisHidden');
  L.push(`\t\tlineageTag: ${tag(t.name, 'measure', ms.name)}`, '');
  return L;
}

function dataTableText(t, mdl) {
  const L = [];
  if (t.spec.description) for (const d of t.spec.description.split('\n')) L.push(`/// ${d}`);
  L.push(`table ${q(t.name)}`, `\tlineageTag: ${tag(t.name)}`);
  if (t.spec.hidden) L.push('\tisHidden');
  L.push('');
  for (const ms of t.measures) L.push(...measureLines(t, ms));
  for (const c of t.columns) {
    const T = TYPES[c.type];
    const isKey = c.key || /(^|[^a-z])(id|key|code)$/i.test(c.name);
    if (c.description) L.push(`\t/// ${c.description}`);
    L.push(`\tcolumn ${q(c.name)}`, `\t\tdataType: ${T.tmdl}`);
    if (c.format || T.format) L.push(`\t\tformatString: ${c.format || T.format}`);
    if (c.hidden) L.push('\t\tisHidden');
    L.push(`\t\tlineageTag: ${tag(t.name, c.name)}`, `\t\tsummarizeBy: ${T.sum && !isKey && !c.noSum ? 'sum' : 'none'}`, `\t\tsourceColumn: ${c.name}`);
    if (c.sortBy) L.push(`\t\tsortByColumn: ${q(c.sortBy)}`);
    if (T.date) L.push('', '\t\tannotation UnderlyingDateTimeDataType = Date');
    L.push('');
  }
  const mLines = t.spec.source(t.name, t.columns, mdl);
  L.push(`\tpartition ${q(t.name)} = m`, '\t\tmode: import', '\t\tsource =', ...mLines.map(l => `\t\t\t\t${l}`), '');
  return L.join('\n');
}

function dateTableText(t, mdl) {
  const from = (t.spec.from || []).map(parseRef);
  if (!from.length) throw new Error(`date table ${t.name}: give from: ['Table[DateColumn]', ...]`);
  const fy = t.spec.fiscalYearStartMonth || 1;
  const nest = (fn, refs) => refs.length === 1 ? `${fn} ( ${daxCol(refs[0].table, refs[0].column)} )` : `${fn} ( ${fn} ( ${daxCol(refs[0].table, refs[0].column)} ), ${nest(fn, refs.slice(1))} )`;
  const cols = [
    ['Year', 'YEAR ( [Date] )'],
    ['Quarter', '"Q" & QUARTER ( [Date] )'],
    ['Year Quarter', 'YEAR ( [Date] ) & " Q" & QUARTER ( [Date] )', { sortBy: 'Year Quarter Sort' }],
    ['Year Quarter Sort', 'YEAR ( [Date] ) * 10 + QUARTER ( [Date] )', { hidden: true }],
    ['Month Number', 'MONTH ( [Date] )', { hidden: true }],
    ['Month', 'FORMAT ( [Date], "mmm" )', { sortBy: 'Month Number' }],
    ['Year Month', 'FORMAT ( [Date], "mmm yyyy" )', { sortBy: 'Year Month Sort' }],
    ['Year Month Sort', 'YEAR ( [Date] ) * 100 + MONTH ( [Date] )', { hidden: true }],
    ['Week Start', '[Date] - WEEKDAY ( [Date], 2 ) + 1', { format: 'Short Date' }],
    ['Day of Week', 'FORMAT ( [Date], "ddd" )', { sortBy: 'Day of Week Number' }],
    ['Day of Week Number', 'WEEKDAY ( [Date], 2 )', { hidden: true }],
    // for rolling page filters: 0 = this month / week, 1 = last, ...
    ['Months Ago', '( YEAR ( TODAY () ) - YEAR ( [Date] ) ) * 12 + MONTH ( TODAY () ) - MONTH ( [Date] )'],
    ['Weeks Ago', 'INT ( ( ( TODAY () - WEEKDAY ( TODAY (), 2 ) + 1 ) - ( [Date] - WEEKDAY ( [Date], 2 ) + 1 ) ) / 7 )'],
    // TRUE up to the last date in the first "from" column: time-intelligence patterns stop there
    ['Has Data', '[Date] <= LastDataDate'],
  ];
  if (fy > 1) cols.push(
    ['Fiscal Year', `"FY" & ( YEAR ( [Date] ) + IF ( MONTH ( [Date] ) >= ${fy}, 1, 0 ) )`],
    ['Fiscal Month Number', `MOD ( MONTH ( [Date] ) - ${fy}, 12 ) + 1`, { hidden: true }],
    ['Fiscal Quarter', `"Q" & ( INT ( ( MOD ( MONTH ( [Date] ) - ${fy}, 12 ) ) / 3 ) + 1 )`],
  );
  const daxLines = [
    `VAR FirstYear = YEAR ( ${nest('MIN', from)} )`,
    `VAR LastYear = YEAR ( ${nest('MAX', from)} )${fy > 1 ? ' + 1' : ''}`,
    `VAR LastDataDate = MAX ( ${daxCol(from[0].table, from[0].column)} )`,
    'RETURN',
    '    ADDCOLUMNS (',
    '        CALENDAR ( DATE ( FirstYear, 1, 1 ), DATE ( LastYear, 12, 31 ) ),',
    ...cols.map(([n, e], i) => `        ${mString(n)}, ${e}${i < cols.length - 1 ? ',' : ''}`),
    '    )',
  ];
  const L = [];
  L.push(`/// Calendar from the earliest to the latest of ${from.map(f => `${f.table}[${f.column}]`).join(', ')}, whole years${fy > 1 ? `; fiscal year starts in month ${fy}` : ''}. Has Data = on or before the last ${from[0].table}[${from[0].column}].`);
  L.push(`table ${q(t.name)}`, `\tlineageTag: ${tag(t.name)}`, '\tdataCategory: Time', '');
  for (const ms of t.measures) L.push(...measureLines(t, ms));
  L.push('\tcolumn Date', '\t\tdataType: dateTime', '\t\tisKey', '\t\tformatString: Short Date', `\t\tlineageTag: ${tag(t.name, 'Date')}`, '\t\tsummarizeBy: none', '\t\tisNameInferred', '\t\tsourceColumn: [Date]', '',
    '\t\tannotation UnderlyingDateTimeDataType = Date', '');
  for (const [n, , o = {}] of cols) {
    L.push(`\tcolumn ${q(n)}`);
    if (o.format) L.push(`\t\tformatString: ${o.format}`);
    if (o.hidden) L.push('\t\tisHidden');
    L.push(`\t\tlineageTag: ${tag(t.name, n)}`, '\t\tsummarizeBy: none', '\t\tisNameInferred', `\t\tsourceColumn: [${n}]`);
    if (o.sortBy) L.push(`\t\tsortByColumn: ${q(o.sortBy)}`);
    L.push('');
  }
  L.push(`\tpartition ${q(t.name)} = calculated`, '\t\tmode: import', '\t\tsource =', ...daxLines.map(l => `\t\t\t\t${l}`), '');
  t.columns = [{ name: 'Date' }, ...cols.map(([n]) => ({ name: n }))];
  return L.join('\n');
}

// split a TMDL file into top-level blocks by keyword ("relationship", "expression")
function blocks(text, keyword) {
  const out = [];
  let cur = null;
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith(`${keyword} `)) { cur = { name: line.slice(keyword.length + 1).split(' =')[0].trim().replace(/^'|'$/g, '').replace(/''/g, "'"), lines: [line] }; out.push(cur); }
    else if (cur) cur.lines.push(line);
    else out.push({ name: null, lines: [line] });
  }
  return out;
}
const fileName = name => `${name.replace(/[<>:"/\\|?*]/g, '_')}.tmdl`;

function writeModel(mdl, opts) {
  const manifestPath = opts.manifest || path.join(path.dirname(process.argv[1] || mdl.dir), 'generated-model.json');
  const before = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : { tables: [], relationships: [], expressions: [] };
  const tablesDir = path.join(mdl.def, 'tables');
  fs.mkdirSync(tablesDir, { recursive: true });

  // never overwrite a table the user made
  for (const t of mdl.tables) {
    const f = path.join(tablesDir, fileName(t.name));
    if (fs.existsSync(f) && !before.tables.includes(t.name) && !opts.replace)
      throw new Error(`table "${t.name}" already exists and was not made by this build. Pick another name, or pass { replace: true } after the user agrees.`);
  }
  // check every relationship points at a column that will exist
  const known = new Map();
  for (const t of mdl.tables) known.set(t.name, null);
  for (const r of mdl.relationships) for (const side of [r.from, r.to]) {
    const t = mdl.tables.find(x => x.name === side.table);
    if (t && !t.spec.dateTable && !t.columns.some(c => c.name === side.column)) throw new Error(`relationship column ${side.table}[${side.column}] is not in the table's columns`);
    if (!t && !fs.existsSync(path.join(tablesDir, fileName(side.table)))) throw new Error(`relationship table ${side.table} is not in the model`);
  }

  // tables: remove ones this build made before but no longer defines, then write the current ones
  const names = mdl.tables.map(t => t.name);
  for (const old of before.tables) if (!names.includes(old)) { const f = path.join(tablesDir, fileName(old)); if (fs.existsSync(f)) fs.rmSync(f); }
  for (const t of mdl.tables) fs.writeFileSync(path.join(tablesDir, fileName(t.name)), t.spec.dateTable ? dateTableText(t, mdl) : dataTableText(t, mdl));

  // relationships.tmdl: keep the user's, replace ours
  const relName = r => `gen_${r.from.table}_${r.from.column}_${r.to.table}`.replace(/[^A-Za-z0-9_]/g, '_');
  const relFile = path.join(mdl.def, 'relationships.tmdl');
  const ours = new Set([...before.relationships, ...mdl.relationships.map(relName)]);
  const keptRel = fs.existsSync(relFile) ? blocks(fs.readFileSync(relFile, 'utf8'), 'relationship').filter(b => !ours.has(b.name)) : [];
  const relText = mdl.relationships.map(r => [`relationship ${relName(r)}`,
    ...(r.active ? [] : ['\tisActive: false']), ...(r.both ? ['\tcrossFilteringBehavior: bothDirections'] : []),
    `\tfromColumn: ${colRef(r.from.table, r.from.column)}`, `\ttoColumn: ${colRef(r.to.table, r.to.column)}`].join('\n'));
  const relOut = [keptRel.map(b => b.lines.join('\n')).join('\n').trim(), ...relText].filter(Boolean).join('\n\n').trim();
  if (relOut) fs.writeFileSync(relFile, relOut + '\n'); else if (fs.existsSync(relFile)) fs.rmSync(relFile);

  // expressions.tmdl: keep the user's queries, replace our parameters
  const exFile = path.join(mdl.def, 'expressions.tmdl');
  const ourEx = new Set([...before.expressions, ...mdl.parameters.map(p => p.name)]);
  const keptEx = fs.existsSync(exFile) ? blocks(fs.readFileSync(exFile, 'utf8'), 'expression').filter(b => !ourEx.has(b.name)) : [];
  const exText = mdl.parameters.map(p => [`expression ${q(p.name)} = ${mString(p.value)} meta [IsParameterQuery=true, Type="Text", IsParameterQueryRequired=true]`,
    `\tlineageTag: ${tag('parameter', p.name)}`, '', '\tannotation PBI_ResultType = Text'].join('\n'));
  const exOut = [keptEx.map(b => b.lines.join('\n')).join('\n').trim(), ...exText].filter(Boolean).join('\n\n').trim();
  if (exOut) fs.writeFileSync(exFile, exOut + '\n'); else if (fs.existsSync(exFile)) fs.rmSync(exFile);

  // model.tmdl: one "ref table" line per table, ours added, removed ones dropped
  const modelFile = path.join(mdl.def, 'model.tmdl');
  let lines = fs.readFileSync(modelFile, 'utf8').split(/\r?\n/);
  const refName = l => l.replace(/^ref table /, '').trim().replace(/^'|'$/g, '').replace(/''/g, "'");
  lines = lines.filter(l => !(l.startsWith('ref table ') && before.tables.includes(refName(l)) && !names.includes(refName(l))));
  const have = new Set(lines.filter(l => l.startsWith('ref table ')).map(refName));
  const add = names.filter(n => !have.has(n)).map(n => `ref table ${q(n)}`);
  if (add.length) {
    let at = lines.map(l => l.startsWith('ref table ')).lastIndexOf(true);
    if (at < 0) at = lines.findIndex(l => l.startsWith('ref cultureInfo')) - 1;
    if (at < -1) at = lines.length - 1;
    const blankBefore = at >= 0 && !lines[at].startsWith('ref table ') && lines[at].trim() !== '';
    lines.splice(at + 1, 0, ...(blankBefore ? [''] : []), ...add, ...(lines[at + 1] && lines[at + 1].trim() ? [''] : []));
  }
  fs.writeFileSync(modelFile, lines.join('\n'));

  fs.writeFileSync(manifestPath, JSON.stringify({ tables: names, relationships: mdl.relationships.map(relName), expressions: mdl.parameters.map(p => p.name) }, null, 2));
  for (const t of mdl.tables) console.log(`${t.name}: ${t.spec.dateTable ? 'date table' : `${t.columns.length} columns`}, ${t.measures.length} measures`);
  console.log(`${mdl.relationships.length} relationships${mdl.parameters.length ? `, parameter ${mdl.parameters.map(p => p.name).join(', ')}` : ''}`);
  console.log('Next: open the .pbip in Power BI Desktop and Refresh.');
}

module.exports = { model, csv, excel, sql, m, dax, TYPES };
