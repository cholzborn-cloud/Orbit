"""Mac-Werkzeuge, Rechte, Rückgängig, Routen. KEIN Test bedient den echten Mac: alle Systemprogramme laufen über die Attrappe
(`tools.run`), nur /bin/zsh (Shim-Tests) und /bin/sh laufen echt, in einem Ordner unter /tmp mit HOME unter /tmp."""
import asyncio
import json
import plistlib
import os
import shutil
from types import SimpleNamespace

import pytest
from jsonschema import Draft202012Validator

from orbitd.runtime.contract import TOOLS, Risk
from orbitd.tools.mac import permissions, tools, undo
from orbitd.tools.mac.jxa import JXA
from orbitd.web import Fail

REAL_RUN = tools.run
NAMES = tools.MAC_TOOL_NAMES


class Fake:
    """Attrappe für tools.run: merkt sich jeden Aufruf; `reply[<Programm>]` = Result oder Funktion(argv, kw) -> Result."""

    def __init__(self):
        self.calls, self.reply = [], {}

    async def __call__(self, argv, **kw):
        self.calls.append((argv, kw))
        if argv[0] == "/bin/zsh":  # nur für die Shim-Tests: echte Shell, aber HOME und cwd liegen unter /tmp
            assert kw["env"]["HOME"].startswith("/private/tmp/") and str(kw["cwd"]).startswith("/private/tmp/")
            return await REAL_RUN(argv, **kw)
        r = self.reply.get(os.path.basename(argv[0]), tools.Result(0, ""))
        return r(argv, kw) if callable(r) else r

    def last(self, prog):
        return next((a, k) for a, k in reversed(self.calls) if os.path.basename(a[0]) == prog)


@pytest.fixture
def home(data_dir, monkeypatch):
    h = data_dir.resolve().parent / f"{data_dir.name}-home"  # /tmp ist unter macOS ein Link auf /private/tmp; der Shim meldet echte Pfade. Neben dem Datenordner: darin sperrt ihn die Systemsperre.
    h.mkdir()
    monkeypatch.setattr(undo, "home", lambda: h)
    monkeypatch.setattr(permissions, "_automation", {})
    monkeypatch.setattr(permissions, "_disk_requested", False)
    yield h
    shutil.rmtree(h, ignore_errors=True)  # nur der eigene Wegwerf-Ordner


@pytest.fixture
def sys_(home, monkeypatch):
    f = Fake()
    monkeypatch.setattr(tools, "run", f)
    return f


@pytest.fixture
def run_(ctx, sys_):
    return SimpleNamespace(ctx=ctx, bot={"name": "Nova"}, chat_kind="direct", chat_id="chat1", counters={})


def call(run_, tool_name, /, **args):
    Draft202012Validator(TOOLS[tool_name].schema).validate(args)
    return asyncio.run(TOOLS[tool_name].handler(run_, args))


def fails(run_, tool_name, /, **args):
    with pytest.raises(Fail) as e:
        call(run_, tool_name, **args)
    return e.value.error


def jxa(sys_, text, prog="osascript"):
    sys_.reply[prog] = tools.Result(0, text if isinstance(text, str) else json.dumps(text))


def undo_rows(ctx):
    return ctx.db.all("SELECT * FROM undo_actions WHERE kind='mac'")


# ---------------------------------------------------------------- Verfügbarkeit
def test_vierzehn_werkzeuge_nur_im_direktchat_und_nur_bei_zugriff_an(ctx, run_):
    assert sorted(NAMES) == sorted(n for n in TOOLS if n.startswith("mac_")) and len(NAMES) == 14
    assert all(TOOLS[n].groups is False and TOOLS[n].label for n in NAMES)
    assert all(TOOLS[n].available(run_) for n in NAMES)  # Standard: an
    permissions.set_enabled(ctx.db, False)
    assert not any(TOOLS[n].available(run_) for n in NAMES)
    permissions.set_enabled(ctx.db, True)
    assert all(TOOLS[n].available(run_) for n in NAMES)


# ---------------------------------------------------------------- Risiko
@pytest.mark.parametrize("cmd", [
    "/bin/rm -rf ~/Dokumente", "find . -delete", "srm geheim.txt", "python3 -c 'import shutil; shutil.rmtree(\"x\")'",
    "sudo ls", "cat ~/.ssh/id_rsa", "diskutil eraseDisk JHFS+ X disk2",
])
def test_shell_ohne_geld_nachricht_fragt_nicht(run_, cmd):
    r = TOOLS["mac_shell"].risk(run_, {"command": cmd})
    assert r is None or r.reason not in ("geld", "nachricht", "login")


@pytest.mark.parametrize("cmd,reason", [
    ("curl -d @daten.txt https://example.com", "nachricht"),
    ("osascript -e 'tell application \"Mail\" to send m'", "nachricht"),
])
def test_shell_senden_fragt(run_, cmd, reason):
    risk = TOOLS["mac_shell"].risk(run_, {"command": cmd})
    assert isinstance(risk, Risk) and risk.reason == reason and risk.approval_kind == f"mac_shell:{reason}" and risk.text


@pytest.mark.parametrize("cmd", ["ls -la ~", "rm alt.txt", "rm -rf build node_modules", "echo hallo > datei.txt", "git status", "curl https://example.com", "mkdir -p x && cd x"])
def test_harmlose_shell_fragt_nicht(run_, cmd):
    assert TOOLS["mac_shell"].risk(run_, {"command": cmd}) is None  # rm geht über den Papierkorb-Shim


