// Anbindung der offiziellen CLIs (claude, codex, gemini). Gemeinsame Typen.
export type CliProvider = "claude" | "codex" | "gemini" | "agy"
export const CLI_PROVIDERS: CliProvider[] = ["claude", "codex", "gemini", "agy"]

export const CLI_LABELS: Record<CliProvider, string> = { claude: "Claude", codex: "GPT (Codex)", gemini: "Gemini", agy: "Google (Antigravity)" }

// So behebst du es: ein Satz je Anbieter und Fehlerart. Nie Zugangsdaten.
export const CLI_FIX: Record<CliProvider, { missing: string; login: string }> = {
  claude: {
    missing: "Installiere die Claude-CLI (claude.ai/code) und melde dich mit „claude auth login“ an.",
    login: "Melde dich im Terminal mit „claude auth login“ an (Abo-Login).",
  },
  codex: {
    missing: "Installiere die Codex-CLI mit „npm i -g @openai/codex“ und melde dich mit „codex login“ an.",
    login: "Melde dich im Terminal mit „codex login“ an (ChatGPT-Login).",
  },
  agy: {
    missing: "Antigravity-CLI fehlt. Richte agy ein.",
    login: "Melde dich selbst bei Antigravity an.",
  },
  gemini: {
    missing: "Gemini-CLI fehlt: installiere sie mit „npm i -g @google/gemini-cli“ und melde dich beim ersten Start an.",
    login: "Starte „gemini“ einmal im Terminal und melde dich mit deinem Google-Konto an.",
  },
}

export type CliErrorCode = "missing" | "login" | "limit" | "timeout" | "failed" | "aborted"

// Fehler mit fertigem deutschem Satz; die Meldung ist direkt für Consti lesbar und enthält nie Zugangsdaten.
export class CliError extends Error {
  readonly code: CliErrorCode
  readonly provider: CliProvider
  constructor(provider: CliProvider, code: CliErrorCode, message: string) {
    super(message)
    this.name = "CliError"
    this.provider = provider
    this.code = code
  }
}

export const missingError = (provider: CliProvider) =>
  new CliError(provider, "missing", `${CLI_LABELS[provider]} ist nicht installiert. ${CLI_FIX[provider].missing}`)
export const loginError = (provider: CliProvider) =>
  new CliError(provider, "login", `${CLI_LABELS[provider]} ist nicht angemeldet. ${CLI_FIX[provider].login}`)

export type CliUsage = {
  input?: number // alle Eingabe-Token (ungecacht + gelesen + geschrieben), falls gemeldet
  noCache?: number
  cacheRead?: number
  cacheWrite?: number
  output?: number
  reasoning?: number
}

// Was ein Anbieter-Adapter aus der Ausgabe der CLI liefert.
export type CliEvent =
  | { kind: "text"; delta: string }
  | { kind: "usage"; usage: CliUsage }
  | { kind: "error"; code: CliErrorCode; message: string }
  | { kind: "done" }

export type CliImage = { mediaType: string; base64: string }

export type CliRun = {
  provider: CliProvider
  model: string // Name für die CLI
  effort?: string
  system: string
  user: string
  images: CliImage[]
  signal?: AbortSignal
}

// Ein Prozess-Start: Programm, Argumente, Stdin, Arbeitsordner, Umgebung. Austauschbar für Tests (Attrappen).
export type CliSpawn = {
  command: string
  args: string[]
  stdin: string
  cwd: string
  env: Record<string, string>
}
// Liefert Zeilen der Standardausgabe; wirft CliError bei Prozessfehler. Beendet sich, wenn der Prozess endet.
export type ProcessRunner = (spawn: CliSpawn, options: { signal?: AbortSignal; timeoutMs: number }) => AsyncIterable<string>
