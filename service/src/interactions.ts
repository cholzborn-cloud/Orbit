import { randomUUID } from "node:crypto"

import {
  APPROVAL_LIFETIME_MS,
  isExpired,
} from "../../lib/approvals/expiry.ts"
import type { ApprovalRequestStore } from "../../lib/approvals/request.ts"
import type { RiskReason } from "../../lib/approvals/risk.ts"
import { askUserInput, type AskUserOutput } from "../../lib/chat/ask-user.ts"

export type PendingInteraction = {
  id: string
  kind: "approval" | "ask"
  chatId: string
  botId: string
  toolCallId: string
  tool: string
  input: unknown
  requestedAt: number
  expiresAt: number
  // Feste Freigabe-Regel: Art, Schlüssel für „Immer“ und deutscher Satz für die Karte.
  // approvalKind statt kind, weil kind (approval/ask) die alte App schon nutzt.
  reason?: RiskReason
  approvalKind?: string
  text?: string
  // Lauf E: voller Klartext zum Anzeigen (mehrzeilig, nicht gekürzt), z. B. Plan und Prompt einer Automation. Nur bei einigen Arten.
  detail?: string
  // Phase 2: Frage/Freigabe eines geweckten Orbis. Sie erscheint zusätzlich im Root-Chat (dort schrieb Consti);
  // beantwortet wird über dieselbe Id. Fehlt `root`, fragt der Orbi im Chat, in dem Consti schreibt.
  root?: { chatId: string; taskId: string }
  from?: { id: string; name: string; avatar: string; color: string | null }
  // Phase 5: nach einem Neustart von orbitd wiederhergestellt. Der Turn dazu ist weg (Chat zeigt „Unterbrochen“); die Karte bleibt sichtbar.
  restored?: boolean
}
export type InteractionRequest = Omit<
  PendingInteraction,
  "id" | "requestedAt" | "expiresAt"
> & { id?: string }
export type InteractionDecision =
  | { status: "approved"; always?: boolean }
  | { status: "denied" | "expired" | "aborted" }
  | { status: "answered"; answer: AskUserOutput }
export type DecideResult =
  | { ok: true }
  | {
      ok: false
      error: "not_found" | "already_decided" | "expired" | "invalid" | "storage"
    }
type Entry = {
  request: PendingInteraction
  resolve: (value: InteractionDecision) => void
  cleanup: () => void
  deciding: boolean
}
// Schon beantwortete, wiederhergestellte Karte: gilt genau einmal für die gleiche Anfrage (Chat, Werkzeug, Eingabe).
type PreDecided = { request: PendingInteraction; decision: InteractionDecision }
const sameAsk = (a: PendingInteraction, b: Pick<PendingInteraction, "chatId" | "kind" | "tool" | "input">) =>
  a.chatId === b.chatId && a.kind === b.kind && a.tool === b.tool && JSON.stringify(a.input) === JSON.stringify(b.input)
type Options = {
  store: ApprovalRequestStore
  saveRule?: (request: PendingInteraction) => Promise<void>
  now?: () => number
  onChange?: (
    request: PendingInteraction,
    decision?: InteractionDecision
  ) => void
  setTimer?: (callback: () => void, milliseconds: number) => () => void
  // Phase 5: offene Freigaben überstehen einen Neustart. save beim Anlegen (ohne decision) und bei der Entscheidung über eine
  // wiederhergestellte Karte (mit decision: gilt einmal für die gleiche Anfrage im fortgesetzten Turn), remove beim Beenden.
  persist?: {
    save: (request: PendingInteraction, decision?: InteractionDecision) => void
    remove: (id: string) => void
  }
}
const LIFETIME = APPROVAL_LIFETIME_MS

export class InteractionManager {
  private creating = new Set<string>()
  private pending = new Map<string, Entry>()
  private preDecided: PreDecided[] = []
  private completed = new Map<
    string,
    { status: InteractionDecision["status"]; at: number }
  >()
  private readonly now: () => number
  private readonly setTimer: NonNullable<Options["setTimer"]>

  constructor(private readonly options: Options) {
    this.now = options.now ?? Date.now
    this.setTimer =
      options.setTimer ??
      ((callback, ms) => {
        const timer = setTimeout(callback, ms)
        timer.unref()
        return () => clearTimeout(timer)
      })
  }

