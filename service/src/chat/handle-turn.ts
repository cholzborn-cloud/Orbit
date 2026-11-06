import { validateUIMessages, type UIMessage } from "ai"
import { z } from "zod"

import type { ChatMetadata } from "@/lib/chat-catalog"
import { REPLY_QUOTE_CHARS, readLine } from "@/lib/chat/orbi-message"
import { bubbleText, reactionBaseId } from "@/lib/chat/reactions"

import type { createMessageStore } from "./store"
import { localClientDataSchema, runTurn } from "./turn"

const requestSchema = z.object({
  // Leer nur beim Onboarding-Start eines neuen Orbis (clientData.onboarding), sonst braucht ein Turn eine Nachricht.
  messages: z.array(z.unknown()).max(1000),
  clientData: localClientDataSchema,
  trigger: z
    .enum(["submit-message", "regenerate-message"])
    .default("submit-message"),
  messageId: z.string().max(200).optional(),
  replyTo: z.string().min(1).max(200).optional(),
})

export function createTurnHandler(
  store: ReturnType<typeof createMessageStore>,
  execute: (
    input: Omit<Parameters<typeof runTurn>[0], "runtime">
  ) => Promise<Response>,
  // Consti hat in diesem Chat geschrieben: er hat ihn gesehen (Seitenleiste: kein „neu“).
  onUserSeen?: (chatId: string) => void
) {
  return async ({
    chatId,
    body,
    signal,
  }: {
    chatId: string
    body: Record<string, unknown>
    signal: AbortSignal
  }) => {
    const parsed = requestSchema.safeParse(body)
    if (!parsed.success)
      return Response.json(
        { error: "Ungültige Chat-Anfrage." },
        { status: 400 }
      )
    const input = parsed.data
    let messages = await store.listMessages(chatId)
    const onboardingStart =
      input.trigger === "submit-message" &&
      input.messages.length === 0 &&
      input.clientData.onboarding === true &&
      messages.length === 0
    if (input.messages.length === 0 && !onboardingStart)
      return Response.json(
        { error: "Ungültige Chat-Anfrage." },
        { status: 400 }
      )
    if (onboardingStart) {
      // Kein Nutzertext: der Orbi beginnt von selbst (siehe turn.ts, Onboarding).
    } else if (input.trigger === "regenerate-message") {
      const index = input.messageId
        ? messages.findIndex((m) => m.id === input.messageId)
        : messages.length - 1
      if (index < 0)
        return Response.json(
          { error: "Nachricht nicht gefunden." },
          { status: 400 }
        )
      messages = messages.slice(
        0,
        messages[index]?.role === "assistant" ? index : index + 1
      )
      if (messages.at(-1)?.role !== "user")
        return Response.json(
          { error: "Keine Frage zum Wiederholen vorhanden." },
          { status: 400 }
        )
    } else {
      // Der gespeicherte Verlauf bleibt maßgeblich; der Browser darf keine Tool-Ergebnisse einschleusen.
      let incoming: UIMessage<ChatMetadata>[]
      try {
        incoming = await validateUIMessages<UIMessage<ChatMetadata>>({
          messages: input.messages.slice(-1),
        })
      } catch {
        return Response.json({ error: "Ungültige Nachricht." }, { status: 400 })
      }
      const user = incoming[0]
      if (
        user.role !== "user" ||
        !user.id ||
        user.id.length > 200 ||
        user.parts.some((part) => part.type !== "text" && part.type !== "file")
      )
        return Response.json(
          { error: "Es können nur Nutzernachrichten gesendet werden." },
          { status: 400 }
        )
      if (messages.some((m) => m.id === user.id))
        return Response.json(
          { error: "Diese Nachricht ist bereits gespeichert." },
          { status: 409 }
        )
      // `replyTo` darf eine einzelne Blase nennen (`<id>~t<n>`, `<id>~<toolCallId>`): zitiert wird nur deren Text, gespeichert die Nachrichten-Id.
      const target = input.replyTo ? messages.find((message) => message.id === reactionBaseId(input.replyTo!)) : undefined
      if (input.replyTo && (!target || readLine(target) || !["user", "assistant"].includes(target.role)))
        return Response.json({ error: "Die zitierte Nachricht wurde nicht gefunden." }, { status: 400 })
      const quote = target && bubbleText(target as never, input.replyTo!, "\n").trim().slice(0, REPLY_QUOTE_CHARS)
      if (target && !quote) return Response.json({ error: "Diese Nachricht enthält keinen zitierbaren Text." }, { status: 400 })
      messages = [
        ...messages,
        {
          id: user.id,
          role: "user",
          parts: user.parts,
          ...((input.clientData.skill || target) ? { metadata: {
            ...(input.clientData.skill && { skill: input.clientData.skill }),
            ...(target && { replyTo: target.id, replyQuote: { role: target.role as "user" | "assistant", text: quote! } }),
          } } : {}),
        },
      ]
    }
    // Zeilen („gesendet an“, „Nachricht von“) können jederzeit dazukommen: nie überschreiben, außer bei Regeneration.
    const merge = input.trigger === "submit-message"
    await store.saveMessages(chatId, messages, { merge })
    try {
      onUserSeen?.(chatId)
    } catch {
      console.error("Gesehen-Zeitpunkt konnte nicht gespeichert werden.")
    }
    return execute({
      chatId,
      messages,
      clientData: input.clientData,
      signal,
      onFinish: async ({ messages }) => {
        await store.saveMessages(chatId, messages, { merge: true })
      },
    })
  }
}
