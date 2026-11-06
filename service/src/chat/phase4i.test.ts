import "./fixtures/temp-data.ts"
import assert from "node:assert/strict"
import test, { after } from "node:test"

import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"
import type { UIMessage } from "ai"
import { MockLanguageModelV3 } from "ai/test"

// Ganze Kette mit Modell-Mock, Jev-Attrappe und Temp-Daten: Start klein und Hochstufung.
process.env.ORBIT_AGENTS_PATH = "/gibt/es/nicht/AGENTS.md"
process.env.OPENROUTER_JEV_API_KEY = "test"
delete process.env.BRAIN_SERVER_URL
delete process.env.BRAIN_SERVER_TOKEN
const dataDir = process.env.ORBIT_DATA_DIR!
assert.match(dataDir, /orbitd-test-data-/) // Temp-Ordner, nicht der echte Datenordner

const { getDatabase } = await import("@/lib/db/client")
const { bots, chatMembers, chats } = await import("@/lib/db/schema")
const { cli } = await import("@/lib/cli/provider")
cli.available = async () => true
const { createChatRuntime } = await import("./runtime")
const { createMessageStore } = await import("./store")
const { createTurnHandler } = await import("./handle-turn")
const { resetJevPause } = await import("@/lib/jev/client")
const { loadStage, COLD_AFTER_MS } = await import("@/lib/jev/stage")

const db = getDatabase()
const sqlite = db.$client
after(() => {
  globalThis.fetch = realFetch
})

// ---- Jev-Attrappe: antwortet mit der Stufe, die der Test gerade vorgibt ----
const realFetch = globalThis.fetch
let jevTier: { tier: string; confidence: number } | "down" = { tier: "small", confidence: 0.9 }
const jevQuestions: string[] = []
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  if (!String(input).includes("openrouter.ai")) return realFetch(input, init)
  const body = JSON.parse(String(init?.body)) as { questions: { tier?: { instructions: string } } }
  jevQuestions.push(body.questions.tier?.instructions ?? "")
  if (jevTier === "down") return new Response("{}", { status: 500 })
  return new Response(JSON.stringify({ answers: { tier: { choice: jevTier.tier, confidence: jevTier.confidence } }, usage: { cost: 0.0002 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  })
}) as typeof fetch

// ---- Modell-Attrappen für den Chat ----
type Step = ({ text: string } | { tool: string; input: object } | { calls: { tool: string; input: object }[] }) & { measured?: { inputTokens: { total?: number; noCache?: number; cacheRead?: number }; outputTokens: { total?: number } } }
let script: Step[] = []
const used: string[] = []
const seen: { tools: string[]; prompt: string }[] = []
const usage = { inputTokens: { total: 100, noCache: 100 }, outputTokens: { total: 10 } }
const finish = (reason: "stop" | "tool-calls") => ({ unified: reason, raw: reason })
const main = new MockLanguageModelV3({
  doStream: async (options: LanguageModelV3CallOptions) => {
    seen.push({ tools: (options.tools ?? []).map((t) => t.name), prompt: JSON.stringify(options.prompt) })
    const step: Step = script.shift() ?? { text: "Antwort" }
    const measured = step.measured ?? usage
    return {
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: "stream-start", warnings: [] })
          if ("tool" in step || "calls" in step) {
            const calls = "calls" in step ? step.calls : [step]
            for (const [index, call] of calls.entries()) c.enqueue({ type: "tool-call", toolCallId: `tc${seen.length}-${index}`, toolName: call.tool, input: JSON.stringify(call.input) })
            c.enqueue({ type: "finish", finishReason: finish("tool-calls"), usage: measured })
          } else {
            c.enqueue({ type: "text-start", id: "0" })
            c.enqueue({ type: "text-delta", id: "0", delta: step.text })
            c.enqueue({ type: "text-end", id: "0" })
            c.enqueue({ type: "finish", finishReason: finish("stop"), usage: measured })
          }
          c.close()
        },
      }),
    }
  },
})
;(cli as unknown as { chat: (id: string) => unknown }).chat = (id: string) => {
  used.push(id)
  return main
}

