import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4StreamPart } from "@ai-sdk/provider"

import { CHAT_MODELS } from "../chat-catalog.ts"
import { cliModel } from "./model.ts"
import { CLI_LABELS, CliError, type CliProvider } from "./types.ts"

// Automatischer Anbieterwechsel (Consti, 08.11.2026): Fällt ein Anbieter aus (Limit, abgemeldet, Fehler, leere Antwort), springt dieselbe
// Anfrage ohne Meldung zum nächstbesten Modell eines anderen Anbieters. Der Nutzer sieht nur die Antwort. Eine Fehlermeldung gibt es erst,
// wenn wirklich alle Anbieter ausgefallen sind. Greift nur, solange noch nichts von der Antwort beim Nutzer angekommen ist.

// Reihenfolge der Ausweichmodelle je Modell: anderer Anbieter zuerst (gleicher Anbieter ist bei einem Limit meist auch weg), ähnliche Stärke zuerst.
const FALLBACKS: Record<string, string[]> = {
  "claude-haiku-5-5": ["gpt-6-luna", "gemini-3.8-flash-high", "claude-sonnet-5-5", "gpt-6.1-sol"],
  "claude-sonnet-5-5": ["gpt-6.1-sol", "gemini-3.8-flash-high", "gpt-6-luna", "claude-haiku-5-5"],
  "claude-opus-5-5": ["gpt-6.1-sol", "claude-sonnet-5-5", "gemini-3.8-flash-high", "gpt-6-luna"],
  "gpt-6-luna": ["claude-haiku-5-5", "gemini-3.8-flash-high", "gpt-6.1-sol", "claude-sonnet-5-5"],
  "gpt-6.1-sol": ["claude-opus-5-5", "claude-sonnet-5-5", "gemini-3.8-flash-high", "gpt-6-luna"],
}
const GEMINI_FALLBACK = ["claude-haiku-5-5", "gpt-6-luna", "claude-sonnet-5-5", "gpt-6.1-sol"]

export function fallbackChain(modelId: string): string[] {
  const rest = FALLBACKS[modelId] ?? GEMINI_FALLBACK
  const known = new Set(CHAT_MODELS.map((model) => model.id))
  return [modelId, ...rest.filter((id) => id !== modelId && known.has(id))]
}

const providerOf = (id: string): CliProvider => CHAT_MODELS.find((model) => model.id === id)!.cli.provider

// Anbieter, die gerade ausgefallen sind, werden für kurze Zeit übersprungen (kein Warten auf einen sicheren Fehlschlag).
const COOLDOWN_MS: Record<string, number> = { limit: 10 * 60_000, login: 5 * 60_000, missing: 30 * 60_000, timeout: 90_000, failed: 90_000, empty: 90_000 }
const down = new Map<CliProvider, { until: number; code: string }>()
export const resetProviderHealth = () => down.clear()
export const providerDown = (provider: CliProvider, now = Date.now()) => {
  const entry = down.get(provider)
  return !!entry && entry.until > now
}
// Eine neue Anmeldung oder ein Neustart soll nicht auf einer alten Sperre sitzen bleiben.
export const markProviderDown = (provider: CliProvider, code: string, now = Date.now()) => {
  if (code !== "aborted") down.set(provider, { until: now + (COOLDOWN_MS[code] ?? 90_000), code })
}
export const markProviderUp = (provider: CliProvider) => down.delete(provider)

export type FailoverEvent = { from: string; to: string; code: string }
export const failoverHooks: { onSwitch?: (event: FailoverEvent) => void } = {}

export type FailoverDeps = { make: (id: string) => LanguageModelV4; now: () => number }
const defaultDeps: FailoverDeps = { make: (id) => cliModel(id), now: Date.now }

const CONTENT_FREE = new Set(["stream-start", "response-metadata", "finish"])
const codeOf = (error: unknown) => (error instanceof CliError ? error.code : "failed")

// Stufe auf das Ausweichmodell übersetzen (nicht jedes Modell hat jede Stufe), `requireAnswer` bleibt.
function adjust(options: LanguageModelV4CallOptions, id: string): LanguageModelV4CallOptions {
  const po = options.providerOptions as Record<string, Record<string, unknown>> | undefined
  const cliOptions = po?.cli
  if (!cliOptions || typeof cliOptions.effort !== "string") return options
  const entry = CHAT_MODELS.find((model) => model.id === id)!
  const { effort, ...rest } = cliOptions
  const effortOk = entry.efforts.length > 0 ? (entry.efforts as string[]).includes(effort as string) ? effort : entry.efforts.includes("medium") ? "medium" : entry.efforts[0] : undefined
  return { ...options, providerOptions: { ...po, cli: { ...rest, ...(effortOk && { effort: effortOk }) } } as never }
}
const requiresAnswer = (options: LanguageModelV4CallOptions) =>
  (options.providerOptions as Record<string, Record<string, unknown>> | undefined)?.cli?.requireAnswer === true

function summary(failures: { provider: CliProvider; code: string }[]): CliError {
  const label = (code: string) => (code === "limit" ? "Limit erreicht" : code === "login" ? "nicht angemeldet" : code === "missing" ? "nicht installiert" : "keine Antwort")
  const parts = [...new Map(failures.map((f) => [f.provider, f.code])).entries()].map(([provider, code]) => `${CLI_LABELS[provider]}: ${label(code)}`)
  const login = failures.some((f) => f.code === "login")
  return new CliError(failures[0]?.provider ?? "claude", failures.some((f) => f.code === "limit") && !login ? "limit" : login ? "login" : "failed",
    `Gerade ist kein Modell erreichbar (${parts.join(", ")}). Probiere es in ein paar Minuten noch einmal${login ? " oder melde dich unter Einrichtung neu an" : ""}.`)
}

