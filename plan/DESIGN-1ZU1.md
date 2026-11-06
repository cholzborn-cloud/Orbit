# Design 1:1 nach Figma (05.11.2026)

Auftrag (Consti, 05.11.2026): Das Design der Orbit-App 1:1 wie in Figma bauen (Farben, Schriften, Abstände, Radien, Menüs, Hover, Zustände, Varianten). Brain-Entscheidungen gelten, nichts erfinden. Alles 100 % Eindeutige einbauen, alles auch nur minimal Unklare als **Frage** eintragen. Am Ende Fragen gebündelt an Consti, Antworten einbauen.

Rangfolge: Brain-Entscheidungen (`Orbit Entscheidungen.md`) → Figma → `plan/FIGMA-ABGLEICH.md` → `plan/DESIGN-SYSTEM.md`.

Figma: Die offene Datei heißt „Ohne Namen“ (die Orbit-Design-Datei; Zuordnung über die Frame-IDs aus FIGMA-ABGLEICH). Live per figma-cli gelesen, nichts in Figma geändert. Schrift „Inter“ in Figma ist ausdrücklich SF-Pro-Ersatz, daher kein Unterschied.

Backup: `~/Projekte-Coding/Backups/Orbit/2026-11-05_13-00/`

Status: **offen** (noch nicht gebaut) · **erledigt** (gebaut, Commit) · **Frage** (an Consti) · **blockiert** (fremde, nicht committete Änderung an der Datei) · **passt** (kein Unterschied, nur zur Vollständigkeit).

## Antworten von Consti (05.11.2026, AskUserQuestion)

1. Bewusste Abweichungen (Spalte 1040, Blasen 60 %, keine Zeitstempel, Hover neben der Blase, Einstellungen 1120 × 760): **behalten**; Hover-Abstand auf Figma 6.
2. Knöpfe: **überall Figma-Pille 24** (Regular 12, innen 12; Abbrechen = Zweit-Knopf grau, Löschen = roter Umriss rechts; Icon-Knöpfe 24 r6).
3. Figma-Widersprüche: **„so, dass es einheitlich und premium wirkt“** → jeweils die neuere Komponente/Bildschirm: Blasen 21/5 mit Folge-Ecken, Zeilenhöhe 22, Live-Zeile 8, Startbild-Orbi 80, Neu-/Status-Punkt 8 ohne Ring mittig rechts, Farbring 100 %, Seitenleiste 240, Menü-Rahmen überall gleich (r14, Rand 0,5, kein Schatten).
4. Brain gegen Figma: **Brain gilt** (E51 orange, E62 Erststart mittig, D17 ohne „Weiter“, Figuren neben Nachrichten gerade).
5. Fehlende Zustände: **alle nach Figma bauen** (Daten-Zustände wie Offline-Warteschlange später).
6. Nur im Code: **auf Figma kürzen**, vor allem „Orbi bearbeiten“ nur wie in Figma (Form, Farbe, Name, Aufgabe, Hauptorbi; keine Regler).
7. Neue Funktionen: **im Brain als fehlend notieren, keinen Plan machen.**
8. Texte: **Figma-Texte übernehmen** (Dienst-Fehlertexte bleiben).
9. Animationen: **Figma, sauber mit 60 fps.**
10. Schiene: **„+“ behalten, so breit, dass die drei Ampel-Punkte oben zentriert wirken** (80); sonst Figma (keine Linie, kein Stern, Seitenleiste eckig mit Linie 0,5, Pille ohne Schatten).
11. Marktplatz: **alles wie Figma 192.**
12. Kleinkram: **alles wie Figma** (ungenutzte Farb-Sets in den Papierkorb, Gruppe Name + Avatar unten, Reaktion eigene Blase rechts, Live-Zeile fest über der Eingabe).
13. Zwischendurch (Consti): **rechts nur die drei Reiter aus Figma** (erledigt, P6); effizienter arbeiten.

## Bewusste Abweichungen (Consti nach dem Figma-Stand, nur als Frage behandeln)

| Stelle | Figma | Code | Beleg |
|---|---|---|---|
| Chat-Spalte | 640, Rand 40 | bis 1040, Rand 32 | STATUS 04.11. abends, cad1e8a5 |
| Blasenbreite | max. 468 (Text 440) | je 60 % der Spalte (624) | STATUS 04.11. 23:15, 927a218e |
| Hover-Aktionen | neben der Blase (Brain D21) | 04.11. unter der Blase, 05.11. 12:18 wieder neben der Blase | 927a218e, de9cbf92 |
| Zeitstempel-Zeile | 26:10969 vorhanden | entfernt | 4f4603e2 (05.11.) |
| Einstellungsfenster | 768 × 532 | 1120 × 760 | 172ff6b0, a394951e (05.11.) |
| Avatar/Name neben Antworten | Figma 151:93975 | zurückgenommen | 6b66e850 (04.11.) |
| Einstellungen-Navi | Figma-Reihenfolge | Allgemein, Nutzung, Darstellung, Orbis, Marktplatz | Brain D12 |

## Fremde offene Änderungen (nicht anfassen)

`mac/Orbit/Figures/FigureView.swift`, `mac/Orbit/Stores/SettingsStore.swift`, `mac/Orbit/App/SelfTestFigures.swift`, `mac/scripts/SettingsSceneProbe.swift` (Stand 05.11. 11:07, nicht von dieser Sitzung).

## Unterschiede

