from types import SimpleNamespace
import asyncio
import json
from pathlib import Path

import pytest

from orbitd import keychain
from orbitd.db import dumps, now_ms

GOLDEN = Path(__file__).parent / "contract" / "golden"


def golden(name, *path):
    data = json.loads((GOLDEN / name).read_text())["body"]
    for p in path:
        data = data[p]
    return data


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setenv("ORBIT_BRAIN", "off")
    monkeypatch.setenv("ORBIT_KEYCHAIN_FAKE", "{}")


def test_settings_defaults_and_golden_keys(client):
    body = client.get("/v1/settings").json()
    assert set(body) == set(golden("get_v1_settings.json")) and set(body["settings"]) == set(golden("get_v1_settings.json", "settings"))
    assert body["settings"] == {"theme": "system", "jevAuto": True, "jevHandoff": False, "baseInstructions": None}


def test_default_effort_belongs_to_the_default_model(client):
    profile = "/v1/settings/profile"
    assert client.get(profile).json()["profile"]["defaultEffort"] is None
    assert client.put(profile, json={"defaultEffort": "high"}).status_code == 400
    assert client.put(profile, json={"defaultModel": "gpt-6-luna", "defaultEffort": "high"}).json()["ok"]
    assert client.put(profile, json={"defaultEffort": "low"}).json()["ok"]
    assert client.put(profile, json={"defaultModel": "cursor-auto", "defaultEffort": "high"}).status_code == 400
    saved = client.get(profile).json()["profile"]
    assert (saved["defaultModel"], saved["defaultEffort"]) == ("gpt-6-luna", "low")
    assert client.put(profile, json={"defaultModel": "cursor-auto"}).json()["profile"]["defaultEffort"] is None


def test_theme_jev_instructions(client, ctx):
    assert client.put("/v1/settings/theme", json={"theme": "dark"}).json() == {"ok": True}
    assert client.put("/v1/settings/jev", json={"handoff": True}).json() == {"ok": True}
    assert client.put("/v1/settings/instructions", json={"instructions": "Hallo"}).json() == {"ok": True}
    assert client.get("/v1/settings").json()["settings"] == {"theme": "dark", "jevAuto": True, "jevHandoff": True, "baseInstructions": "Hallo"}
    ctx.parts["default_instructions"] = lambda: "Standard"
    client.put("/v1/settings/instructions", json={"instructions": "Standard"})
    assert client.get("/v1/settings").json()["settings"]["baseInstructions"] is None
    client.put("/v1/settings/instructions", json={"instructions": "Hallo"})
    client.put("/v1/settings/instructions", json={"instructions": None})
    assert client.get("/v1/settings").json()["settings"]["baseInstructions"] is None


def test_settings_errors(client):
    long = "Die Anleitung darf höchstens 8.000 Zeichen lang sein."
    for url, body, err in [
        ("/v1/settings/theme", {"theme": "pink"}, "Ungültiges Design."),
        ("/v1/settings/jev", {}, "Ungültige Jev-Einstellungen."),
        ("/v1/settings/jev", {"auto": "ja"}, "Ungültige Jev-Einstellungen."),
        ("/v1/settings/instructions", {"instructions": "x" * 8001}, long),
        ("/v1/settings/instructions", {}, long),
    ]:
        r = client.put(url, json=body)
        assert (r.status_code, r.json()) == (400, {"ok": False, "error": err})


def test_default_instructions(client, ctx):
    r = client.get("/v1/settings/instructions/default").json()
    assert r["ok"] and r["limit"] == 8000 and r["text"] and set(r) == set(golden("get_v1_settings_instructions_default.json"))
    ctx.parts["default_instructions"] = lambda: "Text"
    assert client.get("/v1/settings/instructions/default").json()["text"] == "Text"


