#!/bin/sh
# Rebuild the flight core and synchronize the standalone, base64 and delivered page copies.
# --check rebuilds without writing and verifies all three copies; --no-embed only writes standalone.
# Needs clang+wasm-ld, or zig (`pip install ziglang==0.13.0`, used as `python3 -m ziglang cc`).
set -e
cd "$(dirname "$0")"
mode=${1:---embed}
case "$mode" in --embed|--check|--no-embed) ;; *) echo "usage: $0 [--embed|--check|--no-embed]" >&2; exit 2 ;; esac
flight_build_dir=$(mktemp -d)
trap 'rm -rf "$flight_build_dir"' EXIT HUP INT TERM
CC=${CC:-}
if [ -z "$CC" ]; then if command -v clang >/dev/null; then CC=clang; else CC="python3 -m ziglang cc"; fi; fi
build_core() {
$CC --target=wasm32-freestanding -O2 -g0 -ffreestanding -nostdlib -fno-builtin flight_core.c \
 -Wl,--no-entry -Wl,--export=reset -Wl,--export=step -Wl,--export=configure -Wl,--export=spawn -Wl,--export=set_world \
 -Wl,--export=configure_control -Wl,--export=configure_envelope -Wl,--export=configure_surfaces -Wl,--export=configure_gear_sequence -Wl,--export=set_gear_failure -Wl,--export=aero_state_ptr -Wl,--export=aero_state_len -Wl,--export=state_ptr -Wl,--export=state_len -Wl,--export=core_version -Wl,--export=terrain_height -Wl,--export=set_damage -Wl,--export=configure_airframe -Wl,--export=impulse -Wl,--export=adopt_kinematics -Wl,--export=seed_control_state \
 -Wl,--strip-all -Wl,--export-memory -Wl,--initial-memory=$1 -Wl,--max-memory=$1 -Wl,-z,stack-size=$2 \
 -o "$flight_build_dir/flight_core.wasm"
}
# Hexadecimal sizes avoid a Zig 0.13 decimal linker-option parsing bug; later Zig releases accept only
# decimal ones (the same 2 pages and 32 KiB stack).
build_core 0x20000 0x8000 2>/dev/null || build_core 131072 32768
python3 - "$flight_build_dir/flight_core.wasm" "$mode" <<'PY'
from pathlib import Path
import base64, hashlib, re, sys
compiled = Path(sys.argv[1]).read_bytes()
mode = sys.argv[2]
encoded = base64.b64encode(compiled).decode('ascii')
page = Path('../bundle/app.js.html')
source = page.read_text()
pattern = r'(var FLIGHT_CORE_WASM = ")[^"]+(";)'
matches = list(re.finditer(pattern, source))
if len(matches) != 1:
    raise SystemExit('Expected exactly one delivered flight-core embedding')
if mode == '--check':
    if Path('flight_core.wasm').read_bytes() != compiled:
        raise SystemExit('Standalone WASM differs from this source/compiler rebuild')
    if Path('flight_core.wasm.b64').read_text() != encoded:
        raise SystemExit('Base64 WASM differs from rebuilt core')
    if base64.b64decode(matches[0].group()[len(matches[0].group(1)):-len(matches[0].group(2))]) != compiled:
        raise SystemExit('Delivered page embeds a different flight core')
else:
    updated = re.sub(pattern, lambda m: m[1] + encoded + m[2], source)
    Path('flight_core.wasm').write_bytes(compiled)
    Path('flight_core.wasm.b64').write_text(encoded)
    if mode == '--embed':
        page.write_text(updated)
print(f'{mode}: {len(compiled)} bytes; SHA256 {hashlib.sha256(compiled).hexdigest()}')
PY