  list(chatId?: string): PendingInteraction[] {
    this.expire()
    return structuredClone(
      [...this.pending.values()]
        .map(({ request }) => request)
        .filter((request) => !chatId || request.chatId === chatId)
    )
  }

  // Beim Start: gespeicherte Karten wieder anzeigen (ohne Turn dahinter). Entscheidungen, die schon fielen, warten auf den fortgesetzten Turn.
  restore(items: { request: PendingInteraction; decision?: InteractionDecision }[]) {
    for (const { request, decision } of items) {
      if (this.pending.has(request.id) || isExpired(request.requestedAt, this.now())) {
        this.options.persist?.remove(request.id)
        continue
      }
      if (decision) {
        this.preDecided.push({ request, decision })
        continue
      }
      const restored = { ...request, restored: true }
      const cancelTimer = this.setTimer(
        () => this.finish(restored.id, { status: "expired" }),
        Math.max(0, restored.expiresAt - this.now())
      )
      this.pending.set(restored.id, {
        request: restored,
        resolve: () => {},
        deciding: false,
        cleanup: cancelTimer,
      })
    }
  }

  async wait(
    input: InteractionRequest,
    signal: AbortSignal,
    onPending?: (request: PendingInteraction) => Promise<void>
  ): Promise<InteractionDecision> {
    this.expire()
    if (signal.aborted) return { status: "aborted" }
    const id =
      input.id ?? (input.kind === "ask" ? input.toolCallId : randomUUID())
    if (this.creating.has(id) || this.pending.has(id) || this.completed.has(id))
      return { status: "denied" }
    // Die Zeit wird vor dem Anzeigen persistiert; ein Neustart verlängert keine Freigabe.
    this.creating.add(id)
    let requestedAt: number | Date | null
    try {
      requestedAt = await new Promise<number | Date | null>(
        (resolve, reject) => {
          const onAbort = () => resolve(null)
          signal.addEventListener("abort", onAbort, { once: true })
          void this.options.store
            .create({
              toolCallId: input.toolCallId,
              userId: "local",
              tool: input.tool,
            })
            .then(resolve, reject)
            .finally(() => signal.removeEventListener("abort", onAbort))
        }
      )
    } catch {
      return { status: "denied" }
    } finally {
      this.creating.delete(id)
    }
    if (requestedAt === null || signal.aborted) return { status: "aborted" }
    const timestamp = new Date(requestedAt).getTime()
    if (!Number.isFinite(timestamp) || isExpired(timestamp, this.now()))
      return { status: "expired" }
    const request = structuredClone({
      ...input,
      id,
      requestedAt: timestamp,
      expiresAt: timestamp + LIFETIME,
    })
    const known = this.preDecided.findIndex(
      (item) => !isExpired(item.request.requestedAt, this.now()) && sameAsk(item.request, request)
    )
    if (known >= 0) {
      const [item] = this.preDecided.splice(known, 1)
      this.options.persist?.remove(item.request.id)
      return item.decision
    }
    return new Promise<InteractionDecision>((resolve) => {
      const onAbort = () => this.finish(id, { status: "aborted" })
      const cancelTimer = this.setTimer(
        () => this.finish(id, { status: "expired" }),
        Math.max(0, request.expiresAt - this.now())
      )
      this.pending.set(id, {
        request,
        resolve,
        deciding: false,
        cleanup: () => {
          cancelTimer()
          signal.removeEventListener("abort", onAbort)
        },
      })
      signal.addEventListener("abort", onAbort, { once: true })
      if (signal.aborted) onAbort()
      else {
        try {
          this.options.persist?.save(request)
        } catch {
          console.error("Offene Freigabe konnte nicht gespeichert werden.")
        }
        this.options.onChange?.(request)
        void Promise.resolve()
          .then(() => onPending?.(request))
          .catch(() => this.finish(id, { status: "denied" }))
      }
    })
  }

