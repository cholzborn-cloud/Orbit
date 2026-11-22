import assert from "node:assert/strict"
import test from "node:test"
import { ReminderBridge } from "./reminders.ts"

test("Erinnerungsauftrag wird nur einmal abgeholt und nur mit gültiger Antwort abgeschlossen", async () => {
  const bridge = new ReminderBridge(1000)
  let events = 0
  bridge.onAvailable = () => events++
  const done = bridge.submit({ kind: "create", title: "Termin" })
  assert.equal(events, 1)
  const claim = bridge.claim()!
  assert.equal(claim.task.kind, "create")
  assert.equal(bridge.claim(), null)
  assert.equal(bridge.complete("fremd", { ok: true }), false)
  assert.equal(bridge.complete(claim.id, { ok: "ja" }), false)
  assert.equal(bridge.complete(claim.id, { ok: true }), true)
  assert.deepEqual(await done, { ok: true })
  assert.equal(bridge.complete(claim.id, { ok: true }), false)
})

test("Abbruch und Timeout wiederholen eine möglicherweise ausgeführte Erstellung nicht", async () => {
  const bridge = new ReminderBridge(20)
  const cancelled: string[] = []
  bridge.onCancel = (id) => cancelled.push(id)
  const controller = new AbortController()
  const before = bridge.submit({ kind: "list" }, controller.signal)
  controller.abort()
  assert.match((await before as { error: string }).error, /abgebrochen/)
  assert.equal(bridge.claim(), null)
  const after = bridge.submit({ kind: "create", title: "Test" })
  const claimed = bridge.claim()!
  assert.equal(bridge.isActive(claimed.id), true)
  assert.match((await after as { error: string }).error, /nicht bestätigt/)
  assert.deepEqual(cancelled, [claimed.id])
  assert.equal(bridge.isActive(claimed.id), false)
  assert.equal(bridge.claim(), null)
})

test("HTTP-Brücke verlangt das Diensttoken und akzeptiert jede Antwort nur einmal", async () => {
  const { createApp } = await import("./app.ts")
  const { registerReminderRoutes } = await import("./reminder-routes.ts")
  const bridge = new ReminderBridge(1000)
  const app = createApp({ token: "test", port: 4317, store: { ownsChat: async () => false, listMessages: async () => [], clearMessages: async () => {} }, runTurn: async () => new Response(), routes: (app) => registerReminderRoutes(app, bridge) })
  const done = bridge.submit({ kind: "list" })
  const request = (path: string, token: string, body?: unknown) => app.request(`http://127.0.0.1:4317${path}`, { method: "POST", headers: { host: "127.0.0.1:4317", authorization: `Bearer ${token}`, "content-type": "application/json" }, ...(body && { body: JSON.stringify(body) }) })
  assert.equal((await request("/v1/reminders/claim", "falsch")).status, 401)
  const claim = await (await request("/v1/reminders/claim", "test")).json() as { task: { id: string } }
  assert.ok(claim.task.id)
  assert.equal((await request(`/v1/reminders/${claim.task.id}/complete`, "test", { ok: true, items: [] })).status, 200)
  assert.equal((await request(`/v1/reminders/${claim.task.id}/complete`, "test", { ok: true })).status, 409)
  assert.deepEqual(await done, { ok: true, items: [] })

  const large = bridge.submit({ kind: "list" })
  const next = await (await request("/v1/reminders/claim", "test")).json() as { task: { id: string } }
  const items = Array.from({ length: 100 }, () => ({ title: "\u0001".repeat(500), list: "\u0001".repeat(200), due: null, completed: false }))
  assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, items })) > 128 * 1024)
  assert.equal((await request(`/v1/reminders/${next.task.id}/complete`, "test", { ok: true, items })).status, 200)
  assert.equal((await large as { items: unknown[] }).items.length, 100)
  assert.equal((await request(`/v1/reminders/${next.task.id}/complete`, "test", { ok: false, error: "x".repeat(512 * 1024) })).status, 413)
})
