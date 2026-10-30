#!/usr/bin/env node
// Inventory of Power BI work in a folder: projects (.pbip), loose .pbix files, file formats,
// semantic model (tables, columns, measures, relationships, sources), report pages and visuals,
// which model fields each visual uses, and which DAX objects each expression references.
//
// Usage: node scan.js <folder | file.pbip | file.pbix | X.SemanticModel | X.Report> [--detail] [--json out.json]
//   default   short summary per project
//   --detail  every table, column, measure, page and visual (what Claude reads before writing anything)
//   --json    full inventory as JSON (input for check.js and the audit-measures lint)
// Also usable as a module: require('./scan.js').scan(path)
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { execSync } = require('child_process');

const SKIP_DIRS = new Set(['node_modules', '.git', '.pbi', '.pbi-backups', '$RECYCLE.BIN']);

// ---------- small helpers ----------
const readText = f => fs.readFileSync(f, 'utf8').replace(/^﻿/, '');
const readJson = f => JSON.parse(readText(f));
const exists = f => { try { fs.accessSync(f); return true; } catch { return false; } };
const isDir = f => { try { return fs.statSync(f).isDirectory(); } catch { return false; } };
const indentOf = line => { let i = 0; while (line[i] === '\t') i++; return i; };

// TMDL names: 'quoted name' with '' escaping, or a bare word
function splitName(s) {
  s = s.trim();
  let name, rest;
  if (s.startsWith("'")) {
    let i = 1;
    while (i < s.length) {
      if (s[i] === "'") { if (s[i + 1] === "'") { i += 2; continue; } break; }
      i++;
    }
    name = s.slice(1, i).replace(/''/g, "'");
    rest = s.slice(i + 1);
  } else {
    const m = s.match(/^([^\s=.]+)(.*)$/s);
    name = m ? m[1] : s; rest = m ? m[2] : '';
  }
  return { name, rest };
}
function splitDecl(s) {
  const { name, rest } = splitName(s);
  const r = rest.trim();
  return r.startsWith('=') ? { name, hasExpr: true, expr: r.slice(1).trim() } : { name, hasExpr: false };
}
// 'Customer Orders'.CustomerID -> { table, column }
function splitColumnRef(s) {
  const a = splitName(s);
  const b = splitName(a.rest.replace(/^\./, ''));
  return { table: a.name, column: b.name };
}
function dedent(lines) {
  const body = lines.filter(l => l.trim());
  const min = body.length ? Math.min(...body.map(indentOf)) : 0;
  return lines.map(l => l.slice(Math.min(min, indentOf(l)))).join('\n').trim();
}

// ---------- TMDL ----------
// One parser for every TMDL file: an object declared at indent d has properties at d+1
// and multi-line expressions at d+2 or deeper (or fenced with ```).
const OBJECT_KINDS = new Set(['table', 'measure', 'column', 'partition', 'hierarchy', 'calculationGroup', 'calculationItem',
  'relationship', 'expression', 'role', 'tablePermission', 'perspective', 'model', 'database', 'dataSource', 'level', 'cultureInfo']);

function parseTmdl(text) {
  const lines = text.split(/\r?\n/);
  const root = { kind: 'root', children: [], props: {} };
  const stack = [{ obj: root, indent: -1 }];
  let desc = [];
  let expr = null; // { target, key, minIndent, fence, lines }

  const finishExpr = () => {
    if (!expr) return;
    const first = expr.first ? [expr.first] : [];
    expr.target[expr.key] = [...first, dedent(expr.lines)].filter(Boolean).join('\n').trim();
    expr = null;
  };

  for (const line of lines) {
    if (expr) {
      if (expr.fence) {
        if (line.trim() === '```') { finishExpr(); continue; }
        expr.lines.push(line); continue;
      }
      if (!line.trim() || indentOf(line) >= expr.minIndent) { expr.lines.push(line); continue; }
      finishExpr();
    }
    if (!line.trim()) continue;
    const ind = indentOf(line);
    const s = line.slice(ind);
    if (s.startsWith('///')) { desc.push(s.slice(3).trim()); continue; }

    while (stack.length > 1 && stack[stack.length - 1].indent >= ind) stack.pop();
    const parent = stack[stack.length - 1].obj;

    const kw = s.match(/^([A-Za-z]+)\b\s*(.*)$/s);
    if (!kw) { desc = []; continue; }
    const [, word, after] = kw;

    if (word === 'ref') { (parent.refs = parent.refs || []).push(after); desc = []; continue; }
    if (word === 'annotation' || word === 'extendedProperty' || word === 'changedProperty') {
      // keep the first line of an annotation's value, skip any value lines below it
      const a = splitDecl(after);
      if (word === 'annotation' && a.hasExpr) (parent.annotations = parent.annotations || {})[a.name] = a.expr;
      expr = { target: {}, key: 'x', minIndent: ind + 1, fence: false, lines: [] };
      desc = []; continue;
    }
    if (OBJECT_KINDS.has(word) && !/^\s*:/.test(after)) {
      const d = after.trim() ? splitDecl(after) : { name: '', hasExpr: false };
      const obj = { kind: word, name: d.name, props: {}, children: [] };
      if (desc.length) obj.description = desc.join('\n');
      desc = [];
      parent.children.push(obj);
      stack.push({ obj, indent: ind });
      if (d.hasExpr) {
        if (word === 'partition') obj.partitionType = d.expr;
        else if (d.expr === '```') expr = { target: obj, key: 'expression', minIndent: 0, fence: true, lines: [] };
        else expr = { target: obj, key: 'expression', first: d.expr, minIndent: ind + 2, fence: false, lines: [] };
      }
      continue;
    }
    // property of the parent: "key: value", "key = expression" or a bare flag
    desc = [];
    const pm = after.match(/^(:|=)\s*(.*)$/s);
    if (!pm) { parent.props[word] = true; continue; }
    if (pm[1] === ':') { parent.props[word] = pm[2].trim(); continue; }
    const v = pm[2].trim();
    if (v === '```') expr = { target: parent.props, key: word, minIndent: 0, fence: true, lines: [] };
    else expr = { target: parent.props, key: word, first: v, minIndent: ind + 1, fence: false, lines: [] };
  }
  finishExpr();
  return root;
}

