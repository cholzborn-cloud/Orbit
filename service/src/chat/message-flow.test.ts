import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test, { after } from "node:test"

import type { LanguageModelV3CallOptions } from "@ai-sdk/provider"
import type { UIMessage } from "ai"
import { MockLanguageModelV3 } from "ai/test"

// Ganze Kette mit echtem Runtime, echter Datenbank (Kopie im Temp-Ordner) und einem Modell-Mock:
// Consti -> A, A sendet B (fire-and-forget), B antwortet im eigenen Chat, A wird geweckt und fasst zusammen.
const dir = mkdtempSync(join(tmpdir(), "orbitd-flow-"))
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

const db = getDatabase()
const prompts: { who: string; text: string }[] = []
let startedResolve!: () => void
const started = { promise: new Promise<void>((resolve) => (startedResolve = resolve)) }

function textStream(text: string) {
  return new ReadableStream({
    start(c) {
      c.enqueue({ type: "stream-start", warnings: [] })
      c.enqueue({ type: "text-start", id: "0" })
      c.enqueue({ type: "text-delta", id: "0", delta: text })
      c.enqueue({ type: "text-end", id: "0" })
      c.enqueue({ type: "finish", finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } })
      c.close()
    },
  })
}
const model = new MockLanguageModelV3({
  doStream: async (options: LanguageModelV3CallOptions) => {
    const system = options.prompt.find((m) => m.role === "system")?.content ?? ""
    const who = /You are (\w+),/.exec(String(system))?.[1] ?? "?"
    const flat = JSON.stringify(options.prompt)
    prompts.push({ who, text: flat })
    const last = options.prompt.at(-1)
    if (who === "Gamma" && last?.role === "user" && JSON.stringify(last).includes("Starte Delta"))
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "stream-start", warnings: [] })
            c.enqueue({ type: "tool-call", toolCallId: "call2", toolName: "send_message", input: JSON.stringify({ target: "Delta", message: "Lange Arbeit", priority: true }) })
            c.enqueue({ type: "finish", finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } })
            c.close()
          },
        }),
      }
    if (who === "Gamma" && last?.role === "tool") return { stream: textStream("Delta arbeitet.") }
    if (who === "Delta")
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "stream-start", warnings: [] })
            startedResolve()
            // hängt, bis abgebrochen wird
            options.abortSignal?.addEventListener("abort", () => c.error(options.abortSignal!.reason ?? new Error("abort")), { once: true })
          },
        }),
      }
    if (who === "Alpha" && last?.role === "user" && JSON.stringify(last).includes("Schick das an Beta"))
      return {
        stream: new ReadableStream({
          start(c) {
            c.enqueue({ type: "stream-start", warnings: [] })
            c.enqueue({
              type: "tool-call",
              toolCallId: "call1",
              toolName: "send_message",
              input: JSON.stringify({ target: "Beta", message: "Prüfe die Datei x", priority: true }),
            })
            c.enqueue({ type: "finish", finishReason: { unified: "tool-calls", raw: "tool-calls" }, usage: { inputTokens: { total: 1 }, outputTokens: { total: 1 } } })
            c.close()
          },
        }),
      }
    if (who === "Alpha" && last?.role === "tool") return { stream: textStream("Gesendet an Beta.") }
    if (who === "Beta") return { stream: textStream("result: Datei x ist in Ordnung") }
    return { stream: textStream("Beta meldet: Datei x ist in Ordnung.") }
  },
})
const usedModels: string[] = []
;(cli as unknown as { chat: (id: string) => unknown }).chat = (id) => {
  usedModels.push(id)
  return model
}

