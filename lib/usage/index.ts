import "server-only"

import { readClaudeCliUsage } from "./claude-cli"
import { readCodexCliUsage } from "./codex-cli"
import type { ProviderUsage } from "./types"

// fresh: Cache umgehen (Aktualisieren-Knopf).
export async function loadUsage({ fresh = false } = {}): Promise<
  ProviderUsage[]
> {
  const [claude, codex] = await Promise.all([readClaudeCliUsage(fresh), readCodexCliUsage()])
  return [claude, codex, { provider: "antigravity", status: "error", accounts: [], note: "Antigravity meldet über die CLI keine auswertbare Nutzung." }]
}
