import { and, desc, eq, isNotNull, isNull, sql } from "drizzle-orm"

import { db } from "@/lib/db"
import { automationRuns, automations, bots } from "@/lib/db/schema"

export const listAutomations = (userId: string) =>
  db
    .select({
      automation: automations,
      bot: { id: bots.id, name: bots.name, avatar: bots.avatar },
    })
    .from(automations)
    .innerJoin(bots, eq(automations.botId, bots.id))
    .where(and(eq(automations.userId, userId), isNull(automations.deletedAt)))
    .orderBy(desc(automations.createdAt))
export const listTrash = (userId: string) =>
  db
    .select({
      automation: automations,
      bot: { id: bots.id, name: bots.name, avatar: bots.avatar },
    })
    .from(automations)
    .innerJoin(bots, eq(automations.botId, bots.id))
    .where(
      and(eq(automations.userId, userId), isNotNull(automations.deletedAt))
    )
    .orderBy(desc(automations.deletedAt))
export const listRuns = (userId: string, automationId: string) =>
  db
    .select()
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.userId, userId),
        eq(automationRuns.automationId, automationId)
      )
    )
    .orderBy(desc(automationRuns.startedAt))
    .limit(20)

// Grund, warum ein Lauf nicht startet; null = startbar.
export async function runBlocker(userId: string, id: string) {
  const row = await db.query.automations.findFirst({
    where: and(eq(automations.id, id), eq(automations.userId, userId)),
  })
  if (!row || row.deletedAt) return "Automation nicht gefunden."
  const [active] = await db
    .select({ id: automationRuns.id })
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.automationId, id),
        eq(automationRuns.userId, userId),
        sql`${automationRuns.status} in ('running','waiting')`
      )
    )
    .limit(1)
  return active ? "Ein Lauf läuft noch oder wartet auf Freigabe." : null
}

// Fertige Läufe mit App-Hinweis seit `since` (höchstens 24 h zurück).
export async function countUnreadRuns(userId: string, since: number) {
  const rows = await db
    .select({ count: sql<number>`count(*)` })
    .from(automationRuns)
    .where(
      and(
        eq(automationRuns.userId, userId),
        sql`${automationRuns.status} in ('ok','error')`,
        sql`exists (select 1 from automations a where a.id = ${automationRuns.automationId} and a.notify = 'app')`,
        sql`${automationRuns.finishedAt} > ${Math.max(since, Date.now() - 86_400_000)}`
      )
    )
  return rows[0]?.count ?? 0
}
