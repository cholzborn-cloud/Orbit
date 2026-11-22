"""Marktplatz: Composio, Apple Kalender, eigene MCP-Server. Kein echtes Netz (httpx.MockTransport), kein echter Schlüsselbund."""
import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import httpx
import pytest

from orbitd import keychain
from orbitd.runtime.contract import TOOLS
from orbitd.tools import calendar, user_mcp
from orbitd.tools.composio import composio

GOLDEN = Path(__file__).parent / "contract" / "golden"
SECRET = "supersecret-token-123"
APPLE = {"appleId": "me@example.com", "appPassword": "abcd-efgh-ijkl-mnop"}


@pytest.fixture(autouse=True)
def env(monkeypatch):
    monkeypatch.setenv("ORBIT_KEYCHAIN_FAKE", json.dumps({
        "de.consti.orbit.composio/local": json.dumps({"key": "ck_test", "user": "u1"}),
        "de.consti.orbit.icloud-calendar/local": json.dumps(APPLE)}))
    keychain._fake_written.clear()
    composio.reload()
    composio.transport = calendar.TRANSPORT = None
    user_mcp.STATE.clear()
    yield
    for key in [k for k in TOOLS if k.startswith("mcp_")]:
        del TOOLS[key]
    composio.transport = calendar.TRANSPORT = None
    composio.reload()


def run(coro):
    return asyncio.run(coro)


def err(r):
    assert r.status_code in (400, 404), r.text
    return r.json()["error"]


# ================================================================ Composio
class FakeComposio:
    def __init__(self):
        self.accounts = [{"id": "ca_old", "status": "ACTIVE", "toolkit": "slack"}]
        self.calls: list[tuple[str, str, dict | None]] = []
        self.keys: set[str] = set()

    def toolkit(self, slug, **kw):
        return {"slug": slug, "name": slug.title(), "auth_schemes": ["OAUTH2"], "composio_managed_auth_schemes": [], "no_auth": False,
                "meta": {"description": f"{slug} app", "logo": "https://logos.composio.dev/x.png", "categories": [{"slug": "email", "name": "Email"}]}, **kw}

    def __call__(self, request: httpx.Request) -> httpx.Response:
        path = request.url.path.removeprefix("/api/v3.1")
        body = json.loads(request.content) if request.content else None
        self.keys.add(request.headers.get("x-api-key", ""))
        self.calls.append((request.method, path, body))
        q = dict(request.url.params)
        ok = lambda data, status=200: httpx.Response(status, json=data)
        if path == "/toolkits" and request.method == "GET":
            return ok({"items": [self.toolkit("gmail", composio_managed_auth_schemes=["OAUTH2"]), self.toolkit("slack", composio_managed_auth_schemes=["OAUTH2"]),
                                 self.toolkit("pingapp", auth_schemes=["API_KEY"]), self.toolkit("ownapp"), {"slug": "BAD SLUG"}], "next_cursor": None})
        if path.startswith("/toolkits/"):
            slug = path.split("/")[2]
            fields = {"auth_config_creation": {"required": [{"name": "client_id", "type": "string", "displayName": "Client ID"},
                                                           {"name": "client_secret", "type": "string", "is_secret": True}], "optional": []}}
            return ok({**self.toolkit(slug, auth_schemes=[] if slug != "pingapp" else ["API_KEY"],
                                      composio_managed_auth_schemes=["OAUTH2"] if slug in ("gmail", "slack") else []),
                       "auth_guide_url": "https://docs.example.com/guide", "auth_config_details": [{"mode": "OAUTH2", "required_scopes": ["a"], "fields": fields}]})
        if path == "/connected_accounts" and request.method == "GET":
            items = [{"id": a["id"], "user_id": "u1", "status": a["status"], "toolkit": {"slug": a["toolkit"]}} for a in self.accounts
                     if not q.get("toolkit_slugs") or a["toolkit"] == q["toolkit_slugs"]]
            return ok({"items": items + [{"id": "ca_fremd", "user_id": "other", "status": "ACTIVE", "toolkit": {"slug": q.get("toolkit_slugs", "gmail")}}], "next_cursor": None})
        if path == "/tool_router/session":
            return ok({"session_id": "sess_1"})
        if path.endswith("/link") and path.startswith("/tool_router/session/"):
            self.accounts.append({"id": f"ca_new{len(self.accounts)}", "status": "INITIATED", "toolkit": body["toolkit"]})
            return ok({"redirect_url": "https://connect.composio.dev/link/abc", "connected_account_id": self.accounts[-1]["id"]})
        if path == "/auth_configs":
            ac = body["auth_config"]
            return ok({"toolkit": body["toolkit"], "auth_config": {"id": "ac_1", "auth_scheme": ac["authScheme"], "is_composio_managed": False}})
        if path == "/connected_accounts/link":
            return ok({"redirect_url": "https://connect.composio.dev/link/own", "connected_account_id": "ca_own"})
        if request.method == "DELETE":
            return ok({"success": True}) if path.endswith("ca_old") else httpx.Response(500)
        if path == "/tools":
            return ok({"items": [
                {"slug": "GMAIL_FETCH_EMAILS", "toolkit": {"slug": "gmail"}, "description": "liest", "version": "20260101_00", "tags": ["readOnlyHint"],
                 "input_parameters": {"type": "object", "properties": {"q": {"type": "string"}}, "required": []}},
                {"slug": "GMAIL_SEND_EMAIL", "toolkit": {"slug": "gmail"}, "description": "sendet", "version": "20260101_00", "tags": ["createHint"],
                 "input_parameters": {"to": {"type": "string", "required": True}}},
                {"slug": "GMAIL_KAPUTT", "toolkit": {"slug": "gmail"}, "version": "1", "input_parameters": {"type": "string"}}], "next_cursor": None})
        if path.startswith("/tools/execute/"):
            return ok({"successful": True, "data": {"id": "m1"}})
        return httpx.Response(404)


