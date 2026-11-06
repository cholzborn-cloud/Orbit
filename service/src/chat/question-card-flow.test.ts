import assert from "node:assert/strict"
import test from "node:test"

import { MockLanguageModelV4 } from "ai/test"
import { isStepCount, streamText, tool, wrapLanguageModel } from "ai"
import { z } from "zod"

import { createQuestionCardGate } from "../../../lib/chat/question-card.ts"

// Ende-zu-Ende mit dem echten SDK: Frage im Fließtext → Karte (ask_user) → Antwort geht als Werkzeugergebnis an das Modell.
test("Frage im Fließtext wird zur Karte, die Antwort erreicht das Modell im nächsten Schritt", async () => {
  const prompts: unknown[] = []
  let call = 0
  const model = new MockLanguageModelV4({
    doStream: async (options) => {
      prompts.push(options.prompt)
      const text = call++ === 0 ? "Entwurf ist fertig. Soll ich ihn an Jev schicken?" : "Gut, ich schicke ihn."
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "stream-start", warnings: [] })
            c.enqueue({ type: "text-start", id: "0" })
            c.enqueue({ type: "text-delta", id: "0", delta: text })
            c.enqueue({ type: "text-end", id: "0" })
            c.enqueue({ type: "finish", finishReason: { unified: "stop", raw: undefined }, usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } } })
            c.close()
          },
        }),
      }
    },
  })
  const asked: unknown[] = []
  const result = streamText({
    model: wrapLanguageModel({ model, middleware: [createQuestionCardGate({ enabled: true })] }),
    tools: {
      ask_user: tool({
        inputSchema: z.object({ questions: z.array(z.object({ question: z.string(), options: z.array(z.object({ label: z.string(), recommended: z.boolean().optional() })) })) }),
        execute: async (input) => {
          asked.push(input)
          return { answers: [{ question: input.questions[0].question, answers: ["Ja"] }] }
        },
      }),
    },
    stopWhen: isStepCount(5),
    prompt: "Schreib den Entwurf.",
  })
  await result.consumeStream()
  assert.equal(asked.length, 1)
  assert.deepEqual(asked[0], { questions: [{ question: "Soll ich ihn an Jev schicken?", options: [{ label: "Ja", recommended: true }, { label: "Nein" }] }] })
  assert.equal(call, 2)
  assert.match(JSON.stringify(prompts[1]), /"answers":\["Ja"\]/)
  assert.equal(await result.text, "Gut, ich schicke ihn.")
})
