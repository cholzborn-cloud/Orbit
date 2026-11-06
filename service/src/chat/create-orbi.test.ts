import "./fixtures/temp-data.ts"
import assert from "node:assert/strict"
import test from "node:test"
import { createOrbiTool } from "../../../lib/chat/create-orbi.ts"
import { protectTools } from "./approvals.ts"
import { InteractionManager } from "../interactions.ts"

test("Orbi-Anlage braucht ausdrücklichen Auftrag oder bestätigte Karte", async () => {
  const made: string[] = [], published: string[] = [], cards: string[] = []
  const store = { create: async () => Date.now(), get: async () => Date.now() }
  let approve = false
  const manager = new InteractionManager({ store, saveRule: async () => {} })
  const original = createOrbiTool({
    avatars: ["a", "b"], takenAvatars: () => [],
    create: async value => { made.push(`${value.name}:${value.avatar}`); return { ok: true, id: value.name, chatId: "c" } },
    created: values => published.push(...values.map(value => value.name)),
  })
  const wrap = (lastUserText?: string) => protectTools({ create_orbi: original }, {
    chatId: "c", ctx: { speaker: { id: "b" } } as never, rules: [], manager, store,
    signal: new AbortController().signal, lastUserText,
    onApproval: async request => { cards.push(request.text ?? ""); await manager.decide(request.id, { approved: approve }) },
    onDecision: () => {},
  }).create_orbi!
  const run = async (tool: ReturnType<typeof wrap>, input: unknown, id: string) => {
    const result = await tool.execute!(input as never, { toolCallId: id, messages: [], abortSignal: new AbortController().signal })
    if (result && typeof result === "object" && Symbol.asyncIterator in result) {
      let last: unknown
      for await (const part of result as AsyncIterable<unknown>) last = part
      return last
    }
    return result
  }
  const args = { name: "Lernhilfe", job: "Lernen" }
  await run(wrap(), args, "denied")
  assert.deepEqual(made, [])
  assert.match(cards[0]!, /Lernhilfe/)
  approve = true
  assert.deepEqual(await run(wrap(), args, "approved"), { ok: true, name: "Lernhilfe" })
  assert.deepEqual(published, ["Lernhilfe"])
  const quote = "Erstelle den Orbi Planer"
  assert.deepEqual(await run(wrap(quote), { name: "Planer", job: "Planen", consti_said: quote }, "explicit"), { ok: true, name: "Planer" })
  assert.deepEqual(made, ["Lernhilfe:a", "Planer:b"])
  assert.equal(cards.length, 2)
  approve = false
  await run(wrap("Erstelle den Orbi Planer"), { name: "A", job: "Anderes", consti_said: "Erstelle den Orbi Planer" }, "wrong-name")
  assert.equal(cards.length, 3)
  assert.equal(made.length, 2)
})
