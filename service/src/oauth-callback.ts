import { eq } from "drizzle-orm"

import { clearOAuthState, finishOAuth, readOAuth } from "@/lib/connectors/oauth"
import { pendingOAuthStore, promotePendingOAuth, vaultOAuthStore } from "@/lib/marketplace/oauth-vault-store"
import { vault } from "@/lib/marketplace/vault"
import { db } from "@/lib/db"
import { mcpConnectors } from "@/lib/db/schema"

import { marketplace } from "./marketplace-default"
import { WEB_ORIGIN } from "./security"

// Nur Festtexte im HTML; das Ergebnis geht per postMessage an die Web-App, die das Fenster geöffnet hat.
const page = (message: string, ok: boolean) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><title>Konnektor</title><body style="font-family:system-ui;padding:2rem"><p>${message}</p><script>try{window.opener&&window.opener.postMessage({type:"orbit-connector-oauth",ok:${ok}},${JSON.stringify(WEB_ORIGIN)})}catch(e){}${ok ? "window.close()" : ""}</script>`,
    {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
      },
    }
  )

// Browser-Rücksprung des Anbieters: ohne Token, aber nur mit einem State, den ein Konnektor selbst vergeben hat.
export async function oauthCallback(request: Request) {
  const params = new URL(request.url).searchParams
  const code = params.get("code")
  const state = params.get("state")
  if (params.get("error") || !code || !state)
    return page("Anmeldung abgebrochen oder fehlgeschlagen.", false)
  try {
    // Marktplatz-Anbieter tragen ihren Namen vor dem Punkt im State.
    const providerId = state.split(".")[0] ?? ""
    if (state.includes(".") && marketplace().has(providerId)) {
      const done = await marketplace().finish(params)
      return done.ok
        ? page("Verbunden. Dieses Fenster kann geschlossen werden.", true)
        : page("Anmeldung konnte nicht abgeschlossen werden.", false)
    }
    const rows = await db
      .select()
      .from(mcpConnectors)
      .where(eq(mcpConnectors.userId, "local"))
    // Der State steht im Zwischenspeicher des Schlüsselbunds, nicht mehr in der Datenbank.
    let row: (typeof rows)[number] | undefined
    for (const entry of rows) {
      const pending = readOAuth(await pendingOAuthStore(vault, entry.id).load())
      if (pending.state === state) { row = entry; break }
    }
    if (!row) return page("Anmeldung gehört zu keinem Konnektor.", false)
    await finishOAuth(pendingOAuthStore(vault, row.id), row.url, code, state)
    await promotePendingOAuth(vault, row.id)
    await clearOAuthState(vaultOAuthStore(vault, row.id))
    return page("Verbunden. Dieses Fenster kann geschlossen werden.", true)
  } catch {
    return page("Anmeldung konnte nicht abgeschlossen werden.", false)
  }
}
