"""Daytona-Anbindung: ein Computer je Orbi (REST über httpx, kein SDK) und die Computer-Werkzeuge. Vorlage: lib/daytona.ts, lib/chat/sandbox-tools.ts, lib/work/budget.ts.

Belegt (Quelle .claude/skills/daytona/references/api): POST/GET/DELETE /sandbox, POST /sandbox/{id}/start|/stop, GET /sandbox/{id}/ports/{port}/signed-preview-url,
Toolbox POST /process/execute, GET /files/download, POST /files/upload-v2, GET /files, GET/POST /computeruse/… (status, start, screenshot, mouse, keyboard).
Toolbox-Adresse: Feld toolboxProxyUrl der Sandbox, sonst die dokumentierte https://proxy.app.daytona.io/toolbox/{sandboxId}/… (Schema des Felds ist in der Doku nicht beschrieben).
"""
import asyncio
import base64
import json
import re
import time
from contextlib import asynccontextmanager

import httpx

from .. import keychain
from ..db import new_id, now_ms
from ..runtime.contract import Risk, tool
from ..web import Fail
from . import files
from .mac.risk import classify_bash

API_DEFAULT = "https://app.daytona.io/api"
TOOLBOX_DEFAULT = "https://proxy.app.daytona.io/toolbox"
IDLE_MS = 15 * 60_000
MAX_OUTPUT = 10_000
MAX_AUTO_WRITE = 60 * 1024
HOME = "/home/daytona"
FULL = "Gerade sind alle Computer belegt."
CLOUD_OFF = "Cloud-Computer ist in den Einstellungen aus."


def is_fake(sandbox_id) -> bool:
    return not sandbox_id or str(sandbox_id).startswith("fake-")


def idle_ms(ctx) -> int:
    """Wartezeit bis ein Platz wieder frei zählt — Profil „Sleep after“."""
    from ..routes.settings import profile_preferences
    minutes = profile_preferences(ctx.db).get("sleepMinutes", 15)
    if type(minutes) is not int or minutes not in (5, 10, 15, 30, 60):
        minutes = 15
    return minutes * 60_000


def cloud_allowed(ctx) -> bool:
    from ..routes.settings import profile_preferences
    return bool(profile_preferences(ctx.db).get("cloud", True))


def get(ctx) -> "Sandbox":
    """Der Computer-Dienst aus ctx.parts (legt ihn bei Bedarf an)."""
    if ctx.parts.get("sandbox") is None:
        ctx.parts["sandbox"] = Sandbox(ctx)
    return ctx.parts["sandbox"]


