"""Das Postfach: EINE Warteschlange in der Datenbank für alles, was ein Orbi abarbeiten soll.

Muster: regnull/openbot runtime/actors.py (_pick) und runtime/scheduler.py (atomarer Claim per UPDATE … WHERE status, rowcount == 1).
Regeln:
- Ein Chat hat höchstens einen laufenden Eintrag; innerhalb eines Chats gilt die Reihenfolge des Eingangs (Gruppenrunde = nacheinander).
- Mehrere wartende Einträge desselben Orbis im selben Chat werden bei gleichem Modell und gleicher Denktiefe zusammen zugestellt.
- `dedupe_key` verhindert Doppeltes (Zeitgeber, Gruppenrunde): gleicher Schlüssel = ein Eintrag.
"""
from ..db import DB, dumps, loads, new_id, now_ms


def enqueue(db: DB, bot_id: str, chat_id: str, kind: str, payload: dict, dedupe_key: str | None = None, due_at: int | None = None) -> str | None:
    """Legt einen Eintrag an. None, wenn es den dedupe_key schon gibt."""
    item_id, t = new_id(), now_ms()
    changed = db.run(
        "INSERT OR IGNORE INTO inbox_items (id,bot_id,chat_id,kind,payload,dedupe_key,status,due_at,created_at,updated_at) VALUES (?,?,?,?,?,?,'queued',?,?,?)",
        item_id, bot_id, chat_id, kind, dumps(payload), dedupe_key, due_at or t, t, t)
    return item_id if changed == 1 else None


def pick(db: DB, bot_id: str) -> list[dict]:
    """Die nächsten Einträge für diesen Orbi: der älteste fällige, dessen Chat frei und in der Reihe ist, plus alles Wartende im selben Chat."""
    t = now_ms()
    first = db.one(
        """SELECT i.rowid AS rid, i.* FROM inbox_items i WHERE i.bot_id=? AND i.status='queued' AND i.due_at<=?
           AND NOT EXISTS (SELECT 1 FROM inbox_items p WHERE p.chat_id=i.chat_id AND p.status='processing')
           AND NOT EXISTS (SELECT 1 FROM inbox_items o WHERE o.chat_id=i.chat_id AND o.status='queued' AND o.due_at<=? AND o.bot_id<>i.bot_id AND o.rowid<i.rowid)
           ORDER BY (i.kind='resume') DESC, i.rowid LIMIT 1""", bot_id, t, t)
    if not first:
        return []
    unpack = lambda row: {**dict(row), "payload": loads(row["payload"], {})}
    if first["kind"] in ("resume", "timer"):
        return [unpack(first)]  # „Weiter“ und Zeitgeber-Aufträge laufen einzeln
    items = []
    choice = None
    for row in db.all("SELECT * FROM inbox_items WHERE chat_id=? AND status='queued' AND due_at<=? AND rowid>=? ORDER BY rowid", first["chat_id"], t, first["rid"]):
        # Nur bis zum ersten fremden Eintrag bündeln, damit die Reihenfolge im Chat stimmt.
        if row["bot_id"] != bot_id or row["kind"] not in ("message", "answer"):
            break
        item = unpack(row)
        data = item["payload"].get("clientData")
        wanted = (data.get("model"), data.get("effort"), data.get("fast")) if isinstance(data, dict) else (None, None, None)
        if items and choice != wanted:
            break
        choice = wanted
        items.append(item)
    return items


def claim(db: DB, items: list[dict], run_id: str) -> list[dict]:
    """Atomar übernehmen; nur Einträge mit rowcount == 1 gehören diesem Lauf."""
    t = now_ms()
    return [item for item in items if db.run(
        "UPDATE inbox_items SET status='processing', attempts=attempts+1, run_id=?, updated_at=? WHERE id=? AND status='queued'", run_id, t, item["id"]) == 1]


def finish(db: DB, run_id: str, status: str = "done") -> None:
    db.run("UPDATE inbox_items SET status=?, updated_at=? WHERE run_id=? AND status='processing'", status, now_ms(), run_id)


def cancel_queued(db: DB, chat_id: str) -> list[dict]:
    """Stopp: Wartendes in diesem Chat verwerfen. Liefert die verworfenen Einträge."""
    rows = db.all("SELECT * FROM inbox_items WHERE chat_id=? AND status='queued'", chat_id)
    db.run("UPDATE inbox_items SET status='cancelled', updated_at=? WHERE chat_id=? AND status='queued'", now_ms(), chat_id)
    return [{**dict(r), "payload": loads(r["payload"], {})} for r in rows]


def waiting_bots(db: DB) -> list[str]:
    return [r[0] for r in db.all("SELECT DISTINCT bot_id FROM inbox_items WHERE status='queued' AND due_at<=?", now_ms())]


def busy(db: DB, chat_id: str) -> bool:
    return db.val("SELECT 1 FROM inbox_items WHERE chat_id=? AND status IN ('queued','processing') LIMIT 1", chat_id) is not None