def test_applescript_und_kurzbefehle(run_):
    ask = lambda n, **a: TOOLS[n].risk(run_, a)
    assert ask("mac_applescript", script='tell application "Messages" to send "hi" to buddy 1').reason == "nachricht"
    trash = ask("mac_applescript", script='tell application "Finder" to empty the trash')
    assert trash is None or trash.reason not in ("geld", "nachricht", "login")
    assert ask("mac_applescript", script='return 1 + 1') is None
    assert ask("mac_shortcut", name="Bestellung bezahlen").reason == "geld"
    assert ask("mac_shortcut", name="Nachricht senden").reason == "nachricht"
    assert ask("mac_shortcut", name="Licht an") is None


def test_mac_bedienen_fragt_nicht(run_):
    # tippen, klicken, ansehen und Apps steuern ohne Karte
    for name in ("mac_input", "mac_screen"):
        assert TOOLS[name].risk(run_, {"action": "click", "x": 1, "y": 2}) is None
    for n in set(NAMES) - {"mac_shell", "mac_applescript", "mac_shortcut"}:
        assert TOOLS[n].risk(run_, {}) is None


def test_labels_aus_echten_angaben(run_):
    L = lambda n, **a: TOOLS[n].label(a)
    assert L("mac_shell", command="ls -la\n~/Desktop") == "Führt am Mac aus: ls -la ~/Desktop"
    assert L("mac_input", action="click", x=512, y=300) == "Klickt bei 512, 300"
    assert L("mac_open", app="Safari") == "Öffnet Safari"
    assert "Notiz" in L("mac_notes", action="create", title="Einkauf") and "Einkauf" in L("mac_notes", action="create", title="Einkauf")
    assert all(TOOLS[n].label({}) for n in NAMES)


# ---------------------------------------------------------------- Shell und Papierkorb-Shim (echt, unter /tmp)
def test_shell_rm_landet_im_papierkorb_und_ist_umkehrbar(ctx, run_, home):
    (home / "a.txt").write_text("alt")
    r = call(run_, "mac_shell", command="rm a.txt && echo fertig")
    assert r["exitCode"] == 0 and "fertig" in r["output"] and r["trashed"] == [str(home / "a.txt")]
    assert not (home / "a.txt").exists() and (home / ".Trash" / "a.txt").read_text() == "alt"
    assert asyncio.run(undo.undo_mac(ctx.db, r["undoId"])) == "1 Objekt(e) zurückgelegt."
    assert (home / "a.txt").read_text() == "alt" and not undo_rows(ctx)


def test_shell_srm_shred_und_home_sind_gesperrt(run_, home):
    (home / "x").write_text("1")
    for cmd in ("srm x", "shred x", "rm -rf ~", "rm -rf ~/.Trash"):
        r = call(run_, "mac_shell", command=cmd)
        assert r["exitCode"] == 1 and "undoId" not in r
    assert (home / "x").read_text() == "1" and home.exists()


def test_shell_fehlerfaelle(run_, home):
    r = call(run_, "mac_shell", command="echo boese >&2; exit 3")
    assert r["exitCode"] == 3 and "boese" in r["output"] and "undoId" not in r
    r = call(run_, "mac_shell", command="sleep 5", timeout=1)
    assert r["timedOut"] is True
    assert call(run_, "mac_shell", command="pwd", cwd="~")["output"].strip() == str(home)


def test_run_begrenzt_ausgabe_und_schwaerzt_geheimnisse():
    r = asyncio.run(REAL_RUN(["/bin/sh", "-c", "yes x | head -c 50000"]))
    assert len(r.output) < 10_100 and r.output.startswith("…(gekürzt)")
    r = asyncio.run(REAL_RUN(["/bin/sh", "-c", "echo API_TOKEN=abcdef1234567890xyz"]))
    assert "abcdef1234567890xyz" not in r.output
    assert asyncio.run(REAL_RUN(["/nicht/da"])).exit_code == 127


# ---------------------------------------------------------------- Dateien
def test_files_schreiben_ueberschreiben_und_zurueck(ctx, run_, home):
    p = str(home / "n.txt")
    r1 = call(run_, "mac_files", action="write", path=p, content="eins")
    assert r1["written"] == 4 and "previousInTrash" not in r1
    r2 = call(run_, "mac_files", action="write", path=p, content="zwei")
    assert (home / ".Trash" / "n.txt").read_text() == "eins" and r2["previousInTrash"].endswith("n.txt")
    assert asyncio.run(undo.undo_mac(ctx.db, r2["undoId"])) == "Alte Fassung wiederhergestellt." and (home / "n.txt").read_text() == "eins"
    assert asyncio.run(undo.undo_mac(ctx.db, r1["undoId"])) == "Angelegte Datei in den Papierkorb gelegt." and not (home / "n.txt").exists()
    assert not undo_rows(ctx)


def test_files_lesen_anhaengen_listen_suchen(run_, home, sys_):
    (home / "t.txt").write_text("hallo")
    (home / "b.bin").write_bytes(b"\0\1\2")
    (home / "ordner").mkdir()
    assert call(run_, "mac_files", action="read", path="~/t.txt")["content"] == "hallo"
    assert call(run_, "mac_files", action="read", path=str(home / "b.bin"))["binary"] is True
    assert call(run_, "mac_files", action="append", path=str(home / "t.txt"), content="!")["appended"] == 1
    assert (home / "t.txt").read_text() == "hallo!"
    assert sorted(call(run_, "mac_files", action="list", path="~")["entries"]) == ["b.bin", "ordner/", "t.txt"]
    sys_.reply["mdfind"] = tools.Result(0, "2026-11-13 00:38:13.362 mdfind[1:2] [UserQueryParser] Loading keywords\n/a\n/b\n/c\n")
    assert call(run_, "mac_files", action="search", query="Rechnung", path="~", limit=2)["results"] == ["/a", "/b"]
    assert sys_.last("mdfind")[0] == ["/usr/bin/mdfind", "-onlyin", str(home), "Rechnung"]


