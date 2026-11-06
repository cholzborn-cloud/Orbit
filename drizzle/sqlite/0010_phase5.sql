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
--> statement-breakpoint
CREATE INDEX work_runs_status_idx ON work_runs (status, updated_at);
--> statement-breakpoint
CREATE INDEX work_runs_chat_idx ON work_runs (chat_id, started_at);
--> statement-breakpoint
CREATE TABLE pending_interactions (
  id TEXT PRIMARY KEY NOT NULL,
  chat_id TEXT NOT NULL,
  bot_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  request TEXT NOT NULL,
  requested_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX pending_interactions_chat_idx ON pending_interactions (chat_id);
--> statement-breakpoint
CREATE TABLE task_counters (
  task_id TEXT PRIMARY KEY NOT NULL,
  root_chat_id TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  group_rounds INTEGER NOT NULL DEFAULT 0,
  deep_calls INTEGER NOT NULL DEFAULT 0,
  pair_wakes TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE orbi_memory_attempts (
  bot_id TEXT PRIMARY KEY NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE orbi_memory_trash (
  id INTEGER PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  deleted_at INTEGER NOT NULL,
  reason TEXT
);
--> statement-breakpoint
CREATE INDEX orbi_memory_trash_bot_idx ON orbi_memory_trash (bot_id, deleted_at);
--> statement-breakpoint
CREATE TABLE chat_seen (
  chat_id TEXT PRIMARY KEY NOT NULL,
  seen_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE app_kv (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
ALTER TABLE bots ADD COLUMN heartbeat_enabled INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE orbi_heartbeat (
  bot_id TEXT PRIMARY KEY NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_hash TEXT,
  last_message_day TEXT,
  running_since INTEGER
);
--> statement-breakpoint
INSERT INTO chat_seen (chat_id, seen_at) SELECT id, last_message_at FROM chats;
