"""Schlüssel im Orbit-Datenordner (Datei `secrets.json`, nur für den Besitzer lesbar). Die einzige Stelle, die Schlüssel liest.

Seit 19.11.2026 liegt nichts mehr im macOS-Schlüsselbund (Consti: keine Schlüsselbund-Abfragen). Der Datenordner ist für alle
Unterprozesse gesperrt (sandbox.py), Programme der Systemsperre kommen also nicht heran. Der Wert steht nie in einer Befehlszeile und wird nie geloggt.
Ein Eintrag, der noch im alten Schlüsselbund liegt, wird beim ersten Lesen einmal in die Datei übernommen (`security find-generic-password`, ohne Rückfrage)
und danach nie wieder dort gesucht. Gelöscht wird im Schlüsselbund nichts.
Tests setzen ORBIT_KEYCHAIN_FAKE='{"NAME": "wert"}'; dann wird weder Datei noch Schlüsselbund angefasst.
"""
import asyncio
import json
import os
import tempfile
from pathlib import Path

from .config import REAL_DATA_DIR, profile_id

SERVICE = "de.consti.orbit2"
# (Name, Anzeigename) der Schlüssel, die die App verwaltet.
MANAGED_KEYS = [("DAYTONA_API_KEY", "Daytona"), ("OPENROUTER_JEV_API_KEY", "Jev")]

_cache: dict[tuple[str, str], str | None] = {}


def _file() -> Path:
    return Path(os.environ.get("ORBIT_DATA_DIR") or REAL_DATA_DIR) / "secrets.json"


def _load() -> dict[str, str]:
    try:
        data = json.loads(_file().read_text("utf-8"))
    except (OSError, ValueError):
        return {}
    return {k: v for k, v in data.items() if isinstance(k, str) and isinstance(v, str)} if isinstance(data, dict) else {}


def _save(data: dict[str, str]) -> None:
    path = _file()
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".secrets-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _key(service: str, account: str) -> str:
    return f"{service}/{account}"


async def _read(service: str, account: str, limit: int = 4096) -> str | None:
    try:
        proc = await asyncio.create_subprocess_exec(
            "/usr/bin/security", "find-generic-password", "-s", service, "-a", account, "-w",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        try:
            out, _ = await asyncio.wait_for(proc.communicate(), 5)
        except asyncio.TimeoutError:
            proc.kill()
            return None
    except OSError:
        return None
    value = out.decode("utf-8", "replace").rstrip("\r\n") if proc.returncode == 0 else ""
    return value if 0 < len(value) <= limit else None


def _scoped(service: str) -> str:
    identity = profile_id()
    return f"{service}.profile.{identity}" if identity else service


async def get(name: str) -> str | None:
    """Wert des Schlüssels oder None, ausschließlich für das aktive Orbit-Profil."""
    service = _scoped(SERVICE)
    cache_key = (service, name)
    if cache_key not in _cache or os.environ.get("ORBIT_KEYCHAIN_FAKE") is not None:
        _cache[cache_key] = await _get_item(service, name)
    return _cache[cache_key]


async def composio_project_key() -> str | None:
    """Der einzige Zugang, den ein getrenntes Profil aus dem Projekt übernimmt."""
    return await get("COMPOSIO_API_KEY") or await _get_item(SERVICE, "COMPOSIO_API_KEY")


def forget(names: list[str] | None = None) -> None:
    """Vergisst die gemerkten Werte (alle oder nur die genannten), damit der nächste `get` neu liest."""
    service = _scoped(SERVICE)
    for key in list(_cache):
        if key[0] == service and (names is None or key[1] in names):
            _cache.pop(key, None)


# --- beliebige Einträge (Composio, iCloud, MCP-Token) ---
_fake_written: dict[tuple[str, str], str] = {}  # nur im Test-Modus: Schreiben geht in den Speicher, nie in den echten Schlüsselbund


async def get_item(service: str, account: str) -> str | None:
    return await _get_item(_scoped(service), account)


async def _get_item(service: str, account: str) -> str | None:
    """Wert eines beliebigen Eintrags (kein Zwischenspeicher). Im Test-Modus: erst Geschriebenes, dann ORBIT_KEYCHAIN_FAKE ('<Konto>' oder '<Dienst>/<Konto>')."""
    fake = os.environ.get("ORBIT_KEYCHAIN_FAKE")
    if fake is not None:
        if (service, account) in _fake_written:
            return _fake_written[(service, account)] or None
        try:
            table = json.loads(fake)
            value = table.get(f"{service}/{account}") or (table.get(account) if service == SERVICE else None)
        except (ValueError, AttributeError):
            return None
        return value if isinstance(value, str) and value else None
    data = _load()
    stored = data.get(_key(service, account))
    if stored is None:  # noch nie übernommen: einmal im alten Schlüsselbund nachsehen
        legacy = await _read(service, account, 16384)
        _save({**_load(), _key(service, account): legacy or ""})
        return legacy
    return stored or None


async def set_item(service: str, account: str, value: str) -> None:
    """Schreibt (oder ersetzt) einen Eintrag in `secrets.json`."""
    service = _scoped(service)
    if not value or len(value) > 16384 or not service.replace(".", "").replace("-", "").isalnum() or not all(c.isalnum() or c in "_-." for c in account):
        raise ValueError("Ungültiger Schlüsselbund-Eintrag.")
    if os.environ.get("ORBIT_KEYCHAIN_FAKE") is not None:
        _fake_written[(service, account)] = value
        return
    _save({**_load(), _key(service, account): value})
    if service == _scoped(SERVICE):
        forget([account])


async def delete_item(service: str, account: str) -> None:
    """Entfernt einen Eintrag (fehlt er schon, ist das auch gut)."""
    service = _scoped(service)
    if os.environ.get("ORBIT_KEYCHAIN_FAKE") is not None:
        _fake_written[(service, account)] = ""
    else:
        _save({**_load(), _key(service, account): ""})  # leer = gelöscht und nicht erneut im alten Schlüsselbund suchen
    if service == _scoped(SERVICE):
        forget([account])
