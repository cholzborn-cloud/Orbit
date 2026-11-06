import { readdirSync } from "node:fs"
import { homedir } from "node:os"
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
  { id: "accessibility", label: "Bedienungshilfen", settingsUrl: `${PRIVACY}Accessibility`, detail: "Maus und Tastatur steuern" },
  { id: "screen", label: "Bildschirmaufnahme", settingsUrl: `${PRIVACY}ScreenCapture`, detail: "Bildschirm sehen" },
  { id: "full_disk", label: "Festplattenvollzugriff", settingsUrl: `${PRIVACY}AllFiles`, detail: "Geschützte Ordner (Mail, Safari, …) lesen" },
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
    ? "macOS hat den Zugriff nicht erlaubt. Erlaubnis in Orbit › Einstellungen › Allgemein › Mac-Zugriff anfragen."
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

export async function readPermissions(): Promise<Permission[]> {
  if (process.platform !== "darwin") return PERMISSIONS.map(({ app: _a, ...p }) => ({ ...p, status: "unknown" }))
  const probe = await jxa(JXA.probe)
  const disk = fullDisk()
  return PERMISSIONS.map(({ app, ...p }) => {
    let status: PermissionStatus = "unknown"
    if (p.id === "accessibility" && typeof probe.accessibility === "boolean") status = probe.accessibility ? "granted" : "missing"
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
  else if (id === "screen") await jxa(JXA.requestScreen)
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