const SOURCE_PATTERNS = [
  ['SQL Server', /Sql\.Databases?\(\s*"([^"]+)"(?:\s*,\s*"([^"]+)")?/g],
  ['ODBC', /Odbc\.(?:DataSource|Query)\(\s*"([^"]+)"/g],
  ['Oracle', /Oracle\.Database\(\s*"([^"]+)"/g],
  ['Excel / CSV file', /File\.Contents\(\s*"([^"]+)"/g],
  ['Folder', /Folder\.(?:Files|Contents)\(\s*"([^"]+)"/g],
  ['SharePoint', /SharePoint\.(?:Files|Contents|Tables)\(\s*"([^"]+)"/g],
  ['Web / API', /Web\.Contents\(\s*"([^"]+)"/g],
  ['Dataflow', /(PowerPlatform\.Dataflows|PowerBI\.Dataflows)\(/g],
  ['Fabric lakehouse / warehouse', /(Lakehouse\.Contents|Fabric\.Warehouse|Sql\.Database\("[^"]*fabric[^"]*")/g],
  ['Entered data', /Table\.FromRows\(Json\.Document\(Binary\.Decompress()/g],
  ['Analysis Services', /AnalysisServices\.Databases?\(\s*"([^"]+)"/g],
  ['Snowflake', /Snowflake\.Databases\(\s*"([^"]+)"/g],
  ['Databricks', /Databricks\.(?:Catalogs|Query)\(\s*"([^"]+)"/g],
];
function detectSources(m) {
  if (!m) return [];
  const out = [];
  for (const [kind, re] of SOURCE_PATTERNS) {
    for (const hit of m.matchAll(re)) out.push({ kind, target: [hit[1], hit[2]].filter(Boolean).join(' / ') });
  }
  if (!out.length && /#"[^"]+"|^\s*let\b/.test(m)) {
    const refs = [...m.matchAll(/Source\s*=\s*#?"?([A-Za-z_][\w ]*)"?\s*,/g)].map(x => x[1]);
    if (refs.length) out.push({ kind: 'Other query', target: refs[0] });
  }
  return out;
}

function modelFromTmdl(defDir) {
  const model = { format: 'TMDL', tables: [], relationships: [], expressions: [], roles: [], dateTables: [] };
  const files = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== 'cultures') walk(f); } else if (e.name.endsWith('.tmdl')) files.push(f);
  } };
  walk(defDir);
  for (const f of files) {
    const root = parseTmdl(readText(f));
    for (const o of root.children) {
      if (o.kind === 'table') model.tables.push(tableFromTmdl(o));
      else if (o.kind === 'relationship') {
        const from = splitColumnRef(o.props.fromColumn || ''), to = splitColumnRef(o.props.toColumn || '');
        model.relationships.push({ name: o.name, fromTable: from.table, fromColumn: from.column, toTable: to.table, toColumn: to.column,
          active: o.props.isActive !== 'false', crossFilter: o.props.crossFilteringBehavior === 'bothDirections' ? 'both' : 'single',
          fromCardinality: o.props.fromCardinality || 'many', toCardinality: o.props.toCardinality || 'one' });
      } else if (o.kind === 'expression') {
        model.expressions.push({ name: o.name, expression: o.expression || '', isParameter: /IsParameterQuery\s*=\s*true/i.test(o.expression || ''),
          sources: detectSources(o.expression) });
      } else if (o.kind === 'role') {
        model.roles.push({ name: o.name, filters: o.children.filter(c => c.kind === 'tablePermission').map(c => ({ table: c.name, expression: c.expression || '' })) });
      } else if (o.kind === 'model') {
        model.culture = o.props.culture;
        model.autoDateTime = (o.annotations || {}).__PBI_TimeIntelligenceEnabled === '1';
      } else if (o.kind === 'database') {
        model.compatibilityLevel = o.props.compatibilityLevel;
      }
    }
  }
  model.dateTables = model.tables.filter(t => t.dataCategory === 'Time').map(t => t.name);
  return model;
}

function tableFromTmdl(o) {
  const t = { name: o.name, description: o.description, isHidden: !!o.props.isHidden, dataCategory: o.props.dataCategory,
    columns: [], measures: [], partitions: [], hierarchies: [], calculationItems: [] };
  for (const c of o.children) {
    if (c.kind === 'measure') t.measures.push({ name: c.name, table: o.name, expression: c.expression || '', formatString: c.props.formatString,
      formatStringExpression: c.props.formatStringDefinition, displayFolder: c.props.displayFolder, description: c.description, isHidden: !!c.props.isHidden });
    else if (c.kind === 'column') t.columns.push({ name: c.name, table: o.name, dataType: c.props.dataType, isHidden: !!c.props.isHidden,
      expression: c.expression, calculated: c.expression !== undefined, sourceColumn: c.props.sourceColumn, formatString: c.props.formatString,
      summarizeBy: c.props.summarizeBy, sortByColumn: c.props.sortByColumn && splitName(c.props.sortByColumn).name, description: c.description });
    else if (c.kind === 'partition') t.partitions.push({ name: c.name, type: c.partitionType, mode: c.props.mode, source: c.props.source || '',
      sources: c.partitionType === 'm' ? detectSources(c.props.source) : [] });
    else if (c.kind === 'hierarchy') t.hierarchies.push({ name: c.name, levels: c.children.filter(l => l.kind === 'level').map(l => l.props.column) });
    else if (c.kind === 'calculationGroup') {
      for (const it of c.children.filter(x => x.kind === 'calculationItem')) t.calculationItems.push({ name: it.name, expression: it.expression || '' });
    }
  }
  t.kind = t.calculationItems.length ? 'calculation group'
    : t.partitions.some(p => p.type === 'calculated') ? 'calculated table'
    : /^(LocalDateTable|DateTableTemplate)_/.test(t.name) ? 'auto date table'
    : t.columns.length === 0 || t.columns.every(c => c.isHidden && /^(Column\d*|Value)$/.test(c.name)) && t.measures.length ? 'measures table'
    : 'data table';
  return t;
}

// ---------- TMSL (model.bim) ----------
function modelFromBim(file) {
  const j = readJson(file).model || {};
  const joinExpr = e => Array.isArray(e) ? e.join('\n') : (e || '');
  const model = { format: 'TMSL (model.bim)', tables: [], relationships: [], expressions: [], roles: [], culture: j.culture };
  for (const tb of j.tables || []) {
    const t = { name: tb.name, description: tb.description, isHidden: !!tb.isHidden, dataCategory: tb.dataCategory, columns: [], measures: [],
      partitions: [], hierarchies: [], calculationItems: [] };
    for (const c of tb.columns || []) {
      if (c.type === 'rowNumber') continue;
      t.columns.push({ name: c.name, table: tb.name, dataType: c.dataType, isHidden: !!c.isHidden, expression: c.type === 'calculated' ? joinExpr(c.expression) : undefined,
        calculated: c.type === 'calculated', sourceColumn: c.sourceColumn, formatString: c.formatString, summarizeBy: c.summarizeBy, sortByColumn: c.sortByColumn, description: c.description });
    }
    for (const m of tb.measures || []) t.measures.push({ name: m.name, table: tb.name, expression: joinExpr(m.expression), formatString: m.formatString,
      displayFolder: m.displayFolder, description: Array.isArray(m.description) ? m.description.join('\n') : m.description, isHidden: !!m.isHidden });
    for (const p of tb.partitions || []) {
      const src = joinExpr(p.source && p.source.expression);
      t.partitions.push({ name: p.name, type: p.source && p.source.type, mode: p.mode, source: src, sources: p.source && p.source.type === 'm' ? detectSources(src) : [] });
    }
    for (const it of (tb.calculationGroup && tb.calculationGroup.calculationItems) || []) t.calculationItems.push({ name: it.name, expression: joinExpr(it.expression) });
    t.kind = t.calculationItems.length ? 'calculation group' : t.partitions.some(p => p.type === 'calculated') ? 'calculated table'
      : /^(LocalDateTable|DateTableTemplate)_/.test(t.name) ? 'auto date table' : 'data table';
    model.tables.push(t);
  }
  for (const r of j.relationships || []) model.relationships.push({ name: r.name, fromTable: r.fromTable, fromColumn: r.fromColumn, toTable: r.toTable,
    toColumn: r.toColumn, active: r.isActive !== false, crossFilter: r.crossFilteringBehavior === 'bothDirections' ? 'both' : 'single',
    fromCardinality: r.fromCardinality || 'many', toCardinality: r.toCardinality || 'one' });
  for (const e of j.expressions || []) model.expressions.push({ name: e.name, expression: joinExpr(e.expression), sources: detectSources(joinExpr(e.expression)) });
  model.dateTables = model.tables.filter(t => t.dataCategory === 'Time').map(t => t.name);
  return model;
}

// ---------- DAX references ----------
function stripDax(expr) {
  // remove comments and string literals, keep 'quoted table names'
  return (expr || '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/(\/\/|--)[^\n]*/g, ' ');
}
function daxRefs(expr) {
  const s = stripDax(expr);
  const qualified = [], unqualified = [];
  const re = /('(?:[^']|'')+'|[A-Za-z_][\w.]*)?\s*\[([^\]]+)\]/g;
  let m;
  while ((m = re.exec(s))) {
    const name = m[2].replace(/\]\]/g, ']');
    if (m[1]) {
      const table = m[1].startsWith("'") ? m[1].slice(1, -1).replace(/''/g, "'") : m[1];
      qualified.push({ table, name });
    } else unqualified.push(name);
  }
  return { qualified, unqualified };
}
// resolve every expression's references against the model
function buildDeps(model) {
  const tables = new Map(model.tables.map(t => [t.name.toLowerCase(), t]));
  const measures = new Map();
  for (const t of model.tables) for (const m of t.measures) measures.set(m.name.toLowerCase(), m);
  const resolve = (expr, hostTable) => {
    const { qualified, unqualified } = daxRefs(expr);
    const out = { measures: [], columns: [], unresolved: [] };
    for (const q of qualified) {
      const t = tables.get(q.table.toLowerCase());
      if (!t) { out.unresolved.push(`'${q.table}'[${q.name}]`); continue; }
      const c = t.columns.find(c => c.name.toLowerCase() === q.name.toLowerCase());
      const mm = t.measures.find(x => x.name.toLowerCase() === q.name.toLowerCase());
      if (c) out.columns.push(`${t.name}[${c.name}]`);
      else if (mm) out.measures.push(mm.name);
      else out.unresolved.push(`'${q.table}'[${q.name}]`);
    }
    for (const n of unqualified) {
      const mm = measures.get(n.toLowerCase());
      if (mm) { out.measures.push(mm.name); continue; }
      const host = hostTable && tables.get(hostTable.toLowerCase());
      const c = host && host.columns.find(c => c.name.toLowerCase() === n.toLowerCase());
      if (c) out.columns.push(`${host.name}[${c.name}]`);
      else out.unresolved.push(`[${n}]`);
    }
    for (const k of Object.keys(out)) out[k] = [...new Set(out[k])];
    return out;
  };
  for (const t of model.tables) {
    for (const m of t.measures) m.refs = resolve(m.expression, t.name);
    for (const c of t.columns) if (c.calculated) c.refs = resolve(c.expression, t.name);
    for (const p of t.partitions) if (p.type === 'calculated') p.refs = resolve(p.source, t.name);
    for (const it of t.calculationItems) it.refs = resolve(it.expression, t.name);
  }
  for (const r of model.roles) for (const f of r.filters) f.refs = resolve(f.expression, f.table);
}

