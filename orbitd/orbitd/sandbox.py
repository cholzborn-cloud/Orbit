"""Systemsperre (macOS sandbox-exec): Unterprozesse dürfen den Orbit-Datenordner weder lesen noch schreiben.
Die Sperre gilt für den ganzen Prozessbaum und gilt auch gegen Glob, zusammengesetzte Pfade und Skripte; Befehls-Erkennung (risk.py) bleibt davor.
Ausnahmen: `uploads` (Anhänge, nur lesen) und `mac-shim` (Papierkorb-Shim der Shell, nur lesen).
setuid-Programme (sudo, crontab, at) und Aufträge an launchd (launchctl submit/bootstrap) verweigert macOS unter jeder Sperre schon selbst.
"""
import logging
import os
import sys
from pathlib import Path

from .config import REAL_DATA_DIR, isolated_dir

log = logging.getLogger("orbitd")
EXEC = "/usr/bin/sandbox-exec"
READ_ONLY = ("uploads", "mac-shim")
CLI_BIN = "cli-bin"  # getrenntes Profil: Ersatz-`security` (cli/base.py), steht im PATH vor allem anderen
# Schlüsselbund über die Programmierschnittstelle (auch ohne /usr/bin/security, z. B. JXA oder Python); TLS (trustd) bleibt frei
KEYCHAIN = ("com.apple.SecurityServer", "com.apple.securityd.xpc")
# Apps, über die ein Skript Befehle außerhalb der Sperre ausführen könnte: Apple Events dorthin sind immer gesperrt
NO_EVENTS = ("com.apple.Terminal", "com.googlecode.iterm2", "com.apple.ScriptEditor2", "com.apple.Automator", "com.apple.shortcuts", "com.apple.shortcuts.events",
             # Apps, die selbst Code ausführen (Xcode und VS Code am Mac geprüft; die übrigen sperrt zusätzlich der Name in risk.CODE_APPS)
             "com.apple.dt.Xcode", "com.microsoft.VSCode", "com.microsoft.VSCodeInsiders", "com.todesktop.230313mzl4w4u92", "dev.zed.Zed",
             "com.latenightsw.ScriptDebugger8", "com.barebones.bbedit", "org.hammerspoon.Hammerspoon", "dev.warp.Warp-Stable", "com.mitchellh.ghostty",
             "net.kovidgoyal.kitty", "org.alacritty", "com.github.wez.wezterm", "co.zeit.hyper",
             # mit eingebautem Terminal oder Code-Agent (Prüfer 7. Runde)
             "com.google.antigravity", "com.anthropic.claudefordesktop", "com.openai.codex", "com.openai.chat", "com.exafunction.windsurf",
             "com.panic.Nova", "com.sublimetext.4", "com.google.android.studio", "com.jetbrains.rider", "com.jetbrains.intellij", "com.jetbrains.pycharm",
             "com.jetbrains.WebStorm", "com.jetbrains.goland", "com.jetbrains.CLion", "com.jetbrains.fleet")
# Mac-Shell (launch=False): nichts anlegen, was später von selbst außerhalb der Sperre läuft (Shell-Start, SSH, Git, launchd)
AUTOSTART_DIRS = ("Library/LaunchAgents", ".ssh", ".config/fish", ".config/git", "Applications",
                  # Programme und ihre Einstellungen: der nächste Lauf startet sie mit Schlüsselbund-Zugang
                  ".local/bin", ".claude", ".cursor", ".codex", ".gemini", ".antigravity")
AUTOSTART_FILES = (".claude.json", ".zshrc", ".zprofile", ".zshenv", ".zlogin", ".zlogout", ".bashrc", ".bash_profile", ".bash_login", ".profile", ".gitconfig")
_cfg = None
_warned = False


def use(cfg) -> None:
    """Merkt die Einstellungen für alle Aufrufer ohne eigene cfg (Mac-Werkzeuge, ProcessTree)."""
    global _cfg
    _cfg = cfg


def _q(path) -> str:
    return '"' + str(path).replace("\\", "\\\\").replace('"', '\\"') + '"'


def _family(path) -> list:
    return list(dict.fromkeys([Path(path).resolve(), Path(path).absolute()]))  # echter und unaufgelöster Pfad


