"""Tool bridge: stateless MCP server (Streamable HTTP, JSON answers) for the agent CLIs.

Every run gets a one-time token (memory only); the token decides which run a call belongs to.
tools/call: alias -> role manifest -> find tool -> schema -> risk -> interactions.gate -> ledger claim -> run.step(start)
-> handler -> ledger record -> run.step(end) -> capping. tools/list applies the same role manifest.
"""
import asyncio
import importlib
import json
import logging
import secrets
import traceback

from jsonschema import Draft202012Validator
from starlette.responses import JSONResponse, Response

from ..db import new_id
from ..redact import redact
from ..runtime.contract import TOOLS
from ..web import Fail, HttpError, Req, route
from . import core, roles, work  # noqa: F401  (core registers say, ask_user, react, memory, routines, Orbis)

log = logging.getLogger("orbitd")
DEFAULT_PROTOCOL = "2025-06-18"
FAILED = "The tool failed."
MAX_IMAGES = 4 * 1024 * 1024  # base64 characters of all images of one result together
# Old tool names that saved routines or prompts may still use (prose row "GetMcpTools/CallMcpTool"). Filled by tool modules.
ALIASES: dict[str, str] = {}


class Bridge:
    def __init__(self, ctx):
        self.ctx = ctx
        self.runs: dict[str, object] = {}  # Token -> Lauf

    @property
    def url(self) -> str:
        return f"http://127.0.0.1:{self.ctx.cfg.port}/mcp"

    def register(self, run) -> str:
        token = secrets.token_urlsafe(32)
        self.runs[token] = run
        return token

    def unregister(self, token: str) -> None:
        self.runs.pop(token, None)

    @staticmethod
    def tools_for(run, *, listing: bool = False) -> dict:
        role = roles.role_of(run)
        return {name: t for name, t in TOOLS.items()
                if (t.groups or run.chat_kind != "group") and (t.available is None or t.available(run))
                and (not listing or roles.allowed(role, name, listing=True))}

    async def call(self, run, name: str, args) -> tuple[str, bool, list[dict]]:
        """Der Aufruf läuft als Task am Lauf: Stopp und Abschluss des Laufs brechen ihn ab (siehe `_call`)."""
        calls = getattr(run, "calls", None)
        task = asyncio.ensure_future(self._call(run, name, args))
        if calls is not None:
            calls.add(task)
            task.add_done_callback(calls.discard)
        return await task

    async def _call(self, run, name: str, args) -> tuple[str, bool, list[dict]]:
        """Führt ein Werkzeug aus. Liefert (Text, ist_Fehler, Bilder); wirft nie außer bei Abbruch.
        Ein Handler darf Bilder mitgeben: dict mit "_images": [{"data": base64, "mimeType": …}]; sie gehen nicht in den Text, zusammen höchstens 4 MB."""
        if getattr(run, "end_turn", False):
            return "This turn has already ended.", True, []
        name = ALIASES.get(name, name)
        tool = self.tools_for(run).get(name)
        if tool is None:
            return "This tool does not exist here.", True, []
        if not isinstance(args, dict):
            return "Invalid input: arguments must be an object.", True, []
        role = roles.role_of(run)
        if not roles.allowed(role, name, args):
            return roles.refusal(role, name), True, []
        problem = next(iter(Draft202012Validator(tool.schema).iter_errors(args)), None)
        if problem:
            where = "/".join(str(p) for p in problem.absolute_path)
            return f"Invalid input{f' ({where})' if where else ''}: {problem.message}", True, []
        started, ticket, inter = False, None, self.ctx.parts.get("interactions")
        try:
            risk = tool.risk(run, args) if tool.risk else None
            if risk:
                ticket = await inter.gate(run, tool, args, risk)
                if run not in self.runs.values():  # the run has ended meanwhile: a late approval runs nothing
                    return "Der Lauf ist beendet.", True, []
                if ticket:
                    inter.claim(run, ticket)  # exactly the reviewed payload, once, right before the handler
            label = tool.label(args) if tool.label else None
            call_id = new_id()
            if label:
                run.step(call_id, name, label, "start")
                started = True
            try:
                result = await tool.handler(run, args)
            except Fail:
                ticket and inter.settle(ticket, "failed")
                raise
            except BaseException:
                ticket and inter.settle(ticket, "unknown")  # the provider may or may not have acted: readback before any retry
                raise
            finally:
                if started:
                    run.step(call_id, name, label, "end")
            ticket and inter.settle(ticket, "failed" if isinstance(result, dict) and result.get("ok") is False else "done")
            images = []
            if isinstance(result, dict) and "_images" in result:
                result = dict(result)
                images = [i for i in result.pop("_images") or [] if isinstance(i, dict) and isinstance(i.get("data"), str)]
            failed = isinstance(result, dict) and result.get("ok") is False
            text = result if isinstance(result, str) else "ok" if result is None else json.dumps(result, ensure_ascii=False)
            if sum(len(i["data"]) for i in images) > MAX_IMAGES:
                images, text = [], f"{text}\n(The image was too large and was left out.)"
            return self._cap(run, name, text), failed, images
        except Fail as e:
            return e.error, True, []
        except Exception:
            log.error("tool %s failed: %s", name, redact(traceback.format_exc()))
            return FAILED, True, []

    @staticmethod
    def _cap(run, name: str, text: str) -> str:
        try:
            context = importlib.import_module("orbitd.context")
        except ModuleNotFoundError as e:
            if e.name != "orbitd.context":
                raise
            return text
        return context.cap_tool_output(run.ctx, run.chat_id, name, text)


