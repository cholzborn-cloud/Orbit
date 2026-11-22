import { CHAT_MODELS, type ChatModel } from "../chat-catalog.ts"
import { type ClientData, type Sql } from "../chat/load-chat"
import { DEFAULT_TIER, getTierModel } from "./tiers"
import { routeMessage } from "./route"
import {
  decideStage,
  isWarm,
  MAX_RANK,
  type StageChange,
  type StageDecision,
  type StageState,
} from "./stage"
import {
  AUTO_MODEL_ID,
  createJevInfo,
  type JevInfo,
  type JevSettings,
  type JevTier,
} from "./types"

export type ResolveDependencies = {
  route: typeof routeMessage
  loadSettings: (userId: string) => Promise<JevSettings>
}

const dependencies: ResolveDependencies = {
  route: routeMessage,
  loadSettings: loadJevSettings,
}

export async function loadJevSettings(
  _userId: string,
  _options: { sql?: Sql | null } = {}
): Promise<JevSettings> {
  return { auto: true, handoff: true }
}

// Passt die Stufe nicht zum Modell (oder fehlt sie), gilt die Standardstufe des Modells statt eines Fehlers:
// Mid, sonst die erste. Modelle ohne Stufen bekommen keine.
export function normalizeEffort(model: ChatModel, effort?: string) {
  if (model.efforts.length === 0) return undefined
  if (effort && model.efforts.some((e) => e === effort)) return effort
  return model.efforts.includes("medium") ? "medium" : model.efforts[0]
}

export type ResolvedModel = {
  model: ChatModel
  effort?: string
  jev?: JevInfo
  // Lauf I: was die Stufung entschieden hat. `persist` = merken (nur echte Jev-Entscheidungen). Ohne `stage`: Modell fest gewählt.
  stage?: { change: StageChange; tier: JevTier; persist: boolean }
}

export async function resolveModel(
  clientData: ClientData | undefined,
  userText: string,
  options: {
    userId?: string
    settings?: JevSettings
    settingsError?: boolean
    hasFiles?: boolean
    signal?: AbortSignal
    dependencies?: ResolveDependencies
    // Gemerktes Modell dieses Gesprächs und Orbis (null = keins) und die Uhrzeit; ohne Angabe wie ein neues Gespräch.
    stage?: { state: StageState | null; now?: number }
  } = {}
): Promise<ResolvedModel> {
  const { hasFiles, signal } = options
  const deps = options.dependencies ?? dependencies
  if (clientData?.model !== AUTO_MODEL_ID) {
    const model = CHAT_MODELS.find(({ id }) => id === clientData?.model)
    if (!model) throw new Error("Unbekanntes Modell")
    return { model, effort: normalizeEffort(model, clientData?.effort) }
  }

  let settings = options.settings
  let settingsError = options.settingsError ?? false
  if (!settings && options.userId)
    try {
      settings = await deps.loadSettings(options.userId)
    } catch {
      settings = { auto: false, handoff: false }
      settingsError = true
    }
  const routeStarted = Date.now()
  // Start klein, nur nach oben: Warm = Modell des Gesprächs bleibt, Jev darf höchstens hochstufen (siehe stage.ts).
  const staged = settings?.auto !== false && !settingsError
  const state = options.stage?.state ?? null
  const now = options.stage?.now ?? Date.now()
  const warm = staged && isWarm(state, now)
  if (warm && state!.rank >= MAX_RANK) {
    const kept = keepRemembered(state!, "Bleibt bei {model} (höchste Stufe, Cache warm).", routeStarted)
    if (kept) return kept
  }
  const selected =
    settings?.auto === false
      ? undefined
      : await routeWithTimeout(
          deps.route,
          userText.slice(0, 2000),
          hasFiles,
          signal,
          !warm
        )
  if (staged) {
    const answer =
      selected && selected.source === "jev" && selected.tier
        ? { tier: selected.tier, confidence: selected.confidence }
        : undefined
    const decision = decideStage({ state, now, answer })
    if (decision.useRemembered) {
      const kept = keepRemembered(state!, "Bleibt bei {model} (Cache warm).", routeStarted, selected)
      if (kept) return kept
    }
    if (decision.change === "upgrade" || decision.change === "reset" || decision.change === "start") {
      const model = CHAT_MODELS.find(({ id }) => id === selected!.model)
      if (!model) throw new Error("Jev-Modell ist nicht verfügbar.")
      const from = state && CHAT_MODELS.find(({ id }) => id === state.model)?.label
      const reason =
        decision.change === "upgrade"
          ? `Hochgestuft von ${from} auf ${model.label}.`
          : decision.change === "reset"
            ? `Pause, Cache kalt – neu gewählt: ${model.label}.`
            : `Start klein: ${selected!.reason}`
      return {
        model,
        effort: normalizeEffort(model, selected!.effort),
        jev: { ...selected!, reason, change: decision.change, ...(from && decision.change === "upgrade" && { from }) },
        stage: stageOf(decision),
      }
    }
    // Ausfall oder unsicher ohne Vorgeschichte: Standardmodell, nichts merken.
    const fallbackResult = selected ?? undefined
    if (fallbackResult) {
      const model = CHAT_MODELS.find(({ id }) => id === fallbackResult.model)
      if (!model) throw new Error("Jev-Modell ist nicht verfügbar.")
      return {
        model,
        effort: normalizeEffort(model, fallbackResult.effort),
        jev: { ...fallbackResult, change: "fallback" },
        stage: stageOf(decision),
      }
    }
  }
  const result =
    selected ??
    createJevInfo({
      kind: "route" as const,
      tier: DEFAULT_TIER,
      ...getTierModel(DEFAULT_TIER),
      reason: "Jev nicht verfügbar – Standardmodell.",
      durationMs: Date.now() - routeStarted,
      source: "fallback" as const,
    })
  const model = CHAT_MODELS.find(({ id }) => id === result.model)
  if (!model) throw new Error("Jev-Modell ist nicht verfügbar.")
  return {
    model,
    effort: normalizeEffort(model, result.effort),
    ...(staged && { stage: { change: "fallback" as const, tier: DEFAULT_TIER, persist: false } }),
    ...(settingsError
      ? {
          jev: createJevInfo({
            kind: "route",
            tier: DEFAULT_TIER,
            ...getTierModel(DEFAULT_TIER),
            reason:
              "Jev-Einstellungen konnten nicht geladen werden – Standardmodell.",
            durationMs: Date.now() - routeStarted,
            source: "fallback",
          }),
        }
      : settings?.auto !== false && { jev: result }),
  }
}

