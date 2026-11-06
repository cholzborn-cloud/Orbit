# Orbit 2: Umbau zur Mac-App (5 Schritte)

> **Hinweis 03.11.2026:** Verlauf, nicht mehr maßgeblich. Es gilt der Umbau-Plan (Entscheidungen E01–E64, D01–D21, L1–L15 im Brain). Der Proxy fällt ganz weg (E59), `think_deep` entfällt (E37), Übergaben ohne `result:` (E20), Zeitgrenzen 60/5 Minuten (E21/E24).

Stand 21.10.2026. Gehört zu `plan/NATIVE.md` und ersetzt dort die Abschnitte, die "kein Node" sagen (siehe Abschnitt "Was sich gegenüber NATIVE.md ändert"). Entscheidung von Consti (21.10.2026): **SwiftUI-App + lokaler Node-Dienst**, Daytona und MCP bleiben remote.

## Kurzfassung

Das Restaurant aus dem Chat vom 20.10. zieht um. Die Küche (Trigger.dev) steht heute in der Cloud, der Lieferant (Proxy) bei dir zuhause. Nach dem Umbau stehen beide auf deinem Mac.

| # | Schritt | Restaurant | Ergebnis | Aufwand (Schätzung, nicht gemessen) |
|---|---|---|---|---|
| 1 | Datenbank lokal, Login weg | Vorratskammer + Türsteher | Web-App läuft ohne Neon und Clerk | klein bis mittel |
| 2 | Lokaler Dienst `orbitd` statt Trigger.dev | Küche | Chat-Agent läuft auf dem Mac, Web-UI als Testgerät | groß |
| 3 | Swift-Gerüst + Anbindung | Gastraum, Teil 1 | Native App: Sidebar, Chat, Streaming | mittel |
| 4 | Rest der Oberfläche | Gastraum, Teil 2 | Alle Funktionen der Web-App nativ | sehr groß |
| 5 | Einzug und Aufräumen | Umzug | Dienst im Hintergrund, `.app` installiert, Altlast raus | mittel |

**Reihenfolge-Logik:** Jeder Schritt lässt sich einzeln prüfen, und die Web-App bleibt bis Schritt 5 als Vergleich lauffähig. Schritte 1 und 2 brauchen kein Swift, Fehler im Dienst und Fehler in der Oberfläche vermischen sich also nie.

## Zielbild

```
Orbit.app (SwiftUI)  ──HTTP + SSE, nur 127.0.0.1, Token──▶  orbitd (Node/TypeScript, LaunchAgent)
   reine Oberfläche                                          ├─ Agent-Schleife (AI SDK streamText)
   kein Datenbankzugriff                                     ├─ SQLite (einziger Besitzer)
                                                             ├─ Scheduler (Automationen)
                                                             ├─ lib/ unverändert (Jev, Freigaben, Skills ...)
                                                             └─▶ Proxy 127.0.0.1:8317 · Daytona (remote) · MCP (remote) · Brain (Datei)
```

- **Warum die App keine Datenbank anfasst:** Nur ein Prozess schreibt. Das vermeidet Konflikte und spart dir die ganze Datenschicht in Swift.
- **Warum der Dienst getrennt läuft:** Laufende Chats und Automationen überleben, wenn du die App schließt oder neu baust (Regel aus NATIVE.md §6).
- **Sicherheit:** Dienst lauscht nur auf `127.0.0.1`, zufälliger Token in `~/Library/Application Support/Orbit/service.token` (Rechte 0600), jede Anfrage prüft Token und Host-Header (der Brain-Server hatte genau an dieser Stelle schon einen Bug).

## Was bleibt, was geht, was kommt

| Bleibt | Geht | Kommt neu |
|---|---|---|
| `lib/**` samt Tests (Jev, Freigaben, Skills, Memory, SSRF-Guard ...) | Next.js, React, `app/`, `components/` (nach Schritt 5) | `service/` (Dienst) |
| Tools: `trigger/sandbox-tools.ts`, `images.ts`, `search.ts`, `brain.ts`, `connectors.ts` (Logik) | Trigger.dev (`trigger/`-Laufzeit, `@trigger.dev/*`) | `mac/` (Xcode-Projekt) |
| Daytona (`lib/daytona.ts`), MCP-Konnektoren, Proxy | Clerk, Neon, Railway, `proxy.ts` (Next-Middleware) | Tabelle `chat_messages` (Verlauf lokal) |
| `AGENTS.md`, `plan/CONVENTIONS.md`, Design (Orbis, Farben) | `.env`-Werte für Clerk/Neon/Trigger/AWS (AWS wird im Code nicht benutzt) | Scheduler, LaunchAgent, Mitteilungen |

