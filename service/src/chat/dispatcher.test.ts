import assert from "node:assert/strict"
import test from "node:test"

import type { ChatBot } from "../../../lib/chat/load-chat.ts"
import { LIMITS, type OrbiLine } from "../../../lib/chat/orbi-message.ts"
import { createSendMessageTool } from "../../../lib/chat/send-message.ts"
import type { ServiceEvent } from "../events.ts"
import {
  createDispatcher,
  type Dispatcher,
  type Group,
  type WakeRequest,
  type WakeResult,
} from "./dispatcher.ts"

const tick = () => new Promise<void>((resolve) => setImmediate(resolve))
const bot = (id: string): ChatBot => ({
  id,
  name: id.toUpperCase(),
  job: "Helfen",
  instructions: null,
  is_main: id === "a",
  sandbox_id: null,
  avatar: "orb",
  color: null,
  member: true,
  direct_chat_id: `chat-${id}`,
})
const team = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map(bot)
const [A, B] = team
const ok = (text: string): WakeResult => ({ text, failed: false, aborted: false })

function harness(group?: Group) {
  const rows = new Map<string, Map<string, OrbiLine>>()
  const events: ServiceEvent[] = []
  const reserved = new Set<string>()
  const wakes: {
    req: WakeRequest
    finish: (result: WakeResult) => Promise<void>
  }[] = []
  const stopped: string[] = []
  const warmed: string[] = []
  const groupMessages: unknown[] = []
  const chat = (id: string) => rows.get(id) ?? new Map<string, OrbiLine>()
  let d!: Dispatcher
  const reserve = (id: string) => {
    if (reserved.has(id)) return undefined
    reserved.add(id)
    return () => {
      if (!reserved.delete(id)) return
      d.onRelease(id)
    }
  }
  d = createDispatcher({
    store: {
      appendLine: async (chatId, line, id = crypto.randomUUID()) => {
        if (!rows.has(chatId)) rows.set(chatId, new Map())
        rows.get(chatId)!.set(id, line)
        return id
      },
      patchLine: async (chatId, id, patch) => {
        const line = rows.get(chatId)?.get(id)
        if (!line) return null
        const next = { ...line, ...patch }
        rows.get(chatId)!.set(id, next)
        return next
      },
    },
    reserve,
    isBusy: (id) => reserved.has(id),
    runWake: (req, release) =>
      new Promise((resolve) => {
        wakes.push({
          req,
          finish: async (result) => {
            release()
            resolve(result)
            await tick()
          },
        })
      }),
    stopChat: (id) => {
      stopped.push(id)
      return true
    },
    warm: (b) => warmed.push(b.id),
    findGroup: async (id) => (group && group.id === id ? group : null),
    publish: (event) => events.push(event),
    onGroupMessage: (info) => groupMessages.push(info),
  })
  // Root-Turn von A im Chat „chat-a“ (Consti hat geschrieben).
  const root = (chatId = "chat-a") => {
    const taskId = d.beginTask(chatId)
    d.rootStarted(taskId, chatId, "a")
    const release = reserve(chatId)!
    return { taskId, release }
  }
  const send = (
    taskId: string,
    target: string,
    message: string,
    priority: boolean,
    from = A,
    fromChatId = "chat-a",
    wakeKind?: "message" | "reply"
  ) => d.send({ taskId, target, message, priority, from, fromChatId, team, wakeKind })
  return { d, rows, chat, events, wakes, stopped, warmed, groupMessages, root, send, reserved }
}
const lines = (m: Map<string, OrbiLine>) => [...m.values()]

