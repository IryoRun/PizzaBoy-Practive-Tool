// --- Fast-forward ------------------------------------------------------
// The dialogue skip only helps where there is a text box to advance. Plenty
// of stretches take the controls away without one: scripted walks, timelines,
// fades, chapter intros.
//
// Rather than detect and special-case each mechanism, this scales the whole
// runtime clock. Hold the key and everything -- animations, tweens, timelines,
// waits -- runs at N times speed, then drops back. Nothing is bypassed, so no
// event that the passage was meant to fire gets skipped; it just happens
// sooner.
//
// C3's timeScale feeds dt, which every behaviour and tween reads, so this is
// the game's own notion of time rather than something bolted on.

(function () {
  const PBP = window.__PBP;
  if (!PBP) return;

  const FACTORS = [2, 4, 8, 16];
  let factorIndex = 1;          // default 4x
  let active = false;
  let savedScale = 1;

  function factor() { return FACTORS[factorIndex]; }

  function start() {
    if (active || !PBP._started) return false;
    const rt = PBP.runtime;
    savedScale = rt.timeScale;
    rt.timeScale = savedScale * factor();
    active = true;
    PBP.emit('turbo:on', { factor: factor() });
    return true;
  }

  function stop() {
    if (!active) return false;
    // Restore the scale we found rather than assuming 1: the game itself uses
    // timeScale for slow-motion effects, and clobbering that would be a bug
    // that only shows up in one boss fight.
    PBP.runtime.timeScale = savedScale;
    active = false;
    PBP.emit('turbo:off', {});
    return true;
  }

  function cycleFactor() {
    factorIndex = (factorIndex + 1) % FACTORS.length;
    if (active) PBP.runtime.timeScale = savedScale * factor();
    PBP.emit('turbo:factor', { factor: factor() });
    return factor();
  }

  // A dropped keyup -- alt-tab, focus loss -- would otherwise leave the game
  // stuck at 8x forever.
  window.addEventListener('blur', () => { if (active) stop(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden && active) stop(); });

  PBP.turbo = {
    start,
    stop,
    cycleFactor,
    get active() { return active; },
    get factor() { return factor(); },
    FACTORS,
  };
})();
