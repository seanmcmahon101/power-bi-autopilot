#!/usr/bin/env node
// Pre-flight check of a PBIR report before Power BI Desktop opens it. Catches what makes Desktop
// refuse a page or show a broken visual: bad JSON, folder/name mismatches, pages.json drift,
// fields that are not in the model, visual types that do not exist, and layout overlaps.
//
// Usage: node check.js <X.Report folder | .pbip | project folder> [--layout]
//   --layout  also warn when data visuals overlap (use on generated pages; hand-made reports layer visuals on purpose)
// Exit code 1 when any ERROR is found.
'use strict';
const fs = require('fs');
const path = require('path');
const { scan } = require('./scan.js');

// visual types Desktop ships (custom visuals have a GUID-like name and are skipped)
const KNOWN_TYPES = new Set(['actionButton', 'areaChart', 'barChart', 'basicShape', 'bookmarkNavigator', 'card', 'cardVisual', 'clusteredBarChart',
  'clusteredColumnChart', 'columnChart', 'decompositionTreeVisual', 'donutChart', 'filledMap', 'funnel', 'gauge', 'hundredPercentStackedAreaChart',
  'hundredPercentStackedBarChart', 'hundredPercentStackedColumnChart', 'image', 'keyDriversVisual', 'kpi', 'lineChart', 'lineClusteredColumnComboChart',
  'lineStackedColumnComboChart', 'map', 'multiRowCard', 'pageNavigator', 'pieChart', 'pivotTable', 'qnaVisual', 'ribbonChart', 'scatterChart',
  'scriptVisual', 'shape', 'slicer', 'advancedSlicerVisual', 'listSlicer', 'textSlicer', 'stackedAreaChart', 'tableEx', 'textbox', 'treemap', 'waterfallChart',
  'azureMap', 'shapeMap', 'pythonVisual', 'aiNarratives', 'paginatedReportVisual', 'group', 'unknown']);
const WRONG_TYPES = { stackedBarChart: 'barChart', stackedColumnChart: 'columnChart', table: 'tableEx', matrix: 'pivotTable', combo: 'lineClusteredColumnComboChart' };

