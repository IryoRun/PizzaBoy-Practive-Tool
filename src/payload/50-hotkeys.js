// --- Hotkeys -----------------------------------------------------------
// Function keys only, so nothing collides with the game's own controls.
// Bound on the capture phase and stopped there, so C3's keyboard plugin
// never sees them.

(function () {
  const PBP = window.__PBP;
  if (!PBP) return;

  const state = { slot: 0 };

  // The single source of truth for the on-screen list, so the panel can never
  // drift from what the keys actually do.
  const HOTKEYS = [
    { group: 'General' },
    { keys: 'F1', desc: 'show / hide this list' },
    { keys: 'Esc', desc: 'close any open panel' },

    { group: 'Savestates' },
    { keys: 'F5', desc: 'save state to the selected slot' },
    { keys: 'F8', desc: 'load the selected slot' },
    { keys: 'Shift + F8', desc: 'clear the selected slot' },
    { keys: 'F6 / F7', desc: 'previous / next slot' },
    { keys: 'Alt + 0…9', desc: 'jump straight to a slot' },
    { keys: 'F2', desc: 'show / hide the slot panel' },

    { group: 'Skipping' },
    { keys: 'F3 (hold)', desc: 'fast-forward through unplayable stretches' },
    { keys: 'Shift + F3', desc: 'cycle speed 2× / 4× / 8× / 16×' },
    { keys: 'F9', desc: 'skip the running dialogue' },
    { keys: 'F10', desc: 'auto-skip dialogue on / off' },

    { group: 'Boss warps' },
    { keys: 'F11', desc: 'warp menu, then a number' },
    { keys: 'Shift + F11', desc: 'set this spot as the warp point' },
  ];

  function selectSlot(n) {
    state.slot = ((n % PBP.states.SLOT_COUNT) + PBP.states.SLOT_COUNT) % PBP.states.SLOT_COUNT;
    PBP.emit('slot:selected', { slot: state.slot });
    if (PBP.overlay) {
      PBP.overlay.showSlots(true);
      PBP.overlay.toast(`Slot ${state.slot}` + (PBP.states.has(state.slot) ? '' : ' (empty)'), null, 1100);
    }
  }

  const bindings = {
    F1() {
      if (PBP.overlay) PBP.overlay.toggleKeys();
    },
    F2() {
      if (PBP.overlay) PBP.overlay.toggleSlots();
    },
    F3(ev) {
      // keydown repeats while held; start() is a no-op once running.
      if (ev.shiftKey) PBP.turbo.cycleFactor();
      else PBP.turbo.start();
    },
    F5() { PBP.states.save(state.slot); },
    F6() { selectSlot(state.slot - 1); },
    F7() { selectSlot(state.slot + 1); },
    F8(ev) {
      if (ev.shiftKey) PBP.states.clear(state.slot);
      else PBP.states.load(state.slot);
    },
    F9() { PBP.cutscene.skip(); },
    F11(ev) {
      if (ev.shiftKey) PBP.warp.mark();
      else PBP.overlay.toggleBosses();
    },
    F10() {
      const on = PBP.cutscene.toggleAuto();
      if (PBP.overlay) PBP.overlay.toast(`Auto-skip cutscenes: ${on ? 'ON' : 'off'}`, on ? 'ok' : null);
    },
  };

  function onKeyDown(ev) {
    // Escape closes whatever panel is open, before anything else looks at it.
    if (ev.key === 'Escape' && PBP.overlay && PBP.overlay.anyPanelOpen()) {
      ev.preventDefault(); ev.stopImmediatePropagation();
      PBP.overlay.closePanels();
      return;
    }

    // While the boss menu is open it owns the digit keys and Escape.
    if (PBP.overlay && PBP.overlay.bossMenuOpen()) {
      if (ev.key === 'Escape') {
        ev.preventDefault(); ev.stopImmediatePropagation();
        PBP.overlay.closeBosses();
        return;
      }
      const m = /^Digit([1-9])$/.exec(ev.code);
      if (m) {
        ev.preventDefault(); ev.stopImmediatePropagation();
        const target = PBP.warp.list()[Number(m[1]) - 1];
        PBP.overlay.closeBosses();
        if (target) PBP.warp.to(target.key);
        else PBP.overlay.toast('No boss on that number', 'err', 1400);
        return;
      }
    }

    // Alt+digit picks a slot directly.
    if (ev.altKey && /^Digit[0-9]$/.test(ev.code)) {
      ev.preventDefault(); ev.stopImmediatePropagation();
      selectSlot(Number(ev.code.slice(5)));
      return;
    }
    const fn = bindings[ev.key];
    if (!fn) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    try { fn(ev); } catch (err) { PBP.warn(`hotkey ${ev.key} failed:`, err); }
  }

  function onKeyUp(ev) {
    if (ev.key === 'F3') {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      PBP.turbo.stop();
    }
  }

  window.addEventListener('keydown', onKeyDown, true);
  window.addEventListener('keyup', onKeyUp, true);

  PBP.hotkeys = {
    get slot() { return state.slot; },
    select: selectSlot,
    list: HOTKEYS,
    bindings: Object.keys(bindings),
  };
})();
