"""Orbis, Gruppen, Chatliste, Reaktionen, Onboarding, Bibliothek."""
import base64
import json
from dataclasses import replace
from pathlib import Path

import pytest

from orbitd.db import dumps, now_ms

GOLDEN = Path(__file__).parent / "contract" / "golden"


def golden(name: str):
    return json.loads((GOLDEN / f"{name}.json").read_text())["body"]


def keys(obj) -> set:
    return set(obj.keys())


@pytest.fixture
def events(ctx):
    seen = []
    ctx.bus.listeners.append(seen.append)
    return seen


def bot_body(**over):
    return {"name": "Luna", "job": "Hilft", "avatar": "erdi", "color": "#112233", "instructions": "Sei nett.", "isMain": False, **over}


def add_message(ctx, chat_id, msg_id, parts, role="assistant", metadata=None, pos=None):
    db = ctx.db
    pos = pos if pos is not None else (db.val("SELECT coalesce(max(position),0)+1 FROM chat_messages WHERE chat_id=?", chat_id))
    db.run("INSERT INTO chat_messages (chat_id,id,role,parts,metadata,position,created_at) VALUES (?,?,?,?,?,?,?)",
           chat_id, msg_id, role, dumps(parts), None if metadata is None else dumps(metadata), pos, now_ms())


# --- Orbis ---

def test_list_bots_matches_golden_shape(client, seed):
    body = client.get("/v1/bots").json()
    ref = golden("get_v1_bots")
    assert keys(body) == keys(ref)
    assert keys(body["main"]) == keys(ref["bots"][0]) == keys(ref["main"] or ref["bots"][0])
    assert body["main"]["id"] == "bot1" and body["main"]["chatId"] == "chat1" and body["bots"] == [] and body["groups"] == []
    assert body["main"]["lastMessageAt"].endswith("Z") and body["main"]["look"] is None


def test_create_update_delete_bot(client, ctx, seed):
    r = client.post("/v1/bots", json=bot_body(isMain=True, look={"eyes": "round", "foo": 1}))
    assert r.status_code == 200 and keys(r.json()) == {"ok", "id", "chatId"}
    bot_id, chat_id = r.json()["id"], r.json()["chatId"]
    row = ctx.db.one("SELECT * FROM bots WHERE id=?", bot_id)
    assert row["sandbox_id"] == f"fake-{bot_id}" and row["onboarding_done"] == 0 and row["is_main"] == 1
    assert json.loads(row["look"]) == {"eyes": "round"}
    assert ctx.db.val("SELECT is_main FROM bots WHERE id='bot1'") == 0  # es gibt nur einen Hauptorbi
    assert ctx.db.val("SELECT bot_id FROM chat_members WHERE chat_id=?", chat_id) == bot_id
    listed = client.get("/v1/bots").json()
    assert listed["main"]["id"] == bot_id and listed["main"]["onboardingDone"] is False and [b["id"] for b in listed["bots"]] == ["bot1"]

    r = client.patch(f"/v1/bots/{bot_id}", json=bot_body(name="Mond", instructions="ignoriert", isMain=False, look=None))
    assert r.json() == {"ok": True, "id": bot_id}
    row = ctx.db.one("SELECT * FROM bots WHERE id=?", bot_id)
    assert (row["name"], row["instructions"], row["is_main"], row["look"]) == ("Mond", "Sei nett.", 0, None)
    client.patch(f"/v1/bots/{bot_id}", json={"name": "A", "job": "B", "avatar": "nova"})  # ohne look: unverändert
    assert client.get(f"/v1/bots/{bot_id}/library").json()["files"] == []

    r = client.delete(f"/v1/bots/{bot_id}")
    assert r.json() == {"ok": True, "id": bot_id}
    assert ctx.db.val("SELECT count(*) FROM bots WHERE id=?", bot_id) == 0
    assert ctx.db.val("SELECT count(*) FROM chats WHERE id=?", chat_id) == 0 and ctx.db.val("SELECT count(*) FROM chats") == 1


def test_bot_errors(client, seed):
    assert client.post("/v1/bots", content="[]", headers={"content-type": "application/json"}).json() == {"error": "Ungültige Anfrage."}
    r = client.post("/v1/bots", json=bot_body(name="  "))
    assert (r.status_code, r.json()) == (400, {"ok": False, "error": "Gib deinem Orbi einen Namen"})
    assert client.post("/v1/bots", json=bot_body(avatar="x")).status_code == 400
    assert client.post("/v1/bots", json=bot_body(color="rot")).status_code == 400
    assert client.post("/v1/bots", json=bot_body(instructions="a" * 1001)).status_code == 400
    r = client.patch("/v1/bots/nope", json=bot_body())
    assert (r.status_code, r.json()) == (404, {"ok": False, "error": "Orbi nicht gefunden."})
    r = client.delete("/v1/bots/nope")
    assert (r.status_code, r.json()["error"]) == (404, "Orbi nicht gefunden.")


