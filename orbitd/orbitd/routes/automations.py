from .. import automations as store
from ..web import Fail, Req, route


@route("GET", "/v1/automations")
async def list_automations(req: Req):
    return {"ok": True, **store.list_all(req.ctx.db)}


@route("POST", "/v1/automations")
async def create_automation(req: Req):
    raise Fail("Routinen legt dein Orbi an. Schreib ihm, was er regelmäßig tun soll.")


@route("GET", "/v1/automations/unread")
async def unread(req: Req):
    try:
        since = int(req.query.get("since", 0))
    except ValueError:
        since = 0
    return {"ok": True, "count": store.unread_count(req.ctx.db, since)}


@route("PATCH", "/v1/automations/{id}")
async def update_automation(req: Req):
    store.update(req.ctx.db, req.params["id"], req.obj())


@route("PUT", "/v1/automations/{id}/enabled")
async def set_enabled(req: Req):
    store.set_enabled(req.ctx.db, req.params["id"], req.obj().get("enabled") is True)


@route("POST", "/v1/automations/{id}/trash")
async def trash_automation(req: Req):
    store.trash(req.ctx.db, req.params["id"])


@route("POST", "/v1/automations/{id}/restore")
async def restore_automation(req: Req):
    store.restore(req.ctx.db, req.params["id"])


@route("DELETE", "/v1/automations/{id}")
async def delete_automation(req: Req):
    store.delete(req.ctx.db, req.params["id"])


@route("GET", "/v1/automations/{id}/runs")
async def runs(req: Req):
    return {"ok": True, "runs": store.list_runs(req.ctx.db, req.params["id"])}


@route("POST", "/v1/automations/{id}/run")
async def run_now(req: Req):
    blocked = store.run_blocker(req.ctx.db, req.params["id"])
    if blocked:
        raise Fail(blocked)
    return {"ok": True, "runId": await req.ctx.runtime.run_automation(req.params["id"], "manual")}
