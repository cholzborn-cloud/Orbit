"""Auto (Jev), Live-Limits, Modelle, Nutzung, Gesundheitsprüfungen. Kein Netz, keine echten Programme."""
import asyncio
import json
from pathlib import Path

import httpx
import pytest

from orbitd import keychain
from orbitd.db import now_ms
from orbitd.jev import Jev
from orbitd.limits import Limits
from orbitd.routes.models import health_checks
from orbitd.web import Fail

GOLDEN = Path(__file__).parent / "contract" / "golden"


class Fake:
    def __init__(self, ok=True):
        self.ok = ok

    def available(self):
        return self.ok


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setenv("ORBIT_BRAIN", "off")
    monkeypatch.setenv("ORBIT_KEYCHAIN_FAKE", json.dumps({"OPENROUTER_JEV_API_KEY": "k"}))


@pytest.fixture
def env(ctx, seed):
    ctx.parts["adapters"] = {n: Fake() for n in ("claude", "codex", "cursor", "agy")}
    ctx.parts["limits"] = Limits(ctx)
    jev = Jev(ctx)
    calls = []
    answer = {"choice": "medium", "confidence": 0.9}

    def handler(request):
        calls.append(request)
        if answer is None:
            return httpx.Response(500)
        return httpx.Response(200, json={"answers": {"tier": answer}, "usage": {"cost": 0.01}})

    jev.transport = httpx.MockTransport(handler)
    jev.calls, jev.answer = calls, lambda a: answer.update(a) if a else None
    return jev


def ask(jev, text="Hallo", chat="chat1", files=False):
    return asyncio.run(jev.choose({"chatId": chat, "botId": "bot1", "text": text, "hasFiles": files}))


def age_state(ctx, minutes):
    ctx.db.run("UPDATE chat_model_state SET last_turn_at=?", now_ms() - minutes * 60_000)


def test_start_small_then_warm_upgrade_only_from_075(env, ctx):
    env.answer({"choice": "small", "confidence": 0.9})
    r = ask(env)
    assert r["id"] == "claude-haiku-5-5" and r["jev"]["change"] == "start" and r["jev"]["source"] == "jev"
    env.answer({"choice": "large", "confidence": 0.7})
    assert ask(env)["jev"]["change"] == "keep"
    env.answer({"choice": "small", "confidence": 0.99})
    assert ask(env)["id"] == "claude-haiku-5-5"  # nie zurück
    env.answer({"choice": "large", "confidence": 0.8})
    r = ask(env)
    assert r["id"] == "claude-opus-5-5" and r["jev"]["change"] == "upgrade" and r["jev"]["from"] == "Haiku 5.5"
    assert ctx.db.val("SELECT count(*) FROM jev_log WHERE kind='route'") == 4
    age_state(ctx, 6)
    env.answer({"choice": "small", "confidence": 0.9})
    assert ask(env)["jev"]["change"] == "reset"


def test_budget_full_no_http_still_sensible(env, ctx):
    ctx.db.run("INSERT INTO jev_log (id,user_id,kind,cost_usd,created_at) VALUES ('x','local','route',0.6,?)", now_ms())
    r = ask(env, "Bitte programmiere mir eine Funktion, es gibt einen Fehler.")
    assert env.calls == [] and r["jev"]["source"] == "fallback" and r["jev"]["tier"] == "coding" and r["id"] == "gpt-6.1-sol"
    assert "Tagesbudget" in r["jev"]["reason"]
    assert ask(env, "Wie spät ist es?", chat="")["jev"]["tier"] == "small"


def test_outage_pauses_three_minutes(env):
    env.answer(None)
    env.transport = httpx.MockTransport(lambda r: env.calls.append(r) or httpx.Response(500))
    r = ask(env, "Kurze Frage")
    assert r["jev"]["source"] == "fallback" and len(env.calls) == 1
    ask(env, "Noch eine", chat="")
    assert len(env.calls) == 1  # Pause


def test_claude_blocked_other_cli_with_reason(env):
    env.limits.block("claude", now_ms() + 60_000, "Limit")
    env.answer({"choice": "small", "confidence": 0.9})
    r = ask(env)
    assert r["id"] == "gpt-6-luna" and "Claude ist gesperrt" in r["jev"]["reason"] and "deshalb Luna 6" in r["jev"]["reason"]


