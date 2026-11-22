import { CHAT_MODELS, type ChatModel } from "../chat-catalog.ts"
import { failoverModel, resetProviderHealth } from "./failover.ts"
import { checkAllClis } from "./status.ts"
import type { CliProvider } from "./types.ts"

let cache: { at: number; ok: Set<CliProvider>; allOk: boolean } | undefined
export const resetAvailability = () => {
  cache = undefined
  resetProviderHealth()
}

// Welche CLIs gerade nutzbar sind (60 s zwischengespeichert; ein Fehlschlag nur 15 s, damit ein kurzer Aussetzer nicht eine Minute „Codex fehlt“ bedeutet).
export async function availableProviders(): Promise<Set<CliProvider>> {
  if (cache && Date.now() - cache.at < (cache.allOk ? 60_000 : 15_000)) return cache.ok
  const states = await checkAllClis()
  const ok = new Set(states.filter((s) => s.state === "ok" || s.available === true).map((s) => s.provider))
  cache = { at: Date.now(), ok, allOk: ok.size === states.length }
  return cache.ok
}

// Einzige Stelle, an der Orbit ein Modell bekommt. Tests ersetzen `chat` und `available` durch Attrappen.
export const cli = {
  chat: (id: string, pinned = false) => failoverModel(id, undefined, pinned),
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
