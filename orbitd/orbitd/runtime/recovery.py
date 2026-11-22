"""Wiederanlauf: einmal beim Start, VOR den Workern. Nichts startet von selbst neu; „Weiter“ macht Consti.

Was Consti geschrieben hat, bleibt: wartende Nachrichten und Antworten laufen als nächster Zug, eine mitten im Zug verlorene Antwort wird neu eingereiht.
Routinen laufen nie still nach (Karte „verpasste Routine“), Aufträge von Orbi zu Orbi enden als fehlgeschlagen und der Absender erfährt es.
"""
import logging
import os
import signal
import subprocess
from types import SimpleNamespace

from ..db import dumps, loads, now_ms

log = logging.getLogger("orbitd")


def _ps(*args) -> str:
    return subprocess.run(["ps", *args], capture_output=True, text=True, timeout=5).stdout


def proc_start(pid) -> str | None:
    """Startzeit eines Prozesses (Text von ps). Schützt davor, nach Neustart des Macs eine neu vergebene Nummer für den alten Prozess zu halten."""
    try:
        return _ps("-o", "lstart=", "-p", str(pid)).strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def note_group(db, run_id: str, pgid: int, start: str | None, add: bool = True) -> None:
    """Prozessgruppe eines Unterprozesses (Mac-Werkzeug) im Lauf merken bzw. streichen, damit der Wiederanlauf sie nach kill -9 abräumt."""
    p = loads(db.val("SELECT payload FROM work_runs WHERE id=?", run_id), {}) or {}
    p["groups"] = [g for g in p.get("groups", []) if g.get("pgid") != pgid] + ([{"pgid": pgid, "start": start}] if add else [])
    db.run("UPDATE work_runs SET payload=? WHERE id=?", dumps(p), run_id)


def reap(pgid, start=None, marker=None) -> bool:
    """Beendet die Prozessgruppe eines früheren Laufs, aber nur wenn sie sicher zu ihm gehört.
    Lebt der Anführer, muss seine Startzeit passen (alte Zeilen ohne Startzeit: `marker` in der Befehlszeile).
    Ist nur noch ein Enkel übrig, kann die Nummer nicht neu vergeben sein (sie bleibt belegt, solange die Gruppe lebt): dann wird sie beendet."""
    if not isinstance(pgid, int) or pgid <= 1 or pgid == os.getpgrp() or not (start or marker):
        return False
    try:
        rows = [ln.split(None, 2) for ln in _ps("-axo", "pid=,pgid=,command=").splitlines()]
        members = {r[0]: r[2] if len(r) > 2 else "" for r in rows if len(r) >= 2 and r[1] == str(pgid)}
        if not members:
            return False
        leader = members.get(str(pgid))
        if leader is not None and not (proc_start(pgid) == start if start else marker in leader):
            return False
        os.killpg(pgid, signal.SIGKILL)
        return True
    except (OSError, subprocess.SubprocessError):
        log.warning("Prozessgruppe %s nicht beendet", pgid)
        return False


def sweep_work(root) -> None:
    """Nach einem Absturz: Reste in den Arbeitsordnern der Programme (die Token-Datei des toten Laufs) und leere Ordner wegräumen. Anderes bleibt liegen."""
    if not root.is_dir():
        return
    for folder in root.iterdir():
        if folder.is_dir():
            for f in folder.glob(".orbit-mcp-*.json"):
                f.unlink(missing_ok=True)
            try:
                folder.rmdir()
            except OSError:
                pass
    try:
        root.rmdir()
    except OSError:
        pass


