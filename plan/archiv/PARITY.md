---
tags: [orbit, mac, design, parität]
status: fertig (Block 4g, 25.10.2026)
date: 2026-10-25
herkunft: Auftrag Block 4g von Consti (25.10.2026); Messung der Web-UI (localhost:3000 gegen Datenbankkopie) per DOM, `getComputedStyle` und `document.getAnimations()` (Skript `plan/tools/measure-states.mjs`), Web-Code `app/`, `components/`
---

# PARITY: Web-UI ↔ native App (Block 4g)

Web-UI ist die Referenz. Je Zeile: Element, Web-Verhalten (gemessen oder aus dem Code), nativer Stand, Status, Priorität (A = sichtbar in jeder Sitzung, B = gelegentlich, C = selten).

**Status-Werte (fest):** `gleich` · `abweichend` · `fehlt` · `Plattformgrenze: <Grund>` · `später 4c|4d|4e` · `nativ zusätzlich (<Auftrag>)`.
Fertig = keine Zeile `abweichend` oder `fehlt` (`grep -cE "\| (abweichend|fehlt) \|" plan/PARITY.md` = 0).

**Entscheidungen (Consti, 25.10.2026):** Rechtsklick-Menüs nativ im Web-Dropdown-Stil, nur mit Aktionen, die das Web für das Objekt hat. „Aussehen anpassen“ als Knopf im Panel-Reiter „Bearbeiten“. Reiter „Computer“ mit Lade-Fläche (Inhalt 4e).
**Abgeleitet:** Status-Ring um die Figur entfällt (Web hat ihn bewusst entfernt, Commit 050924c „Ringe weg“; Zustand bleibt als Text und Bedienungshilfe-Text). Figuren behalten die Zeichnung aus 4a (4f), übernehmen aber die Bewegung des Webs. Orb-Schreibblase wird zu den drei Web-Punkten.

## Gemessene Grundwerte

| Wert | Web (gemessen) |
|---|---|
| Hover/Farbwechsel | `transition` 150 ms, `cubic-bezier(0.4, 0, 0.2, 1)` (Tailwind-Standard) |
| Gedrückt (Knopf) | `translate-y: 1px`, keine Farbänderung; nicht bei Menü-Auslösern (`aria-haspopup`) |
| Fokus (Tastatur) | Rand `ring`, Schatten `0 0 0 3px ring/50 %` (nur `focus-visible`) |
| Deaktiviert | Deckkraft 50 %, keine Treffer |
| Menü/Select auf | 100 ms `ease`, von `translateY(-8px) scale(.95) opacity 0` nach `none / 1` (Seite unten), zu: 100 ms nach `scale(.95) opacity 0` |
| Dialog/AlertDialog auf | 100 ms `ease`, Fläche `scale(.95)→1` + Deckkraft, Hintergrund schwarz 10 % + Unschärfe (`backdrop-blur-xs` 4 px) blendet ein; zu: umgekehrt |
| Tooltip | Fläche foreground, Text background, r 8, 12/16, Innenabstand 6/12, Pfeil 10, `zoom-in-95 fade-in` (150 ms), Verzögerung 0 |
| Rechtes Panel | Breite 380 (gemerkt, 25 %…520), gleitet 380 ms `cubic-bezier(0.32, 0.72, 0, 1)` |
| Seitenleiste einklappen | Breite 300 ms `cubic-bezier(0.32, 0.72, 0, 1)`, Zeilen 150 ms |
| Neue Nachricht | 300 ms `ease-out` (`cubic-bezier(0,0,.2,1)`), Deckkraft 0→1, von 8 pt unten |
| Nachrichten-Aktionen | Deckkraft 0→1 in 150 ms beim Überfahren |
| Kopf einrasten | 300 ms easeOut kubisch auf 0 oder 96 pt, nur nach Nutzergeste (1,5 s), Richtung aus 150 ms ≥ 4 pt, nicht bei Inhalt < 96 |

## Fenster und Seitenleiste