  async decide(id: string, input: unknown): Promise<DecideResult> {
    this.expire()
    const entry = this.pending.get(id)
    if (!entry)
      return {
        ok: false,
        error:
          this.completed.get(id)?.status === "expired"
            ? "expired"
            : this.completed.has(id)
              ? "already_decided"
              : "not_found",
      }
    if (entry.deciding) return { ok: false, error: "already_decided" }
    const decision = this.validate(entry.request, input)
    if (!decision) return { ok: false, error: "invalid" }
    entry.deciding = true
    try {
      const persistedAt = await this.options.store.get(
        entry.request.toolCallId,
        "local"
      )
      if (
        persistedAt === null ||
        isExpired(persistedAt, this.now()) ||
        isExpired(entry.request.requestedAt, this.now())
      ) {
        this.finish(id, { status: "expired" })
        return { ok: false, error: "expired" }
      }
      // Vermutung: Zugangsdaten haben kein „Immer“; die alte App schickt es trotzdem, dann gilt es einmal.
      const always =
        decision.status === "approved" &&
        (input as { always?: boolean }).always === true &&
        entry.request.reason !== "geheimnis"
      if (always) {
        if (!this.options.saveRule) return { ok: false, error: "storage" }
        await this.options.saveRule(entry.request)
      }
      if (this.pending.get(id) !== entry)
        return {
          ok: false,
          error:
            this.completed.get(id)?.status === "expired"
              ? "expired"
              : "already_decided",
        }
      if (isExpired(entry.request.requestedAt, this.now())) {
        this.finish(id, { status: "expired" })
        return { ok: false, error: "expired" }
      }
      this.finish(id, always ? { status: "approved", always } : decision)
      return { ok: true }
    } catch {
      return { ok: false, error: "storage" }
    } finally {
      entry.deciding = false
    }
  }

  // Turn zu Ende oder abgebrochen: offene Karten dieses Chats sind hinfällig (Status `aborted`).
  abortChat(chatId: string) {
    for (const [id, entry] of [...this.pending])
      if (entry.request.chatId === chatId) this.finish(id, { status: "aborted" })
  }

  private validate(
    request: PendingInteraction,
    input: unknown
  ): InteractionDecision | null {
    if (!input || typeof input !== "object" || Array.isArray(input)) return null
    const value = input as Record<string, unknown>
    if (request.kind === "approval") {
      if (
        typeof value.approved !== "boolean" ||
        (value.always !== undefined && typeof value.always !== "boolean") ||
        (value.always && !value.approved)
      )
        return null
      return { status: value.approved ? "approved" : "denied" }
    }
    const answer = value.answer
    if (!answer || typeof answer !== "object" || Array.isArray(answer))
      return null
    if ((answer as { skipped?: unknown }).skipped === true)
      return { status: "answered", answer: { skipped: true } }
    const questions = askUserInput.safeParse(request.input)
    const answers = (answer as { answers?: unknown }).answers
    if (
      !questions.success ||
      !Array.isArray(answers) ||
      answers.length !== questions.data.questions.length
    )
      return null
    const normalized: { question: string; answers: string[] }[] = []
    for (const [index, question] of questions.data.questions.entries()) {
      const row = answers[index]
      if (
        !row ||
        row.question !== question.question ||
        !Array.isArray(row.answers) ||
        row.answers.some(
          (s: unknown) => typeof s !== "string" || s.length > 4000
        ) ||
        row.answers.length > (question.multiple ? 20 : 1) ||
        new Set(row.answers).size !== row.answers.length
      )
        return null
      normalized.push({ question: question.question, answers: row.answers })
    }
    return { status: "answered", answer: { answers: normalized } }
  }

  private expire() {
    for (const [id, entry] of this.pending)
      if (isExpired(entry.request.requestedAt, this.now()))
        this.finish(id, { status: "expired" })
    for (const [id, completed] of this.completed)
      if (this.now() - completed.at >= LIFETIME) this.completed.delete(id)
  }

  private finish(id: string, decision: InteractionDecision) {
    const entry = this.pending.get(id)
    if (!entry) return
    this.pending.delete(id)
    this.completed.set(id, { status: decision.status, at: this.now() })
    entry.cleanup()
    entry.resolve(decision)
    try {
      // Wiederhergestellte Karte: nur Zustimmung/Antwort bleibt für den fortgesetzten Turn gespeichert, alles andere fällt weg.
      if (entry.request.restored && (decision.status === "approved" || decision.status === "answered")) {
        this.preDecided.push({ request: entry.request, decision })
        this.options.persist?.save(entry.request, decision)
      } else this.options.persist?.remove(id)
    } catch {
      console.error("Offene Freigabe konnte nicht aktualisiert werden.")
    }
    this.options.onChange?.(entry.request, decision)
  }
}
