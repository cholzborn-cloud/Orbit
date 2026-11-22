import assert from "node:assert/strict"
import { registerHooks } from "node:module"
import { test } from "node:test"

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith(".") && !/\.[cm]?js$|\.ts$/.test(specifier))
      return nextResolve(`${specifier}.ts`, context)
    return nextResolve(specifier, context)
  },
})
const { CHAT_MODELS } = await import("../chat-catalog.ts")
const { getTierModel } = await import("./tiers.ts")

test("jede Stufe nutzt ein vorhandenes Modell und unterstütztes Effort", () => {
  for (const tier of ["small", "medium", "large", "coding"] as const) {
    const selected = getTierModel(tier)
    const model = CHAT_MODELS.find(({ id }) => id === selected.model)
    assert.ok(model, `${tier} Modell existiert in CHAT_MODELS`)
    if (selected.effort)
      assert.ok(model.efforts.includes(selected.effort as never))
  }
})

test("Effort entfällt bei einem Modell ohne Effort-Unterstützung", () => {
  const model = CHAT_MODELS.find(({ id }) => id === "gemini-3.8-flash-high")!
  assert.deepEqual(model.efforts, [])
})
