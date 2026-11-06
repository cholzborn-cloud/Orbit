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

// Vermittler Nango (Route "nango"). Endpunkte und Felder laut Anbieterdoku, nicht live geprüft.
// Im Schlüsselbund liegt nur die connection_id (token:nango), kein Anbieter-Token. Das Credentials-Feld wird nie gelesen oder ausgegeben.
const BASE = "https://api.nango.dev"
const END_USER = "orbit-local"
const PENDING_MAX_AGE = 30 * 60_000

export const nangoDef: ProviderDef = {
  id: "nango",
  label: "Nango",
  route: "nango",
  services: [],
  setup: [
    { key: "secretKey", label: "Nango Secret Key", secret: true },
    { key: "integrationId", label: "Name der Nango-Integration (z. B. google-mail)", secret: false },
  ],
  cost: "Free: 10 Verbindungen; darüber ab 50 $/Monat",
  note: "Vermittler: Nango-Cloud verwaltet Zugang und Token-Erneuerung.",
}

export function nangoAdapter(ctx: ProviderContext): ProviderAdapter {
  const cfg = (key: string) => ctx.vault.get(configAccount(nangoDef.id, key))

  async function config() {
    const secretKey = await cfg("secretKey")
    const integrationId = await cfg("integrationId")
    if (!secretKey || !integrationId) throw new Error("Nango-Einrichtung unvollständig.")
    return { secretKey, integrationId }
  }

  // Fehlertexte enthalten nur Statuscodes, nie Antwortinhalt oder Schlüssel.
  async function request(secretKey: string, path: string, init: RequestInit = {}) {
    const response = await ctx.fetchFn(`${BASE}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${secretKey}`, "content-type": "application/json", accept: "application/json" },
      redirect: "error",
    })
    if (!response.ok) throw new Error(`Nango-Anfrage fehlgeschlagen (${response.status}).`)
    return (await response.json()) as Record<string, unknown>
  }

  return {
    def: nangoDef,
    async status() {
      const { configured, missing } = await setupStatus(ctx, nangoDef)
      return { id: nangoDef.id, configured, connected: await ctx.vault.has(tokenAccount(nangoDef.id)), missing }
    },
    async connectStart(trigger: Trigger) {
      const { secretKey, integrationId } = await config()
      // POST /connect/sessions -> data.connect_link
      const body = JSON.stringify({ end_user: { id: END_USER }, allowed_integrations: [integrationId] })
      const result = await call(ctx, nangoDef.id, "connect.session", trigger, () =>
        request(secretKey, "/connect/sessions", { method: "POST", body })
      )
      const link = (result.data as { connect_link?: unknown } | undefined)?.connect_link
      if (typeof link !== "string" || !link.startsWith("https://")) throw new Error("Nango-Antwort ohne Verbindungslink.")
      // Nur Zwischenstand; eine bestehende Verbindung bleibt.
      await ctx.vault.set(pendingAccount(nangoDef.id), JSON.stringify({ startedAt: ctx.now() }))
      return { url: link }
    },
    async connectFinish(_params: URLSearchParams) {
      // Nango meldet den Abschluss nicht per Code: wir fragen die Verbindungsliste ab (Rücksprung = Nutzeraktion).
      const raw = await ctx.vault.get(pendingAccount(nangoDef.id))
      if (!raw) throw new Error("Keine laufende Anmeldung.")
      if (ctx.now() - (JSON.parse(raw) as { startedAt: number }).startedAt > PENDING_MAX_AGE) throw new Error("Anmeldung abgelaufen.")
      const { secretKey, integrationId } = await config()
      const query = `search=${encodeURIComponent(END_USER)}&integration_id=${encodeURIComponent(integrationId)}`
      const result = await call(ctx, nangoDef.id, "connection.list", "user", () =>
        request(secretKey, `/connection?${query}`)
      )
      const list = Array.isArray(result.connections) ? (result.connections as Record<string, unknown>[]) : []
      const found = list.find((c) => typeof c.connection_id === "string" && (c.provider_config_key ?? integrationId) === integrationId)
      // Ohne Verbindung bleiben Zwischenstand und alte Verbindung unverändert.
      if (!found) throw new Error("Noch keine Nango-Verbindung gefunden.")
      await ctx.vault.set(tokenAccount(nangoDef.id), String(found.connection_id))
      await ctx.vault.remove(pendingAccount(nangoDef.id))
    },
    async read(trigger: Trigger): Promise<ReadResult> {
      try {
        const { secretKey, integrationId } = await config()
        const id = await ctx.vault.get(tokenAccount(nangoDef.id))
        if (!id) return { ok: false, error: "Nicht verbunden." }
        const result = await call(ctx, nangoDef.id, "connection.get", trigger, () =>
          request(secretKey, `/connection/${encodeURIComponent(id)}?provider_config_key=${encodeURIComponent(integrationId)}`)
        )
        // Nur Provider und Status; das Feld "credentials" wird bewusst ignoriert.
        const provider = typeof result.provider === "string" ? result.provider : integrationId
        const errors = Array.isArray(result.errors) ? result.errors.length : 0
        return { ok: true, summary: `Nango-Verbindung zu ${provider}: ${errors ? "Fehler gemeldet" : "in Ordnung"}.` }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : "Unbekannter Fehler." }
      }
    },
    async disconnect() {
      await ctx.vault.remove(tokenAccount(nangoDef.id))
      await ctx.vault.remove(pendingAccount(nangoDef.id))
    },
  }
}
