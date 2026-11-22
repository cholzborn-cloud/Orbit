// Typen der Datenschicht, nach docs/neubau/SCHNITTSTELLE.md (Abschnitte 2–5).

export type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

export type AvatarName =
  | "erdi" | "marsi" | "sati" | "jupi" | "mondi" | "veni" | "nepi" | "urani" | "pluti" | "universi"
  | "strobi" | "freddy" | "citrus" | "nova" | "grokbot" | "sunee" | "kirby" | "cloudee" | "cubee"
  | "onee" | "rauti" | "trixi" | "tropi" | "mopsi" | "dosi";

export interface OrbiLook {
  gaze?: number;
  reaction?: number;
}

export interface Bot {
  chatId: string;
  id: string;
  name: string;
  avatar: string;
  color: string | null;
  job: string;
  instructions: string;
  isMain: boolean;
  onboardingDone: boolean;
  look: OrbiLook | null;
  lastMessageAt: string | null;
}

export interface BotInput {
  name: string;
  job: string;
  avatar: string;
  color?: string | null;
  isMain?: boolean;
  instructions?: string;
  look?: OrbiLook;
}

export interface GroupMember {
  id: string;
  name: string;
  avatar: string;
  color: string | null;
  look: OrbiLook | null;
}

/** Gruppe aus GET /v1/bots (groups). */
export interface Group {
  id: string;
  name: string;
  members: GroupMember[];
}

/** Eintrag aus GET /v1/chats. */
export interface Chat {
  id: string;
  lastMessageAt: string | null;
  memberCount: number;
}

export type ChatStatus = "arbeitet" | "wartet" | "fertig" | "fehler" | "ruhig";

export interface WorkingEntry {
  chatId: string;
  botId: string;
  status: ChatStatus;
}

export interface Interrupted {
  chatId?: string;
  runId: string;
  at: string;
  startedAt: string;
  steps: number;
}

// ---------- Karten ----------

export interface KarteVon {
  id: string;
  name: string;
  avatar: string;
  color: string | null;
}

export type KarteStatus = "pending" | "approved" | "denied" | "aborted" | "expired" | "answered";

/** Freigabe (kind "approval") oder Rückfrage (kind "ask"). */
export interface Karte {
  id: string;
  kind: "approval" | "ask";
  chatId: string;
  botId: string;
  toolCallId: string;
  tool: string;
  input: any;
  requestedAt: string;
  expiresAt: string;
  runId: string;
  reason?: string;
  approvalKind?: string;
  text?: string;
  detail?: string;
  root?: { chatId: string; taskId: string };
  from?: KarteVon;
  restored?: boolean;
  status?: KarteStatus;
}

export type Entscheidung = "once" | "always" | "deny";

export interface Antwort {
  question: string;
  answers: string[];
}

// ---------- Routinen ----------

export interface Schedule {
  kind: "daily" | "weekdays" | "weekly" | "monthly" | "once";
  at: string;
  weekday?: number;
  day?: number;
  date?: string;
}

export interface Automation {
  id: string;
  userId?: string;
  botId: string | null;
  name: string;
  prompt: string;
  schedule: Schedule;
  timezone: string | null;
  target: "same" | "new";
  chatId: string | null;
  notify: "app" | "none";
  model: string | null;
  effort: string | null;
  context: boolean;
  enabled: boolean;
  pausedReason: string | null;
  lastRunAt: string | null;
  resumedAt: string | null;
  nextRunAt: string | null;
  deletedAt: string | null;
  createdAt: string;
}

export interface Routine {
  automation: Automation;
  bot: { id: string; name: string; avatar: string };
  blocker?: string | null;
}

export interface RoutineInput {
  name: string;
  prompt: string;
  schedule: Schedule;
  timezone?: string;
  target?: "same" | "new";
  notify?: "app" | "none";
  context?: boolean;
  model?: string;
  effort?: string;
}

