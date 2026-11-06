# Orbit 2: Abschlussplan (tief)

> **Hinweis 03.11.2026:** Verlauf, nicht mehr maßgeblich. Es gilt der Umbau-Plan (Entscheidungen E01–E64, D01–D21, L1–L15 im Brain). Der Proxy fällt ganz weg (E59), `think_deep` entfällt (E37), Übergaben ohne `result:` (E20), Zeitgrenzen 60/5 Minuten (E21/E24).

Ziel: Orbit 2 fertig, poliert, geprüft; danach Umstieg auf native Mac-App. Stand 17.10.2026. Ordnung: `plan/CONVENTIONS.md`. Prompts: `plan/PROMPTS.md` (je Phase einer, direkt in Claude in VS Code einfügbar).

Entscheidungen Consti: Brain-Server lokal am Mac; Jev unbegrenzt, Hintergrund, Block je Nachricht aufklappbar; Skills aus Orbit + Brain; Orbi-Anleitung = gemeinsame AGENTS.md + je Orbi `instructions`; Einstellungsmenü ohne Clerk-UI; Nutzung zuverlässig; Plugin-Marktplatz; Review am Ende mit `/code-review ultra` (löst Consti aus).

## Befund (belegt)
Proxy-Chat: `trigger/chat.ts:16` → 127.0.0.1:8317, nur lokal. Urani-Ausfall = vermutlich Proxy/trigger dev/Modell-ID (P1 klärt).
Nutzung: `lib/provider-limits.ts` liest nur Claude-Signale (Schnappschuss, kann veraltet sein). Codex-Signale heißen `X-Codex-Primary/Secondary-*` (Prozent 0..100). Antigravity liefert im Credentials-Endpoint nichts; echte Quota nur per `POST /v8/management/requests/api-call` (genau wie die Konsole): Claude `GET api.anthropic.com/api/oauth/usage` (0..100), Codex `GET chatgpt.com/backend-api/wham/usage`, Antigravity `POST cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary` (remainingFraction).
Clerk hängt nur im Nutzermenü (`components/user-menu-button.tsx`, `UserButton`). Auth/Middleware/`userId` bleiben.
Chat-Lücken: kein sichtbarer Fehler (`useChat.error` ungenutzt), `loadChat` doppelt pro Turn, Direktchat ohne Mitglied antwortet ohne Persona, Memory überschreibt komplett (Race, 8000-Zeichen-Kürzung kann Inhalt vernichten), Gruppen-Memory-Widerspruch (`chat.ts:463`), Metadata doppelt gebaut (`chat.tsx:394-399`,`547-568`), Start `/` zeigt immer Onboarding, Zufalls-Avatar je Request, `DEV_NO_MODEL` in Prod, tote Dateien (`trigger/example.ts`, `trigger/openrouter.ts`, `drizzle/` todos), kein Test außer `header-snap`.

## Phasen (Reihenfolge fix, Phase erst abhaken wenn Fertig-Bedingung belegt)

### P0 Fundament
- `plan/CONVENTIONS.md` in `AGENTS.md` verlinken. `npm run check` (typecheck+lint+build+test), `test`-Skript.
- `<html lang="de">`, Prettier-Lauf (eigener Commit), `lib/proxy.ts` als einzige Proxy-Quelle (`trigger/chat.ts:16`, `lib/chat-models.ts` nutzen sie), tote Dateien raus, `app/sign-in/zz-test` raus, `drizzle/` aufräumen (nur Hinweis, `db push` bleibt).
- Gemeinsame Helfer: `lib/chat/metadata.ts` (ein Builder für `answer()`+`onSubmit`), `lib/chat/sender-tag.ts` (ein Regex-Helfer für Client+Trigger, Test).
Fertig: `npm run check` grün, Diff nur Struktur.

