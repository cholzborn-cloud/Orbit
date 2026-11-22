// ABGESCHALTET (Lauf E, 01.11.2026): turn.ts ruft afterTurnIfDue nicht mehr auf.
// Grund: Der Aufruf schrieb nur einen Protokolleintrag („Nachricht enthält wahrscheinlich Merkenswertes“), nie ins Gedächtnis,
// kostete aber nach jedem Auto-Turn einen Netzaufruf an OpenRouter mit bis zu 2000 Zeichen Nutzertext.
// Das Gedächtnis schreibt der Orbi selbst im selben Turn per memory_save (mit Secret-Prüfung, Herkunft und stated-Prüfung).
// Wer es wieder braucht: erst memory_save mit looksLikeSecret (lib/orbi/memory.ts) davor schalten.
import { decide, type JevQuestion } from "./client"
import { logJev } from "./log"
import { AUTO_MODEL_ID, createJevInfo } from "./types"

export type AfterTurnPayload = { userId: string; chatId: string; text: string }

export function buildAfterTurnQuestions(): Record<string, JevQuestion> {
  return {
    memorable: {
      type: "noul",
      instructions:
        "Enthält die Nachricht eine dauerhafte Vorgabe, Präferenz oder einen Fakt, den sich der Assistent merken sollte?",
      criteria: { false: "Nein", true: "Ja" },
    },
  }
}

// Jev liefert Entscheidungen, keinen Text; Zusammenfassungen und Titel entfallen.
export async function runAfterTurn(
  payload: AfterTurnPayload,
  ask: typeof decide = decide,
  write: typeof logJev = logJev
) {
  const started = Date.now()
  const decision = await ask(buildAfterTurnQuestions(), {
    text: payload.text.slice(0, 2000),
  })
  const likelihood = decision.ok ? decision.answers.memorable?.noul : undefined
  if (typeof likelihood !== "number" || likelihood < 0.65) return false
  write({
    userId: payload.userId,
    chatId: payload.chatId,
    info: createJevInfo({
      kind: "memory",
      reason: `Jev: Nachricht enthält wahrscheinlich Merkenswertes (Sicherheit ${Math.round(likelihood * 100)} %)`,
      durationMs: decision.ok ? decision.durationMs : Date.now() - started,
    }),
  })
  return true
}

// Nur nach fertigen Auto-Turns mit Nutzertext, nie nach Übergaben; ohne Schlüssel oder bei ausgeschaltetem Auto kein Aufruf.
export function afterTurnIfDue(
  input: {
    userId: string
    chatId: string
    model: string
    handoffId?: string
    auto: boolean
    text: string
  },
  ask?: typeof decide,
  write?: typeof logJev
) {
  const { model, handoffId, auto, ...payload } = input
  if (
    model !== AUTO_MODEL_ID ||
    handoffId ||
    !auto ||
    !payload.text ||
    !process.env.OPENROUTER_JEV_API_KEY
  )
    return Promise.resolve(false)
  return runAfterTurn(payload, ask, write)
}
