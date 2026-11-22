import "./fixtures/temp-data.ts"

import assert from "node:assert/strict"
import test from "node:test"
import { createUIMessageStreamResponse, type UIMessage } from "ai"

import { getDatabase } from "@/lib/db/client"
import { getRun, interruptStale, startRun } from "@/lib/work/runs"
import { loadCounters, saveCounters } from "@/lib/work/store"
import { createApp } from "../app"
import { createDispatcher } from "./dispatcher"
import { createResume } from "./resume"
import { createRunTracker } from "./runs"

const db = () => getDatabase().$client

const user = (id: string, text: string): UIMessage => ({ id, role: "user", parts: [{ type: "text", text }] })
const assistant = (id: string, text: string): UIMessage => ({ id, role: "assistant", parts: [{ type: "text", text }] })
const line = (id: string): UIMessage => ({
  id,
  role: "user",
  metadata: { kind: "orbi-line" } as never,
  parts: [{ type: "data-orbi-message", data: { v: 1 } }] as UIMessage["parts"],
})

test("RunTracker: begin, Schritte, Warten auf Consti, Ende; Fehler stören nie", () => {
  const tracker = createRunTracker(db)
  const id = tracker.begin({ kind: "turn", chatId: "c1", botId: "b1", payload: { model: "auto" } })!
  const wake = tracker.begin({ kind: "handoff", chatId: "c2", botId: "b2", rootChatId: "c1" })!
  assert.equal(getRun(db(), wake)?.parentId, id)
  tracker.step(id)
  tracker.step(id)
  tracker.waiting("c1", true)
  assert.equal(getRun(db(), id)?.status, "waiting")
  assert.equal(getRun(db(), id)?.steps, 2)
  tracker.waiting("c1", false)
  assert.equal(getRun(db(), id)?.status, "running")
  tracker.finish(id, "failed", "x".repeat(1000))
  assert.equal(getRun(db(), id)?.status, "failed")
  assert.equal(getRun(db(), id)?.error?.length, 300)
  // Nach dem Ende ändert „Warten“ nichts mehr.
  tracker.waiting("c1", true)
  assert.equal(getRun(db(), id)?.status, "failed")
  const broken = createRunTracker(() => {
    throw new Error("kaputt")
  })
  assert.equal(broken.begin({ kind: "turn", chatId: "c" }), undefined)
  broken.step("x")
  broken.finish("x", "done")
  broken.waiting("c", true)
})

test("Weiter: nur ein unterbrochener Turn dieses Chats; baut die Anfrage aus der letzten Nachricht von Consti (ohne angefangene Antwort)", async () => {
  const noted: [string, string][] = []
  const messages = [user("u1", "Hallo"), assistant("a1", "Hi"), user("u2", "Mach X"), line("l1"), assistant("a2", "halbe Antwor")]
  const resume = createResume({ getDb: db, listMessages: async () => messages, noteResume: (chat, task) => noted.push([chat, task]) })
  const id = startRun(db(), { kind: "turn", chatId: "cw", botId: "bw", payload: { model: "claude-sonnet-5-5", effort: "low", modelPinned: true, context: false, taskId: "task-9", skill: { name: "s", source: "orbit" } } })
  // Läuft noch: nicht fortsetzbar.
  assert.deepEqual(await resume.prepare("cw", id), { ok: false, error: "Diese Arbeit ist nicht unterbrochen.", status: 409 })
  assert.equal(resume.interrupted("cw"), null)
  interruptStale(db())
  const hint = resume.interrupted("cw")
  assert.equal(hint?.runId, id)
  assert.equal((await resume.prepare("andere", id)).ok, false) // falscher Chat
  const prepared = await resume.prepare("cw", id)
  assert.equal(prepared.ok, true)
  if (!prepared.ok) return
  assert.deepEqual(prepared.body, {
    messages: [messages[2]],
    trigger: "regenerate-message",
    messageId: "u2",
    clientData: { model: "claude-sonnet-5-5", effort: "low", context: false, modelPinned: true, botId: "bw", skill: { name: "s", source: "orbit" } },
  })
  assert.deepEqual(noted, [["cw", "task-9"]])
  resume.started(id)
  assert.equal(resume.interrupted("cw"), null)
  assert.equal(getRun(db(), id)?.note, "fortgesetzt")
  // Zum zweiten Mal geht es nicht.
  assert.equal((await resume.prepare("cw", id)).ok, false)
})

