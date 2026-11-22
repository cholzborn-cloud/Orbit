"""Word aliases and SendFeedback → Brain inbox."""
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from orbitd import chatstore
from orbitd.boot import load_tools
from orbitd.runtime.contract import TOOLS
from orbitd.tools import word


@pytest.fixture(autouse=True)
def _tools():
    load_tools()


def test_word_tools_are_registered():
    for name in ("ReactToMessage", "WebSearch", "WebFetch", "RecallMemory", "UpdateMemory",
                 "CreateAgent", "SendFeedback", "Task", "TodoWrite", "CheckSubagent", "ListSections", "ListAgents",
                 "SendToAgent", "UpdateAgent", "UpdateRoutine", "UpdateSkill", "ListMachines", "CloudAgent",
                 "GetMcpServerStatus", "RestartMcpServers", "AddMcpServer", "UninstallMcpServer", "SearchPlugins",
                 "GetDynamicTools", "CallDynamicTool", "GetMcpTools", "CallMcpTool",
                 "Shell", "Read", "AwaitShell", "Screenshot", "UpdateProfile", "UpdateAvatar",
                 "GetPlugin", "DisconnectChannel", "InstallPlugin", "UninstallPlugin",
                 "request_box_help", "CopyToBox", "CopyFromBox", "SetMcpInstructions", "AuthenticateMcpServer"):
        assert name in TOOLS
    assert "GenerateImage" not in TOOLS


@pytest.mark.anyio
async def test_cloud_agent_records_dc5_blocker(ctx, seed):
    run = SimpleNamespace(ctx=ctx, chat_id="chat1", bot={"id": "bot1", "name": "Nova"}, chat_kind="direct",
                          is_child=False, automation_id=None, counters={})
    with pytest.raises(Exception) as err:
        await word.cloud_agent(run, {"action": "list"})
    assert "D-C5" in str(err.value)


@pytest.mark.anyio
async def test_list_sections_and_machines(ctx, seed):
    run = SimpleNamespace(ctx=ctx, chat_id="chat1", bot={"id": "bot1", "name": "Nova", "is_main": 1},
                          chat_kind="direct", is_child=False, automation_id=None)
    sections = await word.list_sections(run, {})
    assert sections["sections"][0]["id"] == "default"
    machines = await word.list_machines(run, {})
    assert machines["machines"][0]["id"] == "mac-local"


@pytest.mark.anyio
async def test_web_fetch_reads_public_page(ctx, seed):
    run = SimpleNamespace(ctx=ctx, chat_id="chat1", bot={"id": "bot1", "name": "Nova"}, chat_kind="direct",
                          is_child=False, automation_id=None, counters={})
    response = SimpleNamespace(status_code=200, text="hello from the page")

    class _Client:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url, headers=None):
            assert url == "https://example.com/x"
            return response

    with patch("orbitd.tools.word.httpx.AsyncClient", _Client):
        out = await word.web_fetch(run, {"url": "https://example.com/x"})
    assert "hello from the page" in out
    assert run.counters.get("untrusted") is True


@pytest.mark.anyio
async def test_get_dynamic_tools_lists_registered_connectors(ctx, seed):
    run = SimpleNamespace(ctx=ctx, chat_id="chat1", bot={"id": "bot1"}, chat_kind="direct",
                          is_child=False, automation_id=None)
    out = await word.get_dynamic_tools(run, {})
    assert "connector" in out["namespaces"]
    assert any(t["toolName"].startswith("connector_") for t in out["tools"])


@pytest.mark.anyio
async def test_await_shell_waits_briefly(ctx, seed):
    run = SimpleNamespace(ctx=ctx, chat_id="chat1", bot={"id": "bot1"}, chat_kind="direct",
                          is_child=False, automation_id=None)
    out = await word.await_shell(run, {"block_until_ms": 10})
    assert out["ok"] is True and out["waited_ms"] >= 0


@pytest.mark.anyio
async def test_update_profile_sets_color(ctx, seed):
    events = []
    run = SimpleNamespace(
        ctx=SimpleNamespace(db=ctx.db, bus=SimpleNamespace(publish=events.append), cfg=ctx.cfg),
        chat_id="chat1", bot={"id": "bot1", "name": "Nova"}, chat_kind="direct",
        is_child=False, automation_id=None)
    out = await word.update_profile(run, {"avatar_color": "blue"})
    assert out["ok"] is True and out["color"] == "#2563EB"
    assert ctx.db.val("SELECT color FROM bots WHERE id='bot1'") == "#2563EB"


