'use strict';
// Host-side persistence for savestates. The payload keeps states in memory
// for instant reload and mirrors every change here, so slots survive a
// restart of the game or the tool.

const fs = require('fs');
const path = require('path');

const STATES_DIR = path.join(__dirname, '..', 'states');

function slotFile(slot) {
  return path.join(STATES_DIR, `slot-${slot}.json`);
}

function ensureDir() {
  fs.mkdirSync(STATES_DIR, { recursive: true });
}

/** Every stored slot, as [slot, entry] pairs. Corrupt files are skipped. */
function loadAll() {
  if (!fs.existsSync(STATES_DIR)) return [];
  const out = [];
  for (const name of fs.readdirSync(STATES_DIR)) {
    const m = name.match(/^slot-(\d+)\.json$/);
    if (!m) continue;
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(STATES_DIR, name), 'utf8'));
      if (entry && typeof entry.json === 'string') out.push([Number(m[1]), entry]);
    } catch {
      // A half-written or hand-edited file should not stop the tool starting.
    }
  }
  return out.sort((a, b) => a[0] - b[0]);
}

const ANCHORS_FILE = path.join(STATES_DIR, 'warp-anchors.json');

function loadAnchors() {
  try { return JSON.parse(fs.readFileSync(ANCHORS_FILE, 'utf8')); } catch { return {}; }
}

function writeAnchors(map) {
  ensureDir();
  fs.writeFileSync(ANCHORS_FILE, JSON.stringify(map, null, 1), 'utf8');
}

function write(slot, entry) {
  ensureDir();
  // Write via a temp file so an interrupted save cannot corrupt a good slot.
  const tmp = slotFile(slot) + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entry), 'utf8');
  fs.renameSync(tmp, slotFile(slot));
}

function remove(slot) {
  try { fs.unlinkSync(slotFile(slot)); } catch { /* already gone */ }
}

/**
 * Wire the page's __pbpHost bridge to disk, and push any stored slots into
 * the freshly loaded payload. Returns the number of slots restored.
 */
async function attachBridge(session, { log = () => {} } = {}) {
  await session.send('Runtime.addBinding', { name: '__pbpHost' });
  session.on('Runtime.bindingCalled', (params) => {
    if (params.name !== '__pbpHost') return;
    let msg;
    try { msg = JSON.parse(params.payload); } catch { return; }
    try {
      if (msg.action === 'save' && msg.state) write(msg.slot, msg.state);
      else if (msg.action === 'clear') remove(msg.slot);
      else if (msg.action === 'anchor') {
        const map = loadAnchors();
        map[msg.key] = msg.pos;
        writeAnchors(map);
      } else if (msg.action === 'anchor-clear') {
        const map = loadAnchors();
        delete map[msg.key];
        writeAnchors(map);
      }
    } catch (err) {
      log(`could not persist ${msg.action}: ${err.message}`);
    }
  });

  const stored = loadAll();
  for (const [slot, entry] of stored) {
    await session.evaluate(
      `window.__PBP.states.adopt(${slot}, ${JSON.stringify(entry)})`,
      { returnByValue: true }
    );
  }

  const anchors = loadAnchors();
  const anchorCount = await session.evaluate(
    `window.__PBP.warp.adoptAnchors(${JSON.stringify(anchors)})`,
    { returnByValue: true }
  );
  return { slots: stored.length, anchors: anchorCount || 0 };
}

module.exports = { STATES_DIR, loadAll, write, remove, attachBridge };
