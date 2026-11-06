// Kompakter Hinweis für die App (Event `notice`): Werkzeuge selbst bleiben unsichtbar. Es gibt nur zwei Arten:
// "retry" = der Orbi versucht es erneut, "action" = Consti muss etwas tun. Texte kurz, ohne Technikbegriffe, nie Roh-Fehler.
export type Notice = { kind: "retry" | "action"; text: string }

// Werkzeuge, deren Fehler nie ein Hinweis sind (eigene Karten, Entscheidungen von Consti).
const SILENT = new Set(["ask_user", "say", "react", "confirm_action", "onboarding_finish", "onboarding_create_orbis"])

const ACCESS =
  /unauthori[sz]ed|forbidden|permission|not allowed|access denied|\b40[13]\b|zugang verweigert|anmeldung|nicht verbunden|not connected|oauth|berechtigung|erlaub/i

// Fehlertext eines Werkzeugs: Fehler-Chunk (`errorText`) oder Ergebnis mit `error`/`ok:false` (Konnektoren, Karten).
export function failureText(chunk: { type: string; errorText?: string; output?: unknown }): string | null {
  if (chunk.type === "tool-output-error") return chunk.errorText ?? "error"
  const out = chunk.output
  if (out && typeof out === "object") {
    const o = out as { ok?: unknown; error?: unknown }
    if (typeof o.error === "string" && (o.ok === false || o.ok === undefined)) return o.error
  }
  return null
}

export function noticeFor(tool: string, failure: string): Notice | null {
  if (SILENT.has(tool)) return null
  if (ACCESS.test(failure)) {
    const name = /^Konnektor ([^:]{1,40}):/.exec(failure)?.[1]?.trim()
    return {
      kind: "action",
      text: name ? `Bitte verbinde ${name} neu.` : tool.startsWith("connector:") ? "Bitte verbinde den Dienst neu." : "Bitte erlaube den Zugriff.",
    }
  }
  return { kind: "retry", text: "Versuche es erneut …" }
}

// Höchstens 3 Hinweise je Turn und Art/Text nur einmal hintereinander: kein Flackern bei Wiederholungen.
export function createNoticeGate(max = 3) {
  let count = 0
  let last = ""
  return (notice: Notice | null) => {
    if (!notice || count >= max || notice.text === last) return null
    count += 1
    last = notice.text
    return notice
  }
}
