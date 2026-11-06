import { relations, sql } from "drizzle-orm"
import {
  index,
  integer,
  sqliteTable,
  primaryKey,
  real,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"
import { nanoid } from "nanoid"
import type { UIMessage } from "ai"

export const chatMessages = sqliteTable(
  "chat_messages",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    role: text("role", { enum: ["user", "assistant", "system"] }).notNull(),
    parts: text("parts", { mode: "json" })
      .$type<UIMessage["parts"]>()
      .notNull(),
    metadata: text("metadata", { mode: "json" }).$type<unknown>(),
    position: integer("position").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
  },
  (table) => [
    primaryKey({ columns: [table.chatId, table.id] }),
    uniqueIndex("chat_messages_position_idx").on(table.chatId, table.position),
  ]
)

export type BotLook = {
  eyes?: "round" | "square" | "triangle"
  accessory?: "none" | "cap" | "glasses" | "sunglasses" | "headphones"
  cheeks?: boolean
  gaze?: number // Blickstärke 0 bis 1
  reaction?: number // Reaktionszeit der Pupille in Sekunden
}

export const bots = sqliteTable(
  "bots",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id").notNull(),
    thirdPartyId: text("third_party_id").notNull(),
    name: text("name").notNull(),
    avatar: text("avatar")
      .notNull()
      .$defaultFn(() => nanoid()),
    color: text("color"),
    job: text("job").notNull(),
    instructions: text("instructions"),
    // Hauptbot = Koordinator der anderen Bots. Pro Nutzer höchstens einer.
    isMain: integer("is_main", { mode: "boolean" }).notNull().default(false),
    sandboxId: text("sandbox_id"),
    // Onboarding abgeschlossen oder übersprungen; neue Orbis starten mit false, bestehende gelten als fertig.
    onboardingDone: integer("onboarding_done", { mode: "boolean" })
      .notNull()
      .default(true),
    // Aussehen der Figur über Planet und Farbe hinaus (Augenform, Zubehör, Wangen, Blickstärke, Reaktionszeit); null = Standard.
    look: text("look", { mode: "json" }).$type<BotLook | null>(),
    // Träumer (Lauf I): räumt nachts das lokale Gedächtnis dieses Orbis auf; Standard an.
    dreamerEnabled: integer("dreamer_enabled", { mode: "boolean" }).notNull().default(true),
    // Heartbeat (Phase 5): meldet sich höchstens einmal am Tag leise von selbst; Standard aus.
    heartbeatEnabled: integer("heartbeat_enabled", { mode: "boolean" }).notNull().default(false),
    // Version für optimistische Sperren (Phase F: update_orbi mit expected_version)
    version: integer("version").notNull().default(1),
    // Archivierung statt Löschen (Phase F: archive_orbi)
    archivedAt: integer("archived_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
  },
  (table) => [
    index("bots_user_id_idx").on(table.userId),
    uniqueIndex("bots_one_main_per_user_idx")
      .on(table.userId)
      .where(sql`${table.isMain}`),
  ]
)

export const chats = sqliteTable(
  "chats",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id").notNull(),
    kind: text("kind", { enum: ["direct", "group"] })
      .notNull()
      .default("direct"),
    name: text("name"), // null bei direct: dort zählt der Name des Bots
    lastMessagePreview: text("last_message_preview"),
    lastMessageAt: integer("last_message_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
  },
  (table) => [index("chats_user_id_idx").on(table.userId)]
)

export const chatMembers = sqliteTable(
  "chat_members",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    joinedAt: integer("joined_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
  },
  (table) => [
    primaryKey({ columns: [table.chatId, table.botId] }),
    index("chat_members_bot_id_idx").on(table.botId),
  ]
)

export const botsRelations = relations(bots, ({ many }) => ({
  memberships: many(chatMembers),
}))

export const chatsRelations = relations(chats, ({ many }) => ({
  members: many(chatMembers),
}))

