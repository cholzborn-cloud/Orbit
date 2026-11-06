import assert from "node:assert/strict"
import { mkdtempSync, renameSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import test, { after } from "node:test"

import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"
import type { UIMessage } from "ai"
import { MockLanguageModelV3 } from "ai/test"

// Phase 2 Lauf A2 über den echten Runtime-Weg (Temp-DB, Modell-Mock): Gruppenrunde (Schweigen, @, Rückfall, Stopp,
// Orbi-Nachricht an die Gruppe) und Rückfragen eines geweckten Orbis im Root-Chat.
const dir = mkdtempSync(join(tmpdir(), "orbitd-group-"))
process.env.ORBIT_DATA_DIR = dir
process.env.ORBIT_AGENTS_PATH = "/gibt/es/nicht/AGENTS.md"

const { getDatabase } = await import("@/lib/db/client")
const { bots, chatMembers, chats } = await import("@/lib/db/schema")
const { cli } = await import("@/lib/cli/provider")
cli.available = async () => true
const { createChatRuntime } = await import("./runtime")
const { createMessageStore } = await import("./store")
const { createTurnHandler } = await import("./handle-turn")
const { readLine } = await import("@/lib/chat/orbi-message")
const { createGroupRunner } = await import("./group-runtime")
const { ChatReservations } = await import("./reservations")

const db = getDatabase()
type Call = { who: string; system: string; flat: string; lastRole?: string }
type Reply = string | "silent" | "hang" | { tool: string; input: unknown }
let script: (call: Call) => Reply = () => "silent"
const calls: Call[] = []
let toolIds = 0
let hanging: (() => void) | undefined

const finish = { type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } }
const mock = new MockLanguageModelV3({
  doStream: async (options: LanguageModelV3CallOptions) => {
    // Seit Lauf G steht das Wechselnde (Gruppenrunde, Übergabe) in einer eigenen Hinweis-Nachricht vor der letzten Nutzer-Nachricht.
    const note = options.prompt.filter((m) => m.role === "user" && JSON.stringify(m.content).includes("<orbit_context>")).map((m) => JSON.stringify(m.content)).join("\n")
    const system = String(options.prompt.find((m) => m.role === "system")?.content ?? "") + note
    const who = /You are (\w+),/.exec(system)?.[1] ?? "?"
    const call: Call = { who, system, flat: JSON.stringify(options.prompt), lastRole: options.prompt.at(-1)?.role }
    calls.push(call)
    const reply = script(call)
    return {
      stream: new ReadableStream({
        start(c) {
          c.enqueue({ type: "stream-start", warnings: [] })
          if (reply === "hang") {
            hanging?.()
            options.abortSignal?.addEventListener("abort", () => c.error(options.abortSignal!.reason ?? new Error("abort")), { once: true })
            return
          }
          if (typeof reply === "object") {
            c.enqueue({ type: "tool-call", toolCallId: `t${++toolIds}`, toolName: reply.tool, input: JSON.stringify(reply.input) })
            c.enqueue({ ...finish, finishReason: { unified: "tool-calls", raw: "tool-calls" } })
          } else {
            if (reply !== "silent") {
              c.enqueue({ type: "text-start", id: "0" })
              c.enqueue({ type: "text-delta", id: "0", delta: reply })
              c.enqueue({ type: "text-end", id: "0" })
            }
            c.enqueue(finish)
          }
          c.close()
        },
      }),
    }
  },
})
;(cli as unknown as { chat: (id: string) => unknown }).chat = () => mock

