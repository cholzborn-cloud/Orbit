"""Orbi-Verwaltung für den Hauptorbi (list_orbis, update_orbi, archive_orbi) und update_routine. Vorlage: lib/chat/orbi-fleet-tools.ts, automation-tool.ts.

Nichts wird gelöscht: Archivieren setzt bots.archived_at. Jede Änderung legt vorher einen Eintrag in undo_actions ab (POST /v1/undo macht sie rückgängig).
"""
from .. import automations, schedule
from ..config import USER
from ..db import dumps, loads, new_id, now_ms
from ..routes.bots import COLOR
from ..runtime.contract import Risk, tool
from ..web import Fail

_main = lambda run: run.bot["is_main"] and run.chat_kind == "direct"
_id = {"type": "string"}


def record_undo(db, kind: str, entity_id: str, action: str, detail: str, previous) -> None:
    db.run("INSERT INTO undo_actions (id,kind,entity_id,action,detail,previous_state,created_at) VALUES (?,?,?,?,?,?,?)",
           new_id(), kind, entity_id, action, detail, dumps(previous), now_ms())


def _bot(db, bot_id) -> dict:
    row = db.one("SELECT * FROM bots WHERE id=? AND user_id=? AND archived_at IS NULL", bot_id, USER)
    if not row:
        raise Fail(f"Orbi {bot_id} nicht gefunden oder archiviert.")
    return dict(row)


def _state(b: dict) -> dict:
    return {"name": b["name"], "job": b["job"], "instructions": b["instructions"], "color": b["color"], "version": b["version"]}


def _check_version(b: dict, expected, strict_text: str) -> None:
    if expected is not None and b["version"] != expected:
        raise Fail(f"Versionskonflikt für Orbi {b['name']}: erwartet {expected}, aktuell ist {b['version']}.{strict_text}")


# ------------------------------------------------------------ Flotte
@tool("list_orbis", "List all active Orbis in the fleet with their id, name, job, version, and availability status (frei vs arbeitet).",
      {"type": "object", "properties": {}}, label=lambda a: "Liest die Orbis", groups=False, available=_main)
async def list_orbis(run, args):
    rows = run.ctx.db.all(
        "SELECT b.id,b.name,b.job,b.is_main,b.version,"
        "(SELECT count(*) FROM tasks t WHERE t.orbi_id=b.id AND t.status IN ('queued','running','waiting'))"
        "+(SELECT count(*) FROM work_runs w WHERE w.bot_id=b.id AND w.status IN ('queued','running','waiting')) AS busy"
        " FROM bots b WHERE b.user_id=? AND b.archived_at IS NULL ORDER BY b.is_main DESC, b.name", USER)
    return {"ok": True, "orbis": [{"id": r["id"], "name": r["name"], "job": r["job"], "isMain": bool(r["is_main"]), "version": r["version"],
                                   "status": "arbeitet" if r["busy"] else "frei"} for r in rows]}


def _name_of(run, a) -> str:
    row = run.ctx.db.one("SELECT name FROM bots WHERE id=?", a.get("id"))
    return row["name"] if row else str(a.get("id"))


def _update_risk(run, a) -> Risk:
    changes = "\n".join(f"{k}: {a[k]}" for k in ("name", "job", "instructions", "color") if a.get(k) is not None)
    return Risk("dauerhaft", "update_orbi", f"Orbi „{_name_of(run, a)}“ ändern", changes or None)


@tool("update_orbi", "Update another Orbi's name, job, instructions or color. Requires expected_version for concurrency check. Immediately effective and can be undone.",
      {"type": "object", "properties": {"id": {**_id, "description": "ID of the Orbi to update"},
                                        "expected_version": {"type": "integer", "description": "Current version of the Orbi from list_orbis"},
                                        "name": {"type": "string"}, "job": {"type": "string"}, "instructions": {"type": "string"},
                                        "color": {"type": "string", "description": "Hex color like #3366ff"}}, "required": ["id", "expected_version"]},
      label=lambda a: f"Ändert Orbi: {a['name'].strip()}" if isinstance(a.get("name"), str) and a["name"].strip() else "Ändert einen Orbi …",
      risk=_update_risk, groups=False, available=_main)
async def update_orbi(run, a):
    db = run.ctx.db
    name, job = (a.get("name") or "").strip(), (a.get("job") or "").strip()
    if len(name) > 40 or len(job) > 60:
        raise Fail("Name höchstens 40, Aufgabe höchstens 60 Zeichen.")
    if len(a.get("instructions") or "") > 1000:
        raise Fail("Anweisungen: höchstens 1000 Zeichen.")
    if a.get("color") is not None and not COLOR.match(a["color"]):
        raise Fail("Ungültige Eingabe.")
    with db.tx():
        b = _bot(db, a["id"])
        _check_version(b, a["expected_version"], " Bitte Daten neu laden.")
        version = b["version"] + 1
        record_undo(db, "orbi", b["id"], "update", f"Orbi „{b['name']}“ aktualisiert", _state(b))
        db.run("UPDATE bots SET name=?,job=?,instructions=?,color=?,version=? WHERE id=? AND version=?", name or b["name"], job or b["job"],
               a["instructions"] if "instructions" in a else b["instructions"], a["color"] if "color" in a else b["color"], version, b["id"], b["version"])
    return {"ok": True, "version": version, "message": f"Orbi {a['id']} wurde aktualisiert (neue Version: {version}). Rückgängig ist möglich."}


def _archive_risk(run, a) -> Risk:
    return Risk("dauerhaft", "archive_orbi", f"Orbi „{_name_of(run, a)}“ archivieren", "Der Orbi wird ausgeblendet, nichts wird gelöscht. Rückgängig ist möglich.")


