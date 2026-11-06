import type { UIMessage } from "ai"
import { z } from "zod"

export const searchQuerySchema = z
  .string()
  .trim()
  .min(1, "Gib einen Suchbegriff ein.")
  .max(200, "Die Suche darf höchstens 200 Zeichen lang sein.")

export function snippetParts(text: string) {
  const parts: { text: string; marked: boolean }[] = []
  let cursor = 0
  for (const match of text.matchAll(/<<([\s\S]*?)>>/g)) {
    const start = match.index ?? 0
    if (start > cursor)
      parts.push({ text: text.slice(cursor, start), marked: false })
    parts.push({ text: match[1], marked: true })
    cursor = start + match[0].length
  }
  if (cursor < text.length)
    parts.push({ text: text.slice(cursor), marked: false })
  return parts.length ? parts : [{ text, marked: false }]
}

export type MessageIndexRow = {
  id: string
  userId: string
  chatId: string
  role: "user" | "assistant"
  body: string
  createdAt: Date
}

const messageTime = (message: UIMessage, fallbackTime: Date) => {
  const metadata = message.metadata as
    { startedAt?: string | number; finishedAt?: string | number } | undefined
  const value = metadata?.startedAt ?? metadata?.finishedAt
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime()) ? date : fallbackTime
}

export function messagesToRows({
  userId,
  chatId,
  messages,
  fallbackTime,
}: {
  userId: string
  chatId: string
  messages: UIMessage[]
  fallbackTime: Date
}): MessageIndexRow[] {
  return messages.flatMap((message) => {
    if (message.role !== "user" && message.role !== "assistant") return []
    const body = message.parts
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .replace(/^\[[^\]\n]+\]:\s*/gm, "")
      .replace(/\n*```options[ \t]*\n[\s\S]*?(?:\n```\s*|$)/g, "")
      .trim()
      .slice(0, 20000)
    return body
      ? [
          {
            id: `${chatId}:${message.id}`,
            userId,
            chatId,
            role: message.role,
            body,
            createdAt: messageTime(message, fallbackTime),
          },
        ]
      : []
  })
}
