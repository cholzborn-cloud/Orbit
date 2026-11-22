"""Live-Prüfung mit echten Programmen auf einem Wegwerf-Datenordner: python scripts/live_check.py [modell …]

Je Modell ein Zug, der das Orbit-Werkzeug `say` rufen muss. Belegt: Programm startet, Text kommt, Werkzeug läuft über die Brücke.
Fasst die echten Daten nie an (eigener Ordner, Port 4318), kein Daytona, Schlüsselbund wird nicht gelesen.
"""
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

import httpx

PORT = 4318
MODELS = sys.argv[1:] or ["claude-haiku-5-5", "gemini-3.8-flash-low", "gpt-6-luna", "cursor-auto"]
PROMPT = os.environ.get("LIVE_PROMPT") or "Rufe genau einmal das Werkzeug say mit dem Text 'Brücke ok' auf und antworte danach nur mit dem Wort FERTIG."


def main() -> int:
    data = Path(tempfile.mkdtemp(prefix="orbit-live-"))
    env = {**os.environ, "ORBIT_DATA_DIR": str(data), "ORBITD_PORT": str(PORT), "ORBIT_FAKE_SANDBOX": "1", "ORBIT_KEYCHAIN_FAKE": "{}", "ORBIT_BRAIN": "off"}
    proc = subprocess.Popen([sys.executable, "-m", "orbitd"], env=env, cwd=Path(__file__).parent.parent, stderr=open(data / "dienst.log", "w"))
    base, failed = f"http://127.0.0.1:{PORT}", 0
    try:
        for _ in range(100):
            if (data / "service.token").exists() and (data / "orbit.sqlite").exists():
                break
            time.sleep(0.1)
        head = {"Authorization": "Bearer " + (data / "service.token").read_text().strip()}
        for _ in range(100):
            try:
                if httpx.get(base + "/v1/health", headers=head).status_code == 200:
                    break
            except httpx.HTTPError:
                time.sleep(0.1)
        db, t = sqlite3.connect(data / "orbit.sqlite"), int(time.time() * 1000)
        db.execute("INSERT INTO bots (id,user_id,third_party_id,name,avatar,color,job,instructions,is_main,sandbox_id,created_at,onboarding_done,dreamer_enabled,heartbeat_enabled,version)"
                   " VALUES ('bot1','local','bot1','Nova','nepi','#3366ff','Hilft','',1,'fake-bot1',?,1,0,0,1)", (t,))
        for i, _ in enumerate(MODELS):
            db.execute("INSERT INTO chats (id,user_id,kind,name,last_message_at,created_at) VALUES (?,'local','direct',NULL,?,?)", (f"chat{i}", t, t))
            db.execute("INSERT INTO chat_members (chat_id,bot_id,joined_at) VALUES (?,'bot1',?)", (f"chat{i}", t))
        db.commit()
        db.close()
        for i, model in enumerate(MODELS):
            body = {"messages": [{"id": uuid.uuid4().hex, "role": "user", "parts": [{"type": "text", "text": PROMPT}]}], "clientData": {"model": model}}
            text, kinds, error, start, raw = "", set(), None, time.time(), ""
            try:
                with httpx.stream("POST", f"{base}/v1/chats/chat{i}/turn", headers=head, json=body, timeout=240) as r:
                    for line in r.iter_lines():
                        raw += line
                        if line.startswith("data: {"):
                            c = json.loads(line[6:])
                            kinds.add(c.get("type"))
                            text += c.get("delta", "") if c.get("type") == "text-delta" else ""
                            if c.get("type") == "error":
                                error = c.get("errorText")
            except httpx.HTTPError as e:
                error = f"Strom abgebrochen: {type(e).__name__}"
            said = "tool-input-available" in kinds
            ok = bool(text.strip()) and said and not error
            failed += not ok
            print(f"{'OK  ' if ok else 'ROT '} {model}: {time.time() - start:.0f}s, Text={text.strip()[:400]!r}, say={"ja" if said else "nein"}, Arten={sorted(map(str, kinds))}, Fehler={error}")
    finally:
        proc.terminate()
        try:
            proc.wait(15)
        except subprocess.TimeoutExpired:
            proc.kill()
        log = (data / "dienst.log").read_text()[-1500:]
        if failed and log.strip():
            print("--- Dienst-Log (Ende) ---\n" + log)
        shutil.move(str(data), str(Path.home() / ".Trash" / data.name))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