## Was sich gegenüber NATIVE.md ändert

| NATIVE.md sagt | Neu (21.10.2026) | Grund |
|---|---|---|
| §1/§2: Swift-Dienste statt Node-Sidecar, Agent-Core in Swift | Agent-Schleife bleibt TypeScript im Dienst | `lib/`, AI SDK, Daytona-SDK und MCP-Client sind TypeScript. Portierung wäre der größte Einzelposten und bringt nichts |
| §3: Logik nach Swift portieren, Tests als XCTest | `lib/` bleibt, Tests laufen weiter mit `node --test` | siehe oben |
| §6: "App benötigt weder npm noch Node" | App liefert eine Node-Laufzeit im Bundle mit | Dienst braucht sie. Die Oberfläche ist trotzdem 100 % nativ |
| §2: Datenbank SQLite/GRDB in Swift | SQLite im Dienst (Drizzle + better-sqlite3) | ein Besitzer, keine doppelte Datenschicht |
| Rest (Design, Menüleiste, Mitteilungen, App-Gefühl, Daytona) | gilt weiter | |

---

## Schritt 1: Vorratskammer + Türsteher (Datenbank lokal, Login weg)

**Was passiert, einfach erklärt:** Die Datenbank zieht von Neon (Internet) in eine Datei auf deinem Mac. Der Türsteher (Clerk) fällt weg, weil nur du die App benutzt. Die Web-App läuft danach weiter, nur ohne Neon und Clerk. Das ist der sicherste erste Schritt, weil du alles im Browser prüfen kannst.

**Aufgaben**
1. Branch `mac-umbau` von `main`, vorher Tag `web-final` setzen (Rückweg).
2. Drizzle von Postgres auf SQLite umstellen (`drizzle-orm/better-sqlite3`, `drizzle.config.ts` mit Dialekt `sqlite`). Datei: `~/Library/Application Support/Orbit/orbit.sqlite` (Ordner per `ORBIT_DATA_DIR` überschreibbar), WAL-Modus an.
3. `lib/db/schema.ts` (14 Tabellen) übersetzen:

| Postgres heute | SQLite neu |
|---|---|
| `timestamp(..., withTimezone)` | `integer({ mode: "timestamp_ms" })` |
| `jsonb` (`payload`, `schedule`) | `text({ mode: "json" })` |
| `to_tsvector('german', body)` (Index auf `chat_messages_index`) | FTS5-Tabelle `chat_messages_fts`, per Trigger synchron gehalten |
| Teilindizes (`where ...`) | funktionieren in SQLite, 1:1 übernehmen |
| Workaround "Batch statt `db.transaction`" (neon-http) | echte Transaktionen, Workaround entfernen |

4. Login entfernen: `lib/auth` liefert fest `{ userId: "local" }`. So bleiben alle Signaturen mit `userId` unverändert (kleinster Eingriff). Löschen: Clerk-Provider im Layout, `app/sign-in`, `proxy.ts`, Einstellungen "Konto", `ORBIT_ALLOWED_USER_IDS`. 52 Dateien erwähnen Clerk, die meisten nur über `auth()`.
5. Daten übernehmen: Skript `scripts/export-from-neon.ts` kopiert `bots`, `user_settings`, `skills`, `mcp_connectors`, `bot_connectors`, `approval_rules`, `automations` mit `userId = "local"`. **Chats und Verlauf nicht** (Annahme: der Verlauf liegt in Trigger-Sessions, nicht in Neon, und Testdaten sind gelöscht). Das Orbi-Gedächtnis liegt in Daytona (`MEMORY.md`) und bleibt.
6. Hinweis: Bis Schritt 2 läuft der Chat weiter über `trigger dev` (lokal, greift auf dieselbe SQLite-Datei zu). Ein Trigger-Cloud-Deploy funktioniert ab jetzt nicht mehr. Du bist ohnehin nur noch auf localhost.

**Fertig wenn**
- `npm run check` grün.
- `.env.local` ohne `CLERK_*`, `NEXT_PUBLIC_CLERK_*`, `DATABASE_*`, `NEON_*`, `AWS_*`: App startet trotzdem.
- Im Browser: Orbi anlegen, Chat senden (mit `trigger dev`), Suche findet ein Wort aus einem neuen Chat, Automation anlegen und "Jetzt ausführen".

