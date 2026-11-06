import { serve } from "@hono/node-server"

import { loadKeychainSecrets } from "./keychain"
import { loadSecrets } from "./secrets"
import { loadServiceToken } from "./security"

// Schlüssel: zuerst der Schlüsselbund (Dienst de.consti.orbit2), dann der Rückfall secrets.env, dann die Entwicklungsdatei .env.local.
// Gesetzte Umgebungsvariablen gewinnen immer; Werte werden nie ausgegeben.
const keychain = await loadKeychainSecrets().catch(() => ({ loaded: [] as string[] }))
if (keychain.loaded.length) console.info(`${keychain.loaded.length} Schlüssel aus dem Schlüsselbund geladen.`)
const secrets = loadSecrets()
if (secrets.warning) console.error(secrets.warning)
// Entwicklung: .env.local im Arbeitsordner; der installierte Dienst nutzt secrets.env.
try {
  process.loadEnvFile(".env.local")
} catch {}
// Erst nach der Umgebung laden: Konnektoren lesen ihre Konfiguration beim Import.
const { createApp } = await import("./app")
const { reminders } = await import("./reminders")
const { registerReminderRoutes } = await import("./reminder-routes")
const { createMessageStore } = await import("./chat/store")
const { createTurnHandler } = await import("./chat/handle-turn")
const { createChatRuntime } = await import("./chat/runtime")
const { createScheduler } = await import("./scheduler")
const { createDreamer } = await import("./dream")
const { createHeartbeat } = await import("./heartbeat")
const { getDatabase } = await import("@/lib/db/client")
const { interruptStale, pruneRuns } = await import("@/lib/work/runs")
const { markSeen, pruneCounters } = await import("@/lib/work/store")
const { setJevGate } = await import("@/lib/jev/client")
const { setSandboxGate } = await import("@/lib/chat/sandbox-tools")
const { sandboxSlots, jevGate, healthChecks } = await import("./phase5-api")
const { storedInteractions } = await import("./chat/persist-interactions")
const { registerApiRoutes } = await import("./routes")
const { registerReactionRoutes } = await import("./chat/reaction-routes")
const { oauthCallback } = await import("./oauth-callback")
// Brain ohne separaten Server: der Vault wird direkt gelesen (ORBIT_BRAIN=off schaltet es ab, ORBIT_BRAIN_PATH wählt den Ordner).
const { enableLocalBrain } = await import("@/lib/brain/config")
if (process.env.ORBIT_BRAIN !== "off")
  console.info(enableLocalBrain() ? "Brain lokal eingebunden." : "Brain nicht gefunden (kein lokaler Vault).")
const rawPort = process.env.ORBITD_PORT ?? "4317"
const port = Number(rawPort)
if (
  !/^\d+$/.test(rawPort) ||
  !Number.isInteger(port) ||
  port < 1024 ||
  port > 65535
)
  throw new Error("ORBITD_PORT ist ungültig.")
const token = await loadServiceToken()
const store = createMessageStore()
// Aufträge liegen nur im Speicher: Zeilen, die nach einem Neustart noch „arbeitet“ zeigen, werden „unklar“.
try {
  const stale = await store.settleStaleLines()
  if (stale) console.info(`${stale} offene Nachrichtenzeilen auf „unklar“ gesetzt.`)
} catch (error) {
  console.error("Offene Nachrichtenzeilen konnten nicht aufgeräumt werden:", error)
}
// Dauerhafte Jobs (Phase 5): was beim Neustart noch lief oder wartete, ist unterbrochen (Chat zeigt „Weiter“). Alte Einträge und Zähler räumen auf.
try {
  const db = getDatabase().$client
  const interrupted = interruptStale(db)
  if (interrupted.length) console.info(`${interrupted.length} Arbeitsgänge als unterbrochen markiert.`)
  pruneRuns(db, 30 * 24 * 60 * 60_000)
  pruneCounters(db, 7 * 24 * 60 * 60_000)
} catch (error) {
  console.error("Arbeitsgänge konnten nicht aufgeräumt werden:", error)
}
// Kostenbudget: Jev pausiert beim Tagesbudget, neue Sandboxes warten bei voller Obergrenze.
setJevGate(jevGate)
setSandboxGate(sandboxSlots)
const runtime = createChatRuntime(store)
reminders.onAvailable = () => runtime.events.publish({ type: "reminders-pending" })
reminders.onCancel = (id) => runtime.events.publish({ type: "reminders-cancelled", id })
// Offene Freigaben und Rückfragen aus der Datenbank wieder anzeigen (die Turns dazu sind weg).
try {
  runtime.manager.restore(storedInteractions(() => getDatabase().$client))
} catch (error) {
  console.error("Offene Freigaben konnten nicht wiederhergestellt werden:", error)
}
const app = createApp({
  token,
  port,
  store,
  runTurn: createTurnHandler(store, runtime.runRoot, (chatId) => markSeen(getDatabase().$client, chatId)),
  turns: runtime.turns,
  reserveTurn: runtime.reserveRoot,
  stopRoot: runtime.stopRoot,
  interactions: runtime.manager,
  eventStream: () => runtime.events.response(runtime.snapshot),
  resume: runtime.resume,
  healthChecks,
  routes: (app) => {
    registerReminderRoutes(app, reminders)
    registerApiRoutes(app, runtime.automations, (input) => runtime.executor.stopTasks(input))
    registerReactionRoutes(app, {
      store,
      publish: (event) => runtime.events.publish(event),
      liveMessageId: runtime.liveMessageId,
      interactions: runtime.manager,
    })
  },
  oauthCallback,
})
// Träumer: nächtliches Aufräumen des lokalen Gedächtnisses, im Takt des Dienstes (kein Chat, keine Automation, still).
const dreamer = createDreamer()
// Heartbeat: alle 30 Minuten, nur bei Mac-Aktivität und im Wachfenster (Takt prüft selbst; Schalter je Orbi, Standard aus).
const heartbeat = createHeartbeat({
  store,
  // Die App lädt den Chat neu und zeigt „neu“ in der Seitenleiste.
  onPosted: (chatId, botId) => runtime.events.publish({ type: "status", chatId, botId, status: "fertig" }),
})
const scheduler = createScheduler({
  jobs: [(now) => void dreamer.tick(now), (now) => void heartbeat.tick(now)],
  start: runtime.automations.start,
  activeRunIds: () => runtime.automations.snapshot().map((run) => run.runId),
})
serve({ fetch: app.fetch, hostname: "127.0.0.1", port }, () => {
  console.info(`orbitd läuft auf http://127.0.0.1:${port}`)
  scheduler.run()
})
