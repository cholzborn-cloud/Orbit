import type Database from "better-sqlite3"

import { interruptedAll, rootOf } from "./runs.ts"

// Status je Chat für die Seitenleiste (Phase 5). Nur Zustände, keine Inhalte. Die App zeigt daraus blaue Punkte:
// arbeitet (Job läuft), braucht dich (offene Freigabe/Rückfrage), neu (Antwort seit dem letzten Hinsehen), unterbrochen.
export type ChatStatus = {
  chatId: string
  working: boolean
  needsYou: boolean
  isNew: boolean
  interrupted: boolean
}

export function sidebarStatus(db: Database.Database, now = Date.now()) {
  const map = new Map<string, ChatStatus>()
  const entry = (chatId: string) => {
    let item = map.get(chatId)
    if (!item) map.set(chatId, (item = { chatId, working: false, needsYou: false, isNew: false, interrupted: false }))
    return item
  }
  for (const row of db
    .prepare("select chat_id as chatId, status from work_runs where status in ('queued', 'running', 'waiting')")
    .all() as { chatId: string; status: string }[]) {
    const item = entry(row.chatId)
    if (row.status === "waiting") item.needsYou = true
    else item.working = true
  }
  for (const row of db
    .prepare("select distinct chat_id as chatId from pending_interactions where expires_at > ?")
    .all(now) as { chatId: string }[])
    entry(row.chatId).needsYou = true
  // Neu: im Chat kam etwas nach dem letzten Hinsehen dazu. Nachrichten von Consti setzen „gesehen“ selbst (siehe markSeen im Turn-Start).
  for (const row of db
    .prepare(
      `select c.id as chatId from chats c left join chat_seen s on s.chat_id = c.id
       where c.user_id = 'local' and c.last_message_at > coalesce(s.seen_at, c.created_at)`
    )
    .all() as { chatId: string }[])
    entry(row.chatId).isNew = true
  for (const run of interruptedAll(db)) {
    const root = rootOf(run)
    if (root) entry(root).interrupted = true
  }
  const chats = [...map.values()].filter((item) => item.working || item.needsYou || item.isNew || item.interrupted)
  return { chats, needsYou: chats.filter((item) => item.needsYou).length }
}
