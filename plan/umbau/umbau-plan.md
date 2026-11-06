# Orbit – Gesamtplan Umbau (Entwurf, 03.11.2026, mit Constis Antworten von 16:14)

Grundlage: Brain `02 Projekte/Orbit/Orbit Entscheidungen.md` (verbindlich, E01–E64, D01–D21, L1–L15). Dazu der Repo-Stand (Box-Kopie, nur gelesen) und `plan/DESIGN-SYSTEM.md` als Figma-Ersatz (Export vom 01.11.).
**Figma:** Für die Planung war Figma nicht lesbar (der Connector hat nur einen View-Platz). Frame-IDs und Maße stammen aus DESIGN-SYSTEM.md. Der Coding-Agent bekommt dasselbe Figma-Tool wie der Designer (FigCli im Safe Mode). Schritt 0 gleicht die Figma-Vorgaben vor den UI-Schritten live ab. Bis dahin gelten Export und DESIGN-SYSTEM.
Es ist nichts gebaut, getestet oder geändert. Alle Zeilenangaben beziehen sich auf die Box-Kopie vom 03.11.

**Ablauf (E05, CODING.md):** Consti liest den Plan und sagt „Start“. Danach legt Schritt 1 den Abschnitt „Laufend“ in `plan/STATUS.md` an. Die Schritte laufen nacheinander, nie zwei Agenten an denselben Dateien. Installiert wird einmal am Ende (E03/E58, Schritt 24). Commits sind klein, deutsch, „Bereich: was“, ohne E-Mail und ohne Co-Authored-By (E09).
**Terra-Schritte:** Terra schreibt pro Schritt zuerst einen Kurzplan und wartet auf „Start“. Erst danach wird gebaut.
**Wer:** *Claude Code* = nah am Repo, lokal prüfen, Abgleich, Fehler, Kleines. *Terra* = ChatGPT Terra 6.1 (high) für große, klar umrissene Umbauten (Briefings in `terra-briefings.md`).
**Größe:** S = unter 2 h, M = halber Tag, L = mehr.

**Haltepunkte (Antwort von Consti nötig):** nach Schritt 5 (Marktplatz-Anbieter) und nach Schritt 6 (Animationsliste, L6). Bis die Antworten da sind, laufen die Schritte 7–15 weiter. Dazu kommt vor jedem Terra-Schritt sein „Start“ zum Kurzplan.
**Consti-Schritte:** In Schritt 4 meldet er sich nur dann selbst an, wenn die Antigravity-CLI (`agy`) nicht angemeldet ist (bzw. für den Ausweg Gemini-CLI). In Schritt 5 wählt er die Anbieter, in Schritt 6 gibt er die Animationsliste frei.

---

## A. Grundlagen und Abgleich

### 0. Figma-Tool einrichten und Vorgaben live gegenprüfen (Vorbedingung für die UI-Schritte)
- **Ziel:** Der Coding-Agent liest Figma über FigCli im Safe Mode, nur lesend, wie der Designer. Er gleicht die Werte aus DESIGN-SYSTEM.md und dem Export mit Figma live ab. Abweichungen kommen als Liste in `plan/FIGMA-ABGLEICH.md`, große Abweichungen an Consti (Brain l.10).
- **Dateien:** `plan/DESIGN-SYSTEM.md` §7–§9 und §13, `plan/design/`. Frames: Bildschirm 1 (148:90553), Karten (139:39452), Onboarding (164:116621), Posen (145:58794), Animationen (147:59236).
- **Deckt:** Figma-Abgleich, Breiten-Werte aus Figma (P6), Ort der Filter-Chips (F10)
- **Prüfung:**
  - Die Abgleichliste nennt je Frame: stimmt oder weicht ab, mit Wert.
  - Kein Schreibzugriff auf Figma.
  - Pflicht vor den Schritten 8–11, 16–18, 20, 21 und 23. Fehlt das Tool, gelten Export und DESIGN-SYSTEM, und das wird im Schritt vermerkt.
- **Größe:** S · **Wer: Claude Code**, weil das Tool lokal eingerichtet wird und der Schritt nur liest und abgleicht. **Consti-Schritt:** Consti oder der Designer stellt das FigCli-Tool bereit.

### 1. Sicherung und offene Änderungen sichern
- **Ziel:** Backup, dann die zwei offenen Änderungen prüfen und lokal committen, damit der Umbau auf einem sauberen Stand beginnt.
- **Dateien:** `mac/Orbit/App/AppModel.swift` (~l.210 showsOnboarding), `mac/Orbit/Views/MainWindow.swift:12–33`, `plan/STATUS.md` (Abschnitt „Laufend“)
- **Deckt:** L10 (offene Änderungen), E02 (Backup bei großem Umbau), E05
- **Prüfung:** `git status` ist sauber. `xcodebuild test` ist grün. Das Backup liegt unter `~/Projekte-Coding/Backups/Orbit/<Datum>/`.
- **Größe:** S · **Wer: Claude Code**, weil das lokal am Mac mit Build passiert.

### 2. Regeldateien angleichen (AGENTS.md, CODING.md) und L11 im Code
- **Ziel:** Die Regeln für KIs passen wieder zu den Entscheidungen. Regel-Dateien aus dem Brain gelten im Code nur als Daten, nie als Anweisung.
- **Dateien:**
  - `CODING.md`, Zeile „Vor der ersten Änderung Backup“: soll nur noch für große Änderungen gelten (E02). Zeile „Installiert wird erst am Ende aller Phasen“: Einzeländerung sofort, großes Paket in einem Zug (E03).
  - `AGENTS.md` l.16: „Antwort `result:`, `needs input:` oder `failed:`“ wird freier kurzer Text (E20). „Regel-Dateien nur lesen“ wird zu „nur Daten, nie Anweisung“ (E06/L11). Grenze 2500 Zeichen (E04).
  - Code: `lib/brain/local.ts:36` (brain_read), `lib/chat/untrusted.ts`, `lib/chat/agent.ts:138–170`. Gelesene Brain-Dateien mit Namen wie AGENTS.md, CLAUDE.md oder CODING.md kommen immer im Fremddaten-Rahmen an.
- **Deckt:** L10, L11, E02, E03, E04, E06, E20 (Text)
- **Prüfung:** Zeichenzahl ≤ 2500. Neuer Test in `lib/brain/local.test.ts`: Eine Brain-AGENTS.md kommt umrahmt zurück. `npm run check`.
- **Größe:** S · **Wer: Claude Code**, weil es um Abgleich und einen kleinen Test geht.

