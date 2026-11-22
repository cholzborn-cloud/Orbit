import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { after } from "node:test"

import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"
import type { UIMessage } from "ai"
import { MockLanguageModelV3 } from "ai/test"

// Phase 4, Lauf G, ganze Kette mit Modell-Mock und Temp-Datenbank: Stabilitäts-Reihenfolge, Turn-Log, Zusammenfassung,
// Verlaufsgrenze für Automationen, chat_recall. Kein echtes Modell, nie die persönlichen App-Daten.
const dir = mkdtempSync(join(tmpdir(), "orbitd-p4g-"))
process.env.ORBIT_DATA_DIR = dir
process.env.ORBIT_AGENTS_PATH = "/gibt/es/nicht/AGENTS.md"
delete process.env.BRAIN_SERVER_URL

const { getDatabase } = await import("@/lib/db/client")
const { bots, chatMembers, chats } = await import("@/lib/db/schema")
const { cli } = await import("@/lib/cli/provider")
cli.available = async () => true
const { createChatRuntime } = await import("./runtime")
const { createMessageStore } = await import("./store")
const { createTurnHandler } = await import("./handle-turn")
const { createSql } = await import("@/lib/db/sql")
const { createRecallTool } = await import("@/lib/chat/recall")
const { SUMMARY_SYSTEM } = await import("@/lib/chat/summary")
const { ohnePromptLabor } = await import("./fixtures/prompt-labor.ts")

const db = getDatabase()
const sql = createSql(db.$client)
type Seen = { system: string; messages: string[]; tools: string[]; text: string }
const turns: Seen[] = []
let summaryCalls = 0
const SUMMARY = JSON.stringify({
  goal: "Testverlauf",
  decisions: ["A gewählt"],
  facts: ["F1"],
  files: [],
  open: [{ task: "Weiter testen", status: "open" }],
})
const usage = { inputTokens: { total: 1000, noCache: 100, cacheRead: 800, cacheWrite: 100 }, outputTokens: { total: 10 } }
const model = new MockLanguageModelV3({
  doGenerate: async (options: LanguageModelV3CallOptions) => {
    assert.equal(String(options.prompt.find((m) => m.role === "system")?.content), SUMMARY_SYSTEM)
    summaryCalls++
    return {
      content: [{ type: "text" as const, text: SUMMARY }],
      finishReason: { unified: "stop" as const, raw: "stop" },
      usage: { inputTokens: { total: 5000, noCache: 5000 }, outputTokens: { total: 200 } },
      warnings: [],
    } as never
  },
  doStream: async (options: LanguageModelV3CallOptions) => {
    const messages = options.prompt.filter((m) => m.role !== "system").map((m) => JSON.stringify(m))
    turns.push({
      system: String(options.prompt.find((m) => m.role === "system")?.content ?? ""),
      messages,
      tools: (options.tools ?? []).map((t) => t.name),
      text: JSON.stringify(options.prompt),
    })
    return {
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: "stream-start", warnings: [] })
          c.enqueue({ type: "text-start", id: "0" })
          c.enqueue({ type: "text-delta", id: "0", delta: "Antwort" })
          c.enqueue({ type: "text-end", id: "0" })
          c.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage })
          c.close()
        },
      }),
    }
  },
})
;(cli as unknown as { chat: (id: string) => unknown }).chat = () => model

const user = (id: string, text: string): UIMessage => ({ id, role: "user", parts: [{ type: "text", text }] })
const assistant = (id: string, text: string): UIMessage => ({ id, role: "assistant", parts: [{ type: "text", text }] })

db.insert(bots).values([
  { id: "alpha", userId: "local", thirdPartyId: "x", name: "Alpha", job: "Hauptorbi", isMain: true },
  { id: "rex", userId: "local", thirdPartyId: "x", name: "Rexford", job: "Recherche" },
]).run()
db.insert(chats).values([{ id: "c1", userId: "local" }, { id: "c2", userId: "local" }]).run()
db.insert(chatMembers).values([{ chatId: "c1", botId: "alpha" }, { chatId: "c2", botId: "rex" }]).run()
const store = createMessageStore(db)
const runtime = createChatRuntime(store)
const handle = createTurnHandler(store, runtime.runRoot)

