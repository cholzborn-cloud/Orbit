import assert from "node:assert/strict"
import { test } from "node:test"

import { streamText, tool, type UIMessage } from "ai"
import { MockLanguageModelV3 } from "ai/test"
import { z } from "zod"

import { toModelMessages } from "./model-messages"

const tools = { bash: tool({ description: "x", inputSchema: z.object({ command: z.string() }), execute: async () => "ok" }) }

test("neue Nachricht nach einem Stopp mitten im Werkzeugaufruf scheitert nicht an fehlendem Ergebnis", async () => {
  const messages: UIMessage[] = [
    { id: "1", role: "user", parts: [{ type: "text", text: "run" }] },
    // Zustand nach „Stopp“ während der Ausführung: Aufruf da, Ergebnis fehlt.
    { id: "2", role: "assistant", parts: [{ type: "step-start" }, { type: "tool-bash", toolCallId: "t1", state: "input-available", input: { command: "sleep 40" } }] },
    { id: "3", role: "user", parts: [{ type: "text", text: "hallo" }] },
  ]
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: "stream-start", warnings: [] })
          controller.enqueue({ type: "text-start", id: "0" })
          controller.enqueue({ type: "text-delta", id: "0", delta: "hi" })
          controller.enqueue({ type: "text-end", id: "0" })
          controller.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } })
          controller.close()
        },
      }),
    }),
  })
  const result = streamText({ model, messages: await toModelMessages(messages, tools), tools, onError: () => {} })
  const errors: unknown[] = []
  let text = ""
  for await (const part of result.fullStream) {
    if (part.type === "error") errors.push(part.error)
    if (part.type === "text-delta") text += part.text
  }
  assert.deepEqual(errors, [])
  assert.equal(text, "hi")
})
