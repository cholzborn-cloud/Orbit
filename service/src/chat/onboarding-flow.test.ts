import assert from "node:assert/strict"
import test from "node:test"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { MockLanguageModelV3 } from "ai/test"
import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"

process.env.ORBIT_DATA_DIR = mkdtempSync(join(tmpdir(), "orbit-onboarding-test-"))
process.env.ORBIT_FAKE_SANDBOX = "1"
process.env.ORBIT_AGENTS_PATH = "/gibt/es/nicht/AGENTS.md"
delete process.env.BRAIN_SERVER_URL
delete process.env.BRAIN_SERVER_TOKEN

const { getDatabase } = await import("@/lib/db/client")
const { bots, chats, chatMembers } = await import("@/lib/db/schema")
const { cli } = await import("@/lib/cli/provider")
const { createChatRuntime } = await import("./runtime")
const { createMessageStore } = await import("./store")
const { ORBI_QUESTION } = await import("@/lib/chat/onboarding")

const selection = { onboardingOrbiSelection: true, questions: [{ question: ORBI_QUESTION, multiple: true, options: [{ label: "Lernhilfe", description: "Lernen" }, { label: "Planer", description: "Planen" }] }] }
let step = 0
const seen: string[] = []
const mock = new MockLanguageModelV3({
  doStream: async (options: LanguageModelV3CallOptions) => {
    seen.push(JSON.stringify(options.prompt))
    const calls = [
      { name: "ask_user", input: selection },
      { name: "onboarding_finish", input: { instructions: "" } },
      { name: "onboarding_create_orbis", input: { orbis: [{ name: "Lernhilfe", job: "Lernen" }] } },
      { name: "onboarding_finish", input: { instructions: "" } },
    ]
    const call = calls[step++]
    return { stream: new ReadableStream({ start(c) {
      c.enqueue({ type: "stream-start", warnings: [] })
      if (call) c.enqueue({ type: "tool-call", toolCallId: `test-${step}`, toolName: call.name, input: JSON.stringify(call.input) })
      else { c.enqueue({ type: "text-start", id: "t" }); c.enqueue({ type: "text-delta", id: "t", delta: "Fertig" }); c.enqueue({ type: "text-end", id: "t" }) }
      c.enqueue({ type: "finish", finishReason: { unified: call ? "tool-calls" : "stop", raw: undefined }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } })
      c.close()
    } }) }
  },
})
cli.available = async () => true
;(cli as unknown as { chat: () => unknown }).chat = () => mock
const db = getDatabase()
db.insert(bots).values({ id: "haupt", userId: "local", thirdPartyId: "haupt", name: "Haupt", job: "Helfen", isMain: true, onboardingDone: false }).run()
db.insert(chats).values({ id: "chat", userId: "local" }).run()
db.insert(chatMembers).values({ chatId: "chat", botId: "haupt" }).run()
const runtime = createChatRuntime(createMessageStore(db))

test("Bestätigte Orbi-Karte führt im selben Turn genau die gewählte Anlage aus", async () => {
  const abort = new AbortController()
  const timeout = setTimeout(() => abort.abort(), 8000)
  const response = await runtime.runRoot({ chatId: "chat", messages: [], clientData: { model: "claude-haiku-5-5", modelPinned: true, onboarding: true }, signal: abort.signal })
  const reading = response.text()
  const until = Date.now() + 5000
  while (!runtime.manager.list().length && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 20))
  const request = runtime.manager.list()[0]
  assert.ok(request, "Auswahlkarte wurde nicht gestellt")
  assert.deepEqual(await runtime.manager.decide(request.id, { answer: { answers: [{ question: ORBI_QUESTION, answers: ["Lernhilfe"] }] } }), { ok: true })
  await reading
  clearTimeout(timeout)
  const made = db.$client.prepare("select name, job, sandbox_id from bots where id != 'haupt'").all() as { name: string; job: string; sandbox_id: string }[]
  assert.equal(made.length, 1)
  assert.equal(made[0]!.name, "Lernhilfe")
  assert.equal(made[0]!.job, "Lernen")
  assert.match(made[0]!.sandbox_id, /^fake-/)
  assert.ok(seen.some((prompt) => prompt.includes("noch nicht vollständig angelegt")))
  assert.deepEqual(db.$client.prepare("select onboarding_done from bots where id = 'haupt'").get(), { onboarding_done: 1 })
})

test("Eine bloße Modellantwort schließt das Onboarding nicht still ab", async () => {
  db.insert(bots).values({ id: "zweite", userId: "local", thirdPartyId: "zweite", name: "Zweite", job: "Helfen", isMain: false, onboardingDone: false }).run()
  db.insert(chats).values({ id: "chat-zwei", userId: "local" }).run()
  db.insert(chatMembers).values({ chatId: "chat-zwei", botId: "zweite" }).run()
  step = 99
  const response = await runtime.runRoot({ chatId: "chat-zwei", messages: [], clientData: { model: "claude-haiku-5-5", modelPinned: true, onboarding: true }, signal: new AbortController().signal })
  await response.text()
  assert.deepEqual(db.$client.prepare("select onboarding_done from bots where id = 'zweite'").get(), { onboarding_done: 0 })
})
