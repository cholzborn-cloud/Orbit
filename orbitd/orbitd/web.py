"""Kleine Routen-Schicht über Starlette.

Zwei Fehlerformen wie in der Schnittstelle:
  A  HttpError(status, text)  -> {"error": text}                (Dienstfehler)
  B  Fail(text)               -> {"ok": false, "error": text}   (Aktionsfehler; 404 wenn „nicht gefunden“, sonst 400)

Handler: `async def name(req: Req) -> dict | Response`. Ein dict wird JSON; `None` wird {"ok": true}.
"""
import json
import re
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

MAX_BODY = 1024 * 1024


class HttpError(Exception):
    def __init__(self, status: int, error: str):
        self.status, self.error = status, error


class Fail(Exception):
    def __init__(self, error: str):
        self.error = error


@dataclass
class Req:
    params: dict[str, str]
    query: dict[str, str]
    body: Any
    ctx: Any  # orbitd.app.Ctx: db, bus, cfg, runtime …
    raw: Request = field(repr=False, default=None)

    def obj(self) -> dict:
        """Der Körper als Objekt ({} wenn er fehlt oder kein Objekt ist)."""
        return self.body if isinstance(self.body, dict) else {}


Handler = Callable[[Req], Awaitable[Any]]
_routes: list[tuple[str, str, Handler, int]] = []


def route(method: str, path: str, max_body: int = MAX_BODY):
    """Registriert einen Handler. Pfad-Parameter als `{id}`."""

    def register(handler: Handler) -> Handler:
        _routes.append((method, path, handler, max_body))
        return handler

    return register


def fail_response(error: str) -> JSONResponse:
    return JSONResponse({"ok": False, "error": error}, 404 if re.search("nicht gefunden", error, re.I) else 400)


def _endpoint(handler: Handler, max_body: int, ctx):
    async def endpoint(request: Request) -> Response:
        body = None
        if request.method not in ("GET", "HEAD"):
            raw = await request.body()
            if len(raw) > max_body:
                big = "Die Nachricht ist zu groß." if max_body > MAX_BODY else "Die Anfrage ist zu groß."
                return JSONResponse({"error": big}, 413)
            if raw:
                try:
                    body = json.loads(raw)
                except ValueError:
                    return JSONResponse({"error": "Ungültige Anfrage."}, 400)
        try:
            result = await handler(Req(dict(request.path_params), dict(request.query_params), body, ctx, request))
        except HttpError as e:
            return JSONResponse({"error": e.error}, e.status)
        except Fail as e:
            return fail_response(e.error)
        if isinstance(result, Response):
            return result
        if isinstance(result, dict) and result.get("ok") is False:
            return fail_response(str(result.get("error", "")))
        return JSONResponse({"ok": True} if result is None else result)

    return endpoint


def build_routes(ctx) -> list[Route]:
    # Feste Pfade vor Parameter-Pfaden, damit /v1/skills/slash nicht als /v1/skills/{id} gilt.
    ordered = sorted(_routes, key=lambda r: (r[1].count("{"), -len(r[1])))
    return [Route(path, _endpoint(handler, max_body, ctx), methods=[method]) for method, path, handler, max_body in ordered]


# --- kleine Eingabeprüfer für Handler (Fehlertexte deutsch) ---

def need_str(obj: dict, key: str, lo: int = 1, hi: int = 10_000, label: str | None = None) -> str:
    value = obj.get(key)
    if not isinstance(value, str) or not lo <= len(value.strip()) <= hi:
        raise Fail(f"{label or key}: {lo}–{hi} Zeichen erwartet.")
    return value.strip()


def need_bool(obj: dict, key: str) -> bool:
    value = obj.get(key)
    if not isinstance(value, bool):
        raise Fail("Ungültige Eingabe.")
    return value
