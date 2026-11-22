// Eine Funktion je Route (SCHNITTSTELLE.md 2.1–2.5, 2.7, 2.9, 3, 4). Nur Durchreichen, keine Logik.
import { apiRequest, apiStream, type Json } from "./tauri";
import type {
  Antwort, Automation, BotInput, Bot, Budget, Chat, Datei, Einstellungen, Entscheidung, Group, HealthCheck,
  Karte, MarktplatzEintrag, McpServer, ModellInfo, NachrichtenSeite, PluginFilter, PluginListe, Regel, Reaktion,
  RoutineInput, Routine, RoutineRun, SchluesselInfo, StatusAntwort, SuchTreffer, TurnChunk, Nachricht, OrbiLook,
} from "./types";

const enc = encodeURIComponent;
const body = (o: unknown) => o as Json;

export function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${enc(k)}=${enc(String(v))}`);
  return parts.length ? `?${parts.join("&")}` : "";
}

// ---------- 2.1 Gesundheit, Status ----------
export const getHealth = () => apiRequest<{ ok: boolean }>("GET", "/v1/health");
export const getHealthChecks = () =>
  apiRequest<{ ok: boolean; checks: HealthCheck[] | null }>("GET", "/v1/health?checks=1");
export const getStatus = () => apiRequest<StatusAntwort>("GET", "/v1/status");

// ---------- 2.2 Orbis ----------
export const getBots = () =>
  apiRequest<{ ok: boolean; groups: Group[]; main: Bot | null; bots: Bot[] }>("GET", "/v1/bots");
export const createBot = (input: BotInput) =>
  apiRequest<{ ok: boolean; id: string; chatId: string }>("POST", "/v1/bots", body(input));
export const updateBot = (id: string, input: Partial<BotInput> & { look?: OrbiLook }) =>
  apiRequest<{ ok: boolean; id: string }>("PATCH", `/v1/bots/${enc(id)}`, body(input));
export const deleteBot = (id: string) => apiRequest<{ ok: boolean; id: string }>("DELETE", `/v1/bots/${enc(id)}`);
export const skipOnboarding = (id: string) =>
  apiRequest<{ ok: boolean }>("POST", `/v1/bots/${enc(id)}/onboarding`, { action: "skip" });
export const getLibrary = (botId: string) =>
  apiRequest<{ ok: boolean; files: any[]; limitations: string[]; truncated: boolean }>("GET", `/v1/bots/${enc(botId)}/library`);
export const getLibraryFile = (botId: string, fileId: string) =>
  apiRequest<{ ok: boolean; file: any }>("GET", `/v1/bots/${enc(botId)}/library/${enc(fileId)}`);

// ---------- 2.3 Chats, Gruppen, Nachrichten, Reaktionen ----------
export const getChats = () => apiRequest<{ ok: boolean; chats: Chat[] }>("GET", "/v1/chats");
export const createGroup = (name: string, botIds: string[]) =>
  apiRequest<{ ok: boolean; id: string }>("POST", "/v1/chats", { name, botIds });
export const updateGroup = (id: string, name: string, botIds: string[]) =>
  apiRequest<{ ok: boolean }>("PATCH", `/v1/chats/${enc(id)}`, { name, botIds });
export const deleteGroup = (id: string) => apiRequest<{ ok: boolean }>("DELETE", `/v1/chats/${enc(id)}`);

export const getMessages = (chatId: string, opts: { limit?: number; before?: string } = {}) =>
  apiRequest<NachrichtenSeite>("GET", `/v1/chats/${enc(chatId)}/messages${query(opts)}`);
export const clearMessages = (chatId: string) => apiRequest<{ ok: boolean }>("DELETE", `/v1/chats/${enc(chatId)}/messages`);

export const stopChat = (chatId: string) =>
  apiRequest<{ stopped: boolean; requeued: string[] }>("POST", `/v1/chats/${enc(chatId)}/stop`);
export const stopTask = (taskId: string) =>
  apiRequest<{ ok: boolean; stopped: boolean }>("POST", `/v1/tasks/${enc(taskId)}/stop`);
export const resumeChat = (chatId: string, runId: string, dismiss?: boolean) =>
  apiRequest<{ ok: boolean }>("POST", `/v1/chats/${enc(chatId)}/resume`, dismiss === undefined ? { runId } : { runId, dismiss });
export const getPromptPreview = (chatId: string) => apiRequest<any>("GET", `/v1/chats/${enc(chatId)}/prompt-preview`);

export const getReactions = (chatId: string) =>
  apiRequest<{ reactions: Reaktion[] }>("GET", `/v1/chats/${enc(chatId)}/reactions`);
export const setReaction = (chatId: string, messageId: string, emoji: string) =>
  apiRequest<{ ok: boolean; answered: boolean }>("PUT", `/v1/chats/${enc(chatId)}/messages/${enc(messageId)}/reaction`, { emoji });
export const removeReaction = (chatId: string, messageId: string) =>
  apiRequest<{ ok: boolean; removed: boolean }>("DELETE", `/v1/chats/${enc(chatId)}/messages/${enc(messageId)}/reaction`);
export const markSeen = (chatId: string) => apiRequest<{ ok: boolean }>("POST", `/v1/chats/${enc(chatId)}/seen`);

// ---------- 3 / 4 Eingabe und Turn-Strom ----------
export interface TurnOptions {
  botId?: string;
  trigger?: "submit-message" | "regenerate-message";
  messageId?: string;
  clientData?: Record<string, Json>;
  /** Eigene ID der Nutzer-Nachricht (für die optimistische Anzeige). */
  id?: string;
}

/** Schickt eine Nutzer-Nachricht; die Antwort kommt als Turn-Chunks bei onChunk an. */
export function sendTurn(
  chatId: string,
  text: string,
  files: Datei[] = [],
  botId: string | undefined,
  onChunk: (c: TurnChunk) => void,
  opts: TurnOptions = {},
) {
  const parts: Json[] = [];
  if (text) parts.push({ type: "text", text });
  for (const f of files) {
    const p: { [k: string]: Json } = { type: "file", url: f.url, mediaType: f.mediaType };
    if (f.filename) p.filename = f.filename;
    parts.push(p);
  }
  const message: { [k: string]: Json } = { role: "user", parts };
  if (opts.id) message.id = opts.id;
  const clientData: { [k: string]: Json } = { ...(opts.clientData ?? {}) };
  if (botId) clientData.botId = botId;
  const payload: { [k: string]: Json } = {
    messages: [message],
    trigger: opts.trigger ?? "submit-message",
  };
  if (opts.messageId) payload.messageId = opts.messageId;
  if (botId) payload.botId = botId;
  if (Object.keys(clientData).length) payload.clientData = clientData;
  return apiStream("POST", `/v1/chats/${enc(chatId)}/turn`, payload, onChunk as (e: any) => void);
}

/** Onboarding-Zug: Begrüßung ohne Nutzer-Nachricht. */
export function startOnboardingTurn(chatId: string, botId: string, model: string, onChunk: (c: TurnChunk) => void) {
  return apiStream(
    "POST", `/v1/chats/${enc(chatId)}/turn`,
    { messages: [], trigger: "submit-message", clientData: { model, botId, onboarding: true } },
    onChunk as (e: any) => void,
  );
}

/** Hängt sich an einen laufenden Strom des Chats (ab Anfang); endet sofort bei 204. */
export const attachStream = (chatId: string, onChunk: (c: TurnChunk) => void) =>
  apiStream("GET", `/v1/chats/${enc(chatId)}/stream`, undefined, onChunk as (e: any) => void);

/** Ereignis-Strom (erstes Ereignis: snapshot). */
export const openEvents = (onEvent: (e: any) => void) => apiStream("GET", "/v1/events", undefined, onEvent);

// ---------- 2.4 Freigaben und Rückfragen ----------
export const getApprovals = () => apiRequest<{ approvals: Karte[] }>("GET", "/v1/approvals");
export const decideApproval = (id: string, decision: Entscheidung) =>
  apiRequest<{ ok: boolean }>("POST", `/v1/approvals/${enc(id)}/decide`, { decision });
export const answerQuestion = (id: string, answers: Antwort[]) =>
  apiRequest<{ ok: boolean }>("POST", `/v1/questions/${enc(id)}/answer`, { answers: body(answers) });
export const skipQuestion = (id: string) =>
  apiRequest<{ ok: boolean }>("POST", `/v1/questions/${enc(id)}/answer`, { skipped: true });
export const answerWidget = (id: string, answer: { selected: string[]; custom?: string }) =>
  apiRequest<{ ok: boolean; replyMessageId?: string }>("POST", `/v1/widgets/${enc(id)}/answer`, body({ ...answer, deliverReply: true }));
export const answerSecret = (id: string, answer: { value: string }) =>
  apiRequest<{ ok: boolean; replyMessageId?: string }>("POST", `/v1/secrets/${enc(id)}/answer`, body({ ...answer, deliverReply: true }));

// ---------- 2.5 Routinen ----------
export const getAutomations = () =>
  apiRequest<{ ok: boolean; automations: Routine[]; trash: Routine[] }>("GET", "/v1/automations");
export const getAutomationsUnread = (since?: number) =>
  apiRequest<{ ok: boolean; count: number }>("GET", `/v1/automations/unread${query({ since })}`);
export const updateAutomation = (id: string, input: Partial<RoutineInput>) =>
  apiRequest<{ ok: boolean }>("PATCH", `/v1/automations/${enc(id)}`, body(input));
export const setAutomationEnabled = (id: string, enabled: boolean) =>
  apiRequest<{ ok: boolean }>("PUT", `/v1/automations/${enc(id)}/enabled`, { enabled });
export const trashAutomation = (id: string) => apiRequest<{ ok: boolean }>("POST", `/v1/automations/${enc(id)}/trash`);
export const restoreAutomation = (id: string) => apiRequest<{ ok: boolean }>("POST", `/v1/automations/${enc(id)}/restore`);
export const deleteAutomation = (id: string) => apiRequest<{ ok: boolean }>("DELETE", `/v1/automations/${enc(id)}`);
export const getAutomationRuns = (id: string) =>
  apiRequest<{ ok: boolean; runs: RoutineRun[] }>("GET", `/v1/automations/${enc(id)}/runs`);
export const runAutomation = (id: string) => apiRequest<{ ok: boolean; runId: string }>("POST", `/v1/automations/${enc(id)}/run`);

// ---------- 2.7 Einstellungen ----------
export const getSettings = () => apiRequest<{ ok: boolean; settings: Einstellungen }>("GET", "/v1/settings");
export const setTheme = (theme: Einstellungen["theme"]) => apiRequest<{ ok: boolean }>("PUT", "/v1/settings/theme", { theme });
export const setJev = (v: { auto?: boolean; handoff?: boolean }) => apiRequest<{ ok: boolean }>("PUT", "/v1/settings/jev", v);
export const setInstructions = (instructions: string | null) =>
  apiRequest<{ ok: boolean }>("PUT", "/v1/settings/instructions", { instructions });
export const getDefaultInstructions = () =>
  apiRequest<{ ok: boolean; text: string; limit: number }>("GET", "/v1/settings/instructions/default");
export const getRules = () => apiRequest<{ ok: boolean; rules: Regel[] }>("GET", "/v1/settings/rules");
export const setRule = (tool: string, mode: Regel["mode"], botId?: string) =>
  apiRequest<{ ok: boolean }>("POST", "/v1/settings/rules", botId ? { tool, mode, botId } : { tool, mode });
export const deleteRule = (id: string) => apiRequest<{ ok: boolean }>("DELETE", `/v1/settings/rules/${enc(id)}`);
export const getBudget = () => apiRequest<{ ok: boolean } & Budget>("GET", "/v1/budget");
export const setBudget = (v: { jevDailyUsd?: number; maxSandboxes?: number }) =>
  apiRequest<{ ok: boolean } & Budget>("PUT", "/v1/budget", v);
export const getKeys = () => apiRequest<{ ok: boolean; keys: SchluesselInfo[] }>("GET", "/v1/keys");
export const setKey = (name: string, key: string) =>
  apiRequest<{ ok: boolean; set: boolean }>("PUT", `/v1/keys/${enc(name)}`, { key });
export const reloadKeys = (names?: string[]) =>
  apiRequest<{ ok: boolean; keys: SchluesselInfo[]; needsRestart: string[] }>("POST", "/v1/keys/reload", names ? { names } : {});
export const search = (q: string) =>
  apiRequest<{ ok: boolean; indexing: boolean; results: SuchTreffer[] }>("GET", `/v1/search${query({ q })}`);
export const getJev = () => apiRequest<{ ok: boolean; entries: any[] }>("GET", "/v1/jev");
export const getModels = () => apiRequest<{ ok: boolean; modelsAvailable: boolean; models: ModellInfo[]; cursorError?: string }>("GET", "/v1/models");
export const getUsage = (fresh?: boolean) =>
  apiRequest<{ ok: boolean; providers: any[]; fetchedAt: string }>("GET", `/v1/usage${query({ fresh: fresh ? 1 : undefined })}`);

// ---------- 2.9 Marktplatz, Plugins, MCP ----------
export const getMarketplace = () => apiRequest<{ ok: boolean; entries: MarktplatzEintrag[] }>("GET", "/v1/marketplace");
export const reloadPlugins = () => apiRequest<{ ok: boolean }>("POST", "/v1/plugins/reload");
export const verifyPlugins = (key: string, user: string) => apiRequest<{ ok: boolean }>("POST", "/v1/plugins/verify", { key, user });
export const getPlugins = (f: PluginFilter = {}) => apiRequest<PluginListe>("GET", `/v1/plugins${query({ ...f })}`);
export const connectPlugin = (slug: string, additional?: boolean) =>
  apiRequest<any>("POST", `/v1/plugins/${enc(slug)}/connect`, additional === undefined ? {} : { additional });
export const getPluginStatus = (slug: string, accountId?: string) =>
  apiRequest<any>("GET", `/v1/plugins/${enc(slug)}/status${query({ accountId })}`);
export const getPluginAccounts = (slug: string) =>
  apiRequest<{ ok: boolean; accounts: { id: string; status: string }[] }>("GET", `/v1/plugins/${enc(slug)}/accounts`);
export const deletePluginAccounts = (slug: string, accountIds: string[]) =>
  apiRequest<{ ok: boolean; deletedIds: string[]; failedIds: string[]; notice: string }>(
    "DELETE", `/v1/plugins/${enc(slug)}/accounts`, { accountIds, confirmed: true });
export const getPluginSetup = (slug: string) => apiRequest<any>("GET", `/v1/plugins/${enc(slug)}/setup`);
export const postPluginSetup = (slug: string, scheme: string, fields: Record<string, Json>) =>
  apiRequest<any>("POST", `/v1/plugins/${enc(slug)}/setup`, { scheme, fields });
export const getMcpServers = () => apiRequest<{ ok: boolean; servers: McpServer[] }>("GET", "/v1/mcp-servers");
export const addMcpServer = (s: { name: string; transport: "http" | "stdio"; url?: string; command?: string; args?: string[]; token?: string }) =>
  apiRequest<{ ok: boolean; server: McpServer }>("POST", "/v1/mcp-servers", body(s));
export const deleteMcpServer = (name: string) => apiRequest<{ ok: boolean }>("DELETE", `/v1/mcp-servers/${enc(name)}`);
export const testMcpServer = (name: string) =>
  apiRequest<{ ok: boolean; count: number; tools: any[] }>("POST", `/v1/mcp-servers/${enc(name)}/test`);

export type { Automation, Nachricht };