// ---------- report field references ----------
// Walk any visual / filter JSON and collect { table, name, kind } for every field it binds,
// resolving query aliases (From: [{ Name, Entity }]) on the way.
function collectFields(node, aliases = {}, out = []) {
  if (Array.isArray(node)) { for (const x of node) collectFields(x, aliases, out); return out; }
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node.From)) {
    aliases = { ...aliases };
    for (const f of node.From) if (f && f.Name && f.Entity) aliases[f.Name] = f.Entity;
  }
  const entityOf = e => {
    const sr = e && e.SourceRef;
    return sr ? (sr.Entity || aliases[sr.Source]) : undefined;
  };
  for (const kind of ['Column', 'Measure']) {
    const f = node[kind];
    if (f && f.Property !== undefined && f.Expression) {
      const table = entityOf(f.Expression);
      if (table) out.push({ table, name: f.Property, kind: kind.toLowerCase() });
    }
  }
  if (node.PropertyVariationSource) {
    const v = node.PropertyVariationSource;
    const table = entityOf(v.Expression);
    if (table) out.push({ table, name: v.Property, kind: 'column' });
  }
  if (node.Aggregation && node.Aggregation.Expression && node.Aggregation.Expression.Column) {
    const c = node.Aggregation.Expression.Column;
    const table = entityOf(c.Expression);
    if (table) out.push({ table, name: c.Property, kind: 'implicit', func: node.Aggregation.Function });
  }
  for (const [k, v] of Object.entries(node)) if (k !== 'From' && v && typeof v === 'object') collectFields(v, aliases, out);
  if (Array.isArray(node.From)) for (const f of node.From) if (f && f.Expression) collectFields(f.Expression, aliases, out);
  return out;
}
const uniqFields = list => {
  const seen = new Set();
  return list.filter(f => { const k = `${f.kind}|${f.table}|${f.name}`; if (seen.has(k)) return false; seen.add(k); return true; });
};
const literal = x => {
  const v = x && x.expr && x.expr.Literal && x.expr.Literal.Value;
  return typeof v === 'string' ? v.replace(/^'|'$/g, '').replace(/''/g, "'") : undefined;
};
function titleOf(objs) {
  const t = objs && objs.title && objs.title[0] && objs.title[0].properties;
  return t && t.show && literal(t.show) === 'false' ? undefined : t && literal(t.text);
}
function textOf(visual) {
  const g = visual && visual.objects && visual.objects.general;
  const paras = g && g[0] && g[0].properties && g[0].properties.paragraphs;
  return Array.isArray(paras) ? paras.map(p => (p.textRuns || []).map(r => r.value).join('')).join(' / ').slice(0, 200) : undefined;
}
function filterList(filterConfig) {
  const fs_ = (filterConfig && filterConfig.filters) || [];
  return fs_.map(f => ({ type: f.type, howCreated: f.howCreated, hidden: !!f.isHiddenInViewMode, fields: uniqFields(collectFields(f.field ? [f.field, f.filter] : f.filter)),
    hasCondition: !!f.filter }));
}

