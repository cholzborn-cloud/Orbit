import type { ChatBot } from "../../../lib/chat/load-chat.ts"
import {
  clip,
  isQuestionOrResult,
  LIMITS,
  makeToken,
  type LinePeer,
  type LineStatus,
  type OrbiLine,
} from "../../../lib/chat/orbi-message.ts"
import type {
  DeliverInput,
  DeliverResult,
} from "../../../lib/chat/send-message.ts"
import type { ServiceEvent } from "../events.ts"

// Zustellung von Orbi-Nachrichten: Zeilen in beiden Chats, Weckmechanik, Warteschlange, Grenzen, Stopp.
// Kein Wissen über Modelle oder HTTP: Turns starten über `runWake`, Chats sperrt `reserve`.

type Ref = Pick<ChatBot, "id" | "name" | "avatar" | "color">
export type Group = { id: string; name: string; memberIds: string[] }

export type LineStore = {
  appendLine(chatId: string, line: OrbiLine, id?: string): Promise<string>
  patchLine(
    chatId: string,
    messageId: string,
    patch: Partial<OrbiLine>
  ): Promise<OrbiLine | null>
}

export type WakeRequest = {
  chatId: string
  bot: Ref
  taskId: string
  rootChatId: string
  kind: "message" | "reply"
  fromBotIds: string[]
  linkIds: string[]
}
export type WakeResult = { text: string; failed: boolean; aborted: boolean }

export type DispatcherDeps = {
  store: LineStore
  reserve: (chatId: string) => (() => void) | undefined
  isBusy: (chatId: string) => boolean // Chat ist gerade belegt (nur für die Rückmeldung „queued“)
  // Startet den Turn im (bereits reservierten) Chat; `release` gibt die Reservierung am Turn-Ende frei.
  runWake: (request: WakeRequest, release: () => void) => Promise<WakeResult>
  stopChat: (chatId: string) => boolean
  // Sandbox des Ziels im Hintergrund anwärmen, sobald eine Weck-Nachricht zugestellt wird (darf nie blockieren).
  warm?: (bot: ChatBot) => void
  // Phase 5: Auftragszähler überleben einen Neustart. Fehler beim Speichern stören nie.
  counters?: {
    save: (counters: {
      taskId: string
      rootChatId: string
      sent: number
      groupRounds: number
      deepCalls: number
      pairWakes: [string, number][]
    }) => void
    load: (taskId: string) => {
      sent: number
      groupRounds: number
      deepCalls: number
      pairWakes: [string, number][]
    } | null
  }
  // Phase C: Speicherung im Auftragsbaum (tasks-Tabelle)
  saveTask?: (task: {
    id: string
    orbiId: string
    parentChatId: string
    parentTaskId?: string
    brief: string
    title?: string
    mode?: "work" | "consult" | "notify"
    reply?: "resume" | "none"
    status?: "queued" | "running" | "waiting" | "done" | "failed" | "stopped"
    assignedBotId?: string
    doneWhen?: string
    answers?: string
    rework?: string
  }) => void
  updateTaskStatus?: (
    id: string,
    status: "done" | "failed" | "stopped",
    result?: string
  ) => void
  findGroup: (id: string) => Promise<Group | null>
  publish: (event: ServiceEvent) => void
  // Gruppennachricht gespeichert (Mitglieder sehen sie im Verlauf): die Runtime startet daraus die Gruppenrunde.
  onGroupMessage?: (info: {
    group: Group
    fromBotId: string
    fromChatId: string
    taskId: string
    chatId: string
    messageId: string
    text: string
  }) => void
}

export type SendInput = DeliverInput & {
  taskId: string
  fromChatId: string
  from: Ref
  team: ChatBot[]
  // Der sendende Turn wurde selbst durch eine Antwort geweckt (Ping-Pong-Schutz).
  wakeKind?:
    | "message"
    | "reply"
    | "first_run"
    | "event"
    | "routine"
    | "agent"
    | "task_done"
}

