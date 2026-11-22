"""Cards: approvals and questions (shape and rules: runtime/contract.py, sections "Karten" and "Wave 1 shared work contract").

A card is a row in pending_interactions (request = PendingInteraction JSON, internal fields start with "_"). Every reviewed
call also has an effects row in the ledger (request.effectId): the owner's decision goes through ledger.decide, the bridge
claims the approved effect right before the handler and records the outcome. If a tool call still waits (asyncio.Future in
memory) it continues after the decision. If nobody waits any more (timeout or restart), the decision is kept in
interaction_results and the Orbi is told through its inbox; its unchanged retry claims the approved effect once.
"""
import asyncio
import logging

from .. import chatstore
from ..db import dumps, loads, new_id, now_ms
from ..web import Fail, HttpError
from . import contract, inbox, ledger

log = logging.getLogger("orbitd")
PRINCIPAL = "local"  # the single local owner (principals table); decisions come only from the authenticated owner session
# Approval cards only for these reasons (Consti 20.11.2026). Everything else runs without asking. Stored keys stay German.
ASK_REASONS = frozenset({"geld", "nachricht", "login"})
# One-off Word reviews (external messages, purchases and payments, publication, credentials and account connection):
# never an "always allow" rule, a decision per payload.
NO_RULE_FOR = ("geld", "nachricht", "login", "veroeffentlichen")
NO_RULE_KIND = (":dienst", ":fremd", ":einmal")  # own service, after foreign data, scripts for Finder/System Events/unknown apps: never "always"
NO_RULE_SYSTEM = ("mac_shell:", "sandbox_bash:")
NO_RULE_EXACT = ("mac_applescript:system",)  # script cards without an app name; "mac_applescript:app:…" keeps "always" per app


def no_rule(approval_kind: str, reason: str) -> bool:
    return (reason in NO_RULE_FOR or approval_kind.endswith(NO_RULE_KIND) or approval_kind in NO_RULE_EXACT
            or (reason == "system" and approval_kind.startswith(NO_RULE_SYSTEM)))


GONE_APPROVAL, GONE_QUESTION = "This approval is no longer open.", "This question is no longer open."
EXPIRED_APPROVAL = "This approval has expired."
BAD_ANSWER = "The answer is invalid or the question has expired."
BAD_DECISION = "Invalid decision."
NOT_STORED = "The decision could not be saved."
SKIPPED_TEXT = "Consti skipped the question. Decide yourself."
BLOCKED_RULE = "Consti has blocked this kind of action."
DENIED = "Consti declined this."
RETRY_BLOCKED = "The unchanged action stays blocked. Do not retry it; change it only if Consti asks for a different one."
ONE_CARD = "A review card for exactly this action is already open. Wait for Consti's answer; do not start it again."
WAITING = ("Consti has not answered yet. The card stays open and the answer arrives later as a new message: "
           "continue elsewhere and do not start the action again.")
GONE_CALL = "The request is no longer valid."
EVENT = {"approval": "approval", "ask": "question"}
WIDGET_GONE = "This choice is no longer open."
WIDGET_BAD = "The choice is invalid or no longer open."
SECRET_GONE = "This secure request is no longer open."
SECRET_BAD = "The secure value is invalid or the request is no longer open."


