"""Die Laufzeit (Vertrag „runtime“ in contract.py): nimmt Nachrichten an, verteilt sie über das Postfach an die Worker der Orbis.

Muster: regnull/openbot runtime/actors.py (Worker je Orbi, Postfach) und Orbits alter Dienst (service/src/chat/lane.ts).

Wave 2A (Word 1.17, 4.1, 4.40-4.42): every live run is indexed by run ID (`by_id`); `runs` keeps the one foreground run per
chat for compatibility. Durable child workers (work_runs.kind='worker') run beside the foreground without the inbox, in the
background lane: at most MAX_PARALLEL_RUNS-1 of them, so one slot always stays free for the interactive lane. A user request
is accepted in the ledger before dispatch; a chat stop cancels the request tree (ledger.cancel_root) and every descendant.
"""
import asyncio
import logging
import re

from starlette.responses import Response

from .. import automations as store
from .. import chatstore, cli
from ..db import dumps, loads, new_id, now_ms
from ..web import Fail, HttpError
from . import contract, inbox, ledger, recovery
from .actors import Actor
from .runner import RESUME_HINT, RESUME_TASK, Runner

OLD_RESUME_HINT = "Dein letzter Lauf wurde durch einen Neustart unterbrochen."  # queued before the English revision
from .streams import Streams, empty_response

log = logging.getLogger("orbitd")
BUSY = "An answer is already running in this chat."
INVALID = "Invalid request."
TICK_S = 3.0
BACKGROUND_SLOTS = max(1, contract.MAX_PARALLEL_RUNS - 1)  # the interactive lane always keeps at least one slot
LIVE = ("queued", "running", "waiting")
STALL_MS = 2 * 60_000  # CheckSubagent marks a running child without a sign of life as stalled


FOLLOW_UPS = 3  # @-Nachlauf-Züge je Nutzer-Nachricht


def _skill_meta(data: dict) -> dict | None:
    s = data.get("skill")
    return {"skill": {"name": s["name"].strip(), "source": s.get("source")}} if isinstance(s, dict) and isinstance(s.get("name"), str) and s["name"].strip() else None


