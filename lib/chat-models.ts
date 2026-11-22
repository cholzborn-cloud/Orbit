import "server-only"

import { CHAT_MODELS, type ChatModel } from "@/lib/chat-catalog"
import { availableProviders } from "@/lib/cli/provider"

// Nur Modelle, deren CLI gerade vorhanden und angemeldet ist. Kein Ersatz, keine erfundenen IDs.
export async function getAvailableModels(): Promise<ChatModel[]> {
  try {
    const ok = await availableProviders()
    return CHAT_MODELS.filter((m) => ok.has(m.cli.provider))
  } catch {
    return []
  }
}
