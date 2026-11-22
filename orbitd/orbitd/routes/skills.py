"""Eigene Skills (Datenbank) und Brain-Skills (Ordner „04 Ressourcen/Fähigkeiten“ im Brain)."""
import os
import tempfile
import re
import sqlite3
from pathlib import Path

from ..config import USER, isolated_dir
from ..db import dumps, loads, new_id, now_ms
from ..web import Fail, Req, route
from .settings import iso

NAME = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
BRAIN_SKILLS = "04 Ressourcen/Fähigkeiten"


def _vault(candidate: Path) -> Path | None:
    try:
        root = candidate.expanduser().resolve(strict=True)
        if root.is_dir() and ((root / "Start.md").is_file() or (root / ".obsidian").is_dir()):
            return root
    except (OSError, RuntimeError):
        pass
    return None


def brain_path() -> Path | None:
    """Separate profiles can only use a vault explicitly selected in that profile."""
    profile = isolated_dir()
    if profile is not None:
        try:
            value = (profile / "brain-folder").read_text(encoding="utf-8").strip()
            return _vault(Path(value)) if value else None
        except (OSError, ValueError):
            return None
    if os.environ.get("ORBIT_BRAIN") == "off":
        return None
    home = Path.home()
    for candidate in (os.environ.get("ORBIT_BRAIN_PATH"), home / ".second-brain", home / "Projekte-Coding" / "Second Brain"):
        if candidate:
            root = _vault(Path(candidate))
            if root is not None:
                return root
    return None


@route("GET", "/v1/settings/brain")
async def settings_brain(req: Req):
    root = brain_path()
    return {"ok": True, "path": str(root) if root is not None else None}


@route("PUT", "/v1/settings/brain")
async def set_brain(req: Req):
    profile = isolated_dir()
    if profile is None:
        raise Fail("Diese Einstellung gilt für getrennte Orbit-Profile.")
    selected = req.obj().get("path")
    if not isinstance(selected, str) or not 1 <= len(selected) <= 4096 or "\0" in selected or "\n" in selected:
        raise Fail("Wähle einen Brain-Ordner aus.")
    root = _vault(Path(selected))
    if not root:
        raise Fail("Dort wurde kein Obsidian-Vault oder Start.md gefunden.")
    if root == profile or profile in root.parents or root in profile.parents:
        raise Fail("Wähle nur den Ordner deines Brain.")
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=profile, delete=False) as file:
            file.write(str(root))
        os.replace(file.name, profile / "brain-folder")
    except OSError:
        raise Fail("Der Brain-Ordner konnte nicht gespeichert werden.") from None
    return {"ok": True, "path": str(root)}


@route("DELETE", "/v1/settings/brain")
async def disconnect_brain(req: Req):
    profile = isolated_dir()
    if profile is None:
        raise Fail("Diese Einstellung gilt für getrennte Orbit-Profile.")
    try:
        (profile / "brain-folder").unlink(missing_ok=True)
    except OSError:
        raise Fail("Der Brain-Ordner konnte nicht getrennt werden.") from None


def _valid_name(name) -> bool:
    return isinstance(name, str) and 2 <= len(name) <= 40 and bool(NAME.fullmatch(name))


def _input(obj: dict):
    """Name, Beschreibung, Inhalt oder None bei ungültiger Eingabe."""
    name, desc, body = obj.get("name"), obj.get("description"), obj.get("body")
    if not (_valid_name(name) and isinstance(desc, str) and isinstance(body, str)):
        return None
    desc, body = desc.strip(), body.strip()
    return (name, desc, body) if 1 <= len(desc) <= 300 and 1 <= len(body) <= 8000 else None


def _row(r) -> dict:
    return {"id": r["id"], "name": r["name"], "description": r["description"], "body": r["body"]}


def _skills(db) -> list:
    return db.all("SELECT id,name,description,body,created_at,updated_at FROM skills WHERE user_id=? ORDER BY name", USER)


@route("GET", "/v1/skills")
async def list_skills(req: Req):
    return {"ok": True, "skills": [{**_row(r), "createdAt": iso(r["created_at"]), "updatedAt": iso(r["updated_at"])} for r in _skills(req.ctx.db)]}


@route("GET", "/v1/skills/slash")
async def slash_skills(req: Req):
    skills = [{"name": r["name"], "description": r["description"], "source": "orbit"} for r in _skills(req.ctx.db)]
    brain, offline = brain_path(), True
    if brain:
        try:
            root = brain / BRAIN_SKILLS
            names = sorted(e.name for e in root.iterdir() if e.is_dir() and not e.is_symlink())
            taken = {s["name"].lower() for s in skills}
            skills += [{"name": n, "description": "Brain-Skill", "source": "brain"} for n in names if n.lower() not in taken]
            offline = False
        except OSError:
            pass
    return {"ok": True, "skills": skills, "brainOffline": offline}


