import { execFile } from "node:child_process"

import { findBinary, cliEnv } from "./locate.ts"
import { CLI_FIX, CLI_LABELS, CLI_PROVIDERS, type CliProvider } from "./types.ts"
import { prepareCodexHome } from "./workdir.ts"
import { agyRecentlyVerified } from "./verification.ts"

// Zustand je CLI ohne Modellaufruf: Programm gefunden (`which`-Suche) und angemeldet (leichter Statusbefehl).
export type CliState = { provider: CliProvider; state: "ok" | "fehlt" | "fehler"; fix?: string; available?: boolean }
export type StatusDeps = {
  find: (provider: CliProvider) => string | undefined
  exec: (command: string, args: string[], env: Record<string, string>) => Promise<{ code: number; stdout: string; stderr: string }>
}

const defaultExec: StatusDeps["exec"] = (command, args, env) =>
  new Promise((resolve) =>
    execFile(command, args, { env, timeout: 8_000, maxBuffer: 200_000 }, (error, stdout, stderr) =>
      resolve({ code: error ? ((error as { code?: unknown }).code as number) || 1 : 0, stdout: String(stdout), stderr: String(stderr) })
    )
  )

export const statusDeps: StatusDeps = { find: (provider) => findBinary(provider), exec: defaultExec }

// Es werden nur Ja/Nein-Felder gelesen, nie Mail, Konto oder Token aus der Ausgabe.
export async function checkCli(provider: CliProvider, deps: StatusDeps = statusDeps): Promise<CliState> {
  const binary = deps.find(provider)
  if (!binary) return { provider, state: "fehlt", fix: CLI_FIX[provider].missing }
  const login = { provider, state: "fehler" as const, fix: CLI_FIX[provider].login }
  try {
    if (provider === "claude") {
      const result = await deps.exec(binary, ["auth", "status"], cliEnv(binary))
      try {
        return (JSON.parse(result.stdout) as { loggedIn?: unknown }).loggedIn === true ? { provider, state: "ok" } : login
      } catch {
        return result.code === 0 ? { provider, state: "ok" } : login
      }
    }
    if (provider === "codex") {
      const result = await deps.exec(binary, ["login", "status"], cliEnv(binary, { CODEX_HOME: prepareCodexHome() }))
      return result.code === 0 && /logged in/i.test(`${result.stdout}${result.stderr}`) ? { provider, state: "ok" } : login
    }
    if (provider === "agy") {
      const result = await deps.exec(binary, ["models"], cliEnv(binary))
      return result.code === 0 && /gemini-3\.8-flash/i.test(result.stdout)
        ? agyRecentlyVerified()
          ? { provider, state: "ok" }
          : { provider, state: "fehler", available: true, fix: "Antigravity und seine Modelle sind vorhanden; die Anmeldung ist ohne aktuellen Modellaufruf nicht geprüft." }
        : login
    }
    return { provider, state: "fehler", fix: "Gemini-CLI ist vorhanden, ihre Anmeldung wurde noch nicht geprüft." }
  } catch {
    return login
  }
}

export const checkAllClis = (deps: StatusDeps = statusDeps) => Promise.all(CLI_PROVIDERS.map((provider) => checkCli(provider, deps)))
export const cliLabel = (provider: CliProvider) => CLI_LABELS[provider]
