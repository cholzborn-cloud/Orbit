-- Additiv für den Python-Dienst. Der alte Dienst ignoriert diese Tabellen und Spalten (Rückweg bleibt offen).

-- Postfach: EINE Warteschlange für Nachrichten, Antworten, „Weiter“ und Zeitgeber-Aufträge.
CREATE TABLE inbox_items (
  id          TEXT PRIMARY KEY NOT NULL,
  bot_id      TEXT NOT NULL,
  chat_id     TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('message','answer','resume','timer')),
  payload     TEXT NOT NULL,
  dedupe_key  TEXT,
  status      TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','processing','done','cancelled','failed')),
  run_id      TEXT,
  due_at      INTEGER NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE UNIQUE INDEX inbox_items_dedupe_idx ON inbox_items (dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX inbox_items_pick_idx ON inbox_items (bot_id, status, due_at);

-- Lauf-Ereignisse: Quelle der Live-Leiste, der Strom-Wiedergabe und der Fehlersuche.
CREATE TABLE run_events (
  run_id TEXT NOT NULL,
  seq    INTEGER NOT NULL,
  at     INTEGER NOT NULL,
  type   TEXT NOT NULL,
  data   TEXT NOT NULL,
  PRIMARY KEY (run_id, seq)
);

-- Aktivitätslog (14 Tage), ohne Fremdschlüssel.
CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY, at INTEGER NOT NULL, event TEXT NOT NULL, level TEXT NOT NULL DEFAULT 'info',
  bot_id TEXT, chat_id TEXT, run_id TEXT, summary TEXT, data TEXT
);
CREATE INDEX activity_log_at_idx ON activity_log (at);

-- Eigene MCP-Server. Kein Token in der Tabelle: nur Namen, Werte liegen im Schlüsselbund.
CREATE TABLE mcp_servers (
  name TEXT PRIMARY KEY NOT NULL,
  transport TEXT NOT NULL CHECK (transport IN ('http','stdio')),
  url TEXT, command TEXT, args TEXT, env_keys TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);

ALTER TABLE work_runs ADD COLUMN cli_session_id TEXT;
ALTER TABLE work_runs ADD COLUMN inbox_item_id TEXT;

-- Beantwortete Karten (Freigaben, Rückfragen): bleibt als Beleg und für „Einmal erlaubt“ nach einem Neustart.
CREATE TABLE interaction_results (
  id TEXT PRIMARY KEY NOT NULL,
  chat_id TEXT NOT NULL, bot_id TEXT NOT NULL, kind TEXT NOT NULL,
  request TEXT NOT NULL,            -- JSON der Karte
  result TEXT NOT NULL,             -- JSON der Entscheidung/Antwort
  created_at INTEGER NOT NULL,
  used_at INTEGER                   -- gesetzt, sobald eine einmalige Freigabe verbraucht ist
);
CREATE INDEX interaction_results_chat_idx ON interaction_results (chat_id, created_at);