def test_real_sandbox_calls_and_failure(client, ctx, seed):
    calls = []

    class Box:
        async def create(self, bot_id):
            calls.append(("create", bot_id))
            return "sb-1"

        async def delete(self, sandbox_id):
            calls.append(("delete", sandbox_id))
            if sandbox_id == "kaputt":
                raise RuntimeError("x")

    ctx.cfg = replace(ctx.cfg, fake_sandbox=False)  # Config ist eingefroren
    r = client.post("/v1/bots", json=bot_body())
    assert r.status_code == 400 and r.json()["error"] == "Der Computer konnte nicht angelegt werden."  # kein Sandbox-Teil
    ctx.parts["sandbox"] = Box()
    bot_id = client.post("/v1/bots", json=bot_body()).json()["id"]
    assert ctx.db.val("SELECT sandbox_id FROM bots WHERE id=?", bot_id) == "sb-1"
    ctx.db.run("UPDATE bots SET sandbox_id='kaputt' WHERE id=?", bot_id)
    r = client.delete(f"/v1/bots/{bot_id}")
    assert r.json()["error"] == "Computer konnte nicht gelöscht werden. Bitte erneut versuchen."
    assert ctx.db.val("SELECT count(*) FROM bots WHERE id=?", bot_id) == 1  # bleibt, wenn der Computer bleibt
    ctx.db.run("UPDATE bots SET sandbox_id='sb-1' WHERE id=?", bot_id)
    assert client.delete(f"/v1/bots/{bot_id}").json()["ok"] is True
    assert calls == [("create", bot_id), ("delete", "kaputt"), ("delete", "sb-1")]


def test_onboarding_skip(client, ctx, seed, events):
    ctx.db.run("UPDATE bots SET onboarding_done=0")
    assert client.post("/v1/bots/bot1/onboarding", json={"action": "skip"}).json() == {"ok": True}
    assert ctx.db.val("SELECT onboarding_done FROM bots") == 1
    assert events == [{"type": "onboarding", "botId": "bot1", "done": True, "instructions": False}]
    r = client.post("/v1/bots/bot1/onboarding", json={"action": "x"})
    assert (r.status_code, r.json()) == (400, {"error": "Ungültige Anfrage."})
    r = client.post("/v1/bots/nope/onboarding", json={"action": "skip"})
    assert (r.status_code, r.json()) == (404, {"error": "Orbi nicht gefunden."})


# --- Bibliothek ---

def test_library(client, ctx, seed):
    data = base64.b64encode(b"# Hallo").decode()
    part = {"type": "tool-share_file", "state": "output-available",
            "output": {"data": data, "size": 7, "filename": "a.md", "mediaType": "text/markdown"}}
    bad = {**part, "output": {**part["output"], "size": 99}}  # falsche Größe: wird nicht übernommen
    add_message(ctx, "chat1", "m1", [part, bad], metadata={"finishedAt": 1234})
    r = client.get("/v1/bots/bot1/library").json()
    ref = golden("get_v1_bots_yNrk4RT0f5FkpWrQWl3eP_library")
    assert keys(r) == keys(ref) and r["limitations"] == ref["limitations"] and r["truncated"] is False
    assert len(r["files"]) == 1 and keys(r["files"][0]) == keys(ref["files"][0])
    f = r["files"][0]
    assert (f["filename"], f["size"], f["createdAt"], f["kind"], f["chatId"], f["messageId"]) == ("a.md", 7, 1234, "file", "chat1", "m1")
    one = client.get(f"/v1/bots/bot1/library/{f['id']}").json()
    ref_one = golden("get_v1_bots_yNrk4RT0f5FkpWrQWl3eP_library_4b245b2654f6e94d10a74536911388813ba3af050e325db1a36240d14b7d30d4")
    assert keys(one) == keys(ref_one) and keys(one["file"]) == keys(ref_one["file"]) and one["file"]["data"] == data
    assert len(client.get("/v1/bots/bot1/library").json()["files"]) == 1  # erneutes Abrufen doppelt nichts


def test_library_errors(client, seed):
    r = client.get("/v1/bots/nope/library")
    assert (r.status_code, r.json()) == (404, {"ok": False, "error": "Orbi nicht gefunden."})
    r = client.get("/v1/bots/bot1/library/zzz")
    assert (r.status_code, r.json()) == (404, {"ok": False, "error": "Datei nicht gefunden."})


# --- Chatliste und Gruppen ---