// src: { has(rel), json(rel), dirs(rel) } over the definition/ folder, on disk or inside a .pbix
const dirSource = defDir => ({
  has: rel => exists(path.join(defDir, rel)),
  json: rel => readJson(path.join(defDir, rel)),
  dirs: rel => { const d = path.join(defDir, rel); return isDir(d) ? fs.readdirSync(d).filter(x => isDir(path.join(d, x))) : []; },
});
function reportFromPbir(src, format = 'PBIR') {
  const report = { format, pages: [], filters: [] };
  if (src.has('report.json')) {
    const r = src.json('report.json');
    report.filters = filterList(r.filterConfig);
    report.theme = (r.themeCollection && (r.themeCollection.customTheme || r.themeCollection.baseTheme) || {}).name;
  }
  let order = [];
  if (src.has('pages/pages.json')) { const j = src.json('pages/pages.json'); order = j.pageOrder || []; report.activePage = j.activePageName; }
  const dirs = src.dirs('pages');
  dirs.sort((a, b) => (order.indexOf(a) + 1 || 1e9) - (order.indexOf(b) + 1 || 1e9));
  for (const d of dirs) {
    if (!src.has(`pages/${d}/page.json`)) continue;
    const p = src.json(`pages/${d}/page.json`);
    const page = { name: p.name, folder: d, displayName: p.displayName, hidden: p.visibility === 'HiddenInViewMode', type: p.type || 'Standard',
      width: p.width, height: p.height, filters: filterList(p.filterConfig), visuals: [] };
    for (const v of src.dirs(`pages/${d}/visuals`)) {
      if (!src.has(`pages/${d}/visuals/${v}/visual.json`)) continue;
      const j = src.json(`pages/${d}/visuals/${v}/visual.json`);
      const vis = j.visual || {};
      const roles = {};
      for (const [role, q] of Object.entries((vis.query && vis.query.queryState) || {})) {
        roles[role] = (q.projections || []).map(pr => ({ ...uniqFields(collectFields(pr.field))[0], displayName: pr.displayName }));
      }
      page.visuals.push({ name: j.name, folder: v, type: vis.visualType || (j.visualGroup ? 'group' : 'unknown'), title: titleOf(vis.visualContainerObjects) || textOf(vis),
        position: j.position, hidden: !!j.isHidden, roles, filters: filterList(j.filterConfig), fields: uniqFields(collectFields(j)) });
    }
    page.visuals.sort((a, b) => ((a.position && a.position.y) || 0) - ((b.position && b.position.y) || 0) || ((a.position && a.position.x) || 0) - ((b.position && b.position.x) || 0));
    report.pages.push(page);
  }
  return report;
}

