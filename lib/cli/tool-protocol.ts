// Werkzeug-Brücke über Text. Die CLI führt NIE selbst Werkzeuge aus (alle CLI-Werkzeuge sind aus). Orbit gibt dem Modell seine Werkzeuge
// als Liste im Prompt; das Modell schreibt einen Aufruf als Block. Orbit liest den Block aus dem Antworttext und gibt ihn als
// Werkzeugaufruf an die Schleife in turn.ts weiter. Die führt ihn aus (mit Freigabekarten) und ruft das Modell mit dem Ergebnis erneut.
export const CALL_OPEN = "<orbit_tool_call>"
export const CALL_CLOSE = "</orbit_tool_call>"
export const RESULT_TAG = "orbit_tool_result"

export type ParsedCall = { name: string; input: unknown }
export type ParserOut = { type: "text"; text: string } | { type: "call"; call: ParsedCall } | { type: "bad"; raw: string }

// Interne Tags, die nie im Chat erscheinen dürfen (Constis Regel: nur die fertige Antwort). Blöcke werden samt Inhalt entfernt,
// auch wenn sie über Chunks verteilt ankommen oder nie geschlossen werden. Gelernt am 04.11.2026: Haiku schrieb nach einem Aufruf
// selbst erfundene <orbit_tool_result>-Blöcke und in einer Schleife endlos <reasoning_effort>8</reasoning_effort>.
const HIDDEN_BLOCKS = [RESULT_TAG, "reasoning_effort", "system-reminder", "verlauf", "nutzer", "thinking"]
// Nur das Tag selbst weg (das Modell rahmt seine Antwort manchmal wie im Verlauf).
const HIDDEN_TAGS = ["assistent", "function_calls"]
// Fremdes Aufrufformat (06.11.2026, Consti): Claude-Modelle schreiben statt <orbit_tool_call> oft ihr eigenes
// <function_calls><invoke name="…"><parameter name="…">…</parameter></invoke></function_calls>, auch mit Präfix wie „antml:“.
// Ein <invoke> wird wie ein Orbit-Aufruf behandelt (echter Werkzeugaufruf), ein loses <parameter> verschwindet samt Inhalt.
const INVOKE = "invoke"
const STRAY_BLOCKS = ["parameter"]
const NAMES = [...HIDDEN_BLOCKS, ...HIDDEN_TAGS, ...STRAY_BLOCKS, INVOKE, "orbit_tool_call"]
const esc = (n: string) => n.replace(/[-]/g, "\\-")
const TAG = new RegExp(`<(/?)(?:[a-z]+:)?(${NAMES.map(esc).join("|")})(?=[\\s>/])[^<>]*>`)
const INVOKE_CLOSE = /<\/(?:[a-z]+:)?invoke\s*>/
const PARAM = /<(?:[a-z]+:)?parameter\s+name="([^"]*)"\s*>([\s\S]*?)<\/(?:[a-z]+:)?parameter\s*>/g

