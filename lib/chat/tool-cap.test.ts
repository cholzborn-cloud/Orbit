import assert from "node:assert/strict"
import { test } from "node:test"
import { tool, type ToolSet } from "ai"
import { z } from "zod"

import { frameUntrusted } from "./orbi-message.ts"
import { capText, capToolOutputs, outputId, TOOL_OUTPUT_CAP, TOOL_OUTPUT_HEAD, type StoredOutput } from "./tool-cap.ts"

test("Kurze Ausgaben bleiben unberührt; lange: Kopf + ID, voller Text wird abgelegt", () => {
  const saved: StoredOutput[] = []
  assert.equal(capText("bash", "kurz", (row) => saved.push(row)), "kurz")
  const long = "ab".repeat(30_000)
  const out = capText("bash", long, (row) => saved.push(row))
  assert.ok(out.length < TOOL_OUTPUT_CAP)
  assert.ok(out.startsWith(long.slice(0, TOOL_OUTPUT_HEAD)))
  assert.match(out, /60000 characters in total/)
  assert.ok(out.includes(`chat_recall id="${outputId(long)}" offset=${TOOL_OUTPUT_HEAD}`))
  assert.equal(saved.length, 1)
  assert.equal(saved[0]!.body, long)
  assert.equal(saved[0]!.chars, 60_000)
})

test("Fremddaten-Rahmen behält seinen Schlusstag", () => {
  const framed = frameUntrusted("web_search", "w".repeat(25_000))
  const out = capText("web_search", framed, () => {})
  assert.match(out, /^<untrusted_data_[^>]+>\n/)
  assert.match(out, /<\/untrusted_data_[^>]+>$/)
  assert.ok(out.length < TOOL_OUTPUT_CAP + 400)
})

test("capToolOutputs wirkt auf toModelOutput: Text, JSON ohne eigene Umwandlung, eigene Umwandlung", async () => {
  const saved: StoredOutput[] = []
  const tools: ToolSet = {
    big: tool({ description: "d", inputSchema: z.object({}), execute: async () => ({ rows: "z".repeat(40_000) }) }),
    small: tool({ description: "d", inputSchema: z.object({}), execute: async () => ({ ok: true }) }),
    custom: tool({
      description: "d",
      inputSchema: z.object({}),
      execute: async () => "x",
      toModelOutput: () => ({ type: "text", value: "c".repeat(30_000) }),
    }),
  }
  const capped = capToolOutputs(tools, (row) => saved.push(row))
  const run = (name: string, output: unknown) =>
    (capped[name] as unknown as { toModelOutput: (o: unknown) => Promise<{ type: string; value: unknown }> }).toModelOutput({ toolCallId: "t", input: {}, output })
  const big = await run("big", { rows: "z".repeat(40_000) })
  assert.equal(big.type, "text")
  assert.ok(String(big.value).length < TOOL_OUTPUT_CAP)
  assert.deepEqual(await run("small", { ok: true }), { type: "json", value: { ok: true } })
  const custom = await run("custom", "x")
  assert.ok(String(custom.value).length < TOOL_OUTPUT_CAP)
  assert.equal(saved.length, 2)
  assert.deepEqual(saved.map((row) => row.tool).sort(), ["big", "custom"])
})