// PBIR-Legacy (report.json with sections) and the Report/Layout file inside a .pbix share one shape
function reportFromLegacy(layout, format) {
  const parse = s => { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return undefined; } };
  const report = { format, pages: [], filters: filterList({ filters: parse(layout.filters) || [] }) };
  const cfg = parse(layout.config) || {};
  report.theme = cfg.themeCollection && cfg.themeCollection.baseTheme && cfg.themeCollection.baseTheme.name;
  for (const s of layout.sections || []) {
    const page = { name: s.name, displayName: s.displayName, hidden: s.visibility === 1, width: s.width, height: s.height,
      filters: filterList({ filters: parse(s.filters) || [] }), visuals: [] };
    const scfg = parse(s.config) || {};
    if (scfg.type === 2) page.type = 'Drillthrough'; else page.type = 'Standard';
    for (const vc of s.visualContainers || []) {
      const c = parse(vc.config) || {};
      const sv = c.singleVisual || {};
      const roles = {};
      const select = (sv.prototypeQuery && sv.prototypeQuery.Select) || [];
      const byRef = {};
      for (const sel of select) { const f = uniqFields(collectFields(sel, Object.fromEntries((sv.prototypeQuery.From || []).map(x => [x.Name, x.Entity]))))[0]; if (f) byRef[sel.Name] = f; }
      for (const [role, list] of Object.entries(sv.projections || {})) roles[role] = list.map(pr => byRef[pr.queryRef] || { queryRef: pr.queryRef });
      const title = titleOf(sv.vcObjects) || (sv.objects && sv.objects.general && textOf(sv));
      page.visuals.push({ name: c.name, type: sv.visualType || (c.singleVisualGroup ? 'group' : 'unknown'), title,
        position: { x: vc.x, y: vc.y, width: vc.width, height: vc.height }, roles, filters: filterList({ filters: parse(vc.filters) || [] }),
        fields: uniqFields(collectFields([c, parse(vc.filters) || []])) });
    }
    page.visuals.sort((a, b) => (a.position.y - b.position.y) || (a.position.x - b.position.x));
    report.pages.push(page);
  }
  return report;
}

// ---------- .pbix (zip) ----------
function zipEntries(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const tailLen = Math.min(size, 70000);
    const tail = Buffer.alloc(tailLen);
    fs.readSync(fd, tail, 0, tailLen, size - tailLen);
    let eocd = -1;
    for (let i = tailLen - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
    if (eocd < 0) throw new Error('not a zip file');
    const cdSize = tail.readUInt32LE(eocd + 12), cdOffset = tail.readUInt32LE(eocd + 16);
    const cd = Buffer.alloc(cdSize);
    fs.readSync(fd, cd, 0, cdSize, cdOffset);
    const entries = {};
    for (let p = 0; p + 46 <= cd.length && cd.readUInt32LE(p) === 0x02014b50;) {
      const method = cd.readUInt16LE(p + 10), csize = cd.readUInt32LE(p + 20), usize = cd.readUInt32LE(p + 24);
      const nlen = cd.readUInt16LE(p + 28), xlen = cd.readUInt16LE(p + 30), clen = cd.readUInt16LE(p + 32), off = cd.readUInt32LE(p + 42);
      const name = cd.slice(p + 46, p + 46 + nlen).toString('utf8');
      entries[name] = { method, csize, usize, off };
      p += 46 + nlen + xlen + clen;
    }
    const read = name => {
      const e = entries[name];
      if (!e) return undefined;
      const lh = Buffer.alloc(30);
      fs.readSync(fd, lh, 0, 30, e.off);
      const start = e.off + 30 + lh.readUInt16LE(26) + lh.readUInt16LE(28);
      const data = Buffer.alloc(e.csize);
      fs.readSync(fd, data, 0, e.csize, start);
      return e.method === 8 ? zlib.inflateRawSync(data) : data;
    };
    return { names: Object.keys(entries), read, close: () => {} };
  } catch (e) { fs.closeSync(fd); throw e; }
}
const utf16 = b => (b[0] === 0xff && b[1] === 0xfe ? b.slice(2) : b).toString('utf16le').replace(/^﻿/, '');

