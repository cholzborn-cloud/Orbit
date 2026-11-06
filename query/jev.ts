import { desc, eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { jevLog } from "@/lib/db/schema"

export async function listJevLog(userId: string, limit = 50) {
  return db.query.jevLog.findMany({
    where: eq(jevLog.userId, userId),
    orderBy: desc(jevLog.createdAt),
    limit: Math.max(0, Math.min(200, Math.floor(limit))),
  })
}
