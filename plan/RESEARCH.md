# Orbit 2: Recherche Features Grok, ChatGPT, Dots

Stand: 2026-10-17. Ziel: Was braucht ein persönlicher KI-Chat mit mehreren Assistenten (Orbis, Hauptorbi mit Handoffs, Gruppenchats, Second-Brain-Anbindung, Modellrouter Jev)?

**Quellenmarkierung pro Zeile:** **[P]** primär (Hersteller-Seite direkt gelesen: x.ai/news, docs.x.ai, help.openai.com, learn.chatgpt.com, openai.com). **[S]** sekundär (Blog, Presse, Suchtreffer). **[U]** unsicher (Quellen widersprüchlich oder nur eine Sekundärquelle). Erreichbarkeit Stand 17.10.2026 über Firecrawl-CLI: x.ai/news, docs.x.ai, help.openai.com, learn.chatgpt.com und openai.com/devday-recap waren abrufbar (frühere 403 ist behoben). Nicht erreichbar bzw. nicht geprüft: x.com-Posts (nur Suchausschnitt), openai.com/index/introducing-dots (nur Verweis gesehen), grok.com/changelog (nicht geprüft).

Bereits geplant, nicht aufgeführt: Websuche animiert, Bilder, Memory + Brain, Slash-Skills, MCP-Konnektoren, Marktplatz, Einstellungen, Jev.

## 1. Grok-Team: Features und Automation

Wichtig vorab: Das "Grok Bot"-Produkt (11.08.2026) ist ein Multi-Assistenten-Chat und damit Orbit 2 konzeptionell sehr nah. Hersteller heißt jetzt SpaceXSI (xAI gehört seit 02.02.2026 zu SpaceX) [P: x.ai/news].

