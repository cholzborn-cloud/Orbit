"""Freigabe-Tor und Laufzeit: Funde der unabhängigen Prüfung (Umgehungen, Fremddaten, Arbeitsordner, Weiter). Daten nur unter /tmp."""
import asyncio
import functools
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from orbitd import config
from orbitd.db import dumps, loads, now_ms
from orbitd.runtime import contract, inbox, recovery, runner
from orbitd.runtime.interactions import Interactions
from orbitd.tools import daytona
from orbitd.tools.mac.risk import risk_of

def sync(fn):
    """Async-Test ohne Zusatzpaket laufen lassen (wie die übrigen Tests: asyncio.run)."""
    @functools.wraps(fn)
    def run(*a, **kw):
        return asyncio.run(fn(*a, **kw))
    return run


APPSUP = "~/Library/Application Support/Orbit"
PORT = 4317


@pytest.fixture(autouse=True)
def clean_work(data_dir):
    yield
    shutil.rmtree(data_dir.parent / f"{data_dir.name}-cli-work", ignore_errors=True)  # Geschwister-Arbeitsordner der Datenkopie


@pytest.fixture
def home(tmp_path, monkeypatch):
    monkeypatch.setenv("HOME", str(tmp_path))
    (tmp_path / "Library" / "Application Support" / "Orbit" / "uploads" / "c").mkdir(parents=True)
    (tmp_path / "Library" / "Application Support" / "Orbit" / "uploads" / "c" / "a.png").write_bytes(b"x")
    return tmp_path


def fake_run(home, **kw):
    cfg = SimpleNamespace(data_dir=home / "Library" / "Application Support" / "Orbit", port=PORT)
    return SimpleNamespace(bot={"name": "Nova"}, ctx=SimpleNamespace(cfg=cfg), counters={}, from_orbi=False, **kw)


