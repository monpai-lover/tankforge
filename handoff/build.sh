#!/bin/sh
# Reassemble the single-file build: head.html + embedded data (<script id="tf-data">) + app script.
# app.js.html is the esbuild bundle of client/web/src (newer than this branch's source) — edit it directly.
#   TF_SERVER=wss://your.host/ws ./build.sh   -> the online lobby connects to that server (not shown in the UI).
#   Without TF_SERVER the page connects to the server it was served from (tg-server serves it at /).
set -e
cd "$(dirname "$0")/bundle"
[ -f data.line ] || cat data.line.gz.part* | gunzip > data.line
out=${1:-../tankforge-full-online.html}
if [ -n "$TF_SERVER" ]; then
  sed "s|<title>|<meta name=\"tankforge-server\" content=\"$TF_SERVER\"><title>|" head.html > head.server.html
  cat head.server.html data.line app.js.html > "$out"
  rm head.server.html
else
  cat head.html data.line app.js.html > "$out"
fi
echo "wrote $out"
