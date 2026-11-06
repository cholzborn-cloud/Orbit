#!/bin/zsh
# Baut Orbit.app nach ./.build-derived und signiert mit dem selbstsignierten Zertifikat (SHA-1-Hash, eigene Build-Keychain).
# Zweistufig: erst ohne Signatur bauen, dann xattr -cr, dann codesign (Dateien unter Documents tragen sonst Metadaten).
set -euo pipefail
cd "${0:A:h}/.."

# Die Design-Abnahme braucht weder Identität noch Schlüsselbund oder Installation.
if [[ "${1:-}" == "--unsigned" ]]; then
  xcodegen generate > /dev/null
  LOG=$(mktemp)
  trap 'rm -f "$LOG"' EXIT
  SWIFT_ARGS=()
  if [[ "${ORBIT_DISABLE_MACRO_SANDBOX:-0}" == "1" ]]; then
    SWIFT_ARGS=('OTHER_SWIFT_FLAGS=$(inherited) -disable-sandbox')
  fi
  xcodebuild -project Orbit.xcodeproj -scheme Orbit -configuration "${CONFIGURATION:-Debug}" \
    -destination 'platform=macOS,arch=arm64' \
    -derivedDataPath "${ORBIT_DERIVED_DATA_PATH:-./.build-derived}" CODE_SIGNING_ALLOWED=NO "${SWIFT_ARGS[@]}" build > "$LOG" 2>&1 || { rg 'error:|warning:' "$LOG" | sort -u | head -60; exit 1; }
  if rg 'warning:' "$LOG"; then echo "Build hat Warnungen" >&2; exit 1; fi
  echo "Unsigniert gebaut (ohne Schlüsselbundzugriff)."
  exit 0
fi

./scripts/setup-signing.sh > /dev/null
DIR="$HOME/Library/Application Support/Orbit/Signing"
KEYCHAIN="$DIR/orbit-build.keychain-db"
HASH=$(cat "$DIR/identity.sha1")
security unlock-keychain -p "$(cat "$DIR/keychain.pw")" "$KEYCHAIN"

xcodegen generate > /dev/null
# Der Dateianbieter von Documents legt beim Neuschreiben Konfliktkopien „Orbit 2.xcodeproj“ an: wegräumen.
rm -rf Orbit\ [0-9]*.xcodeproj(N)
rm -rf "./.build-derived/Build/Products"
LOG=$(mktemp)
xcodebuild -project Orbit.xcodeproj -scheme Orbit -configuration "${CONFIGURATION:-Debug}" \
  -derivedDataPath ./.build-derived CODE_SIGNING_ALLOWED=NO build > "$LOG" 2>&1 || { grep -E "error:|warning:" "$LOG" | sort -u | head -30; rm -f "$LOG"; exit 1 }
if grep -E "warning:" "$LOG" | sort -u; then rm -f "$LOG"; echo "Build hat Warnungen" >&2; exit 1; fi
rm -f "$LOG"

APP="./.build-derived/Build/Products/${CONFIGURATION:-Debug}/Orbit.app"
# Der Dateianbieter von Documents setzt Metadaten (FinderInfo, fpfs) am Bundle gleich wieder: in einem Zwischenordner
# außerhalb signieren und zurückkopieren (ditto ohne Metadaten, die Signatur bleibt gültig).
STAGE=$(mktemp -d)
ditto --noextattr --norsrc --noqtn "$APP" "$STAGE/Orbit.app"
xattr -cr "$STAGE/Orbit.app"
# BUNDLE_SERVICE=1 (scripts/install.sh): Dienst-Bündel und Node-Laufzeit kommen in die App, jedes eigenständige Programm wird mit demselben
# Zertifikat signiert (stabile Kennungen, sonst fragt macOS Berechtigungen immer wieder neu), danach die App selbst.
if [[ "${BUNDLE_SERVICE:-0}" == "1" ]]; then
  RES="$STAGE/Orbit.app/Contents/Resources"
  (cd .. && node scripts/bundle-service.mjs "$RES/service")
  NODE_BIN="${NODE_BIN:-$(command -v node || zsh -lc 'command -v node')}"
  [[ -x "$NODE_BIN" ]] || { echo "Node nicht gefunden (NODE_BIN setzen)" >&2; exit 1 }
  mkdir -p "$RES/runtime"
  cp -X "$NODE_BIN" "$RES/runtime/node"
  xattr -cr "$RES"
  sign_inner() { codesign --force --sign "$HASH" --keychain "$KEYCHAIN" --identifier "$1" --timestamp=none "$2" }
  sign_inner de.consti.orbit2.runtime "$RES/runtime/node"
  find "$RES/service/node_modules" \( -name "*.node" -o -name "*.dylib" \) -print0 | while IFS= read -r -d '' f; do
    sign_inner "de.consti.orbit2.native.${f:t:r}" "$f"
  done
fi
# Grundanleitung der Orbis: AGENTS.md und CODING.md als Kopie ins Bündel (der LaunchAgent setzt ORBIT_AGENTS_PATH darauf, siehe LaunchAgent.swift).
mkdir -p "$STAGE/Orbit.app/Contents/Resources/rules"
cp -X ../AGENTS.md ../CODING.md "$STAGE/Orbit.app/Contents/Resources/rules/"
codesign --force --sign "$HASH" --keychain "$KEYCHAIN" --identifier de.consti.orbit2 --timestamp=none "$STAGE/Orbit.app"
# Streng prüfen, solange das Bündel außerhalb von Documents liegt (dort setzt der Dateianbieter gleich wieder Finder-Metadaten).
codesign --verify --strict "$STAGE/Orbit.app"
rm -rf "$APP"
ditto --noextattr --norsrc --noqtn "$STAGE/Orbit.app" "$APP"
rm -rf "$STAGE"
echo "Gebaut und signiert: $APP"
