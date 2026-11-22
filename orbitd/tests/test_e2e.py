"""Ende-zu-Ende: echter HTTP-Server (uvicorn), Attrappen-CLI, Werkzeuge echt über MCP. Daten nur unter /tmp, kein Netz.

Die Attrappe liest ihr Verhalten aus $ORBIT_FAKE_SCRIPT (Datei, vor jedem Aufruf neu gelesen), damit der Prompt keine Marken tragen muss.
"""
import json
import os
import signal
import socket
import sqlite3
import subprocess
import sys
import threading
import time
import uuid
from pathlib import Path

import httpx
import pytest
import uvicorn

from orbitd import config
from orbitd.app import create_app
from orbitd.db import now_ms

ROOT = Path(__file__).resolve().parent.parent
FAKE = str(Path(__file__).parent / "fake_cli.py")
LIMIT_S = 45  # Zeitlimit je Test
ROUTINE = {"name": "Testroutine", "prompt": "Sag Hallo", "schedule": {"kind": "daily", "at": "09:00"}}
# Freigabe-Tests: geld-Werkzeug (Routinen fragen nicht mehr); in Fake-Läufen über ORBIT_FAKE_CLI registriert
SPEND_CALL = {"tool": {"name": "test_spend", "arguments": {}}}
ASK_CALL = {"tool": {"name": "ask_user", "arguments": {"questions": [
    {"question": "Welche Farbe?", "options": [{"label": "Rot", "recommended": True}, {"label": "Blau"}]}]}}}


@pytest.fixture(autouse=True)
def time_limit():
    def boom(*_):
        raise TimeoutError(f"Test länger als {LIMIT_S} s")
    old = signal.signal(signal.SIGALRM, boom)
    signal.alarm(LIMIT_S)
    yield
    signal.alarm(0)
    signal.signal(signal.SIGALRM, old)


def until(cond, timeout=15.0, what="Bedingung"):
    end = time.time() + timeout
    while time.time() < end:
        value = cond()
        if value:
            return value
        time.sleep(0.05)
    raise AssertionError(f"Zeitüberschreitung: {what}")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def alive(pgid: int) -> bool:
    try:
        os.killpg(pgid, 0)
        return True
    except ProcessLookupError:
        return False


def turn_body(text, model="claude-haiku-5-5"):
    return {"messages": [{"id": uuid.uuid4().hex, "role": "user", "parts": [{"type": "text", "text": text}]}], "clientData": {"model": model}}


def chunks(text: str) -> list:
    return [json.loads(line[6:]) for line in text.splitlines() if line.startswith("data: ") and line != "data: [DONE]"]


class Turn:
    """POST /turn im Hintergrund (der Strom bleibt bis zum Ende des Laufs offen)."""

    def __init__(self, base, headers, chat, body):
        self.text, self.error = None, None
        self.thread = threading.Thread(target=self._run, args=(f"{base}/v1/chats/{chat}/turn", headers, body), daemon=True)
        self.thread.start()

    def _run(self, url, headers, body):
        try:
            self.text = httpx.post(url, json=body, headers=headers, timeout=60).text
        except Exception as e:  # kill -9 des Dienstes: Verbindung bricht ab
            self.error = e

    def wait(self, timeout=20):
        self.thread.join(timeout)
        assert not self.thread.is_alive(), "Strom ist nicht zu Ende gegangen"
        return self