const user = (id: string, text: string): UIMessage => ({ id, role: "user", parts: [{ type: "text", text }] })
db.insert(bots).values([{ id: "alpha", userId: "local", thirdPartyId: "x", name: "Alpha", job: "Hauptorbi", isMain: true }]).run()
db.insert(chats).values([{ id: "c1", userId: "local" }, { id: "c2", userId: "local" }, { id: "c3", userId: "local" }, { id: "c4", userId: "local" }, { id: "c5", userId: "local" }, { id: "c6", userId: "local" }]).run()
db.insert(chatMembers).values([{ chatId: "c1", botId: "alpha" }, { chatId: "c2", botId: "alpha" }, { chatId: "c3", botId: "alpha" }, { chatId: "c4", botId: "alpha" }, { chatId: "c5", botId: "alpha" }, { chatId: "c6", botId: "alpha" }]).run()
const store = createMessageStore(db)
const runtime = createChatRuntime(store)
const handle = createTurnHandler(store, runtime.runRoot)

async function send(chatId: string, text: string, clientData: object = { model: "auto" }) {
  const release = runtime.reserveRoot(chatId)!
  const started = runtime.turns.start(chatId, (signal) => handle({ chatId, body: { messages: [user(crypto.randomUUID(), text)], clientData }, signal }), release)
  assert.ok(started)
  const until = Date.now() + 15_000
  await new Promise((r) => setTimeout(r, 30))
  while (runtime.turns.isRunning(chatId) && Date.now() < until) await new Promise((r) => setTimeout(r, 20))
  assert.equal(runtime.turns.isRunning(chatId), false, "Turn wurde nicht fertig")
  await new Promise((r) => setTimeout(r, 50)) // Turn-Log und Zusatzarbeiten
}

test("Unvollständige Cachewerte aus mehreren Modellschritten werden nicht als vollständige Summe gespeichert", async () => {
  db.insert(chats).values({ id: "c-messung", userId: "local" }).run()
  db.insert(chatMembers).values({ chatId: "c-messung", botId: "alpha" }).run()
  const originalAvailable = cli.available
  cli.available = async (model) => model.id === "claude-haiku-5-5"
  try {
    jevTier = { tier: "small", confidence: 0.9 }
    script = [
      { tool: "upgrade_model", input: { kind: "large" }, measured: { inputTokens: { total: 100, noCache: 80, cacheRead: 20 }, outputTokens: { total: 10 } } },
      { text: "Antwort", measured: { inputTokens: { total: 100 }, outputTokens: { total: 10 } } },
    ]
    await send("c-messung", "Prüfe diese Aufgabe")
    const row = sqlite.prepare("select input_tokens, cached_tokens, cache_ratio from turn_usage where chat_id = ?").get("c-messung") as Record<string, unknown>
    assert.equal(row.input_tokens, 200)
    assert.equal(row.cached_tokens, null)
    assert.equal(row.cache_ratio, null)
  } finally { cli.available = originalAvailable }
})
const usageRows = (chatId: string) =>
  sqlite.prepare("select model, tier, tier_change as change, turn_kind as kind, steps from turn_usage where chat_id = ? order by created_at, rowid").all(chatId) as {
    model: string
    tier: string | null
    change: string | null
    kind: string | null
    steps: number | null
  }[]

