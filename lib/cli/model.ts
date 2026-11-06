import type { LanguageModelV4, LanguageModelV4CallOptions, LanguageModelV4StreamPart, LanguageModelV4Usage } from "@ai-sdk/provider"

import { CHAT_MODELS } from "../chat-catalog.ts"
import { ADAPTERS } from "./adapters.ts"
import { runProcess } from "./process.ts"
import { renderPrompt } from "./prompt.ts"
import { createLoopGuard } from "./loop-guard.ts"
import { createCallParser } from "./tool-protocol.ts"
import { CliError, type CliEvent, type CliProvider, type CliUsage, type ProcessRunner } from "./types.ts"

// Wirft die Zeilen einer CLI-Ausgabe durch den Adapter. Austauschbar für Tests (kein echter Prozess).
export type CliDeps = { runner: ProcessRunner; timeoutMs: number }
export const cliDeps: CliDeps = { runner: runProcess, timeoutMs: Number(process.env.ORBIT_CLI_TIMEOUT_MS) || 300_000 }

const toUsage = (usage: CliUsage | undefined): LanguageModelV4Usage => ({
  inputTokens: { total: usage?.input, noCache: usage?.noCache, cacheRead: usage?.cacheRead, cacheWrite: usage?.cacheWrite },
  outputTokens: { total: usage?.output, text: usage?.output === undefined ? undefined : Math.max(0, usage.output - (usage.reasoning ?? 0)), reasoning: usage?.reasoning },
})

export function cliTarget(modelId: string): { provider: CliProvider; model: string } {
  const entry = CHAT_MODELS.find((model) => model.id === modelId)
  if (!entry) throw new Error("Unbekanntes Modell")
  return entry.cli
}

const effortOf = (options: LanguageModelV4CallOptions): string | undefined => {
  const po = options.providerOptions as Record<string, Record<string, unknown>> | undefined
  const value = po?.cli?.effort ?? po?.openai?.reasoningEffort
  return typeof value === "string" ? value : undefined
}

// Eine Modellstufe = ein CLI-Aufruf (kein Verlauf in der CLI, kein Werkzeug in der CLI). Die Werkzeugschleife bleibt in Orbit (streamText).
export function cliModel(modelId: string, deps: CliDeps = cliDeps): LanguageModelV4 {
  const target = cliTarget(modelId)
  const adapter = ADAPTERS[target.provider]

  async function* events(options: LanguageModelV4CallOptions, onRendered?: (dropped: number) => void): AsyncGenerator<CliEvent> {
    const tools = (options.tools ?? []) as { type: string; name?: string; description?: string; inputSchema?: unknown }[]
    const rendered = renderPrompt(options.prompt, tools as never, { images: target.provider === "claude" })
    onRendered?.(rendered.droppedFiles)
    const spawn = adapter.build({
      provider: target.provider,
      model: target.model,
      effort: effortOf(options),
      system: rendered.system,
      user: rendered.user,
      images: rendered.images,
      signal: options.abortSignal,
    })
    const parse = adapter.parser()
    const guard = createLoopGuard()
    // Ein throw hier beendet den Prozess (finally im Runner).
    for await (const line of deps.runner(spawn, { signal: options.abortSignal, timeoutMs: deps.timeoutMs })) {
      for (const event of parse(line)) {
        const stop = event.kind === "text" ? guard(event.delta) : undefined
        if (stop) throw new CliError(target.provider, "failed", stop)
        yield event
      }
    }
  }

  const known = (options: LanguageModelV4CallOptions) => {
    const names = new Set((options.tools ?? []).flatMap((tool) => (tool.type === "function" ? [tool.name] : [])))
    return (name: string) => names.has(name)
  }

  const fail = (event: Extract<CliEvent, { kind: "error" }>) => new CliError(target.provider, event.code, event.message)

  return {
    specificationVersion: "v4",
    provider: `cli.${target.provider}`,
    modelId,
    supportedUrls: {},
    async doGenerate(options) {
      const parser = createCallParser(known(options))
      const content: Array<{ type: "text"; text: string } | { type: "tool-call"; toolCallId: string; toolName: string; input: string }> = []
      let usage: CliUsage | undefined
      let n = 0
      const push = (out: ReturnType<typeof parser.feed>) => {
        for (const item of out) {
          // Kaputte Aufrufblöcke sind Rohdaten: nie in den Chat.
          if (item.type === "bad") continue
          if (item.type === "text") content.push({ type: "text", text: item.text })
          else content.push({ type: "tool-call", toolCallId: `cli-${Date.now().toString(36)}-${n++}`, toolName: item.call.name, input: JSON.stringify(item.call.input) })
        }
      }
      for await (const event of events(options)) {
        if (event.kind === "error") throw fail(event)
        if (event.kind === "text") push(parser.feed(event.delta))
        else if (event.kind === "usage") usage = event.usage
      }
      push(parser.end())
      const calls = content.some((part) => part.type === "tool-call")
      return { content, finishReason: { unified: calls ? "tool-calls" : "stop", raw: undefined }, usage: toUsage(usage), warnings: [] }
    },
    async doStream(options) {
      const parser = createCallParser(known(options))
      let textOpen = false
      let textId = 0
      let calls = 0
      let usage: CliUsage | undefined
      const stream = new ReadableStream<LanguageModelV4StreamPart>({
        async start(controller) {
          const closeText = () => {
            if (textOpen) controller.enqueue({ type: "text-end", id: String(textId++) })
            textOpen = false
          }
          const emit = (out: ReturnType<typeof parser.feed>) => {
            for (const item of out) {
              if (item.type === "bad") continue // kaputter Aufrufblock: Rohdaten, nie in den Chat
              if (item.type === "text") {
                const text = item.text
                if (!text) continue
                if (!textOpen) {
                  controller.enqueue({ type: "text-start", id: String(textId) })
                  textOpen = true
                }
                controller.enqueue({ type: "text-delta", id: String(textId), delta: text })
              } else {
                closeText()
                controller.enqueue({ type: "tool-call", toolCallId: `cli-${Date.now().toString(36)}-${calls++}`, toolName: item.call.name, input: JSON.stringify(item.call.input) })
              }
            }
          }
          controller.enqueue({ type: "stream-start", warnings: [] })
          try {
            for await (const event of events(options)) {
              if (event.kind === "error") throw fail(event)
              if (event.kind === "text") emit(parser.feed(event.delta))
              else if (event.kind === "usage") usage = event.usage
            }
            emit(parser.end())
            closeText()
            controller.enqueue({ type: "finish", finishReason: { unified: calls ? "tool-calls" : "stop", raw: undefined }, usage: toUsage(usage) })
          } catch (error) {
            controller.enqueue({ type: "error", error })
            controller.enqueue({ type: "finish", finishReason: { unified: "error", raw: undefined }, usage: toUsage(usage) })
          }
          controller.close()
        },
      })
      return { stream }
    },
  }
}
