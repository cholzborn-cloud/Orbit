import { tool, type ToolSet } from "ai"
import type Database from "better-sqlite3"
import { z } from "zod"

import { getDatabase } from "../db/client.ts"
import { recordUndo } from "../db/undo-store.ts"
import type { ChatContext } from "./load-chat.ts"

export type BotFleetRecord = {
  id: string
  name: string
  job: string
  instructions: string | null
  avatar: string
  color: string | null
  isMain: boolean
  version: number
  status: "frei" | "arbeitet"
  archivedAt: number | null
}

export function listFleetBots(
  db: Database.Database,
  userId = "local"
): BotFleetRecord[] {
  const rows = db
    .prepare(
      `SELECT b.id, b.name, b.job, b.instructions, b.avatar, b.color, b.is_main as isMain,
              b.version, b.archived_at as archivedAt,
              (SELECT count(*) FROM tasks t WHERE t.orbi_id = b.id AND t.status IN ('queued', 'running', 'waiting')) as activeTasks,
              (SELECT count(*) FROM orbi_work w WHERE w.bot_id = b.id) as workingCount
       FROM bots b
       WHERE b.user_id = ? AND b.archived_at IS NULL
       ORDER BY b.is_main DESC, b.name ASC`
    )
    .all(userId) as Array<{
    id: string
    name: string
    job: string
    instructions: string | null
    avatar: string
    color: string | null
    isMain: number | boolean
    version: number
    archivedAt: number | null
    activeTasks: number
    workingCount: number
  }>

  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    job: r.job,
    instructions: r.instructions,
    avatar: r.avatar,
    color: r.color,
    isMain: Boolean(r.isMain),
    version: r.version ?? 1,
    status: r.activeTasks > 0 || r.workingCount > 0 ? "arbeitet" : "frei",
    archivedAt: r.archivedAt,
  }))
}

export function updateFleetBot(
  db: Database.Database,
  input: {
    id: string
    expected_version: number
    name?: string
    job?: string
    instructions?: string
    color?: string
  }
): { ok: boolean; version?: number; error?: string } {
  const existing = db
    .prepare(
      `SELECT id, name, job, instructions, color, is_main as isMain, version, archived_at as archivedAt
       FROM bots
       WHERE id = ?`
    )
    .get(input.id) as
    | {
        id: string
        name: string
        job: string
        instructions: string | null
        color: string | null
        isMain: number | boolean
        version: number
        archivedAt: number | null
      }
    | undefined

  if (!existing || existing.archivedAt !== null) {
    return { ok: false, error: `Orbi ${input.id} nicht gefunden oder archiviert.` }
  }

  const currentVersion = existing.version ?? 1
  if (currentVersion !== input.expected_version) {
    return {
      ok: false,
      error: `Versionskonflikt für Orbi ${existing.name}: erwartet ${input.expected_version}, aktuell ist ${currentVersion}. Bitte Daten neu laden.`,
    }
  }

  const nextVersion = currentVersion + 1
  const newName = input.name?.trim() ? input.name.trim() : existing.name
  const newJob = input.job?.trim() ? input.job.trim() : existing.job
  const newInstructions =
    input.instructions !== undefined ? input.instructions : existing.instructions
  const newColor = input.color !== undefined ? input.color : existing.color

  // Vorherigen Zustand für Rückgängig sichern
  recordUndo(db, {
    kind: "orbi",
    entityId: input.id,
    action: "update",
    detail: `Orbi „${existing.name}“ aktualisiert`,
    previousState: {
      name: existing.name,
      job: existing.job,
      instructions: existing.instructions,
      color: existing.color,
      version: currentVersion,
    },
  })

  db.prepare(
    `UPDATE bots
     SET name = ?, job = ?, instructions = ?, color = ?, version = ?
     WHERE id = ? AND version = ?`
  ).run(newName, newJob, newInstructions, newColor, nextVersion, input.id, currentVersion)

  return { ok: true, version: nextVersion }
}

export function archiveFleetBot(
  db: Database.Database,
  input: {
    id: string
    expected_version?: number
  }
): { ok: boolean; error?: string } {
  const existing = db
    .prepare(
      `SELECT id, name, job, instructions, color, is_main as isMain, version, archived_at as archivedAt
       FROM bots
       WHERE id = ?`
    )
    .get(input.id) as
    | {
        id: string
        name: string
        job: string
        instructions: string | null
        color: string | null
        isMain: number | boolean
        version: number
        archivedAt: number | null
      }
    | undefined

  if (!existing || existing.archivedAt !== null) {
    return { ok: false, error: `Orbi ${input.id} nicht gefunden oder bereits archiviert.` }
  }

  if (Boolean(existing.isMain)) {
    return { ok: false, error: "Der Hauptorbi kann nicht archiviert werden." }
  }

  const currentVersion = existing.version ?? 1
  if (
    input.expected_version !== undefined &&
    currentVersion !== input.expected_version
  ) {
    return {
      ok: false,
      error: `Versionskonflikt für Orbi ${existing.name}: erwartet ${input.expected_version}, aktuell ist ${currentVersion}.`,
    }
  }

  const nextVersion = currentVersion + 1

  recordUndo(db, {
    kind: "orbi",
    entityId: input.id,
    action: "archive",
    detail: `Orbi „${existing.name}“ archiviert`,
    previousState: {
      name: existing.name,
      job: existing.job,
      instructions: existing.instructions,
      color: existing.color,
      version: currentVersion,
    },
  })

  db.prepare(
    `UPDATE bots
     SET archived_at = ?, version = ?
     WHERE id = ?`
  ).run(Date.now(), nextVersion, input.id)

  return { ok: true }
}