# ---- 1 Umgehungen des Freigabe-Tors: alle ergeben eine Karte
BYPASS = [
    ("mac_shell", {"command": f'sqlite3 {APPSUP.replace(" ", chr(92) + " ")}/orbit.sqlite "INSERT INTO approval_rules VALUES (1)"'}, "geheimnis"),
    ("mac_shell", {"command": f'sqlite3 "{APPSUP}/orbit.sqlite" .dump'}, "geheimnis"),
    ("mac_shell", {"command": 'cat "$HOME/Library/Application Support/Orbit/service.token"'}, "geheimnis"),
    ("mac_shell", {"command": "cat ${HOME}/Library/'Application Support'/Orbit/x"}, "geheimnis"),
    ("mac_shell", {"command": "cat ~/Library/Application\\ Support/Orbit/../Orbit/data"}, "geheimnis"),
    ("mac_shell", {"command": "cat ~/Library/Application\\ Support//Orbit/./x"}, "geheimnis"),
    ("mac_shell", {"command": "cd ~/Library && cat Application*/../Application\\ Support/Orbit/orbit.sqlite"}, "geheimnis"),
    ("mac_shell", {"command": "cat Orbit/orbit.sqlite", "cwd": "~/Library/Application Support"}, "geheimnis"),
    ("mac_shell", {"command": "cat secrets.env"}, "geheimnis"),
    ("mac_shell", {"command": "security find-generic-password -s de.consti.orbit2 -w"}, "geheimnis"),
    ("mac_shell", {"command": 'bash -c "sqlite3 /tmp/x.db .tables"'}, "geheimnis"),
    ("mac_shell", {"command": 'python3 -c "import sqlite3;sqlite3.connect(\'/Users/x/Library/Application Support/Orbit/orbit.sqlite\')"'}, "geheimnis"),
    ("mac_shell", {"command": "curl -H \"Authorization: Bearer $(cat ~/Library/Application\\ Support/Orbit/service.token)\" http://127.0.0.1:4317/v1/approvals/x/decide"}, "geheimnis"),
    ("mac_shell", {"command": "curl -X POST http://127.0.0.1:4317/v1/approvals/x/decide"}, "system"),
    ("mac_shell", {"command": "curl http://localhost:4317/v1/status"}, "system"),
    ("mac_shell", {"command": "wget -qO- 'http://[::1]:4317/v1/status'"}, "system"),
    ("mac_shell", {"command": "curl 0.0.0.0:4317/v1/status"}, "system"),
    ("mac_shell", {"command": "echo 'GET /v1/status HTTP/1.0' | nc 127.0.0.1 4317"}, "system"),
    ("mac_shell", {"command": "python3 -c \"import socket;socket.create_connection(('127.0.0.1', 4317))\""}, "system"),
    ("mac_shell", {"command": "curl http://127.0.0.1:$ORBITD_PORT/v1/status"}, "system"),
    ("mac_shell", {"command": "sudo launchctl bootout gui/501/de.consti.orbit"}, "system"),
    ("mac_shell", {"command": "echo L2V0Yy9wYXNzd2Q= | base64 -d | sh"}, "system"),
    ("mac_applescript", {"script": 'do shell script "curl http://localhost:4317/v1/approvals"'}, "system"),
    ("mac_applescript", {"script": 'set f to (path to application support folder as text) & "Orbit:orbit.sqlite"\nread file f'}, "geheimnis"),
    ("mac_applescript", {"script": 'do shell script "cat ~/Library/Application\\\\ Support/Orbit/service.token"'}, "geheimnis"),
    ("mac_open", {"target": "http://127.0.0.1:4317/v1/status"}, "system"),
    ("mac_open", {"target": f"{APPSUP}/orbit.pdf"}, "geheimnis"),  # orbit.sqlite: schon die Erlaubnisliste lehnt ab
    ("mac_browser", {"action": "open", "url": "http://localhost:4317/v1/status"}, "system"),
    ("mac_files", {"action": "read", "path": f"{APPSUP}/orbit.sqlite"}, "geheimnis"),
    ("mac_files", {"action": "write", "path": f"{APPSUP}/anything", "content": "x"}, "geheimnis"),
    ("mac_files", {"action": "list", "path": f"{APPSUP}/../Orbit"}, "geheimnis"),
    ("mac_files", {"action": "trash", "paths": ["~/a", f"{APPSUP}/orbit.sqlite-wal"]}, "geheimnis"),
    ("mac_files", {"action": "move", "path": "~/a.txt", "to": f"{APPSUP}/x"}, "geheimnis"),
]
HARMLESS = [
    ("mac_shell", {"command": "ls ~/Documents"}), ("mac_shell", {"command": "echo hallo"}),
    ("mac_shell", {"command": "curl https://example.com/index.html"}), ("mac_shell", {"command": "python3 -m http.server 8000"}),
    ("mac_applescript", {"script": 'return "hallo"'}),
    ("mac_files", {"action": "read", "path": f"{APPSUP}/uploads/c/a.png"}),
]


@pytest.mark.parametrize("tool,a,reason", BYPASS)
def test_orbit_gate_bypass_no_card(home, tool, a, reason):
    # Klassifikation bleibt (Deny), Freigabekarte nur bei geld/nachricht/login
    r = risk_of(tool, fake_run(home), a)
    assert r is not None and r.reason == reason and r.reason not in ("geld", "nachricht", "login")


def test_orbit_gate_symlink(home):
    link = home / "kurz"
    link.symlink_to(home / "Library" / "Application Support" / "Orbit")
    run = fake_run(home)
    for cmd in (f"cat {link}/orbit.sqlite",):
        r = risk_of("mac_shell", run, {"command": cmd})
        assert r is not None and r.reason not in ("geld", "nachricht", "login")
    assert risk_of("mac_files", run, {"action": "read", "path": "~/kurz/x"}).reason == "geheimnis"


@pytest.mark.parametrize("tool,a", HARMLESS)
def test_orbit_gate_harmless_stays_free(home, tool, a):
    assert risk_of(tool, fake_run(home), a) is None


def test_service_risk_but_no_ask_reason(home):
    r = risk_of("mac_shell", fake_run(home), {"command": "curl http://localhost:4317/"})
    assert r is not None and r.reason == "system"


# ---- 2 Fremddaten erzwingen keine Freigabekarten mehr (außer geld/nachricht/login)
ACTING = [("mac_shell", {"command": "ls"}), ("mac_applescript", {"script": "return 1"}), ("mac_shortcut", {"name": "Hallo"}),
          ("mac_files", {"action": "write", "path": "~/a.txt", "content": "x"}), ("mac_files", {"action": "move", "path": "~/a", "to": "~/b"}),
          ("mac_files", {"action": "trash", "paths": ["~/a"]}), ("mac_open", {"target": "~/a.txt"}), ("mac_browser", {"action": "open", "url": "https://example.com"}),
          ("mac_input", {"action": "key", "key": "return"})]