class Api:
    """Gemeinsame Hilfen für Dienst im Prozess und Dienst als Unterprozess."""
    port: int
    token: str
    data_dir: Path
    script_path: Path
    log_path: Path

    @property
    def base(self):
        return f"http://127.0.0.1:{self.port}"

    @property
    def headers(self):
        return {"Authorization": f"Bearer {self.token}"}

    def get(self, path):
        return httpx.get(self.base + path, headers=self.headers, timeout=10)

    def post(self, path, body=None):
        return httpx.post(self.base + path, json=body if body is not None else {}, headers=self.headers, timeout=10)

    def turn(self, text, model="claude-haiku-5-5", chat="chat1"):
        return Turn(self.base, self.headers, chat, turn_body(text, model))

    def script(self, obj):
        self.script_path.write_text(json.dumps(obj))

    def fake_log(self):
        return [json.loads(line) for line in self.log_path.read_text().splitlines()] if self.log_path.exists() else []

    def sql(self, query, *args):
        con = sqlite3.connect(f"file:{self.data_dir / 'orbit.sqlite'}?mode=ro", uri=True, timeout=5)
        con.row_factory = sqlite3.Row
        try:
            return [dict(r) for r in con.execute(query, args)]
        finally:
            con.close()

    def messages(self, chat="chat1"):
        return self.get(f"/v1/chats/{chat}/messages").json()["messages"]

    def runs(self, chat=None):
        return self.sql("SELECT * FROM work_runs WHERE kind='turn' AND (? IS NULL OR chat_id=?) ORDER BY started_at, rowid", chat, chat)

    def pgid(self, index=-1):
        """Prozessgruppe des n-ten Laufs, sobald sie gemerkt ist (sonst None)."""
        runs = self.runs()
        return json.loads(runs[index]["payload"]).get("pgid") if runs else None

    def snapshot(self):
        """Erstes Ereignis von /v1/events."""
        with httpx.stream("GET", self.base + "/v1/events", headers=self.headers, timeout=10) as r:
            for line in r.iter_lines():
                if line.startswith("data: "):
                    return json.loads(line[6:])

    def approvals(self):
        return self.get("/v1/approvals").json()["approvals"]

    def wait_approval(self):
        return until(self.approvals, what="offene Freigabe")[0]

    def automations(self):
        return self.sql("SELECT count(*) AS n FROM automations")[0]["n"]


# ---------------------------------------------------------------- Dienst im Prozess
@pytest.fixture
def live(data_dir, tmp_path, monkeypatch):
    monkeypatch.setenv("ORBIT_KEYCHAIN_FAKE", "{}")
    monkeypatch.setenv("ORBIT_FAKE_LOG", str(tmp_path / "fake.log"))
    monkeypatch.setenv("ORBIT_FAKE_SCRIPT", str(tmp_path / "script.json"))
    api = Api()
    api.port, api.data_dir, api.script_path, api.log_path = free_port(), data_dir, tmp_path / "script.json", tmp_path / "fake.log"
    app = create_app(config.Config(data_dir=data_dir, port=api.port, fake_sandbox=True, fake_cli=FAKE))
    api.ctx, api.token = app.state.ctx, app.state.ctx.token
    db, t = api.ctx.db, now_ms()
    with db.tx():
        db.run("INSERT INTO bots (id,user_id,third_party_id,name,avatar,color,job,instructions,is_main,sandbox_id,created_at,onboarding_done,dreamer_enabled,heartbeat_enabled,version)"
               " VALUES ('bot1','local','bot1','Nova','nepi','#3366ff','Hilft','',1,'fake-bot1',?,1,1,0,1)", t)
        db.run("INSERT INTO chats (id,user_id,kind,name,last_message_at,created_at) VALUES ('chat1','local','direct',NULL,?,?)", t, t)
        db.run("INSERT INTO chat_members (chat_id,bot_id,joined_at) VALUES ('chat1','bot1',?)", t)
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=api.port, log_level="warning", timeout_graceful_shutdown=2))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    until(lambda: server.started, 15, "Server")
    api.events = []

    def collect():
        try:
            with httpx.stream("GET", api.base + "/v1/events", headers=api.headers, timeout=None) as r:
                for line in r.iter_lines():
                    if line.startswith("data: "):
                        api.events.append(json.loads(line[6:]))
        except Exception:
            pass
    threading.Thread(target=collect, daemon=True).start()
    until(lambda: api.events, 10, "Ereignis-Strom")
    yield api
    server.should_exit = True
    thread.join(20)


def event(api, **want):
    return next((e for e in list(api.events) if all(e.get(k) == v for k, v in want.items())), None)


def run_status(api):
    return [r["status"] for r in api.runs()]


# ---------------------------------------------------------------- (a) Freigabe
def test_approval_once_runs_tool_exactly_once(live):
    live.script(SPEND_CALL)
    t = live.turn("Gib Testgeld aus")
    card = live.wait_approval()
    assert card["tool"] == "test_spend" and card["kind"] == "approval" and card["chatId"] == "chat1" and "restored" not in card
    until(lambda: event(live, type="approval", id=card["id"], status="pending"), what="Ereignis approval")
    assert live.get("/v1/status").json()["chats"][0]["status"] == "wartet" and live.get("/v1/status").json()["needsYou"] == 1
    live.script({})
    assert live.post(f"/v1/approvals/{card['id']}/decide", {"decision": "once"}).json() == {"ok": True}
    t.wait()
    assert chunks(t.text)[-1]["finishReason"] == "stop"
    # die App zeigt die Karte nur an einem Werkzeug-Teil mit tool-approval-request (live 14.11.: ohne das blieb die Karte unsichtbar)
    kinds = [(c["type"], c.get("approvalId"), c.get("approved")) for c in chunks(t.text) if c["type"].startswith("tool-approval")]
    assert kinds == [("tool-approval-request", card["id"], None), ("tool-approval-response", card["id"], True)]
    assert live.approvals() == [] and run_status(live) == ["done"]
    assert event(live, type="approval", id=card["id"], status="approved")
    assert any(p.get("type") == "tool-test_spend" and p["state"] == "output-available" for m in live.messages() for p in m["parts"])
    assert live.post(f"/v1/approvals/{card['id']}/decide", {"decision": "once"}).status_code == 410


