"use server"

import "@/lib/forms/zod-de"

import { auth } from "@/lib/auth"
import { and, eq, inArray, notInArray, sql } from "drizzle-orm"
import { nanoid } from "nanoid"
import { revalidatePath } from "next/cache"

import { db } from "@/lib/db"
import { validateGroupMemberCount } from "@/lib/chat/limits"
import { groupFormSchema } from "@/lib/db/chat-schema"
import {
  bots,
  chatMembers,
  chatMessages,
  chatMessagesIndex,
  chats,
} from "@/lib/db/schema"
import { messagesToRows } from "@/lib/search/index-messages"

const touchTimes = new Map<string, number>()

export async function createGroup(
  input: unknown
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const { userId } = await auth()

  const form = groupFormSchema.safeParse(input)
  if (!form.success) return { ok: false, error: form.error.issues[0].message }
  const limitError = validateGroupMemberCount(form.data.botIds.length)
  if (limitError) return { ok: false, error: limitError }

  // Nur eigene Bots zulassen.
  try {
    const own = await db
      .select({ id: bots.id })
      .from(bots)
      .where(and(eq(bots.userId, userId), inArray(bots.id, form.data.botIds)))
    if (own.length !== form.data.botIds.length)
      return { ok: false, error: "Unbekannter Orbi." }

    const id = nanoid()
    db.transaction((tx) => {
      tx.insert(chats)
        .values({ id, userId, kind: "group", name: form.data.name })
        .run()
      tx.insert(chatMembers)
        .values(own.map((b) => ({ chatId: id, botId: b.id })))
        .run()
    })
    revalidatePath("/")
    return { ok: true, id }
  } catch (e) {
    console.error("Gruppe konnte nicht erstellt werden", e)
    return { ok: false, error: "Gruppe konnte nicht erstellt werden." }
  }
}

export async function updateGroup(
  chatId: string,
  input: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await auth()

  const form = groupFormSchema.safeParse(input)
  if (!form.success) return { ok: false, error: form.error.issues[0].message }
  const limitError = validateGroupMemberCount(form.data.botIds.length)
  if (limitError) return { ok: false, error: limitError }

  try {
    const [group] = await db
      .select({ id: chats.id })
      .from(chats)
      .where(
        and(
          eq(chats.id, chatId),
          eq(chats.userId, userId),
          eq(chats.kind, "group")
        )
      )
    if (!group) return { ok: false, error: "Gruppe nicht gefunden." }
    const own = await db
      .select({ id: bots.id })
      .from(bots)
      .where(and(eq(bots.userId, userId), inArray(bots.id, form.data.botIds)))
    if (own.length !== form.data.botIds.length)
      return { ok: false, error: "Unbekannter Orbi." }

    db.transaction((tx) => {
      tx.update(chats)
        .set({ name: form.data.name })
        .where(eq(chats.id, chatId))
        .run()
      tx.delete(chatMembers).where(eq(chatMembers.chatId, chatId)).run()
      tx.insert(chatMembers)
        .values(own.map((b) => ({ chatId, botId: b.id })))
        .run()
    })
    revalidatePath("/", "layout")
    return { ok: true }
  } catch (e) {
    console.error("Gruppe konnte nicht gespeichert werden", e)
    return { ok: false, error: "Gruppe konnte nicht gespeichert werden." }
  }
}

export async function deleteGroup(
  chatId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await auth()

  // Mitglieder gehen per Cascade mit; die Orbis bleiben.
  try {
    const deleted = await db
      .delete(chats)
      .where(
        and(
          eq(chats.id, chatId),
          eq(chats.userId, userId),
          eq(chats.kind, "group")
        )
      )
      .returning({ id: chats.id })
    if (!deleted.length) return { ok: false, error: "Gruppe nicht gefunden." }
    revalidatePath("/", "layout")
    return { ok: true }
  } catch (e) {
    console.error("Gruppe konnte nicht gelöscht werden", e)
    return { ok: false, error: "Gruppe konnte nicht gelöscht werden." }
  }
}