@pytest.fixture
def fake():
    f = FakeComposio()
    composio.transport = httpx.MockTransport(f)
    return f


def test_catalog_keys_match_golden_when_unconfigured(client, monkeypatch):
    monkeypatch.setenv("ORBIT_KEYCHAIN_FAKE", "{}")
    composio.reload()
    body = client.get("/v1/plugins").json()
    assert body == json.loads((GOLDEN / "get_v1_plugins.json").read_text())["body"]


def test_catalog_configured(client, fake):
    body = client.get("/v1/plugins?limit=100").json()
    assert body["configured"] and body["totalItems"] == 4 and body["recommendedCount"] == 2
    assert set(body) >= {"ok", "configured", "entries", "nextCursor", "totalItems", "categories", "recommendedCount"}
    first = body["entries"][0]
    assert first["slug"] == "gmail" and first["authMode"] == "managed_oauth" and first["connectionStatus"] == "not_connected" and first["source"] == "Composio"
    assert {"id", "slug", "name", "description", "authSchemes", "managedAuthSchemes", "categories", "toolsEnabled", "logoUrl", "toolsStatus"} <= set(first)
    by = {e["slug"]: e for e in body["entries"]}
    assert by["slack"]["connectionStatus"] == "connected" and by["pingapp"]["authMode"] == "hosted" and by["ownapp"]["authMode"] == "setup_required"
    assert [e["slug"] for e in client.get("/v1/plugins?search=ping").json()["entries"]] == ["pingapp"]
    assert [e["slug"] for e in client.get("/v1/plugins?connected=true").json()["entries"]] == ["slack"]
    assert client.get("/v1/plugins?limit=1000").status_code == 400
    assert set(fake.keys) == {"ck_test"}