| Element | Web | Nativ | Status | Prio |
|---|---|---|---|---|
| Fenster ohne Titelzeile, Seitenleiste 303 + Linie | 4f gemessen | 4f | gleich | A |
| Marke „Orbit“ 18/28 600 | fade-in 300 ms beim Laden | umgesetzt in 4g | gleich ([4g-5](screens/mac4g-eingeklappt-dark.png)) | C |
| Knopf „Seitenleiste einklappen“ (28, rund, Hover sidebar-accent) | `SidebarTrigger` | umgesetzt in 4g | gleich ([4g-5](screens/mac4g-eingeklappt-dark.png)) | B |
| Eingeklappt: Leiste 48, nur Figuren (40, rund), Tooltip mit Namen rechts | `collapsible="icon"` | umgesetzt in 4g | gleich (Breite 72 wie gemessen; Suche und Geplant fehlen bis 4e) | B |
| Suche (Knopf + Dialog) | `SidebarSearch` | – | später 4e | – |
| „+“-Menü: Neuen Orbi erstellen / Gruppe erstellen (Symbole Plus, Users) | DropdownMenu, `align end`, Hover sidebar-accent rund | umgesetzt in 4g | gleich ([4g-5](screens/mac4g-eingeklappt-dark.png)) | A |
| „Geplant“-Zeile mit Zähler | Link `/geplant` | – | später 4e | – |
| Hauptorbi-Karte 279 × 146, r 18 | sidebar-accent 40 %, Hover 70 %, aktiv 100 %, Übergang 300 ms `(.32,.72,0,1)` | umgesetzt in 4g | gleich ([4g-5](screens/mac4g-eingeklappt-dark.png)) | A |
| Hauptorbi-Figur 64 + Stern | `live` (Körper folgt Zeiger, arbeitet) | umgesetzt in 4g | gleich ([4g-5](screens/mac4g-eingeklappt-dark.png)) | A |
| Zeit/„arbeitet…“ unter der Hauptkarte | „arbeitet“ + drei Punkte (je 1,2 s, versetzt 0,2 s, Deckkraft .25↔1) | umgesetzt in 4g | gleich ([4g-5](screens/mac4g-eingeklappt-dark.png)) | B |
| Gruppenbeschriftung „Chats“/„Gruppen“ | 32, 12/16 500, 70 % | 4f | gleich | A |
| Chat-Zeile 287 × 56 r 14 | Hover sidebar-accent 60 %, aktiv 100 % (Hover 70 %), Übergang 150 ms | umgesetzt in 4g | gleich ([4g-5](screens/mac4g-eingeklappt-dark.png)) | A |
| Zeile 2: Aufgabe oder „arbeitet…“ | Punkte animiert | umgesetzt in 4g | gleich ([4g-5](screens/mac4g-eingeklappt-dark.png)) | B |
| Rechtsklick auf Zeile/Karte | gibt es nicht | umgesetzt in 4g | nativ zusätzlich (Entscheidung 4g: Web-Dropdown-Stil, nur Aktionen des Webs) | B |
| Einstellungen-Knopf unten | `SettingsTrigger` (h-14, rounded-xl, Zahnrad + „Einstellungen“) | umgesetzt in 4d, öffnet das Einstellungsfenster (Cmd+,) | gleich ([4d](screens/mac4d-limit-dark.png)) | A |
| Leere Liste / Fehler / Offline | 4a-2, 4f | 4f | gleich | B |

## Chat-Kopf

| Element | Web | Nativ | Status | Prio |
|---|---|---|---|---|
| Groß/klein nach Scroll (p = Scroll/96) | `chat-header.tsx` | gleiche Formeln | gleich | A |
| Einrasten auf 0 oder 96 nach dem Loslassen | 300 ms easeOut, Regeln oben | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-kopf-dark.png)) | A |
| Kein Einrasten beim Panel-Umschalten (600 ms) und Breitenänderung (250 ms) | ja | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-kopf-dark.png)) | B |
| Figur im Kopf | nicht `live`: nur Pupillen folgen (Faktor 0,6), Blinzeln 4,4 s, kein Hüpfen | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-kopf-dark.png)) | A |
| Status-Ring um die Figur | keiner (nur Tooltip mit Zustand beim Überfahren, Fokus-Rahmen) | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-kopf-dark.png)) | A |
| Pille: Glas, Ring 10 %, Schatten sm | gemessen | `ultraThinMaterial` + glass | Plattformgrenze: Browser-`backdrop-filter` vs. macOS-Material, Farbe/Ring gleich | A |
| Pille Hover | Fläche foreground 6 % → 10 %, 150 ms | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-kopf-dark.png)) | A |
| Pille Klick | klappt das rechte Panel auf/zu | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-kopf-dark.png)) | A |
| Pille Tooltip | keiner (nur `aria-label`) | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-kopf-dark.png)) | C |
| Reduzierte Bewegung | Kopf fest klein | fest klein | gleich | B |

