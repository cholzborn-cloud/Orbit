import { randomUUID } from "node:crypto"
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, existsSync, appendFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"

import { tool, type ToolSet } from "ai"
import { z } from "zod"

import { getDatabase } from "../db/client.ts"
import { recordUndo } from "../db/undo-store.ts"
import { JXA, KEY_CODES } from "./jxa.ts"
import { noteAutomationResult, permissionHint } from "./permissions.ts"
import { clipOutput, redactSecrets, runLocal } from "./run.ts"
import { ensureShim } from "./shim.ts"
import { moveFile, moveToTrash, type TrashMove } from "./trash.ts"

// Lokale Werkzeuge am Mac von Consti (Dienst orbitd, Nutzerrechte). Name „mac_…“ = am Mac, ohne Präfix = Sandbox in der Cloud.
// Löschen läuft immer über den Papierkorb (im Code: Shim in der Shell, Dateiwerkzeug, Risikoprüfung lib/mac/risk.ts).
// TODO(Prompt-Labor): Verhaltensregel, wann der Orbi „am Mac“ (mac_*) und wann „in der Sandbox“ arbeitet.
// TODO(Prompt-Labor): Hinweis an den Orbi, dass Löschen am Mac im Papierkorb landet und Rückfragen nur bei Geld/Veröffentlichen/Nachrichten/endgültig Löschen kommen.
// TODO(Prompt-Labor): Regel für Bildschirm + Maus: erst mac_screen ansehen, dann klicken, danach erneut prüfen.

export type MacToolsOptions = { dataDir: string; home?: string; db?: () => Parameters<typeof recordUndo>[0] }

const home = (o: MacToolsOptions) => o.home ?? homedir()
const expand = (path: string, o: MacToolsOptions) => resolve(path.startsWith("~/") || path === "~" ? join(home(o), path.slice(2)) : path)
const signalOf = (options: unknown) => (options as { abortSignal?: AbortSignal } | undefined)?.abortSignal

// Rückgängig: jede umkehrbare lokale Aktion wird mit ihrem Zustand gespeichert; POST /v1/undo {kind:"mac", orbiId:<undoId>}.
export type MacUndo =
  | { action: "trash"; moves: TrashMove[] }
  | { action: "move"; moves: TrashMove[] }
  | { action: "write"; path: string; previous?: TrashMove }
  | { action: "calendar_create"; id: string }
  | { action: "reminder_create"; id: string }
  | { action: "reminder_complete"; id: string; before: boolean }
  | { action: "note_create"; id: string }

function undoable(o: MacToolsOptions, undo: MacUndo, detail: string) {
  try {
    const id = randomUUID()
    recordUndo((o.db ?? (() => getDatabase().$client))(), { kind: "mac", entityId: id, action: undo.action, detail, previousState: undo })
    return id
  } catch {
    return undefined
  }
}

async function osascript(script: string, args: unknown, options: { signal?: AbortSignal; app?: string; timeoutMs?: number; language?: "JavaScript" | "AppleScript" } = {}) {
  const r = await runLocal("/usr/bin/osascript", ["-l", options.language ?? "JavaScript", "-e", script, ...(args === undefined ? [] : [JSON.stringify(args)])], {
    signal: options.signal,
    timeoutMs: options.timeoutMs ?? 60_000,
  })
  if (options.app) noteAutomationResult(options.app, r.output, r.exitCode)
  if (r.exitCode !== 0) throw new Error(permissionHint(r.output) ?? (r.timedOut ? "Zeitlimit erreicht." : r.aborted ? "Abgebrochen." : r.output.trim() || "osascript fehlgeschlagen."))
  return r.output.trim()
}
const jxaJson = async <T>(script: string, args: unknown, options: Parameters<typeof osascript>[2] = {}) => JSON.parse(await osascript(script, args, options)) as T

