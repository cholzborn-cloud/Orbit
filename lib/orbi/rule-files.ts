import { readFileSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

// AGENTS.md ist die Grundanleitung jedes Orbis; CODING.md liegt daneben und kommt nur per read_coding_rules.
export const RULE_FILE_LIMIT = 8_000

export function agentsPath() {
  return (
    process.env.ORBIT_AGENTS_PATH ||
    join(homedir(), "Projekte-Coding", "Orbit", "AGENTS.md")
  )
}

const cache = new Map<string, { mtimeMs: number; text: string | null }>()

// Neu gelesen nur bei geänderter Datei; fehlt sie, gilt die Grundanleitung als Ersatz.
export function readRuleFile(name: "AGENTS.md" | "CODING.md") {
  const path = name === "AGENTS.md" ? agentsPath() : join(dirname(agentsPath()), name)
  try {
    const { mtimeMs } = statSync(path)
    const cached = cache.get(path)
    if (cached?.mtimeMs === mtimeMs) return cached.text
    const content = readFileSync(path, "utf8").trim()
    const text = content ? content.slice(0, RULE_FILE_LIMIT) : null
    cache.set(path, { mtimeMs, text })
    return text
  } catch {
    cache.delete(path)
    return null
  }
}
