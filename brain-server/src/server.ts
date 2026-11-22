import { createServer } from "node:http"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { z } from "zod"

import { createBrainTools, DEFAULT_VAULT, tokenMatches } from "./brain.ts"

const token = process.env.BRAIN_SERVER_TOKEN
if (!token || token.length < 24)
  throw new Error("BRAIN_SERVER_TOKEN muss mindestens 24 Zeichen lang sein.")

const port = Number(process.env.BRAIN_SERVER_PORT ?? "8420")
// Das SDK vergleicht den kompletten Host-Header (mit Port): beide Formen zulassen.
const allowedHosts = [
  ...new Set(
    [
      "127.0.0.1",
      "localhost",
      ...(process.env.BRAIN_ALLOWED_HOSTS ?? "")
        .split(",")
        .map((host) => host.trim())
        .filter(Boolean),
    ].flatMap((host) => [host, `${host}:${port}`])
  ),
]
const tools = createBrainTools(process.env.BRAIN_VAULT_PATH ?? DEFAULT_VAULT)

function createMcp() {
  const mcp = new McpServer({ name: "orbit-brain", version: "1.0.0" })
  const register = (
    name: string,
    description: string,
    inputSchema: z.ZodRawShape,
    run: (args: never) => Promise<string>
  ) =>
    mcp.registerTool(
      name,
      { description, inputSchema },
      async (args: Record<string, unknown>) => {
        try {
          return { content: [{ type: "text", text: await run(args as never) }] }
        } catch (error) {
          const message =
            error instanceof Error &&
            !("code" in error) &&
            /^(Der|Die|Das|Erlaubt|Schreiben|Lesen|Kopfstück|Datei|Dieser|Diese|Ungültiger|Archiv)/.test(
              error.message
            )
              ? error.message
              : "Dateizugriff fehlgeschlagen."
          return { isError: true, content: [{ type: "text", text: message }] }
        }
      }
    )
  register(
    "brain_search",
    "Search note filenames and full text in the whole vault.",
    { query: z.string().min(1) },
    async ({ query }: { query: string }) =>
      JSON.stringify(await tools.brain_search(query))
  )
  register(
    "brain_read",
    "Read a Markdown note or heading section anywhere in the vault.",
    { path: z.string(), section: z.string().optional() },
    async ({ path, section }: { path: string; section?: string }) =>
      tools.brain_read(path, section)
  )
  register(
    "brain_write",
    "Create, append, or replace a Markdown note anywhere in the vault.",
    {
      path: z.string(),
      content: z.string(),
      mode: z.enum(["create", "append", "replace"]),
    },
    async ({
      path,
      content,
      mode,
    }: {
      path: string
      content: string
      mode: "create" | "append" | "replace"
    }) => tools.brain_write(path, content, mode)
  )
  register(
    "brain_move",
    "Rename or move a note. Without to, the note moves to 06 Archiv (never deleted).",
    { from: z.string(), to: z.string().optional() },
    async ({ from, to }: { from: string; to?: string }) => tools.brain_move(from, to)
  )
  register(
    "brain_skills_list",
    "List skills available in the vault.",
    {},
    async () => JSON.stringify(await tools.brain_skills_list())
  )
  register(
    "brain_skill_read",
    "Read a skill instruction file from the vault.",
    { name: z.string() },
    async ({ name }: { name: string }) => tools.brain_skill_read(name)
  )
  return mcp
}

createServer((request, response) => {
  if (!tokenMatches(token, request.headers.authorization)) {
    response
      .writeHead(401, { "content-type": "application/json" })
      .end(JSON.stringify({ error: "Nicht autorisiert." }))
    return
  }
  void (async () => {
    const mcp = createMcp()
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableDnsRebindingProtection: true,
      allowedHosts,
    })
    try {
      await mcp.connect(transport)
      await transport.handleRequest(request, response)
    } catch {
      if (!response.headersSent)
        response.writeHead(500, { "content-type": "application/json" })
      if (!response.writableEnded)
        response.end(JSON.stringify({ error: "Brain-Anfrage fehlgeschlagen." }))
    } finally {
      await transport.close().catch(() => {})
      await mcp.close().catch(() => {})
    }
  })()
}).listen(port, "127.0.0.1")