export const chatMembersRelations = relations(chatMembers, ({ one }) => ({
  chat: one(chats, { fields: [chatMembers.chatId], references: [chats.id] }),
  bot: one(bots, { fields: [chatMembers.botId], references: [bots.id] }),
}))

export const userSettings = sqliteTable("user_settings", {
  userId: text("user_id").primaryKey(),
  theme: text("theme").notNull().default("system"), // light | dark | system, geprüft in lib/settings/theme.ts
  jevAuto: integer("jev_auto", { mode: "boolean" }).notNull().default(true),
  jevHandoff: integer("jev_handoff", { mode: "boolean" })
    .notNull()
    .default(false),
  baseInstructions: text("base_instructions"),
  // Veraltet (Phase 3 Korrektur): Antwortlänge ist fest kurz, die Spalte bleibt und wird ignoriert.
  replyLength: text("reply_length").notNull().default("short"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).default(
    sql`(unixepoch('subsecond') * 1000)`
  ),
})

export const skills = sqliteTable(
  "skills",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
  },
  (table) => [
    uniqueIndex("skills_user_id_name_idx").on(table.userId, table.name),
    index("skills_user_id_idx").on(table.userId),
  ]
)

export const mcpConnectors = sqliteTable("mcp_connectors", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => nanoid()),
  userId: text("user_id").notNull(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  authEncrypted: text("auth_encrypted"),
  // Eigener Headername (z. B. x-api-key); leer = Authorization: Bearer.
  authHeader: text("auth_header"),
  // Verschlüsselter OAuth-Zustand (Client, Tokens, Verifier) für Server mit Anmeldung im Browser.
  oauthEncrypted: text("oauth_encrypted"),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsecond') * 1000)`),
})

export const botConnectors = sqliteTable(
  "bot_connectors",
  {
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    connectorId: text("connector_id")
      .notNull()
      .references(() => mcpConnectors.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.botId, table.connectorId] })]
)

export const jevLog = sqliteTable(
  "jev_log",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    userId: text("user_id").notNull(),
    chatId: text("chat_id"),
    kind: text("kind").notNull(),
    model: text("model"),
    reason: text("reason"),
    durationMs: integer("duration_ms"),
    costUsd: real("cost_usd"),
    payload: text("payload", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
  },
  (table) => [
    index("jev_log_user_id_created_at_idx").on(table.userId, table.createdAt),
  ]
)

// Reaktionen (Tapback) auf Chat-Nachrichten. Eigene Tabelle, weil saveMessages den Verlauf neu schreibt (Nachrichten-IDs bleiben stabil).
// actor = "user" oder Orbi-ID; je Absender eine Reaktion pro Nachricht, eine neue ersetzt die alte.
export const messageReactions = sqliteTable(
  "message_reactions",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    messageId: text("message_id").notNull(),
    actor: text("actor").notNull(),
    emoji: text("emoji").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
  },
  (table) => [
    primaryKey({ columns: [table.chatId, table.messageId, table.actor] }),
  ]
)

// Turn-Log als Token-Messbasis: Zahlen je Turn, nie Prompt-Inhalte.
export const turnUsage = sqliteTable(
  "turn_usage",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => nanoid()),
    chatId: text("chat_id").notNull(),
    botId: text("bot_id").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens"),
    cachedTokens: integer("cached_tokens"),
    outputTokens: integer("output_tokens"),
    systemChars: integer("system_chars").notNull(),
    toolCount: integer("tool_count").notNull(),
    historyMsgs: integer("history_msgs").notNull(),
    // Phase 4, Lauf G (Migration 0007): Schritte, Kosten, Cache, Teilgrößen, Art und Dauer des Turns.
    steps: integer("steps"),
    costUsd: real("cost_usd"),
    cacheWriteTokens: integer("cache_write_tokens"),
    cacheRatio: real("cache_ratio"),
    toolsChars: integer("tools_chars"),
    volatileChars: integer("volatile_chars"),
    historyChars: integer("history_chars"),
    toolResultChars: integer("tool_result_chars"),
    turnKind: text("turn_kind"),
    durationMs: integer("duration_ms"),
    summaryUsed: integer("summary_used"),
    // Lauf I: Jev-Stufe dieses Turns und was sich geändert hat (start, keep, upgrade, reset, pinned, fallback).
    tier: text("tier"),
    tierChange: text("tier_change"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
  },
  (table) => [
    index("turn_usage_chat_id_created_at_idx").on(
      table.chatId,
      table.createdAt
    ),
  ]
)

