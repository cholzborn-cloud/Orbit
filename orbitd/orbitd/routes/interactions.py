"""Approvals and questions (cards). Status codes as service/src/app.ts.

The deciding principal is the authenticated owner session: the service guard (security.check) admits only the app with
the service token, and that session is the single local owner. A principal named in a request body is ignored.
"""
from ..web import HttpError, Req, route

OWNER_SESSION = "local"


def _interactions(req: Req):
    return req.ctx.parts.get("interactions")


@route("GET", "/v1/approvals")
async def approvals(req: Req):
    inter = _interactions(req)
    return {"approvals": [c for c in inter.list() if c["kind"] == "approval"] if inter else []}


@route("POST", "/v1/approvals/{id}/decide")
async def decide(req: Req):
    inter, decision = _interactions(req), req.obj().get("decision")
    if inter is None or decision not in ("once", "always", "deny"):
        raise HttpError(400, "Invalid decision.")
    await inter.decide(req.params["id"], decision, principal=OWNER_SESSION)


@route("POST", "/v1/questions/{id}/answer")
async def answer(req: Req):
    inter = _interactions(req)
    if inter is None:
        raise HttpError(410, "This question is no longer open.")
    await inter.answer(req.params["id"], req.body)


@route("POST", "/v1/widgets/{id}/answer")
async def answer_widget(req: Req):
    inter = _interactions(req)
    if inter is None:
        raise HttpError(410, "This choice is no longer open.")
    return await inter.answer_widget(req.params["id"], req.body)


@route("POST", "/v1/secrets/{id}/answer")
async def answer_secret(req: Req):
    inter = _interactions(req)
    if inter is None:
        raise HttpError(410, "This secure request is no longer open.")
    return await inter.answer_secret(req.params["id"], req.body)
