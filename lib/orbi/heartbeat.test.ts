import "../../service/src/chat/fixtures/temp-data.ts"

import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import { openDatabase } from "../db/client.ts"
import { dueHeartbeats, heartbeatFacts, runHeartbeat } from "./heartbeat.ts"

const dir = mkdtempSync(join(tmpdir(), "orbit-hb-"))
after(() => rmSync(dir, { recursive: true, force: true }))
const db = openDatabase(join(dir, "t.sqlite")).$client
const TZ = "UTC"
const at = (h: number, m = 0, day = 2) => new Date(Date.UTC(2026, 10, day, h, m))
db.prepare("insert into bots (id, user_id, third_party_id, name, job, avatar, heartbeat_enabled) values ('b1', 'local', 'b1', 'Nova', 'J', 'a', 1)").run()
db.prepare("insert into bots (id, user_id, third_party_id, name, job, avatar) values ('b2', 'local', 'b2', 'Aus', 'J', 'a')").run()
db.prepare("insert into chats (id, user_id, kind, created_at, last_message_at) values ('c1', 'local', 'direct', 1, 1)").run()
db.prepare("insert into chat_members (chat_id, bot_id) values ('c1', 'b1')").run()
db.prepare("insert into automations (id, user_id, bot_id, name, prompt, schedule) values ('a1', 'local', 'b1', 'Wochenbericht', 'p', '{}')").run()
const finishedRun = (id: string, status: string, finishedAt: number) =>
  db.prepare("insert into automation_runs (id, automation_id, user_id, status, started_at, finished_at) values (?, 'a1', 'local', ?, ?, ?)").run(id, status, finishedAt - 1, finishedAt)

const posts: string[] = []
const post = async ({ text }: { text: string }) => {
  posts.push(text)
  return true
}
let modelCalls = 0
const say = (text: string) => async () => {
  modelCalls++
  return { text }
}

test("fällig nur mit Schalter, Mac-Aktivität, im Zeitfenster und nach einem Intervall", () => {
  const first = at(10)
  assert.deepEqual(dueHeartbeats(db, first, true, TZ), []) // Zeile angelegt, erster Termin in 30 Minuten
  assert.deepEqual(dueHeartbeats(db, at(10, 30), true, TZ), ["b1"])
  assert.deepEqual(dueHeartbeats(db, at(10, 30), false, TZ), []) // Mac nicht aktiv
  assert.deepEqual(dueHeartbeats(db, at(23, 0), true, TZ), []) // außerhalb des Wachfensters
  assert.deepEqual(dueHeartbeats(db, at(7, 0), true, TZ), [])
  assert.equal(db.prepare("select 1 from orbi_heartbeat where bot_id = 'b2'").get(), undefined) // Schalter aus: nie
})

test("Schweigt ohne Fakten und ohne Modellaufruf", async () => {
  const result = await runHeartbeat({ db, botId: "b1", generate: say("Hallo"), post, now: () => at(10, 30).getTime(), timezone: TZ })
  assert.deepEqual(result, { status: "silent", reason: "nothing" })
  assert.equal(modelCalls, 0)
  assert.deepEqual(posts, [])
})

test("Neue Fakten: eine Nachricht, danach höchstens eine pro Tag und Schweigen bei Unverändertem", async () => {
  finishedRun("r1", "ok", at(11).getTime())
  const run = (h: number, m: number, text: string, day = 2) =>
    runHeartbeat({ db, botId: "b1", generate: say(text), post, now: () => at(h, m, day).getTime(), timezone: TZ })
  assert.deepEqual(heartbeatFacts(db, "b1", at(10, 30).getTime(), at(12).getTime()), ["Automation „Wochenbericht“ ist fertig."])
  const first = await run(12, 0, "Dein Wochenbericht ist fertig.")
  assert.deepEqual(first, { status: "posted", text: "Dein Wochenbericht ist fertig." })
  assert.deepEqual(posts, ["Dein Wochenbericht ist fertig."])
  assert.equal(modelCalls, 1)
  // Noch ein neues Ergebnis am selben Tag: keine zweite Nachricht, kein Modellaufruf.
  finishedRun("r2", "error", at(13).getTime())
  assert.deepEqual(await run(13, 30, "Noch etwas."), { status: "silent", reason: "already-today" })
  assert.equal(modelCalls, 1)
  assert.equal(posts.length, 1)
  // Nächster Tag: die Änderung wurde nicht verbraucht und kommt jetzt.
  assert.deepEqual(await run(9, 0, "Ein Lauf ist fehlgeschlagen.", 3), { status: "posted", text: "Ein Lauf ist fehlgeschlagen." })
  assert.equal(posts.length, 2)
  // Danach unverändert: kein Modellaufruf, Schweigen.
  const calls = modelCalls
  assert.deepEqual(await run(10, 0, "x", 4), { status: "silent", reason: "nothing" })
  finishedRun("r7", "error", at(11, 0, 4).getTime()) // gleiche Tatsache wie zuletzt gemeldet: nicht noch einmal
  assert.deepEqual(await run(12, 0, "x", 4), { status: "silent", reason: "unchanged" })
  assert.equal(modelCalls, calls)
})

test("Modell antwortet SCHWEIGEN, Zugangsdaten oder Link: nichts wird gepostet", async () => {
  const before = posts.length
  finishedRun("r3", "ok", at(5, 0, 5).getTime() + 3_600_000)
  const base = { db, botId: "b1", post, timezone: TZ }
  const t = (h: number) => () => at(h, 0, 5).getTime()
  assert.deepEqual(await runHeartbeat({ ...base, generate: say("SCHWEIGEN"), now: t(9) }), { status: "silent", reason: "model-silent" })
  finishedRun("r4", "error", at(10, 0, 5).getTime())
  assert.deepEqual(await runHeartbeat({ ...base, generate: say("Mehr unter https://böse.example"), now: t(11) }), { status: "silent", reason: "rejected" })
  finishedRun("r5", "ok", at(11, 30, 5).getTime())
  assert.deepEqual(await runHeartbeat({ ...base, generate: say("Dein Schlüssel ist sk-ant-api03-abcdefghijklmnopqrstuvwx"), now: t(12) }), { status: "silent", reason: "rejected" })
  assert.equal(posts.length, before)
})

test("Schalter aus, laufender Turn im Chat oder Sperre: still; Fehler im Modell lässt den Schalter und die Sperre sauber", async () => {
  assert.deepEqual(await runHeartbeat({ db, botId: "b2", generate: say("x"), post, now: () => at(12).getTime(), timezone: TZ }), { status: "silent", reason: "off" })
  db.prepare("insert into work_runs (id, kind, chat_id, status, steps, started_at, updated_at) values ('w1', 'turn', 'c1', 'running', 0, 1, 1)").run()
  finishedRun("r6", "error", at(6, 0, 6).getTime() + 3_600_000)
  assert.deepEqual(await runHeartbeat({ db, botId: "b1", generate: say("x"), post, now: () => at(12, 0, 6).getTime(), timezone: TZ }), { status: "silent", reason: "busy" })
  db.prepare("update work_runs set status = 'done' where id = 'w1'").run()
  const failing = async () => {
    throw new Error("proxy down")
  }
  const result = await runHeartbeat({ db, botId: "b1", generate: failing, post, now: () => at(13, 0, 6).getTime(), timezone: TZ })
  assert.deepEqual(result, { status: "error", error: "Heartbeat fehlgeschlagen." })
  assert.equal((db.prepare("select running_since as r from orbi_heartbeat where bot_id = 'b1'").get() as { r: number | null }).r, null)
})
