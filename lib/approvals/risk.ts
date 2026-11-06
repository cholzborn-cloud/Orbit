import { looksLikeSecret } from "../orbi/memory.ts"
import { classifyAppleScript, classifyMacShell, classifyShortcut } from "../mac/risk.ts"

// Eine feste Freigabe-Regel: nur sieben Arten von Aktionen fragen, alles andere läuft sofort.
// Feste Grenzen (Consti, 04.11.): Geld, Veröffentlichen, Nachricht in seinem Namen, endgültig Löschen, Zugangsdaten, System.
// "dauerhaft" bleibt nur für die Orbi-Anlage (Sandbox); Notizen, Kalender, Automationen laufen frei.
export const RISK_REASONS = [
  "geld",
  "veroeffentlichen",
  "nachricht",
  "loeschen",
  "geheimnis",
  "system",
  "dauerhaft",
] as const
export type RiskReason = (typeof RISK_REASONS)[number]

export const REASON_LABELS: Record<RiskReason, string> = {
  geld: "Geld ausgeben",
  veroeffentlichen: "Veröffentlichen",
  nachricht: "Nachricht in deinem Namen",
  loeschen: "Endgültig löschen",
  geheimnis: "Zugangsdaten",
  system: "Systemeingriff",
  dauerhaft: "Dauerhafte Änderung",
}

// Eine einzelne Aktion einer Freigabe. Ein Zitat von Consti muss jede Aktion abdecken:
// Art-Wort plus je Gruppe in `targets` mindestens eine Schreibweise (Pfad, Empfänger, Betrag).
export type ActionPart = { reason: RiskReason; targets: string[][] }

export type Risk =
  | { ask: false }
  | {
      ask: true
      reason: RiskReason
      kind: string
      text: string
      // Voller Klartext für die Karte (nicht gekürzt), z. B. Plan und Prompt einer Automation.
      detail?: string
      parts?: ActionPart[]
    }

// Herkunft eines Plugin-Werkzeugs; Annotationen kommen vom fremden Server.
export type ToolMeta = {
  connectorName?: string
  mcpName?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  override?: { ask?: Record<string, RiskReason>; free?: string[] }
}

const FREE: Risk = { ask: false }
const clip = (value: string, max = 120) =>
  value.length > max ? `${value.slice(0, max - 1)}…` : value

// Werkzeuge, die je nach Eingabe fragen können; nur sie bekommen consti_said.
export function mayAsk(toolName: string) {
  return (
    toolName === "bash" ||
    toolName === "mac_shell" ||
    toolName === "mac_applescript" ||
    toolName === "mac_shortcut" ||
    toolName === "create_orbi" ||
    toolName === "confirm_action" ||
    toolName.startsWith("connector:")
  )
}

