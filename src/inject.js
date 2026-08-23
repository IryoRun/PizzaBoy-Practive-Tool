'use strict';
// Assembles the payload files into one script and installs it in the page.

const fs = require('fs');
const path = require('path');

const PAYLOAD_DIR = path.join(__dirname, 'payload');

/** Concatenate payload/*.js in filename order (the numeric prefixes order them). */
function readPayload() {
  const files = fs.readdirSync(PAYLOAD_DIR).filter((f) => f.endsWith('.js')).sort();
  return files
    .map((f) => `/* ---- ${f} ---- */\n` + fs.readFileSync(path.join(PAYLOAD_DIR, f), 'utf8'))
    .join('\n');
}

/** The full practice-tool payload, as a standalone script. */
function buildBootScript() {
  return `(function () {\n'use strict';\n${readPayload()}\n})();`;
}

/** An expression evaluated in the page, with __PBP already installed. */
function buildEvalScript(expression) {
  return `(function () {\n'use strict';\nreturn (${expression});\n})()`;
}

/**
 * Install the payload so it runs before the game's own scripts on the next
 * navigation, then reload to make that happen. runOnStartup callbacks are
 * consumed once during boot, so there is no way to attach to an already
 * running runtime -- the reload is required, not a convenience.
 */
async function installAndReload(session) {
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  const { identifier } = await session.send('Page.addScriptToEvaluateOnNewDocument', {
    source: buildBootScript(),
  });

  // Wait for the new document before anyone polls for readiness. Without
  // this, a poll can still be answered by the outgoing page -- which reports
  // the *previous* payload as ready -- and the next call then lands in the
  // fresh context where the runtime does not exist yet.
  const loaded = new Promise((resolve) => {
    const off = session.on('Page.loadEventFired', () => { off(); resolve(); });
    setTimeout(() => { off(); resolve(); }, 30000);
  });
  await session.send('Page.reload', { ignoreCache: false });
  await loaded;
  return identifier;
}

/**
 * Wait for the payload to reach a given stage.
 *   'ready'   - the runtime object exists (during startup, no layout yet)
 *   'started' - the first layout is running; safe to touch layouts/instances
 */
async function waitForRuntime(session, stage = 'started', timeoutMs = 120000) {
  const flag = stage === 'ready' ? '_ready' : '_started';
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      if (await session.evaluate(`!!(window.__PBP && window.__PBP.${flag})`)) return true;
    } catch (err) {
      lastErr = err; // the page swaps execution contexts during the reload
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Payload did not reach "${stage}" within ${timeoutMs}ms${lastErr ? ` (last: ${lastErr.message})` : ''}`
  );
}

module.exports = { buildBootScript, buildEvalScript, installAndReload, waitForRuntime, readPayload, PAYLOAD_DIR };
