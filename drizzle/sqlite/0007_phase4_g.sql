ALTER TABLE turn_usage ADD COLUMN steps INTEGER;
--> statement-breakpoint
ALTER TABLE turn_usage ADD COLUMN cost_usd REAL;
--> statement-breakpoint
ALTER TABLE turn_usage ADD COLUMN cache_write_tokens INTEGER;
--> statement-breakpoint
ALTER TABLE turn_usage ADD COLUMN cache_ratio REAL;
--> statement-breakpoint
ALTER TABLE turn_usage ADD COLUMN tools_chars INTEGER;
--> statement-breakpoint
ALTER TABLE turn_usage ADD COLUMN volatile_chars INTEGER;
--> statement-breakpoint
ALTER TABLE turn_usage ADD COLUMN history_chars INTEGER;
--> statement-breakpoint
ALTER TABLE turn_usage ADD COLUMN tool_result_chars INTEGER;
--> statement-breakpoint
ALTER TABLE turn_usage ADD COLUMN turn_kind TEXT;
--> statement-breakpoint
ALTER TABLE turn_usage ADD COLUMN duration_ms INTEGER;
--> statement-breakpoint
ALTER TABLE turn_usage ADD COLUMN summary_used INTEGER;
--> statement-breakpoint
ALTER TABLE jev_log ADD COLUMN cost_usd REAL;
--> statement-breakpoint
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
--> statement-breakpoint
CREATE TABLE tool_outputs (
  id TEXT PRIMARY KEY NOT NULL,
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  tool TEXT NOT NULL,
  chars INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsecond') * 1000)
);
--> statement-breakpoint
CREATE INDEX tool_outputs_chat_id_idx ON tool_outputs (chat_id);
