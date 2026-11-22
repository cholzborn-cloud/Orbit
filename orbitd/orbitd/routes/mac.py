"""Mac-Zugriff (Einstellungen › Sicherheit) und Rückgängig. Vorlage: service/src/mac-access-api.ts, undoRoute in mac-open-api.ts."""
from .. import memory
from ..db import dumps, loads, now_ms
from ..tools.mac import permissions, undo
from ..web import Fail, Req, need_bool, route


@route("GET", "/v1/mac/access")
async def mac_access(req: Req):
    return {"enabled": permissions.enabled(req.ctx.db), "permissions": await permissions.read_permissions()}


@route("POST", "/v1/mac/access")
async def set_mac_access(req: Req):
    try:
        on = need_bool(req.obj(), "enabled")
    except Fail:
        raise Fail("enabled fehlt.")
    permissions.set_enabled(req.ctx.db, on)
    return {"ok": True, "enabled": on}


@route("POST", "/v1/mac/permissions/request")
async def request_permission(req: Req):
    pid = req.obj().get("id")
    if not isinstance(pid, str) or not any(p[0] == pid for p in permissions.PERMISSIONS):
        raise Fail("Unbekannte Berechtigung.")
    return {"ok": True, "permission": await permissions.request_permission(pid)}


@route("POST", "/v1/undo")
async def undo_route(req: Req):
    """kind "mac" braucht ein Ziel (orbiId = undoId); ohne kind oder mit "last" nimmt nie still ein Mac-Eintrag dran."""
    db, body = req.ctx.db, req.obj()
    kind = body["kind"] if isinstance(body.get("kind"), str) else "last"
    target = body["orbiId"] if isinstance(body.get("orbiId"), str) else None
    if kind == "mac":
        if not target:
            raise Fail("Ziel fehlt.")
        return {"ok": True, "undone": "mac", "detail": await undo.undo_mac(db, target), "entityId": target}
    if kind in ("routine", "orbi", "profile", "last"):
        sql, args = "SELECT id,kind,entity_id,action,previous_state FROM undo_actions WHERE kind != 'mac'", []
        if kind != "last":
            sql, args = sql + " AND kind=?", [kind]
        if target:
            sql, args = sql + " AND entity_id=?", [*args, target]
        row = db.one(sql + " ORDER BY created_at DESC, rowid DESC LIMIT 1", *args)
        if row:
            with db.tx():
                db.run("DELETE FROM undo_actions WHERE id=?", row["id"])
                detail, undone = _reverse(db, row)
            return {"ok": True, "undone": undone, "detail": detail, "entityId": row["entity_id"]}
    if kind in ("memory", "last"):
        sql, args = "SELECT bot_id,name FROM orbi_memory_trash", []
        if target:
            sql, args = sql + " WHERE bot_id=?", [target]
        row = db.one(sql + " ORDER BY deleted_at DESC LIMIT 1", *args)
        if row:
            memory.restore(db, row["bot_id"], row["name"], now_ms())
            return {"ok": True, "undone": "memory", "detail": f"Gedächtnis-Eintrag „{row['name']}“ für Orbi {row['bot_id']} wiederhergestellt.",
                    "name": row["name"], "botId": row["bot_id"]}
    raise Fail("Keine rückgängig zu machende Aktion gefunden.")


def _reverse(db, row) -> tuple[str, str]:
    """Routinen, Orbis, Profile wie im alten Dienst; der Eintrag ist im selben Zug schon entfernt (Rückfall rollt die Transaktion zurück)."""
    eid, act, prev = row["entity_id"], row["action"], loads(row["previous_state"]) or {}
    if row["kind"] == "routine":
        if act == "create":
            db.run("UPDATE automations SET deleted_at=? WHERE id=?", now_ms(), eid)
            return f"Erstellung von Routine {eid} rückgängig gemacht (archiviert).", "routine"
        if act == "delete":
            db.run("UPDATE automations SET deleted_at=NULL WHERE id=?", eid)
            return f"Archivierte Routine {eid} wiederhergestellt.", "routine"
        if act in ("pause", "resume"):
            db.run("UPDATE automations SET enabled=? WHERE id=?", 1 if prev.get("enabled", True) else 0, eid)
            return f"Statusänderung von Routine {eid} rückgängig gemacht.", "routine"
        if act == "update" and prev:
            schedule = prev.get("schedule")
            db.run("UPDATE automations SET name=?, prompt=?, schedule=?, enabled=? WHERE id=?", prev.get("name"), prev.get("prompt"),
                   schedule if isinstance(schedule, str) else dumps(schedule), 1 if prev.get("enabled") else 0, eid)
            return f"Änderung an Routine {eid} rückgängig gemacht.", "routine"
    elif row["kind"] in ("orbi", "profile"):
        if act == "archive":
            db.run("UPDATE bots SET archived_at=NULL, version=version+1 WHERE id=?", eid)
            return f"Archivierung von Orbi {eid} rückgängig gemacht.", "orbi"
        if act == "update" and prev:
            db.run("UPDATE bots SET name=coalesce(?,name), job=coalesce(?,job), instructions=coalesce(?,instructions), color=?, version=version+1 WHERE id=?",
                   prev.get("name"), prev.get("job"), prev.get("instructions"), prev.get("color"), eid)
            return f"Änderung an Orbi {eid} rückgängig gemacht.", "orbi"
    return f"Aktion {act} für {row['kind']} rückgängig gemacht.", row["kind"]
