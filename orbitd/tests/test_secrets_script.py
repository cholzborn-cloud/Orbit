"""scripts/secrets_to_keychain.py mit erfundener Datei und Attrappen-`security` (kein echter Schlüsselbund)."""
import os
import subprocess
import sys
from pathlib import Path

SCRIPT = Path(__file__).parent.parent / "scripts" / "secrets_to_keychain.py"
FAKE = """#!/bin/bash
K="$KC_DIR"
if [[ "$1" == "-i" ]]; then read -r l; set -- $l; while (($#)); do case "$1" in -a) a=$2; shift;; -X) x=$2; shift;; esac; shift; done; echo "$x" > "$K/$a"; exit 0; fi
shift; while (($#)); do case "$1" in -a) a=$2; shift;; -w) w=1;; esac; shift; done
[[ -f "$K/$a" ]] || exit 44
[[ -n "$w" ]] && xxd -r -p "$K/$a"; exit 0
"""


def run(tmp_path, *extra):
    kc = tmp_path / "kc"
    kc.mkdir(exist_ok=True)
    (tmp_path / "bin").mkdir(exist_ok=True)
    sec = tmp_path / "bin" / "security"
    sec.write_text(FAKE)
    sec.chmod(0o755)
    env = {**os.environ, "PATH": f"{tmp_path / 'bin'}:{os.environ['PATH']}", "KC_DIR": str(kc)}
    return subprocess.run([sys.executable, str(SCRIPT), str(tmp_path / "secrets.env"), *extra], env=env, capture_output=True, text=True), kc


def test_import_only_missing_and_never_prints_values(tmp_path):
    (tmp_path / "secrets.env").write_text('# c\nA_KEY=wert-eins\nexport B_KEY="wert-zwei"\n')
    r, kc = run(tmp_path, "--dry-run")
    assert r.returncode == 0 and "A_KEY" in r.stdout and not list(kc.iterdir())
    r, kc = run(tmp_path)
    assert r.returncode == 0 and sorted(p.name for p in kc.iterdir()) == ["A_KEY", "B_KEY"]
    assert bytes.fromhex((kc / "B_KEY").read_text().strip()) == b"wert-zwei"
    assert "wert-" not in r.stdout + r.stderr
    (kc / "A_KEY").write_text(b"anders".hex())
    r, kc = run(tmp_path)
    assert "neu übernommen: keine" in r.stdout and bytes.fromhex((kc / "A_KEY").read_text().strip()) == b"anders"  # vorhandene bleiben