READING = [("mac_files", {"action": "read", "path": "~/a.txt"}), ("mac_files", {"action": "list", "path": "~"}), ("mac_shortcut", {}),
           ("mac_browser", {"action": "read"}), ("mac_calendar", {"action": "list"})]


@pytest.mark.parametrize("how", ["untrusted", "from_orbi"])
@pytest.mark.parametrize("tool,a", ACTING)
def test_foreign_run_acts_without_card(home, how, tool, a):
    run = fake_run(home)
    assert risk_of(tool, run, a) is None
    if how == "untrusted":
        run.counters["untrusted"] = run.counters["untrusted_now"] = True
    else:
        run.from_orbi = True
    assert risk_of(tool, run, a) is None


@pytest.mark.parametrize("tool,a", READING)
def test_foreign_run_reading_stays_free(home, tool, a):
    run = fake_run(home)
    run.counters["untrusted"] = True
    assert risk_of(tool, run, a) is None


def test_foreign_daytona_bash_no_card(home):
    run = fake_run(home)
    assert daytona._bash_risk(run, {"command": "ls"}) is None
    run.counters["untrusted"] = True
    assert daytona._bash_risk(run, {"command": "ls"}) is None


@sync
async def test_system_risk_creates_no_card(ctx, seed):
    inter = Interactions(ctx)
    run = SimpleNamespace(id="r1", chat_id="chat1", bot={"id": "bot1", "name": "Nova", "avatar": "", "color": ""}, root=None, message_id="m", counters={}, from_orbi=False,
                          set_waiting=lambda w: None)
    await inter.gate(run, "mac_shell", {"command": "ls"}, contract.Risk("system", "mac_shell:fremd", "Nach fremden Inhalten: ls"))
    assert inter.list() == []


# ---- 3 Fremddaten-Markierung überlebt den Lauf, solange die CLI-Sitzung weiterläuft
def make_runner(ctx, session):
    chat, bot = {"id": "chat1", "kind": "direct"}, {"id": "bot1", "name": "Nova"}
    items = [{"payload": {"text": "hi"}, "kind": "message"}]
    return runner.Runner(SimpleNamespace(ctx=ctx), "run1", bot, chat, items, None, None, {}, None, session, None)


def test_untrusted_survives_until_chat_is_cleared(ctx, seed):
    from orbitd import chatstore
    first = make_runner(ctx, None)
    assert not first.counters.get("untrusted")
    first.counters["untrusted"] = True
    assert make_runner(ctx, "sess-1").counters.get("untrusted") is True  # dieselbe Sitzung läuft weiter
    assert make_runner(ctx, None).counters.get("untrusted") is True  # neue Sitzung (z. B. Programmwechsel): der Verlauf kommt trotzdem in den Prompt
    assert make_runner(ctx, "sess-2").counters.get("untrusted") is True
    chatstore.clear(ctx.db, "chat1")
    assert not make_runner(ctx, None).counters.get("untrusted")


def test_two_levels_eigen_only_for_this_run_extern_stays(ctx, seed):
    """Stufe „eigen“ (Brain, Kalender, Dateien) gilt nur im Lauf; „extern“ (Web, Orbi-Nachricht) bleibt je Chat und Orbi."""
    from orbitd.runtime.contract import foreign
    from orbitd.tools.mac.risk import risk_of
    first = make_runner(ctx, None)
    first.counters["eigen"] = True
    assert foreign(first) and risk_of("mac_shell", first, {"command": "ls"}) is None  # Mac ohne Freigabe
    second = make_runner(ctx, "sess-1")
    assert not foreign(second) and risk_of("mac_shell", second, {"command": "ls"}) is None
    orbi = runner.Runner(SimpleNamespace(ctx=ctx), "run2", {"id": "bot1", "name": "Nova"}, {"id": "chat1", "kind": "direct"},
                         [{"payload": {"text": "hi", "orbi": {"kind": "message"}}, "kind": "message"}], None, None, {}, None, None, None)
    assert orbi.counters.get("untrusted") is True
    assert foreign(make_runner(ctx, None))  # Orbi-Nachricht: bleibt bis zum Leeren des Chats


