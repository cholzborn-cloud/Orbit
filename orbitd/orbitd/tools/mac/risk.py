"""Risiko der Mac-Werkzeuge. Vorlage: lib/mac/risk.ts und classifyBash aus lib/approvals/risk.ts (ohne consti_said).

Mac-Bedienung läuft ohne Freigabe. Freigabekarte nur bei Geld, Nachricht in Constis Namen und Login
(Tor auch in interactions.gate). Intern liefern die Prüfer (reason, text) oder None; erst `risk_of`
macht daraus ein Risk und filtert auf die drei Gründe.
"""
import os
import plistlib
import re
import subprocess
from pathlib import Path
from urllib.parse import unquote, urlsplit

from ... import sandbox
from ...config import REAL_DATA_DIR
from ...runtime import contract
from ...runtime.contract import Risk
from ...web import Fail

SEVERITY = ["system", "geheimnis", "loeschen", "geld", "veroeffentlichen", "nachricht", "dauerhaft", "login"]
ASK_CARD = frozenset({"geld", "nachricht", "login"})
BASH_TEXT = {
    "geld": "Gibt Geld aus", "veroeffentlichen": "Veröffentlicht etwas", "nachricht": "Schickt Daten nach außen an",
    "loeschen": "Löscht endgültig", "geheimnis": "Liest Zugangsdaten", "system": "Greift ins System ein",
    "dauerhaft": "Ändert etwas dauerhaft", "login": "Verbindet ein Konto",
}


def clip(value: str, n: int = 120) -> str:
    return value if len(value) <= n else value[: n - 1] + "…"


# ---------------------------------------------------------------- Shell (classifyBash)
PREFIXES = {"nohup", "time", "command", "exec", "builtin", "nice", "stdbuf", "timeout"}
SHELLS = {"bash", "sh", "zsh", "dash"}
SECRET_PATTERNS = [re.compile(p) for p in (
    r"(^|[\s/'\"=:<>])secrets\.env\b",
    r"(^|[\s/'\"=:<>])\.env(\.[\w.-]+)?($|[\s'\"<>;|&)])",
    r"\.pem\b",
    r"\bid_(rsa|ed25519|ecdsa|dsa)\b",
    r"(~|\$HOME|/home/[\w.-]+|/root|/Users/[\w.-]+)/\.(ssh|aws)\b",
    r"\bsecurity\s+(find|dump)-",
    r"\$\{?[A-Za-z_]*(KEY|TOKEN|SECRET|PASSWORD|PASSWD)[A-Za-z_]*\}?",
)]
LOCAL_HOST = re.compile(r"^(https?://)?(localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)([:/]|$)", re.I)


def tokenize(segment: str) -> list[str]:
    tokens, cur, quote, started, i = [], "", None, False, 0
    while i < len(segment):
        c = segment[i]
        if quote:
            if c == quote:
                quote = None
            elif c == "\\" and quote == '"' and i + 1 < len(segment):
                i += 1
                cur += segment[i]
            else:
                cur += c
        elif c in "'\"":
            quote, started = c, True
        elif c == "\\" and i + 1 < len(segment):
            i += 1
            cur += segment[i]
            started = True
        elif c.isspace():
            if started:
                tokens.append(cur)
            cur, started = "", False
        else:
            cur += c
            started = True
        i += 1
    if started:
        tokens.append(cur)
    return tokens


def segments(command: str) -> list[str]:
    """Trennt an ; && || | Zeilenumbruch, $( ) und Backticks, ohne in Anführungszeichen zu schneiden."""
    out, cur, quote, i = [], "", None, 0
    while i < len(command):
        c = command[i]
        nxt = command[i + 1] if i + 1 < len(command) else ""
        if quote:
            if c == quote:
                quote = None
            elif c == "\\" and quote == '"':
                cur += c + nxt
                i += 2
                continue
            elif quote == '"' and c == "$" and nxt == "(":
                out.append(cur)  # Befehlsersetzung in "…" läuft trotzdem: eigenes Segment
                cur = ""
                i += 2
                continue
            cur += c
            i += 1
            continue
        if c in "'\"":
            quote = c
            cur += c
        elif c == "\\":
            cur += c + nxt
            i += 1
        elif c == "$" and nxt == "(":
            out.append(cur)
            cur = ""
            i += 1
        elif c in ";|&\n`()":
            out.append(cur)
            cur = ""
        else:
            cur += c
        i += 1
    out.append(cur)
    return [s.strip() for s in out if s.strip()]


def _norm(path: str) -> str:
    parts: list[str] = []
    for p in path.split("/"):
        if not p or p == ".":
            continue
        if p == "..":
            if parts:
                parts.pop()
        else:
            parts.append(p)
    return ("/" if path.startswith("/") else "") + "/".join(parts)


def _under_tmp(path: str) -> bool:
    return path.startswith("/") and _norm(path).startswith("/tmp/")


def _targets(args: list[str]) -> list[str]:
    return [a for a in args if not a.startswith("-")]


