#!/bin/sh
# Build a test page: head.html + a data line + the bundle with debug hooks (window.__tfx).
# usage: devpage.sh DATA_LINE OUT_HTML   (run from anywhere)
set -e
H=$(cd "$(dirname "$0")/.." && pwd)
D=${1:-$H/bundle/data.line}
O=${2:-$H/tests/out/dev.html}
mkdir -p "$(dirname "$O")"
sed -e "s|: rangeVehicleTargets();|: rangeVehicleTargets().filter((t) => data.vehicles[t.id]);|" \
    -e 's|^    window.__tf = {$|    window.__tfx = { protection, hitcam, data, protFire, protRay, setProtect, protBundle, camTarget, newShot, combatHit, onCombatHit, rng: rng2, update, selfMissileHit, presentVictimReplay, reviveRangeTarget, reviveRangeEnemy, enterAircraft, exitAircraft, flightCoreP };\n    window.__tf = {|' \
    "$H/bundle/app.js.html" > "$O.app"
cat "$H/bundle/head.html" "$D" "$O.app" > "$O"
rm "$O.app"
echo "wrote $O"