@sync
async def test_chat_recall_marks_untrusted(ctx, seed):
    from orbitd.tools import recall
    run = SimpleNamespace(ctx=ctx, chat_id="chat1", counters={})
    await recall.chat_recall(run, {"query": "hallo"})
    assert run.counters == {"eigen": True}  # Suche im eigenen Verlauf: nur dieser Lauf
    ctx.db.run("INSERT INTO tool_outputs (id,chat_id,tool,chars,body,created_at) VALUES ('o1','chat1','web_fetch',1,'x',1)")
    await recall.chat_recall(run, {"id": "o1"})
    assert run.counters.get("untrusted") is True  # volle Werkzeug-Ergebnisse: Stufe „extern“


# ---- „Immer erlauben“: Restregeln für geld/nachricht/login; system-Arten ohne Karte
@pytest.mark.parametrize("kind,reason,always", [
    ("mac_shell:system", "system", False), ("sandbox_bash:system", "system", False), ("mac_applescript:app:Finder:einmal", "system", False),
    ("mac_applescript:app:?:einmal", "system", False), ("mac_applescript:app:Safari", "system", True), ("mac_input:einmal", "system", False), ("mac_screen", "system", True)])
def test_always_rules_per_kind(ctx, seed, kind, reason, always):
    ctx.db.run("INSERT INTO approval_rules (id,user_id,bot_id,tool,mode,created_at) VALUES ('r1','local','bot1',?,'allow',?)", kind, now_ms())
    assert (Interactions(ctx)._rule("bot1", kind, reason) == "allow") is always


def test_applescript_system_card_never_always_but_app_card_keeps_it():
    from orbitd.runtime.interactions import no_rule
    assert no_rule("mac_applescript:system", "system")  # Befehls-Erkennung ohne App-Namen
    assert not no_rule("mac_applescript:app:Notes", "system")  # „Immer“ je App bleibt


def test_shell_system_no_card(home):
    r = risk_of("mac_shell", fake_run(home), {"command": "sudo ls"})
    assert r is not None and r.reason == "system"
    b = daytona._bash_risk(fake_run(home), {"command": "sudo ls"})
    assert b is not None and b.reason == "system"


@sync
async def test_shell_system_gate_creates_no_card(ctx, seed):
    inter = Interactions(ctx)
    run = SimpleNamespace(id="r1", chat_id="chat1", bot={"id": "bot1", "name": "Nova", "avatar": "", "color": ""}, root=None, message_id="m", counters={}, from_orbi=False,
                          set_waiting=lambda w: None)
    await inter.gate(run, "mac_shell", {"command": "sudo ls"}, contract.Risk("system", "mac_shell:system", "Greift ins System ein: sudo ls"))
    assert inter.list() == []


# ---- Text vor und nach einem verborgenen Orbit-Werkzeug sind zwei Teile; Anhänge bei „Weiter“ nicht doppelt
def test_hidden_tool_keeps_intermediate_text_out_of_fallback(ctx, seed):
    from orbitd.cli import Ev
    r = make_runner(ctx, None)
    chunks = []
    r.stream = SimpleNamespace(emit=chunks.append)
    for ev in (Ev("text", {"delta": "Das gibt es."}), Ev("tool_start", {"id": "t1", "name": "mcp__orbit__say", "input": {}}),
               Ev("tool_end", {"id": "t1", "name": "mcp__orbit__say"}), Ev("text", {"delta": "Das auch."})):
        r._event(ev)
    r._close_text()
    r.save()
    from orbitd import chatstore
    assert r.parts == [] and not any(c["type"].startswith("text-") for c in chunks)
    assert chatstore.get(ctx.db, "chat1", r.message_id) is None
    assert [p["text"] for p in r._restore_raw()] == ["Das auch."]
    assert "Das gibt es." in r.report_text()