class Sandbox:
    def __init__(self, ctx, transport: httpx.AsyncBaseTransport | None = None):
        self.ctx, self.transport = ctx, transport
        self.now = lambda: int(time.time() * 1000)
        self.sleep = asyncio.sleep
        self.last_use: dict[str, int] = {}
        self.toolbox: dict[str, str] = {}
        self._operations: dict[str, asyncio.Lock] = {}

    def operation(self, sandbox_id: str) -> asyncio.Lock:
        return self._operations.setdefault(sandbox_id, asyncio.Lock())

    @asynccontextmanager
    async def agent_operation(self, sandbox_id: str):
        async with self.operation(sandbox_id):
            if self.ctx.db.val("SELECT 1 FROM desktop_holds h JOIN bots b ON b.id=h.bot_id WHERE b.sandbox_id=?", sandbox_id):
                raise Fail("Der Computer ist gerade von dir übernommen. Der Orbi kann nach der Rückgabe weiterarbeiten.")
            yield

    # ------------------------------------------------------------ HTTP
    async def _send(self, method: str, url: str, *, timeout: float = 30, ok404: bool = False,
                    api_key: str | None = None, **kw) -> httpx.Response:
        key = api_key if api_key is not None else await keychain.get("DAYTONA_API_KEY")
        if not key:
            raise Fail("Daytona ist nicht eingerichtet: Der Daytona-Schlüssel fehlt.")
        headers = {**kw.pop("headers", {}), "Authorization": f"Bearer {key}"}
        try:
            async with httpx.AsyncClient(transport=self.transport, timeout=timeout) as client:
                r = await client.request(method, url, headers=headers, **kw)
        except httpx.HTTPError:
            raise Fail("Daytona ist gerade nicht erreichbar.") from None
        if r.status_code == 404 and ok404:
            return r
        if r.status_code in (401, 403):
            raise Fail("Der Daytona-Schlüssel wird nicht angenommen.")
        if r.status_code == 404:
            raise Fail("Der Computer wurde bei Daytona nicht gefunden.")
        if r.status_code >= 400:
            raise Fail(f"Daytona meldet einen Fehler ({r.status_code}).")
        return r

    async def _api(self, method: str, path: str, **kw) -> httpx.Response:
        base = await keychain.get("DAYTONA_API_URL") or API_DEFAULT
        return await self._send(method, base.rstrip("/") + path, **kw)

    async def _tb(self, sandbox_id: str, method: str, path: str, **kw) -> httpx.Response:
        return await self._send(method, f"{self.toolbox.get(sandbox_id, TOOLBOX_DEFAULT).rstrip('/')}/{sandbox_id}{path}", **kw)

    # ------------------------------------------------------------ Plätze (budget.ts: höchstens maxSandboxes gleichzeitig, belegt 15 min nach letzter Nutzung)
    def active(self) -> list[str]:
        t = self.now()
        limit = idle_ms(self.ctx)
        self.last_use = {i: at for i, at in self.last_use.items() if t - at < limit}
        return list(self.last_use)

    def acquire(self, sandbox_id: str) -> None:
        from ..routes.misc import _budget
        ids = self.active()
        if sandbox_id not in ids and len(ids) >= _budget(self.ctx.db)["maxSandboxes"]:
            raise Fail(FULL)
        self.last_use[sandbox_id] = self.now()

    # ------------------------------------------------------------ Lebenslauf
    async def verify_key(self, key: str, sandbox_id: str | None) -> None:
        if sandbox_id:
            await self._api("GET", f"/sandbox/{sandbox_id}", api_key=key)
        else:
            await self._api("GET", "/sandbox", api_key=key, params={"limit": 1})

    async def existing_for_bot(self, bot_id: str) -> str | None:
        labels = {"botId": bot_id}
        response = await self._api("GET", "/sandbox", params={"labels": json.dumps(labels), "limit": 2})
        try:
            page = response.json()
            items = page["items"]
            cursor = page["nextCursor"]
            if not isinstance(items, list) or (cursor is not None and not isinstance(cursor, str)) or not all(
                isinstance(s["id"], str) and re.fullmatch(r"[A-Za-z0-9_-]{1,128}", s["id"])
                and not is_fake(s["id"]) and s["labels"]["botId"] == bot_id for s in items
            ):
                raise ValueError
        except (ValueError, KeyError, TypeError):
            raise Fail("Daytona konnte vorhandene Computer nicht eindeutig prüfen.") from None
        if len(items) > 1 or cursor:
            raise Fail("Bei Daytona gibt es mehrere Computer für diesen Orbi.")
        return items[0]["id"] if items else None

    async def create(self, bot_id: str) -> str:
        if not cloud_allowed(self.ctx):
            raise Fail(CLOUD_OFF)
        from ..routes.settings import profile_preferences
        minutes = profile_preferences(self.ctx.db).get("sleepMinutes", 15)
        if type(minutes) is not int or minutes not in (5, 10, 15, 30, 60):
            minutes = 15
        r = await self._api("POST", "/sandbox", json={"labels": {"botId": bot_id}, "autoStopInterval": minutes}, timeout=120)
        sandbox_id = r.json().get("id")
        if not isinstance(sandbox_id, str) or not sandbox_id:
            raise Fail("Daytona hat keinen Computer angelegt.")
        return sandbox_id

    async def delete(self, sandbox_id: str) -> None:
        if is_fake(sandbox_id):
            return
        await self._api("DELETE", f"/sandbox/{sandbox_id}", ok404=True)  # 404 = schon weg
        self.last_use.pop(sandbox_id, None)

    async def ensure_started(self, sandbox_id: str) -> None:
        if not cloud_allowed(self.ctx):
            raise Fail(CLOUD_OFF)
        self.acquire(sandbox_id)
        clear_off_for_sandbox(self.ctx, sandbox_id)  # bewusst an: Orbi oder App braucht den Computer
        dto = (await self._api("GET", f"/sandbox/{sandbox_id}")).json()
        if dto.get("state") != "started":
            await self._api("POST", f"/sandbox/{sandbox_id}/start", timeout=120)
            for _ in range(60):
                dto = (await self._api("GET", f"/sandbox/{sandbox_id}")).json()
                if dto.get("state") == "started":
                    break
                if dto.get("state") in ("error", "build_failed"):
                    raise Fail("Der Computer konnte nicht gestartet werden.")
                await self.sleep(1)
            else:
                raise Fail("Der Computer startet nicht. Versuche es gleich noch einmal.")
        if dto.get("toolboxProxyUrl"):
            self.toolbox[sandbox_id] = dto["toolboxProxyUrl"]

    async def ping(self) -> None:
        await self._api("GET", "/sandbox", params={"limit": 1})

    # ------------------------------------------------------------ im Computer
    async def exec(self, sandbox_id: str, command: str, cwd: str | None = None, timeout: int = 60, envs: dict | None = None) -> tuple[int, str]:
        async with self.agent_operation(sandbox_id):
            await self.ensure_started(sandbox_id)
            body = {"command": command, "timeout": timeout, **({"cwd": cwd} if cwd else {}), **({"envs": envs} if envs else {})}
            data = (await self._tb(sandbox_id, "POST", "/process/execute", json=body, timeout=timeout + 15)).json()
        return int(data.get("exitCode", data.get("code", -1))), str(data.get("result") or "")

    async def read_file(self, sandbox_id: str, path: str) -> bytes:
        async with self.agent_operation(sandbox_id):
            await self.ensure_started(sandbox_id)
            r = await self._tb(sandbox_id, "GET", "/files/download", params={"path": path}, ok404=True, timeout=120)
        if r.status_code == 404:
            raise Fail("Datei nicht gefunden.")
        return r.content

    async def write_file(self, sandbox_id: str, path: str, data: bytes) -> None:
        async with self.agent_operation(sandbox_id):
            await self.ensure_started(sandbox_id)
            await self._tb(sandbox_id, "POST", "/files/upload-v2", params={"path": path}, content=data,
                           headers={"Content-Type": "application/octet-stream"}, timeout=120)

    async def list_files(self, sandbox_id: str, path: str = ".") -> list[dict]:
        async with self.agent_operation(sandbox_id):
            await self.ensure_started(sandbox_id)
            r = await self._tb(sandbox_id, "GET", "/files", params=None if path in (".", "") else {"path": path}, ok404=True)
        if r.status_code == 404:
            raise Fail("Ordner nicht gefunden.")
        return [{"name": f.get("name"), "isDir": f.get("isDir"), "size": f.get("size")} for f in r.json()]

    async def desktop_state(self, sandbox_id: str) -> str:
        state = (await self._api("GET", f"/sandbox/{sandbox_id}")).json().get("state")
        if state == "started":
            return "running"
        if state in ("stopped", "archived", "paused"):
            return "sleeping"
        if state in ("starting", "stopping", "restoring", "resuming", "pausing"):
            return "transitioning"
        return "unknown"

    async def sleep_desktop(self, sandbox_id: str) -> None:
        """Computer anhalten (Daytona stop). Wartet bis er schläft."""
        await self._api("POST", f"/sandbox/{sandbox_id}/stop", timeout=120)
        for _ in range(60):
            state = (await self._api("GET", f"/sandbox/{sandbox_id}")).json().get("state")
            if state in ("stopped", "archived", "paused"):
                break
            if state in ("error", "build_failed"):
                raise Fail("Der Computer konnte nicht schlafen gelegt werden.")
            await self.sleep(1)
        else:
            raise Fail("Der Computer schläft nicht ein. Versuche es gleich noch einmal.")
        self.last_use.pop(sandbox_id, None)

    async def wake_desktop(self, sandbox_id: str) -> str:
        """Computer starten und Zustand zurückgeben (running/…)."""
        await self.ensure_started(sandbox_id)
        return await self.desktop_state(sandbox_id)

    async def ensure_desktop(self, sandbox_id: str) -> None:
        """Sandbox läuft und Computer-Use (VNC/Desktop) ist aktiv."""
        await self.ensure_started(sandbox_id)
        try:
            status = (await self._tb(sandbox_id, "GET", "/computeruse/status")).json().get("status")
        except Fail:
            status = None  # gestoppt/kaputt: neu starten statt 400 an die App durchreichen
        if status != "active":
            await self._tb(sandbox_id, "POST", "/computeruse/start", timeout=120)

    async def desktop_url(self, sandbox_id: str, *, view_only: bool = False) -> str:
        """noVNC des Desktops als signierte Vorschau (Port 6080, 1 h). Die Adresse trägt den Zugang: nie loggen."""
        await self.ensure_desktop(sandbox_id)
        r = await self._api("GET", f"/sandbox/{sandbox_id}/ports/6080/signed-preview-url", params={"expiresInSeconds": 3600})
        url = r.json().get("url")
        if not isinstance(url, str) or not url:
            raise Fail("Der Desktop ist gerade nicht erreichbar.")
        mode = "&view_only=true" if view_only else ""
        return f"{url.rstrip('/')}/vnc.html?autoconnect=true&resize=scale&reconnect=true{mode}"

    async def computer_use(self, sandbox_id: str, method: str, path: str, **kw) -> httpx.Response:
        """Desktop aktiv, dann Computer-Use-Aufruf (Maus/Tastatur/Screenshot). Sperrt bei Übernahme."""
        async with self.agent_operation(sandbox_id):
            await self.ensure_desktop(sandbox_id)
            return await self._tb(sandbox_id, method, path, **kw)

    async def screenshot(self, sandbox_id: str) -> dict:
        """Komprimierter Desktop-Screenshot (JPEG). Bildpixel = Klickkoordinaten. Vorlage: lib/chat/sandbox-tools.ts."""
        async with self.agent_operation(sandbox_id):
            await self.ensure_desktop(sandbox_id)
            shot, info = await asyncio.gather(
                self._tb(sandbox_id, "GET", "/computeruse/screenshot/compressed",
                         params={"format": "jpeg", "quality": "70", "showCursor": "true"}, timeout=60),
                self._tb(sandbox_id, "GET", "/computeruse/display/info", timeout=30),
            )
        data, meta = shot.json(), info.json()
        image = data.get("screenshot") or data.get("image") or ""
        if not isinstance(image, str) or not image:
            raise Fail("Der Bildschirm konnte nicht aufgenommen werden.")
        displays = meta.get("displays") if isinstance(meta.get("displays"), list) else []
        primary = meta.get("primary_display") if isinstance(meta.get("primary_display"), dict) else (displays[0] if displays else {})
        if not isinstance(primary, dict):
            primary = {}
        w = int(primary.get("width") or data.get("width") or 0)
        h = int(primary.get("height") or data.get("height") or 0)
        return {"image": image, "mediaType": "image/jpeg", "width": w, "height": h}