def test_connect_additional_status_accounts_disconnect(client, fake):
    r = client.post("/v1/plugins/gmail/connect").json()
    assert r["connectionStatus"] == "pending" and r["url"].startswith("https://connect.composio.dev/") and r["accountId"]
    assert client.get("/v1/plugins/gmail/status").json()["connectionStatus"] == "pending"
    assert client.get(f"/v1/plugins/gmail/status?accountId={r['accountId']}").json()["connectionStatus"] == "pending"
    assert "nicht gefunden" in err(client.get("/v1/plugins/gmail/status?accountId=ca_fremd"))
    # Slack ist verbunden: ohne additional wird wiederverwendet, mit additional entsteht eine neue Verbindung
    again = client.post("/v1/plugins/slack/connect").json()
    assert again == {"ok": True, "connectionStatus": "connected", "toolsEnabled": False, "toolsStatus": "not_checked", "accessMode": "individual_actions"}
    n = len(fake.accounts)
    more = client.post("/v1/plugins/slack/connect", json={"additional": True}).json()
    assert more["url"] and len(fake.accounts) == n + 1
    ids = [a["id"] for a in client.get("/v1/plugins/slack/accounts").json()["accounts"]]
    assert ids == ["ca_old", more["accountId"]]
    # Trennen mit Teilfehler (ca_new… liefert 500), fremde Konten werden abgelehnt
    out = client.request("DELETE", "/v1/plugins/slack/accounts", json={"accountIds": ["ca_old", more["accountId"]], "confirmed": True}).json()
    assert out["deletedIds"] == ["ca_old"] and out["failedIds"] == [more["accountId"]] and out["notice"]
    assert "gehört nicht" in err(client.request("DELETE", "/v1/plugins/slack/accounts", json={"accountIds": ["ca_fremd"], "confirmed": True}))
    assert "Ungültige Eingabe" in err(client.request("DELETE", "/v1/plugins/slack/accounts", json={"accountIds": ["ca_old"]}))
    assert err(client.post("/v1/plugins/BAD!/connect")) == "Ungültiger Dienst."


def test_connect_hosted_and_setup(client, fake):
    hosted = client.post("/v1/plugins/pingapp/connect").json()
    assert hosted["accountId"] == "ca_own" and any(p == "/auth_configs" and b["auth_config"]["credentials"] == {} for _, p, b in fake.calls)
    assert "eigene App" in err(client.post("/v1/plugins/ownapp/connect"))
    setup = client.get("/v1/plugins/ownapp/setup").json()
    s = setup["schemes"][0]
    assert setup["credentialDestination"] == "Composio" and s["supported"] and [f["name"] for f in s["configFields"]] == ["client_id", "client_secret"]
    assert s["configFields"][1]["secret"] is True
    r = client.post("/v1/plugins/ownapp/setup", json={"scheme": "OAUTH2", "fields": {"client_id": "a", "client_secret": "b"}}).json()
    assert r["connectionStatus"] == "pending" and r["url"].startswith("https://connect.composio.dev/")
    assert "Pflichtfeld" in err(client.post("/v1/plugins/ownapp/setup", json={"scheme": "OAUTH2", "fields": {"client_id": "a"}}))
    assert "Einrichtungsfelder" in err(client.post("/v1/plugins/ownapp/setup", json={"scheme": "OAUTH2", "fields": {"client_id": "a", "client_secret": "b", "x": "y"}}))
    assert "nicht sicher unterstützt" in err(client.post("/v1/plugins/ownapp/setup", json={"scheme": "NOPE", "fields": {}}))


def test_not_configured_and_verify_and_reload(client, fake, monkeypatch):
    assert client.post("/v1/plugins/reload").json() == {"ok": True}
    assert client.post("/v1/plugins/verify", json={"key": "k", "user": "u"}).json() == {"ok": True}
    assert "ungültig" in err(client.post("/v1/plugins/verify", json={"key": "", "user": "u"}))
    monkeypatch.setenv("ORBIT_KEYCHAIN_FAKE", "{}")
    composio.reload()
    assert "noch nicht eingerichtet" in err(client.post("/v1/plugins/gmail/connect"))
    composio.transport = httpx.MockTransport(lambda r: httpx.Response(401))
    assert "nicht geprüft" in err(client.post("/v1/plugins/verify", json={"key": "k", "user": "u"}))


