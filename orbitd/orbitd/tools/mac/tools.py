"""Die 14 Mac-Werkzeuge. Vorlage: lib/mac/tools.ts (Eingaben und Ergebnisse wie dort).

Name „mac_…“ = am Mac von Consti (Dienst orbitd, Nutzerrechte). Sie sind nur im 1:1-Chat und nur bei eingeschaltetem Mac-Zugriff da.
Jeder Systemaufruf geht durch `run` (eine Stelle: Zeitlimit, eigene Prozessgruppe, Ausgabe begrenzt und ohne Geheimnisse);
Tests ersetzen `run` durch eine Attrappe. Löschen läuft immer über den Papierkorb (Shim in der Shell, Dateiwerkzeug, risk.py).
"""
import asyncio
import base64
import contextvars
import json
import os
import re
import shutil
import signal
import tempfile
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path

from ... import sandbox
from ...redact import redact
from ...runtime import recovery
from ...runtime.contract import tool
from ...web import Fail
from . import permissions, undo
from .jxa import JXA, KEY_CODES
from .risk import CODE_APPS, TERMINALS, app_bundle, code_app, classify_script_apps, reveal_only, risk_of, script_apps

MAX_OUTPUT = 10_000
_current = contextvars.ContextVar("mac_run", default=None)  # der Lauf, dessen Werkzeug gerade läuft (für die Prozessgruppe im Lauf)
SHIM_NAMES = ("rm", "rmdir", "unlink", "srm", "shred")
SHIM_SCRIPT = r'''#!/bin/sh
# Orbit-Papierkorb-Shim: rm, rmdir und unlink verschieben nach ~/.Trash statt endgültig zu löschen (Consti, 06.11.2026).
cmd=$(basename "$0")
case "$cmd" in
  srm|shred) echo "$cmd: endgültiges Löschen ist in Orbit gesperrt (nur Papierkorb)." >&2; exit 1;;
esac
trash="$HOME/.Trash"
/bin/mkdir -p "$trash" || exit 1
log="${ORBIT_TRASH_LOG:-}"
force=0; recursive=0; end=0; status=0
for a in "$@"; do
  if [ $end = 0 ] && [ "$cmd" != unlink ]; then
    case "$a" in
      --) end=1; continue;;
      --force) force=1; continue;;
      --recursive) recursive=1; continue;;
      --*) continue;;
      -?*) case "$a" in *f*) force=1;; esac; case "$a" in *[rR]*) recursive=1;; esac; continue;;
    esac
  fi
  if [ ! -e "$a" ] && [ ! -L "$a" ]; then
    [ $force = 1 ] || { echo "$cmd: $a: No such file or directory" >&2; status=1; }
    continue
  fi
  dir=$(cd "$(/usr/bin/dirname "$a")" 2>/dev/null && pwd -P) || { status=1; continue; }
  name=$(/usr/bin/basename "$a")
  abs="$dir/$name"
  case "$name" in .|..) echo "$cmd: $a: verweigert" >&2; status=1; continue;; esac
  case "$abs" in
    /|"$HOME"|"$trash"|"$trash"/*) echo "$cmd: $a: endgültiges Löschen ist in Orbit gesperrt (nur Papierkorb)." >&2; status=1; continue;;
  esac
  if [ -d "$a" ] && [ ! -L "$a" ]; then
    if [ "$cmd" = rm ] && [ $recursive = 0 ]; then echo "rm: $a: is a directory" >&2; status=1; continue; fi
    if [ "$cmd" = rmdir ] && [ -n "$(/bin/ls -A "$a")" ]; then echo "rmdir: $a: Directory not empty" >&2; status=1; continue; fi
    if [ "$cmd" = unlink ]; then echo "unlink: $a: is a directory" >&2; status=1; continue; fi
  fi
  dest="$trash/$name"
  if [ -e "$dest" ] || [ -L "$dest" ]; then
    stamp=$(/bin/date +%H.%M.%S); n=0; dest="$trash/$name $stamp"
    while [ -e "$dest" ] || [ -L "$dest" ]; do n=$((n+1)); dest="$trash/$name $stamp $n"; done
  fi
  if /bin/mv "$a" "$dest"; then
    [ -n "$log" ] && printf '%s\t%s\n' "$abs" "$dest" >> "$log"
  else
    status=1
  fi
done
exit $status
'''