# ---------------------------------------------------------------- Werkzeuge (nur 1:1-Chat, nur mit echtem Computer)
def _has_computer(run) -> bool:
    return not run.ctx.cfg.fake_sandbox and not is_fake(run.bot.get("sandbox_id"))


def _tool(name: str, description: str, props: dict, label, required=(), **options):
    return tool(name, description, {"type": "object", "properties": props, "required": list(required)}, groups=False, available=_has_computer, label=label, **options)


def _short(s, n=60) -> str:
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[:n - 1] + "…"


def _tail(s: str) -> str:
    return s if len(s) <= MAX_OUTPUT else f"…(gekürzt)\n{s[-MAX_OUTPUT:]}"


def _bash_risk(run, a):
    hit = classify_bash(a["command"]) if isinstance(a.get("command"), str) else None
    if not hit:
        return None
    # Karte nur bei geld/nachricht/login (Tor); andere Gründe nur für Deny-Regeln
    return Risk(hit[0], f"sandbox_bash:{hit[0]}", hit[1])


_s = {"type": "string"}


@_tool("request_computer_takeover", "Ask the user to sign in directly on this Orbi's already configured computer. "
       "Give only the service name. Never ask for credentials in chat. The user's return will arrive as a separate response. "
       "When a login is required, end this turn after showing the card.",
       {"serviceName": {"type": "string", "minLength": 1, "maxLength": 48}}, lambda a: None, required=["serviceName"])
