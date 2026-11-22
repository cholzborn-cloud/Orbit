"""Start: python -m orbitd"""
import logging

import uvicorn

from . import config
from .app import create_app
from .redact import RedactFilter


def main() -> None:
    cfg = config.load()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    for handler in logging.getLogger().handlers:
        handler.addFilter(RedactFilter())
    uvicorn.run(create_app(cfg), host="127.0.0.1", port=cfg.port, log_level="warning", access_log=False,
                timeout_graceful_shutdown=5)  # offene Freigaben halten Verbindungen offen: nach 5 s trotzdem herunterfahren


if __name__ == "__main__":
    main()
