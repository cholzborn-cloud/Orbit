#!/bin/bash
# Packt den Python-Dienst orbitd in ein Orbit.app-Bündel: Python-3.13-Laufzeit (von uv verwaltet), Abhängigkeiten
# aus uv.lock (ohne Dev), das Paket orbitd; danach vorkompilieren und signieren (Identität wie mac/scripts/build.sh).
# Aufruf: build-runtime.sh <Pfad/zu/Orbit.app>. Idempotent: die drei Zielordner werden jedes Mal neu aufgebaut.
set -euo pipefail
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(dirname "$HERE")"   # ROOT = orbitd/
APP="${1:-}"
[[ -d "$APP/Contents" ]] || { echo "Aufruf: $0 <Pfad/zu/Orbit.app> (Ordner mit Contents/ nötig)" >&2; exit 2; }
APP="$(cd "$APP" && pwd)"
command -v uv >/dev/null || { echo "uv nicht gefunden (erwartet in ~/.local/bin)." >&2; exit 1; }
# --no-project: sonst liefert uv die .venv des Projekts statt der echten Laufzeit.
PY="$(uv python find --no-project --managed-python 3.13 2>/dev/null)" || { echo "Keine von uv verwaltete Python-3.13-Laufzeit installiert (uv python install 3.13, lädt etwas herunter; hier bewusst nicht automatisch)." >&2; exit 1; }
SRC="$(dirname "$(dirname "$(python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$PY" 2>/dev/null || readlink -f "$PY")")")"
[[ -x "$SRC/bin/python3.13" ]] || { echo "Laufzeit unvollständig: $SRC/bin/python3.13 fehlt." >&2; exit 1; }

RES="$APP/Contents/Resources"; RT="$RES/runtime/python"; PKG="$RES/service-py"
echo "Laufzeit: $SRC"
rm -rf "$RT" "$PKG"; mkdir -p "$RT" "$PKG"
ditto --noextattr --norsrc --noqtn "$SRC" "$RT"
DEST="$RT/bin/python3.13"

# Unnötiges: Tk/IDLE/Tests/pip-Starter. ensurepip nur zusammen mit pip entfernen (nicht gebraucht, Pakete kommen von uv).
rm -rf "$RT"/lib/python3.13/{tkinter,idlelib,turtledemo,ensurepip,test,__pycache__} "$RT"/lib/python3.13/lib-dynload/_tkinter*.so \
  "$RT"/lib/{tcl*,tk*,itcl*,thread*,libtcl*,libtk*} "$RT"/share "$RT"/include "$RT"/lib/pkgconfig \
  "$RT"/bin/{idle3,idle3.13,pip,pip3,pip3.13,pydoc3,pydoc3.13,python3.13-config,python3-config}
rm -rf "$RT"/lib/python3.13/site-packages/pip* "$RT"/lib/python3.13/EXTERNALLY-MANAGED  # pip-Kopie; Sperrmarke, weil es unsere eigene Kopie ist

REQ="$(mktemp)"; trap 'rm -f "$REQ"' EXIT
uv export --project "$ROOT" --frozen --no-dev --no-emit-project --no-hashes -q -o "$REQ"
uv pip install --python "$DEST" --no-cache -q -r "$REQ"
find "$RT/lib/python3.13/site-packages" -type d \( -name tests -o -name test \) -prune -exec rm -rf {} + 2>/dev/null || true

# Paket orbitd (migrations und data inklusive), ohne Zwischenspeicher.
mkdir -p "$PKG/orbitd"
rsync -a --exclude '__pycache__' --exclude '*.pyc' --exclude 'tests' "$ROOT/orbitd/" "$PKG/orbitd/"

# Vorkompilieren (unchecked-hash: bleibt gültig, auch wenn Kopien neue Zeitstempel bekommen).
"$DEST" -m compileall -q -j 0 --invalidation-mode unchecked-hash "$RT/lib/python3.13" "$PKG" >/dev/null
xattr -cr "$RT" "$PKG" 2>/dev/null || true

# Signieren: erst jede Mach-O-Datei, dann das Bündel (gleiche Kennung wie build.sh).
SIGN="$HOME/Library/Application Support/Orbit/Signing"
if [[ -n "${ORBIT_SIGN_IDENTITY:-}" ]]; then ARGS=(--sign "$ORBIT_SIGN_IDENTITY")
elif [[ -f "$SIGN/identity.sha1" ]]; then
  KC="$SIGN/orbit-build.keychain-db"; security unlock-keychain -p "$(cat "$SIGN/keychain.pw")" "$KC"
  ARGS=(--sign "$(cat "$SIGN/identity.sha1")" --keychain "$KC")
else echo "Keine Signatur-Identität (mac/scripts/setup-signing.sh ausführen oder ORBIT_SIGN_IDENTITY setzen)." >&2; exit 1; fi
n=0
while IFS= read -r -d '' f; do
  file -b "$f" | grep -q 'Mach-O' || continue
  b="${f##*/}"; codesign --force "${ARGS[@]}" --identifier "de.consti.orbit2.runtime.${b%.*}" --timestamp=none "$f"; n=$((n+1))
done < <(find "$RT" -type f \( -name '*.so' -o -name '*.dylib' -o -perm -u+x \) -print0)
codesign --force "${ARGS[@]}" --identifier de.consti.orbit2 --timestamp=none "$APP"
codesign --verify --strict "$APP"
echo "Fertig: $n Mach-O-Dateien signiert, Bündel geprüft. Laufzeit $(du -sh "$RT" | cut -f1), Dienst $(du -sh "$PKG" | cut -f1)."
