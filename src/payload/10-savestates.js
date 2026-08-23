// --- Savestates --------------------------------------------------------
// Built on C3's own full-runtime serialisation (the same machinery the game
// uses for its save files), so a state captures everything the runtime knows:
// layout, instances, behaviours, globals, timers.
//
// States live in memory for instant reload, and are mirrored to disk by the
// host process (see src/states.js) so they survive a restart.

(function () {
  const PBP = window.__PBP;
  if (!PBP) return;

  const SLOT_COUNT = 10;

  const states = new Map(); // slot -> { json, layout, gameTime, savedAt }
  let busy = false;

  /** Ask the host process to persist or drop a slot. Silent if not attached. */
  function tellHost(action, slot, state) {
    if (typeof window.__pbpHost !== 'function') return;
    try {
      window.__pbpHost(JSON.stringify({ action, slot, state: state || null }));
    } catch (err) {
      PBP.warn('host bridge failed:', err);
    }
  }

  function meta(slot) {
    const s = states.get(slot);
    if (!s) return null;
    return { slot, layout: s.layout, gameTime: s.gameTime, savedAt: s.savedAt, bytes: s.json.length };
  }

  const api = {
    SLOT_COUNT,

    /** Capture the current runtime state into a slot. */
    async save(slot) {
      slot = Number(slot);
      if (!Number.isInteger(slot) || slot < 0 || slot >= SLOT_COUNT) {
        throw new RangeError(`slot must be 0..${SLOT_COUNT - 1}`);
      }
      if (busy) { PBP.warn('save ignored: another state operation is in flight'); return null; }
      if (!PBP._started) { PBP.warn('save ignored: no layout running yet'); return null; }
      busy = true;
      try {
        const rt = PBP.runtime;
        const json = await rt.saveToJSONString();
        const entry = {
          json,
          layout: PBP.currentLayout(),
          gameTime: rt.gameTime,
          savedAt: Date.now(),
        };
        states.set(slot, entry);
        tellHost('save', slot, entry);
        PBP.emit('state:saved', meta(slot));
        PBP.log(`saved slot ${slot} (${entry.layout}, ${(json.length / 1024).toFixed(0)} KB)`);
        return meta(slot);
      } finally {
        busy = false;
      }
    },

    /** Restore a slot. Resolves once the runtime has swapped state in. */
    async load(slot) {
      slot = Number(slot);
      const entry = states.get(slot);
      if (!entry) { PBP.warn(`slot ${slot} is empty`); PBP.emit('state:missing', { slot }); return false; }
      if (busy) { PBP.warn('load ignored: another state operation is in flight'); return false; }
      busy = true;
      try {
        await PBP.runtime.loadFromJSONString(entry.json);
        PBP.emit('state:loaded', meta(slot));
        PBP.log(`loaded slot ${slot} (${entry.layout})`);
        return true;
      } catch (err) {
        // A state captured by a different game version can fail to apply.
        PBP.warn(`loading slot ${slot} failed:`, err);
        PBP.emit('state:error', { slot, message: String(err && err.message || err) });
        return false;
      } finally {
        busy = false;
      }
    },

    /** Forget a slot, on disk too. */
    clear(slot) {
      slot = Number(slot);
      const had = states.delete(slot);
      if (had) { tellHost('clear', slot); PBP.emit('state:cleared', { slot }); }
      return had;
    },

    /** Install a state restored from disk at startup (does not touch the game). */
    adopt(slot, entry) {
      if (!entry || typeof entry.json !== 'string') return false;
      states.set(Number(slot), entry);
      return true;
    },

    /** Metadata for every occupied slot, for the overlay to render. */
    list() {
      const out = [];
      for (let i = 0; i < SLOT_COUNT; i++) out.push(meta(i));
      return out;
    },

    has(slot) { return states.has(Number(slot)); },
    get busy() { return busy; },
  };

  PBP.states = api;
})();
