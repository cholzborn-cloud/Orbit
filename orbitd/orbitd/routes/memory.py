"""Orbi-Gedächtnis, Träumer- und Heartbeat-Schalter (nur Anzeige und Ein/Aus; die Läufe selbst sind andere Teile)."""
import os
from datetime import datetime

from .. import memory as mem
from ..db import now_ms
from ..web import Fail, Req, need_bool, route

# Fehlertexte der Werkzeug-Seite (englisch) → deutsche Sätze der App, wie im alten Dienst.
GERMAN = {
    "Entry changed": "Der Eintrag wurde inzwischen geändert. Lade die Ansicht neu.",
    "Description needs": "Die Beschreibung braucht 1 bis 150 Zeichen in einer Zeile.",
    "Body needs": "Der Text braucht 1 bis 1200 Zeichen.",
    "Memory is too large": "Das Gedächtnis wäre zu groß.",
    "Entry not found": "Eintrag nicht gefunden.",
    "Eintrag nicht gefunden": "Eintrag nicht gefunden.",
}
HEARTBEAT = {"everyMinutes": 30, "window": {"from": "08:00", "to": "22:00"}}
DREAM_DAILY_USD = 0.2


def german(error: str) -> str:
    for key, text in GERMAN.items():
        if error.startswith(key):
            return text
    if "credentials" in error or "secret" in error.lower() or "Zugangsdaten" in error:
        return "Der Text sieht nach Zugangsdaten aus und wird nicht gespeichert."
    return "Der Eintrag konnte nicht gespeichert werden."


def bot_id(req: Req) -> str:
    bid = req.params["id"]
    if not req.ctx.db.val("SELECT 1 FROM bots WHERE id=? AND user_id='local'", bid):
        raise Fail("Orbi nicht gefunden.")
    return bid


def view(e: dict) -> dict:
    return {k: e[k] for k in ("name", "type", "description", "body", "stated", "origin", "source", "version", "createdAt", "updatedAt")}


@route("GET", "/v1/bots/{id}/memory")
async def memory_list(req: Req):
    db, bid = req.ctx.db, bot_id(req)
    entries = mem.list_entries(db, bid)
    return {"ok": True, "entries": [view(e) for e in entries], "index": mem.index_text(entries),
            "limits": {"entries": mem.LIMITS["entries"], "body": mem.LIMITS["body"], "total": mem.LIMITS["total"], "index": mem.MAX_INDEX},
            "migrated": bool(db.val("SELECT 1 FROM orbi_memory_meta WHERE bot_id=?", bid))}


@route("GET", "/v1/bots/{id}/memory-trash")
async def memory_trash(req: Req):
    return {"ok": True, "entries": [{**view(e), "deletedAt": e["deletedAt"]} for e in mem.trash(req.ctx.db, bot_id(req))]}


@route("GET", "/v1/bots/{id}/memory/{name}")
async def memory_get(req: Req):
    entry = mem.get(req.ctx.db, bot_id(req), req.params["name"])
    if not entry:
        raise Fail("Eintrag nicht gefunden.")
    return {"ok": True, "entry": view(entry)}


@route("PUT", "/v1/bots/{id}/memory/{name}")
async def memory_edit(req: Req):
    bid, name, body = bot_id(req), req.params["name"], req.obj()
    v = body.get("ifVersion")
    if not (isinstance(body.get("description"), str) and isinstance(body.get("body"), str) and isinstance(v, int) and not isinstance(v, bool)):
        raise Fail("Ungültige Eingabe.")
    try:
        mem.edit(req.ctx.db, bid, name, body["description"], body["body"], v)
    except Fail as e:
        raise Fail(german(e.error)) from None
    return {"ok": True, "entry": view(mem.get(req.ctx.db, bid, name))}


@route("DELETE", "/v1/bots/{id}/memory/{name}")
async def memory_delete(req: Req):
    try:
        mem.forget(req.ctx.db, bot_id(req), req.params["name"], "gelöscht in der App")
    except Fail:
        raise Fail("Eintrag nicht gefunden.") from None


