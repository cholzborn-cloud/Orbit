"""Background work: Task, TodoWrite, Check/Message/StopSubagent (Word 4.1, 4.2, 4.40–4.42)."""
from ..db import new_id, now_ms
from ..runtime.contract import tool
from ..web import Fail

# Word subagent_type → work_runs.role (contract.ROLES)
_ROLE = {
    "executor": "executor",
    "videoReview": "executor",
    "watchVideo": "executor",
    "computerUse": "desktop",
}
_TODO_STATUS = frozenset({"pending", "in_progress", "completed", "cancelled"})
_foreground = lambda run: not getattr(run, "is_child", False)


def _runtime(run):
    rt = run.ctx.parts.get("runtime")
    if rt is None:
        raise Fail("Runtime is not ready.")
    return rt


def _owned_child(run, child_id: str):
    row = run.ctx.db.one(
        "SELECT * FROM work_runs WHERE id=? AND kind='worker' AND origin_chat_id=? AND owner_bot_id=?",
        child_id, run.chat_id, run.bot["id"])
    if not row:
        raise Fail("Unknown subagent. Use CheckSubagent to list yours.")
    return row


@tool("Task", "Start a child worker for a self-contained job. The child does not see this chat; put everything it needs in prompt. "
      "Use run_in_background=true to keep chatting while it works; otherwise wait for its private report. "
      "Resume a finished child with resume=its id. Nested Task from a child is not allowed.",
      {"type": "object", "additionalProperties": False, "properties": {
          "description": {"type": "string", "minLength": 1},
          "prompt": {"type": "string", "minLength": 1},
          "subagent_type": {"enum": list(_ROLE)},
          "run_in_background": {"type": "boolean"},
          "resume": {"type": "string"},
          "file_attachments": {"type": "array", "items": {"type": "string"}, "maxItems": 20}},
       "required": ["description", "prompt", "subagent_type"]},
      available=_foreground)
async def task(run, args):
    role = _ROLE[args["subagent_type"]]
    background = bool(args.get("run_in_background"))
    attachments = [a for a in (args.get("file_attachments") or []) if isinstance(a, str) and a.strip()]
    rt = _runtime(run)
    child_id = await rt.spawn_child(
        run, description=args["description"].strip(), prompt=args["prompt"].strip(), role=role,
        background=background, attachments=attachments, resume_id=(args.get("resume") or None))
    if background:
        return {"ok": True, "subagentId": child_id, "status": "queued", "background": True}
    view = await rt.wait_child(child_id)
    return {"ok": True, "subagentId": child_id, **view}


@tool("TodoWrite", "Durable todo list for this chat and Orbi. Always send at least two items. "
      "merge=true upserts by id; merge=false replaces the whole list. "
      "status: pending, in_progress, completed, cancelled. Several items may be in_progress at once.",
      {"type": "object", "additionalProperties": False, "properties": {
          "merge": {"type": "boolean"},
          "todos": {"type": "array", "minItems": 2, "maxItems": 40, "items": {
              "type": "object", "additionalProperties": False, "properties": {
                  "id": {"type": "string", "minLength": 1},
                  "content": {"type": "string", "minLength": 1},
                  "status": {"enum": sorted(_TODO_STATUS)}},
              "required": ["id", "content", "status"]}}},
       "required": ["merge", "todos"]})
async def todo_write(run, args):
    todos = args["todos"]
    if len(todos) < 2:
        raise Fail("TodoWrite needs at least two items.")
    seen, clean = set(), []
    for item in todos:
        key = item["id"].strip()
        if not key or key in seen:
            raise Fail("Each todo id must be unique in one call.")
        if item["status"] not in _TODO_STATUS:
            raise Fail("Unknown todo status.")
        seen.add(key)
        clean.append({"id": key, "content": item["content"].strip(), "status": item["status"]})
    db, t, chat_id, bot_id = run.ctx.db, now_ms(), run.chat_id, run.bot["id"]
    with db.tx():
        if not args["merge"]:
            db.run("DELETE FROM todos WHERE chat_id=? AND bot_id=?", chat_id, bot_id)
        for i, item in enumerate(clean):
            existing = db.one("SELECT id, delivered_at FROM todos WHERE chat_id=? AND bot_id=? AND item_key=?",
                              chat_id, bot_id, item["id"])
            delivered = existing["delivered_at"] if existing else None
            if item["status"] == "completed" and not delivered:
                delivered = t
            if existing:
                db.run("UPDATE todos SET content=?, status=?, position=?, delivered_at=?, updated_at=? WHERE id=?",
                       item["content"], item["status"], i, delivered, t, existing["id"])
            else:
                db.run("INSERT INTO todos (id,chat_id,bot_id,content,status,position,item_key,delivered_at,created_at,updated_at) "
                       "VALUES (?,?,?,?,?,?,?,?,?,?)",
                       new_id(), chat_id, bot_id, item["content"], item["status"], i, item["id"], delivered, t, t)
    rows = db.all("SELECT item_key AS id, content, status, delivered_at FROM todos WHERE chat_id=? AND bot_id=? ORDER BY position, rowid",
                  chat_id, bot_id)
    return {"ok": True, "todos": [{"id": r["id"], "content": r["content"], "status": r["status"],
                                  "delivered": bool(r["delivered_at"])} for r in rows]}


@tool("CheckSubagent", "Private diagnostics for your child workers in this chat. Omit subagent_id to list live ones; "
      "pass an id for one child (elapsed, latest tool, stalled). Do not poll in a busy loop.",
      {"type": "object", "additionalProperties": False, "properties": {
          "subagent_id": {"type": "string"}}, "required": []},
      available=_foreground)
async def check_subagent(run, args):
    rt = _runtime(run)
    if sid := (args.get("subagent_id") or "").strip():
        _owned_child(run, sid)
        return {"ok": True, "subagent": rt.child_view(sid)}
    return {"ok": True, "subagents": rt.children(run.chat_id, run.bot["id"], live_only=True)}


@tool("MessageSubagent", "Send a steering message to one of your active child workers. "
      "If it already finished, resume it with Task instead.",
      {"type": "object", "additionalProperties": False, "properties": {
          "subagent_id": {"type": "string", "minLength": 1},
          "message": {"type": "string", "minLength": 1}},
       "required": ["subagent_id", "message"]},
      available=_foreground)
async def message_subagent(run, args):
    _owned_child(run, args["subagent_id"])
    status = _runtime(run).send_control(args["subagent_id"], args["message"].strip())
    if status == "finished":
        raise Fail("This subagent already finished. Resume it with Task(resume=…) instead.")
    if status == "unreachable":
        raise Fail("Unknown subagent. Use CheckSubagent to list yours.")
    return {"ok": True, "status": status}


@tool("StopSubagent", "Stop one child (subagent_id) or every live child you own in this chat (all=true). "
      "Returns stopped, already-finished or unreachable per child.",
      {"type": "object", "additionalProperties": False, "properties": {
          "subagent_id": {"type": "string"},
          "all": {"type": "boolean"}},
       "required": []},
      available=_foreground)
async def stop_subagent(run, args):
    rt = _runtime(run)
    if args.get("all"):
        results = []
        for view in rt.children(run.chat_id, run.bot["id"], live_only=True):
            results.append({"subagentId": view["id"], "status": await rt.stop_child(view["id"])})
        return {"ok": True, "results": results}
    sid = (args.get("subagent_id") or "").strip()
    if not sid:
        raise Fail("Pass subagent_id or all=true.")
    _owned_child(run, sid)
    return {"ok": True, "subagentId": sid, "status": await rt.stop_child(sid)}
