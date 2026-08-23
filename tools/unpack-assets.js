const fs = require('fs'), path = require('path');
const SRC = "C:/Program Files (x86)/Steam/steamapps/common/PizzaBoy/www/assets.dat";
const OUT = process.argv[2];
const SEP = String.fromCharCode(92);
const b = fs.readFileSync(SRC);

if (b.toString('latin1', 0, 4) !== 'c3ab') throw new Error('bad magic');
let p = Number(b.readBigUInt64BE(4));
const chunk = b.toString('latin1', p, p + 4); p += 4;
const dirSize = Number(b.readBigUInt64BE(p)); p += 8;
const count = b.readUInt32BE(p); p += 4;
console.log(`chunk=${chunk} dirSize=${dirSize} count=${count} entriesStart=${p}`);

const entries = [];
for (let i = 0; i < count; i++) {
  const res   = b.readBigUInt64BE(p); p += 8;
  const off   = Number(b.readBigUInt64BE(p)); p += 8;
  const size  = Number(b.readBigUInt64BE(p)); p += 8;
  const usize = Number(b.readBigUInt64BE(p)); p += 8;
  const flag  = b.readUInt8(p); p += 1;
  const nlen  = b.readUInt32BE(p); p += 4;
  const name  = b.toString('utf8', p, p + nlen); p += nlen;
  entries.push({ res: res.toString(), off, size, usize, flag, name });
}
console.log('chunk2 tag=' + b.toString('latin1', p, p+4) + ' size=' + b.readBigUInt64BE(p+4));
const dataStart = p + 12;
const last = entries[entries.length - 1];
console.log(`dataStart=${dataStart} (dirEnd=${32 + dirSize}) fileLen=${b.length}`);
console.log(`last: ${last.name} off=${last.off} size=${last.size} -> end=${dataStart + last.off + last.size}`);
console.log(`flags seen: ${[...new Set(entries.map(e => e.flag))].join(',')}`);
console.log(`size!=usize: ${entries.filter(e => e.size !== e.usize).length}`);
console.log(`nonzero res: ${entries.filter(e => e.res !== '0').length}`);

if (!OUT) { entries.slice(0, 25).forEach(e => console.log('  ', e.size, e.name)); process.exit(0); }
for (const e of entries) {
  const dest = path.join(OUT, e.name.split(SEP).join('/'));
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, b.subarray(dataStart + e.off, dataStart + e.off + e.size));
}
fs.writeFileSync(path.join(OUT, '_manifest.json'), JSON.stringify(entries, null, 1));
console.log(`extracted ${entries.length} files -> ${OUT}`);
