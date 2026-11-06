import assert from "node:assert/strict"
import test from "node:test"

import {
  InteractionManager,
  type InteractionDecision,
  type InteractionRequest,
  type PendingInteraction,
} from "./interactions.ts"

const input: InteractionRequest = {
  id: "request",
  kind: "approval",
  chatId: "chat",
  botId: "bot",
  toolCallId: "call-1",
  tool: "write",
  input: { path: "file" },
}

// Zwei „Läufe“ von orbitd teilen sich Datenbank (rows) und Speicher der offenen Freigaben (saved).
function world() {
  let now = 1000
  const rows = new Map<string, number>()
  const saved = new Map<string, { request: PendingInteraction; decision?: InteractionDecision }>()
  const rules: string[] = []
  const boot = () => {
    const events: string[] = []
    const manager = new InteractionManager({
      store: {
        create: async (request) => {
          rows.set(request.toolCallId, now)
          return now
        },
        get: async (id) => rows.get(id) ?? null,
      },
      saveRule: async (request) => void rules.push(request.tool),
      now: () => now,
      setTimer: () => () => {},
      persist: {
        save: (request, decision) => void saved.set(request.id, { request: structuredClone(request), decision }),
        remove: (id) => void saved.delete(id),
      },
      onChange: (request, decision) => events.push(`${request.restored ? "restored:" : ""}${decision?.status ?? "pending"}`),
    })
    return { manager, events }
  }
  return { boot, saved, rules, rows, advance: (ms: number) => (now += ms) }
}

async function openRequest(manager: InteractionManager, request = input) {
  let notify!: () => void
  const ready = new Promise<void>((resolve) => (notify = resolve))
  const controller = new AbortController()
  const decision = manager.wait(request, controller.signal, async () => notify())
  await ready
  return { decision, controller }
}

test("Eine offene Freigabe wird gespeichert und nach dem Beenden wieder entfernt", async () => {
  const w = world()
  const { manager } = w.boot()
  const { decision } = await openRequest(manager)
  assert.equal(w.saved.size, 1)
  assert.equal(w.saved.get("request")?.request.tool, "write")
  assert.deepEqual(await manager.decide("request", { approved: false }), { ok: true })
  assert.deepEqual(await decision, { status: "denied" })
  assert.equal(w.saved.size, 0)
})

test("Neustart: die Karte ist danach noch da (als wiederhergestellt), der alte Turn bekommt keine Antwort mehr", async () => {
  const w = world()
  const first = w.boot()
  void openRequest(first.manager)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(w.saved.size, 1)
  // orbitd startet neu: neuer Manager, Karten aus dem Speicher zurück.
  const second = w.boot()
  second.manager.restore([...w.saved.values()])
  const list = second.manager.list()
  assert.equal(list.length, 1)
  assert.equal(list[0]?.id, "request")
  assert.equal(list[0]?.restored, true)
  // Ablehnen räumt sie ab; nichts bleibt gespeichert.
  assert.deepEqual(await second.manager.decide("request", { approved: false }), { ok: true })
  assert.equal(second.manager.list().length, 0)
  assert.equal(w.saved.size, 0)
  assert.deepEqual(second.events, ["restored:denied"])
})

test("Zustimmung zu einer wiederhergestellten Karte gilt einmal für die gleiche Anfrage im fortgesetzten Turn, auch nach einem zweiten Neustart", async () => {
  const w = world()
  const first = w.boot()
  void openRequest(first.manager)
  await new Promise((resolve) => setImmediate(resolve))
  const second = w.boot()
  second.manager.restore([...w.saved.values()])
  assert.deepEqual(await second.manager.decide("request", { approved: true }), { ok: true })
  assert.equal(second.manager.list().length, 0)
  assert.equal(w.saved.get("request")?.decision?.status, "approved")
  // zweiter Neustart: die Entscheidung bleibt erhalten und wartet auf den fortgesetzten Turn
  const third = w.boot()
  third.manager.restore([...w.saved.values()])
  assert.equal(third.manager.list().length, 0)
  // andere Eingabe: nicht übernommen, es wird neu gefragt
  const other = await openRequest(third.manager, { ...input, id: "other", toolCallId: "call-2", input: { path: "anderes" } })
  assert.equal(third.manager.list().length, 1)
  other.controller.abort()
  assert.deepEqual(await other.decision, { status: "aborted" })
  // gleiche Anfrage mit neuer Aufruf-Id: sofort bewilligt, ohne neue Karte, und nur einmal
  const same = await third.manager.wait({ ...input, id: "again", toolCallId: "call-3" }, new AbortController().signal, async () => assert.fail("keine neue Karte"))
  assert.deepEqual(same, { status: "approved" })
  assert.equal(w.saved.has("request"), false)
  const again = await openRequest(third.manager, { ...input, id: "once-more", toolCallId: "call-4" })
  assert.equal(third.manager.list().length, 1)
  again.controller.abort()
  await again.decision
})

test("„Immer erlauben“ bei einer wiederhergestellten Karte speichert die Regel", async () => {
  const w = world()
  const first = w.boot()
  void openRequest(first.manager)
  await new Promise((resolve) => setImmediate(resolve))
  const second = w.boot()
  second.manager.restore([...w.saved.values()])
  assert.deepEqual(await second.manager.decide("request", { approved: true, always: true }), { ok: true })
  assert.deepEqual(w.rules, ["write"])
})

test("Abgelaufene Karten werden beim Wiederherstellen verworfen und aus dem Speicher gelöscht", async () => {
  const w = world()
  const first = w.boot()
  void openRequest(first.manager)
  await new Promise((resolve) => setImmediate(resolve))
  w.advance(24 * 60 * 60_000 + 1)
  const second = w.boot()
  second.manager.restore([...w.saved.values()])
  assert.equal(second.manager.list().length, 0)
  assert.equal(w.saved.size, 0)
})
