# Orbit 2: Prompts für Claude in VS Code

> **Hinweis 03.11.2026:** Verlauf, nicht mehr maßgeblich. Es gilt der Umbau-Plan (Entscheidungen E01–E64, D01–D21, L1–L15 im Brain). Der Proxy fällt ganz weg (E59), `think_deep` entfällt (E37), Übergaben ohne `result:` (E20), Zeitgrenzen 60/5 Minuten (E21/E24).

Je Phase einen Block komplett kopieren und einfügen. Reihenfolge einhalten. Jeder Prompt ist eigenständig.

---
## P0 Fundament
```
Repo Orbit 2. Lies zuerst AGENTS.md, plan/CONVENTIONS.md und plan/PLAN.md (Phase P0). Arbeite nur P0.
Aufgaben:
1. Skripte in package.json: "test": "node --test", "check": "npm run typecheck && npm run lint && npm run build && npm test". Test-Glob so setzen, dass lib/header-snap.test.ts läuft.
2. app/layout.tsx: <html lang="de">. app/sign-in/zz-test löschen.
3. lib/proxy.ts anlegen (einzige Quelle für Proxy-URL http://127.0.0.1:8317/v1 und createOpenAI-Client). trigger/chat.ts und lib/chat-models.ts darauf umstellen, Doppelcode entfernen.
4. trigger/example.ts und trigger/openrouter.ts entfernen (nach grep, dass nichts sie nutzt; OPENROUTER_API_KEY-Mapping in trigger.config.ts bleibt für Jev).
5. lib/chat/metadata.ts: ein Builder für die Nachrichten-Metadata, ersetzt die Doppelung in components/chat.tsx (answer() und onSubmit). lib/chat/sender-tag.ts: ein gemeinsamer escapeRe/Tag-Regex-Helfer für components/chat.tsx und trigger/chat.ts, plus lib/chat/sender-tag.test.ts.
6. AGENTS.md um einen Verweis auf plan/CONVENTIONS.md ergänzen.
7. Zuletzt EIN getrennter Commit: npm run format (nur Formatierung).
Regeln: kein Verhalten ändern. Commits klein, deutsch.
Fertig: npm run check grün. Zeige Diff-Zusammenfassung.
```

---
## P1 Urani + Chat-Stabilität
```
Repo Orbit 2. Lies AGENTS.md, plan/CONVENTIONS.md, plan/PLAN.md (P1). Arbeite nur P1.
A) Diagnose (Befehle selbst ausführen, Keys nie ausgeben): curl -s 127.0.0.1:8317/v1/models mit Key aus .env.local (nur Modell-IDs zeigen), launchctl list | grep cliproxyapi, läuft trigger dev? Vergleiche IDs in lib/chat-catalog.ts:51-58 mit der Proxy-Liste. Prüfe git show 0281fbe auf Regression. Behebe die Ursache; wenn Neustart von Proxy/trigger dev nötig ist, tue es und melde es.
B) Code-Fixes in trigger/chat.ts: loadChat nur einmal pro Turn (Ergebnis zwischen tools und run teilen); speaker undefined → klarer Fehler statt Antwort ohne system/tools; Owner-Check beim botId-Fallback (Zeile ~77); Gruppen-Memory-Kommentar mit Verhalten in Einklang bringen (Gruppen: Memory nur lesen, memory_set dort nicht anbieten).
C) UI in components/chat.tsx: useChat.error sichtbar (Inline-Fehlerkarte mit deutscher Meldung + „Erneut versuchen“), abgebrochene Antwort kennzeichnen, Gruppe mit 0/1 Mitglied ohne Crash, gelöschter Orbi: Platzhalter-Avatar und „Gelöschter Orbi“.
D) Tests: lib/chat/* und loadChat-Fehlerfälle (Mock der DB).
Fertig: npm run check grün; im Browser streamt eine Antwort; bei gestopptem Proxy erscheint eine verständliche Fehlerkarte. Beende mit Kurzbericht (Ursache Urani, Fixes, offene Punkte).
```

