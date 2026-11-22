"""Supabase-Kontobindung der Hülle: POST /v1/setup/account/supabase."""


def test_supabase_bind_and_logout(client):
    bad = client.post("/v1/setup/account/supabase", json={"id": "", "email": "a@b.de"})
    assert bad.status_code == 400 or bad.json().get("ok") is False

    ok = client.post("/v1/setup/account/supabase", json={
        "id": "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11",
        "email": "mira@example.test",
        "displayName": "Mira",
    })
    body = ok.json()
    assert body["ok"] is True and body["phase"] == "done"
    assert body["email"] == "mira@example.test"

    status = client.get("/v1/setup/account").json()
    assert status["mode"] == "supabase"
    assert status["email"] == "mira@example.test"
    assert status["phase"] == "done"

    out = client.post("/v1/setup/account/logout", json={}).json()
    assert out["ok"] is True and out["phase"] == "start"
    assert client.get("/v1/setup/account").json().get("mode") in (None, "")
