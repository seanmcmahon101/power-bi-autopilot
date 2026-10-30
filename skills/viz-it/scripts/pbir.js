// PBIR report generator library. A build script describes pages in a few lines; this writes the
// page.json / visual.json files, the theme and pages.json that Power BI Desktop expects.
// Every pattern here has been opened in Desktop and checked (see ../references/visual-recipes.md).
//
//   const pbir = require('<this folder>/pbir.js');
//   const { C, M, inFilter, topN, sortBy } = pbir;
//   const r = pbir.report('C:/work/Sales.Report');
//   const p = r.page('Overview');
//   p.header('Sales overview', 'Open orders and shipments, GBP');
//   p.cardRow([[M('Sales', 'Total Sales'), 'Total sales'], [M('Sales', 'Orders'), 'Orders']]);
//   const [left, right] = r.layout.cols(1100, '*');
//   p.line([left.x, r.layout.rowA.y, left.w, r.layout.rowA.h], 'Sales by month', null, [C('Date', 'Month'), 'Month'], [[M('Sales', 'Total Sales'), 'Sales']]);
//   r.write();
//
// Positions are [x, y, width, height] in canvas pixels. Field helpers: C(table, column), M(table, measure).
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const id = () => crypto.randomBytes(10).toString('hex');
const DEFAULT_SCHEMAS = {
  visual: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/visualContainer/2.13.0/schema.json',
  page: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/page/2.1.0/schema.json',
  pages: 'https://developer.microsoft.com/json-schemas/fabric/item/report/definition/pagesMetadata/1.1.0/schema.json',
};

// ---------- palette (validated for colour-blind contrast; slots in this order for categories) ----------
const colors = {
  INK: '#0B0B0B', INK2: '#52514E', MUTED: '#6F6E69', GRID: '#EBEAE5', LINE: '#E3E2DC', PAGE: '#F6F6F3', SURFACE: '#FFFFFF',
  BLUE: '#2A78D6', ORANGE: '#EB6834', AQUA: '#1BAF7A', YELLOW: '#EDA100', PINK: '#E87BA4', GREEN: '#008300', VIOLET: '#6250D6', RED: '#E34948',
  DARK_BLUE: '#1C5CAB', LIGHT_BLUE: '#86B6EF', NEUTRAL: '#C3C2B7',
};
const FONT = 'Segoe UI', FONT_SB = 'Segoe UI Semibold';
const { INK, INK2, MUTED, GRID, LINE, PAGE, SURFACE, BLUE, RED, NEUTRAL } = colors;

// ---------- expression helpers ----------
const lit = v => ({ expr: { Literal: { Value: v } } });
const str = s => lit(`'${String(s).replace(/'/g, "''")}'`);
const num = n => lit(`${n}D`);
const bool = b => lit(b ? 'true' : 'false');
const hex = h => ({ solid: { color: str(h) } });
// literal for filter values: strings quoted, integers as Int64
const valLit = v => typeof v === 'number' ? `${v}L` : `'${String(v).replace(/'/g, "''")}'`;

// ---------- field helpers ----------
const C = (t, p) => ({ kind: 'col', t, p });
const M = (t, p) => ({ kind: 'meas', t, p });
const fieldOf = f => f.kind === 'col'
  ? { Column: { Expression: { SourceRef: { Entity: f.t } }, Property: f.p } }
  : { Measure: { Expression: { SourceRef: { Entity: f.t } }, Property: f.p } };
const qref = f => `${f.t}.${f.p}`;
const proj = (f, display, extra = {}) => {
  const p = { field: fieldOf(f), queryRef: qref(f), nativeQueryRef: display || f.p };
  if (display) p.displayName = display;
  return Object.assign(p, extra);
};
const items = list => list.map(it => Array.isArray(it) ? it : [it]);
const roles = spec => {
  const qs = {};
  for (const [role, list] of Object.entries(spec)) {
    qs[role] = { projections: items(list).map(([f, d], i) => proj(f, d, (role === 'Category' || role === 'Rows') && i === 0 ? { active: true } : {})) };
  }
  return qs;
};
const sortBy = (f, dir = 'Descending') => ({ sort: [{ field: fieldOf(f), direction: dir }] });

