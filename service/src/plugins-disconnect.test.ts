import "./chat/fixtures/temp-data.ts"
import assert from "node:assert/strict"
import { test } from "node:test"
import { PluginStore } from "./plugins.ts"

const config = () => ({ key: "fixture-key", user: "fixture-user" })
const account = (id: string, user = "fixture-user", slug = "gmail") => ({ id, user_id: user, status: "ACTIVE", toolkit: { slug } })
const fixture = (items = [account("ca_one"), account("ca_two")], failId?: string) => {
  const calls: { url: URL; method: string }[] = []
  const store = new PluginStore(config, async (input, init) => {
    const url = new URL(String(input)); const method = init?.method ?? "GET"
    calls.push({ url, method })
    if (method === "DELETE") {
      if (url.pathname.endsWith(`/${failId}`)) return new Response("fixture-provider-secret", { status: 500 })
      return Response.json({ success: true })
    }
    return Response.json({ items })
  })
  return { store, calls }
}

test("disconnect account selection lists only own accounts of selected toolkit", async () => {
  const { store, calls } = fixture([account("ca_one"), account("ca_foreign", "other-user"), account("ca_calendar", "fixture-user", "googlecalendar")])
  const result = await store.connectionAccounts("gmail")
  assert.equal(result.ok, true)
  if (!result.ok) assert.fail("Own account list missing")
  assert.deepEqual(result.accounts.map(a => a.id), ["ca_one"])
  assert.equal(calls[0].url.searchParams.get("user_ids"), "fixture-user")
  assert.equal(calls[0].url.searchParams.get("toolkit_slugs"), "gmail")
  assert.equal(JSON.stringify(result).includes("fixture-key"), false)
})

test("disconnect requires explicit confirmation and a nonempty account selection", async () => {
  for (const body of [{ accountIds: ["ca_one"] }, { accountIds: ["ca_one"], confirmed: false }, { accountIds: [], confirmed: true }]) {
    const { store, calls } = fixture()
    assert.equal((await store.disconnect("gmail", body)).ok, false)
    assert.equal(calls.filter(c => c.method === "DELETE").length, 0)
  }
})

test("disconnect validates every selected account before deleting any", async () => {
  for (const id of ["ca_unknown", "ca_foreign", "ca_calendar"]) {
    const { store, calls } = fixture([account("ca_one"), account("ca_foreign", "other-user"), account("ca_calendar", "fixture-user", "googlecalendar")])
    assert.equal((await store.disconnect("gmail", { accountIds: ["ca_one", id], confirmed: true })).ok, false)
    assert.equal(calls.filter(c => c.method === "DELETE").length, 0)
  }
})

test("disconnect deletes only selected accounts through the documented DELETE endpoint", async () => {
  const { store, calls } = fixture()
  const result = await store.disconnect("gmail", { accountIds: ["ca_two"], confirmed: true })
  assert.equal(result.ok, true)
  if (!result.ok) assert.fail("Disconnect failed")
  assert.deepEqual(result.deletedIds, ["ca_two"])
  assert.deepEqual(result.failedIds, [])
  assert.deepEqual(calls.filter(c => c.method === "DELETE").map(c => c.url.pathname), ["/api/v3.1/connected_accounts/ca_two"])
  assert.match(result.notice, /Anbieter|Berechtigung/)
})

test("disconnect reports partial completion without leaking provider response or key", async () => {
  const { store } = fixture(undefined, "ca_two")
  const result = await store.disconnect("gmail", { accountIds: ["ca_one", "ca_two"], confirmed: true })
  assert.equal(result.ok, true)
  if (!result.ok) assert.fail("Partial completion must be preserved")
  assert.deepEqual(result.deletedIds, ["ca_one"])
  assert.deepEqual(result.failedIds, ["ca_two"])
  assert.equal(JSON.stringify(result).includes("fixture-provider-secret"), false)
  assert.equal(JSON.stringify(result).includes("fixture-key"), false)
})

test("disconnect reaches own accounts on subsequent pages before selection validation", async () => {
  const deleted: string[] = []
  const store = new PluginStore(config, async (input, init) => {
    const url = new URL(String(input))
    if (init?.method === "DELETE") { deleted.push(url.pathname); return Response.json({ success: true }) }
    return Response.json(url.searchParams.has("cursor") ? { items: [account("ca_later")] } : { items: [], next_cursor: "next" })
  })
  assert.equal((await store.disconnect("gmail", { accountIds: ["ca_later"], confirmed: true })).ok, true)
  assert.deepEqual(deleted, ["/api/v3.1/connected_accounts/ca_later"])
})
