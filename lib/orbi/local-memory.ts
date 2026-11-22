import { createHash } from "node:crypto"

import type Database from "better-sqlite3"

import { looksLikeSecret, MEMORY_SECRET_ERROR } from "./memory.ts"

// Lokales Gedächtnis je Orbi (Phase 4, Lauf H): kleine Einträge in SQLite statt einer großen Datei in der Sandbox.
// Im Prompt steht nur ein Index (höchstens MAX_INDEX Zeichen), der Inhalt kommt per memory_get.
export const LIMITS = {
  entries: 40,
  body: 1_200,
  description: 150,
  source: 120,
  total: 24_000,
  replaces: 5,
} as const
export const MAX_INDEX = 1_500

export const MEMORY_TYPES = ["user", "feedback", "project", "reference", "scratchpad"] as const
export type MemoryType = (typeof MEMORY_TYPES)[number]
// consti = hat Consti selbst gesagt (stated), self = eigene Notiz des Orbis, external = Web, Mail, Datei, anderer Orbi.
export const MEMORY_FROM = ["consti", "self", "external"] as const
export type MemoryFrom = (typeof MEMORY_FROM)[number]

export type MemoryEntry = {
  name: string
  type: string
  description: string
  body: string
  stated: boolean
  origin: string
  source: string
  version: number
  createdAt: number
  updatedAt: number
}
export type SaveInput = {
  name: string
  type: string
  description: string
  body: string
  from: string
  source: string
  ifVersion?: number
  replaces?: string[]
}
export type SaveResult =
  | { ok: true; name: string; version: number; replaced: string[] }
  | { ok: false; error: string }

export const NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const ROW = `name, type, description, body, stated, origin, source, version, created_at as createdAt, updated_at as updatedAt`

// Anweisungen an die KI, wie sie in Webseiten, Mails und Dateien stehen: so etwas wird aus Fremdquellen nie gespeichert.
const INSTRUCTION_PATTERNS = [
  /\b(ignore|disregard|forget)\b[^.\n]{0,40}\b(previous|above|prior|earlier|instructions|rules)\b/i,
  /\b(ignoriere|vergiss)\b[^.\n]{0,40}\b(vorherige|obigen|regeln|anweisungen)\b/i,
  /\b(system prompt|developer message|you must|you should always|from now on|ab jetzt|du musst immer)\b/i,
  /\b(always|immer|never|nie)\b[^.\n]{0,60}\b(send|forward|post|upload|sende|schicke|leite)\b/i,
  /\bhttps?:\/\/\S+[^.\n]{0,40}\b(send|post|upload|sende)\b/i,
]
export const looksLikeInstruction = (text: string) =>
  INSTRUCTION_PATTERNS.some((pattern) => pattern.test(text))

const oneLine = (text: string) => text.replace(/\s+/g, " ").trim()

export function validateEntry(input: SaveInput): string | null {
  if (!NAME_PATTERN.test(input.name) || input.name.length < 2 || input.name.length > 40)
    return "Invalid name: 2-40 characters, lowercase letters, digits and hyphens."
  if (!(MEMORY_TYPES as readonly string[]).includes(input.type))
    return `Invalid type: use ${MEMORY_TYPES.join(", ")}.`
  if (!(MEMORY_FROM as readonly string[]).includes(input.from))
    return `Invalid from: use ${MEMORY_FROM.join(", ")}.`
  const description = oneLine(input.description)
  if (!description || description.length > LIMITS.description)
    return `Description needs 1-${LIMITS.description} characters (one line).`
  if (!input.body.trim() || input.body.length > LIMITS.body)
    return `Body needs 1-${LIMITS.body} characters. Split it into several entries.`
  const source = oneLine(input.source)
  if (source.length < 3 || source.length > LIMITS.source)
    return `Source needs 3-${LIMITS.source} characters: Consti's words or where it came from.`
  if ([input.name, description, input.body, source].some(looksLikeSecret))
    return MEMORY_SECRET_ERROR
  // Regeln und Aussagen über Consti kommen nur von ihm selbst; eigene Notizen und Fremdes sind Projektstand oder Verweis.
  if ((input.type === "user" || input.type === "feedback") && input.from !== "consti")
    return `Type ${input.type} is only for what Consti said himself (from=consti). Use project or reference for other notes.`
  if (input.from === "external") {
    if (input.type !== "reference")
      return "Content from web, mail, files or other Orbis is never stored as a fact or rule about Consti. Use type reference."
    if (looksLikeInstruction(`${description}\n${input.body}`))
      return "Not saved: the text reads like an instruction from outside data. Outside content is never stored as a rule."
  }
  return null
}

