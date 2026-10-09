#!/usr/bin/env python3
"""Takes named pieces out of a glTF binary (.glb) model and writes them as an imported render
model (the model.json format of tools/wt_import.py) for a vehicle the generator builds: the
pieces go on the gun and barrel mounts of a turret, scaled into metres, mirrored from glTF's
right-handed frame into the game's (x right, y up, z forward) and moved so that a chosen point of
the source (its trunnion) lands on the vehicle's gun mount. Each piece is painted one flat colour
(glTF files from Sketchfab often carry no textures).

  python3 tools/glb_parts.py <spec.json>

spec: {"glb": path, "out": path, "scale": m per unit, "pivot": [x, y, z] source units,
       "mount": [x, y, z] metres, "source": attribution text,
       "pieces": [{"prefix": node name prefix, "mount": "gun" | "barrel", "gun": 0, "color": "#rrggbb",
                   "keep_above": [axis, source value] (optional: keep only what lies ahead of it)}]}
"""
import base64
import io
import json
import struct
import sys
import zlib

import numpy as np
from PIL import Image

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4, "MAT4": 16}


def load(path):
    b = open(path, "rb").read()
    off = 12
    chunks = []
    while off < len(b):
        cl, _ct = struct.unpack("<II", b[off:off + 8])
        chunks.append(b[off + 8:off + 8 + cl])
        off += 8 + cl
    return json.loads(chunks[0]), chunks[1]


def accessor(j, bn, i):
    a = j["accessors"][i]
    bv = j["bufferViews"][a["bufferView"]]
    n = NC[a["type"]]
    dt = np.dtype(CT[a["componentType"]])
    o = bv.get("byteOffset", 0) + a.get("byteOffset", 0)
    stride = bv.get("byteStride") or dt.itemsize * n
    raw = np.frombuffer(bn, np.uint8, count=stride * (a["count"] - 1) + dt.itemsize * n, offset=o)
    rows = np.lib.stride_tricks.as_strided(raw, shape=(a["count"], dt.itemsize * n), strides=(stride, 1))
    return np.ascontiguousarray(rows).view(dt).reshape(a["count"], n).astype(np.float64 if dt.kind == "f" else np.int64)


def quat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def local(n):
    if "matrix" in n:
        return np.array(n["matrix"], float).reshape(4, 4).T
    M = np.eye(4)
    if "scale" in n:
        M = np.diag(list(n["scale"]) + [1.0]) @ M
    if "rotation" in n:
        R = np.eye(4)
        R[:3, :3] = quat(n["rotation"])
        M = R @ M
    if "translation" in n:
        T = np.eye(4)
        T[:3, 3] = n["translation"]
        M = T @ M
    return M


def meshes(j, bn):
    out = []

    def walk(i, P, names):
        n = j["nodes"][i]
        W = P @ local(n)
        names = names + [n.get("name") or ""]
        if "mesh" in n:
            for pr in j["meshes"][n["mesh"]]["primitives"]:
                V = accessor(j, bn, pr["attributes"]["POSITION"])
                N = accessor(j, bn, pr["attributes"]["NORMAL"]) if "NORMAL" in pr["attributes"] else np.zeros_like(V)
                I = accessor(j, bn, pr["indices"]).reshape(-1, 3)
                Vw = V @ W[:3, :3].T + W[:3, 3]
                Nw = N @ np.linalg.inv(W[:3, :3])
                Nw /= np.maximum(1e-9, np.linalg.norm(Nw, axis=1))[:, None]
                out.append({"names": names, "V": Vw, "N": Nw, "I": I})
        for c in n.get("children", []):
            walk(c, W, names)

    for r in j["scenes"][j.get("scene", 0)]["nodes"]:
        walk(r, np.eye(4), [])
    return out


def color_texture(hex_color):
    img = Image.new("RGB", (8, 8), tuple(int(hex_color[i:i + 2], 16) for i in (1, 3, 5)))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def main():
    spec = json.load(open(sys.argv[1]))
    j, bn = load(spec["glb"])
    ms = meshes(j, bn)
    s = float(spec["scale"])
    pivot = np.array(spec["pivot"], float)
    mount = np.array(spec["mount"], float)
    textures = []
    tex_of = {}
    blob = bytearray()

    def put(arr):
        o = len(blob)
        blob.extend(np.ascontiguousarray(arr).tobytes())
        while len(blob) % 4:
            blob.append(0)
        return o

    parts = []
    lo = np.full(3, np.inf)
    hi = np.full(3, -np.inf)
    for pc in spec["pieces"]:
        sel = [m for m in ms if any(nm.startswith(pc["prefix"]) for nm in m["names"])]
        if not sel:
            raise SystemExit("no node starts with " + pc["prefix"])
        P = np.concatenate([m["V"] for m in sel])
        N = np.concatenate([m["N"] for m in sel])
        I = []
        k = 0
        for m in sel:
            I.append(m["I"] + k)
            k += len(m["V"])
        I = np.concatenate(I)
        if "keep_above" in pc:
            # only the triangles whose middle lies ahead of this source z (the nose of a housing)
            axis, lim = pc["keep_above"]
            I = I[P[I].mean(1)[:, axis] >= lim]
            used = np.unique(I)
            remap = np.full(len(P), -1, np.int64)
            remap[used] = np.arange(len(used))
            P, N, I = P[used], N[used], remap[I]
        # glTF (right-handed, +z toward the viewer) to the game (x right, z forward): mirror x,
        # which turns the triangles' winding over
        P = (P * [-1, 1, 1] - pivot * [-1, 1, 1]) * s + mount
        N = N * [-1, 1, 1]
        I = I[:, [0, 2, 1]]
        lo = np.minimum(lo, P.min(0))
        hi = np.maximum(hi, P.max(0))
        col = pc["color"]
        if col not in tex_of:
            tex_of[col] = len(textures)
            textures.append({"src": color_texture(col), "size": [8, 8], "image": len(textures), "alpha": False})
        idx32 = len(P) > 65535
        part = {"mount": pc["mount"], "texture": tex_of[col], "normal": -1, "vertices": int(len(P)), "triangles": int(len(I)), "idx32": bool(idx32),
                "pos": put(np.round(P * 1000).astype(np.int16)), "nor": put(np.round(N * 127).astype(np.int8)),
                "uv": put(np.full((len(P), 2), 32768, np.uint16)), "idx": put(I.reshape(-1).astype(np.uint32 if idx32 else np.uint16)),
                "gun": int(pc.get("gun", 0))}
        if "turret" in pc:
            part["turret"] = int(pc["turret"])
        parts.append(part)
        print("%-24s %-6s %6d vertices %6d triangles  x %.2f..%.2f y %.2f..%.2f z %.2f..%.2f" % (
            pc["prefix"], pc["mount"], len(P), len(I), P[:, 0].min(), P[:, 0].max(), P[:, 1].min(), P[:, 1].max(), P[:, 2].min(), P[:, 2].max()))
    out = {"version": 1, "source": spec.get("source", ""), "bounds": [lo.round(3).tolist(), hi.round(3).tolist()],
           "textures": textures, "parts": parts, "blob": base64.b64encode(zlib.compress(bytes(blob), 9)).decode(), "blob_size": len(blob)}
    with open(spec["out"], "w") as f:
        json.dump(out, f, separators=(",", ":"))
    print("wrote", spec["out"], len(json.dumps(out)) // 1024, "KB")


if __name__ == "__main__":
    main()
