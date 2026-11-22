import assert from "node:assert/strict"
import test from "node:test"

import { createUIMessageStreamResponse } from "ai"

import { TurnBuffers } from "./buffer.ts"
import { Inbox, memoryInboxStorage, steeringText } from "./inbox.ts"
import { createLane, type LaneHandler, type LaneMode } from "./lane.ts"

// Lauf-Steuerung mit einem Fake-Handler: welche Läufe starten wann, was passiert mit Nachrichten während der Arbeit.
const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms))

function textResponse(text: string, wait?: Promise<void>, signal?: AbortSignal) {
  return createUIMessageStreamResponse({
    stream: new ReadableStream({
      async start(controller) {
        controller.enqueue({ type: "start" })
        if (wait)
          await Promise.race([
            wait,
            new Promise<void>((_, reject) => signal?.addEventListener("abort", () => reject(new Error("abort")), { once: true })),
          ]).catch(() => {})
        controller.enqueue({ type: "text-start", id: "t" })
        controller.enqueue({ type: "text-delta", id: "t", delta: text })
        controller.enqueue({ type: "text-end", id: "t" })
        controller.enqueue({ type: "finish" })
        controller.close()
      },
    }),
  })
}

const user = (id: string, text: string) => ({ messages: [{ id, role: "user", parts: [{ type: "text", text }] }], clientData: { model: "auto" } })

function setup(options: { group?: boolean; interrupted?: boolean; openCard?: boolean } = {}) {
  const turns = new TurnBuffers(1000)
  const inbox = new Inbox(memoryInboxStorage())
  const reserved = new Set<string>()
  const calls: { mode: LaneMode; body: Record<string, unknown> }[] = []
  const removed: string[] = []
  const answered: string[] = []
  const gates = new Map<string, { promise: Promise<void>; open: () => void }>()
  const gate = (name: string) => {
    let open!: () => void
    const promise = new Promise<void>((resolve) => (open = resolve))
    gates.set(name, { promise, open })
    return gates.get(name)!
  }
  let sideResult: { reply?: string; failed: boolean } = { reply: "Kurz: 12 Uhr", failed: false }
  const handle: LaneHandler = async ({ body, mode, signal, onStored, onSide }) => {
    calls.push({ mode, body })
    if (mode === "queue") return Response.json({ ok: true, queued: true })
    if (mode === "side") {
      onStored?.()
      const response = textResponse(sideResult.reply ?? "", gates.get("side")?.promise, signal)
      onSide?.(sideResult)
      return response
    }
    return textResponse("Hauptantwort", gates.get("main")?.promise, signal)
  }
  let lane!: ReturnType<typeof createLane>
  const reserve = (chatId: string) => {
    if (reserved.has(chatId)) return undefined
    reserved.add(chatId)
    return () => {
      reserved.delete(chatId)
      setImmediate(() => void lane.drain(chatId))
    }
  }
  lane = createLane({
    turns,
    inbox,
    reserve,
    handle,
    isGroup: async () => options.group === true,
    isBusy: (chatId) => reserved.has(chatId),
    interrupted: () => options.interrupted === true,
    removeMessage: async (_chatId, id) => void removed.push(id),
    hasOpenCard: () => options.openCard === true && answered.length === 0,
    answerOpenCard: async (_chatId, text) => {
      answered.push(text)
      return "answered"
    },
  })
  return {
    answered,
    turns,
    inbox,
    lane,
    calls,
    removed,
    gate,
    setSide: (value: typeof sideResult) => (sideResult = value),
    settled: async () => {
      for (let i = 0; i < 400 && (turns.runningKeys("c").length > 0 || reserved.has("c")); i++) await tick()
      await tick(10)
    },
  }
}

const read = async (response: Response) => await response.text()

test("Lane: freier Chat startet den Hauptlauf; belegter Einzelchat beantwortet sofort parallel (Seitenlauf)", async () => {
  const s = setup()
  const main = s.gate("main")
  const first = await s.lane.submit("c", user("u1", "Lange Aufgabe"))
  assert.equal(first.status, 200)
  const side = await s.lane.submit("c", user("u2", "Wie spät ist es?"))
  assert.match(await read(side), /12 Uhr/)
  assert.deepEqual(s.calls.map((c) => c.mode), ["main", "side"])
  // Hauptlauf läuft noch; der Eintrag ist beantwortet, aber noch nicht gesehen.
  assert.equal(s.inbox.list("c")[0].side, "done")
  main.open()
  await read(first)
  await s.settled()
  // Beantworteter Seitenlauf braucht keinen Folgelauf, der Eingang ist leer.
  assert.deepEqual(s.calls.map((c) => c.mode), ["main", "side"])
  assert.equal(s.inbox.list("c").length, 0)
})

test("Lane: Seitenlauf hängt nicht an der Verbindung (Abbruch beim Lesen beendet ihn nicht)", async () => {
  const s = setup()
  s.gate("main")
  const sideGate = s.gate("side")
  await s.lane.submit("c", user("u1", "Lange Aufgabe"))
  const side = await s.lane.submit("c", user("u2", "Zwischenfrage"))
  await side.body!.cancel()
  assert.equal(s.turns.runningKeys("c").includes("c~side~u2"), true)
  sideGate.open()
  for (let i = 0; i < 100 && s.turns.runningKeys("c").includes("c~side~u2"); i++) await tick()
  assert.equal(s.turns.runningKeys("c").includes("c~side~u2"), false)
  // Wiederverbinden mit dem gepufferten Seitenlauf liefert die ganze Antwort.
  assert.match(await read((await s.turns.response("c~side~u2"))!), /12 Uhr/)
})

