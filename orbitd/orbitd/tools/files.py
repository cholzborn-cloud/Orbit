"""Datei-Ergebnisse für den Chat: share_file-Karte + Zeile in bot_files, create_pdf, create_word. Vorlage: lib/chat/pdf-tool.ts, lib/files/media-type.ts, service/src/library.ts.

PDF und DOCX entstehen ohne Zusatzpakete (selbst geschrieben): schlichtes Text-PDF mit Standardschrift Helvetica (WinAnsi), DOCX als zip mit minimalem WordprocessingML.
"""
import base64
import hashlib
import io
import re
import zipfile
from xml.sax.saxutils import escape

from ..db import dumps, loads, new_id, now_ms
from ..runtime.contract import tool
from ..web import Fail

MAX_SHARE = 5 * 1024 * 1024
MAX_TEXT = 256 * 1024
MEDIA_TYPES = {
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml",
    "pdf": "application/pdf", "doc": "application/msword", "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel", "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt": "application/vnd.ms-powerpoint", "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "odt": "application/vnd.oasis.opendocument.text", "ods": "application/vnd.oasis.opendocument.spreadsheet",
    "odp": "application/vnd.oasis.opendocument.presentation", "rtf": "application/rtf", "zip": "application/zip", "gz": "application/gzip",
    "tar": "application/x-tar", "json": "application/json", "csv": "text/csv", "md": "text/markdown", "html": "text/html",
    "txt": "text/plain", "mp4": "video/mp4", "mp3": "audio/mpeg", "wav": "audio/wav",
}


def media_type(filename: str) -> str:
    return MEDIA_TYPES.get(filename.rsplit(".", 1)[-1].lower(), "application/octet-stream")


# ---------------------------------------------------------------- Karte + Bibliothek
def share(run, filename: str, media: str, data: bytes, card_input: dict) -> dict:
    """Zeigt eine Datei als Karte `share_file` im Chat und trägt sie in bot_files ein (gleiche ID-Regel wie der Verlaufs-Index in routes/bots.py, daher keine Dublette)."""
    if len(data) > MAX_SHARE:
        raise Fail("Die Datei ist größer als 5 MiB.")
    b64 = base64.b64encode(data).decode("ascii")
    out = {"filename": filename, "mediaType": media, "size": len(data), "data": b64}
    call_id = new_id()
    run.card("share_file", call_id, card_input, out)
    db = run.ctx.db
    row = db.one("SELECT parts FROM chat_messages WHERE id=? AND chat_id=?", run.message_id, run.chat_id)
    parts = loads(row["parts"], []) if row else []
    index = next((i for i, p in enumerate(parts) if isinstance(p, dict) and p.get("toolCallId") == call_id), 0)
    file_id = hashlib.sha256(dumps([run.chat_id, run.message_id, index, b64]).encode()).hexdigest()
    db.run("INSERT OR IGNORE INTO bot_files (id,bot_id,filename,media_type,size,chat_id,message_id,created_at,kind,data) VALUES (?,?,?,?,?,?,?,?,?,?)",
           file_id, run.bot["id"], filename, media, len(data), run.chat_id, run.message_id, now_ms(), "file", b64)
    return out


def shared_text(out: dict) -> str:
    return f"Shared {out['filename']} ({out['size']} bytes) with the user."


# ---------------------------------------------------------------- Markdown (einfach): Überschriften, Listen, Absätze
def blocks(text: str) -> list[tuple[str, str]]:
    """Zeilen als (Art, Text): h1|h2|h3|li|p|blank."""
    out = []
    for line in text.replace("\r\n", "\n").replace("\r", "\n").replace("\t", "    ").split("\n"):
        s = line.strip()
        if not s:
            out.append(("blank", ""))
        elif m := re.match(r"(#{1,3})\s+(.*)", s):
            out.append((f"h{len(m.group(1))}", m.group(2)))
        elif m := re.match(r"[-*+]\s+(.*)", s):
            out.append(("li", "• " + m.group(1)))
        elif re.match(r"\d+[.)]\s+", s):
            out.append(("li", s))
        else:
            out.append(("p", line.rstrip()))
    return out


# ---------------------------------------------------------------- PDF
# Helvetica-Breiten (1/1000 em) für ASCII 32..126; alles andere zählt 556 (shortcut: Umlaute und Sonderzeichen nur genähert, nur für den Zeilenumbruch).
_W = ([278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278] + [556] * 10 + [278, 278, 584, 584, 584, 556, 1015]
      + [667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611]
      + [278, 278, 278, 469, 556, 333]
      + [556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500]
      + [334, 260, 334, 584])
PAGE_W, PAGE_H, MARGIN = 595, 842, 56
STYLE = {"h1": ("F2", 18, 1.1), "h2": ("F2", 14, 1.1), "h3": ("F2", 12, 1.1), "p": ("F1", 11, 1.0), "li": ("F1", 11, 1.0)}


def _width(s: str, size: float, bold: bool) -> float:
    return sum(_W[ord(c) - 32] if 32 <= ord(c) <= 126 else 556 for c in s) * size / 1000 * (1.1 if bold else 1)