// ---------- filter helpers (visual, page or report level) ----------
const srcRef = (alias, f) => f.kind === 'col'
  ? { Column: { Expression: { SourceRef: { Source: alias } }, Property: f.p } }
  : { Measure: { Expression: { SourceRef: { Source: alias } }, Property: f.p } };
const inWhere = (f, values) => ({ Version: 2, From: [{ Name: 'a', Entity: f.t, Type: 0 }],
  Where: [{ Condition: { In: { Expressions: [srcRef('a', f)], Values: values.map(v => [{ Literal: { Value: valLit(v) } }]) } } }] });
// keep only these values
const inFilter = (f, values) => ({ name: id(), field: fieldOf(f), type: 'Categorical', filter: inWhere(f, values) });
// kind: 0 eq, 1 gt, 2 ge, 3 lt, 4 le
const cmpFilter = (f, kind, value) => ({
  name: id(), field: fieldOf(f), type: 'Advanced',
  filter: { Version: 2, From: [{ Name: 'a', Entity: f.t, Type: 0 }],
    Where: [{ Condition: { Comparison: { ComparisonKind: kind, Left: srcRef('a', f), Right: { Literal: { Value: valLit(value) } } } } }] }
});
// lo <= field <= hi
const between = (f, lo, hi) => ({
  name: id(), field: fieldOf(f), type: 'Advanced',
  filter: { Version: 2, From: [{ Name: 'a', Entity: f.t, Type: 0 }],
    Where: [{ Condition: { And: {
      Left: { Comparison: { ComparisonKind: 2, Left: srcRef('a', f), Right: { Literal: { Value: valLit(lo) } } } },
      Right: { Comparison: { ComparisonKind: 4, Left: srcRef('a', f), Right: { Literal: { Value: valLit(hi) } } } } } } }] }
});
// top n values of column f ranked by a measure
const topN = (f, byMeasure, n) => {
  const from = [{ Name: 'a', Entity: f.t, Type: 0 }];
  let mAlias = 'a';
  if (byMeasure.t !== f.t) { from.push({ Name: 'b', Entity: byMeasure.t, Type: 0 }); mAlias = 'b'; }
  return {
    name: id(), field: fieldOf(f), type: 'TopN',
    filter: { Version: 2,
      From: [{ Name: 'subquery', Expression: { Subquery: { Query: { Version: 2, From: from,
        Select: [{ ...srcRef('a', f), Name: 'field' }],
        OrderBy: [{ Direction: 2, Expression: srcRef(mAlias, byMeasure) }], Top: n } } }, Type: 2 },
        { Name: 'a', Entity: f.t, Type: 0 }],
      Where: [{ Condition: { In: { Expressions: [srcRef('a', f)], Table: { SourceRef: { Source: 'subquery' } } } } }] }
  };
};

// ---------- series colours ----------
// one colour per measure: measureColors([[M(...), colors.BLUE], ...])
const measureColors = pairs => pairs.map(([f, c]) => ({ properties: { fill: hex(c) }, selector: { metadata: qref(f) } }));
// one colour per category value: valueColors(C(...), [['Late', colors.RED], ...])
const valueColors = (f, pairs) => pairs.map(([v, c]) => ({ properties: { fill: hex(c) },
  selector: { data: [{ scopeId: { Comparison: { ComparisonKind: 0, Left: fieldOf(f), Right: { Literal: { Value: valLit(v) } } } } }] } }));