def test_composio_tools(client, fake, ctx):
    r = SimpleNamespace(id="run1", chat_kind="direct", ctx=ctx, counters={})
    search, execute = TOOLS["connector_plugins__search"], TOOLS["connector_plugins__execute"]
    accounts = run(search.handler(r, {}))
    assert {"toolkit": "slack", "account": "ca_old"} in accounts["accounts"]
    assert "keine aktive" in pytest.raises(Exception, run, search.handler(r, {"toolkit": "pingapp"})).value.error
    # gmail braucht ein aktives Konto
    fake.accounts.append({"id": "ca_g", "status": "ACTIVE", "toolkit": "gmail"})
    found = run(search.handler(r, {"toolkit": "gmail", "query": "mail"}))
    acts = {a["action"]: a for a in found["actions"]}
    assert set(acts) == {"GMAIL_FETCH_EMAILS", "GMAIL_SEND_EMAIL"} and found["unsupported"] == 1
    assert acts["GMAIL_FETCH_EMAILS"]["readOnly"] and not acts["GMAIL_SEND_EMAIL"]["readOnly"] and len(acts["GMAIL_SEND_EMAIL"]["handle"]) == 48
    read, send = acts["GMAIL_FETCH_EMAILS"]["handle"], acts["GMAIL_SEND_EMAIL"]["handle"]
    # lesend: kein Risk; schreibend: Risk mit Art connector:composio-gmail:SLUG
    assert execute.risk(r, {"handle": read, "arguments": {}}) is None
    risk = execute.risk(r, {"handle": send, "arguments": {"to": "a@b.de"}})
    assert (risk.reason, risk.approval_kind) == ("nachricht", "connector:composio-gmail:GMAIL_SEND_EMAIL") and "a@b.de" in risk.text
    assert run(execute.handler(r, {"handle": send, "arguments": {"to": "a@b.de"}})) == {"ok": True, "data": {"id": "m1"}}
    assert any(p == "/tools/execute/GMAIL_SEND_EMAIL" and b["connected_account_id"] == "ca_g" for _, p, b in fake.calls)

    def bad(args, who=r):
        return pytest.raises(Exception, run, execute.handler(who, args)).value.error
    assert "Ungültige oder abgelaufene" in bad({"handle": "0" * 48, "arguments": {}})
    assert "Ungültige oder abgelaufene" in bad({"handle": send, "arguments": {"to": "x"}}, SimpleNamespace(id="anderer-lauf", chat_kind="direct", ctx=ctx, counters={}))
    assert "Schema" in bad({"handle": send, "arguments": {"zu": 1}})
    assert "Schema" in bad({"handle": send, "arguments": {"to": 5}})
    assert "ausdrücklich auswählen" in bad({"handle": send, "account": "ca_old", "arguments": {"to": "a"}})
    # Gruppen: nur Lesendes
    g = SimpleNamespace(id="run2", chat_kind="group", ctx=ctx, counters={})
    found_g = run(search.handler(g, {"toolkit": "gmail"}))
    assert [a["action"] for a in found_g["actions"]] == ["GMAIL_FETCH_EMAILS"]
    assert "Ungültige oder abgelaufene" in bad({"handle": send, "arguments": {"to": "a"}}, g)   # Handles gelten nur im Lauf, der gesucht hat
    # Konto inzwischen getrennt
    fake.accounts[:] = [a for a in fake.accounts if a["id"] != "ca_g"]
    assert "nicht mehr aktiv" in bad({"handle": read, "account": "ca_g", "arguments": {}})


# ================================================================ Apple Kalender
ICS = ("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:ev1\r\nDTSTAMP:20261101T000000Z\r\nDTSTART:20261112T090000Z\r\nDTEND:20261112T100000Z\r\n"
       "SUMMARY:Zahnarzt\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n")
DAV_HEAD = '<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">'


def _resp(href, prop):
    return f'<d:response><d:href>{href}</d:href><d:propstat><d:prop>{prop}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>'


class FakeICloud:
    def __init__(self, evil_redirect=False):
        self.log: list[tuple[str, str, dict]] = []
        self.events = {"ev1.ics": ('"e1"', ICS)}
        self.evil = evil_redirect

    def __call__(self, request: httpx.Request) -> httpx.Response:
        url, m, body = str(request.url), request.method, request.content.decode()
        self.log.append((m, url, dict(request.headers)))
        xml = lambda *rows, status=207: httpx.Response(status, text=DAV_HEAD + "".join(rows) + "</d:multistatus>")
        if url == "https://caldav.icloud.com/.well-known/caldav":
            return httpx.Response(301, headers={"location": "https://evil.example.com/x" if self.evil else "https://caldav.icloud.com/123/principal/"})
        assert request.headers["authorization"].startswith("Basic ")
        if m == "PROPFIND" and "current-user-principal" in body:
            return xml(_resp("/123/principal/", "<d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal>"))
        if m == "PROPFIND" and "calendar-home-set" in body:
            return xml(_resp("/123/principal/", "<c:calendar-home-set><d:href>https://p01-caldav.icloud.com/123/calendars/</d:href></c:calendar-home-set>"))
        if m == "PROPFIND":
            return xml(_resp("/123/calendars/inbox/", "<d:resourcetype><d:collection/></d:resourcetype><d:displayname>Inbox</d:displayname>"),
                       _resp("/123/calendars/home/", "<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Privat</d:displayname>"))
        if m == "REPORT":
            return xml(*[_resp(f"/123/calendars/home/{n}", f"<d:getetag>{e}</d:getetag><c:calendar-data>{ics}</c:calendar-data>") for n, (e, ics) in self.events.items()])
        name = url.rsplit("/", 1)[-1]
        if m == "GET":
            return httpx.Response(200, text=self.events[name][1], headers={"etag": self.events[name][0]}) if name in self.events else httpx.Response(404)
        if m == "DELETE":
            if request.headers.get("if-match") != self.events[name][0]:
                return httpx.Response(412)
            del self.events[name]
            return httpx.Response(204)
        if m == "PUT":
            existed = name in self.events
            self.events[name] = ('"new"', body)
            return httpx.Response(204 if existed else 201)
        return httpx.Response(405)


