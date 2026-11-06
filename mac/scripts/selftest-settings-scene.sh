#!/bin/bash
set -euo pipefail

repo_mac="$(cd "$(dirname "$0")/.." && pwd)"
probe_dir="$(mktemp -d /tmp/orbit-settings-scene.XXXXXXXX)"
bundle_id="de.consti.orbit.settingsprobe.$(uuidgen)"
cleanup() {
  local preferences="$HOME/Library/Preferences/$bundle_id.plist"
  if [[ -f "$preferences" ]]; then mv "$preferences" "$HOME/.Trash/"; fi
  rm -r "$probe_dir"
}
trap cleanup EXIT
mkdir -p "$probe_dir/mac" "$probe_dir/home/Library/Preferences" "$probe_dir/data"
rsync -a --exclude='.build-derived' --exclude='.env*' "$repo_mac/" "$probe_dir/mac/"
python3 - "$probe_dir/mac" "$repo_mac/scripts/SettingsSceneProbe.swift" <<'PY'
from pathlib import Path
import sys

mac = Path(sys.argv[1])
main = mac / 'Orbit/main.swift'
source = main.read_text()
source = source.replace('import Foundation\n', 'import Foundation\nimport SwiftUI\n', 1)
old = '} else {\n    OrbitApp.main()\n}'
assert source.count(old) == 1
source = source.replace(old, '} else {\n    NSApplication.shared.setActivationPolicy(.prohibited)\n    SettingsSceneProbeApp.main()\n}')
app = (mac / 'Orbit/App/OrbitApp.swift').read_text()
start = app.index('        Settings {')
end = app.index('\n    }', start)
scene = app[start:end].replace('model.settings', 'store')
assert scene.count('.scrollIndicators(.never)') == 1
scene = scene.replace('.scrollIndicators(.never)', '.scrollIndicators(.never)\n                .environment(\\.staticRendering, true)\n                .background(SceneProbeHiddenWindow())')
probe = Path(sys.argv[2]).read_text()
assert probe.count('        // SETTINGS_SCENE') == 1
main.write_text(source + '\n' + probe.replace('        // SETTINGS_SCENE', scene))
PY
xcodebuild -project "$probe_dir/mac/Orbit.xcodeproj" -scheme Orbit -configuration Debug \
  -derivedDataPath "$probe_dir/build" PRODUCT_BUNDLE_IDENTIFIER="$bundle_id" CODE_SIGNING_ALLOWED=NO \
  build > "$probe_dir/build.log" 2>&1 || { tail -60 "$probe_dir/build.log"; exit 1; }
env -i PATH=/usr/bin:/bin HOME="$probe_dir/home" CFFIXED_USER_HOME="$probe_dir/home" ORBIT_DATA_DIR="$probe_dir/data" \
  "$probe_dir/build/Build/Products/Debug/Orbit.app/Contents/MacOS/Orbit"
