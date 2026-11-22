"""Orbis (Bots): Liste, Anlegen, Ändern, Löschen, Onboarding überspringen, Bibliothek.

Vorlage: actions/bot.ts, query/bot.ts, service/src/library.ts, service/src/chat/reaction-routes.ts (Onboarding).
"""
import asyncio
import base64
import hashlib
import math
import re
from datetime import datetime, timezone

from ..config import isolated_dir
from ..db import dumps, loads, new_id, now_ms
from ..web import Fail, HttpError, Req, route

# Figuren der alten Web-Oberfläche (Planeten) und der Mac-App; der Dienst nimmt beide an.
AVATARS = {
    "erdi", "marsi", "sati", "jupi", "mondi", "veni", "nepi", "urani", "pluti", "universi",
    "strobi", "freddy", "citrus", "nova", "grokbot", "sunee", "kirby", "cloudee",
    "cubee", "onee", "rauti", "trixi", "tropi", "mopsi", "dosi",
}
COLOR = re.compile(r"^#[0-9a-fA-F]{6}$")
LOOK_ENUMS = {"eyes": {"round", "square", "triangle"}, "accessory": {"none", "cap", "glasses", "sunglasses", "headphones"}}
LOOK_RANGES = {"gaze": (0, 1), "reaction": (0.04, 0.4)}
SANDBOX_CREATE = "Der Computer konnte nicht angelegt werden."
SANDBOX_DELETE = "Computer konnte nicht gelöscht werden. Bitte erneut versuchen."


def iso(ms: int) -> str:
    """Zeit wie der alte Dienst sie ausgibt: ISO-8601 mit Millisekunden und Z."""
    return datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _number(v) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _look(value) -> dict | None:
    """Prüft die Figur-Anpassung; unbekannte Felder fallen weg (wie zod)."""
    if value is None:
        return None
    if not isinstance(value, dict):
        raise Fail("Ungültige Eingabe.")
    out = {}
    for key, v in value.items():
        if key in LOOK_ENUMS and v in LOOK_ENUMS[key] and isinstance(v, str):
            out[key] = v
        elif key == "cheeks" and isinstance(v, bool):
            out[key] = v
        elif key in LOOK_RANGES and _number(v) and LOOK_RANGES[key][0] <= v <= LOOK_RANGES[key][1]:
            out[key] = v
        elif key in LOOK_ENUMS or key in LOOK_RANGES or key == "cheeks":
            raise Fail("Ungültige Eingabe.")
    return out


def _form(body) -> dict:
    """Die Felder des Orbi-Dialogs. Nur die gesetzten Felder kommen im Ergebnis vor."""
    if not isinstance(body, dict):
        raise HttpError(400, "Ungültige Anfrage.")
    name, job = body.get("name"), body.get("job")
    if not isinstance(name, str) or not name.strip():
        raise Fail("Gib deinem Orbi einen Namen")
    if not isinstance(job, str) or not job.strip():
        raise Fail("Gib deinem Orbi eine Aufgabe")
    if len(name.strip()) > 40 or len(job.strip()) > 60:
        raise Fail("Name höchstens 40, Aufgabe höchstens 60 Zeichen.")
    if body.get("avatar") not in AVATARS:
        raise Fail("Ungültige Eingabe.")
    form = {"name": name.strip(), "job": job.strip(), "avatar": body["avatar"]}
    if "color" in body:
        if body["color"] is not None and not (isinstance(body["color"], str) and COLOR.match(body["color"])):
            raise Fail("Ungültige Eingabe.")
        form["color"] = body["color"]
    if "isMain" in body:
        if not isinstance(body["isMain"], bool):
            raise Fail("Ungültige Eingabe.")
        form["is_main"] = body["isMain"]
    if "instructions" in body:
        if not isinstance(body["instructions"], str) or len(body["instructions"].strip()) > 1000:
            raise Fail("Anweisungen: höchstens 1000 Zeichen.")
        form["instructions"] = body["instructions"].strip() or None
    if "look" in body:
        form["look"] = _look(body["look"])
    return form


