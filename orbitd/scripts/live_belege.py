"""Live-Belege für das Abnahme-Tor: python scripts/live_belege.py [resume approval stop mcp stil …]

Echter Dienst auf Wegwerf-Datenordner (Port 4318, Schlüsselbund und Sandbox gefälscht, Brain aus), echte Programme, kleinste Modelle.
Schreibt docs/neubau/belege/live.md (Punkte 1-6, gemerged über mehrere Läufe) und .live-stil.json (Rohantworten für Punkt 7).
Fasst echte Daten, echten Dienst (4317) und echten Schlüsselbund nie an. Aufräumen: Dienst und Hilfsserver beenden, Ordner nach ~/.Trash.
"""
import json
import os
import shutil
import signal
import socket
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
BELEGE = ROOT.parent / "docs" / "neubau" / "belege"
PORT = int(os.environ.get("LIVE_PORT", "4318"))  # eigener Port, wenn zwei Beleg-Läufe nebeneinander laufen
PROGS = {k: v for k, v in {"Claude": "claude-haiku-5-5", "Antigravity": "gemini-3.8-flash-low", "Codex": "gpt-6-luna", "Cursor": "cursor-auto"}.items()
         if not os.environ.get("LIVE_PROGS") or k in os.environ["LIVE_PROGS"].split(",")}
WANT = sys.argv[1:] or ["resume", "approval", "stop", "mcp", "stil"]
TURNS = 0
RES_FILE = BELEGE / ".live-ergebnisse.json"
WORD = os.environ.get("LIVE_WORD", "KASTANIE-7")
STIL_FILE = BELEGE / ".live-stil.json"


def short(s, n=500):
    s = " ".join(str(s).split())
    return s if len(s) <= n else s[:n] + " …"


class Env:
    def __init__(self):
        self.data = Path(tempfile.mkdtemp(prefix="orbit-live-"))
        env = {**os.environ, "ORBIT_DATA_DIR": str(self.data), "ORBITD_PORT": str(PORT), "ORBIT_FAKE_SANDBOX": "1", "ORBIT_KEYCHAIN_FAKE": "{}", "ORBIT_BRAIN": "off"}
        self.proc = subprocess.Popen([sys.executable, "-m", "orbitd"], env=env, cwd=ROOT, stderr=open(self.data / "dienst.log", "w"))
        self.base = f"http://127.0.0.1:{PORT}"
        for _ in range(100):
            if (self.data / "service.token").exists() and (self.data / "orbit.sqlite").exists():
                break
            time.sleep(0.1)
        self.head = {"Authorization": "Bearer " + (self.data / "service.token").read_text().strip()}
        for _ in range(100):
            try:
                if httpx.get(self.base + "/v1/health", headers=self.head).status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.1)
        t = int(time.time() * 1000)
        db = sqlite3.connect(self.data / "orbit.sqlite")
        for bid, name in (("bot1", "Nova"), ("bot2", "Eli")):
            db.execute("INSERT INTO bots (id,user_id,third_party_id,name,avatar,color,job,instructions,is_main,sandbox_id,created_at,onboarding_done,dreamer_enabled,heartbeat_enabled,version)"
                       " VALUES (?,'local',?,?,'nepi','#3366ff','Hilft','',?,?,?,1,0,0,1)", (bid, bid, name, 1 if bid == "bot1" else 0, "fake-" + bid, t))
        db.commit()
        db.close()

    def chat(self, cid, bot="bot1"):
        db, t = sqlite3.connect(self.data / "orbit.sqlite"), int(time.time() * 1000)
        db.execute("INSERT INTO chats (id,user_id,kind,name,last_message_at,created_at) VALUES (?,'local','direct',NULL,?,?)", (cid, t, t))
        db.execute("INSERT INTO chat_members (chat_id,bot_id,joined_at) VALUES (?,?,?)", (cid, bot, t))
        db.commit()
        db.close()
        return cid

    def sql(self, q, *a):
        db = sqlite3.connect(f"file:{self.data / 'orbit.sqlite'}?mode=ro", uri=True)
        try:
            return db.execute(q, a).fetchall()
        finally:
            db.close()

    def get(self, p):
        return httpx.get(self.base + p, headers=self.head, timeout=30)

    def post(self, p, body=None):
        return httpx.post(self.base + p, headers=self.head, json=body or {}, timeout=30)

    def turn(self, chat, text, model, out=None):
        """Ein Zug über /turn; sammelt Text, Werkzeuge, Arten. out (dict) wird laufend gefüllt (für Threads)."""
        global TURNS
        TURNS += 1
        r = out if out is not None else {}
        r.update(text="", kinds=set(), tools=[], error=None, done=False, model_seen=None)
        body = {"messages": [{"id": uuid.uuid4().hex, "role": "user", "parts": [{"type": "text", "text": text}]}], "clientData": {"model": model}}
        t0 = time.time()
        try:
            with httpx.stream("POST", f"{self.base}/v1/chats/{chat}/turn", headers=self.head, json=body, timeout=300) as resp:
                for line in resp.iter_lines():
                    if not line.startswith("data: {"):
                        continue
                    c = json.loads(line[6:])
                    k = c.get("type")
                    r["kinds"].add(k)
                    if k == "text-delta":
                        r["text"] += c.get("delta", "")
                    elif k == "tool-input-available":
                        r["tools"].append({"name": c.get("toolName"), "input": c.get("input")})
                    elif k == "tool-output-available":
                        r["tools"].append({"output": short(c.get("output"), 300)})
                    elif k == "error":
                        r["error"] = c.get("errorText")
                    elif k == "start":
                        r["model_seen"] = (c.get("messageMetadata") or {}).get("model")
        except httpx.HTTPError as e:
            r["error"] = f"Strom abgebrochen: {type(e).__name__}"
        r["secs"] = round(time.time() - t0)
        r["done"] = True
        return r

    def wait_card(self, timeout=120, thread=None):
        end = time.time() + timeout
        while time.time() < end:
            cards = self.get("/v1/approvals").json()["approvals"]
            if cards:
                return cards[0]
            time.sleep(0.5)
        return None

    def automations(self):
        return len(self.get("/v1/automations").json()["automations"])

    def close(self):
        self.proc.terminate()
        try:
            self.proc.wait(15)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        log = (self.data / "dienst.log").read_text()[-1200:]
        shutil.move(str(self.data), str(Path.home() / ".Trash" / self.data.name))
        return log


