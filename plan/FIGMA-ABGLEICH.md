# Figma-Abgleich (Schritt 0, 03.11.2026)

Live per FigCli gelesen, nur lesend, nichts in Figma geändert. Datei „Ohne Namen“, Seiten Grundlagen und Endcheck. Alle Frame-IDs aus dem Plan sind vorhanden.

| Bereich | Figma | DESIGN-SYSTEM.md | Ergebnis |
|---|---|---|---|
| Tag „Wartet“ (6:13962) | Grund #f2f2f4, Text #18181b, Punkt #ea580c | status/caution #ea580c | passt |
| Hover-Leiste (26:10742) | nur Kopieren + Info (2 × 24 pt, 50 × 24) | D21/L8: Emoji, Kopieren, drei Punkte, Antworten rechts | weicht ab (D21 ist neuer) |
| Lage Aktionen (26:10863) | Antwort: rechts der Blase; Eigene: links der Blase | F14 offen | Figma zeigt Aktionen auch an eigenen Nachrichten (links) |
| Blasenbreite | kein maxWidth; mehrzeilige Blasen 468 (Text 440); Bildschirm 1 max. 348; Chatspalte 640 | layout/bubble-max 560 pt | weicht ab, 560 nicht in Figma belegt |
| F10 Filter-Chips (50:18264) | Bibliothek/Dateien-Panel unter „Dateien suchen“, über der Dateiliste: Alle (Haken), Bilder, PDFs, Dokumente; 24 hoch | Liste Filter-Chip 54 × 24, r12, Rand 0,5 | Ort geklärt |
| Chips Marktplatz (192:18885) | unter „Dienste suchen“: Alle/Produktivität/Kommunikation/Entwicklung/Verbunden; 31 hoch, keine Instanzen | 24 hoch | weicht ab |
| Einstellungen/Marktplatz (192:18885, Dunkel 192:19039) | Navi: Allgemein, Darstellung, Orbis, Marktplatz, Verbindungen; Dienstkarten, „Verbindungen verwalten →“ | F13 | Name „Marktplatz“ bestätigt; „Verbindungen“ eigener Punkt, kein Nutzung/Jev in dieser Navi |
| Einstellungen Nutzung (141:44979, 143:54295) | Vorlage vorhanden: normal / ab 80 % / Laden / Offline / Fehler | D12 „ohne Figma-Vorlage“ | weicht ab, Vorlage existiert; Sets doppelt (141:* und 143:*) |
| Animationen (147:59236) | Stelle 1–9; Werte idle 9°, arbeitet 1,67 s, wartet ±5/6,7 s, fertig Saltos 26/0,62 s | §9 | passt; mehrere Platzhalter „folgt nach dem Probestück“, keine Fehler-/Limit-Animation |

## Entscheidungen (03.11.2026, 16:27)

- **Blasenbreite:** Figma-Werte gelten: max. 468 pt (Text 440), nicht 560.
- **Hover-Leiste (Consti 16:31):** Bei eigenen Nachrichten links neben der Blase wie in Figma (26:10863), Reihenfolge Emoji, Kopieren, Antworten. Bei Orbis rechts neben der Blase, mit Info-Punkten (drei Punkte, Token-Verbrauch).
- **Nutzung:** Die Figma-Vorlage „Einstellungen Nutzung“ gilt. Von den doppelten Sets gilt 143:54295 (5 Zustände: normal, ab 80 %, Laden, Offline, Fehler; 278 Knoten). 141:44979 ist die ältere Fassung (4 Zustände, ohne „ab 80 %“).
- **Einstellungen (D12, Consti 16:31):** EIN Bereich „Marktplatz“ mit allem drin, auch den Konnektoren. Der Figma-Punkt „Verbindungen“ (192:18885) fällt weg. Navigation: Allgemein, Nutzung (wie Vorlage 143:54295), Darstellung, Orbis, Marktplatz. Jev ist raus.
- **Auswahl Seitenleiste (D05, 16:29):** Der geöffnete Chat hat einen grauen Kasten, auch beim Hauptorbi. Ohne Kasten ist der Hauptorbi nur, wenn sein Chat nicht geöffnet ist. Umsetzung in Schritt 11.

## Werte je Schritt (für Codex)

Live per FigCli gelesen am 03.11.2026, nur lesend. Maße in pt, Farben Hell. „nicht in Figma“ heißt: in den gelesenen Knoten nicht vorhanden, nicht erfunden. Bei doppelten Sets gilt der Block ohne „alt“ im Namen.

