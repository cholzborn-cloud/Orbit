import { tool, type ToolSet } from "ai"
import { z } from "zod"

import {
  automationInput,
  nextRun,
  scheduleSchema,
} from "../automations/schedule.ts"
import { checkAutomationLimits } from "../automations/limits.ts"
import { defaultSql, type ChatContext } from "./load-chat.ts"
import { getDatabase } from "../db/client.ts"
import { recordUndo } from "../db/undo-store.ts"

// Nur mit Nutzer am Chat (nicht in Gruppen und nicht in Hintergrund-Automationen); gilt für Trigger und lokalen Dienst.
export function automationCreateTool(ctx: ChatContext) {
  const bot = ctx.speaker
  return tool({
    description:
      'Create a scheduled automation or routine immediately without confirmation. schedule is an object: {kind: daily|weekdays|weekly|monthly|once, at: "HH:MM", weekday?, day?, date?}. Europe/Berlin.',
    inputSchema: z.object({
      name: z.string().describe("Name of the routine"),
      prompt: z.string().describe("Task description to execute when routine triggers"),
      schedule: scheduleSchema.describe("Schedule: once, daily, weekdays, weekly or monthly"),
      target: z.enum(["same", "new"]).optional().describe("same = this chat, new = separate chat"),
    }),
    execute: async (input) => {
      const parsed = automationInput.safeParse({
        ...input,
        timezone: "Europe/Berlin",
        notify: "app",
      })
      if (!parsed.success)
        return {
          ok: false,
          error: `Bitte prüfe Name, Aufgabe und Zeitplan: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
        }
      const sql = defaultSql()
      if (!sql) return { ok: false, error: "Automationen sind gerade nicht verfügbar." }
      const rows =
        (await sql`select schedule, enabled from automations where bot_id = ${bot.id} and deleted_at is null`) as {
          schedule: unknown
          enabled: unknown
        }[]
      const existing = rows.map((row) => {
        let schedule = row.schedule
        if (typeof schedule === "string")
          try {
            schedule = JSON.parse(schedule)
          } catch {
            /* unlesbar: zählt ohne Uhrzeit */
          }
        return { schedule, enabled: row.enabled === true || row.enabled === 1 }
      })
      const tooMany = checkAutomationLimits(existing, parsed.data.schedule)
      if (tooMany) return { ok: false, error: tooMany }
      const at = nextRun(parsed.data.schedule, parsed.data.timezone, new Date())
      if (!at)
        return {
          ok: false,
          error: "Für diesen Zeitplan wurde kein nächster Lauf gefunden.",
        }
      const chatId = parsed.data.target === "same" ? bot.direct_chat_id : null
      const id = crypto.randomUUID()
      await sql`insert into automations (id, user_id, bot_id, name, prompt, schedule, timezone, target, chat_id, notify, next_run_at, enabled) values (${id}, ${ctx.userId}, ${bot.id}, ${parsed.data.name}, ${parsed.data.prompt}, ${JSON.stringify(parsed.data.schedule)}, ${parsed.data.timezone}, ${parsed.data.target}, ${chatId}, 'app', ${at}, true)`

      try {
        recordUndo(getDatabase().$client, {
          kind: "routine",
          entityId: id,
          action: "create",
          detail: `Routine „${parsed.data.name}“ angelegt`,
          previousState: null,
        })
      } catch {
        /* Undo-Protokollierung optional */
      }

      return {
        ok: true,
        id,
        message: `„${parsed.data.name}“ ist angelegt. Nächster Lauf: ${at.toLocaleString("de-DE")}. (Rückgängig möglich)`,
      }
    },
  })
}

export function updateRoutineTool(ctx: ChatContext) {
  const bot = ctx.speaker
  return tool({
    description:
      "Read, list, update, pause, resume or delete/archive a routine/automation. Changes take effect immediately and can be undone.",
    inputSchema: z.object({
      action: z
        .enum(["read", "list", "update", "pause", "resume", "delete"])
        .describe("read = details of one, list = all routines, update = change fields, pause/resume = toggle, delete = archive"),
      id: z.string().optional().describe("Routine id (required for read, update, pause, resume, delete)"),
      name: z.string().optional().describe("New routine name"),
      prompt: z.string().optional().describe("New task description"),
      schedule: scheduleSchema.optional().describe("New schedule object"),
      enabled: z.boolean().optional().describe("Enable or disable routine"),
    }),
    execute: async (input) => {
      const sql = defaultSql()
      if (!sql) return { ok: false, error: "Automationen sind gerade nicht verfügbar." }

      if (input.action === "list") {
        const rows = (await sql`
          select id, name, prompt, schedule, enabled, next_run_at as nextRunAt
          from automations
          where bot_id = ${bot.id} and deleted_at is null
          order by created_at desc
        `) as Array<{
          id: string
          name: string
          prompt: string
          schedule: unknown
          enabled: number | boolean
          nextRunAt: number | null
        }>
        return {
          ok: true,
          routines: rows.map((r) => ({
            id: r.id,
            name: r.name,
            prompt: r.prompt,
            schedule: typeof r.schedule === "string" ? JSON.parse(r.schedule) : r.schedule,
            enabled: Boolean(r.enabled),
            nextRun: r.nextRunAt ? new Date(r.nextRunAt).toLocaleString("de-DE") : null,
          })),
        }
      }

      if (!input.id) {
        return { ok: false, error: "Für diese Aktion ist eine routine id erforderlich." }
      }

      const [existing] = (await sql`
        select id, name, prompt, schedule, timezone, enabled, target, chat_id as chatId
        from automations
        where id = ${input.id} and deleted_at is null
      `) as Array<{
        id: string
        name: string
        prompt: string
        schedule: unknown
        timezone: string
        enabled: number | boolean
        target: string
        chatId: string | null
      }>

      if (!existing) {
        return { ok: false, error: `Routine ${input.id} nicht gefunden.` }
      }

      const previousState = {
        name: existing.name,
        prompt: existing.prompt,
        schedule: typeof existing.schedule === "string" ? JSON.parse(existing.schedule) : existing.schedule,
        enabled: Boolean(existing.enabled),
        deleted: false,
      }

      if (input.action === "read") {
        return {
          ok: true,
          routine: {
            id: existing.id,
            name: existing.name,
            prompt: existing.prompt,
            schedule: previousState.schedule,
            enabled: previousState.enabled,
          },
        }
      }

      if (input.action === "pause") {
        await sql`update automations set enabled = false where id = ${input.id}`
        try {
          recordUndo(getDatabase().$client, {
            kind: "routine",
            entityId: input.id,
            action: "pause",
            detail: `Routine „${existing.name}“ pausiert`,
            previousState,
          })
        } catch {}
        return { ok: true, message: `Routine „${existing.name}“ wurde pausiert. (Rückgängig möglich)` }
      }

      if (input.action === "resume") {
        const at = nextRun(previousState.schedule, existing.timezone || "Europe/Berlin", new Date())
        await sql`update automations set enabled = true, next_run_at = ${at} where id = ${input.id}`
        try {
          recordUndo(getDatabase().$client, {
            kind: "routine",
            entityId: input.id,
            action: "resume",
            detail: `Routine „${existing.name}“ fortgesetzt`,
            previousState,
          })
        } catch {}
        return {
          ok: true,
          message: `Routine „${existing.name}“ wurde aktiviert. Nächster Lauf: ${at ? at.toLocaleString("de-DE") : "unbekannt"}. (Rückgängig möglich)`,
        }
      }

      if (input.action === "delete") {
        const now = Date.now()
        await sql`update automations set deleted_at = ${now} where id = ${input.id}`
        try {
          recordUndo(getDatabase().$client, {
            kind: "routine",
            entityId: input.id,
            action: "delete",
            detail: `Routine „${existing.name}“ archiviert`,
            previousState,
          })
        } catch {}
        return { ok: true, message: `Routine „${existing.name}“ wurde archiviert/gelöscht. (Rückgängig möglich)` }
      }

      if (input.action === "update") {
        const name = input.name ?? existing.name
        const prompt = input.prompt ?? existing.prompt
        const schedule = input.schedule ?? previousState.schedule
        const enabled = input.enabled !== undefined ? input.enabled : previousState.enabled
        const at = nextRun(schedule, existing.timezone || "Europe/Berlin", new Date())

        await sql`
          update automations
          set name = ${name}, prompt = ${prompt}, schedule = ${JSON.stringify(schedule)}, enabled = ${enabled}, next_run_at = ${at}
          where id = ${input.id}
        `
        try {
          recordUndo(getDatabase().$client, {
            kind: "routine",
            entityId: input.id,
            action: "update",
            detail: `Routine „${name}“ aktualisiert`,
            previousState,
          })
        } catch {}

        return {
          ok: true,
          message: `Routine „${name}“ wurde aktualisiert. (Rückgängig möglich)`,
        }
      }

      return { ok: false, error: "Unbekannte Aktion." }
    },
  })
}

export function automationTools(ctx: ChatContext): ToolSet {
  return {
    automation_create: automationCreateTool(ctx),
    update_routine: updateRoutineTool(ctx),
  }
}