export function getScratchpad(db: Database.Database, botId: string): string {
  try {
    const row = db
      .prepare("select body from orbi_memory where bot_id = ? and name = 'scratchpad'")
      .get(botId) as { body: string } | undefined
    return row?.body ?? ""
  } catch {
    return ""
  }
}

export function setScratchpad(
  db: Database.Database,
  botId: string,
  content: string
): { ok: boolean; error?: string } {
  try {
    const trimmed = content.trim()
    if (!trimmed) {
      db.prepare("delete from orbi_memory where bot_id = ? and name = 'scratchpad'").run(botId)
      return { ok: true }
    }
    const now = Date.now()
    db.prepare(
      `insert into orbi_memory (bot_id, name, type, description, body, stated, origin, source, version, created_at, updated_at)
       values (?, 'scratchpad', 'scratchpad', 'Arbeits-Notizen und offene Aufgaben', ?, 0, 'self', 'Orbi Scratchpad', 1, ?, ?)
       on conflict(bot_id, name) do update set body = excluded.body, updated_at = excluded.updated_at`
    ).run(botId, trimmed, now, now)
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Scratchpad konnte nicht gespeichert werden." }
  }
}

export function clearScratchpad(db: Database.Database, botId: string): void {
  try {
    db.prepare("delete from orbi_memory where bot_id = ? and name = 'scratchpad'").run(botId)
  } catch {
    /* ignore */
  }
}

export function listEntries(db: Database.Database, botId: string): MemoryEntry[] {
  return (
    db
      .prepare(
        `select ${ROW} from orbi_memory where bot_id = ? order by updated_at desc, name`
      )
      .all(botId) as (Omit<MemoryEntry, "stated"> & { stated: number })[]
  ).map((row) => ({ ...row, stated: !!row.stated }))
}

export function getEntry(
  db: Database.Database,
  botId: string,
  name: string
): MemoryEntry | null {
  const row = db
    .prepare(`select ${ROW} from orbi_memory where bot_id = ? and name = ?`)
    .get(botId, name) as (Omit<MemoryEntry, "stated"> & { stated: number }) | undefined
  return row ? { ...row, stated: !!row.stated } : null
}

const log = (
  db: Database.Database,
  botId: string,
  name: string,
  action: string,
  version: number | null,
  detail: string | null,
  now: number
) =>
  db
    .prepare(
      "insert into orbi_memory_log (bot_id, name, action, version, detail, at) values (?, ?, ?, ?, ?, ?)"
    )
    .run(botId, name, action, version, detail, now)

// Schreiben in einer Transaktion: Versions-Token (ifVersion) gegen gleichzeitige Änderung, Ersetzen älterer Einträge, Deckel.
export function saveEntry(
  db: Database.Database,
  botId: string,
  input: SaveInput,
  now = Date.now()
): SaveResult {
  const invalid = validateEntry(input)
  if (invalid) return { ok: false, error: invalid }
  const replaces = [...new Set(input.replaces ?? [])]
  if (replaces.length > LIMITS.replaces || replaces.includes(input.name))
    return { ok: false, error: `replaces: up to ${LIMITS.replaces} other entries.` }
  const description = oneLine(input.description)
  const source = oneLine(input.source)
  const body = input.body.trim()
  return db
    .transaction((): SaveResult => {
      const existing = getEntry(db, botId, input.name)
      if (existing && input.ifVersion === undefined)
        return {
          ok: false,
          error: `Entry exists (version ${existing.version}): read it with memory_get and pass ifVersion=${existing.version}.`,
        }
      if (existing && input.ifVersion !== existing.version)
        return {
          ok: false,
          error: `Entry changed (now version ${existing.version}): read it again with memory_get, merge, and retry with ifVersion=${existing.version}.`,
        }
      if (!existing && input.ifVersion !== undefined && input.ifVersion !== 0)
        return { ok: false, error: "Entry not found: save it without ifVersion." }
      const unknown = replaces.filter((name) => !getEntry(db, botId, name))
      if (unknown.length)
        return { ok: false, error: `replaces: entry not found: ${unknown.join(", ")}.` }
      const others = listEntries(db, botId).filter(
        (entry) => entry.name !== input.name && !replaces.includes(entry.name)
      )
      const total =
        others.reduce((sum, entry) => sum + entry.body.length + entry.description.length, 0) +
        body.length +
        description.length
      if (others.length + 1 > LIMITS.entries)
        return {
          ok: false,
          error: `Memory is full (${LIMITS.entries} entries). Replace or forget old entries first.`,
        }
      if (total > LIMITS.total)
        return {
          ok: false,
          error: `Memory is too large (${total} characters, max ${LIMITS.total}). Shorten or forget entries first.`,
        }
      for (const name of replaces) {
        db.prepare("delete from orbi_memory where bot_id = ? and name = ?").run(botId, name)
        log(db, botId, name, "replace", null, `replaced by ${input.name}`, now)
      }
      const version = (existing?.version ?? 0) + 1
      db.prepare(
        `insert into orbi_memory (bot_id, name, type, description, body, stated, origin, source, version, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict (bot_id, name) do update set type = excluded.type, description = excluded.description, body = excluded.body,
           stated = excluded.stated, origin = excluded.origin, source = excluded.source, version = excluded.version, updated_at = excluded.updated_at`
      ).run(
        botId,
        input.name,
        input.type,
        description,
        body,
        input.from === "consti" ? 1 : 0,
        input.from,
        source,
        version,
        existing?.createdAt ?? now,
        now
      )
      log(db, botId, input.name, existing ? "update" : "create", version, source, now)
      return { ok: true, name: input.name, version, replaced: replaces }
    })
    .immediate()
}

