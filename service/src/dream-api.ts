import { z } from "zod"

import { getDatabase } from "@/lib/db/client"
import { dreamCap, todayCostUsd } from "@/lib/orbi/dream"

// Träumer eines Orbis für die Mac-App: Zustand, letzte Läufe, Änderungslog lesen und ein-/ausschalten.
const exists = (botId: string) =>
  !!getDatabase().$client.prepare("select 1 from bots where id = ? and user_id = 'local'").get(botId)

type Run = {
  id: string
  startedAt: number
  finishedAt: number | null
  status: string
  reason: string | null
  entriesBefore: number | null
  entriesAfter: number | null
  ops: number | null
  costUsd: number | null
  error: string | null
}

export function botDreamer(botId: string) {
  if (!exists(botId)) return { ok: false, error: "Orbi nicht gefunden." }
  const db = getDatabase().$client
  const bot = db.prepare("select dreamer_enabled as enabled from bots where id = ?").get(botId) as { enabled: number }
  const state = db.prepare("select next_run_at as nextRunAt, last_run_at as lastRunAt, running_since as runningSince from orbi_dream where bot_id = ?").get(botId) as
    | { nextRunAt: number; lastRunAt: number | null; runningSince: number | null }
    | undefined
  const runs = db
    .prepare(
      `select id, started_at as startedAt, finished_at as finishedAt, status, reason, entries_before as entriesBefore,
        entries_after as entriesAfter, ops, cost_usd as costUsd, error
       from orbi_dream_runs where bot_id = ? order by started_at desc limit 10`
    )
    .all(botId) as Run[]
  const changes = db
    .prepare(
      `select id, name, action, version, detail, at from orbi_memory_log where bot_id = ? and action like 'dream-%' order by at desc, id desc limit 50`
    )
    .all(botId)
  return {
    ok: true,
    enabled: !!bot.enabled,
    nextRunAt: bot.enabled ? (state?.nextRunAt ?? null) : null,
    lastRunAt: state?.lastRunAt ?? null,
    running: state?.runningSince != null,
    cost: { todayUsd: todayCostUsd(db, Date.now()), capUsd: dreamCap() },
    runs,
    changes,
  }
}

const body = z.object({ enabled: z.boolean() })

export function setBotDreamer(botId: string, input: unknown) {
  if (!exists(botId)) return { ok: false, error: "Orbi nicht gefunden." }
  const parsed = body.safeParse(input)
  if (!parsed.success) return { ok: false, error: "enabled (true/false) fehlt." }
  getDatabase().$client.prepare("update bots set dreamer_enabled = ? where id = ?").run(parsed.data.enabled ? 1 : 0, botId)
  return { ok: true, enabled: parsed.data.enabled }
}
