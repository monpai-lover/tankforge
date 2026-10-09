#!/usr/bin/env python3
"""Turns a vehicle model (.glb) into the game's imported-model asset (model.json).

The model is cut into the pieces the game moves separately -- the hull, the traversing mount
(turret), the elevating gun, the recoiling barrel, every road wheel, the sprockets and idlers --
by the rules in the vehicle's import.json:

  glb               the model file (relative to import.json, or give it on the command line)
  source            attribution, kept in model.json
  mirror_x          glTF's +x is the model's left; the game's +x is its right
  swap_xz           the model's forward is its +x (and its right +z): x and z trade places
  rotate_180        the model faces -z: turned half round about the vertical (x and z negated)
  scale             a factor on the model's units (before mirroring and the offset)
  stagger           {"1": {"road_wheel": dz, "return_roller": [dz, ...]}}: that side's wheels lie
                    dz ahead of the game's (symmetric) stations; they are found there and moved
  material_colours  {material name: {colour: [r, g, b] (linear), rough, metal}}: a material's
                    colour and surface set here (a model whose own colours are placeholders)
  gun_index_nodes   {"1": [node, ...]}: gun and barrel pieces under these nodes are that gun's
                    (a turret with two guns)
  turret_index      which turret the turret/gun/barrel pieces belong to (0 by default)
  turret_index_nodes {"1": [node, ...]}: pieces under these nodes belong to that turret instead
  add               [{glb, only_nodes, offset, ...}]: pieces taken from other files (only those
                    under only_nodes), each with its own placement and mount rules
  level_nodes       nodes whose own rotation is dropped (a gun modelled elevated is set level)
  wheel_nodes       {"road_wheel:<side>:<index>": [node, ...]}: explicit ownership of every
                    piece of a named wheel, including disconnected tread blocks. When supplied,
                    geometric wheel guessing is disabled so fixed axle bearings stay on the hull.
  node_rest_poses   [{nodes, pivot, rotation_x_deg}]: measured rotations in the game hull frame
                    to remove a source display pose (for example, close a raised hatch).
  offset            [x, y, z] added after mirroring (the game's hull frame: ground at y = 0,
                    +z forward, the middle of the vehicle at x = z = 0)
  drop_materials    materials left out (the track belts: the game's own tracks run instead;
                    transparent glass)
  turret_meshes     meshes that traverse with the mount
  gun_meshes        meshes that elevate with the gun
  barrel_meshes     meshes whose pieces at least barrel_min_length long recoil (the tube)
  barrel_extra      meshes that recoil whole (things fixed to the tube)
  barrel_ahead_z    the gun's pieces lying wholly ahead of this z (the muzzle brake and the
                    rings on the tube) recoil with it
  textures          image index -> longest side kept (px); others are kept at 512
  normal_maps       true: the materials' normal maps go along (one per colour map)
  drop_meshes       meshes left out whole (a model's own track belts)
  turret_nodes, gun_nodes, barrel_nodes, barrel_extra_nodes, drop_nodes
                    the same by node name: every mesh under a node of that name (its own or an
                    ancestor's) goes with it
  drop_wide         {"meshes": [...], "x_extent_ge": m}: in those meshes, the pieces at least this
                    wide across the vehicle are left out (the links of a belt modelled together
                    with its brackets), the narrower ones stay
  share             {"from": vehicle id, "mounts": [...], "keep_nodes": [...]}: a variant of
                    another imported vehicle leaves out its pieces of those mounts (the hull, the
                    wheels) except those under keep_nodes, and borrows the other's when the game
                    decodes it (the same model with another weapon fit)
  A material's base colour factor is kept: an untextured material becomes a small texture of its
  colour, a textured one is tinted by it.

Road wheels, sprockets and idlers (or a wheeled vehicle's tyres on their axles) are found from
visual.json's running gear: every piece whose
middle lies on a wheel's axle (within 6 cm), outboard of the hull and no bigger than the wheel is
that wheel's, and turns with it on its spring.

Everything is stored in the hull frame: positions in millimetres (int16), normals (int8 x 3),
texture coordinates (uint16, v down from the top of the image), triangle indices (uint16 or uint32),
all in one zlib blob; colour maps as JPEG data URLs.

  python3 tools/glb-vehicle.py data/vehicles/us_m56 [model.glb] [--report]
"""
import base64
import io
import json
import os
import sys
import zlib

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltf_util import load, scene_meshes, diffuse_texture, normal_texture  # noqa: E402


