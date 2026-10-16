#!/bin/sh
# Rebuild the TankForge variant of the AEROLAB flight core (C -> wasm32) and print its base64.
# Needs clang+wasm-ld, or zig (`pip install ziglang`, used as `python3 -m ziglang cc`).
set -e
cd "$(dirname "$0")"
CC=${CC:-}
if [ -z "$CC" ]; then if command -v clang >/dev/null; then CC=clang; else CC="python3 -m ziglang cc"; fi; fi
$CC --target=wasm32-freestanding -O2 -g0 -ffreestanding -nostdlib -fno-builtin flight_core.c \
 -Wl,--no-entry -Wl,--export=reset -Wl,--export=step -Wl,--export=configure -Wl,--export=spawn -Wl,--export=set_world \
 -Wl,--export=configure_control -Wl,--export=state_ptr -Wl,--export=state_len -Wl,--export=core_version -Wl,--export=terrain_height -Wl,--export=set_damage \
 -Wl,--strip-all -Wl,--export-memory -Wl,--initial-memory=131072 -Wl,--max-memory=131072 -Wl,-z,stack-size=32768 \
 -o flight_core.wasm
base64 -w0 flight_core.wasm > flight_core.wasm.b64
ls -l flight_core.wasm