def ok(b):
    return "✅" if b else "⚠️"


# ------------------------------------------------------------------ Punkt 1, 3, 4
def sec_resume(e: Env):
    res = json.loads(RES_FILE.read_text()).get("resume", {}) if RES_FILE.exists() and os.environ.get("LIVE_ONLY") else {}
    for prog, model in PROGS.items():
        if os.environ.get("LIVE_ONLY") not in (None, prog):
            continue
        cid = e.chat("res-" + prog.lower())
        r1 = e.turn(cid, f"Das Merkwort ist {WORD}. Rufe genau einmal das Werkzeug say mit dem Text 'Brücke ok' auf und antworte danach nur mit dem Wort FERTIG.", model)
        r2 = e.turn(cid, "Wie lautet das Merkwort, das ich dir eben genannt habe? Antworte nur mit dem Wort.", model)
        runs = e.sql("SELECT cli_session_id, json_extract(payload,'$.model'), json_extract(payload,'$.wanted'), json_extract(payload,'$.cli') FROM work_runs WHERE chat_id=? ORDER BY started_at", cid)
        said = any(t.get("name") and "say" in str(t["name"]) for t in r1["tools"])
        res[prog] = dict(model=model, t1=short(r1["text"], 200), t1_say=said, t1_err=r1["error"], t1_s=r1["secs"], t2=short(r2["text"], 200), t2_err=r2["error"],
                         merkwort=WORD.split("-")[0].lower() in r2["text"].lower(), runs=[list(x) for x in runs], same_session=len({x[0] for x in runs if x[0]}) == 1 and len(runs) == 2,
                         model_ok=len(runs) == 2 and all(x[1] == model for x in runs) and all(x[2] == model for x in runs))
    return res


