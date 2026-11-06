import { createHash } from "node:crypto"
import type { Tool, ToolSet } from "ai"

// Deckel für Tool-Ausgaben im Modellkontext (Phase 4, Lauf G). Ab TOOL_OUTPUT_CAP Zeichen sieht das Modell Kopf + Hinweis
// mit ID; der volle Text liegt in SQLite (`tool_outputs`) und kommt per `chat_recall(id, offset)` stückweise zurück.
// Die Anzeige in der App und der gespeicherte Verlauf bleiben unverändert (nur `toModelOutput`).
export const TOOL_OUTPUT_CAP = 10_000
export const TOOL_OUTPUT_HEAD = 8_000
export const RECALL_PAGE = 8_000

export type StoredOutput = { id: string; tool: string; chars: number; body: string }

// Stabile ID aus dem Inhalt: dieselbe Ausgabe ergibt bei jeder Verlaufs-Umwandlung dieselbe ID (Insert-or-ignore genügt).
export const outputId = (text: string) =>
  `out_${createHash("sha1").update(text).digest("hex").slice(0, 12)}`

export function capText(
  tool: string,
  text: string,
  save: (row: StoredOutput) => void,
  cap = TOOL_OUTPUT_CAP,
  head = TOOL_OUTPUT_HEAD
): string {
  if (text.length <= cap) return text
  // Ein Fremddaten-Rahmen behält seinen Schlusstag: nur der Inhalt dazwischen wird gekürzt.
  const framed = /^(<untrusted_data_[^>\n]*>\n[^\n]*\n)([\s\S]*)(\n<\/untrusted_data_[^>\n]*>)$/.exec(text)
  const inner = framed ? framed[2]! : text
  if (inner.length <= cap) return text
  const id = outputId(inner)
  try {
    save({ id, tool, chars: inner.length, body: inner })
  } catch {
    /* ohne Ablage nur kürzen */
  }
  const note = `\n[shortened: ${inner.length} characters in total, first ${head} shown. Rest: chat_recall id="${id}" offset=${head}]`
  const cut = inner.slice(0, head) + note
  return framed ? framed[1]! + cut + framed[3]! : cut
}

type ModelOutput = { type: string; value?: unknown }

export function capToolOutputs(tools: ToolSet, save: (row: StoredOutput) => void, cap = TOOL_OUTPUT_CAP): ToolSet {
  return Object.fromEntries(
    Object.entries(tools).map(([name, original]) => {
      const base = (original as Tool).toModelOutput as ((o: unknown) => unknown) | undefined
      const wrapped = {
        ...original,
        toModelOutput: async (options: { output: unknown }) => {
          const out = (
            base
              ? await base(options)
              : typeof options.output === "string"
                ? { type: "text", value: options.output }
                : { type: "json", value: options.output }
          ) as ModelOutput
          if ((out.type === "text" || out.type === "error-text") && typeof out.value === "string")
            return { type: "text", value: capText(name, out.value, save, cap) }
          if (out.type === "json") {
            const text = JSON.stringify(out.value) ?? ""
            return text.length > cap ? { type: "text", value: capText(name, text, save, cap) } : out
          }
          return out
        },
      } as Tool
      return [name, wrapped]
    })
  )
}