// Nur die Zeit der letzten Nachricht für die Seitenleiste.
export async function touchChat(chatId: string) {
  const { userId } = await auth()

  const key = `${userId}:${chatId}`
  const now = Date.now()
  if (now - (touchTimes.get(key) ?? 0) >= 5000) {
    touchTimes.set(key, now)
    await db
      .update(chats)
      .set({ lastMessageAt: new Date() })
      .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    revalidatePath("/", "layout")
  }
  void indexOwnedChat(userId, chatId).catch((error) =>
    console.error(
      "Chat-Indexierung fehlgeschlagen",
      error instanceof Error ? error.name : "Unbekannter Fehler"
    )
  )
}

async function indexOwnedChat(userId: string, chatId: string) {
  const [owned] = await db
    .select({
      id: chats.id,
      createdAt: chats.createdAt,
      lastMessageAt: chats.lastMessageAt,
    })
    .from(chats)
    .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
  if (!owned) return
  // Der Verlauf liegt lokal; Chats ohne gespeicherte Nachrichten (Trigger-Zeit) behalten ihren Index.
  const transcript = {
    messages: db
      .select({
        id: chatMessages.id,
        role: chatMessages.role,
        parts: chatMessages.parts,
      })
      .from(chatMessages)
      .where(eq(chatMessages.chatId, chatId))
      .all(),
  }
  if (!transcript.messages.length) return
  const rows = messagesToRows({
    userId,
    chatId,
    messages: transcript.messages,
    fallbackTime: owned.lastMessageAt ?? owned.createdAt,
  })
  if (!rows.length) {
    await db
      .delete(chatMessagesIndex)
      .where(
        and(
          eq(chatMessagesIndex.userId, userId),
          eq(chatMessagesIndex.chatId, chatId)
        )
      )
    return
  }
  db.transaction((tx) => {
    for (let offset = 0; offset < rows.length; offset += 100) {
      tx.insert(chatMessagesIndex)
        .values(rows.slice(offset, offset + 100))
        .onConflictDoUpdate({
          target: chatMessagesIndex.id,
          set: { body: sql`excluded.body` },
          setWhere: sql`${chatMessagesIndex.body} is not excluded.body`,
        })
        .run()
    }
    tx.delete(chatMessagesIndex)
      .where(
        and(
          eq(chatMessagesIndex.userId, userId),
          eq(chatMessagesIndex.chatId, chatId),
          notInArray(
            chatMessagesIndex.id,
            rows.map((row) => row.id)
          )
        )
      )
      .run()
  })
}

export async function clearChatIndex(chatId: string) {
  const { userId } = await auth()

  try {
    const [owned] = await db
      .select({ id: chats.id })
      .from(chats)
      .where(and(eq(chats.id, chatId), eq(chats.userId, userId)))
    if (!owned) return { ok: false as const, error: "Chat nicht gefunden." }
    await db
      .delete(chatMessagesIndex)
      .where(
        and(
          eq(chatMessagesIndex.userId, userId),
          eq(chatMessagesIndex.chatId, chatId)
        )
      )
    return { ok: true as const }
  } catch {
    return {
      ok: false as const,
      error: "Der Suchindex konnte nicht geleert werden.",
    }
  }
}

export async function reindexAll() {
  const { userId } = await auth()

  const recent = attemptsForIndex.get(userId) ?? 0
  if (Date.now() - recent < 60_000)
    return { ok: false as const, error: "Indexierung kürzlich ausgeführt." }
  attemptsForIndex.set(userId, Date.now())
  const ownedChats = await db
    .select({ id: chats.id })
    .from(chats)
    .where(eq(chats.userId, userId))
    .limit(200)
  for (const { id } of ownedChats) {
    try {
      await indexOwnedChat(userId, id)
    } catch (error) {
      console.error(
        "Chat-Indexierung fehlgeschlagen",
        error instanceof Error ? error.name : "Unbekannter Fehler"
      )
    }
  }
  return { ok: true as const }
}

const attemptsForIndex = new Map<string, number>()
