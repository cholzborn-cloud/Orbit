import { getDatabase } from "@/lib/db/client"
import { recordUndo } from "@/lib/db/undo-store"
import { nextRun, scheduleSchema } from "@/lib/automations/schedule"

export function listRoutinesRoute(query?: URLSearchParams) {
  const db = getDatabase().$client
  const botId = query?.get("botId")
  let sql = `
    SELECT id, bot_id as botId, name, prompt, schedule, timezone, enabled, next_run_at as nextRunAt, created_at as createdAt
    FROM automations
    WHERE deleted_at IS NULL
  `
  const params: unknown[] = []
  if (botId) {
    sql += " AND bot_id = ?"
    params.push(botId)
  }
  sql += " ORDER BY created_at DESC"

  const rows = db.prepare(sql).all(...params) as Array<{
    id: string
    botId: string
    name: string
    prompt: string
    schedule: string
    timezone: string
    enabled: number | boolean
    nextRunAt: number | null
    createdAt: number
  }>

  return {
    ok: true,
    routines: rows.map((r) => ({
      id: r.id,
      botId: r.botId,
      name: r.name,
      prompt: r.prompt,
      schedule: typeof r.schedule === "string" ? JSON.parse(r.schedule) : r.schedule,
      timezone: r.timezone,
      enabled: Boolean(r.enabled),
      nextRunAt: r.nextRunAt,
      createdAt: r.createdAt,
    })),
  }
}

export function getRoutineRoute(id: string) {
  const db = getDatabase().$client
  const row = db
    .prepare(
      `SELECT id, bot_id as botId, name, prompt, schedule, timezone, enabled, next_run_at as nextRunAt, created_at as createdAt
       FROM automations
       WHERE id = ? AND deleted_at IS NULL`
    )
    .get(id) as
    | {
        id: string
        botId: string
        name: string
        prompt: string
        schedule: string
        timezone: string
        enabled: number | boolean
        nextRunAt: number | null
        createdAt: number
      }
    | undefined

  if (!row) {
    return { ok: false, error: `Routine ${id} nicht gefunden.` }
  }

  return {
    ok: true,
    routine: {
      id: row.id,
      botId: row.botId,
      name: row.name,
      prompt: row.prompt,
      schedule: typeof row.schedule === "string" ? JSON.parse(row.schedule) : row.schedule,
      timezone: row.timezone,
      enabled: Boolean(row.enabled),
      nextRunAt: row.nextRunAt,
      createdAt: row.createdAt,
    },
  }
}

export function updateRoutineRoute(id: string, body?: unknown) {
  const db = getDatabase().$client
  const existing = db
    .prepare("SELECT * FROM automations WHERE id = ? AND deleted_at IS NULL")
    .get(id) as any

  if (!existing) {
    return { ok: false, error: `Routine ${id} nicht gefunden.` }
  }

  const b = body && typeof body === "object" ? (body as Record<string, unknown>) : {}
  const previousState = {
    name: existing.name,
    prompt: existing.prompt,
    schedule: typeof existing.schedule === "string" ? JSON.parse(existing.schedule) : existing.schedule,
    enabled: Boolean(existing.enabled),
  }

  const name = typeof b.name === "string" && b.name.trim() ? b.name.trim() : existing.name
  const prompt = typeof b.prompt === "string" && b.prompt.trim() ? b.prompt.trim() : existing.prompt
  const schedule = b.schedule ? b.schedule : previousState.schedule
  const enabled = b.enabled !== undefined ? Boolean(b.enabled) : previousState.enabled
  const at = nextRun(schedule, existing.timezone || "Europe/Berlin", new Date())

  recordUndo(db, {
    kind: "routine",
    entityId: id,
    action: "update",
    detail: `Routine „${name}“ aktualisiert`,
    previousState,
  })

  db.prepare(
    `UPDATE automations
     SET name = ?, prompt = ?, schedule = ?, enabled = ?, next_run_at = ?
     WHERE id = ?`
  ).run(name, prompt, JSON.stringify(schedule), enabled ? 1 : 0, at, id)

  return { ok: true, id, message: `Routine „${name}“ aktualisiert. (Rückgängig möglich)` }
}

export function pauseRoutineRoute(id: string) {
  const db = getDatabase().$client
  const existing = db
    .prepare("SELECT * FROM automations WHERE id = ? AND deleted_at IS NULL")
    .get(id) as any

  if (!existing) {
    return { ok: false, error: `Routine ${id} nicht gefunden.` }
  }

  recordUndo(db, {
    kind: "routine",
    entityId: id,
    action: "pause",
    detail: `Routine „${existing.name}“ pausiert`,
    previousState: { enabled: Boolean(existing.enabled) },
  })

  db.prepare("UPDATE automations SET enabled = 0 WHERE id = ?").run(id)
  return { ok: true, id, message: `Routine „${existing.name}“ pausiert. (Rückgängig möglich)` }
}

export function resumeRoutineRoute(id: string) {
  const db = getDatabase().$client
  const existing = db
    .prepare("SELECT * FROM automations WHERE id = ? AND deleted_at IS NULL")
    .get(id) as any

  if (!existing) {
    return { ok: false, error: `Routine ${id} nicht gefunden.` }
  }

  const schedule = typeof existing.schedule === "string" ? JSON.parse(existing.schedule) : existing.schedule
  const at = nextRun(schedule, existing.timezone || "Europe/Berlin", new Date())

  recordUndo(db, {
    kind: "routine",
    entityId: id,
    action: "resume",
    detail: `Routine „${existing.name}“ fortgesetzt`,
    previousState: { enabled: Boolean(existing.enabled) },
  })

  db.prepare("UPDATE automations SET enabled = 1, next_run_at = ? WHERE id = ?").run(at, id)
  return { ok: true, id, message: `Routine „${existing.name}“ aktiviert. (Rückgängig möglich)` }
}

export function deleteRoutineRoute(id: string) {
  const db = getDatabase().$client
  const existing = db
    .prepare("SELECT * FROM automations WHERE id = ? AND deleted_at IS NULL")
    .get(id) as any

  if (!existing) {
    return { ok: false, error: `Routine ${id} nicht gefunden.` }
  }

  recordUndo(db, {
    kind: "routine",
    entityId: id,
    action: "delete",
    detail: `Routine „${existing.name}“ archiviert`,
    previousState: {
      name: existing.name,
      prompt: existing.prompt,
      schedule: typeof existing.schedule === "string" ? JSON.parse(existing.schedule) : existing.schedule,
      enabled: Boolean(existing.enabled),
    },
  })

  db.prepare("UPDATE automations SET deleted_at = ? WHERE id = ?").run(Date.now(), id)
  return { ok: true, id, message: `Routine „${existing.name}“ archiviert/gelöscht. (Rückgängig möglich)` }
}