def _bot_json(b, chat_id: str, last: int) -> dict:
    result = {"chatId": chat_id, "id": b["id"], "name": b["name"], "avatar": b["avatar"], "color": b["color"], "job": b["job"],
              "instructions": b["instructions"], "isMain": bool(b["is_main"]), "onboardingDone": bool(b["onboarding_done"]),
              "look": loads(b["look"]), "lastMessageAt": iso(last)}
    if isolated_dir() is not None:
        result["sandboxConfigured"] = bool(b["sandbox_id"]) and not b["sandbox_id"].startswith("fake-")
    return result


@route("GET", "/v1/bots")
async def list_bots(req: Req):
    db = req.ctx.db
    chats = db.all("SELECT id, kind, name, last_message_at FROM chats WHERE user_id='local' ORDER BY last_message_at DESC")
    members: dict[str, list] = {}
    for m in db.all("SELECT cm.chat_id, b.* FROM chat_members cm JOIN bots b ON b.id=cm.bot_id ORDER BY cm.joined_at, cm.rowid"):
        members.setdefault(m["chat_id"], []).append(m)
    seen, direct, groups = set(), [], []
    for c in chats:
        ms = members.get(c["id"], [])
        if c["kind"] == "direct" and ms and ms[0]["id"] not in seen:  # ein Orbi erscheint nur mit dem neuesten Direktchat
            seen.add(ms[0]["id"])
            direct.append(_bot_json(ms[0], c["id"], c["last_message_at"]))
        elif c["kind"] == "group":
            groups.append({"id": c["id"], "name": c["name"] or "Gruppe", "members": [
                {"id": b["id"], "name": b["name"], "avatar": b["avatar"], "color": b["color"], "look": loads(b["look"])} for b in ms]})
    return {"ok": True, "groups": groups, "main": next((b for b in direct if b["isMain"]), None),
            "bots": [b for b in direct if not b["isMain"]]}


def _clear_main(db):
    db.run("UPDATE bots SET is_main=0 WHERE user_id='local' AND is_main=1")


@route("POST", "/v1/bots")
async def create_bot(req: Req):
    form = _form(req.body)
    ctx, db = req.ctx, req.ctx.db
    bot_id, chat_id, t = new_id(), new_id(), now_ms()
    first = isinstance(req.body, dict) and req.body.get("first") is True and isolated_dir() is not None
    if first:
        existing = db.one("SELECT b.id, mc.chat_id FROM bots b JOIN chat_members mc ON mc.bot_id=b.id "
                          "JOIN chats c ON c.id=mc.chat_id WHERE b.user_id='local' AND b.archived_at IS NULL "
                          "AND c.kind='direct' ORDER BY b.is_main DESC, c.last_message_at DESC LIMIT 1")
        if existing:
            return {"ok": True, "id": existing["id"], "chatId": existing["chat_id"]}
    sandbox = ctx.parts.get("sandbox")
    from .settings import profile_preferences
    if ctx.cfg.fake_sandbox or not profile_preferences(db).get("cloud", True):
        sandbox_id = f"fake-{bot_id}"
    elif isolated_dir():
        sandbox_id = None
    else:
        try:
            sandbox_id = await sandbox.create(bot_id)
        except Exception:  # auch „kein Sandbox-Teil“ (None.create)
            raise Fail(SANDBOX_CREATE)
    try:
        with db.tx():
            if form.get("is_main"):
                _clear_main(db)
            db.run("INSERT INTO bots (id,user_id,third_party_id,name,avatar,color,job,instructions,is_main,sandbox_id,created_at,look,onboarding_done)"
                   " VALUES (?,'local',?,?,?,?,?,?,?,?,?,?,0)", bot_id, bot_id, form["name"], form["avatar"], form.get("color"), form["job"],
                   form.get("instructions"), int(form.get("is_main", False)), sandbox_id, t,
                   None if form.get("look") is None else dumps(form["look"]))
            db.run("INSERT INTO chats (id,user_id,kind,last_message_at,created_at) VALUES (?,'local','direct',?,?)", chat_id, t, t)
            db.run("INSERT INTO chat_members (chat_id,bot_id,joined_at) VALUES (?,?,?)", chat_id, bot_id, t)
            if first:
                db.run("INSERT OR REPLACE INTO app_kv (key,value,updated_at) VALUES ('first_start_chat',?,?)", chat_id, t)
    except Exception:
        if sandbox_id and not ctx.cfg.fake_sandbox:
            try:
                await sandbox.delete(sandbox_id)  # keine verwaiste Sandbox zurücklassen
            except Exception:
                pass
        raise Fail("Orbi konnte nicht gespeichert werden.")
    return {"ok": True, "id": bot_id, "chatId": chat_id}


