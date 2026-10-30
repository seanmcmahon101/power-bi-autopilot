// Writes the fictional Acme Parts sample data: data/sales.csv, data/customers.csv, data/products.xlsx.
// Deterministic (seeded), no dependencies: node make-data.js
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

let seed = 42;
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = a => a[Math.floor(rnd() * a.length)];
const out = path.join(__dirname, 'data');
fs.mkdirSync(out, { recursive: true });

// ---------- customers ----------
const regions = { North: ['United Kingdom', 'Ireland', 'Norway'], Central: ['Germany', 'Netherlands', 'Poland'], South: ['Spain', 'Italy', 'France'] };
const segments = ['Distributor', 'OEM', 'Service'];
const first = ['Alder', 'Birch', 'Cedar', 'Delta', 'Ember', 'Falcon', 'Granite', 'Harbor', 'Iris', 'Juniper', 'Kestrel', 'Linden', 'Maple', 'Nova', 'Orbit', 'Pine', 'Quarry', 'River', 'Summit', 'Tidal'];
const last = ['Engineering', 'Hydraulics', 'Machinery', 'Industrial', 'Systems', 'Fluid Power', 'Equipment', 'Motion'];
const customers = [];
const usedNames = new Set();
for (let i = 1; i <= 60; i++) {
  const region = pick(Object.keys(regions));
  let name;
  do name = `${pick(first)} ${pick(last)}`; while (usedNames.has(name));
  usedNames.add(name);
  customers.push({ CustomerID: `C${String(i).padStart(3, '0')}`, CustomerName: name, Region: region, Country: pick(regions[region]), Segment: pick(segments) });
}

// ---------- products ----------
const cats = { Valves: ['Cartridge valve', 'Relief valve', 'Check valve'], Pumps: ['Gear pump', 'Piston pump'], Fittings: ['Hose fitting', 'Adapter', 'Manifold block'] };
const products = [];
let pid = 1;
for (const [cat, subs] of Object.entries(cats)) for (const sub of subs) for (let k = 1; k <= 4; k++) {
  const cost = Math.round((cat === 'Pumps' ? 120 : cat === 'Valves' ? 35 : 8) * (0.6 + rnd()) * 100) / 100;
  products.push({ ProductID: `P${String(pid++).padStart(3, '0')}`, ProductName: `${sub} ${String.fromCharCode(64 + k)}${Math.floor(rnd() * 90 + 10)}`, Category: cat, Subcategory: sub,
    UnitCost: cost, ListPrice: Math.round(cost * (1.35 + rnd() * 0.5) * 100) / 100 });
}

// ---------- sales lines, Jan 2024 to Sep 2026, gentle growth and seasonality ----------
const sales = [];
const start = Date.UTC(2024, 0, 1), end = Date.UTC(2026, 8, 30);
let line = 1;
for (let t = start; t <= end; t += 86400000) {
  const d = new Date(t);
  if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
  const growth = 1 + (t - start) / (end - start) * 0.35;
  const season = 1 + 0.2 * Math.sin((d.getUTCMonth() + 1) / 12 * 2 * Math.PI);
  const n = Math.round((4 + rnd() * 6) * growth * season);
  for (let i = 0; i < n; i++) {
    const p = pick(products), c = pick(customers);
    const ship = new Date(t + Math.floor(2 + rnd() * 12) * 86400000);
    const discount = c.Segment === 'Distributor' ? 0.1 : c.Segment === 'OEM' ? 0.05 : 0;
    sales.push({ OrderLineID: line++, OrderDate: d.toISOString().slice(0, 10), ShipDate: ship.toISOString().slice(0, 10), CustomerID: c.CustomerID, ProductID: p.ProductID,
      Quantity: Math.ceil(rnd() * (p.Category === 'Fittings' ? 60 : 12)), UnitPrice: Math.round(p.ListPrice * (1 - discount) * 100) / 100 });
  }
}

const csv = rows => [Object.keys(rows[0]).join(','), ...rows.map(r => Object.values(r).map(v => /[",]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : v).join(','))].join('\r\n') + '\r\n';
fs.writeFileSync(path.join(out, 'sales.csv'), csv(sales));
fs.writeFileSync(path.join(out, 'customers.csv'), csv(customers));
fs.writeFileSync(path.join(out, 'products.xlsx'), xlsx('Products', products));
console.log(`sales ${sales.length} rows, customers ${customers.length}, products ${products.length}`);

// ---------- minimal .xlsx writer (one sheet, inline strings) ----------
function xlsx(sheetName, rows) {
  const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const col = i => String.fromCharCode(65 + i);
  const cell = (v, r, c) => typeof v === 'number' ? `<c r="${col(c)}${r}"><v>${v}</v></c>` : `<c r="${col(c)}${r}" t="inlineStr"><is><t>${esc(v)}</t></is></c>`;
  const keys = Object.keys(rows[0]);
  const sheetRows = [keys, ...rows.map(r => keys.map(k => r[k]))].map((vals, i) => `<row r="${i + 1}">${vals.map((v, c) => cell(v, i + 1, c)).join('')}</row>`).join('');
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${esc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
  };
  return zip(files);
}
function zip(files) {
  const locals = [], centrals = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8'), comp = zlib.deflateRawSync(data), crc = zlib.crc32(data), nm = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, nm, comp); centrals.push(ch, nm);
    offset += 30 + nm.length + comp.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}
