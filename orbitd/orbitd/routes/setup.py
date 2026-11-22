"""Agent-Programme installieren und anmelden: /v1/clis. Logik in orbitd/cli/setup.py."""
from ..cli import setup
from ..config import isolated_dir
from ..db import dumps, loads, now_ms
from ..web import Fail, Req, route


def _program(req: Req) -> setup.Program:
    program = setup.PROGRAMS.get(req.params["id"])
    if not program:
        raise Fail("Programm nicht gefunden.")
    return program


@route("GET", "/v1/clis")
async def clis(req: Req):
    return {"ok": True, "clis": await setup.get(req.ctx).status(
        fresh=req.query.get("fresh") == "1", account=req.query.get("account") == "1",
    )}


@route("POST", "/v1/clis/{id}/install")
async def install(req: Req):
    try:
        setup.get(req.ctx).start_install(_program(req))
    except setup.SetupError as e:
        raise Fail(str(e)) from None


@route("POST", "/v1/clis/{id}/login")
async def login(req: Req):
    program = _program(req)
    try:
        url, code = await setup.get(req.ctx).start_login(program)
    except setup.SetupError as e:
        raise Fail(str(e)) from None
    return {"ok": True, "url": url, "code": code, **({"opensBrowser": True} if program.opens_browser else {})}


@route("POST", "/v1/clis/{id}/login/input")
async def login_input(req: Req):
    text = req.obj().get("text")
    try:
        await setup.get(req.ctx).send_input(_program(req).id, text)
    except setup.SetupError as e:
        raise Fail(str(e)) from None


@route("POST", "/v1/clis/{id}/cancel")
async def cancel(req: Req):
    await setup.get(req.ctx).cancel(_program(req).id)

@route("POST", "/v1/clis/{id}/disconnect")
async def disconnect(req: Req):
    if isolated_dir() is None and not req.ctx.cfg.fake_cli:
        raise Fail("Das Trennen ist nur für ein eigenes Orbit-Profil verfügbar.")
    try:
        await setup.get(req.ctx).disconnect(_program(req))
    except setup.SetupError as e:
        raise Fail(str(e)) from None


@route("GET", "/v1/setup/profile")
async def profile_status(req: Req):
    db = req.ctx.db
    draft = loads(db.val("SELECT value FROM app_kv WHERE key='profile_setup'"), {})
    has_orbi = db.val("SELECT 1 FROM bots WHERE user_id='local' AND archived_at IS NULL LIMIT 1")
    if not has_orbi and isolated_dir() is not None:
        db.run("INSERT OR IGNORE INTO app_kv (key,value,updated_at) VALUES ('mac_local_tools','off',?)", now_ms())
    first_chat = db.val("SELECT value FROM app_kv WHERE key='first_start_chat'")
    if first_chat and db.val("SELECT 1 FROM chats WHERE id=? AND user_id='local'", first_chat):
        return {"ok": True, "required": True, "draft": draft, "completedChat": first_chat}
    return {"ok": True, "required": not bool(has_orbi), "draft": draft}


@route("PUT", "/v1/setup/profile")
async def save_profile_draft(req: Req):
    body = req.obj()
    step = body.get("step")
    limits = {"name": 400, "job": 400, "avatar": 80, "color": 16, "budgetUsd": 100, "budgetMax": 100, "macEnabled": 5, "person": 400}
    if type(step) is not int or not 0 <= step <= 8 or body.keys() - limits.keys() - {"step"}:
        raise Fail("Der Einrichtungsschritt ist ungültig.")
    for key, limit in limits.items():
        if key in body and (not isinstance(body[key], str) or len(body[key]) > limit):
            raise Fail("Der Entwurf ist zu lang.")
    req.ctx.db.run("INSERT OR REPLACE INTO app_kv (key,value,updated_at) VALUES ('profile_setup',?,?)", dumps(body), now_ms())


@route("POST", "/v1/setup/profile/finish")
async def finish_profile(req: Req):
    req.ctx.db.run("DELETE FROM app_kv WHERE key IN ('first_start_chat','profile_setup')")
