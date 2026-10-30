#!/usr/bin/env node
// Profiles raw data files before a model is built: every CSV / TXT / TSV file and every Excel sheet,
// with row counts, column types, blanks, distinct counts, keys, value ranges, a guess at fact vs
// dimension, and the joins between files (shared key columns whose values match).
//
// Usage: node profile.js <file or folder> [more...] [--json profile.json] [--rows 200000]
// The "columns" line per table pastes straight into a tmdl.js build.
'use strict';
const fs = require('fs');
const path = require('path');
const { zipEntries } = require(path.join(__dirname, '..', '..', 'pbi-core', 'scripts', 'scan.js'));

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const MAX_ROWS = +opt('--rows', 200000);
const inputs = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

// ---------- readers ----------
function readCsv(file) {
  let text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
  const firstLine = text.slice(0, text.indexOf('\n') + 1 || text.length);
  const delim = [',', ';', '\t', '|'].map(d => [d, firstLine.split(d).length]).sort((a, b) => b[1] - a[1])[0][0];
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length && rows.length <= MAX_ROWS; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...data] = rows;
  return [{ name: path.basename(file).replace(/\.[^.]+$/, ''), source: { kind: 'csv', file, delimiter: delim }, header, data }];
}

const xmlText = s => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function readXlsx(file) {
  const z = zipEntries(file);
  const read = n => { const b = z.read(n); return b ? b.toString('utf8') : ''; };
  const shared = [...read('xl/sharedStrings.xml').matchAll(/<si>([\s\S]*?)<\/si>/g)].map(m => xmlText(m[1]));
  // which cell styles are dates (built-in date formats, or custom formats with d/m/y)
  const styles = read('xl/styles.xml');
  const custom = Object.fromEntries([...styles.matchAll(/<numFmt [^>]*numFmtId="(\d+)"[^>]*formatCode="([^"]*)"/g)].map(m => [m[1], m[2]]));
  const xfs = (styles.match(/<cellXfs[\s\S]*?<\/cellXfs>/) || [''])[0];
  const dateStyle = [...xfs.matchAll(/<xf [^>]*?numFmtId="(\d+)"/g)].map(m => {
    const id = +m[1];
    return (id >= 14 && id <= 22) || (id >= 45 && id <= 47) || (custom[id] && /[dmy]/i.test(custom[id].replace(/"[^"]*"|\[[^\]]*\]/g, '')));
  });
  const rels = Object.fromEntries([...read('xl/_rels/workbook.xml.rels').matchAll(/<Relationship [^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map(m => [m[1], m[2]]));
  const sheets = [...read('xl/workbook.xml').matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)];
  const out = [];
  for (const [, sheetName, rid] of sheets) {
    const target = rels[rid] || '';
    const xml = read(target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`);
    const rows = [];
    for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      if (rows.length > MAX_ROWS) break;
      const r = [];
      for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const colIdx = cm[1].split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
        const attrs = cm[2], body = cm[3] || '';
        const t = (attrs.match(/t="([^"]+)"/) || [])[1], s = (attrs.match(/s="(\d+)"/) || [])[1];
        const v = (body.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = '';
        if (t === 's') val = shared[+v] || '';
        else if (t === 'inlineStr') val = xmlText((body.match(/<is>([\s\S]*?)<\/is>/) || ['', ''])[1]);
        else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
        else if (v !== undefined) {
          val = xmlText(v);
          if (s !== undefined && dateStyle[+s] && !isNaN(+val)) {
            const d = new Date(Math.round((+val - 25569) * 86400000));
            val = +val % 1 ? d.toISOString().replace('T', ' ').slice(0, 19) : d.toISOString().slice(0, 10);
          }
        }
        r[colIdx] = val;
      }
      rows.push(Array.from(r, x => x === undefined ? '' : x));
    }
    if (!rows.length) continue;
    const [header, ...data] = rows;
    out.push({ name: sheetName, source: { kind: 'excel', file, sheet: sheetName }, header: header.map(h => String(h)), data });
  }
  return out;
}

// ---------- profiling ----------
const RE = {
  int: /^-?\d{1,15}$/,
  decimal: /^-?(\d+\.\d*|\.\d+|\d+)([eE][-+]?\d+)?$/,
  date: /^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})$/,
  datetime: /^(\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}\/\d{4})[ T]\d{1,2}:\d{2}(:\d{2})?/,
  bool: /^(true|false)$/i,
};
function profileColumn(name, values) {
  const nonEmpty = values.filter(v => v !== '' && v !== null && v !== undefined);
  const counts = { int: 0, decimal: 0, date: 0, datetime: 0, bool: 0 };
  let leadingZero = false;
  for (const v of nonEmpty) {
    const s = String(v).trim();
    if (RE.int.test(s)) { counts.int++; if (/^-?0\d/.test(s)) leadingZero = true; }
    if (RE.decimal.test(s)) counts.decimal++;
    if (RE.datetime.test(s)) counts.datetime++;
    else if (RE.date.test(s)) counts.date++;
    if (RE.bool.test(s)) counts.bool++;
  }
  const n = nonEmpty.length || 1;
  let type = 'text';
  if (nonEmpty.length && counts.bool === n) type = 'bool';
  else if (nonEmpty.length && counts.int === n && !leadingZero) type = 'int';
  else if (nonEmpty.length && counts.decimal === n) type = 'decimal';
  else if (nonEmpty.length && counts.date === n) type = 'date';
  else if (nonEmpty.length && counts.date + counts.datetime === n) type = 'datetime';
  const distinct = new Set(nonEmpty.map(String));
  const col = { name, type, rows: values.length, blanks: values.length - nonEmpty.length, distinct: distinct.size,
    unique: distinct.size === values.length && values.length > 0, sample: [...distinct].slice(0, 3) };
  if (type === 'int' || type === 'decimal') { const nums = nonEmpty.map(Number); col.min = Math.min(...nums); col.max = Math.max(...nums); }
  if (type === 'date' || type === 'datetime') { const s = nonEmpty.map(String).sort(); col.min = s[0]; col.max = s[s.length - 1]; }
  col.values = distinct;
  return col;
}

function profileTable(t) {
  // same naming as Power Query's PromoteHeaders: blank headers become ColumnN, repeats get _1, _2
  const seen = {};
  const names = t.header.map((h, i) => {
    let n = String(h || `Column${i + 1}`).trim();
    if (seen[n] !== undefined) { seen[n]++; n = `${n}_${seen[n]}`; } else seen[n] = 0;
    return n;
  });
  const columns = names.map((n, i) => profileColumn(n, t.data.map(r => r[i] === undefined ? '' : r[i])));
  for (const [n, k] of Object.entries(seen)) if (k) columns.find(c => c.name === n).note = `header repeated ${k + 1} times; Power Query names the others ${n}_1...`;
  const key = columns.find(c => c.unique && (/id$|key$|code$|number$|no$/i.test(c.name) || c === columns[0]));
  const numeric = columns.filter(c => (c.type === 'int' || c.type === 'decimal') && !/id$|key$|code$/i.test(c.name)).length;
  const dates = columns.filter(c => c.type === 'date' || c.type === 'datetime').length;
  const keyLike = columns.filter(c => /id$|key$|code$/i.test(c.name) && !c.unique).length;
  const role = keyLike >= 1 && (numeric >= 1 || dates >= 1) && t.data.length > 200 ? 'fact' : key ? 'dimension' : t.data.length > 200 ? 'fact' : 'dimension';
  return { name: t.name, source: t.source, rows: t.data.length, truncated: t.data.length >= MAX_ROWS, role, key: key && key.name, columns };
}

// many-to-one joins: a column whose values sit (almost) entirely inside a unique column of another table
function findJoins(tables) {
  const joins = [];
  for (const many of tables) for (const mc of many.columns) {
    if (mc.distinct === 0 || mc.unique && many.role !== 'fact') continue;
    for (const one of tables) {
      if (one === many) continue;
      for (const oc of one.columns) {
        if (!oc.unique || oc.type !== mc.type && !(oc.type === 'text' || mc.type === 'text')) continue;
        if (oc.name.toLowerCase() !== mc.name.toLowerCase() && !(oc.name.toLowerCase() === 'id' && mc.name.toLowerCase() === `${one.name.toLowerCase().replace(/s$/, '')}id`)) continue;
        let hit = 0;
        for (const v of mc.values) if (oc.values.has(v)) hit++;
        const coverage = hit / mc.distinct;
        if (coverage >= 0.9) joins.push({ from: `${many.name}[${mc.name}]`, to: `${one.name}[${oc.name}]`, coverage: Math.round(coverage * 1000) / 10, unmatched: mc.distinct - hit });
      }
    }
  }
  return joins;
}

function main() {
  if (!inputs.length) { console.log('Usage: node profile.js <file or folder> [...] [--json out.json]'); process.exit(1); }
  const files = [];
  for (const inp of inputs) {
    const p = path.resolve(inp);
    if (fs.statSync(p).isDirectory()) for (const f of fs.readdirSync(p)) files.push(path.join(p, f));
    else files.push(p);
  }
  const raw = [];
  for (const f of files) {
    const ext = path.extname(f).toLowerCase();
    try {
      if (['.csv', '.txt', '.tsv'].includes(ext)) raw.push(...readCsv(f));
      else if (['.xlsx', '.xlsm'].includes(ext)) raw.push(...readXlsx(f));
    } catch (e) { console.log(`skipped ${f}: ${e.message}`); }
  }
  const tables = raw.map(profileTable);
  const joins = findJoins(tables);

  const L = [];
  for (const t of tables) {
    const src = t.source.kind === 'excel' ? `${path.basename(t.source.file)} sheet "${t.source.sheet}"` : path.basename(t.source.file);
    L.push(`TABLE ${t.name}  (${src})  ${t.rows} rows${t.truncated ? ' (read limit hit)' : ''}  looks like a ${t.role}${t.key ? `, key ${t.key}` : ''}`);
    for (const c of t.columns) {
      const range = c.min !== undefined ? `  ${c.min} .. ${c.max}` : '';
      L.push(`  ${c.name.padEnd(24)} ${c.type.padEnd(8)} ${String(c.distinct).padStart(7)} distinct${c.unique ? ' (unique)' : ''}${c.blanks ? `, ${c.blanks} blank` : ''}${range}  e.g. ${c.sample.join(' | ').slice(0, 60)}${c.note ? `  NOTE ${c.note}` : ''}`);
    }
    L.push(`  columns: [${t.columns.map(c => `['${c.name.replace(/'/g, "\\'")}', '${c.type}']`).join(', ')}]`);
    L.push('');
  }
  L.push(joins.length ? 'JOINS (many -> one)' : 'No joins found between the files.');
  for (const j of joins) L.push(`  ${j.from} -> ${j.to}  ${j.coverage}% of values match${j.unmatched ? `, ${j.unmatched} values have no match` : ''}`);
  console.log(L.join('\n'));

  const jsonOut = opt('--json');
  if (jsonOut) {
    fs.writeFileSync(jsonOut, JSON.stringify({ tables: tables.map(t => ({ ...t, columns: t.columns.map(({ values, ...c }) => c) })), joins }, null, 2));
    console.log(`\nwrote ${path.resolve(jsonOut)}`);
  }
}
main();