| # | Stelle (Figma) | Code-Stelle | Figma-Wert | Code-Wert | Status |
|---|---|---|---|---|---|
| T1 | Farb-Tokens Hell/Dunkel (80 Variablen, Color Light/Dark + Primitives) | `Assets.xcassets/Colors`, `Theme.Palette` | alle 80 Werte | identisch | passt |
| T2 | Radius-, Abstands-, Bewegungs-, Schrift-Tokens (Sammlung Tokens) | `Theme.Radius`, `Theme.Spacing`, `Theme.Motion`, `Theme.Fonts.Reference` | radius 6/8/10/14/18/22/18/999, space 4–32, motion 100–1200 ms, font 11–24 | identisch | passt |
| T3 | Token `layout/sidebar` 280, `layout/sidebar-min` 220 | `Theme.Layout.sidebar` 240, `sidebarMin` 240 | Tokens 280/220, aber Bildschirm 1 (148:90569) Seitenleiste 240 | 240/240 | erledigt (nach Antwort von Consti) |
| T4 | Token `layout/bubble-max` 560 | `Theme.Layout.messageShare` 0,6 | 560 (Bildschirme: 468) | 60 % der Spalte | beantwortet (Antwort 1: 60 % bleiben) |
| T5 | 5 Farb-Sets nur im Code: popover-foreground, sidebar-accent-foreground, sidebar-primary(-foreground), sidebar-ring | `Assets.xcassets/Colors` | nicht in Figma | nirgends benutzt (0 Treffer) | erledigt (in den Papierkorb, Consti 05.11.) |
| G1 | Zweit-Knopf gedrückt (6:13662) | CardKit.swift `WebButtonBody.background` | Fläche input | nur 1 pt Versatz | erledigt |
| G2 | Knopf deaktiviert (6:13659/6:13663) | CardKit.swift | 40 % | 50 % | erledigt (`Theme.Opacity.disabled`) |
| G3 | Icon-Knopf 24 (6:13993): Radius, Hover, gedrückt, deaktiviert | CardKit.swift `.iconXS`, ghost quadratisch | r6, Hover secondaryHover, gedrückt input, 35 % | r8, Hover muted, nur Versatz, 50 % | erledigt |
| G4 | Knopfgröße/Schrift (6:13664) | CardKit.swift `CardButtonStyle.Size` (5 Größen) | 24 hoch, innen 12, Regular 12 (in Bildschirmen auch 28 und 34 hoch) | 32/28/24/36, innen 10, Medium 14/12,8/12 | erledigt (nach Antwort von Consti) |
| G5 | Haupt-Knopf hover/gedrückt (6:13657/58) | CardKit.swift | keine sichtbare Änderung, „ohne Durchsichtigkeit“ | foreground 80 %; Pille 85 % | erledigt (nach Antwort von Consti) |
| G6 | „Abbrechen“ als Umriss-Knopf; Varianten outline/ghost/destructive | CardKit.swift, DialogKit, SettingsKit | nur Haupt und Zweit | outline, ghost, destructive zusätzlich | erledigt (nach Antwort von Consti) |
| G7 | Ausklappfeld (6:13685): Innenabstand, Radius, Schrift, Fläche, Zustände, Pfeil | WebControls.swift `SelectTriggerLabel` | innen 12, r12, Regular 12, secondary / Hover+offen secondaryHover, kein Rand, Pfeil 13, offen nach oben | innen 10/8, r10/8, 14, Rand input, Hover nur dunkel | erledigt |
| G8 | Ausklappfeld Höhe | WebControls.swift `SelectTriggerLabel` | eine Größe 24 | small 28 / regular 32 | erledigt (nach Antwort von Consti) |
| G9 | Ausklappfeld deaktiviert | WebControls.swift | 40 % | Zustand fehlt | erledigt (nach Antwort von Consti) |
| G10 | Ausklappliste/Kontextmenü (6:13723/6:14015): Radius, Rand, Schatten, Zeilenabstand | WebControls.swift `MenuPanel.list` | r14, Rand border 0,5, kein Schatten, Abstand 1 | r10, Rand glassRing 1, 2 Schatten, 0 | erledigt |
| G11 | Menüeintrag (6:13710): Höhe, Innenabstand, Radius, Schrift, Hover, Haken links | WebControls.swift `MenuPanel.row` | 24, innen 8, r10, Regular 12 / gewählt Medium 12, Hover secondaryHover, Haken-Feld 14 links, Abstand 6 | 28, innen 6, r8, 14, Hover accent, Haken rechts | erledigt |
| G12 | Kontexteintrag mit Symbol (6:13941) | WebControls.swift `MenuPanel.row` | Symbol 13 mutedForeground, Abstand 8 | Symbol 16 foreground, Abstand 6 | erledigt |
| G13 | Menüeintrag mit Symbol und Haken zugleich | WebControls.swift | nicht in Figma | Haken rechts | erledigt (nach Antwort von Consti) |
| G14 | Modellwahl-Panel, Hover-Karte, Tooltip (Popover-Familie) | WebControls.swift `custom`, HoverCard, TooltipBubble | nicht in Figma | Rand glassRing 1, Schatten | erledigt (nach Antwort von Consti) |
| G15 | Menüeintrag deaktiviert | WebControls.swift `WebMenuItem` | 40 % | Zustand fehlt | erledigt (nach Antwort von Consti) |
| G16 | Zweizeiliger Menüeintrag (Freigabe-Modus) | WebControls.swift `tallRow` | nicht in Figma | 40 hoch, gewählt muted | erledigt (nach Antwort von Consti) |
| G17 | Trennlinie vor „Löschen“ und „Löschen“ im Kontextmenü | WebControls.swift, SidebarView.swift | „Ohne Kürzel, ohne Löschen“, keine Trennlinie | Löschen rot mit Linie 1 pt | erledigt (nach Antwort von Consti) |
| G18 | Eingabefeld (6:13745): Höhe, Innenabstand, Radius, Schrift, Fläche, Rand | DialogKit.swift `WebInput` | 24, innen 12, r12, Regular 12, secondary, kein Rand | 32, innen 10, r10, 14, field + Rand input | erledigt |
| G19 | Eingabefeld Hover/Fokus | DialogKit.swift | Hover und Fokus secondaryHover | Zustand fehlt | erledigt (nach Antwort von Consti) |
| G20 | Eingabefeld Fehler (Rand destructive 1 + Text 10) | DialogKit.swift | vorhanden | Zustand fehlt (InlineAlert 14) | erledigt (nach Antwort von Consti) |
| G21 | Eingabefeld deaktiviert | DialogKit.swift | 40 % | Fläche dimmt nicht | erledigt (nach Antwort von Consti) |
| G22 | Platzhalterfarbe | ~25 Aufrufstellen | mutedForeground | Systemgrau | erledigt (Platzhalter mutedForeground an 14 Feldern) |
| G23 | Mehrzeiliges Feld | DialogKit.swift `multiline` | nicht in Figma | wie Einzeiler (jetzt secondary, r12, 12) | erledigt (nach Antwort von Consti) |
| G24 | Schalter (6:13764): Maße, Farben, Knopf, deaktiviert | WebControls.swift `WebSwitch` | 30 × 18, innen 2, Knopf 14; aus track, an foreground; Knopf thumb (dunkel an: background); 40 % | 32 × 18,4, Knopf 16; aus input, an primary; 50 % | erledigt |
| G25 | Schalter Hover | WebControls.swift | an: thumb 15 % (dunkel background 12 %); aus: unverändert, Untertitel sagt „hover auch bei aus“ | kein Hover | erledigt (nach Antwort von Consti) |
| G26 | Schalter-Größe „small“ und Fokusring | WebControls.swift | nicht in Figma | vorhanden | erledigt (nach Antwort von Consti) |
| G27 | Reiter WebTabs (6:13873): Maße, Fläche, Rand, Schrift, Auswahl | DialogKit.swift `WebTabs` | 26 (innen 2, Reiter 22), secondary, Rand border 0,5; aktiv segmentThumb Medium 12, inaktiv Regular 12 muted | 32, glass, kein Rand, 14 Medium, aktiv foreground 15 % | erledigt |
| G28 | Drei verschiedene Reiter-Bausteine (WebTabs, WebSegment, Panel-Navigation) | DialogKit, WebControls, SidePanel | eine Komponente | drei | erledigt (Optik einheitlich; WebSegment bleibt als Baustein) |
| G29 | Reiter Hover und Gleiten | DialogKit.swift | Hover-Varianten, „gleitet beim Klick“ | fehlt in WebTabs | erledigt (nach Antwort von Consti) |
| G30 | Checkbox (6:13922): Maße, Radius, Rand, Flächen, Haken, deaktiviert | WebControls.swift `WebCheckbox`, SidePanel, GroupEditorView | 14, r5, kein Rand; aus secondaryHover, an foreground, Haken 10 background; 40 % | 16, r4, Rand input; aus klar, an primary; 50 % | erledigt |
| G31 | Checkbox Hover, Zustand „gemischt“, Beschriftung 12/Abstand 6 | WebControls.swift, GroupEditorView | vorhanden | fehlt / 14, Abstand 8 | erledigt (nach Antwort von Consti) |
| G32 | Tag-Baustein (6:13962) | SettingsKit.swift `SettingsBadge` | Pille 20, innen 8, gap 5, Punkt 6, Regular 11, secondary; Arten Neutral/Akzent/Fertig/Wartet/Fehler | kein Punkt, Medium 12, gap 4, eigene Töne | erledigt (SettingsBadge = Figma-Tag) |
| G33 | Icon-Knopf Symbolfarbe Ruhe/aktiv | CardKit.swift | Ruhe mutedForeground, aktiv/Hover foreground | immer foreground | erledigt (nach Antwort von Consti) |
| G34 | Icon-Knöpfe 28/32 (Schließen in Dialog/Panel) | CardKit, DialogKit, SidePanel | nur 24, Symbol 14 | 28/32 | erledigt (nach Antwort von Consti) |
| G35 | Seitenleisten-Icon-Knöpfe als Kreis | SidebarView.swift | 24 × 24 r6 | Kreis 32/40, Hover sidebarAccent | erledigt (nach Antwort von Consti) |
| C1 | Blasen-Ecken eigene/Antwort (26:10430, 26:10477) | MessageRow.swift `userBubble`, `AssistantBubbleShape` | Komponenten 21 mit Ecke 5 (eigene unten rechts, Antwort unten links); Token `radius/bubble` 18 (ungenutzt) | eigene 18 rundum; Antwort oben links 8, sonst 18 | erledigt (nach Antwort von Consti) |
| C2 | Blasen-Zeilenhöhe (26:10384, 26:10449) | MessageRow.swift, MarkdownText.swift | Komponenten 14/22; alter Kopftext „14/20“ | 14/20 | erledigt (nach Antwort von Consti) |
| C3 | Folge-Ecken bei aufeinanderfolgenden Blasen (118:21521 ff.) | MessageRow.swift | innen kleine Ecken 5 | keine Gruppierung | erledigt (nach Antwort von Consti) |
| C4 | Eigene Blase „nicht gesendet“ (26:10438) | MessageRow.swift / ChatView ErrorCard | rotes „!“ 18 links der Blase, Klick = nochmal | Fehlerzeile unter dem Verlauf | beantwortet (Antwort 7: fehlende Funktion, im Brain notiert) |
| C5 | Skill-Chip in eigener Blase (26:10418) | MessageRow.swift | in der Blase, 20 hoch, glass-active, sparkles 11, 11 Medium weiß | über der Blase, muted, 12 Regular | erledigt (nach Antwort von Consti) |
| C6 | Link-Karte in eigener Blase (139:34251) | MessageRow.swift | Karte mit Symbol, weiß | Link als Text | beantwortet (Antwort 7: fehlende Funktion, im Brain notiert) |
| C7 | Zwischennachricht (say) Innenabstand | MessageRow.swift `SayBubble` | 10/14 | 10/16 | erledigt |
| C8 | Antwort: Abstand zwischen Blöcken (26:10482) | MarkdownText.swift | 6 | 12 | erledigt |
| C9 | Code-Block (26:10461) | MarkdownText.swift | glass, Rand border 0,5, r8, innen 10, Code 12/18 | muted, kein Rand, innen 12, 13 | erledigt (Schriftfamilie Mono bleibt; Figma zeigt Inter = SF-Ersatz) |
| C10 | Code-Block Kopfzeile mit Sprache und Kopieren (28:14342) | MarkdownText.swift | Kopf 26, Sprache 11 Medium, Kopieren beim Überfahren | fehlt | beantwortet (Antwort 7: fehlende Funktion, im Brain notiert) |
| C11 | Inline-Code als Pille (26:10457) | MarkdownText.swift | glass-hover, r5, innen 1/5, 12/18 | System-Standard | beantwortet (Antwort 7: fehlende Funktion, im Brain notiert) |
| C12 | Überschrift H3 / Aufzählung (26:10451) | MarkdownText.swift | H3 15 Semibold, Liste „•“ | Rohtext `###`/`-` | beantwortet (Antwort 7: fehlende Funktion, im Brain notiert) |
| C13 | „abgebrochen“ unter Antwort (26:10485) | MessageRow.swift | Lücke 4, bündig mit Blase | Lücke 8, immer 32 eingerückt | erledigt (Einzug nur in Gruppen neben Avatar) |
| C14 | Gruppe: Name über erster Blase, Avatar nur an letzter (26:10568) | MessageRow.swift | Name 11 Medium, Avatar nur letzte Blase | Avatar an jeder Blase, kein Name | erledigt (nach Antwort von Consti) |
| C15 | „Gelöschter Orbi“-Name (26:10492) | MessageRow.swift | 11 Medium | 11 Regular | erledigt |
| C16 | Live-Zeile Abstand zur Blase | ChatView.swift | Teil 12: 8, Beispiel-Chat: 12 | 10 | erledigt (nach Antwort von Consti) |
| C17 | Live-Zeile Schimmer-Richtung | HandoffCard.swift `ShimmerText` | rechts nach links (Übergabe: links nach rechts) | beide links nach rechts | erledigt (nach Antwort von Consti) |
| C18 | Live-Zeile Fehlerzustand (26:10641) vs. Fehlerzeile 143:52194 | StepViews.swift, ChatView ErrorCard | „Abgebrochen – Verbindung verloren“ + „Nochmal“ bzw. „Antwort fehlgeschlagen.“ + „Erneut versuchen“ | getrennte Zeilen | erledigt (nach Antwort von Consti) |
| C19 | Nachrichten-Aktionen Knopf r6 / Hover secondaryHover (26:10742) | CardKit.swift `.iconXS` ghost | r6, secondaryHover | r8, muted | erledigt (über G3) |
| C20 | Kopieren-Symbol (CopyAction) | MessageRow.swift | 13 | 11 | erledigt |
| C21 | Abstand Blase ↔ Aktionsleiste | MessageRow.swift `gap` | 6 (auch Entwurf 265:30456) | 2 | erledigt (nach Antwort von Consti) |
| C22 | Reaktions-Pille (26:10971) | ReactionViews.swift | popover, Rand 0,5, kein Schatten, Zahl 11 Medium, Lücke 3 | background, Schatten, Zahl 12, Lücke 4 | erledigt |
| C23 | Reaktion über der Blase (26:11060) | MessageRow.swift | 14 Platz darüber | 15 | erledigt (Überlappung 8) |
| C24 | Reaktion bei eigener Blase: Seite | MessageRow.swift | nicht lesbar („wie iMessage über der oberen Ecke“) | oben links | erledigt (nach Antwort von Consti) |
| C25 | Reaktions-Menü (26:10976) | ReactionViews.swift `ReactionPeople` | Figur 20, Breite 170 | 16, 160 | erledigt |
| C26 | Reaktions-Menü Rahmen r14/Rand 0,5 | ReactionViews.swift | eigene Karte | System-Popover | erledigt (nach Antwort von Consti) |
| C27 | Reaktions-Menü Zeile „Du“ | ReactionViews.swift | Kreis 20 input mit Buchstabe | Personen-Symbol 16 | erledigt (nach Antwort von Consti) |
| C28 | @-Markierung Figur (26:10382) | MentionViews.swift | 14 | 16 | erledigt |
| C29 | @-Markierung gelöscht / „milchige Pille“ | MentionViews.swift | Platzhalterfigur; Teil 9 „ohne Pille“ vs. Teil 19 „milchige Pille“ | grau durchgestrichen | erledigt (nach Antwort von Consti) |
| C30 | @-Liste Rahmen (26:11208) | MentionViews.swift | r14, Rand 0,5, kein Schatten, Lücke 1 | r10, Rand 1, Schatten, 0 | erledigt |
| C31 | @-Zeile (26:11145) | MentionViews.swift `MentionMenuRow` | 24 hoch, innen 6, r10, Regular 12, gewählt secondaryHover | ~32, innen 8, r8, 14, accentNeutral | erledigt |
| C32 | @-Liste leer (26:11207) | MentionViews.swift | Zeile 24, innen 8, 12 muted | 14, innen 12 | erledigt |
| C33 | @-Liste Breite | MentionViews.swift | 196 | 240 | erledigt (nach Antwort von Consti) |
| C34 | @-Markierung im Eingabefeld (26:11816) | ComposerView.swift | Figur + Name inline | Rohtext | beantwortet (Antwort 7: fehlende Funktion, im Brain notiert) |
| C35 | Übergabe-Zeile Einrückung (26:11313) | OrbiLineRow.swift | keine | links 32 | erledigt |
| C36 | Übergabe-Zeile Name betont / Zustand „wartet auf Antwort“ | OrbiLineRow.swift, OrbiLineModels.swift | ganzer Satz muted; „Nova wartet auf Antwort“ | Name foreground als Knopf; Zustand fehlt | erledigt (nach Antwort von Consti) |
| C37 | Systemhinweis Arten Info/Warnung/Fehler/Unterbrochen (26:11342) | StepViews.swift | 4 Arten, Fehler mit Knopf „Nochmal“ | Warnung = Fehler, kein Knopf | erledigt (nach Antwort von Consti) |
| C38 | Systemhinweis Symbol | StepViews.swift | 13 | 12 | erledigt |
| C39 | Datei-Karte in Blase (26:11372) | MessageRow.swift `UserFileView` | Lücke 10, r14, card, Rand 0,5, Name 12 Medium, Info 11, Hover secondaryHover | 8, r8, background, Rand 1, 14/12, kein Hover | erledigt |
| C40 | Datei-Karte Breite / Icon-Kachel Farbe / Bild-Anhang (26:11371) | MessageRow.swift | 240 breit, Kachel orbi-Farbe mit weißem Symbol 16; Bild r14 ohne Rand, Ladezustand | max 320, muted; Bild r8 mit Rand | erledigt (nach Antwort von Consti) |
| C41 | Eingabeleiste Rand (26:11811 ff.) | ComposerView.swift | getippt/Anhänge: input; sonst border | immer border | erledigt |
| C42 | Eingabeleiste Radius mehrzeilig (26:11812) | ComposerView.swift | r20 (mit Anhängen r24) | immer 24 | erledigt |
| C43 | Senden inaktiv | ComposerView.swift `ComposerSendStyle` | secondaryHover | muted | erledigt |
| C44 | Symbole Plus/Senden/Stopp | ComposerView.swift | Plus 13, Pfeil 14, Stopp Quadrat 8 r2 | 14 / 12 / stop.fill 10 | erledigt |
| C45 | Eingabeleiste rechter Innenabstand | ComposerView.swift | 10 | 8 | erledigt |
| C46 | Eingabeleiste Zustände Fehler / offline / deaktiviert (26:11819–21) | ComposerView.swift | roter Rand + Text; „Keine Verbindung“ + Warteschlange; 40 % | fehlt / roter Hinweis; keine Dimmung | beantwortet (Consti: Sendefehler später) |
| C47 | Umbruch-Schwelle mehrzeilig | ComposerView.swift | „sobald der Text umbricht“ | > 70 Zeichen | beantwortet (Antwort 7: fehlende Funktion, im Brain notiert) |
| C48 | Plus-Menü Aufbau (26:11564) | ComposerView.swift, ComposerParts.swift | Liste: Anhang, Trenner, „Modell“, Modelle mit Haken; 200 breit, Zeilen 24, 12 | Panel mit Denktiefe, „Auto (Jev)“, Zeilen 32, 14 | erledigt (nach Antwort von Consti) |
| C49 | Slash-Menü | ComposerParts.swift `SlashMenuView` | Plus-Menü „Slash“ 26:11563: 240, r14, Zeilen 24, 12 Medium + Beschreibung; Befehlsmenü 143:56735: 384, r12, Zeilen 32, 14 Medium | nach 143:56735 | erledigt (nach Antwort von Consti) |
| C50 | Anhang-Chip (26:11524) | ComposerParts.swift `AttachmentChips` | Kachel 56 × 72 mit Vorschau, Zustände lädt/Fehler | waagrechter Chip 32 | beantwortet (Antwort 7: fehlende Funktion, im Brain notiert) |
| C51 | „Nach ganz unten“-Knopf (26:11824) | ChatView.swift | 28, popover, Rand border 0,5, Hover secondaryHover | 32, Material + glass, Rand glassRing 1 | erledigt |
| C52 | „Nach ganz unten“ Neu-Punkt (26:11835) | ChatView.swift | Punkt 8 Orbi-Farbe | fehlt | erledigt (nach Antwort von Consti) |
| C53 | Drop-Rahmen (26:13787) | ChatView.swift | Rand 1, Einzug 6 | 2, 4 | erledigt |
| C54 | Drop-Rahmen Inhalt und Tönung (26:13789) | ChatView.swift | Mitte mit Kachel, Titel, Untertitel, Tönung | nur Rand | beantwortet (Antwort 7: fehlende Funktion, im Brain notiert) |
| C55 | Symbole SF statt Lucide | überall | Lucide | SF Symbols (STATUS 4d) | passt (Entscheidung „Symbole sind SF Symbols“) |
| S1 | Seitenleiste Innenabstand (50:19993) | SidebarView.swift Suche, Hauptorbi, Zeilen, Fuß | rundum 10 (alles 220 bei 240) | 12 / 12 / 8 / 12 | erledigt |
| S2 | Schriftzug „Orbit“ (50:15485) | SidebarView.swift `brand` | 13 Semibold foreground | 14 Medium sidebarForeground | erledigt |
| S3 | Kopf-Knöpfe Seitenleiste/Plus (50:15490/94) | SidebarView.swift `SidebarIconLabel` | 24 × 24 r6, Symbol 14 muted, Hover/offen secondaryHover, ein Symbol | Kreis 32, sidebarAccent, gefüllte Variante | erledigt |
| S4 | Ampeln und Schriftzug (50:19806) | MainWindow.swift `TopBarMetrics` | Ampeln ab x 14, „Orbit“ ab x 74 | x 20 / x 92 | erledigt |
| S5 | Suchfeld (50:15564) | SearchViews.swift `SidebarSearchField` | 24, Kapsel, innen 8, Symbol 12, Abstand 6, 12; secondary / Hover secondaryHover / aktiv field + Rand 0,5 | 36, Symbol 14, 14, Rand input 1 | erledigt |
| S6 | Chat-Zeile (26:10956) | SidebarView.swift `Row.expanded` | 60 hoch, innen 0/10, Abstand 10, r12, Textabstand 2, Name 13 Medium, foreground | 52, innen 8, 12, r14, 0, 14 Medium | erledigt |
| S7 | Zeilen-Fläche Hover/geöffnet (Endfassung 124:29418) | SidebarView.swift `Row.fill` | Hover secondaryHover, geöffnet glassActive | sidebarAccent 60 %/100 % | erledigt (Komponente 49:16752 hat noch 2 %, freigegebene Endfassung 15 % gilt, passt zu D05) |
| S8 | Neu-Punkt in der Zeile (50:16425) vs. Status-Punkt (FIGMA-ABGLEICH 26:10956: 12 mit Rand) | SidebarView.swift `StatusDot` | Endfassung: Punkt 8 #3378ec ohne Rand, mittig rechts; Komponente: 12 #2563eb mit Rand 2 | 12, Status.info, oben | erledigt (nach Antwort von Consti) |
| S9 | Hauptorbi-Karte (49:16212) | SidebarView.swift `mainCard` | Figur 56, Name 12 Medium foreground, innen 12, r16, volle Breite 220 | 40, 14 Medium, 22/14, r18, nur Inhaltsbreite | erledigt |
| S10 | Hauptorbi Hover (49:16208) | SidebarView.swift | ganze Karte glassHover | sidebarAccent | erledigt |
| S11 | Hauptorbi geöffnet: Kasten 96 × 91 r14 glass hinter Figur und Name (49:16209) | SidebarView.swift | kleiner Kasten (Lage im Export nicht lesbar) | ganze Karte sidebarAccent | erledigt (nach Antwort von Consti) |
| S12 | Hauptorbi-Stern (49:16142) | SidebarView.swift `MainOrbiBadge` | 16, orbi/gelborange, Rand 2 Seitenleistenfarbe, weißer Stern 8 | 18, schwarz, gelber Stern | erledigt |
| S13 | Schienen-Eintrag (50:17842) | SidebarView.swift `Row` eingeklappt, `mainIcon` | Figur 40, Fläche 52 r14, Hover secondaryHover, geöffnet glassActive | Figur 28 im Kreis 40, sidebarAccent | erledigt |
| S14 | Fuß „Einstellungen“ (50:17772) | SidebarView.swift `settingsButton` | 220 × 32, innen 8, r8, Symbol 16 im 24-Feld, 12 Regular, Hover secondaryHover, Rand 10 | 56, r14, 14 Medium, sidebarAccent, 12 | erledigt |
| S15 | Ergebnisfenster (49:15915) | SearchViews.swift `SearchPopover` | innen 8, Abstand 2, r14, Rand 0,5, kein Schatten | 4, 0, r10, Rand 1, Schatten | erledigt |
| S16 | Trefferzeile (49:15830) | SearchViews.swift `SearchHitRow` | Kopf: Figur 20, Name 12, Zeit 11; Snippet 11 volle Breite; innen 6/8, Abstand 3, r8, aktiv secondaryHover, Treffer Medium | Figur 28 links, 14 Medium, 12, aktiv accent, Treffer farbig | erledigt |
| S17 | Such-Status (49:15860) | SearchViews.swift `SearchStatusLines` | 28 hoch, innen 8, Symbol 12 + 11 muted, Fehler grau | 14, keine Symbole, Fehler rot | erledigt (Wortlaut: S30) |
| S18 | Palette ⌘K mit Eingabe (49:15964) | SearchViews.swift `SearchPalette` | Eingabe 40, innen 14, Text 13, ohne Kasten, Linie 0,5; Liste innen 8, Abstand 2; Rand border 0,5 | Feld 32 mit Kasten, Rand glassRing 1 | erledigt (die Liste ohne Eingabe übernimmt Abstand 2/innen 8 mit) |
| S19 | Kontextmenü „Bearbeiten“-Symbol (49:17480/49:17568) | SidebarView.swift `botMenu`, `groupMenu` | Zahnrad | Stift | erledigt |
| S20 | Hauptorbi: nur Name, keine Statuszeile (49:16130, Consti-Notiz 49:14879) | SidebarView.swift `mainCard` | nur Name | „arbeitet…“ / „Pausiert, …“ darunter | erledigt |
| S21 | Vorschau = letzte Nachricht statt Aufgabe (49:16352) | SidebarView.swift, Dienst | letzte Nachricht; Aufgabe nur im Tooltip | Aufgabe / „arbeitet…“ / „Pausiert, wartet“ | beantwortet (Antwort 7: fehlende Funktion, im Brain notiert) |
| S22 | Punkt-Farben (49:16444, 49:16488) | SidebarView.swift `StatusDot` | nur blauer Neu-Punkt, auch bei Frage/Fehler | braucht dich orange (Brain E51/D04) | beantwortet (Antwort 4: Brain E51) |
| S23 | Statuspunkt am Hauptorbi | SidebarView.swift `mainCard` | kein Punkt | Punkt oben rechts | beantwortet (Antwort 4: Brain E51) |
| S24 | Ziehen und Sortieren (49:17057) | SidebarView.swift | Griff, Einfügelinie | nach Aktivität sortiert | beantwortet (Antwort 7: fehlende Funktion, im Brain notiert) |
| S25 | „Umbenennen“ im Kontextmenü; Gruppe „Mitglieder“, „Gruppe bearbeiten“ | SidebarView.swift | Menüpunkte vorhanden | fehlen / Mini-Menü am Namen | erledigt (nach Antwort von Consti) |
| S26 | Plus-Menü Wortlaut (50:15530) | SidebarView.swift `plusMenu` | „Neuer Orbi“, „Neue Gruppe“, 180 breit | „Neuen Orbi erstellen“, „Gruppe erstellen“, min. 128 | erledigt (nach Antwort von Consti) |
| S27 | Tooltip (49:16495) | WebControls.swift `TooltipBubble` | popover, Rand 0,5, r8, innen 4/8, 11, kein Pfeil; Inhalt „Name · Zustand“ | invertiert, Pfeil, 12/16, nur Name | erledigt (nach Antwort von Consti) |
| S28 | Hover-Vorschau neben der Zeile (49:21486) | – | 240 × 100 Karte mit letzter Nachricht | fehlt | beantwortet (Antwort 7: fehlende Funktion, im Brain notiert) |
| S29 | Eingeklappte Schiene: Breite 80/88, „+“, Trennlinie, Stern | SidebarView.swift, MainWindow.swift | 80 breit (Variable 88), kein „+“, keine Linie, kein Stern | 88, „+“, Linie, Stern | erledigt (nach Antwort von Consti) |
| S30 | Such-Wortlaut und Zeitformat (49:15812 ff.) | SearchViews.swift | „09:42“/„gestern“/„Mo“, Kopf „3 Treffer in Chats“, „Suche …“ usw. | „d.M.yyyy, HH:mm:ss“, kein Kopf, „Suche läuft …“ | erledigt (nach Antwort von Consti) |
| S31 | Abstände zwischen Blöcken der Leiste (50:19993) | SidebarView.swift | Platzhalter 4 / 8+8 / 8, Zeilen 2 (Endfassung 4) | 12 / 12 / 4, Zeilen 4 | erledigt (nach Antwort von Consti) |
| S32 | Umbenennen-Feld in der Zeile (49:17059) | SidebarView.swift `SidebarName` | Feld 150 × 22, r6, field, Rand muted 50 % bzw. 100 % | schlichtes Feld | erledigt (nach Antwort von Consti) |
| S33 | Gruppen-Avatar-Stapel (49:16690) | Figures/FigureView.swift `AvatarStack` | zwei Figuren 26,7, Ring 28,3 | zwei à 24,8 | erledigt (Consti: mitnutzen; Stapel 2 × 26,7 – Ring bleibt wie im Code) |
| S34 | Abschnitte „Gruppen“ einklappbar (Kopftext 49:14784) | SidebarView.swift | Text nennt Abschnitte, Bilder zeigen eine Liste | eine Liste (D05) | beantwortet (Antwort 3: Figma-Bilder ohne Abschnitte, D05) |
| S35 | Seitenleisten-Rahmen und Ecken (50:19993, 117:20464) | MainWindow.swift | r12 mit Rand 0,5 bzw. Rand nur an manchen Seiten | rechte Ecken 18, kein Rand | erledigt (nach Antwort von Consti) |
| S36 | Fuß „geöffnet“ (50:17771) | SidebarView.swift | glassActive, solange Einstellungen offen | fehlt | erledigt (nach Antwort von Consti) |
| S37 | Leer-Zustand in der Seitenleiste (50:18095) | SidebarView.swift | Orbi 56 + „Ersten Orbi erstellen“ | leer (E62: nur mittig im Fenster) | beantwortet (Antwort 4: Brain E62) |
| S38 | Laden/Fehler/„Keine Orbis“ in der Leiste (50:18096–98) | SidebarView.swift `StatusMessage` | Hinweise in der Liste, Kopf und Fuß bleiben | ganze Leiste ersetzt | erledigt (nach Antwort von Consti) |
| P1 | Panel-Kopf Name (119:24154) | SidePanel.swift `identity` | 15 Medium | 17 Semibold | erledigt |
| P2 | Panel-Kopf Untertitel „Dein (Haupt)orbi“ und Abstand Orbi↔Name 10 | SidePanel.swift | kein Untertitel, Abstand 10 | Untertitel, 8+2 | erledigt (nach Antwort von Consti) |
| P3 | Panel Innenabstand (50:18183) | SidePanel.swift | 16, oben 24 | 20 / 28 / 24 | erledigt |
| P4 | Panel Abstand der Blöcke | SidePanel.swift | 16 (nur Routinen im Details-Reiter) | 24 | erledigt (nach Antwort von Consti) |
| P5 | Panel-Reiter: Höhe, Innenabstand, Rand, Auswahl, Schrift (119:24155) | SidePanel.swift `navigation` | 26 (innen 2, Reiter 22), Rand 0,5, gewählt segmentThumb ohne Ring, Medium/Regular 12 | 32+4, Rand 1, glassActive + Ring, alle Medium | erledigt |
| P6 | Panel-Reiter Anzahl/Breite (119:24155) | SidePanel.swift | 3 Reiter (Details, Bibliothek, Computer), 220 breit, mittig | 4 (zusätzlich Gedächtnis), volle Breite | erledigt (Consti 05.11.: nur die drei Reiter aus Figma) |
| P7 | Schließen (119:24163) | SidePanel.swift `PanelCloseButton` | 24, r6, xmark 10 | 28, r10, 11 | erledigt |
| P8 | Details-Inhalt | SidePanel.swift `details` | nur Routinen | Aufgabe, Routinen, „Über …“, „Orbi bearbeiten“ | erledigt (nach Antwort von Consti) |
| P9 | Panel-Orbi Hover (124:29649) | SidePanel.swift | Abdunklung scrim nur auf der Orbi-Form, Stift 14 weiß | Quadrat background 64 %, Stift 24 | erledigt (nach Antwort von Consti) |
| P10 | Tooltip „Orbi bearbeiten“ (118:22626) | SidePanel.swift | eigener Tooltip | System-Tooltip | erledigt (nach Antwort von Consti) |
| P11 | Routinen-Kopf „Routinen“ + „Alle ansehen ›“ / „+ Neue Routine“ | SidePanel.swift | 12 Medium + „Alle ansehen“, kein Neu-Knopf | 15 Semibold, „+ Neue Routine“ | erledigt (nach Antwort von Consti) |
| P12 | Routinen-Zeile (50:18155) | SidePanel.swift `PanelRoutineRow` | gemeinsame Box, Zeile 36, innen 0/10, Uhr 13, Name 12, Zeitplan 11 daneben, Hover secondaryHover | Einzelkarten 76, Name 14 Medium, Zeitplan darunter, Pfeil | erledigt |
| P13 | Routinen-Zeile ⋯-Menü und Zustand „pausiert“ (50:19493) | SidePanel.swift | ⋯ bei Hover; 50 % + „pausiert“ | fehlt | erledigt (nach Antwort von Consti) |
| P14 | Panel-Breite (148:90637) | AppModel.swift `panelDefaultWidth` | 320 | 380 | erledigt (Standardbreite; Ziehen bleibt) |
| P15 | Linie links am Panel | SidePanel.swift `handle` | 0,5 | 1 | erledigt |
| P16 | Computer-Reiter-Inhalt, Gruppen-Panel-Kopf | SidePanel.swift | nicht in Figma | vorhanden | erledigt (nach Antwort von Consti) |
| P17 | Bibliothek Suchfeld (50:18248) | SidePanel.swift (`webInput`) | 24, r12, secondary, 12 | 32, field, Rand | erledigt (über G18) |
| P18 | Bibliothek Suchfeld Lupe | SidePanel.swift | keine Lupe | Lupe | erledigt (nach Antwort von Consti) |
| P19 | Bibliothek Abstand der Blöcke | SidePanel.swift `OrbiLibraryView` | 12 | 16 | erledigt |
| P20 | Filter-Chip gewählt (50:18250) | SidePanel.swift `LibraryFilterStyle` | kein Haken (Haken-Ebene versteckt, Text „kein Haken“) | Haken | erledigt |
| P21 | Abstand zwischen Chips | SidePanel.swift | 6 | 4 | erledigt |
| P22 | Datei-Zeile (50:18325) | SidePanel.swift `LibraryFileRow` | 40, innen 0/10, Abstand 10, Name 12, Abstand 1 | 48, 12/8, 8, 13, 0 | erledigt |
| P23 | Datei-Zeile „lädt“ / „deaktiviert“ | SidePanel.swift | Loader 14; 40 % | 12; keine Dimmung | erledigt |
| P24 | Dateiliste Trennlinien | SidePanel.swift | 0,5 border | System-Divider | erledigt |
| P25 | Datei-Zeile Hover-Knöpfe 24 r6 | SidePanel.swift | zwei Icon-Knöpfe 24 | plain / Menüknopf | erledigt (nach Antwort von Consti) |
| P26 | Datei-Untertext mit Datum, „Text“ statt „Dokument“; Leer-/Kürzungstexte | SidePanel.swift | „PDF · 212 KB · gestern“, „Noch keine Dateien.“, „Liste gekürzt – 50 von 212 Dateien.“ | ohne Datum, andere Texte | erledigt (nach Antwort von Consti) |
| P27 | Bibliothek: Titel, Unterzeile, „Aktualisieren“ | SidePanel.swift | nicht in Figma | vorhanden | erledigt (nach Antwort von Consti) |
| P28 | Mitglieder-Zeile (50:18609) | SidePanel.swift `PanelMemberRow` | 36, innen 0/10, Abstand 10, Figur 20, Name 12, Hover secondaryHover, deaktiviert 40 % ganze Zeile | innen 6, 8, Figur 28, 14, muted | erledigt |
| P29 | Mitglieder in gemeinsamer Box | SidePanel.swift | card, r10, Rand 0,5, Trenner | lose Zeilen | erledigt |
| P30 | Mitglieder Hover-Knöpfe | SidePanel.swift | 24 × 24 r6, Symbol 14, message-circle/pencil | 28, 13, bubble.left | erledigt |
| P31 | Hinweis „Höchstens 6 Orbis je Gruppe – weitere sind ausgegraut.“ | SidePanel.swift | unter der Box, 11 | darüber, kürzer, 12 | erledigt (nach Antwort von Consti) |
| P32 | Einstellungen-Navi Radius | Settings/SettingsView.swift | r8 | r10 | erledigt |
| P33 | Einstellungen-Navi Höhe/Schrift/Symbol, gewählt-Fläche, Hover, Fläche/Linie | Settings/SettingsView.swift | Teil 16: 28/8/12, glassActive, Karte sidebar; Schritt 4: 32/10/14/16, secondary, Linie 0,5 | wie Schritt 4, Symbol 14, Hover muted, Linie 1 | erledigt (nach Antwort von Consti) |
| P34 | Navi-Symbole Allgemein/Orbis | Stores/SettingsStore.swift | Zahnrad / book-open | checklist / book | erledigt (Zahnrad; book bleibt, SF „book“ ist bereits das offene Buch) |
| P35 | Einstellungslisten als gruppierte Box (Skills, Konnektoren, Freigaben), Aktionen hinter ⋯, Texte | Settings/*View.swift | Box-Zeilen 40, Name 12, Zusatz 11, ⋯ bei Hover | Einzelboxen, sichtbare Knöpfe | erledigt (nach Antwort von Consti) |
| P36 | ⋯-Menü „Testen“-Symbol (50:19188) | Settings/SettingsConnectorsView.swift | refresh-cw | play | erledigt |
| P37 | Abschnittsüberschriften Einstellungen | Settings/SettingsKit, SettingsApprovalsView | 11 Medium muted | 16 Medium / 18 Semibold | erledigt (nach Antwort von Consti) |
| P38 | Routinen-Liste mit Verlauf „Alle ansehen“ (50:19494), Papierkorb (50:19531) | – | vorhanden | fehlt | beantwortet (Antwort 7: fehlende Funktion, im Brain notiert) |
| P39 | Orbi-Menü als Popover mit Form/Personalisieren (119:24197) | SidePanel.swift `editContent`, BotEditorView.swift | Karte 360 über dem Panel, Reiter Form/Personalisieren, kein Speichern | Bearbeiten-Seite mit Speichern/Abbrechen, Dialog für neuen Orbi | beantwortet (Antwort 7: fehlende Funktion, im Brain notiert) |
| P40 | Orbi-Menü Form-Raster (Kachel 48, Figur 38, Abstände 21,5/14; Farben 36, 4,5/10) | BotEditorView.swift | wie links | 5/8 Spalten, Abstände 8 | erledigt (nach Antwort von Consti) |
| P41 | Form-Kachel Zustände (118:23346) | BotEditorView.swift `ShapeTile` | Hover glass, gewählt glassActive, r12 | secondary / secondaryHover, r10 | erledigt |
| P42 | Farbfeld gewählt (118:23351) | BotEditorView.swift `swatch` | Rand 1,5 foreground (Komponente 70 %, Instanz 100 %) direkt am Feld | Ring 2 mit Abstand 4 | erledigt (nach Antwort von Consti) |
| P43 | Personalisieren als Gruppen-Zeilen Name/Aufgabe/Hauptorbi; Feld „Verhalten“ | BotEditorView.swift | Gruppen-Zeilen 38; „Verhalten“ (Brain D06: raus) | Felder mit Label, Chips | erledigt (nach Antwort von Consti) |
| P44 | Zusatzfunktionen nur im Code (Regler, Augenform, Zubehör, Wangen, Verlauf leeren, Orbi löschen) | BotEditorView.swift, SidePanel.swift | nicht vorhanden | vorhanden | erledigt (nach Antwort von Consti) |
| P45 | Hauptorbi-Warnung als eigene Karte (122:28173) | BotEditorView.swift | Karte 260, Figur 40, Text „Nova ist gerade dein Hauptorbi …“, Knöpfe untereinander; Warnung beim Einschalten | System-Alarm, anderer Text, erst beim Speichern | erledigt (nach Antwort von Consti) |
| B1 | Chat-Kopf-Pille Name und Figur (140:41502, Bildschirm 148:90599) | ChatHeaderView.swift | 13 Semi Bold, Figur 28 (FIGMA-ABGLEICH nannte noch 15/32, veraltet) | 15 Semi Bold, Figur 29 | erledigt |
| B2 | Chat-Kopf-Pille Hover (140:41514) | ChatHeaderView.swift | rechts 10, chevron-right 10 | rechts 20, Pfeil 12 | erledigt |
| B3 | Chat-Kopf-Pille Material und Schatten | ChatHeaderView.swift | keine Effekte | ultraThinMaterial + Schatten 5 % | erledigt (nach Antwort von Consti) |
| B4 | Startbildschirm Titel und Abstände (157:100637) | MainWindow.swift `case nil` | „Orbit“ 20 Semi Bold, Figur → Titel 20, Titel → Hinweis 6 | 24 Semi Bold, 24 / 8 | erledigt |
| B5 | Startbildschirm Figur | MainWindow.swift | Bildschirm 3: 80; Animationen 147:59236: 56 | 56 | erledigt (nach Antwort von Consti) |
| B6 | Erststart ohne Orbi (164:111595) | MainWindow.swift, SidebarView.swift | Seitenleiste mit Kopf/Fuß, Figur und Knopf links; Mitte nur „Lege links deinen ersten Orbi an.“ | Seitenleiste leer, Mitte Figur + Knopf (Brain E62: nur mittig) | beantwortet (Antwort 4: Brain E62) |
| B7 | Live-Zeile fest über der Eingabe (143:51801, 148:90635) | ChatView.swift, StepViews.swift | über dem Eingabefeld, links 12, Abstand 8 | im scrollenden Verlauf | erledigt (nach Antwort von Consti) |
| B8 | Trennlinie Seitenleiste rechts 0,5 | MainWindow.swift | 0,5 border (Kante im Export „mixed“) | keine | erledigt (nach Antwort von Consti) |
| B9 | Leerer Chat „Noch keine Nachrichten“ (Onboarding 6, 171:129728) | ChatView.swift | oben 28, 14 Medium + 14 Regular, Zeilenhöhe 20 | oben 24, ohne Zeilenhöhe | erledigt |
| K1 | Freigabe „Immer erlauben“ (145:58673) | CardKit.swift `PillButtonStyle.tint` | Primärfarbe 16 %, Text foreground | 15 %, Text Primärfarbe | erledigt |
| K2 | Pillen-Knopf deaktiviert | CardKit.swift `PillButtonStyle` | 40 % | 50 % | erledigt |
| K3 | Freigabe-Ergebniszeile Höhe (145:58643) | ApprovalCard.swift | 13/18 | ohne Zeilenhöhe | erledigt |
| K4 | Freigabe-Ergebnis „Einmal erlaubt“ / „Immer erlaubt“, Symbol 14 | ApprovalCard.swift | zwei Texte, Symbol 14 | „Erlaubt“, 12 | beantwortet (Consti: später, Daten fehlen) |
| K5 | Freigabe: Zusätze nur im Code (Eingaben ansehen, Entwurf/Betrag/Zugangsdaten, „Nicht mehr offen“), „Immer“ bei „dauerhaft“ (E14) | ApprovalCard.swift | nicht in Figma | vorhanden | beantwortet (Antwort 6: Sicherheitsinhalte bleiben) |
| K6 | Karten-Hover-Leuchten | CardKit.swift | kein Hover | Rand + Schatten in Primärfarbe | erledigt (nach Antwort von Consti) |
| K7 | Fragebogen Frage/Antwort Zeilenhöhe (139:39743/59) | AskPanel.swift | 14/22 | ohne | erledigt |
| K8 | Fragebogen Blättern-Knöpfe (139:39746) | AskPanel.swift | 24 × 24, Symbol 14 | 20 × 24, 10 | erledigt |
| K9 | Fragebogen Zeilenradius (139:39754) | AskPanel.swift | r8 | r10 | erledigt |
| K10 | Fragebogen Nummer (139:39756) | AskPanel.swift | 12 Medium | 12 Regular | erledigt |
| K11 | Fragebogen Kästchen Mehrfachwahl aus (139:39891) | AskPanel.swift | muted + Rand border 0,5 | secondary ohne Rand | erledigt |
| K12 | Fragebogen in Gruppe neutral (139:39841) | AskPanel.swift, ToolCards.swift, RootCards.swift | Nummer/Weiter foreground | immer Primärfarbe | erledigt (nach Antwort von Consti) |
| K13 | Fragebogen „Weiter“ bei Einzelwahl, Knopftexte | AskPanel.swift | „Weiter“ immer | Brain D17: Einzelwahl geht sofort weiter; „Weiter (n)“/„Senden“/„Übernehmen“ | beantwortet (Antwort 4: Brain D17) |
| K14 | Fragebogen-Zusammenfassung (139:39909) | AskPanel.swift `AskSummaryView` | 448, innen 12/16, r12, Frage 12/18, Antwort 14 Medium/22, Eintrag innen 2 | 340, 14, r14, alles 18, Abstand 4 | erledigt |
| K15 | Automation-Lauf Zeile (143:52141) | AutomationRunCard.swift | 26 (innen 4/0), 13/18, „Erneut versuchen“ 13 Medium | ohne Innenabstand/Zeilenhöhe, Regular | erledigt |
| K16 | Unterstreichung „Erneut versuchen“; Zusatzzustände „wartet …“, „wird erneut gestartet …“ | AutomationRunCard.swift, ErrorCard.swift | keine Unterstreichung lesbar; Zustände nicht in Figma | unterstrichen; vorhanden | erledigt (nach Antwort von Consti) |
| K17 | Fehlerzeile (143:52183) | ErrorCard.swift | 26 (innen 4/0), 13/18, Symbol 14, Abstand 8 | Label vom System, ohne Zeilenhöhe | erledigt |
| K18 | Fehler im Chat mit Orbi-Figur daneben | ChatView.swift | keine Figur | Figur 24 | erledigt (nach Antwort von Consti) |
| K19 | Bild fertig Radius (143:52220) | MediaCards.swift | r12 | r10 | erledigt |
| K20 | Bild: Platzhalter 360 × 240, feste Größe, Fehlerzeile mit „Erneut versuchen“, Vollansicht (143:52251) | MediaCards.swift | wie links | Seitenverhältnis aus Datei, rote Box, dunkle Vollansicht | erledigt (nach Antwort von Consti) |
| K21 | Routine-Vorschlag (139:40558) | RoutineCard.swift | kompakte Karte 360, Pillen „Erstellen“/„Bearbeiten“, Zustand „erstellt“ | große Karte 480 | erledigt (nach Antwort von Consti) |
| K22 | Live-Zeile Zeilenhöhe (143:51758) | StepViews.swift | 13/18 | ohne | erledigt |
| K23 | Live-Zeile Zustand „wartet“ | StepViews.swift | nicht in Figma | vorhanden | beantwortet (Antwort 4: Zustand aus dem Brain-Ablauf bleibt) |
| K24 | Gruppen-Stapel im Chat-Kopf (140:41561, 140:41596) | Figures/FigureView.swift | 6 Orbis als Reihe 22/−5 | höchstens 3 + „+N“ | beantwortet (später; Stapel-Größe über S33) |
| K25 | Computer-Reiter: Überschrift/Satz/„Sitzung“ ausgeblendet; Fläche ohne Füllung; Offline/Fehler als Zeile | SidePanel.swift, DesktopView.swift | ausgeblendet / keine Füllung / Zeile | sichtbar / muted / Box | erledigt (nach Antwort von Consti) |
| K26 | „Computer öffnen“ als Pille 24 | SidePanel.swift | Pille 24, Rand 0,5 | `.card(.outline)` 32 | erledigt (nach Antwort von Consti) |
| K27 | Computer-Bildschirm Rand (143:53684) | DesktopView.swift | Ring 0,5 | 1 | erledigt |
| K28 | „Kein Computer“ (143:58512) | DesktopView.swift | Symbolfeld r8, Text 14/20 | r10, ohne Zeilenhöhe | erledigt |
| K29 | Vollbild-Hinweis beim Überfahren (143:53716) | DesktopView.swift | Fläche background voll | 80 % | erledigt |
| K30 | Computer-Vollbild Karte (143:53984) | DesktopView.swift `DesktopFullscreen` | card, r16, Ring 0,5 | popover, r14, Ring 1 | erledigt (Größe 640 × 400 ist Beispiel, Code bleibt) |
| K31 | Computer-Vollbild Hinweis-Pille (143:53991) | DesktopView.swift | card, Rand 0,5 | popover, Rand 1 | erledigt |
| K32 | Computer-Chips in Gruppe (140:42164) | SidePanel.swift | Rand 0,5 | 1 | erledigt |
| K33 | Dialog-Karte (140:42638) | DialogKit.swift `DialogShell` | card, r16, Ring 0,5 | popover, r14, Ring 1 | erledigt |
| K34 | Dialog-Kopf Titel/Innenabstand (140:42640/39) | DialogKit.swift | 16 Medium/20; innen 16/44/20/16 | /16; rechts 16 | erledigt |
| K35 | Dialog-Fuß (140:42646) | DialogKit.swift | muted voll, Linie 0,5 | muted 50 %, Linie 1 | erledigt |
| K36 | Dialog Gruppe Orbi-Zeile Radius (140:42654) | GroupEditorView.swift | r8 | r10 | erledigt |
| K37 | Fehlertext unter dem Feld (140:43180, 143:56296) | GroupEditorView.swift, NewSkillDialog.swift | 10 rot unter dem Feld | 12/14 im Fuß | erledigt (nach Antwort von Consti) |
| K38 | Dialog-/Einstellungsknöpfe als Pille 24 (Dialog Gruppe, Löschen, Neuer Skill, Allgemein, Orbis-Anleitung, Nutzung „Aktualisieren“), „Löschen“ als roter Umriss rechts | DialogKit, GroupEditorView, NewSkillDialog, Settings | Pille 24, Löschen Rand/Text destructive 0,5 | `.card(...)` 28/32 | erledigt (nach Antwort von Consti) |
| K39 | Dialog Gruppe Liste fest 480 hoch | GroupEditorView.swift | alle Zeilen sichtbar | scrollt | erledigt (nach Antwort von Consti) |
| K40 | Dialog Löschen (141:48345) | DialogKit.swift `AlertDialogView` | card, r16, Ring 0,5; innen 16/16/20/16, Abstand 8, Titel /20; Fuß muted, Linie 0,5 | popover, r14, Ring 1; 16, 6, /24; muted 50 %, Linie 1 | erledigt |
| K41 | Dialog Löschen Fehlerzeile, Lösch-Texte (141:48347 ff.) | DialogKit.swift, BotStore.swift, SettingsSkillsView.swift | Symbol + 12 rot; „Lumi löschen?“ usw. | InlineAlert 14; andere Texte | erledigt (nach Antwort von Consti) |
| K42 | Formular Routine (140:43986) | AutomationFormView.swift | Karte 400 „Neue Routine“, gruppierte Zeilen | Dialog 512 „Neue Automation“ mit mehr Feldern | erledigt (nach Antwort von Consti) |
| K43 | Plan-Hinweis (143:56663) | – | vorhanden | fehlt | beantwortet (Antwort 7: fehlende Funktion, im Brain notiert) |
| K44 | Befehlsmenü-Feinwerte (Ring glassRing, gewählt muted, Zeile 14/20, Brain offline, lädt, leer) | ComposerParts.swift | nach 143:56735 | teils abweichend | erledigt (nach Antwort von Consti) |
| K45 | Einstellungen Fensterfläche (143:54296) | Settings/SettingsView.swift | background | popover | erledigt |
| K46 | Einstellungen Navi-Linie | Settings/SettingsView.swift | 0,5 | 1 | erledigt |
| K47 | Einstellungen-Box (143:54088) | Settings/SettingsKit.swift `SettingsBox` | card, Rand 0,5, innen 10/12 | keine Fläche, Rand 1 (+1), 12 | erledigt |
| K48 | Allgemein Zeilenwerte „Erlaubt“/„Läuft“ (143:54093/54101) | Settings/SettingsSetupView.swift | 13 | 14 | erledigt |
| K49 | Allgemein Umfang, „Noch nicht gefragt“ | Settings/SettingsSetupView.swift | nur Mitteilungen + Dienst | mehr Inhalte | erledigt (nach Antwort von Consti) |
| K50 | Nutzung Abstand der Boxen (143:54364) | Settings/SettingsUsageView.swift | 16 | 12 | erledigt |
| K51 | Nutzung Box-Rand | Settings/SettingsUsageView.swift | border 0,5 | glassRing 0,5 | erledigt |
| K52 | Nutzung Zeilen (143:54369) | Settings/SettingsUsageView.swift | Linie oben 0,5, Abstand 6 | keine Linie, 4 | erledigt |
| K53 | Nutzung Beschriftung/Prozent (143:54372/73) | Settings/SettingsUsageView.swift | 14 Regular / 14 Medium, /20 | Medium / Regular | erledigt |
| K54 | Nutzung Spur (143:54374) | Settings/SettingsUsageView.swift | track | muted | erledigt |
| K55 | Nutzung ab 80 % / 100 % (143:54493, 54518) | Settings/SettingsUsageView.swift | Prozent rot ab 80 %, Text bei 100 % rot | normal / muted | erledigt |
| K56 | Nutzung Texte „Setzt um/am … zurück.“, „Stand 22:30“ ausgeblendet, Konto-Auswahl, Laden (2 statt 3 Boxen), Offline/Fehler-Aufbau | Settings/SettingsUsageView.swift, SettingsModels.swift | wie Figma | abweichend | erledigt (nach Antwort von Consti) |
| K57 | Orbis-Anleitung Textfeld (143:54931) | Settings/SettingsKit.swift `SettingsTextArea` | 13/20 | 14 | erledigt (Innenabstand 10/12: Frage, TextEditor-Innenrand) |
| K58 | Orbis-Anleitung Zähler ausgeblendet | Settings/SettingsInstructionsView.swift | ausgeblendet | erscheint bei Bedarf | erledigt (nach Antwort von Consti) |
| K59 | Marktplatz-Seite (143:55113) | Settings/SettingsMarketplaceView.swift | Liste | Kacheln (Consti 05.11., Figma 192:18885) | erledigt (nach Antwort von Consti) |
| K60 | Darstellung Auswahl (143:55472) | Settings/SettingsAppearanceView.swift | Rechteck r8, gewählt secondary + Rand foreground 1 | Kapsel, gewählt nur Rand | erledigt |
| K61 | Darstellung Label (143:55470) | Settings/SettingsAppearanceView.swift | 14/20 | ohne Zeilenhöhe | erledigt |
| K62 | App-Symbol Vorschau (143:55496) | Settings/SettingsAppIconView.swift | 64, Abstand 14 | 58, 20 | erledigt |
| K63 | App-Symbol Auswahlring (143:55505) | Settings/SettingsAppIconView.swift | foreground 1,5 | primary 2 | erledigt |
| K64 | App-Symbol Linien (143:55502) | Settings/SettingsAppIconView.swift | border 0,5, Box-Rand 0,5 | Divider, Rand 1 | erledigt |
| K65 | App-Symbol Kacheln 6 × 40 / Zurücksetzen-Knopf | Settings/SettingsAppIconView.swift | 6 Kacheln 40 (Brain D13: 12 Entwürfe), Zurücksetzen immer mit Symbol | 12 Spalten, Link nur wenn geändert | erledigt (nach Antwort von Consti) |
| K66 | Dialog Neuer Skill: Beschreibung ausgeblendet, Höhe 394, Felder | Settings/NewSkillDialog.swift | ausgeblendet, 394 | sichtbar, 640 | erledigt bis auf Beschreibung (Dienst verlangt sie als Pflichtfeld) |
| K67 | Beispiel-Fenster: Abstand Kopf → Verlauf (143:57596) | ChatView.swift `Theme.Layout.headerGap` | 8 | 12 (STATUS 04.11.: 12) | beantwortet (Antwort 3: Abstand 12 wie Chat-Layout vom 04.11. bleibt einheitlich) |
| O1 | Onboarding Figurgrößen (164:116628, 169:124248) | OnboardingView.swift | 160 (1/5), 56 (3/4) | 140 / 48 | erledigt |
| O2 | Onboarding Abstände je Schritt | OnboardingView.swift | Punkte→20, Figur→Titel 32 (1/5) bzw. 16 (3/4), Text→Inhalt 28, Inhalt→Knöpfe 28, Punkte-Abstand 6 | überall 24, Punkte 8 | erledigt |
| O3 | Untertitel Zeilenhöhe (164:116650) | OnboardingView.swift | 14/20 | ohne | erledigt |
| O4 | Onboarding-Knöpfe (164:116921, 164:116634) | OnboardingView.swift `OnboardingStepButtonStyle` | 2a/3/4 und Anmelden/Erlauben: 24, Regular 12, innen 12; „Los geht’s“/„Loslegen“: 34, Regular 13, innen 20; Zweit gedrückt input; deaktiviert 40 % | 28/24, Medium 14/12, innen 14/10, 85 %, 50 % | erledigt (Einrichtung „Alles bereit?“ behält ihren Knopf, siehe O14) |
| O5 | Onboarding-Knopf Hover | OnboardingView.swift | Zweit secondaryHover | kein Hover | erledigt (nach Antwort von Consti) |
| O6 | Onboarding Trennlinien | OnboardingView.swift | border 0,5 | System-Divider | erledigt |
| O7 | 2a Gestalten (164:116652 ff.) | OnboardingView.swift `appearance` | Abstand 24, Vorschau 280, Figur 120, Abstand 12; Reiter „Form“ 13 Medium, innen 6/10, glassActive | 32, 240, 112, 16; 14 Medium, 4/12, secondaryHover | erledigt |
| O8 | 2a Formkacheln | OnboardingView.swift | 48, Figur 38, r12, gewählt glassActive, 5 je Reihe bündig verteilt, Zeilen 14 | flexible Spalten 8/12, Figur 40, r14, secondaryHover | erledigt |
| O9 | 2a Farbfelder (118:23347) | OnboardingView.swift | Feld 30, außen 36, Ring 1,5, Abstand 4,5, Zeilen 10, zentriert | 28/32, Ring 1, 8/12 | erledigt |
| O10 | 2a Formkachel Hover + Tooltip; Farbfeld-Rand nur bei Weiß (Hell); Ring-Deckkraft 70/100 % | OnboardingView.swift | wie links | fehlt / alle Felder Rand / 100 % | erledigt (nach Antwort von Consti) |
| O11 | 3/4 Zeilen (169:124255) | OnboardingView.swift `rowText`, `accessRow` | innen 10/12, Abstand 2, 14 Medium/20, 12/16 | 12, 4, ohne Zeilenhöhe | erledigt |
| O12 | 4 Gruppen (169:124335/124306), Konto-Logo (169:123843), „Konnektor hinzufügen“ (169:124356) | OnboardingView.swift `services` | Abstand 20, Label 12 Medium eingerückt 12, Abstand 8; Logo 20 r6 secondary, 11 Semibold; Zeile 36, 13 | 16, 12 Regular; Kreis muted; 14 | erledigt |
| O13 | Zustände „Erlaubt“/„Angemeldet“ mit Punkt; „Im Hintergrund laufen“ Text/Knopf; Fähigkeiten-Box; Scrollbereich; Sterne im Abschluss; Flug-Animation | OnboardingView.swift | wie Figma | fehlt / anders | erledigt bis auf Sterne/Flug (FigureView fremd geändert) |
| O14 | Einrichtung „Alles bereit?“ (SetupIntroView) | SetupIntroView.swift | kein Figma-Frame | eigene Werte | erledigt (nach Antwort von Consti) |
| M1 | Marktplatz Abstand der Blöcke, Kopf (192:18895/96/98) | Settings/SettingsMarketplaceView.swift | 20; Titel→Untertitel 7, Untertitel 13 | 24; 4, 14 | erledigt |
| M2 | Marktplatz Suchfeld (192:18899) | Settings/SettingsMarketplaceView.swift | 44 hoch, innen 0/14, Abstand 10, Lupe 16, Text 13 | innen 12, Abstand 8, Lupe 13, Text 14 | erledigt |
| M3 | Abschnittskopf „Dienste entdecken“ (192:18917) | Settings/SettingsMarketplaceView.swift | 17 Semibold, Abstand 5 | 16 Semibold, 4 | erledigt |
| M4 | Marktplatz-Chips (192:18905 ff.) | Settings/SettingsMarketplaceView.swift | 31 hoch, innen 8/13, r8, gewählt secondary + 12 Semibold, sonst 12 Regular muted, kein Rand | Bibliotheks-Chip (24, Kapsel, Rand) | erledigt (nach Antwort von Consti) |
| M5 | Marktplatz-Kacheln vereinheitlichen (r12, Rand 1, innen 16, 112 hoch, Logo 42/28, Name 14 Semibold, Beschreibung 11 einzeilig) | SettingsProvidersView, SettingsMarketplaceView | eine Bauweise | drei Bauweisen | erledigt (nach Antwort von Consti) |
| M6 | Kachel-Knopf „Verbinden“ (192:18931) | Settings/* | 29 hoch, innen 8/10, r8, 11 Medium | Kapsel 28 | erledigt (nach Antwort von Consti) |
| M7 | Kachel-Zustände, „Konten verwalten“, Composio/Apple-Texte, Nango/Pipedream, Logos dunkel, Altkatalog (143:55113), Fußzeile „Verbindungen verwalten →“, „Konnektoren verwalten“-Aufklapper | Settings/* | wie Figma 192 bzw. 143:55113 | abweichend / zusätzlich | beantwortet (Consti: Code lassen, später; Brain E53) |
| A1 | Kopf-Figur Chat (140:41503) | ChatHeaderView.swift | 28 | 29 | erledigt (siehe B1) |
| A2 | Blinzeln von Kopf und Panel (148:84618, 148:88246) | Figures/OrbiBehavior.swift | Kopf/Panel „kein Blinzeln“, nur Leerzustand blinzelt | alle drei blinzeln (STATUS 04.11.) | erledigt (nach Antwort von Consti) |
| A3 | Pose der Figuren neben Nachrichten und in der @-Liste (148:86441, 148:89951) | Figures/OrbiBehavior.swift | links oben, Neigung 9°, still | gerade, Blick Mitte (freigegebene ANIMATIONEN-LISTE: „gerade und still“) | beantwortet (Antwort 4: freigegebene Animationsliste) |
| A4 | Arbeiten: Sprung/Salto-Takt (147:62578) | Figures/OrbiBehavior.swift | 20-s-Schleife, Sprung bei 8 s, Salto bei 18 s | Drehung alle 8 s, Salto alle 18 s | erledigt (Schleife); Bildtakt: Consti 05.11. „mitnutzen“, Takt unverändert, im Brain notiert |
| A5 | Faktor „× 1,5“ beim Ruheblick (148:65514) | Figures/OrbiBehavior.swift, FigureView.swift | „−0,8/−0,85 × 1,5“ | ohne Faktor (Mausformel hat ihn) | beantwortet (Antwort 9; Faktor gehört laut Figma-Text zur Mausformel, die ihn schon hat) |
| A6 | Blauer Punkt erst nach der Feier ab 2,3 s mit Aufspringen (148:70178) | Phase5Models.swift, SidebarView.swift | verzögert | sofort | erledigt (nach Antwort von Consti) |
| A7 | Lage des Status-Punkts am Orbi (Abzeichen 26:10893) und Ringfarbe (sidebar vs. background) | SidebarView.swift | am Orbi, Ecke im Export nicht lesbar; Ring sidebar (147:59236) bzw. background (26:10893) | rechts in der Zeile, Ring sidebar | erledigt (nach Antwort von Consti) |
| A8 | Punkte für Fehler (rot) und Pausiert (gelb) (26:10926) | Phase5Models.swift | vorhanden | nur fertig/braucht dich (Brain E51) | beantwortet (Antwort 4: Brain E51) |
| A9 | Leerzustand-Orbi in der Seitenleiste, Mausfolgen über dem ganzen Hinweis (148:89427) | MainWindow.swift, SidebarView.swift | Hinweis in der Seitenleiste | Figur in der Fenstermitte (Brain E62) | beantwortet (Antwort 4: Brain E62) |
| A10 | Große Editor-Vorschau animiert | BotEditorView.swift, SidePanel.swift | nicht in Figma | Lab-Engine (freigegebene Liste) | beantwortet (freigegebene Animationsliste: Lab-Vorschau bleibt) |
| A11 | Orbi-Farben (1:292), Augenfarben, Punktfarben, Zeiten der Zustände | Assets, OrbiBehavior.swift | 60 Farbwerte, Zeiten laut 147:59236 | identisch | passt |
