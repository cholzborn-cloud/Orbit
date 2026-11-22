"""Dateien ansehen (Tor: PDF, DOCX, MD und typische Formate in der App ansehen).

Der Weg, den die App geht: Werkzeug (`create_pdf`, `create_word`, `share_file`) legt eine Karte `tool-<name>` in die Nachricht
(`output = {filename, mediaType, size, data(base64)}`, die App zeigt sie nur, wenn `size` == Länge der Daten und höchstens 5 MiB,
`mac/Orbit/Views/Cards/ToolCards.swift:46-53`) und trägt die Datei in die Bibliothek des Orbis ein
(`GET /v1/bots/{id}/library`, `/library/{fileId}`, `SidePanel.swift:442-464`). Angehängte Dateien kommen als Teil `file` mit
data:-URL im Verlauf zurück. Hier wird jede Station über die echten Routen geprüft, nicht nur das Werkzeug.
"""
import base64
import dataclasses
import io
import json
import shutil
import subprocess
import uuid
import zipfile
from types import SimpleNamespace
from xml.dom import minidom

import httpx
import pytest
from test_daytona_files import Fake, FakeRun  # Attrappe der Daytona-Schnittstelle (keine Netzverbindung)

from orbitd.runtime.contract import TOOLS
from orbitd.tools import daytona

PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")  # 1x1 PNG
DOCX_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
# Dateiname im Computer -> (Inhalt, erwarteter Medientyp)
SANDBOX_FILES = {
    "notiz.md": (b"# Titel\n\n- Punkt \xc3\xa4\n", "text/markdown"),
    "klartext.txt": ("Zeile eins\nZeile zwei ü\n".encode(), "text/plain"),
    "tabelle.csv": ("name;wert\nä;1\nb;2\n".encode(), "text/csv"),
    "bild.png": (PNG, "image/png"),
    "daten.json": (b'{"a": 1}', "application/json"),
}


@pytest.fixture(autouse=True)
def key(monkeypatch):
    monkeypatch.setenv("ORBIT_KEYCHAIN_FAKE", json.dumps({"DAYTONA_API_KEY": "geheim"}))


@pytest.fixture
def env(ctx, seed):
    ctx.cfg = dataclasses.replace(ctx.cfg, fake_sandbox=False)
    fake = Fake()
    sb = daytona.Sandbox(ctx, httpx.MockTransport(fake))
    ctx.parts["sandbox"] = sb
    return SimpleNamespace(ctx=ctx, fake=fake, run=FakeRun(ctx))


async def use(env, name, **args):
    return await TOOLS[name].handler(env.run, args)


def card_for(client, tool, filename):
    """Karte so, wie die App sie über den Verlauf bekommt (GET messages)."""
    messages = client.get("/v1/chats/chat1/messages").json()["messages"]
    parts = [p for m in messages for p in m["parts"] if p.get("type") == f"tool-{tool}" and p["output"]["filename"] == filename]
    assert len(parts) == 1, f"Karte {tool}/{filename} im Verlauf: {len(parts)}"
    return parts[0]


def app_would_show(output, media, content=None):
    """Bedingungen der App (ToolCards.swift:46-53) und Inhalt unverändert."""
    data = base64.b64decode(output["data"], validate=True)
    assert output["mediaType"] == media
    assert output["size"] == len(data) <= 5 * 1024 * 1024
    if content is not None:
        assert data == content
    return data


def library_entry(client, filename):
    files = client.get("/v1/bots/bot1/library").json()["files"]
    hits = [f for f in files if f["filename"] == filename]
    assert len(hits) == 1, f"Bibliothek: {filename} {len(hits)}x"
    return hits[0]


def test_pdf_wird_ausgeliefert_und_ist_ein_pdf(client, env):
    import asyncio
    asyncio.run(use(env, "create_pdf", filename="Bericht.pdf", text="# Titel\n\nÜber den Plan:\n- erstens\n- zweitens"))
    out = card_for(client, "share_file", "Bericht.pdf")["output"]
    data = app_would_show(out, "application/pdf")
    assert data.startswith(b"%PDF-") and data.rstrip().endswith(b"%%EOF")
    if shutil.which("file"):  # echter Format-Erkenner des Macs, ob die Datei ein lesbares PDF mit einer Seite ist
        kind = subprocess.run(["file", "-b", "-"], input=data, capture_output=True, check=True).stdout.decode()
        assert kind.startswith("PDF document") and "1 page" in kind, kind
    entry = library_entry(client, "Bericht.pdf")
    assert (entry["mediaType"], entry["kind"], entry["size"]) == ("application/pdf", "file", len(data))
    got = client.get(f"/v1/bots/bot1/library/{entry['id']}").json()["file"]
    assert base64.b64decode(got["data"]) == data and got["size"] == len(data) and got["mediaType"] == "application/pdf"