// Gemerktes Modell weiter benutzen. Gibt undefined zurück, wenn es das Modell nicht mehr gibt (dann wird neu gewählt).
function keepRemembered(state: StageState, template: string, started: number, asked?: JevInfo): ResolvedModel | undefined {
  const model = CHAT_MODELS.find(({ id }) => id === state.model)
  if (!model) return undefined
  return {
    model,
    effort: normalizeEffort(model, state.effort),
    jev: createJevInfo({
      kind: "route",
      tier: state.tier,
      model: model.id,
      modelLabel: model.label,
      ...(state.effort && { effort: state.effort }),
      reason: template.replace("{model}", model.label),
      durationMs: Date.now() - started,
      ...(asked?.costUsd !== undefined && { costUsd: asked.costUsd }),
      ...(asked?.confidence !== undefined && { confidence: asked.confidence }),
      source: asked?.source === "jev" ? "jev" : "fallback",
      change: "keep",
    }),
    stage: { change: "keep", tier: state.tier, persist: false },
  }
}

const stageOf = (d: StageDecision) => ({ change: d.change, tier: d.tier, persist: d.persist })

async function routeWithTimeout(
  route: typeof routeMessage,
  text: string,
  hasFiles?: boolean,
  signal?: AbortSignal,
  startSmall?: boolean
): Promise<JevInfo | undefined> {
  const controller = new AbortController()
  const abort = () => controller.abort(signal?.reason)
  if (signal?.aborted) abort()
  else signal?.addEventListener("abort", abort, { once: true })
  let timeout: ReturnType<typeof setTimeout>
  try {
    return await Promise.race([
      route({ text, hasFiles, startSmall, signal: controller.signal }),
      new Promise<undefined>((resolve) => {
        timeout = setTimeout(() => {
          controller.abort()
          resolve(undefined)
        }, 8000)
      }),
    ])
  } catch {
    return undefined
  } finally {
    clearTimeout(timeout!)
    signal?.removeEventListener("abort", abort)
  }
}