function check(target, opts = {}) {
  const issues = [];
  const add = (level, where, msg) => issues.push({ level, where, msg });
  const result = scan(target);
  const projects = result.projects.filter(p => p.report);
  if (!projects.length) add('ERROR', target, 'no .Report folder found');

  for (const p of projects) {
    const r = p.report;
    const def = path.join(r.path, 'definition');
    if (r.format !== 'PBIR') { add('ERROR', r.path, `report is ${r.format}, not PBIR. Save it from Desktop with the PBIR preview feature on (see viz-it).`); continue; }

    // every JSON parses; no path near the Windows 260-character limit (Desktop fails to save or open silently)
    const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (f.length >= 250) add('ERROR', f, `path is ${f.length} characters; Windows stops at 260. Move the project to a shorter folder.`);
      if (e.isDirectory()) walk(f);
      else if (e.name.endsWith('.json')) { try { JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, '')); } catch (err) { add('ERROR', f, `invalid JSON: ${err.message}`); } }
    } };
    walk(def);

    // pages.json vs folders
    const pagesDir = path.join(def, 'pages');
    const folders = fs.readdirSync(pagesDir).filter(d => fs.statSync(path.join(pagesDir, d)).isDirectory());
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(pagesDir, 'pages.json'), 'utf8')); } catch { add('ERROR', pagesDir, 'pages.json missing or invalid'); }
    for (const n of meta.pageOrder || []) if (!folders.includes(n)) add('ERROR', 'pages.json', `pageOrder lists "${n}" but there is no such page folder`);
    for (const f of folders) if (!(meta.pageOrder || []).includes(f)) add('WARN', 'pages.json', `page folder "${f}" is not in pageOrder (Desktop appends it at the end)`);
    if (meta.activePageName && !folders.includes(meta.activePageName)) add('ERROR', 'pages.json', `activePageName "${meta.activePageName}" does not exist`);

    // model lookup
    const m = p.model && p.model.tables ? p.model : null;
    if (!m) add('WARN', r.path, r.liveConnection ? 'thin report: fields can not be checked against a local model' : 'no local model found: fields not checked');
    const tables = new Map((m ? m.tables : []).map(t => [t.name, t]));

    for (const pg of r.pages) {
      const where = `page "${pg.displayName}"`;
      if (pg.name !== pg.folder) add('ERROR', where, `page.json name "${pg.name}" must equal its folder name "${pg.folder}"`);
      if (!pg.displayName) add('WARN', where, 'page has no displayName');
      const names = new Set();
      for (const v of pg.visuals) {
        const vw = `${where} / ${v.title || v.type} (${v.folder})`;
        if (v.name !== v.folder) add('ERROR', vw, `visual name "${v.name}" must equal its folder name`);
        if (names.has(v.name)) add('ERROR', vw, 'duplicate visual name on the page');
        names.add(v.name);
        if (v.name && v.name.length > 50) add('ERROR', vw, 'visual name longer than 50 characters');
        if (WRONG_TYPES[v.type]) add('ERROR', vw, `visualType "${v.type}" does not exist; use "${WRONG_TYPES[v.type]}"`);
        else if (!KNOWN_TYPES.has(v.type) && !/[A-Z0-9]{8,}/.test(v.type)) add('WARN', vw, `unfamiliar visualType "${v.type}"`);
        const pos = v.position || {};
        if (pg.width && (pos.x < 0 || pos.y < 0 || pos.x + pos.width > pg.width + 1 || pos.y + pos.height > pg.height + 1))
          add('WARN', vw, `sits outside the ${pg.width}x${pg.height} canvas`);
        if (m) for (const f of v.fields) {
          const t = tables.get(f.table);
          if (!t) { add('ERROR', vw, `table "${f.table}" is not in the model`); continue; }
          if (f.kind === 'measure') { if (!t.measures.some(x => x.name === f.name)) add('ERROR', vw, `measure "${f.table}"[${f.name}] is not in the model`); }
          else if (!t.columns.some(x => x.name === f.name)) add('ERROR', vw, `column "${f.table}"[${f.name}] is not in the model${t.measures.some(x => x.name === f.name) ? ' (it is a measure: bind it as Measure, not Column)' : ''}`);
        }
      }
      // data visuals covering a fifth or more of each other (decorations and buttons layered on purpose are skipped)
      const DECOR = ['shape', 'basicShape', 'image', 'group', 'textbox', 'actionButton', 'pageNavigator', 'bookmarkNavigator', 'unknown'];
      const solid = opts.layout ? pg.visuals.filter(v => v.position && !v.hidden && !DECOR.includes(v.type)) : [];
      for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
        const a = solid[i].position, b = solid[j].position;
        const ox = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), oy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
        const smaller = Math.min(a.width * a.height, b.width * b.height);
        if (ox > 0 && oy > 0 && ox * oy > 0.2 * smaller) add('WARN', where, `"${solid[i].title || solid[i].type}" overlaps "${solid[j].title || solid[j].type}" by ${Math.round(ox)}x${Math.round(oy)}px`);
      }
    }

    // raw JSON patterns known to misbehave
    for (const pg of r.pages) for (const v of pg.visuals) {
      const raw = fs.readFileSync(path.join(pagesDir, pg.folder, 'visuals', v.folder, 'visual.json'), 'utf8');
      const vw = `page "${pg.displayName}" / ${v.title || v.type}`;
      if (/"strictSingleSelect"\s*:\s*\{\s*"expr"\s*:\s*\{\s*"Literal"\s*:\s*\{\s*"Value"\s*:\s*"true"/.test(raw))
        add('WARN', vw, 'strictSingleSelect=true auto-selects (Blank) and can blank the page; use singleSelect');
      if (/"Table"\s*:\s*\{\s*"TableRef"/.test(raw)) add('ERROR', vw, 'TopN filter uses TableRef; it must be "Table": {"SourceRef": {"Source": "subquery"}}');
      if (!/"\$schema"/.test(raw)) add('WARN', vw, 'visual.json has no $schema');
    }
  }
  return issues;
}

if (require.main === module) {
  const target = process.argv.slice(2).find(a => !a.startsWith('--')) || '.';
  const issues = check(target, { layout: process.argv.includes('--layout') });
  const errors = issues.filter(i => i.level === 'ERROR');
  for (const i of issues) console.log(`${i.level.padEnd(5)} ${i.where}: ${i.msg}`);
  console.log(issues.length ? `\n${errors.length} errors, ${issues.length - errors.length} warnings` : 'OK: no problems found');
  process.exit(errors.length ? 1 : 0);
}
module.exports = { check };
