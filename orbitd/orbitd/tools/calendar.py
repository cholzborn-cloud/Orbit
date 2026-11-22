"""Apple Kalender über iCloud CalDAV (httpx, kein Zusatzpaket) und die Orbi-Werkzeuge apple_calendar_*.

Vorlage: lib/icloud-calendar/client.ts und service/src/icloud-calendar.ts. Zugang im Schlüsselbund (Dienst de.consti.orbit.icloud-calendar,
Konto local, JSON {appleId,appPassword}); nie loggen. Fehlertexte enthalten nie Adressen, Köpfe oder Passwörter.
"""
import base64
import json
import re
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlparse

import httpx

from .. import keychain
from ..runtime.contract import Risk, tool
from ..web import Fail

KEYCHAIN = ("de.consti.orbit.icloud-calendar", "local")
DAV, CAL = "{DAV:}", "{urn:ietf:params:xml:ns:caldav}"
MAX_BYTES = 2 * 1024 * 1024
XML_START = '<?xml version="1.0" encoding="utf-8"?>'
NS = 'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"'
HOST = re.compile(r"^(caldav|p\d+-caldav)\.icloud\.com$")
PASSWORD = re.compile(r"^[a-z]{4}(?:-[a-z]{4}){3}$", re.I)
UTC_LINE = re.compile(r"^\d{8}T\d{6}Z$")
RULE_PART = re.compile(r"^(FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)|INTERVAL=[1-9]\d*|COUNT=[1-9]\d*|UNTIL=\d{8}T\d{6}Z|BYDAY=(MO|TU|WE|TH|FR|SA|SU)(,(MO|TU|WE|TH|FR|SA|SU))*)$")
TRANSPORT: httpx.AsyncBaseTransport | None = None   # Tests setzen httpx.MockTransport
MAIL = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$")


class CalError(Exception):
    pass


class UnsupportedSeries(CalError):
    pass


def apple_url(value: str, base: str | None = None) -> str:
    try:
        u = urlparse(urljoin(base, value) if base else value)
        ok = u.scheme == "https" and u.port in (None, 443) and not u.username and not u.password and not u.fragment and not u.query and bool(u.hostname and HOST.match(u.hostname))
    except ValueError:
        ok = False
    if not ok:
        raise CalError("Kalenderziel ist kein erlaubter iCloud-CalDAV-Server.")
    return u._replace(netloc=u.hostname).geturl()  # iCloud nennt ihre Adressen mit „:443“ (live 14.11.); Node blendet den Standard-Port aus


def utc(d: datetime) -> str:
    if d.tzinfo is None or not 1000 <= d.astimezone(timezone.utc).year <= 9999:
        raise CalError("Ungültiges Kalenderdatum.")
    return d.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def parse_utc(v: str) -> datetime:
    return datetime.strptime(v, "%Y%m%dT%H%M%SZ").replace(tzinfo=timezone.utc)


def fold(lines: list[str]) -> str:
    out = []
    for line in lines:
        cur, n = "", 0
        for ch in line:
            b = len(ch.encode())
            if n + b > 75:
                cur, n = cur + "\r\n ", 1
            cur, n = cur + ch, n + b
        out.append(cur)
    return "\r\n".join(out) + "\r\n"


def children(node: ET.Element, tag: str) -> list[ET.Element]:
    return [c for c in node if c.tag == tag]


def text(node: ET.Element | None) -> str:
    return "".join(node.itertext()).strip() if node is not None else ""


def props(response: ET.Element) -> list[ET.Element]:
    return [p for stat in children(response, DAV + "propstat")
            if re.match(r"^HTTP/\d(?:\.\d)? 200(?: |$)", text(next(iter(children(stat, DAV + "status")), None)))
            for p in children(stat, DAV + "prop")]


def prop(response: ET.Element, tag: str) -> ET.Element | None:
    return next((c for p in props(response) for c in children(p, tag)), None)


