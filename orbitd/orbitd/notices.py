"""System-Mitteilungen aus Dienst-Ereignissen (Freigaben, Fragen, fertige Läufe/Routinen).

Hängt am Bus; zeigt nur, wenn die App nicht vorn ist und die Profil-Schalter es erlauben.
Darstellung über dieselbe JXA-Mitteilung wie mac_notify (kein eigener Daemon).
"""
from __future__ import annotations

import asyncio
import logging

from .routes.settings import profile_preferences

log = logging.getLogger("orbitd.notices")
SEEN_CAP = 400


class Notices:
    def __init__(self, ctx):
        self.ctx = ctx
        self.app_active = False  # bis die Oberfläche meldet, dass sie vorn ist
        self.seen: set[str] = set()
        self._tasks: set[asyncio.Task] = set()
        ctx.bus.listeners.append(self._on)

    def set_active(self, active: bool) -> None:
        self.app_active = bool(active)

    def stop(self) -> None:
        try:
            self.ctx.bus.listeners.remove(self._on)
        except ValueError:
            pass
        for t in list(self._tasks):
            t.cancel()

    def _on(self, event: dict) -> None:
        try:
            notice = self._plan(event)
        except Exception:
            log.exception("Mitteilungsplan gescheitert")
            return
        if not notice:
            return
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            return
        task = loop.create_task(self._show(*notice))
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def _plan(self, event: dict) -> tuple[str, str, bool] | None:
        if self.app_active:
            return None
        prefs = profile_preferences(self.ctx.db)
        sound = bool(prefs.get("sound", True))
        kind = event.get("type")
        if kind in ("approval", "question") and event.get("status", "pending") == "pending":
            if not prefs.get("notificationsApprovals", True):
                return None
            id_ = event.get("id")
            if not id_ or id_ in self.seen:
                return None
            self.seen.add(id_)
            self._trim()
            name = self._bot_name(event)
            if kind == "approval":
                return f"{name} braucht deine Freigabe", f"Werkzeug: {event.get('tool') or '—'}", sound
            return f"{name} hat eine Frage", "Antworte in Orbit.", sound
        if kind == "status" and event.get("status") == "fertig":
            if not prefs.get("notificationsDone", True):
                return None
            # status-Ereignisse haben keine stabile ID — dedupe über chat+bot solange „arbeitet“ nicht neu startet
            id_ = f"done:{event.get('chatId')}:{event.get('botId')}"
            if id_ in self.seen:
                return None
            self.seen.add(id_)
            if len(self.seen) > SEEN_CAP:
                self.seen.clear()
                self.seen.add(id_)
            name = self._bot_name(event)
            return f"{name} ist fertig", "Die Antwort liegt in Orbit.", sound
        if kind == "automation" and event.get("status") in ("ok", "error"):
            if not prefs.get("notificationsDone", True):
                return None
            run_id = event.get("runId")
            if not run_id or run_id in self.seen:
                return None
            row = self.ctx.db.one(
                "SELECT a.name, a.notify FROM automations a WHERE a.id=?", event.get("automationId"))
            if not row or row["notify"] != "app":
                return None
            self.seen.add(run_id)
            ok = event.get("status") == "ok"
            title = f"„{row['name']}“ ist fertig" if ok else f"„{row['name']}“ ist fehlgeschlagen"
            body = "Die Automation ist gelaufen." if ok else (event.get("error") or "Der Lauf endete mit einem Fehler.")
            return title, body, sound
        if kind == "status" and event.get("status") == "arbeitet":
            # neuer Lauf: „fertig“-Marke für diesen Chat/Orbi freigeben
            self.seen.discard(f"done:{event.get('chatId')}:{event.get('botId')}")
        return None

    def _trim(self) -> None:
        if len(self.seen) <= SEEN_CAP:
            return
        open_ids = {r["id"] for r in self.ctx.db.all("SELECT id FROM pending_interactions")}
        self.seen = {x for x in self.seen if x in open_ids or x.startswith("done:") or len(x) == 32}

    def _bot_name(self, event: dict) -> str:
        frm = event.get("from")
        if isinstance(frm, dict) and frm.get("name"):
            return str(frm["name"])
        bot_id = event.get("botId")
        if bot_id:
            name = self.ctx.db.val("SELECT name FROM bots WHERE id=?", bot_id)
            if name:
                return name
        return "Ein Orbi"

    async def _show(self, title: str, body: str, sound: bool) -> None:
        # Tests und Fake-Betrieb: keine echten System-Mitteilungen (osascript hängt sonst).
        if getattr(self.ctx.cfg, "fake_cli", None) or getattr(self.ctx.cfg, "fake_sandbox", False):
            return
        try:
            from .tools.mac.tools import osascript
            await osascript(
                "function run(argv){const a=JSON.parse(argv[0]);const app=Application.currentApplication();"
                "app.includeStandardAdditions=true;const o={withTitle:a.title};"
                "if(a.sound)o.soundName='Glass';app.displayNotification(a.text,o);return '{}'}",
                {"title": title, "text": body, "sound": bool(sound)},
            )
        except Exception as e:
            log.info("Mitteilung nicht gezeigt (%s)", type(e).__name__)


def start(ctx) -> Notices:
    notices = Notices(ctx)
    ctx.parts["notices"] = notices
    return notices


def stop(ctx) -> None:
    n = ctx.parts.pop("notices", None)
    if n:
        n.stop()
