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
--> statement-breakpoint
CREATE TABLE orbi_memory_log (
  id INTEGER PRIMARY KEY,
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  action TEXT NOT NULL,
  version INTEGER,
  detail TEXT,
  at INTEGER NOT NULL DEFAULT (unixepoch('subsecond') * 1000)
);
--> statement-breakpoint
CREATE INDEX orbi_memory_log_bot_id_idx ON orbi_memory_log (bot_id, at);
--> statement-breakpoint
CREATE TABLE orbi_memory_meta (
  bot_id TEXT PRIMARY KEY NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  migrated_at INTEGER NOT NULL DEFAULT (unixepoch('subsecond') * 1000),
  source_hash TEXT NOT NULL,
  source_chars INTEGER NOT NULL,
  imported INTEGER NOT NULL
);
