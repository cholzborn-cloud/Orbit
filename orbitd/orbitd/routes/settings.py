"""Einstellungen und Freigabe-Regeln."""
import sqlite3
from datetime import datetime, timezone

from ..config import USER, isolated_dir
from ..db import dumps, loads, new_id, now_ms
from ..web import Fail, Req, route

THEMES = ("light", "dark", "system")
INSTRUCTIONS_LIMIT = 8000


def iso(ms: int | None) -> str | None:
    """Zeit wie JavaScript-toISOString (Millisekunden, Z)."""
    if ms is None:
        return None
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{int(ms) % 1000:03d}Z"


def _upsert(db, **cols) -> None:
    insert = {"theme": "dark", **cols} if isolated_dir() else cols
    db.run(f"INSERT INTO user_settings (user_id,{','.join(insert)},updated_at) VALUES (?,{','.join('?' * len(insert))},?)"
           f" ON CONFLICT(user_id) DO UPDATE SET {','.join(f'{n}=excluded.{n}' for n in cols)},updated_at=excluded.updated_at",
           USER, *insert.values(), now_ms())


@route("GET", "/v1/settings")
async def get_settings(req: Req):
    row = req.ctx.db.one("SELECT theme,jev_auto,jev_handoff,base_instructions FROM user_settings WHERE user_id=?", USER)
    default_theme = "dark" if isolated_dir() else "system"
    return {"ok": True, "settings": {
        "theme": row["theme"] if row and row["theme"] in THEMES else default_theme,
        "jevAuto": bool(row["jev_auto"]) if row else True,
        # Die App liest jevHandoff evtl. als Pflichtfeld: bleibt erhalten.
        "jevHandoff": bool(row["jev_handoff"]) if row else False,
        "baseInstructions": row["base_instructions"] if row else None}}


@route("PUT", "/v1/settings/theme")
async def put_theme(req: Req):
    theme = req.obj().get("theme")
    if theme not in THEMES:
        raise Fail("Ungültiges Design.")
    _upsert(req.ctx.db, theme=theme)


@route("PUT", "/v1/settings/jev")
async def put_jev(req: Req):
    body = req.obj()
    values = {col: body[key] for key, col in (("auto", "jev_auto"), ("handoff", "jev_handoff")) if key in body}
    if not values or not all(isinstance(v, bool) for v in values.values()):
        raise Fail("Ungültige Jev-Einstellungen.")
    _upsert(req.ctx.db, **{k: int(v) for k, v in values.items()})


@route("PUT", "/v1/settings/instructions")
async def put_instructions(req: Req):
    body = req.obj()
    text = body.get("instructions")
    if "instructions" not in body or (text is not None and (not isinstance(text, str) or len(text) > INSTRUCTIONS_LIMIT)):
        raise Fail(f"Die Anleitung darf höchstens {INSTRUCTIONS_LIMIT:,}".replace(",", ".") + " Zeichen lang sein.")
    default = req.ctx.parts.get("default_instructions")
    if not text or text == (default() if default else ""):
        text = None
    _upsert(req.ctx.db, base_instructions=text)


@route("GET", "/v1/settings/instructions/default")
async def default_instructions(req: Req):
    text = req.ctx.parts.get("default_instructions")
    return {"ok": True, "text": text() if text else "", "limit": INSTRUCTIONS_LIMIT}


@route("GET", "/v1/settings/rules")
async def list_rules(req: Req):
    rows = req.ctx.db.all("SELECT r.id,r.tool,r.bot_id,b.name AS bot_name,r.mode FROM approval_rules r"
                          " LEFT JOIN bots b ON b.id=r.bot_id WHERE r.user_id=? ORDER BY r.tool", USER)
    return {"ok": True, "rules": [{"id": r["id"], "tool": r["tool"], "botId": r["bot_id"], "botName": r["bot_name"], "mode": r["mode"]} for r in rows]}


@route("POST", "/v1/settings/rules")
async def set_rule(req: Req):
    body, db = req.obj(), req.ctx.db
    tool, bot, mode = body.get("tool"), body.get("botId"), body.get("mode")
    tool = tool.strip() if isinstance(tool, str) else ""
    if not 1 <= len(tool) <= 200 or mode not in ("allow", "ask", "deny") or ("botId" in body and (not isinstance(bot, str) or not bot)):
        raise Fail("Die Freigabe ist ungültig.")
    if bot and not db.val("SELECT 1 FROM bots WHERE id=? AND user_id=?", bot, USER):
        raise Fail("Dieser Orbi gehört nicht zu deinem Konto.")
    # Ein Statement statt löschen + einfügen: gleichzeitiges Speichern erzeugt keine Dubletten.
    target = "(user_id,tool,bot_id) WHERE bot_id IS NOT NULL" if bot else "(user_id,tool) WHERE bot_id IS NULL"
    try:
        db.run(f"INSERT INTO approval_rules (id,user_id,bot_id,tool,mode,created_at) VALUES (?,?,?,?,?,?)"
               f" ON CONFLICT{target} DO UPDATE SET mode=excluded.mode", new_id(), USER, bot, tool, mode, now_ms())
    except sqlite3.Error:
        raise Fail("Freigabe konnte nicht gespeichert werden.") from None


