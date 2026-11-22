"""Werkzeug-Brücke (MCP), Freigabe-Tor und Karten. Die Brücke läuft auf einem echten Port (uvicorn), ohne Dienst-Guard."""
import asyncio
import sys
import types
from types import SimpleNamespace

import httpx
import httpx2
import pytest
import uvicorn
from mcp import Client
from mcp.client.streamable_http import streamable_http_client
from starlette.applications import Starlette

from orbitd import chatstore
from orbitd.db import dumps, loads, new_id, now_ms
from orbitd.runtime import contract, inbox
from orbitd.runtime.contract import TOOLS, Risk, Tool
from orbitd.runtime.interactions import Interactions
from orbitd.tools.bridge import Bridge
from orbitd.web import Fail, build_routes

pytestmark = pytest.mark.anyio
DECIDE, ANSWER = "/v1/approvals/{}/decide", "/v1/questions/{}/answer"


class FakeRun:
    """Attrappe nach dem Run-Protocol: Karten-Teile landen direkt im Verlauf."""

    def __init__(self, ctx, chat_id="chat1", bot_id="bot1", kind="direct", root_chat=None):
        self.id, self.ctx, self.chat_id, self.chat_kind = new_id(), ctx, chat_id, kind
        self.bot = dict(ctx.db.one("SELECT * FROM bots WHERE id=?", bot_id))
        self.message_id, self.root, self.counters = new_id(), {"chatId": root_chat or chat_id, "taskId": "task1"}, {}
        self.parts, self.steps, self.waiting = [], [], []

    def card(self, tool, tool_call_id, input, output=None):
        part = {"type": f"tool-{tool}", "toolCallId": tool_call_id, "state": "output-available" if output is not None else "input-available", "input": input}
        if output is not None:
            part["output"] = output
        self.parts = [p for p in self.parts if p["toolCallId"] != tool_call_id] + [part]
        (chatstore.update if chatstore.exists(self.ctx.db, self.chat_id, self.message_id) else
         lambda db, c, m, p: chatstore.add(db, c, m, "assistant", p))(self.ctx.db, self.chat_id, self.message_id, self.parts)

    def step(self, tool_call_id, tool, label, state):
        self.steps.append((tool, label, state))

    def set_waiting(self, waiting):
        self.waiting.append(waiting)


def test_unknown_role_cannot_inherit_foreground_tools(ctx, seed):
    from orbitd.tools import roles
    run = FakeRun(ctx)
    assert roles.role_of(run) == "foreground"
    run.role = "unrecognized-role"
    assert not Bridge.tools_for(run, listing=True)
    assert not roles.allowed(roles.role_of(run), "read_skill", {"name": "site/index"})


@pytest.fixture
async def env(ctx, seed, app, monkeypatch):
    """Brücke + Karten + Attrappen-Laufzeit auf echtem Port; ein riskantes Test-Werkzeug „danger“ zählt seine Läufe."""
    ctx.parts["interactions"], ctx.parts["bridge"] = Interactions(ctx), Bridge(ctx)
    ctx.parts["runtime"] = SimpleNamespace(woken=[], wake=lambda bot_id=None: ctx.parts["runtime"].woken.append(bot_id))
    events = []
    ctx.bus.listeners.append(events.append)
    ran = []

    async def danger(run, args):
        ran.append(args)
        return {"done": len(ran)}

    monkeypatch.setitem(TOOLS, "danger", Tool("danger", "test", {"type": "object", "properties": {"x": {"type": "integer"}}}, danger,
                                              label=lambda a: "Gefahr …", risk=lambda run, a: Risk("geld", "danger_kind", "Gefährliche Sache?", "Detail")))
    server = uvicorn.Server(uvicorn.Config(Starlette(routes=build_routes(ctx)), host="127.0.0.1", port=0, log_level="warning", lifespan="off"))
    task = asyncio.create_task(server.serve())
    while not server.started:
        await asyncio.sleep(0.01)
    base = f"http://127.0.0.1:{server.servers[0].sockets[0].getsockname()[1]}"
    http = httpx.AsyncClient(base_url=base, timeout=10)
    run = FakeRun(ctx)
    token = ctx.parts["bridge"].register(run)
    yield SimpleNamespace(ctx=ctx, base=base, http=http, run=run, token=token, events=events, ran=ran, inter=ctx.parts["interactions"],
                          bridge=ctx.parts["bridge"], auth={"Authorization": f"Bearer {token}"})
    for row in ctx.db.all("SELECT DISTINCT chat_id FROM pending_interactions"):
        ctx.parts["interactions"].abort_for_chat(row[0])  # wartende Aufrufe freigeben
    for waiter in list(ctx.parts["interactions"]._waiters.values()):
        waiter.done() or waiter.set_result("aborted")  # Aufrufe, deren Karte schon weg ist
    await asyncio.sleep(0.05)
    await http.aclose()
    server.should_exit = True
    await task


