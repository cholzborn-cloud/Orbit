"""Profil-Schalter: Hintergrundarbeit pausiert den Zeitgeber; Mitteilungen achten auf Präsenz und Flags."""
import json

import pytest

from orbitd.db import dumps, now_ms
from orbitd.web import Fail


def _profile(ctx, **fields):
    cur = ctx.db.val("SELECT value FROM app_kv WHERE key='rust_user_profile'")
    data = json.loads(cur) if cur else {}
    data.update(fields)
    ctx.db.run("INSERT OR REPLACE INTO app_kv (key,value,updated_at) VALUES ('rust_user_profile',?,?)", dumps(data), now_ms())


def test_background_work_off_skips_scheduled_runs(client, ctx, seed):
    from orbitd import automations
    a = automations.create(ctx.db, {
        "botId": "bot1", "name": "Pause", "prompt": "Sag hi", "schedule": {"kind": "daily", "at": "09:00"},
        "timezone": "Europe/Berlin", "target": "same", "notify": "app", "model": "claude-haiku-5-5",
        "effort": None, "context": True,
    })
    ctx.db.run("UPDATE automations SET next_run_at=? WHERE id=?", now_ms() - 5_000, a)
    _profile(ctx, backgroundWork=False)
    client.portal.call(ctx.parts["timer"].tick)
    assert ctx.db.val("SELECT count(*) FROM automation_runs") == 0
    assert ctx.db.val("SELECT next_run_at FROM automations WHERE id=?", a) <= now_ms()
    _profile(ctx, backgroundWork=True)
    client.portal.call(ctx.parts["timer"].tick)
    assert ctx.db.val("SELECT count(*) FROM automation_runs") == 1


def test_presence_and_notice_planning(client, ctx, seed):
    notices = ctx.parts["notices"]
    notices.set_active(False)
    _profile(ctx, notificationsApprovals=True, sound=False)
    planned = notices._plan({"type": "approval", "id": "a1", "status": "pending", "tool": "mac_shell", "botId": "bot1"})
    assert planned and planned[0].endswith("braucht deine Freigabe") and planned[2] is False
    assert notices._plan({"type": "approval", "id": "a1", "status": "pending", "tool": "mac_shell", "botId": "bot1"}) is None
    notices.set_active(True)
    assert notices._plan({"type": "approval", "id": "a2", "status": "pending", "tool": "x", "botId": "bot1"}) is None
    assert client.put("/v1/settings/presence", json={"active": False}).json() == {"ok": True, "active": False}
    assert notices.app_active is False
    _profile(ctx, notificationsDone=False)
    assert notices._plan({"type": "status", "status": "fertig", "chatId": "chat1", "botId": "bot1"}) is None
    _profile(ctx, notificationsDone=True)
    done = notices._plan({"type": "status", "status": "fertig", "chatId": "chat1", "botId": "bot1"})
    assert done and "fertig" in done[0]


def test_cloud_off_blocks_wake(client, ctx, seed):
    from orbitd.tools import daytona
    _profile(ctx, cloud=False)
    assert daytona.cloud_allowed(ctx) is False

    class Run:
        pass
    run = Run()
    run.ctx = ctx
    run.bot = {"id": "bot1", "sandbox_id": "sb-1"}

    with pytest.raises(Fail, match="Cloud-Computer"):
        client.portal.call(daytona.computer_wake, run, {})
