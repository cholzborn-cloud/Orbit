"""Daytona-Anbindung (gegen eine Attrappe mit httpx.MockTransport, ohne Netz und ohne echten Schlüsselbund), Datei-Werkzeuge, PDF und Word."""
import asyncio
import base64
import dataclasses
import io
import json
import re
import zipfile
from xml.dom import minidom
from types import SimpleNamespace

import httpx
import pytest
from jsonschema import Draft202012Validator

from orbitd import chatstore, keychain
from orbitd.db import dumps, new_id, now_ms
from orbitd.routes.bots import _index_library
from orbitd.runtime.contract import TOOLS
from orbitd.tools import daytona, files
from orbitd.tools.bridge import Bridge
from orbitd.web import Fail

pytestmark = pytest.mark.anyio


@pytest.fixture(autouse=True)
def key(monkeypatch):
    monkeypatch.setenv("ORBIT_KEYCHAIN_FAKE", json.dumps({"DAYTONA_API_KEY": "geheim"}))


class Fake:
    """Attrappe der Daytona-REST-Schnittstelle: merkt sich jede Anfrage und den Zustand je Computer."""

    def __init__(self):
        self.calls, self.state, self.store, self.exec_result = [], {}, {}, {"exitCode": 0, "result": "ok"}
        self.gone = set()

    def __call__(self, req: httpx.Request) -> httpx.Response:
        path, method = req.url.path, req.method
        self.calls.append((method, path, dict(req.url.params), req.content))
        assert req.headers["authorization"] == "Bearer geheim"
        if (method, path) == ("POST", "/api/sandbox"):
            self.state["sbx1"] = "stopped"
            return httpx.Response(200, json={"id": "sbx1", "state": "started"})
        if (m := re.fullmatch(r"/api/sandbox/(\w+)", path)):
            if method == "DELETE":
                return httpx.Response(404 if m[1] in self.gone else 200)
            return httpx.Response(200, json={"id": m[1], "state": self.state.get(m[1], "started"), "toolboxProxyUrl": "https://tb.test/toolbox"})
        if (m := re.fullmatch(r"/api/sandbox/(\w+)/start", path)):
            self.state[m[1]] = "started"
            return httpx.Response(200)
        if (m := re.fullmatch(r"/api/sandbox/(\w+)/stop", path)):
            self.state[m[1]] = "stopped"
            return httpx.Response(200)
        if path.endswith("/ports/6080/signed-preview-url"):
            return httpx.Response(200, json={"url": "https://6080-tok.proxy.test", "token": "tok"})
        if path == "/api/sandbox":
            return httpx.Response(200, json={"items": []})
        assert path.startswith("/toolbox/"), path
        sub = path.split("/", 3)[3] if path.count("/") >= 3 else ""
        if sub == "/process/execute" or sub == "process/execute":
            return httpx.Response(200, json=self.exec_result)
        if sub == "files/download":
            p = req.url.params["path"]
            return httpx.Response(200, content=self.store[p]) if p in self.store else httpx.Response(404)
        if sub == "files/upload-v2":
            self.store[req.url.params["path"]] = req.content
            return httpx.Response(200, json={})
        if sub == "files":
            return httpx.Response(200, json=[{"name": "a.txt", "isDir": False, "size": 3, "modTime": "x"}])
        if sub == "computeruse/status":
            return httpx.Response(200, json={"status": self.state.get("cu", "inactive")})
        if sub == "computeruse/start":
            self.state["cu"] = "active"
            return httpx.Response(200, json={})
        if sub == "computeruse/screenshot/compressed":
            assert req.url.params.get("format") == "jpeg"
            return httpx.Response(200, json={"screenshot": base64.b64encode(b"jpeg-bytes").decode(), "width": 1024, "height": 768})
        if sub == "computeruse/display/info":
            return httpx.Response(200, json={"displays": [{"width": 1024, "height": 768, "x": 0, "y": 0}],
                                             "primary_display": {"width": 1024, "height": 768, "x": 0, "y": 0}})
        if sub.startswith("computeruse/mouse/") or sub.startswith("computeruse/keyboard/"):
            return httpx.Response(200, json={})
        raise AssertionError(path)


