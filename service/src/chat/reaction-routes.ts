import type { Hono } from "hono"

import {
  isReactionEmoji,
  reactionBaseId,
  USER_ACTOR,
  type Reaction,
  type ReactionEmoji,
} from "../../../lib/chat/reactions.ts"
import type { UIMessage } from "ai"
import { defaultSql } from "../../../lib/chat/load-chat.ts"
import type { ServiceEvent } from "../events.ts"
import type { PendingInteraction } from "../interactions.ts"

// Consti reagiert 👍/👎 auf eine offene Auswahlkarte oder Ja/Nein-Frage: das zählt als Antwort (👍 = Ja bzw. die Empfehlung,
// 👎 = Nein). Mehrere Fragen oder keine eindeutige Option: keine Antwort, die Reaktion bleibt nur ein Gefühl.
export function answerFromReaction(
  ask: Pick<PendingInteraction, "input">,
  emoji: string
): { question: string; answers: string[] }[] | null {
  if (emoji !== "👍" && emoji !== "👎") return null
  const questions = (
    ask.input as {
      questions?: {
        question: string
        multiple?: boolean
        options: { label: string; recommended?: boolean }[]
      }[]
    }
  )?.questions
  if (!questions || questions.length !== 1) return null
  const [q] = questions
  const yes = q.options.find((o) => /^\s*(ja|yes)\b/i.test(o.label))
  const no = q.options.find((o) => /^\s*(nein|no)\b/i.test(o.label))
  const pick =
    emoji === "👍" ? (yes ?? q.options.find((o) => o.recommended)) : no
  return pick ? [{ question: q.question, answers: [pick.label] }] : null
}

type Deps = {
  store: {
    ownsChat(chatId: string): Promise<boolean>
    listMessages(chatId: string): Promise<UIMessage[]>
    listReactions(chatId: string): Promise<Reaction[]>
    setReaction(
      chatId: string,
      messageId: string,
      actor: string,
      emoji: ReactionEmoji,
      options?: { requireExisting?: boolean }
    ): Promise<boolean>
    removeReaction(chatId: string, messageId: string, actor: string): Promise<boolean>
  }
  publish: (event: ServiceEvent) => void
  // Id der Antwort, die in diesem Chat gerade gestreamt wird (sie hält die offene Karte).
  liveMessageId?: (chatId: string) => string | undefined
  interactions?: {
    list(chatId?: string): PendingInteraction[]
    decide(id: string, value: { answer: unknown }): Promise<{ ok: boolean }>
  }
}

// Reaktionen und Onboarding-Überspringen; Eigentümer-Prüfung selbst, da diese Routen vor der Chat-Prüfung der App stehen.
export function registerReactionRoutes(app: Hono, deps: Deps) {
  const { store } = deps
  // Onboarding überspringen (Knopf auf der Karte): einmalig, danach nie wieder.
  app.post("/v1/bots/:id/onboarding", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { action?: unknown } | null
    if (body?.action !== "skip") return c.json({ error: "Ungültige Anfrage." }, 400)
    const botId = c.req.param("id")
    const sql = defaultSql()
    const rows = await sql`update bots set onboarding_done = 1 where id = ${botId} and user_id = ${"local"} returning id`
    if (!rows.length) return c.json({ error: "Orbi nicht gefunden." }, 404)
    deps.publish({ type: "onboarding", botId, done: true, instructions: false })
    return c.json({ ok: true })
  })
  app.get("/v1/chats/:id/reactions", async (c) => {
    const chatId = c.req.param("id")
    if (!(await store.ownsChat(chatId)))
      return c.json({ error: "Chat nicht gefunden." }, 404)
    return c.json({ reactions: await store.listReactions(chatId) })
  })
  app.put("/v1/chats/:id/messages/:messageId/reaction", async (c) => {
    const chatId = c.req.param("id")
    const messageId = c.req.param("messageId")
    if (!(await store.ownsChat(chatId)))
      return c.json({ error: "Chat nicht gefunden." }, 404)
    const body = (await c.req.json().catch(() => null)) as { emoji?: unknown } | null
    if (!isReactionEmoji(body?.emoji))
      return c.json({ error: "Ungültige Reaktion." }, 400)
    const emoji = body.emoji
    const live = deps.liveMessageId?.(chatId) === reactionBaseId(messageId)
    if (!(await store.setReaction(chatId, messageId, USER_ACTOR, emoji, { requireExisting: !live })))
      return c.json({ error: "Nachricht nicht gefunden." }, 404)
    deps.publish({ type: "reaction", chatId, messageId, actor: USER_ACTOR, emoji })
    // Antwort auf eine offene Karte dieser Nachricht? Nur wenn die Nachricht die Karte wirklich enthält.
    let answered = false
    const asks = deps.interactions?.list(chatId).filter((i) => i.kind === "ask") ?? []
    if (live && asks.length && (emoji === "👍" || emoji === "👎")) {
      const ask = asks[0]
      const answers = answerFromReaction(ask, emoji)
      if (answers) {
        const result = await deps.interactions!.decide(ask.id, { answer: { answers } })
        answered = result.ok
      }
    }
    return c.json({ ok: true, answered })
  })
  app.delete("/v1/chats/:id/messages/:messageId/reaction", async (c) => {
    const chatId = c.req.param("id")
    const messageId = c.req.param("messageId")
    if (!(await store.ownsChat(chatId)))
      return c.json({ error: "Chat nicht gefunden." }, 404)
    const removed = await store.removeReaction(chatId, messageId, USER_ACTOR)
    if (removed)
      deps.publish({ type: "reaction", chatId, messageId, actor: USER_ACTOR, emoji: null })
    return c.json({ ok: true, removed })
  })
}