def _segment(segment: str, depth: int):
    """(reason, detail, weitere Treffer) oder None."""
    tokens, raw, i = [], tokenize(segment), 0
    while i < len(raw):  # Redirects sind keine Ziele des Befehls
        if re.fullmatch(r"\d*(>>?|<)&?", raw[i]):
            i += 1
        elif not re.match(r"\d*(>>?|<)", raw[i]):
            tokens.append(raw[i])
        i += 1
    while tokens and re.match(r"[A-Za-z_][A-Za-z0-9_]*=", tokens[0]):
        tokens = tokens[1:]
    if not tokens:
        return None
    head, rest = tokens[0].split("/")[-1], tokens[1:]
    if head in ("sudo", "su", "doas"):
        return "system", segment, []
    if head in PREFIXES or head == "xargs":
        for index, t in enumerate(rest):
            if t.startswith("-"):
                continue
            hit = _segment(" ".join(rest[index:]), depth)
            if hit:
                return hit
        return None
    if head == "env":
        command = [t for t in rest if not t.startswith("-") and not re.match(r"[A-Za-z_]\w*=", t)]
        return ("geheimnis", segment, []) if not command else _segment(" ".join(command), depth)
    if head == "printenv":
        return "geheimnis", segment, []
    if head in SHELLS and depth < 4:
        flag = next((i for i, t in enumerate(rest) if re.fullmatch(r"-\w*c\w*", t)), -1)
        if flag >= 0 and flag + 1 < len(rest):
            inner = _all(rest[flag + 1], depth + 1)
            if inner:
                return inner[0][0], inner[0][1], inner[1:]
    if head in ("systemctl", "service", "launchctl", "crontab", "update-rc.d", "chkconfig") or (head == "defaults" and rest[:1] == ["write"]):
        return "system", segment, []
    if head in ("rm", "rmdir", "shred", "unlink", "truncate"):
        paths = _targets([t for i, t in enumerate(rest) if not (head == "truncate" and i and rest[i - 1] in ("-s", "--size"))])
        if not paths or not all(map(_under_tmp, paths)):
            return "loeschen", " ".join(paths) or segment, []
    exec_removes = any(t in ("-exec", "-execdir") and i + 1 < len(rest) and re.fullmatch(r"rm|rmdir|shred|unlink", rest[i + 1]) for i, t in enumerate(rest))
    if head == "find" and ("-delete" in rest or exec_removes):
        end = next((i for i, t in enumerate(rest) if t.startswith("-") or t in ("(", "!")), len(rest))
        roots = rest[:end]
        if not roots or not all(map(_under_tmp, roots)):
            return "loeschen", " ".join(roots) or segment, []
    git_cmd = next((t for i, t in enumerate(rest) if not t.startswith("-") and (i == 0 or rest[i - 1] not in ("-C", "-c"))), None)
    if head == "git" and git_cmd == "clean":
        return "loeschen", segment, []
    if head in ("curl", "wget"):
        if head == "curl":
            upload = any(re.fullmatch(r"-d|--data.*|-F|--form.*|-T|--upload-file|--json", t) or re.match(r"-[a-zA-Z]*[dFT].", t) for t in rest)
        else:
            upload = any(re.match(r"--(post|body|method=(POST|PUT|PATCH))", t, re.I) for t in rest)
        hosts = [t for t in rest if re.match(r"(https?://|[\w-]+\.[\w.-]+(:\d+)?(/|$))", t)]
        if upload and not (hosts and all(LOCAL_HOST.match(h) for h in hosts)):
            return "nachricht", " ".join(hosts) or segment, []
    if (head in ("tee", "cp", "mv", "install", "ln") and any(t.startswith("/etc/") for t in rest)) or \
            (head == "sed" and any(t.startswith("-i") for t in rest) and any(t.startswith("/etc/") for t in rest)):
        return "system", segment, []
    return None


def _all(command: str, depth: int = 0) -> list[tuple[str, str]]:
    hits: list[tuple[str, str]] = []
    if re.search(r">{1,2}\s*[\"']?/etc/", command):
        hits.append(("system", command))
    if any(p.search(command) for p in SECRET_PATTERNS):
        hits.append(("geheimnis", command))
    for seg in segments(command):
        hit = _segment(seg, depth)
        if hit:
            hits.append((hit[0], hit[1]))
            hits.extend(hit[2])
    hits.sort(key=lambda h: SEVERITY.index(h[0]))
    return hits


def classify_bash(command: str):
    hits = _all(command)
    if not hits:
        return None
    reason, detail = hits[0]
    detail = detail if reason in ("loeschen", "nachricht") else command
    return reason, clip(f"{BASH_TEXT[reason]}: {detail.strip()}")


