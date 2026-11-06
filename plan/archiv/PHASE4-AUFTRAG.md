# Phase 4: Kontext-Management und Gedächtnis (Auftrag)

Stand 02.11.2026. Grundlage (Pflichtlektüre für jeden Lauf, im Brain `07 Anhänge/Orbit/Analyse Kontext 2026-11-02/`): `01-leaks-kontext.md`, `02-web-kontext.md`, `03-orbit-ist.md` (Ist-Analyse mit Einbaupunkten E1–E16 und Messwerten). Dazu `Second Brain/02 Projekte/Orbit/Umsetzungsplan Orbit.md` (Phase 4, Token-Regeln) und `Orbit Fähigkeiten-Vorschlag 2026-11-01.md`.

## Entscheidungen von Consti (02.11.2026)
1. **Jev bleibt Entscheider, kein Textmodell.** Zusammenfassen, Gedächtnis-Extraktion, Träumer laufen mit Haiku direkt über den Proxy (`generateText(proxy.chat("claude-haiku-5-5"))`). Verlauf und Gedächtnis gehen nie an OpenRouter.
2. **Start klein, hochstufen oder Subagent:** Jev wählt am Anfang eines Gesprächs eher ein kleines Modell. Bei tieferen Aufgaben wird automatisch hochgestuft **oder** ein Subagent mit stärkerem Modell angeworfen. Kritisch beachten: Modellwechsel mitten im Gespräch verliert den Cache. Deshalb: (a) hochstufen nur nach oben, nie zurück, innerhalb eines Gesprächs; (b) bei kalt gewordenem Cache (längere Pause) darf frei neu gewählt werden; (c) bevorzugt der **Subagent** (`think_deep`, frischer Kontext, starkes Modell, gibt nur das Ergebnis zurück), weil er den Haupt-Cache nicht bricht. Eine ausdrückliche Modellwahl von Consti (`modelPinned`) gewinnt immer.
3. **Gedächtnis zweistufig:** Jeder Orbi hat ein **eigenes kleines Gedächtnis** für Spezifisches (lokal, nicht in der Sandbox, klein gedeckelt). **Alles, was jeden angeht, steht im Second Brain**; Orbis können es lesen, nehmen aber immer ihre **eigene AGENTS.md/Anweisung** als Regel. Der Träumer räumt nur das Orbi-Gedächtnis auf (mit Änderungslog), das Brain ist für ihn schreibgeschützt (Brain-Schreiben nur wie bisher: neue Notiz in `01 Inbox` oder per Freigabekarte).
4. **Erst messen, dann kürzen.** Zuerst Messung (Cache-Zähler, Kosten, Schrittzahl) und Cache-Hygiene, danach nur kürzen, was nachweislich spart. Tool-Gruppen (`tools_load`) erst, wenn Cache + Kürzen nicht reichen (Entscheidung am Ende von Lauf G anhand der Messung, in STATUS.md begründen).

## Regeln für jeden Lauf
`AGENTS.md`, `CODING.md` befolgen. Kein Install, keine echte DB (nur Kopien), vor Migration SQLite-Backup, nie `rm -rf` (mv nach `~/.Trash`), kleine deutsche Commits ohne E-Mail und ohne Co-Authored-By, kein Push, eigenständig, nie nachfragen. Tool-Beschreibungen ≤200 Zeichen, Parameter ≤80, Basis-Prompt ohne AGENTS.md unter 4000 Zeichen. Fremddaten-Regel (Lauf E) gilt: nichts aus Web/Mail/Fremdnachrichten wird als Regel gespeichert; jeder Gedächtniseintrag trägt Herkunft und Datum; Secrets nie speichern.

## Läufe (nacheinander, nie zwei Modelle an denselben Dateien)

### Lauf G: Messen, Cache-Hygiene, Verlauf
- `turn_usage` erweitern (Migration, Backup): Schrittzahl, Kosten (aus Preisen, Konfig-Datei, `usage.cost` von Jev nicht verwerfen, `jev_log.cost_usd`), Cache-Schreib-Tokens, Tool- und Verlaufszeichen, Turn-Art, Dauer. Prüfen, ob der Proxy Cache-Tokens liefert (E-Test mit Attrappe + Dokumentation, was ungeprüft bleibt).
- Prompt in fester **Stabilitäts-Reihenfolge**: stabile Teile vorn (Regeln, AGENTS.md, Basis-Anweisung, Tools in stabiler Sortierung), Wechselndes (Teamliste, Gedächtnis-Hash, Datum, Orbi-Zustand) hinten oder als eigene Nachricht. `cache_control`/Provider-Caching einbauen, wo der Anbieter es unterstützt (per `wrapLanguageModel`-Middleware oder Anbieter-Optionen), sonst dokumentieren. Cache-Quote im Turn-Log.
- **Verlauf:** Obergrenze + Zusammenfassung: letzte N Turns wörtlich, Älteres als markierte Zusammenfassung (Haiku, Neuaufbau aus Originalen, nicht Zusammenfassung der Zusammenfassung), Muse-Muster: feste Überschriften + prüfbare Restarbeit-Liste als JSON, Vollverlauf bleibt in der DB. Auslöser über Schwelle (Zeichen), nicht jeden Turn. `chat_recall` (Suche im eigenen Verlauf) als kleines Werkzeug. Automationen mit Ziel „same“ nicht mehr den ganzen Chat laden.
- **Tool-Ausgaben:** Deckel (z. B. 10 000 Zeichen), Websuche und Seiten kappen; sehr große Ausgaben in Datei/SQLite mit Kopf + ID.
- Messbericht in `plan/STATUS.md` (vorher/nachher Zeichen und Tokens je Baustein) und Entscheidung zu `tools_load`.

