"""Gemeinsame Test-Grundlage. Tests laufen NUR gegen einen frischen Ordner unter /tmp, nie gegen echte Daten."""
import os
import shutil
import tempfile
from pathlib import Path

import pytest
from starlette.testclient import TestClient

from orbitd import config
from orbitd.app import create_app
from orbitd.db import dumps, now_ms

PORT = 4399


@pytest.fixture(autouse=True)
def _isolation(monkeypatch):
    """Jeder Test: kein echter Schlüsselbund (leere Attrappe, falls nicht anders gesetzt), kein echtes Brain."""
    if "ORBIT_KEYCHAIN_FAKE" not in os.environ:
        monkeypatch.setenv("ORBIT_KEYCHAIN_FAKE", "{}")
    monkeypatch.setenv("ORBIT_BRAIN", "off")


@pytest.fixture
def data_dir():
    path = Path(tempfile.mkdtemp(prefix="orbit-test-", dir="/tmp"))
    assert path.resolve() != config.REAL_DATA_DIR.resolve()
    yield path
    shutil.rmtree(path, ignore_errors=True)  # nur der eigene Wegwerf-Ordner


@pytest.fixture
def cfg(data_dir):
    return config.Config(data_dir=data_dir, port=PORT, fake_sandbox=True, fake_cli=str(Path(__file__).parent / "fake_cli.py"))


@pytest.fixture
def app(cfg):
    return create_app(cfg)


@pytest.fixture
def ctx(app):
    return app.state.ctx


@pytest.fixture
def client(app, ctx):
    """HTTP-Client mit gültigem Token und Host; startet auch die Hintergrundteile (lifespan)."""
    with TestClient(app, base_url=f"http://127.0.0.1:{PORT}", headers={"Authorization": f"Bearer {ctx.token}"}) as c:
        yield c


@pytest.fixture
def seed(ctx):
    """Legt einen Hauptorbi „Nova“ mit Direktchat an und liefert die IDs."""
    db, t = ctx.db, now_ms()
    with db.tx():
        db.run("INSERT INTO bots (id,user_id,third_party_id,name,avatar,color,job,instructions,is_main,sandbox_id,created_at,onboarding_done,dreamer_enabled,heartbeat_enabled,version)"
               " VALUES ('bot1','local','bot1','Nova','nepi','#3366ff','Hilft','',1,'fake-bot1',?,1,1,0,1)", t)
        db.run("INSERT INTO chats (id,user_id,kind,name,last_message_at,created_at) VALUES ('chat1','local','direct',NULL,?,?)", t, t)
        db.run("INSERT INTO chat_members (chat_id,bot_id,joined_at) VALUES ('chat1','bot1',?)", t)
    return {"bot": "bot1", "chat": "chat1"}
