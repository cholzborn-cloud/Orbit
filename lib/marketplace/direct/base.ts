import {
  call,
  setupStatus,
  tokenAccount,
  type ProviderAdapter,
  type ProviderContext,
  type ProviderDef,
  type ReadResult,
} from "../provider.ts"
import {
  oauth2AccessToken,
  oauth2Disconnect,
  oauth2Finish,
  oauth2Start,
  type OAuth2Endpoints,
} from "../oauth2.ts"

// Gemeinsamer Bau der direkten Adapter: gleiche Schritte, nur Endpunkte, Lese-URL und Zusammenfassung unterscheiden sich.
export type DirectSpec = {
  def: ProviderDef
  endpoints: OAuth2Endpoints
  readUrl: string
  readAction: string
  // Kurze Zusammenfassung aus der Antwort; darf nie Token oder Rohdaten enthalten.
  summarize: (body: Record<string, unknown>) => string
}

export function directAdapter(ctx: ProviderContext, spec: DirectSpec): ProviderAdapter {
  const id = spec.def.id
  return {
    def: spec.def,
    async status() {
      const setup = await setupStatus(ctx, spec.def)
      return { id, ...setup, connected: await ctx.vault.has(tokenAccount(id)) }
    },
    connectStart: (trigger) => oauth2Start(ctx, id, spec.endpoints, trigger),
    connectFinish: (params) => oauth2Finish(ctx, id, spec.endpoints, params),
    async read(trigger): Promise<ReadResult> {
      // Ohne gültigen Auslöser wirft call() vor jedem Netzaufruf.
      return call(ctx, id, spec.readAction, trigger, async (): Promise<ReadResult> => {
        try {
          const token = await oauth2AccessToken(ctx, id, spec.endpoints, trigger)
          if (!token) return { ok: false, error: "Nicht verbunden." }
          const response = await ctx.fetchFn(spec.readUrl, {
            headers: { authorization: `Bearer ${token}`, accept: "application/json" },
            redirect: "error",
          })
          if (!response.ok) return { ok: false, error: `Lesen fehlgeschlagen (${response.status}).` }
          const body = (await response.json()) as Record<string, unknown>
          return { ok: true, summary: spec.summarize(body) }
        } catch {
          return { ok: false, error: "Lesen fehlgeschlagen." }
        }
      })
    },
    disconnect: () => oauth2Disconnect(ctx, id),
  }
}
