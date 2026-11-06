import assert from "node:assert/strict"
import test from "node:test"
import { agyAdapter } from "./adapters.ts"
import { cliModel } from "./model.ts"

const result = (usage?: unknown) => agyAdapter.parser()(JSON.stringify({ event: "result", result: { status: "SUCCESS", usage } }))

test("Antigravity: fehlende Verbrauchswerte bleiben unbekannt", () => {
  assert.deepEqual(result(), [{ kind: "done" }])
  assert.deepEqual(result({ input_tokens: 10 }), [
    { kind: "usage", usage: { input: 10, noCache: undefined, cacheRead: undefined, output: undefined, reasoning: undefined } },
    { kind: "done" },
  ])
})

test("Antigravity: gemeldete Nullwerte bleiben Null, ungültige Werte bleiben unbekannt", () => {
  assert.deepEqual(result({ input_tokens: 0, cache_read_tokens: 0, output_tokens: 0 }), [
    { kind: "usage", usage: { input: 0, noCache: 0, cacheRead: 0, output: 0, reasoning: undefined } },
    { kind: "done" },
  ])
  assert.deepEqual(result({ input_tokens: 5, cache_read_tokens: 8, output_tokens: -1 }), [
    { kind: "usage", usage: { input: 5, noCache: undefined, cacheRead: undefined, output: undefined, reasoning: undefined } },
    { kind: "done" },
  ])
})

test("Fehlende Cachewerte bleiben bis zur Modellantwort unbekannt", async () => {
  const runner = async function* () { yield JSON.stringify({ event: "result", result: { status: "SUCCESS", response: "Hallo", usage: { input_tokens: 10, output_tokens: 2 } } }) }
  const model = cliModel("gemini-3.8-flash-low", { runner, timeoutMs: 1000 })
  const response = await model.doGenerate({ prompt: [{ role: "user", content: [{ type: "text", text: "Hallo" }] }] })
  assert.equal(response.usage.inputTokens.total, 10)
  assert.equal(response.usage.inputTokens.cacheRead, undefined)
  assert.equal(response.usage.inputTokens.noCache, undefined)
})
