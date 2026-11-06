# Orbit – Neue Verteilung: Codex macht fast alles (Stand 03.11.2026, 16:45 MEZ)

Grund: Consti hat bei Coding wenig Limit. Codex (ChatGPT Terra 6.1 high) arbeitet direkt im Repo auf dem Mac und kann bauen, testen, CLIs starten und die App laufen lassen. Coding macht nur noch, was Codex nicht kann.

## Neue Liste (Schritte 3–25)

| Schritt | Wer | Warum |
|---|---|---|
| 3 Doku angleichen, Archiv | Coding – ERLEDIGT (818f9e94, alle Tests grün) | Ist schon halb fertig, Abbrechen kostet mehr als Fertigmachen. |
| F Figma-Werte für alle UI-Schritte vorab | **Coding** | Figma liest nur Coding über FigCli (Safe Mode); einmal gebündelt in `plan/FIGMA-ABGLEICH.md`, dann braucht Codex kein Figma. |
| 4 agy-Adapter (Google über Antigravity-CLI) | Codex | Reine Code-Arbeit am Mac mit lokalem Testlauf; Abo-Frage hält an und geht an Consti. |
| 5 Marktplatz-Recherche | Codex | Codex kennt die Konnektoren im Repo und kann im Netz suchen; Ergebnis ist eine Datei, Consti wählt. |
| 6 Animationsfehler belegen + Liste | Codex | Codex kann die App am Mac starten und Frames messen; die Figma-Werte (§9, Posen) liefert Coding vorher in Schritt F. |
| 7 Gruppen- und Träumer-Fehler | Codex | Klare Fehler mit Tests im Dienst. |
| 8 Gleiche Breite, Seitenrand | Codex | Kleine SwiftUI-Änderung mit Messpunkten, Werte stehen nach F fest. |
| 9 Kopf-Pille | Codex | Klein und klar, Messpunkt im Selbsttest. |
| 10 Fragekarten ohne „Weiter“ | Codex | Klein und klar. |
| 11 Status-Punkte + grauer Kasten | Codex | Klar umrissen über App und Dienst. |
| 12 Dienst-Regeln | Codex | Viele kleine Stellen mit Tests, genau Codex' Stärke. |
| 13 think_deep ausbauen | Codex | Ausbau mit `rg` und Tests. |
| 14 Mac-Vereinfachungen | Codex | Vor allem Entfernen, nah am Code. |
| 15 Proxy ausbauen, Bilder/Nutzung über CLIs | Codex | Codex kann die angemeldeten CLIs am Mac selbst aufrufen. |
| 16–18, 20–22 | Codex (wie geplant) | Prompts gibt es schon in `terra-prompts.md`. |
| 19 Tokens senken | Codex | Messung über die lokalen CLIs geht direkt im Repo. |
| 23 Figma-Rest, Erststart | Codex | Viele kleine Abgleiche; Werte kommen aus F. |
| 24 Gesamtprüfung, Installation | Codex baut und installiert, **Coding prüft ab** | Installieren geht lokal; Coding schaut einmal unabhängig drauf und gibt Toni die Stand-Zeile fürs Brain. |
| 25 Live-Test | Codex + Consti, **Coding wertet aus** | Echte Orbis braucht Consti am Mac; Coding gleicht das Ergebnis mit L9 ab. |
| P Prüfen nach jedem Block | **Coding** | Unabhängige Kontrolle (Tests, Diff gegen Brain und Plan). Sparsam: nur nach Block B (7–10), C1 (11–15), C2 (16–19), Rest (20–23). |
| Brain-Abgleich | **Coding meldet, Toni schreibt** | Das Brain fasst nur Toni an. |

Zählung neu: Coding = 3 (Rest), F, 4 Prüfungen, Abnahme 24/25. Codex = 4–25 (20 Schritte). Weniger Starts: 8+9+10 und 12+13 können je als EIN Codex-Lauf gehen.

Reihenfolge: 3 → F → 4 → 5 und 6 (Haltepunkte, Consti wählt) → 7 → 8–10 → P → 11 → 12+13 → 14 → 15 → P → 16 → 17 → 18 → 19 → P → 20 (nach Freigabe 6) → 21 → 22 (nach Wahl 5) → 23 → P → 24 → 25.

