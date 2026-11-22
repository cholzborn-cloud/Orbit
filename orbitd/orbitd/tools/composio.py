"""Composio-Plugins (REST gegen backend.composio.dev, kein SDK) und die Orbi-Werkzeuge connector_plugins__search/_execute.

Vorlage: service/src/plugins.ts, service/src/plugin-categories.ts, classifyConnector aus lib/approvals/risk.ts.
Zugang liegt im Schlüsselbund (Dienst de.consti.orbit.composio, Konto local, JSON {key,user}); er wird nie geloggt oder zurückgegeben.
"""
import asyncio
import hashlib
import json
import os
import re
import secrets
import time
from pathlib import Path
from urllib.parse import urlencode, urlparse

import httpx
from jsonschema import Draft202012Validator

from .. import keychain
from ..config import REAL_DATA_DIR, profile_id
from ..db import loads
from ..runtime.contract import Risk, tool
from ..web import Fail

API = "https://backend.composio.dev/api/v3.1"
KEYCHAIN = ("de.consti.orbit.composio", "local")
SLUG = re.compile(r"^[a-z0-9_]{1,80}$")
ACCOUNT_ID = re.compile(r"^[a-zA-Z0-9_-]{1,150}$")
ACTION_SLUG = re.compile(r"^[A-Z][A-Z0-9_]{1,149}$")
VERSION = re.compile(r"^[A-Za-z0-9_-]{1,100}$")
FIELD_NAME = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$")
CONNECT_HOSTS = ("connect.composio.dev", "app.composio.dev")
OAUTH_REDIRECTS = ("https://backend.composio.dev/api/v3/toolkits/auth/callback", "https://backend.composio.dev/api/v3.1/toolkits/auth/callback",
                   "https://backend.composio.dev/api/v1/auth-apps/add")
# Anmeldearten, bei denen die Zugangsdaten nur auf der Composio-Seite im Browser eingegeben werden (live geprüft 09.11.2026).
HOSTED_SCHEMES = ["API_KEY", "BEARER_TOKEN", "BASIC", "DCR_OAUTH", "S2S_OAUTH2"]
STATUS_KEYS = {"toolsEnabled": False, "toolsStatus": "not_checked", "accessMode": "individual_actions"}


class PluginError(Fail):
    pass


# ---------------------------------------------------------------- Kategorien (service/src/plugin-categories.ts)
GROUPS = [("kommunikation", "Kommunikation"), ("produktivitaet", "Produktivität"), ("entwicklung", "Entwicklung & KI"), ("daten", "Daten & Analyse"),
          ("business", "Vertrieb & Marketing"), ("finanzen", "Finanzen & Shop"), ("medien", "Medien & Freizeit")]
FALLBACK = "medien"
_RAW = {
    "kommunikation": "collaboration-&-communication communication team-chat team-collaboration phone-&-sms video-conferencing notifications webinars email email-newsletters transactional-email drip-emails calendar scheduling-&-booking",
    "produktivitaet": "productivity productivity-&-project-management project-management task-management notes spreadsheets time-tracking-software bookmark-managers product-management dashboards documents documents-&-ocr content-&-files file-management-&-storage signatures ai-document-extraction forms-&-surveys hr-talent-&-recruitment human-resources education online-courses event-management",
    "entwicklung": "developer-tools it-operations server-monitoring databases app-builder website-&-app-building website-builders security-&-identity-tools model-context-protocol internet-of-things ai-safety-compliance-detection artificial-intelligence ai-agents ai-models ai-content-generation ai-chatbots ai-assistants ai-meeting-assistants transcription audio-&-speech",
    "daten": "analytics analytics-&-data business-intelligence market-data company-data people-&-contact-data web-scraping-&-browser ai-web-scraping web-search-&-research seo-&-ai-visibility legal-&-public-records social-&-creator-data",
    "business": "crm sales-&-crm sales-&-customer-support ai-sales-tools contact-management customer-support support ticketing call-tracking reviews customer-appreciation marketing marketing-automation marketing-&-social-media social-media-marketing social-media-accounts ads-&-conversion url-shortener",
    "finanzen": "accounting payment-processing proposal-&-invoice-management ecommerce commerce fundraising taxes",
    "medien": "images-&-design video-&-audio media-generation video-generation lifestyle-&-entertainment news-&-lifestyle places-&-weather gaming fitness",
}
BY_RAW = {raw: group for group, raws in _RAW.items() for raw in raws.split()}
WEAK = {"developer-tools", "model-context-protocol"}  # hängt Composio an fast jeden Dienst: zählt nur, wenn sonst nichts passt
RECOMMENDED = ("gmail googlecalendar outlook slack notion googledrive googledocs googlesheets github linear jira trello asana todoist clickup hubspot "
               "salesforce stripe discord zoom figma airtable dropbox canva spotify supabase telegram whatsapp twitter linkedin").split()
SEARCH_DE = [("kalender", "calendar"), ("termin", "calendar"), ("mail", "email"), ("aufgabe", "task"), ("notiz", "note"), ("nachricht", "message"),
             ("zahlung", "payment"), ("rechnung", "invoice"), ("kunde", "customer"), ("dokument", "document"), ("tabelle", "spreadsheet"), ("datei", "file"),
             ("projekt", "project"), ("buchhaltung", "accounting"), ("werbung", "ads"), ("bild", "image"), ("musik", "music"), ("umfrage", "survey"),
             ("personal", "hr"), ("bewerb", "recruit"), ("sicherheit", "security"), ("datenbank", "database"), ("speicher", "storage"), ("unterschrift", "signature")]


def groups_of(raw: list[dict]) -> list[dict]:
    def mapped(items):
        return {BY_RAW.get(c["id"], "" if c["id"] == "popular" else FALLBACK) for c in items} - {""}
    ids = mapped([c for c in raw if c["id"] not in WEAK])
    if len(ids) > 1 or (len(ids) == 1 and FALLBACK not in ids):
        ids.discard(FALLBACK)
    ids = ids or mapped(raw) or {FALLBACK}
    return [{"id": i, "name": n} for i, n in GROUPS if i in ids]


