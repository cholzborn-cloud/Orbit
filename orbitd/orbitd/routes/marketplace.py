"""Marktplatz: Composio-Plugins, Apple Kalender, Skill-Katalog und eigene MCP-Server. Die alten Konnektoren gibt es nicht mehr."""
import json
import re
import shlex
from pathlib import Path

from .. import keychain
from ..db import dumps, now_ms
from ..tools import calendar, composio as composio_tools, user_mcp   # laden zugleich die Werkzeuge in contract.TOOLS
from ..tools.composio import composio
from ..web import Fail, Req, route

CATALOG = Path(__file__).resolve().parent.parent / "data" / "catalog.json"
GONE = "Konnektoren gibt es nicht mehr. Nutze den Marktplatz."


@route("GET", "/v1/marketplace")
async def marketplace(req: Req):
    try:
        entries = json.loads(CATALOG.read_text("utf-8"))
        ok = isinstance(entries, list) and entries and all(isinstance(e, dict) and e.get("type") == "skill" for e in entries)
    except (OSError, ValueError):
        ok = False
    if not ok:
        raise Fail("Der Marktplatz-Katalog ist ungültig.")
    return {"ok": True, "entries": entries}


# ---------------------------------------------------------------- Composio
@route("POST", "/v1/plugins/reload")
async def plugins_reload(req: Req):
    composio.reload()


@route("POST", "/v1/plugins/verify")
async def plugins_verify(req: Req):
    await composio.verify(req.obj())


@route("GET", "/v1/plugins/configuration")
async def plugins_configuration(req: Req):
    return {"ok": True, "configured": await composio.configured()}


@route("GET", "/v1/plugins")
async def plugins_catalog(req: Req):
    return await composio.catalog(req.query)


@route("POST", "/v1/plugins/{slug}/connect")
async def plugins_connect(req: Req):
    return await composio.connect(req.params["slug"], req.obj())


@route("GET", "/v1/plugins/{slug}/status")
async def plugins_status(req: Req):
    return await composio.status(req.params["slug"], req.query.get("accountId"))


@route("GET", "/v1/plugins/{slug}/accounts")
async def plugins_accounts(req: Req):
    return await composio.account_list(req.params["slug"])


@route("DELETE", "/v1/plugins/{slug}/accounts")
async def plugins_disconnect(req: Req):
    return await composio.disconnect(req.params["slug"], req.obj())


@route("GET", "/v1/plugins/{slug}/setup")
async def plugins_setup(req: Req):
    return await composio.setup(req.params["slug"])


@route("POST", "/v1/plugins/{slug}/setup")
async def plugins_setup_connect(req: Req):
    return await composio.setup_connect(req.params["slug"], req.obj())


@route("GET", "/v1/plugins/{slug}/entry")
async def plugin_entry(req: Req):
    return {"ok": True, "entry": await composio.entry(req.params["slug"])}


@route("GET", "/v1/plugins/{slug}/orbis")
async def plugin_orbis(req: Req):
    slug = composio._slug(req.params["slug"])
    return {"ok": True, "botIds": composio_tools.allowed_bots(req.ctx.db, slug)}


@route("PUT", "/v1/plugins/{slug}/orbis")
async def plugin_set_orbis(req: Req):
    slug = composio._slug(req.params["slug"])
    ids = req.obj().get("botIds")
    if ids is not None:
        if not isinstance(ids, list) or len(ids) > 100 or not all(isinstance(value, str) and re.fullmatch(r"[a-zA-Z0-9_-]{1,100}", value) for value in ids):
            raise Fail("Ungültige Auswahl.")
        existing = {row["id"] for row in req.ctx.db.all("SELECT id FROM bots WHERE user_id='local' AND archived_at IS NULL")}
        if set(ids) - existing:
            raise Fail("Ein ausgewählter Orbi gehört nicht zu diesem Profil.")
    req.ctx.db.run("INSERT OR REPLACE INTO app_kv (key,value,updated_at) VALUES (?,?,?)", f"plugin-bots:{slug}", dumps(ids), now_ms())
    return {"ok": True, "botIds": ids}


