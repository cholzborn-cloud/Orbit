-- Wave 1 shared work contract. Additive only: existing rows, readers and writers keep working unchanged.

-- Work identity distinct from the visible Orbi. Old rows keep NULL and are read as foreground turns.
ALTER TABLE work_runs ADD COLUMN root_run_id TEXT;
ALTER TABLE work_runs ADD COLUMN owner_bot_id TEXT;
ALTER TABLE work_runs ADD COLUMN origin_chat_id TEXT;
ALTER TABLE work_runs ADD COLUMN origin_message_id TEXT;
ALTER TABLE work_runs ADD COLUMN thread_root_id TEXT;
ALTER TABLE work_runs ADD COLUMN role TEXT;
ALTER TABLE work_runs ADD COLUMN lane TEXT;
ALTER TABLE work_runs ADD COLUMN principal_id TEXT;
CREATE INDEX work_runs_root_idx ON work_runs (root_run_id) WHERE root_run_id IS NOT NULL;
CREATE INDEX work_runs_parent_idx ON work_runs (parent_id) WHERE parent_id IS NOT NULL;

-- Principals: who acts and who may approve. The single local profile becomes the owner.
CREATE TABLE principals (
  id           TEXT PRIMARY KEY NOT NULL,
  kind         TEXT NOT NULL CHECK (kind IN ('owner','member','guest','orbi','external')),
  provider     TEXT NOT NULL DEFAULT 'local',
  external_id  TEXT NOT NULL,
  display_name TEXT,
  created_at   INTEGER NOT NULL,
  UNIQUE (provider, external_id)
);
INSERT INTO principals (id, kind, provider, external_id, display_name, created_at)
  VALUES ('local', 'owner', 'local', 'local', NULL, CAST(strftime('%s','now') AS INTEGER) * 1000);

-- An accepted user request and its outstanding deliverables, persisted before any dispatch.
CREATE TABLE work_requests (
  id            TEXT PRIMARY KEY NOT NULL,
  chat_id       TEXT NOT NULL,
  message_id    TEXT NOT NULL,
  owner_bot_id  TEXT NOT NULL,
  principal_id  TEXT NOT NULL DEFAULT 'local',
  root_run_id   TEXT UNIQUE,
  status        TEXT NOT NULL DEFAULT 'accepted' CHECK (status IN ('accepted','working','delivered','cancelled','failed')),
  deliverables  TEXT NOT NULL DEFAULT '[]',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (chat_id, message_id, owner_bot_id)
);

-- Every model-to-user publication. Committed before any event is emitted; replayed idempotently by client_key.
CREATE TABLE deliveries (
  id             TEXT PRIMARY KEY NOT NULL,
  client_key     TEXT NOT NULL UNIQUE,
  run_id         TEXT,
  root_run_id    TEXT,
  request_id     TEXT,
  chat_id        TEXT NOT NULL,
  thread_root_id TEXT,
  audience       TEXT NOT NULL DEFAULT 'chat' CHECK (audience IN ('chat','thread','dm','group','channel','meeting','parent')),
  channel        TEXT,
  recipient      TEXT,
  kind           TEXT NOT NULL CHECK (kind IN ('text','attachment','widget','memo','reaction','secret-request','cloud-job','report')),
  visibility     TEXT NOT NULL CHECK (visibility IN ('public','private')),
  message_id     TEXT,
  parts          TEXT NOT NULL,
  artifacts      TEXT NOT NULL DEFAULT '[]',
  end_turn       INTEGER NOT NULL DEFAULT 0,
  status         TEXT NOT NULL DEFAULT 'committed' CHECK (status IN ('committed','emitted','refused')),
  created_at     INTEGER NOT NULL,
  emitted_at     INTEGER
);
CREATE INDEX deliveries_pending_idx ON deliveries (status, created_at) WHERE status = 'committed';
CREATE INDEX deliveries_chat_idx ON deliveries (chat_id, created_at);

-- Drafts, approvals and side effects bound to actor, target, account and payload digest.
CREATE TABLE effects (
  id             TEXT PRIMARY KEY NOT NULL,
  call_id        TEXT,
  run_id         TEXT,
  root_run_id    TEXT,
  request_id     TEXT,
  chat_id        TEXT NOT NULL,
  actor_bot_id   TEXT NOT NULL,
  principal_id   TEXT NOT NULL DEFAULT 'local',
  action_class   TEXT NOT NULL,
  target         TEXT NOT NULL,
  account        TEXT,
  recipients     TEXT NOT NULL DEFAULT '[]',
  payload        TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  version        INTEGER NOT NULL DEFAULT 1,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('draft','pending','approved','claimed','dispatched','unknown','done','failed','denied','expired','cancelled','interrupted','superseded')),
  decided_by     TEXT,
  decided_at     INTEGER,
  expires_at     INTEGER NOT NULL,
  operation_id   TEXT,
  receipt        TEXT,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);
CREATE INDEX effects_chat_idx ON effects (chat_id, status);
CREATE INDEX effects_root_idx ON effects (root_run_id) WHERE root_run_id IS NOT NULL;

-- Durable artifacts, decoupled from their delivery. Bytes live in the private profile, never in the chat row.
CREATE TABLE artifacts (
  id           TEXT PRIMARY KEY NOT NULL,
  principal_id TEXT NOT NULL DEFAULT 'local',
  bot_id       TEXT,
  chat_id      TEXT,
  run_id       TEXT,
  filename     TEXT NOT NULL,
  media_type   TEXT NOT NULL,
  size         INTEGER NOT NULL,
  sha256       TEXT NOT NULL,
  path         TEXT NOT NULL,
  origin       TEXT NOT NULL DEFAULT 'generated',
  created_at   INTEGER NOT NULL
);
CREATE INDEX artifacts_sha_idx ON artifacts (sha256);

-- Word TodoWrite: stable model-chosen IDs per origin and a delivery stamp before completion counts.
ALTER TABLE todos ADD COLUMN item_key TEXT;
ALTER TABLE todos ADD COLUMN delivered_at INTEGER;
CREATE UNIQUE INDEX todos_item_key_idx ON todos (chat_id, bot_id, item_key) WHERE item_key IS NOT NULL;
