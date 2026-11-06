import assert from "node:assert/strict"
import test from "node:test"

import { openDatabase } from "@/lib/db/client"
import { createAssignmentStatusTool, createHandOffTool } from "@/lib/chat/hand-off"
import { createDispatcher } from "./dispatcher"
import { createTask, finishTask, getTask } from "@/lib/work/tasks"
import { LIMITS } from "@/lib/chat/orbi-message"

function createHandOffTestSetup() {
  const db = openDatabase(":memory:")
  const sqlite = db.$client

  sqlite
    .prepare(
      `INSERT INTO bots (id, user_id, third_party_id, name, avatar, job)
       VALUES ('bot-a', 'local', 'tp-a', 'Alice', 'bot', 'Coordinator'),
              ('bot-b', 'local', 'tp-b', 'Bob', 'bot', 'Worker')`
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO chats (id, user_id, kind, name)
       VALUES ('chat-a', 'local', 'direct', 'Alice Chat'),
              ('chat-b', 'local', 'direct', 'Bob Chat')`
    )
    .run()

  const lines: Array<{ chatId: string; line: unknown }> = []
  const store = {
    appendLine: async (chatId: string, line: unknown) => {
      lines.push({ chatId, line })
      return `line-${lines.length}`
    },
    patchLine: async () => null,
  }

  let wokenRequests: unknown[] = []
  const dispatcher = createDispatcher({
    store,
    reserve: () => () => {},
    isBusy: () => false,
    runWake: async (req, release) => {
      wokenRequests.push(req)
      release()
      return { text: "Ergebnis von Bob", failed: false, aborted: false }
    },
    stopChat: () => true,
    findGroup: async () => null,
    publish: () => {},
    saveTask: (t) => {
      createTask(sqlite, {
        id: t.id,
        orbiId: t.orbiId,
        parentChatId: t.parentChatId,
        brief: t.brief,
        title: t.title,
        mode: t.mode,
        reply: t.reply,
        status: t.status,
        assignedBotId: t.assignedBotId,
        doneWhen: t.doneWhen,
      })
    },
    updateTaskStatus: (id, status, result) => {
      finishTask(sqlite, id, status, result)
    },
  })

  return {
    sqlite,
    dispatcher,
    lines,
    getWoken: () => wokenRequests,
  }
}

test("HandOff: Auftragsbaum in tasks-Tabelle, work-Modus mit resume weckt den Absender", async () => {
  const { sqlite, dispatcher, lines, getWoken } = createHandOffTestSetup()

  const taskId = dispatcher.beginTask("chat-a")
  const botA = { id: "bot-a", name: "Alice", avatar: "a", color: null, direct_chat_id: "chat-a" }
  const botB = { id: "bot-b", name: "Bob", avatar: "b", color: null, direct_chat_id: "chat-b" }

  const tool = createHandOffTool(async (input) => {
    return dispatcher.send({
      ...input,
      priority: input.reply !== "none",
      taskId,
      fromChatId: "chat-a",
      from: botA,
      team: [botA, botB] as never,
    })
  })

  const res = (await tool.execute!(
    {
      target: "Bob",
      message: "Bitte führe Analyse durch",
      mode: "work",
      reply: "resume",
      title: "Datenanalyse",
      done_when: "Ergebnisbericht liegt vor",
    },
    { toolCallId: "call-1", messages: [] }
  )) as { ok: boolean; assignmentId: string; to: string }

  assert.equal(res.ok, true)
  assert.equal(res.to, "Bob")
  assert.ok(res.assignmentId)

  // Prüfen, ob Eintrag in tasks-Tabelle persistiert wurde
  const record = getTask(sqlite, res.assignmentId)
  assert.ok(record)
  assert.equal(record.orbiId, "bot-a")
  assert.equal(record.assignedBotId, "bot-b")
  assert.equal(record.mode, "work")
  assert.equal(record.reply, "resume")
  assert.equal(record.title, "Datenanalyse")
  assert.equal(record.doneWhen, "Ergebnisbericht liegt vor")

  // Bob wurde geweckt
  await new Promise((r) => setTimeout(r, 20))
  assert.ok(getWoken().length >= 1)

  // Status-Check Tool
  const statusTool = createAssignmentStatusTool(async (id) => {
    const t = getTask(sqlite, id)
    if (!t) return { ok: false, error: "Not found" }
    return {
      ok: true,
      id: t.id,
      status: t.status,
      result: t.result,
      answers: t.answers,
      progress: t.progress,
    }
  })

  const checkRes = (await statusTool.execute!(
    { assignmentId: res.assignmentId },
    { toolCallId: "call-2", messages: [] }
  )) as { ok: boolean; status: string }
  assert.equal(checkRes.ok, true)

  sqlite.close()
})

test("HandOff: notify-Modus mit reply none erzeugt keinen Rück-Wake", async () => {
  const { sqlite, dispatcher, lines } = createHandOffTestSetup()

  const taskId = dispatcher.beginTask("chat-a")
  const botA = { id: "bot-a", name: "Alice", avatar: "a", color: null, direct_chat_id: "chat-a" }
  const botB = { id: "bot-b", name: "Bob", avatar: "b", color: null, direct_chat_id: "chat-b" }

  const tool = createHandOffTool(async (input) => {
    return dispatcher.send({
      ...input,
      priority: false, // reply: none -> keine Prioritätsweckung zurück
      taskId,
      fromChatId: "chat-a",
      from: botA,
      team: [botA, botB] as never,
    })
  })

  const res = (await tool.execute!(
    {
      target: "Bob",
      message: "Zur Information: Server ist neugestartet",
      mode: "notify",
      reply: "none",
    },
    { toolCallId: "call-1", messages: [] }
  )) as { ok: boolean; assignmentId: string }

  assert.equal(res.ok, true)
  const record = getTask(sqlite, res.assignmentId)
  assert.equal(record?.mode, "notify")
  assert.equal(record?.reply, "none")

  sqlite.close()
})

test("Gelockerte Limits: sentPerTurn und orbiMessagesPerTask", () => {
  assert.ok(LIMITS.sentPerTurn >= 5)
  assert.ok(LIMITS.orbiMessagesPerTask >= 20)
  assert.ok(LIMITS.activeOrbis >= 6)
  assert.ok(LIMITS.pairWakes >= 4)
})
