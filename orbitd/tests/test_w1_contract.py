"""Wave 1 shared contract: additive migration over old data, delivery dedupe, restart replay and single-use approvals."""
import sqlite3
import time
from pathlib import Path

import pytest

from orbitd import chatstore
from orbitd.db import DB, MIGRATIONS, dumps, open_db
from orbitd.runtime import contract, ledger
from orbitd.runtime.ledger import LedgerError

HEAD = max(int(p.name[:4]) for p in MIGRATIONS.glob("[0-9]*.sql"))


def _old_release(path: Path) -> None:
    """Builds a profile exactly as release 0015 left it, with an old chat that carries an attachment."""
    con = sqlite3.connect(path)
    con.executescript((MIGRATIONS / "0000_grundschema.sql").read_text())
    for name in ("0013_py_runtime.sql", "0014_task_handoff.sql", "0015_computer_events.sql"):
        con.executescript(f"BEGIN;\n{(MIGRATIONS / name).read_text()}\nPRAGMA user_version={int(name[:4])};\nCOMMIT;")
    con.close()


def _has_cols(db: DB, table: str, cols: set) -> bool:
    return cols <= {r[1] for r in db.all(f"PRAGMA table_info({table})")}


def _seed(db: DB) -> None:
    t = int(time.time() * 1000)
    cols = {r[1]: r for r in db.all("PRAGMA table_info(bots)")}
    required = [name for name, r in cols.items() if r[3] and r[4] is None and name != "id"]
    values = {"name": "Orbi", "created_at": t, "updated_at": t}
    if not db.val("SELECT 1 FROM bots WHERE id='b1'"):
        db.run(f"INSERT INTO bots (id,{','.join(required)}) VALUES ('b1',{','.join('?' * len(required))})",
               *[values.get(c, "x") for c in required])
    chat_cols = {r[1]: r for r in db.all("PRAGMA table_info(chats)")}
    creq = [n for n, r in chat_cols.items() if r[3] and r[4] is None and n != "id"]
    cvals = {"user_id": "local", "kind": "direct", "title": "Old chat", "created_at": t, "updated_at": t}
    db.run(f"INSERT INTO chats (id,{','.join(creq)}) VALUES ('c1',{','.join('?' * len(creq))})", *[cvals.get(c, "x") for c in creq])
    parts = [{"type": "text", "text": "Hier ist die alte Datei."},
             {"type": "file", "mediaType": "application/pdf", "filename": "Bericht.pdf", "url": "orbit-file://b1/f1"}]
    chatstore.add(db, "c1", "m1", "user", parts, {"note": "alt"})
    db.run("INSERT INTO bot_files (id,bot_id,filename,media_type,size,chat_id,message_id,created_at,kind,data) VALUES "
           "('f1','b1','Bericht.pdf','application/pdf',4,'c1','m1',?,'upload','JVBERg==')", t)


def test_fresh_schema_has_contract_tables(tmp_path):
    db = open_db(tmp_path / "fresh.sqlite")
    assert db.val("PRAGMA user_version") == HEAD
    for table in ("principals", "work_requests", "deliveries", "effects", "artifacts"):
        assert db.val("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", table)
    assert db.one("SELECT kind FROM principals WHERE id='local'")["kind"] == "owner"


def test_migration_keeps_old_chat_and_attachment(tmp_path):
    path = tmp_path / "old.sqlite"
    _old_release(path)
    db = DB(path)
    _seed(db)
    before = {t: db.val(f"SELECT count(*) FROM {t}") for t in ("chats", "chat_messages", "bot_files", "bots")}
    old_parts = chatstore.messages(db, "c1")[0]["parts"]
    db.close()
    db = open_db(path)  # applies 0016 with a backup first
    assert db.val("PRAGMA user_version") == HEAD
    assert list(tmp_path.glob("old.sqlite.vor-migration-*.bak")), "backup before migration"
    assert {t: db.val(f"SELECT count(*) FROM {t}") for t in before} == before
    assert chatstore.messages(db, "c1")[0]["parts"] == old_parts  # user-authored content is not rewritten
    assert db.one("SELECT data FROM bot_files WHERE id='f1'")["data"] == "JVBERg=="
    db.close()
    db = open_db(path)  # second open is a no-op
    assert db.val("PRAGMA user_version") == HEAD and not db.val("SELECT count(*) FROM deliveries")


def _delivery(key="run1:call1:0", **kw):
    return contract.Delivery(**{"client_key": key, "chat_id": "c1", "kind": "text", "parts": [{"type": "text", "text": "Done."}], **kw})


def test_delivery_is_committed_once_and_replayed_after_restart(tmp_path):
    path = tmp_path / "p.sqlite"
    db = open_db(path)
    req = ledger.accept_request(db, "c1", "m1", "b1", ["summary"])
    assert ledger.accept_request(db, "c1", "m1", "b1") == req  # replayed acceptance
    row, created = ledger.commit_delivery(db, _delivery(request_id=req, run_id="run1"))
    again, created2 = ledger.commit_delivery(db, _delivery(request_id=req, run_id="run1"))
    assert created and not created2 and again["id"] == row["id"]
    assert db.val("SELECT count(*) FROM deliveries") == 1
    db.close()
    db = open_db(path)  # "restart" before the event went out
    pending = ledger.pending_emits(db, "c1")
    assert [p["id"] for p in pending] == [row["id"]]
    assert ledger.mark_emitted(db, row["id"]) and not ledger.mark_emitted(db, row["id"])
    assert ledger.pending_emits(db, "c1") == []