---
## P2 Quick Wins
```
Repo Orbit 2. Lies AGENTS.md, plan/CONVENTIONS.md, plan/PLAN.md (P2). Arbeite nur P2.
1. components/chat/main-orbi-badge.tsx: gelbes Stern-Badge (schwarzer Kreis, lucide StarIcon fill-yellow-400) als Komponente aus components/sidebar-nav.tsx:124-130 extrahieren. Einsetzen: Sidebar (ersetzt Inline-Code), components/chat.tsx (Avatar links neben Nachrichten, wenn Orbi isMain, Gruppenchat), components/group-side-panel.tsx (Avatare), Mitgliederliste im Composer.
2. „Kein Modell“/Zeichenzahl komplett entfernen: DEV_NO_MODEL, NO_MODEL, DEV_CHAR_STEPS, fillTo (lib/chat-catalog.ts), NO_MODEL_OPTION und CharsPicker (components/model-picker.tsx; gemeinsame SliderDots für EffortPicker behalten), Verwendungen in components/chat.tsx. Danach grep -rnE "DEV_NO_MODEL|CharsPicker|fillTo|NO_MODEL" ohne Treffer.
3. Start-Verhalten app/(dashboard)/page.tsx: hat der Nutzer Orbis → Redirect auf zuletzt geöffneten Chat (Cookie orbit-last-chat, gesetzt in app/(dashboard)/chats/[chatId]/page.tsx bzw. Client; Fallback neuester last_message_at aus getSidebarBots; ungültige Chat-ID → Fallback). Keine Orbis → Onboarding „Erstelle deinen ersten Orbi“. crypto.randomUUID()-Avatar-Seed nicht mehr pro Request ändern (stabil per useState/useMemo im Client). Nach dem Anlegen eines Orbis in components/bot-dialog.tsx in dessen Chat springen.
Fertig: npm run check grün. Browser-Test mit Screenshots: Reload landet im letzten Chat; neuer Nutzer sieht Onboarding; Badge im Gruppenchat sichtbar (Dark+Light). Kurzbericht.
```

---
## P3 Nutzung + Einstellungsmenü
```
Repo Orbit 2. Lies AGENTS.md, plan/CONVENTIONS.md, plan/PLAN.md (P3). Arbeite nur P3. Lies vorher node_modules/next/dist/docs/ zu Server Actions/Caching und die Skills clerk-custom-ui, clerk-nextjs-patterns, shadcn.
Teil 1 Nutzung zuverlässig (ersetzt lib/provider-limits.ts und app/actions.ts):
- lib/usage/types.ts: {provider:"claude"|"codex"|"antigravity", status:"ok"|"limit"|"offline"|"error", windows:[{name:"5h"|"7d", used:0..1, resetAt:ms}], note?}.
- lib/usage/proxy-call.ts: POST http://127.0.0.1:8317/v8/management/requests/api-call mit Bearer CLI_PROXY_MANAGEMENT_KEY, Body {authIndex, method, url, header, data}, Authorization-Header "Bearer $TOKEN$". Feste URLs im Code, Timeout 5 s, import "server-only".
- claude.ts: GET https://api.anthropic.com/api/oauth/usage (Header anthropic-beta: oauth-2025-04-20, User-Agent claude-cli/…); five_hour/seven_day.utilization sind 0..100 → /100, resets_at ISO. Fallback: bisherige Anthropic-Ratelimit-Signale aus /v8/management/credentials (0..1, Reset Epoch s); abgelaufene Fenster (resetAt<now) auf 0 setzen.
- codex.ts: GET https://chatgpt.com/backend-api/wham/usage mit Chatgpt-Account-Id aus credential.id_token.chatgpt_account_id; rate_limit.primary_window/secondary_window.used_percent (0..100) → /100, reset_at Epoch s. Fallback X-Codex-Primary/Secondary-*-Signale. Credential status "error"/cooldowns → status "limit" mit Reset-Zeit.
- antigravity.ts: POST https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary, data {project: credential.project_id}; groups[].buckets[] (window weekly|5h, remainingFraction → used=1-x, resetTime ISO). Zeige je Gruppe den schlechtesten Wert.
- index.ts: Promise.allSettled, Cache 60 s je Provider, mehrere Credentials je Provider unterstützen, eigener Status je Provider. Proxy nicht erreichbar → status "offline".
- Tests mit Fixtures (JSON ohne Tokens/E-Mails) je Provider. actions/usage.ts mit auth().
- Gegenprüfung: vergleiche Ergebnis mit der Quota-Konsole (127.0.0.1:8317, Quota Management).
Teil 2 Einstellungsmenü ohne Clerk-UI:
- components/user-menu-button.tsx und das querySelector-Klick-Hack ersetzen durch components/settings/settings-dialog.tsx (Base-UI Dialog, Sektionen als Tabs/Liste): Konto (Name/E-Mail/Avatar als Props aus app-sidebar.tsx via currentUser(), nur serialisierbare Felder), Nutzung (Karten je Provider mit Balken, Reset-Zeit, Lade-/Fehler-/Offline-Zustand, Aktualisieren-Knopf), Abmelden (useClerk().signOut({redirectUrl:"/sign-in"})). Platzhalter-Sektionen Orbis-Anleitung, Jev, Konnektoren, Skills, Darstellung (leer mit „Kommt“ ist NICHT erlaubt: Sektionen erst anlegen, wenn ihre Phase sie füllt).
- UserButton entfernen, ClerkProvider/Middleware bleiben. Dark-Mode-Theme per next-themes in „Darstellung“.
- DB: lib/db/schema.ts user_settings (user_id pk, theme text, updated_at); bun/npm run db:push (nur push, keine Migrationen).
Fertig: npm run check grün; Screenshots Dark+Light+Mobile; alle drei Provider zeigen echte Werte oder begründeten Status; Clerk-„Development mode“-Badge weg. Kurzbericht.
```