def _result(rid, result) -> JSONResponse:
    return JSONResponse({"jsonrpc": "2.0", "id": rid, "result": result})


def _error(rid, code: int, message: str, status: int = 200) -> JSONResponse:
    return JSONResponse({"jsonrpc": "2.0", "id": rid, "error": {"code": code, "message": message}}, status)


@route("GET", "/mcp")
async def mcp_get(req: Req):
    return Response(status_code=405, headers={"Allow": "POST"})


@route("POST", "/mcp")
async def mcp(req: Req):
    bridge = req.ctx.parts.get("bridge")
    auth = req.raw.headers.get("authorization", "")
    token = auth[7:].strip() if auth[:7].lower() == "bearer " else ""
    run = bridge.runs.get(token) if bridge and token else None
    if run is None:
        raise HttpError(401, "Access denied.")
    msg = req.body
    if not isinstance(msg, dict) or msg.get("jsonrpc") != "2.0":
        return _error(None, -32600, "Invalid request.", 400)
    method, rid, params = msg.get("method"), msg.get("id"), msg.get("params")
    params = params if isinstance(params, dict) else {}
    if "id" not in msg or not isinstance(method, str):
        return Response(status_code=202)  # Benachrichtigungen und Antworten des Clients
    if method == "initialize":
        version = params.get("protocolVersion")
        return _result(rid, {"protocolVersion": version if isinstance(version, str) else DEFAULT_PROTOCOL,
                             "capabilities": {"tools": {}}, "serverInfo": {"name": "orbit", "version": "2.0.0"}})
    if method == "ping":
        return _result(rid, {})
    if method == "tools/list":
        return _result(rid, {"tools": [{"name": n, "description": t.description, "inputSchema": t.schema}
                                       for n, t in bridge.tools_for(run, listing=True).items()]})
    if method == "tools/call":
        name = params.get("name")
        if not isinstance(name, str):
            return _error(rid, -32602, "Tool name missing.")
        text, failed, images = await bridge.call(run, name, params.get("arguments") or {})
        blocks = [{"type": "image", "data": i["data"], "mimeType": i.get("mimeType") or "image/jpeg"} for i in images]
        return _result(rid, {"content": [{"type": "text", "text": text}, *blocks], "isError": failed})
    return _error(rid, -32601, "Unknown method.")