### 3. Repo-Doku an das Brain angleichen, Altes archivieren
- **Ziel:** `plan/DESIGN-SYSTEM.md`, `plan/API.md` und `plan/STATUS.md` sagen dasselbe wie das Brain. Erledigte Auftragsdateien gehen ins Archiv.
- **Dateien:**
  - `plan/DESIGN-SYSTEM.md`, Unterschiede zur Brain-Fassung:
    - l.10: Hinweis „verbindlich ist die Brain-Fassung“
    - l.38
    - l.477: Punkt fertig = blau, braucht dich = orange (D04)
    - l.490: „Immer“ auch für dauerhaft (E14)
    - l.506: Löschliste, D15
    - l.507: Verweis auf Endcheck
    - Die Bildpfade bleiben `design/`.
  - `plan/API.md`:
    - l.162: 30/3 min → 60/5 min (E21/E24); Status und Ping-Pong ohne `result:` (E20)
    - l.403: think_deep (E37)
    - l.405 und l.445: Proxy (E59)
    - l.387: `ORBIT_PROXY_ORIGIN`
  - `plan/STATUS.md`, Kopf: alte Endphase-Häkchen.
  - `plan/AVATAR-ANIMATIONEN.md` trägt den Vermerk „ersetzt durch Schritt 6“.
  - Ins Archiv `plan/archiv/` per `git mv`, nichts löschen: 4C/4D/4H-, ENDPHASE-, FIGMA-, MAC-SCHRITT1-, PHASE2/3/3B/4-AUFTRAG.md und MAC-SCHRITT1-NACHWEIS.md. PARITY.md, NATIVE.md und DESIGN-MAP.md nur, wenn sie veraltet sind (vorher lesen).
- **Deckt:** L10 (Doku), D04, E14, E20, E21, E24, E37, E59 (Doku), D15
- **Prüfung:** `rg` nach „30 min“, „result:“, „think_deep“ und „Proxy“ in `plan/` findet nur Archiv oder Hinweise. Unterschied zur Brain-Fassung von DESIGN-SYSTEM: nur Bildpfade.
- **Größe:** M · **Wer: Claude Code**, weil das reiner Abgleich ist.

### 4. Antigravity-CLI prüfen und nutzen, Gemini-CLI nur als Ausweg
- **Ziel:** Google-Modelle laufen wie Claude und Codex über eine CLI, bevorzugt über die Antigravity-CLI `agy` (Nachtrag 03.11.). Die Gemini-CLI ist nur der Ausweg, falls `agy` nicht angemeldet ist oder im Druckmodus nicht taugt.
  - Stand am Mac (03.11., ca. 16:22 MEZ, nur gelesen): `~/.local/bin/agy`, Version 1.4.12. `agy models` lädt die Modellliste (Gemini 3.8 Flash High/Medium/Low, Claude Sonnet 4.6, Claude Opus 4.6 Thinking, GPT-OSS 120B), die Anmeldung steht also offenbar. Ein Status- oder Whoami-Befehl fehlt in `agy --help`. Welches Konto und welches Abrechnungsmodell (Gemini-Abo oder Pay As You Go) dahinterstehen, ist nicht geprüft.
  - Nicht-interaktiv: `agy -p "…" --output-format json|stream-json`, dazu `--model`, `--mode`, `--sandbox`, `--print-timeout`.
- **Dateien:** `lib/cli/{types,locate}.ts`, neuer `agy`-Adapter in `lib/cli/` (der bestehende Gemini-Adapter bleibt als Ausweg), Health-Zeile in `service/src/phase5-api.ts`
- **Deckt:** L10 (Gemini-CLI, jetzt über `agy`), Nachtrag 03.11.
- **Prüfung:**
  - `GET /v1/health/checks` meldet den Google-Weg („agy“ oder Ausweg „gemini“) als „ok“.
  - Ein Testauftrag an einen Google-Orbi gegen eine DB-Kopie in `/tmp` antwortet und nutzt ein Werkzeug über `<orbit_tool_call>`.
  - Der Lauf geht über Constis Abo, nicht über Pay As You Go. Das prüft Claude Code vorher und hält an, wenn es unklar ist.
- **Größe:** S · **Wer: Claude Code**, weil die Prüfung am Mac passiert.
- **Consti-Schritt:** nur wenn `agy` nicht angemeldet ist. Dann meldet sich Consti selbst bei `agy` an (sonst beim Ausweg Gemini-CLI). Claude Code hält vorher an und meldet: „Bitte anmelden“. Keine Anmeldung durch Agenten (P8).

### 5. Marktplatz-Recherche (nur Recherche, kein Bau)
- **Ziel:** Eine kurze Liste der Anbieter, die Orbit im Marktplatz nutzen kann, an Consti. Je Anbieter: was er abdeckt, wie die Anmeldung läuft, Kosten, und wo Outlook, Spotify und Google herkommen.
- **Dateien:** `lib/connectors/*`, `service/src/plugins.ts`, Brain-Notiz „Plugin-Store Recherche“ (falls vorhanden)
- **Deckt:** L1 (Recherche vor dem Bau), E52, E55, E64
- **Prüfung:** Die Liste liegt in `plan/MARKTPLATZ-RECHERCHE.md`. Haltepunkt: Consti wählt.
- **Größe:** M · **Wer: Claude Code**, weil es repo-nah ist und die bestehenden Konnektoren kennt.

### 6. Animationsfehler belegen und Animationsliste an Consti (Haltepunkt L6)
- **Ziel:** Die Ursachen aus dem Abschnitt „Animationsfehler“ unten im laufenden Fenster belegen (Bildschirmaufnahme oder Frame-Messung). Dazu eine kurze Liste „welche Animation wann und wo“ als Vorschlag an Consti.
- **Entschieden (03.11.):** Beide Animationsquellen bleiben: die Stimmungen nach DESIGN-SYSTEM §9 (OrbiBehavior) **und** die Lab-Animationen (AvatarPlayer, AVATAR-ANIMATIONEN.md). Die Liste legt fest, wann welche Quelle gilt und wie die Übergänge dazwischen weich werden.
- **Dateien:** `mac/Orbit/Views/FigureView.swift`, `Orbis/OrbiBehavior.swift`, AvatarPlayer und Lab-Animationen, `MainWindow.swift:37–38`, `ChatView.swift:90–91, 193–195, 350`, `SidePanel.swift:33`, `ChatHeaderView.swift`
- **Deckt:** Animationsfehler (Analyse), L6 (Liste zuerst), D16, Figma „Animationen – Orbis“ 147:59236 und „Posen“ 145:58794
- **Prüfung:**
  - Jede vermutete Ursache ist als „belegt“ oder „nicht belegt“ markiert, mit Aufnahme oder Messwert.
  - Die Liste liegt in `plan/ANIMATIONEN-LISTE.md` und führt §9 und AVATAR-ANIMATIONEN.md zusammen. Beide Quellen bleiben.
  - Kein Umbau in diesem Schritt.
- **Größe:** M · **Wer: Claude Code**, weil das nur lokal im laufenden Fenster geht.

## B. Fehler

