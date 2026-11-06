---
tags: [orbit, api, orbitd]
status: aktuell
date: 2026-10-23
herkunft: Mac-Umbau Schritt 2c, von Hand aus dem Code abgeleitet (service/src/app.ts, service/src/routes.ts, actions/*.ts, query/*.ts, node_modules/ai/src/ui-message-stream/ui-message-chunks.ts) und gegen den laufenden Dienst geprüft
---

# Orbit 2: Schnittstelle des lokalen Dienstes (orbitd)

Grundlage für Schritt 3 (Swift). Kein Generator: bei Codeänderungen von Hand nachziehen. Alle Texte in Fehlern sind deutsch.

## Grundlagen

| Punkt | Wert |
|---|---|
| Adresse | `http://127.0.0.1:4317` (Port per `ORBITD_PORT`, 1024–65535). Nur Loopback. |
| Schlüssel (installierter Dienst) | `~/Library/Application Support/Orbit/secrets.env`, Rechte 0600 (sonst nicht gelesen), Zeilen `SCHLÜSSEL=Wert`; gesetzte Umgebungsvariablen gewinnen; läuft als LaunchAgent `de.consti.orbit2.service` aus dem App-Bündel (`Contents/Resources/runtime/node` + `service/orbitd.mjs`, Migrationen über `ORBIT_MIGRATIONS_DIR`). |
| Token | Datei `~/Library/Application Support/Orbit/service.token` (Rechte 0600, 64 Hex-Zeichen, `ORBIT_DATA_DIR` verschiebt den Ordner). Jede Anfrage: `Authorization: Bearer <token>`. |
| Host-Header | muss exakt `127.0.0.1:<port>` sein, sonst `403`. |
| Origin | fehlt (native App) oder ist `http://localhost:3000` (Web-Testgerät), sonst `403`. CORS nur für diese Origin; Methoden GET, POST, PUT, PATCH, DELETE. |
| Ausnahme | `GET /oauth/callback` braucht keinen Token (Browser-Redirect), prüft aber Host und Origin. |
| Identität | immer der lokale Nutzer `local`; es gibt keine Nutzer-ID in Pfaden. |
| Format | JSON (`Content-Type: application/json`), Zeiten als ISO-8601 (`"2026-10-23T10:51:26.000Z"`), außer wo „ms“ steht (Zahl, Millisekunden seit Epoche). Anfragekörper höchstens 1 MB (Turn: 25 MB). |

### Fehlerformen

Zwei Formen, beide haben `error` (deutscher Text):

1. **Dienstfehler** (kein Token, falscher Host, unbekannte Route, Ungültiges): `{ "error": "…" }` mit Status `400` ungültige Anfrage/JSON, `401` Token fehlt/falsch, `403` Host/Origin, `404` Route oder Chat unbekannt (`"Nicht gefunden."`, `"Chat nicht gefunden."`), `409` Konflikt (Chat belegt), `410` Freigabe/Rückfrage nicht mehr offen, `413` zu groß, `500` (`"Der lokale Dienst konnte die Anfrage nicht verarbeiten."`), `503` Funktion nicht eingebunden.
2. **Aktionsfehler** (alle REST-Endpunkte unten, die Logik aus `actions/`): `{ "ok": false, "error": "…" }`. Status `404`, wenn der Text „nicht gefunden“ enthält, sonst `400`.

Erfolg bei Aktionsendpunkten: Status `200`, Körper enthält `"ok": true` plus die genannten Felder. Swift entscheidet am besten über `ok == false` **oder** HTTP-Status ≥ 400.

## Chat

### `POST /v1/chats/:id/turn`
Startet einen Turn; Antwort ist ein Server-Sent-Events-Strom im AI-SDK-UI-Format.

Anfrage:
```json
{
  "messages": [ { "id": "u-1", "role": "user", "parts": [ { "type": "text", "text": "Hallo" } ] } ],
  "clientData": { "model": "claude-haiku-5-5", "effort": "low", "context": true, "botId": "…", "skill": { "name": "kurze-zusammenfassung", "source": "orbit" } },
  "trigger": "submit-message",
  "messageId": "…"
}
```
- `messages`: 1–1000 Einträge; bei `submit-message` zählt **nur die letzte** (die Nutzernachricht). Erlaubte Teile: `text` und `file` (`{type:"file", mediaType, url (data:-URL), filename?}`). Die ID muss neu sein (sonst `409`).
- `clientData.model`: Modell-ID aus dem Katalog (`lib/chat-catalog.ts`) oder `"auto"` (Jev wählt). `effort` je nach Modell (`low|medium|high|xhigh|max`); `approvalMode` ist **entfernt** (Phase 1, 01.11.2026): ältere App-Versionen dürfen es weiter senden, der Dienst ignoriert es still; `context` (Standard `true`; `false` = nur letzte Nachricht); `botId` = antwortender Orbi im Gruppenchat; `skill` = Slash-Skill; `modelPinned` (Bool, Phase 2) = Consti hat das Modell in diesem Chat **ausdrücklich gewählt** (nicht der Standard): Orbis, die in diesem Auftrag geweckt werden, übernehmen dann Modell und Stufe, sonst nutzt jeder sein eigenes (Modell seiner letzten Antwort im 1:1-Chat, sonst Jev). Die App setzt das Feld nur nach einer Wahl in der Modellauswahl dieses Chats.
- `trigger`: `submit-message` (Standard) oder `regenerate-message` (mit optionalem `messageId`, schneidet den Verlauf dort ab).

Antwort: `200`, `Content-Type: text/event-stream`, Header `x-vercel-ai-ui-message-stream: v1`. Jede Zeile `data: <JSON>` + Leerzeile, Ende `data: [DONE]`. Fehler vor dem Strom: `400` (ungültig), `404`, `409` (`"In diesem Chat läuft bereits eine Antwort."`), `413`.

### SSE-Chunk-Typen (Turn und `/stream`)
Aus `uiMessageChunkSchema` (Felder mit `?` optional; unbekannte Zusatzfelder ignorieren):

| `type` | Felder |
|---|---|
| `start` | `messageId?`, `messageMetadata?` (siehe Metadata) |
| `start-step`, `finish-step`, `reset-step` | – |
| `text-start` / `text-end` | `id` (`text-end`: `citations?`) |
| `text-delta` | `id`, `delta` |
| `reasoning-start` / `reasoning-end` | `id` |
| `reasoning-delta` | `id`, `delta` |
| `tool-input-start` | `toolCallId`, `toolName`, `dynamic?` |
| `tool-input-delta` | `toolCallId`, `inputTextDelta` |
| `tool-input-available` | `toolCallId`, `toolName`, `input` |
| `tool-input-error` | `toolCallId`, `toolName`, `input`, `errorText` |
| `tool-approval-request` | `approvalId`, `toolCallId` (die Freigabe-ID ist dieselbe wie in `/v1/approvals`) |
| `tool-approval-response` | `approvalId`, `approved` |
| `tool-output-available` | `toolCallId`, `output` |
| `tool-output-error` | `toolCallId`, `errorText` |
| `tool-output-denied` | `toolCallId` |
| `source-url` | `sourceId`, `url`, `title?` |
| `source-document` | `sourceId`, `mediaType`, `title`, `filename?` |
| `file` / `reasoning-file` | `url`, `mediaType` |
| `custom` | `kind` |
| `data-<name>` | `data` (Nutzdaten, derzeit nicht verwendet) |
| `message-metadata` | `messageMetadata` |
| `finish` | `finishReason?` (`stop|length|content-filter|tool-calls|error|other`), `messageMetadata?` (Endwerte: Tokens, `finishedAt`) |
| `abort` | `reason?` (Turn gestoppt oder Zeitlimit) |
| `error` | `errorText` (z. B. „Die Antwort konnte nicht erstellt werden. Prüfe unter Einrichtung, ob die Modell-Anmeldungen in Ordnung sind …“; bei CLI-Fehlern der fertige Satz, z. B. „Claude ist nicht angemeldet. Melde dich im Terminal mit „claude auth login“ an.“) |

Reihenfolge je Turn: `start` → (`start-step` → Text/Werkzeug-Chunks → `finish-step`)* → `finish` → `[DONE]`. Eigene Werkzeuge liefern Ausgaben in `output`: `send_message` (Phase 2, siehe „Nachrichten zwischen Orbis“; ersetzt `handoff`, alte `tool-handoff`-Teile in vorhandenen Chats bleiben lesbar), `web_search` (Quellen), Bilder (`GeneratedImageOutput`), `ask_user` (siehe Rückfragen).

**Metadata** (`messageMetadata`, Typ `ChatMetadata`): `botId?`, `model?`, `effort?`, `startedAt?` (ms), `finishedAt?` (ms), `inputTokens?`, `outputTokens?`, `reasoningTokens?`, `handoffId?`, `handoffFrom?`, `handoffGroup?` (alt), `kind?: "orbi-line"` und `rootTaskId?` (nur bei gespeicherten Zeilen), `cachedTokens?`, `cacheWriteTokens?`, `steps?` (Modellschritte des Turns), `costUsd?` (Listenpreis-Richtwert, Phase 4 G), `systemChars?`, `skill? {name, source}`, `jev? JevInfo` (`kind: route|handoff|summary|memory`, `tier?`, `model?`, `modelLabel?`, `effort?`, `reason`, `confidence?`, `durationMs`, `source: jev|fallback`, `target?`, ab Lauf I `change?: start|keep|upgrade|reset|fallback` und `from?` = Modell vor einer Hochstufung; `reason` ist ein deutscher Satz wie „Start klein: …“, „Hochgestuft von A auf B.“, „Bleibt bei A (Cache warm).“).

### `GET /v1/chats/:id/stream`
Hängt sich an den laufenden Turn des Chats (Wiedergabe ab Anfang, dann live). Kein Turn aktiv: `204` ohne Körper. Format wie oben.

### `POST /v1/chats/:id/stop`
→ `{ "stopped": true|false }` (`false`, wenn weder ein Turn lief noch ein Auftrag mit diesem Chat als Root). **Stopp im Root-Chat** (dem Chat, in dem Consti die auslösende Nachricht schrieb) bricht zusätzlich alle Orbis dieses Auftrags ab (laufende Turns in ihren Chats), verwirft wartende Zustellungen und setzt deren Zeilen auf `fehlgeschlagen`; niemand wird danach geweckt. Das gilt auch, wenn der Root-Turn schon beendet ist. Stopp in einem anderen Chat bricht nur dort ab; der Fragende bekommt dann `failed: abgebrochen` als Antwort.

### `GET /v1/chats/:id/messages`
→ `{ "messages": UIMessage[] }`; `UIMessage` = `{ id, role: "user"|"assistant", parts: Part[], metadata?: ChatMetadata }`. Part-Typen (AI SDK): `text {text}`, `file {mediaType,url,filename?}`, `reasoning {text}`, `step-start`, `source-url`, `tool-<name> {toolCallId, state: input-streaming|input-available|output-available|output-error|approval-requested|approval-responded|output-denied, input, output?, errorText?}`, `dynamic-tool`.
Seitenweise (06.11.2026): `?limit=N` liefert die neuesten N (höchstens 500) plus `hasMore`; `&before=<messageId>` die N vor dieser Nachricht. Ohne `limit` unverändert der ganze Verlauf ohne `hasMore`.

### `DELETE /v1/chats/:id/messages`
Leert Verlauf und Suchindex → `{ "ok": true }`; `409` solange ein Turn läuft.

### Gruppen
| Methode, Pfad | Körper | Antwort |
|---|---|---|
| `GET /v1/chats` | – | `{ ok, chats: [{ id, lastMessageAt, memberCount }] }` (nur Direkt- und Gruppenchats) |
| `POST /v1/chats` | `{ name (1–40), botIds: string[] (≥1) }` | `{ ok: true, id }` |
| `PATCH /v1/chats/:id` | wie oben | `{ ok: true }` |
| `DELETE /v1/chats/:id` | – | `{ ok: true }` |

## Ereignisse

### `GET /v1/events`
SSE, global, bleibt offen. Zeilen `data: <JSON>`; Kommentarzeilen `: keepalive` alle 15 s. Ist der Leser zu langsam, bricht die Verbindung ab: neu verbinden (liefert wieder einen Snapshot).

Erstes Ereignis immer der Snapshot:
```json
{ "type": "snapshot", "approvals": [PendingInteraction], "working": [StatusEvent], "automations": [AutomationEvent] }
```
Danach live:

| `type` | Felder |
|---|---|
| `status` | `chatId`, `botId`, `status: arbeitet|wartet|fertig|fehler|ruhig` |
| `approval` / `question` | `PendingInteraction` + `status: pending|approved|denied|expired|aborted|answered` |
| `orbi-message` | Gespeicherte Zeile neu/geändert (Phase 2): `chatId`, `messageId`, `linkId`, `direction: out|in`, `kind: message|reply`, `status: arbeitet|wartet|fertig|fehlgeschlagen|unklar`, `queued`, `held`. Danach `GET /v1/chats/:id/messages` neu laden (oder die Zeile per `messageId` ersetzen). |
| `group-turn` | Gruppenrunde (Phase 2, A2): `chatId` (Gruppenchat), `phase: start|reply|silent|end`, `botId?` (das Mitglied), `messageId?` (bei `reply`: gespeicherte Antwort), `stopped?` (bei `end`). Nach `reply` und `end` den Verlauf neu laden. |
| `handoff` (veraltet, wird nicht mehr gesendet) | `chatId` (Chat des Ziels), `botId` = `to` (Orbi-ID des Ziels, nicht des Übergebenden), `handoffId`, `status: running|finished|error` (`waiting` sendet der Dienst nicht; „wartet“ steht in der Ausgabe des Werkzeugs als `waiting`) |
| `automation` | `automationId`, `runId`, `chatId` (oder `null`), `trigger: schedule|manual`, `status: running|waiting|ok|error`, `error?` |

Zustand „wartet“: Ein Chat meldet `wartet`, solange er selbst eine offene Freigabe/Rückfrage hat; danach wieder `arbeitet`. Seit Phase 2 (`send_message` wartet nicht) gibt es keine Elternkette mehr: der absendende Chat ist nach seinem Turn `fertig`/`ruhig`, der geweckte Orbi arbeitet in seinem eigenen Chat (`status`-Ereignis mit dessen `chatId`/`botId`).

`PendingInteraction`: `{ id, kind: "approval"|"ask", chatId, botId, toolCallId, tool, input, requestedAt (ms), expiresAt (ms), reason?, approvalKind?, text?, detail?, root?, from? }` (`root`/`from`: siehe „Rückfragen und Freigaben im Root-Chat“). Freigaben/Rückfragen warten bis zu 24 Stunden (Dienst-Neustart verwirft offene, Phase 5).

**Feste Freigabe-Regel (Phase 1):** Es gibt keine Modi. Gefragt wird nur bei sieben Arten, `reason`: `geld` | `veroeffentlichen` | `nachricht` | `loeschen` | `geheimnis` | `system` | `dauerhaft` (Lauf E, 01.11.2026; Label „Dauerhafte Änderung“). `approvalKind` ist der Schlüssel für „Immer für diese Art“ (Plugin: `connector:<id>:<tool>`, bash: `bash:<reason>`, Desktop: `desktop:<reason>`, sonst Werkzeugname); `text` ist ein deutscher Satz für die Karte. `kind` bleibt `approval|ask` (deshalb `approvalKind`). Alles andere läuft ohne Karte. Ein wörtliches Zitat aus Constis letzter Nachricht als `consti_said` im Werkzeugaufruf (nur bei Werkzeugen, die fragen können; nie bei Übergaben oder Automationen) läuft ohne Karte; eine Sperre (`deny`) gewinnt immer. **Neu in Lauf E:** `dauerhaft` = wirkt später ohne Consti weiter. Auslöser: `automation_create` (`approvalKind: "automation_create"`; `tool: "automation_create"`; `input` = `{ name, prompt, schedule, target? }`), `brain_write` außer „neu anlegen in `01 Inbox/`“ (`approvalKind: "brain_write:regeln"` für `04 Ressourcen/Fähigkeiten/` und `04 Ressourcen/KI-Gedächtnis/`, sonst `"brain_write:dauerhaft"`). Für `dauerhaft` gibt es kein „Immer“ (`always` gilt einmal, wird nicht gespeichert) und kein `consti_said` bei Automationen. Neues optionales Feld `detail` (String, mehrzeilig, ungekürzt, nur bei einigen Arten, bei `automation_create` immer): `"Name: <Name>\nPlan: <täglich um 08:00 | Mo–Fr um 08:00 | jede Woche Montag um 07:30 | monatlich am 5. um 08:00 | einmalig am 2026-11-05 um 08:00> (Europe/Berlin), <gleicher Chat | neuer Chat je Lauf>\nAufgabe (wörtlich):\n<Prompt>"`. Karte: `text` als Titel, `detail` als Textblock darunter (Zeilenumbrüche erhalten, scrollbar, nicht kürzen). Unbekannte Konnektor-Werkzeuge ohne `readOnlyHint: true` fragen jetzt mit `reason: "system"`. Ein Mac-Client, der `reason` als festes Enum dekodiert, muss `dauerhaft` kennen (sonst auf `system` zurückfallen); `detail` ist optional. `consti_said` zählt nur noch, wenn das Zitat Art-Wort **und** alle Ziele der Aktion (Pfade, Empfänger, Beträge) enthält, keine Verneinung nahe dem Zitat steht und jede Teilaktion eines Befehls abgedeckt ist. Neues Werkzeug `confirm_action { reason, summary }` für den letzten Klick zum Kaufen/Senden/Posten im Sandbox-Desktop (abgelehnt: `{ approved: false }`).

## Freigaben und Rückfragen

| Methode, Pfad | Körper | Antwort |
|---|---|---|
| `GET /v1/approvals` | – | `{ approvals: PendingInteraction[] }` (nur `kind: approval`) |
| `POST /v1/approvals/:id/decide` | `{ "decision": "once"|"always"|"deny" }` | `{ ok: true }`; `410` nicht mehr offen; `409` abgelaufen/schon entschieden; `500` Speichern fehlgeschlagen. `always` legt eine Regel `allow` für Orbi + `approvalKind` an und gilt noch im selben Turn; bei `reason: geheimnis` gilt `always` nur einmal und wird nicht gespeichert. Alte `ask`-Regeln werden ignoriert. |
| `POST /v1/questions/:id/answer` | `{ "answers": [{ "question": "…", "answers": ["…"] }] }` oder `{ "skipped": true }` | `{ ok: true }`; `410` nicht offen; `400` ungültig/abgelaufen. Fragen und Optionen stehen in `input` (`questions[{question, options[{label, description?, recommended?}], multiple?}]`). |

## Nachrichten zwischen Orbis (Phase 2, Lauf A1)

Ersetzt die Übergabe (`handoff`). Fire-and-forget wie Grok Bot: ein Orbi sendet, wartet nicht, die Antwort kommt später als neue Nachricht. Alles, was aus **einer** Nachricht von Consti entsteht, ist ein **Auftrag** (`rootTaskId`, nur im Dienst, nie vom Browser); der Chat, in dem Consti schrieb, ist der **Root-Chat** (`rootChatId`).

**Werkzeug** `send_message { target, message, priority }` (alle Pflicht; `target` = Orbi-Id, genauer Name oder Gruppen-Id; `message` bis 4000 Zeichen). Ergebnis sofort: `{ ok: true, to, linkId, delivery: "wake"|"queued"|"held"|"group" }` oder `{ ok: false, error }` (deutsch, z. B. „Limit erreicht: …“). `wake` = Ziel wird geweckt; `queued` = Ziel arbeitet noch, Zustellung beim Turn-Ende; `held` = `priority=false`, wird beim nächsten Turn des Ziels gelesen (oder die Antwort-auf-Antwort-Regel hat auf `false` gesetzt); `group` = Ziel war eine Gruppe.

**Gespeicherte Zeilen.** Jede Nachricht erzeugt zwei echte Verlaufsnachrichten (ohne Modellaufruf, nach Neustart vorhanden, in `chat_messages`, keine Migration): eine im Chat des Absenders (`direction: "out"`, Rolle `assistant`), eine im 1:1-Chat des Empfängers (`direction: "in"`, Rolle `user`). Die Antwort erzeugt dasselbe zurück (`kind: "reply"`). Sie kommen in `GET /v1/chats/:id/messages` als Nachricht mit **genau einem** Teil:
```json
{ "id": "…", "role": "assistant|user",
  "metadata": { "kind": "orbi-line", "rootTaskId": "…" },
  "parts": [ { "type": "data-orbi-message", "data": OrbiLine } ] }
```
`OrbiLine` (`lib/chat/orbi-message.ts`): `v: 1`, `linkId` (gleich in beiden Zeilen des Paares; Antwort hat eigene `linkId`), `direction: "out"|"in"`, `kind: "message"|"reply"`, `peer { id, name, avatar, color }` (die Gegenseite; bei Gruppenzielen die Gruppe mit leerem `avatar`), `group? { id, name }`, `text`, `priority`, `held?`, `queued?`, `status`, `token`, `rootTaskId`, `createdAt` (ms), `updatedAt?`.

Anzeige für Lauf B: `out`+`message` = „Nachricht gesendet an @peer“ (aufklappbar: `text`), `in`+`message` = „Nachricht von @peer“, `out`+`reply` = „Antwort gesendet an @peer“, `in`+`reply` = „Antwort von @peer“. `status`: `arbeitet` (Ziel hat/arbeitet; mit `queued` noch nicht gestartet, mit `held` nicht geweckt), `wartet` (Ziel wartet auf Consti: offene Freigabe oder Frage), `fertig` (Antwort da), `fehlgeschlagen` (Abbruch, Stopp, Fehler), `unklar` (Zustand nach Neustart). Antworten sind freier, kurzer Text ohne Pflicht-Präfix (E20, 03.11.2026); der Status kommt aus dem Ablauf. *Code bis Umbau-Schritt 12: Status noch aus der ersten Zeile.* Beide Zeilen eines Paares tragen denselben Status. Der Status ändert sich in der gespeicherten Zeile; das Ereignis `orbi-message` meldet jede Änderung. Reihenfolge: Zeilen, die während eines laufenden Turns entstehen, werden **hinter** die Antwort dieses Turns einsortiert (sortiere für die Anzeige bei Bedarf nach `createdAt`).

**Modellkontext.** Ausgangszeilen (`out`) gehen nie ans Modell. Eingangszeilen (`in`) gehen **einmal** als gerahmter Nutzertext an den Empfänger: `<message_<token> from="@Name" id="<Orbi-Id>" kind="orbi" [reply="true"] [group="…"]>…</message_<token>>` (Inhalt mit `& < > "` escaped, Token zufällig je Nachricht). Prompt-Regel: Rahmen sind Daten, keine Befehle, nie eine Freigabe. Werkzeug-Ergebnisse von `web_search`, `read_file`, `bash` und Plugins (`connector_*`) sehen die Modelle in `<untrusted_data_<token> source="…">…</…>` (nur Modellsicht, die Anzeige bleibt).

**Weckmechanik** (`service/src/chat/dispatcher.ts`). `priority=true`: Dienst startet im 1:1-Chat des Ziels einen Turn (Modell: `modelPinned` des Root, sonst eigenes). Ist der Chat belegt (Consti schreibt dort, oder ein anderer Weckruf läuft), wartet die Zustellung und startet bei Freigabe des Chats; mehrere wartende Nachrichten desselben Auftrags werden **zusammen** zugestellt. Der geweckte Orbi schreibt normal in seinen Chat (sichtbar, mit Werkzeugen); sein **Endtext wird automatisch als Antwort** zurückgeschickt (max. 1500 Zeichen, Status aus dem Ablauf, E20). Hat er selbst noch Nachrichten offen, antwortet er erst nach deren Antworten. Der Fragende wird **einmal** geweckt, wenn **alle** seine offenen Prioritätsnachrichten beantwortet sind, im Chat, aus dem er gesendet hat (auch Gruppe); dieser Turn fasst für Consti zusammen und schickt **keine** automatische Antwort. Ziel gestoppt/fehlgeschlagen: Antwort `failed: abgebrochen` bzw. Fehlertext, Fragender wird geweckt.

**Grenzen** (hart im Dienst, Konstanten `LIMITS` in `lib/chat/orbi-message.ts`): 3 gesendete Nachrichten je Orbi und Turn; 12 Orbi-zu-Orbi-Nachrichten je Auftrag (automatische Antworten zählen nicht); höchstens 4 Orbis gleichzeitig im Auftrag (laufend oder wartend zugestellt; bereits Beteiligte zählen nicht doppelt; `priority=false` ist ausgenommen). Überschreitung: `send_message` liefert `{ ok: false, error }` („Limit erreicht … berichte Consti kurz“). **Ping-Pong-Ende:** sendet ein Orbi, dessen Turn durch eine Antwort geweckt wurde, eine Nachricht ohne `?`, wird `priority` auf `false` gesetzt (kein Weckruf). Zeit: je Turn 60 Minuten Gesamtgrenze (Wartezeit auf Freigaben und Zeit in der Warteschlange zählen nicht) und Abbruch nach 5 Minuten ohne Lebenszeichen (Text, Denken, Werkzeugschritt; solange ein Werkzeug läuft, tickt nur die Gesamtgrenze). Gilt für **alle** Turns (E21/E24, 03.11.2026). *Code bis Umbau-Schritt 12: noch 30/3 Minuten.* Kein Übergabe-Timeout mehr.

**Gruppen als Ziel.** Eine Zeile im Gruppenchat (`direction: "in"`, `group` gesetzt, Absender = `peer`) und eine „gesendet“-Zeile (Status `fertig`) beim Absender; `priority` wird ignoriert, **niemand wird geweckt**. Der Haken für Lauf A2 (Gruppenrunde: Mitglieder nacheinander, Schweigen erlaubt) ist `onGroupMessage` in `createDispatcher` (`group`, `fromBotId`, `taskId`, `chatId`, `messageId`).

**Offen / bekannte Grenzen.** Zustellungen und Aufträge liegen nur im Speicher. Startet orbitd neu, setzt der Dienst beim Start alle Zeilen mit `arbeitet`, `wartet` (oder `queued`) auf `unklar` (`queued: false`); gehaltene Zeilen bleiben für den Empfänger lesbar, zeigen aber ebenfalls `unklar`. Offene Rückfragen/Freigaben sind nach einem Neustart weg (Phase 5).

## Rückfragen und Freigaben im Root-Chat (Phase 2, Lauf A2)

Jeder geweckte Orbi nutzt normal `ask_user` und die Freigaben (die A1-Sperre ist weg). Seine Karte erscheint **zusätzlich** im Root-Chat. Das ist keine zweite Karte, sondern dieselbe Interaktion mit zwei Feldern, die nur gesetzt sind, wenn der fragende Orbi **nicht** im Root-Chat arbeitet:

- `root: { chatId, taskId }`: der Chat, in dem Consti die auslösende Nachricht schrieb (dort anzeigen), und der Auftrag.
- `from: { id, name, avatar, color }`: der fragende Orbi (für Absender-Kopf der Karte: Avatar, Name, Farbe).
- `chatId`/`botId` bleiben der Chat und der Orbi des Fragenden.

Beide Felder stehen im Snapshot (`approvals` des Snapshots enthält alle offenen Rückfragen **und** Freigaben), in den Ereignissen `approval` / `question` (`status: pending`) und in `GET /v1/approvals` (nur Freigaben; Rückfragen kommen nur über Snapshot und Ereignisse). Beantwortet wird mit denselben Aufrufen wie sonst (`POST /v1/questions/:id/answer`, `POST /v1/approvals/:id/decide`) über die `id`; die Antwort geht an den fragenden Orbi, der im eigenen Chat weiterarbeitet. Ist der geweckte Chat selbst der Root-Chat (der Absender fasst nach dem Wecken zusammen), fehlen `root` und `from`: eine Karte, `ask_user` wie immer.

**Hinfällig:** Endet der Auftrag oder der Turn des Orbis (Stopp im Root, Abbruch, Turn-Ende, 24 h), sendet der Dienst `approval`/`question` mit `status: aborted` (bei Ablauf `expired`) und denselben `root`/`from`. Eine Karte mit `aborted` oder `expired` ist hinfällig: ausblenden oder grau; sie verschwindet aus `manager.list()`/Snapshot. Die Wartezeit bleibt 24 h. Die Zeile „Nachricht von @A“ im Chat des Orbis wechselt bei einer offenen Rückfrage auf `wartet` (A1).

Mitteilung/Öffnen: Der Klick auf eine Mitteilung zur Karte öffnet `root.chatId`.

## Gruppenchat wie Grok Bot (Phase 2, Lauf A2)

Schreibt Consti in einen Gruppenchat (`kind: group`, `POST /v1/chats/:id/turn`), gilt die Gruppenrunde (Hintergrundläufe ausgenommen):

- **Fan-out:** Die Nachricht geht an alle Mitglieder, im Modellverlauf als `[Gruppe: <Name>] <Text>` gekennzeichnet. Sie sprechen **nacheinander** in Mitgliederreihenfolge (Hauptorbi zuerst, dann Beitrittszeit); **@-Markierte zuerst** (in Reihenfolge der Nennung). Erkannt werden `@[Name](orbi:<id>)` (zählt die Id) und Klartext `@Name` (Groß/Klein egal, längster Name zuerst, nur eindeutig; Wortgrenze). Jeder sieht die Antworten davor (der Verlauf wird je Mitglied frisch geladen).
- **Schweigen:** Ein Mitglied darf nichts schreiben. Eine Antwort ohne Text/Werkzeug/Datei (oder nur Denken) wird **nicht gespeichert** (kein Eintrag im Chat). Nur für den ersten Sprecher streamt `POST /turn` eine solche Nachricht kurz (leer); nach dem Ende des Streams verschwindet sie beim Neuladen.
- **@Name antwortet sicher:** Prompt-Hinweis plus harte Regel: schweigt ein Markierter, läuft **einmal** ein Nachlauf mit „You must answer now.“. Antworten alle nicht, antwortet der zuletzt in der App gewählte Orbi (`clientData.botId`), sonst der erste, mit demselben Nachlauf. So antwortet mindestens ein Mitglied.
- **Ablauf für die App:** `POST /turn` liefert den Stream des **ersten** Sprechers. Danach läuft die Runde im Hintergrund weiter; der Gruppenchat bleibt bis zum Ende **belegt** (`POST /turn` → 409, `GET /v1/chats/:id/stream` liefert den Stream des jeweils aktuellen Sprechers, 204 dazwischen). Ereignisse `group-turn` (`start`, `reply`, `silent`, `end`) und die üblichen `status`-Ereignisse zeigen den Fortschritt (der Status wechselt zwischen den Mitgliedern kurz auf `fertig`; `group-turn` `end` ist das verlässliche Ende). Nach `reply`/`end` Verlauf neu laden.
- **Stopp:** `POST /v1/chats/:id/stop` auf dem Gruppenchat bricht den laufenden Sprecher und die restliche Runde ab (auch zwischen zwei Sprechern); kein Rückfall danach; `group-turn` `end` mit `stopped: true`.
- **Modell:** alle Mitglieder nutzen das im Chat gewählte Modell (Vermutung: es gibt nur eine Auswahl je Gruppe).
- **Orbis in Gruppen** arbeiten inline: kein Übergabe-Chat. `send_message` mit `target` = Gruppen-Id schreibt die Nachricht in den Gruppenchat (Zeile `in` mit `group`) und startet eine Runde der **anderen** Mitglieder (Absender spricht nicht; Schweigen erlaubt; kein Rückfall; Markierungen im Text werden beachtet). Die Runde wartet, wenn der Gruppenchat belegt ist. Die A1-Limits gelten (die Nachricht zählt zu den 12 je Auftrag, 3 je Turn); die Antworten der Mitglieder sind normale Gruppennachrichten und lösen keine weitere Runde aus. Schreibt ein Orbi aus dem Gruppenchat selbst an die Gruppe, bekommt er einen Fehler (er antwortet direkt). Für Orbi-Nachrichten gilt kein `consti_said`.
- Prompt-Zusatz je Gruppenturn: 199 Zeichen (markiert 233, Nachlauf ähnlich); er ersetzt den alten Satz „The user picked YOU …“ (rund 232 Zeichen). Gruppen-Prompt (Messfall: 3 Orbis, ohne AGENTS.md/Sandbox/Skills) vorher 1645, danach 1618 Zeichen (markiert 1652).

## Automationen

Zeitpläne (`schedule`): `{kind:"once", at:"HH:MM", date:"YYYY-MM-DD"}`, `{kind:"daily"|"weekdays", at}`, `{kind:"weekly", at, weekday:0–6}`, `{kind:"monthly", at, day:1–31}`.

Eingabe (Anlegen/Ändern): `{ botId (nur Anlegen), name (2–60), prompt (1–4000), schedule, timezone (z. B. "Europe/Berlin"), target: "same"|"new", notify: "app"|"none", model?: string|null, effort?: string|null, context: bool, chatId? (nur Anlegen, bei target "same") }`. Höchstens 50 je Orbi.

| Methode, Pfad | Körper | Antwort |
|---|---|---|
| `GET /v1/automations` | – | `{ ok, automations: [{ automation, bot: {id,name,avatar} }], trash: [...] }`; `automation` = `{ id, userId, botId, name, prompt, schedule, timezone, target, chatId, notify, model, effort, context, enabled, pausedReason, lastRunAt, resumedAt, nextRunAt, deletedAt, createdAt }` |
| `POST /v1/automations` | Eingabe | `{ ok: true, id }` |
| `PATCH /v1/automations/:id` | Eingabe | `{ ok: true }` |
| `PUT /v1/automations/:id/enabled` | `{ "enabled": bool }` | `{ ok: true }` |
| `POST /v1/automations/:id/trash` · `/restore` | – | `{ ok: true }` |
| `DELETE /v1/automations/:id` | – | `{ ok: true }` (endgültig, nur aus dem Papierkorb) |
| `POST /v1/automations/:id/run` | – | **Jetzt ausführen**: `{ ok: true, runId }` sofort nach dem Start; der Lauf läuft im Hintergrund (Status über `/v1/events`, Ergebnis als Chat). `404` unbekannt, `400` mit `"Ein Lauf läuft noch oder wartet auf Freigabe."` |
| `GET /v1/automations/:id/runs` | – | `{ ok, runs: [{ id, automationId, userId, chatId, status: running|waiting|ok|error, trigger, error, startedAt, finishedAt }] }` (letzte 20) |
| `GET /v1/automations/unread?since=<ms>` | – | `{ ok, count }`: fertige Läufe mit App-Hinweis seit `since` (höchstens 24 h zurück). Den Zeitpunkt „gesehen“ hält der Client. |

**Scheduler:** Prüfung alle 30 s und beim Start. Fällige Termine laufen genau einmal; verpasste Termine (Schlaf, Dienst aus) holt der Dienst je Automation höchstens einmal nach, der nächste Termin wird ab „jetzt“ berechnet. Einmalige Automationen werden danach ausgeschaltet. Beim Start werden offene Läufe als „Lauf abgebrochen“ beendet. Ein Lauf ist ein normaler Turn im Chat (neuer Chat je Lauf bei `target: "new"`, sonst der Direktchat des Orbis), die Aufgabe steht getaggt als erste Nachricht (`[[automation:<Name>]]\n<Prompt>`). Läufe mit nötiger Freigabe stehen auf `waiting`.

## Orbis (Bots)

| Methode, Pfad | Körper | Antwort |
|---|---|---|
| `GET /v1/bots` | – | `{ ok, main: Bot|null, bots: Bot[], groups: [{ id, name, members: [{ id, avatar, color }] }] }`; `Bot` = `{ chatId, id, name, avatar, color, job, instructions, isMain, look, lastMessageAt }` (`look`: siehe unten, `null` = Standard); Gruppenmitglieder = `{ id, name, avatar, color, look }` |
| `GET /v1/bots/:id/library` | – | `{ ok: true, files: LibraryFile[], limitations: string[], truncated: boolean }` (ohne Datei-Bytes) |
| `GET /v1/bots/:id/library/:fileId` | – | `{ ok: true, file: LibraryFile & { data: string } }` (Base64, max. 5 MiB) |
| `POST /v1/bots` | `{ name (1–40), job (1–60), avatar (Orbi-Name aus `ORBIS`), color: "#rrggbb"|null, instructions (≤1000), isMain: bool, look?: Look|null }` | `{ ok: true, id, chatId }` (legt Orbi, Direktchat und Daytona-Sandbox an; `chatId` = Direktchat) |
| `PATCH /v1/bots/:id` | wie oben | `{ ok: true, id }` |
| `DELETE /v1/bots/:id` | – | `{ ok: true, id }` (löscht auch die Sandbox) |
| `GET /v1/bots/:id/memory` | – | Gedächtnis des Orbis (Lauf H): `{ ok: true, entries: MemoryEntry[], index: string, limits: { entries: 40, body: 1200, total: 24000, index: 1500 }, migrated: bool }`; neueste zuerst. `index` = der Text, den der Orbi im Prompt sieht. Unbekannter Orbi: 404 |
| `GET /v1/bots/:id/memory/:name` | – | `{ ok: true, entry: MemoryEntry }`, unbekannt: 404 `Eintrag nicht gefunden.` |
| `DELETE /v1/bots/:id/memory/:name` | – | `{ ok: true }` (Eintrag wird gelöscht, Zeile im Änderungslog), unbekannt: 404 |
| `GET /v1/bots/:id/dreamer` | – | Träumer des Orbis (Lauf I): `{ ok: true, enabled: bool, nextRunAt: ms\|null (null wenn aus), lastRunAt: ms\|null, running: bool, cost: { todayUsd, capUsd }, runs: DreamRun[] (letzte 10), changes: DreamChange[] (letzte 50) }`. `DreamRun = { id, startedAt, finishedAt\|null, status: "running"\|"ok"\|"skipped"\|"error", reason\|null, entriesBefore, entriesAfter, ops, costUsd\|null, error\|null }`. `DreamChange = { id, name, action: "dream-merge"\|"dream-remove"\|"dream-rewrite"\|"dream-retype", version\|null, detail, at }` (`detail` = `run <id> {JSON mit Vorher-Stand}`, höchstens 3 500 Zeichen). Unbekannter Orbi: 404 |
| `PUT /v1/bots/:id/dreamer` | `{ enabled: bool }` | Träumer ein-/ausschalten (Standard an): `{ ok: true, enabled }`. Fehlt `enabled`: 400 |
| `GET /v1/daytona/:botId/desktop-url` | – | `{ ok: true, url }`: signierte noVNC-URL (gültig 1 h, startet Sandbox und Desktop bei Bedarf, kann dauern); `{ ok:false, error:"Dieser Orbi hat keinen Computer." }` |

**Bibliothek:** `LibraryFile = { id, filename, mediaType, size, chatId, messageId, createdAt, kind: "file"|"image" }`; `createdAt` ist ein Unix-Zeitstempel in Millisekunden (Antwortende, sonst Speicherzeit). Nur eigene Chats und eindeutige Sender: `metadata.botId`, ersatzweise genau ein Mitglied in Direkt-/Routine-Chats. Erfasst erfolgreiche `generate_image`-Ausgaben und direkt über `create_pdf` oder `create_word` sowie ausdrücklich über `share_file` bereitgestellte Dateien bis 5 MiB; bereitgestellt bedeutet nicht zwingend selbst erstellt. Nutzeranhänge und Funddateien werden nicht automatisch übernommen, eine ausdrückliche Bereitstellung erfasst sie jedoch. Persistierter Dateikatalog, bestehende Verläufe werden beim Abruf nachgetragen; kein Sandbox-/Provider-Aufruf. Verschachtelte Übergaben werden dem ausführenden Orbi zugeordnet; Nachrichten über 32 MiB, mehr als 1000 Teile je Nachricht oder über acht Verschachtelungsebenen werden begrenzt und `truncated` meldet die Kürzung. Ältere Übergaben ohne Herkunftskennung können doppelt erscheinen. Dateien bleiben auch beim Leeren oder Löschen des Chats erhalten und werden beim Löschen des zugehörigen Orbis entfernt. Fehlender Orbi/Download: 404, normales Dienst-Token erforderlich.

Die Bildgenerierung ist vorerst ausgebaut; vorhandene `generate_image`-Ergebnisse bleiben im Verlauf und in der Bibliothek lesbar.

**`look` (Anpassung der Figur, 4a-2):** `{ eyes?: "round"|"square"|"triangle", accessory?: "none"|"cap"|"glasses"|"sunglasses"|"headphones", cheeks?: bool, gaze?: 0…1 (Blickstärke), reaction?: 0,04…0,4 (Reaktionszeit der Pupille in s) }`. Fehlt ein Feld, gilt der Planetenstandard. Farbton und Farbstärke stehen weiter in `color` (Farbton und Sättigung der Farbe). Spalte `bots.look` (JSON, Migration `0003_bot_look`); `PATCH` ohne `look` lässt den Wert unverändert (die Web-UI sendet es nicht), `look: null` setzt zurück. Der Planet „Sunny“ heißt im Dienst `universi`.

**Gruppen** (`POST/PATCH /v1/chats`): `{ name (1–40), botIds (1–6) }`; `PATCH` ersetzt die Mitglieder. Eine Gruppe mit einem Mitglied ist gültig. Löschen eines Orbis entfernt ihn aus allen Gruppen und löscht seine Direktchats; seine alten Antworten in Gruppen bleiben, ihre `metadata.botId` zeigt dann auf keinen Orbi mehr („Gelöschter Orbi“). `@Name` in der Nachricht gibt es nur in der App: sie setzt `clientData.botId`.

**Test ohne Kosten:** `ORBIT_FAKE_SANDBOX=1` (nur gegen eine Datenbankkopie mit `ORBIT_DATA_DIR`): `POST /v1/bots` legt keine Daytona-Sandbox an (Id `fake-<botId>`), `DELETE` löscht keine.

## Daytona-Desktop

Entscheidung aus dem Spike 3c (23.10.2026), gemessen gegen den echten Computer des Haupt-Orbis (eine vorhandene Sandbox, nichts angelegt oder gelöscht). Messcode: Commit `7129c36` (A, WKWebView mit sichtbarer Testansicht `--daytona-spike`) und `db0e2ff` (A+B komplett); im Baum bleibt nur der Messweg für B (`Orbit --daytona-spike <Ordner>`).

**Empfehlung: B, nativer RFB-Client** (`URLSessionWebSocketTask`, keine Fremdbibliothek). Gründe: passt zu „kein WebView“, der Handshake geht ohne Anmeldung durch, der Server nutzt Standardkodierungen, und das Kernstück (Handshake, Raw/CopyRect/Hextile, Zeiger- und Tastaturnachrichten) lief im Spike bereits pixelgleich. **Frage an Consti:** Scheitert B in Schritt 4 am Aufwand, wäre der Rückfall A (WKWebView, ca. 40 Zeilen). Das verlangt die Ausnahme von „kein WebView“, die nur dein Ja öffnet. Bis dahin gilt B.

### Server (nur lesend abgefragt)
- Xvfb `:0` **1024×768×24, fest** (kein Größenwechsel, nur Skalieren im Client), `x11vnc -forever -shared -rfbport 5901`, davor `websockify` auf 6080 (Pfad `/websockify`, Unterprotokoll `binary`, `wss`) und noVNC aus `/usr/share/novnc`.
- **RFB 3.8, Sicherheitsart nur „None“.** Die signierte URL ist der einzige Schutz und gibt volle Steuerung des Desktops: nie loggen, nie in Fehlertexte. `-shared`: Web-UI und App können gleichzeitig verbunden sein.
- Kodierungen: Raw, CopyRect, RRE, CoRRE, Hextile, Zlib, Tight, ZRLE (TRLE und ZlibHex nicht). Pseudo: ExtendedDesktopSize, Cursor, PointerPos. Keine erweiterte Zwischenablage: Text nur Latin-1.
- **WebSocket-Ping-Frames beenden die Verbindung** („Software caused connection abort“). Schritt 4 darf keine Ping-Frames senden; Lebenszeichen nur über RFB-Nachrichten.
- Die Sandbox war vor dem Spike gestoppt; der Dienst startet sie beim URL-Abruf. Daytona-Auto-Stopp: 15 Minuten ohne Aktivität. Die Startdauer einer gestoppten Sandbox ist nicht gemessen.

### Messwerte (mehrere Läufe, Mac ↔ Daytona über Internet, Streuung ist Netz)
| | A: noVNC im WKWebView | B: nativ |
|---|---|---|
| Laden bis Bild | 2,9–3,9 s (WebSocket offen nach 1,8–2,4 s, noVNC-Seite lädt aus der Sandbox) | Handshake 0,5–0,8 s, Verbindung bis Bild 0,8–1,3 s (ein Lauf 2,0 s) |
| Eingabe bis Antwort des Servers | Klick 61–153 ms, Taste 52–68 ms (Skript im Seitenkontext) | Zeiger bis Bild 56–131 ms (Median 80–118), Rechtsklick bis Bild 81–106 ms |
| RFB-Rundlauf 1×1 | – | Median 50–105 ms, ein Ausreißer-Lauf 501 ms |
| Vollbild | noVNC-Sitzung gesamt 78 KB (Tight/ZRLE) | Raw 3,15 MB · Hextile 510 KB (284 ms) · Zlib 134 KB · **ZRLE 105 KB (141 ms)** |

Latenz unterscheidet A und B nicht (beides Netz plus Server).

### Was belegt ist, was nicht
- **A belegt:** Seite lädt, noVNC verbindet verschlüsselt, Bild kommt, Skalierung beim Laden (1024×768 auf 1067×800 im 1280×800-Fenster, Seitenverhältnis bleibt), Rechtsklick öffnet das Desktop-Menü, Escape schließt es ([Bild](screens/mac3c-a-webview-menue.png)), das noVNC-Panel sendet ClientCutText.
- **A nicht belegt:** Das unsichtbare Fenster (alpha 0) gilt für WebKit als `hidden`. Echte NSEvents erreichten die Seite nicht (0 Tasten-, 0–1 Zeigernachrichten), die Eingabe ist nur als DOM-Ereignis belegt. Skalierung beim Verkleinern, Retina-Schärfe, Zwischenablage mit dem macOS-Pasteboard: nicht geprüft. Wer die Eingabe von Hand prüfen will: Commit `7129c36` bauen und `Orbit --daytona-spike` starten.
- **B belegt:** Handshake, Hextile gegen Raw pixelgleich (0,00 % Abweichung), Rechtsklick öffnet das Menü ([Bild](screens/mac3c-b-vnc-menue.png), 7,1 % der Pixel geändert), Escape schließt es, ä ö ü ß € als Keysyms landen korrekt im Suchfeld des Appfinders ([Bild](screens/mac3c-b-vnc-tastatur.png)), ClientCutText wird angenommen. Server meldet Cursor und PointerPos; ob ein lokaler Zeiger das Neuzeichnen spart, ist nicht gemessen (nach einer Mausbewegung kam weiter Hextile).
- **Offen für beide:** Zwischenablage Server→Client nicht geprüft (in der Sandbox gibt es kein `xclip`, nichts installiert). Tight und ZRLE sind nicht dekodiert (ZRLE nur die Größe gemessen).

### Vergleich
| | A (WKWebView) | B (nativ) |
|---|---|---|
| Aufwand | gering, ca. 40 Zeilen, aber noVNC-Oberfläche verstecken | Spike: 660 Zeilen Swift (RFB-Kern 377). Schritt 4 braucht geschätzt 700–1000 Zeilen (Schätzung, nicht gemessen) |
| Eingabequalität | Browser übersetzt Tasten, Cmd-Kürzel und Eingabemethoden bleiben unter Webkontrolle | Keysyms belegt (Umlaute, Euro); Cmd/Option-Belegung und Totasten muss die App selbst festlegen |
| Zwischenablage | Panel-Weg, Pasteboard-Brücke nötig | Pasteboard-Brücke nötig; beide nur Latin-1 |
| Wartung | noVNC liegt in der Sandbox, Version nicht in unserer Hand | eigener Code, Protokoll ist stabil und klein |
| Risiko | Regelbruch „kein WebView“; WebKit-Zustand `hidden` verfälscht Tests | Tastaturbelegung, Bandbreite ohne ZRLE, zlib-Strom über Rechtecke hinweg (ungeprüft) |

### Was Schritt 4 (Desktop-Block) bauen muss
1. **Sitzung** (`@Observable`): URL über `ServiceClient.desktopURL` (Aufruf dauert bei gestoppter Sandbox, Zeitlimit 240 s), WebSocket `wss://…/websockify` mit Unterprotokoll `binary`. Zustände: kein Computer, startet, verbindet, verbunden, getrennt mit „Erneut versuchen“, Dienst offline. Die URL gilt 1 h: bei Abbruch neue holen (die Sandbox läuft dann schon), mit Wartezeit zwischen Versuchen. Kein Ping-Frame.
2. **RFB-Kern** aus `mac/Orbit/Spike/RFBConnection.swift` übernehmen und ausbauen: Update-Schleife (nach jedem Update neu anfragen, Bilder zusammenfassen), DesktopSize/ExtendedDesktopSize, Cursor-Pseudo-Kodierung, Lesen mit Zeitlimit statt Wächter.
3. **Kodierung:** zuerst Hextile + CopyRect + Raw (läuft). **ZRLE nur, wenn** eine Messung unter echter Last (Browser im Orbi-Desktop) mehr als etwa 1 MB/s Dauerdaten oder sichtbares Ruckeln zeigt. Der Selbsttest muss dafür die Bytes je Sekunde ausgeben. ZRLE bringt 4,8-fach weniger Daten als Hextile bei Vollbildern.
4. **Ansicht:** Layer-gestützte NSView, Seitenverhältnis erhalten, Rand im Theme, Zeigerposition zurückrechnen, Klicks, Ziehen, Scrollrad (Tasten 4/5 = Maske 8/16), Fokusanzeige. Tasten: `NSEvent` auf X11-Keysym abbilden (Unicode-Keysyms für Zeichen), Sondertasten per Tabelle, Modifier als eigene Tasten senden; Festlegung Cmd→Ctrl oder Super vor dem Bau mit Consti klären.
5. **Zwischenablage:** beim Fokus Pasteboard-Text als Latin-1 senden, `ServerCutText` ins Pasteboard schreiben; Zeichen außerhalb Latin-1 sichtbar melden statt still zu verlieren.
6. **Zustände nach CONVENTIONS** (leer, lädt, Fehler, offline) und ein `--selftest`-Weg (aus `VNCProbe`): Handshake, Bild, Eingabe, Bytes je Sekunde, unsichtbar, ohne Dock-Symbol.

### Stand 4e (26.10.2026): nativ gebaut und gegen die vorhandene Sandbox von Nepi gemessen

Code: `mac/Orbit/Desktop/` (`RFBProtocol` Dekoder ohne Netz, `RFBSession` Websocket, `DesktopSession` Zustände, `DesktopView` Ansicht und Eingabe). Test: `Orbit --selftest-desktop` (Datenkopie ohne Fake-Sandbox; nichts angelegt, nichts installiert), Unit-Tests `DesktopTests`.

- **Kodierungen:** ZRLE, Hextile, CopyRect, Raw; Pseudo: Cursor, DesktopSize, ExtendedDesktopSize, LastRect. **ZRLE ist drin, weil die Messung es verlangte:** unter Last (6 s Zeigerziehen über den Desktop) lieferte Hextile 3,5–4,9 MB/s (über der Schwelle 1 MB/s), ZRLE 0,4–0,7 MB/s bei gleicher Last (rund 7-fach weniger). Der zlib-Strom läuft über alle Rechtecke einer Verbindung (Compression-Framework, die zwei Kopfbytes entfallen). Der Server wählt ZRLE, wenn es zuerst gewünscht wird.
- **Kein Ping.** Lebenszeichen: alle 10 s eine 1×1-Bildanfrage (der Server antwortet sofort); 35 s ohne jede Antwort = „Der Computer antwortet nicht mehr“, 25 s im Handshake = „antwortet nicht“.
- **Verbinden:** 1,8–6,7 s bei laufender Sandbox (Adresse holen, Handshake, erstes Bild). Zustände in der Ansicht: „Verbindet …“, nach 2 s „Computer startet …“ (gestoppte Sandbox: der Dienst startet sie beim Abruf der Adresse, Zeitlimit 240 s; die Startdauer einer wirklich gestoppten Sandbox ist **nicht gemessen**, die Sandbox lief), Fehler mit „Erneut versuchen“, getrennt mit „Wiederverbinden“ (drei automatische Versuche nach 2/5/10 s, jeweils mit neuer Adresse), „Dieser Orbi hat keinen Computer.“, Dienst offline. Die Adresse steht in keinem Text und keiner Ausgabe.
- **Zwischenablage, beide Richtungen belegt, ohne xclip:** Mac → Sandbox: `ClientCutText` (Latin-1), danach Strg+V im Suchfeld des Appfinders ergibt exakt dasselbe Bild wie Tippen (0,00 % Abweichung). Sandbox → Mac: Strg+A, Strg+C im Feld, `ServerCutText` kommt innerhalb von 4 s an und landet in der Zwischenablage. x11vnc verwaltet beide Auswahlen selbst, **xclip ist dafür nicht nötig** (die frühere Sorge im Spike erledigt sich). Grenzen: nur Latin-1 (Zeichen darüber werden zu „?“ und stehen als Hinweis unter dem Bild), keine erweiterte Zwischenablage. Cmd+C/V/X/A/Z gehen als Strg-Kürzel hinüber; beim Fokus wird der Text des Macs automatisch vorgelegt. Falls je nötig: Setup-Vorschlag wäre `apt-get install xclip` im Sandbox-Image, **nichts davon wurde ausgeführt**.
- **Größe:** `SetDesktopSize` (Nachricht 251) wurde gesendet, der Server meldet ExtendedDesktopSize mit Ergebnis **1 = verboten**: der Desktop bleibt fest 1024×768 (Xvfb ohne RandR-Änderung durch x11vnc). Ein größerer Start oder eine Umstellung im Betrieb ist über das Protokoll nicht möglich. Ob `xrandr` in der Sandbox die Größe ändert, ist **nicht geprüft** (dafür bräuchte es Befehle in der Sandbox; Vorschlag: Xvfb-Start in der Sandbox-Vorlage auf 1600×1000 setzen, dann reicht Skalieren im Client). Die App skaliert das Bild mit Seitenverhältnis in die Fläche (Vollbild 95 % × 90 %).
- **Eingabe:** Maus (Klick, Ziehen, Rechtsklick, Mitteltaste, Rad als Taste 4/5), Tasten über das Eingabesystem von macOS (Umlaute, tote Tasten, Wahl-Kombinationen wie @ [ ] { } | ~ \ kommen als fertige Zeichen), Sondertasten und F-Tasten per Tabelle. **Festlegung (Vermutung, Consti kann ändern):** Befehl gilt als Strg, Wahl wird nie als Alt gesendet; Cmd+Q/W/M/H/,/B/K/Tab bleiben beim Mac. Alles Gedrückte wird beim Fokusverlust losgelassen. Esc im Vollbild geht an den Computer, nur das X schließt.
- **Nicht geprüft:** Tastenwiederholung beim Gedrückthalten, Eingabemethoden (IME) mit mehreren Schritten, lokale Zeigerform von Programmen mit eigenen Zeigern (Cursor-Pseudo-Kodierung ist verdrahtet, im Test nur der Standardzeiger).

## Einstellungen

| Methode, Pfad | Körper | Antwort |
|---|---|---|
| `GET /v1/settings` | – | `{ ok, settings: { theme: "light"|"dark"|"system", jevAuto: bool, jevHandoff: bool, baseInstructions: string|null } }` |
| `PUT /v1/settings/theme` | `{ "theme": "light"|"dark"|"system" }` | `{ ok: true }` |
| `PUT /v1/settings/jev` | `{ "auto"?: bool, "handoff"?: bool }` (mindestens eins) | `{ ok: true }` |
| `PUT /v1/settings/instructions` | `{ "instructions": string }` (≤ 8000 Zeichen; leer = Standard) | `{ ok: true }` |
| `GET /v1/settings/instructions/default` | – | `{ ok, text, limit }` (Standard-Anleitung, Grenze 8000) |
| `GET /v1/marketplace` | – | `{ ok, entries: [{ id, name, description, type: "mcp"\|"skill", source, risk: "read"\|"write", permissions, verified, url? (mcp), skillName?, skillDescription?, skillBody? (skill) }] }` (Katalog; installiert wird über `POST /v1/skills` bzw. `POST /v1/connectors`) |
| `GET /v1/settings/rules` | – | `{ ok, rules: [{ id, tool, botId: string|null, botName: string|null, mode: "allow"|"ask"|"deny" }] }` |
| `POST /v1/settings/rules` | `{ tool, botId?, mode }` | `{ ok: true }` |
| `DELETE /v1/settings/rules/:id` | – | `{ ok: true }` |

## Modelle

| Methode, Pfad | Körper | Antwort |
|---|---|---|
| `GET /v1/models` | – | `{ ok, modelsAvailable: bool, models: [{ id, label, description, provider: "anthropic"\|"openai"\|"google", efforts: ["low"\|"medium"\|"high"\|"xhigh"\|"max"] }] }`; nur Modelle, deren CLI gerade verfügbar ist (60 s Cache). Leer und `modelsAvailable: false` = keine CLI nutzbar. Gemini hat `efforts: []`. `"auto"` (Jev) gehört nicht in die Liste, es gilt immer. |

## Skills

| Methode, Pfad | Körper | Antwort |
|---|---|---|
| `GET /v1/skills` | – | `{ ok, skills: [{ id, name, description, body, createdAt, updatedAt }] }` |
| `GET /v1/skills/slash` | – | `{ ok, skills: [{ name, description, source: "orbit"|"brain" }], brainOffline: bool }` (Slash-Menü) |
| `GET /v1/skills/brain/:name` | – | `{ ok: true, body }` (Inhalt, höchstens 8000 Zeichen; nur mit erreichbarem Brain-Server) |
| `POST /v1/skills` | `{ name (kebab-case, 2–40), description (1–300), body (1–8000) }` | `{ ok: true, skill: { id, name, description, body } }` |
| `PUT /v1/skills/:id` | wie oben | `{ ok: true, skill }` |
| `DELETE /v1/skills/:id` | – | `{ ok: true }` |

## Konnektoren (MCP)

| Methode, Pfad | Körper | Antwort |
|---|---|---|
| `GET /v1/connectors` | – | `{ ok, connectors: [{ id, name, url, enabled, authHeader, hasAuth, oauth }] }` |
| `POST /v1/connectors` | `{ name (2–40), url (https, öffentlich), token?, header? }` | `{ ok: true, connector }` |
| `POST /v1/connectors/:id/test` | – | `{ ok: true, count, tools }` oder `{ ok:false, error }` (bei OAuth ohne Anmeldung verlangt der Fehlertext eine Anmeldung) |
| `PUT /v1/connectors/:id/enabled` | `{ "enabled": bool }` | `{ ok: true }` |
| `PUT /v1/connectors/enabled` | `{ "enabled": bool }` | `{ ok: true }` (alle) |
| `PUT /v1/connectors/:id/auth` | `{ token: string (leer = entfernen), header? }` | `{ ok: true }` |
| `POST /v1/connectors/:id/oauth` | – | `{ ok: true, authorized: true }` oder `{ ok: true, authorized: false, url }`: `url` im Browser öffnen |
| `DELETE /v1/connectors/:id/oauth` | – | `{ ok: true }` (abmelden) |
| `DELETE /v1/connectors/:id` | – | `{ ok: true }` |

### `GET /oauth/callback?code=…&state=…`
Rücksprung des OAuth-Anbieters (Redirect-URL: `http://127.0.0.1:<port>/oauth/callback`). Kein Token, aber Host/Origin-Prüfung; der `state` muss zu einem Konnektor gehören, der die Anmeldung gestartet hat, und wird nach Erfolg gelöscht. Antwort: kleine HTML-Seite (`200`), die per `postMessage({type:"orbit-connector-oauth", ok}, "http://localhost:3000")` an das öffnende Fenster meldet und bei Erfolg schließt. Native App: Die Seite im Systembrowser anzeigen lassen und danach `GET /v1/connectors` + `POST …/test` aufrufen.

## Suche, Nutzung, Jev

| Methode, Pfad | Antwort |
|---|---|
| `GET /v1/search?q=<1–200 Zeichen>` | `{ ok, results: [{ chatId, chatName, avatar, color, role, messageId, snippet, createdAt, rank }], indexing: bool }`; `messageId` = Nachricht im Chat (4e, für „Chat an der Stelle öffnen“; `snippet` markiert Treffer als `<<Wort>>`); höchstens 30 Suchen/Minute (`"Zu viele Suchen. Bitte warte eine Minute."`) |
| `GET /v1/usage?fresh=1` | `{ ok, providers: [{ provider: claude|codex|antigravity, status: ok|limit|offline|error, note?, accounts: [{ id, label, status, note?, windows: [{ name: "5h"|"7d", used: 0…1, resetAt (ms) }] }] }], fetchedAt (ms) }`; `fresh=1` umgeht den Cache |
| `GET /v1/jev` | `{ ok, entries: [{ id, userId, chatId, kind, model, reason, durationMs, payload, createdAt }] }` (letzte 50 Einträge des Jev-Protokolls) |

Claude nutzt die lokale CLI-Anzeige `/usage` (ein aktives Konto, bei unlesbarem Format Fehler statt geschätzter Werte), Codex den lokalen CLI-App-Server. Antigravity meldet seine Nutzung derzeit nicht über die CLI; der Endpunkt gibt dafür `error` ohne erfundene Werte zurück. Die Claude-Werte werden für eine Minute im Speicher zwischengespeichert.

## Phase 3: Antwortgefühl (Lauf A)

**Teile in der Assistant-Nachricht** (eine UIMessage pro Turn bleibt):
- `tool-say` (`input: { text }`, `output: { ok, at }`): Zwischennachricht an Consti, in der UI eine eigene Blase (nicht als Werkzeugkarte). Max. 300 Zeichen, 5 je Turn. Wird nach jedem Schritt (`finish-step`) in die Datenbank geschrieben (`upsertMessage`, nur abgeschlossene Teile), überlebt also einen orbitd-Neustart.
- `tool-react` (`input: { emoji, message_id? }`, `output: { ok }`): nur Datenteil, nie als Karte oder Text zeigen; eine Nachricht, die nur daraus besteht, ist eine gültige Antwort (keine leere Zeile zeigen). Die Pille kommt aus `reactions`.
- `tool-share_file` mit Id `auto-<uuid>`: automatische Dateikarte (gleiche Form wie `share_file`: `output { filename, mediaType, size, data (Base64) }`). Entsteht nach `create_file`/`write_file` im Ausgabeordner und `brain_write` (nur `create`), eine je Datei und Turn; keine für Code-Dateien. Die App zeigt `share_file` schon als Karte.
- `tool-onboarding_finish`, `tool-onboarding_create_orbis`, `tool-ask_user`: wie bisher bzw. nur im Onboarding; kein Label. Werkzeugteile (außer Karten) zeigt die App seit der Korrektur nicht mehr; Fehler siehe Hinweis-Event `notice`.

**Ereignisse** (`GET /v1/events`):
- `{ type:"status-step", chatId, botId, toolCallId, tool, label, state:"start"|"end", step, at }`: Statusleiste. `label` kommt aus `lib/chat/step-labels.ts` (z. B. „Sucht im Web …“), nie vom Modell. Kein Ereignis für `say`, `react`, `ask_user`, `onboarding_finish`. Das `snapshot` enthält zusätzlich `steps: [status-step …]` (laufender Schritt je Chat). „N Schritte · X s“ selbst aus den Teilen und `metadata.startedAt/finishedAt` bilden.
- `{ type:"reaction", chatId, messageId, actor, emoji | null }`: Reaktion gesetzt (`null` = entfernt). `actor` = `"user"` oder Orbi-ID. Verlauf/Reaktionen danach neu laden.
- `{ type:"onboarding", botId, done:true, instructions: bool }`: Onboarding fertig oder übersprungen (`instructions` = Anweisung wurde ergänzt, Orbis neu laden).

**Reaktionen** (Tabelle `message_reactions`, Primärschlüssel chat+Nachricht+Absender: je Absender eine Reaktion, neue ersetzt alte; Leeren des Chats löscht sie):
| Methode, Pfad | Körper | Antwort |
|---|---|---|
| `GET /v1/chats/:id/reactions` | – | `{ reactions: [{ messageId, actor, emoji, createdAt }] }` |
| `GET /v1/chats/:id/messages` | – | wie bisher plus `reactions` (gleiche Form) |
| `PUT /v1/chats/:id/messages/:messageId/reaction` | `{ emoji }` aus 👍 ✅ 😂 ❤️ 👎 🤔 | `{ ok:true, answered: bool }`; 👍/👎 auf die gerade laufende Antwort mit offener Auswahlkarte beantwortet die Karte (nur bei genau einer Frage; 👍 = „Ja“ bzw. die Empfehlung, 👎 = „Nein“), `answered:true` |
| `DELETE /v1/chats/:id/messages/:messageId/reaction` | – | `{ ok:true, removed: bool }` |
Sonst sieht der Orbi Constis neue Reaktionen beim nächsten Turn als Zeile im Kontext (weckt nicht). Fehler: 400 ungültiges Emoji, 404 Chat/Nachricht unbekannt.

**Antwortlänge (Phase 3 Korrektur):** keine Einstellung mehr. `PUT /v1/settings/reply-length` gibt es nicht (404), `GET /v1/settings` liefert kein `replyLength`. Der Prompt enthält fest die Kurz-Zeile; die Spalte `user_settings.reply_length` bleibt in der Datenbank und wird ignoriert.

**Hinweis-Event (Wiederholung / Handlungsbedarf, Phase 3 Korrektur):** `{ type:"notice", chatId, botId, kind:"retry"|"action", text, at }` (`at` = Unix-ms). Der Dienst erzeugt es, wenn ein Werkzeug scheitert (Fehler oder Ergebnis mit `error`); die Werkzeuge selbst zeigt die App nicht. `retry`: der Orbi versucht es erneut, `text` = „Versuche es erneut …“. `action`: Consti muss etwas tun, `text` z. B. „Bitte verbinde Notion neu.“ / „Bitte erlaube den Zugriff.“. Texte fertig formuliert, kurz, ohne Technikbegriffe, nie Roh-Fehler: 1:1 als graue Systemzeile zeigen, nur während der Arbeit, kein Verlauf, nicht im `snapshot`. Höchstens 3 je Turn, derselbe Text nie zweimal hintereinander. Kein Hinweis für `ask_user`, `say`, `react`, `confirm_action`, Onboarding-Werkzeuge und abgelehnte Freigaben.

**Onboarding (neu gefasst):** `GET /v1/bots` → jeder Orbi hat `onboardingDone` (bestehende `true`, neu angelegte `false`). Start unverändert: Chat öffnen, `POST /v1/chats/:id/turn` mit `{ messages: [], clientData: { model, botId, onboarding: true } }` (leere `messages` nur dafür, nur bei leerem Chat). Das Onboarding läuft über mehrere Turns (Antwort auf eine Auswahlkarte setzt den Turn fort), ohne dass die App `onboarding` erneut senden muss: es gilt, solange Consti noch keine eigene Nachricht im Chat hat. Schreibt Consti eine normale Nachricht oder ruft die App `POST /v1/bots/:id/onboarding` mit `{ "action":"skip" }` → `{ ok:true }`, ist es übersprungen und endet für immer. Kein Onboarding in Gruppen, Übergaben, Automationen.
- **Hauptorbi:** ein Satz Vorstellung, `ask_user` mit 1–2 Fragen zu Consti und seinen Zielen, danach eine zweite `ask_user`-Karte mit 2 Mehrfachfragen: „Welche Orbis soll ich anlegen?“ (2–3 Vorschläge, Titel = Name, Beschreibung = Aufgabe) und „Welche Dienste sollen später dazu?“ (nur Namen aus dem Marktplatz-Katalog `connectors/catalog.json` plus „Keine“; der Text sagt, dass das Verbinden später folgt, es wird nichts verbunden). Nach Constis Auswahl legt das Werkzeug `onboarding_create_orbis` die gewählten Orbis direkt an (höchstens 3, Namen müssen unter den Antworten stehen, Avatar frei gewählt aus den Mac-Figuren, Farbe aus der Eingabe oder Standard, kein Hauptorbi). Dann `onboarding_finish` (Regeln an die Anweisung) und eine Abschlussnachricht „So geht's weiter: …“.
- **Jeder andere Orbi:** ein Satz Vorstellung passend zu Name und Aufgabe, `ask_user` mit 1–2 Startfragen, `onboarding_finish`, Zusammenfassung „So arbeite ich ab jetzt: …“ und, wenn sinnvoll, ein Vorschlag für die erste Aufgabe als Frage.
- Neue Teile: `tool-onboarding_create_orbis` (`input: { orbis:[{name,job,color?}] }`, `output: { ok, created:[Namen] }` oder `{ ok:false, error }`), wie `tool-onboarding_finish` unsichtbar (kein Label).
- Neues Ereignis `{ type:"orbis-created", bots:[{ botId, chatId, name }] }`: Orbis neu laden (`GET /v1/bots`). Die angelegten Orbis haben `onboardingDone:false`; ihr eigenes Onboarding startet die App wie gehabt (Turn mit `onboarding:true`), am besten beim ersten Öffnen ihres Chats, nicht sofort für alle drei.

## Phase 4, Lauf G: Kontext (Dienst-intern)
Keine neuen Endpunkte oder Ereignisse. Neu im Modellkontext: Werkzeug `chat_recall` (`query` | `id`, `offset`; nur eigener Chat), Nachricht `<orbit_context>` vor der letzten Nutzer-Nachricht (Datum, Team, Gedächtnis, Hinweise), `<earlier_history>` am Anfang des Verlaufs (Zusammenfassung oder Hinweis auf ausgelassene Nachrichten). Statuslabel für `chat_recall`: „Sucht im Verlauf …“. Tabellen `chat_summaries`, `tool_outputs`, erweiterte `turn_usage` (Migration `0007_phase4_g`, Sicherung `orbit.sqlite.vor-migration-<ms>.bak` neben der DB). Umgebung: `ORBIT_CACHE=0` schaltet Cache-Marker aus, `ORBIT_PRICES_PATH` ersetzt `lib/usage/prices.json`, `ORBIT_PROXY_ORIGIN` ersetzt den Proxy-Ursprung (Tests). *Hinweis: Der Proxy fällt ganz weg (E59); die Variable verschwindet mit Umbau-Schritt 15.*

## Phase 4, Lauf H: Gedächtnis, Kurzprofil, Brain, Skills
**Neue Endpunkte** (Tabelle „Orbis (Bots)“): `GET /v1/bots/:id/memory`, `GET /v1/bots/:id/memory/:name`, `DELETE /v1/bots/:id/memory/:name`. `MemoryEntry = { name, type: "user"|"feedback"|"project"|"reference", description (≤150), body (≤1200), stated: bool (Consti hat es selbst gesagt), origin: "consti"|"self"|"external"|"migration", source, version, createdAt, updatedAt }` (Zeiten in Millisekunden). Anlegen und Ändern machen nur die Orbis (Werkzeug `memory_save`); die App darf lesen und löschen. Keine neuen Ereignisse (die App lädt beim Öffnen der Ansicht).

**Gedächtnis lokal:** Tabellen `orbi_memory`, `orbi_memory_log` (Änderungslog: create, update, replace, forget, migrate), `orbi_memory_meta` (Migration, Migration `0008_phase4_h`, Sicherung wie in Lauf G). Pro Orbi höchstens 40 Einträge und 24 000 Zeichen. Das alte `MEMORY.md` der Sandbox wird beim ersten Turn des Orbis einmal gelesen und in Einträge übernommen (`origin: "migration"`, `stated: false`); die Datei bleibt unverändert, scheitert das Lesen, versucht es der nächste Turn erneut. Werkzeuge `memory_get`, `memory_save`, `memory_forget` ersetzen `memory_get`/`memory_append`/`memory_set` (Gruppenchat: nur `memory_get`). Statuslabels: „Liest das Gedächtnis …“, „Merkt sich etwas …“, „Räumt das Gedächtnis auf …“.

**Modellkontext:** Gedächtnis-Index (≤1500 Zeichen) in `<orbit_context>`; Kurzprofil (≤300 Wörter aus `00 Kontext/Profil/Kurzprofil.md`, sonst `Über mich.md`), Brain-Leitfaden und Skill-Katalog im stabilen System-Prompt. Neue Werkzeuge `read_skill` und `save_skill` (nur 1:1), `brain_skills_list`/`brain_skill_read` entfallen.

**Brain ohne Server:** Beim Start schaltet orbitd den Vault direkt ein (`ORBIT_BRAIN_PATH`, sonst `~/.second-brain`, sonst `~/Projekte-Coding/Second Brain`; Ordner mit `Start.md`; `ORBIT_BRAIN=off` schaltet ab). Gleicher Code und gleiche Schreibregeln wie `brain-server`; `BRAIN_SERVER_URL`/`TOKEN` bleiben als Ersatz, wenn kein lokaler Vault da ist. Das Slash-Menü (`/v1/skills/slash`) nutzt denselben Weg. Eigene Skills der Orbis liegen als Dateien unter `<Datenordner>/orbis/<botId>/skills/<name>/SKILL.md`.

## Phase 4, Lauf I: Jev-Stufung, think_deep, Träumer
> *Hinweis 03.11.2026: `think_deep` entfällt, schwere Teilaufgaben stufen auf ein größeres Modell hoch (E37, Umbau-Schritt 13). Jev ist raus (D12, Umbau-Schritt 14). Der Proxy fällt ganz weg (E59, Umbau-Schritt 15). Der Abschnitt beschreibt den Code bis dahin.*

**Neue Endpunkte** (Tabelle „Orbis (Bots)“): `GET` und `PUT /v1/bots/:id/dreamer` (Träumer ansehen, ein-/ausschalten). Keine neuen Ereignisse: der Träumer ist still (kein Chat, keine Nachricht, kein `automation`-Ereignis); die App lädt beim Öffnen der Ansicht.

**Jev: Start klein, nur nach oben** (Modell `auto`): Der Dienst merkt je Gespräch und Orbi das zuletzt gewählte Modell samt Stufe und Denkstufe (`chat_model_state`). Neues Gespräch: Jev wählt im Zweifel die kleinere Stufe (bei Unsicherheit `small`). Danach darf Jev nur noch HÖHER stufen (small < medium < large, `coding` gilt wie large; Hochstufung nur ab Sicherheit 0,75), nie zurück, solange der Cache warm ist (letzter Turn jünger als 5 Minuten). Nach längerer Pause wird frei neu gewählt (`reset`). Fällt Jev aus, bleibt das gemerkte Modell, ohne Vorgeschichte gilt Sonnet (`fallback`), und ein Ausfall setzt nie eine Untergrenze. Ein gewähltes Modell (nicht `auto`, auch `modelPinned`) berührt das Gedächtnis nie. Die App sieht es in `metadata.jev` (`change`, `from`, `reason`); `turn_usage` hat dafür `tier` und `tier_change` (`start|keep|upgrade|reset|pinned|fallback`).

**Werkzeug `upgrade_model`** (`kind: large|coding`): Bei automatischer Modellwahl kann eine schwere Teilaufgabe den laufenden Turn auf Opus oder Sol hochstufen; der Kontext bleibt erhalten. Eine feste Modellwahl hat Vorrang. Ist kein stärkeres Modell verfügbar, arbeitet das bisherige Modell weiter. Verbrauch wird je Modellschritt gespeichert; zusätzliche Zeilen mit `turn_kind = "model_step"` zählen nicht als zusätzliche Antworten. Alte Helferergebnisse bleiben beim Fortsetzen gerahmt.

**Träumer:** Tabellen `orbi_dream` (Takt, Sperre, Hash), `orbi_dream_runs` (Protokoll je Lauf), Spalte `bots.dreamer_enabled` (Standard 1), Migration `0009_phase4_i` (Sicherung wie Lauf G). Täglich um 03:00 (Ortszeit) je Orbi über den Takt des Dienstes (alle 30 s; verpasste Läufe laufen nach dem Schlaf genau einmal): ein Haiku-Aufruf (bis Umbau-Schritt 15 über den Proxy, danach über die CLI, E59) liefert einen JSON-Plan (zusammenführen, Doppeltes/Veraltetes/Widersprüchliches entfernen, kürzen); der Code prüft jede Operation (nichts Erfundenes, Herkunft konservativ, Gesagtes bleibt) und schreibt in EINER Transaktion; Änderungen stehen mit Vorher-Stand in `orbi_memory_log` (`dream-*`). Kostendeckel 0,20 USD/Tag über alle Orbis (`ORBIT_DREAM_DAILY_USD`), höchstens 8 Operationen und höchstens die Hälfte der Einträge je Lauf. Er zählt nicht als Automation (kein 12er-Limit, keine Auto-Pause).

## Sonstiges

- `GET /v1/health` → `{ "ok": true }` (mit Token).
- Jev nach dem Turn läuft ohne eigenen Endpunkt: nach jedem fertigen Turn mit Modell `auto` (Jev-Auto an, kein Übergabe-Turn, Nutzertext vorhanden) fragt der Dienst Jev, ob die Nachricht etwas Merkenswertes enthält (Timeout 3 s, bei Fehler 3 Minuten Pause) und schreibt bei Sicherheit ≥ 65 % einen `jev_log`-Eintrag `kind: "memory"` (sichtbar in `GET /v1/jev`).
- Nicht im Dienst: Noten, Hausaufgaben, Brain-Dateien (Schulplaner-App und Brain-Server bleiben getrennt).

## Plugin-Store und iCloud-Kalender (Arbeitsstand 02.11.2026)

Alle Endpunkte benötigen wie oben den lokalen Dienst-Token. Nur mit Attrappen geprüft; kein echter Provider oder Schlüsselbund bestätigt.

| Endpunkt | Eingabe | Ergebnis |
|---|---|---|
| `POST /v1/plugins/verify` | `{key,user}` | Prüft den Composio-Projektzugang; keine Geheimnisse in Antwort oder Logs. |
| `POST /v1/plugins/reload` | – | Verwirft den kurzlebigen Zugangscache nach Änderung im Schlüsselbund. |
| `GET /v1/plugins` | `search`, `category`, `connected`, `cursor`, `limit` | `{ok,configured,entries,nextCursor,totalItems}`. Ein aktives Konto beweist noch keine nutzbaren Werkzeuge (`toolsStatus: not_checked`). |
| `POST /v1/plugins/:slug/connect` | – | Startet Managed OAuth, liefert sicheren Connect Link oder Status; Erfolg erst nach Anbieteranmeldung. |
| `GET /v1/plugins/:slug/setup` | – | Öffentliche Felddefinitionen für eigene Konfigurationen; ohne Secret-Werte oder Defaults. |
| `POST /v1/plugins/:slug/setup` | `{scheme,fields}` | Erstellt eine individuelle Auth-Konfiguration und einen Connect Link; erforderliche App-Geheimnisse werden an Composio übermittelt. Kontogeheimnisse bleiben im gehosteten Formular. |
| `GET /v1/plugins/:slug/accounts` | – | Eigene Composio-Konten dieses Dienstes für die Auswahl. |
| `DELETE /v1/plugins/:slug/accounts` | `{accountIds,confirmed:true}` | Trennt ausgewählte eigene Verbindungen bei Composio; meldet Teilfehler und nötigen separaten Anbieterwiderruf. |
| `GET /v1/plugins/:slug/status` | – | Kontostatus, ohne Behauptung über tatsächlich funktionierende Aktionen. |
| `POST /v1/icloud/verify` | `{appleId,appPassword}` | Prüft CalDAV-Discovery und liefert nur `{ok,count}`; Zugangsdaten ausschließlich auf lokalem authentifiziertem Transport, nicht loggen. |

Composio-Projektzugang und Apple-Zugang: native App speichert sie im Schlüsselbund; der Dienst liest sie bei Bedarf über macOS. Zugriff durch den Hintergrunddienst und echte iCloud-Verbindung sind nicht live geprüft. Die Gateway-Werkzeuge suchen Aktionen seitenweise und prüfen vor Ausführung das konkrete Konto, Schema und Orbits Freigaberegeln. `readOnlyHint` bleibt wie bei vorhandenen MCP-Konnektoren eine vom Anbieter gelieferte Aussage; fehlerhafte Metadaten können Risiken falsch einstufen. Unbekannte Auth-Schemas/Feldtypen werden als nicht unterstützt gemeldet; nicht jedes Plugin ist deshalb garantiert verbindbar. Individuelle Composio-Auth-Konfigurationen können bei erneuter Einrichtung nach Dienstneustart doppelt entstehen.

Dienste ohne Anmeldung sind derzeit nicht unterstützt; Composio dokumentiert für sie einen separaten verbindungslosen Ablauf.

## Phase 5 (02.11.2026): dauerhafte Jobs, Status, Einrichtung, Budget, Heartbeat

Migration `0010_phase5` (Sicherung vor der Migration legt der Dienst selbst an). Alle Antworten ohne Schlüsselwerte.

| Endpunkt | Körper | Antwort / Verhalten |
|---|---|---|
| `GET /v1/chats/:id/messages` | – | Neu: `interrupted: { runId, at, startedAt, steps } \| null`. Gesetzt, wenn ein Turn (oder eine Übergabe, die von diesem Chat ausging) beim Neustart von orbitd unterbrochen wurde und im Chat seither nichts Neueres lief. Fehlt bei älteren Diensten. |
| `POST /v1/chats/:id/resume` | `{ runId, dismiss? }` | „Weiter“: startet den Turn mit der letzten Nachricht von Consti neu (wie „Antwort wiederholen“, Modell, Stufe, Orbi und Auftragszähler des unterbrochenen Turns). Antwort `{ok:true}` (JSON, kein Strom): danach `GET /v1/chats/:id/stream`. `dismiss:true` verwirft nur den Hinweis. `404` unbekannt, `409` nicht unterbrochen oder Chat belegt, `503` ohne Fortsetzen. |
| `GET /v1/status` | – | `{ chats: [{chatId, working, needsYou, isNew, interrupted}], needsYou, interrupted: [{chatId, runId, at}] }`. Nur Chats mit mindestens einem Zustand. Quelle für die blauen Punkte der Seitenleiste nach einem Neustart und die Zahl in der Menüleiste. |
| `POST /v1/chats/:id/seen` | – | Merkt „gesehen“ (Seitenleiste: kein „neu“). Eine Nachricht von Consti setzt es selbst. |
| `GET /v1/health` | `?checks=1` | Ohne Parameter wie bisher `{ok:true}`. Mit: `{ ok, checks: [...] }`. |
| `GET /v1/health/checks` | – | `{ ok, checks: [{ id: claude\|codex\|gemini\|agy\|daytona\|jev\|brain\|plugins, label, state: ok\|fehlt\|fehler, fix?, key?, optional? }] }`. `fix` beschreibt die Abhilfe, `key` nennt nur den Schlüssel-Namen. Claude und Codex prüfen das Programm und den jeweiligen Anmeldestatus; Gemini meldet eine vorhandene, ungeprüfte Anmeldung als Fehler. Antigravity prüft Programm und Modellliste ohne Modellaufruf; `ok` setzt zusätzlich einen erfolgreichen Orbit-Modelllauf innerhalb der letzten fünf Minuten voraus. Claude ist Pflicht, die anderen CLIs sind optional. Es gibt keinen CLI-Proxy-Health-Check mehr. Die Mac-App prüft die Mitteilungs-Erlaubnis selbst. Externe Dienstprüfungen haben standardmäßig 4 s, die gemeinsame CLI-Prüfung 8 s Zeit. |
| `GET /v1/keys` | – | `{ keys: [{ name, label, set, source: schluesselbund\|datei\|null, liveReload }] }`. Nie ein Wert. |
| `POST /v1/keys/reload` | `{ names? }` | Liest die genannten Schlüssel (Standard: alle drei) neu aus dem Schlüsselbund (Dienst `de.consti.orbit2`, Konto = Name der Umgebungsvariablen). Die App schreibt sie vorher mit SecItem. Antwort wie `GET /v1/keys` plus `needsRestart: [name]` (`CLI_PROXY_API_KEY` ist nicht mehr verwaltet, `needsRestart` bleibt leer). `secrets.env` bleibt Rückfall. |
| `GET /v1/budget` | – | `{ budget: {jevDailyUsd, maxSandboxes}, jev: {spentUsd, state: ok\|hinweis\|aus, percent}, sandboxes: {active, max, waiting}, tokens: [{botId, turns, inputTokens, outputTokens, totalTokens}] }`. 80 % = `hinweis`, 100 % = `aus` (Jev fragt nicht mehr an, „auto“ nimmt das Standardmodell). Tokens heute aus `turn_usage`, ohne Modellaufruf. |
| `PUT /v1/budget` | `{ jevDailyUsd?: 0–50, maxSandboxes?: 1–10 }` | Setzt das Tagesbudget (Standard 0,50 $ und 3 Sandboxes); Antwort wie `GET`. |
| `GET/PUT /v1/bots/:id/heartbeat` | `{ enabled }` | `{ ok, enabled, everyMinutes: 30, window: {from, to}, lastRunAt, lastMessageDay }`. Standard aus. Meldet sich höchstens einmal am Tag mit einer leisen Nachricht im Chat des Orbis; das Ereignis `status: fertig` lässt die App neu laden. |
| `PUT /v1/bots/:id/memory/:name` | `{ description, body, ifVersion }` | Consti ändert einen Eintrag (gilt als von ihm gesagt, Version +1, Protokoll `edit`). Fehler deutsch: veraltete Version, Zugangsdaten, Länge. |
| `GET /v1/bots/:id/memory-trash` | – | `{ entries: [...] }` gelöschte Einträge (Stand beim Löschen; nur Vergessen, nicht Träumer oder `replaces`), neueste zuerst, je Name der jüngste, höchstens 30. |
| `POST /v1/bots/:id/memory/:name/restore` | – | Holt den jüngsten gelöschten Stand zurück (Version +1); scheitert bei belegtem Namen oder vollem Gedächtnis. |

Freigaben: `GET /v1/approvals` und der Snapshot enthalten nach einem Neustart auch wiederhergestellte Karten mit `restored: true` (der Turn dazu ist weg). Antworten wirkt so: „Immer“ speichert die Regel, „Einmal“ und Antworten auf Rückfragen gelten genau einmal für die gleiche Anfrage (Chat, Werkzeug, Eingabe) im fortgesetzten Turn, Ablehnen räumt die Karte ab. Karten laufen nach 24 Stunden ab.

Unverändert: Prompt und Werkzeugdefinitionen (Zeichenmaß wie Lauf I), `schedule.ts` kennt zusätzlich die Intervall-Art `every` (nur für Dienstaufgaben, nicht in `scheduleSchema` der Nutzer-Automationen).

**Werkzeug `web_search` (CLI-Umstellung, 02.11.2026):** Form unverändert (`{ query }` → `{ answer, sources: [{title,url}] }` bzw. `{ error }`, höchstens 3 je Turn). Läuft jetzt über `claude -p` mit Haiku und nur dem eingebauten Werkzeug WebSearch (`--tools WebSearch --allowedTools WebSearch`), neutraler Ordner, ohne Einstellungen, Hooks, MCP, Skills, Gedächtnis (`lib/cli/search.ts`, `lib/search/web.ts`). Quellen kommen aus den Treffern des Werkzeugs (zitierte zuerst, höchstens 8, nur http/https). Fehlt die CLI oder ist sie nicht angemeldet: „Die Websuche braucht Claude.“ plus Abhilfe-Satz; der Proxy wird nicht mehr benutzt.

## Strukturierte Chatkarten (Endphase, 02.11.2026)

`GET /v1/chats/:id/messages` liefert zusätzlich in `metadata`:

- `createdAt?: number`: Zeitpunkt der Nachricht in Millisekunden seit Unix-Epoch. Bestehende Zeitpunkte bleiben beim Speichern und bei Regeneration erhalten.
- `automation?: { automationId, runId, name, status, startedAt, finishedAt? }`: Routine und Lauf, mit `status` als `running`, `waiting`, `ok` oder `error`; Zeiten ebenfalls Millisekunden. Statuswechsel schreiben die Laufkarte und den Laufdatensatz in einer Transaktion. Der Endstatus bleibt beim Entfernen alter Laufdatensätze erhalten. Kein neues Datenbankschema. Ältere Nachrichten mit `[[automation:Name]]` bleiben lesbar.

Die App zeigt daraus eine Statuszeile; das Ergebnis bleibt eine normale Nachricht. Erneutes Ausführen verwendet weiterhin `POST /v1/automations/:id/run`. Fehler im Turn-Strom behalten das vorhandene strukturierte `type: "error"` / `errorText`; die App zeigt eine kurze Fehlerzeile mit „Erneut versuchen“. Unterbrochene Arbeit verwendet weiterhin `interrupted` und den bestehenden Resume-Endpunkt. Technische Werkzeugdetails werden im Chat nicht dargestellt.


## Apple Erinnerungen (Umbau 03.11.2026)

Die Werkzeuge `apple_reminders_list` und `apple_reminders_create` senden einen lokalen Auftrag an die laufende Mac-App. Die App fragt die macOS-Erlaubnis bei Bedarf ab und nutzt EventKit; ohne laufende App endet der Auftrag mit einem Hinweis. Eine Liste enthält höchstens 100 Einträge und meldet, falls sie gekürzt wurde. Gelesene Inhalte werden für das Modell als Fremddaten gerahmt.

Der Dienst benachrichtigt die App über `reminders-pending`. Die App holt einen Auftrag über `POST /v1/reminders/claim`, prüft mit `GET /v1/reminders/:id/active`, ob er noch läuft, und meldet mit `POST /v1/reminders/:id/complete` das Ergebnis. Alle Endpunkte benötigen das Diensttoken. Abbruch oder Timeout widerrufen den Auftrag und senden `reminders-cancelled`; nach Übernahme wird er nie automatisch erneut ausgeführt. Bleibt das Ergebnis unbestätigt, soll vor einem erneuten Versuch die Erinnerungen-App geprüft werden. Ein Abbruch kann eine gerade laufende EventKit-Speicherung nicht mehr zurücknehmen.

Die Implementierung wurde mit Attrappen geprüft; echter Zugriff und die Berechtigungsabfrage gehören zur gemeinsamen Live-Prüfung.