// Reihenfolge der Versuche: erst nutzbare Anbieter, dann (als letzter Ausweg) die gerade gesperrten, damit nie ohne Versuch aufgegeben wird.
function order(modelId: string, now: number, pinned = false): string[] {
  // Fest gewähltes Modell (Consti, 10.11.2026): nie heimlich ein anderes nehmen, nur bei „Auto“ wechselt Orbit den Anbieter.
  const chain = pinned ? [modelId] : fallbackChain(modelId)
  const up = chain.filter((id) => !providerDown(providerOf(id), now))
  const dead = chain.filter((id) => providerDown(providerOf(id), now))
  // Je gesperrtem Anbieter nur ein Modell als letzter Ausweg.
  const seen = new Set<CliProvider>()
  const lastResort = dead.filter((id) => (seen.has(providerOf(id)) ? false : (seen.add(providerOf(id)), true)))
  return [...up, ...lastResort]
}

export function failoverModel(modelId: string, deps: FailoverDeps = defaultDeps, pinned = false): LanguageModelV4 {
  const mark = (id: string, code: string) => {
    if (code === "aborted") return
    down.set(providerOf(id), { until: deps.now() + (COOLDOWN_MS[code] ?? 90_000), code })
  }
  return {
    specificationVersion: "v4",
    provider: "cli.failover",
    modelId,
    supportedUrls: {},
    async doGenerate(options) {
      const failures: { provider: CliProvider; code: string }[] = []
      const ids = order(modelId, deps.now(), pinned)
      for (const [index, id] of ids.entries()) {
        try {
          const result = await deps.make(id).doGenerate(adjust(options, id))
          const empty = !result.content.some((part) => (part.type === "text" && part.text.trim()) || part.type === "tool-call")
          if (empty && requiresAnswer(options)) throw new CliError(providerOf(id), "failed", "Leere Antwort.")
          if (index > 0) failoverHooks.onSwitch?.({ from: modelId, to: id, code: failures[0]?.code ?? "failed" })
          return result
        } catch (error) {
          const code = error instanceof CliError && error.message === "Leere Antwort." ? "empty" : codeOf(error)
          if (options.abortSignal?.aborted || code === "aborted") throw error
          mark(id, code)
          failures.push({ provider: providerOf(id), code })
        }
      }
      throw summary(failures)
    },
    async doStream(options) {
      const stream = new ReadableStream<LanguageModelV4StreamPart>({
        async start(controller) {
          const failures: { provider: CliProvider; code: string }[] = []
          const ids = order(modelId, deps.now(), pinned)
          let started = false
          const begin = () => {
            if (started) return
            started = true
            controller.enqueue({ type: "stream-start", warnings: [] })
          }
          const errorEnd = (error: unknown) => {
            begin()
            controller.enqueue({ type: "error", error })
            controller.enqueue({ type: "finish", finishReason: { unified: "error", raw: undefined }, usage: { inputTokens: {}, outputTokens: {} } as never })
            controller.close()
          }
          for (const [index, id] of ids.entries()) {
            let committed = false
            let failure: unknown
            let reader: ReadableStreamDefaultReader<LanguageModelV4StreamPart> | undefined
            try {
              const result = await deps.make(id).doStream(adjust(options, id))
              reader = result.stream.getReader()
              const held: LanguageModelV4StreamPart[] = []
              const commit = () => {
                committed = true
                if (index > 0) failoverHooks.onSwitch?.({ from: modelId, to: id, code: failures[0]?.code ?? "failed" })
                begin()
                for (const part of held) controller.enqueue(part)
                held.length = 0
              }
              for (;;) {
                const { done, value } = await reader.read()
                if (done) break
                if (committed) { controller.enqueue(value); continue }
                if (value.type === "error") { failure = value.error; continue }
                if (value.type === "finish") {
                  if ((value.finishReason as { unified?: string }).unified === "error") { failure ??= new CliError(providerOf(id), "failed", "Fehler."); continue }
                  // Ende ohne jeden Inhalt: bei Pflicht-Antwort (Einzelchat) ein Ausfall, sonst legitim (eine Gruppe darf schweigen).
                  if (requiresAnswer(options)) { failure = new CliError(providerOf(id), "failed", "Leere Antwort."); continue }
                  commit()
                  controller.enqueue(value)
                  continue
                }
                if (CONTENT_FREE.has(value.type)) { if (value.type !== "stream-start") held.push(value); continue }
                commit()
                controller.enqueue(value)
              }
              if (committed) { controller.close(); return }
              failure ??= new CliError(providerOf(id), "failed", "Leere Antwort.")
            } catch (error) {
              failure = error
            } finally {
              try { reader?.releaseLock() } catch { /* schon freigegeben */ }
            }
            const code = failure instanceof CliError && failure.message === "Leere Antwort." ? "empty" : codeOf(failure)
            if (options.abortSignal?.aborted || code === "aborted") return errorEnd(failure)
            mark(id, code)
            failures.push({ provider: providerOf(id), code })
          }
          // Alle Anbieter ausgefallen: erst jetzt ein Fehler, mit klarem Satz.
          errorEnd(summary(failures))
        },
      })
      return { stream }
    },
  }
}
