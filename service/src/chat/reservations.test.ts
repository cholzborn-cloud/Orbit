import assert from "node:assert/strict"
import test from "node:test"

import type { OrbiLine } from "../../../lib/chat/orbi-message"
import { createApp } from "../app"
import { createDispatcher } from "./dispatcher"
import { ChatReservations } from "./reservations"

test("Root reserviert vor asynchroner Vorbereitung; ein zweiter Turn im selben Chat wird abgewiesen", async () => {
  const reservations = new ChatReservations()
  let enter!: () => void
  const entered = new Promise<void>((resolve) => {
    enter = resolve
  })
  let finish!: () => void
  const prepared = new Promise<void>((resolve) => {
    finish = resolve
  })
  const app = createApp({
    token: "test",
    port: 4317,
    reserveTurn: (id) => reservations.reserve(id),
    store: {
      ownsChat: async () => true,
      listMessages: async () => [],
      clearMessages: async () => {},
    },
    runTurn: async () => {
      assert(reservations.queue.has("target"))
      enter()
      await prepared
      return new Response("data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      })
    },
  })
  const send = () =>
    app.request("http://127.0.0.1:4317/v1/chats/target/turn", {
      method: "POST",
      headers: {
        host: "127.0.0.1:4317",
        authorization: "Bearer test",
        "content-type": "application/json",
      },
      body: "{}",
    })
  const first = send()
  await entered
  assert.equal((await send()).status, 409)
  finish()
  assert.match(await (await first).text(), /DONE/)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(reservations.queue.has("target"), false) // nach dem Turn wieder frei
})

test("Freigabe meldet sich bei Hörern (Warteschlange startet ohne Abfragen) und gilt nur einmal", () => {
  const reservations = new ChatReservations()
  const released: string[] = []
  reservations.onRelease((id) => released.push(id))
  const release = reservations.reserve("chat")!
  assert.equal(reservations.reserve("chat"), undefined)
  release()
  release()
  assert.deepEqual(released, ["chat"])
  assert.equal(reservations.queue.has("chat"), false)
  assert.ok(reservations.reserve("chat"))
})

test("Wiederaufnahme und Übergabe reservieren denselben Chat nur einmal", async () => {
  const reservations = new ChatReservations()
  let starts = 0
  let finish!: () => void
  const waiting = new Promise<void>((resolve) => { finish = resolve })
  const app = createApp({
    token: "test", port: 4317,
    reserveTurn: (id) => reservations.reserve(id),
    store: { ownsChat: async () => true, listMessages: async () => [], clearMessages: async () => {} },
    resume: {
      prepare: async () => ({ ok: true, body: {} }),
      started: () => {},
      dismiss: () => false,
      interrupted: () => null,
    },
    runTurn: async () => {
      starts++
      await waiting
      return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
    },
  })
  const call = () => app.request("http://127.0.0.1:4317/v1/chats/team/resume", {
    method: "POST",
    headers: { host: "127.0.0.1:4317", authorization: "Bearer test", "content-type": "application/json" },
    body: JSON.stringify({ runId: "interrupted" }),
  })
  const dispatcherRelease = reservations.reserve("team")!
  assert.equal((await call()).status, 409)
  assert.equal(starts, 0)
  dispatcherRelease()
  assert.equal((await call()).status, 200)
  assert.equal(reservations.reserve("team"), undefined)
  assert.equal(starts, 1)
  finish()
})

test("Wiederaufnahme und echter Dispatcher starten denselben Chat nicht gleichzeitig", async () => {
  const reservations = new ChatReservations()
  const lines = new Map<string, OrbiLine>()
  let resumed = 0, woken = 0, active = 0, peak = 0
  let finishResume!: () => void, finishWake!: () => void
  const waitResume = new Promise<void>(resolve => { finishResume = resolve })
  const dispatcher = createDispatcher({
    store: {
      appendLine: async (_chat, line) => { const id = crypto.randomUUID(); lines.set(id, line); return id },
      patchLine: async (_chat, id, patch) => { const line = lines.get(id); if (!line) return null; const next = { ...line, ...patch }; lines.set(id, next); return next },
    },
    reserve: id => reservations.reserve(id), isBusy: id => reservations.queue.has(id),
    runWake: async (_request, release) => {
      woken++; peak = Math.max(peak, ++active)
      await new Promise<void>(resolve => { finishWake = resolve })
      active--; release()
      return { text: "", failed: false, aborted: false }
    },
    stopChat: () => false, findGroup: async () => null, publish: () => {},
  })
  reservations.onRelease(id => dispatcher.onRelease(id))
  const app = createApp({
    token: "test", port: 4317, reserveTurn: id => reservations.reserve(id),
    store: { ownsChat: async () => true, listMessages: async () => [], clearMessages: async () => {} },
    resume: { prepare: async () => ({ ok: true, body: {} }), started: () => {}, dismiss: () => false, interrupted: () => null },
    runTurn: async () => {
      resumed++; peak = Math.max(peak, ++active)
      await waitResume
      active--
      return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } })
    },
  })
  const response = await app.request("http://127.0.0.1:4317/v1/chats/team/resume", {
    method: "POST", headers: { host: "127.0.0.1:4317", authorization: "Bearer test", "content-type": "application/json" },
    body: JSON.stringify({ runId: "interrupted" }),
  })
  assert.equal(response.status, 200)
  await new Promise(resolve => setImmediate(resolve))
  const bot = (id: string, direct_chat_id: string) => ({ id, name: id, job: "Helfen", instructions: null, is_main: false, sandbox_id: null, avatar: "orb", color: null, member: true, direct_chat_id })
  const sender = bot("a", "source"), target = bot("b", "team")
  const taskId = dispatcher.beginTask("source")
  dispatcher.rootStarted(taskId, "source", sender.id)
  const sent = await dispatcher.send({ taskId, fromChatId: "source", from: sender, team: [sender, target], target: "b", message: "Bitte hilf", priority: true })
  assert.equal(sent.ok && sent.delivery, "queued")
  assert.equal(resumed, 1)
  assert.equal(woken, 0)
  finishResume()
  for (let i = 0; i < 20 && !woken; i++) await new Promise(resolve => setImmediate(resolve))
  assert.equal(woken, 1)
  assert.equal(peak, 1)
  finishWake()
})
