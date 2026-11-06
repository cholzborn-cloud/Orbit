import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join } from "node:path"

import type { CliProvider } from "./types.ts"

const NAMES: Record<CliProvider, string> = { claude: "claude", codex: "codex", gemini: "gemini", agy: "agy" }

// Der Hintergrunddienst (LaunchAgent) hat einen kurzen PATH; deshalb zusätzlich die üblichen Orte.
export function searchDirs(env: Record<string, string | undefined> = process.env, home = homedir()): string[] {
  const dirs = (env.PATH ?? "").split(delimiter).filter(Boolean)
  dirs.push(join(home, ".local", "bin"), "/opt/homebrew/bin", "/usr/local/bin", join(home, ".npm-global", "bin"), join(home, ".bun", "bin"))
  const nvm = join(home, ".nvm", "versions", "node")
  try {
    for (const version of readdirSync(nvm).sort().reverse()) dirs.push(join(nvm, version, "bin"))
  } catch {
    /* kein nvm */
  }
  return [...new Set(dirs)]
}

// Pfad der CLI oder undefined. ORBIT_<NAME>_BIN überschreibt (nur für Tests und Sonderfälle).
export function findBinary(provider: CliProvider, env: Record<string, string | undefined> = process.env, home = homedir()): string | undefined {
  const override = env[`ORBIT_${provider.toUpperCase()}_BIN`]
  if (override) return existsSync(override) ? override : undefined
  for (const dir of searchDirs(env, home)) {
    const candidate = join(dir, NAMES[provider])
    if (existsSync(candidate)) return candidate
  }
  return undefined
}

// Umgebung für die CLI: nur das Nötige (kein Orbit-Schlüssel, keine API-Schlüssel anderer Dienste). Die Anmeldung liegt im Konto-Ordner
// bzw. Schlüsselbund des Nutzers; ein gesetzter API-Schlüssel würde ohnehin das Abo umgehen und Geld kosten, deshalb wird er nie weitergereicht.
export function cliEnv(binary: string, extra: Record<string, string> = {}, env: Record<string, string | undefined> = process.env, home = homedir()): Record<string, string> {
  const out: Record<string, string> = {
    HOME: env.HOME ?? home,
    USER: env.USER ?? "",
    LANG: env.LANG ?? "de_DE.UTF-8",
    TMPDIR: env.TMPDIR ?? "/tmp",
    PATH: [dirname(binary), ...searchDirs(env, home), "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(delimiter),
    NO_COLOR: "1",
  }
  for (const name of ["CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME", "SSL_CERT_FILE", "HTTPS_PROXY", "HTTP_PROXY", "NO_PROXY"])
    if (env[name]) out[name] = env[name]!
  return { ...out, ...extra }
}
