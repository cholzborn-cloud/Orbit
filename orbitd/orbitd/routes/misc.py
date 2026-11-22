"""Budget, Schlüssel (nur „gesetzt oder nicht“), Chat-Suche, Jev-Protokoll."""
import math
import re
import sqlite3
import time
from datetime import datetime

from .. import keychain
from ..config import USER, isolated_dir
from ..db import dumps, loads, now_ms
from ..web import Fail, Req, route
from .settings import iso

BUDGET_DEFAULTS = {"jevDailyUsd": 0.5, "maxSandboxes": 3}
BOUNDS = {"jevDailyUsd": (0, 50), "maxSandboxes": (1, 10)}


def _num(value, key: str, whole: bool = False) -> bool:
    ok = isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and BOUNDS[key][0] <= value <= BOUNDS[key][1]
    return ok and (not whole or float(value).is_integer())


def _budget(db) -> dict:
    raw = loads(db.val("SELECT value FROM app_kv WHERE key='budget'"), {})
    raw = raw if isinstance(raw, dict) else {}
    return {"jevDailyUsd": raw["jevDailyUsd"] if _num(raw.get("jevDailyUsd"), "jevDailyUsd") else BUDGET_DEFAULTS["jevDailyUsd"],
            "maxSandboxes": int(raw["maxSandboxes"]) if _num(raw.get("maxSandboxes"), "maxSandboxes", True) else BUDGET_DEFAULTS["maxSandboxes"]}


def _overview(ctx) -> dict:
    db = ctx.db
    budget = _budget(db)
    day = int(datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)  # Beginn des Tages, Ortszeit
    spent = db.val("SELECT coalesce(sum(cost_usd),0) FROM jev_log WHERE created_at>=?", day)
    limit = budget["jevDailyUsd"]
    state = "aus" if limit <= 0 or spent >= limit else "hinweis" if spent >= limit * 0.8 else "ok"
    percent = 100 if limit <= 0 else math.floor(spent / limit * 100 + 0.5)
    tokens = db.all("SELECT bot_id,sum(CASE WHEN turn_kind='model_step' THEN 0 ELSE 1 END) AS turns,coalesce(sum(input_tokens),0) AS i,coalesce(sum(output_tokens),0) AS o"
                    " FROM turn_usage WHERE created_at>=? AND bot_id!='' GROUP BY bot_id ORDER BY sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)) DESC", day)
    sandbox = ctx.parts.get("sandbox")  # kein Netz: zählt nur die zuletzt genutzten Plätze im Speicher
    active = len(sandbox.active()) if sandbox else 0
    return {"ok": True, "budget": budget, "jev": {"spentUsd": round(spent * 10000) / 10000, "state": state, "percent": percent},
            "sandboxes": {"active": active, "max": budget["maxSandboxes"], "waiting": active >= budget["maxSandboxes"]},
            "tokens": [{"botId": r["bot_id"], "turns": r["turns"], "inputTokens": r["i"], "outputTokens": r["o"], "totalTokens": r["i"] + r["o"]} for r in tokens]}


@route("GET", "/v1/budget")
async def get_budget(req: Req):
    return _overview(req.ctx)


@route("PUT", "/v1/budget")
async def put_budget(req: Req):
    if not isinstance(req.body, dict):
        raise Fail("Ungültiges Tagesbudget.")
    body, db = req.body, req.ctx.db
    new = _budget(db)
    if "jevDailyUsd" in body:
        if not _num(body["jevDailyUsd"], "jevDailyUsd"):
            raise Fail("Das Tagesbudget für Jev muss zwischen 0 und 50 US-Dollar liegen.")
        new["jevDailyUsd"] = round(body["jevDailyUsd"] * 100) / 100
    if "maxSandboxes" in body:
        if not _num(body["maxSandboxes"], "maxSandboxes", True):
            raise Fail("Die Zahl gleichzeitiger Sandboxes muss zwischen 1 und 10 liegen.")
        new["maxSandboxes"] = int(body["maxSandboxes"])
    db.run("INSERT OR REPLACE INTO app_kv (key,value,updated_at) VALUES ('budget',?,?)", dumps(new), now_ms())
    return _overview(req.ctx)


async def _key_status() -> list[dict]:
    """Nur Name, Anzeigename, gesetzt ja/nein und Quelle; nie ein Wert."""
    out = []
    for name, label in keychain.MANAGED_KEYS:
        is_set = bool((await keychain.get(name) or "").strip())
        out.append({"name": name, "label": label, "set": is_set, "source": "schluesselbund" if is_set else None, "liveReload": True})
    return out


@route("GET", "/v1/keys")
async def list_keys(req: Req):
    return {"ok": True, "keys": await _key_status()}


