import assert from "node:assert/strict"
import { test } from "node:test"

import { json, testContext } from "../test-helpers.ts"
import { configAccount, pendingAccount, tokenAccount } from "../provider.ts"
import { microsoftAdapter } from "./microsoft.ts"

const ID = "microsoft"
const SECRET = "geheim-token-12345"
const REFRESH = "geheim-refresh-67890"
const CLIENT_SECRET = "client-geheimnis-abc"

const tokenOk = () => json({ access_token: SECRET, refresh_token: REFRESH, expires_in: 3600 })

async function setup(handler: Parameters<typeof testContext>[0]) {
  const t = testContext(handler)
  await t.ctx.vault.set(configAccount(ID, "clientId"), "cid")
  await t.ctx.vault.set(configAccount(ID, "clientSecret"), CLIENT_SECRET)
  return { ...t, adapter: microsoftAdapter(t.ctx) }
}

const stateOf = (url: string) => new URL(url).searchParams.get("state")!
const callback = (state: string) => new URLSearchParams({ code: "abc", state })

test("def: direkter Weg mit Setup und ehrlichem Hinweis", () => {
  const { def } = microsoftAdapter(testContext(() => json({})).ctx)
  assert.equal(def.route, "direct")
  assert.equal(def.id, ID)
  assert.ok(def.setup.some((s) => s.key === "clientId"))
  assert.ok(def.cost.length > 10 && def.note.length > 10)
})

test("status: ohne Setup nicht konfiguriert, mit Token verbunden, kein Netz", async () => {
  const t = testContext(() => json({}))
  const adapter = microsoftAdapter(t.ctx)
  const leer = await adapter.status()
  assert.equal(leer.configured, false)
  assert.equal(leer.connected, false)
  await t.ctx.vault.set(configAccount(ID, "clientId"), "cid")
  await t.ctx.vault.set(tokenAccount(ID), JSON.stringify({ access: "x" }))
  const voll = await adapter.status()
  assert.equal(voll.connected, true)
  assert.equal(t.requests.length, 0)
})

test("Start legt nur pending an und lässt bestehendes Token unberührt", async () => {
  const { ctx, adapter, requests } = await setup(() => json({}))
  await ctx.vault.set(tokenAccount(ID), "altes-token")
  const { url } = await adapter.connectStart("user")
  assert.ok(url.startsWith("https://"))
  assert.equal(await ctx.vault.get(tokenAccount(ID)), "altes-token")
  assert.equal(await ctx.vault.has(pendingAccount(ID)), true)
  assert.equal(requests.length, 0)
})

test("Finish mit falschem State ändert nichts", async () => {
  const { ctx, adapter, requests } = await setup(tokenOk)
  await adapter.connectStart("user")
  await assert.rejects(adapter.connectFinish(callback("falsch")))
  assert.equal(await ctx.vault.has(tokenAccount(ID)), false)
  assert.equal(await ctx.vault.has(pendingAccount(ID)), true)
  assert.equal(requests.length, 0)
})

test("Finish nach Ablauf ändert nichts", async () => {
  const { ctx, adapter, advance } = await setup(tokenOk)
  const { url } = await adapter.connectStart("user")
  advance(11 * 60_000)
  await assert.rejects(adapter.connectFinish(callback(stateOf(url))), /abgelaufen/)
  assert.equal(await ctx.vault.has(tokenAccount(ID)), false)
  assert.equal(await ctx.vault.has(pendingAccount(ID)), true)
})

test("Finish mit fehlgeschlagenem Austausch ändert nichts", async () => {
  const { ctx, adapter } = await setup(() => json({ error: "bad" }, 400))
  await ctx.vault.set(tokenAccount(ID), "altes-token")
  const { url } = await adapter.connectStart("user")
  await assert.rejects(adapter.connectFinish(callback(stateOf(url))))
  assert.equal(await ctx.vault.get(tokenAccount(ID)), "altes-token")
  assert.equal(await ctx.vault.has(pendingAccount(ID)), true)
})

test("Finish gut: Token gesetzt, pending weg", async () => {
  const { ctx, adapter } = await setup(tokenOk)
  const { url } = await adapter.connectStart("user")
  await adapter.connectFinish(callback(stateOf(url)))
  assert.equal(JSON.parse((await ctx.vault.get(tokenAccount(ID)))!).access, SECRET)
  assert.equal(await ctx.vault.has(pendingAccount(ID)), false)
  assert.equal((await adapter.status()).connected, true)
})

test("read ohne Auslöser wirft und ruft nichts auf", async () => {
  const { adapter, requests } = await setup(() => json({}))
  await assert.rejects(adapter.read(undefined as never))
  assert.equal(requests.length, 0)
})

test("read: genau ein Aufruf mit Bearer, loggt Auslöser, Summary ohne Geheimnisse", async () => {
  const { ctx, adapter, log, requests } = await setup(() => json({ totalItemCount: 7 }))
  await ctx.vault.set(tokenAccount(ID), JSON.stringify({ access: SECRET, refresh: REFRESH }))
  const result = await adapter.read("orbi")
  assert.equal(result.ok, true)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].url, "https://graph.microsoft.com/v1.0/me/mailFolders/inbox?$select=totalItemCount")
  assert.equal((requests[0].init?.headers as Record<string, string>).authorization, `Bearer ${SECRET}`)
  assert.equal(log.length, 1)
  assert.equal(log[0].trigger, "orbi")
  assert.equal(log[0].provider, ID)
  const alles = JSON.stringify([log, result])
  for (const geheim of [SECRET, REFRESH, CLIENT_SECRET]) assert.equal(alles.includes(geheim), false)
})

test("read: HTTP-Fehler und fehlende Verbindung liefern ok:false", async () => {
  const { ctx, adapter } = await setup(() => json({}, 401))
  assert.deepEqual(await adapter.read("user"), { ok: false, error: "Nicht verbunden." })
  await ctx.vault.set(tokenAccount(ID), JSON.stringify({ access: SECRET }))
  const result = await adapter.read("user")
  assert.equal(result.ok, false)
  assert.equal(JSON.stringify(result).includes(SECRET), false)
})

test("disconnect entfernt Token und pending", async () => {
  const { ctx, adapter } = await setup(() => json({}))
  await ctx.vault.set(tokenAccount(ID), "t")
  await adapter.connectStart("user")
  await adapter.disconnect()
  assert.equal(await ctx.vault.has(tokenAccount(ID)), false)
  assert.equal(await ctx.vault.has(pendingAccount(ID)), false)
})
