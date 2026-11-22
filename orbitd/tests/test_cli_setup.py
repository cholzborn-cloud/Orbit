"""Programme installieren und anmelden: nur Attrappen, nichts aus dem Netz, kein echtes Programm."""
import json
import os
import sys
import textwrap
import time

import httpx
import pytest

from orbitd.cli import setup

SECRET = "sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWX"
FIELDS = {"id", "label", "installed", "version", "loggedIn", "state", "busy", "message", "loginUrl", "loginCode", "loginKind"}

FAKE = textwrap.dedent(f"""
    import json, os, pathlib, subprocess, sys, time
    args = sys.argv[1:]
    marker = pathlib.Path(__file__).with_suffix(".ready")
    if args == ["--version"]:
        print("9.8.7 (Attrappe)")
    elif args[:2] == ["auth", "status"]:
        print(json.dumps({{"loggedIn": marker.exists()}}))
    elif "login" in args:
        state = os.environ.get("FAKE_BROWSER_STATE")
        url = "https://login.example.test/auth?x=1" + ("&state=" + state if state else "")
        print("Öffne " + url + " im Browser.", flush=True)
        print("Dein Code: ABCD-1234 token={SECRET}", flush=True)
        if os.environ.get("FAKE_WAIT_LINE"):
            line = sys.stdin.readline().strip()
            open(os.environ["FAKE_LINEFILE"], "w").write(line)
            if line != os.environ.get("FAKE_EXPECTED_INPUT", "CODE-OK"):
                sys.exit(3)
        if os.environ.get("FAKE_HANG"):
            child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
            open(os.environ["FAKE_PIDFILE"], "w").write(str(child.pid))
            time.sleep(60)
        time.sleep(0.3)
        if not os.environ.get("FAKE_NO_SESSION"):
            marker.touch()
    else:
        print("ok")
""")


@pytest.fixture
def events(ctx):
    seen = []
    ctx.bus.listeners.append(seen.append)
    return seen


@pytest.fixture
def fake(ctx, data_dir):
    path = data_dir / "fake_prog.py"
    path.write_text(FAKE)
    s = setup.get(ctx)
    s.fake["claude"] = [sys.executable, str(path)]
    return s


def wait_for(events, pid, phases=("done", "error"), limit=10.0):
    end = time.time() + limit
    while time.time() < end:
        hits = [e for e in events if e["type"] == "cli-setup" and e["id"] == pid and e["phase"] in phases]
        if hits:
            return hits[-1]
        time.sleep(0.05)
    raise AssertionError("kein Abschluss-Ereignis")


def installer(body: bytes, redirect: str | None = None):
    def handler(request: httpx.Request):
        if redirect and request.url.host == "claude.ai":
            return httpx.Response(302, headers={"location": redirect})
        return httpx.Response(200, content=body)
    return httpx.MockTransport(handler)


def test_status_all_fields(client, fake):
    data = client.get("/v1/clis?fresh=1").json()
    assert data["ok"] is True
    assert [c["id"] for c in data["clis"]] == ["claude", "codex", "cursor", "agy"]
    for c in data["clis"]:
        assert set(c) == FIELDS
    claude, codex = data["clis"][0], data["clis"][1]
    assert claude["installed"] and claude["version"] == "9.8.7" and claude["state"] == "abgemeldet" and not claude["loggedIn"]
    assert codex["state"] == "fehlt" and codex["version"] is None and codex["message"]


