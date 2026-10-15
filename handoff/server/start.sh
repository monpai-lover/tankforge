#!/bin/sh
# Starts the TankForge online server. Put the game page (from handoff/build.sh) next to it as
# tankforge.html: players then open http://<server>:<PORT>/ and the lobby connects back by itself.
cd "$(dirname "$0")"
exec ./tg-server --port "${PORT:-8787}" --bind "${BIND:-0.0.0.0}" --data data --page "${PAGE:-tankforge.html}"
