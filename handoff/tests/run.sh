#!/bin/sh
# Browser verification (headless Chromium + SwiftShader WebGL2, Python Playwright).
#   ./run.sh trim              -> out/data.dev.line with su_t72a, de_pz3_j, de_tiger_e, us_m8, proto_a
#   ./run.sh page [DATA_LINE]  -> out/dev.html
#   ./run.sh TEST.js           -> runs one test script on out/dev.html, screenshots out/<test>_*.png
set -e
T=$(cd "$(dirname "$0")" && pwd); H=$(dirname "$T"); mkdir -p "$T/out"
case "$1" in
  trim)
    [ -f "$H/bundle/data.line" ] || (cat "$H"/bundle/data.line.gz.part* | gunzip > "$H/bundle/data.line")
    gcc -O2 -o "$T/out/jscan" "$T/jscan.c"
    "$T/out/jscan" "$H/bundle/data.line" 2 > "$T/out/keys2.txt"
    python3 "$T/trim.py" "$H/bundle/data.line" "$T/out/keys2.txt" "$T/out/data.dev.line" ${2:-su_t72a,de_pz3_j,de_tiger_e,us_m8,proto_a} ;;
  page) sh "$T/devpage.sh" "${2:-$T/out/data.dev.line}" "$T/out/dev.html" ;;
  *) name=$(basename "$1" .js); EVAL_TIMEOUT=${EVAL_TIMEOUT:-600} python3 "$T/pw.py" "$T/out/${PAGE:-dev.html}" "$T/$1" "$T/out/${name}_" ;;
esac