class ICloud:
    def __init__(self, apple_id: str, app_password: str):
        if not apple_id or len(apple_id) > 320 or re.search(r"[:\r\n\0]", apple_id) or not PASSWORD.match(app_password):
            raise CalError("Apple-ID und app-spezifisches Passwort erforderlich.")
        self.owner = apple_id
        self.auth = "Basic " + base64.b64encode(f"{apple_id}:{app_password}".encode()).decode()
        self.calendars: set[str] = set()

    async def _request(self, target: str, method: str, body: str, headers: dict | None = None) -> dict:
        url = apple_url(target)
        try:
            async with httpx.AsyncClient(transport=TRANSPORT, timeout=15, follow_redirects=False) as http:
                for hops in range(4):
                    r = await http.request(method, url, content=None if method in ("GET", "DELETE") else body.encode(),
                                           headers={"Authorization": self.auth, "Content-Type": "application/xml; charset=utf-8", **(headers or {})})
                    if r.status_code in (301, 302, 307, 308):
                        loc = r.headers.get("location")
                        if not loc or hops == 3 or method in ("PUT", "DELETE"):
                            raise CalError("Kalenderweiterleitung abgebrochen.")
                        url = apple_url(loc, url)  # Zugangsdaten gehen nie an eine fremde Domain
                        continue
                    if r.status_code not in (200, 201, 204, 207):
                        raise CalError(f"iCloud-Kalender antwortet mit HTTP {r.status_code}.")
                    if len(r.content) > MAX_BYTES:
                        raise CalError("Kalenderantwort ist zu groß.")
                    return {"url": url, "status": r.status_code, "text": r.content.decode("utf-8"), "etag": r.headers.get("etag")}
        except CalError:
            raise
        except Exception:
            pass
        raise CalError("Kalenderanfrage fehlgeschlagen oder Zeitlimit erreicht.")

    async def _propfind(self, url: str, properties: str, depth: str) -> dict:
        r = await self._request(url, "PROPFIND", f"{XML_START}<d:propfind {NS}><d:prop>{properties}</d:prop></d:propfind>", {"Depth": depth})
        root = self._xml(r)
        return {"url": r["url"], "rows": children(root, DAV + "response")}

    @staticmethod
    def _xml(r: dict) -> ET.Element:
        try:
            root = ET.fromstring(r["text"])
        except ET.ParseError:
            raise CalError("Ungültige CalDAV-Antwort.") from None
        if r["status"] != 207 or root.tag != DAV + "multistatus":
            raise CalError("Ungültige CalDAV-Antwort.")
        return root

    async def discover(self) -> list[dict]:
        self.calendars = set()
        first = await self._propfind("https://caldav.icloud.com/.well-known/caldav", "<d:current-user-principal/>", "0")
        href = next((h for h in (text(next(iter(children(p, DAV + "href")), None)) for p in (prop(r, DAV + "current-user-principal") for r in first["rows"]) if p is not None) if h), None)
        if not href:
            raise CalError("iCloud-Kalenderkonto wurde nicht erkannt.")
        home = await self._propfind(apple_url(href, first["url"]), "<c:calendar-home-set/>", "0")
        homes = [h for r in home["rows"] for p in [prop(r, CAL + "calendar-home-set")] if p is not None for h in children(p, DAV + "href")]
        if not homes or len(homes) > 8:
            raise CalError("Kalenderverzeichnis fehlt oder ist zu groß.")
        out: list[dict] = []
        for h in homes:
            res = await self._propfind(apple_url(text(h), home["url"]), "<d:resourcetype/><d:displayname/>", "1")
            for row in res["rows"]:
                rt = prop(row, DAV + "resourcetype")
                if rt is None or not any(c.tag == CAL + "calendar" for c in rt):
                    continue
                ref = text(next(iter(children(row, DAV + "href")), None))
                if not ref:
                    raise CalError("Kalenderadresse fehlt.")
                url = apple_url(ref, res["url"])
                if not url.endswith("/"):
                    raise CalError("Ungültige Kalenderadresse.")
                if not any(c["url"] == url for c in out):
                    out.append({"url": url, "name": text(prop(row, DAV + "displayname")) or "Kalender"})
        self.calendars = {c["url"] for c in out}
        return out

    def _calendar(self, url: str) -> str:
        url = apple_url(url)
        if url not in self.calendars:
            raise CalError("Kalender muss zuerst über dieses Konto ermittelt werden.")
        return url

    async def query(self, calendar: str, start: datetime, end: datetime) -> list[dict]:
        frm, to = utc(start), utc(end)
        if to <= frm or end - start > timedelta(days=366):
            raise CalError("Kalenderzeitraum muss zwischen einer Sekunde und 366 Tagen liegen.")
        url = self._calendar(calendar)
        r = await self._request(url, "REPORT", f'{XML_START}<c:calendar-query {NS}><d:prop><d:getetag/><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR">'
                                f'<c:comp-filter name="VEVENT"><c:time-range start="{frm}" end="{to}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>', {"Depth": "1"})
        out = []
        for row in children(self._xml(r), DAV + "response"):
            data = prop(row, CAL + "calendar-data")
            href = text(next(iter(children(row, DAV + "href")), None))
            if not text(data) or not href:
                raise CalError("Kalenderobjekt fehlt; das Ergebnis ist unvollständig.")
            obj = apple_url(href, r["url"])
            if not obj.startswith(url) or "/" in obj[len(url):]:
                raise CalError("Kalenderobjekt liegt außerhalb des gewählten Kalenders.")
            out.append({"url": obj, "etag": text(prop(row, DAV + "getetag")) or None, "iCalendar": "".join(data.itertext())})
        return out

    async def create(self, calendar: str, title: str, start: datetime, end: datetime) -> None:
        url = self._calendar(calendar)
        if not title.strip() or len(title) > 1000 or re.search(r"[\x00-\x1f\x7f]", title):
            raise CalError("Ungültiger Kalendertitel.")
        frm, to = utc(start), utc(end)
        if to <= frm:
            raise CalError("Terminende muss mindestens eine Sekunde nach dem Beginn liegen.")
        uid = str(uuid.uuid4())
        summary = "SUMMARY:" + title.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
        ics = fold(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Orbit//iCloud Calendar//DE", "BEGIN:VEVENT", f"UID:{uid}", f"DTSTAMP:{utc(datetime.now(timezone.utc))}",
                    f"DTSTART:{frm}", f"DTEND:{to}", summary, "END:VEVENT", "END:VCALENDAR"])
        r = await self._request(urljoin(url, f"{uid}.ics"), "PUT", ics, {"Content-Type": "text/calendar; charset=utf-8", "If-None-Match": "*"})
        if r["status"] not in (201, 204):
            raise CalError("Terminerstellung wurde nicht bestätigt.")

    async def _event(self, calendar: str, obj: str, etag: str, title: str, start: str, attendees: list[str], series: bool) -> dict:
        cal = self._calendar(calendar)
        url = apple_url(obj)
        name = url[len(cal):] if url.startswith(cal) else ""
        if not re.fullmatch(r"[A-Za-z0-9._~-]+\.ics", name, re.I) or not re.fullmatch(r'"[^"\r\n]{1,256}"', etag):
            raise CalError("Terminadresse oder Version ungültig.")
        r = await self._request(url, "GET", "")
        if r["url"] != url or r["etag"] != etag:
            raise CalError("Termin wurde inzwischen geändert.")
        lines = [x for x in re.sub(r"\r\n[ \t]", "", r["text"]).split("\r\n") if x]
        if any(re.search(r"[\r\n\0]", x) for x in lines):
            raise CalError("Terminformat nicht unterstützt.")
        stack: list[str] = []
        events: list[dict] = []
        for i, line in enumerate(lines):
            begin, end = re.fullmatch(r"BEGIN:([A-Z0-9-]+)", line, re.I), re.fullmatch(r"END:([A-Z0-9-]+)", line, re.I)
            if begin:
                comp = begin[1].upper()
                if not stack and (comp != "VCALENDAR" or i != 0):
                    raise CalError("Ungültiger Kalender.")
                if comp == "VEVENT":
                    if stack != ["VCALENDAR"]:
                        raise CalError("Ungültiger Termin.")
                    events.append({"start": i, "end": -1, "indexes": []})
                stack.append(comp)
            elif end:
                comp = end[1].upper()
                if not stack or stack.pop() != comp:
                    raise CalError("Ungültiger Kalender.")
                if comp == "VEVENT":
                    events[-1]["end"] = i
                if not stack and i != len(lines) - 1:
                    raise CalError("Ungültiger Kalender.")
            elif len(stack) == 2 and stack[1] == "VEVENT":
                events[-1]["indexes"].append(i)
        if stack or not events or lines[0] != "BEGIN:VCALENDAR" or lines[-1] != "END:VCALENDAR" or any(e["end"] < e["start"] for e in events):
            raise CalError("Ungültiger Kalender.")

        def fields(ev: dict, key: str) -> list[str]:
            return [lines[i] for i in ev["indexes"] if re.match(rf"^{key}(?:;[^:]*)?:", lines[i], re.I)]
        masters = [e for e in events if not fields(e, "RECURRENCE-ID")]
        if len(masters) != 1:
            raise CalError("Terminserie hat keinen eindeutigen Haupttermin.")
        m = masters[0]
        if any(len(fields(m, k)) != 1 for k in ("UID", "SUMMARY", "DTSTART", "DTEND")):
            raise CalError("Termin ist nicht eindeutig.")
        uid = fields(m, "UID")[0]
        if any(len(fields(e, "UID")) != 1 or fields(e, "UID")[0] != uid for e in events):
            raise CalError("Terminserie ist nicht eindeutig.")
        is_series = len(events) > 1 or any(fields(e, k) for e in events for k in ("RRULE", "RDATE", "EXDATE", "RECURRENCE-ID"))
        if is_series != series:
            raise CalError("Serienumfang stimmt nicht mit der Freigabe überein.")
        found = [a for e in events for a in fields(e, "ATTENDEE")]
        if sorted(found) != sorted(attendees):
            raise CalError("Teilnehmer stimmen nicht mit der Freigabe überein.")
        for e in events:
            orgs = fields(e, "ORGANIZER")
            if len(orgs) > 1 or (len(orgs) == 1 and orgs[0][orgs[0].index(":") + 1:].lower() != f"mailto:{self.owner.lower()}") or (fields(e, "ATTENDEE") and not orgs):
                raise CalError("Nur eigene Termine werden unterstützt.")
        sl = fields(m, "SUMMARY")[0]
        summary = re.sub(r"\\[nN]", "\n", re.sub(r"\\([\\,;])", r"\1", sl[sl.index(":") + 1:]))
        if summary != title or fields(m, "DTSTART")[0] != start:
            raise CalError("Termin stimmt nicht mit der Freigabe überein.")
        return {"url": url, "lines": lines, "master": m, "fields": lambda k: fields(m, k), "series": is_series, "count": len(events),
                "rec_ids": [x for e in events if e is not m for x in fields(e, "RECURRENCE-ID")], "etag": etag}

    async def update(self, calendar, obj, etag, title, start, attendees, series, new_title: str, new_start: datetime, new_end: datetime) -> None:
        if not new_title.strip() or len(new_title) > 1000 or re.search(r"[\x00-\x1f\x7f]", new_title):
            raise CalError("Ungültiger Kalendertitel.")
        frm, to = utc(new_start), utc(new_end)
        if to <= frm:
            raise CalError("Ungültiger Zeitraum.")
        ev = await self._event(calendar, obj, etag, title, start, attendees, series)
        shifted_until, shifted = None, {}
        if ev["series"]:
            sline, eline = ev["fields"]("DTSTART")[0], ev["fields"]("DTEND")[0]
            unchanged = sline == f"DTSTART:{frm}" and eline == f"DTEND:{to}"
            rules = ev["fields"]("RRULE")
            parts = rules[0][6:].upper().split(";") if len(rules) == 1 and rules[0].upper().startswith("RRULE:") else []
            keys = [p.split("=")[0] for p in parts]
            simple = "FREQ" in keys and len(set(keys)) == len(keys) and not ("COUNT" in keys and "UNTIL" in keys) and all(RULE_PART.match(p) for p in parts)
            safe_time = (simple and not attendees and re.fullmatch(r"DTSTART:\d{8}T\d{6}Z", sline) and re.fullmatch(r"DTEND:\d{8}T\d{6}Z", eline)
                         and sline[8:16] == frm[:8] and eline[6:14] == to[:8])

            def valid_rec(line: str) -> bool:
                try:
                    return bool(re.fullmatch(r"RECURRENCE-ID:\d{8}T\d{6}Z", line)) and utc(parse_utc(line[14:])) == line[14:]
                except (ValueError, CalError):
                    return False
            safe_exc = (unchanged and simple and not attendees and len(ev["rec_ids"]) == ev["count"] - 1 and len(set(ev["rec_ids"])) == len(ev["rec_ids"])
                        and all(valid_rec(x) for x in ev["rec_ids"]))
            extra, excl = ev["fields"]("RDATE"), ev["fields"]("EXDATE")
            if (ev["count"] != 1 and (not safe_exc or extra)) or ev["fields"]("EXRULE") or (not unchanged and not safe_time):
                raise UnsupportedSeries("Diese Terminserie kann nicht sicher geändert werden.")
            until = next((p[6:] for p in parts if p.startswith("UNTIL=")), None)
            if not unchanged and (until or excl or extra):
                try:
                    prev = parse_utc(sline[8:])
                    delta = new_start - prev
                    if until:
                        last = parse_utc(until)
                        if last < prev:
                            raise ValueError
                        shifted_until = utc(last + delta)
                    for line in [*excl, *extra]:
                        mt = re.fullmatch(r"((?:EXDATE|RDATE)(?:;VALUE=DATE-TIME)?):((?:\d{8}T\d{6}Z)(?:,\d{8}T\d{6}Z)*)", line, re.I)
                        if not mt:
                            raise ValueError
                        vals = []
                        for v in mt[2].split(","):
                            new = utc(parse_utc(v) + delta)
                            if v[8:] != sline[16:] or new[:8] != v[:8]:
                                raise ValueError
                            vals.append(new)
                        shifted[line] = f"{mt[1]}:{','.join(vals)}"
                except (ValueError, CalError):
                    raise UnsupportedSeries("Diese Terminserie kann nicht sicher geändert werden.") from None
        summary = new_title.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
        idx = set(ev["master"]["indexes"])
        out = []
        for i, line in enumerate(ev["lines"]):
            if i not in idx:
                out.append(line)
            elif re.match(r"^SUMMARY(?:;[^:]*)?:", line, re.I):
                out.append(re.sub(r"^(SUMMARY(?:;[^:]*)?:).*$", lambda mm: mm[1] + summary, line, flags=re.I))
            elif re.match(r"^DTSTART(?:;[^:]*)?:", line, re.I):
                out.append(f"DTSTART:{frm}")
            elif re.match(r"^DTEND(?:;[^:]*)?:", line, re.I):
                out.append(f"DTEND:{to}")
            elif shifted_until and re.match(r"^RRULE:", line, re.I):
                out.append(re.sub(r"(UNTIL=)\d{8}T\d{6}Z", lambda mm: mm[1] + shifted_until, line, flags=re.I))
            else:
                out.append(shifted.get(line, line))
        r = await self._request(ev["url"], "PUT", fold(out), {"Content-Type": "text/calendar; charset=utf-8", "If-Match": etag})
        if r["status"] not in (200, 204):
            raise CalError("Änderung wurde nicht bestätigt.")

    async def delete(self, calendar, obj, etag, title, start, attendees, series) -> None:
        ev = await self._event(calendar, obj, etag, title, start, attendees, series)
        r = await self._request(ev["url"], "DELETE", "", {"If-Match": etag})
        if r["status"] not in (200, 204):
            raise CalError("Löschung wurde nicht bestätigt.")

    async def invite(self, calendar, obj, etag, title, start, recipient, attendees, series) -> None:
        if not MAIL.match(recipient) or len(recipient) > 254 or not MAIL.match(self.owner):
            raise CalError("Ungültige E-Mail-Adresse.")
        ev = await self._event(calendar, obj, etag, title, start, attendees, series)
        if ev["series"] and (ev["count"] != 1 or len(ev["fields"]("RRULE")) != 1 or any(ev["fields"](k) for k in ("RDATE", "EXDATE", "EXRULE"))):
            raise UnsupportedSeries("Einladungen zu dieser Terminserie werden noch nicht unterstützt.")
        orgs = ev["fields"]("ORGANIZER")
        if any(a[a.index(":") + 1:].lower() == f"mailto:{recipient.lower()}" for a in ev["fields"]("ATTENDEE")):
            raise CalError("Person ist bereits eingeladen.")
        insert = [*([] if orgs else [f"ORGANIZER:mailto:{self.owner}"]), f"ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:{recipient}"]
        end = ev["master"]["end"]
        r = await self._request(ev["url"], "PUT", fold([*ev["lines"][:end], *insert, *ev["lines"][end:]]), {"Content-Type": "text/calendar; charset=utf-8", "If-Match": etag})
        if r["status"] not in (200, 204):
            raise CalError("Änderung wurde nicht bestätigt.")


