-- Grundschema für neue (leere) Datenbanken: Stand des alten Dienstes (Drizzle 0012), aus der echten Datenbank gelesen.
CREATE TABLE __drizzle_migrations (id INTEGER PRIMARY KEY, hash TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE `approval_requests` (
	`tool_call_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tool` text NOT NULL,
	`automation_run_id` text,
	`requested_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `tool_call_id`),
	FOREIGN KEY (`automation_run_id`) REFERENCES `automation_runs`(`id`) ON UPDATE no action ON DELETE set null
);
CREATE TABLE `approval_rules` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`bot_id` text,
	`tool` text NOT NULL,
	`mode` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `automation_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`automation_id` text NOT NULL,
	`user_id` text NOT NULL,
	`chat_id` text,
	`status` text NOT NULL,
	`trigger` text DEFAULT 'schedule' NOT NULL,
	`error` text,
	`started_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	`finished_at` integer,
	FOREIGN KEY (`automation_id`) REFERENCES `automations`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `automations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`name` text NOT NULL,
	`prompt` text NOT NULL,
	`schedule` text NOT NULL,
	`timezone` text DEFAULT 'Europe/Berlin' NOT NULL,
	`target` text DEFAULT 'new' NOT NULL,
	`chat_id` text,
	`notify` text DEFAULT 'app' NOT NULL,
	`model` text,
	`effort` text,
	`context` integer DEFAULT true NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`paused_reason` text,
	`last_run_at` integer,
	`resumed_at` integer,
	`next_run_at` integer,
	`deleted_at` integer,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `bot_connectors` (
	`bot_id` text NOT NULL,
	`connector_id` text NOT NULL,
	PRIMARY KEY(`bot_id`, `connector_id`),
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`connector_id`) REFERENCES `mcp_connectors`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `bots` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`third_party_id` text NOT NULL,
	`name` text NOT NULL,
	`avatar` text NOT NULL,
	`color` text,
	`job` text NOT NULL,
	`instructions` text,
	`is_main` integer DEFAULT false NOT NULL,
	`sandbox_id` text,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL
, `look` text, onboarding_done INTEGER NOT NULL DEFAULT 1, dreamer_enabled INTEGER NOT NULL DEFAULT 1, heartbeat_enabled INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1, archived_at INTEGER);
CREATE TABLE `chat_members` (
	`chat_id` text NOT NULL,
	`bot_id` text NOT NULL,
	`joined_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	PRIMARY KEY(`chat_id`, `bot_id`),
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`bot_id`) REFERENCES `bots`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `chat_messages_index` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_id` text NOT NULL,
	`role` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE `chats` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text DEFAULT 'direct' NOT NULL,
	`name` text,
	`last_message_preview` text,
	`last_message_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL
);
CREATE TABLE `jev_log` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`chat_id` text,
	`kind` text NOT NULL,
	`model` text,
	`reason` text,
	`duration_ms` integer,
	`payload` text,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL
, cost_usd REAL);
CREATE TABLE `mcp_connectors` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`auth_encrypted` text,
	`auth_header` text,
	`oauth_encrypted` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL
);
CREATE TABLE `orbi_work` (
	`chat_id` text PRIMARY KEY NOT NULL,
	`bot_id` text NOT NULL,
	`user_id` text NOT NULL,
	`started_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL
);
CREATE TABLE `skills` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`body` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL
);
CREATE TABLE `user_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`theme` text DEFAULT 'system' NOT NULL,
	`jev_auto` integer DEFAULT true NOT NULL,
	`jev_handoff` integer DEFAULT false NOT NULL,
	`base_instructions` text,
	`updated_at` integer DEFAULT (unixepoch('subsecond') * 1000)
, reply_length TEXT NOT NULL DEFAULT 'short');
CREATE TABLE `chat_messages` (
	`chat_id` text NOT NULL,
	`id` text NOT NULL,
	`role` text NOT NULL,
	`parts` text NOT NULL,
	`metadata` text,
	`position` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch('subsecond') * 1000) NOT NULL,
	PRIMARY KEY(`chat_id`, `id`),
	FOREIGN KEY (`chat_id`) REFERENCES `chats`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE TABLE bot_files (
  id TEXT NOT NULL,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  media_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  chat_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (bot_id, id)
);
CREATE TABLE turn_usage (
  id TEXT PRIMARY KEY NOT NULL,
  chat_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER,
  cached_tokens INTEGER,
  output_tokens INTEGER,
  system_chars INTEGER NOT NULL,
  tool_count INTEGER NOT NULL,
  history_msgs INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsecond') * 1000)
, steps INTEGER, cost_usd REAL, cache_write_tokens INTEGER, cache_ratio REAL, tools_chars INTEGER, volatile_chars INTEGER, history_chars INTEGER, tool_result_chars INTEGER, turn_kind TEXT, duration_ms INTEGER, summary_used INTEGER, tier TEXT, tier_change TEXT);
CREATE TABLE message_reactions (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsecond') * 1000),
  PRIMARY KEY (chat_id, message_id, actor)
);
CREATE TABLE chat_summaries (
  chat_id TEXT PRIMARY KEY NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  covered_last_id TEXT NOT NULL,
  covered_count INTEGER NOT NULL,
  source_chars INTEGER NOT NULL,
  summary_chars INTEGER NOT NULL,
  data TEXT NOT NULL,
  model TEXT NOT NULL,
  cost_usd REAL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('subsecond') * 1000)
);
CREATE TABLE tool_outputs (
  id TEXT PRIMARY KEY NOT NULL,
  chat_id TEXT NOT NULL,
  tool TEXT NOT NULL,
  chars INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsecond') * 1000)
);
CREATE TABLE orbi_memory (
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT NOT NULL,
  body TEXT NOT NULL,
  stated INTEGER NOT NULL DEFAULT 0,
  origin TEXT NOT NULL,
  source TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsecond') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('subsecond') * 1000),
  PRIMARY KEY (bot_id, name)
);
CREATE TABLE orbi_memory_log (
  id INTEGER PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  action TEXT NOT NULL,
  version INTEGER,
  detail TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch('subsecond') * 1000)
);
CREATE TABLE orbi_memory_meta (
  bot_id TEXT PRIMARY KEY NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  migrated_at INTEGER NOT NULL DEFAULT (unixepoch('subsecond') * 1000),
  source_hash TEXT NOT NULL,
  source_chars INTEGER NOT NULL,
  imported INTEGER NOT NULL
);
CREATE TABLE chat_model_state (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  bot_id TEXT NOT NULL,
  model TEXT NOT NULL,
  effort TEXT,
  tier TEXT NOT NULL,
  rank INTEGER NOT NULL,
  last_turn_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('subsecond') * 1000),
  PRIMARY KEY (chat_id, bot_id)
);
CREATE TABLE orbi_dream (
  bot_id TEXT PRIMARY KEY NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_hash TEXT,
  running_since INTEGER
);
CREATE TABLE orbi_dream_runs (
  id TEXT PRIMARY KEY NOT NULL,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  status TEXT NOT NULL,
  reason TEXT,
  entries_before INTEGER,
  entries_after INTEGER,
  ops INTEGER,
  cost_usd REAL,
  error TEXT
);
CREATE TABLE work_runs (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  chat_id TEXT NOT NULL,
  bot_id TEXT,
  parent_id TEXT,
  status TEXT NOT NULL,
  payload TEXT,
  steps INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  error TEXT,
  note TEXT
);
CREATE TABLE pending_interactions (
  id TEXT PRIMARY KEY NOT NULL,
  chat_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  request TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE task_counters (
  task_id TEXT PRIMARY KEY NOT NULL,
  root_chat_id TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  group_rounds INTEGER NOT NULL DEFAULT 0,
  deep_calls INTEGER NOT NULL DEFAULT 0,
  pair_wakes TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
CREATE TABLE orbi_memory_attempts (
  bot_id TEXT PRIMARY KEY NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL
);
CREATE TABLE orbi_memory_trash (
  id INTEGER PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  reason TEXT
);
CREATE TABLE chat_seen (
  chat_id TEXT PRIMARY KEY NOT NULL,
  seen_at INTEGER NOT NULL
);
CREATE TABLE app_kv (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE orbi_heartbeat (
  bot_id TEXT PRIMARY KEY NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_hash TEXT,
  last_message_day TEXT,
  running_since INTEGER
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY NOT NULL,
  orbi_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  parent_chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  parent_task_id TEXT,
  brief TEXT NOT NULL,
  title TEXT,
  mode TEXT NOT NULL DEFAULT 'work',
  reply TEXT NOT NULL DEFAULT 'resume',
  status TEXT NOT NULL DEFAULT 'queued',
  result TEXT,
  progress TEXT,
  done_when TEXT,
  answers TEXT,
  rework TEXT,
  resume_of TEXT,
  assigned_bot_id TEXT,
  started_at INTEGER,
  last_progress_at INTEGER,
  finished_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsecond') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('subsecond') * 1000)
);
CREATE TABLE todos (
  id TEXT PRIMARY KEY NOT NULL,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  task_id TEXT,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',
  position INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsecond') * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch('subsecond') * 1000)
);
CREATE TABLE undo_actions (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  previous_state TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsecond') * 1000)
);
CREATE VIRTUAL TABLE chat_messages_fts USING fts5(
  body, content='chat_messages_index', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
CREATE INDEX `approval_requests_automation_run_idx` ON `approval_requests` (`automation_run_id`);
CREATE INDEX `approval_rules_user_id_idx` ON `approval_rules` (`user_id`);
CREATE UNIQUE INDEX `approval_rules_global_unique_idx` ON `approval_rules` (`user_id`,`tool`) WHERE "approval_rules"."bot_id" is null;
CREATE UNIQUE INDEX `approval_rules_bot_unique_idx` ON `approval_rules` (`user_id`,`tool`,`bot_id`) WHERE "approval_rules"."bot_id" is not null;
CREATE INDEX `automation_runs_automation_idx` ON `automation_runs` (`automation_id`,`started_at`);
CREATE INDEX `automations_user_id_idx` ON `automations` (`user_id`);
CREATE INDEX `automations_next_run_idx` ON `automations` (`next_run_at`);
CREATE INDEX `bots_user_id_idx` ON `bots` (`user_id`);
CREATE UNIQUE INDEX `bots_one_main_per_user_idx` ON `bots` (`user_id`) WHERE "bots"."is_main";
CREATE INDEX `chat_members_bot_id_idx` ON `chat_members` (`bot_id`);
CREATE INDEX `chat_messages_index_user_chat_idx` ON `chat_messages_index` (`user_id`,`chat_id`);
CREATE INDEX `chats_user_id_idx` ON `chats` (`user_id`);
CREATE INDEX `jev_log_user_id_created_at_idx` ON `jev_log` (`user_id`,`created_at`);
CREATE UNIQUE INDEX `skills_user_id_name_idx` ON `skills` (`user_id`,`name`);
CREATE INDEX `skills_user_id_idx` ON `skills` (`user_id`);
CREATE UNIQUE INDEX `chat_messages_position_idx` ON `chat_messages` (`chat_id`,`position`);
CREATE INDEX turn_usage_chat_id_created_at_idx ON turn_usage (chat_id, created_at);
CREATE INDEX tool_outputs_chat_id_idx ON tool_outputs (chat_id);
CREATE INDEX orbi_memory_log_bot_id_idx ON orbi_memory_log (bot_id, at);
CREATE INDEX orbi_dream_runs_bot_id_idx ON orbi_dream_runs (bot_id, started_at);
CREATE INDEX work_runs_status_idx ON work_runs (status, updated_at);
CREATE INDEX work_runs_chat_idx ON work_runs (chat_id, started_at);
CREATE INDEX pending_interactions_chat_idx ON pending_interactions (chat_id);
CREATE INDEX orbi_memory_trash_bot_idx ON orbi_memory_trash (bot_id, deleted_at);
CREATE INDEX tasks_orbi_idx ON tasks (orbi_id, status);
CREATE INDEX tasks_parent_chat_idx ON tasks (parent_chat_id, status);
CREATE INDEX tasks_status_idx ON tasks (status, updated_at);
CREATE INDEX tasks_parent_task_idx ON tasks (parent_task_id);
CREATE INDEX todos_chat_idx ON todos (chat_id, status);
CREATE INDEX todos_task_idx ON todos (task_id);
CREATE INDEX undo_actions_kind_idx ON undo_actions (kind, created_at);
CREATE TRIGGER chat_messages_fts_insert AFTER INSERT ON chat_messages_index BEGIN
  INSERT INTO chat_messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
CREATE TRIGGER chat_messages_fts_delete AFTER DELETE ON chat_messages_index BEGIN
  INSERT INTO chat_messages_fts(chat_messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
END;
CREATE TRIGGER chat_messages_fts_update AFTER UPDATE OF body ON chat_messages_index BEGIN
  INSERT INTO chat_messages_fts(chat_messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
  INSERT INTO chat_messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