| Feature | Datum | Quelle | Kern | Abschauen |
|---|---|---|---|---|
| Grok Bot (Bot-Roster) | 11.08.2026, Beta | [P] x.ai/news/introducing-grok-bot | Persistente Agenten mit Name, Avatar, Titel, eigenem Gedächtnis, eigenem Rechner. Kommen nur zurück, wenn Freigabe nötig. Mehrere Bots parallel, ein "Chief of Staff" führt Spezialisten. Gruppenchat: Bots geben Arbeit untereinander weiter und holen den Menschen nur für Urteile. | Hauptorbi = Chief of Staff. Handoffs und Gruppenchats genau so zuschneiden. |
| Designprinzipien Grok Bot | 03.09.2026 | [P] x.ai/news/designing-grok-bot | Hauptobjekte sind Bots, nicht Chats ("Chats sind wegwerfbar"). Fünf Begriffe: Bots, Chats, Prompts (einmalig, Skill oder Routine), Tools, Artifacts. Tools und Skills gelten kontoweit, Memory und Routinen gehören dem einzelnen Bot. Gruppenchats teilen Kontext, jeder Bot behält sein Spezialgedächtnis. Limits: ca. 50 Bots pro Konto, 6 pro Gruppenchat. Status (ruhig, denkt, arbeitet, wartet, blockiert, fertig) wird über Avatar-Bewegung gezeigt, Details erst beim Hover. | Seitenleiste = Orbi-Liste statt Chatverlauf. Memory je Orbi, Skills/Tools global. Status als Orb-Animation (passt zum Orb-Konzept). Limit 6 pro Gruppe als Startwert. |
| Automations (Grok-App) | 16.07.2026 | [P] x.ai/news/grok-automations | Einmal beschreiben. Zeitplan (einmal, täglich, Werktage, wöchentlich, monatlich, jährlich, in eigener Zeitzone) oder E-Mail-Trigger (Filter: Absender, Empfänger, Betreff). Jeder Lauf ist ein echtes Gespräch im Lauf-Verlauf. "Run now" zum Testen. Benachrichtigung: Mail, App, beides oder keine. Anlegen auch per Chat-Befehl, Vorlagen, pausieren/bearbeiten/löschen. Zeitpläne für alle, E-Mail-Trigger nur mit SuperGrok. | Siehe Abschnitt 3. |
| Skills und Routinen (Grok Bot) | Doku, Stand 12.10.2026 | [P] docs.x.ai/grok-bot/skills-routines-and-automations | Erst einmal von Hand, dann als Skill speichern, dann erst zeitplanen. Routine gehört einem Bot. Test-Lauf. Max. 50 Routinen pro Bot, 20 letzte Läufe gespeichert, Mindestabstand 5 Minuten, Löschen ohne Undo. Routinen pausieren, wenn keine Antwort nach langer Abwesenheit. Event-Trigger über Cursor (Slack, GitHub), enge Regeln empfohlen. "Teach a task" (Browser vormachen) schrittweise freigeschaltet. | Skill-Vorlage mit Pflichtfeldern übernehmen: wann nutzen, Eingaben, Ablauf, Prüfung, Rückgabe, was Freigabe braucht. Auto-Pause-Idee übernehmen. |
| Freigaben und Auto Review | Doku | [P] docs.x.ai/grok-bot/approvals-security-and-privacy | Karte zeigt Aktion und Eingaben. Knöpfe: einmal erlauben, immer erlauben (speichert Regel), ablehnen. Regeln "Zuerst fragen" gewinnt gegen "Automatisch erlauben". Freigabe von Hintergrundläufen verfällt nach ca. 10 Minuten (Aktion läuft dann nicht). Passwörter, 2FA, Zahlungen übernimmt der Mensch. | Freigabekarte in Orbit 2 genau so. Verfall nach 10 Min. verhindert Überraschungsaktionen. |
| Connectors + Bring Your Own MCP | 06.05.2026 | [P] x.ai/news/grok-connectors | Outlook, SharePoint, OneDrive, Google Workspace, Notion, GitHub, Linear. Schreibrechte getrennt aktivierbar. Eigener MCP-Server einbindbar. Web: Plus-Taste, Konnektoren; mobil: Einstellungen. | Passt zur MCP-Planung. Lese- und Schreibrecht pro Konnektor trennen. |
| Skills (Grok-App) | 18.05.2026 | [P] x.ai/news/grok-skills | Eingebaute Skills (Word, Präsentation, Tabelle, PDF), eigene überschreiben die eingebauten. | Eigene Skills haben Vorrang vor Standard-Skills. |
| Memory in Grok Build | 16.09.2026 | [P] x.ai/news/grok-build-memory | Nach jedem Zug werden Konventionen, Entscheidungen, Fakten im Hintergrund notiert. Markdown-Dateien, ein Thema pro Datei, Projekt- und globaler Bereich. `/dream` führt zusammen, `/memory` zeigt die Dateien. | Entspricht fast dem Brain-Aufbau. Memory als lesbares Markdown, mit Zusammenführ-Befehl. |
| Grok Build (Coding-Agent) | 25.05.2026 Beta, 19.08.2026 für alle auf Web und Mobil | [P] x.ai/news/grok-build-cli, grok-build-for-everyone | Apps per Chat bauen und per Link veröffentlichen. Zusätze: `/goal` (22.06.), Agent Dashboard (15.06.), Workflows mit Fan-out (23.07.), Plugin-Marktplatz (11.06.). Heavy: Build Mode war zuerst nur SuperGrok Heavy (28.07.). | Nur Hinweis. Agent Dashboard (viele Sitzungen, Antworten wo nötig) als Idee für späteren Überblick. |
| Voice | Grok Voice 2.0 29.07.2026, Transcribe 2.0 18.09.2026, 21 Stimmen 06.07.2026 | [P] x.ai/news | Sprach-zu-Sprach-Modell, Diktat-Modell, Stimmen und Voice Agent Builder. | Zuerst Diktat und Vorlesen. Voice-Gespräch später. |
| Imagine | Image 2.0 07.08.2026, Video 1.5 mit Referenzen 31.07.2026 | [P] x.ai/news | Bildgenerierung und -bearbeitung, Video bis 1080p. | Bilder sind schon geplant, Video nicht nötig. |
| Companions (Ani, Mika u. a.) | Rückbau ab 24.07.2026 | [U] Blog aicompanionguides.com, X-Post eines Nutzers. Kein xAI-Eintrag unter x.ai/news gefunden | Berichtet wird Abschaltung der 3D-Avatare, Ziel bessere Memory. Termine widersprechen sich (24.07. / 01.09.). | Keine Avatar-Figuren bauen. |
| Heavy, Projects | - | nicht belegt | Zu "Heavy" nur Tarifhinweise gefunden (SuperGrok Heavy). Zu "Projects" in Grok keine Primärquelle gefunden. | Nichts ableiten. |

## 2. ChatGPT und Dots (Vergleich)