def test_account_status_returns_only_confirmed_provider_email_on_request(client, fake, monkeypatch):
    for name in ("cursor", "codex", "agy"):
        fake.fake[name] = [sys.executable, f"fake-{name}"]
    calls = []
    cursor_connected = True

    async def probe(argv, timeout):
        args = argv[2:]
        calls.append(args)
        if args == ["--version"]:
            return 0, "2026.11.20"
        if args == ["auth", "status", "--json"]:
            return 0, json.dumps({"loggedIn": True, "email": "claude@example.test", "unused": "private"})
        if args == ["login", "status"]:
            return 0, "Logged in using ChatGPT"
        if args == ["status", "--format", "json"]:
            return 0, json.dumps({"isAuthenticated": True, "userInfo": {"email": "cursor@example.test"}})
        if args == ["models"]:
            if argv[1] == "fake-cursor" and not cursor_connected:
                return 1, "Authentication failed: invalid or expired"
            return 0, "Available models"
        raise AssertionError(args)

    async def app_server(argv, method, params, *, keychain_api):
        assert argv[1] == "fake-codex" and keychain_api
        assert method == "account/read" and params == {"refreshToken": False}
        calls.append([method])
        return {"account": {"type": "chatgpt", "email": "codex@example.test", "unused": "private"}}

    monkeypatch.setattr(fake, "_run", probe)
    monkeypatch.setattr(setup, "codex_request", app_server)
    basic = client.get("/v1/clis?fresh=1").json()["clis"]
    assert all(set(c) == FIELDS for c in basic)
    assert ["account/read"] not in calls and ["status", "--format", "json"] not in calls

    accounts = client.get("/v1/clis?fresh=1&account=1").json()["clis"]
    assert {c["id"]: c.get("accountEmail") for c in accounts} == {
        "claude": "claude@example.test", "codex": "codex@example.test", "cursor": "cursor@example.test", "agy": None,
    }
    assert all(set(c) <= FIELDS | {"accountEmail"} for c in accounts)
    cursor_connected = False
    accounts = client.get("/v1/clis?account=1").json()["clis"]
    cursor = next(c for c in accounts if c["id"] == "cursor")
    assert not cursor["loggedIn"] and "accountEmail" not in cursor


def test_unknown_program(client):
    r = client.post("/v1/clis/nope/install")
    assert r.status_code == 404 and r.json()["error"] == "Programm nicht gefunden."


def test_install_runs_downloaded_script(client, fake, events, data_dir):
    fake.transport = installer(f"echo installiere; echo token={SECRET}\n".encode(), redirect="https://downloads.claude.ai/boot.sh")
    assert client.post("/v1/clis/claude/install").json() == {"ok": True}
    assert wait_for(events, "claude")["phase"] == "done"
    phases = [e["phase"] for e in events if e["type"] == "cli-setup"]
    assert phases[0] == "install" and any("install" in (e["message"] or "").lower() for e in events)
    assert all(SECRET not in str(e) for e in events)
    assert (data_dir / "setup" / "claude-install.sh").exists()
    assert fake.cache is None


@pytest.mark.parametrize("redirect", ["https://evil.example/x.sh", "http://downloads.claude.ai/x.sh"])
def test_install_rejects_foreign_redirect(client, fake, events, redirect):
    fake.transport = installer(b"echo nie\n", redirect=redirect)
    client.post("/v1/clis/claude/install")
    end = wait_for(events, "claude")
    assert end["phase"] == "error" and "disallowed" in end["message"].lower()
    assert "nie" not in [e["message"] for e in events]


def test_install_rejects_big_download(client, fake, events):
    fake.transport = installer(b"#" * (setup.MAX_INSTALLER + 10))
    client.post("/v1/clis/claude/install")
    end = wait_for(events, "claude")
    assert end["phase"] == "error" and "too large" in end["message"].lower()


def test_no_network_in_test_mode(client, fake, events):
    client.post("/v1/clis/claude/install")
    assert "test mode" in wait_for(events, "claude")["message"].lower()


def test_claude_login_returns_url_and_accepts_browser_code(client, fake, events):
    data = client.post("/v1/clis/claude/login").json()
    assert data == {"ok": True, "url": "https://login.example.test/auth?x=1", "code": None, "opensBrowser": True}
    assert client.get("/v1/clis").json()["clis"][0]["loginKind"] == "code-paste"
    assert wait_for(events, "claude")["phase"] == "done"
    assert all(SECRET not in str(e) for e in events)


def test_second_operation_and_cancel(client, fake, events, data_dir, monkeypatch):
    pidfile = data_dir / "child.pid"
    monkeypatch.setenv("FAKE_HANG", "1")
    monkeypatch.setenv("FAKE_PIDFILE", str(pidfile))
    assert client.post("/v1/clis/claude/login").json()["url"]
    for _ in range(100):
        if pidfile.exists() and pidfile.read_text():
            break
        time.sleep(0.05)
    child = int(pidfile.read_text())
    clis = client.get("/v1/clis").json()["clis"]
    assert clis[0]["busy"] == "login" and clis[0]["state"] == "laeuft" and clis[0]["loginUrl"]
    second = client.post("/v1/clis/claude/install")
    assert second.status_code == 400 and second.json()["error"] == "That is already running."
    assert client.post("/v1/clis/claude/cancel").json() == {"ok": True}
    assert wait_for(events, "claude")["message"] == "Cancelled."
    with pytest.raises(ProcessLookupError):
        os.kill(child, 0)
    assert client.get("/v1/clis").json()["clis"][0]["busy"] is None