def search_terms(search: str) -> list[str]:
    q = search.strip().lower()
    return [q, *[en for de, en in SEARCH_DE if de in q]] if q else []


# ---------------------------------------------------------------- Prüfer für Antworten (Composio-Daten sind Fremddaten)
def https_url(value) -> str | None:
    try:
        u = urlparse(value)
        return value if u.scheme == "https" and u.hostname and not u.username and not u.password and u.port is None else None
    except (ValueError, TypeError, AttributeError):
        return None


def _strs(value) -> list[str]:
    return [s[:4000] for s in value if isinstance(s, str)] if isinstance(value, list) else []


def _toolkit(raw) -> dict | None:
    if not isinstance(raw, dict) or not isinstance(raw.get("slug"), str) or not SLUG.match(raw["slug"]):
        return None
    meta = raw.get("meta") if isinstance(raw.get("meta"), dict) else {}
    cats = [{"id": str(c.get("id") or c.get("slug") or c["name"]), "name": c["name"]} for c in meta.get("categories") or []
            if isinstance(c, dict) and isinstance(c.get("name"), str)]
    return {"slug": raw["slug"], "name": str(raw.get("name") or raw["slug"])[:4000], "auth_schemes": _strs(raw.get("auth_schemes")),
            "managed": _strs(raw.get("composio_managed_auth_schemes")), "no_auth": raw.get("no_auth") is True,
            "description": str(meta.get("description") or "")[:4000], "logo": meta.get("logo"), "categories": cats}


def _account(raw) -> dict | None:
    if not isinstance(raw, dict) or not isinstance(raw.get("id"), str) or not ACCOUNT_ID.match(raw["id"]):
        return None
    tk = raw.get("toolkit")
    if not isinstance(tk, dict) or not isinstance(tk.get("slug"), str) or not SLUG.match(tk["slug"]):
        return None
    return {"id": raw["id"], "user_id": str(raw.get("user_id", "")), "status": str(raw.get("status", "")), "toolkit": tk["slug"], "disabled": raw.get("is_disabled") is True}


def _items(data) -> tuple[list, str | None]:
    if not isinstance(data, dict) or not isinstance(data.get("items"), list) or len(data["items"]) > 1000:
        raise PluginError("Composio liefert eine unerwartete Antwort.")
    cursor = data.get("next_cursor")
    return data["items"], cursor if isinstance(cursor, str) and cursor else None


def _status_of(accounts: list[dict]) -> str:
    if any(a["status"] == "ACTIVE" and not a["disabled"] for a in accounts):
        return "connected"
    return "pending" if any(a["status"] in ("INITIATED", "INITIALIZING") for a in accounts) else "not_connected"


def _managed_oauth(t: dict) -> bool:
    return any(s.lower() == "oauth2" for s in t["managed"])


def _hosted(t: dict) -> str | None:
    return next((s for s in HOSTED_SCHEMES if any(a.upper() == s for a in t["auth_schemes"])), None)


def _auth_mode(t: dict) -> str:
    return "managed_oauth" if _managed_oauth(t) else "hosted" if _hosted(t) else "setup_required"


def _fields(group, required_only=False) -> list[dict]:
    out = []
    if isinstance(group, dict):
        for key, req in (("required", True), ("optional", False)):
            for f in group.get(key) or []:
                if not (isinstance(f, dict) and isinstance(f.get("name"), str) and FIELD_NAME.match(f["name"]) and isinstance(f.get("type"), str)):
                    continue
                if not req and f.get("user_visible") is False:
                    continue
                out.append({"name": f["name"], "label": f.get("displayName") or f["name"], "type": f["type"].lower(), "required": req,
                            "secret": f.get("is_secret") is not False or bool(re.search(r"secret|password|token|key", f["name"], re.I)),
                            "description": str(f.get("description") or ""), "_hidden": req and f.get("user_visible") is False})
    return out


def _setup_schemes(details: dict) -> list[dict]:
    modes = []
    for mode in details["_modes"][:30]:
        if not isinstance(mode, dict) or not isinstance(mode.get("mode"), str):
            continue
        fields = mode.get("fields") if isinstance(mode.get("fields"), dict) else {}
        create = _fields(fields.get("auth_config_creation"))
        names = [f["name"] for f in create]
        supported = (mode["mode"].upper() in ("API_KEY", "BEARER_TOKEN", "BASIC", "OAUTH2") and isinstance(fields.get("auth_config_creation"), dict)
                     and all(f["type"] in ("string", "number", "integer", "boolean") for f in create)
                     and not any(f["_hidden"] for f in create) and len(set(names)) == len(names))
        entry = {"scheme": mode["mode"].upper(), "supported": supported, "configFields": [{k: v for k, v in f.items() if k != "_hidden"} for f in create],
                 "connectionFields": [{k: v for k, v in f.items() if k != "_hidden"} for f in _fields(fields.get("connected_account_initiation"))],
                 "requiredScopes": _strs(mode.get("required_scopes"))}
        if not supported:
            entry["reason"] = "Diese Einrichtung hat unvollständige oder nicht unterstützte Felder. Anbieter-Anleitung verwenden."
        modes.append(entry)
    if details["no_auth"] and not any(m["scheme"] == "NO_AUTH" for m in modes):
        modes.append({"scheme": "NO_AUTH", "supported": False, "configFields": [], "connectionFields": [], "requiredScopes": [],
                      "reason": "Dienste ohne Anmeldung sind in Orbit noch nicht verfügbar."})
    return modes


