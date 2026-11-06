import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { after, test } from "node:test"

const dir = mkdtempSync(join(tmpdir(), "orbit-library-"))
process.env.ORBIT_DATA_DIR = dir
const { botLibrary } = await import("./library.ts")
const { getDatabase } = await import("@/lib/db/client")
const database = getDatabase()
const sql = database.$client
sql.exec(`
  insert into bots (id,user_id,third_party_id,name,job,avatar) values
    ('a','local','a','A','J','erdi'),('b','local','b','B','J','erdi'),('foreign','other','c','C','J','erdi');
  insert into chats (id,user_id,kind) values
    ('direct','local','direct'),('group','local','group'),('routine','local','automation'),('foreign','other','direct');
  insert into chat_members (chat_id,bot_id) values
    ('direct','a'),('group','a'),('group','b'),('routine','a'),('foreign','a');
`)
after(() => {
  sql.close()
  rmSync(dir, { recursive: true, force: true })
})
const part = (type: string, input: unknown, output: unknown) => ({
  type: `tool-${type}`,
  state: "output-available",
  input,
  output,
})
const write = (path = "report.txt", content = "produced") =>
  part(
    "write_file",
    { path, content },
    { path, bytes: Buffer.byteLength(content) }
  )
const share = (
  path = "report.txt",
  content = "produced",
  filename = "report.txt"
) =>
  part(
    "share_file",
    { path },
    {
      filename,
      mediaType: "text/plain",
      size: Buffer.byteLength(content),
      data: Buffer.from(content).toString("base64"),
    }
  )
let position = 0
const message = (
  chatId: string,
  parts: unknown[],
  metadata: unknown = null,
  role = "assistant"
) => {
  const i = ++position
  sql
    .prepare(
      "insert into chat_messages (chat_id,id,role,parts,metadata,position,created_at) values (?,?,?,?,?,?,?)"
    )
    .run(
      chatId,
      `m${i}`,
      role,
      JSON.stringify(parts),
      metadata === null ? null : JSON.stringify(metadata),
      i,
      i
    )
}

test("Bibliothek: Besitz, direkter/Gruppe/Routine-Sender und belegte Erzeugung", () => {
  message("direct", [write(), share()])
  message("group", [write(), share()], { botId: "b" })
  message("group", [write(), share()])
  message("group", [write(), share()], { botId: "a" })
  message("routine", [write(), share()])
  message("foreign", [write(), share()], { botId: "a" })
  message("direct", [write(), share()], null, "user")
  const result = botLibrary("a", undefined, database)
  assert.ok("files" in result)
  assert.equal(result.files.length, 3)
  assert.deepEqual(
    new Set(result.files.map((file) => file.chatId)),
    new Set(["direct", "group", "routine"])
  )
  assert.ok(result.files.every((file) => !("data" in file)))
  const download = botLibrary("a", result.files[0].id, database)
  assert.ok("file" in download)
  assert.equal(download.file.data, Buffer.from("produced").toString("base64"))
  assert.equal(botLibrary("b", result.files[0].id, database).ok, false)
  assert.equal(botLibrary("foreign", undefined, database).ok, false)
  assert.equal(botLibrary("absent", undefined, database).ok, false)
})

test("Bibliothek: ausdrücklich geteilte Dateien werden erfasst, ungültige Ausgaben nicht", () => {
  const before = botLibrary("a", undefined, database)
  assert.ok("files" in before)
  message("direct", [share("found.txt")])
  message("direct", [
    write("/home/daytona/uploads/input.txt"),
    share("/home/daytona/uploads/input.txt"),
  ])
  message("direct", [write("changed.txt"), share("changed.txt", "different")])
  message("direct", [
    write("unsafe.txt"),
    share("unsafe.txt", "produced", "../secret"),
  ])
  message("direct", [
    write("failed.txt"),
    { ...share("failed.txt"), state: "output-error" },
  ])
  message("direct", [
    write("invalid.txt"),
    part(
      "share_file",
      { path: "invalid.txt" },
      {
        filename: "invalid.txt",
        mediaType: "text/plain",
        size: 8,
        data: "!!!!",
      }
    ),
  ])
  message("direct", [write(), share()], { botId: "b" })
  const after = botLibrary("a", undefined, database)
  assert.ok("files" in after)
  assert.equal(after.files.length, before.files.length + 3)
  assert.equal(
    after.files.filter((file) => file.filename === "../secret").length,
    0
  )
  assert.equal(
    after.files.filter((file) => file.filename === "invalid.txt").length,
    0
  )
})

