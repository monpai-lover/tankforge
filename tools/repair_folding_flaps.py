#!/usr/bin/env python3
"""Restore source-named folding panels without replacing a vehicle or its textures.

Panel ownership is retained on measured hinges. The M46 front shovel, keeper
frame and chain are explicitly removed from the playable model; all other source
geometry is retained. Canonical source archives are recovered from the user's local viewers,
not generated replacements. Source matching happens on exact millimetre triangle
coordinates. Run this tool after ordinary vehicle authoring, then run
tools/folding_arc_probe.py to verify and save the measured firing-arc stages.
"""
import base64
import collections
import gzip
import hashlib
import json
import pathlib
import re
import sys

import numpy as np

from repair_bmp_k64 import ROOT, BASELINE, original_model, pieces, pack, imp
from gltf_util import load, scene_meshes

SOURCE_DIR = ROOT / 'tools/sources'
SOURCE_INPUTS = {
    'm46': (pathlib.Path(r'D:\WX\xwechat_files\wxid_erqsy7mtqahf22_45f0\msg\file\2026-10\AT_T_M46_130mm_Viewer.html'),
            'AT_T_M46_130mm_PhotoReplica.glb.gz'),
    'mk103': (pathlib.Path(r'D:\WX\xwechat_files\wxid_erqsy7mtqahf22_45f0\msg\file\2026-10\flak38t-v2.html'),
              'flak38t-reconstruction-v2.glb.gz'),
}


def source_file(kind):
    html, name = SOURCE_INPUTS[kind]
    path = SOURCE_DIR / name
    if not path.exists():
        text = html.read_text(encoding='utf-8')
        pattern = (r'<script[^>]+id="asset"[^>]*>(.*?)</script>' if kind == 'm46'
                   else r'bakedModelBytes\s*=\s*decodeB64\(["\']([A-Za-z0-9+/=]+)["\']\)')
        match = re.search(pattern, text, re.S)
        if not match:
            raise SystemExit('Missing source GLB payload in ' + str(html))
        binary = base64.b64decode(match.group(1).strip(), validate=True)
        if binary[:4] != b'glTF':
            raise SystemExit('Invalid source GLB')
        SOURCE_DIR.mkdir(exist_ok=True)
        path.write_bytes(gzip.compress(binary, mtime=0))
    return path, gzip.decompress(path.read_bytes())


def tri_key(t):
    return tuple(sorted(tuple(v) for v in np.round(t * 1000).astype(np.int16)))


def hull2(points):
    points = sorted(set(map(tuple, points)))
    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
    lower, upper = [], []
    for p in points:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(points):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return np.asarray(lower[:-1] + upper[:-1])


def mk103_panels(j, accessor):
    y = 1.26293004
    lower = np.array([[-1.26332, 2.03417809], [1.26332, 2.03417809],
                      [1.30104005, 1.94789], [1.30104005, -.54118], [.887, -2.1121],
                      [-.887, -2.1121], [-1.30104005, -.54118], [-1.30104005, 1.94789]])
    out = {}
    for mesh, primitive, p, n, uv, idx, names in scene_meshes(j, accessor, with_nodes=True):
        name = names[-1]
        if not name.startswith('Folding casemate armor '):
            continue
        k = int(name.rsplit(' ', 1)[1]) - 1
        a, b = lower[k], lower[(k + 1) % 8]
        h = {'a': [float(a[0]), y, float(a[1])], 'b': [float(b[0]), y, float(b[1])], 'angle': 90}
        panel = out.setdefault(name, {'hinge': h, 'triangles': {}, 'surface': []})
        for tri in p[idx]:
            panel['triangles'][tri_key(tri)] = True
            panel['source_triangle_count'] = panel.get('source_triangle_count', 0) + 1
            if np.linalg.norm(np.cross(tri[1] - tri[0], tri[2] - tri[0])) > .03:
                panel['surface'].extend(tri.tolist())
    return out