// Alpha (Haupt), Beta, Gamma; je ein eigener Chat; Gruppe „Team“ in dieser Reihenfolge.
const names = { alpha: "Alpha", beta: "Beta", gamma: "Gamma" } as const
db.insert(bots).values(
  Object.entries(names).map(([id, name]) => ({ id, userId: "local", thirdPartyId: "x", name, job: "Helfen", isMain: id === "alpha" }))
).run()
db.insert(chats).values([
  { id: "chat-alpha", userId: "local" },
  { id: "chat-beta", userId: "local" },
  { id: "chat-gamma", userId: "local" },
  ...["g1", "g2", "g3", "g4", "g5", "g6", "g7"].map((id) => ({ id, userId: "local", kind: "group" as const, name: "Team" })),
]).run()
db.insert(chatMembers).values([
  { chatId: "chat-alpha", botId: "alpha" },
  { chatId: "chat-beta", botId: "beta" },
  { chatId: "chat-gamma", botId: "gamma" },
  ...["g1", "g2", "g3", "g4", "g5", "g6", "g7"].flatMap((chatId) =>
    (["alpha", "beta", "gamma"] as const).map((botId, i) => ({ chatId, botId, joinedAt: new Date(1000 * (i + 1)) }))
  ),
]).run()
const store = createMessageStore(db)
const runtime = createChatRuntime(store)
const events: Record<string, unknown>[] = []
const publish = runtime.events.publish.bind(runtime.events)
runtime.events.publish = (e) => {
  events.push(e as never)
  publish(e)
}
// Jeder Orbi hat zuvor mit Haiku geantwortet (eigenes Modell, kein Jev-Aufruf).
for (const chat of ["chat-alpha", "chat-beta", "chat-gamma"])
  await store.saveMessages(chat, [{ id: `old-${chat}`, role: "assistant", metadata: { model: "Haiku 5.5" }, parts: [{ type: "text", text: "früher" }] }])

const handle = createTurnHandler(store, runtime.runRoot)
function say(chatId: string, id: string, text: string, clientData: Record<string, unknown> = {}) {
  const user: UIMessage = { id, role: "user", parts: [{ type: "text", text }] }
  const release = runtime.reserveRoot(chatId)!
  assert.ok(release, "Chat ist belegt")
  assert.ok(
    runtime.turns.start(
      chatId,
      (signal) => handle({ chatId, body: { messages: [user], clientData: { model: "claude-haiku-5-5", effort: "low", ...clientData } }, signal }),
      release
    )
  )
}
const free = (chat: string) => {
  const r = runtime.reserveRoot(chat)
  r?.()
  return !!r
}
async function settled(...chatIds: string[]) {
  const until = Date.now() + 15_000
  await new Promise((r) => setTimeout(r, 50))
  while (Date.now() < until && !(chatIds.every((c) => free(c) && !runtime.turns.isRunning(c)) && runtime.dispatcher.snapshot().tasks === 0))
    await new Promise((r) => setTimeout(r, 25))
  assert.ok(Date.now() < until, "wurde nicht fertig")
}
const reset = () => {
  calls.length = 0
  events.length = 0
}
const order = () => calls.map((c) => c.who)
const spoken = async (chat: string) =>
  (await store.listMessages(chat))
    .filter((m) => m.role === "assistant" && !readLine(m) && m.id.length > 8 && !m.id.startsWith("old-"))
    .map((m) => `${(m.metadata as { botId?: string })?.botId}:${m.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("")}`)

test("Gruppe: Nachricht geht an alle, @Gamma zuerst, Alpha schweigt (kein Eintrag), Beta sieht die Antwort davor", async () => {
  reset()
  script = ({ who }) => (who === "Gamma" ? "Idee eins" : who === "Beta" ? "Idee zwei" : "silent")
  say("g1", "u1", "Wer hat Ideen? @Gamma")
  await settled("g1")
  assert.deepEqual(order(), ["Gamma", "Alpha", "Beta"])
  assert.deepEqual(await spoken("g1"), ["gamma:Idee eins", "beta:Idee zwei"])
  assert.match(calls[0]!.flat, /\[Gruppe: Team\] Wer hat Ideen/)
  assert.match(calls[0]!.system, /You were tagged/)
  assert.doesNotMatch(calls[1]!.system, /You were tagged/)
  assert.match(calls[2]!.flat, /Idee eins/)
  assert.deepEqual(
    events.filter((e) => e.type === "group-turn" && e.phase !== "start").map((e) => `${e.phase}:${e.botId ?? ""}`),
    ["reply:gamma", "silent:alpha", "reply:beta", "end:"]
  )
})