export function forgetEntry(
  db: Database.Database,
  botId: string,
  name: string,
  reason = "forget",
  now = Date.now()
): { ok: true } | { ok: false; error: string } {
  return db
    .transaction(() => {
      const existing = getEntry(db, botId, name)
      if (!existing) return { ok: false as const, error: "Entry not found." }
      // Stand zum Löschzeitpunkt aufheben (Phase 5): Consti kann den Eintrag in der Gedächtnis-Ansicht wiederherstellen.
      db.prepare("insert into orbi_memory_trash (bot_id, name, snapshot, deleted_at, reason) values (?, ?, ?, ?, ?)").run(
        botId,
        name,
        JSON.stringify(existing),
        now,
        reason
      )
      db.prepare("delete from orbi_memory where bot_id = ? and name = ?").run(botId, name)
      log(db, botId, name, "forget", existing.version, reason, now)
      return { ok: true as const }
    })
    .immediate()
}

export const TRASH_KEEP = 30

export type TrashedEntry = MemoryEntry & { trashId: number; deletedAt: number; reason: string | null }

// Gelöschte Einträge, neueste zuerst (je Name nur der jüngste Stand).
export function listTrash(db: Database.Database, botId: string): TrashedEntry[] {
  const rows = db
    .prepare("select id, name, snapshot, deleted_at as deletedAt, reason from orbi_memory_trash where bot_id = ? order by deleted_at desc, id desc")
    .all(botId) as { id: number; name: string; snapshot: string; deletedAt: number; reason: string | null }[]
  const seen = new Set<string>()
  const out: TrashedEntry[] = []
  for (const row of rows) {
    if (seen.has(row.name)) continue
    seen.add(row.name)
    try {
      out.push({ ...(JSON.parse(row.snapshot) as MemoryEntry), trashId: row.id, deletedAt: row.deletedAt, reason: row.reason })
    } catch {
      /* kaputter Papierkorb-Eintrag: übergehen */
    }
    if (out.length >= TRASH_KEEP) break
  }
  return out
}

// Consti ändert einen Eintrag in der App: gilt als von Consti gesagt (stated), Version +1, Protokoll „edit“.
// Prüfung wie beim Speichern (Länge, keine Zugangsdaten); ifVersion schützt vor gleichzeitiger Änderung durch den Orbi.
export function editEntry(
  db: Database.Database,
  botId: string,
  name: string,
  input: { description: string; body: string; ifVersion: number },
  now = Date.now()
): SaveResult {
  const existing = getEntry(db, botId, name)
  if (!existing) return { ok: false, error: "Eintrag nicht gefunden." }
  const date = new Date(now).toISOString().slice(0, 10)
  const result = saveEntry(
    db,
    botId,
    {
      name,
      type: existing.type,
      description: input.description,
      body: input.body,
      from: "consti",
      source: `Von Consti in der App geändert am ${date}`,
      ifVersion: input.ifVersion,
    },
    now
  )
  if (result.ok) log(db, botId, name, "edit", result.version, "in der App geändert", now)
  return result
}