export function classifyTool(
  toolName: string,
  input: unknown,
  meta?: ToolMeta
): Risk {
  const args = (
    input && typeof input === "object" ? input : {}
  ) as Record<string, unknown>
  if (toolName === "bash")
    return typeof args.command === "string"
      ? classifyBash(args.command)
      : FREE
  // Lokale Mac-Werkzeuge (lib/mac): Shell, AppleScript, Kurzbefehle; Dateien, Kalender & Co. sind umkehrbar und frei.
  if (toolName === "mac_shell") return typeof args.command === "string" ? classifyMacShell(args.command) : FREE
  if (toolName === "mac_applescript") return typeof args.script === "string" ? classifyAppleScript(args.script) : FREE
  if (toolName === "mac_shortcut") return typeof args.name === "string" ? classifyShortcut(args.name) : FREE
  if (toolName === "confirm_action") {
    const reason = RISK_REASONS.includes(args.reason as RiskReason)
      ? (args.reason as RiskReason)
      : "nachricht"
    const summary = typeof args.summary === "string" ? args.summary : ""
    return {
      ask: true,
      reason,
      kind: `desktop:${reason}`,
      text: clip(summary.trim() || REASON_LABELS[reason]),
    }
  }
  // Termin ändern ist frei; Löschen (endgültig) und Einladen (Nachricht) fragen.
  if (["apple_calendar_delete", "apple_calendar_invite"].includes(toolName)) {
    const reason: RiskReason = toolName === "apple_calendar_delete" ? "loeschen" : "nachricht"
    const action = toolName === "apple_calendar_delete" ? "Löscht" : "Lädt ein zu"
    const eventTitle = typeof args.eventTitle === "string" ? args.eventTitle : "?"
    const calendar = typeof args.calendar === "string" ? args.calendar : "?"
    const detail = toolName === "apple_calendar_invite" ? `\nEmpfänger: ${String(args.recipient ?? "?")}` : ""
    return { ask: true, reason, kind: toolName, text: clip(`${action} Termin „${eventTitle}“ in „${calendar}“`), detail: `Kalender: ${calendar}\nTermin: ${eventTitle}\nBisheriger Beginn: ${String(args.eventStart ?? "?")}\nUmfang: ${args.series === true ? "gesamte Terminserie" : "einzelner Termin"}\nBisherige Teilnehmer: ${Array.isArray(args.attendees) && args.attendees.length ? args.attendees.join("; ") : "keine"}${Array.isArray(args.attendees) && args.attendees.length ? "\nBestehende Teilnehmer können eine Benachrichtigung erhalten." : ""}${detail}` }
  }
  if (toolName === "create_orbi") {
    const name = typeof args.name === "string" ? args.name.trim() : ""
    const job = typeof args.job === "string" ? args.job.trim() : ""
    return { ask: true, reason: "dauerhaft", kind: "create_orbi", text: clip(`Legt Orbi „${name || "?"}“ an`), detail: `Name: ${name}\nAufgabe: ${job}\nDazu wird eine Sandbox erstellt.`, parts: [{ reason: "dauerhaft", targets: [[name]] }] }
  }
  if (toolName.startsWith("connector:"))
    return classifyConnector(toolName, args, meta)
  return FREE
}

// Wortteile aus snake_case, kebab-case, Punkten und camelCase.
function words(name: string) {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
}

const NAME_RULES: [RiskReason, string[]][] = [
  ["geheimnis", ["secret", "token", "credential", "api_key", "password"]],
  ["loeschen", ["delete", "remove", "destroy", "drop", "wipe", "purge", "erase", "empty_trash"]],
  ["geld", ["pay", "purchase", "buy", "checkout", "order", "subscribe", "transfer", "charge", "refund", "invoice_send"]],
  ["veroeffentlichen", ["publish", "post", "tweet", "deploy", "release", "share_public", "make_public", "go_live"]],
  ["nachricht", ["send", "reply", "forward", "message", "comment", "invite", "email", "dm", "notify", "respond"]],
]

// Vermutung: get_order oder list_message lesen nur; bei Zugangsdaten gilt das nicht.
const READ_VERBS = new Set(["get", "list", "search", "read", "fetch", "find", "query", "view", "lookup", "describe", "count"])

function nameReason(name: string): RiskReason | undefined {
  const parts = words(name)
  const joined = `_${parts.join("_")}_`
  for (const [reason, patterns] of NAME_RULES) {
    if (!patterns.some((pattern) => joined.includes(`_${pattern}_`))) continue
    if (reason !== "geheimnis" && READ_VERBS.has(parts[0] ?? "")) continue
    return reason
  }
  return undefined
}

const CONNECTOR_TEXT: Record<RiskReason, string> = {
  geld: "Gibt Geld aus",
  veroeffentlichen: "Veröffentlicht etwas",
  nachricht: "Sendet eine Nachricht in deinem Namen",
  loeschen: "Löscht endgültig",
  geheimnis: "Liest oder gibt Zugangsdaten weiter",
  system: "Greift ins System ein",
  dauerhaft: "Ändert etwas dauerhaft",
}

