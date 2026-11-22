import { tool } from "ai"
import { z } from "zod"

// Zwischennachricht an Consti: eigene Blase im Chat, kein Extra-Modellaufruf, Rückgabe "ok".
// (`send_message` gehört den Orbi-Nachrichten.) Der Teil `tool-say` bleibt in der Assistant-Nachricht des Turns.
export const SAY = "say"
export const SAY_LIMITS = { chars: 300, perTurn: 3, minGapMs: 20_000 } as const

export type SayOutput = { ok: true; at: number } | { ok: false; error: string }

export function createSayTool(now: () => number = Date.now) {
  let said = 0
  let lastAt = 0
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
      // Eine kurze Meldung am Anfang; weitere (höchstens 3 insgesamt) nur bei längeren Aufgaben und nicht dicht hintereinander.
      if (said >= 1 && now() - lastAt < SAY_LIMITS.minGapMs)
        return { ok: false, error: "Zu früh für eine weitere Meldung: arbeite weiter und fasse am Ende zusammen." }
      said++
      lastAt = now()
      return { ok: true, at: lastAt }
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value: output.ok ? "ok" : output.error,
    }),
  })
}