type Link = {
  id: string
  taskId: string
  kind: "message" | "reply"
  fromChatId: string
  from: Ref
  toChatId: string
  to: Ref
  outId: string // Zeile im Chat des Absenders
  inId: string // Zeile im Chat des Empfängers
  priority: boolean
  open: boolean // wartet noch auf Start oder Antwort
  mode?: "work" | "consult" | "notify"
  reply?: "resume" | "none"
  title?: string
}

type Task = {
  id: string
  rootChatId: string
  sent: number
  groupRounds: number // per send_message an eine Gruppe ausgelöste Runden
  deepCalls: number // Bestehenden Datenbankwert beim Speichern erhalten.
  pairWakes: Map<string, number> // Weckungen je Paar (sortierte Orbi-IDs)
  aborted: boolean
  pinned?: { model: string; effort?: string }
}

type Pending = {
  taskId: string
  chatId: string
  bot: Ref
  kind: "message" | "reply"
  linkIds: string[]
}

const peer = (b: Ref): LinePeer => ({
  id: b.id,
  name: b.name,
  avatar: b.avatar,
  color: b.color,
})

export function createDispatcher(deps: DispatcherDeps) {
  const tasks = new Map<string, Task>()
  const links = new Map<string, Link>()
  const running = new Map<
    string,
    { taskId: string; botId: string; run: symbol }
  >() // chatId -> laufender Turn
  const roots = new Map<string, { taskId: string; run: symbol }>() // Turns, die Consti ausgelöst hat
  const pending: Pending[] = []
  // Offene Prioritätsnachrichten je (Auftrag, Chat, Orbi): erst wenn alle beantwortet sind, wird der Absender geweckt.
  const awaiting = new Map<string, Set<string>>()
  const arrived = new Map<string, string[]>() // schon eingetroffene Antworten dazu
  // Offene Antwortpflicht eines geweckten Orbis (message-Links, die er beantworten muss).
  const owes = new Map<string, string[]>()
  const key = (taskId: string, chatId: string, botId: string) =>
    `${taskId}|${chatId}|${botId}`
  // Gruppenrunden, die für diesen Auftrag noch warten oder laufen: der Auftrag bleibt bestehen.
  const holds = new Map<string, number>()

  const event = (chatId: string, messageId: string, line: OrbiLine) =>
    deps.publish({
      type: "orbi-message",
      chatId,
      messageId,
      linkId: line.linkId,
      direction: line.direction,
      kind: line.kind,
      status: line.status,
      queued: !!line.queued,
      held: !!line.held,
    })

  async function patch(
    chatId: string,
    messageId: string,
    change: Partial<OrbiLine>
  ) {
    try {
      const line = await deps.store.patchLine(chatId, messageId, change)
      if (line) event(chatId, messageId, line)
    } catch (error) {
      console.error("Nachrichtenzeile konnte nicht aktualisiert werden:", error)
    }
  }
  const patchLink = (link: Link, change: Partial<OrbiLine>) =>
    Promise.all([
      patch(link.fromChatId, link.outId, change),
      patch(link.toChatId, link.inId, change),
    ])

  async function addLine(chatId: string, line: OrbiLine) {
    const id = await deps.store.appendLine(chatId, line)
    event(chatId, id, line)
    return id
  }

  // Orbis, die in diesem Auftrag laufen oder auf ihren Start warten.
  function engaged(taskId: string) {
    const set = new Set<string>()
    for (const r of running.values()) if (r.taskId === taskId) set.add(r.botId)
    for (const p of pending) if (p.taskId === taskId) set.add(p.bot.id)
    return set
  }

  function settle(taskId: string) {
    const task = tasks.get(taskId)
    if (!task) return
    const busy =
      (holds.get(taskId) ?? 0) > 0 ||
      [...running.values()].some((r) => r.taskId === taskId) ||
      pending.some((p) => p.taskId === taskId) ||
      [...awaiting.entries()].some(([k, v]) => k.startsWith(taskId + "|") && v.size)
    if (busy) return
    tasks.delete(taskId)
    for (const [id, link] of links) if (link.taskId === taskId) links.delete(id)
    for (const k of [...awaiting.keys(), ...arrived.keys(), ...owes.keys()])
      if (k.startsWith(taskId + "|")) {
        awaiting.delete(k)
        arrived.delete(k)
        owes.delete(k)
      }
  }

  async function newLink(input: {
    task: Task
    kind: "message" | "reply"
    fromChatId: string
    from: Ref
    toChatId: string
    to: Ref
    text: string
    priority: boolean
    status: LineStatus
    held?: boolean
    queued?: boolean
    group?: { id: string; name: string }
    outPeer?: LinePeer
    mode?: "work" | "consult" | "notify"
    reply?: "resume" | "none"
    title?: string
    assignmentId?: string
  }): Promise<Link> {
    const linkId = input.assignmentId ?? crypto.randomUUID()
    const token = makeToken()
    const createdAt = Date.now()
    const base = {
      v: 1 as const,
      linkId,
      kind: input.kind,
      group: input.group,
      text: input.text,
      priority: input.priority,
      held: input.held,
      queued: input.queued,
      status: input.status,
      mode: input.mode,
      reply: input.reply,
      assignmentId: linkId,
      title: input.title,
      token,
      rootTaskId: input.task.id,
      createdAt,
    }
    const outId = await addLine(input.fromChatId, {
      ...base,
      direction: "out",
      peer: input.outPeer ?? peer(input.to),
    })
    const inId = await addLine(input.toChatId, {
      ...base,
      direction: "in",
      peer: peer(input.from),
    })
    const link: Link = {
      id: linkId,
      taskId: input.task.id,
      kind: input.kind,
      fromChatId: input.fromChatId,
      from: input.from,
      toChatId: input.toChatId,
      to: input.to,
      outId,
      inId,
      priority: input.priority,
      open: true,
      mode: input.mode,
      reply: input.reply,
      title: input.title,
    }
    links.set(linkId, link)
    return link
  }

  // ---- Aufträge ----

  // `resumeFrom`: Auftrag eines unterbrochenen Turns (nach „Weiter“). Seine Zähler gelten weiter, damit ein Neustart das Ping-Pong-Maß nicht zurücksetzt.
  function beginTask(
    rootChatId: string,
    pinned?: { model: string; effort?: string },
    resumeFrom?: string
  ) {
    let before: ReturnType<NonNullable<DispatcherDeps["counters"]>["load"]> = null
    try {
      before = resumeFrom ? (deps.counters?.load(resumeFrom) ?? null) : null
    } catch {
      console.error("Auftragszähler konnten nicht geladen werden.")
    }
    const task: Task = {
      id: crypto.randomUUID(),
      rootChatId,
      sent: before?.sent ?? 0,
      groupRounds: before?.groupRounds ?? 0,
      deepCalls: before?.deepCalls ?? 0,
      pairWakes: new Map(before?.pairWakes ?? []),
      aborted: false,
      pinned,
    }
    tasks.set(task.id, task)
    persist(task)
    return task.id
  }

  function persist(task: Task) {
    try {
      deps.counters?.save({
        taskId: task.id,
        rootChatId: task.rootChatId,
        sent: task.sent,
        groupRounds: task.groupRounds,
        deepCalls: task.deepCalls,
        pairWakes: [...task.pairWakes],
      })
    } catch {
      console.error("Auftragszähler konnten nicht gespeichert werden.")
    }
  }

  function turnStarted(taskId: string, chatId: string, botId: string) {
    const run = Symbol()
    running.set(chatId, { taskId, botId, run })
    return run
  }
  // Nur der Turn, der den Eintrag gesetzt hat, darf ihn löschen (ein Folge-Turn im selben Chat kann schon laufen).
  function turnEnded(taskId: string, chatId: string, run: symbol) {
    if (running.get(chatId)?.run === run) running.delete(chatId)
    settle(taskId)
  }
  function hold(taskId: string) {
    holds.set(taskId, (holds.get(taskId) ?? 0) + 1)
    let released = false
    return () => {
      if (released) return
      released = true
      const n = (holds.get(taskId) ?? 1) - 1
      if (n <= 0) holds.delete(taskId)
      else holds.set(taskId, n)
      settle(taskId)
    }
  }
  // Turn aus einer Nachricht von Consti (oder einer Automation): endet mit der Freigabe des Chats (`onRelease`).
  function rootStarted(taskId: string, chatId: string, botId: string) {
    roots.set(chatId, { taskId, run: turnStarted(taskId, chatId, botId) })
  }

  // ---- send_message ----

  async function send(input: SendInput): Promise<DeliverResult> {
    const task = tasks.get(input.taskId)
    if (!task || task.aborted)
      return { ok: false, error: "Der Auftrag wurde abgebrochen." }
    const message = input.message.trim()
    if (!message) return { ok: false, error: "Die Nachricht ist leer." }
    if (message.length > LIMITS.messageChars)
      return { ok: false, error: "Die Nachricht ist zu lang." }
    const name = input.target.trim()
    const key0 = name.toLowerCase()
    const bot = input.team.find(
      (b) => b.id === name || b.name.toLowerCase() === key0
    )
    const group = bot ? null : await deps.findGroup(name)
    if (!bot && !group)
      return {
        ok: false,
        error: `Orbi oder Gruppe „${name}“ gibt es nicht. Verfügbar: ${input.team
          .filter((b) => b.id !== input.from.id)
          .map((b) => b.name)
          .join(", ")}.`,
      }
    if (bot?.id === input.from.id)
      return { ok: false, error: "Nachricht an sich selbst nicht möglich." }
    if (task.sent >= LIMITS.orbiMessagesPerTask)
      return {
        ok: false,
        error: `Limit erreicht: höchstens ${LIMITS.orbiMessagesPerTask} Orbi-Nachrichten je Auftrag. Berichte Consti kurz, was erledigt und was offen ist.`,
      }

    if (group) {
      if (!group.memberIds.includes(input.from.id))
        return { ok: false, error: `Du bist nicht Mitglied von „${group.name}“.` }
      if (input.fromChatId === group.id)
        return {
          ok: false,
          error: `Du schreibst schon in „${group.name}“: antworte direkt im Chat.`,
        }
      // Gruppen umgehen weder die Ping-Pong-Bremse noch die Obergrenze gleichzeitig aktiver Orbis.
      if (input.wakeKind === "reply" && !isQuestionOrResult(message))
        return {
          ok: false,
          error:
            "Antwort auf eine Antwort ohne Frage oder Ergebnis: nicht an die Gruppe senden. Berichte Consti stattdessen kurz.",
        }
      if (task.groupRounds >= LIMITS.groupRoundsPerTask)
        return {
          ok: false,
          error: `Limit erreicht: höchstens ${LIMITS.groupRoundsPerTask} Gruppenrunden je Auftrag. Berichte Consti kurz, was erledigt und was offen ist.`,
        }
      const engagedNow = engaged(task.id)
      const wouldJoin = group.memberIds.filter((id) => id !== input.from.id && !engagedNow.has(id))
      if (engagedNow.size + wouldJoin.length > LIMITS.activeOrbis && wouldJoin.length > 0)
        return {
          ok: false,
          error: `Limit erreicht: höchstens ${LIMITS.activeOrbis} Orbis gleichzeitig je Auftrag. Berichte Consti kurz, statt eine große Gruppe zu wecken.`,
        }
      task.sent++
      task.groupRounds++
      persist(task)
      const link = await newLink({
        task,
        kind: "message",
        fromChatId: input.fromChatId,
        from: input.from,
        toChatId: group.id,
        to: { id: group.id, name: group.name, avatar: "", color: null },
        text: message,
        priority: false, // bei Gruppen ignoriert
        status: "fertig",
        group: { id: group.id, name: group.name },
      })
      link.open = false
      try {
        deps.onGroupMessage?.({
          group,
          fromBotId: input.from.id,
          fromChatId: input.fromChatId,
          taskId: task.id,
          chatId: group.id,
          messageId: link.inId,
          text: message,
        })
      } catch (error) {
        console.error("Gruppenrunde konnte nicht gestartet werden:", error)
      }
      return { ok: true, to: group.name, linkId: link.id, delivery: "group" }
    }

    const target = bot!
    if (!target.direct_chat_id)
      return { ok: false, error: `${target.name} hat keinen eigenen Chat.` }
    // Ping-Pong-Ende: Eine Antwort ohne neue Frage weckt niemanden.
    let priority = input.priority
    if (priority && input.wakeKind === "reply" && !isQuestionOrResult(message))
      priority = false
    // Paar-Budget: A und B wecken sich je Auftrag höchstens zweimal, danach wird nur noch gelesen.
    const pair = [input.from.id, target.id].sort().join("|")
    if (priority && (task.pairWakes.get(pair) ?? 0) >= LIMITS.pairWakes) priority = false
    if (priority && !engaged(task.id).has(target.id) && engaged(task.id).size >= LIMITS.activeOrbis)
      return {
        ok: false,
        error: `Limit erreicht: höchstens ${LIMITS.activeOrbis} Orbis gleichzeitig je Auftrag. Berichte Consti kurz, statt weitere zu wecken.`,
      }

    const busy =
      priority &&
      (running.has(target.direct_chat_id) ||
        deps.isBusy(target.direct_chat_id) ||
        pending.some((p) => p.chatId === target.direct_chat_id))
    task.sent++
    if (priority) task.pairWakes.set(pair, (task.pairWakes.get(pair) ?? 0) + 1)
    persist(task)
    const assignmentId = crypto.randomUUID()
    const link = await newLink({
      task,
      kind: "message",
      fromChatId: input.fromChatId,
      from: input.from,
      toChatId: target.direct_chat_id,
      to: target,
      text: message,
      priority,
      status: "arbeitet",
      held: !priority || undefined,
      queued: priority || undefined,
      mode: input.mode,
      reply: input.reply,
      title: input.title,
      assignmentId,
    })
    if (deps.saveTask) {
      try {
        deps.saveTask({
          id: link.id,
          orbiId: input.from.id,
          parentChatId: input.fromChatId,
          parentTaskId: input.parent_task_id ?? input.taskId,
          brief: message,
          title: input.title,
          mode: input.mode ?? "work",
          reply: input.reply ?? "resume",
          status: busy ? "queued" : "running",
          assignedBotId: target.id,
          doneWhen: input.done_when,
          answers: input.answers,
          rework: input.rework,
        })
      } catch {
        /* Task-Speicherung darf den Ablauf nie blockieren */
      }
    }
    if (!priority)
      return {
        ok: true,
        to: target.name,
        linkId: link.id,
        assignmentId: link.id,
        delivery: "held",
        mode: input.mode ?? "work",
        reply: input.reply ?? "resume",
      }
    try {
      deps.warm?.(target)
    } catch {
      /* Anwärmen ist nur eine Beschleunigung */
    }
    const k = key(task.id, input.fromChatId, input.from.id)
    awaiting.set(k, (awaiting.get(k) ?? new Set()).add(link.id))
    pending.push({
      taskId: task.id,
      chatId: target.direct_chat_id,
      bot: target,
      kind: "message",
      linkIds: [link.id],
    })
    void drain(target.direct_chat_id)
    return {
      ok: true,
      to: target.name,
      linkId: link.id,
      assignmentId: link.id,
      delivery: busy ? "queued" : "wake",
      mode: input.mode ?? "work",
      reply: input.reply ?? "resume",
    }
  }

  // ---- Zustellung / Wecken ----

  // Startet den nächsten wartenden Turn in diesem Chat, wenn er frei ist. Wird bei jeder Freigabe gerufen.
  async function drain(chatId: string) {
    const first = pending.find((p) => p.chatId === chatId)
    if (!first) return
    const task = tasks.get(first.taskId)
    if (!task || task.aborted) {
      removePending(first)
      settle(first.taskId)
      return drain(chatId)
    }
    const release = deps.reserve(chatId)
    if (!release) return // belegt: die Freigabe ruft drain erneut
    // Alles zusammen zustellen, was zum selben Auftrag, Orbi und Typ in diesem Chat wartet.
    const batch = pending.filter(
      (p) => p.chatId === chatId && p.taskId === first.taskId && p.kind === first.kind
    )
    for (const p of batch) removePending(p)
    const linkIds = batch.flatMap((p) => p.linkIds)
    const request: WakeRequest = {
      chatId,
      bot: first.bot,
      taskId: first.taskId,
      rootChatId: task.rootChatId,
      kind: first.kind,
      fromBotIds: [
        ...new Set(
          linkIds.flatMap((id) => {
            const l = links.get(id)
            return l ? [l.from.id] : []
          })
        ),
      ],
      linkIds,
    }
    const run = turnStarted(first.taskId, chatId, first.bot.id)
    for (const id of linkIds) {
      const l = links.get(id)
      if (l) void patchLink(l, { queued: false })
    }
    // Die Reservierung wird am Turn-Ende freigegeben; erst danach laufen Folgezustellungen.
    let released = false
    const done = () => {
      if (released) return
      released = true
      release()
    }
    let result: WakeResult
    try {
      result = await deps.runWake(request, done)
    } catch (error) {
      console.error("Geweckter Turn fehlgeschlagen:", error)
      result = {
        text: "failed: Der Turn konnte nicht gestartet werden.",
        failed: true,
        aborted: tasks.get(first.taskId)?.aborted ?? false,
      }
    }
    done()
    await finishWake(request, run, result)
  }

  const removePending = (p: Pending) => {
    const i = pending.indexOf(p)
    if (i >= 0) pending.splice(i, 1)
  }

  async function finishWake(
    request: WakeRequest,
    run: symbol,
    outcome: WakeResult
  ) {
    const task = tasks.get(request.taskId)
    const k = key(request.taskId, request.chatId, request.bot.id)
    // Wurde nur dieser Orbi gestoppt (nicht der Auftrag), antwortet er dem Fragenden mit failed:.
    const result: WakeResult = outcome.aborted
      ? { text: "failed: abgebrochen", failed: true, aborted: true }
      : outcome
    try {
      if (!task || task.aborted) {
        await failLinks(request.linkIds)
        return
      }
      const owed = [
        ...(owes.get(k) ?? []),
        ...(request.kind === "message" ? request.linkIds : []),
      ]
      // Hat dieser Orbi selbst Nachrichten offen und lief der Turn gut: erst wenn alle Antworten da sind, antwortet er.
      if (!result.failed && (awaiting.get(k)?.size ?? 0) > 0) {
        owes.set(k, owed)
        return
      }
      owes.delete(k)
      if (result.failed) awaiting.delete(k)
      // Brach der Turn mitten im Text ab, gilt die Antwort als fehlgeschlagen, auch ohne failed:-Zeile.
      const raw = result.text.trim()
      const text = clip(
        !raw
          ? result.failed
            ? "failed: kein Ergebnis"
            : "failed: keine Antwort geliefert"
          : result.failed && !/^failed:/i.test(raw)
            ? `failed: ${raw}`
            : raw,
        LIMITS.replyChars
      )
      for (const id of owed) await reply(id, text, result.failed || !raw)
    } finally {
      turnEnded(request.taskId, request.chatId, run)
      // Antworten, die inzwischen eingetroffen sind, wecken den Absender; Rest wartet.
      void drain(request.chatId)
    }
  }

  async function failLinks(ids: string[]) {
    for (const id of ids) {
      const link = links.get(id)
      if (!link) continue
      link.open = false
      await patchLink(link, { status: "fehlgeschlagen", queued: false })
      const k = key(link.taskId, link.fromChatId, link.from.id)
      awaiting.get(k)?.delete(link.id)
    }
  }

  // Rückweg: Zeile „Antwort gesendet an“ beim Antwortenden, „Antwort von“ beim Fragenden; danach ggf. Absender wecken.
  async function reply(linkId: string, text: string, failed: boolean) {
    const link = links.get(linkId)
    if (!link || !link.open) return
    const task = tasks.get(link.taskId)
    if (!task || task.aborted) return
    link.open = false
    const status: LineStatus = failed ? "fehlgeschlagen" : "fertig"
    await patchLink(link, { status, queued: false })
    if (deps.updateTaskStatus) {
      try {
        deps.updateTaskStatus(link.id, failed ? "failed" : "done", text)
      } catch {
        /* ignore */
      }
    }
    if (link.reply === "none") {
      // Bei reply=none (z. B. notify / consult ohne Wiederaufnahme) kein Rück-Link und kein Wecken
      const k = key(link.taskId, link.fromChatId, link.from.id)
      awaiting.get(k)?.delete(link.id)
      return
    }
    const back = await newLink({
      task,
      kind: "reply",
      fromChatId: link.toChatId,
      from: link.to,
      toChatId: link.fromChatId,
      to: link.from,
      text,
      priority: true,
      status,
    })
    back.open = false
    const k = key(link.taskId, link.fromChatId, link.from.id)
    const waiting = awaiting.get(k)
    waiting?.delete(link.id)
    arrived.set(k, [...(arrived.get(k) ?? []), back.id])
    if (waiting && waiting.size > 0) return
    // Letzte offene Antwort ist da: der Absender wird einmal geweckt (in dem Chat, aus dem er gesendet hat).
    const ids = arrived.get(k) ?? []
    arrived.delete(k)
    awaiting.delete(k)
    pending.push({
      taskId: link.taskId,
      chatId: link.fromChatId,
      bot: link.from,
      kind: "reply",
      linkIds: ids,
    })
    void drain(link.fromChatId)
  }

  // Chat frei (Turn zu Ende): Root-Turn abmelden, wartende Zustellungen starten.
  function onRelease(chatId: string) {
    const root = roots.get(chatId)
    if (root) {
      roots.delete(chatId)
      turnEnded(root.taskId, chatId, root.run)
    }
    void drain(chatId)
  }

  // ---- Stopp ----

  // Stopp im Root-Chat: alle Läufe und wartenden Zustellungen des Auftrags. Gibt zurück, ob etwas abgebrochen wurde.
  function stopRoot(rootChatId: string) {
    let stopped = false
    for (const task of tasks.values()) {
      if (task.rootChatId !== rootChatId || task.aborted) continue
      task.aborted = true
      stopped = true
      const dropped = pending.filter((p) => p.taskId === task.id)
      for (const p of dropped) removePending(p)
      void failLinks(dropped.flatMap((p) => p.linkIds))
      for (const [chatId, r] of running)
        if (r.taskId === task.id && chatId !== rootChatId) deps.stopChat(chatId)
      for (const link of links.values())
        if (link.taskId === task.id && link.open) {
          link.open = false
          void patchLink(link, { status: "fehlgeschlagen", queued: false })
        }
      for (const k of [...awaiting.keys(), ...arrived.keys(), ...owes.keys()])
        if (k.startsWith(task.id + "|")) {
          awaiting.delete(k)
          arrived.delete(k)
          owes.delete(k)
        }
      settle(task.id)
    }
    return stopped
  }

  // „wartet“ in den Zeilen = der Orbi wartet auf Consti (offene Freigabe/Rückfrage in seinem Chat).
  async function setWaiting(chatId: string, waiting: boolean) {
    for (const link of links.values()) {
      if (link.toChatId !== chatId || !link.open || link.kind !== "message")
        continue
      await patchLink(link, { status: waiting ? "wartet" : "arbeitet" })
    }
  }

  return {
    beginTask,
    hold,
    task: (id: string) => tasks.get(id),
    rootStarted,
    send,
    drain,
    onRelease,
    stopRoot,
    setWaiting,
    snapshot: () => ({
      tasks: tasks.size,
      running: running.size,
      pending: pending.length,
    }),
  }
}

export type Dispatcher = ReturnType<typeof createDispatcher>
