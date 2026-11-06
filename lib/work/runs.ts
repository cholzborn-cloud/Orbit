import { randomUUID } from "node:crypto"

import type Database from "better-sqlite3"

// Dauerhafte Jobs (Phase 5, Tabelle work_runs): jeder Turn, jede Übergabe und jede Automation legt einen Eintrag an und hält ihn aktuell.
// Beim Start von orbitd werden running/waiting/queued zu interrupted; der Chat bietet dann „Weiter“ an.
export type RunKind = "turn" | "handoff" | "automation" | "task"
export type RunStatus =
  | "queued"
  | "running"
  | "waiting"
  | "done"
  | "failed"
  | "interrupted"

export type RunPayload = {
  // Alles, was „Weiter“ braucht, um denselben Turn mit der letzten Nutzer-Nachricht neu zu starten (nie Geheimnisse, nie Nachrichtentext).
  model?: string
  effort?: string
  modelPinned?: boolean
  context?: boolean
  skill?: { name: string; source?: string }
  taskId?: string
  parentTaskId?: string
  mode?: "work" | "consult" | "notify"
  brief?: string
  // Übergabe: der Chat, in dem Consti geschrieben hat (dort erscheint „Unterbrochen – Weiter“).
  rootChatId?: string
  automationId?: string
  automationRunId?: string
  handoffFrom?: string
}

export type WorkRun = {
  id: string
  kind: RunKind
  chatId: string
  botId: string | null
  parentId: string | null
  status: RunStatus
  payload: RunPayload
  steps: number
  startedAt: number
  updatedAt: number
  finishedAt: number | null
  error: string | null
  note: string | null
}

const COLUMNS = `id, kind, chat_id as chatId, bot_id as botId, parent_id as parentId, status, payload, steps,
  started_at as startedAt, updated_at as updatedAt, finished_at as finishedAt, error, note`

type Row = Omit<WorkRun, "payload"> & { payload: string | null }
const parse = (row: Row): WorkRun => {
  let payload: RunPayload = {}
  try {
    payload = row.payload ? (JSON.parse(row.payload) as RunPayload) : {}
  } catch {
    /* kaputte Nutzlast = leer */
  }
  return { ...row, payload }
}