@dataclass
class Result:
    exit_code: int | None
    output: str
    timed_out: bool = False


def clip(text: str, n: int = MAX_OUTPUT) -> str:
    return text if len(text) <= n else f"…(gekürzt)\n{text[-n:]}"


async def run(argv: list[str], *, cwd=None, env=None, input: str | None = None, timeout: float = 60, max_output: int = MAX_OUTPUT,
              launch: bool = True, events=True, sandboxed: bool = True) -> Result:
    """Der einzige Weg zu Systemprogrammen. Eigene Prozessgruppe, Zeitlimit, nur das Ende der Ausgabe bleibt (stdout+stderr, Geheimnisse geschwärzt).
    Systemsperre ohne Schlüsselbund; launch/events wie sandbox.profile (Shell und Kurzbefehle: nichts starten, keine Apple Events)."""
    if not shutil.which(argv[0]):  # sandbox-exec würde das Fehlen verschlucken
        return Result(127, f"{argv[0]}: nicht gefunden")
    try:
        # sandboxed=False nur für osascript an Apps: macOS lehnt Abfragen gesperrter Prozesse mit -10004 ab (live 14.11., auch bei „allow default“)
        proc = await asyncio.create_subprocess_exec(*(sandbox.wrap(argv, keychain=False, launch=launch, events=events) if sandboxed else argv), cwd=cwd, env=env, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE,
                                                    stderr=asyncio.subprocess.STDOUT, start_new_session=True)
    except OSError as e:
        return Result(127, str(e))
    buf, limit = bytearray(), max_output * 4
    owner = _current.get()
    owner = owner if getattr(owner, "id", None) else None
    if owner is not None:  # Gruppe im Lauf merken: nach kill -9 räumt der Wiederanlauf sie ab
        recovery.note_group(owner.ctx.db, owner.id, proc.pid, recovery.proc_start(proc.pid))

    async def pump():
        while chunk := await proc.stdout.read(65536):
            buf.extend(chunk)
            if len(buf) > limit:
                del buf[:-limit]

    async def feed():
        try:
            proc.stdin.write((input or "").encode())
            await proc.stdin.drain()
            proc.stdin.close()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def kill():
        try:
            os.killpg(proc.pid, signal.SIGKILL)  # shortcut: gleich SIGKILL für die ganze Gruppe, kein sanftes SIGTERM vorweg
        except ProcessLookupError:
            pass

    timed_out = False
    try:
        await asyncio.wait_for(asyncio.gather(pump(), feed(), proc.wait()), timeout)
    except asyncio.TimeoutError:
        timed_out = True
        kill()
        await proc.wait()
    except asyncio.CancelledError:  # Stopp-Knopf
        kill()
        raise
    finally:
        if owner is not None:
            recovery.note_group(owner.ctx.db, owner.id, proc.pid, None, add=False)
    return Result(proc.returncode, clip(redact(buf.decode("utf-8", "replace")), max_output), timed_out)


async def osascript(script: str, args=None, *, app: str | None = None, timeout: float = 60, language: str = "JavaScript") -> str:
    r = await run(["/usr/bin/osascript", "-l", language, "-e", script, *([] if args is None else [json.dumps(args)])], timeout=timeout, sandboxed=False)  # eigene, feste Skripte
    if app:
        permissions.note_automation_result(app, r.output, r.exit_code)
    if r.exit_code != 0:
        raise Fail(permissions.hint(r.output) or ("Zeitlimit erreicht." if r.timed_out else r.output.strip() or "osascript fehlgeschlagen."))
    return r.output.strip()


async def jxa_json(script: str, args=None, **kw):
    out = await osascript(script, args, **kw)
    try:
        return json.loads(out)
    except ValueError:
        raise Fail("Unerwartete Antwort von macOS.")


