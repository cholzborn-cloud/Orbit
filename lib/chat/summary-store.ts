import type { Sql } from "./load-chat.ts"
import type { StoredSummary } from "./context.ts"
import type { BuiltSummary } from "./summary.ts"

// Gespeichert wird nur der gerenderte Text; `covered_last_id` sagt, bis zu welcher Nachricht er reicht.
export async function loadSummary(sql: Sql, chatId: string): Promise<StoredSummary | null> {
  try {
    const [row] = (await sql`select covered_last_id as "coveredLastId", covered_count as "coveredCount", data from chat_summaries where chat_id = ${chatId}`) as {
      coveredLastId: string
      coveredCount: number
      data: string
    }[]
    return row ? { coveredLastId: row.coveredLastId, coveredCount: row.coveredCount, text: row.data } : null
  } catch {
    return null
  }
}

export async function saveSummary(
  sql: Sql,
  input: { chatId: string; coveredLastId: string; coveredCount: number; model: string; built: BuiltSummary }
) {
  await sql`insert into chat_summaries (chat_id, covered_last_id, covered_count, source_chars, summary_chars, data, model, cost_usd, updated_at)
    values (${input.chatId}, ${input.coveredLastId}, ${input.coveredCount}, ${input.built.sourceChars}, ${input.built.text.length}, ${input.built.text}, ${input.model}, ${input.built.costUsd}, (unixepoch('subsecond') * 1000))
    on conflict (chat_id) do update set covered_last_id = excluded.covered_last_id, covered_count = excluded.covered_count, source_chars = excluded.source_chars,
      summary_chars = excluded.summary_chars, data = excluded.data, model = excluded.model, cost_usd = excluded.cost_usd, updated_at = excluded.updated_at`
}
