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

  const delivered: Array<{ taskId: string; text: string; failed: boolean; botId: string }> = []
  let holdsOpen = 0
  const dispatcher = {
    drain: (chatId: string) => {
      drainedChatId = chatId
    },
    beginTask: (chatId: string) => `dispatch-${chatId}`,
    hold: () => {
      holdsOpen++
      return () => {
        holdsOpen--
      }
    },
    deliverResult: async (input: { taskId: string; text: string; failed: boolean; bot: { id: string } }) => {
      delivered.push({ taskId: input.taskId, text: input.text, failed: input.failed, botId: input.bot.id })
      drainedChatId = input.taskId.replace("dispatch-", "")
      return true
    },
  } as never

  let executedTurnBrief = ""
  let slowTurn = false
  const prompts: string[] = []
  const rootTaskIds: Array<string | undefined> = []
  // Verhalten des nächsten Laufs: Text/Fehler je Runde, optional Hook (z. B. Hinweis mitten im Lauf).
  let scripted: Array<{ text?: string; failed?: boolean; throwStream?: boolean; during?: () => Promise<void> }> = []
  const mockRunTurn = async (options: {
    signal?: AbortSignal
    messages: Array<{ parts: Array<{ type: string; text?: string }> }>
    internal?: { rootTaskId?: string }
    onFinish?: (e: { messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>; isAborted?: boolean; outcome?: { status: string } }) => Promise<void>
  }) => {
    executedTurnBrief = options.messages[0]?.parts[0]?.text ?? ""
    prompts.push(executedTurnBrief)
    rootTaskIds.push(options.internal?.rootTaskId)
    const step = scripted.shift()
    if (step) {
      await step.during?.()
      await options.onFinish?.({
        messages: step.text === undefined ? [] : [{ role: "assistant", parts: [{ type: "text", text: step.text }] }],
        isAborted: false,
        outcome: { status: step.failed ? "failed" : "completed" },
      })
      if (step.throwStream) return new Response(new ReadableStream({ start: (c) => c.error(new Error("Stream abgebrochen")) }))
      return new Response(null)
    }
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
    delivered,
    prompts,
    rootTaskIds,
    holds: () => holdsOpen,
    script: (steps: typeof scripted) => {
      scripted = steps
    },
    getBrief: () => executedTurnBrief,
    setSlowTurn: (v: boolean) => {
      slowTurn = v
    },
  }
}

test("Executor: Task starten, Hintergrundausführung, Eltern wecken mit [task done]", async () => {
  const { db, executor, delivered, holds, getDrained, getBrief } = createTestSetup()

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

  // Das Ergebnis geht über den Dispatcher zurück (echter Wecklink statt nur einer Zeile)
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].failed, false)
  assert.equal(delivered[0].botId, "bot-1")
  assert.ok(delivered[0].text.startsWith("[task done]"))
  assert.ok(delivered[0].text.includes(startRes.taskId!))
  assert.ok(delivered[0].text.includes("Node 24 ist da"))
  assert.equal(getDrained(), "chat-1")
  assert.equal(holds(), 0)

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

test("Executor: fehlgeschlagener Lauf gilt nicht als erledigt und weckt mit Fehler", async () => {
  const { db, executor, delivered, script } = createTestSetup()
  script([{ text: "halbfertig", failed: true }])
  const run = await executor.runTask({ orbiId: "bot-1", parentChatId: "chat-1", brief: "Aufgabe" })
  await new Promise((r) => setTimeout(r, 50))
  const checked = await executor.checkTask(run.taskId!)
  assert.equal(checked.task?.status, "failed")
  assert.equal(delivered.length, 1)
  assert.equal(delivered[0].failed, true)
  assert.match(delivered[0].text, /^\[task failed\]/)
  db.close()
})

test("Executor: Streamfehler und leere Antwort sind Fehler, kein „fertig“", async () => {
  const { db, executor, delivered, script } = createTestSetup()
  script([{ text: "etwas", throwStream: true }])
  const a = await executor.runTask({ orbiId: "bot-1", parentChatId: "chat-1", brief: "A" })
  await new Promise((r) => setTimeout(r, 50))
  assert.equal((await executor.checkTask(a.taskId!)).task?.status, "failed")
  script([{ text: undefined }])
  const b = await executor.runTask({ orbiId: "bot-1", parentChatId: "chat-1", brief: "B" })
  await new Promise((r) => setTimeout(r, 50))
  assert.equal((await executor.checkTask(b.taskId!)).task?.status, "failed")
  assert.equal(delivered.filter((d) => d.failed).length, 2)
  db.close()
})

test("Executor: Hinweis während des Laufs kommt in einer Folgerunde beim Helfer an, Erfolgskriterium steht im Auftrag", async () => {
  const { db, executor, delivered, prompts, rootTaskIds, script } = createTestSetup()
  let taskId = ""
  script([
    { text: "Erstes Ergebnis", during: async () => { await new Promise((r) => setTimeout(r, 10)); await executor.messageTask(taskId, "Bitte Kapitel 3 betonen") } },
    { text: "Zweites Ergebnis mit Kapitel 3" },
  ])
  const run = await executor.runTask({ orbiId: "bot-1", parentChatId: "chat-1", brief: "Fasse zusammen", done_when: "Drei Stichpunkte liegen vor" })
  taskId = run.taskId!
  await new Promise((r) => setTimeout(r, 80))
  assert.equal(prompts.length, 2)
  assert.match(prompts[0], /Fertig, wenn: Drei Stichpunkte liegen vor/)
  assert.match(prompts[1], /Bitte Kapitel 3 betonen/)
  assert.match(prompts[1], /Erstes Ergebnis/)
  assert.equal(delivered.length, 1)
  assert.match(delivered[0].text, /Zweites Ergebnis/)
  // Der Helfer läuft im Dispatcher-Auftrag, nicht unter der eigenen Task-Id
  assert.deepEqual(rootTaskIds, ["dispatch-chat-1", "dispatch-chat-1"])
  db.close()
})