# ---------------------------------------------------------------- Hilfen
def shell_path(shim_dir: Path) -> str:
    """Der Dienst läuft unter launchd mit knappem PATH: Homebrew und /usr/local dazu, der Shim immer zuerst."""
    parts = [str(shim_dir), *os.environ.get("PATH", "").split(":"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"]
    return ":".join(dict.fromkeys(p for p in parts if p))


def ensure_shim(d: Path) -> Path:
    d.mkdir(parents=True, exist_ok=True)
    for name in SHIM_NAMES:
        p = d / name
        if not p.exists() or p.read_text() != SHIM_SCRIPT:
            p.write_text(SHIM_SCRIPT)
        p.chmod(0o755)
    return d


def expand(path: str) -> str:
    h = str(undo.home())
    return os.path.abspath(os.path.join(h, path[2:]) if path.startswith("~/") else h if path == "~" else path)


def _need(args: dict, key: str):
    if not args.get(key):
        raise Fail(f"„{key}“ fehlt.")
    return args[key]


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _date(text: str, key: str) -> datetime:
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))  # ohne Zone = Ortszeit, wie in JavaScript
    except ValueError:
        raise Fail(f"„{key}“ ist kein gültiges Datum.")


def _undoable(run_, action: str, detail: str, **state) -> str | None:
    return undo.record(run_.ctx.db, action, detail, state)


def _short(text: str, n: int = 60) -> str:
    return (lambda s: s if len(s) <= n else s[: n - 1] + "…")(" ".join(str(text).split()))


def mac_tool(name: str, description: str, props: dict, label, required=()):
    """@tool mit den gemeinsamen Regeln: nur 1:1-Chat, nur bei Mac-Zugriff an, Risiko aus risk.py, Systemfehler als deutscher Satz."""
    def register(handler):
        async def guarded(run_, args):
            token = _current.set(run_)
            try:
                return await handler(run_, args)
            except OSError as e:
                raise Fail(f"{e.strerror or e}: {e.filename}" if e.filename else str(e))
            finally:
                _current.reset(token)
        return tool(name, description, {"type": "object", "properties": props, "required": list(required)}, groups=False,
                    available=lambda run_: permissions.enabled(run_.ctx.db), risk=lambda run_, a: risk_of(name, run_, a),
                    label=lambda a: _short(label(a), 100) or name)(guarded)
    return register


_s, _n, _b = {"type": "string"}, {"type": "number"}, {"type": "boolean"}
_limit = lambda hi: {"type": "integer", "minimum": 1, "maximum": hi}


# ---------------------------------------------------------------- Shell
@mac_tool("mac_shell", "Run a shell command (zsh) locally on the user's Mac. rm/rmdir/unlink move files to the Trash. Returns exit code and output (last 10k chars).",
          {"command": _s, "cwd": {**_s, "description": "Working directory, default home"}, "timeout": {**_limit(1800), "description": "Seconds, default 120"}},
          lambda a: f"Führt am Mac aus: {_short(a.get('command', ''))}", required=["command"])
async def mac_shell(run_, a):
    shim = ensure_shim(run_.ctx.cfg.data_dir / "mac-shim")
    log_dir = Path(tempfile.mkdtemp(prefix="orbit-trash-"))
    log = log_dir / "moves.tsv"
    try:
        r = await run(["/bin/zsh", "-f", "-c", a["command"]], cwd=expand(a["cwd"]) if a.get("cwd") else str(undo.home()), timeout=a.get("timeout", 120),
                      env={**os.environ, "PATH": shell_path(shim), "ORBIT_TRASH_LOG": str(log), "HOME": str(undo.home())}, launch=False, events=())
        moves = [dict(zip(("from", "to"), line.split("\t"))) for line in log.read_text().splitlines() if "\t" in line] if log.exists() else []
        undo_id = _undoable(run_, "trash", f"{len(moves)} Objekt(e) in den Papierkorb", moves=moves) if moves else None
        return {"exitCode": r.exit_code, "output": r.output, **({"timedOut": True} if r.timed_out else {}),
                **({"trashed": [m["from"] for m in moves]} if moves else {}), **({"undoId": undo_id} if undo_id else {})}
    finally:
        shutil.rmtree(log_dir, ignore_errors=True)  # nur das eigene Wegwerf-Protokoll


# ---------------------------------------------------------------- Dateien
def _files_label(a):
    p = os.path.basename(str(a.get("path") or "")) or "Home"
    return {"read": f"Liest {p}", "write": f"Schreibt {p}", "append": f"Hängt an {p} an", "list": f"Listet {p}", "move": f"Verschiebt {p}",
            "search": f"Sucht „{a.get('query', '')}“", "trash": f"Legt {len(a.get('paths') or [1])} Objekt(e) in den Papierkorb"}.get(a.get("action"), "Dateien")