### 6 / 20 · Posen und Animationen (Posen 145:58794, Animationen 147:59236)

- Grundstil laut 147:59236: ease-in-out, Blickwechsel alle 1,2–2,5 s, Blinzeln alle 2,5–4 s. Andere Kurven (Feder, Bezier-Werte): nicht in Figma.
- idle: Neigung 9°, Blick links oben (Code −0,8/−0,85 × 1,5), komplett still, kein Blinzeln, kein Atmen.
- selected: Blick nach vorne, wechselt lx ±0,2–0,35 (kein Hoch/Runter), Übergang 0,7–0,9 s, alle 1,2–2,5 s, Neigung lx·3°, blinzelt alle 2,5–4 s.
- working: wippt, Periode 1,67 s; Blickwechsel alle 1,2–2,5 s weich (0,55–0,8 s); Augen 0,94–1,10×; bei 8 s Sprung mit Drehung, bei 18 s Rückwärtssalto (je 0,95 s). Live-Zeile: Orbi 20 px, Text schimmert.
- waiting: Wiegen ±5, Periode 6,7 s, Neigung ±2,5°, Blick lx ±0,9, keine Hüpfer, blinzelt nicht. Punkt orange (status/caution).
- done: ducken, Salto 26 hoch 0,62 s, ducken, Salto 32 hoch 0,75 s, 18 Sterne, wackeln; ab 2,3 s Augen 1,2×, blauer Punkt, Hüpfer 9 hoch alle 1,3–1,9 s; blinzelt nicht.
- Maus folgen (Chat-Kopf, Panel-Orbi, Leerzustand): Stärke tanh(Abstand / (Breite · 1,4)) × 1,5, Neigung lx·5°, Rückkehr nach links oben weich in 1,6 s.
- Größen je Stelle: Seitenleiste 40, Live-Zeile 20, Nachricht 24 (still), Panel rechts 72, Leerzustand 56 (folgt Maus, blinzelt 2,5–4 s), @-Liste 20 (still), Bearbeiten-Menü still.
- Fehler- und Limit-Animation: nicht in Figma.
- Widerspruch in Figma: Posen 145:58794 sagt bei Ruhe „atmet leicht, blinzelt alle 2–4 s“ und bei Wartet „blauer Punkt (im Code noch orange)“; Animationen 147:59236 sagt „komplett still“ und „orangener Punkt“. Animationen ist der neuere Stand.

### 8 · Breiten (Bildschirm 1 148:90553 → 148:90569)

- Fenster 1281 × 1011, r16. Seitenleiste 240 (Innenabstand 10), Chatbereich 720, rechtes Panel 320 (Innenabstand 16).
- Chatbereich Innenabstand 16/40/24/40 → Spalte 640. Kopf 47 hoch, darunter 8 Abstand.
- Blase: kein maxWidth; mehrzeilig 468 (Text 440), in Bildschirm 1 max. 348 (Antwort-Zeile). Eigene Blase #8152eb (Dunkel #8558ee), Innenabstand 10/14.
- Abstand zwischen Zeilen 2, zwischen Sprecherwechseln 10, Verlauf wächst nach unten.
- Eingabeleiste 26:11822: 640 breit (volle Spalte), 40 hoch, r24, weiß, Innenabstand 8/10, gap 8; mehrzeilig 92 hoch r20. 12 Zustände (leer, getippt, mehrzeilig, Plus-Menü, @-Menü, @ gefiltert, Orbi markiert, mit Anhängen, läuft, offline, Fehler, deaktiviert). Abstand Verlauf → Eingabe 12.
- Seitenrand: kein eigener Wert außer den Innenabständen oben.

### 9 · Kopf-Pille (Chat-Kopf 140:41631, Lage 140:41688)

- Höhe 47, r999, Fläche #111111 6 % (Hover 10 %; Dunkel #ffffff 6 %), Rand #111111 10 % 0,5.
- Innenabstand 7/24/7/12, Hover 7/12/7/12 mit chevron-right 12; gap 10; Avatar 32; Name 15 Semi Bold #18181b.
- Gruppe: Avatar-Stapel 32 (3 × 17), bei 6 Orbis je 26, gap −6.
- Lage: oben mittig in der 640er Spalte (Bildschirm 1: y 16 im Chatbereich).
- Blur/Material: nicht in Figma (keine Effekte gesetzt).

