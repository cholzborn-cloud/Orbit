import { CLI_LABELS } from "../cli/types.ts"
import type { CliState } from "../cli/status.ts"

// Einrichtungs-Check (Phase 5): jeder Dienst ist ok, fehlt (Schlüssel nicht gesetzt) oder hat einen Fehler. Die Antwort nennt nie einen Wert,
// nur den Zustand und einen Satz „So behebst du es“. Die Mitteilungs-Erlaubnis prüft die Mac-App selbst.
export type CheckState = "ok" | "fehlt" | "fehler"
export type HealthCheck = {
  id: "claude" | "codex" | "gemini" | "agy" | "daytona" | "jev" | "brain" | "plugins"
  label: string
  state: CheckState
  // Nur bei fehlt/fehler: ein Satz, wie es behoben wird.
  fix?: string
  // Schlüssel, den die App unter „Einrichtung“ setzen kann (Name der Umgebungsvariablen, kein Wert).
  key?: string
  // Optionale Dienste färben die Gesamtanzeige nicht rot.
  optional?: boolean
}

export type HealthDeps = {
  env: Record<string, string | undefined>
  fetch: typeof fetch
  // Zustand der offiziellen CLIs (claude, codex, gemini), ohne Modellaufruf.
  clis: () => Promise<CliState[]>
  daytonaPing: () => Promise<void>
  brainPath: () => string | undefined
  brainReadable: (path: string) => boolean
  pluginsConfigured: () => Promise<boolean>
  timeoutMs?: number
}

export const KEY_NAMES = {
  daytona: "DAYTONA_API_KEY",
  jev: "OPENROUTER_JEV_API_KEY",
} as const

const withTimeout = async <T>(work: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function runHealth(deps: HealthDeps): Promise<HealthCheck[]> {
  const ms = deps.timeoutMs ?? 4_000
  const has = (name: string) => !!deps.env[name]?.trim()

  const CLI_TITLES = { claude: "Claude (claude-CLI)", codex: "GPT (codex-CLI)", gemini: "Gemini (gemini-CLI)", agy: "Google (Antigravity-CLI)" } as const
  const cliChecks = async (): Promise<HealthCheck[]> => {
    let states: CliState[] = []
    try {
      states = await withTimeout(deps.clis(), ms * 2)
    } catch {
      /* unten: als Fehler melden */
    }
    return (["claude", "codex", "gemini", "agy"] as const).map((provider): HealthCheck => {
      const found = states.find((state) => state.provider === provider)
      const base = { id: provider, label: CLI_TITLES[provider], optional: provider !== "claude" }
      if (!found) return { ...base, state: "fehler", fix: `${CLI_LABELS[provider]} lässt sich gerade nicht prüfen. Versuche es gleich noch einmal.` }
      return found.state === "ok" ? { ...base, state: "ok" } : { ...base, state: found.state, fix: found.fix }
    })
  }

  const daytona = async (): Promise<HealthCheck> => {
    const base = { id: "daytona" as const, label: "Daytona", key: KEY_NAMES.daytona }
    if (!has(KEY_NAMES.daytona))
      return { ...base, state: "fehlt", fix: "Setze den Daytona-Schlüssel unter Einrichtung, sonst haben Orbis keine Sandbox." }
    try {
      await withTimeout(deps.daytonaPing(), ms)
      return { ...base, state: "ok" }
    } catch {
      return { ...base, state: "fehler", fix: "Daytona nimmt den Schlüssel nicht an oder ist nicht erreichbar. Setze einen neuen Schlüssel." }
    }
  }

  const jev = async (): Promise<HealthCheck> => {
    const base = { id: "jev" as const, label: "Jev", key: KEY_NAMES.jev, optional: true }
    if (!has(KEY_NAMES.jev))
      return { ...base, state: "fehlt", fix: "Setze den Jev-Schlüssel unter Einrichtung. Ohne ihn nutzt „Auto“ immer das Standardmodell." }
    try {
      const response = await withTimeout(
        deps.fetch("https://openrouter.ai/api/v1/key", {
          headers: { Authorization: `Bearer ${deps.env[KEY_NAMES.jev]}` },
          signal: AbortSignal.timeout(ms),
        }),
        ms
      )
      if (response.status === 401 || response.status === 403)
        return { ...base, state: "fehler", fix: "Der Jev-Schlüssel ist ungültig. Setze einen neuen Schlüssel." }
      return response.ok
        ? { ...base, state: "ok" }
        : { ...base, state: "fehler", fix: "Jev antwortet gerade nicht richtig. Versuche es später erneut." }
    } catch {
      return { ...base, state: "fehler", fix: "Jev ist nicht erreichbar. Prüfe die Internetverbindung." }
    }
  }

  const brain = async (): Promise<HealthCheck> => {
    const path = deps.brainPath()
    const base = { id: "brain" as const, label: "Brain", optional: true }
    if (!path) return { ...base, state: "fehlt", fix: "Der Brain-Ordner wurde nicht gefunden. Lege ihn an oder setze ORBIT_BRAIN_PATH." }
    return deps.brainReadable(path)
      ? { ...base, state: "ok" }
      : { ...base, state: "fehler", fix: "Der Brain-Ordner ist nicht lesbar. Prüfe die Rechte des Ordners." }
  }

  const plugins = async (): Promise<HealthCheck> => {
    const base = { id: "plugins" as const, label: "Plugin-Store", optional: true }
    try {
      return (await withTimeout(deps.pluginsConfigured(), ms))
        ? { ...base, state: "ok" }
        : { ...base, state: "fehlt", fix: "Richte Composio im Plugin-Store ein, wenn du Dienste verbinden willst." }
    } catch {
      return { ...base, state: "fehler", fix: "Der Plugin-Store antwortet nicht. Versuche es später erneut." }
    }
  }

  const [clis, rest] = await Promise.all([cliChecks(), Promise.all([daytona(), jev(), brain(), plugins()])])
  return [...clis, ...rest]
}
