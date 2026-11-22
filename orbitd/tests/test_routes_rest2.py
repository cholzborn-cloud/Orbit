from orbitd.db import dumps, now_ms


def test_prompt_preview(client, ctx, seed):
    before = ctx.db.val("SELECT count(*) FROM app_kv")
    r = client.get("/v1/chats/chat1/prompt-preview")
    assert r.status_code == 200
    d = r.json()
    assert d["ok"] and "Nova" in d["layers"]["layer1Stable"] and "<orbit_context>" in d["layers"]["layer3Volatile"]
    assert {s["layer"] for s in d["sections"]} == {"stable", "tools", "volatile"}
    assert ctx.db.val("SELECT count(*) FROM app_kv") == before  # nichts gemerkt


def test_prompt_preview_fehler(client):
    r = client.get("/v1/chats/nix/prompt-preview")
    assert r.status_code == 404 and r.json() == {"ok": False, "error": "Chat nicht gefunden."}


def _props(ctx):
    items = [{"id": "p1", "name": "kurz-fassen", "description": "Fasst kurz", "body": "Sei kurz.", "reason": "oft", "createdAt": 1},
             {"id": "p2", "name": "zweiter", "description": "d", "body": "b", "reason": "", "createdAt": 2}]
    ctx.db.run("INSERT INTO app_kv (key,value,updated_at) VALUES ('skill_proposals',?,?)", dumps(items), now_ms())


def test_proposals_list_accept_reject(client, ctx):
    assert client.get("/v1/skills/proposals").json() == {"ok": True, "proposals": []}
    _props(ctx)
    assert [p["id"] for p in client.get("/v1/skills/proposals").json()["proposals"]] == ["p1", "p2"]
    a = client.post("/v1/skills/proposals/p1/accept", json={}).json()
    assert a["ok"] and a["name"] == "kurz-fassen"
    assert ctx.db.val("SELECT body FROM skills WHERE id=?", a["skillId"]) == "Sei kurz."
    assert client.post("/v1/skills/proposals/p2/reject").json() == {"ok": True, "id": "p2"}
    assert client.get("/v1/skills/proposals").json()["proposals"] == []


def test_proposals_fehler(client, ctx):
    for path in ("accept", "reject"):
        r = client.post(f"/v1/skills/proposals/nix/{path}", json={})
        assert r.status_code == 404 and r.json()["error"] == "Skill-Vorschlag nicht gefunden."
    _props(ctx)
    r = client.post("/v1/skills/proposals/p1/accept", json={"name": "Ungültig Name"})
    assert r.status_code == 400
    assert len(client.get("/v1/skills/proposals").json()["proposals"]) == 2  # bleibt liegen