test("Fire-and-forget: sofort gesendet, Zeilen in beiden Chats, Ziel wird geweckt, Antwort weckt den Absender", async () => {
  const h = harness()
  const { taskId, release } = h.root()
  const result = await h.send(taskId, "B", "Recherchiere X", true)
  assert.equal(result.ok, true)
  assert.equal(result.to, "B")
  assert.equal(result.delivery, "wake")
  assert.ok(result.linkId)
  const [out] = lines(h.chat("chat-a"))
  const [inc] = lines(h.chat("chat-b"))
  assert.equal(out.direction, "out")
  assert.equal(out.peer.id, "b")
  assert.equal(inc.direction, "in")
  assert.equal(inc.peer.id, "a")
  assert.equal(out.linkId, inc.linkId)
  assert.equal(out.status, "arbeitet")
  await tick()
  assert.equal(h.wakes.length, 1)
  assert.equal(h.wakes[0].req.chatId, "chat-b")
  assert.equal(h.wakes[0].req.kind, "message")
  assert.equal(h.chat("chat-b").size, 1)
  assert.equal(lines(h.chat("chat-b"))[0].queued, false)
  // B antwortet
  await h.wakes[0].finish(ok("result: fertig, 3 Treffer"))
  const b = lines(h.chat("chat-b"))
  const a = lines(h.chat("chat-a"))
  assert.equal(b.find((l) => l.kind === "reply")?.direction, "out")
  assert.equal(a.find((l) => l.kind === "reply")?.direction, "in")
  assert.equal(a.find((l) => l.kind === "reply")?.text, "result: fertig, 3 Treffer")
  assert.equal(a.find((l) => l.kind === "message")?.status, "fertig")
  assert.equal(b.find((l) => l.kind === "message")?.status, "fertig")
  // A ist mit seinem Root-Turn noch beschäftigt: Weckruf wartet, bis der Chat frei ist.
  assert.equal(h.wakes.length, 1)
  release()
  await tick()
  assert.equal(h.wakes.length, 2)
  assert.equal(h.wakes[1].req.chatId, "chat-a")
  assert.equal(h.wakes[1].req.kind, "reply")
  await h.wakes[1].finish(ok("Zusammenfassung für Consti"))
  assert.equal(h.d.snapshot().tasks, 0)
})

test("Sandbox des Ziels wird bei der Zustellung angewärmt, bei gehaltenen Nachrichten nicht", async () => {
  const h = harness()
  const { taskId } = h.root()
  await h.send(taskId, "C", "leise", false)
  assert.deepEqual(h.warmed, [])
  await h.send(taskId, "B", "los", true)
  assert.deepEqual(h.warmed, ["b"])
})

test("priority=false: gehalten, kein Turn, Zeile als gehalten markiert", async () => {
  const h = harness()
  const { taskId } = h.root()
  const result = await h.send(taskId, "b", "Nur zur Info", false)
  assert.equal(result.ok && result.delivery, "held")
  await tick()
  assert.equal(h.wakes.length, 0)
  const [inc] = lines(h.chat("chat-b"))
  assert.equal(inc.held, true)
  assert.equal(inc.queued, undefined)
})

test("Beschäftigtes Ziel: Nachricht wartet in der Warteschlange und wird beim Turn-Ende zugestellt", async () => {
  const h = harness()
  const { taskId } = h.root()
  const busy = h.reserved.add("chat-b") // Consti schreibt gerade selbst mit B
  void busy
  const result = await h.send(taskId, "B", "Aufgabe", true)
  assert.equal(result.ok && result.delivery, "queued")
  await tick()
  assert.equal(h.wakes.length, 0)
  assert.equal(lines(h.chat("chat-b"))[0].queued, true)
  h.reserved.delete("chat-b")
  h.d.onRelease("chat-b")
  await tick()
  assert.equal(h.wakes.length, 1)
  assert.equal(lines(h.chat("chat-b"))[0].queued, false)
})

test("Mehrere Antworten: der Absender wird erst nach der letzten geweckt, einmal", async () => {
  const h = harness()
  const { taskId, release } = h.root()
  await h.send(taskId, "B", "Teil 1", true)
  await h.send(taskId, "C", "Teil 2", true)
  await tick()
  release()
  assert.equal(h.wakes.length, 2)
  await h.wakes[0].finish(ok("result: eins"))
  assert.equal(h.wakes.length, 2)
  await h.wakes[1].finish(ok("result: zwei"))
  assert.equal(h.wakes.length, 3)
  assert.equal(h.wakes[2].req.chatId, "chat-a")
  assert.equal(h.wakes[2].req.linkIds.length, 2)
})

