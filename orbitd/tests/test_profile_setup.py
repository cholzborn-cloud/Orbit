import asyncio
import json
from dataclasses import replace
from pathlib import Path

import httpx
import pytest
from starlette.testclient import TestClient

from orbitd import config, keychain, sandbox
from orbitd.app import create_app
from orbitd.cli.base import profile_command, profile_env
from orbitd.tools.composio import Composio


def set_profile(monkeypatch, path):
    monkeypatch.setenv("ORBIT_ISOLATED_PROFILE", "1")
    monkeypatch.setenv("ORBIT_DATA_DIR", str(path))


def test_profile_reuses_project_key_only_and_filters_remote_accounts(monkeypatch, data_dir):
    monkeypatch.setenv("ORBIT_KEYCHAIN_FAKE", json.dumps({
        "COMPOSIO_API_KEY": "catalog-key",
        "COMPOSIO_USER_ID": "old-user",
        "OPENROUTER_JEV_API_KEY": "old-jev",
        "DAYTONA_API_KEY": "old-daytona",
    }))
    set_profile(monkeypatch, data_dir / "first")
    first = config.profile_id()
    expected_user = f"orbit-{first}"

    def respond(request):
        assert request.headers["x-api-key"] == "catalog-key"
        assert request.url.params.get("user_ids") == expected_user
        return httpx.Response(200, json={"items": [
            {"id":"ca_old", "user_id":"old-user", "status":"ACTIVE", "toolkit":{"slug":"gmail"}},
            {"id":"ca_new", "user_id":expected_user, "status":"ACTIVE", "toolkit":{"slug":"gmail"}},
        ]})

    async def scenario():
        assert await keychain.get("OPENROUTER_JEV_API_KEY") is None
        assert await keychain.get("DAYTONA_API_KEY") is None
        assert await keychain.get("COMPOSIO_USER_ID") is None
        await keychain.set_item(keychain.SERVICE, "DAYTONA_API_KEY", "only-first")
        assert await keychain.get("DAYTONA_API_KEY") == "only-first"
        comp = Composio(httpx.MockTransport(respond))
        assert [a["id"] for a in await comp.accounts()] == ["ca_new"]
        assert config.profile_id() == first
        set_profile(monkeypatch, data_dir / "second")
        assert config.profile_id() != first
        assert await keychain.get("DAYTONA_API_KEY") is None

    asyncio.run(scenario())


def test_setup_resumes_and_creates_idempotent_real_chat_without_remote_sandbox(monkeypatch, cfg):
    set_profile(monkeypatch, cfg.data_dir)
    app = create_app(replace(cfg, fake_sandbox=False))
    url = f"http://127.0.0.1:{cfg.port}"
    with TestClient(app, base_url=url, headers={"Authorization": f"Bearer {app.state.ctx.token}"}) as client:
        assert client.get("/v1/setup/profile").json() == {"ok": True, "required": True, "draft": {}}
        assert app.state.ctx.db.val("SELECT value FROM app_kv WHERE key='mac_local_tools'") == "off"
        assert not client.put("/v1/setup/profile", json={"step": 1, "key": "not-a-draft-field"}).json()["ok"]
        draft = {"step": 4, "name": "ü" * 41, "job": "Test", "avatar": "strobi", "color": ""}
        assert client.put("/v1/setup/profile", json=draft).json()["ok"]
        assert client.get("/v1/setup/profile").json()["draft"] == draft
        body = {"first": True, "name": "ü" * 41, "job": "Test", "avatar": "strobi", "isMain": True}
        assert not client.post("/v1/bots", json=body).json()["ok"]
        body["name"] = "Neu"
        created = client.post("/v1/bots", json=body).json()
        assert created["ok"]
        assert client.post("/v1/bots", json=body).json() == created
        assert client.get("/v1/bots").json()["main"]["sandboxConfigured"] is False
        assert app.state.ctx.db.val("SELECT sandbox_id FROM bots") is None
        finished = client.get("/v1/setup/profile").json()
        assert finished["required"] is True and finished["completedChat"] == created["chatId"]
        assert client.post("/v1/setup/profile/finish", json={}).json()["ok"]
        assert client.get("/v1/setup/profile").json() == {"ok": True, "required": False, "draft": {}}
        assert client.get(f"/v1/chats/{created['chatId']}/messages").json()["messages"] == []


def test_isolated_cli_has_private_home_without_inherited_model_keys(monkeypatch, cfg):
    set_profile(monkeypatch, cfg.data_dir)
    clean = profile_env({"PATH": "/usr/bin", "OPENAI_API_KEY": "legacy", "CODEX_HOME": "/anything"})
    assert "OPENAI_API_KEY" not in clean
    assert Path(clean["CODEX_HOME"]) == cfg.data_dir.resolve() / "cli-home" / ".codex"
    assert profile_command(["codex", "login", "status"]) == ["codex", "-c", 'cli_auth_credentials_store="file"', "login", "status"]
    rules = sandbox.profile(cfg, allow_service=True, allow_security=True, keychain=False, cli=True)
    assert 'deny process-exec (literal "/usr/bin/security")' in rules
    assert "com.apple.securityd.xpc" in rules
    assert str(config.REAL_DATA_DIR) in rules
    assert str(cfg.data_dir.resolve() / "cli-home") in rules


def test_default_rust_profile_requires_isolation_and_rejects_fake_options(monkeypatch, data_dir):
    durable = data_dir / "durable"
    monkeypatch.setattr(config, "RUST_DATA_DIR", durable)
    monkeypatch.delenv("ORBIT_KEYCHAIN_FAKE", raising=False)
    monkeypatch.setenv("ORBIT_DATA_DIR", str(durable))
    with pytest.raises(SystemExit, match="getrenntes Profil"):
        config.load()
    set_profile(monkeypatch, durable)
    assert config.load().is_real
    for option in ("ORBIT_FAKE_SANDBOX", "ORBIT_NO_SANDBOX", "ORBIT_KEYCHAIN_FAKE"):
        with monkeypatch.context() as mode:
            mode.setenv(option, "1")
            with pytest.raises(SystemExit, match="Datenkopie|temporären"):
                config.load()


def test_profile_graphite_survives_first_non_theme_setting_and_icon_round_trips(client, monkeypatch, cfg):
    set_profile(monkeypatch, cfg.data_dir)
    assert client.get("/v1/settings").json()["settings"]["theme"] == "dark"
    assert client.put("/v1/settings/instructions", json={"instructions": "Test"}).json()["ok"]
    assert client.get("/v1/settings").json()["settings"]["theme"] == "dark"
    data = {"avatar": "nova", "color": "#AABBCC", "background": "#151517"}
    assert client.put("/v1/settings/icon", json=data).json()["icon"] == data
    assert client.get("/v1/settings/icon").json()["icon"] == data
    assert client.delete("/v1/settings/icon").json()["ok"]
    assert client.get("/v1/settings/icon").json()["icon"] is None