def m46_panels(j, accessor):
    out = {}
    for side, label in ((-1, 'left'), (1, 'right')):
        out[f'cab_side_{label}'] = {'hinge': {'a': [side * 1.245, 1.53, -.49], 'b': [side * 1.245, 1.53, 1.065], 'angle': -side * 90},
                                    'triangles': {}, 'surface': []}
        for kind, z0, z1, x in (('front', -1.47, -.49, 1.30), ('rear', -3.34, -1.49, 1.315)):
            out[f'bed_{kind}_{label}'] = {'hinge': {'a': [side * x, 1.58, z0], 'b': [side * x, 1.58, z1], 'angle': -side * 90},
                                        'triangles': {}, 'surface': []}
    for mesh, primitive, pos, n, uv, idx, names in scene_meshes(j, accessor, with_nodes=True):
        cab = 'Cab_Cut_Down' in names
        if not cab and 'Rear_Bed' not in names:
            continue
        pos = pos[:, [2, 1, 0]]
        labels = imp.components(pos, idx)
        for c in np.unique(labels):
            sel = labels == c
            points = pos[np.unique(idx[sel])]
            lo, hi = points.min(0), points.max(0)
            mid = (lo + hi) / 2
            # Cab walls include their edge frame, top strip and attached latches.
            # Steps, seats, floor, fixed lower hinges, Hood and narrow Gun_Shield
            # retain their original mounts. All selected source triangles survive.
            painted_cab_cap = cab and names[-1].startswith('Cab_Cut_Down__Paint_')
            if abs(mid[0]) < (1.20 if cab else 1.27) or hi[0] - lo[0] > .18 or (hi[1] <= 1.60 and not painted_cab_cap):
                continue
            kind = 'front' if mid[2] > -1.48 else 'rear'
            label = 'left' if mid[0] < 0 else 'right'
            panel = out[f'cab_side_{label}' if cab else f'bed_{kind}_{label}']
            for tri in pos[idx[sel]]:
                panel['triangles'][tri_key(tri)] = True
                panel['source_triangle_count'] = panel.get('source_triangle_count', 0) + 1
                if np.linalg.norm(np.cross(tri[1] - tri[0], tri[2] - tri[0])) > .05:
                    panel['surface'].extend(tri.tolist())
    return out


def panel_plate(name, panel, thickness):
    points = np.asarray(panel['surface'])
    a, b = (np.asarray(panel['hinge'][k]) for k in ('a', 'b'))
    u = b - a
    u /= np.linalg.norm(u)
    # Source panel faces form one plane. The hinge line and the upper face give
    # its exact normal; use the rectangular plate contract around that surface.
    top = points[np.argmax(points[:, 1])]
    normal = np.cross(u, top - a)
    normal /= np.linalg.norm(normal)
    if np.dot(normal, top - np.array([0, top[1], 0])) < 0:
        normal *= -1
    v = np.cross(normal, u)
    q = np.column_stack((points @ u, points @ v))
    lo, hi = q.min(0), q.max(0)
    center = (lo[0] + hi[0]) / 2 * u + (lo[1] + hi[1]) / 2 * v + np.mean(points @ normal) * normal
    vec = lambda p: dict(zip('xyz', np.round(p, 5).tolist()))
    zone = 'hull_side' if abs(normal[0]) >= .5 else 'hull_rear' if normal[2] < -.5 else 'other'
    return {'id': 'folding_' + name.replace(' ', '_').lower(), 'zone': zone, 'material': 'rha',
            'thickness_mm': thickness, 'center': vec(center), 'normal': vec(normal), 'axis_u': vec(u),
            'half_u': float((hi[0] - lo[0]) / 2), 'half_v': max(.01, float((hi[1] - lo[1]) / 2)),
            'hinge': panel['hinge']}