def test_approval_deny_does_not_run_tool(live):
    live.script(SPEND_CALL)
    t = live.turn("Gib Testgeld aus")
    card = live.wait_approval()
    live.script({})
    live.post(f"/v1/approvals/{card['id']}/decide", {"decision": "deny"})
    t.wait()
    assert chunks(t.text)[-1]["finishReason"] == "stop"
    assert run_status(live) == ["done"] and event(live, type="approval", id=card["id"], status="denied")
    assert live.messages()[-1]["role"] == "assistant"
    assert not any(p.get("type") == "tool-test_spend" and p.get("state") == "output-available" for m in live.messages() for p in m["parts"])


# ---------------------------------------------------------------- (b) Rückfrage
def test_ask_user_does_not_block_and_answer_starts_one_followup(live):
    live.script(ASK_CALL)
    live.turn("Frag mich etwas").wait()
    assert run_status(live) == ["done"]
    card = event(live, type="question", status="pending")
    assert card and card["tool"] == "ask_user"
    part = next(p for p in live.messages()[-1]["parts"] if p["type"] == "tool-ask_user")
    assert part["state"] == "input-available"
    live.script({})
    r = live.post(f"/v1/questions/{card['id']}/answer", {"answers": [{"question": "Welche Farbe?", "answers": ["Rot"]}]})
    assert r.json() == {"ok": True}
    until(lambda: run_status(live) == ["done", "done"], what="Folgelauf")
    time.sleep(1.5)  # kein zweiter Folgelauf
    assert run_status(live) == ["done", "done"]
    log = live.fake_log()
    assert len(log) == 2 and "Rot" in log[1]["prompt"] and "Welche Farbe?" in log[1]["prompt"]
    assert next(p for m in live.messages() for p in m["parts"] if p["type"] == "tool-ask_user")["state"] == "output-available"
    assert live.post(f"/v1/questions/{card['id']}/answer", {"skipped": True}).status_code == 410


# ---------------------------------------------------------------- (c) Zwischennachricht
def test_follow_up_message_while_waiting_interrupts_nothing(live):
    live.script(SPEND_CALL)
    first = live.turn("Gib Testgeld aus")
    card = live.wait_approval()
    second = live.turn("Und noch etwas")
    second.wait()  # wird nur angenommen, der Strom ist sofort zu Ende
    time.sleep(0.5)
    assert [c["id"] for c in live.approvals()] == [card["id"]]
    assert live.get("/v1/status").json()["chats"][0]["status"] == "wartet" and first.text is None
    assert run_status(live) == ["running"]
    live.script({})
    live.post(f"/v1/approvals/{card['id']}/decide", {"decision": "once"})
    first.wait()
    until(lambda: run_status(live) == ["done", "done"], what="zweiter Lauf")
    assert any(p.get("type") == "tool-test_spend" and p["state"] == "output-available" for m in live.messages() for p in m["parts"])
    roles = [m["role"] for m in live.messages()]
    assert roles.count("user") == 2 and roles.count("assistant") == 2


# ---------------------------------------------------------------- (d) Live-Leiste
def test_live_bar_has_real_labels_and_history_only_text_and_cards(live):
    live.script({"tool": {"name": "memory_get", "arguments": {"name": "farbe"}}})
    live.turn("Schau im Gedächtnis nach").wait()
    start = until(lambda: event(live, type="status-step", state="start"), what="status-step")
    assert start["tool"] == "memory_get" and start["label"] == "Liest Gedächtnis „farbe“ …" and start["botId"] == "bot1"
    assert event(live, type="status-step", state="end", toolCallId=start["toolCallId"])
    allowed = {"step-start", "text", "tool-say", "tool-ask_user", "tool-react", "tool-share_file", "tool-automation_create", "tool-create_orbi"}
    for m in live.messages():
        assert {p["type"] for p in m["parts"]} <= allowed | {"file"}, m["parts"]
    assert not any(p["type"].startswith(("reasoning", "tool-mcp", "tool-memory")) for m in live.messages() for p in m["parts"])
    assert live.sql("SELECT count(*) AS n FROM run_events WHERE type='status-step'")[0]["n"] == 2