// Der Dienst läuft unter launchd mit knappem PATH: Homebrew und /usr/local dazu, der Shim immer zuerst.
export function shellPath(shimDir: string, base = process.env.PATH) {
  const parts = [shimDir, ...(base ?? "").split(":"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
  return [...new Set(parts.filter(Boolean))].join(":")
}

export function macTools(o: MacToolsOptions): ToolSet {
  const shimDir = join(o.dataDir, "mac-shim")
  return {
    mac_shell: tool({
      description:
        "Run a shell command (zsh) locally on the user's Mac. rm/rmdir/unlink move files to the Trash. Returns exit code and output (last 10k chars).",
      inputSchema: z.object({
        command: z.string(),
        cwd: z.string().optional().describe("Working directory, default home"),
        timeout: z.number().int().min(1).max(1800).optional().describe("Seconds, default 120"),
      }),
      execute: async ({ command, cwd, timeout }, options) => {
        ensureShim(shimDir)
        const logDir = mkdtempSync(join(tmpdir(), "orbit-trash-"))
        const log = join(logDir, "moves.tsv")
        try {
          const r = await runLocal("/bin/zsh", ["-f", "-c", command], {
            cwd: cwd ? expand(cwd, o) : home(o),
            timeoutMs: (timeout ?? 120) * 1000,
            signal: signalOf(options),
            env: { ...process.env, PATH: shellPath(shimDir), ORBIT_TRASH_LOG: log, HOME: home(o) },
          })
          const moves = existsSync(log)
            ? readFileSync(log, "utf8").split("\n").filter(Boolean).map((line) => {
                const [from, to] = line.split("\t")
                return { from: from!, to: to! }
              })
            : []
          const undoId = moves.length ? undoable(o, { action: "trash", moves }, `${moves.length} Objekt(e) in den Papierkorb`) : undefined
          return {
            exitCode: r.exitCode,
            output: r.output,
            ...(r.timedOut && { timedOut: true }),
            ...(r.aborted && { aborted: true }),
            ...(moves.length && { trashed: moves.map((m) => m.from) }),
            ...(undoId && { undoId }),
          }
        } finally {
          rmSync(logDir, { recursive: true, force: true })
        }
      },
    }),

    mac_files: tool({
      description:
        "Files on the user's Mac: read, write, list, search (Spotlight), move/rename, trash (moves to the Trash, never deletes). Paths may start with ~.",
      inputSchema: z.object({
        action: z.enum(["read", "write", "append", "list", "search", "move", "trash"]),
        path: z.string().optional().describe("File or folder (read, write, append, list, move source, search folder)"),
        paths: z.array(z.string()).optional().describe("trash: files or folders"),
        to: z.string().optional().describe("move: target path"),
        content: z.string().optional().describe("write/append: text"),
        query: z.string().optional().describe("search: words or Spotlight query"),
        limit: z.number().int().min(1).max(500).optional(),
      }),
      execute: async (input, options) => {
        const need = (value: string | undefined, name: string) => {
          if (!value) throw new Error(`„${name}“ fehlt.`)
          return value
        }
        switch (input.action) {
          case "read": {
            const path = expand(need(input.path, "path"), o)
            const size = statSync(path).size
            const data = readFileSync(path)
            const binary = data.subarray(0, 8000).includes(0)
            if (binary) return { path, size, binary: true, note: "Binärdatei: Inhalt nicht als Text lesbar." }
            return { path, size, content: clipOutput(redactSecrets(data.toString("utf8")), 100_000) }
          }
          case "write":
          case "append": {
            const path = expand(need(input.path, "path"), o)
            const content = input.content ?? ""
            if (input.action === "append") {
              appendFileSync(path, content)
              return { path, appended: content.length }
            }
            // Überschreiben ist umkehrbar: die alte Fassung kommt vorher in den Papierkorb.
            const previous = existsSync(path) ? moveToTrash(path, { home: home(o) }) : undefined
            writeFileSync(path, content)
            const undoId = undoable(o, { action: "write", path, previous }, previous ? `${path} überschrieben` : `${path} angelegt`)
            return { path, written: content.length, ...(previous && { previousInTrash: previous.to }), ...(undoId && { undoId }) }
          }
          case "list": {
            const path = expand(input.path ?? "~", o)
            const entries = readdirSync(path, { withFileTypes: true }).slice(0, input.limit ?? 200)
            return { path, entries: entries.map((e) => `${e.name}${e.isDirectory() ? "/" : ""}`) }
          }
          case "search": {
            const args = [...(input.path ? ["-onlyin", expand(input.path, o)] : []), need(input.query, "query")]
            const r = await runLocal("/usr/bin/mdfind", args, { timeoutMs: 30_000, signal: signalOf(options) })
            return { results: r.output.split("\n").filter(Boolean).slice(0, input.limit ?? 50) }
          }
          case "move": {
            const move = moveFile(expand(need(input.path, "path"), o), expand(need(input.to, "to"), o))
            const undoId = undoable(o, { action: "move", moves: [move] }, `${move.from} → ${move.to}`)
            return { ...move, ...(undoId && { undoId }) }
          }
          case "trash": {
            const list = input.paths ?? (input.path ? [input.path] : [])
            if (!list.length) throw new Error("„paths“ fehlt.")
            const moves = list.map((p) => moveToTrash(expand(p, o), { home: home(o) }))
            const undoId = undoable(o, { action: "trash", moves }, `${moves.length} Objekt(e) in den Papierkorb`)
            return { trashed: moves.map((m) => m.from), ...(undoId && { undoId }) }
          }
        }
      },
    }),

    mac_open: tool({
      description: "Open a file, folder, URL or app on the user's Mac (like the `open` command).",
      inputSchema: z.object({
        target: z.string().optional().describe("Path or URL"),
        app: z.string().optional().describe("App name, e.g. Safari, Finder, Numbers"),
      }),
      execute: async ({ target, app }, options) => {
        if (!target && !app) throw new Error("„target“ oder „app“ fehlt.")
        const args = [...(app ? ["-a", app] : []), ...(target ? [/^[a-z][\w+.-]*:/i.test(target) ? target : expand(target, o)] : [])]
        const r = await runLocal("/usr/bin/open", args, { timeoutMs: 30_000, signal: signalOf(options) })
        if (r.exitCode !== 0) throw new Error(r.output.trim() || "Öffnen fehlgeschlagen.")
        return { ok: true }
      },
    }),

    mac_applescript: tool({
      description: "Run AppleScript or JavaScript for Automation (osascript) on the user's Mac to control apps. Returns the script result.",
      inputSchema: z.object({
        script: z.string(),
        language: z.enum(["AppleScript", "JavaScript"]).default("AppleScript"),
      }),
      execute: async ({ script, language }, options) => {
        const r = await runLocal("/usr/bin/osascript", ["-l", language, "-e", script], { timeoutMs: 120_000, signal: signalOf(options) })
        const app = /tell application "([^"]+)"/.exec(script)?.[1]
        if (app) noteAutomationResult(app, r.output, r.exitCode)
        return { exitCode: r.exitCode, output: r.output, ...(permissionHint(r.output) && { hint: permissionHint(r.output) }) }
      },
    }),

    mac_shortcut: tool({
      description: "Run a Shortcuts shortcut by name on the user's Mac (optional text input), or list shortcuts with name omitted.",
      inputSchema: z.object({ name: z.string().optional(), input: z.string().optional() }),
      execute: async ({ name, input }, options) => {
        if (!name) {
          const r = await runLocal("/usr/bin/shortcuts", ["list"], { timeoutMs: 30_000, signal: signalOf(options) })
          return { shortcuts: r.output.split("\n").filter(Boolean) }
        }
        const dir = mkdtempSync(join(tmpdir(), "orbit-shortcut-"))
        try {
          const args = ["run", name, "-o", join(dir, "out")]
          if (input !== undefined) {
            writeFileSync(join(dir, "in.txt"), input)
            args.push("-i", join(dir, "in.txt"))
          }
          const r = await runLocal("/usr/bin/shortcuts", args, { timeoutMs: 300_000, signal: signalOf(options) })
          const out = existsSync(join(dir, "out")) ? clipOutput(redactSecrets(readFileSync(join(dir, "out"), "utf8"))) : ""
          return { exitCode: r.exitCode, output: out || r.output }
        } finally {
          rmSync(dir, { recursive: true, force: true })
        }
      },
    }),

    mac_screen: tool({
      description:
        "Take a screenshot of the user's Mac screen so you can see it. Image pixels equal mouse coordinates for mac_input. Not shown to the user.",
      inputSchema: z.object({}),
      execute: async (_input, options) => {
        const dir = mkdtempSync(join(tmpdir(), "orbit-screen-"))
        try {
          const file = join(dir, "screen.jpg")
          const size = await jxaJson<{ width: number; height: number }>(JXA.screenSize, undefined)
          const r = await runLocal("/usr/sbin/screencapture", ["-x", "-m", "-t", "jpg", file], { timeoutMs: 30_000, signal: signalOf(options) })
          if (r.exitCode !== 0 || !existsSync(file))
            throw new Error("Bildschirmaufnahme nicht erlaubt. Erlaubnis in Orbit › Einstellungen › Allgemein › Mac-Zugriff anfragen.")
          await runLocal("/usr/bin/sips", ["-z", String(Math.round(size.height)), String(Math.round(size.width)), "-s", "formatOptions", "70", file], { timeoutMs: 30_000 })
          return { image: readFileSync(file).toString("base64"), mediaType: "image/jpeg", width: Math.round(size.width), height: Math.round(size.height) }
        } finally {
          rmSync(dir, { recursive: true, force: true })
        }
      },
      toModelOutput: ({ output }: { output: { image: string; mediaType: string; width: number; height: number } }) => ({
        type: "content" as const,
        value: [
          { type: "text" as const, text: `Mac-Bildschirm ${output.width}x${output.height} (Punkte = Mauskoordinaten).` },
          { type: "file" as const, data: { type: "data" as const, data: output.image }, mediaType: output.mediaType },
        ],
      }),
    }),

    mac_input: tool({
      description:
        "Control mouse and keyboard on the user's Mac: click, double, right click, move, drag, scroll at screen points; type text; press a key with modifiers.",
      inputSchema: z.object({
        action: z.enum(["click", "double", "right", "move", "drag", "scroll", "type", "key"]),
        x: z.number().optional(),
        y: z.number().optional(),
        toX: z.number().optional().describe("drag: target x"),
        toY: z.number().optional().describe("drag: target y"),
        dy: z.number().optional().describe("scroll: lines down (negative = up)"),
        dx: z.number().optional().describe("scroll: lines right"),
        text: z.string().optional().describe("type: text to type"),
        key: z.string().optional().describe("key: letter or name (return, tab, escape, left, …)"),
        modifiers: z.array(z.enum(["command", "shift", "option", "control"])).optional(),
      }),
      execute: async (input, options) => {
        const signal = signalOf(options)
        if (input.action === "type" || input.action === "key") {
          const code = input.key ? KEY_CODES[input.key.toLowerCase()] : undefined
          const args = input.action === "type" ? { text: input.text ?? "" } : code !== undefined ? { keyCode: code, modifiers: input.modifiers } : { key: input.key ?? "", modifiers: input.modifiers }
          await osascript(JXA.keyboard, args, { signal, app: "System Events" })
          return { ok: true }
        }
        if (input.x === undefined || input.y === undefined) throw new Error("„x“ und „y“ fehlen.")
        const action = input.action === "right" ? "click" : input.action
        await osascript(JXA.mouse, { ...input, action, button: input.action === "right" ? "right" : "left" }, { signal })
        return { ok: true }
      },
    }),

    mac_clipboard: tool({
      description: "Read or write the clipboard of the user's Mac (text).",
      inputSchema: z.object({ action: z.enum(["read", "write"]), text: z.string().optional() }),
      execute: async ({ action, text }, options) => {
        if (action === "read") {
          const r = await runLocal("/usr/bin/pbpaste", [], { timeoutMs: 10_000, signal: signalOf(options) })
          return { text: r.output }
        }
        const r = await runLocal("/usr/bin/pbcopy", [], { input: text ?? "", timeoutMs: 10_000, signal: signalOf(options) })
        return { ok: r.exitCode === 0 }
      },
    }),

    mac_notify: tool({
      description: "Show a macOS notification on the user's Mac.",
      inputSchema: z.object({ title: z.string(), text: z.string() }),
      execute: async ({ title, text }, options) => {
        await osascript(`function run(argv){const a=JSON.parse(argv[0]);const app=Application.currentApplication();app.includeStandardAdditions=true;app.displayNotification(a.text,{withTitle:a.title});return '{}'}`, { title, text }, { signal: signalOf(options) })
        return { ok: true }
      },
    }),

    mac_calendar: tool({
      description: "Apple Calendar on the user's Mac: list events in a time range, or create an event (no invitations).",
      inputSchema: z.object({
        action: z.enum(["list", "create"]),
        from: z.string().optional().describe("list: ISO start, default now"),
        to: z.string().optional().describe("list: ISO end, default +7 days"),
        calendar: z.string().optional(),
        title: z.string().optional(),
        start: z.string().optional().describe("create: ISO date-time"),
        end: z.string().optional().describe("create: ISO date-time"),
        allDay: z.boolean().optional(),
        location: z.string().optional(),
        notes: z.string().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
      execute: async (input, options) => {
        const signal = signalOf(options)
        if (input.action === "list") {
          const from = input.from ?? new Date().toISOString()
          const to = input.to ?? new Date(Date.now() + 7 * 86_400_000).toISOString()
          return { events: await jxaJson(JXA.calendarList, { from, to, calendar: input.calendar, limit: input.limit ?? 200 }, { signal, app: "Calendar", timeoutMs: 120_000 }) }
        }
        if (!input.title || !input.start) throw new Error("„title“ und „start“ fehlen.")
        const end = input.end ?? new Date(new Date(input.start).getTime() + 3_600_000).toISOString()
        const created = await jxaJson<{ id: string; calendar: string }>(JXA.calendarCreate, { ...input, end }, { signal, app: "Calendar" })
        const undoId = undoable(o, { action: "calendar_create", id: created.id }, `Termin „${input.title}“ angelegt`)
        return { ...created, ...(undoId && { undoId }) }
      },
    }),

    mac_reminders: tool({
      description: "Apple Reminders on the user's Mac: list open reminders, create one, or mark one done/undone.",
      inputSchema: z.object({
        action: z.enum(["list", "create", "complete"]),
        list: z.string().optional(),
        title: z.string().optional(),
        due: z.string().optional().describe("ISO date-time"),
        notes: z.string().optional(),
        id: z.string().optional().describe("complete: reminder id"),
        done: z.boolean().optional().describe("complete: true = done, false = open again"),
        includeDone: z.boolean().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
      execute: async (input, options) => {
        const signal = signalOf(options)
        if (input.action === "list")
          return { reminders: await jxaJson(JXA.remindersList, { list: input.list, done: input.includeDone ?? false, limit: input.limit ?? 200 }, { signal, app: "Reminders", timeoutMs: 120_000 }) }
        if (input.action === "complete") {
          if (!input.id) throw new Error("„id“ fehlt.")
          const r = await jxaJson<{ id: string; before: boolean }>(JXA.reminderComplete, { id: input.id, done: input.done ?? true }, { signal, app: "Reminders" })
          const undoId = undoable(o, { action: "reminder_complete", id: input.id, before: r.before }, "Erinnerung abgehakt")
          return { ok: true, ...(undoId && { undoId }) }
        }
        if (!input.title) throw new Error("„title“ fehlt.")
        const created = await jxaJson<{ id: string; list: string }>(JXA.reminderCreate, input, { signal, app: "Reminders" })
        const undoId = undoable(o, { action: "reminder_create", id: created.id }, `Erinnerung „${input.title}“ angelegt`)
        return { ...created, ...(undoId && { undoId }) }
      },
    }),

    mac_contacts: tool({
      description: "Search Apple Contacts on the user's Mac by name.",
      inputSchema: z.object({ query: z.string(), limit: z.number().int().min(1).max(100).optional() }),
      execute: async ({ query, limit }, options) => ({
        contacts: await jxaJson(JXA.contactsSearch, { query, limit: limit ?? 20 }, { signal: signalOf(options), app: "Contacts", timeoutMs: 120_000 }),
      }),
    }),

    mac_notes: tool({
      description: "Apple Notes on the user's Mac: search notes (title and text), read one in full, or create a note.",
      inputSchema: z.object({
        action: z.enum(["search", "read", "create"]),
        query: z.string().optional(),
        title: z.string().optional(),
        text: z.string().optional(),
        folder: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
      }),
      execute: async (input, options) => {
        const signal = signalOf(options)
        if (input.action !== "create")
          return { notes: await jxaJson(JXA.notesSearch, { query: input.query ?? "", full: input.action === "read", limit: input.action === "read" ? 1 : (input.limit ?? 20) }, { signal, app: "Notes", timeoutMs: 120_000 }) }
        if (!input.title) throw new Error("„title“ fehlt.")
        const created = await jxaJson<{ id: string }>(JXA.noteCreate, { title: input.title, text: input.text ?? "", folder: input.folder }, { signal, app: "Notes" })
        const undoId = undoable(o, { action: "note_create", id: created.id }, `Notiz „${input.title}“ angelegt`)
        return { ...created, ...(undoId && { undoId }) }
      },
    }),

    mac_browser: tool({
      description: "Browser on the user's Mac (Safari or Google Chrome): open a URL, or read URL, title and page text of the front tab.",
      inputSchema: z.object({
        action: z.enum(["open", "read"]),
        app: z.enum(["Safari", "Google Chrome"]).default("Safari"),
        url: z.string().optional(),
        newTab: z.boolean().optional(),
        text: z.boolean().optional().describe("read: include page text (default true)"),
      }),
      execute: async (input, options) => {
        const signal = signalOf(options)
        if (input.action === "open") {
          if (!input.url) throw new Error("„url“ fehlt.")
          await osascript(JXA.browserOpen, { app: input.app, url: input.url, newTab: input.newTab ?? false }, { signal, app: input.app })
          return { ok: true }
        }
        const page = await jxaJson<{ url?: string; title?: string; text?: string; error?: string }>(JXA.browserRead, { app: input.app, text: input.text ?? true, max: 40_000 }, { signal, app: input.app })
        if (page.error) throw new Error(page.error)
        return { ...page, ...(page.text && { text: redactSecrets(page.text) }) }
      },
    }),
  }
}

// Rückgängig für lokale Aktionen (aufgerufen aus POST /v1/undo).
export async function undoMacAction(undo: MacUndo, o: { home?: string } = {}) {
  const { restoreFromTrash } = await import("./trash.ts")
  switch (undo.action) {
    case "trash":
      for (const move of [...undo.moves].reverse()) restoreFromTrash(move)
      return `${undo.moves.length} Objekt(e) zurückgelegt.`
    case "move":
      for (const move of [...undo.moves].reverse()) moveFile(move.to, move.from)
      return "Verschieben rückgängig gemacht."
    case "write":
      if (existsSync(undo.path)) moveToTrash(undo.path, { home: o.home })
      if (undo.previous) restoreFromTrash(undo.previous)
      return undo.previous ? "Alte Fassung wiederhergestellt." : "Angelegte Datei in den Papierkorb gelegt."
    case "calendar_create":
      await osascript(JXA.calendarDelete, { id: undo.id }, { app: "Calendar" })
      return "Termin entfernt."
    case "reminder_create":
      await osascript(JXA.reminderDelete, { id: undo.id }, { app: "Reminders" })
      return "Erinnerung entfernt."
    case "reminder_complete":
      await osascript(JXA.reminderComplete, { id: undo.id, done: undo.before }, { app: "Reminders" })
      return "Erinnerung zurückgesetzt."
    case "note_create":
      await osascript(JXA.noteDelete, { id: undo.id }, { app: "Notes" })
      return "Notiz in „Zuletzt gelöscht“ gelegt."
  }
}

export const MAC_TOOL_NAMES = ["mac_shell", "mac_files", "mac_open", "mac_applescript", "mac_shortcut", "mac_screen", "mac_input", "mac_clipboard", "mac_notify", "mac_calendar", "mac_reminders", "mac_contacts", "mac_notes", "mac_browser"] as const
export const dataDirOf = (dbPath: string) => dirname(dbPath)
