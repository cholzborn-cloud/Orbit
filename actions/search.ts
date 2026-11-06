"use server"

import "@/lib/forms/zod-de"

import { auth } from "@/lib/auth"
import { eq, sql } from "drizzle-orm"
import { reindexAll } from "@/actions/chat"
import { db } from "@/lib/db"
import { chatMessagesIndex, chats } from "@/lib/db/schema"
import { searchQuerySchema } from "@/lib/search/index-messages"
import { searchMessages } from "@/query/search"

const attempts = new Map<string, number[]>()
const indexing = new Set<string>()
const indexed = new Set<string>()

export async function searchChats(input: unknown): Promise<
  | {
      ok: true
      results: Awaited<ReturnType<typeof searchMessages>>
      indexing: boolean
    }
  | { ok: false; error: string }
> {
  const { userId } = await auth()

  const parsed = searchQuerySchema.safeParse(input)
  if (!parsed.success)
    return { ok: false, error: parsed.error.issues[0].message }
  const now = Date.now()
  const recent = (attempts.get(userId) ?? []).filter(
    (time) => now - time < 60_000
  )
  if (recent.length >= 30)
    return { ok: false, error: "Zu viele Suchen. Bitte warte eine Minute." }
  attempts.set(userId, [...recent, now])

  try {
    const [{ indexedChats }] = await db
      .select({
        indexedChats: sql<number>`count(distinct ${chatMessagesIndex.chatId})`,
      })
      .from(chatMessagesIndex)
      .where(eq(chatMessagesIndex.userId, userId))
    const [{ ownedChats }] = await db
      .select({ ownedChats: sql<number>`count(*)` })
      .from(chats)
      .where(eq(chats.userId, userId))
    // Alte Chats ohne Indexzeilen: einmal je Serverprozess nachindexieren (Chats ohne Text bleiben unindexiert).
    if (
      indexedChats < ownedChats &&
      !indexing.has(userId) &&
      !indexed.has(userId)
    ) {
      indexing.add(userId)
      void reindexAll()
        .catch(() => undefined)
        .finally(() => {
          indexing.delete(userId)
          indexed.add(userId)
        })
    }
    if (!indexedChats)
      return { ok: true, results: [], indexing: indexing.has(userId) }
    return {
      ok: true,
      results: await searchMessages(userId, parsed.data),
      indexing: indexing.has(userId),
    }
  } catch (error) {
    console.error(
      "Chatsuche fehlgeschlagen",
      error instanceof Error ? error.name : "Unbekannter Fehler"
    )
    return { ok: false, error: "Die Suche ist gerade nicht verfügbar." }
  }
}
