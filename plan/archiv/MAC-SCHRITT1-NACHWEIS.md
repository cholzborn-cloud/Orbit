# Nachweis: SQLite und lokale Identität

21.10.2026, Auftrag: Consti, Branch `mac-umbau`, Ausgangstag `web-final`.

- `npm run check`: bestanden, TypeScript, ESLint (0 Fehler, 31 bestehende Warnungen), Produktionsbuild, 190 Tests bestanden, kein Skip.
- SQLite-Integration: 14 Tabellen, Migrationen erneut öffnbar, WAL, Foreign Keys, lokale Nutzer-ID, Datum/Boolean/JSON, Teilindex, FTS5 Insert/Update/Cascade-Delete, Rollback, Import-Rollback und doppelter Automations-Claim geprüft.
- Das vollständige Gate verwendete `ORBIT_DATA_DIR` im ignorierten Prüfverzeichnis; persönliche Daten wurden dabei nicht verändert.
- App ohne Clerk-/Datenbank-/Neon-/AWS-Variablen: Produktionsserver nur auf `127.0.0.1:3100`; Startseite, Geplant und Status-API HTTP 200, entfernte Loginroute HTTP 404.
- 15 Cloud-Einträge aus `.env.local` entfernt. Ursprüngliche Env-Datei als ignorierte `.env.local.web-backup` gesichert, keine Werte ausgegeben.
- Zwei vorhandene ARIA-Warnungen im Dateibaum durch Angabe des Auswahlzustands behoben; Warnungsgrenze unverändert.
- Direkte PostgreSQL-Abfragen im lokalen Trigger-Worker syntaktisch portiert; Ablauf unverändert, atomare Claims und Chat-Anlage nach `lib/db/automations.ts` verschoben.
- `scripts/export-from-neon.ts`: nur vorbereitet. Remote ausschließlich SELECT in einer Read-only-Transaktion, sieben Tabellen, Quellnutzer explizit, lokaler Import atomar und nur in leere Zieltabellen. Neue leere Direktchats, kein alter Verlauf.
- Neon wurde nicht angesprochen; kein `db push`, kein Deploy, kein Remote eingerichtet. Nachbarordner nicht gelesen oder verändert.

## Noch nicht abgenommen

- Browserbedienung: kein Browser über die vorhandene UI-Verbindung verfügbar.
- Chat, Live-Suche aus Trigger-Verlauf und Automation mit echtem `trigger dev`: nicht ausgeführt.
- Echter Neon-Export: startet Consti selbst. Konnektor-Verschlüsselung benötigt weiterhin dieselbe `CONNECTOR_SECRET`.

Das technische Ziel dieses Auftrags ist belegt; die umfassende Browser-Abnahme aus `MAC-UMBAU.md` bleibt offen.
