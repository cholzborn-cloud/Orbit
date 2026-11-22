import { nanoid } from "nanoid"
import type Database from "better-sqlite3"

export const exportTables = [
  "bots",
  "user_settings",
  "skills",
  "mcp_connectors",
  "bot_connectors",
  "approval_rules",
  "automations",
] as const
export type ExportTable = (typeof exportTables)[number]
export type NeonExport = Record<ExportTable, Record<string, unknown>[]>

// Atomar, ohne Überschreiben vorhandener Daten. Spalten kommen ausschließlich aus dem lokalen Schema.
export function importNeon(sqlite: Database.Database, data: NeonExport) {
  return sqlite
    .transaction(() => {
      for (const table of exportTables)
        if (
          (
            sqlite.prepare(`select count(*) as n from "${table}"`).get() as {
              n: number
            }
          ).n
        )
          throw new Error(
            "Die lokale Zieldatenbank muss vor dem Import leer sein."
          )
      for (const table of exportTables) {
        const columns = sqlite.pragma(`table_info("${table}")`) as {
          name: string
          type: string
        }[]
        for (const source of data[table]) {
          const row = { ...source }
          if (table !== "bot_connectors") row.user_id = "local"
          if (table === "automations") row.chat_id = null
          const present = columns.filter((column) => column.name in row)
          const values = present.map(({ name, type }) => {
            const value = row[name]
            if (value == null) return null
            if (name.endsWith("_at")) {
              const time =
                value instanceof Date
                  ? value.getTime()
                  : new Date(value as string).getTime()
              if (!Number.isFinite(time))
                throw new Error("Ungültiger Zeitstempel im Export.")
              return time
            }
            if (type.toLowerCase() === "text" && typeof value === "object")
              return JSON.stringify(value)
            return typeof value === "boolean" ? Number(value) : value
          })
          sqlite
            .prepare(
              `insert into "${table}" (${present.map((c) => '"' + c.name + '"').join(",")}) values (${present.map(() => "?").join(",")})`
            )
            .run(...values)
        }
      }
      // Neue leere Direktchats machen importierte Orbis erreichbar; kein alter Verlauf wird übernommen.
      for (const bot of data.bots) {
        const chatId = nanoid()
        sqlite
          .prepare(
            "insert into chats (id, user_id, kind) values (?, 'local', 'direct')"
          )
          .run(chatId)
        sqlite
          .prepare("insert into chat_members (chat_id, bot_id) values (?, ?)")
          .run(chatId, bot.id)
      }
      return Object.fromEntries(
        exportTables.map((table) => [table, data[table].length])
      )
    })
    .immediate()
}