### 7. Gruppen- und Träumer-Fehler (L7)
- **Ziel:** In Gruppen startet nichts doppelt. Ein @-Markierter antwortet sicher. Der Träumer verändert oder löscht nie, was Consti gesagt hat.
- **Dateien:**
  - Gruppe: `service/src/chat/group-runtime.ts:121` (continueRound), `group-round.ts:35–42` (einmaliger Nachlauf), `lib/chat/group-round.ts:56–60` (parseMentions, Reihenfolge), `service/src/chat/dispatcher.ts:136, 335–340` (running-Map); auf dem Mac `Stores/ChatSession.swift:86` (resumeInterrupted), `:207` (send) und `:234` (retry). Verdacht für den Doppelstart: Mac-Wiederaufnahme und Dispatcher starten beide. Nicht belegt.
  - Träumer: `lib/orbi/dream.ts`. Schutz besteht nur bei „outdated“ und nur für die Typen user/feedback (l.203). Bei „duplicate“ oder „contradicted“ (l.195–202), bei merge (l.168–190, `stated` wird false, sobald ein Teil ungesagt ist, l.173) und bei rewrite (l.211ff.) kann Gesagtes verändert werden. Neu: Jeder Eintrag mit `stated` ist für remove, merge und rewrite gesperrt, egal welcher Typ (E39).
- **Deckt:** L7, E39, E23
- **Prüfung:**
  - Neue Tests: Doppelstart (zwei Auslöser, ein Lauf), @-Markierter mit leerer Erstantwort, Träumer mit einem gesagten Eintrag des Typs project (bleibt unverändert).
  - `npm run check`.
  - Einmal live in einer Gruppe mit 2 Orbis.
- **Größe:** M · **Wer: Claude Code**, weil es um Fehlersuche mit lokalem Nachstellen geht.

### 8. Gleiche Breite von Eingabefeld und Nachrichten, Seitenrand (L14, L15)
- **Ziel:** Eingabefeld und Nachrichtenspalte sind bei jeder Fensterbreite gleich breit. Der Rand von Nachricht zum Fenster ist so groß wie in Figma.
- **Dateien:**
  - `Views/Chat/ChatView.swift:35`: `columnWidth = pt1200`. Figma: Blase bis 560. **Entschieden:** Breiten und Ränder kommen aus Figma (Bildschirm 1, live geprüft in Schritt 0).
  - `ChatView.swift:87`: Composer mit `.frame(maxWidth: columnWidth)`. `ComposerView.swift:51`: eigenes Padding 12.
  - `ChatView.swift:186–189`: Liste mit `.padding(.horizontal, md)`, dann frame, innen in der ScrollView. Der Scrollbalken kann die Breite verschieben (nicht belegt).
  - `MessageRow.swift`: Blasen-Padding.
- **Deckt:** L14 (D18), L15 (D20), Figma Bildschirm 1 Einzelchat (148:90553), Maß „Blase bis 560“
- **Prüfung:** Layout-Messpunkte (`probe`) für Composer und Spalte in `SelfTestLayout` bei 720, 1100 und 1600 pt Breite: gleiche Kante ±0,5 pt. Snapshot gegen `plan/design/` Bildschirm 1.
- **Größe:** S · **Wer: Claude Code**, weil das Feinarbeit mit lokaler Messung ist.

### 9. Chat-Kopf-Pille: Mitte und gleichzeitig mit der Seitenleiste (L13)
- **Ziel:** Die Pille sitzt in der Mitte des Chats, nicht des Fensters. Beim Ein- und Ausklappen der Seitenleiste wandert sie im selben Takt mit.
- **Dateien:** `Views/Chat/ChatHeaderView.swift:20–33` (Zentrierung über `.frame(maxWidth: .infinity)`, Kommentar l.30 „keine eigene Animation“), `:54` (`.ultraThinMaterial`), `MainWindow.swift:38` (Seitenleisten-Animation am Fenster), `Theme.Motion.sidebar`
- **Deckt:** L13 (D17), Animationsfehler Teil „Kopf“, Figma Chat-Kopf / Bildschirm 1
- **Prüfung:** Bildschirmaufnahme vom Ein- und Ausklappen. Probe-Mittelpunkt der Pille = Mitte der Chatspalte ±1 pt, in jedem Frame. Reduce Motion: springt ohne Gleiten.
- **Größe:** S · **Wer: Claude Code**, weil das klein ist und nur lokal sichtbar.

### 10. Fragekarten ohne „Weiter“ bei Einfachauswahl (L12)
- **Ziel:** Bei Einfachauswahl geht es nach dem Klick direkt zur nächsten Frage. „Weiter“ bleibt nur bei Mehrfachauswahl.
- **Dateien:** `Views/Cards/AskPanel.swift:44, 67, 142–147` (Knopftitel „Weiter“/„Senden“, `model.advance()`)
- **Deckt:** L12 (D19), Figma Karten Rückfrage (139:39452)
- **Prüfung:** Selbsttest Fragekarte mit 3 Fragen (einfach, mehrfach, einfach). Unit-Test für das Modell. `xcodebuild test`.
- **Größe:** S · **Wer: Claude Code**, weil es klein ist.

## C. Funktionen und Oberfläche

### 11. Status-Punkte in der Seitenleiste (L3)
- **Ziel:** Fertig = blauer Punkt, braucht dich = oranger Punkt, arbeitet = nur Animation. Die Menüleiste zählt „braucht dich“. **Orange = der Ton des Figma-Tags „Wartet“** (entschieden 03.11.), als Theme-Wert.
- **Dateien:** `Views/SidebarView.swift:377–386` (`StatusDot`, immer `Theme.Status.info`), `Theme.swift:389` (dotSize 8), Statusquelle im Mac-Store, `MenuBar.swift`, Dienst-Status (offene Freigabe oder Frage = braucht dich)
- **Deckt:** L3, E51, D04, Figma „Seitenleiste-Orbi“-Zustände
- **Prüfung:** Unit-Test der Zuordnung von Zustand zu Punkt. Snapshot Seitenleiste mit 3 Orbis (fertig, wartet, arbeitet). Menüleisten-Zahl im Selbsttest.
- **Neu (D05, 03.11.):** Der geöffnete Chat bekommt in der Seitenleiste den grauen Auswahl-Kasten, auch beim Hauptorbi. Ohne Kasten ist der Hauptorbi nur, wenn sein Chat nicht offen ist. Wird in diesem Schritt mitgebaut.
- **Größe:** M · **Wer: Claude Code**, weil es klar und klein über Mac und Dienst geht.

### 12. Dienst-Regeln nach den neuen Entscheidungen (L5, Teil Dienst)
- **Ziel:** Zeiten, Übergabe-Antworten, „Immer“ und Orbi-Anlegen wie entschieden. Die Nachrichten-Grenzen bleiben.
- **Dateien:**
  - E21/E24: `lib/chat/orbi-message.ts:20–21` (30 min/3 min → 60 min/5 min).
  - E20:
    - `orbi-message.ts:29, 32, 87–88` (Auswertung von `result:`). Neu: Status kommt aus dem Ablauf (offene Freigabe oder Frage = wartet, Antwort da = fertig).
    - `lib/chat/agent.ts:271` (Prompt-Pflicht entfernen).
    - Ping-Pong-Ende ohne Präfix.
  - E14: `lib/approvals/rules.ts:97–100` und Mac `Service/CardModels.swift:97`. „Immer“ auch für dauerhaft, nicht für Geheimnis.
  - E25: Neue Orbis nur mit Freigabe. Werkzeug prüfen (`onboarding_create_orbis` in `lib/chat/onboarding.ts:12` und Orbi-Anlegen aus dem Chat).
