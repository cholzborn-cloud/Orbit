import { desc, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import type { ORBIS } from "@/lib/db/bot-schema"
import { chats } from "@/lib/db/schema"
import type { BotLook } from "@/lib/db/schema"

export type SidebarBot = {
  chatId: string
  id: string
  name: string
  avatar: (typeof ORBIS)[number]
  color: string | null
  job: string
  instructions: string | null
  isMain: boolean
  onboardingDone: boolean
  look: BotLook | null
  lastMessageAt: string
}

export type SidebarGroupChat = {
  id: string
  name: string
  members: {
    id: string
    name: string
    avatar: SidebarBot["avatar"]
    color: string | null
    look: BotLook | null
  }[]
}

// Direkt- und Gruppenchats des Nutzers, neueste zuerst.
// Der Bot eines Direktchats ist das erste Mitglied. Der Hauptbot wird hier abgetrennt.
export async function getSidebarBots(userId: string) {
  const rows = await db.query.chats.findMany({
    where: eq(chats.userId, userId),
    orderBy: desc(chats.lastMessageAt),
    with: { members: { with: { bot: true } } },
  })

  // Ein Orbi mit mehreren Direktchats erscheint nur einmal (neuester Chat), sonst doppelte React-Keys.
  const seen = new Set<string>()
  const all: SidebarBot[] = rows
    .filter((c) => c.kind === "direct" && c.members[0])
    .filter(
      (c) => !seen.has(c.members[0].bot.id) && seen.add(c.members[0].bot.id)
    )
    .map(({ id: chatId, members: [{ bot: b }], lastMessageAt }) => ({
      chatId,
      id: b.id,
      name: b.name,
      avatar: b.avatar as SidebarBot["avatar"],
      color: b.color,
      job: b.job,
      instructions: b.instructions,
      isMain: b.isMain,
      onboardingDone: b.onboardingDone,
      look: b.look,
      lastMessageAt: lastMessageAt.toISOString(),
    }))

  const groups: SidebarGroupChat[] = rows
    .filter((c) => c.kind === "group")
    .map((c) => ({
      id: c.id,
      name: c.name ?? "Gruppe",
      members: c.members.map(({ bot: b }) => ({
        id: b.id,
        name: b.name,
        avatar: b.avatar as SidebarBot["avatar"],
        color: b.color,
        look: b.look,
      })),
    }))

  return {
    groups,
    main: all.find((b) => b.isMain) ?? null,
    bots: all.filter((b) => !b.isMain),
  }
}
