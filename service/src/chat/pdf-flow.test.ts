import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"

import { renderPdf } from "../../../lib/chat/pdf-tool.ts"
import { openDatabase } from "../../../lib/db/client.ts"
import { botLibrary } from "../library.ts"
import { createMessageStore } from "./store.ts"

test("Echtes PDF bleibt vom Chat über Bibliothek und Download bis nach Leeren und Wiederöffnen erhalten", async () => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-pdf-flow-"))
  const path = join(dir, "orbit.sqlite")
  let db: ReturnType<typeof openDatabase> | undefined
  try {
    const input = {
      filename: "Integration.pdf",
      text: "Orbit PDF Integrationstest\nEin lokal erzeugtes Dokument ohne Anbieter.",
    }
    const output = await renderPdf(input)
    assert.ok(!("error" in output), "Der echte PDF-Filter muss erfolgreich sein")
    const bytes = Buffer.from(output.data, "base64")
    assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-")
    assert.match(bytes.subarray(-1024).toString("ascii"), /%%EOF/)
    assert.equal(output.size, bytes.length)

    db = openDatabase(path)
    db.$client.exec(`
      insert into bots (id,user_id,third_party_id,name,job,avatar)
        values ('pdf-bot','local','pdf-bot','PDF','Dokumente','erdi');
      insert into chats (id,user_id,kind) values ('pdf-chat','local','direct');
      insert into chat_members (chat_id,bot_id) values ('pdf-chat','pdf-bot');
    `)
    const store = createMessageStore(db)
    await store.saveMessages("pdf-chat", [{
      id: "pdf-answer",
      role: "assistant",
      metadata: { botId: "pdf-bot", finishedAt: 123456789 },
      parts: [{
        type: "tool-create_pdf",
        toolCallId: "pdf-call",
        state: "output-available",
        input,
        output,
      }],
    }])
    const saved = await store.listMessages("pdf-chat")
    assert.equal(saved.length, 1)
    assert.deepEqual(saved[0].parts[0], {
      type: "tool-create_pdf",
      toolCallId: "pdf-call",
      state: "output-available",
      input,
      output,
    })
    // Vor dem ersten Bibliotheksabruf muss bereits das Speichern den Bestand sichern.
    assert.deepEqual(db.$client.prepare("select count(*) as count from bot_files").get(), { count: 1 })
    const listed = botLibrary("pdf-bot", undefined, db)
    assert.ok("files" in listed)
    assert.equal(listed.files.length, 1)
    const file = listed.files[0]
    assert.equal(file.filename, input.filename)
    assert.equal(file.mediaType, "application/pdf")
    assert.equal(file.size, bytes.length)
    assert.equal(file.chatId, "pdf-chat")
    assert.equal(file.messageId, "pdf-answer")
    assert.equal(file.createdAt, 123456789)
    assert.equal("data" in file, false)
    const download = botLibrary("pdf-bot", file.id, db)
    assert.ok("file" in download)
    assert.deepEqual(Buffer.from(download.file.data, "base64"), bytes)

    await store.clearMessages("pdf-chat")
    assert.deepEqual(await store.listMessages("pdf-chat"), [])
    db.$client.close()
    db = undefined
    db = openDatabase(path)
    assert.deepEqual(await createMessageStore(db).listMessages("pdf-chat"), [])
    const reopened = botLibrary("pdf-bot", undefined, db)
    assert.ok("files" in reopened)
    assert.deepEqual(reopened.files, [file])
    const persisted = botLibrary("pdf-bot", file.id, db)
    assert.ok("file" in persisted)
    assert.deepEqual(Buffer.from(persisted.file.data, "base64"), bytes)
  } finally {
    db?.$client.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
