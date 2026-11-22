"""Gemeinsame Schnittstelle für die vier Agent-CLIs.

Vorbilder:
- Vibe Kanban (Apache-2.0): eine Schnittstelle, je CLI ein eigenes Modul (crates/executors).
- regnull/openbot runtime/cli_agents/base.py: ProcessTree (eigene Prozessgruppe, SIGTERM -> Frist -> SIGKILL).

Jeder Adapter übersetzt die Ausgabe seiner CLI in dieselben Ereignisse (Ev). Die Laufzeit kennt nur diese.
"""
import asyncio
import os
import shutil
import signal
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import AsyncIterator

from .. import sandbox
from ..config import profile_cli_home

KILL_GRACE = 5.0  # Sekunden zwischen SIGTERM und SIGKILL
STDERR_KEEP = 16 * 1024
READ_LIMIT = 32 * 1024 * 1024  # eine Ausgabezeile darf groß sein (Werkzeug-Ergebnisse)


@dataclass
class Ev:
    """kind: session{id} | text{delta} | think{delta} | tool_start{id,name,input} | tool_end{id,name,ok,output}
    | usage{inputTokens,outputTokens,cachedTokens,costUsd} | limits{windows:[{name,used,resetAt}],blocked}
    | error{text} | done{reason}"""
    kind: str
    data: dict = field(default_factory=dict)


@dataclass
class Turn:
    """Ein Zug an eine CLI."""
    prompt: str
    system: str            # Anleitung (Systemtext)
    model: str             # Modellname der CLI; wird bei JEDEM Zug ausdrücklich mitgegeben
    effort: str | None
    cwd: Path
    session: str | None    # Sitzung der CLI zum Fortsetzen
    mcp_url: str           # Orbit-Werkzeuge (MCP) für diesen Lauf
    run_token: str         # Einmal-Token des Laufs (kein gespeicherter Schlüssel)
    fast: str | None = None  # Fast-Dienst des Modells (Codex: service_tier-Name), nur wenn gewünscht und vorhanden
    images: list = field(default_factory=list)  # [{mediaType, base64}] für Modelle mit Bild-Eingabe (Claude)


class CliError(Exception):
    """Fertiger deutscher Satz für den Chat."""


TRACE = os.environ.get("ORBIT_CLI_TRACE") if os.environ.get("ORBIT_CLI_TRACE", "").startswith("/") else None  # nur ein ganzer Pfad (sonst landet die Datei im Arbeitsordner)


