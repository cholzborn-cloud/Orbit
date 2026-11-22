#!/bin/bash
# Zurück auf den Node-Dienst: SQLite sichern, Datei „runtime“ nach ~/.Trash, secrets.env zurückholen, LaunchAgent neu laden, Health prüfen.
# Optionen: --dry-run, --restore <Sicherungsordner> (spielt statt der Sicherung die gesicherte Datenbank zurück; die aktuelle geht in den Papierkorb-Ordner). Umgebung: siehe _switch-lib.sh.
HERE="$(cd "$(dirname "$0")" && pwd)"; source "$HERE/_switch-lib.sh"
[[ -f "$PLIST" ]] || { echo "LaunchAgent-Plist fehlt: $PLIST (Orbit einmal starten)." >&2; exit 1; }
say "Zurück auf Node (Daten: $DATA, Label: $LABEL)"
if [[ -n "$RESTORE" ]]; then restore_db || exit 1
elif [[ "${ORBIT_SKIP_BACKUP:-0}" != "1" ]]; then backup; fi
# Nie rm: die Datei geht in den Papierkorb.
[[ -f "$DATA/runtime" ]] && run mv "$DATA/runtime" "$TRASH/orbit-runtime-$(date +%Y%m%d-%H%M%S)"
secrets_back
plist_node
restart_agent
wait_health && say "$( ((DRY)) && echo "(Probelauf, nichts geändert) ")Fertig: Orbit läuft wieder mit dem Node-Dienst." || { echo "Rollback: Dienst antwortet nicht." >&2; exit 1; }