**Prompt für Codex (Sol medium)**
```
Ziel: Orbit 2 läuft ohne Neon und Clerk, Datenbank ist lokales SQLite.
Lies zuerst AGENTS.md, plan/CONVENTIONS.md, plan/MAC-UMBAU.md (Schritt 1).
Branch mac-umbau (Tag web-final auf main zuerst).
1) Drizzle auf sqlite (better-sqlite3), Datei ~/Library/Application Support/Orbit/orbit.sqlite, WAL, ORBIT_DATA_DIR überschreibt.
2) lib/db/schema.ts nach Tabelle in Schritt 1 übersetzen; Volltextsuche als FTS5 mit Sync-Triggern, lib/search + query/search.ts anpassen; neon-http-Batch-Workaround durch Transaktionen ersetzen.
3) lib/auth gibt fest userId "local" zurück; Clerk komplett entfernen (Layout, sign-in, proxy.ts, Einstellungen Konto, Allowlist, Pakete).
4) scripts/export-from-neon.ts nach Plan (ohne Chats). Keine Secrets ausgeben.
Fertig: npm run check grün; App startet ohne Clerk/Neon-Variablen; Tests in lib/ weiter grün. Keine Änderung an trigger/-Logik außer Importen.
Ein Commit je Teil, deutsch, kurz. Kein toter Code.
```

---

## Schritt 2: Küche (lokaler Dienst `orbitd` statt Trigger.dev)

**Was passiert, einfach erklärt:** Der Koch (Agent-Schleife) arbeitet bisher in der Trigger-Cloud und kommt deshalb nicht an deinen Proxy. Jetzt bekommt er eine Küche auf deinem Mac: ein kleines Node-Programm, das dieselben Rezepte aus `lib/` und dieselben Werkzeuge benutzt. Die Web-Oberfläche dient als Testgerät, bis die Swift-App da ist.

**Ordner:** `service/` im selben Repo (eigene `package.json`-Skripte `npm run service`), Code importiert `lib/` über Pfad-Alias. `import "server-only"` bekommt einen Stub.

**Bausteine**

| Heute (Trigger) | Neu im Dienst |
|---|---|
| `chat.agent` `orbitChat` in `trigger/chat.ts` (ab Zeile 557, Turn-Schleife mit `streamText`) | `service/src/chat/turn.ts`: gleiche Schleife, direkt als Funktion |
| `AgentChat` (Handoff an andere Orbis) | interner Aufruf derselben Funktion mit anderem Orbi, Status-Events für die Karte |
| `withApproval` (`trigger/approvals.ts`) wartet auf Freigabe | Promise, das auf `POST /v1/approvals/:id/decide` wartet; Verfall nach 10 Min bleibt |
| `ask-user` (Rückfrage-Chips) | gleiches Muster wie Freigabe |
| `jevAfterTurn` (`schemaTask`) | normale async Funktion nach dem Turn |
| `automationsTick` + `automationRun` | Scheduler im Dienst (Prüfung alle 30 s auf `next_run_at`, beim Aufwachen nachholen), Lauf = normaler Turn |
| Session-Streams (Verlauf, "Reload im Stream") | Tabelle `chat_messages` (Teile als JSON) + Puffer des laufenden Turns im Speicher, `GET /v1/chats/:id/stream` setzt fort |
| Tools (`sandbox-tools`, `images`, `search`, `brain`, `connectors`) | unverändert, nur Trigger-Importe (`tasks`, `logger`) raus |
| `actions/*.ts`, `query/*.ts` (Kellner) | REST-Endpunkte (siehe unten), Logik bleibt, `"use server"` fällt weg |

**Schnittstelle (Entwurf, wird in Schritt 3 als `plan/API.md` festgeschrieben)**
- `POST /v1/chats/:id/turn` → SSE im Format des AI SDK (`toUIMessageStreamResponse`). Konkrete Chunk-Typen aus der Doku in `node_modules/ai` lesen, nicht raten.
- `GET /v1/chats/:id/stream` (laufenden Turn wieder anhängen), `POST /v1/chats/:id/stop`
- `GET /v1/events` (SSE, global): Orbi-Status, neue Freigaben, Automationsläufe. Daraus entstehen später die Mitteilungen.
- CRUD: `/v1/bots`, `/v1/chats`, `/v1/settings`, `/v1/skills`, `/v1/connectors`, `/v1/approvals`, `/v1/automations`, `/v1/search`, `/v1/usage`, `/v1/jev`
- `GET /v1/daytona/:botId/desktop-url`, `GET /v1/health`, `GET /oauth/callback` (ersetzt `app/api/connectors/oauth/callback`)

