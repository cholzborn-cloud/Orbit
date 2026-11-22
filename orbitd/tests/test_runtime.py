"""Laufzeit mit der Attrappen-CLI (cfg.fake_cli): Strom, Verlauf, Stopp, Wiederanlauf, Gruppen."""
import json
import os
import threading
import time
import uuid

import pytest

from orbitd import automations, cli
from orbitd.db import dumps, now_ms
from orbitd.runtime import contract, inbox, recovery


def wait(cond, timeout=10.0):
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.05)
    raise AssertionError("Zeitüberschreitung beim Warten")


def chunks(response) -> list:
    return [json.loads(line[6:]) for line in response.text.splitlines() if line.startswith("data: ") and line != "data: [DONE]"]


def body(text, model="claude-haiku-5-5", mid=None, **extra):
    return {"messages": [{"id": mid or uuid.uuid4().hex, "role": "user", "parts": [{"type": "text", "text": text}]}],
            "clientData": {"model": model, **extra}}


def history(client, chat="chat1"):
    return client.get(f"/v1/chats/{chat}/messages").json()["messages"]


def runs(ctx, chat="chat1"):
    return [dict(r) for r in ctx.db.all("SELECT * FROM work_runs WHERE chat_id=? ORDER BY started_at, rowid", chat)]


