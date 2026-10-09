#!/usr/bin/env python3
"""Rebuild only the three BMP-K-64 variants from preserved, attributable inputs.

python tools/repair_bmp_k64.py
python tools/repair_bmp_k64.py --source-html /path/to/BMP_K_64_ATGM.html

The HTML is read as text; no embedded script is run. Its gzip/base64 GLB supplies
the shared chassis and Konkurs mount. The original KPVT and Kornet source GLBs
are unavailable, so their existing packed geometry is recovered from the pinned
Git revision below. No replacement exterior is invented. No other fleet data is
generated. NumPy and Pillow are the same requirements as glb-vehicle.py.
"""
import argparse
import base64
import gzip
import hashlib
import importlib.util
import json
import pathlib
import re
import subprocess
import sys
import tempfile
import zlib

import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
BASELINE = 'bf197b39c4f904298e61c2599a9203f1e388adee'
sys.path.insert(0, str(ROOT / 'client/web/tools'))
sys.path.insert(0, str(ROOT / 'tools'))
import gen_vehicles as gen

spec = importlib.util.spec_from_file_location('glb_vehicle', ROOT / 'client/web/tools/glb-vehicle.py')
imp = importlib.util.module_from_spec(spec)
spec.loader.exec_module(imp)


def original_model(vid, revision):
    raw = subprocess.check_output(['git', 'show', f'{revision}:data/vehicles/{vid}/model.json'], cwd=ROOT)
    return json.loads(raw)


def pieces(model):
    blob = zlib.decompress(base64.b64decode(model['blob']))
    out = []
    for p in model['parts']:
        p = dict(p)
        def read(key, dt, width):
            return np.frombuffer(blob, dt, p['vertices'] * width, p[key]).reshape(-1, width).copy()
        pos = read('pos', np.int16, 3).astype(float) / 1000
        nor = read('nor', np.int8, 3).astype(float) / 127
        uv = read('uv', np.uint16, 2)
        idx = np.frombuffer(blob, np.uint32 if p['idx32'] else np.uint16,
                            p['triangles'] * 3, p['idx']).reshape(-1, 3).copy()
        out.append((p, pos, nor, uv, idx))
    return out


def pack(template, records, textures):
    blob, parts = bytearray(), []
    lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
    def put(a):
        off = len(blob)
        blob.extend(np.ascontiguousarray(a).tobytes())
        while len(blob) % 4:
            blob.append(0)
        return off
    for p, pos, nor, uv, idx in records:
        p = dict(p, vertices=len(pos), triangles=len(idx), idx32=len(pos) > 65535)
        p.update(pos=put(np.round(pos * 1000).astype(np.int16)),
                 nor=put(np.round(nor * 127).astype(np.int8)), uv=put(uv),
                 idx=put(idx.astype(np.uint32 if p['idx32'] else np.uint16)))
        parts.append(p)
        lo, hi = np.minimum(lo, pos.min(0)), np.maximum(hi, pos.max(0))
    return dict(template, parts=parts, textures=textures, bounds=[lo.round(3).tolist(), hi.round(3).tolist()],
                blob=base64.b64encode(zlib.compress(bytes(blob), 9)).decode(), blob_size=len(blob))