### P1 Urani wieder an + Chat-Stabilität
- Diagnose: `curl 127.0.0.1:8317/v1/models`, `launchctl list | grep cliproxyapi`, `trigger dev`-Terminal, Modell-IDs `lib/chat-catalog.ts:51-58` vs. Proxy, Env `CLI_PROXY_API_KEY`, Diff `0281fbe`.
- Fix `loadChat`: einmal pro Turn (Ergebnis wiederverwenden), `speaker` undefined → klarer Fehler statt Antwort ohne Persona; Owner-Check bei `botId`-Fallback (`chat.ts:77`).
- UI: `useChat.error` sichtbar (Inline-Karte + „Erneut versuchen“), Abbruch-Kennzeichnung („abgebrochen“), Gruppe mit 0/1 Mitglied sauber, gelöschter Orbi: Platzhalter-Avatar + Name.
- Tests: `sender-tag`, Metadata, `loadChat`-Fehlerfälle (Mock).
Fertig: Nachricht streamt; Proxy aus → verständliche Fehlerkarte statt Stille.

### P2 Quick Wins
- `components/chat/main-orbi-badge.tsx` aus `sidebar-nav.tsx:124-130`; einsetzen `chat.tsx:94`, `group-side-panel.tsx:154,214`, Sidebar.
- „Kein Modell“/Zeichenzahl komplett raus: `lib/chat-catalog.ts:21-29`, `model-picker.tsx` (`NO_MODEL_OPTION`, `CharsPicker`, doppelte Slider-Logik zu einer `SliderDots`), `chat.tsx:335,548-558,601,633`. `grep` für `DEV_NO_MODEL|CharsPicker|fillTo|NO_MODEL` leer.
- Start: `app/(dashboard)/page.tsx`: Orbis vorhanden → Redirect auf zuletzt geöffneten Chat (Cookie `orbit-last-chat`, gesetzt auf der Chat-Seite; Fallback: neuester `last_message_at`); keine Orbis → Onboarding. Fester Avatar-Seed (nicht je Request). Nach Orbi anlegen: Sprung in dessen Chat (`bot-dialog.tsx:128-132`).
Fertig: Browser-Test: Reload landet im letzten Chat; neuer Nutzer sieht Onboarding.

### P3 Nutzung + Einstellungsmenü (ohne Clerk-UI)
- `lib/usage/` : `types.ts` (`{provider,windows:[{name,used0..1,resetAtMs}],status,note}`), `proxy-call.ts` (`api-call` mit `$TOKEN$`, feste URLs, Timeout 5 s), `claude.ts`, `codex.ts`, `antigravity.ts`, `index.ts` (`Promise.allSettled`, Cache 60 s je Provider, Fallback Claude-Signale, abgelaufene Fenster verwerfen, Codex-Cooldown „Limit erreicht, Reset in …“, mehrere Credentials je Provider wählbar). Tests mit Beispiel-JSON je Provider (Fixtures ohne Tokens).
- `actions/usage.ts` ersetzt `app/actions.ts`; Proxy nicht erreichbar → Status „Proxy offline“ (Prod).
- `components/settings/`: `settings-dialog.tsx` (Sektionen: Konto, Nutzung, Orbis-Anleitung, Jev, Konnektoren, Skills, Darstellung). Konto-Daten per Server-`currentUser()` als Props, Abmelden `useClerk().signOut`. Trigger = `SidebarMenuButton`, kein `querySelector`-Hack. `UserButton` + `@clerk/ui`-Popover entfernt; `ClerkProvider` bleibt.
- DB: `user_settings (user_id pk, jev_enabled, theme, …)` via `db push`.
Fertig: alle drei Provider zeigen echte Werte (Vergleich mit Quota-Konsole), Dev-Mode-Badge weg, Offline-Zustand getestet.