class Interactions:
    def __init__(self, ctx):
        self.ctx = ctx
        self.handlers: dict = {}  # Präfix -> async fn(id, body) für Karten des Dienstes selbst (z. B. "missed:")
        self._runs: dict[str, object] = {}  # Karten-ID -> Lauf, nur für Karten dieses Prozesses
        self._waiters: dict[str, asyncio.Future] = {}

    # ------------------------------------------------------------ Lesen
    def _live(self, run) -> bool:
        if run is None:
            return False
        bridge = self.ctx.parts.get("bridge")
        return bridge is None or run in bridge.runs.values()

    @staticmethod
    def _card(row) -> dict:
        return {k: v for k, v in loads(row["request"], {}).items() if not k.startswith("_")}

    def list(self) -> list[dict]:
        self.expire()
        cards = []
        for row in self.ctx.db.all("SELECT * FROM pending_interactions ORDER BY requested_at, rowid"):
            card = self._card(row)
            if not self._live(self._runs.get(row["id"])) and not any(row["id"].startswith(x) for x in self.handlers):  # eigene Karten des Dienstes sind nie „wiederhergestellt“
                card["restored"] = True
            cards.append(card)
        return cards

    def _row(self, id: str, kind: str, gone: str, expired: HttpError):
        row = self.ctx.db.one("SELECT * FROM pending_interactions WHERE id=?", id)
        if not row or row["kind"] != kind:
            raise HttpError(410, gone)
        if row["expires_at"] <= now_ms():
            self._close(row, "expired")
            raise expired
        return row

    # ------------------------------------------------------------ Anlegen und Schließen
    def _emit(self, card: dict, status: str) -> None:
        if card.get("kind") in ("widget", "secret"):
            self._publish_message(card.get("chatId"))
            return
        self.ctx.bus.publish({"type": EVENT[card["kind"]], **card, "status": status})

    def _publish_message(self, chat_id: str | None, message_id: str | None = None) -> None:
        if chat_id:
            event = {"type": "orbi-message", "chatId": chat_id}
            if message_id:
                event["messageId"] = message_id
            self.ctx.bus.publish(event)

    def _create(self, run, kind: str, tool: str, tool_call_id: str, input: dict, **extra) -> dict:
        t, id = now_ms(), new_id()
        card = {"id": id, "kind": kind, "chatId": run.chat_id, "botId": run.bot["id"], "toolCallId": tool_call_id, "tool": tool,
                "input": input, "requestedAt": t, "expiresAt": t + contract.INTERACTION_TTL_MS, "runId": run.id, **extra}
        root = run.root or {}
        if root.get("chatId") and root["chatId"] != run.chat_id:  # Karte erscheint zusätzlich im Root-Chat
            card["root"] = {"chatId": root["chatId"], "taskId": root.get("taskId")}
            card["from"] = {k: run.bot[k] for k in ("id", "name", "avatar", "color")}
        self.ctx.db.run("INSERT INTO pending_interactions (id,chat_id,bot_id,kind,request,requested_at,expires_at) VALUES (?,?,?,?,?,?,?)",
                        id, run.chat_id, card["botId"], kind, dumps({**card, "_messageId": run.message_id}), t, card["expiresAt"])
        self._runs[id] = run
        self._emit(card, "pending")
        return card

    def _settle(self, row, state: str | None) -> None:
        """Gespeicherten Freigabe-Teil im Verlauf nachziehen (sonst zeigt die App nach einem Neustart tote Knöpfe).
        state None: Teil entfernen; sonst neuer Zustand (approval-responded | output-denied)."""
        req = loads(row["request"], {})
        if req.get("kind") != "approval" or not req.get("_messageId"):
            return
        msg = chatstore.get(self.ctx.db, req["chatId"], req["_messageId"])
        hit = [p for p in (msg or {}).get("parts", []) if p.get("toolCallId") == req.get("toolCallId") and p.get("state") == "approval-requested"]
        if not hit:
            return
        parts = [p for p in msg["parts"] if p is not hit[0]] if state is None else [{**p, "state": state} if p is hit[0] else p for p in msg["parts"]]  # wie Runner.approval
        chatstore.update(self.ctx.db, req["chatId"], req["_messageId"], parts)

    def _close(self, row, status: str) -> None:
        """Karte hinfällig (aborted | expired): Zeile weg, wartender Aufruf bekommt den Grund, Ereignis."""
        id = row["id"]
        card = self._card(row)
        if row["kind"] in ("widget", "secret"):
            self._set_widget_output(row, card, {"movedOn": True, "reason": status}, self._runs.get(id))
        self.ctx.db.run("DELETE FROM pending_interactions WHERE id=?", id)
        self._settle(row, None)
        self._runs.pop(id, None)
        waiter = self._waiters.get(id)
        if waiter and not waiter.done():
            waiter.set_result(status)
        self._emit(card, status)

    def abort_for_run(self, run_id: str) -> None:
        for row in self.ctx.db.all("SELECT * FROM pending_interactions"):
            if loads(row["request"], {}).get("runId") == run_id:
                self._close(row, "aborted")

    def abort_for_chat(self, chat_id: str) -> None:
        for row in self.ctx.db.all("SELECT * FROM pending_interactions WHERE chat_id=?", chat_id):
            self._close(row, "aborted")

    def expire(self) -> None:
        for row in self.ctx.db.all("SELECT * FROM pending_interactions WHERE expires_at<=?", now_ms()):
            self._close(row, "expired")

    def _tell_bot(self, bot_id: str, chat_id: str, text: str) -> None:
        inbox.enqueue(self.ctx.db, bot_id, chat_id, "answer", {"text": text})

    def _wake(self, bot_id: str) -> None:
        wake = getattr(self.ctx.parts.get("runtime"), "wake", None)
        if wake:
            wake(bot_id)

    # ------------------------------------------------------------ Approval gate (ledger-backed, contract wave 1)
    def _rule(self, bot_id: str, approval_kind: str, reason: str, allow: bool = True) -> str | None:
        """"deny" always wins (bot or global rule); "allow" only for kinds that may be "always"; other modes (old "ask") do not count."""
        modes = {r["mode"] for r in self.ctx.db.all(
            "SELECT mode FROM approval_rules WHERE user_id='local' AND tool=? AND (bot_id=? OR bot_id IS NULL)", approval_kind, bot_id)}
        if "deny" in modes:
            return "deny"
        return "allow" if allow and "allow" in modes and not no_rule(approval_kind, reason) else None

    @staticmethod
    def _payload(name: str, args: dict) -> dict:
        return {"tool": name, "input": args}

    def _digest(self, run, name: str, args: dict, approval_kind: str) -> str:
        return ledger.digest(actor_bot_id=run.bot["id"], principal_id=PRINCIPAL, action_class=approval_kind, target=name,
                             account=None, recipients=[], payload=self._payload(name, args))

    def _root_run(self, run) -> str | None:
        try:
            return self.ctx.db.val("SELECT root_run_id FROM work_runs WHERE id=?", run.id)
        except Exception:
            return None

    def _take_once(self, run, name: str, args: dict, approval_kind: str | None = None):
        """Consumes an unused one-off approval for exactly this chat, tool, Orbi and input.
        Returns a claim ticket for a ledger-backed approval, True for an old approval without an effect, else None."""
        db = self.ctx.db
        for row in db.all("SELECT id, request, result FROM interaction_results WHERE chat_id=? AND kind='approval' AND used_at IS NULL ORDER BY created_at", run.chat_id):
            request = loads(row["request"], {})
            if not (loads(row["result"], {}).get("decision") in ("once", "always") and request.get("tool") == name
                    and request.get("botId") == run.bot["id"] and request.get("input") == args):
                continue
            effect_id = request.get("effectId")
            effect = ledger.effect(db, effect_id) if effect_id else None
            if effect_id and (effect is None or effect["status"] != "approved"):
                continue  # expired, interrupted by a restart or already used: ask again
            if db.run("UPDATE interaction_results SET used_at=? WHERE id=? AND used_at IS NULL", now_ms(), row["id"]) == 1:
                return self._ticket(effect, name, args) if effect else True
        return None

    @staticmethod
    def _ticket(effect: dict, name: str, args: dict) -> dict:
        return {"effectId": effect["id"], "version": effect["version"], "payload": {"tool": name, "input": args}}

    def _blocked(self, run, digest: str, root: str | None) -> dict | None:
        """The last denied effect with exactly this payload in this run (or its tree): an unchanged retry keeps that block."""
        return self.ctx.db.one(
            "SELECT * FROM effects WHERE chat_id=? AND actor_bot_id=? AND payload_digest=? AND status='denied' "
            "AND (run_id=? OR (? IS NOT NULL AND root_run_id=?)) ORDER BY updated_at DESC LIMIT 1",
            run.chat_id, run.bot["id"], digest, run.id, root, root)

    def _open_card(self, run, name: str):
        """Live approval card of this run and tool (at most one), with its effect row."""
        for row in self.ctx.db.all("SELECT * FROM pending_interactions WHERE chat_id=? AND kind='approval' ORDER BY requested_at", run.chat_id):
            req = loads(row["request"], {})
            if req.get("runId") == run.id and req.get("tool") == name and req.get("effectId"):
                return row, ledger.effect(self.ctx.db, req["effectId"])
        return None, None

    async def gate(self, run, tool, args: dict, risk=None):
        """tool: Tool or name. Without a risk the call proceeds. Otherwise rule, one-off approval or card with waiting.
        Returns a claim ticket {effectId, version, payload} when a ledger effect was approved for exactly this call
        (the bridge claims it right before the handler), else None."""
        name = getattr(tool, "name", tool)
        if risk is None and getattr(tool, "risk", None):
            risk = tool.risk(run, args)
        if risk is None:
            return None
        # Publishing counts like sending; cards only for money, sending and login (Consti 20.11.2026)
        reason = "nachricht" if risk.reason == "veroeffentlichen" else risk.reason
        rule = self._rule(run.bot["id"], risk.approval_kind, reason, allow=not contract.foreign(run))
        if rule == "deny":
            raise Fail(BLOCKED_RULE)
        if reason not in ASK_REASONS or rule == "allow":
            return None
        taken = self._take_once(run, name, args, risk.approval_kind)
        if isinstance(taken, dict):
            return taken
        if taken:
            return None
        db, root = self.ctx.db, self._root_run(run)
        digest = self._digest(run, name, args, risk.approval_kind)
        denied = self._blocked(run, digest, root)
        if denied:
            raise Fail(DENIED + " " + RETRY_BLOCKED)
        old_row, old_effect = self._open_card(run, name)
        try:
            if old_effect and old_effect["payload_digest"] == digest and old_effect["status"] in ("pending", "interrupted"):
                raise Fail(ONE_CARD)
            if old_effect and old_effect["status"] in ("pending", "draft"):
                # changed payload while the old card is open: the old review is superseded, a fresh card follows
                effect_id = ledger.revise(db, old_effect["id"], old_effect["version"], self._payload(name, args))
                self._close(old_row, "superseded")
            else:
                effect_id = ledger.open_effect(db, chat_id=run.chat_id, actor_bot_id=run.bot["id"], action_class=risk.approval_kind,
                                               target=name, payload=self._payload(name, args), run_id=run.id, root_run_id=root,
                                               principal_id=PRINCIPAL)
        except ledger.LedgerError as e:
            raise Fail(str(e)) from None
        extra = {"reason": reason, "approvalKind": risk.approval_kind, "text": risk.text, "effectId": effect_id}
        if risk.detail:
            extra["detail"] = risk.detail
        card = self._create(run, "approval", name, new_id(), args, **extra)
        waiter = self._waiters[card["id"]] = asyncio.get_running_loop().create_future()
        show = getattr(run, "approval", None) or (lambda *a: None)  # card as a tool part in the chat stream (that is how the app shows it)
        show(name, card["toolCallId"], args, card["id"], "requested")
        run.set_waiting(True)
        try:
            await asyncio.wait({waiter}, timeout=contract.APPROVAL_WAIT_S)
        except asyncio.CancelledError:  # the caller gave up: close the card, otherwise dead cards pile up
            try:
                row = self.ctx.db.one("SELECT * FROM pending_interactions WHERE id=?", card["id"])
                if row:
                    self._close(row, "aborted")
                show(name, card["toolCallId"], args, card["id"], "expired")
            except Exception:
                log.exception("card not closed after cancellation")
            raise
        finally:
            run.set_waiting(False)
            self._waiters.pop(card["id"], None)
        outcome = waiter.result() if waiter.done() else "timeout"
        if outcome != "timeout":  # after the wait the card stays open
            show(name, card["toolCallId"], args, card["id"], {"once": "approved", "always": "approved", "deny": "denied"}.get(outcome, "expired"))
        if outcome in ("once", "always"):
            effect = ledger.effect(db, effect_id)
            if not effect or effect["status"] != "approved":
                raise Fail(GONE_CALL)
            return self._ticket(effect, name, args)
        if outcome == "deny":
            raise Fail(DENIED)
        if outcome == "timeout":
            raise Fail(WAITING)
        raise Fail(GONE_CALL)

    def claim(self, run, ticket) -> None:
        """Right before the handler: binds the single dispatch to the reviewed actor and payload (compare-and-set)."""
        if not isinstance(ticket, dict):
            return
        try:
            ticket["version"] = ledger.claim(self.ctx.db, ticket["effectId"], ticket["version"], actor_bot_id=run.bot["id"], payload=ticket["payload"])
        except ledger.LedgerError as e:
            raise Fail(str(e)) from None

    def settle(self, ticket, outcome: str, receipt=None) -> None:
        """After the handler: done | failed | unknown (never raises; a ledger error is logged)."""
        if not isinstance(ticket, dict):
            return
        db, eid = self.ctx.db, ticket["effectId"]
        try:
            if outcome == "done":
                ticket["version"] = ledger.record(db, eid, ticket["version"], "dispatched")
            ticket["version"] = ledger.record(db, eid, ticket["version"], outcome, receipt=receipt)
        except ledger.LedgerError:
            log.exception("effect outcome not recorded")

    async def decide(self, id: str, decision: str, principal: str = "local") -> None:
        """principal comes from the authenticated owner session (routes/interactions.py), never from a request body."""
        if decision not in ("once", "always", "deny"):
            raise HttpError(400, BAD_DECISION)
        row = self._row(id, "approval", GONE_APPROVAL, HttpError(409, EXPIRED_APPROVAL))
        card, db, t = self._card(row), self.ctx.db, now_ms()
        self._decide_effect(row, card.get("effectId"), decision != "deny", principal)
        waiter = self._waiters.get(id)
        waiting = waiter is not None and not waiter.done()
        rule = decision == "always" and not no_rule(str(card.get("approvalKind")), card.get("reason"))
        try:
            with db.tx():
                db.run("DELETE FROM pending_interactions WHERE id=?", id)
                if rule:
                    db.run("INSERT OR REPLACE INTO approval_rules (id,user_id,bot_id,tool,mode,created_at) VALUES (?,'local',?,?,'allow',?)",
                           new_id(), card["botId"], card["approvalKind"], t)
                # used = someone waits, the rule applies already, or denied; otherwise the one-off approval stays for the next call
                db.run("INSERT INTO interaction_results (id,chat_id,bot_id,kind,request,result,created_at,used_at) VALUES (?,?,?,?,?,?,?,?)",
                       id, card["chatId"], card["botId"], "approval", row["request"], dumps({"decision": decision, "at": t}), t,
                       t if waiting or rule or decision == "deny" else None)
                if not waiting:
                    self._tell_bot(card["botId"], card["chatId"], self._late_text(card, decision))
        except Exception:
            log.exception("decision not stored")
            raise HttpError(500, NOT_STORED) from None
        run = self._runs.pop(id, None)
        if not waiting:  # nobody waits: close the part, through the live run if there is one (otherwise its next save overwrites it)
            if run is not None and card["toolCallId"] in getattr(run, "cards", {}):
                run.approval(card["tool"], card["toolCallId"], card.get("input") or {}, id, "denied" if decision == "deny" else "approved")
            else:
                self._settle(row, "output-denied" if decision == "deny" else None)
        self._emit(card, "denied" if decision == "deny" else "approved")
        if waiting:
            waiter.set_result(decision)
        else:
            self._wake(card["botId"])

    def _decide_effect(self, row, effect_id: str | None, approve: bool, principal: str) -> None:
        """ledger.decide at the top level. An interrupted card (restart) is restored first. A retry after a storage failure
        finds the same decision already recorded and goes on. Expiry or a stop closes the card."""
        if not effect_id:
            return  # card from before the ledger: decided only through interaction_results
        db = self.ctx.db
        effect = ledger.effect(db, effect_id)
        if effect is None:
            self._close(row, "aborted")
            raise HttpError(410, GONE_APPROVAL)
        if effect["status"] == ("approved" if approve else "denied") and effect["decided_by"] == principal:
            return
        try:
            version = effect["version"]
            if effect["status"] == "interrupted":
                version = ledger.restore(db, effect_id, version)
            ledger.decide(db, effect_id, approve, version, principal)
        except ledger.LedgerError as e:
            after = ledger.effect(db, effect_id) or {}
            if after.get("status") in contract.EFFECT_TERMINAL:
                self._close(row, "expired" if after.get("status") == "expired" else "aborted")
            raise HttpError(409, str(e)) from None

    @staticmethod
    def _late_text(card: dict, decision: str) -> str:
        what = f"\"{card.get('text') or card['tool']}\""
        if decision == "deny":
            return f"Consti declined the action {what}. Do not run it."
        return (f"Consti approved the action {what}. Run it now: tool {card['tool']} with exactly the same input as before. "
                "The approval covers exactly this one call.")

    # ------------------------------------------------------------ Rückfragen
    def ask(self, run, tool_call_id: str, questions: list, *, computer_takeover: str | None = None,
            connector_connect: dict | None = None) -> dict:
        """Legt die Karte an und kehrt sofort zurück: der Orbi arbeitet weiter, die Antwort kommt als Postfach-Eintrag."""
        input_data = {"questions": questions}
        if computer_takeover is not None:
            input_data["computerTakeover"] = {"label": computer_takeover}
        if connector_connect is not None:
            input_data["connectorConnect"] = connector_connect
        tool = "InstallPlugin" if connector_connect is not None else "ask_user"
        card = self._create(run, "ask", tool, tool_call_id, input_data)
        return {"asked": True, "id": card["id"], "message": "The question card is out. Keep working on everything that does not depend on the answer; "
                "the answer arrives later as a new message. In the chat text: do not repeat what you already wrote, "
                "do not write the question or options again, no question mark. If the result is still missing, say so briefly in your own words, "
                "no fixed closing phrase."}

    @staticmethod
    def _valid_answer(body, questions: list) -> dict | None:
        """Gibt {"skipped": True} oder {"answers": [...]} zurück, sonst None."""
        if not isinstance(body, dict):
            return None
        if body.get("skipped") is True:
            return {"skipped": True}
        answers, asked = body.get("answers"), {q.get("question") for q in questions}
        if not isinstance(answers, list) or len(answers) > len(asked):
            return None
        for a in answers:
            if not (isinstance(a, dict) and a.get("question") in asked and isinstance(a.get("answers"), list)
                    and all(isinstance(x, str) for x in a["answers"])):
                return None
        return {"answers": [{"question": a["question"], "answers": a["answers"]} for a in answers]}

    async def answer(self, id: str, body) -> None:
        for prefix, handler in self.handlers.items():
            if id.startswith(prefix):
                await handler(id, body)
                row = self.ctx.db.one("SELECT * FROM pending_interactions WHERE id=?", id)
                if row:  # der Haken hat die Karte nicht selbst geschlossen
                    self.ctx.db.run("DELETE FROM pending_interactions WHERE id=?", id)
                    self._emit(self._card(row), "answered")
                return
        row = self._row(id, "ask", GONE_QUESTION, HttpError(400, BAD_ANSWER))
        card, db, t = self._card(row), self.ctx.db, now_ms()
        result = self._valid_answer(body, card["input"].get("questions", []))
        if result is None:
            raise HttpError(400, BAD_ANSWER)
        with db.tx():
            db.run("DELETE FROM pending_interactions WHERE id=?", id)
            db.run("INSERT INTO interaction_results (id,chat_id,bot_id,kind,request,result,created_at,used_at) VALUES (?,?,?,?,?,?,?,?)",
                   id, card["chatId"], card["botId"], "ask", row["request"], dumps(result), t, t)
            self._tell_bot(card["botId"], card["chatId"], self._answer_text(card, result))
        run = self._runs.pop(id, None)
        self._set_part(row, card, result, run)
        self._emit(card, "answered")
        self._wake(card["botId"])

    @staticmethod
    def _answer_text(card: dict, result: dict) -> str:
        if result.get("skipped"):
            conn = (card.get("input") or {}).get("connectorConnect") if card.get("tool") == "InstallPlugin" else None
            if isinstance(conn, dict) and conn.get("name"):
                return (f"Consti skipped connecting {conn.get('name')} ({conn.get('slug')}). "
                        "Do not claim it is connected. One short German line is enough.")
            return SKIPPED_TEXT
        conn = (card.get("input") or {}).get("connectorConnect") if card.get("tool") == "InstallPlugin" else None
        if isinstance(conn, dict) and conn.get("slug"):
            name, slug = conn.get("name") or conn["slug"], conn["slug"]
            return (f"Consti connected {name} (plugin_id={slug}). "
                    f"Now verify it works: call connector_plugins__search with toolkit={slug} "
                    "(or GetPlugin). Then tell Consti in one short German sentence whether it runs "
                    "or what failed — no Settings detour.")
        lines = [f"- {a['question']} → {', '.join(a['answers']) or '(skipped)'}" for a in result["answers"]]
        return "Consti answered:\n" + "\n".join(lines) if lines else SKIPPED_TEXT

    def _set_part(self, row, card: dict, output: dict, run) -> None:
        """Karten-Teil auf output-available. Lebt der Lauf, geht es über ihn (er hält die Nachricht im Speicher), sonst direkt im Verlauf."""
        tool = card.get("tool") or "ask_user"
        if self._live(run):
            run.card(tool, card["toolCallId"], card["input"], output)
            return
        from .. import chatstore
        message_id = loads(row["request"], {}).get("_messageId")
        message = message_id and chatstore.get(self.ctx.db, card["chatId"], message_id)
        if not message:
            return
        for part in message["parts"]:
            if part.get("toolCallId") == card["toolCallId"] and part.get("type") in (f"tool-{tool}", "tool-ask_user", "tool-InstallPlugin"):
                part["state"], part["output"] = "output-available", output
        chatstore.update(self.ctx.db, card["chatId"], message_id, message["parts"])

    # ------------------------------------------------------------ Choice widgets (SendToUser)
    def open_widget(self, run, delivery_id: str, input: dict) -> None:
        """Tracks an unanswered choice card. delivery_id is the toolCallId and the answer route id."""
        t = now_ms()
        card = {"id": delivery_id, "kind": "widget", "chatId": run.chat_id, "botId": run.bot["id"],
                "toolCallId": delivery_id, "tool": "SendToUser", "input": input,
                "requestedAt": t, "expiresAt": t + contract.INTERACTION_TTL_MS, "runId": run.id}
        self.ctx.db.run(
            "INSERT INTO pending_interactions (id,chat_id,bot_id,kind,request,requested_at,expires_at) VALUES (?,?,?,?,?,?,?)",
            delivery_id, run.chat_id, card["botId"], "widget", dumps({**card, "_messageId": run.message_id}), t, card["expiresAt"])
        self._runs[delivery_id] = run

    @staticmethod
    def _valid_widget_answer(body, widget: dict) -> dict | None:
        if not isinstance(body, dict) or not isinstance(widget, dict):
            return None
        selected = body.get("selected")
        if not isinstance(selected, list) or not all(isinstance(x, str) for x in selected):
            return None
        custom = body.get("custom")
        if custom is not None and not isinstance(custom, str):
            return None
        options = widget.get("options") or []
        ids = {(o.get("id") if isinstance(o, dict) else None) or f"o{i}" for i, o in enumerate(options)}
        if len(set(selected)) != len(selected) or any(s not in ids for s in selected):
            return None
        custom_text = custom.strip() if isinstance(custom, str) else ""
        if custom_text and not widget.get("allowCustom"):
            return None
        if widget.get("multiple"):
            if not selected and not (widget.get("allowCustom") and custom_text):
                return None
        else:
            if len(selected) + bool(custom_text) > 1:
                return None
            if len(selected) == 0 and not (widget.get("allowCustom") and custom_text):
                return None
        out = {"selected": list(selected)}
        if custom_text:
            out["custom"] = custom_text
        return out

    def _set_widget_output(self, row, card: dict, output: dict, run) -> None:
        if self._live(run):
            run.card("SendToUser", card["toolCallId"], card.get("input") or {}, output)
            return
        message_id = loads(row["request"], {}).get("_messageId")
        message = message_id and chatstore.get(self.ctx.db, card["chatId"], message_id)
        if not message:
            return
        for part in message["parts"]:
            if part.get("type") == "tool-SendToUser" and part.get("toolCallId") == card["toolCallId"]:
                part["state"], part["output"] = "output-available", output
        chatstore.update(self.ctx.db, card["chatId"], message_id, message["parts"])

    async def answer_widget(self, id: str, body) -> dict | None:
        row = self.ctx.db.one("SELECT * FROM pending_interactions WHERE id=?", id)
        if not row or row["kind"] != "widget":
            raise HttpError(410, WIDGET_GONE)
        if row["expires_at"] <= now_ms():
            self._close(row, "expired")
            raise HttpError(400, WIDGET_BAD)
        card = self._card(row)
        widget = (card.get("input") or {}).get("widget") or {}
        result = self._valid_widget_answer(body, widget)
        if result is None:
            raise HttpError(400, WIDGET_BAD)
        options = {o["id"]: o for o in widget["options"]}
        labels = [options[i].get("value") or options[i]["label"] for i in result["selected"]]
        if result.get("custom"):
            labels.append(result["custom"])
        return await self._finish_chat_card(row, result, "\n".join(labels), widget.get("prompt") or "",
                                            body.get("deliverReply") is True)

    async def _finish_chat_card(self, row, result, text: str, prompt: str, deliver_reply: bool):
        card, db = self._card(row), self.ctx.db
        message_id = loads(row["request"], {}).get("_messageId")
        card_id, chat_id = row["id"], card["chatId"]

        def commit():
            if db.run("DELETE FROM pending_interactions WHERE id=?", card_id) != 1:
                raise HttpError(410, WIDGET_GONE if row["kind"] == "widget" else SECRET_GONE)
            t = now_ms()
            db.run("INSERT INTO interaction_results (id,chat_id,bot_id,kind,request,result,created_at,used_at) VALUES (?,?,?,?,?,?,?,?)",
                   card_id, chat_id, card["botId"], row["kind"], row["request"], dumps(result), t, t)
            self._set_widget_output(row, card, result, self._runs.get(card_id))

        reply_id = f"answer-{card_id}"
        if deliver_reply:
            bot = db.one("SELECT b.name FROM bots b JOIN chat_members m ON m.bot_id=b.id "
                         "WHERE m.chat_id=? AND b.id=? AND b.archived_at IS NULL", chat_id, card["botId"])
            if not bot:
                raise HttpError(410, "The Orbi that asked is no longer in this chat.")
            await self.ctx.parts["runtime"].submit(chat_id, {
                "messages": [{"id": reply_id, "role": "user", "parts": [{"type": "text", "text": text}]}],
                "clientData": {"botId": card["botId"], "replyTo": {"id": message_id, "name": bot["name"], "text": prompt}},
            }, commit_card_answer=commit)
        else:
            with db.tx():
                commit()
        self._runs.pop(card_id, None)
        self._publish_message(chat_id, message_id)
        return {"ok": True, "replyMessageId": reply_id} if deliver_reply else None

    def move_on(self, chat_id: str):
        """Dismiss unanswered choice and secret cards when Consti sends a new message. Already answered cards stay."""
        moved = []
        for row in self.ctx.db.all(
                "SELECT * FROM pending_interactions WHERE chat_id=? AND kind IN ('widget','secret')", chat_id):
            card = self._card(row)
            if row["kind"] == "widget" and (card.get("input") or {}).get("widget", {}).get("dismissOnMoveOn") is False:
                continue
            message_id = loads(row["request"], {}).get("_messageId")
            self._set_widget_output(row, card, {"movedOn": True}, self._runs.pop(row["id"], None))
            self.ctx.db.run("DELETE FROM pending_interactions WHERE id=?", row["id"])
            moved.append((chat_id, message_id))
        return moved

    def publish_widget_updates(self, moved) -> None:
        seen = set()
        for chat_id, message_id in moved:
            key = (chat_id, message_id)
            if key in seen:
                continue
            seen.add(key)
            self._publish_message(chat_id, message_id)

    def open_secret(self, run, delivery_id: str, input: dict) -> None:
        """Tracks an unanswered secure-input card. delivery_id is the toolCallId and the answer route id."""
        t = now_ms()
        card = {"id": delivery_id, "kind": "secret", "chatId": run.chat_id, "botId": run.bot["id"],
                "toolCallId": delivery_id, "tool": "SendToUser", "input": input,
                "requestedAt": t, "expiresAt": t + contract.INTERACTION_TTL_MS, "runId": run.id}
        self.ctx.db.run(
            "INSERT INTO pending_interactions (id,chat_id,bot_id,kind,request,requested_at,expires_at) VALUES (?,?,?,?,?,?,?)",
            delivery_id, run.chat_id, card["botId"], "secret", dumps({**card, "_messageId": run.message_id}), t, card["expiresAt"])
        self._runs[delivery_id] = run

    async def answer_secret(self, id: str, body) -> dict | None:
        """Stores the value in Orbit secrets and closes the card. The secret value is never written to chat or results."""
        from .. import keychain
        from ..tools.work import normalize_secret, secret_account
        row = self.ctx.db.one("SELECT * FROM pending_interactions WHERE id=?", id)
        if not row or row["kind"] != "secret":
            raise HttpError(410, SECRET_GONE)
        if row["expires_at"] <= now_ms():
            self._close(row, "expired")
            raise HttpError(400, SECRET_BAD)
        card = self._card(row)
        secret = normalize_secret((card.get("input") or {}).get("secret"))
        value = body.get("value") if isinstance(body, dict) else None
        if secret is None or not isinstance(value, str) or not value.strip() or len(value) > 16384:
            raise HttpError(400, SECRET_BAD)
        account = secret_account(secret)
        try:
            await keychain.set_item(keychain.SERVICE, account, value.strip())
        except ValueError:
            raise HttpError(400, SECRET_BAD) from None
        result = {"stored": True, "name": secret["name"], **({"pluginId": secret["plugin_id"]} if secret.get("plugin_id") else {})}
        return await self._finish_chat_card(row, result, "Saved securely", secret["label"], body.get("deliverReply") is True)

    def replay_widget(self, row: dict) -> bool:
        """Show a committed widget or secret-request delivery that never reached the chat (after a crash)."""
        import sqlite3
        db, delivery_id, chat_id = self.ctx.db, row["id"], row["chat_id"]
        delivery_kind = row["kind"]
        field, pending_kind = ("secret", "secret") if delivery_kind == "secret-request" else ("widget", "widget")
        stored = next((p for p in row.get("parts") or [] if p.get("type") == delivery_kind and p.get(field)), None)
        if stored is None:
            return bool(ledger.mark_emitted(db, delivery_id))
        input_data = {k: stored[k] for k in (field, "markdown", "images") if k in stored}
        message_id = row.get("message_id") or delivery_id
        part = {"type": "tool-SendToUser", "toolCallId": delivery_id, "state": "input-available", "input": input_data}
        with db.tx():
            if not ledger.mark_emitted(db, delivery_id):
                return False
            if any(p.get("toolCallId") == delivery_id for m in chatstore.messages(db, chat_id) for p in m["parts"]):
                return False
            bot_id = db.val("SELECT owner_bot_id FROM work_runs WHERE id=?", row["run_id"]) if row.get("run_id") else None
            if bot_id is None and row.get("run_id"):
                bot_id = db.val("SELECT bot_id FROM work_runs WHERE id=?", row["run_id"])
            meta = {k: v for k, v in {"botId": bot_id, "replayed": True}.items() if v is not None}
            try:
                if chatstore.exists(db, chat_id, message_id):
                    message = chatstore.get(db, chat_id, message_id)
                    message["parts"].append(part)
                    chatstore.update(db, chat_id, message_id, message["parts"], meta or None)
                else:
                    chatstore.add(db, chat_id, message_id, "assistant", [{"type": "step-start"}, part], meta or None)
            except sqlite3.IntegrityError:
                db.run("UPDATE deliveries SET status='refused', emitted_at=NULL WHERE id=?", delivery_id)
                return False
            if not db.one("SELECT 1 FROM pending_interactions WHERE id=?", delivery_id):
                t = now_ms()
                card = {"id": delivery_id, "kind": pending_kind, "chatId": chat_id, "botId": bot_id or "",
                        "toolCallId": delivery_id, "tool": "SendToUser", "input": input_data,
                        "requestedAt": t, "expiresAt": t + contract.INTERACTION_TTL_MS}
                db.run("INSERT INTO pending_interactions (id,chat_id,bot_id,kind,request,requested_at,expires_at) VALUES (?,?,?,?,?,?,?)",
                       delivery_id, chat_id, bot_id or "", pending_kind, dumps({**card, "_messageId": message_id}), t, card["expiresAt"])
        self._publish_message(chat_id, message_id)
        return True