def test_files_verschieben_und_papierkorb_umkehrbar(ctx, run_, home):
    (home / "a").write_text("A")
    m = call(run_, "mac_files", action="move", path="~/a", to="~/neu/b")
    assert (home / "neu" / "b").read_text() == "A" and not (home / "a").exists()
    asyncio.run(undo.undo_mac(ctx.db, m["undoId"]))
    assert (home / "a").read_text() == "A"
    (home / "c").write_text("C")
    t = call(run_, "mac_files", action="trash", paths=["~/a", "~/c"])
    assert t["trashed"] == [str(home / "a"), str(home / "c")] and sorted(os.listdir(home / ".Trash")) == ["a", "c"]
    asyncio.run(undo.undo_mac(ctx.db, t["undoId"]))
    assert (home / "a").read_text() == "A" and (home / "c").read_text() == "C"


def test_files_fehlerfaelle(run_, home):
    (home / "a").write_text("A")
    (home / "b").write_text("B")
    assert "Ziel existiert schon" in fails(run_, "mac_files", action="move", path="~/a", to="~/b")
    assert "fehlt" in fails(run_, "mac_files", action="read")
    assert "fehlt" in fails(run_, "mac_files", action="trash")
    assert "No such file" in fails(run_, "mac_files", action="read", path="~/gibtsnicht")
    (home / ".Trash").mkdir()
    assert "Papierkorb" in fails(run_, "mac_files", action="trash", paths=["~/.Trash"])
    assert (home / "a").read_text() == "A" and (home / "b").read_text() == "B"


# ---------------------------------------------------------------- Rückgängig: Eintrag bleibt bei gescheiterter Umkehr
def test_undo_eintrag_bleibt_wenn_umkehr_scheitert(ctx, run_, home):
    (home / "a").write_text("alt")
    t = call(run_, "mac_files", action="trash", paths=["~/a"])
    (home / "a").write_text("neu")  # am alten Ort liegt schon etwas
    with pytest.raises(Fail, match="Am alten Ort"):
        asyncio.run(undo.undo_mac(ctx.db, t["undoId"]))
    assert len(undo_rows(ctx)) == 1
    (home / "a").unlink()
    asyncio.run(undo.undo_mac(ctx.db, t["undoId"]))
    assert (home / "a").read_text() == "alt" and not undo_rows(ctx)


def test_undo_kalender_bleibt_bei_fehler(ctx, run_, sys_):
    jxa(sys_, {"id": "EV1", "calendar": "Privat"})
    c = call(run_, "mac_calendar", action="create", title="Zahnarzt", start="2026-11-12T10:00:00Z")
    sys_.reply["osascript"] = tools.Result(1, "boom")
    with pytest.raises(Fail):
        asyncio.run(undo.undo_mac(ctx.db, c["undoId"]))
    assert len(undo_rows(ctx)) == 1
    jxa(sys_, {"ok": True})
    assert asyncio.run(undo.undo_mac(ctx.db, c["undoId"])) == "Termin entfernt."
    assert json.loads(sys_.last("osascript")[0][-1]) == {"id": "EV1"} and sys_.last("osascript")[0][4] == JXA["calendarDelete"] and not undo_rows(ctx)


# ---------------------------------------------------------------- Öffnen, AppleScript, Kurzbefehle
def test_open(run_, sys_, home):
    assert call(run_, "mac_open", app="Safari", target="https://example.com") == {"ok": True}
    assert sys_.last("open")[0] == ["/usr/bin/open", "-a", "Safari", "https://example.com"]
    call(run_, "mac_open", target="~/x.pdf")
    assert sys_.last("open")[0][-1] == str(home / "x.pdf")
    assert "fehlt" in fails(run_, "mac_open")
    sys_.reply["open"] = tools.Result(1, "The file does not exist.")
    assert "does not exist" in fails(run_, "mac_open", app="Nix")


TERMINAL_SCRIPTS = ['tell application "Terminal" to do script "ls"', 'tell app "iTerm2" to activate', 'Application("Terminal").doScript("ls")',
                    "Application('Script Editor')", 'tell application id "com.apple.Terminal" to activate', 'tell application "Automator" to activate',
                    'tell application "Shortcuts Events" to run shortcut "x"', 'do shell script "shortcuts run Hallo"', 'tell application "Terminal.app" to activate']


@pytest.mark.parametrize("script", TERMINAL_SCRIPTS)
def test_applescript_terminal_hart_abgelehnt(run_, script):
    with pytest.raises(Fail):
        TOOLS["mac_applescript"].risk(run_, {"script": script})


@pytest.mark.parametrize("script", [
    'tell application "Safari" to do shell script "touch /tmp/x"', 'Application("Finder").doShellScript("id")',
    'tell application "Music"\n run script "do shell script \\"id\\""\nend tell', 'tell application "Safari" to load script file "x"',
    'tell application "Finder" to system attribute "HOME"', 'Application("Safari").runScript("x")',
    'tell application "Safari" to «event sysoexec» "id"', 'set a to "Fin" & "der"\ntell application a to do shell script "id"',
    'tell application "Xcode" to activate', 'tell application "Visual Studio Code" to activate', 'tell application "Warp" to activate',
    'var f = Application("Finder"); f["doShell" + "Script"]("id")', 'Application("Finder"); eval("x")', 'Application("Safari"); new Function("x")()',
    'ObjC.import("Foundation"); Application("Finder").activate()', 'Application("Notes"); $.NSTask.alloc', 'use framework "Foundation"\ntell application "Finder" to activate',
    'tell application "TextEdit" to activate\nset f to open for access POSIX file "/tmp/x" with write permission',
    'tell application "TextEdit" to activate\nwrite "x" to f', 'tell application "Notes" to activate\nstore script s in "/tmp/x"',
    'Application("TextEdit"); app.openForAccess("/tmp/x")',
    'tell application "Notes" to do ¬\nshell script "id"', 'tell application "Notes" to activate\nwrite "x" ¬\nto f',
    'tell application "Notes" to <<event sysoexec>> "id"', 'tell application "Safari" to open location "file:///System/Applications/Utilities/Terminal.app"',
    'tell application "Notes" to activate\nread POSIX file "/etc/hosts"',
    'Application("Ghostty").activate()', 'tell application id "com.microsoft.VSCode" to activate'])