async def request_takeover(run, a):
    service = " ".join(a["serviceName"].split())
    if not service or any(mark in service for mark in ("://", "@", "/", "\\")):
        raise Fail("Gib nur den Namen des Dienstes an.")
    label = f"Bei {service} anmelden"
    questions = [{"question": label, "options": [{"label": "Computer zurückgegeben"}]}]
    return run.ctx.parts["interactions"].ask(run, new_id(), questions, computer_takeover=label)


@_tool("bash", "Run a shell command in your sandbox (user daytona, home /home/daytona). Returns exit code and output (last 10k chars). GUI apps: `DISPLAY=:0 nohup <app> >/dev/null 2>&1 &`.",
       {"command": _s, "cwd": {**_s, "description": "Working directory, default home"},
        "timeout": {"type": "integer", "minimum": 1, "maximum": 600, "description": "Seconds, default 60"}},
       lambda a: f"Führt aus: {_short(a.get('command', ''))}", required=["command"], risk=_bash_risk)
async def bash(run, a):
    run.counters["untrusted"] = True
    code, out = await get(run.ctx).exec(run.bot["sandbox_id"], a["command"], a.get("cwd"), a.get("timeout") or 60)
    return {"exitCode": code, "output": _tail(out)}


@_tool("read_file", "Read a text file from your sandbox (first 10k chars).", {"path": _s}, lambda a: f"Liest {_short(a.get('path', ''))}", required=["path"])
async def read_file(run, a):
    run.counters["untrusted"] = True
    text = (await get(run.ctx).read_file(run.bot["sandbox_id"], a["path"])).decode("utf-8", "replace")
    return {"path": a["path"], "content": text if len(text) <= MAX_OUTPUT else f"{text[:MAX_OUTPUT]}\n…(gekürzt)"}


