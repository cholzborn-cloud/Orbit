"""Chat: Zug starten, Strom, Stopp, Weiter, Verlauf, Status. Vorlage: service/src/app.ts (/v1/chats/:id/*), plan/API.md."""
from .. import chatstore
from ..web import HttpError, Req, route

MAX_TURN_BODY = 25 * 1024 * 1024
BUSY_CLEAR = "Bitte zuerst die laufende Antwort stoppen."


def _runtime(req: Req):
    runtime = req.ctx.parts.get("runtime")
    if runtime is None:
        raise HttpError(503, "Chat ist nicht verfügbar.")
    return runtime


def _own_chat(req: Req) -> str:
    chat_id = req.params["id"]
    if not req.ctx.db.val("SELECT 1 FROM chats WHERE id=? AND user_id='local'", chat_id):
        raise HttpError(404, "Chat nicht gefunden.")
    return chat_id


@route("POST", "/v1/chats/{id}/turn", max_body=MAX_TURN_BODY)
async def turn(req: Req):
    chat_id = _own_chat(req)
    if not isinstance(req.body, dict):
        raise HttpError(400, "Ungültige Anfrage.")
    return await _runtime(req).submit(chat_id, req.body)


@route("GET", "/v1/chats/{id}/stream")
async def stream(req: Req):
    from starlette.responses import Response
    return _runtime(req).stream(_own_chat(req)) or Response(status_code=204)


@route("POST", "/v1/chats/{id}/stop")
async def stop(req: Req):
    return await _runtime(req).stop(_own_chat(req))


@route("POST", "/v1/chats/{id}/resume")
async def resume(req: Req):
    chat_id, body = _own_chat(req), req.obj()
    run_id = body.get("runId")
    if not isinstance(run_id, str) or not 1 <= len(run_id) <= 100 or not isinstance(body.get("dismiss", False), bool):
        raise HttpError(400, "Ungültige Anfrage.")
    await _runtime(req).resume(chat_id, run_id, bool(body.get("dismiss")))


def message_page(all_messages: list, limit_param: str | None, before: str | None) -> dict:
    """Wie messagePage in app.ts: neueste `limit` Nachrichten (höchstens 500) vor `before`, plus hasMore."""
    try:
        limit = int(limit_param)
    except (TypeError, ValueError):
        return {"messages": all_messages}
    if limit < 1:
        return {"messages": all_messages}
    end = len(all_messages)
    if before:
        end = next((i for i, m in enumerate(all_messages) if m["id"] == before), -1)
        if end < 0:
            return {"messages": [], "hasMore": False}
    start = max(0, end - min(limit, 500))
    return {"messages": all_messages[start:end], "hasMore": start > 0}


@route("GET", "/v1/chats/{id}/messages")
async def messages(req: Req):
    db, chat_id = req.ctx.db, _own_chat(req)
    runtime = req.ctx.parts.get("runtime")
    reactions = db.all("SELECT message_id, actor, emoji, created_at FROM message_reactions WHERE chat_id=? ORDER BY created_at", chat_id)
    return {**message_page(chatstore.messages(db, chat_id), req.query.get("limit"), req.query.get("before")),
            "interrupted": runtime.interrupted(chat_id) if runtime else None,
            "reactions": [{"messageId": r["message_id"], "actor": r["actor"], "emoji": r["emoji"], "createdAt": r["created_at"]} for r in reactions]}


@route("DELETE", "/v1/chats/{id}/messages")
async def clear_messages(req: Req):
    from ..runtime import inbox
    db, chat_id = req.ctx.db, _own_chat(req)
    runtime = req.ctx.parts.get("runtime")
    if inbox.busy(db, chat_id) or (runtime and chat_id in runtime.runs):
        raise HttpError(409, BUSY_CLEAR)
    chatstore.clear(db, chat_id)
    if runtime:
        runtime.streams.forget(chat_id)


@route("GET", "/v1/status")
async def status(req: Req):
    runtime = req.ctx.parts.get("runtime")
    return runtime.status() if runtime else {"ok": True, "chats": [], "interrupted": [], "needsYou": 0}