# ---------------------------------------------------------------- (e) Auto und festes Modell
def test_auto_avoids_blocked_cli_and_fixed_model_stays_fixed(live):
    live.ctx.parts["limits"].block("claude", now_ms() + 3_600_000, "Test")
    live.turn("Hallo", model="auto").wait()
    log = live.fake_log()
    assert [e["dialect"] for e in log] == ["codex"]
    meta = live.messages()[-1]["metadata"]
    assert meta["jev"]["model"] != "claude-haiku-5-5" and "gesperrt" in meta["jev"]["reason"] and meta["jev"]["reason"]
    # festes Modell: kein stiller Wechsel, der Fehler wird gemeldet
    live.script({"limit": True})
    t = live.turn("Hallo noch einmal", model="claude-haiku-5-5").wait()
    assert [e["dialect"] for e in live.fake_log()] == ["codex", "claude"]
    cs = chunks(t.text)
    assert any(c["type"] == "error" and "Nutzungslimit" in c["errorText"] for c in cs)
    assert run_status(live) == ["done", "failed"]
    assert live.get("/v1/usage").json()["providers"][0]["status"] == "limit"
    # Auto danach: gemeldete Sperre (aus der Fehlermeldung) hält Claude weiter draußen
    live.script({})
    live.turn("Nochmal", model="auto").wait()
    assert live.fake_log()[-1]["dialect"] == "codex"


# ---------------------------------------------------------------- (g) Stopp bei offener Freigabe
def test_stop_during_open_approval_cleans_everything(live):
    live.script(SPEND_CALL)
    t = live.turn("Gib Testgeld aus")
    card = live.wait_approval()
    pgid = until(lambda: live.pgid(0), what="Prozessgruppe")
    assert alive(pgid)
    live.script({})
    live.turn("Zweite Nachricht").wait()  # liegt im Postfach
    assert live.post("/v1/chats/chat1/stop").json() == {"stopped": True, "requeued": ["Zweite Nachricht"]}
    t.wait()
    assert live.approvals() == [] and event(live, type="approval", id=card["id"], status="aborted")
    until(lambda: not alive(pgid), 8, "Prozess beendet")
    assert live.sql("SELECT count(*) AS n FROM inbox_items WHERE status IN ('queued','processing')")[0]["n"] == 0
    assert live.sql("SELECT count(*) AS n FROM pending_interactions")[0]["n"] == 0
    assert live.ctx.parts["bridge"].runs == {} and live.get("/v1/status").json()["chats"] == []
    assert run_status(live) == ["failed"] and live.runs()[0]["error"] == "gestoppt"
    assert [m["role"] for m in live.messages()] == ["user"]  # die verworfene Zweitnachricht ist weg


# ---------------------------------------------------------------- (f) kill -9
class Service(Api):
    def __init__(self, data_dir, tmp_path):
        self.data_dir, self.port = data_dir, free_port()
        self.script_path, self.log_path, self.out = tmp_path / "script.json", tmp_path / "fake.log", tmp_path / "service.log"
        self.proc = None

    def start(self):
        env = {**os.environ, "ORBIT_DATA_DIR": str(self.data_dir), "ORBITD_PORT": str(self.port), "ORBIT_FAKE_CLI": FAKE, "ORBIT_FAKE_SANDBOX": "1",
               "ORBIT_KEYCHAIN_FAKE": "{}", "ORBIT_FAKE_LOG": str(self.log_path), "ORBIT_FAKE_SCRIPT": str(self.script_path)}
        self.proc = subprocess.Popen([sys.executable, "-m", "orbitd"], cwd=ROOT, env=env, stdout=open(self.out, "a"), stderr=subprocess.STDOUT)
        token_file = self.data_dir / "service.token"
        until(lambda: token_file.exists() and token_file.stat().st_size == 64, 10, "Token")
        self.token = token_file.read_text()

        def healthy():
            try:
                return httpx.get(self.base + "/v1/health", headers=self.headers, timeout=2).status_code == 200
            except httpx.HTTPError:
                return False
        until(healthy, 20, "Dienst bereit")

    def kill9(self):
        self.proc.kill()
        self.proc.wait(10)

    def stop(self):
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(15)
            except subprocess.TimeoutExpired:
                self.proc.kill()


