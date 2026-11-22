"""Fixes aus dem Review: Freigabe-Tor und Programm-Anbindung."""
import asyncio
import os
import stat
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

from orbitd.cli import claude, codex
from orbitd.cli.acp import AcpAdapter
from orbitd.cli.base import ProcessTree, Turn
from orbitd.runtime.contract import TOOLS, Risk
from orbitd.runtime.interactions import Interactions
from orbitd.tools import skills, user_mcp
from orbitd.tools.mac.risk import risk_of
from orbitd.web import Fail

pytestmark = pytest.mark.anyio
OPTS = [{"optionId": "a", "kind": "allow_once"}, {"optionId": "aa", "kind": "allow_always"}, {"optionId": "r", "kind": "reject_once"}]
SECRET = "sk-" + "A1b2C3d4E5f6G7h8I9j0"


def turn(tmp_path, **k):
    return Turn(prompt="p", system="s", model="m", effort=None, cwd=tmp_path, session=k.get("session"), mcp_url="http://127.0.0.1:1/mcp", run_token="tok-geheim-123")


# ---- 1 ACP
@pytest.mark.parametrize("call,option", [
    ({"title": "orbit: read_skill", "kind": "other"}, "a"),
    ({"title": "mcp__orbit__read_skill"}, "a"),
    ({"title": "Run mcp_orbit_read_skill", "kind": "other", "name": "mcp_orbit_read_skill"}, "a"),  # so fragt Antigravity (live 13.11.)
    ({"title": "Run mcp_orbit_say", "kind": "execute"}, "r"),
    ({"title": "orbit-say: say", "kind": "other"}, "a"),  # so fragt Cursor (live 13.11.)
    ({"title": "orbit-say: mac_shell", "kind": "other"}, "r"),
    ({"title": "other-say: say", "kind": "other"}, "r"),
    ({"title": "Run mcp_evil_say", "kind": "other"}, "r"),
    ({"title": "Read /Users/x/orbit/notes.md", "kind": "read", "rawInput": {"path": "/Users/x/orbit/notes.md"}}, "r"),
    ({"title": "orbit: rm -rf", "kind": "execute", "rawInput": {"command": "orbit"}}, "r"),
    ({"title": "orbit: read_skill", "_meta": {"serverName": "evil"}}, "r"),
    ({"title": "orbit: unbekannt_xyz"}, "r"),
    ({}, "r"),
])
def test_acp_permit_only_exact_orbit_tool_once(call, option):
    assert AcpAdapter.permit({"toolCall": call, "options": OPTS}) == {"outcome": "selected", "optionId": option}


def test_acp_permit_without_matching_option_cancels():
    assert AcpAdapter.permit({"toolCall": {"title": "orbit: read_skill"}, "options": [OPTS[1]]}) == {"outcome": "cancelled"}


# ---- 2/3 Karten
def _run(ctx, from_orbi=False):
    run = SimpleNamespace(id="r1", ctx=ctx, chat_id="chat1", message_id="m1", root=None, counters={}, from_orbi=from_orbi,
                          bot=dict(ctx.db.one("SELECT * FROM bots WHERE id='bot1'")))
    run.set_waiting, run.card = (lambda w: None), (lambda *a, **k: None)
    return run


def _allow(ctx, kind):
    ctx.db.run("INSERT INTO approval_rules (id,user_id,bot_id,tool,mode,created_at) VALUES (?,'local',NULL,?,'allow',1)", "r" + kind, kind)


@pytest.mark.parametrize("reason,carded", [
    ("geld", True), ("nachricht", True), ("login", True),
    ("loeschen", False), ("veroeffentlichen", True), ("system", False), ("geheimnis", False), ("dauerhaft", False),
])
async def test_allow_rule_ignored_for_money_message_login(ctx, seed, reason, carded):
    inter = ctx.parts["interactions"] = Interactions(ctx)
    _allow(ctx, "k")
    task = asyncio.create_task(inter.gate(_run(ctx), "t", {}, Risk(reason, "k", "?")))
    await asyncio.sleep(0.1)
    assert bool(inter.list()) is carded
    if carded:
        task.cancel()
    else:
        await task


