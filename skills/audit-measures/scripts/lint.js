#!/usr/bin/env node
// Rule-based measure checks. Claude reads the output, then reviews each measure's logic itself
// (the rules catch patterns; only reading the DAX catches a measure that answers the wrong question).
//
// Usage: node lint.js <project folder | .pbip | X.SemanticModel> [--json findings.json]
'use strict';
const fs = require('fs');
const path = require('path');
const { scan, stripDax, daxRefs } = require(path.join(__dirname, '..', '..', 'pbi-core', 'scripts', 'scan.js'));

const TIME_INTEL = /\b(TOTALYTD|TOTALQTD|TOTALMTD|DATESYTD|DATESQTD|DATESMTD|SAMEPERIODLASTYEAR|DATEADD|PARALLELPERIOD|PREVIOUSMONTH|PREVIOUSYEAR|PREVIOUSQUARTER|NEXTMONTH|NEXTYEAR|DATESINPERIOD|DATESBETWEEN|OPENINGBALANCE\w*|CLOSINGBALANCE\w*)\s*\(/i;

function lintModel(model, reportsScanned) {
  const out = [];
  const add = (severity, m, rule, detail, fix) => out.push({ severity, table: m.table, measure: m.name, rule, detail, fix });
  const all = model.tables.flatMap(t => t.measures);
  const tableNames = new Set(model.tables.map(t => t.name.toLowerCase()));

  // which measures other DAX objects reference
  const referenced = new Map();
  const note = (name, by) => { const k = name.toLowerCase(); if (!referenced.has(k)) referenced.set(k, []); referenced.get(k).push(by); };
  for (const t of model.tables) {
    for (const m of t.measures) for (const r of m.refs.measures) if (r.toLowerCase() !== m.name.toLowerCase()) note(r, `measure [${m.name}]`);
    for (const c of t.columns) if (c.refs) for (const r of c.refs.measures) note(r, `column ${t.name}[${c.name}]`);
    for (const it of t.calculationItems) for (const r of it.refs.measures) note(r, `calculation item ${it.name}`);
  }
  for (const r of model.roles) for (const f of r.filters) for (const x of f.refs.measures) note(x, `role ${r.name}`);

  // duplicates by normalised expression (comments and spacing ignored, string literals kept)
  const dupKey = e => e.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])(\/\/|--)[^\n]*/g, '$1').replace(/\s+/g, '').toLowerCase();
  const byExpr = new Map();
  for (const m of all) {
    const k = dupKey(m.expression);
    if (k.length < 8) continue;
    if (!byExpr.has(k)) byExpr.set(k, []);
    byExpr.get(k).push(m);
  }
  const names = new Map();
  for (const m of all) { const k = m.name.trim().toLowerCase(); names.set(k, (names.get(k) || 0) + 1); }

  for (const m of all) {
    const code = stripDax(m.expression);
    const usedBy = m.usedBy || [];
    const refBy = referenced.get(m.name.toLowerCase()) || [];

    if (!m.expression.trim()) add('error', m, 'empty', 'The measure has no expression.', 'Delete it or write the calculation.');
    for (const u of m.refs.unresolved) {
      const qualified = u.startsWith("'");
      add(qualified ? 'error' : 'warn', m, 'broken-reference',
        `${u} is not a column or measure in the model${qualified && !tableNames.has(u.slice(1, u.indexOf("'", 1)).toLowerCase()) ? ' (the table does not exist)' : ''}.`,
        qualified ? 'Point it at the right table/column, or delete the measure if it is left over.' : 'If this is a column of a virtual table (ADDCOLUMNS, SUMMARIZE, a variable) it is fine; otherwise fix the name.');
    }
    const open = (code.match(/\(/g) || []).length, close = (code.match(/\)/g) || []).length;
    if (open !== close) add('error', m, 'unbalanced-brackets', `${open} "(" vs ${close} ")".`, 'Fix the bracket nesting.');

    if (!usedBy.length && !refBy.length) add(m.isHidden ? 'info' : 'warn', m, 'unused',
      `Not used by any visual or filter in ${reportsScanned.length ? reportsScanned.join(', ') : 'any report found here'}, and no other measure uses it.`,
      'Delete after confirming no other report (for example a published thin report) uses it.');

    const dup = byExpr.get(dupKey(m.expression)) || [];
    if (dup.length > 1 && dup[0] === m) add('warn', m, 'duplicate', `Same calculation as ${dup.slice(1).map(d => `[${d.name}]`).join(', ')}.`, 'Keep one, point visuals and measures at it.');
    if (names.get(m.name.trim().toLowerCase()) > 1) add('error', m, 'duplicate-name', 'Another measure has the same name (names are case-insensitive).', 'Rename one.');
    if (m.name !== m.name.trim()) add('warn', m, 'name-spaces', 'The name starts or ends with a space.', 'Trim the name.');

    if (/[^/*]\/[^/*]/.test(code.replace(/\s+/g, ' ')) && !/\bDIVIDE\s*\(/i.test(code))
      add('warn', m, 'divide-operator', 'Uses "/" to divide: a zero or blank denominator gives an error or infinity.', 'Use DIVIDE(numerator, denominator).');
    if (/\b(IFERROR|ISERROR)\s*\(/i.test(code)) add('warn', m, 'iferror', 'IFERROR / ISERROR hides real errors and is slow.', 'Remove the error case at its source (DIVIDE, COALESCE, ISBLANK).');
    for (const hit of code.matchAll(/\bFILTER\s*\(\s*('(?:[^']|'')+'|[A-Za-z_]\w*)\s*,/gi)) {
      const t = hit[1].replace(/^'|'$/g, '').replace(/''/g, "'");
      if (tableNames.has(t.toLowerCase()) && /\bCALCULATE(TABLE)?\s*\(/i.test(code))
        add('warn', m, 'filter-whole-table', `CALCULATE filters the whole table '${t}' with FILTER.`, `Filter the column instead, e.g. CALCULATE([x], '${t}'[Col] = "A"), or KEEPFILTERS. Faster, and does not drop other filters.`);
    }
    if (/\bSUMX\s*\(\s*FILTER\s*\(/i.test(code)) add('info', m, 'sumx-filter', 'SUMX over FILTER of a table.', 'Often CALCULATE(SUM(...), <column filter>) is simpler and faster.');
    if (/\b(TODAY|NOW|UTCNOW|UTCTODAY)\s*\(\s*\)/i.test(code))
      add('info', m, 'today', 'Uses TODAY()/NOW(): in the Power BI service this is UTC, so near midnight it can be a day off from Desktop.', 'Fine for most reports; for exact day cut-offs use a refresh-date value from the data.');
    if (/\bDATE\s*\(\s*(19|20)\d\d\s*,/i.test(code) || /"(19|20)\d\d-\d\d-\d\d"/.test(m.expression))
      add('warn', m, 'hardcoded-date', 'Contains a fixed date, so the number silently goes stale.', 'Drive it from a date table, a parameter or TODAY().');
    if (TIME_INTEL.test(code) && !model.dateTables.length)
      add('warn', m, 'time-intel-no-date-table', 'Uses time-intelligence functions but no table is marked as a date table.', 'Mark the calendar table as a date table (Table tools > Mark as date table).');
    if (!m.formatString && !m.formatStringExpression && !/^\s*"/.test(m.expression))
      add('info', m, 'no-format', 'No format string: values show with raw decimals.', /%|pct|percent|rate|share|ratio/i.test(m.name) ? 'Set format 0.0%.' : 'Set a format such as #,0 or £#,0.');
    else if (/%|pct|percent|share/i.test(m.name) && m.formatString && !/%/.test(m.formatString))
      add('warn', m, 'percent-format', `Name says percent but the format is ${m.formatString}.`, 'Use a % format string.');
    if (!m.description && (usedBy.length || refBy.length)) add('info', m, 'no-description', 'No description: the hover help in Desktop and the service is empty.', 'Add a one-line description of what it counts and any exclusions.');
    const host = model.tables.find(t => t.name === m.table);
    const bareCols = daxRefs(m.expression).unqualified.filter(n => !all.some(x => x.name.toLowerCase() === n.toLowerCase())
      && host && host.columns.some(c => c.name.toLowerCase() === n.toLowerCase()));
    if (bareCols.length) add('info', m, 'unqualified-column', `Refers to column${bareCols.length > 1 ? 's' : ''} ${bareCols.map(n => `[${n}]`).join(', ')} without the table name.`,
      'Write columns as Table[Column] and measures as [Measure], so readers can tell them apart.');
    for (const q of (code.match(/('(?:[^']|'')+'|[A-Za-z_]\w*)\s*\[([^\]]+)\]/g) || [])) {
      const nm = q.replace(/^.*\[/, '').replace(/\]$/, '');
      if (all.some(x => x.name.toLowerCase() === nm.toLowerCase()) && !model.tables.some(t => t.columns.some(c => c.name.toLowerCase() === nm.toLowerCase()))) {
        add('info', m, 'qualified-measure', `${q} names a measure with a table in front.`, `Write it as [${nm}]: measures can move between tables, column references cannot.`); break;
      }
    }
    const lines = m.expression.split('\n').length;
    if (lines > 60) add('info', m, 'long', `${lines} lines long.`, 'Split into helper measures or variables if it is hard to follow.');
  }

  // model-wide
  if (model.autoDateTime || model.tables.some(t => t.kind === 'auto date table'))
    out.push({ severity: 'info', table: '', measure: '(model)', rule: 'auto-date-time', detail: 'Auto date/time is on: Desktop adds a hidden date table for every date column, which bloats the model.',
      fix: 'Turn it off (File > Options > Current file > Data load) once a proper date table exists.' });
  return out;
}

// implicit measures: visuals summing a column directly
function implicitUse(result) {
  const out = [];
  for (const p of result.projects) if (p.report) for (const pg of p.report.pages) for (const v of pg.visuals) for (const f of v.fields)
    if (f.kind === 'implicit') out.push({ severity: 'info', table: f.table, measure: `(column ${f.name})`, rule: 'implicit-measure',
      detail: `Visual "${v.title || v.type}" on page "${pg.displayName}" summarises ${f.table}[${f.name}] directly.`, fix: 'Create an explicit measure and use it, so the logic lives in one place.' });
  const seen = new Set();
  return out.filter(x => { const k = x.detail; if (seen.has(k)) return false; seen.add(k); return true; });
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const target = args.find(a => !a.startsWith('--')) || '.';
  const result = scan(target);
  const models = [...new Set(result.projects.map(p => p.model).filter(m => m && m.tables))];
  if (!models.length) { console.log('No readable semantic model found (a .pbix model needs Desktop + the powerbi-modeling MCP).'); process.exit(2); }
  const report = models.map(m => ({ model: m.name, path: m.path, measures: m.tables.reduce((n, t) => n + t.measures.length, 0), reportsScanned: m.reportsScanned || [],
    findings: lintModel(m, m.reportsScanned || []) }));
  report[0].findings.push(...implicitUse(result));
  const j = args.indexOf('--json');
  if (j >= 0) fs.writeFileSync(args[j + 1] || 'measure-findings.json', JSON.stringify(report, null, 2));
  const order = { error: 0, warn: 1, info: 2 };
  for (const r of report) {
    const c = s => r.findings.filter(f => f.severity === s).length;
    console.log(`MODEL ${r.model}: ${r.measures} measures, reports scanned: ${r.reportsScanned.join(', ') || 'none'}`);
    console.log(`  ${c('error')} errors, ${c('warn')} warnings, ${c('info')} notes`);
    for (const f of r.findings.sort((a, b) => order[a.severity] - order[b.severity] || a.rule.localeCompare(b.rule)))
      console.log(`  ${f.severity.toUpperCase().padEnd(5)} ${f.rule.padEnd(24)} ${f.table ? `${f.table}` : ''}${f.measure.startsWith('(') ? ` ${f.measure}` : `[${f.measure}]`}: ${f.detail}`);
  }
}
module.exports = { lintModel };