## Regeln für JEDEN Codex-Schritt (gehören in jeden Prompt)
- Repo `~/Projekte-Coding/Orbit`. Nur lokal: kein Push, kein GitHub, kein Deploy, nichts ins Netz hochladen.
- Erst Kurzplan, dann auf „Start“ warten.
- Verbindlich ist das Brain `Second Brain/02 Projekte/Orbit/Orbit Entscheidungen.md` (nur lesen, nie schreiben) und `umbau-plan.md` (Kopie liegt im Repo-Plan bzw. bei Coding). Figma-Werte nur aus `plan/FIGMA-ABGLEICH.md`, nichts erfinden.
- `secrets.env` und `.env*` nie lesen. Keys nie in Code, Logs oder Commits.
- Nichts löschen: Dateien per `git mv` nach `plan/archiv/` oder `mv` nach `~/.Trash`. Datenbank-Daten bleiben.
- Nicht installieren (außer Schritt 24), keine neuen Pakete ohne Rückfrage.
- Kleine Commits, deutsch, „Bereich: was“, keine E-Mail, kein Co-Authored-By.
- Fertig erst, wenn `npm run check` bzw. `xcodebuild test` (unsigniert) grün ist; Ergebnis mit Testzahlen melden. Vorher-Stand: 365 + 201 bzw. 156 Tests.
- `plan/STATUS.md` Abschnitt „Laufend“ pro Schritt eine Zeile.
- Unklar oder Widerspruch zum Brain: anhalten und fragen, nicht raten.

## Kurz-Briefings für die neuen Codex-Schritte

### 4 – agy-Adapter
Google-Modelle laufen über die Antigravity-CLI `agy` (`~/.local/bin/agy`, 1.4.12) wie Claude und Codex. Neuer Adapter in `lib/cli/` (Druckmodus `agy -p … --output-format json|stream-json`, `--model`, `--print-timeout`), Erkennung in `lib/cli/{types,locate}.ts`, Health-Zeile in `service/src/phase5-api.ts`. Gemini-Adapter bleibt als Ausweg. Fertig: `/v1/health/checks` meldet „agy ok“, ein Testauftrag an einen Google-Orbi gegen eine DB-Kopie in `/tmp` antwortet und nutzt ein Werkzeug über `<orbit_tool_call>`. **Vorher anhalten**, wenn unklar ist, ob `agy` über Constis Abo oder Pay As You Go abrechnet; nicht selbst anmelden.
Vorab gelesen (03.11., 16:40): `agy` ist über ein Google-Privatkonto angemeldet (`authMethod=consumer`, kein API-Schlüssel, kein Abrechnungsprojekt, also kein Hinweis auf Pay As You Go). Gemini-CLI ist NICHT installiert und lehnte laut Brain-Notiz vom 02.10. Google-Anmeldungen ab (`UNSUPPORTED_CLIENT`), taugt also kaum als Ausweg. Modellnamen bei agy: `gemini-3.8-flash-high|medium|low`, im Katalog steht `gemini-3.8-flash` (Anbieter „gemini“) – angleichen. Ansatzstellen: `lib/cli/adapters.ts` (Gemini-Adapter „UNGEPRÜFT“), `lib/cli/types.ts` (`CliProvider`, `CLI_FIX`), `lib/cli/locate.ts`, `lib/cli/status.ts` (Gemini-Zweig meldet heute immer „ok“), `lib/cli/process.ts`, `lib/cli/workdir.ts` (`workdirFor`), `lib/chat-catalog.ts`, Health über `checkAllClis` in `service/src/phase5-api.ts` und `lib/work/health.ts`.

Nebenbei (Consti 03.11., Ja): `plan/PLAN.md`, `plan/PROMPTS.md` und `plan/GOAL.md` per `git mv` nach `plan/archiv/` verschieben, nicht löschen; Verweise darauf in `plan/` und im Code anpassen (`rg` danach leer außer Archiv). Eigener kleiner Commit „Plan: PLAN, PROMPTS, GOAL archiviert“.