# ---------------------------------------------------------------- Zugang und Prüfung
def _credentials(data) -> tuple[str, str] | None:
    if isinstance(data, dict) and isinstance(data.get("appleId"), str) and isinstance(data.get("appPassword"), str) and 0 < len(data["appleId"]) <= 320 and PASSWORD.match(data["appPassword"]):
        return data["appleId"], data["appPassword"]
    return None


async def verify(body: dict) -> dict:
    creds = _credentials(body)
    if not creds:
        raise Fail("Apple-ID oder app-spezifisches Passwort ist ungültig.")
    try:
        return {"ok": True, "count": len(await ICloud(*creds).discover())}
    except CalError:
        raise Fail("iCloud-Kalender konnte nicht verbunden werden. Prüfe Anmeldung und Netzwerk.") from None


async def _client() -> tuple[ICloud, list[dict]]:
    try:
        creds = _credentials(json.loads(await keychain.get_item(*KEYCHAIN) or ""))
    except ValueError:
        creds = None
    if not creds:
        raise Fail("Apple Kalender ist nicht verbunden oder der Schlüsselbund ist gesperrt.")
    try:
        c = ICloud(*creds)
        return c, await c.discover()
    except CalError:
        raise Fail("Apple Kalender konnte nicht gelesen werden. Prüfe Verbindung und Anmeldung.") from None