- **Deckt:** L5 (Kleinigkeiten, Grenzen), E14, E20, E21, E24, E25
- **Prüfung:** Tests in `lib/chat/orbi-message.test.ts` und `lib/approvals/rules.test.ts` sowie `risk.test.ts:148–167` angepasst. `npm run check`.
- **Größe:** M · **Wer: Claude Code**, weil das kleine Eingriffe mit vielen Tests sind.

### 13. think_deep ausbauen, größeres Modell statt Nachdenk-Werkzeug (E37)
- **Ziel:** Das Werkzeug think_deep verschwindet. Bei schweren Teilaufgaben wird auf ein größeres Modell hochgestuft.
- **Dateien:** `lib/chat/think-deep.ts` (l.14 Timeout), `service/src/chat/deep.ts`, `dispatcher.ts`, `lib/jev/stage.ts`, `orbi-message.ts` (thinkDeepPerTask), `step-labels.ts`, `untrusted.ts`, `lib/db/schema.ts` (Spalten bleiben, keine Migration nötig, nur ungenutzt)
- **Deckt:** E37, L5
- **Prüfung:** `rg think_deep` findet nur Archiv und Migrationen. Test: Eine schwere Aufgabe stuft hoch (`lib/jev/stage` Test). `npm run check`.
- **Größe:** M · **Wer: Claude Code**, weil viele kleine Stellen im Dienst betroffen sind.

### 14. Mac-Vereinfachungen: Personalisieren, „Wer antwortet“, Jev-Bereich (L5, Teil App)
- **Ziel:** Personalisieren hat nur noch Name und Aufgabe. In Gruppen gibt es kein „Wer antwortet“ mehr, nur @. Der Jev-Bereich verschwindet aus den Einstellungen.
- **Dateien:**
  - D06: `Orbis/BotEditorModel.swift:8, 24, 51, 133–174`, `BotEditorView.swift:113–119`, `SidePanel.swift:205, 274` („Verhalten“).
  - Alte Anweisungstexte (nach Brain entschieden): Sie werden nicht mehr angezeigt und nicht mehr in den Prompt gegeben. Das Verhalten folgt nur aus Name und Aufgabe (D06). Die Daten bleiben in der DB, kein endgültiges Löschen (E11, L10).
  - D11: `Views/Chat/ComposerView.swift:49` und `:277–300` (`responder`).
  - D12: `Stores/SettingsStore.swift:8–39` (`.jev`), `SettingsView.swift:76`, `SettingsJevView.swift`, `Views/Cards/JevBlock.swift` (alt). Der Jev-Schlüssel bleibt in „Einrichtung“, das Auto-Label in `ComposerParts.swift:127` bleibt.
- **Deckt:** L5, D06, D11, D12 (Jev), E23
- **Prüfung:** `xcodebuild test`. Selbsttest: Editor zeigt 2 Felder, Gruppen-Composer ohne Auswahl, Einstellungen ohne Jev.
- **Größe:** M · **Wer: Claude Code**, weil hier vor allem entfernt wird und das eng am bestehenden Code bleibt.

### 15. Proxy ganz ausbauen: Bilder und Nutzung über die CLIs (L2)
- **Ziel:** Kein Code nutzt den Proxy mehr. Die Nutzungsanzeige läuft über die CLIs.
- **Bilder (entschieden 03.11.):** Zuerst prüfen, ob die Codex-CLI oder die Antigravity-CLI (`agy`) Bilder erzeugen kann. Laut Changelog von `agy` 1.4.12 hat es ein Werkzeug `generate_image` bzw. einen eingebauten Subagenten `image-generator`, der die Bilder als Artefakte speichert. Ob das im Druckmodus geht und wo die Dateien landen, prüft ein kleiner Testlauf in `/tmp` über Constis Abo. Wenn ja, läuft die Bildgenerierung darüber. Wenn nein, wird sie vorerst ausgebaut, und Consti bekommt eine kurze Meldung.
- **Dateien:**
  - `lib/proxy.ts`, `lib/images/{generate,middleware}.ts`.
  - `lib/usage/*`: proxy-call*.ts, loader, aggregate, claude/codex/antigravity.
  - `lib/chat-catalog.ts`, `service/src/routes.ts`, `phase5-api.ts:7, 53`.
  - Health-Zeile proxy und `lib/search/web.ts` (Kommentar).
  - Mac: `ComposerModels.swift` (`proxyOnline`), `ComposerView.swift:44`, `CardModels.swift`, `AutomationFormView.swift`, `ChatView.swift`.
- **Deckt:** L2, E59
- **Prüfung:** `rg -i proxy` in lib, service und mac findet nichts außer Archiv und Migrationen. Nutzungs-Endpunkt liefert echte CLI-Werte (Claude und Codex). `npm run check` und `xcodebuild test`.
- **Größe:** L · **Wer: Claude Code**, weil die Datenquelle nur mit echten, angemeldeten CLIs am Mac zu klären ist.

### 16. Einstellungen neu: Nutzung im Figma-Stil, ein gemeinsamer Marktplatz (L5/D12)
- **Ziel:** Neuer Bereich „Nutzung“ nach Figma. Marktplatz, Plugins und Konnektoren werden ein Bereich (D12-Markt). Alle Einstellungsseiten im Figma-Stil. Nutzung folgt der Figma-Vorlage 143:54295 (Schritt 0). Der gemeinsame Bereich heißt „Marktplatz“ und enthält alles inkl. Konnektoren; der Figma-Punkt „Verbindungen“ fällt weg (Consti 03.11., 16:31). Navigation: Allgemein, Nutzung, Darstellung, Orbis, Marktplatz. Seiten ohne Figma-Bild werden aus vorhandenen Bausteinen im Figma-Stil gebaut, nichts wird frei erfunden (D12, D02, L5).
- **Dateien:** `Views/Settings/*` (SettingsView, SettingsMarketplaceView 394 Zeilen, SettingsConnectorsView 203 Zeilen, Nutzung), `Stores/SettingsStore.swift`
- **Deckt:** D12 (Nutzung im Figma-Stil, entschieden 03.11.), L5, Figma Karten „Einstellungen Nutzung/Marktplatz“, Bildschirme Einstellungen (live geprüft in Schritt 0)
- **Prüfung:** Snapshots gegen `plan/design/`. `xcodebuild test`. Klickpfad: jeder Bereich öffnet sich.
- **Größe:** L · **Wer: Terra**, weil das ein großer, klar umrissener UI-Neubau nach Vorlage ist. Erst nach 14 und 15 (Datenform der Nutzung).

