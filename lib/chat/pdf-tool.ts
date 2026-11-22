import {
  spawn,
  type ChildProcess,
  type SpawnOptionsWithoutStdio,
} from "node:child_process"
import { tool } from "ai"
import { z } from "zod"

const MAX_INPUT = 256 * 1024
const MAX_OUTPUT = 5 * 1024 * 1024
const inputSchema = z.object({
  filename: z
    .string()
    .max(120)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} _.-]*\.pdf$/u)
    .refine((name) => !name.includes(".."), "Ungültiger Dateiname"),
  text: z
    .string()
    .min(1)
    .max(MAX_INPUT)
    .refine(
      (text) => Buffer.byteLength(text, "utf8") <= MAX_INPUT,
      "Text zu groß"
    )
    .refine((text) => !text.includes("\0"), "Ungültiger Text"),
})

const wordInputSchema = inputSchema.extend({
  filename: z
    .string()
    .max(120)
    .regex(/^[\p{L}\p{N}][\p{L}\p{N} _.-]*\.docx$/u)
    .refine((name) => !name.includes(".."), "Ungültiger Dateiname"),
})

class DocumentError extends Error {}

type PdfInput = z.infer<typeof inputSchema>
type DocumentResult<MediaType extends string> =
  | { error: string }
  | {
      filename: string
      mediaType: MediaType
      size: number
      data: string
    }

type StartProcess = (
  command: string,
  args: string[],
  options: SpawnOptionsWithoutStdio
) => ChildProcess

async function renderDocument<MediaType extends string>(
  input: PdfInput,
  format: {
    label: string
    mediaType: MediaType
    schema: typeof inputSchema
    command: string
    args: string[]
    valid: (data: Buffer) => boolean
  },
  options: { signal?: AbortSignal } = {},
  startProcess: StartProcess = spawn
): Promise<DocumentResult<MediaType>> {
  const label = format.label
  if (!format.schema.safeParse(input).success)
    return {
      error: `Bitte prüfe ${label}-Dateiname und Text (maximal 256 KiB).`,
    }
  if (options.signal?.aborted)
    return { error: `${label}-Erstellung abgebrochen.` }

  try {
    const data = await new Promise<Buffer>((resolve, reject) => {
      const child = startProcess(format.command, format.args, {
        env: { PATH: "/usr/bin:/bin", LANG: "en_US.UTF-8" },
        shell: false,
        stdio: "pipe",
      })
      const chunks: Buffer[] = []
      let size = 0
      let failure: Error | undefined
      let settled = false
      const abort = () => fail(`${label}-Erstellung abgebrochen.`)
      const timer = setTimeout(
        () => fail(`${label}-Erstellung hat zu lange gedauert.`),
        15_000
      )
      const cleanup = () => {
        clearTimeout(timer)
        options.signal?.removeEventListener("abort", abort)
      }
      const fail = (message: string) => {
        if (settled || failure) return
        failure = new DocumentError(message)
        chunks.length = 0
        try {
          child.kill("SIGKILL")
        } catch {
          /* Prozess bereits beendet. */
        }
        settled = true
        cleanup()
        reject(failure)
      }
      // Fehlerdetails des Filters können Nutzereingaben enthalten; weder speichern noch ausgeben.
      child.on("error", () =>
        fail(`${label}-Erstellung konnte nicht gestartet werden.`)
      )
      child.stdin?.on("error", () =>
        fail(`${label}-Text konnte nicht übertragen werden.`)
      )
      child.stdout?.on("error", () =>
        fail(`${label} konnte nicht gelesen werden.`)
      )
      child.stderr?.on("error", () =>
        fail(`${label}-Erstellung fehlgeschlagen.`)
      )
      child.stderr?.resume()
      child.stdout?.on("data", (chunk: Buffer) => {
        if (settled) return
        if (size + chunk.length > MAX_OUTPUT)
          return fail(`${label} ist größer als 5 MiB.`)
        chunks.push(chunk)
        size += chunk.length
      })
      child.on("close", (code) => {
        if (settled) return
        settled = true
        cleanup()
        if (code !== 0 || size < 5)
          return reject(
            new DocumentError(`${label}-Erstellung fehlgeschlagen.`)
          )
        const result = Buffer.concat(chunks, size)
        if (!format.valid(result))
          return reject(
            new DocumentError(
              `${label}-Erstellung lieferte keine gültige ${label}-Datei.`
            )
          )
        resolve(result)
      })
      options.signal?.addEventListener("abort", abort, { once: true })
      if (!child.stdin || !child.stdout || !child.stderr)
        return fail(`${label}-Erstellung ist nicht verfügbar.`)
      if (options.signal?.aborted) return abort()
      try {
        child.stdin.end(input.text, "utf8")
      } catch {
        fail(`${label}-Text konnte nicht übertragen werden.`)
      }
    })
    return {
      filename: input.filename,
      mediaType: format.mediaType,
      size: data.length,
      data: data.toString("base64"),
    }
  } catch (error) {
    // Nur eigene Meldungen weitergeben, keine nativen Prozess- oder Pfadfehler.
    const message =
      error instanceof DocumentError
        ? error.message
        : `${label}-Erstellung ist nicht verfügbar.`
    return { error: message }
  }
}

export function renderPdf(
  input: PdfInput,
  options: { signal?: AbortSignal } = {},
  startProcess: StartProcess = spawn
) {
  return renderDocument(
    input,
    {
      label: "PDF",
      mediaType: "application/pdf" as const,
      schema: inputSchema,
      command: "/usr/sbin/cupsfilter",
      args: ["-i", "text/plain", "-m", "application/pdf"],
      valid: (data) => data.subarray(0, 5).toString("ascii") === "%PDF-",
    },
    options,
    startProcess
  )
}

export function renderWord(
  input: z.infer<typeof wordInputSchema>,
  options: { signal?: AbortSignal } = {},
  startProcess: StartProcess = spawn
) {
  return renderDocument(
    input,
    {
      label: "Word",
      mediaType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document" as const,
      schema: wordInputSchema,
      command: "/usr/bin/textutil",
      args: [
        "-convert",
        "docx",
        "-format",
        "txt",
        "-inputencoding",
        "UTF-8",
        "-stdin",
        "-stdout",
      ],
      valid: (data) =>
        data.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 3, 4])) &&
        data.includes(Buffer.from("word/document.xml")) &&
        data.includes(Buffer.from("[Content_Types].xml")),
    },
    options,
    startProcess
  )
}

export function createPdfTool() {
  return tool({
    description:
      "Create a downloadable PDF from plain text. Supply a .pdf filename and the complete text (up to 256 KiB).",
    inputSchema,
    execute: (input, { abortSignal }) =>
      renderPdf(input, { signal: abortSignal }),
    toModelOutput: ({ output }) => ({
      type: "json",
      value:
        "error" in output
          ? { error: output.error ?? "PDF-Erstellung fehlgeschlagen." }
          : {
              filename: output.filename,
              mediaType: output.mediaType,
              size: output.size,
            },
    }),
  })
}

export function createWordTool() {
  return tool({
    description:
      "Create a downloadable Word .docx document from plain text. Supply a .docx filename and the complete text (up to 256 KiB).",
    inputSchema: wordInputSchema,
    execute: (input, { abortSignal }) =>
      renderWord(input, { signal: abortSignal }),
    toModelOutput: ({ output }) => ({
      type: "json",
      value:
        "error" in output
          ? { error: output.error ?? "Word-Erstellung fehlgeschlagen." }
          : {
              filename: output.filename,
              mediaType: output.mediaType,
              size: output.size,
            },
    }),
  })
}
