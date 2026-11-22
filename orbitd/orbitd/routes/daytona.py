"""Desktop-Vorschau eines Orbis und ausdrücklich vom Nutzer übernommene Sitzungen."""
import asyncio
import re

from .. import automations, keychain
from ..config import isolated_dir
from ..db import loads, new_id, now_ms
from ..tools import daytona
from ..web import Fail, Req, route


def _bot(req: Req):
    bot = req.ctx.db.one("SELECT id, sandbox_id FROM bots WHERE id=? AND user_id='local' AND archived_at IS NULL", req.params["botId"])
    if bot is None:
        raise Fail("Orbi nicht gefunden.")
    return bot


def _sandbox(req: Req, bot) -> daytona.Sandbox:
    if req.ctx.cfg.fake_sandbox or daytona.is_fake(bot["sandbox_id"]):
        raise Fail("Dieser Orbi hat keinen Computer.")
    return daytona.get(req.ctx)


@route("PUT", "/v1/daytona/{botId}/key")
async def save_verified_key(req: Req):
    if isolated_dir() is None:
        raise Fail("Schlüssel lassen sich hier nur für ein getrenntes Orbit-Profil ändern.")
    _bot(req)
    key = req.obj().get("key")
    if not isinstance(key, str) or not re.fullmatch(r"[!-~]{1,4096}", key.strip()):
        raise Fail("Gib einen gültigen Daytona-Schlüssel ein.")
    key = key.strip()
    linked = req.ctx.db.all("SELECT DISTINCT sandbox_id FROM bots WHERE user_id='local' AND archived_at IS NULL")
    sandbox_ids = [row["sandbox_id"] for row in linked if not daytona.is_fake(row["sandbox_id"])]
    sandbox = daytona.get(req.ctx)
    # Der Schlüssel gilt für das ganze Profil, deshalb müssen verknüpfte Computer erreichbar bleiben.
    await asyncio.gather(*(sandbox.verify_key(key, sandbox_id) for sandbox_id in sandbox_ids or [None]))
    try:
        await keychain.set_item(keychain.SERVICE, "DAYTONA_API_KEY", key)
    except (OSError, ValueError):
        raise Fail("Der Daytona-Schlüssel konnte nicht gespeichert werden.") from None
    return {"ok": True, "set": True}


@route("GET", "/v1/daytona/{botId}/desktop-status")
async def desktop_status(req: Req):
    bot = _bot(req)
    if req.ctx.cfg.fake_sandbox or daytona.is_fake(bot["sandbox_id"]):
        return {"ok": True, "state": "unconfigured"}
    hold = req.ctx.db.val("SELECT id FROM desktop_holds WHERE bot_id=?", bot["id"])
    if hold:
        return {"ok": True, "state": "taken", "takeoverId": hold}
    # Lokal „aus“ zählt vor Daytona: sonst bleibt die Karte auf „läuft“, obwohl der Orbi ausgeschaltet hat.
    if daytona.is_marked_off(req.ctx, bot["id"]):
        return {"ok": True, "state": "sleeping"}
    state = await _sandbox(req, bot).desktop_state(bot["sandbox_id"])
    # Daytona „stopped“ einmal gesehen → lokal festhalten (Daytona meldet danach manchmal wieder „started“).
    if state == "sleeping":
        daytona.mark_off(req.ctx, bot["id"])
    return {"ok": True, "state": state}


@route("GET", "/v1/daytona/{botId}/desktop-url")
async def desktop_url(req: Req):
    bot = _bot(req)
    sandbox = _sandbox(req, bot)
    async with sandbox.operation(bot["sandbox_id"]):
        # Vorschau weckt bewusst (Consti öffnet den Computer); Markierung „aus“ fällt.
        if req.query.get("viewOnly") == "1":
            url = await sandbox.desktop_url(bot["sandbox_id"], view_only=True)
        else:  # Legacy-App vor dem expliziten Rückgabe-Ablauf
            url = await sandbox.desktop_url(bot["sandbox_id"])
    daytona.clear_off(req.ctx, bot["id"])
    daytona.notify_desktop(req.ctx, bot["id"], "running")
    return {"ok": True, "url": url}