function scanPbix(file) {
  const out = { kind: 'pbix', path: file, name: path.basename(file, '.pbix') };
  // a .pbip saved next to it puts visual.json files <folder> + <name> + 87 characters deep: Windows stops at 260
  out.pbipLongestPath = path.dirname(file).length + out.name.length + 87;
  try {
    const z = zipEntries(file);
    out.hasImportedModel = z.names.includes('DataModel');
    const conn = z.read('Connections');
    if (conn) {
      try {
        const j = JSON.parse(conn.toString('utf8').replace(/^﻿/, ''));
        const c = (j.Connections || [])[0] || (j.RemoteArtifacts || [])[0];
        if (c) out.liveConnection = c.PbiModelDatabaseName || c.ConnectionString || c.DatasetId || true;
      } catch { /* ignore */ }
    }
    const layout = z.read('Report/Layout');
    if (layout) out.report = reportFromLegacy(JSON.parse(utf16(layout)), 'PBIX, legacy layout');
    else if (z.names.includes('Report/definition/report.json')) {
      const base = 'Report/definition/';
      out.report = reportFromPbir({
        has: rel => z.names.includes(base + rel),
        json: rel => JSON.parse(z.read(base + rel).toString('utf8').replace(/^﻿/, '')),
        dirs: rel => [...new Set(z.names.filter(n => n.startsWith(`${base}${rel}/`)).map(n => n.slice(base.length + rel.length + 1).split('/'))
          .filter(parts => parts.length > 1).map(parts => parts[0]))],
      }, 'PBIX, PBIR inside');
    }
    out.model = null;
    out.modelNote = out.hasImportedModel
      ? 'The model inside a .pbix is compressed binary: open the file in Power BI Desktop and read it with the powerbi-modeling MCP, or save it as .pbip.'
      : out.liveConnection ? 'Thin report: the model lives in the Power BI service.' : 'No model found.';
  } catch (e) { out.error = `could not read: ${e.message}`; }
  return out;
}

// ---------- projects ----------
function scanModelDir(dir) {
  const def = path.join(dir, 'definition');
  let model;
  if (isDir(def)) model = modelFromTmdl(def);
  else if (exists(path.join(dir, 'model.bim'))) model = modelFromBim(path.join(dir, 'model.bim'));
  else return { path: dir, name: path.basename(dir).replace(/\.SemanticModel$/, ''), error: 'no definition/ folder or model.bim yet (Desktop may still be saving)' };
  buildDeps(model);
  model.path = dir;
  model.name = path.basename(dir).replace(/\.SemanticModel$/, '');
  return model;
}
function scanReportDir(dir) {
  const def = path.join(dir, 'definition');
  let report;
  if (isDir(path.join(def, 'pages'))) report = reportFromPbir(dirSource(def));
  else if (exists(path.join(dir, 'report.json'))) report = reportFromLegacy(readJson(path.join(dir, 'report.json')), 'PBIR-Legacy (report.json)');
  else report = { format: 'unknown', pages: [], filters: [] };
  report.path = dir;
  report.name = path.basename(dir).replace(/\.Report$/, '');
  const pbir = path.join(dir, 'definition.pbir');
  if (exists(pbir)) {
    const ref = readJson(pbir).datasetReference || {};
    if (ref.byPath) report.modelPath = path.resolve(dir, ref.byPath.path);
    if (ref.byConnection) report.liveConnection = ref.byConnection.connectionString || ref.byConnection.pbiModelDatabaseName || true;
  }
  return report;
}

function findItems(root, maxDepth = 6) {
  const found = { pbip: [], pbix: [], reports: [], models: [] };
  const walk = (d, depth) => {
    let entries;
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        if (e.name.endsWith('.Report')) { found.reports.push(f); continue; }
        if (e.name.endsWith('.SemanticModel') || e.name.endsWith('.Dataset')) { found.models.push(f); continue; }
        if (depth < maxDepth) walk(f, depth + 1);
      } else if (e.name.endsWith('.pbip')) found.pbip.push(f);
      else if (e.name.endsWith('.pbix')) found.pbix.push(f);
    }
  };
  walk(root, 0);
  return found;
}

function desktopWindows() {
  if (process.platform !== 'win32') return [];
  try {
    const out = execSync('powershell.exe -NoProfile -Command "Get-Process PBIDesktop -ErrorAction SilentlyContinue | ForEach-Object { $_.Id.ToString() + [char]9 + $_.MainWindowTitle }"',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000 });
    return out.split(/\r?\n/).filter(Boolean).map(l => { const [pid, title] = l.split('\t'); return { pid: +pid, title: title || '' }; });
  } catch { return []; }
}