@pytest.fixture
def icloud():
    f = FakeICloud()
    calendar.TRANSPORT = httpx.MockTransport(f)
    return f


def test_icloud_verify_route(client, icloud):
    assert client.post("/v1/icloud/verify", json=APPLE).json() == {"ok": True, "count": 1}
    assert "ungültig" in err(client.post("/v1/icloud/verify", json={"appleId": "a", "appPassword": "falsch"}))
    # Weiterleitung auf eine fremde Domain: abgelehnt, und dorthin geht keine Anfrage (mit Zugangsdaten schon gar nicht)
    evil = FakeICloud(evil_redirect=True)
    calendar.TRANSPORT = httpx.MockTransport(evil)
    assert "nicht verbunden" in err(client.post("/v1/icloud/verify", json=APPLE))
    assert not any("evil.example.com" in u for _, u, _ in evil.log)


def test_calendar_tools(icloud, ctx):
    r = SimpleNamespace(id="r", chat_kind="direct", ctx=ctx, counters={})
    listing = run(TOOLS["apple_calendar_list"].handler(r, {"start": "2026-11-01T00:00:00+01:00", "end": "2026-11-30T00:00:00+01:00"}))
    event = listing["entries"][0]["event"]
    assert listing["complete"] and listing["entries"][0]["calendar"] == "Privat" and event["etag"] == '"e1"' and "Zahnarzt" in event["iCalendar"]
    assert "Beginn" in pytest.raises(Exception, run, TOOLS["apple_calendar_list"].handler(r, {"start": "2026-11-30T00:00:00Z", "end": "2026-11-01T00:00:00Z"})).value.error
    run(TOOLS["apple_calendar_create"].handler(r, {"calendar": "Privat", "title": "Test, mit; Komma", "start": "2026-11-13T10:00:00+01:00", "end": "2026-11-13T11:00:00+01:00"}))
    put = [x for x in icloud.log if x[0] == "PUT"][0]
    assert put[2]["if-none-match"] == "*" and "/123/calendars/home/" in put[1]
    saved = next(v[1] for k, v in icloud.events.items() if k != "ev1.ics")
    assert "DTSTART:20261113T090000Z" in saved and r"SUMMARY:Test\, mit\; Komma" in saved
    assert "nicht eindeutig oder nicht vorhanden" in pytest.raises(Exception, run, TOOLS["apple_calendar_create"].handler(
        r, {"calendar": "Gibt es nicht", "title": "x", "start": "2026-11-13T10:00:00Z", "end": "2026-11-13T11:00:00Z"})).value.error
    args = {"calendar": "Privat", "url": event["url"], "etag": '"e1"', "eventTitle": "Zahnarzt", "eventStart": "DTSTART:20261112T090000Z", "attendees": [], "series": False}
    risk = TOOLS["apple_calendar_delete"].risk(r, args)
    assert (risk.reason, risk.approval_kind) == ("loeschen", "apple_calendar_delete")
    assert TOOLS["apple_calendar_delete_many"].risk(r, {"events": [args]}).reason == "loeschen"
    assert TOOLS["apple_calendar_invite"].risk(r, {**args, "recipient": "x@y.de"}).reason == "nachricht"
    assert TOOLS["apple_calendar_update"].risk is None and TOOLS["apple_calendar_create"].risk is None
    # veraltete Version / falscher Titel: nichts wird gelöscht
    for wrong in ({"etag": '"alt"'}, {"eventTitle": "Anderer"}):
        assert pytest.raises(Exception, run, TOOLS["apple_calendar_delete"].handler(r, {**args, **wrong}))
    assert "ev1.ics" in icloud.events
    assert run(TOOLS["apple_calendar_delete"].handler(r, args))["ok"]
    delete = [x for x in icloud.log if x[0] == "DELETE"][0]
    assert delete[2]["if-match"] == '"e1"' and "ev1.ics" not in icloud.events


