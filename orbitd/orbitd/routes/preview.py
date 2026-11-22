"""Prompt-Vorschau: zeigt, was ein Orbi in diesem Chat zu lesen bekäme. Nur lesend, nichts wird gemerkt oder gesendet."""
from .. import context
from ..runtime.contract import TOOLS
from ..web import Fail, Req, route


@route("GET", "/v1/chats/{id}/prompt-preview")
async def prompt_preview(req: Req):
    db = req.ctx.db
    chat = db.one("SELECT * FROM chats WHERE id=?", req.params["id"])
    bot = chat and db.one("SELECT b.* FROM chat_members m JOIN bots b ON b.id=m.bot_id WHERE m.chat_id=? AND b.archived_at IS NULL ORDER BY m.joined_at, b.id LIMIT 1", chat["id"])
    if not chat:
        raise Fail("Chat nicht gefunden.")
    if not bot:
        raise Fail("Der Chat hat keinen Orbi.")
    group = chat["kind"] == "group"
    stable = context.system_prompt(req.ctx, bot, chat)
    tools = "\n".join(f"- {t.name}: {t.description}" for t in TOOLS.values() if t.groups or not group)
    volatile = context.turn_prompt(req.ctx, bot, chat, [], True).text  # item-lose Vorschau, commit_turn wird nie gerufen
    return {
        "ok": True, "chatId": chat["id"],
        "bot": {"id": bot["id"], "name": bot["name"], "job": bot["job"], "isMain": bool(bot["is_main"])},
        "layers": {"layer1Stable": stable, "layer2Tools": tools, "layer3Volatile": volatile},
        "sections": [
            {"id": "stable", "title": "Stabiler Kern", "layer": "stable", "content": stable},
            {"id": "tools", "title": "Werkzeuge", "layer": "tools", "content": tools},
            {"id": "volatile", "title": "Flüchtiger Kontext (je Antwort)", "layer": "volatile", "content": volatile},
        ],
        "approximate": True,
        "note": "Näherung: Mac-Werkzeuge und Karten kommen erst im echten Turn dazu; Mac-Werkzeuge gibt es nur im Einzelchat im Vordergrund.",
        "fullPrompt": stable + "\n\n" + volatile,
    }