@mac_tool("mac_files", "Files on the user's Mac: read, write, list, search (Spotlight), move/rename, trash (moves to the Trash, never deletes). Paths may start with ~.",
          {"action": {"enum": ["read", "write", "append", "list", "search", "move", "trash"]}, "path": {**_s, "description": "File or folder (read, write, append, list, move source, search folder)"},
           "paths": {"type": "array", "items": _s, "description": "trash: files or folders"}, "to": {**_s, "description": "move: target path"},
           "content": {**_s, "description": "write/append: text"}, "query": {**_s, "description": "search: words or Spotlight query"}, "limit": _limit(500)},
          _files_label, required=["action"])
async def mac_files(run_, a):
    act = a["action"]
    if act == "read":
        run_.counters["eigen"] = True
        path = expand(_need(a, "path"))
        size = os.stat(path).st_size
        data = Path(path).read_bytes()
        if b"\0" in data[:8000]:
            return {"path": path, "size": size, "binary": True, "note": "Binärdatei: Inhalt nicht als Text lesbar."}
        return {"path": path, "size": size, "content": clip(redact(data.decode("utf-8", "replace")), 100_000)}
    if act in ("write", "append"):
        path, content = expand(_need(a, "path")), a.get("content", "")
        if act == "append":
            with open(path, "a") as f:
                f.write(content)
            return {"path": path, "appended": len(content)}
        previous = undo.move_to_trash(path) if os.path.lexists(path) else None  # Überschreiben ist umkehrbar: die alte Fassung kommt vorher in den Papierkorb
        Path(path).write_text(content)
        undo_id = _undoable(run_, "write", f"{path} überschrieben" if previous else f"{path} angelegt", path=path, previous=previous)
        return {"path": path, "written": len(content), **({"previousInTrash": previous["to"]} if previous else {}), **({"undoId": undo_id} if undo_id else {})}
    if act == "list":
        path = expand(a.get("path") or "~")
        names = [e.name + ("/" if e.is_dir() else "") for e in list(os.scandir(path))[: a.get("limit", 200)]]
        return {"path": path, "entries": names}
    if act == "search":
        argv = ["/usr/bin/mdfind", *(["-onlyin", expand(a["path"])] if a.get("path") else []), _need(a, "query")]
        r = await run(argv, timeout=30)
        return {"results": [x for x in r.output.split("\n") if x.startswith("/")][: a.get("limit", 50)]}  # run() mischt stderr ein: mdfind meldet "[UserQueryParser] …" ohne Pfad
    if act == "move":
        move = undo.move_file(expand(_need(a, "path")), expand(_need(a, "to")))
        undo_id = _undoable(run_, "move", f"{move['from']} → {move['to']}", moves=[move])
        return {**move, **({"undoId": undo_id} if undo_id else {})}
    paths = a.get("paths") or ([a["path"]] if a.get("path") else [])
    if not paths:
        raise Fail("„paths“ fehlt.")
    moves = [undo.move_to_trash(expand(p)) for p in paths]
    undo_id = _undoable(run_, "trash", f"{len(moves)} Objekt(e) in den Papierkorb", moves=moves)
    return {"trashed": [m["from"] for m in moves], **({"undoId": undo_id} if undo_id else {})}


# ---------------------------------------------------------------- Öffnen, AppleScript, Kurzbefehle
@mac_tool("mac_open", "Open a file, folder, URL or app on the user's Mac (like the `open` command).",
          {"target": {**_s, "description": "Path or URL"}, "app": {**_s, "description": "App name, e.g. Safari, Finder, Numbers"}},
          lambda a: f"Öffnet {a.get('app') or _short(a.get('target', ''), 50)}")
async def mac_open(run_, a):
    if not a.get("target") and not a.get("app"):
        raise Fail("„target“ oder „app“ fehlt.")
    t = a.get("target")
    reveal = bool(t) and not re.match(r"[a-z][\w+.-]*:", t, re.I) and reveal_only(t)  # Archive nur im Finder zeigen
    argv = ["/usr/bin/open", *(["-R"] if reveal else []), *(["-a", a["app"]] if a.get("app") and not reveal else []),
            *([t if re.match(r"[a-z][\w+.-]*:", t, re.I) else expand(t)] if t else [])]
    r = await run(argv, timeout=30)
    if r.exit_code != 0:
        raise Fail(r.output.strip() or "Öffnen fehlgeschlagen.")
    return {"ok": True}


