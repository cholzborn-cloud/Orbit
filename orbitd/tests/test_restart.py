"""Wiederanlauf nach kill -9, Stopp und Unterprozesse (Review-Funde 1-9). Daten nur unter /tmp."""
import asyncio
import json
import os
import subprocess
import time
from types import SimpleNamespace

import pytest

from orbitd import automations
from orbitd.db import DB, dumps, now_ms
from orbitd.runtime import recovery
from orbitd.runtime.contract import Risk, TOOLS, tool
from orbitd.tools import messages
from orbitd.tools.bridge import Bridge
from orbitd.tools.mac import tools as mac
from test_e2e import ASK_CALL, Service, alive, time_limit, until  # noqa: F401  (time_limit: Fixture)

SEND_SLEEP = {"tool": {"name": "send_message", "arguments": {"target": "Luna", "message": "[[sleep:30]] los"}}}


def two_bots(svc):
    nova = svc.post("/v1/bots", {"name": "Nova", "job": "Hilft", "avatar": "nepi", "color": "#3366ff", "isMain": True}).json()["chatId"]
    luna = svc.post("/v1/bots", {"name": "Luna", "job": "Recherche", "avatar": "nepi", "color": "#aa3366", "isMain": False}).json()["chatId"]
    svc.get(f"/v1/chats/{nova}/messages")
    return nova, luna


def orbi_lines(svc, chat):
    return [p["data"] for m in svc.messages(chat) for p in m["parts"] if p["type"] == "data-orbi-message"]


# ---- 1 kill -9, während Luna den Auftrag von Nova bearbeitet
def test_kill9_during_orbi_task_fails_task_and_tells_sender(data_dir, tmp_path):
    svc = Service(data_dir, tmp_path)
    svc.start()
    try:
        nova, luna = two_bots(svc)
        svc.script(SEND_SLEEP)
        svc.turn("Schreib Luna", chat=nova)
        pgid = until(lambda: next((json.loads(r["payload"]).get("pgid") for r in svc.runs(luna) if json.loads(r["payload"]).get("pgid")), None), what="Lunas Lauf")
        assert alive(pgid)
        svc.kill9()
        svc.script({})
        svc.start()
        until(lambda: not alive(pgid), 6, "Prozessgruppe beendet")
        until(lambda: svc.sql("SELECT status FROM tasks")[0]["status"] == "failed", what="Auftrag fehlgeschlagen")
        until(lambda: any("Neustart" in l["text"] for l in orbi_lines(svc, nova)), what="Fehler-Antwort bei Nova")
        assert [l["status"] for l in orbi_lines(svc, luna)] == ["fehlgeschlagen"]
        until(lambda: not [r for r in svc.runs() if r["status"] in ("running", "queued", "waiting")], what="nichts hängt")
        assert "Traceback" not in svc.out.read_text()
    finally:
        svc.stop()


def routine(svc, body) -> str:
    """Routinen legt nur ein Orbi an (die Route nicht mehr): direkt in die Wegwerf-Datenbank des Dienstes."""
    db = DB(svc.data_dir / "orbit.sqlite")
    try:
        return automations.create(db, body)
    finally:
        db.con.close()


# ---- 2 kill -9, während eine Routine im Postfach wartet
def test_kill9_with_waiting_routine_asks_instead_of_running(data_dir, tmp_path):
    svc = Service(data_dir, tmp_path)
    svc.start()
    try:
        chat = svc.post("/v1/bots", {"name": "Nova", "job": "Hilft", "avatar": "nepi", "color": "#3366ff", "isMain": True}).json()["chatId"]
        svc.get(f"/v1/chats/{chat}/messages")
        bot = svc.sql("SELECT id FROM bots")[0]["id"]
        a = routine(svc, {"botId": bot, "name": "Rt", "prompt": "tu es", "schedule": {"kind": "daily", "at": "09:00"}, "timezone": "Europe/Berlin",
                                         "target": "same", "notify": "app", "model": "claude-haiku-5-5", "effort": None, "context": True})
        svc.script({"sleep": 30})
        svc.turn("Arbeite lange", chat=chat)
        until(lambda: svc.get("/v1/status").json()["chats"], what="Lauf läuft")
        assert svc.post(f"/v1/automations/{a}/run").json()["ok"]
        assert svc.sql("SELECT status FROM inbox_items WHERE kind='timer'")[0]["status"] == "queued"
        svc.kill9()
        svc.script({})
        svc.start()
        until(lambda: svc.sql("SELECT id FROM pending_interactions WHERE id LIKE 'missed:%'"), what="Karte verpasste Routine")
        time.sleep(1.0)
        assert svc.sql("SELECT status FROM automation_runs")[0]["status"] == "error"
        assert svc.sql("SELECT status FROM inbox_items WHERE kind='timer'")[0]["status"] == "cancelled"
        assert len(svc.runs(chat)) == 1  # die Routine lief nicht still nach
    finally:
        svc.stop()


