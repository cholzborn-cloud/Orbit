import json

from orbitd import cli
from orbitd.cli.catalog import codex_models


def level(effort):
    return {"effort": effort, "description": ""}


def eintrag(slug, priority, name, levels, visibility="list", fast=True, description="Efficient model"):
    return {"slug": slug, "display_name": name, "description": description, "priority": priority, "visibility": visibility,
            "supported_reasoning_levels": [level(e) for e in levels], "additional_speed_tiers": ["fast"] if fast else [],
            "service_tiers": [{"id": "priority", "name": "Fast", "description": "1.5x speed"}] if fast else []}


def test_codex_catalog_gives_real_levels_fast_and_order(tmp_path):
    cache = tmp_path / "models_cache.json"
    cache.write_text(json.dumps({"models": [
        eintrag("gpt-7-luna", 2, "GPT-7-Luna", ["low", "medium"], fast=False),
        eintrag("gpt-7-sol", 1, "GPT-7 Sol", ["low", "medium", "high", "ultra"]),
        eintrag("gpt-6-sol", 3, "GPT-6-Sol", ["low"], description="Previous generation model"),
        eintrag("intern", 4, "Intern", ["low"], visibility="hide"),
    ]}))
    models = codex_models(cache)
    assert [m["id"] for m in models] == ["gpt-7-sol", "gpt-7-luna", "gpt-6-sol"]  # neueste zuerst, Verstecktes fehlt
    sol, luna, alt = models
    assert sol["efforts"] == ["low", "medium", "high", "ultra"] and sol["fast"] == "priority" and sol["label"] == "GPT-7 Sol"
    assert luna["efforts"] == ["low", "medium"] and luna["fast"] is None and luna["label"] == "GPT-7 Luna"
    assert alt["legacy"] and not sol["legacy"]


def test_missing_catalog_keeps_the_fixed_list(tmp_path, monkeypatch):
    monkeypatch.setenv("CODEX_HOME", str(tmp_path))
    before = [m["id"] for m in cli.MODELS]
    cli.refresh()
    assert [m["id"] for m in cli.MODELS] == before


def test_refresh_replaces_codex_models_in_place(tmp_path, monkeypatch):
    (tmp_path / "models_cache.json").write_text(json.dumps({"models": [eintrag("gpt-7-sol", 1, "GPT-7 Sol", ["low", "max"])]}))
    monkeypatch.setenv("CODEX_HOME", str(tmp_path))
    monkeypatch.setattr(cli, "MODELS", list(cli.MODELS))
    monkeypatch.setattr(cli, "BY_ID", dict(cli.BY_ID))
    cli.refresh()
    ids = [m["id"] for m in cli.MODELS if m["cli"] == "codex"]
    assert ids == ["gpt-7-sol"] and cli.BY_ID["gpt-7-sol"]["efforts"] == ["low", "max"] and "gpt-6-luna" not in cli.BY_ID
    assert [m["cli"] for m in cli.MODELS][0] == "claude" and cli.MODELS[-1]["cli"] == "cursor"


def test_older_versions_of_the_same_family_become_legacy_by_rule():
    from orbitd.cli.catalog import supersede
    modelle = [{"id": i, "label": l, "provider": p} for i, l, p in [
        ("a", "GPT-6.2 Sol", "openai"), ("b", "GPT-6 Sol", "openai"), ("c", "GPT-5.6 Sol", "openai"),   # eine Familie: nur 6.2 bleibt
        ("d", "GPT-6.1 Terra", "openai"), ("e", "GPT-5.6 Terra", "openai"),                           # Terra: 6.1 vor 5.6
        ("f", "GPT-6.2 Astra", "openai"),                                                            # allein: bleibt
        ("g", "Sol 7", "anthropic"), ("h", "Sol 6", "google"),                                        # gleicher Name, anderer Anbieter: eigene Familie
        ("i", "Cursor Auto", "cursor"), ("j", "GPT-6.10 Sol", "openai"),                              # ohne Nummer unberührt; 6.10 ist neuer als 6.2
    ]]
    supersede(modelle)
    assert {m["id"]: m.get("legacy") for m in modelle} == {"a": True, "b": True, "c": True, "d": False, "e": True, "f": False, "g": False, "h": False, "i": None, "j": False}


def test_a_newer_release_pushes_the_previous_one_into_legacy_without_code_changes(tmp_path):
    import json
    from orbitd.cli.catalog import codex_models, supersede

    def eintrag(slug, name, prio):
        return {"slug": slug, "display_name": name, "visibility": "list", "priority": prio, "description": "", "supported_reasoning_levels": [{"effort": "low"}]}
    pfad = tmp_path / "models_cache.json"
    pfad.write_text(json.dumps({"models": [eintrag("gpt-6.2-sol", "GPT-6.2-Sol", 1), eintrag("gpt-6-sol", "GPT-6-Sol", 2)]}))
    modelle = codex_models(pfad); supersede(modelle)
    assert {m["id"]: m["legacy"] for m in modelle} == {"gpt-6.2-sol": False, "gpt-6-sol": True}
    pfad.write_text(json.dumps({"models": [eintrag("gpt-6.3-sol", "GPT-6.3-Sol", 1), eintrag("gpt-6.2-sol", "GPT-6.2-Sol", 2), eintrag("gpt-6-sol", "GPT-6-Sol", 3)]}))
    modelle = codex_models(pfad); supersede(modelle)
    assert {m["id"]: m["legacy"] for m in modelle} == {"gpt-6.3-sol": False, "gpt-6.2-sol": True, "gpt-6-sol": True}


def test_real_catalog_keeps_exactly_the_newest_per_family_current():
    from orbitd.cli.catalog import codex_models, supersede
    modelle = codex_models()  # echter Codex-Katalog, falls vorhanden (sonst leer: nichts zu prüfen); verändert die globale Liste nicht
    supersede(modelle)
    for familie in {m["label"].split()[-1] for m in modelle}:
        aktuell = [m["label"] for m in modelle if m["label"].split()[-1] == familie and not m["legacy"]]
        assert len(aktuell) <= 1, aktuell


def test_cursor_catalog_uses_the_ids_exposed_by_acp():
    import asyncio
    from pathlib import Path
    from orbitd.cli.acp import Cursor

    adapter = Cursor(str(Path(__file__).with_name("fake_cli.py")))
    models = asyncio.run(adapter.catalog())
    assert [(m["id"], m["label"]) for m in models] == [
        ("cursor-auto", "Cursor Auto"),
        ("cursor:composer-test[fast=true]", "Composer Fast"),
        ("cursor:composer-test", "Composer"),
    ]
