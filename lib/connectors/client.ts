import { createMCPClient, type MCPClient } from "@ai-sdk/mcp"
import { tool, type ToolSet } from "ai"
import { request as httpsRequest } from "node:https"
import { Readable } from "node:stream"
import { z } from "zod"

import { resolveConnectorUrl } from "./url-guard.ts"

export type Connector = {
  id: string
  name: string
  url: string
  token?: string | null
  header?: string | null
}

export type ConnectorToolInfo = {
  name: string
  write: boolean
  readOnlyHint?: boolean
  destructiveHint?: boolean
}
const TIMEOUT = 10_000
const LIMIT = 20_000
// Grenze gegen Speicherflut; Screenshots (Base64) und Dokumente brauchen mehr als 1 MB.
const MAX_RESPONSE_BYTES = 8 * 1024 * 1024
const TOO_LARGE = "MCP-Antwort ist zu groß."
// Pro Konnektor im Chat-Turn: ein langsamer Konnektor soll gesunde nicht verdrängen.
export const CONNECTOR_LOAD_MS = 3_000
const MAX_TOOLS = 100

export function limitResponseBody(
  body: ReadableStream<Uint8Array>,
  limit = MAX_RESPONSE_BYTES,
  abort?: (error: Error) => void
) {
  const reader = body.getReader()
  let received = 0
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          controller.close()
          return
        }
        received += value.byteLength
        if (received > limit) {
          const error = new Error(TOO_LARGE)
          abort?.(error)
          await reader.cancel(error).catch(() => undefined)
          controller.error(error)
          return
        }
        controller.enqueue(value)
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel(reason) {
      await reader.cancel(reason).catch(() => undefined)
    },
  })
}

async function connect(connector: Connector) {
  const guarded = await resolveConnectorUrl(connector.url)
  if (!guarded.ok) throw new Error("url")
  const headers = connector.token
    ? connector.header
      ? { [connector.header]: connector.token }
      : { Authorization: `Bearer ${connector.token}` }
    : undefined
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: guarded.value.toString(),
      headers,
      redirect: "error",
      fetch: (input, init) => {
        const request = new Request(input, { ...init, redirect: "error" })
        return request.arrayBuffer().then(
          (body) =>
            new Promise<Response>((resolve, reject) => {
              const outbound = httpsRequest(
                guarded.value,
                {
                  method: request.method,
                  headers: Object.fromEntries(request.headers),
                  signal: request.signal,
                  servername: guarded.host,
                  lookup: (_host, options, callback) => {
                    const addresses = guarded.addresses.filter(
                      ({ family }) =>
                        !options?.family || family === options.family
                    )
                    if (!addresses.length)
                      return callback(new Error("DNS lookup blocked"), "", 0)
                    if (options?.all) return callback(null, addresses)
                    callback(null, addresses[0].address, addresses[0].family)
                  },
                },
                (response) => {
                  if (
                    response.statusCode &&
                    response.statusCode >= 300 &&
                    response.statusCode < 400
                  ) {
                    response.destroy()
                    reject(new Error("Redirect blocked"))
                    return
                  }
                  const responseHeaders = new Headers()
                  for (const [key, value] of Object.entries(response.headers)) {
                    if (Array.isArray(value))
                      value.forEach((entry) =>
                        responseHeaders.append(key, entry)
                      )
                    else if (value !== undefined)
                      responseHeaders.set(key, value)
                  }
                  const declaredLength = Number(
                    responseHeaders.get("content-length")
                  )
                  if (
                    Number.isFinite(declaredLength) &&
                    declaredLength > MAX_RESPONSE_BYTES
                  ) {
                    response.destroy()
                    reject(new Error(TOO_LARGE))
                    return
                  }
                  const stream =
                    response.statusCode === 204 || response.statusCode === 304
                      ? null
                      : limitResponseBody(
                          Readable.toWeb(
                            response
                          ) as ReadableStream<Uint8Array>,
                          MAX_RESPONSE_BYTES,
                          (error) => response.destroy(error)
                        )
                  resolve(
                    new Response(stream, {
                      status: response.statusCode ?? 502,
                      statusText: response.statusMessage,
                      headers: responseHeaders,
                    })
                  )
                }
              )
              outbound.on("error", reject)
              outbound.end(body.byteLength ? Buffer.from(body) : undefined)
            })
        )
      },
    },
    initializationOptions: { timeout: TIMEOUT, maxTotalTimeout: TIMEOUT },
    maxRetries: 0,
    onUncaughtError: () => undefined,
  })
  return client
}