def normalize_schema(params) -> dict | None:
    """v3.1 liefert teils Feld-Karten mit `required: bool` je Feld statt eines Schemas."""
    if not isinstance(params, dict):
        return None
    if params.get("type") == "object" and isinstance(params.get("properties"), dict):
        return params
    if "type" in params or "$ref" in params:
        return None
    props, required = {}, []
    for name, value in params.items():
        if not isinstance(value, dict) or value.get("type") not in ("string", "number", "integer", "boolean", "array", "object", "null"):
            return None
        if value.get("required") not in (None, True, False):
            return None
        field = {k: v for k, v in value.items() if k != "required"}
        if value.get("required") is True:
            required.append(name)
        props[name] = field
    return {"type": "object", "properties": props, "required": required, "additionalProperties": False}


def _action(raw) -> dict | None:
    if not isinstance(raw, dict) or not isinstance(raw.get("slug"), str) or not ACTION_SLUG.match(raw["slug"]):
        return None
    tk, params = raw.get("toolkit"), raw.get("input_parameters")
    if not (isinstance(tk, dict) and isinstance(tk.get("slug"), str) and SLUG.match(tk["slug"]) and isinstance(params, dict)):
        return None
    dep = raw.get("deprecated") if isinstance(raw.get("deprecated"), dict) else {}
    version = next((v for v in (raw.get("version"), dep.get("version")) if isinstance(v, str) and VERSION.match(v)), None)
    return {"slug": raw["slug"], "toolkit": tk["slug"], "description": str(raw.get("description") or "")[:4000], "params": params,
            "tags": _strs(raw.get("tags")), "deprecated": raw.get("is_deprecated") is True, "version": version}


def read_only(tags: list[str]) -> bool:
    return "readOnlyHint" in tags and not any(t in tags for t in ("createHint", "updateHint", "destructiveHint"))


# ---------------------------------------------------------------- Einstufung (classifyConnector)
# Freigabe nur noch bei geld/nachricht/login (Tor in interactions.gate). Veröffentlichen zählt als nachricht.
NAME_RULES = [
    ("login", ["login", "oauth", "authorize", "connect_account", "link_account", "auth_connect"]),
    ("geld", ["pay", "purchase", "buy", "checkout", "order", "subscribe", "transfer", "charge", "refund", "invoice_send"]),
    ("nachricht", ["send", "reply", "forward", "message", "comment", "invite", "email", "dm", "notify", "respond",
                   "publish", "post", "tweet", "deploy", "release", "share_public", "make_public", "go_live"]),
]
READ_VERBS = {"get", "list", "search", "read", "fetch", "find", "query", "view", "lookup", "describe", "count"}
REASON_TEXT = {"geld": "Gibt Geld aus", "nachricht": "Sendet oder veröffentlicht in deinem Namen",
               "login": "Verbindet ein Konto"}


WRITE_WORDS = {"run", "execute", "exec", "create", "update", "insert", "upsert", "write", "modify", "patch", "set", "add", "archive", "move",
               "rename", "merge", "import", "upload", "mutation", "sql", "and", "or"}


def _parts(name: str, toolkit: str = "") -> list[str]:
    """Wörter des Aktionsnamens ohne das Dienst-Präfix (GMAIL_FETCH_EMAILS -> fetch, emails)."""
    parts = [p for p in re.split(r"[^a-z0-9]+", re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name).lower()) if p]
    prefix = [p for p in re.split(r"[^a-z0-9]+", toolkit.lower()) if p]
    return parts[len(prefix):] if prefix and parts[:len(prefix)] == prefix else parts


def reads_only(name: str, toolkit: str = "") -> bool:
    """Sicher lesend nur, wenn das Verb (erstes Wort nach dem Dienst) ein Lese-Wort ist und kein Schreib-Wort vorkommt (RUN_SQL_QUERY liest nicht sicher)."""
    parts = _parts(name, toolkit)
    return bool(parts) and parts[0] in READ_VERBS and not (set(parts) & WRITE_WORDS)


def name_reason(name: str, toolkit: str = "") -> str | None:
    joined = "_" + "_".join(_parts(name)) + "_"
    for reason, patterns in NAME_RULES:
        if any(f"_{p}_" in joined for p in patterns) and (reason == "login" or not reads_only(name, toolkit)):
            return reason
    return None


def _recipients(args: dict) -> list[str]:
    out = []
    for key in ("to", "cc", "bcc", "recipient", "recipients", "channel", "email"):
        v = args.get(key)
        for item in v if isinstance(v, list) else [v]:
            if isinstance(item, str):
                out += [x.strip() for x in re.split(r"[,;]", item) if x.strip()]
    return out


def classify(toolkit: str, action: str, tags: list[str], args: dict) -> Risk | None:
    if read_only(tags) or (toolkit == "gmail" and action == "GMAIL_CREATE_EMAIL_DRAFT"):
        return None
    reason = name_reason(action, toolkit)
    if not reason:
        return None  # kein Freigabe-Grund: läuft ohne Karte
    to = ", ".join(_recipients(args)) if reason == "nachricht" else ""
    text = f"{REASON_TEXT[reason]}{' an ' + to if to else ''} über {toolkit} ({action})"
    detail = "\n".join(f"{k}: {json.dumps(v, ensure_ascii=False)[:200]}" for k, v in list(args.items())[:10]) or None
    return Risk(reason, f"connector:composio-{toolkit}:{action}", text[:120], detail)


# ---------------------------------------------------------------- Dienst
def _toolkit_cache_path() -> Path:
    """Disk-Cache neben den Orbit-Daten (auch in Tests über ORBIT_DATA_DIR)."""
    root = Path(os.environ.get("ORBIT_DATA_DIR") or REAL_DATA_DIR)
    return root / "cache" / "composio-toolkits.json"


