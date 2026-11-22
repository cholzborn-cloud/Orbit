import type { LanguageModelV4Middleware, LanguageModelV4StreamPart } from "@ai-sdk/provider"
import type { ToolSet } from "ai"

const MAX_TOOL_BYTES = 4 * 1024 * 1024
const MAX_TOOL_PARTS = 4096
const MAX_TOOL_CALLS = 128
const DEFERRED = "Nicht ausgeführt: Prüfe diesen Aufruf nach dem Modellwechsel erneut."

// Ein Gate gehört zu genau einem Turn; die geschützten Werkzeuge bleiben ansonsten unverändert.
export function createUpgradeGate(): { middleware: LanguageModelV4Middleware; protect: (tools: ToolSet) => ToolSet } {
  const deferred = new Set<string>()
  const middleware: LanguageModelV4Middleware = {
    specificationVersion: "v4",
    async wrapStream({ doStream, params }) {
      deferred.clear()
      const result = await doStream()
      const calls: Extract<LanguageModelV4StreamPart, { type: "tool-call" }>[] = []
      const toolParts: LanguageModelV4StreamPart[] = []
      let failed = false
      let toolBytes = 0
      const stream = result.stream.pipeThrough(new TransformStream<LanguageModelV4StreamPart, LanguageModelV4StreamPart>({
        transform(part, controller) {
          if (part.type === "tool-input-start" || part.type === "tool-input-delta" || part.type === "tool-input-end" || part.type === "tool-call") {
            if (failed) return
            try { toolBytes += Buffer.byteLength(JSON.stringify(part), "utf8") } catch { toolBytes = MAX_TOOL_BYTES + 1 }
            if (toolBytes > MAX_TOOL_BYTES || toolParts.length >= MAX_TOOL_PARTS || (part.type === "tool-call" && calls.length >= MAX_TOOL_CALLS)) {
              failed = true
              calls.length = 0
              toolParts.length = 0
              controller.enqueue({ type: "error", error: new Error("Werkzeugaufrufe überschreiten die zulässige Größe.") })
              return
            }
            if (part.type === "tool-call") calls.push(part)
            toolParts.push(part)
            return
          }
          if (part.type === "error") {
            failed = true
            calls.length = 0
            toolParts.length = 0
          }
          if (part.type === "finish") {
            const ids = new Set(calls.map((call) => call.toolCallId))
            if (!failed && !params.abortSignal?.aborted && ids.size === calls.length && (part.finishReason.unified === "stop" || part.finishReason.unified === "tool-calls")) {
              if (calls.some((call) => call.toolName === "upgrade_model"))
                for (const call of calls) if (call.toolName !== "upgrade_model") deferred.add(call.toolCallId)
              for (const item of toolParts) controller.enqueue(item)
            } else if (!failed && calls.length && ids.size !== calls.length) {
              controller.enqueue({ type: "error", error: new Error("Doppelte Werkzeugaufruf-ID.") })
            }
          }
          controller.enqueue(part)
        },
      }))
      return { ...result, stream }
    },
  }

  return {
    middleware,
    protect(tools) {
      return Object.fromEntries(Object.entries(tools).map(([name, original]) => {
        if (name === "upgrade_model") return [name, original]
        const execute = original.execute as ((input: unknown, options: { toolCallId: string }) => unknown) | undefined
        const needsApproval = original.needsApproval
        return [name, {
          ...original,
          ...(original.onInputStart && { onInputStart: (options: { toolCallId: string }) => deferred.has(options.toolCallId) ? undefined : original.onInputStart!(options as never) }),
          ...(original.onInputDelta && { onInputDelta: (options: { toolCallId: string }) => deferred.has(options.toolCallId) ? undefined : original.onInputDelta!(options as never) }),
          ...(original.onInputAvailable && { onInputAvailable: (options: { toolCallId: string }) => deferred.has(options.toolCallId) ? undefined : original.onInputAvailable!(options as never) }),
          needsApproval: typeof needsApproval === "function"
            ? (input: unknown, options: { toolCallId: string }) => deferred.has(options.toolCallId) ? false : needsApproval(input as never, options as never)
            : needsApproval === true
              ? (_input: unknown, options: { toolCallId: string }) => !deferred.has(options.toolCallId)
              : needsApproval,
          ...(execute && { execute: (input: unknown, options: { toolCallId: string }) => deferred.has(options.toolCallId)
            ? { error: DEFERRED, upgradeDeferred: true }
            : execute(input, options) }),
          toModelOutput: (options: { toolCallId: string; output: unknown }) => {
            const output = options.output as { upgradeDeferred?: unknown; error?: unknown } | null
            if (output?.upgradeDeferred === true && output.error === DEFERRED) return { type: "error-text", value: DEFERRED }
            return original.toModelOutput ? original.toModelOutput(options as never) : typeof options.output === "string"
              ? { type: "text", value: options.output }
              : { type: "json", value: options.output }
          },
        }]
      })) as ToolSet
    },
  }
}
