#!/usr/bin/env python3
"""Crew figures for the vehicles, made from the War Thunder crew models:

  UK Gunner Officer (War Thunder Crew) by KojfDiscord, CC BY 4.0
    https://sketchfab.com/3d-models/uk-gunner-officer-war-thunder-crew-18e8a0984d0c494f955c4f04cd1a75ed
  FR Gunner (War Thunder Crew) by KojfDiscord, CC BY 4.0
    https://sketchfab.com/3d-models/fr-gunner-war-thunder-crew-1fe6488372cf4ddf939c0cf153e3935b

The models are single static meshes standing in an A pose, with no skeleton. Here each one gets a
skeleton fitted to its shape (pelvis, spine, neck and head; shoulder, elbow and wrist; hip, knee
and ankle -- found from slices through the figure), every vertex is weighted to the bones it lies
nearest (blended where two bones meet), and the figure is posed by turning each bone onto a target
direction: seated at the controls (thighs forward, shins down, hands forward on the levers or
handwheels) and standing (the loader, a round held in front of him). Linear blend skinning, done
here once, gives the posed meshes; the game draws them with the model's own colour map (both of
its textures packed into one atlas: the uniform, and the face cut out of the head sheet).

Writes assets/crew_model.json (version 2): figures [{name, texture (JPEG data URL), index, uv,
poses: {seated, standing: {pos (mm, int16), nor (int8)}}}], the commander as the officer and the
others as the gunner.

  python3 tools/crew-glb.py uk_crew.glb fr_crew.glb assets/crew_model.json [--preview DIR]
"""
import base64
import io
import json
import math
import os
import struct
import sys

import numpy as np
from PIL import Image

HEIGHT = 1.75  # standing height in the game (the figures are 1.63 m)


def load(path):
    b = open(path, 'rb').read()
    off = 12
    chunks = []
    while off < len(b):
        cl, ct = struct.unpack('<II', b[off:off + 8])
        chunks.append(b[off + 8:off + 8 + cl])
        off += 8 + cl
    j = json.loads(chunks[0])
    B = chunks[1]

    def acc(i):
        a = j['accessors'][i]
        bv = j['bufferViews'][a['bufferView']]
        ct = {5126: np.float32, 5123: np.uint16, 5121: np.uint8, 5125: np.uint32}[a['componentType']]
        n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
        o = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
        stride = bv.get('byteStride')
        isz = np.dtype(ct).itemsize
        if stride and stride != isz * n:
            raw = np.frombuffer(B, dtype=np.uint8, count=stride * a['count'], offset=o).reshape(a['count'], stride)
            arr = raw[:, :isz * n].copy().view(ct).reshape(a['count'], n)
        else:
            arr = np.frombuffer(B, dtype=ct, count=a['count'] * n, offset=o).reshape(a['count'], n)
        return arr.astype(np.float64) if n > 1 else arr.reshape(-1).astype(np.int64)

    def image(i):
        bv = j['bufferViews'][j['images'][i]['bufferView']]
        o = bv.get('byteOffset', 0)
        return Image.open(io.BytesIO(B[o:o + bv['byteLength']])).convert('RGB')

    return j, acc, image


def node_matrix(n):
    if 'matrix' in n:
        return np.array(n['matrix'], float).reshape(4, 4).T
    x, y, z, w = n.get('rotation', [0, 0, 0, 1])
    R = np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
    M = np.eye(4)
    M[:3, :3] = R * np.array(n.get('scale', [1, 1, 1]), float)[None, :]
    M[:3, 3] = n.get('translation', [0, 0, 0])
    return M


def scene_primitives(j):
    """(primitive, world matrix) of every mesh in the scene."""
    out = []

    def walk(i, M):
        n = j['nodes'][i]
        W = M @ node_matrix(n)
        if 'mesh' in n:
            out.extend((p, W) for p in j['meshes'][n['mesh']]['primitives'])
        for c in n.get('children', []):
            walk(c, W)

    for r in j['scenes'][j.get('scene', 0)]['nodes']:
        walk(r, np.eye(4))
    return out