**Technik-Annahmen (zu bestätigen, wenn Codex etwas Besseres findet):** Hono + `@hono/node-server` für HTTP/SSE, Node 24, `tsx` für Entwicklung, `esbuild` für das Bündel in Schritt 5.

**Testgerät:** In `components/chat/chat.tsx` ersetzt ein Schalter `NEXT_PUBLIC_ORBITD_URL` den `useTriggerChatTransport` durch `DefaultChatTransport` auf den Dienst (CORS nur für `localhost:3000`). Nach Schritt 5 fällt das mit der Web-App weg.

**Fertig wenn** (Browser, wie beim Handoff-Umbau)
- kleine Frage, Websuche, Bildgenerierung, Orbi-Werkzeug mit Sandbox
- Handoff parallel und abhängig, Gruppenchat, Rückfrage-Chips, Freigabekarte (Einmal/Immer/Ablehnen)
- Seite neu laden mitten in der Antwort: Antwort läuft weiter und hängt sich wieder an
- Stopp-Knopf, Proxy aus (Fehlerkarte), Automation "Jetzt ausführen" und ein planmäßiger Lauf
- `grep -r "@trigger.dev" service lib` ist leer, `lib/`-Tests grün, `npm run check` grün

**Prompt für Codex (Sol medium, in 3 Aufträgen: 2a Gerüst + Turn, 2b Freigaben/Handoff/Rückfragen, 2c Scheduler + Rest-Endpunkte)**
```
Ziel: Chat-Agent von Trigger.dev in einen lokalen Node-Dienst service/ (orbitd) umziehen, Verhalten unverändert.
Lies AGENTS.md, plan/CONVENTIONS.md, plan/MAC-UMBAU.md (Schritt 2), trigger/chat.ts, trigger/approvals.ts, trigger/automations.ts.
Regeln: lib/ und Tool-Logik wiederverwenden, nicht neu schreiben. Dienst bindet nur 127.0.0.1, Token aus Datei service.token (0600), prüft Token + Host-Header. userId immer "local".
2a: HTTP-Server, /v1/health, POST /v1/chats/:id/turn (SSE, AI SDK UI-Stream), Tabelle chat_messages, Puffer + /stream zum Wiederanhängen, /stop. Testgerät: chat.tsx mit NEXT_PUBLIC_ORBITD_URL.
Fertig 2a: kleine Frage + Websuche im Browser über den Dienst, Reload mitten in der Antwort setzt fort.
(2b/2c analog nach Tabelle im Plan.) Kein @trigger.dev-Import im Dienst. npm run check grün. Commit je Teil, deutsch, kurz.
```

---

## Schritt 3: Gastraum, Teil 1 (Swift-Gerüst + Anbindung)

**Was passiert, einfach erklärt:** Jetzt entsteht die echte Mac-App. Sie ist nur der Gastraum: Sie zeigt an und nimmt Eingaben entgegen, gekocht wird im Dienst. Zuerst das Skelett mit dem Wichtigsten (Seitenleiste, Chat, Streaming), damit früh sichtbar wird, ob der Weg trägt.

