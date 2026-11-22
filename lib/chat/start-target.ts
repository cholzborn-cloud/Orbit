export const LAST_CHAT_COOKIE = "orbit-last-chat"

export type StartChat = {
  id: string
  lastMessageAt: Date
  memberCount: number
}

// Ziel der Startseite aus den Chats des Nutzers (Eigentum ist damit geprüft): zuletzt geöffneter Chat laut Cookie,
// sonst der mit der neuesten Nachricht. Chats ohne Mitglied zählen nicht: die Chat-Seite schickt Direktchats ohne Orbi
// zurück auf "/", das wäre eine Endlosschleife. null = kein Ziel, also Onboarding.
export function pickStartChat(
  chats: StartChat[],
  lastChatId: string | undefined
): string | null {
  const usable = chats.filter((c) => c.memberCount > 0)
  const last = usable.find((c) => c.id === lastChatId)
  if (last) return last.id
  const newest = usable.reduce<StartChat | null>(
    (best, c) => (!best || c.lastMessageAt > best.lastMessageAt ? c : best),
    null
  )
  return newest?.id ?? null
}
