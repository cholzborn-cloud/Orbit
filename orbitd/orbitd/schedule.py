"""Zeitpläne der Routinen: Prüfung, nächster Termin (mit Zeitzone und Sommerzeit) und ein deutscher Satz dazu. Reine Funktionen."""
import re
from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from .web import Fail

_TIME = re.compile(r"^\d{2}:\d{2}$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
COMPUTER_RETURNED = "computer_returned"
_EXTRA = {"once": ("date",), "daily": (), "weekdays": (), "weekly": ("weekday",), "monthly": ("day",), "event": ("event",)}
_DAYS = ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"]  # 0 = Sonntag wie im alten Dienst


def _int_in(value, lo: int, hi: int) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and lo <= value <= hi


def validate_timezone(name) -> ZoneInfo:
    try:
        if isinstance(name, str) and name:
            return ZoneInfo(name)
    except Exception:  # unbekannte oder kaputte Namen (auch Pfad-Tricks)
        pass
    raise Fail("Zeitzone ist ungültig.")


def validate_schedule(obj) -> dict:
    """Prüft einen Zeitplan und liefert ihn bereinigt (nur bekannte Felder) zurück."""
    if not isinstance(obj, dict) or obj.get("kind") not in _EXTRA:
        raise Fail("Eingabe ungültig.")
    if obj["kind"] == "event":
        if obj.get("event") != COMPUTER_RETURNED:
            raise Fail("Dieses Ereignis wird nicht unterstützt.")
        return {"kind": "event", "event": COMPUTER_RETURNED}
    kind, at = obj["kind"], obj.get("at")
    if not isinstance(at, str) or not _TIME.match(at):
        raise Fail("Eingabe ungültig.")
    if int(at[:2]) > 23 or int(at[3:]) > 59:
        raise Fail("Uhrzeit ist ungültig.")
    out = {"kind": kind, "at": at}
    if kind == "once":
        day = obj.get("date")
        try:
            if not isinstance(day, str) or not _DATE.match(day):
                raise ValueError
            date.fromisoformat(day)
        except ValueError:
            raise Fail("Eingabe ungültig.") from None
        out["date"] = day
    elif kind == "weekly":
        if not _int_in(obj.get("weekday"), 0, 6):
            raise Fail("Eingabe ungültig.")
        out["weekday"] = obj["weekday"]
    elif kind == "monthly":
        if not _int_in(obj.get("day"), 1, 31):
            raise Fail("Eingabe ungültig.")
        out["day"] = obj["day"]
    return out


def _local(day: date, h: int, m: int, tz: ZoneInfo) -> datetime | None:
    """Ortszeit als UTC; None, wenn es die Uhrzeit nicht gibt (Sommerzeit-Lücke). Doppelte Uhrzeit: die erste."""
    local = datetime(day.year, day.month, day.day, h, m, tzinfo=tz)
    utc = local.astimezone(timezone.utc)
    return utc if utc.astimezone(tz).replace(tzinfo=None) == local.replace(tzinfo=None) else None


def next_run(schedule: dict, timezone: str, after_ms: int) -> int | None:
    """Nächster Termin (ms) strikt nach `after_ms`, sonst None (z. B. einmalig in der Vergangenheit)."""
    if schedule.get("kind") == "event":
        return None
    try:
        tz = ZoneInfo(timezone)
    except Exception:
        return None
    h, m = int(schedule["at"][:2]), int(schedule["at"][3:])
    kind = schedule["kind"]
    today = datetime.fromtimestamp(after_ms // 1000, tz=tz).date()
    if kind == "once":
        days = [date.fromisoformat(schedule["date"])]
    else:
        days = [today + timedelta(days=i) for i in range(367)]
    for day in days:
        js_weekday = (day.weekday() + 1) % 7
        if kind == "weekdays" and js_weekday in (0, 6):
            continue
        if kind == "weekly" and js_weekday != schedule["weekday"]:
            continue
        if kind == "monthly":
            last = ((day.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)).day
            if day.day != min(schedule["day"], last):
                continue
        at = _local(day, h, m, tz)
        if at and int(at.timestamp() * 1000) > after_ms:
            return int(at.timestamp() * 1000)
    return None


def describe(schedule: dict, timezone: str) -> str:
    """Wie im Freigabe-Text des alten Dienstes, z. B. „täglich um 08:00 (Europe/Berlin)“."""
    if schedule.get("kind") == "event":
        return "wenn du diesem Orbi den Computer zurückgibst"
    at = schedule["at"]
    kind = schedule["kind"]
    text = {
        "daily": f"täglich um {at}",
        "weekdays": f"Mo–Fr um {at}",
        "weekly": f"jede Woche {_DAYS[schedule.get('weekday', 0)]} um {at}",
        "monthly": f"monatlich am {schedule.get('day')}. um {at}",
        "once": f"einmalig am {schedule.get('date')} um {at}",
    }[kind]
    return f"{text} ({timezone})"
