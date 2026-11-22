import assert from "node:assert/strict"
import test from "node:test"
import type { LanguageModelV4, LanguageModelV4StreamPart } from "@ai-sdk/provider"

import { failoverModel, fallbackChain, resetProviderHealth, providerDown } from "./failover.ts"
import { CliError } from "./types.ts"

const usage = { inputTokens: {}, outputTokens: {} } as never
const fin = { type: "finish", finishReason: { unified: "stop", raw: undefined }, usage } as LanguageModelV4StreamPart
const ok = (text: string): LanguageModelV4 => fake([{ type: "stream-start", warnings: [] }, { type: "text-start", id: "0" }, { type: "text-delta", id: "0", delta: text }, { type: "text-end", id: "0" }, fin])
const failing = (error: Error): LanguageModelV4 => fake([{ type: "stream-start", warnings: [] }, { type: "error", error }, { type: "finish", finishReason: { unified: "error", raw: undefined }, usage } as LanguageModelV4StreamPart])
const empty = (): LanguageModelV4 => fake([{ type: "stream-start", warnings: [] }, fin])
const fake = (parts: LanguageModelV4StreamPart[]): LanguageModelV4 => ({
  specificationVersion: "v4", provider: "x", modelId: "x", supportedUrls: {},
  async doStream() { return { stream: new ReadableStream({ start(c) { for (const p of parts) c.enqueue(p); c.close() } }) } },
  async doGenerate() { throw new Error("n/a") },
})
const run = async (model: LanguageModelV4, providerOptions?: object) => {
  const { stream } = await model.doStream({ prompt: [], providerOptions } as never)
  const parts: LanguageModelV4StreamPart[] = []
  for await (const part of stream as unknown as AsyncIterable<LanguageModelV4StreamPart>) parts.push(part)
  return parts
}
const text = (parts: LanguageModelV4StreamPart[]) => parts.flatMap((p) => (p.type === "text-delta" ? [p.delta] : [])).join("")
const make = (map: Record<string, LanguageModelV4>, tried: string[]) => (id: string) => { tried.push(id); return map[id] ?? failing(new CliError("claude", "failed", "x")) }

test("Failover: Limit bei Claude, Antwort kommt von GPT, ohne Fehlerteil", async () => {
  resetProviderHealth()
  const tried: string[] = []
  const model = failoverModel("claude-sonnet-5-5", { now: () => 0, make: make({ "claude-sonnet-5-5": failing(new CliError("claude", "limit", "Limit")), "gpt-6.1-sol": ok("Hallo") }, tried) })
  const parts = await run(model)
  assert.equal(text(parts), "Hallo")
  assert.ok(!parts.some((p) => p.type === "error"))
  assert.equal(parts.filter((p) => p.type === "stream-start").length, 1)
  assert.deepEqual(tried, ["claude-sonnet-5-5", "gpt-6.1-sol"])
  assert.ok(providerDown("claude", 1000))
})

test("Failover: gesperrter Anbieter wird beim nächsten Mal übersprungen", async () => {
  resetProviderHealth()
  const tried: string[] = []
  const deps = { now: () => 0, make: make({ "claude-sonnet-5-5": failing(new CliError("claude", "login", "x")), "gpt-6.1-sol": ok("A") }, tried) }
  await run(failoverModel("claude-sonnet-5-5", deps))
  tried.length = 0
  await run(failoverModel("claude-sonnet-5-5", deps))
  assert.equal(tried[0], "gpt-6.1-sol")
})

test("Failover: leere Antwort im Einzelchat geht an den nächsten, in Gruppen nicht", async () => {
  resetProviderHealth()
  const tried: string[] = []
  const deps = { now: () => 0, make: make({ "claude-sonnet-5-5": empty(), "gpt-6.1-sol": ok("Antwort") }, tried) }
  assert.equal(text(await run(failoverModel("claude-sonnet-5-5", deps), { cli: { requireAnswer: true } })), "Antwort")
  resetProviderHealth()
  tried.length = 0
  const group = await run(failoverModel("claude-sonnet-5-5", deps), { cli: { requireAnswer: false } })
  assert.equal(text(group), "")
  assert.deepEqual(tried, ["claude-sonnet-5-5"])
})

test("Failover: sind alle aus, kommt genau ein klarer Fehler", async () => {
  resetProviderHealth()
  const parts = await run(failoverModel("claude-sonnet-5-5", { now: () => 0, make: () => failing(new CliError("claude", "limit", "Limit")) }))
  const errors = parts.filter((p) => p.type === "error") as { error: Error }[]
  assert.equal(errors.length, 1)
  assert.match(errors[0]!.error.message, /kein Modell erreichbar/)
})

test("Failover: Abbruch durch den Nutzer wechselt nie den Anbieter", async () => {
  resetProviderHealth()
  const tried: string[] = []
  const controller = new AbortController(); controller.abort()
  const model = failoverModel("claude-sonnet-5-5", { now: () => 0, make: make({ "claude-sonnet-5-5": failing(new CliError("claude", "aborted", "Abgebrochen.")) }, tried) })
  const { stream } = await model.doStream({ prompt: [], abortSignal: controller.signal } as never)
  for await (const _ of stream as unknown as AsyncIterable<unknown>) void _
  assert.deepEqual(tried, ["claude-sonnet-5-5"])
})

test("Failover: Stufe wird für das Ausweichmodell angepasst; Kette enthält andere Anbieter zuerst", async () => {
  resetProviderHealth()
  assert.equal(fallbackChain("claude-opus-5-5")[1], "gpt-6.1-sol")
  const seen: unknown[] = []
  const spy = (id: string): LanguageModelV4 => ({ ...ok("x"), async doStream(o) { seen.push([id, (o.providerOptions as any)?.cli?.effort]); return id === "claude-opus-5-5" ? failing(new CliError("claude", "limit", "L")).doStream(o) : ok("x").doStream(o) } })
  await run(failoverModel("claude-opus-5-5", { now: () => 0, make: spy }), { cli: { effort: "max" } })
  assert.ok(["max", "xhigh", "medium"].includes((seen[1] as any)[1]))
})

test("Failover: fest gewähltes Modell wechselt nie den Anbieter", async () => {
  resetProviderHealth()
  const tried: string[] = []
  const model = failoverModel("claude-sonnet-5-5", { now: () => 0, make: make({ "claude-sonnet-5-5": failing(new CliError("claude", "limit", "Limit")), "gpt-6.1-sol": ok("Hallo") }, tried) }, true)
  const parts = await run(model)
  assert.ok(parts.some((p) => p.type === "error"))
  assert.deepEqual(tried, ["claude-sonnet-5-5"])
})