def kpvt_records(model):
    """Unpose the preserved KPVT about its source hinge; split only actual tube pieces."""
    out = []
    angle, pivot = np.deg2rad(15), np.array([-.115, 2.205, -.28])
    ca, sa = np.cos(angle), np.sin(angle)
    rot = np.array([[1, 0, 0], [0, ca, -sa], [0, sa, ca]])
    for p, pos, nor, uv, idx in pieces(model):
        if p['mount'] not in ('gun', 'turret', 'barrel'):
            continue
        if p['mount'] == 'turret':
            # The original cupola GLB is absent, but its position-welded packed
            # pieces survive: circular lid, inside pad and handle. The two fixed
            # hinge keepers bracket x +/- .15 at y 2.076, z -.815. Close about
            # that line; never rotate the complete cupola or remove the lid.
            labels = imp.components(pos, idx)
            hatch = np.zeros(len(idx), bool)
            for label in np.unique(labels):
                sel = labels == label
                points = pos[idx[sel].ravel()]
                lo, hi = points.min(0), points.max(0)
                size = hi - lo
                lid = size[0] > .5 and size[1] > .5 and hi[2] < -.72
                handle = lo[1] > 2.27 and hi[1] < 2.32 and hi[2] < -.8 and size[0] < .2
                hatch[sel] = lid or handle
            for is_hatch in (False, True):
                selected = idx[hatch == is_hatch]
                if not len(selected):
                    continue
                used, inv = np.unique(selected, return_inverse=True)
                p2, q, n = dict(p), pos[used], nor[used]
                if is_hatch:
                    a = np.deg2rad(80)
                    r = np.array([[1, 0, 0], [0, np.cos(a), -np.sin(a)], [0, np.sin(a), np.cos(a)]])
                    h = np.array([0, 2.076, -.815])
                    q, n = (q - h) @ r.T + h, n @ r.T
                    p2['rest_pose'] = 'Cupola_Hatch'
                out.append((p2, q, n, uv[used], inv.reshape(-1, 3)))
            continue
        pos, nor = (pos - pivot) @ rot.T + pivot, nor @ rot.T
        labels = imp.components(pos, idx)
        roles = np.empty(len(idx), dtype=object)
        for label in np.unique(labels):
            sel = labels == label
            points = pos[idx[sel].ravel()]
            lo, hi = points.min(0), points.max(0)
            # Same barrel_nodes/min_length/ahead rule recorded in import.json.
            roles[sel] = 'barrel' if hi[2] - lo[2] >= 1 or lo[2] > .8 else 'gun'
        for role in sorted(set(roles)):
            used, inv = np.unique(idx[roles == role], return_inverse=True)
            out.append((dict(p, mount=role), pos[used], nor[used], uv[used], inv.reshape(-1, 3)))
    return out


