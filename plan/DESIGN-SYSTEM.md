---
tags: [projekt, orbit-2, design, spezifikation]
status: aktiv (maßgeblich)
date: 2026-11-01
herkunft: Figma-Datei „Ohne Namen“ (wGpql7jspMaeJM8hWBgAIb) am 01.11.2026 mit figma-cli nur gelesen (Variablen, Bausteine, Maße, Animationstexte); Designregeln aus Constis Auftrag „Schritt 4“ und Endcheck vom 30.10.2026; Consti im Chat 01.11.2026 („Design in Figma ist gut, nicht ändern“)
---

# Orbit Design-System

> **Verbindlich (03.11.2026):** Die Design-Entscheidungen D01–D21 in Brain `02 Projekte/Orbit/Orbit Entscheidungen.md` gehen dieser Datei vor (z. B. Status-Punkt mit Orange, Personalisieren nur Name und Aufgabe, keine Auswahl „wer antwortet“, Einstellungen im Figma-Stil). Bei Abweichung zwischen Brain und Repo gilt die Brain-Fassung (angeglichen 03.11.2026, L10).

**Kurz:** Das ist die einzige vollständige Gestaltungs-Vorgabe für Orbit. Sie beschreibt das Design in Figma Wert für Wert. Alles, was gebaut wird (jetzt und später), richtet sich danach. Das Design selbst ist von Consti abgenommen und wird hier nicht geändert.

Liegt zweimal: Brain `02 Projekte/Orbit/Orbit Design-System.md` und Repo `~/Projekte-Coding/Orbit/plan/DESIGN-SYSTEM.md`. Beide Dateien sind inhaltlich gleich. Wer eine ändert, ändert die andere mit.


## 0. So benutzt du dieses Dokument ohne Figma

1. Gesamtbild: Abschnitt 8 und die Bilder „05-bildschirme“ (Abschnitt 14).
2. Einzelner Baustein: Abschnitt 7.2 (Zustände) und das Bild zum Baustein (Abschnitt 14), Maße in 7.1.
3. Farbe/Abstand/Radius/Schrift/Zeit: nur über die Namen in Abschnitt 3 bis 5.
4. Neu gestalten: wie ein vorhandener Baustein bauen, Hell und Dunkel, nur Variablen. Danach hier eintragen und ein Bild nach `plan/design/` legen.
5. Figma ist nur noch eine Quelle der Bilder. Wer Figma nicht hat, kann trotzdem alles nachbauen oder ändern.

## 1. Arbeitsregeln für jede Anpassung

1. **Reihenfolge:** erst Figma, dann diese Datei, dann `Theme.swift`. Nie umgekehrt, nie nur im Code.
2. **Keine festen Werte im Code.** Keine Hex-Farben, keine Zahlen für Abstand, Radius, Schriftgröße oder Animationsdauer in Views. Alles kommt aus `Theme` (Namen wie in Figma, siehe Abschnitt 11).
3. **Neues Element:** zuerst einen vorhandenen Baustein aus Abschnitt 7 wiederverwenden. Gibt es keinen passenden, wird er erst in Figma gebaut (an Variablen gebunden, mit Zuständen, Hell und Dunkel), dann hier eingetragen.
4. **Hell und Dunkel** gleich behandeln: jede Farbe kommt aus einer Variable, nie aus einem Wert. Kontrast: Text mindestens 4,5:1, Symbole mindestens 3:1, in beiden Modi.
5. **Chatfarben sind variabel.** Die Farbe eines Orbis (`orbi/*`, `orbi-bubble/*`) ändert Akzent, Blasen, Senden/Stoppen. Nichts davon darf fest verdrahtet sein.
6. **Abnahme eines Einbaus:** Bildschirmfoto der App neben den Figma-Bildschirm (Abschnitt 8), Abweichungen im Bericht nennen.

## 2. Grundregeln der Gestaltung (Consti)

- **Strenger Minimalismus.** Ruhige Flächen, wenig Rand, Glas nur auf funktionalen Flächen (Menüs, schwebende Leisten).
- **Keine Tastenkürzel in der Oberfläche** (kein „⌘K“ o. Ä. als Anzeige). Kürzel dürfen still funktionieren.
- **Das Wort „Limit“ kommt nirgends vor.** Stattdessen „Pausiert, wartet“.
- **Orbis:** jeder Orbi hat seine eigene Farbe. Grundblick links oben, dann komplett still. Keine Statuspunkte am Orbi in der ausgeklappten Seitenleiste.
- **Status** (Consti 03.11.2026, E51/D04): **fertig = blau** (`status/info`), **braucht dich = orange**, **arbeitet = kein Punkt, nur Animation**; nur als **Status-Punkt der Seitenleiste**: ausgeklappte Leiste als Punkt rechts in der Zeile, eingeklappte Leiste am Orbi. **Sonst ist nichts blau**: die Live-Zeile im Chat (Statusleiste) ist grauer Text, auch Reaktions-Rand, Übergabe-Zeile und Überspringen-Knopf (Korrektur 01.11.2026 nach Constis Sichtung).
- **1:1-Chat:** meine Blasen und Akzente (auch Senden und Stoppen) in der Farbe des Orbis. **Gruppe:** meine Blasen grau (`accent-neutral`), Akzent und Schalter neutral.
- **Seitenleiste:** eine Liste für Chats und Gruppen, keine Abschnitts-Überschriften, kein „Geplant“, kein Anheften. Hauptorbi ohne Kasten. **Routinen nur im rechten Panel** beim jeweiligen Orbi.
- **@-Erwähnung:** kleiner Orbi mit Rand + Name in Textfarbe, ohne Pille. Als Link inline mit Symbol, ohne Kasten.
- **Zustände nie nur über Farbe:** immer Text oder Form dazu.
- **Paletten-Beispiele (v3):** Trixi violett, Strobi blau, Citrus gelb-orange, Nova türkis, Kiro himmelblau, Pico grün, Momo rot, Lumi fuchsia. Kein Orange als Beispielfarbe.
- Sprache der Oberfläche: Deutsch, kurz, einfach.

## 3. Farben

Quelle: Figma-Sammlungen „Color Light“ und „Color Dark“ (je 80 Variablen, gleiche Namen) und „Primitives“ (72 Rohwerte). Die zwei Sammlungen sind keine Modi, sondern zwei getrennte Listen mit gleichen Namen. `a6%` heißt 6 % Deckkraft.

### Flächen und Text

| Variable | Hell | Dunkel | Swift |
|---|---|---|---|
| `background` | #fafafa | #161618 | `Palette.background` |
| `foreground` | #18181b | #f5f5f7 | `Palette.foreground` |
| `sidebar` | #f4f4f5 | #0f0f10 | `Palette.sidebar` |
| `sidebar-foreground` | #18181b | #f5f5f5 | `Palette.sidebarForeground` |
| `sidebar-accent` | #ebebed | #2c2c2e | `Palette.sidebarAccent` |
| `sidebar-border` | #e8e8eb | #2c2c2e | `Palette.sidebarBorder` |
| `card` | #ffffff | #242426 | `Palette.card` |
| `card-foreground` | #18181b | #f5f5f7 | `Palette.cardForeground` |
| `popover` | #ffffff | #2c2c2e | `Palette.popover` |
| `secondary` | #f2f2f4 | #2c2c2e | `Palette.secondary` |
| `secondary-foreground` | #18181b | #f5f5f7 | `Palette.secondaryForeground` |
| `secondary-hover` | #e8e8eb | #38383a | `Palette.secondaryHover` |
| `secondary-raised` (nur App) | #f2f2f4 | #2a2a2a | `Palette.secondaryRaised`: Zweitfläche auf Karten (Nummern, „Empfohlen“, Kästchen, Zweit-Pille). Figma: `secondary` liegt dunkel eine Stufe über `card`; in der App ist dunkel `secondary` = `card` (#1f1f1f), daher eigene Farbe aus vorhandenen Dunkelwerten (06.11.2026) |
| `secondary-raised-hover` (nur App) | #e8e8eb | #3a3a3a | `Palette.secondaryRaisedHover`: Hover dazu |
| `muted` | #f2f2f4 | #2c2c2e | `Palette.muted` |
| `muted-foreground` | #65656d | #a1a1a6 | `Palette.mutedForeground` |
| `accent-neutral` | #f2f2f4 | #2c2c2e | `Palette.accentNeutral` |
| `border` | #e8e8eb | #38383a | `Palette.border` |
| `input` | #d9d9de | #48484a | `Palette.input` |
| `field` | #ffffff | #242426 | `Palette.field` |
| `segment-thumb` | #ffffff | #545458 | `Palette.segmentThumb` |
| `track` | #d4d4d8 | #48484a | `Palette.track` |
| `thumb` | #ffffff | #ffffff | `Palette.thumb` |
| `scrim` | #000000 a20% | #000000 a40% | `Palette.scrim` |
| `stage` | #000000 | #000000 | `Palette.stage` |

### Glas

| Variable | Hell | Dunkel | Swift |
|---|---|---|---|
| `glass` | #111111 a6% | #ffffff a6% | `Palette.glass` |
| `glass-hover` | #111111 a10% | #ffffff a10% | `Palette.glassHover` |
| `glass-ring` | #111111 a10% | #ffffff a10% | `Palette.glassRing` |
| `glass-active` | #111111 a15% | #ffffff a15% | `Palette.glassActive` |

### Akzent (je Orbi, zur Laufzeit)

| Variable | Hell | Dunkel | Swift |
|---|---|---|---|
| `accent` | #76767a  (→ orbi/weiss/bubble-light) | #76767a | `Palette.accent` |
| `accent-bubble` | #76767a  (→ orbi/weiss/bubble-light) | #76767a | `Palette.accentBubble` |
| `accent-foreground` | #ffffff | #ffffff | `Palette.accentForeground` |
| `primary` | #76767a  (→ accent) | #76767a | `Palette.primary` |
| `primary-foreground` | #ffffff  (→ accent-foreground) | #ffffff | `Palette.primaryForeground` |
| `ring` | #76767a  (→ accent) | #76767a | `Palette.ring` |
| `chip-selected` | #76767a  (→ accent) | #76767a | `Palette.chipSelected` |
| `chip-selected-foreground` | #ffffff  (→ accent-foreground) | #ffffff | `Palette.chipSelectedForeground` |
| `bubble-own-foreground` | #ffffff  (→ accent-foreground) | #ffffff | `Palette.bubbleOwnForeground` |
| `link` | #76767a  (→ accent) | #76767a | `Palette.link` |

### Antwort-Blase, Links, Augen