async def _calendar(name: str) -> tuple[ICloud, str]:
    c, cals = await _client()
    hit = [x for x in cals if x["name"] == name]
    if len(hit) != 1:
        raise Fail("Kalendername ist nicht eindeutig oder nicht vorhanden.")
    return c, hit[0]["url"]


def _dt(value: str) -> datetime:
    try:
        d = datetime.fromisoformat(value)
    except (ValueError, TypeError):
        raise Fail("Ungültiges Datum. Erwartet ISO 8601 mit Zeitzone.") from None
    if d.tzinfo is None:
        raise Fail("Ungültiges Datum. Erwartet ISO 8601 mit Zeitzone.")
    return d


_s = lambda n=1000: {"type": "string", "minLength": 1, "maxLength": n}
_when = {"type": "string", "minLength": 10, "maxLength": 40, "description": "ISO 8601 with offset, e.g. 2026-11-12T09:00:00+01:00"}
_event = {"calendar": _s(200), "url": _s(2048), "etag": {"type": "string", "minLength": 2, "maxLength": 258}, "eventTitle": _s(), "eventStart": _s(500),
          "attendees": {"type": "array", "items": _s(2000), "maxItems": 200}, "series": {"type": "boolean"}}
_event_required = list(_event)
_FROM_LIST = "Use URL, ETag, old title, DTSTART, all ATTENDEE lines and series scope exactly as apple_calendar_list returned them. "


