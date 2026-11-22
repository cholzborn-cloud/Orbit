import { decide } from "./client"
import { START_TIER } from "./stage"
import { DEFAULT_TIER, getTierModel } from "./tiers"
import { createJevInfo, type JevInfo, type JevTier } from "./types"

const criteria: Record<JevTier, string> = {
  small: "Einfache Fragen, kurze Antworten, kleine Änderungen.",
  medium: "Alltagsaufgaben, Texte und mehrschrittige normale Aufgaben.",
  large: "Komplexe Analyse, schwierige Aufgaben und anspruchsvolle Planung.",
  coding: "Programmieren, Debugging und technische Änderungen.",
}

// Jev entscheidet nie über Löschen, Senden oder Geld.
// startSmall = Beginn eines Gesprächs (oder Cache kalt): im Zweifel die kleinste Stufe (Lauf I, Entscheidung 2).
export async function routeMessage(input: {
  text: string
  hasFiles?: boolean
  startSmall?: boolean
  signal?: AbortSignal
}): Promise<JevInfo> {
  const started = Date.now()
  let spent: number | undefined
  const fallback = (reason: string, confidence?: number): JevInfo =>
    createJevInfo({
      kind: "route",
      tier: DEFAULT_TIER,
      ...getTierModel(DEFAULT_TIER),
      reason,
      ...(confidence !== undefined && { confidence }),
      durationMs: Date.now() - started,
      ...(spent !== undefined && { costUsd: spent }),
      source: "fallback",
    })
  const result = await decide(
    {
      tier: {
        type: "choice",
        instructions: input.startSmall
          ? "Wähle das kleinste Modell, das die Aufgabe gut erledigt. Im Zweifel die kleinere Stufe: größere werden später bei Bedarf zugeschaltet."
          : "Wähle das kleinste Modell, das die Aufgabe gut erledigt.",
        criteria,
      },
    },
    { text: input.text.slice(0, 2000), hasFiles: input.hasFiles ?? false },
    { signal: input.signal, timeoutMs: 3000 }
  )
  if (!result.ok) {
    console.error(`Jev: ${result.error}`)
    return fallback("Jev nicht verfügbar – Standardmodell.")
  }
  spent = result.costUsd
  const answer = result.answers.tier
  const tier = answer?.choice
  const confidence = answer?.confidence
  const knownTier = typeof tier === "string" && tier in criteria
  // Zum Start: Jev hat geantwortet, ist aber unsicher -> kleine Stufe (Start klein), kein Standardmodell.
  if (input.startSmall && knownTier && typeof confidence === "number" && confidence < 0.6)
    return createJevInfo({
      kind: "route",
      tier: START_TIER,
      ...getTierModel(START_TIER),
      reason: "Jev unsicher – kleine Stufe zum Start.",
      confidence,
      durationMs: result.durationMs,
      ...(result.costUsd !== undefined && { costUsd: result.costUsd }),
    })
  if (
    typeof tier !== "string" ||
    !(tier in criteria) ||
    typeof confidence !== "number" ||
    confidence < 0.6
  )
    return fallback(
      "Jev unsicher – Standardmodell.",
      typeof confidence === "number" ? confidence : undefined
    )

  return createJevInfo({
    kind: "route",
    tier: tier as JevTier,
    ...getTierModel(tier as JevTier),
    reason: "Passende Modellstufe für die Aufgabe.",
    confidence,
    durationMs: result.durationMs,
    ...(result.costUsd !== undefined && { costUsd: result.costUsd }),
  })
}

export async function suggestHandoff(input: {
  text: string
  orbis: { id: string; name: string; job: string; isMain: boolean }[]
  currentId: string
  signal?: AbortSignal
}): Promise<
  { targetId: string; reason: string; confidence: number } | undefined
> {
  const candidates = input.orbis.filter((orbi) => orbi.id !== input.currentId)
  if (!candidates.length) return undefined
  const result = await decide(
    {
      target: {
        type: "choice",
        instructions:
          "Wähle den Orbi, dessen Aufgabe am besten zur Anfrage passt.",
        criteria: Object.fromEntries(
          candidates.map(({ id, name, job }) => [id, `${name}: ${job}`])
        ),
      },
    },
    { text: input.text.slice(0, 2000) },
    { signal: input.signal, timeoutMs: 3000 }
  )
  if (!result.ok) return undefined
  const answer = result.answers.target
  const confidence = answer?.confidence
  const targetId = answer?.choice
  if (
    typeof targetId !== "string" ||
    !candidates.some((orbi) => orbi.id === targetId) ||
    typeof confidence !== "number" ||
    confidence < 0.75
  )
    return undefined
  return {
    targetId,
    reason: "Dieser Orbi passt am besten zur Aufgabe.",
    confidence,
  }
}
