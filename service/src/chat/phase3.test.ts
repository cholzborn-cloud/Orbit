import "./fixtures/temp-data.ts"
import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import type { UIMessage } from "ai"

import { openDatabase } from "@/lib/db/client"
import { chats } from "@/lib/db/schema"
import { createSayTool } from "@/lib/chat/say"
import { createReactTool, reactionNote } from "@/lib/chat/reactions"
import { mergeInstructions } from "@/lib/chat/onboarding"
import { withFileCards, isCodeFile } from "@/lib/chat/file-cards"
import { createMessageStore } from "./store"
import { checkpointMessage } from "./turn"
import { answerFromReaction } from "./reaction-routes"

const opts = { toolCallId: "t", messages: [] } as never

test("say: ok, Kurztext, höchstens 5 je Turn", async () => {
  const say = createSayTool(() => 7)
  for (let i = 0; i < 5; i++)
    assert.deepEqual(await say.execute!({ text: "Hi" }, opts), { ok: true, at: 7 })
  assert.deepEqual(await say.execute!({ text: "Hi" }, opts), { ok: false, error: "Fasse am Ende zusammen." })
})

test("react: Standard ist die letzte Nutzer-Nachricht", async () => {
  const calls: string[] = []
  const react = createReactTool({
    lastUserMessageId: () => "u1",
    set: async (id, emoji) => (calls.push(`${id}${emoji}`), { ok: true }),
  })
  await react.execute!({ emoji: "👍" }, opts)
  await react.execute!({ emoji: "✅", message_id: "m2" }, opts)
  assert.deepEqual(calls, ["u1👍", "m2✅"])
})

