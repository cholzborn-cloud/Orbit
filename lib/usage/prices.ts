import { readFileSync } from "node:fs"
import type { LanguageModelUsage } from "ai"

import defaults from "./prices.json" with { type: "json" }

export type ModelPrice = {
  input: number
  output: number
  cacheRead?: number
  cacheWrite?: number
}

// Preise je 1 Mio. Tokens aus der Konfig-Datei `prices.json` (oder ORBIT_PRICES_PATH). Unbekanntes Modell = keine Kosten (null).
let loaded: { path: string | undefined; models: Record<string, ModelPrice> } | undefined

function pricesOf(): Record<string, ModelPrice> {
  const path = process.env.ORBIT_PRICES_PATH
  if (loaded && loaded.path === path) return loaded.models
  let models = defaults.models as Record<string, ModelPrice>
  if (path) {
    try {
      const parsed = JSON.parse(readFileSync(path, "utf8")) as { models?: Record<string, ModelPrice> }
      if (parsed.models && typeof parsed.models === "object") models = parsed.models
    } catch {
      console.error("Preisdatei nicht lesbar, es gelten die Standardpreise.")
    }
  }
  loaded = { path, models }
  return models
}

export type TokenCounts = {
  noCache: number
  cacheRead: number
  cacheWrite: number
  output: number
}

// Aufteilung der Eingabe-Tokens. Anbieter, die nur `inputTokens` liefern, gelten als ungecacht.
export function tokenCounts(usage: LanguageModelUsage | undefined): TokenCounts | null {
  if (!usage || usage.inputTokens == null) return null
  const details = usage.inputTokenDetails
  const cacheRead = details?.cacheReadTokens ?? 0
  const cacheWrite = writeTokens(usage) ?? 0
  // Meldet ein Anbieter die Eingabe ohne Cache-Tokens (Anthropic-Form), kann der Rest negativ werden: dann 0.
  const noCache = Math.max(0, details?.noCacheTokens ?? usage.inputTokens - cacheRead - cacheWrite)
  return { noCache, cacheRead, cacheWrite, output: usage.outputTokens ?? 0 }
}

// Schreib-Tokens des Caches: Standardfeld, sonst die rohen Anbieterfelder (Anthropic-Form).
export function writeTokens(usage: LanguageModelUsage | undefined): number | null {
  const direct = usage?.inputTokenDetails?.cacheWriteTokens
  if (typeof direct === "number") return direct
  const raw = usage?.raw as Record<string, unknown> | undefined
  const value = raw?.cache_creation_input_tokens
  return typeof value === "number" ? value : null
}

export function costUsd(model: string, usage: LanguageModelUsage | undefined): number | null {
  const price = pricesOf()[model]
  const counts = tokenCounts(usage)
  if (!price || !counts) return null
  const perToken = (rate: number) => rate / 1_000_000
  return (
    counts.noCache * perToken(price.input) +
    counts.cacheRead * perToken(price.cacheRead ?? price.input) +
    counts.cacheWrite * perToken(price.cacheWrite ?? price.input) +
    counts.output * perToken(price.output)
  )
}

// Anteil der Eingabe, der aus dem Cache kam (0..1); null ohne Angabe.
export function cacheRatio(usage: LanguageModelUsage | undefined): number | null {
  if (!usage?.inputTokens) return null
  const read = usage.inputTokenDetails?.cacheReadTokens
  return typeof read === "number" ? read / usage.inputTokens : null
}
