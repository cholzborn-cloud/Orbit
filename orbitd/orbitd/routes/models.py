"""Modelle, Nutzung (Live-Limits) und Gesundheitsprüfungen der Einrichtung."""
import asyncio
import json
import math
import os
from datetime import datetime, timedelta
from pathlib import Path
import time

from .. import cli, keychain, sandbox
from ..config import isolated_dir
from ..cli.base import Turn, base_env, profile_command, which
from ..cli.setup import CURSOR_LOGIN
from ..db import now_ms
from ..limits import Limits
from ..web import Req, route
from .skills import brain_path

MODELS_TTL = 60.0
MODELS_ERROR_TTL = 5.0
CHECK_TIMEOUT = 8.0
PROVIDERS = [("claude", "claude", "Claude"), ("codex", "codex", "Codex"), ("antigravity", "agy", "Antigravity"), ("cursor", "cursor", "Cursor")]
NO_VALUES = "No values yet. They arrive with the next reply."


def adapters(ctx) -> dict:
    if "adapters" not in ctx.parts:
        ctx.parts["adapters"] = cli.adapters(ctx.cfg.fake_cli)
    return ctx.parts["adapters"]


def limits(ctx) -> Limits:
    if "limits" not in ctx.parts:
        ctx.parts["limits"] = Limits(ctx)
    return ctx.parts["limits"]


@route("GET", "/v1/models")
async def list_models(req: Req):
    cache = req.ctx.parts.get("models_cache")
    if cache:
        ttl = MODELS_ERROR_TTL if cache[1].get("cursorError") else MODELS_TTL
        if time.monotonic() - cache[0] < ttl:
            return cache[1]
    if not req.ctx.cfg.fake_cli:
        cli.refresh()
    have = adapters(req.ctx)
    entries = list(cli.MODELS)
    cursor_error = None
    if not req.ctx.cfg.fake_cli:
        entries = [m for m in entries if m["cli"] != "cursor"]
        if have["cursor"].available():
            try:
                cursor = await have["cursor"].catalog()
                entries.extend(cursor)
                if not cursor:
                    cursor_error = "Cursor bietet gerade keine Modelle an."
            except cli.CliError:
                cursor_error = f"Cursor-Modelle konnten nicht geladen werden. {CURSOR_LOGIN}"
            except (TimeoutError, OSError):
                cursor_error = "Cursor-Modelle sind gerade nicht erreichbar."
    models = [{"id": m["id"], "label": m["label"], "description": m["description"], "provider": m["provider"], "efforts": m["efforts"],
               "fast": bool(m.get("fast")), "legacy": bool(m.get("legacy")),
               "cli": {"provider": m["cli"], "model": m["model"]}} for m in entries if have.get(m["cli"]) and have[m["cli"]].available()]
    out = {"ok": True, "modelsAvailable": bool(models), "models": models}
    if cursor_error:
        out["cursorError"] = cursor_error
    req.ctx.parts["models_cache"] = (time.monotonic(), out)
    return out


@route("GET", "/v1/usage")
async def usage(req: Req):
    lim = limits(req.ctx)
    await lim.refresh_codex(force=req.query.get("fresh") == "1")
    providers = []
    for provider, name, label in PROVIDERS:
        g = lim.get(name)
        if g["at"] is None:
            account = [{"id": "cli", "label": label, "status": "error", "windows": [], "note": NO_VALUES}] if name in ("claude", "codex") else []
            providers.append({"provider": provider, "status": "error", "accounts": account, "note": NO_VALUES})
            continue
        status = "limit" if g["blocked"] or any(w["used"] >= 1 for w in g["windows"]) else "ok"
        note = g["note"] if status == "limit" and g["note"] else None
        account = {"id": "cli", "label": label, "status": status, "windows": g["windows"], **({"note": note} if note else {})}
        providers.append({"provider": provider, "status": status, "accounts": [account], **({"note": note} if note else {})})
    return {"ok": True, "providers": providers, "fetchedAt": now_ms()}