def test_applescript_fremde_app_mit_befehl_oder_code_app_hart_abgelehnt(run_, script):
    with pytest.raises(Fail):
        TOOLS["mac_applescript"].risk(run_, {"script": script})


def test_applescript_ohne_fremde_app_darf_shell(run_):
    r = TOOLS["mac_applescript"].risk(run_, {"script": 'do shell script "echo hi"'})  # läuft in osascript selbst, unter der Sperre
    assert r is None


@pytest.mark.parametrize("a", [{"app": "~/Downloads/x.app"}, {"app": "/tmp/boese.app"}, {"app": "GibtEsNichtXyz"}, {"app": "../x"},
                               {"app": "Xcode"}, {"app": "Visual Studio Code"}, {"app": "Cursor"}, {"app": "Warp", "target": "~/a.txt"}])
def test_open_lehnt_code_apps_ab(run_, a):
    with pytest.raises(Fail):
        TOOLS["mac_open"].risk(run_, a)


@pytest.mark.parametrize("script,kind", [
    ('tell application "Safari" to get URL of front document', "mac_applescript:app:Safari"),
    ('Application("Music").play()', "mac_applescript:app:Music"),
    ('tell application "Safari" to activate\ntell application "Music" to play', "mac_applescript:app:Music+Safari"),
    ('tell application "Finder" to count windows', "mac_applescript:app:Finder:einmal"),
    ('tell application "System Events" to keystroke "a"', "mac_applescript:app:System Events:einmal"),
    ('set a to "Saf" & "ari"\ntell application a to activate', "mac_applescript:app:?:einmal"),
    ('Application("Saf" + "ari").activate()', "mac_applescript:app:?:einmal"),
    ('tell application "Notizen" to count notes', "mac_applescript:app:Notizen"),
    ('tell application "Systemeinstellungen" to activate', "mac_applescript:app:Systemeinstellungen"),
])
def test_applescript_karte_je_app(run_, script, kind):
    # freie Skripte an Apps: Risk möglich (Deny), aber keine Freigabe-Gründe
    r = TOOLS["mac_applescript"].risk(run_, {"script": script})
    assert r is None or r.reason not in ("geld", "nachricht", "login")


def test_app_namen_deutsch_spotlight_und_unbekannt(run_, sys_, home, monkeypatch):
    from orbitd.tools.mac import risk
    assert risk.app_bundle("Notizen") == "com.apple.Notes" and risk.app_bundle("Kalender") == "com.apple.iCal"
    app = home / "Werkzeuge" / "Mein Ding.app" / "Contents"  # App in einem Unterordner: nur Spotlight findet sie
    app.mkdir(parents=True)
    (app / "Info.plist").write_bytes(plistlib.dumps({"CFBundleIdentifier": "de.test.meinding"}))
    monkeypatch.setattr(risk, "_found", {})
    monkeypatch.setattr(risk, "_spotlight", lambda name: [str(app.parent)] if name == "Mein Ding" else [])
    sys_.reply["osascript"] = tools.Result(0, "")
    call(run_, "mac_applescript", script='tell application "Mein Ding" to activate')
    assert sys_.last("osascript")[1]["events"] == ("de.test.meinding",)
    calls = len(sys_.calls)
    err = fails(run_, "mac_applescript", script='tell application "GibtEsNichtXyz" to activate')
    assert "nicht gefunden" in err and "Mac-Zugriff" not in err and len(sys_.calls) == calls  # nichts ausgeführt, kein Rechte-Hinweis
    with pytest.raises(Fail, match="nicht gefunden"):
        TOOLS["mac_applescript"].risk(run_, {"script": 'tell application "GibtEsNichtXyz" to activate'})


def test_applescript_sperre_nur_fuer_genannte_apps(run_, sys_):
    sys_.reply["osascript"] = tools.Result(0, "")
    call(run_, "mac_applescript", script='tell application "Safari" to activate')
    assert sys_.last("osascript")[1]["events"] == ("com.apple.Safari",) and sys_.last("osascript")[1]["launch"] is False
    call(run_, "mac_applescript", script='return 1')
    assert sys_.last("osascript")[1]["events"] == ()
    call(run_, "mac_applescript", script='set a to "Saf" & "ari"\ntell application a to activate')
    assert sys_.last("osascript")[1]["events"] is True  # berechnet: unter der Sperre an alle außer Terminal & Co. (sandbox.NO_EVENTS)
    sys_.reply["osascript"] = tools.Result(1, 'execution error: Falsche Zugriffsrechte auf die Datei. (-54)')
    assert "mac_open" in call(run_, "mac_applescript", script='tell application "Safari" to activate')["hint"]


@pytest.mark.parametrize("a", [{"target": "/tmp/x.command"}, {"target": "~/a.sh"}, {"target": "/Applications/Safari.app"}, {"target": "~/x.workflow"},
                               {"target": "~/x.scpt"}, {"target": "~/x.terminal"}, {"target": "~/x.tool"}, {"app": "Terminal"}, {"app": "iTerm"},
                               {"app": "/System/Applications/Utilities/Terminal.app"}, {"app": "Terminal", "target": "~/a.txt"},
                               {"target": "file:///tmp/x%20y.command"}, {"target": "ssh://localhost"}, {"target": "x-man-page://ls"}])
def test_open_lehnt_code_und_terminal_ab(run_, a):
    with pytest.raises(Fail):
        TOOLS["mac_open"].risk(run_, a)