def test_calendar_update_and_invite(icloud, ctx):
    r = SimpleNamespace(id="r", chat_kind="direct", ctx=ctx, counters={})
    args = {"calendar": "Privat", "url": "https://p01-caldav.icloud.com/123/calendars/home/ev1.ics", "etag": '"e1"', "eventTitle": "Zahnarzt",
            "eventStart": "DTSTART:20261112T090000Z", "attendees": [], "series": False}
    run(TOOLS["apple_calendar_update"].handler(r, {**args, "title": "Arzt", "start": "2026-11-12T11:00:00+01:00", "end": "2026-11-12T12:00:00+01:00"}))
    text = icloud.events["ev1.ics"][1]
    assert "SUMMARY:Arzt" in text and "DTSTART:20261112T100000Z" in text and [x for x in icloud.log if x[0] == "PUT"][-1][2]["if-match"] == '"e1"'
    icloud.events["ev1.ics"] = ('"e2"', ICS)
    run(TOOLS["apple_calendar_invite"].handler(r, {**args, "etag": '"e2"', "recipient": "gast@example.com"}))
    assert "ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:gast@example.com" in icloud.events["ev1.ics"][1] and "ORGANIZER:mailto:me@example.com" in icloud.events["ev1.ics"][1]


def test_calendar_without_credentials(ctx, monkeypatch):
    monkeypatch.setenv("ORBIT_KEYCHAIN_FAKE", "{}")
    r = SimpleNamespace(id="r", chat_kind="direct", ctx=ctx, counters={})
    e = pytest.raises(Exception, run, TOOLS["apple_calendar_list"].handler(r, {"start": "2026-11-01T00:00:00Z", "end": "2026-11-02T00:00:00Z"}))
    assert "nicht verbunden" in e.value.error


# ================================================================ eigene MCP-Server
STDIO = {"name": "test-srv", "transport": "stdio", "command": sys.executable, "args": [str(Path(__file__).parent / "mcp_stdio_server.py")], "token": SECRET}


def test_mcp_server_lifecycle(client, ctx):
    assert client.get("/v1/mcp-servers").json() == {"ok": True, "servers": []}
    server = client.post("/v1/mcp-servers", json=STDIO).json()["server"]
    assert server["status"] == "verbunden" and server["hasToken"] and server["transport"] == "stdio" and server["enabled"] is True
    assert {t["name"]: t["readOnly"] for t in server["tools"]} == {"echo": True, "schreibe": False}
    # der Token steht nie in der Tabelle, nur im Schlüsselbund unter MCP_<NAME>
    dump = json.dumps([dict(r) for r in ctx.db.all("SELECT * FROM mcp_servers")])
    assert SECRET not in dump and keychain._fake_written[(keychain.SERVICE, "MCP_TEST_SRV")] == SECRET
    assert SECRET not in json.dumps(client.get("/v1/mcp-servers").json())
    t = client.post("/v1/mcp-servers/test-srv/test").json()
    assert t["ok"] and t["count"] == 2
    assert "mcp_test-srv__echo" in TOOLS and "mcp_test-srv__schreibe" in TOOLS
    r = SimpleNamespace(id="r", chat_kind="direct", ctx=ctx, counters={})
    echo, write = TOOLS["mcp_test-srv__echo"], TOOLS["mcp_test-srv__schreibe"]
    assert echo.risk(r, {}).reason == "system" and run(echo.handler(r, {"text": "hi"})) == "echo:hi"
    assert write.risk(r, {"text": "x"}).reason == "system"
    assert run(write.handler(r, {"text": "x"})) == "geschrieben:x:token"      # der Token kam beim Server an
    assert echo.schema["properties"]["text"]
    client.delete("/v1/mcp-servers/test-srv")
    assert not [k for k in TOOLS if k.startswith("mcp_test-srv__")] and client.get("/v1/mcp-servers").json()["servers"] == []
    assert "nicht gefunden" in err(client.delete("/v1/mcp-servers/test-srv"))
    assert keychain._fake_written[(keychain.SERVICE, "MCP_TEST_SRV")] == ""  # Token mit dem Server aus dem Schlüsselbund