def _prices() -> tuple[dict, str | None]:
    for file in (Path(__file__).parent.parent / "data/prices.json", Path(__file__).resolve().parents[3] / "lib/usage/prices.json"):
        try:
            data = json.loads(file.read_text(encoding="utf-8"))
            if isinstance(data.get("models"), dict):
                return data["models"], data.get("stand")
        except (OSError, ValueError, AttributeError):
            pass
    return {}, None


@route("GET", "/v1/usage/history")
async def usage_history(req: Req):
    from ..web import Fail
    period = req.query.get("period", "week")
    if period not in ("week", "month"):
        raise Fail("Choose week or month.")
    count = 7 if period == "week" else 30
    today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
    start = today - timedelta(days=count - 1)
    points = { (start + timedelta(days=i)).date().isoformat(): {"date": (start + timedelta(days=i)).date().isoformat(), "entries": {}}
               for i in range(count) }
    prices, prices_at = _prices()
    providers = {model[key]: model["cli"] for model in cli.MODELS for key in ("id", "model")}
    rows = req.ctx.db.all(
        "SELECT model,date(created_at/1000, 'unixepoch','localtime') AS day,"
        "sum(coalesce(input_tokens,0)) AS i,sum(coalesce(output_tokens,0)) AS o,"
        "sum(coalesce(cached_tokens,0)) AS cached,sum(coalesce(cache_write_tokens,0)) AS cache_write,sum(cost_usd) AS cost "
        "FROM turn_usage WHERE created_at>=? AND created_at<? GROUP BY model, day",
        int(start.timestamp()*1000), int((today+timedelta(days=1)).timestamp()*1000))
    try:
        rate = float(os.environ.get("ORBIT_USD_PER_EUR", ""))
        if not math.isfinite(rate) or rate <= 0.01:
            rate = None
    except ValueError:
        rate = None
    for record in rows:
        point = points.get(record["day"])
        if point is None:
            continue
        model = record["model"] or ""
        provider = providers.get(model) or next((kind for prefix, kind in (("claude","claude"),("gpt","codex"),("gemini","agy"),("cursor","cursor")) if model.startswith(prefix)), "other")
        target = point["entries"].setdefault(provider, {"input": 0, "output": 0, "costEur": None, "inputEur": None, "outputEur": None, "missingCost": False})
        target["input"] += record["i"]
        target["output"] += record["o"]
        price = prices.get(model)
        if rate and price:
            uncached = max(0, record["i"]-record["cached"]-record["cache_write"])
            input_cost = (uncached*price["input"] + record["cached"]*price.get("cacheRead",price["input"]) + record["cache_write"]*price.get("cacheWrite",price["input"])) / 1e6 / rate
            output_cost = record["o"]*price["output"] / 1e6 / rate
            target["inputEur"] = (target["inputEur"] or 0) + input_cost
            target["outputEur"] = (target["outputEur"] or 0) + output_cost
            target["costEur"] = (target["costEur"] or 0) + input_cost + output_cost
        elif rate and record["cost"] is not None:
            target["costEur"] = (target["costEur"] or 0) + record["cost"]/rate
        elif record["i"] or record["o"]:
            target["missingCost"] = True
    return {"ok": True, "days": list(points.values()), "fxConfigured": rate is not None, "priceDate": prices_at,
            "estimated": True, "currency": "EUR"}


# --- Gesundheitsprüfungen (von der Route /v1/health?checks=1 über ctx.parts["health_checks"] gerufen) ---