test("Bibliothek: erfolgreiche generierte Bilder, begrenzte Bytes und stabile Datei-ID", () => {
  message(
    "group",
    [
      part(
        "generate_image",
        {},
        {
          ok: true,
          mediaType: "image/jpeg",
          data: Buffer.from([255, 216, 255, 217]).toString("base64"),
        }
      ),
    ],
    { botId: "a", finishedAt: 1234 }
  )
  message(
    "group",
    [
      part(
        "generate_image",
        {},
        { ok: false, mediaType: "image/jpeg", data: "/9j/2Q==" }
      ),
    ],
    { botId: "a" }
  )
  const result = botLibrary("a", undefined, database)
  assert.ok("files" in result)
  const image = result.files.find((file) => file.kind === "image")!
  assert.equal(image.size, 4)
  assert.equal(image.createdAt, 1234)
  assert.equal(image.filename, "Bild.jpg")
  assert.ok("file" in botLibrary("a", image.id, database))
  message("direct", [
    part(
      "generate_image",
      {},
      { ok: true, mediaType: "image/jpeg", data: "A".repeat(8 * 1024 * 1024) }
    ),
  ])
  const bounded = botLibrary("a", undefined, database)
  assert.ok("files" in bounded)
  assert.equal(bounded.truncated, false)
  assert.equal(bounded.files.length, result.files.length)
})

test("PDF aus dem Dokumentwerkzeug erscheint in der Bibliothek", () => {
  const bytes = Buffer.from("%PDF-1.4\nTest")
  message("direct", [
    part(
      "create_pdf",
      {},
      {
        filename: "test.pdf",
        mediaType: "application/pdf",
        size: bytes.length,
        data: bytes.toString("base64"),
      }
    ),
  ])
  const result = botLibrary("a", undefined, database)
  assert.ok("files" in result)
  const pdf = result.files.find((file) => file.filename === "test.pdf")
  assert.ok(pdf)
  const stored = botLibrary("a", pdf.id, database)
  assert.ok("file" in stored)
  assert.equal(stored.file.data, bytes.toString("base64"))
})

test("Word-Datei aus dem Dokumentwerkzeug erscheint in der Bibliothek", () => {
  const bytes = Buffer.from("PK\x03\x04word")
  message("direct", [part("create_word", {}, {
    filename: "test.docx", mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: bytes.length, data: bytes.toString("base64"),
  })])
  const result = botLibrary("a", undefined, database)
  assert.ok("files" in result)
  const word = result.files.find((file) => file.filename === "test.docx")
  assert.ok(word)
  const stored = botLibrary("a", word.id, database)
  assert.ok("file" in stored)
  assert.equal(stored.file.data, bytes.toString("base64"))
})

test("REST-Bibliothek: Token, metadatenfreie Liste, Download und fremder Orbi", async () => {
  const { createApp } = await import("./app.ts")
  const { registerApiRoutes } = await import("./routes.ts")
  const app = createApp({
    token: "library-test",
    port: 4319,
    store: {
      ownsChat: async () => true,
      listMessages: async () => [],
      clearMessages: async () => {},
    },
    runTurn: async () => new Response(null),
    routes: (hono) => registerApiRoutes(hono, { start: () => null }),
  })
  const request = (path: string, authenticated = true) =>
    app.request(`http://127.0.0.1:4319${path}`, {
      headers: {
        host: "127.0.0.1:4319",
        ...(authenticated ? { authorization: "Bearer library-test" } : {}),
      },
    })
  assert.equal((await request("/v1/bots/a/library", false)).status, 401)
  const list = await request("/v1/bots/a/library")
  assert.equal(list.status, 200)
  const body = (await list.json()) as { files: { id: string; data?: string }[] }
  assert.ok(body.files.length > 0)
  assert.equal(body.files[0].data, undefined)
  const download = await request(`/v1/bots/a/library/${body.files[0].id}`)
  assert.equal(download.status, 200)
  assert.equal(
    typeof ((await download.json()) as { file: { data: string } }).file.data,
    "string"
  )
  assert.equal((await request("/v1/bots/foreign/library")).status, 404)
  assert.equal(
    (await request(`/v1/bots/b/library/${body.files[0].id}`)).status,
    404
  )
})

