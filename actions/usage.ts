"use server"

import "@/lib/forms/zod-de"

import { auth } from "@/lib/auth"

import { loadUsage } from "@/lib/usage"
import type { UsageResult } from "@/lib/usage/types"

// fresh: Cache umgehen (Aktualisieren-Knopf).
export async function getUsage(fresh?: boolean): Promise<UsageResult> {
  await auth()

  try {
    return {
      ok: true,
      providers: await loadUsage({ fresh: fresh === true }),
      fetchedAt: Date.now(),
    }
  } catch {
    return { ok: false, error: "Nutzung konnte nicht geladen werden." }
  }
}