| Variable | Hell | Dunkel | Swift |
|---|---|---|---|
| `bubble-reply` | #ebebed | #2c2c2e | `Palette.bubbleReply` |
| `bubble-reply-foreground` | #18181b | #f5f5f5 | `Palette.bubbleReplyForeground` |
| `link-neutral` | #1d4ed8 | #60a5fa | `Palette.linkNeutral` |
| `orbi-auge` | #ffffff | #0f172a | `Palette.orbiAuge` |

### Fehler und Status

| Variable | Hell | Dunkel | Swift |
|---|---|---|---|
| `destructive` | #dc2626 | #ff6467 | `Palette.destructive` |
| `destructive-soft` | #fde8e8 | #3a1a1c | `Palette.destructiveSoft` |
| `status/success` | #16a34a | #16a34a | `Palette.statusSuccess` |
| `status/warning` | #ca8a04 | #ca8a04 | `Palette.statusWarning` |
| `status/info` | #2563eb | #2563eb | `Palette.statusInfo` |
| `status/caution` | #ea580c | #ea580c | `Palette.statusCaution` |
| `status/danger` | #dc2626 | #dc2626 | `Palette.statusDanger` |
| `status/star` | #facc15 | #facc15 | `Palette.statusStar` |
| `status/badge` | #000000 | #000000 | `Palette.statusBadge` |

### Die 15 Orbi-Farben

`orbi/<name>` = Körperfarbe (Figur, Punkt, Akzent), `orbi-bubble/<name>` = Blasenfarbe (dunkler, damit Text lesbar bleibt).

| Name | Farbe Hell | Farbe Dunkel | Blase Hell | Blase Dunkel |
|---|---|---|---|---|
| `orbi/weiss` | #ffffff | #ffffff | #76767a | #76767a |
| `orbi/braun` | #906538 | #996e42 | #906538 | #996e42 |
| `orbi/rot` | #df363c | #e84447 | #db3239 | #dc373d |
| `orbi/orange` | #df6521 | #e87031 | #c45102 | #c65203 |
| `orbi/gelborange` | #cf811e | #e9993a | #a76500 | #aa6703 |
| `orbi/limette` | #9bc636 | #a5d046 | #607f01 | #618102 |
| `orbi/gruen` | #43a561 | #5ac078 | #078741 | #138844 |
| `orbi/tuerkis` | #43a191 | #55b5a4 | #0d8374 | #198576 |
| `orbi/himmel` | #199ecd | #32b3e6 | #017ea7 | #0880a8 |
| `orbi/blau` | #3378ec | #3e82f4 | #2b70e4 | #2f72e3 |
| `orbi/indigo` | #5a62ed | #626df5 | #5a62ed | #5d67ef |
| `orbi/violett` | #8152eb | #895df3 | #8152eb | #8558ee |
| `orbi/fuchsia` | #bf3bdb | #c849e4 | #b934d5 | #ba39d6 |
| `orbi/pink` | #de3a8e | #e74897 | #d42f86 | #d43587 |
| `orbi/grau` | #6b7585 | #7d8797 | #64748b | #66707f |

### Figuren-Details (fest, nicht ändern)

| Name | Wert |
|---|---|
| `figure/ink` | #1b1d2a |
| `figure/gear` | #2a2d3e |
| `figure/cheek` | #ff808f a24% |
| `figure/white` | #ffffff |
| `gold/1` | #b08d4a |
| `gold/2` | #c9a45c |
| `gold/3` | #fff4d6 |
| `gold/4` | #f3d58f |
| `gold/thumb` | #e8c77a |
| `mac/red` | #ff5f57 |
| `mac/yellow` | #febc2e |
| `mac/green` | #28c840 |

## 4. Radien, Abstände, Layout, Bewegung

Quelle: Figma-Sammlung „Tokens“ (41 Variablen).

### Radien (pt)

| Variable | Wert |
|---|---|
| `radius/sm` | 6 pt |
| `radius/md` | 8 pt |
| `radius/lg` | 10 pt |
| `radius/xl` | 14 pt |
| `radius/xl2` | 18 pt |
| `radius/xl3` | 22 pt |
| `radius/bubble` | 18 pt |
| `radius/full` | 999 pt |

### Abstände (pt)

| Variable | Wert |
|---|---|
| `space/xs` | 4 pt |
| `space/sm` | 8 pt |
| `space/md` | 12 pt |
| `space/lg` | 16 pt |
| `space/xl` | 24 pt |
| `space/xxl` | 32 pt |

### Layout (pt)

| Variable | Wert |
|---|---|
| `layout/top-bar` | 52 pt |
| `layout/rail` | 88 pt |
| `layout/sidebar-min` | 220 pt |
| `layout/sidebar` | 280 pt |
| `layout/sidebar-max` | 480 pt |
| `layout/panel-max` | 520 pt |
| `layout/window-min-w` | 720 pt |
| `layout/window-min-h` | 480 pt |
| `layout/image-max` | 320 pt |
| `layout/bubble-max` | eigene Nachricht und Orbi-Antwort je bis 67,5 % der Spalte (702) (`Theme.Layout.messageShare`); beide dürfen über die Mitte gehen, Hover-Symbole unter der Blase. Spalte (Kopf, Verlauf, Eingabe) bis 1040, Rand je 16 (Grok-Bot-Abgleich 06.11.2026; nur `Theme.Layout` ändern) |
| Chat-Layout (Figma 151:93975) | jede Nachricht eigene Zeile über die Spaltenbreite; Abstand 2, beim Absenderwechsel 10; Verlauf klebt unten. Kopf eigener Streifen über dem Verlauf: oben 16, Streifen 47, Pille 41 (pad 6/20/6/10, gap 8, voll rund), dann 12 bis zum Verlauf. Eingabe in derselben Spalte: Feld 40 hoch, r24, pad 8/10/8/10; Live-Zeile 20. Seitenleiste 240 (min 240), Kopf-Knopfzeile 220 × 32, Rand 10, gap 8, innen 4 |

### Bewegung (ms)

| Variable | Wert |
|---|---|
| `motion/hover` | 150 ms |
| `motion/pop` | 100 ms |
| `motion/fade-in` | 300 ms |
| `motion/tooltip` | 150 ms |
| `motion/panel` | 380 ms |
| `motion/sidebar` | 300 ms |
| `motion/tab` | 200 ms |
| `motion/enter` | 300 ms |
| `motion/header-snap` | 300 ms |
| `motion/typing-dot` | 1200 ms |

Kurve überall `ease-in-out` (weich), außer wo bei einem Baustein etwas anderes steht. Orbi-Bewegung: eigener Abschnitt unten.

### Schrift-Größen der Texte-Stile (nur Referenz, siehe Abschnitt Schrift)

| Variable | Wert |
|---|---|
| `font/body` | 17 pt |
| `font/body-line` | 22 pt |
| `font/callout` | 15 pt |
| `font/subhead` | 13 pt |
| `font/caption` | 11 pt |
| `font/title` | 20 pt |
| `font/large-title` | 24 pt |