def test_private_delivery_is_never_emitted(tmp_path):
    db = open_db(tmp_path / "p.sqlite")
    row, _ = ledger.commit_delivery(db, _delivery("child:report", kind="report", visibility="private", audience="parent", root_run_id="root1"))
    assert ledger.pending_emits(db) == []
    assert not ledger.mark_emitted(db, row["id"])
    assert [r["id"] for r in ledger.private_results(db, "root1")] == [row["id"]]


def test_stopped_request_refuses_late_child_writes(tmp_path):
    db = open_db(tmp_path / "p.sqlite")
    req = ledger.accept_request(db, "c1", "m1", "b1", root_run_id="root1")
    eid = ledger.open_effect(db, chat_id="c1", actor_bot_id="b1", action_class="message.send", target="mail:test@example.invalid",
                             payload={"body": "hi"}, request_id=req, root_run_id="root1")
    approved = ledger.open_effect(db, chat_id="c1", actor_bot_id="b1", action_class="message.send", target="mail:x@example.invalid",
                                  payload={"body": "hi"}, root_run_id="root1")  # child knows only the root, not the request
    v = ledger.decide(db, approved, True, 1, "local")
    queued, _ = ledger.commit_delivery(db, _delivery("before-stop", root_run_id="root1"))
    assert ledger.cancel_root(db, req) == 2
    assert ledger.effect(db, eid)["status"] == "cancelled" and ledger.effect(db, approved)["status"] == "cancelled"
    assert ledger.pending_emits(db) == [] and not ledger.mark_emitted(db, queued["id"])
    with pytest.raises(LedgerError):  # late child without request ID is still refused via its root
        ledger.commit_delivery(db, _delivery("late", root_run_id="root1"))
    with pytest.raises(LedgerError):
        ledger.open_effect(db, chat_id="c1", actor_bot_id="b1", action_class="x", target="y", payload={}, root_run_id="root1")
    with pytest.raises(LedgerError):
        ledger.claim(db, approved, v, actor_bot_id="b1", payload={"body": "hi"})
    with pytest.raises(LedgerError):
        ledger.commit_delivery(db, _delivery("ghost", request_id="no-such-request"))


def _pending(db, **kw):
    return ledger.open_effect(db, chat_id="c1", actor_bot_id="b1", action_class="message.send", target="slack:#test",
                              payload={"body": "Exact text"}, recipients=["U1"], **kw)


def test_approval_is_owner_only_actor_bound_single_use_and_payload_bound(tmp_path):
    db = open_db(tmp_path / "p.sqlite")
    db.run("INSERT INTO principals (id,kind,external_id,created_at) VALUES ('guest1','member','g1',0)")
    eid = _pending(db)
    assert not hasattr(ledger, "move")  # no public bypass of decide/claim
    with pytest.raises(LedgerError):
        ledger.decide(db, eid, True, 1, "guest1")  # a participant claiming to be the owner cannot approve
    v = ledger.decide(db, eid, True, 1, "local")
    with pytest.raises(LedgerError):
        ledger.claim(db, eid, v, actor_bot_id="b1", payload={"body": "Changed text"})  # changed content needs a new review
    with pytest.raises(LedgerError):
        ledger.claim(db, eid, v, actor_bot_id="b2", payload={"body": "Exact text"})  # another Orbi cannot use this approval
    with pytest.raises(LedgerError):
        ledger.claim(db, eid, v, actor_bot_id="b1", payload={"body": "Exact text"}, recipients=["U1", "U2"])
    v2 = ledger.claim(db, eid, v, actor_bot_id="b1", payload={"body": "Exact text"})
    with pytest.raises(LedgerError):
        ledger.claim(db, eid, v, actor_bot_id="b1", payload={"body": "Exact text"})  # repeated click: second claim fails
    v3 = ledger.record(db, eid, v2, "unknown", operation_id="op-1")
    with pytest.raises(LedgerError):
        ledger.record(db, eid, v3, "done")  # an unknown outcome needs a receipt or readback
    ledger.record(db, eid, v3, "done", receipt={"ts": "1.0"})
    assert ledger.effect(db, eid)["receipt"] == {"ts": "1.0"} and ledger.effect(db, eid)["operation_id"] == "op-1"