def test_open_nur_erlaubnisliste(run_, sys_, home):
    risk = lambda t: TOOLS["mac_open"].risk(run_, {"target": t})
    (home / "Ordner").mkdir()
    (home / "Paket.app" / "Contents").mkdir(parents=True)
    (home / "a.pdf").write_text("x")
    os.symlink(home / "a.pdf", home / "verweis.pdf")
    os.symlink(home / "Ordner", home / "ordner-verweis")
    os.symlink(home / "weg.pdf", home / "kaputt.pdf")
    os.symlink(home / "a.pdf", home / "tarnung.jar")
    (home / "alias.pdf").write_bytes(b"book\0\0\0\0mark")  # Finder-Alias, getarnt als PDF
    (home / "gut.webloc").write_bytes(plistlib.dumps({"URL": "https://example.com"}))
    (home / "boese.webloc").write_bytes(plistlib.dumps({"URL": "ssh://localhost"}))
    (home / "daten.webloc").write_bytes(plistlib.dumps({"URL": "https://example.com/?d=geheim"}))
    for ok in ("a.pdf", "verweis.pdf", "Ordner", "ordner-verweis", "Bild.HEIC", "Film.mov", "Liste.xlsx", "Paket.zip", "gut.webloc"):
        assert risk(str(home / ok)) is None, ok
    for bad in ("x.fileloc", "x.jar", "x.unbekannt", "ohne-endung", "Paket.app", "kaputt.pdf", "tarnung.jar", "alias.pdf", "boese.webloc",
                "x.dmg", "x.pkg", "x.html", "x.svg", "x.docm"):
        with pytest.raises(Fail):
            risk(str(home / bad))
    for bad in ("tel:123", "facetime:x", "javascript:alert(1)", "vnc://host", "smb://host/share"):
        with pytest.raises(Fail):
            risk(bad)
    assert risk(str(home / "daten.webloc")).reason == "nachricht"  # Adresse im Lesezeichen wird wie eine Adresse geprüft
    assert risk("mailto:a@b.de") is None and risk("https://example.com") is None
    call(run_, "mac_open", target=str(home / "Paket.zip"), app="Archive Utility")
    assert sys_.last("open")[0] == ["/usr/bin/open", "-R", str(home / "Paket.zip")]  # Archive nur zeigen, nicht entpacken


def test_open_lehnt_ausfuehrbare_datei_ohne_endung_ab(run_, home):
    (home / "werkzeug").write_text("#!/bin/sh\n")
    (home / "werkzeug").chmod(0o755)
    with pytest.raises(Fail):
        TOOLS["mac_open"].risk(run_, {"target": str(home / "werkzeug")})
    assert TOOLS["mac_open"].risk(run_, {"target": str(home / "notiz.txt")}) is None


def test_shell_und_kurzbefehle_starten_nichts(run_, sys_):
    call(run_, "mac_shortcut")
    call(run_, "mac_shortcut", name="Licht an")
    assert all(k["launch"] is False and k["events"] == () for a, k in sys_.calls if os.path.basename(a[0]) == "shortcuts")
    call(run_, "mac_shell", command="echo hi")
    assert sys_.last("zsh")[1]["launch"] is False and sys_.last("zsh")[1]["events"] == ()


def test_applescript(run_, sys_):
    sys_.reply["osascript"] = tools.Result(0, "42")
    r = call(run_, "mac_applescript", script='tell application "Finder" to count windows')
    assert r == {"exitCode": 0, "output": "42"} and sys_.last("osascript")[0][:3] == ["/usr/bin/osascript", "-l", "AppleScript"]
    sys_.reply["osascript"] = tools.Result(1, "execution error: Not authorized to send Apple events to Finder. (-1743)")
    r = call(run_, "mac_applescript", script='tell application "Finder" to count windows', language="AppleScript")
    assert r["exitCode"] == 1 and "Mac-Zugriff anfragen" in r["hint"] and permissions._automation["Finder"] == "missing"


def test_shortcut(run_, sys_):
    sys_.reply["shortcuts"] = tools.Result(0, "Licht an\nLicht aus\n")
    assert call(run_, "mac_shortcut")["shortcuts"] == ["Licht an", "Licht aus"]

    def runner(argv, kw):
        assert open(argv[argv.index("-i") + 1]).read() == "Eingabe"
        open(argv[argv.index("-o") + 1], "w").write("Ergebnis")
        return tools.Result(0, "")
    sys_.reply["shortcuts"] = runner
    assert call(run_, "mac_shortcut", name="Test", input="Eingabe") == {"exitCode": 0, "output": "Ergebnis"}
    sys_.reply["shortcuts"] = tools.Result(1, "Couldn't find shortcut")
    assert call(run_, "mac_shortcut", name="Nix")["exitCode"] == 1


# ---------------------------------------------------------------- Bildschirm, Maus, Tastatur, Zwischenablage, Mitteilung
def test_screen(run_, sys_, ctx):
    jxa(sys_, {"width": 1512.0, "height": 982.0})
    sys_.reply["screencapture"] = lambda argv, kw: (open(argv[-1], "wb").write(b"jpg"), tools.Result(0, ""))[1]
    r = call(run_, "mac_screen")
    assert (r["width"], r["height"], r["mediaType"]) == (1512, 982, "image/jpeg") and r["path"].startswith(str(ctx.cfg.data_dir))
    assert sys_.last("screencapture")[0][:4] == ["/usr/sbin/screencapture", "-x", "-m", "-t"] and sys_.last("screencapture")[1].get("sandboxed") is False  # schreibt in den gesperrten Datenordner
    assert sys_.last("sips")[0][:5] == ["/usr/bin/sips", "-z", "982", "1512", "-s"]
    assert r["_images"] == [{"data": "anBn", "mimeType": "image/jpeg"}]  # Bild der Datei (b"jpg") als Bildblock für die Brücke
    sys_.reply["screencapture"] = tools.Result(1, "")
    assert "nicht erlaubt" in fails(run_, "mac_screen")