export interface RoutineRun {
  id: string;
  automationId: string;
  userId?: string;
  chatId: string | null;
  status: string;
  trigger: string;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface AutomationLauf {
  automationId: string;
  runId: string;
  status: "running" | "waiting" | "ok" | "error";
  chatId: string;
  trigger: string;
  error?: string;
}

// ---------- Nachrichten (AI-SDK-UI) ----------

export interface TextPart {
  type: "text";
  /** Chunk-ID des Textteils (nur beim Aufbau aus dem Strom). */
  id?: string;
  text: string;
  state?: "streaming" | "done";
}

export interface FilePart {
  type: "file";
  url: string;
  mediaType: string;
  filename?: string;
  /** Alt text of an image (SendToUser images). */
  alt?: string;
}

export interface ToolPart {
  type: `tool-${string}`;
  toolCallId: string;
  state: "input-available" | "output-available";
  input?: any;
  output?: any;
}

/** Image with alt text (standalone part or inside `tool-SendToUser`). */
export interface ImagePart {
  type: "image";
  url: string;
  alt?: string;
  mediaType?: string;
}

/** Voice memo (local audio). `durationMs` is optional; the player reads it from the file otherwise. */
export interface MemoPart {
  type: "memo";
  url: string;
  mediaType?: string;
  durationMs?: number;
  title?: string;
  transcript?: string;
}

/** Choice widget: 1–6 options, optional multi-select and custom input. `answer` is set once the user chose. */
export interface ChoiceOption {
  id?: string;
  value?: string;
  label: string;
  description?: string;
  style?: "default" | "primary" | "danger";
}

export interface ChoiceWidget {
  id?: string;
  helpText?: string;
  prompt?: string;
  options: ChoiceOption[];
  multiple?: boolean;
  allowCustom?: boolean;
  customPlaceholder?: string;
  answer?: { selected: string[]; custom?: string };
}

/** Marker that an assistant message replies inside a thread (to an earlier message). */
export interface ThreadMarker {
  messageId: string;
  name?: string;
  text?: string;
}

/** Secure-input request from SendToUser (value never appears in chat output). */
export interface SecretRequest {
  name: string;
  label: string;
  description?: string;
  pluginId?: string;
  answer?: { stored: boolean; movedOn?: boolean };
}

/** Input of the upcoming `tool-SendToUser` part (all fields optional; unknown fields are ignored). */
export interface SendToUserInput {
  text?: string;
  markdown?: string;
  images?: { url: string; alt?: string; mediaType?: string }[];
  widget?: ChoiceWidget;
  secret?: SecretRequest;
  memo?: Omit<MemoPart, "type">;
  replyTo?: ThreadMarker;
}

export type MessagePart = TextPart | FilePart | ToolPart | ImagePart | MemoPart;

export interface MessageMetadata {
  botId?: string;
  model?: string;
  effort?: string;
  startedAt?: string;
  finishedAt?: string;
  inputTokens?: number;
  outputTokens?: number;
  cachedTokens?: number;
  steps?: number;
  costUsd?: number;
  jev?: any;
  /** Nur in der Oberfläche: Lauf wurde gestoppt / ist gescheitert. */
  aborted?: boolean;
  error?: string;
  /** Nur in der Oberfläche: noch nicht bestätigte Nutzer-Nachricht. */
  pending?: boolean;
  replyTo?: AntwortBezug;
  /** Assistant reply inside a thread (upcoming delivery shape). */
  thread?: ThreadMarker;
  failed?: boolean;
  [k: string]: any;
}

export interface AntwortBezug {
  id: string;
  name: string;
  text: string;
}

export interface Nachricht {
  id: string;
  role: "user" | "assistant" | "system";
  parts: MessagePart[];
  metadata?: MessageMetadata;
}

export interface Reaktion {
  messageId: string;
  actor: string;
  emoji: string | null;
  createdAt?: string;
}

export interface NachrichtenSeite {
  messages: Nachricht[];
  hasMore?: boolean;
  interrupted: Interrupted | null;
  reactions: Reaktion[];
}

// ---------- Turn-Chunks (Abschnitt 4) ----------

export type TurnChunk =
  | { type: "start"; messageId: string; messageMetadata?: MessageMetadata }
  | { type: "start-step" }
  | { type: "text-start"; id: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "text-end"; id: string }
  | FilePart
  | MemoPart
  | { type: "tool-input-available"; toolCallId: string; toolName: string; input: any }
  | { type: "tool-output-available"; toolCallId: string; output: any }
  | { type: "finish-step" }
  | { type: "abort"; reason?: string }
  | { type: "error"; errorText: string }
  | { type: "finish"; finishReason?: "stop" | "error"; messageMetadata?: MessageMetadata };

// ---------- Ereignisse (Abschnitt 5, Union nach `type`) ----------

export interface LiveStep {
  chatId: string;
  botId: string;
  toolCallId: string;
  label: string;
  tool: string;
  step: number;
  at: string | number;
}

export type Ereignis =
  | {
      type: "snapshot";
      working: WorkingEntry[];
      approvals: Karte[];
      automations: { automationId: string; runId: string; status: string; chatId: string; trigger: string }[];
      steps: LiveStep[];
      questions?: Karte[];
    }
  | { type: "status"; chatId: string; botId: string; status: ChatStatus }
  | ({ type: "status-step"; state: "start" | "end" } & LiveStep)
  | { type: "notice"; chatId: string; text: string; kind: "error" }
  | { type: "orbi-message"; chatId: string; messageId?: string }
  | { type: "group-turn"; chatId: string; phase: "start" | "reply" | "silent" | "end"; botId?: string; messageId?: string; stopped?: boolean }
  | ({ type: "approval" } & Karte)
  | ({ type: "question" } & Karte)
  | { type: "reaction"; chatId: string; messageId: string; actor: string; emoji: string | null }
  | { type: "onboarding"; botId: string; done: true; instructions: boolean }
  | ({ type: "automation" } & AutomationLauf)
  | { type: "task"; taskId: string; action: "start" | "progress" | "done" | "stopped" | "failed"; chatId: string; botId: string; title: string; brief: string; progress: string | null }
  | { type: "orbis-created"; bots: { botId: string; chatId: string; name: string }[] }
  | { type: "desktop"; botId: string; state: "sleeping" | "running" | "transitioning" | "taken" | "unknown" | "unconfigured"; takeoverId?: string }
  | { type: "reminders-pending" }
  | { type: "reminders-cancelled"; id: string }
  | { type: "cli-setup"; id: string; phase: string; message: string; at: string | number };

// ---------- Status, Einstellungen, Plugins ----------

export interface StatusAntwort {
  ok: boolean;
  chats: WorkingEntry[];
  interrupted: Interrupted[];
  needsYou: number;
}

export interface HealthCheck {
  id: string;
  label: string;
  optional: boolean;
  state: "ok" | "fehlt" | "fehler";
  fix?: string;
  key?: string;
}

export interface Einstellungen {
  theme: "light" | "dark" | "system";
  jevAuto: boolean;
  jevHandoff: boolean;
  baseInstructions: string | null;
}

export interface Regel {
  id: string;
  tool: string;
  botId: string | null;
  botName: string | null;
  mode: "allow" | "ask" | "deny";
}

export interface Budget {
  budget: { jevDailyUsd: number; maxSandboxes: number };
  jev: { spentUsd: number; state: "ok" | "hinweis" | "aus"; percent: number };
  sandboxes: { active: number; max: number; waiting: number };
  tokens: { botId: string; turns: number; inputTokens: number; outputTokens: number; totalTokens: number }[];
}

export interface SchluesselInfo {
  name: string;
  label: string;
  set: boolean;
  source: "schluesselbund" | null;
  liveReload: boolean;
}

export interface SuchTreffer {
  chatId: string;
  chatName: string;
  avatar: string;
  color: string | null;
  role: string;
  messageId: string;
  snippet: string;
  createdAt: string;
  rank: number;
}

export interface Modellwunsch {
  model: string;
  effort: string | null;
  fast?: boolean;
}

export interface ModellInfo {
  id: string;
  label: string;
  description: string;
  provider: string;
  /** Die echten Denkstufen dieses Modells (leer: keine Wahl). */
  efforts: string[];
  /** Hat der Anbieter für dieses Modell einen Fast-Modus? */
  fast: boolean;
  /** Ältere Generation: im Picker unter „Ältere Modelle“. */
  legacy: boolean;
  cli: { provider: string; model: string };
}

export interface MarktplatzEintrag {
  type: "mcp" | "skill";
  [k: string]: any;
}

export interface PluginListe {
  ok: boolean;
  configured: boolean;
  entries: any[];
  nextCursor: string | null;
  totalItems: number;
  categories: any[];
  recommendedCount: number;
}

export interface PluginFilter {
  limit?: number;
  cursor?: string;
  search?: string;
  category?: string;
  connected?: boolean;
}

export interface McpServer {
  name: string;
  transport: "http" | "stdio";
  url: string | null;
  command: string | null;
  args: string[];
  enabled: boolean;
  hasToken: boolean;
  status: string;
  error: string | null;
  tools: { name: string; description: string; readOnly: boolean }[];
}

export interface Datei {
  /** Als data-URL (data:<mediaType>;base64,…) oder Adresse. */
  url: string;
  mediaType: string;
  filename?: string;
  /** Alt text of an image (SendToUser images). */
  alt?: string;
}

export type Verbindung = "getrennt" | "verbindet" | "verbunden";
