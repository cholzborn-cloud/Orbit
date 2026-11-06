import "../../service/src/chat/fixtures/temp-data.ts"

import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import { openDatabase } from "../db/client.ts"
import {
  editEntry,
  forgetEntry,
  getEntry,
  LIMITS,
  listEntries,
  listTrash,
  migrateLegacyMemory,
  restoreEntry,
  saveEntry,
  type SaveInput,
} from "./local-memory.ts"

const dir = mkdtempSync(join(tmpdir(), "orbit-mem5-"))
after(() => rmSync(dir, { recursive: true, force: true }))
const db = openDatabase(join(dir, "t.sqlite")).$client
for (const id of ["b1", "b2", "b3"])
  db.prepare("insert into bots (id, user_id, third_party_id, name, job, avatar) values (?, 'local', ?, 'B', 'J', 'a')").run(id, id)

const tee: SaveInput = {
  name: "tee",
  type: "user",
  description: "Consti trinkt Tee",
  body: "Consti trinkt abends Tee, nie Kaffee.",
  from: "consti",
  source: "Consti: ich trinke abends nur Tee",
}

test("Ändern: gilt als von Consti gesagt, Version steigt, Protokoll edit; veraltete Version und Zugangsdaten werden abgelehnt", () => {
  const saved = saveEntry(db, "b1", { ...tee, type: "project", from: "self", source: "eigene Notiz" })
  assert.equal(saved.ok, true)
  assert.equal(getEntry(db, "b1", "tee")?.stated, false)
  const edited = editEntry(db, "b1", "tee", { description: "Consti trinkt Tee", body: "Tee, nie Kaffee, auch morgens.", ifVersion: 1 }, 1_700_000_000_000)
  assert.deepEqual(edited, { ok: true, name: "tee", version: 2, replaced: [] })
  const entry = getEntry(db, "b1", "tee")!
  assert.equal(entry.stated, true)
  assert.equal(entry.origin, "consti")
  assert.match(entry.source, /Von Consti in der App geändert am 2023-11-14/)
  assert.equal(entry.body, "Tee, nie Kaffee, auch morgens.")
  const log = db.prepare("select action from orbi_memory_log where bot_id = 'b1' and name = 'tee' order by id").all() as { action: string }[]
  assert.ok(log.some((row) => row.action === "edit"))
  assert.equal(editEntry(db, "b1", "tee", { description: "x", body: "y", ifVersion: 1 }).ok, false) // veraltet
  assert.equal(editEntry(db, "b1", "tee", { description: "d", body: "Mein Schlüssel ist sk-ant-api03-abcdefghijklmnopqrstuvwx", ifVersion: 2 }).ok, false)
  assert.equal(editEntry(db, "b1", "gibtsnicht", { description: "d", body: "b", ifVersion: 1 }).ok, false)
})

test("Löschen hebt den Stand auf; Wiederherstellen bringt ihn mit höherer Version zurück", () => {
  assert.equal(forgetEntry(db, "b1", "tee", "gelöscht in der App", 5000).ok, true)
  assert.equal(getEntry(db, "b1", "tee"), null)
  const trash = listTrash(db, "b1")
  assert.equal(trash.length, 1)
  assert.equal(trash[0]?.name, "tee")
  assert.equal(trash[0]?.body, "Tee, nie Kaffee, auch morgens.")
  assert.equal(trash[0]?.deletedAt, 5000)
  // Anderer Orbi sieht nichts.
  assert.deepEqual(listTrash(db, "b2"), [])
  assert.deepEqual(restoreEntry(db, "b1", "tee", 6000), { ok: true, version: 3 })
  const back = getEntry(db, "b1", "tee")!
  assert.equal(back.body, "Tee, nie Kaffee, auch morgens.")
  assert.equal(back.stated, true)
  assert.equal(back.version, 3)
  assert.deepEqual(listTrash(db, "b1"), [])
  assert.equal(restoreEntry(db, "b1", "tee").ok, false) // nichts mehr im Papierkorb
})

test("Wiederherstellen scheitert bei belegtem Namen und vollem Gedächtnis, ohne etwas zu verlieren", () => {
  assert.equal(saveEntry(db, "b2", tee).ok, true)
  forgetEntry(db, "b2", "tee")
  assert.equal(saveEntry(db, "b2", tee).ok, true) // gleicher Name neu belegt
  const clash = restoreEntry(db, "b2", "tee")
  assert.equal(clash.ok, false)
  assert.equal(listTrash(db, "b2").length, 1) // bleibt im Papierkorb
  for (let i = 0; i < LIMITS.entries - 1; i++)
    assert.equal(saveEntry(db, "b2", { ...tee, name: `eintrag-${i}`, description: `d${i}`, body: `b${i}` }).ok, true)
  forgetEntry(db, "b2", "tee")
  assert.equal(listEntries(db, "b2").length, LIMITS.entries - 1)
  assert.equal(saveEntry(db, "b2", { ...tee, name: "extra", description: "e", body: "e" }).ok, true)
  assert.equal(listEntries(db, "b2").length, LIMITS.entries)
  assert.equal(restoreEntry(db, "b2", "tee").ok, false)
})

test("Migration der Sandbox-Datei: läuft die Sandbox nicht, wird sie nicht gestartet und nichts gezählt; nach drei Lesefehlern ist die Migration mit 0 abgeschlossen", async () => {
  class NotRunning extends Error {
    constructor() {
      super("Sandbox läuft nicht.")
      this.name = "SandboxNotRunning"
    }
  }
  for (let i = 0; i < 5; i++) assert.deepEqual(await migrateLegacyMemory(db, "b3", async () => { throw new NotRunning() }), { status: "deferred" })
  assert.equal(db.prepare("select 1 from orbi_memory_attempts where bot_id = 'b3'").get(), undefined)
  assert.equal(db.prepare("select 1 from orbi_memory_meta where bot_id = 'b3'").get(), undefined)
  const failing = async () => {
    throw new Error("Zeitüberschreitung")
  }
  assert.deepEqual(await migrateLegacyMemory(db, "b3", failing), { status: "unreadable" })
  assert.deepEqual(await migrateLegacyMemory(db, "b3", failing), { status: "unreadable" })
  assert.equal(db.prepare("select 1 from orbi_memory_meta where bot_id = 'b3'").get(), undefined)
  assert.deepEqual(await migrateLegacyMemory(db, "b3", failing), { status: "gave-up" })
  const meta = db.prepare("select imported from orbi_memory_meta where bot_id = 'b3'").get() as { imported: number }
  assert.equal(meta.imported, 0)
  // Danach wird nie wieder gelesen.
  let reads = 0
  assert.deepEqual(await migrateLegacyMemory(db, "b3", async () => { reads++; return "" }), { status: "already" })
  assert.equal(reads, 0)
})
