"""Schlüssel dürfen nie in Logs, Antworten oder Ereignissen stehen. Eine Stelle, die Verdächtiges schwärzt."""
import logging
import re

# Bekannte Schlüssel-Formen plus Zuweisungen wie TOKEN=…, "api_key": "…", Authorization: Bearer …
_PATTERNS = [
    re.compile(r"\b(sk-[A-Za-z0-9_\-]{16,}|sk-ant-[A-Za-z0-9_\-]{16,}|ghp_[A-Za-z0-9]{20,}|dtn_[A-Za-z0-9]{16,}|AIza[A-Za-z0-9_\-]{20,}|xox[abp]-[A-Za-z0-9\-]{10,})"),
    re.compile(r"(?i)\b(bearer)\s+[A-Za-z0-9._\-]{16,}"),
    re.compile(r"(?i)\b([a-z0-9_]*(?:api[_-]?key|token|secret|password|passwort)[a-z0-9_]*)(\"?\s*[:=]\s*\"?)[^\s\"',;]{8,}"),
]
MASK = "[geschwärzt]"


def redact(text: str) -> str:
    text = _PATTERNS[0].sub(MASK, text)
    text = _PATTERNS[1].sub(lambda m: f"{m.group(1)} {MASK}", text)
    return _PATTERNS[2].sub(lambda m: f"{m.group(1)}{m.group(2)}{MASK}", text)


class RedactFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.msg, record.args = redact(record.getMessage()), None
        return True