test("Lane: gescheiterter Seitenlauf, den die Hauptarbeit nicht gesehen hat, bekommt genau einen Folgelauf", async () => {
  const s = setup()
  const main = s.gate("main")
  s.setSide({ failed: true })
  const first = await s.lane.submit("c", user("u1", "Lange Aufgabe"))
  await read(await s.lane.submit("c", user("u2", "Und noch das")))
  await read(await s.lane.submit("c", user("u3", "Und das")))
  main.open()
  await read(first)
  await s.settled()
  assert.deepEqual(s.calls.map((c) => c.mode), ["main", "side", "side", "continue"])
  assert.equal(s.calls[3].body.trigger, "continue")
  assert.equal(s.inbox.list("c").length, 0)
})

test("Lane: von der Hauptarbeit gesehene Nachricht braucht keinen Folgelauf (Lenken statt Nachholen)", async () => {
  const s = setup()
  const main = s.gate("main")
  s.setSide({ failed: true })
  const first = await s.lane.submit("c", user("u1", "Lange Aufgabe"))
  await read(await s.lane.submit("c", user("u2", "Bitte auf Englisch")))
  const taken = s.inbox.takeForMain("c")
  assert.equal(taken.length, 1)
  assert.match(steeringText(taken), /Bitte auf Englisch/)
  // Zweimal holen liefert nichts Neues.
  assert.equal(s.inbox.takeForMain("c").length, 0)
  main.open()
  await read(first)
  await s.settled()
  assert.deepEqual(s.calls.map((c) => c.mode), ["main", "side"])
})

test("Lane: Gruppe belegt -> Nachricht wartet im Eingang, nach der Runde startet ein Folgelauf mit allen", async () => {
  const s = setup({ group: true })
  const main = s.gate("main")
  const first = await s.lane.submit("c", user("u1", "Hallo Gruppe"))
  const queued = await s.lane.submit("c", user("u2", "Noch was"))
  assert.equal(queued.status, 200)
  await read(queued)
  await read(await s.lane.submit("c", user("u3", "Und das")))
  assert.deepEqual(s.calls.map((c) => c.mode), ["main", "queue", "queue"])
  main.open()
  await read(first)
  await s.settled()
  assert.deepEqual(s.calls.map((c) => c.mode), ["main", "queue", "queue", "continue"])
  assert.equal(s.inbox.list("c").length, 0)
})

test("Lane: Stopp beendet alle Läufe und gibt wartende Nachrichten als Text zurück, kein Folgelauf", async () => {
  const s = setup({ group: true })
  s.gate("main")
  const first = await s.lane.submit("c", user("u1", "Hallo Gruppe"))
  await read(await s.lane.submit("c", user("u2", "Noch was")))
  const result = await s.lane.stop("c")
  assert.equal(result.stopped, true)
  assert.deepEqual(result.requeued, ["Noch was"])
  assert.deepEqual(s.removed, ["u2"])
  await read(first)
  await s.settled()
  assert.deepEqual(s.calls.map((c) => c.mode), ["main", "queue"])
})

test("Lane: Wiederholen bei belegtem Chat bleibt 409, nichts wird gespeichert", async () => {
  const s = setup()
  s.gate("main")
  await s.lane.submit("c", user("u1", "Lange Aufgabe"))
  const again = await s.lane.submit("c", { messages: [], trigger: "regenerate-message", clientData: { model: "auto" } })
  assert.equal(again.status, 409)
  assert.equal(s.inbox.list("c").length, 0)
})

test("Lane: nach Neustart starten wartende Nachrichten von selbst, nicht bei unterbrochener Arbeit", async () => {
  const s = setup()
  s.inbox.add("c", { messageId: "u9", text: "Vor dem Neustart", mode: "side", side: "running", clientData: { model: "auto" } })
  assert.equal(await s.lane.recover(), 1)
  await s.settled()
  assert.deepEqual(s.calls.map((c) => c.mode), ["continue"])

  const blocked = setup({ interrupted: true })
  blocked.inbox.add("c", { messageId: "u9", text: "Vor dem Neustart", mode: "queued" })
  assert.equal(await blocked.lane.recover(), 0)
  assert.equal(blocked.calls.length, 0)
  assert.equal(blocked.inbox.list("c").length, 1)
})

test("Lane: Stopp während eines Seitenlaufs löst danach keinen Folgelauf aus", async () => {
  const s = setup()
  s.gate("main")
  s.gate("side")
  const first = await s.lane.submit("c", user("u1", "Lange Aufgabe"))
  const side = await s.lane.submit("c", user("u2", "Zwischenfrage"))
  const result = await s.lane.stop("c")
  assert.deepEqual(result.requeued, [])
  await read(first)
  await read(side)
  await s.settled()
  assert.deepEqual(s.calls.map((c) => c.mode), ["main", "side"])
  assert.equal(s.inbox.list("c").length, 0)
})

test("Lane: offene Rückfrage-Karte -> getippte Nachricht ist die Antwort (kein Seitenlauf, kein Folgelauf)", async () => {
  const s = setup({ openCard: true })
  const main = s.gate("main")
  const first = await s.lane.submit("c", user("u1", "Frag mich was"))
  const typed = await s.lane.submit("c", user("u2", "Kaffee bitte"))
  assert.equal(typed.status, 200)
  await read(typed)
  assert.deepEqual(s.answered, ["Kaffee bitte"])
  assert.deepEqual(s.calls.map((c) => c.mode), ["main", "queue"])
  main.open()
  await read(first)
  await s.settled()
  assert.deepEqual(s.calls.map((c) => c.mode), ["main", "queue"])
  assert.equal(s.inbox.list("c").length, 0)
})
