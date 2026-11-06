import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type { UIMessage } from "ai"

import type { ChatMetadata } from "@/lib/chat-catalog"
import { finalAnswerText, lineMessage, makeToken, type LinePeer, type OrbiLine } from "@/lib/chat/orbi-message"
import {
  countActiveTasks,
  createTask,
  finishTask,
  getActiveTasks,
  getTask,
  listTasks,
  setTaskStatus,
  stopAllTasks,
  stopTask,
  stopTasksForOrbi,
  updateTaskProgress,
  type TaskMode,
  type TaskRecord,
  type TaskStatus,
} from "@/lib/work/tasks"
import { listTodos, writeTodos, type TodoRecord, type TodoStatus } from "@/lib/work/todos"
import { finishRun, startRun } from "@/lib/work/runs"
import type { ServiceEvent } from "../events"
import type { Dispatcher } from "./dispatcher"
import type { createMessageStore } from "./store"
import type { runTurn, TurnRuntime } from "./turn"

const MAX_ACTIVE_PER_ORBI = 4 // weiche Obergrenze nach Plan (1-2 aktiv, 4 weich)

export type ExecutorDeps = {
  getDb: () => Database.Database
  store: ReturnType<typeof createMessageStore>
  dispatcher: Dispatcher
  publish: (event: ServiceEvent) => void
  runTurn: typeof runTurn
  runtime: TurnRuntime
  ownModel?: (chatId: string) => Promise<{ model: string; effort?: string }>
}