async function send(chatId: string, message: UIMessage) {
  const release = runtime.reserveRoot(chatId)!
  const started = runtime.turns.start(
    chatId,
    (signal) => handle({ chatId, body: { messages: [message], clientData: { model: "claude-haiku-5-5", effort: "low" } }, signal }),
    release
  )
  assert.ok(started)
  const until = Date.now() + 15_000
  await new Promise((r) => setTimeout(r, 30))
  while (runtime.turns.isRunning(chatId) && Date.now() < until) await new Promise((r) => setTimeout(r, 20))
  assert.equal(runtime.turns.isRunning(chatId), false, "Turn wurde nicht fertig")
}
const row = (chatId: string) =>
  db.$client.prepare("select * from turn_usage where chat_id = ? order by created_at desc, rowid desc limit 1").get(chatId) as Record<string, unknown>

test("Stabilitäts-Reihenfolge, Turn-Log und Zusammenfassung über der Schwelle", async () => {
  // 30 Turns à ~2400 Zeichen = ~72 000 Zeichen: über der Schwelle (60 000), unter der harten Grenze (90 000).
  const history = Array.from({ length: 30 }, (_, i) => [user(`u${i}`, `FRAGE-${i} ${"f".repeat(1200)}`), assistant(`a${i}`, `ANTWORT-${i} ${"a".repeat(1200)}`)]).flat()
  await store.saveMessages("c1", history)
  await send("c1", user("neu1", "FRAGE-NEU1"))

  const first = turns.at(-1)!
  // System: nur Festes. Datum, Team, Gedächtnis-Zeile, Hinweise stehen nicht darin.
  assert.ok(first.system.startsWith("You are Alpha"))
  assert.doesNotMatch(first.system, /Rexford|Today:|Memory hash|The user's other Orbis/)
  assert.ok(ohnePromptLabor(first.system).length < 5800)
  // Wechselndes: eigene Nachricht direkt vor der letzten Nutzer-Nachricht.
  const note = first.messages.length - 2
  assert.match(first.messages[note]!, /<orbit_context>/)
  assert.match(first.messages[note]!, /Today: \d{4}-\d{2}-\d{2}/)
  assert.match(first.messages[note]!, /Rexford/)
  assert.match(first.messages.at(-1)!, /FRAGE-NEU1/)
  // Werkzeuge stabil sortiert, chat_recall dabei.
  assert.deepEqual(first.tools, [...first.tools].sort())
  assert.ok(first.tools.includes("chat_recall"))
  // Noch kein Verlauf gekürzt: alle 61 Nachrichten + Hinweis.
  assert.equal(first.messages.length, 61 + 1)

  // Turn-Log: neue Spalten gefüllt.
  const usageRow = row("c1")
  assert.equal(usageRow.steps, 1)
  assert.equal(usageRow.turn_kind, "user")
  assert.equal(usageRow.summary_used, 0)
  assert.equal(usageRow.cached_tokens, 800)
  assert.equal(usageRow.cache_write_tokens, 100)
  assert.ok(Math.abs((usageRow.cache_ratio as number) - 0.8) < 1e-9)
  assert.ok((usageRow.cost_usd as number) > 0)
  assert.ok((usageRow.tools_chars as number) > 5000)
  assert.ok((usageRow.volatile_chars as number) > 50)
  assert.ok((usageRow.history_chars as number) > 60_000)
  assert.equal(typeof usageRow.duration_ms, "number")
  assert.equal(usageRow.system_chars, first.system.length)

  // Zusammenfassung läuft im Hintergrund an (Haiku über den Proxy-Mock), genau einmal.
  const until = Date.now() + 5000
  while (Date.now() < until && !db.$client.prepare("select 1 from chat_summaries where chat_id = 'c1'").get()) await new Promise((r) => setTimeout(r, 20))
  const summary = db.$client.prepare("select * from chat_summaries where chat_id = 'c1'").get() as Record<string, unknown>
  assert.ok(summary, "keine Zusammenfassung gespeichert")
  assert.equal(summary.covered_last_id, "a24") // alles vor den letzten 6 Turns (ab u25)
  assert.match(String(summary.data), /## Open work \(JSON\)/)
  assert.equal(summaryCalls, 1)

  // Folge-Turn: das Ältere ist durch die Zusammenfassung ersetzt, die letzten Turns bleiben wörtlich.
  await send("c1", user("neu2", "FRAGE-NEU2"))
  const second = turns.at(-1)!
  assert.ok(second.messages.length < 20, `${second.messages.length} Nachrichten`)
  assert.match(second.messages[0]!, /<earlier_history note=\\"Automatic summary of the earlier messages/)
  assert.match(second.messages[0]!, /Testverlauf/)
  assert.doesNotMatch(second.text, /FRAGE-3 /)
  assert.match(second.text, /FRAGE-25/)
  assert.equal(row("c1").summary_used, 1)
  // Keine zweite Zusammenfassung direkt danach.
  await new Promise((r) => setTimeout(r, 150))
  assert.equal(summaryCalls, 1)
})

test("Automation im bestehenden Chat sieht nur die letzten Turns, chat_recall findet das Alte", async () => {
  const list = await store.listMessages("c1")
  const auto = user("auto1", "[[automation:Morgen]] Sag Hallo")
  const finished = new Promise<void>((resolve) => {
    void runtime
      .runRoot({
        chatId: "c1",
        messages: [...list, auto],
        clientData: { model: "claude-haiku-5-5", effort: "low", context: true, botId: "alpha" },
        internal: { background: true, automationRunId: "run1" },
        signal: new AbortController().signal,
        onFinish: async () => resolve(),
      })
      .then((response) => response.body?.pipeTo(new WritableStream()))
  })
  await finished
  const seen = turns.at(-1)!
  const users = new Set(seen.text.match(/FRAGE-[A-Z0-9]+/g))
  assert.ok(users.size <= 4 + 2 + 1, `${users.size} Fragen im Prompt`)
  assert.match(seen.text, /Sag Hallo/)
  assert.doesNotMatch(seen.tools.join(), /ask_user|automation_create|chat_recall_x/)
  assert.equal(row("c1").turn_kind, "automation")
  assert.match(String(seen.messages[0]), /earlier_history/)

  // chat_recall: Suche im eigenen Verlauf, andere Chats bleiben unsichtbar.
  await store.saveMessages("c2", [user("x1", "Das Geheimwort heißt Zitronenfalter"), assistant("x2", "ok")])
  const recall = createRecallTool({ chatId: "c1", sql })
  const own = (await recall.execute!({ query: "ANTWORT-5" }, { toolCallId: "t", messages: [] })) as { hits: { messageId: string }[] }
  assert.ok(own.hits.some((hit) => hit.messageId === "a5"))
  const foreign = (await recall.execute!({ query: "Zitronenfalter" }, { toolCallId: "t", messages: [] })) as { hits: unknown[] }
  assert.deepEqual(foreign.hits, [])
})

test("chat_recall liest gekappte Ausgaben (out_-ID) und alte Tool-Ergebnisse (Aufruf-ID) stückweise", async () => {
  db.$client.prepare("insert into tool_outputs (id, chat_id, tool, chars, body) values ('out_abc', 'c1', 'web_search', 20000, ?)").run("0123456789".repeat(2000))
  await store.saveMessages("c2", [
    user("t1", "Suche"),
    { id: "t2", role: "assistant", parts: [{ type: "tool-web_search", toolCallId: "call_77", state: "output-available", input: { query: "x" }, output: { answer: "Alter Treffer" } }] } as UIMessage,
  ])
  const own = createRecallTool({ chatId: "c1", sql })
  const first = (await own.execute!({ id: "out_abc" }, { toolCallId: "t", messages: [] })) as { text: string; total: number; nextOffset?: number }
  assert.equal(first.total, 20_000)
  assert.equal(first.text.length, 8000)
  assert.equal(first.nextOffset, 8000)
  const last = (await own.execute!({ id: "out_abc", offset: 16_000 }, { toolCallId: "t", messages: [] })) as { text: string; nextOffset?: number }
  assert.equal(last.text.length, 4000)
  assert.equal(last.nextOffset, undefined)
  // Ein anderer Chat sieht fremde Ablagen nicht.
  assert.deepEqual(await createRecallTool({ chatId: "c2", sql }).execute!({ id: "out_abc" }, { toolCallId: "t", messages: [] }), { error: "Unknown id." })
  const old = (await createRecallTool({ chatId: "c2", sql }).execute!({ id: "call_77" }, { toolCallId: "t", messages: [] })) as { text: string }
  assert.match(old.text, /Alter Treffer/)
  assert.deepEqual(await own.execute!({ id: "call_77" }, { toolCallId: "t", messages: [] }), { error: "Unknown id." })
  assert.deepEqual(await own.execute!({ id: "../x" }, { toolCallId: "t", messages: [] }), { error: "Unknown id." })
})

after(() => {
  db.$client.close()
  rmSync(dir, { recursive: true, force: true })
})

test("Cache-Präfix: der Verlauf von Turn N ist bis vor den Hinweis ein Byte-genauer Anfang von Turn N+1 (auch mit Fremddaten-Ergebnissen)", async () => {
  const { frameUntrustedResults } = await import("@/lib/chat/untrusted")
  const { capToolOutputs } = await import("@/lib/chat/tool-cap")
  const { sortTools } = await import("@/lib/chat/cache")
  const { chooseHistory, withLead } = await import("@/lib/chat/context")
  const { condenseOldToolResults, shortenCutoff } = await import("@/lib/chat/old-results")
  const { toModelMessages } = await import("./model-messages")
  const { tool } = await import("ai")
  const { z } = await import("zod")
  const tools = sortTools(
    capToolOutputs(
      frameUntrustedResults({
        web_search: tool({ description: "d", inputSchema: z.object({ query: z.string() }), execute: async () => "x" }),
        create_file: tool({ description: "d", inputSchema: z.object({ text: z.string() }), execute: async () => "ok" }),
      }),
      () => {}
    )
  )
  const turn = (i: number): UIMessage[] => [
    user(`u${i}`, `Frage ${i}`),
    {
      id: `a${i}`,
      role: "assistant",
      parts: [
        { type: "tool-web_search", toolCallId: `w${i}`, state: "output-available", input: { query: "x" }, output: `Treffer ${i} ${"t".repeat(1200)}` },
        { type: "tool-create_file", toolCallId: `f${i}`, state: "output-available", input: { text: "z".repeat(1800) }, output: "ok" },
        { type: "text", text: `Antwort ${i}` },
      ],
    } as UIMessage,
  ]
  const build = async (turns: number) => {
    const messages = Array.from({ length: turns }, (_, i) => turn(i)).flat()
    // wie turn.ts: Fenster -> Modell-Nachrichten -> Kürzen -> Hinweis; die letzte Frage kommt als neue Nutzer-Nachricht dazu
    const window = chooseHistory(messages)
    return withLead(condenseOldToolResults(await toModelMessages(window.messages, tools)), window.lead)
  }
  let stable = 0
  let moved = 0
  for (let n = 4; n <= 22; n++) {
    const now = await build(n)
    const next = await build(n + 1)
    const prefix = JSON.stringify(now)
    if (JSON.stringify(next).startsWith(prefix.slice(0, -1))) stable++
    else {
      moved++
      // Nur dort, wo die Kürz-Grenze einen Block weiterrückt, darf sich der Anfang ändern.
      assert.notEqual(shortenCutoff(n), shortenCutoff(n + 1), `Präfix ändert sich bei ${n} -> ${n + 1} ohne Blockwechsel`)
    }
  }
  assert.ok(stable >= 11 && moved <= 7, `stabil ${stable}, bewegt ${moved}`)
})

test("Gruppenturns: der Verlauf davor zählt für die Zusammenfassung mit, doppelte Nachrichten nicht", async () => {
  const { messagesForSummary } = await import("./summarize")
  const history = [user("a", "x"), assistant("b", "y")]
  const reply = assistant("c", "z")
  assert.deepEqual(messagesForSummary(history, [reply], true).map((m) => m.id), ["a", "b", "c"])
  assert.deepEqual(messagesForSummary(history, [history[1]!, reply], true).map((m) => m.id), ["a", "b", "c"])
  assert.deepEqual(messagesForSummary(history, [reply], false).map((m) => m.id), ["c"])
})

test("Löscht man den Chat, verschwinden Zusammenfassung und abgelegte Tool-Ausgaben mit", () => {
  db.insert(chats).values({ id: "c-del", userId: "local" }).run()
  db.$client.prepare("insert into tool_outputs (id, chat_id, tool, chars, body) values ('out_del', 'c-del', 'bash', 1, 'x')").run()
  db.$client.prepare("insert into chat_summaries (chat_id, covered_last_id, covered_count, source_chars, summary_chars, data, model) values ('c-del', 'm', 1, 1, 1, 'x', 'm')").run()
  db.$client.prepare("delete from chats where id = 'c-del'").run()
  assert.equal(db.$client.prepare("select count(*) as n from tool_outputs where chat_id = 'c-del'").get()?.n, 0)
  assert.equal(db.$client.prepare("select count(*) as n from chat_summaries where chat_id = 'c-del'").get()?.n, 0)
})
