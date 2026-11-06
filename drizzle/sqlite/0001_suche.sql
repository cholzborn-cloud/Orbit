CREATE VIRTUAL TABLE chat_messages_fts USING fts5(
  body, content='chat_messages_index', content_rowid='rowid',
  tokenize='unicode61 remove_diacritics 2'
);
--> statement-breakpoint
CREATE TRIGGER chat_messages_fts_insert AFTER INSERT ON chat_messages_index BEGIN
  INSERT INTO chat_messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
--> statement-breakpoint
CREATE TRIGGER chat_messages_fts_delete AFTER DELETE ON chat_messages_index BEGIN
  INSERT INTO chat_messages_fts(chat_messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
END;
--> statement-breakpoint
CREATE TRIGGER chat_messages_fts_update AFTER UPDATE OF body ON chat_messages_index BEGIN
  INSERT INTO chat_messages_fts(chat_messages_fts, rowid, body) VALUES ('delete', old.rowid, old.body);
  INSERT INTO chat_messages_fts(rowid, body) VALUES (new.rowid, new.body);
END;
--> statement-breakpoint
INSERT INTO chat_messages_fts(chat_messages_fts) VALUES ('rebuild');