class Composio:
    def __init__(self, transport: httpx.AsyncBaseTransport | None = None, creds: tuple[str, str] | None = None):
        self.transport, self._fixed = transport, creds   # Tests setzen transport (httpx.MockTransport)
        self._cred: tuple[tuple[str, str] | None, float] | None = None
        self._catalog: tuple[list, float, str] | None = None
        self._accounts: tuple[list, float, str] | None = None  # Konten kurz merken (60 s)
        self._configs: dict[str, str] = {}
        self._sessions: dict[str, tuple[str, float]] = {}
        self.handles: dict[str, dict] = {}
        self._refreshing = False

    def reload(self) -> None:
        self._cred = self._catalog = self._accounts = None
        self.handles.clear()
        self._sessions.clear()
        self._configs.clear()

    async def _identity(self) -> tuple[str, str]:
        if self._fixed:
            return self._fixed
        if not self._cred or self._cred[1] < time.monotonic():
            profile = profile_id()
            if profile:
                key = await keychain.composio_project_key()
                cred = (key, f"orbit-{profile}") if key else None
            else:
                # wie der alte Dienst: zuerst der Composio-API-Schlüssel samt Nutzerkennung (aus secrets.env übernommen), sonst der Eintrag aus der App
                key, user = await keychain.get("COMPOSIO_API_KEY"), await keychain.get("COMPOSIO_USER_ID")
                cred = (key, user) if key and user else None
                try:
                    data = {} if cred else json.loads(await keychain.get_item(*KEYCHAIN) or "")
                    if isinstance(data, dict) and all(isinstance(data.get(k), str) and data[k].strip() for k in ("key", "user")):
                        cred = (data["key"], data["user"])
                except ValueError:
                    pass
            self._cred = (cred, time.monotonic() + 30)
        if not self._cred[0]:
            raise PluginError("Composio ist noch nicht eingerichtet. Projekt-Schlüssel und eindeutige Nutzerkennung fehlen.")
        return self._cred[0]

    async def configured(self) -> bool:
        try:
            await self._identity()
            return True
        except PluginError:
            return False

    async def _request(self, path: str, body=None, method: str | None = None):
        key, _ = await self._identity()
        try:
            async with httpx.AsyncClient(transport=self.transport, timeout=10, follow_redirects=False) as http:
                r = await http.request(method or ("GET" if body is None else "POST"), API + path, headers={"x-api-key": key}, json=body)
        except httpx.HTTPError:
            raise PluginError("Plugin-Dienst nicht erreichbar. Bitte später erneut versuchen.") from None
        if r.status_code >= 300:
            raise PluginError("Composio-Zugang oder Berechtigung fehlt." if r.status_code in (401, 403) else
                              "Composio hat zu viele Anfragen erhalten. Bitte später erneut versuchen." if r.status_code == 429 else
                              "Composio konnte die Anfrage nicht abschließen.")
        if len(r.content) > 4 * 1024 * 1024:
            raise PluginError("Composio-Antwort ist zu groß.")
        try:
            return r.json()
        except ValueError:
            raise PluginError("Composio liefert keine Antwort.") from None

    async def accounts(self, slug: str | None = None) -> list[dict]:
        _, user = await self._identity()
        if slug is None and self._accounts and self._accounts[1] > time.monotonic() and self._accounts[2] == user:
            return self._accounts[0]
        query = {"user_ids": user, "limit": "100", "account_type": "PRIVATE", **({"toolkit_slugs": slug} if slug else {})}
        out, seen = [], set()
        while True:
            items, cursor = _items(await self._request(f"/connected_accounts?{urlencode(query)}"))
            out += [a for a in map(_account, items) if a and a["user_id"] == user and (not slug or a["toolkit"] == slug)]
            if not cursor:
                if slug is None:
                    self._accounts = (out, time.monotonic() + 60, user)
                return out
            if cursor in seen or len(seen) >= 100:
                raise PluginError("Composio-Kontenliste ist unvollständig.")
            seen.add(cursor)
            query["cursor"] = cursor

    def _read_disk(self, key: str) -> list[dict] | None:
        path = _toolkit_cache_path()
        try:
            raw = json.loads(path.read_text("utf-8"))
        except (OSError, ValueError):
            return None
        if not (isinstance(raw, dict) and raw.get("key") == key and isinstance(raw.get("items"), list)
                and isinstance(raw.get("saved_at"), (int, float)) and time.time() - raw["saved_at"] < 86400):
            return None
        items = [t for t in raw["items"] if isinstance(t, dict) and isinstance(t.get("slug"), str)]
        return items or None

    def _write_disk(self, key: str, items: list[dict]) -> None:
        path = _toolkit_cache_path()
        try:
            path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            tmp = path.with_suffix(".tmp")
            tmp.write_text(json.dumps({"key": key, "saved_at": time.time(), "items": items}, ensure_ascii=False), "utf-8")
            tmp.replace(path)
        except OSError:
            pass

    async def _fetch_toolkits(self) -> list[dict]:
        items, seen, cursor = [], set(), None
        for _ in range(60):
            page, cursor = _items(await self._request("/toolkits?" + urlencode({"limit": "100", "sort_by": "alphabetically", "include_deprecated": "false", **({"cursor": cursor} if cursor else {})})))
            items += [t for t in map(_toolkit, page) if t]
            if not cursor:
                break
            if cursor in seen:
                raise PluginError("Composio-Katalog ist unvollständig.")
            seen.add(cursor)
        return list({t["slug"]: t for t in reversed(items)}.values())[::-1]

    async def toolkits(self) -> list[dict]:
        """Katalog: Speicher 15 Min, Disk bis 24 h. Frischer Disk-Stand liefert sofort, Nachladen im Hintergrund."""
        key = hashlib.sha256((await self._identity())[0].encode()).hexdigest()
        if self._catalog and self._catalog[1] > time.monotonic() and self._catalog[2] == key:
            return self._catalog[0]
        disk = self._read_disk(key)
        if disk is not None:
            self._catalog = (disk, time.monotonic() + 900, key)
            if not self._refreshing:
                self._refreshing = True
                asyncio.create_task(self._refresh_toolkits(key))
            return disk
        unique = await self._fetch_toolkits()
        self._catalog = (unique, time.monotonic() + 900, key)
        self._write_disk(key, unique)
        return unique

    async def _refresh_toolkits(self, key: str) -> None:
        try:
            unique = await self._fetch_toolkits()
            if self._catalog and self._catalog[2] == key:
                self._catalog = (unique, time.monotonic() + 900, key)
                self._write_disk(key, unique)
        except PluginError:
            pass
        finally:
            self._refreshing = False

    async def verify(self, body: dict) -> None:
        key, user = body.get("key"), body.get("user")
        if not (isinstance(key, str) and 0 < len(key) <= 4096 and isinstance(user, str) and ACCOUNT_ID.match(user)):
            raise PluginError("Composio-Zugang ist ungültig.")
        try:
            await Composio(self.transport, (key, user))._request("/toolkits?limit=1")
        except PluginError:
            raise PluginError("Composio-Zugang konnte nicht geprüft werden.") from None

    async def catalog(self, q: dict) -> dict:
        if not await self.configured():
            return {"ok": True, "configured": False, "entries": [], "nextCursor": None, "totalItems": 0, "categories": [], "recommendedCount": 0}
        try:
            limit = int(q.get("limit", 100))
        except ValueError:
            limit = 0
        offset_text = q.get("cursor") or "0"
        if not 1 <= limit <= 100 or len(q.get("search", "")) > 200 or len(q.get("category", "")) > 100 or q.get("connected", "true") not in ("true", "false"):
            raise PluginError("Suche oder Seitenangabe ist ungültig.")
        if not re.fullmatch(r"\d{1,6}", offset_text):
            raise PluginError("Ungültige Seitenangabe.")
        accounts = None
        try:
            accounts = await self.accounts()
        except PluginError:
            pass  # Status bleibt „unavailable“
        everything = await self.toolkits()
        groups = {t["slug"]: groups_of(t["categories"]) for t in everything}
        counts: dict[str, int] = {}
        for lst in groups.values():
            for g in lst:
                counts[g["id"]] = counts.get(g["id"], 0) + 1
        categories = [{"id": i, "name": n, "count": counts[i]} for i, n in GROUPS if i in counts]
        search, category, connected = q.get("search", "").strip().lower(), q.get("category", ""), q.get("connected") == "true"
        pool = everything
        if connected:
            if accounts is None:
                raise PluginError("Verbundene Dienste konnten nicht geladen werden.")
            live = {a["toolkit"] for a in accounts if a["status"] == "ACTIVE" and not a["disabled"]}
            pool = [t for t in pool if t["slug"] in live]
        order = {s: i for i, s in enumerate(RECOMMENDED)}
        recommended = 0
        if category == "recommended":
            pool = sorted((t for t in pool if t["slug"] in order), key=lambda t: order[t["slug"]])
        else:
            if category:
                pool = [t for t in pool if any(g["id"] == category for g in groups[t["slug"]])]
            pool = sorted(pool, key=lambda t: (0 if t["name"][:1].isalpha() else 1, t["name"].casefold()))
            if not category and not search and not connected:
                rec = sorted((t for t in pool if t["slug"] in order), key=lambda t: order[t["slug"]])
                recommended = len(rec)
                pool = rec + [t for t in pool if t["slug"] not in order]
        terms = search_terms(search)
        if terms:
            pool = [t for t in pool if any(term in f"{t['name']} {t['slug']} {t['description']} {' '.join(g['name'] for g in groups[t['slug']])}".lower() for term in terms)]
            if category != "recommended":
                rank = lambda t: 0 if any(t["name"].lower().startswith(x) for x in terms) else 1 if any(x in f"{t['name']} {t['slug']}".lower() for x in terms) else 2
                pool = sorted(pool, key=rank)
        offset = int(offset_text)
        entries = [{"id": f"composio:{t['slug']}", "slug": t["slug"], "name": t["name"], "description": t["description"], "logoUrl": https_url(t["logo"]),
                    "categories": groups[t["slug"]], "authSchemes": t["auth_schemes"], "managedAuthSchemes": t["managed"], "authMode": _auth_mode(t),
                    "connectionStatus": _status_of([a for a in accounts if a["toolkit"] == t["slug"]]) if accounts is not None else "unavailable",
                    **STATUS_KEYS, "source": "Composio"} for t in pool[offset:offset + limit]]
        return {"ok": True, "configured": True, "entries": entries, "nextCursor": str(offset + limit) if offset + limit < len(pool) else None,
                "totalItems": len(pool), "categories": categories, "recommendedCount": recommended if offset == 0 else 0}

    @staticmethod
    def _slug(value: str) -> str:
        if not SLUG.match(value):
            raise PluginError("Ungültiger Dienst.")
        return value

    async def status(self, slug: str, account_id: str | None = None) -> dict:
        accounts = await self.accounts(self._slug(slug))
        if account_id is not None:
            if not ACCOUNT_ID.match(account_id):
                raise PluginError("Ungültige Verbindung.")
            accounts = [a for a in accounts if a["id"] == account_id]
            if not accounts:
                raise PluginError("Diese Verbindung wurde für diesen Dienst und Nutzer nicht gefunden.")
        return {"ok": True, "connectionStatus": _status_of(accounts), **STATUS_KEYS}

    async def account_list(self, slug: str) -> dict:
        return {"ok": True, "accounts": [{"id": a["id"], "status": "DISABLED" if a["disabled"] else a["status"]} for a in await self.accounts(self._slug(slug))]}

    async def entry(self, slug: str) -> dict:
        toolkit = await self._details(slug)
        try:
            status = _status_of(await self.accounts(slug))
        except PluginError:
            status = "unavailable"
        return {"id": f"composio:{slug}", "slug": slug, "name": toolkit["name"], "description": toolkit["description"],
                "logoUrl": https_url(toolkit["logo"]), "categories": groups_of(toolkit["categories"]),
                "authMode": _auth_mode(toolkit), "connectionStatus": status, **STATUS_KEYS, "source": "Composio"}

    async def actions(self, slug: str, cursor: str | None = None) -> dict:
        slug = self._slug(slug)
        if cursor is not None and len(cursor) > 2048:
            raise PluginError("Ungültige Seitenangabe.")
        query = {"toolkit_slug": slug, "limit": "25", "include_deprecated": "false", "toolkit_versions": "latest"}
        if cursor:
            query["cursor"] = cursor
        page, next_cursor = _items(await self._request(f"/tools?{urlencode(query)}"))
        actions = []
        for raw in page:
            action = _action(raw)
            if not action or action["toolkit"] != slug or action["deprecated"] or action["slug"].startswith("COMPOSIO_"):
                continue
            schema = normalize_schema(action["params"])
            if not schema:
                continue
            try:
                Draft202012Validator.check_schema(schema)
            except Exception:
                continue
            actions.append({"id": action["slug"], "label": str(raw.get("name") or action["slug"])[:240], "description": action["description"],
                            "readOnly": read_only(action["tags"])})
        return {"ok": True, "actions": actions, "nextCursor": next_cursor, "executed": False}

    async def disconnect(self, slug: str, body: dict) -> dict:
        ids = body.get("accountIds")
        if not (isinstance(ids, list) and 1 <= len(ids) <= 100 and all(isinstance(i, str) and ACCOUNT_ID.match(i) for i in ids) and body.get("confirmed") is True):
            raise PluginError("Ungültige Eingabe.")
        owned = {a["id"] for a in await self.accounts(self._slug(slug))}
        ids = list(dict.fromkeys(ids))
        if any(i not in owned for i in ids):
            raise PluginError("Mindestens eine Verbindung gehört nicht zu diesem Dienst oder Nutzer.")
        deleted, failed = [], []
        for i in ids:
            try:
                ok = (await self._request(f"/connected_accounts/{i}", method="DELETE") or {}).get("success") is True
            except (PluginError, AttributeError):
                ok = False
            (deleted if ok else failed).append(i)
        self._sessions.clear()
        self._accounts = None
        return {"ok": True, "deletedIds": deleted, "failedIds": failed, "notice": "Bei Composio getrennt. Berechtigungen beim Anbieter gegebenenfalls separat widerrufen."}

    async def _details(self, slug: str) -> dict:
        raw = await self._request(f"/toolkits/{self._slug(slug)}")
        t = _toolkit(raw)
        if not t or t["slug"] != slug:
            raise PluginError("Der Anbieter passt nicht zur Anfrage.")
        modes = raw.get("auth_config_details") if isinstance(raw.get("auth_config_details"), list) else []
        t["_modes"] = modes
        t["guide"] = https_url(raw.get("auth_guide_url"))
        # Die Einzelabfrage nennt die Anmeldearten nur in auth_config_details.
        t["auth_schemes"] = t["auth_schemes"] + [m["mode"] for m in modes if isinstance(m, dict) and isinstance(m.get("mode"), str)]
        return t

    async def setup(self, slug: str) -> dict:
        d = await self._details(slug)
        return {"ok": True, "slug": slug, "name": d["name"], "guideUrl": d["guide"], "schemes": _setup_schemes(d), "credentialDestination": "Composio",
                "connectionFieldsHosted": True, "oauthRedirectUrl": OAUTH_REDIRECTS[0],
                "notice": "Eigene App-Zugänge werden einmal an Composio übertragen und dort gespeichert. Konto-Zugänge gibst du nur auf der Composio-Anmeldeseite ein. Anbieter und Composio können Nutzungskosten berechnen."}

    async def _auth_config(self, slug: str, scheme: str, fields: dict, require_custom: bool = False) -> str:
        identity = await self._identity()
        key = hashlib.sha256(json.dumps([identity, slug, scheme, sorted(fields.items())], default=str).encode()).hexdigest()
        if key not in self._configs:
            made = await self._request("/auth_configs", {"toolkit": {"slug": slug}, "auth_config": {"type": "use_custom_auth", "authScheme": scheme, "name": f"Orbit {slug}", "credentials": fields}})
            tk, ac = (made or {}).get("toolkit") or {}, (made or {}).get("auth_config") or {}
            if tk.get("slug") != slug or str(ac.get("auth_scheme", "")).upper() != scheme or not ACCOUNT_ID.match(str(ac.get("id", ""))) or (require_custom and ac.get("is_composio_managed")):
                raise PluginError("Composio hat die erwartete Einrichtung nicht bestätigt.")
            self._configs[key] = ac["id"]
        return self._configs[key]

    async def _link(self, path: str, body: dict) -> tuple[str, str]:
        link = await self._request(path, body)
        url = https_url((link or {}).get("redirect_url"))
        aid = str((link or {}).get("connected_account_id", ""))
        if not ACCOUNT_ID.match(aid):
            raise PluginError("Composio liefert eine unerwartete Antwort.")
        if not url or urlparse(url).hostname not in CONNECT_HOSTS:
            raise PluginError("Composio liefert keine sichere Anmeldeadresse.")
        return url, aid

    async def setup_connect(self, slug: str, body: dict) -> dict:
        scheme, fields = body.get("scheme"), body.get("fields", {})
        if not (isinstance(scheme, str) and len(scheme) <= 50 and isinstance(fields, dict) and len(fields) <= 50 and set(body) <= {"scheme", "fields"}
                and all(isinstance(v, (str, int, float, bool)) and (not isinstance(v, str) or len(v) <= 25000) for v in fields.values())):
            raise PluginError("Einrichtungsdaten sind ungültig.")
        mode = next((m for m in _setup_schemes(await self._details(slug)) if m["scheme"] == scheme.upper()), None)
        if not mode or not mode["supported"]:
            raise PluginError("Diese Anmeldeart ist noch nicht sicher unterstützt.")
        if any(k not in {f["name"] for f in mode["configFields"]} for k in fields):
            raise PluginError("Nur die ausgewiesenen Einrichtungsfelder sind erlaubt. Konto-Zugänge gehören auf die Composio-Anmeldeseite.")
        for f in mode["configFields"]:
            v = fields.get(f["name"])
            if v is None:
                if f["required"]:
                    raise PluginError(f"Pflichtfeld fehlt: {f['label']}")
                continue
            bad = ((f["type"] == "string" and (not isinstance(v, str) or (f["required"] and not v.strip())))
                   or (f["type"] == "boolean" and not isinstance(v, bool))
                   or (f["type"] in ("number", "integer") and (isinstance(v, bool) or not isinstance(v, (int, float)) or (f["type"] == "integer" and v != int(v)))))
            if bad:
                raise PluginError(f"Ungültiges Einrichtungsfeld: {f['label']}")
            if f["name"] == "oauth_redirect_uri" and str(v) not in OAUTH_REDIRECTS:
                raise PluginError("Nur der dokumentierte Composio-OAuth-Rücksprung ist unterstützt.")
        config = await self._auth_config(slug, mode["scheme"], fields, require_custom=True)
        url, aid = await self._link("/connected_accounts/link", {"auth_config_id": config, "user_id": (await self._identity())[1]})
        return {"ok": True, "url": url, "accountId": aid, "connectionStatus": "pending", "toolsEnabled": False, "toolsStatus": "not_checked", "credentialDestination": "Composio"}

    async def connect(self, slug: str, body: dict) -> dict:
        if not set(body) <= {"additional"} or not isinstance(body.get("additional", False), bool):
            raise PluginError("Ungültige Eingabe.")
        additional = body.get("additional", False)
        d = await self._details(slug)
        hosted = None if _managed_oauth(d) else _hosted(d)
        if not _managed_oauth(d) and not hosted:
            raise PluginError("Dieser Dienst braucht eine eigene App beim Anbieter (Client-ID und Secret). Bitte über „Einrichten“ hinterlegen.")
        current = _status_of(await self.accounts(slug))
        if current == "connected" and not additional:
            return {"ok": True, "connectionStatus": current, **STATUS_KEYS}
        if hosted:
            config = await self._auth_config(slug, hosted, {})
            url, aid = await self._link("/connected_accounts/link", {"auth_config_id": config, "user_id": (await self._identity())[1]})
        else:
            url, aid = await self._link(f"/tool_router/session/{await self._session(slug)}/link", {"toolkit": slug})
        return {"ok": True, "url": url, "accountId": aid, "connectionStatus": "pending", **STATUS_KEYS}

    async def _session(self, slug: str) -> str:
        user = (await self._identity())[1]
        cached = self._sessions.get(f"{user}:{slug}")
        if cached and cached[1] > time.monotonic():
            return cached[0]
        body = {"user_id": user, "toolkits": {"enable": [slug]}, "instant": False, "manage_connections": {"enable": False}, "workbench": {"enable": False},
                "proxy_execute": {"enable": False}, "search": {"enable": False}, "execute": {"enable_multi_execute": False}}
        sid = str(((await self._request("/tool_router/session", body)) or {}).get("session_id", ""))
        if not ACCOUNT_ID.match(sid):
            raise PluginError("Composio liefert eine unerwartete Antwort.")
        if len(self._sessions) >= 40:
            self._sessions.clear()
        self._sessions[f"{user}:{slug}"] = (sid, time.monotonic() + 600)
        return sid

    async def fingerprint(self) -> str:
        return hashlib.sha256(json.dumps(await self._identity()).encode()).hexdigest()


