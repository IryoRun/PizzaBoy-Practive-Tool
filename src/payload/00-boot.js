// --- Bootstrap ---------------------------------------------------------
// Establishes the window.__PBP namespace and captures the C3 IRuntime.
//
// The runtime object is never exposed on window and lives behind private
// class fields, so it cannot be found by walking the object graph. The
// supported way in is runOnStartup(): C3 collects those callbacks in an array
// and invokes each with the IRuntime while booting. That array is consumed
// exactly once, so this file must run BEFORE the game's own scripts -- it is
// installed via Page.addScriptToEvaluateOnNewDocument.

(function () {
  if (window.__PBP && window.__PBP.installed) return;

  const PBP = window.__PBP = {
    installed: true,
    version: '0.1.0',
    runtime: null,
    log(...args) { console.log('%c[PBP]', 'color:#e8b03a;font-weight:bold', ...args); },
    warn(...args) { console.warn('[PBP]', ...args); },
  };

  let resolveReady, resolveStarted;
  PBP.ready = new Promise((res) => { resolveReady = res; });
  PBP.started = new Promise((res) => { resolveStarted = res; });
  PBP._started = false;
  PBP._onStart = [];

  /** Register a callback that runs once the first layout is running. */
  PBP.onStart = function (fn) {
    if (PBP._started) { try { fn(PBP.runtime); } catch (err) { PBP.warn('start hook failed:', err); } }
    else PBP._onStart.push(fn);
  };

  /** Current layout name, or null while none is running. */
  PBP.currentLayout = function () {
    try { return PBP.runtime.layout.name; } catch (err) { return null; }
  };

  // Small event bus so feature modules (states, warps) can report what they
  // did without knowing whether an overlay is listening.
  const listeners = new Map();
  PBP.on = function (name, fn) {
    if (!listeners.has(name)) listeners.set(name, new Set());
    listeners.get(name).add(fn);
    return () => listeners.get(name).delete(fn);
  };
  PBP.emit = function (name, data) {
    const set = listeners.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(data, name); } catch (err) { PBP.warn(`listener for "${name}" failed:`, err); }
    }
  };

  function adopt(runtime) {
    PBP.runtime = runtime;
    // Careful: runOnStartup fires before the first layout exists, so touching
    // runtime.layout here throws "no layout is running". Nothing in this
    // function may assume a running layout.
    PBP._ready = true;
    PBP.log('runtime captured');
    resolveReady(runtime);

    // Readiness has two stages: the runtime object exists here, but the first
    // layout only starts later. Anything touching layouts or instances must
    // wait for "started", not merely "ready".
    try {
      runtime.addEventListener('afterprojectstart', () => {
        PBP._started = true;
        PBP.log('first layout started:', PBP.currentLayout());
        resolveStarted(runtime);
        for (const fn of PBP._onStart) {
          try { fn(runtime); } catch (err) { PBP.warn('start hook failed:', err); }
        }
        PBP._onStart.length = 0;
      });
    } catch (err) {
      PBP.warn('could not listen for afterprojectstart:', err);
    }
    // Feature modules register here and are initialised once the runtime
    // exists, so load order between payload files does not matter. A failing
    // module must not take the others -- or readiness -- down with it.
    for (const fn of PBP._onRuntime) {
      try { fn(runtime); } catch (err) { PBP.warn('init hook failed:', err); }
    }
    PBP._onRuntime.length = 0;
  }

  PBP._ready = false;
  PBP._onRuntime = [];
  /** Register a callback that runs as soon as the runtime is available. */
  PBP.onRuntime = function (fn) {
    if (PBP._ready) { try { fn(PBP.runtime); } catch (err) { PBP.warn('init hook failed:', err); } }
    else PBP._onRuntime.push(fn);
  };

  if (typeof window.runOnStartup === 'function') {
    window.runOnStartup(adopt);
    PBP.log('waiting for game startup...');
  } else {
    // We were injected too late for runOnStartup to exist yet. Poll for it;
    // main.js defines it very early, well before the runtime boots.
    let tries = 0;
    const timer = setInterval(() => {
      if (typeof window.runOnStartup === 'function') {
        clearInterval(timer);
        window.runOnStartup(adopt);
        PBP.log('hooked runOnStartup (late)');
      } else if (++tries > 200) {
        clearInterval(timer);
        PBP.warn('runOnStartup never appeared -- injected into the wrong page?');
      }
    }, 25);
  }
})();
