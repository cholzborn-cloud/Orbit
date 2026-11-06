import {
  configAccount,
  type CallLogEntry,
  type ProviderAdapter,
  type ProviderContext,
} from "@/lib/marketplace/provider"

// Marktplatz-Dienst (Schritt 22): Anbieter-Adapter hinter einer kleinen API. Nichts läuft von allein: jede Aktion kommt von einer Route
// (Nutzer in der App) oder von einem Orbi-Werkzeug. Das Aufruf-Log hält nur Anbieter, Aktion, Auslöser und Zeit, nie Werte.
const LOG_LIMIT = 200

export class Marketplace {
  readonly log: CallLogEntry[] = []
  private readonly adapters: Map<string, ProviderAdapter>
  private readonly ctx: ProviderContext

  constructor(ctx: ProviderContext, build: (ctx: ProviderContext) => ProviderAdapter[]) {
    this.ctx = {
      ...ctx,
      log: (entry) => {
        this.log.push(entry)
        if (this.log.length > LOG_LIMIT) this.log.shift()
        ctx.log(entry)
      },
    }
    this.adapters = new Map(build(this.ctx).map((adapter) => [adapter.def.id, adapter]))
  }

  has(id: string) {
    return this.adapters.has(id)
  }

  private adapter(id: string) {
    const adapter = this.adapters.get(id)
    if (!adapter) throw new Error("Unbekannter Anbieter.")
    return adapter
  }

  // Nur Schlüsselbund-Abfragen, kein Netz (Marktplatz öffnen löst keinen Anbieteraufruf aus).
  async list() {
    const providers = []
    for (const adapter of this.adapters.values())
      providers.push({ ...adapter.def, ...(await adapter.status()) })
    return { ok: true as const, providers }
  }

  // Setup-Wert eintragen. Wird nur geschrieben, nie zurückgegeben („gesetzt ✓“).
  async setConfig(id: string, input: { key?: unknown; value?: unknown }) {
    const adapter = this.adapter(id)
    const field = adapter.def.setup.find((entry) => entry.key === input.key)
    if (!field || typeof input.value !== "string" || !input.value.trim() || input.value.length > 2048)
      return { ok: false as const, error: "Eintrag ungültig." }
    await this.ctx.vault.set(configAccount(id, field.key), input.value.trim())
    return { ok: true as const }
  }

  async connect(id: string) {
    try {
      return { ok: true as const, ...(await this.adapter(id).connectStart("user")) }
    } catch (error) {
      return { ok: false as const, error: message(error) }
    }
  }

  // Rücksprung aus dem Browser; der State beginnt mit `<anbieter>.`.
  async finish(params: URLSearchParams) {
    const id = (params.get("state") ?? "").split(".")[0] ?? ""
    if (!this.adapters.has(id)) return { ok: false as const, error: "Anmeldung gehört zu keinem Anbieter." }
    try {
      await this.adapter(id).connectFinish(params)
      return { ok: true as const }
    } catch (error) {
      return { ok: false as const, error: message(error) }
    }
  }

  async read(id: string, trigger: "user" | "orbi" = "user") {
    try {
      return await this.adapter(id).read(trigger)
    } catch (error) {
      return { ok: false as const, error: message(error) }
    }
  }

  async disconnect(id: string) {
    await this.adapter(id).disconnect()
    return { ok: true as const }
  }
}

// Fehlertexte der Adapter enthalten nie Werte; trotzdem nur Festtexte weitergeben.
const message = (error: unknown) =>
  error instanceof Error && error.message.length <= 200 ? error.message : "Aktion fehlgeschlagen."