def test_agy_login_menu_and_browser_code(client, fake, events, data_dir):
    script = data_dir / "fake_agy.py"
    script.write_text(textwrap.dedent("""
        import pathlib, sys, time
        marker = pathlib.Path(__file__).with_suffix(".ready")
        if "--version" in sys.argv:
            print("1.5.6")
        elif "models" in sys.argv:
            sys.exit(0 if marker.exists() else 1)
        else:
            print(" > 1. Google OAuth", flush=True)
            input()
            print("\\x1b]8;;https://accounts.google.com/auth\\x07Link\\x1b]8;;\\x07", flush=True)
            if input().strip() == "CODE-OK":
                marker.touch()
            time.sleep(10)
    """))
    fake.fake["agy"] = [sys.executable, str(script)]
    assert client.post("/v1/clis/agy/login").json()["url"] == "https://accounts.google.com/auth"
    assert client.post("/v1/clis/agy/login/input", json={"text": "CODE-OK"}).status_code == 200
    assert wait_for(events, "agy")["phase"] == "done"
    assert client.get("/v1/clis?fresh=1").json()["clis"][-1]["loggedIn"]


def test_disconnect_checks_real_status_before_and_after_logout(client, fake, monkeypatch):
    seen = []
    logged_in = True

    async def run(argv, timeout):
        nonlocal logged_in
        seen.append(argv[-1])
        if argv[-1] == "--version":
            return 0, "1.2.3"
        if argv[-1] == "logout":
            logged_in = False
            return 0, ""
        return 0, '{"loggedIn": true}' if logged_in else '{"loggedIn": false}'

    monkeypatch.setattr(fake, "_run", run)
    assert client.post("/v1/clis/claude/disconnect").json()["ok"] is True
    assert seen.count("logout") == 1
    assert client.get("/v1/clis?fresh=1").json()["clis"][0]["state"] == "abgemeldet"

    async def broken(argv, timeout):
        seen.append(argv[-1])
        return (0, "1.2.3") if argv[-1] == "--version" else (1, "temporärer Statusfehler")

    monkeypatch.setattr(fake, "_run", broken)
    assert client.post("/v1/clis/claude/disconnect").status_code == 400
    assert seen.count("logout") == 1


def test_login_input_reaches_program(client, fake, events, data_dir, monkeypatch):
    linefile = data_dir / "line.txt"
    monkeypatch.setenv("FAKE_WAIT_LINE", "1")
    monkeypatch.setenv("FAKE_LINEFILE", str(linefile))
    assert client.post("/v1/clis/claude/login").json()["url"]
    assert client.post("/v1/clis/claude/login/input", json={"text": "CODE-OK"}).json() == {"ok": True}
    assert wait_for(events, "claude")["phase"] == "done"
    assert linefile.read_text() == "CODE-OK"
    assert all("CODE-OK" not in str(e) for e in events)


def test_login_input_wrong_code_reports_error(client, fake, events, data_dir, monkeypatch):
    monkeypatch.setenv("FAKE_WAIT_LINE", "1")
    monkeypatch.setenv("FAKE_LINEFILE", str(data_dir / "line.txt"))
    client.post("/v1/clis/claude/login")
    client.post("/v1/clis/claude/login/input", json={"text": "falsch"})
    assert wait_for(events, "claude")["phase"] == "error"


@pytest.mark.parametrize("submitted", ["CODE-OK", "CODE-OK#state-current", "CODE-OK%23state-current"])
def test_claude_pairs_the_code_with_the_current_attempt(client, fake, events, data_dir, monkeypatch, submitted):
    linefile = data_dir / "line.txt"
    monkeypatch.setenv("FAKE_WAIT_LINE", "1")
    monkeypatch.setenv("FAKE_LINEFILE", str(linefile))
    monkeypatch.setenv("FAKE_BROWSER_STATE", "state-current")
    monkeypatch.setenv("FAKE_EXPECTED_INPUT", "CODE-OK#state-current")
    assert client.post("/v1/clis/claude/login").status_code == 200
    r = client.post("/v1/clis/claude/login/input", json={"text": "CODE-OK#state-old"})
    assert r.status_code == 400 and "another sign-in attempt" in r.json()["error"]
    assert not linefile.exists()
    assert client.post("/v1/clis/claude/login/input", json={"text": submitted}).status_code == 200
    assert wait_for(events, "claude")["phase"] == "done"
    assert linefile.read_text() == "CODE-OK#state-current"