# ---- 6 Constis Antwort auf eine Rückfrage geht bei kill -9 nicht verloren
# ---- 2b kill -9, während eine Routine läuft und auf eine Freigabe wartet
def test_kill9_during_running_routine_closes_run_and_card(data_dir, tmp_path):
    svc = Service(data_dir, tmp_path)
    svc.start()
    try:
        chat = svc.post("/v1/bots", {"name": "Nova", "job": "Hilft", "avatar": "nepi", "color": "#3366ff", "isMain": True}).json()["chatId"]
        svc.get(f"/v1/chats/{chat}/messages")
        bot = svc.sql("SELECT id FROM bots")[0]["id"]
        a = routine(svc, {"botId": bot, "name": "Rt", "prompt": "tu es", "schedule": {"kind": "daily", "at": "09:00"}, "timezone": "Europe/Berlin",
                                         "target": "same", "notify": "app", "model": "claude-haiku-5-5", "effort": None, "context": True})
        from test_e2e import SPEND_CALL
        svc.script(SPEND_CALL)  # die Routine ruft ein geld-Werkzeug mit Freigabe auf und wartet
        assert svc.post(f"/v1/automations/{a}/run").json()["ok"]
        old = until(lambda: svc.sql("SELECT id FROM pending_interactions WHERE kind='approval'"), what="Freigabe der Routine")[0]["id"]
        pgid = svc.pgid()
        assert svc.sql("SELECT status FROM work_runs")[0]["status"] in ("running", "waiting")
        svc.kill9()
        svc.script({})
        svc.start()
        until(lambda: svc.sql("SELECT id FROM pending_interactions WHERE id LIKE 'missed:%'"), what="Karte verpasste Routine")
        assert not svc.sql("SELECT id FROM pending_interactions WHERE id=?", old)  # die alte Freigabe ist abgebrochen
        assert [r["status"] for r in svc.sql("SELECT status FROM work_runs")] == ["interrupted"]
        assert svc.sql("SELECT status FROM automation_runs")[0]["status"] == "error"
        time.sleep(1.0)
        assert len(svc.runs()) == 1 and not (pgid and alive(pgid))  # nichts läuft nach
    finally:
        svc.stop()


def test_kill9_keeps_queued_answer(data_dir, tmp_path):
    svc = Service(data_dir, tmp_path)
    svc.start()
    try:
        chat = svc.post("/v1/bots", {"name": "Nova", "job": "Hilft", "avatar": "nepi", "color": "#3366ff", "isMain": True}).json()["chatId"]
        svc.get(f"/v1/chats/{chat}/messages")
        svc.script(ASK_CALL)
        svc.turn("Frag mich etwas", chat=chat).wait()
        card = until(lambda: svc.sql("SELECT id FROM pending_interactions"), what="Rückfrage")[0]["id"]
        svc.script({"sleep": 30})
        svc.turn("Arbeite lange", chat=chat)
        until(lambda: len(svc.runs(chat)) == 2 and svc.pgid(), what="zweiter Lauf")
        r = svc.post(f"/v1/questions/{card}/answer", {"answers": [{"question": "Welche Farbe?", "answers": ["Rot"]}]})
        assert r.json() == {"ok": True}
        assert svc.sql("SELECT status FROM inbox_items WHERE kind='answer'")[0]["status"] == "queued"
        svc.kill9()
        svc.script({})
        svc.start()
        until(lambda: any("Rot" in c.get("prompt", "") for c in svc.fake_log()[2:]), what="Antwort erreicht den Orbi")
    finally:
        svc.stop()


def test_recover_requeues_answer_lost_mid_turn(client, ctx, seed):
    db, t = ctx.db, now_ms()
    db.run("INSERT INTO work_runs (id,kind,chat_id,bot_id,status,payload,started_at,updated_at) VALUES ('r1','turn','chat1','bot1','running','{}',?,?)", t, t)
    db.run("INSERT INTO inbox_items (id,bot_id,chat_id,kind,payload,status,run_id,due_at,created_at,updated_at) VALUES ('a1','bot1','chat1','answer',?,'processing','r1',?,?,?)",
           dumps({"text": "Rot"}), t + 10**9, t, t)
    client.portal.call(recovery.recover, ctx.parts["runtime"])
    assert db.val("SELECT status FROM inbox_items WHERE id='a1'") == "queued"


# ---- 7 Auto bleibt Auto, festes Modell bleibt fest
@pytest.mark.parametrize("wanted", ["auto", "claude-opus-5-5"])
def test_follow_up_keeps_wanted_model(client, ctx, seed, wanted):
    ctx.db.run("INSERT INTO work_runs (id,kind,chat_id,bot_id,status,payload,started_at,updated_at) VALUES ('r1','turn','chat1','bot1','done',?,?,?)",
               dumps({"model": "claude-haiku-5-5", "effort": None, "wanted": wanted, "wantedEffort": "high"}), now_ms(), now_ms())
    data = ctx.parts["runtime"]._client_data([{"payload": {"text": "Rot"}}], "bot1", "chat1")
    assert data == {"model": wanted, "effort": "high", "fast": False}


