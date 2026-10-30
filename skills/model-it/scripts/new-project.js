#!/usr/bin/env node
// Creates an empty Power BI project (.pbip with a PBIR report and a TMDL model) without opening Desktop,
// from the blank project in ../template (saved by Power BI Desktop, theme and auto date/time removed).
//
// Usage: node new-project.js <folder> <Name> [--culture en-US]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const ci = args.indexOf('--culture');
const culture = ci >= 0 ? args[ci + 1] : null;
const [folder, name] = args.filter((a, i) => !a.startsWith('--') && !(ci >= 0 && i === ci + 1));
if (!folder || !name) { console.log('Usage: node new-project.js <folder> <Name> [--culture en-US]'); process.exit(1); }
if (/[<>:"/\\|?*]/.test(name)) { console.log(`"${name}" has characters Windows doesn't allow in file names`); process.exit(1); }

const dest = path.resolve(folder);
const deepest = dest.length + name.length + 87;
if (deepest >= 250) { console.log(`Too deep: files would reach ~${deepest} characters (Windows limit 260). Use a shorter folder.`); process.exit(1); }
for (const p of [`${name}.pbip`, `${name}.Report`, `${name}.SemanticModel`])
  if (fs.existsSync(path.join(dest, p))) { console.log(`${path.join(dest, p)} already exists; not overwriting.`); process.exit(1); }

const tpl = path.join(__dirname, '..', 'template');
const copy = (from, to) => {
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, e.name), dst = path.join(to, e.name.replace(/^Blank\./, `${name}.`));
    if (e.isDirectory()) { fs.mkdirSync(dst, { recursive: true }); copy(src, dst); }
    else fs.copyFileSync(src, dst);
  }
};
fs.mkdirSync(dest, { recursive: true });
copy(tpl, dest);

const edit = (rel, fn) => { const f = path.join(dest, rel); fs.writeFileSync(f, fn(fs.readFileSync(f, 'utf8'))); };
const json = s => JSON.stringify(s).slice(1, -1);
edit(`${name}.pbip`, s => s.replace('"Blank.Report"', `"${json(`${name}.Report`)}"`));
edit(`${name}.Report/definition.pbir`, s => s.replace('"../Blank.SemanticModel"', `"${json(`../${name}.SemanticModel`)}"`));
for (const item of ['Report', 'SemanticModel'])
  edit(`${name}.${item}/.platform`, s => s.replace('"displayName": "Blank"', `"displayName": "${json(name)}"`).replace(/"logicalId": "[^"]+"/, `"logicalId": "${crypto.randomUUID()}"`));

if (culture && culture !== 'en-GB') {
  edit(`${name}.SemanticModel/definition/model.tmdl`, s => s.replace(/en-GB/g, culture));
  const cdir = path.join(dest, `${name}.SemanticModel`, 'definition', 'cultures');
  fs.rmSync(path.join(cdir, 'en-GB.tmdl'));
  fs.writeFileSync(path.join(cdir, `${culture}.tmdl`), `cultureInfo ${culture}\n\n`);
}

// keep Desktop's local cache and settings out of git
const gi = path.join(dest, '.gitignore');
const want = ['**/.pbi/localSettings.json', '**/.pbi/cache.abf'];
const have = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
const missing = want.filter(l => !have.includes(l));
if (missing.length) fs.appendFileSync(gi, (have && !have.endsWith('\n') ? '\n' : '') + missing.join('\n') + '\n');

console.log(`Created ${path.join(dest, `${name}.pbip`)} (report + empty model${culture ? `, culture ${culture}` : ''}).`);
