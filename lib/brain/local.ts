import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import { createBrainTools } from "../../brain-server/src/brain.ts"
import type { BrainResult } from "./client.ts"

// Brain ohne separaten Server (Phase 4, Lauf H): derselbe Code wie brain-server, direkt im Dienst gegen den Vault auf dem Mac.
// Dieselben Regeln: ganzes Brain, nur innerhalb des Vaults, Löschen heißt archivieren, Regeldateien nur gerahmt lesen.
const SAFE_ERROR =
  /^(Der|Die|Das|Erlaubt|Schreiben|Lesen|Kopfstück|Datei|Dieser|Diese|Ungültiger|Archiv)/
const TEXT_LIMIT = 20_000

async function run(job: () => Promise<string>): Promise<BrainResult<string>> {
  try {
    const data = await job()
    return {
      ok: true,
      data: data.length > TEXT_LIMIT ? `${data.slice(0, TEXT_LIMIT)}\n[gekürzt]` : data,
    }
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && !("code" in error) && SAFE_ERROR.test(error.message)
          ? error.message
          : "Dateizugriff fehlgeschlagen.",
    }
  }
}

export function createLocalBrainClient(vaultPath: string) {
  const tools = createBrainTools(vaultPath)
  return {
    search: (query: string) => run(async () => JSON.stringify(await tools.brain_search(query))),
    read: (path: string, section?: string) => run(() => tools.brain_read(path, section)),
    write: (path: string, content: string, mode: "create" | "append" | "replace") =>
      run(() => tools.brain_write(path, content, mode)),
    move: (from: string, to?: string) => run(() => tools.brain_move(from, to)),
    skillsList: () => run(async () => JSON.stringify(await tools.brain_skills_list())),
    skillRead: (name: string) => run(() => tools.brain_skill_read(name)),
  }
}

// Vault finden: ORBIT_BRAIN_PATH, dann ~/.second-brain (Verweis auf den Vault), dann der Projektordner. Nur ein Ordner mit Start.md zählt.
export function resolveVaultPath(env: Record<string, string | undefined> = process.env) {
  const candidates = [
    env.ORBIT_BRAIN_PATH,
    join(homedir(), ".second-brain"),
    join(homedir(), "Projekte-Coding", "Second Brain"),
  ].filter((p): p is string => !!p)
  for (const candidate of candidates) {
    try {
      const real = realpathSync(candidate)
      if (statSync(real).isDirectory() && existsSync(join(real, "Start.md"))) return real
    } catch {
      /* nächster Kandidat */
    }
  }
  return null
}

// Kurzbeschreibungen der Brain-Skills (Frontmatter `description:`), neu gelesen nur bei geänderter Datei.
const skillCache = new Map<string, { mtimeMs: number; description: string }>()
export function brainSkillCatalog(vaultPath: string): { name: string; description: string }[] {
  const root = join(vaultPath, "04 Ressourcen", "Fähigkeiten")
  let names: string[]
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.isSymbolicLink() && !e.name.startsWith("."))
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
  const out: { name: string; description: string }[] = []
  for (const name of names) {
    const file = join(root, name, "SKILL.md")
    try {
      const { mtimeMs } = statSync(file)
      const cached = skillCache.get(file)
      let description = cached?.mtimeMs === mtimeMs ? cached.description : undefined
      if (description === undefined) {
        const head = readFileSync(file, "utf8").slice(0, 2_000)
        const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(head)?.[1] ?? ""
        description = /^description:\s*(.+)$/m.exec(front)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? ""
        skillCache.set(file, { mtimeMs, description })
      }
      out.push({ name, description })
    } catch {
      /* Ordner ohne lesbare SKILL.md zählt nicht */
    }
  }
  return out
}
