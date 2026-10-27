# Flight-core builds

The game consumes `../bundle/app.js.html`, which embeds this C/WASM core. Rebuilding only
`flight_core.wasm` leaves the game running an older binary. `build.sh` now rebuilds and synchronizes
the standalone WASM, its base64 file and the delivered JavaScript embedding together.

Use Clang with wasm-ld, or a pinned Zig toolchain (the current verification uses Zig 0.17.0):

```sh
python3 -m venv /tmp/tankforge-flight-tools
/tmp/tankforge-flight-tools/bin/pip install ziglang==0.17.0
CC='/tmp/tankforge-flight-tools/bin/python -m ziglang cc' sh handoff/flight/build.sh
CC='/tmp/tankforge-flight-tools/bin/python -m ziglang cc' sh handoff/flight/build.sh --check
sh handoff/build.sh
for test in handoff/tests/*.test.mjs; do node "$test" || exit; done
```

`--check` compiles to a temporary file, compares all three copies, and writes no artifacts. It
requires the same compiler and flags as the build being checked; different compiler versions can
produce different valid binaries. `--no-embed` writes the standalone WASM and base64 only, for
temporary development. Compiler failure leaves the previous delivered binary intact. Hexadecimal
memory sizes avoid a Zig 0.13 linker-option parsing problem. Memory remains fixed at two WASM pages.

Core version 203 kept all existing telemetry offsets and added the optional
`configure_envelope(maxG, minG, maxAoA, minAoA)` export. Version 204 adds only
`impulse(dvx, dvy, dvz, dwx, dwy, dwz)` (gun recoil and store release: a world-frame velocity change
and a body-frame angular-rate change, bounded per call); its dynamics are otherwise unchanged (the
envelope scenarios of all types give identical telemetry with the 203 and 204 builds). Zig 0.17 also
builds it (build.sh falls back to decimal memory sizes). Version 205 keeps the exports and telemetry
offsets; on the wheels (a ground contact within the last 0.3 s) the instructor steers with the rudder
only: its roll command is dropped, and its pitch command too below about 90% of the speed at which
10 deg of incidence lifts the weight (manual keys unchanged). Version 206 keeps the exports and telemetry: on the wheels below the rotation speed the roll keys
steer with the yaw keys (no roll), the nose / tail wheel turns up to 60 deg at taxi speed (6 deg by
take-off speed, wheelbase 0.42 span) and under 4 m/s the differential brakes pivot it (up to 25 deg/s).
AoA is in radians; zero AoA bounds select
airframe-relative defaults. These are conservative limits for this game's approximate plant, not
certified historical aircraft limits. The client sets each aircraft's positive limit, a default
negative limit of −3 G, and permits type overrides through `minGLimit`, `maxAoA` and `minAoA`.

The legacy `configure()` and `step()` signatures are retained. Envelope intervention requires both
protection and the instructor to be enabled, including during manual override. Turning either off
disables intervention. The protection changes control commands; it does not clip physical load,
attitude or velocity, so actuator delay, extreme initial conditions and damage can still exceed a
limit. Read the measured scenarios and limitations in `../FLIGHT_CONTROL_IMPROVEMENTS.md`.

Flap commands remain part of `step()` flags: 128 selects takeoff (0.5), 64 selects combat (0.25),
and no flap bits selects up (0). The older bit 8 still selects full (1.0) for ABI compatibility;
128 and 64 take precedence over it. The game UI exposes only up/combat/takeoff. Actual flap state
is still telemetry index 34, moving at 0.65 per second and feeding the wing-strip lift/drag model.

Version 211 replaces the aggregate lift and prescribed aerodynamic torques with twelve wing
strips, a horizontal tail (except tailless types), a fin and distributed fuselage side forces.
Each surface sees body velocity plus `omega × offset`; forces and `offset × force` moments are
summed before rigid-body integration. The instructor uses the same surface control derivatives
and retains extra AoA recovery headroom for local wing stall. See
[surface implementation and validation](../SURFACE_AERODYNAMICS_20261024.md).

The optional `configure_surfaces(root, tip, wingY, wingZ, tailZ, tailArea, finZ, finArea,
rollTravel, pitchUpTravel, pitchDownTravel, yawTravel, flapTravel, sweep, taper,
tailless, stabilator)` export accepts CG-relative metres, square metres, radians and two integer
flags. `configure_airframe()` resets surface geometry to defaults; the host must reapply the
model geometry afterward, including when fuel/stores change mass. The game does this on spawn
and both load-update paths for players and AI.

The original accepted state remains 80 floats. `aero_state_ptr()` / `aero_state_len()` expose a
separate 48-float view: mean left/right alpha [0–1], stall [2–3], wing lift [4–5], tail lift [6],
fin side force [7], actual roll/pitch/yaw/flap travel [8–11], pitch/roll/yaw control derivatives
[12–14], CG dynamic pressure [15], total body force [16–18], total aerodynamic torque [19–21],
forward-speed reference [22], accepted airbrake fraction [23], and each strip's stall [24–35].
Reserved values are zero. Forces are newtons, torque is N·m and angles are radians. Airbrake
extension now slews at 1/s and its accepted value drives both drag and rendering.
