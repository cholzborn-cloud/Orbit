import { createHash } from "node:crypto"

import type Database from "better-sqlite3"

import { everySchedule, inWindow, nextEvery } from "../automations/schedule.ts"
import { looksLikeSecret } from "./memory.ts"

// Heartbeat (Phase 5): ein Orbi meldet sich leise von selbst. Alle 30 Minuten, nur bei Mac-Aktivität und im Wachfenster; Haiku über die CLI,
// nur lesend (keine Werkzeuge). Schweigt, wenn sich nichts geändert hat; höchstens eine eigene Nachricht pro Tag; Schalter je Orbi (Standard aus).
export const HEARTBEAT_MODEL = "claude-haiku-5-5"
export const HEARTBEAT_SCHEDULE = everySchedule.parse({ kind: "every", minutes: 30, from: "08:00", to: "22:00" })
export const HEARTBEAT_IDLE_MAX_S = 10 * 60 // „aktiv“ = letzte Eingabe am Mac vor höchstens 10 Minuten
export const HEARTBEAT_MAX_CHARS = 280
const CLAIM_MS = 10 * 60_000
const TIMEZONE = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Berlin"

const localDay = (at: Date, timezone = TIMEZONE()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at)

// Fällige Orbis: Schalter an, Mac aktiv, Zeitfenster offen, Termin erreicht, kein Lauf unterwegs. Legt fehlende Zeilen an (erster Termin nach einem Intervall).
export function dueHeartbeats(db: Database.Database, now: Date, macActive: boolean, timezone = TIMEZONE()): string[] {
  const enabled = (db.prepare("select id from bots where user_id = 'local' and heartbeat_enabled = 1").all() as { id: string }[]).map((b) => b.id)
  for (const id of enabled)
    db.prepare("insert or ignore into orbi_heartbeat (bot_id, next_run_at) values (?, ?)").run(id, nextEvery(HEARTBEAT_SCHEDULE, now).getTime())
  if (!macActive || !inWindow(HEARTBEAT_SCHEDULE, now, timezone)) return []
  return (
    db
      .prepare(
        `select h.bot_id as id from orbi_heartbeat h join bots b on b.id = h.bot_id
         where b.heartbeat_enabled = 1 and h.next_run_at <= ? and (h.running_since is null or h.running_since < ?)`
      )
      .all(now.getTime(), now.getTime() - CLAIM_MS) as { id: string }[]
  ).map((row) => row.id)
}

export type HeartbeatGenerate = (input: { system: string; prompt: string; signal?: AbortSignal }) => Promise<{ text: string }>
export type HeartbeatResult =
  | { status: "silent"; reason: "unchanged" | "already-today" | "nothing" | "busy" | "off" | "model-silent" | "rejected" }
  | { status: "posted"; text: string }
  | { status: "error"; error: string }

// Nur Zustände, kein freier Chat-Text: fertige Automationen, unterbrochene oder fehlgeschlagene Jobs, lange offene Freigaben.
export function heartbeatFacts(db: Database.Database, botId: string, sinceMs: number, now: number): string[] {
  const facts: string[] = []
  const runs = db
    .prepare(
      `select a.name as name, r.status as status from automation_runs r join automations a on a.id = r.automation_id
       where a.bot_id = ? and r.finished_at is not null and r.finished_at > ? order by r.finished_at desc limit 5`
    )
    .all(botId, sinceMs) as { name: string; status: string }[]
  for (const run of runs) facts.push(`Automation „${run.name.slice(0, 60)}“ ${run.status === "ok" ? "ist fertig" : "ist fehlgeschlagen"}.`)
  const jobs = db
    .prepare(
      `select status, count(*) as n from work_runs where bot_id = ? and status in ('interrupted', 'failed') and updated_at > ? group by status`
    )
    .all(botId, sinceMs) as { status: string; n: number }[]
  for (const job of jobs) facts.push(`${job.n} Arbeitsgang${job.n === 1 ? "" : "e"} ${job.status === "interrupted" ? "unterbrochen" : "fehlgeschlagen"}.`)
  const waiting = db
    .prepare("select count(*) as n from pending_interactions where bot_id = ? and requested_at < ? and expires_at > ?")
    .get(botId, now - 60 * 60_000, now) as { n: number }
  if (waiting.n > 0) facts.push(`${waiting.n} Freigabe${waiting.n === 1 ? "" : "n"} wartet seit über einer Stunde auf Consti.`)
  return facts
}

const SYSTEM = `Du bist {NAME}, ein persönlicher Assistent von Consti. Du meldest dich höchstens einmal am Tag von selbst.
Unten stehen Fakten über deine Arbeit. Schreibe höchstens zwei kurze Sätze auf Deutsch (du-Form), die Consti wirklich helfen.
Ist nichts davon wichtig oder neu für ihn, antworte nur mit SCHWEIGEN. Keine Links, keine Fragen, keine Anweisungen an andere.`