**Aufgaben**
1. Xcode-Projekt `mac/Orbit.xcodeproj` im Repo, SwiftUI, Deployment-Target = macOS deines Macs (`sw_vers` prüfen). Selbstsigniertes Zertifikat **vor** dem ersten Build anlegen, Bundle-ID danach nie ändern (Vault: `macOS Berechtigungen und Codesigning`, kein Developer-Konto nötig).
2. **Design-Tokens** aus `app/globals.css` und `app/layout.tsx` (Farben dunkel/hell, Radien, Abstände, Schrift) in `Theme.swift` plus Color-Assets. Orbis-Figuren: `public/orbis/*.svg` ansehen. Prüfen, ob der alte native Orbit (`~/Documents/Projekte-Coding/Claude/Orbit`, stillgelegt) schon SwiftUI-Planeten mit folgenden Augen hat. Wenn ja, übernehmen statt neu bauen.
3. `ServiceClient` (URLSession, Token aus Datei, Basis-URL), `SSEParser`, `ChatStore` (`@Observable`).
4. Views: Seitenleiste (Orbis, Chats), Chat-Ansicht, Composer (nur Text), Nachrichtenblase mit Markdown (`AttributedString(markdown:)`, Code-Blöcke einfach), Streaming-Anzeige mit dem "Thinking-Orb" (keine Spinner, Regel aus deinem Design).
5. Dienststart im Entwicklungsmodus: App startet `orbitd` als Kindprozess und beendet ihn mit. (Hintergrundbetrieb kommt in Schritt 5.)
6. `plan/API.md`: Endpunkte und JSON-Formen, aus denen die Swift-`Codable`-Strukturen entstehen. Von Hand, kein Generator.
7. **Daytona-Spike (früh klären):** Signierte URL (`lib/daytona.ts`, Port 6080, noVNC über `wss`) in einer kleinen Testansicht öffnen. Ergebnis in `plan/API.md` festhalten: nativer VNC-Client mit WebSocket-Adapter oder nur dieses eine Fenster als eingebettete Web-Ansicht. Ein Fenster Web ist keine Web-App, die Recherche vom 20.10. nennt das als Notlösung. RoyalVNCKit ist laut derselben Recherche seit 5.10.2026 archiviert.

**Fertig wenn:** App startet ohne Browser, Sidebar zeigt Orbis und Chats aus dem Dienst, Nachricht senden streamt die Antwort, Stopp geht, App beenden und neu öffnen während eines Laufs: Lauf ist noch da und läuft weiter. Daytona-Entscheidung steht schriftlich.

**Prompt für Codex (Sol medium)**
```
Ziel: native SwiftUI-Mac-App Orbit (mac/), die den lokalen Dienst orbitd als reine Oberfläche nutzt.
Lies AGENTS.md, plan/MAC-UMBAU.md (Schritt 3), plan/API.md (anlegen, falls nicht vorhanden), app/globals.css.
Baue: Theme.swift aus den CSS-Tokens (dunkel/hell), ServiceClient + SSEParser + ChatStore, Sidebar, Chat, Composer (Text), Streaming mit Thinking-Orb, Markdown-Blase.
App startet orbitd als Kindprozess (Dev). Keine Datenbank in Swift, kein WebView.
Selbstsigniertes Zertifikat verwenden, Bundle-ID de.consti.orbit2 nicht mehr ändern.
Fertig: Build ohne Warnungen, Nachricht senden -> Antwort streamt, App neu öffnen während Lauf -> Lauf läuft weiter. Tests unsichtbar (keine Dock-Symbole).
Zusatz: Spike Daytona-Desktop in separater Testansicht, Ergebnis in plan/API.md.
```

---

## Schritt 4: Gastraum, Teil 2 (Rest der Oberfläche)

**Was passiert, einfach erklärt:** Alles, was die Web-App kann, bekommt eine native Ansicht. Das ist der größte Brocken, deshalb in fünf Blöcken, jeder als eigener Auftrag mit eigener Abnahme. Nie alles in einem `/goal` (Limit 4000 Zeichen).

| Block | Inhalt | Web-Vorlage |
|---|---|---|
| 4a | Orbis-Figuren mit Augen, die dem Zeiger folgen, Arbeitsanimation in jedem Chat; Orbi anlegen/bearbeiten/löschen; Gruppenchats; Status-Ring | `public/orbis/`, `components/chat`, `actions/bot.ts` |
| 4b | Karten: Handoff-Statuskarte, Jev-Block, Freigabekarte, Rückfrage-Chips, Bild, Websuche-Quellen, Fehlerkarte mit "Erneut versuchen" | `components/chat/approval-card.tsx`, `ask-panel.tsx`, `lib/chat/*` |
| 4c | Composer komplett: Slash-Menü, Modellwahl inkl. Auto, Freigabe-Modi, Anhänge (Drag & Drop) | `slash-menu.tsx`, `model-picker.tsx` |
| 4d | Einstellungen als natives Fenster: Nutzung, Jev, Orbis-Anleitung, Skills, Konnektoren (inkl. OAuth-Rückkehr), Marktplatz, Freigaben, Darstellung | `components/settings/*` |
| 4e | Geplant (Automationen), Suche, Daytona-Desktop-Ansicht | `components/automations`, `components/search`, Spike aus Schritt 3 |