composio = Composio()


# ---------------------------------------------------------------- Orbi-Werkzeuge
def allowed_bots(db, slug: str) -> list[str] | None:
    return loads(db.val("SELECT value FROM app_kv WHERE key=?", f"plugin-bots:{slug}"))


def enabled_for(run, slug: str) -> bool:
    allowed = allowed_bots(run.ctx.db, slug)
    return allowed is None or (getattr(run, "bot", {}) or {}).get("id") in allowed


def _handle(args: dict) -> dict | None:
    entry = composio.handles.get(str(args.get("handle", "")))
    return entry if entry and entry["until"] > time.monotonic() else None


def _nice(slug: str) -> str:
    return " ".join(w.capitalize() for w in str(slug).split("_") if w) or "Plugin"


_VERBS = (("Liest bei {k} nach", ("list", "get", "fetch", "search", "find", "read", "query", "retrieve", "download", "view")),
          ("Sendet etwas über {k}", ("send", "reply", "forward", "post", "publish", "invite", "share")),
          ("Löscht etwas bei {k}", ("delete", "remove", "trash", "archive")),
          ("Ändert etwas bei {k}", ("update", "edit", "move", "rename", "mark", "set", "patch", "modify")),
          ("Legt bei {k} etwas an", ("create", "add", "upload", "draft", "new", "insert")))


