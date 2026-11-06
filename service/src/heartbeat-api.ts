import { z } from "zod"

import { getDatabase } from "@/lib/db/client"
import { HEARTBEAT_SCHEDULE } from "@/lib/orbi/heartbeat"

// Heartbeat eines Orbis für die Mac-App: Schalter lesen und setzen (Standard aus).
const exists = (botId: string) =>
  !!getDatabase().$client.prepare("select 1 from bots where id = ? and user_id = 'local'").get(botId)

export function botHeartbeat(botId: string) {
  if (!exists(botId)) return { ok: false, error: "Orbi nicht gefunden." }
  const db = getDatabase().$client
  const bot = db.prepare("select heartbeat_enabled as enabled from bots where id = ?").get(botId) as { enabled: number }
  const state = db
    .prepare("select next_run_at as nextRunAt, last_run_at as lastRunAt, last_message_day as lastMessageDay from orbi_heartbeat where bot_id = ?")
    .get(botId) as { nextRunAt: number; lastRunAt: number | null; lastMessageDay: string | null } | undefined
  return {
    ok: true,
    enabled: !!bot.enabled,
    everyMinutes: HEARTBEAT_SCHEDULE.minutes,
    window: { from: HEARTBEAT_SCHEDULE.from, to: HEARTBEAT_SCHEDULE.to },
    lastRunAt: state?.lastRunAt ?? null,
    lastMessageDay: state?.lastMessageDay ?? null,
  }
}

export function setBotHeartbeat(botId: string, body: unknown) {
  const parsed = z.object({ enabled: z.boolean() }).safeParse(body)
  if (!parsed.success) return { ok: false, error: "Ungültige Eingabe." }
  if (!exists(botId)) return { ok: false, error: "Orbi nicht gefunden." }
  const db = getDatabase().$client
  db.prepare("update bots set heartbeat_enabled = ? where id = ?").run(parsed.data.enabled ? 1 : 0, botId)
  // Ausschalten räumt eine hängende Sperre weg; Einschalten startet mit dem nächsten Intervall (Zeile legt der Takt an).
  if (!parsed.data.enabled) db.prepare("update orbi_heartbeat set running_since = null where bot_id = ?").run(botId)
  return botHeartbeat(botId)
}
