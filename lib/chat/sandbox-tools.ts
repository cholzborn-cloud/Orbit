import { Daytona, type Sandbox } from "@daytona/sdk"
import { tool, type ToolSet } from "ai"
import { z } from "zod"

import { parseBoundedSandboxRead } from "../files/bounded-read.ts"
import { mediaTypeOf } from "../files/media-type.ts"
import { MEMORY_PATH } from "./attachments"
import { MAX_AUTO_WRITE, autoOutputPath, SAFE_WRITE_SCRIPT } from "./sandbox-write.ts"

// Eigener Client im Worker: lib/daytona.ts ist server-only.
// apiUrl explizit, sonst bricht das SDK ab, wenn .env.local und Prozess-Umgebung beide den Wert setzen.
// Erst beim ersten Gebrauch: ohne Schlüssel startet der Dienst trotzdem, nur Sandbox-Aufrufe schlagen dann mit dem SDK-Fehler fehl.
let daytonaClient: Daytona | undefined
function client() {
  return (daytonaClient ??= new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
    apiUrl: process.env.DAYTONA_API_URL,
  }))
}

const MAX_OUTPUT = 10_000
const tail = (s: string) =>
  s.length > MAX_OUTPUT ? `…(gekürzt)\n${s.slice(-MAX_OUTPUT)}` : s

// Obergrenze gleichzeitiger Sandboxes (Phase 5, Kostenbudget): der Dienst setzt hier die Wartestelle. Ohne sie startet jede sofort.
type SandboxGate = { acquire(id: string): Promise<{ ok: true } | { ok: false; error: string }> }
let sandboxGate: SandboxGate | undefined
export function setSandboxGate(next: SandboxGate | undefined) {
  sandboxGate = next
}
// Nach dem Ersetzen eines Schlüssels (Schlüsselbund) neu verbinden.
export function resetDaytonaClient() {
  daytonaClient = undefined
}

// Sandbox holen und ggf. starten (stoppt nach 15 Min Leerlauf). Nur aufrufen, wenn wirklich eine Sandbox gebraucht wird
// (erstes Sandbox-Werkzeug, Datei-Upload): kein Anwärmen mehr.
export async function startSandbox(sandboxId: string) {
  const slot = await sandboxGate?.acquire(sandboxId)
  if (slot && !slot.ok) throw new Error(slot.error)
  const sb = await client().get(sandboxId)
  if (sb.state !== "started") await sb.start()
  return sb
}

// Prüft nur, ob der Daytona-Schlüssel angenommen wird (Einrichtungs-Check); startet und legt nichts an.
export async function pingDaytona() {
  // Erstes Element anfragen genügt: ein ungültiger Schlüssel wirft hier.
  await client().list().next()
}

// Fehler, wenn die Sandbox gerade nicht läuft und der Aufrufer sie nicht starten darf.
export class SandboxNotRunning extends Error {
  constructor() {
    super("Sandbox läuft nicht.")
    this.name = "SandboxNotRunning"
  }
}

// Altes Gedächtnis (MEMORY.md in der Sandbox): wird nur noch einmalig für die Migration ins lokale Gedächtnis gelesen
// (lib/orbi/local-memory.ts), nie geschrieben. Fehlt die Datei (404), kommt "".
// Startet die Sandbox nie: läuft sie nicht, wartet die Migration auf den nächsten Turn (SandboxNotRunning).
export async function readLegacyMemory(sandboxId: string) {
  const sb = await client().get(sandboxId)
  if (sb.state !== "started") throw new SandboxNotRunning()
  const bytes = await sb.fs
    .downloadFile(MEMORY_PATH)
    .catch((error: { status?: number; statusCode?: number }) => {
      if (error.status === 404 || error.statusCode === 404) return Buffer.alloc(0)
      throw error
    })
  return bytes.toString("utf8")
}

export type SharedFileOutput = {
  filename: string
  mediaType: string
  size: number
  data: string
}
const MAX_SHARE = 5 * 1024 * 1024
const BOUNDED_READ_SCRIPT = `
import base64, json, os, stat
path = os.environ["ORBIT_SHARE_SOURCE"]
limit = int(os.environ["ORBIT_SHARE_LIMIT"])
fd = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
try:
    info = os.fstat(fd)
    if stat.S_ISDIR(info.st_mode):
        print(json.dumps({"kind": "directory"}))
    else:
        chunks = []
        remaining = limit + 1
        while remaining:
            chunk = os.read(fd, min(65536, remaining))
            if not chunk:
                break
            chunks.append(chunk)
            remaining -= len(chunk)
        data = b"".join(chunks)
        if len(data) > limit:
            print(json.dumps({"kind": "too_large"}))
        else:
            print(json.dumps({"kind": "file", "size": len(data), "data": base64.b64encode(data).decode("ascii")}))
finally:
    os.close(fd)
`
export type Screenshot = {
  image: string
  mediaType: "image/jpeg"
  width: number
  height: number
}

