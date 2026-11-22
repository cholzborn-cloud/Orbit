import { generateText } from "ai"

import { getDatabase } from "@/lib/db/client"
import { DREAM_MODEL, dueDreams, runDream, type DreamGenerate, type DreamResult } from "@/lib/orbi/dream"
import { cli } from "@/lib/cli/provider"

// Haiku über die claude-CLI, nie Jev oder OpenRouter: Gedächtnisinhalte gehen nur an die lokale CLI wie der Chat.
export const cliDreamGenerate: DreamGenerate = async ({ system, prompt, signal }) => {
  const result = await generateText({
    model: cli.chat(DREAM_MODEL),
    system,
    prompt,
    maxOutputTokens: 3000,
    abortSignal: signal,
  })
  return { text: result.text, usage: result.usage }
}

// Träumer im Takt des Dienstes: fällige Orbis nacheinander (nie zwei Modellaufrufe gleichzeitig), still, Fehler nur im Protokoll.
export function createDreamer(options: { generate?: DreamGenerate; now?: () => Date } = {}) {
  const generate = options.generate ?? cliDreamGenerate
  let chain: Promise<unknown> = Promise.resolve()
  const run = (botId: string): Promise<DreamResult> => {
    const next = chain.then(() => runDream({ db: getDatabase().$client, botId, generate, now: () => (options.now ? options.now().getTime() : Date.now()) }))
    chain = next.catch(() => {})
    return next
  }
  return {
    run,
    // Vom Takt gerufen; gibt zurück, was gestartet wurde (für Tests).
    tick(now: Date): Promise<DreamResult>[] {
      return dueDreams(getDatabase().$client, now).map((botId) =>
        run(botId).catch((): DreamResult => {
          console.error("Träumer fehlgeschlagen.")
          return { status: "error", error: "Träumer fehlgeschlagen." }
        })
      )
    },
  }
}
