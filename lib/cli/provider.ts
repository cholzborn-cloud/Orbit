import { CHAT_MODELS, type ChatModel } from "../chat-catalog.ts"
import { cliModel } from "./model.ts"
import { checkAllClis } from "./status.ts"
import type { CliProvider } from "./types.ts"

let cache: { at: number; ok: Set<CliProvider> } | undefined
export const resetAvailability = () => {
  cache = undefined
}

// Welche CLIs gerade nutzbar sind (60 s zwischengespeichert).
export async function availableProviders(): Promise<Set<CliProvider>> {
  if (cache && Date.now() - cache.at < 60_000) return cache.ok
  const states = await checkAllClis()
  cache = { at: Date.now(), ok: new Set(states.filter((s) => s.state === "ok" || s.available === true).map((s) => s.provider)) }
  return cache.ok
}

// Einzige Stelle, an der Orbit ein Modell bekommt. Tests ersetzen `chat` und `available` durch Attrappen.
export const cli = {
  chat: (id: string) => cliModel(id),
  available: async (model: ChatModel): Promise<boolean> => (await availableProviders()).has(model.cli.provider),
}

// Rückfall, wenn die CLI des gewählten Modells nicht nutzbar ist: nur wenn Consti das Modell nicht fest gewählt hat (modelPinned).
// Reihenfolge: gleiche Stufe zuerst nicht nötig, daher einfach: Sonnet, dann Sol, dann das erste nutzbare Modell.
export async function usableModel(model: ChatModel, pinned: boolean): Promise<{ model: ChatModel; fellBack: boolean; error?: undefined } | { error: string }> {
  if (await cli.available(model)) return { model, fellBack: false }
  if (!pinned) {
    for (const id of ["claude-sonnet-5-5", "gpt-6.1-sol", ...CHAT_MODELS.map((m) => m.id)]) {
      const candidate = CHAT_MODELS.find((m) => m.id === id)
      if (candidate && candidate.id !== model.id && (await cli.available(candidate))) return { model: candidate, fellBack: true }
    }
  }
  return { error: "unavailable" }
}
