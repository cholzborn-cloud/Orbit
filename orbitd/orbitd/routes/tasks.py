"""Aufträge zwischen Orbis: gespeicherter Verlauf, Übergabe und Stopp."""
from ..config import USER
from ..db import loads
from ..tools.messages import set_task
from ..web import Fail, Req, route


FIELDS = {"id": "id", "orbi_id": "orbiId", "parent_chat_id": "parentChatId", "parent_task_id": "parentTaskId",
          "brief": "brief", "title": "title", "mode": "mode", "reply": "reply", "status": "status", "result": "result",
          "progress": "progress", "done_when": "doneWhen", "answers": "answers", "rework": "rework", "resume_of": "resumeOf",
          "assigned_bot_id": "assignedBotId", "started_at": "startedAt", "last_progress_at": "lastProgressAt",
          "finished_at": "finishedAt", "created_at": "createdAt", "updated_at": "updatedAt", "assignee_name": "assigneeName"}
BASE = "FROM tasks t JOIN chats c ON c.id=t.parent_chat_id JOIN bots b ON b.id=t.orbi_id WHERE c.user_id=? AND b.user_id=?"


def _task(row) -> dict:
    item = {name: row[key] for key, name in FIELDS.items()}
    if not item["assigneeName"]:
        item["assigneeName"] = row["orbi_name"]
    handoff = loads(row["handoff"], {})
    if isinstance(handoff, dict) and handoff:
        item["handoff"] = {key: value for key, value in handoff.items() if not key.startswith("_")}
    return item


def _select(req: Req, extra: str = "", values: tuple = ()):
    return req.ctx.db.all("SELECT t.*, b.name AS orbi_name,"
                          " (SELECT name FROM bots WHERE id=t.assigned_bot_id AND user_id=b.user_id) AS assignee_name "
                          + BASE + extra, USER, USER, *values)


def _list(req: Req, statuses: list[str]) -> list[dict]:
    columns = {
        "t.parent_chat_id": req.query.get("parentChatId") or req.query.get("chatId"),
        "t.orbi_id": req.query.get("orbiId"), "t.parent_task_id": req.query.get("parentTaskId"),
    }
    filters = {column: value for column, value in columns.items() if value}
    where = "".join(f" AND {column}=?" for column in filters)
    if statuses:
        where += f" AND t.status IN ({','.join('?' for _ in statuses)})"
    rows = _select(req, where + " ORDER BY t.created_at DESC, t.id", (*filters.values(), *statuses))
    return [_task(row) for row in rows]


@route("GET", "/v1/tasks")
async def list_tasks(req: Req):
    statuses = req.query.get("status", "").split(",")[:10] if req.query.get("status") else []
    return {"ok": True, "tasks": _list(req, statuses)}


@route("GET", "/v1/tasks/active")
async def active_tasks(req: Req):
    return {"ok": True, "active": _list(req, ["queued", "running", "waiting", "blocked"])}


@route("GET", "/v1/tasks/{id}")
async def get_task(req: Req):
    rows = _select(req, " AND t.id=?", (req.params["id"],))
    if not rows:
        raise Fail("Auftrag nicht gefunden.")
    return {"ok": True, "task": _task(rows[0])}


async def stop_task(ctx, task_id: str) -> bool:
    """Beendet die Läufe dieses Auftrags (und seiner Unteraufträge) und setzt ihn auf gestoppt. False, wenn er schon zu Ende war."""
    db = ctx.db
    if not set_task(ctx, task_id, "stopped"):  # zuerst, damit der Haken nach dem Lauf nicht „fertig“ meldet
        return False
    chats = [r[0] for r in db.all("SELECT DISTINCT chat_id FROM inbox_items WHERE status IN ('queued','processing') AND json_extract(payload,'$.taskId')=?", task_id)]
    for chat_id in chats:
        await ctx.parts["runtime"].stop(chat_id)
    for (child,) in db.all("SELECT id FROM tasks WHERE parent_task_id=?", task_id):
        await stop_task(ctx, child)
    return True


@route("POST", "/v1/tasks/{id}/stop")
async def stop(req: Req):
    if not _select(req, " AND t.id=?", (req.params["id"],)):
        raise Fail("Auftrag nicht gefunden.")
    return {"ok": True, "stopped": await stop_task(req.ctx, req.params["id"])}
