import { and, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { mcpConnectors } from "@/lib/db/schema"

export function listConnectors(userId: string) {
  return db
    .select({
      id: mcpConnectors.id,
      name: mcpConnectors.name,
      url: mcpConnectors.url,
      enabled: mcpConnectors.enabled,
      hasAuth: mcpConnectors.authEncrypted,
      authHeader: mcpConnectors.authHeader,
      oauth: mcpConnectors.oauthEncrypted,
    })
    .from(mcpConnectors)
    .where(eq(mcpConnectors.userId, userId))
    .orderBy(mcpConnectors.name)
}

export function getConnector(userId: string, id: string) {
  return db.query.mcpConnectors.findFirst({
    where: and(eq(mcpConnectors.userId, userId), eq(mcpConnectors.id, id)),
  })
}