class FakeRun:
    def __init__(self, ctx, sandbox_id="sbx1", kind="direct"):
        self.id, self.ctx, self.chat_id, self.chat_kind = new_id(), ctx, "chat1", kind
        self.bot = {**dict(ctx.db.one("SELECT * FROM bots WHERE id='bot1'")), "sandbox_id": sandbox_id}
        self.message_id, self.root, self.counters, self.parts = new_id(), {"chatId": "chat1", "taskId": "t"}, {}, []

    def card(self, tool, tool_call_id, input, output=None):
        self.parts = [p for p in self.parts if p["toolCallId"] != tool_call_id] + [
            {"type": f"tool-{tool}", "toolCallId": tool_call_id, "state": "output-available", "input": input, "output": output}]
        (chatstore.update if chatstore.exists(self.ctx.db, self.chat_id, self.message_id) else
         lambda db, c, m, p: chatstore.add(db, c, m, "assistant", p))(self.ctx.db, self.chat_id, self.message_id, self.parts)

    def step(self, *a):
        pass


@pytest.fixture
def env(ctx, seed, monkeypatch):
    ctx.cfg = dataclasses.replace(ctx.cfg, fake_sandbox=False)
    fake = Fake()
    sb = daytona.Sandbox(ctx, httpx.MockTransport(fake))
    sb.sleep = lambda s: __import__("asyncio").sleep(0)
    ctx.parts["sandbox"] = sb
    return SimpleNamespace(ctx=ctx, fake=fake, sb=sb, run=FakeRun(ctx))


async def use(env, name, **args):
    Draft202012Validator(TOOLS[name].schema).validate(args)
    return await TOOLS[name].handler(env.run, args)


# ---------------------------------------------------------------- Daytona
async def test_anlegen_loeschen_starten_befehl_dateien(env):
    sb, fake = env.sb, env.fake
    assert await sb.create("bot1") == "sbx1"
    method, path, _, body = fake.calls[0]
    assert (method, path) == ("POST", "/api/sandbox") and json.loads(body) == {"labels": {"botId": "bot1"}, "autoStopInterval": 15}
    code, out = await sb.exec("sbx1", "echo hi", "/tmp", 30)  # Computer war gestoppt: wird erst gestartet
    assert (code, out) == (0, "ok") and ("POST", "/api/sandbox/sbx1/start") in [c[:2] for c in fake.calls]
    ex = next(c for c in fake.calls if c[1].endswith("process/execute"))
    assert ex[1] == "/toolbox/sbx1/process/execute" and json.loads(ex[3]) == {"command": "echo hi", "timeout": 30, "cwd": "/tmp"}
    await sb.write_file("sbx1", "/home/daytona/a.txt", b"abc")
    assert await sb.read_file("sbx1", "/home/daytona/a.txt") == b"abc"
    with pytest.raises(Fail, match="Datei nicht gefunden"):
        await sb.read_file("sbx1", "/nope")
    assert await sb.list_files("sbx1") == [{"name": "a.txt", "isDir": False, "size": 3}]
    await sb.ping()
    await sb.delete("sbx1")
    fake.gone.add("sbx1")
    await sb.delete("sbx1")  # 404 = in Ordnung
    n = len(fake.calls)
    await sb.delete("fake-bot1")
    assert len(fake.calls) == n


async def test_ohne_schluessel_klarer_fehler(env, monkeypatch):
    monkeypatch.setenv("ORBIT_KEYCHAIN_FAKE", "{}")
    with pytest.raises(Fail, match="Schlüssel fehlt"):
        await env.sb.create("bot1")


async def test_platzgrenze_greift_und_gibt_nach_15_minuten_frei(env):
    env.ctx.db.run("INSERT OR REPLACE INTO app_kv (key,value,updated_at) VALUES ('budget',?,?)", dumps({"maxSandboxes": 1}), now_ms())
    t = [1_000_000]
    env.sb.now = lambda: t[0]
    await env.sb.ensure_started("a")
    await env.sb.ensure_started("a")  # bekannter Computer geht immer
    with pytest.raises(Fail) as e:
        await env.sb.ensure_started("b")
    assert e.value.error == "Gerade sind alle Computer belegt."
    t[0] += 15 * 60_000
    await env.sb.ensure_started("b")
    assert env.sb.active() == ["b"]


async def test_desktop_url_startet_desktop_und_signiert_eine_stunde(env):
    url = await env.sb.desktop_url("sbx1")
    assert url == "https://6080-tok.proxy.test/vnc.html?autoconnect=true&resize=scale&reconnect=true"
    assert ("POST", "/toolbox/sbx1/computeruse/start") in [c[:2] for c in env.fake.calls]
    assert next(c for c in env.fake.calls if "signed-preview" in c[1])[2] == {"expiresInSeconds": "3600"}