async def test_always_on_geld_is_only_once(ctx, seed):
    inter = Interactions(ctx)
    task = asyncio.create_task(inter.gate(_run(ctx), "t", {}, Risk("geld", "k", "?")))
    await asyncio.sleep(0.1)
    await inter.decide(inter.list()[0]["id"], "always")
    await task
    assert ctx.db.val("SELECT count(*) FROM approval_rules") == 0


async def test_orbi_message_run_ignores_allow_but_deny_holds(ctx, seed):
    inter = Interactions(ctx)
    _allow(ctx, "k")
    task = asyncio.create_task(inter.gate(_run(ctx, from_orbi=True), "t", {}, Risk("geld", "k", "?")))
    await asyncio.sleep(0.1)
    assert len(inter.list()) == 1
    task.cancel()
    ctx.db.run("UPDATE approval_rules SET mode='deny'")
    with pytest.raises(Fail):
        await inter.gate(_run(ctx, from_orbi=True), "t", {}, Risk("system", "k", "?"))


async def test_allow_rule_ignored_after_foreign_content(ctx, seed):
    """Hat der Lauf Fremddaten gelesen, gilt „Immer erlauben“ nicht für geld/nachricht/login."""
    inter = Interactions(ctx)
    _allow(ctx, "k")
    await inter.gate(_run(ctx), "t", {}, Risk("system", "k", "?"))  # system fragt nie
    assert inter.list() == []
    run = _run(ctx)
    run.counters["untrusted"] = True
    await inter.gate(run, "t", {}, Risk("system", "k", "?"))  # system auch nach Fremddaten ohne Karte
    assert inter.list() == []
    task = asyncio.create_task(inter.gate(run, "t", {}, Risk("geld", "k", "?")))
    await asyncio.sleep(0.1)
    assert len(inter.list()) == 1  # Allow-Regel greift nach Fremddaten nicht
    task.cancel()


async def test_save_skill_blocked_in_orbi_message_run():
    run = SimpleNamespace(counters={}, from_orbi=True)
    with pytest.raises(Fail) as e:
        await skills.save_skill(run, {"name": "abc", "description": "d", "body": "x" * 50})
    assert e.value.error == skills.SOURCE_ERROR


# ---- 4 Mac-Risiko
@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    return tmp_path


def ask(tool, **a):
    return risk_of(tool, SimpleNamespace(bot={"name": "Nova"}), a)


@pytest.mark.parametrize("a", [
    {"action": "read", "path": "~/.ssh/id_ed25519"}, {"action": "read", "path": "~/Projekt/.env.local"},
    {"action": "read", "path": "~/x/../.ssh/config"}, {"action": "read", "path": "~/Library/Application Support/Orbit/service.token"},
    {"action": "read", "path": "~/Library/Keychains/login.keychain-db"}, {"action": "read", "path": "~/a/secrets.env"},
    {"action": "write", "path": "~/.zshrc", "content": "x"}, {"action": "append", "path": "~/.zprofile", "content": "x"},
    {"action": "write", "path": "~/Library/LaunchAgents/a.plist", "content": "x"}, {"action": "append", "path": "~/.ssh/authorized_keys", "content": "k"},
    {"action": "move", "path": "~/a.txt", "to": "~/.bashrc"},
])
def test_files_risk_no_card(home, a):
    r = ask("mac_files", **a)
    assert r is None or r.reason not in ("geld", "nachricht", "login")


