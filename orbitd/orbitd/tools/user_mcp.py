"""Eigene MCP-Server (Tabelle mcp_servers). Orbit ist hier CLIENT (Paket mcp 2.3, Streamable HTTP oder stdio).

Deren Werkzeuge stehen als `mcp_<server>__<werkzeug>` in contract.TOOLS. MCP-Aufrufe laufen ohne Freigabekarte
(nur geld/nachricht/login fragen). Der Token liegt nur im Schlüsselbund (Dienst de.consti.orbit2, Konto MCP_<NAME>),
nie in der Tabelle. Verbunden wird je Aufruf frisch (kein Dauerprozess); `STATE` merkt nur das Ergebnis.
"""
import asyncio
import re
from contextlib import AsyncExitStack, asynccontextmanager
from urllib.parse import urlparse

import anyio
import httpx2
from mcp import Client
from mcp.client.stdio import StdioServerParameters
from mcp.client.streamable_http import streamable_http_client

from .. import keychain
from ..db import dumps, loads, now_ms
from ..runtime.contract import TOOLS, Risk, Tool
from ..web import Fail

NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
STATE: dict[str, dict] = {}   # Name -> {status, error, tools:[{name, description, readOnly}]}; nur im Speicher
CONNECT_S, CALL_S = 30, 60


def account(name: str) -> str:
    return "MCP_" + name.upper().replace("-", "_")


@asynccontextmanager
async def _open(row):
    token = await keychain.get(account(row["name"]))
    async with AsyncExitStack() as stack:
        if row["transport"] == "stdio":
            target = StdioServerParameters(command=row["command"], args=loads(row["args"], []), env={"MCP_TOKEN": token} if token else None)
        elif token:
            http = await stack.enter_async_context(httpx2.AsyncClient(headers={"Authorization": f"Bearer {token}"}, timeout=30))
            target = streamable_http_client(row["url"], http_client=http)
        else:
            target = row["url"]
        yield await stack.enter_async_context(Client(target))


def _unregister(name: str) -> None:
    for key in [k for k in TOOLS if k.startswith(f"mcp_{name}__")]:
        del TOOLS[key]


def _register(server: str, tools: list) -> None:
    _unregister(server)
    for t in tools:
        key = f"mcp_{server}__{re.sub(r'[^A-Za-z0-9_-]', '_', t.name)}"[:64]
        schema = t.input_schema if isinstance(t.input_schema, dict) and t.input_schema.get("type") == "object" else {"type": "object"}
        TOOLS[key] = Tool(key, (t.description or t.title or t.name)[:1000], schema, _handler(server, t.name),
                          label=lambda a, s=server, n=t.name: f"Nutzt {s}: {n}", risk=_risk(server, t.name))


def _risk(server: str, name: str):
    def risk(run, args):
        # Keine Freigabekarte (Tor filtert system); Risk bleibt für Deny-Regeln
        detail = "\n".join(f"{k}: {str(v)[:200]}" for k, v in list(args.items())[:10]) or None
        return Risk("system", f"mcp:{server}:{name}", f"Ruft {name} auf dem MCP-Server {server} auf", detail)
    return risk


def _handler(server: str, name: str):
    async def call(run, args):
        row = run.ctx.db.one("SELECT * FROM mcp_servers WHERE name=? AND enabled=1", server)
        if not row:
            raise Fail("MCP-Server nicht gefunden.")
        try:
            async with _open(row) as client:
                with anyio.fail_after(CALL_S):
                    result = await client.call_tool(name, args)
        except Exception:
            raise Fail("Der MCP-Server ist nicht erreichbar oder der Aufruf ist gescheitert.") from None
        run.counters["untrusted"] = True
        out = "\n".join(c.text for c in result.content if getattr(c, "text", None))
        if not out and result.structured_content is not None:
            out = dumps(result.structured_content)
        if result.is_error:
            raise Fail(out[:2000] or "Der MCP-Server meldet einen Fehler.")
        return out or "ok"
    return call


