import type { ToolSet } from "ai"

import { mediaTypeOf } from "../files/media-type.ts"
import { autoOutputPath } from "./sandbox-write.ts"

// Dateien und Notizen, die ein Orbi anlegt, stehen immer als Karte im Chat (wie ein share_file-Teil, das die App schon kennt).
// Ausnahme Coding: keine Karte für Code-Dateien oder Dateien in Repo-/Paketordnern; dort nur ausdrückliches share_file.
const CODE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "swift", "py", "rb", "go", "rs", "java", "kt", "c", "h", "cpp", "hpp", "cs", "php",
  "sh", "zsh", "bash", "json", "yml", "yaml", "toml", "lock", "sql", "css", "scss", "vue", "svelte", "gradle", "plist", "xcconfig",
])
const CODE_DIRS = /(^|\/)(\.git|node_modules|\.build|build|dist|src)(\/|$)/

export const isCodeFile = (path: string) => {
  const name = path.split("/").pop() ?? ""
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : ""
  return CODE_EXT.has(ext) || CODE_DIRS.test(path) || /^(Makefile|Dockerfile)$/.test(name)
}

export type FileCard = {
  path: string
  filename: string
  mediaType: string
  size: number
  data: string // Base64
}

type Executable = { execute?: (input: never, options: never) => unknown }

// Umhüllt die dateischreibenden Werkzeuge: nach Erfolg meldet `emit` die Karte, genau eine je Datei und Turn.
// `read` liest eine Sandbox-Datei (wie share_file) und gibt null zurück, wenn sie fehlt oder zu groß ist.
export function withFileCards(
  tools: ToolSet,
  options: {
    emit: (card: FileCard) => void
    read: (path: string) => Promise<FileCard | null>
  }
): ToolSet {
  const done = new Set<string>()
  const wrapped: ToolSet = { ...tools }
  const once = async (key: string, make: () => Promise<FileCard | null> | FileCard | null) => {
    if (done.has(key)) return
    done.add(key)
    try {
      const card = await make()
      if (card) options.emit(card)
    } catch {
      /* Eine fehlende Karte darf den Turn nie stoppen. */
    }
  }
  for (const name of ["create_file", "write_file", "brain_write"] as const) {
    const original = tools[name] as (typeof tools)[string] & Executable | undefined
    const execute = original?.execute
    if (!original || !execute) continue
    wrapped[name] = {
      ...original,
      execute: async (input: never, extra: never) => {
        const output = await (execute as (i: never, o: never) => unknown)(input, extra)
        const args = input as { path?: unknown; content?: unknown; mode?: unknown }
        const path = typeof args.path === "string" ? args.path : ""
        if (name === "brain_write") {
          // Erfolg erkennt man am Brain-Rahmen; angehängte Texte sind nur Ausschnitte und bekommen keine Karte.
          if (args.mode === "create" && typeof args.content === "string" && typeof output === "string" && output.startsWith("<brain_result>")) {
            const content = args.content
            await once(`brain:${path}`, () => ({
              path,
              filename: path.split("/").pop() || "Notiz.md",
              mediaType: "text/markdown",
              size: Buffer.byteLength(content),
              data: Buffer.from(content, "utf8").toString("base64"),
            }))
          }
        } else if (autoOutputPath(path) && !isCodeFile(path)) {
          await once(`sandbox:${path}`, () => options.read(path))
        }
        return output
      },
    } as never
  }
  return wrapped
}

export const cardFromShare = (path: string, output: { filename: string; mediaType: string; size: number; data: string }): FileCard => ({
  path,
  ...output,
  mediaType: output.mediaType || mediaTypeOf(output.filename),
})
