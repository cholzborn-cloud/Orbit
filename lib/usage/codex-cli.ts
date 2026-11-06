import { spawn } from "node:child_process"
import { cliEnv, findBinary } from "../cli/locate.ts"
import type { ProviderUsage, UsageWindow } from "./types.ts"

// Die CLI liefert nur den aktiven Account; Zugangsdaten werden nicht ausgelesen.
export function parseCodexCliUsage(value: unknown): ProviderUsage {
  const result = value as { ordinaryUsageAllowed?: boolean | null; rateLimits?: { primary?: RawWindow | null; secondary?: RawWindow | null; rateLimitReachedType?: string | null } } | null
  const limits = result?.rateLimits
  const windows = [limits?.primary, limits?.secondary].flatMap((window): UsageWindow[] => {
    const name = window?.windowDurationMins === 300 ? "5h" : window?.windowDurationMins === 10080 ? "7d" : undefined
    return name && typeof window?.usedPercent === "number" && Number.isFinite(window.usedPercent) && window.usedPercent >= 0 && window.usedPercent <= 100 && typeof window.resetsAt === "number" && Number.isFinite(window.resetsAt) && window.resetsAt > 0 && Number.isFinite(window.resetsAt * 1000)
      ? [{ name, used: window.usedPercent / 100, resetAt: window.resetsAt * 1000 }]
      : []
  })
  const limited = result?.ordinaryUsageAllowed === false || !!limits?.rateLimitReachedType || windows.some((window) => window.used >= 1)
  const complete = windows.length === 2 && new Set(windows.map((window) => window.name)).size === 2
  const status = limited ? "limit" : complete ? "ok" : "error"
  const note = !complete ? "Codex meldet keine vollständig lesbaren Nutzungsfenster." : undefined
  return { provider: "codex", status, accounts: [{ id: "cli", label: "Codex", status, windows, ...(note && { note }) }], ...(note && { note }) }
}
type RawWindow = { usedPercent?: number; resetsAt?: number | null; windowDurationMins?: number | null }

export async function readCodexCliUsage(): Promise<ProviderUsage> {
  const binary = findBinary("codex")
  if (!binary) return parseCodexCliUsage(null)
  try { return parseCodexCliUsage(await requestRates(binary)) }
  catch { return parseCodexCliUsage(null) }
}

function requestRates(binary: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ["app-server"], { cwd: "/tmp", env: cliEnv(binary), stdio: ["pipe", "pipe", "ignore"], detached: true })
    let settled = false
    let closing = false
    let outcome: unknown
    let buffer = ""
    const signalGroup = (signal: NodeJS.Signals) => {
      if (child.pid) { try { process.kill(-child.pid, signal) } catch { /* Prozessgruppe bereits beendet */ } }
      try { child.kill(signal) } catch { /* Prozess bereits beendet */ }
    }
    let force: ReturnType<typeof setTimeout> | undefined
    const finish = (result?: unknown) => {
      if (closing) return
      closing = true
      outcome = result
      clearTimeout(timer)
      child.stdin.end()
      signalGroup("SIGTERM")
      force = setTimeout(() => signalGroup("SIGKILL"), 250)
    }
    const timer = setTimeout(() => finish(), 8000)
    const send = (value: unknown) => child.stdin.write(JSON.stringify(value) + "\n")
    child.on("error", () => finish())
    child.stdin.on("error", () => finish())
    child.on("close", () => {
      if (!closing) finish()
      if (settled) return
      settled = true
      if (force) clearTimeout(force)
      signalGroup("SIGKILL")
      outcome === undefined ? reject(new Error("Codex-Nutzung nicht verfügbar")) : resolve(outcome)
    })
    const lineReceived = (line: string) => {
      try {
        const message = JSON.parse(line) as { id?: number; result?: unknown; error?: unknown }
        if (message.id === 1) {
          if (message.error) return finish()
          send({ method: "initialized" })
          send({ id: 2, method: "account/rateLimits/read", params: null })
        } else if (message.id === 2) finish(message.error ? undefined : message.result)
      } catch { finish() }
    }
    child.stdout.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => {
      if (closing) return
      buffer += chunk
      if (buffer.length > 1_000_000) return finish()
      let newline: number
      while ((newline = buffer.indexOf("\n")) >= 0 && !closing) {
        const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1)
        lineReceived(line)
      }
    })
    send({ id: 1, method: "initialize", params: { clientInfo: { name: "orbit", version: "1" } } })
  })
}