Hinweise
- `components/ai-elements/` hat rund 12.000 Zeilen, ist aber vermutlich eine Bibliothek, von der nur ein Teil genutzt wird (nicht geprüft). Nachgebaut wird nur, was in `chat`, `settings` und `automations` wirklich gerendert wird.
- Rive (`persona.tsx`) wird nirgends verwendet, die Orbis sind einfache SVG-Formen und werden in SwiftUI gezeichnet.
- Konvention bleibt: jeder Zustand gestaltet (leer, lädt, Fehler, offline, sehr lang, 1 Element, 0 Elemente), Texte deutsch, Fehler nie still.
- Fallen aus dem Handoff-Umbau, die sich nicht wiederholen sollen: Eingabe sperren, solange ein Turn läuft; "Gelöschter Orbi" mit Platzhalter-Avatar; "[Name]:"-Präfix in Gruppenantworten nicht anzeigen.

**Fertig wenn (je Block und am Ende)**
- Alle Sonderfälle aus `plan/archiv/GOAL.md` belegt: Proxy aus, Brain aus, Jev aus, Gruppe mit 1 Mitglied, gelöschter Orbi, sehr lange Texte, Reload im Stream. (Zwei Tabs und Mobile 375 px entfallen.)
- Dunkel und Hell geprüft, Fenster klein und groß, Tastatur: Enter sendet, Esc stoppt.
- Screens unter `plan/screens/` (wie bisher), `npm run check` für den Dienst grün, Xcode-Build ohne Warnungen.

**Prompt-Vorlage für jeden Block (Platzhalter ersetzen)**
```
Ziel: Block 4<x> (<Inhalt>) der nativen Orbit-App, Verhalten wie die Web-Vorlage <Dateien>.
Lies AGENTS.md, plan/CONVENTIONS.md, plan/MAC-UMBAU.md (Schritt 4), plan/API.md und die genannten Web-Dateien als Verhaltensreferenz.
Nutze Theme.swift, keine Hex-Werte im View-Code. Jeder Zustand gestaltet. Endpunkte fehlen? Zuerst in plan/API.md ergänzen und im Dienst bauen.
Fertig: Build ohne Warnungen; Prüfliste des Blocks im Plan abgehakt; Screens Dunkel/Hell abgelegt.
```

---

## Schritt 5: Einzug und Aufräumen

**Stand 26.10.2026:** Aufgaben 1 bis 5 erledigt und installiert (`scripts/install.sh`), Nachweis und offene Punkte in [STATUS.md](STATUS.md). Aufgaben 6 bis 9 warten auf Constis „Start“.

**Was passiert, einfach erklärt:** Bisher startet die App den Dienst nur nebenbei. Jetzt wird er ein echter Hintergrunddienst, die App kommt in `/Applications`, und die Altlast wird entfernt.

**Aufgaben**
1. **Dienst bündeln:** `esbuild` erzeugt eine Datei, `better-sqlite3` kommt als vorübersetztes Modul mit, eine Node-Laufzeit liegt in `Orbit.app/Contents/Resources/runtime/`. Ohne Node auf dem Mac läuft alles trotzdem.
2. **LaunchAgent:** Die App schreibt beim ersten Start `~/Library/LaunchAgents/de.consti.orbit2.service.plist` (`RunAtLoad`, `KeepAlive`) und lädt ihn mit `launchctl bootstrap gui/$(id -u)`. Bewusst nicht `SMAppService`, das braucht laut Recherche eine Team-ID (Developer-Konto).
3. **Signieren:** App, Node-Binary und native Module mit demselben selbstsignierten Zertifikat, sonst fragt macOS Berechtigungen immer wieder neu.
4. **Secrets:** Zuerst Datei `~/Library/Application Support/Orbit/secrets.env` (Rechte 0600), die du selbst befüllst (`CLI_PROXY_API_KEY`, `CLI_PROXY_MANAGEMENT_KEY`, `OPENROUTER_JEV_API_KEY`, `DAYTONA_API_KEY`, `DAYTONA_API_URL`, `CONNECTOR_SECRET`, `BRAIN_*`). Claude fasst Schlüssel nicht an. Schlüsselbund aus NATIVE.md bleibt als spätere Verbesserung, weil der Dienst ohne App starten muss.
5. **Menüleiste + Mitteilungen:** Menüleisten-Symbol mit Orbi-Status, App bleibt dort auch ohne Fenster aktiv. Sie hört auf `GET /v1/events` und zeigt `UNUserNotificationCenter`-Mitteilungen für Freigaben ("Einmal / Immer / Ablehnen") und Automationen.
6. **Datenübernahme und Umschalten:** Export aus Schritt 1 einmal ausführen, Funktionen vergleichen, dann `mac-umbau` nach `main`.
7. **Aufräumen:** `app/`, `components/`, `actions/`, `query/`, `hooks/`, Next/React/Tailwind/shadcn-Pakete, `trigger/`-Laufzeit, `@trigger.dev/*`, `drizzle/`-Postgres-Reste, Railway-Dateien, `NEXT_PUBLIC_ORBITD_URL`-Schalter. `npm` bleibt nur für den Dienst. `AGENTS.md` (Orbit 2), `NATIVE.md`, `README.md` und die Vault-Notiz aktualisieren. Vorher Tag `web-final` prüfen.
8. **Konten kündigen** (Railway, Trigger.dev, Clerk, Neon): machst du selbst, nichts davon wird automatisch gelöscht.
9. **Prüfung:** `/code-review ultra` startest du selbst.