def test_claude_requires_a_confirmed_login_status(client, fake, events, monkeypatch):
    monkeypatch.setenv("FAKE_NO_SESSION", "1")
    assert client.post("/v1/clis/claude/login").status_code == 200
    result = wait_for(events, "claude")
    assert result["phase"] == "error" and "no connected account" in result["message"].lower()


def test_claude_sends_codes_longer_than_the_macos_terminal_buffer(client, fake, events, data_dir, monkeypatch):
    code = "ABC" * 600
    with_state = code + "#state-current"
    linefile = data_dir / "line.txt"
    monkeypatch.setenv("FAKE_WAIT_LINE", "1")
    monkeypatch.setenv("FAKE_LINEFILE", str(linefile))
    monkeypatch.setenv("FAKE_BROWSER_STATE", "state-current")
    monkeypatch.setenv("FAKE_EXPECTED_INPUT", with_state)
    assert client.post("/v1/clis/claude/login").json()["url"]
    assert client.post("/v1/clis/claude/login/input", json={"text": code}).status_code == 200
    assert wait_for(events, "claude")["phase"] == "done"
    assert linefile.read_text() == with_state


def test_login_input_errors(client, fake, events, data_dir, monkeypatch):
    r = client.post("/v1/clis/claude/login/input", json={"text": "x"})
    assert r.status_code == 400 and r.json()["error"] == "No sign-in is in progress."
    assert client.post("/v1/clis/nix/login/input", json={"text": "x"}).json()["error"] == "Programm nicht gefunden."
    monkeypatch.setenv("FAKE_HANG", "1")
    monkeypatch.setenv("FAKE_PIDFILE", str(data_dir / "c.pid"))
    client.post("/v1/clis/claude/login")
    for bad in ("", "   ", "a" * 2049, "a\x03b", "a\nb", 5):
        r = client.post("/v1/clis/claude/login/input", json={"text": bad})
        assert r.status_code == 400 and r.json()["error"] == "Invalid input.", bad
    client.post("/v1/clis/claude/cancel")


@pytest.mark.skipif(sys.platform != "darwin" or not os.access("/usr/bin/sandbox-exec", os.X_OK), reason="braucht macOS sandbox-exec")
def test_isolated_login_never_reaches_the_keychain(cfg, monkeypatch, tmp_path):
    """Getrenntes Profil: Anmelden läuft ohne `security` und ohne Schlüsselbund-Dienste; Claude findet den Ersatz-`security` (Datei statt Schlüsselbund)."""
    from types import SimpleNamespace
    from orbitd import sandbox
    monkeypatch.setenv("ORBIT_ISOLATED_PROFILE", "1")
    monkeypatch.setenv("ORBIT_DATA_DIR", str(tmp_path / "profil"))
    (tmp_path / "profil").mkdir()
    s = setup.Setup(SimpleNamespace(cfg=cfg))
    for name in ("claude", "cursor-agent", "agy"):
        rules = s._command([f"/x/{name}", "login"])[2]
        assert 'process-exec (literal "/usr/bin/security")' in rules and "(deny mach-lookup" in rules, name
    assert "(deny mach-lookup" not in s._command(["/x/codex", "login"])[2]
    path = setup._env()["PATH"].split(os.pathsep)
    assert path[0] == str((tmp_path / "profil").resolve() / sandbox.CLI_BIN)


def test_cursor_status_checks_models_instead_of_stale_local_login(client, fake, monkeypatch):
    fake.fake["cursor"] = [sys.executable, "fake-cursor"]
    calls = []

    async def probe(argv, timeout):
        calls.append(argv[-1])
        if argv[-1] == "--version":
            return 0, "2026.11.13-eacade1"
        return 1, "Authentication failed: your Cursor credentials or API key are invalid or expired."

    monkeypatch.setattr(fake, "_run", probe)
    cursor = next(c for c in client.get("/v1/clis?fresh=1").json()["clis"] if c["id"] == "cursor")
    assert cursor["state"] == "abgemeldet" and not cursor["loggedIn"]
    assert calls.count("models") == 1 and "status" not in calls
