import { tool } from "ai"
import { z } from "zod"

import { RISK_REASONS } from "../approvals/risk.ts"

export const CONFIRM_ACTION = "confirm_action"

// Klicks in der Sandbox sind frei; der letzte Klick zum Kaufen, Senden oder Posten geht über diese Karte.
export function confirmActionTool() {
  return tool({
    description:
      "Ask before the final click or key press in the sandbox desktop that buys, pays, sends, posts, publishes or deletes. Returns approved true/false; click only if approved.",
    inputSchema: z.object({
      reason: z
        .enum(RISK_REASONS)
        .describe(
          "Why: geld, veroeffentlichen, nachricht, loeschen, geheimnis or system"
        ),
      summary: z
        .string()
        .min(1)
        .max(300)
        .describe("One short German sentence: what exactly will happen"),
    }),
    // Erreicht nur nach Freigabe; abgelehnt liefert die Freigabe-Schicht approved: false.
    execute: async () => ({ approved: true }),
  })
}
