#!/bin/zsh
# Aufruf: LAB=/pfad/zum/geklonten/bible-strong-avatar-lab OUT_HTML=... OUT_SWIFT=... ./run.sh build-animationen.ts
# Ersetzt $LAB in den Skripten durch den Repo-Pfad und führt sie mit Nodes eingebautem TypeScript aus.
set -e
cd "${0:A:h}"
: ${LAB:?LAB setzen}
tmp=$(mktemp -d); for f in *.ts; do sed "s#\$LAB#$LAB#g" "$f" > "$tmp/$f"; done; cp hooks.mjs reg.mjs "$tmp/"; echo '{"type":"module"}' > "$tmp/package.json"
cd "$tmp" && node --experimental-transform-types --no-warnings --import ./reg.mjs "$@"