def _action_label(a: dict) -> str:
    """Live-Leiste in einfachem Deutsch aus der echten Aktion (OUTLOOK_LIST_MESSAGES -> „Liest bei Outlook nach“)."""
    action = (composio.handles.get(a.get("handle")) or {}).get("action") if isinstance(a.get("handle"), str) else None
    if not isinstance(action, dict) or not action.get("slug"):
        return "Nutzt einen verbundenen Dienst"
    kit = str(action.get("toolkit", ""))
    words = str(action["slug"]).lower().removeprefix(kit.lower() + "_").split("_")
    return next((text for text, verbs in _VERBS if any(w in verbs for w in words)), "Arbeitet mit {k}").format(k=_nice(kit))


@tool("connector_plugins__search",
      "Find connected plugin accounts (no toolkit given), then search the actions of one toolkit with short keywords. Follow nextCursor. "
      "Only the query goes to Composio, no chat history. Returns turn-local handles and schemas for connector_plugins__execute.",
      {"type": "object", "properties": {"toolkit": {"type": "string", "pattern": "^[a-z0-9_]{1,80}$"}, "query": {"type": "string", "maxLength": 200},
                                        "cursor": {"type": "string", "maxLength": 2048}}},
      label=lambda a: f"Schaut, was bei {_nice(a['toolkit'])} möglich ist" if a.get("toolkit") else "Sieht nach, welche Dienste verbunden sind")