test("Gruppe: Verweis @[Name](orbi:id) markiert sicher; Markierter schweigt zuerst, dann Nachlauf mit Hinweis (einmalig)", async () => {
  reset()
  script = ({ who, system }) => (who === "Beta" && /You must answer now/.test(system) ? "Ich bin da" : "silent")
  say("g2", "u2", "Hallo @[Beta](orbi:beta), kurz melden")
  await settled("g2")
  assert.deepEqual(order(), ["Beta", "Beta", "Alpha", "Gamma"])
  assert.match(calls[1]!.system, /You must answer now/)
  assert.deepEqual(await spoken("g2"), ["beta:Ich bin da"])
})

test("Gruppe: schweigen alle, antwortet der zuletzt gewählte (Fallback) mit Hinweis", async () => {
  reset()
  script = ({ who, system }) => (who === "Gamma" && /You must answer now/.test(system) ? "Ich übernehme" : "silent")
  say("g3", "u3", "Irgendwer?", { botId: "gamma" })
  await settled("g3")
  assert.deepEqual(order(), ["Alpha", "Beta", "Gamma", "Gamma"])
  assert.deepEqual(await spoken("g3"), ["gamma:Ich übernehme"])
})

test("Gruppe: Ein markierter Orbi ohne Antwort hinterlässt einen sichtbaren Hinweis", async () => {
  reset()
  script = ({ who }) => who === "Alpha" ? "Ich bin da" : "silent"
  say("g6", "u6-group", "@Beta, was meinst du?")
  await settled("g6")
  assert.deepEqual(order(), ["Beta", "Beta", "Alpha", "Gamma"])
  const messages = await store.listMessages("g6")
  assert.ok(messages.some(message => message.parts.some(part => part.type === "data-notice" && JSON.stringify(part).includes("Beta hat nicht geantwortet"))))
  assert.equal(events.at(-1)?.phase, "end")
})

test("Gruppe: Wenn alle schweigen, meldet Orbit die fehlende Antwort", async () => {
  reset()
  script = () => "silent"
  say("g7", "u7-group", "Hallo zusammen")
  await settled("g7")
  const messages = await store.listMessages("g7")
  assert.ok(messages.some(message => message.parts.some(part => part.type === "data-notice" && JSON.stringify(part).includes("Kein Orbi hat geantwortet"))))
})

test("Gruppe: Stopp im Root bricht den Fan-out ab, Gamma und Rückfall laufen nicht", async () => {
  reset()
  let reached!: () => void
  const gotBeta = new Promise<void>((r) => (reached = r))
  hanging = reached
  script = ({ who }) => (who === "Alpha" ? "Alpha sagt hallo" : who === "Beta" ? "hang" : "Gamma sagt hallo")
  say("g4", "u4", "Hallo zusammen")
  await gotBeta
  // wie die App: erst den Auftrag, dann den Turn
  assert.equal(runtime.stopRoot("g4"), true)
  runtime.turns.stop("g4")
  await settled("g4")
  hanging = undefined
  assert.deepEqual(order(), ["Alpha", "Beta"])
  assert.deepEqual(await spoken("g4"), ["alpha:Alpha sagt hallo"])
  assert.equal(events.at(-1)?.type, "group-turn")
  assert.equal(events.at(-1)?.stopped, true)
})

