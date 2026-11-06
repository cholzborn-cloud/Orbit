import { randomUUID } from "node:crypto"
import type { LanguageModelUsage } from "ai"

import type { Sql } from "../chat/load-chat.ts"
import { cacheRatio, costUsd, writeTokens } from "./prices.ts"

// Art des Turns, damit Kosten nach Auslöser auswertbar sind.
export type TurnKind = "user" | "automation" | "handoff" | "group" | "wake" | "onboarding" | "subagent" | "model_step"

export type TurnUsageRow = {
  id: string
  chatId: string
  botId: string
  model: string
  inputTokens: number | null
  cachedTokens: number | null
  outputTokens: number | null
  systemChars: number
  toolCount: number
  historyMsgs: number
  steps: number | null
  costUsd: number | null
  cacheWriteTokens: number | null
  cacheRatio: number | null
  toolsChars: number | null
  volatileChars: number | null
  historyChars: number | null
  toolResultChars: number | null
  turnKind: TurnKind | null
  durationMs: number | null
  summaryUsed: boolean | null
  // Lauf I: Jev-Stufe und was die Stufung getan hat (start, keep, upgrade, reset, pinned, fallback); null = ohne Jev.
  tier: string | null
  tierChange: string | null
}

// Die SDK-Summe behandelt fehlende Einzelwerte sonst wie null; eine Teilsumme ist kein gemessener Gesamtwert.
export function completeUsage(total: LanguageModelUsage, steps: LanguageModelUsage[]): LanguageModelUsage {
  if (!steps.length) return total
  const known = (value: number | undefined, select: (step: LanguageModelUsage) => number | undefined) =>
    steps.every((step) => select(step) !== undefined) ? value : undefined
  return {
    ...total,
    inputTokens: known(total.inputTokens, step => step.inputTokens),
    outputTokens: known(total.outputTokens, step => step.outputTokens),
    totalTokens: steps.every(step => step.inputTokens !== undefined && step.outputTokens !== undefined && step.totalTokens !== undefined) ? total.totalTokens : undefined,
    inputTokenDetails: {
      ...total.inputTokenDetails,
      noCacheTokens: known(total.inputTokenDetails?.noCacheTokens, step => step.inputTokenDetails?.noCacheTokens),
      cacheReadTokens: known(total.inputTokenDetails?.cacheReadTokens, step => step.inputTokenDetails?.cacheReadTokens),
      cacheWriteTokens: known(total.inputTokenDetails?.cacheWriteTokens, step => step.inputTokenDetails?.cacheWriteTokens),
    },
    outputTokenDetails: {
      ...total.outputTokenDetails,
      textTokens: known(total.outputTokenDetails?.textTokens, step => step.outputTokenDetails?.textTokens),
      reasoningTokens: known(total.outputTokenDetails?.reasoningTokens, step => step.outputTokenDetails?.reasoningTokens),
    },
  }
}

// Nur Zahlen, nie Prompt-Inhalte; Cache-Tokens nur, wenn der Anbieter sie liefert.
// `usage` ist die Summe über alle Schritte (totalUsage): "Prompt je Anfrage" = inputTokens / steps.
export function turnUsageRow(input: {
  chatId: string
  botId: string
  model: string
  usage: LanguageModelUsage | undefined
  systemChars: number
  toolCount: number
  historyMsgs: number
  steps?: number
  toolsChars?: number
  volatileChars?: number
  historyChars?: number
  toolResultChars?: number
  turnKind?: TurnKind
  durationMs?: number
  summaryUsed?: boolean
  tier?: string
  tierChange?: string
}): TurnUsageRow {
  const { usage } = input
  return {
    id: randomUUID(),
    chatId: input.chatId,
    botId: input.botId,
    model: input.model,
    inputTokens: usage?.inputTokens ?? null,
    cachedTokens: usage?.inputTokenDetails?.cacheReadTokens ?? null,
    outputTokens: usage?.outputTokens ?? null,
    systemChars: input.systemChars,
    toolCount: input.toolCount,
    historyMsgs: input.historyMsgs,
    steps: input.steps ?? null,
    costUsd: costUsd(input.model, usage),
    cacheWriteTokens: writeTokens(usage),
    cacheRatio: cacheRatio(usage),
    toolsChars: input.toolsChars ?? null,
    volatileChars: input.volatileChars ?? null,
    historyChars: input.historyChars ?? null,
    toolResultChars: input.toolResultChars ?? null,
    turnKind: input.turnKind ?? null,
    durationMs: input.durationMs ?? null,
    summaryUsed: input.summaryUsed ?? null,
    tier: input.tier ?? null,
    tierChange: input.tierChange ?? null,
  }
}

export async function saveTurnUsage(sql: Sql, row: TurnUsageRow) {
  await sql`insert into turn_usage (id, chat_id, bot_id, model, input_tokens, cached_tokens, output_tokens, system_chars, tool_count, history_msgs, steps, cost_usd, cache_write_tokens, cache_ratio, tools_chars, volatile_chars, history_chars, tool_result_chars, turn_kind, duration_ms, summary_used, tier, tier_change) values (${row.id}, ${row.chatId}, ${row.botId}, ${row.model}, ${row.inputTokens}, ${row.cachedTokens}, ${row.outputTokens}, ${row.systemChars}, ${row.toolCount}, ${row.historyMsgs}, ${row.steps}, ${row.costUsd}, ${row.cacheWriteTokens}, ${row.cacheRatio}, ${row.toolsChars}, ${row.volatileChars}, ${row.historyChars}, ${row.toolResultChars}, ${row.turnKind}, ${row.durationMs}, ${row.summaryUsed === null ? null : row.summaryUsed ? 1 : 0}, ${row.tier}, ${row.tierChange})`
}