def _guard(fn):
    """CalError -> deutscher Aktionsfehler ohne Einzelheiten."""
    async def wrapper(run, args):
        try:
            return await fn(run, args)
        except UnsupportedSeries as e:
            raise Fail("Diese Terminserie kann nicht sicher bearbeitet werden. Bitte bearbeite sie im Kalender.") from e
        except CalError:
            raise Fail("Der Kalender hat die Anfrage nicht bestätigt. Prüfe zuerst den Kalender, bevor du es erneut versuchst.") from None
    wrapper.__name__ = fn.__name__
    return wrapper


@tool("apple_calendar_list", "Read events of all connected iCloud calendars between start and end (max 366 days). An entry with event=null is an empty calendar.",
      {"type": "object", "properties": {"start": _when, "end": _when}, "required": ["start", "end"]}, label=lambda a: "Liest deinen Kalender")
@_guard
async def calendar_list(run, args):
    start, end = _dt(args["start"]), _dt(args["end"])
    if start >= end:
        raise Fail("Der Beginn muss vor dem Ende liegen.")
    run.counters["untrusted"] = True  # Einladungen schreiben Fremde: zählt wie Daten von außen
    c, cals = await _client()
    if len(cals) > 100:
        raise Fail("Zu viele Kalender. Der Abruf ist unvollständig.")
    entries, size = [], 0
    for cal in cals:
        events = await c.query(cal["url"], start, end)
        rows = [{"calendar": cal["name"], "event": e} for e in events] or [{"calendar": cal["name"], "event": None}]
        size += len(json.dumps(rows))
        if len(entries) + len(rows) > 5000 or size > 4_000_000:
            raise Fail("Kalenderergebnis ist zu groß und unvollständig. Bitte Zeitraum eingrenzen.")
        entries += rows
    return {"start": args["start"], "end": args["end"], "entries": entries, "complete": True}