def components(P, I):
    """Connected pieces of a triangle list (vertices welded by position): label per triangle."""
    q = np.round(P / 1e-4).astype(np.int64)
    _, inv = np.unique(q, axis=0, return_inverse=True)
    inv = inv.ravel()
    F = inv[I]
    n = int(inv.max()) + 1
    # Position-welded union-find avoids a SciPy runtime requirement for this
    # otherwise NumPy/Pillow-only importer. Triangle adjacency is undirected.
    parent = list(range(n))
    rank = [0] * n

    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for a, b in np.concatenate([F[:, [0, 1]], F[:, [1, 2]]]):
        a, b = root(int(a)), root(int(b))
        if a == b:
            continue
        if rank[a] < rank[b]:
            a, b = b, a
        parent[b] = a
        if rank[a] == rank[b]:
            rank[a] += 1
    return np.array([root(int(i)) for i in F[:, 0]])


def wheel_specs(visual):
    """(key, centre (game frame), radius) of every wheel of the running gear, both sides."""
    rg = visual['running_gear']
    out = []
    if rg.get('kind') == 'wheels':
        for side in (1, -1):
            for k, a in enumerate(rg['axles']):
                out.append((f'road_wheel:{side}:{k}', np.array([side * a['x'], a['y'], a['z']]), a['r']))
        return out
    for side in (1, -1):
        for k, w in enumerate(rg['wheels']):
            out.append((f'road_wheel:{side}:{k}', np.array([side * (rg['track_x'] + w.get('x', 0)), w['y'], w['z']]), w['r']))
        for role in ('sprocket', 'idler'):
            s = rg[role]
            out.append((f'{role}:{side}:0', np.array([side * (rg['track_x'] + s.get('x', 0)), s['y'], s['z']]), s['r']))
        for k, r in enumerate(rg.get('rollers', [])):
            out.append((f'return_roller:{side}:{k}', np.array([side * (rg['track_x'] + r.get('x', 0)), r['y'], r['z']]), r['r']))
    return out


