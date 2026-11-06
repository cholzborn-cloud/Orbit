import { prepareCodexHome, prepareGeminiSettings, workdirFor } from "./workdir.ts"
import { cliEnv, findBinary } from "./locate.ts"
import { CliError, loginError, missingError, type CliEvent, type CliProvider, type CliRun, type CliSpawn, type CliUsage } from "./types.ts"

// Ein Adapter baut den Aufruf der CLI und liest ihre Ausgabe zu CliEvents. Alle CLI-eigenen Werkzeuge sind aus; Orbit-Werkzeuge
// laufen über das Textprotokoll in tool-protocol.ts und werden von Orbit selbst (mit Freigaben) ausgeführt.
export type Adapter = {
  build(run: CliRun): CliSpawn
  // Liest eine Ausgabezeile; Zustand pro Aufruf (z. B. ob schon Text kam).
  parser(): (line: string) => CliEvent[]
}

const LOGIN = /not logged in|please run \/?login|log ?in|unauthori[sz]ed|invalid (api )?key|authentication|credentials|\b401\b|expired/i
const LIMIT = /usage limit|rate.?limit|too many requests|\b429\b|overloaded|quota/i

export function classify(provider: CliProvider, message: string): CliEvent {
  const text = message.trim().slice(0, 300) || "Unbekannter Fehler."
  if (LIMIT.test(text)) return { kind: "error", code: "limit", message: `Das Limit von ${provider === "codex" ? "GPT (Codex)" : provider === "gemini" || provider === "agy" ? "Gemini" : "Claude"} ist erreicht oder der Anbieter ist überlastet. Warte kurz oder wähle ein anderes Modell.` }
  if (LOGIN.test(text)) {
    const error = loginError(provider)
    return { kind: "error", code: "login", message: error.message }
  }
  return { kind: "error", code: "failed", message: `Das Modell hat nicht geantwortet: ${text}` }
}

const parse = (line: string): Record<string, any> | undefined => {
  try {
    const value = JSON.parse(line)
    return value && typeof value === "object" ? value : undefined
  } catch {
    return undefined
  }
}

const binary = (provider: CliProvider) => {
  const path = findBinary(provider)
  if (!path) throw missingError(provider)
  return path
}

// ---- Claude ----
// Flags: --tools "" (keine eingebauten Werkzeuge), --safe-mode + --setting-sources "" (keine Einstellungen, Hooks, Skills, CLAUDE.md,
// Auto-Memory), --strict-mcp-config mit leerer Liste (kein MCP), --system-prompt ersetzt den langen Standard-Prompt, keine Sitzung speichern.
// Gemessen (02.11.2026, „ok“-Turn): ca. 830 Eingabe-Token statt 63 000 im Repo-Ordner. --bare entfällt: es liest keinen Abo-Login.
export const claudeAdapter: Adapter = {
  build(run) {
    const command = binary("claude")
    const args = [
      "-p",
      "--model", run.model,
      "--system-prompt", run.system,
      "--tools", "",
      "--safe-mode",
      "--strict-mcp-config", "--mcp-config", '{"mcpServers":{}}',
      "--setting-sources", "",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--include-partial-messages",
      "--verbose",
      ...(run.effort ? ["--effort", run.effort] : []),
    ]
    const content = [
      ...run.images.map((image) => ({ type: "image", source: { type: "base64", media_type: image.mediaType, data: image.base64 } })),
      { type: "text", text: run.user },
    ]
    const stdin = JSON.stringify({ type: "user", message: { role: "user", content } }) + "\n"
    return { command, args, stdin, cwd: workdirFor("claude"), env: cliEnv(command) }
  },
  parser() {
    let sawText = false
    return (line) => {
      const event = parse(line)
      if (!event) return []
      if (event.type === "stream_event" && !event.parent_tool_use_id) {
        const delta = event.event?.type === "content_block_delta" ? event.event.delta : undefined
        if (delta?.type === "text_delta" && typeof delta.text === "string" && delta.text) {
          sawText = true
          return [{ kind: "text", delta: delta.text }]
        }
        return []
      }
      if (event.type === "result") {
        if (event.is_error) return [classify("claude", String(event.result ?? event.subtype ?? ""))]
        const usage = event.usage ?? {}
        const noCache = Number(usage.input_tokens ?? 0)
        const cacheRead = Number(usage.cache_read_input_tokens ?? 0)
        const cacheWrite = Number(usage.cache_creation_input_tokens ?? 0)
        const out: CliEvent[] = []
        if (!sawText && typeof event.result === "string" && event.result) out.push({ kind: "text", delta: event.result })
        out.push({
          kind: "usage",
          usage: {
            input: noCache + cacheRead + cacheWrite,
            noCache,
            cacheRead,
            cacheWrite,
            output: Number(usage.output_tokens ?? 0),
            reasoning: Number(usage.output_tokens_details?.thinking_tokens ?? 0) || undefined,
          },
        })
        out.push({ kind: "done" })
        return out
      }
      return []
    }
  },
}

