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

const { DEFAULT_BASE_INSTRUCTIONS, normalizeBaseInstructions } =
  await import("./base-instructions.ts")
const { looksLikeSecret, resolveBaseInstructions } = await import("./memory.ts")

test("secrets are recognized, ordinary facts are not", () => {
  for (const bad of [
    "key sk-abcdefghijklmnopqrstuvwx",
    "ghp_abcdefghijklmnopqrstuvwxyz0123",
    "password: hunter2hunter2",
    "-----BEGIN RSA PRIVATE KEY-----",
    "Bearer abcdefghijklmnopqrstuvwxyz123456",
    "token = abcdef123456",
  ])
    assert.equal(looksLikeSecret(bad), true, bad)
  assert.equal(looksLikeSecret("Consti trinkt Tee."), false)
})

test("custom base instructions override the default; null uses the default", () => {
  assert.equal(
    resolveBaseInstructions("Custom", DEFAULT_BASE_INSTRUCTIONS),
    "Custom"
  )
  assert.equal(
    resolveBaseInstructions(null, DEFAULT_BASE_INSTRUCTIONS),
    DEFAULT_BASE_INSTRUCTIONS
  )
})

test("base instruction setting validates length and normalizes null and empty", () => {
  assert.deepEqual(normalizeBaseInstructions(null), { ok: true, value: null })
  assert.deepEqual(normalizeBaseInstructions(""), { ok: true, value: null })
  assert.deepEqual(normalizeBaseInstructions(DEFAULT_BASE_INSTRUCTIONS), {
    ok: true,
    value: null,
  })
  assert.equal(normalizeBaseInstructions("x".repeat(8_000)).ok, true)
  assert.deepEqual(normalizeBaseInstructions("x".repeat(8_001)), { ok: false })
})