def import_model(vdir, config, visual, glb):
    vdir.mkdir()
    (vdir / 'import.json').write_text(json.dumps(config), encoding='utf-8')
    (vdir / 'visual.json').write_text(json.dumps(visual), encoding='utf-8')
    old = sys.argv
    try:
        sys.argv = ['glb-vehicle.py', str(vdir), str(glb)]
        imp.main()
    finally:
        sys.argv = old
    return json.loads((vdir / 'model.json').read_text())


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('--source-html', type=pathlib.Path)
    args.add_argument('--baseline-ref', default=BASELINE)
    opts = args.parse_args()
    receipt_path = ROOT / 'data/vehicles/xp_bmp_k64/repair-source.json'
    if opts.source_html:
        source = opts.source_html.read_bytes()
        match = re.search(r'<script[^>]+id=["\']model-data["\'][^>]*>(.*?)</script>', source.decode('utf-8'), re.S)
        if not match:
            raise SystemExit('No model-data payload in source HTML')
        raw = base64.b64decode(match.group(1).strip(), validate=True)
        glb = gzip.decompress(raw) if raw[:2] == b'\x1f\x8b' else raw
        origin = {'source_html': opts.source_html.name, 'source_html_sha256': hashlib.sha256(source).hexdigest()}
    else:
        previous = json.loads(receipt_path.read_text(encoding='utf-8'))
        origin = {key: previous[key] for key in ('source_html', 'source_html_sha256')}
        glb = (ROOT / 'data/vehicles/xp_bmp_k64/source/BMP_K_64_ATGM.glb').read_bytes()
        if hashlib.sha256(glb).hexdigest() != previous['recovered_glb_sha256']:
            raise SystemExit('Archived BMP source hash does not match its provenance')
    if glb[:4] != b'glTF':
        raise SystemExit('Recovered payload is not a GLB')
    base_old = original_model('xp_bmp_k64', opts.baseline_ref)
    kornet_old = original_model('xp_bmp_k64_kornet', opts.baseline_ref)
    # The generator's native text open uses CRLF on Windows. Keep these targeted
    # outputs byte-stable, and preserve original bytes for unchanged data files.
    def dump_lf(path, value, compact_lists=True):
        pathlib.Path(path).write_bytes((json.dumps(value, indent=1, ensure_ascii=False) + '\n').encode('utf-8'))
    gen.dump = dump_lf
    for variant in ('base', 'atgm', 'kit'):
        errors = gen.write_vehicle(gen.bmp_k64(variant))
        if errors:
            raise SystemExit(f'{variant}: {errors}')
        vid = gen.bmp_k64(variant)['id']
        for file in ('armor.json', 'crew.json', 'engine.json', 'import.json', 'modules.json', 'vehicle.json', 'visual.json', 'weapons.json'):
            path = ROOT / 'data/vehicles' / vid / file
            previous = subprocess.check_output(['git', 'show', f'{opts.baseline_ref}:data/vehicles/{vid}/{file}'], cwd=ROOT)
            if json.loads(previous) == json.loads(path.read_bytes()):
                path.write_bytes(previous)
    base_dir, atgm_dir = (ROOT / 'data/vehicles' / v for v in ('xp_bmp_k64', 'xp_bmp_k64_atgm'))
    with tempfile.TemporaryDirectory(prefix='bmp-k64-rebuild-') as task_tmp:
        task_tmp = pathlib.Path(task_tmp)
        source_path = task_tmp / 'BMP_K_64_ATGM.glb'
        source_path.write_bytes(glb)
        visual = json.loads((base_dir / 'visual.json').read_text())
        config = json.loads((base_dir / 'import.json').read_text())
        config.update(drop_nodes=['Turret_Yaw'], turret_nodes=[], gun_nodes=[], barrel_nodes=[], barrel_meshes=[],
                      source="BMP-K-64 common chassis: user's own BMP_K_64_ATGM.html embedded GLB; named wheel ownership and closed measured hatches")
        config.pop('gun_rest_pose', None)
        chassis = import_model(task_tmp / 'chassis', config, visual, source_path)
        records = pieces(chassis)
        gun_records = kpvt_records(base_old)
        used_tex = sorted({p['texture'] for p, *_ in gun_records} | {p['normal'] for p, *_ in gun_records if p['normal'] >= 0})
        tex_map = {t: len(chassis['textures']) + i for i, t in enumerate(used_tex)}
        for p, *_ in gun_records:
            p['texture'] = tex_map[p['texture']]
            if p['normal'] >= 0:
                p['normal'] = tex_map[p['normal']]
        repaired = pack(chassis, records + gun_records, chassis['textures'] + [base_old['textures'][i] for i in used_tex])
        repaired['source'] += '; KPVT/cupola preserved from original packed BMP_K_64.glb, levelled about the original hinge'
        (base_dir / 'model.json').write_text(json.dumps(repaired, separators=(',', ':')), encoding='utf-8')
        config = json.loads((atgm_dir / 'import.json').read_text())
        config['source'] = "BMP-K-64 Konkurs: user's own BMP_K_64_ATGM.html embedded GLB; measured 10 degree rest pose removed; shared repaired chassis"
        missile = import_model(task_tmp / 'konkurs', config, visual, source_path)
        (atgm_dir / 'model.json').write_text(json.dumps(missile, separators=(',', ':')), encoding='utf-8')
    kornet_old['source'] += '; original level weapon geometry retained; shared repaired chassis'
    (ROOT / 'data/vehicles/xp_bmp_k64_kornet/model.json').write_text(json.dumps(kornet_old, separators=(',', ':')), encoding='utf-8')
    receipt = {
        **origin,
        'recovered_glb_sha256': hashlib.sha256(glb).hexdigest(), 'recovered_glb_bytes': len(glb),
        'baseline_revision': opts.baseline_ref,
        'ownership': "User-created supplied model, used with the user's existing permission; no third-party licence inferred",
        'available_source': 'Embedded Konkurs GLB; common chassis matches the original packed base model',
        'unavailable_source': 'Original standalone KPVT and Kornet GLBs; retained from the pinned packed models',
        'measured_rest_poses': {'KPVT_deg': 15, 'Konkurs_deg': 10, 'front_hatches_deg': 80,
                                'cupola_hatch_deg': 80, 'cupola_hatch_pivot_m': [0, 2.076, -.815]},
        'armour': 'Shared T-64A reference; 205 mm generic composite approximation, not explicit 80/105/20 material layers',
    }
    (base_dir / 'repair-source.json').write_bytes((json.dumps(receipt, indent=2) + '\n').encode('utf-8'))
    print('Repaired only xp_bmp_k64, xp_bmp_k64_atgm, xp_bmp_k64_kornet')


if __name__ == '__main__':
    main()