function scan(target) {
  target = path.resolve(target);
  const result = { root: target, projects: [], pbix: [], desktop: desktopWindows() };
  let found;
  if (target.endsWith('.pbip')) found = { pbip: [target], pbix: [], reports: [], models: [] };
  else if (target.endsWith('.pbix')) found = { pbip: [], pbix: [target], reports: [], models: [] };
  else if (/\.Report$/.test(target)) found = { pbip: [], pbix: [], reports: [target], models: [] };
  else if (/\.(SemanticModel|Dataset)$/.test(target)) found = { pbip: [], pbix: [], reports: [], models: [target] };
  else found = findItems(target);
  if (target.endsWith('.pbip')) {
    const dir = path.dirname(target);
    for (const e of fs.readdirSync(dir)) {
      if (e.endsWith('.Report')) found.reports.push(path.join(dir, e));
      if (e.endsWith('.SemanticModel')) found.models.push(path.join(dir, e));
    }
  }
  const models = new Map(found.models.map(m => [path.resolve(m), null]));
  const getModel = p => { const k = path.resolve(p); if (!models.get(k)) models.set(k, scanModelDir(k)); return models.get(k); };
  const used = new Set();
  for (const r of found.reports) {
    const report = scanReportDir(r);
    const pbip = found.pbip.find(p => path.dirname(p) === path.dirname(r)) || null;
    const proj = { name: report.name, pbip, report, model: null };
    if (report.modelPath && isDir(report.modelPath)) { proj.model = getModel(report.modelPath); used.add(path.resolve(report.modelPath)); }
    proj.openInDesktop = result.desktop.some(w => w.title.toLowerCase().startsWith(`${report.name.toLowerCase()} `) || w.title.toLowerCase() === report.name.toLowerCase());
    result.projects.push(proj);
  }
  for (const m of models.keys()) if (!used.has(m)) {
    const model = getModel(m);
    result.projects.push({ name: model.name, pbip: found.pbip.find(p => path.dirname(p) === path.dirname(m)) || null, report: null, model,
      openInDesktop: result.desktop.some(w => w.title.toLowerCase().startsWith(`${model.name.toLowerCase()} `)) });
  }
  for (const f of found.pbix) {
    const px = scanPbix(f);
    px.openInDesktop = result.desktop.some(w => w.title.toLowerCase().startsWith(`${px.name.toLowerCase()} `));
    px.hasPbipCopy = result.projects.some(p => p.name.toLowerCase() === px.name.toLowerCase() && path.dirname(p.report ? p.report.path : p.model.path) === path.dirname(f));
    result.pbix.push(px);
  }
  linkUsage(result);
  return result;
}

// mark which measures / columns the reports use
function linkUsage(result) {
  for (const p of result.projects) {
    if (!p.model || !p.model.tables) continue;
    const usage = new Map();
    const reports = result.projects.filter(q => q.report && q.model === p.model).map(q => q.report);
    for (const r of reports) for (const pg of r.pages) for (const v of pg.visuals) for (const f of v.fields) {
      const k = `${f.table}|${f.name}`.toLowerCase();
      if (!usage.has(k)) usage.set(k, []);
      usage.get(k).push(`${r.name} / ${pg.displayName} / ${v.title || v.type}`);
    }
    for (const r of reports) for (const f of [...r.filters, ...r.pages.flatMap(pg => pg.filters)].flatMap(x => x.fields)) {
      const k = `${f.table}|${f.name}`.toLowerCase();
      if (!usage.has(k)) usage.set(k, []);
      usage.get(k).push(`${r.name} / filter`);
    }
    for (const t of p.model.tables) {
      for (const m of t.measures) m.usedBy = [...new Set(usage.get(`${t.name}|${m.name}`.toLowerCase()) || [])];
      for (const c of t.columns) c.usedBy = [...new Set(usage.get(`${t.name}|${c.name}`.toLowerCase()) || [])];
    }
    p.model.reportsScanned = reports.map(r => r.name);
  }
}