async def rpc(env, method, params=None, token=None, id=1):
    r = await env.http.post("/mcp", json={"jsonrpc": "2.0", "id": id, "method": method, "params": params or {}},
                            headers={"Authorization": f"Bearer {token or env.token}"})
    return r.json()["result"]


async def call(env, name, args=None, run_token=None):
    result = await rpc(env, "tools/call", {"name": name, "arguments": args or {}}, run_token)
    return result["content"][0]["text"], result["isError"]


async def pending(env, n=1):
    for _ in range(300):
        if len(env.inter.list()) >= n:
            return env.inter.list()
        await asyncio.sleep(0.01)
    raise AssertionError("keine Karte")


def statuses(env, type_):
    return [e["status"] for e in env.events if e["type"] == type_]


def inbox_texts(ctx):
    return [loads(r["payload"])["text"] for r in ctx.db.all("SELECT payload FROM inbox_items WHERE kind='answer' ORDER BY rowid")]


# ------------------------------------------------------------ MCP-Protokoll
async def test_official_client_initialize_list_call(env):
    http = httpx2.AsyncClient(headers=env.auth)
    async with Client(streamable_http_client(env.base + "/mcp", http_client=http)) as client:
        names = {t.name for t in (await client.list_tools()).tools}
        assert {"say", "ask_user", "react", "memory_get", "danger"} <= names
        result = await client.call_tool("say", {"text": "Ich fange an."})
        assert not result.is_error and result.content[0].text == "ok"
    assert env.run.parts[0]["type"] == "tool-say" and env.run.parts[0]["output"]["ok"] is True


async def test_protocol_basics(env):
    init = await rpc(env, "initialize", {"protocolVersion": "2025-03-26", "capabilities": {}, "clientInfo": {"name": "t", "version": "1"}})
    assert init["protocolVersion"] == "2025-03-26" and init["capabilities"] == {"tools": {}} and init["serverInfo"]["name"]
    assert await rpc(env, "ping") == {}
    note = await env.http.post("/mcp", json={"jsonrpc": "2.0", "method": "notifications/initialized"}, headers=env.auth)
    assert note.status_code == 202 and note.content == b""
    unknown = (await env.http.post("/mcp", json={"jsonrpc": "2.0", "id": 3, "method": "foo/bar"}, headers=env.auth)).json()
    assert unknown["error"]["code"] == -32601


async def test_auth_and_method(env):
    body = {"jsonrpc": "2.0", "id": 1, "method": "ping"}
    assert (await env.http.post("/mcp", json=body)).status_code == 401
    assert (await env.http.post("/mcp", json=body, headers={"Authorization": "Bearer falsch"})).status_code == 401
    env.bridge.unregister(env.token)
    assert (await env.http.post("/mcp", json=body, headers=env.auth)).status_code == 401
    assert (await env.http.get("/mcp")).status_code == 405


async def test_tools_list_filters_group_and_background(env):
    group = FakeRun(env.ctx, kind="group")
    auto = FakeRun(env.ctx, kind="automation")
    names = lambda r: {t["name"] for t in r["tools"]}
    for run, expect_in, expect_out in [(group, {"say", "memory_get"}, {"memory_save", "automation_create", "create_orbi"}),
                                       (auto, {"memory_save"}, {"say", "ask_user", "react", "automation_create"})]:
        listed = names(await rpc(env, "tools/list", token=env.bridge.register(run)))
        assert expect_in <= listed and not (expect_out & listed)