# ------------------------------------------------------------------ Punkt 2
def sec_approval(e: Env):
    res = {}
    for prog, model in PROGS.items():
        p = prog.lower()
        before = e.automations()
        out = {}
        pr = ("Rufe genau einmal das Werkzeug automation_create auf: name 'Belegtest-%s', prompt 'Sag hallo', schedule {\"kind\":\"daily\",\"at\":\"08:00\"}, target 'same'. "
              "Sag danach in einem Satz, was passiert ist." % p)
        cid = e.chat("ok-" + p)
        th = threading.Thread(target=e.turn, args=(cid, pr, model, out))
        th.start()
        card = e.wait_card()
        d = {}
        if card:
            time.sleep(float(os.environ.get("LIVE_HOLD", "3")))  # LIVE_HOLD=75: Karte bleibt länger offen als die 60-s-Frist der Programme
            d["card"] = dict(tool=card["tool"], kind=card["kind"], reason=card.get("reason"), approvalKind=card.get("approvalKind"), text=short(card.get("text") or "", 160))
            d["during"] = e.automations() - before
            d["decide"] = e.post(f"/v1/approvals/{card['id']}/decide", {"decision": "once"}).json()
        th.join(300)
        d["after_once"] = e.automations() - before
        d["text_once"] = short(out.get("text"), 300)
        d["err_once"] = out.get("error")
        # ablehnen
        out2 = {}
        cid2 = e.chat("no-" + p)
        pr2 = pr.replace("Belegtest-" + p, "Abgelehnt-" + p)
        th = threading.Thread(target=e.turn, args=(cid2, pr2, model, out2))
        th.start()
        card2 = e.wait_card()
        if card2:
            time.sleep(2)
            d["decide2"] = e.post(f"/v1/approvals/{card2['id']}/decide", {"decision": "deny"}).json()
        th.join(300)
        d["after_deny"] = e.automations() - before - d["after_once"]
        d["text_deny"] = short(out2.get("text"), 300)
        d["err_deny"] = out2.get("error")
        res[prog] = d
    return res


# ------------------------------------------------------------------ Punkt 5
def sec_stop(e: Env):
    cid, out = e.chat("stop-claude"), {}
    th = threading.Thread(target=e.turn, args=(cid, "Schreibe eine sehr lange Geschichte über einen Leuchtturm, mindestens 5000 Wörter, ohne Werkzeuge.", PROGS["Claude"], out))
    t0 = time.time()
    th.start()
    pgid = None
    while time.time() - t0 < 30 and not pgid:
        rows = e.sql("SELECT json_extract(payload,'$.pgid') FROM work_runs WHERE chat_id=?", cid)
        pgid = rows[0][0] if rows and rows[0][0] else None
        time.sleep(0.3)
    alive_before = False
    if pgid:
        try:
            os.killpg(pgid, 0)
            alive_before = True
        except OSError:
            pass
    time.sleep(max(0, 3 - (time.time() - t0)))
    chars = len(out.get("text", ""))
    stop = e.post(f"/v1/chats/{cid}/stop").json()
    th.join(60)
    time.sleep(1)
    alive_after = False
    if pgid:
        try:
            os.killpg(pgid, 0)
            alive_after = True
        except ProcessLookupError:
            pass
        except PermissionError:
            alive_after = True
    ps = subprocess.run(["ps", "-axo", "pgid=,command="], capture_output=True, text=True).stdout
    left = [l for l in ps.splitlines() if str(e.data) in l or (pgid and l.split()[:1] == [str(pgid)])]
    status = e.sql("SELECT status FROM work_runs WHERE chat_id=?", cid)
    return dict(pgid_found=bool(pgid), alive_before=alive_before, chars_before_stop=chars, stop=stop, abort="abort" in out.get("kinds", set()),
                kinds=sorted(map(str, out.get("kinds", []))), alive_after=alive_after, ps_left=len(left), run_status=[x[0] for x in status], error=out.get("error"))


# ------------------------------------------------------------------ Punkt 6
ECHO = '''
import sys
from mcp.server.mcpserver import MCPServer
s = MCPServer("echo-test")
@s.tool()
def echo(text: str) -> str:
    """Gibt den Text zurück."""
    return f"echo:{text}"
s.run("streamable-http", host="127.0.0.1", port=int(sys.argv[1]))
'''


