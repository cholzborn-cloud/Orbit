import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"

export type UndoKind = "memory" | "routine" | "orbi" | "profile" | "mac"

export type UndoActionRecord = {
  id: string
  kind: UndoKind
  entityId: string
  action: string
  detail: string
  previousState: string | null
  createdAt: number
}

export function recordUndo(
  db: Database.Database,
  entry: {
    kind: UndoKind
    entityId: string
    action: string
    detail: string
    previousState?: unknown
  }
): UndoActionRecord {
  const record: UndoActionRecord = {
    id: randomUUID(),
    kind: entry.kind,
    entityId: entry.entityId,
    action: entry.action,
    detail: entry.detail,
    previousState:
      entry.previousState !== undefined ? JSON.stringify(entry.previousState) : null,
    createdAt: Date.now(),
  }

  db.prepare(
    `INSERT INTO undo_actions (id, kind, entity_id, action, detail, previous_state, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    record.id,
    record.kind,
    record.entityId,
    record.action,
    record.detail,
    record.previousState,
    record.createdAt
  )

  return record
}

export function popUndo(
  db: Database.Database,
  filter?: { kind?: UndoKind; entityId?: string }
): UndoActionRecord | null {
  let query = "SELECT id, kind, entity_id as entityId, action, detail, previous_state as previousState, created_at as createdAt FROM undo_actions"
  const conditions: string[] = []
  const params: unknown[] = []

  if (filter?.kind) {
    conditions.push("kind = ?")
    params.push(filter.kind)
  }
  if (filter?.entityId) {
    conditions.push("entity_id = ?")
    params.push(filter.entityId)
  }
  if (conditions.length) {
    query += " WHERE " + conditions.join(" AND ")
  }
  query += " ORDER BY created_at DESC, rowid DESC LIMIT 1"

  const row = db.prepare(query).get(...params) as UndoActionRecord | undefined
  if (!row) return null

  db.prepare("DELETE FROM undo_actions WHERE id = ?").run(row.id)
  return row
}

export function listUndo(
  db: Database.Database,
  limit = 20
): UndoActionRecord[] {
  return db
    .prepare(
      `SELECT id, kind, entity_id as entityId, action, detail, previous_state as previousState, created_at as createdAt
       FROM undo_actions
       ORDER BY created_at DESC, rowid DESC
       LIMIT ?`
    )
    .all(limit) as UndoActionRecord[]
}