_new = {"title": _s(), "start": _when, "end": _when}


@tool("apple_calendar_create", "Create one own event in the named iCloud calendar, without invitations. For several events always use apple_calendar_create_many.",
      {"type": "object", "properties": {"calendar": _s(200), **_new}, "required": ["calendar", "title", "start", "end"]}, label=lambda a: f"Legt Termin an: {a.get('title', '')[:60]}")
@_guard
async def calendar_create(run, args):
    c, url = await _calendar(args["calendar"])
    await c.create(url, args["title"], _dt(args["start"]), _dt(args["end"]))
    return {"ok": True, "message": "Termin wurde angelegt."}


@tool("apple_calendar_create_many", "Create up to 100 own events in one step in the named iCloud calendar, without invitations. All-day: start and end at midnight (end = next day).",
      {"type": "object", "properties": {"calendar": _s(200), "events": {"type": "array", "minItems": 1, "maxItems": 100,
                                        "items": {"type": "object", "properties": _new, "required": ["title", "start", "end"]}}}, "required": ["calendar", "events"]},
      label=lambda a: f"Legt {len(a.get('events', []))} Termine an")
@_guard
async def calendar_create_many(run, args):
    c, url = await _calendar(args["calendar"])
    done, failed = 0, []
    for i, e in enumerate(args["events"]):
        try:
            await c.create(url, e["title"], _dt(e["start"]), _dt(e["end"]))
            done += 1
        except (CalError, Fail):
            failed.append(i)
    if failed:
        return {"ok": False, "created": done, "failedIndexes": failed,
                "message": "Nicht alle Termine konnten bestätigt werden. Bitte zuerst im Kalender prüfen, bevor du die fehlenden erneut anlegst."}
    return {"ok": True, "created": done, "message": f"{done} Termine wurden angelegt."}


