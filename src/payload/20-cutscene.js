// --- Cutscene skipping -------------------------------------------------
// Dialogue and story scenes are driven by the "dialogue" event sheet: the
// global `dia` is non-zero while a scene is playing and `dia_line` walks
// through the lines. The game advances a line on the rising edge of the A
// button, which it reads from the `Input_Button_A` global.
//
// So rather than forcing `dia` to 0 -- which would strand any events waiting
// on the scene -- this drives the game's own advance path: pulse the button
// once per line until the scene ends on its own. Everything downstream of the
// cutscene therefore runs exactly as it would have.

(function () {
  const PBP = window.__PBP;
  if (!PBP) return;

  const ADVANCE = 'Input_Button_A';
  const FAST_SCROLL = 99;   // typewriter speed; high = text appears instantly
  const MAX_LINES = 600;    // hard stop so a stuck scene cannot spin forever

  let running = false;
  let auto = false;
  let autoHandle = null;

  const nextFrame = () => new Promise((r) => requestAnimationFrame(r));

  function vars() { return PBP.runtime.globalVars; }

  /** True while a dialogue or cutscene is playing. */
  function isActive() {
    if (!PBP._started) return false;
    try { return Number(vars().dia) !== 0; } catch (err) { return false; }
  }

  /** One rising edge on the advance button, spread over two frames. */
  async function pulse(g) {
    g[ADVANCE] = true;
    await nextFrame();
    g[ADVANCE] = false;
    await nextFrame();
  }

  /**
   * Fast-forward the running scene to its end.
   * Returns the number of lines advanced, or 0 if nothing was playing.
   */
  async function skip() {
    if (running) return 0;
    if (!isActive()) { PBP.emit('cutscene:none', {}); return 0; }

    running = true;
    const g = vars();
    const prevScroll = g.dia_scroll_spd;
    const startedAt = performance.now();
    let lines = 0;

    try {
      g.dia_scroll_spd = FAST_SCROLL;
      while (isActive() && lines < MAX_LINES) {
        await pulse(g);
        lines++;
      }
    } finally {
      // Always hand the controls back, even if something threw mid-scene.
      g.dia_scroll_spd = prevScroll;
      g[ADVANCE] = false;
      running = false;
    }

    const ms = Math.round(performance.now() - startedAt);
    if (lines >= MAX_LINES) {
      PBP.warn(`cutscene skip hit the ${MAX_LINES}-line ceiling; dia is still ${g.dia}`);
      PBP.emit('cutscene:stuck', { lines, ms });
    } else {
      PBP.emit('cutscene:skipped', { lines, ms });
      PBP.log(`skipped cutscene: ${lines} lines in ${ms}ms`);
    }
    return lines;
  }

  /** Auto mode: skip every scene the moment it starts. */
  function setAuto(on) {
    auto = !!on;
    if (auto && !autoHandle) {
      const watch = () => {
        if (!auto) { autoHandle = null; return; }
        if (!running && isActive()) skip();
        autoHandle = requestAnimationFrame(watch);
      };
      autoHandle = requestAnimationFrame(watch);
    }
    PBP.emit('cutscene:auto', { on: auto });
    return auto;
  }

  PBP.cutscene = {
    skip,
    isActive,
    get running() { return running; },
    get auto() { return auto; },
    setAuto,
    toggleAuto() { return setAuto(!auto); },
  };
})();
