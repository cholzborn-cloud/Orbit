"""Speicherlogik der Routinen (Automationen), ohne HTTP. Texte und Grenzen wie im alten Dienst.

Die App und das bestehende Orbi-Werkzeug nutzen dieselbe Validierung. Ereignisse werden ausdrücklich in der App eingerichtet.
"""
from datetime import datetime, timezone

from .db import DB, dumps, loads, new_id, now_ms
from .schedule import COMPUTER_RETURNED, next_run, validate_schedule, validate_timezone
from .web import Fail

USER = "local"
MAX_PER_BOT = 50
LIMIT_TEXT = f"Für diesen Orbi sind höchstens {MAX_PER_BOT} Automationen möglich."
NO_NEXT = "Kein nächster Lauf gefunden."
NOT_FOUND = "Automation nicht gefunden."
NO_ORBI = "Diese Routine gehört keinem Orbi und läuft deshalb nicht."  # alte Daten: bleibt stehen, läuft aber nie
HAS_BOT = "EXISTS (SELECT 1 FROM bots b WHERE b.id=a.bot_id)"
_BAD = "Eingabe ungültig."


def iso(ms) -> str | None:
    if ms is None:
        return None
    return datetime.fromtimestamp(ms // 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{ms % 1000:03d}Z"


def _parse(obj: dict) -> dict:
    """Gemeinsame Eingabe für Anlegen und Ändern, mit Vorgaben."""
    if not isinstance(obj, dict):
        raise Fail(_BAD)
    name, prompt = obj.get("name"), obj.get("prompt")
    name = name.strip() if isinstance(name, str) else ""
    prompt = prompt.strip() if isinstance(prompt, str) else ""
    if len(name) < 2:
        raise Fail("Name muss mindestens 2 Zeichen haben.")
    if len(name) > 60:
        raise Fail("Name darf höchstens 60 Zeichen haben.")
    if not prompt:
        raise Fail("Prompt fehlt.")
    if len(prompt) > 4000:
        raise Fail("Prompt darf höchstens 4000 Zeichen haben.")
    schedule = validate_schedule(obj.get("schedule"))
    tz = obj.get("timezone")
    validate_timezone(tz)
    target, notify, context = obj.get("target") or "same", obj.get("notify") or "app", obj.get("context", True)
    model, effort = obj.get("model"), obj.get("effort")
    if (target not in ("same", "new") or notify not in ("app", "none") or not isinstance(context, bool)
            or (model is not None and (not isinstance(model, str) or len(model) > 80))
            or (effort is not None and (not isinstance(effort, str) or len(effort) > 20))):
        raise Fail(_BAD)
    return {"name": name, "prompt": prompt, "schedule": schedule, "timezone": tz, "target": target,
            "notify": notify, "model": model, "effort": effort, "context": context}


def _direct_chat(db: DB, bot_id: str) -> str | None:
    return db.val("SELECT c.id FROM chats c JOIN chat_members m ON m.chat_id=c.id WHERE m.bot_id=? AND c.user_id=? AND c.kind='direct' LIMIT 1", bot_id, USER)


def _live_count(db: DB, bot_id: str) -> int:
    return db.val("SELECT count(*) FROM automations WHERE bot_id=? AND deleted_at IS NULL", bot_id)


def _row(db: DB, automation_id, *, trashed: bool | None = False):
    """Zeile der Routine; trashed False = nur aktive, True = nur Papierkorb, None = egal."""
    if not isinstance(automation_id, str) or not automation_id:
        raise Fail(_BAD)
    row = db.one("SELECT * FROM automations WHERE id=? AND user_id=?", automation_id, USER)
    if not row or (trashed is not None and bool(row["deleted_at"]) != trashed):
        raise Fail(NOT_FOUND)
    return row


def create(db: DB, obj: dict, *, allow_event: bool = False) -> str:
    """Legt eine Routine an und liefert ihre ID. Fail mit deutschem Text bei Fehlern."""
    data = _parse(obj)
    if data["schedule"]["kind"] == "event" and not allow_event:
        raise Fail("Eine Routine für dieses Ereignis kannst du in der App einrichten.")
    bot_id, chat_id = obj.get("botId"), obj.get("chatId")
    if not isinstance(bot_id, str) or not bot_id or (chat_id is not None and not isinstance(chat_id, str)):
        raise Fail(_BAD)
    with db.tx():
        if not db.val("SELECT 1 FROM bots WHERE id=? AND user_id=?", bot_id, USER):
            raise Fail("Orbi nicht gefunden.")
        if _live_count(db, bot_id) >= MAX_PER_BOT:
            raise Fail(LIMIT_TEXT)
        if chat_id and not db.val("SELECT 1 FROM chats c JOIN chat_members m ON m.chat_id=c.id WHERE c.id=? AND c.user_id=? AND m.bot_id=?", chat_id, USER, bot_id):
            raise Fail("Ziel-Chat gehört nicht zu diesem Orbi.")
        if data["target"] == "same" and not chat_id:
            chat_id = _direct_chat(db, bot_id)
        nxt = next_run(data["schedule"], data["timezone"], now_ms())
        if nxt is None and data["schedule"]["kind"] != "event":
            raise Fail(NO_NEXT)
        new, t = new_id(), now_ms()
        db.run("INSERT INTO automations (id,user_id,bot_id,name,prompt,schedule,timezone,target,chat_id,notify,model,effort,context,enabled,next_run_at,created_at)"
               " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?,?)", new, USER, bot_id, data["name"], data["prompt"], dumps(data["schedule"]), data["timezone"],
               data["target"], chat_id, data["notify"], data["model"], data["effort"], int(data["context"]), nxt, t)
    return new


def update(db: DB, automation_id: str, obj: dict) -> None:
    data = _parse(obj)
    with db.tx():
        row = _row(db, automation_id)
        nxt = next_run(data["schedule"], data["timezone"], now_ms())
        if nxt is None and data["schedule"]["kind"] != "event":
            raise Fail(NO_NEXT)
        chat_id = row["chat_id"]
        if data["target"] == "same" and not chat_id:
            chat_id = _direct_chat(db, row["bot_id"])
        # Einmalige Routine wird mit neuem Termin wieder aktiv (außer sie ist pausiert).
        enabled = 1 if data["schedule"]["kind"] == "once" and not row["paused_reason"] else row["enabled"]
        db.run("UPDATE automations SET name=?,prompt=?,schedule=?,timezone=?,target=?,notify=?,model=?,effort=?,context=?,chat_id=?,next_run_at=?,enabled=? WHERE id=?",
               data["name"], data["prompt"], dumps(data["schedule"]), data["timezone"], data["target"], data["notify"], data["model"], data["effort"],
               int(data["context"]), chat_id, nxt, enabled, automation_id)


def set_enabled(db: DB, automation_id: str, enabled: bool) -> None:
    with db.tx():
        row = _row(db, automation_id)
        nxt = row["next_run_at"]
        if enabled:
            schedule = loads(row["schedule"])
            nxt = next_run(schedule, row["timezone"], now_ms())
            if nxt is None and schedule.get("kind") != "event":
                raise Fail(NO_NEXT)
        db.run("UPDATE automations SET enabled=?,paused_reason=NULL,next_run_at=?,resumed_at=COALESCE(?,resumed_at) WHERE id=?",
               int(enabled), nxt, now_ms() if enabled else None, automation_id)


def trash(db: DB, automation_id: str) -> None:
    with db.tx():
        _row(db, automation_id)
        db.run("UPDATE automations SET deleted_at=? WHERE id=?", now_ms(), automation_id)


def restore(db: DB, automation_id: str) -> None:
    with db.tx():
        row = _row(db, automation_id, trashed=True)
        schedule = loads(row["schedule"])
        nxt = next_run(schedule, row["timezone"], now_ms())
        if nxt is None and schedule.get("kind") != "event":
            raise Fail(NO_NEXT)
        if _live_count(db, row["bot_id"]) >= MAX_PER_BOT:
            raise Fail(LIMIT_TEXT)
        db.run("UPDATE automations SET deleted_at=NULL,next_run_at=? WHERE id=?", nxt, automation_id)


def delete(db: DB, automation_id: str) -> None:
    """Endgültig, nur aus dem Papierkorb (Läufe gehen per Kaskade mit)."""
    with db.tx():
        _row(db, automation_id, trashed=True)
        db.run("DELETE FROM automations WHERE id=?", automation_id)


def record_computer_return(db: DB, bot_id: str, hold_id: str) -> None:
    """Wird ausschließlich bei der Rückgabe einer tatsächlich übernommenen Sitzung aufgerufen."""
    db.run("INSERT OR IGNORE INTO automation_events (automation_id, source_id, created_at)"
           " SELECT id, ?, ? FROM automations WHERE user_id=? AND bot_id=? AND enabled=1 AND deleted_at IS NULL AND paused_reason IS NULL"
           " AND json_valid(schedule) AND json_extract(schedule,'$.kind')='event' AND json_extract(schedule,'$.event')=?",
           hold_id, now_ms(), USER, bot_id, COMPUTER_RETURNED)


def _out(row) -> dict:
    return {"id": row["id"], "userId": row["user_id"], "botId": row["bot_id"], "name": row["name"], "prompt": row["prompt"],
            "schedule": loads(row["schedule"]), "timezone": row["timezone"], "target": row["target"], "chatId": row["chat_id"],
            "notify": row["notify"], "model": row["model"], "effort": row["effort"], "context": bool(row["context"]),
            "enabled": bool(row["enabled"]), "pausedReason": row["paused_reason"], "lastRunAt": iso(row["last_run_at"]),
            "resumedAt": iso(row["resumed_at"]), "nextRunAt": iso(row["next_run_at"]), "deletedAt": iso(row["deleted_at"]),
            "createdAt": iso(row["created_at"])}


def _listing(db: DB, trashed: bool) -> list[dict]:
    where, order = ("IS NOT NULL", "a.deleted_at") if trashed else ("IS NULL", "a.created_at")
    rows = db.all(f"SELECT a.*, b.name AS b_name, b.avatar AS b_avatar FROM automations a LEFT JOIN bots b ON b.id=a.bot_id "
                  f"WHERE a.user_id=? AND a.deleted_at {where} ORDER BY {order} DESC", USER)
    out = []
    for r in rows:
        if r["b_name"] is None:  # Routine ohne Orbi: sichtbar mit Blocker-Text (die App braucht Name und Bild als Text)
            out.append({"automation": {**_out(r), "pausedReason": NO_ORBI}, "bot": {"id": r["bot_id"] or "", "name": "Kein Orbi", "avatar": ""}, "blocker": NO_ORBI})
        else:
            out.append({"automation": _out(r), "bot": {"id": r["bot_id"], "name": r["b_name"], "avatar": r["b_avatar"]}})
    return out


def list_all(db: DB) -> dict:
    return {"automations": _listing(db, False), "trash": _listing(db, True)}


def list_runs(db: DB, automation_id: str) -> list[dict]:
    _row(db, automation_id, trashed=None)
    rows = db.all("SELECT * FROM automation_runs WHERE user_id=? AND automation_id=? ORDER BY started_at DESC LIMIT 20", USER, automation_id)
    return [{"id": r["id"], "automationId": r["automation_id"], "userId": r["user_id"], "chatId": r["chat_id"], "status": r["status"],
             "trigger": r["trigger"], "error": r["error"], "startedAt": iso(r["started_at"]), "finishedAt": iso(r["finished_at"])} for r in rows]


def run_blocker(db: DB, automation_id: str) -> str | None:
    """Grund, warum kein Lauf startet; None = startbar."""
    row = _row(db, automation_id)
    if not db.val("SELECT 1 FROM bots WHERE id=?", row["bot_id"]):
        return NO_ORBI
    if db.val("SELECT 1 FROM automation_runs WHERE automation_id=? AND user_id=? AND status IN ('running','waiting') LIMIT 1", automation_id, USER):
        return "Ein Lauf läuft noch oder wartet auf Freigabe."
    return None


def unread_count(db: DB, since_ms: int = 0) -> int:
    """Fertige Läufe mit App-Hinweis seit `since_ms` (höchstens 24 h zurück)."""
    return db.val("SELECT count(*) FROM automation_runs r WHERE r.user_id=? AND r.status IN ('ok','error') AND r.finished_at > ?"
                  " AND EXISTS (SELECT 1 FROM automations a WHERE a.id=r.automation_id AND a.notify='app')",
                  USER, max(since_ms, now_ms() - 86_400_000))
