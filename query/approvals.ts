import { and, eq, isNotNull, isNull } from "drizzle-orm"

import { db } from "@/lib/db"
import { approvalRules, bots } from "@/lib/db/schema"

export function listRules(userId: string) {
  return db
    .select({
      id: approvalRules.id,
      tool: approvalRules.tool,
      botId: approvalRules.botId,
      botName: bots.name,
      mode: approvalRules.mode,
    })
    .from(approvalRules)
    .leftJoin(bots, eq(approvalRules.botId, bots.id))
    .where(eq(approvalRules.userId, userId))
    .orderBy(approvalRules.tool)
}

export async function ownsBot(userId: string, botId: string) {
  const [row] = await db
    .select({ id: bots.id })
    .from(bots)
    .where(and(eq(bots.id, botId), eq(bots.userId, userId)))
    .limit(1)
  return !!row
}

export async function deleteRule(userId: string, id: string) {
  return db
    .delete(approvalRules)
    .where(and(eq(approvalRules.id, id), eq(approvalRules.userId, userId)))
}

export async function saveRule(input: {
  id: string
  userId: string
  botId: string | null
  tool: string
  mode: "allow" | "ask" | "deny"
}) {
  // Ein Statement statt delete + insert: gleichzeitiges Speichern erzeugt keine Dubletten.
  return db
    .insert(approvalRules)
    .values(input)
    .onConflictDoUpdate(
      input.botId
        ? {
            target: [
              approvalRules.userId,
              approvalRules.tool,
              approvalRules.botId,
            ],
            targetWhere: isNotNull(approvalRules.botId),
            set: { mode: input.mode },
          }
        : {
            target: [approvalRules.userId, approvalRules.tool],
            targetWhere: isNull(approvalRules.botId),
            set: { mode: input.mode },
          }
    )
}
