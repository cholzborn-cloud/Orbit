import os
from pathlib import Path

from ..runtime.contract import PROTOCOL_VERSION
from ..web import Req, route


def build_id() -> str | None:
    """Build fingerprint written by package.sh next to the service code; the acceptance harness compares it."""
    env = os.environ.get("ORBIT_BUILD_ID")
    if env:
        return env
    marker = Path(__file__).resolve().parents[1] / "BUILD_ID"
    return marker.read_text().strip() if marker.is_file() else None


@route("GET", "/v1/health")
async def health(req: Req):
    if req.query.get("checks") != "1" or "health_checks" not in req.ctx.parts:
        return {"ok": True, "protocol": PROTOCOL_VERSION, "build": build_id()}
    try:
        return {"ok": True, "checks": await req.ctx.health_checks()}
    except Exception:
        return {"ok": True, "checks": None}


@route("GET", "/v1/events")
async def events(req: Req):
    runtime = req.ctx.parts.get("runtime")
    snapshot = req.ctx.parts.get("snapshot") or (runtime.snapshot if runtime else lambda: {"approvals": [], "working": [], "automations": [], "steps": []})
    return req.ctx.bus.stream(snapshot)
