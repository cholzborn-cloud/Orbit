"""Systemsperre (sandbox.py) über die echten Handler: mac_shell und ProcessTree.spawn. Nur macOS mit sandbox-exec."""
import asyncio
import ctypes
import http.server
import os
import shutil
import socket
import struct
import sys
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import pytest

from orbitd import sandbox
from orbitd.cli import acp, claude, codex
from orbitd.cli.base import ProcessTree
from orbitd.runtime.contract import TOOLS
from orbitd.tools.mac import tools as mac_tools, undo

pytestmark = pytest.mark.skipif(sys.platform != "darwin" or not os.access(sandbox.EXEC, os.X_OK), reason="braucht macOS sandbox-exec")


@pytest.fixture
def box(ctx, data_dir, monkeypatch):
    """Datenordner mit Geheimnis und Anhang; Heimordner und Arbeitsordner liegen daneben (nicht im Datenordner)."""
    other = Path(tempfile.mkdtemp(prefix="orbit-sbx-", dir="/tmp")).resolve()
    monkeypatch.setattr(undo, "home", lambda: other)
    d = data_dir.resolve()
    (d / "secret.txt").write_text("geheim")
    (d / "uploads").mkdir()
    (d / "uploads" / "a.txt").write_text("anhang")
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", ctx.cfg.port), http.server.SimpleHTTPRequestHandler)
    srv6 = type("V6", (http.server.ThreadingHTTPServer,), {"address_family": socket.AF_INET6})(("::1", ctx.cfg.port), http.server.SimpleHTTPRequestHandler)
    for s in (srv, srv6):
        threading.Thread(target=s.serve_forever, daemon=True).start()
    yield SimpleNamespace(d=d, other=other, run_=SimpleNamespace(ctx=ctx, bot={"name": "Nova"}, chat_kind="direct", chat_id="c", counters={}))
    for s in (srv, srv6):
        s.shutdown()
        s.server_close()
    shutil.rmtree(other, ignore_errors=True)


def sh(box, cmd):
    return asyncio.run(TOOLS["mac_shell"].handler(box.run_, {"command": cmd, "cwd": str(box.other)}))


def test_data_dir_is_locked_for_shell(box):
    d = box.d
    assert sh(box, f"cat {d}/secret.txt")["exitCode"] != 0
    assert sh(box, f"cat {d}/s*.txt")["exitCode"] != 0
    assert sh(box, f"python3 -c \"print(open('{d.parent}/' + '{d.name}' + '/sec' + 'ret.txt').read())\"")["exitCode"] != 0
    assert sh(box, f"echo x > {d}/neu.txt")["exitCode"] != 0 and not (d / "neu.txt").exists()
    assert sh(box, f"echo x >> {d}/secret.txt")["exitCode"] != 0 and (d / "secret.txt").read_text() == "geheim"
    assert sh(box, f"ls {d}")["exitCode"] != 0


def test_uploads_readable_not_writable(box):
    r = sh(box, f"cat {box.d}/uploads/a.txt")
    assert r["exitCode"] == 0 and "anhang" in r["output"]
    assert sh(box, f"echo x > {box.d}/uploads/b.txt")["exitCode"] != 0


def test_security_and_own_port_blocked(box):
    r = sh(box, "/usr/bin/security list-keychains")  # ohne Sperre: Ausgang 0
    assert r["exitCode"] != 0 and "not permitted" in r["output"].lower()


@pytest.mark.parametrize("host", ["localhost", "127.0.0.1", "[::1]"])
def test_own_port_blocked_on_every_loopback_address(box, host):
    import urllib.request
    url = f"http://{host}:{box.run_.ctx.cfg.port}/"
    assert urllib.request.urlopen(url, timeout=5).status == 200  # Kontrolle: ohne Sperre erreichbar
    assert sh(box, f"curl -sS -m 5 -o /dev/null {url}")["exitCode"] != 0


SANDBOX_CHECK = "import ctypes,os;f=ctypes.CDLL(None).sandbox_check;print(f(os.getpid(),b'lsopen',0),f(os.getpid(),b'appleevent-send',0))"


