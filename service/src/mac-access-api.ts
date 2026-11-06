import { macAccessEnabled, setMacAccessEnabled } from "../../lib/mac/access.ts"
import { PERMISSIONS, readPermissions, requestPermission, type PermissionId } from "../../lib/mac/permissions.ts"

// Einstellungen › Allgemein › Mac-Zugriff: Schalter und Status der macOS-Rechte (TCC) des Dienstes.
export async function macAccessRoute() {
  return { enabled: macAccessEnabled(), permissions: await readPermissions() }
}

export async function setMacAccessRoute(body: unknown) {
  const enabled = (body as { enabled?: unknown } | null)?.enabled
  if (typeof enabled !== "boolean") return { ok: false, error: "enabled fehlt." }
  setMacAccessEnabled(enabled)
  return { ok: true, enabled }
}

export async function requestMacPermissionRoute(body: unknown) {
  const id = (body as { id?: unknown } | null)?.id
  if (typeof id !== "string" || !PERMISSIONS.some((p) => p.id === id)) return { ok: false, error: "Unbekannte Berechtigung." }
  const permission = await requestPermission(id as PermissionId)
  return { ok: true, permission }
}