# ---------------------------------------------------------------- Mac-Shell, AppleScript, Kurzbefehle
# rm/rmdir/unlink über den PATH landen im Papierkorb (Shim) und sind umkehrbar: für die Prüfung harmlos umbenennen.
PATH_REMOVE = re.compile(r"""(^|[\s;&|(`"']|\$\(|\bxargs\s+(?:-\S+\s+)*|\bcommand\s+|\benv\s+|\\)(rm|rmdir|unlink)(?=\s|$)""")
HARD_DELETE = [
    (r"(^|[\s;&|(`'\"])/(usr/)?bin/(rm|rmdir|unlink)\b", "Löscht am Papierkorb vorbei"),
    (r"\bfind\b[^;&|]*\s-delete\b", "find -delete löscht endgültig"),
    (r"\b(shred|srm)\b", "Überschreibt und löscht endgültig"),
    (r"\bos\.(remove|unlink|rmdir|removedirs)\s*\(|\bshutil\.rmtree\s*\(|\bPath\([^)]*\)\.unlink\s*\(|\.unlink\(\s*(missing_ok|\))", "Skript löscht endgültig (Python)"),
    (r"\bfs(\.promises)?\.(rm|rmSync|unlink|unlinkSync|rmdir|rmdirSync)\s*\(|\b(rmSync|unlinkSync|rmdirSync)\s*\(", "Skript löscht endgültig (Node)"),
    (r"\b(File\.delete|FileUtils\.rm(_rf|_r|_f)?|Dir\.(delete|rmdir|unlink))\b|\bunlink\s*\(?\s*['\"$]", "Skript löscht endgültig"),
    (r"(?i)\bempty\s+(the\s+)?trash\b|emptyTrash\(", "Leert den Papierkorb"),
    (r"(?i)\bdiskutil\s+(erase|zeroDisk|secureErase|eraseVolume|eraseDisk)", "Löscht ein Laufwerk"),
]
MESSAGE_APPS = re.compile(r"(?i)\b(Mail|Messages|Nachrichten|WhatsApp|Telegram|Signal|Slack|Discord|Microsoft Outlook|Outlook|Teams|Mastodon|Threads)\b")


def classify_mac_shell(command: str):
    for pattern, text in HARD_DELETE:
        if re.search(pattern, command):
            return "loeschen", clip(f"{text}: {command.strip()}")
    if re.search(r"\bosascript\b", command):
        hit = classify_applescript(command)
        if hit:
            return hit
    rewritten = PATH_REMOVE.sub(lambda m: m.group(1) + "orbit_papierkorb", command)
    hit = classify_bash(rewritten)
    return (hit[0], clip(hit[1].replace("orbit_papierkorb", "rm"))) if hit else None


def classify_applescript(script: str):
    for pattern, text in HARD_DELETE[6:]:
        if re.search(pattern, script):
            return "loeschen", clip(f"{text}: {script.strip()}")
    if re.search(r"\bdo shell script\b", script):
        for m in re.finditer(r'do shell script\s+"((?:[^"\\]|\\.)*)"', script):
            hit = classify_mac_shell(m.group(1).replace('\\"', '"'))
            if hit:
                return hit
    if MESSAGE_APPS.search(script) and re.search(r"(?i)\b(tell|Application\(|application\s+id)", script) and re.search(r"(?i)\b(send|post|reply|forward)\b", script):
        return "nachricht", clip(f"Sendet in deinem Namen: {script.strip()}")
    if re.search(r"\b(Calendar|Kalender)\b", script) and re.search(r"(?i)\b(attendee|Teilnehmer)\b", script) and re.search(r"(?i)\b(make|add|create)\b", script):
        return "nachricht", clip(f"Lädt Teilnehmer ein: {script.strip()}")
    if re.search(r"(?i)\b(delete|remove)\b", script) and re.search(r"\b(Calendar|Kalender|Reminders|Erinnerungen|Contacts|Kontakte|Notes|Notizen)\b", script):
        return "loeschen", clip(f"Löscht endgültig (kein Papierkorb): {script.strip()}")
    return None


# Apps, die ein Skript anspricht. Die Systemsperre lässt Apple Events nur an diese Apps zu (tools.py), Terminal & Co. nie.
APP_DIRS = ("/Applications", "/Applications/Utilities", "/System/Applications", "/System/Applications/Utilities", "/System/Library/CoreServices", "~/Applications")
TERMINALS = {"terminal", "iterm", "iterm2"}
CODE_APPS = {"script debugger", "bbedit", "hammerspoon", "warp", "ghostty", "kitty", "alacritty", "wezterm", "hyper", "xcode",
             "visual studio code", "visual studio code - insiders", "code", "vscode", "cursor", "zed", "zed preview",
             "antigravity", "claude", "chatgpt", "codex", "windsurf", "nova", "sublime text", "android studio", "rider", "intellij idea",
             "pycharm", "webstorm", "goland", "clion", "fleet"}  # führen selbst Code aus
