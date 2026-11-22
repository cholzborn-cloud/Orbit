import assert from "node:assert/strict"
import test from "node:test"
import Database from "better-sqlite3"

import {
  archiveFleetBot,
  listFleetBots,
  proposeBotProfile,
  updateFleetBot,
  fleetTools,
} from "./orbi-fleet-tools.ts"
import { popUndo } from "../db/undo-store.ts"
import type { ChatContext } from "./load-chat.ts"

function setupFleetDb() {
  const db = new Database(":memory:")
  db.exec(`
    CREATE TABLE bots (
      id TEXT PRIMARY KEY NOT NULL,
      user_id TEXT NOT NULL,
      third_party_id TEXT NOT NULL,
      name TEXT NOT NULL,
      avatar TEXT NOT NULL,
      color TEXT,
      job TEXT NOT NULL,
      instructions TEXT,
      is_main INTEGER NOT NULL DEFAULT 0,
      version INTEGER NOT NULL DEFAULT 1,
      archived_at INTEGER,
      created_at INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY NOT NULL,
      orbi_id TEXT NOT NULL,
      parent_chat_id TEXT NOT NULL,
      status TEXT NOT NULL
    );

    CREATE TABLE orbi_work (
      chat_id TEXT PRIMARY KEY NOT NULL,
      bot_id TEXT NOT NULL
    );

    CREATE TABLE undo_actions (
      id TEXT PRIMARY KEY NOT NULL,
      kind TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT NOT NULL,
      previous_state TEXT,
      created_at INTEGER NOT NULL
    );
  `)
  return db
}

test("FleetTools: listFleetBots zeigt Verfügbarkeit und Version", () => {
  const db = setupFleetDb()
  db.prepare(
    "INSERT INTO bots (id, user_id, third_party_id, name, avatar, job, is_main, version) VALUES (?, 'local', ?, ?, 'a', ?, ?, ?)"
  ).run("b-main", "b-main", "Freddy", "Chef", 1, 1)

  db.prepare(
    "INSERT INTO bots (id, user_id, third_party_id, name, avatar, job, is_main, version) VALUES (?, 'local', ?, ?, 'a', ?, ?, ?)"
  ).run("b-worker", "b-worker", "Cody", "Coder", 0, 1)

  // Worker arbeitet gerade
  db.prepare(
    "INSERT INTO tasks (id, orbi_id, parent_chat_id, status) VALUES ('t1', 'b-worker', 'c1', 'running')"
  ).run()

  const list = listFleetBots(db, "local")
  assert.equal(list.length, 2)
  const freddy = list.find((b) => b.id === "b-main")!
  const cody = list.find((b) => b.id === "b-worker")!

  assert.equal(freddy.status, "frei")
  assert.equal(freddy.isMain, true)
  assert.equal(cody.status, "arbeitet")
  assert.equal(cody.isMain, false)
})

test("FleetTools: updateFleetBot mit expected_version & Versionskonflikt", () => {
  const db = setupFleetDb()
  db.prepare(
    "INSERT INTO bots (id, user_id, third_party_id, name, avatar, job, is_main, version) VALUES ('b1', 'local', 'b1', 'Lexi', 'a', 'Recherche', 0, 3)"
  ).run()

  // Falsche Version -> Fehler
  const fail = updateFleetBot(db, {
    id: "b1",
    expected_version: 2,
    job: "Neue Aufgabe",
  })
  assert.equal(fail.ok, false)
  assert.match(fail.error!, /Versionskonflikt/)

  // Richtige Version -> Erfolg und Version inkrementiert
  const ok = updateFleetBot(db, {
    id: "b1",
    expected_version: 3,
    job: "Neue Recherche",
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.version, 4)

  const updated = db.prepare("SELECT job, version FROM bots WHERE id = 'b1'").get() as {
    job: string
    version: number
  }
  assert.equal(updated.job, "Neue Recherche")
  assert.equal(updated.version, 4)

  // Undo-Eintrag existiert
  const undo = popUndo(db, { kind: "orbi", entityId: "b1" })
  assert.ok(undo)
  assert.equal(undo.action, "update")
})

test("FleetTools: archiveFleetBot schützt Hauptorbi und archiviert normale Orbis", () => {
  const db = setupFleetDb()
  db.prepare(
    "INSERT INTO bots (id, user_id, third_party_id, name, avatar, job, is_main, version) VALUES ('b-main', 'local', 'b-main', 'Freddy', 'a', 'Chef', 1, 1)"
  ).run()
  db.prepare(
    "INSERT INTO bots (id, user_id, third_party_id, name, avatar, job, is_main, version) VALUES ('b-sub', 'local', 'b-sub', 'Tomi', 'a', 'Helfer', 0, 1)"
  ).run()

  // Hauptorbi archivieren verboten
  const failMain = archiveFleetBot(db, { id: "b-main" })
  assert.equal(failMain.ok, false)
  assert.match(failMain.error!, /Hauptorbi kann nicht archiviert werden/)

  // Normaler Orbi
  const okSub = archiveFleetBot(db, { id: "b-sub", expected_version: 1 })
  assert.equal(okSub.ok, true)

  const archived = db.prepare("SELECT archived_at, version FROM bots WHERE id = 'b-sub'").get() as {
    archived_at: number | null
    version: number
  }
  assert.ok(archived.archived_at)
  assert.equal(archived.version, 2)

  // listFleetBots filtert archivierte Orbis heraus
  const list = listFleetBots(db, "local")
  assert.equal(list.length, 1)
  assert.equal(list[0].id, "b-main")
})

test("FleetTools: proposeBotProfile ändert eigenes Profil sofort mit Undo", () => {
  const db = setupFleetDb()
  db.prepare(
    "INSERT INTO bots (id, user_id, third_party_id, name, avatar, job, instructions, is_main, version) VALUES ('b-self', 'local', 'b-self', 'Selfie', 'a', 'Alt', 'InstAlt', 0, 1)"
  ).run()

  const res = proposeBotProfile(db, "b-self", {
    job: "NeuJob",
    instructions: "NeuInst",
  })
  assert.equal(res.ok, true)

  const bot = db.prepare("SELECT job, instructions, version FROM bots WHERE id = 'b-self'").get() as {
    job: string
    instructions: string
    version: number
  }
  assert.equal(bot.job, "NeuJob")
  assert.equal(bot.instructions, "NeuInst")
  assert.equal(bot.version, 2)

  const undo = popUndo(db, { kind: "profile", entityId: "b-self" })
  assert.ok(undo)
})
