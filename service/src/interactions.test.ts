import assert from "node:assert/strict"
import test from "node:test"

import { InteractionManager, type InteractionRequest } from "./interactions.ts"

const input: InteractionRequest = {
  id: "request",
  kind: "approval",
  chatId: "chat",
  botId: "bot",
  toolCallId: "call",
  tool: "write",
  input: { path: "file" },
}
function setup(saveRule?: () => Promise<void>) {
  let now = 1000
  let timer: (() => void) | undefined
  const rows = new Map<string, number>()
  const events: string[] = []
  const manager = new InteractionManager({
    store: {
      create: async (request) => {
        assert.equal(request.userId, "local")
        rows.set(request.toolCallId, now)
        return now
      },
      get: async (id, user) => {
        assert.equal(user, "local")
        return rows.get(id) ?? null
      },
    },
    saveRule,
    now: () => now,
    setTimer: (callback) => {
      timer = callback
      return () => {
        timer = undefined
      }
    },
    onChange: (_request, decision) =>
      events.push(decision?.status ?? "pending"),
  })
  return {
    manager,
    rows,
    events,
    advance: (ms: number) => {
      now += ms
    },
    timeout: () => timer?.(),
  }
}
async function pending(
  manager: InteractionManager,
  request = input,
  signal = new AbortController().signal
) {
  let notify!: () => void
  const ready = new Promise<void>((resolve) => {
    notify = resolve
  })
  const result = manager.wait(request, signal, async () => {
    notify()
  })
  await ready
  return { result }
}

test("Freigabe persistiert Zeitpunkt, unterscheidet ungültig und schon entschieden", async () => {
  const { manager, events } = setup()
  const { result } = await pending(manager)
  assert.equal(manager.list()[0].requestedAt, 1000)
  assert.equal(manager.list()[0].expiresAt, 1000 + 24 * 60 * 60_000)
  assert.deepEqual(await manager.decide("request", { approved: "yes" }), {
    ok: false,
    error: "invalid",
  })
  assert.deepEqual(await manager.decide("request", { approved: true }), {
    ok: true,
  })
  assert.deepEqual(await result, { status: "approved" })
  assert.deepEqual(await manager.decide("request", { approved: false }), {
    ok: false,
    error: "already_decided",
  })
  assert.deepEqual(await manager.decide("missing", { approved: true }), {
    ok: false,
    error: "not_found",
  })
  assert.deepEqual(events, ["pending", "approved"])
})

test("Immer wartet auf gespeicherte Regel; Speicherfehler gibt das Tool nicht frei", async () => {
  let persist!: () => void
  let saved = false
  const savedRule = new Promise<void>((resolve) => {
    persist = () => {
      saved = true
      resolve()
    }
  })
  const { manager } = setup(() => savedRule)
  const { result } = await pending(manager)
  const deciding = manager.decide("request", { approved: true, always: true })
  await Promise.resolve()
  assert.equal(manager.list().length, 1)
  assert.equal(saved, false)
  persist()
  assert.deepEqual(await deciding, { ok: true })
  // always geht mit, damit „Immer“ noch im selben Turn wirkt.
  assert.deepEqual(await result, { status: "approved", always: true })

  const failing = setup(async () => {
    throw new Error("secret")
  }).manager
  const waiting = await pending(failing)
  assert.deepEqual(
    await failing.decide("request", { approved: true, always: true }),
    { ok: false, error: "storage" }
  )
  assert.equal(failing.list().length, 1)
  await failing.decide("request", { approved: false })
  assert.deepEqual(await waiting.result, { status: "denied" })
})

test("Nach 15 Minuten gilt Einmal noch; Ablauf erst nach 24 Stunden, ohne echte Wartezeit", async () => {
  const waiting = setup()
  const first = await pending(waiting.manager)
  waiting.advance(15 * 60_000)
  assert.deepEqual(await waiting.manager.decide("request", { approved: true }), { ok: true })
  assert.deepEqual(await first.result, { status: "approved" })

  const { manager, advance } = setup()
  const { result } = await pending(manager)
  advance(24 * 60 * 60_000 - 1)
  assert.equal(manager.list().length, 1)
  advance(1)
  assert.deepEqual(await manager.decide("request", { approved: true }), {
    ok: false,
    error: "expired",
  })
  assert.deepEqual(await result, { status: "expired" })
  assert.deepEqual(manager.list(), [])
})

test("Stopp beendet wartende Entscheidung und sogar hängendes Erstellen", async () => {
  const { manager } = setup()
  const abort = new AbortController()
  const { result } = await pending(manager, input, abort.signal)
  abort.abort()
  assert.deepEqual(await result, { status: "aborted" })
  assert.deepEqual(manager.list(), [])
  const hanging = new InteractionManager({
    store: { create: () => new Promise(() => {}), get: async () => null },
  })
  const beforeCreate = new AbortController()
  const creating = hanging.wait(input, beforeCreate.signal)
  beforeCreate.abort()
  assert.deepEqual(await creating, { status: "aborted" })
})

test("Rückfragen akzeptieren passende Antworten und blockieren falsche Formate", async () => {
  const { manager } = setup()
  const request: InteractionRequest = {
    ...input,
    id: undefined,
    kind: "ask",
    input: {
      questions: [
        {
          question: "Welche?",
          options: [{ label: "A" }, { label: "B" }, { label: "C" }],
        },
      ],
    },
  }
  const { result } = await pending(manager, request)
  assert.equal(manager.list()[0].id, "call")
  assert.deepEqual(
    await manager.decide("call", {
      answer: { answers: [{ question: "Falsch", answers: ["A"] }] },
    }),
    { ok: false, error: "invalid" }
  )
  const answer = {
    answers: [{ question: "Welche?", answers: ["Eigene Antwort"] }],
  }
  assert.deepEqual(await manager.decide("call", { answer }), { ok: true })
  assert.deepEqual(await result, { status: "answered", answer })
})


test("Immer für dauerhaft wird gespeichert, für Geheimnisse nicht", async () => {
  for (const reason of ["dauerhaft", "geheimnis"] as const) {
    let saved = 0
    const { manager } = setup(async () => { saved++ })
    const { result } = await pending(manager, { ...input, reason })
    assert.deepEqual(await manager.decide("request", { approved: true, always: true }), { ok: true })
    assert.equal((await result).status, "approved")
    assert.equal(saved, reason === "dauerhaft" ? 1 : 0)
  }
})
