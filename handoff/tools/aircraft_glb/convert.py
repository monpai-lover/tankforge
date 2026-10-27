#!/usr/bin/env python3
"""The user's own aircraft remakes used directly (user decision 2026-10-22/23: MiG-29, Hunter F.4, F-104G,
Me 262, F-86F-25, MiG-15bis) -> data.line key "aircraftModels"[TYPE].

    python3 -I convert.py TYPE PACKAGE_DIR DATA_LINE [--preview DIR]

TYPE is the game's aircraft id; PACKAGE_DIR the unpacked package (aircraft_types.py names the files in it). Each
package is read as data only (its build scripts are never run). Written for the game:

- the aircraft frame: X mirrored (the packages' +X is the port side; the game's +X starboard), the origin
  moved to the type's centre of gravity (aircraft_types.py: the shift and how it was chosen), metres;
- the parts by what the game does with them: "body" (the airframe), "wing_l" / "wing_r" (outboard of the
  wing roots: shot away with the wing), "glass", "cockpit" (seen from the pilot's seat), "internal" (the
  package's internal modules: the X-ray and the damage parts), and the moving parts (control surfaces,
  landing gear and doors, the cockpit's stick and pedals), each tied to a mover;
- movers: what drives each (roll, pitch, yaw, flaps, airbrake, gear) and its pose at sampled values (a
  rotation and where its pivot goes), from the package's own animation clips or hinge data, else a hinge
  measured on the part;
- one RGBA colour atlas (WebP) of the parts' colour maps (markings keep their alpha), the matching
  normal-map atlas; untextured parts sample a white cell and keep their colour;
- positions int16 at 1/3000 m, normals int8, texture coordinates uint16, indices uint16 (parts split at
  65,536 vertices); one zlib blob (base64);
- "spec": what the game's type takes from the model (wing, tail, fin, canopy, gear, nozzles, guns, the
  damage parts' boxes), measured on these triangles (measure.py), so the hitbox, damage model, gear contact
  and effects agree with what is drawn.

data.line is written through a checked temporary file (exactly one JSON).
"""
import base64, hashlib, io, json, math, os, re, shutil, site, subprocess, sys, tempfile, zlib

sys.path.append(site.getusersitepackages())  # numpy, Pillow (run with python3 -I)
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from gltf import Gltf, quat_matrix  # noqa: E402
import measure  # noqa: E402

from PIL import Image  # noqa: E402

POS_SCALE = 3000  # int16 units per metre (+-10.9 m)
S = np.diag([-1.0, 1.0, 1.0])  # the mirror between the packages' frame and the game's


