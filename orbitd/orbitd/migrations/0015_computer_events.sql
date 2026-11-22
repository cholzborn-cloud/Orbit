CREATE TABLE desktop_holds (
  bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
  id TEXT NOT NULL UNIQUE,
  request_id TEXT,
  taken_at INTEGER NOT NULL
);

CREATE TABLE automation_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  automation_id TEXT NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  source_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (automation_id, source_id)
);
