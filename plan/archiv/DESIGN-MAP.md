---
tags: [orbit, mac, design]
status: überholt (01.11.2026), maßgeblich ist plan/DESIGN-SYSTEM.md
date: 2026-10-24
herkunft: Messung der Web-UI (localhost:3000, Datenbankkopie) per DOM am 24.10.2026, `plan/tools/measure-web.mjs`; Abgleich mit `mac/Orbit/Theme/Theme.swift`
---

# DESIGN-MAP: Web-UI ↔ native App

> **Überholt (01.11.2026):** Für alles Visuelle gilt `plan/DESIGN-SYSTEM.md` (Werte aus Figma). Diese Datei beschreibt nur noch die alte Web-Referenz.

Die Web-UI ist die Referenz. Alle Werte sind gemessen (`getComputedStyle`, `getBoundingClientRect`), Fenster 1280 × 3200, Chat „Karti“. Maße in pt = CSS-px. Farben als sRGB (Dunkel / Hell). Theme.swift ist die einzige Quelle im Code, im View-Code stehen keine Hex-Werte. `--selftest-layout` prüft die Rahmen (Toleranz 2 pt) in Dunkel und Hell bei 1280, 900 und 1800 Breite.

## Schrift

| Element | Web | Nativ |
|---|---|---|
| Familie | Geist (Google Fonts, Variable, app/layout.tsx), Mono: Geist Mono | Geist-Variable.ttf und GeistMono-Variable.ttf im Bundle (SIL OFL, `Orbit/Fonts/OFL.txt`), per `CTFontManager` beim Start registriert (`Theme.registerFonts`) |
| Gewicht | wght 400 / 500 / 600 | `Theme.Fonts.geist(size, weight)` setzt die wght-Achse direkt (400/500/600) |
| text-xs | 12 / 16 | `Fonts.small` 12, `lineHeight(.exact(16))` |
| text-sm | 14 / 20 | `Fonts.body` 14, `lineHeight(.exact(20))` |
| text-base | 16 / 24 (Titel 16/16 im Dialog) | `Fonts.title` 16 semibold; Dialog `geist(16, .medium)` |
| Marke „Orbit“ | 18 / 28, 600 | `Fonts.brand` |
| Chat-Name | 24→16 / 36→24, 600 | `ChatHeaderView` (`geist(24 − 8p, .semibold)`) |

Plattformgrenze: Core Text zeichnet helle Schrift auf dunklem Grund etwas kräftiger als Chrome; die Textbreiten sind gleich (117,2 pt für „Befehl: echo hallo“ bei 14/500), nur das Erscheinungsbild wirkt fetter.

## Farben (Tokens aus app/globals.css; Assets in `Assets.xcassets/Colors`, Zugriff `Theme.Palette`)