### 17. Design-Reste aus Figma (L4) und offene Karten
- **Ziel:**
  - Die Liste „Geplant“ fällt weg.
  - Neu nach Figma: Link-Karten, Zeitstempel-Trennzeilen, Filter-Chips. Wo die Filter-Chips stehen, steht nicht im Brain. Schritt 0 klärt das in Figma live; bleibt es unklar, gilt Frage F10.
  - Neu ebenfalls: die offenen Karten Fehler, Automation-Lauf, „Unterbrochen/Weiter“, „Nochmal“ und Freigabe in Gruppen mit neutralen Knöpfen.
- **Dateien:**
  - Geplant: `Views/Automations/PlannedView.swift`, `App/ScreenshotPlanned.swift`, `SelfTestPlanned.swift`, `AppModel.swift:145` (`case planned`), `MainWindow.swift:219`, `MenuBar.swift:56`, dazu SidebarView, SidePanel, WebControls, EventsStore, SelfTestLayout und SelfTestKartenLive. Routinen bleiben im Panel (D05).
  - Zeitstempel: `ChatView.swift:~144–151` (`ChatTimestamp.separatorIndices`, schlichter Text).
  - Karten: `Views/Cards/*`, `MessageRow.swift`.
- **Deckt:** L4, Figma §7.2: Chat Link-Karte, Chat Zeitstempel, Liste Filter-Chip, Liste Geplant (entfernen), Karten Fehler/Fehlerkarte, Automation-Lauf, Systemhinweis „Unterbrochen“; DESIGN-SYSTEM §10 l.494
- **Prüfung:** Karten-Galerie-Snapshots je Zustand gegen `plan/design/`. `rg PlannedView` ist leer. `xcodebuild test`.
- **Größe:** L · **Wer: Terra**, weil die Vorlagen klar sind und es viele eigenständige Bausteine sind.

### 18. Hover-Leiste mit Antworten und neues Info-Feld (L8, Teil Oberfläche)
- **Ziel:** Beim Überfahren einer Nachricht erscheint eine Leiste (D21, L8). Bei Orbi-Antworten **rechts** neben der Blase: Emoji, Kopieren, Antworten und die drei Info-Punkte (Info inkl. Token-Verbrauch). Bei Constis eigenen Nachrichten **links** neben der Blase wie in Figma 26:10863, Reihenfolge Emoji, Kopieren, Antworten, ohne Info-Punkte (Consti 03.11., 16:31). Gebaut wird sie aus vorhandenen Figma-Bausteinen („Chat Aktionen“). Das Info-Feld wird schlicht. „Antworten“ zitiert die Nachricht im Eingabefeld und gibt den Bezug an den Orbi mit.
- **Dateien:** `Views/MessageRow.swift:167–178` (`actions`: heute Kopieren, Reagieren, Info), `:216` CopyAction, InfoAction, Composer (Zitat-Chip), Dienst: Nachricht mit `replyTo` und Prompt-Kontext
- **Deckt:** L8 (Hover-Leiste, Info), D21, D10, Figma „Chat Aktionen“ (unsichtbar/sichtbar/Kopieren hover/kopiert)
- **Prüfung:** Snapshot der Leiste in 4 Zuständen. Test im Dienst: `replyTo` steht im Prompt. Klick: Antworten → Zitat → Senden.
- **Größe:** L · **Wer: Terra**, weil es ein neuer, klar umrissener Baustein über App und Dienst ist.

### 19. Tokens je Antwort senken (L8, Teil Tokens)
- **Ziel:** Messen, woraus der Prompt einer Antwort besteht (Grundanleitung, Werkzeugliste, orbit_context, Verlauf). Dann kürzen, ohne dass die Antworten schlechter werden.
- **Dateien:** `lib/chat/agent.ts`, Werkzeugbrücke in `lib/cli/*`, `lib/chat/notice.ts`, `turn_usage`
- **Deckt:** L8 (Tokens), E04
- **Prüfung:**
  - Vorher/Nachher-Tabelle mit 10 festen Prüfaufträgen (Token und Antwort).
  - Ziel (nach Brain entschieden, L8/E40): Kürzen, so weit die Antwortqualität gleich bleibt, ausgehend von heute 10 000–13 000 Token für eine einfache Antwort. Kein fester Zahlenwert. Abnahme: Die 10 Prüfaufträge sind gleich gut, und der CLI-Cache bleibt nutzbar (Cache-Treffer vorher und nachher etwa gleich).
  - `npm run check`.
- **Größe:** M · **Wer: Claude Code**, weil es echte Messungen mit den lokalen CLIs braucht.

### 20. Animationen neu nach der freigegebenen Liste (L6)
- **Ziel:** Die Orbi-Animationen sind wie in der Liste aus Schritt 6 und wie in Figma: flüssig, ohne Springen und Ruckeln, und sie beachten „Bewegung reduzieren“.
- **Dateien:** `Views/FigureView.swift` (ganz), `Orbis/OrbiBehavior.swift`, AvatarPlayer und Lab-Animationen (beide bleiben, entschieden 03.11.), `MainWindow.swift:37–38`, `ChatView.swift:90–91, 193–195, 350`, `SidePanel.swift:33`
- **Deckt:** L6, D16, Animationsfehler (Behebung), Figma „Posen“ 145:58794, „Animationen – Orbis“ 147:59236, §9 Tabelle
- **Prüfung:**
  - Aufnahme: Chatwechsel, Seitenleiste und Panel ohne Sprung.
  - Frame-Zeit mit Instruments ≤ 16,7 ms bei 5 Figuren.
  - Reduce Motion im Selbsttest.
  - Abnahme durch Claude Code am Mac.
- **Aufteilung der Quellen (nach Brain entschieden, D16 und Brain l.10):** Beide Quellen bleiben (P2). Für Zustände, die §9 (Figma) beschreibt, gilt §9: idle, selected, head, message, working, waiting, done. Die Lab-Animationen gelten für Zustände ohne Figma-Vorgabe: Hört zu (listen-1, solange ein Entwurf im Eingabefeld steht), Fehler, Pausiert (Limit), Editor. work-1 wird durch §9 working ersetzt. Dabei fallen aus AVATAR-ANIMATIONEN.md weg:
  - wait-2 „Hibbeln“ nach 30 s (§9: wartet ohne Hüpfer)
  - Augen folgen nur direkt über dem Orbi (§9 idle: Augen folgen im Feld)
  - done-3 statt der §9-Feier
  Die Liste in Schritt 6 zeigt das Consti zur Abstimmung (L6).
- **Größe:** L · **Wer: Terra**, weil es ein großer, klar umrissener Neubau ist. Erst nach dem Haltepunkt bei Schritt 6.

