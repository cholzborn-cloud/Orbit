import type { Vault } from "./vault.ts"

// Anbieter im Marktplatz (E52, E55): Composio ist einer von mehreren Wegen. Jeder Weg ist ein Adapter mit denselben Schritten.
// Regel (E64): Kein Netzaufruf ohne Nutzer- oder Orbi-Aktion. Jeder Aufruf geht durch `ctx.call` und steht im Aufruf-Log.
export type ProviderRoute = "direct" | "nango" | "pipedream" | "composio"
export type Trigger = "user" | "orbi"

export type ProviderDef = {
  id: string
  label: string
  route: ProviderRoute
  services: string[]
  // Werte, die Consti einmal einträgt (Client-ID, Secret …); sie liegen im Schlüsselbund unter `cfg:<id>:<key>`.
  setup: { key: string; label: string; secret: boolean }[]
  cost: string
  note: string
}

export type ProviderStatus = {
  id: string
  // Alle Setup-Werte vorhanden? Nur Schlüsselbund-Abfrage, kein Netz.
  configured: boolean
  connected: boolean
  missing: string[]
}

export type ReadResult = { ok: true; summary: string } | { ok: false; error: string }

export type CallLogEntry = { provider: string; action: string; trigger: Trigger; at: number }

export type ProviderContext = {
  vault: Vault
  fetchFn: typeof fetch
  now: () => number
  log: (entry: CallLogEntry) => void
  // Rücksprung-Adresse des lokalen Dienstes (…/oauth/callback).
  redirectUrl: string
}

export interface ProviderAdapter {
  def: ProviderDef
  status(): Promise<ProviderStatus>
  // Nutzeraktion „Verbinden“: liefert die Adresse für den Browser. Legt nur einen Zwischenzustand an, die bestehende Verbindung bleibt.
  connectStart(trigger: Trigger): Promise<{ url: string }>
  // Rücksprung mit `code` und `state`. Erst nach erfolgreichem Austausch wird der Zwischenzustand zur Verbindung.
  connectFinish(params: URLSearchParams): Promise<void>
  // Genau eine Leseaktion als Verbindungstest. Nie im Hintergrund.
  read(trigger: Trigger): Promise<ReadResult>
  disconnect(): Promise<void>
}

export const configAccount = (provider: string, key: string) => `cfg:${provider}:${key}`
export const tokenAccount = (provider: string) => `token:${provider}`
export const pendingAccount = (provider: string) => `pending:${provider}`

export async function setupStatus(ctx: ProviderContext, def: ProviderDef) {
  const missing: string[] = []
  for (const field of def.setup)
    if (!(await ctx.vault.has(configAccount(def.id, field.key)))) missing.push(field.key)
  return { configured: missing.length === 0, missing }
}

// Einziger Weg ins Netz: protokolliert Anbieter, Aktion und Auslöser, bevor der Aufruf läuft. Ohne Auslöser kein Aufruf.
export async function call<T>(
  ctx: ProviderContext,
  provider: string,
  action: string,
  trigger: Trigger | undefined,
  run: () => Promise<T>
): Promise<T> {
  if (trigger !== "user" && trigger !== "orbi")
    throw new Error("Aufruf ohne Nutzer- oder Orbi-Aktion abgewiesen.")
  ctx.log({ provider, action, trigger, at: ctx.now() })
  return run()
}