test("Orbi schreibt an die Gruppe: übrige Mitglieder sprechen nacheinander (Schweigen erlaubt), der Absender nicht", async () => {
  reset()
  script = ({ who, lastRole, flat }) => {
    if (who === "Alpha" && lastRole === "user" && !flat.includes("Gruppe: Team"))
      return { tool: "send_message", input: { target: "g5", message: "Wer macht die Folien?", priority: false } }
    if (who === "Alpha") return "Ich habe die Gruppe gefragt."
    return who === "Beta" ? "Ich mache sie" : "silent"
  }
  say("chat-alpha", "u5", "Frag die Gruppe, wer die Folien macht")
  await settled("chat-alpha", "g5")
  // Alpha antwortet im eigenen Chat, während die Gruppe spricht: nur die Reihenfolge in der Gruppe ist fest.
  assert.deepEqual(order().filter((w) => w !== "Alpha"), ["Beta", "Gamma"])
  assert.equal(order().filter((w) => w === "Alpha").length, 2)
  const group = await store.listMessages("g5")
  const kinds = group.map((m) => {
    const l = readLine(m)
    return l ? `${l.direction}:${l.kind}` : m.role
  })
  assert.deepEqual(kinds, ["in:message", "assistant"])
  assert.deepEqual(await spoken("g5"), ["beta:Ich mache sie"])
  const beta = calls.find((c) => c.who === "Beta")!
  assert.match(beta.flat, /Wer macht die Folien/)
  assert.doesNotMatch(beta.system, /You were tagged/)
})

test("Rückfrage von B erscheint im Root-Chat (Absender Beta), Antwort erreicht B; Abbruch macht sie hinfällig", async () => {
  reset()
  script = ({ who, lastRole, flat }) => {
    if (who === "Alpha" && lastRole === "user" && flat.includes("an Beta"))
      return { tool: "send_message", input: { target: "Beta", message: "Prüfe die Datei", priority: true } }
    if (who === "Alpha") return "Beta arbeitet."
    if (who === "Beta" && lastRole === "user")
      return { tool: "ask_user", input: { questions: [{ question: "Welche Variante?", options: [{ label: "Eins", recommended: true }, { label: "Zwei" }] }] } }
    if (who === "Beta") return /Zwei/.test(flat) ? "result: Variante Zwei geprüft" : "failed: keine Antwort"
    return "silent"
  }
  say("chat-alpha", "u6", "Schick das an Beta")
  const until = Date.now() + 10_000
  while (!runtime.manager.list().length && Date.now() < until) await new Promise((r) => setTimeout(r, 20))
  const [card] = runtime.manager.list()
  assert.ok(card, "keine Karte")
  assert.equal(card.kind, "ask")
  assert.equal(card.chatId, "chat-beta")
  assert.equal(card.root?.chatId, "chat-alpha")
  assert.equal(card.from?.name, "Beta")
  assert.equal(card.from?.id, "beta")
  assert.ok(events.some((e) => e.type === "question" && e.status === "pending" && (e.root as { chatId?: string })?.chatId === "chat-alpha"))
  const result = await runtime.manager.decide(card.id, { answer: { answers: [{ question: "Welche Variante?", answers: ["Zwei"] }] } })
  assert.deepEqual(result, { ok: true })
  await settled("chat-alpha", "chat-beta")
  const beta = await store.listMessages("chat-beta")
  assert.match(JSON.stringify(beta), /Variante Zwei geprüft/)
  const alphaLines = (await store.listMessages("chat-alpha")).map((m) => readLine(m)).filter(Boolean)
  assert.ok(alphaLines.some((l) => l!.kind === "reply" && l!.status === "fertig"))

  // Zweiter Lauf: Stopp im Root, solange B fragt, macht die Karte hinfällig.
  reset()
  say("chat-alpha", "u7", "Schick das nochmal an Beta")
  const until2 = Date.now() + 10_000
  while (!runtime.manager.list().length && Date.now() < until2) await new Promise((r) => setTimeout(r, 20))
    assert.equal(runtime.manager.list().length, 1)
  assert.equal(runtime.stopRoot("chat-alpha"), true)
  await settled("chat-alpha", "chat-beta")
  assert.equal(runtime.manager.list().length, 0)
  const last = events.filter((e) => e.type === "question").at(-1)
  assert.equal(last?.status, "aborted")
  assert.equal((last?.root as { chatId?: string })?.chatId, "chat-alpha")
})