def _ev(a: dict) -> tuple:
    return a["url"], a["etag"], a["eventTitle"], a["eventStart"], a["attendees"], a["series"]


@tool("apple_calendar_update", "Change an own event or a simple UTC series. " + _FROM_LIST,
      {"type": "object", "properties": {**_event, **_new}, "required": [*_event_required, "title", "start", "end"]}, label=lambda a: f"Ändert Termin: {a.get('eventTitle', '')[:60]}")
@_guard
async def calendar_update(run, args):
    c, url = await _calendar(args["calendar"])
    await c.update(url, *_ev(args), args["title"], _dt(args["start"]), _dt(args["end"]))
    return {"ok": True, "message": "Termin wurde geändert."}


def _delete_risk(run, args):
    return Risk("loeschen", "apple_calendar_delete", f"Löscht Termin „{args.get('eventTitle', '?')}“ in „{args.get('calendar', '?')}“"[:120],
                f"Kalender: {args.get('calendar', '?')}\nTermin: {args.get('eventTitle', '?')}\nBeginn: {args.get('eventStart', '?')}\nUmfang: {'gesamte Terminserie' if args.get('series') else 'einzelner Termin'}")


@tool("apple_calendar_delete", "Delete an own event or a whole series. For several events use apple_calendar_delete_many. " + _FROM_LIST,
      {"type": "object", "properties": _event, "required": _event_required}, label=lambda a: f"Löscht Termin: {a.get('eventTitle', '')[:60]}", risk=_delete_risk)
