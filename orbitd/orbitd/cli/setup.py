"""Agent-Programme installieren und anmelden (für Nutzer ohne Terminal).

Belege je Programm: docs/neubau/PROGRAMME.md. Sicherheit:
- Installer nur von fest eingetragenen https-Adressen; Weiterleitungen nur auf die eingetragenen Hosts; Größengrenze.
- Erst in eine Datei unter dem Datenordner laden, dann mit der Shell ausführen (nie `curl | sh`), ohne sudo, ohne Eingabe.
- orbitd liest und speichert nie Anmeldedaten; die Programme verwalten sie selbst. Ausgaben laufen immer durch redact().
"""
import asyncio
import fcntl
import json
import os
import pty
import re
import struct
import termios
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import parse_qs, unquote, urljoin, urlsplit

import httpx

from .. import sandbox
from ..config import isolated_dir
from ..db import now_ms
from ..redact import redact
from .base import CliError, ProcessTree, Turn, base_env, profile_command, which
from .codex import codex_request

CHECK_TIMEOUT = 8.0
CACHE_SECONDS = 30.0
LOGIN_WAIT = 20.0
RUN_LIMIT = 600.0          # Installation und Anmeldung: höchstens 10 min
MAX_INSTALLER = 2 * 1024 * 1024  # die echten Skripte sind 8–45 KB
MAX_REDIRECTS = 5
ANSI = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]")
URL = re.compile(r"https://[^\s\"'<>\x1b]+")
HYPERLINK = re.compile(r"\x1b\]8;[^;]*;(https://[^\x07\x1b]+)")
CODE = re.compile(r"\b([A-Z0-9]{4,}-[A-Z0-9]{4,})\b")
CURSOR_LOGIN = "Reconnect Cursor in Settings."
CURSOR_AUTH_ERROR = re.compile(r"authenticat|invalid or expired|not logged in|log in|login", re.I)
CLAUDE_CODE_PART = re.compile(r"[A-Za-z0-9._~+/=-]+")


@dataclass(frozen=True)
class Program:
    id: str
    label: str
    binary: str
    install_url: str
    hosts: frozenset[str]       # erlaubte Hosts für Installer und Weiterleitungen
    shell: str                  # womit der Anbieter das Skript ausführen lässt
    status: tuple[str, ...]     # Statusbefehl (nur lesen)
    login: tuple[str, ...]
    login_kind: str = "link"
    login_env: tuple[tuple[str, str], ...] = ()
    logout: tuple[str, ...] = ("logout",)
    opens_browser: bool = False


PROGRAMS: dict[str, Program] = {p.id: p for p in [
    Program("claude", "Claude Code", "claude", "https://claude.ai/install.sh",
            frozenset({"claude.ai", "downloads.claude.ai"}), "bash",
            ("auth", "status", "--json"), ("auth", "login", "--claudeai"), "code-paste", logout=("auth", "logout"), opens_browser=True),
    Program("codex", "Codex", "codex", "https://chatgpt.com/codex/install.sh",
            frozenset({"chatgpt.com", "releases.openai.com"}), "sh",
            ("login", "status"), ("login",)),
    Program("cursor", "Cursor", "cursor-agent", "https://cursor.com/install",
            frozenset({"cursor.com"}), "bash",
            ("models",), ("login",), login_env=(("NO_OPEN_BROWSER", "1"),)),
    Program("agy", "Antigravity", "agy", "https://antigravity.google/cli/install.sh",
            frozenset({"antigravity.google"}), "bash",
            ("models",), (), "code-paste", (("SSH_CONNECTION", "127.0.0.1 1 127.0.0.1 2"), ("TERM", "xterm-256color")),
            ("-p", "/logout")),
]}


class SetupError(Exception):
    """Finished user-facing sentence."""


def _env(extra=()) -> dict[str, str]:
    env = base_env(Turn("", "", "", None, Path("."), None, "", ""))
    for key in ("ORBIT_RUN_TOKEN", "ORBIT_MCP_URL"):
        env.pop(key, None)
    env.update(dict(extra))
    return env


def clean(text: str) -> str:
    return redact(ANSI.sub("", text)).strip()[:300]


