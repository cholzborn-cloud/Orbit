"use server"

import "@/lib/forms/zod-de"

import { auth } from "@/lib/auth"
import { nanoid } from "nanoid"
import { z } from "zod"

import {
  deleteRule as removeRule,
  listRules as queryRules,
  ownsBot,
  saveRule,
} from "@/query/approvals"

const ruleInput = z.object({
  tool: z.string().trim().min(1).max(200),
  botId: z.string().min(1).optional(),
  mode: z.enum(["allow", "ask", "deny"]),
})

export async function listRules() {
  const { userId } = await auth()

  try {
    return { ok: true as const, rules: await queryRules(userId) }
  } catch {
    return {
      ok: false as const,
      error: "Freigaben konnten nicht geladen werden.",
    }
  }
}

export async function setRule(input: unknown) {
  const { userId } = await auth()

  const parsed = ruleInput.safeParse(input)
  if (!parsed.success)
    return { ok: false as const, error: "Die Freigabe ist ungültig." }
  try {
    if (parsed.data.botId && !(await ownsBot(userId, parsed.data.botId)))
      return {
        ok: false as const,
        error: "Dieser Orbi gehört nicht zu deinem Konto.",
      }
    await saveRule({
      id: nanoid(),
      userId,
      botId: parsed.data.botId ?? null,
      ...parsed.data,
    })
    return { ok: true as const }
  } catch {
    return {
      ok: false as const,
      error: "Freigabe konnte nicht gespeichert werden.",
    }
  }
}

export async function deleteRule(input: unknown) {
  const { userId } = await auth()

  const parsed = z.object({ id: z.string().min(1).max(100) }).safeParse(input)
  if (!parsed.success)
    return { ok: false as const, error: "Die Freigabe ist ungültig." }
  try {
    await removeRule(userId, parsed.data.id)
    return { ok: true as const }
  } catch {
    return {
      ok: false as const,
      error: "Freigabe konnte nicht gelöscht werden.",
    }
  }
}