// ---------- container styling ----------
const frame = (title, subtitle) => {
  const o = {
    background: [{ properties: { show: bool(true), color: hex(SURFACE), transparency: num(0) } }],
    border: [{ properties: { show: bool(true), color: hex(LINE), radius: num(6), width: num(1) } }],
    dropShadow: [{ properties: { show: bool(false) } }],
    padding: [{ properties: { top: num(10), bottom: num(10), left: num(14), right: num(14) } }],
    title: title
      ? [{ properties: { show: bool(true), text: str(title), fontColor: hex(INK), fontSize: num(12), bold: bool(false), fontFamily: str(FONT_SB), alignment: str('left') } }]
      : [{ properties: { show: bool(false) } }]
  };
  if (subtitle) {
    o.subTitle = [{ properties: { show: bool(true), text: str(subtitle), fontColor: hex(MUTED), fontSize: num(9), fontFamily: str(FONT), alignment: str('left') } }];
    o.divider = [{ properties: { show: bool(false) } }];
  } else if (title) {
    // otherwise some charts show an automatic subtitle such as "Sales by Region and Segment"
    o.subTitle = [{ properties: { show: bool(false) } }];
  }
  return o;
};
const bare = () => ({ background: [{ properties: { show: bool(false) } }], border: [{ properties: { show: bool(false) } }],
  dropShadow: [{ properties: { show: bool(false) } }], title: [{ properties: { show: bool(false) } }] });

const axes = (extraValue = {}) => ({
  categoryAxis: [{ properties: { fontSize: num(9), fontFamily: str(FONT), labelColor: hex(MUTED), showAxisTitle: bool(false), gridlineShow: bool(false) } }],
  valueAxis: [{ properties: Object.assign({ fontSize: num(9), fontFamily: str(FONT), labelColor: hex(MUTED), showAxisTitle: bool(false), gridlineShow: bool(true), gridlineColor: hex(GRID), gridlineStyle: str('solid') }, extraValue) }]
});
const legendTop = () => [{ properties: { show: bool(true), position: str('Top'), fontSize: num(9), fontFamily: str(FONT), labelColor: hex(INK2) } }];
const hidden = () => [{ properties: { show: bool(false) } }];

// ---------- layout (1920 x 1080 canvas) ----------
function makeLayout(width, height) {
  const X0 = 32, GAP = 12, W = width - 2 * X0;
  const L = {
    width, height, X0, W, GAP,
    header: { y: 18, h: 70 },
    slicers: { y: 100, h: 58 },
    cards: { y: 170, h: 94 },
    rowA: { y: 278, h: 382 },
    rowB: { y: 672, h: 362 },
    // cols(1100, '*') -> [{x, w}, {x, w}]: fixed widths plus '*' for "the rest", gaps included
    cols(...widths) {
      const fixed = widths.filter(w => w !== '*').reduce((a, b) => a + b, 0);
      const stars = widths.filter(w => w === '*').length;
      const star = stars ? (W - fixed - GAP * (widths.length - 1)) / stars : 0;
      let x = X0;
      return widths.map(w => { const ww = w === '*' ? star : w; const c = { x, w: ww }; x += ww + GAP; return c; });
    },
    // full-width row of n equal boxes
    split(n) { return L.cols(...Array(n).fill('*')); },
  };
  return L;
}

class Page {
  // stable page name, so Desktop's "Apply external changes" still finds the active page after a regenerate
  constructor(report, displayName, opts = {}) {
    this.report = report; this.L = report.layout;
    this.name = crypto.createHash('md5').update(displayName).digest('hex').slice(0, 20);
    this.displayName = displayName; this.visuals = []; this.z = 0; this.opts = opts;
  }
  add(type, pos, visual, filters) {
    const [x, y, w, h] = pos;
    const v = { $schema: this.report.schemas.visual, name: id(), position: { x, y, z: (this.z += 100), height: h, width: w, tabOrder: this.z },
      visual: Object.assign({ visualType: type }, visual, { drillFilterOtherVisuals: true }) };
    if (filters && filters.length) v.filterConfig = { filters };
    this.visuals.push(v);
    return v;
  }

