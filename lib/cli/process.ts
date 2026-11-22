import { spawn } from "node:child_process"

import { CliError, type CliSpawn, type ProcessRunner } from "./types.ts"
import { recordAgyVerification } from "./verification.ts"

// Startet die CLI, schreibt den Prompt auf Stdin und liefert die Zeilen der Standardausgabe.
// Abbruch (signal) beendet den Prozess (SIGTERM, nach 3 s SIGKILL). Leerlauf-Grenze: keine Ausgabe für `timeoutMs` = Zeitüberschreitung.
export const runProcess: ProcessRunner = async function* (job: CliSpawn, options) {
  const child = spawn(job.command, job.args, { cwd: job.cwd, env: job.env, stdio: ["pipe", "pipe", "pipe"] })
  const provider = job.command.includes("agy") ? "agy" : job.command.includes("codex") ? "codex" : job.command.includes("gemini") ? "gemini" : "claude"
  let stderr = ""
  child.stderr.on("data", (chunk: Buffer) => {
    if (stderr.length < 4000) stderr += chunk.toString("utf8")
  })
  let spawnError: Error | undefined
  child.on("error", (error) => (spawnError = error))
  let timedOut = false
  let aborted = false
  let idle: ReturnType<typeof setTimeout> | undefined
  const kill = () => {
    if (child.exitCode !== null || child.killed) return
    child.kill("SIGTERM")
    setTimeout(() => child.exitCode === null && child.kill("SIGKILL"), 3_000).unref()
  }
  const arm = () => {
    if (idle) clearTimeout(idle)
    idle = setTimeout(() => {
      timedOut = true
      kill()
    }, options.timeoutMs)
    idle.unref?.()
  }
  const onAbort = () => {
    aborted = true
    kill()
  }
  if (options.signal?.aborted) onAbort()
  else options.signal?.addEventListener("abort", onAbort, { once: true })
  child.stdin.on("error", () => {})
  child.stdin.end(job.stdin)
  arm()
  const closed = new Promise<number | null>((resolve) => child.on("close", (code) => resolve(code)))
  try {
    let buffer = ""
    let agySuccess = false
    const observe = (line: string) => {
      if (provider !== "agy") return
      try {
        const event = JSON.parse(line) as { event?: string; result?: { status?: string } }
        if (event.event === "result") agySuccess = event.result?.status === "SUCCESS"
      } catch { /* Nicht jede CLI-Zeile ist JSON. */ }
    }
    for await (const chunk of child.stdout) {
      arm()
      buffer += (chunk as Buffer).toString("utf8")
      let index: number
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        if (line.trim()) { observe(line); yield line }
      }
    }
    if (buffer.trim()) { observe(buffer); yield buffer }
    const code = await closed
    if (aborted) throw new CliError(provider, "aborted", "Abgebrochen.")
    if (timedOut) throw new CliError(provider, "timeout", "Zeitüberschreitung: Die CLI hat nicht rechtzeitig geantwortet.")
    if (spawnError) throw new CliError(provider, "failed", "Die CLI konnte nicht gestartet werden.")
    // Ein Exit-Code ungleich 0 ohne eigene Fehlermeldung in der Ausgabe: Stderr-Anfang (ohne Pfade/Werte) als Hinweis.
    if (provider === "agy") recordAgyVerification(code === 0 && agySuccess)
    if (code !== 0) throw new CliError(provider, "failed", `Die CLI wurde mit Fehler beendet (Code ${code}).${provider === "agy" ? "" : ` ${stderr.trim().split("\n")[0]?.slice(0, 200) ?? ""}`}`.trim())
  } finally {
    if (idle) clearTimeout(idle)
    options.signal?.removeEventListener("abort", onAbort)
    kill()
  }
}
