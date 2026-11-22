import { createHash } from "node:crypto"

import { getDatabase } from "@/lib/db/client"

const MAX_FILE = 5 * 1024 * 1024
const MAX_MESSAGE = 32 * 1024 * 1024
const MAX_DEPTH = 8
const MAX_PARTS = 1000
const LIMITATIONS = [
  "Die Bibliothek enthält vom Orbi ausdrücklich bereitgestellte Dateien und gespeicherte Bildgenerierungen. Bereitgestellt bedeutet nicht zwingend selbst erstellt.",
  "Nutzeranhänge und nur erwähnte oder gefundene Dateien werden nicht automatisch übernommen. Geteilte Dateien bleiben auch nach dem Leeren des Chats gespeichert.",
]

type Row = {
  cursor: number
  chatId: string
  messageId: string
  kind: string
  members: number
  soleBot: string | null
  parts: string | null
  metadata: string | null
  createdAt: number
}
type File = {
  id: string
  filename: string
  mediaType: string
  size: number
  chatId: string
  messageId: string
  createdAt: number
  kind: "file" | "image"
  data: string
}
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
const parse = (value: string | null): unknown => {
  try {
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}
const bytesOf = (value: unknown) => {
  if (
    typeof value !== "string" ||
    value.length > 4 * Math.ceil(MAX_FILE / 3) ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    return null
  const bytes = Buffer.from(value, "base64")
  return bytes.length <= MAX_FILE && bytes.toString("base64") === value
    ? bytes
    : null
}

function indexLibrary(
  botId: string,
  database: ReturnType<typeof getDatabase>,
  chatId?: string
) {
  const sqlite = database.$client
  const insert = sqlite.prepare(`insert or ignore into bot_files
    (id, bot_id, filename, media_type, size, chat_id, message_id, created_at, kind, data)
    values (@id, @botId, @filename, @mediaType, @size, @chatId, @messageId, @createdAt, @kind, @data)`)
  const history = sqlite.prepare(
    `
    select m.rowid as cursor, m.chat_id as chatId, m.id as messageId, c.kind,
      (select count(*) from chat_members cm where cm.chat_id = c.id) as members,
      (select bot_id from chat_members cm where cm.chat_id = c.id limit 1) as soleBot,
      case when length(cast(m.parts as blob)) <= ${MAX_MESSAGE} then m.parts else null end as parts,
      case when m.metadata is null or length(m.metadata) <= 16384 then m.metadata else '{"botId":null}' end as metadata,
      m.created_at as createdAt
    from chat_messages m join chats c on c.id = m.chat_id
    where m.rowid > ? and c.user_id = 'local' and m.role = 'assistant' and (? is null or c.id = ?)
      and (instr(m.parts, '"tool-share_file"') > 0 or instr(m.parts, '"tool-generate_image"') > 0 or instr(m.parts, '"tool-create_pdf"') > 0 or instr(m.parts, '"tool-create_word"') > 0 or instr(m.parts, '"tool-handoff"') > 0)
    order by m.rowid asc limit 1
  `
  )
  let truncated = false
  let cursor = 0
  while (true) {
    const row = history.get(cursor, chatId ?? null, chatId ?? null) as
      Row | undefined
    if (!row) break
    cursor = row.cursor
    const metadata = object(parse(row.metadata))
    const sender =
      typeof metadata.botId === "string"
        ? metadata.botId
        : metadata.botId === undefined &&
            (row.kind === "direct" || row.kind === "automation") &&
            row.members === 1
          ? row.soleBot
          : null
    if (row.parts === null) {
      truncated = true
      continue
    }
    const parts = parse(row.parts)
    if (!Array.isArray(parts)) continue
    let remaining = MAX_PARTS
    const visit = (
      parts: unknown[],
      owner: unknown,
      messageId: string,
      sourceChatId: string,
      finishedAt: unknown,
      depth: number
    ) => {
      if (depth > MAX_DEPTH) {
        if (parts.length) truncated = true
        return
      }
      for (const [index, raw] of parts.entries()) {
        if (--remaining < 0) {
          truncated = true
          return
        }
        const part = object(raw)
        if (part.state !== "output-available") continue
        const output = object(part.output)
        if (part.type === "tool-handoff") {
          const nested = object(output.message)
          const meta = object(nested.metadata)
          if (
            nested.role === "assistant" &&
            typeof nested.id === "string" &&
            Array.isArray(nested.parts) &&
            typeof meta.botId === "string"
          ) {
            visit(
              nested.parts,
              meta.botId,
              nested.id,
              typeof output.sourceChatId === "string"
                ? output.sourceChatId
                : sourceChatId,
              meta.finishedAt,
              depth + 1
            )
          }
          continue
        }
        if (owner !== botId) continue
        const image =
          part.type === "tool-generate_image" &&
          output.ok === true &&
          output.mediaType === "image/jpeg"
        if (
          !image &&
          part.type !== "tool-share_file" &&
          part.type !== "tool-create_pdf" &&
          part.type !== "tool-create_word"
        )
          continue
        const bytes = bytesOf(output.data)
        if (!bytes || (!image && output.size !== bytes.length)) continue
        if (
          image &&
          (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff)
        )
          continue
        const filename = image ? "Bild.jpg" : output.filename
        if (
          typeof filename !== "string" ||
          !filename ||
          filename.length > 255 ||
          /[/\\\x00-\x1f\x7f]/.test(filename) ||
          filename === "." ||
          filename === ".."
        )
          continue
        const mediaType = output.mediaType
        if (
          typeof mediaType !== "string" ||
          mediaType.length > 127 ||
          !/^[a-zA-Z0-9!#$&^_.+-]+\/[a-zA-Z0-9!#$&^_.+-]+$/.test(mediaType)
        )
          continue
        insert.run({
          botId,
          id: createHash("sha256")
            .update(
              JSON.stringify([sourceChatId, messageId, index, output.data])
            )
            .digest("hex"),
          filename,
          mediaType,
          size: bytes.length,
          chatId: row.chatId,
          messageId: row.messageId,
          createdAt:
            typeof finishedAt === "number" && Number.isFinite(finishedAt)
              ? finishedAt
              : row.createdAt,
          kind: image ? "image" : "file",
          data: output.data as string,
        })
      }
    }
    visit(parts, sender, row.messageId, row.chatId, metadata.finishedAt, 0)
  }
  return truncated
}

export function indexChatLibrary(chatId: string, database = getDatabase()) {
  const bots = database.$client
    .prepare("select id from bots where user_id = 'local'")
    .all() as { id: string }[]
  for (const bot of bots) indexLibrary(bot.id, database, chatId)
}

export function botLibrary(
  botId: string,
  fileId?: string,
  database = getDatabase()
) {
  const sqlite = database.$client
  if (
    !sqlite
      .prepare("select 1 from bots where id = ? and user_id = 'local'")
      .get(botId)
  )
    return { ok: false as const, error: "Orbi nicht gefunden." }
  // Bestehende Verläufe werden beim ersten Abruf nachgetragen; IDs verhindern Duplikate.
  const truncated = indexLibrary(botId, database)
  const columns = `id, filename, media_type as mediaType, size, chat_id as chatId,
    message_id as messageId, created_at as createdAt, kind`
  if (fileId) {
    const file = sqlite
      .prepare(
        `select ${columns}, data from bot_files where bot_id = ? and id = ?`
      )
      .get(botId, fileId) as File | undefined
    return file
      ? { ok: true as const, file }
      : { ok: false as const, error: "Datei nicht gefunden." }
  }
  const files = sqlite
    .prepare(
      `select ${columns} from bot_files where bot_id = ? order by created_at desc, id`
    )
    .all(botId) as Omit<File, "data">[]
  return {
    ok: true as const,
    files,
    limitations: LIMITATIONS,
    truncated,
  }
}