| Token | Dunkel | Hell | Gemessen an |
|---|---|---|---|
| background | #0a0a0a | #ffffff | Hauptfläche |
| sidebar | #171717 | #fafafa | Seitenleiste |
| card / popover | #171717 | #ffffff | Karten, Dialog |
| secondary / muted / accent | #262626 | #f5f5f5 | Assistenten-Blase, Badge, aktive Zeile |
| foreground | #fafafa | #0a0a0a | Text |
| muted-foreground | #a1a1a1 | #737373 | Zweittext |
| border | #fff 10 % | #e5e5e5 | Ränder |
| input | #fff 15 % | #e5e5e5 | Feldrand |
| destructive | #ff6467 | #e7000b | Fehlerkarte (Fläche 5 %, Rand 30 %) |
| primary / ring | Farbe des Orbis (z. B. #e8590c) | gleich | Sendeknopf, „Einmal erlauben“, Quellen-Link (`AccentStore`, wie `applyAccent`) |
| Feldfläche (`dark:bg-input/30`) | #fff 4,5 % | keine | `Palette.field` |
| Glas (`bg-foreground/[0.06]`) | #fff 6 % | #111 6 % | `Palette.glass`, Ring `glassRing` 10 % |
| Hauptorbi-Karte | sidebar-accent 40 % (aktiv 100 %) | gleich | `sidebarAccent.opacity` |

Text auf der Orbi-Farbe: `onColor` (WCAG-Helligkeit > 0,4 → #1a1a1a, sonst weiß) für Knöpfe, `bubbleStyle` (einfache Helligkeit > 0,6 → #111, sonst weiß) für die eigene Blase (`AccentStore.make`).

## Radien

`--radius` 10 pt: sm 6, md 8, lg 10, xl 14, 2xl 18, 3xl 22 = `Theme.Radius`.

## Fenster und Seitenleiste

| Element | Web (x, y, B × H) und Stil | Nativ |
|---|---|---|
| Fenster | Seitenleiste 304 (303 + 1 Linie), Hauptfläche rest, keine Titelleiste | `.windowStyle(.hiddenTitleBar)`, `titleBarInset` 28 oben in der Seitenleiste (Ampelknöpfe), Standardgröße 1180 × 780 |
| Seitenleiste | 0,0, 303 × H, #171717 / #fafafa | `SidebarView` 303 + 1 pt Linie `sidebarBorder` |
| Marke | 12,12, 43,6 × 28 | `Fonts.brand`, Höhe 28, „+“-Menü rechts (28 × 28, Kreis) |
| Suche, „Geplant“, Einstellungen, Einklappen | Kopf: Marke + Einklappen, darunter Suche (Pille 36) + Plus; „Geplant“ 56 hoch vor der Hauptkarte | `SidebarSearchField`, `plannedRow` (4e) |
| Hauptorbi-Karte | 12,168, 279 × 146, r 18, Figur 64 mit Stern-Zeichen (20, schwarz), Name 16/20 600, Zeit 12/16 muted, Innenabstand 16 | `mainCard` |
| Gruppenbeschriftung „Chats“ | Höhe 32, 12/16 500, 70 % Vordergrund, Einzug 8 | `group(title:)` |
| Chat-Zeile | 8,354, 287 × 56, r 14, Innenabstand 8, Abstand 12, Figur 28, Name 14/17,5 500, Zeile 2 12/16 muted, Zeit rechts 12/16 muted; Hover sidebar-accent 60 %, aktiv 100 % (Hover 70 %) | `Row` |
| Zeit | „gerade eben“ < 60 s, sonst `formatDistanceToNowStrict` (de) | `AgoText` (15-s-Takt) |
| Gruppen-Zeile | wie Chat-Zeile, Figurenstapel 28, „N Orbis“ | `Row` mit `AvatarStack` |

## Chat

| Element | Web | Nativ |
|---|---|---|
| Kopf | groß: Figur 50 über Pille 44 (Abstand 22), klein: Figur 36 neben Pille 36; Fortschritt p = Scroll/96, Höhe 183 → 88; Hintergrund 159 voll + 48 Verlauf | `ChatHeaderView` mit denselben Formeln (`ChatHeaderMetrics`), p aus `onScrollGeometryChange`; „Bewegung reduzieren“ = fest klein |
| Namens-Pille | 101,8 × 44 (groß), r 22, Innenabstand 14, Abstand 7, Chevron 12, Glas blur 24 + 6 % + Ring 10 %, Schatten sm | `Material.ultraThin` + `Palette.glass` + `glassRing`; Klick öffnet ein Popover mit Bearbeiten / Anpassen / Löschen |
| Verlauf | Rand 12, Abstand zwischen Nachrichten 32, oben 170 Freifläche, unten 16 | `VStack(spacing: 32)`, `ChatHeaderMetrics.spacer` |
| Nachricht | höchstens 80 % der Spalte, Aktionszeile 24 (nur beim Überfahren sichtbar, Platz bleibt), Abstand 8 | `MessageWidth`-Layout, `actions` (Kopieren) |
| Eigene Blase | Farbe des Orbis, r 10, Innenabstand 12/16, 14/20 | `MessageRow.userBubble` |
| Antwort-Blase | secondary, r 18 (oben links 8), Innenabstand 10/16, 14/20; Figur 24, 2 über der Unterkante, Abstand 8 | `AssistantBubbleShape`, `OrbiAvatar(size: 24)` |
| Antwort-Spalte | so breit wie das breiteste Kind, Karten `w-full max-w-md` (448) | `WebColumn` + `webCardWidth` |
| Figurengröße | SVG füllt 86 % des Felds | native Zeichnung füllt 72 %: `scaleEffect(1,2)` in `OrbiAvatar` (Zeilenfigur 24 × 24 pt sichtbar wie im Web) |
| Schreibblase | drei Punkte | Orb mit Text „arbeitet …“ in grauer Blase (Zustand als Text, 4a-Regel) |

## Composer

| Element | Web | Nativ |
|---|---|---|
| Rahmen | 316,3100, 951 × 88, r 10, Rand input, Fläche field; außen 12 / 8 / 12 | `ComposerView` |
| Eingabezeile | 40, Text 14/20, Innenabstand 8/10 | `TextEditor` + Platzhalter „Was möchtest du wissen?“ |
| Werkzeugzeile | 46, Innenabstand 6/10/8/10, Knöpfe 32 | Zeile 46 mit Antwortenden-Menü (Gruppe) und Sendeknopf; Anhang, Freigabemodus, Kontext, Modell: 4c |
| Sendeknopf | 32 × 32, r 10, Farbe des Orbis, Symbol „↵“ | `ComposerSendStyle` (`return`, beim Lauf `stop.fill`) |
| Fokus | Ring ring/50 % | Rand `Palette.ring` 50 % |

## Karten (alle in `Views/Cards`)

| Karte | Web | Nativ |
|---|---|---|
| Freigabe | 377,3 × 146 (Inhalt), Rand 1 + Innenabstand 12, r 10, Abstand 12; Titel 16/24 500, „Eingaben“ 12/16, Link 14/20 unterstrichen (Zeile 24), Knöpfe 32 r 10 (Einmal = Orbi-Farbe, Immer = secondary, Ablehnen = Umriss) | `ApprovalCardView`; zusätzlich Verfall-Zeile (4b, im Web nicht vorhanden) + 28 pt Höhe |
| Werkzeugzeile | 268 × 38, r 8, Innenabstand 8, Symbol 16, Abstände 8 / 16, Badge 20 hoch r voll, Chevron 16 (zu: rechts) | `ToolRowView` |
| Rückfrage beantwortet | 260 × 114, r 18, Innenabstand 12/16, Frage 14/20 muted, Antwort 14/20 500 | `AskSummaryView` |
| Übergabe | 247,3 × 54, r 10, Figur 20, Titel 14/20, Zeile 2 12/16, Chevron unten 16 | `HandoffCardView` |
| Websuche | 448 × 155, Kopf 44, Linie, Antwort 14/20, Quellen-Link 12/16 (+16 unten) | `WebSearchCardView` |
| Bild | 512 × 512, r 10 | `ImageCardView` |
| Fehler (Bild) | 448 × 66, r 8, Rand destructive 30 %, Fläche 5 %, Innenabstand 12 | `ImageCardView.errorBox` |
| Jev-Block | 258,8 × 34, r 10, Fläche muted 40 %, Kopf 32, Text 12/16, Symbol 16, Chevron 12 | `JevBlockView` |
| Fehlerkarte (Antwort fehlgeschlagen) | `components/chat/error-card.tsx` | `ErrorCard` (4b) |

## Dialoge

Gemessen am Dialog „Neuer Orbi“ (448 × 697). Der Anpassungsmenü-Reiter („Aussehen“) hat im Web kein Gegenstück; er folgt demselben Rahmen.

| Element | Web | Nativ |
|---|---|---|
| Dialog | 448 breit, popover-Fläche, r 14, Ring 10 %, Innenabstand 16, Abstand 16 | `DialogShell` |
| Kopf | Titel 16/16 500, Beschreibung 14/20 muted, Abstand 8, Schließen-X 28 oben rechts | `DialogShell` |
| Feld | Beschriftung 14/19,25 500, Abstand 8; Felder 20 auseinander | `DialogField`, `VStack(spacing: 20)` |
| Eingabefeld | 32 hoch, r 10, Innenabstand 4/10, Fläche field, Rand input | `webInput()` |
| Textfeld „Verhalten“ | 78 hoch (4 Zeilen), Innenabstand 8/10 | `TextEditor` im gleichen Rahmen |
| Planeten-Raster | 5 Spalten, Zelle 76,8 quadratisch, Abstand 8, r 10, Fläche secondary 50 %, gewählt Orbi-Farbe 20 % + Rand | `ProfileTab` |
| Farbpunkte | 12 Spalten à 27,3, Abstand 8, gewählt Ring | `swatch` (11 Punkte: „Eigene Farbe“ des Browsers entfällt, Feinwahl im Reiter Aussehen) |
| Schalter | 32 × 18,4 | `Toggle(.switch)` klein (macOS-Schalter) |
| Aufgaben-Chips | 28 hoch, 12,8 / 500, Innenabstand 10, rund, Rand input; gewählt weiß mit schwarzer Schrift | `chip` |
| Fuß | volle Breite, Fläche muted 50 %, Linie oben, Innenabstand 16, Knöpfe 32 r 10 rechts, „Löschen“ links | `DialogShell`-Fuß |
| Reiter | Pille 32, Fläche 6 %, aktiv 15 % | `WebTabs` |
| Gruppen-Dialog | Name, Liste (Kästchen, Figur 28, Name, Zeile r 10 Innenabstand 6, Hover muted), „Höchstens 6 Orbis je Gruppe“ 12/16 | `GroupEditorView` |

## Zustände

Leer, lädt, Fehler, offline: `StatusMessage` (Titel 14 medium, Text 12/16 muted, Knopf `card(.outline)`), „Noch keine Nachrichten“ 14 medium + 14 muted im Chat, „Keine Orbis gefunden.“ 12 muted in der Seitenleiste.

## Einstellungen (4d)

Gemessen an `components/settings/*` (Dialog 768 × 576 in Chrome, DOM-Rahmen per `plan/tools/shots-settings-web.mjs`); nativ in `Views/Settings/*`, Bausteine `SettingsKit.swift`.

| Element | Web-Wert | Nativer Wert |
|---|---|---|
| Fenster | 768 × 576, Kopfzeile 45 + Linie | Inhalt 768 × 531 (Titelzeile vom System) |
| Reiterleiste | 192 breit, Innenabstand 12, Zeile 32, Abstand 4, Symbol 16, aktiv `secondary`, Hover Ghost | gleich |
| Inhalt | Innenabstand 24 | 24 |
| Titel (`h2`) | 16/24 medium (Freigaben: 18/28 semibold) | `SettingsTitle` |
| Karte (Nutzung) | `rounded-xl` Ring 10 %, Innenabstand 12, Abstand 12, Kopfzeile 24 | `SettingsCard` |
| Balken | Spur 4 `muted`, Füllung `primary`, ab 80 % `destructive`, Beschriftung 14 medium, Wert 14 muted, Abstand 8 | `SettingsProgress` |
| Rand-Zeile (`rounded-lg border p-3`) | Rand 1 zählt zur Größe (border-box) | `SettingsBox`: Innenabstand 12 + 1 |
| Schalterzeile (Jev) | Titel 14/20 medium, Beschreibung 12/16 muted, Abstand 4 | `SettingsSwitchRow` |
| Protokollzeile | Innenabstand 12, Text 14/20, Trennlinie 1 | gleich |
| Alert (destruktiv) | `rounded-lg border px-2.5 py-2`, Symbol 16, Text 14/20 | `SettingsAlert` |
| Badge | Höhe 20, `px-2`, 12 medium, Kapsel | `SettingsBadge` |
| Skeleton | `bg-muted`, Pulsieren | `SettingsSkeleton` |
| Modellwahl (4d-Nachträge) | Gold `#b08d4a … #fff4d6 … #b08d4a` 110°, 250 %, 3,2 s; Griff `#e8c77a`; Jev-Puls 2,4 s (1 ↔ 0,65, 1 ↔ 0,88); Lichtlauf 5 s; Zeile Freigabe-Modus 40 | `Theme.Gold`, `Effects.swift`; Zeile 40 |
