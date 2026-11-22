"use server"

import "@/lib/forms/zod-de"

import { auth } from "@/lib/auth"
import { z } from "zod"

import { db } from "@/lib/db"
import { userSettings } from "@/lib/db/schema"
import { themeSchema } from "@/lib/settings/theme"
import {
  BASE_INSTRUCTIONS_LIMIT,
  normalizeBaseInstructions,
} from "@/lib/orbi/base-instructions"
import { getUserSettings, type Settings } from "@/query/settings"

export type SettingsResult =
  { ok: true; settings: Settings } | { ok: false; error: string }

const jevSettingsSchema = z
  .object({ auto: z.boolean().optional(), handoff: z.boolean().optional() })
  .refine((value) => value.auto !== undefined || value.handoff !== undefined)

export async function getSettings(): Promise<SettingsResult> {
  const { userId } = await auth()

  try {
    return { ok: true, settings: await getUserSettings(userId) }
  } catch (e) {
    console.error("Einstellungen konnten nicht geladen werden", e)
    return { ok: false, error: "Einstellungen konnten nicht geladen werden." }
  }
}

export async function setTheme(
  input: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await auth()

  const theme = themeSchema.safeParse(input)
  if (!theme.success) return { ok: false, error: "Ungültiges Design." }

  try {
    await db
      .insert(userSettings)
      .values({ userId, theme: theme.data })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { theme: theme.data, updatedAt: new Date() },
      })
    return { ok: true }
  } catch (e) {
    console.error("Design konnte nicht gespeichert werden", e)
    return { ok: false, error: "Design konnte nicht gespeichert werden." }
  }
}

export async function setJevSettings(
  input: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await auth()

  const parsed = jevSettingsSchema.safeParse(input)
  if (!parsed.success)
    return { ok: false, error: "Ungültige Jev-Einstellungen." }

  try {
    const values = {
      ...(parsed.data.auto !== undefined && { jevAuto: parsed.data.auto }),
      ...(parsed.data.handoff !== undefined && {
        jevHandoff: parsed.data.handoff,
      }),
    }
    await db
      .insert(userSettings)
      .values({ userId, ...values })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: { ...values, updatedAt: new Date() },
      })
    return { ok: true }
  } catch (e) {
    console.error("Jev-Einstellungen konnten nicht gespeichert werden", e)
    return {
      ok: false,
      error: "Jev-Einstellungen konnten nicht gespeichert werden.",
    }
  }
}

export async function setBaseInstructions(
  input: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { userId } = await auth()

  const parsed = normalizeBaseInstructions(input)
  if (!parsed.ok)
    return {
      ok: false,
      error: `Die Anleitung darf höchstens ${BASE_INSTRUCTIONS_LIMIT.toLocaleString("de-DE")} Zeichen lang sein.`,
    }
  try {
    await db
      .insert(userSettings)
      .values({
        userId,
        baseInstructions: parsed.value,
      })
      .onConflictDoUpdate({
        target: userSettings.userId,
        set: {
          baseInstructions: parsed.value,
          updatedAt: new Date(),
        },
      })
    return { ok: true }
  } catch (e) {
    console.error("Orbis-Anleitung konnte nicht gespeichert werden", e)
    return {
      ok: false,
      error: "Orbis-Anleitung konnte nicht gespeichert werden.",
    }
  }
}