@tool("archive_orbi", "Archive an Orbi (soft delete). Cannot archive the main Orbi. Immediately effective and can be undone.",
      {"type": "object", "properties": {"id": {**_id, "description": "ID of the Orbi to archive"}, "expected_version": {"type": "integer"}}, "required": ["id"]},
      label=lambda a: "Archiviert einen Orbi …", risk=_archive_risk, groups=False, available=_main)
async def archive_orbi(run, a):
    db = run.ctx.db
    with db.tx():
        b = _bot(db, a["id"])
        if b["is_main"]:
            raise Fail("Der Hauptorbi kann nicht archiviert werden.")
        _check_version(b, a.get("expected_version"), "")
        record_undo(db, "orbi", b["id"], "archive", f"Orbi „{b['name']}“ archiviert", _state(b))
        db.run("UPDATE bots SET archived_at=?, version=? WHERE id=?", now_ms(), b["version"] + 1, b["id"])
    return {"ok": True, "message": f"Orbi {a['id']} wurde archiviert. Rückgängig ist möglich."}


# ------------------------------------------------------------ Routinen ändern
ACTIONS = ("read", "list", "update", "pause", "resume", "delete")


def _routine(run, routine_id):
    if not routine_id:
        raise Fail("Für diese Aktion ist eine routine id erforderlich.")
    row = run.ctx.db.one("SELECT * FROM automations WHERE id=? AND user_id=? AND bot_id=? AND deleted_at IS NULL", routine_id, USER, run.bot["id"])
    if not row:
        raise Fail(f"Routine {routine_id} nicht gefunden.")
    return row


def _routine_risk(run, a) -> Risk | None:
    if a.get("action") in ("read", "list"):
        return None
    row = _routine(run, a.get("id"))  # nur eigene Routinen: fremde scheitern vor jeder Karte
    verb = {"update": "ändern", "pause": "pausieren", "resume": "fortsetzen", "delete": "archivieren"}.get(a.get("action"), "ändern")
    detail = "\n".join(f"{k}: {dumps(a[k]) if k == 'schedule' else a[k]}" for k in ("name", "prompt", "schedule", "enabled") if a.get(k) is not None)
    return Risk("dauerhaft", "update_routine", f"Routine „{row['name']}“ {verb}", detail or None)


@tool("update_routine", "Read, list, update, pause, resume or delete/archive a routine/automation. Changes take effect immediately and can be undone.",
      {"type": "object", "properties": {
          "action": {"enum": list(ACTIONS), "description": "read = details of one, list = all routines, update = change fields, pause/resume = toggle, delete = archive"},
          "id": {**_id, "description": "Routine id (required except for list)"}, "name": {"type": "string"}, "prompt": {"type": "string"},
          "schedule": {"type": "object", "description": '{kind: daily|weekdays|weekly|monthly|once, at: "HH:MM", weekday?, day?, date?}'},
          "enabled": {"type": "boolean"}}, "required": ["action"]},
      label=lambda a: {"read": "Liest eine Routine", "list": "Liest die Routinen"}.get(a.get("action"), "Ändert eine Routine …"),
      risk=_routine_risk, groups=False, available=lambda run: run.chat_kind == "direct")
async def update_routine(run, a):
    db, action = run.ctx.db, a["action"]
    if action == "list":
        rows = db.all("SELECT * FROM automations WHERE bot_id=? AND user_id=? AND deleted_at IS NULL ORDER BY created_at DESC", run.bot["id"], USER)
        return {"ok": True, "routines": [{"id": r["id"], "name": r["name"], "prompt": r["prompt"], "schedule": loads(r["schedule"]), "enabled": bool(r["enabled"]),
                                          "nextRun": automations.iso(r["next_run_at"])} for r in rows]}
    row = _routine(run, a.get("id"))
    prev = {"name": row["name"], "prompt": row["prompt"], "schedule": loads(row["schedule"]), "enabled": bool(row["enabled"]), "deleted": False}
    if action == "read":
        return {"ok": True, "routine": {"id": row["id"], "name": row["name"], "prompt": row["prompt"], "schedule": prev["schedule"], "enabled": prev["enabled"]}}
    name = row["name"]
    with db.tx():
        if action == "update":
            if a.get("schedule") is not None:
                schedule.validate_schedule(a["schedule"])
            body = {"name": a.get("name", row["name"]), "prompt": a.get("prompt", row["prompt"]), "schedule": a.get("schedule", prev["schedule"]),
                    "timezone": row["timezone"], "target": row["target"], "notify": row["notify"], "model": row["model"], "effort": row["effort"],
                    "context": bool(row["context"])}
            automations.update(db, row["id"], body)
            if a.get("enabled") is not None:
                automations.set_enabled(db, row["id"], a["enabled"])
            name, text = body["name"], f"Routine „{body['name']}“ wurde aktualisiert. (Rückgängig möglich)"
            detail = f"Routine „{name}“ aktualisiert"
        elif action in ("pause", "resume"):
            automations.set_enabled(db, row["id"], action == "resume")
            text = f"Routine „{name}“ wurde {'aktiviert' if action == 'resume' else 'pausiert'}. (Rückgängig möglich)"
            detail = f"Routine „{name}“ {'fortgesetzt' if action == 'resume' else 'pausiert'}"
        else:
            automations.trash(db, row["id"])
            text, detail = f"Routine „{name}“ wurde archiviert. (Rückgängig möglich)", f"Routine „{name}“ archiviert"
        record_undo(db, "routine", row["id"], action, detail, prev)
    return {"ok": True, "message": text}