@mac_tool("mac_applescript", "Run AppleScript on the user's Mac to control apps (asks Consti each time). For typing, clicking, opening apps or URLs use mac_input, mac_open or mac_browser instead: they need no approval. Returns the script result.",
          {"script": _s, "language": {"enum": ["AppleScript", "JavaScript"], "default": "AppleScript"}},
          lambda a: (lambda names: f"Steuert {', '.join(sorted(names))}" if names else "Führt ein Skript am Mac aus")(script_apps(a.get("script", ""))[0]), required=["script"])
async def mac_applescript(run_, a):
    script = a["script"]
    classify_script_apps(script, a.get("language", "AppleScript"))  # auch hier: gesperrte Apps, Befehle in fremder App und unbekannte Apps scheitern vor dem Start
    names, computed = script_apps(script)
    # Apple Events nur an die Apps auf der Karte (berechneter Name: an alle außer Terminal & Co.); nichts über LaunchServices öffnen
    events = True if computed else tuple(filter(None, map(app_bundle, names)))
    # Skript an Apps: ohne Sperre (sonst -10004), dafür immer mit Karte und ohne Befehle (classify_script_apps); ohne App bleibt es gesperrt
    r = await run(["/usr/bin/osascript", "-l", a.get("language", "AppleScript"), "-e", script], timeout=120, launch=False, events=events,
                  sandboxed=not names or computed)  # berechneter Name: unter der Sperre (dort gilt NO_EVENTS)
    m = re.search(r'tell application "([^"]+)"', script)
    if m:
        permissions.note_automation_result(m.group(1), r.output, r.exit_code)
    h = permissions.hint(r.output) or (NOT_RUNNING if r.exit_code and re.search(r"\((-54|-600|-10810)\)", r.output) else None)
    return {"exitCode": r.exit_code, "output": r.output, **({"hint": h} if h else {})}


NOT_RUNNING = "Die App läuft vermutlich nicht (Skripte dürfen keine Apps starten). Starte sie zuerst mit mac_open (app) und führe das Skript dann noch einmal aus."


@mac_tool("mac_shortcut", "Run a Shortcuts shortcut by name on the user's Mac (optional text input), or list shortcuts with name omitted.",
          {"name": _s, "input": _s}, lambda a: f"Kurzbefehl „{a['name']}“" if a.get("name") else "Listet die Kurzbefehle")
async def mac_shortcut(run_, a):
    if not a.get("name"):
        r = await run(["/usr/bin/shortcuts", "list"], timeout=30, launch=False, events=())
        return {"shortcuts": [x for x in r.output.split("\n") if x]}
    d = Path(tempfile.mkdtemp(prefix="orbit-shortcut-"))
    try:
        argv = ["/usr/bin/shortcuts", "run", a["name"], "-o", str(d / "out")]
        if a.get("input") is not None:
            (d / "in.txt").write_text(a["input"])
            argv += ["-i", str(d / "in.txt")]
        r = await run(argv, timeout=300, launch=False, events=())
        out = clip(redact((d / "out").read_text(errors="replace"))) if (d / "out").exists() else ""
        return {"exitCode": r.exit_code, "output": out or r.output}
    finally:
        shutil.rmtree(d, ignore_errors=True)


# ---------------------------------------------------------------- Bildschirm, Maus, Tastatur, Zwischenablage, Mitteilung
@mac_tool("mac_screen", "Take a screenshot of the user's Mac screen so you can see it. Look at the saved image file (path in the result). Image pixels equal mouse coordinates for mac_input.",
          {}, lambda a: "Sieht sich den Bildschirm an")