### 21. Kalender, Apple-Erinnerungen und Karten für Entwurf, Betrag und Geheimnis (L1, Teil 1)
- **Ziel:**
  - Kalender: lesen und anlegen ohne Freigabe (E54). Einladen, löschen **und ändern** mit Freigabe (E54; L1 nennt „Termine bearbeiten/löschen/einladen (mit Freigabe, E54)“).
  - Neu: Apple-Erinnerungen über **EventKit** in der Mac-App, mit einmaligem Erlaubnis-Dialog (entschieden 03.11.).
  - Eigene Karten für Entwurf (Senden), Betrag und Geheimnis, gebaut aus vorhandenen Figma-Bausteinen (Freigabe-Karte), entschieden 03.11.
- **Dateien:** `service/src/icloud-calendar.ts:39, 50` (heute nur `calendar_list` und `calendar_create`), `lib/icloud-calendar/client.ts`, `lib/approvals/risk.ts`, `Views/Cards/ApprovalCard.swift`
- **Deckt:** L1, E54, Figma Karten Freigabe (139:39452)
- **Prüfung:** Tests gegen einen CalDAV-Mock (anlegen ohne Karte; ändern, einladen und löschen nur mit Freigabe). EventKit-Test mit Mock. Live einen Termin anlegen, ändern und löschen. Snapshots der 3 Karten.
- **Größe:** L · **Wer: Terra**, weil es klar umrissene neue Werkzeuge nach bestehendem Muster sind.

### 22. Marktplatz mit vielen Anbietern, Outlook und Spotify (L1, Teil 2)
- **Ziel:** Der Marktplatz bindet die in Schritt 5 gewählten Anbieter an (Composio ist einer davon). Outlook, Google und Spotify kommen darüber, ohne Hintergrund-Scan.
- **Dateien:** `lib/connectors/*`, `service/src/plugins.ts`, Marktplatz-Ansicht aus Schritt 16
- **Tokens der Anbieter (nach Brain entschieden, E49 und E07):** im macOS-Schlüsselbund, Dienst `de.consti.orbit2`, nur schreiben, nie anzeigen („gesetzt ✓“), nie loggen oder committen. Nicht in der SQLite und nicht in Dateien.
- **Deckt:** L1, E49, E52, E55, E64
- **Prüfung:** Ein Konnektor je Anbieter ist verbunden und liest einmal echt. Tests. Kein Aufruf ohne Nutzeraktion (Log).
- **Größe:** L · **Wer: Terra**, weil das ein großer Neubau ist. Erst nach Consti's Wahl in Schritt 5 und nach Schritt 16.

### 23. Figma-Rest und Erststart
- **Ziel:**
  - „Ersten Orbi erstellen“ nur mittig und nur, wenn alle Orbis gelöscht sind (E62). Erststart heißt Einrichtung, dann Onboarding.
  - Dazu: Dialoge „Löschen?“ und „Neuer Skill“, Plan-Hinweis, Befehlsmenü, Onboarding 5/6 dunkel, Hellmodus.
  - Funkeln ohne feste Werte (D02), Gedächtnis-Reiter weniger eng.
- **Dateien:** `AppModel.swift` (showsOnboarding), `MainWindow.swift`, Onboarding-Views, `Views/Dialogs/*`, Befehlsmenü, Funkeln (Systemfarben, feste Dauer), Panel-Reiter Gedächtnis
- **Deckt:** E62, D02, Figma Onboarding 164:116621, Bildschirm 5, Dialog Löschen, Dialog Neuer Skill, Plan-Hinweis, Befehlsmenü (§7.2)
- **Prüfung:** Snapshots gegen `plan/design/`, hell und dunkel. Suche nach `Color(`, `.padding(<Zahl>` und `.animation(` ohne Theme ist leer (§11).
- **Größe:** M · **Wer: Claude Code**, weil es viele kleine Abgleiche sind.

## D. Abschluss

### 24. Gesamtprüfung, Backup, Installation in einem Zug
- **Ziel:** Alles grün, ein Backup, dann einmal installieren. Danach den Stand im Brain eintragen.
- **Dateien:** `scripts/install.sh --ohne-start`, `plan/STATUS.md`, Brain-Stand-Zeile in `02 Projekte/Orbit/Orbit.md`
- **Deckt:** E02, E03, E58
- **Prüfung:** `npm run check`, `xcodebuild test`, Selbsttest der App (unsichtbar), Health alle „ok“.
- **Größe:** M · **Wer: Claude Code**, weil das lokal läuft.

### 25. Live-Test mit echten Orbis (L9)
- **Ziel:** Die Liste aus L9 einmal echt durchgehen und das Ergebnis je Punkt melden:
  - Einrichtung, Onboarding, Chat, Gruppe, Freigaben, Rückfragen
  - Gedächtnis und Träumer, Automationen, Mitteilungen
  - Desktop, Coding, Marktplatz, Einstellungen, Dateien
  - Jev-Schlüssel, Google-CLI (`agy`, Ausweg Gemini-CLI)
- **Dateien:** keine (nur Test). Fehler werden als neue kleine Schritte notiert.
- **Deckt:** L9
- **Prüfung:** Tabelle je Punkt: geht / geht nicht / Nachweis.
- **Größe:** M · **Wer: Claude Code**, weil es nur am Mac geht.

---

## Animationsfehler: Ursachen aus dem Code (nur gelesen, nicht beobachtet)
Symptom laut Brain l.149: Orbis und Elemente erscheinen an falschen Stellen, Animationen ruckeln.

**Falsche Stellen:**
1. **Figur ist eine AppKit-Ebene.** `FigureView.swift:58–98` (`FigureLayerView`, eigene CALayer), eingebettet über `LiveFigure` `:319–332`. SwiftUI-Übergänge wie `.transition(enter)` (Opacity + Offset, `ChatView.swift:350`) und Clip-Formen greifen auf die NSView nicht sauber. Die Blase gleitet, die Figur steht schon am Ziel oder woanders.
2. **Figur malt über ihren Rahmen hinaus.** `FigureView.swift:85` `masksToBounds = false` und der vergrößerte Inhaltsrahmen mit Rand 24/80 bei `:93–97` lassen die Figur über Nachbarn und Clips ragen.
3. **Fensterweite implizite Animationen.** `MainWindow.swift:37` `.animation(panel, value: orbis.first?.id)` und `:38` `.animation(sidebar, value: sidebarCollapsed)` hängen am ganzen Fenster. Beim Laden der Orbis oder nach dem Onboarding animiert das ganze Layout mit, und alles gleitet von der falschen Startposition herein.
4. **Chat laden zählt als „neue Nachrichten“.** `ChatView.swift:193–195` animiert auf `messages.map(\.id)`, und bei `:90–91` steht dieselbe Animation noch einmal außen, also doppelt. Beim Laden oder Wechseln gleiten alle Zeilen auf einmal herein, während `scrollTo` animiert (`:278, 300, 308`).

