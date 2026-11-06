import { and, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { mcpConnectors } from "@/lib/db/schema"

import type { OAuthStore } from "./oauth.ts"

export const dbOAuthStore = (userId: string, id: string): OAuthStore => {
  const where = and(eq(mcpConnectors.id, id), eq(mcpConnectors.userId, userId))
  return {
    load: async () =>
      (
        await db
          .select({ value: mcpConnectors.oauthEncrypted })
          .from(mcpConnectors)
          .where(where)
          .limit(1)
      )[0]?.value ?? null,
    save: async (value) => {
      await db.update(mcpConnectors).set({ oauthEncrypted: value }).where(where)
    },
  }
}