@route("PUT", "/v1/keys/{name}")
async def save_key(req: Req):
    """Daytona- und Jev-Schlüssel darf die App jederzeit setzen; Composio nur in getrennten Profilen."""
    name, key = req.params["name"], req.obj().get("key")
    managed = {n for n, _ in keychain.MANAGED_KEYS}
    if name == "COMPOSIO_API_KEY" and not isolated_dir():
        raise Fail("Schlüssel lassen sich hier nur für ein getrenntes Orbit-Profil ändern.")
    if name not in managed | {"COMPOSIO_API_KEY"}:
        raise Fail("Unbekannter Schlüssel.")
    if not isinstance(key, str) or not 1 <= len(key.strip()) <= 4096 or any(ord(c) < 32 for c in key):
        raise Fail("Gib einen gültigen Schlüssel ein.")
    try:
        if name == "COMPOSIO_API_KEY":
            from ..tools.composio import composio
            from ..config import profile_id
            await composio.verify({"key": key.strip(), "user": f"orbit-{profile_id()}"})
        await keychain.set_item(keychain.SERVICE, name, key.strip())
        if name == "COMPOSIO_API_KEY":
            composio.reload()
    except (OSError, ValueError):
        raise Fail("Der Schlüssel konnte nicht im Schlüsselbund gespeichert werden.") from None
    hook = req.ctx.parts.get("keys_reloaded")
    if hook:
        hook([name])
    return {"ok": True, "set": True}


@route("POST", "/v1/keys/reload")
async def reload_keys(req: Req):
    asked = req.obj().get("names")
    known = [n for n, _ in keychain.MANAGED_KEYS]
    names = [n for n in asked if n in known] if isinstance(asked, list) else known
    keychain.forget(names)
    for name in names:
        await keychain.get(name)
    hook = req.ctx.parts.get("keys_reloaded")  # Laufzeit setzt hier z. B. ihre Clients zurück
    if hook:
        hook(names)
    return {"ok": True, "keys": await _key_status(), "needsRestart": []}


@route("GET", "/v1/search")
async def search(req: Req):
    q = req.query.get("q", "").strip()
    if not q:
        raise Fail("Gib einen Suchbegriff ein.")
    if len(q) > 200:
        raise Fail("Die Suche darf höchstens 200 Zeichen lang sein.")
    now = time.time()
    attempts = [t for t in req.ctx.parts.setdefault("search_attempts", []) if now - t < 60]
    if len(attempts) >= 30:
        req.ctx.parts["search_attempts"] = attempts
        raise Fail("Zu viele Suchen. Bitte warte eine Minute.")
    req.ctx.parts["search_attempts"] = [*attempts, now]
    terms = re.findall(r"\w+", q)
    if not terms:
        return {"ok": True, "results": [], "indexing": False}
    # shortcut: kein Nachindexieren alter Chats hier (das gehört zum Chat-Teil); indexing bleibt false.
    try:
        rows = req.ctx.db.all(
            "SELECT c.id AS chatId, coalesce(c.name,(SELECT min(b.name) FROM chat_members cm JOIN bots b ON b.id=cm.bot_id WHERE cm.chat_id=c.id)) AS chatName,"
            " (SELECT min(b.avatar) FROM chat_members cm JOIN bots b ON b.id=cm.bot_id WHERE cm.chat_id=c.id) AS avatar,"
            " (SELECT min(b.color) FROM chat_members cm JOIN bots b ON b.id=cm.bot_id WHERE cm.chat_id=c.id) AS color,"
            " m.role AS role, substr(m.id,length(m.chat_id)+2) AS messageId, snippet(chat_messages_fts,0,'<<','>>',' … ',24) AS snippet,"
            " m.created_at AS createdAt, bm25(chat_messages_fts) AS rank"
            " FROM chat_messages_fts JOIN chat_messages_index m ON m.rowid=chat_messages_fts.rowid JOIN chats c ON c.id=m.chat_id"
            " WHERE chat_messages_fts MATCH ? AND m.user_id=? AND c.user_id=? ORDER BY rank, m.created_at DESC LIMIT 20",
            " AND ".join(f'"{t}"' for t in terms), USER, USER)
    except sqlite3.Error:
        raise Fail("Die Suche ist gerade nicht verfügbar.") from None
    return {"ok": True, "indexing": False, "results": [{**dict(r), "createdAt": iso(r["createdAt"])} for r in rows]}


@route("GET", "/v1/jev")
async def jev_log(req: Req):
    rows = req.ctx.db.all("SELECT * FROM jev_log WHERE user_id=? ORDER BY created_at DESC LIMIT 50", USER)
    return {"ok": True, "entries": [
        {"id": r["id"], "userId": r["user_id"], "chatId": r["chat_id"], "kind": r["kind"], "model": r["model"], "reason": r["reason"],
         "durationMs": r["duration_ms"], "payload": loads(r["payload"]), "costUsd": r["cost_usd"], "createdAt": iso(r["created_at"])} for r in rows]}