// Alle Empfänger als einzelne Werte (Liste oder Komma-getrennt), jeder muss im Zitat stehen.
function recipients(args: Record<string, unknown>) {
  const out: string[] = []
  for (const key of ["to", "cc", "bcc", "recipient", "recipients", "channel", "email"]) {
    const value = args[key]
    const list = Array.isArray(value) ? value : [value]
    for (const item of list)
      if (typeof item === "string")
        out.push(...item.split(/[,;]/).map((v) => v.trim()).filter(Boolean))
  }
  return out
}

function recipient(args: Record<string, unknown>) {
  return recipients(args).join(", ")
}

// Beträge als Schreibweisen: 49.99 und 49,99, bei ganzen Zahlen auch ohne Nachkommastellen.
function amounts(args: Record<string, unknown>) {
  const out: string[][] = []
  for (const [key, value] of Object.entries(args)) {
    if (!/amount|price|total|betrag|sum|cost|preis|value/i.test(key)) continue
    const number =
      typeof value === "number"
        ? value
        : typeof value === "string" && /^\s*\d+([.,]\d+)?\s*$/.test(value)
          ? Number(value.replace(",", "."))
          : NaN
    if (!Number.isFinite(number)) continue
    const dot = String(number)
    out.push([...new Set([dot, dot.replace(".", ","), number.toFixed(2), number.toFixed(2).replace(".", ",")])])
  }
  return out
}

// Nur erkennbare, harmlose Angaben landen in der Freigabe; unbekannte Formen werden ausdrücklich benannt.
function approvalDetail(reason: RiskReason, args: Record<string, unknown>): string | undefined {
  if (!["nachricht", "geld", "geheimnis"].includes(reason)) return undefined
  if (reason === "geheimnis") return "Zugangsdaten werden nicht angezeigt. Prüfe, welchem Dienst du den Zugriff erlaubst."
  const fields: Record<string, string[]> = reason === "nachricht"
    ? { "Empfänger": ["to", "cc", "bcc", "recipient", "recipients", "channel", "email"], "Betreff": ["subject", "betreff"], "Entwurf": ["body", "text", "message", "content", "draft"] }
    : { "Betrag": ["amount", "price", "total", "betrag", "sum", "cost", "preis"], "Währung": ["currency", "waehrung", "währung"] }
  const found = new Map<string, string[]>()
  function visit(value: unknown, depth: number) {
    if (depth > 5 || !value || typeof value !== "object") return
    for (const [key, item] of Object.entries(value)) {
      if (/secret|password|passwort|token|api.?key|credential/i.test(key)) continue
      const label = Object.entries(fields).find(([, names]) => names.includes(key.toLowerCase()))?.[0]
      const values = Array.isArray(item) ? item : [item]
      if (label) for (const value of values) {
        if (typeof value !== "string" && typeof value !== "number") continue
        const text = String(value).trim()
        if (!text) continue
        const safe = looksLikeSecret(text) ? "[Inhalt enthält möglicherweise Zugangsdaten und wird nicht angezeigt]" : text
        const list = found.get(label) ?? []
        if (list.length < 10) list.push(safe.length > 4000 ? `${safe.slice(0, 4000)}… [gekürzt]` : safe)
        else if (list.length === 10) list.push("[weitere Angaben nicht angezeigt]")
        found.set(label, list)
      }
      if (item && typeof item === "object") visit(item, depth + 1)
    }
  }
  visit(args, 0)
  const lines = [...found].map(([label, values]) => `${label}: ${values.join(", ")}`)
  const required = reason === "nachricht" ? "Entwurf" : "Betrag"
  if (!found.has(required)) lines.push(`${required} konnte nicht automatisch erkannt werden.`)
  return lines.join("\n")
}