test("Start klein, nur nach oben, Reset nach Pause, Gewähltes unberührt: ganze Kette mit Turn-Log", async () => {
  resetJevPause()
  // 1. Turn: Jev sagt small -> Haiku, wird gemerkt, Anweisung „im Zweifel kleiner“ geht an Jev.
  jevTier = { tier: "small", confidence: 0.9 }
  await send("c1", "Hallo, was geht?")
  assert.equal(used.at(-1), "claude-haiku-5-5")
  assert.match(jevQuestions.at(-1)!, /Im Zweifel die kleinere Stufe/)
  assert.equal(loadStage(sqlite, "c1", "alpha")?.tier, "small")
  // 2. Turn, warm: schwere Aufgabe, Jev sicher -> Hochstufung auf Opus.
  jevTier = { tier: "large", confidence: 0.9 }
  await send("c1", "Analysiere meine gesamte Lernstrategie tiefgehend.")
  assert.equal(used.at(-1), "claude-opus-5-5")
  assert.doesNotMatch(jevQuestions.at(-1)!, /Im Zweifel die kleinere Stufe/)
  assert.equal(loadStage(sqlite, "c1", "alpha")?.model, "claude-opus-5-5")
  // 3. Turn: Jev meint wieder small -> bleibt bei Opus (nie zurück); Höchststufe fragt Jev gar nicht erst.
  jevTier = { tier: "small", confidence: 0.99 }
  const asked = jevQuestions.length
  await send("c1", "Danke!")
  assert.equal(used.at(-1), "claude-opus-5-5")
  assert.equal(jevQuestions.length, asked)
  // 4. Turn nach langer Pause (Cache kalt): frei neu gewählt, wieder klein.
  sqlite.prepare("update chat_model_state set last_turn_at = ? where chat_id = 'c1'").run(Date.now() - COLD_AFTER_MS - 10_000)
  await send("c1", "Neues Thema: Wetter?")
  assert.equal(used.at(-1), "claude-haiku-5-5")
  // 5. Turn: Consti wählt ein Modell: gewinnt, Gedächtnis des Gesprächs bleibt unberührt.
  const before = JSON.stringify(loadStage(sqlite, "c1", "alpha"))
  await send("c1", "Mit Sonnet bitte", { model: "claude-sonnet-5-5", effort: "medium", modelPinned: true })
  assert.equal(used.at(-1), "claude-sonnet-5-5")
  assert.equal(seen.at(-1)!.tools.includes("upgrade_model"), false)
  assert.equal(JSON.stringify(loadStage(sqlite, "c1", "alpha")), before)
  // Turn-Log: Stufe und Änderung je Turn nachvollziehbar.
  assert.deepEqual(usageRows("c1").map((r) => [r.model, r.tier, r.change]), [
    ["claude-haiku-5-5", "small", "start"],
    ["claude-opus-5-5", "large", "upgrade"],
    ["claude-opus-5-5", "large", "keep"],
    ["claude-haiku-5-5", "small", "reset"],
    ["claude-sonnet-5-5", null, "pinned"],
  ])
  // Jev-Protokoll: Hochstufung mit Begründung.
  const jevLog = sqlite.prepare("select reason from jev_log where chat_id = 'c1' order by rowid").all() as { reason: string }[]
  assert.ok(jevLog.some((r) => /^Hochgestuft von .* auf /.test(r.reason)))
  assert.ok(jevLog.some((r) => /^Start klein/.test(r.reason)))
})

test("Jev fällt aus: neues Gespräch bekommt die Standardstufe, ohne etwas zu merken; warm bleibt das Modell", async () => {
  resetJevPause()
  jevTier = "down"
  await send("c2", "Hallo")
  assert.equal(used.at(-1), "claude-sonnet-5-5")
  assert.equal(loadStage(sqlite, "c2", "alpha"), null)
  assert.deepEqual(usageRows("c2").map((r) => r.change), ["fallback"])
  // Warm gemerkt (kleines Modell), dann Ausfall: bleibt klein.
  resetJevPause()
  jevTier = { tier: "small", confidence: 0.9 }
  await send("c2", "Noch eins")
  assert.equal(used.at(-1), "claude-haiku-5-5")
  resetJevPause()
  jevTier = "down"
  await send("c2", "Und noch eins")
  assert.equal(used.at(-1), "claude-haiku-5-5")
  assert.equal(usageRows("c2").at(-1)!.change, "keep")
})

