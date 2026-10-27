#!/usr/bin/env python3
"""Read the supplied MiG17 archive as data; retain its native quantized geometry.

No package scripts, Blender, deployment, cache rewrites or whole-page generation.
Source indexed faces remain in the blob/ledger even for legacy-excluded stores.
"""
import argparse
import base64
import copy
import hashlib
import json
import math
from pathlib import Path
import tempfile
from types import SimpleNamespace
import zipfile
import zlib

import numpy as np
from gltf import Gltf
import measure
import alignment
from muzzle_alignment import distance_to_triangles, ANCHORS

ZIP_SHA = '99cbfaaa8bfa759e87035d7b9d33e29f635690437b27706e84e44d9eab0aae4f'
GLB_SHA = '5efa5c406e77ce78208da31e3a9455af4108c68c947619ab004e462878b0176e'
PREFIX = 'TankForge_MiG17_Animation_Pack/'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def components(positions, indices):
    # Weld positions only for connectivity queries. Original vertex/index data
    # and per-corner normals/UVs are never welded, moved or synthesized.
    _, inv = np.unique(positions, axis=0, return_inverse=True)
    parent = list(range(int(inv.max()) + 1))
    def root(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for tri in inv[indices]:
        a = root(int(tri[0]))
        for b in tri[1:]:
            parent[root(int(b))] = a
    found = {}
    for i, tri in enumerate(indices):
        found.setdefault(root(int(inv[tri[0]])), []).append(i)
    return list(found.values())


def ranges(ids):
    result = []
    for i in sorted(ids):
        if result and result[-1][0] + result[-1][1] == i:
            result[-1][1] += 1
        else:
            result.append([i, 1])
    return result


def import_record(archive, output):
    zipped = archive.read_bytes()
    if sha(zipped) != ZIP_SHA:
        raise ValueError('Unexpected archive hash; this importer is pinned to the reviewed source')
    with zipfile.ZipFile(archive) as package:
        raw = package.read(PREFIX + 'integration/aircraftModels/mig17f.json')
        glb = package.read(PREFIX + 'aircraft/mig17f/model.glb')
    if sha(glb) != GLB_SHA:
        raise ValueError('Unexpected source GLB')
    record = json.loads(raw)
    assert record['version'] == 2 and record['type'] == 'mig17f'
    original = zlib.decompress(base64.b64decode(record['blob']))
    blob = bytearray(original)
    parts, views, ledger, cc_evidence = [], [], [], []
    eye = np.asarray(record['spec']['eye'])
    for source in record['parts']:
        q = np.frombuffer(original, '<i2', source['vertices'] * 3, source['pos']).reshape(-1, 3)
        positions = q.astype(float) * record['posScale']
        idx = np.frombuffer(original, '<u2', source['triangles'] * 3, source['idx']).reshape(-1, 3)
        groups = {}
        base = source['source_mesh']
        if base in ('body_source_00', 'body_source_14'):
            groups['source_excluded'] = list(range(len(idx)))
        elif source.get('mover') is None and base.startswith('body_source_'):
            for ids in components(q, idx):
                points = positions[idx[ids].ravel()]
                lo, hi = points.min(0), points.max(0)
                # Source03 carries the complete independent main-wing shells;
                # 01 their bays/fittings,15 panel markings;11/12 source rails.
                # Only whole connected components wholly outside the measured
                # +/-0.645m wing seams qualify. Central/fuselage pieces remain.
                wing_source = base in ('body_source_01', 'body_source_03',
                                       'body_source_11', 'body_source_12', 'body_source_15')
                lateral = -1 if hi[0] <= -.64 else 1 if lo[0] >= .64 else 0
                on_wing = wing_source and lateral and lo[1] >= -.8 and hi[1] <= .5 and lo[2] >= -3.9 and hi[2] <= 2.3
                group = ('wing_l' if lateral < 0 else 'wing_r') if on_wing else source['group']
                groups.setdefault(group, []).extend(ids)
                if on_wing:
                    cc_evidence.append(dict(source=base, triangles=len(ids), group=group,
                                            lo=lo.tolist(), hi=hi.tolist()))
        elif source['group'] == 'glass' and source.get('mover') is None:
            tri = positions[idx]
            # Existing physical reflector region, now in the source GLB's exact
            # datum. Separate its original faces rather than adding virtual glass.
            optic = ((tri >= [-.062, .818, 2.248]).all(2)
                     & (tri <= [.032, .902, 2.352]).all(2)).all(1)
            near = ((np.abs(tri[:, :, 0]) < .9) & (tri[:, :, 2] > .3)
                    & (tri[:, :, 2] < 3.3) & (tri[:, :, 1] > .3)).all(1)
            groups['glass'] = np.where(near & ~optic)[0].tolist()
            groups['glass_away'] = np.where(~near & ~optic)[0].tolist()
            groups['sight'] = np.where(optic)[0].tolist()
        else:
            groups[source['group']] = list(range(len(idx)))
        covered = []
        for label, ids in groups.items():
            if not ids:
                continue
            ids = sorted(ids)
            covered.extend(ids)
            part = copy.deepcopy(source)
            part['group'] = 'glass' if label in ('glass_away', 'sight') else label
            part['name'] = ('HUD_GLASS:' if label == 'sight' else '') + base + ('_away' if label == 'glass_away' else '__' + label)
            if len(blob) % 2:
                blob.append(0)
            part['idx'], part['triangles'] = len(blob), len(ids)
            selected = idx[ids].astype('<u2')
            blob.extend(selected.tobytes())
            part['source_faces'] = ranges(ids)
            parts.append(part)
            ledger.append(dict(source=base, part=part['name'], group=part['group'],
                               triangles=len(ids), source_faces=ranges(ids),
                               index_sha256=sha(selected.tobytes())))
            if part['group'] != 'source_excluded':
                views.append(SimpleNamespace(name=('HUD_GLASS:' + base if label == 'sight' else base + ('_away' if label == 'glass_away' else '')),
                    group=part['group'], mover=part.get('mover'), P=positions,
                    I=selected, module=None))
        assert sorted(covered) == list(range(len(idx))), ('face coverage', base)
    record['parts'] = parts
    with tempfile.TemporaryDirectory(prefix='tf-mig17-') as tmp:
        path = Path(tmp) / 'source.glb'
        path.write_bytes(glb)
        source = Gltf(path)
        nodes = {n.get('name'): i for i, n in enumerate(source.nodes)}
        for mover in record['movers']:
            channels = source.channels(mover['param'])
            times, values, interpolation = channels[nodes[mover['name']]]['rotation']
            assert interpolation == 'LINEAR'
            axis = np.array(values[-1][:3], dtype=float, copy=True)
            axis /= np.linalg.norm(axis)
            maximum = 2 * math.atan2(float(np.dot(values[-1][:3], axis)), float(values[-1][3]))
            poses = []
            for t, quat in zip(times, values):
                quat = np.array(quat, dtype=float, copy=True)
                assert abs(np.linalg.norm(quat) - 1) < 1e-5
                if mover['param'] == 'gear':
                    value = float((t - times[0]) / (times[-1] - times[0]))
                else:
                    angle = 2 * math.atan2(float(np.dot(quat[:3], axis)), float(quat[3]))
                    value = float(np.clip(angle / maximum, -1 if mover['param'] in ('roll', 'pitch', 'yaw') else 0, 1))
                if abs(value) < 1e-7:
                    value = 0.0
                poses.append([value, quat.tolist(), mover['p'][:]])
            # Actual unchanged core212 +/-manual-yaw probes prove positive
            # accepted S26 makes positive body-Y rotation/rightward heading.
            # The source clip's positive phase moves its rudder trailing edge
            # left. Retain every source quaternion, reverse only the input map.
            if mover['param'] == 'yaw':
                for pose in poses:
                    pose[0] = -pose[0] if pose[0] else 0.0
                poses.reverse()
            assert all(a[0] < b[0] for a, b in zip(poses, poses[1:])), mover['name']
            mover['poses'] = poses
    # All measurements use these exact decoded native source triangles and its
    # unchanged datum, not the old model's displaced CG or generic hardpoints.
    measured = measure.spec_patch({'wing_root': .645},
        [p for p in views if p.name not in ('body_source_11', 'body_source_12')], record['movers'], {})
    hull = measure.all_tris(views, lambda p: p.group == 'body' and
                           p.name in ('body_source_02', 'body_source_04', 'body_source_05'))
    # Measurement only: fixed fin/tailplane surfaces are not fuselage radii.
    # No source face is removed from its rendered/collision membership here.
    hull = hull[(np.abs(hull[:, :, 0]) <= .8).all(1) & (hull[:, :, 1] <= 1.15).all(1)]
    measured['fuselage'], measured['fuseY'] = measure.fuselage_envelope(hull)
    measured['eye'] = record['spec']['eye'][:]
    measured['eyeSeated'] = record['spec']['eye'][:]
    measured['jet'] = dict(nozzle=-5.6, y=.35, r=.36)
    # Preserve the existing accepted internal layout under the proven source
    # datum transform, rather than inheriting procedural boxes at the old CG.
    # These remain accepted approximate module boxes, not measured anatomy.
    legacy_layout = {
        'engine': [[0.0, .5, -2.7], [.396, .396, 2.1]],
        'fuel': [[0.0, .238, .3], [.479, .334, 1.4]],
        'ammo': [[0.0, -.5, 2.6], [.42, .15, .6]],
    }
    measured['parts'] = {
        name: [[-p[0], p[1]-.15, p[2]-.5002], half]
        for name, (p, half) in legacy_layout.items()
    }
    wheel_views = {p.name: p for p in views}
    contacts = []
    for name in ('gear_main_l_wheel_source_07', 'gear_main_r_wheel_source_07', 'gear_nose_source_06'):
        part = wheel_views[name]
        q = np.round(part.P / record['posScale']).astype(np.int16)
        tire = max(components(q, part.I), key=len)
        points = np.unique(part.P[part.I[tire]].reshape(-1, 3), axis=0)
        lo, hi = points.min(0), points.max(0)
        contacts.append(dict(name=name, lo=lo.tolist(), hi=hi.tolist(),
                             tireTriangles=len(tire),
                             contact=[float((lo[0]+hi[0])/2), float(lo[1]), float((lo[2]+hi[2])/2)]))
    main_y = (contacts[0]['contact'][1] + contacts[1]['contact'][1]) / 2
    main_z = (contacts[0]['contact'][2] + contacts[1]['contact'][2]) / 2
    aux_y, aux_z = contacts[2]['contact'][1:]
    def wheel(contact, radius, pivot_y):
        length = pivot_y - contact[1] - radius
        return dict(x=abs(contact[0]), y=pivot_y, z=contact[2],
                    r=radius, len=length, attachment='fuselage')
    pivots = {m['name']:m['p'] for m in record['movers']}
    measured['gear'] = dict(kind='tricycle', main=wheel([sum(abs(c['contact'][0]) for c in contacts[:2])/2, main_y, main_z], .3275, pivots['gear_main_r'][1]),
                            aux=wheel(contacts[2]['contact'], .2395, pivots['gear_nose'][1]))
    # Let actual Aircraft.pose derive its tiny three-wheel stance from measured
    # low points, avoiding hand-authored attitude or a physics-origin change.
    ctx = dict(cg=np.zeros(3), to_game_points=lambda p, cg: np.asarray(p, float))
    alignment.finish(measured, views, ctx, 'mig17f')
    # Declare the existing, already measured eye registration. Do not invoke a
    # calibration routine that would move it or any support/reflector vertices.
    reflector = measure.all_points(views, lambda p: p.name.startswith('HUD_GLASS:'))
    glass_node = source.nodes[nodes['glass_source_13']]
    material_index = source.j['meshes'][glass_node['mesh']]['primitives'][0]['material']
    glass_material = source.j['materials'][material_index]
    alpha = glass_material['pbrMetallicRoughness']['baseColorFactor'][3]
    assert glass_material['alphaMode'] == 'BLEND' and 0 < alpha < .7
    measured['opticsCalibration'] = dict(
        version=4, assemblyOffset=[0, 0, 0], ufcOffset=0,
        sourceEye=measured['eyeSeated'][:],
        eyeOffset=[v-s for v,s in zip(measured['eye'], measured['eyeSeated'])],
        opaqueSupportWarp=False,
        sourceGlassBounds=[reflector.min(0).tolist(), reflector.max(0).tolist()],
        method='Declare existing eye at measured reflector center; no additional eye or geometry move',
        sourceGeometry=dict(glbSha256=GLB_SHA, mesh='glass_source_13', primitive=0,
            material=material_index, alphaMode=glass_material['alphaMode'], alpha=alpha,
            sourceFaceRanges=[[956, 140], [1396, 54]],
            frame='Exact new GLB/native datum, not transformed old sight points'))
    # Register both measured sides explicitly; the existing loadout mapper uses
    # a symmetric x with this audited native-pylon flag and no duplicate rack.
    measured['pylonPoints'] = [None]
    for side, group in ((-1, 'wing_l'), (1, 'wing_r')):
        rails = measure.all_tris(views, lambda p: p.name == 'body_source_11' and p.group == group)
        support = measure.all_points(views, lambda p: p.name == 'body_source_12' and p.group == group)
        lo, hi = support.min(0), support.max(0)
        x, z = (lo[0]+hi[0])/2, (lo[2]+hi[2])/2
        y = alignment.surface_y(rails, x, z, 10)
        measured['pylonPoints'].append([float(x), float(y), float(z)])
    # Keep unsupported old generic stations from leaking through the decoder's
    # stations merge. They now all resolve to the actual original single pair.
    inner = measured['stations']['inner']
    for key in ('inner', 'mid', 'outer'):
        measured['stations'][key] = copy.deepcopy(inner)
    measured['stations']['row'] = [copy.deepcopy(inner), copy.deepcopy(inner)]
    record['spec'] = measured
    record['blob'] = base64.b64encode(zlib.compress(bytes(blob), 9)).decode()
    record['sourceBinding'] = dict(archiveSha256=ZIP_SHA, glbSha256=GLB_SHA,
        originalNativeSha256=sha(raw), variant='Source does not establish F subtype; retained existing mig17f slot',
        frame='Unchanged source GLB/native datum: metres +x right +y up +z nose; no new centering or mirroring',
        oldAcceptedRecordSha256='9da638d160b051984d3ff5654a02a2c0c3ef143f3216338403e1f3e904fc49a2',
        oldRecordCgInModel=[0, -.15, -.5002],
        oldToNewPointTransform=[[-1,0,0,0],[0,1,0,-.15],[0,0,1,-.5002],[0,0,0,1]],
        internalLayout='Existing accepted engine/fuel/ammo boxes transformed to new datum, not anatomical reconstruction',
        animation='gear=source mechanism phase; surfaces=signed physical deflection/maximum, not clip clock',
        yawRuntimeSense=-1,
        yawSourceContract='All49 source quaternions retained; source deflection maps to negative game S26, verified against actual core212 yaw/body heading and rudder trailing edge',
        exclusions={'body_source_00':'Unidentified legacy converter exclusion; original faces retained, reversible',
                    'body_source_14':'Legacy preinstalled store exclusion; gameplay ordnance is separately mounted'},
        unsupported='No historical subtype/hinge certification or formal combat triangle migration')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(record, separators=(',', ':'), ensure_ascii=False) + '\n')
    report = dict(archiveSha256=ZIP_SHA, glbSha256=GLB_SHA, nativeSha256=sha(output.read_bytes()),
        sourceTriangles=sum(p['triangles'] for p in json.loads(raw)['parts']),
        retainedTriangles=sum(p['triangles'] for p in parts),
        renderedTriangles=sum(p['triangles'] for p in parts if p['group'] != 'source_excluded'),
        sourceParts=55, runtimeParts=len(parts), movers=len(record['movers']),
        originalBlobPrefixPreserved=bytes(blob[:len(original)]) == original,
        faces=ledger, connectedComponents=cc_evidence, contacts=contacts,
        wheelTrackMeters=abs(contacts[0]['contact'][0]-contacts[1]['contact'][0]),
        wheelbaseMeters=aux_z-main_z, spec=measured)
    output.with_suffix('.audit.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps({k:report[k] for k in ('nativeSha256','sourceTriangles','retainedTriangles','renderedTriangles','runtimeParts','movers','originalBlobPrefixPreserved')}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('archive', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    import_record(args.archive, args.output)
