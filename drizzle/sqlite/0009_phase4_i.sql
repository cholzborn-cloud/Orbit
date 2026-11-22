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
--> statement-breakpoint
ALTER TABLE turn_usage ADD COLUMN tier TEXT;
--> statement-breakpoint
ALTER TABLE turn_usage ADD COLUMN tier_change TEXT;
--> statement-breakpoint
ALTER TABLE bots ADD COLUMN dreamer_enabled INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
CREATE TABLE orbi_dream (
  bot_id TEXT PRIMARY KEY NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  next_run_at INTEGER NOT NULL,
  last_run_at INTEGER,
  last_hash TEXT,
  running_since INTEGER
);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE INDEX orbi_dream_runs_bot_id_idx ON orbi_dream_runs (bot_id, started_at);