test("Schwere Teilaufgabe wechselt im selben Turn das Modell mit Kontext und getrenntem Verbrauch", async () => {
  resetJevPause()
  jevTier = { tier: "small", confidence: 0.9 }
  const usedBefore = used.length
  seen.length = 0
  script = [{ tool: "upgrade_model", input: { kind: "large" } }, { text: "Analyse fertig" }]
  await send("c3", "Prüfe eine Aufgabe mit schwerer Teilfrage")
  assert.deepEqual(used.slice(usedBefore), ["claude-haiku-5-5", "claude-opus-5-5"])
  assert.match(seen[1]!.prompt, /Prüfe eine Aufgabe mit schwerer Teilfrage/)
  assert.equal(loadStage(sqlite, "c3", "alpha")?.model, "claude-opus-5-5")
  assert.deepEqual(usageRows("c3").map((row) => [row.model, row.steps]), [["claude-haiku-5-5", 1], ["claude-opus-5-5", 1]])
  const details = sqlite.prepare("select tools_chars, volatile_chars, history_chars, tool_result_chars, duration_ms, summary_used from turn_usage where chat_id = 'c3' order by rowid limit 1").get() as Record<string, unknown>
  for (const [name, value] of Object.entries(details)) assert.notEqual(value, null, `${name} muss erhalten bleiben`)
  const { tokensToday } = await import("@/lib/work/budget")
  const all = usageRows("c1").length + usageRows("c2").length + usageRows("c3").length + usageRows("c-messung").length
  assert.equal(tokensToday(sqlite).find((row) => row.botId === "alpha")?.turns, all - 1)
})

test("Ohne verfügbares größeres Modell bleibt der laufende Turn beim bisherigen Modell", async () => {
  resetJevPause()
  jevTier = { tier: "small", confidence: 0.9 }
  cli.available = async (model) => model.id === "claude-haiku-5-5"
  try {
    seen.length = 0
    script = [{ tool: "upgrade_model", input: { kind: "large" } }, { text: "Ich arbeite weiter." }]
    await send("c4", "Schwierige Teilfrage")
    assert.equal(loadStage(sqlite, "c4", "alpha")?.model, "claude-haiku-5-5")
    assert.match(seen[1]!.prompt, /Kein stärkeres Modell verfügbar/)
    assert.deepEqual(usageRows("c4").map((row) => [row.model, row.steps]), [["claude-haiku-5-5", 2]])
  } finally { cli.available = async () => true }
})

test("Im letzten erlaubten Schritt wird kein unmöglicher Modellwechsel zugesagt", async () => {
  resetJevPause()
  jevTier = { tier: "small", confidence: 0.9 }
  script = [...Array.from({ length: 39 }, () => ({ tool: "chat_recall", input: { id: "unknown" } })), { tool: "upgrade_model", input: { kind: "large" } }]
  const before = used.length
  await send("c5", "Bearbeite viele Schritte")
  assert.deepEqual(used.slice(before), ["claude-haiku-5-5"])
  assert.equal(loadStage(sqlite, "c5", "alpha")?.model, "claude-haiku-5-5")
  const stored = sqlite.prepare("select parts from chat_messages where chat_id = 'c5' and role = 'assistant' order by rowid desc limit 1").get() as { parts: string }
  assert.match(stored.parts, /kein weiterer Schritt verfügbar/)
})

test("Gleichzeitiges Werkzeug wird vor der Hochstufung nicht ausgeführt", async () => {
  resetJevPause()
  jevTier = { tier: "small", confidence: 0.9 }
  seen.length = 0
  script = [{ calls: [{ tool: "chat_recall", input: { id: "unknown" } }, { tool: "upgrade_model", input: { kind: "large" } }] }, { text: "Neu geprüft" }]
  const before = used.length
  await send("c6", "Prüfe die schwierige Teilaufgabe")
  assert.deepEqual(used.slice(before), ["claude-haiku-5-5", "claude-opus-5-5"])
  assert.match(seen[1]!.prompt, /Nicht ausgeführt/)
  assert.match(seen[1]!.prompt, /chat_recall/)
  assert.doesNotMatch(seen[1]!.prompt, /Unknown id/)
})