### 5 – Marktplatz-Recherche (kein Bau)
Liste der Anbieter, über die Orbit Konnektoren anbieten kann (Composio als einer davon), in `plan/MARKTPLATZ-RECHERCHE.md`: je Anbieter was er abdeckt (v. a. Outlook, Google, Spotify), wie die Anmeldung läuft, Kosten, Eignung für lokal-only. Bestehendes in `lib/connectors/*` und `service/src/plugins.ts` mit einbeziehen. Am Ende eine Empfehlung als Auswahl. Haltepunkt: Consti wählt. Nichts bauen, nichts anmelden.

### 6 – Animationsfehler belegen + Animationsliste (kein Umbau)
Die 8 vermuteten Ursachen aus Abschnitt „Animationsfehler“ in `umbau-plan.md` je als „belegt“ oder „nicht belegt“ markieren, mit Messwert (Frame-Zeiten, Probe-Positionen im Selbsttest) oder Aufnahme. Dazu `plan/ANIMATIONEN-LISTE.md`: welche Animation wann und wo, aus DESIGN-SYSTEM §9 und `plan/AVATAR-ANIMATIONEN.md` zusammengeführt (beide Quellen bleiben; §9 für idle, selected, head, message, working, waiting, done; Lab für Hört zu, Fehler, Pausiert, Editor; wegfallende Lab-Teile benennen), mit weichen Übergängen. Haltepunkt: Consti gibt die Liste frei. Kein Code-Umbau.

### 7 – Gruppen- und Träumer-Fehler
In Gruppen startet nichts doppelt (Verdacht: Mac-Wiederaufnahme `ChatSession.swift:86` plus Dispatcher starten beide), ein @-Markierter antwortet sicher auch bei leerer Erstantwort, der Träumer (`lib/orbi/dream.ts`) verändert nie Einträge mit `stated` – egal welcher Typ, gesperrt für remove, merge und rewrite (E39). Fertig: neue Tests für alle drei Fälle grün, `npm run check`.

### 8 – Gleiche Breite und Seitenrand
Eingabefeld und Nachrichtenspalte sind bei jeder Fensterbreite gleich breit (L15), Rand Nachricht–Fenster wie Figma (L14). Werte aus FIGMA-ABGLEICH: Blase max. 468, Text 440. Stellen: `ChatView.swift:35, 87, 186–189`, `ComposerView.swift:51`, `MessageRow.swift`. Fertig: Probe-Messpunkte in `SelfTestLayout` bei 720, 1100, 1600 pt zeigen gleiche Kante ±0,5 pt.

### 9 – Kopf-Pille
Pille sitzt in der Mitte der Chatspalte, nicht des Fensters, und wandert beim Ein-/Ausklappen der Seitenleiste im selben Takt mit. Stellen: `ChatHeaderView.swift:20–33, 54`, `MainWindow.swift:38`, `Theme.Motion.sidebar`. Fertig: Probe-Mittelpunkt = Spaltenmitte ±1 pt in jedem Frame; „Bewegung reduzieren“ springt ohne Gleiten.

### 10 – Fragekarten ohne „Weiter“
Einfachauswahl geht nach dem Klick direkt weiter, „Weiter“ nur bei Mehrfachauswahl (`Views/Cards/AskPanel.swift:44, 67, 142–147`). Fertig: Unit-Test fürs Modell, Selbsttest mit 3 Fragen (einfach, mehrfach, einfach), `xcodebuild test`.

### 11 – Status-Punkte und grauer Kasten
Fertig = blauer Punkt, braucht dich = oranger Punkt (Ton des Figma-Tags „Wartet“, als Theme-Wert), arbeitet = nur Animation; Menüleiste zählt „braucht dich“. Geöffneter Chat bekommt in der Seitenleiste den grauen Kasten, auch der Hauptorbi (D05). Stellen: `SidebarView.swift:377–386`, `Theme.swift`, `MenuBar.swift`, Dienst-Status. Fertig: Unit-Test Zustand→Punkt, Snapshot mit 3 Orbis, Menüleisten-Zahl im Selbsttest.

### 12 – Dienst-Regeln
Zeiten 30/3 min → 60/5 min (`lib/chat/orbi-message.ts:20–21`); Status nicht mehr aus `result:`, sondern aus dem Ablauf (offene Freigabe/Frage = wartet, Antwort da = fertig), Prompt-Pflicht in `lib/chat/agent.ts:271` weg, Ping-Pong-Ende ohne Präfix (E20); „Immer“ auch für dauerhaft, nie für Geheimnis (`lib/approvals/rules.ts:97–100`, `CardModels.swift:97`, E14); neue Orbis nur mit Freigabe (E25). Fertig: angepasste Tests in orbi-message, rules, risk grün.

