import assert from "node:assert/strict"
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { test } from "node:test"

const dir = mkdtempSync(join(tmpdir(), "orbit-migbak-"))
process.env.ORBIT_DATA_DIR = dir
const { openDatabase } = await import("./client.ts")

// Migrationsordner ohne 0007 bis 0010, danach der volle: die Datenbank steht auf "alt", die Migration läuft erst beim zweiten Öffnen.
test("Migration einer bestehenden Datenbank legt vorher eine Sicherung an, neue Datenbank nicht", () => {
  const full = resolve("drizzle/sqlite")
  const old = join(dir, "migrations-alt")
  cpSync(full, old, { recursive: true })
  rmSync(join(old, "0007_phase4_g.sql"))
  rmSync(join(old, "0008_phase4_h.sql"))
  rmSync(join(old, "0009_phase4_i.sql"))
  rmSync(join(old, "0010_phase5.sql"))
  rmSync(join(old, "0011_tasks.sql"))
  rmSync(join(old, "0012_orbi_version_archive.sql"))
  const journal = JSON.parse(readFileSync(join(old, "meta/_journal.json"), "utf8"))
  journal.entries = journal.entries.filter((e: { tag: string }) => !["0007_phase4_g", "0008_phase4_h", "0009_phase4_i", "0010_phase5", "0011_tasks", "0012_orbi_version_archive"].includes(e.tag))
  writeFileSync(join(old, "meta/_journal.json"), JSON.stringify(journal))

  const file = join(dir, "orbit.sqlite")
  process.env.ORBIT_MIGRATIONS_DIR = old
  const created = openDatabase(file)
  created.$client.prepare("insert into bots (id, user_id, third_party_id, name, job, avatar) values ('b','local','b','B','J','a')").run()
  created.$client.close()
  // Frische Datenbank: keine Sicherung nötig.
  assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith(".bak")), [])

  process.env.ORBIT_MIGRATIONS_DIR = full
  const migrated = openDatabase(file)
  try {
    const backups = readdirSync(dir).filter((f) => f.includes("vor-migration") && f.endsWith(".bak"))
    assert.equal(backups.length, 1)
    // Die Sicherung ist der Stand VOR der Migration: Daten da, neue Spalte noch nicht.
    const Database = migrated.$client.constructor as new (path: string, options?: object) => typeof migrated.$client
    const backup = new Database(join(dir, backups[0]!), { readonly: true })
    assert.equal((backup.prepare("select count(*) as n from bots").get() as { n: number }).n, 1)
    assert.equal((backup.prepare("pragma table_info(turn_usage)").all() as { name: string }[]).some((c) => c.name === "steps"), false)
    backup.close()
    assert.equal((migrated.$client.prepare("pragma table_info(turn_usage)").all() as { name: string }[]).some((c) => c.name === "steps"), true)
    assert.equal((migrated.$client.prepare("select count(*) as n from bots").get() as { n: number }).n, 1)
  } finally {
    migrated.$client.close()
  }
  // Nochmal öffnen: nichts mehr zu migrieren, keine weitere Sicherung.
  openDatabase(file).$client.close()
  assert.equal(readdirSync(dir).filter((f) => f.endsWith(".bak")).length, 1)
  delete process.env.ORBIT_MIGRATIONS_DIR
  rmSync(dir, { recursive: true, force: true })
})
