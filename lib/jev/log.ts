import { localSql } from "../db/sql.ts"
import { nanoid } from "nanoid"

import type { JevInfo } from "./types"

type Sql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<unknown[]>

export function insertJevLog(
  sql: Sql,
  input: { userId: string; chatId?: string; info: JevInfo; payload?: unknown },
  id = nanoid()
) {
  return sql`
    insert into jev_log (id, user_id, chat_id, kind, model, reason, duration_ms, cost_usd, payload)
    values (${id}, ${input.userId}, ${input.chatId ?? null}, ${input.info.kind}, ${input.info.model ?? null},
      ${input.info.reason}, ${input.info.durationMs}, ${input.info.costUsd ?? null}, ${JSON.stringify(input.payload ?? input.info)})
  `
}

export function logJev(input: {
  userId: string
  chatId?: string
  info: JevInfo
  payload?: unknown
}) {
  void insertJevLog(localSql, input).catch(() =>
    console.error("Jev-Protokoll konnte nicht gespeichert werden")
  )
}
