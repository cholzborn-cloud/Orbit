import type { Context, Hono } from "hono"
import { bodyLimit } from "hono/body-limit"

import * as approvals from "@/actions/approvals"
import * as automations from "@/actions/automations"
import * as bots from "@/actions/bot"
import * as chats from "@/actions/chat"
import * as connectors from "@/actions/connectors"
import * as jev from "@/actions/jev"
import * as search from "@/actions/search"
import * as settings from "@/actions/settings"
import * as skills from "@/actions/skills"
import * as usage from "@/actions/usage"
import { countUnreadRuns, runBlocker } from "@/query/automations"
import catalog from "@/connectors/catalog.json"
import { parseConnectorCatalog } from "@/lib/connectors/catalog"
import { getAvailableModels } from "@/lib/chat-models"
import {
  BASE_INSTRUCTIONS_LIMIT,
  DEFAULT_BASE_INSTRUCTIONS,
} from "@/lib/orbi/base-instructions"
import { getSidebarBots } from "@/query/bot"
import { listStartChats } from "@/query/chat"
import { botLibrary } from "./library"
import {
  botMemory,
  botMemoryEntry,
  botMemoryTrash,
  deleteBotMemoryEntry,
  editBotMemoryEntry,
  restoreBotMemoryEntry,
} from "./memory-api"
import { botDreamer, setBotDreamer } from "./dream-api"
import { botHeartbeat, setBotHeartbeat } from "./heartbeat-api"
import { listKeys, reloadKeys } from "./keys-api"
import { budget, chatSeen, chatStatus, healthChecks, updateBudget } from "./phase5-api"
import { pluginStore, verifyComposio, invalidatePluginCredentials } from "./plugins"
import { verifyICloud } from "./icloud-calendar"
import { marketplace } from "./marketplace-default"
import { macAccessRoute, requestMacPermissionRoute, setMacAccessRoute } from "./mac-access-api"
import {
  activeTasksRoute,
  clearCompletedTodosRoute,
  getTaskRoute,
  listTasksRoute,
  listTodosRoute,
  stopAllTasksRoute,
  stopTaskRoute,
  writeTodosRoute,
  type TaskStopper,
} from "./tasks-api"
import {
  acceptSkillProposalRoute,
  createSkillProposalRoute,
  listSkillProposalsRoute,
  promptPreviewRoute,
  rejectSkillProposalRoute,
  undoHistoryRoute,
  undoRoute,
} from "./mac-open-api"
import {
  archiveOrbiRoute,
  clearScratchpadRoute,
  getOrbiRoute,
  getScratchpadRoute,
  listOrbisRoute,
  runEvalsRoute,
  setScratchpadRoute,
  updateOrbiRoute,
} from "./fleet-api"
import {
  deleteRoutineRoute,
  getRoutineRoute,
  listRoutinesRoute,
  pauseRoutineRoute,
  resumeRoutineRoute,
  updateRoutineRoute,
} from "./routines-api"

type Request = {
  params: Record<string, string>
  query: URLSearchParams
  body: unknown
}
type Route = [
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  call: (request: Request) => unknown,
]
type Runner = {
  start(
    automationId: string,
    trigger: "manual"
  ): { runId: string; done: Promise<void> } | null
}

