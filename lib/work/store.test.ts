import "../../service/src/chat/fixtures/temp-data.ts"

import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import { openDatabase } from "../db/client.ts"
import {
  getKv,
  loadCounters,
  loadInteractions,
  markSeen,
  pruneCounters,
  removeInteraction,
  saveCounters,
  saveInteraction,
  setKv,
} from "./store.ts"

const dir = mkdtempSync(join(tmpdir(), "orbit-wstore-"))
after(() => rmSync(dir, { recursive: true, force: true }))
const db = openDatabase(join(dir, "t.sqlite")).$client

test("Offene Freigaben bleiben gespeichert, abgelaufene fallen beim Laden weg", () => {
  const base = { chatId: "c1", botId: "b1", kind: "approval" }
  saveInteraction(db, { ...base, id: "i1", requestedAt: 1000, expiresAt: 5000, request: { id: "i1", tool: "bash" } })
  saveInteraction(db, { ...base, id: "i2", requestedAt: 100, expiresAt: 900, request: { id: "i2" } })
  const loaded = loadInteractions(db, 1500)
  assert.deepEqual(loaded.map((item) => item.id), ["i1"])
  assert.deepEqual(loaded[0]?.request, { id: "i1", tool: "bash" })
  removeInteraction(db, "i1")
  assert.deepEqual(loadInteractions(db, 1500), [])
})

test("Auftragszähler: speichern, überschreiben, laden, alte aufräumen", () => {
  saveCounters(db, { taskId: "t1", rootChatId: "c1", sent: 3, groupRounds: 1, deepCalls: 2, pairWakes: [["a|b", 2]] }, 1000)
  saveCounters(db, { taskId: "t1", rootChatId: "c1", sent: 4, groupRounds: 1, deepCalls: 2, pairWakes: [["a|b", 3]] }, 2000)
  assert.deepEqual(loadCounters(db, "t1"), { taskId: "t1", rootChatId: "c1", sent: 4, groupRounds: 1, deepCalls: 2, pairWakes: [["a|b", 3]] })
  assert.equal(loadCounters(db, "nope"), null)
  pruneCounters(db, 500, 3000)
  assert.equal(loadCounters(db, "t1"), null)
})

test("Gesehen und Einstellungen", () => {
  markSeen(db, "c1", 10)
  markSeen(db, "c1", 20)
  assert.equal((db.prepare("select seen_at as s from chat_seen where chat_id = 'c1'").get() as { s: number }).s, 20)
  assert.equal(getKv(db, "x"), null)
  setKv(db, "x", "1")
  setKv(db, "x", "2")
  assert.equal(getKv(db, "x"), "2")
})
