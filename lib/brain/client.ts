import { createMCPClient } from "@ai-sdk/mcp"

export type BrainResult<T> =
  { ok: true; data: T } | { ok: false; error: string }
export type BrainEnv = {
  BRAIN_SERVER_URL?: string
  BRAIN_SERVER_TOKEN?: string
}
type BrainArgs = Record<string, unknown>

const OFFLINE = "Brain nicht erreichbar (Mac aus oder Tunnel offline)."
const UNCONFIGURED = "Brain ist nicht eingerichtet."
const TEXT_LIMIT = 20_000

export function createBrainClient(
  env: BrainEnv = process.env as BrainEnv,
  fetchImpl: typeof fetch = fetch
) {
  async function call(
    name: string,
    args: BrainArgs
  ): Promise<BrainResult<string>> {
    if (!env.BRAIN_SERVER_URL || !env.BRAIN_SERVER_TOKEN)
      return { ok: false, error: UNCONFIGURED }
    try {
      const url = new URL(env.BRAIN_SERVER_URL)
      if (
        url.protocol !== "https:" &&
        !["localhost", "127.0.0.1"].includes(url.hostname)
      )
        return { ok: false, error: OFFLINE }
    } catch {
      return { ok: false, error: OFFLINE }
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 5000)
    let client: Awaited<ReturnType<typeof createMCPClient>> | undefined
    try {
      client = await createMCPClient({
        transport: {
          type: "http",
          url: env.BRAIN_SERVER_URL,
          headers: { Authorization: `Bearer ${env.BRAIN_SERVER_TOKEN}` },
          fetch: (input, init) =>
            fetchImpl(input, { ...init, signal: controller.signal }),
        },
        initializationOptions: {
          signal: controller.signal,
          timeout: 5000,
          maxTotalTimeout: 5000,
        },
        protocolVersionDiscovery: false,
      })
      const result = await client.callTool({
        name,
        arguments: args,
        options: {
          signal: controller.signal,
          timeout: 5000,
          maxTotalTimeout: 5000,
        },
      })
      const output = (result.content as { type: string; text?: string }[])
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n")
      if (result.isError) return { ok: false, error: output || OFFLINE }
      return {
        ok: true,
        data:
          output.length > TEXT_LIMIT
            ? `${output.slice(0, TEXT_LIMIT)}\n[gekürzt]`
            : output,
      }
    } catch {
      return { ok: false, error: OFFLINE }
    } finally {
      if (client) {
        let closeTimer: ReturnType<typeof setTimeout>
        await Promise.race([
          client.close().catch(() => undefined),
          new Promise<void>((resolve) => {
            closeTimer = setTimeout(() => {
              controller.abort()
              resolve()
            }, 1000)
          }),
        ]).finally(() => clearTimeout(closeTimer))
      }
      clearTimeout(timer)
    }
  }

  return {
    search: (query: string) => call("brain_search", { query }),
    read: (path: string, section?: string) =>
      call("brain_read", { path, ...(section ? { section } : {}) }),
    write: (path: string, content: string, mode: "create" | "append" | "replace") =>
      call("brain_write", { path, content, mode }),
    move: (from: string, to?: string) => call("brain_move", { from, ...(to ? { to } : {}) }),
    skillsList: () => call("brain_skills_list", {}),
    skillRead: (name: string) => call("brain_skill_read", { name }),
  }
}