## Rechtes Panel (Bearbeiten)

| Element | Web | Nativ | Status | Prio |
|---|---|---|---|---|
| Panel rechts neben dem Chat | `ChatSidePanel`/`GroupSidePanel`, startet zu, gleitet 380 ms | umgesetzt in 4g | gleich ([4g-3](screens/mac4g-panel-dark.png)) | A |
| Breite 380 Standard, 25 %…520, Griff zum Ziehen, Breite gemerkt | `react-resizable-panels`, `localStorage` | umgesetzt in 4g | gleich ([4g-3](screens/mac4g-panel-dark.png)) | B |
| Segment-Reiter (Glas-Pille 32/36, Markierung gleitet 200 ms `cubic-bezier(0,0,.2,1)`) | Bearbeiten/Computer bzw. Gruppe/Computer | umgesetzt in 4g | gleich ([4g-3](screens/mac4g-panel-dark.png)) | A |
| Reiter Bearbeiten: Planet, Farbe, Name, Hauptorbi, Aufgabe, Verhalten | `BotForm`, Fuß zweispaltig: Löschen, Verlauf leeren, Abbrechen, Speichern | umgesetzt in 4g | gleich ([4g-3](screens/mac4g-panel-dark.png)) | A |
| „Aussehen anpassen …“ im Reiter | – | umgesetzt in 4g | nativ zusätzlich (Entscheidung 4g) | B |
| Reiter Gruppe: Name, Orbis mit Kästchen, Hover-Knöpfe Chat/Bearbeiten, Speichern (nur bei Änderung), Verlauf leeren, Gruppe löschen | `GroupSidePanel` | umgesetzt in 4g | gleich ([4g-3](screens/mac4g-panel-dark.png)) | A |
| Verlauf leeren mit Bestätigung | AlertDialog, `DELETE /v1/chats/:id/messages` | umgesetzt in 4g | gleich ([4g-3](screens/mac4g-panel-dark.png)) | A |
| Reiter Computer | Vorschau 16:9 (Skelett beim Laden, Fehler als Alert), Vollbild | – | später 4e (Lade-Fläche in 4g) | B |

## Verlauf

| Element | Web | Nativ | Status | Prio |
|---|---|---|---|---|
| Abstände, Breiten, Blasen | 4f gemessen | 4f | gleich | A |
| Neue Nachricht blendet ein | 300 ms ease-out, Deckkraft + 8 pt von unten | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-punkte-dark.png)) | A |
| Schreibblase | drei Punkte 4 pt, Abstand 3, je 1,2 s ease-in-out, Versatz 160 ms, hoch 3 pt, Deckkraft .35↔1 | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-punkte-dark.png)) | A |
| Aktionen unter der Nachricht | Kopieren (24, r 8, Ghost-Hover), bei Antworten zusätzlich Info; Deckkraft 150 ms | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-punkte-dark.png)) | A |
| Kopieren-Rückmeldung | Symbol wird 1,5 s zum Haken | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-punkte-dark.png)) | B |
| Info zur Antwort (Hover-Karte nach 100 ms: Modell, Stufe, Tokens, Dauer) | `InfoAction` | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-punkte-dark.png)) | B |
| „abgebrochen“ unter gestoppter Antwort | 11 pt muted | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-punkte-dark.png)) | B |
| Tokenschätzung beim Streamen („≈ N Tokens“, 11 pt) | ja | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-punkte-dark.png)) | C |
| Tooltip „Antwort kopieren“ | keiner | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-punkte-dark.png)) | C |
| Antwort-Figur 24 | nur Pupillen folgen, Blinzeln | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-punkte-dark.png)) | B |

