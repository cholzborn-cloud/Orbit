import { tool, type ToolSet } from "ai"
import { nanoid } from "nanoid"
import type { PluginActionRunner } from "../plugins"

import catalog from "@/connectors/catalog.json"
import { defaultSql, type ChatContext } from "../../../lib/chat/load-chat.ts"
import { ASK_USER, type AskUserOutput } from "../../../lib/chat/ask-user.ts"
import { CONFIRM_ACTION } from "../../../lib/chat/confirm-action.ts"
import { withConstiSaid } from "../../../lib/approvals/consti-said.ts"
import { mayAsk, type ToolMeta } from "../../../lib/approvals/risk.ts"
import {
  resolveApproval,
  type ApprovalRule,
} from "../../../lib/approvals/rules.ts"
import type { ApprovalRequestStore } from "../../../lib/approvals/request.ts"
import {
  catalogOverride,
  parseConnectorCatalog,
} from "../../../lib/connectors/catalog.ts"
import {
  connectorToolOrigin,
  isConnectorStatusTool,
} from "../../../lib/connectors/client"
import { withApproval } from "../../../lib/approvals/with-approval.ts"

import {
  InteractionManager,
  type PendingInteraction,
  type InteractionDecision,
} from "../interactions.ts"

export function createApprovalStore(): ApprovalRequestStore {
  const sql = defaultSql()
  return {
    create: async (request) => {
      await sql`delete from approval_requests where requested_at < (unixepoch('subsecond') * 1000 - 604800000)`
      await sql`insert into approval_requests (tool_call_id, user_id, tool, automation_run_id) values (${request.toolCallId}, ${"local"}, ${request.tool}, ${request.automationRunId ?? null}) on conflict (user_id, tool_call_id) do update set requested_at = (unixepoch('subsecond') * 1000), tool = excluded.tool, automation_run_id = excluded.automation_run_id`
      const [row] =
        (await sql`select requested_at as "requestedAt" from approval_requests where tool_call_id = ${request.toolCallId} and user_id = ${"local"}`) as {
          requestedAt: number | Date
        }[]
      if (!row) throw new Error("Freigabe konnte nicht gespeichert werden.")
      return row.requestedAt
    },
    get: async (toolCallId) => {
      const [row] =
        (await sql`select requested_at as "requestedAt" from approval_requests where tool_call_id = ${toolCallId} and user_id = ${"local"}`) as {
          requestedAt: number | Date
        }[]
      return row?.requestedAt ?? null
    },
  }
}

// „Immer für diese Art“: gespeichert wird die Art (z. B. bash:loeschen), nicht das ganze Werkzeug.
export async function saveAlwaysRule(request: PendingInteraction) {
  // Erst hier laden: das Modul öffnet beim Import die Datenbank.
  const { saveRule } = await import("../../../query/approvals")
  await saveRule({
    id: nanoid(),
    userId: "local",
    botId: request.botId,
    tool: request.approvalKind ?? request.tool,
    mode: "allow",
  })
}

const parsedCatalog = parseConnectorCatalog(catalog)
const catalogEntries = parsedCatalog.success ? parsedCatalog.data : []

function connectorMeta(original: object): ToolMeta | undefined {
  const origin = connectorToolOrigin(original)
  if (!origin) return undefined
  return {
    connectorName: origin.connectorName,
    mcpName: origin.mcpName,
    readOnlyHint: origin.readOnlyHint,
    destructiveHint: origin.destructiveHint,
    override: origin.override ?? catalogOverride(catalogEntries, origin.connectorUrl),
  }
}

type ProtectOptions = {
  chatId: string
  ctx: ChatContext
  // Constis letzte Nachricht; fehlt bei Übergaben und Automationen, dann gilt kein consti_said.
  lastUserText?: string
  // Geweckter Orbi mit anderem Root-Chat: Karten tragen Root und Absender, damit Consti sie dort beantwortet.
  route?: Pick<PendingInteraction, "root" | "from">
  rules: ApprovalRule[] | undefined
  manager: InteractionManager
  store: ApprovalRequestStore
  signal: AbortSignal
  onAnswer?: (id: string, input: unknown, answer: AskUserOutput) => void
  onApproval: (request: PendingInteraction) => Promise<void>
  onDecision: (
    request: PendingInteraction,
    result: InteractionDecision
  ) => void | Promise<void>
}

