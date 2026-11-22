"""Daytona- und Jev-Schlüssel dürfen jederzeit gesetzt werden (auch ohne isoliertes Profil)."""
import asyncio

from orbitd import keychain


def test_managed_keys_put_without_isolated_profile(client):
    assert client.put("/v1/keys/DAYTONA_API_KEY", json={"key": "dtn-geheim"}).json() == {"ok": True, "set": True}
    assert asyncio.run(keychain.get("DAYTONA_API_KEY")) == "dtn-geheim"

    assert client.put("/v1/keys/OPENROUTER_JEV_API_KEY", json={"key": "or-geheim"}).json() == {"ok": True, "set": True}
    assert asyncio.run(keychain.get("OPENROUTER_JEV_API_KEY")) == "or-geheim"

    status = {k["name"]: k for k in client.get("/v1/keys").json()["keys"]}
    assert status["DAYTONA_API_KEY"]["set"] is True
    assert status["OPENROUTER_JEV_API_KEY"]["set"] is True
    text = client.get("/v1/keys").text
    assert "dtn-geheim" not in text and "or-geheim" not in text
