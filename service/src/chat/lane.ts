import { createUIMessageStreamResponse } from "ai"

import type { TurnBuffers } from "./buffer"
import type { Inbox, InboxItem } from "./inbox"

// Lauf-Steuerung je Chat („Lane“, Vorbild OpenClaw: eine Hauptarbeit je Sitzung, Nachrichten währenddessen werden gelenkt oder gesammelt,
// nie abgewiesen). Alle Läufe sind gepuffert und hängen nicht an der HTTP-Verbindung: App zu, Chatwechsel oder Verbindungsabbruch beenden
// keinen Lauf; die App liest über `/stream` wieder mit (Hauptlauf) bzw. lädt den Verlauf, sobald der Chat „fertig“ meldet (Seitenlauf).
//
// Eingehende Nachricht von Consti:
//  - Chat frei: Hauptlauf startet.
//  - Chat belegt, Einzelchat: Seitenlauf antwortet sofort parallel; die Hauptarbeit bekommt die Nachricht an ihrer nächsten
//    Schrittgrenze (siehe turn.ts, prepareStep) und berücksichtigt sie.
//  - Chat belegt, Gruppe: Nachricht wird gespeichert und wartet im Eingang; nach der Runde startet ein Folgelauf.
//  - Wiederholen/Onboarding bei belegtem Chat: 409 (nichts geht verloren, die App behält die Eingabe).
// Ende eines Laufs: `drain` prüft den Eingang; Unbeantwortetes, das die Hauptarbeit nicht gesehen hat, bekommt genau einen Folgelauf.
export type LaneMode = "main" | "side" | "queue" | "continue"

export type LaneHandler = (input: {
  chatId: string
  body: Record<string, unknown>
  signal: AbortSignal
  mode: LaneMode
  // Seitenlauf: die Nachricht ist gespeichert (erst dann zählt sie im Eingang) bzw. der Lauf ist fertig.
  onStored?: () => void
  onSide?: (result: { reply?: string; failed: boolean }) => void
}) => Promise<Response>

export type LaneDeps = {
  turns: TurnBuffers
  inbox: Inbox
  // Reserviert den Chat für einen Hauptlauf (Gruppen halten ihn bis zum Ende der Runde); undefined = belegt.
  reserve: (chatId: string) => (() => void) | undefined
  handle: LaneHandler
  isGroup: (chatId: string) => Promise<boolean>
  // Der Chat ist gerade belegt (auch durch geweckte Orbis oder Gruppenrunden).
  isBusy: (chatId: string) => boolean
  // Offener „Unterbrochen“-Hinweis: dann startet nach einem Neustart kein Folgelauf von selbst (Werkzeuge hätten Nebenwirkungen).
  interrupted?: (chatId: string) => boolean
  // Wird gerade geleert: keine neuen Läufe.
  clearing?: (chatId: string) => boolean
  removeMessage?: (chatId: string, messageId: string) => Promise<void>
  // Offene Rückfrage-Karte im Chat: getippter Text beantwortet sie (oder überspringt sie bei mehreren Fragen).
  answerOpenCard?: (chatId: string, text: string) => Promise<"answered" | "skipped" | null>
  hasOpenCard?: (chatId: string) => boolean
}

const busyResponse = () => Response.json({ error: "In diesem Chat läuft bereits eine Antwort." }, { status: 409 })

// Leere Antwort im UI-Nachrichtenformat: die App behandelt sie wie eine fertige Antwort ohne Inhalt (die Nachricht steht schon im Verlauf).
const emptyStream = () =>
  createUIMessageStreamResponse({
    stream: new ReadableStream({
      start(controller) {
        controller.close()
      },
    }),
  })

type Incoming = { id: string; text: string } | null

function incomingMessage(body: Record<string, unknown>): Incoming {
  const messages = body.messages
  if (!Array.isArray(messages) || messages.length !== 1) return null
  const message = messages[0] as { id?: unknown; role?: unknown; parts?: unknown }
  if (!message || message.role !== "user" || typeof message.id !== "string" || !Array.isArray(message.parts)) return null
  const text = (message.parts as { type?: string; text?: string }[])
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part.text)
    .join("\n")
    .trim()
  const files = (message.parts as { type?: string }[]).filter((part) => part?.type === "file").length
  return { id: message.id, text: text || (files ? `(${files} Datei${files === 1 ? "" : "en"})` : "") }
}

