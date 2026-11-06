import assert from "node:assert/strict"
import test from "node:test"

import { openDatabase } from "@/lib/db/client"
import { createTaskExecutor } from "./executor"
import type { ServiceEvent } from "../events"
import type { TurnRuntime } from "./turn"

function createTestSetup() {
  const db = openDatabase(":memory:")
  const sqlite = db.$client

  sqlite
    .prepare(
      `INSERT INTO bots (id, user_id, third_party_id, name, avatar, job)
       VALUES ('bot-1', 'local', 'tp-1', 'Freddy', 'bot', 'Assistant'),
              ('bot-2', 'local', 'tp-2', 'Rex', 'bot', 'Researcher')`
    )
    .run()
  sqlite
    .prepare(
      `INSERT INTO chats (id, user_id, kind, name)
       VALUES ('chat-1', 'local', 'direct', 'Chat 1'),
              ('chat-2', 'local', 'direct', 'Chat 2')`
    )
    .run()

  const events: ServiceEvent[] = []
  const linesAppended: Array<{ chatId: string; line: unknown }> = []
  let drainedChatId: string | null = null

  const store = {
    appendLine: async (chatId: string, line: unknown) => {
      linesAppended.push({ chatId, line })
      return "line-1"
    },
    patchLine: async () => null,
  } as never

  const dispatcher = {
    drain: (chatId: string) => {
      drainedChatId = chatId
    },
  } as never

  let executedTurnBrief = ""
  let slowTurn = false
  const mockRunTurn = async (options: {
    signal?: AbortSignal
    messages: Array<{ parts: Array<{ type: string; text?: string }> }>
    onFinish?: (e: { messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }> }) => Promise<void>
  }) => {
    executedTurnBrief = options.messages[0]?.parts[0]?.text ?? ""
    if (slowTurn) {
      await new Promise<void>((resolve) => {
        if (options.signal?.aborted) return resolve()
        options.signal?.addEventListener("abort", () => resolve(), { once: true })
      })
    }
    if (options.onFinish) {
      await options.onFinish({
        messages: [
          {
            role: "assistant",
            parts: [{ type: "text", text: "Ergebnis der Recherche: Node 24 ist da." }],
          },
        ],
      })
    }
    return new Response(null)
  }

  const runtime: TurnRuntime = {
    manager: {} as never,
    approvalStore: {} as never,
    dispatcher: {} as never,
    queue: new Map(),
    status: () => {},
    publish: (e) => events.push(e),
  }

  const executor = createTaskExecutor({
    getDb: () => sqlite,
    store,
    dispatcher,
    publish: (e) => events.push(e),
    runTurn: mockRunTurn as never,
    runtime,
  })

  return {
    db: sqlite,
    executor,
    events,
    linesAppended,
    getDrained: () => drainedChatId,
    getBrief: () => executedTurnBrief,
    setSlowTurn: (v: boolean) => {
      slowTurn = v
    },
  }
}

test("Executor: Task starten, Hintergrundausführung, Eltern wecken mit [task done]", async () => {
  const { db, executor, events, linesAppended, getDrained, getBrief } = createTestSetup()

  // 1. Task starten
  const startRes = await executor.runTask({
    orbiId: "bot-1",
    parentChatId: "chat-1",
    brief: "Recherchiere Node 24 Release Notes",
    title: "Node 24",
    mode: "work",
  })

  assert.equal(startRes.ok, true)
  assert.ok(startRes.taskId)
  assert.equal(startRes.status, "running")

  // Kurz warten, damit asynchroner Hintergrundlauf durchläuft
  await new Promise((r) => setTimeout(r, 50))

  assert.equal(getBrief(), "Recherchiere Node 24 Release Notes")

  // Prüfen, ob Task in DB auf "done" gewechselt ist
  const checked = await executor.checkTask(startRes.taskId!)
  assert.equal(checked.ok, true)
  assert.equal(checked.task?.status, "done")
  assert.ok(checked.task?.result?.includes("Node 24 ist da"))

  // Prüfen, ob Eltern-Orbi mit [task done] geweckt wurde
  assert.ok(linesAppended.length >= 1)
  const line = linesAppended[0].line as { text: string; kind: string }
  assert.equal(line.kind, "reply")
  assert.ok(line.text.startsWith("[task done]"))
  assert.ok(line.text.includes(startRes.taskId!))
  assert.ok(line.text.includes("Node 24 ist da"))
  assert.equal(getDrained(), "chat-1")

  db.close()
})

test("Executor: checkTask, messageTask und stopTasks", async () => {
  const { db, executor, setSlowTurn } = createTestSetup()
  setSlowTurn(true)

  const startRes = await executor.runTask({
    orbiId: "bot-1",
    parentChatId: "chat-1",
    brief: "Lange Aufgabe",
    title: "Langläufer",
  })
  const taskId = startRes.taskId!

  // messageTask
  const msgRes = await executor.messageTask(taskId, "Bitte fokussiere auf Kapitel 3")
  assert.equal(msgRes.ok, true)

  // stopTasks (einzeln)
  const stopOne = await executor.stopTasks({ taskId })
  assert.equal(stopOne.ok, true)
  assert.equal(stopOne.stoppedCount, 1)

  // checkTask
  const checked = await executor.checkTask(taskId)
  assert.equal(checked.task?.status, "stopped")

  // Mehrere Tasks starten und alle stoppen
  await executor.runTask({ orbiId: "bot-1", parentChatId: "chat-1", brief: "Task A" })
  await executor.runTask({ orbiId: "bot-1", parentChatId: "chat-1", brief: "Task B" })

  const stopAll = await executor.stopTasks({ all: true, orbiId: "bot-1" })
  assert.equal(stopAll.ok, true)
  assert.equal(stopAll.stoppedCount, 2)

  // Asynchrone Abort-Verarbeitung abklingen lassen
  await new Promise((r) => setTimeout(r, 25))

  db.close()
})

test("Executor: Todos verwalten", async () => {
  const { db, executor } = createTestSetup()

  const written = await executor.writeTodos("chat-1", "bot-1", [
    { text: "Erster Schritt", status: "todo" },
    { text: "Zweiter Schritt", status: "in_progress" },
  ])
  assert.equal(written.ok, true)
  assert.equal(written.count, 2)

  const listed = executor.listTodos("chat-1")
  assert.equal(listed.length, 2)
  assert.equal(listed[0].content, "Erster Schritt")

  db.close()
})
