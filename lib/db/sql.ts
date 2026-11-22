import type Database from "better-sqlite3"

import { getDatabase } from "./client.ts"

const booleanFields = new Set([
  "is_main",
  "onboarding_done",
  "member",
  "enabled",
  "context",
  "jev_auto",
  "jev_handoff",
  "dreamer_enabled",
])
const dateFields = new Set([
  "created_at",
  "updated_at",
  "joined_at",
  "last_message_at",
  "started_at",
  "finished_at",
  "requested_at",
  "last_run_at",
  "resumed_at",
  "next_run_at",
  "deleted_at",
  "lastRunAt",
  "requestedAt",
  "last_user_message_at",
  "at",
])

export function decodeRow(row: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      value == null
        ? value
        : booleanFields.has(key)
          ? Boolean(value)
          : dateFields.has(key) && typeof value === "number"
            ? new Date(value)
            : (key === "schedule" || key === "payload") &&
                typeof value === "string"
              ? JSON.parse(value)
              : value,
    ])
  )
}

export function createSql(sqlite: Database.Database) {
  return async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const statement = sqlite.prepare(strings.join("?"))
    const parameters = values.map((value) =>
      value instanceof Date
        ? value.getTime()
        : typeof value === "boolean"
          ? Number(value)
          : value
    )
    if (statement.reader)
      return (statement.all(...parameters) as Record<string, unknown>[]).map(
        decodeRow
      )
    statement.run(...parameters)
    return []
  }
}

export const localSql = (strings: TemplateStringsArray, ...values: unknown[]) =>
  createSql(getDatabase().$client)(strings, ...values)
