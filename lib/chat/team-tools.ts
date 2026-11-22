import type { ToolSet } from "ai"

import type { ChatContext } from "@/lib/chat/load-chat"
import { ASSIGNMENT_STATUS, createAssignmentStatusTool, createHandOffTool, HAND_OFF } from "@/lib/chat/hand-off"
import { createSendMessageTool, SEND_MESSAGE } from "@/lib/chat/send-message"

// Team-Werkzeuge (Nachricht, Übergabe, Auftragsstand): gibt es nur mit mehr als einem Orbi. Echter Turn und Prompt-Vorschau
// bauen sie hier gemeinsam, damit die Vorschau nicht von der Wirklichkeit abweicht.
type Deps = {
  send: Parameters<typeof createSendMessageTool>[0]
  handOff: Parameters<typeof createHandOffTool>[0]
  status: Parameters<typeof createAssignmentStatusTool>[0]
}

export function teamTools(ctx: Pick<ChatContext, "team">, deps: Deps): ToolSet {
  if (ctx.team.length <= 1) return {}
  return {
    [SEND_MESSAGE]: createSendMessageTool(deps.send),
    [HAND_OFF]: createHandOffTool(deps.handOff),
    [ASSIGNMENT_STATUS]: createAssignmentStatusTool(deps.status),
  }
}
