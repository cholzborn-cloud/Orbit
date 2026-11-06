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