test("Antwort-Status folgt dem tatsächlichen Ergebnis, nicht dem Antworttext", async () => {
  const h = harness()
  const { taskId } = h.root()
  // Verschiedene Ziele: dasselbe Paar darf je Auftrag nur zweimal wecken.
  for (const [text, status, target] of [
    ["needs input: welche Datei?", "fertig", "B"],
    ["failed: kein Zugriff", "fertig", "C"],
    ["irgendwas", "fertig", "D"],
  ] as const) {
    await h.send(taskId, target, text, true)
    await tick()
    await h.wakes.at(-1)!.finish(ok(text))
    const last = lines(h.chat("chat-a")).filter((l) => l.kind === "message").at(-1)!
    assert.equal(last.status, status, text)
  }
})

test(`Limit: höchstens ${LIMITS.orbiMessagesPerTask} Orbi-Nachrichten je Auftrag, klare Fehlermeldung`, async () => {
  const h = harness()
  const { taskId } = h.root()
  for (let i = 0; i < LIMITS.orbiMessagesPerTask; i++)
    assert.equal((await h.send(taskId, "B", `n${i}`, false)).ok, true)
  const over = await h.send(taskId, "B", "zu viel", false)
  assert.equal(over.ok, false)
  assert.match(!over.ok ? over.error : "", new RegExp(`Limit erreicht.*${LIMITS.orbiMessagesPerTask}.*Consti`))
  assert.equal(lines(h.chat("chat-b")).length, LIMITS.orbiMessagesPerTask)
})

test(`Limit: höchstens ${LIMITS.activeOrbis} Orbis gleichzeitig; bereits beteiligte dürfen weiter angeschrieben werden`, async () => {
  const h = harness()
  const { taskId } = h.root()
  // A ist Sender; 7 weitere Orbis bis zum Limit von 8
  assert.equal((await h.send(taskId, "B", "1", true)).ok, true)
  assert.equal((await h.send(taskId, "C", "2", true)).ok, true)
  assert.equal((await h.send(taskId, "D", "3", true)).ok, true)
  assert.equal((await h.send(taskId, "E", "4", true)).ok, true)
  assert.equal((await h.send(taskId, "F", "5", true)).ok, true)
  assert.equal((await h.send(taskId, "G", "6", true)).ok, true)
  assert.equal((await h.send(taskId, "H", "7", true)).ok, true)
  const over = await h.send(taskId, "I", "8", true)
  assert.equal(over.ok, false)
  assert.match(!over.ok ? over.error : "", new RegExp(`${LIMITS.activeOrbis} Orbis gleichzeitig`))
  // B ist schon dabei; held (false) geht für jeden.
  assert.equal((await h.send(taskId, "B", "noch eins", true)).ok, true)
  assert.equal((await h.send(taskId, "I", "leise", false)).ok, true)
})

test(`Limit: höchstens ${LIMITS.sentPerTurn} gesendete Nachrichten je Turn (Werkzeug)`, async () => {
  let delivered = 0
  const t = createSendMessageTool(async () => {
    delivered++
    return { ok: true, to: "B", linkId: "l", delivery: "held" }
  })
  const run = (n: number) =>
    t.execute!({ target: "B", message: `n${n}`, priority: false }, { toolCallId: "t", messages: [] })
  for (let i = 0; i < LIMITS.sentPerTurn; i++) assert.deepEqual(((await run(i)) as { ok: boolean }).ok, true)
  const over = (await run(LIMITS.sentPerTurn)) as { ok: boolean; error?: string }
  assert.equal(over.ok, false)
  assert.match(over.error ?? "", new RegExp(`Limit erreicht.*${LIMITS.sentPerTurn}`))
  assert.equal(delivered, LIMITS.sentPerTurn)
})