def test_route_desktop_url(client, ctx, seed):
    ctx.cfg = dataclasses.replace(ctx.cfg, fake_sandbox=False)
    ctx.parts["sandbox"] = daytona.Sandbox(ctx, httpx.MockTransport(Fake()))
    ctx.db.run("UPDATE bots SET sandbox_id='sbx1' WHERE id='bot1'")
    r = client.get("/v1/daytona/bot1/desktop-url")
    assert r.status_code == 200 and r.json()["ok"] and r.json()["url"].startswith("https://6080-tok.proxy.test/vnc.html")
    ctx.db.run("UPDATE bots SET sandbox_id='fake-bot1' WHERE id='bot1'")
    r = client.get("/v1/daytona/bot1/desktop-url")
    assert r.status_code == 400 and r.json() == {"ok": False, "error": "Dieser Orbi hat keinen Computer."}
    assert client.get("/v1/daytona/nix/desktop-url").status_code == 404


def test_retry_preserves_a_computer_created_before_lost_response(client, ctx, seed):
    ctx.cfg = dataclasses.replace(ctx.cfg, fake_sandbox=False)
    created = []

    def respond(request):
        assert request.url.path == "/api/sandbox"
        if request.method == "GET":
            assert json.loads(request.url.params["labels"]) == {"botId": "bot1"}
            return httpx.Response(200, json={"items": created, "nextCursor": None})
        assert request.method == "POST" and not created
        created.append({"id": "bestehend", "labels": {"botId": "bot1"}})
        raise httpx.ReadTimeout("Antwort verloren")

    ctx.parts["sandbox"] = daytona.Sandbox(ctx, httpx.MockTransport(respond))
    route = "/v1/bots/bot1/sandbox/setup"
    assert client.post("/v1/bots/bot1/sandbox/reconnect").json()["sandboxConfigured"] is False
    assert not created
    assert client.post(route, json={"confirmed": True}).json()["ok"] is False
    assert len(created) == 1
    assert client.post(route, json={"confirmed": True}).json()["sandboxConfigured"] is True
    assert ctx.db.val("SELECT sandbox_id FROM bots WHERE id='bot1'") == "bestehend"


def test_saved_key_is_replaced_only_after_the_existing_computer_responds(client, ctx, seed, monkeypatch):
    monkeypatch.setenv("ORBIT_ISOLATED_PROFILE", "1")
    monkeypatch.setenv("ORBIT_DATA_DIR", str(ctx.cfg.data_dir))
    asyncio.run(keychain.set_item(keychain.SERVICE, "DAYTONA_API_KEY", "test-alt"))
    ctx.cfg = dataclasses.replace(ctx.cfg, fake_sandbox=False)
    ctx.db.run("UPDATE bots SET sandbox_id='bestehend' WHERE id='bot1'")
    ctx.db.run("INSERT INTO bots (id,user_id,third_party_id,name,avatar,job,created_at) VALUES ('bot2','local','bot2','Zwei','nova','Test',?)", now_ms())

    def respond(request):
        assert request.method == "GET" and request.url.path == "/api/sandbox/bestehend"
        if request.headers["Authorization"] == "Bearer test-falsches-konto":
            return httpx.Response(404)
        assert request.headers["Authorization"] == "Bearer test-neu"
        return httpx.Response(200, json={"id": "bestehend", "state": "stopped"})

    ctx.parts["sandbox"] = daytona.Sandbox(ctx, httpx.MockTransport(respond))
    route = "/v1/daytona/bot2/key"
    assert client.put(route, json={"key": "test-falsches-konto"}).status_code == 404
    assert asyncio.run(keychain.get("DAYTONA_API_KEY")) == "test-alt"
    assert client.put(route, json={"key": "test-neu"}).json() == {"ok": True, "set": True}
    assert client.get("/v1/daytona/bot1/desktop-status").json() == {"ok": True, "state": "sleeping"}
    assert daytona.is_marked_off(ctx, "bot1")


