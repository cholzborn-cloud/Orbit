"""Ein Lauf: startet die Agent-CLI, übersetzt ihre Ereignisse in Strom-Chunks und Verlauf, speichert absturzsicher.

Erfüllt `contract.Run`. Reihenfolge am Ende (Regel 6): ERST der Status in der Datenbank, DANN Ereignisse, Prozessbaum, Strom.

Wave 2A (Word 1.1, public/private events): plain model text is private. It is collected in `self.raw` and never streamed or
persisted while the run is live. The model publishes through SendToUser (tools/work.py -> Runner.publish: commit_delivery,
chat write and mark_emitted in one transaction, then stream chunks). The final raw text is stored as a private `report`
delivery. Compatibility fallback: a foreground run that ends without any SendToUser delivery publishes its final text once.
A child run (role != foreground) has no stream and no chat answer; it reports privately to its parent (engine.child_finished).
"""
import asyncio
import base64
import logging
import os
import re
import sqlite3
import time
import urllib.parse
from contextlib import aclosing
from pathlib import Path

from .. import chatstore, cli
from ..cli import CliError, Turn
from ..db import dumps, new_id, now_ms
from ..limits import BLOCK_DEFAULT_MS
from . import contract, inbox, ledger
from .contract import Outcome
from .recovery import proc_start

log = logging.getLogger("orbitd")
GENERIC_ERROR = "The answer could not be created."
SEND_PER_RUN = 20  # SendToUser deliveries per run
SAVE_EVERY_S = 3
ARG_KEYS = ("command", "path", "file_path", "query", "url", "pattern", "name")
MAX_UPLOAD, TEXT_INLINE = 25 * 1024 * 1024, 20000
MAX_PROMPT_IMAGE = 4 * 1024 * 1024  # Base64-Zeichen je Bild im Prompt (Claude)
TEXT_TYPES = ("text/", "application/json", "application/xml", "application/x-yaml")
UPLOADS_DIR = "/home/daytona/uploads"  # wie lib/chat/attachments.ts
_background: set = set()  # Hintergrundaufgaben (Zusammenfassung) am Leben halten
RESUME_HINT = "Your last run was interrupted by a restart. First check what is already done, then continue."
RESUME_TASK = "Your last task {who} was:\n"  # engine.resume splits on "was:\n"


class Counters(dict):
    """Zähler des Laufs. „eigen“ (Brain, Kalender, Dateien gelesen) gilt nur für diesen Lauf.
    „untrusted“ (Fremddaten von außen: Web, Composio, MCP, Bildschirm, Orbi-Nachricht) wird sofort je Chat und Orbi gemerkt und gilt, bis der Chat geleert wird (chatstore.clear):
    der frühere Verlauf kommt auch ohne Sitzung (z. B. Programmwechsel) wieder in den Prompt."""
    def __init__(self, db, key: str):
        super().__init__()
        self.db, self.key = db, key

    def __setitem__(self, key, value):
        super().__setitem__(key, value)
        if key == "untrusted" and value:
            super().__setitem__("untrusted_now", True)  # in DIESEM Lauf von außen gelesen (nicht nur aus früheren Läufen übernommen)
            self.db.run("INSERT OR REPLACE INTO app_kv (key,value,updated_at) VALUES (?,?,?)", self.key, "1", now_ms())


def short(text: str, limit: int = 80) -> str:
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[:limit - 1] + "…"


