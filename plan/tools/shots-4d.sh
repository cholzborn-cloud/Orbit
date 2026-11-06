#!/bin/zsh
# Bilder für 4d: Web und nativ je Reiter hell/dunkel, nebeneinander in plan/screens/mac4d-<reiter>-<dark|light>.png.
# Voraussetzung: Dienst der Kopie auf 4399 und next dev (ORBIT_DATA_DIR=<Kopie>, NEXT_PUBLIC_ORBITD_URL=http://127.0.0.1:4399) auf 3000,
# Beispieldaten per seed-settings.mjs, puppeteer-core in $PP. Aufruf: shots-4d.sh <Kopie> <PP-Ordner> [Reiter,…]
KOPIE=$1; PP=$2; SECTIONS=${3:-usage,jev,orbis,skills,connectors,approvals,marketplace,appearance}
REPO=${0:A:h:h:h}; TMP=$(mktemp -d)
export ORBIT_DATA_DIR=$KOPIE ORBIT_FAKE_SANDBOX=1 ORBITD_PORT=4399 ORBITD_URL=http://127.0.0.1:4399
for scheme in dark light; do (cd $PP && cp $REPO/plan/tools/shots-settings-web.mjs . && node shots-settings-web.mjs $TMP $scheme $SECTIONS); done
for section in ${(s:,:)SECTIONS}; do
  $REPO/mac/.build-derived/Build/Products/Debug/Orbit.app/Contents/MacOS/Orbit --screenshot-einstellungen $TMP $section
  for scheme in dark light; do python3 $REPO/plan/tools/compose-shots.py $TMP/web-$section-$scheme.png $TMP/mac4d-$section-$scheme.png $REPO/plan/screens/mac4d-$section-$scheme.png; done
done
rm -rf $TMP
