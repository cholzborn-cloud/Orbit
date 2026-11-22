import type { Tool, ToolSet } from "ai"

import { frameUntrusted } from "./orbi-message.ts"

// Werkzeuge, deren Ergebnis fremder Inhalt sein kann (Web, Dateien, Shell-Ausgaben, Konnektoren wie Mail,
// Bildschirm, Brain-Notizen und Gedächtnis: dort kann früher Eingeschleustes stehen).
const UNTRUSTED = new Set([
  "web_search",
  "read_file",
  "bash",
  "view_screen",
  "show_screen",
  "brain_search",
  "brain_read",
  "memory_get",
  "apple_calendar_list",
  "apple_reminders_list",
  "read_skill",
  "chat_recall",
  // Lokal am Mac: Shell, Dateien, Skripte, Bildschirm, Browser, Mail-nahe Apps liefern fremden Inhalt.
  "mac_shell",
  "mac_files",
  "mac_applescript",
  "mac_shortcut",
  "mac_screen",
  "mac_clipboard",
  "mac_calendar",
  "mac_reminders",
  "mac_contacts",
  "mac_notes",
  "mac_browser",
])
// Eigene Notizen und Skills: Ergebnis wird gerahmt, zählt aber nicht als frisch gelesene Fremddaten (sonst ließe sich
// nach dem Lesen nichts mehr verbessern). Frisches aus Web, Mail, Dateien, Brain und Shell sperrt weiter.
const FRAME_ONLY = new Set(["memory_get", "read_skill"])
export const isUntrustedTool = (name: string) =>
  UNTRUSTED.has(name) || name.startsWith("connector_")

type ModelOutput = { type: string; value?: unknown }

// Das Modell sieht das Ergebnis dieser Werkzeuge in einem `untrusted_data`-Rahmen mit zufälligem Token.
// Die Anzeige in der App bleibt unverändert (nur `toModelOutput`). Bilder und Fehler bleiben unberührt.
// Hat in diesem Turn ein Fremddaten-Werkzeug gelaufen, speichert memory_save nur noch, was Consti selbst sagte (from=consti),
// und save_skill gar nicht: so landet Eingeschleustes nicht unbemerkt als Merksatz, Regel oder Skill.
export const MEMORY_SOURCE_ERROR =
  "Not saved: outside data was read in this turn. Save only what Consti said himself (from=consti), or save it in a later turn."
export const SKILL_SOURCE_ERROR =
  "Skill not saved: outside data was read in this turn. Create or change skills in a turn without web, mail or file content."

export function frameUntrustedResults(tools: ToolSet): ToolSet {
  let tainted = false
  return Object.fromEntries(
    Object.entries(tools).map(([name, original]) => {
      if (name === "memory_save" || name === "save_skill") {
        const run = (original as Tool).execute
        if (!run) return [name, original]
        return [
          name,
          {
            ...original,
            execute: (input: { from?: unknown }, options: never) =>
              tainted && (name === "save_skill" || input?.from !== "consti")
                ? { ok: false, error: name === "save_skill" ? SKILL_SOURCE_ERROR : MEMORY_SOURCE_ERROR }
                : (run as (i: unknown, o: unknown) => unknown)(input, options),
          } as Tool,
        ]
      }
      if (!isUntrustedTool(name)) return [name, original]
      const run = (original as Tool).execute
      const wrapped = {
        ...original,
        ...(run && {
          execute: (input: unknown, options: unknown) => {
            if (!FRAME_ONLY.has(name)) tainted = true
            return (run as (i: unknown, o: unknown) => unknown)(input, options)
          },
        }),
        toModelOutput: async (options: { output: unknown }) => {
          const base = (original as Tool).toModelOutput
          const out = (
            base
              ? await (base as (o: unknown) => unknown)(options)
              : typeof options.output === "string"
                ? { type: "text", value: options.output }
                : { type: "json", value: options.output }
          ) as ModelOutput
          if (out.type === "text" || out.type === "error-text")
            return { type: "text", value: frameUntrusted(name, String(out.value)) }
          if (out.type === "json")
            return {
              type: "text",
              value: frameUntrusted(name, JSON.stringify(out.value) ?? ""),
            }
          if (out.type === "content" && Array.isArray(out.value))
            return {
              ...out,
              value: out.value.map((item: { type: string; text?: string }) =>
                item.type === "text" && typeof item.text === "string"
                  ? { ...item, text: frameUntrusted(name, item.text) }
                  : item
              ),
            }
          return out
        },
      }
      return [name, wrapped as Tool]
    })
  )
}