def figure_mesh(path):
    """Positions, normals, uv (in the atlas), triangles and the atlas image of one figure."""
    j, acc, image = load(path)
    placed = scene_primitives(j)
    world = {id(p): W for p, W in placed}
    prims = [p for p, _ in placed]
    # the bigger primitive is the body (uniform sheet); the other the head (face sheet)
    prims.sort(key=lambda p: -j['accessors'][p['indices']]['count'])
    tex = []
    for p in prims:
        e = j['materials'][p['material']]['extensions']['KHR_materials_pbrSpecularGlossiness']
        tex.append(image(j['textures'][e['diffuseTexture']['index']]['source']))
    # glTF texture space: v down from the top, repeating (the files store v - 1)
    uvs = [acc(p['attributes']['TEXCOORD_0']) for p in prims]
    uvs = [np.c_[u[:, 0], u[:, 1] - np.floor(u[:, 1])] for u in uvs]
    # atlas: the uniform sheet 1024 x 1024 on top, the used part of the face sheet below it
    body = tex[0].resize((1024, 1024), Image.LANCZOS)
    hu = uvs[1]
    u0, v0 = hu.min(0) - 0.004
    u1, v1 = hu.max(0) + 0.004
    W, H = tex[1].size
    crop = tex[1].crop((int(u0 * W), int(v0 * H), int(math.ceil(u1 * W)), int(math.ceil(v1 * H))))
    ch = 256
    cw = min(1024, int(round(crop.width * ch / crop.height)))
    face = crop.resize((cw, ch), Image.LANCZOS)
    atlas = Image.new('RGB', (1024, 1024 + ch), (60, 55, 48))
    atlas.paste(body, (0, 0))
    atlas.paste(face, (0, 1024))
    AH = 1024 + ch
    P, N, UV, I = [], [], [], []
    base = 0
    for k, p in enumerate(prims):
        W = world[id(p)]
        pos = acc(p['attributes']['POSITION']) @ W[:3, :3].T + W[:3, 3]
        nor = acc(p['attributes']['NORMAL']) @ np.linalg.inv(W[:3, :3])
        nor /= np.linalg.norm(nor, axis=1, keepdims=True) + 1e-12
        uv = uvs[k]
        if k == 0:
            uv = np.c_[uv[:, 0], uv[:, 1] * 1024 / AH]
        else:
            uv = np.c_[(uv[:, 0] - u0) / (u1 - u0) * cw / 1024, (1024 + (uv[:, 1] - v0) / (v1 - v0) * ch) / AH]
        P.append(pos)
        N.append(nor)
        UV.append(uv)
        I.append(acc(p['indices']).reshape(-1, 3) + base)
        base += len(pos)
    return np.concatenate(P), np.concatenate(N), np.concatenate(UV), np.concatenate(I), atlas


# --------------------------------------------------------------------------- skeleton

def centroid(P, sel):
    return P[sel].mean(0) if sel.any() else None


