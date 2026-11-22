import { eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { userSettings } from "@/lib/db/schema"
import { themeSchema, type Theme } from "@/lib/settings/theme"

export type Settings = {
  theme: Theme
  jevAuto: boolean
  jevHandoff: boolean
  baseInstructions: string | null
}

// Ohne Zeile oder mit ungültigem Wert gilt das Standard-Theme.
export async function getUserSettings(userId: string): Promise<Settings> {
  const row = await db.query.userSettings.findFirst({
    where: eq(userSettings.userId, userId),
  })
  return {
    theme: themeSchema.catch("system").parse(row?.theme),
    jevAuto: row?.jevAuto ?? true,
    jevHandoff: row?.jevHandoff ?? false,
    baseInstructions: row?.baseInstructions ?? null,
  }
}
