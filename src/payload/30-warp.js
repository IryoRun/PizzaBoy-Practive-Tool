// --- Boss warps --------------------------------------------------------
// goToLayout() alone builds the level: the layout's event sheet runs and
// creates the enemies. Getting an actual *fight* out of it needs two more
// things, both learned the hard way.
//
// 1. Where to stand. A marker's y is often inside the floor -- Chapter 6's
//    boss sits at y=1104 while the ground there is at y~976 -- and a player
//    placed inside geometry does not fall back out, it just sticks. So aim
//    above the boss and let the game's own gravity find the floor.
//
// 2. The camera. Levels are a grid of `room` rectangles and the game derives
//    roomUID, and with it the camera, from the room the player is inside.
//    Landing on a room's roof is walkable ground where you cannot see
//    yourself. Landing beside the boss keeps you in the boss's room.
//
// Then `Boss_active = 1` starts the fight. The bosses are already
// instantiated in their arenas -- Chapter 1's BamBam stands at (4264,368)
// from the moment the layout loads -- so the flag is all that is missing.
// (The quest chain that normally leads there, waking BamBam, flipping the
// switch blocks, fetching Pupperoni's bone for the key, is what the flag
// lets us skip.)

(function () {
  const PBP = window.__PBP;
  if (!PBP) return;

  // `Boss` is a family holding each chapter's boss, but it does not cover
  // every layout, so each target also names its own object as a fallback.
  const TARGETS = [
    { key: 'ch1', label: 'Ch1 - BamBam', layout: '1-VampireHouse',
      boss: ['Boss', 'bambam'] },
    { key: 'ch2', label: 'Ch2 - Clown', layout: 'Chapter 2 - Circus',
      boss: ['Boss', 'clown'], safeStart: true,
      note: 'lands at the nearest checkpoint - set your own spot with Shift+F11' },
    { key: 'ch3', label: 'Ch3 - Triton', layout: 'Chapter 3 - Boss',
      boss: ['Boss', 'Triton'] },
    { key: 'ch4', label: 'Ch4 - Frank (rhythm)', layout: 'Chapter 4 - Boss',
      note: 'rhythm sequence - no player object by design' },
    { key: 'ch5', label: 'Ch5 - Dracula', layout: 'Chapter 5 -Boss',
      boss: ['Boss', 'Dracula'] },
    { key: 'ch6', label: 'Ch6 - Tin', layout: 'Chapter 6 - Snow',
      boss: ['Boss', 'Tin_Boss'], safeStart: true,
      note: 'starts you at 1 HP by design - set your own spot with Shift+F11' },
    { key: 'ch7', label: 'Ch7 - Dawg Mascot', layout: 'Chapter 7 -final',
      boss: ['Boss', 'DawgMascot'], safeStart: true,
      note: 'lands at the nearest checkpoint - set your own spot with Shift+F11' },
  ];

  // Stand a short step to the boss's left, dropped in from above it.
  const APPROACH_DX = -100;
  const DROP_ABOVE = 110;

  const nextFrame = () => new Promise((r) => requestAnimationFrame(r));
  let running = false;

  // Landing spots you recorded yourself, which beat anything derived here.
  const overrides = new Map();

  function tellHost(action, key, pos) {
    if (typeof window.__pbpHost !== 'function') return;
    try { window.__pbpHost(JSON.stringify({ action, key, pos: pos || null })); }
    catch (err) { PBP.warn('host bridge failed:', err); }
  }

  function findTarget(key) {
    return TARGETS.find((t) => t.key === key || t.layout === key);
  }

  function firstInstance(name) {
    const ot = PBP.runtime.objects[name];
    if (!ot) return null;
    return ot.getAllInstances()[0] || null;
  }

  /** The first of the target's candidate boss objects that exists. */
  function findBoss(target) {
    for (const name of target.boss || []) {
      const inst = firstInstance(name);
      if (inst) return inst;
    }
    return null;
  }

  /** The checkpoint nearest a position -- always survivable, the game respawns there. */
  function nearestCheckpoint(from) {
    const ot = PBP.runtime.objects.checkpoint;
    if (!ot) return null;
    let best = null;
    let bestD = Infinity;
    for (const c of ot.getAllInstances()) {
      const d = Math.hypot(c.x - from.x, c.y - from.y);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  async function waitForLayout(name, frames = 240) {
    for (let i = 0; i < frames; i++) {
      if (PBP.currentLayout() === name) return true;
      await nextFrame();
    }
    return false;
  }

  async function settle(frames) {
    for (let i = 0; i < frames; i++) await nextFrame();
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
      await settle(60);   // let the layout's events create their instances

      let moved = null;
      const player = firstInstance('Player');
      const custom = overrides.get(target.key);

      if (player && custom) {
        player.x = custom.x;
        player.y = custom.y;
        await settle(30);
        moved = [Math.round(player.x), Math.round(player.y)];
      } else if (player && target.safeStart) {
        // Arenas where dropping in beside the boss kills you outright -- a pit
        // under the landing spot, or a section that starts you at 1 HP. Until
        // someone records a real spot with Shift+F11, put them somewhere the
        // level guarantees is survivable and let them walk the last stretch.
        const cp = nearestCheckpoint(findBoss(target) || player);
        if (cp) {
          player.x = cp.x;
          player.y = cp.y;
          await settle(30);
          moved = [Math.round(player.x), Math.round(player.y)];
        }
      } else if (player && target.boss) {
        const boss = findBoss(target);
        if (boss) {
          player.x = boss.x + APPROACH_DX;
          player.y = boss.y - DROP_ABOVE;
          await settle(50);   // fall to the arena floor
          moved = [Math.round(player.x), Math.round(player.y)];
        } else {
          PBP.warn(`warp ${target.key}: none of [${target.boss}] is on this layout`);
        }
      }

      // Arm the fight. The boss is already standing in its arena; this is the
      // flag the skipped quest chain would otherwise have set.
      if (target.boss) {
        try { rt.globalVars.Boss_active = 1; } catch (err) { PBP.warn('could not set Boss_active:', err); }
      }

      PBP.emit('warp:done', { key: target.key, label: target.label, layout: target.layout, moved, note: target.note });
      PBP.log(`warped to ${target.label}` + (moved ? ` @${moved}` : ''));
      return true;
    } finally {
      running = false;
    }
  }

  /**
   * Record where you are standing as the landing spot for whichever target
   * belongs to the current layout, overriding the derived one for good.
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