@pytest.mark.anyio
async def test_disconnect_channel_waits_for_dc2(ctx, seed):
    run = SimpleNamespace(ctx=ctx, chat_id="chat1", bot={"id": "bot1"}, chat_kind="direct",
                          is_child=False, automation_id=None)
    with pytest.raises(Exception) as err:
        await word.disconnect_channel(run, {"platform": "slack"})
    assert "D-C2" in str(err.value)


@pytest.mark.anyio
async def test_copy_to_box_writes_sandbox_file(ctx, seed, tmp_path):
    src = tmp_path / "note.txt"
    src.write_text("box-payload", encoding="utf-8")
    written = {}

    class _Sandbox:
        async def write_file(self, sandbox_id, path, data):
            written["sandbox_id"] = sandbox_id
            written["path"] = path
            written["data"] = data

    run = SimpleNamespace(
        ctx=SimpleNamespace(parts={"sandbox": _Sandbox()}, db=ctx.db, cfg=ctx.cfg),
        chat_id="chat1", bot={"id": "bot1", "sandbox_id": "fake-1"}, chat_kind="direct",
        is_child=False, automation_id=None)
    with patch("orbitd.tools.daytona.get", return_value=_Sandbox()):
        out = await word.copy_to_box(run, {
            "computer_path": str(src), "box_path": "/home/daytona/note.txt", "machineId": "mac-local"})
    assert out["ok"] is True and written["data"] == b"box-payload"


@pytest.mark.anyio
async def test_set_mcp_instructions_persists(ctx, seed):
    ctx.db.run(
        "INSERT INTO mcp_servers (name,transport,url,command,args,env_keys,enabled,created_at) VALUES (?,?,?,?,?,?,?,?)",
        "demo", "http", "https://example.com/mcp", None, None, None, 1, 1)
    run = SimpleNamespace(ctx=ctx, chat_id="chat1", bot={"id": "bot1"}, chat_kind="direct",
                          is_child=False, automation_id=None)
    out = await word.set_mcp_instructions(run, {"server_id": "demo", "instructions": "Prefer read-only tools."})
    assert out["ok"] is True
    raw = ctx.db.val("SELECT value FROM app_kv WHERE key=?", "mcp-instructions:demo")
    assert "Prefer read-only tools." in raw
    cleared = await word.set_mcp_instructions(run, {"server_id": "demo", "instructions": ""})
    assert cleared["cleared"] is True
    assert ctx.db.val("SELECT value FROM app_kv WHERE key=?", "mcp-instructions:demo") is None


@pytest.mark.anyio
async def test_send_feedback_writes_brain_inbox(ctx, seed, tmp_path, monkeypatch):
    (tmp_path / "Start.md").write_text("# Test vault\n", encoding="utf-8")
    monkeypatch.setenv("ORBIT_BRAIN_PATH", str(tmp_path))
    monkeypatch.delenv("ORBIT_BRAIN", raising=False)
    run = SimpleNamespace(ctx=ctx, chat_id="chat1", bot={"id": "bot1", "name": "Nova"}, chat_kind="direct",
                          is_child=False, automation_id=None)
    out = await word.send_feedback(run, {"message": "The sidebar feels crowded."})
    path = tmp_path / Path(out["path"])
    assert path.is_file()
    text = path.read_text()
    assert "The sidebar feels crowded." in text and "feedback" in text


@pytest.mark.anyio
async def test_react_to_message_alias(ctx, seed):
    chatstore.add(ctx.db, "chat1", "m-user", "user", [{"type": "text", "text": "Hi"}])
    cards = []
    run = SimpleNamespace(
        ctx=ctx, chat_id="chat1", bot=dict(ctx.db.one("SELECT * FROM bots WHERE id='bot1'")),
        chat_kind="direct", is_child=False, automation_id=None,
        card=lambda *a, **k: cards.append(a),
    )
    assert await word.react_to_message(run, {"emoji": "👍", "message_address": "m-user"}) == "ok"
    assert ctx.db.val("SELECT emoji FROM message_reactions WHERE message_id='m-user'") == "👍"
