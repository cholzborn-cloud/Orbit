import { spawn } from "node:child_process"

// Lokale Prozesse am Mac: Zeitlimit, Abbruch über den Stopp-Knopf (AbortSignal), Ausgabe gekürzt und ohne Geheimnisse.
export const MAX_OUTPUT = 10_000

export type RunResult = { exitCode: number | null; output: string; timedOut: boolean; aborted: boolean }

// Typische Schlüssel/Tokens in Ausgaben unkenntlich machen (Keys nie in Chat, Logs oder Modell).
const SECRET_OUTPUT: RegExp[] = [
  /\b(sk|pk|rk)-(live|test|proj|ant|or)?-?[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /((?:api[_-]?key|token|secret|password|passwd|authorization)["']?\s*[:=]\s*["']?(?:Bearer\s+)?)[^\s"']{8,}/gi,
]

export function redactSecrets(text: string) {
  let out = text
  for (const pattern of SECRET_OUTPUT)
    out = out.replace(pattern, (match, prefix?: string) => (typeof prefix === "string" && match.startsWith(prefix) && prefix.length < match.length ? `${prefix}•••••` : "•••••"))
  return out
}

export const clipOutput = (text: string, max = MAX_OUTPUT) =>
  text.length > max ? `…(gekürzt)\n${text.slice(-max)}` : text

export function runLocal(
  file: string,
  args: string[],
  options: { cwd?: string; env?: NodeJS.ProcessEnv; input?: string; timeoutMs?: number; signal?: AbortSignal; maxOutput?: number } = {}
): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    let output = ""
    let timedOut = false
    let aborted = false
    let done = false
    const limit = (options.maxOutput ?? MAX_OUTPUT) * 4
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: true, // eigene Prozessgruppe: Stopp beendet auch Kindprozesse
    })
    const kill = () => {
      try {
        if (child.pid) process.kill(-child.pid, "SIGTERM")
      } catch {}
      setTimeout(() => {
        try {
          if (child.pid && !done) process.kill(-child.pid, "SIGKILL")
        } catch {}
      }, 2000).unref()
    }
    const collect = (chunk: Buffer) => {
      output += chunk.toString("utf8")
      if (output.length > limit) output = output.slice(-limit)
    }
    child.stdout.on("data", collect)
    child.stderr.on("data", collect)
    const timer = setTimeout(() => {
      timedOut = true
      kill()
    }, options.timeoutMs ?? 60_000)
    const onAbort = () => {
      aborted = true
      kill()
    }
    if (options.signal?.aborted) onAbort()
    else options.signal?.addEventListener("abort", onAbort, { once: true })
    const finish = (exitCode: number | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      options.signal?.removeEventListener("abort", onAbort)
      resolvePromise({ exitCode, output: clipOutput(redactSecrets(output), options.maxOutput), timedOut, aborted })
    }
    child.on("error", (error) => {
      output += String(error.message)
      finish(127)
    })
    child.on("close", (code) => finish(code))
    child.stdin.on("error", () => {})
    child.stdin.end(options.input ?? "")
  })
}