export function createTaskExecutor(deps: ExecutorDeps) {
  const controllers = new Map<string, AbortController>()
  const messagesQueue = new Map<string, string[]>()

  async function runTask(input: {
    orbiId: string
    parentChatId: string
    brief: string
    resume?: string
    title?: string
    mode?: TaskMode
    done_when?: string
  }): Promise<{
    ok: boolean
    taskId?: string
    status?: TaskStatus
    error?: string
  }> {
    const db = deps.getDb()
    const active = countActiveTasks(db, input.orbiId)
    if (active >= MAX_ACTIVE_PER_ORBI) {
      return {
        ok: false,
        error: `Limit erreicht: höchstens ${MAX_ACTIVE_PER_ORBI} gleichzeitige Hintergrund-Helfer je Orbi.`,
      }
    }

    let brief = input.brief.trim()
    let resumeRecord: TaskRecord | null = null
    if (input.resume) {
      resumeRecord = getTask(db, input.resume)
      if (resumeRecord) {
        brief = `Fortsetzung von Aufgabe ${resumeRecord.id} (${resumeRecord.title || "ohne Titel"}):\nVorheriges Ergebnis: ${resumeRecord.result ?? "keines"}\n\nNeuer Auftrag: ${brief}`
      }
    }

    const task = createTask(
      db,
      {
        orbiId: input.orbiId,
        parentChatId: input.parentChatId,
        brief,
        title: input.title,
        mode: input.mode ?? "work",
        reply: "resume",
        status: "running",
        resumeOf: input.resume,
        doneWhen: input.done_when,
      },
      Date.now()
    )

    const workRunId = startRun(
      db,
      {
        kind: "task",
        chatId: input.parentChatId,
        botId: input.orbiId,
        payload: {
          taskId: task.id,
          brief: task.brief,
          mode: task.mode,
          rootChatId: input.parentChatId,
        },
      },
      Date.now()
    )

    const controller = new AbortController()
    controllers.set(task.id, controller)

    deps.publish({
      type: "task",
      action: "start",
      taskId: task.id,
      chatId: task.parentChatId,
      botId: task.orbiId,
      title: task.title,
      brief: task.brief,
      status: "running",
    })

    // Asynchron im Hintergrund ausführen (blockiert den Chat nicht)
    void executeBackground(task, workRunId, controller.signal)

    return { ok: true, taskId: task.id, status: "running" }
  }

  async function executeBackground(
    task: TaskRecord,
    workRunId: string,
    signal: AbortSignal
  ) {
    const db = deps.getDb()
    try {
      const modelInfo = deps.ownModel
        ? await deps.ownModel(task.parentChatId)
        : { model: "claude-3-7-sonnet-20250219", effort: undefined }

      let finalResultText = ""
      const syntheticMessages: UIMessage<ChatMetadata>[] = [
        {
          id: randomUUID(),
          role: "user",
          parts: [{ type: "text", text: task.brief }],
        },
      ]

      // Custom Runtime für Task-Fortschritt
      const taskRuntime: TurnRuntime = {
        ...deps.runtime,
        publish: (event) => {
          if (event.type === "status-step") {
            updateTaskProgress(db, task.id, event.label)
            deps.publish({
              type: "task",
              action: "progress",
              taskId: task.id,
              chatId: task.parentChatId,
              botId: task.orbiId,
              progress: event.label,
              status: "running",
            })
          }
          deps.runtime.publish?.(event)
        },
      }

      const response = await deps.runTurn({
        chatId: task.parentChatId,
        messages: syntheticMessages,
        clientData: {
          model: modelInfo.model,
          effort: modelInfo.effort,
          context: false,
          botId: task.orbiId,
        },
        internal: {
          background: true, // Verhindert ask_user, say, react im Hintergrundlauf
          rootTaskId: task.id,
          rootChatId: task.parentChatId,
        },
        signal,
        runtime: taskRuntime,
        onFinish: async (event) => {
          finalResultText = finalAnswerText(event.messages)
        },
      })

      // Den Antwort-Stream konsumieren, bis der Turn fertig ist
      if (response.body) {
        await response.body.pipeTo(new WritableStream()).catch(() => {})
      }

      if (signal.aborted) {
        finishTask(db, task.id, "stopped", "Abgebrochen")
        finishRun(db, workRunId, "failed", "Abgebrochen")
        deps.publish({
          type: "task",
          action: "stopped",
          taskId: task.id,
          chatId: task.parentChatId,
          botId: task.orbiId,
          status: "stopped",
        })
        return
      }

      const result = finalResultText.trim() || "Aufgabe ohne Rückgabetext abgeschlossen."
      finishTask(db, task.id, "done", result)
      finishRun(db, workRunId, "done")

      deps.publish({
        type: "task",
        action: "done",
        taskId: task.id,
        chatId: task.parentChatId,
        botId: task.orbiId,
        title: task.title,
        status: "done",
      })

      // Eltern-Orbi wecken mit [task done]
      if (task.reply !== "none") {
        await wakeParentWithTaskDone(task, result)
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error)
      finishTask(db, task.id, "failed", errMsg)
      finishRun(db, workRunId, "failed", errMsg)
      deps.publish({
        type: "task",
        action: "failed",
        taskId: task.id,
        chatId: task.parentChatId,
        botId: task.orbiId,
        status: "failed",
      })
    } finally {
      controllers.delete(task.id)
    }
  }

  async function wakeParentWithTaskDone(task: TaskRecord, result: string) {
    const token = makeToken()
    const taskTitle = task.title ? ` (${task.title})` : ""
    const lineText = `[task done] Task ${task.id}${taskTitle}: ${result}`

    const botPeer: LinePeer = {
      id: task.orbiId,
      name: "Helfer",
      avatar: "bot",
      color: null,
    }

    const line: OrbiLine = {
      v: 1,
      linkId: randomUUID(),
      direction: "in",
      kind: "reply",
      peer: botPeer,
      text: lineText,
      priority: true,
      status: "fertig",
      token,
      rootTaskId: task.id,
      createdAt: Date.now(),
    }

    try {
      const msgId = await deps.store.appendLine(task.parentChatId, line)
      deps.publish({
        type: "orbi-message",
        chatId: task.parentChatId,
        messageId: msgId,
        linkId: line.linkId,
        direction: line.direction,
        kind: line.kind,
        status: line.status,
        queued: false,
        held: false,
      })

      // Wecken über den Dispatcher oder Drain
      void deps.dispatcher.drain(task.parentChatId)
    } catch (err) {
      console.error("Konnte Eltern-Orbi nicht mit [task done] wecken:", err)
    }
  }

  async function checkTask(taskId: string): Promise<{
    ok: boolean
    task?: TaskRecord | null
    error?: string
  }> {
    const db = deps.getDb()
    const task = getTask(db, taskId)
    if (!task) return { ok: false, error: "Aufgabe nicht gefunden." }
    return { ok: true, task }
  }

  async function messageTask(
    taskId: string,
    message: string
  ): Promise<{
    ok: boolean
    taskId?: string
    status?: TaskStatus
    error?: string
  }> {
    const db = deps.getDb()
    const task = getTask(db, taskId)
    if (!task) return { ok: false, error: "Aufgabe nicht gefunden." }
    if (!["queued", "running", "waiting"].includes(task.status)) {
      return {
        ok: false,
        error: `Aufgabe ist bereits im Zustand „${task.status}“.`,
      }
    }

    const q = messagesQueue.get(taskId) ?? []
    q.push(message)
    messagesQueue.set(taskId, q)

    updateTaskProgress(db, taskId, `Nachricht empfangen: ${message.slice(0, 40)}`)

    return { ok: true, taskId, status: task.status }
  }

  async function stopTasks(input: {
    all?: boolean
    taskId?: string
    orbiId?: string
    chatId?: string
  }): Promise<{
    ok: boolean
    stoppedCount: number
    stoppedIds: string[]
    error?: string
  }> {
    const db = deps.getDb()
    const stoppedIds: string[] = []

    if (input.taskId) {
      const controller = controllers.get(input.taskId)
      if (controller) {
        controller.abort()
        controllers.delete(input.taskId)
      }
      const ok = stopTask(db, input.taskId)
      if (ok) stoppedIds.push(input.taskId)
    } else if (input.all) {
      if (input.orbiId) {
        const ids = stopTasksForOrbi(db, input.orbiId)
        for (const id of ids) {
          controllers.get(id)?.abort()
          controllers.delete(id)
          stoppedIds.push(id)
        }
      } else {
        const ids = stopAllTasks(db, input.chatId ? { parentChatId: input.chatId } : undefined)
        for (const id of ids) {
          controllers.get(id)?.abort()
          controllers.delete(id)
          stoppedIds.push(id)
        }
      }
    }

    for (const id of stoppedIds) {
      deps.publish({
        type: "task",
        action: "stopped",
        taskId: id,
        chatId: input.chatId ?? "",
        botId: input.orbiId ?? "",
        status: "stopped",
      })
    }

    return { ok: true, stoppedCount: stoppedIds.length, stoppedIds }
  }

  async function handleWriteTodos(
    chatId: string,
    botId: string,
    items: Array<{ id?: string; text: string; status?: TodoStatus }>
  ): Promise<{
    ok: boolean
    count: number
    todos: TodoRecord[]
    error?: string
  }> {
    const db = deps.getDb()
    const mapped = items.map((i) => ({
      id: i.id,
      content: i.text,
      status: i.status,
    }))
    const todos = writeTodos(db, chatId, botId, mapped)
    return { ok: true, count: todos.length, todos }
  }

  function handleListTodos(chatId: string): TodoRecord[] {
    const db = deps.getDb()
    return listTodos(db, chatId)
  }

  function getActive(orbiId?: string): TaskRecord[] {
    const db = deps.getDb()
    return getActiveTasks(db, orbiId)
  }

  function list(filter?: {
    orbiId?: string
    parentChatId?: string
    status?: TaskStatus | TaskStatus[]
  }): TaskRecord[] {
    const db = deps.getDb()
    return listTasks(db, filter)
  }

  return {
    runTask,
    checkTask,
    messageTask,
    stopTasks,
    writeTodos: handleWriteTodos,
    listTodos: handleListTodos,
    getActive,
    list,
  }
}

export type TaskExecutor = ReturnType<typeof createTaskExecutor>