  textbox(pos, paragraphs) {
    return this.add('textbox', pos, { objects: { general: [{ properties: { paragraphs } }] }, visualContainerObjects: bare() });
  }
  // page title + subtitle on the left, page tabs on the right (opts.nav = false to drop the tabs)
  header(title, subtitle, opts = {}) {
    const { X0, W } = this.L;
    this.textbox([X0, 18, 780, 70], [
      { textRuns: [{ value: title, textStyle: { fontSize: '20pt', color: INK, fontFamily: FONT_SB } }] },
      ...(subtitle ? [{ textRuns: [{ value: subtitle, textStyle: { fontSize: '10pt', color: INK2, fontFamily: FONT } }] }] : [])
    ]);
    if (opts.nav === false) return;
    this.add('pageNavigator', [820, 30, X0 + W - 820, 40], {
      objects: {
        text: [{ properties: { fontSize: num(10), fontFamily: str(FONT), fontColor: hex(INK2) } },
               { properties: { fontColor: hex('#FFFFFF') }, selector: { id: 'selected' } }],
        fill: [{ properties: { fillColor: hex(SURFACE) } },
               { properties: { fillColor: hex(INK) }, selector: { id: 'selected' } }],
        outline: [{ properties: { show: bool(true), lineColor: hex(LINE), weight: num(1) } },
                  { properties: { lineColor: hex(INK) }, selector: { id: 'selected' } }],
        shape: [{ properties: { roundEdge: num(4) } }]
      },
      visualContainerObjects: bare()
    });
  }
  // opts: mode ('Dropdown' | 'Basic'), single, search, select: [values preselected]
  slicer(pos, field, label, opts = {}) {
    const objects = {
      data: [{ properties: { mode: str(opts.mode || 'Dropdown') } }],
      header: [{ properties: { show: bool(true), fontColor: hex(INK2), bold: bool(false), textSize: num(9), fontFamily: str(FONT), outlineStyle: num(0), text: str(label) } }],
      items: [{ properties: { textSize: num(10), fontColor: hex(INK), fontFamily: str(FONT) } }],
      selection: [{ properties: { selectAllCheckboxEnabled: bool(!opts.single), strictSingleSelect: bool(false), singleSelect: bool(!!opts.single) } }]
    };
    if (opts.search) objects.general = [{ properties: { selfFilterEnabled: bool(true) } }];
    if (opts.select) {
      objects.general = objects.general || [{ properties: {} }];
      objects.general[0].properties.filter = { filter: inWhere(field, opts.select) };
    }
    return this.add('slicer', pos, {
      query: { queryState: { Values: { projections: [proj(field, label, { active: true })] } } },
      objects,
      visualContainerObjects: {
        background: [{ properties: { show: bool(true), color: hex(SURFACE), transparency: num(0) } }],
        border: [{ properties: { show: bool(true), color: hex(LINE), radius: num(6), width: num(1) } }],
        padding: [{ properties: { top: num(4), bottom: num(4), left: num(10), right: num(10) } }],
        title: [{ properties: { show: bool(false) } }]
      }
    });
  }
  // list of [field, label, opts]
  slicerRow(list, w = 300) {
    const { X0, GAP, slicers } = this.L;
    list.forEach(([f, label, opts], i) => this.slicer([X0 + i * (w + GAP), slicers.y, w, slicers.h], f, label, opts));
  }
  // one measure per card: a card with several measures wraps unpredictably
  card(pos, f, label, opts = {}) {
    return this.add('cardVisual', pos, {
      query: { queryState: { Data: { projections: [proj(f, label)] } } },
      objects: {
        outline: [{ properties: { show: bool(false) }, selector: { id: 'default' } }],
        value: [{ properties: { fontSize: num(opts.valueSize || 22), fontColor: hex(INK), bold: bool(false), fontFamily: str(FONT_SB), horizontalAlignment: str('left') }, selector: { id: 'default' } }],
        label: [{ properties: { show: bool(!opts.hideLabel), position: str('aboveValue'), fontSize: num(10), fontColor: hex(INK2), fontFamily: str(FONT), horizontalAlignment: str('left') }, selector: { id: 'default' } }],
        padding: [{ properties: { left: num(4), right: num(4) }, selector: { id: 'default' } }]
      },
      visualContainerObjects: opts.bare ? bare() : Object.assign(frame(null), { padding: [{ properties: { top: num(8), bottom: num(8), left: num(14), right: num(14) } }] })
    }, opts.filters);
  }
  // list of [measure, label, opts], spread across the full width
  cardRow(list, y = this.L.cards.y, h = this.L.cards.h) {
    const { X0, W, GAP } = this.L;
    const n = list.length, cw = (W - GAP * (n - 1)) / n;
    list.forEach(([f, label, opts], i) => this.card([X0 + i * (cw + GAP), y, cw, h], f, label, opts));
  }
  // type: clusteredColumnChart | clusteredBarChart | columnChart (stacked) | barChart (stacked)
  // cat: field or [field, name]; vals: list of [measure, name]; opts: series, colors, sort, labels, valueAxis, filters
  bar(type, pos, title, subtitle, cat, vals, opts = {}) {
    const spec = { Category: [cat], Y: vals };
    if (opts.series) spec.Series = [opts.series];
    const objects = Object.assign({
      legend: vals.length > 1 || opts.series ? legendTop() : hidden(),
      labels: opts.labels ? [{ properties: Object.assign({ show: bool(true), fontSize: num(9), color: hex(INK2), fontFamily: str(FONT) }, opts.labels) }] : hidden()
    }, axes(opts.valueAxis));
    objects.dataPoint = opts.colors || [{ properties: { fill: hex(BLUE) } }];
    return this.add(type, pos, {
      query: { queryState: roles(spec), sortDefinition: opts.sort },
      objects, visualContainerObjects: frame(title, subtitle)
    }, opts.filters);
  }
  line(pos, title, subtitle, cat, vals, opts = {}) {
    return this.add('lineChart', pos, {
      query: { queryState: roles({ Category: [cat], Y: vals }), sortDefinition: opts.sort || sortBy(Array.isArray(cat) ? cat[0] : cat, 'Ascending') },
      objects: Object.assign({
        legend: vals.length > 1 ? legendTop() : hidden(),
        lineStyles: [{ properties: { strokeWidth: num(2), showMarker: bool(!!opts.markers), markerSize: num(4) } }],
        labels: hidden(),
        dataPoint: opts.colors || [{ properties: { fill: hex(BLUE) } }]
      }, axes(opts.valueAxis)),
      visualContainerObjects: frame(title, subtitle)
    }, opts.filters);
  }
  // columns (left axis) + lines (right axis) over one category
  combo(pos, title, subtitle, cat, columns, lines, opts = {}) {
    return this.add('lineClusteredColumnComboChart', pos, {
      query: { queryState: roles({ Category: [cat], Y: columns, Y2: lines }), sortDefinition: opts.sort || sortBy(Array.isArray(cat) ? cat[0] : cat, 'Ascending') },
      objects: Object.assign({
        legend: legendTop(),
        labels: hidden(),
        lineStyles: [{ properties: { strokeWidth: num(2), showMarker: bool(true), markerSize: num(4) } }],
        dataPoint: opts.colors || [{ properties: { fill: hex(BLUE) } }]
      }, axes(opts.valueAxis)),
      visualContainerObjects: frame(title, subtitle)
    }, opts.filters);
  }
  // cols: list of [field, name]; opts: sort, totals, widths: [[field, px]], filters
  table(pos, title, subtitle, cols, opts = {}) {
    return this.add('tableEx', pos, {
      query: { queryState: { Values: { projections: items(cols).map(([f, d]) => proj(f, d)) } }, sortDefinition: opts.sort },
      objects: {
        columnHeaders: [{ properties: { fontSize: num(9), fontFamily: str(FONT_SB), fontColor: hex(INK2), backColor: hex(SURFACE), wordWrap: bool(true), outline: str('BottomOnly') } }],
        values: [{ properties: { fontSize: num(9), fontFamily: str(FONT), fontColor: hex(INK), backColorPrimary: hex(SURFACE), backColorSecondary: hex(SURFACE) } }],
        total: [{ properties: { totals: bool(!!opts.totals), fontSize: num(9) } }],
        grid: [{ properties: { gridHorizontal: bool(true), gridHorizontalColor: hex(GRID), gridVertical: bool(false), rowPadding: num(3), outlineColor: hex(LINE) } }],
        columnWidth: (opts.widths || []).map(([f, w]) => ({ properties: { value: num(w) }, selector: { metadata: qref(f) } }))
      },
      visualContainerObjects: frame(title, subtitle)
    }, opts.filters);
  }
  matrix(pos, title, subtitle, rows, columns, vals, opts = {}) {
    return this.add('pivotTable', pos, {
      query: { queryState: {
        Rows: { projections: items(rows).map(([f, d], i) => proj(f, d, i === 0 ? { active: true } : {})) },
        Columns: { projections: items(columns).map(([f, d], i) => proj(f, d, i === 0 ? { active: true } : {})) },
        Values: { projections: items(vals).map(([f, d]) => proj(f, d)) } }, sortDefinition: opts.sort },
      objects: {
        columnHeaders: [{ properties: { fontSize: num(9), fontFamily: str(FONT_SB), fontColor: hex(INK2), backColor: hex(SURFACE), wordWrap: bool(true) } }],
        rowHeaders: [{ properties: { fontSize: num(9), fontFamily: str(FONT), fontColor: hex(INK), backColor: hex(SURFACE) } }],
        values: [{ properties: { fontSize: num(9), fontFamily: str(FONT), fontColor: hex(INK), backColorPrimary: hex(SURFACE), backColorSecondary: hex(SURFACE) } }],
        subTotals: [{ properties: { rowSubtotals: bool(!!opts.subtotals), columnSubtotals: bool(!!opts.subtotals) } }],
        grid: [{ properties: { gridHorizontal: bool(true), gridHorizontalColor: hex(GRID), gridVertical: bool(true), gridVerticalColor: hex(GRID), rowPadding: num(3) } }]
      },
      visualContainerObjects: frame(title, subtitle)
    }, opts.filters);
  }
  waterfall(pos, title, subtitle, cat, val, opts = {}) {
    return this.add('waterfallChart', pos, {
      query: { queryState: roles({ Category: [cat], Y: [val] }), sortDefinition: opts.sort },
      objects: Object.assign({
        legend: hidden(),
        labels: hidden(),
        sentimentColors: [{ properties: { increaseFill: hex(BLUE), decreaseFill: hex(RED), totalFill: hex(NEUTRAL) } }]
      }, axes()),
      visualContainerObjects: frame(title, subtitle)
    }, opts.filters);
  }
  // framed text panel: a heading and paragraphs (for "How to read" pages)
  note(pos, heading, lines) {
    return this.add('textbox', pos, {
      objects: { general: [{ properties: { paragraphs: [
        { textRuns: [{ value: heading, textStyle: { fontSize: '14pt', color: INK, fontFamily: FONT_SB } }] },
        ...lines.flatMap(t => [{ textRuns: [{ value: ' ', textStyle: { fontSize: '5pt' } }] },
          { textRuns: [{ value: t, textStyle: { fontSize: '11.5pt', color: INK2, fontFamily: FONT } }] }])
      ] } }] },
      visualContainerObjects: Object.assign(frame(null), { padding: [{ properties: { top: num(16), bottom: num(16), left: num(20), right: num(20) } }] })
    });
  }
}