export function failureText(
  connector: Pick<Connector, "name">,
  error: unknown
) {
  const message = error instanceof Error ? error.message : ""
  if (message.includes(TOO_LARGE))
    return `Konnektor ${connector.name}: Antwort ist zu groß`
  const status = /\b(?:HTTP |status )?(401|403)\b/.exec(message)
  if (status)
    return `Konnektor ${connector.name}: Zugang verweigert (${status[1]}). Anmeldung oder Schlüssel nötig.`
  const other = /HTTP (\d{3})/.exec(message)
  if (other)
    return `Konnektor ${connector.name}: Server antwortet mit Fehler ${other[1]}`
  if (message.includes("Zeitbudget") || /timed? ?out/i.test(message))
    return `Konnektor ${connector.name}: Server antwortet zu langsam`
  return `Konnektor ${connector.name} nicht erreichbar`
}

// Headername für eigene Zugangsdaten; Transport-Header bleiben tabu.
export const CONNECTOR_HEADER = /^[A-Za-z][A-Za-z0-9-]{0,39}$/
const BLOCKED_HEADERS = new Set([
  "host",
  "content-length",
  "content-type",
  "accept",
  "connection",
  "transfer-encoding",
  "mcp-session-id",
])
export const validConnectorHeader = (name: string) =>
  CONNECTOR_HEADER.test(name) && !BLOCKED_HEADERS.has(name.toLowerCase())

async function withClient<T>(
  connector: Connector,
  run: (client: MCPClient) => Promise<T>,
  factory: (connector: Connector) => Promise<MCPClient> = connect
): Promise<T> {
  const client = await factory(connector)
  try {
    return await run(client)
  } finally {
    await client.close().catch(() => undefined)
  }
}

export async function listTools(
  connector: Connector,
  factory?: (connector: Connector) => Promise<MCPClient>
): Promise<ConnectorToolInfo[] | { error: string }> {
  try {
    return await withClient(
      connector,
      async (client) => {
        const response = await client.listTools({
          options: { timeout: TIMEOUT, maxTotalTimeout: TIMEOUT },
        })
        return response.tools.map((tool) => ({
          name: tool.name,
          write: tool.annotations?.readOnlyHint !== true,
          ...(tool.annotations?.readOnlyHint !== undefined && {
            readOnlyHint: tool.annotations.readOnlyHint,
          }),
          ...(tool.annotations?.destructiveHint !== undefined && {
            destructiveHint: tool.annotations.destructiveHint,
          }),
        }))
      },
      factory
    )
  } catch (error) {
    return { error: failureText(connector, error) }
  }
}

export function safeOutput(value: unknown, server = "connector"): unknown {
  const result =
    value &&
    typeof value === "object" &&
    Array.isArray((value as { content?: unknown }).content)
      ? (value as {
          content: { type: string; text?: string; [key: string]: unknown }[]
          [key: string]: unknown
        })
      : { content: [{ type: "text", text: JSON.stringify(value) }] }
  let remaining = LIMIT
  const content: { type: string; text: string }[] = []
  for (const part of result.content.slice(0, 50)) {
    const textPart =
      part.type === "text" && typeof part.text === "string"
        ? part.text.replaceAll("</mcp_result", "<\\/mcp_result")
        : "[Nicht-Text-Inhalt ausgelassen]"
    const frameOpen = `<mcp_result server="${server.replaceAll("</mcp_result", "<\\/mcp_result")}">\n`
    const frameClose = "\n</mcp_result>"
    const frameBytes = Buffer.byteLength(frameOpen + frameClose)
    if (remaining <= frameBytes) break
    const budget = remaining - frameBytes
    const bytes = Buffer.from(textPart)
    const clipped = bytes.byteLength > budget
    const body = clipped
      ? bytes.subarray(0, Math.max(0, budget - 12)).toString("utf8") +
        " [truncated]"
      : textPart
    const framed = `${frameOpen}${body}${frameClose}`
    if (Buffer.byteLength(framed) > remaining) break
    content.push({ type: "text", text: framed })
    remaining -= Buffer.byteLength(framed)
    if (clipped) break
  }
  return { ...result, content }
}

function safeDefinitionName(value: string) {
  return /^[a-zA-Z0-9_-]{1,64}$/.test(value) ? value : null
}