test("Store: Zwischenspeichern, Reaktionen ersetzen, überleben saveMessages, Leeren entfernt sie", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orbitd-p3-"))
  const db = openDatabase(join(dir, "orbit.sqlite"))
  try {
    db.insert(chats).values({ id: "c", userId: "local" }).run()
    const store = createMessageStore(db)
    const user: UIMessage = { id: "u", role: "user", parts: [{ type: "text", text: "Hallo" }] }
    await store.saveMessages("c", [user])
    const partial: UIMessage = {
      id: "a",
      role: "assistant",
      parts: [{ type: "tool-say", toolCallId: "s", state: "output-available", input: { text: "Mach ich" }, output: { ok: true, at: 1 } } as never],
    }
    await store.upsertMessage("c", partial)
    await store.upsertMessage("c", { ...partial, parts: [...partial.parts, { type: "text", text: "Fertig" }] })
    const listed = await store.listMessages("c")
    assert.deepEqual(listed.map((m) => m.id), ["u", "a"])
    assert.equal(listed[1].parts.length, 2)

    assert.equal(await store.setReaction("c", "u", "bot", "👍"), true)
    assert.equal(await store.setReaction("c", "u", "bot", "✅"), true)
    assert.equal(await store.setReaction("c", "u", "user", "❤️"), true)
    assert.equal(await store.setReaction("c", "nix", "bot", "👍"), false)
    // Einzelne Blase einer Antwort: Schlüssel `<id>~…`, die Nachricht muss existieren.
    assert.equal(await store.setReaction("c", "a~t0", "user", "👍"), true)
    assert.equal(await store.setReaction("c", "nix~t0", "user", "👍"), false)
    assert.equal(await store.setReaction("c", "live", "user", "👍", { requireExisting: false }), true)
    await store.saveMessages("c", listed)
    const reactions = await store.listReactions("c")
    assert.deepEqual(reactions.filter((r) => r.messageId === "u").map((r) => `${r.actor}${r.emoji}`).sort(), ["botBot".replace("botBot", "bot✅"), "user❤️"].sort())
    assert.equal(await store.removeReaction("c", "u", "user"), true)
    await store.clearMessages("c")
    assert.deepEqual(await store.listReactions("c"), [])
  } finally {
    db.$client.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("Zwischenstand lässt unfertige Werkzeugteile weg und schweigt ohne Sichtbares", () => {
  const msg = (parts: unknown[]) => ({ id: "a", role: "assistant", parts }) as UIMessage
  assert.equal(checkpointMessage(msg([{ type: "step-start" }])), null)
  const kept = checkpointMessage(
    msg([
      { type: "text", text: "Hi" },
      { type: "tool-bash", toolCallId: "1", state: "input-available", input: {} },
      { type: "tool-say", toolCallId: "2", state: "output-available", input: {}, output: {} },
    ])
  )!
  assert.deepEqual(kept.parts.map((p) => p.type), ["text", "tool-say"])
})

test("👍/👎 beantworten eine einzelne Karte eindeutig", () => {
  const ask = (options: { label: string; recommended?: boolean }[], n = 1) => ({
    input: { questions: Array.from({ length: n }, () => ({ question: "Q?", options })) },
  })
  assert.deepEqual(answerFromReaction(ask([{ label: "Ja" }, { label: "Nein" }]), "👍"), [{ question: "Q?", answers: ["Ja"] }])
  assert.deepEqual(answerFromReaction(ask([{ label: "Ja" }, { label: "Nein" }]), "👎"), [{ question: "Q?", answers: ["Nein"] }])
  assert.deepEqual(answerFromReaction(ask([{ label: "A" }, { label: "B", recommended: true }]), "👍"), [{ question: "Q?", answers: ["B"] }])
  assert.equal(answerFromReaction(ask([{ label: "A" }, { label: "B", recommended: true }]), "👎"), null)
  assert.equal(answerFromReaction(ask([{ label: "Ja" }, { label: "Nein" }], 2), "👍"), null)
  assert.equal(answerFromReaction(ask([{ label: "Ja" }, { label: "Nein" }]), "😂"), null)
})

test("Reaktions-Info nur für neue Reaktionen von Consti", () => {
  const messages = [
    { id: "u", role: "user", parts: [{ type: "text", text: "Danke" }] },
    { id: "a", role: "assistant", parts: [], metadata: { finishedAt: 100 } },
  ]
  const r = (createdAt: number, actor = "user") => ({ messageId: "u", actor, emoji: "👍" as const, createdAt })
  assert.equal(reactionNote(messages, [r(50), r(120, "bot")]), "")
  assert.match(reactionNote(messages, [r(150)]), /👍 on "Danke"/)
  const answer = {
    id: "b",
    role: "assistant",
    parts: [
      { type: "text", text: "Erste" },
      { type: "tool-say", toolCallId: "s1", input: { text: "Zwischendurch" } },
      { type: "text", text: "Zweite" },
    ],
  }
  const on = (messageId: string) => reactionNote([...messages, answer], [{ messageId, actor: "user", emoji: "👍", createdAt: 150 }])
  assert.match(on("b~t1"), /on "Zweite"/)
  assert.match(on("b~s1"), /on "Zwischendurch"/)
  assert.match(on("b"), /on "Erste Zweite"/)
})

test("Onboarding hängt an, überschreibt nie, hält die Grenze", () => {
  const bot = { job: "Recherche", is_main: false }
  assert.equal(mergeInstructions("Alt", bot, ""), "Alt")
  assert.equal(mergeInstructions("Alt", bot, "Neu"), "Alt\nNeu")
  const fromDefault = mergeInstructions(null, bot, "Neu")!
  assert.ok(fromDefault.startsWith("Du recherchierst") && fromDefault.endsWith("\nNeu"))
  assert.ok(mergeInstructions("x".repeat(900), bot, "y".repeat(600))!.length <= 1000)
  assert.equal(mergeInstructions("x".repeat(990), bot, "y".repeat(600)), "x".repeat(990))
})

test("Dateikarten: genau eine je Datei, keine für Code oder Pfade außerhalb des Ausgabeordners", async () => {
  const cards: string[] = []
  const ok = async () => "ok"
  const tools = withFileCards(
    { create_file: { execute: ok }, write_file: { execute: ok }, brain_write: { execute: async () => "<brain_result>x</brain_result>" } } as never,
    { emit: (c) => cards.push(c.path), read: async (path) => ({ path, filename: "f", mediaType: "x", size: 1, data: "" }) }
  ) as Record<string, { execute: (i: unknown, o: unknown) => Promise<unknown> }>
  await tools.create_file.execute({ path: "output/a.txt", content: "x" }, opts)
  await tools.write_file.execute({ path: "output/a.txt", content: "x" }, opts)
  await tools.write_file.execute({ path: "output/code.ts", content: "x" }, opts)
  await tools.write_file.execute({ path: "tmp/b.txt", content: "x" }, opts)
  await tools.brain_write.execute({ path: "01 Inbox/N.md", content: "# N", mode: "create" }, opts)
  await tools.brain_write.execute({ path: "01 Inbox/N.md", content: "mehr", mode: "append" }, opts)
  assert.deepEqual(cards, ["output/a.txt", "01 Inbox/N.md"])
  assert.equal(isCodeFile("output/x.swift"), true)
})

