import { existsSync, lstatSync, mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { databasePath } from "../db/path.ts"

// Leerer, neutraler Arbeitsordner für alle CLI-Aufrufe (unter dem Orbit-Datenordner). Hier liegt weder Projekt noch CLAUDE.md noch
// Gedächtnis; so lädt keine CLI Projektkontext, Hooks oder Gedächtnis des Entwicklerordners.
export const cliRoot = () => join(dirname(databasePath()), "cli-work")
export const workdirFor = (provider: "claude" | "codex" | "gemini" | "agy") => {
  const dir = join(cliRoot(), provider)
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  return dir
}

const CODEX_INSTRUCTIONS = "Du bist ein reines Textmodell ohne Werkzeuge. Antworte direkt auf den Text, der dir gegeben wird.\n"
const CODEX_CONFIG = (instructions: string) => `model_instructions_file = ${JSON.stringify(instructions)}
approval_policy = "never"
sandbox_mode = "read-only"
web_search = "disabled"
suppress_unstable_features_warning = true
project_doc_max_bytes = 0
include_permissions_instructions = false
include_environment_context = false

[features]
shell_tool = false
unified_exec = false
memories = false
plugins = false
apps = false
computer_use = false
browser_use = false
image_generation = false
view_image = false
skill_search = false
hooks = false
`

const writeIfChanged = (path: string, content: string) => {
  try {
    if (readFileSync(path, "utf8") === content) return
  } catch {
    /* neu schreiben */
  }
  writeFileSync(path, content, { mode: 0o600 })
}

// Eigener CODEX_HOME nur für Orbit: eigene schlanke Konfiguration (keine MCP-Server, Plugins, Hooks, Shell des Nutzers) und die
// Anmeldung als Verknüpfung auf die echte auth.json. Der Inhalt der Anmeldung wird nie gelesen oder kopiert.
export function prepareCodexHome(realHome = process.env.CODEX_HOME || join(homedir(), ".codex")): string {
  const home = join(cliRoot(), "codex-home")
  mkdirSync(home, { recursive: true, mode: 0o700 })
  const instructions = join(home, "instructions.md")
  writeIfChanged(instructions, CODEX_INSTRUCTIONS)
  writeIfChanged(join(home, "config.toml"), CODEX_CONFIG(instructions))
  const link = join(home, "auth.json")
  const target = join(realHome, "auth.json")
  try {
    const stat = lstatSync(link)
    if (!stat.isSymbolicLink()) return home // vom Programm selbst ersetzt (Token-Erneuerung): bleibt gültig
    unlinkSync(link)
  } catch {
    /* noch kein Eintrag */
  }
  if (existsSync(target)) symlinkSync(target, link)
  return home
}

// Gemini (ungeprüft, CLI nicht installiert): System-Einstellungen mit leerer Werkzeugliste, über GEMINI_CLI_SYSTEM_SETTINGS_PATH.
export function prepareGeminiSettings(): string {
  const dir = workdirFor("gemini")
  const path = join(dirname(dir), "gemini-settings.json")
  writeIfChanged(path, JSON.stringify({ tools: { core: [] }, mcpServers: {}, general: { disableAutoUpdate: true } }, null, 2))
  return path
}
