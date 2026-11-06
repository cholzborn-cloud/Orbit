import "../../service/src/chat/fixtures/temp-data.ts"

import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

import { openDatabase } from "../db/client.ts"
import {
  BUDGET_DEFAULTS,
  budgetOverview,
  createSandboxSlots,
  dayStart,
  getBudget,
  jevBlock,
  jevSpentToday,
  jevState,
  setBudget,
  tokensToday,
} from "./budget.ts"

const dir = mkdtempSync(join(tmpdir(), "orbit-budget-"))
after(() => rmSync(dir, { recursive: true, force: true }))
const db = openDatabase(join(dir, "t.sqlite")).$client
const NOW = new Date(2026, 10, 2, 15, 0, 0).getTime()
const jev = (cost: number | null, at: number) =>
  db.prepare("insert into jev_log (id, user_id, kind, cost_usd, created_at) values (?, 'local', 'route', ?, ?)").run(`j${Math.random()}`, cost, at)

test("Tagesbudget: Standard, Grenzen, Speichern", () => {
  assert.deepEqual(getBudget(db), BUDGET_DEFAULTS)
  assert.equal(setBudget(db, { jevDailyUsd: -1 }).ok, false)
  assert.equal(setBudget(db, { jevDailyUsd: 51 }).ok, false)
  assert.equal(setBudget(db, { maxSandboxes: 0 }).ok, false)
  assert.equal(setBudget(db, { maxSandboxes: 2.5 }).ok, false)
  assert.equal(setBudget(db, "x").ok, false)
  const set = setBudget(db, { jevDailyUsd: 1.234, maxSandboxes: 2 })
  assert.deepEqual(set.ok && set.budget, { jevDailyUsd: 1.23, maxSandboxes: 2 })
  assert.deepEqual(getBudget(db), { jevDailyUsd: 1.23, maxSandboxes: 2 })
  setBudget(db, { jevDailyUsd: 1 })
  assert.deepEqual(getBudget(db), { jevDailyUsd: 1, maxSandboxes: 2 })
})

test("Jev: heute zählt ab Mitternacht, 80 % Hinweis, 100 % aus, Budget 0 = aus", () => {
  jev(0.5, dayStart(NOW) - 1000) // gestern
  jev(null, NOW - 1000) // ohne Kosten
  assert.equal(jevSpentToday(db, NOW), 0)
  assert.equal(jevBlock(db, NOW), null)
  jev(0.79, NOW - 500)
  assert.equal(jevState(jevSpentToday(db, NOW), 1).state, "ok")
  jev(0.02, NOW - 400)
  assert.deepEqual(jevState(jevSpentToday(db, NOW), 1), { state: "hinweis", percent: 81 })
  assert.equal(jevBlock(db, NOW), null) // Hinweis blockiert noch nichts
  jev(0.19, NOW - 300)
  assert.equal(jevState(jevSpentToday(db, NOW), 1).state, "aus")
  assert.match(jevBlock(db, NOW) ?? "", /Tagesbudget/)
  assert.doesNotMatch(jevBlock(db, NOW) ?? "", /limit/i)
  assert.equal(jevState(0, 0).state, "aus")
  // Anderer Tag: wieder frei.
  assert.equal(jevBlock(db, NOW + 24 * 3600_000), null)
})

test("Tokens heute je Orbi aus turn_usage, ohne Modellaufruf", () => {
  const row = (bot: string, input: number, output: number, at: number) =>
    db
      .prepare("insert into turn_usage (id, chat_id, bot_id, model, input_tokens, output_tokens, system_chars, tool_count, history_msgs, created_at) values (?, 'c', ?, 'm', ?, ?, 1, 1, 1, ?)")
      .run(`u${Math.random()}`, bot, input, output, at)
  row("b1", 100, 20, NOW - 10)
  row("b1", 50, 5, NOW - 5)
  row("b2", 400, 100, NOW - 1)
  row("b1", 9999, 9999, dayStart(NOW) - 5)
  assert.deepEqual(tokensToday(db, NOW), [
    { botId: "b2", turns: 1, inputTokens: 400, outputTokens: 100, totalTokens: 500 },
    { botId: "b1", turns: 2, inputTokens: 150, outputTokens: 25, totalTokens: 175 },
  ])
  const overview = budgetOverview(db, 2, NOW)
  assert.equal(overview.sandboxes.waiting, true)
  assert.equal(overview.tokens.length, 2)
  assert.equal(overview.jev.state, "aus")
})

test("Sandboxes: Obergrenze, bekannte Sandbox geht immer, neue wartet, Leerlauf gibt Platz frei", async () => {
  let t = 0
  let max = 2
  const slept: number[] = []
  const slots = createSandboxSlots(
    () => max,
    () => t,
    async (ms) => {
      slept.push(ms)
      t += ms
    },
    10_000
  )
  assert.deepEqual(await slots.acquire("a"), { ok: true })
  assert.deepEqual(await slots.acquire("b"), { ok: true })
  assert.deepEqual(await slots.acquire("a"), { ok: true })
  assert.equal(slots.active(), 2)
  // Dritte wartet bis zum Ende der Wartezeit und meldet dann ohne das Wort „Limit“.
  const third = await slots.acquire("c")
  assert.equal(third.ok, false)
  assert.ok(slept.length >= 4)
  assert.doesNotMatch(!third.ok ? third.error : "", /limit/i)
  // Nach Leerlauf (15 Minuten) ist wieder Platz.
  t += 15 * 60_000
  assert.equal(slots.active(), 0)
  assert.deepEqual(await slots.acquire("c"), { ok: true })
  // Freigeben und Obergrenze anheben.
  slots.release("c")
  max = 3
  assert.deepEqual(await slots.acquire("d"), { ok: true })
  assert.deepEqual(await slots.acquire("e"), { ok: true })
  assert.deepEqual(await slots.acquire("f"), { ok: true })
})
