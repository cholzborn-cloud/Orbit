# Gemeinsamer Teil von switch-orbitd.sh und rollback-orbitd.sh (wird per source geladen).
# Umgebung: ORBIT_DATA_DIR, ORBIT_PORT (sonst ORBITD_PORT aus der Plist, sonst 4317), ORBIT_APP (Standard /Applications/Orbit.app),
# ORBIT_LAUNCH_LABEL (wie LaunchAgent.swift), ORBIT_BACKUP_ROOT (Standard ~/Projekte-Coding/Backups/Orbit), ORBIT_TRASH (Standard ~/.Trash).
# Optionen: --dry-run; nur rollback-orbitd.sh: --restore <Sicherungsordner>.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"   # Repo-Wurzel
DATA="${ORBIT_DATA_DIR:-$HOME/Library/Application Support/Orbit}"
APP="${ORBIT_APP:-/Applications/Orbit.app}"; RES="$APP/Contents/Resources"
LABEL="${ORBIT_LAUNCH_LABEL:-de.consti.orbit2.service}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"; DOMAIN="gui/$(id -u)"
PB=/usr/libexec/PlistBuddy; TRASH="${ORBIT_TRASH:-$HOME/.Trash}"
DRY=0; RESTORE=""
while (($#)); do case "$1" in
  --dry-run) DRY=1 ;;
  --restore) [[ $# -ge 2 && -n "$2" ]] || { echo "--restore braucht einen Sicherungsordner." >&2; exit 2; }; RESTORE="$2"; shift ;;
  *) echo "Unbekannte Option: $1" >&2; exit 2 ;;
esac; shift; done
SECRETS="$DATA/secrets.env"

say() { echo "$*"; }
run() { if ((DRY)); then echo "[dry-run] $*"; else "$@"; fi; }
pb() { "$PB" -c "$1" "$PLIST" 2>/dev/null; }                         # lesen/ändern; Fehler = leer

port() { echo "${ORBIT_PORT:-$(pb 'Print :EnvironmentVariables:ORBITD_PORT' || true)}" | sed 's/^$/4317/'; }

# SQLite sichern (VACUUM INTO ist auch bei laufendem Dienst konsistent). Setzt BACKUP_DIR.
backup() {
  [[ -f "$DATA/orbit.sqlite" ]] || { say "Keine Datenbank in $DATA, Sicherung entfällt."; BACKUP_DIR=""; return 0; }
  BACKUP_DIR="${ORBIT_BACKUP_ROOT:-$HOME/Projekte-Coding/Backups/Orbit}/$(date +%Y-%m-%d_%H-%M)"
  [[ -e "$BACKUP_DIR/orbit.sqlite" ]] && BACKUP_DIR="$BACKUP_DIR-$(date +%S)"
  run mkdir -p "$BACKUP_DIR"
  run sqlite3 "$DATA/orbit.sqlite" "VACUUM INTO '$BACKUP_DIR/orbit.sqlite'"
  [[ -f "$PLIST" ]] && run cp "$PLIST" "$BACKUP_DIR/$LABEL.plist"
  say "Sicherung: $BACKUP_DIR/orbit.sqlite"
}

# Plist auf Python bzw. Node stellen (dieselben Felder wie LaunchAgent.swift; die App schreibt sie beim Start ohnehin passend).
# Jeder PlistBuddy-Befehl einzeln: ein fehlender Schlüssel (Delete) darf die übrigen nicht verhindern.
pbx() { if ((DRY)); then echo "[dry-run] PlistBuddy: $1"; else "$PB" -c "$1" "$PLIST" >/dev/null 2>&1 || true; fi; }
pbs() { if ((DRY)); then echo "[dry-run] PlistBuddy: Set :$1 = $2"; else "$PB" -c "Set :$1 $2" "$PLIST" >/dev/null 2>&1 || "$PB" -c "Add :$1 string $2" "$PLIST"; fi; }
plist_args() { pbx "Delete :ProgramArguments"; pbx "Add :ProgramArguments array"; local i=0 a; for a in "$@"; do pbx "Add :ProgramArguments:$((i++)) string $a"; done; }
plist_python() {
  plist_args "$RES/runtime/python/bin/python3.13" -m orbitd
  pbs WorkingDirectory "$DATA"; pbx "Delete :EnvironmentVariables:ORBIT_MIGRATIONS_DIR"; pbx "Delete :EnvironmentVariables:ORBIT_AGENTS_PATH"
  pbs EnvironmentVariables:PYTHONPATH "$RES/service-py"; pbs EnvironmentVariables:PYTHONDONTWRITEBYTECODE 1
}
plist_node() {
  local wd="$DATA"; [[ -f "$ROOT/.env.local" ]] && wd="$ROOT"
  plist_args "$RES/runtime/node" "$RES/service/orbitd.mjs"
  pbs WorkingDirectory "$wd"; pbx "Delete :EnvironmentVariables:PYTHONPATH"; pbx "Delete :EnvironmentVariables:PYTHONDONTWRITEBYTECODE"
  pbs EnvironmentVariables:ORBIT_MIGRATIONS_DIR "$RES/service/drizzle/sqlite"
  [[ -f "$RES/rules/AGENTS.md" ]] && pbs EnvironmentVariables:ORBIT_AGENTS_PATH "$RES/rules/AGENTS.md"
  return 0
}

# Schlüssel-Datei: vor dem Umschalten in den Schlüsselbund, dann in den Papierkorb (nie rm). Der Wert erscheint nirgends.
secrets_import() {
  [[ -f "$SECRETS" ]] || return 0
  say "Schlüssel-Datei gefunden: Schlüssel gehen in den Schlüsselbund (Dienst de.consti.orbit2)."
  local dry=(); ((DRY)) && dry=(--dry-run)
  python3 "$HERE/secrets_to_keychain.py" "$SECRETS" ${dry[@]+"${dry[@]}"} || { echo "Schlüssel konnten nicht übernommen werden, nichts umgeschaltet." >&2; return 1; }
  if ((DRY)); then say "[dry-run] mv secrets.env -> $TRASH/orbit-secrets-<Zeit>.env"; return 0; fi
  mkdir -p "$TRASH"; mv "$SECRETS" "$TRASH/orbit-secrets-$(date +%Y%m%d-%H%M%S).env"
  say "secrets.env liegt jetzt im Papierkorb-Ordner $TRASH (Rückweg holt sie zurück)."
}
# Rückweg: der Node-Dienst liest die Datei wieder; die neueste aus dem Papierkorb-Ordner kommt zurück (der Schlüsselbund bleibt unberührt).
secrets_back() {
  [[ -f "$SECRETS" ]] && return 0
  local f; f="$(ls -1t "$TRASH"/orbit-secrets-*.env 2>/dev/null | head -n 1 || true)"
  [[ -n "$f" ]] || return 0
  run mv "$f" "$SECRETS"; ((DRY)) || chmod 600 "$SECRETS"
  say "secrets.env zurückgeholt (der alte Dienst braucht sie)."
}

# Dienst stoppen und warten, bis launchd ihn nicht mehr kennt.
stop_agent() {
  run launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
  if ((!DRY)); then local i; for i in $(seq 1 20); do launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1 || break; sleep 0.5; done; fi
}

# Gesicherte Datenbank zurückspielen (Dienst vorher stoppen). Die aktuelle geht mit Zeitstempel in den Papierkorb-Ordner.
restore_db() {
  local src="$RESTORE/orbit.sqlite" ts; ts="$(date +%Y%m%d-%H%M%S)"
  [[ -f "$src" ]] || { echo "Keine orbit.sqlite in $RESTORE." >&2; return 1; }
  [[ "$(sqlite3 "file:$src?mode=ro" 'PRAGMA integrity_check' 2>/dev/null)" == "ok" ]] || { echo "Sicherung ist beschädigt: $src" >&2; return 1; }
  stop_agent
  run mkdir -p "$TRASH"
  local f; for f in "$DATA"/orbit.sqlite "$DATA"/orbit.sqlite-wal "$DATA"/orbit.sqlite-shm; do
    [[ -e "$f" ]] && run mv "$f" "$TRASH/orbit-$ts-$(basename "$f")"
  done
  run cp "$src" "$DATA/orbit.sqlite"
  say "Datenbank aus $RESTORE zurückgespielt (die bisherige liegt in $TRASH als orbit-$ts-orbit.sqlite)."
}

# Dienst neu laden (bootout + bootstrap, weil launchd die Plist sonst nicht neu liest).
restart_agent() {
  stop_agent  # bootout kehrt vor dem Ende des Prozesses zurück; ein sofortiges bootstrap scheitert sonst mit „Input/output error“.
  run launchctl bootstrap "$DOMAIN" "$PLIST"
}

# Bis 30 s auf GET /v1/health warten; Token aus service.token (nie ausgegeben, nicht in der Prozessliste).
wait_health() {
  local p; p="$(port)"
  if ((DRY)); then say "[dry-run] Warte bis 30 s auf GET http://127.0.0.1:$p/v1/health mit Token aus $DATA/service.token"; return 0; fi
  local i
  for i in $(seq 1 30); do
    if [[ -f "$DATA/service.token" ]] && printf 'header = "Authorization: Bearer %s"\n' "$(tr -d '\n' < "$DATA/service.token")" |
      curl -fsS -m 2 -K - "http://127.0.0.1:$p/v1/health" 2>/dev/null | grep -q '"ok" *: *true'; then
      say "Dienst antwortet (Port $p, nach ${i} s)."; return 0; fi
    sleep 1
  done
  say "Dienst antwortet nicht innerhalb von 30 s (Port $p). Log: $DATA/orbitd-service.log" >&2; return 1
}