FIX = {
    "claude": ("Claude (claude CLI)", "Install the Claude CLI (claude.ai/code) and sign in with “claude auth login”.", "Sign in in a terminal with “claude auth login” (subscription login)."),
    "codex": ("GPT (codex CLI)", "Install the Codex CLI with “npm i -g @openai/codex” and sign in with “codex login”.", "Sign in in a terminal with “codex login” (ChatGPT login)."),
    "agy": ("Google (Antigravity CLI)", "Antigravity CLI is missing. Set up agy.", "Sign in to Antigravity yourself."),
    "cursor": ("Cursor (cursor-agent)", "Install cursor-agent (cursor.com/cli) and sign in with “cursor-agent login”.", "Reconnect Cursor in Settings."),
}
COMMANDS = {"claude": ["auth", "status"], "codex": ["login", "status"], "agy": ["models"], "cursor": ["models"]}


async def _run(binary: str, args: list[str]) -> tuple[int, str]:
    argv = sandbox.wrap(profile_command([binary, *args]), allow_service=True, keychain=True, cli=True) if isolated_dir() else [binary, *args]
    proc = await asyncio.create_subprocess_exec(*argv, env=base_env(Turn("", "", "", None, None, None, "", "")), stdin=asyncio.subprocess.DEVNULL,
                                                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT)
    try:
        out, _ = await asyncio.wait_for(proc.communicate(), CHECK_TIMEOUT)
    except BaseException:
        proc.kill()
        raise
    return proc.returncode or 0, out.decode("utf-8", "replace")


def _logged_in(name: str, code: int, out: str) -> bool:
    if name == "claude":
        try:
            return json.loads(out).get("loggedIn") is True
        except ValueError:
            return code == 0
    if name == "codex":
        return code == 0 and "logged in" in out.lower()
    if name == "agy":
        return code == 0 and "gemini" in out.lower()
    return code == 0


async def _cli_check(name: str, fake: bool) -> dict:
    label, missing, login = FIX[name]
    base = {"id": name, "label": label, "optional": name != "claude"}
    try:
        binary = "fake" if fake else which({"agy": "agy", "cursor": "cursor-agent"}.get(name, name))
        if not binary:
            return {**base, "state": "fehlt", "fix": missing}
        if fake:  # Attrappen-CLI: kein Anmeldestatus abfragbar
            return {**base, "state": "ok"}
        code, out = await _run(binary, COMMANDS[name])
        return {**base, "state": "ok"} if _logged_in(name, code, out) else {**base, "state": "fehler", "fix": login}
    except Exception:
        return {**base, "state": "fehler", "fix": login}


async def _key_check(id: str, label: str, key: str, missing: str, optional: bool) -> dict:
    base = {"id": id, "label": label, "key": key, **({"optional": True} if optional else {})}
    try:
        value = await keychain.composio_project_key() if key == "COMPOSIO_API_KEY" else await keychain.get(key)
        return {**base, "state": "ok"} if (value or "").strip() else {**base, "state": "fehlt", "fix": missing}
    except Exception:
        return {**base, "state": "fehler", "fix": "The key cannot be checked right now. Try again in a moment."}


def _brain() -> dict:
    base = {"id": "brain", "label": "Brain", "optional": True}
    try:
        return {**base, "state": "ok"} if brain_path() else {**base, "state": "fehlt", "fix": "The Brain folder was not found. Create it or set ORBIT_BRAIN_PATH."}
    except Exception:
        return {**base, "state": "fehler", "fix": "The Brain folder is not readable. Check the folder permissions."}


async def health_checks(ctx) -> list[dict]:
    fake = bool(ctx.cfg.fake_cli)
    clis = await asyncio.gather(*(_cli_check(n, fake) for n in ("claude", "codex", "cursor", "agy")))
    rest = await asyncio.gather(
        _key_check("daytona", "Daytona", "DAYTONA_API_KEY", "Set the Daytona key under Setup, or Orbis have no sandbox.", False),
        _key_check("jev", "Jev", "OPENROUTER_JEV_API_KEY", "Set the Jev key under Setup. Without it, Auto always uses the default model.", True),
        _key_check("plugins", "Plugin store", "COMPOSIO_API_KEY", "Set up Composio in the plugin store if you want to connect services.", True))
    return [*clis, rest[0], rest[1], _brain(), rest[2]]
