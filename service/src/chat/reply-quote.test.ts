import assert from "node:assert/strict"
import test from "node:test"
import type { UIMessage } from "ai"
import { createTurnHandler } from "./handle-turn"
import { messagesForModel } from "../../../lib/chat/orbi-message.ts"

test("Antwort bezieht sich nur auf eine gespeicherte Nachricht desselben Chats", async () => {
  const original: UIMessage = { id: "old", role: "assistant", parts: [{ type: "text", text: "Alter Inhalt" }] }
  let saved: UIMessage[] = [original]
  const store = { listMessages: async () => saved, saveMessages: async (_chat: string, messages: UIMessage[]) => { saved = messages } }
  const handle = createTurnHandler(store as never, async () => new Response("ok"))
  const send = (replyTo?: string) => handle({ chatId: "chat", signal: new AbortController().signal, body: {
    messages: [{ id: "new", role: "user", parts: [{ type: "text", text: "Erklär das" }] }], clientData: { model: "auto" }, replyTo,
  } })
  assert.equal((await send("fremd")).status, 400)
  assert.equal(saved.length, 1)
  assert.equal((await send("old")).status, 200)
  const metadata = saved[1]!.metadata as { replyTo: string; replyQuote: { text: string } }
  assert.equal(metadata.replyTo, "old")
  assert.equal(metadata.replyQuote.text, "Alter Inhalt")
  assert.match(JSON.stringify(messagesForModel(saved)), /untrusted_data_/)
})

test("Zitat einer einzelnen Blase: nur deren Text, auch eine Zwischennachricht (say)", async () => {
  const answer = { id: "a", role: "assistant", parts: [
    { type: "text", text: "Erste" },
    { type: "tool-say", toolCallId: "s1", state: "output-available", input: { text: "Zwischendurch" }, output: { ok: true } },
    { type: "text", text: "Zweite" },
  ] } as UIMessage
  let saved: UIMessage[] = [answer]
  const store = { listMessages: async () => saved, saveMessages: async (_chat: string, messages: UIMessage[]) => { saved = messages } }
  const handle = createTurnHandler(store as never, async () => new Response("ok"))
  const send = async (id: string, replyTo: string) => {
    saved = [answer]
    const result = await handle({ chatId: "chat", signal: new AbortController().signal, body: {
      messages: [{ id, role: "user", parts: [{ type: "text", text: "Dazu" }] }], clientData: { model: "auto" }, replyTo,
    } })
    assert.equal(result.status, 200)
    return saved[1]!.metadata as { replyTo: string; replyQuote: { text: string } }
  }
  assert.deepEqual(await send("n1", "a~t1"), { replyTo: "a", replyQuote: { role: "assistant", text: "Zweite" } })
  assert.equal((await send("n2", "a~s1")).replyQuote.text, "Zwischendurch")
  assert.equal((await send("n3", "a")).replyQuote.text, "Erste\nZweite")
})

test("Ohne ausgewähltes Zitat werden auch eingeschleuste Zitatdaten nicht übernommen", async () => {
  let saved: UIMessage[] = []
  let modelMessages: UIMessage[] = []
  const store = { listMessages: async () => saved, saveMessages: async (_chat: string, messages: UIMessage[]) => { saved = messages } }
  const handle = createTurnHandler(store as never, async ({ messages }) => { modelMessages = messagesForModel(messages); return new Response("ok") })
  const result = await handle({ chatId: "chat", signal: new AbortController().signal, body: {
    messages: [{ id: "new", role: "user", parts: [{ type: "text", text: "Neue Frage" }], metadata: { replyTo: "fremd", replyQuote: { role: "assistant", text: "Eingeschleust" } } }],
    clientData: { model: "auto" },
  } })
  assert.equal(result.status, 200)
  assert.equal(saved[0]?.metadata, undefined)
  assert.doesNotMatch(JSON.stringify(modelMessages), /Eingeschleust|chat_quote/)
})