export function startRun(
  db: Database.Database,
  input: {
    kind: RunKind
    chatId: string
    botId?: string
    parentId?: string
    payload?: RunPayload
    status?: "queued" | "running"
  },
  now = Date.now()
): string {
  const id = randomUUID()
  db.prepare(
    `insert into work_runs (id, kind, chat_id, bot_id, parent_id, status, payload, steps, started_at, updated_at)
     values (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(
    id,
    input.kind,
    input.chatId,
    input.botId ?? null,
    input.parentId ?? null,
    input.status ?? "running",
    JSON.stringify(input.payload ?? {}),
    now,
    now
  )
  return id
}

export function getRun(db: Database.Database, id: string): WorkRun | null {
  const row = db.prepare(`select ${COLUMNS} from work_runs where id = ?`).get(id) as Row | undefined
  return row ? parse(row) : null
}

// Nur laufende Zustände ändern: ein beendeter oder unterbrochener Eintrag wird nie wieder „running“.
export function setRunStatus(
  db: Database.Database,
  id: string,
  status: "queued" | "running" | "waiting",
  now = Date.now()
) {
  db.prepare(
    "update work_runs set status = ?, updated_at = ? where id = ? and status in ('queued', 'running', 'waiting')"
  ).run(status, now, id)
}

export function addStep(db: Database.Database, id: string, now = Date.now()) {
  db.prepare(
    "update work_runs set steps = steps + 1, updated_at = ? where id = ? and status in ('queued', 'running', 'waiting')"
  ).run(now, id)
}

export function finishRun(
  db: Database.Database,
  id: string,
  status: "done" | "failed",
  error?: string,
  now = Date.now()
) {
  db.prepare(
    `update work_runs set status = ?, finished_at = ?, updated_at = ?, error = ?
     where id = ? and status in ('queued', 'running', 'waiting')`
  ).run(status, now, now, error ? error.slice(0, 300) : null, id)
}

// Beim Start von orbitd: alles, was noch läuft oder wartet, ist verwaist. Gibt die betroffenen Einträge zurück.
export function interruptStale(db: Database.Database, now = Date.now()): WorkRun[] {
  return db
    .transaction(() => {
      const rows = db
        .prepare(`select ${COLUMNS} from work_runs where status in ('queued', 'running', 'waiting')`)
        .all() as Row[]
      db.prepare(
        `update work_runs set status = 'interrupted', updated_at = ?, finished_at = ?
         where status in ('queued', 'running', 'waiting')`
      ).run(now, now)
      return rows.map(parse)
    })
    .immediate()
}

// Aktive Einträge (für Seitenleiste und Menüleiste).
export function activeRuns(db: Database.Database): WorkRun[] {
  return (
    db
      .prepare(`select ${COLUMNS} from work_runs where status in ('queued', 'running', 'waiting') order by started_at`)
      .all() as Row[]
  ).map(parse)
}

// Der Chat, in dem „Unterbrochen – Weiter“ erscheint: bei einem Turn sein eigener, bei einer Übergabe der Chat, in dem Consti geschrieben hat.
export const rootOf = (run: WorkRun): string | null =>
  run.kind === "turn" || run.kind === "task"
    ? run.chatId
    : run.kind === "handoff"
      ? (run.payload.rootChatId ?? null)
      : null

// Unterbrochene Turns und Übergaben, je Wurzel-Chat nur der jüngste, und nur solange im Wurzel-Chat danach nichts Neueres lief
// (ein neuer Eintrag dort räumt auf). Automationen holt der Takt nach; sie haben kein „Weiter“.
export function interruptedAll(db: Database.Database): WorkRun[] {
  const rows = (
    db
      .prepare(`select ${COLUMNS} from work_runs where status = 'interrupted' and kind in ('turn', 'handoff') order by started_at desc`)
      .all() as Row[]
  ).map(parse)
  const newer = db.prepare("select 1 from work_runs where chat_id = ? and started_at > ? and id != ? limit 1")
  const seen = new Set<string>()
  const out: WorkRun[] = []
  for (const run of rows) {
    const root = rootOf(run)
    if (!root || seen.has(root)) continue
    if (newer.get(root, run.startedAt, run.id)) continue
    seen.add(root)
    out.push(run)
  }
  return out
}

export function interruptedFor(db: Database.Database, chatId: string): WorkRun | null {
  return interruptedAll(db).find((run) => rootOf(run) === chatId) ?? null
}

// „Weiter“ wurde gedrückt (oder der Hinweis verworfen): der alte Eintrag gilt als erledigt, damit der Hinweis verschwindet.
export function settleInterrupted(
  db: Database.Database,
  id: string,
  note: "fortgesetzt" | "verworfen",
  now = Date.now()
): boolean {
  const run = getRun(db, id)
  if (!run || run.status !== "interrupted") return false
  const root = rootOf(run)
  // Alles, was zu demselben Wurzel-Chat gehört (der Turn und seine unterbrochenen Übergaben), ist damit erledigt.
  const ids = (
    db.prepare("select id from work_runs where status = 'interrupted' and kind in ('turn', 'handoff')").all() as { id: string }[]
  )
    .map((row) => getRun(db, row.id))
    .filter((other): other is WorkRun => !!other && (other.id === id || (!!root && rootOf(other) === root)))
    .map((other) => other.id)
  const mark = db.prepare("update work_runs set status = 'done', note = ?, updated_at = ? where id = ? and status = 'interrupted'")
  for (const other of ids) mark.run(note, now, other)
  return true
}

// Alte, beendete Einträge aufräumen (Einträge mit Hinweis auf eine offene Unterbrechung bleiben).
export function pruneRuns(db: Database.Database, olderThanMs: number, now = Date.now()) {
  db.prepare("delete from work_runs where status in ('done', 'failed') and updated_at < ?").run(now - olderThanMs)
}
