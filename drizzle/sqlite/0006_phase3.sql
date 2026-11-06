CREATE TABLE message_reactions (
  chat_id TEXT NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsecond') * 1000),
  PRIMARY KEY (chat_id, message_id, actor)
);
--> statement-breakpoint
ALTER TABLE user_settings ADD COLUMN reply_length TEXT NOT NULL DEFAULT 'short';
--> statement-breakpoint
ALTER TABLE bots ADD COLUMN onboarding_done INTEGER NOT NULL DEFAULT 1;
