import { CHAT_MODELS } from "../chat-catalog.ts"
import type { JevTier } from "./types"

export const DEFAULT_TIER: JevTier = "medium"

const mapping: Record<JevTier, { model: string; effort: string }> = {
  small: { model: "claude-haiku-5-5", effort: "medium" },
  medium: { model: "claude-sonnet-5-5", effort: "medium" },
  large: { model: "claude-opus-5-5", effort: "medium" },
  coding: { model: "gpt-6.1-sol", effort: "medium" },
}

export function getTierModel(tier: JevTier) {
  const selected = mapping[tier]
  const model = CHAT_MODELS.find(({ id }) => id === selected.model)
  if (!model)
    throw new Error(`Modell für Jev-Stufe ${tier} fehlt im Chat-Katalog.`)
  return {
    model: model.id,
    modelLabel: model.label,
    ...(model.efforts.includes(
      selected.effort as (typeof model.efforts)[number]
    ) && {
      effort: selected.effort,
    }),
  }
}
