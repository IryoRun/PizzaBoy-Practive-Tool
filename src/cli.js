#!/usr/bin/env node
'use strict';

const { attach, DEFAULT_PORT } = require('./cdp');
const launcher = require('./launcher');
const { buildEvalScript, installAndReload, waitForRuntime } = require('./inject');
const states = require('./states');

const PORT = Number(process.env.PIZZABOY_PORT || DEFAULT_PORT);

function log(...a) { console.log('[pbp]', ...a); }

/** Start the game if needed, then attach a CDP session to its page. */
async function connect({ autoLaunch = true } = {}) {
  const gameDir = launcher.findGameDir();
  const running = launcher.isGameRunning();

  if (!running) {
    if (!autoLaunch) throw new Error('PizzaBoy is not running. Start it with: npm start');
    const res = launcher.ensureDebugPort(gameDir, PORT);
    if (res.status !== 'already-set') {
      log(`added ${'--remote-debugging-port='}${PORT} to package.json (backup: package.json.original)`);
    }
    log('starting PizzaBoy via Steam...');
    launcher.launch(gameDir);
  } else {
    log('PizzaBoy already running; attaching.');
  }

  log(`waiting for the game page on port ${PORT}...`);
  const { session, target } = await attach(PORT, 120000);
  log(`attached to ${target.url}`);
  return { session, gameDir, wasRunning: running };
}

/** Launch (or attach), inject the practice payload, and keep the session open. */
async function cmdRun() {
  const { session, wasRunning } = await connect();
  if (wasRunning) log('note: reloading the page to inject -- unsaved progress in the running game is lost.');
  log('installing payload and reloading...');
  await installAndReload(session);
  await waitForRuntime(session);
  const restored = await states.attachBridge(session, { log });
  const info = await session.evaluate(buildEvalScript(`({
    layout: __PBP.currentLayout(),
    globals: __PBP.runtime ? Object.keys(__PBP.runtime.globalVars || {}).length : 0
  })`));
  log(`payload live. layout="${info.layout}", ${info.globals} globals reachable.`);
  log(`restored from disk: ${restored.slots} savestate slot(s), ${restored.anchors} warp point(s) (${states.STATES_DIR}).`);
  log('press Ctrl+C to detach (the game keeps running).');
  await new Promise(() => {}); // stay attached
}

/** Inspect the runtime: what the scripting API actually offers us. */
async function cmdProbe() {
  const { session } = await connect();
  await installAndReload(session);
  await waitForRuntime(session);
  const report = await session.evaluate(buildEvalScript(`(function () {
    const rt = __PBP.runtime;
    const proto = Object.getPrototypeOf(rt);
    const safe = (fn, fallback) => { try { return fn(); } catch (e) { return fallback + ': ' + e.message; } };
    return {
      layout: safe(() => rt.layout && rt.layout.name, '<no layout>'),
      runtimeMethods: Object.getOwnPropertyNames(proto).filter(k => { try { return typeof rt[k] === 'function'; } catch (e) { return false; } }).sort(),
      runtimeProps: Object.getOwnPropertyNames(proto).filter(k => { try { return typeof rt[k] !== 'function'; } catch (e) { return false; } }).sort(),
      globalCount: Object.keys(rt.globalVars || {}).length,
      globalNames: Object.keys(rt.globalVars || {}),
      objectCount: Object.keys(rt.objects || {}).length,
      sampleGlobals: ['Chapter','Boss_active','Health','dev_mode','BuildType','dia','pause','skip','Player_state']
        .reduce((acc, k) => { acc[k] = rt.globalVars[k]; return acc; }, {})
    };
  })()`));
  console.log(JSON.stringify(report, null, 2));
  session.close();
}

/** Development helper: evaluate an expression against the live runtime. */
async function cmdEval() {
  const expr = process.argv.slice(3).join(' ');
  if (!expr) throw new Error('usage: node src/cli.js eval "<expression>"');
  const { session } = await connect({ autoLaunch: false });
  const ready = await session.evaluate('!!(window.__PBP && window.__PBP._ready)');
  if (!ready) throw new Error('Payload is not loaded in the running game. Start it with: npm start');
  console.log(JSON.stringify(await session.evaluate(buildEvalScript(expr)), null, 2));
  session.close();
}

/** Grab a PNG of the game window -- proof that a warp actually looks right. */
async function cmdShot() {
  const out = process.argv[3] || `shot-${Date.now()}.png`;
  const { session } = await connect({ autoLaunch: false });
  const { data } = await session.send('Page.captureScreenshot', { format: 'png' });
  require('fs').writeFileSync(out, Buffer.from(data, 'base64'));
  log(`wrote ${out}`);
  session.close();
}

/**
 * Check everything the tool needs, without launching anything. This is what
 * to run first when "start practicetool" does not work.
 */
async function cmdDoctor() {
  const rows = [];
  let fatal = 0;

  const major = Number(process.versions.node.split('.')[0]);
  const nodeOk = major >= 22 && typeof WebSocket === 'function';
  rows.push([nodeOk, `Node.js ${process.versions.node}`,
    nodeOk ? 'ok' : 'need v22 or newer (this build has no global WebSocket)']);
  if (!nodeOk) fatal++;

  let gameDir = null;
  try {
    gameDir = launcher.findGameDir();
    rows.push([true, 'PizzaBoy install', gameDir]);
  } catch (err) {
    rows.push([false, 'PizzaBoy install', err.message]);
    fatal++;
  }

  if (gameDir) {
    try {
      const { json } = launcher.readPackageJson(gameDir);
      const args = json['chromium-args'] || '';
      const m = args.match(/--remote-debugging-port=(\d+)/);
      rows.push([!!m, 'debug port in package.json',
        m ? `port ${m[1]}` : `missing - "npm start" will add it (may need an admin terminal)`]);
    } catch (err) {
      rows.push([false, 'game package.json', err.message]);
      fatal++;
    }
  }

  rows.push([true, 'game running', launcher.isGameRunning() ? 'yes' : 'no (will be started)']);
  rows.push([true, 'savestate folder', states.STATES_DIR]);

  for (const [ok, label, detail] of rows) {
    console.log(`  ${ok ? '[ok]  ' : '[FAIL]'} ${label.padEnd(26)} ${detail}`);
  }
  console.log(fatal ? `\n${fatal} problem(s) above must be fixed first.` : '\nAll good - run "start practicetool" to play.');
  if (fatal) process.exitCode = 1;
}

const COMMANDS = { run: cmdRun, probe: cmdProbe, eval: cmdEval, shot: cmdShot, doctor: cmdDoctor };

async function main() {
  const cmd = process.argv[2] || 'run';
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.error(`Unknown command "${cmd}". Available: ${Object.keys(COMMANDS).join(', ')}`);
    process.exit(1);
  }
  try {
    await fn();
  } catch (err) {
    console.error(`[pbp] ${err.message}`);
    process.exit(1);
  }
}

main();
