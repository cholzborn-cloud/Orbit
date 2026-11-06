import assert from "node:assert/strict"
import test from "node:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

process.env.ORBIT_DATA_DIR = mkdtempSync(join(tmpdir(), "orbit-onboarding-reserve-test-"))
const { getDatabase } = await import("@/lib/db/client")
const { reserveOrbiSelection, completeOrbiSelection, isOrbiSelectionComplete } = await import("@/lib/chat/onboarding")

test("Eine Auswahl ist dauerhaft einmalig und auf Chat und Orbi begrenzt", () => {
  const db = getDatabase().$client
  assert.equal(reserveOrbiSelection(db, "chat-a", "orbi-a", "karte"), true)
  assert.equal(reserveOrbiSelection(db, "chat-a", "orbi-a", "karte"), false)
  assert.equal(isOrbiSelectionComplete(db, "chat-a", "orbi-a", "karte"), false)
  completeOrbiSelection(db, "chat-a", "orbi-a", "karte")
  assert.equal(isOrbiSelectionComplete(db, "chat-a", "orbi-a", "karte"), true)
  assert.equal(reserveOrbiSelection(db, "chat-b", "orbi-a", "karte"), true)
  assert.equal(reserveOrbiSelection(db, "chat-a", "orbi-b", "karte"), true)
})