async def test_errors_and_labels(env):
    assert await call(env, "gibtsnicht") == ("This tool does not exist here.", True)
    text, err = await call(env, "say", {"text": 5})
    assert err and text.startswith("Invalid input")

    async def boom(run, args):
        raise RuntimeError("sk-abcdefghijklmnopqrstuvwxyz kaputt")

    async def fail(run, args):
        raise Fail("Das geht nicht.")

    TOOLS["boom"] = Tool("boom", "t", {"type": "object"}, boom, label=lambda a: "Boom …")
    TOOLS["fail"] = Tool("fail", "t", {"type": "object"}, fail)
    try:
        assert await call(env, "boom") == ("The tool failed.", True)
        assert env.run.steps == [("boom", "Boom …", "start"), ("boom", "Boom …", "end")]
        assert await call(env, "fail") == ("Das geht nicht.", True)
    finally:
        TOOLS.pop("boom"), TOOLS.pop("fail")


async def test_cap_tool_output_is_used_when_context_exists(env, monkeypatch):
    module = types.ModuleType("orbitd.context")
    module.cap_tool_output = lambda ctx, chat_id, tool, text: f"gekürzt:{tool}:{text[:2]}"
    monkeypatch.setitem(sys.modules, "orbitd.context", module)
    assert await call(env, "memory_get") == ("gekürzt:memory_get:{\"", False)


# ------------------------------------------------------------ Freigabe-Tor
async def test_once_blocks_until_decided_then_runs_once(env):
    task = asyncio.create_task(call(env, "danger", {"x": 1}))
    [card] = await pending(env)
    assert card["kind"] == "approval" and card["tool"] == "danger" and card["reason"] == "geld" and card["approvalKind"] == "danger_kind"
    assert card["text"] == "Gefährliche Sache?" and card["detail"] == "Detail" and card["input"] == {"x": 1} and card["runId"] == env.run.id
    assert "root" not in card and "from" not in card and "restored" not in card
    await asyncio.sleep(0.05)
    assert env.ran == [] and not task.done() and env.run.waiting == [True]
    r = await env.http.post(DECIDE.format(card["id"]), json={"decision": "once"})
    assert r.json() == {"ok": True}
    assert await task == ('{"done": 1}', False)
    assert env.run.waiting == [True, False] and env.run.steps == [("danger", "Gefahr …", "start"), ("danger", "Gefahr …", "end")]
    assert statuses(env, "approval") == ["pending", "approved"] and env.inter.list() == []
    # „Einmal“ gilt nur für diesen Aufruf, und ohne Wartenden entsteht kein Postfach-Eintrag
    assert inbox_texts(env.ctx) == []
    asyncio.create_task(call(env, "danger", {"x": 1}))
    await pending(env)


async def test_deny(env):
    task = asyncio.create_task(call(env, "danger"))
    [card] = await pending(env)
    await env.inter.decide(card["id"], "deny")
    assert await task == ("Consti declined this.", True)
    assert env.ran == [] and statuses(env, "approval") == ["pending", "denied"]


async def test_always_on_geld_creates_no_rule(env):
    # geld/nachricht/login: „Immer“ speichert keine Regel, nächster Aufruf fragt wieder
    task = asyncio.create_task(call(env, "danger"))
    [card] = await pending(env)
    await env.inter.decide(card["id"], "always")
    assert (await task)[1] is False
    assert env.ctx.db.val("SELECT count(*) FROM approval_rules") == 0
    asyncio.create_task(call(env, "danger", {"x": 2}))
    await pending(env)
    assert env.ran == [{}]


async def test_login_reasons_never_get_a_rule(env):
    TOOLS["perm"] = Tool("perm", "t", {"type": "object"}, TOOLS["danger"].handler, risk=lambda r, a: Risk("login", "perm_kind", "Konto verbinden?"))
    try:
        task = asyncio.create_task(call(env, "perm"))
        [card] = await pending(env)
        await env.inter.decide(card["id"], "always")
        await task
        assert env.ctx.db.val("SELECT count(*) FROM approval_rules") == 0
        # eine vorhandene allow-Regel zählt bei login auch nicht
        env.ctx.db.run("INSERT INTO approval_rules (id,user_id,bot_id,tool,mode,created_at) VALUES ('r','local',NULL,'perm_kind','allow',1)")
        asyncio.create_task(call(env, "perm"))
        await pending(env)
    finally:
        TOOLS.pop("perm")


async def test_deny_rule_wins_without_card(env):
    t = now_ms()
    env.ctx.db.run("INSERT INTO approval_rules (id,user_id,bot_id,tool,mode,created_at) VALUES ('a','local','bot1','danger_kind','allow',?)", t)
    env.ctx.db.run("INSERT INTO approval_rules (id,user_id,bot_id,tool,mode,created_at) VALUES ('b','local',NULL,'danger_kind','deny',?)", t)
    text, err = await call(env, "danger")
    assert err and "blocked" in text and env.ran == [] and env.events == []