@_tool("write_file", "Create or overwrite a text file in your sandbox. Parent folders are created.", {"path": _s, "content": _s},
       lambda a: f"Schreibt {_short(a.get('path', ''))}", required=["path", "content"])
async def write_file(run, a):
    data = a["content"].encode("utf-8")
    await get(run.ctx).write_file(run.bot["sandbox_id"], a["path"], data)
    return {"path": a["path"], "bytes": len(data)}


# Verzeichnis-Deskriptoren verhindern, dass Symlinks das Ziel nach außen umlenken (aus lib/chat/sandbox-write.ts).
SAFE_WRITE_SCRIPT = """
import base64, os, secrets
root = os.environ['ORBIT_WRITE_ROOT']
path = os.environ['ORBIT_WRITE_PATH']
if path.startswith('/home/daytona/'):
    path = path[len('/home/daytona/'):]
parts = path.split('/')
if not parts or any(not p or p in ('.', '..') or '/' in p for p in parts):
    raise ValueError('invalid path')
data = base64.b64decode(os.environ['ORBIT_WRITE_DATA'], validate=True)
fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
tmp = None
try:
    for part in parts[:-1]:
        try:
            os.mkdir(part, 0o700, dir_fd=fd)
        except FileExistsError:
            pass
        newfd = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
        os.close(fd)
        fd = newfd
    tmp = '.orbit-write-' + secrets.token_hex(16)
    out = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=fd)
    try:
        with os.fdopen(out, 'wb') as file:
            file.write(data)
        os.link(tmp, parts[-1], src_dir_fd=fd, dst_dir_fd=fd, follow_symlinks=False)
        os.unlink(tmp, dir_fd=fd)
        tmp = None
    finally:
        if tmp is not None:
            os.unlink(tmp, dir_fd=fd)
finally:
    os.close(fd)
"""


