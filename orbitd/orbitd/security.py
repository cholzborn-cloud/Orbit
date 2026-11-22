"""Dienst-Token und Anfrageprüfung (Host, Origin, Bearer). Gleiche Regeln wie der alte Dienst."""
import hmac
import os
import re
import secrets
import stat
from pathlib import Path

WEB_ORIGIN = "http://localhost:3000"


def load_token(data_dir: Path) -> str:
    data_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    path = data_dir / "service.token"
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "w") as f:
            f.write(secrets.token_hex(32))
    except FileExistsError:
        pass
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd) as f:
        info = os.fstat(f.fileno())
        if not stat.S_ISREG(info.st_mode) or (info.st_mode & 0o777) != 0o600 or info.st_uid != os.getuid():
            raise SystemExit("service.token muss dem aktuellen Benutzer gehören und Rechte 0600 haben.")
        token = f.read()
    if not re.fullmatch(r"[a-f0-9]{64}", token):
        raise SystemExit("service.token ist ungültig.")
    return token


def check(headers, token: str, port: int) -> int | None:
    """None = erlaubt, sonst 401/403."""
    if headers.get("host") != f"127.0.0.1:{port}":
        return 403
    origin = headers.get("origin")
    if origin is not None and origin != WEB_ORIGIN:
        return 403
    if not hmac.compare_digest(headers.get("authorization", "").encode(), f"Bearer {token}".encode()):
        return 401
    return None
