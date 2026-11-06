import { getDatabase } from "@/lib/db/client"
import {
  editEntry,
  listTrash,
  restoreEntry,
  forgetEntry,
  getEntry,
  LIMITS,
  listEntries,
  memoryIndex,
  MAX_INDEX,
  type MemoryEntry,
} from "@/lib/orbi/local-memory"

// Gedächtnis eines Orbis für die Mac-App: lesen und einzelne Einträge löschen. Anlegen und Ändern machen nur die Orbis selbst.
const exists = (botId: string) =>
  !!getDatabase()
    .$client.prepare("select 1 from bots where id = ? and user_id = 'local'")
    .get(botId)

const view = (e: MemoryEntry) => ({
  name: e.name,
  type: e.type,
  description: e.description,
  body: e.body,
  stated: e.stated,
  origin: e.origin,
  source: e.source,
  version: e.version,
  createdAt: e.createdAt,
  updatedAt: e.updatedAt,
})

export function botMemory(botId: string) {
  if (!exists(botId)) return { ok: false, error: "Orbi nicht gefunden." }
  const db = getDatabase().$client
  const entries = listEntries(db, botId)
  return {
    ok: true,
    entries: entries.map(view),
    index: memoryIndex(entries),
    limits: { entries: LIMITS.entries, body: LIMITS.body, total: LIMITS.total, index: MAX_INDEX },
    migrated: !!db.prepare("select 1 from orbi_memory_meta where bot_id = ?").get(botId),
  }
}

export function botMemoryEntry(botId: string, name: string) {
  if (!exists(botId)) return { ok: false, error: "Orbi nicht gefunden." }
  const entry = getEntry(getDatabase().$client, botId, name)
  return entry ? { ok: true, entry: view(entry) } : { ok: false, error: "Eintrag nicht gefunden." }
}

export function deleteBotMemoryEntry(botId: string, name: string) {
  if (!exists(botId)) return { ok: false, error: "Orbi nicht gefunden." }
  const result = forgetEntry(getDatabase().$client, botId, name, "gelöscht in der App")
  return result.ok ? { ok: true } : { ok: false, error: "Eintrag nicht gefunden." }
}

const GERMAN: Record<string, string> = {
  "Entry changed": "Der Eintrag wurde inzwischen geändert. Lade die Ansicht neu.",
  "Description needs": "Die Beschreibung braucht 1 bis 150 Zeichen in einer Zeile.",
  "Body needs": "Der Text braucht 1 bis 1200 Zeichen.",
  "Memory is too large": "Das Gedächtnis wäre zu groß.",
}
const german = (error: string) =>
  Object.entries(GERMAN).find(([key]) => error.startsWith(key))?.[1] ??
  (error.includes("credentials") || error.toLowerCase().includes("secret") || error.includes("Zugangsdaten")
    ? "Der Text sieht nach Zugangsdaten aus und wird nicht gespeichert."
    : "Der Eintrag konnte nicht gespeichert werden.")

// Consti ändert einen Eintrag (gilt als von ihm gesagt). `ifVersion` ist die Version, die er gesehen hat.
export function editBotMemoryEntry(botId: string, name: string, body: unknown) {
  if (!exists(botId)) return { ok: false, error: "Orbi nicht gefunden." }
  const value = body as { description?: unknown; body?: unknown; ifVersion?: unknown } | null
  if (
    !value ||
    typeof value.description !== "string" ||
    typeof value.body !== "string" ||
    typeof value.ifVersion !== "number" ||
    !Number.isInteger(value.ifVersion)
  )
    return { ok: false, error: "Ungültige Eingabe." }
  const result = editEntry(getDatabase().$client, botId, name, {
    description: value.description,
    body: value.body,
    ifVersion: value.ifVersion,
  })
  if (!result.ok) return { ok: false, error: result.error === "Eintrag nicht gefunden." ? "Eintrag nicht gefunden." : german(result.error) }
  const entry = getEntry(getDatabase().$client, botId, name)
  return { ok: true, entry: entry ? view(entry) : null }
}

export function botMemoryTrash(botId: string) {
  if (!exists(botId)) return { ok: false, error: "Orbi nicht gefunden." }
  return {
    ok: true,
    entries: listTrash(getDatabase().$client, botId).map((e) => ({ ...view(e), deletedAt: e.deletedAt })),
  }
}

export function restoreBotMemoryEntry(botId: string, name: string) {
  if (!exists(botId)) return { ok: false, error: "Orbi nicht gefunden." }
  const result = restoreEntry(getDatabase().$client, botId, name)
  return result.ok ? { ok: true, version: result.version } : { ok: false, error: result.error }
}