// ---- Codex ----
const CODEX_EFFORT: Record<string, string> = { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "xhigh" }
// Eigener CODEX_HOME (schlanke Konfiguration, Anmeldung per Verknüpfung), Shell/Plugins/Hooks/Web aus, Sandbox read-only, neutraler Ordner.
// Rest-Overhead der Codex-Basis ca. 14 000 Eingabe-Token je Aufruf (gemessen); ein Abo-Aufruf, kein Geld.
export const codexAdapter: Adapter = {
  build(run) {
    const command = binary("codex")
    const cwd = workdirFor("codex")
    const home = prepareCodexHome()
    const effort = run.effort ? CODEX_EFFORT[run.effort] : undefined
    const args = [
      "exec", "--json", "--ephemeral", "--skip-git-repo-check",
      "-s", "read-only",
      "-C", cwd,
      "-m", run.model,
      ...(effort ? ["-c", `model_reasoning_effort="${effort}"`] : []),
      "-",
    ]
    const stdin = `${run.system ? `<system>\n${run.system}\n</system>\n\n` : ""}${run.user}`
    return { command, args, stdin, cwd, env: cliEnv(command, { CODEX_HOME: home }) }
  },
  parser() {
    let failure: string | undefined
    return (line) => {
      const event = parse(line)
      if (!event) return []
      if (event.type === "item.completed" && event.item?.type === "agent_message" && typeof event.item.text === "string")
        return [{ kind: "text", delta: event.item.text }]
      if (event.type === "turn.completed") {
        const usage = event.usage ?? {}
        const input = Number(usage.input_tokens ?? 0)
        const cacheRead = Number(usage.cached_input_tokens ?? 0)
        return [
          {
            kind: "usage",
            usage: {
              input,
              noCache: Math.max(0, input - cacheRead),
              cacheRead,
              cacheWrite: Number(usage.cache_write_input_tokens ?? 0) || undefined,
              output: Number(usage.output_tokens ?? 0),
              reasoning: Number(usage.reasoning_output_tokens ?? 0) || undefined,
            },
          },
          { kind: "done" },
        ]
      }
      if (event.type === "turn.failed") return [classify("codex", String(event.error?.message ?? failure ?? ""))]
      if (event.type === "error" && typeof event.message === "string" && !/^Reconnecting/i.test(event.message)) failure = event.message
      return []
    }
  },
}

