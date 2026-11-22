"""Nimmt die Antworten eines orbitd (alt oder neu) als Golden-Dateien auf.

Aufruf: record.py BASIS_URL DATENORDNER [AUSGABEORDNER]
  BASIS_URL    z. B. http://127.0.0.1:4319
  DATENORDNER  ORBIT_DATA_DIR des Testdienstes (dort liegt service.token)
Nur lesende GET-Routen plus harmlose Fehlerfälle. Nie Modell-/CLI-Aufrufe, nie Authorization speichern.
Alles geht vor dem Speichern durch anonymize.clean (keine echten Texte, E-Mail-Adressen, Pfade).
"""
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse

import httpx

from anonymize import PUBLIC, clean  # liegt neben dieser Datei

base = sys.argv[1].rstrip("/")
token = (Path(sys.argv[2]) / "service.token").read_text().strip()
out = Path(sys.argv[3]) if len(sys.argv) > 3 else Path(__file__).parent / "golden"
out.mkdir(parents=True, exist_ok=True)
host = urlparse(base).netloc
AUTH = {"authorization": f"Bearer {token}", "host": host}
count = 0


def save(method, path, r, body=None):
    global count
    ctype = r.headers.get("content-type") if r is not None else None
    if body is None:
        try:
            body = r.json()
        except Exception:
            body = r.text
    name = re.sub(r"[^A-Za-z0-9_.-]", "_", f"{method.lower()}_{path.strip('/').replace('/', '_')}")
    body = clean(body, "", name.startswith(PUBLIC))  # nie echte Inhalte auf die Platte
    data = {"method": method, "path": path, "status": r.status_code,
            "headers": {"content-type": ctype} if ctype else {}, "body": body}
    (out / f"{name}.json").write_text(json.dumps(data, indent=2, ensure_ascii=False, sort_keys=True) + "\n")
    count += 1
    print(r.status_code, method, path)
    return data["body"]


def call(method, path, headers=None, content=None):
    h = dict(AUTH if headers is None else headers)
    if content is not None:
        h["content-type"] = "application/json"
    return httpx.request(method, base + path, headers=h, content=content, timeout=30)


def find_ids(body, key="id"):
    """Alle Werte von `key` in Wörterbüchern innerhalb von Listen, in Reihenfolge."""
    found = []

    def walk(x):
        if isinstance(x, dict):
            for k, v in x.items():
                walk(v)
        elif isinstance(x, list):
            for item in x:
                if isinstance(item, dict) and isinstance(item.get(key), str):
                    found.append(item[key])
                walk(item)

    walk(body)
    return found


def first(body, key="id"):
    ids = find_ids(body, key)
    return ids[0] if ids else None


simple = ["/v1/health", "/v1/approvals", "/v1/status", "/v1/budget", "/v1/keys", "/v1/plugins",
          "/v1/bots", "/v1/chats", "/v1/models", "/v1/settings", "/v1/settings/instructions/default",
          "/v1/marketplace", "/v1/settings/rules", "/v1/skills", "/v1/skills/slash", "/v1/skills/proposals",
          "/v1/connectors", "/v1/automations", "/v1/automations/unread", "/v1/search?q=a", "/v1/usage",
          "/v1/jev", "/v1/tasks", "/v1/tasks/active", "/v1/undo/history", "/v1/routines", "/v1/orbis"]
bodies = {p: save("GET", p, call("GET", p)) for p in simple}

bot = first(bodies["/v1/bots"])
chat = first(bodies["/v1/chats"])
routine = first(bodies["/v1/routines"])
orbi = first(bodies["/v1/orbis"])
task = first(bodies["/v1/tasks"])
auto = first(bodies["/v1/automations"])
chat_paths = [] if not chat else [f"/v1/chats/{chat}/messages", f"/v1/chats/{chat}/reactions",
                                  f"/v1/chats/{chat}/prompt-preview", f"/v1/todos/{chat}"]
detail = chat_paths
if bot:
    detail += [f"/v1/bots/{bot}/{s}" for s in ("library", "memory", "memory-trash", "heartbeat", "dreamer")]
if routine:
    detail.append(f"/v1/routines/{routine}")
if orbi:
    detail += [f"/v1/orbis/{orbi}", f"/v1/orbis/{orbi}/scratchpad"]
if task:
    detail.append(f"/v1/tasks/{task}")
if auto:
    detail.append(f"/v1/automations/{auto}/runs")
    detail.append(f"/v1/reminders/{auto}/active")
for p in detail:
    bodies[p] = save("GET", p, call("GET", p))

if bot:
    for sub, key in (("memory", "name"), ("library", "id")):
        ids = find_ids(bodies.get(f"/v1/bots/{bot}/{sub}"), key)
        if ids:
            save("GET", f"/v1/bots/{bot}/{sub}/{ids[0]}", call("GET", f"/v1/bots/{bot}/{sub}/{ids[0]}"))

# Fehlerfälle
save("GET", "/v1/bots?err=401", call("GET", "/v1/bots?err=401", {"authorization": "Bearer falsch", "host": host}))
save("GET", "/v1/bots?err=403", call("GET", "/v1/bots?err=403", {**AUTH, "host": "evil.example"}))
save("GET", "/v1/gibt-es-nicht", call("GET", "/v1/gibt-es-nicht"))
save("GET", "/v1/tasks/gibt-es-nicht", call("GET", "/v1/tasks/gibt-es-nicht"))
save("GET", "/v1/routines/gibt-es-nicht", call("GET", "/v1/routines/gibt-es-nicht"))
for method, p in (("POST", "/v1/bots"), ("PUT", "/v1/settings/theme"), ("POST", "/v1/settings/rules"), ("POST", "/v1/skills")):
    save(method, p, call(method, p, content="{kaputt"))

# Ereignisse: die ersten 3 (Snapshot zuerst), dann Verbindung schließen
events = []
with httpx.stream("GET", base + "/v1/events", headers=AUTH, timeout=httpx.Timeout(10, read=4)) as r:
    buf = ""
    try:
      for chunk in r.iter_text():
        buf += chunk
        while "\n\n" in buf and len(events) < 3:
            raw, buf = buf.split("\n\n", 1)
            data = "".join(l[5:].strip() for l in raw.splitlines() if l.startswith("data:"))
            if data:
                try:
                    events.append(json.loads(data))
                except ValueError:
                    events.append(data)
        if len(events) >= 3:
            break
    except httpx.ReadTimeout:
      pass  # weniger als 3 Ereignisse im Leerlauf: aufnehmen, was kam
    save("GET", "/v1/events", r, events)

print(f"{count} Aufnahmen in {out}")