def test_rules(client, seed):
    assert client.get("/v1/settings/rules").json() == {"ok": True, "rules": []}
    assert client.post("/v1/settings/rules", json={"tool": "handoff", "mode": "allow"}).json() == {"ok": True}
    assert client.post("/v1/settings/rules", json={"tool": "handoff", "mode": "deny"}).json() == {"ok": True}  # überschreibt
    assert client.post("/v1/settings/rules", json={"tool": "handoff", "mode": "ask", "botId": seed["bot"]}).json() == {"ok": True}
    rules = client.get("/v1/settings/rules").json()["rules"]
    assert len(rules) == 2 and set(rules[0]) == set(golden("get_v1_settings_rules.json", "rules", 0))
    assert {(r["botId"], r["botName"], r["mode"]) for r in rules} == {(None, None, "deny"), ("bot1", "Nova", "ask")}
    assert client.delete(f"/v1/settings/rules/{rules[0]['id']}").json() == {"ok": True}
    assert len(client.get("/v1/settings/rules").json()["rules"]) == 1
    assert client.delete("/v1/settings/rules/gibtsnicht").json() == {"ok": True}


def test_rules_errors(client):
    bad = "Die Freigabe ist ungültig."
    for body, err in [({"tool": "", "mode": "allow"}, bad), ({"tool": "x", "mode": "egal"}, bad), ({"tool": "x", "mode": "allow", "botId": None}, bad),
                      ({"tool": "x", "mode": "allow", "botId": "fremd"}, "Dieser Orbi gehört nicht zu deinem Konto.")]:
        r = client.post("/v1/settings/rules", json=body)
        assert (r.status_code, r.json()) == (400, {"ok": False, "error": err})
    assert client.delete("/v1/settings/rules/" + "x" * 101).status_code == 400


def test_skills_crud(client):
    s = {"name": "my-skill", "description": "  desc ", "body": "code"}
    created = client.post("/v1/skills", json=s).json()
    assert created["ok"] and set(created["skill"]) == {"id", "name", "description", "body"} and created["skill"]["description"] == "desc"
    sid = created["skill"]["id"]
    r = client.post("/v1/skills", json=s)
    assert (r.status_code, r.json()["error"]) == (400, "Skill konnte nicht gespeichert werden. Name möglicherweise bereits vergeben.")
    listed = client.get("/v1/skills").json()
    assert set(listed["skills"][0]) == set(golden("get_v1_skills.json", "skills", 0)) and listed["skills"][0]["createdAt"].endswith("Z")
    assert client.put(f"/v1/skills/{sid}", json={**s, "body": "neu"}).json()["skill"] == {"id": sid, "name": "my-skill", "description": "desc", "body": "neu"}
    assert client.get("/v1/skills").json()["skills"][0]["body"] == "neu"
    assert client.delete(f"/v1/skills/{sid}").json() == {"ok": True}
    assert client.get("/v1/skills").json()["skills"] == []


def test_skills_errors(client):
    for body in [{}, {"name": "Groß", "description": "d", "body": "b"}, {"name": "a", "description": "d", "body": "b"},
                 {"name": "ok-name", "description": "d" * 301, "body": "b"}, {"name": "ok-name", "description": "d", "body": " "}]:
        r = client.post("/v1/skills", json=body)
        assert (r.status_code, r.json()) == (400, {"ok": False, "error": "Name, Beschreibung oder Inhalt ist ungültig."})
    ok = {"name": "ok-name", "description": "d", "body": "b"}
    assert client.put("/v1/skills/x", json={}).json()["error"] == "Skill-Daten sind ungültig."
    r = client.put("/v1/skills/x", json=ok)
    assert (r.status_code, r.json()) == (404, {"ok": False, "error": "Skill nicht gefunden."})
    assert client.delete("/v1/skills/x").status_code == 404


