import assert from "node:assert/strict"
import test from "node:test"
import Database from "better-sqlite3"

import { listUndo, popUndo, recordUndo } from "./undo-store.ts"

function setupTestDb() {
  const db = new Database(":memory:")
  db.exec(`
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

test("UndoStore: record, list und pop", () => {
  const db = setupTestDb()

  recordUndo(db, {
    kind: "routine",
    entityId: "routine-1",
    action: "pause",
    detail: "Routine pausiert",
    previousState: { enabled: true },
  })

  recordUndo(db, {
    kind: "orbi",
    entityId: "bot-1",
    action: "update",
    detail: "Orbi Job geändert",
    previousState: { job: "Alte Aufgabe" },
  })

  const list = listUndo(db)
  assert.equal(list.length, 2)
  assert.equal(list[0].kind, "orbi")

  const poppedOrbi = popUndo(db, { kind: "orbi" })
  assert.ok(poppedOrbi)
  assert.equal(poppedOrbi.entityId, "bot-1")

  const remaining = listUndo(db)
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].kind, "routine")
})
