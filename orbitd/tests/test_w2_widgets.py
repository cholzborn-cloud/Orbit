"""Choice cards from SendToUser: commit once, answer once, restore after reload / move-on."""
from types import SimpleNamespace

import pytest

from orbitd import chatstore
from orbitd.runtime import ledger
from orbitd.runtime.contract import Delivery
from orbitd.runtime.interactions import Interactions
from orbitd.tools.work import normalize_widget, send_to_user


def test_normalize_widget_assigns_stable_ids():
    w = normalize_widget({"prompt": "Pick", "options": [{"label": "Yes", "style": "primary"}, "No", {"label": ""}]})
    assert w == {"prompt": "Pick", "options": [{"id": "o0", "label": "Yes", "style": "primary"}, {"id": "o1", "label": "No"}]}
    assert normalize_widget({"options": []}) is None


class _PublishRun:
    def __init__(self, ctx, chat_id="chat1", bot_id="bot1"):
        self.id = "run1"
        self.attempt = 1
        self.sent = 0
        self.ctx = ctx
        self.chat_id = chat_id
        self.bot = dict(ctx.db.one("SELECT * FROM bots WHERE id=?", bot_id))
        self.message_id = "msg-widget"
        self.parts, self.cards = [], {}
        self.end_turn = False
        self.root_run_id = None
        self.request_id = None
        self.is_child = False
        self.text_n = 0
        self.db = ctx.db

    def publish(self, kind, parts, *, key, end_turn=False, card_input=None, **_):
        row, _ = ledger.commit_delivery(self.db, Delivery(
            client_key=key, chat_id=self.chat_id, kind=kind, parts=parts, run_id=self.id, message_id=self.message_id,
            end_turn=end_turn))
        if row["status"] != "committed":
            return row
        if kind == "widget":
            part = {"type": "tool-SendToUser", "toolCallId": row["id"], "state": "input-available", "input": dict(card_input or {})}
            self.parts.append(part)
            self.cards[row["id"]] = part
            chatstore.add(self.db, self.chat_id, self.message_id, "assistant", list(self.parts), {"botId": self.bot["id"]})
            self.ctx.parts["interactions"].open_widget(self, row["id"], part["input"])
        ledger.mark_emitted(self.db, row["id"])
        self.sent += 1
        self.end_turn = self.end_turn or end_turn
        return row

    def card(self, tool, tool_call_id, input, output=None):
        part = {"type": f"tool-{tool}", "toolCallId": tool_call_id, "state": "output-available" if output is not None else "input-available", "input": input}
        if output is not None:
            part["output"] = output
        self.parts = [p for p in self.parts if p.get("toolCallId") != tool_call_id] + [part]
        chatstore.update(self.db, self.chat_id, self.message_id, self.parts)


@pytest.mark.anyio
async def test_choice_card_answer_survives_reload(ctx, seed):
    ctx.parts["interactions"] = Interactions(ctx)
    run = _PublishRun(ctx)
    result = await send_to_user(run, {"widget": {"prompt": "Which plan?", "options": [
        {"id": "keep", "label": "Keep it", "style": "primary"},
        {"id": "drop", "label": "Delete it", "style": "danger"}]}, "end_turn": True})
    delivery_id = result["deliveryId"]
    part = next(p for p in chatstore.get(ctx.db, "chat1", "msg-widget")["parts"] if p["type"] == "tool-SendToUser")
    assert part["toolCallId"] == delivery_id and part["state"] == "input-available"
    assert ctx.db.val("SELECT kind FROM pending_interactions WHERE id=?", delivery_id) == "widget"

    await ctx.parts["interactions"].answer_widget(delivery_id, {"selected": ["drop"]})
    stored = chatstore.get(ctx.db, "chat1", "msg-widget")
    out = next(p["output"] for p in stored["parts"] if p["toolCallId"] == delivery_id)
    assert out == {"selected": ["drop"]}
    assert ctx.db.val("SELECT 1 FROM pending_interactions WHERE id=?", delivery_id) is None

    # second answer is refused; the first answer stays on the message after a "reload"
    with pytest.raises(Exception):
        await ctx.parts["interactions"].answer_widget(delivery_id, {"selected": ["keep"]})
    again = chatstore.get(ctx.db, "chat1", "msg-widget")
    assert next(p["output"] for p in again["parts"] if p["toolCallId"] == delivery_id) == {"selected": ["drop"]}


@pytest.mark.anyio
async def test_new_user_message_dismisses_unanswered_widget(ctx, seed):
    ctx.parts["interactions"] = Interactions(ctx)
    run = _PublishRun(ctx)
    result = await send_to_user(run, {"widget": {"options": [{"id": "a", "label": "A"}, {"id": "b", "label": "B"}]}})
    delivery_id = result["deliveryId"]
    moved = ctx.parts["interactions"].move_on("chat1")
    assert moved == [("chat1", "msg-widget")]
    part = next(p for p in chatstore.get(ctx.db, "chat1", "msg-widget")["parts"] if p["toolCallId"] == delivery_id)
    assert part["output"] == {"movedOn": True}
    assert ctx.db.val("SELECT 1 FROM pending_interactions WHERE id=?", delivery_id) is None


def test_replay_widget_shows_committed_delivery_once(ctx, seed):
    ctx.parts["interactions"] = Interactions(ctx)
    events = []
    ctx.bus.listeners.append(events.append)
    row, _ = ledger.commit_delivery(ctx.db, Delivery(
        client_key="k1", chat_id="chat1", kind="widget",
        parts=[{"type": "widget", "widget": {"options": [{"id": "a", "label": "A"}]}}],
        run_id=None, message_id="msg-replay"))
    assert ctx.parts["interactions"].replay_widget(row) is True
    msg = chatstore.get(ctx.db, "chat1", "msg-replay")
    assert any(p.get("type") == "tool-SendToUser" and p["input"]["widget"]["options"][0]["label"] == "A" for p in msg["parts"])
    assert ctx.db.val("SELECT status FROM deliveries WHERE id=?", row["id"]) == "emitted"
    assert ctx.parts["interactions"].replay_widget({**row, "status": "committed", "parts": row["parts"]}) is False


