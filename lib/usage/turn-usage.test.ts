import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import Database from "better-sqlite3"

import { createSql } from "../db/sql.ts"
import { costUsd, cacheRatio, tokenCounts, writeTokens } from "./prices.ts"
import { completeUsage, saveTurnUsage, turnUsageRow } from "./turn-usage.ts"

const usage = {
  inputTokens: 1200,
  outputTokens: 80,
  totalTokens: 1280,
  inputTokenDetails: { noCacheTokens: 200, cacheReadTokens: 1000, cacheWriteTokens: 300 },
  outputTokenDetails: { textTokens: 80, reasoningTokens: 0 },
}

function database() {
  const sqlite = new Database(":memory:")
  for (const file of ["0005_turn_usage.sql", "0007_phase4_g.sql", "0009_phase4_i.sql"]) {
    const migration = readFileSync(new URL(`../../drizzle/sqlite/${file}`, import.meta.url), "utf8")
    // 0007 braucht jev_log und chats; für diesen Test genügen leere Platzhalter.
    if (file.startsWith("0007")) sqlite.exec("create table jev_log (id text); create table chats (id text primary key)")
    // 0009 ändert nur turn_usage (tier, tier_change) und braucht bots; die übrigen Tabellen daraus sind hier nebensächlich.
    if (file.startsWith("0009")) sqlite.exec("create table bots (id text primary key)")
    for (const statement of migration.split("--> statement-breakpoint")) sqlite.exec(statement)
  }
  return sqlite
}

test("Turn-Log schreibt je Turn eine Zeile mit Cache, Kosten, Schritten und Teilgrößen, ohne Inhalte", async () => {
  const sqlite = database()
  const sql = createSql(sqlite)
  const row = turnUsageRow({
    chatId: "c", botId: "b", model: "claude-haiku-5-5", usage: usage as never, systemChars: 7490, toolCount: 33, historyMsgs: 4,
    steps: 3, toolsChars: 15000, volatileChars: 900, historyChars: 5000, toolResultChars: 2000, turnKind: "user", durationMs: 4200, summaryUsed: true, tier: "small", tierChange: "start",
  })
  await saveTurnUsage(sql, row)
  await saveTurnUsage(sql, turnUsageRow({ chatId: "c", botId: "b", model: "unbekannt", usage: undefined, systemChars: 1, toolCount: 0, historyMsgs: 1 }))
  const rows = sqlite.prepare("select * from turn_usage order by created_at, rowid").all() as Record<string, unknown>[]
  assert.equal(rows.length, 2)
  const first = rows[0]!
  assert.equal(first.input_tokens, 1200)
  assert.equal(first.cached_tokens, 1000)
  assert.equal(first.cache_write_tokens, 300)
  assert.equal(first.steps, 3)
  assert.equal(first.turn_kind, "user")
  assert.equal(first.summary_used, 1)
  assert.deepEqual([first.tier, first.tier_change], ["small", "start"])
  assert.equal(first.tools_chars, 15000)
  assert.ok(Math.abs((first.cache_ratio as number) - 1000 / 1200) < 1e-9)
  // Haiku: 200 normal (1 $), 1000 gelesen (0,1 $), 300 geschrieben (1,25 $), 80 Ausgabe (5 $), je 1 Mio.
  assert.ok(Math.abs((first.cost_usd as number) - (200 * 1 + 1000 * 0.1 + 300 * 1.25 + 80 * 5) / 1e6) < 1e-12)
  // Unbekanntes Modell und fehlende Angaben: NULL statt erfundener Werte.
  assert.equal(rows[1]!.cached_tokens, null)
  assert.equal(rows[1]!.cost_usd, null)
  assert.equal(rows[1]!.steps, null)
  assert.equal(rows[1]!.tier_change, null)
  assert.equal(typeof rows[0]!.created_at, "number")
  sqlite.close()
})

test("Preise: Aufteilung der Eingabe, Schreib-Tokens auch aus rohen Anbieterfeldern, Quote", () => {
  assert.deepEqual(tokenCounts(usage as never), { noCache: 200, cacheRead: 1000, cacheWrite: 300, output: 80 })
  const raw = { inputTokens: 1000, outputTokens: 10, totalTokens: 1010, inputTokenDetails: {}, outputTokenDetails: {}, raw: { cache_creation_input_tokens: 400 } }
  assert.equal(writeTokens(raw as never), 400)
  assert.deepEqual(tokenCounts(raw as never), { noCache: 600, cacheRead: 0, cacheWrite: 400, output: 10 })
  assert.equal(cacheRatio(raw as never), null)
  assert.equal(cacheRatio({ inputTokens: 0 } as never), null)
  assert.equal(costUsd("claude-haiku-5-5", undefined), null)
})

test("Teilsummen mit fehlenden Schrittdaten erscheinen nicht als vollständige Token- oder Cachewerte", () => {
  const first = { ...usage, inputTokenDetails: { ...usage.inputTokenDetails } }
  const second = { ...usage, inputTokens: undefined, inputTokenDetails: { ...usage.inputTokenDetails, cacheReadTokens: undefined } }
  const total = completeUsage(usage as never, [first, second] as never)
  assert.equal(total.inputTokens, undefined)
  assert.equal(total.totalTokens, undefined)
  assert.equal(total.inputTokenDetails.cacheReadTokens, undefined)
  assert.equal(total.outputTokens, 80)
  assert.equal(cacheRatio(total), null)
  const row = turnUsageRow({ chatId: "c", botId: "b", model: "gemini-3.8-flash-high", usage: total, systemChars: 1, toolCount: 0, historyMsgs: 1 })
  assert.equal(row.inputTokens, null)
  assert.equal(row.cachedTokens, null)
  assert.equal(row.cacheRatio, null)
})
