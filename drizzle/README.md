# Datenbankmigrationen

Die Anwendung und der lokale Trigger-Worker verwenden ausschließlich SQLite.
Aktive Migrationen liegen in `drizzle/sqlite/` und werden beim Öffnen der Datenbank atomar angewendet.
Neue Schemaänderungen mit `npx drizzle-kit generate` erzeugen; eigene SQL-Migrationen (FTS5) im Journal registrieren.
`drizzle.config.ts` adressiert nur die lokale Datei aus `ORBIT_DATA_DIR` bzw. dem App-Support-Ordner.

Die SQL-Dateien und `meta/` direkt in diesem Ordner sind historische PostgreSQL-Vorlagen.
Sie werden weder geladen noch ausgeführt. Neon bleibt ausschließlich lesbare Quelle des manuellen Exportskripts.