def split_model(old, panels):
    lookup = {key: name for name, p in panels.items() for key in p['triangles']}
    records, found = [], collections.Counter()
    for p, pos, nor, uv, idx in pieces(old):
        if p['mount'] != 'hull':
            records.append((p, pos, nor, uv, idx))
            continue
        group = np.array([lookup.get(tri_key(tri), '') for tri in pos[idx]], dtype=object)
        for name in sorted(set(group)):
            selected = idx[group == name]
            used, remap = np.unique(selected, return_inverse=True)
            meta = dict(p)
            if name:
                meta.update(hinge=panels[name]['hinge'], source_node=name)
                found[name] += len(selected)
            records.append((meta, pos[used], nor[used], uv[used], remap.reshape(-1, 3)))
    for name, panel in panels.items():
        expected = panel['source_triangle_count']
        if found[name] != expected:
            raise SystemExit(f'{name}: only {found[name]}/{expected} source triangles match; refusing guessed geometry')
    return pack(old, records, old['textures']), found


def remove_front_tool(model, j, accessor):
    source = set()
    groups = {'front_frame_chain': 0, 'hood_shovel': 0}
    for mesh, primitive, pos, n, uv, idx, names in scene_meshes(j, accessor, with_nodes=True):
        if 'Exterior_Details' not in names:
            continue
        pos = pos[:, [2, 1, 0]]
        labels = imp.components(pos, idx)
        for label in np.unique(labels):
            tri = idx[labels == label]
            p = pos[np.unique(tri)]
            lo, hi = p.min(0), p.max(0)
            group = None
            if lo[2] > 3.2 and hi[2] < 3.4 and max(abs(lo[0]), abs(hi[0])) < .4 and lo[1] > 1.3:
                group = 'front_frame_chain'
            # This is the actual horizontal shovel: wooden handle, steel blade
            # and two narrow keepers on top of the hood, distinct from the rack.
            elif lo[2] > .70 and hi[2] < 1.1 and lo[1] > 2.65 and hi[1] < 2.80 and max(abs(lo[0]), abs(hi[0])) < .95:
                group = 'hood_shovel'
            if group:
                source.update(tri_key(t) for t in pos[tri])
                groups[group] += len(tri)
    if groups != {'front_frame_chain': 2636, 'hood_shovel': 332}:
        raise SystemExit(f'front tools: unexpected identified source triangles {groups}')
    expected = sum(groups.values())
    records, found = [], 0
    for meta, pos, nor, uv, idx in pieces(model):
        selected = np.array([tri_key(t) in source for t in pos[idx]]) if meta['mount'] == 'hull' and not meta.get('hinge') else np.zeros(len(idx), bool)
        found += int(selected.sum())
        triangles = idx[~selected]
        if not len(triangles):
            continue
        used, remap = np.unique(triangles, return_inverse=True)
        records.append((dict(meta), pos[used], nor[used], uv[used], remap.reshape(-1, 3)))
    if found != expected:
        raise SystemExit(f'front tool: {found}/{expected} original triangles found')
    return pack(model, records, model['textures']), {'removed_triangles': found, 'groups': groups,
        'original_source_group': 'Exterior_Details hood shovel/blade/two keepers, front frame and chain',
        'action': 'Removed entirely from the playable model, including the former side rack; original source GLB retained'}


def dump(path, value):
    path.write_bytes((json.dumps(value, indent=1, ensure_ascii=False) + '\n').encode('utf-8'))


