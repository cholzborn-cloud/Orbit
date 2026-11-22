import { resetJevPause } from "@/lib/jev/client"
import { resetDaytonaClient } from "@/lib/chat/sandbox-tools"

import { keyStatus, loadKeychainSecrets, MANAGED_KEYS } from "./keychain"

// Schlüssel setzen/ersetzen: die Mac-App schreibt in den Schlüsselbund und ruft dann reload. Zurück kommt nur „gesetzt“ oder nicht,
// nie ein Wert; die Schlüssel werden nirgends angezeigt oder geloggt.
export function listKeys() {
  return { ok: true, keys: keyStatus() }
}

export async function reloadKeys(body: unknown, load = loadKeychainSecrets) {
  const requested = (body as { names?: unknown } | null)?.names
  const names = Array.isArray(requested)
    ? requested.filter((name): name is string => typeof name === "string" && MANAGED_KEYS.some((key) => key.name === name))
    : MANAGED_KEYS.map((key) => key.name)
  const { loaded } = await load({ names, override: true })
  if (loaded.includes("DAYTONA_API_KEY")) resetDaytonaClient()
  if (loaded.includes("OPENROUTER_JEV_API_KEY")) resetJevPause()
  return {
    ok: true,
    keys: keyStatus(),
        needsRestart: loaded.filter((name) => MANAGED_KEYS.find((key) => key.name === name)?.liveReload === false),
  }
}