# ---- 5 Stopp im Ursprungs-Chat verwirft wartende Einträge anderer Chats
def test_stop_cancels_downstream_queue_and_stops_task(client, ctx, seed):
    db, t = ctx.db, now_ms()
    db.run("INSERT INTO tasks (id,orbi_id,parent_chat_id,brief,status,created_at,updated_at) VALUES ('t1','bot1','chat1','x','running',?,?)", t, t)
    db.run("INSERT INTO inbox_items (id,bot_id,chat_id,kind,payload,status,due_at,created_at,updated_at) VALUES ('q1','bot1','chat9','message',?,'queued',?,?,?)",
           dumps({"taskId": "t1", "rootChatId": "chat1"}), t + 10**9, t, t)
    client.portal.call(ctx.parts["runtime"].stop, "chat1")
    assert db.val("SELECT status FROM inbox_items WHERE id='q1'") == "cancelled" and db.val("SELECT status FROM tasks WHERE id='t1'") == "stopped"


# ---- 3 und 4 Werkzeug-Aufrufe hängen am Lauf
def _bridge_run(ctx):
    bridge = Bridge(ctx)
    ran = []

    @tool("sleepy_test", "x", {"type": "object"})
    async def sleepy(run, args):
        await asyncio.sleep(30)

    @tool("risky_test", "x", {"type": "object"}, risk=lambda run, a: Risk("geld", "risky_test", "x"))
    async def risky(run, args):
        ran.append(1)
        return "ok"

    async def gate(*a):
        bridge.unregister(token)  # der Lauf endet, während die Freigabe offen ist
    ctx.parts["interactions"] = SimpleNamespace(gate=gate)
    run = SimpleNamespace(ctx=ctx, chat_kind="direct", chat_id="chat1", calls=set(), bot={"id": "bot1", "name": "Nova", "is_main": 1}, counters={}, id="r1")
    token = bridge.register(run)
    return bridge, run, ran


def test_open_tool_call_is_task_of_run_and_can_be_cancelled(ctx):
    async def go():
        bridge, run, _ = _bridge_run(ctx)
        call = asyncio.ensure_future(bridge.call(run, "sleepy_test", {}))
        await asyncio.sleep(0.05)
        assert len(run.calls) == 1
        for c in run.calls:
            c.cancel()
        with pytest.raises(asyncio.CancelledError):
            await call
    try:
        asyncio.run(go())
    finally:
        TOOLS.pop("sleepy_test", None), TOOLS.pop("risky_test", None)


def test_late_approval_does_not_run_after_run_ended(ctx):
    async def go():
        bridge, run, ran = _bridge_run(ctx)
        assert await bridge.call(run, "risky_test", {}) == ("Der Lauf ist beendet.", True, [])
        assert ran == []
    try:
        asyncio.run(go())
    finally:
        TOOLS.pop("sleepy_test", None), TOOLS.pop("risky_test", None)


# ---- 3 Mac-Unterprozess: Gruppe im Lauf, Abbruch beendet sie
def test_mac_process_group_is_recorded_and_killed_on_cancel(ctx, seed):
    ctx.db.run("INSERT INTO work_runs (id,kind,chat_id,bot_id,status,payload,started_at,updated_at) VALUES ('r1','turn','chat1','bot1','running','{}',?,?)", now_ms(), now_ms())
    groups = lambda: json.loads(ctx.db.val("SELECT payload FROM work_runs WHERE id='r1'")).get("groups")

    async def go():
        mac._current.set(SimpleNamespace(ctx=ctx, id="r1"))
        task = asyncio.ensure_future(mac.run(["/bin/sleep", "30"], timeout=30))
        for _ in range(100):
            await asyncio.sleep(0.05)
            if groups():
                break
        [g] = groups()
        assert alive_pg(g["pgid"]) and g["start"]
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
        return g["pgid"]
    pgid = asyncio.run(go())
    assert groups() == [] and not alive_pg(pgid)


def alive_pg(pgid):
    try:
        os.killpg(pgid, 0)
        return True
    except (ProcessLookupError, PermissionError):  # macOS: Gruppe aus Zombies meldet EPERM
        return False


# ---- 9 Prozessgruppen nur bei passender Startzeit, auch wenn nur ein Enkel lebt
def test_reap_checks_start_time_and_handles_orphaned_grandchild():
    p = subprocess.Popen(["/bin/sleep", "30"], start_new_session=True)
    try:
        assert recovery.reap(p.pid, "Mon Jan  1 00:00:00 2001") is False and alive_pg(p.pid)  # fremde Startzeit: Nummer neu vergeben
        assert recovery.reap(p.pid, recovery.proc_start(p.pid)) is True
        p.wait(5)
    finally:
        p.kill()
    q = subprocess.Popen(["/bin/sh", "-c", "sleep 30 & sleep 0.5; exit 0"], start_new_session=True)
    start = recovery.proc_start(q.pid)
    q.wait(5)  # Anführer ist weg, der Enkel lebt in der Gruppe weiter
    time.sleep(0.2)
    assert alive_pg(q.pid) and recovery.reap(q.pid, start) is True
    until(lambda: not alive_pg(q.pid), 3, "Enkel beendet")