@route("POST", "/v1/bots/{id}/sandbox")
@route("POST", "/v1/bots/{id}/sandbox/setup")
async def provision_sandbox(req: Req):
    if req.obj().get("confirmed") is not True:
        raise Fail("Bestätige zuerst die Einrichtung des Computers.")
    return await _connect_sandbox(req, create=True)


@route("POST", "/v1/bots/{id}/sandbox/reconnect")
async def reconnect_sandbox(req: Req):
    return await _connect_sandbox(req, create=False)


async def _connect_sandbox(req: Req, *, create: bool):
    from ..tools import daytona
    from .settings import profile_preferences
    ctx, bot_id = req.ctx, req.params["id"]
    if not profile_preferences(ctx.db).get("cloud", True):
        raise Fail(daytona.CLOUD_OFF)
    if ctx.cfg.fake_sandbox:
        raise Fail("Im Testmodus wird kein Computer angelegt.")
    lock = ctx.parts.setdefault("sandbox_provision_lock", asyncio.Lock())
    async with lock:
        row = ctx.db.one("SELECT sandbox_id FROM bots WHERE id=? AND user_id='local' AND archived_at IS NULL", bot_id)
        if not row:
            raise Fail("Orbi nicht gefunden.")
        if not daytona.is_fake(row["sandbox_id"]):
            return {"ok": True, "sandboxConfigured": True}
        sandbox = daytona.get(ctx)
        external = await sandbox.existing_for_bot(bot_id)
        if external is not None and ctx.db.val("SELECT 1 FROM bots WHERE sandbox_id=? AND id<>?", external, bot_id):
            raise Fail("Dieser Computer ist bereits einem anderen Orbi zugeordnet.")
        if external is None and not create:
            return {"ok": True, "sandboxConfigured": False}
        created = external is None
        if created:
            external = await sandbox.create(bot_id)
        if not ctx.db.run("UPDATE bots SET sandbox_id=? WHERE id=? AND user_id='local' AND archived_at IS NULL", external, bot_id):
            if created:
                await sandbox.delete(external)
            raise Fail("Orbi wurde während der Einrichtung entfernt.")
    return {"ok": True, "sandboxConfigured": True}


@route("PATCH", "/v1/bots/{id}")
async def update_bot(req: Req):
    form = _form(req.body)
    form.pop("instructions", None)  # die alte Anweisung bleibt beim Bearbeiten unverändert
    db, bot_id = req.ctx.db, req.params["id"]
    with db.tx():
        if not db.val("SELECT 1 FROM bots WHERE id=? AND user_id='local'", bot_id):
            raise Fail("Orbi nicht gefunden.")
        if form.get("is_main"):
            _clear_main(db)
        if "look" in form:
            form["look"] = None if form["look"] is None else dumps(form["look"])
        if "is_main" in form:
            form["is_main"] = int(form["is_main"])
        db.run(f"UPDATE bots SET {', '.join(k + '=?' for k in form)} WHERE id=?", *form.values(), bot_id)  # Schlüssel stammen aus _form
    return {"ok": True, "id": bot_id}


@route("DELETE", "/v1/bots/{id}")
async def delete_bot(req: Req):
    ctx, db, bot_id = req.ctx, req.ctx.db, req.params["id"]
    bot = db.one("SELECT sandbox_id FROM bots WHERE id=? AND user_id='local'", bot_id)
    if not bot:
        raise Fail("Orbi nicht gefunden.")
    if bot["sandbox_id"] and not ctx.cfg.fake_sandbox:
        sandbox = ctx.parts.get("sandbox")
        try:
            await sandbox.delete(bot["sandbox_id"])
        except Exception:
            raise Fail(SANDBOX_DELETE)
    # Direktchats des Orbis gehen mit; Gruppenmitgliedschaften, Dateien, Gedächtnis fallen per Cascade weg.
    with db.tx():
        db.run("DELETE FROM chats WHERE user_id='local' AND kind='direct' AND id IN (SELECT chat_id FROM chat_members WHERE bot_id=?)", bot_id)
        db.run("DELETE FROM inbox_items WHERE bot_id=?", bot_id)  # ohne Fremdschlüssel: sonst blieben Aufträge für einen Geist liegen
        db.run("DELETE FROM orbi_work WHERE bot_id=?", bot_id)
        db.run("DELETE FROM bots WHERE id=? AND user_id='local'", bot_id)
    return {"ok": True, "id": bot_id}


