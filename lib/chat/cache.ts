// Prompt-Caching bei den CLIs. Die Cache-Marker (cachingFetch / cache_control) entfallen seit der CLI-Umstellung (02.11.2026):
// Die claude-CLI setzt ihre Marker selbst, codex cached automatisch. Orbit sorgt nur für einen stabilen Präfix:
//   System-Prompt + Werkzeugliste bleiben gleich, volatile Angaben stehen im Kontext-Hinweis (CONTEXT_OPEN) weiter hinten im Verlauf.
export const CONTEXT_OPEN = "<orbit_context>"

// Werkzeuge stabil nach Namen sortieren: gleiche Menge = gleiche Reihenfolge im Prompt = gleicher Cache-Präfix.
export function sortTools<T extends Record<string, unknown>>(tools: T): T {
  return Object.fromEntries(Object.entries(tools).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) as T
}
