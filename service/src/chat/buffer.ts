import { createUIMessageStreamResponse } from "ai"

import { LIMITS } from "../../../lib/chat/orbi-message.ts"
import { ActiveDeadline } from "./deadline.ts"

export type TurnLimits = { totalMs: number; idleMs: number }

// Werkzeugaufrufe, die gerade laufen: dabei zählt kein Leerlauf (das Gesamtlimit tickt weiter).
const OPENED = /"type":"tool-input-available"/g
const CLOSED = /"type":"tool-(?:output-available|output-error|output-denied)"/g

type Turn = {
  chunks: Uint8Array[]
  abort: AbortController
  done: boolean
  listeners: Set<() => void>
  headers: Promise<Headers>
  expiry?: ReturnType<typeof setTimeout>
  deadline: ActiveDeadline // Gesamtlimit, pausiert bei offener Freigabe/Rückfrage
  idle?: ReturnType<typeof setTimeout> // Abbruch ohne Lebenszeichen
  openTools: number
  waiting: boolean
}

export class TurnBuffers {
  private turns = new Map<string, Turn>()

  private readonly decoder = new TextDecoder()

  constructor(
    private readonly retentionMs = 60_000,
    private readonly limits: TurnLimits = {
      totalMs: LIMITS.turnTotalMs,
      idleMs: LIMITS.turnIdleMs,
    }
  ) {}

  start(
    chatId: string,
    produce: (signal: AbortSignal) => Promise<Response>,
    onSettled?: () => void
  ): boolean {
    const previous = this.turns.get(chatId)
    if (previous && !previous.done) return false
    if (previous?.expiry) clearTimeout(previous.expiry)
    let setHeaders!: (headers: Headers) => void
    const headers = new Promise<Headers>((resolve) => {
      setHeaders = resolve
    })
    const turn: Turn = {
      headers,
      deadline: new ActiveDeadline(this.limits.totalMs, {
        now: () => Date.now(),
      }),
      openTools: 0,
      waiting: false,
      chunks: [],
      abort: new AbortController(),
      done: false,
      listeners: new Set(),
    }
    this.turns.set(chatId, turn)
    // Der Produzent gehört dem Turn; das Abbrechen einer HTTP-Antwort beendet ihn nicht.
    turn.deadline.signal.addEventListener("abort", () => turn.abort.abort(), {
      once: true,
    })
    this.armIdle(turn)
    void this.consume(chatId, turn, produce, setHeaders).finally(() => {
      turn.deadline.dispose()
      clearTimeout(turn.idle)
      onSettled?.()
    })
    return true
  }

  // Jedes Lebenszeichen (Text, Denken, Werkzeugschritt) setzt den Leerlauf zurück. Kein Leerlauf zählt, solange eine
  // Freigabe/Rückfrage offen ist oder ein Werkzeug läuft; dafür gilt das Gesamtlimit.
  private armIdle(turn: Turn) {
    clearTimeout(turn.idle)
    turn.idle = undefined
    if (turn.done || turn.waiting || turn.openTools > 0) return
    turn.idle = setTimeout(() => turn.abort.abort(), this.limits.idleMs)
    turn.idle.unref()
  }

  private touch(turn: Turn, chunk: Uint8Array) {
    const text = this.decoder.decode(chunk, { stream: true })
    turn.openTools = Math.max(
      0,
      turn.openTools +
        (text.match(OPENED)?.length ?? 0) -
        (text.match(CLOSED)?.length ?? 0)
    )
    this.armIdle(turn)
  }

  setWaiting(chatId: string, waiting: boolean) {
    const turn = this.turns.get(chatId)
    if (!turn || turn.done) return
    turn.waiting = waiting
    turn.deadline.pause(waiting)
    this.armIdle(turn)
  }

  async waitForIdle(chatId: string, signal: AbortSignal): Promise<void> {
    const turn = this.turns.get(chatId)
    if (!turn || turn.done) return
    signal.throwIfAborted()
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        turn.listeners.delete(check)
        signal.removeEventListener("abort", abort)
      }
      const check = () => {
        if (turn.done) {
          cleanup()
          resolve()
        } else turn.listeners.add(check)
      }
      const abort = () => {
        cleanup()
        reject(signal.reason)
      }
      signal.addEventListener("abort", abort, { once: true })
      turn.listeners.add(check)
    })
  }

  async response(chatId: string): Promise<Response | null> {
    const turn = this.turns.get(chatId)
    if (!turn) return null
    const headers = await turn.headers
    return new Response(this.stream(turn), { headers })
  }

  private stream(turn: Turn): ReadableStream<Uint8Array> {
    let position = 0
    let cancelled = false
    let wake: (() => void) | undefined
    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        while (!cancelled) {
          if (position < turn.chunks.length) {
            controller.enqueue(turn.chunks[position++])
            return
          }
          if (turn.done) {
            controller.close()
            return
          }
          await new Promise<void>((resolve) => {
            wake = resolve
            turn.listeners.add(resolve)
          })
          if (wake) turn.listeners.delete(wake)
          wake = undefined
        }
      },
      cancel() {
        cancelled = true
        if (wake) {
          turn.listeners.delete(wake)
          wake()
        }
      },
    })
  }

  isRunning(chatId: string): boolean {
    const turn = this.turns.get(chatId)
    return !!turn && !turn.done
  }

  forget(chatId: string): boolean {
    const turn = this.turns.get(chatId)
    if (turn && !turn.done) return false
    if (turn?.expiry) clearTimeout(turn.expiry)
    this.turns.delete(chatId)
    return true
  }

  stop(chatId: string): boolean {
    const turn = this.turns.get(chatId)
    if (!turn || turn.done) return false
    turn.abort.abort()
    return true
  }

  private async consume(
    chatId: string,
    turn: Turn,
    produce: (signal: AbortSignal) => Promise<Response>,
    setHeaders: (headers: Headers) => void
  ) {
    const notify = () => {
      const listeners = [...turn.listeners]
      turn.listeners.clear()
      for (const listener of listeners) listener()
    }
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      const response = await produce(turn.abort.signal)
      if (!response.ok || !response.body) throw new Error("Kein Antwortstream.")
      setHeaders(response.headers)
      reader = response.body.getReader()
      while (true) {
        const next = await reader.read()
        if (next.done) break
        turn.chunks.push(next.value)
        this.touch(turn, next.value)
        notify()
      }
    } catch {
      const response = createUIMessageStreamResponse({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(
              turn.abort.signal.aborted
                ? { type: "abort" }
                : {
                    type: "error",
                    errorText: "Die Antwort konnte nicht abgeschlossen werden.",
                  }
            )
            controller.close()
          },
        }),
      })
      setHeaders(response.headers)
      turn.chunks.push(new Uint8Array(await response.arrayBuffer()))
    } finally {
      reader?.releaseLock()
      turn.done = true
      notify()
      turn.expiry = setTimeout(() => {
        if (this.turns.get(chatId) === turn) this.turns.delete(chatId)
      }, this.retentionMs)
      turn.expiry.unref()
    }
  }
}
