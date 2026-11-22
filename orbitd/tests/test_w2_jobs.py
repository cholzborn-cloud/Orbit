"""Background packet: TodoWrite, Task control tools, worker prompts."""
from types import SimpleNamespace

import pytest

from orbitd import context
from orbitd.db import dumps, new_id, now_ms
from orbitd.runtime.engine import Runtime
from orbitd.runtime.contract import TOOLS
from orbitd.tools import jobs
from orbitd.web import Fail


def test_worker_prompts_are_self_contained():
    brief = context.worker_brief({"description": "Scan", "prompt": "List files in /tmp", "role": "executor",
                                  "attachments": ["a.png"]})
    assert "Scan" in brief and "List files" in brief and "a.png" in brief
    system = context.worker_system_prompt(None, {"name": "Nova"}, "executor")
    assert "Nova" in system and "cannot message Consti" in system
    assert "finished" in context.worker_wake("c1", "Scan", "done", "all clear").lower()
    assert "failed" in context.worker_wake("c1", "", "failed", "", "boom").lower()


class _Parent:
    def __init__(self, ctx, chat_id="chat1", bot_id="bot1"):
        self.ctx = ctx
        self.chat_id = chat_id
        self.bot = dict(ctx.db.one("SELECT * FROM bots WHERE id=?", bot_id))
        self.id = new_id()
        self.request_id = None
        self.root_run_id = self.id
        self.is_child = False
        t = now_ms()
        ctx.db.run(
            "INSERT INTO work_runs (id,kind,chat_id,bot_id,status,payload,steps,started_at,updated_at,root_run_id,owner_bot_id,origin_chat_id,role,lane,principal_id) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            self.id, "turn", chat_id, bot_id, "running", dumps({"attempt": 1}), 0, t, t, self.id, bot_id, chat_id,
            "foreground", "interactive", "local")


@pytest.mark.anyio
async def test_todo_write_merge_replace_and_completion_stamp(ctx, seed):
    run = _Parent(ctx)
    first = await jobs.todo_write(run, {"merge": False, "todos": [
        {"id": "a", "content": "One", "status": "pending"},
        {"id": "b", "content": "Two", "status": "in_progress"},
    ]})
    assert [t["id"] for t in first["todos"]] == ["a", "b"]
    merged = await jobs.todo_write(run, {"merge": True, "todos": [
        {"id": "b", "content": "Two done", "status": "completed"},
        {"id": "c", "content": "Three", "status": "pending"},
    ]})
    by_id = {t["id"]: t for t in merged["todos"]}
    assert by_id["a"]["status"] == "pending" and by_id["b"]["status"] == "completed" and by_id["b"]["delivered"] is True
    assert by_id["c"]["content"] == "Three"
    replaced = await jobs.todo_write(run, {"merge": False, "todos": [
        {"id": "x", "content": "Only", "status": "pending"},
        {"id": "y", "content": "Pair", "status": "pending"},
    ]})
    assert [t["id"] for t in replaced["todos"]] == ["x", "y"]
    with pytest.raises(Fail):
        await jobs.todo_write(run, {"merge": True, "todos": [{"id": "z", "content": "alone", "status": "pending"}]})


@pytest.mark.anyio
async def test_task_check_message_and_stop(ctx, seed):
    rt = Runtime(ctx)
    ctx.parts["runtime"] = rt
    parent = _Parent(ctx)
    child_id = await rt.spawn_child(parent, description="Hang", prompt="[[hang]]", role="executor", background=True)
    listed = await jobs.check_subagent(parent, {})
    assert any(s["id"] == child_id for s in listed["subagents"])
    one = await jobs.check_subagent(parent, {"subagent_id": child_id})
    assert one["subagent"]["id"] == child_id and one["subagent"]["status"] in ("queued", "running", "waiting")
    msg = await jobs.message_subagent(parent, {"subagent_id": child_id, "message": "Prefer the short path"})
    assert msg["status"] == "queued"
    assert rt.take_control(child_id) == ["Prefer the short path"]
    stopped = await jobs.stop_subagent(parent, {"subagent_id": child_id})
    assert stopped["status"] == "stopped"
    again = await jobs.stop_subagent(parent, {"subagent_id": child_id})
    assert again["status"] == "already-finished"
    assert await jobs.stop_subagent(parent, {"all": True}) == {"ok": True, "results": []}


@pytest.mark.anyio
async def test_child_cannot_spawn_task(ctx, seed):
    run = _Parent(ctx)
    run.is_child = True
    assert TOOLS["Task"].available(run) is False
    assert TOOLS["CheckSubagent"].available(run) is False
    assert TOOLS["TodoWrite"].available is None  # children may keep a durable list