NO_SCRIPT_APPS = TERMINALS | CODE_APPS | {"script editor", "skripteditor", "automator", "shortcuts", "kurzbefehle", "shortcuts events"}
# Befehle, die im Prozess der angesprochenen App (außerhalb der Sperre) laufen könnten; «event …» = dieselben Befehle als Rohcode
RUNS_ELSEWHERE = re.compile(r"(?i)\bdo\s+shell\s+script\b|\bdoShellScript\b|\brun\s+script\b|\brunScript\b|\bload\s+script\b|\bloadScript\b"
                            r"|\bsystem\s+attribute\b|\bsystemAttribute\b|«event"
                            r"|\beval\s*\(|\bFunction\s*\(|\]\s*\("
                            # Skripte an Apps laufen ohne Sperre: keine Brücke zu Systemcode (ObjC, $., Bibliotheken)
                            r"|¬|<<|\bopen\s+location\b|\bread\s+(?:file|POSIX|alias|\()|\bpath\s+to\b"  # Zeilenfortsetzung, Rohcode, Adressen und Dateien öffnen
                            r"|\bopen\s+for\s+access\b|\bopenForAccess\b|\bwrite\b[^\n]*\bto\b|\bset\s+eof\b|\bsetEof\b|\bstore\s+script\b|\bstoreScript\b"  # Dateien schreiben (StandardAdditions)
                            r"|\bObjC\b|\$\s*[.(\[]|\buse\s+framework\b|\bcurrent\s+application\b|\bglobalThis\b|\bthis\s*\[|\bLibrary\s*\(|\brequire\s*\(")  # JXA: berechnete Aufrufe könnten dieselben Befehle verstecken
ONCE_APPS = {"finder", "system events"}  # starten selbst Programme: nie „Immer erlauben“
AS_APP = re.compile(r'\b(?:application|app)\s+(?:id\s+)?"([^"]+)"', re.I)
JS_APP = re.compile(r"\bApplication\s*\(\s*([\"'`])([^\"'`]+)\1\s*\)")
COMPUTED_APP = re.compile(r"\bApplication\s*(\.|\[|\(\s*(?![\"'`][^\"'`]+[\"'`]\s*\)))|(?i:\btell\s+(?:application|app)\s+(?!(?:id\s+)?\"|process\b|file\b)|«class capp»)")
NO_SCRIPT = "Skripte für Terminal, iTerm, Code-Programme (z. B. Xcode, VS Code), Skripteditor, Automator oder Kurzbefehle sind in Orbit gesperrt."
NO_FOREIGN_SHELL = "Ein Skript, das eine App steuert, darf keine Befehle oder Systemcode ausführen (do shell script, run script, load script, system attribute, ObjC). Nutze dafür mac_shell."


GERMAN_APPS = {"notizen": "Notes", "kalender": "Calendar", "erinnerungen": "Reminders", "systemeinstellungen": "System Settings",
               "kontakte": "Contacts", "nachrichten": "Messages", "fotos": "Photos", "karten": "Maps", "musik": "Music", "vorschau": "Preview",
               "bücher": "Books", "sprachmemos": "Voice Memos", "rechner": "Calculator", "uhr": "Clock", "wetter": "Weather", "aktien": "Stocks",
               "wo ist?": "Find My", "schriftsammlung": "Font Book", "aktivitätsanzeige": "Activity Monitor", "bildschirmfoto": "Screenshot",
               "festplattendienstprogramm": "Disk Utility", "skripteditor": "Script Editor", "kurzbefehle": "Shortcuts", "kamera": "Photo Booth"}
_found: dict[str, str | None] = {}


def _info_bundle(app_path: str) -> str | None:
    try:
        with open(os.path.join(app_path, "Contents", "Info.plist"), "rb") as f:
            return plistlib.load(f).get("CFBundleIdentifier")
    except (OSError, ValueError, plistlib.InvalidFileException):
        return None


def _spotlight(name: str) -> list[str]:
    """Pfade passender Apps über Spotlight (auch in Unterordnern, Anzeigename oder Dateiname). Startet nichts, zeigt nichts."""
    q = name.replace("\\", "").replace("'", "")
    query = f"kMDItemContentType == 'com.apple.application-bundle' && (kMDItemDisplayName == '{q}'cd || kMDItemFSName == '{q}.app'cd)"
    try:
        out = subprocess.run(["/usr/bin/mdfind", query], capture_output=True, text=True, timeout=5).stdout
    except (OSError, subprocess.SubprocessError):
        return []
    return [p for p in out.splitlines() if p.endswith(".app")]


def app_bundle(name: str) -> str | None:
    """Bundle-ID aus dem Info.plist der App (ohne LaunchServices: nichts startet, kein Dialog). Eine Bundle-ID bleibt, wie sie ist.
    Deutsche Anzeigenamen der Standard-Apps zuerst übersetzen; sonst Spotlight (Apps in Unterordnern)."""
    base = os.path.basename(name.rstrip("/"))
    base = base[:-4] if base.lower().endswith(".app") else base
    if base == name and re.fullmatch(r"[\w-]+(\.[\w-]+)+", name):
        return name
    base = GERMAN_APPS.get(base.lower(), base)
    for d in APP_DIRS:
        found = _info_bundle(os.path.join(os.path.expanduser(d), base + ".app"))
        if found:
            return found
    if base not in _found:
        _found[base] = next(filter(None, map(_info_bundle, _spotlight(base))), None)
    return _found[base]