def test_shell_cannot_start_apps_or_send_apple_events(box, cfg):
    # erst die Sperre selbst abfragen (sandbox_check, ohne Wirkung); nur wenn sie greift, folgen echte Versuche: ohne Sperre startet so nichts
    assert sh(box, f'/usr/bin/python3 -c "{SANDBOX_CHECK}"')["output"].split() == ["1", "1"]
    marker, script = box.other / "lief", box.other / "x.command"
    script.write_text(f"#!/bin/sh\ntouch {marker}\n")
    script.chmod(0o755)
    assert sh(box, f"open {script}")["exitCode"] != 0
    assert sh(box, "open -g -j -a 'Image Events'")["exitCode"] != 0  # unsichtbare Hintergrund-App
    assert sh(box, "osascript -e 'tell application \"Finder\" to count windows'")["exitCode"] != 0
    try:  # launchd, crontab und at verweigern gesperrten Prozessen schon selbst
        assert sh(box, "launchctl submit -l de.orbit.sbxtest -- /usr/bin/true")["exitCode"] != 0
    finally:
        subprocess.run(["launchctl", "remove", "de.orbit.sbxtest"], capture_output=True)
    assert sh(box, "crontab -l")["exitCode"] != 0 and sh(box, "at -l")["exitCode"] != 0
    time.sleep(1)
    assert not marker.exists()
    # der Fall „ohne Sperre“ läuft nie echt: nur am Profiltext
    plain = sandbox.profile(cfg, allow_service=False, allow_security=False)
    assert "(deny lsopen)" not in plain and "(deny appleevent-send)(" not in plain
    strict = sandbox.profile(cfg, allow_service=False, allow_security=False, launch=False, events=())
    assert "(deny lsopen)" in strict and "(deny appleevent-send)" in strict and "LaunchAgents" in strict


KEYCHAIN_JS = """ObjC.import('Security');
var q = $.NSMutableDictionary.alloc.init;
q.setObjectForKey($('genp'), $('class'));
q.setObjectForKey($('orbit-gibt-es-sicher-nicht-xyz-42'), $('svce'));
String($.SecItemCopyMatching(q, Ref()));"""


def test_keychain_service_blocked_but_tls_works(box):
    # Suche nach einem sicher fehlenden Eintrag: -25300 = Schlüsselbund wurde gefragt (ohne Sperre), alles andere = gesperrt
    js = box.other / "kc.js"
    js.write_text(KEYCHAIN_JS)
    r = sh(box, f"osascript -l JavaScript {js}")
    assert r["exitCode"] == 0 and r["output"].strip() not in ("-25300", "0")
    if subprocess.run(["curl", "-sS", "-m", "15", "-o", "/dev/null", "https://example.com"], capture_output=True).returncode:
        pytest.skip("kein Netz")
    assert sh(box, "curl -sS -m 15 -o /dev/null https://example.com")["exitCode"] == 0


def test_shell_cannot_write_autostart_files(box, monkeypatch):
    # nur im Wegwerf-Heimordner: echte ~/.zshrc, ~/.ssh, ~/.gitconfig bleiben unberührt
    monkeypatch.setenv("HOME", str(box.other))
    (box.other / ".ssh").mkdir()
    (box.other / "repo" / ".git" / "hooks").mkdir(parents=True)
    for target in (".zshrc", ".zprofile", ".zshenv", ".bashrc", ".bash_profile", ".profile", ".gitconfig", ".ssh/config",
                   ".config/fish/config.fish", "Library/LaunchAgents/x.plist", "repo/.git/hooks/pre-commit",
                   ".local/bin/claude", ".claude/settings.json", ".cursor/cli-config.json", ".codex/config.toml", ".config/git/config", "Applications/x.app/y"):
        r = sh(box, f"mkdir -p \"$(dirname ~/{target})\" 2>/dev/null; echo x >> ~/{target}")
        assert r["exitCode"] != 0 and not (box.other / target).exists(), target
    assert sh(box, "echo x > ~/repo/.git/config && echo x > ~/notiz.txt")["exitCode"] == 0  # Kontrolle: normales Schreiben geht


def test_normal_work_still_runs(box):
    r = sh(box, f"echo hallo; echo x > {box.other}/f.txt && cat {box.other}/f.txt")
    assert r["exitCode"] == 0 and "hallo" in r["output"] and (box.other / "f.txt").read_text() == "x\n"
    assert sh(box, f"curl -sS -m 5 -o /dev/null http://localhost:{box.run_.ctx.cfg.port}/")["exitCode"] != 0  # Kontrolle: Dienst-Port gesperrt


