// Zugangsdaten gehören nie ins Gedächtnis oder in Skills. Das Gedächtnis selbst liegt seit Lauf H lokal (local-memory.ts);
// das alte MEMORY.md der Sandbox wird nur noch einmalig gelesen und übernommen.
export const MEMORY_SECRET_ERROR =
  "Memory not changed: the text looks like a secret (key, token, password). Never store those."

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}/,
  /\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{16,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bAIza[0-9A-Za-z_-]{30,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{20,}/i,
  /\b(?:password|passwort|passwd|pwd|secret|token|api[_ -]?key|apikey|schlüssel)\s*(?:ist|is|=|:)\s*\S{6,}/i,
  /\b[A-Fa-f0-9]{40,}\b/,
]
export const looksLikeSecret = (text: string) =>
  SECRET_PATTERNS.some((pattern) => pattern.test(text))

export function resolveBaseInstructions(
  value: string | null | undefined,
  fallback: string
) {
  return value || fallback
}
