#!/bin/sh
# Build the Linux x86_64 online server (tg-server, glibc >= 2.17) and pack it with the data it reads.
#   ./package.sh                -> dist/tankforge-server-linux-x86_64.tar.gz
# Needs Rust; uses cargo-zigbuild (pip install ziglang; cargo install cargo-zigbuild) for the old-glibc
# target when available, otherwise a normal release build.
set -e
H=$(cd "$(dirname "$0")" && pwd); R=$(cd "$H/../.." && pwd)
cd "$R"
if command -v cargo-zigbuild >/dev/null 2>&1; then
  cargo zigbuild --release -p tg-server --target x86_64-unknown-linux-gnu.2.17
  BIN=target/x86_64-unknown-linux-gnu/release/tg-server
else
  cargo build --release -p tg-server
  BIN=target/release/tg-server
fi
OUT="$H/dist/tankforge-server-linux-x86_64"
rm -rf "$OUT"; mkdir -p "$OUT/data/vehicles" "$OUT/data/projectiles" "$OUT/data/maps"
cp "$BIN" "$OUT/tg-server"
cp data/materials.json data/machine_guns.json data/missiles.json "$OUT/data/"
cp data/projectiles/*.json "$OUT/data/projectiles/"
for d in data/vehicles/*/; do
  v=$(basename "$d"); mkdir -p "$OUT/data/vehicles/$v"
  for f in vehicle armor modules crew weapons visual; do [ -f "$d$f.json" ] && cp "$d$f.json" "$OUT/data/vehicles/$v/"; done
done
for d in data/maps/*/; do m=$(basename "$d"); [ -f "${d}map.json" ] && mkdir -p "$OUT/data/maps/$m" && cp "${d}map.json" "$OUT/data/maps/$m/"; done
cp "$H/start.sh" "$H/tankforge-server.service" "$H/README.md" "$OUT/"
chmod +x "$OUT/start.sh" "$OUT/tg-server"
(cd "$H/dist" && tar czf tankforge-server-linux-x86_64.tar.gz tankforge-server-linux-x86_64)
ls -la "$H/dist/tankforge-server-linux-x86_64.tar.gz"
