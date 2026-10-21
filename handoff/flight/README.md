# Flight-core builds

The game consumes `../bundle/app.js.html`, which embeds this C/WASM core. Rebuilding only
`flight_core.wasm` leaves the game running an older binary. `build.sh` now rebuilds and synchronizes
the standalone WASM, its base64 file and the delivered JavaScript embedding together.

Use Clang with wasm-ld, or a pinned Zig toolchain (the current verification uses Zig 0.13.0):

```sh
python3 -m venv /tmp/tankforge-flight-tools
/tmp/tankforge-flight-tools/bin/pip install ziglang==0.13.0
CC='/tmp/tankforge-flight-tools/bin/python -m ziglang cc' sh handoff/flight/build.sh
CC='/tmp/tankforge-flight-tools/bin/python -m ziglang cc' sh handoff/flight/build.sh --check
sh handoff/build.sh
node --test handoff/tests/*.test.mjs
```

`--check` compiles to a temporary file, compares all three copies, and writes no artifacts. It
requires the same compiler and flags as the build being checked; different compiler versions can
produce different valid binaries. `--no-embed` writes the standalone WASM and base64 only, for
temporary development. Compiler failure leaves the previous delivered binary intact. Hexadecimal
memory sizes avoid a Zig 0.13 linker-option parsing problem. Memory remains fixed at two WASM pages.

Core version 203 keeps all existing telemetry offsets and adds the optional
`configure_envelope(maxG, minG, maxAoA, minAoA)` export. AoA is in radians; zero AoA bounds select
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
is still telemetry index 34, moving at 0.65 per second and feeding the existing lift/drag model.