@dataclass
class Op:
    kind: str                   # install | login
    task: asyncio.Task | None = None
    tree: ProcessTree | None = None
    url: str | None = None
    code: str | None = None
    master: int | None = None   # Pseudo-Terminal der laufenden Anmeldung (nur solange offen)
    input_sent: asyncio.Event | None = None
    code_submitted: bool = False


class Setup:
    """Hängt an ctx.parts["setup"]. Je Programm höchstens ein Vorgang."""

    def __init__(self, ctx):
        self.ctx = ctx
        self.ops: dict[str, Op] = {}
        self.cache: tuple[float, list[dict]] | None = None
        self.messages: dict[str, str] = {}          # letzte Fehlermeldung je Programm
        # Tests: Ersatzbefehl je Programm und httpx.MockTransport statt Netz.
        self.fake: dict[str, list[str]] = {}
        self.transport: httpx.AsyncBaseTransport | None = None

    # --- Status ---

    def argv(self, p: Program) -> list[str] | None:
        if p.id in self.fake:
            return list(self.fake[p.id])
        if self.ctx.cfg.fake_cli:  # Testbetrieb: nie ein echtes Programm starten
            return None
        path = which(p.binary)
        return [path] if path else None

    def _command(self, argv: list[str], *, launch: bool = True) -> list[str]:
        if isolated_dir() is None:
            return argv
        return sandbox.wrap(profile_command(argv), self.ctx.cfg, allow_service=True, keychain=Path(argv[0]).name == "codex", cli=True, launch=launch)

    async def _run(self, argv: list[str], timeout: float) -> tuple[int, str]:
        proc = await asyncio.create_subprocess_exec(
            *self._command(argv), env=_env(), start_new_session=True, stdin=asyncio.subprocess.DEVNULL,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), timeout)
        except BaseException:
            await ProcessTree(proc).kill()
            raise
        return proc.returncode, out.decode("utf-8", "replace")

    async def _account_email(self, p: Program, argv: list[str], status: str, timeout: float) -> str | None:
        # Nur das E-Mail-Feld aus der Kontoauskunft übernehmen, keine Ausgabe oder Zugangsdaten weitergeben.
        try:
            if p.id == "claude":
                email = json.loads(status).get("email")
            elif p.id == "cursor":
                code, out = await self._run([*argv, "status", "--format", "json"], timeout)
                if code:
                    return None
                auth = json.loads(out)
                email = (auth.get("userInfo") or {}).get("email") if auth.get("isAuthenticated") is True else None
            elif p.id == "codex":
                result = await asyncio.wait_for(
                    codex_request(argv, "account/read", {"refreshToken": False}, keychain_api=True), timeout,
                )
                account = (result or {}).get("account") or {}
                email = account.get("email") if account.get("type") == "chatgpt" else None
            else:
                return None
        except (TimeoutError, OSError, AttributeError, ValueError, CliError):
            return None
        if isinstance(email, str) and len(email) <= 254 and re.fullmatch(r"[^@<>\s]+@[^@<>\s]+", email):
            return email
        return None

    async def _check(self, p: Program, *, account: bool = False) -> dict:
        base = {"id": p.id, "label": p.label, "installed": False, "version": None, "loggedIn": False}
        argv = self.argv(p)
        if not argv:
            return {**base, "state": "fehlt", "message": f"{p.label} is not installed."}
        deadline = time.monotonic() + CHECK_TIMEOUT
        failed = {**base, "installed": True, "state": "fehler", "message": f"Could not check the status of {p.label}."}
        try:
            version_code, out = await self._run([*argv, "--version"], CHECK_TIMEOUT)
            match = re.search(r"\d+\.\d+(?:\.\d+)?[\w.\-]*", out)
            if version_code != 0 or not match:
                return failed
            code, out = await self._run([*argv, *p.status], max(0.5, deadline - time.monotonic()))
        except (asyncio.TimeoutError, OSError):
            return failed
        if p.id == "claude":
            try:
                logged = json.loads(out).get("loggedIn")
            except (ValueError, AttributeError):
                logged = None
        elif p.id == "agy":
            logged = True if code == 0 else False if "please sign in" in out.lower() else None
        elif p.id == "cursor":
            logged = True if code == 0 else False if CURSOR_AUTH_ERROR.search(out) else None
        else:
            if re.search(r"not (?:logged|authenticated)|no active (?:login|session)", out, re.I):
                logged = False
            else:
                logged = True if code == 0 and re.search(r"logged in|authenticated", out, re.I) else None
        if logged is not True and logged is not False:
            return failed
        summary = {**base, "installed": True, "version": match.group(0), "loggedIn": logged,
                   "state": "bereit" if logged else "abgemeldet",
                   "message": "" if logged else f"{p.label} is installed, but not signed in."}
        if account and logged:
            email = await self._account_email(p, argv, out, max(0.5, deadline - time.monotonic()))
            if email:
                summary["accountEmail"] = email
        return summary

    async def status(self, fresh: bool = False, *, account: bool = False) -> list[dict]:
        if account:
            statuses = await asyncio.gather(*(self._check(p, account=True) for p in PROGRAMS.values()))
        else:
            if fresh or not self.cache or time.monotonic() - self.cache[0] > CACHE_SECONDS:
                self.cache = (time.monotonic(), list(await asyncio.gather(*(self._check(p) for p in PROGRAMS.values()))))
            statuses = self.cache[1]
        result = []
        for item in statuses:
            op = self.ops.get(item["id"])
            item = {**item, "busy": op.kind if op else None, "loginUrl": op.url if op else None, "loginCode": op.code if op else None,
                    "loginKind": PROGRAMS[item["id"]].login_kind}
            if op:
                item.pop("accountEmail", None)
                item["state"], item["message"] = "laeuft", "Installation in progress." if op.kind == "install" else "Sign-in is running in the browser."
            elif self.messages.get(item["id"]):
                item["state"], item["message"] = "fehler", self.messages[item["id"]]
            result.append(item)
        return result

    # --- Vorgänge ---

    def _event(self, pid: str, phase: str, message: str) -> None:
        self.ctx.bus.publish({"type": "cli-setup", "id": pid, "phase": phase, "message": clean(message), "at": now_ms()})

    def _begin(self, pid: str, kind: str) -> Op:
        if pid in self.ops:
            raise SetupError("That is already running.")
        self.messages.pop(pid, None)
        self.ops[pid] = op = Op(kind)
        return op

    async def _finish(self, pid: str, op: Op, coro) -> None:
        try:
            await coro
            op.tree = None  # Erfolg: was das Programm selbst im Hintergrund startet, bleibt
        except asyncio.CancelledError:
            self._event(pid, "error", "Cancelled.")
        except SetupError as e:
            self.messages[pid] = str(e)
            self._event(pid, "error", str(e))
        except Exception:
            self.messages[pid] = "That did not work."
            self._event(pid, "error", "That did not work.")
        finally:
            if op.tree:
                await op.tree.kill()
            self.ops.pop(pid, None)
            self.cache = None

    def start_install(self, p: Program) -> None:
        op = self._begin(p.id, "install")
        op.task = asyncio.create_task(self._finish(p.id, op, self._install(p, op)))

    async def disconnect(self, p: Program) -> None:
        argv = self.argv(p)
        if not argv:
            return
        self._begin(p.id, "disconnect")
        try:
            state = (await self._check(p))["state"]
            if state == "abgemeldet":
                return
            if state != "bereit":
                raise SetupError(f"The status of {p.label} is unclear. Try again.")
            code, _ = await self._run([*argv, *p.logout], CHECK_TIMEOUT)
            if code != 0 or (await self._check(p))["state"] != "abgemeldet":
                raise SetupError(f"Could not disconnect {p.label}.")
        except (TimeoutError, OSError):
            raise SetupError(f"Could not disconnect {p.label}.") from None
        finally:
            self.ops.pop(p.id, None)
            self.cache = None

    async def download(self, p: Program) -> Path:
        """Lädt den Installer in eine Datei. Nur https, nur erlaubte Hosts, Größengrenze."""
        if self.ctx.cfg.fake_cli and not self.transport:
            raise SetupError("Test mode does not download from the network.")
        target = self.ctx.cfg.data_dir / "setup" / f"{p.id}-install.sh"
        target.parent.mkdir(parents=True, exist_ok=True)
        url = p.install_url
        async with httpx.AsyncClient(follow_redirects=False, timeout=60, transport=self.transport) as http:
            for _ in range(MAX_REDIRECTS + 1):
                parts = urlsplit(url)
                if parts.scheme != "https" or parts.hostname not in p.hosts:
                    raise SetupError("The installer comes from a disallowed address.")
                async with http.stream("GET", url) as resp:
                    if resp.is_redirect:
                        url = urljoin(url, resp.headers.get("location", ""))
                        continue
                    if resp.status_code != 200:
                        raise SetupError("The installer could not be downloaded.")
                    data = bytearray()
                    async for chunk in resp.aiter_bytes():
                        data += chunk
                        if len(data) > MAX_INSTALLER:
                            raise SetupError("The installer is too large.")
                    target.write_bytes(bytes(data))
                    target.chmod(0o600)
                    return target
        raise SetupError("The installer could not be downloaded.")

    async def _install(self, p: Program, op: Op) -> None:
        self._event(p.id, "install", f"Downloading {p.label}…")
        script = await self.download(p)
        self._event(p.id, "install", f"Installing {p.label}…")
        proc = await asyncio.create_subprocess_exec(
            *self._command([p.shell, str(script)]), cwd=script.parent, env=_env(), start_new_session=True,
            stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
        op.tree = ProcessTree(proc)

        async def pump():
            while line := await proc.stdout.readline():
                if text := clean(line.decode("utf-8", "replace")):
                    self._event(p.id, "install", text)
            return await proc.wait()

        try:
            code = await asyncio.wait_for(pump(), RUN_LIMIT)
        except asyncio.TimeoutError:
            raise SetupError("The installation took too long.") from None
        if code != 0:
            raise SetupError(f"Installing {p.label} failed.")
        self._event(p.id, "done", f"{p.label} is installed.")

    async def start_login(self, p: Program) -> tuple[str | None, str | None]:
        argv = self.argv(p)
        if not argv:
            raise SetupError(f"{p.label} is not installed.")
        op = self._begin(p.id, "login")
        found = asyncio.Event()
        master = None
        try:
            browser_env = () if p.opens_browser else (("BROWSER", "/usr/bin/true"),)
            command = self._command([*argv, *p.login], launch=p.opens_browser)
            options = {"env": _env((*browser_env, *p.login_env)),
                       "cwd": isolated_dir() / "cli-home" if isolated_dir() else None, "start_new_session": True}
            if p.id == "claude":
                # macOS PTYs only buffer 1024 input bytes. Claude's browser codes can be longer.
                proc = await asyncio.create_subprocess_exec(
                    *command, **options, stdin=asyncio.subprocess.PIPE,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
            else:
                master, slave = pty.openpty()
                try:
                    if p.id == "agy":
                        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 240, 0, 0))
                    proc = await asyncio.create_subprocess_exec(
                        *command, **options, stdin=slave, stdout=slave, stderr=slave)
                finally:
                    os.close(slave)
        except BaseException:
            self.ops.pop(p.id, None)
            if master is not None:
                os.close(master)
            raise
        op.tree = ProcessTree(proc)
        op.master = master
        if p.id == "agy":
            op.input_sent = asyncio.Event()
        op.task = asyncio.create_task(self._finish(p.id, op, self._login(p, op, master, found)))
        try:
            await asyncio.wait_for(found.wait(), LOGIN_WAIT)
        except asyncio.TimeoutError:
            pass
        return op.url, op.code

    async def _login(self, p: Program, op: Op, master: int | None, found: asyncio.Event) -> None:
        loop = asyncio.get_running_loop()
        lines: asyncio.Queue = asyncio.Queue()
        buffer = [""]
        selected = False

        def readable():
            try:
                chunk = os.read(master, 4096).decode("utf-8", "replace")
            except OSError:
                chunk = ""
            if not chunk:
                loop.remove_reader(master)
                if buffer[0]:
                    lines.put_nowait(buffer[0])
                lines.put_nowait(None)
                return
            parts = re.split(r"[\r\n]", buffer[0] + chunk)
            buffer[0] = parts.pop()
            for part in parts:
                lines.put_nowait(part)

        if master is not None:
            loop.add_reader(master, readable)
        self._event(p.id, "login", f"Starting sign-in for {p.label}…")

        async def output_lines():
            if master is None:
                while line := await op.tree.proc.stdout.readline():
                    yield line.decode("utf-8", "replace")
            else:
                while (line := await lines.get()) is not None:
                    yield line

        async def pump():
            nonlocal selected
            async for line in output_lines():
                plain = ANSI.sub("", line)
                # On first launch the TUI selects Google OAuth by default.
                if p.id == "agy" and not selected and re.search(r"[❯›▶>]\s*(?:1\.\s*)?Google OAuth", plain):
                    selected = True
                    os.write(master, b"\r")
                if not op.url and (link := HYPERLINK.search(line) or URL.search(plain)):
                    op.url = (link.group(1) if link.re is HYPERLINK else link.group(0)).rstrip(".,)")
                if p.login_kind == "device-code" and not op.code and "code" in plain.lower() and (m := CODE.search(plain)):
                    op.code = m.group(1)
                if op.url:
                    found.set()
            return await op.tree.proc.wait()

        async def agy_complete():
            await op.input_sent.wait()
            while True:
                if (await self._check(p))["loggedIn"]:
                    return 0
                await asyncio.sleep(2)

        tasks = [asyncio.create_task(pump())]
        if op.input_sent is not None:
            tasks.append(asyncio.create_task(agy_complete()))
        try:
            done, _ = await asyncio.wait(tasks, timeout=RUN_LIMIT, return_when=asyncio.FIRST_COMPLETED)
            if not done:
                raise SetupError("Sign-in took too long.")
            gesichert = op.input_sent is not None and tasks[-1] in done
            code = (tasks[-1] if gesichert else tasks[0]).result()
        finally:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            op.master = None
            if master is not None:
                loop.remove_reader(master)
                os.close(master)
            elif op.tree.proc.stdin:
                op.tree.proc.stdin.close()
            found.set()  # die Route wartet nicht weiter
        if code != 0:
            if op.code_submitted:
                raise SetupError("The sign-in code was not confirmed. Start again and use the new code.")
            raise SetupError(f"Sign-in to {p.label} did not work.")
        if p.id == "claude" and not (await self._check(p))["loggedIn"]:
            raise SetupError("Claude finished sign-in but reports no connected account. Sign in again.")
        if p.id == "cursor" and not (await self._check(p))["loggedIn"]:
            raise SetupError(CURSOR_LOGIN)
        if p.id == "agy":
            if not gesichert and not (await self._check(p))["loggedIn"]:
                raise SetupError(f"Sign-in to {p.label} did not work.")
            await op.tree.kill()  # Nach der Anmeldung bleibt Antigravity im interaktiven Terminal.
        self._event(p.id, "done", f"{p.label} is signed in.")

    async def send_input(self, pid: str, text: str) -> None:
        """Schreibt eine Zeile (z. B. den Code aus dem Browser) in die laufende Anmeldung. Der Text wird nie geloggt."""
        op = self.ops.get(pid)
        if not op or op.kind != "login" or not op.url or op.tree is None:
            raise SetupError("No sign-in is in progress.")
        if PROGRAMS[pid].login_kind != "code-paste":
            raise SetupError("This sign-in does not expect a code in Orbit.")
        if not isinstance(text, str) or not text.strip() or len(text) > 2048 or not text.isprintable():
            raise SetupError("Invalid input.")
        text = text.strip()
        if pid == "claude":
            states = parse_qs(urlsplit(op.url).query).get("state")
            if states and CLAUDE_CODE_PART.fullmatch(states[0]):
                value, separator, state = unquote(text).partition("#")
                if not CLAUDE_CODE_PART.fullmatch(value):
                    raise SetupError("Paste the sign-in code from the Claude browser window.")
                if separator and state != states[0]:
                    raise SetupError("This code belongs to another sign-in attempt. Open the link in this card and copy the new code.")
                text = f"{value}#{states[0]}"
        try:
            if writer := op.tree.proc.stdin:
                writer.write((text + "\n").encode("utf-8"))
                await writer.drain()
            elif op.master is not None:
                os.write(op.master, (text + "\r").encode("utf-8"))
            else:
                raise SetupError("No sign-in is in progress.")
            op.code_submitted = True
            if op.input_sent is not None:
                op.input_sent.set()
        except OSError:
            raise SetupError("No sign-in is in progress.") from None

    async def cancel(self, pid: str) -> None:
        op = self.ops.get(pid)
        if op and op.task:
            op.task.cancel()
            try:
                await op.task
            except asyncio.CancelledError:
                pass

    async def shutdown(self) -> None:
        for pid in list(self.ops):
            await self.cancel(pid)


def get(ctx) -> Setup:
    if "setup" not in ctx.parts:
        ctx.parts["setup"] = Setup(ctx)
    return ctx.parts["setup"]