// Dieselbe Logik wie die Server Actions der Web-App; der Körper ist die Eingabe der Action, `:id` kommt aus dem Pfad.
const routes = (runner: Runner, stopTasks?: TaskStopper): Route[] => [
  ["POST", "/v1/plugins/reload", () => { invalidatePluginCredentials(); return { ok: true } }],
  ["POST", "/v1/plugins/verify", ({ body }) => verifyComposio(body)],
  ["POST", "/v1/icloud/verify", ({ body }) => verifyICloud(body)],
  ["GET", "/v1/plugins", ({ query }) => pluginStore.catalog(query)],
  ["POST", "/v1/plugins/:slug/connect", ({ params }) => pluginStore.connect(params.slug)],
  ["GET", "/v1/plugins/:slug/status", ({ params }) => pluginStore.status(params.slug)],
  ["GET", "/v1/plugins/:slug/accounts", ({ params }) => pluginStore.connectionAccounts(params.slug)],
  ["DELETE", "/v1/plugins/:slug/accounts", ({ params, body }) => pluginStore.disconnect(params.slug, body)],
  ["GET", "/v1/plugins/:slug/setup", ({ params }) => pluginStore.setup(params.slug)],
  ["POST", "/v1/plugins/:slug/setup", ({ params, body }) => pluginStore.setupConnect(params.slug, body)],
  [
    "GET",
    "/v1/bots",
    async () => ({ ok: true, ...(await getSidebarBots("local")) }),
  ],
  ["GET", "/v1/bots/:id/library", ({ params }) => botLibrary(params.id)],
  [
    "GET",
    "/v1/bots/:id/library/:fileId",
    ({ params }) => botLibrary(params.id, params.fileId),
  ],
  ["GET", "/v1/bots/:id/memory", ({ params }) => botMemory(params.id)],
  [
    "GET",
    "/v1/bots/:id/memory/:name",
    ({ params }) => botMemoryEntry(params.id, params.name),
  ],
  [
    "DELETE",
    "/v1/bots/:id/memory/:name",
    ({ params }) => deleteBotMemoryEntry(params.id, params.name),
  ],
  ["GET", "/v1/bots/:id/memory-trash", ({ params }) => botMemoryTrash(params.id)],
  [
    "PUT",
    "/v1/bots/:id/memory/:name",
    ({ params, body }) => editBotMemoryEntry(params.id, params.name, body),
  ],
  [
    "POST",
    "/v1/bots/:id/memory/:name/restore",
    ({ params }) => restoreBotMemoryEntry(params.id, params.name),
  ],
  ["GET", "/v1/bots/:id/heartbeat", ({ params }) => botHeartbeat(params.id)],
  ["PUT", "/v1/bots/:id/heartbeat", ({ params, body }) => setBotHeartbeat(params.id, body)],
  ["GET", "/v1/status", () => chatStatus()],
  ["POST", "/v1/chats/:id/seen", ({ params }) => chatSeen(params.id)],
  ["GET", "/v1/budget", () => budget()],
  ["PUT", "/v1/budget", ({ body }) => updateBudget(body)],
  ["GET", "/v1/keys", () => listKeys()],
  ["POST", "/v1/keys/reload", ({ body }) => reloadKeys(body)],
  ["GET", "/v1/health/checks", async () => ({ ok: true, checks: await healthChecks() })],
  ["GET", "/v1/bots/:id/dreamer", ({ params }) => botDreamer(params.id)],
  ["PUT", "/v1/bots/:id/dreamer", ({ params, body }) => setBotDreamer(params.id, body)],
  ["POST", "/v1/bots", ({ body }) => bots.createBot(body)],
  [
    "PATCH",
    "/v1/bots/:id",
    ({ params, body }) => bots.updateBot(params.id, body),
  ],
  ["DELETE", "/v1/bots/:id", ({ params }) => bots.deleteBot(params.id)],
  [
    "GET",
    "/v1/daytona/:id/desktop-url",
    ({ params }) => bots.getBotDesktopUrl(params.id),
  ],

  [
    "GET",
    "/v1/chats",
    async () => ({ ok: true, chats: await listStartChats("local") }),
  ],
  ["POST", "/v1/chats", ({ body }) => chats.createGroup(body)],
  [
    "PATCH",
    "/v1/chats/:id",
    ({ params, body }) => chats.updateGroup(params.id, body),
  ],
  ["DELETE", "/v1/chats/:id", ({ params }) => chats.deleteGroup(params.id)],

  // Modelle, deren CLI gerade vorhanden und angemeldet ist (leer = keine CLI nutzbar); Auto (Jev) kommt vom Client dazu.
  [
    "GET",
    "/v1/models",
    async () => {
      const models = await getAvailableModels()
      return { ok: true, modelsAvailable: models.length > 0, models }
    },
  ],

  ["GET", "/v1/settings", () => settings.getSettings()],
  // Standard-Anleitung und Grenze für den Editor (Reiter Orbis-Anleitung).
  [
    "GET",
    "/v1/settings/instructions/default",
    () => ({
      ok: true,
      text: DEFAULT_BASE_INSTRUCTIONS,
      limit: BASE_INSTRUCTIONS_LIMIT,
    }),
  ],
  // Marktplatz-Katalog (connectors/catalog.json), installiert wird über /v1/skills und /v1/connectors.
  [
    "GET",
    "/v1/marketplace",
    () => {
      const parsed = parseConnectorCatalog(catalog)
      return parsed.success
        ? { ok: true, entries: parsed.data }
        : { ok: false, error: "Der Marktplatz-Katalog ist ungültig." }
    },
  ],
  [
    "PUT",
    "/v1/settings/theme",
    ({ body }) => settings.setTheme(asObject(body).theme),
  ],
  ["PUT", "/v1/settings/jev", ({ body }) => settings.setJevSettings(body)],
  [
    "PUT",
    "/v1/settings/instructions",
    ({ body }) => settings.setBaseInstructions(asObject(body).instructions),
  ],
  ["GET", "/v1/settings/rules", () => approvals.listRules()],
  ["POST", "/v1/settings/rules", ({ body }) => approvals.setRule(body)],
  [
    "DELETE",
    "/v1/settings/rules/:id",
    ({ params }) => approvals.deleteRule({ id: params.id }),
  ],

  ["GET", "/v1/skills", () => skills.listSkills()],
  ["GET", "/v1/skills/slash", () => skills.listSlashSkills()],
  [
    "GET",
    "/v1/skills/brain/:name",
    ({ params }) => skills.getBrainSkill(params.name),
  ],
  ["POST", "/v1/skills", ({ body }) => skills.createSkill(body)],
  [
    "PUT",
    "/v1/skills/:id",
    ({ params, body }) =>
      skills.updateSkill({ ...asObject(body), id: params.id }),
  ],
  ["DELETE", "/v1/skills/:id", ({ params }) => skills.deleteSkill(params.id)],

  // Marktplatz-Anbieter (Google, Microsoft, Spotify direkt; Nango, Pipedream). Nur Nutzeraktionen, Werte werden nie zurückgegeben.
  ["GET", "/v1/marketplace/providers", () => marketplace().list()],
  ["GET", "/v1/marketplace/log", () => ({ ok: true, log: marketplace().log })],
  [
    "PUT",
    "/v1/marketplace/providers/:id/config",
    ({ params, body }) => marketplace().setConfig(params.id, asObject(body)),
  ],
  ["POST", "/v1/marketplace/providers/:id/connect", ({ params }) => marketplace().connect(params.id)],
  ["POST", "/v1/marketplace/providers/:id/read", ({ params }) => marketplace().read(params.id, "user")],
  ["DELETE", "/v1/marketplace/providers/:id", ({ params }) => marketplace().disconnect(params.id)],

  ["GET", "/v1/connectors", () => connectors.listConnectors()],
  ["POST", "/v1/connectors", ({ body }) => connectors.addConnector(body)],
  [
    "PUT",
    "/v1/connectors/enabled",
    ({ body }) => connectors.setAllConnectorsEnabled(asObject(body).enabled),
  ],
  [
    "POST",
    "/v1/connectors/:id/test",
    ({ params }) => connectors.testConnector(params.id),
  ],
  [
    "PUT",
    "/v1/connectors/:id/enabled",
    ({ params, body }) =>
      connectors.setConnectorEnabled({ ...asObject(body), id: params.id }),
  ],
  [
    "PUT",
    "/v1/connectors/:id/auth",
    ({ params, body }) =>
      connectors.updateConnectorAuth({ ...asObject(body), id: params.id }),
  ],
  [
    "POST",
    "/v1/connectors/:id/oauth",
    ({ params }) => connectors.startConnectorOAuth(params.id),
  ],
  [
    "DELETE",
    "/v1/connectors/:id/oauth",
    ({ params }) => connectors.disconnectConnectorOAuth(params.id),
  ],
  [
    "DELETE",
    "/v1/connectors/:id",
    ({ params }) => connectors.deleteConnector(params.id),
  ],

  ["GET", "/v1/automations", () => automations.listAutomations()],
  ["POST", "/v1/automations", ({ body }) => automations.createAutomation(body)],
  [
    "GET",
    "/v1/automations/unread",
    async ({ query }) => ({
      ok: true,
      count: await countUnreadRuns("local", Number(query.get("since")) || 0),
    }),
  ],
  [
    "PATCH",
    "/v1/automations/:id",
    ({ params, body }) => automations.updateAutomation(params.id, body),
  ],
  [
    "PUT",
    "/v1/automations/:id/enabled",
    ({ params, body }) =>
      automations.setAutomationEnabled(
        params.id,
        asObject(body).enabled === true
      ),
  ],
  [
    "POST",
    "/v1/automations/:id/trash",
    ({ params }) => automations.trashAutomation(params.id),
  ],
  [
    "POST",
    "/v1/automations/:id/restore",
    ({ params }) => automations.restoreAutomation(params.id),
  ],
  [
    "DELETE",
    "/v1/automations/:id",
    ({ params }) => automations.deleteAutomationForever(params.id),
  ],
  [
    "GET",
    "/v1/automations/:id/runs",
    ({ params }) => automations.getAutomationRuns(params.id),
  ],
  [
    "POST",
    "/v1/automations/:id/run",
    async ({ params }) => {
      const blocked = await runBlocker("local", params.id)
      if (blocked) return { ok: false, error: blocked }
      // Der Claim läuft sofort; der Lauf selbst im Hintergrund (Status über /v1/events).
      const started = runner.start(params.id, "manual")
      if (!started)
        return {
          ok: false,
          error: "Ein Lauf läuft noch oder wartet auf Freigabe.",
        }
      started.done.catch(() => {})
      return { ok: true, runId: started.runId }
    },
  ],

  [
    "GET",
    "/v1/search",
    ({ query }) => search.searchChats(query.get("q") ?? ""),
  ],
  [
    "GET",
    "/v1/usage",
    ({ query }) => usage.getUsage(query.get("fresh") === "1"),
  ],
  ["GET", "/v1/jev", () => jev.getJevLog()],

  // ---- Phase B & C: Hintergrund-Helfer (tasks) & Todos ----
  ["GET", "/v1/tasks", ({ query }) => listTasksRoute(query)],
  ["GET", "/v1/tasks/active", ({ query }) => activeTasksRoute(query)],
  ["GET", "/v1/tasks/:id", ({ params }) => getTaskRoute(params.id)],
  ["POST", "/v1/tasks/:id/stop", ({ params, body }) => stopTaskRoute(params.id, body, stopTasks)],
  ["POST", "/v1/tasks/stop", ({ body }) => stopAllTasksRoute(body, stopTasks)],
  ["GET", "/v1/todos/:chatId", ({ params }) => listTodosRoute(params.chatId)],
  ["POST", "/v1/todos/:chatId", ({ params, body }) => writeTodosRoute(params.chatId, body)],
  ["DELETE", "/v1/todos/:chatId/completed", ({ params }) => clearCompletedTodosRoute(params.chatId)],

  // ---- Mac-Anbindung offen: Skill-Vorschläge, Prompt-Vorschau, Rückgängig ----
  ["GET", "/v1/skills/proposals", () => listSkillProposalsRoute()],
  ["POST", "/v1/skills/proposals", ({ body }) => createSkillProposalRoute(body)],
  ["POST", "/v1/skills/proposals/:id/accept", ({ params, body }) => acceptSkillProposalRoute(params.id, body)],
  ["POST", "/v1/skills/proposals/:id/reject", ({ params }) => rejectSkillProposalRoute(params.id)],
  ["GET", "/v1/chats/:id/prompt-preview", ({ params, query }) => promptPreviewRoute(params.id, query)],
  ["POST", "/v1/chats/:id/prompt-preview", ({ params, query }) => promptPreviewRoute(params.id, query)],
  ["POST", "/v1/undo", ({ body }) => undoRoute(body)],
  ["GET", "/v1/undo/history", ({ query }) => undoHistoryRoute(query)],
  ["GET", "/v1/mac/access", () => macAccessRoute()],
  ["POST", "/v1/mac/access", ({ body }) => setMacAccessRoute(body)],
  ["POST", "/v1/mac/permissions/request", ({ body }) => requestMacPermissionRoute(body)],

  // ---- Phase D: Routinen & Scratchpad ----
  ["GET", "/v1/routines", ({ query }) => listRoutinesRoute(query)],
  ["GET", "/v1/routines/:id", ({ params }) => getRoutineRoute(params.id)],
  ["PATCH", "/v1/routines/:id", ({ params, body }) => updateRoutineRoute(params.id, body)],
  ["POST", "/v1/routines/:id/pause", ({ params }) => pauseRoutineRoute(params.id)],
  ["POST", "/v1/routines/:id/resume", ({ params }) => resumeRoutineRoute(params.id)],
  ["DELETE", "/v1/routines/:id", ({ params }) => deleteRoutineRoute(params.id)],
  ["GET", "/v1/orbis/:id/scratchpad", ({ params }) => getScratchpadRoute(params.id)],
  ["PUT", "/v1/orbis/:id/scratchpad", ({ params, body }) => setScratchpadRoute(params.id, body)],
  ["DELETE", "/v1/orbis/:id/scratchpad", ({ params }) => clearScratchpadRoute(params.id)],

  // ---- Phase F: Orbis Flotte & Selbstverwaltung ----
  ["GET", "/v1/orbis", ({ query }) => listOrbisRoute(query)],
  ["GET", "/v1/orbis/:id", ({ params }) => getOrbiRoute(params.id)],
  ["PATCH", "/v1/orbis/:id", ({ params, body }) => updateOrbiRoute(params.id, body)],
  ["DELETE", "/v1/orbis/:id", ({ params, body }) => archiveOrbiRoute(params.id, body)],

  // ---- Phase G: Evals Runner ----
  ["POST", "/v1/evals/run", ({ body }) => runEvalsRoute(body)],
]

