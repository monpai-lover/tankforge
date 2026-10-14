#!/bin/sh
# Reassemble the single-file build: head.html + embedded data (<script id="tf-data">) + app script.
# app.js.html is the esbuild bundle of client/web/src (newer than this branch's source) — edit it directly.
set -e
cd "$(dirname "$0")/bundle"
[ -f data.line ] || cat data.line.gz.part* | gunzip > data.line
out=${1:-../tankforge-full-online.html}
cat head.html data.line app.js.html > "$out"
echo "wrote $out"
