#!/bin/zsh
# Bilder der Modellwahl-Nachträge (4d): Web links, nativ rechts (untere rechte Ecke, Composer) in plan/screens/mac4d-<szene>-<dark|light>.png.
# Voraussetzung wie shots-4d.sh. Aufruf: shots-model.sh <Kopie> <PP-Ordner>
KOPIE=$1; PP=$2; REPO=${0:A:h:h:h}; TMP=$(mktemp -d)
export ORBIT_DATA_DIR=$KOPIE ORBIT_FAKE_SANDBOX=1 ORBITD_PORT=4399 ORBITD_URL=http://127.0.0.1:4399
O=$REPO/mac/.build-derived/Build/Products/Debug/Orbit.app/Contents/MacOS/Orbit
for scheme in dark light; do (cd $PP && cp $REPO/plan/tools/shots-model-web.mjs . && node shots-model-web.mjs $TMP $scheme); done
for sc in modell-max modell-liste modell-auto chip modus; do
  $O --screenshot-composer $TMP $sc
  for scheme in dark light; do python3 $REPO/plan/tools/compose-composer.py $TMP/web-$sc-$scheme.png $TMP/mac4c-$sc-$scheme.png $REPO/plan/screens/mac4d-$sc-$scheme.png; done
done
rm -rf $TMP
