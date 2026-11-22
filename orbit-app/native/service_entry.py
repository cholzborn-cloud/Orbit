"""Private, detached service for the Rust app's own data profile."""
import fcntl
import json
import logging
import os
import socket
import sys
from pathlib import Path

bundle = Path(__file__).resolve().parent
sys.path[:0] = [str(bundle / "packages"), str(bundle / "service")]

import uvicorn
from orbitd import config
from orbitd.app import create_app
from orbitd.redact import RedactFilter
from orbitd.runtime.contract import PROTOCOL_VERSION


def main():
    os.umask(0o077)
    profile = Path(os.environ["ORBIT_DATA_DIR"]).resolve(strict=True)
    if profile == config.REAL_DATA_DIR.resolve() or os.environ.get("ORBIT_ISOLATED_PROFILE") != "1":
        raise SystemExit("Ein eigenes Orbit-Profil ist erforderlich.")
    with (profile / "service.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        marker = profile / "endpoint.json"
        marker.unlink(missing_ok=True)
        with socket.socket() as listener:
            while True:
                listener.bind(("127.0.0.1", 0))
                port = listener.getsockname()[1]
                if port != 4317:
                    break
                raise SystemExit("Der Port der bisherigen App ist für dieses Profil reserviert.")
            listener.listen()
            listener.setblocking(False)
            os.environ["ORBITD_PORT"] = str(port)
            logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
            for handler in logging.getLogger().handlers:
                handler.addFilter(RedactFilter())
            app = create_app(config.load())
            temp_marker = profile / f".endpoint-{os.getpid()}"
            temp_marker.write_text(json.dumps({"port": port, "pid": os.getpid(), "generation": PROTOCOL_VERSION}))
            temp_marker.replace(marker)
            try:
                server = uvicorn.Server(uvicorn.Config(app, log_level="warning", access_log=False,
                                                       timeout_graceful_shutdown=5))
                server.run(sockets=[listener])
            finally:
                marker.unlink(missing_ok=True)


if __name__ == "__main__":
    main()
