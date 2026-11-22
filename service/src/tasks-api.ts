import { getDatabase } from "@/lib/db/client"
import {
  countActiveTasks,
  getActiveTasks,
  getTask,
  listTasks,
  stopAllTasks,
  stopTask,
  stopTasksForOrbi,
  type TaskRecord,
  type TaskStatus,
} from "@/lib/work/tasks"
import {
  clearCompletedTodos,
  listTodos,
  writeTodos,
  type TodoRecord,
  type TodoStatus,
} from "@/lib/work/todos"

export function listTasksRoute(query: URLSearchParams) {
  const db = getDatabase().$client
  const orbiId = query.get("orbiId") ?? undefined
  const parentChatId = query.get("parentChatId") ?? query.get("chatId") ?? undefined
  const statusParam = query.get("status")
  const status = statusParam ? (statusParam.split(",") as TaskStatus[]) : undefined
  const parentTaskId = query.get("parentTaskId") ?? undefined

  const tasks = listTasks(db, {
    orbiId,
    parentChatId,
    status,
    parentTaskId,
  })
  return { ok: true, tasks }
}

export function activeTasksRoute(query: URLSearchParams) {
  const db = getDatabase().$client
  const orbiId = query.get("orbiId") ?? undefined
  const active = getActiveTasks(db, orbiId)
  return { ok: true, active }
}

export function getTaskRoute(id: string) {
  const db = getDatabase().$client
  const task = getTask(db, id)
  if (!task) return { ok: false, error: "Aufgabe nicht gefunden." }
  return { ok: true, task }
}

// Stoppt über den Executor: bricht laufende Helfer wirklich ab und sendet das Ereignis `task` (stopped).
export type TaskStopper = (input: {
  all?: boolean
  taskId?: string
  orbiId?: string
  chatId?: string
}) => Promise<{ stoppedIds: string[] }>

export async function stopTaskRoute(id: string, body?: unknown, stop?: TaskStopper) {
  if (stop && (await stop({ taskId: id })).stoppedIds.includes(id))
    return { ok: true, taskId: id, stopped: true, status: "stopped" }
  const db = getDatabase().$client
  const reason =
    body && typeof body === "object" && "reason" in body
      ? String((body as { reason?: unknown }).reason ?? "")
      : undefined
  const stopped = stopTask(db, id, reason)
  if (!stopped) {
    const existing = getTask(db, id)
    if (!existing) return { ok: false, error: "Aufgabe nicht gefunden." }
    return { ok: true, taskId: id, status: existing.status, stopped: false }
  }
  const task = getTask(db, id)
  return { ok: true, taskId: id, stopped: true, status: task?.status ?? "stopped" }
}

export async function stopAllTasksRoute(body?: unknown, stop?: TaskStopper) {
  const db = getDatabase().$client
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const orbiId = typeof b.orbiId === "string" ? b.orbiId : undefined
  const chatId = typeof b.chatId === "string" ? b.chatId : undefined
  if (stop) {
    const { stoppedIds } = await stop({ all: true, orbiId, chatId })
    return { ok: true, stoppedCount: stoppedIds.length, stoppedIds }
  }

  let stoppedIds: string[] = []
  if (orbiId) {
    stoppedIds = stopTasksForOrbi(db, orbiId)
  } else {
    stoppedIds = stopAllTasks(db, chatId ? { parentChatId: chatId } : undefined)
  }
  return { ok: true, stoppedCount: stoppedIds.length, stoppedIds }
}

export function listTodosRoute(chatId: string) {
  const db = getDatabase().$client
  const todos = listTodos(db, chatId)
  return { ok: true, todos }
}

export function writeTodosRoute(chatId: string, body?: unknown) {
  const db = getDatabase().$client
  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const botId = typeof b.botId === "string" ? b.botId : "local"
  const rawItems = Array.isArray(b.items)
    ? (b.items as Array<Record<string, unknown>>)
    : Array.isArray(b.todos)
      ? (b.todos as Array<Record<string, unknown>>)
      : []

  const items = rawItems.map((item) => ({
    id: typeof item.id === "string" ? item.id : undefined,
    content: typeof item.content === "string" ? item.content : String(item.text ?? ""),
    status: (item.status as TodoStatus) ?? "todo",
    taskId: typeof item.taskId === "string" ? item.taskId : undefined,
  }))

  const todos = writeTodos(db, chatId, botId, items)
  return { ok: true, count: todos.length, todos }
}

export function clearCompletedTodosRoute(chatId: string) {
  const db = getDatabase().$client
  const cleared = clearCompletedTodos(db, chatId)
  return { ok: true, cleared }
}