async def recover(rt) -> int:
    from ..tools import messages
    from .contract import Outcome
    ctx, db, t = rt.ctx, rt.db, now_ms()
    settled = []
    with db.tx():
        lost = db.all("SELECT id, chat_id, payload FROM work_runs WHERE status IN ('queued','running','waiting')")
        db.run("UPDATE work_runs SET status='interrupted', updated_at=? WHERE status IN ('queued','running','waiting')", t)
        from . import ledger
        ledger.interrupt_open(db)  # wave 1: open reviews survive a restart as interrupted, distinct from denial or expiry
        open_ = "status='processing' OR (kind='timer' AND status='queued')"
        stuck = [{**dict(r), "payload": loads(r["payload"], {})} for r in db.all(f"SELECT * FROM inbox_items WHERE {open_}")]
        for item in stuck:
            payload = item["payload"]
            if item["status"] != "processing" or item["kind"] not in ("message", "resume") or not isinstance(payload, dict) or not payload.get("orbi"):
                continue
            bot = db.one("SELECT * FROM bots WHERE id=?", item["bot_id"])
            if bot:
                run = SimpleNamespace(id=item["run_id"], ctx=ctx, items=[item], chat_id=item["chat_id"], bot=dict(bot), counters={})
                settled.extend(messages.settle_run(run, Outcome(status="failed", error=f"Die Arbeit von {bot['name']} wurde durch einen Neustart unterbrochen.")))
        # Eine mitten im Zug verlorene Antwort geht neu in die Reihe; wartende Nachrichten und Antworten bleiben ohnehin liegen.
        db.run(f"UPDATE inbox_items SET status=CASE WHEN kind='answer' THEN 'queued' ELSE 'cancelled' END, updated_at=? WHERE {open_}", t)
        routine_runs = {item["run_id"] for item in stuck if item["kind"] == "timer" and item["run_id"]}
        for run_id in routine_runs:
            db.run("UPDATE work_runs SET note='verworfen' WHERE id=?", run_id)  # die Karte ersetzt „Weiter“
        for row in db.all("SELECT id, request FROM pending_interactions WHERE kind != 'widget'"):  # offene Karten der abgebrochenen Routine: niemand führt sie mehr aus
            if loads(row["request"], {}).get("runId") in routine_runs:
                db.run("DELETE FROM pending_interactions WHERE id=?", row["id"])
    for r in lost:
        p = loads(r["payload"], {}) or {}
        reap(p.get("pgid"), p.get("pstart"), p.get("proc"))
        for g in p.get("groups", []):
            reap(g.get("pgid"), g.get("start"))
    for r in db.all("SELECT key, value FROM app_kv WHERE key LIKE 'oneshot:%'"):  # Einmal-Aufrufe (Zusammenfassung u. Ä.) ohne Lauf-Zeile
        g = loads(r["value"], {}) or {}
        reap(g.get("pgid"), g.get("start"), g.get("proc"))
        db.run("DELETE FROM app_kv WHERE key=?", r["key"])
    sweep_work(ctx.cfg.work_dir)  # alle alten Läufe sind beendet
    messages.publish_settled(ctx, settled)
    for item in stuck:
        p = item["payload"]
        try:
            if item["kind"] == "timer":
                await rt._automation_done(SimpleNamespace(items=[item], chat_id=item["chat_id"]),
                                          Outcome(status="failed", text="", error="Dienst wurde beendet.", extra={}))
                a = db.one("SELECT * FROM automations WHERE id=? AND deleted_at IS NULL", p.get("automationId"))
                started = db.val("SELECT started_at FROM automation_runs WHERE id=?", p.get("automationRunId"))
                if a and started:
                    from .timer import missed_card
                    missed_card(db, ctx.bus, a, started, t)
        except Exception:
            log.exception("Wiederanlauf: Eintrag %s nicht abgeschlossen", item["id"])
    try:
        replay_deliveries(ctx, db)
    except Exception:
        log.exception("Recovery: committed deliveries could not be replayed")
    return len(lost)


def replay_deliveries(ctx, db) -> int:
    """Wave 1: public deliveries committed before a crash but never shown are added to the chat exactly once."""
    import sqlite3
    from .. import chatstore
    from . import ledger
    replayed = 0
    for row in ledger.pending_emits(db):
        if row["kind"] in ("widget", "secret-request"):
            if ctx.parts["interactions"].replay_widget(row):
                replayed += 1
            continue
        shown = any(p.get("toolCallId") == row["id"] for m in chatstore.messages(db, row["chat_id"]) for p in m["parts"])
        if not shown:
            text = chatstore.text_of(row["parts"])
            part = {"type": "tool-say", "toolCallId": row["id"], "state": "output-available", "input": {"text": text},
                    "output": {"ok": True, "at": row["created_at"]}}
            bot_id = db.val("SELECT bot_id FROM work_runs WHERE id=?", row["run_id"]) if row["run_id"] else None
            parts = row["parts"] if row["kind"] == "memo" else [part]
            try:
                chatstore.add(db, row["chat_id"], row["id"], "assistant", [{"type": "step-start"}, *parts],
                              {k: v for k, v in {"botId": bot_id, "replayed": True}.items() if v is not None})
            except sqlite3.IntegrityError:
                db.run("UPDATE deliveries SET status='refused' WHERE id=? AND status='committed'", row["id"])  # chat was deleted
                continue
            replayed += 1
        if ledger.mark_emitted(db, row["id"]) and not shown:
            ctx.bus.publish({"type": "orbi-message", "chatId": row["chat_id"], "messageId": row["id"]})
    return replayed