def test_mcp_server_errors(client):
    bad = lambda **kw: err(client.post("/v1/mcp-servers", json={**STDIO, "token": None, **kw}))
    assert "Name" in bad(name="A")
    assert "Name" in bad(name="x" * 41)
    assert "Name" in bad(name="mit_unterstrich")
    assert "Übertragung" in bad(transport="ftp")
    assert "Adresse" in bad(name="web", transport="http", url="http://example.com/mcp")
    assert "Adresse" in bad(name="web", transport="http", url=None)
    assert "Befehl" in bad(name="cmd", command="")
    assert "Argumente" in bad(name="cmd", args="nicht-liste")
    # lokale und https-Adressen sind erlaubt; nicht erreichbar -> Status fehler, aber eingetragen
    ok = client.post("/v1/mcp-servers", json={"name": "lokal", "transport": "http", "url": "http://127.0.0.1:9/mcp"}).json()["server"]
    assert ok["status"] == "fehler" and ok["error"] and ok["tools"] == [] and ok["hasToken"] is False
    assert "schon" in err(client.post("/v1/mcp-servers", json={"name": "lokal", "transport": "http", "url": "https://example.com/mcp"}))
    kaputt = client.post("/v1/mcp-servers", json={"name": "kaputt", "transport": "stdio", "command": "/gibt/es/nicht"}).json()["server"]
    assert kaputt["status"] == "fehler"
    assert "nicht erreichbar" in err(client.post("/v1/mcp-servers/kaputt/test"))
    assert "nicht gefunden" in err(client.post("/v1/mcp-servers/unbekannt/test"))
    assert {s["name"] for s in client.get("/v1/mcp-servers").json()["servers"]} == {"lokal", "kaputt"}


# ================================================================ Katalog und alte Konnektoren
def test_marketplace_matches_golden(client):
    body = client.get("/v1/marketplace").json()
    assert body == json.loads((GOLDEN / "get_v1_marketplace.json").read_text())["body"]
    assert body["entries"] and all(e["type"] == "skill" for e in body["entries"])
    assert not any(e.get("id", "").startswith("mcp-") for e in body["entries"])


def test_toolkit_disk_cache_serves_second_open(client, fake, tmp_path, monkeypatch):
    monkeypatch.setenv("ORBIT_DATA_DIR", str(tmp_path))
    composio.reload()
    composio.transport = httpx.MockTransport(fake)
    first = client.get("/v1/plugins?limit=10").json()
    assert first["configured"] and first["entries"]
    cache = tmp_path / "cache" / "composio-toolkits.json"
    assert cache.is_file()
    n = len(fake.calls)
    composio._catalog = None  # Speicher leer, Disk bleibt
    second = client.get("/v1/plugins?limit=10").json()
    assert second["totalItems"] == first["totalItems"]
    # Disk-Treffer: kein neuer /toolkits-Fetch vor der Antwort (Hintergrund-Refresh zählt nicht synchron)
    assert not any(p.startswith("/toolkits?") for _, p, _ in fake.calls[n:n + 2])


def test_install_plugin_opens_connect_card(client, fake, ctx, seed):
    from orbitd.runtime.interactions import Interactions
    from orbitd.tools import word
    cards = []
    interactions = Interactions(ctx)
    ctx.parts["interactions"] = interactions
    run_ = SimpleNamespace(
        id="run-plug", chat_id="chat1", chat_kind="direct", message_id="m1",
        bot={"id": "bot1", "name": "Nova"}, ctx=ctx, counters={}, automation_id=None,
        root={"chatId": "chat1", "taskId": None}, from_orbi=False,
        card=lambda *a, **k: cards.append(a),
    )
    out = run(word.install_plugin(run_, {"plugin_id": "gmail", "reason": "Need mail"}))
    assert out["asked"] is True and cards and cards[0][0] == "InstallPlugin"
    pending = [c for c in interactions.list() if c.get("tool") == "InstallPlugin"]
    assert len(pending) == 1
    conn = pending[0]["input"]["connectorConnect"]
    assert conn["slug"] == "gmail" and conn.get("name") == "Gmail" and "mail" in (conn.get("reason") or "").lower()
    assert pending[0]["input"]["questions"][0]["options"][0]["label"] == "Verbinden"
    already = run(word.install_plugin(run_, {"plugin_id": "slack"}))
    assert already.get("alreadyConnected") is True