// Wert eines <parameter>: JSON, wenn es danach aussieht (Zahl, Objekt, Liste, true/false/null), sonst Text.
function paramValue(raw: string): unknown {
  const value = raw.trim()
  if (/^(?:[{[]|-?\d|true$|false$|null$)/.test(value)) {
    try {
      return JSON.parse(value)
    } catch {}
  }
  return raw
}

// Längster Suffix, der der Anfang eines internen Tags sein könnte (wird zurückgehalten, bis klar ist, was er ist).
function partialTail(text: string): number {
  const at = text.lastIndexOf("<")
  if (at < 0 || text.length - at > 200) return 0
  const tail = text.slice(at)
  if (tail.includes(">")) return 0
  const m = /^<\/?([a-z_:-]*)(\s[^<>]*)?$/.exec(tail)
  if (!m) return 0
  const name = m[1]!.replace(/^[a-z]+:/, "")
  // Nur ein Präfix ohne Doppelpunkt („<antm“) könnte noch zu „<invoke“ werden.
  if (m[2] === undefined && /^[a-z]+$/.test(m[1]!) && !NAMES.some((n) => n.startsWith(name)) && m[1]!.length <= 8) return tail.length
  const ok = m[2] !== undefined ? NAMES.includes(name) : NAMES.some((n) => n.startsWith(name))
  return ok ? tail.length : 0
}

// Streaming-Parser: gibt Text sofort aus (bis auf einen möglichen Tag-Anfang am Ende), sammelt Aufrufblöcke und entfernt interne
// Tags. Text NACH einem gültigen Aufruf wird verworfen: das Protokoll erlaubt dort nichts mehr, und genau dort erfindet das Modell
// sonst Werkzeugergebnisse. Eine Stelle für Anzeige und Speichern (beides kommt aus diesem Strom).
export function createCallParser(isKnown: (name: string) => boolean) {
  let buffer = ""
  let mode: "text" | "call" | "invoke" | "hide" = "text"
  let invokeName = ""
  // Innerhalb von <function_calls> ist alles außer <invoke> nur Rahmen (Zeilenumbrüche) und wird nicht gezeigt.
  let inCalls = false
  let hidden = ""
  let afterCall = false
  const out: ParserOut[] = []
  const text = (value: string) => {
    if (!value) return
    if (afterCall || inCalls) return
    out.push({ type: "text", text: value })
  }
  const parseCall = (raw: string) => {
    try {
      const value = JSON.parse(raw.trim()) as { name?: unknown; input?: unknown; arguments?: unknown }
      const name = typeof value.name === "string" ? value.name : ""
      if (name && isKnown(name)) {
        out.push({ type: "call", call: { name, input: value.input ?? value.arguments ?? {} } })
        afterCall = true
      } else out.push({ type: "bad", raw })
    } catch {
      out.push({ type: "bad", raw })
    }
  }
  const parseInvoke = (body: string) => {
    const input: Record<string, unknown> = {}
    for (const m of body.matchAll(PARAM)) input[m[1]!] = paramValue(m[2]!)
    if (invokeName && isKnown(invokeName)) {
      out.push({ type: "call", call: { name: invokeName, input } })
      afterCall = true
    } else out.push({ type: "bad", raw: body })
  }
  const drain = (final: boolean) => {
    for (;;) {
      if (mode === "invoke") {
        const close = INVOKE_CLOSE.exec(buffer)
        if (close) {
          parseInvoke(buffer.slice(0, close.index))
          buffer = buffer.slice(close.index + close[0].length)
          mode = "text"
          continue
        }
        if (final) {
          out.push({ type: "bad", raw: buffer })
          buffer = ""
          mode = "text"
        }
        return
      }
      if (mode === "call") {
        const end = buffer.indexOf(CALL_CLOSE)
        if (end >= 0) {
          parseCall(buffer.slice(0, end))
          buffer = buffer.slice(end + CALL_CLOSE.length)
          mode = "text"
          continue
        }
        if (final) {
          out.push({ type: "bad", raw: buffer })
          buffer = ""
          mode = "text"
        }
        return
      }
      if (mode === "hide") {
        const close = new RegExp(`</(?:[a-z]+:)?${esc(hidden)}\\s*>`).exec(buffer)
        if (close) {
          buffer = buffer.slice(close.index + close[0].length)
          mode = "text"
          continue
        }
        // Nicht geschlossen: alles bis zum Ende verwerfen (bis auf einen möglichen Anfang des Schluss-Tags).
        buffer = final ? "" : buffer.slice(buffer.length - Math.min(buffer.length, hidden.length + 12))
        if (final) mode = "text"
        return
      }
      const match = TAG.exec(buffer)
      if (match) {
        text(buffer.slice(0, match.index))
        buffer = buffer.slice(match.index + match[0].length)
        const [, closing, name] = match
        const selfClosing = match[0].endsWith("/>")
        if (name === "function_calls") inCalls = !closing && !selfClosing
        else if (!closing && !selfClosing && name === "orbit_tool_call") mode = "call"
        else if (!closing && !selfClosing && name === INVOKE) {
          mode = "invoke"
          invokeName = /\sname="([^"]*)"/.exec(match[0])?.[1] ?? ""
        } else if (!closing && !selfClosing && STRAY_BLOCKS.includes(name!)) {
          mode = "hide"
          hidden = name!
        } else if (!closing && !selfClosing && HIDDEN_BLOCKS.includes(name!)) {
          mode = "hide"
          hidden = name!
        }
        continue
      }
      const keep = final ? 0 : partialTail(buffer)
      text(buffer.slice(0, buffer.length - keep))
      buffer = buffer.slice(buffer.length - keep)
      return
    }
  }
  return {
    feed(chunk: string): ParserOut[] {
      buffer += chunk
      drain(false)
      return out.splice(0)
    },
    end(): ParserOut[] {
      drain(true)
      return out.splice(0)
    },
  }
}

