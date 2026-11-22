import { CHAT_MODELS, type ChatModel } from "../chat-catalog.ts"
import { TIER_RANK, tierOfModel } from "./stage.ts"
import { getTierModel } from "./tiers.ts"
import type { JevTier } from "./types.ts"
import { z } from "zod"

export const UPGRADE_DESCRIPTION = "For a difficult subtask, switch to a stronger model before solving it. Choose coding for programming, otherwise large. Do not use for routine work."
export const upgradeInput = z.object({ kind: z.enum(["large", "coding"]) })

// Gleicher Rang ist kein Aufstieg; eine feste Modellwahl bleibt immer unangetastet.
export async function chooseUpgrade(input: {
  current: ChatModel
  tier?: JevTier
  pinned: boolean
  kind: "large" | "coding"
  available: (model: ChatModel) => Promise<boolean>
}): Promise<{ model: ChatModel; tier: "large" | "coding"; effort?: string } | undefined> {
  if (input.pinned || TIER_RANK[input.tier ?? tierOfModel(input.current.id)] >= TIER_RANK.large) return
  const alternatives = input.kind === "large" ? ["large", "coding"] as const : ["coding", "large"] as const
  for (const tier of alternatives) {
    const selection = getTierModel(tier)
    const model = CHAT_MODELS.find((entry) => entry.id === selection.model)
    if (model && await input.available(model)) return { model, tier, effort: selection.effort }
  }
}