### 10 · Fragekarte (139:39452, Set Fragebogen 139:39919)

- Karte 520 breit, weiß, r12. Kopf Innenabstand 16/16/8/16: Frage 22 hoch #18181b, darunter „Eine Antwort auswählen“ 15 hoch #65656d; rechts Blättern 97 × 24 („1 von 3“, Pfeilknöpfe 24 × 24).
- Antworten Innenabstand 0/8/4/8; Zeile r8, Innenabstand 10/8, gap 12; Nummer 24 × 24 r6 #f2f2f4, gewählt #8152eb (in Gruppe #18181b).
- Trennlinie 1 #e8e8eb; Fuß 44 hoch, Innenabstand 10/16, gap 8: „Etwas anderes …“ #65656d, Knöpfe 24 hoch r999 „Überspringen“ (Rand) und „Weiter“ #8152eb weiß.
- Ältere Fassung 143:52074 („alt“, 360 breit, Liste mit Haken) nicht verwenden.

### 11 · Seitenleiste (Seitenleiste-Orbi 26:10956, Tag 6:13962)

- Zeile 220 × 60, r12, Innenabstand 0/10, gap 10, Avatar 40, Name 13 Medium #18181b, Vorschau 12 #65656d.
- Status-Punkt 12 × 12 mit Rand #fafafa 2: fertig #2563eb, Frage/wartet #ea580c, Fehler #dc2626, pausiert #ca8a04. Neu-Punkt 8 × 8 #3378ec.
- Tag „Wartet“: Pille 20 hoch, #f2f2f4, Punkt 6 × 6 #ea580c, Text 11 #18181b. Fertig-Tag #2563eb, Fehler #dc2626.
- Hover #e8e8eb. Grauer Kasten geöffnet: Komponente #111111 2 %, in Bildschirm 1 (148:90585) #111111 15 % (Dunkel #ffffff 15 %). Widerspruch in Figma; der Bildschirm ist der sichtbare Stand.

### 16 · Nutzung (143:54295, Zustand normal 143:54296)

