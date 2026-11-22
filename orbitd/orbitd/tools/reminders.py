"""Apple Erinnerungen über die Mac-App: Werkzeuge legen einen Auftrag ab, die App holt ihn über /v1/reminders/*. Vorlage: service/src/reminders.ts.

Ein Auftrag wird höchstens einmal an die App übergeben. Läuft die Zeit ab oder wird abgebrochen, nachdem die App ihn geholt hat,
heißt es ausdrücklich „nicht bestätigt“ (kein automatischer zweiter Versuch), und die App bekommt `reminders-cancelled`.
"""
import asyncio
import json
from datetime import datetime

from ..db import new_id
from ..runtime.contract import tool
from ..web import Fail
from .brain import frame

MAX_OPEN, TIMEOUT_S, MAX_ITEMS = 16, 90, 100
UNCERTAIN = "Ergebnis nicht bestätigt. Prüfe Erinnerungen, bevor du es erneut versuchst."


def _result(body) -> dict | None:
    """Prüft die Antwort der App und liefert nur bekannte Felder; None bei ungültiger Form."""
    if not isinstance(body, dict):
        return None
    if body.get("ok") is False:
        error = body.get("error")
        return {"ok": False, "error": error} if isinstance(error, str) and len(error) <= 500 else None
    if body.get("ok") is not True:
        return None
    out: dict = {"ok": True}
    items = body.get("items")
    if items is not None:
        if not isinstance(items, list) or len(items) > MAX_ITEMS:
            return None
        for i in items:
            if not (isinstance(i, dict) and isinstance(i.get("title"), str) and len(i["title"]) <= 500 and isinstance(i.get("list"), str) and len(i["list"]) <= 200
                    and (i.get("due") is None or (isinstance(i["due"], str) and len(i["due"]) <= 64)) and isinstance(i.get("completed"), bool)):
                return None
        out["items"] = [{k: i.get(k) for k in ("title", "list", "due", "completed")} for i in items]
    if body.get("truncated") is not None:
        if not isinstance(body["truncated"], bool):
            return None
        out["truncated"] = body["truncated"]
    return out


class ReminderBridge:
    def __init__(self, ctx, timeout: float = TIMEOUT_S):
        self.ctx, self.timeout = ctx, timeout
        self.pending: dict[str, dict] = {}  # id -> {task, claimed, future}

    async def submit(self, task: dict) -> dict:
        if len(self.pending) >= MAX_OPEN:
            return {"ok": False, "error": "Zu viele offene Erinnerungsaufträge."}
        rid, future = new_id(), asyncio.get_running_loop().create_future()
        self.pending[rid] = {"task": task, "claimed": False, "future": future}
        self.ctx.bus.publish({"type": "reminders-pending"})
        try:
            return await asyncio.wait_for(asyncio.shield(future), self.timeout)
        except (asyncio.TimeoutError, asyncio.CancelledError) as e:
            claimed = self.pending.pop(rid, {}).get("claimed")
            if claimed:
                self.ctx.bus.publish({"type": "reminders-cancelled", "id": rid})
            if isinstance(e, asyncio.CancelledError):
                raise
            return {"ok": False, "error": UNCERTAIN if claimed else "Die Mac-App hat den Auftrag nicht übernommen. Läuft Orbit?"}
        finally:
            self.pending.pop(rid, None)

    def claim(self) -> dict | None:
        for rid, e in self.pending.items():
            if not e["claimed"]:
                e["claimed"] = True
                return {"id": rid, "task": e["task"]}
        return None

    def is_active(self, rid: str) -> bool:
        return bool(self.pending.get(rid, {}).get("claimed"))

    def complete(self, rid: str, body) -> bool:
        e, result = self.pending.get(rid), _result(body)
        if not e or not e["claimed"] or result is None or e["future"].done():
            return False
        e["future"].set_result(result)
        return True


def bridge(ctx) -> ReminderBridge:
    return ctx.parts.setdefault("reminders", ReminderBridge(ctx))


@tool("apple_reminders_list", "Liest bis zu 100 Erinnerungen aus Apple Erinnerungen, optional aus einer benannten Liste.",
      {"type": "object", "properties": {"list": {"type": "string", "minLength": 1, "maxLength": 200}}},
      label=lambda a: f"Liest Erinnerungen: {a['list']}" if a.get("list") else "Liest Erinnerungen")
async def reminders_list(run, args):
    run.counters["eigen"] = True
    out = await bridge(run.ctx).submit({"kind": "list", **({"list": args["list"].strip()} if args.get("list") else {})})
    if not out["ok"]:
        raise Fail(out["error"])
    return frame("apple_reminders_list", json.dumps(out, ensure_ascii=False))


@tool("apple_reminders_create", "Legt eine Erinnerung in Apple Erinnerungen an, optional mit Liste und Fälligkeit.",
      {"type": "object", "properties": {"title": {"type": "string", "minLength": 1, "maxLength": 500}, "list": {"type": "string", "minLength": 1, "maxLength": 200},
                                        "due": {"type": "string", "description": "ISO 8601 mit Zeitzone, z. B. 2026-11-13T09:00:00+01:00"}}, "required": ["title"]},
      label=lambda a: f"Legt Erinnerung an: {a['title'].strip()}" if isinstance(a.get("title"), str) and a["title"].strip() else "Legt eine Erinnerung an …")
async def reminders_create(run, args):
    task = {"kind": "create", "title": args["title"].strip()}
    if args.get("list"):
        task["list"] = args["list"].strip()
    if args.get("due"):
        try:
            if datetime.fromisoformat(args["due"].replace("Z", "+00:00")).tzinfo is None:
                raise ValueError
        except ValueError:
            raise Fail("Die Fälligkeit braucht Datum, Uhrzeit und Zeitzone (ISO 8601).") from None
        task["due"] = args["due"]
    out = await bridge(run.ctx).submit(task)
    if not out["ok"]:
        raise Fail(out["error"])
    return {"ok": True}
