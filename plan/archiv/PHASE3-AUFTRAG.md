# Phase 3: Antwortgefühl wie Grok Bot (Auftrag)

Stand 01.11.2026. Quelle der Ziele: `Second Brain/02 Projekte/Orbit/Umsetzungsplan Orbit.md`, Abschnitt „Phase 3“ (Ziel, „Das merkst du“, Befund, Abnahme) und `Orbit Fähigkeiten-Vorschlag 2026-11-01.md`. Dieser Auftrag ersetzt davon, wo er abweicht.

## Entscheidungen von Consti (01.11.2026)
1. **Sofortbestätigung:** bei längeren Aufgaben sofort eine kurze Zeile („Mach ich, ich schau mir X an“), danach nur die Statusleiste, am Ende die fertige Antwort.
2. **Reaktionen als Signal:** 👍 auf eine Rückfrage-Karte oder Ja/Nein-Frage zählt als Ja, 👎 als Nein. Sonst nur Gefühl: löst nie einen neuen Turn aus. Orbis reagieren statt „Danke/Okay“-Nachrichten zu schreiben.
3. **Keine Chat-Titel.** Orbit hat keine Chat-Titel. Nicht bauen.
4. **Antwortlänge: ein globaler Regler** in den Einstellungen (kurz / normal / ausführlich), Standard kurz (1–5 Zeilen). Wirkt auf alle Orbis über eine Zeile im Prompt (nicht pro Orbi).
5. **Orbis arbeiten eigenständig**, Rückfragen nur bei Geld, Veröffentlichen, Nachrichten in Constis Namen, endgültigem Löschen, Secrets (steht schon in `AGENTS.md` und `lib/chat/agent.ts`). Rückfragen immer mit Auswahlkarte und Empfehlung.

## Regeln für den Lauf
`AGENTS.md` und `CODING.md` befolgen. Oberfläche nur nach `plan/DESIGN-SYSTEM.md` (Bilder `plan/design/`), nur Theme-Werte. Nicht installieren, echte Datenbank nicht anfassen, Tests unsichtbar gegen DB-Kopien, danach alles nach `~/.Trash` (nie `rm -rf`). Commits klein, deutsch, „Bereich: was“, keine E-Mail, keine Co-Authored-By-Zeile. Nicht pushen. Vor einer Migration SQLite-Kopie mit Datum.