def fit_skeleton(P):
    """Joint positions from slices through the A-posed figure (glTF frame: +x the figure's left,
    +y up, +z forward). Bones: (name, parent, head joint, tail joint)."""
    top = P[:, 1].max()
    s = top / 1.63
    J = {}
    J['pelvis'] = np.array([0, 0.93 * s, P[(P[:, 1] > 0.88 * s) & (P[:, 1] < 0.98 * s) & (np.abs(P[:, 0]) < 0.15)][:, 2].mean()])
    J['chest'] = np.array([0, 1.22 * s, P[(P[:, 1] > 1.18 * s) & (P[:, 1] < 1.26 * s) & (np.abs(P[:, 0]) < 0.12)][:, 2].mean()])
    J['neck'] = np.array([0, 1.43 * s, P[(P[:, 1] > 1.41 * s) & (P[:, 1] < 1.46 * s) & (np.abs(P[:, 0]) < 0.08)][:, 2].mean()])
    J['head'] = np.array([0, top, J['neck'][2] + 0.02])
    for side, sg in (('l', 1), ('r', -1)):
        arm = (sg * P[:, 0] > 0.18 * s) & (P[:, 1] > 0.8 * s)
        at = lambda x0, x1: centroid(P, arm & (sg * P[:, 0] > x0 * s) & (sg * P[:, 0] < x1 * s))
        sh = at(0.17, 0.23)
        sh[0] = sg * 0.19 * s
        sh[1] += 0.04 * s
        J['shoulder_' + side] = sh
        J['elbow_' + side] = at(0.34, 0.38)
        J['wrist_' + side] = at(0.43, 0.46)
        J['hand_' + side] = at(0.5, 0.56)
        leg = (sg * P[:, 0] > 0.0) & (P[:, 1] < 0.9 * s)
        lt = lambda y0, y1: centroid(P, leg & (P[:, 1] > y0 * s) & (P[:, 1] < y1 * s))
        hip = lt(0.84, 0.9)
        hip[0] = sg * max(abs(hip[0]), 0.09 * s)
        J['hip_' + side] = hip
        J['knee_' + side] = lt(0.46, 0.52)
        J['ankle_' + side] = lt(0.08, 0.12)
        toe = centroid(P, leg & (P[:, 1] < 0.06 * s) & (P[:, 2] > P[leg & (P[:, 1] < 0.06 * s)][:, 2].max() - 0.06 * s))
        J['toe_' + side] = toe
    bones = [
        ('pelvis', None, 'pelvis', 'chest'),
        ('chest', 'pelvis', 'chest', 'neck'),
        ('head', 'chest', 'neck', 'head'),
    ]
    for side in 'lr':
        bones += [
            ('upper_arm_' + side, 'chest', 'shoulder_' + side, 'elbow_' + side),
            ('forearm_' + side, 'upper_arm_' + side, 'elbow_' + side, 'wrist_' + side),
            ('hand_' + side, 'forearm_' + side, 'wrist_' + side, 'hand_' + side),
            ('thigh_' + side, 'pelvis', 'hip_' + side, 'knee_' + side),
            ('shin_' + side, 'thigh_' + side, 'knee_' + side, 'ankle_' + side),
            ('foot_' + side, 'shin_' + side, 'ankle_' + side, 'toe_' + side),
        ]
    return J, bones, s


def seg_dist(P, a, b):
    d = b - a
    t = np.clip(((P - a) @ d) / (d @ d), 0, 1)
    return np.linalg.norm(P - (a + t[:, None] * d), axis=1), t


def weights(P, J, bones, s):
    """Each vertex to its nearest bones (allowed by region), blended softly where they meet."""
    nb = len(bones)
    D = np.full((len(P), nb), 1e9)
    x, y = P[:, 0], P[:, 1]
    for k, (name, parent, h, t) in enumerate(bones):
        d, _ = seg_dist(P, J[h], J[t])
        ok = np.ones(len(P), bool)
        if name.startswith(('upper_arm', 'forearm', 'hand')):
            sg = 1 if name.endswith('_l') else -1
            ok = (sg * x > 0.15 * s) & (y > 0.85 * s)
        elif name.startswith(('thigh', 'shin', 'foot')):
            sg = 1 if name.endswith('_l') else -1
            ok = (sg * x > -0.02 * s) & (y < 0.98 * s)
        elif name == 'head':
            ok = y > 1.36 * s
        elif name == 'chest':
            ok = y > 0.95 * s
        elif name == 'pelvis':
            ok = y > 0.7 * s
        D[ok, k] = d[ok]
    # soft minimum: bones within a few cm of the nearest share the vertex
    dmin = D.min(1, keepdims=True)
    Wt = np.exp(-(D - dmin) / (0.025 * s))
    Wt[D > 1e8] = 0
    # at most three bones
    order = np.argsort(-Wt, axis=1)
    keep = np.zeros_like(Wt, bool)
    np.put_along_axis(keep, order[:, :3], True, axis=1)
    Wt[~keep] = 0
    Wt /= Wt.sum(1, keepdims=True)
    return Wt


def align(a, b):
    """Rotation matrix turning unit vector a onto unit vector b (the shortest way)."""
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    c = a @ b
    if np.linalg.norm(v) < 1e-9:
        return np.eye(3) if c > 0 else -np.eye(3) + 2 * np.outer([1, 0, 0], [1, 0, 0])
    K = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + K + K @ K * (1 / (1 + c))