async def test_old_ask_rule_is_ignored(env):
    env.ctx.db.run("INSERT INTO approval_rules (id,user_id,bot_id,tool,mode,created_at) VALUES ('a','local',NULL,'danger_kind','ask',1)")
    asyncio.create_task(call(env, "danger"))
    await pending(env)


async def test_timeout_keeps_card_and_late_approval_is_one_shot(env, monkeypatch):
    monkeypatch.setattr(contract, "APPROVAL_WAIT_S", 0.1)
    text, err = await call(env, "danger", {"x": 7})
    assert err and "stays open" in text and env.ran == [] and env.run.waiting == [True, False]
    [card] = env.inter.list()
    await env.inter.decide(card["id"], "once")
    [msg] = inbox_texts(env.ctx)
    assert "approved" in msg and "danger" in msg
    assert env.ctx.parts["runtime"].woken == ["bot1"]
    item = env.ctx.db.one("SELECT * FROM inbox_items")
    assert (item["kind"], item["bot_id"], item["chat_id"], item["status"]) == ("answer", "bot1", "chat1", "queued")
    assert await call(env, "danger", {"x": 7}) == ('{"done": 1}', False) and env.inter.list() == []  # ohne Karte, einmal
    assert (await call(env, "danger", {"x": 7}))[1] is True and len(env.inter.list()) == 1  # beim dritten Mal wieder Karte (hier erneut Zeit um)
    # andere Eingabe ist durch die Einmal-Freigabe nie gedeckt
    assert env.ran == [{"x": 7}]


async def test_late_deny_tells_the_orbi(env, monkeypatch):
    monkeypatch.setattr(contract, "APPROVAL_WAIT_S", 0.05)
    await call(env, "danger")
    await env.inter.decide(env.inter.list()[0]["id"], "deny")
    assert "declined" in inbox_texts(env.ctx)[0] and statuses(env, "approval")[-1] == "denied"
    assert (await call(env, "danger"))[1] is True and env.ran == []


async def test_abort_and_expire(env):
    task = asyncio.create_task(call(env, "danger"))
    await pending(env)
    env.inter.abort_for_run(env.run.id)
    text, err = await task
    assert err and "no longer valid" in text and env.inter.list() == [] and statuses(env, "approval") == ["pending", "aborted"]
    task = asyncio.create_task(call(env, "danger"))
    await pending(env)
    env.ctx.db.run("UPDATE pending_interactions SET expires_at=1")
    env.inter.expire()
    assert (await task)[1] is True and statuses(env, "approval")[-1] == "expired"
    asyncio.create_task(call(env, "danger"))
    await pending(env)
    env.inter.abort_for_chat("chat1")
    assert env.inter.list() == [] and statuses(env, "approval")[-1] == "aborted"


async def test_root_and_from_only_for_foreign_root_chat(env):
    env.ctx.db.run("INSERT INTO chats (id,user_id,kind,last_message_at,created_at) VALUES ('root1','local','direct',1,1)")
    other = FakeRun(env.ctx, root_chat="root1")
    asyncio.create_task(call(env, "danger", run_token=env.bridge.register(other)))
    [card] = await pending(env)
    assert card["root"] == {"chatId": "root1", "taskId": "task1"} and card["from"] == {"id": "bot1", "name": "Nova", "avatar": "nepi", "color": "#3366ff"}
    assert card["chatId"] == "chat1"


# ------------------------------------------------------------ Rückfragen
QUESTIONS = [{"question": "Welche Farbe?", "options": [{"label": "Rot", "recommended": True}, {"label": "Blau"}]}]


async def test_ask_user_puts_recommendation_first_and_labels_it_once(env):
    qs = [{"question": "Wann?", "options": [{"label": "Früh"}, {"label": "Spät (Empfehlung)", "recommended": True}, {"label": "Egal"}]}]
    await call(env, "ask_user", {"questions": qs})
    assert [o["label"] for o in env.inter.list()[0]["input"]["questions"][0]["options"]] == ["Spät (Empfehlung)", "Früh", "Egal"]


