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

  // Parent-Orbi als Ref für den Rückweg (Name und Farbe stehen in der Datenbank).
  function botRef(db: Database.Database, id: string) {
    const row = db.prepare("select id, name, avatar, color from bots where id = ?").get(id) as
      | { id: string; name: string; avatar: string; color: string | null }
      | undefined
    return row ?? { id, name: "Orbi", avatar: "bot", color: null }
  }

  async function executeBackground(
    task: TaskRecord,
    workRunId: string,
    signal: AbortSignal
  ) {
    const db = deps.getDb()
    // Der Helfer läuft in einem echten Dispatcher-Auftrag: nur so kann er selbst übergeben oder schreiben (früher: „Auftrag abgebrochen“),
    // und sein Ergebnis weckt den Elternchat über denselben Weg wie jede Antwort.
    const dispatchTaskId = deps.dispatcher.beginTask(task.parentChatId)
    const releaseHold = deps.dispatcher.hold(dispatchTaskId)
    try {
      const modelInfo = deps.ownModel
        ? await deps.ownModel(task.parentChatId)
        : { model: "claude-3-7-sonnet-20250219", effort: undefined }

      // Custom Runtime für Task-Fortschritt
      const taskRuntime: TurnRuntime = {
        ...deps.runtime,
        // Der Helfer sichert seine Zwischenstände nicht in den Elternchat: Sonst standen seine halben Antworten samt Werkzeugteilen
        // als eigene Nachrichten im Verlauf (beobachtet 08.11.2026), zusätzlich zum Ergebnis, das der Elternchat selbst meldet.
        checkpoint: undefined,
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

      // Erfolgskriterium gehört in den Auftrag selbst (war nur gespeichert, nie beim Helfer).
      const withCriteria = (text: string) =>
        task.doneWhen ? `${text}\n\nFertig, wenn: ${task.doneWhen}\nMelde am Ende ausdrücklich, ob das erreicht ist; wenn nicht, was fehlt.` : text

      let prompt = withCriteria(task.brief)
      let result = ""
      let failure: string | undefined
      // Hinweise, die während des Laufs ankamen, bekommt der Helfer in einer Folgerunde (höchstens 3).
      for (let round = 0; round < 4; round++) {
        let roundText = ""
        let roundFailed: string | undefined
        const response = await deps.runTurn({
          chatId: task.parentChatId,
          messages: [{ id: randomUUID(), role: "user", parts: [{ type: "text", text: prompt }] }] as UIMessage<ChatMetadata>[],
          clientData: {
            model: modelInfo.model,
            effort: modelInfo.effort,
            context: false,
            botId: task.orbiId,
          },
          internal: {
            background: true, // Verhindert ask_user, say, react im Hintergrundlauf
            rootTaskId: dispatchTaskId,
            rootChatId: task.parentChatId,
          },
          signal,
          runtime: taskRuntime,
          onFinish: async (event) => {
            roundText = finalAnswerText(event.messages)
            if (!event.isAborted && event.outcome?.status === "failed") roundFailed = "Der Lauf ist fehlgeschlagen."
          },
        })

        // Den Antwort-Stream konsumieren, bis der Turn fertig ist; Streamfehler zählen als Fehler (früher verschluckt)
        if (response.body) {
          await response.body.pipeTo(new WritableStream()).catch((error) => {
            if (!signal.aborted) roundFailed = roundFailed ?? (error instanceof Error ? error.message : String(error))
          })
        }
        if (signal.aborted) break
        result = roundText.trim()
        failure = roundFailed
        const notes = messagesQueue.get(task.id) ?? []
        messagesQueue.delete(task.id)
        if (!notes.length || failure) break
        updateTaskProgress(db, task.id, "Ergänzung wird berücksichtigt")
        prompt = withCriteria(
          `${task.brief}\n\nDein bisheriges Ergebnis:\n${result || "(keines)"}\n\nWährend du gearbeitet hast, kamen Ergänzungen. Berücksichtige sie und liefere das vollständige, aktualisierte Ergebnis:\n${notes.map((n) => `- ${n}`).join("\n")}`
        )
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

      // Nur ein Lauf mit Ergebnis gilt als erledigt; Fehler oder leere Antwort sind ehrlich „fehlgeschlagen“.
      if (failure || !result) {
        const reason = failure ?? "Der Helfer hat kein Ergebnis geliefert."
        await failTask(task, workRunId, reason, dispatchTaskId)
        return
      }
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
        await wakeParent(task, dispatchTaskId, `[task done] Task ${task.id}${task.title ? ` (${task.title})` : ""}: ${result}`, false)
      }
    } catch (error) {
      await failTask(task, workRunId, error instanceof Error ? error.message : String(error), dispatchTaskId)
    } finally {
      releaseHold()
      controllers.delete(task.id)
      messagesQueue.delete(task.id)
    }
  }

  async function failTask(task: TaskRecord, workRunId: string, reason: string, dispatchTaskId: string) {
    const db = deps.getDb()
    finishTask(db, task.id, "failed", reason)
    finishRun(db, workRunId, "failed", reason)
    deps.publish({
      type: "task",
      action: "failed",
      taskId: task.id,
      chatId: task.parentChatId,
      botId: task.orbiId,
      status: "failed",
    })
    // Auch ein Fehler kommt zurück: der Elternchat erfährt es und sagt es Consti, statt dass der Auftrag still verschwindet.
    if (task.reply !== "none")
      await wakeParent(task, dispatchTaskId, `[task failed] Task ${task.id}${task.title ? ` (${task.title})` : ""}: failed: ${reason}`, true)
  }

  async function wakeParent(task: TaskRecord, dispatchTaskId: string, text: string, failed: boolean) {
    try {
      const db = deps.getDb()
      const delivered = await deps.dispatcher.deliverResult({
        taskId: dispatchTaskId,
        bot: botRef(db, task.orbiId),
        helper: { id: `helper:${task.id}`, name: "Helfer", avatar: "bot", color: null },
        text,
        failed,
      })
      if (!delivered) console.error("Ergebnis des Helfers nicht zugestellt: Auftrag wurde abgebrochen.")
    } catch (err) {
      console.error("Konnte Eltern-Orbi nicht mit dem Ergebnis wecken:", err)
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
