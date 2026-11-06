import "../../service/src/chat/fixtures/temp-data.ts"

import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import { openDatabase } from "../db/client.ts"
import {
  activeRuns,
  addStep,
  finishRun,
  getRun,
  interruptStale,
  interruptedFor,
  pruneRuns,
  setRunStatus,
  settleInterrupted,
  startRun,
} from "./runs.ts"

const dir = mkdtempSync(join(tmpdir(), "orbit-runs-"))
after(() => rmSync(dir, { recursive: true, force: true }))
const db = openDatabase(join(dir, "t.sqlite")).$client

test("Lebenslauf eines Jobs: running, waiting, Schritte, done", () => {
  const id = startRun(db, { kind: "turn", chatId: "c1", botId: "b1", payload: { model: "auto", taskId: "t1" } }, 1000)
  assert.equal(getRun(db, id)?.status, "running")
  assert.deepEqual(getRun(db, id)?.payload, { model: "auto", taskId: "t1" })
  setRunStatus(db, id, "waiting", 1100)
  addStep(db, id, 1200)
  addStep(db, id, 1300)
  assert.equal(getRun(db, id)?.status, "waiting")
  assert.equal(getRun(db, id)?.steps, 2)
  finishRun(db, id, "done", undefined, 1400)
  assert.equal(getRun(db, id)?.status, "done")
  assert.equal(getRun(db, id)?.finishedAt, 1400)
  // Ein beendeter Job wird nie wieder „running“ und zählt keine Schritte mehr.
  setRunStatus(db, id, "running", 1500)
  addStep(db, id, 1600)
  assert.equal(getRun(db, id)?.status, "done")
  assert.equal(getRun(db, id)?.steps, 2)
})

test("Neustart: running, waiting und queued werden unterbrochen, Fertiges bleibt", () => {
  const a = startRun(db, { kind: "turn", chatId: "c2", botId: "b1" }, 2000)
  const b = startRun(db, { kind: "handoff", chatId: "c3", botId: "b2", parentId: a }, 2001)
  const c = startRun(db, { kind: "automation", chatId: "c4", status: "queued" }, 2002)
  const d = startRun(db, { kind: "turn", chatId: "c5" }, 2003)
  setRunStatus(db, b, "waiting", 2010)
  finishRun(db, d, "failed", "Antwort fehlgeschlagen", 2020)
  const stale = interruptStale(db, 3000)
  assert.deepEqual(stale.map((run) => run.id).sort(), [a, b, c].sort())
  for (const id of [a, b, c]) assert.equal(getRun(db, id)?.status, "interrupted")
  assert.equal(getRun(db, d)?.status, "failed")
  assert.deepEqual(activeRuns(db), [])
  assert.equal(getRun(db, b)?.parentId, a)
})

test("Unterbrochen-Hinweis: nur Turns, nur der jüngste, ein neuer Job im Chat räumt auf, Weiter erledigt ihn", () => {
  assert.ok(interruptedFor(db, "c2"))
  assert.equal(interruptedFor(db, "c3"), null) // Übergabe ohne Wurzel-Chat: kein eigenes Weiter
  assert.equal(interruptedFor(db, "c4"), null) // Automation: holt der Takt nach
  const run = interruptedFor(db, "c2")!
  const next = startRun(db, { kind: "turn", chatId: "c2" }, 4000)
  assert.equal(interruptedFor(db, "c2"), null)
  finishRun(db, next, "done", undefined, 4100)
  assert.equal(settleInterrupted(db, run.id, "fortgesetzt", 4200), true)
  assert.equal(getRun(db, run.id)?.status, "done")
  assert.equal(getRun(db, run.id)?.note, "fortgesetzt")
  assert.equal(settleInterrupted(db, run.id, "verworfen", 4300), false)
})

test("Aufräumen löscht nur alte beendete Einträge", () => {
  const old = startRun(db, { kind: "turn", chatId: "c9" }, 10)
  finishRun(db, old, "done", undefined, 20)
  const keep = startRun(db, { kind: "turn", chatId: "c9" }, 5_000_000)
  pruneRuns(db, 1000, 5_000_100)
  assert.equal(getRun(db, old), null)
  assert.equal(getRun(db, keep)?.status, "running")
})

test("Übergabe: „Weiter“ erscheint im Chat, in dem Consti geschrieben hat; ein Klick erledigt Turn und Übergaben zusammen", () => {
  const root = startRun(db, { kind: "turn", chatId: "root1", botId: "a", payload: { taskId: "T1" } }, 20_000)
  finishRun(db, root, "done", undefined, 20_100) // der Absender ist längst fertig
  const handoff = startRun(db, { kind: "handoff", chatId: "bchat", botId: "b", parentId: root, payload: { taskId: "T1", rootChatId: "root1" } }, 20_200)
  const second = startRun(db, { kind: "handoff", chatId: "cchat", botId: "c", parentId: root, payload: { taskId: "T1", rootChatId: "root1" } }, 20_300)
  interruptStale(db, 21_000)
  assert.equal(interruptedFor(db, "bchat"), null)
  assert.equal(interruptedFor(db, "root1")?.id, second) // je Wurzel-Chat nur einer, der jüngste
  assert.equal(settleInterrupted(db, second, "fortgesetzt", 21_100), true)
  assert.equal(getRun(db, handoff)?.status, "done")
  assert.equal(interruptedFor(db, "root1"), null)
})