def test_desktop_status_haelt_aus_trotz_daytona_started(client, ctx, seed):
    """Nach Sleep bleibt die Karte auf „schläft“, auch wenn Daytona wieder „started“ meldet."""
    ctx.cfg = dataclasses.replace(ctx.cfg, fake_sandbox=False)
    ctx.db.run("UPDATE bots SET sandbox_id='sbx1' WHERE id='bot1'")
    fake = Fake()
    fake.state["sbx1"] = "started"
    ctx.parts["sandbox"] = daytona.Sandbox(ctx, httpx.MockTransport(fake))
    daytona.mark_off(ctx, "bot1")
    assert client.get("/v1/daytona/bot1/desktop-status").json() == {"ok": True, "state": "sleeping"}
    # Kein Daytona-Aufruf nötig, solange lokal „aus“ gilt
    assert not any(c[1].startswith("/api/sandbox/sbx1") for c in fake.calls)


# ---------------------------------------------------------------- Werkzeuge
async def test_werkzeuge_nur_im_direktchat_mit_echtem_computer(env):
    names = ["bash", "read_file", "write_file", "create_file", "list_files", "share_file", "view_screen", "show_screen",
             "computer_status", "computer_wake", "computer_sleep",
             "mouse_click", "mouse_move", "mouse_scroll", "mouse_drag",
             "keyboard_type", "keyboard_press", "keyboard_hotkey", "wait"]
    assert all(TOOLS[n].groups is False and TOOLS[n].available(env.run) for n in names)
    assert not any(TOOLS[n].available(FakeRun(env.ctx, "fake-bot1")) for n in names)
    assert not any(TOOLS[n].available(FakeRun(env.ctx, None)) for n in names)
    assert "bash" not in Bridge.tools_for(FakeRun(env.ctx, kind="group"))
    env.ctx.cfg = dataclasses.replace(env.ctx.cfg, fake_sandbox=True)
    assert not TOOLS["bash"].available(env.run)


async def test_mouse_keyboard_wait(env):
    assert await use(env, "mouse_click", x=10, y=20, button="left", double=False) == {"ok": True}
    click = next(c for c in env.fake.calls if c[1].endswith("mouse/click"))
    assert json.loads(click[3]) == {"x": 10, "y": 20, "button": "left", "double": False}
    assert await use(env, "mouse_move", x=1, y=2) == {"ok": True}
    assert await use(env, "mouse_scroll", x=1, y=2, direction="down", amount=5) == {"ok": True}
    assert await use(env, "mouse_drag", startX=0, startY=0, endX=5, endY=5) == {"ok": True}
    assert await use(env, "keyboard_type", text="hi") == {"ok": True}
    assert await use(env, "keyboard_press", key="Return", modifiers=["ctrl"]) == {"ok": True}
    assert await use(env, "keyboard_hotkey", keys="ctrl+c") == {"ok": True}
    assert await use(env, "wait", seconds=0.5) == {"ok": True}
    assert env.run.counters.get("untrusted") is True
    assert ("POST", "/toolbox/sbx1/computeruse/start") in [c[:2] for c in env.fake.calls]


async def test_computer_status_wake_sleep(env):
    events = []
    env.ctx.bus.listeners.append(events.append)
    assert (await use(env, "computer_status"))["state"] == "running"
    assert await use(env, "computer_sleep") == "Der Computer ist aus."
    assert env.fake.state["sbx1"] == "stopped"
    assert ("POST", "/api/sandbox/sbx1/stop") in [c[:2] for c in env.fake.calls]
    assert {"type": "desktop", "botId": "bot1", "state": "sleeping"} in events
    assert daytona.is_marked_off(env.ctx, "bot1")
    assert (await use(env, "computer_status"))["state"] == "sleeping"
    # Daytona meldet noch „started“, Orbit hält trotzdem „aus“
    env.fake.state["sbx1"] = "started"
    assert (await use(env, "computer_status"))["state"] == "sleeping"
    env.fake.state["sbx1"] = "stopped"  # wieder wirklich aus, damit Aufwachen starten muss
    assert await use(env, "computer_wake") == "Der Computer läuft."
    assert not daytona.is_marked_off(env.ctx, "bot1")
    assert ("POST", "/api/sandbox/sbx1/start") in [c[:2] for c in env.fake.calls]
    assert {"type": "desktop", "botId": "bot1", "state": "running"} in events
    env.ctx.db.run("INSERT INTO desktop_holds (bot_id,id,request_id,taken_at) VALUES ('bot1','h1',NULL,1)")
    assert (await use(env, "computer_status"))["state"] == "taken"
    with pytest.raises(Fail, match="übernommen"):
        await use(env, "computer_sleep")
    with pytest.raises(Fail, match="übernommen"):
        await use(env, "computer_wake")