## Karten (4b)

| Element | Web | Nativ | Status | Prio |
|---|---|---|---|---|
| Maße, Farben aller Karten | 4f gemessen | 4f | gleich | A |
| Knöpfe in Karten | Hover/Fokus/Gedrückt wie Knopfsatz | umgesetzt in 4g | gleich ([4g-2](screens/mac4g-chat-gross-dark.png)) | A |
| Aufklappen (Werkzeug, Übergabe, Jev) | `Collapsible` ohne Höhenanimation, Chevron dreht sofort | sofort | gleich | B |
| Jev-Block Lichtlauf (5 s) und Puls (2,4 s) | nur während Jev wählt | umgesetzt in 4d am Modellwähler (Auslöser-Symbol pulsiert, Kasten „Jev“ mit Lichtlauf; im Jev-Block selbst gibt es beides auch im Web nicht) | gleich ([4d](screens/mac4d-modell-auto-dark.png)) | C |
| Verfall-Zeile, „Alle Übergaben stoppen“ | – | – | nativ zusätzlich (4b) | B |

## Composer (Optik; Funktionen 4c)

| Element | Web | Nativ | Status | Prio |
|---|---|---|---|---|
| Rahmen, Höhen | 4f | 4f | gleich | A |
| Fokus | kein heller Fokus-Rand (`.chat-prompt`: Rand bleibt `input`, kein Ring) | umgesetzt in 4g | gleich ([4g-2](screens/mac4g-chat-gross-dark.png)) | A |
| Sendeknopf Hover/Gedrückt | primary 80 % / 1 pt tiefer | umgesetzt in 4g | gleich ([4g-2](screens/mac4g-chat-gross-dark.png)) | A |
| Antwortenden-Wahl (Gruppe) | Select-Auslöser 28, r 8, Rand input, Figur 16; Liste: Figur 24, Name + Aufgabe | umgesetzt in 4g | gleich ([4g-2](screens/mac4g-chat-gross-dark.png)) | B |
| Anhang, Freigabemodus, Kontext, Modell | Werkzeugzeile 32 × 32 / Auslöser 13/500 | umgesetzt in 4c | gleich ([4c](screens/mac4c-basis-dark.png)); Abweichungen in STATUS Block 4c | A |
| Slash-Menü, Modellpanel mit Stufen, Freigabemenü, Anhang-Chips | `slash-menu.tsx`, `model-picker.tsx`, `approval-mode-picker.tsx` | umgesetzt in 4c | gleich ([slash](screens/mac4c-slash-dark.png), [Modell](screens/mac4c-modell-liste-dark.png), [Modus](screens/mac4c-modus-dark.png), [Anhang](screens/mac4c-anhang-dark.png)) | A |

## Dialoge und Bestätigungen

| Element | Web | Nativ | Status | Prio |
|---|---|---|---|---|
| Orbi-/Gruppen-Dialog: Darstellung | zentriert über dem Fenster, Hintergrund schwarz 10 % + Unschärfe, 100 ms Zoom/Fade, Esc schließt | umgesetzt in 4g (`.blur(4)` in MainWindow, 10 % Schwarz, mittig, 100 ms) | gleich im Programm; Plattformgrenze im Standbild: die Unschärfe fehlt in den Screenshots, weil `NSHostingView.cacheDisplay` Core-Animation-Filter nicht zeichnet (Beleg: `Orbit --bildfolgen` meldet „ImageRenderer unscharf≠scharf true, cacheDisplay false“) ([Bild](screens/mac4g-dialog-orbi-dark.png)) | A |
| Schließen-X 28, Ghost-Hover muted 50 % | ja | umgesetzt in 4g | gleich ([4g-3](screens/mac4g-bestaetigung-dark.png)) | B |
| Löschen bestätigen | AlertDialog 384 breit, r 14, Titel 16/24 500, Text 14/20, Fuß muted 50 % mit Abbrechen (Umriss) + Aktion (destruktiv) | umgesetzt in 4g | gleich ([4g-3](screens/mac4g-bestaetigung-dark.png)) | A |
| Fehler beim Löschen | Inline-Alert im Dialog | umgesetzt in 4g | gleich ([4g-3](screens/mac4g-bestaetigung-dark.png)) | B |
| „Eigene Farbe“ im Farbraster | Browser-Farbwähler | entfällt, Feinwahl im Reiter Aussehen | Plattformgrenze: kein Browser-Farbwähler; nativer Ersatz über Regler | C |