test("Übergabedateien gehören dem ausführenden Orbi, auch verschachtelt und ohne Chatmitgliedschaft", () => {
  const beforeA = botLibrary("a", undefined, database)
  const beforeB = botLibrary("b", undefined, database)
  assert.ok("files" in beforeA && "files" in beforeB)
  const nested = {
    id: "hidden-answer",
    role: "assistant",
    metadata: { botId: "b", finishedAt: 8765 },
    parts: [
      share("hidden.txt", "handoff", "hidden.txt"),
      part(
        "generate_image",
        {},
        {
          ok: true,
          mediaType: "image/jpeg",
          data: "/9j/2Q==",
        }
      ),
    ],
  }
  const handoff = part(
    "handoff",
    {},
    { sourceChatId: "handoff-hidden", message: nested }
  )
  message(
    "direct",
    [
      part(
        "handoff",
        {},
        {
          message: {
            id: "middle",
            role: "assistant",
            metadata: { botId: "a" },
            parts: [handoff],
          },
        }
      ),
    ],
    { botId: "a" }
  )
  message("direct", [handoff], { botId: "a" })
  const a = botLibrary("a", undefined, database)
  const b = botLibrary("b", undefined, database)
  assert.ok("files" in a && "files" in b)
  assert.equal(a.files.length, beforeA.files.length)
  assert.equal(b.files.length, beforeB.files.length + 2)
  assert.equal(
    b.files.find((f) => f.filename === "hidden.txt")?.createdAt,
    8765
  )
})

test("Sichtbarer Zielchat und weitergereichte Ausgabe ergeben dieselbe Datei-ID", () => {
  const before = botLibrary("b", undefined, database)
  assert.ok("files" in before)
  const original = ++position
  sql
    .prepare(
      "insert into chat_messages (chat_id,id,role,parts,metadata,position,created_at) values (?,?,?,?,?,?,?)"
    )
    .run(
      "group",
      "visible-answer",
      "assistant",
      JSON.stringify([share("visible.txt", "visible", "visible.txt")]),
      JSON.stringify({ botId: "b" }),
      original,
      original
    )
  message(
    "direct",
    [
      part(
        "handoff",
        {},
        {
          sourceChatId: "group",
          message: {
            id: "visible-answer",
            role: "assistant",
            metadata: { botId: "b" },
            parts: [share("visible.txt", "visible", "visible.txt")],
          },
        }
      ),
    ],
    { botId: "a" }
  )
  const result = botLibrary("b", undefined, database)
  assert.ok("files" in result)
  assert.equal(result.files.length, before.files.length + 1)
})

test("Ungültige oder zu tief verschachtelte Übergaben werden nicht indexiert", () => {
  const before = botLibrary("b", undefined, database)
  assert.ok("files" in before)
  const wrap = (
    parts: unknown[],
    metadata: unknown = { botId: "b" },
    role = "assistant"
  ) =>
    part("handoff", {}, { message: { id: "bounded", role, metadata, parts } })
  message("direct", [
    wrap([share()], {}),
    wrap([share()], { botId: "b" }, "user"),
  ])
  let deep = share()
  for (let i = 0; i < 10; i++) deep = wrap([deep])
  message("direct", [deep])
  const result = botLibrary("b", undefined, database)
  assert.ok("files" in result)
  assert.equal(result.files.length, before.files.length)
  assert.equal(result.truncated, true)
})

test("Ausgelassene große Nachrichten und Partgrenzen werden als unvollständig gemeldet", () => {
  message("direct", [
    share(),
    { type: "text", text: "x".repeat(32 * 1024 * 1024) },
  ])
  message("direct", [
    ...Array.from({ length: 1000 }, () => ({ type: "text", text: "" })),
    share(),
  ])
  const result = botLibrary("a", undefined, database)
  assert.ok("files" in result)
  assert.equal(result.truncated, true)
})