// ---------- text output ----------
function summary(result, detail) {
  const L = [];
  const fmtModel = m => {
    if (!m) return 'none found';
    if (m.error) return `unreadable (${m.error})`;
    const cols = m.tables.reduce((n, t) => n + t.columns.length, 0), meas = m.tables.reduce((n, t) => n + t.measures.length, 0);
    return `${m.format}: ${m.tables.length} tables, ${cols} columns, ${meas} measures, ${m.relationships.length} relationships`;
  };
  const fmtReport = r => `${r.format}: ${r.pages.length} pages, ${r.pages.reduce((n, p) => n + p.visuals.length, 0)} visuals`;
  for (const p of result.projects) {
    L.push(`PROJECT ${p.name}${p.pbip ? `  (${p.pbip})` : ''}${p.openInDesktop ? '  [OPEN IN DESKTOP]' : ''}`);
    if (p.report) L.push(`  report  ${fmtReport(p.report)}${p.report.liveConnection ? `  live connection: ${p.report.liveConnection}` : ''}`);
    L.push(`  model   ${fmtModel(p.model)}`);
    if (p.model && p.model.tables) {
      const srcs = new Map();
      for (const t of p.model.tables) for (const pt of t.partitions) for (const s of pt.sources) srcs.set(`${s.kind}: ${s.target}`, true);
      for (const e of p.model.expressions) for (const s of e.sources) srcs.set(`${s.kind}: ${s.target}`, true);
      if (srcs.size) L.push(`  sources ${[...srcs.keys()].join(' | ')}`);
    }
    if (detail) L.push(...detailLines(p));
    L.push('');
  }
  for (const x of result.pbix) {
    L.push(`PBIX ${x.path}${x.openInDesktop ? '  [OPEN IN DESKTOP]' : ''}${x.hasPbipCopy ? '  (a .pbip copy exists next to it)' : ''}`);
    if (x.error) L.push(`  ${x.error}`);
    if (x.pbipLongestPath >= 250) L.push(`  WARNING a .pbip saved in this folder would have paths of ~${x.pbipLongestPath} characters (Windows limit 260): save the project to a shorter folder`);
    if (x.report) L.push(`  report  ${fmtReport(x.report)}`);
    L.push(`  model   ${x.modelNote || ''}`);
    if (detail && x.report) L.push(...reportLines(x.report));
    L.push('');
  }
  if (!result.projects.length && !result.pbix.length) L.push(`No Power BI files found under ${result.root}`);
  if (result.desktop.length) L.push(`Power BI Desktop windows: ${result.desktop.map(w => `"${w.title}" (pid ${w.pid})`).join(', ')}`);
  return L.join('\n');
}
const fieldStr = f => f ? (f.kind === 'measure' ? `[${f.name}]` : `${f.table}[${f.name}]${f.kind === 'implicit' ? ` (implicit ${f.func === 0 ? 'SUM' : 'agg'})` : ''}`) : '?';
function reportLines(r) {
  const L = [];
  if (r.filters.length) L.push(`  report filters: ${r.filters.map(f => f.fields.map(fieldStr).join(',')).join('; ')}`);
  for (const pg of r.pages) {
    L.push(`  PAGE "${pg.displayName}"${pg.hidden ? ' (hidden)' : ''}${pg.type !== 'Standard' ? ` (${pg.type})` : ''} ${pg.width || '?'}x${pg.height || '?'}`);
    if (pg.filters.length) L.push(`    page filters: ${pg.filters.map(f => f.fields.map(fieldStr).join(',')).join('; ')}`);
    for (const v of pg.visuals) {
      const roles = Object.entries(v.roles).map(([r, l]) => `${r}=${l.map(f => f.displayName ? `${fieldStr(f)} as "${f.displayName}"` : fieldStr(f)).join(', ')}`).join('; ');
      const pos = v.position ? ` @${Math.round(v.position.x)},${Math.round(v.position.y)} ${Math.round(v.position.width)}x${Math.round(v.position.height)}` : '';
      L.push(`    - ${v.type}${v.title ? ` "${v.title}"` : ''}${pos}${roles ? `: ${roles}` : ''}${v.filters.length ? `  filters: ${v.filters.map(f => f.fields.map(fieldStr).join(',')).join('; ')}` : ''}`);
    }
  }
  return L;
}
function detailLines(p) {
  const L = [];
  const m = p.model;
  if (m && m.tables) {
    for (const t of m.tables) {
      if (t.kind === 'auto date table') continue;
      L.push(`  TABLE ${t.name} (${t.kind}${t.isHidden ? ', hidden' : ''}${t.dataCategory === 'Time' ? ', marked date table' : ''})${t.description ? ` - ${t.description}` : ''}`);
      const src = t.partitions.flatMap(x => x.sources).map(s => `${s.kind}: ${s.target}`);
      if (src.length) L.push(`    source: ${[...new Set(src)].join(' | ')}`);
      if (t.columns.length) L.push(`    columns: ${t.columns.map(c => {
        const tags = [c.dataType, c.calculated && 'calc', c.isHidden && 'hidden', c.sortByColumn && `sorted by ${c.sortByColumn}`].filter(Boolean);
        return `${c.name}${tags.length ? ` (${tags.join(', ')})` : ''}`;
      }).join(', ')}`);
      for (const ms of t.measures) L.push(`    measure [${ms.name}]${ms.formatString ? ` fmt ${ms.formatString}` : ''}${ms.isHidden ? ' hidden' : ''} = ${ms.expression.replace(/\s+/g, ' ').slice(0, 240)}`);
      for (const it of t.calculationItems) L.push(`    calc item ${it.name} = ${it.expression.replace(/\s+/g, ' ').slice(0, 160)}`);
    }
    for (const r of m.relationships) L.push(`  REL ${r.fromTable}[${r.fromColumn}] (${r.fromCardinality}) -> ${r.toTable}[${r.toColumn}] (${r.toCardinality})${r.active ? '' : ' INACTIVE'}${r.crossFilter === 'both' ? ' BOTH-WAYS' : ''}`);
    for (const r of m.roles) L.push(`  ROLE ${r.name}: ${r.filters.map(f => `${f.table}: ${f.expression}`).join('; ')}`);
  }
  if (p.report) L.push(...reportLines(p.report));
  return L;
}

module.exports = { scan, parseTmdl, scanModelDir, scanReportDir, collectFields, daxRefs, stripDax, splitName, summary, desktopWindows };

if (require.main === module) {
  const args = process.argv.slice(2);
  const target = args.find(a => !a.startsWith('--')) || '.';
  const jIdx = args.indexOf('--json');
  const result = scan(target);
  if (jIdx >= 0) {
    const out = args[jIdx + 1] && !args[jIdx + 1].startsWith('--') ? args[jIdx + 1] : 'pbi-scan.json';
    fs.writeFileSync(out, JSON.stringify(result, null, 2));
    console.log(`wrote ${path.resolve(out)}`);
  }
  console.log(summary(result, args.includes('--detail')));
}