@_guard
async def calendar_delete(run, args):
    c, url = await _calendar(args["calendar"])
    await c.delete(url, *_ev(args))
    return {"ok": True, "message": "Termin wurde gelöscht."}


def _delete_many_risk(run, args):
    events = args.get("events") or []
    titles = "\n".join(f"{e.get('calendar', '?')}: {e.get('eventTitle', '?')} ({e.get('eventStart', '?')})" for e in events[:20] if isinstance(e, dict))
    return Risk("loeschen", "apple_calendar_delete_many", f"Löscht {len(events)} Termine im Kalender", titles)


@tool("apple_calendar_delete_many", "Delete up to 100 own events in one step. Per entry: " + _FROM_LIST,
      {"type": "object", "properties": {"events": {"type": "array", "minItems": 1, "maxItems": 100, "items": {"type": "object", "properties": _event, "required": _event_required}}},
       "required": ["events"]}, label=lambda a: f"Löscht {len(a.get('events', []))} Termine", risk=_delete_many_risk)
@_guard
async def calendar_delete_many(run, args):
    c, cals = await _client()
    deleted, failed = 0, []
    for i, e in enumerate(args["events"]):
        try:
            hit = [x for x in cals if x["name"] == e["calendar"]]
            if len(hit) != 1:
                raise CalError("Kalender")
            await c.delete(hit[0]["url"], *_ev(e))
            deleted += 1
        except CalError:
            failed.append(i)
    if failed:
        return {"ok": False, "deleted": deleted, "failedIndexes": failed, "message": "Nicht alle Löschungen konnten bestätigt werden. Prüfe zuerst den Kalender."}
    return {"ok": True, "deleted": deleted, "message": f"{deleted} Termine wurden gelöscht."}


def _invite_risk(run, args):
    att = args.get("attendees") or []
    return Risk("nachricht", "apple_calendar_invite", f"Lädt ein zu Termin „{args.get('eventTitle', '?')}“ in „{args.get('calendar', '?')}“"[:120],
                f"Kalender: {args.get('calendar', '?')}\nTermin: {args.get('eventTitle', '?')}\nBisheriger Beginn: {args.get('eventStart', '?')}\n"
                f"Umfang: {'gesamte Terminserie' if args.get('series') else 'einzelner Termin'}\nBisherige Teilnehmer: {'; '.join(att) if att else 'keine'}"
                f"{chr(10) + 'Bestehende Teilnehmer können eine Benachrichtigung erhalten.' if att else ''}\nEmpfänger: {args.get('recipient', '?')}")


@tool("apple_calendar_invite", "Invite one person to an own event or a whole series without exceptions. " + _FROM_LIST,
      {"type": "object", "properties": {**_event, "recipient": {"type": "string", "minLength": 3, "maxLength": 254}}, "required": [*_event_required, "recipient"]},
      label=lambda a: f"Lädt ein zu: {a.get('eventTitle', '')[:60]}", risk=_invite_risk)
@_guard
async def calendar_invite(run, args):
    c, url = await _calendar(args["calendar"])
    u, e, t, s, att, series = _ev(args)
    await c.invite(url, u, e, t, s, args["recipient"], att, series)
    return {"ok": True, "message": "Einladung wurde beim Kalender eingereicht."}