// schema versions already used by the project win over the defaults
function detectSchemas(pagesDir) {
  const s = { ...DEFAULT_SCHEMAS };
  if (!fs.existsSync(pagesDir)) return s;
  const pj = path.join(pagesDir, 'pages.json');
  if (fs.existsSync(pj)) { const j = JSON.parse(fs.readFileSync(pj, 'utf8')); if (j.$schema) s.pages = j.$schema; }
  for (const d of fs.readdirSync(pagesDir)) {
    const pf = path.join(pagesDir, d, 'page.json');
    if (fs.existsSync(pf)) { const j = JSON.parse(fs.readFileSync(pf, 'utf8')); if (j.$schema) s.page = j.$schema; }
    const vd = path.join(pagesDir, d, 'visuals');
    if (!fs.existsSync(vd)) continue;
    for (const v of fs.readdirSync(vd)) {
      const vf = path.join(vd, v, 'visual.json');
      if (fs.existsSync(vf)) { const j = JSON.parse(fs.readFileSync(vf, 'utf8')); if (j.$schema) { s.visual = j.$schema; return s; } }
    }
  }
  return s;
}

// reportDir: the X.Report folder. opts: width, height, themeName, palette (array of hex for dataColors), replaceAll
function report(reportDir, opts = {}) {
  const ROOT = path.join(reportDir, 'definition');
  const PAGES_DIR = path.join(ROOT, 'pages');
  if (!fs.existsSync(path.join(ROOT, 'report.json')))
    throw new Error(`${reportDir} is not a PBIR report (no definition/report.json). Save it from Desktop as .pbip with PBIR on first.`);
  const width = opts.width || 1920, height = opts.height || 1080;
  const r = {
    dir: reportDir, pages: [], schemas: detectSchemas(PAGES_DIR), layout: makeLayout(width, height),
    page(displayName, pageOpts = {}) { const p = new Page(r, displayName, pageOpts); r.pages.push(p); return p; },
    write() { writeReport(r, ROOT, PAGES_DIR, { width, height, ...opts }); },
  };
  return r;
}