@pytest.mark.anyio
async def test_send_to_user_attachment_shares_sandbox_file(ctx, seed, monkeypatch):
    from orbitd.tools import work
    cards = []
    run = SimpleNamespace(
        ctx=ctx, chat_id="chat1", bot={"id": "bot1", "sandbox_id": "fake-1"}, chat_kind="direct",
        is_child=False, automation_id=None, id="run1", attempt=1, sent=0, message_id="m1",
        card=lambda *a, **k: cards.append(a), counters={},
    )
    async def fake_share(run, a):
        return f"Shared {a['path']}"
    monkeypatch.setattr("orbitd.tools.daytona.share_file", fake_share)
    out = await work.send_to_user(run, {"type": "attachment", "content": "/home/daytona/out.pdf"})
    assert out["ok"] is True and "out.pdf" in out["shared"]


@pytest.mark.anyio
async def test_secret_request_stores_without_echo(ctx, seed, monkeypatch):
    from orbitd import keychain
    from orbitd.tools import work

    class Run(_PublishRun):
        def publish(self, kind, parts, *, key, end_turn=False, card_input=None, **_):
            row, _ = ledger.commit_delivery(self.db, Delivery(
                client_key=key, chat_id=self.chat_id, kind=kind, parts=parts, run_id=self.id, message_id=self.message_id,
                end_turn=end_turn))
            if row["status"] != "committed":
                return row
            part = {"type": "tool-SendToUser", "toolCallId": row["id"], "state": "input-available", "input": dict(card_input or {})}
            self.parts.append(part)
            self.cards[row["id"]] = part
            chatstore.add(self.db, self.chat_id, self.message_id, "assistant", list(self.parts), {"botId": self.bot["id"]})
            if kind == "secret-request":
                self.ctx.parts["interactions"].open_secret(self, row["id"], part["input"])
            ledger.mark_emitted(self.db, row["id"])
            self.sent += 1
            self.end_turn = self.end_turn or end_turn
            return row

    monkeypatch.setenv("ORBIT_KEYCHAIN_FAKE", "{}")
    keychain.forget()
    ctx.parts["interactions"] = Interactions(ctx)
    run = Run(ctx)
    run.chat_kind = "direct"
    result = await work.send_to_user(run, {
        "type": "secret-request",
        "secret": {"name": "slack-token", "label": "Slack token", "description": "Paste the bot token"},
        "end_turn": True,
    })
    delivery_id = result["deliveryId"]
    assert ctx.db.val("SELECT kind FROM pending_interactions WHERE id=?", delivery_id) == "secret"
    await ctx.parts["interactions"].answer_secret(delivery_id, {"value": "xoxb-secret-value"})
    stored = chatstore.get(ctx.db, "chat1", "msg-widget")
    out = next(p["output"] for p in stored["parts"] if p["toolCallId"] == delivery_id)
    assert out == {"stored": True, "name": "slack-token"}
    assert "xoxb" not in str(stored)
    assert await keychain.get_item(keychain.SERVICE, "secret.slack-token") == "xoxb-secret-value"
    with pytest.raises(Exception):
        await ctx.parts["interactions"].answer_secret(delivery_id, {"value": "again"})


@pytest.mark.anyio
async def test_secret_request_refuses_group_chat(ctx, seed):
    from orbitd.tools import work
    run = SimpleNamespace(
        ctx=ctx, chat_id="chat1", bot={"id": "bot1"}, chat_kind="group",
        is_child=False, automation_id=None, id="run1", attempt=1, sent=0, message_id="m1")
    with pytest.raises(Exception) as err:
        await work.send_to_user(run, {"type": "secret-request", "secret": {"name": "x", "label": "X"}})
    assert "own chat" in str(err.value).lower() or "Secure input" in str(err.value)


@pytest.mark.anyio
async def test_cursor_reference_streams_and_survives_reload(ctx, seed):
    from orbitd.runtime.runner import Runner
    from orbitd.web import Fail

    run = Runner(SimpleNamespace(ctx=ctx), "run-cursor", {"id": "bot1"}, {"id": "chat1", "kind": "direct"},
                 [{"payload": {}}], None, None, {}, None, None, None)
    chunks = []
    run.stream = SimpleNamespace(emit=chunks.append)
    for invalid in (None, "https://cursor.com/agents/bc-demo", "bc-a/b", "bc-a?token", "bc-a\nb"):
        with pytest.raises(Fail):
            await send_to_user(run, {"type": "cursor-agent", "bcId": invalid})
    with pytest.raises(Fail):
        await send_to_user(run, {"type": "cursor-agent", "bcId": "bc-demo", "channel": "elsewhere"})
    assert not chunks and run.sent == 0

    result = await send_to_user(run, {"type": "cursor-agent", "bcId": "bc-orbit-demo", "end_turn": True})
    link = "[Cursor cloud agent · bc-orbit-demo](https://cursor.com/agents/bc-orbit-demo)"
    assert [c["delta"] for c in chunks if c["type"] == "text-delta"] == [link]
    assert chatstore.text_of(chatstore.get(ctx.db, "chat1", run.message_id)["parts"]) == link
    assert ctx.db.val("SELECT kind FROM deliveries WHERE id=?", result["deliveryId"]) == "cloud-job"
    assert run.end_turn
