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
const { decide, resetJevPause } = await import("./client.ts")

const originalKey = process.env.OPENROUTER_JEV_API_KEY
const originalFetch = globalThis.fetch

afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENROUTER_JEV_API_KEY
  else process.env.OPENROUTER_JEV_API_KEY = originalKey
  globalThis.fetch = originalFetch
  resetJevPause()
})

test("ohne Schlüssel wird ein Fehlerwert geliefert", async () => {
  delete process.env.OPENROUTER_JEV_API_KEY
  assert.deepEqual(await decide({}, "x"), {
    ok: false,
    error: "Jev-Schlüssel fehlt.",
  })
})

test("Timeout wird sicher als Fehlerwert gemeldet", async () => {
  process.env.OPENROUTER_JEV_API_KEY = "test-key"
  globalThis.fetch = ((_url, init) =>
    new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(new DOMException("secret", "AbortError"))
      )
    })) as typeof fetch
  assert.deepEqual(await decide({}, "private", { timeoutMs: 1 }), {
    ok: false,
    error: "Jev-Anfrage abgelaufen.",
  })
})

test("HTTP-Fehler enthält weder Schlüssel noch Antworttext", async () => {
  process.env.OPENROUTER_JEV_API_KEY = "test-key"
  globalThis.fetch = (async () =>
    new Response("sensitive response", { status: 401 })) as typeof fetch
  assert.deepEqual(await decide({}, "private"), {
    ok: false,
    error: "Jev-Anfrage fehlgeschlagen (401).",
  })
  let calls = 0
  globalThis.fetch = (async () => {
    calls++
    return Response.json({ answers: {} })
  }) as typeof fetch
  assert.deepEqual(await decide({}, "private"), {
    ok: false,
    error: "Jev ist vorübergehend pausiert.",
  })
  assert.equal(calls, 0)
})