test("Ping-Pong endet: Nur eine Frage als Antwort auf eine Antwort weckt erneut", async () => {
  const h = harness()
  const { taskId, release } = h.root()
  await h.send(taskId, "B", "Frage", true)
  await tick()
  await h.wakes[0].finish(ok("result: ja"))
  release()
  await tick()
  assert.equal(h.wakes[1].req.kind, "reply") // A wurde durch die Antwort geweckt
  const thanks = await h.send(taskId, "B", "Danke!", true, A, "chat-a", "reply")
  assert.equal(thanks.ok && thanks.delivery, "held")
  await tick()
  assert.equal(h.wakes.length, 2) // niemand sonst geweckt
  const follow = await h.send(taskId, "B", "Und was ist mit Y?", true, A, "chat-a", "reply")
  assert.equal(follow.ok && follow.delivery, "wake")
  const result = await h.send(taskId, "C", "result: Y ist erledigt", true, A, "chat-a", "reply")
  assert.equal(result.ok && result.delivery, "held")
})

test("Ziel ist eine Gruppe: sofort an alle (Zeile in der Gruppe), priority ignoriert, Haken für A2", async () => {
  const group: Group = { id: "g1", name: "Team", memberIds: ["a", "b", "c"] }
  const h = harness(group)
  const { taskId, release: rootRelease } = h.root()
  const result = await h.send(taskId, "g1", "Wer hat Zeit?", true)
  assert.equal(result.ok && result.delivery, "group")
  await tick()
  assert.equal(h.wakes.length, 0)
  const [inGroup] = lines(h.chat("g1"))
  assert.equal(inGroup.direction, "in")
  assert.equal(inGroup.group?.id, "g1")
  assert.equal(lines(h.chat("chat-a"))[0].peer.name, "Team")
  assert.equal(h.groupMessages.length, 1)
  assert.deepEqual(
    { ...(h.groupMessages[0] as object), messageId: "-" },
    { group, fromBotId: "a", fromChatId: "chat-a", taskId, chatId: "g1", messageId: "-", text: "Wer hat Zeit?" }
  )
  // Wer schon in der Gruppe schreibt, antwortet direkt: kein Eintrag, keine zweite Runde
  const inside = await h.send(taskId, "g1", "Noch was", true, A, "g1")
  assert.equal(inside.ok, false)
  assert.equal(h.groupMessages.length, 1)
  const foreign = await h.d.send({
    taskId, target: "g1", message: "x", priority: false, from: bot("e"), fromChatId: "chat-e", team,
  })
  assert.equal(foreign.ok, false) // E ist kein Mitglied
  // Eine gehaltene Gruppenrunde hält den Auftrag am Leben, bis sie fertig ist
  const release = h.d.hold(taskId)
  rootRelease()
  h.d.onRelease("chat-a")
  assert.ok(h.d.task(taskId))
  release()
  assert.equal(h.d.task(taskId), undefined)
})

test("Stopp im Root bricht laufende Orbis ab, verwirft wartende Zustellungen und markiert die Zeilen", async () => {
  const h = harness()
  const { taskId } = h.root()
  await h.send(taskId, "B", "läuft", true)
  await tick()
  h.reserved.add("chat-c") // C ist belegt: Zustellung wartet
  await h.send(taskId, "C", "wartet", true)
  await tick()
  assert.equal(h.wakes.length, 1)
  assert.equal(h.d.stopRoot("chat-a"), true)
  assert.deepEqual(h.stopped, ["chat-b"])
  await tick()
  assert.ok(lines(h.chat("chat-c")).every((l) => l.status === "fehlgeschlagen" && !l.queued))
  assert.ok(lines(h.chat("chat-b")).every((l) => l.status === "fehlgeschlagen"))
  // Das Ende des gestoppten Turns weckt niemanden.
  await h.wakes[0].finish({ text: "", failed: false, aborted: true })
  h.reserved.delete("chat-c")
  h.d.onRelease("chat-c")
  await tick()
  assert.equal(h.wakes.length, 1)
  assert.equal(lines(h.chat("chat-b")).filter((l) => l.kind === "reply").length, 0)
  const after = await h.send(taskId, "B", "nochmal", true)
  assert.equal(after.ok, false)
  assert.equal(h.d.stopRoot("chat-x"), false)
})

