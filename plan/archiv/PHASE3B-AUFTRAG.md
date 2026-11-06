# Phase 3, Korrektur (Auftrag)

Stand 01.11.2026. Consti hat Phase 3 gesichtet und verlangt diese Änderungen. Sie ersetzen, wo sie abweichen, `plan/PHASE3-AUFTRAG.md`. Regeln wie dort (AGENTS.md, CODING.md, kein Install, keine echte DB, kein Push, nie rm -rf, kleine deutsche Commits ohne E-Mail und ohne Co-Authored-By, `plan/DESIGN-SYSTEM.md` und Bilder in `plan/design/` sind für Optik verbindlich).

## Änderungen
1. **Statusleiste nicht blau.** Sie folgt dem Figma-Design „Live-Zeile / Live-Statusleiste“ (`plan/design/02-schritt2-chat/teil-3-…`, `teil-12-…`, `04-schritt4-karten/teil-7-…`, Maße in DESIGN-SYSTEM.md 7.1: Regular 13, Farbe „fest“, Zustände arbeitet/wartet/Fehler/fertig, Text wechselt weich). Blau bleibt **nur** für die Status-Punkte in der Seitenleiste. Im Code alle blauen Akzente der Live-Zeile entfernen.
2. **Reaktionen nach Figma:** „Chat Reaktion“ und „Chat Blase mit Reaktion“ (Bilder `teil-8-reaktion.png`, Maße DESIGN-SYSTEM.md; Position, Form, Zahl bei mehreren, Menü offen/zu). Die bisherige Abweichung (Pille unter der Blase) beseitigen, exakt Figma.
3. **Karten nach Figma** (Schritt 4 – Karten & Dialoge, `plan/design/04-schritt4-karten/`): Dateikarte, Freigabe-, Auswahl- und Übergabe-Karten, Link-Karte. Vorhandene Karten gegen die Bilder und Maße prüfen und angleichen.
4. **Kein Regler für die Antwortlänge.** Immer kurz. Entfernen: Einstellung in der App, `replyLength`, Spalte-Nutzung/Endpunkte `PUT /v1/settings/reply-length` (Migration 0006 bleibt, Spalte wird ignoriert, nicht droppen), Prompt-Stufen normal/lang. Der Prompt enthält fest die Kurz-Zeile (Ergebnis zuerst, meist 1–5 Zeilen, Details auf Nachfrage).
5. **Werkzeuge werden in der App gar nicht mehr angezeigt:** keine Tool-Karten, keine „N Schritte · X s ›“-Zusammenfassung, keine aufklappbaren Details, keine Einstellung „Schritte immer ausklappen“. Sichtbar bleiben: Nachrichten, `say`-Blasen, Reaktionen, Live-Zeile (nur während der Arbeit), Freigabe-, Auswahl-, Datei-, Bild-/Bildschirm- und Übergabezeilen (Orbi-Nachrichten). Fehler/Wiederholung: nur als kurze Systemzeile, wenn der Orbi es erneut versucht („Versuche es erneut …“) oder Consti etwas tun muss („Bitte … erlauben/verbinden“). Der Dienst liefert dafür einen kompakten Hinweis (Event/Teil), Formulierungen kurz und ohne Technikbegriffe.
6. **Onboarding neu gedacht:**
   - Der **erste Orbi (Hauptorbi)** wird im vorhandenen Bildschirm angelegt (Onboarding 1–6, Figma) und führt danach das Onboarding im Chat: 1–2 Fragen (Auswahlkarte mit Empfehlung) zu Consti und seinen Zielen, schlägt daraus **Connectoren** vor (nur aus dem, was Orbit heute anbinden kann; echte Verbindung bleibt Phase 6, bis dahin Vorschlag mit klarer Aussage) und **1–3 Orbis** (Name, Aufgabe, Farbe/Form); Consti wählt auf einer Karte aus, der Hauptorbi legt die gewählten **direkt an** (Werkzeug, nur im Onboarding und nur nach der Auswahl, kein ungefragtes Anlegen).
   - **Jeder neu erstellte Orbi** stellt sich passend zu Name und Aufgabe in einem Satz vor, stellt 1–2 kurze Startfragen (Auswahlkarte, Empfehlung) und schlägt, wenn sinnvoll, seine erste Aufgabe vor. Antworten fließen in seine Anweisung. Überspringbar, nur einmal (Flag besteht schon).
   - Bestehende Abläufe aus Phase 3 Lauf A (`onboarding_finish`, Flag, Skip-Endpunkt) wiederverwenden und anpassen, nicht doppeln.
7. **Kritische Prüfung gegen Grok Bot** (eigener Review-Lauf, nur lesen und berichten): siehe unten.

## Aufteilung (nie zwei Modelle an denselben Dateien)
- **Lauf C (Dienst, TypeScript):** Punkte 4 (Dienstseite), 5 (Hinweis-Event/Teil für Wiederholung und Aktion, `say`/Fehlertexte kurz), 6 (Prompt, Tools, Hauptorbi-Onboarding, Orbi-Onboarding mit erster Aufgabe), `plan/API.md`, `plan/STATUS.md`, Tests. Keine Swift-Dateien. Danach `npm run check` grün.
- **Lauf D (Mac, Swift):** Punkte 1, 2, 3, 4 (App), 5 (Anzeige), 6 (Anzeige/Ablauf nach dem Anlegen des ersten Orbi: Onboarding-Chat starten, Überspringen), Tests (`xcodebuild test` unsigniert, DerivedData im Scratchpad, danach nach `~/.Trash`). Keine Dienst-Dateien. Dienst-Änderungen aus Lauf C (z. B. fehlende `replyLength`) tolerieren (Felder optional lesen).
- **Review-Lauf (nur lesen):** vergleicht die Umsetzung (Phase 1–3) mit Grok Bot und den Analyse-Berichten und liefert eine priorisierte Mängelliste, ohne Dateien zu ändern.

## Definition of Done
Tests grün, Abnahme im Code per Test, Rest als „nicht geprüft“ in `plan/STATUS.md` („Phase 3 Korrektur“), lokal committet, nicht installiert.
