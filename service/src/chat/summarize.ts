import { generateText, type UIMessage } from "ai"

import { summaryDue, summarySource, type StoredSummary } from "@/lib/chat/context"
import type { Sql } from "@/lib/chat/load-chat"
import { loadSummary, saveSummary } from "@/lib/chat/summary-store"
import { buildSummary, SUMMARY_MODEL, type Generate } from "@/lib/chat/summary"
import { cli } from "@/lib/cli/provider"
import { costUsd } from "@/lib/usage/prices"

// Haiku über die claude-CLI (wie der Chat), nie über Jev oder OpenRouter: der Verlauf geht nur an die lokale CLI.
export const cliGenerate: Generate = async ({ system, prompt }) => {
  const result = await generateText({
    model: cli.chat(SUMMARY_MODEL),
    system,
    prompt,
    maxOutputTokens: 1200,
    abortSignal: AbortSignal.timeout(60_000),
  })
  return { text: result.text, costUsd: costUsd(SUMMARY_MODEL, result.usage) }
}

// Gruppenturns liefern nur die neue Antwort als `event.messages` (die Antwort hängt der Aufrufer an): dort zählt der Verlauf davor mit.
export function messagesForSummary<M extends UIMessage>(history: M[], finished: M[], groupTurn: boolean): M[] {
  if (!groupTurn) return finished
  const known = new Set(history.map((m) => m.id))
  return [...history, ...finished.filter((m) => !known.has(m.id))]
}

const running = new Set<string>()

// Nach dem Turn: bei Überschreiten der Schwelle neu aus den Originalen zusammenfassen. Wirft nie, läuft je Chat nur einmal.
export async function maybeSummarize(input: {
  sql: Sql
  chatId: string
  messages: UIMessage[]
  stored?: StoredSummary | null
  generate?: Generate
}): Promise<"saved" | "skipped" | "failed"> {
  const { sql, chatId, messages } = input
  if (running.has(chatId)) return "skipped"
  running.add(chatId)
  try {
    const stored = input.stored === undefined ? await loadSummary(sql, chatId) : input.stored
    if (!summaryDue(messages, stored)) return "skipped"
    const source = summarySource(messages)
    if (!source) return "skipped"
    const built = await buildSummary(source, input.generate ?? cliGenerate)
    if (!built) return "failed"
    await saveSummary(sql, {
      chatId,
      coveredLastId: source.at(-1)!.id,
      coveredCount: source.length,
      model: SUMMARY_MODEL,
      built,
    })
    return "saved"
  } catch {
    return "failed"
  } finally {
    running.delete(chatId)
  }
}
