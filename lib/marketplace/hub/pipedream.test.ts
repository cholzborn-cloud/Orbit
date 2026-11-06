import assert from "node:assert/strict"
import { test } from "node:test"

import { json, testContext } from "../test-helpers.ts"
import { configAccount, pendingAccount, tokenAccount } from "../provider.ts"
import { pipedreamAdapter } from "./pipedream.ts"
import { hubAdapters } from "./index.ts"

const SECRET = "pd-client-secret-GEHEIM"
const PD_TOKEN = "pd-access-token-GEHEIM"

async function setup(handler: Parameters<typeof testContext>[0]) {
  const t = testContext(handler)
  const values = { clientId: "cid", clientSecret: SECRET, projectId: "proj_123", environment: "development" }
  for (const [k, v] of Object.entries(values)) await t.ctx.vault.set(configAccount("pipedream", k), v)
  return { ...t, adapter: pipedreamAdapter(t.ctx) }
}

const happy = (url: string, init?: RequestInit) => {
  if (url.endsWith("/oauth/token")) return json({ access_token: PD_TOKEN })
  if (url.endsWith("/tokens")) return json({ token: "ctok", connect_link_url: "https://pipedream.com/_static/connect.html?token=ctok" })
  if (url.includes("/accounts?")) return json({ data: [{ id: "apn_1" }, { id: "apn_2" }] })
  if (url.includes("/accounts/apn_1")) return json({ data: { id: "apn_1", app: { name: "Gmail" }, healthy: true, credentials: { oauth_access_token: "LEAK" } } })
  return json({}, 404)
}

test("Ablauf start, finish, read, disconnect", async () => {
  const { adapter, requests, log } = await setup(happy)
  const start = await adapter.connectStart("user")
  assert.ok(start.url.startsWith("https://pipedream.com/"))
  const tokenReq = requests[1]
  assert.equal(tokenReq.url, "https://api.pipedream.com/v1/connect/proj_123/tokens")
  assert.equal((tokenReq.init?.headers as Record<string, string>)["x-pd-environment"], "development")
  assert.deepEqual(JSON.parse(String(tokenReq.init?.body)), { external_user_id: "orbit-local" })
  await adapter.connectFinish(new URLSearchParams())
  assert.equal((await adapter.status()).connected, true)
  const read = await adapter.read("orbi")
  assert.deepEqual(read, { ok: true, summary: "Pipedream-Konto Gmail: in Ordnung." })
  assert.ok(!requests.at(-1)!.url.includes("credentials"))
  await adapter.disconnect()
  assert.equal((await adapter.status()).connected, false)
  assert.deepEqual(log.map((l) => l.action), ["connect.token", "accounts.list", "accounts.get"])
})

test("kein Netzaufruf ohne Auslöser", async () => {
  const { adapter, requests } = await setup(happy)
  await assert.rejects(() => adapter.connectStart(undefined as never))
  assert.equal(requests.length, 0)
})

test("Secrets erscheinen nie in Log, Summary oder Fehler; Account-Id ist alles, was gespeichert wird", async () => {
  const { adapter, ctx, log } = await setup(happy)
  await adapter.connectStart("user")
  await adapter.connectFinish(new URLSearchParams())
  const read = await adapter.read("user")
  const all = JSON.stringify([log, read])
  assert.ok(!all.includes(SECRET) && !all.includes(PD_TOKEN) && !all.includes("LEAK"))
  assert.equal(await ctx.vault.get(tokenAccount("pipedream")), "apn_1")
  const bad = await setup(() => json({ error: SECRET }, 500))
  await assert.rejects(() => bad.adapter.connectStart("user"), (e: Error) => !e.message.includes(SECRET) && e.message.includes("500"))
})

test("Fehlerantwort beim Lesen gibt ok:false", async () => {
  const { adapter, ctx } = await setup((url) => (url.endsWith("/oauth/token") ? json({ access_token: PD_TOKEN }) : json({}, 403)))
  await ctx.vault.set(tokenAccount("pipedream"), "apn_1")
  assert.equal((await adapter.read("user")).ok, false)
})

test("fehlgeschlagenes Finish lässt bestehende Verbindung und Zwischenstand", async () => {
  const { adapter, ctx } = await setup((url) => (url.endsWith("/oauth/token") ? json({ access_token: PD_TOKEN }) : json({ data: [] })))
  await ctx.vault.set(tokenAccount("pipedream"), "alt")
  await ctx.vault.set(pendingAccount("pipedream"), JSON.stringify({ startedAt: ctx.now() }))
  await assert.rejects(() => adapter.connectFinish(new URLSearchParams()))
  assert.equal(await ctx.vault.get(tokenAccount("pipedream")), "alt")
  assert.equal(await ctx.vault.has(pendingAccount("pipedream")), true)
})

test("ungültige Umgebung wird abgewiesen; hubAdapters liefert beide", async () => {
  const { adapter, ctx, requests } = await setup(happy)
  await ctx.vault.set(configAccount("pipedream", "environment"), "staging")
  await assert.rejects(() => adapter.connectStart("user"))
  assert.equal(requests.length, 0)
  assert.deepEqual(hubAdapters(ctx).map((a) => a.def.route), ["nango", "pipedream"])
})
