import { and, asc, eq, like, max } from "drizzle-orm"
import type { UIMessage } from "ai"

import { indexChatLibrary } from "../library.ts"
import { getDatabase } from "@/lib/db/client"
import {
  chatMessages,
  chatMessagesIndex,
  chats,
  messageReactions,
} from "@/lib/db/schema"
import { messagesToRows } from "@/lib/search/index-messages"
import type { ChatMetadata } from "@/lib/chat-catalog"
import { reactionBaseId, type Reaction, type ReactionEmoji } from "../../../lib/chat/reactions.ts"
import {
  lineMessage,
  readLine,
  type OrbiLine,
} from "../../../lib/chat/orbi-message.ts"
import { stripToolMarkup } from "../../../lib/cli/tool-protocol.ts"

// Roher Werkzeugaufruf-Text (<invoke …>, <function_calls>, <orbit_tool_call> …) gehört nie in eine Antwort (06.11.2026):
// beim Speichern und beim Lesen aus Orbi-Textteilen entfernen, damit auch alte Verläufe sauber sind und das Modell ihn nicht nachahmt.
export function withoutToolMarkup<M extends { role: string; parts: unknown }>(message: M): M {
  if (message.role !== "assistant" || !Array.isArray(message.parts)) return message
  let changed = false
  const parts = (message.parts as Array<Record<string, unknown>>).flatMap((part) => {
    if (part?.type !== "text" || typeof part.text !== "string" || !part.text.includes("<")) return [part]
    const text = stripToolMarkup(part.text)
    if (text === part.text) return [part]
    changed = true
    return text.trim() ? [{ ...part, text }] : []
  })
  return changed ? { ...message, parts } : message
}

