import { tool } from "ai"
import { z } from "zod"

import { LIMITS } from "./orbi-message.ts"

export const SEND_MESSAGE = "send_message"

export type DeliverInput = {
  target: string
  message: string
  priority: boolean
  mode?: "work" | "consult" | "notify"
  reply?: "resume" | "none"
  title?: string
  done_when?: string
  answers?: string
  rework?: string
  parent_task_id?: string
}
export type DeliverResult =
  | {
      ok: true
      to: string
      linkId: string
      assignmentId?: string
      // wake = Ziel wird geweckt, queued = Ziel arbeitet noch, held = wird beim nächsten Turn gelesen, group = an die Gruppe
      delivery: "wake" | "queued" | "held" | "group"
      mode?: "work" | "consult" | "notify"
      reply?: "resume" | "none"
    }
  | { ok: false; error: string }

export type SendMessageOutput = DeliverResult | { ok: false; error: string }

// Fire-and-forget: kehrt sofort zurück. Zustellung, Zeilen, Limits und Weckmechanik liegen im Dienst (`deliver`).
// Das Limit je Turn gilt hier (das Werkzeug entsteht je Turn neu), alles andere im Dispatcher.
// Die Verhaltensregel (nicht warten, Antwort weckt) steht in der Beschreibung, wie bei Grok.
export function createSendMessageTool(deliver: (input: DeliverInput) => Promise<DeliverResult>) {
  let sent = 0
  return tool({
    description: `Schickt eine kurze Nachricht oder Aufgabe an einen anderen Orbi (id oder Name) oder an eine Gruppe und wartet nicht. Beende nach dem Senden deinen Turn. Die Antwort weckt dich automatisch, also pollst und wartest du nicht. Mit priority=true weckst du das Ziel sofort, mit false liest es die Nachricht bei seinem nächsten Turn.`,
    inputSchema: z.object({
      target: z.string().describe("Orbi id or exact name, or a group id"),
      message: z
        .string()
        .max(LIMITS.messageChars)
        .describe(
          "Core point first: goal, files, wanted result. Self-contained."
        ),
      priority: z
        .boolean()
        .describe("true = wake the target now, false = it reads this later"),
      mode: z
        .enum(["work", "consult", "notify"])
        .optional()
        .describe("Optional mode: work, consult or notify."),
      reply: z
        .enum(["resume", "none"])
        .optional()
        .describe("Optional reply: resume (default) or none."),
      title: z.string().optional().describe("Optional task title."),
      done_when: z.string().optional().describe("Optional completion condition."),
    }),
    execute: async (input): Promise<SendMessageOutput> => {
      if (sent >= LIMITS.sentPerTurn)
        return {
          ok: false,
          error: `Limit erreicht: höchstens ${LIMITS.sentPerTurn} Nachrichten je Turn. Berichte Consti kurz, was noch offen ist.`,
        }
      // Zähler vor dem await erhöhen: parallele Aufrufe im selben Schritt sehen sonst alle „0“ und umgehen das Limit.
      sent++
      try {
        const result = await deliver(input)
        if (!result.ok) sent--
        return result
      } catch (error) {
        sent--
        throw error
      }
    },
    toModelOutput: ({ output }) => ({
      type: "text",
      value: output.ok
        ? `Sent to ${output.to} (${output.delivery}). Do not wait; the reply arrives later as a new message. Tell the user in one short line what was sent to whom, then end your turn.`
        : `Not sent: ${output.error}`,
    }),
  })
}
