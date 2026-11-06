import { createHash, randomBytes } from "node:crypto"

import {
  call,
  configAccount,
  pendingAccount,
  tokenAccount,
  type ProviderContext,
  type Trigger,
} from "./provider.ts"

// Gemeinsamer OAuth2-Ablauf mit PKCE für die direkten Anbieter (Google, Microsoft, Spotify). Tokens und Zwischenzustand liegen nur im
// Schlüsselbund. Client-ID (und falls nötig Secret) kommen aus `cfg:<anbieter>:clientId` / `clientSecret`.
export type OAuth2Endpoints = {
  authorize: string
  token: string
  scopes: string[]
  // Zusätzliche Parameter für die Anmelde-Adresse (z. B. Google: access_type=offline, prompt=consent).
  extraAuthParams?: Record<string, string>
}

type Stored = { access: string; refresh?: string; expiresAt?: number }
type Pending = { verifier: string; state: string; startedAt: number }

const b64 = (buf: Buffer) => buf.toString("base64url")
const PENDING_MAX_AGE = 10 * 60_000

async function secretOf(ctx: ProviderContext, provider: string, key: string) {
  return ctx.vault.get(configAccount(provider, key))
}

export async function oauth2Start(
  ctx: ProviderContext,
  provider: string,
  endpoints: OAuth2Endpoints,
  trigger: Trigger
) {
  // Nur ein Zwischenzustand; die bestehende Verbindung (token:…) bleibt unberührt.
  const clientId = await secretOf(ctx, provider, "clientId")
  if (!clientId) throw new Error("Client-ID fehlt.")
  const verifier = b64(randomBytes(32))
  const state = b64(randomBytes(16))
  const pending: Pending = { verifier, state, startedAt: ctx.now() }
  await ctx.vault.set(pendingAccount(provider), JSON.stringify(pending))
  ctx.log({ provider, action: "oauth.start", trigger, at: ctx.now() })
  const url = new URL(endpoints.authorize)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("redirect_uri", ctx.redirectUrl)
  url.searchParams.set("scope", endpoints.scopes.join(" "))
  url.searchParams.set("state", `${provider}.${state}`)
  url.searchParams.set("code_challenge", b64(createHash("sha256").update(verifier).digest()))
  url.searchParams.set("code_challenge_method", "S256")
  for (const [key, value] of Object.entries(endpoints.extraAuthParams ?? {}))
    url.searchParams.set(key, value)
  return { url: url.toString() }
}

async function tokenRequest(
  ctx: ProviderContext,
  provider: string,
  endpoints: OAuth2Endpoints,
  form: Record<string, string>
): Promise<Stored> {
  const clientId = await secretOf(ctx, provider, "clientId")
  const clientSecret = await secretOf(ctx, provider, "clientSecret")
  if (!clientId) throw new Error("Client-ID fehlt.")
  const body = new URLSearchParams({ client_id: clientId, ...form })
  if (clientSecret) body.set("client_secret", clientSecret)
  const response = await ctx.fetchFn(endpoints.token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
    redirect: "error",
  })
  if (!response.ok) throw new Error(`Token-Austausch fehlgeschlagen (${response.status}).`)
  const json = (await response.json()) as {
    access_token?: string
    refresh_token?: string
    expires_in?: number
  }
  if (!json.access_token) throw new Error("Antwort ohne Zugriffstoken.")
  return {
    access: json.access_token,
    refresh: json.refresh_token,
    expiresAt: json.expires_in ? ctx.now() + json.expires_in * 1000 : undefined,
  }
}

export async function oauth2Finish(
  ctx: ProviderContext,
  provider: string,
  endpoints: OAuth2Endpoints,
  params: URLSearchParams
) {
  const raw = await ctx.vault.get(pendingAccount(provider))
  if (!raw) throw new Error("Keine laufende Anmeldung.")
  const pending = JSON.parse(raw) as Pending
  const code = params.get("code")
  if (params.get("error") || !code) throw new Error("Anmeldung abgebrochen.")
  if (params.get("state") !== `${provider}.${pending.state}`) throw new Error("Anmeldung gehört nicht zu dieser Anfrage.")
  if (ctx.now() - pending.startedAt > PENDING_MAX_AGE) throw new Error("Anmeldung abgelaufen.")
  // Schlägt der Austausch fehl, bleiben die alte Verbindung und der Zwischenzustand unverändert (kein Überschreiben).
  const stored = await tokenRequest(ctx, provider, endpoints, {
    grant_type: "authorization_code",
    code,
    redirect_uri: ctx.redirectUrl,
    code_verifier: pending.verifier,
  })
  const previous = await ctx.vault.get(tokenAccount(provider))
  if (!stored.refresh && previous) stored.refresh = (JSON.parse(previous) as Stored).refresh
  await ctx.vault.set(tokenAccount(provider), JSON.stringify(stored))
  await ctx.vault.remove(pendingAccount(provider))
}

// Gültiges Access-Token; erneuert über das Refresh-Token (Netzaufruf, nur im Zug einer Nutzer-/Orbi-Aktion).
export async function oauth2AccessToken(
  ctx: ProviderContext,
  provider: string,
  endpoints: OAuth2Endpoints,
  trigger: Trigger
): Promise<string | null> {
  const raw = await ctx.vault.get(tokenAccount(provider))
  if (!raw) return null
  const stored = JSON.parse(raw) as Stored
  if (!stored.expiresAt || stored.expiresAt - 60_000 > ctx.now()) return stored.access
  if (!stored.refresh) return null
  const fresh = await call(ctx, provider, "oauth.refresh", trigger, () =>
    tokenRequest(ctx, provider, endpoints, { grant_type: "refresh_token", refresh_token: stored.refresh! })
  )
  if (!fresh.refresh) fresh.refresh = stored.refresh
  await ctx.vault.set(tokenAccount(provider), JSON.stringify(fresh))
  return fresh.access
}

export async function oauth2Disconnect(ctx: ProviderContext, provider: string) {
  await ctx.vault.remove(tokenAccount(provider))
  await ctx.vault.remove(pendingAccount(provider))
}