### Chat wie Grok Bot (ausgemessen 06.11.2026)
Quelle: `~/Projekte-Coding/.toni-tmp/orbit-darkmode-reference-grokbot-2026-11-05.png` (2×). Gilt vor älteren Figma-Werten des Chats.
- Blasen: Text 15/22, innen 12/7 (`bubblePaddingH/V`), alle Ecken gleich rund (Antwort r16 `Radius.bubbleReply`, eigene r18 → einzeilig Pille), Antwort mit Rand 0,5 `border`, keine Sprechblasen-Spitze.
- Abstände: 4 zwischen Blasen (`rowGap`), 12 beim Absenderwechsel (`senderGap`).
- Eingabeleiste: 44 hoch, Pille, Fläche `field`, Rand 0,5 `field-border` (dunkel #4d4d4d, hell #d9d9de), Plus und Senden als Kreise 28 (Plus gefüllt `secondaryHover`), Text ab 45 vom Feldrand, unten 12 zum Fenster.
- Hinter der Eingabe ist nichts deckend: der Verlauf scrollt sichtbar hinter der Leiste durch (Consti 06.11.2026); nur das Feld selbst ist deckend.
- Orbit-eigen bleiben: Orbi-Farben der eigenen Blasen, Orbi-Figur an der letzten Antwort, kein Grok-Magenta.

## 5. Schrift

- **Familie:** Inter in Figma als Ersatz für die Systemschrift **SF Pro**. Die App nutzt SF Pro (System). Code und Terminal: **Geist Mono** (Figma-Stil „Mono“, 13 pt).
- **Gebaute Größen** (so sind die Bausteine tatsächlich gesetzt, das ist maßgeblich): 10, 11, 12, 13, 14, 16, 20, 24. Stärken: Regular (400), Medium (500), Semibold (600), Bold nur Titel.
  - 11 Regular/Medium: Zweittext, Namen, Zeitstempel, Tags, Abschnittsnamen.
  - 12 Regular/Medium: Standardtext in Seitenleiste, Menüs, Knöpfen, Feldern, Listen.
  - 13 Medium/Semibold: Zeilentitel (Chat, Gruppe), Menü-Titel, Live-Zeile.
  - 15 Regular auf Zeile 22 (`Theme.Fonts.message`): Chat-Blasen und Eingabeleiste (Grok-Bot-Abgleich 06.11.2026). 14 Regular: Link-Karten.
  - 16 Medium: Dialog- und Kartentitel. 20 Bold/Semibold: Überschriften. 24: große Titel.
- **Figma-Textstile** (nur Referenz, in den Bausteinen kaum benutzt): Large Title 24, Title 20, Headline/Body 17, Callout 15, Subhead 13, Caption 11, Mono 13. Bei Abweichung gilt die gebaute Größe oben (siehe Abschnitt 12, Punkt 1).
- Zeilenhöhen sind in Figma nicht als Variablen angelegt; beim Einbau aus Bildschirm 1 abmessen und dann hier eintragen.

## 6. Schatten und Glas

Figma-Effektstile: `shadow/sm` (Radius 3), `shadow/md` (Radius 24), `glass/surface` (Hintergrund-Unschärfe 20 + Schatten 24).
- Glas nur für Menüs, Popover, schwebende Leisten (`popover` + `glass-ring` als Rand).
- Blasen, Karten und Listen haben keinen Schatten.
- Ränder: 0,5 pt in `border` (Menüs, Eingabeleiste, Chips). Fokus: `ring`.
- **Menüs (Consti, 06.11.2026, nach dem dunklen Grok-Bot-Menü; gilt vor den Figma-Zeilen „Menüeintrag“, „Plus-Menü“, „@-Liste“ unten):** eine Komponente für alle Popover- und Kontextmenüs (`MenuPanel`, `MenuRowLabel`, `MenuSeparator`, `.menuSurface()`, Werte nur aus `Theme.Menu`). Fläche `popover` (dunkel #1f1f1f, hell weiß), Rand 0,5 `border`, kein Schatten, Radius 15. Rand bis Hover-Fläche 6, Hover-Fläche bis Symbol 8 (Inhalt 14 vom Rand), Hover-Ecken 9 (konzentrisch), Hover `secondaryHover`. Zeile 35 hoch (mit Beschreibung 50), Schrift 15 (gewählt Medium), Symbol SF Symbols 17 light in 20er-Feld, Abstand 10. Rechts optional grauer Wert 14 `mutedForeground`, Haken, Chevron › 12. Trennlinie 0,5 `border`, 8 eingerückt, 5 Luft oben/unten, nie vor dem ersten Eintrag. Destruktiv rot. Breite mindestens 220, Menüs mit eigenem Inhalt 300. Prüfen: `Orbit --screenshot-menus <ordner>`.

## 7. Bausteine

### 7.1 Maße und Bindungen (Normalzustand, Hell)

Gelesen aus dem jeweils ersten Zustand der Komponente. Dunkel nutzt dieselben Variablen. „fest“ = in Figma nicht an eine Variable gebunden (Farbe kommt dann aus dem Zustand, z. B. Status-Farbe).

| Baustein (Hell; Dunkel = gleiche Variablen) | Größe Normalzustand | Radius | Innenabstand l/o/r/u · Lücke | Füllung | Rand | Text (Stärke Größe Farbe) |
|---|---|---|---|---|---|---|
| Grundteile Knopf | 82x24 | r999 | pad 12/0/12/0 gap 0 | fill foreground | line - | Regular 12 background |
| Grundteile Ausklappfeld | 150x24 | r12 | pad 12/0/12/0 gap 0 | fill secondary | line - | Regular 12 foreground |
| Grundteile Menüeintrag | 142x24 | r10 | pad 8/0/8/0 gap 6 | fill - | line - | Regular 12 foreground |
| Grundteile Eingabefeld | 180x24 | r12 | pad 12/0/12/0 gap 1 | fill secondary | line - | Regular 12 muted-foreground |
| Grundteile Schalter | 30x18 | r999 | pad 2/2/2/2 gap 0 | fill track | line - |  |
| Grundteile Reiter | 220x26 | r999 | pad 2/2/2/2 gap 0 | fill secondary | line border 0.5 | Medium 12 foreground ; Regular 12 muted-foreground ; Regular 12 muted-foreground |
| Grundteile Checkbox | 58x15 | r0 | pad 0/0/0/0 gap 6 | fill - | line - | Regular 12 foreground |
| Grundteile Kontexteintrag | 170x24 | r0 | pad 0/0/0/0 gap 0 | fill - | line - | Regular 12 foreground |
| Grundteile Tag | 65x20 | r999 | pad 8/0/8/0 gap 5 | fill secondary | line - | Regular 11 foreground |
| Grundteile Icon-Knopf | 24x24 | r6 | pad 0/0/0/0 gap 0 | fill - | line - |  |
| Chat Link-Karte | 65x24 | r8 | pad 0/0/0/0 gap 4 | fill background | line - | Regular 14 link-neutral |
| Chat Eigene Blase | 209x42 | rmixed | pad 14/10/14/10 gap 6 | fill orbi-bubble/violett | line - | Regular 14 bubble-own-foreground |
| Chat Antwort-Blase | 194x42 | rmixed | pad 14/10/14/10 gap 6 | fill bubble-reply | line - | Regular 14 bubble-reply-foreground |
| Chat Antwort-Zeile | 194x42 | r0 | pad 0/0/0/0 gap 8 | fill - | line - | Regular 14 bubble-reply-foreground |
| Chat Live-Zeile | 153x20 | r0 | pad 0/0/0/0 gap 8 | fill - | line - | Regular 13 fest |
| Chat Aktionen | 50x24 | r0 | pad 0/0/0/0 gap 2 | fill - | line - |  |
| Chat Nachricht | 265x42 | r0 | pad 0/0/0/0 gap 6 | fill - | line - | Regular 14 bubble-own-foreground |
| Chat Orbi | 24x24 | r0 | frei | fill - | line - |  |
| Chat Seitenleiste-Orbi | 220x60 | r12 | pad 10/0/10/0 gap 10 | fill - | line - | Medium 13 foreground ; Regular 12 muted-foreground |
| Chat Name | 23x13 | r0 | pad 0/0/0/0 gap 6 | fill - | line - | Medium 11 muted-foreground |
| Chat Zeitstempel | 640x29 | r0 | pad 0/8/0/8 gap 0 | fill - | line - | Medium 11 muted-foreground |
| Chat Reaktion | 27x22 | r0 | pad 0/0/0/0 gap 4 | fill - | line - | Regular 12 foreground |
| Chat Blase mit Reaktion | 209x56 | r0 | pad 0/14/0/0 gap 0 | fill - | line - | Regular 14 bubble-own-foreground ; Regular 12 foreground |
| Chat Orbi-Karte | 58x22 | r0 | pad 0/0/0/0 gap 0 | fill - | line - | Regular 14 bubble-reply-foreground |
| Chat @-Zeile | 184x24 | r10 | pad 6/0/6/0 gap 8 | fill - | line - | Regular 12 foreground |
| Chat @-Liste | 196x82 | r14 | pad 4/4/4/4 gap 1 | fill popover | line border 0.5 | Medium 11 muted-foreground ; Regular 12 foreground ; Regular 12 foreground |
| Chat Übergabe-Zeile | 190x24 | r0 | pad 0/0/0/0 gap 8 | fill - | line - | Regular 12 fest ; Regular 11 foreground |
| Chat Live-Ablauf | 460x74 | r0 | pad 0/0/0/0 gap 2 | fill - | line - | Regular 14 bubble-own-foreground ; Regular 13 fest |
| Chat Systemhinweis | 640x23 | r0 | pad 0/4/0/4 gap 6 | fill - | line - | Regular 12 muted-foreground |
| Chat Anhang in Blase | 240x160 | r14 | pad 0/0/0/0 gap 0 | fill input | line - |  |
| Chat Eingabeleiste | 640x40 | r24 | pad 10/8/10/8 gap 8 | fill field | line border 0.5 | Regular 14 muted-foreground |
| Chat Plus-Menü | 200x130 | r14 | pad 4/4/4/4 gap 1 | fill popover | line border 0.5 | Regular 12 foreground ; Medium 11 muted-foreground ; Medium 12 foreground |
| Chat Anhang-Chip | 56x72 | r0 | pad 0/0/0/0 gap 4 | fill - | line - | Regular 10 muted-foreground |
| Chat Nach unten | 28x28 | r0 | pad 0/0/0/0 gap 0 | fill - | line - |  |
| Chat Drop-Rahmen | 720x560 | r0 | pad 6/6/6/6 gap 0 | fill background | line - | Medium 13 orbi/violett ; Regular 12 muted-foreground ; Medium 12 foreground |
| Liste Seitenleisten-Kopf | 220x32 | r0 | pad 4/0/4/0 gap 8 | fill - | line - | Semi Bold 13 foreground |
| Liste Suchfeld | 220x24 | r12 | pad 8/0/8/0 gap 6 | fill secondary | line - | Regular 12 muted-foreground ; Regular 11 muted-foreground |
| Liste Trefferzeile | 368x61 | r8 | pad 8/6/8/6 gap 3 | fill - | line - | Regular 12 foreground ; Regular 11 muted-foreground ; ? |
| Liste Such-Status | 368x28 | r0 | pad 8/0/8/0 gap 6 | fill - | line - | Regular 11 muted-foreground |
| Liste Geplant | 220x32 | r8 | pad 8/0/8/0 gap 8 | fill - | line - | Regular 12 foreground |
| Liste Hauptorbi | 220x101 | r16 | pad 12/12/12/12 gap 6 | fill - | line - | Medium 12 foreground |
| Liste Gruppe | 220x60 | r12 | pad 10/0/10/0 gap 10 | fill - | line - | Medium 13 foreground ; Regular 12 muted-foreground |
| Liste Abschnitt | 220x24 | r0 | pad 8/0/8/0 gap 4 | fill - | line - | Medium 11 muted-foreground |
| Liste Chat-Zeile neu | 220x60 | r12 | pad 10/0/10/0 gap 10 | fill secondary-hover | line - | Medium 13 foreground ; Regular 12 muted-foreground |
| Liste Kontextmenü Seitenleiste | 210x143 | r14 | pad 4/4/4/4 gap 1 | fill popover | line border 0.5 | Regular 12 foreground ; Regular 12 foreground ; Regular 12 foreground |
| Liste Fuß | 220x32 | r8 | pad 8/0/8/0 gap 8 | fill - | line - | Regular 12 foreground |
| Liste Schienen-Eintrag | 60x52 | r0 | frei | fill - | line - |  |
| Liste Seitenleisten-Hinweis | 220x144 | r0 | pad 12/24/12/24 gap 16 | fill - | line - | Regular 11 muted-foreground ; Regular 12 foreground |
| Liste Routinen-Zeile | 288x36 | r0 | pad 10/0/10/0 gap 8 | fill - | line - | Regular 12 foreground ; Regular 11 muted-foreground |
| Liste Filter-Chip | 54x24 | r12 | pad 10/0/10/0 gap 4 | fill - | line border 0.5 | Regular 12 foreground |
| Liste Datei-Zeile | 440x40 | r0 | pad 10/0/10/0 gap 10 | fill - | line - | Regular 12 foreground ; Regular 11 muted-foreground |
| Liste Mitglied | 440x36 | r0 | pad 10/0/10/0 gap 10 | fill - | line - | Regular 12 foreground ; Regular 12 foreground |
| Liste Einstellungen-Nav | 176x28 | r8 | pad 8/0/8/0 gap 8 | fill - | line - | Regular 12 foreground |
| Liste Box-Zeile | 460x40 | r0 | pad 12/0/12/0 gap 10 | fill - | line - | Regular 12 foreground ; Regular 11 muted-foreground |
| Liste Automation-Zeile | 460x44 | r0 | pad 12/0/12/0 gap 10 | fill - | line - | Regular 12 foreground ; Regular 11 muted-foreground |
| Liste Papierkorb-Zeile | 460x40 | r0 | pad 12/0/12/0 gap 10 | fill - | line - | Regular 12 foreground ; Regular 11 muted-foreground |
| Liste Orbi-Form | 80x80 | r0 | frei | fill - | line - |  |
| Liste Panel-Orbi | 72x72 | r0 | frei | fill - | line - |  |
| Liste Form-Kachel | 48x48 | r12 | frei | fill - | line - |  |
| Liste Farbfeld | 36x36 | r18 | frei | fill - | line - |  |
| Liste Orbi-Menü | 360x364 | r18 | pad 16/16/16/16 gap 16 | fill card | line border 0.5 | Medium 13 foreground ; Regular 13 muted-foreground ; Regular 13 muted-foreground |

### 7.2 Alle Bausteine und ihre Zustände

Jeder Baustein existiert in Figma in Hell und Dunkel (Schritt 1 bis 3: „Hell/…“ und „Dunkel/…“). Schritt 4 und 5 sind Karten und Bildschirmteile mit den Zuständen unten. Neue Zustände nur über Figma.

| Seite | Baustein | Zustände (Variante: Werte) |
|---|---|---|
| S1 | Grundteile Knopf | Art:Haupt/Zweit; Zustand:normal/hover/gedrückt/deaktiviert |
| S1 | Grundteile Ausklappfeld | Zustand:zu/hover/offen/deaktiviert |
| S1 | Grundteile Menüeintrag | Zustand:normal/hover/gewählt/gewählt hover/deaktiviert |
| S1 | Grundteile Ausklappliste | – |
| S1 | Grundteile Eingabefeld | Zustand:leer/hover/fokussiert/ausgefüllt/fehler/deaktiviert |
| S1 | Grundteile Schalter | Wert:aus/an; Zustand:normal/hover/deaktiviert |
| S1 | Grundteile Reiter | aktiv:Profil/Aussehen/Orbis; Hover:kein/Profil/Aussehen/Orbis |
| S1 | Grundteile Checkbox | Wert:aus/an/gemischt; Zustand:normal/hover/deaktiviert |
| S1 | Grundteile Kontexteintrag | Zustand:normal/hover/deaktiviert |
| S1 | Grundteile Kontextmenü | – |
| S1 | Grundteile Tag | Art:Neutral/Akzent/Fertig/Wartet/Fehler |
| S1 | Grundteile Icon-Knopf | Zustand:aktiv/nicht aktiv/hover/gedrückt/deaktiviert |
| S2 | Auswahl-Kaestchen | gewählt:false/true |
| S2 | Chat Link-Karte | Seite:GitHub/andere; Zustand:normal/hover/alt Karte normal/in Blase/alt Karte hover/in Blase hover |
| S2 | Chat Eigene Blase | Position:Einzel/erste/mittlere/letzte; Art:Text/mehrzeilig/Link/Orbi-Karte/Skill/nicht gesendet |
| S2 | Chat Antwort-Blase | Position:Einzel/erste/mittlere/letzte; Art:Text/mehrzeilig/Markdown/Code-Block/Link/abgebrochen/Code-Block hover/Erwähnung |
| S2 | Chat Antwort-Zeile | Position:Einzel/erste/mittlere/letzte; Gruppe:nein/ja |
| S2 | Chat Live-Zeile | Zustand:arbeitet/wartet/Fehler/fertig; Phase:1/2/3/4/– |
| S2 | Chat Aktionen | Zustand:unsichtbar/sichtbar/Kopieren hover/kopiert |
| S2 | Chat Nachricht | Seite:eigene/Antwort; Zustand:normal/hover/kopiert |
| S2 | Chat Info-Karte | – |
| S2 | Chat Orbi | Figur:Trixi/Strobi/Nova/Citrus/Gelöscht; Pose:Ruhe/Arbeiten 1/Arbeiten 2/Arbeiten 3/Arbeiten 4; Größe:24/20/16 |
| S2 | Chat Seitenleiste-Orbi | Zustand:ruhig/arbeitet/hover/geöffnet/tippt/pausiert/neu · fertig (Chat zu)/neu · Frage (Chat zu)/gelesen (Chat war offen)/neu · Fehler (Chat zu) |
| S2 | Chat Name | Art:normal/gelöscht |
| S2 | Chat Zeitstempel | Art:Heute/Gestern/Wochentag/Datum |
| S2 | Chat Reaktion | Anzahl:einzeln/mehrere; Menü:zu/offen |
| S2 | Chat Blase mit Reaktion | Seite:eigene/Antwort; Anzahl:einzeln/mehrere |
| S2 | Chat Orbi-Karte | Orbi:Strobi/Nova/Citrus/Trixi/Gelöscht; Zustand:normal/gelöscht/in Blase |
| S2 | Chat @-Zeile | Orbi:Strobi/Nova/Citrus/Trixi; Zustand:normal/hover |
| S2 | Chat @-Liste | Zustand:alle/gefiltert/leer |
| S2 | Chat Übergabe-Zeile | Richtung:an/von; Status:läuft 4/wartet/fertig/Fehler/läuft 1/läuft 2/läuft 3 |
| S2 | Chat Live-Ablauf | Schritt:1 arbeitet/2 Zwischenmeldung/3 fertig |
| S2 | Chat Systemhinweis | Art:Info/Warnung/Fehler/Unterbrochen |
| S2 | Chat Anhang in Blase | Art:Bild/Datei; Zustand:lädt/fertig/normal/hover |
| S2 | Chat Eingabeleiste | Zustand:leer/getippt/mehrzeilig/Plus-Menü offen/@-Menü/@-Menü gefiltert/Orbi markiert/mit Anhängen/läuft/offline/Fehler/deaktiviert |
| S2 | Chat Plus-Menü | Art:Plus/Slash |
| S2 | Chat Anhang-Chip | Art:Bild/TXT/PDF; Zustand:normal/hover/lädt/Fehler |
| S2 | Chat Nach unten | Zustand:normal/hover/neu |
| S2 | Chat Drop-Rahmen | Dateien:eine Datei/mehrere |
| S3 | Liste Seitenleisten-Kopf | Zustand:normal/Plus-Menü offen |
| S3 | Liste Plus-Menü | – |
| S3 | Liste Suchfeld | Zustand:normal/hover/fokussiert/getippt |
| S3 | Liste Trefferzeile | Zustand:normal/aktiv |
| S3 | Liste Such-Status | Art:sucht/Index/Fehler/keine Treffer |
| S3 | Liste Ergebnisfenster | – |
| S3 | Liste Palette | – |
| S3 | Liste Geplant | Zustand:normal/hover/mit Zahl/mit Zahl hover/geöffnet |
| S3 | Liste Hauptorbi | Zustand:normal/hover/geöffnet/arbeitet/pausiert |
| S3 | Liste Tooltip | – |
| S3 | Liste Vorschau-Popover | – |
| S3 | Liste Gruppe | Zustand:ruhig/hover/geöffnet/neu (Chat zu) |
| S3 | Liste Abschnitt | Zustand:normal/hover/zugeklappt/zugeklappt hover |
| S3 | Liste Chat-Zeile neu | Zustand:hover/alt angeheftet (v6 entfernt)/wird gezogen/Drop-Linie/umbenennen |
| S3 | Liste Kontextmenü Seitenleiste | Art:Orbi/alt Orbi angeheftet (v6 entfernt)/Gruppe |
| S3 | Liste Fuß | Zustand:normal/hover/geöffnet |
| S3 | Liste Schienen-Eintrag | Zustand:normal/hover/geöffnet/neu (Chat zu) |
| S3 | Liste Schiene | – |
| S3 | Liste Seitenleisten-Hinweis | Art:leer/lädt/Fehler/keine Treffer |
| S3 | Liste Routinen-Zeile | Zustand:normal/hover |
| S3 | Liste Filter-Chip | Zustand:normal/hover/gewählt |
| S3 | Liste Datei-Zeile | Zustand:normal/hover/lädt/deaktiviert |
| S3 | Liste Mitglied | Zustand:aus/an/hover/deaktiviert |
| S3 | Liste Einstellungen-Nav | Zustand:normal/hover/gewählt/gewählt hover |
| S3 | Liste Box-Zeile | Zustand:normal/hover/mit Schalter/mit Status/aufklappbar zu/offen |
| S3 | Liste Automation-Zeile | Zustand:normal/hover/aufgeklappt/aus |
| S3 | Liste Papierkorb-Zeile | Zustand:normal/hover |
| S3 | Liste Orbi-Form | Figur:Strobi/Freddy/Citrus/Nova/Grok bot/Sunee/Kirby/Cloudee/Cubee/Onee/Rauti/Trixi/Tropi/Mopsi/Dosi |
| S3 | Liste Panel-Orbi | Zustand:ruhig (Blick links oben)/hover · Maus rechts/hover · Maus unten links/hover · Maus oben rechts |
| S3 | Liste Panel-Kopf | – |
| S3 | Liste Form-Kachel | Zustand:normal/hover/gewählt/langes Hovern |
| S3 | Liste Farbfeld | Zustand:normal/gewählt |
| S3 | Liste Hauptorbi-Warnung | – |
| S3 | Liste Orbi-Menü | Reiter:Form/Personalisieren |
| S4 | Karten Freigabe | ? |
| S4 | Karten Fragebogen | Zustand:Frage/Antwort gewählt/Antwort gewählt · Gruppe/mehrere Antworten/Zusammenfassung |
| S4 | Karten Automation-Lauf | Zustand:läuft/fertig/Fehler |
| S4 | Karten Fehler | Zustand:normal/versucht erneut |
| S4 | Karten Fehlerkarte | Zustand:normal/Gruppe/Details offen/versucht erneut |
| S4 | Karten Bild | Zustand:wird erstellt/fertig/Fehler |
| S4 | Karten Bild-Karte | Zustand:wird erstellt/fertig/Fehler/nicht weitergegeben |
| S4 | Karten Bild-Vollansicht | Zustand:normal |
| S4 | Karten Routine-Vorschlag | Zustand:1:1/Gruppe/erstellt |
| S4 | Karten Live-Zeile | Zustand:arbeitet/Text wechselt/fertig |
| S4 | Karten Chat-Kopf | Zustand:normal/Hover/Gruppe/Gruppe · Hover/Gruppe · 6 Orbis |
| S4 | Karten Chat-Kopf Lage | Zustand:1:1/Gruppe |
| S4 | Karten Computer-Panel | Zustand:bei Bedarf/startet/verbunden/Hover |
| S4 | Karten Computer-Bildschirm | Zustand:kein Computer/offline/getrennt/Fehler |
| S4 | Karten Computer-Gruppe | Zustand:Pico gewählt/Hover |
| S4 | Karten Computer-Vollbild | Zustand:normal/Hinweis |
| S4 | Karten Dialog Gruppe | Zustand:neu · leer/neu · Hover/6 gewählt/bearbeiten/Fehler |
| S4 | Karten Formular Routine | Zustand:neu/bearbeiten/Fehler/speichert |
| S4 | Karten Einstellungen Nutzung | Zustand:normal/Laden/Offline/Fehler |
| S4 | Karten Einstellungen Orbis-Anleitung | Zustand:normal/Laden/Offline/Fehler |
| S4 | Karten Einstellungen Marktplatz | Zustand:normal/Laden/Offline/Fehler |
| S4 | Karten Einstellungen Darstellung | Zustand:normal/Laden/Offline/Fehler |
| S4 | Karten Einstellungen Allgemein | Zustand:normal/Mitteilungen aus/Offline |
| S4 | Karten Dialog Löschen | Zustand:Orbi löschen/Skill löschen/Verlauf leeren/löscht …/Fehler |
| S4 | Karten Dialog Neuer Skill | Zustand:leer/voll/Fehler/speichert |
| S4 | Karten Modell-Auswahl | Zustand:Auto/Denktiefe Mittel/Denktiefe Max/ohne Denktiefe/keine Modelle |
| S4 | Karten Plan-Hinweis | Zustand:normal/Ausführen gesperrt |
| S4 | Karten Befehlsmenü | Zustand:Brain offline/normal/lädt/leer |
| S4 | Karten Menüleiste Symbol | Zustand:ruhig/arbeitet oder wartet |
| S4 | Karten Menüleiste Menü | Zustand:mit Orbis/Hover/leer/Dienst nicht erreichbar |
| S4 | Karten Websuche | Zustand:läuft/zu/offen/Quellen offen/keine Treffer/Fehler |
| S4 | Karten Jev-Block | Zustand:zu/offen/Fallback |
| S4 | Karten Werkzeugzeile | Zustand:läuft/wartet auf Freigabe/fertig/fertig · offen/Fehler · offen/abgelehnt |
| S4 | Karten Werkzeug-Karte | Zustand:Datei/Datei Fehler/abgelehnt/Fehler/wartet auf Antwort |
| S5 | Orbi folgt der Maus · Onboarding 1 · * | Zustand:ruhig/Blick oben links/Blick oben mitte/Blick oben rechts/Blick mitte links/Blick mitte mitte/Blick mitte rechts/Blick unten links/Blick unten mitte/Blick unten rechts |
| S5 | Orbi folgt der Maus · Onboarding 2a · * | Zustand:ruhig/Blick oben links/Blick oben mitte/Blick oben rechts/Blick mitte links/Blick mitte mitte/Blick mitte rechts/Blick unten links/Blick unten mitte/Blick unten rechts |
| S5 | Orbi klein · Onboarding 3/4 · * | Zustand:ruhig |
| S5 | Zugriff-Zeile · Onboarding · * | Recht:Mitteilungen/Hintergrund; Zustand:offen/erlaubt |
| S5 | Konto-Zeile · Onboarding · * | Konto:Claude/Codex/Antigravity; Zustand:offen/angemeldet |
| S5 | Orbi freut sich · Onboarding 5 · * | Zustand:freut sich |
| S5 | Orbi ausgewählt · Onboarding 6 · * | Zustand:ausgewählt |

## 8. Bildschirme (Referenz zum Abgleich)

Figma-Seite „Grundlagen“, Rahmen „Schritt 5 – Bildschirme“ (148:90553), je Hell und Dunkel:
1. Einzelchat mit Trixi (arbeitet)
2. Gruppenchat „Familie“ (Trixi, Lumi, Strobi)
3. Startbildschirm (kein Chat ausgewählt)
4. Chat mit eingeklappter Seitenleiste
5. Erststart (noch kein Orbi)

Dazu „Schritt 4 – Karten & Dialoge“ (139:39452) mit Beispiel-Fenster „Lumi 1:1“ und „Schritt 5 – Onboarding“ (164:116621): Willkommen, Orbi gestalten (Form und Farbe), Mac-Zugriffe, Dienste verbinden, Abschluss, Orbi ausgewählt/Ziel.

Fenster: Mindestgröße 720 × 480, Seitenleiste 240 (240 bis 480), Schiene eingeklappt 88, Kopfleiste 52, Panel rechts bis 520, Spalte bis 1040 (Rand 32), eigene Blase und Antwort je bis 624 (60 %), Bild bis 320.

## 9. Orbis: Aussehen und Bewegung

Quelle: Figma-Seiten „Posen – Orbi-Zustände“ und „Animationen – Orbis“ (aus `OrbiBehavior.swift`). Stil: weich (ease-in-out), Augen weit.

- **Grundblick:** links oben (Code −0,8 / −0,85 × 1,5, in den Körper eingepasst), Neigung 9°. Dabei komplett still: kein Blinzeln, kein Atmen.
- **Rollen (Größe):** Seitenleiste und Schiene 40, Nachricht (nur Gruppen) 24, Chat-Orbi 24/20/16, Panel-Orbi 72, Kopf-Pille in „echter Größe“ (Maß im Figma-Baustein „Chat-Kopf“ nachmessen). Figuren: Strobi, Freddy, Citrus, Nova, Grok bot, Sunee, Kirby, Cloudee, Cubee, Onee, Rauti, Trixi, Tropi, Mopsi, Dosi.
- **Zustände:**

| Zustand | Wo | Bewegung |
|---|---|---|
| idle | Seitenleiste, Chat zu | steht 9° nach rechts geneigt, Blick links oben, atmet leicht, blinzelt alle 2 bis 4 s; Maus im Feld: nur die Augen folgen |
| selected | Seitenleiste, Chat offen | Blick wechselt sanft (links/rechts, lx ±0,2 bis 0,35) alle 1,2 bis 2,5 s, Übergang 0,7 bis 0,9 s, Neigung lx·3°, blinzelt alle 2,5 bis 4 s |
| head | Chat-Kopf | wie selected; Gruppen-Pille: Augen aller Orbis folgen der Maus (Stärke tanh(Abstand / (Breite·1,4))), Neigung lx·5°, danach 1,6 s zurück nach links oben |
| message | neben Nachrichten (Gruppen) | steht gerade, still, kein Blinzeln |
| working | arbeitet oder tippt | wippt (Periode 1,67 s), Blick weit, wechselt alle 1,2 bis 2,5 s (0,55 bis 0,8 s), Augen 0,94 bis 1,10×, blinzelt 2,5 bis 4 s; bei 8 s Sprung mit Drehung, bei 18 s Rückwärtssalto (je 0,95 s); Text schimmert |
| waiting | wartet auf dich | sanftes Wiegen (±5, Periode 6,7 s, Neigung ±2,5°), Blick folgt weich, keine Hüpfer, kein Blinzeln |
| done | fertig, Chat noch zu | Feier: ducken, Rückwärtssalto (26 hoch, 0,62 s), ducken, Rückwärtssalto (32 hoch, 0,75 s), 18 Sterne, wackeln; ab 2,3 s große Augen (1,2×), kleine Hüpfer (9 hoch) alle 1,3 bis 1,9 s |

- **Status-Punkt:** nur in der Seitenleiste; fertig blau, braucht dich orange, arbeitet nur Animation (E51/D04, 03.11.2026).
- **Live-Zeile** (Chat, = Statusleiste): Zustände arbeitet / wartet / Fehler / fertig, Phasen 1 bis 4; Text wechselt weich. **Nicht blau**: Figur 24, Regular 13, grauer Text mit Schimmer, nur während der Arbeit. Wartet der Orbi auf Consti: „Wartet auf deine Antwort“ ohne Schimmer. Es gibt kein „N Schritte ›“ und kein Ausklappen von Schritten (Stand 01.11.2026, Code Phase 3 Korrektur).
- **Reaktionen:** Pille (Emoji, Zahl nur bei mehreren) sitzt **halb über der oberen linken Ecke** der ersten Blase; Klick öffnet das Menü mit Orbis und Emoji. 👍/👎 beantwortet eine offene Einzelkarte.
- Systemeinstellung „Bewegung reduzieren“ respektieren; kein eigener Schalter in der Oberfläche.

## 10. Texte, die gelten

- Pausiert-Zustand: „Pausiert, wartet“ (nie „Limit“).
- Freigabe-Karte: Eingaben ansehen, Knöpfe **Einmal / Immer für diese Art / Ablehnen**; bei Zugangsdaten kein „Immer“; Hinweis „Wartet bis zu 24 Stunden auf dich“. (Inhalt aus Phase 1, Gestaltung aus Schritt 4 Teil 1.)
- Rückfrage: „1 von 3“, eine Antwort als „Empfohlen“, Zusammenfassung der Antworten.
- Websuche-Karte, Jev-Block und Werkzeugzeilen sind aus der App entfernt und nicht mehr Teil des Designs (in Figma als „alt“ markiert). **Werkzeuge sind in der App gar nicht sichtbar** (auch nicht die Figma-Bausteine „Karten Werkzeugzeile“ und „Werkzeug-Karte“ in 7.2, außer Datei-Karten): es gibt nur eine Hinweiszeile bei Wiederholung oder Handlungsbedarf (Ereignis `notice`, höchstens 3 je Turn, ohne Technik).
- **Gestrichen:** Einstellung für Antwortlänge (Antworten sind immer kurz), Chat-Titel, Einstellung „Schritte immer ausklappen“.
- **Karten, die dazukamen (Stand 02.11.2026):**
  - Freigabe **„Dauerhafte Änderung“** (siebte Art, für Automationen und Brain-Regeln): Titel, darunter ein Detailblock mit Plan und Prompt wörtlich (Zeilenumbrüche erhalten, ab 160 pt scrollbar, auswählbar), „Einmal erlauben“ und „Ablehnen“; **neu 03.11.2026 (E14): auch „Immer“**. Dazu bei allen Freigaben ein kleiner Link „Eingaben ansehen“ (nicht in Figma).
  - Datei-Karte: Datei-Zeile, Download erst beim Überfahren (ohne Datumsteil und „…“-Menü).
  - Auswahl-Karte „1 von 3“ mit neutraler „Empfohlen“-Pille.
- **Mac-Ansichten ohne Figma-Vorlage (Phase 4, aus vorhandenen Panel-Bausteinen gebaut):** Reiter **„Gedächtnis“** im Orbi-Seitenpanel (Einträge mit Name, Beschreibung, Art, Herkunft, Datum; Aufklappen, Löschen mit Bestätigung, Leer-Zustand „Noch nichts gemerkt.“); **Träumer-Schalter** mit Erklärtext, letztem Lauf und Änderungslog; **Info-Popover** mit Zeilen zur Modellwahl („Start klein“, „Hochgestuft von A auf B“, „Bleibt bei A (Cache warm)“), Grund, Cache, Schritte, Kosten. Kosten und Tagesdeckel des Träumers werden bewusst nicht gezeigt.
- **Noch offene Karten** (im Code nicht nach Figma): Link-Karte, Freigabe in Gruppen (neutrale Knopffarben), Fehler-Karte, Automation-Karte, Zeitstempel-Trennzeilen, Systemhinweis „Unterbrochen/Weiter“ und „Nochmal“.

## 11. Figma → Code (Namensregel)

Figma-Variable `a/b-c` → Swift `Theme.Palette.aBC` (Farben), `Theme.Radius.xl2`, `Theme.Space.md`, `Theme.Layout.sidebar`, `Theme.Motion.panel`, `Theme.Font…`. Farben als Asset-Katalog mit Hell/Dunkel-Variante (Namen wie in Figma), Orbi-Farben zusätzlich als Liste `OrbiPalette` mit allen 15 Namen. Nach jedem Einbau: Suche nach `Color(`, `.padding(<Zahl>`, `.cornerRadius(<Zahl>`, `.animation(` ohne Theme muss leer sein oder begründet.

## 12. Bekannte Lücken und Abweichungen (Stand 02.11.2026)

1. **Schrift-Doppelung:** Die Figma-Textstile (17/15/13/11) stimmen nicht mit den tatsächlich gebauten Größen (11 bis 14) überein. Maßgeblich sind die gebauten Größen (Abschnitt 5). Beim Einbau eine Skala daraus festlegen, Figma-Textstile bei Gelegenheit angleichen (ohne Optik zu ändern).
2. **Lose Farben:** In „Schritt 4“ sind etwa 7 % der Füllungen (554 von 8147) nicht an Variablen gebunden. Vermutlich Zustandsfarben, Figuren-Details und „alt“-Ebenen. Nicht geprüft, welche davon echte Lücken sind. Werte nie aus diesen Stellen übernehmen, sondern aus Abschnitt 3.
3. **Fehlende ganze Bildschirme:** „Chat mit Übergabe“ und „Einstellungen“ als Gesamtansicht gibt es nicht. Übergabe-Zeile (7.2) und Einstellungsseiten (Schritt 4 Teil 12) sind da und genügen für den Bau.
4. **Onboarding:** „5 Abschluss“ und „6 Ziel nach dem Flug“ gibt es in Hell, Dunkel nicht bestätigt.
5. **Aufräumen offen:** Figma-Löschliste (`loeschliste.md`: ausgeblendete und „alt“-Ebenen, Geplant-Komponenten) ist am 03.11. freigegeben (D15). Bis dahin „alt“ ignorieren.
6. **App ist teilweise angepasst.** Phase 1–4 haben Live-Zeile, Reaktionen, Freigabe-, Auswahl- und Dateikarte nach Figma gebaut; Rest stand in `App-Anpassungen aus Endcheck.md` (archiviert; offen ist jetzt L1–L15 in Brain `02 Projekte/Orbit/Orbit Entscheidungen.md`) (Farben, „Limit“, Kürzel, Seitenleiste, Link-Karten, Orbi-Menü, Zeitstempel). Der Figma-Einbau (Theme, Farbwechsel) passiert erst am Ende aller Phasen.
7. **Ohne Figma-Vorlage:** Mac-Ansichten Gedächtnis-Reiter, Träumer-Schalter und Info-Popover (Abschnitt 10) und die Freigabe „Dauerhafte Änderung“ mit Detailblock; sie sind aus vorhandenen Bausteinen gebaut und müssen bei Gelegenheit in Figma nachgezogen werden.
8. Offene Designwünsche P5 (ein Orbi-Baustein) und I6 (eigene Formen) sind bewusst nicht umgesetzt.

## 13. Figma-Ablage (zum Nachschlagen)

Datei: „Ohne Namen“, Seite „Grundlagen“ (Seite „Endcheck“ nur Prüfprotokoll).
Rahmen: Orbi-Farben 1:292 · Flächen & Text Hell 1:451 / Dunkel 1:541 · Schrift 1:631 · Radius/Abstände/Bewegung 1:675 · Schritt 1 6:13369 · Schritt 2 26:9850 · Schritt 3 49:14782 · Schritt 3 final 124:29268 · Schritt 4 139:39452 · Posen 145:58794 · Animationen 147:59236 · Schritt 5 Bildschirme 148:90553 · Schritt 5 Onboarding 164:116621.
Zugriff nur lesend: `cd ~/figma-cli && node src/index.js run <datei.js>` (Figma Desktop muss offen sein; einmal `node src/index.js connect`).

## 14. Bildreferenz (Figma nicht mehr nötig)

Alle Rahmen der Figma-Datei liegen als Bild vor (Maßstab 1:1 zu Figma, 128 Dateien). Die Bilder zeigen das Soll-Aussehen; Maße und Variablen stehen in den Abschnitten 3 bis 7, die Rohdaten in `tokens.dtcg.json` und `variablen-vollstaendig.json`. Zu jedem Baustein: Bild ansehen, Wert aus der Tabelle nehmen, Farbe/Abstand nur über die Namen.

**Rohdaten und Vektoren** (Ordner `design/`):
- `tokens.dtcg.json`: alle Variablen als W3C-Design-Tokens.
- `variablen-vollstaendig.json`: alle 4 Sammlungen mit Werten (Hell, Dunkel, Primitives, Tokens).
- `09-orbi-formen/<name>.svg` und `.png`: die 15 Orbi-Körper als Vektor (Strobi, Freddy, Citrus, Nova, Grok bot, Sunee, Kirby, Cloudee, Cubee, Onee, Rauti, Trixi, Tropi, Mopsi, Dosi), 80 × 80, Grundpose.
- Schrift: Inter (Ersatz für SF Pro), Geist Mono. Symbole: siehe Bilder, in der App Systemsymbole (SF Symbols), sofern nicht anders gezeichnet.

### Grundlagen: Farben, Flächen, Schrift, Radius/Abstände/Bewegung

- [00-grundlagen/orbi-farben-15-fest.png](design/00-grundlagen/orbi-farben-15-fest.png) · Orbi-Farben (15, fest) (722x1236)
- [00-grundlagen/flaechen-text-hell.png](design/00-grundlagen/flaechen-text-hell.png) · Flächen & Text – Hell (1040x510)
- [00-grundlagen/flaechen-text-dunkel.png](design/00-grundlagen/flaechen-text-dunkel.png) · Flächen & Text – Dunkel (1040x510)
- [00-grundlagen/schrift-inter-als-sf-pro-ersatz.png](design/00-grundlagen/schrift-inter-als-sf-pro-ersatz.png) · Schrift (Inter als SF-Pro-Ersatz) (615x588)
- [00-grundlagen/radius-abstaende-bewegung.png](design/00-grundlagen/radius-abstaende-bewegung.png) · Radius, Abstände, Bewegung (685x754)

### Schritt 1: Grundteile (Knopf, Feld, Schalter, Menü …)

- [01-schritt1-grundteile/kopf.png](design/01-schritt1-grundteile/kopf.png) · Kopf (2056x58)
- [01-schritt1-grundteile/graustufen-skala.png](design/01-schritt1-grundteile/graustufen-skala.png) · Graustufen-Skala (2056x381)
- [01-schritt1-grundteile/teil-1-knoepfe.png](design/01-schritt1-grundteile/teil-1-knoepfe.png) · Teil 1 · Knöpfe (2056x166)
- [01-schritt1-grundteile/teil-2-ausklappmenue.png](design/01-schritt1-grundteile/teil-2-ausklappmenue.png) · Teil 2 · Ausklappmenü (2056x272)
- [01-schritt1-grundteile/teil-3-eingabefeld.png](design/01-schritt1-grundteile/teil-3-eingabefeld.png) · Teil 3 · Eingabefeld (2056x218)
- [01-schritt1-grundteile/teil-4-schalter.png](design/01-schritt1-grundteile/teil-4-schalter.png) · Teil 4 · Schalter (2056x160)
- [01-schritt1-grundteile/teil-5-reiter.png](design/01-schritt1-grundteile/teil-5-reiter.png) · Teil 5 · Reiter (2056x244)
- [01-schritt1-grundteile/teil-6-checkbox.png](design/01-schritt1-grundteile/teil-6-checkbox.png) · Teil 6 · Checkbox (2056x157)
- [01-schritt1-grundteile/teil-7-kontextmenue.png](design/01-schritt1-grundteile/teil-7-kontextmenue.png) · Teil 7 · Kontextmenü (2056x200)
- [01-schritt1-grundteile/teil-8-tags.png](design/01-schritt1-grundteile/teil-8-tags.png) · Teil 8 · Tags (2056x162)
- [01-schritt1-grundteile/teil-9-icon-knoepfe.png](design/01-schritt1-grundteile/teil-9-icon-knoepfe.png) · Teil 9 · Icon-Knöpfe (2056x166)

### Schritt 2: Chat-Teile (Blasen, Live-Zeile, Eingabeleiste …)

- [02-schritt2-chat/kopf.png](design/02-schritt2-chat/kopf.png) · Kopf (2056x175)
- [02-schritt2-chat/teil-1-eigene-blase.png](design/02-schritt2-chat/teil-1-eigene-blase.png) · Teil 1 · Eigene Blase (2056x1107)
- [02-schritt2-chat/teil-2-antwort-blase.png](design/02-schritt2-chat/teil-2-antwort-blase.png) · Teil 2 · Antwort-Blase (2056x1765)
- [02-schritt2-chat/teil-3-live-zeile-statt-tippen-blase.png](design/02-schritt2-chat/teil-3-live-zeile-statt-tippen-blase.png) · Teil 3 · Live-Zeile (statt Tippen-Blase) (2056x344)
- [02-schritt2-chat/teil-4-nachrichten-aktionen.png](design/02-schritt2-chat/teil-4-nachrichten-aktionen.png) · Teil 4 · Nachrichten-Aktionen (2056x576)
- [02-schritt2-chat/teil-5-avatar-seitenleiste.png](design/02-schritt2-chat/teil-5-avatar-seitenleiste.png) · Teil 5 · Avatar & Seitenleiste (2056x743)
- [02-schritt2-chat/teil-6-name.png](design/02-schritt2-chat/teil-6-name.png) · Teil 6 · Name (2056x293)
- [02-schritt2-chat/teil-7-zeitstempel.png](design/02-schritt2-chat/teil-7-zeitstempel.png) · Teil 7 · Zeitstempel (2056x444)
- [02-schritt2-chat/teil-8-reaktion.png](design/02-schritt2-chat/teil-8-reaktion.png) · Teil 8 · Reaktion (2056x500)
- [02-schritt2-chat/teil-9-markierung.png](design/02-schritt2-chat/teil-9-markierung.png) · Teil 9 · @-Markierung (2056x302)
- [02-schritt2-chat/teil-10-auswahlliste.png](design/02-schritt2-chat/teil-10-auswahlliste.png) · Teil 10 · @-Auswahlliste (2056x482)
- [02-schritt2-chat/teil-11-uebergabe-zeilen.png](design/02-schritt2-chat/teil-11-uebergabe-zeilen.png) · Teil 11 · Übergabe-Zeilen (2056x384)
- [02-schritt2-chat/teil-12-live-statusleiste-live-zeile.png](design/02-schritt2-chat/teil-12-live-statusleiste-live-zeile.png) · Teil 12 · Live-Statusleiste = Live-Zeile (2056x634)
- [02-schritt2-chat/teil-13-systemhinweise.png](design/02-schritt2-chat/teil-13-systemhinweise.png) · Teil 13 · Systemhinweise (2056x438)
- [02-schritt2-chat/teil-14-anhaenge-in-blase.png](design/02-schritt2-chat/teil-14-anhaenge-in-blase.png) · Teil 14 · Anhänge in Blase (2056x508)
- [02-schritt2-chat/teil-15-eingabeleiste.png](design/02-schritt2-chat/teil-15-eingabeleiste.png) · Teil 15 · Eingabeleiste (2056x1551)
- [02-schritt2-chat/teil-16-anhang-chip.png](design/02-schritt2-chat/teil-16-anhang-chip.png) · Teil 16 · Anhang-Chip (2056x352)
- [02-schritt2-chat/teil-17-nach-ganz-unten-knopf.png](design/02-schritt2-chat/teil-17-nach-ganz-unten-knopf.png) · Teil 17 · „Nach ganz unten“-Knopf (2056x308)
- [02-schritt2-chat/teil-18-drop-rahmen.png](design/02-schritt2-chat/teil-18-drop-rahmen.png) · Teil 18 · Drop-Rahmen (2056x1416)
- [02-schritt2-chat/teil-19-beispiel-chat.png](design/02-schritt2-chat/teil-19-beispiel-chat.png) · Teil 19 · Beispiel-Chat (2056x1662)

### Schritt 3: Listen und Seitenleisten

- [03-schritt3-listen/kopf.png](design/03-schritt3-listen/kopf.png) · Kopf (2056x148)
- [03-schritt3-listen/teil-1-kopf-suche.png](design/03-schritt3-listen/teil-1-kopf-suche.png) · Teil 1 · Kopf & Suche (2056x580)
- [03-schritt3-listen/teil-2-suchergebnisse.png](design/03-schritt3-listen/teil-2-suchergebnisse.png) · Teil 2 · Suchergebnisse (2056x946)
- [03-schritt3-listen/teil-3-geplant.png](design/03-schritt3-listen/teil-3-geplant.png) · Teil 3 · Geplant (2056x383)
- [03-schritt3-listen/teil-4-hauptorbi.png](design/03-schritt3-listen/teil-4-hauptorbi.png) · Teil 4 · Hauptorbi (2056x521)
- [03-schritt3-listen/teil-5-chat-zeile.png](design/03-schritt3-listen/teil-5-chat-zeile.png) · Teil 5 · Chat-Zeile (2056x801)
- [03-schritt3-listen/teil-6-gruppen.png](design/03-schritt3-listen/teil-6-gruppen.png) · Teil 6 · Gruppen (2056x439)
- [03-schritt3-listen/teil-7-abschnitte.png](design/03-schritt3-listen/teil-7-abschnitte.png) · Teil 7 · Abschnitte (2056x622)
- [03-schritt3-listen/teil-8-neu-anheften-ziehen-umbenennen.png](design/03-schritt3-listen/teil-8-neu-anheften-ziehen-umbenennen.png) · Teil 8 · Neu: Anheften, Ziehen, Umbenennen (2056x704)
- [03-schritt3-listen/teil-9-kontextmenues.png](design/03-schritt3-listen/teil-9-kontextmenues.png) · Teil 9 · Kontextmenüs (2056x446)
- [03-schritt3-listen/teil-10-fuss-einstellungen.png](design/03-schritt3-listen/teil-10-fuss-einstellungen.png) · Teil 10 · Fuß Einstellungen (2056x335)
- [03-schritt3-listen/teil-11-eingeklappte-schiene.png](design/03-schritt3-listen/teil-11-eingeklappte-schiene.png) · Teil 11 · Eingeklappte Schiene (2056x1325)
- [03-schritt3-listen/teil-12-leer-laden-fehler.png](design/03-schritt3-listen/teil-12-leer-laden-fehler.png) · Teil 12 · Leer, Laden, Fehler (2056x508)
- [03-schritt3-listen/teil-13-rechtes-panel.png](design/03-schritt3-listen/teil-13-rechtes-panel.png) · Teil 13 · Rechtes Panel (2056x723)
- [03-schritt3-listen/teil-14-bibliothek.png](design/03-schritt3-listen/teil-14-bibliothek.png) · Teil 14 · Bibliothek (2056x829)
- [03-schritt3-listen/teil-15-mitglieder.png](design/03-schritt3-listen/teil-15-mitglieder.png) · Teil 15 · Mitglieder (2056x602)
- [03-schritt3-listen/teil-16-einstellungen-navigation.png](design/03-schritt3-listen/teil-16-einstellungen-navigation.png) · Teil 16 · Einstellungen-Navigation (2056x623)
- [03-schritt3-listen/teil-17-einstellungslisten.png](design/03-schritt3-listen/teil-17-einstellungslisten.png) · Teil 17 · Einstellungslisten (2056x1314)
- [03-schritt3-listen/teil-18-routinen-panel-papierkorb.png](design/03-schritt3-listen/teil-18-routinen-panel-papierkorb.png) · Teil 18 · Routinen (Panel) & Papierkorb (2056x1017)
- [03-schritt3-listen/teil-19-beispiel-seitenleiste.png](design/03-schritt3-listen/teil-19-beispiel-seitenleiste.png) · Teil 19 · Beispiel-Seitenleiste (2056x1195)
- [03-schritt3-listen/teil-20-beispiel-fenster.png](design/03-schritt3-listen/teil-20-beispiel-fenster.png) · Teil 20 · Beispiel-Fenster (2056x2184)
- [03-schritt3-listen/teil-21-rechtes-panel-orbi-oben-bearbeiten.png](design/03-schritt3-listen/teil-21-rechtes-panel-orbi-oben-bearbeiten.png) · Teil 21 · Rechtes Panel · Orbi oben & bearbeiten (2056x3366)

### Schritt 3 final: fertige Seitenleiste Hell und Dunkel

- [03-schritt3-final/hell-dunkel.png](design/03-schritt3-final/hell-dunkel.png) · Hell & Dunkel (2800x3873)

### Schritt 4: Karten und Dialoge

- [04-schritt4-karten/kopf.png](design/04-schritt4-karten/kopf.png) · Kopf (2056x129)
- [04-schritt4-karten/teil-1-freigabe.png](design/04-schritt4-karten/teil-1-freigabe.png) · Teil 1 · Freigabe (2056x638)
- [04-schritt4-karten/teil-2-rueckfrage-fragebogen.png](design/04-schritt4-karten/teil-2-rueckfrage-fragebogen.png) · Teil 2 · Rückfrage-Fragebogen (2056x1580)
- [04-schritt4-karten/teil-3-automation-lauf.png](design/04-schritt4-karten/teil-3-automation-lauf.png) · Teil 3 · Automation-Lauf (2056x329)
- [04-schritt4-karten/teil-4-fehler.png](design/04-schritt4-karten/teil-4-fehler.png) · Teil 4 · Fehler (2056x329)
- [04-schritt4-karten/kopf-block-b.png](design/04-schritt4-karten/kopf-block-b.png) · Kopf Block B (2056x58)
- [04-schritt4-karten/teil-5-bild.png](design/04-schritt4-karten/teil-5-bild.png) · Teil 5 · Bild (2056x1124)
- [04-schritt4-karten/teil-6-routine-vorschlag.png](design/04-schritt4-karten/teil-6-routine-vorschlag.png) · Teil 6 · Routine-Vorschlag (2056x523)
- [04-schritt4-karten/teil-7-live-zeile.png](design/04-schritt4-karten/teil-7-live-zeile.png) · Teil 7 · Live-Zeile (2056x511)
- [04-schritt4-karten/kopf-block-c.png](design/04-schritt4-karten/kopf-block-c.png) · Kopf Block C (2056x58)
- [04-schritt4-karten/teil-8-chat-kopf.png](design/04-schritt4-karten/teil-8-chat-kopf.png) · Teil 8 · Chat-Kopf (2056x775)
- [04-schritt4-karten/teil-9-reiter-computer.png](design/04-schritt4-karten/teil-9-reiter-computer.png) · Teil 9 · Reiter „Computer“ (2056x2386)
- [04-schritt4-karten/teil-10-dialog-gruppe.png](design/04-schritt4-karten/teil-10-dialog-gruppe.png) · Teil 10 · Dialog Gruppe (2056x2102)
- [04-schritt4-karten/teil-11-formular-routine.png](design/04-schritt4-karten/teil-11-formular-routine.png) · Teil 11 · Formular Routine (2056x1104)
- [04-schritt4-karten/kopf-block-d.png](design/04-schritt4-karten/kopf-block-d.png) · Kopf Block D (2056x58)
- [04-schritt4-karten/teil-12-einstellungen.png](design/04-schritt4-karten/teil-12-einstellungen.png) · Teil 12 · Einstellungen (2056x5097)
- [04-schritt4-karten/teil-13-dialoge.png](design/04-schritt4-karten/teil-13-dialoge.png) · Teil 13 · Dialoge (2056x2914)
- [04-schritt4-karten/beispiel-fenster-lumi-1-1.png](design/04-schritt4-karten/beispiel-fenster-lumi-1-1.png) · Beispiel-Fenster · Lumi 1:1 (2056x2348)

### Posen der Orbis

- [07-posen/kopf.png](design/07-posen/kopf.png) · Kopf (2056x92)
- [07-posen/zone-hell.png](design/07-posen/zone-hell.png) · Zone Hell (2056x376)
- [07-posen/zone-dunkel.png](design/07-posen/zone-dunkel.png) · Zone Dunkel (2056x376)
- [07-posen/feedback-posen.png](design/07-posen/feedback-posen.png) · Feedback · Posen (2056x148)

### Animationen der Orbis (Standbilder + Beschreibungstexte)

- [08-animationen/kopf.png](design/08-animationen/kopf.png) · Kopf (2056x92)
- [08-animationen/stelle-1-seitenleiste-ausgeklappt.png](design/08-animationen/stelle-1-seitenleiste-ausgeklappt.png) · Stelle 1 · Seitenleiste ausgeklappt (2056x1162)
- [08-animationen/stelle-2-seitenleiste-eingeklappt.png](design/08-animationen/stelle-2-seitenleiste-eingeklappt.png) · Stelle 2 · Seitenleiste eingeklappt (2056x648)
- [08-animationen/stelle-3-chat-kopf-gruppe.png](design/08-animationen/stelle-3-chat-kopf-gruppe.png) · Stelle 3 · Chat-Kopf (Gruppe) (2056x1104)
- [08-animationen/stelle-4-neben-nachrichten-nur-gruppen.png](design/08-animationen/stelle-4-neben-nachrichten-nur-gruppen.png) · Stelle 4 · Neben Nachrichten (nur Gruppen) (2056x892)
- [08-animationen/stelle-5-live-zeile-arbeiten-v2.png](design/08-animationen/stelle-5-live-zeile-arbeiten-v2.png) · Stelle 5 · Live-Zeile (Arbeiten v2) (2056x632)
- [08-animationen/stelle-6-panel-orbi-rechts.png](design/08-animationen/stelle-6-panel-orbi-rechts.png) · Stelle 6 · Panel-Orbi rechts (2056x1072)
- [08-animationen/stelle-7-bearbeiten-menue.png](design/08-animationen/stelle-7-bearbeiten-menue.png) · Stelle 7 · Bearbeiten-Menü (2056x1348)
- [08-animationen/stelle-8-leerzustand.png](design/08-animationen/stelle-8-leerzustand.png) · Stelle 8 · Leerzustand (2056x1072)
- [08-animationen/stelle-9-erwaehnung.png](design/08-animationen/stelle-9-erwaehnung.png) · Stelle 9 · @-Erwähnung (2056x816)
- [08-animationen/feedback-animationen.png](design/08-animationen/feedback-animationen.png) · Feedback · Animationen (2056x118)

### Schritt 5: ganze Bildschirme

- [05-bildschirme/kopf.png](design/05-bildschirme/kopf.png) · Kopf (2056x110)
- [05-bildschirme/bildschirm-1-einzelchat-mit-trixi-arbeitet.png](design/05-bildschirme/bildschirm-1-einzelchat-mit-trixi-arbeitet.png) · Bildschirm 1 · Einzelchat mit Trixi (arbeitet) (2056x2365)
- [05-bildschirme/bildschirm-2-gruppenchat-familie-trixi-lumi-strobi.png](design/05-bildschirme/bildschirm-2-gruppenchat-familie-trixi-lumi-strobi.png) · Bildschirm 2 · Gruppenchat Familie (Trixi, Lumi, Strobi) (2056x2365)
- [05-bildschirme/bildschirm-3-startbildschirm-kein-chat-ausgewaehlt.png](design/05-bildschirme/bildschirm-3-startbildschirm-kein-chat-ausgewaehlt.png) · Bildschirm 3 · Startbildschirm (kein Chat ausgewählt) (2056x2365)
- [05-bildschirme/bildschirm-4-chat-mit-eingeklappter-seitenleiste.png](design/05-bildschirme/bildschirm-4-chat-mit-eingeklappter-seitenleiste.png) · Bildschirm 4 · Chat mit eingeklappter Seitenleiste (2056x2365)
- [05-bildschirme/bildschirm-5-erststart-noch-kein-orbi.png](design/05-bildschirme/bildschirm-5-erststart-noch-kein-orbi.png) · Bildschirm 5 · Erststart (noch kein Orbi) (2056x2349)

### Schritt 5: Onboarding

- [06-onboarding/onboarding-1-willkommen-hell.png](design/06-onboarding/onboarding-1-willkommen-hell.png) · Onboarding 1 · Willkommen · Hell (1281x1011)
- [06-onboarding/onboarding-2a-orbi-gestalten-form-farbe-hell.png](design/06-onboarding/onboarding-2a-orbi-gestalten-form-farbe-hell.png) · Onboarding 2a · Orbi gestalten · Form & Farbe · Hell (1281x1011)
- [06-onboarding/onboarding-1-willkommen-dunkel.png](design/06-onboarding/onboarding-1-willkommen-dunkel.png) · Onboarding 1 · Willkommen · Dunkel (1281x1011)
- [06-onboarding/onboarding-2a-orbi-gestalten-form-farbe-dunkel.png](design/06-onboarding/onboarding-2a-orbi-gestalten-form-farbe-dunkel.png) · Onboarding 2a · Orbi gestalten · Form & Farbe · Dunkel (1281x1011)
- [06-onboarding/kopf-schritt-5-onboarding.png](design/06-onboarding/kopf-schritt-5-onboarding.png) · Kopf · Schritt 5 – Onboarding (1709x47)
- [06-onboarding/feedback-onboarding-1-willkommen.png](design/06-onboarding/feedback-onboarding-1-willkommen.png) · Feedback · Onboarding 1 Willkommen (1281x118)
- [06-onboarding/orbi-folgt-der-maus-onboarding-1-hell.png](design/06-onboarding/orbi-folgt-der-maus-onboarding-1-hell.png) · Orbi folgt der Maus · Onboarding 1 · Hell (2640x1080)
- [06-onboarding/orbi-folgt-der-maus-onboarding-2a-hell.png](design/06-onboarding/orbi-folgt-der-maus-onboarding-2a-hell.png) · Orbi folgt der Maus · Onboarding 2a · Hell (1640x1168)
- [06-onboarding/orbi-folgt-der-maus-onboarding-1-dunkel.png](design/06-onboarding/orbi-folgt-der-maus-onboarding-1-dunkel.png) · Orbi folgt der Maus · Onboarding 1 · Dunkel (2640x1080)
- [06-onboarding/orbi-folgt-der-maus-onboarding-2a-dunkel.png](design/06-onboarding/orbi-folgt-der-maus-onboarding-2a-dunkel.png) · Orbi folgt der Maus · Onboarding 2a · Dunkel (1640x1168)
- [06-onboarding/orbi-klein-onboarding-3-4-hell.png](design/06-onboarding/orbi-klein-onboarding-3-4-hell.png) · Orbi klein · Onboarding 3/4 · Hell (211x250)
- [06-onboarding/orbi-klein-onboarding-3-4-dunkel.png](design/06-onboarding/orbi-klein-onboarding-3-4-dunkel.png) · Orbi klein · Onboarding 3/4 · Dunkel (211x250)
- [06-onboarding/zugriff-zeile-onboarding-hell.png](design/06-onboarding/zugriff-zeile-onboarding-hell.png) · Zugriff-Zeile · Onboarding · Hell (1080x236)
- [06-onboarding/konto-zeile-onboarding-hell.png](design/06-onboarding/konto-zeile-onboarding-hell.png) · Konto-Zeile · Onboarding · Hell (1080x334)
- [06-onboarding/onboarding-3-mac-zugriffe-hell.png](design/06-onboarding/onboarding-3-mac-zugriffe-hell.png) · Onboarding 3 · Mac-Zugriffe · Hell (1281x1011)
- [06-onboarding/onboarding-4-dienste-verbinden-hell.png](design/06-onboarding/onboarding-4-dienste-verbinden-hell.png) · Onboarding 4 · Dienste verbinden · Hell (1281x1011)
- [06-onboarding/zugriff-zeile-onboarding-dunkel.png](design/06-onboarding/zugriff-zeile-onboarding-dunkel.png) · Zugriff-Zeile · Onboarding · Dunkel (1080x236)
- [06-onboarding/konto-zeile-onboarding-dunkel.png](design/06-onboarding/konto-zeile-onboarding-dunkel.png) · Konto-Zeile · Onboarding · Dunkel (1080x334)
- [06-onboarding/onboarding-3-mac-zugriffe-dunkel.png](design/06-onboarding/onboarding-3-mac-zugriffe-dunkel.png) · Onboarding 3 · Mac-Zugriffe · Dunkel (1281x1011)
- [06-onboarding/onboarding-4-dienste-verbinden-dunkel.png](design/06-onboarding/onboarding-4-dienste-verbinden-dunkel.png) · Onboarding 4 · Dienste verbinden · Dunkel (1281x1011)
- [06-onboarding/feedback-onboarding-3-zugriffe-hell.png](design/06-onboarding/feedback-onboarding-3-zugriffe-hell.png) · Feedback · Onboarding 3 Zugriffe · Hell (1281x118)
- [06-onboarding/feedback-onboarding-4-dienste-hell.png](design/06-onboarding/feedback-onboarding-4-dienste-hell.png) · Feedback · Onboarding 4 Dienste · Hell (1281x118)
- [06-onboarding/feedback-onboarding-3-zugriffe-dunkel.png](design/06-onboarding/feedback-onboarding-3-zugriffe-dunkel.png) · Feedback · Onboarding 3 Zugriffe · Dunkel (1281x118)
- [06-onboarding/feedback-onboarding-4-dienste-dunkel.png](design/06-onboarding/feedback-onboarding-4-dienste-dunkel.png) · Feedback · Onboarding 4 Dienste · Dunkel (1281x118)
- [06-onboarding/orbi-freut-sich-onboarding-5-hell.png](design/06-onboarding/orbi-freut-sich-onboarding-5-hell.png) · Orbi freut sich · Onboarding 5 · Hell (560x400)
- [06-onboarding/orbi-freut-sich-onboarding-5-dunkel.png](design/06-onboarding/orbi-freut-sich-onboarding-5-dunkel.png) · Orbi freut sich · Onboarding 5 · Dunkel (560x400)
- [06-onboarding/orbi-ausgewaehlt-onboarding-6-hell.png](design/06-onboarding/orbi-ausgewaehlt-onboarding-6-hell.png) · Orbi ausgewählt · Onboarding 6 · Hell (136x184)
- [06-onboarding/orbi-ausgewaehlt-onboarding-6-dunkel.png](design/06-onboarding/orbi-ausgewaehlt-onboarding-6-dunkel.png) · Orbi ausgewählt · Onboarding 6 · Dunkel (136x184)
- [06-onboarding/onboarding-6-ziel-nach-dem-flug-hell.png](design/06-onboarding/onboarding-6-ziel-nach-dem-flug-hell.png) · Onboarding 6 · Ziel nach dem Flug · Hell (1281x1011)
- [06-onboarding/onboarding-5-abschluss-hell.png](design/06-onboarding/onboarding-5-abschluss-hell.png) · Onboarding 5 · Abschluss · Hell (1281x1011)
