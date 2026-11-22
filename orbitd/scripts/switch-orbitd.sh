#!/bin/bash
# Schaltet Orbit auf den Python-Dienst um: SQLite sichern, Schlüssel-Datei in den Schlüsselbund, Datei „runtime“ = python, LaunchAgent neu laden, Health prüfen.
# Schlägt etwas fehl, läuft automatisch rollback-orbitd.sh. Optionen: --dry-run. Umgebung: siehe _switch-lib.sh.
HERE="$(cd "$(dirname "$0")" && pwd)"; source "$HERE/_switch-lib.sh"
PY="$RES/runtime/python/bin/python3.13"
[[ -x "$PY" && -d "$RES/service-py/orbitd" ]] || { echo "Python-Dienst fehlt im Bündel $APP (erst scripts/build-runtime.sh ausführen)." >&2; exit 1; }
[[ -f "$PLIST" ]] || { echo "LaunchAgent-Plist fehlt: $PLIST (Orbit einmal starten)." >&2; exit 1; }
PYTHONPATH="$RES/service-py" "$PY" -B -c "import orbitd, starlette, uvicorn, httpx, mcp" || { echo "Python-Dienst im Bündel nicht ladbar." >&2; exit 1; }
say "Umschalten auf Python (Daten: $DATA, Label: $LABEL)"
backup
secrets_import || exit 1
if ! { run bash -c 'printf python > "$1/runtime"' _ "$DATA" && plist_python && restart_agent && wait_health; }; then
  echo "Umschalten fehlgeschlagen, gehe automatisch zurück." >&2
  ORBIT_SKIP_BACKUP=1 "$HERE/rollback-orbitd.sh" "$@" || true; exit 1
fi
say "$( ((DRY)) && echo "(Probelauf, nichts geändert) ")Fertig: Orbit läuft jetzt mit dem Python-Dienst. Zurück mit scripts/rollback-orbitd.sh."