def test_server_reachable_without_sandbox(box):
    # Kontrolle für den Port-Test: ohne Sperre geht dieselbe Anfrage durch
    import urllib.request
    assert urllib.request.urlopen(f"http://localhost:{box.run_.ctx.cfg.port}/", timeout=5).status == 200


def test_spawn_allows_service_and_security_but_locks_data(box):
    async def go(cmd, keychain=True):
        tree = await ProcessTree.spawn(["/bin/sh", "-c", cmd], box.other, dict(os.environ), keychain)
        out = [l async for l in tree.lines()]
        await tree.proc.wait()
        return tree.proc.returncode, out
    assert asyncio.run(go(f"cat {box.d}/secret.txt"))[0] != 0
    assert asyncio.run(go(f"cat {box.d}/uploads/a.txt")) == (0, ["anhang"])
    assert asyncio.run(go(f"curl -sS -m 5 -o /dev/null http://localhost:{box.run_.ctx.cfg.port}/"))[0] == 0
    assert asyncio.run(go("/usr/bin/security list-keychains >/dev/null"))[0] == 0
    assert asyncio.run(go("/usr/bin/security list-keychains >/dev/null", keychain=False))[0] != 0


def test_spawn_without_keychain_reaches_no_keychain_service(box):
    # Codex und Cursor: auch über die Programmierschnittstelle (JXA) kein Schlüsselbund, nicht nur ohne das Programm `security`
    js = box.other / "kc.js"
    js.write_text(KEYCHAIN_JS)

    async def go(keychain):
        tree = await ProcessTree.spawn(["/usr/bin/osascript", "-l", "JavaScript", str(js)], box.other, dict(os.environ), keychain)
        out = [l async for l in tree.lines()]
        await tree.proc.wait()
        return out
    assert asyncio.run(go(True)) == ["-25300"]  # Kontrolle: mit Schlüsselbund wird gefragt (Eintrag fehlt)
    assert asyncio.run(go(False)) != ["-25300"]


def test_which_programs_get_security():
    # Claude Code und Antigravity holen ihre Anmeldung per `security` aus dem Schlüsselbund (agy live belegt); Codex (~/.codex/auth.json) nicht, Cursor gesperrt bis live belegt
    assert claude.Claude.keychain and acp.Agy.keychain and acp.Cursor.keychain and not codex.Codex.keychain  # Cursor live belegt 13.11.
    assert codex.Codex.keychain_api  # Codex: nur die Dienste (live belegt)


def test_wrap_quotes_and_fallback(cfg, monkeypatch):
    weird = SimpleNamespace(data_dir=Path('/tmp/a "b"\\c'), port=1234, sandbox=True)
    p = sandbox.wrap(["x"], weird)[2]
    assert '"/private/tmp/a \\"b\\"\\\\c"' in p or '"/tmp/a \\"b\\"\\\\c"' in p
    monkeypatch.setattr(sandbox, "EXEC", "/nicht/da")
    assert sandbox.wrap(["x"], cfg) == ["x"]


def ae_permission(bundle: str) -> int:
    """Darf dieser Prozess Apple Events an die App senden? Fragt nie nach (askUserIfNeeded=false). 0 = ja, -1743/-1744 = nein, -600 = läuft nicht."""
    cs = ctypes.CDLL("/System/Library/Frameworks/CoreServices.framework/CoreServices")

    class AEDesc(ctypes.Structure):
        _fields_ = [("descriptorType", ctypes.c_uint32), ("dataHandle", ctypes.c_void_p)]
    code = lambda t: struct.unpack(">I", t.encode())[0]
    d, b = AEDesc(), bundle.encode()
    if cs.AECreateDesc(code("bund"), b, len(b), ctypes.byref(d)):
        return -1
    cs.AEDeterminePermissionToAutomateTarget.restype = ctypes.c_int32
    cs.AEDeterminePermissionToAutomateTarget.argtypes = [ctypes.POINTER(AEDesc), ctypes.c_uint32, ctypes.c_uint32, ctypes.c_ubyte]
    try:
        return cs.AEDeterminePermissionToAutomateTarget(ctypes.byref(d), code("****"), code("****"), 0)
    finally:
        cs.AEDisposeDesc(ctypes.byref(d))


