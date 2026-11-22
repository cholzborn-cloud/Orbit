ALTER TABLE bots ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE bots ADD COLUMN archived_at INTEGER;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS undo_actions (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  detail TEXT NOT NULL,
  previous_state TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch('subsecond') * 1000)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS undo_actions_kind_idx ON undo_actions (kind, created_at);