async def mac_screen(run_, a):
    had = run_.counters.get("untrusted_now")
    run_.counters["untrusted"] = True
    if not had:  # der eigene Bildschirm bremst das Bedienen nicht (Vorgabe Consti 14.11.); Shell und Dateien fragen danach weiter
        run_.counters.pop("untrusted_now", None)
    # das verkleinerte Bild geht als Bildblock mit; die Datei bleibt zusätzlich im Datenordner
    d = run_.ctx.cfg.data_dir / "mac-screen"
    d.mkdir(parents=True, exist_ok=True)
    file = d / "screen.jpg"
    file.unlink(missing_ok=True)  # eigene Arbeitsdatei der vorigen Aufnahme
    size = await jxa_json(JXA["screenSize"])
    r = await run(["/usr/sbin/screencapture", "-x", "-m", "-t", "jpg", str(file)], timeout=30, sandboxed=False)  # feste Befehle; die Sperre verbot das Schreiben in den Datenordner (live 15.11.)
    if r.exit_code != 0 or not file.exists():
        raise Fail("Bildschirmaufnahme nicht erlaubt. Erlaubnis in Orbit › Einstellungen › Sicherheit › Mac-Zugriff anfragen.")
    w, h = round(size["width"]), round(size["height"])
    await run(["/usr/bin/sips", "-z", str(h), str(w), "-s", "formatOptions", "70", str(file)], timeout=30, sandboxed=False)
    return {"path": str(file), "mediaType": "image/jpeg", "width": w, "height": h, "note": f"Mac-Bildschirm {w}x{h} (Punkte = Mauskoordinaten). Nicht für Consti sichtbar.",
            "_images": [{"data": base64.b64encode(file.read_bytes()).decode("ascii"), "mimeType": "image/jpeg"}]}


def _input_label(a):
    x, y = a.get("x"), a.get("y")
    at = f" bei {round(x)}, {round(y)}" if x is not None and y is not None else ""
    return {"click": f"Klickt{at}", "double": f"Doppelklickt{at}", "right": f"Rechtsklickt{at}", "move": f"Bewegt die Maus{at}", "drag": f"Zieht von {x}, {y} nach {a.get('toX')}, {a.get('toY')}",
            "scroll": "Scrollt", "type": f"Tippt „{_short(a.get('text', ''), 30)}“", "key": f"Drückt {'+'.join([*a.get('modifiers', []), a.get('key', '?')])}"}.get(a.get("action"), "Steuert Maus und Tastatur")


async def front_app() -> tuple[str, str]:
    """(Bundle-ID, Name) der vordersten App über lsappinfo: ohne Apple Events, ohne Rechte-Dialog."""
    asn = (await run(["/usr/bin/lsappinfo", "front"], timeout=10)).output.strip()
    info = (await run(["/usr/bin/lsappinfo", "info", "-only", "bundleid", "-only", "name", asn], timeout=10)).output if asn else ""
    field = lambda key: (re.search(rf'"?{key}"?="([^"]*)"', info, re.I) or [None, ""])[1]
    return field("bundleid"), field("name")


@mac_tool("mac_input", "Control mouse and keyboard on the user's Mac: click, double, right click, move, drag, scroll at screen points; type text; press a key with modifiers.",
          {"action": {"enum": ["click", "double", "right", "move", "drag", "scroll", "type", "key"]}, "x": _n, "y": _n,
           "toX": {**_n, "description": "drag: target x"}, "toY": {**_n, "description": "drag: target y"},
           "dy": {**_n, "description": "scroll: lines down (negative = up)"}, "dx": {**_n, "description": "scroll: lines right"},
           "text": {**_s, "description": "type: text to type"}, "key": {**_s, "description": "key: letter or name (return, tab, escape, left, …)"},
           "modifiers": {"type": "array", "items": {"enum": ["command", "shift", "option", "control"]}}}, _input_label, required=["action"])