export function proposeBotProfile(
  db: Database.Database,
  botId: string,
  input: {
    job?: string
    instructions?: string
    color?: string
  }
): { ok: boolean; error?: string } {
  const existing = db
    .prepare(
      `SELECT id, name, job, instructions, color, version, archived_at as archivedAt
       FROM bots
       WHERE id = ?`
    )
    .get(botId) as
    | {
        id: string
        name: string
        job: string
        instructions: string | null
        color: string | null
        version: number
        archivedAt: number | null
      }
    | undefined

  if (!existing || existing.archivedAt !== null) {
    return { ok: false, error: "Orbi nicht gefunden." }
  }

  const currentVersion = existing.version ?? 1
  const nextVersion = currentVersion + 1
  const newJob = input.job?.trim() ? input.job.trim() : existing.job
  const newInstructions =
    input.instructions !== undefined ? input.instructions : existing.instructions
  const newColor = input.color !== undefined ? input.color : existing.color

  recordUndo(db, {
    kind: "profile",
    entityId: botId,
    action: "update",
    detail: `Eigenes Profil von „${existing.name}“ aktualisiert`,
    previousState: {
      job: existing.job,
      instructions: existing.instructions,
      color: existing.color,
      version: currentVersion,
    },
  })

  db.prepare(
    `UPDATE bots
     SET job = ?, instructions = ?, color = ?, version = ?
     WHERE id = ?`
  ).run(newJob, newInstructions, newColor, nextVersion, botId)

  return { ok: true }
}

export function fleetTools(
  ctx: ChatContext,
  options: { db?: () => Database.Database } = {}
): ToolSet {
  const db = options.db ?? (() => getDatabase().$client)
  const bot = ctx.speaker
  const tools: ToolSet = {}

  // Profil-Selbständerung mit sofortiger Wirkung + Rückgängig (für alle Orbis im 1:1 Chat)
  if (!ctx.isGroup) {
    tools.propose_profile = tool({
      description:
        "Update your own profile (job task, instructions or color). Takes effect immediately and can be undone.",
      inputSchema: z.object({
        job: z.string().optional().describe("Updated job task description"),
        instructions: z.string().optional().describe("Updated instructions"),
        color: z.string().optional().describe("Accent color in hex, e.g. #3b82f6"),
      }),
      execute: async (input) => {
        try {
          const res = proposeBotProfile(db(), bot.id, input)
          if (!res.ok) return res
          return {
            ok: true,
            message: `Dein Profil wurde sofort aktualisiert. Rückgängig ist jederzeit möglich.`,
          }
        } catch {
          return { ok: false, error: "Profil konnte nicht aktualisiert werden." }
        }
      },
    })
  }

  // Flottenwerkzeuge für den Hauptorbi (Chief of Staff)
  if (bot.is_main && !ctx.isGroup) {
    tools.list_orbis = tool({
      description:
        "List all active Orbis in the fleet with their id, name, job, version, and availability status (frei vs arbeitet).",
      inputSchema: z.object({}),
      execute: async () => {
        try {
          const list = listFleetBots(db(), ctx.userId)
          return {
            ok: true,
            orbis: list.map((b) => ({
              id: b.id,
              name: b.name,
              job: b.job,
              isMain: b.isMain,
              version: b.version,
              status: b.status,
            })),
          }
        } catch {
          return { ok: false, error: "Orbis konnten nicht geladen werden." }
        }
      },
    })

    tools.update_orbi = tool({
      description:
        "Update another Orbi's name, job, instructions or color. Requires expected_version for concurrency check. Immediately effective and can be undone.",
      inputSchema: z.object({
        id: z.string().describe("ID of the Orbi to update"),
        expected_version: z.number().int().describe("Current version of the Orbi from list_orbis"),
        name: z.string().optional().describe("New name"),
        job: z.string().optional().describe("New job task description"),
        instructions: z.string().optional().describe("New standing instructions"),
        color: z.string().optional().describe("New color hex"),
      }),
      execute: async (input) => {
        try {
          const res = updateFleetBot(db(), input)
          if (!res.ok) return res
          return {
            ok: true,
            version: res.version,
            message: `Orbi ${input.id} wurde aktualisiert (neue Version: ${res.version}). Rückgängig ist möglich.`,
          }
        } catch {
          return { ok: false, error: "Orbi konnte nicht aktualisiert werden." }
        }
      },
    })

    tools.archive_orbi = tool({
      description:
        "Archive an Orbi (soft delete). Cannot archive the main Orbi. Immediately effective and can be undone.",
      inputSchema: z.object({
        id: z.string().describe("ID of the Orbi to archive"),
        expected_version: z.number().int().optional().describe("Expected version check"),
      }),
      execute: async (input) => {
        try {
          const res = archiveFleetBot(db(), input)
          if (!res.ok) return res
          return {
            ok: true,
            message: `Orbi ${input.id} wurde archiviert. Rückgängig ist möglich.`,
          }
        } catch {
          return { ok: false, error: "Orbi konnte nicht archiviert werden." }
        }
      },
    })
  }

  return tools
}