// Laufende Zusammenfassung des älteren Verlaufs je Chat (Lauf G). Der Vollverlauf bleibt in chat_messages.
export const chatSummaries = sqliteTable("chat_summaries", {
  chatId: text("chat_id")
    .primaryKey()
    .references(() => chats.id, { onDelete: "cascade" }),
  coveredLastId: text("covered_last_id").notNull(),
  coveredCount: integer("covered_count").notNull(),
  sourceChars: integer("source_chars").notNull(),
  summaryChars: integer("summary_chars").notNull(),
  data: text("data").notNull(),
  model: text("model").notNull(),
  costUsd: real("cost_usd"),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsecond') * 1000)`),
})

// Lokales Gedächtnis je Orbi (Lauf H): kleine Einträge mit Herkunft, Version und stated-Kennzeichen. Das Original-MEMORY.md
// in der Sandbox wird nur gelesen (einmalige Migration, siehe orbi_memory_meta).
export const orbiMemory = sqliteTable(
  "orbi_memory",
  {
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: text("type").notNull(),
    description: text("description").notNull(),
    body: text("body").notNull(),
    stated: integer("stated", { mode: "boolean" }).notNull().default(false),
    origin: text("origin").notNull(),
    source: text("source").notNull(),
    version: integer("version").notNull().default(1),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
  },
  (table) => [primaryKey({ columns: [table.botId, table.name] })]
)

