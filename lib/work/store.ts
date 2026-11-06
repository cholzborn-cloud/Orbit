import type Database from "better-sqlite3"

// Kleine Speicher für Phase 5: offene Freigaben, Auftragszähler, „gesehen“-Zeitpunkte und Einstellungen (Schlüssel/Wert).

// ---- Offene Freigaben und Rückfragen ----
export type StoredInteraction = {
  id: string
  chatId: string
  botId: string
  kind: string
  requestedAt: number
  expiresAt: number
  request: Record<string, unknown>
}

export function saveInteraction(db: Database.Database, item: StoredInteraction) {
  db.prepare(
    `insert or replace into pending_interactions (id, chat_id, bot_id, kind, request, requested_at, expires_at)
     values (?, ?, ?, ?, ?, ?, ?)`
  ).run(item.id, item.chatId, item.botId, item.kind, JSON.stringify(item.request), item.requestedAt, item.expiresAt)
}

export function removeInteraction(db: Database.Database, id: string) {
  db.prepare("delete from pending_interactions where id = ?").run(id)
}

// Noch nicht abgelaufene Einträge; abgelaufene werden gleich gelöscht.
export function loadInteractions(db: Database.Database, now = Date.now()): StoredInteraction[] {
  db.prepare("delete from pending_interactions where expires_at <= ?").run(now)
  return (
    db
      .prepare(
        `select id, chat_id as chatId, bot_id as botId, kind, request, requested_at as requestedAt, expires_at as expiresAt
         from pending_interactions order by requested_at`
      )
      .all() as (Omit<StoredInteraction, "request"> & { request: string })[]
  ).flatMap((row) => {
    try {
      return [{ ...row, request: JSON.parse(row.request) as Record<string, unknown> }]
    } catch {
      return []
    }
  })
}

// ---- Auftragszähler ----
export type StoredCounters = {
  taskId: string
  rootChatId: string
  sent: number
  groupRounds: number
  deepCalls: number
  pairWakes: [string, number][]
}

export function saveCounters(db: Database.Database, c: StoredCounters, now = Date.now()) {
  db.prepare(
    `insert or replace into task_counters (task_id, root_chat_id, sent, group_rounds, deep_calls, pair_wakes, updated_at)
     values (?, ?, ?, ?, ?, ?, ?)`
  ).run(c.taskId, c.rootChatId, c.sent, c.groupRounds, c.deepCalls, JSON.stringify(c.pairWakes), now)
}

export function loadCounters(db: Database.Database, taskId: string): StoredCounters | null {
  const row = db
    .prepare(
      `select task_id as taskId, root_chat_id as rootChatId, sent, group_rounds as groupRounds, deep_calls as deepCalls, pair_wakes as pairWakes
       from task_counters where task_id = ?`
    )
    .get(taskId) as (Omit<StoredCounters, "pairWakes"> & { pairWakes: string }) | undefined
  if (!row) return null
  let pairWakes: [string, number][] = []
  try {
    pairWakes = JSON.parse(row.pairWakes) as [string, number][]
  } catch {
    /* leer */
  }
  return { ...row, pairWakes }
}

export function pruneCounters(db: Database.Database, olderThanMs: number, now = Date.now()) {
  db.prepare("delete from task_counters where updated_at < ?").run(now - olderThanMs)
}

// ---- Gesehen ----
export function markSeen(db: Database.Database, chatId: string, now = Date.now()) {
  db.prepare("insert or replace into chat_seen (chat_id, seen_at) values (?, ?)").run(chatId, now)
}

// ---- Einstellungen (Schlüssel/Wert) ----
export function getKv(db: Database.Database, key: string): string | null {
  const row = db.prepare("select value from app_kv where key = ?").get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setKv(db: Database.Database, key: string, value: string, now = Date.now()) {
  db.prepare("insert or replace into app_kv (key, value, updated_at) values (?, ?, ?)").run(key, value, now)
}