**Fertig wenn**
- Mac neu starten: Dienst läuft ohne geöffnete App, Terminal nie nötig.
- Aufgabe starten, App schließen, App öffnen: Aufgabe läuft noch oder ist fertig.
- Automation läuft mit geschlossenem Fenster und meldet sich per Mitteilung. Nach Mac-Ruhezustand werden verpasste Läufe nachgeholt.
- App liegt in `/Applications`, startet über Dock/Spotlight, kein Browserfenster.

**Prompt für Codex (Sol medium)**
```
Ziel: Orbit als installierte Mac-App mit Hintergrunddienst, Web-Altlast entfernt.
Lies AGENTS.md, plan/MAC-UMBAU.md (Schritt 5), macOS Berechtigungen und Codesigning (Vault, 04 Ressourcen/Mac-App Entwicklung).
Baue: esbuild-Bündel von service/, Node-Laufzeit im App-Bundle, LaunchAgent (launchctl, kein SMAppService), Signierung mit dem selbstsignierten Zertifikat, secrets.env (0600) einlesen, Menüleisten-Symbol, Mitteilungen über /v1/events.
Danach Aufräumliste aus Schritt 5 (erst nach meinem "Start"). Schlüssel nie lesen oder ausgeben.
Fertig: Mac-Neustart -> Dienst läuft; Aufgabe überlebt App-Neustart; Automation meldet sich bei geschlossenem Fenster. Installiert in /Applications.
```

---

## Risiken und offene Entscheidungen

| Punkt | Stand | Wann klären |
|---|---|---|
| Daytona-Desktop nativ oder eingebettete Web-Ansicht nur für dieses Fenster | entschieden im Spike 3c: nativ (RFB über WebSocket), Rückfall WebView nur mit Constis Ja, siehe `plan/API.md` „Daytona-Desktop“ | Schritt 3c |
| Chat-Verlauf nicht migrieren | Annahme (Verlauf liegt in Trigger-Sessions) | vor Schritt 1 bestätigen |
| Node-Laufzeit im Bundle | festgelegt (siehe Zielbild) | Schritt 5 |
| Hono als HTTP-Bibliothek | Annahme, austauschbar | Schritt 2 |
| Chunk-Format Swift <-> AI SDK | aus Doku in `node_modules/ai` ableiten, nicht raten | Schritt 2/3 |
| Prod-Betrieb (Railway) | entfällt, nur lokal | Schritt 1 |
| Mac im Ruhezustand: Automationen laufen nicht | bekannte Grenze (NATIVE.md §1), Nachholen beim Aufwachen | Schritt 2/5 |

## Arbeitsweise

- Ein Branch `mac-umbau`, Tag `web-final` als Rückweg, ein Commit je Teilschritt (deutsch, kurz).
- Bauaufträge an Codex Sol (medium), Claude koordiniert und prüft. Pro Schritt einmal gezielt prüfen (Build, passende Tests, Abnahmeliste), bestanden = Ende.
- Nach jedem Schritt: Haken in `plan/STATUS.md` (Datum, Nachweis) und Kurzstand in der Vault-Notiz `Orbit 2 Mac-App Umbau`.
- Tests laufen unsichtbar (keine Dock-Symbole, keine liegen gebliebenen Test-Kopien).