def front(bundle, name):
    return lambda argv, kw: tools.Result(0, "ASN:0x0-0x1:" if argv[1] == "front" else f'"bundleID"="{bundle}"\n"name"="{name}"')


@pytest.mark.parametrize("bundle,name", [("com.apple.Terminal", "Terminal"), ("com.googlecode.iterm2", "iTerm2"), ("com.microsoft.VSCode", "Code"),
                                         ("dev.warp.Warp-Stable", "Warp"), ("", ""), ("x.y.ghostty", "Ghostty")])
def test_input_nie_ins_terminal(run_, sys_, bundle, name):
    sys_.reply["lsappinfo"] = front(bundle, name)
    for a in ({"action": "type", "text": "rm -rf ~"}, {"action": "key", "key": "return"}, {"action": "click", "x": 1, "y": 1}):
        assert "Terminal" in fails(run_, "mac_input", **a)
    assert not any(os.path.basename(c[0][0]) == "osascript" for c in sys_.calls)


def test_input(run_, sys_):
    sys_.reply["lsappinfo"] = front("com.apple.TextEdit", "TextEdit")
    call(run_, "mac_input", action="click", x=512, y=300)
    argv = sys_.last("osascript")[0]
    assert argv[4] == JXA["mouse"] and json.loads(argv[5]) == {"action": "click", "x": 512, "y": 300, "button": "left"}
    call(run_, "mac_input", action="right", x=1, y=2)
    assert json.loads(sys_.last("osascript")[0][5])["button"] == "right"
    call(run_, "mac_input", action="type", text="Hallo")
    argv = sys_.last("osascript")[0]
    assert argv[4] == JXA["keyboard"] and json.loads(argv[5]) == {"text": "Hallo"}
    call(run_, "mac_input", action="key", key="Return", modifiers=["command"])
    assert json.loads(sys_.last("osascript")[0][5]) == {"keyCode": 36, "modifiers": ["command"]}
    call(run_, "mac_input", action="key", key="a", modifiers=["command"])
    assert json.loads(sys_.last("osascript")[0][5]) == {"key": "a", "modifiers": ["command"]}
    assert "„x“ und „y“" in fails(run_, "mac_input", action="click")
    assert "toX" in fails(run_, "mac_input", action="drag", x=1, y=1)
    sys_.reply["osascript"] = tools.Result(1, "execution error: Not authorized to send Apple events to System Events. (-1743)")
    assert "Mac-Zugriff anfragen" in fails(run_, "mac_input", action="type", text="x")


def test_clipboard(run_, sys_):
    sys_.reply["pbpaste"] = tools.Result(0, "Inhalt")
    assert call(run_, "mac_clipboard", action="read") == {"text": "Inhalt"}
    assert call(run_, "mac_clipboard", action="write", text="neu") == {"ok": True} and sys_.last("pbcopy")[1]["input"] == "neu"
    sys_.reply["pbcopy"] = tools.Result(1, "")
    assert call(run_, "mac_clipboard", action="write", text="x") == {"ok": False}


def test_notify(run_, sys_):
    assert call(run_, "mac_notify", title="Hi", text="Welt") == {"ok": True}
    assert json.loads(sys_.last("osascript")[0][5]) == {"title": "Hi", "text": "Welt"}
    sys_.reply["osascript"] = tools.Result(1, "kaputt")
    assert fails(run_, "mac_notify", title="a", text="b") == "kaputt"
    sys_.reply["osascript"] = tools.Result(1, "", timed_out=True)
    assert fails(run_, "mac_notify", title="a", text="b") == "Zeitlimit erreicht."


# ---------------------------------------------------------------- Kalender, Erinnerungen, Kontakte, Notizen, Browser
def test_calendar(ctx, run_, sys_):
    jxa(sys_, [{"title": "Termin"}])
    assert call(run_, "mac_calendar", action="list", calendar="Privat", limit=5) == {"events": [{"title": "Termin"}]}
    args = json.loads(sys_.last("osascript")[0][5])
    assert args["calendar"] == "Privat" and args["limit"] == 5 and args["from"] < args["to"]
    jxa(sys_, {"id": "E1", "calendar": "Privat"})
    r = call(run_, "mac_calendar", action="create", title="Zahnarzt", start="2026-11-12T10:00:00Z")
    assert r["id"] == "E1" and r["undoId"] and json.loads(sys_.last("osascript")[0][5])["end"] == "2026-11-12T11:00:00.000Z"
    assert "title" in fails(run_, "mac_calendar", action="create")
    assert "kein gültiges Datum" in fails(run_, "mac_calendar", action="create", title="x", start="morgen")
    assert len(undo_rows(ctx)) == 1


def test_reminders(ctx, run_, sys_):
    jxa(sys_, [{"title": "Milch"}])
    assert call(run_, "mac_reminders", action="list")["reminders"] == [{"title": "Milch"}]
    assert json.loads(sys_.last("osascript")[0][5]) == {"list": None, "done": False, "limit": 200}
    jxa(sys_, {"id": "R1", "list": "Einkauf"})
    c = call(run_, "mac_reminders", action="create", title="Brot")
    assert c["id"] == "R1" and c["undoId"]
    jxa(sys_, {"id": "R1", "before": False})
    d = call(run_, "mac_reminders", action="complete", id="R1")
    assert d["ok"] and d["undoId"]
    jxa(sys_, {"ok": True})
    assert asyncio.run(undo.undo_mac(ctx.db, d["undoId"])) == "Erinnerung zurückgesetzt."
    assert json.loads(sys_.last("osascript")[0][5]) == {"id": "R1", "done": False}
    assert "„id“" in fails(run_, "mac_reminders", action="complete")
    assert "„title“" in fails(run_, "mac_reminders", action="create")