def test_files_risk_follows_symlink_and_spares_normal(home):
    (home / ".ssh").mkdir()
    (home / "link").symlink_to(home / ".ssh")
    r = ask("mac_files", action="read", path="~/link/id_rsa")
    assert r is None or r.reason not in ("geld", "nachricht", "login")
    for a in ({"action": "read", "path": "~/Dokumente/notiz.md"}, {"action": "write", "path": "~/Dokumente/a.txt", "content": "x"},
              {"action": "list", "path": "~/.ssh"}, {"action": "read", "path": "~/tokenizer.py"}):
        assert ask("mac_files", **a) is None


def test_open_and_browser_risk(home):
    with pytest.raises(Fail):
        ask("mac_open", target="~/Downloads/x.pkg")  # nicht auf der Erlaubnisliste (test_mac)
    assert ask("mac_open", target="https://example.com/?d=geheim").reason == "nachricht"
    with pytest.raises(Fail):
        ask("mac_browser", action="open", url="javascript:alert(1)")
    assert ask("mac_browser", action="open", url="https://example.com/?q=" + "a" * 50).reason == "nachricht"
    for t in ({"target": "~/Dokumente/a.pdf"}, {"target": "https://example.com/seite"}, {"app": "Safari"}):
        assert ask("mac_open", **t) is None
    assert ask("mac_browser", action="open", url="https://example.com") is None and ask("mac_browser", action="read") is None
    clip = ask("mac_clipboard", action="read")
    assert clip is None or clip.reason == "geheimnis"
    assert ask("mac_clipboard", action="write", text="x") is None
    assert ask("mac_notes", action="create", title="x") is None


# ---- 5 eigene MCP-Server
def test_user_mcp_risk_but_no_card_reason(monkeypatch):
    monkeypatch.setattr(user_mcp, "TOOLS", {})
    t = SimpleNamespace(name="lesen", description="d", title=None, input_schema={"type": "object"}, annotations=SimpleNamespace(read_only_hint=True))
    user_mcp._register("srv", [t])
    risk = user_mcp.TOOLS["mcp_srv__lesen"].risk(SimpleNamespace(), {})
    assert risk.reason == "system" and risk.reason not in ("geld", "nachricht", "login")


# ---- 6 stderr
async def test_stderr_is_drained_and_tail_kept(tmp_path):
    code = "import sys\nsys.stderr.write('x'*500000 + 'ENDE')\nsys.stderr.flush()\nprint('fertig')"
    tree = await ProcessTree.spawn([sys.executable, "-c", code], tmp_path, dict(os.environ))
    assert [line async for line in tree.lines()] == ["fertig"]
    await asyncio.wait_for(tree.proc.wait(), 5)
    assert (await tree.stderr_tail()).endswith("ENDE") and len(tree._err) <= 16 * 1024
    await tree.kill()


# ---- 7 Fehlertexte
def test_error_texts_are_redacted():
    from orbitd.cli.acp import Cursor
    for text in (claude.explain(f"boom {SECRET}"), codex.explain(f"boom {SECRET}"), Cursor().explain(f"boom {SECRET}")):
        assert SECRET not in text and "geschwärzt" in text


# ---- 8 Codex
def test_codex_no_own_shell_and_valid_after_resume(tmp_path):
    for session in (None, "abc"):
        argv = codex.Codex().command(turn(tmp_path, session=session))
        assert "app-server" in argv and 'sandbox_mode="read-only"' in argv and 'approval_policy="never"' in argv
        assert [argv[i + 1] for i, x in enumerate(argv) if x == "--disable"] == ["shell_tool", "unified_exec"]
        assert "tok-geheim-123" not in " ".join(argv)


# ---- 9 Claude
def test_claude_token_not_on_command_line_but_in_0600_file(tmp_path):
    t = turn(tmp_path)
    path = claude.Claude.mcp_file(t)
    argv = claude.Claude().command(t, path)
    assert "tok-geheim-123" not in " ".join(argv) and argv[argv.index("--mcp-config") + 1] == str(path)
    assert stat.S_IMODE(path.stat().st_mode) == 0o600 and "tok-geheim-123" in path.read_text()
    assert path.parent == tmp_path
