import sqlite3

from orbitd.db import MIGRATIONS, open_db
from orbitd.redact import redact
from orbitd.runtime.contract import PROTOCOL_VERSION


def test_health_and_guard(client, ctx):
    health = client.get("/v1/health").json()
    assert health["ok"] is True and health["protocol"] == PROTOCOL_VERSION and "build" in health
    assert client.get("/v1/health", headers={"Authorization": "Bearer falsch"}).status_code == 401
    assert client.get("/v1/health", headers={"Host": "evil.test"}).status_code == 403
    assert client.get("/v1/health", headers={"Origin": "http://evil.test"}).status_code == 403
    r = client.get("/v1/gibt-es-nicht")
    assert (r.status_code, r.json()) == (404, {"error": "Nicht gefunden."})


def test_migration_is_additive_and_backed_up(tmp_path):
    path = tmp_path / "orbit.sqlite"
    open_db(path).close()                      # frisch: Grundschema + Migration
    con = sqlite3.connect(path)
    con.execute("PRAGMA user_version=0")       # so tun, als wäre es der alte Stand
    for t in ("inbox_items", "run_events", "activity_log", "mcp_servers", "interaction_results", "desktop_holds", "automation_events"):
        con.execute(f"DROP TABLE {t}")
    con.execute("ALTER TABLE work_runs DROP COLUMN cli_session_id")
    con.execute("ALTER TABLE work_runs DROP COLUMN inbox_item_id")
    con.execute("ALTER TABLE tasks DROP COLUMN handoff")
    for t in ("principals", "work_requests", "deliveries", "effects", "artifacts"):  # 0016 (wave 1)
        con.execute(f"DROP TABLE {t}")
    con.execute("DROP INDEX todos_item_key_idx")
    for c in ("item_key", "delivered_at"):
        con.execute(f"ALTER TABLE todos DROP COLUMN {c}")
    for i in ("work_runs_root_idx", "work_runs_parent_idx"):
        con.execute(f"DROP INDEX {i}")
    for c in ("root_run_id", "owner_bot_id", "origin_chat_id", "origin_message_id", "thread_root_id", "role", "lane", "principal_id"):
        con.execute(f"ALTER TABLE work_runs DROP COLUMN {c}")
    con.execute("INSERT INTO chats (id,user_id,kind,last_message_at,created_at) VALUES ('c','local','direct',1,1)")
    con.commit(); con.close()
    db = open_db(path)
    assert db.val("SELECT count(*) FROM chats") == 1
    assert db.val("PRAGMA user_version") == max(int(p.name[:4]) for p in MIGRATIONS.glob("[0-9]*.sql"))
    assert db.val("SELECT count(*) FROM inbox_items") == 0
    assert list(tmp_path.glob("orbit.sqlite.vor-migration-*.bak"))
    db.close()
    open_db(path).close()                      # zweiter Start: nichts mehr zu tun
    assert len(list(tmp_path.glob("*.bak"))) == 1


def test_redact():
    assert "sk-ant-abcdefghijklmnopqrstuv" not in redact("key sk-ant-abcdefghijklmnopqrstuv")
    assert "geheim12345678" not in redact('COMPOSIO_API_KEY="geheim12345678"')
    assert redact("Hallo Welt") == "Hallo Welt"


def test_messages_include_position_zero(ctx, seed):
    """Übernommene Chats beginnen bei Position 0: die erste Nachricht darf nicht fehlen."""
    from orbitd import chatstore
    ctx.db.run("INSERT INTO chat_messages (chat_id,id,role,parts,metadata,position,created_at) VALUES ('chat1','m0','user','[]',NULL,0,1)")
    assert [m["id"] for m in chatstore.messages(ctx.db, "chat1")] == ["m0"]
