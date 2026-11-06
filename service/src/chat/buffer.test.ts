import assert from "node:assert/strict"
import { setTimeout as delay } from "node:timers/promises"
import test from "node:test"
import { createUIMessageStreamResponse, type UIMessageChunk } from "ai"

import { TurnBuffers } from "./buffer.ts"

function source() {
  let controller!: ReadableStreamDefaultController<UIMessageChunk>
  let signal!: AbortSignal
  const stream = new ReadableStream<UIMessageChunk>({
    start(value) {
      controller = value
    },
  })
  return {
    produce: async (value: AbortSignal) => {
      signal = value
      return createUIMessageStreamResponse({ stream })
    },
    push(chunk: UIMessageChunk) {
      controller.enqueue(chunk)
    },
    close() {
      controller.close()
    },
    signal: () => signal,
  }
}

test("Abgehängter Leser beendet den Produzenten nicht; Wiederanhängen spielt vollständig und live", async () => {
  const buffers = new TurnBuffers()
  const input = source()
  assert.equal(buffers.start("chat", input.produce), true)
  assert.equal(buffers.start("chat", input.produce), false)
  const response = (await buffers.response("chat"))!
  assert.equal(response.headers.get("x-vercel-ai-ui-message-stream"), "v1")
  const first = response.body!.getReader()
  input.push({ type: "start", messageId: "answer" })
  input.push({ type: "text-start", id: "text" })
  input.push({ type: "text-delta", id: "text", delta: "eins" })
  await first.read()
  await first.cancel()
  assert.equal(input.signal().aborted, false)
  const replay = (await buffers.response("chat"))!.text()
  input.push({ type: "text-delta", id: "text", delta: "zwei" })
  input.push({ type: "text-end", id: "text" })
  input.push({ type: "finish" })
  input.close()
  const text = await replay
  assert.match(text, /"messageId":"answer"/)
  assert.match(text, /"delta":"eins"/)
  assert.match(text, /"delta":"zwei"/)
  assert.match(text, /\[DONE\]/)
  assert.equal(await (await buffers.response("chat"))!.text(), text)
})

test("Nur stop signalisiert Abbruch; fertige Puffer verfallen", async () => {
  const buffers = new TurnBuffers(10)
  const input = source()
  assert.equal(await buffers.response("missing"), null)
  buffers.start("chat", input.produce)
  await buffers.response("chat")
  assert.equal(buffers.stop("chat"), true)
  assert.equal(input.signal().aborted, true)
  input.push({ type: "abort" })
  input.close()
  assert.match(await (await buffers.response("chat"))!.text(), /"type":"abort"/)
  assert.equal(buffers.stop("chat"), false)
  await delay(30)
  assert.equal(await buffers.response("chat"), null)
})

const MIN = 60_000
const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
const text = (delta = "x"): UIMessageChunk => ({ type: "text-delta", id: "t", delta })

test("Gesamtlimit 60 min je Turn; Wartezeit auf Freigabe zählt nicht dazu", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] })
  const buffers = new TurnBuffers()
  const input = source()
  buffers.start("waiting", input.produce)
  await buffers.response("waiting")
  buffers.setWaiting("waiting", true)
  t.mock.timers.tick(60 * MIN) // beliebig lange Freigabe: weder Leerlauf noch Gesamtzeit laufen
  assert.equal(input.signal().aborted, false)
  buffers.setWaiting("waiting", false)
  for (let i = 0; i < 29; i++) {
    input.push(text())
    await flush()
    t.mock.timers.tick(2 * MIN)
  }
  assert.equal(input.signal().aborted, false) // 58 min aktiv
  input.push(text())
  await flush()
  t.mock.timers.tick(2 * MIN)
  assert.equal(input.signal().aborted, true) // 60 min erreicht
  input.push({ type: "abort" })
  input.close()
  await (await buffers.response("waiting"))!.text()
})

test("Abbruch nach 5 min ohne Lebenszeichen; jedes Lebenszeichen setzt zurück", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] })
  const buffers = new TurnBuffers()
  const input = source()
  buffers.start("idle", input.produce)
  await buffers.response("idle")
  for (let i = 0; i < 5; i++) {
    t.mock.timers.tick(4 * MIN + 59_000)
    assert.equal(input.signal().aborted, false)
    input.push(text())
    await flush()
  }
  t.mock.timers.tick(5 * MIN)
  assert.equal(input.signal().aborted, true)
  input.push({ type: "abort" })
  input.close()
  await (await buffers.response("idle"))!.text()
})

test("Läuft ein Werkzeug, tickt der Leerlauf nicht (Gesamtlimit bleibt); danach wieder", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"] })
  const buffers = new TurnBuffers()
  const input = source()
  buffers.start("tool", input.produce)
  await buffers.response("tool")
  input.push({ type: "tool-input-available", toolCallId: "c", toolName: "bash", input: {} })
  await flush()
  t.mock.timers.tick(10 * MIN)
  assert.equal(input.signal().aborted, false)
  input.push({ type: "tool-output-available", toolCallId: "c", output: "ok" })
  await flush()
  t.mock.timers.tick(4 * MIN)
  assert.equal(input.signal().aborted, false)
  t.mock.timers.tick(1 * MIN)
  assert.equal(input.signal().aborted, true)
  input.push({ type: "abort" })
  input.close()
  await (await buffers.response("tool"))!.text()
})

test("Produzentenfehler wird als SDK-Fehlerstream sichtbar und gibt die Sperre frei", async () => {
  const buffers = new TurnBuffers()
  buffers.start("chat", async () => {
    throw new Error("secret")
  })
  const text = await (await buffers.response("chat"))!.text()
  assert.match(text, /"type":"error"/)
  assert.doesNotMatch(text, /secret/)
  const next = source()
  assert.equal(buffers.start("chat", next.produce), true)
  next.close()
})