def test_slash_and_brain_skills(client, tmp_path, monkeypatch):
    client.post("/v1/skills", json={"name": "pdf-export", "description": "test", "body": "b"})
    off = client.get("/v1/skills/slash").json()
    assert off == {"ok": True, "brainOffline": True, "skills": [{"name": "pdf-export", "description": "test", "source": "orbit"}]}
    assert set(off) == set(golden("get_v1_skills_slash.json"))
    brain = tmp_path / "brain"
    for n in ("pdf-export", "brain-lesen"):
        (brain / "04 Ressourcen" / "Fähigkeiten" / n).mkdir(parents=True)
    (brain / "04 Ressourcen" / "Fähigkeiten" / "brain-lesen" / "SKILL.md").write_text("Inhalt")
    (brain / "Start.md").write_text("x")
    monkeypatch.setenv("ORBIT_BRAIN", "on")
    monkeypatch.setenv("ORBIT_BRAIN_PATH", str(brain))
    monkeypatch.delenv("ORBIT_BRAIN", raising=False)  # eigenes Brain: Abschottung aus conftest aufheben
    on = client.get("/v1/skills/slash").json()
    assert on["brainOffline"] is False
    assert [(s["name"], s["source"]) for s in on["skills"]] == [("pdf-export", "orbit"), ("brain-lesen", "brain")]
    assert client.get("/v1/skills/brain/brain-lesen").json() == {"ok": True, "body": "Inhalt"}
    for name, err in [("Ungültig", "Ungültiger Skill-Name."), ("pdf-export", "Brain-Skill konnte nicht geladen werden."),
                      ("nicht-da", "Brain-Skill konnte nicht geladen werden.")]:
        r = client.get(f"/v1/skills/brain/{name}")
        assert (r.status_code, r.json()) == (400, {"ok": False, "error": err})
    monkeypatch.setenv("ORBIT_BRAIN", "off")
    assert client.get("/v1/skills/brain/brain-lesen").status_code == 400


def test_budget(client, ctx, seed):
    b = client.get("/v1/budget").json()
    assert set(b) == set(golden("get_v1_budget.json")) and b["budget"] == {"jevDailyUsd": 0.5, "maxSandboxes": 3}
    assert set(b["jev"]) == set(golden("get_v1_budget.json", "jev")) and set(b["sandboxes"]) == {"active", "max", "waiting"}
    ctx.parts["sandbox"] = SimpleNamespace(active=lambda: ["s1", "s2"])
    assert client.get("/v1/budget").json()["sandboxes"]["active"] == 2
    t = now_ms()
    ctx.db.run("INSERT INTO jev_log (id,user_id,kind,created_at,cost_usd) VALUES ('j1','local','route',?,0.41)", t)
    ctx.db.run("INSERT INTO turn_usage (id,chat_id,bot_id,model,input_tokens,output_tokens,system_chars,tool_count,history_msgs,created_at)"
               " VALUES ('u1','chat1','bot1','m',100,20,0,0,0,?)", t)
    b = client.put("/v1/budget", json={"jevDailyUsd": 1.005, "maxSandboxes": 5.0}).json()
    assert b["budget"] == {"jevDailyUsd": 1.0, "maxSandboxes": 5}
    assert b["jev"] == {"spentUsd": 0.41, "state": "ok", "percent": 41}
    assert b["tokens"] == [{"botId": "bot1", "turns": 1, "inputTokens": 100, "outputTokens": 20, "totalTokens": 120}]
    assert set(b["tokens"][0]) == set(golden("get_v1_budget.json", "tokens", 0))
    assert client.put("/v1/budget", json={"jevDailyUsd": 0.5}).json()["jev"]["state"] == "hinweis"
    assert client.put("/v1/budget", json={"jevDailyUsd": 0}).json()["jev"] == {"spentUsd": 0.41, "state": "aus", "percent": 100}


def test_budget_errors(client):
    usd, box = "Das Tagesbudget für Jev muss zwischen 0 und 50 US-Dollar liegen.", "Die Zahl gleichzeitiger Sandboxes muss zwischen 1 und 10 liegen."
    for body, err in [({"jevDailyUsd": 51}, usd), ({"jevDailyUsd": True}, usd), ({"maxSandboxes": 2.5}, box), ({"maxSandboxes": 0}, box), ([1], "Ungültiges Tagesbudget.")]:
        r = client.put("/v1/budget", json=body)
        assert (r.status_code, r.json()) == (400, {"ok": False, "error": err})