def code_app(bundle: str | None, name: str | None) -> bool:
    """Terminal, Code-Programm oder App mit eingebautem Terminal: dort tippt, klickt und skriptet Orbit nicht."""
    b, n = (bundle or "").lower(), os.path.basename((name or "").rstrip("/")).lower().removesuffix(".app")
    return b in {x.lower() for x in sandbox.NO_EVENTS} or b.startswith("com.jetbrains.") or n in TERMINALS | CODE_APPS


def _no_script_app(name: str) -> bool:
    base = os.path.basename(name.rstrip("/")).lower().removesuffix(".app")
    return base in NO_SCRIPT_APPS or (app_bundle(name) or "").lower() in {b.lower() for b in sandbox.NO_EVENTS}


COMMENTS = re.compile(r"\(\*.*?\*\)|/\*.*?\*/|--[^\n]*|//[^\n]*|^\s*#[^\n]*", re.S | re.M)


def script_apps(script: str) -> tuple[list[str], bool]:
    """(genannte Apps, Name wird erst beim Ausführen berechnet). Kommentare zählen nicht (sonst liefe ein Skript ohne App ohne Sperre)."""
    script = COMMENTS.sub(" ", script)
    names = [m.group(1) for m in AS_APP.finditer(script)] + [m.group(2) for m in JS_APP.finditer(script)]
    return list(dict.fromkeys(names)), bool(COMPUTED_APP.search(script))


NO_JXA_APPS = "JavaScript (JXA) an Apps ist gesperrt: es läuft ohne Systemsperre und lässt sich nicht sicher prüfen. Nutze AppleScript."


def classify_script_apps(script: str, language: str = "AppleScript"):
    """Terminal & Co. hart ablehnen (Fail); jede andere angesprochene App braucht eine Karte je App."""
    names, computed = script_apps(script)
    if (names or computed) and str(language).lower() == "javascript":
        raise Fail(NO_JXA_APPS)
    if any(map(_no_script_app, names)) or re.search(r"(?i)\bdo\s+script\b|\bdoScript\b|\bshortcuts\s+run\b", script):
        raise Fail(NO_SCRIPT)
    if not names and not computed:
        return None
    if RUNS_ELSEWHERE.search(script):  # liefe im Prozess der fremden App, außerhalb der Sperre
        raise Fail(NO_FOREIGN_SHELL)
    missing = next((n for n in names if not app_bundle(n)), None)
    if missing:  # sonst liefe das Skript mit leerer Erlaubnisliste und scheiterte erst nach der Freigabe mit einem falschen Rechte-Hinweis
        raise Fail(f"App „{missing}“ nicht gefunden. Nutze den Namen, unter dem sie im Programme-Ordner liegt.")
    shown = sorted(names, key=str.lower) + (["?"] if computed else [])
    once = True  # Skripte an Apps laufen ohne Systemsperre (sonst -10004): nie „Immer erlauben“
    return "system", f"mac_applescript:app:{'+'.join(shown)}" + (":einmal" if once else ""), clip(f"Steuert {', '.join(shown)}: {script.strip()}")


def classify_shortcut(name: str):
    n = name.lower()
    for pattern, reason, text in (
        (r"(kauf|bezahl|bestell|pay|buy|order|überweis)", "geld", "kann Geld ausgeben"),
        (r"(post|tweet|veröffentlich|publish|teilen|share|send|nachricht|message|mail|imessage|sms|antwort)", "nachricht", "sendet oder veröffentlicht in deinem Namen"),
        (r"(lösch|delete|leeren|empty)", "loeschen", "löscht"),
    ):
        if re.search(pattern, n):
            return reason, clip(f"Kurzbefehl „{name}“ {text}")
    return None


# ---------------------------------------------------------------- Dateien, Öffnen, Browser
SECRET_PATH = re.compile(
    r"/\.(ssh|aws|gnupg|kube|netrc|npmrc|pypirc)(/|$)|/\.docker/config\.json$|/\.config/(gcloud|gh)(/|$)|/library/keychains(/|$)"
    r"|/library/application support/orbit/service\.token$|/\.codex/auth\.json$|/\.claude/\.credentials\.json$"
    r"|/\.env(\.[^/]*)?$|\.(pem|p12|pfx|key)$|/id_(rsa|ed25519|ecdsa|dsa)[^/]*$"
    r"|/([^/]*[._-])?(tokens?|credentials?|secrets?|passwords?|passwd)([._-][^/]*)?$")
SYSTEM_PATH = re.compile(
    r"/library/(launchagents|launchdaemons|startupitems|loginitems)(/|$)|/\.ssh(/|$)|^/etc/|^/private/etc/|^/var/(at|spool/cron)(/|$)"
    r"|/(\.zshrc|\.zprofile|\.zshenv|\.zlogin|\.zlogout|\.bashrc|\.bash_profile|\.bash_login|\.profile|crontab)$|/\.config/fish/config\.fish$|/\.git/hooks(/|$)")


def _paths(path: str) -> list[str]:
    """Der Pfad wie angegeben (~ und .. aufgelöst) und nach Auflösung der Verweise, klein geschrieben (macOS ignoriert die Schreibweise)."""
    plain = os.path.abspath(os.path.expanduser(path))
    return list({plain.lower(), os.path.realpath(plain).lower()})


