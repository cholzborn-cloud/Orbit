"use server"

import "@/lib/forms/zod-de"

import { auth } from "@/lib/auth"
import { and, eq, inArray } from "drizzle-orm"
import { nanoid } from "nanoid"
import { revalidatePath } from "next/cache"

import { db } from "@/lib/db"
import { createSandbox, deleteSandbox, getDesktopUrl } from "@/lib/daytona"
import { insertBotSchema, botFormSchema } from "@/lib/db/bot-schema"
import { bots, chatMembers, chats } from "@/lib/db/schema"

export type BotResult = { ok: true; id: string } | { ok: false; error: string }
// chatId: Direktchat des neuen Orbis, dorthin springt die UI.
export type CreateBotResult =
  { ok: true; id: string; chatId: string } | { ok: false; error: string }

// Setzt isMain zuerst für alle Bots des Nutzers zurück; der Unique-Index erlaubt nur einen.
const clearMain = (
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string
) =>
  tx
    .update(bots)
    .set({ isMain: false })
    .where(and(eq(bots.userId, userId), eq(bots.isMain, true)))

export async function createBot(input: unknown): Promise<CreateBotResult> {
  const { userId } = await auth()

  const form = botFormSchema.safeParse(input)
  if (!form.success) return { ok: false, error: form.error.issues[0].message }

  const id = nanoid()
  const row = insertBotSchema.safeParse({
    ...form.data,
    id,
    userId,
    thirdPartyId: id, // TODO: durch echte ID des externen Dienstes ersetzen
    instructions: form.data.instructions || null,
  })
  if (!row.success) return { ok: false, error: row.error.issues[0].message }

  let sandboxId: string
  try {
    sandboxId = await createSandbox(id)
  } catch (e) {
    console.error("Sandbox konnte nicht erstellt werden", e)
    return { ok: false, error: "Sandbox konnte nicht erstellt werden." }
  }

  const chatId = nanoid()
  try {
    db.transaction(
      (tx) => {
        if (row.data.isMain) clearMain(tx, userId).run()
        tx.insert(bots)
          .values({ ...row.data, sandboxId, onboardingDone: false })
          .run()
        tx.insert(chats).values({ id: chatId, userId, kind: "direct" }).run()
        tx.insert(chatMembers).values({ chatId, botId: id }).run()
      },
      { behavior: "immediate" }
    )
  } catch (e) {
    await deleteSandbox(sandboxId).catch(() => {}) // keine verwaiste Sandbox zurücklassen
    console.error("Orbi konnte nicht gespeichert werden", e)
    return { ok: false, error: "Orbi konnte nicht gespeichert werden." }
  }
  // Layout: die Sidebar im Root-Layout soll den neuen Orbi schon im Chat zeigen.
  revalidatePath("/", "layout")
  return { ok: true, id, chatId }
}

export async function updateBot(
  id: string,
  input: unknown
): Promise<BotResult> {
  const { userId } = await auth()

  const form = botFormSchema.safeParse(input)
  if (!form.success) return { ok: false, error: form.error.issues[0].message }

  try {
    // Die alte Anweisung bleibt beim Bearbeiten unverändert in der Datenbank.
    const { instructions: _instructions, ...values } = form.data
    const changed = db.transaction(
      (tx) => {
        const target = tx
          .select({ id: bots.id })
          .from(bots)
          .where(and(eq(bots.id, id), eq(bots.userId, userId)))
          .get()
        if (!target) return undefined
        if (values.isMain) clearMain(tx, userId).run()
        return tx
          .update(bots)
          .set(values)
          .where(and(eq(bots.id, id), eq(bots.userId, userId)))
          .returning({ id: bots.id })
          .get()
      },
      { behavior: "immediate" }
    )
    if (!changed) return { ok: false, error: "Orbi nicht gefunden." }
    revalidatePath("/")
    return { ok: true, id }
  } catch (e) {
    console.error("Orbi konnte nicht aktualisiert werden", e)
    return { ok: false, error: "Orbi konnte nicht aktualisiert werden." }
  }
}

export async function deleteBot(id: string): Promise<BotResult> {
  const { userId } = await auth()

  try {
    const [bot] = await db
      .select({ sandboxId: bots.sandboxId })
      .from(bots)
      .where(and(eq(bots.id, id), eq(bots.userId, userId)))
    if (!bot) return { ok: false, error: "Orbi nicht gefunden." }

    if (bot.sandboxId)
      try {
        await deleteSandbox(bot.sandboxId)
      } catch (e) {
        console.error("Sandbox konnte nicht gelöscht werden", e)
        return {
          ok: false,
          error:
            "Computer konnte nicht gelöscht werden. Bitte erneut versuchen.",
        }
      }

    // Direktchats des Bots gehen mit; Mitgliedschaften in Gruppen verschwinden per Cascade.
    const direct = await db
      .select({ id: chats.id })
      .from(chats)
      .innerJoin(chatMembers, eq(chatMembers.chatId, chats.id))
      .where(
        and(
          eq(chatMembers.botId, id),
          eq(chats.userId, userId),
          eq(chats.kind, "direct")
        )
      )

    db.transaction((tx) => {
      if (direct.length)
        tx.delete(chats)
          .where(
            inArray(
              chats.id,
              direct.map((c) => c.id)
            )
          )
          .run()
      tx.delete(bots)
        .where(and(eq(bots.id, id), eq(bots.userId, userId)))
        .run()
    })
    revalidatePath("/")
    return { ok: true, id }
  } catch (e) {
    console.error("Orbi konnte nicht gelöscht werden", e)
    return { ok: false, error: "Orbi konnte nicht gelöscht werden." }
  }
}

export async function getBotDesktopUrl(
  id: string
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const { userId } = await auth()

  const [bot] = await db
    .select({ sandboxId: bots.sandboxId })
    .from(bots)
    .where(and(eq(bots.id, id), eq(bots.userId, userId)))
  if (!bot?.sandboxId)
    return { ok: false, error: "Dieser Orbi hat keinen Computer." }

  try {
    return { ok: true, url: await getDesktopUrl(bot.sandboxId) }
  } catch (e) {
    console.error("Desktop konnte nicht gestartet werden", bot.sandboxId, e)
    return { ok: false, error: "Computer konnte nicht gestartet werden." }
  }
}
