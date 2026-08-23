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

```bash
npm start
```

Das findet die Steam-Installation, startet das Spiel, injiziert das Payload und
bleibt verbunden. Strg+C trennt die Verbindung — das Spiel läuft weiter.

### Tastenbelegung

| Taste | Funktion |
| --- | --- |
| `F1` | Hilfe anzeigen |
| `F2` | Savestate-Panel ein/aus |
| `F5` | State in den gewählten Slot speichern |
| `F8` | Gewählten Slot laden |
| `Shift+F8` | Gewählten Slot löschen |
| `F6` / `F7` | Vorheriger / nächster Slot |
| `Alt+0…9` | Direkt zu einem Slot springen |
| `F9` | Laufenden Dialog überspringen |
| `F10` | Dialoge automatisch überspringen, ein/aus |
| `F11` | Boss-Warp-Menü (dann Zahl drücken, Esc schließt) |
| `Shift+F11` | Aktuelle Position als Warp-Punkt dieses Bosses setzen |

Bewusst nur F-Tasten: Das Spiel belegt Buchstaben und Pfeiltasten, so kollidiert
nichts. Die Tastendrücke werden abgefangen, bevor die Tastaturbehandlung des
Spiels sie sieht.

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

#### Was das noch *nicht* abdeckt

Das Ziel ist, **jede Passage zu überspringen, in der das Spiel die Kontrolle
übernimmt** — nicht nur die mit Textbox. Dialoge sind der größte solche Brocken
und sind erledigt, diese hier nicht:

- **Gescriptete Bewegung** — `CutsceneDialogue` nimmt `cs_PlayerX`, `cs_PlayerY`
  und `cs_player_animation` entgegen, die Figur wird also ohne Eingabe an einer
  Bahn entlanggeführt
- **Timelines** — das Projekt enthält 7 davon (u.a. `Cahpter 2 - Vampire Bite`),
  abgespielt über `runtime.timelineController`
- **Blenden und Wartezeiten** — die Funktion `fade_inout(fade_time, fade_hold)`
- **Ganze Cutscene-Layouts** — `VGlaugh`, die Kapitel-Intros, `TV2`,
  `Chapter 7 - pd downfall`

Eine allgemeine Lösung hängt sich vermutlich an das, womit das Spiel die
Eingabe sperrt (`Player_state` ist der wahrscheinlichste Kandidat), statt an
`dia` — damit jede gesperrte Passage gleich erkannt und vorgespult werden kann.
Diese Arbeit steht noch aus.

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
| Kap. 1 – Vampire Girl | `1-VampireHouse` | Boss hinter Tür; Anker auf `Bosslock` |
| Kap. 2 – Clown | `Chapter 2 - Circus` | Boss hinter Tür; Anker auf `Bosslock` |
| Kap. 3 – Triton | `Chapter 3 - Boss` | eigenes Layout, landet in der Arena |
| Kap. 4 – Frank | `Chapter 4 - Boss` | Rhythmus-Sequenz; bewusst ohne `Player`-Objekt |
| Kap. 5 – Dracula | `Chapter 5 -Boss` | eigenes Layout, landet in der Arena |
| Kap. 6 – Tin | `Chapter 6 - Snow` | Anker auf `Tin_Boss` |
| Kap. 7 – Dawg Mascot | `Chapter 7 -final` | Boss hinter Tür; Anker auf `Bosslock` |

Per Screenshot bestätigt: Kapitel 3 warpt direkt in den startenden Kampf samt
Intro, Kapitel 6 stellt dich Tin gegenüber, Kapitel 7 setzt dich vor den
Mascot. **Kapitel 1 und 2 sind die wackligen** — die Türmarkierung `Bosslock`
ist eine plausible Vermutung, wo der Kampf beginnt, aber eben nur eine
Vermutung.

Genau dafür ist `Shift+F11` da: Stell dich hin, wo der Kampf anfangen soll,
drück die Taste, und dieser Punkt ersetzt den eingebauten Anker dauerhaft. Die
Punkte landen in `states/warp-anchors.json` und werden beim Start wieder
geladen. So sind die wackligen Ziele gedacht fertigzustellen — das braucht
jemanden, der den Kampf tatsächlich gespielt hat.

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
- [ ] Warp-Punkte für Kap. 1 / 2 müssen von Hand gesetzt werden (`Shift+F11`)
- [ ] **Die übrigen eingabegesperrten Passagen überspringen** — gescriptete
      Bewegung, Timelines, Blenden, Cutscene-Layouts. Das ist die größere
      Hälfte von „lass mich überspringen, was ich nicht spielen kann", und sie
      ist noch offen.