def test_attachment_not_written_twice(ctx, seed):
    import base64
    from orbitd import chatstore
    url = "data:text/plain;base64," + base64.b64encode(b"inhalt").decode()
    chatstore.add(ctx.db, "chat1", "u1", "user", [{"type": "file", "url": url, "filename": "a.txt", "mediaType": "text/plain"}])
    r = make_runner(ctx, None)
    r.items = [{"payload": {"messageId": "u1"}, "kind": "message"}]
    r._attachments()
    r._attachments()  # „Weiter“: derselbe Anhang noch einmal
    folder = ctx.cfg.data_dir / "uploads" / "chat1"
    assert sorted(p.name for p in folder.iterdir()) == ["a.txt"]
    url2 = "data:text/plain;base64," + base64.b64encode(b"anders").decode()
    chatstore.add(ctx.db, "chat1", "u2", "user", [{"type": "file", "url": url2, "filename": "a.txt", "mediaType": "text/plain"}])
    r.items = [{"payload": {"messageId": "u2"}, "kind": "message"}]
    r._attachments()
    assert sorted(p.name for p in folder.iterdir()) == ["1-a.txt", "a.txt"]


def test_image_attachment_for_prompt(ctx, seed):
    import base64
    from orbitd import chatstore
    raw = b"\x89PNG-fake"
    b64 = base64.b64encode(raw).decode()
    chatstore.add(ctx.db, "chat1", "u1", "user", [{"type": "file", "url": f"data:image/png;base64,{b64}",
                                                   "filename": "Foto.png", "mediaType": "image/png"}])
    r = make_runner(ctx, None)
    r.items = [{"payload": {"messageId": "u1"}, "kind": "message"}]
    text, images, uploads = r._attachments()
    assert "Foto.png" in text and "/home/daytona/uploads/Foto.png" in text
    assert images == [{"mediaType": "image/png", "base64": b64}]
    assert uploads == [("/home/daytona/uploads/Foto.png", raw)]


# ---- 4 Arbeitsordner der Programme liegt nie im Datenordner
def test_work_dir_outside_data_dir(cfg, ctx, seed, tmp_path):
    assert cfg.data_dir not in cfg.work_dir.parents and cfg.work_dir != cfg.data_dir
    real = config.Config(data_dir=config.REAL_DATA_DIR, port=1, fake_sandbox=False, fake_cli=None)
    assert real.work_dir == Path.home() / "Library" / "Caches" / "Orbit" / "cli-work"
    r = make_runner(ctx, None)
    assert config.REAL_DATA_DIR not in r.work.parents and cfg.data_dir not in r.work.parents
    r.work.mkdir(parents=True)
    r._clean_work()
    assert not r.work.exists() and not cfg.work_dir.exists()  # leer: weg


def test_work_dir_with_leftovers_goes_to_trash(cfg, ctx, seed, monkeypatch):
    from orbitd.tools.mac import undo
    moved = []
    monkeypatch.setattr(undo, "move_to_trash", lambda p: moved.append(Path(p)) or {})
    r = make_runner(ctx, None)
    r.work.mkdir(parents=True)
    (r.work / "x.txt").write_text("x")
    r._clean_work()
    assert moved == [r.work] and r.work.exists()  # nichts wird endgültig gelöscht
    (r.work / "x.txt").unlink()
    r._clean_work()
    assert not cfg.work_dir.exists()


def test_recovery_sweeps_dead_work_folders(cfg):
    folder = cfg.work_dir / "bot-chat"
    folder.mkdir(parents=True)
    (folder / ".orbit-mcp-abc.json").write_text("{}")
    (cfg.work_dir / "oneshot-1").mkdir()
    keep = cfg.work_dir / "bot2-chat2"
    keep.mkdir()
    (keep / "arbeit.txt").write_text("x")
    recovery.sweep_work(cfg.work_dir)
    assert not folder.exists() and not (cfg.work_dir / "oneshot-1").exists() and (keep / "arbeit.txt").exists()