def test_first_nearly_full_second_free(env):
    env.limits.record("claude", {"windows": [{"name": "5h", "used": 0.92, "resetAt": now_ms() + 1000}], "blocked": False})
    env.answer({"choice": "small", "confidence": 0.9})
    r = ask(env)
    assert r["id"] == "gpt-6-luna" and "Claude ist zu 92 % ausgelastet, deshalb Luna 6." in r["jev"]["reason"]


def test_remembered_model_stays_when_warm(env, ctx):
    env.answer({"choice": "small", "confidence": 0.9})
    assert ask(env)["id"] == "claude-haiku-5-5"
    env.limits.record("claude", {"windows": [{"name": "5h", "used": 0.9, "resetAt": now_ms() + 1000}], "blocked": False})
    r = ask(env)
    assert r["id"] == "claude-haiku-5-5" and r["jev"]["change"] == "keep"
    env.limits.block("claude", now_ms() + 60_000, "Limit")  # scheidet aus: dann neu
    assert ask(env)["id"] == "gpt-6-luna"


def test_empty_tier_falls_to_next_and_nothing_fails(env):
    env.limits.block("claude", now_ms() + 60_000)
    env.limits.block("codex", now_ms() + 60_000)
    env.answer({"choice": "large", "confidence": 0.9})
    r = ask(env)
    assert r["id"] == "gemini-3.8-flash" and "kein Programm frei" in r["jev"]["reason"]
    for a in env.ctx.parts["adapters"].values():
        a.ok = False
    with pytest.raises(Fail, match="kein Programm nutzbar"):
        ask(env, chat="")


def test_limits_survive_restart_and_blocks_expire(ctx):
    lim = Limits(ctx)
    lim.record("codex", {"windows": [{"name": "5h", "used": 0.4, "resetAt": now_ms() + 5000}], "blocked": False})
    lim.block("claude", now_ms() + 60_000, "voll")
    again = Limits(ctx)
    assert again.get("codex")["windows"][0]["used"] == 0.4 and again.headroom("codex") == pytest.approx(0.6)
    assert again.get("claude")["blocked"] and again.headroom("unbekannt") == 1
    again.block("claude", now_ms() - 1)
    assert not again.get("claude")["blocked"]


def test_models_and_usage_against_golden(client, ctx):
    ctx.parts["adapters"] = {"claude": Fake(False), "codex": Fake(False), "cursor": Fake(False), "agy": Fake()}
    gm = json.loads((GOLDEN / "get_v1_models.json").read_text())["body"]
    body = client.get("/v1/models").json()
    assert set(body) == set(gm)
    neu = {"fast", "legacy"}  # additiv seit den Modellkarten: Fast-Modus und „älter“; der Rest bleibt wie im Golden
    ohne = lambda ms: [{k: v for k, v in m.items() if k not in neu} for m in ms if m["provider"] != "google"]
    assert ohne(body["models"]) == ohne(gm["models"])
    google = [m for m in body["models"] if m["provider"] == "google"]  # Gemini ist seit den Modellfamilien EIN Modell mit drei Denkstufen (früher drei Einträge)
    assert [(m["id"], m["efforts"], m["cli"]["provider"]) for m in google] == [("gemini-3.8-flash", ["low", "medium", "high"], "agy")]
    assert all(m["id"] != "auto" for m in body["models"])
    gu = json.loads((GOLDEN / "get_v1_usage.json").read_text())["body"]
    u = client.get("/v1/usage").json()
    assert set(u) == set(gu) and [p["provider"] for p in u["providers"]][:3] == ["claude", "codex", "antigravity"]
    note = "No values yet. They arrive with the next reply."
    assert u["providers"][0] == gu["providers"][0] | {
        "accounts": [gu["providers"][0]["accounts"][0] | {"note": note}],
        "note": note,
    }
    ctx.parts["limits"].record("claude", {"windows": [{"name": "5h", "used": 0.3, "resetAt": 5}], "blocked": False})
    p = client.get("/v1/usage").json()["providers"][0]
    assert p["status"] == "ok" and p["accounts"][0]["windows"][0]["used"] == 0.3


def test_health_checks_all_ids(ctx):
    checks = asyncio.run(health_checks(ctx))
    assert [c["id"] for c in checks] == ["claude", "codex", "cursor", "agy", "daytona", "jev", "brain", "plugins"]
    assert all(c["state"] in ("ok", "fehlt", "fehler") and c["label"] for c in checks)
    by = {c["id"]: c for c in checks}
    assert by["jev"]["state"] == "ok" and by["daytona"]["state"] == "fehlt" and by["brain"]["state"] == "fehlt"