def classify_files(a: dict, run=None):
    for target in [a.get(k) for k in ("path", "to")] + [x for x in (a.get("paths") or []) if isinstance(a.get("paths"), list)]:
        if isinstance(target, str) and target and touches_orbit_dir(target, run):
            return "geheimnis", clip(f"Greift auf Orbits Daten oder Zugangsdaten zu: {target}")
    act, texts = a.get("action"), {"read": "Liest Zugangsdaten", "write": "Greift ins System ein", "append": "Greift ins System ein"}
    targets = {"read": [a.get("path")], "write": [a.get("path")], "append": [a.get("path")], "move": [a.get("path"), a.get("to")]}.get(act, [])
    for target in filter(lambda t: isinstance(t, str) and t, targets):
        for p in _paths(target):
            if act in ("write", "append", "move") and SYSTEM_PATH.search(p):
                return "system", clip(f"{texts.get('write')}: {target}")
            if act in ("read", "move") and SECRET_PATH.search(p):
                return "geheimnis", clip(f"{texts['read']}: {target}")
    return None


def classify_url(url: str):
    """javascript:/file:/data: = system; Adresse im Internet mit Anhang (?…) kann Daten nach außen tragen = nachricht."""
    u = urlsplit(url.strip())
    if u.scheme.lower() not in ("http", "https"):
        return ("system", clip(f"Öffnet {url.strip()}")) if u.scheme and u.scheme.lower() not in ("mailto", "tel", "sms", "facetime") else None
    if (u.query or u.fragment) and not LOCAL_HOST.match(url.strip()):
        return "nachricht", clip(f"Schickt Daten nach außen an: {url.strip()}")
    return None


# mac_open: Erlaubnisliste. Nur Dokumente, Bilder, Audio/Video, Text, PDF, Office; Archive nur im Finder zeigen; Ordner; http/https/mailto
OPEN_FILES = re.compile(r"(?i)\.(pdf|txt|md|markdown|rtf|rtfd|csv|tsv|log|pages|numbers|key|docx?|xlsx?|pptx?|odt|ods|odp|epub"
                        r"|png|jpe?g|gif|heic|heif|tiff?|bmp|webp|mp3|m4a|aac|wav|aiff?|flac|mp4|mov|m4v|avi|mkv)$")
OPEN_REVEAL = re.compile(r"(?i)\.(zip|tar|gz|tgz|bz2|xz|7z|rar)$")  # „open“ würde entpacken: nur zeigen (open -R)
OPEN_LINK = re.compile(r"(?i)\.(webloc|inetloc)$")  # Lesezeichen: nur mit http/https/mailto darin
OPEN_SCHEMES = ("http", "https", "mailto")
BUNDLE_DIR = re.compile(r"(?i)\.(app|bundle|framework|plugin|kext|prefpane|workflow|action|scptd|xpc|appex|saver|qlgenerator|mdimporter|wdgt|terminal)$")
NO_OPEN = "Orbit öffnet nur Dokumente, Bilder, Audio, Video, Ordner und Web- oder Mail-Adressen."


def _open_path(target: str) -> tuple[str, str]:
    """(Pfad wie angegeben, aufgelöster Pfad) oder Fail. Datei-Adressen (file:) zählen als Pfad, sonst nur http/https/mailto."""
    t = target.strip()
    scheme = urlsplit(t).scheme.lower() if re.match(r"[a-z][\w+.-]*:", t, re.I) else ""
    if scheme and scheme != "file":
        if scheme not in OPEN_SCHEMES:
            raise Fail(NO_OPEN)
        return "", ""
    plain = os.path.abspath(os.path.expanduser(unquote(urlsplit(t).path) if scheme else t))
    if os.path.islink(plain) and not os.path.exists(plain):  # Verweis ins Leere: nicht prüfbar
        raise Fail(NO_OPEN)
    return plain, os.path.realpath(plain)


def _link_url(path: str) -> str:
    try:
        with open(path, "rb") as f:
            url = plistlib.load(f).get("URL")
    except (OSError, ValueError, plistlib.InvalidFileException):
        url = None
    if not isinstance(url, str) or urlsplit(url).scheme.lower() not in OPEN_SCHEMES:
        raise Fail(NO_OPEN)
    return url