def profile(cfg, *, allow_service: bool, allow_security: bool, keychain: bool = True, launch: bool = True, events=True, cli: bool = False) -> str:
    """Getrenntes Profil: kein `security` und kein Schlüsselbund-Ordner; die Programme speichern ihre Anmeldung als Datei in cli-home.
    keychain=False: kein Schlüsselbund-Dienst. launch=False: nichts über LaunchServices öffnen oder starten, keine LaunchAgents schreiben.
    events: True = Apple Events an alle (außer NO_EVENTS), sonst nur an die Bundle-IDs in `events` (leer = keine)."""
    rules = ["(version 1)", "(allow default)"]
    rules += [f"(deny file-read* file-write* (subpath {_q(d)}))" for d in _family(cfg.data_dir)]
    rules += [f"(allow file-read* (subpath {_q(d / sub)}))" for d in _family(cfg.data_dir) for sub in READ_ONLY]  # später gewinnt
    isolated = isolated_dir()
    if isolated is not None:
        allow_security = False
        keychain = keychain and cli
        home = Path.home()
        legacy = (REAL_DATA_DIR, home / ".second-brain", *(home / x for x in (
            ".claude", ".claude.json", ".codex", ".cursor", ".gemini", ".antigravity",
            "Library/Application Support/Claude", "Library/Application Support/Cursor", "Library/Keychains")))
        rules += [f"(deny file-read* file-write* (subpath {_q(d)}))" for path in legacy for d in _family(path)]
        if cli:
            # Nur die Metadaten des Datenordners selbst (kein Inhalt): Codex löst CODEX_HOME mit realpath() auf und
            # bricht sonst mit „failed to canonicalize CODEX_HOME … Operation not permitted“ ab (am Mac geprüft, 19.11.).
            rules += [f"(allow file-read-metadata (literal {_q(d)}))" for d in _family(isolated)]
            rules += [f"(allow file-read* file-write* (subpath {_q(d)}))" for d in _family(isolated / "cli-home")]
            rules += [f"(allow file-read* (subpath {_q(d)}))" for d in _family(isolated / "setup")]
            rules += [f"(allow file-read* (subpath {_q(d)}))" for d in _family(isolated / CLI_BIN)]  # Ersatz-`security`, nur lesen
    if not allow_security:
        rules.append('(deny process-exec (literal "/usr/bin/security"))')
    if not keychain:
        rules.append("(deny mach-lookup " + " ".join(f"(global-name {_q(n)})" for n in KEYCHAIN) + ")")
    if not allow_service:
        rules.append(f'(deny network-outbound (remote tcp "localhost:{cfg.port}"))')  # Seatbelt kennt nur „localhost“; das gilt für 127.0.0.1 und ::1 (Test)
    if not launch:
        rules.append("(deny lsopen)")
        home = Path.home()
        rules += [f"(deny file-write* (subpath {_q(d)}))" for sub in AUTOSTART_DIRS for d in _family(home / sub)]
        rules += [f"(deny file-write* (literal {_q(f)}))" for name in AUTOSTART_FILES for f in _family(home / name)]
        rules += [f"(deny file-write* (subpath {_q(d)}))" for d in _family(Path("/Applications"))]
        rules.append('(deny file-write* (regex #"/\\.git/hooks(/|$)"))')  # Git-Hooks laufen später bei jedem git-Befehl
    if events is not True:
        rules.append("(deny appleevent-send)")
        rules += [f"(allow appleevent-send (appleevent-destination {_q(b)}))" for b in events]
    rules += [f"(deny appleevent-send (appleevent-destination {_q(b)}))" for b in NO_EVENTS]
    return "".join(rules)


def wrap(argv: list[str], cfg=None, *, allow_service: bool = False, allow_security: bool = False, keychain: bool = True,
         launch: bool = True, events=True, cli: bool = False) -> list[str]:
    global _warned
    cfg = cfg or _cfg
    if cfg is None or not getattr(cfg, "sandbox", True):
        return argv
    if sys.platform != "darwin" or not os.access(EXEC, os.X_OK):
        if not _warned:
            _warned = True
            log.warning("sandbox-exec fehlt: Unterprozesse laufen ohne Systemsperre.")
        return argv
    if isolated_dir() is not None and cli:
        keychain = Path(argv[0]).name == "codex" and keychain  # Codex braucht nur die Dienste (ohne `security`), live belegt 13.11.
    return [EXEC, "-p", profile(cfg, allow_service=allow_service, allow_security=allow_security, keychain=keychain, launch=launch, events=events, cli=cli), *argv]
