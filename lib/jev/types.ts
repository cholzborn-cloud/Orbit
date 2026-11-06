export const AUTO_MODEL_ID = "auto"

export type JevTier = "small" | "medium" | "large" | "coding"

export type JevInfo = {
  kind: "route" | "handoff" | "summary" | "memory"
  tier?: JevTier
  model?: string
  modelLabel?: string
  effort?: string
  reason: string
  confidence?: number
  durationMs: number
  costUsd?: number
  source: "jev" | "fallback"
  target?: string
  // Lauf I: was die Stufung getan hat (start, keep, upgrade, reset, fallback) und von welchem Modell aus.
  change?: "start" | "keep" | "upgrade" | "reset" | "pinned" | "fallback"
  from?: string
}

export type JevSettings = { auto: boolean; handoff: boolean }

export function createJevInfo(
  input: Omit<JevInfo, "source"> & { source?: JevInfo["source"] }
): JevInfo {
  return { source: "jev", ...input }
}
