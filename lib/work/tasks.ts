import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"

export type TaskStatus =
  | "queued"
  | "running"
  | "waiting"
  | "done"
  | "failed"
  | "stopped"

export type TaskMode = "work" | "consult" | "notify"
export type TaskReply = "resume" | "none"

export type TaskRecord = {
  id: string
  orbiId: string
  parentChatId: string
  parentTaskId: string | null
  brief: string
  title: string | null
  mode: TaskMode
  reply: TaskReply
  status: TaskStatus
  result: string | null
  progress: string | null
  doneWhen: string | null
  answers: string | null
  rework: string | null
  resumeOf: string | null
  assignedBotId: string | null
  startedAt: number | null
  lastProgressAt: number | null
  finishedAt: number | null
  createdAt: number
  updatedAt: number
}

const COLUMNS = `id, orbi_id as orbiId, parent_chat_id as parentChatId, parent_task_id as parentTaskId,
  brief, title, mode, reply, status, result, progress, done_when as doneWhen, answers, rework,
  resume_of as resumeOf, assigned_bot_id as assignedBotId, started_at as startedAt,
  last_progress_at as lastProgressAt, finished_at as finishedAt, created_at as createdAt,
  updated_at as updatedAt`

export function createTask(
  db: Database.Database,
  input: {
    id?: string
    orbiId: string
    parentChatId: string
    parentTaskId?: string
    brief: string
    title?: string
    mode?: TaskMode
    reply?: TaskReply
    status?: TaskStatus
    resumeOf?: string
    assignedBotId?: string
    doneWhen?: string
    answers?: string
    rework?: string
    startedAt?: number
  },
  now = Date.now()
): TaskRecord {
  const id = input.id ?? randomUUID()
  const status = input.status ?? "queued"
  const startedAt = input.startedAt ?? (status === "running" ? now : null)
  db.prepare(
    `INSERT INTO tasks (
      id, orbi_id, parent_chat_id, parent_task_id, brief, title, mode, reply,
      status, resume_of, assigned_bot_id, done_when, answers, rework,
      started_at, last_progress_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    input.orbiId,
    input.parentChatId,
    input.parentTaskId ?? null,
    input.brief,
    input.title ?? null,
    input.mode ?? "work",
    input.reply ?? "resume",
    status,
    input.resumeOf ?? null,
    input.assignedBotId ?? null,
    input.doneWhen ?? null,
    input.answers ?? null,
    input.rework ?? null,
    startedAt,
    startedAt,
    now,
    now
  )
  return getTask(db, id)!
}

export function getTask(db: Database.Database, id: string): TaskRecord | null {
  const row = db
    .prepare(`SELECT ${COLUMNS} FROM tasks WHERE id = ?`)
    .get(id) as TaskRecord | undefined
  return row ?? null
}

export function listTasks(
  db: Database.Database,
  filter?: {
    orbiId?: string
    parentChatId?: string
    status?: TaskStatus | TaskStatus[]
    parentTaskId?: string
  }
): TaskRecord[] {
  const clauses: string[] = []
  const params: unknown[] = []

  if (filter?.orbiId) {
    clauses.push("orbi_id = ?")
    params.push(filter.orbiId)
  }
  if (filter?.parentChatId) {
    clauses.push("parent_chat_id = ?")
    params.push(filter.parentChatId)
  }
  if (filter?.parentTaskId) {
    clauses.push("parent_task_id = ?")
    params.push(filter.parentTaskId)
  }
  if (filter?.status) {
    if (Array.isArray(filter.status)) {
      clauses.push(`status IN (${filter.status.map(() => "?").join(", ")})`)
      params.push(...filter.status)
    } else {
      clauses.push("status = ?")
      params.push(filter.status)
    }
  }

  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
  return db
    .prepare(`SELECT ${COLUMNS} FROM tasks ${where} ORDER BY created_at DESC`)
    .all(...params) as TaskRecord[]
}

export function updateTaskProgress(
  db: Database.Database,
  id: string,
  progress: string,
  now = Date.now()
): boolean {
  const res = db
    .prepare(
      `UPDATE tasks
       SET progress = ?, last_progress_at = ?, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'running', 'waiting')`
    )
    .run(progress, now, now, id)
  return res.changes > 0
}

export function setTaskStatus(
  db: Database.Database,
  id: string,
  status: TaskStatus,
  extra?: { result?: string; answers?: string; progress?: string },
  now = Date.now()
): boolean {
  const finishedAt = ["done", "failed", "stopped"].includes(status) ? now : null
  const res = db
    .prepare(
      `UPDATE tasks
       SET status = ?,
           result = COALESCE(?, result),
           answers = COALESCE(?, answers),
           progress = COALESCE(?, progress),
           finished_at = CASE WHEN ? IS NOT NULL THEN ? ELSE finished_at END,
           updated_at = ?
       WHERE id = ?`
    )
    .run(
      status,
      extra?.result ?? null,
      extra?.answers ?? null,
      extra?.progress ?? null,
      finishedAt,
      finishedAt,
      now,
      id
    )
  return res.changes > 0
}

export function finishTask(
  db: Database.Database,
  id: string,
  status: "done" | "failed" | "stopped",
  result?: string,
  answers?: string,
  now = Date.now()
): boolean {
  const res = db
    .prepare(
      `UPDATE tasks
       SET status = ?, result = ?, answers = ?, finished_at = ?, updated_at = ?
       WHERE id = ? AND status IN ('queued', 'running', 'waiting')`
    )
    .run(status, result ?? null, answers ?? null, now, now, id)
  return res.changes > 0
}

export function stopTask(
  db: Database.Database,
  id: string,
  reason?: string,
  now = Date.now()
): boolean {
  const res = db
    .prepare(
      `UPDATE tasks
       SET status = 'stopped',
           result = COALESCE(?, result),
           finished_at = ?,
           updated_at = ?
       WHERE id = ? AND status IN ('queued', 'running', 'waiting')`
    )
    .run(reason ? `stopped: ${reason}` : "stopped", now, now, id)
  return res.changes > 0
}

export function stopTasksForOrbi(
  db: Database.Database,
  orbiId: string,
  now = Date.now()
): string[] {
  const rows = db
    .prepare(
      `SELECT id FROM tasks WHERE orbi_id = ? AND status IN ('queued', 'running', 'waiting')`
    )
    .all(orbiId) as { id: string }[]
  const ids = rows.map((r) => r.id)
  if (ids.length) {
    db.prepare(
      `UPDATE tasks
       SET status = 'stopped', result = 'stopped', finished_at = ?, updated_at = ?
       WHERE orbi_id = ? AND status IN ('queued', 'running', 'waiting')`
    ).run(now, now, orbiId)
  }
  return ids
}

export function stopAllTasks(
  db: Database.Database,
  filter?: { parentChatId?: string },
  now = Date.now()
): string[] {
  let query = `SELECT id FROM tasks WHERE status IN ('queued', 'running', 'waiting')`
  const params: unknown[] = []
  if (filter?.parentChatId) {
    query += ` AND parent_chat_id = ?`
    params.push(filter.parentChatId)
  }
  const rows = db.prepare(query).all(...params) as { id: string }[]
  const ids = rows.map((r) => r.id)
  if (ids.length) {
    let updateQuery = `UPDATE tasks SET status = 'stopped', result = 'stopped', finished_at = ?, updated_at = ? WHERE status IN ('queued', 'running', 'waiting')`
    const updateParams: unknown[] = [now, now]
    if (filter?.parentChatId) {
      updateQuery += ` AND parent_chat_id = ?`
      updateParams.push(filter.parentChatId)
    }
    db.prepare(updateQuery).run(...updateParams)
  }
  return ids
}

export function countActiveTasks(db: Database.Database, orbiId: string): number {
  const row = db
    .prepare(
      `SELECT count(*) as count FROM tasks WHERE orbi_id = ? AND status IN ('queued', 'running', 'waiting')`
    )
    .get(orbiId) as { count: number } | undefined
  return row?.count ?? 0
}

export function getActiveTasks(
  db: Database.Database,
  orbiId?: string
): TaskRecord[] {
  if (orbiId) {
    return db
      .prepare(
        `SELECT ${COLUMNS} FROM tasks WHERE orbi_id = ? AND status IN ('queued', 'running', 'waiting') ORDER BY started_at ASC`
      )
      .all(orbiId) as TaskRecord[]
  }
  return db
    .prepare(
      `SELECT ${COLUMNS} FROM tasks WHERE status IN ('queued', 'running', 'waiting') ORDER BY started_at ASC`
    )
    .all() as TaskRecord[]
}