### Lauf H: Gedächtnis, Kurzprofil, Brain-Leitfaden, Skills
- Orbi-Gedächtnis **lokal** (Dateien/SQLite im Dienst-Datenordner, pro Orbi), klein gedeckelt (Index max. ~1500 Zeichen im Prompt, Einträge als Dateien bei Bedarf per Tool); Migration der bestehenden `MEMORY.md` aus der Sandbox (lesend übernehmen, Original unverändert lassen). Einträge: Herkunft, Datum, `stated`-Prüfung (hat Consti es gesagt?), Horizont-Test (nach einem Monat noch wahr?), Ersetzen älterer Aussagen, Versions-Token beim Schreiben, Secret-Prüfung (besteht). Schreib-Pfadprüfung.
- **Kurzprofil** (<300 Wörter, aus dem Brain, mtime-Cache) + **Brain-Leitfaden** (kurz: wie suchen, nur Passendes, Bereiche) im stabilen Teil des Prompts; Brain-Tools ohne separaten Server nutzbar machen, falls im Repo machbar (sonst dokumentieren); `brain_edit`/`brain_move` nicht bauen.
- **Skill-Katalog** mit Einzeilern (Name + Auslöse-Beschreibung, Pfad-Aliase) und `read_skill`; Orbis dürfen eigene Skills anlegen (Datei im Orbi-Ordner, direkt aktiv; Skill-Text als Fremddaten gerahmt, Wrapper-Tag maskiert). `AGENTS.md`-Verweis auf `uebergabe`-Skill korrigieren (Skill anlegen oder Verweis entfernen).
- AGENTS.md auf höchstens 2 500 Zeichen straffen (Inhalt erhalten, Dopplungen raus), Kurz-Zeile bleibt.

### Lauf I: Jev-Stufung, Subagent, Träumer
- **Jev-Start klein + Hochstufung:** Regeln wie Entscheidung 2 in `lib/jev/*` und `turn.ts` (pro Gespräch gemerktes Modell + Stufe, nur nach oben, Reset bei kaltem Cache, `modelPinned` gewinnt, Transparenz im Turn-Log). Tests.
- **Subagent `think_deep`**: Werkzeug, startet einen frischen Turn mit stärkerem Modell (Jev-Stufe large/coding), gibt nur Ergebnis (max ~1500 Zeichen) zurück, zählt auf das Auftragsbudget, nicht im Gruppen-/Hintergrundturn, Fremddaten-Rahmen. 
- **Träumer:** täglicher Hintergrundjob je Orbi über den bestehenden Takt (`lib/automations`, `context:false`, Haiku), Sperre gegen Doppellauf, schreibt nur das Orbi-Gedächtnis (zusammenführen, Veraltetes entfernen, Widersprüche auflösen, Herkunft behalten), Änderungslog (Tabelle), Kostendeckel pro Tag, Ausnahme vom 12er-Lauf-Limit, bricht ab bei Fehler ohne Teilschreiben (Transaktion). Kein Brain-Schreiben.
- Heartbeat bleibt Phase 5 (nicht bauen), aber Takt so vorbereiten, dass Intervall+Zeitfenster später passt.

### Mac (nach Lauf I, kleiner Lauf J)
Gedächtnis-Ansicht je Orbi (Index lesen, Eintrag löschen), Kosten-/Cache-Anzeige im Info-Popover, Hinweiszeile „Verlauf zusammengefasst“ nach Figma-Regeln. Nur falls Dienst-API steht.

## Definition of Done (je Lauf)
`npm run check` grün, Tests je Punkt, Messwerte vorher/nachher in `plan/STATUS.md` (Abschnitt „Phase 4, Lauf X“), `plan/API.md` bei neuen Endpunkten/Events, lokal committet, nicht installiert, Ungeprüftes ehrlich benannt (echtes Modell, echter Cache, Jev-Schlüssel).