def collect(si, j, acc, cfg, groups, counts, wheels, track_x, shared_mounts):
    """Cuts one model file (source si) into the game's pieces by cfg's rules, adding them to groups."""
    drop = set(cfg.get('drop_materials', []))
    turret_m = set(cfg.get('turret_meshes', []))
    gun_m = set(cfg.get('gun_meshes', []))
    barrel_m = set(cfg.get('barrel_meshes', []))
    barrel_x = set(cfg.get('barrel_extra', []))
    min_len = cfg.get('barrel_min_length', 2.0)
    offset = np.array(cfg.get('offset', [0, 0, 0]), float)
    node_sets = {k: set(cfg.get(k, [])) for k in ('turret_nodes', 'gun_nodes', 'barrel_nodes', 'barrel_extra_nodes', 'drop_nodes', 'only_nodes')}
    node_sets['keep_nodes'] = set((cfg.get('share') or {}).get('keep_nodes', []))

    def under(names, key):
        return bool(node_sets[key] & set(names))

    stagger = cfg.get('stagger') or {}

    def side_dz(wk):
        """How far a wheel of a staggered side lies ahead of the game's station for it."""
        kind, side, k = wk.split(':')
        st = stagger.get(side, {}).get(kind)
        if st is None:
            return 0.0
        return float(st[int(k)] if isinstance(st, list) else st)

    drop_meshes = set(cfg.get('drop_meshes', []))
    wide = cfg.get('drop_wide') or {}
    wide_meshes = set(wide.get('meshes', []))

    def colour_key(mat):
        """(source, image or None, base colour factor) of a material: what its texture is made from."""
        if mat is None:
            return (si, None, (0.6, 0.6, 0.6))
        m = j['materials'][mat]
        over = (cfg.get('material_colours') or {}).get(m.get('name', ''))
        f = tuple(round(float(c), 3) for c in (over['colour'] if over else m.get('pbrMetallicRoughness', {}).get('baseColorFactor', [1, 1, 1, 1])[:3]))
        return (si, diffuse_texture(j, mat), f)

    for mesh, prim, P, N, uv, I, names in scene_meshes(j, acc, with_nodes=True, level_nodes=set(cfg.get('level_nodes', []))):
        mat = prim.get('material')
        if mat in drop or mesh in drop_meshes or under(names, 'drop_nodes'):
            continue
        if cfg.get('only_nodes') and not under(names, 'only_nodes'):
            continue
        if cfg.get('scale'):
            P = P * float(cfg['scale'])
        if cfg.get('swap_xz'):
            P = P[:, [2, 1, 0]]
            N = N[:, [2, 1, 0]]
        if cfg.get('mirror_x', True):
            P = P * np.array([-1, 1, 1])
            N = N * np.array([-1, 1, 1])
        if cfg.get('rotate_180'):
            P = P * np.array([-1, 1, -1])
            N = N * np.array([-1, 1, -1])
        P = P + offset
        # Some supplied models bake a display elevation into the vertex data.
        # Restore only the named moving gun pieces around their measured hinge;
        # leave the fixed turret, hull and original source GLB untouched.
        rest_tag = ''
        rests = ([cfg['gun_rest_pose']] if cfg.get('gun_rest_pose') else []) + cfg.get('node_rest_poses', [])
        for rest in rests:
            selected = set(rest['nodes']) & set(names)
            if not selected:
                continue
            angle = np.deg2rad(float(rest['rotation_x_deg']))
            ca, sa = np.cos(angle), np.sin(angle)
            R = np.array([[1, 0, 0], [0, ca, -sa], [0, sa, ca]])
            pivot = np.asarray(rest['pivot'], float)
            P = (P - pivot) @ R.T + pivot
            N = N @ R.T
            if rest in cfg.get('node_rest_poses', []):
                rest_tag = sorted(selected)[0]
        tex = colour_key(mat)
        if tex[1] is None and 'COLOR_0' in prim['attributes']:
            # vertex colours: each triangle takes its corners' colour (sRGB, 16 levels a channel)
            # from a palette texture of 4 x 4 px cells; triangles whose corners differ get their
            # own corners with the mean colour
            C = acc(prim['attributes']['COLOR_0'])[:, :3] * np.array(tex[2])
            q = np.clip(np.round((np.clip(C, 0, 1) ** (1 / 2.2)) * 15), 0, 15).astype(np.int64)
            cid = q[:, 0] * 256 + q[:, 1] * 16 + q[:, 2]
            tri = cid[I]
            same = (tri[:, 0] == tri[:, 1]) & (tri[:, 1] == tri[:, 2])
            if not same.all():
                odd = np.where(~same)[0]
                base = len(P)
                newI = I.copy()
                tc = np.clip(np.round(((np.clip(C[I[odd]].mean(1), 0, 1)) ** (1 / 2.2)) * 15), 0, 15).astype(np.int64)
                tcid = tc[:, 0] * 256 + tc[:, 1] * 16 + tc[:, 2]
                P = np.concatenate([P, P[I[odd]].reshape(-1, 3)])
                N = np.concatenate([N, N[I[odd]].reshape(-1, 3)])
                cid = np.concatenate([cid, np.repeat(tcid, 3)])
                newI[odd] = base + np.arange(len(odd) * 3).reshape(-1, 3)
                I = newI
            uv = np.c_[((cid % 64) + 0.5) / 64, ((cid // 64) + 0.5) / 64]
            tex = (si, 'palette', (1.0, 1.0, 1.0))
        if uv is None:
            uv = np.zeros((len(P), 2))
        if tex[1] != 'palette':
            uv = np.c_[uv[:, 0] - np.floor(uv[:, 0].min()), uv[:, 1] - np.floor(uv[:, 1])]
        nrm = normal_texture(j, mat) if (mat is not None and cfg.get('normal_maps')) else None
        nrm = (si, nrm) if nrm is not None else None
        # the material's surface: roughness and metalness (glTF's defaults of 1 when left out;
        # metalness held under 0.9, the game's light has no environment map for bare metal)
        pbr = j['materials'][mat].get('pbrMetallicRoughness', {}) if mat is not None else {}
        over = (cfg.get('material_colours') or {}).get(j['materials'][mat].get('name', '')) if mat is not None else None
        if over:
            pbr = {'roughnessFactor': over.get('rough', pbr.get('roughnessFactor', 1.0)), 'metallicFactor': over.get('metal', pbr.get('metallicFactor', 1.0))}
        rm = (round(float(min(1.0, max(0.04, pbr.get('roughnessFactor', 1.0)))), 2), round(float(min(0.9, max(0.0, pbr.get('metallicFactor', 1.0)))), 2))
        lab = components(P, I)
        mount = np.empty(len(I), dtype=object)
        for c in np.unique(lab):
            sel = lab == c
            V = P[I[sel].ravel()]
            lo, hi = V.min(0), V.max(0)
            mid = (lo + hi) / 2
            if mesh in wide_meshes and hi[0] - lo[0] >= wide.get('x_extent_ge', 0.3):
                mount[sel] = None
                continue
            key = 'hull'
            if mesh in turret_m or under(names, 'turret_nodes'):
                key = 'turret'
            if mesh in gun_m or under(names, 'gun_nodes'):
                key = 'gun'
            ahead = cfg.get('barrel_ahead_z')
            if mesh in barrel_x or under(names, 'barrel_extra_nodes') or ((mesh in barrel_m or under(names, 'barrel_nodes')) and (hi[2] - lo[2] >= min_len or (ahead is not None and lo[2] > ahead))):
                key = 'barrel'
            shift = 0.0
            named_wheels = cfg.get('wheel_nodes')
            if key == 'hull' and named_wheels:
                for wk, node_names in named_wheels.items():
                    if set(node_names) & set(names):
                        key = wk
                        shift = -side_dz(wk)
                        break
            if key == 'hull' and not named_wheels and abs(mid[0]) > track_x - 0.35:
                # a wheel's: on its axle, no bigger than the wheel (on a side whose stations are
                # staggered, found where they are and moved onto the game's stations)
                for wk, wc, wr in wheels:
                    dz = side_dz(wk)
                    if np.hypot(mid[1] - wc[1], mid[2] - (wc[2] + dz)) < 0.06 and np.sign(mid[0]) == np.sign(wc[0]) and max(hi[1] - lo[1], hi[2] - lo[2]) <= 2 * wr + 0.1:
                        key = wk
                        shift = -dz
                        break
            if shift:
                P = P.copy()
                P[np.unique(I[sel].ravel()), 2] += shift
            if key.split(':')[0] in shared_mounts and not under(names, 'keep_nodes'):
                key = None
            if key is not None and cfg.get('extra') and key.split(':')[0] not in ('hull', 'turret', 'gun', 'barrel'):
                key = 'hull'
            mount[sel] = key
        for key in set(mount) - {None}:
            sel = mount == key
            tix = cfg.get('turret_index', 0)
            for t_i, t_nodes in (cfg.get('turret_index_nodes') or {}).items():
                if set(t_nodes) & set(names):
                    tix = int(t_i)
            gix = 0
            for g_i, g_nodes in (cfg.get('gun_index_nodes') or {}).items():
                if set(g_nodes) & set(names):
                    gix = int(g_i)
            g = groups.setdefault((key, tex, nrm, rm, tix, gix, rest_tag), {'P': [], 'N': [], 'UV': [], 'I': [], 'n': 0})
            T = I[sel]
            used, inv = np.unique(T.ravel(), return_inverse=True)
            g['P'].append(P[used])
            g['N'].append(N[used])
            g['UV'].append(uv[used])
            g['I'].append(inv.reshape(-1, 3) + g['n'])
            g['n'] += len(used)
            counts[key] = counts.get(key, 0) + int(sel.sum())



def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    vdir = args[0]
    cfg = json.load(open(os.path.join(vdir, 'import.json')))
    glb = args[1] if len(args) > 1 else os.path.join(vdir, cfg['glb'])
    visual = json.load(open(os.path.join(vdir, 'visual.json')))
    report = '--report' in sys.argv
    wheels = wheel_specs(visual)
    rg = visual['running_gear']
    track_x = rg['track_x'] if 'track_x' in rg else max(a['x'] for a in rg['axles'])
    share = cfg.get('share') or {}
    shared_mounts = set(share.get('mounts', []))
    groups = {}  # (mount, colour image, normal image, (rough, metal), turret) -> lists
    counts = {}
    # the main model, then any pieces taken from other files ('add': each its own glb, the
    # nodes kept from it, and its own placement and mount rules; the rest as the main model's)
    sources = [(glb, cfg)] + [(a['glb'], dict(cfg, **{k: v for k, v in a.items() if k != 'glb'}, extra=True)) for a in cfg.get('add', [])]
    loaded = []
    for si, (path, scfg) in enumerate(sources):
        j, acc, image = load(path if os.path.isabs(path) else os.path.join(vdir, path))
        loaded.append((j, image))
        collect(si, j, acc, scfg, groups, counts, wheels, track_x, shared_mounts)

    # images: the colour maps (and normal maps) that are used, made smaller
    sizes = [{int(k): v for k, v in sc.get('textures', {}).items()} for _, sc in sources]
    colour_keys = sorted({k[1] for k in groups}, key=str)
    normal_images = sorted({k[2] for k in groups if k[2] is not None})
    textures = []
    tex_index = {}

    def colour_image(ck):
        si, im, f = ck
        image = loaded[si][1]
        if im == 'palette':
            a = np.zeros((256, 256, 3), np.uint8)
            for k in range(4096):
                a[(k // 64) * 4:(k // 64) * 4 + 4, (k % 64) * 4:(k % 64) * 4 + 4] = [(k // 256) * 17, ((k // 16) % 16) * 17, (k % 16) * 17]
            return Image.fromarray(a)
        if im is None:
            # an untextured material: its colour (linear) as a small sRGB swatch
            c = tuple(int(round(255 * max(0.0, min(1.0, v)) ** (1 / 2.2))) for v in f)
            return Image.new('RGB', (8, 8), c)
        img = image(im)
        if any(abs(v - 1) > 0.01 for v in f):
            a = np.asarray(img.convert('RGB'), float) * np.array(f)
            img = Image.fromarray(np.clip(a, 0, 255).astype(np.uint8))
        return img

    for ck in colour_keys + normal_images:
        img = colour_image(ck) if len(ck) == 3 else loaded[ck[0]][1](ck[1])
        im = ck[1]
        has_alpha = img.mode in ('RGBA', 'LA', 'P')
        img = img.convert('RGB')
        side = 256 if im == 'palette' else (sizes[ck[0]].get(im, 512) if im is not None else 8)
        k = side / max(img.size)
        if k < 1:
            img = img.resize((max(4, int(img.width * k)), max(4, int(img.height * k))), Image.LANCZOS)
        buf = io.BytesIO()
        if im == 'palette':
            # exact colours in exact cells: no JPEG bleeding
            img.save(buf, 'PNG', optimize=True)
            src = 'data:image/png;base64,'
        else:
            img.save(buf, 'JPEG', quality=84, optimize=True)
            src = 'data:image/jpeg;base64,'
        tex_index[ck] = len(textures)
        textures.append({'src': src + base64.b64encode(buf.getvalue()).decode(), 'size': list(img.size), 'image': im if isinstance(im, int) else -1, 'alpha': has_alpha})

    blob = bytearray()

    def put(arr):
        o = len(blob)
        blob.extend(np.ascontiguousarray(arr).tobytes())
        while len(blob) % 4:
            blob.append(0)
        return o

    parts = []
    lo_all = np.full(3, np.inf)
    hi_all = np.full(3, -np.inf)
    for (key, tex, nrm, rm, tix, gix, rest_tag), g in sorted(groups.items(), key=lambda kv: (kv[0][0], str(kv[0][1]), kv[0][3], kv[0][4], kv[0][5], kv[0][6])):
        P = np.concatenate(g['P'])
        N = np.concatenate(g['N'])
        UV = np.concatenate(g['UV'])
        I = np.concatenate(g['I'])
        if key in ('hull', 'turret', 'gun', 'barrel'):
            lo_all = np.minimum(lo_all, P.min(0))
            hi_all = np.maximum(hi_all, P.max(0))
        idx32 = len(P) > 65535
        part = {
            'mount': key.split(':')[0],
            'texture': tex_index.get(tex, -1),
            'normal': tex_index.get(nrm, -1),
            'vertices': int(len(P)),
            'triangles': int(len(I)),
            'idx32': bool(idx32),
            'pos': put(np.round(P * 1000).astype(np.int16)),
            'nor': put(np.round(N * 127).astype(np.int8)),
            'uv': put(np.round(np.clip(UV, 0, 1) * 65535).astype(np.uint16)),
            'idx': put(I.reshape(-1).astype(np.uint32 if idx32 else np.uint16)),
            'rough': rm[0],
            'metal': rm[1],
        }
        if tix:
            part['turret'] = int(tix)
        if gix:
            part['gun'] = int(gix)
        if rest_tag:
            part['rest_pose'] = rest_tag
        if ':' in key:
            _, side, k = key.split(':')
            part['side'] = int(side)
            part['index'] = int(k)
        parts.append(part)
    out = {
        'version': 1,
        'source': cfg.get('source', ''),
        'bounds': [lo_all.round(3).tolist(), hi_all.round(3).tolist()],
        'textures': textures,
        'parts': parts,
        'blob': base64.b64encode(zlib.compress(bytes(blob), 9)).decode(),
        'blob_size': len(blob),
    }
    if share:
        out['shared'] = {'from': share['from'], 'mounts': sorted(shared_mounts)}
    path = os.path.join(vdir, cfg.get('out', 'model.json'))
    json.dump(out, open(path, 'w'), separators=(',', ':'))
    tris = {}
    for key, n in counts.items():
        tris[key.split(':')[0]] = tris.get(key.split(':')[0], 0) + n
    print('wrote', path, os.path.getsize(path) // 1024, 'KB;', 'blob', len(blob) // 1024, 'KB raw;', len(textures), 'images')
    print('triangles by mount', tris, 'bounds', out['bounds'])
    if report:
        for key in sorted(counts):
            print('  ', key, counts[key])


if __name__ == '__main__':
    main()