function classifyConnector(
  toolName: string,
  args: Record<string, unknown>,
  meta?: ToolMeta
): Risk {
  const name = meta?.mcpName ?? toolName.split(":").slice(2).join(":")
  const ask = (reason: RiskReason): Risk => {
    const to = reason === "nachricht" ? recipient(args) : ""
    const via = meta?.connectorName ? ` über ${meta.connectorName}` : ""
    const targets =
      reason === "nachricht"
        ? recipients(args).map((r) => [r])
        : reason === "geld"
          ? amounts(args)
          : []
    const detail = approvalDetail(reason, args)
    return {
      ask: true,
      reason,
      kind: toolName,
      text: clip(`${CONNECTOR_TEXT[reason]}${to ? ` an ${to}` : ""}${via} (${name})`),
      ...(detail && { detail }),
      parts: [{ reason, targets }],
    }
  }
  const override = meta?.override
  if (override?.ask?.[name] && RISK_REASONS.includes(override.ask[name]))
    return ask(override.ask[name])
  if (override?.free?.includes(name)) return FREE
  // Vermutung: der Name sagt die Art genauer als destructiveHint; fragen muss es in beiden Fällen.
  const reason = nameReason(name)
  if (reason) return ask(reason)
  if (meta?.destructiveHint === true) return ask("loeschen")
  return FREE
}

// ---- bash ----

const PREFIXES = new Set(["nohup", "time", "command", "exec", "builtin", "nice", "stdbuf", "timeout"])
const SHELLS = new Set(["bash", "sh", "zsh", "dash"])

// Einfaches Zerlegen in Wörter mit Anführungszeichen; reicht für die Einstufung.
function tokenize(segment: string) {
  const tokens: string[] = []
  let current = ""
  let quote: string | null = null
  let started = false
  for (let i = 0; i < segment.length; i++) {
    const char = segment[i]!
    if (quote) {
      if (char === quote) quote = null
      else if (char === "\\" && quote === '"' && i + 1 < segment.length)
        current += segment[++i]
      else current += char
    } else if (char === "'" || char === '"') {
      quote = char
      started = true
    } else if (char === "\\" && i + 1 < segment.length) {
      current += segment[++i]
      started = true
    } else if (/\s/.test(char)) {
      if (started) tokens.push(current)
      current = ""
      started = false
    } else {
      current += char
      started = true
    }
  }
  if (started) tokens.push(current)
  return tokens
}

// Trennt an ; && || | Zeilenumbruch, $( ) und Backticks, ohne in Anführungszeichen zu schneiden.
function segments(command: string) {
  const out: string[] = []
  let current = ""
  let quote: string | null = null
  for (let i = 0; i < command.length; i++) {
    const char = command[i]!
    if (quote) {
      if (char === quote) quote = null
      else if (char === "\\" && quote === '"') {
        current += char + (command[i + 1] ?? "")
        i++
        continue
      } else if (quote === '"' && char === "$" && command[i + 1] === "(") {
        // Befehlsersetzung in "…" läuft trotzdem: eigenes Segment.
        out.push(current)
        current = ""
        i++
        continue
      }
      current += char
      continue
    }
    if (char === "'" || char === '"') {
      quote = char
      current += char
    } else if (char === "\\") {
      current += char + (command[++i] ?? "")
    } else if (char === "$" && command[i + 1] === "(") {
      out.push(current)
      current = ""
      i++
    } else if (";|&\n`()".includes(char)) {
      out.push(current)
      current = ""
    } else current += char
  }
  out.push(current)
  return out.map((s) => s.trim()).filter(Boolean)
}

function normalize(path: string) {
  const absolute = path.startsWith("/")
  const parts: string[] = []
  for (const part of path.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") parts.pop()
    else parts.push(part)
  }
  return (absolute ? "/" : "") + parts.join("/")
}

const underTmp = (path: string) =>
  path.startsWith("/") && normalize(path).startsWith("/tmp/")
const targets = (args: string[]) => args.filter((a) => !a.startsWith("-"))

type Hit = { reason: RiskReason; detail: string; targets?: string[][]; more?: Hit[] }

