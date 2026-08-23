# PizzaBoy Practice Tool

*[English version](README.md)*

Speedrun-Übungswerkzeug für **PizzaBoy** (Steam-App `2238400`, von Breadless):
Savestates, Boss-Warps und das Überspringen der Passagen, die man sonst
aussitzen muss.

Die Spieldateien werden nicht verändert. Das Tool hängt sich an das laufende
Spiel und lädt seine Funktionen beim Start hinein — Steam-Updates können es
also nicht kaputtmachen, und „Dateien überprüfen" hat nichts rückgängig zu
machen.

## Schnellstart

1. [Node.js](https://nodejs.org) 22 oder neuer installieren, falls nicht vorhanden.
2. Das neueste Release herunterladen und irgendwohin entpacken.
3. Doppelklick auf **`start practicetool`**.

Das findet die Steam-Installation, startet das Spiel, injiziert das Payload und
bleibt verbunden. Fenster schließen trennt die Verbindung — das Spiel läuft
weiter.

Wenn es nicht klappt, gibt es einen Selbsttest. Ordner im Terminal öffnen und:

```bash
"start practicetool.bat" doctor
```

Der prüft Node, die Steam-Installation und den Debug-Port und sagt, woran es
liegt. (Die Anführungszeichen sind nötig — `start` ist auch ein
Windows-Befehl.)

Aus einem Checkout heraus macht `npm start` dasselbe.

### Tastenbelegung

| Taste | Funktion |
| --- | --- |
| `F1` | Hotkey-Liste ein/aus |
| `Esc` | offenes Panel schließen |
| `F2` | Savestate-Panel ein/aus |
| `F3` (halten) | Zeitraffer durch unspielbare Passagen |
| `Shift+F3` | Geschwindigkeit durchschalten: 2× / 4× / 8× / 16× |
| `F5` | State in den gewählten Slot speichern |
| `F8` | Gewählten Slot laden |
| `Shift+F8` | Gewählten Slot löschen |
| `F6` / `F7` | Vorheriger / nächster Slot |
| `Alt+0…9` | Direkt zu einem Slot springen |
| `F9` | Laufenden Dialog überspringen |
| `F10` | Dialoge automatisch überspringen, ein/aus |
| `F11` | Boss-Warp-Menü (dann Zahl drücken, Esc schließt) |
| `Shift+F11` | Aktuelle Position als Warp-Punkt dieses Bosses setzen |

Unten rechts im Spiel schwebt ein kleines Feld mit **`F1` for Hotkeys** — man
muss also nicht erst diese Datei lesen, um die Tasten zu finden. `F1` öffnet
die vollständige Liste, nach Zweck gruppiert; das Feld blendet sich aus,
solange die Liste offen ist.

Bewusst nur F-Tasten: Das Spiel belegt Buchstaben und Pfeiltasten, so kollidiert
nichts. Die Tastendrücke werden abgefangen, bevor die Tastaturbehandlung des
Spiels sie sieht, und die Liste wird aus den tatsächlichen Bindings erzeugt —
sie kann also nicht veralten.

### Kommandos

| Kommando | Zweck |
| --- | --- |
| `node src/cli.js run` | Starten + injizieren (Standard) |
| `node src/cli.js probe` | Ausgeben, was die Runtime bereitstellt |
| `node src/cli.js eval "<expr>"` | Ausdruck gegen die laufende Runtime auswerten |
| `node src/cli.js shot [datei.png]` | Screenshot des Spielfensters |
| `node tools/unpack-assets.js <ziel>` | `www/assets.dat` entpacken |
| `node tools/dump-project.js <ordner> [sheet…]` | Layouts / Event-Sheet-Verdrahtung ausgeben |

## Funktionsweise

PizzaBoy ist ein **Construct-3**-Spiel in einem **WebView2**-Host. Die gesamte
Spiellogik ist JavaScript, und `useWorker` ist aus — die C3-Runtime läuft also
im Main-Thread der Seite und ist über das Chrome DevTools Protocol erreichbar.

Die Bausteine:

- **`src/launcher.js`** — findet die Installation über `libraryfolders.vdf`,
  stellt sicher, dass `chromium-args` in der `package.json` des Spiels
  `--remote-debugging-port` enthält, und startet über Steam. Die Originaldatei
  wird vor jeder Änderung als `package.json.original` gesichert.
- **`src/cdp.js`** — CDP-Client ohne Abhängigkeiten, auf Nodes eingebautem
  `WebSocket`.
- **`src/inject.js`** — fügt `src/payload/*.js` zusammen und installiert das
  Ganze per `Page.addScriptToEvaluateOnNewDocument`, dann Reload.
- **`src/states.js`** — spiegelt Savestates nach `states/` auf die Platte.

### Warum der Reload unvermeidbar ist

Das C3-`IRuntime`-Objekt liegt nirgends auf `window`, und die Objekte, die es
halten, benutzen private Class-Fields — über den Objektgraphen ist es also
nicht auffindbar. Der einzige vorgesehene Weg ist `runOnStartup(fn)`: C3 sammelt
diese Callbacks in einem Array und arbeitet es beim Boot **genau einmal** ab.
Später registrieren bewirkt nichts. Das Payload muss deshalb schon vor den
Spielskripten liegen, und das heißt: als Pre-Navigation-Skript installieren und
einmal neu laden.

Die Bereitschaft hat zwei Stufen, und sie zu verwechseln erzeugt verwirrende
Fehler:

- `__PBP._ready` — das Runtime-Objekt existiert. Das ist noch während des Boots;
  **es läuft kein Layout**, und ein Zugriff auf `runtime.layout` wirft.
- `__PBP._started` — `afterprojectstart` ist gefeuert. Erst jetzt darf man
  Layouts und Instanzen anfassen.

### Savestates

Basiert auf C3s eigener Runtime-Serialisierung — `saveToJSONString()` /
`loadFromJSONString()`, dieselbe Maschinerie wie hinter den Spielständen des
Spiels. Ein State erfasst Layout, Instanzen, Behaviours, Globals und Timer.

Gemessen in `1-VampireHouse`: ~400 KB pro State, ~32 ms zum Speichern, ~111 ms
zum Laden. States liegen für sofortiges Laden im Speicher und werden nach
`states/` gespiegelt, überleben also einen Neustart.

### Dialoge überspringen

Dialoge und Story-Szenen laufen über das Event-Sheet `dialogue`. Das Global
`dia` ist ungleich 0, solange eine Szene läuft, `dia_line` wandert durch die
Zeilen, und das Spiel schaltet eine Zeile weiter auf der **steigenden Flanke**
des A-Knopfs, den es aus dem Global `Input_Button_A` liest — ein dauerhaft
gehaltener Wert schaltet genau einmal und hängt dann.

Der Skip fährt deshalb den spieleigenen Weg, statt `dia` auf 0 zu zwingen: Er
setzt `dia_scroll_spd` hoch, damit der Text sofort steht, und pulst dann
`Input_Button_A` einmal pro Frame-Paar, bis die Szene von selbst endet. Alles,
was die Szene auslösen sollte, läuft dadurch normal weiter; `dia_scroll_spd` und
der Knopf werden immer zurückgesetzt, auch im Fehlerfall. Eine Szene mit 25
Zeilen ist in etwa 400 ms durch.

`F10` schaltet den Automatikmodus scharf, der jeden Frame prüft und Szenen
räumt, sobald sie beginnen.

### Zeitraffer (`F3`)

Der Dialog-Skip hilft nur dort, wo es eine Textbox zum Weiterklicken gibt.
Viele Passagen nehmen dir die Kontrolle ohne eine solche. Statt jeden
Mechanismus einzeln zu behandeln, skaliert gehaltenes `F3` die Runtime-Uhr:
Animationen, Tweens, Timelines, Blenden und Wartezeiten laufen mit 2–16× und
fallen danach zurück.

Es wird nichts übersprungen — jedes Event, das die Passage auslösen sollte,
läuft weiterhin, nur früher. C3s `timeScale` speist `dt`, das jedes Behaviour
liest; das ist also die spieleigene Zeitrechnung und nichts Aufgesetztes. Der
vorherige Wert wird wiederhergestellt statt auf 1 gesetzt, weil das Spiel
`timeScale` selbst für Zeitlupeneffekte nutzt. Geht ein Keyup verloren
(Alt-Tab, Fokusverlust), fällt die Geschwindigkeit automatisch zurück.

#### Warum gehaltene Taste und nicht automatisch

Eine automatische Version müsste wissen, wann der Spieler keine Kontrolle hat —
und das ist ungeklärt. Event-Gruppen sind ausgeschlossen: Alle 108 im Projekt
sind aktiv deklariert und **keine wird je namentlich umgeschaltet**. Die Sperre
sitzt also in Bedingungen auf irgendeinem Global. `Player_state` ist der
wahrscheinlichste Kandidat, aber das ist geraten, nicht gemessen.

Dafür gibt es `src/payload/90-probe.js`. Starten, in eine gescriptete Passage
laufen, und `PBP.probe.summary()` nennt jedes Global, das sich geändert hat,
samt der Werte:

```js
__PBP.probe.start('all');   // oder eine Namensliste
// ... durch die gesperrte Passage spielen ...
__PBP.probe.stop();
__PBP.probe.summary();
```

Sobald die Sperrvariable bekannt ist, lassen sich `PBP.turbo.start()` /
`stop()` daran hängen, und die gehaltene Taste wird optional.

#### Was hinter den gesperrten Passagen steckt

Zur Einordnung — das hier spult `F3` vor:

- **Gescriptete Bewegung** — `CutsceneDialogue` nimmt `cs_PlayerX`, `cs_PlayerY`
  und `cs_player_animation` entgegen, die Figur wird also ohne Eingabe an einer
  Bahn entlanggeführt
- **Timelines** — das Projekt enthält 7 davon (u.a. `Cahpter 2 - Vampire Bite`),
  abgespielt über `runtime.timelineController`
- **Blenden und Wartezeiten** — die Funktion `fade_inout(fade_time, fade_hold)`
- **Ganze Cutscene-Layouts** — `VGlaugh`, die Kapitel-Intros, `TV2`,
  `Chapter 7 - pd downfall`

**Noch nicht am echten Spiel geprüft.** `F3` ist geschrieben und parst sauber,
aber das Spiel ließ sich zum Zeitpunkt der Umsetzung nicht starten — die
Geschwindigkeitsstufen sind also nie gegen eine echte gescriptete Passage
gelaufen. Am ehesten könnten Tonhöhe und Physik bei 16× Ärger machen.

## Wissenswertes über die Spielinterna

Zuerst das Bundle entpacken: `www/assets.dat` ist ein `c3ab`-Archiv (410
Dateien, unkomprimiert). Layout-, Event-Sheet- und Objektdaten liegen alle in
`data.json`.

- **Die Spielfigur heißt `Player`**, nicht `PizzaBoy`. `Player` ist eine
  unsichtbare Kollisionsbox, die auf jedem Gameplay-Layout genau einmal
  platziert ist; `PizzaBoySprites` / `PLAYERSPRITES` sind die sichtbare Figur.
  `PizzaBoy` ist ein Cutscene-Sprite und kommt nur in fünf Altlast-Layouts vor.
- **118 globale Variablen** sind über `runtime.globalVars` namentlich les- und
  schreibbar, darunter `Chapter`, `Boss_active`, `Health`, `Player_state`,
  `dia`, `skip`, `dev_mode`, `BuildType`.
- **Menüfluss**: `title` → `chapter select` → `TV2`, das anhand des Globals
  `Chapter` zum jeweiligen Kapitel-Hub verzweigt.
- **`Debug_Layout` existiert, ist aber leer** — es gibt kein eingebautes
  Debug-Menü, das man kapern könnte.

### Boss-Warps

`goToLayout()` erreicht jedes Layout direkt, und das Level baut sich selbst auf
— das Event-Sheet des Layouts läuft und erzeugt die Gegner. Was es nicht tut:
dich zum Boss stellen. Denn die Kapitel sind unterschiedlich gebaut:

| Ziel | Layout | Vorgehen |
| --- | --- | --- |
| Kap. 1 – Vampire Girl | `1-VampireHouse` | Checkpoint nächst dem `Vampire` |
| Kap. 2 – Clown | `Chapter 2 - Circus` | Checkpoint nächst der Bosstür |
| Kap. 3 – Triton | `Chapter 3 - Boss` | eigenes Layout, landet in der Arena |
| Kap. 4 – Frank | `Chapter 4 - Boss` | Rhythmus-Sequenz; bewusst ohne `Player`-Objekt |
| Kap. 5 – Dracula | `Chapter 5 -Boss` | eigenes Layout, landet in der Arena |
| Kap. 6 – Tin | `Chapter 6 - Snow` | keine Checkpoints; Fall von oben über `Tin_Boss` |
| Kap. 7 – Dawg Mascot | `Chapter 7 -final` | Checkpoint nächst der Bosstür |

**Wo man landet.** Die erste Fassung zielte auf die Bosstür und hat die Figur
in Kapitel 1, 2 und 6 in Wänden festgesetzt. Zwei Dinge waren falsch, und beide
sollte man kennen, bevor man an diesen Werten dreht:

- Das `y` einer Markierung liegt oft *im* Boden. Der Boss von Kapitel 6 sitzt
  bei y=1104, der Boden dort aber bei y≈976 — auf gleicher Höhe abgesetzt wird
  die Figur begraben. Von selbst kommt sie nicht wieder raus: Wer in Geometrie
  steckt, bewegt sich gar nicht.
- Level sind ein Raster aus `room`-Rechtecken, und das Spiel leitet `roomUID` —
  und damit die Kamera — aus dem Raum ab, in dem die Figur *drin* ist. Landet
  man 16 px über der Oberkante (also auf dem Dach), bleibt die Kamera im
  vorigen Raum und zeigt Kulisse, während man woanders steht.

Deshalb landen die Ziele jetzt auf dem **Checkpoint, der dem Boss am nächsten
liegt**. Checkpoints sind die eine Stelle, die ein Level garantiert brauchbar
hält: Das Spiel respawnt dich dort, es gibt also Stehplatz, und sie liegen im
Raumraster, sodass die Kamera mitkommt. Kapitel 6 hat keine Checkpoints und
lässt die Figur stattdessen von hoch über dem Boss fallen.

Zwei Werkzeuge halten das ehrlich — beide brauchen ein laufendes Spiel mit
verbundenem Tool:

```bash
node tools/verify-warps.js              # alle Ziele: läuft man, sieht man sich
node tools/find-warp-spot.js "<layout>" # ein Layout nach brauchbaren Stellen absuchen
```

`verify-warps` warpt jedes Ziel an, schickt echte Pfeiltasten, um zu prüfen ob
sich die Figur wirklich bewegt, und vergleicht die Scroll-Position mit der
Figur, um Landungen außerhalb des Bildes zu erwischen. Beide Fehlerarten sieht
man nicht, wenn man nur Koordinaten liest.

Wenn ein Landepunkt trotzdem nicht dort ist, wo der Kampf für dich anfangen
soll, überschreibt ihn `Shift+F11`: hinstellen, Taste drücken, fertig. Die
Punkte landen in `states/warp-anchors.json`.

Achtung: `1-VH Boss` sieht nach einem Kapitel-1-Boss-Layout aus, ist aber ein
Stub — nur Boden und Figur, ein einziges Event im Sheet. Der echte Kampf von
Kapitel 1 findet in `1-VampireHouse` statt.

Ein Savestate ist selbst schon ein zuverlässiger Warp und bleibt der Rückfall
für jede Situation, in der ein fester Startpunkt nicht genügt.

## Stand

- [x] Anhängen, injizieren, Runtime erreichen
- [x] Savestates — 10 Slots, Round-Trip geprüft, auf Platte gesichert
- [x] Overlay und Tastenbelegung
- [x] Dialoge überspringen — manuell und automatisch
- [x] Boss-Warps — alle sieben Kapitel, mit setzbaren Warp-Punkten
- [x] Zeitraffer durch eingabegesperrte Passagen (`F3`) — **geschrieben, aber
      noch nicht am laufenden Spiel getestet**
- [x] Alle sieben Warps landen begehbar und im Bild, geprüft mit
      `tools/verify-warps.js` am laufenden Spiel
- [ ] Automatischer Zeitraffer — blockiert daran, die Variable zu finden, mit
      der das Spiel die Eingabe sperrt; `90-probe.js` ist dafür da
