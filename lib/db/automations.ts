import {
  nextRun,
  shouldAutoPause,
  shouldSkipAutoPause,
  type Schedule,
} from "../automations/schedule.ts"
import { getDatabase } from "./client.ts"
import { decodeRow } from "./sql.ts"

// Laufkarten behalten ihren Stand, auch wenn alte Läufe später entfernt werden.
function persistRunMessages(sqlite: ReturnType<typeof getDatabase>["$client"], runIds: string[]) {
  if (!runIds.length) return
  sqlite.prepare(`update chat_messages as m set metadata = json_set(m.metadata,
      '$.automation.status', r.status, '$.automation.startedAt', r.started_at,
      '$.automation.finishedAt', r.finished_at)
    from automation_runs as r
    where m.chat_id = r.chat_id and json_extract(m.metadata, '$.automation.runId') = r.id
      and r.id in (select value from json_each(?))`).run(JSON.stringify(runIds))
}

// Claim und Laufanlage bleiben auch zwischen Web-App und lokalem Worker atomar.
export function claimAutomation(
  automationId: string,
  trigger: string,
  runId: string
) {
  const sqlite = getDatabase().$client
  return sqlite
    .transaction(() => {
      const row = sqlite
        .prepare(
          `
      select * from automations where id = ? and deleted_at is null
        and not exists (select 1 from automation_runs where automation_id = automations.id
          and status in ('running', 'waiting'))
    `
        )
        .get(automationId) as Record<string, unknown> | undefined
      if (!row) return []
      sqlite
        .prepare("update automations set last_run_at = ? where id = ?")
        .run(Date.now(), automationId)
      sqlite
        .prepare(
          "insert into automation_runs (id, automation_id, user_id, status, trigger) values (?, ?, ?, 'running', ?)"
        )
        .run(runId, automationId, row.user_id, trigger)
      return [decodeRow({ ...row, lastRunAt: row.last_run_at, runId })]
    })
    .immediate()
}

export function createAutomationChat(runId: string, chatId: string) {
  const sqlite = getDatabase().$client
  return sqlite
    .transaction(() => {
      const row = sqlite
        .prepare(
          `
      select r.user_id, a.bot_id, a.name from automation_runs r
      join automations a on a.id = r.automation_id and a.user_id = r.user_id
      where r.id = ? and r.status = 'running'
    `
        )
        .get(runId) as
        { user_id: string; bot_id: string; name: string } | undefined
      if (!row) return []
      sqlite
        .prepare(
          "insert into chats (id, user_id, kind, name) values (?, ?, 'automation', ?)"
        )
        .run(chatId, row.user_id, row.name)
      sqlite
        .prepare("insert into chat_members (chat_id, bot_id) values (?, ?)")
        .run(chatId, row.bot_id)
      sqlite
        .prepare("update automation_runs set chat_id = ? where id = ?")
        .run(chatId, runId)
      return [{ chatId }]
    })
    .immediate()
}

// Hängende Läufe (App beendet, Worker abgestürzt) als Fehler abschließen.
// Läufe, die der Dienst gerade selbst führt, sind nicht verwaist: sie dürfen bis zu 24 h auf eine Freigabe warten.
export function sweepStaleRuns(now = Date.now(), activeRunIds: string[] = []) {
  const sqlite = getDatabase().$client
  sqlite.transaction(() => {
    const changed = sqlite.prepare(
      `update automation_runs set status = 'error', finished_at = ?,
        error = case status when 'waiting' then 'Freigabe abgelaufen' else 'Lauf abgebrochen' end
      where finished_at is null
        and id not in (select value from json_each(?))
        and ((status = 'waiting' and started_at < ?) or (status = 'running' and started_at < ?)) returning id`
    )
    .all(now, JSON.stringify(activeRunIds), now - 600_000, now - 900_000) as { id: string }[]
    persistRunMessages(sqlite, changed.map((row) => row.id))
  }).immediate()
}