async def test_ask_user_returns_at_once_and_answer_reaches_the_orbi(env):
    text, err = await call(env, "ask_user", {"questions": QUESTIONS})
    assert not err and '"asked": true' in text and "keep working" in text.lower()
    [card] = env.inter.list()
    shown = [{**QUESTIONS[0], "options": [{"label": "Rot (Empfehlung)", "recommended": True}, {"label": "Blau"}]}]  # das Werkzeug ergänzt das Label
    assert card["kind"] == "ask" and card["tool"] == "ask_user" and card["input"] == {"questions": shown}
    assert env.run.parts[0]["state"] == "input-available" and card["toolCallId"] == env.run.parts[0]["toolCallId"]
    body = {"answers": [{"question": "Welche Farbe?", "answers": ["Rot"]}]}
    r = await env.http.post(ANSWER.format(card["id"]), json=body)
    assert r.json() == {"ok": True}
    part = chatstore.get(env.ctx.db, "chat1", env.run.message_id)["parts"][0]
    assert part["state"] == "output-available" and part["output"] == body
    assert inbox_texts(env.ctx) == ["Consti answered:\n- Welche Farbe? → Rot"] and env.ctx.parts["runtime"].woken == ["bot1"]
    assert statuses(env, "question") == ["pending", "answered"] and env.inter.list() == []
    assert env.ctx.db.val("SELECT count(*) FROM interaction_results WHERE kind='ask'") == 1


async def test_skipped_and_invalid_answers(env):
    await call(env, "ask_user", {"questions": QUESTIONS})
    [card] = env.inter.list()
    for bad in (None, [], {"answers": "x"}, {"answers": [{"question": "Fremd?", "answers": ["a"]}]}, {"answers": [{"question": "Welche Farbe?", "answers": [1]}]}):
        r = await env.http.post(ANSWER.format(card["id"]), json=bad)
        assert r.status_code == 400 and r.json() == {"error": "The answer is invalid or the question has expired."}
    assert len(env.inter.list()) == 1
    assert (await env.http.post(ANSWER.format(card["id"]), json={"skipped": True})).json() == {"ok": True}
    assert inbox_texts(env.ctx) == ["Consti skipped the question. Decide yourself."]
    assert env.run.parts[0]["output"] == {"skipped": True}
    again = await env.http.post(ANSWER.format(card["id"]), json={"skipped": True})
    assert again.status_code == 410 and again.json() == {"error": "This question is no longer open."}


async def test_cards_survive_restart_and_answer_updates_stored_part(env):
    await call(env, "ask_user", {"questions": QUESTIONS})
    asyncio.create_task(call(env, "danger"))
    await pending(env, 2)
    assert all("restored" not in c for c in env.inter.list())
    fresh = Interactions(env.ctx)  # Neustart: der Speicher ist leer, die Datenbank bleibt
    cards = fresh.list()
    assert len(cards) == 2 and all(c["restored"] is True for c in cards)
    fresh.handlers["missed:"] = None
    env.ctx.db.run("UPDATE pending_interactions SET id='missed:1' WHERE id=?", cards[0]["id"])
    assert len(fresh.list()) == 2 and sum("restored" in c for c in fresh.list()) == 1  # die Karte des Dienstes trägt es nicht
    env.ctx.db.run("UPDATE pending_interactions SET id=? WHERE id='missed:1'", cards[0]["id"])
    del fresh.handlers["missed:"]
    ask = next(c for c in cards if c["kind"] == "ask")
    await fresh.answer(ask["id"], {"answers": [{"question": "Welche Farbe?", "answers": ["Blau"]}]})
    part = chatstore.get(env.ctx.db, "chat1", env.run.message_id)["parts"][0]
    assert part["state"] == "output-available" and part["output"]["answers"][0]["answers"] == ["Blau"]
    approval = next(c for c in cards if c["kind"] == "approval")
    await fresh.decide(approval["id"], "once")  # kein Wartender mehr -> Postfach
    assert len(inbox_texts(env.ctx)) == 2 and fresh.list() == []


async def test_handler_prefix(env):
    seen = []

    async def missed(id, body):
        seen.append((id, body))

    env.inter.handlers["missed:"] = missed
    t = now_ms()
    env.ctx.db.run("INSERT INTO pending_interactions (id,chat_id,bot_id,kind,request,requested_at,expires_at) VALUES ('missed:1','chat1','bot1','ask',?,?,?)",
                   dumps({"id": "missed:1", "kind": "ask", "chatId": "chat1", "botId": "bot1", "toolCallId": "x", "tool": "x", "input": {}, "requestedAt": t, "expiresAt": t + 1000}), t, t + 1000)
    r = await env.http.post(ANSWER.format("missed:1"), json={"skipped": True})
    assert r.json() == {"ok": True} and seen == [("missed:1", {"skipped": True})] and env.inter.list() == []
    assert statuses(env, "question") == ["answered"] and inbox_texts(env.ctx) == []