def auto_output_path(value) -> bool:
    """Nur gewöhnliche Pfade unter output/ im Heimatordner (wie autoOutputPath im alten Dienst)."""
    if not isinstance(value, str) or not value or len(value) > 4096:
        return False
    rel = value[len(HOME) + 1:] if value.startswith(HOME + "/") else value
    parts = rel.split("/")
    return not rel.startswith("/") and all(re.fullmatch(r"[A-Za-z0-9_][A-Za-z0-9_. -]*", p) for p in parts) and rel.startswith("output/") and len(rel) > len("output/")


@_tool("create_file", "Create a new text file under /home/daytona/output (no overwrite, folders are created, max 60 KB). It appears in the chat. If the name exists, choose a new one.",
       {"path": _s, "content": _s}, lambda a: f"Erstellt {_short(a.get('path', ''))}", required=["path", "content"])
async def create_file(run, a):
    data = a["content"].encode("utf-8")
    if not auto_output_path(a["path"]) or len(data) > MAX_AUTO_WRITE:
        raise Fail("Datei muss im Ausgabeordner liegen und darf höchstens 60 KB groß sein.")
    code, _ = await get(run.ctx).exec(run.bot["sandbox_id"], 'python3 -c "$ORBIT_WRITE_SCRIPT"', None, 10,
                                      {"ORBIT_WRITE_SCRIPT": SAFE_WRITE_SCRIPT, "ORBIT_WRITE_ROOT": HOME, "ORBIT_WRITE_PATH": a["path"],
                                       "ORBIT_WRITE_DATA": base64.b64encode(data).decode("ascii")})
    if code != 0:
        raise Fail("Datei konnte nicht erstellt werden; bitte einen neuen Dateinamen wählen.")
    return {"path": a["path"], "bytes": len(data)}


@_tool("list_files", "List files and folders in a directory of your sandbox.", {"path": {**_s, "description": "Default: home"}},
       lambda a: f"Listet {_short(a.get('path') or 'Ordner')}")
async def list_files(run, a):
    return await get(run.ctx).list_files(run.bot["sandbox_id"], a.get("path") or ".")


@_tool("share_file", "Show an existing sandbox file to the user as a card in the chat (preview and download). Max 5 MB. Not needed for files that already appeared.",
       {"path": {**_s, "description": "Absolute path or relative to home"}}, lambda a: f"Zeigt {_short(a.get('path', ''))}", required=["path"])
async def share_file(run, a):
    data = await get(run.ctx).read_file(run.bot["sandbox_id"], a["path"])
    name = a["path"].rstrip("/").split("/")[-1] or "datei"
    return files.shared_text(files.share(run, name, files.media_type(name), data, {"path": a["path"]}))


async def _shot(run) -> dict:
    run.counters["untrusted"] = True
    shot = await get(run.ctx).screenshot(run.bot["sandbox_id"])
    note = f"Screenshot {shot['width']}x{shot['height']} px." if shot["width"] and shot["height"] else "Screenshot."
    return {**shot, "note": note, "_images": [{"data": shot["image"], "mimeType": shot["mediaType"]}]}


@_tool("view_screen", "Take a screenshot of your sandbox desktop so YOU can see it. Not shown to the user. "
       "Use before and after GUI actions to check what happened. Desktop is typically 1024x768 (pixels = click coordinates).",
       {}, lambda a: "Schaut auf den Bildschirm")
async def view_screen(run, a):
    shot = await _shot(run)
    return {"width": shot["width"], "height": shot["height"], "note": f"{shot['note']} Nicht für Consti sichtbar.",
            "_images": shot["_images"]}


@_tool("show_screen", "Take a screenshot of your sandbox desktop and show it to the user in the chat. "
       "Use only when the user wants to see the screen.",
       {}, lambda a: "Zeigt den Bildschirm")
async def show_screen(run, a):
    shot = await _shot(run)
    try:
        raw = base64.b64decode(shot["image"], validate=False)
    except Exception:
        raise Fail("Der Bildschirm konnte nicht aufgenommen werden.") from None
    files.share(run, "Bildschirm.jpg", shot["mediaType"], raw, {})
    return {"width": shot["width"], "height": shot["height"], "note": f"{shot['note']} An Consti gezeigt.",
            "_images": shot["_images"]}