@route("POST", "/v1/bots/{id}/memory/{name}/restore")
async def memory_restore(req: Req):
    return {"ok": True, "version": mem.restore(req.ctx.db, bot_id(req), req.params["name"])}


def _start_of_day_ms(now: int) -> int:
    return int(datetime.fromtimestamp(now / 1000).replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)


def _dream_cap() -> float:
    try:
        return max(float(os.environ["ORBIT_DREAM_DAILY_USD"]), 0.0)
    except (KeyError, ValueError):
        return DREAM_DAILY_USD


@route("GET", "/v1/bots/{id}/dreamer")
async def dreamer_get(req: Req):
    db, bid = req.ctx.db, bot_id(req)
    enabled = bool(db.val("SELECT dreamer_enabled FROM bots WHERE id=?", bid))
    state = db.one("SELECT next_run_at,last_run_at,running_since FROM orbi_dream WHERE bot_id=?", bid)
    runs = db.all("SELECT id,started_at,finished_at,status,reason,entries_before,entries_after,ops,cost_usd,error"
                  " FROM orbi_dream_runs WHERE bot_id=? ORDER BY started_at DESC LIMIT 10", bid)
    changes = db.all("SELECT id,name,action,version,detail,at FROM orbi_memory_log WHERE bot_id=? AND action LIKE 'dream-%'"
                     " ORDER BY at DESC, id DESC LIMIT 50", bid)
    return {
        "ok": True, "enabled": enabled,
        "nextRunAt": state["next_run_at"] if enabled and state else None,
        "lastRunAt": state["last_run_at"] if state else None,
        "running": bool(state and state["running_since"] is not None),
        "cost": {"todayUsd": db.val("SELECT COALESCE(SUM(cost_usd),0) FROM orbi_dream_runs WHERE started_at>=?", _start_of_day_ms(now_ms())),
                 "capUsd": _dream_cap()},
        "runs": [{"id": r["id"], "startedAt": r["started_at"], "finishedAt": r["finished_at"], "status": r["status"], "reason": r["reason"],
                  "entriesBefore": r["entries_before"], "entriesAfter": r["entries_after"], "ops": r["ops"], "costUsd": r["cost_usd"],
                  "error": r["error"]} for r in runs],
        "changes": [dict(c) for c in changes],
    }


@route("PUT", "/v1/bots/{id}/dreamer")
async def dreamer_set(req: Req):
    bid = bot_id(req)
    enabled = req.obj().get("enabled")
    if not isinstance(enabled, bool):
        raise Fail("enabled (true/false) fehlt.")
    req.ctx.db.run("UPDATE bots SET dreamer_enabled=? WHERE id=?", int(enabled), bid)
    return {"ok": True, "enabled": enabled}


@route("GET", "/v1/bots/{id}/heartbeat")
async def heartbeat_get(req: Req):
    return _heartbeat(req.ctx.db, bot_id(req))


def _heartbeat(db, bid: str) -> dict:
    state = db.one("SELECT last_run_at,last_message_day FROM orbi_heartbeat WHERE bot_id=?", bid)
    return {"ok": True, "enabled": bool(db.val("SELECT heartbeat_enabled FROM bots WHERE id=?", bid)), **HEARTBEAT,
            "lastRunAt": state["last_run_at"] if state else None, "lastMessageDay": state["last_message_day"] if state else None}


@route("PUT", "/v1/bots/{id}/heartbeat")
async def heartbeat_set(req: Req):
    enabled = need_bool(req.obj(), "enabled")
    db, bid = req.ctx.db, bot_id(req)
    with db.tx():
        db.run("UPDATE bots SET heartbeat_enabled=? WHERE id=?", int(enabled), bid)
        # Ausschalten räumt eine hängende Sperre weg.
        if not enabled:
            db.run("UPDATE orbi_heartbeat SET running_since=NULL WHERE bot_id=?", bid)
    return _heartbeat(db, bid)