async def test_view_and_show_screen(env):
    out = await use(env, "view_screen")
    assert out["width"] == 1024 and out["height"] == 768 and out["_images"][0]["mimeType"] == "image/jpeg"
    assert base64.b64decode(out["_images"][0]["data"]) == b"jpeg-bytes"
    assert env.run.parts == []  # view_screen: keine Chat-Karte
    assert ("GET", "/toolbox/sbx1/computeruse/screenshot/compressed") in [c[:2] for c in env.fake.calls]
    assert ("POST", "/toolbox/sbx1/computeruse/start") in [c[:2] for c in env.fake.calls]
    shown = await use(env, "show_screen")
    assert shown["_images"] and env.run.parts[0]["type"] == "tool-share_file"
    assert env.run.parts[0]["output"]["filename"] == "Bildschirm.jpg"
    assert env.run.counters.get("untrusted") is True


async def test_bash_risiko_und_ausfuehrung(env):
    ask = lambda c: TOOLS["bash"].risk(env.run, {"command": c})
    assert ask("ls -la") is None and ask("echo hallo > a.txt") is None
    hit = ask("sudo rm -rf /")
    assert hit is not None and hit.reason not in ("geld", "nachricht", "login")
    env.fake.exec_result = {"exitCode": 2, "result": "x" * 12_000}
    out = await use(env, "bash", command="ls")
    assert out["exitCode"] == 2 and out["output"].startswith("…(gekürzt)") and len(out["output"]) < 10_100


async def test_dateiwerkzeuge(env):
    assert await use(env, "write_file", path="/home/daytona/n.txt", content="Grüße") == {"path": "/home/daytona/n.txt", "bytes": 7}
    assert (await use(env, "read_file", path="/home/daytona/n.txt"))["content"] == "Grüße"
    assert (await use(env, "list_files"))[0]["name"] == "a.txt"
    assert await use(env, "create_file", path="output/x.md", content="# hi") == {"path": "output/x.md", "bytes": 4}
    ex = [c for c in env.fake.calls if c[1].endswith("process/execute")][-1]
    envs = json.loads(ex[3])["envs"]
    assert envs["ORBIT_WRITE_PATH"] == "output/x.md" and base64.b64decode(envs["ORBIT_WRITE_DATA"]) == b"# hi"
    for bad in ("x.md", "output/../x", "/etc/passwd"):
        with pytest.raises(Fail, match="Ausgabeordner"):
            await use(env, "create_file", path=bad, content="a")
    env.fake.exec_result = {"exitCode": 1, "result": ""}
    with pytest.raises(Fail, match="neuen Dateinamen"):
        await use(env, "create_file", path="output/y.md", content="a")


async def test_share_file_karte_und_bibliothek(env):
    env.fake.store["/home/daytona/Bild.png"] = b"\x89PNG-bytes"
    assert (await use(env, "share_file", path="/home/daytona/Bild.png")).startswith("Shared Bild.png (10 bytes)")
    card = env.run.parts[0]
    assert card["type"] == "tool-share_file" and card["output"] == {"filename": "Bild.png", "mediaType": "image/png", "size": 10, "data": base64.b64encode(b"\x89PNG-bytes").decode()}
    rows = env.ctx.db.all("SELECT * FROM bot_files WHERE bot_id='bot1'")
    assert len(rows) == 1 and rows[0]["filename"] == "Bild.png" and rows[0]["kind"] == "file" and rows[0]["size"] == 10 and rows[0]["message_id"] == env.run.message_id
    _index_library(env.ctx.db, "bot1")  # Verlaufs-Index erkennt dieselbe Datei: keine Dublette
    assert env.ctx.db.val("SELECT count(*) FROM bot_files") == 1
    env.fake.store["/gross.bin"] = b"0" * (5 * 1024 * 1024 + 1)
    with pytest.raises(Fail, match="größer als 5 MiB"):
        await use(env, "share_file", path="/gross.bin")
    assert env.ctx.db.val("SELECT count(*) FROM bot_files") == 1


# ---------------------------------------------------------------- PDF, Word, Medientyp
def test_media_type():
    assert files.media_type("A.PDF") == "application/pdf" and files.media_type("x.docx").endswith("wordprocessingml.document")
    assert files.media_type("x.unbekannt") == files.media_type("ohne") == "application/octet-stream" and files.media_type("a.md") == "text/markdown"
    assert len(files._W) == 95