@route("POST", "/v1/daytona/{botId}/takeover")
async def take_desktop(req: Req):
    bot = _bot(req)
    sandbox = _sandbox(req, bot)
    request_id = req.obj().get("requestId")
    if request_id is not None and (not isinstance(request_id, str) or not request_id):
        raise Fail("Die Bitte zur Übernahme wurde nicht gefunden.")
    async with sandbox.operation(bot["sandbox_id"]):
        db = req.ctx.db
        current = db.one("SELECT id, request_id FROM desktop_holds WHERE bot_id=?", bot["id"])
        if current and request_id and current["request_id"] not in (None, request_id):
            raise Fail("Gib den Computer zuerst zurück.")
        if request_id:
            request = loads(db.val("SELECT request FROM pending_interactions WHERE id=? AND bot_id=? AND kind='ask' AND expires_at>?",
                                   request_id, bot["id"], now_ms()), {})
            if not (request.get("input") or {}).get("computerTakeover"):
                raise Fail("Die Bitte zur Übernahme ist nicht mehr offen.")
        # Erst wenn laufende Orbit-Zugriffe beendet sind und die Vorschau bereit ist, kann der Nutzer eingreifen.
        url = await sandbox.desktop_url(bot["sandbox_id"])
        hold_id = current["id"] if current else new_id()
        with db.tx():
            if current is None:
                db.run("INSERT INTO desktop_holds (bot_id,id,request_id,taken_at) VALUES (?,?,?,?)", bot["id"], hold_id, request_id, now_ms())
            elif request_id and not current["request_id"]:
                db.run("UPDATE desktop_holds SET request_id=? WHERE id=?", request_id, hold_id)
            if request_id:
                db.run("UPDATE pending_interactions SET expires_at=max(expires_at, ?) WHERE id=?", now_ms() + 3_600_000, request_id)
    daytona.notify_desktop(req.ctx, bot["id"], "taken", hold_id)
    return {"ok": True, "url": url, "takeoverId": hold_id}


@route("POST", "/v1/daytona/{botId}/return")
async def return_desktop(req: Req):
    bot = _bot(req)
    sandbox = _sandbox(req, bot)
    hold_id = req.obj().get("takeoverId")
    if not isinstance(hold_id, str) or not hold_id:
        raise Fail("Diese Übernahme wurde nicht gefunden.")
    returned = False
    async with sandbox.operation(bot["sandbox_id"]):
        db = req.ctx.db
        request = db.one("SELECT h.request_id, p.request FROM desktop_holds h LEFT JOIN pending_interactions p"
                         " ON p.id=h.request_id AND p.bot_id=h.bot_id AND p.expires_at>? WHERE h.bot_id=? AND h.id=?",
                         now_ms(), bot["id"], hold_id)
        interactions = req.ctx.parts.get("interactions")
        if request and request["request"] and interactions:
            card = loads(request["request"], {})
            questions = (card.get("input") or {}).get("questions") or []
            if questions:
                await interactions.answer(request["request_id"], {"answers": [
                    {"question": questions[0]["question"], "answers": ["Computer zurückgegeben"]},
                ]})
        with db.tx():
            returned = db.run("DELETE FROM desktop_holds WHERE bot_id=? AND id=?", bot["id"], hold_id) == 1
            if returned:
                automations.record_computer_return(db, bot["id"], hold_id)
    if returned:
        try:
            state = await sandbox.desktop_state(bot["sandbox_id"])
        except Fail:
            state = "unknown"
        daytona.notify_desktop(req.ctx, bot["id"], state)
    return {"ok": True, "returned": returned}


@route("POST", "/v1/daytona/{botId}/sleep")
async def sleep_desktop(req: Req):
    bot = _bot(req)
    sandbox = _sandbox(req, bot)
    async with sandbox.operation(bot["sandbox_id"]):
        if req.ctx.db.val("SELECT 1 FROM desktop_holds WHERE bot_id=?", bot["id"]):
            raise Fail("Gib den Computer zuerst zurück.")
        await sandbox.sleep_desktop(bot["sandbox_id"])
    daytona.mark_off(req.ctx, bot["id"])
    daytona.notify_desktop(req.ctx, bot["id"], "sleeping")
    return {"ok": True}