// Stellt den zuletzt gelöschten Stand wieder her (neue Version, Herkunft bleibt). Scheitert, wenn der Name inzwischen belegt ist oder das Gedächtnis voll wäre.
export function restoreEntry(
  db: Database.Database,
  botId: string,
  name: string,
  now = Date.now()
): { ok: true; version: number } | { ok: false; error: string } {
  return db
    .transaction((): { ok: true; version: number } | { ok: false; error: string } => {
      const row = db
        .prepare("select id, snapshot from orbi_memory_trash where bot_id = ? and name = ? order by deleted_at desc, id desc limit 1")
        .get(botId, name) as { id: number; snapshot: string } | undefined
      if (!row) return { ok: false, error: "Gelöschter Eintrag nicht gefunden." }
      if (getEntry(db, botId, name)) return { ok: false, error: "Es gibt schon einen Eintrag mit diesem Namen." }
      let old: MemoryEntry
      try {
        old = JSON.parse(row.snapshot) as MemoryEntry
      } catch {
        return { ok: false, error: "Gelöschter Eintrag ist nicht lesbar." }
      }
      const entries = listEntries(db, botId)
      if (entries.length + 1 > LIMITS.entries) return { ok: false, error: "Das Gedächtnis ist voll. Lösche zuerst einen Eintrag." }
      const total = entries.reduce((sum, e) => sum + e.body.length + e.description.length, 0) + old.body.length + old.description.length
      if (total > LIMITS.total) return { ok: false, error: "Das Gedächtnis ist zu groß. Lösche zuerst einen Eintrag." }
      const version = old.version + 1
      db.prepare(
        `insert into orbi_memory (bot_id, name, type, description, body, stated, origin, source, version, created_at, updated_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(botId, old.name, old.type, old.description, old.body, old.stated ? 1 : 0, old.origin, old.source, version, old.createdAt, now)
      db.prepare("delete from orbi_memory_trash where id = ?").run(row.id)
      log(db, botId, name, "restore", version, "wiederhergestellt in der App", now)
      return { ok: true, version }
    })
    .immediate()
}

const day = (ms: number) => new Date(ms).toISOString().slice(5, 10)
const TYPE_LETTER: Record<string, string> = { user: "u", feedback: "f", project: "p", reference: "r" }
const INDEX_HEAD =
  "Index (type u/f/p/r, ? = not said by Consti, date MM-DD); read with memory_get(name):"

// Der Index für den Prompt: eine Zeile je Eintrag, neueste zuerst, hart bei MAX_INDEX gekappt.
export function memoryIndex(entries: MemoryEntry[], max = MAX_INDEX) {
  if (!entries.length) return ""
  const more = (n: number) => `(+${n} more: memory_get without name)`
  const lines: string[] = []
  let used = INDEX_HEAD.length
  for (const [i, entry] of entries.entries()) {
    const line = `- ${entry.name} [${TYPE_LETTER[entry.type] ?? "?"}${entry.stated ? "" : "?"} ${day(entry.updatedAt)}]: ${entry.description}`
    const rest = entries.length - i - 1
    // Platz für die Restzeile lassen, solange danach noch Einträge kommen.
    const reserve = rest ? 1 + more(rest).length : 0
    if (used + 1 + line.length + reserve > max) {
      lines.push(more(entries.length - i))
      break
    }
    lines.push(line)
    used += 1 + line.length
  }
  return `${INDEX_HEAD}\n${lines.join("\n")}`
}

// ---- Migration der Sandbox-MEMORY.md (nur lesend, das Original bleibt unverändert) ----

const slug = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30)
    .replace(/-+$/g, "")

// Teilt den Text an Überschriften und Absätzen in Stücke bis LIMITS.body und fasst kleine Stücke zusammen.
export function splitLegacyMemory(text: string): { title: string; body: string }[] {
  const sections: { title: string; lines: string[] }[] = []
  let current: { title: string; lines: string[] } | null = null
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const heading = /^#{1,6}\s+(.+)$/.exec(raw)
    if (heading) {
      current = { title: heading[1].trim(), lines: [] }
      sections.push(current)
      continue
    }
    if (!raw.trim() && !current) continue
    if (!current) {
      current = { title: "", lines: [] }
      sections.push(current)
    }
    current.lines.push(raw)
  }
  const chunks: { title: string; body: string }[] = []
  for (const section of sections) {
    let body = ""
    const flush = () => {
      if (body.trim()) chunks.push({ title: section.title, body: body.trim() })
      body = ""
    }
    for (const line of section.lines) {
      // Zu lange einzelne Zeilen werden hart geteilt.
      for (let i = 0; i === 0 || i < line.length; i += LIMITS.body) {
        const piece = line.slice(i, i + LIMITS.body)
        if (body.length + piece.length + 1 > LIMITS.body) flush()
        body += `${piece}\n`
      }
    }
    flush()
  }
  // Kleine Stücke hintereinander bis zur Obergrenze zusammenfassen.
  const merged: { title: string; body: string }[] = []
  for (const chunk of chunks) {
    const last = merged.at(-1)
    const piece = chunk.title ? `${chunk.title}\n${chunk.body}` : chunk.body
    if (last && last.body.length + piece.length + 2 <= LIMITS.body) last.body += `\n\n${piece}`
    else merged.push({ title: chunk.title, body: chunk.title ? piece : chunk.body })
  }
  return merged
}

export type MigrationResult =
  | { status: "done"; imported: number; skipped: number }
  | { status: "already" }
  | { status: "unreadable" }
  // Sandbox läuft gerade nicht: sie wird dafür nie gestartet, der nächste Turn bei laufender Sandbox versucht es wieder (kein Fehlversuch).
  | { status: "deferred" }
  // Dreimal nicht lesbar: als „0 übernommen“ abgeschlossen, damit nichts mehr versucht wird.
  | { status: "gave-up" }

export const MIGRATION_ATTEMPTS = 3

// Einmal je Orbi. Liest nur (readText); scheitert das Lesen, bleibt alles offen und der nächste Turn versucht es erneut.
export async function migrateLegacyMemory(
  db: Database.Database,
  botId: string,
  readText: () => Promise<string>,
  now = Date.now()
): Promise<MigrationResult> {
  if (db.prepare("select 1 from orbi_memory_meta where bot_id = ?").get(botId))
    return { status: "already" }
  let text: string
  try {
    text = await readText()
  } catch (error) {
    if ((error as { name?: string })?.name === "SandboxNotRunning") return { status: "deferred" }
    // Fehlversuche zählen; beim dritten wird die Migration als „imported 0“ abgeschlossen (Original in der Sandbox bleibt unverändert).
    const attempts =
      ((db.prepare("select attempts from orbi_memory_attempts where bot_id = ?").get(botId) as { attempts: number } | undefined)
        ?.attempts ?? 0) + 1
    db.prepare("insert or replace into orbi_memory_attempts (bot_id, attempts, last_at) values (?, ?, ?)").run(botId, attempts, now)
    if (attempts < MIGRATION_ATTEMPTS) return { status: "unreadable" }
    db.prepare(
      "insert or ignore into orbi_memory_meta (bot_id, migrated_at, source_hash, source_chars, imported) values (?, ?, ?, 0, 0)"
    ).run(botId, now, "unreadable")
    return { status: "gave-up" }
  }
  const sourceHash = createHash("sha256").update(text, "utf8").digest("hex")
  const date = new Date(now).toISOString().slice(0, 10)
  return db
    .transaction((): MigrationResult => {
      if (db.prepare("select 1 from orbi_memory_meta where bot_id = ?").get(botId))
        return { status: "already" }
      const taken = new Set(listEntries(db, botId).map((entry) => entry.name))
      let imported = 0
      // Zeilen, die nach Zugangsdaten aussehen, werden nie übernommen (der Rest des Absatzes schon).
      const lines = text.split("\n")
      const clean = lines.filter((line) => !looksLikeSecret(line))
      let skipped = lines.length - clean.length
      for (const [i, chunk] of splitLegacyMemory(clean.join("\n")).entries()) {
        if (looksLikeSecret(chunk.body) || taken.size >= LIMITS.entries) {
          skipped++
          continue
        }
        const first = oneLine(chunk.title || chunk.body.split("\n")[0].replace(/^[-*\s]+/, ""))
        const base = slug(first) || `altes-gedaechtnis-${i + 1}`
        let name = base.length >= 2 ? base : `altes-gedaechtnis-${i + 1}`
        for (let n = 2; taken.has(name); n++) name = `${base.slice(0, 36)}-${n}`
        taken.add(name)
        const source = `MEMORY.md der Sandbox, migriert am ${date}`
        db.prepare(
          `insert into orbi_memory (bot_id, name, type, description, body, stated, origin, source, version, created_at, updated_at)
           values (?, ?, 'user', ?, ?, 0, 'migration', ?, 1, ?, ?)`
        ).run(botId, name, first.slice(0, LIMITS.description), chunk.body, source, now, now)
        log(db, botId, name, "migrate", 1, source, now)
        imported++
      }
      db.prepare(
        "insert into orbi_memory_meta (bot_id, migrated_at, source_hash, source_chars, imported) values (?, ?, ?, ?, ?)"
      ).run(botId, now, sourceHash, text.length, imported)
      return { status: "done", imported, skipped }
    })
    .immediate()
}
