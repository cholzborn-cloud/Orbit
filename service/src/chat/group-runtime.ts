import type { UIMessage } from "ai"
import { nanoid } from "nanoid"

import type { ChatMetadata } from "@/lib/chat-catalog"
import { loadChat, type ChatBot, type ClientData } from "@/lib/chat/load-chat"
import {
  isSilent,
  planRound,
  type RoundPlan,
} from "@/lib/chat/group-round"
import { AUTO_MODEL_ID } from "@/lib/jev/types"
import { readLine } from "@/lib/chat/orbi-message"

import type { ServiceEvent } from "../events"
import type { Dispatcher } from "./dispatcher"
import { continueRound, type MemberOutcome, type MemberTurn } from "./group-round"
import type { ChatReservations } from "./reservations"
import type { createMessageStore } from "./store"
import type { TurnBuffers } from "./buffer"
import type { runTurn, TurnRuntime } from "./turn"
import { stripToolMarkup } from "../../../lib/cli/tool-protocol.ts"

type Msgs = UIMessage<ChatMetadata>[]
type RunInput = Omit<Parameters<typeof runTurn>[0], "runtime">
type Model = { model: string; effort?: string; modelPinned?: boolean }

const plainText = (message?: UIMessage) =>
  message?.parts.flatMap((p) => (p.type === "text" ? [stripToolMarkup(p.text)] : [])).join("\n") ?? ""

