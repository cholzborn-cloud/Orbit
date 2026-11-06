# Orbit 2: Umstieg auf native Mac-App

> **Hinweis 03.11.2026:** Verlauf, nicht mehr maßgeblich. Es gilt der Umbau-Plan (Entscheidungen E01–E64, D01–D21, L1–L15 im Brain). Der Proxy fällt ganz weg (E59), `think_deep` entfällt (E37), Übergaben ohne `result:` (E20), Zeitgrenzen 60/5 Minuten (E21/E24).

> **Teilweise überholt (21.10.2026):** Entscheidung ist SwiftUI-App + lokaler Node-Dienst, nicht "kein Node". Maßgeblich für Architektur und Reihenfolge ist `plan/MAC-UMBAU.md`. Design, Menüleiste, Mitteilungen, App-Gefühl und Daytona-Regeln hier gelten weiter.

Stand 20.10.2026. Ziel ist eine vollständig lokale Mac-App ohne Web-/Node-Laufzeit. Next.js, React, npm, Trigger.dev, Clerk, Neon und Railway entfallen vollständig. Daytona bleibt ausschließlich für Remote-Desktops/Sandboxes erhalten. Das heutige Orbit-Design wird visuell übernommen, aber nativ in SwiftUI/AppKit umgesetzt.

## 1. Was heute nur lokal geht (Prod erreicht den Mac nie)
| Baustein | Heute | Native App |
|---|---|---|
| Modelle (Claude/Codex/Gemini) | lokaler CLI-Proxy `127.0.0.1:8317` (`lib/proxy.ts`); in der Cloud nicht erreichbar | Native Swift-Dienste sprechen lokale CLIs/Prozesse direkt an; kein Node-Sidecar und kein Tunnel |
| Nutzungsanzeige | Proxy-Management-API `/v8/management/requests/api-call` (`lib/usage/*`) | gleiche Abfragen aus der App, Tokens im Schlüsselbund |
| Bildgenerierung, Websuche | Proxy `/v1/images/generations`, `/v1/responses` (`lib/images`, `lib/search`) | gleich, ohne Worker-Umweg |
| Brain | `brain-server/` + Tunnel (Tailscale/Cloudflare) | direkter Dateizugriff auf den Vault (gleiche Whitelist-Regeln aus `brain-server/src/brain.ts` übernehmen: nur 01/02/04, kein `Fähigkeiten/`, Kopfstück, kein Löschen) |
| Automationen | Trigger.dev Scheduled Task (`automations-tick`), Läufe in der Cloud scheitern am Proxy | `launchd`/App-Hintergrunddienst; Läufe laufen, wenn der Mac an ist; Mitteilungen über `UNUserNotificationCenter` |

## 2. Ersetzen
- **Chat-Agent (Trigger.dev `orbit-chat`)**: Turn-Schleife, Handoff (`AgentChat`), Memory und Tools laufen heute im Trigger-Worker. Nativ: Swift-Agent-Core als langlebiger lokaler Prozess/Actor, Streaming direkt in die UI, Sessions lokal. Die TypeScript-Implementierung dient nur als Verhaltensreferenz und wird nicht mit ausgeliefert.
- **Orbi-Sandbox (Daytona)**: bleibt als einziger Remote-Dienst für Remote-Desktops/Sandboxes erhalten; kein lokaler Ersatz im ersten Umbau.
- **Auth (Clerk)**: Einzelnutzer-App → kein Login und kein Cloud-Auth-Dienst. Heute prüft jede Action `auth()`; diese Nutzergrenze wird durch den lokalen macOS-Benutzer ersetzt.
- **Datenbank (Neon/Postgres)**: nativ SQLite/GRDB lokal (Schema: `lib/db/schema.ts`: bots, chats, chat_members, user_settings, skills, mcp_connectors, bot_connectors, approval_rules, chat_messages_index (FTS5 statt `to_tsvector`), automations, automation_runs, jev_log). Kein Cloud-Sync im ersten Umbau.
- **Transcript-Storage (Trigger Session Streams)**: Verlauf lokal in der DB; „Reload im Stream“ entfällt (Prozess hält die Antwort).
- **Secrets**: `CONNECTOR_SECRET`, `CLI_PROXY_*`, `OPENROUTER_JEV_API_KEY`, `BRAIN_SERVER_TOKEN`, Konnektor-Tokens → Schlüsselbund statt Env-Variablen.
- **Env-Sync (`syncEnvVars`, Railway-Variablen)** entfällt.

