import { dirname } from "node:path"

import { getDatabase } from "../db/client.ts"
import { databasePath } from "../db/path.ts"

// Schalter „Orbis dürfen am Mac arbeiten“ (Einstellungen › Allgemein › Mac-Zugriff). Standard: an (Consti, 06.11.2026).
const KEY = "mac_local_tools"

export function macAccessEnabled(): boolean {
  if (process.platform !== "darwin" && !process.env.ORBIT_MAC_TOOLS_ANY_OS) return false
  try {
    const row = getDatabase().$client.prepare("SELECT value FROM app_kv WHERE key = ?").get(KEY) as { value: string } | undefined
    return row?.value !== "off"
  } catch {
    return true
  }
}

export function setMacAccessEnabled(enabled: boolean) {
  getDatabase()
    .$client.prepare(
      `INSERT INTO app_kv (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(KEY, enabled ? "on" : "off", Date.now())
}

export const macDataDir = () => dirname(databasePath())
