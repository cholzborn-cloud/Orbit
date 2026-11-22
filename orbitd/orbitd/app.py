"""Die Web-App: Sicherheitsprüfung, Routen, Start/Stopp der Hintergrundteile.

Start-/Stopp-Reihenfolge nach regnull/openbot main.py (start_background/stop_background):
Aktivitätslog kürzen -> Wiederanlauf -> Worker -> Zeitgeber; Stopp umgekehrt.
"""
import importlib
import logging
import pkgutil
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

from starlette.applications import Starlette
from starlette.datastructures import Headers
from starlette.responses import JSONResponse, Response

from . import config, sandbox, security
from .db import DB, open_db
from .events import Bus
from .web import build_routes

log = logging.getLogger("orbitd")
CORS_METHODS = "GET, POST, PUT, PATCH, DELETE"


@dataclass
class Ctx:
    """Alles, was Handler und Laufzeit teilen. Kein globaler Zustand außerhalb davon."""
    cfg: config.Config
    db: DB
    bus: Bus
    token: str
    parts: dict[str, Any] = field(default_factory=dict)  # Laufzeit-Teile nach Namen (runtime, interactions, …)

    def __getattr__(self, name: str):
        try:
            return self.parts[name]
        except KeyError:
            raise AttributeError(name) from None


class Guard:
    """Reine ASGI-Schicht: Host, Origin, Token und CORS für jede Anfrage, auch für unbekannte Pfade."""

    def __init__(self, app, token: str, port: int):
        self.app, self.token, self.port = app, token, port

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = Headers(scope=scope)
        origin = headers.get("origin")
        web = origin == security.WEB_ORIGIN
        if scope["method"] == "OPTIONS" and web and headers.get("host") == f"127.0.0.1:{self.port}":
            wanted = {h.strip().lower() for h in headers.get("access-control-request-headers", "").split(",")}
            if headers.get("access-control-request-method") in CORS_METHODS.split(", ") and wanted <= {"", "authorization", "content-type"}:
                response = Response(status_code=204, headers={
                    "Access-Control-Allow-Origin": security.WEB_ORIGIN, "Access-Control-Allow-Methods": CORS_METHODS,
                    "Access-Control-Allow-Headers": "Authorization, Content-Type", "Vary": "Origin"})
                return await response(scope, receive, send)
        failure = security.check(headers, self.token, self.port)
        if failure == 401 and scope["path"] == "/mcp":
            failure = None  # die Werkzeug-Brücke prüft ihr eigenes Lauf-Token; Host und Origin sind schon geprüft
        if failure:
            return await JSONResponse({"error": "Zugriff verweigert."}, failure)(scope, receive, send)

        async def send_cors(message):
            if web and message["type"] == "http.response.start":
                message["headers"] = [*message.get("headers", []),
                                      (b"access-control-allow-origin", security.WEB_ORIGIN.encode()),
                                      (b"access-control-expose-headers", b"x-vercel-ai-ui-message-stream"), (b"vary", b"Origin")]
            await send(message)

        await self.app(scope, receive, send_cors)


def _load_route_modules() -> None:
    from . import routes
    for module in pkgutil.iter_modules(routes.__path__):
        importlib.import_module(f"{routes.__name__}.{module.name}")
    importlib.import_module(f"{__package__}.tools.bridge")  # Route POST /mcp muss vor build_routes angemeldet sein


def create_app(cfg: config.Config | None = None) -> Starlette:
    cfg = cfg or config.load()
    sandbox.use(cfg)
    token = security.load_token(cfg.data_dir)
    ctx = Ctx(cfg=cfg, db=open_db(cfg.db_path), bus=Bus(), token=token)
    _load_route_modules()

    @asynccontextmanager
    async def lifespan(app):
        from . import boot
        await boot.start(ctx)
        try:
            yield
        finally:
            await boot.stop(ctx)
            ctx.db.close()

    async def not_found(request, exc):
        return JSONResponse({"error": "Nicht gefunden."}, 404)

    async def method_not_allowed(request, exc):
        return JSONResponse({"error": "Nicht gefunden."}, 404)

    async def crashed(request, exc):
        log.exception("Anfrage gescheitert: %s %s", request.method, request.url.path)
        return JSONResponse({"error": "Der lokale Dienst konnte die Anfrage nicht verarbeiten."}, 500)

    app = Starlette(routes=build_routes(ctx), lifespan=lifespan,
                    exception_handlers={404: not_found, 405: method_not_allowed, 500: crashed, Exception: crashed})
    app.state.ctx = ctx
    app.add_middleware(Guard, token=token, port=cfg.port)
    return app
