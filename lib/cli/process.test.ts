import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { streamText, tool, isStepCount } from "ai"
import { z } from "zod"

// Temp-Datenordner zuerst; echte Prozesse sind hier nur kleine Node-Skripte (keine CLI, kein Modellaufruf).
const data = mkdtempSync(join(tmpdir(), "orbit-cli-proc-"))
process.env.ORBIT_DATA_DIR = data

const { runProcess } = await import("./process.ts")
const { cliModel } = await import("./model.ts")
const { CliError } = await import("./types.ts")

const script = (body: string) => {
  const file = join(data, `s${Math.random().toString(36).slice(2)}.mjs`)
  writeFileSync(file, body)
  return file
}
const job = (file: string, stdin = "") => ({ command: process.execPath, args: [file], stdin, cwd: data, env: { PATH: process.env.PATH ?? "" } })
const collect = async (iter: AsyncIterable<string>) => {
  const out: string[] = []
  for await (const line of iter) out.push(line)
  return out
}

test("Prozess: Zeilen aus Stdout, Stdin kommt an, Fehlercode wird zum Fehler", async () => {
  const echo = script(`let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{console.log('a');console.log(JSON.stringify(s));})`)
  assert.deepEqual(await collect(runProcess(job(echo, "Hallo"), { timeoutMs: 5000 })), ["a", '"Hallo"'])
  const fail = script(`console.error('kaputt');process.exit(3)`)
  await assert.rejects(collect(runProcess(job(fail), { timeoutMs: 5000 })), (e: unknown) => e instanceof CliError && e.code === "failed")
})

test("Prozess: Abbruch und Leerlauf-Grenze beenden den Prozess", async () => {
  const hang = script(`console.log('x');setInterval(()=>{},1000)`)
  const controller = new AbortController()
  const started = Date.now()
  await assert.rejects(
    (async () => {
      for await (const line of runProcess(job(hang), { signal: controller.signal, timeoutMs: 60_000 })) if (line === "x") controller.abort()
    })(),
    (e: unknown) => e instanceof CliError && e.code === "aborted"
  )
  await assert.rejects(collect(runProcess(job(hang), { timeoutMs: 300 })), (e: unknown) => e instanceof CliError && e.code === "timeout")
  assert.ok(Date.now() - started < 8000)
})

test("streamText mit CLI-Modell: Werkzeugaufruf wird von Orbit ausgeführt, danach geht das Ergebnis zurück ans Modell", async () => {
  const prompts: string[] = []
  let n = 0
  const lines = (text: string) => [
    JSON.stringify({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text } } }),
    JSON.stringify({ type: "result", is_error: false, result: text, usage: { input_tokens: 3, output_tokens: 2 } }),
  ]
  const model = cliModel("claude-sonnet-5-5", {
    timeoutMs: 1000,
    runner: async function* (spawn) {
      prompts.push(spawn.stdin)
      for (const line of n++ === 0 ? lines(`Ich rechne. <orbit_tool_call>{"name":"add","input":{"a":2,"b":3}}</orbit_tool_call>`) : lines("Ergebnis ist 5.")) yield line
    },
  })
  let executed = 0
  const result = streamText({
    model,
    system: "S",
    prompt: "2+3?",
    tools: { add: tool({ description: "addiert", inputSchema: z.object({ a: z.number(), b: z.number() }), execute: async ({ a, b }) => (executed++, a + b) }) },
    stopWhen: isStepCount(5),
  })
  assert.equal(await result.text, "Ergebnis ist 5.")
  const steps = await result.steps
  assert.equal(steps.length, 2)
  assert.equal(steps[0]!.text, "Ich rechne. ")
  assert.equal(executed, 1)
  assert.equal(prompts.length, 2)
  assert.match(JSON.parse(prompts[1]!).message.content[0].text, /<orbit_tool_result name="add" id="[^"]+">5<\/orbit_tool_result>/)
  const usage = await result.totalUsage
  assert.equal(usage.inputTokens, 6)
})
