"""macOS-Rechte (TCC) der Mac-Werkzeuge. Vorlage: lib/mac/permissions.ts, lib/mac/access.ts.

Statusabfragen verwenden nur passive Prüfungen. Apple-Events werden erst bei einer
ausdrücklichen Anfrage oder beim Einsatz des jeweiligen Werkzeugs gesendet.
"""
import asyncio
import ctypes
import json
import os
import re
import sys
import tempfile
from pathlib import Path

from ...db import now_ms
from . import undo
from .jxa import JXA

KEY = "mac_local_tools"
# Rechte ohne Ja/Nein-Dialog: Systemeinstellungen öffnen, Orbit.app aus dem Ziehfenster in die Liste ziehen
DRAG_PIDS = ("accessibility", "screen", "full_disk")
PRIVACY = "x-apple.systempreferences:com.apple.preference.security?Privacy_"
# id, Titel, Einstellungsseite, wofür, Automation-App (None = kein Automation-Recht)
PERMISSIONS = [
    ("accessibility", "Bedienungshilfen", "Accessibility", "Maus und Tastatur steuern", None),
    ("screen", "Bildschirmaufnahme", "ScreenCapture", "den Bildschirm sehen", None),
    ("full_disk", "Festplattenvollzugriff", "AllFiles", "geschützte Ordner (Mail, Safari, …) lesen", None),
    ("automation_calendar", "Kalender", "Automation", "Termine lesen und anlegen", "Calendar"),
    ("automation_reminders", "Erinnerungen", "Automation", "Erinnerungen lesen und anlegen", "Reminders"),
    ("automation_contacts", "Kontakte", "Automation", "Kontakte suchen", "Contacts"),
    ("automation_notes", "Notizen", "Automation", "Notizen lesen und anlegen", "Notes"),
    ("automation_system_events", "System Events", "Automation", "Tastatur und Apps steuern", "System Events"),
    ("automation_safari", "Safari", "Automation", "Browser öffnen und lesen", "Safari"),
    ("automation_finder", "Finder", "Automation", "den Finder steuern", "Finder"),
]
BUNDLE_IDS = {"Calendar": "com.apple.iCal", "Reminders": "com.apple.reminders", "Contacts": "com.apple.AddressBook",
              "Notes": "com.apple.Notes", "System Events": "com.apple.systemevents", "Safari": "com.apple.Safari", "Finder": "com.apple.finder"}
DENIED = re.compile(r"-174[34]\b|Not authori[sz]ed to send Apple events|nicht berechtigt", re.I)

_automation: dict[str, str] = {}  # App -> granted|missing, aus Werkzeugläufen und „Anfragen“
_disk_requested = False


# ---------------------------------------------------------------- Schalter (access.ts)
def enabled(db) -> bool:
    if sys.platform != "darwin" and not os.environ.get("ORBIT_MAC_TOOLS_ANY_OS"):
        return False
    try:
        return db.val("SELECT value FROM app_kv WHERE key=?", KEY) != "off"
    except Exception:
        return True


def set_enabled(db, on: bool) -> None:
    db.run("INSERT INTO app_kv (key,value,updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
           KEY, "on" if on else "off", now_ms())


# ---------------------------------------------------------------- Ergebnisse merken
def note_automation_result(app: str, output: str, exit_code: int | None) -> None:
    if DENIED.search(output):
        _automation[app] = "missing"
    elif exit_code == 0:
        _automation[app] = "granted"


def hint(output: str) -> str | None:
    if re.search(r"-174[34]\b|Not authori[sz]ed", output, re.I):
        return "macOS hat den Zugriff nicht erlaubt. Erlaubnis in Orbit › Einstellungen › Sicherheit › Mac-Zugriff anfragen."
    return None


# ---------------------------------------------------------------- Prüfen
def _full_disk() -> str:
    try:
        with os.scandir(undo.home() / "Library" / "Safari"):
            pass
        return "granted"
    except PermissionError:
        return "missing"
    except OSError:
        return "unknown"


async def _jxa(script: str) -> dict:
    from . import tools
    r = await tools.run(["/usr/bin/osascript", "-l", "JavaScript", "-e", script], timeout=15, sandboxed=False)
    try:
        data = json.loads(r.output.strip())
        return data if isinstance(data, dict) else {}
    except ValueError:
        return {}


def _preflight(framework: str, name: str) -> str:
    try:
        library = ctypes.CDLL(f"/System/Library/Frameworks/{framework}.framework/{framework}")
        check = getattr(library, name)
        check.argtypes = []
        check.restype = ctypes.c_bool
        return "granted" if check() else "missing"
    except (OSError, AttributeError):
        return "unknown"


