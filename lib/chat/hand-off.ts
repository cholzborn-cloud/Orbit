import { tool } from "ai"
import { z } from "zod"

import { LIMITS } from "./orbi-message.ts"
import type { TaskMode, TaskReply } from "../work/tasks.ts"

export const HAND_OFF = "hand_off"
export const ASSIGNMENT_STATUS = "assignment_status"

export type HandOffInput = {
  target: string
  message: string
  mode?: TaskMode
  reply?: TaskReply
  title?: string
  done_when?: string
  answers?: string
  rework?: string
  parent_task_id?: string
}

export type HandOffResult =
  | {
      ok: true
      to: string
      linkId: string
      assignmentId?: string
      delivery: "wake" | "queued" | "held" | "group"
      mode?: TaskMode
      reply?: TaskReply
    }
  | { ok: false; error: string }

export type AssignmentStatusResult =
  | {
      ok: true
      id: string
      status: string
      result: string | null
      answers: string | null
      progress: string | null
    }
  | { ok: false; error: string }

// Verhaltensregeln stehen in der Beschreibung (wie bei Grok), damit sie nur gelten, wenn das Werkzeug da ist.
export function createHandOffTool(
  deliver: (input: HandOffInput) => Promise<HandOffResult>
) {
  let sent = 0
  return tool({
    description: `Gibt eine Aufgabe an einen anderen Orbi im Auftragsbaum (Modi work, consult, notify) und wartet nicht. Beende nach dem Senden deinen Turn. Die Antwort weckt dich automatisch, also pollst und wartest du nicht. Nur ein echtes Ergebnis des anderen Orbis beweist seine Mitarbeit. Behaupte nie, er habe etwas geprüft, nur weil du es selbst geprüft hast.`,
    inputSchema: z.object({
      target: z.string().describe("Orbi id or exact name, or a group id."),
      message: z
        .string()
        .max(LIMITS.messageChars)
        .describe("Task description, goal, files, required outcome."),
      mode: z
        .enum(["work", "consult", "notify"])
        .optional()
        .default("work")
        .describe("Mode: work (execute task), consult (ask question/advice), notify (inform without work)."),
      reply: z
        .enum(["resume", "none"])
        .optional()
        .default("resume")
        .describe("Reply: resume (wakes you when finished) or none (fire-and-forget)."),
      title: z.string().optional().describe("Short task or assignment title."),
      done_when: z.string().optional().describe("Success criterion for completion."),
      answers: z.string().optional().describe("Questions to answer if consulting."),
      rework: z.string().optional().describe("Rework instructions if refining a previous outcome."),
      parent_task_id: z.string().optional().describe("Parent task ID if part of a task hierarchy."),
    }),
    execute: async (input): Promise<HandOffResult> => {
      if (sent >= LIMITS.sentPerTurn) {
        return {
          ok: false,
          error: `Limit erreicht: höchstens ${LIMITS.sentPerTurn} Übergaben je Turn.`,
        }
      }
      sent++
      try {
        const result = await deliver(input)
        if (!result.ok) sent--
        return result
      } catch (error) {
        sent--
        throw error
      }
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value: output.ok
        ? `Handed off to ${output.to} (${output.delivery}, assignment ${output.assignmentId ?? output.linkId}). Mode: ${output.mode ?? "work"}, reply: ${output.reply ?? "resume"}.`
        : `Hand off failed: ${output.error}`,
    }),
  })
}

export function createAssignmentStatusTool(
  check: (assignmentId: string, waitMs?: number) => Promise<AssignmentStatusResult>
) {
  return tool({
    description:
      "Query assignment status in the task tree, with optional wait time for long-polling.",
    inputSchema: z.object({
      assignmentId: z.string().min(1).describe("Assignment / task ID to check."),
      waitMs: z
        .number()
        .int()
        .min(0)
        .max(10_000)
        .optional()
        .describe("Milliseconds to wait for completion (long-poll, max 10000ms)."),
    }),
    execute: async ({ assignmentId, waitMs }) => {
      const result = await check(assignmentId, waitMs)
      return result
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value: output.ok
        ? `Assignment ${output.id}: status=${output.status}, result=${output.result ?? "none"}, answers=${output.answers ?? "none"}.`
        : `Assignment check failed: ${output.error}`,
    }),
  })
}