def check_open(a: dict) -> str | None:
    """mac_open: Terminal und Code-Programme hart ablehnen; Ziele nur nach Erlaubnisliste (sonst Fail, keine Karte).
    Liefert die Adresse in einem Lesezeichen (.webloc), damit sie wie eine Adresse geprüft wird."""
    app, target = a.get("app"), a.get("target")
    if isinstance(app, str) and app.strip() and (code_app(None, app.strip()) or app_bundle(app.strip()) and code_app(app_bundle(app.strip()), None)
                                                 or (app_bundle(app.strip()) or "") in sandbox.NO_EVENTS):
        raise Fail("Terminal, iTerm und Code-Programme darf Orbit nicht öffnen.")
    if isinstance(app, str) and app.strip():  # nur installierte Programme beim Namen, nie ein Pfad (ein selbst gebautes Bündel liefe außerhalb der Sperre)
        name = GERMAN_APPS.get(app.strip().lower(), app.strip()).removesuffix(".app")
        if "/" in name or not any(os.path.isdir(os.path.join(d, name + ".app")) for d in APP_DIRS if not d.startswith("~")):
            raise Fail("Orbit öffnet nur Programme aus dem Programme-Ordner, beim Namen genannt.")
    if not isinstance(target, str) or not target.strip():
        return None
    plain, real = _open_path(target)
    if not plain:
        return None
    names = {plain, real}
    if os.path.isdir(real):
        if any(BUNDLE_DIR.search(p.rstrip("/")) for p in names) or os.path.exists(os.path.join(real, "Contents")):
            raise Fail(NO_OPEN)  # Programme und andere Pakete sind keine Ordner
        return None
    try:
        with open(real, "rb") as f:
            if f.read(4) == b"book":  # Finder-Alias (Lesezeichen-Daten): Ziel ohne Finder nicht sicher auflösbar
                raise Fail(NO_OPEN)
    except OSError:
        pass  # gibt es (noch) nicht: open meldet das selbst
    if all(OPEN_LINK.search(p) for p in names) and os.path.isfile(real):
        return _link_url(real)
    if not all(OPEN_FILES.search(p) or OPEN_REVEAL.search(p) for p in names):
        raise Fail(NO_OPEN)
    return None


def reveal_only(target: str) -> bool:
    """Archive nur im Finder zeigen, nicht öffnen (öffnen = entpacken)."""
    return bool(OPEN_REVEAL.search(target.strip()))


def classify_open(a: dict, run=None):
    link = check_open(a)
    target = a.get("target")
    if link:
        return classify_service(link, run) or classify_url(link)
    if isinstance(target, str) and re.match(r"[a-z][\w+.-]*:", target, re.I):
        return classify_service(target, run) or classify_url(target)
    if isinstance(target, str) and touches_orbit_dir(target, run):
        return "geheimnis", clip(f"Öffnet Orbits Daten: {target}")
    if isinstance(target, str) and any(SYSTEM_PATH.search(p) for p in _paths(target)):
        return "system", clip(f"Öffnet: {target}")
    return None


# ---------------------------------------------------------------- Orbits eigener Datenordner und Dienst (Freigabe-Tor schützen)
ORBIT_NAMES = re.compile(r"orbit\.sqlite|service\.token|secrets\.env")
ORBIT_DIR = re.compile(r"application support/orbit(?![\w-])")
CMD_POS = r"(?:^|[;&|(`\n]|\$\(|\s-\w*c\s|\bscript\s|\b(?:sudo|env|xargs|exec|command|time|nohup|nice|timeout)\s)\s*(?:\S+=\S*\s+)*(?:\S*/)?"
TOOL_HEADS = re.compile(CMD_POS + r"(sqlite3|security|launchctl)(?=\s|$)")
DECODERS = re.compile(CMD_POS + r"(base64\s+(-d|-D|--decode)|xxd\s+-\w*r)\b")  # verstecken Pfade vor der Prüfung
LOCAL_ADDR = re.compile(r"localhost|(?<![\w.])127\.\d+\.\d+\.\d+|(?<![\w.])127\.1(?![\w.])|\[?::1?\]|(?<![\w:])::1|0\.0\.0\.0|0x7f[0-9a-f]*|2130706433|orbitd_port|(?<![\w.])0(?=:\d)")


def _orbit_cfg(run) -> tuple[Path, int]:
    cfg = getattr(getattr(run, "ctx", None), "cfg", None)
    return (cfg.data_dir, cfg.port) if cfg else (REAL_DATA_DIR, 4317)


def _data_dirs(run) -> set[str]:
    d = _orbit_cfg(run)[0]
    return {str(x).lower().rstrip("/") for x in (os.path.abspath(d), os.path.realpath(d))}


def touches_orbit_dir(path: str, run) -> bool:
    """Liegt der Pfad (~ und .. aufgelöst, auch über Verweise) im Datenordner? Der Anhänge-Ordner `uploads` gehört nicht dazu."""
    for p in _paths(path):
        for d in _data_dirs(run):
            if (p == d or p.startswith(d + "/")) and not p.startswith(d + "/uploads/"):
                return True
    return False


def _flat(text: str) -> str:
    """Schreibweisen glätten: Anführungszeichen, Escapes, ~ und $HOME ausschreiben, // und .. auflösen, klein."""
    home = os.path.expanduser("~")
    t = re.sub(r"[\\'\"{}]", "", text.replace("\\ ", " ")).replace("~/", home + "/").replace("$HOME", home).lower()
    t = re.sub(r"/{2,}", "/", t.replace("/./", "/"))
    while (n := re.sub(r"/[^/]+/\.\./", "/", t)) != t:
        t = n
    return t


