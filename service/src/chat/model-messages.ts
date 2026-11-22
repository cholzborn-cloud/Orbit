import { convertToModelMessages, type ToolSet, type UIMessage } from "ai"

import { messagesForModel } from "../../../lib/chat/orbi-message.ts"

// Ein gestoppter Turn kann einen Werkzeugaufruf ohne Ergebnis im Verlauf lassen (Zustand input-available).
// Ohne ignoreIncompleteToolCalls scheitert jede neue Nachricht im selben Chat mit MissingToolResultsError.
// Gespeicherte Orbi-Zeilen und alte Übergabe-Teile werden vorher fürs Modell umgebaut (siehe messagesForModel).
export function toModelMessages(messages: UIMessage[], tools: ToolSet) {
  return convertToModelMessages(messagesForModel(messages), {
    tools,
    ignoreIncompleteToolCalls: true,
  })
}