# ------------------------------------------------------------ Routen
async def test_routes(env):
    asyncio.create_task(call(env, "danger"))
    await call(env, "ask_user", {"questions": QUESTIONS})
    [approval] = (await env.http.get("/v1/approvals")).json()["approvals"]
    assert approval["kind"] == "approval" and len(env.inter.list()) == 2  # Rückfragen stehen nicht in /v1/approvals
    bad = await env.http.post(DECIDE.format(approval["id"]), json={"decision": "vielleicht"})
    assert bad.status_code == 400 and bad.json() == {"error": "Invalid decision."}
    assert (await env.http.post(DECIDE.format(approval["id"]), content=b"nicht json")).status_code == 400
    ask = next(c for c in env.inter.list() if c["kind"] == "ask")
    gone = await env.http.post(DECIDE.format(ask["id"]), json={"decision": "once"})  # eine Rückfrage ist keine Freigabe
    assert gone.status_code == 410 and gone.json() == {"error": "This approval is no longer open."}
    assert (await env.http.post(DECIDE.format("nix"), json={"decision": "once"})).status_code == 410
    env.ctx.db.run("UPDATE pending_interactions SET expires_at=? WHERE id=?", now_ms() - 1, approval["id"])
    late = await env.http.post(DECIDE.format(approval["id"]), json={"decision": "once"})
    assert late.status_code == 409 and late.json() == {"error": "This approval has expired."}
    assert statuses(env, "approval")[-1] == "expired" and (await env.http.get("/v1/approvals")).json() == {"approvals": []}
    env.ctx.db.run("UPDATE pending_interactions SET expires_at=? WHERE id=?", now_ms() - 1, ask["id"])
    expired = await env.http.post(ANSWER.format(ask["id"]), json={"skipped": True})
    assert expired.status_code == 400 and expired.json()["error"].startswith("The answer is invalid")
    assert (await env.http.post(ANSWER.format("nix"), json={"skipped": True})).status_code == 410


async def test_decide_storage_failure_is_500(env, monkeypatch):
    asyncio.create_task(call(env, "danger"))
    [card] = await pending(env)
    env.ctx.db.run("DROP TABLE interaction_results")
    r = await env.http.post(DECIDE.format(card["id"]), json={"decision": "once"})
    assert r.status_code == 500 and r.json() == {"error": "The decision could not be saved."}
    assert len(env.inter.list()) == 1  # nichts halb gespeichert


# ------------------------------------------------------------ Kern-Werkzeuge
async def test_say_limit_and_react(env):
    from orbitd.runtime import contract
    for _ in range(contract.SAY_PER_RUN):
        assert (await call(env, "say", {"text": "Hallo"}))[1] is False
    assert await call(env, "say", {"text": "Noch eins"}) == ("Genug Zwischenstände – fass am Ende zusammen.", True)
    assert (await call(env, "say", {"text": "x" * 301}))[1] is True and (await call(env, "say", {"text": "  "}))[1] is True
    chatstore.add(env.ctx.db, "chat1", "u1", "user", [{"type": "text", "text": "Hi"}])
    assert await call(env, "react", {"emoji": "👍"}) == ("ok", False)
    row = env.ctx.db.one("SELECT * FROM message_reactions")
    assert (row["message_id"], row["actor"], row["emoji"]) == ("u1", "bot1", "👍")
    assert {"type": "reaction", "chatId": "chat1", "messageId": "u1", "actor": "bot1", "emoji": "👍"} in env.events
    assert (await call(env, "react", {"emoji": "🤔", "message_id": "nix"}))[1] is True
    assert (await call(env, "react", {"emoji": "💩"}))[1] is True  # nicht erlaubt
    assert env.run.steps == []  # kein Schritt für say, react


async def test_ask_user_validation(env):
    one_option = [{"question": "?", "options": [{"label": "a"}]}]
    assert (await call(env, "ask_user", {"questions": one_option}))[1] is True
    assert (await call(env, "ask_user", {"questions": QUESTIONS * 5}))[1] is True
    assert (await call(env, "ask_user", {"questions": []}))[1] is True and env.inter.list() == []


