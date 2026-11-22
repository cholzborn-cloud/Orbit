import type Database from "better-sqlite3"

import { getKv, setKv } from "./store.ts"

// Kostenbudget (Phase 5). Die CLI-Modelle nutzen Abos; Jev und Daytona können Geld kosten.
// Richtwerte aus jev_log.cost_usd und turn_usage. In der Oberfläche steht nie das Wort „Limit“: „Tagesbudget“, „pausiert“.
export type BudgetSettings = { jevDailyUsd: number; maxSandboxes: number }
export const BUDGET_DEFAULTS: BudgetSettings = { jevDailyUsd: 0.5, maxSandboxes: 3 }
export const BUDGET_BOUNDS = { jevDailyUsd: { min: 0, max: 50 }, maxSandboxes: { min: 1, max: 10 } } as const
const KEY = "budget"

export function getBudget(db: Database.Database): BudgetSettings {
  try {
    const raw = JSON.parse(getKv(db, KEY) ?? "{}") as Partial<BudgetSettings>
    return {
      jevDailyUsd: isNum(raw.jevDailyUsd, BUDGET_BOUNDS.jevDailyUsd) ? raw.jevDailyUsd : BUDGET_DEFAULTS.jevDailyUsd,
      maxSandboxes: isNum(raw.maxSandboxes, BUDGET_BOUNDS.maxSandboxes) && Number.isInteger(raw.maxSandboxes)
        ? raw.maxSandboxes
        : BUDGET_DEFAULTS.maxSandboxes,
    }
  } catch {
    return { ...BUDGET_DEFAULTS }
  }
}
const isNum = (v: unknown, b: { min: number; max: number }): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= b.min && v <= b.max

export function setBudget(
  db: Database.Database,
  input: unknown
): { ok: true; budget: BudgetSettings } | { ok: false; error: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) return { ok: false, error: "Ungültiges Tagesbudget." }
  const value = input as Partial<BudgetSettings>
  const current = getBudget(db)
  const next = { ...current }
  if (value.jevDailyUsd !== undefined) {
    if (!isNum(value.jevDailyUsd, BUDGET_BOUNDS.jevDailyUsd)) return { ok: false, error: "Das Tagesbudget für Jev muss zwischen 0 und 50 US-Dollar liegen." }
    next.jevDailyUsd = Math.round(value.jevDailyUsd * 100) / 100
  }
  if (value.maxSandboxes !== undefined) {
    if (!isNum(value.maxSandboxes, BUDGET_BOUNDS.maxSandboxes) || !Number.isInteger(value.maxSandboxes))
      return { ok: false, error: "Die Zahl gleichzeitiger Sandboxes muss zwischen 1 und 10 liegen." }
    next.maxSandboxes = value.maxSandboxes
  }
  setKv(db, KEY, JSON.stringify(next))
  return { ok: true, budget: next }
}

// Beginn des heutigen Tages in Ortszeit.
export const dayStart = (now: number) => {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function jevSpentToday(db: Database.Database, now = Date.now()): number {
  const row = db
    .prepare("select coalesce(sum(cost_usd), 0) as spent from jev_log where created_at >= ?")
    .get(dayStart(now)) as { spent: number }
  return row.spent
}

export type JevBudgetState = "ok" | "hinweis" | "aus"
// 80 % = Hinweis, 100 % = Jev aus. Budget 0 heißt: Jev ist aus.
export function jevState(spent: number, budget: number): { state: JevBudgetState; percent: number } {
  if (budget <= 0) return { state: "aus", percent: 100 }
  const percent = Math.round((spent / budget) * 100)
  return { state: spent >= budget ? "aus" : spent >= budget * 0.8 ? "hinweis" : "ok", percent }
}

// Text für den Jev-Aufruf, wenn das Budget aufgebraucht ist (sonst null).
export function jevBlock(db: Database.Database, now = Date.now()): string | null {
  const { jevDailyUsd } = getBudget(db)
  return jevState(jevSpentToday(db, now), jevDailyUsd).state === "aus"
    ? "Jev pausiert: Tagesbudget aufgebraucht."
    : null
}

export function tokensToday(db: Database.Database, now = Date.now()) {
  return (
    db
      .prepare(
        `select bot_id as botId, sum(case when turn_kind = 'model_step' then 0 else 1 end) as turns, coalesce(sum(input_tokens), 0) as inputTokens, coalesce(sum(output_tokens), 0) as outputTokens
         from turn_usage where created_at >= ? and bot_id != '' group by bot_id order by sum(coalesce(input_tokens, 0) + coalesce(output_tokens, 0)) desc`
      )
      .all(dayStart(now)) as { botId: string; turns: number; inputTokens: number; outputTokens: number }[]
  ).map((row) => ({ ...row, totalTokens: row.inputTokens + row.outputTokens }))
}

// Gleichzeitig laufende Sandboxes: eine Sandbox gilt als belegt, bis sie 15 Minuten unbenutzt war (dann stoppt Daytona sie selbst).
export const SANDBOX_IDLE_MS = 15 * 60_000
export function createSandboxSlots(
  getMax: () => number,
  now: () => number = Date.now,
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  maxWaitMs = 60_000
) {
  const lastUse = new Map<string, number>()
  const active = () => {
    for (const [id, at] of lastUse) if (now() - at >= SANDBOX_IDLE_MS) lastUse.delete(id)
    return [...lastUse.keys()]
  }
  return {
    active: () => active().length,
    // Vor dem Start einer Sandbox: bekannte Sandbox geht sofort, neue wartet, bis ein Platz frei ist (höchstens maxWaitMs).
    async acquire(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
      const started = now()
      for (;;) {
        const ids = active()
        if (ids.includes(id) || ids.length < getMax()) {
          lastUse.set(id, now())
          return { ok: true }
        }
        if (now() - started >= maxWaitMs)
          return { ok: false, error: "Sandbox wartet: das Tagesbudget erlaubt gerade keine weitere. Versuche es später erneut." }
        await sleep(2_000)
      }
    },
    touch(id: string) {
      if (lastUse.has(id)) lastUse.set(id, now())
    },
    release(id: string) {
      lastUse.delete(id)
    },
  }
}
export type SandboxSlots = ReturnType<typeof createSandboxSlots>

export function budgetOverview(db: Database.Database, activeSandboxes: number, now = Date.now()) {
  const budget = getBudget(db)
  const spent = jevSpentToday(db, now)
  return {
    budget,
    jev: { spentUsd: Math.round(spent * 10000) / 10000, ...jevState(spent, budget.jevDailyUsd) },
    sandboxes: { active: activeSandboxes, max: budget.maxSandboxes, waiting: activeSandboxes >= budget.maxSandboxes },
    tokens: tokensToday(db, now),
  }
}
