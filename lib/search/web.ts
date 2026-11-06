import { z } from "zod"

import { CHAT_MODELS } from "../chat-catalog.ts"
import { runProcess } from "../cli/process.ts"
import { buildSearchSpawn, createSearchParser, SEARCH_FIX, searchNeedsClaude, type SearchSource, type SearchUsage } from "../cli/search.ts"
import { CliError, type ProcessRunner } from "../cli/types.ts"

export type { SearchSource, SearchUsage }

// Websuche läuft über die claude-CLI (Haiku, nur das Werkzeug WebSearch).
export const SEARCH_MODEL = "claude-haiku-5-5"
const TIMEOUT_MS = 90_000
const QUERY_SCHEMA = z.string().trim().min(1).max(500)

// Austauschbar für Tests (Attrappe statt echtem Prozess).
export const webDeps: { runner: ProcessRunner; timeoutMs: number } = { runner: runProcess, timeoutMs: TIMEOUT_MS }

export async function webSearch({
  query,
  signal,
}: {
  query: string
  signal?: AbortSignal
}): Promise<
  | { ok: true; answer: string; sources: SearchSource[]; usage?: SearchUsage }
  | { ok: false; error: string }
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
    for await (const line of webDeps.runner(spawn, { signal: requestSignal, timeoutMs: webDeps.timeoutMs })) parser.push(line)
    const outcome = parser.finish()
    if (!outcome.ok) {
      if (outcome.code === "login") return { ok: false, error: searchNeedsClaude(SEARCH_FIX.login) }
      if (outcome.code === "limit") return { ok: false, error: "Die Websuche ist gerade ausgelastet. Bitte versuche es später erneut." }
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
