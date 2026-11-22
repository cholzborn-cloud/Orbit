import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from orbitd import automations
from orbitd.db import new_id, now_ms
from orbitd.schedule import describe, next_run, validate_schedule
from orbitd.web import Fail

GOLDEN = Path(__file__).parent / "contract" / "golden"


def ms(text: str) -> int:
    return int(datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp() * 1000)


def iso(value: int) -> str:
    return datetime.fromtimestamp(value / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# --- Zeitplan-Rechnung ---

def test_next_run_arten():
    berlin = "Europe/Berlin"
    assert iso(next_run({"kind": "daily", "at": "08:00"}, berlin, ms("2026-11-11T12:00:00Z"))) == "2026-11-12T07:00:00Z"
    assert iso(next_run({"kind": "daily", "at": "08:00"}, berlin, ms("2026-11-11T06:00:00Z"))) == "2026-11-11T07:00:00Z"
    assert iso(next_run({"kind": "daily", "at": "13:00"}, "America/New_York", ms("2026-01-01T12:30:00Z"))) == "2026-01-01T18:00:00Z"
    # Samstag 17.10.2026 -> Montag
    assert iso(next_run({"kind": "weekdays", "at": "07:30"}, berlin, ms("2026-10-17T08:00:00Z"))) == "2026-10-19T05:30:00Z"
    # weekly: 0 = Sonntag; 2026-11-11 ist Mittwoch
    assert iso(next_run({"kind": "weekly", "at": "09:00", "weekday": 1}, "UTC", ms("2026-11-11T00:00:00Z"))) == "2026-11-16T09:00:00Z"
    assert iso(next_run({"kind": "weekly", "at": "09:00", "weekday": 0}, "UTC", ms("2026-11-11T00:00:00Z"))) == "2026-11-15T09:00:00Z"
    assert iso(next_run({"kind": "monthly", "at": "09:00", "day": 5}, "UTC", ms("2026-11-11T00:00:00Z"))) == "2026-12-05T09:00:00Z"
    assert iso(next_run({"kind": "once", "at": "09:00", "date": "2026-12-24"}, berlin, ms("2026-11-11T00:00:00Z"))) == "2026-12-24T08:00:00Z"


def test_next_run_monatsende_und_vergangenheit():
    assert iso(next_run({"kind": "monthly", "at": "09:00", "day": 31}, "UTC", ms("2026-02-01T00:00:00Z"))) == "2026-02-28T09:00:00Z"
    assert iso(next_run({"kind": "monthly", "at": "09:00", "day": 31}, "UTC", ms("2026-02-28T10:00:00Z"))) == "2026-03-31T09:00:00Z"
    assert iso(next_run({"kind": "monthly", "at": "09:00", "day": 31}, "UTC", ms("2028-02-01T00:00:00Z"))) == "2028-02-29T09:00:00Z"
    assert next_run({"kind": "once", "at": "09:00", "date": "2026-01-01"}, "UTC", ms("2026-01-02T00:00:00Z")) is None
    assert next_run({"kind": "once", "at": "09:00", "date": "2026-01-01"}, "UTC", ms("2026-01-01T09:00:00Z")) is None  # strikt danach
    assert next_run({"kind": "daily", "at": "09:00"}, "Kein/Ort", 0) is None


def test_next_run_sommerzeit_berlin():
    berlin = "Europe/Berlin"
    # Umstellung auf Sommerzeit am 29.03.2026: davor +01:00, danach +02:00
    assert iso(next_run({"kind": "daily", "at": "08:00"}, berlin, ms("2026-03-28T08:00:00Z"))) == "2026-03-29T06:00:00Z"
    # 02:30 gibt es am 29.03. nicht -> nächster Tag (00:30 UTC)
    assert iso(next_run({"kind": "daily", "at": "02:30"}, berlin, ms("2026-03-29T00:00:00Z"))) == "2026-03-30T00:30:00Z"
    # Rückstellung am 25.10.2026: 02:30 gibt es zweimal, die erste (+02:00 = 00:30 UTC) zählt
    assert iso(next_run({"kind": "daily", "at": "02:30"}, berlin, ms("2026-10-24T22:00:00Z"))) == "2026-10-25T00:30:00Z"
    assert iso(next_run({"kind": "daily", "at": "08:00"}, berlin, ms("2026-10-24T12:00:00Z"))) == "2026-10-25T07:00:00Z"


def test_validate_schedule():
    assert validate_schedule({"kind": "daily", "at": "08:00", "zzz": 1}) == {"kind": "daily", "at": "08:00"}
    assert validate_schedule({"kind": "weekly", "at": "08:00", "weekday": 6})["weekday"] == 6
    for bad in (None, {}, {"kind": "hourly", "at": "08:00"}, {"kind": "daily", "at": "8:00"}, {"kind": "daily"},
                {"kind": "weekly", "at": "08:00", "weekday": 7}, {"kind": "weekly", "at": "08:00", "weekday": True},
                {"kind": "monthly", "at": "08:00", "day": 0}, {"kind": "once", "at": "08:00", "date": "2026-02-30"},
                {"kind": "once", "at": "08:00"}):
        with pytest.raises(Fail, match="Eingabe ungültig."):
            validate_schedule(bad)
    with pytest.raises(Fail, match="Uhrzeit ist ungültig."):
        validate_schedule({"kind": "daily", "at": "24:00"})
    with pytest.raises(Fail, match="Uhrzeit ist ungültig."):
        validate_schedule({"kind": "daily", "at": "12:60"})


def test_describe():
    assert describe({"kind": "daily", "at": "08:00"}, "Europe/Berlin") == "täglich um 08:00 (Europe/Berlin)"
    assert describe({"kind": "weekdays", "at": "08:00"}, "UTC") == "Mo–Fr um 08:00 (UTC)"
    assert describe({"kind": "weekly", "at": "07:30", "weekday": 1}, "UTC") == "jede Woche Montag um 07:30 (UTC)"
    assert describe({"kind": "monthly", "at": "08:00", "day": 5}, "UTC") == "monatlich am 5. um 08:00 (UTC)"
    assert describe({"kind": "once", "at": "08:00", "date": "2026-11-05"}, "UTC") == "einmalig am 2026-11-05 um 08:00 (UTC)"


# --- Routen ---

BODY = {"botId": "bot1", "name": "Mails", "prompt": "Prüfe Mails.", "schedule": {"kind": "daily", "at": "08:00"}, "timezone": "Europe/Berlin"}


def make(client, **over) -> str:
    """Routinen legt nur ein Orbi an (Werkzeug automation_create): direkt über die Speicherlogik."""
    return automations.create(client.app.state.ctx.db, {**BODY, **over})


def golden_keys(name: str):
    return json.loads((GOLDEN / name).read_text())["body"]


def test_anlegen_und_liste(client, ctx, seed):
    new = make(client)
    body = client.get("/v1/automations").json()
    g = golden_keys("get_v1_automations.json")
    assert set(body) == set(g) and body["trash"] == []
    item = body["automations"][0]
    assert set(item) == set(g["automations"][0]) and set(item["automation"]) == set(g["automations"][0]["automation"])
    assert set(item["bot"]) == {"id", "name", "avatar"}
    a = item["automation"]
    assert a["id"] == new and a["chatId"] == seed["chat"] and a["enabled"] is True and a["context"] is True
    assert a["target"] == "same" and a["notify"] == "app" and a["schedule"] == {"kind": "daily", "at": "08:00"}
    assert a["nextRunAt"].endswith("Z") and ms(a["nextRunAt"]) > now_ms()
    assert item["bot"]["name"] == "Nova"


def test_anlegen_fehler(client, seed):
    cases = [
        ({"name": "A"}, "Name muss mindestens 2 Zeichen haben."),
        ({"name": "x" * 61}, "Name darf höchstens 60 Zeichen haben."),
        ({"prompt": "  "}, "Prompt fehlt."),
        ({"prompt": "x" * 4001}, "Prompt darf höchstens 4000 Zeichen haben."),
        ({"timezone": "Mars/Olympus"}, "Zeitzone ist ungültig."),
        ({"schedule": {"kind": "daily", "at": "99:00"}}, "Uhrzeit ist ungültig."),
        ({"schedule": {"kind": "once", "at": "08:00", "date": "2020-01-01"}}, "Kein nächster Lauf gefunden."),
        ({"botId": "gibtsnicht"}, "Orbi nicht gefunden."),
        ({"chatId": "fremd"}, "Ziel-Chat gehört nicht zu diesem Orbi."),
        ({"target": "irgendwo"}, "Eingabe ungültig."),
    ]
    for over, text in cases:
        with pytest.raises(Fail) as e:
            make(client, **over)
        assert e.value.error == text, over
    assert client.get("/v1/automations").json()["automations"] == []


def test_grenze_50(client, seed):
    for i in range(50):
        make(client, name=f"Routine {i}")
    with pytest.raises(Fail, match="höchstens 50 Automationen"):
        make(client)


def test_aendern(client, seed):
    new = make(client)
    r = client.patch(f"/v1/automations/{new}", json={"name": "Neu", "prompt": "Anders.", "schedule": {"kind": "weekdays", "at": "07:00"},
                                                    "timezone": "UTC", "target": "new", "notify": "none", "context": False, "model": "m", "effort": "low"})
    assert r.json() == {"ok": True}
    a = client.get("/v1/automations").json()["automations"][0]["automation"]
    assert (a["name"], a["timezone"], a["target"], a["notify"], a["context"], a["model"], a["effort"]) == ("Neu", "UTC", "new", "none", False, "m", "low")
    r = client.patch("/v1/automations/nix", json={k: v for k, v in BODY.items() if k != "botId"})
    assert r.status_code == 404 and r.json() == {"ok": False, "error": "Automation nicht gefunden."}
    assert client.patch(f"/v1/automations/{new}", json={"name": "A"}).status_code == 400


def test_einmalig_wird_beim_aendern_wieder_aktiv(client, seed):
    new = make(client)
    client.put(f"/v1/automations/{new}/enabled", json={"enabled": False})
    client.patch(f"/v1/automations/{new}", json={**{k: v for k, v in BODY.items() if k != "botId"}, "schedule": {"kind": "once", "at": "08:00", "date": "2099-01-01"}})
    assert client.get("/v1/automations").json()["automations"][0]["automation"]["enabled"] is True


def test_ein_ausschalten(client, ctx, seed):
    new = make(client)
    ctx.db.run("UPDATE automations SET paused_reason='x' WHERE id=?", new)
    assert client.put(f"/v1/automations/{new}/enabled", json={"enabled": False}).json() == {"ok": True}
    a = client.get("/v1/automations").json()["automations"][0]["automation"]
    assert a["enabled"] is False and a["pausedReason"] is None and a["resumedAt"] is None
    client.put(f"/v1/automations/{new}/enabled", json={"enabled": True})
    a = client.get("/v1/automations").json()["automations"][0]["automation"]
    assert a["enabled"] is True and a["resumedAt"] is not None and ms(a["nextRunAt"]) > now_ms()
    assert client.put("/v1/automations/nix/enabled", json={"enabled": True}).status_code == 404


def test_papierkorb_wiederherstellen_loeschen(client, seed):
    new = make(client)
    assert client.delete(f"/v1/automations/{new}").status_code == 404  # nur aus dem Papierkorb
    assert client.post(f"/v1/automations/{new}/restore").status_code == 404
    assert client.post(f"/v1/automations/{new}/trash").json() == {"ok": True}
    body = client.get("/v1/automations").json()
    assert body["automations"] == [] and body["trash"][0]["automation"]["deletedAt"].endswith("Z")
    assert client.post(f"/v1/automations/{new}/trash").status_code == 404
    assert client.post(f"/v1/automations/{new}/restore").json() == {"ok": True}
    assert len(client.get("/v1/automations").json()["automations"]) == 1
    client.post(f"/v1/automations/{new}/trash")
    assert client.delete(f"/v1/automations/{new}").json() == {"ok": True}
    assert client.get("/v1/automations").json()["trash"] == []
    assert client.post("/v1/automations/nix/trash").status_code == 404


def test_wiederherstellen_grenze(client, ctx, seed):
    old = make(client)
    client.post(f"/v1/automations/{old}/trash")
    for i in range(50):
        make(client, name=f"Routine {i}")
    r = client.post(f"/v1/automations/{old}/restore")
    assert r.status_code == 400 and "höchstens 50" in r.json()["error"]


def add_run(ctx, automation_id, status, finished=None, started=None):
    ctx.db.run("INSERT INTO automation_runs (id,automation_id,user_id,chat_id,status,trigger,error,started_at,finished_at) VALUES (?,?,?,?,?,?,?,?,?)",
               new_id(), automation_id, "local", None, status, "schedule", None, started or now_ms(), finished)


def test_laeufe_und_ungelesen(client, ctx, seed):
    new = make(client)
    other = make(client, name="Zweite", notify="none", schedule={"kind": "daily", "at": "09:00"})
    t = now_ms()
    for i in range(22):
        add_run(ctx, new, "ok", finished=t - 1000, started=t - 10_000 - i)
    add_run(ctx, new, "running")
    add_run(ctx, new, "ok", finished=t - 2 * 86_400_000, started=t - 2 * 86_400_000)  # älter als 24 h
    add_run(ctx, other, "error", finished=t - 1000)  # notify=none zählt nicht
    r = client.get(f"/v1/automations/{new}/runs").json()
    assert r["ok"] is True and len(r["runs"]) == 20
    assert set(r["runs"][0]) == {"id", "automationId", "userId", "chatId", "status", "trigger", "error", "startedAt", "finishedAt"}
    assert r["runs"][0]["status"] == "running" and r["runs"][0]["finishedAt"] is None
    assert client.get("/v1/automations/nix/runs").status_code == 404
    unread = client.get("/v1/automations/unread").json()
    assert set(unread) == set(golden_keys("get_v1_automations_unread.json")) and unread["count"] == 22
    assert client.get(f"/v1/automations/unread?since={t}").json()["count"] == 0
    assert client.get("/v1/automations/unread?since=abc").json()["count"] == 22


class Attrappe:
    def __init__(self):
        self.calls = []

    async def run_automation(self, automation_id, trigger):
        self.calls.append((automation_id, trigger))
        return "run-1"


def test_jetzt_ausfuehren(client, ctx, seed):
    new = make(client)
    runtime = ctx.parts["runtime"] = Attrappe()
    assert client.post(f"/v1/automations/{new}/run").json() == {"ok": True, "runId": "run-1"}
    assert runtime.calls == [(new, "manual")]
    assert client.post("/v1/automations/nix/run").status_code == 404
    add_run(ctx, new, "waiting")
    r = client.post(f"/v1/automations/{new}/run")
    assert r.status_code == 400 and r.json() == {"ok": False, "error": "Ein Lauf läuft noch oder wartet auf Freigabe."}
    assert len(runtime.calls) == 1


def test_laufzeit_wirft_fail(client, ctx, seed):
    new = make(client)

    class Besetzt:
        async def run_automation(self, automation_id, trigger):
            raise Fail("Ein Lauf läuft noch oder wartet auf Freigabe.")

    ctx.parts["runtime"] = Besetzt()
    r = client.post(f"/v1/automations/{new}/run")
    assert r.status_code == 400 and r.json()["ok"] is False


# --- Vorgabe Consti 13.11.: Routinen gehören genau einem Orbi, nur Orbis legen sie an ---

def test_app_legt_keine_routine_an(client, seed):
    r = client.post("/v1/automations", json=BODY)
    assert r.status_code == 400 and r.json() == {"ok": False, "error": "Routinen legt dein Orbi an. Schreib ihm, was er regelmäßig tun soll."}
    assert client.get("/v1/automations").json()["automations"] == []


def test_aendern_wechselt_den_orbi_nicht(client, ctx, seed):
    new = make(client)
    ctx.db.run("INSERT INTO bots (id,user_id,third_party_id,name,avatar,job,is_main,created_at) VALUES ('bot2','local','bot2','Zwei','nova','x',0,0)")
    assert client.patch(f"/v1/automations/{new}", json={**BODY, "botId": "bot2"}).json() == {"ok": True}
    assert ctx.db.val("SELECT bot_id FROM automations") == "bot1"


def test_routine_ohne_orbi_bleibt_und_laeuft_nicht(client, ctx, seed):
    ctx.db.run("PRAGMA foreign_keys=OFF")  # alte Daten: Orbi fehlt
    ctx.db.run("INSERT INTO automations (id,user_id,bot_id,name,prompt,schedule,timezone,target,enabled,next_run_at,created_at) "
               "VALUES ('alt','local','weg','Alt','tu es','{\"kind\":\"daily\",\"at\":\"08:00\"}','UTC','same',1,1,1)")
    ctx.db.run("PRAGMA foreign_keys=ON")
    item = client.get("/v1/automations").json()["automations"][0]
    assert item["bot"] == {"id": "weg", "name": "Kein Orbi", "avatar": ""} and item["blocker"] == automations.NO_ORBI
    assert item["automation"]["pausedReason"] == automations.NO_ORBI
    r = client.post("/v1/automations/alt/run")
    assert r.status_code == 400 and r.json()["error"] == automations.NO_ORBI
    client.portal.call(ctx.parts["timer"].tick)
    row = ctx.db.one("SELECT next_run_at, enabled, last_run_at FROM automations WHERE id='alt'")
    assert (row["next_run_at"], row["enabled"], row["last_run_at"]) == (1, 1, None)  # unangetastet
    assert ctx.db.val("SELECT count(*) FROM automation_runs") == 0