### P4 Bildgenerierung
- `trigger/images.ts` Tool `generate_image`, in `orbiTools()` (`chat.ts:104`) registriert; zuerst prüfen, ob Proxy Bild-Endpoint für ChatGPT/Gemini bietet (`/v1/images/generations`, Gemini-Image). Sonst Rückmeldung an Consti, Fallback OpenRouter-Bildmodell (Jev-Key, Kostenregel beachten).
- Ergebnis: Datei in Sandbox/`share_file`, Anzeige `components/media.tsx`, Lade-Skeleton, Fehlerfall sichtbar.
Fertig: „Male einen roten Planeten“ liefert Bild; Fehler zeigt Karte.

### P5 Jev
- `lib/jev/` (Stufenlogik nach Skills `jev-router`/`jev-entscheiden`, OpenRouter-Client), `trigger/jev.ts`.
- A Auto-Modell im Picker (ersetzt `CHAT_MODELS.find` `chat.ts:369`, Fallback Standard), B Vorschlag per Chip mit Bestätigung, C Handoff-Routing, D Hintergrund-Jobs (Titel, Zusammenfassung, Memory-Pflege), alles ohne Tokenlimit.
- E Sichtbarkeit: Tabelle `jev_log` (`db push`), Nachrichten-Block „Jev: … “ aufklappbar mit Begründung/Modell/Dauer; Protokoll in Einstellungen.
- Sicherheit: nie Löschen/Senden/Geld entscheiden; Schalter in Einstellungen (Standard an für Auto, aus für Handoff-Auto bis getestet); Timeout 8 s → Fallback.
Fertig: „Hallo“ → kleines Modell, Coding-Aufgabe → großes; Jev aus Netzwerk → sauberer Fallback.

### P6 Orbi-Anleitung + Memory-Fix
- Gemeinsame Basis `lib/orbi/base-instructions.md` (Brain-Regeln, Navigation minimal laden, Skills, Tool-/Jev-Regeln, Arbeitsregeln, Antworten sehr kurz wie Chat; keine Daten über Consti, Name darf gespeichert werden). In `systemPrompt()` (`chat.ts:~300`): Basis + `bot.instructions || describeJob`. Editor in Einstellungen (Tabelle `user_settings.base_instructions`, Reset auf Standard).
- Memory: `memory_append` + `memory_set` mit Versionsprüfung (Hash), kein stilles Abschneiden (Hinweis „gekürzt, straffe zuerst“ + Lesen der vollen Datei bei Schreiben), Gruppen-Widerspruch klären (nur lesen in Gruppen), Sandbox-Start nur bei Bedarf.
Fertig: Orbi antwortet kurz; zwei parallele Turns zerstören Memory nicht (Test).

### P7 Brain-Server (lokal am Mac)
- Neues kleines Paket `brain-server/` (Node, MCP über HTTP), liest/schreibt Vault `…/zweites-gehirn-claude` nur über Tools `brain_search`, `brain_read(section)`, `brain_write(note, ort laut CLAUDE.md)`, `brain_skills_list/read`. Auth Token, nur localhost + Tunnel (Tailscale/Cloudflare Tunnel), kein Löschen, Pfad-Whitelist (`00`–`05`; `06`/`07` nur auf Verweis), Kopfstück-Validierung.
- Orbit: `lib/brain/client.ts`, Tools in `trigger/brain.ts`; Offline-Meldung „Mac/Brain nicht erreichbar“.
Fertig: Orbi findet Notiz per Stichwort und legt eine korrekt abgelegte Notiz an; Mac aus → klare Meldung.

### P8 Slash, Skills, Konnektoren, Marktplatz
- Composer-Slash-Menü: Skills aus Orbit-DB (`skills`) + Brain (P7); `/skill neu`.
- MCP-Konnektoren: Tabelle `mcp_connectors`, AI-SDK-MCP-Client in `orbiTools()`, Freigabe je Orbi, Secrets verschlüsselt, Allowlist.
- Marktplatz: Katalog (JSON im Repo, später Remote), „Installieren“ legt Konnektor/Skill an; Bewertungstexte kurz. Umfang in P-R mit Consti klären.
Fertig: Slash-Skill läuft; Test-MCP liefert Tool-Ergebnis; Marktplatz-Installation sichtbar in Einstellungen.

