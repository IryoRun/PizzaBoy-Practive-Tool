'use strict';
// Finds a landing spot for a boss warp that the player is not stuck in.
//
// There is no collision test in the C3 scripting API and behaviours are not
// exposed, so "is this spot solid" cannot be asked directly. What can be asked
// is whether the player actually moves when a real arrow key is delivered --
// which is the thing we actually care about.
//
// Usage: node tools/find-warp-spot.js <layout> [anchorObject]

const { attach } = require('../src/cdp');
const { buildEvalScript } = require('../src/inject');

const layout = process.argv[2];
const anchorObject = process.argv[3] || null;
if (!layout) {
  console.error('usage: node tools/find-warp-spot.js "<layout>" [anchorObject]');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const { session } = await attach(9222, 20000);
  const ev = (e) => session.evaluate(buildEvalScript(e));

  async function key(name, vk, ms) {
    const opts = { key: name, code: name, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    await session.send('Input.dispatchKeyEvent', { type: 'keyDown', ...opts });
    await sleep(ms);
    await session.send('Input.dispatchKeyEvent', { type: 'keyUp', ...opts });
  }

  const playerPos = () => ev(
    '(function(){var p=__PBP.runtime.objects.Player.getFirstInstance();' +
    'return p?[Math.round(p.x),Math.round(p.y)]:null})()'
  );

  await ev(`__PBP.runtime.goToLayout(${JSON.stringify(layout)})`);
  await sleep(2200);

  // Reference points the level itself provides.
  const info = await ev(`(function(){
    var rt = __PBP.runtime;
    var all = function (n) { var o = rt.objects[n]; return o ? o.getAllInstances().map(function(i){return [Math.round(i.x),Math.round(i.y)];}) : []; };
    var p = rt.objects.Player.getFirstInstance();
    return {
      start: p ? [Math.round(p.x), Math.round(p.y)] : null,
      checkpoints: all('checkpoint'),
      bosslock: all('Bosslock'),
      anchor: ${anchorObject ? `all(${JSON.stringify(anchorObject)})` : '[]'}
    };
  })()`);

  const candidates = [];
  const add = (label, x, y) => candidates.push({ label, x, y });

  if (info.start) add('level start', info.start[0], info.start[1]);
  info.checkpoints.forEach((c, i) => add(`checkpoint ${i}`, c[0], c[1]));

  // Dropping from well above turns "is this spot solid?" -- which the API
  // cannot answer -- into "where does the player come to rest?", which it can.
  // A spot that neither falls nor moves is embedded in level geometry.
  const dropFrom = (x, y) => y - 380;
  info.bosslock.forEach((b, i) => {
    for (const dx of [-96, -48, 48, 96]) add(`bosslock ${i} dx${dx} drop`, b[0] + dx, dropFrom(b[0], b[1]));
  });
  info.anchor.forEach((a, i) => {
    for (const dx of [-420, -320, -220, -140, 140, 220]) {
      add(`${anchorObject} ${i} dx${dx} drop`, a[0] + dx, dropFrom(a[0], a[1]));
    }
  });

  console.log(`layout: ${layout}`);
  console.log(`reference points: ${JSON.stringify(info)}\n`);

  const results = [];
  for (const c of candidates) {
    // The player can die mid-scan (spikes, pits); re-enter the layout if so.
    if (!await playerPos()) {
      await ev(`__PBP.runtime.goToLayout(${JSON.stringify(layout)})`);
      await sleep(2000);
      if (!await playerPos()) { console.log(`  ---- ${c.label}: no player, skipped`); continue; }
    }

    await ev(`(function(){var p=__PBP.runtime.objects.Player.getFirstInstance();` +
             `if(p){p.x=${c.x};p.y=${c.y};}})()`);
    await sleep(900);                       // let it fall and settle
    const settled = await playerPos();
    if (!settled) { console.log(`  DIED   ${c.label}`); continue; }

    await key('ArrowRight', 39, 420);
    await sleep(150);
    const afterRight = await playerPos();
    await key('ArrowLeft', 37, 420);
    await sleep(150);
    const afterLeft = await playerPos();
    if (!afterRight || !afterLeft) { console.log(`  DIED   ${c.label} (while moving)`); continue; }

    const fell = settled[1] - c.y;
    const dRight = afterRight[0] - settled[0];
    const dLeft = afterLeft[0] - afterRight[0];
    const free = Math.abs(dRight) > 20 || Math.abs(dLeft) > 20;
    results.push({ ...c, settled, dRight, dLeft, free });
    console.log(
      `  ${free ? 'FREE ' : 'STUCK'}  ${c.label.padEnd(28)} ` +
      `-> ${settled[0]},${settled[1]} (fell ${fell})  right ${dRight}  left ${dLeft}`
    );
  }

  const good = results.filter((r) => r.free);
  console.log(`\n${good.length}/${results.length} candidates are free.`);
  session.close();
}

main().catch((err) => { console.error(err.message); process.exit(1); });
