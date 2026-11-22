"""Erinnerungs-Brücke für die Mac-App und die Rückgängig-Liste. Vorlage: service/src/reminder-routes.ts, undoHistoryRoute in mac-open-api.ts."""
from ..tools.reminders import bridge
from ..web import HttpError, Req, route


@route("POST", "/v1/reminders/claim")
async def claim(req: Req):
    return {"task": bridge(req.ctx).claim()}


@route("GET", "/v1/reminders/{id}/active")
async def active(req: Req):
    return {"active": bridge(req.ctx).is_active(req.params["id"])}


@route("POST", "/v1/reminders/{id}/complete")
async def complete(req: Req):
    # 100 Einträge à 700 Zeichen können als JSON bis zu sechs Bytes je Zeichen brauchen.
    if len(await req.raw.body()) > 512 * 1024:
        raise HttpError(413, "Antwort zu groß.")
    if not bridge(req.ctx).complete(req.params["id"], req.body):
        raise HttpError(409, "Auftrag nicht verfügbar.")
    return {"ok": True}


@route("GET", "/v1/undo/history")
async def undo_history(req: Req):
    db = req.ctx.db
    actions = [{"id": r["id"], "kind": r["kind"], "entityId": r["entity_id"], "action": r["action"], "detail": r["detail"],
                "previousState": r["previous_state"], "createdAt": r["created_at"]}
               for r in db.all("SELECT * FROM undo_actions ORDER BY created_at DESC, rowid DESC LIMIT 20")]
    trash = [{"id": r["id"], "botId": r["bot_id"], "name": r["name"], "deletedAt": r["deleted_at"], "reason": r["reason"]}
             for r in db.all("SELECT * FROM orbi_memory_trash ORDER BY deleted_at DESC LIMIT 20")]
    log = [{"id": r["id"], "botId": r["bot_id"], "name": r["name"], "action": r["action"], "version": r["version"], "at": r["at"]}
           for r in db.all("SELECT * FROM orbi_memory_log ORDER BY at DESC LIMIT 20")]
    return {"ok": True, "history": {"actions": actions, "trash": trash, "log": log}}
