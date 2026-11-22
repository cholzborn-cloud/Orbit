import type { UIMessage } from "ai"

import { tagAutomationPrompt } from "@/lib/automations/tag"
import type { ChatMetadata } from "@/lib/chat-catalog"
import {
  claimAutomation,
  createAutomationChat,
  pruneRuns,
  setRunStatus,
} from "@/lib/db/automations"
import { defaultSql } from "@/lib/chat/load-chat"
import { AUTO_MODEL_ID } from "@/lib/jev/types"

import type { ServiceEvent } from "../events"
import type { TurnBuffers } from "./buffer"
import type { createMessageStore } from "./store"
import type { runTurn } from "./turn"

type RunEvent = Extract<ServiceEvent, { type: "automation" }>
type Claimed = {
  id: string
  bot_id: string
  name: string
  prompt: string
  target: string
  model: string | null
  effort: string | null
  context: boolean
  chat_id: string | null
  runId: string
}

type Deps = {
  store: ReturnType<typeof createMessageStore>
  turns: TurnBuffers
  reserve: (chatId: string) => (() => void) | undefined
  runRoot: (
    input: Omit<Parameters<typeof runTurn>[0], "runtime">
  ) => Promise<Response>
  publish: (event: ServiceEvent) => void
  wakeParent?: (input: {
    chatId: string
    botId: string
    text: string
    kind?: "routine" | "event"
    needsInput?: boolean
  }) => Promise<void>
  // Wartezeit auf einen belegten Chat, bevor der Lauf aufgibt.
  busyWaitMs?: number
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export function createAutomationRunner(deps: Deps) {
  const active = new Map<string, RunEvent>()
  const byChat = new Map<string, string>()
  const emit = (event: RunEvent) => {
    if (event.status === "running" || event.status === "waiting")
      active.set(event.runId, event)
    else active.delete(event.runId)
    deps.publish(event)
  }

  async function execute(a: Claimed, trigger: RunEvent["trigger"]) {
    const base = {
      type: "automation" as const,
      automationId: a.id,
      runId: a.runId,
      trigger,
    }
    let chatId = a.chat_id
    try {
      const sql = defaultSql()
      if (a.target === "new" || !chatId) {
        const [created] = createAutomationChat(a.runId, crypto.randomUUID())
        if (!created)
          throw new Error("Automationschat konnte nicht angelegt werden")
        chatId = created.chatId
      } else {
        const [valid] =
          (await sql`select c.id from chats c join chat_members m on m.chat_id = c.id where c.id = ${chatId} and c.user_id = ${"local"} and m.bot_id = ${a.bot_id}`) as {
            id: string
          }[]
        if (!valid) {
          const [direct] =
            (await sql`select c.id from chats c join chat_members m on m.chat_id = c.id where c.user_id = ${"local"} and c.kind = 'direct' and m.bot_id = ${a.bot_id} limit 1`) as {
              id: string
            }[]
          if (!direct) throw new Error("Ziel-Chat nicht mehr vorhanden")
          chatId = direct.id
        }
        await sql`update automation_runs set chat_id = ${chatId} where id = ${a.runId} and status = 'running'`
      }
      const runChat = chatId
      byChat.set(runChat, a.runId)
      emit({ ...base, chatId: runChat, status: "running" })
      const release = await reserveChat(runChat)
      const messages: UIMessage<ChatMetadata>[] = [
        ...(await deps.store.listMessages(runChat)),
        {
          id: crypto.randomUUID(),
          role: "user",
          metadata: { createdAt: Date.now(), automation: { automationId: a.id, runId: a.runId, name: a.name, status: "running", startedAt: Date.now() } },
          parts: [
            { type: "text", text: tagAutomationPrompt(a.name, a.prompt) },
          ],
        },
      ]
      let finished: { failed: boolean } | undefined
      let lastAnswerText = ""
      try {
        await deps.store.saveMessages(runChat, messages, { merge: true })
        const started = deps.turns.start(
          runChat,
          (signal) =>
            deps.runRoot({
              chatId: runChat,
              messages,
              clientData: {
                model: a.model ?? "claude-haiku-5-5",
                effort:
                  a.model === AUTO_MODEL_ID
                    ? undefined
                    : (a.effort ?? "medium"),
                context: a.context,
                botId: a.bot_id,
              },
              internal: { background: true, automationRunId: a.runId },
              signal,
              onFinish: async (event) => {
                await deps.store.saveMessages(runChat, event.messages, {
                  merge: true,
                })
                const assistantMsg = event.messages
                  .filter((m) => m.role === "assistant")
                  .at(-1)
                if (assistantMsg) {
                  lastAnswerText = assistantMsg.parts
                    .filter((p) => p.type === "text")
                    .map((p) => (p as { text: string }).text)
                    .join("\n")
                    .trim()
                }
                finished = {
                  failed: event.isAborted || event.outcome.status === "failed",
                }
              },
            }),
          release
        )
        if (!started) throw new Error("Chat ist belegt")
      } catch (error) {
        release()
        throw error
      }
      // Bis zum Ende lesen; der Puffer hält den Turn auch für Live-Leser im Chat.
      await (
        await deps.turns.response(runChat)
      )?.body?.pipeTo(new WritableStream())
      if (!finished || finished.failed) throw new Error("Lauf abgebrochen")

      const trimmed = lastAnswerText.trim()
      // Protokoll NOTHING NEW: nichts posten, stiller Erfolg
      if (trimmed.startsWith("NOTHING NEW") || trimmed === "NOTHING NEW") {
        setRunStatus(a.runId, "ok")
        emit({ ...base, chatId: runChat, status: "ok" })
        return
      }

      // Protokoll NEEDS INPUT: Rückfrage an den Nutzer, Eltern wecken
      if (trimmed.startsWith("NEEDS INPUT:")) {
        const question = trimmed.slice("NEEDS INPUT:".length).trim()
        setRunStatus(a.runId, "ok")
        emit({ ...base, chatId: runChat, status: "ok" })
        if (deps.wakeParent) {
          await deps.wakeParent({
            chatId: runChat,
            botId: a.bot_id,
            text: `[routine] NEEDS INPUT: ${question}`,
            kind: "routine",
            needsInput: true,
          })
        }
        return
      }

      // Normales Ergebnis: Eltern wecken mit [routine]
      setRunStatus(a.runId, "ok")
      emit({ ...base, chatId: runChat, status: "ok" })
      if (deps.wakeParent) {
        await deps.wakeParent({
          chatId: runChat,
          botId: a.bot_id,
          text: `[routine] ${a.name}: ${trimmed}`,
          kind: "routine",
        })
      }
    } catch (error) {
      const message =
        error instanceof Error &&
        ["Ziel-Chat nicht mehr vorhanden", "Lauf abgebrochen"].includes(
          error.message
        )
          ? error.message
          : "Der Lauf ist fehlgeschlagen."
      console.error("Automationslauf fehlgeschlagen:", error)
      setRunStatus(a.runId, "error", message)
      emit({ ...base, chatId, status: "error", error: message })
    } finally {
      if (chatId) byChat.delete(chatId)
      pruneRuns(a.id)
    }
  }

  async function reserveChat(chatId: string) {
    const until = Date.now() + (deps.busyWaitMs ?? 60_000)
    for (;;) {
      const release = deps.reserve(chatId)
      if (release) return release
      if (Date.now() > until) throw new Error("Chat ist belegt")
      await sleep(500)
    }
  }

  return {
    // Der Claim läuft sofort (so antwortet "Jetzt ausführen" ehrlich); der Lauf selbst im Hintergrund.
    start(automationId: string, trigger: RunEvent["trigger"]) {
      const [claimed] = claimAutomation(
        automationId,
        trigger,
        crypto.randomUUID()
      ) as Claimed[]
      if (!claimed) return null
      return { runId: claimed.runId, done: execute(claimed, trigger) }
    },
    // Offene Freigaben/Rückfragen im Chat des Laufs: Status "waiting".
    syncWaiting(chatId: string, waiting: boolean) {
      const runId = byChat.get(chatId)
      const event = runId && active.get(runId)
      if (!event || event.status === (waiting ? "waiting" : "running")) return
      const status = waiting ? "waiting" : "running"
      setRunStatus(event.runId, status)
      emit({ ...event, status })
    },
    snapshot: () => [...active.values()],
  }
}