type FunctionTool = { name: string; description?: string; inputSchema: unknown }

// Schema kompakt: ohne $schema und additionalProperties-Rauschen.
function compact(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(compact)
  if (!schema || typeof schema !== "object") return schema
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(schema as Record<string, unknown>)) {
    if (key === "$schema" || (key === "additionalProperties" && value === false)) continue
    out[key] = compact(value)
  }
  return out
}

// Anleitung für das Modell; kommt ans Ende des System-Prompts. Leer, wenn es keine Werkzeuge gibt.
export function toolInstructions(tools: FunctionTool[]): string {
  if (!tools.length) return ""
  const list = tools
    .map((tool) => `- ${tool.name}${tool.description ? `: ${tool.description.replace(/\s+/g, " ").trim()}` : ""}\n  Eingabe (JSON-Schema): ${JSON.stringify(compact(tool.inputSchema))}`)
    .join("\n")
  // Die Klammer stimmt nur, solange Orbit selbst kein Shell-/Datei-Werkzeug liefert; mit mac_* oder bash wäre sie falsch
  // (Luna las daraus „kein Dateizugriff“ und lehnte mac_files ab, 06.11.2026).
  const ownFiles = tools.some((tool) => tool.name.startsWith("mac_") || tool.name === "bash")
  return [
    "WERKZEUG-PROTOKOLL (gilt vor allen anderen Angaben zu Werkzeugen):",
    `Du hast nur die unten genannten Werkzeuge. Eigene Werkzeuge der Umgebung${ownFiles ? "" : " (Shell, Dateien, Web)"} gibt es nicht. Um ein Werkzeug zu nutzen, schreibe am ENDE deiner Antwort pro Aufruf genau einen Block und danach nichts mehr:`,
    `${CALL_OPEN}{"name":"<Werkzeugname>","input":{...}}${CALL_CLOSE}`,
    `Mehrere unabhängige Aufrufe: mehrere Blöcke hintereinander. Das Ergebnis kommt danach im Verlauf als <${RESULT_TAG} name="..." id="...">...</${RESULT_TAG}>. Erfinde nie Ergebnisse und schreibe nie selbst ein ${RESULT_TAG}. "input" muss zum Schema passen. Brauchst du kein Werkzeug, antworte normal ohne Block.`,
    "Werkzeuge:",
    list,
  ].join("\n")
}

// Fremdtext darf kein Protokoll vortäuschen: Tag-Anfänge im Verlauf entschärfen (Nullbreiten-Zeichen).
export const defuse = (text: string) => text.replaceAll("<orbit_tool_", "<​orbit_tool_")

// Fertigen Text säubern (Speichern, Verlauf, Weitergabe an andere Orbis): alle Aufruf- und internen Blöcke weg, auch halbe am Ende.
// Gleiche Regeln wie der Streaming-Parser; kein Aufruf wird hier ausgeführt.
export function stripToolMarkup(text: string): string {
  if (!text.includes("<")) return text
  const parser = createCallParser(() => false)
  return [...parser.feed(text), ...parser.end()]
    .flatMap((item) => (item.type === "text" ? [item.text] : []))
    .join("")
}