## Steuerelemente

| Element | Web | Nativ | Status | Prio |
|---|---|---|---|---|
| Knopf primär (32, r 10, 14/500, Innenabstand 10) | Hover primary 80 % | umgesetzt in 4g | gleich ([4g-2](screens/mac4g-menue-plus-dark.png)) | A |
| Knopf Umriss | Rand input, Fläche input 30 % (dunkel), Hover input 50 % / hell muted | umgesetzt in 4g | gleich ([4g-2](screens/mac4g-menue-plus-dark.png)) | A |
| Knopf sekundär | Hover +5 % Vordergrund | umgesetzt in 4g | gleich ([4g-2](screens/mac4g-menue-plus-dark.png)) | A |
| Knopf Ghost | Hover muted (dunkel muted 50 %) | umgesetzt in 4g | gleich ([4g-2](screens/mac4g-menue-plus-dark.png)) | A |
| Knopf destruktiv | destructive 10 % (dunkel 20 %), Hover 20 % / 30 % | umgesetzt in 4g | gleich ([4g-2](screens/mac4g-menue-plus-dark.png)) | A |
| Knopf klein (28, r 8, 12,8) | `size sm` | umgesetzt in 4g | gleich ([4g-2](screens/mac4g-menue-plus-dark.png)) | B |
| Symbolknopf (32/28/24, r 10/8/8) | Ghost | umgesetzt in 4g | gleich ([4g-2](screens/mac4g-menue-plus-dark.png)) | B |
| Fokusring (Tastatur) | 3 pt ring 50 % | umgesetzt in 4g | gleich ([4g-2](screens/mac4g-menue-plus-dark.png)) | B |
| Schalter 32 × 18,4, Daumen 16 | aus: input 80 %, Daumen foreground (dunkel) / background (hell); an: primary, Daumen primary-foreground; 150 ms | umgesetzt in 4g | gleich ([4g-2](screens/mac4g-menue-plus-dark.png)) | A |
| Kästchen 16, r 4 | Rand input, dunkel input 30 %; an: primary mit Haken 14 | eigenes Kästchen (4f) | gleich | B |
| Regler (Aussehen) | – (Web hat den Reiter nicht) | macOS-Regler | nativ zusätzlich (4a-2), Optik an Web-Slider angleichen | C |
| Segment (Augenform, Zubehör) | – | macOS-Segment | nativ zusätzlich (4a-2), Optik an Web-Reiter angleichen | C |
| Eingabefeld 32, r 10 | Fokus: Rand ring + 3 pt ring 50 % | umgesetzt in 4g | gleich ([4g-2](screens/mac4g-menue-plus-dark.png)) | B |
| Dropdown-Menü | Fläche popover, r 10, Innenabstand 4, Schatten md, Ring 10 %; Zeile 28, r 8, Innenabstand 4/6, Symbol 16, Abstand 6; Hover accent; destruktiv rot mit 10 %/20 % | umgesetzt in 4g | gleich ([4g-2](screens/mac4g-menue-plus-dark.png)) | A |
| Tooltip | siehe Grundwerte | umgesetzt in 4g | gleich ([4g-2](screens/mac4g-menue-plus-dark.png)) | B |
| Popover (Kopf) | – | umgesetzt in 4g | gleich ([4g-2](screens/mac4g-menue-plus-dark.png)) | A |

## Figuren und Bewegung