test("Weiter ohne Nachricht von Consti und Automationen: nicht möglich; Verwerfen räumt den Hinweis weg", async () => {
  const resume = createResume({ getDb: db, listMessages: async () => [assistant("a", "x")], noteResume: () => {} })
  const empty = startRun(db(), { kind: "turn", chatId: "ce" })
  const auto = startRun(db(), { kind: "automation", chatId: "ca" })
  interruptStale(db())
  assert.equal((await resume.prepare("ce", empty)).ok, false)
  assert.equal((await resume.prepare("ca", auto)).ok, false)
  assert.equal(resume.dismiss("ce", empty), true)
  assert.equal(resume.interrupted("ce"), null)
  assert.equal(resume.dismiss("ce", empty), false)
})

test("Route /resume: startet den Turn mit der vorbereiteten Anfrage, meldet 404/409/503 und liefert den Hinweis bei den Nachrichten", async () => {
  const runs: unknown[] = []
  const messages = [user("u1", "Bitte")]
  const resume = createResume({ getDb: db, listMessages: async () => messages, noteResume: () => {} })
  const stream = () =>
    createUIMessageStreamResponse({ stream: new ReadableStream({ start: (c) => c.close() }) })
  const make = (withResume: boolean) =>
    createApp({
      token: "t",
      port: 4319,
      store: { ownsChat: async () => true, listMessages: async () => messages, clearMessages: async () => {} },
      runTurn: async (input) => {
        runs.push(input.body)
        return stream()
      },
      ...(withResume ? { resume } : {}),
    })
  const call = (app: ReturnType<typeof make>, path: string, body?: unknown, method = "POST") =>
    app.request(`http://127.0.0.1:4319${path}`, {
      method,
      headers: { host: "127.0.0.1:4319", authorization: "Bearer t", "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  const app = make(true)
  const id = startRun(db(), { kind: "turn", chatId: "cr", botId: "br", payload: { model: "auto" } })
  interruptStale(db())
  assert.equal((await call(make(false), "/v1/chats/cr/resume", { runId: id })).status, 503)
  assert.equal((await call(app, "/v1/chats/cr/resume", { nope: 1 })).status, 400)
  assert.equal((await call(app, "/v1/chats/cr/resume", { runId: "gibtsnicht" })).status, 404)
  const shown = (await (await call(app, "/v1/chats/cr/messages", undefined, "GET")).json()) as { interrupted: { runId: string } | null }
  assert.equal(shown.interrupted?.runId, id)
  const started = await call(app, "/v1/chats/cr/resume", { runId: id })
  assert.equal(started.status, 200)
  assert.deepEqual(await started.json(), { ok: true })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(runs.length, 1)
  assert.equal((runs[0] as { trigger: string }).trigger, "regenerate-message")
  assert.equal((await call(app, "/v1/chats/cr/resume", { runId: id })).status, 409) // schon fortgesetzt
  const after = (await (await call(app, "/v1/chats/cr/messages", undefined, "GET")).json()) as { interrupted: unknown }
  assert.equal(after.interrupted, null)
})

test("Health-Route: ohne ?checks=1 nur ok, mit Prüfung der Zustand; ein Fehler dort macht die Route nicht kaputt", async () => {
  const mk = (checks: () => Promise<unknown>) =>
    createApp({
      token: "t",
      port: 4319,
      store: { ownsChat: async () => true, listMessages: async () => [], clearMessages: async () => {} },
      runTurn: async () => new Response(),
      healthChecks: checks,
    })
  const get = (app: ReturnType<typeof mk>, q: string) =>
    app.request(`http://127.0.0.1:4319/v1/health${q}`, { headers: { host: "127.0.0.1:4319", authorization: "Bearer t" } })
  const ok = mk(async () => [{ id: "proxy", state: "ok" }])
  assert.deepEqual(await (await get(ok, "")).json(), { ok: true })
  assert.deepEqual(await (await get(ok, "?checks=1")).json(), { ok: true, checks: [{ id: "proxy", state: "ok" }] })
  const bad = mk(async () => {
    throw new Error("x")
  })
  assert.deepEqual(await (await get(bad, "?checks=1")).json(), { ok: true, checks: null })
})

test("Auftragszähler überstehen einen Neustart: Weiter übernimmt die Zähler, ein normaler neuer Auftrag beginnt bei null", () => {
  const events: unknown[] = []
  const make = () =>
    createDispatcher({
      store: { appendLine: async () => "x", patchLine: async () => null },
      reserve: () => () => {},
      isBusy: () => false,
      runWake: async () => ({ text: "", failed: false, aborted: false }),
      stopChat: () => true,
      findGroup: async () => null,
      publish: (event) => void events.push(event),
      counters: { save: (c) => saveCounters(db(), c), load: (id) => loadCounters(db(), id) },
    })
  const first = make()
  const task = first.beginTask("chat-root")
  const t = first.task(task)!
  t.sent = 7
  t.groupRounds = 2
  t.pairWakes.set("a|b", 3)
  saveCounters(db(), { taskId: task, rootChatId: "chat-root", sent: t.sent, groupRounds: t.groupRounds, deepCalls: 1, pairWakes: [...t.pairWakes] })
  // Neustart: neuer Dispatcher, gleiche Datenbank.
  const second = make()
  const resumed = second.task(second.beginTask("chat-root", undefined, task))!
  assert.equal(resumed.sent, 7)
  assert.equal(resumed.groupRounds, 2)
  assert.equal(resumed.deepCalls, 1)
  assert.equal(resumed.pairWakes.get("a|b"), 3)
  const fresh = second.task(second.beginTask("chat-root"))!
  assert.equal(fresh.sent, 0)
  assert.equal(fresh.deepCalls, 0)
  assert.equal(fresh.pairWakes.size, 0)
})

test("Weiter nach einer unterbrochenen Übergabe: erscheint im Chat von Consti, startet dessen letzte Nachricht neu und übernimmt Zähler und Orbi des Turns", async () => {
  const noted: [string, string][] = []
  const messages = [user("u1", "Frag B")]
  const resume = createResume({ getDb: db, listMessages: async () => messages, noteResume: (chat, task) => noted.push([chat, task]) })
  const root = startRun(db(), { kind: "turn", chatId: "ho-root", botId: "ho-a", payload: { model: "claude-sonnet-5-5", taskId: "TT" } }, 100)
  const tracker = createRunTracker(db)
  tracker.finish(root, "done")
  const handoff = startRun(db(), { kind: "handoff", chatId: "ho-b", botId: "ho-b-bot", parentId: root, payload: { model: "anderes", taskId: "TT", rootChatId: "ho-root" } }, 200)
  interruptStale(db())
  assert.equal(resume.interrupted("ho-b"), null)
  assert.equal(resume.interrupted("ho-root")?.runId, handoff)
  assert.equal((await resume.prepare("ho-b", handoff)).ok, false)
  const prepared = await resume.prepare("ho-root", handoff)
  assert.equal(prepared.ok, true)
  if (!prepared.ok) return
  const data = prepared.body.clientData as { model: string; botId: string }
  assert.equal(data.model, "claude-sonnet-5-5") // vom Turn, in dem Consti schrieb, nicht vom Handoff-Orbi
  assert.equal(data.botId, "ho-a")
  assert.deepEqual(noted, [["ho-root", "TT"]])
  resume.started(handoff)
  assert.equal(resume.interrupted("ho-root"), null)
})
