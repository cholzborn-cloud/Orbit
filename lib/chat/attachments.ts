import type { LanguageModelMiddleware, ModelMessage } from "ai"

// Vom Nutzer angehängte Dateien landen zusätzlich hier in der Sandbox des Orbis.
export const UPLOADS_DIR = "/home/daytona/uploads"
// Gedächtnis des Orbis: wird beim Anlegen der Sandbox erzeugt, im 1:1-Chat gepflegt und in jedem Chat in den Prompt geladen.
export const MEMORY_PATH = "/home/daytona/MEMORY.md"
const MAX_TEXT = 20_000

// Dateiname kommt vom Client: nur Basisname, keine Pfadteile, begrenzte Länge.
export const safeName = (name: string | undefined, mediaType: string) => {
  const base = (name ?? "")
    .split(/[\\/]/)
    .pop()!
    .replace(/[^\w.\- ]/g, "_")
    .replace(/^\.+/, "")
    .slice(-100)
  return base || `anhang.${mediaType.split("/")[1]?.split(/[+;]/)[0] || "bin"}`
}
export const uploadPath = (name: string | undefined, mediaType: string) =>
  `${UPLOADS_DIR}/${safeName(name, mediaType)}`

const fromDataUrl = (s: string) =>
  Buffer.from(s.slice(s.indexOf(",") + 1), "base64")

// Datei-Inhalt aus allen Formen, die AI SDK und Provider-Prompt verwenden.
export function fileBytes(data: unknown): Buffer | undefined {
  if (data instanceof Uint8Array) return Buffer.from(data)
  if (data instanceof ArrayBuffer) return Buffer.from(data)
  if (data instanceof URL)
    return data.protocol === "data:" ? fromDataUrl(data.href) : undefined
  if (typeof data === "string")
    return data.startsWith("data:")
      ? fromDataUrl(data)
      : /^https?:/.test(data)
        ? undefined
        : Buffer.from(data, "base64")
  if (data && typeof data === "object" && "type" in data) {
    const d = data as {
      type: string
      data?: unknown
      url?: unknown
      text?: string
    }
    if (d.type === "data") return fileBytes(d.data)
    if (d.type === "url") return fileBytes(d.url)
    if (d.type === "text") return Buffer.from(d.text ?? "", "utf8")
  }
  return undefined
}

const TEXT_TYPES =
  /^text\/|json|xml|javascript|typescript|yaml|toml|csv|x-sh|x-python|sql|markdown/
const TEXT_EXT =
  /\.(txt|md|csv|tsv|json|ya?ml|toml|xml|html?|css|js|jsx|ts|tsx|py|rb|go|rs|java|c|cpp|h|cs|php|sh|sql|log|ini|env)$/i

// Neueste Nutzer-Nachricht: Dateien zum Hochladen in die Sandbox.
export function latestUserFiles(messages: ModelMessage[]) {
  const last = messages.findLast((m) => m.role === "user")
  if (!last || typeof last.content === "string") return []
  return last.content.flatMap((p) => {
    if (p.type !== "file" && p.type !== "image") return []
    const mediaType = p.mediaType ?? "image/png"
    const bytes = fileBytes(p.type === "file" ? p.data : p.image)
    return bytes
      ? [
          {
            path: uploadPath(
              p.type === "file" ? p.filename : undefined,
              mediaType
            ),
            bytes,
          },
        ]
      : []
  })
}

// Bilder bleiben als Datei erhalten. Alles andere wird zu Text:
// lesbare Textdateien mit Inhalt, sonst ein Hinweis auf die Kopie in der Sandbox.
export const attachmentsAsText: LanguageModelMiddleware = {
  specificationVersion: "v4",
  transformParams: async ({ params }) => ({
    ...params,
    prompt: params.prompt.map((msg) => {
      if (msg.role !== "user") return msg
      return {
        ...msg,
        content: msg.content.flatMap((part) => {
          if (part.type !== "file") return [part]
          const where = `${uploadPath(part.filename, part.mediaType)} in your sandbox`
          const label = `[Attached file "${part.filename ?? safeName(undefined, part.mediaType)}" (${part.mediaType}), also saved at ${where}]`
          if (part.mediaType.startsWith("image/"))
            return [{ type: "text" as const, text: label }, part]
          const bytes =
            TEXT_TYPES.test(part.mediaType) ||
            TEXT_EXT.test(part.filename ?? "")
              ? fileBytes(part.data)
              : undefined
          if (!bytes) return [{ type: "text" as const, text: label }]
          const text = bytes.toString("utf8")
          const body =
            text.length > MAX_TEXT
              ? `${text.slice(0, MAX_TEXT)}\n…(truncated, full file in sandbox)`
              : text
          return [
            {
              type: "text" as const,
              text: `${label}\n\`\`\`\n${body}\n\`\`\``,
            },
          ]
        }),
      }
    }),
  }),
}
