import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { resolve } from "node:path"
import { test } from "node:test"

// Eigene Testdatei, nie die persönlichen App-Daten.
const directory = mkdtempSync(resolve(".orbit-test-"))
process.env.ORBIT_DATA_DIR = directory
const { getDatabase } = await import("./client.ts")
const { dispatchDue, sweepStaleRuns } = await import("./automations.ts")

test("Takt: fälliger Termin startet genau einmal, once endet, Hänger werden beendet", () => {
  const sqlite = getDatabase().$client
  try {
    sqlite
      .prepare(
        "insert into bots (id, user_id, third_party_id, name, job, avatar) values ('b','u','b','B','J','a')"
      )
      .run()
    const now = new Date("2026-10-21T10:00:00Z")
    const add = (id: string, schedule: object, next: number) =>
      sqlite
        .prepare(
          "insert into automations (id, user_id, bot_id, name, prompt, schedule, next_run_at) values (?, 'u', 'b', 'n', 'p', ?, ?)"
        )
        .run(id, JSON.stringify(schedule), next)
    add("daily", { kind: "daily", at: "08:00" }, now.getTime() - 1000)
    add(
      "once",
      { kind: "once", at: "08:00", date: "2026-10-21" },
      now.getTime() - 1000
    )
    add("later", { kind: "daily", at: "08:00" }, now.getTime() + 60_000)
    assert.deepEqual(dispatchDue(now).sort(), ["daily", "once"])
    assert.deepEqual(dispatchDue(now), [])
    const row = (id: string) =>
      sqlite
        .prepare("select enabled, next_run_at from automations where id = ?")
        .get(id) as { enabled: number; next_run_at: number }
    assert.equal(row("daily").enabled, 1)
    assert.ok(row("daily").next_run_at > now.getTime())
    assert.equal(row("once").enabled, 0)

    sqlite
      .prepare(
        "insert into automation_runs (id, automation_id, user_id, status, trigger, started_at) values ('r','daily','u','running','schedule',?)"
      )
      .run(now.getTime() - 20 * 60_000)
    // Eigene laufende Läufe warten bis zu 24 h auf Freigaben und werden nicht beendet.
    sqlite
      .prepare(
        "insert into automation_runs (id, automation_id, user_id, status, trigger, started_at) values ('w','daily','u','waiting','schedule',?), ('x','daily','u','running','schedule',?)"
      )
      .run(now.getTime() - 60 * 60_000, now.getTime() - 60 * 60_000)
    sweepStaleRuns(now.getTime(), ["w", "x"])
    assert.equal(
      (
        sqlite
          .prepare("select status from automation_runs where id='r'")
          .get() as { status: string }
      ).status,
      "error"
    )
    const statusOf = (id: string) =>
      (sqlite.prepare("select status from automation_runs where id = ?").get(id) as { status: string }).status
    assert.equal(statusOf("w"), "waiting")
    assert.equal(statusOf("x"), "running")
    sweepStaleRuns(now.getTime())
    assert.equal(statusOf("w"), "error")
  } finally {
    sqlite.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
