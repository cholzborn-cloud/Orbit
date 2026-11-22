import { classifyTool, mayAsk, type ActionPart, type Risk, type RiskReason, type ToolMeta } from "./risk.ts"

// Gespeicherte Regeln: allow = „Immer für diese Art“, deny = Sperre. ask stammt aus der Modus-Zeit und zählt nicht mehr.
export type ApprovalMode = "allow" | "ask" | "deny"
export type ApprovalRule = {
  tool: string
  botId: string | null
  mode: ApprovalMode
}

// Passendes Wort je Art: ein Zitat muss zur Aktion passen, nicht nur irgendwo im Text stehen.
const SAID_WORDS: Record<RiskReason, RegExp> = {
  geld: /kauf|bestell|bezahl|zahl|überweis|abonn|buy|order|pay|checkout|€|euro/,
  veroeffentlichen: /veröffentlich|post|publish|tweet|deploy|release|hochlad|online/,
  nachricht: /schick|send|mail|nachricht|antwort|kommentar|kommentier|einlad|reply|message|benachrichtig|dm\b|schreib/,
  loeschen: /lösch|losch|entfern|delete|remove|\brm\b|vernicht|leer/,
  geheimnis: /secret|token|key|schlüssel|passwort|password|zugang|\.env|credential/,
  system: /sudo|install|system|einstell|dienst|autostart|cron|launchctl|systemctl/,
  dauerhaft: /schreib|notiz|speicher|anleg|erstell|skill|fähigkeit|regel|merk|ergänz|anhäng|notier|write|create|append|save/,
}

const normalizeSaid = (value: string) =>
  value
    .toLowerCase()
    .replace(/[„“”"'«»‚‘’]/g, "")
    .replace(/\s+/g, " ")
    .trim()

// Verneinung im Zitat oder direkt davor/danach („bloß nicht“, „nicht löschen“): dann ist es kein Auftrag.
const NEGATION = /(^|[^a-zäöüß])(nicht|nie|niemals|kein|keine|keinen|keinem|keiner|nichts|nix|stopp|stop|don'?t|do not|never|not)([^a-zäöüß]|$)/
const NEAR = { before: 40, after: 30 }

function negated(said: string, text: string) {
  if (NEGATION.test(said)) return true
  const at = text.indexOf(said)
  if (at < 0) return true
  // Nur im selben Satz suchen.
  const before = text.slice(Math.max(0, at - NEAR.before), at).split(/[.!?\n]/).pop() ?? ""
  const after = text.slice(at + said.length, at + said.length + NEAR.after).split(/[.!?\n]/)[0] ?? ""
  return NEGATION.test(`${before} ${after}`)
}

// Jede Aktion der Freigabe einzeln: Art-Wort und alle Ziele (Pfade, Empfänger, Beträge) stehen im Zitat.
function covers(said: string, part: ActionPart) {
  return (
    SAID_WORDS[part.reason].test(said) &&
    part.targets.every((group) => group.some((t) => t && said.includes(normalizeSaid(t))))
  )
}

// E5: wörtlich aus Constis letzter Nachricht, lang genug, ohne Verneinung, zu jeder Teilaktion passend.
export function constiSaidMatches(
  quote: unknown,
  lastUserText: string | undefined,
  risk: Pick<Extract<Risk, { ask: true }>, "reason" | "parts"> | RiskReason
) {
  if (typeof quote !== "string" || !lastUserText) return false
  const said = normalizeSaid(quote)
  if (said.length < 8 || said.split(" ").length < 2) return false
  const text = normalizeSaid(lastUserText)
  if (!text.includes(said) || negated(said, text)) return false
  const parts: ActionPart[] =
    typeof risk === "string"
      ? [{ reason: risk, targets: [] }]
      : risk.parts?.length
        ? risk.parts
        : [{ reason: risk.reason, targets: [] }]
  return parts.every((part) => covers(said, part))
}

export type ApprovalDecision = { mode: ApprovalMode; risk: Risk }

export function resolveApproval(
  rules: ApprovalRule[] | undefined,
  input: {
    tool: string
    botId: string
    input: unknown
    meta?: ToolMeta
    lastUserText?: string // nur bei Constis eigener Nachricht, nie bei Übergabe oder Automation
  }
): ApprovalDecision {
  const risk = classifyTool(input.tool, input.input, input.meta)
  const kind = risk.ask ? risk.kind : input.tool
  const matches = (rules ?? []).filter(
    (rule) =>
      (rule.tool === input.tool || rule.tool === kind) &&
      (rule.botId === null || rule.botId === input.botId)
  )
  // Alte ask-Regeln aus der Modus-Zeit sind bedeutungslos und werden ignoriert.
  if (matches.some((rule) => rule.mode === "deny")) return { mode: "deny", risk }
  if (!risk.ask) return { mode: "allow", risk }
  const quote = (input.input as { consti_said?: unknown } | null)?.consti_said
  const name = (input.input as { name?: unknown } | null)?.name
  const namedOrbi = input.tool !== "create_orbi" || (typeof quote === "string" && typeof name === "string" && name.trim().length > 0 &&
    /\borbis?\b/i.test(quote) && new RegExp(`(?<![\\p{L}\\p{N}])${name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "iu").test(quote))
  if (mayAsk(input.tool) && namedOrbi && constiSaidMatches(quote, input.lastUserText, risk))
    return { mode: "allow", risk }
  // Für Zugangsdaten gibt es kein „Immer“.
  const always =
    risk.reason !== "geheimnis" &&
    matches.some((rule) => rule.mode === "allow" && rule.tool === risk.kind)
  return { mode: always ? "allow" : "ask", risk }
}

// Nur Textteile der letzten Nutzer-Nachricht; Tool-Ergebnisse, Dateien und Orbi-Zeilen
// (gespeicherte Orbi-Nachrichten haben die Rolle user) zählen nie als Constis Worte.
export function lastUserText(
  messages: { role: string; parts: { type: string; text?: string }[] }[]
) {
  const last = messages.findLast(
    (message) =>
      message.role === "user" &&
      !message.parts.some((part) => part.type === "data-orbi-message")
  )
  return (
    last?.parts.flatMap((part) =>
      part.type === "text" && typeof part.text === "string" ? [part.text] : []
    ) ?? []
  ).join("\n")
}