def _wrap(s: str, size: float, bold: bool, limit: float) -> list[str]:
    lines, cur = [], ""
    for word in s.split(" "):
        trial = f"{cur} {word}" if cur else word
        if _width(trial, size, bold) <= limit:
            cur = trial
            continue
        if cur:
            lines.append(cur)
            cur = ""
        while _width(word, size, bold) > limit:  # überlanges Wort hart trennen
            n = max(1, next((i for i in range(1, len(word) + 1) if _width(word[:i], size, bold) > limit), len(word)) - 1)
            lines.append(word[:n])
            word = word[n:]
        cur = word
    lines.append(cur)
    return lines


def render_pdf(text: str) -> bytes:
    pages: list[list[str]] = [[]]
    y = PAGE_H - MARGIN
    for kind, body in blocks(text):
        font, size, _ = STYLE.get(kind, STYLE["p"])
        leading = size * 1.3
        if kind == "blank":
            y -= 7
            continue
        indent = 14 if kind == "li" else 0
        before = 8 if kind.startswith("h") else 0
        for n, line in enumerate(_wrap(body, size, font == "F2", PAGE_W - 2 * MARGIN - indent)):
            if y - (before if n == 0 else 0) - leading < MARGIN and pages[-1]:
                pages.append([])
                y = PAGE_H - MARGIN
            y -= (before if n == 0 else 0) + leading
            hexed = line.encode("cp1252", "replace").hex()
            pages[-1].append(f"BT /{font} {size} Tf {MARGIN + indent} {y:.1f} Td <{hexed}> Tj ET")
    objs: list[bytes] = [b"<< /Type /Catalog /Pages 2 0 R >>", b"", b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
                         b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"]
    kids = []
    for lines in pages:
        content = "\n".join(lines).encode("ascii")
        page_no = len(objs) + 1
        kids.append(f"{page_no} 0 R")
        objs.append(f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {PAGE_W} {PAGE_H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {page_no + 1} 0 R >>".encode())
        objs.append(b"<< /Length %d >>\nstream\n" % len(content) + content + b"\nendstream")
    objs[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {len(kids)} >>".encode()
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for i, body in enumerate(objs, 1):
        offsets.append(len(out))
        out += b"%d 0 obj\n" % i + body + b"\nendobj\n"
    xref = len(out)
    out += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objs) + 1)
    for off in offsets:
        out += b"%010d 00000 n \n" % off
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF" % (len(objs) + 1, xref)
    return bytes(out)


# ---------------------------------------------------------------- DOCX
_CTRL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def render_docx(text: str) -> bytes:
    paras = []
    for kind, body in blocks(text):
        body = escape(_CTRL.sub("", body))
        size = {"h1": 36, "h2": 28, "h3": 24}.get(kind)
        props = f"<w:rPr><w:b/><w:sz w:val=\"{size}\"/></w:rPr>" if size else ""
        ppr = "<w:pPr><w:ind w:left=\"360\"/></w:pPr>" if kind == "li" else ""
        paras.append(f"<w:p>{ppr}<w:r>{props}<w:t xml:space=\"preserve\">{body}</w:t></w:r></w:p>")
    ns = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
    files = {
        "[Content_Types].xml": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                               '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
                               '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        "_rels/.rels": '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                       '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
        "word/document.xml": f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="{ns}"><w:body>{"".join(paras)}</w:body></w:document>',
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, content in files.items():
            z.writestr(name, content.encode("utf-8"))
    return buf.getvalue()


# ---------------------------------------------------------------- Werkzeuge
def _schema(ext: str, label: str) -> dict:
    return {"type": "object", "properties": {
        "filename": {"type": "string", "maxLength": 120, "description": f"Name with .{ext}"},
        "text": {"type": "string", "minLength": 1, "maxLength": MAX_TEXT, "description": f"Complete text (up to 256 KiB). Markdown headings (#) and lists (-) are kept as {label} structure."}},
        "required": ["filename", "text"]}


def _make(run, a, ext: str, label: str, render):
    name, text = a["filename"], a["text"]
    ok = re.fullmatch(r"[^\W_][\w .-]*\." + ext, name) and ".." not in name and len(name) <= 120
    if not ok or len(text.encode("utf-8")) > MAX_TEXT or "\0" in text:
        raise Fail(f"Bitte prüfe {label}-Dateiname und Text (maximal 256 KiB).")
    data = render(text)
    if len(data) > MAX_SHARE:
        raise Fail(f"{label} ist größer als 5 MiB.")
    return shared_text(share(run, name, media_type(name), data, {"filename": name}))


@tool("create_pdf", "Create a downloadable PDF from plain text. Supply a .pdf filename and the complete text (up to 256 KiB).", _schema("pdf", "PDF"),
      label=lambda a: f"Erstellt PDF {a.get('filename', '')}".strip())
async def create_pdf(run, a):
    return _make(run, a, "pdf", "PDF", render_pdf)


@tool("create_word", "Create a downloadable Word .docx document from plain text. Supply a .docx filename and the complete text (up to 256 KiB).", _schema("docx", "Word"),
      label=lambda a: f"Erstellt Word-Datei {a.get('filename', '')}".strip())
async def create_word(run, a):
    return _make(run, a, "docx", "Word", render_docx)
