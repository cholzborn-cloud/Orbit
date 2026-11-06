import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { test } from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (
      !context.parentURL?.includes("/node_modules/") &&
      specifier.startsWith(".") &&
      !/\.[cm]?js$|\.ts$/.test(specifier)
    )
      return nextResolve(`${specifier}.ts`, context)
    return nextResolve(specifier, context)
  },
})

const { afterTurnIfDue, buildAfterTurnQuestions, runAfterTurn } =
  await import("./after-turn.ts")

test("After-Turn fragt nur, ob Nutzernachricht merkenswert ist", () => {
  const questions = buildAfterTurnQuestions()
  assert.match(questions.memorable.instructions, /dauerhafte Vorgabe/)
})

test("After-Turn sendet nur gekürzten Nutzertest und protokolliert Merkenswertes", async () => {
  const logged: unknown[] = []
  let input = ""
  const loggedMemory = await runAfterTurn(
    {
      userId: "u",
      chatId: "c",
      text: "x".repeat(5000),
    },
    async (_questions, state) => {
      input = state.text as string
      return {
        ok: true,
        answers: { memorable: { noul: 0.8 } },
        durationMs: 1,
      }
    },
    (entry) => logged.push(entry)
  )
  assert.equal(loggedMemory, true)
  assert.equal(input.length, 2000)
  assert.equal(logged.length, 1)
  assert.equal((logged[0] as { info: { kind: string } }).info.kind, "memory")
  assert.equal("payload" in (logged[0] as object), false)
  const beforeThreshold: unknown[] = []
  assert.equal(
    await runAfterTurn(
      { userId: "u", chatId: "c", text: "Nur diese Nachricht." },
      async () => ({
        ok: true,
        answers: { memorable: { noul: 0.64 } },
        durationMs: 1,
      }),
      (entry) => beforeThreshold.push(entry)
    ),
    false
  )
  assert.equal(beforeThreshold.length, 0)
})

test("After-Turn läuft nur bei Auto-Modell, Auto an, Nutzertext, ohne Übergabe, mit Schlüssel", async () => {
  process.env.OPENROUTER_JEV_API_KEY = "test"
  const base = {
    userId: "u",
    chatId: "c",
    model: "auto",
    auto: true,
    text: "Merk dir: ich trinke Tee.",
  }
  let asked = 0
  const ask = async () => {
    asked++
    return {
      ok: true as const,
      answers: { memorable: { noul: 0.9 } },
      durationMs: 1,
    }
  }
  const log: unknown[] = []
  const run = (change: object) =>
    afterTurnIfDue({ ...base, ...change }, ask, (entry) => log.push(entry))
  assert.equal(await run({}), true)
  for (const change of [
    { model: "claude-haiku-5-5" },
    { handoffId: "h" },
    { auto: false },
    { text: "" },
  ])
    assert.equal(await run(change), false)
  delete process.env.OPENROUTER_JEV_API_KEY
  assert.equal(await run({}), false)
  assert.equal(asked, 1)
  assert.equal(log.length, 1)
})
