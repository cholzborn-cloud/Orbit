import type { ChatMetadata } from "@/lib/chat-catalog"
import { CHAT_MODELS } from "@/lib/chat-catalog"
import { defaultSql } from "@/lib/chat/load-chat"
import { finalAnswerText } from "@/lib/chat/orbi-message"
import { getDatabase } from "@/lib/db/client"
import { loadCounters, saveCounters } from "@/lib/work/store"
import { AUTO_MODEL_ID } from "@/lib/jev/types"

import { EventHub, type ServiceEvent } from "../events"
import { alignWaiting } from "./status-sync"
import { InteractionManager, type InteractionDecision, type PendingInteraction } from "../interactions"
import { createApprovalStore, saveAlwaysRule } from "./approvals"
import { TurnBuffers } from "./buffer"
import {
  createDispatcher,
  type Group,
  type WakeRequest,
  type WakeResult,
} from "./dispatcher"
import { ChatReservations } from "./reservations"
import { createAutomationRunner } from "./automation-run"
import { interactionPersistence, storedInteractions } from "./persist-interactions"
import { createResume } from "./resume"
import { createRunTracker } from "./runs"
import { createGroupRunner } from "./group-runtime"
import { createTaskExecutor, type TaskExecutor } from "./executor"
import { createTask, finishTask } from "@/lib/work/tasks"
import type { createMessageStore } from "./store"
import { runTurn, type TurnRuntime } from "./turn"
import { Inbox, sqliteInboxStorage } from "./inbox"
import { createLane, type Lane, type LaneHandler } from "./lane"
import { askAnswerText } from "./restored"