**Ruckeln:**
5. **Neu malen bei jedem Layout.** `FigureView.swift:164–171` `layout()` rendert bei jedem Layout-Durchlauf synchron ein neues CGImage. Während der Seitenleisten- oder Panel-Animation passiert das in jedem Frame für jede sichtbare Figur.
6. **Ein Timer auf dem Hauptthread, grobes Raster.** `FigureView.swift:17–50` nutzt einen gemeinsamen Timer mit 1/48 bzw. 1/30 je Figur (`:210`) und rendert die CGImages auf dem Hauptthread. Das konkurriert mit Scrollen und SwiftUI-Animation, und das Raster liegt unter der Bildwiederholrate.
7. **Zwei Bewegungssysteme.** OrbiBehavior-Stimmungen und AvatarPlayer (JS-Lab) sind in `FigureView.swift:112–129, 244–249` verbunden. Beim Wechsel wird die Signatur zurückgesetzt (`:104–108`), und die Figur springt ohne Überblendung. Dazu widersprechen sich `plan/AVATAR-ANIMATIONEN.md` und DESIGN-SYSTEM §9.
8. **Panel und Kopf doppelt animiert.** `SidePanel.swift:33` und die Seitenleiste am Fenster (`MainWindow.swift:38`). STATUS l.381 sagt dazu selbst „abgeleitet, nicht belegt“. `ChatHeaderView.swift:54`: Material-Unschärfe während der Breitenanimation ist teuer (Vermutung).

Belegt werden die Ursachen in Schritt 6 und behoben in den Schritten 9 und 20. Punkt 7 heißt nicht „ein System streichen“: Beide Quellen bleiben (entschieden 03.11.). Behoben wird der harte Wechsel.

---

## Entschieden am 03.11.
Constis Antworten von 16:14 auf die Plan-Fragen (`antworten.md`, P1–P15):
- **Figma (P1):** Der Coding-Agent bekommt dasselbe Tool wie der Designer (FigCli im Safe Mode). Vorgaben werden vor den UI-Schritten live geprüft (Schritt 0). Bis dahin gelten Export und DESIGN-SYSTEM.
- **Animationen (P2, P14):** Beide Quellen bleiben: §9 **und** die Lab-Animationen. Schritte 6 und 20.
- **Orange (P3):** Ton des Figma-Tags „Wartet“. Schritt 11.
- **Bilder (P4):** Erst prüfen, ob Codex- oder Antigravity-CLI Bilder kann, sonst vorerst ausbauen. Schritt 15.
- **Erinnerungen (P5):** EventKit. Schritt 21.
- **Breiten (P6):** Figma-Werte. Schritt 8.
- **Hover-Leiste und Karten für Entwurf, Betrag, Geheimnis (P7):** aus vorhandenen Bausteinen. Schritte 18 und 21.
- **Google-Anmeldung (P8):** Consti meldet sich selbst an, wenn nötig (Consti-Schritt). Schritt 4.
- **Nachtrag 03.11.: Antigravity statt Gemini-CLI.** Für Google wird die Antigravity-CLI `agy` genutzt, wenn sie angemeldet ist. Die Gemini-CLI ist nur noch der Ausweg. Bilder laufen zuerst über die Codex-CLI oder `agy`, sonst werden sie vorerst ausgebaut. Schritte 4, 15 und 25.
- **Rest (P9):** Coding entscheidet nach dem Brain, Unklares wird gefragt. Siehe unten.
- **Hover-Leiste (P10):** rechts neben der Nachricht (D21). Schritt 18.
- **Kalender (P11):** wie E54, anlegen ohne Freigabe, einladen und löschen mit Freigabe. Schritt 21.
- **Commits (P12):** klein, wie E09. Gilt für alle Schritte.
- **Nutzung (P13):** im Figma-Stil wie D12. Schritt 16.
- **Terra (P15):** pro Schritt erst ein Kurzplan, dann „Start“. Gilt für die Schritte 16, 17, 18, 20, 21 und 22.

**Nach dem Brain entschieden (P9):**
- **Alte Personalisieren-Texte:** nicht mehr zeigen und nicht mehr nutzen. Das Verhalten kommt nur aus Name und Aufgabe (D06). Die Daten bleiben in der DB, weil endgültiges Löschen eine Freigabe braucht (E11) und nichts endgültig gelöscht wird (L10). Schritt 14.
- **Einstellungsseiten ohne Bild (16):** Bau aus vorhandenen Bausteinen im Figma-Stil (D12: „Einstellungen ohne Figma-Vorlage … im Figma-Stil gestalten“; L5; D02).
- **Animationen §9 gegen AVATAR-ANIMATIONEN.md (20):** Auch wenn beide Quellen bleiben, gibt es noch echte Konflikte bei Wartet, Fertig und dem Augen-Folgen. Entschieden: §9 gilt für die Zustände, die Figma beschreibt (D16 „genau so wie in Figma“; Brain l.10: das Brain und neuere Vorgaben schlagen ältere Dokumente). Lab-Animationen gelten für Hört zu, Fehler, Pausiert und Editor. Die Liste in Schritt 6 zeigt das Consti (L6).
- **Termin ändern (21):** mit Freigabe (L1: „Termine bearbeiten/löschen/einladen (mit Freigabe, E54)“). E54 selbst nennt nur Einladen und Löschen. Die vorige Planfassung lag hier falsch.
- **Tokens der Anbieter (22):** im macOS-Schlüsselbund, Dienst `de.consti.orbit2`, nur schreiben (E49, E07).
- **Token-Ziel:** kein fester Wert. Kürzen, so weit die Qualität gleich bleibt und der Cache nicht leidet (L8: „ohne Qualitätsverlust“, Ausgangswert 10 000–13 000; E40: „den Cache nicht kaputtmachen“). Schritt 19.

**Nach dem Figma-Abgleich entschieden (03.11., 16:27, Schritt 0, `plan/FIGMA-ABGLEICH.md`):**
- **Blasenbreite (P6, Schritt 8):** Figma-Werte gelten: Blase max. 468 pt (Text 440), nicht 560. `layout/bubble-max` in DESIGN-SYSTEM wird angepasst (Schritt 3/8).
- **Hover-Leiste (D21/F14, Schritt 18, Consti 16:31):** Bei eigenen Nachrichten links neben der Blase wie in Figma (26:10863), Reihenfolge Emoji, Kopieren, Antworten. Bei Orbis rechts neben der Blase, dazu die Info-Punkte (drei Punkte mit Token-Verbrauch). Figma zeigt bisher nur Kopieren + Info; D21 ist neuer und gilt.
- **Nutzung (D12/P13, Schritt 16):** Die vorhandene Figma-Vorlage „Karten Hell/Einstellungen Nutzung“ gilt (Figma zuerst). Von den doppelten Sets gilt **143:54295** (5 Zustände: normal, ab 80 %, Laden, Offline, Fehler; 278 Knoten); 141:44979 ist die ältere Fassung (4 Zustände, ohne „ab 80 %“). Damit ist die Zeile „Einstellungsseiten ohne Bild (16)“ oben für Nutzung überholt.
- **Einstellungen (D12, Schritt 16, Consti 16:31):** EIN Bereich „Marktplatz“ mit allem drin, auch den Konnektoren. Der Figma-Navipunkt „Verbindungen“ (192:18885) fällt weg. Sonst Navigation nach Figma: Allgemein, Nutzung (direkt danach, wie in Vorlage 143:54295), Darstellung, Orbis, Marktplatz. Jev ist laut Plan raus (Schritt 14).
- **Auswahl in der Seitenleiste (D05, neu 03.11., 16:29, Schritt 11):** Der geöffnete Chat hat in der Seitenleiste einen grauen Kasten, auch beim Hauptorbi. Ohne Kasten ist der Hauptorbi nur, wenn sein Chat nicht geöffnet ist.
- **F10, F13 und F14** sind damit beantwortet (Filter-Chips: Bibliothek/Dateien-Panel unter „Dateien suchen“ und Marktplatz unter „Dienste suchen“; Name „Marktplatz“; Hover-Leiste siehe oben).

