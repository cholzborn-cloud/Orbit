// Client-sicher: nur Formen, keine Keys.
export type UsageProvider = "claude" | "codex" | "antigravity"

// ok = Werte da · limit = ausgeschöpft · offline = Dienst nicht erreichbar · error = Abfrage fehlgeschlagen
export type UsageStatus = "ok" | "limit" | "offline" | "error"

// used 0..1, resetAt in ms seit Epoche.
export type UsageWindow = { name: "5h" | "7d"; used: number; resetAt: number }

export type AccountUsage = {
  id: string // Kennung des angezeigten Kontos
  label: string // Anzeigename des Kontos
  status: UsageStatus
  windows: UsageWindow[]
  note?: string
}

export type ProviderUsage = {
  provider: UsageProvider
  status: UsageStatus // Status des ersten Kontos mit Daten, sonst schlechtester
  accounts: AccountUsage[]
  note?: string
}

export type UsageResult =
  | { ok: true; providers: ProviderUsage[]; fetchedAt: number }
  | { ok: false; error: string }