@pytest.mark.parametrize("kind", ["sleep", "approval", "ask"])
def test_kill9_recovers_cleanly(kind, data_dir, tmp_path):
    svc = Service(data_dir, tmp_path)
    svc.start()
    try:
        chat = svc.post("/v1/bots", {"name": "Nova", "job": "Hilft", "avatar": "nepi", "color": "#3366ff", "isMain": True}).json()["chatId"]
        svc.get(f"/v1/chats/{chat}/messages")
        users = 1
        if kind == "ask":  # erst eine Rückfrage stellen (Lauf endet), dann mitten in einem langen Lauf töten
            svc.script(ASK_CALL)
            svc.turn("Frag mich etwas", chat=chat).wait()
            users = 2
        svc.script({"tool": SPEND_CALL["tool"]} if kind == "approval" else {"sleep": 30})
        svc.turn("Arbeite lange", chat=chat)
        if kind == "approval":
            svc.wait_approval()
        until(lambda: len(svc.runs(chat)) == users, what="Lauf angelegt")
        pgid = until(lambda: svc.pgid(), what="Prozessgruppe")
        until(lambda: svc.get("/v1/status").json()["chats"], what="Lauf läuft")
        assert alive(pgid)
        svc.kill9()
        if kind == "sleep":
            assert alive(pgid)  # die Attrappe lebt nach dem Absturz weiter ...
        svc.script({})
        svc.start()
        until(lambda: not alive(pgid), 6, "verwaiste Prozessgruppe beendet")  # ... und wird beim Start abgeräumt
        assert not [r for r in svc.runs(chat) if r["status"] in ("running", "queued", "waiting")]
        status = svc.get("/v1/status").json()
        assert status["chats"] == [] and [i["chatId"] for i in status["interrupted"]] == [chat]
        if kind in ("approval", "ask"):
            card = next(c for c in svc.snapshot()["approvals"] if c["kind"] == ("approval" if kind == "approval" else "ask"))
            assert card["restored"] is True and status["needsYou"] == 1
        before = len(svc.runs(chat))
        assert svc.post(f"/v1/chats/{chat}/resume", {"runId": status["interrupted"][0]["runId"]}).json() == {"ok": True}
        until(lambda: len(svc.runs(chat)) == before + 1 and svc.runs(chat)[-1]["status"] == "done", 15, "Weiter-Lauf")
        time.sleep(1.0)
        assert len(svc.runs(chat)) == before + 1
        messages = svc.messages(chat)
        assert len({m["id"] for m in messages}) == len(messages)
        roles = [m["role"] for m in messages]
        assert roles.count("user") == users and roles.count("assistant") == (1 if kind == "sleep" else 2)  # die Karte (Frage oder Freigabe) bleibt als eigener Teil stehen, „Weiter“ schreibt eine neue Nachricht
        assert svc.get("/v1/status").json()["interrupted"] == []
        if kind == "ask":
            assert svc.snapshot()["approvals"]  # die Rückfrage eines früheren, fertigen Laufs bleibt, bis Consti antwortet
        if kind == "approval":  # „Weiter“ macht die offene Freigabe des unterbrochenen Laufs hinfällig: eine späte Antwort startet keinen zweiten Lauf
            assert not svc.snapshot()["approvals"]
            assert svc.post(f"/v1/approvals/{card['id']}/decide", {"decision": "once"}).status_code == 410
            time.sleep(0.5)
            assert len(svc.runs(chat)) == before + 1
        assert "Traceback" not in svc.out.read_text()
    finally:
        svc.stop()


# ---------------------------------------------------------------- Onboarding (Begrüßung ohne Nutzer-Nachricht)
ONBOARDING = {"messages": [], "clientData": {"model": "claude-haiku-5-5", "botId": "bot1", "onboarding": True}, "trigger": "submit-message"}