@route("GET", "/v1/skills/brain/{name}")
async def brain_skill(req: Req):
    name = req.params["name"]
    if not _valid_name(name):
        raise Fail("Ungültiger Skill-Name.")
    brain = brain_path()
    try:
        root = (brain / BRAIN_SKILLS).resolve(strict=True)
        file = (root / name / "SKILL.md").resolve(strict=True)
        if brain is None or not file.is_relative_to(root):
            raise OSError
        body = file.read_text(encoding="utf-8")
    except (OSError, TypeError, ValueError):
        body = ""
    if not body:
        raise Fail("Brain-Skill konnte nicht geladen werden.")
    return {"ok": True, "body": body[:8000]}


@route("POST", "/v1/skills")
async def create_skill(req: Req):
    data = _input(req.obj())
    if not data:
        raise Fail("Name, Beschreibung oder Inhalt ist ungültig.")
    skill_id, t = new_id(), now_ms()
    try:
        req.ctx.db.run("INSERT INTO skills (id,user_id,name,description,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?)", skill_id, USER, *data, t, t)
    except sqlite3.IntegrityError:
        raise Fail("Skill konnte nicht gespeichert werden. Name möglicherweise bereits vergeben.") from None
    return {"ok": True, "skill": {"id": skill_id, **dict(zip(("name", "description", "body"), data))}}


@route("PUT", "/v1/skills/{id}")
async def update_skill(req: Req):
    data = _input(req.obj())
    if not data:
        raise Fail("Skill-Daten sind ungültig.")
    try:
        changed = req.ctx.db.run("UPDATE skills SET name=?,description=?,body=?,updated_at=? WHERE id=? AND user_id=?", *data, now_ms(), req.params["id"], USER)
    except sqlite3.IntegrityError:
        raise Fail("Skill konnte nicht gespeichert werden.") from None
    if not changed:
        raise Fail("Skill nicht gefunden.")
    return {"ok": True, "skill": {"id": req.params["id"], **dict(zip(("name", "description", "body"), data))}}


@route("DELETE", "/v1/skills/{id}")
async def delete_skill(req: Req):
    if not req.ctx.db.run("DELETE FROM skills WHERE id=? AND user_id=?", req.params["id"], USER):
        raise Fail("Skill nicht gefunden.")


# ---------------------------------------------------------------- Skill-Vorschläge des Träumers (app_kv „skill_proposals“, neueste zuerst)
def _proposals(db) -> list:
    v = loads(db.val("SELECT value FROM app_kv WHERE key='skill_proposals'"), [])
    return [p for p in v if isinstance(p, dict)] if isinstance(v, list) else []


def _take(req: Req) -> tuple[list, dict]:
    rest = _proposals(req.ctx.db)
    hit = next((p for p in rest if p.get("id") == req.params["id"]), None)
    if not hit:
        raise Fail("Skill-Vorschlag nicht gefunden.")
    return [p for p in rest if p is not hit], hit


def _save_proposals(db, rest: list) -> None:
    db.run("INSERT INTO app_kv (key,value,updated_at) VALUES ('skill_proposals',?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at", dumps(rest), now_ms())


@route("GET", "/v1/skills/proposals")
async def list_proposals(req: Req):
    return {"ok": True, "proposals": _proposals(req.ctx.db)}


@route("POST", "/v1/skills/proposals/{id}/accept")
async def accept_proposal(req: Req):
    rest, p = _take(req)
    o = req.obj()  # die App kann Name/Beschreibung/Inhalt vor dem Annehmen ändern
    merged = {k: (o[k].strip() if isinstance(o.get(k), str) and o[k].strip() else p.get(k)) for k in ("name", "description", "body")}
    made = await create_skill(Req(req.params, req.query, merged, req.ctx))
    _save_proposals(req.ctx.db, rest)  # erst nach erfolgreichem Anlegen (create_skill wirft sonst Fail)
    return {"ok": True, "id": p["id"], "name": made["skill"]["name"], "skillId": made["skill"]["id"]}


@route("POST", "/v1/skills/proposals/{id}/reject")
async def reject_proposal(req: Req):
    rest, p = _take(req)
    _save_proposals(req.ctx.db, rest)
    return {"ok": True, "id": p["id"]}
