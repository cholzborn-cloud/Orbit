import type { PendingInteraction, InteractionDecision } from "./interactions.ts"

export type ServiceEvent =
  | { type: "reminders-pending" }
  | { type: "reminders-cancelled"; id: string }
  | {
      type: "status"
      chatId: string
      botId: string
      status: "arbeitet" | "wartet" | "fertig" | "fehler" | "ruhig"
    }
  | {
      // Live-Statusleiste: ein Schritt (Werkzeug) des Turns beginnt oder endet. `label` kommt aus dem Code (lib/chat/step-labels.ts),
      // nie vom Modell; Werkzeuge ohne Label (say, react, ask_user) erzeugen kein Ereignis.
      type: "status-step"
      chatId: string
      botId: string
      toolCallId: string
      tool: string
      label: string
      state: "start" | "end"
      step: number // laufende Nummer im Turn, ab 1
      at: number // Unix-ms
    }
  | {
      // Reaktion gesetzt (`emoji`) oder entfernt (`emoji: null`). actor = "user" oder Orbi-ID.
      type: "reaction"
      chatId: string
      messageId: string
      actor: string
      emoji: string | null
    }
  | {
      // Kompakter Hinweis statt Werkzeugkarten: `retry` = der Orbi versucht es erneut, `action` = Consti muss etwas tun.
      // Nur live (kein Verlauf); `text` ist fertig formuliert, kurz, ohne Technikbegriffe.
      type: "notice"
      chatId: string
      botId: string
      kind: "retry" | "action"
      text: string
      at: number // Unix-ms
    }
  | {
      // Der Hauptorbi hat im Onboarding Orbis angelegt (nach Constis Auswahl). Orbis neu laden; ihr eigenes Onboarding
      // startet die App beim ersten Öffnen ihres Chats (`bots[].onboardingDone === false`).
      type: "orbis-created"
      bots: { botId: string; chatId: string; name: string }[]
    }
  | {
      // Onboarding eines Orbis ist abgeschlossen oder übersprungen; `instructions` = seine Anweisung wurde ergänzt.
      type: "onboarding"
      botId: string
      done: true
      instructions: boolean
    }
  | (PendingInteraction & {
      type: "approval" | "question"
      status: "pending" | InteractionDecision["status"]
      always?: true
    })
  | {
      type: "handoff"
      chatId: string
      botId: string
      status: "waiting" | "running" | "finished" | "error"
      handoffId: string
      to: string
    }
  | {
      // Gespeicherte Zeile „gesendet an / Nachricht von“ ist neu oder hat sich geändert: Chat-Verlauf neu laden.
      type: "orbi-message"
      chatId: string
      messageId: string
      linkId: string
      direction: "out" | "in"
      kind: "message" | "reply"
      status: "arbeitet" | "wartet" | "fertig" | "fehlgeschlagen" | "unklar"
      queued: boolean
      held: boolean
    }
  | {
      // Gruppenrunde (Consti oder Orbi schrieb in die Gruppe): Mitglieder sprechen nacheinander.
      // `start`/`reply`/`silent` je Mitglied (`reply` mit `messageId` der gespeicherten Antwort), `end` = Runde fertig.
      type: "group-turn"
      chatId: string
      phase: "start" | "reply" | "silent" | "end"
      botId?: string
      messageId?: string
      stopped?: boolean
    }
  | {
      type: "automation"
      automationId: string
      runId: string
      chatId: string | null
      trigger: "schedule" | "manual"
      status: "running" | "waiting" | "ok" | "error"
      error?: string
    }
  | {
      // Hintergrund-Helfer (Executor, tasks-Tabelle): Status und Fortschrittszeile
      type: "task"
      action: "start" | "progress" | "done" | "stopped" | "failed"
      taskId: string
      chatId: string
      botId: string
      title?: string | null
      brief?: string
      progress?: string | null
      status: string
    }

type Subscriber = { send: (data: Uint8Array) => void }

export class EventHub {
  private subscribers = new Set<Subscriber>()
  private readonly encoder = new TextEncoder()

  constructor(
    private readonly keepAliveMs = 15_000,
    private readonly queueSize = 64
  ) {}

  publish(event: ServiceEvent) {
    const data = this.encode(event)
    for (const subscriber of this.subscribers) subscriber.send(data)
  }

  response(snapshot: () => Record<string, unknown>): Response {
    let cleanup = () => {}
    const stream = new ReadableStream<Uint8Array>(
      {
        start: (controller) => {
          let closed = false
          let timer: ReturnType<typeof setInterval> | undefined
          const subscriber: Subscriber = {
            send: (data) => {
              if (closed) return
              // Langsame Leser verbinden sich mit einem neuen Zustandsabbild, statt Ereignisse still zu verlieren.
              if ((controller.desiredSize ?? 0) <= 0) {
                cleanup()
                controller.error(
                  new Error(
                    "Ereignisverbindung zu langsam. Bitte neu verbinden."
                  )
                )
                return
              }
              controller.enqueue(data)
            },
          }
          cleanup = () => {
            closed = true
            if (timer) clearInterval(timer)
            this.subscribers.delete(subscriber)
          }
          this.subscribers.add(subscriber)
          try {
            subscriber.send(this.encode({ ...snapshot(), type: "snapshot" }))
            timer = setInterval(
              () => subscriber.send(this.encoder.encode(": keepalive\n\n")),
              this.keepAliveMs
            )
            timer.unref()
          } catch {
            cleanup()
            controller.error(
              new Error("Der aktuelle Zustand konnte nicht geladen werden.")
            )
          }
        },
        cancel: () => cleanup(),
      },
      { highWaterMark: this.queueSize }
    )
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    })
  }

  private encode(value: unknown) {
    return this.encoder.encode(`data: ${JSON.stringify(value)}\n\n`)
  }
}