export function createMessageStore(db = getDatabase()) {
  const ownsChat = async (chatId: string) =>
    !!db
      .select({ id: chats.id })
      .from(chats)
      .where(and(eq(chats.id, chatId), eq(chats.userId, "local")))
      .get()

  const listMessages = async (
    chatId: string
  ): Promise<UIMessage<ChatMetadata>[]> => {
    if (!(await ownsChat(chatId))) throw new Error("Chat nicht gefunden.")
    return db
      .select()
      .from(chatMessages)
      .where(eq(chatMessages.chatId, chatId))
      .orderBy(asc(chatMessages.position))
      .all()
      .map(({ id, role, parts, metadata, createdAt }) => {
        const meta = { ...(metadata as ChatMetadata | null), createdAt: (metadata as ChatMetadata | null)?.createdAt ?? createdAt.getTime() }
        return withoutToolMarkup({ id, role, parts, metadata: meta })
      })
  }

  // `merge`: Turn-Ende. Zeilen, die während des Turns dazukamen (gesendet, empfangen, Status), bleiben erhalten;
  // bei Zeilen gilt der Stand der Datenbank, nicht der Schnappschuss des Turns. Alles in einer Transaktion.
  const saveMessages = async (
    chatId: string,
    snapshot: UIMessage<ChatMetadata>[],
    options: { merge?: boolean } = {}
  ) => {
    if (!(await ownsChat(chatId))) throw new Error("Chat nicht gefunden.")
    const now = new Date()
    db.transaction((tx) => {
      const timestamps = new Map(tx.select({ id: chatMessages.id, createdAt: chatMessages.createdAt }).from(chatMessages).where(eq(chatMessages.chatId, chatId)).all().map((row) => [row.id, row.createdAt]))
      let messages = snapshot.map(withoutToolMarkup)
      if (options.merge) {
        const stored = tx
          .select()
          .from(chatMessages)
          .where(eq(chatMessages.chatId, chatId))
          .orderBy(asc(chatMessages.position))
          .all()
        const byId = new Map(stored.map((row) => [row.id, row]))
        const known = new Set(snapshot.map((m) => m.id))
        const asMessage = (row: (typeof stored)[number]) =>
          ({
            id: row.id,
            role: row.role,
            parts: row.parts,
            ...(row.metadata ? { metadata: row.metadata as ChatMetadata } : {}),
          }) as UIMessage<ChatMetadata>
        messages = [
          ...snapshot.map((m) => {
            const row = byId.get(m.id)
            return row && readLine(m) ? asMessage(row) : m
          }),
          ...stored.filter((row) => !known.has(row.id)).map(asMessage),
        ]
      }
      indexChatLibrary(chatId, db)
      // Eine Transaktion ersetzt Verlauf und Suchindex zusammen, auch bei Regeneration.
      tx.delete(chatMessages).where(eq(chatMessages.chatId, chatId)).run()
      for (const [position, message] of messages.entries()) {
        tx.insert(chatMessages)
          .values({
            chatId,
            id: message.id,
            role: message.role,
            parts: message.parts,
            metadata: message.metadata ?? null,
            createdAt: timestamps.get(message.id) ?? new Date(message.metadata?.createdAt ?? now.getTime()),
            position,
          })
          .run()
      }
      indexChatLibrary(chatId, db)
      const rows = messagesToRows({
        userId: "local",
        chatId,
        messages,
        fallbackTime: now,
      })
      tx.delete(chatMessagesIndex)
        .where(eq(chatMessagesIndex.chatId, chatId))
        .run()
      for (const row of rows) tx.insert(chatMessagesIndex).values(row).run()
      tx.update(chats)
        .set({ lastMessageAt: now })
        .where(and(eq(chats.id, chatId), eq(chats.userId, "local")))
        .run()
    })
  }

  // Zwischenspeichern während eines Turns: schreibt nur diese eine Nachricht (neu oder ersetzt, Position bleibt) samt
  // Suchindex-Zeile. Der Rest des Verlaufs und die Reaktionen bleiben unberührt; saveMessages am Turn-Ende gilt weiter.
  const upsertMessage = async (
    chatId: string,
    message: UIMessage<ChatMetadata>
  ) => {
    if (!(await ownsChat(chatId))) throw new Error("Chat nicht gefunden.")
    message = withoutToolMarkup(message)
    db.transaction((tx) => {
      const existing = tx
        .select({ position: chatMessages.position })
        .from(chatMessages)
        .where(and(eq(chatMessages.chatId, chatId), eq(chatMessages.id, message.id)))
        .get()
      const values = {
        role: message.role,
        parts: message.parts,
        metadata: message.metadata ?? null,
      }
      if (existing)
        tx.update(chatMessages)
          .set(values)
          .where(and(eq(chatMessages.chatId, chatId), eq(chatMessages.id, message.id)))
          .run()
      else {
        const [last] = tx
          .select({ position: max(chatMessages.position) })
          .from(chatMessages)
          .where(eq(chatMessages.chatId, chatId))
          .all()
        tx.insert(chatMessages)
          .values({
            chatId,
            id: message.id,
            ...values,
            position: (last?.position ?? -1) + 1,
          })
          .run()
      }
      const rows = messagesToRows({
        userId: "local",
        chatId,
        messages: [message],
        fallbackTime: new Date(),
      })
      tx.delete(chatMessagesIndex)
        .where(eq(chatMessagesIndex.id, `${chatId}:${message.id}`))
        .run()
      for (const row of rows) tx.insert(chatMessagesIndex).values(row).run()
      tx.update(chats)
        .set({ lastMessageAt: new Date() })
        .where(and(eq(chats.id, chatId), eq(chats.userId, "local")))
        .run()
    })
  }

  const listReactions = async (chatId: string): Promise<Reaction[]> => {
    if (!(await ownsChat(chatId))) throw new Error("Chat nicht gefunden.")
    return db
      .select()
      .from(messageReactions)
      .where(eq(messageReactions.chatId, chatId))
      .orderBy(asc(messageReactions.createdAt))
      .all()
      .map((row) => ({
        messageId: row.messageId,
        actor: row.actor,
        emoji: row.emoji as ReactionEmoji,
        createdAt: row.createdAt.getTime(),
      }))
  }

  // Je Absender eine Reaktion pro Nachricht: eine neue ersetzt die alte. Nur Nachrichten dieses Chats.
  const setReaction = async (
    chatId: string,
    messageId: string,
    actor: string,
    emoji: ReactionEmoji,
    options: { requireExisting?: boolean } = {}
  ) => {
    if (!(await ownsChat(chatId))) throw new Error("Chat nicht gefunden.")
    // Die Antwort, die gerade gestreamt wird, steht evtl. noch nicht in der Datenbank (requireExisting: false).
    const exists = options.requireExisting === false ? { id: messageId } : db
      .select({ id: chatMessages.id })
      .from(chatMessages)
      .where(and(eq(chatMessages.chatId, chatId), eq(chatMessages.id, reactionBaseId(messageId))))
      .get()
    if (!exists) return false
    const createdAt = new Date()
    db.insert(messageReactions)
      .values({ chatId, messageId, actor, emoji, createdAt })
      .onConflictDoUpdate({
        target: [
          messageReactions.chatId,
          messageReactions.messageId,
          messageReactions.actor,
        ],
        set: { emoji, createdAt },
      })
      .run()
    return true
  }

  const removeReaction = async (chatId: string, messageId: string, actor: string) => {
    if (!(await ownsChat(chatId))) throw new Error("Chat nicht gefunden.")
    return (
      db
        .delete(messageReactions)
        .where(
          and(
            eq(messageReactions.chatId, chatId),
            eq(messageReactions.messageId, messageId),
            eq(messageReactions.actor, actor)
          )
        )
        .run().changes > 0
    )
  }

  // Hängt eine Zeile hinten an, ohne den Verlauf zu ersetzen (auch während ein Turn läuft).
  const appendLine = async (
    chatId: string,
    line: OrbiLine,
    id: string = crypto.randomUUID()
  ) => {
    if (!(await ownsChat(chatId))) throw new Error("Chat nicht gefunden.")
    const message = lineMessage(line, id)
    db.transaction((tx) => {
      const [last] = tx
        .select({ position: max(chatMessages.position) })
        .from(chatMessages)
        .where(eq(chatMessages.chatId, chatId))
        .all()
      tx.insert(chatMessages)
        .values({
          chatId,
          id,
          role: message.role,
          parts: message.parts,
          metadata: message.metadata ?? null,
          position: (last?.position ?? -1) + 1,
        })
        .run()
      tx.update(chats)
        .set({ lastMessageAt: new Date() })
        .where(and(eq(chats.id, chatId), eq(chats.userId, "local")))
        .run()
    })
    return id
  }

  // Ändert Felder einer gespeicherten Zeile (Status, queued, Text); gibt die neue Zeile zurück, null wenn es sie nicht gibt.
  const patchLine = async (
    chatId: string,
    messageId: string,
    patch: Partial<OrbiLine>
  ): Promise<OrbiLine | null> => {
    const row = db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.chatId, chatId), eq(chatMessages.id, messageId)))
      .get()
    if (!row) return null
    const line = readLine({ id: row.id, role: row.role, parts: row.parts })
    if (!line) return null
    const next: OrbiLine = { ...line, ...patch, updatedAt: Date.now() }
    db.update(chatMessages)
      .set({ parts: lineMessage(next, row.id).parts })
      .where(and(eq(chatMessages.chatId, chatId), eq(chatMessages.id, messageId)))
      .run()
    return next
  }
  // Beim Start von orbitd: Aufträge und Warteschlange liegen nur im Speicher. Zeilen, die noch „arbeitet“ oder
  // „wartet“ zeigen (auch wartend zugestellt), stehen sonst ewig so da: sie werden „unklar“. Gibt die Anzahl zurück.
  const settleStaleLines = async () => {
    const rows = db
      .select()
      .from(chatMessages)
      .where(like(chatMessages.parts, "%data-orbi-message%"))
      .all()
    let changed = 0
    for (const row of rows) {
      const line = readLine({ id: row.id, role: row.role, parts: row.parts })
      if (!line || (line.status !== "arbeitet" && line.status !== "wartet"))
        continue
      const next: OrbiLine = {
        ...line,
        status: "unklar",
        queued: false,
        updatedAt: Date.now(),
      }
      db.update(chatMessages)
        .set({ parts: lineMessage(next, row.id).parts })
        .where(and(eq(chatMessages.chatId, row.chatId), eq(chatMessages.id, row.id)))
        .run()
      changed++
    }
    return changed
  }
  return {
    ownsChat,
    listMessages,
    settleStaleLines,
    saveMessages,
    appendLine,
    patchLine,
    upsertMessage,
    listReactions,
    setReaction,
    removeReaction,
    // Leeren löscht auch die Reaktionen; sonst bleiben sie nur beim Neuschreiben des Verlaufs erhalten.
    clearMessages: async (chatId: string) => {
      await saveMessages(chatId, [])
      db.delete(messageReactions).where(eq(messageReactions.chatId, chatId)).run()
    },
  }
}
