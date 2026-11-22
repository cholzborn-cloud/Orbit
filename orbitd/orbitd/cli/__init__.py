"""Die vier Programme und ihr Modellkatalog. Genau vier: Claude Code, Codex, Cursor, Antigravity."""
from .acp import Agy, Cursor
from .base import Adapter, CliError, Ev, ProcessTree, Turn
from .claude import Claude
from .catalog import CURSOR_ID, codex_models, cursor_entry, supersede
from .codex import Codex

FULL = ["low", "medium", "high", "xhigh", "max"]

# id = stabile Orbit-ID (steht im Verlauf), cli = Programm, model = Name für das Programm, tier = Stufe für Auto (Jev).
MODELS = [
    {"id": "claude-haiku-5-5", "label": "Haiku 5.5", "description": "Schnell und günstig", "provider": "anthropic", "cli": "claude", "model": "claude-haiku-5-5", "efforts": FULL, "tier": "small"},
    {"id": "claude-sonnet-5-5", "label": "Sonnet 5.5", "description": "Ausgewogen für den Alltag", "provider": "anthropic", "cli": "claude", "model": "claude-sonnet-5-5", "efforts": FULL, "tier": "medium"},
    {"id": "claude-opus-5-5", "label": "Opus 5.5", "description": "Für schwere Aufgaben", "provider": "anthropic", "cli": "claude", "model": "claude-opus-5-5", "efforts": FULL, "tier": "large"},
    {"id": "gpt-6-luna", "label": "Luna 6", "description": "Schnell und günstig", "provider": "openai", "cli": "codex", "model": "gpt-6-luna", "efforts": FULL, "tier": "small"},
    {"id": "gpt-6.1-sol", "label": "Sol 6.1", "description": "Stark beim Programmieren", "provider": "openai", "cli": "codex", "model": "gpt-6.1-sol", "efforts": FULL, "tier": "large"},
    # Ein Modell, drei Denkstufen: Antigravity kennt je Stufe eine eigene Modell-ID (variants), `model` ist die Standardstufe (mittel).
    {"id": "gemini-3.8-flash", "label": "Gemini 3.8 Flash", "description": "Schnell, mit wählbarem Denken", "provider": "google", "cli": "agy", "model": "gemini-3.8-flash-medium",
     "efforts": ["low", "medium", "high"], "variants": {"low": "gemini-3.8-flash-low", "medium": "gemini-3.8-flash-medium", "high": "gemini-3.8-flash-high"}, "tier": "medium"},
    cursor_entry("auto"),
]
BY_ID = {m["id"]: m for m in MODELS}
supersede(MODELS)


def resolve(model_id: str, effort: str | None = None) -> tuple[dict | None, str | None]:
    """Eintrag zu einer Orbit-ID. Frühere Einzel-IDs (gemini-3.8-flash-low) gehören jetzt zu einem Modell mit Stufe."""
    if model_id in BY_ID:
        return BY_ID[model_id], effort
    if model_id.startswith("cursor:") and CURSOR_ID.fullmatch(model_id.removeprefix("cursor:")):
        return cursor_entry(model_id.removeprefix("cursor:")), None
    for m in MODELS:
        for stufe, vid in (m.get("variants") or {}).items():
            if vid == model_id:
                return m, effort or stufe
    return None, effort


def cli_model(model: dict, effort: str | None) -> str:
    """Name für das Programm: bei Modellen mit Stufen-IDs die der gewählten Stufe, sonst `model`."""
    return (model.get("variants") or {}).get(effort) or model["model"]


def refresh() -> None:
    """Codex-Modelle frisch aus Codex' eigenem Katalog (neueste zuerst, echte Denkstufen, Fast). Ohne Katalog bleibt die feste Liste."""
    fresh = codex_models()
    if not fresh:
        return
    rest = [m for m in MODELS if m["cli"] != "codex"]
    at = next((i for i, m in enumerate(MODELS) if m["cli"] == "codex"), len(rest))
    MODELS[:] = rest[:at] + fresh + rest[at:]
    supersede(MODELS)
    BY_ID.clear()
    BY_ID.update({m["id"]: m for m in MODELS})


def adapters(fake: str | None = None) -> dict[str, Adapter]:
    return {a.name: a for a in (Claude(fake), Codex(fake), Cursor(fake), Agy(fake))}


__all__ = ["Adapter", "CliError", "Ev", "ProcessTree", "Turn", "MODELS", "BY_ID", "adapters", "refresh", "resolve", "cli_model"]