def _held(run) -> bool:
    return bool(run.ctx.db.val("SELECT 1 FROM desktop_holds WHERE bot_id=?", run.bot["id"]))


def _off_key(bot_id: str) -> str:
    return f"desktop_off:{bot_id}"


def is_marked_off(ctx, bot_id: str) -> bool:
    """Orbit merkt sich „aus“, auch wenn Daytona den Zustand noch falsch meldet."""
    return ctx.db.val("SELECT value FROM app_kv WHERE key=?", _off_key(bot_id)) == "1"


def mark_off(ctx, bot_id: str) -> None:
    ctx.db.run("INSERT OR REPLACE INTO app_kv (key, value, updated_at) VALUES (?,?,?)", _off_key(bot_id), "1", now_ms())


def clear_off(ctx, bot_id: str) -> None:
    ctx.db.run("DELETE FROM app_kv WHERE key=?", _off_key(bot_id))


def clear_off_for_sandbox(ctx, sandbox_id: str) -> None:
    for row in ctx.db.all("SELECT id FROM bots WHERE sandbox_id=?", sandbox_id):
        clear_off(ctx, row["id"])


def notify_desktop(ctx, bot_id: str, state: str, takeover_id: str | None = None) -> None:
    """App-Statuskarte sofort aktualisieren (SSE)."""
    event = {"type": "desktop", "botId": bot_id, "state": state}
    if state == "taken" and takeover_id:
        event["takeoverId"] = takeover_id
    ctx.bus.publish(event)


@_tool("computer_status", "Check whether your sandbox computer is running, sleeping (off), taken by the user, or transitioning.",
       {}, lambda a: "Prüft den Computer")
async def computer_status(run, a):
    if _held(run):
        return {"state": "taken", "note": "Consti hat den Computer gerade übernommen."}
    if is_marked_off(run.ctx, run.bot["id"]):
        return {"state": "sleeping"}
    state = await get(run.ctx).desktop_state(run.bot["sandbox_id"])
    return {"state": state}


@_tool("computer_wake", "Start/wake your sandbox computer if it is sleeping. No-op if already running. "
       "Other tools (bash, view_screen, …) also wake it when needed. After success, tell Consti plainly that it is on.",
       {}, lambda a: "Weckt den Computer")
async def computer_wake(run, a):
    if not cloud_allowed(run.ctx):
        raise Fail(CLOUD_OFF)
    if _held(run):
        raise Fail("Consti hat den Computer gerade übernommen. Warte auf die Rückgabe.")
    state = await get(run.ctx).wake_desktop(run.bot["sandbox_id"])
    clear_off(run.ctx, run.bot["id"])
    notify_desktop(run.ctx, run.bot["id"], state)
    return "Der Computer läuft." if state == "running" else f"Zustand: {state}"


@_tool("computer_sleep", "Turn your sandbox computer off (sleep/stop) to free budget. Fails if the user currently took it over. "
       "After success the computer IS off — tell Consti plainly „ist aus“, do not hedge or re-check unless asked. "
       "Wake later with computer_wake or by using bash/view_screen.",
       {}, lambda a: "Schaltet den Computer aus")
async def computer_sleep(run, a):
    sid = run.bot["sandbox_id"]
    sb = get(run.ctx)
    async with sb.operation(sid):
        if _held(run):
            raise Fail("Consti hat den Computer gerade übernommen. Erst zurückgeben, dann ausschalten.")
        await sb.sleep_desktop(sid)
    mark_off(run.ctx, run.bot["id"])
    notify_desktop(run.ctx, run.bot["id"], "sleeping")
    return "Der Computer ist aus."


# ---------------------------------------------------------------- Maus, Tastatur, Warten (Vorlage: lib/chat/sandbox-tools.ts)
_i = {"type": "integer", "minimum": 0}
_point = {"x": _i, "y": _i}


