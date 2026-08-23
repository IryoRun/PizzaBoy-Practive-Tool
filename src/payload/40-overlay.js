// --- On-screen overlay -------------------------------------------------
// A DOM layer above the game canvas: transient toasts plus a slot panel.
// Purely a listener on PBP events -- no feature module depends on it, so the
// tool still works headlessly if this fails to build.

(function () {
  const PBP = window.__PBP;
  if (!PBP) return;

  const CSS = `
#pbp-hud {
  position: fixed; inset: 0; z-index: 2147483000;
  pointer-events: none; font-family: Consolas, "Courier New", monospace;
  color: #fff; text-shadow: 0 2px 0 rgba(0,0,0,.9);
}
#pbp-toasts {
  position: absolute; left: 16px; bottom: 16px;
  display: flex; flex-direction: column-reverse; gap: 6px;
}
.pbp-toast {
  background: rgba(18,16,22,.92); border-left: 4px solid #e8b03a;
  padding: 7px 13px; font-size: 15px; line-height: 1.3;
  border-radius: 3px; opacity: 0; transform: translateY(6px);
  transition: opacity .12s ease-out, transform .12s ease-out;
  max-width: 46ch;
}
.pbp-toast.in { opacity: 1; transform: none; }
.pbp-toast.err { border-left-color: #e0564a; }
.pbp-toast.ok  { border-left-color: #6fc36f; }
#pbp-slots {
  position: absolute; left: 16px; top: 16px;
  background: rgba(18,16,22,.9); border: 1px solid rgba(232,176,58,.5);
  border-radius: 4px; padding: 10px 12px; font-size: 13px; display: none;
}
#pbp-slots.show { display: block; }
#pbp-slots h4 { margin: 0 0 7px; font-size: 12px; letter-spacing: .13em;
  text-transform: uppercase; color: #e8b03a; font-weight: 700; }
.pbp-slot { display: flex; gap: 9px; padding: 2px 0; opacity: .55; white-space: pre; }
.pbp-slot.filled { opacity: 1; }
.pbp-slot.sel { color: #e8b03a; }
.pbp-slot .n { width: 2ch; text-align: right; }
.pbp-slot .l { min-width: 22ch; }
#pbp-hint {
  position: absolute; right: 16px; bottom: 16px; font-size: 13px;
  background: rgba(18,16,22,.85); border: 1px solid rgba(232,176,58,.45);
  padding: 5px 11px; border-radius: 3px; letter-spacing: .02em;
  transition: opacity .15s ease-out;
}
#pbp-hint .key { color: #e8b03a; font-weight: 700; }
#pbp-hint.dim { opacity: 0; }
#pbp-keys {
  position: absolute; right: 16px; bottom: 52px; display: none;
  background: rgba(18,16,22,.96); border: 1px solid rgba(232,176,58,.6);
  border-radius: 5px; padding: 14px 18px; font-size: 14px; min-width: 34ch;
}
#pbp-keys.show { display: block; }
#pbp-keys h4 { margin: 0 0 9px; font-size: 12px; letter-spacing: .13em;
  text-transform: uppercase; color: #e8b03a; font-weight: 700; }
#pbp-keys .grp { margin: 11px 0 4px; font-size: 11px; letter-spacing: .11em;
  text-transform: uppercase; opacity: .5; }
#pbp-keys .grp:first-of-type { margin-top: 0; }
#pbp-keys .row { display: flex; gap: 14px; padding: 2px 0; }
#pbp-keys .row .k { color: #e8b03a; min-width: 11ch; white-space: nowrap; }
#pbp-keys .foot { margin-top: 12px; padding-top: 9px; font-size: 12px; opacity: .5;
  border-top: 1px solid rgba(255,255,255,.14); }
#pbp-bosses {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  background: rgba(18,16,22,.96); border: 1px solid rgba(232,176,58,.6);
  border-radius: 5px; padding: 16px 20px; font-size: 15px; display: none;
  min-width: 30ch;
}
#pbp-bosses.show { display: block; }
#pbp-bosses h4 { margin: 0 0 10px; font-size: 12px; letter-spacing: .13em;
  text-transform: uppercase; color: #e8b03a; font-weight: 700; }
.pbp-boss { padding: 3px 0; white-space: pre; }
.pbp-boss .k { color: #e8b03a; }
.pbp-boss .note { opacity: .55; font-size: 12px; }
#pbp-bosses .foot { margin-top: 10px; font-size: 12px; opacity: .5; }
#pbp-turbo {
  position: absolute; right: 16px; top: 16px; display: none;
  background: rgba(232,176,58,.92); color: #17140f; font-weight: 700;
  padding: 5px 11px; border-radius: 3px; font-size: 15px; letter-spacing: .06em;
}
#pbp-turbo.show { display: block; }
`;

  let root, toastBox, slotBox, hintBox, bossBox, turboBox, keysBox;

  function build() {
    if (root) return;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    root = document.createElement('div');
    root.id = 'pbp-hud';
    root.innerHTML =
      '<div id="pbp-toasts"></div>' +
      '<div id="pbp-slots"><h4>Savestates</h4><div class="rows"></div></div>' +
      '<div id="pbp-bosses"><h4>Warp to boss</h4><div class="rows"></div>' +
      '<div class="foot">press a number, Esc to close</div></div>' +
      '<div id="pbp-turbo"></div>' +
      '<div id="pbp-keys"><h4>Hotkeys</h4><div class="rows"></div>' +
      '<div class="foot">F1 or Esc to close</div></div>' +
      '<div id="pbp-hint"><span class="key">F1</span> for Hotkeys</div>';
    document.body.appendChild(root);
    toastBox = root.querySelector('#pbp-toasts');
    slotBox = root.querySelector('#pbp-slots');
    bossBox = root.querySelector('#pbp-bosses');
    turboBox = root.querySelector('#pbp-turbo');
    keysBox = root.querySelector('#pbp-keys');
    hintBox = root.querySelector('#pbp-hint');
  }

  function renderKeys() {
    if (!keysBox) return;
    const entries = (PBP.hotkeys && PBP.hotkeys.list) || [];
    keysBox.querySelector('.rows').innerHTML = entries.map((e) => e.group
      ? `<div class="grp">${escapeHtml(e.group)}</div>`
      : `<div class="row"><span class="k">${escapeHtml(e.keys)}</span>` +
        `<span class="d">${escapeHtml(e.desc)}</span></div>`
    ).join('');
  }

  function renderBosses() {
    if (!bossBox || !PBP.warp) return;
    bossBox.querySelector('.rows').innerHTML = PBP.warp.list().map((t, i) =>
      `<div class="pbp-boss"><span class="k">${i + 1}</span>  ${escapeHtml(t.label)}` +
      (t.custom ? '  <span class="note">[custom point]</span>' : '') +
      (t.note ? `  <span class="note">${escapeHtml(t.note)}</span>` : '') + '</div>'
    ).join('');
  }

  function toast(text, kind, ms) {
    build();
    const el = document.createElement('div');
    el.className = 'pbp-toast' + (kind ? ' ' + kind : '');
    el.textContent = text;
    toastBox.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
      el.classList.remove('in');
      setTimeout(() => el.remove(), 200);
    }, ms || 2200);
    // Never let a stuck timer pile up an unbounded list.
    while (toastBox.children.length > 6) toastBox.firstChild.remove();
  }

  function renderSlots() {
    if (!slotBox) return;
    const rows = slotBox.querySelector('.rows');
    const sel = PBP.hotkeys ? PBP.hotkeys.slot : 0;
    rows.innerHTML = PBP.states.list().map((m, i) => {
      const cls = 'pbp-slot' + (m ? ' filled' : '') + (i === sel ? ' sel' : '');
      const label = m ? m.layout : '- empty -';
      const age = m ? new Date(m.savedAt).toLocaleTimeString() : '';
      return `<div class="${cls}"><span class="n">${i}</span>` +
             `<span class="l">${escapeHtml(String(label).slice(0, 22))}</span>` +
             `<span class="t">${age}</span></div>`;
    }).join('');
  }

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, (c) => (
      { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
  }

  const overlay = {
    toast,
    build,
    toggleSlots() {
      build();
      slotBox.classList.toggle('show');
      if (slotBox.classList.contains('show')) renderSlots();
      return slotBox.classList.contains('show');
    },
    showSlots(on) {
      build();
      slotBox.classList.toggle('show', !!on);
      if (on) renderSlots();
    },
    refresh: renderSlots,
    toggleBosses() {
      build();
      renderBosses();
      keysBox.classList.remove('show');   // one panel at a time
      bossBox.classList.toggle('show');
      syncHint();
      return bossBox.classList.contains('show');
    },
    closeBosses() { if (bossBox) { bossBox.classList.remove('show'); syncHint(); } },
    bossMenuOpen() { return !!bossBox && bossBox.classList.contains('show'); },

    toggleKeys() {
      build();
      renderKeys();
      bossBox.classList.remove('show');
      keysBox.classList.toggle('show');
      syncHint();
      return keysBox.classList.contains('show');
    },
    keysOpen() { return !!keysBox && keysBox.classList.contains('show'); },

    anyPanelOpen() {
      return (!!keysBox && keysBox.classList.contains('show'))
        || (!!bossBox && bossBox.classList.contains('show'))
        || (!!slotBox && slotBox.classList.contains('show'));
    },
    closePanels() {
      if (keysBox) keysBox.classList.remove('show');
      if (bossBox) bossBox.classList.remove('show');
      if (slotBox) slotBox.classList.remove('show');
      syncHint();
    },
  };

  /** The nudge is only useful until you have found the list. */
  function syncHint() {
    if (!hintBox) return;
    hintBox.classList.toggle('dim', keysBox.classList.contains('show'));
  }

  PBP.overlay = overlay;

  PBP.onStart(() => {
    build();
    toast('Practice tool ready - press F1 for the hotkey list', 'ok', 3500);
  });

  PBP.on('state:saved', (m) => { toast(`Slot ${m.slot} saved - ${m.layout}`, 'ok'); renderSlots(); });
  PBP.on('state:loaded', (m) => { toast(`Slot ${m.slot} loaded - ${m.layout}`, 'ok'); renderSlots(); });
  PBP.on('state:missing', (m) => toast(`Slot ${m.slot} is empty`, 'err'));
  PBP.on('state:cleared', (m) => { toast(`Slot ${m.slot} cleared`); renderSlots(); });
  PBP.on('state:error', (m) => toast(`Slot ${m.slot}: ${m.message}`, 'err', 4000));
  PBP.on('slot:selected', () => renderSlots());
  PBP.on('cutscene:skipped', (d) => toast(`Cutscene skipped (${d.lines} lines, ${d.ms}ms)`, 'ok'));
  PBP.on('cutscene:none', () => toast('No cutscene playing', null, 1200));
  PBP.on('cutscene:stuck', (d) => toast(`Cutscene did not end after ${d.lines} lines`, 'err', 4000));
  PBP.on('cutscene:auto', (d) => { if (d.on) toast('Auto-skip armed', 'ok', 1500); });
  PBP.on('warp:done', (d) => toast(`Warped: ${d.label}` + (d.note ? ` (${d.note})` : ''), 'ok', 2600));
  PBP.on('warp:failed', (d) => toast(`Warp failed: ${d.reason}`, 'err', 4000));
  PBP.on('warp:marked', (d) => toast(`Warp point for ${d.label} set to ${d.pos[0]},${d.pos[1]}`, 'ok', 2600));
  PBP.on('warp:mark-failed', (d) => toast(`Cannot set warp point: ${d.reason}`, 'err', 3000));
  PBP.on('warp:mark-cleared', (d) => toast(`Warp point for ${d.label} cleared`));
  PBP.on('turbo:on', (d) => { build(); turboBox.textContent = `>> ${d.factor}x`; turboBox.classList.add('show'); });
  PBP.on('turbo:off', () => { if (turboBox) turboBox.classList.remove('show'); });
  PBP.on('turbo:factor', (d) => {
    build();
    if (turboBox.classList.contains('show')) turboBox.textContent = `>> ${d.factor}x`;
    else toast(`Fast-forward speed: ${d.factor}x`, null, 1400);
  });
})();