// ---- Gemini (UNGEPRÜFT: auf diesem Mac nicht installiert; Flags und Ausgabeformat nach der Doku, bei der Installation zu prüfen) ----
export const geminiAdapter: Adapter = {
  build(run) {
    const command = binary("gemini")
    const cwd = workdirFor("gemini")
    const args = ["-m", run.model, "-o", "stream-json", "--approval-mode", "default", "-p", "Antworte auf den Text, der dir übergeben wird."]
    const stdin = `${run.system ? `<system>\n${run.system}\n</system>\n\n` : ""}${run.user}`
    return { command, args, stdin, cwd, env: cliEnv(command, { GEMINI_CLI_SYSTEM_SETTINGS_PATH: prepareGeminiSettings() }) }
  },
  parser() {
    return (line) => {
      const event = parse(line)
      if (!event) return []
      if (event.type === "message" && event.role === "assistant" && typeof event.content === "string") return [{ kind: "text", delta: event.content }]
      if (event.type === "result") {
        if (event.status && event.status !== "success") return [classify("gemini", String(event.error?.message ?? event.status))]
        const stats = event.stats ?? {}
        const usage: CliUsage = {
          input: Number(stats.input_tokens ?? stats.input ?? 0),
          cacheRead: Number(stats.cached ?? 0) || undefined,
          output: Number(stats.output_tokens ?? 0),
        }
        return [{ kind: "usage", usage }, { kind: "done" }]
      }
      return []
    }
  },
}

// Orbit führt Werkzeuge selbst nach seinen Freigaberegeln aus; native CLI-Aktionen werden gesperrt.
const AGY_SETTINGS = JSON.stringify({ permissions: { deny: ["read_file(*)", "write_file(*)", "read_url(*)", "execute_url(*)", "command(*)", "mcp(*)"] }, toolPermission: "strict" })
export const agyAdapter: Adapter = {
  build(run) {
    const command = binary("agy")
    const prompt = `${run.system ? `<system>\n${run.system}\n</system>\n\n` : ""}${run.user}`
    return {
      command,
      args: ["--input-format", "stream-json", "--output-format", "stream-json", "--model", run.model, "--sandbox", "--settings", AGY_SETTINGS, "--disable-slash-commands", "--print-timeout", "300s"],
      stdin: JSON.stringify({ event: "user", message: { content: prompt } }) + "\n",
      cwd: workdirFor("agy"),
      env: cliEnv(command),
    }
  },
  parser() {
    let sawText = false
    return (line) => {
      const event = parse(line)
      if (!event) return []
      if (event.event === "step_update" && event.step_update?.step_type === "agent_response" && typeof event.step_update.text_delta === "string") {
        sawText = true
        return [{ kind: "text", delta: event.step_update.text_delta }]
      }
      if (event.event === "result") {
        const result = event.result ?? {}
        if (result.status !== "SUCCESS") {
          const reason = String(result.error ?? result.status ?? "")
          if (/timeout|time.?out|zeitüberschreitung/i.test(reason)) return [{ kind: "error", code: "timeout", message: "Antigravity hat nicht rechtzeitig geantwortet." }]
          const error = classify("agy", reason)
          return [error.kind === "error" && error.code === "failed" ? { kind: "error", code: "failed", message: "Antigravity hat nicht geantwortet." } : error]
        }
        const usage = result.usage ?? {}
        const out: CliEvent[] = []
        if (!sawText && typeof result.response === "string" && result.response) out.push({ kind: "text", delta: result.response })
        const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined
        const input = count(usage.input_tokens), reportedCache = count(usage.cache_read_tokens)
        const cacheRead = input !== undefined && reportedCache !== undefined && reportedCache > input ? undefined : reportedCache
        const output = count(usage.output_tokens), reasoning = count(usage.thinking_tokens)
        const noCache = input !== undefined && cacheRead !== undefined ? input - cacheRead : undefined
        if (input !== undefined || cacheRead !== undefined || output !== undefined || reasoning !== undefined)
          out.push({ kind: "usage", usage: { input, noCache, cacheRead, output, reasoning } })
        out.push({ kind: "done" })
        return out
      }
      return []
    }
  },
}

export const ADAPTERS: Record<CliProvider, Adapter> = { claude: claudeAdapter, codex: codexAdapter, gemini: geminiAdapter, agy: agyAdapter }
export { CliError }