async def _gui(run, method: str, path: str, body: dict | None = None):
    run.counters["untrusted"] = True
    kw = {"json": body} if body is not None else {}
    await get(run.ctx).computer_use(run.bot["sandbox_id"], method, path, **kw)
    return {"ok": True}


@_tool("mouse_click", "Click at a screen position.",
       {**_point, "button": {"type": "string", "enum": ["left", "right", "middle"], "default": "left"},
        "double": {"type": "boolean", "default": False}},
       lambda a: f"{'Doppelklickt' if a.get('double') else 'Klickt'} bei {a.get('x')}, {a.get('y')}",
       required=["x", "y"])
async def mouse_click(run, a):
    return await _gui(run, "POST", "/computeruse/mouse/click",
                      {"x": a["x"], "y": a["y"], "button": a.get("button") or "left", "double": bool(a.get("double"))})


@_tool("mouse_move", "Move the mouse to a screen position (e.g. to hover).",
       _point, lambda a: f"Bewegt die Maus zu {a.get('x')}, {a.get('y')}", required=["x", "y"])
async def mouse_move(run, a):
    return await _gui(run, "POST", "/computeruse/mouse/move", {"x": a["x"], "y": a["y"]})


@_tool("mouse_scroll", "Scroll the mouse wheel at a screen position.",
       {**_point, "direction": {"type": "string", "enum": ["up", "down"]},
        "amount": {"type": "integer", "minimum": 1, "maximum": 30, "default": 3, "description": "Wheel ticks"}},
       lambda a: f"Scrollt {a.get('direction')} bei {a.get('x')}, {a.get('y')}", required=["x", "y", "direction"])
async def mouse_scroll(run, a):
    return await _gui(run, "POST", "/computeruse/mouse/scroll",
                      {"x": a["x"], "y": a["y"], "direction": a["direction"], "amount": a.get("amount") or 3})


@_tool("mouse_drag", "Drag with the left mouse button from one position to another.",
       {"startX": _i, "startY": _i, "endX": _i, "endY": _i},
       lambda a: f"Zieht von {a.get('startX')}, {a.get('startY')} nach {a.get('endX')}, {a.get('endY')}",
       required=["startX", "startY", "endX", "endY"])
async def mouse_drag(run, a):
    return await _gui(run, "POST", "/computeruse/mouse/drag",
                      {"startX": a["startX"], "startY": a["startY"], "endX": a["endX"], "endY": a["endY"], "button": "left"})


@_tool("keyboard_type", "Type text at the current keyboard focus.",
       {"text": _s}, lambda a: f"Tippt „{_short(a.get('text', ''), 30)}“", required=["text"])
async def keyboard_type(run, a):
    return await _gui(run, "POST", "/computeruse/keyboard/type", {"text": a["text"]})


@_tool("keyboard_press", "Press one key, optionally with modifiers. Keys like 'Return', 'Escape', 'Tab', 'BackSpace', 'Up', 'F5', 'a'.",
       {"key": _s, "modifiers": {"type": "array", "items": {"type": "string", "enum": ["ctrl", "alt", "shift", "cmd"]}}},
       lambda a: f"Drückt {'+'.join([*(a.get('modifiers') or []), a.get('key', '?')])}", required=["key"])
async def keyboard_press(run, a):
    body = {"key": a["key"]}
    if a.get("modifiers"):
        body["modifiers"] = a["modifiers"]
    return await _gui(run, "POST", "/computeruse/keyboard/key", body)


@_tool("keyboard_hotkey", "Press a key combination, e.g. 'ctrl+c', 'ctrl+shift+t', 'alt+tab'.",
       {"keys": _s}, lambda a: f"Hotkey {a.get('keys', '')}", required=["keys"])
async def keyboard_hotkey(run, a):
    return await _gui(run, "POST", "/computeruse/keyboard/hotkey", {"keys": a["keys"]})


@_tool("wait", "Wait a few seconds, e.g. for a page or app to load.",
       {"seconds": {"type": "number", "minimum": 0.5, "maximum": 30}},
       lambda a: f"Wartet {a.get('seconds')} s", required=["seconds"])
async def wait(run, a):
    await asyncio.sleep(float(a["seconds"]))
    return {"ok": True}