def test_onboarding_turn_without_message_then_finish(live):
    live.ctx.db.run("UPDATE bots SET onboarding_done=0, instructions='Sei kurz.'")
    live.script({"tool": {"name": "onboarding_finish", "arguments": {"instructions": "Immer Du.\nNie raten."}}})
    r = live.post("/v1/chats/chat1/turn", ONBOARDING)
    assert r.status_code == 200 and chunks(r.text)[-1]["finishReason"] == "stop"
    row = live.sql("SELECT onboarding_done, instructions FROM bots")[0]
    assert row["onboarding_done"] == 1 and row["instructions"] == "Sei kurz.\nImmer Du.\nNie raten."
    assert event(live, type="onboarding", botId="bot1", done=True, instructions=True)
    assert [m["role"] for m in live.messages()] == ["assistant"]  # keine Nutzer-Nachricht, die Anweisung steht nur im Zug
    assert "[Onboarding]" in live.sql("SELECT payload FROM inbox_items")[0]["payload"]
    # danach ist das Werkzeug weg, und ein zweiter Start wird abgelehnt
    assert live.post("/v1/chats/chat1/turn", ONBOARDING).status_code == 409
    live.script({"tool": {"name": "onboarding_finish", "arguments": {"instructions": "x"}}})
    live.turn("Hallo").wait()
    assert live.sql("SELECT instructions FROM bots")[0]["instructions"] == "Sei kurz.\nImmer Du.\nNie raten."


def test_onboarding_needs_flag_and_normal_message_skips(live):
    live.ctx.db.run("UPDATE bots SET onboarding_done=0")
    assert live.post("/v1/chats/chat1/turn", {"messages": [], "clientData": {"model": "claude-haiku-5-5"}}).status_code == 400
    assert live.sql("SELECT onboarding_done FROM bots")[0]["onboarding_done"] == 0
    live.turn("Hallo").wait()  # Consti schreibt selbst: Onboarding gilt als übersprungen
    assert live.sql("SELECT onboarding_done FROM bots")[0]["onboarding_done"] == 1
    assert event(live, type="onboarding", botId="bot1", done=True, instructions=False)


def test_onboarding_free_answer_does_not_skip_until_three_answers(live):
    """Consti tippt die Antwort auf die Onboarding-Frage frei: das Onboarding bleibt offen, onboarding_finish bleibt verfügbar."""
    live.ctx.db.run("UPDATE bots SET onboarding_done=0, instructions='Sei kurz.'")
    live.script({})
    assert live.post("/v1/chats/chat1/turn", ONBOARDING).status_code == 200  # Begrüßung (1. Antwort)
    live.turn("Am wichtigsten sind Mails").wait()  # freie Antwort statt Karte: kein Überspringen (2. Antwort)
    assert live.sql("SELECT onboarding_done FROM bots")[0]["onboarding_done"] == 0
    live.script({"tool": {"name": "onboarding_finish", "arguments": {"instructions": "Mails zuerst."}}})
    live.turn("Und nie raten").wait()
    row = live.sql("SELECT onboarding_done, instructions FROM bots")[0]
    assert (row["onboarding_done"], row["instructions"]) == (1, "Sei kurz.\nMails zuerst.")


def test_onboarding_counts_as_skipped_after_three_answers(live):
    live.ctx.db.run("UPDATE bots SET onboarding_done=0")
    live.script({})
    live.post("/v1/chats/chat1/turn", ONBOARDING)
    for text in ("Eins", "Zwei"):
        live.turn(text).wait()
    assert live.sql("SELECT onboarding_done FROM bots")[0]["onboarding_done"] == 0
    live.turn("Drei").wait()  # der Orbi hat drei eigene Antworten gegeben: jetzt gilt es als übersprungen
    assert live.sql("SELECT onboarding_done FROM bots")[0]["onboarding_done"] == 1


def test_send_to_user_publishes_once_and_keeps_model_report_private(live):
    live.script({"tool": {"name": "SendToUser", "arguments": {
        "content": "**Ready**", "end_turn": True,
        "images": [{"url": "https://example.test/image.png", "alt": "Example drawing"}]}},
        "text": "Private provider report"})
    turn = live.turn("Show the result.")
    turn.wait()
    assert "Private provider report" not in turn.text
    parts = [part for message in live.messages() if message["role"] == "assistant" for part in message["parts"]]
    assert [p["text"] for p in parts if p["type"] == "text"] == ["**Ready**"]
    assert [p["filename"] for p in parts if p["type"] == "file"] == ["Example drawing"]
    assert "Private provider report" not in str(parts)
    assert live.sql("SELECT count(*) AS n FROM deliveries WHERE visibility='public' AND status='emitted' AND end_turn=1")[0]["n"] == 1
    assert "Private provider report" in live.sql("SELECT parts FROM deliveries WHERE kind='report' AND visibility='private'")[0]["parts"]
