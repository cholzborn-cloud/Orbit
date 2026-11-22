"""Zweite Prüfer-Runde: „Weiter“ nur ohne neueren fertigen Lauf, @-Nachlauf zählt als Orbi-Nachricht."""
from types import SimpleNamespace

from orbitd.db import loads, now_ms


def run_row(ctx, id_, status, started):
    ctx.db.run("INSERT INTO work_runs (id,kind,chat_id,bot_id,status,payload,steps,started_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
               id_, "turn", "chat1", "bot1", status, "{}", 0, started, started + 1)


def test_resume_not_offered_after_newer_done_run(client, ctx, seed):
    rt, t = ctx.parts["runtime"], now_ms()
    run_row(ctx, "r1", "interrupted", t)
    assert rt.interrupted("chat1")["runId"] == "r1"
    run_row(ctx, "r2", "done", t + 10)
    assert rt.interrupted("chat1") is None
    assert rt.status()["interrupted"] == []


def test_follow_up_item_counts_as_orbi_message(client, ctx, seed):
    db, t = ctx.db, now_ms()
    db.run("INSERT INTO bots (id,user_id,third_party_id,name,avatar,color,job,instructions,is_main,sandbox_id,created_at,onboarding_done,dreamer_enabled,heartbeat_enabled,version)"
           " VALUES ('bot2','local','bot2','Luna','erdi','#112233','Hilft','',0,'fake-bot2',?,1,1,0,1)", t)
    db.run("INSERT INTO chats (id,user_id,kind,name,last_message_at,created_at) VALUES ('g1','local','group','G',?,?)", t, t)
    db.run("INSERT INTO chat_members (chat_id,bot_id,joined_at) VALUES ('g1','bot1',?),('g1','bot2',?)", t, t)
    runner = SimpleNamespace(chat_id="g1", bot={"id": "bot1", "name": "Nova"}, parts=[{"type": "text", "text": "Frag @Luna bitte."}], items=[{"payload": {"clientData": {}}}])
    ctx.parts["runtime"].wake = lambda *a: None  # kein Lauf nötig, nur der Eintrag
    ctx.parts["runtime"]._follow_up(runner, "m1")
    item = db.one("SELECT payload FROM inbox_items WHERE bot_id='bot2'")
    assert loads(item["payload"])["orbi"]["from"] == "bot1"