@route("DELETE", "/v1/settings/rules/{id}")
async def delete_rule(req: Req):
    rule = req.params["id"]
    if len(rule) > 100:
        raise Fail("Die Freigabe ist ungültig.")
    req.ctx.db.run("DELETE FROM approval_rules WHERE id=? AND user_id=?", rule, USER)


@route("GET", "/v1/settings/icon")
async def app_icon(req: Req):
    return {"ok": True, "icon": loads(req.ctx.db.val("SELECT value FROM app_kv WHERE key='rust_app_icon'"))}


@route("PUT", "/v1/settings/icon")
async def save_app_icon(req: Req):
    from .bots import AVATARS, COLOR
    body = req.obj()
    icon = {key: body.get(key, "") for key in ("avatar", "color", "background")}
    if not isinstance(icon["avatar"], str) or icon["avatar"] not in AVATARS:
        raise Fail("Wähle eine Figur für das App-Symbol.")
    if not all(isinstance(icon[key], str) and (not icon[key] or COLOR.fullmatch(icon[key])) for key in ("color", "background")):
        raise Fail("Figur- und Hintergrundfarbe: jeweils #RRGGBB oder leer.")
    req.ctx.db.run("INSERT OR REPLACE INTO app_kv (key,value,updated_at) VALUES ('rust_app_icon',?,?)", dumps(icon), now_ms())
    return {"ok": True, "icon": icon}


@route("DELETE", "/v1/settings/icon")
async def reset_app_icon(req: Req):
    req.ctx.db.run("DELETE FROM app_kv WHERE key='rust_app_icon'")


PROFILE_DEFAULTS = {"name": "", "occupation": "", "avatarColor": "", "avatarFont": "", "answerLength": "standard", "learn": True,
                    "backgroundWork": True, "loginOpen": False, "language": "de", "notificationsDone": True,
                    "notificationsAttention": True, "notificationsApprovals": True, "sound": True,
                    "reducedMotion": "system", "defaultModel": "auto", "defaultEffort": None, "defaultFast": False, "cloud": True, "sleepMinutes": 15}


def profile_preferences(db) -> dict:
    value = loads(db.val("SELECT value FROM app_kv WHERE key='rust_user_profile'"), {})
    return {**PROFILE_DEFAULTS, **(value if isinstance(value, dict) else {})}


@route("GET", "/v1/settings/profile")
async def read_profile(req: Req):
    return {"ok": True, "profile": profile_preferences(req.ctx.db)}


@route("PUT", "/v1/settings/presence")
async def write_presence(req: Req):
    """Oberfläche meldet, ob das Orbit-Fenster vorn ist — steuert System-Mitteilungen."""
    body = req.obj()
    active = body.get("active")
    if type(active) is not bool:
        raise Fail("active muss wahr oder falsch sein.")
    notices = req.ctx.parts.get("notices")
    if notices:
        notices.set_active(active)
    return {"ok": True, "active": active}


@route("PUT", "/v1/settings/profile")
async def write_profile(req: Req):
    from ..cli import resolve

    body = req.obj()
    clean = {}
    modes = {"answerLength": ("short", "standard", "long"), "language": ("de",), "reducedMotion": ("system", "on", "off"),
             "avatarColor": ("", "blau", "gruen", "rosa", "violett", "sand"), "avatarFont": ("", "schlicht", "serifen", "mono")}
    for key, value in body.items():
        if key not in PROFILE_DEFAULTS:
            raise Fail("Unbekannte Profileinstellung.")
        if key in ("name", "occupation"):
            cap = 40 if key == "name" else 120
            if not isinstance(value, str) or len(value.strip()) > cap or any(ord(c) < 32 for c in value):
                raise Fail(f"Gib höchstens {cap} Zeichen ein.")
            value = value.strip()
        elif key in modes:
            if value not in modes[key]:
                raise Fail("Wähle eine gültige Einstellung.")
        elif key == "defaultModel":
            if not isinstance(value, str) or (value != "auto" and resolve(value)[0] is None):
                raise Fail("Dieses Modell gibt es nicht.")
        elif key == "defaultEffort":
            if value is not None and not isinstance(value, str):
                raise Fail("Wähle eine gültige Denktiefe.")
        elif key == "sleepMinutes":
            if type(value) is not int or value not in (5, 10, 15, 30, 60):
                raise Fail("Die Wartezeit ist ungültig.")
        elif type(value) is not bool:
            raise Fail("Die Profileinstellung ist ungültig.")
        clean[key] = value
    with req.ctx.db.tx():
        profile = profile_preferences(req.ctx.db)
        if "defaultModel" in clean and clean["defaultModel"] != profile["defaultModel"]:
            clean.setdefault("defaultEffort", None)
            clean.setdefault("defaultFast", False)
        profile.update(clean)
        effort = clean.get("defaultEffort")
        model, _ = resolve(profile["defaultModel"])
        if effort is not None and (not model or effort not in model["efforts"]):
            raise Fail("Dieses Modell unterstützt diese Denktiefe nicht.")
        if profile["defaultFast"] and (not model or not model.get("fast")):
            raise Fail("Dieses Modell hat keinen Fast-Modus.")
        req.ctx.db.run("INSERT OR REPLACE INTO app_kv (key,value,updated_at) VALUES ('rust_user_profile',?,?)", dumps(profile), now_ms())
    return {"ok": True, "profile": profile}
