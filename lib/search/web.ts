import { z } from "zod"

import { CHAT_MODELS } from "../chat-catalog.ts"
import { runProcess } from "../cli/process.ts"
import { buildSearchSpawn, createSearchParser, SEARCH_FIX, searchNeedsClaude, type SearchSource, type SearchUsage } from "../cli/search.ts"
import { markProviderDown, providerDown } from "../cli/failover.ts"
import { CliError, type ProcessRunner } from "../cli/types.ts"
import { ALT_SEARCH_PROVIDERS, runAltSearch } from "./alt.ts"

export type { SearchSource, SearchUsage }

// Websuche läuft über die claude-CLI (Haiku, nur das Werkzeug WebSearch).
export const SEARCH_MODEL = "claude-haiku-5-5"
const TIMEOUT_MS = 90_000
const QUERY_SCHEMA = z.string().trim().min(1).max(500)

// Austauschbar für Tests (Attrappe statt echtem Prozess).
export const webDeps: { runner: ProcessRunner; timeoutMs: number } = { runner: runProcess, timeoutMs: TIMEOUT_MS }

async function claudeSearch({
  query,
  signal,
}: {
  query: string
  signal?: AbortSignal
}): Promise<
  | { ok: true; answer: string; sources: SearchSource[]; usage?: SearchUsage }
  | { ok: false; error: string; fatal?: boolean }
> {
  const parsed = QUERY_SCHEMA.safeParse(query)
  if (!parsed.success)
    return { ok: false, error: "Bitte gib eine Suchanfrage mit 1 bis 500 Zeichen an." }
  if (!CHAT_MODELS.some((model) => model.cli.model === SEARCH_MODEL))
    return { ok: false, error: "Die Websuche ist nicht eingerichtet (Suchmodell fehlt)." }
  const timeoutController = new AbortController()
  const timeout = setTimeout(() => timeoutController.abort(), webDeps.timeoutMs)
  const requestSignal = signal ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal
  try {
    const spawn = buildSearchSpawn(parsed.data, SEARCH_MODEL)
    const parser = createSearchParser()
    // Beendet sich die CLI mit Code 1, steht die eigentliche Ursache (abgemeldet, Limit) trotzdem im Ergebnis-Eintrag der Ausgabe:
    // erst diesen auswerten, statt „CLI mit Fehler beendet (Code 1)“ zu melden (Live-Test 08.11.2026: dreimal dieselbe Absage, das Modell wiederholte die Suche).
    let exitError: unknown
    try {
      for await (const line of webDeps.runner(spawn, { signal: requestSignal, timeoutMs: webDeps.timeoutMs })) parser.push(line)
    } catch (error) {
      if (!(error instanceof CliError) || error.code !== "failed") throw error
      exitError = error
    }
    const outcome = parser.finish()
    if (!outcome.ok && exitError && !(outcome.code === "login" || outcome.code === "limit")) throw exitError
    if (!outcome.ok) {
      if (outcome.code === "login") return { ok: false, fatal: true, error: searchNeedsClaude(SEARCH_FIX.login) }
      if (outcome.code === "limit") return { ok: false, fatal: true, error: "Die Websuche ist gerade ausgelastet (Claude-Limit erreicht). Bitte versuche es später erneut." }
      return { ok: false, error: outcome.message }
    }
    if (!outcome.answer) return { ok: false, error: "Die Websuche hat keine Antwort zurückgegeben." }
    return outcome
  } catch (error) {
    if (signal?.aborted) return { ok: false, error: "Die Websuche wurde abgebrochen." }
    if (timeoutController.signal.aborted || (error instanceof CliError && error.code === "timeout"))
      return { ok: false, error: "Die Websuche hat zu lange gedauert. Bitte versuche es erneut." }
    if (error instanceof CliError && error.code === "missing") return { ok: false, error: searchNeedsClaude(SEARCH_FIX.missing) }
    if (error instanceof CliError && error.code === "aborted") return { ok: false, error: "Die Websuche wurde abgebrochen." }
    if (error instanceof CliError) return { ok: false, error: `Die Websuche ist fehlgeschlagen. ${error.message}`.trim() }
    return { ok: false, error: "Die Websuche ist fehlgeschlagen. Prüfe unter Einrichtung, ob Claude angemeldet ist." }
  } finally {
    clearTimeout(timeout)
  }
}

// Alle Anbieter können suchen: erst Claude (WebSearch), fällt der aus oder liefert nichts, GPT (Codex-Websuche), dann Gemini (Antigravity).
// Anbieter, die gerade ausgefallen sind, kommen zuletzt. Erst wenn alle scheitern, gibt es einen Fehler (mit der Ursache des ersten).
type Result = Awaited<ReturnType<typeof claudeSearch>>
export async function webSearch(input: { query: string; signal?: AbortSignal }): Promise<Result> {
  const parsed = QUERY_SCHEMA.safeParse(input.query)
  if (!parsed.success) return { ok: false, error: "Bitte gib eine Suchanfrage mit 1 bis 500 Zeichen an." }
  const providers = ["claude", ...ALT_SEARCH_PROVIDERS] as const
  const ordered = [...providers.filter((p) => !providerDown(p)), ...providers.filter((p) => providerDown(p))]
  const failures: Extract<Result, { ok: false }>[] = []
  for (const provider of ordered) {
    if (input.signal?.aborted) return { ok: false, error: "Die Websuche wurde abgebrochen." }
    if (provider === "claude") {
      const result = await claudeSearch(input)
      if (result.ok) return result
      if (input.signal?.aborted) return result
      markProviderDown("claude", result.fatal ? (/Limit|ausgelastet/.test(result.error) ? "limit" : "login") : "failed")
      failures.push(result)
      continue
    }
    try {
      const timeout = AbortSignal.timeout(webDeps.timeoutMs)
      const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
      const alt = await runAltSearch(provider, parsed.data, (spawn) => webDeps.runner(spawn, { signal, timeoutMs: webDeps.timeoutMs }))
      return { ok: true, answer: alt.answer, sources: alt.sources }
    } catch (error) {
      if (input.signal?.aborted) return { ok: false, error: "Die Websuche wurde abgebrochen." }
      markProviderDown(provider, error instanceof CliError ? error.code : "failed")
      failures.push({ ok: false, error: error instanceof CliError ? error.message : "Die Websuche ist fehlgeschlagen." })
    }
  }
  const first = failures[0] ?? { ok: false as const, error: "Die Websuche ist fehlgeschlagen." }
  // Nur „endgültig“ (keine weiteren Versuche in dieser Antwort), wenn alle Anbieter an Anmeldung oder Limit scheitern.
  const allFatal = failures.length === providers.length && failures.every((f) => f.fatal || /Limit|nicht angemeldet|ausgelastet/.test(f.error))
  return { ok: false, error: first.error, ...(allFatal && { fatal: true }) }
}