def test_keys_never_contain_values(client, monkeypatch):
    secret = "geheim-wert-123"
    monkeypatch.setenv("ORBIT_KEYCHAIN_FAKE", json.dumps({"DAYTONA_API_KEY": secret}))
    r = client.get("/v1/keys")
    assert secret not in r.text
    body = r.json()
    assert set(body) == set(golden("get_v1_keys.json")) and set(body["keys"][0]) == set(golden("get_v1_keys.json", "keys", 0))
    assert [(k["name"], k["set"], k["source"]) for k in body["keys"]] == [("DAYTONA_API_KEY", True, "schluesselbund"), ("OPENROUTER_JEV_API_KEY", False, None)]
    monkeypatch.setenv("ORBIT_KEYCHAIN_FAKE", json.dumps({"OPENROUTER_JEV_API_KEY": secret}))
    reloaded = client.post("/v1/keys/reload", json={"names": ["OPENROUTER_JEV_API_KEY", "EGAL"]})
    assert secret not in reloaded.text and reloaded.json()["needsRestart"] == []
    assert [k["set"] for k in reloaded.json()["keys"]] == [False, True]
    assert client.post("/v1/keys/reload").json()["ok"]
    assert asyncio.run(keychain.get("OPENROUTER_JEV_API_KEY")) == secret


def test_search(client, ctx, seed):
    db = ctx.db
    for i, text in enumerate(["Das Wetter ist schön", "Äpfel und Birnen"]):
        db.run("INSERT INTO chat_messages_index (id,user_id,chat_id,role,body,created_at) VALUES (?,?,?,?,?,?)", f"chat1:m{i}", "local", "chat1", "user", text, now_ms())
    db.run("INSERT INTO chat_messages_fts(rowid, body) SELECT rowid, body FROM chat_messages_index")
    r = client.get("/v1/search", params={"q": "wetter"}).json()
    assert r["ok"] and r["indexing"] is False and len(r["results"]) == 1
    hit = r["results"][0]
    assert set(hit) == set(golden("get_v1_search_q_a.json", "results", 0))
    assert (hit["snippet"], hit["messageId"], hit["chatName"], hit["chatId"]) == ("Das <<Wetter>> ist schön", "m0", "Nova", "chat1")
    assert client.get("/v1/search", params={"q": "apfel"}).json()["results"][0]["messageId"] == "m1"  # ohne Akzent
    assert client.get("/v1/search", params={"q": "!!!"}).json()["results"] == []
    assert client.get("/v1/search", params={"q": "nichts"}).json()["results"] == []


def test_search_errors(client, ctx):
    for q, err in [("", "Gib einen Suchbegriff ein."), ("x" * 201, "Die Suche darf höchstens 200 Zeichen lang sein.")]:
        r = client.get("/v1/search", params={"q": q})
        assert (r.status_code, r.json()) == (400, {"ok": False, "error": err})
    for _ in range(30):
        assert client.get("/v1/search", params={"q": "a"}).json()["ok"]
    assert client.get("/v1/search", params={"q": "a"}).json()["error"] == "Zu viele Suchen. Bitte warte eine Minute."


def test_jev_log(client, ctx):
    assert client.get("/v1/jev").json() == {"ok": True, "entries": []}
    ctx.db.run("INSERT INTO jev_log (id,user_id,chat_id,kind,model,reason,duration_ms,payload,created_at,cost_usd) VALUES ('j1','local','c','route','m','r',5,?,1762790264998,0.1)", dumps({"tier": "medium"}))
    e = client.get("/v1/jev").json()["entries"][0]
    assert set(e) == set(golden("get_v1_jev.json", "entries", 0)) and e["payload"] == {"tier": "medium"}
    assert e["createdAt"] == "2025-11-10T15:57:44.998Z"
