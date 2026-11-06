export const ORBI_STATUSES = [
  "ruhig",
  "denkt",
  "arbeitet",
  "wartet",
  "blockiert",
  "fertig",
] as const

export type OrbiStatus = (typeof ORBI_STATUSES)[number]
export type ChatStatusInput = {
  chatStatus: "ready" | "submitted" | "streaming" | "error"
  lastAssistant?: {
    createdAt?: number
    parts?: { type: string; state?: string; toolName?: string }[]
  } | null
  error?: unknown
  now?: number
}

export const ORBI_STATUS_DESCRIPTIONS: Record<OrbiStatus, string> = {
  ruhig: "Ruhig",
  denkt: "Denkt nach …",
  arbeitet: "Arbeitet gerade",
  wartet: "Wartet auf deine Freigabe",
  blockiert: "Kann gerade nicht weiterarbeiten",
  fertig: "Fertig",
}

export function orbiStatus(input: ChatStatusInput): OrbiStatus {
  const { chatStatus, lastAssistant, error, now = Date.now() } = input
  if (error || chatStatus === "error") return "blockiert"
  const parts = lastAssistant?.parts ?? []
  if (
    parts.some(
      (part) =>
        part.state === "approval-requested" ||
        (part.type === "tool-ask_user" && part.state === "input-available")
    )
  )
    return "wartet"
  if (
    parts.some(
      (part) =>
        part.type.startsWith("tool-") &&
        ["input-streaming", "input-available"].includes(part.state ?? "")
    )
  )
    return "arbeitet"
  if (
    parts.some(
      (part) =>
        part.type.includes("handoff") &&
        !["output-available", "output-error", "output-denied"].includes(
          part.state ?? ""
        )
    )
  )
    return "arbeitet"
  if (chatStatus === "streaming" || chatStatus === "submitted") return "denkt"
  if (
    lastAssistant?.createdAt !== undefined &&
    now - lastAssistant.createdAt >= 0 &&
    now - lastAssistant.createdAt < 4000
  )
    return "fertig"
  return "ruhig"
}