async def mac_input(run_, a):
    # Erst nach der Freigabe prüfen (sie kann Minuten später kommen). shortcut: zwischen Prüfung und Eingabe kann die vorderste App noch wechseln (kurzes Fenster)
    async def guard():
        bundle, name = await front_app()
        if not bundle or code_app(bundle, name):
            raise Fail(f"Vorne ist {name or 'eine unbekannte App'}: in Terminal und Code-Programme tippt und klickt Orbit nicht.")
    await guard()
    if a["action"] == "type":  # Zeile für Zeile, vor jeder Zeile die vordere App neu prüfen (ein Zeilenumbruch kann eine andere App nach vorn holen)
        for i, line in enumerate(re.split(r"(\r\n|\r|\n)", a.get("text", ""))):
            if i:
                await asyncio.sleep(0.3)
                await guard()
            if line:
                await osascript(JXA["keyboard"], {"text": line}, app="System Events")
        return {"ok": True}
    if a["action"] == "key":
        code = KEY_CODES.get(a["key"].lower()) if a.get("key") else None
        args = {"keyCode": code, "modifiers": a.get("modifiers")} if code is not None else {"key": a.get("key", ""), "modifiers": a.get("modifiers")}
        await osascript(JXA["keyboard"], args, app="System Events")
        return {"ok": True}
    if a.get("x") is None or a.get("y") is None:
        raise Fail("„x“ und „y“ fehlen.")
    if a["action"] == "drag" and (a.get("toX") is None or a.get("toY") is None):
        raise Fail("„toX“ und „toY“ fehlen.")
    await osascript(JXA["mouse"], {**a, "action": "click" if a["action"] == "right" else a["action"], "button": "right" if a["action"] == "right" else "left"})
    return {"ok": True}


@mac_tool("mac_clipboard", "Read or write the clipboard of the user's Mac (text).", {"action": {"enum": ["read", "write"]}, "text": _s},
          lambda a: "Liest die Zwischenablage" if a.get("action") == "read" else "Schreibt in die Zwischenablage", required=["action"])
async def mac_clipboard(run_, a):
    if a["action"] == "read":
        run_.counters["untrusted"] = True
        return {"text": (await run(["/usr/bin/pbpaste"], timeout=10)).output}
    return {"ok": (await run(["/usr/bin/pbcopy"], input=a.get("text", ""), timeout=10)).exit_code == 0}


@mac_tool("mac_notify", "Show a macOS notification on the user's Mac.", {"title": _s, "text": _s}, lambda a: f"Mitteilung: {a.get('title', '')}", required=["title", "text"])
async def mac_notify(run_, a):
    await osascript("function run(argv){const a=JSON.parse(argv[0]);const app=Application.currentApplication();app.includeStandardAdditions=true;app.displayNotification(a.text,{withTitle:a.title});return '{}'}",
                    {"title": a["title"], "text": a["text"]})
    return {"ok": True}


# ---------------------------------------------------------------- Kalender, Erinnerungen, Kontakte, Notizen, Browser
@mac_tool("mac_calendar", "Apple Calendar on the user's Mac: list events in a time range, or create an event (no invitations).",
          {"action": {"enum": ["list", "create"]}, "from": {**_s, "description": "list: ISO start, default now"}, "to": {**_s, "description": "list: ISO end, default +7 days"},
           "calendar": _s, "title": _s, "start": {**_s, "description": "create: ISO date-time"}, "end": {**_s, "description": "create: ISO date-time"},
           "allDay": _b, "location": _s, "notes": _s, "limit": _limit(500)},
          lambda a: f"Legt Termin „{a.get('title', '')}“ an" if a.get("action") == "create" else "Liest die Termine", required=["action"])
async def mac_calendar(run_, a):
    if a["action"] == "list":
        now = datetime.now(timezone.utc)
        args = {"from": a.get("from") or _iso(now), "to": a.get("to") or _iso(now + timedelta(days=7)), "calendar": a.get("calendar"), "limit": a.get("limit", 200)}
        return {"events": await jxa_json(JXA["calendarList"], args, app="Calendar", timeout=120)}
    if not a.get("title") or not a.get("start"):
        raise Fail("„title“ und „start“ fehlen.")
    end = a.get("end") or _iso(_date(a["start"], "start") + timedelta(hours=1))
    created = await jxa_json(JXA["calendarCreate"], {**a, "end": end}, app="Calendar")
    undo_id = _undoable(run_, "calendar_create", f"Termin „{a['title']}“ angelegt", id=created["id"])
    return {**created, **({"undoId": undo_id} if undo_id else {})}


@mac_tool("mac_reminders", "Apple Reminders on the user's Mac: list open reminders, create one, or mark one done/undone.",
          {"action": {"enum": ["list", "create", "complete"]}, "list": _s, "title": _s, "due": {**_s, "description": "ISO date-time"}, "notes": _s,
           "id": {**_s, "description": "complete: reminder id"}, "done": {**_b, "description": "complete: true = done, false = open again"}, "includeDone": _b, "limit": _limit(500)},
          lambda a: {"create": f"Legt Erinnerung „{a.get('title', '')}“ an", "complete": "Hakt eine Erinnerung ab"}.get(a.get("action"), "Liest die Erinnerungen"), required=["action"])