export function createLane(deps: LaneDeps) {
  const { turns, inbox } = deps
  const draining = new Set<string>()

  const startMain = (chatId: string, body: Record<string, unknown>, mode: "main" | "continue", release: () => void) => {
    const started = turns.start(chatId, (signal) => deps.handle({ chatId, body, signal, mode }), release)
    if (!started) release()
    return started
  }

  async function submit(chatId: string, body: Record<string, unknown>): Promise<Response> {
    if (deps.clearing?.(chatId)) return busyResponse()
    const release = deps.reserve(chatId)
    if (release) {
      if (!startMain(chatId, body, "main", release)) return busyResponse()
      return (await turns.response(chatId))!
    }
    // Chat ist belegt.
    const trigger = (body.trigger as string | undefined) ?? "submit-message"
    const message = trigger === "submit-message" ? incomingMessage(body) : null
    if (!message) return busyResponse()
    const clientData = body.clientData
    // Wartet die Arbeit gerade auf eine Rückfrage, ist das Getippte die Antwort: Karte schließen, Nachricht speichern, kein Seitenlauf
    // (sonst wartete die Hauptarbeit weiter auf die Karte, während ein Seitenlauf „ich berücksichtige das“ sagt).
    if (deps.hasOpenCard?.(chatId) && deps.answerOpenCard) {
      const stored = await deps.handle({ chatId, body, signal: new AbortController().signal, mode: "queue" })
      if (!stored.ok) return stored
      const card = await deps.answerOpenCard(chatId, message.text)
      // Beantwortet: die Hauptarbeit hat den Text als Ergebnis der Karte. Übersprungen/zu spät: sie bekommt ihn über den Eingang.
      inbox.add(chatId, { messageId: message.id, text: message.text, mode: "queued", clientData, ...(card === "answered" && { seen: true }) })
      void drain(chatId)
      return emptyStream()
    }
    if (await deps.isGroup(chatId)) {
      const stored = await deps.handle({ chatId, body, signal: new AbortController().signal, mode: "queue" })
      if (!stored.ok) return stored
      inbox.add(chatId, { messageId: message.id, text: message.text, mode: "queued", clientData })
      // Endete die Runde inzwischen, startet der Folgelauf jetzt.
      void drain(chatId)
      return emptyStream()
    }
    const key = `${chatId}~side~${message.id}`
    let reported = false
    const started = turns.start(
      key,
      (signal) =>
        deps.handle({
          chatId,
          body,
          signal,
          mode: "side",
          onStored: () => inbox.add(chatId, { messageId: message.id, text: message.text, mode: "side", side: "running", clientData }),
          onSide: (result) => {
            reported = true
            inbox.sideFinished(chatId, message.id, result)
          },
        }),
      () => {
        if (!reported) inbox.sideFinished(chatId, message.id, { failed: true })
        void drain(chatId)
      }
    )
    if (!started) return busyResponse()
    return (await turns.response(key)) ?? busyResponse()
  }

  // Nach jedem Laufende (und beim Start des Dienstes): braucht der Eingang einen Folgelauf?
  async function drain(chatId: string): Promise<void> {
    if (draining.has(chatId)) return
    draining.add(chatId)
    try {
      if (deps.isBusy(chatId) || turns.runningKeys(chatId).length > 0) return
      if (deps.clearing?.(chatId)) return
      const { followUp, pendingSide } = inbox.settle(chatId)
      if (pendingSide || followUp.length === 0) return
      const release = deps.reserve(chatId)
      if (!release) return
      const latest = followUp.at(-1)!
      const clientData = (latest.clientData as Record<string, unknown> | undefined) ?? { model: "auto" }
      inbox.consume(
        chatId,
        followUp.map((item) => item.messageId)
      )
      startMain(chatId, { trigger: "continue", messages: [], clientData: { ...clientData, side: undefined } }, "continue", release)
    } finally {
      draining.delete(chatId)
    }
  }

  // Stopp: Hauptlauf und Seitenläufe beenden; wartende, unbeantwortete Nachrichten gehen als Text zurück (die App legt sie ins Eingabefeld).
  async function stop(chatId: string): Promise<{ stopped: boolean; requeued: string[] }> {
    let stopped = false
    for (const key of turns.runningKeys(chatId)) stopped = turns.stop(key) || stopped
    const queued: InboxItem[] = inbox.takeQueued(chatId)
    // Stopp heißt Ruhe: auch abgebrochene Seitenläufe lösen keinen Folgelauf mehr aus (ihre Nachrichten bleiben im Verlauf stehen).
    inbox.clear(chatId)
    for (const item of queued)
      try {
        await deps.removeMessage?.(chatId, item.messageId)
      } catch {
        console.error("Wartende Nachricht konnte nicht entfernt werden.")
      }
    return { stopped, requeued: queued.map((item) => item.text).filter(Boolean) }
  }

  // Dienststart: Seitenläufe von vorher sind weg (gelten als gescheitert); wartende Nachrichten bekommen ihren Folgelauf.
  async function recover(): Promise<number> {
    let started = 0
    for (const chatId of inbox.chats()) {
      for (const item of inbox.list(chatId))
        if (item.mode === "side" && item.side === "running") inbox.sideFinished(chatId, item.messageId, { failed: true })
      if (deps.interrupted?.(chatId)) continue
      const before = turns.runningKeys(chatId).length
      await drain(chatId)
      if (turns.runningKeys(chatId).length > before) started++
    }
    return started
  }

  // Eine Nachricht im Namen von Consti (Antwort auf eine wiederhergestellte Rückfrage): wie getippt, nur ohne App-Verbindung.
  async function post(chatId: string, body: Record<string, unknown>): Promise<boolean> {
    const response = await submit(chatId, body)
    if (!response.ok) return false
    void response.body?.pipeTo(new WritableStream()).catch(() => {})
    return true
  }

  // Verlauf geleert: der Eingang dieses Chats ist hinfällig.
  const clear = (chatId: string) => inbox.clear(chatId)

  return { submit, drain, stop, recover, post, clear }
}

export type Lane = ReturnType<typeof createLane>
