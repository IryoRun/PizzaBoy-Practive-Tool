// --- Boss warps --------------------------------------------------------
// goToLayout() alone is enough to build any level: the layout's own event
// sheet runs and creates the enemies. What it does not do is put you at the
// boss -- for the chapters whose boss sits behind a door partway through a
// large level, the player still spawns at the level entrance.
//
// So each target optionally names an anchor object (the boss door, or the
// boss itself) and the player is moved there once the layout has settled.

(function () {
  const PBP = window.__PBP;
  if (!PBP) return;

  // Three shapes of encounter:
  //  - dedicated boss layout: warp and you are there
  //  - boss behind a door inside a big level: warp, then move to the door
  //  - Chapter 4 is a rhythm sequence and deliberately has no player object
  const TARGETS = [
    { key: 'ch1', label: 'Ch1 - Vampire Girl', layout: '1-VampireHouse',
      anchor: { object: 'Bosslock', dx: -48 }, globals: { boss_key: 1 } },
    { key: 'ch2', label: 'Ch2 - Clown', layout: 'Chapter 2 - Circus',
      anchor: { object: 'Bosslock', dx: -48 }, globals: { boss_key: 1 } },
    { key: 'ch3', label: 'Ch3 - Triton', layout: 'Chapter 3 - Boss' },
    { key: 'ch4', label: 'Ch4 - Frank (rhythm)', layout: 'Chapter 4 - Boss',
      note: 'rhythm sequence - no player object by design' },
    { key: 'ch5', label: 'Ch5 - Dracula', layout: 'Chapter 5 -Boss' },
    { key: 'ch6', label: 'Ch6 - Tin', layout: 'Chapter 6 - Snow',
      anchor: { object: 'Tin_Boss', dx: -220 } },
    { key: 'ch7', label: 'Ch7 - Dawg Mascot', layout: 'Chapter 7 -final',
      anchor: { object: 'Bosslock', dx: -48 }, globals: { boss_key: 1 } },
  ];

  const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
  let running = false;

  // Anchors you recorded yourself, keyed by target. These win over the built-in
  // anchor: the door marker is a decent guess, but only someone who has played
  // the fight knows exactly where it should start.
  const overrides = new Map();

  function tellHost(action, key, pos) {
    if (typeof window.__pbpHost !== 'function') return;
    try { window.__pbpHost(JSON.stringify({ action, key, pos: pos || null })); }
    catch (err) { PBP.warn('host bridge failed:', err); }
  }

  function findTarget(key) {
    return TARGETS.find((t) => t.key === key || t.layout === key);
  }

  /** Wait until the requested layout is the running one. */
  async function waitForLayout(name, frames = 240) {
    for (let i = 0; i < frames; i++) {
      if (PBP.currentLayout() === name) return true;
      await nextFrame();
    }
    return false;
  }

  /** Give the layout's own events a moment to create their instances. */
  async function settle(frames = 60) {
    for (let i = 0; i < frames; i++) await nextFrame();
  }

  function firstInstance(name) {
    const ot = PBP.runtime.objects[name];
    if (!ot) return null;
    return ot.getAllInstances()[0] || null;
  }

  async function to(key) {
    const target = findTarget(key);
    if (!target) { PBP.warn(`unknown warp target "${key}"`); return false; }
    if (running) { PBP.warn('warp already in progress'); return false; }
    if (!PBP._started) { PBP.warn('warp ignored: no layout running yet'); return false; }

    running = true;
    try {
      const rt = PBP.runtime;
      rt.goToLayout(target.layout);

      if (!await waitForLayout(target.layout)) {
        PBP.emit('warp:failed', { key: target.key, reason: `layout "${target.layout}" never started` });
        return false;
      }
      await settle();

      if (target.globals) {
        for (const [k, v] of Object.entries(target.globals)) {
          try { rt.globalVars[k] = v; } catch (err) { PBP.warn(`could not set ${k}:`, err); }
        }
      }

      let moved = null;
      const custom = overrides.get(target.key);
      const player = firstInstance('Player');
      if (custom && player) {
        player.x = custom.x;
        player.y = custom.y;
        moved = [Math.round(player.x), Math.round(player.y)];
      } else if (target.anchor) {
        const anchor = firstInstance(target.anchor.object);
        if (player && anchor) {
          player.x = anchor.x + (target.anchor.dx || 0);
          player.y = anchor.y + (target.anchor.dy || 0);
          moved = [Math.round(player.x), Math.round(player.y)];
        } else {
          // Not fatal: the level is still loaded, just not at the boss.
          PBP.warn(`warp ${target.key}: ${!player ? 'no Player' : 'no ' + target.anchor.object} to anchor to`);
        }
      }

      PBP.emit('warp:done', { key: target.key, label: target.label, layout: target.layout, moved, note: target.note });
      PBP.log(`warped to ${target.label}` + (moved ? ` @${moved}` : ''));
      return true;
    } finally {
      running = false;
    }
  }

  /**
   * Record where you are standing as the warp point for whichever target
   * belongs to the current layout. Stand where the fight should begin, press
   * the key, and every later warp starts exactly there.
   */
  function mark() {
    const layout = PBP.currentLayout();
    const target = TARGETS.find((t) => t.layout === layout);
    if (!target) { PBP.emit('warp:mark-failed', { reason: `"${layout}" is not a warp target` }); return null; }
    const player = firstInstance('Player');
    if (!player) { PBP.emit('warp:mark-failed', { reason: 'no Player to take a position from' }); return null; }

    const pos = { x: Math.round(player.x), y: Math.round(player.y) };
    overrides.set(target.key, pos);
    tellHost('anchor', target.key, pos);
    PBP.emit('warp:marked', { key: target.key, label: target.label, pos: [pos.x, pos.y] });
    PBP.log(`warp point for ${target.label} set to ${pos.x},${pos.y}`);
    return pos;
  }

  function clearMark(key) {
    const target = findTarget(key) || TARGETS.find((t) => t.layout === PBP.currentLayout());
    if (!target || !overrides.delete(target.key)) return false;
    tellHost('anchor-clear', target.key);
    PBP.emit('warp:mark-cleared', { key: target.key, label: target.label });
    return true;
  }

  PBP.warp = {
    to,
    mark,
    clearMark,
    /** Install recorded anchors restored from disk at startup. */
    adoptAnchors(map) {
      if (!map) return 0;
      let n = 0;
      for (const [k, pos] of Object.entries(map)) {
        if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') { overrides.set(k, pos); n++; }
      }
      return n;
    },
    list: () => TARGETS.map((t) => ({
      key: t.key, label: t.label, layout: t.layout, note: t.note || null,
      custom: overrides.has(t.key) ? [overrides.get(t.key).x, overrides.get(t.key).y] : null,
    })),
    targets: TARGETS,
    get running() { return running; },
  };
})();