function writeTheme(reportDir, ROOT, opts) {
  const themeName = (opts.themeName || 'Generated') .replace(/[^\w-]/g, '') + '.json';
  const theme = {
    name: opts.themeName || 'Generated',
    dataColors: opts.palette || [colors.BLUE, colors.ORANGE, colors.AQUA, colors.YELLOW, colors.PINK, colors.GREEN, colors.VIOLET, colors.RED],
    background: SURFACE, foreground: INK, tableAccent: BLUE,
    good: '#0CA30C', neutral: '#FAB219', bad: '#D03B3B', maximum: colors.DARK_BLUE, center: '#F0EFEC', minimum: RED,
    textClasses: {
      callout: { fontSize: 22, fontFace: FONT_SB, color: INK },
      title: { fontSize: 12, fontFace: FONT_SB, color: INK },
      header: { fontSize: 10, fontFace: FONT_SB, color: INK2 },
      label: { fontSize: 9, fontFace: FONT, color: INK2 }
    },
    visualStyles: { page: { '*': { background: [{ color: { solid: { color: PAGE } }, transparency: 0 }], outspace: [{ color: { solid: { color: PAGE } }, transparency: 0 }] } } }
  };
  const regDir = path.join(reportDir, 'StaticResources', 'RegisteredResources');
  fs.mkdirSync(regDir, { recursive: true });
  fs.writeFileSync(path.join(regDir, themeName), JSON.stringify(theme, null, 2));
  const reportPath = path.join(ROOT, 'report.json');
  const rep = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  rep.themeCollection = rep.themeCollection || {};
  const base = rep.themeCollection.baseTheme || {};
  rep.themeCollection.customTheme = { name: themeName, reportVersionAtImport: base.reportVersionAtImport, type: 'RegisteredResources' };
  // add the theme to the registered resources; keep every other item (images, other themes) the report already has
  rep.resourcePackages = rep.resourcePackages || [];
  let reg = rep.resourcePackages.find(x => x.name === 'RegisteredResources');
  if (!reg) { reg = { name: 'RegisteredResources', type: 'RegisteredResources', items: [] }; rep.resourcePackages.push(reg); }
  reg.items = (reg.items || []).filter(it => it.name !== themeName && it.type !== 'CustomTheme');
  reg.items.push({ name: themeName, path: themeName, type: 'CustomTheme' });
  rep.objects = rep.objects || {};
  rep.objects.outspacePane = [{ properties: { expanded: bool(false) } }];
  fs.writeFileSync(reportPath, JSON.stringify(rep, null, 2));
}

