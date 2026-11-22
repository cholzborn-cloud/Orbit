#!/bin/bash
# Baut Orbit.app (Tauri) samt Python-Dienst und signiert mit dem vorhandenen selbstsignierten Zertifikat.
# Ausgabe: orbit-app/dist/Orbit.app (NICHT nach /Applications). Ein älteres dist/Orbit.app kommt in den Papierkorb.
# Vorbild: früheres Rust-Paketskript, orbitd/scripts/build-runtime.sh, mac/scripts/build.sh.
set -euo pipefail

here=$(cd "$(dirname "$0")/.." && pwd -P)       # orbit-app
root=$(cd "$here/.." && pwd -P)                 # Orbit
dist="$here/dist"
output="$dist/Orbit.app"
python=${ORBIT_PACKAGE_PYTHON:-"$root/orbitd/.venv/bin/python"}
signing="$HOME/Library/Application Support/Orbit/Signing"   # nur lesen: identity.sha1, Schlüsselbund (von mac/scripts/setup-signing.sh)
export PATH="$HOME/.cargo/bin:$PATH"
export MACOSX_DEPLOYMENT_TARGET=13.0

[[ -f "$signing/identity.sha1" ]] || { echo "Zertifikat fehlt: mac/scripts/setup-signing.sh ausführen." >&2; exit 1; }
identity=$(cat "$signing/identity.sha1")
keychain="$signing/orbit-build.keychain-db"
security unlock-keychain -p "$(cat "$signing/keychain.pw")" "$keychain"

# Vite leert dist/ beim Bauen: ein altes Paket vorher in den Papierkorb legen.
if [[ -e "$output" ]]; then
    mv "$output" "$HOME/.Trash/Orbit.app.$(date +%Y%m%d-%H%M%S)"
fi

cd "$here"
npx tauri build --bundles app
built="${CARGO_TARGET_DIR:-$here/src-tauri/target}/release/bundle/macos/Orbit.app"
[[ -d "$built" ]] || { echo "Tauri-Paket fehlt: $built" >&2; exit 1; }

staging=$(mktemp -d "$here/.assembly.XXXXXX")
trap 'mv "$staging" "$HOME/.Trash/orbit-assembly.$$" 2>/dev/null || true' EXIT
app="$staging/Orbit.app"
/usr/bin/ditto "$built" "$app"
contents="$app/Contents"
resources="$contents/Resources"
mkdir -p "$resources"
xcrun swiftc -O -emit-library -target "$(uname -m)-apple-macosx13.0" \
    "$here/native/PermissionUI.swift" -o "$resources/libOrbitPermissionUI.dylib"

"$python" "$here/scripts/package-voice.py" "$resources/voice"

# Python-Laufzeit, Pakete, orbitd und Einstieg (Aufbau wie im früheren Rust-Paketskript).
install -m 0644 "$here/native/service_entry.py" "$resources/service_entry.py"
runtime=$("$python" -I -c 'import sys; assert sys.version_info[:2] == (3, 13); print(sys.base_prefix)')
packages=$("$python" -I -c 'import sysconfig; print(sysconfig.get_path("purelib"))')
/usr/bin/rsync -a --exclude '__pycache__' --exclude '*.pyc' --exclude 'include' \
    --exclude '*.a' --exclude '/lib/python3.13/test' "$runtime/" "$resources/python/"
/usr/bin/rsync -a --exclude '__pycache__' --exclude '*.pyc' --exclude '/_pytest' \
    --exclude '/pytest' --exclude '/pytest-*.dist-info' --exclude '/bin' "$packages/" "$resources/packages/"
mkdir -p "$resources/service"
/usr/bin/rsync -a --exclude '__pycache__' --exclude '*.pyc' --exclude 'tests' \
    "$root/orbitd/orbitd" "$resources/service/"
install -m 0644 "$root/orbitd/NOTICE" "$resources/service/NOTICE"
install -m 0644 "$root/AGENTS.md" "$resources/AGENTS.md"
install -m 0644 "$root/CODING.md" "$resources/CODING.md"

# Build fingerprint: /v1/health reports it, so the acceptance check can tell this build from an older running service.
service_hash=$(cd "$resources/service/orbitd" && /usr/bin/find . -type f ! -name BUILD_ID -print0 | LC_ALL=C sort -z | xargs -0 shasum -a 256 | shasum -a 256 | cut -c1-12)
head_short=$(git -C "$root" rev-parse --short HEAD 2>/dev/null || echo nogit)
dirty=$(git -C "$root" status --porcelain 2>/dev/null | wc -l | tr -d ' ')
version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$contents/Info.plist")
build_id="$version+$head_short.d$dirty.s$service_hash.$(date -u +%Y%m%dT%H%M%SZ)"
printf '%s\n' "$build_id" > "$resources/service/orbitd/BUILD_ID"

# Dienst im Paket prüfen: importiert nur aus dem Bündel.
"$resources/python/bin/python3.13" -I -B - "$resources" <<'PY'
import pathlib
import sys
bundle = pathlib.Path(sys.argv[1]).resolve()
assert pathlib.Path(sys.base_prefix).resolve().is_relative_to(bundle), sys.base_prefix
sys.path[:0] = [str(bundle / "packages"), str(bundle / "service")]
import uvicorn
from orbitd.app import create_app
assert pathlib.Path(uvicorn.__file__).resolve().is_relative_to(bundle), uvicorn.__file__
from orbitd.runtime import contract, ledger  # wave 1 contract ships with the service
from orbitd.routes.health import build_id
assert build_id(), "BUILD_ID missing"
assert (bundle / "service/orbitd/migrations/0016_work_contract.sql").is_file()
print("service protocol", contract.PROTOCOL_VERSION, "build", build_id())
PY

# Signieren: erst jede Mach-O-Datei, dann das Bündel. Zertifikat statt Ad-hoc, damit TCC-Rechte Builds überstehen.
xattr -cr "$app" 2>/dev/null || true
sign=(--force --sign "$identity" --keychain "$keychain" --timestamp=none)
while IFS= read -r -d '' f; do
    file -b "$f" | grep -q 'Mach-O' || continue
    b=${f##*/}
    /usr/bin/codesign "${sign[@]}" --identifier "de.consti.orbit.app.runtime.${b%.*}" "$f" >/dev/null
done < <(/usr/bin/find "$resources" -type f \( -name '*.so' -o -name '*.dylib' -o -perm -u+x \) -print0)
/usr/bin/codesign "${sign[@]}" --identifier de.consti.orbit.app "$app"
/usr/bin/codesign --verify --strict "$app"
/usr/bin/plutil -lint "$contents/Info.plist" >/dev/null
[[ $(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$contents/Info.plist") == de.consti.orbit.app ]]

mkdir -p "$dist"
mv "$app" "$output"
printf '%s\n' "$output" "$build_id"
