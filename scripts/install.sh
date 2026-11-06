#!/bin/zsh
# Baut Orbit.app mit Dienst und Node-Laufzeit, installiert sie nach /Applications und richtet den Hintergrunddienst (LaunchAgent) ein.
#   scripts/install.sh                 bauen, installieren, Dienst einrichten, App öffnen
#   scripts/install.sh --ohne-start    dasselbe, ohne die App zu öffnen
#   scripts/install.sh --aus-env-local übernimmt die Schlüssel aus .env.local in secrets.env (nur wenn du das selbst ausführst)
#   scripts/install.sh --entfernen     Dienst aus launchd nehmen (die App bleibt)
# Schlüssel werden nie ausgegeben.
set -euo pipefail
REPO="${0:A:h:h}"
cd "$REPO"
DATA="${ORBIT_DATA_DIR:-$HOME/Library/Application Support/Orbit}"
DEST="${ORBIT_INSTALL_DIR:-/Applications}/Orbit.app"
LABEL="${ORBIT_LAUNCH_LABEL:-de.consti.orbit2.service}"
PORT="${ORBITD_PORT:-4317}"
KEYS=(OPENROUTER_JEV_API_KEY DAYTONA_API_KEY DAYTONA_API_URL CONNECTOR_SECRET BRAIN_SERVER_URL BRAIN_SERVER_TOKEN)

if [[ "${1:-}" == "--entfernen" ]]; then
  "$DEST/Contents/MacOS/Orbit" --dienst-entfernen
  exit 0
fi

# 1. bauen
BUNDLE_SERVICE=1 CONFIGURATION=Release mac/scripts/build.sh | tail -1
BUILT="$REPO/mac/.build-derived/Build/Products/Release/Orbit.app"

# 2. laufende App beenden (der Dienst läuft weiter, er gehört launchd)
# (Testlauf mit ORBIT_INSTALL_DIR beendet nie eine laufende App)
if [[ -z "${ORBIT_INSTALL_DIR:-}" ]] && pgrep -x Orbit > /dev/null; then
  osascript -e 'tell application id "de.consti.orbit2" to quit' > /dev/null 2>&1 || true
  for _ in {1..20}; do pgrep -x Orbit > /dev/null || break; sleep 0.5; done
fi

# 3. Entwicklungsdienst dieses Repos auf dem Port ablösen (nur genau dieser, nie ein fremder Prozess)
for pid in $(lsof -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true); do
  cmd=$(ps -o command= -p "$pid" || true)
  cwd=$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true)
  if [[ "$cmd" == *"service/src/index.ts"* && "$cwd" == "$REPO" ]]; then
    echo "Entwicklungsdienst $pid beendet"
    kill "$pid"
    for _ in {1..20}; do kill -0 "$pid" 2> /dev/null || break; sleep 0.25; done
  fi
done

# 4. installieren (ohne Metadaten, die Signatur bleibt gültig)
mkdir -p "${DEST:h}"
rm -rf "$DEST"
ditto --noextattr --norsrc --noqtn "$BUILT" "$DEST"
codesign --verify --strict "$DEST"
echo "Installiert: $DEST"

# 5. Schlüsseldatei: leere Vorlage, wenn es keine gibt (nur Namen, keine Werte)
mkdir -p "$DATA"; chmod 700 "$DATA"
if [[ ! -f "$DATA/secrets.env" ]]; then
  umask 077
  { echo "# Orbit: Schlüssel des Hintergrunddienstes (Rechte 600). Zeilen SCHLÜSSEL=Wert."; for k in $KEYS; do echo "$k="; done } > "$DATA/secrets.env"
  echo "Vorlage angelegt: $DATA/secrets.env (Werte selbst eintragen oder: scripts/install.sh --aus-env-local)"
fi
chmod 600 "$DATA/secrets.env"
if [[ "${1:-}" == "--aus-env-local" ]]; then
  [[ -f .env.local ]] || { echo ".env.local fehlt" >&2; exit 1 }
  umask 077
  { echo "# Orbit: Schlüssel des Hintergrunddienstes (Rechte 600)."; for k in $KEYS; do grep -E "^$k=" .env.local || echo "$k="; done } > "$DATA/secrets.env"
  echo "secrets.env aus .env.local befüllt ($(grep -cE '=.+' "$DATA/secrets.env") Werte, nicht angezeigt)"
fi

# 6. Dienst einrichten (LaunchAgent) und prüfen
"$DEST/Contents/MacOS/Orbit" --dienst-einrichten || true
# Absicherung (beobachtet 03.11.2026): Die Datei steht, aber launchd hat den Dienst nicht geladen. Dann einmal laden und warten.
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
if ! launchctl list | grep -q "$LABEL"; then
  launchctl bootstrap "gui/$(id -u)" "$PLIST" 2> /dev/null || true
  for _ in {1..20}; do launchctl list | grep -q "$LABEL" && break; sleep 0.5; done
fi
launchctl list | grep -q "$LABEL" && echo "Dienst geladen: $LABEL" || { echo "Dienst nicht geladen: $LABEL" >&2; exit 1; }
[[ "${1:-}" == "--ohne-start" ]] || open "$DEST"
