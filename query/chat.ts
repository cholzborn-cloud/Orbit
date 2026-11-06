import { and, eq, gt, inArray } from "drizzle-orm"

import { db } from "@/lib/db"
import { chats, orbiWork } from "@/lib/db/schema"

// Ein Chat des Nutzers samt Mitgliedern und ihren Bots. Fremde Chat-IDs liefern undefined.
export const getChat = (userId: string, chatId: string) =>
  db.query.chats.findFirst({
    where: and(eq(chats.id, chatId), eq(chats.userId, userId)),
    with: { members: { with: { bot: true } } },
  })

// Eckdaten aller Chats des Nutzers für die Startseite (kein Verlauf, nur Mitgliederzahl).
export async function listStartChats(userId: string) {
  const rows = await db.query.chats.findMany({
    where: and(
      eq(chats.userId, userId),
      inArray(chats.kind, ["direct", "group"])
    ),
    columns: { id: true, lastMessageAt: true },
    with: { members: { columns: { botId: true } } },
  })
  return rows.map(({ id, lastMessageAt, members }) => ({
    id,
    lastMessageAt,
    memberCount: members.length,
  }))
}

// Turn-Timeout ist 5 min; ältere Zeilen stammen von abgestürzten Läufen.
const WORK_MAX_AGE_MS = 6 * 60_000

export async function listWorkingBotIds(userId: string) {
  const rows = await db
    .selectDistinct({ botId: orbiWork.botId })
    .from(orbiWork)
    .where(
      and(
        eq(orbiWork.userId, userId),
        gt(orbiWork.startedAt, new Date(Date.now() - WORK_MAX_AGE_MS))
      )
    )
  return rows.map((r) => r.botId)
}