test("Nur der Ziel-Orbi gestoppt: der Fragende bekommt failed: und wird geweckt", async () => {
  const h = harness()
  const { taskId, release } = h.root()
  await h.send(taskId, "B", "Aufgabe", true)
  await tick()
  release()
  await h.wakes[0].finish({ text: "", failed: false, aborted: true })
  const reply = lines(h.chat("chat-a")).find((l) => l.kind === "reply")
  assert.equal(reply?.status, "fehlgeschlagen")
  assert.match(reply?.text ?? "", /^failed:/)
  assert.equal(h.wakes.at(-1)!.req.chatId, "chat-a")
})

test("Ziel fragt selbst weiter: Antwort an den ersten Absender erst nach der Antwort des Dritten", async () => {
  const h = harness()
  const { taskId, release } = h.root()
  await h.send(taskId, "B", "Mach X", true)
  await tick()
  release()
  // B bittet C um Hilfe
  await h.send(taskId, "C", "Hilf mir", true, B, "chat-b")
  await tick()
  await h.wakes[0].finish(ok("ich warte auf C")) // B-Turn zu Ende, aber C offen
  assert.equal(lines(h.chat("chat-a")).filter((l) => l.kind === "reply").length, 0)
  await h.wakes[1].finish(ok("result: C fertig")) // C antwortet B
  await tick()
  const bWake = h.wakes.at(-1)!
  assert.equal(bWake.req.chatId, "chat-b")
  assert.equal(bWake.req.kind, "reply")
  await bWake.finish(ok("result: X fertig"))
  const reply = lines(h.chat("chat-a")).find((l) => l.kind === "reply")
  assert.equal(reply?.text, "result: X fertig")
})

test("Ereignisse: jede neue oder geänderte Zeile meldet orbi-message", async () => {
  const h = harness()
  const { taskId } = h.root()
  await h.send(taskId, "B", "x", true)
  await tick()
  const kinds = h.events.filter((e) => e.type === "orbi-message")
  assert.ok(kinds.length >= 4) // 2 neue Zeilen + 2 Updates (queued false)
  assert.ok(kinds.every((e) => e.type === "orbi-message" && e.linkId))
})

test("Turn bricht mitten im Text ab: Antwort bekommt failed: davor, Status fehlgeschlagen", async () => {
  const h = harness()
  const { taskId, release } = h.root()
  await h.send(taskId, "B", "Aufgabe", true)
  await tick()
  release()
  await h.wakes[0].finish({ text: "Ich habe angefangen und", failed: true, aborted: false })
  const reply = lines(h.chat("chat-a")).find((l) => l.kind === "reply")
  assert.equal(reply?.text, "failed: Ich habe angefangen und")
  assert.equal(reply?.status, "fehlgeschlagen")
})

test("send_message-Zähler: parallele Aufrufe umgehen das Limit nicht, Fehler geben den Platz zurück", async () => {
  let delivered = 0
  const t = createSendMessageTool(async () => {
    delivered++
    await tick()
    return { ok: true, to: "B", linkId: "l", delivery: "held" }
  })
  const run = (n: number) =>
    t.execute!({ target: "B", message: `n${n}`, priority: false }, { toolCallId: "t", messages: [] }) as Promise<{ ok: boolean }>
  const results = await Promise.all([0, 1, 2, 3, 4, 5, 6].map(run))
  assert.equal(results.filter((r) => r.ok).length, LIMITS.sentPerTurn)
  assert.equal(delivered, LIMITS.sentPerTurn)
  let fail = true
  const u = createSendMessageTool(async () => {
    if (fail) return { ok: false, error: "nein" }
    return { ok: true, to: "B", linkId: "l", delivery: "held" }
  })
  const go = () => u.execute!({ target: "B", message: "x", priority: false }, { toolCallId: "t", messages: [] }) as Promise<{ ok: boolean }>
  for (let i = 0; i < 5; i++) assert.equal((await go()).ok, false)
  fail = false
  assert.equal((await go()).ok, true)
  const boom = createSendMessageTool(async () => {
    throw new Error("kaputt")
  })
  for (let i = 0; i < 5; i++)
    await assert.rejects(boom.execute!({ target: "B", message: "x", priority: false }, { toolCallId: "t", messages: [] }) as Promise<unknown>)
})