async def test_memory_tools(env):
    save = {"name": "farbe", "type": "user", "description": "Lieblingsfarbe", "body": "Mag Blau.", "from": "consti", "source": "Ich mag Blau"}
    text, err = await call(env, "memory_save", save)
    assert not err and loads(text)["version"] == 1
    assert env.run.steps[-2:] == [("memory_save", "Merkt sich „farbe“ …", "start"), ("memory_save", "Merkt sich „farbe“ …", "end")]
    assert loads((await call(env, "memory_get", {"name": "farbe"}))[0])["body"] == "Mag Blau."
    assert loads((await call(env, "memory_get"))[0])["entries"][0]["name"] == "farbe"
    assert (await call(env, "memory_get", {"name": "nix"})) == ("Entry not found.", True)
    assert (await call(env, "memory_save", save))[1] is True  # existiert: ifVersion fehlt
    assert (await call(env, "memory_forget", {"name": "farbe"}))[1] is False
    assert (await call(env, "memory_get", {"name": "farbe"}))[1] is True
    group = FakeRun(env.ctx, kind="group")
    assert await call(env, "memory_save", save, env.bridge.register(group)) == ("This tool does not exist here.", True)
    assert (await call(env, "memory_get", {}, env.bridge.register(group)))[1] is False


async def test_automation_create_runs_without_approval(env):
    args = {"name": "Morgen", "prompt": "Sag Guten Morgen", "schedule": {"kind": "daily", "at": "08:00"}}
    text, err = await call(env, "automation_create", args)
    assert not err and loads(text)["ok"] is True and env.inter.list() == []
    row = env.ctx.db.one("SELECT * FROM automations")
    assert (row["bot_id"], row["name"], row["chat_id"], row["timezone"]) == ("bot1", "Morgen", "chat1", "Europe/Berlin")
    assert env.run.parts[-1]["type"] == "tool-automation_create" and env.run.parts[-1]["state"] == "output-available"
    bad = await call(env, "automation_create", {**args, "schedule": {"kind": "stündlich"}})
    assert bad[1] is True and env.inter.list() == []


async def test_create_orbi_runs_without_approval_and_announces(env):
    text, err = await call(env, "create_orbi", {"name": "Lena", "job": "Recherche", "instructions": "Kurz antworten"})
    assert not err and env.inter.list() == []
    bot = env.ctx.db.one("SELECT * FROM bots WHERE name='Lena'")
    assert (bot["is_main"], bot["job"], bot["instructions"], bot["avatar"]) == (0, "Recherche", "Kurz antworten", "citrus")
    event = next(e for e in env.events if e["type"] == "orbis-created")
    chat = env.ctx.db.val("SELECT chat_id FROM chat_members WHERE bot_id=?", bot["id"])
    assert event["bots"] == [{"botId": bot["id"], "chatId": chat, "name": "Lena"}]
    assert env.run.parts[-1]["type"] == "tool-create_orbi"


async def test_bild_ergebnis_wird_bildblock_und_bei_4mb_gekappt(env, monkeypatch):
    async def pic(run, args):
        return {"ok": True, "n": args["n"], "_images": [{"data": "A" * args["n"], "mimeType": "image/png"}]}

    monkeypatch.setitem(TOOLS, "pic", Tool("pic", "test", {"type": "object", "properties": {"n": {"type": "integer"}}}, pic))
    small = await rpc(env, "tools/call", {"name": "pic", "arguments": {"n": 8}})
    assert small["content"][1] == {"type": "image", "data": "A" * 8, "mimeType": "image/png"} and "_images" not in small["content"][0]["text"]
    big = await rpc(env, "tools/call", {"name": "pic", "arguments": {"n": 4 * 1024 * 1024 + 4}})
    assert len(big["content"]) == 1 and "too large" in big["content"][0]["text"] and not big["isError"]


async def test_delivery_validation_and_terminal_turn(env):
    for args in ({}, {"images": [{"url": "http://example.test/image.png"}]},
                 {"images": [{"url": "https://user@example.test/image.png"}]},
                 {"type": "secret-request"}, {"channel": "elsewhere", "content": "hello"}):
        result, failed = await call(env, "SendToUser", args)
        assert failed and result
    assert env.ctx.db.val("SELECT count(*) FROM deliveries") == 0
    env.run.end_turn = True
    assert await call(env, "danger") == ("This turn has already ended.", True)
    assert env.ran == [] and env.inter.list() == []
