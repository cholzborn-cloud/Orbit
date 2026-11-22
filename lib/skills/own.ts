import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { dirname, join, resolve, sep } from "node:path"

import { databasePath } from "../db/path.ts"
import { looksLikeSecret } from "../orbi/memory.ts"
import { oneLiner } from "./catalog.ts"

// Eigene Skills der Orbis (Lauf H): eine Datei je Skill im Ordner des Orbis, direkt aktiv. Nur lesbar für diesen Orbi.
export const OWN_LIMITS = { skills: 30, body: 8_000, minBody: 20, description: 120 } as const
const NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const APPROVAL_BYPASS =
  /(approval rules?|freigabe-?regeln?|ohne (?:freigabe|nachfrage|erlaubnis)|(?:without|skip|bypass)\s+(?:asking|approval|permission|confirm)|ignore (?:the )?approval|immer erlauben)/i
const BOT_ID = /^[A-Za-z0-9_-]{1,64}$/

export const ownRoot = (botId: string, dataDir = dirname(databasePath())) => {
  if (!BOT_ID.test(botId)) throw new Error("Ungültige Orbi-ID.")
  return join(dataDir, "orbis", botId, "skills")
}

// Pfadprüfung: gültiger Name, Ziel liegt unter dem Orbi-Ordner, kein Verweis (Symlink) auf dem Weg.
export function safeSkillFile(root: string, name: string) {
  if (!NAME.test(name) || name.length < 2 || name.length > 40) throw new Error("Ungültiger Skill-Name.")
  const base = resolve(root)
  const file = resolve(base, name, "SKILL.md")
  if (!file.startsWith(`${base}${sep}`) || dirname(dirname(file)) !== base)
    throw new Error("Der Pfad liegt außerhalb des Skill-Ordners.")
  // Vorhandene Teile ab dem Ordner des Orbis dürfen keine Verweise (Symlinks) sein.
  for (const target of [dirname(base), base, dirname(file), file]) {
    try {
      if (lstatSync(target).isSymbolicLink()) throw new Error("Verweise sind im Skill-Ordner nicht erlaubt.")
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
    }
  }
  return file
}

const cache = new Map<string, { mtimeMs: number; description: string }>()
const frontDescription = (text: string) => {
  const front = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? ""
  return /^description:\s*(.+)$/m.exec(front)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? ""
}

export function listOwnSkills(root: string): { name: string; description: string }[] {
  let names: string[]
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !e.isSymbolicLink() && NAME.test(e.name))
      .map((e) => e.name)
      .sort()
  } catch {
    return []
  }
  const out: { name: string; description: string }[] = []
  for (const name of names) {
    const file = join(root, name, "SKILL.md")
    try {
      if (lstatSync(file).isSymbolicLink()) continue
      const { mtimeMs } = statSync(file)
      const cached = cache.get(file)
      let description = cached?.mtimeMs === mtimeMs ? cached.description : undefined
      if (description === undefined) {
        description = frontDescription(readFileSync(file, "utf8").slice(0, 2_000))
        cache.set(file, { mtimeMs, description })
      }
      out.push({ name, description })
    } catch {
      /* ohne lesbare SKILL.md zählt der Ordner nicht */
    }
  }
  return out
}

export function readOwnSkill(root: string, name: string): string | null {
  try {
    const file = safeSkillFile(root, name)
    if (lstatSync(file).isSymbolicLink()) return null
    const text = readFileSync(file, "utf8")
    // Frontmatter fällt weg, der Katalog hat die Beschreibung schon.
    return text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").slice(0, OWN_LIMITS.body)
  } catch {
    return null
  }
}

export type OwnSkillInput = { name: string; description: string; body: string; replace?: boolean }
export type OwnSkillResult =
  | { ok: true; name: string; created: boolean }
  | { ok: false; error: string }

export function writeOwnSkill(
  root: string,
  botName: string,
  input: OwnSkillInput,
  now = new Date()
): OwnSkillResult {
  const description = oneLiner(input.description, OWN_LIMITS.description + 1)
  const body = input.body.trim()
  if (!NAME.test(input.name) || input.name.length < 2 || input.name.length > 40)
    return { ok: false, error: "Invalid name: 2-40 characters, lowercase letters, digits and hyphens." }
  if (!description || description.length > OWN_LIMITS.description)
    return { ok: false, error: `Description needs 1-${OWN_LIMITS.description} characters: when to use the skill.` }
  if (body.length < OWN_LIMITS.minBody || body.length > OWN_LIMITS.body)
    return { ok: false, error: `Body needs ${OWN_LIMITS.minBody}-${OWN_LIMITS.body} characters.` }
  if ([input.name, description, body].some(looksLikeSecret))
    return { ok: false, error: "Not saved: the text looks like a secret (key, token, password). Never store those." }
  // Skills dürfen Freigaberegeln nicht ändern oder umgehen (Regel in AGENTS.md).
  if (APPROVAL_BYPASS.test(`${description}\n${body}`))
    return { ok: false, error: "Skills cannot change approval rules or skip approvals." }
  try {
    const file = safeSkillFile(root, input.name)
    const exists = (() => {
      try {
        statSync(file)
        return true
      } catch {
        return false
      }
    })()
    if (exists && !input.replace)
      return { ok: false, error: "Skill exists: read it with read_skill and save again with replace=true." }
    if (!exists && listOwnSkills(root).length >= OWN_LIMITS.skills)
      return { ok: false, error: `Too many own skills (max ${OWN_LIMITS.skills}). Improve an existing one.` }
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    // Der Ordner darf erst jetzt (nach dem Anlegen) geprüft werden: kein Verweis, liegt real unter dem Orbi-Ordner.
    safeSkillFile(root, input.name)
    if (!realpathSync(dirname(file)).startsWith(`${realpathSync(resolve(root))}${sep}`))
      return { ok: false, error: "Der Pfad liegt außerhalb des Skill-Ordners." }
    const date = now.toISOString().slice(0, 10)
    const text = `---\nname: ${input.name}\ndescription: ${description.replace(/\n/g, " ")}\nherkunft: angelegt von ${botName.replace(/[\n\r]/g, " ")} am ${date}\n---\n\n${body}\n`
    // Schreiben über eine Temp-Datei und Umbenennen: nie eine halbe SKILL.md.
    const temp = `${file}.${process.pid}.tmp`
    writeFileSync(temp, text, { encoding: "utf8", mode: 0o600, flag: "w" })
    renameSync(temp, file)
    cache.delete(file)
    return { ok: true, name: input.name, created: !exists }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error && /^(Der|Die|Ungültig|Verweise)/.test(error.message) ? error.message : "Skill could not be saved.",
    }
  }
}
