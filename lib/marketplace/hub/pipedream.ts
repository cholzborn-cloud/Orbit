import {
  call,
  configAccount,
  pendingAccount,
  setupStatus,
  tokenAccount,
  type ProviderAdapter,
  type ProviderContext,
  type ProviderDef,
  type ReadResult,
  type Trigger,
} from "../provider.ts"

// Vermittler Pipedream Connect (Route "pipedream"). Endpunkte und Felder laut Anbieterdoku, nicht live geprüft.
// Im Schlüsselbund liegt nur die Account-Id (token:pipedream), keine Zugangsdaten. Es wird nie mit credentials-Parameter gelesen.
const BASE = "https://api.pipedream.com/v1"
const END_USER = "orbit-local"
const PENDING_MAX_AGE = 30 * 60_000

export const pipedreamDef: ProviderDef = {
  id: "pipedream",
  label: "Pipedream Connect",
  route: "pipedream",
  services: [],
  setup: [
    { key: "clientId", label: "Pipedream Client-ID", secret: false },
    { key: "clientSecret", label: "Pipedream Client-Secret", secret: true },
    { key: "projectId", label: "Projekt-ID", secret: false },
    { key: "environment", label: "Umgebung (production oder development)", secret: false },
  ],
  cost: "Free nur für Entwicklung; produktiv ab 99 $/Monat",
  note: "Vermittler: Aufrufe können über Pipedreams Proxy laufen.",
}

export function pipedreamAdapter(ctx: ProviderContext): ProviderAdapter {
  const cfg = (key: string) => ctx.vault.get(configAccount(pipedreamDef.id, key))

  async function config() {
    const clientId = await cfg("clientId")
    const clientSecret = await cfg("clientSecret")
    const projectId = await cfg("projectId")
    const environment = await cfg("environment")
    if (!clientId || !clientSecret || !projectId || !environment) throw new Error("Pipedream-Einrichtung unvollständig.")
    if (environment !== "production" && environment !== "development") throw new Error("Umgebung muss production oder development sein.")
    if (!/^[A-Za-z0-9_-]+$/.test(projectId)) throw new Error("Ungültige Projekt-Id.")
    return { clientId, clientSecret, projectId, environment }
  }

  // Fehlertexte enthalten nur Statuscodes, nie Antwortinhalt oder Schlüssel.
  async function request(url: string, init: RequestInit, label: string) {
    const response = await ctx.fetchFn(url, { ...init, redirect: "error" })
    if (!response.ok) throw new Error(`Pipedream-${label} fehlgeschlagen (${response.status}).`)
    return (await response.json()) as Record<string, unknown>
  }

  async function accessToken(c: Awaited<ReturnType<typeof config>>) {
    const result = await request(
      `${BASE}/oauth/token`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ grant_type: "client_credentials", client_id: c.clientId, client_secret: c.clientSecret }),
      },
      "Anmeldung"
    )
    if (typeof result.access_token !== "string") throw new Error("Pipedream-Antwort ohne Zugriffstoken.")
    return result.access_token
  }

  const headers = (c: Awaited<ReturnType<typeof config>>, token: string) => ({
    authorization: `Bearer ${token}`,
    "x-pd-environment": c.environment,
    "content-type": "application/json",
  })

  return {
    def: pipedreamDef,
    async status() {
      const { configured, missing } = await setupStatus(ctx, pipedreamDef)
      return { id: pipedreamDef.id, configured, connected: await ctx.vault.has(tokenAccount(pipedreamDef.id)), missing }
    },
    async connectStart(trigger: Trigger) {
      const c = await config()
      // Beide Netzaufrufe laufen in einem call(): Token holen, dann Connect-Token anlegen -> connect_link_url.
      const result = await call(ctx, pipedreamDef.id, "connect.token", trigger, async () => {
        const token = await accessToken(c)
        return request(
          `${BASE}/connect/${c.projectId}/tokens`,
          { method: "POST", headers: headers(c, token), body: JSON.stringify({ external_user_id: END_USER }) },
          "Connect-Token"
        )
      })
      const link = result.connect_link_url
      if (typeof link !== "string" || !link.startsWith("https://")) throw new Error("Pipedream-Antwort ohne Verbindungslink.")
      await ctx.vault.set(pendingAccount(pipedreamDef.id), JSON.stringify({ startedAt: ctx.now() }))
      return { url: link }
    },
    async connectFinish(_params: URLSearchParams) {
      const raw = await ctx.vault.get(pendingAccount(pipedreamDef.id))
      if (!raw) throw new Error("Keine laufende Anmeldung.")
      if (ctx.now() - (JSON.parse(raw) as { startedAt: number }).startedAt > PENDING_MAX_AGE) throw new Error("Anmeldung abgelaufen.")
      const c = await config()
      const result = await call(ctx, pipedreamDef.id, "accounts.list", "user", async () => {
        const token = await accessToken(c)
        return request(
          `${BASE}/connect/${c.projectId}/accounts?external_user_id=${encodeURIComponent(END_USER)}`,
          { headers: headers(c, token) },
          "Kontenliste"
        )
      })
      const list = Array.isArray(result.data) ? (result.data as Record<string, unknown>[]) : []
      const first = list.find((a) => typeof a.id === "string")
      // Ohne Konto bleiben Zwischenstand und alte Verbindung unverändert.
      if (!first) throw new Error("Noch kein Pipedream-Konto gefunden.")
      await ctx.vault.set(tokenAccount(pipedreamDef.id), String(first.id))
      await ctx.vault.remove(pendingAccount(pipedreamDef.id))
    },
    async read(trigger: Trigger): Promise<ReadResult> {
      try {
        const c = await config()
        const id = await ctx.vault.get(tokenAccount(pipedreamDef.id))
        if (!id) return { ok: false, error: "Nicht verbunden." }
        const result = await call(ctx, pipedreamDef.id, "accounts.get", trigger, async () => {
          const token = await accessToken(c)
          // Bewusst ohne credentials-Parameter.
          return request(`${BASE}/connect/${c.projectId}/accounts/${encodeURIComponent(id)}`, { headers: headers(c, token) }, "Kontoabfrage")
        })
        const account = (result.data ?? {}) as { app?: { name?: unknown }; healthy?: unknown; dead?: unknown }
        const app = typeof account.app?.name === "string" ? account.app.name : "unbekannte App"
        const state = account.dead === true ? "getrennt" : account.healthy === false ? "Fehler gemeldet" : "in Ordnung"
        return { ok: true, summary: `Pipedream-Konto ${app}: ${state}.` }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Unbekannter Fehler." }
      }
    },
    async disconnect() {
      await ctx.vault.remove(tokenAccount(pipedreamDef.id))
      await ctx.vault.remove(pendingAccount(pipedreamDef.id))
    },
  }
}