- Fenster 768 × 532, r12, #fafafa; Titelzeile 28 „Einstellungen“ 13 Semi Bold.
- Navi 192 breit, Innenabstand 12, gap 2; Einträge 168 × 32 r8, Innenabstand 0/10, gap 8; gewählt #f2f2f4. Figma-Reihenfolge: Allgemein, Nutzung, Orbis-Anleitung, Skills, Konnektoren, Freigaben, Marktplatz, Darstellung (gilt nicht, siehe D12 oben).
- Inhalt Innenabstand 24, gap 16; Kopf 24 mit „Aktualisieren“ 97 × 24 r999.
- Box je Anbieter 527 breit, weiß, r10: Kopf 40 (Logo 20 r6 #f2f2f4), Zeilen „5 Stunden“ und „7 Tage“ je 77 (Innenabstand 10/12/12/12): Kopf 20 mit Prozent, Spur 6 hoch r3 #d4d4d8, Füllung #18181b, Text „Setzt um … zurück.“ 12 #65656d.
- ab 80 %: Füllung #dc2626, Zusatz „Bei gleichem Tempo am Sonntag aufgebraucht.“ bzw. bei 100 % „Aufgebraucht. Setzt am … zurück.“
- Laden: Platzhalter. Offline: „Dienst nicht erreichbar“ + „Erneut laden“. Fehler: „Konnte nicht geladen werden“ + „Erneut laden“. Karten 460 breit, Innenabstand 20, gap 16.
- In Figma steht noch „Jev“ im Kopf (Jev ist laut D12 raus).

### 17 · Chat-Bausteine

- Link-Karte 26:10326: 24 hoch, r8, gap 4, Icon 14, Text 14/lh22 #1d4ed8, Pfeil 11 (versteckt). Zustände normal, hover, in Blase, in Blase hover; Unterschied hover: nicht in Figma lesbar.
- Zeitstempel 26:10969: 640 × 29, Innenabstand 8/0, Text 11 Medium #65656d mittig. Formen „Heute 14:32“, „Gestern …“, „Mo., 26. Okt. 18:05“, „12. Sept. 2026, 11:20“. Trennlinie: nicht in Figma.
- Filter-Chip 50:18264: 24 hoch, r12, Rand #e8e8eb 0,5, Innenabstand 0/10, gap 4, Text 12 #18181b; hover #e8e8eb; gewählt #111111 15 %, Medium, Haken 11. Ort: Bibliothek/Dateien unter „Dateien suchen“.
- Fehler 143:52194: Zeile (keine Karte) 26 hoch, Innenabstand 4/0, gap 8, circle-alert 14 #dc2626, „Antwort fehlgeschlagen.“ 13/lh18 #dc2626, „Erneut versuchen“ 13 Medium #18181b; „Versucht erneut …“ mit Loader #1d4ed8, Text #65656d.
- Automation-Lauf 143:52156: Zeile 13/lh18, gap 8: läuft (Loader #1d4ed8, „Morgenbriefing läuft …“ #65656d), fertig (Haken #1d4ed8, „Morgenbriefing · 07:02“), Fehler (rot + „Erneut versuchen“).
- Unterbrochen: nicht in Figma.

### 18 · Nachricht-Aktionen (26:10863, Leiste 26:10742)

- Leiste 50 × 24, gap 2, Knöpfe 24 × 24 r6, Icons 13; Abstand zur Blase 6.
- Eigene: links der Blase; Antwort: rechts. Zustände normal (Deckkraft 0), hover, kopiert; Knopf-Hover #e8e8eb.
- In Figma nur Kopieren und Info. Emoji und Antworten: nicht in Figma (Entscheidung 16:31 gilt).

### 21 · Freigabe-Karte als Grundlage (145:58610)

- Karte 360 breit, weiß, Rand #e8e8eb 0,5, r12, Innenabstand 14, gap 12. Text 14/lh20 #18181b.
- Knöpfe 24 hoch r999, gap 8, Innenabstand 0/12: „Erlauben“ #8152eb, „Immer erlauben“ #8152eb 16 %, „Ablehnen“ mit Rand. In Gruppe: #18181b und #f2f2f4.
- Ergebnis: Zeile 18 hoch, gap 6, Icon 14, Text 13/lh18 #65656d: „Einmal erlaubt“ (check), „Immer erlaubt“ (check), „Abgelehnt“ (x), „Abgelaufen“ (history).
- Entwurf, Betrag, Geheimnis: nicht in Figma (nur Freigabe als Vorlage).

### 23 · Onboarding, Dialoge, Plan-Hinweis, Befehlsmenü

- Onboarding 164:116621, Dunkel #161618, Rand #38383a 0,5, je 1281 × 1011 r16: 1 Willkommen 164:116925, 2a Orbi gestalten 164:116939, 3 Mac-Zugriffe 169:124780, 4 Dienste 169:124831, 5 Abschluss 214:29476, 6 Ziel nach dem Flug 214:28063. 2b ist „alt“ und versteckt.
- Dialog Löschen 141:48396: 384 breit, weiß, Rand #111111 10 % 0,5, r16; Inhalt Innenabstand 16/16/20/16, gap 8, Titel 16 Medium/lh20, Text 14/lh20 #65656d; Fuß 57 #f2f2f4, Innenabstand 16, gap 8; „Abbrechen“ mit Rand, „Löschen“ weiß mit Rand #dc2626 0,5. Zustände Orbi löschen, Skill löschen, Verlauf leeren, löscht … (Knöpfe 50 %), Fehler.
- Dialog Neuer Skill 143:56253: 448 breit, r16; Kopf Innenabstand 16/44/20/16, Schließen 28 × 28 r8; Felder Name, Beschreibung, Anleitung (gap 20); Fuß wie oben, „Anlegen“ #18181b (leer 40 %). Zustände leer, voll, Fehler.
- Plan-Hinweis 143:56663: 560 × 45, weiß, Rand 0,5, r12, Innenabstand 10/12, gap 12, Icon clipboard-list 16, Titel 14 Medium „Plan bereit · 4 Schritte“, Unterzeile 12 #65656d; „Ansehen“ (Rand), „Ausführen“ #b934d5 weiß; Zustand gesperrt „Lumi plant noch. Ausführen geht danach.“
- Befehlsmenü 143:56735: 384 breit, weiß, Rand #111111 10 % 0,5, r12, Innenabstand 6, gap 2; Zeile 32 r8, Innenabstand 6/8, Name 14 Medium, Beschreibung 12 #65656d (versteckt); gewählt #f2f2f4; Trenner 1 #e8e8eb. Zustände normal, Brain offline (wifi-off, „Brain offline“), lädt (Platzhalter #f2f2f4 r6), leer („Kein Skill passt zu …“ + „Neuer Skill“).