def test_chats_and_groups(client, ctx, seed):
    r = client.get("/v1/chats").json()
    ref = golden("get_v1_chats")
    assert keys(r) == keys(ref) and keys(r["chats"][0]) == keys(ref["chats"][0])
    assert r["chats"][0]["id"] == "chat1" and r["chats"][0]["memberCount"] == 1

    r = client.post("/v1/chats", json={"name": " Team ", "botIds": ["bot1"]})
    gid = r.json()["id"]
    assert keys(r.json()) == {"ok", "id"}
    assert ctx.db.one("SELECT kind,name FROM chats WHERE id=?", gid)["name"] == "Team"
    assert {c["id"] for c in client.get("/v1/chats").json()["chats"]} == {"chat1", gid}
    groups = client.get("/v1/bots").json()["groups"]
    assert groups[0]["id"] == gid and keys(groups[0]["members"][0]) == {"id", "name", "avatar", "color", "look"}

    second = client.post("/v1/bots", json=bot_body()).json()["id"]
    assert client.patch(f"/v1/chats/{gid}", json={"name": "Neu", "botIds": ["bot1", second]}).json() == {"ok": True}
    assert ctx.db.val("SELECT count(*) FROM chat_members WHERE chat_id=?", gid) == 2

    assert client.delete(f"/v1/chats/{gid}").json() == {"ok": True}
    assert ctx.db.val("SELECT count(*) FROM bots") == 2 and ctx.db.val("SELECT count(*) FROM chat_members WHERE chat_id=?", gid) == 0


def test_group_errors(client, seed):
    assert client.post("/v1/chats", json={"name": "", "botIds": ["bot1"]}).json() == {"ok": False, "error": "Gib der Gruppe einen Namen"}
    assert client.post("/v1/chats", json={"name": "A", "botIds": []}).json()["error"] == "Wähle mindestens einen Orbi"
    assert client.post("/v1/chats", json={"name": "A", "botIds": [f"b{i}" for i in range(7)]}).json()["error"] == "Höchstens 6 Orbis je Gruppe"
    assert client.post("/v1/chats", json={"name": "A", "botIds": ["fremd"]}).json()["error"] == "Unbekannter Orbi."
    assert client.post("/v1/chats", content="[]", headers={"content-type": "application/json"}).json() == {"error": "Ungültige Anfrage."}
    r = client.patch("/v1/chats/chat1", json={"name": "A", "botIds": ["bot1"]})  # Direktchat ist keine Gruppe
    assert (r.status_code, r.json()) == (404, {"ok": False, "error": "Gruppe nicht gefunden."})
    assert client.delete("/v1/chats/nope").status_code == 404


# --- Reaktionen und gesehen ---

def test_reactions(client, ctx, seed, events):
    add_message(ctx, "chat1", "m1", [{"type": "text", "text": "Hi"}])
    assert client.get("/v1/chats/chat1/reactions").json() == {"reactions": []}
    r = client.put("/v1/chats/chat1/messages/m1~t1/reaction", json={"emoji": "👍"})
    assert r.json() == {"ok": True, "answered": False}
    client.put("/v1/chats/chat1/messages/m1~t1/reaction", json={"emoji": "❤️"})  # ersetzt die alte
    got = client.get("/v1/chats/chat1/reactions").json()
    ref = golden("get_v1_chats_xxGeMqFxiSxdXgpMZFijW_reactions")
    assert keys(got) == keys(ref) and len(got["reactions"]) == 1 and keys(got["reactions"][0]) == keys(ref["reactions"][0])
    assert (got["reactions"][0]["emoji"], got["reactions"][0]["actor"], got["reactions"][0]["messageId"]) == ("❤️", "user", "m1~t1")
    assert events[-1] == {"type": "reaction", "chatId": "chat1", "messageId": "m1~t1", "actor": "user", "emoji": "❤️"}

    assert client.delete("/v1/chats/chat1/messages/m1~t1/reaction").json() == {"ok": True, "removed": True}
    assert events[-1]["emoji"] is None
    n = len(events)
    assert client.delete("/v1/chats/chat1/messages/m1~t1/reaction").json() == {"ok": True, "removed": False}
    assert len(events) == n  # nichts entfernt, kein Ereignis


def test_reaction_errors_and_live_message(client, ctx, seed):
    r = client.put("/v1/chats/chat1/messages/m1/reaction", json={"emoji": "invalid"})
    assert (r.status_code, r.json()) == (400, {"error": "Ungültige Reaktion."})
    r = client.put("/v1/chats/chat1/messages/fehlt/reaction", json={"emoji": "👍"})
    assert (r.status_code, r.json()) == (404, {"error": "Nachricht nicht gefunden."})
    r = client.put("/v1/chats/nope/messages/m1/reaction", json={"emoji": "👍"})
    assert (r.status_code, r.json()) == (404, {"error": "Chat nicht gefunden."})
    assert client.get("/v1/chats/nope/reactions").json() == {"error": "Chat nicht gefunden."}
    assert client.delete("/v1/chats/nope/messages/m1/reaction").status_code == 404
    ctx.parts["live_message_id"] = lambda chat_id: "laeuft"  # laufende Antwort steht noch nicht in der Datenbank
    assert client.put("/v1/chats/chat1/messages/laeuft~t0/reaction", json={"emoji": "😀"}).json()["ok"] is True


def test_seen(client, ctx, seed):
    assert client.post("/v1/chats/chat1/seen").json() == {"ok": True}
    assert ctx.db.val("SELECT seen_at FROM chat_seen WHERE chat_id='chat1'") > 0
    r = client.post("/v1/chats/nope/seen")
    assert (r.status_code, r.json()) == (404, {"ok": False, "error": "Chat nicht gefunden."})