after(() => {
  db.$client.close()
  renameSync(dir, join(homedir(), ".Trash", `Orbit-Gruppentest-${process.pid}`))
})


test("Gruppenwarteschlange: Stopp bei Freigabe erledigt den Auftrag nur einmal", async () => {
  const reservations = new ChatReservations()
  let holdsReleased = 0
  const task = { rootChatId: "root", aborted: true }
  const groups = createGroupRunner({
    reservations, store, turns: runtime.turns,
    dispatcher: { task: () => task, hold: () => () => { holdsReleased++ } } as never,
    runtime: () => runtime.runtime, run: async () => { throw new Error("Stopp darf keinen Turn starten") },
    publish: () => {}, ownModel: async () => ({ model: "auto" }),
  })
  reservations.onRelease((id) => { void groups.pump(id) })
  const release = reservations.reserve("g1")!
  groups.onGroupMessage({ group: { id: "g1", name: "Team" }, fromBotId: "alpha", taskId: "task", text: "Hallo" })
  release()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(holdsReleased, 1)
  assert.equal(reservations.queue.has("g1"), false)
})

test("Gruppenfortsetzung: unerwarteter Fehler bleibt als Hinweis sichtbar und gibt den Chat frei", async () => {
  const recorded: Record<string, unknown>[] = []
  const groups = createGroupRunner({
    reservations: new ChatReservations(), store: { ...store, listMessages: async () => { throw new Error("interner Fehlertext") } },
    turns: runtime.turns, dispatcher: { task: () => ({ aborted: false }) } as never,
    runtime: () => runtime.runtime, run: async () => { throw new Error("unerwartet") },
    publish: (event) => recorded.push(event as never), ownModel: async () => ({ model: "auto" }),
  })
  const round = groups.rootRound({ chatId: "g1", messages: [], clientData: { model: "auto" } } as never, "task", { order: ["alpha", "beta"], marked: [], fallback: "alpha" })
  await round.onFinish({ responseMessage: { id: "antwort", role: "assistant", parts: [{ type: "text", text: "Hallo" }] }, outcome: { status: "ok" }, isAborted: false } as never)
  await new Promise<void>((resolve) => groups.wrapRelease("g1", resolve)())
  const messages = await store.listMessages("g1")
  const notice = messages.find(message => message.parts.some(part => part.type === "data-notice" && JSON.stringify(part).includes("Gruppenrunde konnte nicht abgeschlossen")))
  assert.ok(notice)
  assert.doesNotMatch(JSON.stringify(notice), /interner Fehlertext/)
  assert.equal(recorded.at(-1)?.phase, "end")
  assert.equal(recorded.at(-1)?.stopped, false)
})

test("Gruppenstart: Fehler meldet Hinweis und aktualisiert den Verlauf", async () => {
  const recorded: Record<string, unknown>[] = []
  const notices: unknown[] = []
  let released!: () => void
  const done = new Promise<void>((resolve) => { released = resolve })
  const groups = createGroupRunner({
    reservations: new ChatReservations(), store: { ...store, upsertMessage: async (_chat, message) => { notices.push(message) } },
    turns: runtime.turns, dispatcher: { task: () => ({ aborted: false, rootChatId: "root" }), hold: () => released } as never,
    runtime: () => runtime.runtime, run: async () => { throw new Error("unerwartet") },
    publish: (event) => recorded.push(event as never), ownModel: async () => ({ model: "auto" }),
  })
  groups.onGroupMessage({ group: { id: "nicht-vorhanden", name: "Test" }, fromBotId: "alpha", taskId: "task", text: "Hallo" })
  await done
  assert.match(JSON.stringify(notices), /Gruppenrunde konnte nicht gestartet/)
  assert.equal(recorded.at(-1)?.phase, "end")
})
