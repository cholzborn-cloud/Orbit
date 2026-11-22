"""Verlauf: Nachrichten in chat_messages (gleiche JSON-Form wie der alte Dienst: AI-SDK-UIMessage) plus Suchindex."""
from .db import DB, dumps, loads, now_ms


def text_of(parts: list) -> str:
    return "\n".join(p.get("text", "") for p in parts if p.get("type") == "text").strip()


def _index(db: DB, chat_id: str, message_id: str, role: str, parts: list, created_at: int) -> None:
    body = text_of(parts)
    key = f"{chat_id}:{message_id}"
    db.run("DELETE FROM chat_messages_index WHERE id=?", key)
    if body:
        db.run("INSERT INTO chat_messages_index (id,user_id,chat_id,role,body,created_at) VALUES (?,?,?,?,?,?)", key, "local", chat_id, role, body, created_at)


def exists(db: DB, chat_id: str, message_id: str) -> bool:
    return db.val("SELECT 1 FROM chat_messages WHERE chat_id=? AND id=?", chat_id, message_id) is not None


def add(db: DB, chat_id: str, message_id: str, role: str, parts: list, metadata: dict | None = None) -> int:
    """Hängt eine Nachricht an. Liefert die Position."""
    t = now_ms()
    metadata = {"createdAt": t, **(metadata or {})}
    with db.tx():
        position = (db.val("SELECT max(position) FROM chat_messages WHERE chat_id=?", chat_id) or 0) + 1
        db.run("INSERT INTO chat_messages (chat_id,id,role,parts,metadata,position,created_at) VALUES (?,?,?,?,?,?,?)",
               chat_id, message_id, role, dumps(parts), dumps(metadata), position, t)
        preview = text_of(parts)[:120] or None
        db.run("UPDATE chats SET last_message_at=?, last_message_preview=coalesce(?, last_message_preview) WHERE id=?", t, preview, chat_id)
        _index(db, chat_id, message_id, role, parts, t)
    return position


def update(db: DB, chat_id: str, message_id: str, parts: list, metadata: dict | None = None) -> None:
    """Ersetzt Teile (und Metadata) einer vorhandenen Nachricht; Position und Zeit bleiben."""
    with db.tx():
        row = db.one("SELECT role, created_at, metadata FROM chat_messages WHERE chat_id=? AND id=?", chat_id, message_id)
        if not row:
            return
        merged = {**(loads(row["metadata"], {}) or {}), **(metadata or {})}
        db.run("UPDATE chat_messages SET parts=?, metadata=? WHERE chat_id=? AND id=?", dumps(parts), dumps(merged), chat_id, message_id)
        _index(db, chat_id, message_id, row["role"], parts, row["created_at"])


def remove(db: DB, chat_id: str, message_id: str) -> None:
    with db.tx():
        db.run("DELETE FROM chat_messages WHERE chat_id=? AND id=?", chat_id, message_id)
        db.run("DELETE FROM chat_messages_index WHERE id=?", f"{chat_id}:{message_id}")


def get(db: DB, chat_id: str, message_id: str) -> dict | None:
    row = db.one("SELECT * FROM chat_messages WHERE chat_id=? AND id=?", chat_id, message_id)
    return _message(row) if row else None


def _message(row) -> dict:
    message = {"id": row["id"], "role": row["role"], "parts": loads(row["parts"], [])}
    metadata = loads(row["metadata"])
    if metadata:
        message["metadata"] = metadata
    return message


def messages(db: DB, chat_id: str, after_position: int = -1) -> list[dict]:  # alte Chats beginnen bei Position 0
    rows = db.all("SELECT * FROM chat_messages WHERE chat_id=? AND position>? ORDER BY position", chat_id, after_position)
    return [_message(r) for r in rows]


def clear(db: DB, chat_id: str) -> None:
    with db.tx():
        db.run("DELETE FROM chat_messages WHERE chat_id=?", chat_id)
        db.run("DELETE FROM chat_messages_index WHERE chat_id=?", chat_id)
        db.run("DELETE FROM message_reactions WHERE chat_id=?", chat_id)
        db.run("DELETE FROM chat_summaries WHERE chat_id=?", chat_id)
        db.run("DELETE FROM app_kv WHERE substr(key, 1, ?) = ?", len(f"untrusted:{chat_id}:"), f"untrusted:{chat_id}:")  # Fremddaten-Markierung (runner.Counters)
