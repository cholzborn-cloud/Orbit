"""Der Codex-Katalog kommt von Codex selbst: models_cache.json (Codex holt ihn bei OpenAI). Er nennt je Modell die Reihenfolge (neueste zuerst),
die echten Denkstufen und ob es einen Fast-Dienst gibt (service_tiers: id „priority“, Name „Fast“)."""
import json
import os
import re
from pathlib import Path

CURSOR_ID = re.compile(r"[A-Za-z0-9][A-Za-z0-9_.+:/@-]*(?:\[[A-Za-z0-9_.+:/@,= -]*\])?")
def cursor_entry(model: str, label: str | None = None) -> dict:
    automatic = model in ("auto", "default", "default[]")
    return {"id": "cursor-auto" if automatic else f"cursor:{model}",
            "label": "Cursor Auto" if automatic else label or model,
            "description": "Cursor wählt selbst" if automatic else model,
            "provider": "cursor", "cli": "cursor", "model": "auto" if automatic else model,
            "efforts": [], "tier": "medium"}


TIER = {"luna": "small", "terra": "medium", "sol": "large", "astra": "large"}
BESCHREIBUNG = {"small": "Schnell und günstig", "medium": "Ausgewogen für den Alltag", "large": "Für schwere Aufgaben"}


def cache_path() -> Path:
    return Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex") / "models_cache.json"


def codex_models(path: Path | None = None) -> list[dict]:
    """Sichtbare Codex-Modelle, neueste zuerst. Leer, wenn es keinen lesbaren Katalog gibt."""
    try:
        raw = json.loads((path or cache_path()).read_text())["models"]
    except (OSError, ValueError, KeyError, TypeError):
        return []
    models = []
    for m in sorted((m for m in raw if isinstance(m, dict) and m.get("visibility") == "list" and m.get("slug")), key=lambda m: m.get("priority", 99)):
        slug = str(m["slug"])
        levels = [l.get("effort") for l in m.get("supported_reasoning_levels") or [] if isinstance(l, dict)]
        fast = next((t.get("id") for t in m.get("service_tiers") or [] if isinstance(t, dict) and t.get("name") == "Fast"), None) if "fast" in (m.get("additional_speed_tiers") or []) else None
        tier = TIER.get(slug.rsplit("-", 1)[-1], "medium")
        models.append({"id": slug, "label": re.sub(r"^GPT-([\d.]+)-", r"GPT-\1 ", str(m.get("display_name") or slug)), "description": BESCHREIBUNG[tier],
                       "provider": "openai", "cli": "codex", "model": slug, "efforts": [e for e in levels if isinstance(e, str)], "fast": fast,
                       "legacy": str(m.get("description") or "").startswith("Previous generation"), "tier": tier})
    return models


_ZAHL = re.compile(r"\d+(?:\.\d+)*")


def supersede(models: list[dict]) -> None:
    """Ältere Modelle ausblenden, regelbasiert: Gleicher Anbieter und gleicher Name ohne Versionsnummer (GPT-6.2 Sol, GPT-6 Sol → „gpt sol“) ist eine Familie.
    Nur die höchste Versionsnummer bleibt aktuell, die übrigen bekommen `legacy`. Modelle ohne Nummer bleiben unberührt. Schon als alt markierte bleiben alt."""
    familien: dict[tuple[str, str], list[tuple[tuple[int, ...], dict]]] = {}
    for m in models:
        nummer = _ZAHL.search(str(m["label"]))
        if nummer:
            familie = " ".join(re.sub(r"[^a-z0-9]+", " ", _ZAHL.sub("", str(m["label"])).lower()).split())
            familien.setdefault((m["provider"], familie), []).append((tuple(int(t) for t in nummer.group().split(".")), m))
    for gruppe in familien.values():
        neueste = max(v for v, _ in gruppe)
        for version, m in gruppe:
            m["legacy"] = bool(m.get("legacy")) or version < neueste