@route("GET", "/v1/plugins/{slug}/actions")
async def plugins_actions(req: Req):
    return await composio.actions(req.params["slug"], req.query.get("cursor"))


@route("GET", "/v1/icloud")
async def icloud_status(req: Req):
    return {"ok": True, "configured": bool(await keychain.get_item(*calendar.KEYCHAIN))}


@route("PUT", "/v1/icloud")
async def icloud_connect(req: Req):
    body = req.obj()
    result = await calendar.verify(body)
    try:
        await keychain.set_item(*calendar.KEYCHAIN, json.dumps({key: body[key] for key in ("appleId", "appPassword")}))
    except (OSError, ValueError):
        raise Fail("Die Anmeldung konnte nicht im Schlüsselbund gespeichert werden.") from None
    return result


@route("POST", "/v1/icloud/test")
async def icloud_test(req: Req):
    _, calendars = await calendar._client()
    return {"ok": True, "count": len(calendars)}


@route("DELETE", "/v1/icloud")
async def icloud_disconnect(req: Req):
    await keychain.delete_item(*calendar.KEYCHAIN)
    if await keychain.get_item(*calendar.KEYCHAIN):
        raise Fail("Die Anmeldung ließ sich nicht aus dem Schlüsselbund entfernen.")


@route("POST", "/v1/icloud/verify")
async def icloud_verify(req: Req):
    return await calendar.verify(req.obj())


# ---------------------------------------------------------------- eigene MCP-Server
@route("GET", "/v1/mcp-servers")
async def mcp_list(req: Req):
    return {"ok": True, "servers": await user_mcp.listing(req.ctx)}


@route("POST", "/v1/mcp-servers")
async def mcp_add(req: Req):
    body = req.obj()
    command = body.get("commandLine")
    if command is not None:
        if not isinstance(command, str) or not 1 <= len(command.strip()) <= 2000:
            raise Fail("Gib einen Befehl oder eine Adresse ein.")
        command = command.strip()
        if command.startswith(("https://", "http://")):
            body = {**body, "transport": "http", "url": command}
        else:
            try:
                executable, *arguments = shlex.split(command)
            except ValueError:
                raise Fail("Der Befehl enthält ein unvollständiges Anführungszeichen.") from None
            body = {**body, "transport": "stdio", "command": executable, "args": arguments}
    return await user_mcp.add(req.ctx, body)


@route("DELETE", "/v1/mcp-servers/{name}")
async def mcp_remove(req: Req):
    await user_mcp.remove(req.ctx, req.params["name"])


@route("POST", "/v1/mcp-servers/{name}/test")
async def mcp_test(req: Req):
    state = await user_mcp.refresh(req.ctx, req.params["name"])
    if state["status"] != "verbunden":
        raise Fail(f"MCP-Server nicht erreichbar: {state['error'] or 'getrennt'}")
    return {"ok": True, "count": len(state["tools"]), "tools": state["tools"]}


# ---------------------------------------------------------------- alte Konnektoren (die App ruft die Liste noch ab)
@route("GET", "/v1/connectors")
async def connectors_list(req: Req):
    return {"ok": True, "connectors": []}


async def _gone(req: Req):
    raise Fail(GONE)


for _method, _path in [("POST", "/v1/connectors"), ("PUT", "/v1/connectors/enabled"), ("POST", "/v1/connectors/{id}/test"), ("PUT", "/v1/connectors/{id}/enabled"),
                       ("PUT", "/v1/connectors/{id}/auth"), ("POST", "/v1/connectors/{id}/oauth"), ("DELETE", "/v1/connectors/{id}/oauth"),
                       ("DELETE", "/v1/connectors/{id}")]:
    route(_method, _path)(_gone)
