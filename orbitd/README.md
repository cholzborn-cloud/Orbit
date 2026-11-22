# orbitd (Python)

Hintergrunddienst von Orbit. Start: `.venv/bin/python -m orbitd` (Umgebung: `ORBITD_PORT`, `ORBIT_DATA_DIR`). Tests: `.venv/bin/python -m pytest -q`.
Schnittstelle für Frontends: `docs/neubau/SCHNITTSTELLE.md`. Herkunft der Bauteile: `docs/neubau/VORBILDER.md`.

## Bauregeln (für jeden, der hier Code schreibt)

- **Routen:** ein Modul je Aufgabe unter `orbitd/routes/`, Handler mit `@route("GET", "/v1/bots/{id}")` aus `orbitd/web.py`. Signatur `async def name(req: Req)`. Rückgabe `dict` (wird JSON) oder `None` (= `{"ok": true}`). `req.params`, `req.query`, `req.obj()` (Körper als Objekt), `req.ctx` (`.db`, `.bus`, `.cfg`).
- **Fehler:** Aktionsfehler `raise Fail("deutscher Satz.")` → `{"ok": false, "error": …}` (404, wenn der Text „nicht gefunden“ enthält, sonst 400). Dienstfehler `raise HttpError(status, "…")` → `{"error": …}`. Alle Texte deutsch und wortgleich zum alten Dienst, wo es einen gibt.
- **Datenbank:** `ctx.db` (`orbitd/db.py`): `all/one/val/run`, `with db.tx():` für alles, was zusammengehört. Zeiten sind Millisekunden (`now_ms()`), JSON-Spalten mit `dumps`/`loads`. Nur additive Schemaänderungen, als neue Datei in `orbitd/migrations/`. Nutzer ist immer `"local"`.
- **Ereignisse:** `ctx.bus.publish({...})` erst NACH dem Commit.
- **Schlüssel:** nie in Dateien, Logs, Antworten. Nur `orbitd/keychain.py` liest sie (Schlüsselbund).
- **Tests:** nur gegen frische Ordner unter `/tmp` (Fixtures in `tests/conftest.py`: `client`, `ctx`, `seed`). Nie gegen `~/Library/Application Support/Orbit`.
- **Stil:** so wenig Code wie möglich, keine Schichten auf Vorrat, kein ORM, keine neuen Abhängigkeiten ohne Not. Kommentare nur für das Warum, deutsch.
- **Vertrag:** Feldnamen und Formen wie in `plan/API.md` und den Aufnahmen des alten Dienstes in `tests/contract/golden/` (dort steht die echte Antwortform je Route).