async def plugins_search(run, args):
    fp = await composio.fingerprint()
    toolkit = args.get("toolkit")
    active = [a for a in await composio.accounts(toolkit) if a["status"] == "ACTIVE" and not a["disabled"] and enabled_for(run, a["toolkit"])]
    if not toolkit:
        offset_text = args.get("cursor") or "0"
        if not re.fullmatch(r"\d{1,8}", offset_text):
            raise Fail("Ungültige Kontenseite.")
        o = int(offset_text)
        return {"accounts": [{"toolkit": a["toolkit"], "account": a["id"]} for a in active[o:o + 25]],
                "nextCursor": str(o + 25) if o + 25 < len(active) else None, "totalAccounts": len(active)}
    if not active:
        raise Fail("Dieser Dienst hat keine aktive eigene Verbindung.")
    query = {"toolkit_slug": toolkit, "query": args.get("query", ""), "limit": "20", "include_deprecated": "false", "toolkit_versions": "latest",
             **({"cursor": args["cursor"]} if args.get("cursor") else {})}
    page, cursor = _items(await composio._request(f"/tools?{urlencode(query)}"))
    actions, unsupported = [], 0
    for raw in page:
        a = _action(raw)
        if a and not a["version"]:
            try:
                a = _action(await composio._request(f"/tools/{a['slug']}?toolkit_versions=latest"))
            except PluginError:
                a = None
        if not a or not a["version"] or a["version"] == "latest" or a["toolkit"] != toolkit or a["slug"].startswith("COMPOSIO_") or a["deprecated"] \
                or (run.chat_kind == "group" and not read_only(a["tags"])):
            unsupported += 1
            continue
        schema = normalize_schema(a["params"])
        try:
            if not schema:
                raise ValueError
            Draft202012Validator.check_schema(schema)
        except Exception:
            unsupported += 1
            continue
        handle = secrets.token_hex(24)
        composio.handles[handle] = {"action": a, "schema": schema, "accounts": [x["id"] for x in active], "identity": fp, "run": run.id, "until": time.monotonic() + 600}
        actions.append({"handle": handle, "toolkit": toolkit, "action": a["slug"], "description": a["description"], "inputSchema": schema, "readOnly": read_only(a["tags"])})
    for h in [h for h, e in composio.handles.items() if e["until"] < time.monotonic()]:
        del composio.handles[h]
    return {"actions": actions, "accounts": [{"account": a["id"]} for a in active], "nextCursor": cursor, "unsupported": unsupported,
            "note": "Nur geprüfte Einzelaktionen. Konto bei mehreren Verbindungen ausdrücklich wählen. Composio und Anbieter können Nutzungskosten berechnen."}