### 13 – think_deep raus
Werkzeug think_deep verschwindet, schwere Teilaufgaben stufen stattdessen auf ein größeres Modell hoch (E37). Stellen: `lib/chat/think-deep.ts`, `service/src/chat/deep.ts`, `dispatcher.ts`, `lib/jev/stage.ts`, `orbi-message.ts`, `step-labels.ts`, `untrusted.ts`; DB-Spalten bleiben ungenutzt, keine Migration. Fertig: `rg think_deep` nur noch Archiv/Migrationen, Test für das Hochstufen.

### 14 – Mac-Vereinfachungen
Personalisieren nur noch Name und Aufgabe (D06; alte Texte nicht mehr zeigen und nicht in den Prompt, Daten bleiben in der DB); in Gruppen kein „Wer antwortet“, nur @ (D11); Jev-Bereich raus aus den Einstellungen, Jev-Schlüssel bleibt in „Einrichtung“ (D12). Stellen stehen in `umbau-plan.md` Schritt 14. Fertig: `xcodebuild test`, Selbsttest zeigt 2 Felder im Editor, Composer ohne Auswahl, Einstellungen ohne Jev.

### 15 – Proxy raus
Kein Code nutzt den Proxy mehr (L2, E59); Nutzungsanzeige über echte CLI-Werte (Claude, Codex). Bilder: erst mit kleinem Lauf in `/tmp` prüfen, ob `agy` (`generate_image` / `image-generator`) oder die Codex-CLI im Druckmodus Bilder erzeugt und wo sie landen; wenn ja, darüber; wenn nein, Bilder vorerst ausbauen und das in STATUS vermerken. Dateien in `umbau-plan.md` Schritt 15. Fertig: `rg -i proxy` in lib, service, mac nur Archiv/Migrationen; beide Testläufe grün.

### 19 – Tokens senken
Messen, woraus der Prompt einer einfachen Antwort besteht (Grundanleitung, Werkzeugliste, orbit_context, Verlauf; heute 10 000–13 000 Token), dann kürzen ohne Qualitätsverlust und ohne den CLI-Cache zu zerstören (L8, E40, E04). Fertig: Vorher/Nachher-Tabelle mit 10 festen Prüfaufträgen (Token, Antwort, Cache-Treffer), `npm run check`.

### 23 – Figma-Rest und Erststart
„Ersten Orbi erstellen“ nur mittig und nur, wenn alle Orbis gelöscht sind (E62); Erststart = Einrichtung, dann Onboarding. Dazu Dialoge „Löschen?“ und „Neuer Skill“, Plan-Hinweis, Befehlsmenü, Onboarding 5/6 dunkel, Hellmodus, Funkeln über Theme statt fester Werte (D02), Gedächtnis-Reiter luftiger. Werte aus FIGMA-ABGLEICH. Fertig: Snapshots hell/dunkel, Suche nach `Color(`, `.padding(<Zahl>`, `.animation(` ohne Theme ist leer.

### 24 – Gesamtprüfung und Installation
Backup nach `~/Projekte-Coding/Backups/Orbit/<Datum>/` (ohne node_modules/Build), `npm run check`, `xcodebuild test`, Selbsttest, Health alle „ok“, dann einmal `scripts/install.sh --ohne-start`. STATUS aktualisieren. Brain NICHT anfassen. Danach prüft Coding ab.

### 25 – Live-Test (mit Consti)
Die L9-Liste einmal echt durchgehen: Einrichtung, Onboarding, Chat, Gruppe, Freigaben, Rückfragen, Gedächtnis/Träumer, Automationen, Mitteilungen, Desktop, Coding, Marktplatz, Einstellungen, Dateien, Jev-Schlüssel, Google über `agy`. Ergebnis als Tabelle geht / geht nicht / Nachweis in `plan/LIVETEST.md`. Fehler als neue kleine Schritte notieren, nicht sofort umbauen.