// Fällige Automationen atomar übernehmen: nächster Termin wird sofort gesetzt,
// damit derselbe Termin nie zweimal startet. Verpasste Termine laufen einmal nach.
export function dispatchDue(now = new Date()) {
  const sqlite = getDatabase().$client
  return sqlite
    .transaction(() => {
      const due = sqlite
        .prepare(
          `select a.id, a.schedule, a.timezone, a.last_run_at, a.resumed_at,
            (select max(m.created_at) from chat_messages_index m join chats c on c.id = m.chat_id
              where c.user_id = a.user_id and c.kind in ('direct','group') and m.role = 'user') as last_user_message_at
          from automations a
          where a.enabled = 1 and a.deleted_at is null and a.paused_reason is null
            and a.next_run_at <= ?`
        )
        .all(now.getTime()) as {
        id: string
        schedule: string
        timezone: string
        last_run_at: number | null
        resumed_at: number | null
        last_user_message_at: number | null
      }[]
      const started: string[] = []
      for (const a of due) {
        const at = (n: number | null) => (n ? new Date(n) : null)
        if (
          !shouldSkipAutoPause(at(a.resumed_at), at(a.last_run_at)) &&
          shouldAutoPause(at(a.last_user_message_at), now)
        ) {
          sqlite
            .prepare(
              "update automations set enabled = 0, paused_reason = 'Lange nicht benutzt' where id = ?"
            )
            .run(a.id)
          continue
        }
        const following = nextRun(
          JSON.parse(a.schedule) as Schedule,
          a.timezone,
          now
        )
        // Einmalige Automationen enden nach dem Start; ohne Folgetermin ebenso.
        sqlite
          .prepare(
            "update automations set next_run_at = coalesce(?, next_run_at), enabled = ? where id = ?"
          )
          .run(following?.getTime() ?? null, following ? 1 : 0, a.id)
        started.push(a.id)
      }
      return started
    })
    .immediate()
}

// Der lokale Dienst ist alleiniger Besitzer der Läufe: beim Start sind offene Läufe verwaist.
export function closeOrphanedRuns(now = Date.now()) {
  const sqlite = getDatabase().$client
  sqlite.transaction(() => {
    const changed = sqlite.prepare(
      `update automation_runs set status = 'error', finished_at = ?, error = 'Lauf abgebrochen'
      where finished_at is null and status in ('running', 'waiting') returning id`
    )
    .all(now) as { id: string }[]
    persistRunMessages(sqlite, changed.map((row) => row.id))
  }).immediate()
}

export function setRunStatus(
  runId: string,
  status: "running" | "waiting" | "ok" | "error",
  error?: string,
  now = Date.now()
) {
  const done = status === "ok" || status === "error"
  const sqlite = getDatabase().$client
  sqlite.transaction(() => {
    sqlite.prepare(
      "update automation_runs set status = ?, error = ?, finished_at = ? where id = ?"
    )
    .run(status, error ?? null, done ? now : null, runId)
    persistRunMessages(sqlite, [runId])
  }).immediate()
}

// Nur die letzten 20 Läufe je Automation bleiben; Läufe-Chats ohne eigene Nutzernachricht gehen mit.
export function pruneRuns(automationId: string) {
  const sqlite = getDatabase().$client
  sqlite
    .transaction(() => {
      const removed = sqlite
        .prepare(
          `delete from automation_runs where automation_id = ?
            and id not in (select id from automation_runs where automation_id = ? order by started_at desc limit 20)
            returning chat_id, started_at`
        )
        .all(automationId, automationId) as {
        chat_id: string | null
        started_at: number
      }[]
      for (const run of removed)
        if (run.chat_id)
          sqlite
            .prepare(
              `delete from chats as c where c.id = ? and c.kind = 'automation'
                and not exists (select 1 from chat_messages_index m where m.chat_id = c.id and m.role = 'user' and m.created_at > ?)`
            )
            .run(run.chat_id, run.started_at)
    })
    .immediate()
}
