import type { LanguageModelV4Middleware, LanguageModelV4StreamPart } from "@ai-sdk/provider"

import { ASK_USER, type AskUserInput } from "./ask-user.ts"

// Fragekarten-Pflicht (Consti, 06.11.2026): Fragen an Consti kommen immer als Karte (`ask_user`), nie als Frage im Fließtext.
// Durchgesetzt im Code, nicht über den Prompt: endet ein Modellschritt mit einer erkennbaren Frage an den Nutzer und ohne
// Werkzeugaufruf, hängt diese Middleware einen `ask_user`-Aufruf an (Frage plus aus dem Text gelesene Optionen, sonst Ja/Nein).
// Das SDK zeigt dann die normale Karte, wartet auf die Antwort und gibt sie dem Modell im nächsten Schritt zurück.
// Echte `ask_user`-Aufrufe werden nur geglättet: genau eine Empfehlung, und die steht vorn.

type Option = AskUserInput["questions"][number]["options"][number]
export type DetectedQuestion = { question: string; options: Option[] }

const RECOMMEND = /\s*[([]\s*(empfehlung|empfohlen|recommended)\s*[)\]]\s*/i
const MAX_LABEL = 40

// Was nie als Frage an Consti zählt: Codeblöcke, Inline-Code, Zitate (Zeilen mit >) und Text in Anführungszeichen.
export function visibleProse(text: string) {
  return text
    .replace(/```[\s\S]*?(```|$)/g, "\n")
    .replace(/`[^`\n]*`/g, " ")
    .split("\n")
    .filter((line) => !/^\s*>/.test(line))
    .join("\n")
    .replace(/[„"“«»][^„"“”«»\n]{0,200}[“”"«»]/g, " ")
}

// Fragewörter, die an den Nutzer gerichtet sind (du/Sie/you oder „soll ich“), statt rhetorischer Fragen über Dritte.
const ADDRESSED =
  /\b(du|dir|dich|dein\w*|ihr|euch|euer\w*|Sie|Ihnen|Ihr\w*|you|your|soll(en)? (ich|wir)|darf ich|kann ich|möchtest|willst|magst|hättest|würdest|passt|okay|ok|einverstanden|lieber|shall i|should i|do you|would you|want me)\b/i
const QUESTION_START =
  /^(soll|sollen|willst|wollt|möchtest|möchten|magst|darf|kann|könntest|hast|bist|gibt|passt|welche[rsnm]?|was|wie|wann|wo|wohin|wer|lieber|oder|shall|should|do|does|would|which|what|when|where|who|is|are|can|could|want)\b/i

function sentences(paragraph: string) {
  return paragraph.match(/[^.!?\n]+[.!?]*/g)?.map((s) => s.trim()).filter(Boolean) ?? []
}

const clean = (label: string) =>
  label
    .replace(/^\s*(?:[-*•]|\d+[.)]|[a-dA-D][.)])\s+/, "")
    .replace(/\*\*|__/g, "")
    .replace(/[.:;,!?]+$/, "")
    .trim()

const short = (label: string) => (label.length <= MAX_LABEL ? label : `${label.slice(0, MAX_LABEL - 1).trimEnd()}…`)

// Optionen aus einer Liste (2–4 Punkte) oder aus „A oder B?“; sonst Ja/Nein. Die Empfehlung steht vorn.
export function optionsFrom(prose: string, question: string): Option[] {
  const items = prose
    .split("\n")
    .filter((line) => /^\s*(?:[-*•]|\d+[.)]|[a-dA-D][.)])\s+\S/.test(line))
    .map((line) => ({ raw: line, label: clean(line) }))
    .filter((item) => item.label)
  let options: Option[] = []
  if (items.length >= 2 && items.length <= 4)
    options = items.map((item) => ({ label: short(clean(item.label.replace(RECOMMEND, " "))), ...(RECOMMEND.test(item.raw) && { recommended: true }) }))
  else {
    const body = question.replace(/\?+$/, "")
    const parts = body.split(/\s+(?:oder|or)\s+/i)
    if (parts.length === 2) {
      const tail = parts[1].trim()
      const head = (parts[0].split(/[,:]\s*|\s+(?:soll ich|lieber|eher|zuerst)\s+/i).at(-1)?.trim() ?? "").replace(/^(?:lieber|eher|zuerst|entweder|either|rather)\s+/i, "")
      const words = (s: string) => s.split(/\s+/).filter(Boolean).length
      if (head && tail && words(head) <= 6 && words(tail) <= 6) options = [{ label: short(clean(head)) }, { label: short(clean(tail)) }]
    }
  }
  if (options.length < 2) options = [{ label: "Ja" }, { label: "Nein" }]
  return withOneRecommendation(options)
}

export function withOneRecommendation(options: Option[]): Option[] {
  const stripped = options.map((o) => {
    const marked = RECOMMEND.test(o.label)
    const label = marked ? o.label.replace(RECOMMEND, " ").trim() : o.label
    return { ...o, label, recommended: !!o.recommended || marked }
  })
  const first = Math.max(0, stripped.findIndex((o) => o.recommended))
  const ordered = [stripped[first], ...stripped.filter((_, i) => i !== first)]
  return ordered.map((o, i) => (i === 0 ? { ...o, recommended: true } : { ...o, recommended: undefined })).map(({ recommended, ...rest }) =>
    recommended ? { ...rest, recommended } : rest
  )
}

// Endet der Text mit einer Frage an den Nutzer? Geprüft wird der letzte Absatz (Fragen an Consti stehen am Ende einer Antwort).
export function detectUserQuestion(text: string): DetectedQuestion | null {
  const prose = visibleProse(text).trim()
  if (!prose) return null
  const paragraphs = prose.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
  const last = paragraphs.at(-1) ?? ""
  // Eine Liste als letzter Absatz gehört zur Frage davor.
  const listOnly = last.split("\n").every((line) => /^\s*(?:[-*•]|\d+[.)]|[a-dA-D][.)])\s+\S/.test(line))
  const scope = listOnly && paragraphs.length > 1 ? `${paragraphs.at(-2)}\n${last}` : last
  const lines = scope.split("\n").filter((line) => !/^\s*(?:[-*•]|\d+[.)]|[a-dA-D][.)])\s+\S/.test(line))
  const candidates = lines.flatMap(sentences).filter((s) => /\?\s*$/.test(s))
  const question = candidates.reverse().find((s) => ADDRESSED.test(s) || QUESTION_START.test(s))
  if (!question) return null
  // Rhetorik am Satzanfang („Warum? Weil …“) zählt nicht, wenn danach noch Text folgt.
  const after = scope.slice(scope.lastIndexOf(question) + question.length).trim()
  if (after && !/^(?:[-*•]|\d+[.)]|[a-dA-D][.)])\s/m.test(after) && !/\?\s*$/.test(after)) return null
  const q = question.replace(/\s+/g, " ").trim()
  return { question: q, options: optionsFrom(scope, q) }
}

export function normalizeAskInput(input: unknown): unknown {
  const value = input as AskUserInput | undefined
  if (!value || !Array.isArray(value.questions)) return input
  return {
    ...value,
    questions: value.questions.map((q) => (Array.isArray(q?.options) && q.options.length ? { ...q, options: withOneRecommendation(q.options) } : q)),
  }
}

// Höchstens so viele erzwungene Karten je Turn: schützt vor Schleifen, wenn das Modell nach der Antwort weiter im Text fragt.
const MAX_FORCED_PER_TURN = 2

export function createQuestionCardGate({ enabled }: { enabled: boolean }): LanguageModelV4Middleware {
  let forced = 0
  let n = 0
  return {
    specificationVersion: "v4",
    async wrapStream({ doStream, params }) {
      const result = await doStream()
      const hasAsk = enabled && (params.tools ?? []).some((t) => "name" in t && t.name === ASK_USER)
      if (!hasAsk) return result
      let text = ""
      let calls = 0
      const stream = result.stream.pipeThrough(
        new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
          transform(part, controller) {
            if (part.type === "text-delta") text += part.delta
            if (part.type === "tool-call") {
              calls++
              if (part.toolName === ASK_USER)
                try {
                  controller.enqueue({ ...part, input: JSON.stringify(normalizeAskInput(JSON.parse(part.input))) })
                  return
                } catch {
                  /* kaputte Eingabe: unverändert, das SDK meldet den Fehler */
                }
            }
            if (part.type === "finish" && part.finishReason.unified === "stop" && calls === 0 && forced < MAX_FORCED_PER_TURN && !params.abortSignal?.aborted) {
              const found = detectUserQuestion(text)
              if (found) {
                forced++
                const input: AskUserInput = { questions: [{ question: found.question, options: found.options }] }
                controller.enqueue({ type: "tool-call", toolCallId: `fragekarte-${Date.now().toString(36)}-${n++}`, toolName: ASK_USER, input: JSON.stringify(input) })
                controller.enqueue({ ...part, finishReason: { ...part.finishReason, unified: "tool-calls" } })
                return
              }
            }
            controller.enqueue(part)
          },
        })
      )
      return { ...result, stream }
    },
  }
}