## 3. Übernehmen (Logik bleibt)
- Reine Logik in `lib/**` mit Tests (Jev-Routing, Freigaberegeln, Zeitpläne, Skills, Memory-Hash, SSRF-Guard, Crypto, Fehlertexte) → gezielt nach Swift portieren und dieselben Testfälle als XCTest übernehmen. Kein JavaScript-/Node-/npm-Code in der fertigen App.
- Prompt-Bausteine: `lib/orbi/base-instructions.ts`, Jev-Stufen `lib/jev/tiers.ts`, Handoff-Regeln in `trigger/chat.ts` (`systemPrompt`).
- Konventionen: Fehler als Wert, deutsche Texte, jeder Zustand gestaltet.

## 4. Neu in der nativen App
- Oberfläche in SwiftUI/AppKit, aber visuell wie die Web-App: gleiche Farben, Typografie, Abstände, Radien, Seitenleisten, Chat-Bubbles, Orbs, Karten und Animationen. Keine macOS-Standardoptik als Ersatz für das Orbit-Design.
- Menüleisten-Symbol mit Orbi-Status (Orb-Animation), globaler Hotkey, Spotlight/Shortcuts-Aktionen.
- System-Mitteilungen für Automationen und Freigaben (Freigabekarte als Aktionsmitteilung mit „Einmal/Immer/Ablehnen“).
- Diktat und Vorlesen über Systemdienste (`SFSpeechRecognizer`, `AVSpeechSynthesizer`); später Voice-Gespräch.
- Dateien: Drag & Drop, Quick Look, Teilen-Menü; Screenshots/Fenster als Anhang.
- Dunkel/Hell/Akzent vom System; Einstellungen als natives Fenster (gleiche Sektionen: Konto entfällt, Nutzung, Jev, Orbis-Anleitung, Skills, Konnektoren, Marktplatz, Freigaben, Darstellung).
- Auto-Start, Menüleisten-Modus ohne Dock-Symbol, Mehrfenster (Chat je Fenster), Handoff/Continuity zum iPhone später.

## 5. Offene Punkte aus der Web-Version, die nativ gelöst werden
- Prod-Betrieb: Chat/Nutzung/Automationen funktionieren nur mit lokalem Proxy (bekanntes Limit).
- Hintergrundfreigaben: Verfall nach 10 Min ist implementiert; eine sichtbare Karte mit Countdown für verborgene Läufe fehlt (native Mitteilung löst das).
- App-Benachrichtigungen für Automationen (nur Badge in „Geplant“), E-Mail-Benachrichtigung („später“).
- Mutex für Memory gilt nur im Worker-Prozess; nativ ein Prozess = sauber.
- Tools-Marktplatz: Katalog `connectors/catalog.json` bleibt, Remote-Katalog später.
- Anbieter-Limits der Konnektor-Tools ohne `readOnlyHint` gelten als schreibend (z. B. DeepWiki): Freigabekarte erscheint je Aufruf, bis „Immer erlauben“ gesetzt ist.

## 6. Feste Architekturgrenzen
- Alles außer Daytona läuft lokal auf dem Mac; keine Cloud-Worker und keine gehostete Datenbank.
- Daytona bleibt nur für Remote-Desktop/Sandbox-Aufgaben. Es speichert nicht den primären Orbit-Zustand.
- Die ausgelieferte App benötigt weder npm noch Node. Build und Laufzeit sind Swift/Xcode-basiert.
- Hintergrundarbeit läuft unabhängig vom UI-Prozess über einen signierten LaunchAgent/XPC-Dienst; die UI kann geschlossen oder neu aufgebaut werden, ohne laufende Aufgaben zu verlieren.

## 7. Verbindliches App-Gefühl
- Orbit wird als signierte `.app` in einer `.dmg` installiert und startet wie eine normale Mac-App über Dock, Spotlight oder Menüleiste; kein Browserfenster und keine Adresse.
- Navigation, Chatwechsel und Einstellungen erzeugen keinen Seiten-Reload, keinen weißen Flash und keinen erneuten Aufbau des gesamten Fensters.
- Gewollte Orbit-Animationen bleiben: Orbs, Schreibindikator, Streaming, Panel-/Kartenübergänge und Statuswechsel. Entfernt werden nur browserartige Reload-, Hydration- und Server-Ladezustände.
- Laufende Chats und Aufgaben gehören dem dauerhaften Agent-/Hintergrundprozess, nicht einer einzelnen Ansicht. Das Schließen oder Neuaufbauen einer Ansicht unterbricht sie nicht.
