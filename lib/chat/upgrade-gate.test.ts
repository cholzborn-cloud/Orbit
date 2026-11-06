import assert from "node:assert/strict"
import { test } from "node:test"
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider"
import { tool } from "ai"
import { z } from "zod"
import { createUpgradeGate } from "./upgrade-gate.ts"

const finish: LanguageModelV4StreamPart = {
  type: "finish", finishReason: { unified: "tool-calls", raw: undefined },
  usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } },
}
const call = (toolName: string, toolCallId: string): LanguageModelV4StreamPart => ({ type: "tool-call", toolName, toolCallId, input: "{}" })
const options = (id: string) => ({ toolCallId: id, messages: [], abortSignal: new AbortController().signal })

async function stream(gate: ReturnType<typeof createUpgradeGate>, parts: LanguageModelV4StreamPart[], signal?: AbortSignal) {
  const result = await gate.middleware.wrapStream!({ params: { abortSignal: signal }, doStream: async () => ({ stream: ReadableStream.from(parts) }) } as never)
  const out: LanguageModelV4StreamPart[] = []
  for await (const part of result.stream as unknown as AsyncIterable<LanguageModelV4StreamPart>) out.push(part)
  return out
}

for (const order of ["first", "last"] as const) test(`Upgrade ${order}: andere Aufrufe bleiben sichtbar, werden aber nicht ausgeführt`, async () => {
  const gate = createUpgradeGate()
  let ran = 0, approved = 0, started = 0
  const protectedTools = gate.protect({
    upgrade_model: tool({ inputSchema: z.object({}), execute: async () => ({ ok: true }) }),
    write: tool({ inputSchema: z.object({}), needsApproval: async () => { approved++; return true }, onInputStart: async () => { started++ }, execute: async () => { ran++; return { ok: true } }, toModelOutput: () => { throw new Error("darf bei zurückgestelltem Aufruf nicht aufgerufen werden") } }),
  })
  const calls = order === "first" ? [call("upgrade_model", "u"), call("write", "w")] : [call("write", "w"), call("upgrade_model", "u")]
  const output = await stream(gate, [...calls, finish])
  assert.deepEqual(output.filter((part) => part.type === "tool-call"), calls)
  const write = protectedTools.write!
  assert.equal(await (write.needsApproval as Function)({}, options("w")), false)
  await (write.onInputStart as Function)(options("w"))
  const deferred = await write.execute!({}, options("w"))
  assert.match(JSON.stringify(deferred), /Nicht ausgeführt/)
  const modelOutput = await (write.toModelOutput as Function)({ toolCallId: "w", output: deferred })
  assert.equal(modelOutput.type, "error-text"); assert.match(modelOutput.value, /Nicht ausgeführt/)
  assert.equal(ran, 0); assert.equal(approved, 0); assert.equal(started, 0)
  assert.deepEqual(await protectedTools.upgrade_model!.execute!({}, options("u")), { ok: true })
  assert.deepEqual(await write.execute!({}, options("new")), { ok: true })
  assert.equal(ran, 1)
})

test("Ohne Upgrade bleiben Aufrufe und Freigaben unverändert", async () => {
  const gate = createUpgradeGate(); let ran = 0
  const write = gate.protect({ write: tool({ inputSchema: z.object({}), needsApproval: true, execute: async () => ++ran }) }).write!
  const output = await stream(gate, [call("write", "w"), finish])
  assert.equal(output.filter(part => part.type === "tool-call").length, 1)
  assert.equal(await (write.needsApproval as Function)({}, options("w")), true)
  assert.equal(await write.execute!({}, options("w")), 1)
  assert.equal(ran, 1)
})

test("Fehler, unvollständiger Stream und doppelte IDs geben keine Aufrufe frei", async () => {
  const gate = createUpgradeGate()
  for (const parts of [
    [call("write", "w"), { type: "error", error: new Error("test") } as const, finish],
    [call("write", "w")],
    [call("upgrade_model", "w"), call("write", "w"), finish],
    [call("write", "w"), { ...finish, finishReason: { unified: "error", raw: undefined } } as LanguageModelV4StreamPart],
  ]) {
    const output = await stream(gate, parts)
    assert.equal(output.some(part => part.type === "tool-call"), false)
  }
})

test("Werkzeug-Eingabestrom bleibt bis zur Prüfung zurückgehalten", async () => {
  const gate = createUpgradeGate()
  const output = await stream(gate, [{ type: "tool-input-start", id: "w", toolName: "write" }, { type: "tool-input-delta", id: "w", delta: "{}" }, { type: "tool-input-end", id: "w" }, call("write", "w"), call("upgrade_model", "u"), finish])
  assert.deepEqual(output.map(part => part.type), ["tool-input-start", "tool-input-delta", "tool-input-end", "tool-call", "tool-call", "finish"])
})


test("Abgebrochener Turn gibt auch bei verspätetem Finish keinen Werkzeugaufruf aus", async () => {
  const controller = new AbortController(); controller.abort()
  const output = await stream(createUpgradeGate(), [call("write", "w"), finish], controller.signal)
  assert.equal(output.some(part => part.type === "tool-call"), false)
})


test("Zu große oder zu viele Werkzeugaufrufe brechen sicher ohne Ausführung ab", async () => {
  const gate = createUpgradeGate()
  for (const parts of [
    [call("upgrade_model", "u"), { type: "tool-input-delta", id: "w", delta: "x".repeat(4 * 1024 * 1024) } as const, call("write", "w"), finish],
    [...Array.from({ length: 129 }, (_, i) => call("write", `w${i}`)), finish],
    [...Array.from({ length: 4097 }, () => ({ type: "tool-input-delta" as const, id: "w", delta: "a" })), finish],
  ]) {
    const output = await stream(gate, parts)
    assert.equal(output.some(part => part.type === "tool-call" || part.type === "tool-input-delta"), false)
    assert.equal(output.filter(part => part.type === "error").length, 1)
  }
})
