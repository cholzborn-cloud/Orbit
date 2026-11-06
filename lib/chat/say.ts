import { tool } from "ai"
import { z } from "zod"

// Zwischennachricht an Consti: eigene Blase im Chat, kein Extra-Modellaufruf, Rückgabe "ok".
// (`send_message` gehört den Orbi-Nachrichten.) Der Teil `tool-say` bleibt in der Assistant-Nachricht des Turns.
export const SAY = "say"
export const SAY_LIMITS = { chars: 300, perTurn: 5 } as const

export type SayOutput = { ok: true; at: number } | { ok: false; error: string }

export function createSayTool(now: () => number = Date.now) {
  let said = 0
  return tool({
    description:
      "Send the user a short interim message right now (one bubble): a quick start line or a milestone. Not for the final answer.",
    inputSchema: z.object({
      text: z
        .string()
        .min(1)
        .max(SAY_LIMITS.chars)
        .describe("1-2 short sentences, max 300 characters"),
    }),
    execute: async ({ text }): Promise<SayOutput> => {
      if (!text.trim()) return { ok: false, error: "Leerer Text." }
      if (said >= SAY_LIMITS.perTurn)
        return { ok: false, error: "Fasse am Ende zusammen." }
      said++
      return { ok: true, at: now() }
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value: output.ok ? "ok" : output.error,
    }),
  })
}
