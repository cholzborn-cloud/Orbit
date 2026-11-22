// Ankündigungen vor Werkzeugaufrufen („Ich prüfe das Wetter …“) entscheidet der Code, nicht der Prompt.
// Das Modell schreibt sie wie bisher; lib/cli/model.ts markiert sie (providerMetadata.orbit.narration). Dieses Tor sitzt zwischen
// Modellstrom und Chat und lässt sie nur durch, wenn sie dem Nutzer wirklich etwas bringen:
//  - Läuft der Auftrag schon länger als `minAgeMs`, erscheint sie sofort (so wartet man nicht stumm).
//  - Ist der Auftrag noch jung, wird sie samt den folgenden Werkzeugteilen zurückgehalten: ist das Werkzeug vor Ablauf fertig,
//    entfällt sie (kurze Fragen bekommen nur die Antwort); läuft es noch, erscheint sie zum Zeitpunkt `minAgeMs`.
//  - Höchstens `maxCount` pro Auftrag, mit Abstand `minGapMs`, und nie eine Wiederholung („… noch einmal“) der letzten.
// Alles andere (Antworttext, Rückfragen, Freigaben, Fehler) läuft unverändert und sofort durch.

export type GateChunk = { type: string; id?: string; delta?: string; toolCallId?: string; toolName?: string; providerMetadata?: Record<string, any> }

export type NarrationGateOptions = {
  startedAt: number
  emit: (chunk: GateChunk) => void
  now?: () => number
  // Liefert eine Funktion zum Abbrechen des Zeitgebers.
  setTimer?: (callback: () => void, milliseconds: number) => () => void
  minAgeMs?: number
  maxCount?: number
  minGapMs?: number
}

const OUTPUT_TYPES = new Set(["tool-output-available", "tool-output-error", "tool-output-denied"])
const WORDS = (text: string) => new Set(text.toLowerCase().replace(/[^a-zäöüß0-9\s]/g, " ").split(/\s+/).filter((word) => word.length >= 3))

export function similarNarration(a: string, b: string): boolean {
  const first = WORDS(a)
  const second = WORDS(b)
  if (!first.size || !second.size) return false
  let shared = 0
  for (const word of first) if (second.has(word)) shared++
  return shared / (first.size + second.size - shared) >= 0.6
}
const REPEAT = /\b(?:noch\s?einmal|nochmal|erneut|wieder)\b/i

export function createNarrationGate(options: NarrationGateOptions) {
  const now = options.now ?? Date.now
  const setTimer = options.setTimer ?? ((callback, ms) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer) })
  const minAge = options.minAgeMs ?? 8_000
  const maxCount = options.maxCount ?? 2
  const minGap = options.minGapMs ?? 15_000

  let published = 0
  let lastAt = 0
  let lastText = ""

  // collecting: Text der Ankündigung kommt noch; holding: Text ist komplett, wartet auf Werkzeugende oder Zeit.
  let mode: "pass" | "collecting" | "holding" = "pass"
  let narrationId = ""
  let narrationText = ""
  let queue: GateChunk[] = []
  let openCalls = new Set<string>()
  let sawCall = false
  let cancelTimer: (() => void) | undefined

  const publish = (chunks: GateChunk[], text: string) => {
    published++
    lastAt = now()
    lastText = text
    for (const chunk of chunks) options.emit(chunk)
  }

  // Ankündigung entfällt: nur die Teile danach weitergeben.
  const dropNarration = () => {
    const rest = queue.filter((chunk) => !isNarrationChunk(chunk))
    reset()
    for (const chunk of rest) options.emit(chunk)
  }
  const isNarrationChunk = (chunk: GateChunk) => !!narrationId && chunk.id === narrationId && chunk.type.startsWith("text-")
  const release = () => {
    const all = queue
    const text = narrationText
    reset()
    publish(all, text)
  }
  function reset() {
    cancelTimer?.()
    cancelTimer = undefined
    mode = "pass"
    narrationId = ""
    narrationText = ""
    queue = []
    openCalls = new Set()
    sawCall = false
  }

  const allowed = (text: string) => {
    if (!text.trim()) return false
    // „Fertig.“ vor dem Werkzeug wäre eine falsche Zusage (nach einem Stopp stand sie als Antwort im Chat).
    if (/^\W*(?:fertig|erledigt|ok(?:ay)?|gut|alles klar|geschafft)\b/i.test(text)) return false
    if (published >= maxCount) return false
    if (published > 0 && (now() - lastAt < minGap || similarNarration(lastText, text) || REPEAT.test(text))) return false
    return true
  }

  return {
    // Eine Zwischennachricht über das Werkzeug `say` zählt mit, damit beides zusammen das Budget nicht sprengt.
    countSay() {
      published++
      lastAt = now()
    },
    push(chunk: GateChunk) {
      if (mode === "pass") {
        if (chunk.type === "text-start" && chunk.providerMetadata?.orbit?.narration === true && chunk.id !== undefined) {
          mode = "collecting"
          narrationId = chunk.id
          narrationText = ""
          queue = [chunk]
          return
        }
        options.emit(chunk)
        return
      }
      if (mode === "collecting") {
        queue.push(chunk)
        if (chunk.type === "text-delta" && chunk.id === narrationId) narrationText += chunk.delta ?? ""
        if (chunk.type === "text-end" && chunk.id === narrationId) {
          const age = now() - options.startedAt
          if (!allowed(narrationText)) {
            // Der Text-Teil ist komplett, die Teile danach gibt es noch nicht: nur den Text verwerfen.
            reset()
            return
          }
          if (age >= minAge) {
            const all = queue
            const text = narrationText
            reset()
            publish(all, text)
            return
          }
          mode = "holding"
          cancelTimer = setTimer(() => { if (mode === "holding") release() }, Math.max(0, options.startedAt + minAge - now()))
        }
        return
      }
      // holding: alles Weitere wartet in Reihenfolge.
      queue.push(chunk)
      if (chunk.type === "tool-input-start" || chunk.type === "tool-input-available") {
        if (chunk.toolName === "say" && chunk.type === "tool-input-available") { dropNarration(); this.countSay(); return }
        if (chunk.toolCallId) { openCalls.add(chunk.toolCallId); sawCall = true }
        // Fragekarte: der Nutzer muss jetzt antworten, der Satz davor gehört dazu.
        if (chunk.toolName === "ask_user") release()
        return
      }
      if (chunk.type === "tool-approval-request" || chunk.type === "error" || chunk.type === "abort") { release(); return }
      if (OUTPUT_TYPES.has(chunk.type) && chunk.toolCallId) {
        openCalls.delete(chunk.toolCallId)
        // Alle Werkzeuge vor der Zeit fertig: keine Ankündigung nötig.
        if (sawCall && openCalls.size === 0) dropNarration()
        return
      }
      // Schritt oder Antwort ist zu Ende, ohne dass je ein Werkzeug lief (oder es ist unklar): Ankündigung verwerfen, nichts hängt.
      if (chunk.type === "finish") dropNarration()
    },
    // Strom zu Ende (auch nach Fehler): nichts bleibt hängen.
    end() {
      if (mode === "pass") return
      const rest = mode === "holding" ? queue.filter((chunk) => !isNarrationChunk(chunk)) : []
      reset()
      for (const chunk of rest) options.emit(chunk)
    },
  }
}