// Änderungslog des Gedächtnisses (Speichern, Ersetzen, Vergessen, Migration); Grundlage für den späteren Träumer.
export const orbiMemoryLog = sqliteTable(
  "orbi_memory_log",
  {
    id: integer("id").primaryKey(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    action: text("action").notNull(),
    version: integer("version"),
    detail: text("detail"),
    at: integer("at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
  },
  (table) => [index("orbi_memory_log_bot_id_idx").on(table.botId, table.at)]
)

export const orbiMemoryMeta = sqliteTable("orbi_memory_meta", {
  botId: text("bot_id")
    .primaryKey()
    .references(() => bots.id, { onDelete: "cascade" }),
  migratedAt: integer("migrated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsecond') * 1000)`),
  sourceHash: text("source_hash").notNull(),
  sourceChars: integer("source_chars").notNull(),
  imported: integer("imported").notNull(),
})

// Gemerktes Modell je Gespräch und Orbi (Lauf I): Jev stuft innerhalb eines Gesprächs nur nach oben (Cache bleibt warm).
export const chatModelState = sqliteTable(
  "chat_model_state",
  {
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    botId: text("bot_id").notNull(),
    model: text("model").notNull(),
    effort: text("effort"),
    tier: text("tier").notNull(),
    rank: integer("rank").notNull(),
    lastTurnAt: integer("last_turn_at").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
  },
  (table) => [primaryKey({ columns: [table.chatId, table.botId] })]
)

// Träumer (Lauf I): Takt-Zustand und Sperre je Orbi, dazu ein Protokoll je Lauf (Änderungen selbst stehen in orbi_memory_log).
export const orbiDream = sqliteTable("orbi_dream", {
  botId: text("bot_id")
    .primaryKey()
    .references(() => bots.id, { onDelete: "cascade" }),
  nextRunAt: integer("next_run_at").notNull(),
  lastRunAt: integer("last_run_at"),
  lastHash: text("last_hash"),
  runningSince: integer("running_since"),
})

export const orbiDreamRuns = sqliteTable(
  "orbi_dream_runs",
  {
    id: text("id").primaryKey(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
    status: text("status").notNull(),
    reason: text("reason"),
    entriesBefore: integer("entries_before"),
    entriesAfter: integer("entries_after"),
    ops: integer("ops"),
    costUsd: real("cost_usd"),
    error: text("error"),
  },
  (table) => [index("orbi_dream_runs_bot_id_idx").on(table.botId, table.startedAt)]
)

// Sehr große Tool-Ausgaben (über dem Deckel) in voller Länge; das Modell bekommt Kopf + ID und liest per chat_recall nach.
export const toolOutputs = sqliteTable(
  "tool_outputs",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    tool: text("tool").notNull(),
    chars: integer("chars").notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
  },
  (table) => [index("tool_outputs_chat_id_idx").on(table.chatId)]
)

// Freigabe-Regeln: allow = „Immer für diese Art“ (tool ist die Art, z. B. bash:loeschen oder connector:<id>:<tool>),
// deny = Sperre und gewinnt immer. ask aus der Modus-Zeit wird ignoriert, nicht gelöscht. bot_id leer = alle Orbis.
export const approvalRules = sqliteTable(
  "approval_rules",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    botId: text("bot_id").references(() => bots.id, { onDelete: "cascade" }),
    tool: text("tool").notNull(),
    mode: text("mode").notNull(), // allow | ask | deny
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
  },
  (table) => [
    index("approval_rules_user_id_idx").on(table.userId),
    uniqueIndex("approval_rules_global_unique_idx")
      .on(table.userId, table.tool)
      .where(sql`${table.botId} is null`),
    uniqueIndex("approval_rules_bot_unique_idx")
      .on(table.userId, table.tool, table.botId)
      .where(sql`${table.botId} is not null`),
  ]
)

// Volltextsuche über Chat-Nachrichten (P9b): eine Zeile je Nachricht, Text ohne Anhänge.
export const chatMessagesIndex = sqliteTable(
  "chat_messages_index",
  {
    id: text("id").primaryKey(), // `${chatId}:${messageId}`
    userId: text("user_id").notNull(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
  },
  (table) => [
    index("chat_messages_index_user_chat_idx").on(table.userId, table.chatId),
  ]
)

// Automationen (P9b): Zeitplan je Orbi; Läufe in automation_runs (letzte 20 je Automation).
export const automations = sqliteTable(
  "automations",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    prompt: text("prompt").notNull(),
    schedule: text("schedule", { mode: "json" }).notNull(), // { kind, at, weekday?, day?, date? }
    timezone: text("timezone").notNull().default("Europe/Berlin"),
    target: text("target").notNull().default("new"), // same | new
    chatId: text("chat_id"), // bei target "same"
    notify: text("notify").notNull().default("app"), // app | none
    model: text("model"), // null = Standard (Haiku); sonst Modell-ID oder Jev-Auto
    effort: text("effort"),
    context: integer("context", { mode: "boolean" }).notNull().default(true), // false: Modell sieht nur die Aufgabe
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
    pausedReason: text("paused_reason"),
    lastRunAt: integer("last_run_at", { mode: "timestamp_ms" }),
    resumedAt: integer("resumed_at", { mode: "timestamp_ms" }), // Schonfrist gegen sofortiges Auto-Pausieren
    nextRunAt: integer("next_run_at", { mode: "timestamp_ms" }),
    deletedAt: integer("deleted_at", { mode: "timestamp_ms" }), // Papierkorb
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
  },
  (table) => [
    index("automations_user_id_idx").on(table.userId),
    index("automations_next_run_idx").on(table.nextRunAt),
  ]
)

export const automationRuns = sqliteTable(
  "automation_runs",
  {
    id: text("id").primaryKey(),
    automationId: text("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    chatId: text("chat_id"),
    status: text("status").notNull(), // running | ok | error
    trigger: text("trigger").notNull().default("schedule"), // schedule | manual
    error: text("error"),
    startedAt: integer("started_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
    finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  },
  (table) => [
    index("automation_runs_automation_idx").on(
      table.automationId,
      table.startedAt
    ),
  ]
)

// Wird erst nach dem separat freigegebenen Schema-Gate im Approval-Store verwendet.
export const approvalRequests = sqliteTable(
  "approval_requests",
  {
    toolCallId: text("tool_call_id").notNull(),
    userId: text("user_id").notNull(),
    tool: text("tool").notNull(),
    automationRunId: text("automation_run_id").references(
      () => automationRuns.id,
      { onDelete: "set null" }
    ),
    requestedAt: integer("requested_at", { mode: "timestamp_ms" })
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.toolCallId] }),
    index("approval_requests_automation_run_idx").on(table.automationRunId),
  ]
)

// Läuft gerade ein Turn dieses Orbis? Zeile von Turn-Start bis Turn-Ende; Quelle für "arbeitet" in der ganzen App.
export const orbiWork = sqliteTable("orbi_work", {
  chatId: text("chat_id").primaryKey(),
  botId: text("bot_id").notNull(),
  userId: text("user_id").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch('subsecond') * 1000)`),
})

// ---- Phase 5 (Migration 0010): dauerhafte Arbeit, offene Freigaben, Zähler, Gedächtnis-Papierkorb, Budget, Heartbeat ----

// Dauerhafte Jobs: ein Turn, eine Übergabe oder eine Automation. Beim Start von orbitd wird running/waiting zu interrupted.
export const workRuns = sqliteTable(
  "work_runs",
  {
    id: text("id").primaryKey(),
    kind: text("kind", { enum: ["turn", "handoff", "automation"] }).notNull(),
    chatId: text("chat_id").notNull(),
    botId: text("bot_id"),
    parentId: text("parent_id"),
    status: text("status", {
      enum: ["queued", "running", "waiting", "done", "failed", "interrupted"],
    }).notNull(),
    payload: text("payload"),
    steps: integer("steps").notNull().default(0),
    startedAt: integer("started_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    finishedAt: integer("finished_at"),
    error: text("error"),
    note: text("note"),
  },
  (table) => [
    index("work_runs_status_idx").on(table.status, table.updatedAt),
    index("work_runs_chat_idx").on(table.chatId, table.startedAt),
  ]
)

// Offene Freigaben und Rückfragen (Kopie des Speichers, damit sie einen Neustart überstehen).
export const pendingInteractions = sqliteTable("pending_interactions", {
  id: text("id").primaryKey(),
  chatId: text("chat_id").notNull(),
  botId: text("bot_id").notNull(),
  kind: text("kind").notNull(),
  request: text("request").notNull(),
  requestedAt: integer("requested_at").notNull(),
  expiresAt: integer("expires_at").notNull(),
})

// Zähler je Auftrag (Nachrichten, Gruppenrunden und Ping-Pong je Paar).
export const taskCounters = sqliteTable("task_counters", {
  taskId: text("task_id").primaryKey(),
  rootChatId: text("root_chat_id").notNull(),
  sent: integer("sent").notNull().default(0),
  groupRounds: integer("group_rounds").notNull().default(0),
  deepCalls: integer("deep_calls").notNull().default(0),
  pairWakes: text("pair_wakes").notNull().default("[]"),
  updatedAt: integer("updated_at").notNull(),
})

export const orbiMemoryAttempts = sqliteTable("orbi_memory_attempts", {
  botId: text("bot_id").primaryKey().references(() => bots.id, { onDelete: "cascade" }),
  attempts: integer("attempts").notNull().default(0),
  lastAt: integer("last_at").notNull(),
})

// Gelöschte Gedächtnis-Einträge (Stand zum Zeitpunkt des Löschens) zum Wiederherstellen.
export const orbiMemoryTrash = sqliteTable(
  "orbi_memory_trash",
  {
    id: integer("id").primaryKey(),
    botId: text("bot_id").notNull().references(() => bots.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    snapshot: text("snapshot").notNull(),
    deletedAt: integer("deleted_at").notNull(),
    reason: text("reason"),
  },
  (table) => [index("orbi_memory_trash_bot_idx").on(table.botId, table.deletedAt)]
)

// Wann Consti einen Chat zuletzt angesehen hat (Quelle für „neu“ in der Seitenleiste).
export const chatSeen = sqliteTable("chat_seen", {
  chatId: text("chat_id").primaryKey(),
  seenAt: integer("seen_at").notNull(),
})

export const appKv = sqliteTable("app_kv", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull(),
})

export const orbiHeartbeat = sqliteTable("orbi_heartbeat", {
  botId: text("bot_id").primaryKey().references(() => bots.id, { onDelete: "cascade" }),
  nextRunAt: integer("next_run_at").notNull(),
  lastRunAt: integer("last_run_at"),
  lastHash: text("last_hash"),
  lastMessageDay: text("last_message_day"),
  runningSince: integer("running_since"),
})

// ---- Phase B & C (Migration 0011): Hintergrund-Helfer (tasks) & Auftragsbaum, Warteschlange (todos) ----

export const tasks = sqliteTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    orbiId: text("orbi_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    parentChatId: text("parent_chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    parentTaskId: text("parent_task_id"),
    brief: text("brief").notNull(),
    title: text("title"),
    mode: text("mode", { enum: ["work", "consult", "notify"] })
      .notNull()
      .default("work"),
    reply: text("reply", { enum: ["resume", "none"] })
      .notNull()
      .default("resume"),
    status: text("status", {
      enum: ["queued", "running", "waiting", "done", "failed", "stopped"],
    })
      .notNull()
      .default("queued"),
    result: text("result"),
    progress: text("progress"),
    doneWhen: text("done_when"),
    answers: text("answers"),
    rework: text("rework"),
    resumeOf: text("resume_of"),
    assignedBotId: text("assigned_bot_id"),
    startedAt: integer("started_at"),
    lastProgressAt: integer("last_progress_at"),
    finishedAt: integer("finished_at"),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
    updatedAt: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
  },
  (table) => [
    index("tasks_orbi_idx").on(table.orbiId, table.status),
    index("tasks_parent_chat_idx").on(table.parentChatId, table.status),
    index("tasks_status_idx").on(table.status, table.updatedAt),
    index("tasks_parent_task_idx").on(table.parentTaskId),
  ]
)

export const todos = sqliteTable(
  "todos",
  {
    id: text("id").primaryKey(),
    chatId: text("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    botId: text("bot_id")
      .notNull()
      .references(() => bots.id, { onDelete: "cascade" }),
    taskId: text("task_id"),
    content: text("content").notNull(),
    status: text("status", { enum: ["todo", "in_progress", "done", "cancelled"] })
      .notNull()
      .default("todo"),
    position: integer("position").notNull().default(0),
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
    updatedAt: integer("updated_at")
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
  },
  (table) => [
    index("todos_chat_idx").on(table.chatId, table.status),
    index("todos_task_idx").on(table.taskId),
  ]
)

// Rückgängig-Aktionen (Phase D & F: für Routinen, Orbis und Profile)
export const undoActions = sqliteTable(
  "undo_actions",
  {
    id: text("id").primaryKey(),
    kind: text("kind").notNull(), // memory | routine | orbi | profile
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(), // create | update | pause | resume | archive | delete
    detail: text("detail").notNull(),
    previousState: text("previous_state"), // JSON
    createdAt: integer("created_at")
      .notNull()
      .default(sql`(unixepoch('subsecond') * 1000)`),
  },
  (table) => [
    index("undo_actions_kind_idx").on(table.kind, table.createdAt),
  ]
)
