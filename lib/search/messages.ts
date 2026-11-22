import type Database from "better-sqlite3"

export function searchMessagesIn(
  sqlite: Database.Database,
  userId: string,
  q: string,
  limit = 20
) {
  const terms = q
    .trim()
    .slice(0, 200)
    .match(/[\p{L}\p{N}_]+/gu)
  if (!terms?.length) return []
  const query = terms.map((term) => '"' + term + '"').join(" AND ")
  const rows = sqlite
    .prepare(
      `
    select c.id as chatId,
      coalesce(c.name, (select min(b.name) from chat_members cm join bots b on b.id = cm.bot_id where cm.chat_id = c.id)) as chatName,
      (select min(b.avatar) from chat_members cm join bots b on b.id = cm.bot_id where cm.chat_id = c.id) as avatar,
      (select min(b.color) from chat_members cm join bots b on b.id = cm.bot_id where cm.chat_id = c.id) as color,
      m.role, substr(m.id, length(m.chat_id) + 2) as messageId, snippet(chat_messages_fts, 0, '<<', '>>', ' … ', 24) as snippet,
      m.created_at as createdAt, bm25(chat_messages_fts) as rank
    from chat_messages_fts
    join chat_messages_index m on m.rowid = chat_messages_fts.rowid
    join chats c on c.id = m.chat_id
    where chat_messages_fts match ? and m.user_id = ? and c.user_id = ?
    order by rank, m.created_at desc
    limit ?
  `
    )
    .all(
      query,
      userId,
      userId,
      Number.isFinite(limit) ? Math.min(50, Math.max(1, Math.floor(limit))) : 20
    ) as {
    chatId: string
    chatName: string | null
    avatar: string | null
    color: string | null
    role: string
    messageId: string
    snippet: string
    createdAt: number
    rank: number
  }[]
  return rows.map((row) => ({ ...row, createdAt: new Date(row.createdAt) }))
}
