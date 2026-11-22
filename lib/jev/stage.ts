import type Database from "better-sqlite3"

import { CHAT_MODELS } from "../chat-catalog.ts"
import { DEFAULT_TIER, getTierModel } from "./tiers.ts"
import type { JevTier } from "./types.ts"

// Start klein, nur nach oben (Phase 4, Lauf I, Entscheidung 2).
// Ein Modellwechsel mitten im Gespräch wirft den Prompt-Cache weg. Deshalb merkt sich der Dienst je Gespräch und Orbi das zuletzt
// benutzte Modell samt Stufe und lässt Jev nur noch eine HÖHERE Stufe wählen. Nach einer Pause, in der der Cache ohnehin kalt
// geworden ist, darf frei neu gewählt werden. Ein vom Nutzer gewähltes Modell (nicht „auto“) berührt dieses Gedächtnis nie.

// Anthropic hält den Cache 5 Minuten ab dem letzten Zugriff (Lauf G); danach ist er kalt.
export const COLD_AFTER_MS = 5 * 60_000
// Zum Start reicht eine sichere Wahl (wie bisher); eine Hochstufung bei warmem Cache braucht mehr Sicherheit, weil sie den
// Cache kostet.
export const START_CONFIDENCE = 0.6
export const UPGRADE_CONFIDENCE = 0.75
export const START_TIER: JevTier = "small"

// Rang der Stufen: small < medium < large. „coding“ (GPT-Sol) steht auf Höhe von large: von medium aus eine Hochstufung,
// von large aus kein Wechsel (anderer Anbieter, sonst nur seitwärts, und der Cache wäre weg).
export const TIER_RANK: Record<JevTier, number> = { small: 0, medium: 1, large: 2, coding: 2 }
export const MAX_RANK = 2

export type StageChange = "start" | "keep" | "upgrade" | "reset" | "pinned" | "fallback"

export type StageState = {
  model: string
  effort?: string
  tier: JevTier
  rank: number
  lastTurnAt: number
}

export const isWarm = (state: StageState | null | undefined, now: number) =>
  !!state &&
  now - state.lastTurnAt < COLD_AFTER_MS &&
  CHAT_MODELS.some((model) => model.id === state.model)

// Stufe zu einem Modell (für gespeicherte Zustände): Modelle ohne Jev-Stufe gelten als medium.
export function tierOfModel(modelId: string): JevTier {
  for (const tier of Object.keys(TIER_RANK) as JevTier[])
    if (getTierModel(tier).model === modelId) return tier
  return DEFAULT_TIER
}

export type StageDecision = {
  change: StageChange
  tier: JevTier
  // Nur eine Entscheidung, die Jev wirklich getroffen hat, wird gemerkt; ein Ausfall setzt keine Untergrenze.
  persist: boolean
  // Das gemerkte Modell weiter benutzen (statt des Jev-Vorschlags).
  useRemembered: boolean
}

export type JevAnswer = { tier: JevTier; confidence?: number } | undefined

// Reine Entscheidung. `answer` = Antwort von Jev (undefined = nicht verfügbar, Fehler oder unsicher).
export function decideStage(input: { state: StageState | null | undefined; now: number; answer: JevAnswer }): StageDecision {
  const { state, now, answer } = input
  if (isWarm(state, now)) {
    const current = state!
    if (answer && TIER_RANK[answer.tier] > current.rank && (answer.confidence ?? 0) >= UPGRADE_CONFIDENCE)
      return { change: "upgrade", tier: answer.tier, persist: true, useRemembered: false }
    return { change: "keep", tier: current.tier, persist: false, useRemembered: true }
  }
  if (!answer) return { change: "fallback", tier: DEFAULT_TIER, persist: false, useRemembered: false }
  return { change: state ? "reset" : "start", tier: answer.tier, persist: true, useRemembered: false }
}

type Row = { model: string; effort: string | null; tier: string; rank: number; last_turn_at: number }

export function loadStage(db: Database.Database, chatId: string, botId: string): StageState | null {
  const row = db
    .prepare("select model, effort, tier, rank, last_turn_at from chat_model_state where chat_id = ? and bot_id = ?")
    .get(chatId, botId) as Row | undefined
  if (!row || !(row.tier in TIER_RANK)) return null
  return {
    model: row.model,
    ...(row.effort && { effort: row.effort }),
    tier: row.tier as JevTier,
    rank: row.rank,
    lastTurnAt: row.last_turn_at,
  }
}

export function saveStage(
  db: Database.Database,
  chatId: string,
  botId: string,
  stage: { model: string; effort?: string; tier: JevTier },
  now = Date.now()
) {
  db.prepare(
    `insert into chat_model_state (chat_id, bot_id, model, effort, tier, rank, last_turn_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (chat_id, bot_id) do update set model = excluded.model, effort = excluded.effort, tier = excluded.tier,
       rank = excluded.rank, last_turn_at = excluded.last_turn_at, updated_at = excluded.updated_at`
  ).run(chatId, botId, stage.model, stage.effort ?? null, stage.tier, TIER_RANK[stage.tier], now, now)
}

// Der Cache wurde gerade benutzt (Turn begonnen oder beendet): die Warm-Uhr läuft neu.
export function touchStage(db: Database.Database, chatId: string, botId: string, now = Date.now()) {
  db.prepare("update chat_model_state set last_turn_at = ? where chat_id = ? and bot_id = ?").run(now, chatId, botId)
}
