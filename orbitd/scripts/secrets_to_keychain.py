#!/usr/bin/env python3
"""Übernimmt die Schlüssel aus <Datenordner>/secrets.env in den Schlüsselbund (Dienst de.consti.orbit2, Konto = Name).

Aufruf: secrets_to_keychain.py DATEI [--dry-run]
Nur Namen, die im Schlüsselbund noch fehlen. Der Wert geht als Hex über die Standardeingabe von `security -i` (wie keychain.set_item),
nie als Argument. Ausgabe und Fehlertexte nennen nur Namen. Danach muss jeder Name lesbar sein, sonst Exit 1.
`security` kommt aus dem PATH (Tests setzen eine Attrappe davor).
"""
from __future__ import annotations

import re
import subprocess
import sys

SERVICE = "de.consti.orbit2"
NAME = re.compile(r"[A-Za-z0-9_.-]+")


def parse(path: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in open(path, encoding="utf-8", errors="replace"):
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        line = re.sub(r"^export\s+", "", line)
        name, sep, value = line.partition("=")
        name, value = name.strip(), value.strip()
        if sep and len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
            value = value[1:-1]
        if sep and NAME.fullmatch(name) and 0 < len(value) <= 16384:
            out[name] = value
    return out


def security(*args: str, stdin: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(["security", *args], input=stdin, capture_output=True, text=True, timeout=15)


def exists(name: str) -> bool:
    return security("find-generic-password", "-s", SERVICE, "-a", name).returncode == 0


def readable(name: str) -> bool:
    r = security("find-generic-password", "-s", SERVICE, "-a", name, "-w")
    return r.returncode == 0 and bool(r.stdout.strip())


def main(path: str, dry: bool) -> int:
    entries = parse(path)
    if not entries:
        print("Keine Schlüssel in der Datei.")
        return 0
    if dry:
        print("[dry-run] Würde in den Schlüsselbund übernehmen (nur fehlende): " + ", ".join(entries))
        return 0
    added = []
    for name, value in entries.items():
        if exists(name):
            continue
        r = security("-i", stdin=f"add-generic-password -U -s {SERVICE} -a {name} -X {value.encode().hex()}\n")
        if r.returncode != 0:
            print(f"FEHLER: {name} konnte nicht in den Schlüsselbund geschrieben werden.", file=sys.stderr)
            return 1
        added.append(name)
    bad = [n for n in entries if not readable(n)]
    if bad:
        print("FEHLER: nicht lesbar im Schlüsselbund: " + ", ".join(bad), file=sys.stderr)
        return 1
    print(f"Schlüsselbund: {len(entries)} Schlüssel lesbar, neu übernommen: {', '.join(added) or 'keine'}.")
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit("Aufruf: secrets_to_keychain.py DATEI [--dry-run]")
    sys.exit(main(sys.argv[1], "--dry-run" in sys.argv[2:]))
