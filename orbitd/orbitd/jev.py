"""Auto (Jev): wählt je Nachricht Stufe, Modell und Denkstufe. Vorbild: lib/jev/{client,route,stage,resolve,tiers}.ts.

1. Stufe: Jev-Dienst (OpenRouter) nur mit Schlüssel, Jev an und Tagesbudget; sonst eigene Einschätzung aus dem Text.
2. Stufung: Start klein, bei warmem Cache (< 5 min) nur hoch und nur ab Sicherheit 0,75, nach Pause frei.
3. Live-Limits: aus den Kandidaten der Stufe fällt aus, was fehlt, gesperrt oder fast voll ist.
"""
import re
import time
from datetime import datetime

import httpx

from . import cli, keychain
from .config import USER
from .db import dumps, new_id, now_ms
from .routes.misc import _budget
from .routes.models import adapters, limits
from .web import Fail

URL = "https://openrouter.ai/api/alpha/decisions"
MODEL = "typesafe/jev-1.13"
PAUSE_S = 180
COLD_MS = 5 * 60_000
START_CONFIDENCE, UPGRADE_CONFIDENCE = 0.6, 0.75
RANK = {"small": 0, "medium": 1, "large": 2, "coding": 2}
ORDER = ["small", "medium", "large", "coding"]
TIER_DE = {"small": "klein", "medium": "mittel", "large": "groß", "coding": "Programmieren"}
CRITERIA = {
    "small": "Einfache Fragen, kurze Antworten, kleine Änderungen.",
    "medium": "Alltagsaufgaben, Texte und mehrschrittige normale Aufgaben.",
    "large": "Komplexe Analyse, schwierige Aufgaben und anspruchsvolle Planung.",
    "coding": "Programmieren, Debugging und technische Änderungen.",
}
CANDIDATES = {
    "small": ["claude-haiku-5-5", "gpt-6-luna", "gemini-3.8-flash"],
    "medium": ["claude-sonnet-5-5", "gemini-3.8-flash", "cursor-auto"],
    "large": ["claude-opus-5-5", "gpt-6.1-sol"],
    "coding": ["gpt-6.1-sol", "claude-opus-5-5"],
}
CLI_NAME = {"claude": "Claude", "codex": "Codex", "cursor": "Cursor", "agy": "Antigravity"}
MIN_ROOM, LOW_ROOM, GOOD_ROOM = 0.05, 0.2, 0.5

CODE = re.compile(r"```|traceback|\bdef \w+\(|\bfunction\b|\bimport \w+|\.(py|ts|tsx|js|swift|rs|go)\b|programmier|\bcode\b|debug|refactor|implementier|\bbug\b|fehler|stacktrace", re.I)
BIG = re.compile(r"analysier|strategie|architektur|konzept|ausführlich|vergleich|abwäg|recherchier|plane\b", re.I)


def estimate(text: str, has_files: bool) -> str:
    """Eigene Einschätzung der Stufe, wenn Jev nicht gefragt werden kann."""
    if CODE.search(text):
        return "coding"
    if BIG.search(text) or len(text) > 1500:
        return "large"
    return "small" if len(text) <= 200 and not has_files else "medium"


def tier_order(tier: str) -> list[str]:
    i = ORDER.index(tier)
    return ORDER[i:] + ORDER[:i][::-1]  # erst gleich/höher, dann niedriger


