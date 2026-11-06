import type { Schedule } from "./schedule.ts"

// Grenzen gegen ausufernde Dauer-Aufträge (eine Automation läuft immer ohne Consti).
export const AUTOMATION_LIMITS = {
  perBot: 50, // angelegte Automationen je Orbi
  runsPerDay: 12, // Läufe pro Tag über alle aktiven Automationen des Orbis
  minGapMinutes: 10, // Mindestabstand der Uhrzeiten zweier aktiver Automationen
} as const

export type ExistingAutomation = { schedule: unknown; enabled: boolean }

function clock(schedule: unknown) {
  const at = (schedule as { at?: unknown } | null)?.at
  if (typeof at !== "string" || !/^\d{2}:\d{2}$/.test(at)) return null
  const [h, m] = at.split(":").map(Number)
  return h! * 60 + m!
}

// Jede Zeitplan-Art läuft höchstens einmal pro Tag, deshalb zählt jede aktive Automation als ein Lauf pro Tag.
// Gibt einen deutschen Fehlertext zurück oder null, wenn die neue Automation passt.
export function checkAutomationLimits(
  existing: ExistingAutomation[],
  next: Schedule
): string | null {
  if (existing.length >= AUTOMATION_LIMITS.perBot)
    return `Für diesen Orbi gibt es bereits ${AUTOMATION_LIMITS.perBot} Automationen.`
  const active = existing.filter((e) => e.enabled)
  if (active.length + 1 > AUTOMATION_LIMITS.runsPerDay)
    return `Höchstens ${AUTOMATION_LIMITS.runsPerDay} Läufe pro Tag: Pausiere oder lösche zuerst eine andere Automation.`
  const wanted = clock(next)
  if (wanted !== null)
    for (const e of active) {
      const other = clock(e.schedule)
      if (other !== null && Math.abs(other - wanted) < AUTOMATION_LIMITS.minGapMinutes)
        return `Mindestabstand ${AUTOMATION_LIMITS.minGapMinutes} Minuten zwischen zwei Automationen: wähle eine andere Uhrzeit.`
    }
  return null
}
