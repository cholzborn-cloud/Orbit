import assert from "node:assert/strict"
import { test } from "node:test"

import { runHealth, type HealthDeps } from "./health.ts"

const SECRETS = { DAYTONA_API_KEY: "daytona-geheim-456", OPENROUTER_JEV_API_KEY: "jev-geheim-789" }
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
const deps = (over: Partial<HealthDeps> = {}): HealthDeps => ({
  env: { ...SECRETS },
  fetch: (async (url: string | URL | Request) =>
    String(url).includes("openrouter") ? json(200, { data: {} }) : json(200, { data: [{ id: "m" }] })) as typeof fetch,
  clis: async () => [
    { provider: "claude", state: "ok" },
    { provider: "codex", state: "ok" },
    { provider: "agy", state: "ok" },
    { provider: "gemini", state: "fehlt", fix: "Gemini-CLI fehlt: installiere sie mit „npm i -g @google/gemini-cli“ und melde dich beim ersten Start an." },
  ],
  daytonaPing: async () => {},
  brainPath: () => "/vault",
  brainReadable: () => true,
  pluginsConfigured: async () => true,
  timeoutMs: 200,
  ...over,
})
const state = (checks: Awaited<ReturnType<typeof runHealth>>) => Object.fromEntries(checks.map((c) => [c.id, c.state]))

test("alles in Ordnung: alle ok, nie ein Schlüsselwert in der Antwort", async () => {
  const checks = await runHealth(deps())
  assert.deepEqual(state(checks), { claude: "ok", codex: "ok", gemini: "fehlt", agy: "ok", daytona: "ok", jev: "ok", brain: "ok", plugins: "ok" })
  const text = JSON.stringify(checks)
  for (const value of Object.values(SECRETS)) assert.equal(text.includes(value), false)
})

test("ohne Schlüssel: fehlt mit einem Satz zur Abhilfe und dem Namen des Schlüssels, ohne Netzaufruf", async () => {
  let calls = 0
  const checks = await runHealth(
    deps({ env: {}, fetch: (async () => { calls++; return json(200, {}) }) as typeof fetch })
  )
  assert.deepEqual(state(checks), { claude: "ok", codex: "ok", gemini: "fehlt", agy: "ok", daytona: "fehlt", jev: "fehlt", brain: "ok", plugins: "ok" })
  assert.equal(calls, 0)
  for (const check of checks.filter((c) => c.state === "fehlt" && c.key)) assert.ok(check.fix && check.fix.length > 10)
  assert.equal(checks.find((c) => c.id === "jev")?.key, "OPENROUTER_JEV_API_KEY")
})

test("Jev 401 wird als ungültig gemeldet; Daytona-Fehler sind Fehler, ohne Werte", async () => {
  const checks = await runHealth(
    deps({
      fetch: (async (url: string | URL | Request) =>
        String(url).includes("openrouter") ? json(401, { error: "bad" }) : json(200, { data: [] })) as typeof fetch,
      daytonaPing: async () => {
        throw new Error(`401 mit ${SECRETS.DAYTONA_API_KEY}`)
      },
      brainPath: () => undefined,
    })
  )
  assert.deepEqual(state(checks), { claude: "ok", codex: "ok", gemini: "fehlt", agy: "ok", daytona: "fehler", jev: "fehler", brain: "fehlt", plugins: "ok" })
  assert.match(checks.find((c) => c.id === "jev")?.fix ?? "", /ungültig/)
  const text = JSON.stringify(checks)
  for (const value of Object.values(SECRETS)) assert.equal(text.includes(value), false)
  assert.doesNotMatch(text, /limit/i)
})

test("Zeitüberschreitungen werden zu Fehlern, nicht zu Hängern", async () => {
  const started = Date.now()
  const checks = await runHealth(
    deps({
      fetch: (() => new Promise(() => {})) as unknown as typeof fetch,
      daytonaPing: () => new Promise(() => {}),
      pluginsConfigured: async () => {
        throw new Error("x")
      },
    })
  )
  assert.ok(Date.now() - started < 2000)
  assert.deepEqual(state(checks), { claude: "ok", codex: "ok", gemini: "fehlt", agy: "ok", daytona: "fehler", jev: "fehler", brain: "ok", plugins: "fehler" })
})

test("CLI-Zustände: nicht angemeldet und nicht prüfbar werden gemeldet; Claude ist Pflicht, die anderen optional; kein Konto im Text", async () => {
  const checks = await runHealth(
    deps({
      clis: async () => [
        { provider: "claude", state: "fehler", fix: "Melde dich im Terminal mit „claude auth login“ an (Abo-Login)." },
        { provider: "codex", state: "ok" },
      ],
    })
  )
  const claude = checks.find((c) => c.id === "claude")!
  assert.equal(claude.state, "fehler")
  assert.equal(claude.optional, false)
  assert.match(claude.fix ?? "", /claude auth login/)
  assert.equal(checks.find((c) => c.id === "gemini")?.state, "fehler") // nicht in der Liste = nicht prüfbar
  assert.equal(checks.find((c) => c.id === "codex")?.optional, true)
  const broken = await runHealth(deps({ clis: async () => { throw new Error("x@y.de") } }))
  assert.equal(broken.find((c) => c.id === "claude")?.state, "fehler")
  assert.equal(JSON.stringify(broken).includes("x@y.de"), false)
})