### P9 Websuche, Polish, Sonderfälle
- Websuche-Tool (`trigger/search.ts`) + animierte Quellenkarten (ai-elements `sources`, `web-preview`, `reasoning`).
- Polish-Checkliste (Abnahme je Punkt): Dark/Light, Mobile 375 px, Tastatur/Fokus, `prefers-reduced-motion`, leere/Lade/Fehler-Zustände überall, sehr lange Namen/Nachrichten, Markdown/Code-Blöcke, Upload groß/leer, Abbruch, Reload mitten im Stream (`resumeStream`), zwei Tabs, Proxy aus, Brain aus, Jev aus, Gruppe 1 Mitglied, gelöschter Orbi, Rate-Limit-Hinweis.
- Weitere Features aus P-R (Spracheingabe/-ausgabe, Artifacts, Suche über Chats …) nach Consti-Priorität.

### P9b Freigabekarte, Suche, Orbi-Status, Automationen (aus `plan/RESEARCH.md`, Grok Bot/ChatGPT)
- Freigabekarte vor Aktionen mit Folgen (Senden, Löschen, Schreiben ins Brain außerhalb Inbox, MCP-Schreibaufrufe): Knöpfe „Einmal erlauben / Immer erlauben (speichert Regel) / Ablehnen“, „Zuerst fragen“ schlägt „Automatisch“, Freigabe aus Hintergrundläufen verfällt nach 10 Min. Tabelle `approval_rules`.
- Volltextsuche über alle Chats/Orbis (`query/search.ts`, Sidebar-Suche erweitern; Nachrichten liegen im Trigger-Transcript, daher Index-Tabelle `chat_messages_index` oder Suche über Transcript-API prüfen).
- Orbi-Status als Orb-Animation (ruhig, denkt, arbeitet, wartet, blockiert, fertig), Details beim Hover; Gruppenlimit 6 Orbis.
- Automationen: Tabelle `automations` (orbi, prompt, Zeitplan einmal/täglich/Werktage/wöchentlich/monatlich, Zeitzone, Ziel „gleicher Chat | neuer Chat je Lauf“, Benachrichtigung), Trigger.dev Scheduled Tasks, Mindestabstand 5 Min., max. 50 je Orbi, „Jetzt ausführen“, Lauf-Verlauf (letzte 20, lesbar/fortsetzbar), Posteingang „Geplant“, Auto-Pause bei langer Abwesenheit, Löschen mit Papierkorb, Freigabe-Regeln gelten auch hier.
Fertig: Freigabe verfällt nach 10 Min. (Test), Suche findet Wort aus altem Chat, Automation läuft per „Jetzt ausführen“ und planmäßig, Verlauf sichtbar.

### P-R Recherche (läuft früh, parallel zu P0–P2)
Haiku recherchiert Grok-Bot-Team, ChatGPT, Dots: Features/Automation. Bericht `plan/RESEARCH.md` mit „unverzichtbar / nice / Alleinstellung“. Consti priorisiert vor P8/P9.

### P10 Abnahme
- `npm run check`, dann E2E-Durchlauf der Polish-Checkliste im Browser (Screenshot je Hauptansicht Dark+Light+Mobile).
- Deploy nach AGENTS.md; Smoke-Test Prod.
- Code-Review: Consti startet `/code-review ultra` auf dem Branch; Funde abarbeiten, erneut `npm run check`.
- Brain sichern: Projektnotiz, `Jetzt.md`, Jev-Ablauf. Liste „Umstieg auf native Mac-App“.

## Bekannte Risiken
Prod erreicht lokalen Proxy nie (Chat+Nutzung nur lokal, Umbau nur auf Consti-Wunsch). SDK-Privataufruf `subscribeToSessionStream` bei Update prüfen. `last_message_at` ist bei neuen Chats „jetzt“. Keine Test-Basis außer `header-snap`.