def pose(J, bones, targets):
    """Bone transforms (R, rest joint, posed joint) for target directions (figure frame); bones
    without a target keep their parent's turn."""
    T = {}
    for name, parent, h, t in bones:
        rest = J[t] - J[h]
        if parent is None:
            Rp, hp = np.eye(3), J[h]
        else:
            pR, pJ, pJ2 = T[parent]
            Rp = pR
            hp = pJ2 + pR @ (J[h] - pJ)
        if name in targets:
            R = align(rest, np.array(targets[name], float))
        else:
            R = Rp
        T[name] = (R, J[h], hp)
    return T


def skin(P, N, Wt, bones, T):
    out = np.zeros_like(P)
    nout = np.zeros_like(N)
    for k, (name, *_r) in enumerate(bones):
        w = Wt[:, k][:, None]
        if not w.any():
            continue
        R, j0, j1 = T[name]
        out += w * ((P - j0) @ R.T + j1)
        nout += w * (N @ R.T)
    nout /= np.linalg.norm(nout, axis=1, keepdims=True) + 1e-12
    return out, nout


def arm_targets(side, upper, fore):
    sg = 1 if side == 'l' else -1
    return {
        'upper_arm_' + side: [sg * upper[0], upper[1], upper[2]],
        'forearm_' + side: [sg * fore[0], fore[1], fore[2]],
        'hand_' + side: [sg * fore[0], fore[1] - 0.15, fore[2]],
    }


def leg_targets(side, thigh, shin):
    sg = 1 if side == 'l' else -1
    return {
        'thigh_' + side: [sg * thigh[0], thigh[1], thigh[2]],
        'shin_' + side: [sg * shin[0], shin[1], shin[2]],
    }


POSES = {
    # at the controls: thighs forward, shins down to the floor, hands forward at chest height
    'seated': {
        'chest': [0, 1, 0.08],
        **arm_targets('l', (0.22, -0.8, 0.55), (-0.05, 0.05, 1)),
        **arm_targets('r', (0.22, -0.8, 0.55), (-0.05, 0.05, 1)),
        **leg_targets('l', (0.1, -0.08, 1), (0.02, -1, 0.12)),
        **leg_targets('r', (0.1, -0.08, 1), (0.02, -1, 0.12)),
    },
    # the loader on his feet, a round held across in front of him
    'standing': {
        'chest': [0, 1, 0.05],
        **arm_targets('l', (0.12, -0.85, 0.5), (-0.35, 0.15, 1)),
        **arm_targets('r', (0.12, -0.85, 0.5), (-0.35, 0.15, 1)),
        **leg_targets('l', (0.08, -1, 0.02), (0.04, -1, -0.02)),
        **leg_targets('r', (0.08, -1, 0.02), (0.04, -1, -0.02)),
    },
}


def build(path, name):
    P, N, UV, I, atlas = figure_mesh(path)
    J, bones, s = fit_skeleton(P)
    Wt = weights(P, J, bones, s)
    scale = HEIGHT / (P[:, 1].max() - P[:, 1].min())
    chest = (J['pelvis'] + J['chest']) / 2 + np.array([0, 0.1 * s, 0])
    poses = {}
    for pname, targets in POSES.items():
        pos, nor = skin(P, N, Wt, bones, pose(J, bones, targets))
        # game frame: +x right (the figure's left is -x), +y up, +z forward; chest at the origin
        g = (pos - chest) * scale
        g[:, 0] *= -1
        gn = nor.copy()
        gn[:, 0] *= -1
        if pname == 'seated':
            g[:, 1] += 0.06
        poses[pname] = (g, gn)
        print(name, pname, 'bounds', g.min(0).round(2), g.max(0).round(2))
    return {'P': P, 'UV': UV, 'I': I, 'atlas': atlas, 'poses': poses}