## Offene Fragen an Consti (stehen nicht im Brain)
1. **F10 Ort der Filter-Chips (L4):** *Durch Schritt 0 geklärt (Bibliothek/Dateien-Panel, Marktplatz).* Das Brain sagt nur „nach Figma bauen“. Zuerst klärt Schritt 0 das in Figma live. Nur wenn Figma es nicht eindeutig zeigt:
   - **a) Dort, wo der Figma-Bildschirm sie zeigt, der Designer bestätigt (empfohlen)**
   - b) Consti nennt die Liste
2. **F13 Name des gemeinsamen Bereichs (16):** *Entschieden: „Marktplatz“, ein Bereich inkl. Konnektoren, ohne „Verbindungen“.* D12 sagt nur „zu einem Bereich zusammenfassen“.
   - **a) „Marktplatz“ (empfohlen; so heißt schon der Figma-Baustein S4 „Karten Einstellungen Marktplatz“)**
   - b) „Erweiterungen“
   - c) Consti nennt einen Namen
3. **F14 Hover-Leiste an Constis eigenen Nachrichten (18):** *Entschieden 16:31: eigene Nachrichten links wie Figma (Emoji, Kopieren, Antworten), Orbis rechts mit Info-Punkten.* D21 und L8 sagen nur „an Nachrichten“.
   - **a) Ja, mit Emoji, Kopieren und Antworten; drei Punkte (Info mit Token) nur an Orbi-Antworten (empfohlen)**
   - b) Nur an Orbi-Antworten
   - c) Überall alle 4 Knöpfe
4. **F11 Archiv-Ort für alte Plan-Dateien (L10):** Das Brain sagt nur „ins Archiv schieben, nichts endgültig löschen“, nicht wohin.
   - **a) `plan/archiv/` im Repo per git mv (empfohlen; bleibt im Verlauf, das Brain bleibt unberührt)**
   - b) Brain `06 Archiv/`

---

## Abdeckung

| Punkt | Inhalt | Schritt |
|---|---|---|
| Figma live | Vorgaben vor den UI-Schritten gegenprüfen (FigCli, Safe Mode) | 0 |
| L1 | Werkzeuge (Kalender, Erinnerungen, Karten, Outlook, Spotify, Marktplatz-Recherche) | 5, 21, 22 |
| L2 | Proxy raus, Bilder und Nutzung über CLIs | 15 (Doku 3) |
| L3 | Status-Punkte blau/orange, Menüleiste | 11 |
| L4 | Geplant raus, Link-Karten, Zeitstempel, Filter-Chips | 17 |
| L5 | Kleinigkeiten und Grenzen, Personalisieren, Wer antwortet, Einstellungen, Jev raus, Nutzung | 12, 13, 14, 16 |
| L6 | Animationen: Liste zuerst, dann Bau | 6, 20 |
| L7 | Gruppen-Fehler, @-Antwort, Träumer | 7 |
| L8 | Tokens, Hover-Leiste, Info-Feld | 18, 19 |
| L9 | Live-Test-Liste | 25 |
| L10 | Offene Änderungen, Doku angleichen und archivieren, Gemini-CLI (jetzt `agy`, Gemini-CLI als Ausweg) | 1, 3, 4 |
| L11 | Brain-Regeldateien nie Anweisung | 2 |
| L12 | Fragekarten ohne Weiter | 10 |
| L13 | Kopf-Pille Mitte, im Takt | 9 |
| L14 | Seitenrand Nachrichten | 8 |
| L15 | Gleiche Breite Eingabe/Nachrichten | 8 |
| Animationsfehler | Ursachen belegen, beheben | 6, 9, 20 |
| Repo-Abgleich | DESIGN-SYSTEM, CODING, AGENTS, API, STATUS, plan/* | 2, 3 |
| Figma: Link-Karte, Zeitstempel, Filter-Chip, Geplant | §7.2 | 0, 17 |
| Figma: Fehler-, Automation-Karte, Unterbrochen/Nochmal, Gruppen-Freigabe | §7.2, §10 | 17 |
| Figma: Chat Aktionen | §7.2 | 18 |
| Figma: Einstellungen Nutzung/Marktplatz | §7.2 | 16 |
| Figma: Posen, Animationen | 145:58794, 147:59236, §9 | 6, 20 |
| Figma: Seitenleiste-Orbi-Zustände | §7.2 | 11 |
| Figma: Kopf-Pille, Bildschirm 1 | 148:90553 | 8, 9 |
| Figma: Bildschirm 5, Dialoge, Plan-Hinweis, Befehlsmenü, Onboarding dunkel, Hellmodus | §7.2, 164:116621 | 23 |
| Figma: Fragekarte | 139:39452 | 10 |
| Brain-Hinweis | Die Nummer E64 kommt im Brain zweimal vor (Abschnitt 7 Marktplatz und Abschnitt „Nicht bauen“). Bitte im Brain umnummerieren lassen, nicht im Repo. | – |
| E-/D-Entscheidungen neu vom 03.11. | E02, E03 → 2, 24 · E06 → 2 · E14, E20, E21, E24, E25 → 12 · E37 → 13 · E39 → 7 · E51/D04 → 11 · E52/E55/E64 → 5, 22 · E54 → 21 · E59 → 15 · D06/D11 → 14 · D12 → 14, 16 · D15 → 3 · D16 → 20 · D17 → 9 · D18 → 8 · D19 → 10 · D20 → 8 · D21 → 18 · E62/D02 → 23 · E09 → alle · E11 → 14 · E40 → 19 · E49 → 22 | siehe links |

**Zählung:** 26 Schritte (0–25), davon 20 Claude Code und 6 Terra (16, 17, 18, 20, 21, 22). Consti-Schritte: in 0 (FigCli bereitstellen), 4 (Google-Anmeldung, nur falls `agy` nicht angemeldet ist), 5 und 6 (Haltepunkte) und vor jedem Terra-Schritt („Start“ zum Kurzplan).
