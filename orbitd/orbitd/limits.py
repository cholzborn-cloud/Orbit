"""Live-Limits der Programme: letzte gemeldete Fenster, Sperren und Spielraum. Grundlage für Auto (Jev) und /v1/usage.

Werte kommen aus Ev „limits“ der Adapter (record), aus „Nutzungslimit erreicht“ (block) und für Codex aus `codex app-server`.
Gemerkt wird im Speicher und in app_kv `limits:<cli>`, damit ein Neustart die letzten Werte kennt.
"""
import asyncio
import time

from .cli.base import which
from .cli.codex import codex_request
from .db import dumps, loads, now_ms

BLOCK_DEFAULT_MS = 10 * 60_000  # Sperre ohne bekannte Rückkehrzeit
CODEX_EVERY = 60.0
CODEX_TIMEOUT = 8.0


def _clean(windows) -> list[dict]:
    out = []
    for w in windows if isinstance(windows, list) else []:
        if isinstance(w, dict) and isinstance(w.get("used"), (int, float)):
            out.append({"name": str(w.get("name", "")), "used": max(0.0, float(w["used"])), "resetAt": int(w.get("resetAt") or 0)})
    return out


class Limits:
    def __init__(self, ctx):
        self.ctx = ctx
        self.data: dict[str, dict] = {}
        self.codex_at = 0.0
        for r in ctx.db.all("SELECT key,value FROM app_kv WHERE key LIKE 'limits:%'"):
            entry = loads(r["value"])
            if isinstance(entry, dict):
                self.data[r["key"][7:]] = entry

    def _save(self, cli: str) -> None:
        self.ctx.db.run("INSERT OR REPLACE INTO app_kv (key,value,updated_at) VALUES (?,?,?)", f"limits:{cli}", dumps(self.data[cli]), now_ms())

    def record(self, cli: str, data: dict) -> None:
        t = now_ms()
        windows = _clean(data.get("windows"))
        blocked = bool(data.get("blocked"))
        resets = [w["resetAt"] for w in windows if w["used"] >= 1 and w["resetAt"] > t] or [w["resetAt"] for w in windows if w["resetAt"] > t]
        until = max(resets, default=t + BLOCK_DEFAULT_MS) if blocked else 0
        self.data[cli] = {"windows": windows, "blocked": blocked, "until": until, "note": data.get("note"), "at": t}
        self._save(cli)

    def block(self, cli: str, until_ms: int, note: str | None = None) -> None:
        entry = self.data.get(cli) or {"windows": [], "at": now_ms()}
        self.data[cli] = {**entry, "blocked": True, "until": int(until_ms), "note": note}
        self._save(cli)

    def get(self, cli: str) -> dict:
        """{windows, blocked, note, at}; `at` None = noch nie etwas gemeldet. Die Sperre gilt nur bis `until`."""
        e = self.data.get(cli)
        if not e:
            return {"windows": [], "blocked": False, "note": None, "at": None}
        return {"windows": e["windows"], "blocked": bool(e.get("blocked")) and e.get("until", 0) > now_ms(), "note": e.get("note"), "at": e.get("at")}

    def headroom(self, cli: str) -> float:
        """1 − größte Auslastung (Fenster nach ihrer Rückkehrzeit zählen als leer); ohne Werte 1."""
        t = now_ms()
        used = [w["used"] for w in self.get(cli)["windows"] if not 0 < w["resetAt"] <= t]
        return max(0.0, 1 - max(used, default=0.0))

    async def refresh_codex(self, force: bool = False) -> None:
        """Fragt `codex app-server` nach den Fenstern (höchstens alle 60 s). Fehler bleiben still, der alte Stand gilt."""
        if not force and time.monotonic() - self.codex_at < CODEX_EVERY:
            return
        self.codex_at = time.monotonic()
        binary = which("codex")
        if not binary:
            return
        try:
            result = await asyncio.wait_for(codex_request([binary], "account/rateLimits/read", None), CODEX_TIMEOUT)
        except Exception:
            return
        if result:
            self.record("codex", parse_codex(result))


def parse_codex(result: dict) -> dict:
    """Antwort von account/rateLimits/read -> {windows, blocked}. 300 Min = 5h, 10080 Min = 7d."""
    limits = (result or {}).get("rateLimits") or {}
    windows = []
    for w in (limits.get("primary"), limits.get("secondary")):
        name = {300: "5h", 10080: "7d"}.get((w or {}).get("windowDurationMins"))
        used, reset = (w or {}).get("usedPercent"), (w or {}).get("resetsAt")
        if name and isinstance(used, (int, float)) and 0 <= used <= 100 and isinstance(reset, (int, float)) and reset > 0:
            windows.append({"name": name, "used": used / 100, "resetAt": int(reset * 1000)})
    blocked = (result or {}).get("ordinaryUsageAllowed") is False or bool(limits.get("rateLimitReachedType")) or any(w["used"] >= 1 for w in windows)
    return {"windows": windows, "blocked": blocked}
