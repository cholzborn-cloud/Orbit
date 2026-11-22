import type { ModelMessage } from "ai"

// Alte Tool-Ergebnisse (mehr als `keepTurns` Nutzer-Nachrichten zurück) kosten nur Kontext.
// Nur der Modellkontext wird gekürzt: der gespeicherte Verlauf und die Anzeige bleiben unverändert.
// Das Modell kann ein gekürztes Ergebnis über `chat_recall` (id = Aufruf-ID) zurückholen.
export const KEEP_RESULT_TURNS = 2
// Gekürzt wird in Blöcken: die Grenze rückt nur alle SHORTEN_BLOCK Turns vor. Würde sie jeden Turn wandern, änderte sich
// der Verlauf mitten im Cache-Präfix bei jeder Nachricht und der Cache träfe nie.
export const SHORTEN_BLOCK = 3
// Alte Tool-Eingaben (z. B. create_file mit ganzem Text): Felder über dieser Länge behalten nur den Anfang.
export const OLD_INPUT_FIELD_CHARS = 1_500
const INPUT_HEAD = 300

function sizeOf(output: unknown) {
  try {
    const value = (output as { value?: unknown } | null)?.value
    if (typeof value === "string") return value.length
    if (value !== undefined) return JSON.stringify(value).length
    return typeof output === "string" ? output.length : JSON.stringify(output ?? "").length
  } catch {
    return 0
  }
}

function shortenInput(input: unknown): unknown {
  if (typeof input === "string")
    return input.length > OLD_INPUT_FIELD_CHARS
      ? `${input.slice(0, INPUT_HEAD)}…[${input.length - INPUT_HEAD} characters omitted]`
      : input
  if (Array.isArray(input)) return input.map(shortenInput)
  if (input && typeof input === "object")
    return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, shortenInput(value)]))
  return input
}

// Nachrichten, hinter denen höchstens `cutoff` Nutzer-Nachrichten standen, werden gekürzt. Mindestens `keepTurns` Turns
// bleiben voll, höchstens keepTurns + block - 1.
export function shortenCutoff(users: number, keepTurns = KEEP_RESULT_TURNS, block = SHORTEN_BLOCK) {
  return Math.floor(Math.max(0, users - keepTurns - 1) / block) * block
}

export function condenseOldToolResults(
  messages: ModelMessage[],
  keepTurns = KEEP_RESULT_TURNS,
  block = SHORTEN_BLOCK
): ModelMessage[] {
  const cutoff = shortenCutoff(messages.filter((m) => m.role === "user").length, keepTurns, block)
  let seen = 0
  const out: ModelMessage[] = []
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i]!
    if (message.role === "user") seen++
    const old = seen <= cutoff
    if (message.role === "tool" && old) {
      out.push({
        ...message,
        content: message.content.map((part) => {
          if (part.type !== "tool-result") return part
          const size = sizeOf(part.output)
          const replacement = `[${part.toolName}: older result shortened, ${size} characters; id ${part.toolCallId}]`
          return !["text", "error-text", "json", "error-json"].includes(part.output.type) || size > replacement.length
            ? {
                ...part,
                output: {
                  type: "text" as const,
                  value: replacement,
                },
              }
            : part
        }),
      } as ModelMessage)
    } else if (message.role === "assistant" && old && Array.isArray(message.content)) {
      out.push({
        ...message,
        content: message.content.map((part) =>
          part.type === "tool-call" ? { ...part, input: shortenInput(part.input) } : part
        ),
      } as ModelMessage)
    } else out.push(message)
  }
  return out
}
