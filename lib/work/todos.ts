import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"

export type TodoStatus = "todo" | "in_progress" | "done" | "cancelled"

export type TodoRecord = {
  id: string
  chatId: string
  botId: string
  taskId: string | null
  content: string
  status: TodoStatus
  position: number
  createdAt: number
  updatedAt: number
}

const COLUMNS = `id, chat_id as chatId, bot_id as botId, task_id as taskId, content, status, position,
  created_at as createdAt, updated_at as updatedAt`

export function listTodos(db: Database.Database, chatId: string): TodoRecord[] {
  return db
    .prepare(`SELECT ${COLUMNS} FROM todos WHERE chat_id = ? ORDER BY position ASC, created_at ASC`)
    .all(chatId) as TodoRecord[]
}

export function writeTodos(
  db: Database.Database,
  chatId: string,
  botId: string,
  items: Array<{
    id?: string
    content: string
    status?: TodoStatus
    taskId?: string
  }>,
  now = Date.now()
): TodoRecord[] {
  return db.transaction(() => {
    // Falls items übergeben wurden: bestehende IDs aktualisieren, neue anlegen
    const upsert = db.prepare(`
      INSERT INTO todos (id, chat_id, bot_id, task_id, content, status, position, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        content = excluded.content,
        status = excluded.status,
        task_id = COALESCE(excluded.task_id, todos.task_id),
        position = excluded.position,
        updated_at = excluded.updated_at
    `)

    let pos = 0
    for (const item of items) {
      const id = item.id && item.id.trim() ? item.id.trim() : randomUUID()
      const status = item.status ?? "todo"
      upsert.run(
        id,
        chatId,
        botId,
        item.taskId ?? null,
        item.content.trim(),
        status,
        pos++,
        now,
        now
      )
    }

    return listTodos(db, chatId)
  }).immediate()
}

export function clearCompletedTodos(db: Database.Database, chatId: string): number {
  const res = db.prepare(`DELETE FROM todos WHERE chat_id = ? AND status IN ('done', 'cancelled')`).run(chatId)
  return res.changes
}