def load_types():
    import importlib.util
    spec = importlib.util.spec_from_file_location('aircraft_types', os.path.join(HERE, 'aircraft_types.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m.TYPES


# ---------------------------------------------------------------- frames

def to_game_points(P, cg):
    return (np.asarray(P, float) - cg) @ S


def to_game_dirs(N):
    return np.asarray(N, float) @ S


def mat_quat(R):
    """Unit quaternion (x, y, z, w) of a rotation matrix."""
    t = np.trace(R)
    if t > 0:
        s = math.sqrt(t + 1) * 2
        q = [(R[2, 1] - R[1, 2]) / s, (R[0, 2] - R[2, 0]) / s, (R[1, 0] - R[0, 1]) / s, 0.25 * s]
    else:
        i = int(np.argmax(np.diag(R)))
        j, k = (i + 1) % 3, (i + 2) % 3
        s = math.sqrt(1 + R[i, i] - R[j, j] - R[k, k]) * 2
        q = [0, 0, 0, (R[k, j] - R[j, k]) / s]
        q[i] = 0.25 * s
        q[j] = (R[j, i] + R[i, j]) / s
        q[k] = (R[k, i] + R[i, k]) / s
    q = np.array(q)
    return q / np.linalg.norm(q)


def axis_angle(axis, ang):
    a = np.asarray(axis, float)
    a = a / np.linalg.norm(a)
    x, y, z = a * math.sin(ang / 2)
    return quat_matrix((x, y, z, math.cos(ang / 2)))


def game_delta(D, cg):
    """A model-frame rigid motion D (4x4: x' = R x + d) as the same motion in the game frame: (R_g, d_g)."""
    R, d = D[:3, :3], D[:3, 3]
    Rg = S @ R @ S
    dg = S @ (R @ cg + d - cg)
    return Rg, dg


# ---------------------------------------------------------------- parts

class Part:
    __slots__ = ('name', 'group', 'P', 'N', 'UV', 'I', 'mat', 'src', 'mover', 'module', 'colour', 'alpha', 'rough', 'metal', 'tex', 'ntex', 'cell')

    def __init__(self, **k):
        for s in self.__slots__:
            setattr(self, s, k.get(s))


_MR_MEANS = {}
# the gunsights' combining glasses and HUD glasses by name (the game's AIR_SIGHT_GLASS, and the glass words)
SIGHT_GLASS = re.compile(r'A4Reflector|SightGlass|Reflector_Glass|sight_combiner|^hud__|GLASS_HUD|cristal_hud|combiner|reflector|hud_?glass|glass_?hud', re.I)


def material_of(g, mi):
    if mi is None:
        return {'name': None, 'colour': [0.8, 0.8, 0.8], 'alpha': 1.0, 'blend': False, 'mask': False, 'tex': None, 'ntex': None, 'rough': 0.6, 'metal': 0.1, 'unlit': False}
    m = g.j['materials'][mi]
    pb = m.get('pbrMetallicRoughness', {})
    f = pb.get('baseColorFactor', [1, 1, 1, 1])
    tex = pb.get('baseColorTexture', {}).get('index')
    ntex = (m.get('normalTexture') or {}).get('index')
    # the metal-roughness texture's means (G roughness, B metalness) scale the factors: a material that
    # gives only the texture would otherwise take glTF's defaults (fully metal, fully rough: drawn dark)
    mr = (pb.get('metallicRoughnessTexture') or {}).get('index')
    mr_mean = _MR_MEANS.get((id(g), mr)) if mr is not None else (1.0, 1.0)
    if mr_mean is None:
        from PIL import Image
        a = np.asarray(Image.open(io.BytesIO(g.image_bytes(g.texture_image(mr)))).convert('RGB').resize((128, 128)), float) / 255
        mr_mean = _MR_MEANS[(id(g), mr)] = (float(a[..., 1].mean()), float(a[..., 2].mean()))
    return {'name': m.get('name'), 'colour': list(f[:3]), 'alpha': f[3], 'blend': m.get('alphaMode') == 'BLEND', 'mask': m.get('alphaMode') == 'MASK',
            'tex': None if tex is None else g.texture_image(tex), 'ntex': None if ntex is None else g.texture_image(ntex),
            'rough': pb.get('roughnessFactor', 1.0) * mr_mean[0], 'metal': pb.get('metallicFactor', 1.0) * mr_mean[1], 'unlit': 'KHR_materials_unlit' in (m.get('extensions') or {})}


def gather(g, cfg, cg, srcname, classify, movers, W):
    """Every mesh node of g (world pose W) classified by `classify` into game parts."""
    parts = []
    for i in g.mesh_nodes():
        info = classify(g, i)
        if not info:
            continue
        group, mover, module = info if isinstance(info, tuple) else (info, None, None)
        for pr in g.primitives(i, W[i]):
            mat = material_of(g, pr['material'])
            # (user report: some gunsights' glass was opaque) a sight's combiner, a HUD glass or a see-through
            # material modelled in the cockpit or the airframe is drawn as glass
            grp = group
            col = mat['colour']
            clear = mat['blend'] and mat['alpha'] < 0.7 and mat['tex'] is None and (group == 'cockpit' or (max(col) < 0.85 and max(col) - min(col) <= 0.45 * max(max(col), 1e-6)))
            # (outside the cockpit only the dark or tinted ones: a translucent coloured marking stays paint)
            if group in ('cockpit', 'body', 'control') and (SIGHT_GLASS.search(g.nodes[i].get('name', '')) or SIGHT_GLASS.search(mat['name'] or '') or clear):
                grp = 'glass'
                if mat['alpha'] >= 0.7:
                    mat = {**mat, 'alpha': 0.18}
            P = to_game_points(pr['P'], cg)
            N = to_game_dirs(pr['N'])
            I = pr['I'][:, [0, 2, 1]]  # the mirror turns the winding
            parts.append(Part(name=g.nodes[i].get('name', str(i)), group=grp, P=P, N=N, UV=pr['UV'], I=I, mat=mat, src=(srcname, g), mover=mover, module=module))
    return parts


# ---------------------------------------------------------------- simplification

def simplify(parts, budgets, work):
    """Parts of a group over its triangle budget simplified together (meshoptimizer, its vertex subset kept)."""
    node = shutil.which('node')
    nm = os.path.join(os.environ.get('TF_NODE_TOOLS', ''), 'node_modules')
    for group, budget in budgets.items():
        sel = [p for p in parts if p.group == group and len(p.I) > 300]
        total = sum(len(p.I) for p in parts if p.group == group)
        if total <= budget or not sel:
            continue
        ratio = max(0.05, budget / total)
        jobs = os.path.join(work, 'simplify_' + group)
        os.makedirs(jobs, exist_ok=True)
        for k, p in enumerate(sel):
            # weld coincident positions first (seams split by UV stay split: LockBorder keeps them)
            P32 = p.P.astype(np.float32)
            open(os.path.join(jobs, f'{k}.pos'), 'wb').write(P32.tobytes())
            open(os.path.join(jobs, f'{k}.idx'), 'wb').write(p.I.astype(np.uint32).tobytes())
            # the cockpit (seen only from the seat, never part of the hitbox) may lose its pieces' borders
            json.dump({'positions': os.path.join(jobs, f'{k}.pos'), 'indices': os.path.join(jobs, f'{k}.idx'), 'target': max(64, len(p.I) * ratio),
                       'error': 0.05 if group == 'cockpit' else 0.02, 'flags': [] if group == 'cockpit' else ['LockBorder'], 'out': os.path.join(jobs, f'{k}.out')},
                      open(os.path.join(jobs, f'{k}.json'), 'w'))
        subprocess.run([node, os.path.join(HERE, 'simplify.mjs'), jobs], check=True, env={**os.environ, 'NODE_PATH': nm}, stdout=subprocess.DEVNULL)
        for k, p in enumerate(sel):
            p.I = np.frombuffer(open(os.path.join(jobs, f'{k}.out'), 'rb').read(), np.uint32).astype(np.int64).reshape(-1, 3)
        after = sum(len(p.I) for p in parts if p.group == group)
        print(f'  simplified {group}: {total} -> {after} triangles (budget {budget})')


# ---------------------------------------------------------------- atlas

def mean_colour(img):
    c = img.convert('RGB').resize((1, 1), Image.BOX).getpixel((0, 0))
    return [(v / 255) ** 2.2 for v in c]


def build_atlas(parts, size=2048, white=48, pad=4):
    """One colour atlas and one normal atlas for the parts' textures; each textured part gets its cell.
    A part whose texture coordinates leave 0..1 (a tiled map) keeps the map's mean colour instead."""
    images = {}
    for p in parts:
        m = p.mat
        p.colour, p.alpha = list(m['colour']), m['alpha']
        p.rough, p.metal = float(m['rough']), float(m['metal'])
        p.cell = None
        if m['tex'] is None or p.UV is None or p.group == 'glass':
            continue
        # coordinates within one whole tile (some exports put them in -1..0) moved into 0..1; a map tiled
        # across several keeps its mean colour
        # (a few thousandths outside 0..1 at a seam is no other tile: user report, the F-86's skin was lost)
        k = np.floor(p.UV.min(axis=0) + 0.02)
        uv = p.UV - k
        if uv.min() < -0.02 or uv.max() > 1.02:
            src = p.src[1]
            col = mean_colour(Image.open(io.BytesIO(src.image_bytes(m['tex']))))
            p.colour = [p.colour[k] * col[k] for k in range(3)]
            continue
        key = (p.src[0], m['tex'])
        if key not in images:
            src = p.src[1]
            img = Image.open(io.BytesIO(src.image_bytes(m['tex']))).convert('RGBA')
            nimg = None
            if m['ntex'] is not None:
                try:
                    nimg = Image.open(io.BytesIO(src.image_bytes(m['ntex']))).convert('RGB')
                except Exception:
                    nimg = None
            images[key] = {'img': img, 'nimg': nimg, 'uses': 0}
        # the model's surface this map covers, and the share of the map it uses (texel density)
        T = p.P[p.I]
        area = float(np.linalg.norm(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), axis=1).sum() / 2)
        U = uv[p.I]
        uva = float(np.abs((U[:, 1, 0] - U[:, 0, 0]) * (U[:, 2, 1] - U[:, 0, 1]) - (U[:, 2, 0] - U[:, 0, 0]) * (U[:, 1, 1] - U[:, 0, 1])).sum() / 2)
        images[key]['uses'] += len(p.I)
        # the cockpit is seen from half a metre: four times the area (twice the texels per metre)
        images[key]['area'] = images[key].get('area', 0.0) + area * (4.0 if p.group == 'cockpit' else 1.0)
        images[key]['uva'] = images[key].get('uva', 0.0) + uva
        p.UV = uv
        p.tex = key
    # cell sizes: each map at the same texel density on the model (its covered surface over the share of
    # the map it uses), never above its own size; scaled together until the shelves fit
    want = {}
    for k, im in images.items():
        w, h = im['img'].size
        used = max(0.05, min(1.0, im.get('uva', 1.0)))
        world = max(1e-4, im.get('area', 1.0) / used)  # m^2 the whole map would cover
        want[k] = (w, h, math.sqrt(world))
    total = sum(math.sqrt(world_side ** 2) ** 2 for _, _, world_side in want.values())
    density = math.sqrt(1.1 * size * size / max(1e-6, total))  # texels per metre (scaled down below until the cells fit)
    keys = sorted(images, key=lambda k: -images[k]['img'].size[1])
    scale = 1.0
    while True:
        cells, x, y, row = {}, white + pad, 0, 0
        ok = True
        for k in sorted(images, key=lambda k: -min(want[k][1], want[k][2] * density * scale * want[k][1] / max(want[k][0], want[k][1]))):
            w0, h0, side = want[k]
            f = min(1.0, side * density * scale / max(w0, h0))
            w, h = max(16, int(w0 * f)), max(16, int(h0 * f))
            if x + w + pad > size:
                x, y, row = 0, y + row + pad, 0
            if y + h + pad > size:
                ok = False
                break
            cells[k] = (x, y, w, h)
            x += w + pad
            row = max(row, h)
        if ok:
            break
        scale *= 0.92
    col = Image.new('RGBA', (size, size), (128, 128, 128, 255))
    nor = Image.new('RGB', (size, size), (128, 128, 255))
    col.paste((255, 255, 255, 255), (0, 0, white, white))
    for k, (x0, y0, w, h) in cells.items():
        im = images[k]['img'].resize((w, h), Image.LANCZOS)
        # the cell's edge pixels carried into the gutter (no bleed of the neighbours under filtering)
        big = im.resize((w + 2 * pad, h + 2 * pad), Image.NEAREST)
        big.paste(im, (pad, pad))
        col.paste(big, (x0 - pad if x0 >= pad else 0, y0 - pad if y0 >= pad else 0))
        col.paste(im, (x0, y0))
        if images[k]['nimg'] is not None:
            nor.paste(images[k]['nimg'].resize((w, h), Image.LANCZOS), (x0, y0))
    for p in parts:
        if p.tex is not None:
            p.cell = cells[p.tex]
    print(f'  atlas {size}: {len(cells)} images, {density * scale:.0f} texels per metre (cells {sum(c[2] * c[3] for c in cells.values()) / size / size:.0%} of the atlas)')
    return col, nor, white


def atlas_uv(p, size, white):
    if p.cell is None:
        c = (white / 2) / size
        return np.full((len(p.P), 2), c)
    x0, y0, w, h = p.cell
    uv = np.clip(p.UV, 0, 1)
    return np.stack([(x0 + uv[:, 0] * w) / size, (y0 + uv[:, 1] * h) / size], axis=1)


# ---------------------------------------------------------------- movers

def mover_from_clips(g, node_ids, cg, samples):
    """A mover's poses from the package's clips: samples [(value, clip, time)] -> [(value, q, pivot after)]
    with the pivot the (first) node's rest origin, all in the game frame."""
    W0 = g.world()
    i0 = node_ids[0]
    piv_m = W0[i0][:3, 3]
    piv = to_game_points(piv_m[None, :], cg)[0]
    poses = {}
    for nid in node_ids:
        poses[nid] = []
    for value, clip, t in samples:
        chans = g.channels(clip) if clip else None
        W = g.world(chans, t) if clip else W0
        for nid in node_ids:
            D = W[nid] @ np.linalg.inv(W0[nid])
            Rg, dg = game_delta(D, cg)
            poses[nid].append((value, mat_quat(Rg), Rg @ piv + dg))
    return piv, poses


def hinge_poses(piv, axis, values_angles):
    """A hinge's poses: [(value, angle rad)] about `axis` through `piv` (game frame)."""
    out = []
    for v, a in values_angles:
        R = axis_angle(axis, a)
        out.append((v, mat_quat(R), np.asarray(piv, float)))  # a hinge's pivot stays where it is
    return out


# ---------------------------------------------------------------- encoding

def encode(parts, movers, size, white, POS=POS_SCALE):
    blob = bytearray()

    def pad():
        while len(blob) % 4:
            blob.append(0)
    recs = []
    for p in parts:
        used = np.unique(p.I)
        if len(used) == 0:
            continue
        ren = np.full(len(p.P), -1, np.int64)
        ren[used] = np.arange(len(used))
        P, N = p.P[used], p.N[used]
        UV = atlas_uv(p, size, white)[used]
        I = ren[p.I]
        # split at 65,536 vertices (uint16 indices)
        chunks = [I] if len(used) < 65536 else np.array_split(I, int(math.ceil(len(used) / 60000.0)) + 1)
        for ci, Ic in enumerate(chunks):
            u2 = np.unique(Ic)
            r2 = np.full(len(P), -1, np.int64)
            r2[u2] = np.arange(len(u2))
            Pc, Nc, UVc, Ic2 = P[u2], N[u2], UV[u2], r2[Ic]
            assert len(u2) < 65536
            q = np.round(Pc * POS)
            assert np.abs(q).max() < 32767, (p.name, np.abs(Pc).max())
            l = np.linalg.norm(Nc, axis=1, keepdims=True)
            Nn = Nc / np.where(l > 0, l, 1)
            rec = {'name': p.name + ('' if len(chunks) == 1 else f'#{ci}'), 'group': p.group, 'textured': p.cell is not None,
                   'colour': [round(float(c), 4) for c in p.colour], 'rough': round(min(1, max(0.05, p.rough)), 3), 'metal': round(min(1, max(0, p.metal)), 3),
                   'vertices': int(len(u2)), 'triangles': int(len(Ic2))}
            if p.group == 'glass':
                # (user report: some glass was opaque; a blended material's factor of 1 left its alpha to the
                # texture, which the glass shader does not read) see-through at most 35% opaque
                rec['opacity'] = round(float(min(p.alpha, 0.35)), 3)
            if p.mat.get('blend') or p.mat.get('mask'):
                rec['alphaTest'] = True
            if p.mover is not None:
                rec['mover'] = p.mover
            if p.module:
                rec['module'] = p.module
            rec['pos'] = len(blob)
            blob += q.astype('<i2').tobytes()
            pad()
            rec['nor'] = len(blob)
            blob += np.clip(np.round(Nn * 127), -127, 127).astype('<i1').tobytes()
            pad()
            rec['uv'] = len(blob)
            blob += np.clip(np.round(UVc * 65535), 0, 65535).astype('<u2').tobytes()
            rec['idx'] = len(blob)
            blob += Ic2.astype('<u2').tobytes()
            pad()
            recs.append(rec)
    return recs, bytes(blob)


def write_data_line(data_line, type_id, model):
    # The page contains hundreds of MB of unrelated tank data. Decode only the aircraft dictionary;
    # otherwise several full Unicode copies plus validation can exhaust an 8 GB authoring host.
    with open(data_line, 'rb') as source:
        raw = source.read()
    marker = b'"aircraftModels":'
    begin = raw.index(marker) + len(marker)
    while raw[begin] in b' \r\n\t':
        begin += 1
    depth, quoted, escaped = 0, False, False
    for end in range(begin, len(raw)):
        c = raw[end]
        if quoted:
            if escaped: escaped = False
            elif c == 92: escaped = True
            elif c == 34: quoted = False
        elif c == 34: quoted = True
        elif c in (123, 91): depth += 1
        elif c in (125, 93):
            depth -= 1
            if not depth:
                end += 1
                break
    else:
        raise ValueError('Unterminated aircraftModels data')
    models = json.loads(raw[begin:end])
    if type_id is None:
        models.update(model)
    else:
        models[type_id] = model
    encoded = json.dumps(models, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
    json.loads(encoded)  # Validate the replaced dictionary; all other bytes are preserved verbatim.
    tmp = data_line + '.tmp'
    with open(tmp, 'wb') as f:
        f.write(memoryview(raw)[:begin])
        f.write(encoded)
        f.write(memoryview(raw)[end:])
    os.replace(tmp, data_line)


# ---------------------------------------------------------------- main

def main(type_id, pkg, data_line, preview=None):
    T = load_types()[type_id]
    work = tempfile.mkdtemp(prefix='aircraft_' + type_id + '_')
    parts, movers = [], []
    sources = {}
    for name, rel in T['files'].items():
        sources[name] = Gltf(os.path.join(pkg, rel))
    # the centre of gravity: given, or worked out on the model (types: cg(sources) -> (cg, why))
    if callable(T['cg']):
        cg_val, T['cg_why'] = T['cg'](sources)
    else:
        cg_val = T['cg']
    cg = np.asarray(cg_val, float)
    print(f'  centre of gravity (package frame) {np.round(cg, 3).tolist()}: {T["cg_why"][:160]}')
    ctx = {'type': T, 'cg': cg, 'sources': sources, 'movers': movers, 'parts': parts, 'np': np, 'mover_from_clips': mover_from_clips, 'hinge_poses': hinge_poses,
           'to_game_points': to_game_points, 'to_game_dirs': to_game_dirs, 'measure': measure, 'meta': {}}
    # the package's own documents the type reads (hinge data, module lists)
    for key, (rel, field) in T.get('meta_files', {}).items():
        doc = json.load(open(os.path.join(pkg, rel), encoding='utf-8'))
        ctx['meta'][key] = doc[field] if field else doc
    # the pilot's eye from the package's cockpit camera node
    if T.get('eye_camera'):
        g = sources['main']
        i = next(k for k, n in enumerate(g.nodes) if n.get('name') == T['eye_camera'])
        ctx['camera_eye'] = to_game_points(g.world()[i][:3, 3][None, :], cg)[0]
    T['build'](ctx, gather)
    import alignment
    alignment.prepare(parts, ctx, type_id)
    if ctx.get('senses'):
        print('  clip senses (1: the clip runs the game\'s way):', ctx['senses'])
    # nested movers (a node driven inside another's subtree: the stick's pitch inside its roll): the child
    # turns with its parent; then the source nodes are dropped
    for m in movers:
        n = m.get('node')
        src = sources['main']
        if n is None:
            continue
        anc = src.ancestors(n)
        par = [j for j, q in enumerate(movers) if q is not m and q.get('node') in anc]
        if par:
            m['parent'] = min(par, key=lambda j: anc.index(movers[j]['node']))
    for m in movers:
        m.pop('node', None)
    measured_parts = [p for p in parts if p.name not in T.get('measure_exclude', ())]
    spec = measure.spec_patch(T, measured_parts, movers, ctx)
    alignment.calibrate_optics(spec, parts, ctx, type_id)
    # the cockpit at full detail for the cockpit view (types with 'cockpit_hi': its atlas size): its fixed
    # parts copied before the simplification, drawn from their own atlas only from the seat
    hi = [Part(**{a: getattr(p, a) for a in Part.__slots__}) for p in parts if p.group == 'cockpit' and p.mover is None] if T.get('cockpit_hi') else []
    simplify(parts, T.get('budgets', {}), work)
    col, nor, white = build_atlas(parts, T.get('atlas', 2048))
    # int16 positions: 3000 a metre (+-10.9 m), fewer for an aircraft reaching further from its centre of gravity
    reach = max(float(np.abs(p.P[np.unique(p.I)]).max()) for p in parts if len(p.I))
    POS = min(POS_SCALE, int(32000 / reach))
    recs, blob = encode(parts, movers, col.size[0], white, POS)
    alignment.finish(spec, parts, ctx, type_id)
    cbuf, nbuf = io.BytesIO(), io.BytesIO()
    col.save(cbuf, 'WEBP', quality=86, method=6)
    nor.save(nbuf, 'WEBP', quality=88, method=6)
    if preview:
        os.makedirs(preview, exist_ok=True)
        col.save(os.path.join(preview, f'{type_id}_colour.png'))
    cockpit_hi = None
    if hi:
        hcol, hnor, hwhite = build_atlas(hi, T['cockpit_hi'])
        hrecs, hblob = encode(hi, movers, hcol.size[0], hwhite, POS)
        hb, hn = io.BytesIO(), io.BytesIO()
        hcol.save(hb, 'WEBP', quality=88, method=6)
        hnor.save(hn, 'WEBP', quality=88, method=6)
        cockpit_hi = {'texture': 'data:image/webp;base64,' + base64.b64encode(hb.getvalue()).decode(), 'normal': 'data:image/webp;base64,' + base64.b64encode(hn.getvalue()).decode(),
                      'parts': hrecs, 'blob': base64.b64encode(zlib.compress(hblob, 9)).decode()}
        print('  cockpit at full detail:', sum(r['triangles'] for r in hrecs), 'triangles, atlas', hcol.size[0], len(hb.getvalue()) // 1024, 'KB, blob', len(cockpit_hi['blob']) // 1024, 'KB')
        if preview:
            hcol.save(os.path.join(preview, f'{type_id}_cockpit_colour.png'))
    model = {'version': 2, 'type': type_id, 'posScale': 1 / POS, 'source': T['source'], 'cg_in_model': [round(float(c), 4) for c in cg], 'cg_why': T['cg_why'],
             'spec': spec, 'movers': [{k: v for k, v in m.items()} for m in movers],
             'texture': 'data:image/webp;base64,' + base64.b64encode(cbuf.getvalue()).decode(),
             'normal': 'data:image/webp;base64,' + base64.b64encode(nbuf.getvalue()).decode(),
             'parts': recs, 'blob': base64.b64encode(zlib.compress(blob, 9)).decode()}
    model['sourceHashes'] = {name: hashlib.sha256(open(g.path, 'rb').read()).hexdigest() for name, g in sources.items()}
    if cockpit_hi:
        model['cockpitHi'] = cockpit_hi
    write_data_line(data_line, type_id, model)
    groups = {}
    for r in recs:
        groups[r['group']] = groups.get(r['group'], 0) + r['triangles']
    print(type_id, len(recs), 'parts', groups, 'movers', len(movers), 'colour', len(cbuf.getvalue()) // 1024, 'KB normal', len(nbuf.getvalue()) // 1024,
          'KB blob', len(model['blob']) // 1024, 'KB')
    shutil.rmtree(work, ignore_errors=True)
    return model


if __name__ == '__main__':
    a = [x for x in sys.argv[1:] if not x.startswith('--')]
    pv = next((sys.argv[i + 1] for i, x in enumerate(sys.argv) if x == '--preview'), None)
    main(a[0], a[1], a[2], pv)
