import { readdirSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"

import { JXA } from "./jxa.ts"
import { runLocal } from "./run.ts"

// macOS-Rechte (TCC) der lokalen Werkzeuge. Sie gelten für den Prozess, der die Aktion ausführt (Dienst orbitd und seine
// Kindprozesse osascript/screencapture). Bedienungshilfen und Bildschirmaufnahme lassen sich ohne Dialog prüfen,
// Automation je App erst beim ersten Zugriff: bis dahin „unbekannt“, danach merkt sich der Dienst das Ergebnis.
export type PermissionId =
  | "accessibility"
  | "screen"
  | "full_disk"
  | "automation_calendar"
  | "automation_reminders"
  | "automation_contacts"
  | "automation_notes"
  | "automation_system_events"
  | "automation_safari"
  | "automation_finder"
export type PermissionStatus = "granted" | "missing" | "unknown"
export type Permission = { id: PermissionId; label: string; status: PermissionStatus; settingsUrl: string; detail: string }

const PRIVACY = "x-apple.systempreferences:com.apple.preference.security?Privacy_"
export const PERMISSIONS: { id: PermissionId; label: string; settingsUrl: string; detail: string; app?: string }[] = [
  { id: "accessibility", label: "Bedienungshilfen", settingsUrl: `${PRIVACY}Accessibility`, detail: "Maus und Tastatur steuern. In macOS muss „osascript“ erlaubt sein (Knopf „Anfragen“ legt den Eintrag an)" },
  { id: "screen", label: "Bildschirmaufnahme", settingsUrl: `${PRIVACY}ScreenCapture`, detail: "Bildschirm sehen" },
  { id: "full_disk", label: "Festplattenvollzugriff", settingsUrl: `${PRIVACY}AllFiles`, detail: "Geschützte Ordner (Mail, Safari, …) lesen. In macOS mit + das Programm „node“ aus Orbit.app › Contents › Resources › runtime hinzufügen" },
  { id: "automation_calendar", label: "Kalender", settingsUrl: `${PRIVACY}Automation`, detail: "Termine lesen und anlegen", app: "Calendar" },
  { id: "automation_reminders", label: "Erinnerungen", settingsUrl: `${PRIVACY}Automation`, detail: "Erinnerungen lesen und anlegen", app: "Reminders" },
  { id: "automation_contacts", label: "Kontakte", settingsUrl: `${PRIVACY}Automation`, detail: "Kontakte suchen", app: "Contacts" },
  { id: "automation_notes", label: "Notizen", settingsUrl: `${PRIVACY}Automation`, detail: "Notizen lesen und anlegen", app: "Notes" },
  { id: "automation_system_events", label: "System Events", settingsUrl: `${PRIVACY}Automation`, detail: "Tastatur und Apps steuern", app: "System Events" },
  { id: "automation_safari", label: "Safari", settingsUrl: `${PRIVACY}Automation`, detail: "Browser öffnen und lesen", app: "Safari" },
  { id: "automation_finder", label: "Finder", settingsUrl: `${PRIVACY}Automation`, detail: "Finder steuern", app: "Finder" },
]

// Ergebnis des letzten Automation-Zugriffs je App (aus Werkzeugläufen und „Anfragen“).
const automation = new Map<string, PermissionStatus>()

// osascript-Fehler -1743 = keine Erlaubnis für Apple Events, -1744 = Nutzer muss zustimmen.
export function noteAutomationResult(app: string, output: string, exitCode: number | null) {
  if (/-174[34]\b|Not authori[sz]ed to send Apple events|nicht berechtigt/i.test(output)) automation.set(app, "missing")
  else if (exitCode === 0) automation.set(app, "granted")
}

export const permissionHint = (output: string) =>
  /-174[34]\b|Not authori[sz]ed/i.test(output)
    ? "macOS hat den Zugriff nicht erlaubt. Erlaubnis in Orbit › Einstellungen › Sicherheit › Mac-Zugriff anfragen."
    : undefined

function fullDisk(home = homedir()): PermissionStatus {
  try {
    readdirSync(join(home, "Library", "Safari"))
    return "granted"
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    return code === "EPERM" || code === "EACCES" ? "missing" : "unknown"
  }
}

async function jxa(script: string) {
  const r = await runLocal("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], { timeoutMs: 15_000 })
  try {
    return JSON.parse(r.output.trim()) as Record<string, boolean>
  } catch {
    return {}
  }
}

// Echte Fähigkeit statt Anzeige: Der Test läuft genau so wie die Werkzeuge (osascript als Kind des Dienstes). Damit zählt, was der Dienst wirklich darf,
// egal unter welchem Namen Consti das Recht in macOS erteilt hat (Orbit, node, osascript).
// Menüleiste eines fremden Programms lesen = Bedienungshilfen; scheitert schon der Zugriff auf System Events, ist es die Automation.
async function accessibilityCapability(): Promise<{ accessibility?: PermissionStatus; systemEvents?: PermissionStatus }> {
  const r = await runLocal("/usr/bin/osascript", ["-e", 'tell application "System Events" to tell process "Finder" to count of menu bar items of menu bar 1'], { timeoutMs: 10_000 })
  if (r.exitCode === 0 && /^\d+/.test(r.output.trim())) return { accessibility: "granted", systemEvents: "granted" }
  if (/-25211|-1719|assistive access|Hilfszugriff|Bedienungshilfen/i.test(r.output)) return { accessibility: "missing", systemEvents: "granted" }
  if (/-174[34]\b|Not authori[sz]ed to send Apple events/i.test(r.output)) return { systemEvents: "missing" }
  console.error(`Rechte-Test Bedienungshilfen unklar (Code ${r.exitCode}${r.timedOut ? ", Zeitlimit" : ""}): ${r.output.trim().slice(0, 200)}`)
  return {}
}

// Automation je App ohne Dialog-Falle: nur Programme prüfen, die schon laufen (nichts wird gestartet), höchstens alle 20 Sekunden.
// Wurde das Recht schon erteilt, antwortet die App sofort; fehlt es, kommt -1743.
let lastAutomationProbe = 0
async function probeAutomation() {
  if (Date.now() - lastAutomationProbe < 20_000) return
  lastAutomationProbe = Date.now()
  await Promise.all(
    PERMISSIONS.filter((p) => p.app && p.id !== "automation_system_events" && automation.get(p.app) !== "granted").map(async (p) => {
      const id = BUNDLE_IDS[p.app!]
      const r = await runLocal("/usr/bin/osascript", ["-e", `if application id "${id}" is running then tell application id "${id}" to count windows`], { timeoutMs: 8_000 })
      if (/^\d+/.test(r.output.trim()) || /-174[34]\b|Not authori[sz]ed/i.test(r.output)) noteAutomationResult(p.app!, r.output, r.exitCode)
    })
  )
}

export async function readPermissions(): Promise<Permission[]> {
  if (process.platform !== "darwin") return PERMISSIONS.map(({ app: _a, ...p }) => ({ ...p, status: "unknown" }))
  const [probe, capability] = await Promise.all([jxa(JXA.probe), accessibilityCapability()])
  if (capability.systemEvents) automation.set("System Events", capability.systemEvents)
  await probeAutomation()
  const disk = fullDisk()
  return PERMISSIONS.map(({ app, ...p }) => {
    let status: PermissionStatus = "unknown"
    if (p.id === "accessibility") status = capability.accessibility ?? (typeof probe.accessibility === "boolean" ? (probe.accessibility ? "granted" : "missing") : "unknown")
    else if (p.id === "screen" && typeof probe.screen === "boolean") status = probe.screen ? "granted" : "missing"
    else if (p.id === "full_disk") status = disk
    else if (app) status = automation.get(app) ?? "unknown"
    return { ...p, status }
  })
}

// Löst den macOS-Dialog aus (oder prüft erneut). Festplattenvollzugriff kann man nicht anfragen: nur Systemeinstellungen.
export async function requestPermission(id: PermissionId): Promise<Permission | undefined> {
  const entry = PERMISSIONS.find((p) => p.id === id)
  if (!entry) return undefined
  if (id === "accessibility") await jxa(JXA.requestAccessibility)
  else if (id === "screen") await runLocal("/usr/sbin/screencapture", ["-x", "-t", "jpg", join(tmpdir(), `orbit-rechte-${Date.now()}.jpg`)], { timeoutMs: 120_000 }) // löst den macOS-Dialog aus; Datei entsteht ohne Recht nicht
  else if (entry.app) {
    const r = await runLocal("/usr/bin/osascript", ["-e", `tell application id "${BUNDLE_IDS[entry.app]}" to count windows`], { timeoutMs: 120_000 })
    noteAutomationResult(entry.app, r.output, r.exitCode)
  }
  return (await readPermissions()).find((p) => p.id === id)
}

const BUNDLE_IDS: Record<string, string> = {
  Calendar: "com.apple.iCal",
  Reminders: "com.apple.reminders",
  Contacts: "com.apple.AddressBook",
  Notes: "com.apple.Notes",
  "System Events": "com.apple.systemevents",
  Safari: "com.apple.Safari",
  Finder: "com.apple.finder",
}
