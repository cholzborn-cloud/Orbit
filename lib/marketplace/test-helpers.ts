import { Vault, memoryRunner } from "./vault.ts"
import type { CallLogEntry, ProviderContext } from "./provider.ts"

// Testaufbau: Schlüsselbund-Attrappe und eine Netz-Attrappe, die jeden Aufruf aufzeichnet.
export function testContext(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const runner = memoryRunner()
  const log: CallLogEntry[] = []
  const requests: { url: string; init?: RequestInit }[] = []
  let clock = 1_000_000
  const ctx: ProviderContext = {
    vault: new Vault(runner),
    fetchFn: (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, init })
      return handler(url, init)
    }) as typeof fetch,
    now: () => clock,
    log: (entry) => log.push(entry),
    redirectUrl: "http://127.0.0.1:4317/oauth/callback",
  }
  return { ctx, runner, log, requests, advance: (ms: number) => { clock += ms } }
}
export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
