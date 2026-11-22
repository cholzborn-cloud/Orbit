import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { after } from "node:test"

import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"
import type { UIMessage } from "ai"
import { MockLanguageModelV3 } from "ai/test"

// Ganze Kette mit echter Laufzeit, echter Datenbank (Temp-Kopie), echtem Turn-Handler und Lauf-Steuerung, Modell als Attrappe:
// Consti gibt eine lange Aufgabe, schreibt währenddessen, bekommt sofort eine Antwort, und die laufende Arbeit sieht die Nachricht.
const dir = mkdtempSync(join(tmpdir(), "orbitd-lane-"))
process.env.ORBIT_DATA_DIR = dir
process.env.ORBIT_AGENTS_PATH = "/gibt/es/nicht/AGENTS.md"

const { getDatabase } = await import("@/lib/db/client")
const { bots, chatMembers, chats } = await import("@/lib/db/schema")
const { cli } = await import("@/lib/cli/provider")
cli.available = async () => true
const { createChatRuntime } = await import("./runtime")
const { createMessageStore } = await import("./store")
const { createTurnHandler } = await import("./handle-turn")

const db = getDatabase()
const usage = { inputTokens: { total: 1 }, outputTokens: { total: 1 } }
const textStream = (text: string) =>
  new ReadableStream({
    start(c) {
      c.enqueue({ type: "stream-start", warnings: [] })
      c.enqueue({ type: "text-start", id: "0" })
      c.enqueue({ type: "text-delta", id: "0", delta: text })
      c.enqueue({ type: "text-end", id: "0" })
      c.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage })
      c.close()
    },
  })
const toolStream = (id: string, text: string) =>
  new ReadableStream({
    start(c) {
      c.enqueue({ type: "stream-start", warnings: [] })
      c.enqueue({ type: "tool-call", toolCallId: id, toolName: "say", input: JSON.stringify({ text }) })
      c.enqueue({ type: "finish", finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage })
      c.close()
    },
  })

let release!: () => void
const held = new Promise<void>((resolve) => (release = resolve))
let reachedResolve!: () => void
const reached = new Promise<void>((resolve) => (reachedResolve = resolve))
const mainPrompts: string[] = []
const model = new MockLanguageModelV3({
  doStream: async (options: LanguageModelV3CallOptions) => {
    const system = String(options.prompt.find((m) => m.role === "system")?.content ?? "")
    const flat = JSON.stringify(options.prompt)
    if (system.includes("Zwischenfrage:")) return { stream: textStream("Kurz: Es ist 12 Uhr.") }
    mainPrompts.push(flat)
    const toolResults = options.prompt.filter((m) => m.role === "tool").length
    if (toolResults === 0) return { stream: toolStream("s1", "Ich fange an.") }
    if (toolResults === 1) {
      // Hauptarbeit „denkt lange“: hier schreibt Consti dazwischen.
      reachedResolve()
      await held
      return { stream: toolStream("s2", "Weiter.") }
    }
    return { stream: textStream(flat.includes("Zwischennachricht von Consti") ? "Fertig, auf Englisch umgestellt." : "Fertig.") }
  },
})
;(cli as unknown as { chat: (id: string) => unknown }).chat = () => model

after(() => {
  db.$client.close()
  rmSync(dir, { recursive: true, force: true })
})

test("Zwischennachricht: sofortige Antwort parallel, Hauptarbeit sieht sie an der nächsten Schrittgrenze, „fertig“ erst ganz am Ende", async () => {
  db.insert(bots).values([{ id: "lana", userId: "local", thirdPartyId: "x", name: "Lana", job: "Hauptorbi", isMain: true, onboardingDone: true }]).run()
  db.insert(chats).values([{ id: "chat-l", userId: "local" }]).run()
  db.insert(chatMembers).values([{ chatId: "chat-l", botId: "lana" }]).run()
  const store = createMessageStore(db)
  const runtime = createChatRuntime(store)
  const statuses: { status: string; at: number }[] = []
  const publish = runtime.events.publish.bind(runtime.events)
  runtime.events.publish = (event) => {
    if (event.type === "status" && event.chatId === "chat-l") statuses.push({ status: event.status, at: Date.now() })
    publish(event)
  }
  const lane = runtime.connect(createTurnHandler(store, runtime.runRoot, undefined, runtime.runSide))
  const clientData = { model: "claude-haiku-5-5", effort: "low" }
  const u1: UIMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Schreib einen langen Bericht" }] }
  const u2: UIMessage = { id: "u2", role: "user", parts: [{ type: "text", text: "Bitte auf Englisch. Wie spät ist es?" }] }

  const main = await lane.submit("chat-l", { messages: [u1], clientData })
  assert.equal(main.status, 200)
  const mainText = main.text()
  await reached
  const side = await lane.submit("chat-l", { messages: [u2], clientData })
  assert.match(await side.text(), /12 Uhr/)
  // Seitenlauf fertig, Hauptarbeit läuft noch: kein „fertig“ bis jetzt.
  await new Promise((resolve) => setTimeout(resolve, 30))
  const releasedAt = Date.now()
  assert.equal(statuses.some((s) => s.status === "fertig"), false, JSON.stringify(statuses))
  release()
  await mainText
  for (let i = 0; i < 200 && runtime.turns.runningKeys("chat-l").length > 0; i++) await new Promise((resolve) => setTimeout(resolve, 10))
  await new Promise((resolve) => setTimeout(resolve, 30))

  // Die Hauptarbeit hat die Nachricht samt kurzer Antwort an der Schrittgrenze gesehen und darauf reagiert.
  const steered = mainPrompts.find((p) => p.includes("Zwischennachricht von Consti"))
  assert.ok(steered, "Hauptarbeit hat die Zwischennachricht nicht gesehen")
  assert.match(steered!, /Bitte auf Englisch/)
  assert.match(steered!, /12 Uhr/)
  // Die ursprüngliche Aufgabe ist verankert und soll vollständig zu Ende gebracht werden.
  assert.match(steered!, /Deine Aufgabe bleibt: „Schreib einen langen Bericht“/)
  assert.match(steered!, /vollständig zu Ende/)
  const messages = await store.listMessages("chat-l")
  const texts = messages.map((m) => `${m.role}:${m.parts.filter((p) => p.type === "text").map((p) => (p as { text: string }).text).join("")}`)
  assert.ok(texts.includes("user:Bitte auf Englisch. Wie spät ist es?"))
  assert.ok(texts.some((t) => t.includes("Kurz: Es ist 12 Uhr.")))
  assert.ok(texts.some((t) => t.includes("Fertig, auf Englisch umgestellt.")))
  // Kein Folgelauf nötig, Eingang leer, Status erst am Ende „fertig“.
  assert.equal(runtime.inbox.list("chat-l").length, 0)
  const finals = statuses.filter((s) => s.status === "fertig")
  assert.ok(finals.length >= 1 && finals.every((s) => s.at >= releasedAt), JSON.stringify(statuses))
  assert.equal(statuses.at(-1)?.status, "fertig")
})