def test_word_wird_ausgeliefert_und_ist_ein_docx(client, env):
    import asyncio
    asyncio.run(use(env, "create_word", filename="Brief.docx", text="# Betreff\n\nLiebe Grüße & <Dank>"))
    out = card_for(client, "share_file", "Brief.docx")["output"]
    data = app_would_show(out, DOCX_TYPE)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        assert z.testzip() is None and {"[Content_Types].xml", "_rels/.rels", "word/document.xml"} <= set(z.namelist())
        doc = minidom.parseString(z.read("word/document.xml"))  # wohlgeformtes XML, sonst öffnet Word/Pages die Datei nicht
    assert "Liebe Grüße & <Dank>" in "".join(t.firstChild.data for t in doc.getElementsByTagName("w:t") if t.firstChild)
    entry = library_entry(client, "Brief.docx")
    assert entry["mediaType"] == DOCX_TYPE
    assert base64.b64decode(client.get(f"/v1/bots/bot1/library/{entry['id']}").json()["file"]["data"]) == data


@pytest.mark.parametrize("name", sorted(SANDBOX_FILES))
def test_share_file_liefert_inhalt_unveraendert(client, env, name):
    import asyncio
    content, media = SANDBOX_FILES[name]
    env.fake.store[f"/home/daytona/{name}"] = content
    asyncio.run(use(env, "share_file", path=f"/home/daytona/{name}"))
    out = card_for(client, "share_file", name)["output"]
    app_would_show(out, media, content)
    entry = library_entry(client, name)
    assert (entry["mediaType"], entry["size"]) == (media, len(content))
    got = client.get(f"/v1/bots/bot1/library/{entry['id']}").json()["file"]
    assert base64.b64decode(got["data"]) == content and got["mediaType"] == media


def test_pdf_aus_dem_computer_behaelt_mediatyp(client, env):
    import asyncio
    pdf = b"%PDF-1.4\n%fremdes pdf\n%%EOF"
    env.fake.store["/home/daytona/fremd.pdf"] = pdf
    asyncio.run(use(env, "share_file", path="/home/daytona/fremd.pdf"))
    app_would_show(card_for(client, "share_file", "fremd.pdf")["output"], "application/pdf", pdf)
    assert library_entry(client, "fremd.pdf")["mediaType"] == "application/pdf"


def test_datei_ueber_5_mib_wird_abgelehnt_statt_kaputt_angezeigt(client, env):
    import asyncio
    from orbitd.web import Fail
    env.fake.store["/home/daytona/gross.pdf"] = b"0" * (5 * 1024 * 1024 + 1)
    with pytest.raises(Fail, match="größer als 5 MiB"):
        asyncio.run(use(env, "share_file", path="/home/daytona/gross.pdf"))
    assert client.get("/v1/bots/bot1/library").json()["files"] == []


def test_angehaengte_dateien_kommen_im_verlauf_unveraendert_zurueck(client, seed):
    """Anhang der Nutzerin/des Nutzers: Teil `file` mit data:-URL, wie die App ihn sendet; Verlauf liefert ihn bytegleich."""
    attachments = {
        "a.pdf": ("application/pdf", b"%PDF-1.4\n%%EOF"), "b.docx": (DOCX_TYPE, b"PK\x03\x04docx"), "c.md": ("text/markdown", "# ä".encode()),
        "d.txt": ("text/plain", b"hi"), "e.png": ("image/png", PNG), "f.csv": ("text/csv", b"a;b\n1;2\n")}
    parts = [{"type": "text", "text": "Schau dir die Dateien an"}] + [
        {"type": "file", "mediaType": m, "filename": n, "url": f"data:{m};base64,{base64.b64encode(b).decode()}"} for n, (m, b) in attachments.items()]
    mid = uuid.uuid4().hex
    body = {"messages": [{"id": mid, "role": "user", "parts": parts}], "clientData": {"model": "claude-haiku-5-5"}}
    assert client.post("/v1/chats/chat1/turn", json=body).status_code == 200
    stored = next(m for m in client.get("/v1/chats/chat1/messages").json()["messages"] if m["id"] == mid)
    files = {p["filename"]: p for p in stored["parts"] if p["type"] == "file"}
    assert set(files) == set(attachments)
    for name, (media, content) in attachments.items():
        assert files[name]["mediaType"] == media
        head, _, b64 = files[name]["url"].partition(",")
        assert head == f"data:{media};base64" and base64.b64decode(b64) == content