test("Kette Consti -> A -> B -> A: Zeilen in beiden Chats, B arbeitet im eigenen Chat, A fasst zusammen", async () => {
  try {
    db.insert(bots).values([
      { id: "alpha", userId: "local", thirdPartyId: "x", name: "Alpha", job: "Hauptorbi", isMain: true },
      { id: "beta", userId: "local", thirdPartyId: "x", name: "Beta", job: "Prüfen" },
    ]).run()
    db.insert(chats).values([{ id: "chat-a", userId: "local" }, { id: "chat-b", userId: "local" }]).run()
    db.insert(chatMembers).values([{ chatId: "chat-a", botId: "alpha" }, { chatId: "chat-b", botId: "beta" }]).run()
    const store = createMessageStore(db)
    const runtime = createChatRuntime(store)
    const user: UIMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Schick das an Beta" }] }
    // Beta hat zuletzt mit Opus geantwortet: das ist sein eigenes Modell, auch wenn Consti mit Haiku schreibt.
    await store.saveMessages("chat-b", [
      { id: "old", role: "assistant", metadata: { model: "Opus 5.5", effort: "high" }, parts: [{ type: "text", text: "früher" }] },
    ])
    // Echter Weg wie in der App: Turn-Handler (speichert die Nutzernachricht und das Turn-Ende selbst).
    const handle = createTurnHandler(store, runtime.runRoot)
    const release = runtime.reserveRoot("chat-a")!
    assert.ok(
      runtime.turns.start(
        "chat-a",
        (signal) =>
          handle({
            chatId: "chat-a",
            body: { messages: [user], clientData: { model: "claude-haiku-5-5", effort: "low" } },
            signal,
          }),
        release
      )
    )
    const until = Date.now() + 15_000
    const settled = () => {
      const s = runtime.dispatcher.snapshot()
      return s.tasks === 0 && !runtime.turns.isRunning("chat-a") && !runtime.turns.isRunning("chat-b")
    }
    await new Promise((r) => setTimeout(r, 50))
    while (!settled() && Date.now() < until) await new Promise((r) => setTimeout(r, 25))
    assert.ok(settled(), "Kette wurde nicht fertig")

    const a = await store.listMessages("chat-a")
    const b = await store.listMessages("chat-b")
    const kinds = (list: UIMessage[]) =>
      list.map((m) => {
        const l = readLine(m)
        return l ? `${l.direction}:${l.kind}:${l.status}` : m.role
      })
    // A: Nutzer, Antwort mit send_message, „gesendet an B“, „Antwort von B“ (Zeilen kamen während des Turns dazu), Zusammenfassung
    assert.deepEqual(kinds(a), ["user", "assistant", "out:message:fertig", "in:reply:fertig", "assistant"])
    assert.ok(a[1].parts.some((p) => p.type === "tool-send_message"))
    assert.equal(readLine(a[3])?.text, "result: Datei x ist in Ordnung")
    assert.match(JSON.stringify(a[4].parts), /Beta meldet/)
    // B: „Nachricht von A“, Antwort im eigenen Chat, „Antwort gesendet an A“
    assert.deepEqual(kinds(b), ["assistant", "in:message:fertig", "assistant", "out:reply:fertig"])
    assert.match(JSON.stringify(b[2].parts), /result: Datei x ist in Ordnung/)
    // Modelle: Alpha mit dem Modell von Consti (Haiku, nicht ausdrücklich gewählt), Beta mit seinem eigenen (Opus),
    // Alpha beim Zusammenfassen mit seinem eigenen (letzte Antwort: Haiku)
    assert.deepEqual(usedModels, ["claude-haiku-5-5", "claude-opus-5-5", "claude-haiku-5-5"])
    // Modellkontext: B sieht die Nachricht gerahmt, die Ausgangszeile von A taucht in keinem Prompt auf.
    const beta = prompts.filter((p) => p.who === "Beta")
    assert.equal(beta.length, 1)
    assert.match(beta[0].text, /message_[0-9a-f]{12} from=\\"@Alpha\\"/)
    assert.match(beta[0].text, /Prüfe die Datei x/)
    const alphaAfter = prompts.filter((p) => p.who === "Alpha").at(-1)!
    assert.match(alphaAfter.text, /reply=\\"true\\"/)
    assert.doesNotMatch(prompts.map((p) => p.text).join(), /data-orbi-message/)
  } finally {
    // DB bleibt für den nächsten Test offen (after unten räumt auf)
  }
})

after(() => {
  db.$client.close()
  rmSync(dir, { recursive: true, force: true })
})

test("Stopp im Root-Chat bricht den laufenden Orbi des Auftrags ab, ohne dass jemand geweckt wird", async () => {
  db.insert(bots).values([
    { id: "gamma", userId: "local", thirdPartyId: "x", name: "Gamma", job: "Hauptorbi" },
    { id: "delta", userId: "local", thirdPartyId: "x", name: "Delta", job: "Lang" },
  ]).run()
  db.insert(chats).values([{ id: "chat-c", userId: "local" }, { id: "chat-d", userId: "local" }]).run()
  db.insert(chatMembers).values([{ chatId: "chat-c", botId: "gamma" }, { chatId: "chat-d", botId: "delta" }]).run()
  const store = createMessageStore(db)
  const runtime = createChatRuntime(store)
  const user: UIMessage = { id: "u2", role: "user", parts: [{ type: "text", text: "Starte Delta" }] }
  const handle = createTurnHandler(store, runtime.runRoot)
  const release = runtime.reserveRoot("chat-c")!
  runtime.turns.start(
    "chat-c",
    (signal) =>
      handle({
        chatId: "chat-c",
        // Consti hat Sonnet ausdrücklich gewählt: auch der geweckte Delta nutzt es.
        body: { messages: [user], clientData: { model: "claude-sonnet-5-5", effort: "low", modelPinned: true } },
        signal,
      }),
    release
  )
  await started.promise
  assert.equal(runtime.turns.isRunning("chat-d"), true)
  assert.deepEqual(usedModels.slice(3), ["claude-sonnet-5-5", "claude-sonnet-5-5"])
  // Root-Turn von Gamma ist schon zu Ende, Delta läuft noch: Stopp im Root-Chat muss die Kette trotzdem treffen.
  while (runtime.turns.isRunning("chat-c")) await new Promise((r) => setTimeout(r, 10))
  assert.equal(runtime.stopRoot("chat-c"), true)
  const until = Date.now() + 5000
  while (runtime.turns.isRunning("chat-d") && Date.now() < until) await new Promise((r) => setTimeout(r, 20))
  assert.equal(runtime.turns.isRunning("chat-d"), false)
  await new Promise((r) => setTimeout(r, 100))
  const c = (await store.listMessages("chat-c")).map((m) => readLine(m)?.status ?? m.role)
  const d = (await store.listMessages("chat-d")).map((m) => readLine(m)?.status ?? m.role)
  assert.deepEqual(c, ["user", "assistant", "fehlgeschlagen"]) // kein Weckruf, keine Antwortzeile
  assert.equal(d[0], "fehlgeschlagen")
  assert.equal(d.includes("fertig"), false)
  assert.equal(runtime.dispatcher.snapshot().tasks, 0)
})