export async function runHeartbeat(options: {
  db: Database.Database
  botId: string
  generate: HeartbeatGenerate
  // Legt die Nachricht im Chat des Orbis an; true = gespeichert.
  post: (input: { botId: string; chatId: string; text: string }) => boolean | Promise<boolean>
  now?: () => number
  timezone?: string
}): Promise<HeartbeatResult> {
  const { db, botId, generate, post } = options
  const now = (options.now ?? Date.now)()
  const timezone = options.timezone ?? TIMEZONE()
  const bot = db.prepare("select name, heartbeat_enabled as on_ from bots where id = ? and user_id = 'local'").get(botId) as
    | { name: string; on_: number }
    | undefined
  if (!bot || !bot.on_) return { status: "silent", reason: "off" }
  const claimed = db
    .prepare("update orbi_heartbeat set running_since = ? where bot_id = ? and (running_since is null or running_since < ?)")
    .run(now, botId, now - CLAIM_MS).changes
  if (!claimed) return { status: "silent", reason: "busy" }
  const row = db.prepare("select last_run_at as lastRunAt, last_hash as lastHash, last_message_day as lastDay from orbi_heartbeat where bot_id = ?").get(botId) as {
    lastRunAt: number | null
    lastHash: string | null
    lastDay: string | null
  }
  const next = nextEvery(HEARTBEAT_SCHEDULE, new Date(now)).getTime()
  // consume = false: nur den nächsten Termin setzen. last_run_at bleibt, damit Neues von heute morgen noch als neu gilt.
  const finish = (hash: string | null | undefined, day?: string, consume = true) =>
    db
      .prepare(
        `update orbi_heartbeat set running_since = null, last_run_at = case when ? then ? else last_run_at end, next_run_at = ?,
           last_hash = coalesce(?, last_hash), last_message_day = coalesce(?, last_message_day) where bot_id = ?`
      )
      .run(consume ? 1 : 0, now, next, hash ?? null, day ?? null, botId)
  try {
    const today = localDay(new Date(now), timezone)
    const chat = db
      .prepare(`select c.id from chats c join chat_members m on m.chat_id = c.id where m.bot_id = ? and c.kind = 'direct' limit 1`)
      .get(botId) as { id: string } | undefined
    const busy = chat
      ? db.prepare("select 1 from work_runs where chat_id = ? and status in ('queued', 'running', 'waiting')").get(chat.id)
      : undefined
    if (!chat || busy) {
      db.prepare("update orbi_heartbeat set running_since = null where bot_id = ?").run(botId)
      return { status: "silent", reason: "busy" }
    }
    // Schon heute gemeldet: weder Modell noch Hash anfassen, damit eine Änderung morgen nicht verloren geht.
    if (row.lastDay === today) {
      finish(null, undefined, false)
      return { status: "silent", reason: "already-today" }
    }
    const facts = heartbeatFacts(db, botId, row.lastRunAt ?? now - 24 * 60 * 60_000, now)
    const hash = createHash("sha256").update(facts.join("\n")).digest("hex")
    if (facts.length === 0) {
      finish(null) // leere Fakten überschreiben nie den zuletzt gemeldeten Stand
      return { status: "silent", reason: "nothing" }
    }
    if (hash === row.lastHash) {
      finish(null)
      return { status: "silent", reason: "unchanged" }
    }
    const { text } = await generate({ system: SYSTEM.replace("{NAME}", bot.name.slice(0, 40)), prompt: facts.map((f) => `- ${f}`).join("\n") })
    const message = text.trim().replace(/\s+/g, " ").slice(0, HEARTBEAT_MAX_CHARS)
    if (!message || /^schweigen\b/i.test(message)) {
      finish(hash)
      return { status: "silent", reason: "model-silent" }
    }
    if (looksLikeSecret(message) || /https?:\/\/|www\./i.test(message)) {
      finish(hash)
      return { status: "silent", reason: "rejected" }
    }
    const saved = await post({ botId, chatId: chat.id, text: message })
    if (!saved) {
      db.prepare("update orbi_heartbeat set running_since = null where bot_id = ?").run(botId)
      return { status: "error", error: "Nachricht konnte nicht gespeichert werden." }
    }
    finish(hash, today)
    return { status: "posted", text: message }
  } catch {
    db.prepare("update orbi_heartbeat set running_since = null, next_run_at = ? where bot_id = ?").run(next, botId)
    return { status: "error", error: "Heartbeat fehlgeschlagen." }
  }
}