async def mac_reminders(run_, a):
    if a["action"] == "list":
        return {"reminders": await jxa_json(JXA["remindersList"], {"list": a.get("list"), "done": a.get("includeDone", False), "limit": a.get("limit", 200)}, app="Reminders", timeout=120)}
    if a["action"] == "complete":
        r = await jxa_json(JXA["reminderComplete"], {"id": _need(a, "id"), "done": a.get("done", True)}, app="Reminders")
        undo_id = _undoable(run_, "reminder_complete", "Erinnerung abgehakt", id=a["id"], before=r["before"])
        return {"ok": True, **({"undoId": undo_id} if undo_id else {})}
    created = await jxa_json(JXA["reminderCreate"], {**a, "title": _need(a, "title")}, app="Reminders")
    undo_id = _undoable(run_, "reminder_create", f"Erinnerung „{a['title']}“ angelegt", id=created["id"])
    return {**created, **({"undoId": undo_id} if undo_id else {})}


@mac_tool("mac_contacts", "Search Apple Contacts on the user's Mac by name.", {"query": _s, "limit": _limit(100)}, lambda a: f"Sucht Kontakt „{a.get('query', '')}“", required=["query"])
async def mac_contacts(run_, a):
    return {"contacts": await jxa_json(JXA["contactsSearch"], {"query": a["query"], "limit": a.get("limit", 20)}, app="Contacts", timeout=120)}


@mac_tool("mac_notes", "Apple Notes on the user's Mac: search notes (title and text), read one in full, or create a note.",
          {"action": {"enum": ["search", "read", "create"]}, "query": _s, "title": _s, "text": _s, "folder": _s, "limit": _limit(200)},
          lambda a: {"create": f"Legt Notiz „{a.get('title', '')}“ an", "read": f"Liest die Notiz „{a.get('query', '')}“"}.get(a.get("action"), f"Sucht Notizen „{a.get('query', '')}“"), required=["action"])
async def mac_notes(run_, a):
    if a["action"] != "create":
        run_.counters["eigen"] = True
        read = a["action"] == "read"
        return {"notes": await jxa_json(JXA["notesSearch"], {"query": a.get("query", ""), "full": read, "limit": 1 if read else a.get("limit", 20)}, app="Notes", timeout=120)}
    created = await jxa_json(JXA["noteCreate"], {"title": _need(a, "title"), "text": a.get("text", ""), "folder": a.get("folder")}, app="Notes")
    undo_id = _undoable(run_, "note_create", f"Notiz „{a['title']}“ angelegt", id=created["id"])
    return {**created, **({"undoId": undo_id} if undo_id else {})}


@mac_tool("mac_browser", "Browser on the user's Mac (Safari or Google Chrome): open a URL, or read URL, title and page text of the front tab.",
          {"action": {"enum": ["open", "read"]}, "app": {"enum": ["Safari", "Google Chrome"], "default": "Safari"}, "url": _s, "newTab": _b,
           "text": {**_b, "description": "read: include page text (default true)"}},
          lambda a: f"Öffnet {_short(a.get('url', ''), 50)} in {a.get('app', 'Safari')}" if a.get("action") == "open" else f"Liest die Seite in {a.get('app', 'Safari')}", required=["action"])
async def mac_browser(run_, a):
    app = a.get("app", "Safari")
    if a["action"] == "open":
        await osascript(JXA["browserOpen"], {"app": app, "url": _need(a, "url"), "newTab": a.get("newTab", False)}, app=app)
        return {"ok": True}
    run_.counters["untrusted"] = True
    page = await jxa_json(JXA["browserRead"], {"app": app, "text": a.get("text", True), "max": 40_000}, app=app)
    if page.get("error"):
        raise Fail(page["error"])
    return {**page, **({"text": redact(page["text"])} if page.get("text") else {})}


MAC_TOOL_NAMES = ["mac_shell", "mac_files", "mac_open", "mac_applescript", "mac_shortcut", "mac_screen", "mac_input", "mac_clipboard",
                  "mac_notify", "mac_calendar", "mac_reminders", "mac_contacts", "mac_notes", "mac_browser"]
