#!/bin/bash
# Startet orbitd für die Entwicklung mit einem LEEREN Wegwerf-Profil (nie ~/Library/Application Support/Orbit).
# Aufruf: dev-service.sh [start|stop]   (Standard: start)
# ORBIT_REAL_KEYCHAIN=1: echter Schlüsselbund statt Attrappe (der Dienst übernimmt dann nur den Composio-Projektschlüssel, Profil bleibt getrennt).
set -euo pipefail

root=$(cd "$(dirname "$0")/../.." && pwd -P)
profile=${ORBIT_DEV_PROFILE:-/private/tmp/orbit-dev-profile}
port=${ORBITD_PORT:-4399}
python="$root/orbitd/.venv/bin/python"
pidfile="$profile/dev-service.pid"

case "$profile" in
    /private/tmp/*|/tmp/*) ;;
    *) printf 'Das Entwicklungsprofil muss unter /tmp liegen: %s\n' "$profile" >&2; exit 1 ;;
esac
[[ $port -ge 1024 && $port -ne 4317 ]] || { printf 'Ungültiger Port: %s\n' "$port" >&2; exit 1; }

stop() {
    if [[ -f $pidfile ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
        kill "$(cat "$pidfile")"
        printf 'Dienst beendet.\n'
    else
        printf 'Kein laufender Entwicklungsdienst.\n'
    fi
    rm -f "$pidfile"
}

healthy() {
    [[ -s $profile/service.token ]] || return 1
    curl -fsS --max-time 1 -H "Authorization: Bearer $(cat "$profile/service.token")" \
        "http://127.0.0.1:$port/v1/health" >/dev/null 2>&1
}

if [[ ${1:-start} == stop ]]; then stop; exit 0; fi
[[ -x $python ]] || { printf 'orbitd/.venv fehlt (siehe orbitd/README.md).\n' >&2; exit 1; }
if [[ -f $pidfile ]] && kill -0 "$(cat "$pidfile")" 2>/dev/null; then
    printf 'Dienst läuft schon (PID %s).\n' "$(cat "$pidfile")"
else
    keychain_env=(ORBIT_KEYCHAIN_FAKE=1)
    [[ -z ${ORBIT_REAL_KEYCHAIN:-} ]] || keychain_env=(ORBIT_KEYCHAIN_REAL=1)
    mkdir -p "$profile"
    chmod 700 "$profile"
    (
        cd "$root/orbitd"
        ORBIT_DATA_DIR="$profile" ORBITD_PORT="$port" ORBIT_ISOLATED_PROFILE=1 ORBIT_BRAIN=off \
        env "${keychain_env[@]}" ORBIT_FAKE_CLI=1 ORBIT_FAKE_SANDBOX=1 ORBIT_NO_SANDBOX=1 \
        PYTHONPATH="$root/orbitd" nohup "$python" -B -m orbitd >"$profile/service.log" 2>&1 &
        echo $! >"$pidfile"
    )
    for _ in $(seq 1 100); do
        healthy && break
        sleep 0.2
    done
fi
healthy || { printf 'Der Dienst antwortet nicht, siehe %s/service.log\n' "$profile" >&2; exit 1; }
printf 'Dienst läuft auf Port %s (Profil %s, PID %s).\n' "$port" "$profile" "$(cat "$pidfile")"
printf 'App starten:\n  cd %s/orbit-app && ORBIT_DATA_DIR=%s ORBITD_PORT=%s npm run tauri dev\n' "$root" "$profile" "$port"
printf 'Beenden: %s stop\n' "$0"
