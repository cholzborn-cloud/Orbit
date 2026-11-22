// Rohfehler aus Diensten und Browser in klare deutsche Sätze übersetzen.
// Reihenfolge zählt: spezifisch vor allgemein.

// HTTP-Status nur mit Kontext ("status 401", "HTTP 504", "Error: 429") oder am Textanfang:
// nackte Zahlen träfen Dateinamen und Zeilennummern.
const status = (codes: string) =>
  `(?:^|\\b(?:status|http|error|code)\\b[\\s:=]*)(?:${codes})(?!\\.?\\w)`

const RULES: [RegExp, string][] = [
  [
    /active in another tab/i,
    "Dieser Chat ist in einem anderen Tab aktiv. Nutze dort weiter oder schließe den Tab.",
  ],
  [
    // Next maskiert Fehler aus Server Actions im Production-Build.
    /error occurred in the server components render|omitted in production builds/i,
    "Sitzung abgelaufen oder Server-Fehler. Lade die Seite neu und versuche es erneut.",
  ],
  [
    /unbekanntes modell|unknown model|model[_ ]not[_ ]found|no such model/i,
    "Das gewählte Modell ist nicht verfügbar. Wähle ein anderes Modell.",
  ],
  [
    new RegExp(
      `zeitüberschreitung|timed?[ -]?out|ETIMEDOUT|${status("504")}|deadline exceeded`,
      "i"
    ),
    "Zeitüberschreitung: Der Orbi hat nicht rechtzeitig geantwortet. Versuch es noch einmal.",
  ],
  [
    // "forbidden" nicht in Namen wie forbidden_words.
    new RegExp(
      `${status("40[13]")}|unauthorized|(?<![\\w-])forbidden(?![\\w-])|invalid api key`,
      "i"
    ),
    "Zugang abgelehnt. Melde dich bei der CLI des Modells neu an (siehe Einrichtung).",
  ],
  [
    /overloaded/i,
    "Der Anbieter ist gerade überlastet. Versuche es gleich erneut.",
  ],
  [
    new RegExp(`${status("429")}|rate.?limit|too many requests`, "i"),
    "Das Limit des Modells ist erreicht. Warte kurz oder wähle ein anderes Modell.",
  ],
  [
    // Allgemeines "fetch failed" kann von verschiedenen Netzwerkdiensten stammen.
    /ECONNREFUSED|ECONNRESET|ENOTFOUND|socket hang up|connection refused|(?:cannot|can'?t|could not|unable to|failed to) connect/i,
    "Der Dienst ist nicht erreichbar. Läuft er auf diesem Mac?",
  ],
  [
    /failed to fetch|networkerror|network error|load failed/i,
    "Keine Verbindung zum Server. Prüfe dein Netzwerk und versuch es noch einmal.",
  ],
]

export type ChatErrorText = {
  text: string
  // Rohtext des Servers, nur gesetzt wenn er übersetzt wurde.
  detail?: string
}

export function chatErrorText(error: unknown): ChatErrorText {
  const raw = (
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : ""
  ).trim()
  if (!raw) return { text: "Die Antwort ist fehlgeschlagen." }
  const rule = RULES.find(([re]) => re.test(raw))
  return rule ? { text: rule[1], detail: raw } : { text: raw }
}
