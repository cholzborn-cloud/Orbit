import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

// Eigene Testdatei, nie die persönlichen App-Daten.
const dir = mkdtempSync(join(tmpdir(), "orbitd-scheduler-"))
process.env.ORBIT_DATA_DIR = dir
const { getDatabase } = await import("@/lib/db/client")
const { createScheduler } = await import("./scheduler")
const sqlite = getDatabase().$client

sqlite
  .prepare(
    "insert into bots (id, user_id, third_party_id, name, job, avatar) values ('b','local','b','B','J','a')"
  )
  .run()
const add = (id: string, schedule: object, next: number) =>
  sqlite
    .prepare(
      "insert into automations (id, user_id, bot_id, name, prompt, schedule, next_run_at) values (?, 'local', 'b', 'n', 'p', ?, ?)"
    )
    .run(id, JSON.stringify(schedule), next)
const nextRunAt = (id: string) =>
  (
    sqlite
      .prepare("select next_run_at from automations where id = ?")
      .get(id) as { next_run_at: number }
  ).next_run_at

test("Takt: Uhrsprung über mehrere Termine startet genau einmal nach", () => {
  const T0 = new Date("2026-10-21T07:00:00Z")
  let now = T0
  const started: string[] = []
  add("daily", { kind: "daily", at: "08:00" }, T0.getTime() + 3_600_000)
  const scheduler = createScheduler({
    start: (id) => started.push(id),
    now: () => now,
  })
  scheduler.tick()
  assert.deepEqual(started, [])
  // Mac schläft fünf Tage: fünf Termine wurden verpasst.
  now = new Date(T0.getTime() + 5 * 86_400_000)
  scheduler.tick()
  assert.deepEqual(started, ["daily"])
  assert.ok(nextRunAt("daily") > now.getTime())
  scheduler.tick()
  assert.deepEqual(started, ["daily"])
})

test("Start: verwaiste Läufe werden beendet, bevor der erste Takt läuft", () => {
  sqlite
    .prepare(
      "insert into automation_runs (id, automation_id, user_id, status, trigger) values ('orphan','daily','local','running','schedule')"
    )
    .run()
  const scheduler = createScheduler({ start: () => {} })
  scheduler.run()
  scheduler.stop()
  const row = sqlite
    .prepare("select status, error from automation_runs where id = 'orphan'")
    .get() as { status: string; error: string }
  assert.deepEqual(row, { status: "error", error: "Lauf abgebrochen" })
})

test("Aufräumen", () => {
  sqlite.close()
  rmSync(dir, { recursive: true, force: true })
})