def _execute_risk(run, args: dict) -> Risk | None:
    entry = _handle(args)
    if not entry or run.chat_kind == "group" or not isinstance(args.get("arguments"), dict):
        return None  # der Handler lehnt ab; hier gibt es nichts zu genehmigen
    a = entry["action"]
    return classify(a["toolkit"], a["slug"], a["tags"], args["arguments"])


@tool("connector_plugins__execute",
      "Run one found plugin action by handle and schema. Select the account if several are connected. Orbit checks the real risk and may ask Consti first.",
      {"type": "object", "properties": {"handle": {"type": "string", "pattern": "^[a-f0-9]{48}$"}, "account": {"type": "string", "maxLength": 150},
                                        "arguments": {"type": "object"}}, "required": ["handle", "arguments"]},
      label=lambda a: _action_label(a), risk=_execute_risk)
async def plugins_execute(run, args):
    entry = _handle(args)
    if not entry or entry["run"] != run.id or entry["identity"] != await composio.fingerprint():
        raise Fail("Ungültige oder abgelaufene Aktion. Erneut suchen.")
    a = entry["action"]
    if not enabled_for(run, a["toolkit"]):
        raise Fail("Dieses Plugin ist für diesen Orbi ausgeschaltet.")
    accounts = entry["accounts"]
    account = args.get("account") or (accounts[0] if len(accounts) == 1 else None)
    if not account or account not in accounts:
        raise Fail("Eigenes Konto ausdrücklich auswählen.")
    given = {k: v for k, v in args["arguments"].items() if k != "consti_said"}
    if next(iter(Draft202012Validator(entry["schema"]).iter_errors(given)), None):
        raise Fail("Plugin-Eingaben entsprechen nicht dem geprüften Schema.")
    if run.chat_kind == "group" and not read_only(a["tags"]):
        raise Fail("Gruppen dürfen diese Schreibaktion nicht ausführen.")
    async def owned() -> bool:
        return any(x["id"] == account and x["status"] == "ACTIVE" and not x["disabled"] for x in await composio.accounts(a["toolkit"]))
    if not await owned():
        raise Fail("Verbindung ist nicht mehr aktiv oder gehört nicht zu diesem Nutzer.")
    run.counters["untrusted"] = True  # Ergebnisse fremder Dienste (Mails, Seiten) sind Fremddaten
    result = await composio._request(f"/tools/execute/{a['slug']}", {"user_id": (await composio._identity())[1], "connected_account_id": account, "version": a["version"], "arguments": given})
    if not isinstance(result, dict) or result.get("successful") is not True or result.get("error"):
        raise Fail("Plugin-Aktion wurde nicht abgeschlossen.")
    return {"ok": True, "data": result.get("data")}