// Eigene Statuswerkzeuge brauchen keine Freigabe; ein Fremdserver kann sich nicht so ausgeben, weil die Prüfung am Objekt hängt.
const statusTools = new WeakSet<object>()
export const isConnectorStatusTool = (value: object) => statusTools.has(value)

// Herkunft je Werkzeugobjekt für die Freigabe-Regel; der gekürzte Werkzeugname reicht dafür nicht.
export type ConnectorToolOrigin = {
  connectorId: string
  connectorName: string
  connectorUrl: string
  override?: import("../approvals/risk.ts").ToolMeta["override"]
  mcpName: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
}
const toolOrigins = new WeakMap<object, ConnectorToolOrigin>()
export const registerConnectorToolOrigin = (tool: object, origin: ConnectorToolOrigin) => toolOrigins.set(tool, origin)
export const connectorToolOrigin = (value: object) => toolOrigins.get(value)

export function unavailableConnectorTool(
  connector: Pick<Connector, "id" | "name">,
  error = `Konnektor ${connector.name} nicht erreichbar`
): ToolSet {
  const safeId = connector.id.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 36)
  const status = tool({
    description: `${connector.name} ist in diesem Turn nicht verfügbar. Dieses Statuswerkzeug erklärt den Ladefehler.`,
    inputSchema: z.object({}),
    execute: async () => ({ error }),
  })
  statusTools.add(status)
  return { [`connector_${safeId}__unavailable`]: status }
}

export async function connectorTools(
  connectors: Connector[],
  isGroup = false,
  factory?: (connector: Connector) => Promise<MCPClient>,
  budgetMs = CONNECTOR_LOAD_MS
): Promise<ToolSet> {
  const sets = await Promise.all(
    connectors.map(async (connector) => {
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        return await Promise.race([
          withClient(
            connector,
            async (client) => {
              const definitions = await client.listTools({
                options: { timeout: TIMEOUT, maxTotalTimeout: TIMEOUT },
              })
              const tools = client.toolsFromDefinitions(definitions)
              const used = new Set<string>()
              return Object.fromEntries(
                Object.entries(tools)
                  .slice(0, 40)
                  .flatMap(([name, original]) => {
                    if (!safeDefinitionName(name)) return []
                    const definition = definitions.tools.find(
                      (entry) => entry.name === name
                    )
                    const write = definition?.annotations?.readOnlyHint !== true
                    // Gruppen erhalten keine Schreibwerkzeuge.
                    if (isGroup && write) return []
                    const description = `${(typeof original.description === "string" ? original.description : "").slice(0, 500)}${write ? " (write action)" : ""}`
                    const prefix = `connector_${connector.id}__`.slice(0, 63)
                    const base = `${prefix}${name.slice(0, Math.max(1, 64 - prefix.length))}`
                    let toolName = base
                    let suffix = 2
                    while (used.has(toolName)) {
                      const ending = `-${suffix++}`
                      toolName = `${prefix}${name.slice(0, Math.max(1, 64 - prefix.length - ending.length))}${ending}`
                    }
                    used.add(toolName)
                    const wrapped = {
                          ...original,
                          description,
                          execute: async (input: unknown) => {
                            try {
                              const result = await withClient(
                                connector,
                                (active) =>
                                  active.callTool({
                                    name,
                                    arguments: input as Record<string, unknown>,
                                    options: {
                                      timeout: TIMEOUT,
                                      maxTotalTimeout: TIMEOUT,
                                    },
                                  }),
                                factory
                              )
                              return safeOutput(result, connector.name)
                            } catch (error) {
                              return { error: failureText(connector, error) }
                            }
                          },
                        }
                    toolOrigins.set(wrapped, {
                      connectorId: connector.id,
                      connectorName: connector.name,
                      connectorUrl: connector.url,
                      mcpName: name,
                      readOnlyHint: definition?.annotations?.readOnlyHint,
                      destructiveHint: definition?.annotations?.destructiveHint,
                    })
                    return [[toolName, wrapped]]
                  })
              )
            },
            factory
          ),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Zeitbudget überschritten")),
              budgetMs
            )
          }),
        ])
      } catch (error) {
        console.error(
          `Konnektor ${connector.name} konnte nicht geladen werden.`
        )
        return unavailableConnectorTool(
          connector,
          failureText(connector, error)
        )
      } finally {
        clearTimeout(timer)
      }
    })
  )
  const merged = Object.assign({}, ...sets) as ToolSet
  return Object.fromEntries(
    Object.entries(merged).slice(0, MAX_TOOLS)
  ) as ToolSet
}
