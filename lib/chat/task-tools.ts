import { tool } from "ai"
import { z } from "zod"

import type { TaskMode, TaskRecord, TaskStatus } from "../work/tasks.ts"
import type { TodoRecord, TodoStatus } from "../work/todos.ts"

export const RUN_TASK = "run_task"
export const CHECK_TASK = "check_task"
export const MESSAGE_TASK = "message_task"
export const STOP_TASKS = "stop_tasks"
export const TODO_WRITE = "todo_write"

export type TaskToolsDeps = {
  runTask: (input: {
    brief: string
    resume?: string
    title?: string
    mode?: TaskMode
    done_when?: string
  }) => Promise<{
    ok: boolean
    taskId?: string
    status?: TaskStatus
    error?: string
  }>
  checkTask: (taskId: string) => Promise<{
    ok: boolean
    task?: TaskRecord | null
    error?: string
  }>
  messageTask: (
    taskId: string,
    message: string
  ) => Promise<{
    ok: boolean
    taskId?: string
    status?: TaskStatus
    error?: string
  }>
  stopTasks: (input: {
    all?: boolean
    taskId?: string
  }) => Promise<{
    ok: boolean
    stoppedCount: number
    stoppedIds: string[]
    error?: string
  }>
  writeTodos: (
    items: Array<{
      id?: string
      text: string
      status?: TodoStatus
    }>
  ) => Promise<{
    ok: boolean
    count: number
    todos: TodoRecord[]
    error?: string
  }>
}

export function createRunTaskTool(deps: Pick<TaskToolsDeps, "runTask">) {
  return tool({
    description: `Startet einen Hintergrund-Helfer für längere Arbeit und gibt die Task-ID zurück. Der Chat bleibt dabei frei. Nimm ihn für alles, was mehr als zwei Runden Werkzeugaufrufe braucht. Sag danach in einem Satz, dass du loslegst, und beende den Turn. Das Ergebnis weckt dich automatisch mit [task done], also wartest du nicht und fragst nicht nach. Der Helfer sieht den Chat nicht. Schreib deshalb in brief das Ziel, das nötige Wissen und die Grenzen, und in done_when, woran man „fertig“ erkennt. Gehört der Auftrag zu einem früheren Helfer, setzt du ihn mit resume fort. Meist laufen ein bis zwei Helfer gleichzeitig, höchstens vier.`,
    inputSchema: z.object({
      brief: z
        .string()
        .min(1)
        .describe("Task description, goal and required output format."),
      resume: z
        .string()
        .optional()
        .describe("Task ID of a previous task to resume or continue."),
      title: z.string().optional().describe("Short title of the task."),
      mode: z
        .enum(["work", "consult", "notify"])
        .optional()
        .describe("Task mode: work, consult or notify."),
      done_when: z
        .string()
        .optional()
        .describe("Success criterion or completion condition."),
    }),
    execute: async (input) => {
      const result = await deps.runTask(input)
      return result
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value: output.ok
        ? `Task ${output.taskId} started (status: ${output.status}).`
        : `Task could not be started: ${output.error}`,
    }),
  })
}

export function createCheckTaskTool(deps: Pick<TaskToolsDeps, "checkTask">) {
  return tool({
    description: `Liest Status, Fortschritt und Ergebnis eines Hintergrund-Helfers. Ruf das nur auf, wenn ein Helfer verdächtig lange nichts meldet. Zum Warten auf das Ergebnis brauchst du es nicht, das Ergebnis weckt dich ohnehin.`,
    inputSchema: z.object({
      taskId: z.string().min(1).describe("Task ID to check."),
    }),
    execute: async ({ taskId }) => {
      const result = await deps.checkTask(taskId)
      return result
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value: output.ok && output.task
        ? `Task ${output.task.id}: status=${output.task.status}, progress=${output.task.progress ?? "none"}, result=${output.task.result ?? "none"}.`
        : `Task not found or check failed: ${output.error}`,
    }),
  })
}

export function createMessageTaskTool(deps: Pick<TaskToolsDeps, "messageTask">) {
  return tool({
    description: `Schickt einem laufenden Hintergrund-Helfer eine Ergänzung oder eine neue Richtung. Nimm das, wenn sich der Auftrag ändert oder Consti etwas nachreicht, statt einen zweiten Helfer zu starten.`,
    inputSchema: z.object({
      taskId: z.string().min(1).describe("Task ID to send update to."),
      message: z
        .string()
        .min(1)
        .describe("New guidance or update for the task."),
    }),
    execute: async ({ taskId, message }) => {
      const result = await deps.messageTask(taskId, message)
      return result
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value: output.ok
        ? `Message sent to task ${output.taskId} (status: ${output.status}).`
        : `Failed to message task: ${output.error}`,
    }),
  })
}

export function createStopTasksTool(deps: Pick<TaskToolsDeps, "stopTasks">) {
  return tool({
    description: `Stoppt Hintergrund-Helfer. Mit all=true stoppst du alle laufenden Helfer dieses Orbis, mit taskId einen bestimmten. Sagt Consti „stopp“ oder etwas Gleichbedeutendes, ist stop_tasks mit all=true dein allererster Aufruf, noch vor jeder Antwort.`,
    inputSchema: z.object({
      all: z
        .boolean()
        .optional()
        .describe("Set to true to stop all running background tasks."),
      taskId: z
        .string()
        .optional()
        .describe("Specific task ID to stop."),
    }),
    execute: async (input) => {
      const result = await deps.stopTasks(input)
      return result
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value: output.ok
        ? `Stopped ${output.stoppedCount} task(s): ${output.stoppedIds.join(", ")}.`
        : `Stop failed: ${output.error}`,
    }),
  })
}

export function createTodoWriteTool(deps: Pick<TaskToolsDeps, "writeTodos">) {
  return tool({
    description: `Pflegt die Aufgabenliste dieses Chats als Warteschlange. Trag einen Auftrag zuerst ein und schick ihn dann los. Auf done setzt du ihn erst, wenn Consti das Ergebnis bekommen hat. Gleich die Liste bei jeder neuen Nachricht von Consti und bei jeder Rückkehr eines Helfers ab.`,
    inputSchema: z.object({
      todos: z
        .array(
          z.object({
            id: z.string().optional().describe("Existing todo ID to update."),
            text: z.string().min(1).describe("Todo item description."),
            status: z
              .enum(["todo", "in_progress", "done", "cancelled"])
              .optional()
              .describe("Status of the todo item."),
          })
        )
        .describe("List of todos to save."),
    }),
    execute: async ({ todos }) => {
      const result = await deps.writeTodos(todos)
      return result
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value: output.ok
        ? `Updated ${output.count} todo(s).`
        : `Failed to update todos: ${output.error}`,
    }),
  })
}

export function createTaskTools(deps: TaskToolsDeps) {
  return {
    [RUN_TASK]: createRunTaskTool(deps),
    [CHECK_TASK]: createCheckTaskTool(deps),
    [MESSAGE_TASK]: createMessageTaskTool(deps),
    [STOP_TASKS]: createStopTasksTool(deps),
    [TODO_WRITE]: createTodoWriteTool(deps),
  }
}
