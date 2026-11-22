import {
  auth,
  type OAuthClientInformation,
  type OAuthClientProvider,
  type OAuthTokens,
} from "@ai-sdk/mcp"
import { randomBytes } from "node:crypto"

import { decryptConnectorAuth, encryptConnectorAuth } from "./crypto.ts"
import { resolveConnectorUrl } from "./url-guard.ts"

export type OAuthState = {
  clientInfo?: OAuthClientInformation
  tokens?: OAuthTokens
  expiresAt?: number
  verifier?: string
  state?: string
}
export type OAuthStore = {
  load(): Promise<string | null>
  save(value: string | null): Promise<void>
}

// Mit lokalem Dienst nimmt dieser den Rücksprung entgegen (127.0.0.1, nicht localhost: der Host-Check des Dienstes); ohne Dienst die Web-App.
export const oauthRedirectUrl = () =>
  process.env.NEXT_PUBLIC_ORBITD_URL
    ? `${process.env.NEXT_PUBLIC_ORBITD_URL}/oauth/callback`
    : `${process.env.ORBIT_APP_URL ?? "http://localhost:3000"}/api/connectors/oauth/callback`

export function readOAuth(value: string | null): OAuthState {
  if (!value) return {}
  const plain = decryptConnectorAuth(value)
  if (!plain.ok) return {}
  try {
    return JSON.parse(plain.value) as OAuthState
  } catch {
    return {}
  }
}
export const oauthConnected = (value: string | null) =>
  !!readOAuth(value).tokens

// Metadaten-Abrufe des Servers dürfen nur auf öffentliche HTTPS-Ziele gehen.
const guardedFetch: typeof fetch = async (input, init) => {
  const url =
    typeof input === "string" || input instanceof URL ? input : input.url
  const guarded = await resolveConnectorUrl(url.toString())
  if (!guarded.ok) throw new Error(guarded.error)
  return fetch(input, { ...init, redirect: "error" })
}

function provider(
  store: OAuthStore,
  onRedirect?: (url: URL) => void
): OAuthClientProvider {
  const read = async () => readOAuth(await store.load())
  const patch = async (change: Partial<OAuthState>) => {
    const encrypted = encryptConnectorAuth(
      JSON.stringify({ ...(await read()), ...change })
    )
    if (!encrypted.ok) throw new Error(encrypted.error)
    await store.save(encrypted.value)
  }
  return {
    redirectUrl: oauthRedirectUrl(),
    clientMetadata: {
      client_name: "Orbit",
      redirect_uris: [oauthRedirectUrl()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
    tokens: async () => (await read()).tokens,
    saveTokens: (tokens) =>
      patch({
        tokens,
        expiresAt: tokens.expires_in
          ? Date.now() + tokens.expires_in * 1000
          : undefined,
      }),
    redirectToAuthorization: (url) => onRedirect?.(url),
    saveCodeVerifier: (verifier) => patch({ verifier }),
    codeVerifier: async () => (await read()).verifier ?? "",
    clientInformation: async () => (await read()).clientInfo,
    saveClientInformation: (clientInfo) => patch({ clientInfo }),
    state: async () => randomBytes(16).toString("hex"),
    saveState: (state) => patch({ state }),
    storedState: async () => (await read()).state,
  }
}

export async function startOAuth(store: OAuthStore, serverUrl: string) {
  let url: URL | undefined
  await store.save(null)
  const result = await auth(
    provider(store, (u) => (url = u)),
    {
      serverUrl,
      fetchFn: guardedFetch,
    }
  )
  return result === "AUTHORIZED" || !url
    ? ({ authorized: true } as const)
    : ({ authorized: false, url: url.toString() } as const)
}

export async function finishOAuth(
  store: OAuthStore,
  serverUrl: string,
  code: string,
  state: string
) {
  await auth(provider(store), {
    serverUrl,
    authorizationCode: code,
    callbackState: state,
    fetchFn: guardedFetch,
  })
}

// Der State gilt nur für einen Rücksprung.
export async function clearOAuthState(store: OAuthStore) {
  const rest = readOAuth(await store.load())
  delete rest.state
  const encrypted = encryptConnectorAuth(JSON.stringify(rest))
  if (!encrypted.ok) throw new Error(encrypted.error)
  await store.save(encrypted.value)
}

// Gültiges Access-Token; erneuert still über das Refresh-Token, null wenn neue Anmeldung nötig.
export async function oauthAccessToken(store: OAuthStore, serverUrl: string) {
  const state = readOAuth(await store.load())
  if (!state.tokens) return null
  if (state.expiresAt && state.expiresAt - 60_000 < Date.now()) {
    try {
      if (
        (await auth(provider(store), { serverUrl, fetchFn: guardedFetch })) !==
        "AUTHORIZED"
      )
        return null
    } catch {
      return null
    }
  }
  return readOAuth(await store.load()).tokens?.access_token ?? null
}
