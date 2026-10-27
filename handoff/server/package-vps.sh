#!/bin/sh
# Build the complete VPS package: online server + data + the full game page + installer.
#   ./package-vps.sh   -> dist/tankforge-vps.tar.gz   (copy to the VPS, unpack, sudo ./install.sh)
# Rebuild the server/data package so an older cached directory cannot silently
# remove current campaign maps, native chassis engines or aircraft profiles.
set -e
H=$(cd "$(dirname "$0")" && pwd)
"$H/package.sh"
OUT="$H/dist/tankforge-vps"
rm -rf "$OUT"; mkdir -p "$OUT/server" "$OUT/www"
cp -r "$H/dist/tankforge-server-linux-x86_64/tg-server" "$H/dist/tankforge-server-linux-x86_64/data" "$OUT/server/"
# The page connects to the origin it is served from (https -> wss://<domain>/ws), so no TF_SERVER here.
"$H/../build.sh" "$OUT/www/index.html"
if command -v pigz >/dev/null 2>&1; then pigz -9 "$OUT/www/index.html"; else gzip -9 "$OUT/www/index.html"; fi
cp "$H/vps/install.sh" "$H/vps/update-existing.sh" "$H/vps/update-page.sh" "$H/vps/tankforge-vps.service" "$H/vps/Caddyfile.site" "$H/vps/nginx-site.conf" "$H/vps/README.md" "$OUT/"
chmod +x "$OUT/install.sh" "$OUT/update-existing.sh" "$OUT/update-page.sh" "$OUT/server/tg-server"
(cd "$OUT" && find . -type f ! -name SHA256SUMS | sort | xargs sha256sum > SHA256SUMS)
(cd "$H/dist" && tar cf - tankforge-vps | gzip -1 > tankforge-vps.tar.gz)
ls -la "$H/dist/tankforge-vps.tar.gz"