def test_contacts(run_, sys_):
    jxa(sys_, [{"name": "Max"}])
    assert call(run_, "mac_contacts", query="Max") == {"contacts": [{"name": "Max"}]}
    assert json.loads(sys_.last("osascript")[0][5]) == {"query": "Max", "limit": 20}
    sys_.reply["osascript"] = tools.Result(1, "Not authorized to send Apple events to Contacts. (-1743)")
    assert "Mac-Zugriff anfragen" in fails(run_, "mac_contacts", query="x") and permissions._automation["Contacts"] == "missing"


def test_notes(ctx, run_, sys_):
    jxa(sys_, [{"title": "N"}])
    assert call(run_, "mac_notes", action="search", query="N")["notes"] == [{"title": "N"}]
    call(run_, "mac_notes", action="read", query="N")
    assert json.loads(sys_.last("osascript")[0][5]) == {"query": "N", "full": True, "limit": 1}
    jxa(sys_, {"id": "N1"})
    c = call(run_, "mac_notes", action="create", title="Einkauf", text="Milch")
    assert c["id"] == "N1" and c["undoId"]
    assert "„title“" in fails(run_, "mac_notes", action="create")


def test_browser(run_, sys_):
    jxa(sys_, {"ok": True})
    assert call(run_, "mac_browser", action="open", url="https://example.com") == {"ok": True}
    assert json.loads(sys_.last("osascript")[0][5]) == {"app": "Safari", "url": "https://example.com", "newTab": False}
    jxa(sys_, {"url": "https://example.com", "title": "Ex", "text": "Seite password=geheim12345678"})
    r = call(run_, "mac_browser", action="read", app="Google Chrome")
    assert r["title"] == "Ex" and "geheim12345678" not in r["text"]
    assert json.loads(sys_.last("osascript")[0][5])["app"] == "Google Chrome"
    jxa(sys_, {"error": "Safari ist nicht offen."})
    assert fails(run_, "mac_browser", action="read") == "Safari ist nicht offen."
    assert "„url“" in fails(run_, "mac_browser", action="open")


# ---------------------------------------------------------------- Rechte und Routen
def test_access_route(client, sys_, home, monkeypatch):
    monkeypatch.setattr(permissions, "_preflight", lambda *_: "missing")
    r = client.get("/v1/mac/access").json()
    assert r["enabled"] is True and [p["id"] for p in r["permissions"]] == [p[0] for p in permissions.PERMISSIONS]
    for p in r["permissions"]:
        assert set(p) == {"id", "label", "status", "settingsUrl", "detail"} and p["status"] in ("granted", "missing", "unknown") and p["detail"].endswith(".")
    by = {p["id"]: p for p in r["permissions"]}
    assert by["screen"]["status"] == by["accessibility"]["status"] == "missing" and by["full_disk"]["status"] == "unknown"
    assert sys_.calls == []
    assert by["automation_notes"]["settingsUrl"].endswith("Privacy_Automation") and by["screen"]["label"] == "Bildschirmaufnahme"
    assert client.post("/v1/mac/access", json={"enabled": False}).json() == {"ok": True, "enabled": False}
    assert client.get("/v1/mac/access").json()["enabled"] is False
    bad = client.post("/v1/mac/access", json={"enabled": "ja"})
    assert bad.status_code == 400 and bad.json() == {"ok": False, "error": "enabled fehlt."}


def test_permission_request_route(client, sys_, home):
    sys_.reply["screencapture"] = tools.Result(1, "")
    sys_.reply["osascript"] = tools.Result(0, "3")
    r = client.post("/v1/mac/permissions/request", json={"id": "automation_notes"}).json()
    assert r["ok"] and r["permission"]["id"] == "automation_notes" and r["permission"]["status"] == "granted"
    assert any("com.apple.Notes" in a[-1] for a, _ in sys_.calls)
    r = client.post("/v1/mac/permissions/request", json={"id": "screen"}).json()
    assert r["permission"]["id"] == "screen"
    client.post("/v1/mac/permissions/request", json={"id": "full_disk"})
    assert any(a == ["/usr/bin/open", permissions.PRIVACY + "AllFiles"] for a, _ in sys_.calls)
    bad = client.post("/v1/mac/permissions/request", json={"id": "gibtsnicht"})
    assert bad.status_code == 400 and bad.json() == {"ok": False, "error": "Unbekannte Berechtigung."}


def test_installed_permission_requests_never_use_osascript_or_screencapture(client, sys_, monkeypatch):
    monkeypatch.setenv("ORBIT_TCC_BUNDLE", "1")
    requested = []

    def request(kind, target):
        requested.append((kind, target))
        return 1

    monkeypatch.setattr(permissions, "_native_request", request)
    monkeypatch.setattr(permissions, "_preflight", lambda *_: "missing")
    r = client.post("/v1/mac/permissions/request", json={"id": "automation_notes"})
    assert r.json()["permission"]["status"] == "granted"
    assert requested == [("automation", "com.apple.Notes")]
    # Bedienungshilfen und Bildschirm: kein Dialog, nur die Systemeinstellungen (Orbit.app kommt aus dem Ziehfenster)
    for pid, page in (("accessibility", "Accessibility"), ("screen", "ScreenCapture")):
        r = client.post("/v1/mac/permissions/request", json={"id": pid}).json()["permission"]
        assert r["status"] == "missing" and "Zieh Orbit.app" in r["detail"]
        assert ["/usr/bin/open", permissions.PRIVACY + page] in [a for a, _ in sys_.calls]
    assert requested == [("automation", "com.apple.Notes")]
    assert not any(a[0] in ("/usr/bin/osascript", "/usr/sbin/screencapture") for a, _ in sys_.calls)