## Soll-Verhalten
1. **Sofortbestätigung.** Prompt-Regel (kurz): bei Aufgaben mit Tools zuerst ein Satz, dann arbeiten. Kleine Aufgaben: direkt antworten.
2. **Zwischennachrichten.** Neues Werkzeug `say {text}` (nicht `send_message`, der Name gehört seit Phase 2 den Orbi-Nachrichten): sendet Consti sofort eine eigene Blase (eigener Zeitstempel, einzeln kopierbar), kein Extra-Modellaufruf, Rückgabe „ok“. Bei allem, was dauert, ein bis zwei davon (Meilenstein), kein starres Limit, Kurztext. Der Teil wird sofort gespeichert (Zwischenspeichern nach jedem Schritt, überlebt orbitd-Neustart). Datenmodell: eine UIMessage pro Turn bleibt, die UI zeigt `tool-say`-Teile als eigene Nachricht. Alternative (mehrere `chat_messages`-Zeilen) nur, wenn das nicht sauber geht, dann begründen.
3. **Statusleiste.** Während des Turns genau **eine** schmale Zeile: Orbi-Figur, dann Text wie „Liest 3 Mails …“, „Sucht im Web …“, „Schreibt Notiz …“. Labels kommen aus dem Code (Tabelle Tool → Label, nie vom Modell), live per Event. Nach dem Ende: „N Schritte · X s ›“, Klick klappt die Details (Befehle, Ausgaben) auf. Keine einzelnen Tool-Karten mehr im Verlauf, **außer**: Freigabe-, Auswahl- und Datei-Karten stehen immer sichtbar. Einstellung „Schritte immer ausklappen“, Standard aus. Status bleibt blau (Design-System).
4. **Reaktionen.** Neues Werkzeug `react {message_id, emoji}` (Emoji aus kleiner fester Liste, z. B. 👍 ✅ 😂 ❤️ 👎 🤔), eigene Tabelle `message_reactions` (chat_id, message_id, actor, emoji, created_at), da `saveMessages` den Verlauf neu schreibt; Nachrichten-IDs bleiben stabil. Auch Consti kann in der App reagieren (Kontextmenü/Hover an Blase). Anzeige: Pill mit Mini-Avatar und Emoji unter der Blase, Mehrere Orbis in Gruppen je eine. Eine Reaktion allein darf die ganze Antwort sein (kein leerer Text). Reaktion von Consti auf eine Frage = Antwort wie in Entscheidung 2 (nur wenn eindeutig Ja/Nein-Frage offen ist), sonst Info an den Orbi beim nächsten Turn (Zeile im Kontext, kein Wecken). API in `plan/API.md`.
5. **Dateien als Karte.** Erstellt ein Orbi eine Datei oder Notiz (Tools wie create_pdf, create_word, write_file in Ausgabeordner, brain_write), kommt immer eine Karte im Chat, Klick öffnet. Bei Coding-Aufgaben keine Karten für einzelne Code-Dateien. Prüfen, was die App schon kann, nur Lücken füllen.
6. **Antwortlänge.** Globale Einstellung `replyLength` (short/normal/long) im Dienst (Settings-Speicher) und in der App; eine Zeile im System-Prompt je Stufe. Stil-Prompt sagt nicht mehr „vor Geld/Senden fragen“.
7. **Rückfragen nur mit Karte.** Prüfen, dass jede Rückfrage über `ask_user` läuft (keine Fragen im Fließtext), mit Empfehlung.
8. **Onboarding neuer Orbi.** Legt Consti einen Orbi an (Name + Aufgabe), öffnet sich sein Chat; er stellt sich in einem Satz passend vor und stellt 2–3 kurze Fragen als Auswahlkarte mit Empfehlung (z. B. was am wichtigsten ist, wie oft er sich melden soll, was er nie tun soll). Nach den Antworten: kurze Zusammenfassung im Chat und die Antworten werden in die eigene Anweisung des Orbi eingetragen. Überspringbar, nur einmal pro Orbi (Flag in `clientData`/Orbi-Daten). Ein einmaliger Modell-Turn mit Onboarding-Anweisung, kein Dauer-Prompt.
9. **Token.** Basis-Prompt ohne Brain/Gedächtnis unter 4.000 Zeichen (Turn-Log nennen: vorher/nachher). Tool-Beschreibungen ≤200 Zeichen, Parameter ≤80 (Test). `say`, `react` und Statusleiste verursachen keine zusätzlichen Modellaufrufe.

## Aufteilung (nie zwei Modelle an denselben Dateien)
- **Lauf A (Dienst, TypeScript):** Punkte 1, 2, 4 (Daten, Werkzeug, API), 5 (Dienstseite), 6, 7, 8 (Dienstseite/Prompt), 9, Status-Events (`status-step` o. ä. mit Label aus Code), Tests, `plan/API.md`, `plan/STATUS.md`. Keine Swift-Dateien.
- **Lauf B (Mac, Swift):** Statusleiste und Zusammenfassung „N Schritte · X s ›“, `say`-Blasen, Reaktionen (Pill, Setzen durch Consti), Dateikarten, Einstellungen (Schritte ausklappen, Antwortlänge), Onboarding-Ablauf nach Anlegen, Tests. Baut auf Lauf A.

## Definition of Done (je Lauf)
`npm run check` bzw. `xcodebuild test` (unsigniert, DerivedData im Scratchpad) grün; neue Tests je Punkt; Abnahme-Liste aus dem Umsetzungsplan, soweit ohne echtes Modell prüfbar, per Test abgedeckt, der Rest als „nicht geprüft“ in `plan/STATUS.md` (Abschnitt „Phase 3“, Datum, Nachweise). Lokal committet, nicht installiert.
