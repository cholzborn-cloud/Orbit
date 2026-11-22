import { eq } from "drizzle-orm"

import { db } from "@/lib/db"
import { skills } from "@/lib/db/schema"

export function listSkills(userId: string) {
  return db
    .select({
      id: skills.id,
      name: skills.name,
      description: skills.description,
      body: skills.body,
      createdAt: skills.createdAt,
      updatedAt: skills.updatedAt,
    })
    .from(skills)
    .where(eq(skills.userId, userId))
    .orderBy(skills.name)
}