def classify_service(text: str, run):
    """Jede Anfrage an den eigenen Dienst (Adresse und Port im Text, egal mit welchem Programm) braucht eine Karte."""
    port = _orbit_cfg(run)[1]
    flat = _flat(text)
    if LOCAL_ADDR.search(flat) and re.search(rf"(?<![\w.])({port}(?!\d)|\$orbitd_port)", flat):
        return "system", clip(f"Spricht mit Orbits eigenem Dienst: {text.strip()}")
    return None


def classify_orbit(text: str, run, cwd: str | None = None):
    """Shell und AppleScript: Bezug auf Orbits Datenordner, Datenbank, Token, Schlüsselbund oder den eigenen Dienst."""
    flat = _flat(text)
    for d in _data_dirs(run):
        flat = flat.replace(d + "/uploads/", "")
    paths = flat.replace(":", "/")
    hit = ORBIT_NAMES.search(flat) or ORBIT_DIR.search(re.sub(r"/{2,}", "/", paths)) or any(re.search(re.escape(d) + r"(?![\w.-])", paths) for d in _data_dirs(run))
    if not hit:  # Verweise (Symlinks) auf den Datenordner: jedes Wort, das wie ein Pfad aussieht, auflösen
        base = os.path.expanduser(cwd) if cwd else os.path.expanduser("~")
        words = re.split(r"[\s;|&<>()=,]+", text.replace("\\ ", "\0"))
        hit = any(w and ("/" in w or w.startswith(".")) and touches_orbit_dir(os.path.join(base, os.path.expanduser(w.replace("\0", " ").strip("'\""))), run) for w in words[:60])
    if hit:
        return "geheimnis", clip(f"Greift auf Orbits Daten oder Zugangsdaten zu: {text.strip()}")
    head = TOOL_HEADS.search(flat)
    if head:
        return ("system", clip(f"Greift ins System ein: {text.strip()}")) if head.group(1) == "launchctl" else \
            ("geheimnis", clip(f"Liest oder ändert Datenbank oder Schlüsselbund: {text.strip()}"))
    if DECODERS.search(flat):
        return "system", clip(f"Entschlüsselt Text vor dem Ausführen: {text.strip()}")
    return classify_service(text, run)


# ---------------------------------------------------------------- Einstieg für die Werkzeuge
foreign = contract.foreign  # Orbi-Nachricht oder Fremddaten (extern: auch aus derselben CLI-Sitzung davor; eigen: nur dieser Lauf)


def risk_of(tool: str, run, args: dict) -> Risk | None:
    """Risk für ein mac_*-Werkzeug oder None.

    Freigabekarten erzeugt nur interactions.gate für geld/nachricht/login.
    Andere Gründe (system, loeschen, …) bleiben als Risk, damit Deny-Regeln greifen.
    """
    if tool == "mac_browser" and args.get("action") == "open" and isinstance(args.get("url"), str):
        raw = args["url"]
        url = re.sub(r"[\x00-\x20]", "", raw).lower()
        if url and not url.startswith(("http:", "https:", "mailto:")):
            raise Fail("Nur Web-Adressen (http/https) oder mailto sind erlaubt.")
        # bereinigte Adresse weitergeben (kein Steuerzeichen-Trick)
        if url != raw.lower():
            args = {**args, "url": url}
    return _base_risk(tool, run, args)


def _base_risk(tool: str, run, args: dict) -> Risk | None:
    if tool in ("mac_input", "mac_screen"):
        return None  # Mac bedienen: weder Karte noch Deny-Art
    if tool == "mac_clipboard" and args.get("action") == "read":
        return Risk("geheimnis", "mac_clipboard:geheimnis", "Liest die Zwischenablage")  # Deny möglich, keine Karte (Tor)
    apps = classify_script_apps(args["script"], args.get("language", "AppleScript")) if tool == "mac_applescript" and isinstance(args.get("script"), str) else None  # Terminal & Co.: Fail vor allem anderen
    if tool in ("mac_shell", "mac_applescript") and isinstance(args.get("command" if tool == "mac_shell" else "script"), str):
        hit = classify_orbit(args["command" if tool == "mac_shell" else "script"], run, args.get("cwd"))
        if hit:
            return Risk(hit[0], f"{tool}:{hit[0]}" + (":dienst" if "eigenem Dienst" in hit[1] else ""), hit[1])
    special = {"mac_files": lambda a: classify_files(a, run), "mac_open": lambda a: classify_open(a, run),
               "mac_browser": lambda a: (classify_service(re.sub(r"[\x00-\x20]", "", a["url"]), run) or classify_url(a["url"])) if a.get("action") == "open" and isinstance(a.get("url"), str) else None}.get(tool)
    if special:
        hit = special(args)
        return Risk(hit[0], f"{tool}:{hit[0]}" + (":dienst" if "eigenem Dienst" in hit[1] else ""), hit[1]) if hit else None
    check = {"mac_shell": ("command", classify_mac_shell), "mac_applescript": ("script", classify_applescript), "mac_shortcut": ("name", classify_shortcut)}.get(tool)
    if not check or not isinstance(args.get(check[0]), str):
        return None
    hit = check[1](args[check[0]])
    return Risk(hit[0], f"{tool}:{hit[0]}", hit[1]) if hit else Risk(*apps) if apps else None
