#!/usr/bin/env python3
"""Writes data/maps/<id>/heights.json from map.json: the terrain height grid, decoded, for the
server's missile world (crates/missile HeightGrid). The browser reads the same heights from
map.json (client/web/src/game/battlemap.js); both sample them bilinearly between texel centres.

  python3 tools/map-heights.py
"""
import base64
import json
import os
import struct
import zlib

DATA = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "data", "maps")


def main():
    for mid in sorted(os.listdir(DATA)):
        f = os.path.join(DATA, mid, "map.json")
        if not os.path.isfile(f):
            continue
        d = json.load(open(f))
        h = d["heights"]
        raw = zlib.decompress(base64.b64decode(h["data"]))
        n = h["res"]
        vals = struct.unpack("<%dh" % (len(raw) // 2), raw)
        scale = h["scale_m"]
        size = d["size_m"]
        out = {"x0": -size / 2, "z0": -size / 2, "size": size, "res": n,
               "heights": [round(v * scale, 2) for v in vals]}
        assert len(out["heights"]) == n * n, (mid, len(vals), n)
        p = os.path.join(DATA, mid, "heights.json")
        with open(p, "w") as fo:
            json.dump(out, fo, separators=(",", ":"))
        print(mid, n, "x", n, os.path.getsize(p) // 1024, "KB")


if __name__ == "__main__":
    main()
