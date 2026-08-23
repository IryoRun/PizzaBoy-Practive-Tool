'use strict';
// Reads the extracted data.json and reports how the project is wired:
// layouts, their event sheets, and which layouts each sheet names.
// Usage: node tools/dump-project.js <extracted-dir> [sheetName ...]

const fs = require('fs');
const path = require('path');

const dir = process.argv[2];
if (!dir) {
  console.error('usage: node tools/dump-project.js <extracted-dir> [sheet ...]');
  process.exit(1);
}

const project = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8')).project;
const [, , LAYOUTS_I, SHEETS_I] = [0, 0, 5, 6];
const layouts = project[LAYOUTS_I];
const sheets = project[SHEETS_I];
const types = project[3];

const layoutNames = new Set(layouts.map((l) => l[0]));

/** Every string literal anywhere inside a value. */
function stringsIn(node, out = new Set()) {
  if (Array.isArray(node)) for (const c of node) stringsIn(c, out);
  else if (typeof node === 'string') out.add(node);
  return out;
}

/** Object type indices referenced by instances placed on a layout. */
function typesOnLayout(layout) {
  const counts = new Map();
  for (const layer of layout[10] || []) {
    for (const inst of layer[14] || []) {
      counts.set(inst[1], (counts.get(inst[1]) || 0) + 1);
    }
  }
  return counts;
}

const wanted = process.argv.slice(3);

if (wanted.length) {
  for (const name of wanted) {
    const sheet = sheets.find((s) => s[0] === name);
    if (!sheet) { console.log(`## ${name}: NOT FOUND`); continue; }
    const strs = [...stringsIn(sheet[1])];
    const targets = strs.filter((s) => layoutNames.has(s));
    const includes = (sheet[1] || []).filter((e) => Array.isArray(e) && e[0] === 2).map((e) => e[1]);
    console.log(`## sheet "${name}" (${sheet[1].length} top-level events)`);
    console.log(`   includes : ${includes.join(', ') || '-'}`);
    console.log(`   layouts  : ${targets.join(', ') || '-'}`);
    console.log(`   strings  : ${strs.filter((s) => !layoutNames.has(s)).slice(0, 40).join(' | ')}`);
    console.log();
  }
  process.exit(0);
}

console.log(`layouts: ${layouts.length}, sheets: ${sheets.length}, object types: ${types.length}\n`);
for (const l of layouts) {
  const counts = typesOnLayout(l);
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  console.log(`${l[0]}  [${l[1]}x${l[2]}]  sheet=${l[8] || '-'}  instances=${total}`);
}