def test_old_connectors_are_gone(client):
    assert client.get("/v1/connectors").json() == {"ok": True, "connectors": []}
    for method, path in [("POST", "/v1/connectors"), ("PUT", "/v1/connectors/enabled"), ("POST", "/v1/connectors/x/test"), ("PUT", "/v1/connectors/x/enabled"),
                         ("PUT", "/v1/connectors/x/auth"), ("POST", "/v1/connectors/x/oauth"), ("DELETE", "/v1/connectors/x/oauth"), ("DELETE", "/v1/connectors/x")]:
        assert err(client.request(method, path, json={})) == "Konnektoren gibt es nicht mehr. Nutze den Marktplatz.", (method, path)


def test_keychain_items_fake_roundtrip():
    assert run(keychain.get_item("de.consti.orbit.composio", "local"))
    run(keychain.set_item("de.consti.orbit2", "MCP_X", "wert"))
    assert run(keychain.get_item("de.consti.orbit2", "MCP_X")) == "wert" and run(keychain.get("MCP_X")) == "wert"
    assert run(keychain.get_item("de.consti.orbit2", "MCP_NIX")) is None
    with pytest.raises(ValueError):
        run(keychain.set_item("de.consti.orbit2", "böse konto", "w"))


def test_unknown_composio_action_no_card_send_asks():
    from orbitd.tools.composio import classify
    assert classify("notion", "NOTION_UPDATE_PAGE", [], {"id": "1"}) is None
    assert classify("notion", "NOTION_FETCH_DATA", [], {}) is None and classify("gmail", "GMAIL_LIST_THREADS", [], {}) is None
    assert classify("gmail", "GMAIL_SEND_EMAIL", [], {}).reason == "nachricht"


def test_composio_uses_api_key_from_secrets_first(monkeypatch):
    # wie der alte Dienst: COMPOSIO_API_KEY + COMPOSIO_USER_ID gehen vor dem Eintrag aus der App; fehlt einer, gilt der App-Eintrag
    import asyncio, json
    from orbitd import keychain
    from orbitd.tools.composio import Composio, KEYCHAIN
    monkeypatch.setenv("ORBIT_KEYCHAIN_FAKE", json.dumps({"COMPOSIO_API_KEY": "k-env", "COMPOSIO_USER_ID": "u-env"}))
    assert asyncio.run(Composio()._identity()) == ("k-env", "u-env")
    monkeypatch.setenv("ORBIT_KEYCHAIN_FAKE", json.dumps({"COMPOSIO_API_KEY": "k-env"}))
    asyncio.run(keychain.set_item(*KEYCHAIN, json.dumps({"key": "k-app", "user": "u-app"})))
    try:
        assert asyncio.run(Composio()._identity()) == ("k-app", "u-app")
    finally:
        asyncio.run(keychain.delete_item(*KEYCHAIN))


def test_plugin_detail_catalog_actions_do_not_imply_connected_or_executed(client, fake):
    status = client.get("/v1/plugins/gmail/status").json()
    assert status["connectionStatus"] == "not_connected" and status["toolsStatus"] == "not_checked"
    catalog = client.get("/v1/plugins/gmail/actions").json()
    assert catalog["executed"] is False
    assert [(a["id"], a["readOnly"]) for a in catalog["actions"]] == [
        ("GMAIL_FETCH_EMAILS", True), ("GMAIL_SEND_EMAIL", False),
    ]
    assert all(method == "GET" for method, _, _ in fake.calls)


def test_pending_attempt_is_not_promoted_by_other_active_account(client, fake):
    additional = client.post("/v1/plugins/slack/connect", json={"additional": True}).json()
    id = additional["accountId"]
    assert client.get("/v1/plugins/slack/status").json()["connectionStatus"] == "connected"
    assert client.get(f"/v1/plugins/slack/status?accountId={id}").json()["connectionStatus"] == "pending"
    fake.accounts[-1]["status"] = "ACTIVE"
    assert client.get(f"/v1/plugins/slack/status?accountId={id}").json()["connectionStatus"] == "connected"
