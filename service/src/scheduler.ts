import {
  closeOrphanedRuns,
  dispatchDue,
  sweepStaleRuns,
} from "@/lib/db/automations"

type Options = {
  start: (automationId: string, trigger: "schedule") => unknown
  activeRunIds?: () => string[] // laufende eigene Läufe, die der Sweep nicht beendet
  now?: () => Date
  intervalMs?: number
  // Weitere Takt-Aufgaben des Dienstes (Träumer; später Heartbeat mit Intervall und Zeitfenster). Jede prüft selbst, ob sie fällig ist.
  jobs?: ((now: Date) => void)[]
}

// dispatchDue setzt den nächsten Termin ab "jetzt": ein verpasster Termin läuft nach Schlaf oder Neustart genau einmal nach.
export function createScheduler({
  start,
  activeRunIds = () => [],
  now = () => new Date(),
  intervalMs = 30_000,
  jobs = [],
}: Options) {
  let timer: ReturnType<typeof setInterval> | undefined
  const tick = () => {
    try {
      sweepStaleRuns(now().getTime(), activeRunIds())
      for (const id of dispatchDue(now())) start(id, "schedule")
    } catch (error) {
      console.error("Automations-Takt fehlgeschlagen:", error)
    }
    for (const job of jobs)
      try {
        job(now())
      } catch (error) {
        console.error("Takt-Aufgabe fehlgeschlagen:", error)
      }
  }
  return {
    tick,
    run() {
      if (timer) return
      // Der Dienst besitzt alle Läufe; was beim Start noch offen ist, ist verwaist.
      closeOrphanedRuns(now().getTime())
      tick()
      timer = setInterval(tick, intervalMs)
      timer.unref()
    },
    stop() {
      if (timer) clearInterval(timer)
      timer = undefined
    },
  }
}