| Feature | Quelle | Kern | Abschauen |
|---|---|---|---|
| Scheduled tasks | [P] help.openai.com/en/articles/10291617, learn.chatgpt.com/docs/automations | Seite "Scheduled" als Posteingang: alle Aufgaben und Läufe, Läufe mit Funden werden hervorgehoben. Einmalig, wiederkehrend, Überwachung, ereignisgesteuert (Nachricht, Pull Request). Aufgabe in einem Chat (kehrt in denselben Chat zurück) oder eigenständig (neuer Chat je Lauf). Erweiterte Zeitpläne per RRULE. Benachrichtigung Push, Mail oder beides; mobiler Push nur für in der Mobile-App angelegte Aufgaben. Aufgabe in Projekt kann Projektdateien nicht lesen. | "Zurück in denselben Chat" gegen "neuer Chat je Lauf" als Wahl pro Automation. Zentraler Posteingang für Läufe. |
| Dots (Dauer-Agenten) | [P] openai.com/index/devday-2026-recap (nur Kurzbeschreibung: immer aktiv, gelernter Kontext, Pro und Business Premium); Details [S] Wired, em360tech, Medium | Eigene Cloud-Umgebung, Memories, geplante Aufgaben, bringen Fortschritt oder Entscheidungen. Auto-review vor riskanten Schritten [S]. Preis (100 $) [U]. | Freigabemuster (deckt sich mit Grok), Cloud-Rechner nicht übernehmen. |
| Pulse, Agent-Modus, Voice, Canvas, Projects, Developer Mode, Export | [S]/[U] (unverändert aus früherer Fassung, nicht erneut geprüft) | Pulse = morgendlicher Brief. Agent fragt vor Aktionen mit Folgen. Canvas als Seitenpanel. Projects trennen Memory je Projekt. Konnektoren: Bestätigung je Schreibaufruf. Export nur gesamt. | Morgenbriefing als Automation, Canvas-Panel, Memory-Trennung je Projekt, Einzelchat-Export als Markdown. |

## 3. Automationen-Muster (aus Grok und ChatGPT, beide [P])

- **Trigger:** Zeitplan (Pflicht) und E-Mail-Filter (später). Event-Trigger nur eng gefasst (Absender/Betreff), keine "jede neue Nachricht"-Regel.
- **Zeitplan:** einmal, täglich, Werktage, wöchentlich, monatlich, jährlich, eigene Zeitzone. Mindestabstand 5 Minuten. Pro Orbi begrenzte Zahl (Grok Bot: 50).
- **Freigabe:** Erst vorbereiten (Entwurf), dann freigeben. Senden, Kaufen, Löschen, Veröffentlichen immer nur nach Karte. Freigabe aus unbeaufsichtigten Läufen verfällt nach ca. 10 Minuten, Aktion läuft dann nicht. "Zuerst fragen" schlägt "Automatisch erlauben".
- **Verlauf:** Jeder Lauf ist ein lesbares Gespräch, fortsetzbar. Aufbewahrt: die letzten 20 Läufe. "Run now"/Testlauf, der echte Aktionen ausführt, deshalb nur mit sicheren Eingaben.
- **Benachrichtigung:** Mail, App-Push, beides oder keine, pro Automation. Läufe ohne Fund still, mit Fund hervorgehoben. Mobiler Push braucht die Mobile-App.
- **Robustheit:** Regel für fehlende oder alte Daten ("lieber Fehler melden als alte Daten nutzen"), Auto-Pause bei langer Abwesenheit, Löschen ohne Undo (Orbit 2: besser mit Papierkorb).

## Empfehlung für Orbit 2 (aktualisiert)

1. **Unverzichtbar:** Orbi-Liste als Hauptobjekt statt Chatverlauf (Grok Bot, [P]); Memory je Orbi, Skills und Tools global; Volltextsuche über alle Chats [S]; Freigabekarte vor Aktionen mit Folgen (einmal / immer / ablehnen, Verfall 10 Min.); Benachrichtigungseinstellung.
2. **Gruppenchats:** Hauptorbi als Chief of Staff, Gruppe mit eigenem geteiltem Kontext, jeder Orbi behält sein Gedächtnis, Startlimit 6 pro Gruppe. Status je Orbi als Orb-Animation, Details beim Hover.
3. **Phase 2:** Zeitpläne mit Run now, Lauf-Verlauf, Posteingang "Geplant", Wahl "gleicher Chat oder neuer Chat je Lauf"; Skill-Vorlage mit Pflichtfeldern; Morgenbriefing als Automation; Canvas-Panel; Einzelchat-Export als Markdown.
4. **Später:** Diktat und Vorlesen vor vollem Voice-Modus; E-Mail-Trigger; Mobile-PWA mit Web-Push; Agent-Dashboard-Übersicht.
5. **Nicht übernehmen:** Companion-Avatare, Cloud-Rechner pro Bot, Teach-by-Demonstration, unbelegte Pläne und Preise.

**Vermutung (nicht belegt):** Der Nutzen eines Bot-Rosters hängt davon ab, dass Memory pro Orbi wirklich getrennt bleibt. Das zeigt Grok als Designprinzip, ein Wirkungsnachweis fehlt.

Offene Punkte: x.com-Posts des Grok-Teams, grok.com/changelog und openai.com/index/introducing-dots nicht direkt gelesen. Tarife und Preise vor Entscheidung bei den Herstellern prüfen.

Modell: Sonnet
