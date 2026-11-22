import assert from "node:assert/strict"
import test from "node:test"

import { InteractionManager, type InteractionDecision, type PendingInteraction } from "../interactions.ts"
import { TurnBuffers } from "./buffer.ts"
import { askAnswerText } from "./restored.ts"

// Sicherheitsnetz der Lauf-Schicht: Karten gehören ihrem Lauf, Leerlauf zählt nie während eines Werkzeugs (auch über Chunk-Grenzen).
const store = {
  create: async () => Date.now(),
  get: async () => Date.now(),
}
const ask = (chatId: string, toolCallId: string) => ({
  kind: "ask" as const,
  chatId,
  botId: "b",
  toolCallId,
  tool: "ask_user",
  input: { questions: [{ question: "Welche Farbe?", options: [{ label: "Rot" }, { label: "Blau" }] }] },
})

test("Karten: Ende des Hauptlaufs bricht die Karte eines parallelen Seitenlaufs im selben Chat nicht ab", async () => {
  const manager = new InteractionManager({ store: store as never })
  const main = new AbortController()
  const side = new AbortController()
  const mainCard = manager.wait(ask("c", "m1"), main.signal)
  const sideCard = manager.wait(ask("c", "s1"), side.signal)
  await new Promise((resolve) => setTimeout(resolve, 5))
  assert.equal(manager.list("c").length, 2)
  manager.abortChat("c", main.signal)
  assert.deepEqual(await mainCard, { status: "aborted" })
  assert.deepEqual(manager.list("c").map((card) => card.toolCallId), ["s1"])
  const decided = await manager.decide("s1", { answer: { answers: [{ question: "Welche Farbe?", answers: ["Blau"] }] } })
  assert.deepEqual(decided, { ok: true })
  assert.deepEqual(await sideCard, { status: "answered", answer: { answers: [{ question: "Welche Farbe?", answers: ["Blau"] }] } })
})

test("Karten: beantwortete wiederhergestellte Rückfrage setzt die Arbeit fort (ohne „Weiter“), bleibt nicht als Vorab-Entscheidung liegen", async () => {
  const continued: [PendingInteraction, InteractionDecision][] = []
  const removed: string[] = []
  const manager = new InteractionManager({
    store: store as never,
    persist: { save: () => {}, remove: (id) => void removed.push(id) },
    onRestoredDecision: (request, decision) => void continued.push([request, decision]),
  })
  const now = Date.now()
  manager.restore([{ request: { ...ask("c", "r1"), id: "r1", requestedAt: now, expiresAt: now + 60_000 } }])
  // Das Ende eines Laufs in einem anderen Chat lässt sie stehen.
  manager.abortChat("anderer", new AbortController().signal)
  assert.equal(manager.list("c").length, 1)
  assert.deepEqual(await manager.decide("r1", { answer: { answers: [{ question: "Welche Farbe?", answers: ["Rot"] }] } }), { ok: true })
  assert.equal(continued.length, 1)
  assert.equal(continued[0][0].id, "r1")
  assert.deepEqual(removed, ["r1"])
  assert.equal(
    askAnswerText(continued[0][0].input, (continued[0][1] as { answer: never }).answer),
    "Antwort auf deine Rückfrage „Welche Farbe?“: Rot"
  )
})

test("Karten: abgelehnte wiederhergestellte Freigabe setzt nichts fort", async () => {
  const continued: string[] = []
  const manager = new InteractionManager({
    store: store as never,
    persist: { save: () => {}, remove: () => {} },
    onRestoredDecision: (request) => void continued.push(request.id),
  })
  const now = Date.now()
  manager.restore([
    { request: { kind: "approval", chatId: "c", botId: "b", toolCallId: "a1", tool: "shell", input: {}, id: "a1", requestedAt: now, expiresAt: now + 60_000 } },
  ])
  assert.deepEqual(await manager.decide("a1", { approved: false }), { ok: true })
  assert.deepEqual(continued, [])
})

test("Puffer: ein über zwei Chunks geteiltes Werkzeug-Ereignis hält den Leerlauf an (langes Werkzeug wird nicht abgebrochen)", async () => {
  const turns = new TurnBuffers(1000, { totalMs: 5_000, idleMs: 60 })
  const encoder = new TextEncoder()
  const line = `data: ${JSON.stringify({ type: "tool-input-available", toolCallId: "t1", toolName: "x", input: {} })}\n\n`
  let aborted = false
  turns.start("c", async (signal) => {
    signal.addEventListener("abort", () => (aborted = true))
    return new Response(
      new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode(line.slice(0, 25)))
          controller.enqueue(encoder.encode(line.slice(25)))
          // Werkzeug läuft länger als der Leerlauf erlaubt.
          await new Promise((resolve) => setTimeout(resolve, 200))
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "tool-output-available", toolCallId: "t1", output: 1 })}\n\n`))
          controller.close()
        },
      }),
      { headers: { "content-type": "text/event-stream" } }
    )
  })
  await (await turns.response("c"))!.text()
  assert.equal(aborted, false)
})

test("Puffer: Seitenläufe zählen als laufend im Chat, Ende-Hörer meldet jeden Lauf", async () => {
  const turns = new TurnBuffers(1000)
  const ended: string[] = []
  turns.onSettled((key) => ended.push(key))
  let open!: () => void
  const wait = new Promise<void>((resolve) => (open = resolve))
  const body = () =>
    new Response(
      new ReadableStream({
        async start(controller) {
          await wait
          controller.close()
        },
      })
    )
  turns.start("c", async () => body())
  turns.start("c~side~u1", async () => body())
  assert.deepEqual(turns.runningKeys("c").sort(), ["c", "c~side~u1"])
  assert.deepEqual(turns.runningKeys("cx"), [])
  open()
  for (let i = 0; i < 50 && ended.length < 2; i++) await new Promise((resolve) => setTimeout(resolve, 5))
  assert.deepEqual(ended.sort(), ["c", "c~side~u1"])
})

test("Karten: wiederhergestellte Karte verfällt, sobald im Chat neu gearbeitet wurde", async () => {
  const manager = new InteractionManager({ store: store as never, persist: { save: () => {}, remove: () => {} } })
  const now = Date.now()
  manager.restore([{ request: { ...ask("c", "r2"), id: "r2", requestedAt: now, expiresAt: now + 60_000 } }])
  manager.abortChat("c", new AbortController().signal)
  assert.equal(manager.list("c").length, 0)
})
