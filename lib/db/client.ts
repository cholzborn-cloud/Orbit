import { mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"

import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { readMigrationFiles } from "drizzle-orm/migrator"

import { databasePath } from "./path.ts"
import * as schema from "./schema.ts"

export function openDatabase(filename = databasePath()) {
  mkdirSync(dirname(filename), { recursive: true, mode: 0o700 })
  const sqlite = new Database(filename)
  try {
    sqlite.pragma("busy_timeout = 5000")
    sqlite.pragma("journal_mode = WAL")
    sqlite.pragma("foreign_keys = ON")
    const db = drizzle(sqlite, { schema })
    const migrations = readMigrationFiles({
      migrationsFolder:
        process.env.ORBIT_MIGRATIONS_DIR ??
        resolve(process.cwd(), "drizzle/sqlite"),
    })
    // Vor jeder Migration einer bestehenden Datenbank eine Sicherung (VACUUM INTO, alte Sicherungen bleiben liegen).
    // Scheitert die Sicherung, wird nicht migriert.
    const hasLog = sqlite
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
      .get()
    if (hasLog && filename !== ":memory:") {
      const applied = sqlite
        .prepare("SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1")
        .get() as { created_at: number } | undefined
      if (applied && migrations.some((m) => m.folderMillis > applied.created_at))
        sqlite.prepare("VACUUM INTO ?").run(`${filename}.vor-migration-${Date.now()}.bak`)
    }
    // Web-App und Worker können gleichzeitig starten; Migrationen nur unter Schreibsperre lesen/anwenden.
    sqlite
      .transaction(() => {
        sqlite.exec(
          "CREATE TABLE IF NOT EXISTS __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at INTEGER NOT NULL)"
        )
        const last = sqlite
          .prepare(
            "SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1"
          )
          .get() as { created_at: number } | undefined
        for (const migration of migrations) {
          if (last && last.created_at >= migration.folderMillis) continue
          for (const statement of migration.sql) sqlite.exec(statement)
          sqlite
            .prepare(
              "INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)"
            )
            .run(migration.hash, migration.folderMillis)
        }
      })
      .immediate()
    return db
  } catch (error) {
    sqlite.close()
    throw error
  }
}

let connection: ReturnType<typeof openDatabase> | undefined
export function getDatabase() {
  return (connection ??= openDatabase())
}
