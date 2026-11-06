import { db } from "@/lib/db"
import { searchMessagesIn } from "@/lib/search/messages"

export async function searchMessages(userId: string, q: string, limit = 20) {
  return searchMessagesIn(db.$client, userId, q, limit)
}