export function protectTools(set: ToolSet, options: ProtectOptions): ToolSet {
  const { ctx, manager, store, signal } = options
  // „Immer“ wirkt noch im selben Turn: neue Regeln kommen hier dazu.
  const rules = options.rules ? [...options.rules] : undefined
  return Object.fromEntries(
    Object.entries(set).map(([name, original]) => {
      if (isConnectorStatusTool(original)) return [name, original]
      const connector = /^connector_(.+)__(.+)$/.exec(name)
      const meta = connectorMeta(original)
      const approvalName = connector
        ? `connector:${connector[1]}:${connector[2]}`
        : name
      const decide = (input: unknown) =>
        resolveApproval(rules, {
          tool: approvalName,
          botId: ctx.speaker.id,
          input,
          meta,
          lastUserText: options.lastUserText,
        })
      const ask =
        name === ASK_USER
          ? tool({
              ...original,
              execute: async (input, call): Promise<AskUserOutput> => {
                const result = await manager.wait(
                  {
                    kind: "ask",
                    chatId: options.chatId,
                    botId: ctx.speaker.id,
                    toolCallId: call.toolCallId,
                    tool: ASK_USER,
                    input,
                    ...options.route,
                  },
                  signal
                )
                const answer = result.status === "answered" ? result.answer : { skipped: true as const }
                options.onAnswer?.(call.toolCallId, input, answer)
                return answer
              },
            })
          : mayAsk(approvalName)
            ? withConstiSaid(original)
            : original
      return [
        name,
        withApproval(ask, {
          name: approvalName,
          decide: (input) => decide(input).mode,
          userId: "local",
          store,
          ...(name === CONFIRM_ACTION && { deniedOutput: { approved: false } }),
          waitForApproval: async (input, call) => {
            const { risk } = decide(input)
            let request: PendingInteraction | undefined
            let announced = Promise.resolve()
            const result = await manager.wait(
              {
                kind: "approval",
                chatId: options.chatId,
                botId: ctx.speaker.id,
                toolCallId: call.toolCallId,
                tool: approvalName,
                input,
                ...options.route,
                ...(risk.ask && {
                  reason: risk.reason,
                  approvalKind: risk.kind,
                  text: risk.text,
                  ...(risk.detail && { detail: risk.detail }),
                }),
              },
              signal,
              (value) => {
                request = value
                announced = options.onApproval(value)
                return announced
              }
            )
            if (signal.aborted) return false
            await new Promise<void>((resolve, reject) => {
              const onAbort = () => resolve()
              signal.addEventListener("abort", onAbort, { once: true })
              void announced
                .then(resolve, reject)
                .finally(() => signal.removeEventListener("abort", onAbort))
            })
            if (signal.aborted) return false
            if (request) await options.onDecision(request, result)
            if (result.status === "approved" && result.always && risk.ask)
              rules?.push({ tool: risk.kind, botId: ctx.speaker.id, mode: "allow" })
            return result.status === "approved" && !signal.aborted
          },
        }),
      ]
    })
  )
}

// Gateways never confer generic authorization. Decide on the concrete action and its real arguments.
export function createPluginActionRunner(options: ProtectOptions): PluginActionRunner {
  return async (name, original, input, call) => {
    const { consti_said: quote, ...args } = input
    // Gateway quotes must also name every concrete argument; generic approval cannot cover hidden values.
    const normalize = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim()
    const leaves = (value: unknown): string[] => typeof value === "string" || typeof value === "number" || typeof value === "boolean" ? [String(value)] : value && typeof value === "object" ? Object.values(value).flatMap(leaves) : []
    const values = leaves(args).filter(Boolean)
    const covered = typeof quote === "string" && values.length > 0 && values.every(value => normalize(quote).includes(normalize(value)))
    const checkedInput = { ...args, ...(covered ? { consti_said: quote } : {}) }
    const guarded = protectTools({ [name]: original }, options)[name]
    if (!guarded?.execute) return { error: "Plugin-Freigabeprüfung ist nicht verfügbar." }
    const output = await guarded.execute(checkedInput, call)
    if (output && typeof output === "object" && Symbol.asyncIterator in output) {
      let final: unknown
      for await (const value of output as AsyncIterable<unknown>) final = value
      return final
    }
    return output
  }
}
