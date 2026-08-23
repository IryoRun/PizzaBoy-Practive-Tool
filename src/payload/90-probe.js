// --- Global-variable recorder (diagnostic) -----------------------------
// Off by default; costs nothing until started.
//
// Open question: what does the game set when it takes the controls away?
// Event groups are ruled out -- all 108 are declared active and none is ever
// toggled by name -- so the lock lives in conditions on some global. Knowing
// which one, and which values mean "locked", is what stands between the
// hold-to-fast-forward key and an automatic version.
//
// Start this, walk into a scripted stretch, stop it, and dump(): the result is
// every global that changed and the values it took, timestamped. That should
// name the culprit in one run.

(function () {
  const PBP = window.__PBP;
  if (!PBP) return;

  const DEFAULT_WATCH = [
    'Player_state', 'dia', 'dia_type', 'dia_line', 'scene_ready', 'skip',
    'room_instant', 'pause', 'jump_able', 'dashcheck', 'spin', 'timer',
    'Boss_active', 'Health', 'facing', 'dir',
  ];

  let watching = null;
  let handle = null;
  let last = null;
  let log = [];
  let t0 = 0;

  function snapshot(keys) {
    const g = PBP.runtime.globalVars;
    const out = {};
    for (const k of keys) { try { out[k] = g[k]; } catch (err) { /* not a global */ } }
    return out;
  }

  function tick() {
    if (!watching) return;
    const now = snapshot(watching);
    for (const k of watching) {
      if (now[k] !== last[k]) {
        log.push({ t: Math.round(performance.now() - t0), key: k, from: last[k], to: now[k] });
      }
    }
    last = now;
    if (log.length > 5000) watching = null; // runaway guard
    handle = requestAnimationFrame(tick);
  }

  PBP.probe = {
    /** Begin recording changes. Pass a list of globals, or use the default set. */
    start(keys) {
      watching = Array.isArray(keys) && keys.length ? keys : DEFAULT_WATCH;
      // "all" records every global, useful when the default set misses it.
      if (keys === 'all') watching = Object.keys(PBP.runtime.globalVars);
      last = snapshot(watching);
      log = [];
      t0 = performance.now();
      if (handle) cancelAnimationFrame(handle);
      handle = requestAnimationFrame(tick);
      PBP.log(`probe recording ${watching.length} globals`);
      return watching.length;
    },
    stop() {
      watching = null;
      if (handle) { cancelAnimationFrame(handle); handle = null; }
      return log.length;
    },
    dump() { return log; },
    /** Which globals changed at all, and the distinct values each took. */
    summary() {
      const byKey = new Map();
      for (const e of log) {
        if (!byKey.has(e.key)) byKey.set(e.key, new Set([e.from]));
        byKey.get(e.key).add(e.to);
      }
      return [...byKey].map(([key, vals]) => ({ key, values: [...vals] }));
    },
    get recording() { return !!watching; },
  };
})();
