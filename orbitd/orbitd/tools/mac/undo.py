"""Papierkorb und Rückgängig für lokale Mac-Aktionen. Vorlage: lib/mac/trash.ts, lib/db/undo-store.ts, undoMacAction in tools.ts.

Löschen am Mac läuft immer über den Papierkorb: Dateien kommen nach ~/.Trash, nie weg. Jede umkehrbare Aktion wird mit ihrem Zustand
in undo_actions (kind "mac") gespeichert; die Werkzeug-Ergebnisse tragen die undoId (= entity_id). Ein Eintrag wird erst NACH
gelungener Umkehr entfernt (im alten Dienst ging er vorher verloren).
"""
import os
import shutil
from datetime import datetime
from pathlib import Path

from ...db import dumps, loads, new_id, now_ms
from ...web import Fail
from .jxa import JXA


def home() -> Path:
    return Path.home()


def trash_dir() -> Path:
    return home() / ".Trash"


def _move(src: str | Path, dst: str | Path) -> None:
    shutil.move(str(src), str(dst))  # rename, über Laufwerksgrenzen kopieren und dann erst das Original entfernen


def _free_name(name: str) -> Path:
    """Freier Name im Papierkorb wie im Finder: „Name 14.35.12.ext“, notfalls mit Zähler."""
    d = trash_dir()
    if not os.path.lexists(d / name):
        return d / name
    stem, ext = os.path.splitext(name)
    stamp, n = datetime.now().strftime("%H.%M.%S"), 0
    while True:
        cand = d / f"{stem} {stamp}{f' {n}' if n else ''}{ext}"
        if not os.path.lexists(cand):
            return cand
        n += 1


def move_to_trash(path: str | Path) -> dict:
    src = Path(os.path.abspath(path))
    os.lstat(src)  # wirft, wenn es die Datei nicht gibt
    d = trash_dir()
    if src == d or d in src.parents:
        raise Fail("Liegt schon im Papierkorb; endgültiges Löschen ist gesperrt.")
    d.mkdir(parents=True, exist_ok=True)
    dest = _free_name(src.name)
    _move(src, dest)
    return {"from": str(src), "to": str(dest)}


def restore_from_trash(entry: dict) -> None:
    """Zurücklegen: nur wenn am alten Ort nichts Neues liegt. Schon zurückgelegt zählt als erledigt (Wiederholung nach Teilfehler)."""
    src, dst = entry["to"], entry["from"]
    if not os.path.lexists(src):
        if os.path.lexists(dst):
            return
        raise Fail(f"Nicht mehr im Papierkorb: {os.path.basename(src)}")
    if os.path.lexists(dst):
        raise Fail(f"Am alten Ort liegt schon etwas: {dst}")
    Path(dst).parent.mkdir(parents=True, exist_ok=True)
    _move(src, dst)


def move_file(src: str | Path, dst: str | Path) -> dict:
    """Verschieben/Umbenennen, ohne etwas zu überschreiben."""
    a, b = Path(os.path.abspath(src)), Path(os.path.abspath(dst))
    os.lstat(a)
    if os.path.lexists(b):
        raise Fail(f"Ziel existiert schon: {b}")
    b.parent.mkdir(parents=True, exist_ok=True)
    _move(a, b)
    return {"from": str(a), "to": str(b)}


# ---------------------------------------------------------------- undo_actions
def record(db, action: str, detail: str, state: dict) -> str | None:
    """Speichert den Zustand; liefert die undoId oder None, wenn das Speichern scheitert (die Aktion selbst gilt trotzdem)."""
    try:
        entity = new_id()
        db.run("INSERT INTO undo_actions (id,kind,entity_id,action,detail,previous_state,created_at) VALUES (?,?,?,?,?,?,?)",
               new_id(), "mac", entity, action, detail, dumps({"action": action, **state}), now_ms())
        return entity
    except Exception:
        return None


async def _osascript(script: str, args: dict, app: str) -> None:
    from . import tools
    await tools.osascript(script, args, app=app)


async def reverse(u: dict) -> str:
    """Macht eine gespeicherte Aktion rückgängig und liefert den Satz für die Antwort."""
    a = u.get("action")
    if a == "trash":
        for m in reversed(u["moves"]):
            restore_from_trash(m)
        return f"{len(u['moves'])} Objekt(e) zurückgelegt."
    if a == "move":
        for m in reversed(u["moves"]):
            if not os.path.lexists(m["to"]) and os.path.lexists(m["from"]):
                continue  # schon zurück
            move_file(m["to"], m["from"])
        return "Verschieben rückgängig gemacht."
    if a == "write":
        if os.path.lexists(u["path"]):
            move_to_trash(u["path"])
        if u.get("previous"):
            restore_from_trash(u["previous"])
        return "Alte Fassung wiederhergestellt." if u.get("previous") else "Angelegte Datei in den Papierkorb gelegt."
    if a == "calendar_create":
        await _osascript(JXA["calendarDelete"], {"id": u["id"]}, "Calendar")
        return "Termin entfernt."
    if a == "reminder_create":
        await _osascript(JXA["reminderDelete"], {"id": u["id"]}, "Reminders")
        return "Erinnerung entfernt."
    if a == "reminder_complete":
        await _osascript(JXA["reminderComplete"], {"id": u["id"], "done": u["before"]}, "Reminders")
        return "Erinnerung zurückgesetzt."
    if a == "note_create":
        await _osascript(JXA["noteDelete"], {"id": u["id"]}, "Notes")
        return "Notiz in „Zuletzt gelöscht“ gelegt."
    raise Fail("Diese Aktion lässt sich nicht rückgängig machen.")


async def undo_mac(db, entity_id: str) -> str:
    """POST /v1/undo kind=mac: nur mit Ziel (undoId), nie „die letzte irgendeiner Art“."""
    row = db.one("SELECT id,previous_state FROM undo_actions WHERE kind='mac' AND entity_id=? ORDER BY created_at DESC, rowid DESC LIMIT 1", entity_id)
    state = loads(row["previous_state"]) if row else None
    if not isinstance(state, dict):
        raise Fail("Nichts zum Rückgängigmachen gefunden.")
    detail = await reverse(state)
    db.run("DELETE FROM undo_actions WHERE id=?", row["id"])  # erst nach gelungener Umkehr
    return detail