# ---- 5 und 6 „Weiter“
def test_resume_aborts_open_cards_and_takes_all_texts(client, ctx, seed):
    db, t = ctx.db, now_ms()
    db.run("INSERT INTO work_runs (id,kind,chat_id,bot_id,status,payload,steps,started_at,updated_at) VALUES ('old','turn','chat1','bot1','interrupted','{}',0,?,?)", t, t)
    for n, text in enumerate(["erste Frage", "zweite Frage"]):
        item = inbox.enqueue(db, "bot1", "chat1", "message", {"text": text}, f"k{n}")
        db.run("UPDATE inbox_items SET status='cancelled', run_id='old' WHERE id=?", item)
    db.run("INSERT INTO pending_interactions (id,chat_id,bot_id,kind,request,requested_at,expires_at) VALUES ('card1','chat1','bot1','approval',?,?,?)",
           dumps({"id": "card1", "kind": "approval", "chatId": "chat1", "botId": "bot1", "runId": "old", "reason": "system", "approvalKind": "mac_shell:system"}), t, t + 100000)
    assert client.post("/v1/chats/chat1/resume", json={"runId": "old"}).json() == {"ok": True}
    assert db.val("SELECT count(*) FROM pending_interactions WHERE id='card1'") == 0
    text = loads(db.val("SELECT payload FROM inbox_items WHERE kind='resume'"))["text"]
    assert "erste Frage" in text and "zweite Frage" in text


# ---- 7 Ausweichweg wählt nie ein gesperrtes Modell
@sync
async def test_choose_fallback_skips_blocked_models(client, ctx, seed):
    from orbitd import cli
    rt = ctx.parts["runtime"]

    class Broken:
        async def choose(self, _):
            raise RuntimeError("Jev kaputt")
    ctx.parts["jev"] = Broken()
    bot, chat = {"id": "bot1"}, {"id": "chat1", "kind": "direct"}
    items = [{"payload": {"text": "hi"}}]
    available = [m for m in cli.MODELS if rt.adapters[m["cli"]].available()]
    assert available
    first_cli = available[0]["cli"]
    ctx.parts["limits"].block(first_cli, now_ms() + 600_000)
    model, _, _, error = await rt._choose(bot, chat, items, {"model": "auto"})
    others = [m for m in available if m["cli"] != first_cli]
    assert (model is not None and model["cli"] != first_cli and not error) if others else (model is None and "Nutzungslimit" in error)
    for m in available:
        ctx.parts["limits"].block(m["cli"], now_ms() + 600_000)
    model, _, _, error = await rt._choose(bot, chat, items, {"model": "auto"})
    assert model is None and "Nutzungslimit" in error


# ---- 8 Orbit-Werkzeuge nur am exakten Präfix
def test_is_orbit_exact_prefix(ctx, seed):
    r = make_runner(ctx, None)
    r.model = {"cli": "claude"}
    assert all(r._is_orbit(n) for n in ("mcp__orbit__say", "orbit:say", "orbit.say", "MCP__ORBIT__x"))
    assert not any(r._is_orbit(n) for n in ("my_orbital_tool", "mcp__orbital__x", "Read orbit.txt", "mcp__other__orbit"))


# ---- 9 Einmal-Aufruf: Prozessgruppe wird vermerkt und nach kill -9 abgeräumt; eine Outcome-Klasse
def test_outcome_single_class():
    assert runner.Outcome is contract.Outcome
    o = contract.Outcome(status="done", text="x")
    assert o["status"] == "done" and o.get("text") == "x" and o.status == "done"


@sync
async def test_recover_reaps_oneshot_groups(ctx, seed):
    proc = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], start_new_session=True)
    try:
        ctx.db.run("INSERT INTO app_kv (key,value,updated_at) VALUES (?,?,?)", f"oneshot:{proc.pid}",
                   dumps({"pgid": proc.pid, "start": recovery.proc_start(proc.pid), "proc": "python"}), now_ms())
        await recovery.recover(SimpleNamespace(ctx=ctx, db=ctx.db))
        proc.wait(5)
        assert proc.returncode is not None
        assert ctx.db.val("SELECT count(*) FROM app_kv WHERE key LIKE 'oneshot:%'") == 0
    finally:
        if proc.poll() is None:
            proc.kill()


@sync
async def test_oneshot_notes_group_and_cleans_up(client, ctx, seed):
    from orbitd import boot
    rt = ctx.parts["runtime"]
    seen = []
    orig = ctx.db.run

    def spy(sql, *a):
        if "oneshot:" in str(a):
            seen.append(a)
        return orig(sql, *a)
    ctx.db.run = spy
    try:
        await boot.oneshot(rt, "Hallo", "small")
    finally:
        ctx.db.run = orig
    assert seen and ctx.db.val("SELECT count(*) FROM app_kv WHERE key LIKE 'oneshot:%'") == 0