def main(ids=None):
    import tempfile
    selected_ids = set(ids or ['su_att_m46', 'de_hetzer_mk103', 'de_hetzer_mk103_camo'])
    if not selected_ids <= {'su_att_m46', 'de_hetzer_mk103', 'de_hetzer_mk103_camo'}:
        raise SystemExit('Only the three source-backed folding vehicles are supported')
    for kind, ids in (('m46', ['su_att_m46']), ('mk103', ['de_hetzer_mk103', 'de_hetzer_mk103_camo'])):
        ids = [vid for vid in ids if vid in selected_ids]
        if not ids:
            continue
        archive, binary = source_file(kind)
        with tempfile.TemporaryDirectory(prefix='folding-source-') as task_tmp:
            source = pathlib.Path(task_tmp) / 'source.glb'
            source.write_bytes(binary)
            j, accessor, image = load(source)
            panels = m46_panels(j, accessor) if kind == 'm46' else mk103_panels(j, accessor)
            tool_source = (j, accessor) if kind == 'm46' else None
        for vid in ids:
            vdir = ROOT / 'data/vehicles' / vid
            old = original_model(vid, BASELINE)
            model, counts = split_model(old, panels)
            tool_receipt = None
            if tool_source:
                model, tool_receipt = remove_front_tool(model, *tool_source)
            model['source'] += '; original source panel geometry retained on measured folding hinges'
            if tool_receipt:
                model['source'] += '; horizontal hood shovel with both keepers, front frame and chain removed from playable geometry'
            (vdir / 'model.json').write_text(json.dumps(model, separators=(',', ':')), encoding='utf-8')
            armour = json.loads((vdir / 'armor.json').read_text())
            # Generic upper side walls would remain as invisible protection when
            # their real panels fold. Retain only their fixed lower/cab coverage.
            fixed = []
            for p in armour:
                if p.get('hinge') or p['id'].startswith('folding_'):
                    continue
                if p['id'] in ('hull_side_r', 'hull_side_l'):
                    if kind == 'mk103':
                        p = dict(p, center=dict(p['center'], y=.89), half_v=.37)
                    else:
                        p = dict(p, center=dict(p['center'], y=1.0), half_v=.53)
                if kind == 'm46' and p['id'] in ('turret_side_r', 'turret_side_l'):
                    side = 1 if p['id'].endswith('_r') else -1
                    p = dict(p, center={'x': side * 1.09, 'y': 2.70, 'z': -.3785},
                             normal={'x': side * .9308, 'y': -.3655, 'z': 0}, half_u=.1875, half_v=.6123)
                fixed.append(p)
            armour = fixed + [panel_plate(name, p, 4 if kind == 'm46' else 20) for name, p in panels.items()]
            dump(vdir / 'armor.json', armour)
            previous_receipt = json.loads((vdir / 'folding-source.json').read_text()) if (vdir / 'folding-source.json').exists() else {}
            receipt = dict(previous_receipt, **{'baseline_revision': BASELINE, 'archive': str(archive.relative_to(ROOT)).replace('\\', '/'),
                       'glb_sha256': hashlib.sha256(binary).hexdigest(), 'glb_bytes': len(binary),
                       'source_asset': j.get('asset', {}), 'ownership': 'User-supplied source; existing permission, no new licence inferred',
                       'panel_triangles': dict(counts), 'hinges': {n: p['hinge'] for n, p in panels.items()},
                       'narrow_gun_shield': 'Retained on original traversing gun; never folded',
                       'original_triangles': sum(p['triangles'] for p in old['parts']),
                       'repaired_triangles': sum(p['triangles'] for p in model['parts']), 'armor_plates': armour})
            if tool_receipt:
                receipt.pop('front_tool_rigid_relocation', None)
                receipt.pop('storage_sweep_clearance', None)
                receipt['front_tool_removal'] = tool_receipt
            dump(vdir / 'folding-source.json', receipt)
            print(vid, counts)
    # Keep metadata and the ordinary generator route consistent with the saved
    # recipe. Only these three folders are authored; preserve unchanged bytes.
    import gen_vehicles as gen
    def dump_lf(path, value, compact_lists=True):
        pathlib.Path(path).write_bytes((json.dumps(value, indent=1, ensure_ascii=False) + '\n').encode('utf-8'))
    gen.dump = dump_lf
    for factory in (gen.att_m46, gen.hetzer_mk103, gen.hetzer_mk103_camo):
        spec = factory()
        if spec['id'] not in selected_ids:
            continue
        vdir = ROOT / 'data/vehicles' / spec['id']
        files = ['vehicle.json', 'armor.json', 'weapons.json', 'engine.json', 'crew.json', 'modules.json', 'visual.json', 'import.json']
        before = {f: (vdir / f).read_bytes() for f in files}
        errors = gen.write_vehicle(spec)
        if errors:
            raise SystemExit(f'{spec["id"]}: {errors}')
        for name, binary in before.items():
            path = vdir / name
            if json.loads(path.read_bytes()) == json.loads(binary):
                path.write_bytes(binary)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ids', help='Comma-separated source vehicle IDs; omission rebuilds the existing three')
    args = parser.parse_args()
    main(args.ids.split(',') if args.ids else None)
