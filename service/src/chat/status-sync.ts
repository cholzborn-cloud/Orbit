import type { ServiceEvent } from "../events"

type StatusEvent = Extract<ServiceEvent, { type: "status" }>

// Chats, die auf den Nutzer warten (eigene offene Freigabe/Rückfrage oder die eines Unterauftrags), zeigen „wartet“,
// sonst „arbeitet“. Nur Chats, die laufen (`working`), ändern sich; `set` meldet den neuen Zustand.
export function alignWaiting(
  working: Map<string, StatusEvent>,
  waiting: Set<string>,
  set: (chatId: string, botId: string, status: "arbeitet" | "wartet") => void
) {
  for (const [chatId, event] of [...working]) {
    const next = waiting.has(chatId) ? "wartet" : "arbeitet"
    if (event.status !== next) set(chatId, event.botId, next)
  }
}