class Runner:
    def __init__(self, rt, run_id: str, bot: dict, chat: dict, items: list[dict], model: dict | None, effort: str | None,
                 root: dict, jev: dict | None, session: str | None, error: str | None, fast: str | None = None,
                 identity: dict | None = None, brief: dict | None = None):
        self.rt, self.ctx, self.db = rt, rt.ctx, rt.ctx.db
        self.id, self.bot, self.chat, self.items = run_id, bot, chat, items
        self.chat_id, self.chat_kind = chat["id"], chat["kind"]
        self.model, self.effort, self.root, self.jev, self.session, self.preset_error = model, effort, root, jev, session, error
        self.fast = fast
        # Work identity (contract.WorkIdentity, persisted on work_runs by the engine)
        ident = identity or {}
        self.role = ident.get("role") or "foreground"
        self.lane = ident.get("lane") or "interactive"
        self.is_child = self.role != "foreground"
        self.parent_run_id = ident.get("parent_run_id")
        self.root_run_id = ident.get("root_run_id") or (root or {}).get("taskId") or run_id
        self.request_id = ident.get("request_id")
        self.attempt = int(ident.get("attempt") or 1)
        self.brief = brief
        if self.is_child:
            # Background workers never talk to the user directly (tools gated by `_no_background` see a background run).
            self.chat_kind = "automation"
        self.message_id = new_id()
        key = f"untrusted:{chat['id']}:{bot['id']}"
        self.counters = Counters(self.db, key)
        if self.db.val("SELECT 1 FROM app_kv WHERE key=?", key):
            dict.__setitem__(self.counters, "untrusted", True)
        folder = f"{bot['id']}-{chat['id']}" + (f"-{run_id}" if self.is_child else "")  # a child never shares the foreground's folder
        self.work = self.ctx.cfg.work_dir / re.sub(r"[^\w.-]", "_", folder)  # leer, außerhalb des Datenordners
        self.automation_id = items[0]["payload"].get("automationId")  # None, wenn der Zug nicht aus einer Routine stammt
        self.from_orbi = any(i["payload"].get("orbi") for i in items)
        if self.from_orbi:  # Orbi-Nachricht = Stufe „extern“: bleibt je Chat und Orbi wie Web-Inhalte
            self.counters["untrusted"] = True
        self.calls: set[asyncio.Task] = set()  # laufende Werkzeug-Aufrufe der Brücke; Stopp und Abschluss brechen sie ab
        self.task: asyncio.Task | None = None
        self.tree = None
        self.finished = asyncio.Event()
        self.started_at = now_ms()
        # Zustand des Laufs
        self.parts: list[dict] = []        # PUBLIC parts of the assistant message (without step-start)
        self.cards: dict[str, dict] = {}
        self.raw: list[tuple[int, dict, list[str]]] = []  # private model text: (position in parts, part, deltas)
        self.open_text: tuple[str, dict, list[str]] | None = None
        self.text_n = 0
        self.full_text = ""
        self.turn_start = 0                # start of the current CLI turn in full_text (children run several turns)
        self.sent = 0                      # SendToUser deliveries in this run
        self.end_turn = False
        self.reply_meta: dict | None = None
        self.hold = ""                     # Textanfang, der noch wie SILENT aussieht
        self.started = self.saved = self.finalizing = False
        self.stopped = self.done_ev = False
        self.error: str | None = None
        self.usage = {"inputTokens": 0, "outputTokens": 0, "cachedTokens": 0, "costUsd": None}
        self.steps, self.seq = 0, 0
        self.open_steps: dict[str, dict] = {}
        self.labels: dict[str, str] = {}
        self.skipped: set[str] = set()
        self.think_buf, self.think_id, self.think_started = "", None, False
        self.status = "arbeitet"
        self.t0 = self.activity = self.last_save = time.monotonic()
        self.waited, self.wait_since = 0.0, None
        self.session_id: str | None = session
        self.turn_context = None
        self.token: str | None = None
        self.stream = None

    # ------------------------------------------------------------ contract.Run
    def card(self, tool: str, tool_call_id: str, input: dict, output: dict | None = None) -> None:
        part = self.cards.get(tool_call_id)
        if part is None:
            self._flush_hold()
            self._close_text()
            self._ensure_started()
            part = {"type": f"tool-{tool}", "toolCallId": tool_call_id, "state": "input-available", "input": input}
            self.parts.append(part)
            self.cards[tool_call_id] = part
            self._emit({"type": "tool-input-available", "toolCallId": tool_call_id, "toolName": tool, "input": input})
        if output is not None:
            part["state"], part["output"] = "output-available", output
            self._emit({"type": "tool-output-available", "toolCallId": tool_call_id, "output": output})
        self.save()

    def approval(self, tool: str, tool_call_id: str, input: dict, approval_id: str, state: str) -> None:
        """Freigabekarte im Chat: die App zeigt sie nur an einem Werkzeug-Teil im Zustand approval-requested (Chunk tool-approval-request).
        state: requested | approved | denied | expired."""
        if state == "requested":
            self.card(tool, tool_call_id, input)
            self.cards[tool_call_id].update(state="approval-requested", approval={"id": approval_id})
            self._emit({"type": "tool-approval-request", "approvalId": approval_id, "toolCallId": tool_call_id})
        elif tool_call_id in self.cards:
            part = self.cards.pop(tool_call_id)
            if state == "expired":  # hinfällig (Stopp, Programm gab auf): Karte verschwindet
                self._emit({"type": "tool-output-error", "toolCallId": tool_call_id, "errorText": "Approval not answered."})
            else:
                self._emit({"type": "tool-approval-response", "approvalId": approval_id, "toolCallId": tool_call_id, "approved": state == "approved"})
            if state == "denied":
                part["state"] = "output-denied"
            else:  # erlaubt oder hinfällig: nichts im Verlauf behalten (das Werkzeug zeigt sein Ergebnis selbst)
                self.parts.remove(part)
                if self.saved and not self._has_content():
                    chatstore.remove(self.db, self.chat_id, self.message_id)
                    self.saved = False
        self.save()

    def step(self, tool_call_id: str, tool: str, label: str, state: str) -> None:
        label = " ".join((label or tool or "").split()) or "Schritt"
        at = now_ms()
        self.touch()
        if state == "end":
            self.open_steps.pop(tool_call_id, None)
        else:
            self.steps += 1
            self.open_steps[tool_call_id] = {"chatId": self.chat_id, "botId": self.bot["id"], "toolCallId": tool_call_id,
                                             "label": label, "tool": tool, "step": self.steps, "at": at}
        self.seq += 1
        self.db.run("INSERT INTO run_events (run_id,seq,at,type,data) VALUES (?,?,?,?,?)", self.id, self.seq, at, "status-step",
                    dumps({"toolCallId": tool_call_id, "tool": tool, "label": label, "state": state}))
        if self.is_child:
            return  # private diagnostics only (CheckSubagent reads run_events); the chat's live bar shows the foreground
        self.ctx.bus.publish({"type": "status-step", "chatId": self.chat_id, "botId": self.bot["id"], "toolCallId": tool_call_id,
                              "label": label, "state": "end" if state == "end" else "start", "tool": tool, "step": self.steps, "at": at})

    def set_waiting(self, waiting: bool) -> None:
        now = time.monotonic()
        if waiting and self.wait_since is None:
            self.wait_since = now
        elif not waiting and self.wait_since is not None:
            self.waited += now - self.wait_since
            self.wait_since = None
            self.touch()
        self._status("wartet" if waiting else "arbeitet")
        if self.automation_id:
            self.rt.automation_waiting(self.items[0]["payload"]["automationRunId"], waiting)

    # ------------------------------------------------------------ Hilfen
    def touch(self) -> None:
        self.activity = time.monotonic()

    def _status(self, status: str) -> None:
        self.status = status
        if not self.is_child:
            self.ctx.bus.publish({"type": "status", "chatId": self.chat_id, "botId": self.bot["id"], "status": status})

    def _emit(self, chunk: dict) -> None:
        self.touch()
        if self.stream is not None:  # a child has no chat stream
            self.stream.emit(chunk)

    def _meta(self, final: bool = False) -> dict:
        meta = {"botId": self.bot["id"], "model": self.model["label"] if self.model else None, "effort": self.effort, "startedAt": self.started_at,
                "replyTo": self.reply_meta, "subagent": {"id": self.id, "role": self.role} if self.is_child else None}
        if final:
            meta.update(finishedAt=now_ms(), inputTokens=self.usage["inputTokens"], outputTokens=self.usage["outputTokens"],
                        cachedTokens=self.usage["cachedTokens"], steps=max(1, self.steps))
            if self.usage["costUsd"] is not None:
                meta["costUsd"] = self.usage["costUsd"]
            if self.jev:
                meta["jev"] = self.jev
        return {k: v for k, v in meta.items() if v is not None}

    def _ensure_started(self) -> None:
        if not self.started:
            self.started = True
            self._emit({"type": "start", "messageId": self.message_id, "messageMetadata": self._meta()})
            self._emit({"type": "start-step"})

    def _has_content(self) -> bool:
        return any(p["type"] != "text" or p["text"].strip() for p in self.parts)

    def save(self, final: bool = False) -> None:
        """Verlauf fortschreiben (Teile + Metadaten). Eine Nachricht je Lauf; leer wird nichts gespeichert."""
        self.last_save = time.monotonic()
        if not self._has_content():
            return
        parts = [{"type": "step-start"}, *self.parts]
        try:
            if self.saved:
                chatstore.update(self.db, self.chat_id, self.message_id, parts, self._meta(final))
            else:
                chatstore.add(self.db, self.chat_id, self.message_id, "assistant", parts, self._meta(final))
                self.saved = True
        except sqlite3.IntegrityError:
            pass  # Chat wurde während des Laufs gelöscht: nichts mehr zu speichern, der Lauf endet trotzdem sauber

    # ------------------------------------------------------------ Text (private until published)
    def _text(self, delta: str) -> None:
        if not delta:
            return
        self.full_text += delta
        if self.end_turn:
            return  # the turn was ended by a terminal SendToUser: later text is private and never published
        if not self.parts and not self.raw and len(self.hold) + len(delta) <= len(contract.SILENT) + 2 \
                and contract.SILENT.startswith((self.hold + delta).strip()):
            self.hold += delta  # könnte „still“ werden
            return
        self._flush_hold(delta)

    def _flush_hold(self, extra: str = "") -> None:
        """Raw model text goes into a private buffer: never streamed, never persisted while the run is live."""
        delta, self.hold = self.hold + extra, ""
        if not delta:
            return
        if self.open_text is None:
            pid = f"{self.message_id}~t{self.text_n}"
            self.text_n += 1
            part = {"type": "text", "id": pid, "text": "", "state": "done"}
            self.open_text = (pid, part, [])
            self.raw.append((len(self.parts), part, self.open_text[2]))
        _, part, deltas = self.open_text
        part["text"] += delta
        deltas.append(delta)

    def _restore_raw(self) -> list[dict]:
        """Compatibility fallback: put the private text parts back at their places in the public message."""
        restored = []
        for n, (pos, part, _) in enumerate(self.raw):
            if part["text"]:
                self.parts.insert(min(pos + len(restored), len(self.parts)), part)
                restored.append(part)
        return restored

    def _emit_text(self, part: dict, deltas: list[str] | None = None) -> None:
        self._ensure_started()
        self._emit({"type": "text-start", "id": part["id"]})
        for delta in deltas or [part["text"]]:
            self._emit({"type": "text-delta", "id": part["id"], "delta": delta})
        self._emit({"type": "text-end", "id": part["id"]})

    def report_text(self) -> str:
        """Private report of the run: the text of the last CLI turn (after a correction, earlier text is stale)."""
        last = self.full_text[self.turn_start:].strip()
        return last or self.full_text.strip()

    # ------------------------------------------------------------ SendToUser (Word 4.3): the only model-to-user path
    def publish(self, kind: str, parts: list[dict], *, key: str, audience: str = "chat", thread_root_id: str | None = None,
                end_turn: bool = False, artifacts: list | None = None, card_input: dict | None = None) -> dict:
        """commit_delivery -> chat write -> mark_emitted in ONE transaction (a crash leaves either nothing or a committed
        delivery that recovery.replay_deliveries shows once), then the stream chunks. Raises ledger.LedgerError."""
        if self.is_child:
            raise ledger.LedgerError("A background worker reports to its parent; it cannot write to the user.")
        if self.end_turn:
            raise ledger.LedgerError("This turn already ended with a final delivery.")
        if self.sent >= SEND_PER_RUN:
            raise ledger.LedgerError("Too many deliveries in one turn. Combine the rest into one message.")
        self._flush_hold()
        self._close_text()
        shown: list[dict] = []
        card_payload = None
        with self.db.tx():
            row, _ = ledger.commit_delivery(self.db, contract.Delivery(
                client_key=key, chat_id=self.chat_id, kind=kind, parts=parts, run_id=self.id, root_run_id=self.root_run_id,
                request_id=self.request_id, thread_root_id=thread_root_id, audience=audience, message_id=self.message_id,
                artifacts=artifacts or [], end_turn=end_turn))
            if row["status"] != "committed":
                return row  # replay of an already shown delivery
            if kind in ("widget", "secret-request"):
                card_payload = dict(card_input or {})
                part = {"type": "tool-SendToUser", "toolCallId": row["id"], "state": "input-available", "input": card_payload}
                self.parts.append(part)
                self.cards[row["id"]] = part
                self.save()
                if inter := self.ctx.parts.get("interactions"):
                    if kind == "widget":
                        inter.open_widget(self, row["id"], card_payload)
                    else:
                        inter.open_secret(self, row["id"], card_payload)
            else:
                for p in parts:
                    if p.get("type") == "text" and p.get("text"):
                        pid = f"{self.message_id}~t{self.text_n}"
                        self.text_n += 1
                        shown.append({"type": "text", "id": pid, "text": p["text"], "state": "done",
                                      "providerMetadata": {"orbit": {"deliveryId": row["id"]}}})
                    elif kind == "memo" and p.get("type") == "memo":
                        shown.append(p)
                    elif p.get("type") == "file" and p.get("url"):
                        shown.append({k: p[k] for k in ("type", "url", "mediaType", "filename") if p.get(k)})
                self.parts.extend(shown)
                self.save()
            ledger.mark_emitted(self.db, row["id"])
        if kind in ("widget", "secret-request"):
            self._ensure_started()
            self._emit({"type": "tool-input-available", "toolCallId": row["id"], "toolName": "SendToUser", "input": card_payload})
        else:
            for p in shown:
                if p["type"] == "text":
                    self._emit_text(p)
                else:
                    self._ensure_started()
                    self._emit(p)
        self.sent += 1
        self.end_turn = self.end_turn or end_turn
        return row

    def _dedupe_text(self) -> None:
        """Modelle schreiben ihre Antwort nach einer Rückfrage oft ein zweites Mal (live 14.11.): ein früherer Textteil,
        dessen Anfang ein späterer wiederholt, fällt beim Speichern weg."""
        norm = lambda t: " ".join(str(t).split()).lower()
        texts = [p for p in self.parts if p.get("type") == "text"]
        drop = {id(a) for i, a in enumerate(texts) for b in texts[i + 1:]
                if len(norm(a["text"])) >= 40 and norm(b["text"]).startswith(norm(a["text"]))}  # nur, wenn der spätere den ganzen früheren enthält
        if drop:
            reacted = set()
            if any(id(p) in drop and p.get("id") for p in texts):
                reacted = {r["message_id"] for r in self.db.all(
                    "SELECT message_id FROM message_reactions WHERE chat_id=? AND message_id LIKE ?", self.chat_id, self.message_id + "~t%")}
            self.parts[:] = [p for p in self.parts if id(p) not in drop or p.get("id") in reacted]

    def _close_text(self) -> None:
        self.open_text = None  # raw text is private: nothing to emit

    # ------------------------------------------------------------ Denken und Werkzeuge (nur als Statuszeile)
    def _think(self, delta: str) -> None:
        self.think_buf += delta
        if not self.think_started and ("\n" in self.think_buf.strip() or len(self.think_buf) >= 80):
            self._begin_think()

    def _begin_think(self) -> None:
        line = next((ln for ln in self.think_buf.splitlines() if ln.strip()), "")
        if line:
            self.think_id = f"think-{self.id}-{self.seq + 1}"
            self.think_started = True
            self.labels[self.think_id] = "Denkt nach …"  # Denk-Text der Modelle ist oft englisch und roh (Consti 14.11.); der Schritt selbst ist echt
            self.step(self.think_id, "denken", "Denkt nach …", "start")

    def _end_think(self) -> None:
        if not self.think_started and self.think_buf.strip():
            self._begin_think()
        if self.think_started:
            self.step(self.think_id, "denken", self.labels.get(self.think_id, "Denken"), "end")
        self.think_buf, self.think_started = "", False

    def _is_orbit(self, name: str) -> bool:
        low = (name or "").lower()
        # Antigravity: „Run mcp_orbit_say“, Cursor: „orbit-say: say“ (live 14.11.: standen sonst doppelt und roh in der Leiste)
        return low.startswith(("mcp__orbit__", "orbit:", "orbit.", "run mcp_orbit_", "mcp_orbit_", "orbit-")) or (self.model and self.model["cli"] == "codex" and name in contract.TOOLS)

    @staticmethod
    def _label(name: str, args) -> str:
        if isinstance(args, dict):
            arg = next((args[k] for k in ARG_KEYS if isinstance(args.get(k), str) and args[k].strip()), None)
            arg = arg or next((v for v in args.values() if isinstance(v, str) and v.strip()), None)
            if arg:
                return f"{name}: {short(arg, 60)}"
        return name or "Werkzeug"

    def _event(self, ev) -> None:
        self.touch()
        kind, d = ev.kind, ev.data
        if kind in ("tool_start", "tool_end"):
            self._flush_hold()
            self._close_text()
            self.raw.clear()  # Only text after the last tool can become a public fallback.
        if kind != "think":
            self._end_think()
        if kind == "session":
            self.session_id = d.get("id") or self.session_id
            self.db.run("UPDATE work_runs SET cli_session_id=? WHERE id=?", self.session_id, self.id)
        elif kind == "text":
            self._text(d.get("delta", ""))
        elif kind == "think":
            self._think(d.get("delta", ""))
        elif kind == "tool_start":
            if self._is_orbit(d.get("name", "")):
                self.skipped.add(d.get("id"))
            else:
                label = self._label(d.get("name", ""), d.get("input"))
                self.labels[d["id"]] = label
                self.step(d["id"], d.get("name", ""), label, "start")
        elif kind == "tool_end":
            if d.get("id") in self.skipped:
                return
            if d.get("id") in self.open_steps:
                self.step(d["id"], d.get("name", ""), self.labels.get(d["id"], d.get("name", "")), "end")
        elif kind == "usage":
            for key in ("inputTokens", "outputTokens", "cachedTokens"):
                self.usage[key] += d.get(key) or 0
            if d.get("costUsd") is not None:
                self.usage["costUsd"] = (self.usage["costUsd"] or 0) + d["costUsd"]
        elif kind == "limits":
            limits = self.ctx.parts.get("limits")
            if limits and self.model:
                limits.record(self.model["cli"], d)
        elif kind == "error":
            self.error = d.get("text") or GENERIC_ERROR
            self._note_limit(self.error)
        elif kind == "done":
            self.done_ev = True

    def _note_limit(self, text: str | None) -> None:
        """„Nutzungslimit“ im Fehlertext sperrt das Programm (Auto weicht aus); eine schon bekannte Rückkehrzeit bleibt."""
        limits = self.ctx.parts.get("limits")
        if limits and self.model and "Nutzungslimit" in (text or "") and not limits.get(self.model["cli"])["blocked"]:
            limits.block(self.model["cli"], now_ms() + BLOCK_DEFAULT_MS, (text or "")[:200])

    def _tree_ready(self, tree) -> None:
        """Prozessgruppe im Lauf merken: nach kill -9 räumt der Wiederanlauf sie ab (nur wenn das Programm noch darin steckt)."""
        self.tree = tree
        adapter = self.rt.adapters[self.model["cli"]]
        marker = os.path.basename(adapter.fake) if adapter.fake else adapter.binary
        self.db.run("UPDATE work_runs SET payload=json_set(payload,'$.pgid',?,'$.proc',?,'$.pstart',?) WHERE id=?", tree.pgid, marker, proc_start(tree.pgid), self.id)

    # ------------------------------------------------------------ Anhänge
    def _attachments(self) -> tuple[str, list[dict], list[tuple[str, bytes]]]:
        """Datei-Teile (data:-URL) dieses Zugs -> Dateien im Datenordner, Prompt-Zeilen, Bilder fürs Modell, Kopien für die Sandbox."""
        lines, images, uploads = [], [], []
        folder = self.ctx.cfg.data_dir / "uploads" / re.sub(r"[^\w.-]", "_", self.chat_id)[:100]
        for item in self.items:
            mid = item["payload"].get("messageId")
            message = chatstore.get(self.db, self.chat_id, mid) if mid else None
            for part in (message or {}).get("parts", []):
                url = part.get("url") if part.get("type") == "file" else None
                if not isinstance(url, str) or not url.startswith("data:") or "," not in url:
                    continue
                head, _, payload = url[5:].partition(",")
                kind = part.get("mediaType") or head.split(";")[0] or "application/octet-stream"
                name = re.sub(r"[^\w.\- ]", "_", Path(str(part.get("filename") or "anhang")).name).strip(". ")[:100] or "anhang"
                if len(payload) * 3 // 4 > MAX_UPLOAD + 4:
                    lines.append(f"Attachment {name} is too large (over 25 MB) and was not saved.")
                    continue
                try:
                    data = base64.b64decode(payload) if ";base64" in head else urllib.parse.unquote_to_bytes(payload)
                    if len(data) > MAX_UPLOAD:
                        lines.append(f"Attachment {name} is too large (over 25 MB) and was not saved.")
                        continue
                    folder.mkdir(parents=True, exist_ok=True)
                    target, n = folder / name, 1
                    while target.exists() and target.read_bytes() != data:  # gleiche Datei (z. B. bei „Weiter“) nicht doppelt anlegen
                        target, n = folder / f"{n}-{name}", n + 1
                    if not target.exists():
                        target.write_bytes(data)
                except (ValueError, OSError):
                    log.exception("Anhang %s nicht gespeichert", name)
                    lines.append(f"Attachment {name} could not be saved.")
                    continue
                remote = f"{UPLOADS_DIR}/{target.name}"
                uploads.append((remote, data))
                if kind.startswith("image/") and len(payload if ";base64" in head else base64.b64encode(data).decode("ascii")) <= MAX_PROMPT_IMAGE:
                    b64 = payload if ";base64" in head else base64.b64encode(data).decode("ascii")
                    images.append({"mediaType": kind, "base64": b64})
                    lines.append(f"Attachment: {target} ({kind}) — image {len(images)} in the prompt; copy in the sandbox: {remote}")
                else:
                    lines.append(f"Attachment: {target} ({kind}) — copy in the sandbox: {remote}")
                if kind.startswith(TEXT_TYPES):
                    text = data.decode("utf-8", "replace")
                    lines.append(f"Content of {target.name}:\n{text[:TEXT_INLINE]}" + ("\n[truncated]" if len(text) > TEXT_INLINE else ""))
        return "\n".join(lines), images, uploads

    # ------------------------------------------------------------ Lauf
    def _prompt(self) -> tuple[str, str, list[dict], list[tuple[str, bytes]]]:
        ctx, bot, chat = self.ctx, self.bot, self.chat
        if self.is_child:
            from .. import context
            brief = self.brief or {}
            return context.worker_brief(brief), context.worker_system_prompt(ctx, bot, self.role), [], []
        try:
            from .. import context
            system = context.system_prompt(ctx, bot, chat)
            self.turn_context = context.turn_prompt(ctx, bot, chat, self.items, self.session is None)
            text = self.turn_context.text
        except (ImportError, AttributeError):
            text = "\n\n".join(t for t in ((i["payload"].get("text") or "").strip() for i in self.items) if t)
            system = f"You are {bot['name']}. {bot.get('job') or ''}".strip()
        attach, images, uploads = self._attachments()
        return "\n\n".join(t for t in (text, attach) if t), system, images, uploads

    async def _mirror_uploads(self, uploads: list[tuple[str, bytes]]) -> None:
        """Angehängte Dateien zusätzlich in die Sandbox legen (wie lib/chat/attachments.ts), wenn ein Computer da ist."""
        from ..tools import daytona
        sid = self.bot.get("sandbox_id")
        if not uploads or self.ctx.cfg.fake_sandbox or daytona.is_fake(sid):
            return
        sb = daytona.get(self.ctx)
        try:
            await sb.exec(sid, f"mkdir -p {UPLOADS_DIR}", timeout=30)
            for path, data in uploads:
                await sb.write_file(sid, path, data)
        except Exception:
            log.exception("Anhänge nicht in die Sandbox kopiert")

    async def run(self) -> None:
        self.task = asyncio.current_task()
        self.stream = None if self.is_child else self.rt.streams.open(self.chat_id)
        self._status("arbeitet")
        watch = asyncio.create_task(self._watch())
        reason = None
        try:
            await self._drive()
        except asyncio.CancelledError:
            reason = "cancelled"
        except CliError as e:
            self.error = str(e)
            self._note_limit(self.error)
        except Exception:
            log.exception("Lauf %s gescheitert", self.id)
            self.error = GENERIC_ERROR
        finally:
            watch.cancel()
        try:
            await self._finalize(reason)
        except Exception:
            log.exception("Abschluss von Lauf %s gescheitert", self.id)
        finally:
            self.finished.set()

    async def _drive(self) -> None:
        if self.preset_error:
            raise CliError(self.preset_error)
        bridge = self.ctx.parts.get("bridge")
        if bridge:
            self.token = bridge.register(self)
        prompt, system, images, uploads = self._prompt()
        await self._mirror_uploads(uploads)
        # Bilder im Prompt nur für Claude (wie lib/cli/model.ts); andere CLIs sehen den Pfad-Hinweis.
        turn_images = images if self.model and self.model.get("cli") == "claude" else []
        adapter = self.rt.adapters[self.model["cli"]]
        while True:
            turn = Turn(prompt, system, cli.cli_model(self.model, self.effort), self.effort, self.work, self.session,
                        bridge.url if bridge else "", self.token or "", self.fast, turn_images)
            self.turn_start = len(self.full_text)
            async with aclosing(adapter.run(turn, self._tree_ready)) as events:
                async for ev in events:
                    self._event(ev)
            self._end_think()
            if not self.done_ev and not self.error:
                raise CliError(f"{adapter.label} stopped without a result.")
            # Word 4.41: a correction for a running child is applied at the next safe step, in the same CLI session.
            control = self.rt.take_control(self.id) if self.is_child and not self.error else []
            if not control:
                return
            from .. import context
            prompt, turn_images, self.session, self.done_ev = context.worker_correction(control), [], self.session_id, False

    async def _watch(self) -> None:
        """Zeitgrenzen: Gesamtzeit ohne Warten auf Freigabe; Leerlauf nur, wenn kein Werkzeug läuft und nichts wartet."""
        while True:
            await asyncio.sleep(0.5)
            now = time.monotonic()
            waited = self.waited + (now - self.wait_since if self.wait_since is not None else 0)
            if now - self.t0 - waited > contract.TURN_TOTAL_S:
                self.error = "The answer took too long."
            elif not self.open_steps and self.wait_since is None and now - self.activity > contract.TURN_IDLE_S:
                self.error = "The answer stalled and was stopped."
            if self.error:
                self.task.cancel()
                return

    # ------------------------------------------------------------ Stopp (Regel 7: DB zuerst, dann abbrechen)
    def mark_stopped(self) -> None:
        """Im selben Schritt wie das Verwerfen des Wartenden aufrufen (Transaktion der Laufzeit)."""
        self.stopped = True
        self._flush_hold()
        self._close_text()
        self.save()
        t = now_ms()
        self.db.run("UPDATE work_runs SET status='failed', error='gestoppt', steps=?, finished_at=?, updated_at=? WHERE id=?", self.steps, t, t, self.id)
        inbox.finish(self.db, self.id, "cancelled")

    # ------------------------------------------------------------ Abschluss (Regel 6)
    async def _kill(self) -> None:
        if self.tree:
            try:
                await self.tree.kill()
            except Exception:
                log.exception("Prozessbaum von Lauf %s nicht beendet", self.id)

    def _clean_work(self) -> None:
        """Der Arbeitsordner des Programms ist nur für diesen Lauf: leer -> weg, sonst in den Papierkorb."""
        for folder in (self.work, self.work.parent):
            try:
                folder.rmdir()
            except FileNotFoundError:
                pass
            except OSError:
                if folder is self.work:
                    try:
                        from ..tools.mac import undo
                        undo.move_to_trash(folder)
                    except Exception:
                        log.exception("Arbeitsordner %s nicht aufgeräumt", folder)

    def _release(self) -> None:
        bridge = self.ctx.parts.get("bridge")
        if bridge and self.token:
            bridge.unregister(self.token)

    async def _cancel_calls(self) -> None:
        calls = [c for c in self.calls if not c.done()]
        for c in calls:
            c.cancel()  # Mac-Werkzeuge beenden dabei ihre Prozessgruppe
        await asyncio.gather(*calls, return_exceptions=True)

    async def _finalize(self, reason: str | None) -> None:
        self.finalizing = True
        await self._cancel_calls()
        self._end_think()
        silent = self.full_text.strip() == contract.SILENT and not self.parts and not self.sent
        if self.hold and not silent:
            self._flush_hold()
        self.hold = ""
        self._close_text()
        if self.rt.closing and not self.stopped and not self.error:
            self.save()  # Dienst fährt herunter: Status bleibt „running“, der Wiederanlauf macht „interrupted“
            await self._kill()
            self._release()
            self._clean_work()
            return
        status = "stopped" if self.stopped else "done" if self.done_ev and not self.error else "failed"
        if self.is_child:
            await self._finalize_child(status)
            return
        interactions = self.ctx.parts.get("interactions")
        if interactions and status != "done":  # bei „fertig“ bleiben offene Rückfragen absichtlich stehen (ask_user blockiert nicht)
            interactions.abort_for_run(self.id)  # keine späte Freigabe für einen Lauf, den niemand mehr hört
        error = None if status != "failed" else self.error or GENERIC_ERROR
        # Compatibility fallback (Word 1.1): a run without any SendToUser delivery publishes its final text once.
        fallback = self._restore_raw() if status == "done" and not silent and not self.sent else []
        if fallback:
            self._dedupe_text()
        fallback = [p for p in fallback if any(p is q for q in self.parts)]
        keep = self._has_content() and not silent
        from ..tools import messages
        outcome = Outcome(status=status, text=chatstore.text_of(self.parts), error=error, extra={})
        settled = None
        if not self.stopped:
            t = now_ms()
            with self.db.tx():
                final = None
                if fallback:
                    try:
                        final, _ = ledger.commit_delivery(self.db, contract.Delivery(
                            client_key=f"{self.id}:final:{self.attempt}", chat_id=self.chat_id, kind="text",
                            parts=[{"type": "text", "text": p["text"]} for p in fallback], run_id=self.id, root_run_id=self.root_run_id,
                            request_id=self.request_id, message_id=self.message_id, end_turn=True))
                    except ledger.LedgerError:  # the request was stopped meanwhile: the late answer is refused
                        self.parts[:] = [p for p in self.parts if not any(p is f for f in fallback)]
                        fallback, keep = [], self._has_content() and not silent
                if keep:
                    self.save(final=True)
                elif self.saved:
                    chatstore.remove(self.db, self.chat_id, self.message_id)
                    self.saved = False
                if final is not None:
                    ledger.mark_emitted(self.db, final["id"])
                self._report(audience="chat")
                self.db.run("UPDATE work_runs SET status=?, error=?, steps=?, finished_at=?, updated_at=? WHERE id=?", status, error, self.steps, t, t, self.id)
                inbox.finish(self.db, self.id, "done" if status == "done" else "failed")
                self._usage_row(t)
                if messages.after_run in self.rt.after_run:
                    settled = messages.settle_run(self, outcome)
        elif keep:
            self.save(final=True)
        if status == "done" and self.turn_context is not None:
            try:
                from .. import context
                context.commit_turn(self.ctx, self.bot, self.chat, self.turn_context)
                task = asyncio.create_task(context.summarize_if_needed(self.ctx, self.chat_id))
                _background.add(task)
                task.add_done_callback(_background.discard)
            except Exception:
                log.exception("commit_turn gescheitert")
        # --- Ereignisse
        if status == "done" and not keep:
            pass  # Stille Antwort: nichts im Strom
        else:
            for part in fallback:
                self._emit_text(part, next((d for _, p, d in self.raw if p is part), None))
            self._ensure_started()
            self._emit({"type": "finish-step"})
            if status == "stopped":
                self._emit({"type": "abort", "reason": "Stopped."})
            else:
                if error:
                    self._emit({"type": "error", "errorText": error})
                self._emit({"type": "finish", "finishReason": "stop" if not error else "error", "messageMetadata": self._meta(True)})
        bus = self.ctx.bus
        bus.publish({"type": "status", "chatId": self.chat_id, "botId": self.bot["id"], "status": {"done": "fertig", "failed": "fehler", "stopped": "ruhig"}[status]})
        if error:
            bus.publish({"type": "notice", "chatId": self.chat_id, "text": error[:200], "kind": "error"})
        if keep:
            bus.publish({"type": "orbi-message", "chatId": self.chat_id, "messageId": self.message_id})
        self.rt.group_event(self, status, keep)
        await self._kill()
        self._release()
        self._clean_work()
        self.rt.close_if_idle(self.chat_id)
        for hook in list(self.rt.after_run):
            try:
                if hook is messages.after_run and settled is not None:
                    messages.publish_settled(self.ctx, settled)
                else:
                    await hook(self, outcome)
            except Exception:
                log.exception("after_run-Haken gescheitert")

    def _report(self, audience: str) -> dict | None:
        """Raw final model text is private: stored as a `report` delivery for the originator, never emitted."""
        text = self.report_text()
        if not text or text == contract.SILENT:
            return None
        try:
            row, _ = ledger.commit_delivery(self.db, contract.Delivery(
                client_key=f"{self.id}:report:{self.attempt}", chat_id=self.chat_id, kind="report", parts=[{"type": "text", "text": text}],
                visibility="private", audience=audience, run_id=self.id, root_run_id=self.root_run_id, request_id=self.request_id))
            return row
        except ledger.LedgerError:
            return None  # stopped request: the late result is refused

    async def _finalize_child(self, status: str) -> None:
        """A worker ends privately: status and report in one transaction, then the engine decides about the parent wake."""
        interactions = self.ctx.parts.get("interactions")
        if interactions and status != "done":
            interactions.abort_for_run(self.id)
        error = None if status != "failed" else self.error or GENERIC_ERROR
        report, t = None, now_ms()
        with self.db.tx():
            if self._has_content():
                self.save(final=True)  # approval cards the user saw stay readable
            if not self.stopped:
                stopped_meanwhile = self.db.val("SELECT error FROM work_runs WHERE id=?", self.id) == "gestoppt"
                if not stopped_meanwhile:
                    report = self._report(audience="parent")
                    self.db.run("UPDATE work_runs SET status=?, error=?, steps=?, finished_at=?, updated_at=? WHERE id=?",
                                status, error, self.steps, t, t, self.id)
                else:
                    status = "stopped"
            self._usage_row(t)
        await self._kill()
        self._release()
        self._clean_work()
        try:
            self.rt.child_finished(self, status, report, error)
        except Exception:
            log.exception("Child %s: completion not handled", self.id)

    def _usage_row(self, t: int) -> None:
        stats = getattr(self.turn_context, "stats", None) or {}
        self.db.run(
            "INSERT INTO turn_usage (id,chat_id,bot_id,model,input_tokens,cached_tokens,output_tokens,system_chars,tool_count,history_msgs,created_at,steps,cost_usd,"
            "volatile_chars,history_chars,turn_kind,duration_ms,summary_used,tier) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            self.id if self.attempt == 1 else f"{self.id}:{self.attempt}", self.chat_id, self.bot["id"], self.model["id"] if self.model else "", self.usage["inputTokens"], self.usage["cachedTokens"],
            self.usage["outputTokens"], 0, self.steps, 0, t, max(1, self.steps), self.usage["costUsd"], stats.get("volatileChars"),
            stats.get("historyChars"), self.items[0]["kind"], t - self.started_at, int(bool(stats.get("summaryUsed"))), self.model["tier"] if self.model else None)