// Writes only the pages this build owns: the ones it defines now, plus any it generated last time
// (listed in generated-pages.json next to the build script), so a page dropped from the build goes too.
// Other pages stay, except empty ones (Desktop's blank "Page 1") and everything when opts.replaceAll is set.
// The theme is applied only when it can't restyle the user's own pages: no pages of theirs remain, or the
// report's custom theme is already this one, or opts.theme === true. Generated visuals set their own colours anyway.
function writeReport(r, ROOT, PAGES_DIR, opts) {
  fs.mkdirSync(PAGES_DIR, { recursive: true });
  const manifest = opts.manifest || path.join(path.dirname(process.argv[1] || r.dir), 'generated-pages.json');
  const before = fs.existsSync(manifest) ? JSON.parse(fs.readFileSync(manifest, 'utf8')) : [];
  const mine = new Set([...r.pages.map(p => p.name), ...before]);
  const pj = path.join(PAGES_DIR, 'pages.json');
  const meta = fs.existsSync(pj) ? JSON.parse(fs.readFileSync(pj, 'utf8')) : {};
  const kept = [];
  for (const d of fs.readdirSync(PAGES_DIR)) {
    const full = path.join(PAGES_DIR, d);
    if (!fs.statSync(full).isDirectory()) continue;
    const vd = path.join(full, 'visuals');
    const empty = !fs.existsSync(vd) || fs.readdirSync(vd).length === 0;
    if (mine.has(d) || opts.replaceAll || empty) fs.rmSync(full, { recursive: true, force: true });
    else kept.push(d);
  }
  const current = ((JSON.parse(fs.readFileSync(path.join(ROOT, 'report.json'), 'utf8')).themeCollection || {}).customTheme || {}).name;
  const ours = (opts.themeName || 'Generated').replace(/[^\w-]/g, '') + '.json';
  const applyTheme = opts.theme === true || (opts.theme !== false && (!kept.length || current === ours));
  if (applyTheme) writeTheme(r.dir, ROOT, opts);
  const pageBg = { background: [{ properties: { color: hex(PAGE), transparency: num(0) } }], outspace: [{ properties: { color: hex(PAGE), transparency: num(0) } }] };
  for (const p of r.pages) {
    const dir = path.join(PAGES_DIR, p.name);
    fs.mkdirSync(path.join(dir, 'visuals'), { recursive: true });
    const page = { $schema: r.schemas.page, name: p.name, displayName: p.displayName, displayOption: 'FitToPage', height: opts.height, width: opts.width, objects: pageBg };
    if (p.opts.filters) page.filterConfig = { filters: p.opts.filters };
    if (p.opts.hidden) page.visibility = 'HiddenInViewMode';
    fs.writeFileSync(path.join(dir, 'page.json'), JSON.stringify(page, null, 2));
    for (const v of p.visuals) {
      fs.mkdirSync(path.join(dir, 'visuals', v.name), { recursive: true });
      fs.writeFileSync(path.join(dir, 'visuals', v.name, 'visual.json'), JSON.stringify(v, null, 2));
    }
  }
  // generated pages first in build order, then the user's own pages in their old order
  const oldOrder = (meta.pageOrder || []).filter(n => kept.includes(n));
  const order = [...r.pages.map(p => p.name), ...oldOrder, ...kept.filter(n => !oldOrder.includes(n))];
  // open on the first generated page, so the user lands on what was just built
  fs.writeFileSync(pj, JSON.stringify({ $schema: r.schemas.pages, pageOrder: order, activePageName: order[0] }, null, 2));
  fs.writeFileSync(manifest, JSON.stringify(r.pages.map(p => p.name), null, 2));
  console.log(r.pages.map(p => `${p.displayName}: ${p.visuals.length} visuals`).join('\n'));
  if (kept.length) console.log(`kept ${kept.length} existing page(s) untouched`);
  if (!applyTheme && opts.theme !== false) console.log('report theme left as it was (the report has pages of its own); pass { theme: true } to apply the generated theme');
}

module.exports = { report, colors, C, M, inFilter, cmpFilter, between, topN, sortBy, measureColors, valueColors, frame, bare, lit, str, num, bool, hex, FONT, FONT_SB };