def test_denial_expiry_interruption_and_revision_are_distinct(tmp_path):
    db = open_db(tmp_path / "p.sqlite")
    denied = _pending(db)
    ledger.decide(db, denied, False, 1, "local")
    assert ledger.effect(db, denied)["status"] == "denied"
    expired = _pending(db, ttl_ms=-1)
    with pytest.raises(LedgerError, match="expired"):
        ledger.decide(db, expired, False, 1, "local")  # a late denial does not hide the expiry
    assert ledger.effect(db, expired)["status"] == "expired"
    open_ = _pending(db)
    approved = _pending(db)
    va = ledger.decide(db, approved, True, 1, "local")
    sent = _pending(db)
    vs = ledger.claim(db, sent, ledger.decide(db, sent, True, 1, "local"), actor_bot_id="b1", payload={"body": "Exact text"})
    with db.tx():  # recovery runs this inside its own transaction
        ledger.interrupt_open(db)  # service restart
    assert ledger.effect(db, open_)["status"] == "interrupted"
    assert ledger.effect(db, approved)["status"] == "interrupted"  # approved but unsent: asked again
    assert ledger.effect(db, sent)["status"] == "unknown"  # mid-dispatch: reconcile, never resend blindly
    with pytest.raises(LedgerError):
        ledger.claim(db, approved, va, actor_bot_id="b1", payload={"body": "Exact text"})
    row = ledger.effect(db, open_)
    v = ledger.restore(db, open_, row["version"])
    new_id = ledger.revise(db, open_, v, {"body": "Edited"})
    assert ledger.effect(db, open_)["status"] == "superseded"
    assert ledger.effect(db, new_id)["status"] == "pending" and ledger.effect(db, new_id)["version"] == 1
    with pytest.raises(LedgerError):
        ledger.revise(db, open_, v + 1, {"body": "Again"})  # superseded drafts cannot be revised twice
    with pytest.raises(RuntimeError):
        with db.tx():
            ledger.decide(db, new_id, True, 1, "local")  # guarded entry points refuse to run nested


def test_delivery_visibility_rules(tmp_path):
    db = open_db(tmp_path / "p.sqlite")
    with pytest.raises(LedgerError):
        ledger.commit_delivery(db, _delivery("r1", kind="report"))  # reports are private
    with pytest.raises(LedgerError):
        ledger.commit_delivery(db, _delivery("r2", audience="parent"))
    with pytest.raises(LedgerError):
        ledger.commit_delivery(db, _delivery("s1", kind="secret-request", audience="group"))
    assert ledger.commit_delivery(db, _delivery("s2", kind="secret-request"))[1]


def test_todo_item_keys_are_stable_per_origin(tmp_path):
    db = open_db(tmp_path / "p.sqlite")
    _seed(db)
    db.run("INSERT INTO todos (id,chat_id,bot_id,content,item_key) VALUES ('t1','c1','b1','A','step-1')")
    with pytest.raises(sqlite3.IntegrityError):
        db.run("INSERT INTO todos (id,chat_id,bot_id,content,item_key) VALUES ('t2','c1','b1','B','step-1')")


def test_protocol_matches_rust_generation():
    rust = (Path(__file__).resolve().parents[2] / "orbit-app/src-tauri/src/profile.rs").read_text()
    assert f"const SERVICE_GENERATION: u32 = {contract.PROTOCOL_VERSION};" in rust


# ---------------------------------------------------------------- vertical slice through the real service process
def _say_parts(svc, chat):
    return [p for m in svc.messages(chat) for p in m["parts"] if p["type"] == "tool-say"]


def test_slice_say_goes_through_ledger_and_replays_once_after_crash(data_dir, tmp_path):
    from test_e2e import Service
    import sqlite3 as _sq
    svc = Service(data_dir, tmp_path)
    svc.start()
    try:
        chat = svc.post("/v1/bots", {"name": "Nova", "job": "Helps", "avatar": "nepi", "color": "#3366ff", "isMain": True}).json()["chatId"]
        svc.get(f"/v1/chats/{chat}/messages")
        svc.script({"tool": {"name": "say", "arguments": {"text": "Checking that now."}}})
        svc.turn("Check something", chat=chat).wait()
        rows = svc.sql("SELECT id, status, kind, visibility FROM deliveries WHERE chat_id=? AND client_key LIKE '%:say:%'", chat)
        assert [(r["status"], r["kind"], r["visibility"]) for r in rows] == [("emitted", "text", "public")]
        assert [p["toolCallId"] for p in _say_parts(svc, chat)] == [rows[0]["id"]]
        svc.kill9()
        # Simulate a crash after commit and before display: a committed public delivery that was never shown.
        con = _sq.connect(data_dir / "orbit.sqlite")
        con.execute("INSERT INTO deliveries (id,client_key,chat_id,kind,visibility,parts,status,created_at) VALUES "
                    "('d-crash','crash:say:1',?,'text','public',?, 'committed', 1)", (chat, dumps([{"type": "text", "text": "Still working on it."}])))
        con.commit(); con.close()
        svc.script({})
        svc.start()
        crashed = [p for p in _say_parts(svc, chat) if p["toolCallId"] == "d-crash"]
        assert len(crashed) == 1 and crashed[0]["input"]["text"] == "Still working on it."
        assert svc.sql("SELECT status FROM deliveries WHERE id='d-crash'")[0]["status"] == "emitted"
        svc.stop()
        svc.start()  # a second restart shows nothing twice
        assert len(_say_parts(svc, chat)) == 2
        assert "Traceback" not in svc.out.read_text()
    finally:
        svc.stop()