class Runtime:
    def __init__(self, ctx):
        self.ctx, self.db = ctx, ctx.db
        self.streams = Streams()
        self.adapters = ctx.parts.get("adapters") or cli.adapters(ctx.cfg.fake_cli)
        self.slots = asyncio.Semaphore(contract.MAX_PARALLEL_RUNS)
        self.bg_slots = asyncio.Semaphore(BACKGROUND_SLOTS)
        self.actors: dict[str, Actor] = {}
        self.runs: dict[str, Runner] = {}     # chat_id -> live foreground run (compatibility view)
        self.by_id: dict[str, Runner] = {}    # run_id -> every live run (foreground and children)
        self.child_tasks: dict[str, asyncio.Task] = {}
        self.waiters: dict[str, asyncio.Future] = {}
        self.after_run: list = [self._automation_done]
        self.closing = False
        self._ticker: asyncio.Task | None = None

    # ------------------------------------------------------------ Start und Stopp
    async def start(self) -> None:
        await recovery.recover(self)
        self._ticker = asyncio.create_task(self._tick())
        self.wake()

    async def shutdown(self) -> None:
        self.closing = True
        if self._ticker:
            self._ticker.cancel()
        for runner in list(self.by_id.values()):
            if runner.task and not runner.finalizing:  # wer schon abschließt, wird nicht unterbrochen
                runner.task.cancel()
        for task in list(self.child_tasks.values()):
            task.cancel()
        await asyncio.gather(*(r.finished.wait() for r in list(self.by_id.values())), return_exceptions=True)
        await asyncio.gather(*list(self.child_tasks.values()), return_exceptions=True)
        await asyncio.gather(*(a.stop() for a in self.actors.values()), return_exceptions=True)

    async def _tick(self) -> None:
        while True:
            await asyncio.sleep(TICK_S)  # holt auch Einträge ab, deren Zeit (due_at) erst jetzt gekommen ist
            self.wake()

    def wake(self, bot_id: str | None = None) -> None:
        if self.closing:
            return
        for id_ in [bot_id] if bot_id else inbox.waiting_bots(self.db):
            actor = self.actors.get(id_)
            if actor is None:
                actor = self.actors[id_] = Actor(self, id_)
            actor.wake()

    # ------------------------------------------------------------ einen Lauf starten (vom Worker gerufen)
    async def run_next(self, bot_id: str) -> bool:
        db = self.db
        items = inbox.pick(db, bot_id)
        if not items:
            return False
        chat_id = items[0]["chat_id"]
        bot = db.one("SELECT * FROM bots WHERE id=?", bot_id)
        chat = db.one("SELECT * FROM chats WHERE id=?", chat_id)
        if not bot or not chat:
            db.run("UPDATE inbox_items SET status='failed', updated_at=? WHERE id IN (%s)" % ",".join("?" * len(items)), now_ms(), *[i["id"] for i in items])
            self.close_if_idle(chat_id)
            return True
        bot, chat = dict(bot), dict(chat)
        data = self._client_data(items, bot_id, chat_id)
        model, effort, jev, error = await self._choose(bot, chat, items, data, lane="interactive")
        fast = model.get("fast") if model and data.get("fast") is True else None
        run_id = new_id()
        payload0 = items[0]["payload"]
        root = {"chatId": payload0.get("rootChatId") or chat_id, "taskId": payload0.get("taskId") or run_id}
        session = self._session(chat_id, bot_id, model["cli"]) if model else None
        t = now_ms()
        with db.tx():
            claimed = inbox.claim(db, items, run_id)
            if not claimed:
                return True
            identity = self._identity(bot_id, chat_id, claimed, run_id, root)
            db.run("INSERT INTO work_runs (id,kind,chat_id,bot_id,status,payload,steps,started_at,updated_at,inbox_item_id,"
                   "root_run_id,owner_bot_id,origin_chat_id,origin_message_id,thread_root_id,role,lane,principal_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                   run_id, "turn", chat_id, bot_id, "running",
                   dumps({"model": model["id"] if model else None, "effort": effort, "cli": model["cli"] if model else None,
                          "wanted": data.get("model") or "auto", "wantedEffort": data.get("effort"), "wantedFast": data.get("fast") is True,  # Wunsch getrennt vom Ergebnis: Auto bleibt Auto
                          "taskId": root["taskId"], "rootChatId": root["chatId"], "lane": "interactive", "requestId": identity["request_id"]}),
                   0, t, t, claimed[0]["id"], identity["root_run_id"], bot_id, chat_id, identity["origin_message_id"],
                   identity["thread_root_id"], "foreground", "interactive", "local")
        runner = Runner(self, run_id, bot, chat, claimed, model, effort, root, jev, session, error, fast, identity=identity)
        self.runs[chat_id] = runner
        self.by_id[run_id] = runner
        task = runner.task = asyncio.create_task(runner.run())
        await asyncio.sleep(0)  # der Lauf beginnt, bevor ein Stopp ihn erreichen kann
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            raise
        finally:
            if self.runs.get(chat_id) is runner:
                del self.runs[chat_id]
            self.by_id.pop(run_id, None)
            self.wake()
        return True

    def _identity(self, bot_id: str, chat_id: str, items: list[dict], run_id: str, root: dict) -> dict:
        """WorkIdentity of a foreground run. Inside the claim transaction: a user request is accepted (or linked) before dispatch."""
        db, first = self.db, items[0]["payload"]
        request_id = first.get("requestId")
        user = next((i["payload"] for i in items if i["kind"] == "message" and i["payload"].get("messageId")
                     and not i["payload"].get("orbi") and not i["payload"].get("subagent")), None)
        if user and not request_id:
            row = db.one("SELECT id, status, root_run_id FROM work_requests WHERE chat_id=? AND message_id=? AND owner_bot_id=?",
                         chat_id, user["messageId"], bot_id)
            if row is None:  # queued before this version: accept now, still before dispatch
                request_id = ledger.accept_request(db, chat_id, user["messageId"], bot_id, root_run_id=run_id)
            elif row["status"] not in contract.ROOT_STOPPED:  # a retry of a stopped request starts without it
                request_id = row["id"]
                if row["root_run_id"] is None:
                    db.run("UPDATE work_requests SET root_run_id=? WHERE id=? AND root_run_id IS NULL", run_id, request_id)
        if request_id:
            ledger.set_request(db, request_id, "working")
        reply = (first.get("clientData") or {}).get("replyTo") if isinstance(first.get("clientData"), dict) else None
        return {"role": "foreground", "lane": "interactive", "request_id": request_id,
                "root_run_id": first.get("rootRunId") or root["taskId"],
                "origin_message_id": (user or {}).get("messageId") or first.get("messageId"),
                "thread_root_id": str(reply["id"]).split("~", 1)[0] if isinstance(reply, dict) and isinstance(reply.get("id"), str) else None}

    def _client_data(self, items: list[dict], bot_id: str, chat_id: str) -> dict:
        for item in reversed(items):
            data = item["payload"].get("clientData")
            if isinstance(data, dict) and data.get("model"):
                return data
        row = self.db.one("SELECT payload FROM work_runs WHERE chat_id=? AND bot_id=? AND kind='turn' ORDER BY started_at DESC LIMIT 1", chat_id, bot_id)
        p = loads(row["payload"], {}) if row else {}
        return {"model": p.get("wanted") or p.get("model") or "auto", "effort": p.get("wantedEffort", p.get("effort")), "fast": p.get("wantedFast") is True}

    async def _choose(self, bot: dict, chat: dict, items: list[dict], data: dict, lane: str = "interactive"):
        """-> (Katalogeintrag | None, Stufe, Jev-Info, Fehlertext). Ein festes Modell wechselt nie still.
        Auto: the interactive lane takes Jev's pick (else a ready small model), the background lane a ready large model."""
        wanted, effort, jev_info = data.get("model") or "auto", data.get("effort"), None
        if wanted != "auto":
            model, effort = cli.resolve(wanted, effort) if isinstance(wanted, str) else (None, effort)
            if not model:
                return None, None, None, "This model does not exist."
        else:
            entry, jev = None, self.ctx.parts.get("jev")
            if jev and lane == "interactive":
                try:
                    entry = await jev.choose({"botId": bot["id"], "chatId": chat["id"], "chatKind": chat["kind"],
                                              "text": "\n".join(i["payload"].get("text") or "" for i in items),
                                              "hasFiles": self._has_files(chat["id"], items)})
                except Exception:
                    log.exception("Jev konnte nicht wählen")
            model = cli.BY_ID.get((entry or {}).get("id")) or entry
            if model:
                jev_info, effort = entry.get("jev"), effort or entry.get("effort")
            else:
                ready = [m for m in cli.MODELS if self.adapters[m["cli"]].available()]
                limits = self.ctx.parts.get("limits")
                usable = [m for m in ready if not limits or not limits.get(m["cli"])["blocked"]]  # Ausweichweg nimmt nie ein gesperrtes Modell
                model = self.lane_model(usable, lane)
                if not ready:
                    return None, None, None, "No model program is set up on this Mac."
                if not model:
                    return None, None, None, "Alle eingerichteten Programme haben gerade ihr Nutzungslimit erreicht. Versuch es später noch einmal."
        adapter = self.adapters.get(model["cli"])
        if not adapter or not adapter.available():
            return model, None, None, f"{adapter.label if adapter else model['cli']} is not set up on this Mac."
        efforts = model.get("efforts", [])
        if effort not in efforts:
            effort = "medium" if "medium" in efforts else next(iter(efforts), None)
        return model, effort, jev_info, None

    @staticmethod
    def lane_model(usable: list[dict], lane: str) -> dict | None:
        """From Orbit's live catalog (cli.MODELS, refreshed from the providers): small first for the interactive lane,
        large first for background workers; current models before legacy ones, catalog order otherwise."""
        order = ("small", "medium", "large") if lane == "interactive" else ("large", "medium", "small")
        rank = lambda m: (bool(m.get("legacy")), order.index(m.get("tier")) if m.get("tier") in order else len(order))
        return min(usable, key=rank) if usable else None

    def _has_files(self, chat_id: str, items: list[dict]) -> bool:
        messages = (chatstore.get(self.db, chat_id, i["payload"]["messageId"]) for i in items if i["payload"].get("messageId"))
        return any(p.get("type") == "file" for m in messages if m for p in m["parts"])

    def _session(self, chat_id: str, bot_id: str, cli_name: str) -> str | None:
        row = self.db.one("SELECT cli_session_id, payload FROM work_runs WHERE chat_id=? AND bot_id=? AND kind='turn' ORDER BY started_at DESC LIMIT 1", chat_id, bot_id)
        return row["cli_session_id"] if row and loads(row["payload"], {}).get("cli") == cli_name else None

    def close_if_idle(self, chat_id: str) -> None:
        stream = self.streams.active(chat_id)
        if stream and not inbox.busy(self.db, chat_id):
            stream.close()

    # ------------------------------------------------------------ Nachricht annehmen
    def _members(self, chat_id: str) -> list[dict]:
        return [dict(r) for r in self.db.all(
            "SELECT b.* FROM chat_members m JOIN bots b ON b.id=m.bot_id WHERE m.chat_id=? AND b.archived_at IS NULL ORDER BY m.joined_at, b.rowid", chat_id)]

    @staticmethod
    def _speakers(members: list[dict], text: str) -> list[dict]:
        """Reihenfolge einer Gruppenrunde: @-Markierte, dann der Hauptorbi, dann nach Beitritt."""
        marked = [m for m in members if re.search("@" + re.escape(m["name"]), text, re.I)]
        main = [m for m in members if m["is_main"] and m not in marked]
        return marked + main + [m for m in members if m not in marked and m not in main]

    def _rewind(self, chat_id: str, message_id) -> dict:
        """Wiederholen: Verlauf nach der letzten Nutzer-Nachricht (oder ab `message_id`) abschneiden."""
        rows = [dict(r) for r in self.db.all("SELECT id, role FROM chat_messages WHERE chat_id=? ORDER BY position", chat_id)]
        keep = rows
        if message_id:
            idx = next((i for i, r in enumerate(rows) if r["id"] == message_id), None)
            if idx is None:
                raise HttpError(404, "Nachricht nicht gefunden.")
            keep = rows[:idx + 1] if rows[idx]["role"] == "user" else rows[:idx]
        while keep and keep[-1]["role"] != "user":
            keep.pop()
        if not keep:
            raise HttpError(400, "Keine Nachricht zum Wiederholen vorhanden.")
        for row in rows[len(keep):]:
            chatstore.remove(self.db, chat_id, row["id"])
        return chatstore.get(self.db, chat_id, keep[-1]["id"])

    @staticmethod
    def _valid_parts(message: dict) -> list:
        parts = message.get("parts")
        if message.get("role") != "user" or not isinstance(parts, list) or not parts:
            raise HttpError(400, INVALID)
        for p in parts:
            ok = isinstance(p, dict) and (
                (p.get("type") == "text" and isinstance(p.get("text"), str))
                or (p.get("type") == "file" and isinstance(p.get("url"), str) and isinstance(p.get("mediaType"), str)))
            if not ok:
                raise HttpError(400, INVALID)
        if not any(p["type"] == "file" or p["text"].strip() for p in parts):
            raise HttpError(400, INVALID)
        return parts

    async def submit(self, chat_id: str, body, *, commit_card_answer=None) -> Response:
        db = self.db
        chat = db.one("SELECT * FROM chats WHERE id=? AND user_id='local'", chat_id)
        if not chat:
            raise HttpError(404, "Chat nicht gefunden.")
        messages = body.get("messages") if isinstance(body, dict) else None
        trigger = (body.get("trigger") if isinstance(body, dict) else None) or "submit-message"
        data = body.get("clientData") if isinstance(body.get("clientData"), dict) else {}
        if messages == [] and data.get("onboarding") is True and trigger == "submit-message":
            return await self._onboarding(chat, data)  # Begrüßung eines neuen Orbis: Zug ohne Nutzer-Nachricht
        if not isinstance(messages, list) or not 1 <= len(messages) <= 1000 or not isinstance(messages[-1], dict) \
                or trigger not in ("submit-message", "regenerate-message"):
            raise HttpError(400, INVALID)
        members = self._members(chat_id)
        if not members:
            raise HttpError(400, "In diesem Chat ist kein Orbi.")
        group = chat["kind"] == "group"
        regenerate = trigger == "regenerate-message"
        if not regenerate and not data.get("model"):
            from ..routes.settings import profile_preferences

            # Den Standard zum Sendezeitpunkt festhalten, auch wenn der Turn warten muss.
            profile = profile_preferences(db)
            data = {"effort": profile["defaultEffort"], "fast": profile["defaultFast"], **data, "model": profile["defaultModel"]}
        busy = inbox.busy(db, chat_id)
        if regenerate and busy:
            raise HttpError(409, BUSY)
        if regenerate:
            message = self._rewind(chat_id, body.get("messageId"))
            parts, mid = message["parts"], message["id"]
        else:
            message = messages[-1]
            parts = self._valid_parts(message)
            mid = message.get("id") if isinstance(message.get("id"), str) and message["id"] else new_id()
            if chatstore.exists(db, chat_id, mid):
                raise HttpError(409, BUSY)
        text = chatstore.text_of(parts)
        chosen = next((m for m in members if m["id"] == data.get("botId")), None)
        targets = [chosen] if chosen else self._speakers(members, text) if group else members[:1]
        if not group:  # schreibt Consti selbst, gilt ein offenes Onboarding als übersprungen (nie eine Wiederholung) – außer er antwortet gerade darauf
            from ..tools.core import onboarding_running
            for bot in targets:
                if not onboarding_running(db, bot["id"], chat_id):
                    self._finish_onboarding(bot["id"])
        reply = data.get("replyTo")
        user_meta = _skill_meta(data) or {}
        if not regenerate and isinstance(reply, dict):
            reply_id, quote, author = (reply.get(k) for k in ("id", "text", "name"))
            if (isinstance(reply_id, str) and 0 < len(reply_id) <= 256
                    and isinstance(quote, str) and isinstance(author, str)):
                base = reply_id.split("~", 1)[0]
                if self.live_message_id(chat_id) == base or chatstore.exists(db, chat_id, base):
                    user_meta["replyTo"] = {"id": reply_id, "text": quote[:240], "name": author[:80]}
        prompt_text = text
        if ref := user_meta.get("replyTo"):
            prompt_text = f'Replying to an earlier chat message from {ref["name"]}: "{ref["text"]}"\n\n{text}'
        payload = {"messageId": mid, "text": prompt_text, "clientData": data}
        salt = f":r{now_ms()}" if regenerate else ""
        interactions = self.ctx.parts.get("interactions")
        moved_widgets = []
        with db.tx():
            if commit_card_answer:
                commit_card_answer()
            if not regenerate:
                chatstore.add(db, chat_id, mid, "user", parts, user_meta or None)
                if interactions:
                    moved_widgets = interactions.move_on(chat_id)
            queued = [inbox.enqueue(db, bot["id"], chat_id, "message", {**payload, "round": mid}, f"round:{mid}:{bot['id']}{salt}") for bot in targets]
            for bot, item in zip(targets, queued):
                if item:  # Word 1.17: the request is accepted before any dispatch
                    ledger.accept_request(db, chat_id, mid, bot["id"])
        if moved_widgets:
            interactions.publish_widget_updates(moved_widgets)
        if group and any(queued):
            self.ctx.bus.publish({"type": "group-turn", "chatId": chat_id, "phase": "start"})
        self.ctx.bus.publish({"type": "orbi-message", "chatId": chat_id, "messageId": mid})
        if busy or commit_card_answer:
            self.wake()
            return empty_response()
        response = self.streams.open(chat_id).response()
        self.wake()
        return response

    def _finish_onboarding(self, bot_id: str) -> None:
        if self.db.run("UPDATE bots SET onboarding_done=1 WHERE id=? AND onboarding_done=0", bot_id) == 1:
            self.ctx.bus.publish({"type": "onboarding", "botId": bot_id, "done": True, "instructions": False})

    async def _onboarding(self, chat: dict, data: dict) -> Response:
        """Zug ohne Nutzer-Nachricht: der Orbi stellt sich vor (Anweisung steht im Zug-Text, wird nicht gespeichert)."""
        from .. import context
        db, chat_id = self.db, chat["id"]
        members = self._members(chat_id)
        bot = next((m for m in members if m["id"] == data.get("botId")), members[0] if members else None)
        if chat["kind"] != "direct" or not bot:
            raise HttpError(400, INVALID)
        if bot["onboarding_done"] != 0:
            raise HttpError(409, "Das Onboarding ist schon erledigt.")
        if inbox.busy(db, chat_id):
            raise HttpError(409, BUSY)
        payload = {"text": context.onboarding_hint(bot), "clientData": data, "onboarding": True}
        if inbox.enqueue(db, bot["id"], chat_id, "message", payload, f"onboarding:{bot['id']}:{now_ms()}") is None:
            raise HttpError(409, BUSY)
        response = self.streams.open(chat_id).response()
        self.wake(bot["id"])
        return response

    def group_event(self, runner: Runner, status: str, saved: bool) -> None:
        """group-turn: reply/silent je Mitglied, end wenn die Runde fertig ist (oder gestoppt wurde)."""
        mid = runner.items[0]["payload"].get("round")
        if runner.chat_kind != "group" or not mid:
            return
        bus, chat_id = self.ctx.bus, runner.chat_id
        if status == "done" and saved:
            self._follow_up(runner, mid)
        if status != "stopped":
            bus.publish({"type": "group-turn", "chatId": chat_id, "phase": "reply" if saved else "silent", "botId": runner.bot["id"],
                         **({"messageId": runner.message_id} if saved else {})})
        if not self.db.val("SELECT 1 FROM inbox_items WHERE dedupe_key LIKE ? AND status IN ('queued','processing')", f"round:{mid}:%"):
            bus.publish({"type": "group-turn", "chatId": chat_id, "phase": "end", **({"stopped": True} if status == "stopped" else {})})

    def _follow_up(self, runner: Runner, mid: str) -> None:
        """@-Nachlauf: Wer in der Antwort mit @Name genannt wird, bekommt einen eigenen Zug in derselben Runde (höchstens FOLLOW_UPS je Nutzer-Nachricht)."""
        db, text = self.db, chatstore.text_of(runner.parts)
        used = db.val("SELECT count(*) FROM inbox_items WHERE dedupe_key LIKE ?", f"round:{mid}:%:f%")
        for m in self._members(runner.chat_id):
            if used >= FOLLOW_UPS:
                break
            queued = db.val("SELECT 1 FROM inbox_items WHERE dedupe_key LIKE ? AND bot_id=? AND status='queued'", f"round:{mid}:%", m["id"])
            if m["id"] == runner.bot["id"] or queued or not re.search("@" + re.escape(m["name"]) + r"(?!\w)", text, re.I):
                continue
            payload = {"text": f"{runner.bot['name']} mentioned you in the group with @{m['name']}.", "clientData": runner.items[0]["payload"].get("clientData") or {}, "round": mid,
                       "orbi": {"kind": "mention", "from": runner.bot["id"]}}  # gilt als „aus Orbi-Nachricht“ (Runner.from_orbi)
            if inbox.enqueue(db, m["id"], runner.chat_id, "message", payload, f"round:{mid}:{m['id']}:f{used + 1}"):
                used += 1
                self.wake(m["id"])

    # ------------------------------------------------------------ Strom, Stopp, Weiter
    def stream(self, chat_id: str) -> Response | None:
        stream = self.streams.active(chat_id)
        return stream.response() if stream else None

    def live_message_id(self, chat_id: str) -> str | None:
        runner = self.runs.get(chat_id)
        return runner.message_id if runner and not runner.finalizing else None

    async def stop(self, chat_id: str) -> dict:
        """Stopp im Root-Chat bricht auch die Läufe dieses Auftrags in anderen Chats ab.
        Word 4.42: the first action is stop-all. Open requests of this chat are cancelled in the ledger (late child results
        and effects are refused), every child worker started from this chat is stopped, then the foreground run."""
        others = [r.chat_id for r in self.runs.values() if r.chat_id != chat_id and r.root["chatId"] == chat_id]
        for (request_id,) in self.db.all("SELECT id FROM work_requests WHERE chat_id=? AND status IN ('accepted','working')", chat_id):
            ledger.cancel_root(self.db, request_id)
        children = [r[0] for r in self.db.all("SELECT id FROM work_runs WHERE kind='worker' AND origin_chat_id=? AND status IN ('queued','running','waiting')", chat_id)]
        stopped_children = [c for c in children if await self.stop_child(c) == "stopped"]
        self._cancel_downstream(chat_id)
        stopped, requeued = await self._stop_chat(chat_id)
        stopped = stopped or bool(stopped_children)
        for other in others:
            s, q = await self._stop_chat(other)
            stopped, requeued = stopped or s, requeued + q
        return {"stopped": stopped, "requeued": requeued}

    def _cancel_downstream(self, root_chat: str) -> None:
        """Wartende Einträge aus Aufträgen dieses Ursprungs-Chats (auch in anderen Chats) verwerfen, ihre Aufträge stoppen."""
        from ..tools import messages
        db = self.db
        with db.tx():
            rows = db.all("SELECT id, payload FROM inbox_items WHERE status='queued' AND chat_id<>? AND json_extract(payload,'$.rootChatId')=?", root_chat, root_chat)
            for row in rows:
                db.run("UPDATE inbox_items SET status='cancelled', updated_at=? WHERE id=?", now_ms(), row["id"])
        for row in rows:
            task_id = loads(row["payload"], {}).get("taskId")
            if task_id:
                messages.set_task(self.ctx, task_id, "stopped")

    async def _stop_chat(self, chat_id: str) -> tuple[bool, list[str]]:
        db = self.db
        runner = self.runs.get(chat_id)
        if runner and runner.finalizing:
            runner = None
        with db.tx():
            if runner:
                runner.mark_stopped()                    # 1. Status in der Datenbank
            cancelled = inbox.cancel_queued(db, chat_id)  # 2. Wartendes verwerfen
            texts, seen = [], set()
            for item in cancelled:
                p = item["payload"]
                if item["kind"] == "message" and p.get("messageId") and p["messageId"] not in seen:
                    seen.add(p["messageId"])
                    if p.get("text"):
                        texts.append(p["text"])
                    chatstore.remove(db, chat_id, p["messageId"])
        interactions = self.ctx.parts.get("interactions")  # 3. Karten hinfällig
        if interactions:
            if runner:
                interactions.abort_for_run(runner.id)
            interactions.abort_for_chat(chat_id)
        if runner and runner.task:                       # 4. Task abbrechen; der Lauf beendet den Prozessbaum
            runner.task.cancel()
            await runner.finished.wait()
        for mid in {i["payload"].get("round") for i in cancelled} - {None}:
            self.ctx.bus.publish({"type": "group-turn", "chatId": chat_id, "phase": "end", "stopped": True})
        if cancelled:
            self.ctx.bus.publish({"type": "orbi-message", "chatId": chat_id})
        self.close_if_idle(chat_id)
        return bool(runner or cancelled), texts

    def interrupted(self, chat_id: str) -> dict | None:
        # „Weiter“ nur, solange kein neuerer Lauf im selben Chat fertig wurde
        row = self.db.one("SELECT id, updated_at, started_at, steps FROM work_runs r WHERE chat_id=? AND kind='turn' AND status='interrupted' AND note IS NULL AND NOT EXISTS "
                          "(SELECT 1 FROM work_runs n WHERE n.chat_id=r.chat_id AND n.kind='turn' AND n.status='done' AND n.started_at>r.started_at) "
                          "ORDER BY updated_at DESC LIMIT 1", chat_id)
        return {"runId": row["id"], "at": row["updated_at"], "startedAt": row["started_at"], "steps": row["steps"]} if row else None

    async def resume(self, chat_id: str, run_id: str, dismiss: bool = False) -> None:
        db = self.db
        run = db.one("SELECT * FROM work_runs WHERE id=? AND chat_id=?", run_id, chat_id)
        if not run:
            raise HttpError(404, "Interrupted work not found.")
        interactions = self.ctx.parts.get("interactions")
        if dismiss:
            if db.run("UPDATE work_runs SET note='verworfen' WHERE id=? AND status='interrupted' AND note IS NULL", run_id) != 1:
                raise HttpError(404, "Interrupted work not found.")
            if interactions:
                interactions.abort_for_run(run_id)
            return
        if run["kind"] == "worker":  # a child is continued with Task(resume=…), never with „Weiter“
            raise HttpError(409, "This work is not interrupted.")
        if run["status"] != "interrupted" or run["note"] is not None:
            raise HttpError(409, "This work is not interrupted.")
        if inbox.busy(db, chat_id):
            raise HttpError(409, BUSY)
        if interactions:  # offene Karten des unterbrochenen Laufs sind hinfällig: eine späte Freigabe startet keinen zweiten Lauf
            interactions.abort_for_run(run_id)
        p = loads(run["payload"], {})
        items = [loads(r["payload"], {}) for r in db.all("SELECT payload FROM inbox_items WHERE run_id=? ORDER BY rowid", run_id)]
        first = items[0] if items else {}
        orbi = first.get("orbi")
        # alle Texte des Zugs; ein früheres „Weiter“ bringt seinen Hinweis mit, der hier nicht doppelt stehen soll
        asked = "\n\n".join(t.split("was:\n", 1)[-1].split("war:\n", 1)[-1] if t.startswith((RESUME_HINT, OLD_RESUME_HINT)) else t
                              for t in ((i.get("text") or "").strip() for i in items) if t)
        who = "from another Orbi" if orbi else "from the user"
        if not asked and not orbi:
            last = db.one("SELECT parts FROM chat_messages WHERE chat_id=? AND role='user' ORDER BY position DESC LIMIT 1", chat_id)
            asked = chatstore.text_of(loads(last["parts"], [])) if last else ""
        payload = {"text": f"{RESUME_HINT}\n\n{RESUME_TASK.format(who=who)}{asked}" if asked else RESUME_HINT, "runId": run_id,
                   "clientData": {"model": p.get("wanted") or p.get("model") or "auto", "effort": p.get("wantedEffort", p.get("effort")), "fast": p.get("wantedFast") is True},
                   "taskId": p.get("taskId"), "rootChatId": p.get("rootChatId"),
                   **({"orbi": orbi, "messageId": first.get("messageId")} if orbi else {})}
        with db.tx():
            if inbox.enqueue(db, run["bot_id"], chat_id, "resume", payload, f"resume:{run_id}") is None:
                raise HttpError(409, "This work is not interrupted.")
            db.run("UPDATE work_runs SET note='fortgesetzt' WHERE id=?", run_id)
            reopened = orbi and db.run("UPDATE tasks SET status='running', finished_at=NULL, updated_at=? WHERE id=? AND status='failed'", now_ms(), p.get("taskId"))
        if reopened:
            from ..tools import messages
            messages.publish_task(self.ctx, p["taskId"], "start")
        self.wake(run["bot_id"])

    # ------------------------------------------------------------ child workers (Word 4.1 Task, 4.40-4.42)
    async def spawn_child(self, parent, *, description: str, prompt: str, role: str, background: bool,
                          attachments: list[str] | None = None, resume_id: str | None = None) -> str:
        """Persists a durable child (work_runs.kind='worker') and starts it. A synchronous child borrows the parent's slot;
        a background child waits for a background slot, so the interactive lane always keeps one."""
        if background:
            from ..routes.settings import profile_preferences
            if not profile_preferences(self.db).get("backgroundWork", True):
                raise Fail("Hintergrundarbeit ist in den Einstellungen aus.")
        db, t = self.db, now_ms()
        prow = db.one("SELECT payload, origin_message_id, thread_root_id FROM work_runs WHERE id=?", parent.id)
        pp = loads(prow["payload"], {}) if prow else {}
        client = {"model": pp.get("wanted") or pp.get("model") or "auto", "effort": pp.get("wantedEffort"), "fast": pp.get("wantedFast") is True}
        base = {"description": description, "prompt": prompt, "background": background, "attachments": attachments or [],
                "client": client, "requestId": parent.request_id, "parentRunId": parent.id, "control": [], "controlUsed": 0}
        with db.tx():
            if resume_id:
                row = db.one("SELECT * FROM work_runs WHERE id=? AND kind='worker' AND origin_chat_id=? AND owner_bot_id=?",
                             resume_id, parent.chat_id, parent.bot["id"])
                if not row:
                    raise Fail("Unknown subagent. Use CheckSubagent to list yours.")
                if row["status"] in LIVE:
                    raise Fail("This subagent is still working. Steer it with MessageSubagent instead.")
                old = loads(row["payload"], {})
                attempt = int(old.get("attempt") or 1) + 1
                payload = {**old, **base, "description": description or old.get("description"), "attempt": attempt}
                db.run("UPDATE work_runs SET status='queued', error=NULL, finished_at=NULL, note=NULL, payload=?, parent_id=?, root_run_id=?, "
                       "updated_at=? WHERE id=?", dumps(payload), parent.id, parent.root_run_id, t, resume_id)
                child_id = resume_id
            else:
                child_id = new_id()
                db.run("INSERT INTO work_runs (id,kind,chat_id,bot_id,parent_id,status,payload,steps,started_at,updated_at,root_run_id,owner_bot_id,"
                       "origin_chat_id,origin_message_id,thread_root_id,role,lane,principal_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                       child_id, "worker", parent.chat_id, parent.bot["id"], parent.id, "queued", dumps({**base, "attempt": 1}), 0, t, t,
                       parent.root_run_id, parent.bot["id"], parent.chat_id, prow["origin_message_id"] if prow else None,
                       prow["thread_root_id"] if prow else None, role, "background", "local")
        self.waiters[child_id] = asyncio.get_running_loop().create_future()
        self.child_tasks[child_id] = asyncio.create_task(self._child_main(child_id, borrow=not background))
        return child_id

    async def wait_child(self, child_id: str) -> dict:
        waiter = self.waiters.get(child_id)
        return await asyncio.shield(waiter) if waiter else self.child_view(child_id)

    async def _child_main(self, child_id: str, borrow: bool) -> None:
        try:
            if borrow:
                await self._run_child(child_id)
            else:
                async with self.bg_slots:
                    async with self.slots:
                        await self._run_child(child_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Child %s failed to start", child_id)
            t = now_ms()
            self.db.run("UPDATE work_runs SET status='failed', error=?, finished_at=?, updated_at=? WHERE id=? AND status IN ('queued','running')",
                        "The subagent could not start.", t, t, child_id)
        finally:
            self.child_tasks.pop(child_id, None)
            waiter = self.waiters.pop(child_id, None)
            if waiter and not waiter.done():
                waiter.set_result(self.child_view(child_id))

    async def _run_child(self, child_id: str) -> None:
        db = self.db
        row = db.one("SELECT * FROM work_runs WHERE id=? AND kind='worker'", child_id)
        if not row or row["status"] != "queued":
            return  # stopped while it waited for a slot
        p = loads(row["payload"], {})
        bot, chat = db.one("SELECT * FROM bots WHERE id=?", row["bot_id"]), db.one("SELECT * FROM chats WHERE id=?", row["chat_id"])
        if not bot or not chat:
            t = now_ms()
            db.run("UPDATE work_runs SET status='failed', error=?, finished_at=?, updated_at=? WHERE id=?", "The chat or Orbi is gone.", t, t, child_id)
            return
        bot, chat = dict(bot), dict(chat)
        model, effort, _, error = await self._choose(bot, chat, [], p.get("client") or {}, lane="background")
        session = row["cli_session_id"] if model and p.get("cli") == model["cli"] and int(p.get("attempt") or 1) > 1 else None
        t = now_ms()
        if db.run("UPDATE work_runs SET status='running', payload=json_set(payload,'$.model',?,'$.effort',?,'$.cli',?,'$.lane','background'), "
                  "started_at=?, updated_at=? WHERE id=? AND status='queued'", model["id"] if model else None, effort,
                  model["cli"] if model else None, t, t, child_id) != 1:
            return
        identity = {"role": row["role"] or "executor", "lane": "background", "parent_run_id": row["parent_id"],
                    "root_run_id": row["root_run_id"], "request_id": p.get("requestId"), "attempt": p.get("attempt")}
        items = [{"id": None, "kind": "task", "chat_id": row["chat_id"],
                  "payload": {"text": p.get("prompt") or "", "taskId": row["root_run_id"], "rootChatId": row["chat_id"]}}]
        root = {"chatId": row["chat_id"], "taskId": row["root_run_id"]}
        runner = Runner(self, child_id, bot, chat, items, model, effort, root, None, session, error, None, identity=identity, brief=p)
        self.by_id[child_id] = runner
        task = runner.task = asyncio.create_task(runner.run())
        await asyncio.sleep(0)
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            raise
        finally:
            if self.by_id.get(child_id) is runner:
                del self.by_id[child_id]

    def child_finished(self, runner, status: str, report: dict | None, error: str | None) -> None:
        """Completion wake (exactly once per attempt) to the owning Orbi in the origin chat, only for background children
        whose child and root are not stopped. A stale wake can be answered with SILENT."""
        db = self.db
        row = db.one("SELECT * FROM work_runs WHERE id=?", runner.id)
        p = loads(row["payload"], {}) if row else {}
        if not row or not p.get("background") or status == "stopped" or row["error"] == "gestoppt":
            return
        if ledger.stopped(db, runner.request_id, runner.root_run_id):
            return
        from .. import context
        report_text = chatstore.text_of(report["parts"]) if report and report.get("parts") else ""
        text = context.worker_wake(runner.id, p.get("description") or "", status, report_text, error)
        payload = {"text": text, "subagent": {"id": runner.id, "status": status}, "taskId": row["root_run_id"], "rootRunId": row["root_run_id"],
                   "requestId": runner.request_id, "rootChatId": row["origin_chat_id"] or row["chat_id"], "clientData": p.get("client") or {}}
        if inbox.enqueue(db, row["owner_bot_id"] or row["bot_id"], row["origin_chat_id"] or row["chat_id"], "message", payload,
                         f"subagent:{runner.id}:{p.get('attempt') or 1}"):
            self.wake(row["owner_bot_id"] or row["bot_id"])

    def send_control(self, child_id: str, text: str) -> str:
        """Word 4.41: targeted control inbox of an active child (durable in its payload). -> queued | finished | unreachable"""
        db = self.db
        with db.tx():
            row = db.one("SELECT status, payload FROM work_runs WHERE id=? AND kind='worker'", child_id)
            if not row:
                return "unreachable"
            if row["status"] not in LIVE:
                return "finished"
            p = loads(row["payload"], {})
            p["control"] = [*(p.get("control") or []), {"text": text, "at": now_ms()}]
            db.run("UPDATE work_runs SET payload=?, updated_at=? WHERE id=?", dumps(p), now_ms(), child_id)
        return "queued"

    def take_control(self, child_id: str) -> list[str]:
        db = self.db
        with db.tx():
            p = loads(db.val("SELECT payload FROM work_runs WHERE id=?", child_id), {}) or {}
            control, used = p.get("control") or [], int(p.get("controlUsed") or 0)
            if used >= len(control):
                return []
            p["controlUsed"] = len(control)
            db.run("UPDATE work_runs SET payload=? WHERE id=?", dumps(p), child_id)
        return [c["text"] for c in control[used:]]

    async def stop_child(self, child_id: str) -> str:
        """Word 4.42: stops one child. -> stopped | already-finished | unreachable. Its late result is refused."""
        db = self.db
        row = db.one("SELECT status FROM work_runs WHERE id=? AND kind='worker'", child_id)
        if not row:
            return "unreachable"
        if row["status"] not in LIVE:
            return "already-finished"
        runner, t = self.by_id.get(child_id), now_ms()
        if runner and not runner.finalizing:
            with db.tx():
                runner.mark_stopped()
        elif db.run("UPDATE work_runs SET status='failed', error='gestoppt', finished_at=?, updated_at=? WHERE id=? AND status IN ('queued','running','waiting')",
                    t, t, child_id) != 1:
            return "already-finished"
        interactions = self.ctx.parts.get("interactions")
        if interactions:
            interactions.abort_for_run(child_id)
        if runner:
            if runner.task and not runner.finalizing:
                runner.task.cancel()
            await runner.finished.wait()
        else:
            task = self.child_tasks.get(child_id)
            if task:
                task.cancel()  # still waiting for a slot
                await asyncio.gather(task, return_exceptions=True)
        return "stopped"

    def child_view(self, child_id: str, row=None) -> dict:
        """Private diagnostics of one child (Word 4.40)."""
        db = self.db
        row = row or db.one("SELECT * FROM work_runs WHERE id=? AND kind='worker'", child_id)
        if not row:
            return {"id": child_id, "status": "unavailable"}
        p, now = loads(row["payload"], {}), now_ms()
        status = "stopped" if row["error"] == "gestoppt" else row["status"]
        last = db.one("SELECT at, data FROM run_events WHERE run_id=? AND type='status-step' ORDER BY seq DESC LIMIT 1", child_id)
        step = loads(last["data"], {}) if last else {}
        seen = max(row["updated_at"] or 0, last["at"] if last else 0)
        view = {"id": child_id, "description": p.get("description"), "role": row["role"], "status": status, "background": bool(p.get("background")),
                "attempt": p.get("attempt") or 1, "model": p.get("model"), "elapsedMs": (row["finished_at"] or now) - row["started_at"],
                "latestTool": step.get("label"), "trace": f"/v1/subagents/{child_id}"}
        if status == "running" and now - seen > STALL_MS:
            view["stalled"] = True
        if row["error"] and status == "failed":
            view["error"] = row["error"]
        report = db.one("SELECT parts FROM deliveries WHERE run_id=? AND kind='report' AND visibility='private' ORDER BY created_at DESC, rowid DESC LIMIT 1", child_id)
        if report and status in ("done", "failed"):
            view["report"] = chatstore.text_of(loads(report["parts"], []))
        return view

    def children(self, chat_id: str, owner_bot_id: str | None = None, live_only: bool = False) -> list[dict]:
        rows = self.db.all("SELECT * FROM work_runs WHERE kind='worker' AND origin_chat_id=? AND (? IS NULL OR owner_bot_id=?)"
                           + (" AND status IN ('queued','running','waiting')" if live_only else "") + " ORDER BY started_at DESC LIMIT 20",
                           chat_id, owner_bot_id, owner_bot_id)
        return [self.child_view(r["id"], r) for r in rows]

    # ------------------------------------------------------------ Anzeige
    def _working(self) -> list[dict]:
        return [{"chatId": r.chat_id, "botId": r.bot["id"], "status": r.status} for r in self.runs.values() if not r.finalizing]

    def _approvals(self) -> list[dict]:
        interactions = self.ctx.parts.get("interactions")
        # Choice widgets live in the message; only Freigabe/Rückfrage cards go on the overlay list.
        return [c for c in interactions.list() if c.get("kind") in ("approval", "ask")] if interactions else []

    def status(self) -> dict:
        chats = [r["chat_id"] for r in self.db.all("SELECT DISTINCT chat_id FROM work_runs WHERE kind='turn' AND status='interrupted' AND note IS NULL")]
        open_ = [(c, self.interrupted(c)) for c in chats]
        return {"ok": True, "chats": self._working(), "interrupted": [{"chatId": c, **i} for c, i in open_ if i], "needsYou": len(self._approvals())}

    def snapshot(self) -> dict:
        return {"working": self._working(), "approvals": self._approvals(), "automations": self._active_automations(),
                "steps": [s for r in self.runs.values() for s in r.open_steps.values()]}

    # ------------------------------------------------------------ Routinen
    def _active_automations(self) -> list[dict]:
        rows = self.db.all("SELECT * FROM automation_runs WHERE status IN ('running','waiting') ORDER BY started_at")
        return [{"automationId": r["automation_id"], "runId": r["id"], "status": r["status"], "chatId": r["chat_id"], "trigger": r["trigger"]} for r in rows]

    def _automation_chat(self, a, run_id: str) -> str:
        """Ziel-Chat: neuer Routine-Chat (target new) oder der gewählte, sonst der 1:1-Chat des Orbis."""
        db = self.db
        if a["target"] == "new" or not a["chat_id"]:
            if a["target"] != "new":
                direct = store._direct_chat(db, a["bot_id"])
                if direct:
                    return direct
            chat_id = new_id()
            db.run("INSERT INTO chats (id,user_id,kind,name) VALUES (?,?,'automation',?)", chat_id, store.USER, a["name"])
            db.run("INSERT INTO chat_members (chat_id,bot_id) VALUES (?,?)", chat_id, a["bot_id"])
            return chat_id
        if db.val("SELECT 1 FROM chats c JOIN chat_members m ON m.chat_id=c.id WHERE c.id=? AND c.user_id=? AND m.bot_id=?", a["chat_id"], store.USER, a["bot_id"]):
            return a["chat_id"]
        direct = store._direct_chat(db, a["bot_id"])
        if not direct:
            raise Fail("Ziel-Chat nicht mehr vorhanden")
        return direct

    def automation_waiting(self, run_id: str, waiting: bool) -> None:
        """Routinen-Lauf auf `waiting` (offene Freigabe) bzw. zurück auf `running`; Ereignis bei jedem Wechsel."""
        new, old = ("waiting", "running") if waiting else ("running", "waiting")
        if self.db.run("UPDATE automation_runs SET status=? WHERE id=? AND status=?", new, run_id, old) == 1:
            self._automation_event(run_id)

    def _automation_event(self, run_id: str) -> None:
        r = self.db.one("SELECT * FROM automation_runs WHERE id=?", run_id)
        self.ctx.bus.publish({"type": "automation", "automationId": r["automation_id"], "runId": run_id, "status": r["status"],
                              "chatId": r["chat_id"], "trigger": r["trigger"], **({"error": r["error"]} if r["error"] else {})})

    async def run_automation(self, automation_id: str, trigger: str, due: int | None = None) -> str:
        """Startet einen Routinen-Lauf: Lauf-Zeile, Nachricht im Chat und Postfach-Eintrag (kind timer) in einem Zug. `due` = Termin (für dedupe)."""
        db, run_id, t, mid = self.db, new_id(), now_ms(), new_id()
        with db.tx():
            blocked = store.run_blocker(db, automation_id)  # Fail, wenn es die Routine nicht (mehr) gibt
            if blocked:
                raise Fail(blocked)
            a = db.one("SELECT * FROM automations WHERE id=?", automation_id)
            chat_id = self._automation_chat(a, run_id)
            db.run("INSERT INTO automation_runs (id,automation_id,user_id,chat_id,status,trigger,started_at) VALUES (?,?,?,?,'running',?,?)",
                   run_id, automation_id, store.USER, chat_id, trigger, t)
            db.run("UPDATE automations SET last_run_at=? WHERE id=?", t, automation_id)
            info = {"automationId": automation_id, "runId": run_id, "name": a["name"], "status": "running", "startedAt": t}
            tag = re.sub(r"[\[\]\n]", " ", a["name"])
            chatstore.add(db, chat_id, mid, "user", [{"type": "text", "text": f"[[automation:{tag}]]\n{a['prompt']}"}], {"automation": info})
            model = a["model"] or "claude-haiku-5-5"
            payload = {"text": a["prompt"], "messageId": mid, "automationId": automation_id, "automationRunId": run_id,
                       "clientData": {"model": model, "effort": None if model == "auto" else (a["effort"] or "medium"), "botId": a["bot_id"]}}
            if inbox.enqueue(db, a["bot_id"], chat_id, "timer", payload, f"{trigger}:{automation_id}:{due or run_id}") is None:
                raise Fail("Dieser Termin läuft schon.")
        self._automation_event(run_id)
        self.ctx.bus.publish({"type": "orbi-message", "chatId": chat_id, "messageId": mid})
        self.wake(a["bot_id"])
        return run_id

    async def _automation_done(self, run, outcome) -> None:
        """after_run-Haken: Ergebnis des Laufs in die Lauf-Zeile und die Nachricht im Chat schreiben."""
        payload = run.items[0]["payload"]
        run_id = payload.get("automationRunId")
        if not run_id:
            return
        ok, t = outcome.status == "done", now_ms()
        error = None if ok else (outcome.error or "Gestoppt.")
        if self.db.run("UPDATE automation_runs SET status=?,error=?,finished_at=? WHERE id=? AND status IN ('running','waiting')", "ok" if ok else "error", error, t, run_id) != 1:
            return
        message = chatstore.get(self.db, run.chat_id, payload["messageId"])
        if message:
            info = {**message["metadata"]["automation"], "status": "ok" if ok else "error", "finishedAt": t}
            chatstore.update(self.db, run.chat_id, payload["messageId"], message["parts"], {"automation": info})
        self._automation_event(run_id)
