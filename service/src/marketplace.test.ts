import assert from "node:assert/strict"
import { test } from "node:test"

import { call, configAccount, setupStatus, tokenAccount, type ProviderAdapter, type ProviderContext } from "@/lib/marketplace/provider"
import { testContext } from "@/lib/marketplace/test-helpers"

import { Marketplace } from "./marketplace"

// Attrappen-Adapter: ruft das Netz nur über call() und nur auf Aktion.
const fake = (ctx: ProviderContext): ProviderAdapter => {
  const def = {
    id: "fake",
    label: "Fake",
    route: "direct" as const,
    services: ["Test"],
    setup: [{ key: "clientId", label: "Client-ID", secret: false }],
    cost: "frei",
    note: "",
  }
  return {
    def,
    status: async () => ({
      id: "fake",
      ...(await setupStatus(ctx, def)),
      connected: await ctx.vault.has(tokenAccount("fake")),
    }),
    connectStart: async (trigger) => call(ctx, "fake", "start", trigger, async () => ({ url: "https://example.test/auth?state=fake.abc" })),
    connectFinish: async (params) => {
      if (params.get("code") !== "ok") throw new Error("Anmeldung abgebrochen.")
      await ctx.vault.set(tokenAccount("fake"), "token-geheim")
    },
    read: (trigger) =>
      call(ctx, "fake", "read", trigger, async () => {
        await ctx.fetchFn("https://example.test/me")
        return { ok: true as const, summary: "1 Eintrag" }
      }),
    disconnect: async () => ctx.vault.remove(tokenAccount("fake")),
  }
}

test("Anbieterliste löst keinen Netzaufruf und keinen Logeintrag aus", async () => {
  const { ctx, requests, log } = testContext(() => new Response("{}"))
  const market = new Marketplace(ctx, (c) => [fake(c)])
  const result = await market.list()
  assert.equal(result.providers[0]?.connected, false)
  assert.equal(result.providers[0]?.configured, false)
  assert.equal(requests.length, 0)
  assert.equal(log.length, 0)
})

test("Setup-Wert landet im Schlüsselbund und wird nie zurückgegeben", async () => {
  const { ctx, runner } = testContext(() => new Response("{}"))
  const market = new Marketplace(ctx, (c) => [fake(c)])
  const answer = await market.setConfig("fake", { key: "clientId", value: "client-geheim" })
  assert.deepEqual(answer, { ok: true })
  assert.equal(await ctx.vault.get(configAccount("fake", "clientId")), "client-geheim")
  assert.equal(JSON.stringify(await market.list()).includes("client-geheim"), false)
  assert.equal([...runner.entries.keys()].every((key) => key.includes("fake")), true)
  assert.equal((await market.setConfig("fake", { key: "unbekannt", value: "x" })).ok, false)
})

test("Verbinden, Rücksprung, Lesen: jeder Netzaufruf steht mit Auslöser im Log", async () => {
  const { ctx, log, requests } = testContext(() => new Response("{}"))
  const market = new Marketplace(ctx, (c) => [fake(c)])
  assert.equal((await market.connect("fake")).ok, true)
  assert.equal((await market.finish(new URLSearchParams({ state: "fake.abc", code: "ok" }))).ok, true)
  assert.equal((await market.list()).providers[0]?.connected, true)
  assert.deepEqual(await market.read("fake"), { ok: true, summary: "1 Eintrag" })
  assert.equal(requests.length, 1)
  assert.deepEqual(market.log.map((entry) => [entry.action, entry.trigger]), [["start", "user"], ["read", "user"]])
  assert.equal(JSON.stringify(market.log).includes("token-geheim"), false)
  assert.equal(log.length, 2)
})

test("unbekannter State und unbekannter Anbieter werden abgewiesen", async () => {
  const { ctx } = testContext(() => new Response("{}"))
  const market = new Marketplace(ctx, (c) => [fake(c)])
  assert.equal((await market.finish(new URLSearchParams({ state: "abc123", code: "ok" }))).ok, false)
  assert.equal((await market.connect("nope")).ok, false)
  assert.equal((await market.read("nope")).ok, false)
})

test("Trennen entfernt die Verbindung", async () => {
  const { ctx } = testContext(() => new Response("{}"))
  const market = new Marketplace(ctx, (c) => [fake(c)])
  await market.finish(new URLSearchParams({ state: "fake.abc", code: "ok" }))
  await market.disconnect("fake")
  assert.equal((await market.list()).providers[0]?.connected, false)
})
