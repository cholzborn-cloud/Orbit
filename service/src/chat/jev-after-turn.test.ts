import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

// Eigene Testdatei, nie die persönlichen App-Daten.
const dir = mkdtempSync(join(tmpdir(), "orbitd-jev-"))
process.env.ORBIT_DATA_DIR = dir
process.env.OPENROUTER_JEV_API_KEY = "test"
const { getDatabase } = await import("@/lib/db/client")
const { afterTurnIfDue } = await import("@/lib/jev/after-turn")
const sqlite = getDatabase().$client

test("Auto-Turn mit Merkenswertem landet im jev_log, andere Modelle nicht", async () => {
  const input = {
    userId: "local",
    chatId: "c",
    model: "auto",
    auto: true,
    text: "Merk dir: ich trinke nur Tee.",
  }
  const ask = async () => ({
    ok: true as const,
    answers: { memorable: { noul: 0.9 } },
    durationMs: 12,
  })
  assert.equal(
    await afterTurnIfDue({ ...input, model: "claude-haiku-5-5" }, ask),
    false
  )
  assert.equal(await afterTurnIfDue(input, ask), true)
  // logJev schreibt im Hintergrund.
  await new Promise((resolve) => setTimeout(resolve, 100))
  const rows = sqlite
    .prepare("select kind, chat_id, duration_ms from jev_log")
    .all()
  assert.deepEqual(rows, [{ kind: "memory", chat_id: "c", duration_ms: 12 }])
  sqlite.close()
  rmSync(dir, { recursive: true, force: true })
})