// Pfad oder Host, wie Consti ihn sagen würde: ganz oder nur der letzte Teil.
const pathTarget = (path: string) => {
  const trimmed = path.replace(/\/+$/, "")
  const last = trimmed.split("/").pop() ?? trimmed
  return [...new Set([path, trimmed, last].filter(Boolean))]
}
const hostTarget = (host: string) => [
  host,
  host.replace(/^https?:\/\//i, "").replace(/[/?#].*$/, ""),
]

const SECRET_PATTERNS = [
  /(^|[\s/'"=:<>])secrets\.env\b/,
  /(^|[\s/'"=:<>])\.env(\.[\w.-]+)?($|[\s'"<>;|&)])/,
  /\.pem\b/,
  /\bid_(rsa|ed25519|ecdsa|dsa)\b/,
  /(~|\$HOME|\/home\/[\w.-]+|\/root|\/Users\/[\w.-]+)\/\.(ssh|aws)\b/,
  /\bsecurity\s+(find|dump)-/,
  /\$\{?[A-Za-z_]*(KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Za-z_]*\}?/,
]

const LOCAL_HOST = /^(https?:\/\/)?(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)([:/]|$)/i

function classifySegment(segment: string, depth: number): Hit | undefined {
  let tokens: string[] = []
  // Redirects (2>/dev/null, > out.txt) sind keine Ziele des Befehls.
  const raw = tokenize(segment)
  for (let i = 0; i < raw.length; i++) {
    if (/^\d*(>>?|<)&?$/.test(raw[i]!)) i++
    else if (!/^\d*(>>?|<)/.test(raw[i]!)) tokens.push(raw[i]!)
  }
  // Zuweisungen vorne abwerfen, Präfixe überspringen.
  while (tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0]!))
    tokens = tokens.slice(1)
  if (!tokens.length) return undefined
  const head = tokens[0]!.split("/").pop()!
  const rest = tokens.slice(1)
  if (head === "sudo" || head === "su" || head === "doas")
    return { reason: "system", detail: segment }
  // Präfixe wie timeout 10 oder xargs -I {}: jeden möglichen Befehlsanfang prüfen.
  if (PREFIXES.has(head) || head === "xargs") {
    for (const [index, token] of rest.entries()) {
      if (token.startsWith("-")) continue
      const hit = classifySegment(rest.slice(index).join(" "), depth)
      if (hit) return hit
    }
    return undefined
  }
  if (head === "env") {
    const command = rest.filter((t) => !t.startsWith("-") && !/^[A-Za-z_]\w*=/.test(t))
    if (!command.length) return { reason: "geheimnis", detail: segment }
    return classifySegment(command.join(" "), depth)
  }
  if (head === "printenv") return { reason: "geheimnis", detail: segment }
  if (SHELLS.has(head) && depth < 4) {
    const flag = rest.findIndex((t) => /^-\w*c\w*$/.test(t))
    if (flag >= 0 && rest[flag + 1]) {
      const inner = classifyCommandAll(rest[flag + 1]!, depth + 1)
      if (inner[0]) return { ...inner[0], more: inner.slice(1) }
    }
  }
  if (
    ["systemctl", "service", "launchctl", "crontab", "update-rc.d", "chkconfig"].includes(head) ||
    (head === "defaults" && rest[0] === "write")
  )
    return { reason: "system", detail: segment }
  if (["rm", "rmdir", "shred", "unlink", "truncate"].includes(head)) {
    const paths = targets(
      rest.filter((_, i) => !(head === "truncate" && ["-s", "--size"].includes(rest[i - 1] ?? "")))
    )
    if (!paths.length || !paths.every(underTmp))
      return { reason: "loeschen", detail: paths.join(" ") || segment, targets: paths.map(pathTarget) }
  }
  const execRemoves = rest.some(
    (t, i) => (t === "-exec" || t === "-execdir") && /^(rm|rmdir|shred|unlink)$/.test(rest[i + 1] ?? "")
  )
  if (head === "find" && (rest.includes("-delete") || execRemoves)) {
    const end = rest.findIndex((t) => t.startsWith("-") || t === "(" || t === "!")
    const roots = rest.slice(0, end < 0 ? rest.length : end)
    if (!roots.length || !roots.every(underTmp))
      return { reason: "loeschen", detail: roots.join(" ") || segment, targets: roots.map(pathTarget) }
  }
  // Nur der Unterbefehl zählt (git log --grep clean löscht nichts); -C/-c tragen einen Wert.
  const gitCommand = rest.find(
    (t, i) => !t.startsWith("-") && !["-C", "-c"].includes(rest[i - 1] ?? "")
  )
  if (head === "git" && gitCommand === "clean")
    return { reason: "loeschen", detail: segment }
  if (head === "curl" || head === "wget") {
    const upload = rest.some((t) =>
      head === "curl"
        ? /^(-d|--data.*|-F|--form.*|-T|--upload-file|--json)$/.test(t) ||
          /^-[a-zA-Z]*[dFT]./.test(t)
        : /^--(post|body|method=(POST|PUT|PATCH))/i.test(t)
    )
    const hosts = rest.filter((t) => /^(https?:\/\/|[\w-]+\.[\w.-]+(:\d+)?(\/|$))/.test(t))
    if (upload && !(hosts.length && hosts.every((h) => LOCAL_HOST.test(h))))
      return { reason: "nachricht", detail: hosts.join(" ") || segment, targets: hosts.map(hostTarget) }
  }
  // /etc/ beschreiben (Redirect, tee, cp, mv, sed -i, install).
  if (
    (["tee", "cp", "mv", "install", "ln"].includes(head) &&
      rest.some((t) => t.startsWith("/etc/"))) ||
    (head === "sed" && rest.some((t) => t.startsWith("-i")) && rest.some((t) => t.startsWith("/etc/")))
  )
    return { reason: "system", detail: segment }
  return undefined
}

const SEVERITY: RiskReason[] = ["system", "geheimnis", "loeschen", "geld", "veroeffentlichen", "nachricht", "dauerhaft"]

// Alle Treffer, schwerster zuerst: ein Zitat muss jede Teilaktion einzeln abdecken.
function classifyCommandAll(command: string, depth = 0): Hit[] {
  const hits: Hit[] = []
  if (/>{1,2}\s*["']?\/etc\//.test(command)) hits.push({ reason: "system", detail: command })
  if (SECRET_PATTERNS.some((pattern) => pattern.test(command)))
    hits.push({ reason: "geheimnis", detail: command })
  for (const segment of segments(command)) {
    const hit = classifySegment(segment, depth)
    if (hit) hits.push(hit, ...(hit.more ?? []))
  }
  hits.sort((a, b) => SEVERITY.indexOf(a.reason) - SEVERITY.indexOf(b.reason))
  return hits
}

const BASH_TEXT: Record<RiskReason, string> = {
  geld: "Gibt Geld aus",
  veroeffentlichen: "Veröffentlicht etwas",
  nachricht: "Schickt Daten nach außen an",
  loeschen: "Löscht endgültig",
  geheimnis: "Liest Zugangsdaten",
  system: "Greift ins System ein",
  dauerhaft: "Ändert etwas dauerhaft",
}

export function classifyBash(command: string): Risk {
  const all = classifyCommandAll(command)
  const hit = all[0]
  if (!hit) return FREE
  const detail = hit.reason === "loeschen" || hit.reason === "nachricht" ? hit.detail : command
  return {
    ask: true,
    reason: hit.reason,
    kind: `bash:${hit.reason}`,
    text: clip(`${BASH_TEXT[hit.reason]}: ${detail.trim()}`),
    parts: all.map((h) => ({ reason: h.reason, targets: h.targets ?? [] })),
  }
}
