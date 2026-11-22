"""SQLite: eine Verbindung, gleiche PRAGMAs wie der alte Dienst, additive Migrationen mit Sicherung davor.

shortcut: synchrones sqlite3 im Event-Loop (lokale Datei, Abfragen < 1 ms); bei spürbaren Hängern auf einen Thread umziehen.
"""
import json
import sqlite3
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

MIGRATIONS = Path(__file__).parent / "migrations"
# Tabellen, die der Stand des alten Dienstes (Drizzle 0012) mindestens haben muss.
BASE_TABLES = {"bots", "chats", "chat_members", "chat_messages", "work_runs", "pending_interactions", "automations", "user_settings"}


def now_ms() -> int:
    return int(time.time() * 1000)


def new_id() -> str:
    return uuid.uuid4().hex


class DB:
    def __init__(self, path: Path):
        self.path = path
        self.con = sqlite3.connect(path, isolation_level=None, check_same_thread=False)
        self.con.row_factory = sqlite3.Row
        for pragma in ("foreign_keys=ON", "journal_mode=WAL", "busy_timeout=5000"):
            self.con.execute(f"PRAGMA {pragma}")

    def all(self, sql: str, *args) -> list[sqlite3.Row]:
        return self.con.execute(sql, args).fetchall()

    def one(self, sql: str, *args) -> sqlite3.Row | None:
        return self.con.execute(sql, args).fetchone()

    def val(self, sql: str, *args):
        row = self.con.execute(sql, args).fetchone()
        return row[0] if row else None

    def run(self, sql: str, *args) -> int:
        """Führt aus und liefert die Zahl geänderter Zeilen (für atomare Claims: == 1 prüfen)."""
        return self.con.execute(sql, args).rowcount

    @contextmanager
    def tx(self):
        """Eine Transaktion; verschachtelt läuft sie in der äußeren mit."""
        if self.con.in_transaction:
            yield self
            return
        self.con.execute("BEGIN IMMEDIATE")
        try:
            yield self
            self.con.execute("COMMIT")
        except BaseException:
            self.con.execute("ROLLBACK")
            raise

    def close(self):
        self.con.close()


def loads(text, default=None):
    if text is None:
        return default
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return default


def dumps(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def open_db(path: Path) -> DB:
    """Öffnet die Datenbank und wendet fehlende Migrationen an. Eine neue (leere) Datenbank bekommt das Grundschema."""
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    existed = path.exists() and path.stat().st_size > 0
    db = DB(path)
    tables = {r[0] for r in db.all("SELECT name FROM sqlite_master WHERE type='table'")}
    if not existed or not tables:
        db.con.executescript((MIGRATIONS / "0000_grundschema.sql").read_text())
    elif not BASE_TABLES <= tables:
        raise SystemExit("Die Datenbank hat nicht den erwarteten Stand. Es wird nichts verändert.")
    version = db.val("PRAGMA user_version")
    pending = sorted(p for p in MIGRATIONS.glob("[0-9]*.sql") if int(p.name[:4]) > max(version, 0) and p.name[:4] != "0000")
    if pending:
        if existed:
            backup = f"{path}.vor-migration-{now_ms()}.bak"
            db.con.execute("VACUUM INTO ?", (backup,))  # scheitert die Sicherung, wird nicht migriert
        for file in pending:
            # executescript beendet offene Transaktionen selbst; BEGIN/COMMIT stehen deshalb im Skripttext.
            db.con.executescript(f"BEGIN IMMEDIATE;\n{file.read_text()}\nPRAGMA user_version={int(file.name[:4])};\nCOMMIT;")
    return db
