#!/usr/bin/env python3
"""Prüft, dass die Migration des neuen Dienstes die echten Daten unverändert lässt. Gibt nur Zahlen und Namen aus, nie Inhalte.

Aufruf: .venv/bin/python scripts/check_migration.py [DATENBANK]   (Standard: echte orbit.sqlite, nur lesend per VACUUM INTO)
Ablauf: Kopie nach /tmp -> Zeilen je Tabelle, Spalten, Prüfsumme je Chat festhalten -> open_db() der Kopie -> vergleichen -> Kopie in den Papierkorb.
Exit 0 = alle Prüfungen bestanden.
"""
import hashlib
import shutil
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from orbitd import config  # noqa: E402
from orbitd.db import open_db  # noqa: E402

TOP_CHATS = 20


def snapshot(path: Path) -> dict:
    con = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    try:
        tables = [r[0] for r in con.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")]
        cols = {t: {r[1] for r in con.execute(f'PRAGMA table_info("{t}")')} for t in tables}
        rows = {t: con.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0] for t in tables}
        sums = {}
        if "chat_messages" in tables:
            for chat_id, n in con.execute("SELECT chat_id, count(*) FROM chat_messages GROUP BY chat_id ORDER BY 2 DESC, 1 LIMIT ?", (TOP_CHATS,)).fetchall():
                h = hashlib.sha256()
                for row in con.execute("SELECT id, role, parts, metadata, position, created_at FROM chat_messages WHERE chat_id=? ORDER BY position, id", (chat_id,)):
                    h.update(repr(row).encode())
                sums[chat_id] = (n, h.hexdigest())
        return {"tables": tables, "cols": cols, "rows": rows, "sums": sums, "version": con.execute("PRAGMA user_version").fetchone()[0]}
    finally:
        con.close()


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else config.REAL_DATA_DIR / "orbit.sqlite"
    work = Path(tempfile.mkdtemp(prefix="orbit-migcheck-", dir="/tmp"))
    copy = work / "orbit.sqlite"
    ok = True
    try:
        ro = sqlite3.connect(f"file:{src}?mode=ro", uri=True)
        ro.execute("VACUUM INTO ?", (str(copy),))
        ro.close()
        before = snapshot(copy)
        db = open_db(copy)
        db.close()
        after = snapshot(copy)
        backups = list(work.glob("orbit.sqlite.vor-migration-*.bak"))

        def check(label: str, good: bool, detail: str = "") -> None:
            nonlocal ok
            ok = ok and good
            print(f"{'OK    ' if good else 'FEHLER'} {label}{(': ' + detail) if detail else ''}")

        print(f"Datenbank: user_version {before['version']} -> {after['version']}, {len(before['tables'])} Tabellen vorher, {len(after['tables'])} nachher, "
              f"{sum(before['rows'].values())} Zeilen vorher")
        gone = [t for t in before["tables"] if t not in after["tables"]]
        check("alle alten Tabellen da", not gone, f"{len(before['tables'])} geprüft" + (f", fehlen: {', '.join(gone)}" if gone else ""))
        lost = [f"{t}.{c}" for t in before["tables"] if t in after["cols"] for c in before["cols"][t] - after["cols"][t]]
        check("alle alten Spalten da", not lost, f"{sum(len(c) for c in before['cols'].values())} geprüft" + (f", fehlen: {', '.join(lost)}" if lost else ""))
        diff = [f"{t} ({before['rows'][t]} -> {after['rows'].get(t)})" for t in before["tables"] if before["rows"][t] != after["rows"].get(t)]
        check("Zeilenzahlen je Tabelle gleich", not diff, f"{len(before['rows'])} Tabellen" + (f", abweichend: {', '.join(diff)}" if diff else ""))
        bad = [c for c, v in before["sums"].items() if after["sums"].get(c) != v]
        total = sum(n for n, _ in before["sums"].values())
        check(f"Prüfsummen der {len(before['sums'])} größten Chats gleich", not bad, f"{total} Nachrichten" + (f", abweichend: {len(bad)} Chats" if bad else ""))
        if before["version"] < after["version"]:
            check("Sicherung vor der Migration vorhanden", len(backups) == 1 and backups[0].stat().st_size > 0, f"{len(backups)} Datei(en)")
        else:
            print("OK     keine Migration nötig, Sicherung entfällt")
    finally:
        trash = Path.home() / ".Trash"
        trash.mkdir(exist_ok=True)
        shutil.move(str(work), str(trash / f"{work.name}-{time.strftime('%Y%m%d-%H%M%S')}"))
        print("Kopie aufgeräumt (Papierkorb).")
    print("ERGEBNIS: " + ("bestanden" if ok else "FEHLGESCHLAGEN"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