def sec_mcp(e: Env):
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    script = e.data / "echo_mcp.py"
    script.write_text(ECHO)
    srv = subprocess.Popen([sys.executable, str(script), str(port)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd=e.data)
    try:
        time.sleep(2)
        add = e.post("/v1/mcp-servers", {"name": "echo-test", "transport": "http", "url": f"http://127.0.0.1:{port}/mcp"}).json()
        servers = e.get("/v1/mcp-servers").json()["servers"]
        tools = [t["name"] for s in servers for t in s.get("tools", [])]
        status = [s.get("status") for s in servers]
        cid, out = e.chat("mcp-claude"), {}
        th = threading.Thread(target=e.turn, args=(cid, "Rufe das Werkzeug echo des MCP-Servers echo-test genau einmal mit text 'Hallo Brücke' auf und gib mir das Ergebnis wörtlich wieder.", PROGS["Claude"], out))
        th.start()
        card = e.wait_card()
        d = dict(added=add.get("ok"), status=status, tools=tools)
        if card:
            d["card"] = dict(tool=card["tool"], reason=card.get("reason"), approvalKind=card.get("approvalKind"), text=short(card.get("text") or "", 160))
            time.sleep(2)
            d["decide"] = e.post(f"/v1/approvals/{card['id']}/decide", {"decision": "once"}).json()
        th.join(300)
        d["text"] = short(out.get("text"), 300)
        d["result_ok"] = "echo:Hallo Brücke" in out.get("text", "") or any("echo:Hallo" in str(t.get("output", "")) for t in out.get("tools", []))
        d["error"] = out.get("error")
        d["deleted"] = e.session_delete()
        return d
    finally:
        srv.terminate()
        try:
            srv.wait(10)
        except subprocess.TimeoutExpired:
            srv.kill()


def _del(self):
    resp = httpx.delete(self.base + "/v1/mcp-servers/echo-test", headers=self.head, timeout=30)
    return resp.json().get("ok") and not self.get("/v1/mcp-servers").json()["servers"]


Env.session_delete = _del


# ------------------------------------------------------------------ Punkt 7
STIL = [
    ("kurze Frage", "Wie viele Tage hat der Februar in einem Schaltjahr?"),
    ("Fehlerfall", "Schick dem Orbi Zoe per send_message die Nachricht 'Hallo'. Sag mir danach, wie es gelaufen ist."),
    ("längerer Bericht", "Mach mir einen Statusbericht aus diesen Fakten: 12 Tests laufen grün, 2 Commits (a1b2c3d, e4f5a6b) liegen lokal, die Datei docs/neubau/STAND.md ist aktualisiert um 14:32. Offen: Umschalten auf den neuen Dienst und den Rückweg proben. Geprüft habe ich nur die Tests, die App selbst noch nicht."),
    ("Rückfrage", "Ich will morgen einen Termin legen, aber ich weiß noch nicht, ob vormittags oder nachmittags. Frag mich, was mir lieber ist."),
    ("Übergabe", "Gib Eli den Auftrag, die README zu prüfen (per send_message), und sag mir dann Bescheid, wie es weitergeht."),
]


def sec_stil(e: Env):
    e.chat("chatB", "bot2")
    res = []
    for i, (name, prompt) in enumerate(STIL):
        cid = e.chat(f"stil{i}")
        r = e.turn(cid, prompt, PROGS["Claude"])
        if name == "Übergabe":
            time.sleep(1)
            e.post("/v1/chats/chatB/stop")  # Eli wird geweckt; sofort stoppen, damit kein weiterer echter Zug läuft
        sent = e.sql("SELECT assigned_bot_id, brief FROM tasks WHERE parent_chat_id=?", cid)  # send_message zeigt keine Karte im Strom
        res.append(dict(name=name, prompt=prompt, text=r["text"], tools=r["tools"], error=r["error"], sent=sent))
    STIL_FILE.write_text(json.dumps(res, ensure_ascii=False, indent=1))
    return [dict(name=x["name"], chars=len(x["text"]), tools=[t.get("name") for t in x["tools"] if t.get("name")]) for x in res]


def main() -> int:
    e = Env()
    results = json.loads(RES_FILE.read_text()) if RES_FILE.exists() else {}
    try:
        for name in WANT:
            try:
                results[name] = globals()["sec_" + {"stil": "stil"}.get(name, name)](e)
            except Exception as ex:  # ein Abschnitt darf die anderen nicht mitreißen
                results[name] = {"fehler": f"{type(ex).__name__}: {short(ex, 300)}"}
            print(name, json.dumps(results[name], ensure_ascii=False, default=str)[:1500])
            RES_FILE.write_text(json.dumps(results, ensure_ascii=False, indent=1, default=str))
    finally:
        log = e.close()
        print(f"echte Züge in diesem Lauf: {TURNS}")
        if "Traceback" in log:
            print("--- Dienst-Log (Ende) ---\n" + log)
    return 0


if __name__ == "__main__":
    sys.exit(main())