@pytest.fixture
def fake_log(tmp_path, monkeypatch):
    path = tmp_path / "fake.log"
    monkeypatch.setenv("ORBIT_FAKE_LOG", str(path))
    return lambda: [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []


@pytest.mark.parametrize("model", ["composer-test", "composer-test[fast=true]"])
def test_cursor_model_reaches_acp_exactly_even_as_profile_default(client, seed, fake_log, model):
    profile = "/v1/settings/profile"
    assert client.put(profile, json={"defaultModel": f"cursor:{model}"}).status_code == 200
    payload = body("Sag Hallo")
    payload.pop("clientData", None)
    result = client.post("/v1/chats/chat1/turn", json=payload)
    assert result.status_code == 200
    assert fake_log()[-1]["model"] == model


@pytest.mark.parametrize("model", ["claude-haiku-5-5", "gpt-6-luna", "gemini-3.8-flash", "cursor-auto"])
def test_text_streams_word_by_word_and_is_saved(client, ctx, seed, model, fake_log):
    mid = uuid.uuid4().hex
    r = client.post("/v1/chats/chat1/turn", json=body("Sag Hallo", model, mid))
    assert r.status_code == 200 and r.headers["x-vercel-ai-ui-message-stream"] == "v1"
    cs = chunks(r)
    types = [c["type"] for c in cs]
    assert types[:4] == ["start", "start-step", "text-start", "text-delta"] and types[-3:] == ["text-end", "finish-step", "finish"]
    deltas = [c["delta"] for c in cs if c["type"] == "text-delta"]
    assert len(deltas) > 3 or model == "gpt-6-luna"  # Codex liefert die ganze Nachricht auf einmal
    assert "".join(deltas).startswith("Antwort auf:")
    start = cs[0]
    assert start["messageMetadata"]["botId"] == "bot1" and start["messageMetadata"]["model"] == cli.BY_ID[model]["label"]
    assert cs[-1]["messageMetadata"]["finishedAt"] and cs[-1]["messageMetadata"]["inputTokens"] >= 0
    messages = history(client)
    assert [m["id"] for m in messages][0] == mid and messages[0]["role"] == "user"
    assistant = messages[1]
    assert assistant["id"] == start["messageId"] and assistant["role"] == "assistant"
    assert assistant["parts"][0] == {"type": "step-start"} and assistant["parts"][1]["text"] == "".join(deltas)
    assert fake_log()[-1]["model"] == cli.BY_ID[model]["model"]
    [run] = runs(ctx)
    assert (run["status"], run["kind"]) == ("done", "turn") and json.loads(run["payload"])["cli"] == cli.BY_ID[model]["cli"]
    assert ctx.db.val("SELECT status FROM inbox_items") == "done" and ctx.db.val("SELECT count(*) FROM turn_usage") == 1
    page = client.get("/v1/chats/chat1/messages?limit=1").json()
    assert len(page["messages"]) == 1 and page["hasMore"] is True and "interrupted" in page and page["reactions"] == []
    assert client.get("/v1/chats/chat1/stream").status_code == 204
    assert client.get("/v1/status").json()["chats"] == []


def test_validation(client, ctx, seed):
    url = "/v1/chats/chat1/turn"
    assert client.post(url, json={"messages": []}).status_code == 400
    assert client.post(url, json={"messages": [{"id": "x", "role": "user", "parts": [{"type": "bild"}]}]}).status_code == 400
    assert client.post("/v1/chats/nope/turn", json=body("x")).status_code == 404
    client.post(url, json=body("eins", mid="same"))
    assert client.post(url, json=body("eins", mid="same")).status_code == 409
    assert len(history(client)) == 2


def test_second_message_waits_and_gets_own_answer(client, ctx, seed, fake_log):
    first = {}
    t = threading.Thread(target=lambda: first.update(r=client.post("/v1/chats/chat1/turn", json=body("[[sleep:1]] eins"))))
    t.start()
    wait(lambda: any(r["status"] == "running" for r in runs(ctx)))
    second = client.post("/v1/chats/chat1/turn", json=body("zwei"))
    assert second.status_code == 200 and chunks(second) == []
    t.join(15)
    wait(lambda: len([m for m in history(client) if m["role"] == "assistant"]) == 2)
    roles = [m["role"] for m in history(client)]
    assert roles.count("assistant") == 2 and [r["status"] for r in runs(ctx)] == ["done", "done"]
    calls = fake_log()
    assert "eins" in calls[0]["prompt"] and "zwei" in calls[1]["prompt"] and "eins" not in calls[1]["prompt"].split("zwei")[-1]


def test_legacy_queued_message_stays_separate_from_new_model_choice(ctx, seed):
    legacy = inbox.enqueue(ctx.db, "bot1", "chat1", "message", {"text": "Vor dem Update"})
    explicit = inbox.enqueue(ctx.db, "bot1", "chat1", "message", {"clientData": {"model": "gpt-6-luna"}})
    picked = inbox.pick(ctx.db, "bot1")
    assert [item["id"] for item in picked] == [legacy]
    inbox.claim(ctx.db, picked, "test-run")
    inbox.finish(ctx.db, "test-run")
    assert [item["id"] for item in inbox.pick(ctx.db, "bot1")] == [explicit]


def test_queued_chat_uses_standard_at_send_time_unless_model_is_explicit(client, ctx, seed, fake_log):
    url = "/v1/chats/chat1/turn"
    profile = "/v1/settings/profile"
    first = threading.Thread(target=lambda: client.post(url, json=body("[[sleep:2]] eins")))
    first.start()
    try:
        wait(lambda: any(r["status"] == "running" for r in runs(ctx)))
        assert client.put(profile, json={"defaultModel": "gpt-6-luna", "defaultEffort": "medium"}).json()["ok"]
        assert client.post(url, json=body("zwei", None)).status_code == 200
        assert client.post(url, json=body("feste Denktiefe", "gpt-6-luna", effort="high")).status_code == 200
        assert client.post(url, json=body("ohne Denktiefe", "gpt-6-luna")).status_code == 200
        assert client.put(profile, json={"defaultModel": "gemini-3.8-flash", "defaultEffort": "low"}).json()["ok"]
        assert client.post(url, json=body("drei", "cursor-auto")).status_code == 200
        assert client.post(url, json=body("vier", None)).status_code == 200
    finally:
        first.join(15)
    wait(lambda: len([r for r in runs(ctx) if r["status"] == "done"]) == 6)
    expected = ["claude-haiku-5-5", "gpt-6-luna", "gpt-6-luna", "gpt-6-luna", "cursor-auto", "gemini-3.8-flash"]
    assert [json.loads(r["payload"])["wanted"] for r in runs(ctx)] == expected
    calls = fake_log()
    assert [call["model"] for call in calls] == [cli.BY_ID[m]["model"] for m in expected[:-1]] + ["gemini-3.8-flash-low"]  # Standard-Denktiefe „low“ wird zur Antigravity-ID
    assert 'model_reasoning_effort="medium"' in calls[1]["argv"]
    assert 'model_reasoning_effort="high"' in calls[2]["argv"]
    assert 'model_reasoning_effort="medium"' in calls[3]["argv"]  # Ältere Wünsche ohne Stufe nutzen die feste Standardstufe.


def test_fast_reaches_codex_only_for_models_that_have_it(client, ctx, seed, fake_log, monkeypatch):
    monkeypatch.setitem(cli.BY_ID["gpt-6-luna"], "fast", "priority")
    url = "/v1/chats/chat1/turn"
    assert client.post(url, json=body("schnell", "gpt-6-luna", fast=True)).status_code == 200
    assert client.post(url, json=body("normal", "gpt-6-luna")).status_code == 200
    assert client.post(url, json=body("ohne Fast-Modus", "claude-haiku-5-5", fast=True)).status_code == 200
    wait(lambda: len([r for r in runs(ctx) if r["status"] == "done"]) == 3)
    assert [json.loads(r["payload"])["wantedFast"] for r in runs(ctx)] == [True, False, True]
    calls = fake_log()
    assert 'service_tier="priority"' in calls[0]["argv"]
    assert not any(arg.startswith("service_tier=") for arg in calls[1]["argv"])
    assert not any("priority" in arg for arg in calls[2]["argv"])


def test_regenerate_keeps_depth_of_previous_turn(client, ctx, seed, fake_log):
    url = "/v1/chats/chat1/turn"
    profile = "/v1/settings/profile"
    assert client.put(profile, json={"defaultModel": "claude-haiku-5-5", "defaultEffort": "high"}).json()["ok"]
    assert client.post(url, json=body("Wiederholen", None)).status_code == 200
    assert client.put(profile, json={"defaultEffort": "low"}).json()["ok"]
    r = client.post(url, json={**body("Wiederholen", None), "trigger": "regenerate-message"})
    assert r.status_code == 200
    assert [json.loads(r["payload"])["wantedEffort"] for r in runs(ctx)] == ["high", "high"]
    for call in fake_log():
        assert call["argv"][call["argv"].index("--effort") + 1] == "high"


def test_stop_kills_child_and_returns_queued(client, ctx, seed, monkeypatch, tmp_path):
    pidfile = tmp_path / "child.pid"
    monkeypatch.setenv("ORBIT_FAKE_PIDFILE", str(pidfile))
    first = {}
    t = threading.Thread(target=lambda: first.update(r=client.post("/v1/chats/chat1/turn", json=body("[[hang]][[child]] los"))))
    t.start()
    wait(pidfile.exists)
    pid = int(pidfile.read_text())
    client.post("/v1/chats/chat1/turn", json=body("später"))
    assert client.get("/v1/status").json()["chats"][0]["status"] == "arbeitet"
    stopped = client.post("/v1/chats/chat1/stop").json()
    assert stopped == {"stopped": True, "requeued": ["später"]}

    def dead():
        try:
            os.kill(pid, 0)
            return False
        except ProcessLookupError:
            return True
    wait(dead)
    t.join(15)
    assert not t.is_alive() and chunks(first["r"])[-1]["type"] == "abort"
    [run] = runs(ctx)
    assert (run["status"], run["error"]) == ("failed", "gestoppt")
    assert [m["role"] for m in history(client)] == ["user"]  # die wartende Nachricht ist wieder aus dem Verlauf
    assert ctx.db.val("SELECT count(*) FROM inbox_items WHERE status IN ('queued','processing')") == 0
    assert client.post("/v1/chats/chat1/stop").json() == {"stopped": False, "requeued": []}
    assert client.post("/v1/chats/chat1/turn", json=body("nochmal")).status_code == 200  # Chat ist wieder frei


@pytest.mark.parametrize("model", ["claude-haiku-5-5", "gpt-6-luna"])
def test_fixed_model_every_turn_and_session_resumes(client, ctx, seed, fake_log, model):
    client.post("/v1/chats/chat1/turn", json=body("eins", model))
    client.post("/v1/chats/chat1/turn", json=body("zwei", model))
    a, b = fake_log()
    assert a["model"] == b["model"] == model and a["session"] is None and b["session"]
    other = "gemini-3.8-flash" if model.startswith("gpt") else "gpt-6-luna"
    client.post("/v1/chats/chat1/turn", json=body("drei", other))
    assert fake_log()[-1]["model"] == cli.cli_model(cli.BY_ID[other], None) and fake_log()[-1]["session"] != b["session"]  # andere CLI: neue Sitzung


def test_unknown_model_is_an_error_not_a_fallback(client, ctx, seed, fake_log):
    cs = chunks(client.post("/v1/chats/chat1/turn", json=body("x", "gibt-es-nicht")))
    assert [c["type"] for c in cs if c["type"] == "error"] and fake_log() == []
    assert runs(ctx)[0]["status"] == "failed"


def test_exit_code_becomes_error_chunk(client, ctx, seed):
    cs = chunks(client.post("/v1/chats/chat1/turn", json=body("[[exit:1]]")))
    errors = [c for c in cs if c["type"] == "error"]
    assert errors and "Claude" in errors[0]["errorText"] and cs[0]["type"] == "start"
    [run] = runs(ctx)
    assert run["status"] == "failed" and run["error"]
    assert client.get("/v1/status").json()["chats"] == [] and client.get("/v1/chats/chat1/stream").status_code == 204
    assert ctx.db.val("SELECT status FROM inbox_items") == "failed"
    assert client.post("/v1/chats/chat1/turn", json=body("danach")).status_code == 200


def test_recovery_and_resume(client, ctx, seed, fake_log):
    db, t = ctx.db, now_ms()
    db.run("INSERT INTO chat_messages (chat_id,id,role,parts,metadata,position,created_at) VALUES ('chat1','u0','user',?,NULL,1,?)", dumps([{"type": "text", "text": "mach das"}]), t)
    db.run("INSERT INTO work_runs (id,kind,chat_id,bot_id,status,payload,steps,started_at,updated_at) VALUES ('r1','turn','chat1','bot1','running',?,3,?,?)",
           dumps({"model": "claude-haiku-5-5", "cli": "claude", "taskId": "t1", "rootChatId": "chat1"}), t, t)
    db.run("INSERT INTO inbox_items (id,bot_id,chat_id,kind,payload,status,run_id,due_at,created_at,updated_at) VALUES ('i1','bot1','chat1','message','{}','processing','r1',?,?,?)", t, t, t)
    db.run("INSERT INTO inbox_items (id,bot_id,chat_id,kind,payload,status,due_at,created_at,updated_at) VALUES ('i2','bot1','chat1','message','{}','queued',?,?,?)", t + 10**9, t, t)
    assert client.portal.call(recovery.recover, ctx.parts["runtime"]) == 1
    assert [db.val("SELECT status FROM work_runs WHERE id='r1'"), db.val("SELECT status FROM inbox_items WHERE id='i1'"), db.val("SELECT status FROM inbox_items WHERE id='i2'")] == ["interrupted", "cancelled", "queued"]  # wartende Nachricht bleibt
    db.run("UPDATE inbox_items SET status='cancelled' WHERE id='i2'")  # sonst hält sie „Weiter“ als BUSY auf
    info = client.get("/v1/chats/chat1/messages").json()["interrupted"]
    assert info["runId"] == "r1" and info["steps"] == 3
    assert client.get("/v1/status").json()["interrupted"][0]["runId"] == "r1"
    assert client.post("/v1/chats/chat1/resume", json={"runId": "nope"}).status_code == 404
    assert client.post("/v1/chats/chat1/resume", json={}).status_code == 400
    assert client.post("/v1/chats/chat1/resume", json={"runId": "r1"}).json() == {"ok": True}
    assert client.post("/v1/chats/chat1/resume", json={"runId": "r1"}).status_code == 409
    wait(lambda: len(runs(ctx)) == 2 and runs(ctx)[1]["status"] == "done")
    assert len(fake_log()) == 1 and "restart" in fake_log()[0]["prompt"] and "mach das" in fake_log()[0]["prompt"]
    assert client.get("/v1/chats/chat1/messages").json()["interrupted"] is None
    # verwerfen merkt nur „verworfen“ und startet nichts
    db.run("INSERT INTO work_runs (id,kind,chat_id,bot_id,status,payload,started_at,updated_at) VALUES ('r2','turn','chat1','bot1','interrupted','{}',?,?)", t, t)
    assert client.post("/v1/chats/chat1/resume", json={"runId": "r2", "dismiss": True}).status_code == 200
    assert db.val("SELECT note FROM work_runs WHERE id='r2'") == "verworfen" and len(runs(ctx)) == 3 and len(fake_log()) == 1


@pytest.fixture
def group(ctx, seed):
    db, t = ctx.db, now_ms()
    db.run("INSERT INTO bots (id,user_id,third_party_id,name,avatar,color,job,instructions,is_main,sandbox_id,created_at) VALUES ('bot2','local','bot2','Bo','nepi','#fff','Hilft','',0,'fake-bot2',?)", t)
    db.run("INSERT INTO chats (id,user_id,kind,name,last_message_at,created_at) VALUES ('grp','local','group','Team',?,?)", t, t)
    for i, bot in enumerate(("bot2", "bot1")):  # Bo ist früher beigetreten, Nova ist Hauptorbi
        db.run("INSERT INTO chat_members (chat_id,bot_id,joined_at) VALUES ('grp',?,?)", bot, t + i)
    return "grp"


@pytest.mark.parametrize("text,order,extra", [("Hallo zusammen", ["bot1", "bot2"], 0), ("@Bo was meinst du", ["bot2", "bot1"], 1)])  # extra: Nova gibt die @Bo-Frage wieder, Bo bekommt den Nachlauf
def test_group_round_is_sequential(client, ctx, group, text, order, extra):
    events = []
    ctx.bus.listeners.append(events.append)
    mid = uuid.uuid4().hex
    r = client.post("/v1/chats/grp/turn", json=body(text, mid=mid))
    assert [c["type"] for c in chunks(r)].count("start") == 2 + extra
    assistants = [m for m in history(client, "grp") if m["role"] == "assistant"]
    assert [m["metadata"]["botId"] for m in assistants][:2] == order
    a, b = assistants[:2]
    assert a["metadata"]["finishedAt"] <= b["metadata"]["startedAt"]
    assert client.post("/v1/chats/grp/turn", json=body(text, mid=mid)).status_code == 409
    time.sleep(0.3)
    assert len(runs(ctx, "grp")) == 2 + extra
    phases = [e["phase"] for e in events if e["type"] == "group-turn"]
    assert phases == ["start"] + ["reply"] * (2 + extra) + ["end"]


class Stub(cli.Adapter):
    name, label = "claude", "Stub"

    def __init__(self, events):
        super().__init__(None)
        self.events = events

    def available(self):
        return True

    async def run(self, turn, tree_ready):
        for ev in self.events:
            yield ev


def E(kind, **data):
    return cli.Ev(kind, data)


def test_steps_come_from_real_data_and_orbit_tools_are_skipped(client, ctx, seed):
    rt, events = ctx.parts["runtime"], []
    ctx.bus.listeners.append(events.append)
    rt.adapters["claude"] = Stub([
        E("think", delta="Ich prüfe zuerst die Datei.\nDann weiter."), E("tool_start", id="t1", name="Read", input={"file_path": "/tmp/a.txt"}),
        E("tool_end", id="t1", name="Read", ok=True, output="x"), E("tool_start", id="t2", name="mcp__orbit__say", input={"text": "hi"}),
        E("tool_end", id="t2", name="mcp__orbit__say", ok=True, output="x"), E("text", delta="Fertig."), E("usage", inputTokens=5, outputTokens=2, cachedTokens=1, costUsd=0.5),
        E("done", reason="stop")])
    cs = chunks(client.post("/v1/chats/chat1/turn", json=body("los")))
    assert not [c for c in cs if c["type"].startswith(("tool-", "reasoning"))]
    steps = [(e["tool"], e["label"], e["state"]) for e in events if e["type"] == "status-step"]
    assert steps == [("denken", "Denkt nach …", "start"), ("denken", "Denkt nach …", "end"),
                     ("Read", "Read: /tmp/a.txt", "start"), ("Read", "Read: /tmp/a.txt", "end")]
    meta = cs[-1]["messageMetadata"]
    assert (meta["inputTokens"], meta["outputTokens"], meta["costUsd"]) == (5, 2, 0.5)
    assert ctx.db.val("SELECT steps FROM work_runs") == 2


def test_silent_and_empty_answers_are_not_saved(client, ctx, seed):
    rt = ctx.parts["runtime"]
    for events in ([E("text", delta="[[st"), E("text", delta="ill]]"), E("done")], [E("done")]):
        rt.adapters["claude"] = Stub(events)
        cs = chunks(client.post("/v1/chats/chat1/turn", json=body("pst")))
        assert cs == []
    assert [m["role"] for m in history(client)] == ["user", "user"]
    assert [r["status"] for r in runs(ctx)] == ["done", "done"]


def test_idle_timeout_fails_the_run(client, ctx, seed, monkeypatch):
    monkeypatch.setattr(contract, "TURN_IDLE_S", 0.6)
    cs = chunks(client.post("/v1/chats/chat1/turn", json=body("[[hang]]")))
    assert any(c["type"] == "error" for c in cs) and runs(ctx)[0]["status"] == "failed"


class Script(Stub):
    """Je Aufruf ein Antworttext (der Reihe nach)."""

    def __init__(self, texts, seen=None):
        super().__init__([])
        self.texts, self.seen = list(texts), seen if seen is not None else []

    async def run(self, turn, tree_ready):
        self.seen.append(turn)
        yield E("text", delta=self.texts.pop(0))
        yield E("done", reason="stop")


def test_group_at_mention_follow_up_is_capped_and_never_self(client, ctx, group):
    # Nova (Hauptorbi) ruft sich selbst und Bo; Bo und Nova rufen sich dann gegenseitig, bis die Grenze von 3 greift.
    ctx.parts["runtime"].adapters["claude"] = Script(["@Nova @Bo hallo", "ok", "@Bo du", "@Nova du", "@Bo noch mal", "nie gebraucht"])
    chunks(client.post("/v1/chats/grp/turn", json=body("Hallo zusammen")))
    wait(lambda: not ctx.db.val("SELECT 1 FROM inbox_items WHERE status IN ('queued','processing')"))
    names = [m["metadata"]["botId"] for m in history(client, "grp") if m["role"] == "assistant"]
    assert names == ["bot1", "bot2"]  # Bo war schon in der Runde, Selbstruf zählt nicht

    ctx.parts["runtime"].adapters["claude"] = Script(["@Bo schau", "@Nova du", "@Bo du", "@Nova du", "@Bo", "x"])
    chunks(client.post("/v1/chats/grp/turn", json=body("@Nova los", mid="m2")))
    wait(lambda: not ctx.db.val("SELECT 1 FROM inbox_items WHERE status IN ('queued','processing')"))
    assert ctx.db.val("SELECT count(*) FROM work_runs WHERE chat_id='grp'") == 2 + 2 + 3  # Runde 2: 2 Antworten + 3 Nachlauf


def test_silent_answer_triggers_no_follow_up(client, ctx, group):
    ctx.parts["runtime"].adapters["claude"] = Script(["[[still]] @Bo", "ok"])
    chunks(client.post("/v1/chats/grp/turn", json=body("Hallo")))
    wait(lambda: not ctx.db.val("SELECT 1 FROM inbox_items WHERE status IN ('queued','processing')"))
    assert ctx.db.val("SELECT count(*) FROM work_runs WHERE chat_id='grp'") == 2


def test_run_knows_automation_and_run_waits_while_approval_is_open(client, ctx, seed):
    rt, events, seen = ctx.parts["runtime"], [], {}
    ctx.bus.listeners.append(events.append)
    a = automations.create(ctx.db, {"botId": "bot1", "name": "Rt", "prompt": "tu es", "schedule": {"kind": "daily", "at": "09:00"}, "timezone": "Europe/Berlin", "target": "same",
                                                   "notify": "app", "model": "claude-haiku-5-5", "effort": None, "context": True})
    status = lambda: ctx.db.val("SELECT status FROM automation_runs")

    class Waiting(Stub):
        async def run(self, turn, tree_ready):
            run = rt.runs[next(iter(rt.runs))]
            seen["id"] = run.automation_id
            run.set_waiting(True)
            seen["during"] = status()
            run.set_waiting(False)
            seen["after"] = status()
            yield E("text", delta="fertig")
            yield E("done", reason="stop")

    rt.adapters["claude"] = Waiting([])
    client.portal.call(rt.run_automation, a, "manual")
    wait(lambda: status() == "ok")
    assert seen == {"id": a, "during": "waiting", "after": "running"}
    assert [e["status"] for e in events if e["type"] == "automation"] == ["running", "waiting", "running", "ok"]


def test_auto_model_tells_jev_about_attachments(client, ctx, seed):
    asked = []

    class Jev:
        async def choose(self, info):
            asked.append(info["hasFiles"])

    ctx.parts["jev"] = Jev()
    file = {"type": "file", "url": "data:text/plain;base64,aGk=", "mediaType": "text/plain", "filename": "a.txt"}
    for parts in ([{"type": "text", "text": "ohne"}], [{"type": "text", "text": "mit"}, file]):
        b = body("x", model="auto")
        b["messages"][0]["parts"] = parts
        chunks(client.post("/v1/chats/chat1/turn", json=b))
    assert asked == [False, True]


def test_skill_aus_eingabefeld_wird_gespeichert(client, ctx, seed, fake_log):
    mid = uuid.uuid4().hex
    client.post("/v1/chats/chat1/turn", json=body("Hi", "claude-haiku-5-5", mid, skill={"name": "x-skill", "source": "a"}))
    m = next(m for m in history(client) if m["id"] == mid)
    assert m["metadata"]["skill"] == {"name": "x-skill", "source": "a"}


def test_save_survives_deleted_chat(ctx, seed):
    # Chat (mit seinem Orbi) wurde während des Laufs gelöscht: Speichern darf den Abschluss des Laufs nicht abbrechen
    from types import SimpleNamespace
    from orbitd.runtime import runner
    cls = next(c for c in vars(runner).values() if isinstance(c, type) and "save" in vars(c))
    me = SimpleNamespace(db=ctx.db, chat_id="gibt-es-nicht", message_id="m1", parts=[{"type": "text", "text": "hallo"}], saved=False,
                         last_save=0, _has_content=lambda: True, _meta=lambda final=False: {})
    cls.save(me, final=True)
    assert me.saved is False



def test_dedupe_drops_repeated_answer():
    from types import SimpleNamespace
    from orbitd.runtime.runner import Runner
    first = "Leider nein, ich konnte den Termin nicht anlegen, weil der Kalender gesperrt ist."
    parts = [{"type": "text", "text": first}, {"type": "tool-ask_user", "toolCallId": "a"}, {"type": "text", "text": first + " Ich habe dir eine Frage gestellt."},
             {"type": "text", "text": "Kurz."}, {"type": "text", "text": "Kurz. Und noch etwas."}]
    me = SimpleNamespace(parts=parts)
    Runner._dedupe_text(me)
    assert [p.get("text") for p in me.parts] == [None, first + " Ich habe dir eine Frage gestellt.", "Kurz.", "Kurz. Und noch etwas."]



def test_dedupe_keeps_different_texts_with_same_start():
    from types import SimpleNamespace
    from orbitd.runtime.runner import Runner
    a = "Deine Mails von heute: Rechnung von Apple, Versand von The Gallerist und ein Login-Hinweis."
    b = "Deine Mails von heute: Rechnung von Apple, Versand von The Gallerist und zwei Newsletter."
    me = SimpleNamespace(parts=[{"type": "text", "text": a}, {"type": "text", "text": b}, {"type": "text", "text": a[:50]}])
    Runner._dedupe_text(me)
    assert [p["text"] for p in me.parts] == [a, b, a[:50]]  # auch ein abgebrochener zweiter Text löscht den vollen ersten nicht


@pytest.mark.parametrize("effort,agy_id", [("low", "gemini-3.8-flash-low"), ("medium", "gemini-3.8-flash-medium"), ("high", "gemini-3.8-flash-high"), (None, "gemini-3.8-flash-medium")])
def test_gemini_is_one_model_and_effort_picks_the_antigravity_id(client, ctx, seed, fake_log, effort, agy_id):
    entry = cli.BY_ID["gemini-3.8-flash"]
    assert entry["efforts"] == ["low", "medium", "high"] and set(entry["variants"].values()) <= {m for m in entry["variants"].values()}
    assert not [m for m in cli.MODELS if m["id"].startswith("gemini-3.8-flash-")]  # keine Einzeleinträge mehr
    client.post("/v1/chats/chat1/turn", json=body("Hallo", "gemini-3.8-flash", effort=effort))
    call = fake_log()[-1]
    assert call["model"] == agy_id
    assert json.loads(runs(ctx)[-1]["payload"])["effort"] == (effort or "medium") and json.loads(runs(ctx)[-1]["payload"])["model"] == "gemini-3.8-flash"


def test_old_single_gemini_ids_still_resolve_to_model_and_effort(client, ctx, seed, fake_log):
    client.post("/v1/chats/chat1/turn", json=body("Hallo", "gemini-3.8-flash-high"))
    assert fake_log()[-1]["model"] == "gemini-3.8-flash-high"
    payload = json.loads(runs(ctx)[-1]["payload"])
    assert payload["model"] == "gemini-3.8-flash" and payload["effort"] == "high"


def test_live_codex_chunks_keep_id_and_accept_full_emoji_and_reply(client, ctx, seed):
    chat = seed["chat"]
    url = f"/v1/chats/{chat}"
    model = next(m["id"] for m in cli.MODELS if m["cli"] == "codex")
    turn = {"messages": [{"id": "live-user", "role": "user", "parts": [{"type": "text", "text": "Hallo"}]}],
            "clientData": {"model": model}}
    with client.stream("POST", url + "/turn", json=turn) as response:
        assert response.status_code == 200
        chunks = [json.loads(line[6:]) for line in response.iter_lines() if line.startswith("data: {")]
    delta = [c for c in chunks if c["type"] == "text-delta"]
    assert len(delta) > 1 and len({c["id"] for c in delta}) == 1
    part_id = delta[0]["id"]
    stored = client.get(url + "/messages").json()["messages"]
    assert any(part.get("id") == part_id for m in stored for part in m["parts"])
    endpoint = f"{url}/messages/{part_id}/reaction"
    assert client.put(endpoint, json={"emoji": "👩🏽‍💻"}).status_code == 200
    assert client.put(endpoint, json={"emoji": ["👍"]}).status_code == 400
    ref = {"id": part_id, "name": "Nova", "text": "Hallo zurück"}
    turn["messages"][0]["id"] = "reply-user"
    turn["clientData"]["replyTo"] = ref
    assert client.post(url + "/turn", json=turn).status_code == 200
    stored = client.get(url + "/messages").json()["messages"]
    assert next(m for m in stored if m["id"] == "reply-user")["metadata"]["replyTo"] == ref


def test_cursor_bekommt_anleitung_bei_jedem_zug_und_fragekarten_regel(client, seed, fake_log):
    """Fortgesetzte Cursor-Sitzungen kannten neue Anleitung und Regeln nie (nur beim ersten Zug mitgeschickt); Fragen kamen als Text statt Karte (20.11.2026)."""
    assert client.put("/v1/settings/profile", json={"defaultModel": "cursor:composer-test"}).status_code == 200
    for text in ("Erster Zug", "Zweiter Zug"):
        payload = body(text)
        payload.pop("clientData", None)
        assert client.post("/v1/chats/chat1/turn", json=payload).status_code == 200
    prompts = [c["prompt"] for c in fake_log() if c["dialect"] == "cursor"]
    assert len(prompts) >= 2
    for prompt in prompts[-2:]:
        assert "ask_user" in prompt and "Karte" in prompt and "nie im Text" in prompt


def test_private_model_mention_does_not_wake_a_group_member(client, ctx, group):
    rt = ctx.parts["runtime"]

    class Publish(Stub):
        async def run(self, turn, tree_ready):
            run = rt.runs["grp"]
            first = "The first explicit delivery should remain in this conversation."
            run.publish("text", [{"type": "text", "text": first}], key=run.id + ":1")
            run.publish("text", [{"type": "text", "text": first + " More detail."}], key=run.id + ":2", end_turn=True)
            yield E("text", delta="@Bo private report")
            yield E("done", reason="stop")

    rt.adapters["claude"] = Publish([])
    request = body("A question for Nova")
    request["clientData"]["botId"] = "bot1"
    chunks(client.post("/v1/chats/grp/turn", json=request))
    wait(lambda: not ctx.db.val("SELECT 1 FROM inbox_items WHERE status IN ('queued','processing')"))
    assert ctx.db.val("SELECT count(*) FROM work_runs WHERE chat_id='grp'") == 1
    assert ctx.db.val("SELECT count(*) FROM deliveries WHERE visibility='private' AND parts LIKE '%@Bo%'") == 1
    public = [p["text"] for m in history(client, "grp") if m["role"] == "assistant" for p in m["parts"] if p["type"] == "text"]
    assert len(public) == 2 and public[1] == public[0] + " More detail."
