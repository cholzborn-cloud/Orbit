import { tool } from "ai"
import { z } from "zod"

import type { Sql } from "./load-chat.ts"
import { RECALL_PAGE, type StoredOutput } from "./tool-cap.ts"

export const CHAT_RECALL = "chat_recall"
const MAX_RESULT = 4_000

// Sucht im EIGENEN Verlauf (Volltext der Nachrichten) oder liest ein gekürztes Tool-Ergebnis zurück (id, stückweise).
// Fremder Inhalt: das Ergebnis wird wie andere Fremddaten-Werkzeuge gerahmt (lib/chat/untrusted.ts).
export function createRecallTool(deps: {
  chatId: string
  sql: Sql
  // Ergebnisse, die in diesem Turn gekappt wurden und noch nicht in der Datenbank stehen müssen.
  stored?: (id: string) => StoredOutput | undefined
}) {
  const { chatId, sql } = deps
  const page = (text: string, offset: number) => {
    const chunk = text.slice(offset, offset + RECALL_PAGE)
    const next = offset + RECALL_PAGE
    return {
      text: chunk,
      total: text.length,
      ...(next < text.length && { nextOffset: next }),
    }
  }
  return tool({
    description:
      "Search this chat's full history by words, or read a shortened tool result by its id (older results show 'id ...').",
    inputSchema: z.object({
      query: z.string().trim().min(1).max(200).optional().describe("Words to find in this chat."),
      id: z.string().trim().max(80).optional().describe("Id of a shortened tool result."),
      offset: z.number().int().min(0).optional().describe("Start character when reading by id."),
    }),
    execute: async ({ query, id, offset }) => {
      try {
        if (id) {
          if (!/^[A-Za-z0-9_\-:.]{1,80}$/.test(id)) return { error: "Unknown id." }
          const live = deps.stored?.(id)
          if (live) return page(live.body, offset ?? 0)
          if (id.startsWith("out_")) {
            const [row] = (await sql`select body from tool_outputs where id = ${id} and chat_id = ${chatId}`) as { body: string }[]
            return row ? page(row.body, offset ?? 0) : { error: "Unknown id." }
          }
          // Aufruf-ID eines alten Tool-Ergebnisses: aus dem gespeicherten Vollverlauf.
          const rows = (await sql`select parts from chat_messages where chat_id = ${chatId} and instr(parts, ${`"toolCallId":"${id}"`}) > 0`) as { parts: unknown }[]
          for (const row of rows) {
            const parts = (typeof row.parts === "string" ? JSON.parse(row.parts) : row.parts) as { toolCallId?: string; output?: unknown }[]
            const found = parts.find((part) => part.toolCallId === id && part.output !== undefined)
            if (found) {
              const output = typeof found.output === "string" ? found.output : JSON.stringify(found.output)
              return page(output, offset ?? 0)
            }
          }
          return { error: "Unknown id." }
        }
        if (!query) return { error: "Give a query or an id." }
        const terms = query.match(/[\p{L}\p{N}_]+/gu)
        if (!terms?.length) return { error: "No searchable words." }
        const match = terms.map((term) => `"${term}"`).join(" AND ")
        const rows = (await sql`select m.role as role, substr(m.id, length(m.chat_id) + 2) as messageId, snippet(chat_messages_fts, 0, '<<', '>>', ' … ', 40) as snippet, m.created_at as at
          from chat_messages_fts join chat_messages_index m on m.rowid = chat_messages_fts.rowid
          where chat_messages_fts match ${match} and m.chat_id = ${chatId}
          order by bm25(chat_messages_fts), m.created_at desc limit 8`) as { role: string; messageId: string; snippet: string; at: Date | number }[]
        let used = 0
        const hits = []
        for (const row of rows) {
          const hit = { role: row.role, messageId: row.messageId, snippet: row.snippet }
          used += JSON.stringify(hit).length
          if (used > MAX_RESULT) break
          hits.push(hit)
        }
        return { hits }
      } catch {
        return { error: "Search failed." }
      }
    },
  })
}
