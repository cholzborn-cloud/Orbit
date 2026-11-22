import { spawn } from "node:child_process"
import { cliEnv, findBinary } from "../cli/locate.ts"
import type { ProviderUsage, UsageWindow } from "./types.ts"

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

// Die CLI zeigt lokale Kalenderzeiten; unbekannte Formate werden nicht geraten.
function resetTime(value: string, now: number): number | undefined {
  const match = /^(?:(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s*\(([^()]+)\)$/i.exec(value.trim())
  if (!match) return
  const hour = Number(match[3])
  const minute = Number(match[4] ?? 0)
  if (hour < 1 || hour > 12 || minute > 59) return
  const clockHour = hour % 12 + (match[5]!.toLowerCase() === "pm" ? 12 : 0)
  try {
    const format = new Intl.DateTimeFormat("en-US", { timeZone: match[6], year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", hourCycle: "h23" })
    const parts = (epoch: number) => Object.fromEntries(format.formatToParts(new Date(epoch)).map(({ type, value }) => [type, value]))
    const current = parts(now)
    const year = Number(current.year)
    const month = match[1] ? MONTHS.indexOf(match[1].toLowerCase()) : Number(current.month) - 1
    const day = match[2] ? Number(match[2]) : Number(current.day)
    const toEpoch = (local: number) => {
      let epoch = local
      for (let i = 0; i < 3; i++) {
        const p = parts(epoch)
        const displayed = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute))
        epoch += local - displayed
      }
      return epoch
    }
    let local = Date.UTC(year, month, day, clockHour, minute)
    const date = new Date(local)
    if (date.getUTCMonth() !== month || date.getUTCDate() !== day) return
    let result = toEpoch(local)
    if (result < now - 60_000) {
      local = match[1] ? Date.UTC(year + 1, month, day, clockHour, minute) : local + 86_400_000
      result = toEpoch(local)
    }
    const shown = parts(result)
    const expected = new Date(local)
    if (Number(shown.year) !== expected.getUTCFullYear() || Number(shown.month) !== expected.getUTCMonth() + 1 || Number(shown.day) !== expected.getUTCDate() || Number(shown.hour) !== clockHour || Number(shown.minute) !== minute) return
    for (const delta of [-7_200_000, -3_600_000, -1_800_000, 1_800_000, 3_600_000, 7_200_000]) {
      const other = parts(result + delta)
      if (["year", "month", "day", "hour", "minute"].every((key) => other[key] === shown[key])) return
    }
    return result
  } catch { return }
}

export function parseClaudeCliUsage(raw: string, now = Date.now()): ProviderUsage {
  const screen = raw.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
  const windows: UsageWindow[] = []
  for (const [name, heading, next] of [["5h", "Current session", "Current week"], ["7d", "Current week\\s*\\(?(?:all models)?\\)?", "(?:Current week|Extra usage)"]] as const) {
    const section = new RegExp(`${heading}([\\s\\S]*?)(?=${next}|$)`, "i").exec(screen)?.[1]
    const used = /\b(\d{1,3})%\s*(?:\d{1,3}%\s*)?used\b/i.exec(section ?? "")
    const reset = /\bResets\s+([^\r\n]+)/i.exec(section ?? "")
    const at = reset ? resetTime(reset[1]!, now) : undefined
    if (used && Number(used[1]) <= 100 && at !== undefined) windows.push({ name, used: Number(used[1]) / 100, resetAt: at })
  }
  const status = windows.some((window) => window.used >= 1) ? "limit" : windows.length === 2 ? "ok" : "error"
  const note = windows.length !== 2 ? "Claude meldet keine vollständig lesbare Nutzung." : undefined
  return { provider: "claude", status, accounts: [{ id: "cli", label: "Claude", status, windows, ...(note && { note }) }], ...(note && { note }) }
}

let cached: { at: number; value: ProviderUsage } | undefined
let pending: Promise<ProviderUsage> | undefined

// Die Anzeige wird nur im Speicher gelesen und für eine Minute zwischengespeichert.
export async function readClaudeCliUsage(fresh = false): Promise<ProviderUsage> {
  if (!fresh && cached && Date.now() - cached.at < 60_000) return cached.value
  if (pending) return pending
  pending = queryClaudeCliUsage()
  try {
    const value = await pending
    if (value.status !== "error" && value.accounts[0]?.windows.length === 2) cached = { at: Date.now(), value }
    else cached = undefined
    return value
  } finally { pending = undefined }
}

async function queryClaudeCliUsage(): Promise<ProviderUsage> {
  const binary = findBinary("claude")
  if (!binary) return parseClaudeCliUsage("")
  try { return parseClaudeCliUsage(await readUsageScreen(binary)) }
  catch { return parseClaudeCliUsage("") }
}

function readUsageScreen(binary: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const program = `
      log_user 1
      match_max 500000
      set timeout 12
      spawn -noecho [lindex $argv 0] --safe-mode --restricted --setting-sources {} --ax-screen-reader
      set child_pid [exp_pid]
      puts stderr "orbit-child-pid:$child_pid"
      flush stderr
      after 3000
      send -- "/usage\\r"
      expect { -re {(?s)Current week.*Resets[^\\r\\n]*\\)} {} timeout {} eof {} }
      catch {exec /bin/kill -KILL -- -$child_pid}
      catch {exec /bin/kill -KILL $child_pid}
      catch {close}
      catch {wait}
    `
    const child = spawn("/usr/bin/expect", ["-f", "-", binary], {
      cwd: "/tmp", env: cliEnv(binary, { TERM: "xterm-256color", LANG: "en_US.UTF-8" }), stdio: ["pipe", "pipe", "pipe"], detached: true,
    })
    let output = ""
    let settled = false
    let closing = false
    let outcome = false
    let descendantPid: number | undefined
    let stderr = ""
    let force: ReturnType<typeof setTimeout> | undefined
    const signalGroup = (signal: NodeJS.Signals) => {
      for (const pid of [descendantPid, child.pid]) if (pid) {
        try { process.kill(-pid, signal) } catch { /* Prozessgruppe bereits beendet */ }
        try { process.kill(pid, signal) } catch { /* Prozess bereits beendet */ }
      }
    }
    const finish = (ok: boolean) => {
      if (closing) return
      closing = true
      outcome = ok
      clearTimeout(deadline)
      signalGroup("SIGTERM")
      force = setTimeout(() => signalGroup("SIGKILL"), 250)
    }
    const deadline = setTimeout(() => finish(false), 20_000)
    child.on("error", () => finish(false))
    child.stdin.on("error", () => finish(false))
    child.on("close", () => {
      if (!closing) finish(parseClaudeCliUsage(output).accounts[0]?.windows.length !== 0)
      if (settled) return
      settled = true
      if (force) clearTimeout(force)
      signalGroup("SIGKILL")
      outcome ? resolve(output) : reject(new Error("Claude-Nutzung nicht verfügbar"))
    })
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-256)
      const match = /(?:^|\n)orbit-child-pid:(\d+)(?:\r?\n)/.exec(stderr)
      if (match) descendantPid = Number(match[1])
    })
    child.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8")
      if (output.length > 500_000) return finish(false)
    })
    child.stdin.end(program)
  })
}