---
## P4 Bildgenerierung
```
Repo Orbit 2. Lies AGENTS.md, plan/CONVENTIONS.md, plan/PLAN.md (P4), Skills ai-sdk und trigger-authoring-chat-agent. Arbeite nur P4.
1. Prüfe (read-only, Keys nie ausgeben), ob der CLI-Proxy Bild-Endpoints hat: GET /v1/models auf Bildmodelle, POST /v1/images/generations testweise mit kurzem Prompt. Ergebnis kurz notieren. Wenn der Proxy keine Bilder kann: STOPP und Consti den Fallback vorschlagen (OpenRouter-Bildmodell über OPENROUTER_JEV_API_KEY, Kostenregel: nur :free oder Limit).
2. Bei Erfolg: trigger/images.ts mit Tool generate_image {prompt, size?}; Bild als Datei speichern (Sandbox oder vorhandener share_file-Pfad), Rückgabe so, dass components/media.tsx es anzeigt. In orbiTools() (trigger/chat.ts) registrieren, systemPrompt nennt es automatisch.
3. UI: tool-call.tsx Karte mit Lade-Skeleton, Fehlerfall, Bild anklick-/vergrößerbar, Download.
4. Bild-Eingabe-Middleware (trigger/images-middleware.ts) darf generierte Bilder nicht doppelt einspeisen.
Fertig: npm run check grün; „Male einen roten Planeten“ liefert ein Bild im Chat; Fehler (Proxy aus) zeigt Karte. npx trigger.dev@latest deploy ausführen. Kurzbericht.
```