def test_real_apple_event_reaches_allowed_finder_only(box):
    """Echt unter sandbox-exec: ein unsichtbares Apple Event (noop) an den immer laufenden Finder geht durch die Sperre, ohne Finder auf der Liste nicht.
    Befund 13.11.: Datenabfragen (z. B. `count windows`) lehnt Finder bei Absendern unter sandbox-exec selbst ab (-10004), auch ohne jede Regel."""
    allowed = ae_permission("com.apple.finder")
    if allowed != 0:
        pytest.skip(f"Automation-Recht für Finder fehlt oder Finder läuft nicht ({allowed}); keine Rückfrage ausgelöst")
    from orbitd.tools.mac.risk import app_bundle
    finder = app_bundle("Finder")
    assert finder == "com.apple.finder"
    argv = ["/usr/bin/osascript", "-e", 'tell application "Finder" to «event ascrnoop»']
    ok = asyncio.run(mac_tools.run(argv, launch=False, events=(finder,)))
    assert ok.exit_code == 0, ok.output
    blocked = asyncio.run(mac_tools.run(argv, launch=False, events=()))
    assert blocked.exit_code != 0  # Kontrolle: ohne Finder auf der Liste sperrt die Sperre


def test_separate_profile_has_no_keychain_and_a_file_only_security(cfg, monkeypatch, tmp_path):
    """Getrenntes Profil: kein Programm (auch nicht Claude) erreicht `security`, den Schlüsselbund-Ordner oder die Dienste.
    Claude bekommt im PATH einen Ersatz-`security`, der „kein Eintrag“ meldet; dann speichert Claude in .credentials.json."""
    from orbitd.cli.base import SECURITY_SHIM, profile_env
    monkeypatch.setenv("ORBIT_ISOLATED_PROFILE", "1")
    monkeypatch.setenv("ORBIT_DATA_DIR", str(tmp_path / "profil"))
    (tmp_path / "profil").mkdir()
    for name in ("claude", "cursor-agent", "agy"):
        rules = sandbox.wrap([f"/x/{name}"], cfg, allow_service=True, allow_security=True, keychain=True, cli=True)[2]
        assert 'process-exec (literal "/usr/bin/security")' in rules, name
        assert "(deny mach-lookup" in rules, name
        keychains = sandbox._q(Path.home() / "Library/Keychains")
        assert f"(deny file-read* file-write* (subpath {keychains}))" in rules, name
        assert f"(allow file-read* file-write* (subpath {keychains}))" not in rules, name
    codex_rules = sandbox.wrap(["/x/codex"], cfg, allow_service=True, keychain=True, cli=True)[2]
    assert "(deny mach-lookup" not in codex_rules and 'process-exec (literal "/usr/bin/security")' in codex_rules

    env = profile_env({"PATH": "/usr/bin:/bin"})
    shim = shutil.which("security", path=env["PATH"])
    assert shim == str((tmp_path / "profil").resolve() / sandbox.CLI_BIN / "security")
    assert Path(shim).read_text() == SECURITY_SHIM
    assert env["PATH"].split(os.pathsep)[0] == str(Path(shim).parent)
    # unter der echten Sperre: lesen/löschen -> 44 (kein Eintrag), schreiben -> 1, nie 36 (gesperrt), sofort
    def run(*args, stdin=None):
        argv = sandbox.wrap([shim, *args], cfg, allow_service=True, cli=True)
        return subprocess.run(argv, env=env, input=stdin, capture_output=True, timeout=5).returncode
    assert run("find-generic-password", "-a", "u", "-w", "-s", "Claude Code-credentials") == 44
    assert run("delete-generic-password", "-a", "u", "-s", "Claude Code-credentials") == 44
    assert run("-i", stdin=b"add-generic-password -U -a u -s s -X 00\n") == 1
    assert run("show-keychain-info") == 1
    real = sandbox.wrap(["/usr/bin/security", "list-keychains"], cfg, allow_service=True, cli=True)
    assert subprocess.run(real, env=env, capture_output=True, timeout=10).returncode != 0  # das echte bleibt gesperrt