// Screenshot als Bild für das Modell; die Middleware in chat.ts reicht es als Bild weiter.
const screenshotForModel = ({ output }: { output: Screenshot }) => ({
  type: "content" as const,
  value: [
    {
      type: "text" as const,
      text: `Screenshot ${output.width}x${output.height} px.`,
    },
    {
      type: "file" as const,
      data: { type: "data" as const, data: output.image },
      mediaType: output.mediaType,
    },
  ],
})

const point = {
  x: z.number().int().min(0).describe("X in Pixeln"),
  y: z.number().int().min(0).describe("Y in Pixeln"),
}

export function sandboxTools(sandboxId: string) {
  // Einmal pro Run: Sandbox ggf. starten (stoppt nach 15 Min Leerlauf), Desktop nur für GUI-Tools.
  let ready: Promise<Sandbox> | undefined
  let desktop: Promise<Sandbox> | undefined
  const sandbox = () =>
    (ready ??= startSandbox(sandboxId).catch((e) => {
      ready = undefined
      throw e
    }))
  const gui = () =>
    (desktop ??= (async () => {
      const sb = await sandbox()
      await sb.computerUse.start()
      return sb
    })().catch((e) => {
      desktop = undefined
      throw e
    }))

  const screenshot = async (): Promise<Screenshot> => {
    const sb = await gui()
    const [shot, info] = await Promise.all([
      // Ohne scale: Bildpixel = Klickkoordinaten.
      sb.computerUse.screenshot.takeCompressed({
        format: "jpeg",
        quality: 70,
        showCursor: true,
      }),
      sb.computerUse.display.getInfo(),
    ])
    const d = info.displays?.[0]
    return {
      image: shot.screenshot ?? "",
      mediaType: "image/jpeg",
      width: d?.width ?? 0,
      height: d?.height ?? 0,
    }
  }

  return {
    bash: tool({
      description:
        "Run a shell command in your sandbox (user daytona, home /home/daytona). Returns exit code and output (last 10k chars). GUI apps: `DISPLAY=:0 nohup <app> >/dev/null 2>&1 &`.",
      inputSchema: z.object({
        command: z.string(),
        cwd: z.string().optional().describe("Working directory, default home"),
        timeout: z
          .number()
          .int()
          .min(1)
          .max(600)
          .optional()
          .describe("Seconds, default 60"),
      }),
      execute: async ({ command, cwd, timeout }) => {
        const sb = await sandbox()
        const r = await sb.process.executeCommand(
          command,
          cwd,
          undefined,
          timeout ?? 60
        )
        return { exitCode: r.exitCode, output: tail(r.result ?? "") }
      },
    }),

    read_file: tool({
      description: "Read a text file from your sandbox (first 10k chars).",
      inputSchema: z.object({ path: z.string() }),
      execute: async ({ path }) => {
        const content = (
          await (await sandbox()).fs.downloadFile(path)
        ).toString("utf8")
        return {
          path,
          content:
            content.length > MAX_OUTPUT
              ? `${content.slice(0, MAX_OUTPUT)}\n…(gekürzt)`
              : content,
        }
      },
    }),

    create_file: tool({
      description:
        "Create a new text file under /home/daytona/output (no overwrite, folders are created, max 60 KB). It appears in the chat. If the name exists, choose a new one.",
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) => {
        const bytes = Buffer.from(content, "utf8")
        if (!autoOutputPath(path) || bytes.length > MAX_AUTO_WRITE)
          throw new Error("Datei muss im Ausgabeordner liegen und darf höchstens 60 KB groß sein.")
        const result = await (await sandbox()).process.executeCommand(
          'python3 -c "$ORBIT_WRITE_SCRIPT"',
          undefined,
          {
            ORBIT_WRITE_SCRIPT: SAFE_WRITE_SCRIPT,
            ORBIT_WRITE_ROOT: "/home/daytona",
            ORBIT_WRITE_PATH: path,
            ORBIT_WRITE_DATA: bytes.toString("base64"),
          },
          10
        )
        if (result.exitCode !== 0)
          throw new Error("Datei konnte nicht erstellt werden; bitte einen neuen Dateinamen wählen.")
        return { path, bytes: bytes.length }
      },
    }),

    write_file: tool({
      description:
        "Create or overwrite a text file in your sandbox. Parent folders must exist (create them with bash `mkdir -p`).",
      inputSchema: z.object({ path: z.string(), content: z.string() }),
      execute: async ({ path, content }) => {
        await (await sandbox()).fs.uploadFile(Buffer.from(content, "utf8"), path)
        return { path, bytes: Buffer.byteLength(content) }
      },
    }),

    list_files: tool({
      description: "List files and folders in a directory of your sandbox.",
      inputSchema: z.object({
        path: z.string().default(".").describe("Default: home"),
      }),
      execute: async ({ path }) => {
        const files = await (await sandbox()).fs.listFiles(path)
        return files.map((f) => ({
          name: f.name,
          isDir: f.isDir,
          size: f.size,
        }))
      },
    }),

    share_file: tool({
      description:
        "Show an existing sandbox file to the user as a card in the chat (preview and download). Max 5 MB. Not needed for files that already appeared.",
      inputSchema: z.object({
        path: z.string().describe("Absolute path or relative to home"),
      }),
      execute: async ({ path }): Promise<SharedFileOutput> => {
        const sb = await sandbox()
        const result = await sb.process.executeCommand(
          'python3 -c "$ORBIT_SHARE_SCRIPT"',
          undefined,
          {
            ORBIT_SHARE_SCRIPT: BOUNDED_READ_SCRIPT,
            ORBIT_SHARE_SOURCE: path,
            ORBIT_SHARE_LIMIT: String(MAX_SHARE),
          },
          10
        )
        if (result.exitCode !== 0)
          throw new Error("Datei konnte nicht freigegeben werden.")
        const bounded = parseBoundedSandboxRead(result.result ?? "", MAX_SHARE)
        const filename = path.split("/").pop() || "datei"
        return {
          filename,
          mediaType: mediaTypeOf(filename),
          size: bounded.size,
          data: bounded.data,
        }
      },
      // Nur Bestätigung ans Modell, nie die Bytes.
      toModelOutput: ({ output }) => ({
        type: "text",
        value: `Shared ${output.filename} (${output.size} bytes) with the user.`,
      }),
    }),

    view_screen: tool({
      description:
        "Take a screenshot of your sandbox desktop so YOU can see it. Not shown to the user. Use before and after GUI actions to check what happened.",
      inputSchema: z.object({}),
      execute: screenshot,
      toModelOutput: screenshotForModel,
    }),

    show_screen: tool({
      description:
        "Take a screenshot of your sandbox desktop and show it to the user in the chat. Use only when the user wants to see the screen.",
      inputSchema: z.object({}),
      execute: screenshot,
      toModelOutput: screenshotForModel,
    }),

    mouse_click: tool({
      description: "Click at a screen position.",
      inputSchema: z.object({
        ...point,
        button: z.enum(["left", "right", "middle"]).default("left"),
        double: z.boolean().default(false),
      }),
      execute: async ({ x, y, button, double }) => {
        await (await gui()).computerUse.mouse.click(x, y, button, double)
        return { ok: true }
      },
    }),

    mouse_move: tool({
      description: "Move the mouse to a screen position (e.g. to hover).",
      inputSchema: z.object(point),
      execute: async ({ x, y }) => {
        await (await gui()).computerUse.mouse.move(x, y)
        return { ok: true }
      },
    }),

    mouse_scroll: tool({
      description: "Scroll the mouse wheel at a screen position.",
      inputSchema: z.object({
        ...point,
        direction: z.enum(["up", "down"]),
        amount: z
          .number()
          .int()
          .min(1)
          .max(30)
          .default(3)
          .describe("Wheel ticks"),
      }),
      execute: async ({ x, y, direction, amount }) => {
        await (await gui()).computerUse.mouse.scroll(x, y, direction, amount)
        return { ok: true }
      },
    }),

    mouse_drag: tool({
      description:
        "Drag with the left mouse button from one position to another.",
      inputSchema: z.object({
        startX: z.number().int().min(0),
        startY: z.number().int().min(0),
        endX: z.number().int().min(0),
        endY: z.number().int().min(0),
      }),
      execute: async ({ startX, startY, endX, endY }) => {
        await (await gui()).computerUse.mouse.drag(startX, startY, endX, endY)
        return { ok: true }
      },
    }),

    keyboard_type: tool({
      description: "Type text at the current keyboard focus.",
      inputSchema: z.object({ text: z.string() }),
      execute: async ({ text }) => {
        await (await gui()).computerUse.keyboard.type(text)
        return { ok: true }
      },
    }),

    keyboard_press: tool({
      description:
        "Press one key, optionally with modifiers. Keys like 'Return', 'Escape', 'Tab', 'BackSpace', 'Up', 'F5', 'a'.",
      inputSchema: z.object({
        key: z.string(),
        modifiers: z.array(z.enum(["ctrl", "alt", "shift", "cmd"])).optional(),
      }),
      execute: async ({ key, modifiers }) => {
        await (await gui()).computerUse.keyboard.press(key, modifiers)
        return { ok: true }
      },
    }),

    keyboard_hotkey: tool({
      description:
        "Press a key combination, e.g. 'ctrl+c', 'ctrl+shift+t', 'alt+tab'.",
      inputSchema: z.object({ keys: z.string() }),
      execute: async ({ keys }) => {
        await (await gui()).computerUse.keyboard.hotkey(keys)
        return { ok: true }
      },
    }),

    wait: tool({
      description: "Wait a few seconds, e.g. for a page or app to load.",
      inputSchema: z.object({ seconds: z.number().min(0.5).max(30) }),
      execute: async ({ seconds }, { abortSignal }) => {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, seconds * 1000)
          abortSignal?.addEventListener(
            "abort",
            () => (clearTimeout(t), resolve())
          )
        })
        return { ok: true }
      },
    }),
  } satisfies ToolSet
}

export type SandboxTools = ReturnType<typeof sandboxTools>
