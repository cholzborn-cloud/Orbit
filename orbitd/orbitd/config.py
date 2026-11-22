"""Einstellungen aus der Umgebung. Schlüssel werden hier NIE gelesen (nur Schlüsselbund, siehe keychain.py)."""
import os
import tempfile
import re
import uuid
from functools import lru_cache
from dataclasses import dataclass
from pathlib import Path

REAL_DATA_DIR = Path.home() / "Library" / "Application Support" / "Orbit"
RUST_DATA_DIR = REAL_DATA_DIR.with_name("Orbit Rust")
USER = "local"  # es gibt genau einen lokalen Nutzer


def isolated_dir() -> Path | None:
    if os.environ.get("ORBIT_ISOLATED_PROFILE") != "1":
        return None
    raw = os.environ.get("ORBIT_DATA_DIR")
    if not raw or not Path(raw).is_absolute():
        raise SystemExit("Ein getrenntes Orbit-Profil braucht einen absoluten Datenordner.")
    data = Path(raw).resolve()
    if data == REAL_DATA_DIR.resolve() or REAL_DATA_DIR.resolve() in data.parents:
        raise SystemExit("Das getrennte Orbit-Profil braucht einen eigenen Datenordner.")
    return data


@lru_cache
def _profile_id(data: Path) -> str:
    data.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = data / "profile-id"
    if not path.exists():
        with tempfile.NamedTemporaryFile(dir=data) as f:
            f.write(str(uuid.uuid4()).encode())
            f.flush()
            try:
                os.link(f.name, path)
            except FileExistsError:
                pass
    identity = path.read_text(encoding="ascii")
    if not re.fullmatch(r"[a-f0-9-]{36}", identity):
        raise SystemExit("Die Orbit-Profilkennung ist ungültig.")
    return identity


def profile_id() -> str | None:
    data = isolated_dir()
    return _profile_id(data) if data is not None else None


def profile_cli_home() -> Path | None:
    data = isolated_dir()
    if data is None:
        return None
    home = data / "cli-home"
    home.mkdir(mode=0o700, exist_ok=True)
    return home


@dataclass(frozen=True)
class Config:
    data_dir: Path
    port: int
    fake_sandbox: bool
    fake_cli: str | None  # Pfad zur Attrappen-CLI (nur Tests)
    sandbox: bool = True  # Systemsperre für Unterprozesse (sandbox.py); aus nur mit Datenkopie (Tests)

    @property
    def db_path(self) -> Path:
        return self.data_dir / "orbit.sqlite"

    @property
    def token_path(self) -> Path:
        return self.data_dir / "service.token"

    @property
    def work_dir(self) -> Path:
        """Arbeitsordner der Programme: NIE im Datenordner (Cursor und Antigravity lesen dort ohne Rückfrage)."""
        if self.is_real:
            return Path.home() / "Library" / "Caches" / self.data_dir.name / "cli-work"
        return self.data_dir.parent / f"{self.data_dir.name}-cli-work"  # Datenkopie (Tests): Geschwister im selben Ordner

    @property
    def is_real(self) -> bool:
        return self.data_dir.resolve() in (REAL_DATA_DIR.resolve(), RUST_DATA_DIR.resolve())


def load() -> Config:
    raw = os.environ.get("ORBITD_PORT", "4317")
    if not raw.isdigit() or not 1024 <= int(raw) <= 65535:
        raise SystemExit("ORBITD_PORT ist ungültig.")
    cfg = Config(
        data_dir=Path(os.environ.get("ORBIT_DATA_DIR") or REAL_DATA_DIR),
        port=int(raw),
        fake_sandbox=os.environ.get("ORBIT_FAKE_SANDBOX") == "1",
        fake_cli=os.environ.get("ORBIT_FAKE_CLI") or None,
        sandbox=os.environ.get("ORBIT_NO_SANDBOX") != "1",
    )
    # Attrappen dürfen nie an die echten Daten.
    if cfg.is_real and (cfg.fake_sandbox or cfg.fake_cli):
        raise SystemExit("Attrappen (ORBIT_FAKE_*) sind nur mit einer Datenkopie über ORBIT_DATA_DIR erlaubt.")
    if cfg.is_real and not cfg.sandbox:
        raise SystemExit("ORBIT_NO_SANDBOX ist nur mit einer Datenkopie über ORBIT_DATA_DIR erlaubt.")
    isolated = isolated_dir()
    if isolated is not None:
        test_modes = cfg.fake_sandbox or cfg.fake_cli or not cfg.sandbox or "ORBIT_KEYCHAIN_FAKE" in os.environ
        if test_modes and (cfg.is_real or Path("/tmp").resolve() not in isolated.parents):
            raise SystemExit("Testoptionen sind nur in einem temporären Orbit-Profil erlaubt.")
        profile_id()
    elif cfg.data_dir.resolve() == RUST_DATA_DIR.resolve():
        raise SystemExit("Orbit Rust braucht ein getrenntes Profil.")
    return cfg
