# CODING.md, Orbit

Gilt bei Coding-Aufgaben für jede KI (Orbis: `read_coding_rules`). Ergänzt `AGENTS.md`.
Aufbau: `mac/` SwiftUI-App, `service/` orbitd (Node, SQLite, Port 4317), `lib/` gemeinsamer Code.

## Start
- Nur lokal: kein GitHub, kein Remote, kein `git push`.
- Backup nur vor großen Änderungen (neue Funktion, DB-Änderung, Umbau) nach `~/Projekte-Coding/Backups/Orbit/<JJJJ-MM-TT_HH-MM>/` (ohne `node_modules`, Build-Ordner).
- Erst `git status`. Fremde offene Änderungen nicht anfassen, nicht mitcommitten. Nur eigene Dateien stagen (`git add <datei>`, nie `-A`).
- Nur nötige Dateien lesen, sonst gezielt suchen.
- Plan bei großen Aufgaben: nummerierte Schritte mit Dateien und Prüfung.
- Nie zwei Agenten an denselben Dateien.

## Lange Aufgaben
- Nach „Start“, vor dem Coden: oben in `plan/STATUS.md` Abschnitt `## Laufend: <Aufgabe> (<Datum>)` mit Schritten als `- [ ]`. Keine Plan-Datei woanders.
- Schritte nacheinander. Nach jedem sofort abhaken (`- [x]`, Nachweis), dann der nächste, bis zum letzten.
- „mach weiter“ oder neue Sitzung: zuerst „Laufend“ in `plan/STATUS.md` lesen, mit `git status` abgleichen, beim ersten offenen Schritt weiter. Kein neuer Plan, kein neues „Start“.
- Am Ende wird „Laufend“ zum Abschnitt mit Datum und Ergebnis.

## Ohne Freigabe
- Im Repo ändern, Tests, Builds, lokale Commits, Backups. Alte Backups nie löschen.
- `scripts/install.sh --ohne-start` (App ersetzen, Dienst einrichten). Nur diese Option.
- Schlüsselbund lesen, wenn nötig. Test-Einträge unter eigenem Dienstnamen, danach aufräumen.
- Dateien unter `/tmp` löschen.

## Freigabe nötig
- Verlauf umschreiben.
- `secrets.env`, `.env*` lesen. Echte Keys anlegen oder ändern.
- Systemänderungen außer `install.sh`.

## Prüfen
- Je Schritt nur der passende Test. Am Ende einmal `npm run check`, bei Swift dazu `xcodebuild test`.
- Fehler: beheben, einmal neu prüfen. Gleicher Fehler zweimal: anderer Ansatz oder Backup zurück. Keine Testserien.
- Tests unsichtbar und stumm, nur gegen Kopien in `/tmp`.
- SQLite vor jeder Migration sichern.
- Melde nur, was Test oder Build belegt.

## Oberfläche
- Neue Orbi-Fähigkeit: erst als Skill-Datei, im Turn-Log Prompt-Zeichen vorher/nachher nennen.
- Alles Visuelle (Farben, Abstände, Schrift, Bausteine, Bewegung) richtet sich nach `plan/DESIGN-SYSTEM.md`. Keine festen Werte in Views, nur `Theme`. Neues Element: erst dort prüfen, ob es einen Baustein gibt.
- Im Chat erscheinen nie Tool-Aufrufe, Tool-Ergebnisse, interne Tags oder Rohdaten (Consti, 04.11.2026). Ein Filter im CLI-Parser (`lib/cli/tool-protocol.ts`) räumt vor Anzeige und Speichern auf, auch über Chunk-Grenzen und bei ungeschlossenen Tags; neue interne Tags dort eintragen, mit Test.

## Fertig
- Fertig = alle Schritte abgehakt, Tests grün, lokal committet. Einzeländerungen sofort installieren; große Umbauten (Phasen, Pakete) erst komplett fertig bauen, dann in einem Zug installieren (Consti, 03.11.2026). Danach per Selbsttest der App geprüft, ohne sichtbares Fenster.
- Orbis: vor `install.sh` einen Zwischenstand senden.
- Commits klein, deutsch, „Bereich: was“. Keine E-Mail-Adressen, keine Co-Authored-By-Zeile.
- Stand im Brain: die eine Stand-Zeile in `02 Projekte/Orbit/Orbit.md` aktualisieren (alte ersetzen, nicht stapeln), Phasenstand im Umsetzungsplan. Keine Git-Befehle im Brain.
