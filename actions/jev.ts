"use server"

import { auth } from "@/lib/auth"

import { listJevLog } from "@/query/jev"

export async function getJevLog() {
  const { userId } = await auth()

  try {
    return { ok: true as const, entries: await listJevLog(userId, 50) }
  } catch {
    return {
      ok: false as const,
      error: "Jev-Protokoll konnte nicht geladen werden.",
    }
  }
}
