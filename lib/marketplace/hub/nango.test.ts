import assert from "node:assert/strict"
import { test } from "node:test"

import { json, testContext } from "../test-helpers.ts"
import { configAccount, pendingAccount, tokenAccount } from "../provider.ts"
import { nangoAdapter } from "./nango.ts"

const SECRET = "nango-secret-GEHEIM-123"

async function setup(handler: Parameters<typeof testContext>[0]) {
  const t = testContext(handler)
  await t.ctx.vault.set(configAccount("nango", "secretKey"), SECRET)
  await t.ctx.vault.set(configAccount("nango", "integrationId"), "google-mail")
  return { ...t, adapter: nangoAdapter(t.ctx) }
}

const happy = (url: string, init?: RequestInit) => {
  if (url.endsWith("/connect/sessions") && init?.method === "POST") return json({ data: { connect_link: "https://connect.nango.dev/x" } })
  if (url.includes("/connection?")) return json({ connections: [{ connection_id: "conn-1", provider_config_key: "google-mail" }] })
  if (url.includes("/connection/conn-1")) return json({ provider: "google-mail", credentials: { access_token: "LEAK-TOKEN" }, errors: [] })
  return json({}, 404)
}

test("Ablauf start, finish, read, disconnect", async () => {
  const { adapter, requests, log } = await setup(happy)
  const start = await adapter.connectStart("user")
  assert.equal(start.url, "https://connect.nango.dev/x")
  assert.equal(requests[0].url, "https://api.nango.dev/connect/sessions")
  assert.equal((requests[0].init?.headers as Record<string, string>).authorization, `Bearer ${SECRET}`)
  assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { end_user: { id: "orbit-local" }, allowed_integrations: ["google-mail"] })
  assert.equal((await adapter.status()).connected, false)
  await adapter.connectFinish(new URLSearchParams())
  assert.equal((await adapter.status()).connected, true)
  const read = await adapter.read("orbi")
  assert.deepEqual(read, { ok: true, summary: "Nango-Verbindung zu google-mail: in Ordnung." })
  assert.ok(requests.at(-1)!.url.includes("provider_config_key=google-mail"))
  await adapter.disconnect()
  assert.equal((await adapter.status()).connected, false)
  assert.deepEqual(log.map((l) => l.action), ["connect.session", "connection.list", "connection.get"])
})

test("kein Netzaufruf ohne Auslöser", async () => {
  const { adapter, requests } = await setup(happy)
  await assert.rejects(() => adapter.connectStart(undefined as never))
  assert.deepEqual(await adapter.read(undefined as never), { ok: false, error: "Nicht verbunden." })
  assert.equal(requests.length, 0)
})

test("Secrets und Credentials erscheinen nie in Log, Summary oder Fehler", async () => {
  const { adapter, ctx, log } = await setup(happy)
  await adapter.connectStart("user")
  await adapter.connectFinish(new URLSearchParams())
  const read = await adapter.read("user")
  assert.ok(!JSON.stringify([log, read]).includes(SECRET))
  assert.ok(!JSON.stringify(read).includes("LEAK-TOKEN"))
  assert.equal(await ctx.vault.get(tokenAccount("nango")), "conn-1")
  const bad = await setup(() => json({ error: SECRET }, 500))
  await assert.rejects(() => bad.adapter.connectStart("user"), (e: Error) => !e.message.includes(SECRET) && e.message.includes("500"))
})

test("Fehlerantwort beim Lesen gibt ok:false", async () => {
  const { adapter, ctx } = await setup(() => json({ error: "x" }, 401))
  await ctx.vault.set(tokenAccount("nango"), "conn-1")
  const read = await adapter.read("user")
  assert.equal(read.ok, false)
})

test("fehlgeschlagenes Finish lässt bestehende Verbindung und Zwischenstand", async () => {
  const { adapter, ctx } = await setup(() => json({ connections: [] }))
  await ctx.vault.set(tokenAccount("nango"), "alt")
  await ctx.vault.set(pendingAccount("nango"), JSON.stringify({ startedAt: ctx.now() }))
  await assert.rejects(() => adapter.connectFinish(new URLSearchParams()))
  assert.equal(await ctx.vault.get(tokenAccount("nango")), "alt")
  assert.equal(await ctx.vault.has(pendingAccount("nango")), true)
})

test("Finish ohne Start wird abgewiesen", async () => {
  const { adapter, requests } = await setup(happy)
  await assert.rejects(() => adapter.connectFinish(new URLSearchParams()))
  assert.equal(requests.length, 0)
})
