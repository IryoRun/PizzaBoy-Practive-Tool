'use strict';
// Warps to every boss target in turn and checks the player can actually walk
// where it lands. Catches the failure mode that matters most -- landing inside
// level geometry -- which no amount of reading coordinates will reveal.
//
// Usage: node tools/verify-warps.js      (the tool must already be attached)

const { attach } = require('../src/cdp');
const { buildEvalScript } = require('../src/inject');

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

  const pos = () => ev(
    '(function(){var p=__PBP.runtime.objects.Player.getFirstInstance();' +
    'return p?[Math.round(p.x),Math.round(p.y)]:null})()'
  );

  const targets = await ev('__PBP.warp.list()');
  let bad = 0;

  for (const t of targets) {
    await ev(`__PBP.warp.to(${JSON.stringify(t.key)})`);
    await sleep(1500);

    const layout = await ev('__PBP.currentLayout()');
    const start = await pos();

    if (!start) {
      const expected = /rhythm/.test(t.note || '');
      console.log(`  ${expected ? 'ok   ' : 'FAIL '} ${t.key.padEnd(4)} ${t.label.padEnd(22)} ` +
                  `${layout} - no player${expected ? ' (expected)' : ''}`);
      if (!expected) bad++;
      continue;
    }

    await key('ArrowRight', 39, 420);
    await sleep(150);
    const right = await pos();
    await key('ArrowLeft', 37, 420);
    await sleep(150);
    const left = await pos();

    if (!right || !left) {
      console.log(`  FAIL  ${t.key.padEnd(4)} ${t.label.padEnd(22)} died while walking`);
      bad++;
      continue;
    }
    const dR = right[0] - start[0];
    const dL = left[0] - right[0];
    const free = Math.abs(dR) > 20 || Math.abs(dL) > 20;

    // Walking is not enough: if the camera stayed in another room you are
    // playing blind. The visible area is the canvas divided by the layout
    // scale -- at scale 3.2 that is only 400x225 world units, so "a few
    // hundred pixels off" already means off-screen.
    const view = await ev(`(function(){
      var rt = __PBP.runtime, L = rt.layout, vp = rt.getViewportSize();
      return { sx: L.scrollX, sy: L.scrollY, halfW: vp[0] / L.scale / 2, halfH: vp[1] / L.scale / 2 };
    })()`);
    const dx = Math.round(Math.abs(view.sx - left[0]));
    const dy = Math.round(Math.abs(view.sy - left[1]));
    const onScreen = dx < view.halfW * 0.8 && dy < view.halfH * 0.8;

    if (!free || !onScreen) bad++;
    const verdict = !free ? 'STUCK' : (!onScreen ? 'BLIND' : 'ok   ');
    console.log(`  ${verdict} ${t.key.padEnd(4)} ${t.label.padEnd(22)} ` +
                `at ${start[0]},${start[1]}  walk ${dR}/${dL}  ` +
                `off-centre ${dx},${dy} of ${Math.round(view.halfW)},${Math.round(view.halfH)}`);
  }

  console.log(bad ? `\n${bad} target(s) need attention.` : '\nAll targets land somewhere walkable.');
  session.close();
  process.exitCode = bad ? 1 : 0;
}

main().catch((err) => { console.error(err.message); process.exit(1); });
