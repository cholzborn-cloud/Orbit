import { tool, type ToolSet } from "ai"

import type { ApprovalMode } from "./rules.ts"
import {
  approvalExecute,
  approvalNeedsApproval,
  type ApprovalRequestStore,
} from "./request.ts"

export function withApproval<T extends ToolSet[string]>(
  original: T,
  config: {
    name: string
    // Je Aufruf: die Regel hängt vom Befehl ab (rm fragt, ls nicht).
    decide: (input: unknown) => ApprovalMode
    userId: string
    automationRunId?: string
    deniedOutput?: unknown // Ergebnis statt Fehler, wenn Consti ablehnt (confirm_action)
    waitForApproval?: (
      input: unknown,
      options: { toolCallId: string }
    ) => Promise<boolean>
    store: ApprovalRequestStore
  }
): T {
  // Entscheidung je Aufruf merken, damit needsApproval und execute dasselbe sehen.
  const decided = new Map<string, ApprovalMode>()
  const decide = (input: unknown, toolCallId: string) => {
    if (!decided.has(toolCallId)) decided.set(toolCallId, config.decide(input))
    return decided.get(toolCallId)!
  }
  const denied = { error: "denied by user" }
  return tool({
    ...original,
    needsApproval: config.waitForApproval
      ? false
      : async (input: unknown, options: { toolCallId: string }) =>
          approvalNeedsApproval(config.store, {
            required: decide(input, options.toolCallId) === "ask",
            toolCallId: options.toolCallId,
            userId: config.userId,
            tool: config.name,
            automationRunId: config.automationRunId,
          })(),
    execute: config.waitForApproval
      ? async function* (input: unknown, options: { toolCallId: string }) {
          const mode = decide(input, options.toolCallId)
          decided.delete(options.toolCallId)
          if (mode === "deny") {
            yield denied
            return
          }
          const required = mode === "ask"
          if (required && !(await config.waitForApproval!(input, options))) {
            yield config.deniedOutput ?? {
              error: "Freigabe abgelehnt, abgelaufen oder abgebrochen.",
            }
            return
          }
          const result = await approvalExecute(
            config.store,
            options.toolCallId,
            config.userId,
            required,
            Date.now(),
            () => original.execute?.(input, options as never)
          )
          if (
            result &&
            typeof result === "object" &&
            Symbol.asyncIterator in result
          ) {
            yield* result as AsyncIterable<unknown>
          } else {
            yield result
          }
        }
      : async (input: unknown, options: { toolCallId: string }) => {
          const mode = decide(input, options.toolCallId)
          decided.delete(options.toolCallId)
          if (mode === "deny") return denied
          return approvalExecute(
            config.store,
            options.toolCallId,
            config.userId,
            mode === "ask",
            Date.now(),
            () => original.execute?.(input, options as never)
          )
        },
  }) as T
}
