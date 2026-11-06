import assert from "node:assert/strict"
import test from "node:test"
import { tool } from "ai"
import { z } from "zod"

// Phase 2 Punkt 7: Rückfragen und Freigaben eines geweckten Orbis tragen Root-Chat und Absender
// und werden über dieselbe Id beantwortet; Abbruch macht sie hinfällig (aborted).
const store = { create: async () => Date.now(), get: async () => Date.now() }
const callOptions = { messages: [] }
async function final(value: unknown): Promise<unknown> {
  const result = await value
  if (result && typeof result === "object" && Symbol.asyncIterator in result) {
    let last: unknown
    for await (const output of result as AsyncIterable<unknown>) last = output
    return last
  }
  return result
}
const bot = { id: "beta", name: "Beta", avatar: "mond", color: "#aabbcc" }
const route = { root: { chatId: "chat-a", taskId: "task-1" }, from: bot }

async function setup(withRoute: boolean, chatId = "chat-b", onAnswer?: (id: string, input: unknown, answer: import("../../../lib/chat/ask-user.ts").AskUserOutput) => void) {
  const { protectTools } = await import("./approvals.ts")
  const { InteractionManager } = await import("../interactions.ts")
  const { ASK_USER, askUserInput } = await import("../../../lib/chat/ask-user.ts")
  const events: { id: string; status: string; kind: string; root?: unknown; from?: unknown }[] = []
  const manager = new InteractionManager({
    store,
    onChange: (request, decision) =>
      events.push({ ...request, status: decision?.status ?? "pending" }),
  })
  const abort = new AbortController()
  const run = tool({ inputSchema: z.object({ to: z.string() }), execute: async () => ({ sent: true }) })
  const ask = tool({ inputSchema: askUserInput })
  const tools = protectTools(
    { connector_mail__send_message: run, [ASK_USER]: ask },
    {
      chatId,
      ctx: { speaker: bot } as never,
      route: withRoute ? route : undefined,
      rules: [],
      manager,
      store,
      signal: abort.signal,
      onAnswer,
      onApproval: async () => {},
      onDecision: () => {},
    }
  )
  return { manager, tools, events, abort, ASK_USER }
}

test("Bestätigte Frage wird mit tatsächlicher Karte und Antwort an den laufenden Turn gebunden", async () => {
  const { selectedOrbis, ORBI_QUESTION } = await import("../../../lib/chat/onboarding.ts")
  let chosen: ReturnType<typeof selectedOrbis> = null
  const { manager, tools, ASK_USER } = await setup(false, "chat-a", (id, input, answer) => { chosen = selectedOrbis(id, input, answer) })
  const input = { onboardingOrbiSelection: true, questions: [{ question: ORBI_QUESTION, multiple: true, options: [{ label: "A", description: "Lernen" }, { label: "B", description: "Planen" }] }] }
  const pending = final(tools[ASK_USER]!.execute!(input, { ...callOptions, toolCallId: "auswahl-1" }))
  await new Promise((r) => setTimeout(r, 20))
  const card = manager.list()[0]!
  assert.deepEqual(await manager.decide(card.id, { answer: { answers: [{ question: ORBI_QUESTION, answers: ["A"] }] } }), { ok: true })
  await pending
  assert.deepEqual(chosen?.choices.get("a"), { name: "A", job: "Lernen" })
})
const question = { questions: [{ question: "Welche Datei?", options: [{ label: "a", recommended: true }, { label: "b" }] }] }

test("ask_user von B: Karte trägt Root und Absender, Antwort im Root erreicht B", async () => {
  const { manager, tools, ASK_USER } = await setup(true)
  const pending = final(tools[ASK_USER]!.execute!(question, { ...callOptions, toolCallId: "q1" }))
  await new Promise((r) => setTimeout(r, 20))
  const [card] = manager.list()
  assert.ok(card)
  assert.equal(card.kind, "ask")
  assert.equal(card.chatId, "chat-b")
  assert.deepEqual(card.root, { chatId: "chat-a", taskId: "task-1" })
  assert.deepEqual(card.from, bot)
  const result = await manager.decide(card.id, { answer: { answers: [{ question: "Welche Datei?", answers: ["b"] }] } })
  assert.deepEqual(result, { ok: true })
  assert.deepEqual(await pending, { answers: [{ question: "Welche Datei?", answers: ["b"] }] })
})

test("Freigabe von B: Karte trägt Root und Absender, Entscheidung erreicht B", async () => {
  const { manager, tools } = await setup(true)
  const pending = final(
    tools.connector_mail__send_message!.execute!({ to: "anna@example.org" }, { ...callOptions, toolCallId: "m1" })
  )
  await new Promise((r) => setTimeout(r, 20))
  const [card] = manager.list()
  assert.equal(card?.kind, "approval")
  assert.equal(card?.reason, "nachricht")
  assert.deepEqual(card?.root, { chatId: "chat-a", taskId: "task-1" })
  assert.equal(card?.from?.name, "Beta")
  assert.deepEqual(await manager.decide(card!.id, { approved: true }), { ok: true })
  assert.deepEqual(await pending, { sent: true })
})

test("Root-Chat selbst: keine Root-Felder, keine Doppel-Karte", async () => {
  const { manager, tools, ASK_USER } = await setup(false, "chat-a")
  const pending = final(tools[ASK_USER]!.execute!(question, { ...callOptions, toolCallId: "q1" }))
  await new Promise((r) => setTimeout(r, 20))
  const cards = manager.list()
  assert.equal(cards.length, 1)
  assert.equal(cards[0]!.chatId, "chat-a")
  assert.equal(cards[0]!.root, undefined)
  assert.equal(cards[0]!.from, undefined)
  await manager.decide(cards[0]!.id, { answer: { skipped: true } })
  assert.deepEqual(await pending, { skipped: true })
})

test("Abbruch oder Turn-Ende macht die Root-Karte hinfällig (aborted)", async () => {
  const one = await setup(true)
  const pending = final(one.tools[one.ASK_USER]!.execute!(question, { ...callOptions, toolCallId: "q1" }))
  await new Promise((r) => setTimeout(r, 20))
  assert.equal(one.manager.list().length, 1)
  one.abort.abort()
  assert.deepEqual(await pending, { skipped: true })
  assert.equal(one.manager.list().length, 0)
  const last = one.events.at(-1)!
  assert.equal(last.status, "aborted")
  assert.deepEqual(last.root, { chatId: "chat-a", taskId: "task-1" })

  const two = await setup(true)
  void final(two.tools[two.ASK_USER]!.execute!(question, { ...callOptions, toolCallId: "q2" }))
  await new Promise((r) => setTimeout(r, 20))
  two.manager.abortChat("chat-b")
  assert.equal(two.manager.list().length, 0)
  assert.equal(two.events.at(-1)!.status, "aborted")
})
