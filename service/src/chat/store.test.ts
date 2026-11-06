import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import type { UIMessage } from "ai"

import { openDatabase } from "@/lib/db/client"
import { chats, chatMessagesIndex } from "@/lib/db/schema"
import { lineMessage, readLine, type OrbiLine } from "@/lib/chat/orbi-message"
import { createMessageStore } from "./store"

test("Verlauf bleibt nach Wiederöffnen erhalten, Regeneration ersetzt und Leeren entfernt Suchtreffer", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orbitd-store-"))
  const path = join(dir, "orbit.sqlite")
  const db = openDatabase(path)
  try {
    db.insert(chats)
      .values([
        { id: "chat", userId: "local" },
        { id: "foreign", userId: "other" },
      ])
      .run()
    const store = createMessageStore(db)
    assert.equal(await store.ownsChat("foreign"), false)
    await assert.rejects(store.listMessages("foreign"), /Chat nicht gefunden/)
    await store.saveMessages("chat", [
      { id: "user", role: "user", parts: [{ type: "text", text: "Merkur" }] },
      {
        id: "answer",
        role: "assistant",
        metadata: { botId: "bot", startedAt: 123456789 },
        parts: [
          { type: "text", text: "Antwort" },
          {
            type: "tool-web_search",
            toolCallId: "tool",
            state: "output-available",
            input: { query: "Merkur" },
            output: { sources: [] },
          },
        ],
      },
    ])
    const reopened = openDatabase(path)
    try {
      const loaded = await createMessageStore(reopened).listMessages("chat")
      assert.equal(loaded.length, 2)
      assert.equal(loaded[1].parts[1].type, "tool-web_search")
      assert.equal(loaded[1].metadata?.botId, "bot")
      const createdAt = loaded[0].metadata?.createdAt
      assert.equal(typeof createdAt, "number")
      await store.saveMessages("chat", [
        loaded[0],
        {
          id: "new-answer",
          role: "assistant",
          parts: [{ type: "text", text: "Neu" }],
        },
      ])
      assert.equal((await store.listMessages("chat"))[0].metadata?.createdAt, createdAt)
      assert.deepEqual(
        (await store.listMessages("chat")).map((m) => m.id),
        ["user", "new-answer"]
      )
      await assert.rejects(
        store.saveMessages("foreign", loaded),
        /Chat nicht gefunden/
      )
      await store.clearMessages("chat")
      assert.deepEqual(await store.listMessages("chat"), [])
      assert.equal(db.select().from(chatMessagesIndex).all().length, 0)
    } finally {
      reopened.$client.close()
    }
  } finally {
    db.$client.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("Zeilen: anhängen ohne den Verlauf zu ersetzen, Status ändern, Turn-Ende-Speichern verliert sie nicht", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orbitd-lines-"))
  const db = openDatabase(join(dir, "orbit.sqlite"))
  try {
    db.insert(chats).values({ id: "chat", userId: "local" }).run()
    const store = createMessageStore(db)
    const line = (text: string): OrbiLine => ({
      v: 1, linkId: "l", direction: "out", kind: "message",
      peer: { id: "b", name: "Rex", avatar: "x", color: null },
      text, priority: true, status: "arbeitet", token: "t", rootTaskId: "task", createdAt: 1,
    })
    const user: UIMessage = { id: "u", role: "user", parts: [{ type: "text", text: "Hi" }] }
    await store.saveMessages("chat", [user])
    // Turn läuft mit Schnappschuss [user]; währenddessen kommt eine Zeile dazu und wird später aktualisiert.
    const id = await store.appendLine("chat", line("an Rex"))
    await store.patchLine("chat", id, { status: "fertig", queued: false })
    const answer: UIMessage = { id: "a", role: "assistant", parts: [{ type: "text", text: "Antwort" }] }
    // Der Schnappschuss kennt die Zeile mit altem Stand (z. B. weil der Turn sie gesehen hat): der DB-Stand gewinnt.
    await store.saveMessages("chat", [user, lineMessage(line("an Rex"), id), answer], { merge: true })
    const loaded = await store.listMessages("chat")
    assert.deepEqual(loaded.map((m) => m.id), ["u", id, "a"])
    assert.equal(readLine(loaded[1])?.status, "fertig")
    // Zeile, die der Schnappschuss nicht kennt, bleibt hinten erhalten
    const late = await store.appendLine("chat", line("später"))
    await store.saveMessages("chat", [user, answer], { merge: true })
    assert.deepEqual((await store.listMessages("chat")).map((m) => m.id), ["u", "a", id, late])
    // Ohne merge (Regeneration, Leeren) ersetzt der Schnappschuss alles
    await store.saveMessages("chat", [user])
    assert.deepEqual((await store.listMessages("chat")).map((m) => m.id), ["u"])
    assert.equal(await store.patchLine("chat", "gibt-es-nicht", { status: "fertig" }), null)
    // Zeilen sind nicht durchsuchbar und gehören nicht in den Suchindex
    assert.equal(db.select().from(chatMessagesIndex).all().some((r) => r.body.includes("an Rex")), false)
  } finally {
    db.$client.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("Neustart: Zeilen mit arbeitet/wartet/queued werden unklar, fertige und normale Nachrichten bleiben", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orbitd-stale-"))
  const path = join(dir, "orbit.sqlite")
  const db = openDatabase(path)
  try {
    db.insert(chats).values({ id: "chat", userId: "local" }).run()
    const store = createMessageStore(db)
    const line = (status: OrbiLine["status"], extra: Partial<OrbiLine> = {}): OrbiLine => ({
      v: 1, linkId: status, direction: "in", kind: "message",
      peer: { id: "b", name: "Rex", avatar: "x", color: null },
      text: "t", priority: true, status, token: "t", rootTaskId: "task", createdAt: 1, ...extra,
    })
    await store.saveMessages("chat", [{ id: "u", role: "user", parts: [{ type: "text", text: "arbeitet" }] }])
    const working = await store.appendLine("chat", line("arbeitet", { queued: true }))
    const waiting = await store.appendLine("chat", line("wartet"))
    const held = await store.appendLine("chat", line("arbeitet", { held: true, priority: false }))
    const done = await store.appendLine("chat", line("fertig"))
    const failed = await store.appendLine("chat", line("fehlgeschlagen"))
    assert.equal(await store.settleStaleLines(), 3)
    const list = await store.listMessages("chat")
    const by = (id: string) => readLine(list.find((m) => m.id === id)!)!
    assert.equal(by(working).status, "unklar")
    assert.equal(by(working).queued, false)
    assert.equal(by(waiting).status, "unklar")
    assert.equal(by(held).status, "unklar")
    assert.equal(by(held).held, true) // bleibt für den Empfänger lesbar
    assert.equal(by(done).status, "fertig")
    assert.equal(by(failed).status, "fehlgeschlagen")
    assert.equal((list[0]!.parts[0] as { text: string }).text, "arbeitet")
    assert.equal(await store.settleStaleLines(), 0)
  } finally {
    db.$client.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test("Roher Werkzeugaufruf-Text wird beim Speichern und Lesen aus Orbi-Antworten entfernt, Nutzertext bleibt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orbitd-store-markup-"))
  const db = openDatabase(join(dir, "orbit.sqlite"))
  try {
    db.insert(chats).values([{ id: "chat", userId: "local" }]).run()
    const store = createMessageStore(db)
    const raw = `<invoke name="read_skill"><parameter name="name">a/orbit-app</parameter></invoke>`
    await store.saveMessages("chat", [
      { id: "u", role: "user", parts: [{ type: "text", text: `Was ist ${raw}?` }] },
      { id: "a", role: "assistant", parts: [{ type: "text", text: `Ich lese nach. ${raw}` }] },
      { id: "b", role: "assistant", parts: [{ type: "text", text: raw }, { type: "text", text: "Fertig." }] },
    ])
    await store.upsertMessage("chat", { id: "c", role: "assistant", parts: [{ type: "text", text: `Halb <function_calls><invoke name="x">` }] })
    const loaded = await store.listMessages("chat")
    const texts = loaded.map((m) => m.parts.map((p) => (p.type === "text" ? p.text : p.type)).join("|"))
    assert.deepEqual(texts, [`Was ist ${raw}?`, "Ich lese nach. ", "Fertig.", "Halb "])
  } finally {
    db.$client.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