test("Träumer über den Takt und die API: still, ein-/ausschaltbar, Log sichtbar, keine Chats oder Automationsläufe", async () => {
  const { botDreamer, setBotDreamer } = await import("../dream-api")
  const { createDreamer } = await import("../dream")
  const { createScheduler } = await import("../scheduler")
  const { saveEntry } = await import("@/lib/orbi/local-memory")
  for (const [name, body] of [["tee-eins", "Trinkt abends Tee."], ["tee-zwei", "Abends gibt es Tee."], ["sport", "Geht dienstags laufen."]] as const)
    assert.equal(saveEntry(sqlite, "alpha", { name, type: "project", description: `Eintrag ${name}`, body, from: "self", source: "Test" }).ok, true)
  const count = (table: string) => (sqlite.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n
  const chatsBefore = count("chats")
  const runsBefore = count("automation_runs")
  const messagesBefore = count("chat_messages_index")

  assert.deepEqual(setBotDreamer("gibt-es-nicht", { enabled: true }), { ok: false, error: "Orbi nicht gefunden." })
  assert.equal((setBotDreamer("alpha", { enabled: "ja" }) as { ok: boolean }).ok, false)
  const initial = botDreamer("alpha") as { ok: true; enabled: boolean; runs: unknown[]; cost: { capUsd: number } }
  assert.equal(initial.enabled, true)
  assert.deepEqual(initial.runs, [])
  assert.equal(initial.cost.capUsd, 0.2)
  assert.deepEqual(botDreamer("fremd"), { ok: false, error: "Orbi nicht gefunden." })

  let generated = 0
  const dreamer = createDreamer({
    generate: async () => (
      generated++,
      {
        text: JSON.stringify({ ops: [{ op: "merge", from: ["tee-eins", "tee-zwei"], into: { name: "tee", type: "project", description: "Abends Tee", body: "Trinkt abends Tee." } }] }),
        usage: { inputTokens: 500, outputTokens: 100 } as never,
      }
    ),
  })
  // Der Takt des Dienstes ruft den Träumer: erst nach dem Termin, genau einmal, ausgeschaltet gar nicht.
  const scheduler = createScheduler({ start: () => null, jobs: [(now) => void dreamer.tick(now)] })
  scheduler.tick()
  assert.equal(generated, 0) // Termin liegt bei 03:00, jetzt ist noch nicht fällig
  sqlite.prepare("update orbi_dream set next_run_at = 0 where bot_id = 'alpha'").run()
  assert.equal(setBotDreamer("alpha", { enabled: false }).ok, true)
  assert.equal(dreamer.tick(new Date()).length, 0)
  assert.equal((botDreamer("alpha") as { nextRunAt: number | null }).nextRunAt, null)
  sqlite.prepare("update orbi_dream set next_run_at = 0 where bot_id = 'alpha'").run()
  assert.equal(setBotDreamer("alpha", { enabled: true }).ok, true)
  const started = dreamer.tick(new Date())
  assert.equal(started.length, 1)
  assert.equal((await started[0]!).status, "ok")
  assert.equal(dreamer.tick(new Date()).length, 0) // nicht noch einmal
  assert.equal(generated, 1)

  const view = botDreamer("alpha") as { runs: { status: string; ops: number; entriesBefore: number; entriesAfter: number }[]; changes: { action: string; detail: string }[]; running: boolean; lastRunAt: number }
  assert.deepEqual([view.runs[0]!.status, view.runs[0]!.ops, view.runs[0]!.entriesBefore, view.runs[0]!.entriesAfter], ["ok", 1, 3, 2])
  assert.equal(view.changes[0]!.action, "dream-merge")
  assert.match(view.changes[0]!.detail, /Trinkt abends Tee|Abends gibt es Tee/)
  assert.equal(view.running, false)
  // Still: kein Chat, keine Nachricht, kein Automationslauf, keine Automation.
  assert.equal(count("chats"), chatsBefore)
  assert.equal(count("automation_runs"), runsBefore)
  assert.equal(count("chat_messages_index"), messagesBefore)
  assert.equal(count("automations"), 0)
})
