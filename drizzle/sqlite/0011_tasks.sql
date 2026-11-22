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
--> statement-breakpoint
CREATE INDEX tasks_orbi_idx ON tasks (orbi_id, status);
--> statement-breakpoint
CREATE INDEX tasks_parent_chat_idx ON tasks (parent_chat_id, status);
--> statement-breakpoint
CREATE INDEX tasks_status_idx ON tasks (status, updated_at);
--> statement-breakpoint
CREATE INDEX tasks_parent_task_idx ON tasks (parent_task_id);
--> statement-breakpoint
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
--> statement-breakpoint
CREATE INDEX todos_chat_idx ON todos (chat_id, status);
--> statement-breakpoint
CREATE INDEX todos_task_idx ON todos (task_id);
