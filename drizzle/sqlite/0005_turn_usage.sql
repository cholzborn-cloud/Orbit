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
);
--> statement-breakpoint
CREATE INDEX turn_usage_chat_id_created_at_idx ON turn_usage (chat_id, created_at);