def test_undo_route(client, ctx, run_, home):
    (home / "a").write_text("A")
    t = call(run_, "mac_files", action="trash", paths=["~/a"])
    # ohne kind oder ohne Ziel nimmt nie ein Mac-Eintrag dran
    for body in ({}, {"kind": "last"}, {"kind": "routine"}):
        r = client.post("/v1/undo", json=body)
        assert r.status_code == 400 and r.json()["error"] == "Keine rückgängig zu machende Aktion gefunden."
    assert client.post("/v1/undo", json={"kind": "mac"}).json() == {"ok": False, "error": "Ziel fehlt."}
    assert client.post("/v1/undo", json={"kind": "mac", "orbiId": "nix"}).json()["error"] == "Nichts zum Rückgängigmachen gefunden."
    assert not (home / "a").exists() and len(undo_rows(ctx)) == 1
    r = client.post("/v1/undo", json={"kind": "mac", "orbiId": t["undoId"]})
    assert r.json() == {"ok": True, "undone": "mac", "detail": "1 Objekt(e) zurückgelegt.", "entityId": t["undoId"]}
    assert (home / "a").read_text() == "A" and not undo_rows(ctx)


def test_undo_route_fehler_behaelt_eintrag(client, ctx, run_, home):
    (home / "a").write_text("A")
    t = call(run_, "mac_files", action="trash", paths=["~/a"])
    (home / "a").write_text("neu")
    r = client.post("/v1/undo", json={"kind": "mac", "orbiId": t["undoId"]})
    assert r.status_code == 400 and "Am alten Ort" in r.json()["error"] and len(undo_rows(ctx)) == 1


def test_undo_route_routine(client, ctx):
    ctx.db.run("INSERT INTO undo_actions (id,kind,entity_id,action,detail,previous_state,created_at) VALUES ('u1','routine','auto1','pause','x',?,1)", json.dumps({"enabled": True}))
    r = client.post("/v1/undo", json={"kind": "routine", "orbiId": "auto1"}).json()
    assert r["ok"] and r["undone"] == "routine" and r["entityId"] == "auto1"
    assert ctx.db.val("SELECT count(*) FROM undo_actions WHERE id='u1'") == 0


def test_fremddaten_markierung(run_, sys_):
    sys_.reply["pbpaste"] = tools.Result(0, "x")
    call(run_, "mac_clipboard", action="write", text="y")
    assert not run_.counters.get("untrusted")
    call(run_, "mac_clipboard", action="read")
    assert run_.counters["untrusted"] is True


def test_skript_an_app_nie_immer_und_ohne_app_gesperrt(run_):
    from orbitd.tools.mac.risk import classify_script_apps
    assert classify_script_apps('tell application "TextEdit" to activate')[1].endswith(":einmal")  # läuft ohne Sperre: kein „Immer erlauben“
    from orbitd.tools.mac.risk import script_apps
    assert script_apps('do shell script "echo hi"') == ([], False)  # ohne App: mac_applescript startet es unter der Sperre (sandboxed=True)


@pytest.mark.parametrize("script", ['const a=Application("Notes"); a.activate()', 'var a=Application("Notes"); var f=a["doShell"+"Script"]; f.call(a,"id")',
                                    'Application.call(null,"Ter"+"minal")'])
def test_jxa_an_apps_hart_abgelehnt(run_, script):
    with pytest.raises(Fail):
        TOOLS["mac_applescript"].risk(run_, {"script": script, "language": "JavaScript"})


def test_kommentar_macht_keine_app(run_):
    from orbitd.tools.mac.risk import script_apps
    assert script_apps('-- tell app "Notes"\ndo shell script "id"') == ([], False)
    assert script_apps('// Application("Notes")\n(* app "Notes" *) 1') == ([], False)


def test_skript_laeuft_nur_mit_genannter_app_ohne_sperre(run_, monkeypatch):
    import asyncio
    from orbitd.tools.mac import tools as mt
    seen = []
    async def fake_run(argv, **kw):
        seen.append(kw.get("sandboxed", True))
        return mt.Result(0, "ok")
    monkeypatch.setattr(mt, "run", fake_run)
    monkeypatch.setattr(mt, "app_bundle", lambda n: "com.apple.Notes")
    for script in ('return 1', '-- app "Notes"\nreturn 1', 'set a to "No" & "tes"\ntell application a to activate'):
        asyncio.run(TOOLS["mac_applescript"].handler(run_, {"script": script}))
    asyncio.run(TOOLS["mac_applescript"].handler(run_, {"script": 'tell application "Notes" to activate'}))
    assert seen == [True, True, True, False]


def test_browser_ohne_frage_nur_webadressen(run_):
    for url in ("https://example.com", "mailto:a@b.de"):
        assert TOOLS["mac_browser"].risk(run_, {"action": "open", "url": url}) is None
    for url in ("file:///tmp/x.command", "vscode://x", "java\tscript:alert(1)", "\x01javascript:alert(1)"):
        with pytest.raises(Fail):
            TOOLS["mac_browser"].risk(run_, {"action": "open", "url": url})



@pytest.mark.parametrize("name", ["Antigravity", "Rider", "Claude", "ChatGPT"])
def test_open_lehnt_apps_mit_terminal_ab(run_, name):
    with pytest.raises(Fail):
        TOOLS["mac_open"].risk(run_, {"app": name})


def test_code_app_erkennt_jetbrains_und_agenten():
    from orbitd.tools.mac.risk import code_app
    assert code_app("com.jetbrains.goland", "GoLand") and code_app("com.google.antigravity", "Antigravity") and code_app(None, "Rider.app")
    assert not code_app("com.apple.TextEdit", "TextEdit")
