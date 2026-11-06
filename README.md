# Orbit

Native Mac-App (SwiftUI, `mac/`) mit lokalem Node-Dienst `orbitd` (`service/`, Port 4317). Die frühere Web-Version ist am Tag `web-final` erreichbar und liegt archiviert unter `~/Documents/Projekte-Coding/Archiv/`.

## Bauen und installieren

- `scripts/install.sh`: baut `Orbit.app` samt Dienst, installiert nach `/Applications`, richtet den LaunchAgent `de.consti.orbit2.service` ein.
- `scripts/install.sh --aus-env-local`: übernimmt die Schlüssel aus `.env.local` in `~/Library/Application Support/Orbit/secrets.env` (selbst ausführen).
- `npm run check`: Typecheck und Tests. `npm run service`: Dienst im Entwicklungsmodus.

## Lokale Datenbank

SQLite unter `~/Library/Application Support/Orbit/orbit.sqlite` (`ORBIT_DATA_DIR` überschreibt). Schema `lib/db/schema.ts`, Migrationen `drizzle/sqlite/` (`npx drizzle-kit generate`). Nur der Dienst fasst die Datenbank an.

## Einmaliger Neon-Export (nur manuell)

`scripts/export-from-neon.ts` wurde vorbereitet, nicht automatisch ausgeführt.
Der Neon-Treiber ist ausschließlich eine Entwicklungsabhängigkeit für dieses Skript.
Remote laufen nur SELECTs in einer schreibgeschützten Transaktion.

1. Quelle in einer nicht versionierten Env-Datei hinterlegen: `NEON_EXPORT_DATABASE_URL`, `NEON_EXPORT_USER_ID`.
2. Dieselbe `CONNECTOR_SECRET` für verschlüsselte Konnektoren behalten; das Skript gibt keine Schlüssel oder Inhalte aus.
3. App und Worker beenden. Ziel muss leer sein; für einen Probelauf `ORBIT_DATA_DIR` auf einen neuen Ordner setzen.
4. Selbst ausführen: `node --env-file=<private-env-datei> scripts/export-from-neon.ts`.

Übernommen werden nur bots, user_settings, skills, mcp_connectors, bot_connectors, approval_rules und automations.
Besitzer wird `local`. Es entstehen neue leere Direktchats für die Orbis; alter Chat-Verlauf wird nicht gelesen.
Alte Automations-Chatverweise entfallen, Daytona-Sandbox-IDs und dortiges Gedächtnis bleiben erhalten.
Lokale Fehler rollen den gesamten Import zurück; vorhandene Daten werden nie überschrieben.
