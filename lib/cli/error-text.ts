import { CliError } from "./types.ts"

export const GENERIC_ERROR =
  "Die Antwort konnte nicht erstellt werden. Prüfe unter Einrichtung, ob die Modell-Anmeldungen (Claude, Codex, Gemini) in Ordnung sind, und versuche es erneut."

// Text für den Chat bei einem Modellfehler: CLI-Fehler tragen schon einen fertigen deutschen Satz (ohne Zugangsdaten).
export function cliErrorText(error: unknown): string {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current; depth++) {
    if (current instanceof CliError) return current.message
    current = (current as { cause?: unknown; lastError?: unknown }).lastError ?? (current as { cause?: unknown }).cause
  }
  return GENERIC_ERROR
}
