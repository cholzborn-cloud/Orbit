import type { OAuthStore } from "../connectors/oauth.ts"
import type { Vault } from "./vault.ts"

// OAuth-Zustand eines MCP-Konnektors im Schlüsselbund statt in SQLite (E49). Der Zustand der laufenden Anmeldung (Verifier, State,
// Client-Daten) liegt getrennt von der fertigen Verbindung: ein Abbruch oder Fehler lässt eine bestehende Verbindung unberührt.
export const oauthAccount = (id: string) => `oauth:${id}`
export const oauthPendingAccount = (id: string) => `oauth-pending:${id}`

// Lesen: Schlüsselbund zuerst, sonst der alte, verschlüsselte SQLite-Wert (bleibt unverändert, wird nie neu geschrieben).
// Schreiben: nur Schlüsselbund.
export function vaultOAuthStore(
  vault: Vault,
  id: string,
  legacy?: OAuthStore,
  account = oauthAccount(id)
): OAuthStore {
  return {
    load: async () => (await vault.get(account)) ?? (await legacy?.load()) ?? null,
    save: async (value) => {
      if (value === null) await vault.remove(account)
      else await vault.set(account, value)
    },
  }
}

// Für `startOAuth`/`finishOAuth`: arbeitet nur auf dem Zwischenspeicher.
export const pendingOAuthStore = (vault: Vault, id: string): OAuthStore =>
  vaultOAuthStore(vault, id, undefined, oauthPendingAccount(id))

// Nach erfolgreichem Token-Austausch: Zwischenzustand wird die Verbindung, danach wird er entfernt.
export async function promotePendingOAuth(vault: Vault, id: string) {
  const value = await vault.get(oauthPendingAccount(id))
  if (value === null) throw new Error("Keine laufende Anmeldung.")
  await vault.set(oauthAccount(id), value)
  await vault.remove(oauthPendingAccount(id))
}

// Verbindung trennen: entfernt Verbindung und Zwischenzustand. Der alte SQLite-Wert wird vom Aufrufer wie bisher geleert.
export async function dropOAuth(vault: Vault, id: string) {
  await vault.remove(oauthAccount(id))
  await vault.remove(oauthPendingAccount(id))
}