def _native_request(kind: str, target: str | None) -> int:
    resources = Path(__file__).resolve().parents[4]
    library = ctypes.CDLL(str(resources / "libOrbitPermissionUI.dylib"))
    request = library.orbit_request_permission
    request.argtypes = [ctypes.c_char_p, ctypes.c_char_p]
    request.restype = ctypes.c_int32
    return request(kind.encode(), target.encode() if target else None)


def _entry(pid, label, page, what, status) -> dict:
    app_name = "Orbit.app" if os.environ.get("ORBIT_TCC_BUNDLE") == "1" else "Python"
    sentence = {"granted": f"Erlaubt: {what}.",
                "missing": f"Erlaube {app_name} unter Datenschutz & Sicherheit › {label}.",
                "unknown": f"Noch nicht bestätigt: {what}."}[status]
    if pid in DRAG_PIDS and status != "granted" and app_name == "Orbit.app":
        sentence = "Zieh Orbit.app aus dem kleinen Fenster in die Liste und aktiviere den Schalter."
    return {"id": pid, "label": label, "status": status, "settingsUrl": PRIVACY + page, "detail": sentence}


async def read_permissions() -> list[dict]:
    if sys.platform != "darwin":
        return [_entry(p, l, g, w, "unknown") for p, l, g, w, _ in PERMISSIONS]
    disk, out = (_full_disk() if _disk_requested else "unknown"), []
    for pid, label, page, what, app in PERMISSIONS:
        status = "unknown"
        if pid == "accessibility":
            status = _preflight("ApplicationServices", "AXIsProcessTrusted")
        elif pid == "screen":
            status = _preflight("CoreGraphics", "CGPreflightScreenCaptureAccess")
        elif pid == "full_disk":
            status = disk
        elif app:
            status = _automation.get(app, "unknown")
        out.append(_entry(pid, label, page, what, status))
    return out


async def request_permission(pid: str) -> dict | None:
    """Löst den macOS-Dialog aus (oder prüft erneut). Festplattenvollzugriff lässt sich nicht anfragen: nur Systemeinstellungen."""
    global _disk_requested
    entry = next((p for p in PERMISSIONS if p[0] == pid), None)
    if not entry:
        return None
    from . import tools
    if os.environ.get("ORBIT_TCC_BUNDLE") == "1" and pid in DRAG_PIDS:
        if pid == "full_disk":
            _disk_requested = True
        current = next(p for p in await read_permissions() if p["id"] == pid)
        if current["status"] != "granted":
            await tools.run(["/usr/bin/open", PRIVACY + entry[2]], timeout=5, sandboxed=False)
        return current
    if os.environ.get("ORBIT_TCC_BUNDLE") == "1":
        app = entry[4]
        target = BUNDLE_IDS[app] if app else None
        kind = "automation" if app else pid
        try:
            result = await asyncio.to_thread(_native_request, kind, target)
            if result == -600 and target:  # Windows and permissions target running apps.
                await tools.run(["/usr/bin/open", "-g", "-b", target], timeout=5, sandboxed=False)
                await asyncio.sleep(0.5)
                result = await asyncio.to_thread(_native_request, kind, target)
        except (OSError, AttributeError):
            result = -1
        status = {1: "granted", 0: "missing"}.get(result, "unknown")
        if app:
            _automation[app] = status
        return _entry(*entry[:4], status)
    if pid == "accessibility":
        await _jxa(JXA["requestAccessibility"])
    elif pid == "screen":  # Die Datei entsteht ohne Recht nicht; sie liegt im Wegwerf-Ordner und wird gleich weggeräumt.
        with tempfile.TemporaryDirectory(prefix="orbit-rechte-") as d:
            await tools.run(["/usr/sbin/screencapture", "-x", "-t", "jpg", str(Path(d) / "probe.jpg")], timeout=120)
    elif pid == "full_disk":
        _disk_requested = True
        if _full_disk() != "granted":
            await tools.run(["/usr/bin/open", PRIVACY + entry[2]], timeout=5, sandboxed=False)
    elif entry[4]:
        r = await tools.run(["/usr/bin/osascript", "-e", f'tell application id "{BUNDLE_IDS[entry[4]]}" to count windows'], timeout=120, sandboxed=False)
        note_automation_result(entry[4], r.output, r.exit_code)
    return next(p for p in await read_permissions() if p["id"] == pid)
