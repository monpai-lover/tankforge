#!/usr/bin/env python3
"""Takes a machine gun out of a model (.glb), puts it in the frame of its pintle and makes it
light (vertex clustering), for the roof guns every vehicle with that weapon shares
(client/web/src/gfx/mgmodel.js).

  python3 tools/mg_asset.py client/web/assets/mg_models.json <id> <file.glb> <nodes,...> \\
      --pivot x,y,z (glTF units: the top of the pintle, under the gun) [--back] (the gun points -z)
      [--ymin y] (only triangles above this) [--cell m] (clustering cell, default 0.007)
      [--muzzle m] (muzzle distance ahead of the pivot; default the gun's front)
      [--source text]
      [--cellnode NODE=m] (a finer clustering cell for one node's triangles: a thin ring sight)
      [--roll NODE=deg@x,y] (that node turned about the bore-parallel axis through x,y: an
                ammunition box modelled askew, set upright)

The game frame is x right (glTF x mirrored), y up, z along the gun. Each triangle keeps the
colour of its material (the colour map sampled at its middle). Written into the asset as
positions in millimetres per triangle corner (flat shaded), a colour index per triangle and the
palette.
"""
import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'client', 'web', 'tools'))
from gltf_util import load, scene_meshes, diffuse_texture  # noqa: E402


def arg(name, default=None):
    a = sys.argv
    return a[a.index(name) + 1] if name in a else default


def main():
    out, gid, glb, names = sys.argv[1:5]
    names = names.split(',')
    pivot = np.array([float(v) for v in arg('--pivot').split(',')])
    back = '--back' in sys.argv
    ymin = float(arg('--ymin', '-1e9'))
    cell = float(arg('--cell', '0.007'))
    j, acc, image = load(glb)
    # which meshes: the nodes named (and their children)
    want = {}

    def mark(i, on):
        n = j['nodes'][i]
        on = on or (n.get('name') if n.get('name') in names else None)
        if on and 'mesh' in n:
            want[n['mesh']] = on
        for c in n.get('children', []):
            mark(c, on)
    for r in j['scenes'][j.get('scene', 0)]['nodes']:
        mark(r, False)
    imgs = {}
    T, C, G = [], [], []
    for mesh, prim, P, N, uv, I in scene_meshes(j, acc):
        if mesh not in want:
            continue
        tri = P[I]
        keep = tri[:, :, 1].mean(1) > ymin
        tri = tri[keep]
        mat = prim.get('material')
        col = np.array([0.15, 0.15, 0.15])
        cols = np.repeat(col[None], len(tri), 0)
        if mat is not None:
            m = j['materials'][mat]
            f = np.array(m.get('pbrMetallicRoughness', {}).get('baseColorFactor', [1, 1, 1, 1])[:3])
            t = diffuse_texture(j, mat)
            if t is not None and uv is not None:
                if t not in imgs:
                    imgs[t] = np.asarray(image(t).convert('RGB'), float) / 255.0
                im = imgs[t]
                c = uv[I][keep].mean(1)
                u = np.mod(c[:, 0], 1.0)
                v = np.mod(c[:, 1], 1.0)
                cols = im[(v * (im.shape[0] - 1)).astype(int), (u * (im.shape[1] - 1)).astype(int)] * f
            else:
                cols = np.repeat((f ** (1 / 2.2))[None], len(tri), 0)
        roll = dict(r.split('=') for r in arg('--roll', '').split(';') if r)
        if want[mesh] in roll:
            deg, at = roll[want[mesh]].split('@')
            cx, cy = (float(v) for v in at.split(','))
            th = np.radians(float(deg))
            lean = np.ones(len(tri), bool)
            c, sn = np.cos(th), np.sin(th)
            x, y = tri[lean][:, :, 0] - cx, tri[lean][:, :, 1] - cy
            t2 = tri.copy()
            t2[lean, :, 0] = cx + x * c - y * sn
            t2[lean, :, 1] = cy + x * sn + y * c
            tri = t2
        T.append(tri)
        C.append(cols)
        G.extend([want[mesh]] * len(tri))
    T = np.concatenate(T)
    C = np.concatenate(C)
    G = np.array(G)
    # into the pintle's frame: mirror glTF's x, the gun forward along +z
    Q = T - pivot
    Q[:, :, 0] *= -1
    if back:
        Q[:, :, 0] *= -1
        Q[:, :, 2] *= -1
    else:
        pass
    # vertex clustering (a finer cell for the nodes named in --cellnode, kept apart)
    V = Q.reshape(-1, 3)
    cells = np.full(len(Q), cell)
    for r in [r for r in arg('--cellnode', '').split(';') if r]:
        nm, m = r.split('=')
        cells[G == nm] = float(m)
    cv = np.repeat(cells, 3)
    key = np.c_[np.round(V / cv[:, None]).astype(np.int64), np.round(cv * 1e4).astype(np.int64)]
    uniq, inv = np.unique(key, axis=0, return_inverse=True)
    inv = inv.ravel()
    sums = np.zeros((len(uniq), 3))
    np.add.at(sums, inv, V)
    cnt = np.bincount(inv, minlength=len(uniq))[:, None]
    centres = sums / cnt
    F = inv.reshape(-1, 3)
    ok = (F[:, 0] != F[:, 1]) & (F[:, 1] != F[:, 2]) & (F[:, 0] != F[:, 2])
    F, C = F[ok], C[ok]
    # duplicates (same three corners) collapse
    s = np.sort(F, 1)
    _, first = np.unique(s, axis=0, return_index=True)
    F, C = F[np.sort(first)], C[np.sort(first)]
    tri = centres[F]
    # one mirror (glTF to game) turns the winding over; turning about y does not
    tri = tri[:, [0, 2, 1]]
    # palette: colours to 24 levels
    q = np.clip(np.round(np.clip(C, 0, 1) * 23), 0, 23).astype(int)
    keys, cidx = np.unique(q[:, 0] * 576 + q[:, 1] * 24 + q[:, 2], return_inverse=True)
    palette = [[int(k // 576) / 23, int((k // 24) % 24) / 23, int(k % 24) / 23] for k in keys]
    muzzle = float(arg('--muzzle', tri[:, :, 2].max()))
    entry = {
        'source': arg('--source', ''),
        'muzzle': round(muzzle, 3),
        'triangles': int(len(tri)),
        'pos': np.round(tri.reshape(-1) * 1000).astype(int).tolist(),
        'col': cidx.astype(int).tolist(),
        'palette': [[round(c, 3) for c in p] for p in palette],
    }
    data = json.load(open(out)) if os.path.exists(out) else {}
    data[gid] = entry
    with open(out, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    lo, hi = tri.reshape(-1, 3).min(0), tri.reshape(-1, 3).max(0)
    print('%s: %d triangles (from %d), %d colours, x %.2f..%.2f y %.2f..%.2f z %.2f..%.2f, %d KB' % (
        gid, len(tri), len(T), len(palette), lo[0], hi[0], lo[1], hi[1], lo[2], hi[2], os.path.getsize(out) // 1024))


if __name__ == '__main__':
    main()
