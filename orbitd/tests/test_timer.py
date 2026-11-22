"""Zeitgeber, Routinen-Lauf und Karte für verpasste Routinen. Zeit über timer.now statt Schlafen, Attrappen-CLI, Daten nur in /tmp."""
import time

import pytest

from orbitd import automations
from orbitd.db import now_ms

ROUTINE = {"botId": "bot1", "name": "Morgenrunde", "prompt": "Sag Hallo", "schedule": {"kind": "daily", "at": "09:00"},
           "timezone": "Europe/Berlin", "target": "same", "notify": "app", "model": "claude-haiku-5-5", "effort": None, "context": True}


def wait(cond, timeout=15.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.05)
    raise AssertionError("Zeitüberschreitung beim Warten")


@pytest.fixture
def setup(client, ctx, seed):
    events = []
    ctx.bus.listeners.append(events.append)
    timer = ctx.parts["timer"]
    tick = lambda: client.portal.call(timer.tick)
    new = lambda: automations.create(ctx.db, ROUTINE)

    def due(automation_id, ago_ms):
        t = now_ms() - ago_ms
        ctx.db.run("UPDATE automations SET next_run_at=? WHERE id=?", t, automation_id)
        timer.now = now_ms
        return t

    return events, tick, new, due


def runs(ctx):
    return [dict(r) for r in ctx.db.all("SELECT * FROM automation_runs ORDER BY started_at")]


def test_due_routine_runs_exactly_once(client, ctx, setup):
    events, tick, new, due = setup
    a = new()
    due(a, 10_000)
    tick()
    tick()
    assert len(runs(ctx)) == 1 and ctx.db.val("SELECT count(*) FROM inbox_items WHERE kind='timer'") == 1
    assert ctx.db.val("SELECT next_run_at FROM automations WHERE id=?", a) > now_ms()
    wait(lambda: runs(ctx)[0]["status"] == "ok")
    [run] = runs(ctx)
    assert run["trigger"] == "schedule" and run["chat_id"] == "chat1" and run["finished_at"]
    assert [e["status"] for e in events if e["type"] == "automation"] == ["running", "ok"]
    assert client.get("/v1/automations/unread").json()["count"] == 1
    assert client.get(f"/v1/automations/{a}/runs").json()["runs"][0]["status"] == "ok"
    texts = ["".join(p.get("text", "") for p in m["parts"]) for m in client.get("/v1/chats/chat1/messages").json()["messages"]]
    assert texts[0].startswith("[[automation:Morgenrunde]]") and texts[1].startswith("Antwort auf:")


def test_manual_run_and_snapshot(client, ctx, setup):
    events, tick, new, due = setup
    a = new()
    r = client.post(f"/v1/automations/{a}/run").json()
    assert r["ok"] and r["runId"]
    wait(lambda: runs(ctx)[0]["status"] == "ok")
    assert runs(ctx)[0]["trigger"] == "manual" and runs(ctx)[0]["id"] == r["runId"]
    ctx.db.run("UPDATE automation_runs SET status='running', finished_at=NULL")  # ein laufender Lauf steht im Snapshot und sperrt den nächsten
    assert ctx.parts["runtime"].snapshot()["automations"] == [{"automationId": a, "runId": r["runId"], "status": "running", "chatId": "chat1", "trigger": "manual"}]
    assert client.post(f"/v1/automations/{a}/run").json()["error"] == "Ein Lauf läuft noch oder wartet auf Freigabe."
    ctx.db.run("UPDATE automation_runs SET status='ok'")
    assert ctx.parts["runtime"].snapshot()["automations"] == []


def test_missed_routine_asks_once_and_runs_only_after_yes(client, ctx, setup):
    events, tick, new, due = setup
    a = new()
    t = due(a, 600_000)
    tick()
    tick()
    cards = ctx.parts["interactions"].list()
    assert len(cards) == 1 and cards[0]["id"] == f"missed:{a}:{t}" and cards[0]["kind"] == "ask" and cards[0]["chatId"] == "chat1"
    assert [o["label"] for o in cards[0]["input"]["questions"][0]["options"]] == ["Ausführen", "Überspringen"]
    assert runs(ctx) == [] and ctx.db.val("SELECT next_run_at FROM automations WHERE id=?", a) > now_ms()
    assert any(e["type"] == "question" and e["status"] == "pending" for e in events)
    tick()
    assert len(ctx.parts["interactions"].list()) == 1
    answer = {"answers": [{"question": cards[0]["input"]["questions"][0]["question"], "answers": ["Ausführen"]}]}
    assert client.post(f"/v1/questions/{cards[0]['id']}/answer", json=answer).status_code == 200
    wait(lambda: runs(ctx) and runs(ctx)[0]["status"] == "ok")
    assert runs(ctx)[0]["trigger"] == "missed" and ctx.parts["interactions"].list() == []


def test_skip_starts_nothing(client, ctx, setup):
    events, tick, new, due = setup
    a = new()
    due(a, 600_000)
    tick()
    [card] = ctx.parts["interactions"].list()
    assert client.post(f"/v1/questions/{card['id']}/answer", json={"answers": [{"question": "x", "answers": ["Überspringen"]}]}).status_code == 200
    assert runs(ctx) == [] and ctx.db.val("SELECT count(*) FROM inbox_items") == 0


def test_restart_creates_no_second_card(client, ctx, setup):
    from orbitd.runtime.timer import Timer
    events, tick, new, due = setup
    a = new()
    due(a, 600_000)
    tick()
    fresh = Timer(ctx, ctx.parts["runtime"])  # wie ein Neustart: neuer Zeitgeber, gleiche Datenbank
    client.portal.call(fresh.start)
    client.portal.call(fresh.stop)
    assert len(ctx.parts["interactions"].list()) == 1 and runs(ctx) == []