async def refresh(ctx, name: str) -> dict:
    """Verbindet, liest die Werkzeuge, trägt sie in TOOLS ein. Fehler landen im Zustand, nie als Ausnahme."""
    row = ctx.db.one("SELECT * FROM mcp_servers WHERE name=?", name)
    if not row:
        raise Fail("MCP-Server nicht gefunden.")
    if not row["enabled"]:
        _unregister(name)
        STATE[name] = {"status": "getrennt", "error": None, "tools": []}
        return STATE[name]
    try:
        tools, cursor = [], None
        with anyio.fail_after(CONNECT_S):
            async with _open(row) as client:
                for _ in range(20):
                    page = await client.list_tools(cursor=cursor)
                    tools += page.tools
                    cursor = page.next_cursor
                    if not cursor:
                        break
        _register(name, tools)
        STATE[name] = {"status": "verbunden", "error": None, "tools": [
            {"name": t.name, "description": t.description or "", "readOnly": bool(t.annotations and t.annotations.read_only_hint)} for t in tools]}
    except Exception as e:
        _unregister(name)
        why = "Programm nicht gefunden" if isinstance(e, FileNotFoundError) else "Zeitüberschreitung" if isinstance(e, TimeoutError) else "Verbindung fehlgeschlagen"
        STATE[name] = {"status": "fehler", "error": f"{why}.", "tools": []}
    return STATE[name]


async def start(ctx) -> None:
    """Beim Dienststart aufrufen (boot.start): trägt die Werkzeuge aller aktiven Server ein."""
    await asyncio.gather(*(refresh(ctx, r["name"]) for r in ctx.db.all("SELECT name FROM mcp_servers WHERE enabled=1")))


async def server_view(ctx, row) -> dict:
    s = STATE.get(row["name"]) or {"status": "getrennt", "error": None, "tools": []}
    return {"name": row["name"], "transport": row["transport"], "url": row["url"], "command": row["command"], "args": loads(row["args"], []),
            "enabled": bool(row["enabled"]), "hasToken": await keychain.get(account(row["name"])) is not None,
            "status": s["status"], "error": s["error"], "tools": s["tools"]}


async def listing(ctx) -> list[dict]:
    rows = ctx.db.all("SELECT * FROM mcp_servers ORDER BY created_at, name")
    await asyncio.gather(*(refresh(ctx, r["name"]) for r in rows if r["enabled"] and r["name"] not in STATE))
    return [await server_view(ctx, r) for r in rows]


def _local(url: str) -> bool:
    u = urlparse(url)
    return u.scheme == "http" and u.hostname in ("127.0.0.1", "localhost")


async def add(ctx, body: dict) -> dict:
    name, transport = body.get("name"), body.get("transport")
    if not (isinstance(name, str) and 2 <= len(name) <= 40 and NAME.match(name)):
        raise Fail("Name: 2–40 Zeichen, nur Kleinbuchstaben, Ziffern und Bindestriche.")
    if transport not in ("http", "stdio"):
        raise Fail("Übertragung muss http oder stdio sein.")
    url = command = args = None
    if transport == "http":
        url = body.get("url")
        try:
            u = urlparse(url)
            ok = isinstance(url, str) and len(url) <= 2048 and u.hostname and not u.username and not u.password and (u.scheme == "https" or _local(url))
        except ValueError:
            ok = False
        if not ok:
            raise Fail("Adresse muss mit https:// beginnen (lokal ist auch http://127.0.0.1 oder http://localhost erlaubt).")
    else:
        command, args = body.get("command"), body.get("args", [])
        if not (isinstance(command, str) and 0 < len(command.strip()) <= 500):
            raise Fail("Befehl fehlt.")
        if not (isinstance(args, list) and len(args) <= 50 and all(isinstance(a, str) and len(a) <= 2000 for a in args)):
            raise Fail("Argumente müssen eine Liste aus Texten sein.")
        command = command.strip()
    token = body.get("token")
    if token is not None and not (isinstance(token, str) and len(token) <= 4096):
        raise Fail("Token ist ungültig.")
    if ctx.db.one("SELECT 1 FROM mcp_servers WHERE name=?", name):
        raise Fail("Diesen Namen gibt es schon.")
    if token:
        try:
            await keychain.set_item(keychain.SERVICE, account(name), token)
        except (OSError, ValueError):
            raise Fail("Der Token konnte nicht im Schlüsselbund gespeichert werden.") from None
    ctx.db.run("INSERT INTO mcp_servers (name,transport,url,command,args,env_keys,enabled,created_at) VALUES (?,?,?,?,?,NULL,1,?)",
               name, transport, url, command, dumps(args) if args is not None else None, now_ms())
    STATE.pop(name, None)
    await refresh(ctx, name)
    return {"ok": True, "server": await server_view(ctx, ctx.db.one("SELECT * FROM mcp_servers WHERE name=?", name))}


async def remove(ctx, name: str) -> None:
    if not ctx.db.run("DELETE FROM mcp_servers WHERE name=?", name):
        raise Fail("MCP-Server nicht gefunden.")
    _unregister(name)
    STATE.pop(name, None)
    await keychain.delete_item(keychain.SERVICE, account(name))