const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}

const MESSAGES = {
  json: "Ungültige Anfrage.",
  large: "Die Anfrage ist zu groß.",
}

// Actions melden Fehler als { ok: false, error }; daraus wird ein passender HTTP-Status mit demselben Körper.
function respond(c: Context, result: unknown) {
  if (
    result &&
    typeof result === "object" &&
    "ok" in result &&
    result.ok === false
  ) {
    const error = String((result as { error?: unknown }).error ?? "")
    return c.json(result, /nicht gefunden/i.test(error) ? 404 : 400)
  }
  return c.json(result ?? { ok: true })
}

export function registerApiRoutes(app: Hono, runner: Runner, stopTasks?: TaskStopper) {
  for (const [method, path, call] of routes(runner, stopTasks)) {
    app.on(
      method,
      path,
      bodyLimit({
        maxSize: 1024 * 1024,
        onError: (c) => c.json({ error: MESSAGES.large }, 413),
      }),
      async (c) => {
        let body: unknown
        if (method !== "GET" && method !== "DELETE") {
          const text = await c.req.text()
          try {
            body = text ? JSON.parse(text) : undefined
          } catch {
            return c.json({ error: MESSAGES.json }, 400)
          }
        }
        return respond(
          c,
          await call({
            params: c.req.param() as Record<string, string>,
            query: new URL(c.req.url).searchParams,
            body,
          })
        )
      }
    )
  }
}