test(`Ping-Pong-Budget: ein Paar weckt sich je Auftrag höchstens ${LIMITS.pairWakes} Mal, danach nur lesen`, async () => {
  const h = harness()
  const { taskId } = h.root()
  // 1. Weckung: A -> B
  assert.equal((await h.send(taskId, "B", "Eins", true)).delivery !== "held", true)
  // 2. Weckung: A -> B
  assert.equal((await h.send(taskId, "B", "Zwei", true)).delivery !== "held", true)
  // 3. Weckung: A -> B
  assert.equal((await h.send(taskId, "B", "Drei", true)).delivery !== "held", true)
  // 4. Weckung: A -> B
  assert.equal((await h.send(taskId, "B", "Vier", true)).delivery !== "held", true)
  // 5. Weckung überschreitet pairWakes (4): A -> B
  const fifth = await h.send(taskId, "B", "Fünf", true)
  assert.equal(fifth.ok && fifth.delivery, "held")
  // Anderes Paar (A -> C) bleibt frei
  const other = await h.send(taskId, "C", "Frage an C?", true)
  assert.equal(other.ok && other.delivery !== "held", true)
})

test(`Gruppen: höchstens ${LIMITS.groupRoundsPerTask} Runden je Auftrag, Ping-Pong und aktive Orbis gelten auch dort`, async () => {
  const group: Group = { id: "g1", name: "Team", memberIds: ["a", "b", "c"] }
  const h = harness(group)
  const { taskId } = h.root()
  // Antwort auf eine Antwort ohne Frage geht nicht an die Gruppe
  const thanks = await h.send(taskId, "g1", "Danke euch", false, A, "chat-a", "reply")
  assert.equal(thanks.ok, false)
  assert.equal((await h.send(taskId, "g1", "Wer hat Zeit?", false, A, "chat-a", "reply")).ok, true)
  for (let i = 2; i <= LIMITS.groupRoundsPerTask; i++) {
    assert.equal((await h.send(taskId, "g1", `Eine Runde ${i}`, false)).ok, true)
  }
  const over = await h.send(taskId, "g1", `Runde ${LIMITS.groupRoundsPerTask + 1}`, false)
  assert.equal(over.ok, false)
  assert.match(over.ok ? "" : over.error, new RegExp(`höchstens ${LIMITS.groupRoundsPerTask} Gruppenrunden`))
  assert.equal(h.groupMessages.length, LIMITS.groupRoundsPerTask)
})

test("Gruppen: große Gruppe darf die Obergrenze aktiver Orbis nicht umgehen", async () => {
  const group: Group = { id: "g2", name: "Alle", memberIds: ["a", "b", "c", "d", "e", "f", "g", "h", "i"] }
  const h = harness(group)
  const { taskId } = h.root()
  const result = await h.send(taskId, "g2", "Alle mal herhören", false)
  assert.equal(result.ok, false)
  assert.match(result.ok ? "" : result.error, new RegExp(`höchstens ${LIMITS.activeOrbis} Orbis`))
  assert.equal(h.groupMessages.length, 0)
})

test("Übergabestatus folgt Frage und Abschluss statt Antwortpräfix", async () => {
  const h = harness()
  const { taskId } = h.root()
  await h.send(taskId, "B", "Bitte prüfen", true)
  await tick()
  await h.d.setWaiting("chat-b", true)
  assert.equal(lines(h.chat("chat-a")).find((l) => l.kind === "message")?.status, "wartet")
  await h.d.setWaiting("chat-b", false)
  assert.equal(lines(h.chat("chat-a")).find((l) => l.kind === "message")?.status, "arbeitet")
  await h.wakes[0]!.finish(ok("Erledigt, hier ist das Ergebnis."))
  assert.equal(lines(h.chat("chat-a")).find((l) => l.kind === "message")?.status, "fertig")
})
