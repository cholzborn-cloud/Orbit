import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { afterEach, test } from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[cm]?js$|\.ts$/.test(specifier))
      return nextResolve(`${specifier}.ts`, context)
    return nextResolve(specifier, context)
  },
})
const { routeMessage, suggestHandoff } = await import("./route.ts")
const { resetJevPause } = await import("./client.ts")

const originalFetch = globalThis.fetch
const key = process.env.OPENROUTER_JEV_API_KEY

afterEach(() => {
  globalThis.fetch = originalFetch
  resetJevPause()
  if (key === undefined) delete process.env.OPENROUTER_JEV_API_KEY
  else process.env.OPENROUTER_JEV_API_KEY = key
})

function answer(choice: string, confidence = 0.9) {
  globalThis.fetch = (async () =>
    Response.json({
      answers: { tier: { choice, confidence }, target: { choice, confidence } },
    })) as typeof fetch
}

test("Jev-Fehler fällt auf medium zurück", async () => {
  process.env.OPENROUTER_JEV_API_KEY = "test"
  globalThis.fetch = (async () => {
    throw new Error("private response")
  }) as typeof fetch
  const error = await routeMessage({
    text: "Bitte erkläre ausführlich die Photosynthese.",
  })
  assert.equal(error.source, "fallback")
  assert.equal(error.tier, "medium")
})

test("Hallo wird klein geroutet, Coding wird erkannt und Unsicherheit fällt zurück", async () => {
  process.env.OPENROUTER_JEV_API_KEY = "test"
  answer("small")
  assert.equal((await routeMessage({ text: "Hallo" })).tier, "small")
  answer("coding")
  assert.equal(
    (await routeMessage({ text: "Debugge bitte diese TypeScript-Funktion." }))
      .tier,
    "coding"
  )
  globalThis.fetch = (async () =>
    Response.json({
      answers: { tier: { choice: "coding", confidence: 0.4 } },
    })) as typeof fetch
  const fallback = await routeMessage({
    text: "Analysiere bitte diese Aufgabe ausführlich.",
  })
  assert.equal(fallback.source, "fallback")
  assert.equal(fallback.tier, "medium")
})

test("Handoff verlangt 0,75 Sicherheit und ein anderes Orbi", async () => {
  process.env.OPENROUTER_JEV_API_KEY = "test"
  const orbis = [
    { id: "a", name: "Haupt", job: "Koordiniert", isMain: true },
    { id: "b", name: "Code", job: "Programmiert", isMain: false },
  ]
  answer("b", 0.74)
  assert.equal(
    await suggestHandoff({ text: "Implementiere API", orbis, currentId: "a" }),
    undefined
  )
  answer("b", 0.75)
  assert.deepEqual(
    await suggestHandoff({ text: "Implementiere API", orbis, currentId: "a" }),
    {
      targetId: "b",
      reason: "Dieser Orbi passt am besten zur Aufgabe.",
      confidence: 0.75,
    }
  )
})