@route("POST", "/v1/bots/{id}/onboarding")
async def skip_onboarding(req: Req):
    if req.obj().get("action") != "skip":
        raise HttpError(400, "Ungültige Anfrage.")
    bot_id = req.params["id"]
    if not req.ctx.db.run("UPDATE bots SET onboarding_done=1 WHERE id=? AND user_id='local'", bot_id):
        raise HttpError(404, "Orbi nicht gefunden.")
    req.ctx.bus.publish({"type": "onboarding", "botId": bot_id, "done": True, "instructions": False})


# --- Bibliothek: vom Orbi bereitgestellte Dateien und Bilder, aus dem Verlauf in bot_files nachgetragen ---

MAX_FILE = 5 * 1024 * 1024
MAX_MESSAGE = 32 * 1024 * 1024
MAX_DEPTH, MAX_PARTS = 8, 1000
LIMITATIONS = [
    "Die Bibliothek enthält vom Orbi ausdrücklich bereitgestellte Dateien und gespeicherte Bildgenerierungen. Bereitgestellt bedeutet nicht zwingend selbst erstellt.",
    "Nutzeranhänge und nur erwähnte oder gefundene Dateien werden nicht automatisch übernommen. Geteilte Dateien bleiben auch nach dem Leeren des Chats gespeichert.",
]
HISTORY = f"""
SELECT m.rowid AS cur, m.chat_id AS chat_id, m.id AS message_id, c.kind AS kind,
  (SELECT count(*) FROM chat_members cm WHERE cm.chat_id=c.id) AS members,
  (SELECT bot_id FROM chat_members cm WHERE cm.chat_id=c.id LIMIT 1) AS sole_bot,
  CASE WHEN length(cast(m.parts AS blob)) <= {MAX_MESSAGE} THEN m.parts ELSE NULL END AS parts,
  CASE WHEN m.metadata IS NULL OR length(m.metadata) <= 16384 THEN m.metadata ELSE '{{"botId":null}}' END AS metadata,
  m.created_at AS created_at
FROM chat_messages m JOIN chats c ON c.id=m.chat_id
WHERE m.rowid > ? AND c.user_id='local' AND m.role='assistant'
  AND (instr(m.parts,'"tool-share_file"')>0 OR instr(m.parts,'"tool-generate_image"')>0 OR instr(m.parts,'"tool-create_pdf"')>0
    OR instr(m.parts,'"tool-create_word"')>0 OR instr(m.parts,'"tool-handoff"')>0)
ORDER BY m.rowid LIMIT 1"""
MEDIA_TYPE = re.compile(r"^[a-zA-Z0-9!#$&^_.+-]+/[a-zA-Z0-9!#$&^_.+-]+$")
B64 = re.compile(r"^[A-Za-z0-9+/]*={0,2}$")


def _obj(v) -> dict:
    return v if isinstance(v, dict) else {}


def _bytes(value):
    """Base64 streng prüfen (nur kanonisch, höchstens 5 MiB); sonst None."""
    if not isinstance(value, str) or len(value) > 4 * math.ceil(MAX_FILE / 3) or len(value) % 4 or not B64.match(value):
        return None
    raw = base64.b64decode(value)
    return raw if len(raw) <= MAX_FILE and base64.b64encode(raw).decode() == value else None


