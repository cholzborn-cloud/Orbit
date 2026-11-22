import "./chat/fixtures/temp-data.ts"
import assert from "node:assert/strict"
import test from "node:test"
import { fileURLToPath } from "node:url"

process.env.ORBIT_CLAUDE_BIN = fileURLToPath(new URL("../../lib/usage/fixtures/claude-cli-mock.sh", import.meta.url))
process.env.ORBIT_CODEX_BIN = fileURLToPath(new URL("../../lib/usage/fixtures/codex-cli-mock.sh", import.meta.url))

const { createApp } = await import("./app.ts")
const { registerApiRoutes } = await import("./routes.ts")
const { statusDeps } = await import("@/lib/cli/status")
const { resetAvailability } = await import("@/lib/cli/provider")
const app = createApp({
  token: "test-token", port: 4319,
  store: { ownsChat: async () => true, listMessages: async () => [], clearMessages: async () => {} },
  runTurn: async () => new Response(null),
  routes: (hono) => registerApiRoutes(hono, { start: () => ({ runId: "test", done: Promise.resolve() }) }),
})

test("Modell-Endpunkt meldet Verfügbarkeit passend zum CLI-Zustand", async () => {
  const originalFind = statusDeps.find
  const originalExec = statusDeps.exec
  statusDeps.find = (provider) => provider === "claude" ? "/tmp/cli-attrappe" : undefined
  statusDeps.exec = async () => ({ code: 0, stdout: '{"loggedIn":true}', stderr: "" })
  resetAvailability()
  try {
    const response = await app.request("http://127.0.0.1:4319/v1/models", { headers: { host: "127.0.0.1:4319", authorization: "Bearer test-token" } })
    const body = await response.json() as { modelsAvailable: boolean; models: { id: string }[] }
    assert.equal(body.modelsAvailable, true)
    assert.ok(body.models.length > 0 && body.models.every((model) => model.id.startsWith("claude-")))
  } finally {
    statusDeps.find = originalFind
    statusDeps.exec = originalExec
    resetAvailability()
  }
})

test("Nutzungs-Endpunkt liefert beide CLI-Anzeigen ohne externe Dienste", async () => {
  const response = await app.request("http://127.0.0.1:4319/v1/usage?fresh=1", { headers: { host: "127.0.0.1:4319", authorization: "Bearer test-token" } })
  assert.equal(response.status, 200)
  const body = await response.json() as { ok: boolean; providers: { provider: string; status: string; accounts: { windows: { name: string; used: number }[] }[] }[] }
  assert.equal(body.ok, true)
  for (const id of ["claude", "codex"]) {
    const provider = body.providers.find((item) => item.provider === id)!
    assert.equal(provider.status, "ok")
    assert.deepEqual(provider.accounts[0]!.windows.map(({ name, used }) => [name, used]), [["5h", 0.2], ["7d", 0.4]])
  }
  assert.equal(body.providers.find((item) => item.provider === "antigravity")?.status, "error")
})
