MiG-17 asset repair from the supplied 2026-10-25 animation archive.

`native.json` is the frozen native-v2 model, SHA256
`e553b9d081f59cfed0fda9e91e900cd5b60bd6ba42b69feb95df82af30a3b6f9`.
It replaces only `data.aircraftModels.mig17f`, before `decodeAircraftModels`.
`native.audit.json` records the reversible source-face ranges and measured mounts.
`accepted-damage-patch.json` supplies the matching actual Aircraft's legacy box
parts/skin; merge only these two fields into `types.mig17f` in the server's
`data/aircraft/aircraft.json`. Keep its guns, ammunition, year and loadouts.

The source subtype is unspecified; `mig17f` is the existing runtime slot and does
not certify an F model. Main/fork/wheel/cover geometry is retained. Two previously
excluded source parts remain in the blob/ledger under `source_excluded`, rather
than being drawn as an extra preinstalled weapon. No aircraft physics/WASM,
shader, application source or other aircraft model is changed by this import.

Reproduce from the repository root (Python requires NumPy; no Blender/GPU):

```sh
export MIG17_ARCHIVE="${MIG17_ARCHIVE:-/home/boyang/Desktop/TankForge_MiG17_模型動畫包_20261025.zip}"
python3 handoff/tools/aircraft_glb/import_mig17_animation_pack.py \
  "$MIG17_ARCHIVE" \
  handoff/aircraft_assets/mig17f-20261025/native.json

python3 - <<'PY'
from pathlib import Path
import os
from zipfile import ZipFile
p = Path('handoff/tests/out/mig17-animation-pack-20261025/source/aircraft/mig17f/model.glb')
p.parent.mkdir(parents=True, exist_ok=True)
with ZipFile(os.environ['MIG17_ARCHIVE']) as z:
    p.write_bytes(z.read('TankForge_MiG17_Animation_Pack/aircraft/mig17f/model.glb'))
PY

python3 handoff/tests/mig17_native_glb_audit.py --reference \
  handoff/tests/out/mig17-animation-pack-20261025/source/aircraft/mig17f/model.glb \
  handoff/tests/out/mig17-animation-pack-20261025/source-reference.json

node handoff/tests/mig17_native_pose_probe.mjs \
  handoff/aircraft_assets/mig17f-20261025/native.json \
  handoff/tests/out/mig17-animation-pack-20261025/source-reference.json \
  handoff/tests/out/mig17-animation-pack-20261025/cpu \
  "${MIG17_APP_SUFFIX:-handoff/bundle/app.js.html}"

python3 handoff/tests/mig17_native_glb_audit.py \
  handoff/aircraft_assets/mig17f-20261025/native.json \
  handoff/tests/out/mig17-animation-pack-20261025/source/aircraft/mig17f/model.glb \
  handoff/tests/out/mig17-animation-pack-20261025/cpu \
  handoff/tests/out/mig17-animation-pack-20261025/cpu/verification.json
```

The Node probe uses actual decoder, Aircraft constructor, mesh upload calls,
AircraftDamage and Aircraft.pose from `handoff/bundle/app.js.html`. An alternate
source-matched app may be passed as its fourth argument. To verify against an
extracted public application suffix, set `MIG17_APP_SUFFIX` to its absolute file
path before these commands; the report records the actual suffix hash. This
override reads source only and does not modify or publish that application.
The test also executes
the unchanged embedded flight212 WASM for +/-yaw and calls actual `layoutStores`
for both MiG-17 presets. Optional imported weapon sockets/material rendering
still need browser inspection. Do not commit the ignored Float32 output.

The raw server damage catalog is read on process startup into an Arc. Replacing
this JSON needs a controlled restart/reinitialization to affect new AirSeats;
the model/data patch itself requires no new Rust binary. This document does not
authorize deployment or claim GPU or historical engineering acceptance.