def _index_library(db, bot_id: str) -> bool:
    """Trägt Dateien aus dem Verlauf nach (IDs verhindern Duplikate). Liefert „abgeschnitten“."""
    truncated, cursor = False, 0
    while True:
        row = db.one(HISTORY, cursor)
        if not row:
            return truncated
        cursor = row["cur"]
        meta = _obj(loads(row["metadata"]))
        if isinstance(meta.get("botId"), str):
            sender = meta["botId"]
        elif "botId" not in meta and row["kind"] in ("direct", "automation") and row["members"] == 1:
            sender = row["sole_bot"]
        else:
            sender = None
        if row["parts"] is None:
            truncated = True
            continue
        parts = loads(row["parts"])
        if not isinstance(parts, list):
            continue
        remaining = [MAX_PARTS]

        def visit(parts, owner, message_id, source_chat, finished, depth):
            nonlocal truncated
            if depth > MAX_DEPTH:
                truncated = truncated or bool(parts)
                return
            for index, raw in enumerate(parts):
                remaining[0] -= 1
                if remaining[0] < 0:
                    truncated = True
                    return
                part = _obj(raw)
                if part.get("state") != "output-available":
                    continue
                out, kind = _obj(part.get("output")), part.get("type")
                if kind == "tool-handoff":
                    nested = _obj(out.get("message"))
                    nmeta = _obj(nested.get("metadata"))
                    if nested.get("role") == "assistant" and isinstance(nested.get("id"), str) and isinstance(nested.get("parts"), list) \
                            and isinstance(nmeta.get("botId"), str):
                        visit(nested["parts"], nmeta["botId"], nested["id"],
                              out["sourceChatId"] if isinstance(out.get("sourceChatId"), str) else source_chat, nmeta.get("finishedAt"), depth + 1)
                    continue
                if owner != bot_id:
                    continue
                image = kind == "tool-generate_image" and out.get("ok") is True and out.get("mediaType") == "image/jpeg"
                if not image and kind not in ("tool-share_file", "tool-create_pdf", "tool-create_word"):
                    continue
                data = _bytes(out.get("data"))
                if data is None or (not image and out.get("size") != len(data)):
                    continue
                if image and data[:3] != b"\xff\xd8\xff":
                    continue
                filename = "Bild.jpg" if image else out.get("filename")
                if not isinstance(filename, str) or not filename or len(filename) > 255 or re.search(r"[/\\\x00-\x1f\x7f]", filename) \
                        or filename in (".", ".."):
                    continue
                media = out.get("mediaType")
                if not isinstance(media, str) or len(media) > 127 or not MEDIA_TYPE.match(media):
                    continue
                file_id = hashlib.sha256(dumps([source_chat, message_id, index, out["data"]]).encode()).hexdigest()
                created = finished if _number(finished) else row["created_at"]
                db.run("INSERT OR IGNORE INTO bot_files (id,bot_id,filename,media_type,size,chat_id,message_id,created_at,kind,data)"
                       " VALUES (?,?,?,?,?,?,?,?,?,?)", file_id, bot_id, filename, media, len(data), row["chat_id"], row["message_id"],
                       int(created), "image" if image else "file", out["data"])

        visit(parts, sender, row["message_id"], row["chat_id"], meta.get("finishedAt"), 0)


FILE_COLUMNS = "id, filename, media_type AS mediaType, size, chat_id AS chatId, message_id AS messageId, created_at AS createdAt, kind"


def _library(db, bot_id: str, file_id: str | None):
    if not db.val("SELECT 1 FROM bots WHERE id=? AND user_id='local'", bot_id):
        raise Fail("Orbi nicht gefunden.")
    with db.tx():
        truncated = _index_library(db, bot_id)
    if file_id:
        file = db.one(f"SELECT {FILE_COLUMNS}, data FROM bot_files WHERE bot_id=? AND id=?", bot_id, file_id)
        if not file:
            raise Fail("Datei nicht gefunden.")
        return {"ok": True, "file": dict(file)}
    files = db.all(f"SELECT {FILE_COLUMNS} FROM bot_files WHERE bot_id=? ORDER BY created_at DESC, id", bot_id)
    return {"ok": True, "files": [dict(f) for f in files], "limitations": LIMITATIONS, "truncated": truncated}


@route("GET", "/v1/bots/{id}/library")
async def library(req: Req):
    return _library(req.ctx.db, req.params["id"], None)


@route("GET", "/v1/bots/{id}/library/{fileId}")
async def library_file(req: Req):
    return _library(req.ctx.db, req.params["id"], req.params["fileId"])