class ProcessTree:
    """Ein CLI-Prozess in eigener Prozessgruppe, damit Stopp wirklich alle Unterprozesse trifft."""

    def __init__(self, proc: asyncio.subprocess.Process):
        self.proc = proc
        self.pgid = proc.pid  # start_new_session=True: pgid == pid
        self._err = bytearray()  # letzte STDERR_KEEP Byte; die CLI darf nie an einer vollen stderr-Pipe hängen
        self._err_task = asyncio.create_task(self._drain_stderr())

    async def _drain_stderr(self) -> None:
        try:
            while chunk := await self.proc.stderr.read(4096):
                self._err += chunk
                del self._err[:-STDERR_KEEP]
        except Exception:
            pass

    @classmethod
    async def spawn(cls, argv: list[str], cwd: Path, env: dict[str, str], keychain: bool = False, keychain_api: bool = False) -> "ProcessTree":
        """keychain: Schlüsselbund erlaubt (Programm `security` und die Dienste dahinter), nur für Programme, die ihre Anmeldung dort holen.
        keychain_api: nur die Dienste (ohne `security`), für Programme, die sie selbst über die Programmierschnittstelle brauchen."""
        cwd.mkdir(parents=True, exist_ok=True)
        env = profile_env(env)
        argv = profile_command(argv)
        if not shutil.which(argv[0], path=env.get("PATH")):  # sandbox-exec würde das Fehlen verschlucken
            raise CliError(f"Das Programm „{Path(argv[0]).name}“ wurde nicht gefunden.")
        try:
            proc = await asyncio.create_subprocess_exec(
                *sandbox.wrap(argv, allow_service=True, allow_security=keychain, keychain=keychain or keychain_api, cli=True), cwd=cwd, env=env, limit=READ_LIMIT, start_new_session=True,
                stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        except FileNotFoundError:
            raise CliError(f"Das Programm „{Path(argv[0]).name}“ wurde nicht gefunden.") from None
        return cls(proc)

    def _signal(self, sig: int) -> None:
        try:
            os.killpg(self.pgid, sig)
        except ProcessLookupError:
            pass

    def alive(self) -> bool:
        try:
            os.killpg(self.pgid, 0)
            return True
        except ProcessLookupError:
            return False
        except PermissionError:
            return True

    async def kill(self) -> None:
        """SIGTERM an die ganze Gruppe, nach der Frist SIGKILL. Wartet, bis die Gruppe leer ist."""
        self._signal(signal.SIGTERM)
        deadline = asyncio.get_running_loop().time() + KILL_GRACE
        while self.alive() and asyncio.get_running_loop().time() < deadline:
            if self.proc.returncode is None:
                try:
                    await asyncio.wait_for(asyncio.shield(self.proc.wait()), 0.1)
                except asyncio.TimeoutError:
                    pass
            else:
                await asyncio.sleep(0.05)
        self._signal(signal.SIGKILL)
        if self.proc.returncode is None:
            await self.proc.wait()
        self._err_task.cancel()

    async def lines(self, *, trace: bool = True) -> AsyncIterator[str]:
        while line := await self.proc.stdout.readline():
            text = line.decode("utf-8", "replace").strip()
            if text:
                if TRACE and trace:  # nur zur Fehlersuche: rohe Zeilen des Programms in eine Datei
                    with open(TRACE, "a") as f:
                        f.write(text + "\n")
                yield text

    async def send(self, text: str, close: bool = False) -> None:
        self.proc.stdin.write(text.encode())
        await self.proc.stdin.drain()
        if close:
            self.proc.stdin.close()

    async def stderr_tail(self, limit: int = 2000) -> str:
        try:
            await asyncio.wait_for(asyncio.shield(self._err_task), 2)  # bis EOF, damit das Ende vollständig ist
        except (asyncio.TimeoutError, asyncio.CancelledError):
            pass
        return bytes(self._err).decode("utf-8", "replace")[-limit:]


def profile_command(argv: list[str]) -> list[str]:
    home = profile_cli_home()
    if home is not None and Path(argv[0]).name == "codex":
        # Force private file storage even for exec invocations that ignore config.toml.
        (home / ".codex").mkdir(mode=0o700, exist_ok=True)
        return [argv[0], "-c", 'cli_auth_credentials_store="file"', *argv[1:]]
    return argv


# Getrenntes Profil: Ersatz für /usr/bin/security, damit Claude Code seine Anmeldung als Datei speichert
# (CLAUDE_CONFIG_DIR/.credentials.json). Claude 2.1.323 ruft `security` über den PATH auf und nimmt die Datei nur,
# wenn der Schlüsselbund sauber „leer“ meldet: Lesen/Löschen -> 44 (kein Eintrag), Schreiben -> 1 (Fehler, sofort).
# Nie 36 (gesperrt) und nie langsam: beides gilt als vorübergehend, dann speichert Claude gar nicht.
# Den echten Schlüsselbund sperrt zusätzlich die Systemsperre (sandbox.py).
SECURITY_SHIM = """#!/bin/sh
# Orbit: kein Schlüsselbund im getrennten Profil. Die Programme speichern ihre Anmeldung als Datei.
case "$1" in
  find-generic-password|find-internet-password|delete-generic-password|delete-internet-password) exit 44 ;;
  -i) cat >/dev/null 2>&1; exit 1 ;;
esac
exit 1
"""


def security_shim_dir(data: Path) -> Path:
    """Legt den Ersatz-`security` im Datenordner an (Programme dürfen ihn nur lesen, siehe sandbox.CLI_BIN)."""
    bin_dir = data / sandbox.CLI_BIN
    shim = bin_dir / "security"
    try:
        if shim.read_text() == SECURITY_SHIM and os.access(shim, os.X_OK):
            return bin_dir
    except OSError:
        pass
    bin_dir.mkdir(mode=0o755, exist_ok=True)
    tmp = bin_dir / ".security.tmp"
    tmp.write_text(SECURITY_SHIM)
    tmp.chmod(0o755)
    tmp.replace(shim)
    return bin_dir


def profile_env(env: dict[str, str]) -> dict[str, str]:
    home = profile_cli_home()
    if home is None:
        return env
    # The child process starts from an independent home and a small environment allowlist.
    # The service and native process retain their ordinary environment.
    clean = {k: v for k, v in env.items() if k in ("PATH", "LANG", "LC_CTYPE", "TMPDIR", "TERM", "ORBIT_RUN_TOKEN", "ORBIT_MCP_URL", "MCP_TOOL_TIMEOUT")}
    clean.update({"HOME": str(home), "XDG_CONFIG_HOME": str(home / ".config"),
                  "XDG_DATA_HOME": str(home / ".local/share"), "XDG_CACHE_HOME": str(home / ".cache"),
                  "CODEX_HOME": str(home / ".codex"), "CLAUDE_CONFIG_DIR": str(home / ".claude"),
                  "AGENT_CLI_CREDENTIAL_STORE": "file",
                  })
    path = clean.get("PATH", "/usr/bin:/bin").split(os.pathsep)
    shim = security_shim_dir(home.parent)  # vor allem anderen, auch vor cli-home/.local/bin (dort könnte ein Programm ihn löschen)
    clean["PATH"] = os.pathsep.join(dict.fromkeys([str(shim), str(home / ".local/bin"), *path]))
    return clean


def base_env(turn: Turn) -> dict[str, str]:
    """Umgebung der CLI: die des Dienstes plus Lauf-Token. PATH enthält die üblichen Orte der CLIs."""
    env = dict(os.environ)
    home = Path.home()
    extra = [str(home / ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", *sorted(map(str, home.glob(".nvm/versions/node/*/bin")), reverse=True)]
    env["PATH"] = os.pathsep.join([*extra, env.get("PATH", "/usr/bin:/bin")])
    env["ORBIT_RUN_TOKEN"] = turn.run_token
    # Claude Code bricht Werkzeug-Aufrufe sonst nach 60 s ab (live 14.11.): eine Freigabekarte muss länger offen bleiben dürfen
    from ..runtime.contract import APPROVAL_WAIT_S
    env["MCP_TOOL_TIMEOUT"] = str((APPROVAL_WAIT_S + 1800 + 120) * 1000)  # Karte + längstes Werkzeug (mac_shell bis 1800 s)
    env["ORBIT_MCP_URL"] = turn.mcp_url
    return profile_env(env)


def which(name: str) -> str | None:
    import shutil
    return shutil.which(name, path=base_env(Turn("", "", "", None, Path("."), None, "", ""))["PATH"])


class Adapter:
    """Basisklasse. Unterklassen: name, binary, models und run()."""
    name = ""          # claude | codex | cursor | agy
    binary = ""        # Programmname
    label = ""         # Anzeigename
    keychain = False   # braucht /usr/bin/security für die eigene Anmeldung (Systemsperre)
    keychain_api = False  # braucht nur die Schlüsselbund-Dienste (ohne `security`)

    def __init__(self, fake: str | None = None):
        self.fake = fake  # Pfad der Attrappen-CLI (Tests)

    def argv0(self) -> list[str]:
        if self.fake:
            return [sys.executable, self.fake, "--dialect", self.name]
        return [which(self.binary) or self.binary]

    def available(self) -> bool:
        return bool(self.fake or which(self.binary))

    async def run(self, turn: Turn, tree_ready) -> AsyncIterator[Ev]:
        """Führt einen Zug aus. `tree_ready(tree)` meldet den Prozessbaum, damit Stopp ihn beenden kann."""
        raise NotImplementedError
        yield  # pragma: no cover
