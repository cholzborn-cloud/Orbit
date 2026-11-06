"use server"

import "@/lib/forms/zod-de"

import { auth } from "@/lib/auth"
import { and, eq, isNull, sql } from "drizzle-orm"
import { cookies } from "next/headers"
import { nanoid } from "nanoid"
import { revalidatePath } from "next/cache"
import { z } from "zod"

import { automationInput, nextRun } from "@/lib/automations/schedule"
import { db } from "@/lib/db"
import {
  automations,
  bots,
  chatMembers,
  chats,
} from "@/lib/db/schema"
import * as query from "@/query/automations"

const idSchema = z.string().min(1)
const fail = (error: string) => ({ ok: false as const, error })
const user = async () => (await auth()).userId
const owned = (userId: string, id: string) =>
  db.query.automations.findFirst({
    where: and(eq(automations.id, id), eq(automations.userId, userId)),
  })

export async function listAutomations() {
  const userId = await user()

  try {
    return {
      ok: true as const,
      automations: await query.listAutomations(userId),
      trash: await query.listTrash(userId),
    }
  } catch (error) {
    console.error("listAutomations fehlgeschlagen:", error)
    return fail("Automationen konnten nicht geladen werden.")
  }
}

export async function createAutomation(input: unknown) {
  const userId = await user()

  const parsed = automationInput
    .extend({ botId: idSchema, chatId: idSchema.optional() })
    .safeParse(input)
  if (!parsed.success)
    return fail(parsed.error.issues[0]?.message ?? "Eingabe ungültig.")
  try {
    const [bot] = await db
      .select({ id: bots.id })
      .from(bots)
      .where(and(eq(bots.id, parsed.data.botId), eq(bots.userId, userId)))
    if (!bot) return fail("Orbi nicht gefunden.")
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(automations)
      .where(and(eq(automations.botId, bot.id), isNull(automations.deletedAt)))
    if (count >= 50)
      return fail("Für diesen Orbi sind höchstens 50 Automationen möglich.")
    let chatId = parsed.data.chatId
    if (chatId) {
      const [target] = await db
        .select({ id: chats.id })
        .from(chats)
        .innerJoin(chatMembers, eq(chatMembers.chatId, chats.id))
        .where(
          and(
            eq(chats.id, chatId),
            eq(chats.userId, userId),
            eq(chatMembers.botId, bot.id)
          )
        )
      if (!target) return fail("Ziel-Chat gehört nicht zu diesem Orbi.")
    }
    if (parsed.data.target === "same" && !chatId) {
      const [direct] = await db
        .select({ id: chats.id })
        .from(chats)
        .innerJoin(chatMembers, eq(chats.id, chatMembers.chatId))
        .where(
          and(
            eq(chatMembers.botId, bot.id),
            eq(chats.userId, userId),
            eq(chats.kind, "direct")
          )
        )
        .limit(1)
      chatId = direct?.id
    }
    const next = nextRun(parsed.data.schedule, parsed.data.timezone, new Date())
    if (!next) return fail("Kein nächster Lauf gefunden.")
    const id = nanoid()
    await db.insert(automations).values({
      id,
      userId,
      botId: bot.id,
      name: parsed.data.name,
      prompt: parsed.data.prompt,
      schedule: parsed.data.schedule,
      timezone: parsed.data.timezone,
      target: parsed.data.target,
      notify: parsed.data.notify,
      model: parsed.data.model ?? null,
      effort: parsed.data.effort ?? null,
      context: parsed.data.context,
      chatId,
      nextRunAt: next,
    })
    revalidatePath("/geplant")
    return { ok: true as const, id }
  } catch (error) {
    console.error("createAutomation fehlgeschlagen:", error)
    return fail("Automation konnte nicht angelegt werden.")
  }
}