def preview(fig, outdir, name):
    """Flat-shaded previews of each pose, front and side, with the colour map."""
    atlas = np.asarray(fig['atlas']).astype(float) / 255
    AH, AW, _ = atlas.shape
    for pname, (g, gn) in fig['poses'].items():
        tiles = []
        for view in ('front', 'side'):
            W, H = 300, 420
            img = np.full((H, W, 3), 0.18)
            zb = np.full((H, W), -1e9)
            if view == 'front':
                X, Z = -g[:, 0], g[:, 2]
            else:
                X, Z = g[:, 2], g[:, 0]
            sx = 150 + X * 200
            sy = 260 - g[:, 1] * 200
            for t in fig['I']:
                x, y, z = sx[t], sy[t], Z[t]
                x0, x1 = int(max(0, x.min())), int(min(W - 1, x.max() + 1))
                y0, y1 = int(max(0, y.min())), int(min(H - 1, y.max() + 1))
                if x1 < x0 or y1 < y0:
                    continue
                d = (y[1] - y[2]) * (x[0] - x[2]) + (x[2] - x[1]) * (y[0] - y[2])
                if abs(d) < 1e-9:
                    continue
                gx, gy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
                l0 = ((y[1] - y[2]) * (gx - x[2]) + (x[2] - x[1]) * (gy - y[2])) / d
                l1 = ((y[2] - y[0]) * (gx - x[2]) + (x[0] - x[2]) * (gy - y[2])) / d
                l2 = 1 - l0 - l1
                m = (l0 >= 0) & (l1 >= 0) & (l2 >= 0)
                zz = l0 * z[0] + l1 * z[1] + l2 * z[2]
                sub = zb[y0:y1 + 1, x0:x1 + 1]
                m &= zz > sub
                if not m.any():
                    continue
                sub[m] = zz[m]
                uv = fig['UV'][t]
                u = l0 * uv[0, 0] + l1 * uv[1, 0] + l2 * uv[2, 0]
                v = l0 * uv[0, 1] + l1 * uv[1, 1] + l2 * uv[2, 1]
                col = atlas[np.clip((v * AH).astype(int), 0, AH - 1), np.clip((u * AW).astype(int), 0, AW - 1)]
                nn = gn[t].mean(0)
                k = 0.55 + 0.45 * abs(nn[2] if view == 'front' else nn[0])
                img[y0:y1 + 1, x0:x1 + 1][m] = col[m] * k
            tiles.append(img)
        Image.fromarray((np.concatenate(tiles, 1) * 255).astype(np.uint8)).save(os.path.join(outdir, f'crew_{name}_{pname}.png'))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    pdir = sys.argv[sys.argv.index('--preview') + 1] if '--preview' in sys.argv else None
    if pdir:
        args = [a for a in args if a != pdir]
    uk, fr, out = args
    enc = lambda a: base64.b64encode(np.ascontiguousarray(a).tobytes()).decode()
    figures = []
    for path, name in ((uk, 'officer'), (fr, 'gunner')):
        fig = build(path, name)
        if pdir:
            preview(fig, pdir, name)
        buf = io.BytesIO()
        fig['atlas'].save(buf, 'JPEG', quality=82, optimize=True)
        figures.append({
            'name': name,
            'texture': 'data:image/jpeg;base64,' + base64.b64encode(buf.getvalue()).decode(),
            'index': enc(fig['I'].reshape(-1).astype(np.uint16)),
            'uv': enc(np.round(np.clip(fig['UV'], 0, 1) * 65535).astype(np.uint16)),
            'vertices': int(len(fig['P'])),
            'poses': {k: {'pos': enc(np.round(g * 1000).astype(np.int16)), 'nor': enc(np.round(n * 127).astype(np.int8))} for k, (g, n) in fig['poses'].items()},
        })
    data = {
        'version': 2,
        'source': 'UK Gunner Officer and FR Gunner (War Thunder Crew) by KojfDiscord, CC BY 4.0 (sketchfab.com/KojfDiscord); rigged and posed by tools/crew-glb.py',
        'figures': figures,
        'roles': {'commander': 0, 'default': 1},
    }
    json.dump(data, open(out, 'w'))
    print('wrote', out, os.path.getsize(out) // 1024, 'KB')


if __name__ == '__main__':
    main()
