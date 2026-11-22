# Vertragsaufnahmen des alten Dienstes

`golden/` enthält die Antworten des alten Node-Dienstes (`service/src/index.ts`) auf einer Datenbank-Kopie, je Aufruf eine Datei `{method, path, status, headers(nur content-type), body}`.

## Aufnahme
1. Kopie nur lesend: `sqlite3 "file:$HOME/Library/Application Support/Orbit/orbit.sqlite?mode=ro" "VACUUM INTO '/tmp/orbit-rec/orbit.sqlite'"`. In der Kopie wurden Automationen und Heartbeat abgeschaltet (`enabled=0`, `heartbeat_enabled=0`), damit nichts von allein läuft.
2. Dienst: `ORBIT_DATA_DIR=/tmp/orbit-rec ORBITD_PORT=4319 ORBIT_FAKE_SANDBOX=1 ORBIT_BRAIN=off ORBIT_PLUGIN_STORE_DISABLED=1 ORBIT_CLAUDE_BIN=/usr/bin/false ORBIT_CODEX_BIN=/usr/bin/false npm run service` (kein Brain, kein Composio, keine echten CLI-Aufrufe).
3. `orbitd/.venv/bin/python orbitd/tests/contract/record.py http://127.0.0.1:4319 /tmp/orbit-rec [Ausgabeordner]` (liest das Token aus `<Datenordner>/service.token`, speichert es nie). IDs für `:id`-Pfade werden aus den Listen-Antworten genommen.
4. Dienst beenden, `/tmp/orbit-rec` in den Papierkorb.

Dieselbe Datei gegen den neuen Dienst mit anderem Ausgabeordner laufen lassen und die Ordner vergleichen. Dynamische Felder (Zeitstempel, Laufzeiten) können abweichen.

## Anonymisierung
`record.py` macht jede Aufnahme über `anonymize.py` unkenntlich (Struktur, Schlüssel, Zahlen, IDs bleiben; Texte, Namen, E-Mail-Adressen, Pfade mit Nutzernamen, URL-Parameter, Token werden Platzhalter). `anonymize.py [Ordner]` bearbeitet vorhandene Aufnahmen an Ort und Stelle und ist wiederholbar. Öffentliche Kataloge (Marktplatz, Modelle, Nutzung) behalten ihre Texte.

## Nicht aufgenommen
- Alle POST/PUT/PATCH/DELETE außer 4 Fehlerfällen mit kaputtem JSON (400): verändern Daten oder lösen Modelle/Nachrichten aus.
- `GET /v1/chats/:id/stream` (SSE, endlos) und `GET /oauth/callback` (Browser-Rücksprung).
- `GET /v1/health/checks` (Netzwerk: Daytona, CLI-Prüfungen), `GET /v1/mac/access` (kann Mac-Freigaben anstoßen), `GET /v1/daytona/:id/desktop-url`, `GET /v1/plugins/:slug/*` (Composio), `GET /v1/skills/brain/:name` (Brain aus), `GET /v1/usage?fresh=1`.
- `GET /v1/events`: nur die ersten 3 Ereignisse (Snapshot zuerst), als Liste im `body`.