export async function updateAutomation(id: string, input: unknown) {
  const userId = await user()

  const validId = idSchema.safeParse(id),
    parsed = automationInput.safeParse(input)
  if (!validId.success || !parsed.success) return fail("Eingabe ungültig.")
  try {
    const row = await owned(userId, id)
    if (!row || row.deletedAt) return fail("Automation nicht gefunden.")
    const next = nextRun(parsed.data.schedule, parsed.data.timezone, new Date())
    if (!next) return fail("Kein nächster Lauf gefunden.")
    let chatId = row.chatId
    if (parsed.data.target === "same" && !chatId) {
      const [direct] = await db
        .select({ id: chats.id })
        .from(chats)
        .innerJoin(chatMembers, eq(chats.id, chatMembers.chatId))
        .where(
          and(
            eq(chatMembers.botId, row.botId),
            eq(chats.userId, userId),
            eq(chats.kind, "direct")
          )
        )
        .limit(1)
      chatId = direct?.id ?? null
    }
    await db
      .update(automations)
      .set({
        ...parsed.data,
        model: parsed.data.model ?? null,
        effort: parsed.data.effort ?? null,
        chatId,
        nextRunAt: next,
        // Einmalige Automation nach dem Lauf mit neuem Termin wieder aktivieren.
        ...(parsed.data.schedule.kind === "once" && !row.pausedReason
          ? { enabled: true }
          : {}),
      })
      .where(eq(automations.id, id))
    revalidatePath("/geplant")
    return { ok: true as const }
  } catch (error) {
    console.error("updateAutomation fehlgeschlagen:", error)
    return fail("Automation konnte nicht gespeichert werden.")
  }
}

export async function setAutomationEnabled(id: string, enabled: boolean) {
  const userId = await user()

  const validId = idSchema.safeParse(id)
  if (!validId.success) return fail("Eingabe ungültig.")
  try {
    const row = await owned(userId, id)
    if (!row || row.deletedAt) return fail("Automation nicht gefunden.")
    const next = enabled
      ? nextRun(row.schedule as never, row.timezone, new Date())
      : row.nextRunAt
    if (enabled && !next) return fail("Kein nächster Lauf gefunden.")
    await db
      .update(automations)
      .set({
        enabled,
        pausedReason: null,
        nextRunAt: next,
        ...(enabled ? { resumedAt: new Date() } : {}),
      })
      .where(eq(automations.id, id))
    revalidatePath("/geplant")
    return { ok: true as const }
  } catch {
    return fail("Status konnte nicht geändert werden.")
  }
}

async function transition(id: string, mode: "trash" | "restore" | "delete") {
  const userId = await user()

  if (!idSchema.safeParse(id).success) return fail("Eingabe ungültig.")
  try {
    const row = await owned(userId, id)
    if (
      !row ||
      (mode === "restore" || mode === "delete"
        ? !row.deletedAt
        : !!row.deletedAt)
    )
      return fail("Automation nicht gefunden.")
    if (mode === "restore") {
      const next = nextRun(row.schedule as never, row.timezone, new Date())
      if (!next) return fail("Kein nächster Lauf gefunden.")
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)` })
        .from(automations)
        .where(
          and(eq(automations.botId, row.botId), isNull(automations.deletedAt))
        )
      if (count >= 50)
        return fail("Für diesen Orbi sind höchstens 50 Automationen möglich.")
      await db
        .update(automations)
        .set({ deletedAt: null, nextRunAt: next })
        .where(eq(automations.id, id))
    } else if (mode === "delete")
      await db.delete(automations).where(eq(automations.id, id))
    else
      await db
        .update(automations)
        .set({ deletedAt: mode === "trash" ? new Date() : null })
        .where(eq(automations.id, id))
    revalidatePath("/geplant")
    return { ok: true as const }
  } catch {
    return fail("Automation konnte nicht geändert werden.")
  }
}
export async function trashAutomation(id: string) {
  return transition(id, "trash")
}
export async function restoreAutomation(id: string) {
  return transition(id, "restore")
}
export async function deleteAutomationForever(id: string) {
  return transition(id, "delete")
}

export async function getAutomationRuns(id: string) {
  const userId = await user()

  if (!idSchema.safeParse(id).success) return fail("Eingabe ungültig.")
  try {
    if (!(await owned(userId, id))) return fail("Automation nicht gefunden.")
    return { ok: true as const, runs: await query.listRuns(userId, id) }
  } catch {
    return fail("Läufe konnten nicht geladen werden.")
  }
}

export async function markRunsSeen() {
  const userId = await user()

  try {
    ;(await cookies()).set("orbit-geplant-seen", `${userId}:${Date.now()}`, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 31_536_000,
    })
    return { ok: true as const }
  } catch {
    return fail("Ansicht konnte nicht gespeichert werden.")
  }
}

export async function unreadRunsCount() {
  const userId = await user()

  try {
    const seen = (await cookies()).get("orbit-geplant-seen")?.value ?? ""
    const timestamp = seen.startsWith(`${userId}:`)
      ? Number(seen.slice(userId.length + 1))
      : 0
    return {
      ok: true as const,
      count: await query.countUnreadRuns(userId, timestamp),
    }
  } catch {
    return fail("Läufe konnten nicht geladen werden.")
  }
}
