"""Zeitgeber der Routinen: alle 30 s fällige Routinen übernehmen und starten; verpasste (Dienst war aus) werden zur Fragekarte.

Übernehmen ist atomar: `UPDATE … WHERE next_run_at = <gesehener Termin>` setzt zugleich den nächsten Termin, nur der Gewinner startet.
Verpasst = Termin lag beim Tick mehr als 2 Minuten zurück. Dann läuft nichts nach; eine Karte `missed:<routine>:<termin>` fragt Consti.
"""
import asyncio
import logging

from ..db import dumps, loads, now_ms
from ..schedule import COMPUTER_RETURNED, next_run
from ..web import Fail
from . import contract

from .. import automations as store, background

log = logging.getLogger("orbitd")
TICK_S = 30.0
MISSED_AFTER_MS = 120_000
PREFIX, RUN, SKIP = "missed:", "Ausführen", "Überspringen"


def missed_card(db, bus, a, due: int, t: int) -> None:
    """Genau eine Karte je Routine und Termin (die Karten-ID ist der Schlüssel). Auch der Wiederanlauf legt sie an."""
    from .. import automations as store
    chat_id = store._direct_chat(db, a["bot_id"])
    if not chat_id:
        return
    id_ = f"{PREFIX}{a['id']}:{due}"
    question = f"„{a['name']}“ wurde nicht ausgeführt (der Dienst war aus). Jetzt ausführen?"
    card = {"id": id_, "kind": "ask", "chatId": chat_id, "botId": a["bot_id"], "toolCallId": id_, "tool": "ask_user",
            "input": {"questions": [{"question": question, "options": [{"label": RUN, "recommended": True}, {"label": SKIP}]}],
                      "missedRoutine": {"name": a["name"], "dueAt": store.iso(due)}},
            "requestedAt": t, "expiresAt": t + contract.INTERACTION_TTL_MS}
    if db.run("INSERT OR IGNORE INTO pending_interactions (id,chat_id,bot_id,kind,request,requested_at,expires_at) VALUES (?,?,?,?,?,?,?)",
              id_, chat_id, a["bot_id"], "ask", dumps(card), t, card["expiresAt"]) == 1:
        bus.publish({"type": "question", **card, "status": "pending"})


class Timer:
    def __init__(self, ctx, runtime, now=now_ms):
        self.ctx, self.db, self.runtime, self.now = ctx, ctx.db, runtime, now  # now: im Test einstellbar
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        # Der Dienst ist alleiniger Besitzer der Läufe: beim Start sind offene Läufe verwaist.
        self.db.run("UPDATE automation_runs SET status='error', error='Dienst wurde beendet.', finished_at=? WHERE status IN ('running','waiting')", self.now())
        interactions = self.ctx.parts.get("interactions")
        if interactions:
            interactions.handlers[PREFIX] = self.answered
        await self.tick()
        self._task = asyncio.create_task(self._loop())

    async def stop(self) -> None:
        task, self._task = self._task, None
        if task:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(TICK_S)
            try:
                await self.tick()
                from ..routes.settings import profile_preferences
                if profile_preferences(self.db).get("backgroundWork", True):
                    background.tick(self.ctx, self.now())  # Träumer; startet nur Hintergrund-Aufgaben
            except Exception:
                log.exception("Zeitgeber-Tick gescheitert")

    async def tick(self) -> None:
        from ..routes.settings import profile_preferences
        db, t = self.db, self.now()
        if not profile_preferences(db).get("backgroundWork", True):
            return  # Schalter aus: keine geplanten Läufe, keine Computer-zurück-Ereignisse
        for a in db.all(f"SELECT a.* FROM automations a WHERE enabled=1 AND deleted_at IS NULL AND paused_reason IS NULL AND next_run_at<=? AND {store.HAS_BOT}", t):  # ohne Orbi: unangetastet
            due, following = a["next_run_at"], next_run(loads(a["schedule"]), a["timezone"], t)
            # Einmalige Routinen enden nach dem Start (ohne Folgetermin ebenso).
            if db.run("UPDATE automations SET next_run_at=coalesce(?,next_run_at), enabled=? WHERE id=? AND next_run_at=? AND enabled=1",
                      following, int(following is not None), a["id"], due) != 1:
                continue
            try:
                if t - due > MISSED_AFTER_MS:
                    self._ask(a, due)
                else:
                    await self.runtime.run_automation(a["id"], "schedule", due)
            except Fail as e:
                log.info("Routine %s: Termin ausgelassen (%s)", a["id"], e)
            except Exception:
                log.exception("Routine %s nicht gestartet", a["id"])
        await self._events()

    async def _events(self) -> None:
        db = self.db
        for event in db.all("SELECT e.id, a.id AS automation_id, a.schedule, a.enabled, a.deleted_at, a.paused_reason"
                            " FROM automation_events e JOIN automations a ON a.id=e.automation_id ORDER BY e.id"):
            row_id, automation_id = event["id"], event["automation_id"]
            schedule = loads(event["schedule"], {}) or {}
            runnable = (event["enabled"] and event["deleted_at"] is None and event["paused_reason"] is None
                        and schedule.get("kind") == "event" and schedule.get("event") == COMPUTER_RETURNED)
            key = f"{COMPUTER_RETURNED}:{automation_id}:{row_id}"
            if runnable and not db.val("SELECT 1 FROM inbox_items WHERE dedupe_key=?", key):
                try:
                    await self.runtime.run_automation(automation_id, COMPUTER_RETURNED, row_id)
                except Fail:
                    # Ist derselbe Lauf nach einem Neustart schon verbucht, bleibt seine Zustellung eindeutig.
                    if not db.val("SELECT 1 FROM inbox_items WHERE dedupe_key=?", key):
                        continue
            db.run("DELETE FROM automation_events WHERE id=?", row_id)

    def _ask(self, a, due: int) -> None:
        missed_card(self.db, self.ctx.bus, a, due, self.now())

    async def answered(self, id_: str, body) -> None:
        """Antwort auf die Karte; die Karte selbst schließt Interactions.answer."""
        answers = body.get("answers") if isinstance(body, dict) else None
        chosen = answers[0].get("answers") if answers and isinstance(answers[0], dict) else None
        if chosen and RUN in chosen:
            automation_id, _, due = id_[len(PREFIX):].rpartition(":")
            await self.runtime.run_automation(automation_id, "missed", int(due))