def pdf_check(data: bytes):
    """Prüft Aufbau und rechnet alle xref-Offsets nach; liefert die gesetzten Texte (cp1252) je Seite."""
    assert data.startswith(b"%PDF-") and data.endswith(b"%%EOF")
    start = int(re.search(rb"startxref\n(\d+)\n%%EOF$", data)[1])
    assert data[start:start + 4] == b"xref"
    n = int(re.match(rb"xref\n0 (\d+)\n", data[start:])[1])
    entries = re.findall(rb"(\d{10}) (\d{5}) ([nf]) \n", data[start:])
    assert len(entries) == n and entries[0][2] == b"f"
    for i, (off, _, kind) in enumerate(entries[1:], 1):
        assert data[int(off):].startswith(b"%d 0 obj\n" % i)
    assert f"/Size {n}".encode() in data
    streams = re.findall(rb"stream\n(.*?)\nendstream", data, re.S)
    return ["".join(bytes.fromhex(h.decode()).decode("cp1252") for h in re.findall(rb"<([0-9a-f]*)> Tj", s)) for s in streams]


def test_pdf_aufbau_umlaute_und_seitenumbruch():
    text = "# Über Äpfel\n\nMüßige Öle für Übung: ä ö ü Ä Ö Ü ß €\n- Punkt eins\n- Punkt (zwei) \\ ok\n" + "\n".join(f"Zeile {i} " + "wort " * 30 for i in range(80))
    pages = pdf_check(files.render_pdf(text))
    assert len(pages) >= 3
    first = pages[0]
    assert "Über Äpfel" in first and "Müßige Öle für Übung: ä ö ü Ä Ö Ü ß €" in first and "• Punkt (zwei) \\ ok" in first
    assert "Zeile 79" in pages[-1]
    assert max(len(p) for p in pages) < 12_000 and all(p for p in pages)
    # Zeilenumbruch: keine Zeile überschreitet die Textbreite deutlich
    one = files.render_pdf("wort " * 200)
    assert len(pdf_check(one)[0]) > 0 and b"BT" in one
    assert pdf_check(files.render_pdf("x" * 400))[0] == "x" * 400  # überlanges Wort wird getrennt, nichts geht verloren


def test_docx_ist_gueltiges_zip_mit_text():
    data = files.render_docx("# Titel <&>\n- Liste ä\nText mit Üm")
    z = zipfile.ZipFile(io.BytesIO(data))
    assert z.testzip() is None and {"[Content_Types].xml", "_rels/.rels", "word/document.xml"} <= set(z.namelist())
    xml_doc = minidom.parseString(z.read("word/document.xml"))
    text = "".join(t.firstChild.data for t in xml_doc.getElementsByTagName("w:t") if t.firstChild)
    assert "Titel <&>" in text and "• Liste ä" in text and "Text mit Üm" in text


async def test_create_pdf_und_word_werkzeuge(env):
    msg = await use(env, "create_pdf", filename="Bericht Nr.1.pdf", text="# Hallo\nWelt")
    assert msg.startswith("Shared Bericht Nr.1.pdf")
    out = env.run.parts[-1]["output"]
    assert out["mediaType"] == "application/pdf" and base64.b64decode(out["data"]).startswith(b"%PDF-") and out["size"] == len(base64.b64decode(out["data"]))
    await use(env, "create_word", filename="Brief.docx", text="Hallo")
    assert env.run.parts[-1]["output"]["mediaType"].endswith("wordprocessingml.document")
    assert env.ctx.db.val("SELECT count(*) FROM bot_files WHERE bot_id='bot1'") == 2
    for name, text in (("a.txt", "x"), ("../a.pdf", "x"), (".pdf", "x"), ("ä.pdf", "a\0b")):
        with pytest.raises(Fail, match="Bitte prüfe PDF-Dateiname"):
            await use(env, "create_pdf", filename=name, text=text)
    with pytest.raises(Fail, match="Bitte prüfe Word-Dateiname"):
        await use(env, "create_word", filename="a.pdf", text="x")
    with pytest.raises(Fail, match="maximal 256 KiB"):
        await TOOLS["create_pdf"].handler(env.run, {"filename": "a.pdf", "text": "ä" * 140_000})  # 280 KB in UTF-8, unter dem Zeichenlimit