---
## P5 Jev
```
Repo Orbit 2. Lies AGENTS.md, plan/CONVENTIONS.md, plan/PLAN.md (P5), die globalen Jev-Skills (jev-router, jev-entscheiden, modelle-einschaetzen) und trigger/openrouter.ts-Reste/trigger.config.ts (OPENROUTER_JEV_API_KEY). Arbeite nur P5.
Jev = günstiges OpenRouter-Modell, darf unbegrenzt Tokens nutzen und im Hintergrund arbeiten.
1. lib/jev/client.ts (OpenRouter via @openrouter/ai-sdk-provider oder createOpenAI baseURL openrouter, Key nur server), lib/jev/tiers.ts (Stufen small/medium/large/coding mit Zielmodell+Effort aus CHAT_MODELS), lib/jev/route.ts (Nachricht → Stufe + Begründung + Sicherheit, strukturierte Ausgabe per zod, Timeout 8 s, Fehler → Standardmodell). Tests mit gemocktem Client.
2. A) Auto-Option im components/model-picker.tsx („Auto (Jev)“); in trigger/chat.ts statt CHAT_MODELS.find bei model==="auto" Jev fragen. B) Modus „Vorschlag“: Jev schlägt per ```options-Chip vor, Nutzer bestätigt. C) handoff-Tool: Jev schlägt Ziel-Orbi vor, Bestätigung bleibt bei Plan-Rückfrage. D) Hintergrundjobs (Trigger-Task trigger/jev-jobs.ts): Chat-Titel, Zusammenfassung, Memory-Pflegevorschlag.
3. Sichtbarkeit: Tabelle jev_log (id, user_id, chat_id, kind, model, reason, duration_ms, payload jsonb, created_at; Index (user_id, created_at)) per db push; in der Assistant-Nachricht ein einklappbarer Block „Jev: …“ (Zeile kurz, aufklappbar mit Begründung, gewähltem Modell, Dauer); Protokoll-Sektion in components/settings/.
4. Sicherheit: Jev entscheidet nie über Löschen/Senden/Geld; Schalter in user_settings (jev_auto default an, jev_handoff default aus); alles in jev_log.
Fertig: npm run check grün; „Hallo“ → kleines Modell, „Schreibe eine Migration …“ → großes; OpenRouter blockiert → Fallback ohne Fehlerkarte. trigger deploy. Kurzbericht.
```

---
## P6 Orbi-Anleitung + Memory
```
Repo Orbit 2. Lies AGENTS.md, plan/CONVENTIONS.md, plan/PLAN.md (P6), trigger/chat.ts systemPrompt(), trigger/sandbox-tools.ts Memory. Arbeite nur P6.
1. lib/orbi/base-instructions.md (Standardtext, Englisch für das Modell, Antworten deutsch): Navigation im Brain (minimal, nur laden was gebraucht wird, nie ganze Ordner, Suche vor Lesen), Brain-Regeln (Ablage, Kopfstück tags/status/date/herkunft, Wikilinks, nie löschen, vor Geld/Senden/Veröffentlichen fragen), Skills nutzen, Tool-/Jev-Regeln, Arbeitsregeln (klein direkt, groß erst planen, OFFEN-Zeile), Stil: in Orbit Antworten sehr kurz wie Chat. Keine Daten über Consti; darf dessen Namen per Memory speichern.
2. systemPrompt(): Basis + (bot.instructions || describeJob). user_settings.base_instructions (nullable, überschreibt Standard) per db push; Editor in components/settings/ (Textfeld, Zeichenzähler, „Auf Standard zurücksetzen“) und je Orbi bleibt bot-dialog instructions.
3. Memory sicher: Tools memory_append(text) und memory_set(text, baseHash); Lesen liefert Hash; Konflikt → Fehlertext „Memory hat sich geändert, lies neu“. Kein stilles slice(0,8000): bei Überlänge Hinweis im Prompt und Schreiben nur straffer erlaubt. Gruppen: Memory nur lesen. Sandbox nur starten, wenn Tools/Memory gebraucht werden (Lazy).
4. Tests: parallele Schreibkonflikte (Mock), Überlänge.
Fertig: npm run check grün; Orbi antwortet in Orbit kurz; zwei parallele Turns zerstören Memory nicht. trigger deploy. Kurzbericht.
```

---
## P7 Brain-Server
```
Repo Orbit 2 (neues Unterpaket brain-server/). Lies AGENTS.md, plan/CONVENTIONS.md, plan/PLAN.md (P7) und die Regeln des Vaults /Users/constantinholzborn/Documents/Projekte-Coding/Claude/zweites-gehirn-claude/CLAUDE.md. Arbeite nur P7.
1. brain-server/: Node-MCP-Server über HTTP (Token aus Env BRAIN_SERVER_TOKEN), Vault-Pfad per Env. Tools: brain_search(query) (Dateiname+Volltext, max 10 Treffer mit Pfad+Snippet), brain_read(path, section?) (Abschnitt nach Überschrift, Größenlimit), brain_write(path, content) nur in erlaubten Ordnern (01 Inbox, 02 Projekte, 04 Ressourcen), erzwingt Kopfstück tags/status/date/herkunft, legt nie über bestehende Datei ohne mode "append", brain_skills_list/brain_skill_read (04 Ressourcen/Fähigkeiten/*/SKILL.md). Kein Löschen. 06/07 nur wenn path explizit. Pfad-Traversal verbieten (Test).
2. launchd-Plist-Vorlage + Start-Anleitung (README im Ordner) ; Erreichbarkeit aus der Cloud per Tunnel (Tailscale oder Cloudflare Tunnel): nur Anleitung und Env-Variable BRAIN_SERVER_URL, nichts ohne Consti installieren.
3. Orbit: lib/brain/client.ts, trigger/brain.ts Tools, in orbiTools() registrieren. Offline/Timeout → Tool-Ergebnis „Brain nicht erreichbar“, kein Absturz.
Fertig: npm run check grün; Tests für Pfadsicherheit und Kopfstück; Orbi findet Notiz per Stichwort und legt eine Notiz in 01 Inbox korrekt an; Server aus → klare Meldung. Kurzbericht.
```

---
## P8 Slash, Skills, Konnektoren, Marktplatz
```
Repo Orbit 2. Lies AGENTS.md, plan/CONVENTIONS.md, plan/PLAN.md (P8), plan/RESEARCH.md (falls vorhanden), AI-SDK-Doku zu MCP-Clients. Arbeite nur P8.
1. DB per db push: skills (id, user_id, name, description, body, created_at), mcp_connectors (id, user_id, name, url, auth_encrypted, enabled, created_at), bot_connectors (bot_id, connector_id). Secret-Verschlüsselung mit Env CONNECTOR_SECRET (AES-GCM), nie ans Frontend.
2. Slash-Menü im Composer (components/chat/slash-menu.tsx): „/“ öffnet Liste aus Orbit-Skills und Brain-Skills; Auswahl setzt den Skill-Text als Kontext der Nachricht; /skill neu <name> legt Orbit-Skill an.
3. Konnektoren: Einstellungen-Sektion, MCP per URL hinzufügen, testen, je Orbi freigeben; trigger/connectors.ts hängt freigegebene MCP-Tools in orbiTools(); nur HTTPS-Allowlist, Timeout, Fehler als Tool-Ergebnis.
4. Marktplatz: Katalog connectors/catalog.json (Name, Beschreibung, Typ mcp|skill, Quelle) + UI „Installieren“, legt Konnektor/Skill an. Nur geprüfte Einträge, Hinweis auf Rechte.
Fertig: npm run check grün; Slash-Skill läuft; Test-MCP liefert Tool-Ergebnis; Installation im Menü sichtbar; Fehlerfälle (MCP offline, falsches Token) behandelt. trigger deploy. Kurzbericht.
```

---
## P9 Websuche + Polish
```
Repo Orbit 2. Lies AGENTS.md, plan/CONVENTIONS.md, plan/PLAN.md (P9), Skills ai-elements, emil-design-eng, impeccable (Polish). Arbeite nur P9.
1. Websuche: trigger/search.ts Tool (Proxy/Provider-Suche, Quellenliste); UI mit ai-elements sources/web-preview/reasoning: animierte „Suche läuft“-Karte, Quellen-Chips, Fehlerzustand.
2. Abnahme-Checkliste aus plan/PLAN.md P9 Punkt für Punkt prüfen und beheben; zu jedem Punkt Ergebnis (ok/Fix). Dazu: Skeletons statt Sprünge, Fokus-Ringe, Tastaturbedienung der Menüs, prefers-reduced-motion, Mobile 375 px, Dark+Light, lange Namen, Markdown/Code-Blöcke, große Uploads, Reload im Stream, zwei Tabs.
3. Features aus plan/RESEARCH.md, die Consti freigegeben hat (nur diese).
4. Tests für neue Logik. Kein toter Code, keine Doppelungen (grep).
Fertig: npm run check grün; Screenshots aller Hauptansichten Dark/Light/Mobile unter plan/screens/. Kurzbericht mit Checkliste.
```

---
## P9b Freigabekarte, Suche, Status, Automationen
```
Repo Orbit 2. Lies AGENTS.md, plan/CONVENTIONS.md, plan/PLAN.md (P9b), plan/RESEARCH.md Abschnitte 1 und 3, Skills trigger-authoring-tasks, trigger-realtime-and-frontend. Arbeite nur P9b, in dieser Reihenfolge, je Teil ein Commit.
1. Freigabekarte: lib/approvals/ (Regeln: once/always/deny, „ask“ schlägt „auto“), Tabelle approval_rules per db push, Tool-Wrapper, der riskante Tools (MCP-Schreiben, brain_write außerhalb 01 Inbox, Senden, Löschen) vor Ausführung pausiert; UI-Karte in components/chat/approval-card.tsx; Hintergrundläufe: Freigabe verfällt nach 10 Min., Aktion läuft dann nicht. Tests für Verfall und Regelrangfolge.
2. Volltextsuche: query/search.ts über alle Chats; prüfe, wo Nachrichten liegen (Trigger-Transcript), wähle Index-Tabelle oder API-Suche; Sidebar-Suche (components/sidebar-search.tsx) zeigt Treffer mit Snippet und springt in den Chat.
3. Orbi-Status: Zustände ruhig/denkt/arbeitet/wartet/blockiert/fertig als Orb-Animation am Avatar (reduced-motion beachten), Details beim Hover; Gruppenlimit 6.
4. Automationen: Tabelle automations, Trigger.dev Scheduled Task, UI-Bereich „Geplant“ (Liste, Anlegen per Dialog und per Chat-Befehl, pausieren/bearbeiten/Papierkorb), „Jetzt ausführen“, Lauf-Verlauf (letzte 20), Wahl „gleicher Chat | neuer Chat je Lauf“, Benachrichtigung (App/aus; Mail später), Mindestabstand 5 Min., max. 50 je Orbi, Auto-Pause bei langer Abwesenheit.
Fertig: npm run check grün; Browser-Test aller vier Teile mit Screenshots; trigger deploy. Kurzbericht.
```

---
## P-R Recherche (Haiku/Sonnet, früh starten)
```
Recherchiere (WebSearch/Firecrawl) Features und Automation von: Grok (xAI Grok-Bot-Team/Grok-App), ChatGPT (Tasks, Memory, Projects, Connectors, Canvas, Voice, Agent), Dots. Ziel: was braucht ein persönlicher KI-Chat mit mehreren Assistenten (Orbis) unbedingt? Schreibe plan/RESEARCH.md: je Feature Quelle, Kurzbeschreibung, Einstufung „unverzichtbar / nice / Alleinstellung“, Aufwand S/M/L, Empfehlung für Orbit 2 (Gruppen, Hauptorbi-Handoff, Brain-Anbindung, Jev sind Orbits Alleinstellung). Max. 2 Seiten, Quellen verlinkt.
```

---
## P10 Abnahme
```
Repo Orbit 2. Lies plan/PLAN.md (P10). 1) npm run check. 2) Gehe die Polish-Checkliste (P9) im Browser durch, Screenshots Dark/Light/Mobile. 3) Deploy nach AGENTS.md-Reihenfolge, Smoke-Test Prod. 4) Hinterlege den Branch für das Code-Review (Consti startet /code-review ultra), arbeite danach die Funde ab und wiederhole npm run check. 5) Schreibe Kurzbericht und die Liste „Umstieg auf native Mac-App“ in plan/NATIVE.md.
```
