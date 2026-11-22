"""Chatliste, Gruppen, Reaktionen, „gesehen“.

Vorlage: actions/chat.ts, query/chat.ts, service/src/chat/reaction-routes.ts, lib/chat/reactions.ts.
"""
import json
from pathlib import Path

from ..db import new_id, now_ms
from ..web import Fail, HttpError, Req, route
from .bots import iso

MAX_GROUP_MEMBERS = 6
REACTION_EMOJIS = frozenset(emoji for group in json.loads(
    (Path(__file__).resolve().parents[1] / "emoji.json").read_text(encoding="utf-8")
)["groups"].values() for emoji, _ in group)
USER_ACTOR = "user"


def _group_form(body) -> tuple[str, list[str]]:
    if not isinstance(body, dict):
        raise HttpError(400, "Ungültige Anfrage.")
    name, ids = body.get("name"), body.get("botIds")
    if not isinstance(name, str) or not name.strip():
        raise Fail("Gib der Gruppe einen Namen")
    if len(name.strip()) > 40:
        raise Fail("Name höchstens 40 Zeichen.")
    if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids) or not ids:
        raise Fail("Wähle mindestens einen Orbi")
    if len(ids) > MAX_GROUP_MEMBERS:
        raise Fail("Höchstens 6 Orbis je Gruppe")
    return name.strip(), ids


def _own_bots(db, ids: list[str]) -> list[str]:
    """Nur eigene Orbis zulassen; Doppelte oder Fremde ergeben denselben Fehler wie im alten Dienst."""
    own = [r["id"] for r in db.all(f"SELECT id FROM bots WHERE user_id='local' AND id IN ({','.join('?' * len(ids))})", *ids)]
    if len(own) != len(ids):
        raise Fail("Unbekannter Orbi.")
    return own


@route("GET", "/v1/chats")
async def list_chats(req: Req):
    rows = req.ctx.db.all("SELECT id, last_message_at, (SELECT count(*) FROM chat_members m WHERE m.chat_id=c.id) AS n"
                          " FROM chats c WHERE user_id='local' AND kind IN ('direct','group')")
    return {"ok": True, "chats": [{"id": r["id"], "lastMessageAt": iso(r["last_message_at"]), "memberCount": r["n"]} for r in rows]}


@route("POST", "/v1/chats")
async def create_group(req: Req):
    name, ids = _group_form(req.body)
    db, chat_id, t = req.ctx.db, new_id(), now_ms()
    with db.tx():
        own = _own_bots(db, ids)
        db.run("INSERT INTO chats (id,user_id,kind,name,last_message_at,created_at) VALUES (?,'local','group',?,?,?)", chat_id, name, t, t)
        for bot in own:
            db.run("INSERT INTO chat_members (chat_id,bot_id,joined_at) VALUES (?,?,?)", chat_id, bot, t)
    return {"ok": True, "id": chat_id}


@route("PATCH", "/v1/chats/{id}")
async def update_group(req: Req):
    name, ids = _group_form(req.body)
    db, chat_id, t = req.ctx.db, req.params["id"], now_ms()
    with db.tx():
        if not db.val("SELECT 1 FROM chats WHERE id=? AND user_id='local' AND kind='group'", chat_id):
            raise Fail("Gruppe nicht gefunden.")
        own = _own_bots(db, ids)
        db.run("UPDATE chats SET name=? WHERE id=?", name, chat_id)
        db.run("DELETE FROM chat_members WHERE chat_id=?", chat_id)
        for bot in own:
            db.run("INSERT INTO chat_members (chat_id,bot_id,joined_at) VALUES (?,?,?)", chat_id, bot, t)
    return {"ok": True}


@route("DELETE", "/v1/chats/{id}")
async def delete_group(req: Req):
    # Mitglieder gehen per Cascade mit; die Orbis bleiben.
    if not req.ctx.db.run("DELETE FROM chats WHERE id=? AND user_id='local' AND kind='group'", req.params["id"]):
        raise Fail("Gruppe nicht gefunden.")
    return {"ok": True}


def _own_chat(db, chat_id: str) -> None:
    if not db.val("SELECT 1 FROM chats WHERE id=? AND user_id='local'", chat_id):
        raise HttpError(404, "Chat nicht gefunden.")


@route("GET", "/v1/chats/{id}/reactions")
async def list_reactions(req: Req):
    _own_chat(req.ctx.db, req.params["id"])
    rows = req.ctx.db.all("SELECT message_id, actor, emoji, created_at FROM message_reactions WHERE chat_id=? ORDER BY created_at", req.params["id"])
    return {"reactions": [{"messageId": r["message_id"], "actor": r["actor"], "emoji": r["emoji"], "createdAt": r["created_at"]} for r in rows]}


@route("PUT", "/v1/chats/{id}/messages/{messageId}/reaction")
async def set_reaction(req: Req):
    db, chat_id, message_id = req.ctx.db, req.params["id"], req.params["messageId"]
    _own_chat(db, chat_id)
    emoji = req.obj().get("emoji")
    if not isinstance(emoji, str) or emoji not in REACTION_EMOJIS:
        raise HttpError(400, "Ungültige Reaktion.")
    # Die Antwort, die gerade gestreamt wird, steht evtl. noch nicht in der Datenbank. Teile einer Antwort heißen `<id>~t<n>`.
    base = message_id.split("~")[0]
    live_id = req.ctx.parts.get("live_message_id")  # optional: Funktion chat_id -> Id der laufenden Antwort
    live = bool(live_id) and live_id(chat_id) == base
    if not live and not db.val("SELECT 1 FROM chat_messages WHERE chat_id=? AND id=?", chat_id, base):
        raise HttpError(404, "Nachricht nicht gefunden.")
    db.run("INSERT INTO message_reactions (chat_id,message_id,actor,emoji,created_at) VALUES (?,?,?,?,?)"
           " ON CONFLICT(chat_id,message_id,actor) DO UPDATE SET emoji=excluded.emoji, created_at=excluded.created_at",
           chat_id, message_id, USER_ACTOR, emoji, now_ms())
    req.ctx.bus.publish({"type": "reaction", "chatId": chat_id, "messageId": message_id, "actor": USER_ACTOR, "emoji": emoji})
    # offen: Karte per Reaktion beantworten (👍/👎 auf eine offene Auswahlkarte der laufenden Antwort)
    return {"ok": True, "answered": False}


@route("DELETE", "/v1/chats/{id}/messages/{messageId}/reaction")
async def remove_reaction(req: Req):
    db, chat_id, message_id = req.ctx.db, req.params["id"], req.params["messageId"]
    _own_chat(db, chat_id)
    removed = db.run("DELETE FROM message_reactions WHERE chat_id=? AND message_id=? AND actor=?", chat_id, message_id, USER_ACTOR) > 0
    if removed:
        req.ctx.bus.publish({"type": "reaction", "chatId": chat_id, "messageId": message_id, "actor": USER_ACTOR, "emoji": None})
    return {"ok": True, "removed": removed}


@route("POST", "/v1/chats/{id}/seen")
async def seen(req: Req):
    db, chat_id = req.ctx.db, req.params["id"]
    if not db.val("SELECT 1 FROM chats WHERE id=? AND user_id='local'", chat_id):
        raise Fail("Chat nicht gefunden.")
    db.run("INSERT INTO chat_seen (chat_id,seen_at) VALUES (?,?) ON CONFLICT(chat_id) DO UPDATE SET seen_at=excluded.seen_at", chat_id, now_ms())
