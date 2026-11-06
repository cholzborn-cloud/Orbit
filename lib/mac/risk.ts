import { classifyBash, type Risk } from "../approvals/risk.ts"

// Risiko der lokalen Mac-Werkzeuge (Consti, 06.11.2026): frei ist alles Umkehrbare. Rückfrage nur vor Geld, Veröffentlichen,
// Nachrichten in seinem Namen und endgültigem Löschen (plus die bestehenden Grenzen Zugangsdaten/Systemeingriff der Shell).
const FREE: Risk = { ask: false }
const clip = (value: string, max = 120) => (value.length > max ? `${value.slice(0, max - 1)}…` : value)

// `rm`, `rmdir`, `unlink` über den PATH landen im Papierkorb (lib/mac/shim.ts) und sind damit umkehrbar: für die
// Risikoprüfung werden sie durch einen harmlosen Namen ersetzt. Absolute Pfade (/bin/rm) treffen den Shim nicht.
const PATH_REMOVE = /(^|[\s;&|(`"']|\$\(|\bxargs\s+(?:-\S+\s+)*|\bcommand\s+|\benv\s+|\\)(rm|rmdir|unlink)(?=\s|$)/g

// Endgültiges Löschen, an dem der Shim vorbeigeht.
const HARD_DELETE: [RegExp, string][] = [
  [/(^|[\s;&|(`'"])\/(usr\/)?bin\/(rm|rmdir|unlink)\b/, "Löscht am Papierkorb vorbei"],
  [/\bfind\b[^;&|]*\s-delete\b/, "find -delete löscht endgültig"],
  [/\b(shred|srm)\b/, "Überschreibt und löscht endgültig"],
  [/\bos\.(remove|unlink|rmdir|removedirs)\s*\(|\bshutil\.rmtree\s*\(|\bPath\([^)]*\)\.unlink\s*\(|\.unlink\(\s*(missing_ok|\))/, "Skript löscht endgültig (Python)"],
  [/\bfs(\.promises)?\.(rm|rmSync|unlink|unlinkSync|rmdir|rmdirSync)\s*\(|\b(rmSync|unlinkSync|rmdirSync)\s*\(/, "Skript löscht endgültig (Node)"],
  [/\b(File\.delete|FileUtils\.rm(_rf|_r|_f)?|Dir\.(delete|rmdir|unlink))\b|\bunlink\s*\(?\s*['"$]/, "Skript löscht endgültig"],
  [/\bempty\s+(the\s+)?trash\b|emptyTrash\(/i, "Leert den Papierkorb"],
  [/\bdiskutil\s+(erase|zeroDisk|secureErase|eraseVolume|eraseDisk)/i, "Löscht ein Laufwerk"],
]

export function classifyMacShell(command: string): Risk {
  for (const [pattern, text] of HARD_DELETE)
    if (pattern.test(command)) return { ask: true, reason: "loeschen", kind: "mac_shell:loeschen", text: clip(`${text}: ${command.trim()}`) }
  const appleScript = /\bosascript\b/.test(command) ? classifyAppleScript(command) : FREE
  if (appleScript.ask) return { ...appleScript, kind: `mac_shell:${appleScript.reason}` }
  const rewritten = command.replace(PATH_REMOVE, (_m, before: string) => `${before}orbit_papierkorb`)
  const risk = classifyBash(rewritten)
  return risk.ask ? { ...risk, kind: `mac_shell:${risk.reason}`, text: clip(risk.text.replaceAll("orbit_papierkorb", "rm")) } : FREE
}

// AppleScript/JXA: Senden über Mail, Nachrichten & Co. = Nachricht in Constis Namen; Papierkorb leeren oder endgültig
// löschen = Löschen. Ein „delete“ im Finder legt in den Papierkorb und bleibt frei.
const MESSAGE_APPS = /\b(Mail|Messages|Nachrichten|WhatsApp|Telegram|Signal|Slack|Discord|Microsoft Outlook|Outlook|Teams|Mastodon|Threads)\b/i
export function classifyAppleScript(script: string): Risk {
  for (const [pattern, text] of HARD_DELETE.slice(6))
    if (pattern.test(script)) return { ask: true, reason: "loeschen", kind: "mac_applescript:loeschen", text: clip(`${text}: ${script.trim()}`) }
  if (/\bdo shell script\b/.test(script)) {
    const inner = [...script.matchAll(/do shell script\s+"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]!.replace(/\\"/g, '"'))
    for (const command of inner) {
      const risk = classifyMacShell(command)
      if (risk.ask) return { ...risk, kind: `mac_applescript:${risk.reason}` }
    }
  }
  const tellsMessageApp = MESSAGE_APPS.test(script) && /\b(tell|Application\(|application\s+id)\b/i.test(script)
  if (tellsMessageApp && /\b(send|post|reply|forward)\b/i.test(script))
    return { ask: true, reason: "nachricht", kind: "mac_applescript:nachricht", text: clip(`Sendet in deinem Namen: ${script.trim()}`) }
  // Termine mit Teilnehmern verschicken Einladungen.
  if (/\b(Calendar|Kalender)\b/.test(script) && /\b(attendee|Teilnehmer)\b/i.test(script) && /\b(make|add|create)\b/i.test(script))
    return { ask: true, reason: "nachricht", kind: "mac_applescript:nachricht", text: clip(`Lädt Teilnehmer ein: ${script.trim()}`) }
  if (/\b(delete|remove)\b/i.test(script) && /\b(Calendar|Kalender|Reminders|Erinnerungen|Contacts|Kontakte|Notes|Notizen)\b/.test(script))
    return { ask: true, reason: "loeschen", kind: "mac_applescript:loeschen", text: clip(`Löscht endgültig (kein Papierkorb): ${script.trim()}`) }
  return FREE
}

// Kurzbefehle sind von außen nicht einsehbar: nach dem Namen einstufen; Senden/Posten/Kaufen/Bezahlen fragen.
export function classifyShortcut(name: string): Risk {
  const n = name.toLowerCase()
  if (/(kauf|bezahl|bestell|pay|buy|order|überweis)/.test(n))
    return { ask: true, reason: "geld", kind: "mac_shortcut:geld", text: clip(`Kurzbefehl „${name}“ kann Geld ausgeben`) }
  if (/(post|tweet|veröffentlich|publish|teilen|share)/.test(n))
    return { ask: true, reason: "veroeffentlichen", kind: "mac_shortcut:veroeffentlichen", text: clip(`Kurzbefehl „${name}“ veröffentlicht`) }
  if (/(send|nachricht|message|mail|imessage|sms|antwort)/.test(n))
    return { ask: true, reason: "nachricht", kind: "mac_shortcut:nachricht", text: clip(`Kurzbefehl „${name}“ sendet in deinem Namen`) }
  if (/(lösch|delete|leeren|empty)/.test(n))
    return { ask: true, reason: "loeschen", kind: "mac_shortcut:loeschen", text: clip(`Kurzbefehl „${name}“ löscht`) }
  return FREE
}
