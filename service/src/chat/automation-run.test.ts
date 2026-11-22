import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { createUIMessageStreamResponse } from "ai"

// Eigene Testdatei, nie die persönlichen App-Daten.
const dir = mkdtempSync(join(tmpdir(), "orbitd-run-"))
process.env.ORBIT_DATA_DIR = dir
const { getDatabase } = await import("@/lib/db/client")
const { createMessageStore } = await import("./store")
const { TurnBuffers } = await import("./buffer")
const { ChatReservations } = await import("./reservations")
const { createAutomationRunner } = await import("./automation-run")
const { pruneRuns } = await import("@/lib/db/automations")
const sqlite = getDatabase().$client

sqlite
  .prepare(
    "insert into bots (id, user_id, third_party_id, name, job, avatar) values ('b','local','b','B','J','a')"
  )
  .run()
const add = (id: string) =>
  sqlite
    .prepare(
      "insert into automations (id, user_id, bot_id, name, prompt, schedule, next_run_at) values (?, 'local', 'b', 'Morgen', 'Sag Hallo', '{\"kind\":\"daily\",\"at\":\"08:00\"}', 1)"
    )
    .run(id)
const run = (id: string) =>
  sqlite.prepare("select * from automation_runs where id = ?").get(id) as {
    status: string
    error: string | null
    chat_id: string | null
  }

function setup(
  fail = false,
  answerText = "Hallo",
  onWakeParent?: (input: any) => Promise<void>
) {
  const store = createMessageStore()
  const turns = new TurnBuffers()
  const reservations = new ChatReservations()
  const events: { status: string }[] = []
  let gate: () => void = () => {}
  const opened = new Promise<void>((resolve) => (gate = resolve))
  const runner = createAutomationRunner({
    store,
    turns,
    reserve: (chatId) => reservations.reserve(chatId),
    publish: (event) => events.push(event as { status: string }),
    wakeParent: onWakeParent,
    runRoot: async (input) => {
      await opened
      const answer = {
        id: "a1",
        role: "assistant" as const,
        parts: [{ type: "text" as const, text: answerText }],
      }
      await input.onFinish?.({
        messages: [...input.messages, answer],
        isAborted: false,
        outcome: { status: fail ? "failed" : "finished" },
      } as never)
      return createUIMessageStreamResponse({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "finish" })
            controller.close()
          },
        }),
      })
    },
  })
  return { runner, store, events, gate: () => gate() }
}

test("Lauf: Chat entsteht, Aufgabe getaggt, Status ok, Freigabe-Wartezeit sichtbar", async () => {
  add("a1")
  const { runner, store, events, gate } = setup()
  const started = runner.start("a1", "manual")
  assert.ok(started)
  // Zweiter Start, solange der erste läuft: kein neuer Claim.
  assert.equal(runner.start("a1", "manual"), null)
  assert.equal(run(started.runId).status, "running")
  await new Promise((resolve) => setTimeout(resolve, 20))
  const live = run(started.runId).chat_id!
  runner.syncWaiting(live, true)
  assert.equal(run(started.runId).status, "waiting")
  assert.equal((await store.listMessages(live))[0].metadata?.automation?.status, "waiting")
  runner.syncWaiting(live, false)
  assert.equal(run(started.runId).status, "running")
  gate()
  await started.done
  assert.equal(run(started.runId).status, "ok")
  const messages = await store.listMessages(live)
  assert.equal(messages.length, 2)
  assert.equal(messages[0].metadata?.automation?.runId, started.runId)
  assert.equal(messages[0].metadata?.automation?.name, "Morgen")
  assert.equal(messages[0].metadata?.automation?.status, "ok")
  assert.equal(typeof messages[0].metadata?.automation?.finishedAt, "number")
  assert.match(
    (messages[0].parts[0] as { text: string }).text,
    /^\[\[automation:Morgen\]\]\nSag Hallo$/
  )
  assert.deepEqual(
    events.map((e) => e.status),
    ["running", "waiting", "running", "ok"]
  )
})

test("Lauf: fehlgeschlagene Antwort endet als Fehler", async () => {
  add("a2")
  const { runner, store, gate } = setup(true)
  gate()
  const started = runner.start("a2", "schedule")!
  await started.done
  assert.equal((await store.listMessages(run(started.runId).chat_id!))[0].metadata?.automation?.status, "error")
  assert.deepEqual(
    { status: run(started.runId).status, error: run(started.runId).error },
    { status: "error", error: "Lauf abgebrochen" }
  )
})

test("Laufkarte behält den Endstatus nach Entfernen alter Laufdatensätze", async () => {
  add("prune")
  const { runner, store, gate } = setup()
  gate()
  const started = runner.start("prune", "manual")!
  await started.done
  const chatId = run(started.runId).chat_id!
  // Ein normaler Chat bleibt erhalten, wenn seine alten Läufe entfernt werden.
  sqlite.prepare("update chats set kind = 'direct' where id = ?").run(chatId)
  const initial = (await store.listMessages(chatId))[0].metadata?.automation
  assert.equal(initial?.status, "ok")
  const addRun = sqlite.prepare("insert into automation_runs (id, automation_id, user_id, status, started_at, finished_at) values (?, 'prune', 'local', 'ok', ?, ?)")
  for (let i = 1; i <= 20; i++) addRun.run(`prune-${i}`, Date.now() + i, Date.now() + i)
  pruneRuns("prune")
  assert.equal(run(started.runId), undefined)
  assert.deepEqual((await store.listMessages(chatId))[0].metadata?.automation, initial)
})

test("Phase D: Protokoll NOTHING NEW = stiller Erfolg ohne wakeParent", async () => {
  add("a-nothing-new")
  let wakeCalled = false
  const { runner, gate } = setup(false, "NOTHING NEW", async () => {
    wakeCalled = true
  })
  gate()
  const started = runner.start("a-nothing-new", "schedule")!
  await started.done
  assert.equal(run(started.runId).status, "ok")
  assert.equal(wakeCalled, false)
})

test("Phase D: Protokoll NEEDS INPUT = weckt Eltern mit [routine] NEEDS INPUT", async () => {
  add("a-needs-input")
  let wakeData: any = null
  const { runner, gate } = setup(false, "NEEDS INPUT: Soll ich das Ticket buchen?", async (input) => {
    wakeData = input
  })
  gate()
  const started = runner.start("a-needs-input", "schedule")!
  await started.done
  assert.equal(run(started.runId).status, "ok")
  assert.ok(wakeData)
  assert.equal(wakeData.kind, "routine")
  assert.equal(wakeData.needsInput, true)
  assert.match(wakeData.text, /\[routine\] NEEDS INPUT: Soll ich das Ticket buchen\?/)
})

test("Aufräumen", () => {
  sqlite.close()
  rmSync(dir, { recursive: true, force: true })
})