| Element | Web | Nativ | Status | Prio |
|---|---|---|---|---|
| Zeigerfolgen Seitenleiste (`live`) | Stärke tanh(d/160), Körper 2, Kippen 3°, Gesicht 4,5, Pupille 2,25, Schatten −1 (bei 58 pt), Glättung je Orbi 0,09…0,2, Stärke je Orbi 0,5…1,1, nach 3 s Ruhe zurück zur Mitte | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-wippen-dark.png)) | A |
| Zeigerfolgen sonst (Kopf, Blasen, Dialog) | nur Pupillen, Faktor 0,6 | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-wippen-dark.png)) | A |
| Blinzeln | fest alle 4,4 s (94–97 %, Augenhöhe 6 %) | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-wippen-dark.png)) | B |
| Arbeitet | `orbi-bob` 4 s, `orbi-shadow-pulse` 4 s, `orbi-scan` 7,3 s, `orbi-look-up` 11,7 s, alle ease-in-out, Tempo je Orbi 0,85–1,25, Phase bis −3 s; Blick folgt nicht | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-wippen-dark.png)) | A |
| Fertig | `orbi-done` 0,6 s ease-out einmal (−7 pt hoch, quetschen) | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-wippen-dark.png)) | B |
| Wartet / Fehler / Limit | keine eigene Bewegung | umgesetzt in 4g | gleich ([4g-4](screens/mac4g-folge-wippen-dark.png)) | B |
| Reduzierte Bewegung | keine Animationen, Blick fest | gleich | gleich | B |

## Einstellungen (Block 4d)

Web-Vorlage `components/settings/*` (Dialog 768 × 576, Kopfzeile 45, Reiterleiste 192). Nativ: eigenes Fenster (Cmd+, und Knopf in der Seitenleiste), Inhalt 768 × 531 unter der Systemtitelzeile. Bilder: Web links, nativ rechts, `screens/mac4d-<reiter>-<dark|light>.png`; Sonderzustände nur nativ (`mac4d-<reiter>-<leer|laedt|fehler|offline|lang>`).

| Element | Web | Nativ | Status | Prio |
|---|---|---|---|---|
| Fenster | Dialog mit Kopfzeile „Einstellungen“ und Schließen-Knopf | macOS-Fenster (Systemtitel, Ampelknöpfe), Cmd+, | Plattformgrenze: Fensterrahmen liefert macOS | A |
| Reiterleiste (8 Reiter, Symbol 16, aktiv secondary) | `Button` secondary/ghost | gleich, SF-Symbole statt Lucide | gleich (Symbolform: Plattformgrenze) | A |
| Nutzung | Karte je Anbieter, Balken je Fenster (ab 80 % rot), „Reset in …“ | gleich; dazu Wochenprognose „Schätzung: …“ unter dem 7-Tage-Balken, fehlende Daten „unbekannt“ | gleich + nativ zusätzlich (4d: Prognose) | A |
| Jev | zwei Schalter, Protokoll (aufklappbar, 50 Einträge) | gleich | gleich | B |
| Orbis-Anleitung | Textfeld wächst mit dem Inhalt | Feld fest 256 hoch, scrollt innen | abweichend (SwiftUI-TextEditor wächst nicht): bewusst | B |
| Skills (Liste, Formular, löschen) | `window.confirm` zum Löschen | Bestätigungsdialog im Fenster | gleich (Dialog statt Browserfenster) | B |
| Konnektoren | hinzufügen, testen, Schalter, Bearbeiten-Dialog, Anmeldung per Popup | gleich; Anmeldung im Systembrowser, Rücksprung `/oauth/callback`, danach Neuprüfung beim Zurückwechseln | gleich (Popup → Systembrowser: Plattformgrenze) | B |
| Freigaben | Regel als „tool · Orbi · allow“ | „Erlaubt/Fragen/Verboten“ auf Deutsch | abweichend: deutsch statt Rohwert, bewusst | B |
| Marktplatz | Karten mit Rechten, „Installieren“ | gleich | gleich | B |
| Darstellung | System/Dunkel/Hell, sofort | gleich (`NSApp.appearance`), wird beim Start geladen | gleich | B |
| Limit-Zustand der Figur | Text „Kann gerade nicht weiterarbeiten“ | „wartet bis 14:30 Uhr“ (Zeile in der Seitenleiste, Tooltip am Kopf) aus `/v1/usage`; ohne bekannte Zeit „Limit erreicht, wartet“ | nativ zusätzlich (4d) | B |
| Rollbalken | Browser-Rollbalken (hier 17 pt Platz) | Systemrollbalken (Overlay, kein Platz) | Plattformgrenze | C |