export function createChatRuntime(
  store: ReturnType<typeof createMessageStore>
) {
  const turns = new TurnBuffers()
  const events = new EventHub()
  const reservations = new ChatReservations()
  const queue = reservations.queue
  const working = new Map<string, Extract<ServiceEvent, { type: "status" }>>()
  // Aktueller Schritt je Chat (für die Statusleiste nach dem Verbinden); fällt weg, sobald der Turn nicht mehr arbeitet.
  const live = new Map<string, string>() // Id der gerade gestreamten Antwort je Chat
  const steps = new Map<string, Extract<ServiceEvent, { type: "status-step" }>>()
  const approvalStore = createApprovalStore()
  const db = () => getDatabase().$client
  const runs = createRunTracker(db)
  const hooks: { syncWaiting?: (chatId: string, waiting: boolean) => void } = {}
  const manager = new InteractionManager({
    store: approvalStore,
    saveRule: saveAlwaysRule,
    persist: interactionPersistence(db),
    onRestoredDecision: (request, decision) => void continueRestored(request, decision),
    onChange: (request, decision) => {
      events.publish({
        ...request,
        type: request.kind === "approval" ? "approval" : "question",
        status: decision?.status ?? "pending",
        // „Immer erlauben“: die Karte zeigt danach „Immer erlaubt“ statt „Einmal erlaubt“ (Figma 04/teil-1).
        ...(decision?.status === "approved" && decision.always
          ? { always: true as const }
          : {}),
      })
      // Wiederhergestellte Karte: kein Turn dahinter, also weder „arbeitet“ noch „wartet“ am Orbi.
      if (request.restored) return
      const waiting = manager.list(request.chatId).length > 0
      runs.waiting(request.chatId, waiting)
      syncWaiting()
      void dispatcher.setWaiting(request.chatId, waiting)
      hooks.syncWaiting?.(request.chatId, waiting)
      status(
        request.chatId,
        request.botId,
        waiting
          ? "wartet"
          : decision?.status === "aborted"
            ? "ruhig"
            : "arbeitet"
      )
    },
  })
  // Endstatus („fertig“, „fehler“, „ruhig“) eines Laufs, während im selben Chat noch ein anderer Lauf arbeitet (Seitenlauf, Hauptlauf):
  // zurückhalten, sonst zeigt die App „fertig“, obwohl noch gearbeitet wird. Er erscheint, sobald der letzte Lauf des Chats endet.
  const heldFinal = new Map<string, Extract<ServiceEvent, { type: "status" }>>()
  function status(
    chatId: string,
    botId: string,
    state: Extract<ServiceEvent, { type: "status" }>["status"]
  ) {
    const event: Extract<ServiceEvent, { type: "status" }> = {
      type: "status",
      chatId,
      botId,
      status: state,
    }
    const final = state !== "arbeitet" && state !== "wartet"
    if (final && turns.runningKeys(chatId).length > 1) {
      heldFinal.set(chatId, event)
      return
    }
    heldFinal.delete(chatId)
    if (state === "arbeitet" || state === "wartet") working.set(chatId, event)
    else {
      working.delete(chatId)
      steps.delete(chatId)
      live.delete(chatId)
    }
    events.publish(event)
  }
  function syncWaiting() {
    const waiting = new Set(manager.list().map((request) => request.chatId))
    for (const chatId of working.keys())
      turns.setWaiting(chatId, waiting.has(chatId))
    alignWaiting(working, waiting, status)
  }
  const findGroup = async (id: string): Promise<Group | null> => {
    const sql = defaultSql()
    const [row] =
      (await sql`select id, name from chats where id = ${id} and user_id = ${"local"} and kind = 'group'`) as {
        id: string
        name: string | null
      }[]
    if (!row) return null
    const members =
      (await sql`select bot_id as "botId" from chat_members where chat_id = ${id}`) as {
        botId: string
      }[]
    return {
      id: row.id,
      name: row.name ?? "Gruppe",
      memberIds: members.map((m) => m.botId),
    }
  }
  // Eigenes Modell eines Orbis: das der letzten Antwort in seinem Chat (Anzeigename -> ID), sonst Jev.
  async function ownModel(chatId: string) {
    const list = await store.listMessages(chatId)
    const meta = list.findLast(
      (m) => m.role === "assistant" && m.metadata?.model
    )?.metadata as ChatMetadata | undefined
    if (meta?.jev) return { model: AUTO_MODEL_ID, effort: undefined }
    const model = CHAT_MODELS.find((m) => m.label === meta?.model)
    return model
      ? { model: model.id, effort: meta?.effort }
      : { model: AUTO_MODEL_ID, effort: undefined }
  }
  // Startet den geweckten Turn im 1:1-Chat des Ziels (der Chat ist schon reserviert) und wartet bis zu seinem Ende.
  // Wartezeit in der Warteschlange liegt davor: das Turn-Zeitlimit beginnt erst mit `turns.start`.
  const runWake = async (
    request: WakeRequest,
    release: () => void
  ): Promise<WakeResult> => {
    const task = dispatcher.task(request.taskId)
    try {
      const messages = await store.listMessages(request.chatId)
      const { model, effort } = task?.pinned ?? (await ownModel(request.chatId))
      let finished: WakeResult | undefined
      const started = turns.start(
        request.chatId,
        (signal) =>
          runTurn({
            chatId: request.chatId,
            messages,
            clientData: {
              model,
              effort,
              context: true,
              botId: request.bot.id,
            },
            internal: {
              ownerId: "local",
              rootTaskId: request.taskId,
              rootChatId: request.rootChatId,
              wake: { kind: request.kind, linkIds: request.linkIds },
              handoffFrom: request.fromBotIds[0],
            },
            runtime,
            signal,
            onFinish: async (event) => {
              await store.saveMessages(request.chatId, event.messages, {
                merge: true,
              })
              finished = {
                text: finalAnswerText(event.messages),
                failed: !event.isAborted && event.outcome.status === "failed",
                aborted: event.isAborted,
              }
            },
          }),
        release
      )
      if (!started) throw new Error("Chat ist belegt")
      await (
        await turns.response(request.chatId)
      )?.body?.pipeTo(new WritableStream())
      return (
        finished ?? {
          text: "failed: Der Turn wurde nicht abgeschlossen.",
          failed: true,
          aborted: task?.aborted ?? false,
        }
      )
    } catch (error) {
      release()
      throw error
    }
  }
  const dispatcher = createDispatcher({
    store,
    reserve: (chatId) => reservations.reserve(chatId),
    isBusy: (chatId) => reservations.queue.has(chatId),
    runWake,
    stopChat: (chatId) => turns.stop(chatId),
    // Kein Anwärmen der Sandbox mehr (Phase 5): sie startet erst beim ersten Sandbox-Werkzeug oder Datei-Upload.
    counters: {
      save: (counters) => saveCounters(db(), counters),
      load: (taskId) => loadCounters(db(), taskId),
    },
    saveTask: (t) => {
      createTask(db(), {
        id: t.id,
        orbiId: t.orbiId,
        parentChatId: t.parentChatId,
        parentTaskId: t.parentTaskId,
        brief: t.brief,
        title: t.title,
        mode: t.mode,
        reply: t.reply,
        status: t.status,
        assignedBotId: t.assignedBotId,
        doneWhen: t.doneWhen,
        answers: t.answers,
        rework: t.rework,
      })
    },
    updateTaskStatus: (id, status, result) => {
      finishTask(db(), id, status, result)
    },
    findGroup,
    publish: (event) => events.publish(event),
    onGroupMessage: (info) => groups.onGroupMessage(info),
  })
  const groups = createGroupRunner({
    store,
    turns,
    reservations,
    dispatcher,
    runtime: () => runtime,
    run: runTurn,
    publish: (event) => events.publish(event),
    ownModel,
  })
  const inbox = new Inbox(sqliteInboxStorage(db))
  let lane: Lane | undefined
  reservations.onRelease((chatId) => {
    dispatcher.onRelease(chatId)
    void groups.pump(chatId)
    // Danach (wenn Weckungen und Gruppenrunden ihren Zug hatten): wartende Nachrichten im Eingang bekommen ihren Folgelauf.
    setImmediate(() => void lane?.drain(chatId))
  })
  turns.onSettled((key) => {
    const chatId = key.split("~side~")[0]
    if (turns.runningKeys(chatId).length > 0) return
    const held = heldFinal.get(chatId)
    if (held) status(chatId, held.botId, held.status)
  })
  const runtime: TurnRuntime = {
    inbox,
    runs,
    manager,
    approvalStore,
    dispatcher,
    queue,
    status,
    publish: (event) => {
      if (event.type === "status-step") {
        if (event.state === "start") steps.set(event.chatId, event)
        else steps.delete(event.chatId)
      }
      events.publish(event)
    },
    checkpoint: (chatId, message) => store.upsertMessage(chatId, message),
    remove: (chatId, messageId) => store.removeMessage(chatId, messageId),
    live: (chatId, messageId) => {
      if (messageId) live.set(chatId, messageId)
      else live.delete(chatId)
    },
    reactions: {
      list: (chatId) => store.listReactions(chatId),
      set: async (chatId, messageId, actor, emoji) => {
        const ok = await store.setReaction(chatId, messageId, actor, emoji)
        if (ok)
          events.publish({ type: "reaction", chatId, messageId, actor, emoji })
        return ok
      },
    },
  }

  const executor: TaskExecutor = createTaskExecutor({
    getDb: db,
    store,
    dispatcher,
    publish: (event) => events.publish(event),
    runTurn,
    runtime,
    ownModel,
  })
  runtime.executor = executor

  // Bei Gruppenrunden bleibt der Chat nach der HTTP-Antwort reserviert, bis die übrigen Mitglieder gesprochen haben.
  const reserveRoot = (chatId: string) => {
    const release = reservations.reserve(chatId)
    return release && groups.wrapRelease(chatId, release)
  }
  // Jeder Turn aus einer Nachricht von Consti (oder Automation) ist ein neuer Auftrag; hat Consti das Modell
  // ausdrücklich gewählt (`modelPinned`), übernehmen es geweckte Orbis, sonst nutzt jeder sein eigenes.
  // Chat -> Auftrag des unterbrochenen Turns, dessen Zähler der nächste Root-Turn dieses Chats übernimmt („Weiter“).
  const resumeTasks = new Map<string, string>()
  const resume = createResume({
    getDb: db,
    listMessages: (chatId) => store.listMessages(chatId),
    noteResume: (chatId, taskId) => resumeTasks.set(chatId, taskId),
  })
  const runRoot = async (
    input: Omit<Parameters<typeof runTurn>[0], "runtime">
  ) => {
    const data = input.clientData
    const resumeTask = resumeTasks.get(input.chatId)
    resumeTasks.delete(input.chatId)
    const taskId = dispatcher.beginTask(
      input.chatId,
      data.modelPinned ? { model: data.model, effort: data.effort } : undefined,
      resumeTask
    )
    const internal = {
      ...input.internal,
      rootTaskId: taskId,
      rootChatId: input.chatId,
    }
    // Gruppenchat: alle Mitglieder bekommen die Nachricht, das erste (@-Markierte zuerst) liefert die HTTP-Antwort.
    const group = await groups.planFor(input)
    if (!group) return runTurn({ ...input, internal, runtime })
    const first = groups.rootRound(input, taskId, group.plan)
    return runTurn({
      ...input,
      clientData: { ...data, botId: first.botId },
      internal: { ...internal, groupTurn: first.groupTurn },
      onFinish: first.onFinish,
      runtime,
    })
  }
  // Zwischenfrage im selben Chat, während der Hauptturn noch läuft: eigener Auftrag, parallel, nur im Einzelchat.
  const runSide = async (input: Omit<Parameters<typeof runTurn>[0], "runtime">) => {
    if (await groups.planFor(input)) return Response.json({ error: "In diesem Chat läuft bereits eine Antwort." }, { status: 409 })
    const taskId = dispatcher.beginTask(input.chatId, input.clientData.modelPinned ? { model: input.clientData.model, effort: input.clientData.effort } : undefined)
    const release = dispatcher.hold(taskId)
    const onFinish = input.onFinish
    return runTurn({
      ...input,
      internal: { ...input.internal, rootTaskId: taskId, rootChatId: input.chatId, side: true },
      onFinish: async (event) => {
        try {
          await onFinish?.(event)
        } finally {
          release()
        }
      },
      runtime,
    })
  }
  // Wiederhergestellte Rückfrage (Lauf beim Neustart verloren) wurde beantwortet: die Antwort geht als Nachricht von Consti in den Chat
  // und startet einen Lauf (oder wartet im Eingang). Nichts wird wiederholt. Eine erteilte Freigabe startet bewusst NICHTS von selbst:
  // ein Neustart des Laufs würde frühere Werkzeuge noch einmal ausführen (Nebenwirkungen); dort gilt weiter „Weiter“, die Zustimmung
  // wird dann genau einmal für dieselbe Anfrage verwendet.
  async function continueRestored(request: PendingInteraction, decision: InteractionDecision) {
    if (!lane) return
    const chatId = request.chatId
    const { model, effort } = await ownModel(chatId)
    const hint = resume.interrupted(chatId)
    if (request.kind === "ask" && decision.status === "answered") {
      const text = askAnswerText(request.input, decision.answer)
      const ok = await lane.post(chatId, {
        trigger: "submit-message",
        messages: [{ id: crypto.randomUUID(), role: "user", parts: [{ type: "text", text }] }],
        clientData: { model, ...(effort && { effort }), context: true, botId: request.botId },
      })
      if (ok && hint) resume.started(hint.runId)
    }
  }
  // Consti tippt seine Antwort, während eine Rückfrage-Karte des laufenden Chats offen ist: der Text ist die Antwort (eine Frage) bzw.
  // die Karte gilt als übersprungen (mehrere Fragen; der Text kommt dann über den Eingang an der nächsten Schrittgrenze an).
  // Freigaben werden so nie entschieden.
  async function answerOpenCard(chatId: string, text: string): Promise<"answered" | "skipped" | null> {
    const card = manager.list(chatId).find((item) => item.kind === "ask" && !item.restored && !item.root)
    if (!card || !text.trim()) return null
    const questions = (card.input as { questions?: { question: string }[] })?.questions ?? []
    const answer =
      questions.length === 1
        ? { answers: [{ question: questions[0].question, answers: [text.trim().slice(0, 4000)] }] }
        : { skipped: true }
    const result = await manager.decide(card.id, { answer })
    return result.ok ? (questions.length === 1 ? "answered" : "skipped") : null
  }
  const automations = createAutomationRunner({
    store,
    turns,
    reserve: reserveRoot,
    runRoot,
    publish: (event) => events.publish(event),
    wakeParent: async ({ chatId, botId, text }) => {
      await dispatcher.send({
        taskId: crypto.randomUUID(),
        target: botId,
        message: text,
        priority: true,
        from: { id: botId, name: "Routine", avatar: "bot", color: null },
        fromChatId: chatId,
        team: [],
        wakeKind: "reply",
      })
    },
  })
  hooks.syncWaiting = automations.syncWaiting
  // Die Lauf-Steuerung braucht den Nachrichten-Eingang (handle-turn), der erst nach der Laufzeit entsteht.
  const connect = (handle: LaneHandler, clearing?: (chatId: string) => boolean) => {
    lane = createLane({
      turns,
      inbox,
      reserve: reserveRoot,
      handle,
      isGroup: async (chatId) => !!(await findGroup(chatId)),
      isBusy: (chatId) => reservations.queue.has(chatId),
      interrupted: (chatId) => !!resume.interrupted(chatId),
      clearing,
      removeMessage: (chatId, messageId) => store.removeMessage(chatId, messageId),
      answerOpenCard,
      hasOpenCard: (chatId) => manager.list(chatId).some((item) => item.kind === "ask" && !item.restored && !item.root),
    })
    return lane
  }
  return {
    connect,
    inbox,
    turns,
    resume,
    manager,
    events,
    runtime,
    runRoot,
    runSide,
    reserveRoot,
    dispatcher,
    liveMessageId: (chatId: string) => live.get(chatId),
    stopRoot: (chatId: string) => {
      void executor.stopTasks({ all: true, chatId })
      const chain = dispatcher.stopRoot(chatId)
      return groups.stop(chatId) || chain
    },
    automations,
    executor,
    snapshot: () => ({
      approvals: manager.list(),
      working: [...working.values()],
      steps: [...steps.values()],
      automations: automations.snapshot(),
      tasks: executor.getActive(),
    }),
  }
}