class Jev:
    def __init__(self, ctx):
        self.ctx = ctx
        self.paused_until = 0.0
        self.transport = None  # Tests: httpx.MockTransport

    @property
    def adapters(self) -> dict:
        return adapters(self.ctx)

    @property
    def limits(self):
        return limits(self.ctx)

    # --- Jev-Dienst ---

    def _budget_left(self) -> bool:
        limit = _budget(self.ctx.db)["jevDailyUsd"]
        day = int(datetime.now().replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)
        return limit > 0 and self.ctx.db.val("SELECT coalesce(sum(cost_usd),0) FROM jev_log WHERE created_at>=?", day) < limit

    async def _ask(self, text: str, has_files: bool, small: bool) -> tuple[dict | None, str]:
        """(Antwort | None, Grund für den Verzicht). Antwort: {tier, confidence, cost}."""
        db = self.ctx.db
        if time.monotonic() < self.paused_until:
            return None, "Jev pausiert kurz"
        if db.val("SELECT jev_auto FROM user_settings WHERE user_id=?", USER) == 0:
            return None, "Jev ist ausgeschaltet"
        if not self._budget_left():
            return None, "Das Tagesbudget für Jev ist aufgebraucht"
        key = await keychain.get("OPENROUTER_JEV_API_KEY")
        if not key:
            return None, "Der Jev-Schlüssel fehlt"
        instructions = "Wähle das kleinste Modell, das die Aufgabe gut erledigt." + (
            " Im Zweifel die kleinere Stufe: größere werden später bei Bedarf zugeschaltet." if small else "")
        body = {"model": MODEL, "state": {"text": text[:2000], "hasFiles": has_files},
                "questions": {"tier": {"type": "choice", "instructions": instructions, "criteria": CRITERIA}}}
        try:
            async with httpx.AsyncClient(timeout=3, transport=self.transport) as http:
                r = await http.post(URL, json=body, headers={"Authorization": f"Bearer {key}"})
            r.raise_for_status()
            data = r.json()
            answer = data["answers"]["tier"]
        except Exception:
            self.paused_until = time.monotonic() + PAUSE_S
            return None, "Jev ist nicht erreichbar"
        tier, conf = answer.get("choice"), answer.get("confidence")
        if tier not in CRITERIA or not isinstance(conf, (int, float)):
            return None, "Jev hat keine klare Antwort gegeben"
        cost = (data.get("usage") or {}).get("cost")
        return {"tier": tier, "confidence": float(conf), "cost": cost if isinstance(cost, (int, float)) else None}, ""

    # --- Modellwahl ---

    def _usable(self, m: dict) -> bool:
        a = self.adapters.get(m["cli"])
        return bool(a and a.available() and not self.limits.get(m["cli"])["blocked"] and self.limits.headroom(m["cli"]) >= MIN_ROOM)

    def _why_not(self, m: dict) -> str:
        name, a = CLI_NAME.get(m["cli"], m["cli"]), self.adapters.get(m["cli"])
        if not (a and a.available()):
            return f"{name} ist nicht eingerichtet"
        if self.limits.get(m["cli"])["blocked"]:
            return f"{name} ist gesperrt (Limit erreicht)"
        return f"{name} ist zu {round((1 - self.limits.headroom(m['cli'])) * 100)} % ausgelastet"

    def _pick(self, tier: str, remembered: str | None) -> tuple[dict, str, str] | None:
        """(Modell, Stufe, Satz zum Grund). Warmes Modell bleibt, solange es nicht ausscheidet."""
        if remembered and self._usable(cli.BY_ID[remembered]):
            return cli.BY_ID[remembered], tier, ""
        for t in tier_order(tier):
            names = CANDIDATES[t]
            ok = [cli.BY_ID[n] for n in names if self._usable(cli.BY_ID[n])]
            if not ok:
                continue
            chosen = ok[0]
            if self.limits.headroom(chosen["cli"]) < LOW_ROOM:
                chosen = next((m for m in ok[1:] if self.limits.headroom(m["cli"]) >= GOOD_ROOM), chosen)
            skipped = next((cli.BY_ID[n] for n in names if n != chosen["id"]), None)
            note = ""
            if t != tier:
                note = f"Für die Stufe „{TIER_DE[tier]}“ ist gerade kein Programm frei, deshalb {chosen['label']}."
            elif names[0] != chosen["id"] and skipped:
                note = f"{self._why_not(skipped)}, deshalb {chosen['label']}."
            return chosen, t, note
        return None

    def _state(self, chat: str, bot: str):
        return self.ctx.db.one("SELECT model,effort,tier,rank,last_turn_at FROM chat_model_state WHERE chat_id=? AND bot_id=?", chat, bot) if chat else None

    async def choose(self, info: dict) -> dict:
        t0, now = time.monotonic(), now_ms()
        chat, bot, text, files = info.get("chatId") or "", info.get("botId") or "", info.get("text") or "", bool(info.get("hasFiles"))
        state = self._state(chat, bot)
        warm = bool(state and now - state["last_turn_at"] < COLD_MS and state["model"] in cli.BY_ID)
        ans, why, cost = None, "", None
        if not (warm and state["rank"] >= max(RANK.values())):  # höchste Stufe warm: nichts zu entscheiden, nichts zu bezahlen
            ans, why = await self._ask(text, files, not warm)
            if ans:
                cost = ans["cost"]
            else:
                ans = {"tier": estimate(text, files), "confidence": 0.5}
        from_jev = bool(ans and "cost" in ans)
        if warm:
            up = ans and RANK[ans["tier"]] > state["rank"] and ans["confidence"] >= UPGRADE_CONFIDENCE
            change, tier = ("upgrade", ans["tier"]) if up else ("keep", state["tier"])
        else:
            tier = ans["tier"] if not from_jev or ans["confidence"] >= START_CONFIDENCE else "small"
            change = ("reset" if state else "start") if from_jev else "fallback"
        picked = self._pick(tier, state["model"] if change == "keep" else None)
        if not picked:
            raise Fail("Gerade ist kein Programm nutzbar. Prüfe unter Einrichtung die Anmeldungen.")
        model, used_tier, note = picked
        old = cli.BY_ID.get(state["model"]) if state else None
        if change == "keep" and model["id"] != state["model"]:
            change = "fallback"  # gemerktes Modell fällt aus: Cache ist ohnehin weg
        base = {"start": "Start klein: passende Stufe für die Aufgabe.", "upgrade": f"Hochgestuft von {old and old['label']} auf {model['label']}.",
                "keep": f"Bleibt bei {model['label']} (Cache warm).", "reset": f"Pause, Cache kalt – neu gewählt: {model['label']}.",
                "fallback": f"{why or 'Jev hat nicht geantwortet'}, eigene Einschätzung: Stufe {TIER_DE[tier]}."}[change]
        efforts = model["efforts"]
        want = state["effort"] if change == "keep" and state["effort"] in efforts else "medium" if "medium" in efforts else None
        effort = want or (efforts[0] if efforts else None)
        jev = {"kind": "route", "tier": used_tier, "model": model["id"], "modelLabel": model["label"], **({"effort": effort} if effort else {}),
               "reason": f"{base} {note}".strip(), **({"confidence": ans["confidence"]} if from_jev and ans else {}),
               "durationMs": int((time.monotonic() - t0) * 1000), **({"costUsd": cost} if cost is not None else {}),
               "source": "jev" if from_jev else "fallback", "change": change, **({"from": old["label"]} if change == "upgrade" and old else {})}
        self._record(chat, bot, jev, used_tier, effort, now)
        return {**model, "effort": effort, "jev": jev}

    def _record(self, chat: str, bot: str, jev: dict, tier: str, effort: str | None, now: int) -> None:
        db = self.ctx.db
        with db.tx():
            db.run("INSERT INTO jev_log (id,user_id,chat_id,kind,model,reason,duration_ms,cost_usd,payload,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                   new_id(), USER, chat or None, "route", jev["model"], jev["reason"], jev["durationMs"], jev.get("costUsd"), dumps(jev), now)
            if chat and db.val("SELECT 1 FROM chats WHERE id=?", chat):
                db.run("INSERT INTO chat_model_state (chat_id,bot_id,model,effort,tier,rank,last_turn_at,updated_at) VALUES (?,?,?,?,?,?,?,?)"
                       " ON CONFLICT (chat_id,bot_id) DO UPDATE SET model=excluded.model,effort=excluded.effort,tier=excluded.tier,rank=excluded.rank,"
                       "last_turn_at=excluded.last_turn_at,updated_at=excluded.updated_at",
                       chat, bot, jev["model"], effort, tier, RANK[tier], now, now)