export function createGroupRunner(deps: {
  store: ReturnType<typeof createMessageStore>
  turns: TurnBuffers
  reservations: ChatReservations
  dispatcher: Dispatcher
  runtime: () => TurnRuntime
  run: typeof runTurn
  publish: (event: ServiceEvent) => void
  ownModel: (chatId: string) => Promise<{ model: string; effort?: string }>
}) {
  const { store, turns, reservations, dispatcher, publish } = deps
  // Gruppenchats, in denen die Runde nach dem Ende der HTTP-Antwort weiterläuft (siehe `reserveRoot`).
  const continuations = new Map<string, (release: () => void) => Promise<void>>()
  const stops = new Set<string>() // Stopp im Gruppenchat selbst (zusätzlich zum Auftrag)
  const rounds = new Set<string>() // Gruppenchats mit laufender oder wartender Fortsetzung
  const orbiJobs = new Map<string, (() => Promise<boolean>)[]>() // wartende Runden durch Orbi-Nachrichten
  const pumping = new Set<string>()
  const pumpAgain = new Set<string>()

  const aborted = (taskId: string, chatId: string) =>
    stops.has(chatId) || dispatcher.task(taskId)?.aborted === true

  async function notice(chatId: string, text: string) {
    const message = {
      id: nanoid(), role: "assistant", metadata: { createdAt: Date.now() },
      parts: [{ type: "data-notice", data: { kind: "error", text } }],
    } as unknown as UIMessage<ChatMetadata>
    await store.upsertMessage(chatId, message)
  }

  // Ein Mitglied spricht einen Turn im Gruppenchat (Verlauf frisch, also sieht es die Antworten davor).
  async function runMember(
    chatId: string,
    taskId: string,
    rootChatId: string,
    botId: string,
    turn: MemberTurn,
    model: Model,
    byOrbi: boolean
  ): Promise<MemberOutcome> {
    const outcome: MemberOutcome = { spoke: false, aborted: false, failed: true }
    const messages = await store.listMessages(chatId)
    let signal: AbortSignal | undefined
    publish({ type: "group-turn", chatId, phase: "start", botId })
    await new Promise<void>((resolve) => {
      const started = turns.start(
        chatId,
        (s) => {
          signal = s
          return deps.run({
            chatId,
            messages,
            clientData: { ...model, context: true, botId },
            internal: {
              ownerId: "local",
              rootTaskId: taskId,
              rootChatId,
              groupTurn: { ...turn, byOrbi },
            },
            runtime: deps.runtime(),
            signal: s,
            onFinish: async (event) => {
              const silent = isSilent(event.responseMessage)
              const keep = silent
                ? messages
                : [...messages, event.responseMessage]
              await store.saveMessages(chatId, keep as Msgs, { merge: true })
              outcome.aborted = event.isAborted
              outcome.failed = !event.isAborted && event.outcome.status === "failed"
              outcome.spoke = !silent && !outcome.failed
              publish({
                type: "group-turn",
                chatId,
                phase: silent ? "silent" : "reply",
                botId,
                ...(silent ? {} : { messageId: event.responseMessage.id }),
              })
            },
          } as Parameters<typeof deps.run>[0])
        },
        resolve
      )
      if (!started) resolve()
    })
    if (signal?.aborted) outcome.aborted = true
    return outcome
  }

  // Alle weiteren Mitglieder; endet mit der Freigabe des Gruppenchats.
  async function follow(input: {
    chatId: string
    taskId: string
    rootChatId: string
    plan: RoundPlan
    first: MemberOutcome | null
    model: (botId: string) => Promise<Model>
    requireAnswer: boolean
    byOrbi: boolean
    release: () => void
  }) {
    let stopped = false
    rounds.add(input.chatId)
    try {
      const result = await continueRound({
        plan: input.plan,
        first: input.first,
        requireAnswer: input.requireAnswer,
        isAborted: () => aborted(input.taskId, input.chatId),
        runMember: async (botId, turn) =>
          runMember(
            input.chatId,
            input.taskId,
            input.rootChatId,
            botId,
            turn,
            await input.model(botId),
            input.byOrbi
          ),
      })
      stopped = result.stopped
      const missing = input.plan.marked.filter(id => result.silent.includes(id))
      if (!stopped && (missing.length || (input.requireAnswer && result.spoke.length === 0))) {
        const context = await loadChat(input.chatId, { ownerId: "local", model: AUTO_MODEL_ID }).catch(() => null)
        const names = context?.members.filter(member => missing.includes(member.id)).map(member => member.name) ?? []
        const subject = names.length ? names.join(", ") : "Ein angesprochener Orbi"
        const verb = names.length > 1 ? "haben" : "hat"
        const text = missing.length ? `${subject} ${verb} nicht geantwortet. Bitte versuche es erneut.` : "Kein Orbi hat geantwortet. Bitte versuche es erneut."
        await notice(input.chatId, text)
      }
    } catch {
      stopped = aborted(input.taskId, input.chatId)
      if (!stopped) {
        console.error("Gruppenrunde fehlgeschlagen.")
        await notice(input.chatId, "Die Gruppenrunde konnte nicht abgeschlossen werden. Bitte versuche es erneut.").catch(() => console.error("Gruppenhinweis konnte nicht gespeichert werden."))
      }
    } finally {
      stops.delete(input.chatId)
      rounds.delete(input.chatId)
      publish({ type: "group-turn", chatId: input.chatId, phase: "end", stopped })
      input.release()
    }
  }

  // Plan für eine Nachricht von Consti im Gruppenchat; null = kein Gruppenchat (normaler Turn).
  async function planFor(input: RunInput): Promise<
    { plan: RoundPlan; members: ChatBot[] } | null
  > {
    const data = input.clientData as ClientData
    if (data.background) return null
    const ctx = await loadChat(input.chatId, { ...data, ownerId: "local" })
    if (!ctx.isGroup) return null
    const text = plainText(
      input.messages.findLast((m) => m.role === "user" && !readLine(m))
    )
    const plan = planRound({
      members: ctx.members,
      text,
      selected: data.botId,
    })
    return plan ? { plan, members: ctx.members } : null
  }

  // Erstes Mitglied = die HTTP-Antwort. Danach (nach Ende des Streams, Chat bleibt reserviert) die anderen.
  // Gibt zurück, womit der Aufrufer den ersten Turn startet.
  function rootRound(
    input: RunInput,
    taskId: string,
    plan: RoundPlan
  ): {
    botId: string
    groupTurn: NonNullable<ClientData["groupTurn"]>
    onFinish: NonNullable<RunInput["onFinish"]>
  } {
    const first = plan.order[0]!
    const data = input.clientData as ClientData
    const model: Model = {
      model: data.model,
      effort: data.effort,
      modelPinned: data.modelPinned,
    }
    return {
      botId: first,
      groupTurn: { marked: plan.marked.includes(first) },
      onFinish: async (event) => {
        const silent = isSilent(event.responseMessage)
        const keep = silent
          ? input.messages
          : [...input.messages, event.responseMessage]
        await input.onFinish?.({ ...event, messages: keep })
        const failed = event.outcome.status === "failed"
        publish({
          type: "group-turn",
          chatId: input.chatId,
          phase: silent ? "silent" : "reply",
          botId: first,
          ...(silent ? {} : { messageId: event.responseMessage.id }),
        })
        if (event.isAborted || failed) return
        const outcome: MemberOutcome = { spoke: !silent, aborted: false, failed: false }
        // Die Runde läuft weiter, sobald die HTTP-Antwort beendet ist und der Chat freigegeben würde.
        rounds.add(input.chatId)
        continuations.set(input.chatId, (release) =>
          follow({
            chatId: input.chatId,
            taskId,
            rootChatId: input.chatId,
            plan,
            first: outcome,
            model: async () => model,
            requireAnswer: true,
            byOrbi: false,
            release,
          })
        )
      },
    }
  }

  // Release-Hülle für den Chat: gibt es eine Fortsetzung, bleibt der Chat bis zu ihrem Ende reserviert.
  function wrapRelease(chatId: string, release: () => void) {
    return () => {
      const next = continuations.get(chatId)
      if (!next) return release()
      continuations.delete(chatId)
      void next(release)
    }
  }

  // Orbi schrieb an die Gruppe (send_message): die anderen Mitglieder sprechen nacheinander, Schweigen ist erlaubt.
  function onGroupMessage(info: {
    group: { id: string; name: string }
    fromBotId: string
    taskId: string
    text: string
  }) {
    const task = dispatcher.task(info.taskId)
    if (!task) return
    const releaseHold = dispatcher.hold(info.taskId)
    const job = async () => {
      const release = reservations.reserve(info.group.id)
      if (!release) return false
      try {
        if (aborted(info.taskId, info.group.id)) {
          stops.delete(info.group.id)
          release()
          releaseHold()
          return true
        }
        const ctx = await loadChat(info.group.id, { model: "", ownerId: "local" })
        const plan = planRound({
          members: ctx.members,
          text: info.text,
          exclude: info.fromBotId,
        })
        if (!plan) {
          release()
          releaseHold()
          return true
        }
        void follow({
          chatId: info.group.id,
          taskId: info.taskId,
          rootChatId: task.rootChatId,
          plan,
          first: null,
          requireAnswer: false,
          byOrbi: true,
          model: async (botId) => {
            if (task.pinned) return { ...task.pinned, modelPinned: true }
            const member = ctx.members.find((m) => m.id === botId)
            return member?.direct_chat_id
              ? await deps.ownModel(member.direct_chat_id)
              : { model: AUTO_MODEL_ID }
          },
          release: () => {
            release()
            releaseHold()
          },
        })
      } catch {
        if (!aborted(info.taskId, info.group.id)) {
          console.error("Gruppenrunde konnte nicht starten.")
          await notice(info.group.id, "Die Gruppenrunde konnte nicht gestartet werden. Bitte versuche es erneut.").catch(() => console.error("Gruppenhinweis konnte nicht gespeichert werden."))
          publish({ type: "group-turn", chatId: info.group.id, phase: "end", stopped: false })
        }
        release()
        releaseHold()
      }
      return true
    }
    const queue = orbiJobs.get(info.group.id) ?? []
    queue.push(job)
    orbiJobs.set(info.group.id, queue)
    void pump(info.group.id)
  }

  // Startet die nächste wartende Orbi-Runde, wenn der Gruppenchat frei ist (bei jeder Freigabe gerufen).
  async function pump(chatId: string) {
    if (pumping.has(chatId)) { pumpAgain.add(chatId); return }
    pumping.add(chatId)
    try {
      do {
        pumpAgain.delete(chatId)
        const queue = orbiJobs.get(chatId)
        const job = queue?.[0]
        if (!queue || !job) break
        if (await job()) {
          queue.shift()
          if (!queue.length) orbiJobs.delete(chatId)
          else if (!reservations.queue.has(chatId)) pumpAgain.add(chatId)
        }
      } while (pumpAgain.has(chatId))
    } finally {
      pumping.delete(chatId)
    }
  }

  return {
    planFor,
    rootRound,
    wrapRelease,
    onGroupMessage,
    pump,
    // Stopp im Gruppenchat: wirkt auf die Runde, auch wenn gerade kein Turn läuft.
    stop: (chatId: string) => {
      const active = rounds.has(chatId) || (orbiJobs.get(chatId)?.length ?? 0) > 0
      if (active) stops.add(chatId)
      return active
    },
  }
}
