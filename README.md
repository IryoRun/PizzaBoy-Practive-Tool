# PizzaBoy Practice Tool

*[Deutsche Fassung](README.de.md)*

Speedrun practice tooling for **PizzaBoy** (Steam app `2238400`, by Breadless):
savestates, boss warps, and skipping the parts you have to sit through.

The game's own files are never modified. The tool attaches to the running game
and injects its features at startup, so Steam updates cannot break it and
"verify integrity of game files" has nothing to undo.

## Quick start

1. Install [Node.js](https://nodejs.org) 22 or newer, if you do not have it.
2. Download the latest release, unzip it anywhere.
3. Double-click **`start practicetool`**.

That locates the Steam install, launches the game, injects the payload and
stays attached. Close the window to detach — the game keeps running.

If it does not work, run the self-test: open the folder in a terminal and

```bash
"start practicetool.bat" doctor
```

It checks Node, the Steam install and the debug port, and says which one is
wrong. (The quotes matter — `start` on its own is a Windows command.)

From a checkout, `npm start` does the same thing.

### Hotkeys

| Key | Action |
| --- | --- |
| `F1` | show help |
| `F2` | toggle the savestate panel |
| `F3` (hold) | fast-forward through unplayable stretches |
| `Shift+F3` | cycle speed 2× / 4× / 8× / 16× |
| `F5` | save state to the selected slot |
| `F8` | load the selected slot |
| `Shift+F8` | clear the selected slot |
| `F6` / `F7` | previous / next slot |
| `Alt+0…9` | jump straight to a slot |
| `F9` | skip the running cutscene |
| `F10` | auto-skip cutscenes on/off |
| `F11` | warp-to-boss menu (then a number, Esc to close) |
| `Shift+F11` | set the current spot as this boss's warp point |

Function keys are used deliberately: the game binds letters and arrows, so
nothing here collides with play. Hotkeys are captured before the game's
keyboard handler sees them.

### Commands

| Command | Purpose |
| --- | --- |
| `node src/cli.js run` | launch + inject (the default) |
| `node src/cli.js probe` | dump what the runtime exposes |
| `node src/cli.js eval "<expr>"` | evaluate against the live runtime |
| `node src/cli.js shot [file.png]` | screenshot the game window |
| `node tools/unpack-assets.js <out>` | extract `www/assets.dat` |
| `node tools/dump-project.js <dir> [sheet…]` | report layouts / event-sheet wiring |

## How it works

PizzaBoy is a **Construct 3** game running in a **WebView2** host. All game
logic is JavaScript, and `useWorker` is off, so the C3 runtime lives on the
page's main thread and is reachable over the Chrome DevTools Protocol.

The pieces:

- **`src/launcher.js`** — finds the install via `libraryfolders.vdf`, ensures
  `chromium-args` in the game's `package.json` carries
  `--remote-debugging-port`, and starts the game through Steam. The original
  file is backed up as `package.json.original` before any edit.
- **`src/cdp.js`** — dependency-free CDP client on Node's built-in `WebSocket`.
- **`src/inject.js`** — concatenates `src/payload/*.js` and installs it with
  `Page.addScriptToEvaluateOnNewDocument`, then reloads.
- **`src/states.js`** — mirrors savestates to `states/` on disk.

### Why the reload is unavoidable

The C3 `IRuntime` object is never exposed on `window`, and the objects that
hold it use private class fields, so it cannot be found by walking the object
graph. The one supported way in is `runOnStartup(fn)`, which C3 collects into
an array and drains **once** during boot. Registering later does nothing.
So the payload has to be in place before the game's scripts run, which means
installing it as a pre-navigation script and reloading once.

Readiness has two distinct stages, and conflating them causes confusing bugs:

- `__PBP._ready` — the runtime object exists. This is during boot; **no layout
  is running**, and touching `runtime.layout` throws.
- `__PBP._started` — `afterprojectstart` has fired. Only now is it safe to
  touch layouts and instances.

### Savestates

Built on C3's own full-runtime serialisation — `saveToJSONString()` /
`loadFromJSONString()`, the same machinery behind the game's save files. A
state captures layout, instances, behaviours, globals and timers.

Measured in `1-VampireHouse`: ~400 KB per state, ~32 ms to save, ~111 ms to
load. States are held in memory for instant reload and mirrored to `states/`
so they survive a restart.

### Skipping dialogue

Dialogue and story scenes run off the `dialogue` event sheet. The global `dia`
is non-zero for as long as a scene is playing, `dia_line` walks the lines, and
the game advances a line on the **rising edge** of the A button, which it reads
from the `Input_Button_A` global — a held-high value advances once and then
stalls.

The skip therefore drives the game's own advance path instead of forcing `dia`
to 0: it raises `dia_scroll_spd` so text appears instantly, then pulses
`Input_Button_A` once per frame-pair until the scene ends by itself. Everything
the cutscene was supposed to trigger still runs, and `dia_scroll_spd` plus the
button are always restored, including on failure. A 25-line scene clears in
about 400 ms.

`F10` arms auto-skip, which watches each frame and clears scenes the moment
they start.

### Fast-forward (`F3`)

Dialogue skipping only helps where there is a text box to advance. Plenty of
stretches take the controls away without one. Rather than detect and
special-case each mechanism, holding `F3` scales the runtime clock: animations,
tweens, timelines, fades and waits all run at 2–16× and then drop back.

Nothing is bypassed — every event the passage was going to fire still fires,
just sooner. C3's `timeScale` feeds `dt`, which every behaviour reads, so this
is the game's own notion of time rather than something bolted on top. The
previous scale is restored rather than assumed to be 1, because the game uses
`timeScale` for its own slow-motion effects. A lost keyup (alt-tab, focus loss)
drops the speed back automatically.

#### Why it is a held key and not automatic

An automatic version needs to know when the player has no control, and that is
still unresolved. Event groups are ruled out: all 108 in the project are
declared active and **none is ever toggled by name**, so the lock lives in
conditions on some global. `Player_state` is the likeliest candidate, but that
is a guess, not a measurement.

`src/payload/90-probe.js` exists to settle it. Start it, walk into a scripted
stretch, and `PBP.probe.summary()` names every global that changed and the
values it took:

```js
__PBP.probe.start('all');   // or a list of names
// ... play through the locked stretch ...
__PBP.probe.stop();
__PBP.probe.summary();
```

Once the lock variable is known, `PBP.turbo.start()` / `stop()` can be driven
from it, and the held key becomes optional.

#### Mechanisms behind the locked stretches

For reference, these are what `F3` is fast-forwarding through:

- **scripted movement** — `CutsceneDialogue` takes `cs_PlayerX`, `cs_PlayerY`
  and `cs_player_animation`, so the player is puppeted along a path with input
  ignored
- **timelines** — the project ships 7 (`Cahpter 2 - Vampire Bite` and others),
  played through `runtime.timelineController`
- **fades and holds** — the `fade_inout(fade_time, fade_hold)` function
- **whole cutscene layouts** — `VGlaugh`, the chapter intros, `TV2`,
  `Chapter 7 - pd downfall`

**Not yet verified against the real game.** `F3` is written and parses, but the
game could not be launched when it was added, so the speed factors have not
been tried against an actual scripted stretch. Audio pitch and physics at 16×
are the things most likely to misbehave.

## Game internals worth knowing

Extract the bundle first — `www/assets.dat` is a `c3ab` archive (410 files,
uncompressed). Layout, event-sheet and object data all live in `data.json`.

- **The player object is `Player`**, not `PizzaBoy`. `Player` is an invisible
  collision box placed once on every gameplay layout; `PizzaBoySprites` /
  `PLAYERSPRITES` are the visible character. `PizzaBoy` is a cutscene sprite
  and appears only in five legacy layouts.
- **118 global variables** are readable and writable by name via
  `runtime.globalVars`, including `Chapter`, `Boss_active`, `Health`,
  `Player_state`, `dia`, `skip`, `dev_mode`, `BuildType`.
- **Menu flow**: `title` → `chapter select` → `TV2`, which routes by the
  `Chapter` global to each chapter's hub layout.
- **`Debug_Layout` exists but is empty** — there is no built-in debug menu to
  borrow.

### Boss warps

`goToLayout()` reaches any layout directly and the level builds itself — the
layout's event sheet runs and creates the enemies. What it does not do is put
you at the boss, because the chapters differ in shape:

| Target | Layout | How it works |
| --- | --- | --- |
| Ch1 – Vampire Girl | `1-VampireHouse` | boss behind a door; anchored to `Bosslock` |
| Ch2 – Clown | `Chapter 2 - Circus` | boss behind a door; anchored to `Bosslock` |
| Ch3 – Triton | `Chapter 3 - Boss` | dedicated layout, lands in the arena |
| Ch4 – Frank | `Chapter 4 - Boss` | rhythm sequence; no `Player` object by design |
| Ch5 – Dracula | `Chapter 5 -Boss` | dedicated layout, lands in the arena |
| Ch6 – Tin | `Chapter 6 - Snow` | anchored to `Tin_Boss` |
| Ch7 – Dawg Mascot | `Chapter 7 -final` | boss behind a door; anchored to `Bosslock` |

Verified by screenshot: Ch3 warps straight into the fight with its intro
playing, Ch6 puts you across the arena from Tin, Ch7 drops you in front of the
mascot. **Ch1 and Ch2 are the rough ones** — the `Bosslock` door marker is a
reasonable guess at where the fight starts, but it is only a guess.

Which is what `Shift+F11` is for: stand where the fight should begin, press it,
and that spot replaces the built-in anchor for good. Points are saved to
`states/warp-anchors.json` and reloaded at startup. This is the intended way to
finish the rough targets — it needs someone who has actually played the fight.

Note that `1-VH Boss` looks like a chapter-1 boss layout but is a stub: floor
and player only, one event in its sheet. Chapter 1's real fight is inside
`1-VampireHouse`.

A savestate is itself a reliable warp, and remains the fallback for any
encounter where a fixed spawn point is not good enough.

## Status

- [x] Attach, inject, and reach the runtime
- [x] Savestates — 10 slots, verified round-trip, persisted to disk
- [x] On-screen overlay and hotkeys
- [x] Skipping dialogue — manual and automatic
- [x] Boss warps — all seven chapters, with recordable warp points
- [x] Fast-forward through input-locked stretches (`F3`) — **written, not yet
      tested against the running game**
- [ ] Ch1 / Ch2 warp points need setting by hand (`Shift+F11`)
- [ ] Automatic fast-forward — blocked on identifying the variable the game
      uses to lock input; `90-probe.js` is there to find it
