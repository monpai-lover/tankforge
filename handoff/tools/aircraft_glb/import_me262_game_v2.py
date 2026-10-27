#!/usr/bin/env python3
"""Import the reviewed Me262 GLBs as data. Never execute package scripts.

Writes independent native-v2 candidates and a reversible source-face ledger;
does not modify a game bundle, vehicle definitions, or a damage catalog.
"""
import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import struct
import tempfile
import zipfile
import zlib

import numpy as np
from gltf import Gltf
from convert import Part, S, build_atlas, encode, game_delta, mat_quat, material_of, to_game_points
from import_mig17_animation_pack import components, ranges
import measure

ZIP_SHA = '30beda948d09760f1af24f0c79314c25923765862f8e6555761dc9fc35fb5f1f'
VARIANTS = {
    'me262': ('me262_a1a_r4m.glb', 'A-1a', ['Lower_L', 'Lower_R', 'Upper_L', 'Upper_R']),
    'me262a2a': ('me262_a2a_2x250.glb', 'A-2a', ['Lower_L', 'Lower_R']),
    'me262u4': ('me262_a1a_u4.glb', 'A-1a/U4', ['MK214A']),
}
CLIPS = {'gear_main': 'gear_main', 'gear_nose': 'gear_nose',
         'gear_main_doors': 'gear_main_doors', 'gear_nose_door': 'gear_nose_door',
         'roll': 'roll', 'pitch': 'pitch', 'yaw': 'yaw', 'flaps': 'flap',
         'slats': 'slat', 'canopy': 'canopy', 'wheel_spin': 'wheel_spin'}


def sha(b):
    return hashlib.sha256(b).hexdigest()


def array_sha(a):
    return sha(np.asarray(a, '<f8').tobytes())


def normals(P, I):
    n = np.zeros_like(P)
    t = np.cross(P[I[:, 1]] - P[I[:, 0]], P[I[:, 2]] - P[I[:, 0]])
    for k in range(3):
        np.add.at(n, I[:, k], t)
    return n / np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-20)


def surface_y(T, x, z):
    """Actual triangle vertical intersection, underside only; no filled hull."""
    a, b, c = T[:, 0], T[:, 1], T[:, 2]
    v0, v1 = b[:, [0, 2]] - a[:, [0, 2]], c[:, [0, 2]] - a[:, [0, 2]]
    q = np.array([x, z]) - a[:, [0, 2]]
    d = v0[:, 0] * v1[:, 1] - v0[:, 1] * v1[:, 0]
    valid = abs(d) > 1e-12
    u = np.zeros(len(T)); v = np.zeros(len(T))
    u[valid] = (q[valid, 0] * v1[valid, 1] - q[valid, 1] * v1[valid, 0]) / d[valid]
    v[valid] = (v0[valid, 0] * q[valid, 1] - v0[valid, 1] * q[valid, 0]) / d[valid]
    ok = valid & (u >= -1e-7) & (v >= -1e-7) & (u + v <= 1 + 1e-7)
    ys = a[:, 1] + u * (b[:, 1] - a[:, 1]) + v * (c[:, 1] - a[:, 1])
    return float(ys[ok].min()) if ok.any() else None


def aperture_curve(T):
    """Boundary of the actual open nose well in the source airframe skin."""
    P = T.reshape(-1, 3)
    _, inv = np.unique(np.round(P, 5), axis=0, return_inverse=True)
    I = inv.reshape(-1, 3)
    edges = np.sort(np.concatenate([I[:, [0, 1]], I[:, [1, 2]], I[:, [2, 0]]]), axis=1)
    edge, count = np.unique(edges, axis=0, return_counts=True)
    welded = np.unique(np.round(P, 5), axis=0)
    boundary = welded[np.unique(edge[count == 1])]
    q = boundary[(abs(boundary[:, 0]) > .14) & (abs(boundary[:, 0]) < .15)
                 & (boundary[:, 1] < -.1) & (boundary[:, 2] > 1.8) & (boundary[:, 2] < 3.7)]
    assert len(q) >= 14, ('nose aperture source boundary changed', q.tolist())
    zs = np.unique(q[:, 2]); ys = np.array([q[q[:, 2] == z, 1].mean() for z in zs])
    def fitted(x, z):
        # Source skin beside the real opening provides cross-section curvature;
        # the opening edge supplies the exact height anchor. No body faces added.
        xx = np.array([.151, .19, .23, .28])
        yy = [surface_y(T, float(v), float(z)) for v in xx]
        good = np.array([v is not None for v in yy])
        if good.sum() >= 2:
            a = np.polyfit(xx[good] ** 2, np.array([v or 0 for v in yy])[good], 1)[0]
        else:
            a = .3
        edge_y = np.interp(z, zs, ys)
        return float(edge_y + a * (x * x - .14422 ** 2))
    return fitted, q


def repair_nose_doors(g):
    W0 = g.world(); names = {n.get('name'): i for i, n in enumerate(g.nodes)}
    body = g.primitives(names['EXT_AirframeShell'], W0[names['EXT_AirframeShell']])[0]
    fitted, boundary = aperture_curve(body['P'][body['I']])
    closed = g.world(g.channels('gear_retract'), 8)
    repaired, ledger = {}, []
    for name in ('EXT_NoseLongDoor', 'EXT_NoseFrontDoor'):
        i = names[name]; pr = g.primitives(i, W0[i])[0]
        P, I = pr['P'], pr['I']; D = closed[i] @ np.linalg.inv(W0[i])
        C = P @ D[:3, :3].T + D[:3, 3]
        Q = C.copy()
        if name == 'EXT_NoseLongDoor':
            # The source long door is skewed in both span and chord when closed.
            # Preserve its 3x3 two-skin grid, indices, UV and material; fit those
            # original vertices to the real aperture, not to a new static cover.
            section = np.argmin(abs(P[:, 2, None] - np.array([1.875, 2.755, 3.124])), axis=1)
            znew = [1.86815, 2.7484, 3.11733]
            for k in range(3):
                ids = np.where(section == k)[0]; sub = P[ids]
                # At each section, source rows are separated by ~0.12m in Y;
                # each has two 13mm-thick skins separated primarily along X.
                row = np.rint((sub[:, 1].max() - sub[:, 1]) / .1205).astype(int)
                assert set(row) == {0, 1, 2}
                for r in range(3):
                    rr = ids[row == r]
                    x = -.14322 + r * .14322
                    # Original lower-X skin is the external skin at stow.
                    mid = (P[rr, 0].min() + P[rr, 0].max()) / 2
                    thick = np.where(P[rr, 0] < mid, 0, .012)
                    Q[rr, 0] = x; Q[rr, 2] = znew[k]
                    Q[rr, 1] = fitted(x, znew[k]) - .0005 + thick
        else:
            # Remove 89mm overlap with the long door while retaining all 60
            # source faces and the existing front-door hinge and motion table.
            z0, z1 = C[:, 2].min(), C[:, 2].max()
            Q[:, 2] = 3.11933 + (C[:, 2] - z0) / (z1 - z0) * (3.61263 - 3.11933)
            Q[:, 0] *= .14322 / max(abs(C[:, 0]))
            design = np.column_stack([np.ones(len(C)), C[:, 2], C[:, 0] ** 2])
            residual = C[:, 1] - design @ np.linalg.lstsq(design, C[:, 1], rcond=None)[0]
            thick = np.clip(residual - residual.min(), 0, .008)
            Q[:, 1] = [fitted(x, z) - .0005 + t for (x, _, z), t in zip(Q, thick)]
        inv = np.linalg.inv(D)
        fixed = Q @ inv[:3, :3].T + inv[:3, 3]
        repaired[i] = (fixed, normals(fixed, I))
        ledger.append(dict(node=i, name=name, triangles=len(I), vertices=len(P),
                           source_rest_positions=P.tolist(), repaired_rest_positions=fixed.tolist(),
                           source_sha256=array_sha(P), repaired_sha256=array_sha(fixed),
                           source_closed_bounds=[C.min(0).tolist(), C.max(0).tolist()],
                           repaired_closed_bounds=[Q.min(0).tolist(), Q.max(0).tolist()],
                           maximum_vertex_change_m=float(np.linalg.norm(fixed - P, axis=1).max()),
                           method='Re-fit existing indexed moving-door skins to measured source aperture; original hinge/table retained'))
    # Verify actual finite triangles cover the open aperture, not just bounds.
    triangles = []
    for i, (P, _) in repaired.items():
        D = closed[i] @ np.linalg.inv(W0[i]); C = P @ D[:3, :3].T + D[:3, 3]
        triangles.append(C[g.primitives(i, W0[i])[0]['I']])
    door_tri = np.concatenate(triangles)
    probes = []
    for z in np.linspace(1.88, 3.60, 45):
        if 3.11733 <= z <= 3.11933:
            continue
        for x in [-.13, -.07, 0, .07, .13]:
            y = surface_y(door_tri, x, z)
            error = None if y is None else y - fitted(x, z)
            probes.append(dict(x=float(x), z=float(z), error_m=error))
    assert all(p['error_m'] is not None for p in probes), 'closed door triangle hole'
    assert max(abs(p['error_m']) for p in probes) < .015
    return repaired, dict(boundary=boundary.tolist(), repairs=ledger, closed_triangle_probes=probes,
                         max_closed_surface_error_m=max(abs(p['error_m']) for p in probes),
                         deliberate_side_clearance_m=.001, deliberate_seam_m=.002,
                         new_faces=0, deleted_faces=0)


def extract_movers(g, cg):
    W0 = g.world(); source = {}; movers = []
    for clip, param in CLIPS.items():
        channels = g.channels(clip)
        for i, ch in channels.items():
            if i in source:
                raise ValueError(('node animated by two independent controls', i))
            assert all(v[2] == 'LINEAR' for v in ch.values())
            p = to_game_points(W0[i][:3, 3], cg)
            parent = g.parent.get(i)
            Wp = W0[parent] if parent is not None else np.eye(4)
            L0 = g.rest_local(i)
            ts = np.unique(np.concatenate([v[0] for v in ch.values()]))
            poses = []; linear_samples = []
            for t in ts:
                L = g.local_at(i, channels, float(t))
                D = Wp @ L @ np.linalg.inv(L0) @ np.linalg.inv(Wp)
                R, d = game_delta(D, cg)
                linear_samples.append(R.reshape(-1).tolist())
                u, _, vt = np.linalg.svd(R); q = mat_quat(u @ vt)
                value = float(t / g.duration(clip))
                if param in ('roll', 'pitch', 'yaw'):
                    value = value * 2 - 1
                # Source positive yaw already becomes positive game-axis Y after
                # mirroring; final real-WASM sign test is reported separately.
                sample = [value, q.tolist(), (R @ p + d).tolist()]
                if not np.allclose(R.T @ R, np.eye(3), atol=1e-6):
                    sample.append(R.reshape(-1).tolist())
                poses.append(sample)
            if any(len(pose) > 3 for pose in poses):
                # The actual client interpolates an affine matrix only when
                # BOTH adjacent samples carry it. Include the identity endpoint
                # too, otherwise the last interval silently loses rod scaling.
                for pose, linear in zip(poses, linear_samples):
                    if len(pose) == 3:
                        pose.append(linear)
            m = dict(name=g.nodes[i]['name'], param=param, p=p.tolist(),
                     axis=[1, 0, 0], side=-1 if p[0] < -.01 else 1,
                     poses=poses, source_node=i, source_clip=clip)
            if param == 'wheel_spin':
                child = next(k for k in g.nodes[i].get('children', []) if g.nodes[k].get('name', '').startswith('EXT_Wheel_'))
                points = np.concatenate([p['P'] for p in g.primitives(child, W0[child])])
                m['wheelRadius'] = float((points[:, 1].max()-points[:, 1].min())/2)
                m['wheelRadiusEvidence'] = dict(source_node=child, method='Half vertical diameter of actual source indexed wheel geometry in rest pose',
                    source_bounds=[points.min(0).tolist(), points.max(0).tolist()],
                    limitation='Supplied tire mesh is not an exact engineering circle; effective rolling radius uses measured standing height')
            if param == 'yaw':
                m['axis'] = [0, 1, 0]
            if param in ('roll', 'flap', 'slat'):
                m['damage_owner'] = 'wing_l' if p[0] < 0 else 'wing_r'
            source[i] = len(movers); movers.append(m)
    for i, idx in source.items():
        p = g.parent.get(i)
        while p is not None and p not in source:
            p = g.parent.get(p)
        if p is not None:
            movers[idx]['parent'] = source[p]
    # No synthetic gear is allowed over the source rig. This empty marker is
    # understood by current importedGeometry's fallback check; custom axes are
    # activated by the client integration, not by a fabricated control actuator.
    movers.append(dict(name='SOURCE_GEAR_CONTRACT', param='gear', p=[0, 0, 0],
                       poses=[[0, [0, 0, 0, 1], [0, 0, 0]], [1, [0, 0, 0, 1], [0, 0, 0]]]))
    return movers, source


def semantic(name):
    lower = name.lower()
    if 'jumo004_' in lower or 'intake_' in lower:
        return 'engine_l' if lower.endswith('_l') else 'engine_r'
    if name.startswith('INT_Fuel_'):
        return {'ForwardMain': 'fuel_0', 'ForwardLowerAux': 'fuel_1',
                'AftMain': 'fuel_2', 'AftAux': 'fuel_3'}[name[9:]]
    if name.startswith('WPN_AmmoEnvelope_'):
        return 'ammo_' + name[17:].lower()
    if name.startswith('WPN_') or name.startswith('INT_MK214'):
        return 'gun_' + name.removeprefix('WPN_').removeprefix('INT_').lower()
    if name.startswith('PILOT_'):
        return 'pilot'
    if 'gear' in lower:
        return 'gear'
    for s in ['hydraulics', 'radio', 'battery', 'oxygen', 'structure']:
        if s in lower:
            return s
    return None


def corrected_glb(g, repaired, exclusions, output, calibration, cg):
    """Append repaired accessors; retain original binary/accessors in this GLB."""
    doc = json.loads(json.dumps(g.j)); binary = bytearray(g.bin); W = g.world()
    def accessor(values, component_type=5126, target=34962):
        values = np.asarray(values, '<f4' if component_type == 5126 else '<u4')
        while len(binary) % 4: binary.append(0)
        bv = len(doc['bufferViews']); doc['bufferViews'].append(dict(buffer=0, byteOffset=len(binary), byteLength=values.nbytes, target=target))
        binary.extend(values.tobytes()); k = len(doc['accessors'])
        record = dict(bufferView=bv, componentType=component_type, count=len(values), type='VEC3' if values.ndim == 2 else 'SCALAR')
        if values.ndim == 2:
            record.update(min=values.min(0).astype(float).tolist(), max=values.max(0).astype(float).tolist())
        doc['accessors'].append(record)
        return k
    for i, (P, N) in repaired.items():
        pr = doc['meshes'][doc['nodes'][i]['mesh']]['primitives'][0]
        pr.setdefault('extras', {})['tankforgeOriginalAttributes'] = dict(pr['attributes'])
        inv = np.linalg.inv(W[i]); local_p = P @ inv[:3, :3].T + inv[:3, 3]
        local_n = N @ W[i][:3, :3]; local_n /= np.maximum(np.linalg.norm(local_n, axis=1, keepdims=True), 1e-20)
        pr['attributes']['POSITION'] = accessor(local_p)
        pr['attributes']['NORMAL'] = accessor(local_n)
        doc['nodes'][i].setdefault('extras', {})['tankforgeRepair'] = ('Original Revi mounting bracket extended to retain forward panel anchor; original accessors retained'
            if g.nodes[i]['name'] == 'REVI_InstrumentMount' else 'Existing moving door re-fit to original nose-well aperture; original accessors retained')
    for i, j, ids in exclusions:
        pr = doc['meshes'][doc['nodes'][i]['mesh']]['primitives'][j]
        original = g.accessor(pr['indices']).reshape(-1, 3)
        keep = np.ones(len(original), bool); keep[ids] = False
        pr.setdefault('extras', {}).update(tankforgeOriginalIndices=pr['indices'], tankforgeExcludedSourceFaces=ranges(ids))
        pr['indices'] = accessor(original[keep].reshape(-1), 5125, 34963)
    if calibration:
        offset = np.asarray(calibration['assemblyOffset'], float) @ S
        names = {n.get('name'): i for i, n in enumerate(g.nodes)}
        i = names['GROUP_Revi16B']; parent = g.parent.get(i); parent_R = W[parent][:3, :3] if parent is not None else np.eye(3)
        node = doc['nodes'][i]
        node.setdefault('extras', {})['tankforgeOriginalTranslation'] = node.get('translation', [0, 0, 0])
        node['translation'] = (np.array(node.get('translation', [0, 0, 0])) + np.linalg.solve(parent_R, offset)).tolist()
        for name, pos in [('SOCKET_SightAxis', W[names['SOCKET_SightAxis']][:3, 3] + offset),
                          ('SOCKET_PilotEye', np.asarray(calibration['eye']) @ S + cg)]:
            k = names[name]; par = g.parent.get(k); M = W[par] if par is not None else np.eye(4); inv = np.linalg.inv(M)
            doc['nodes'][k].setdefault('extras', {})['tankforgeOriginalTranslation'] = doc['nodes'][k].get('translation', [0, 0, 0])
            doc['nodes'][k]['translation'] = (inv[:3, :3] @ pos + inv[:3, 3]).tolist()
    doc['buffers'][0]['byteLength'] = len(binary)
    doc.setdefault('extras', {})['tankforgeRepairProvenance'] = dict(archive_sha256=ZIP_SHA, original_glb_sha256=sha(Path(g.path).read_bytes()),
        original_buffers_and_accessors_retained=True, original_animations_unchanged=True, new_static_cover_faces=0,
        calibration=calibration)
    encoded = json.dumps(doc, separators=(',', ':')).encode(); encoded += b' ' * (-len(encoded) % 4)
    binary.extend(b'\0' * (-len(binary) % 4))
    out = struct.pack('<4sII', b'glTF', 2, 12+8+len(encoded)+8+len(binary)) + struct.pack('<II', len(encoded), 0x4e4f534a) + encoded + struct.pack('<II', len(binary), 0x004e4942) + binary
    output.parent.mkdir(parents=True, exist_ok=True); output.write_bytes(out)
    check = Gltf(output)
    assert check.j['animations'] == g.j['animations']
    assert check.j['materials'] == g.j['materials']
    for i, (P, _) in repaired.items():
        expected = P + (np.asarray(calibration['assemblyOffset']) @ S if calibration and g.nodes[i]['name'].startswith('REVI_') else 0)
        assert np.max(np.linalg.norm(check.primitives(i, check.world()[i])[0]['P']-expected, axis=1)) < 2e-6
    return dict(path=str(output), sha256=sha(out), bytes=len(out), original_animations_unchanged=True,
                original_accessors_preserved=len(g.j['accessors']), additional_accessors=len(check.j['accessors'])-len(g.j['accessors']))


def repair_mount(g, repaired, calibration):
    W = g.world(); names = {n.get('name'): i for i, n in enumerate(g.nodes)}
    mount_audit = None
    if calibration and calibration.get('preserveInstrumentMountForwardAnchor'):
        i = names[calibration.get('instrumentMountNode', 'REVI_InstrumentMount')]
        pr = g.primitives(i, W[i])[0]; original = pr['P']; P = original.copy()
        extension = float(calibration['mountExtensionM'])
        if not np.isclose(extension + float(calibration['assemblyOffset'][2]), 0):
            raise ValueError('Bracket extension must exactly compensate rearward assembly Z displacement')
        z0, z1 = P[:, 2].min(), P[:, 2].max()
        P[:, 2] += extension * (P[:, 2]-z0)/(z1-z0)
        repaired[i] = (P, normals(P, pr['I']))
        mount_audit = dict(node=i, source_name=g.nodes[i]['name'], source_rest_positions=original.tolist(),
            adapted_before_assembly_positions=P.tolist(), source_bounds=[original.min(0).tolist(), original.max(0).tolist()],
            final_bounds=[(P+np.asarray(calibration['assemblyOffset'])@S).min(0).tolist(), (P+np.asarray(calibration['assemblyOffset'])@S).max(0).tolist()],
            forward_anchor_original_z=float(z1), forward_anchor_final_z=float(P[:,2].max()+calibration['assemblyOffset'][2]),
            triangles=len(pr['I']), indices_unchanged=True, uv_material_unchanged=True,
            reason='User requested whole sight rearward; extend only original indexed mounting bracket to preserve panel anchor, not a historical installation measurement')
    return mount_audit


def thin_strip_ids(P, I):
    excluded = []
    for ids in components(np.round(P, 5), I):
        C = P[I[ids]].reshape(-1, 3); lo, hi = C.min(0), C.max(0)
        if len(ids) == 4 and max(abs(lo[0]), abs(hi[0])) > 3.8 and lo[1] < -.48 and hi[1] < -.32 and lo[2] > -1.2 and hi[2] < -1.0:
            excluded.extend(ids)
    assert len(excluded) == 8, 'Source dangling-strip component changed'
    return excluded


def import_variant(path, type_id, designation, guns, output, cg, calibration=None, corrected_output=None):
    g = Gltf(path); W = g.world(); movers, animated = extract_movers(g, cg)
    repaired, door_audit = repair_nose_doors(g)
    parts = []; metadata = []; face_ledger = []; visual = []; nodes = []; exclusions = []
    names = {n.get('name'): i for i, n in enumerate(g.nodes)}
    mount_audit = repair_mount(g, repaired, calibration)
    for i in g.mesh_nodes():
        name = g.nodes[i].get('name', str(i)); mover = i
        while mover not in animated and mover in g.parent:
            mover = g.parent[mover]
        mover = animated.get(mover)
        role = ('weapon_exterior' if name in ('WPN_MK214A_Barrel', 'WPN_MK214A_MuzzleBrake')
                else 'store' if name.startswith('STORE_') else 'mount' if name.startswith('MOUNT_')
                else 'crew' if name.startswith('PILOT_') else 'internal' if name.startswith(('INT_', 'WPN_'))
                else 'glass' if name.startswith('GLASS_') or name in ('REVI_Combiner', 'REVI_ObjectiveLens', 'REVI_DaylightFilterLowered')
                else 'cockpit' if name.startswith(('COCKPIT_', 'REVI_')) else 'exterior')
        module = semantic(name)
        for j, pr in enumerate(g.primitives(i, W[i])):
            original = pr['P'].copy()
            if i in repaired:
                assert j == 0
                pr['P'], pr['N'] = repaired[i]
            P = to_game_points(pr['P'], cg); N = pr['N'] @ S
            if calibration and name.startswith('REVI_'):
                P += np.asarray(calibration['assemblyOffset'], float)
            idx = pr['I'][:, [0, 2, 1]]
            group = ('internal' if role == 'internal' else role if role in ('crew', 'store', 'mount', 'glass', 'cockpit')
                     else 'control' if mover is not None else 'body')
            groups = {group: list(range(len(idx)))}
            if name == 'EXT_SurfaceFittings':
                # Two disconnected four-face strips hang >0.2m below the outer
                # flap; retained source data, excluded from the airframe.
                excluded = thin_strip_ids(original, pr['I'])
                groups = {group: sorted(set(range(len(idx))) - set(excluded)), 'source_excluded': excluded}
                # The two original outer-flap fittings are rigid wing parts,
                # independent of the two rejected strips below them. Move only
                # those whole measured components to their source wing owner.
                for ids in components(np.round(original, 5), pr['I']):
                    C=original[pr['I'][ids]].reshape(-1,3);lo,hi=C.min(0),C.max(0)
                    if len(ids)==8 and lo[1]>-.29 and hi[1]<-.05 and lo[2]>-1.2 and hi[2]<-.65 and min(abs(lo[0]),abs(hi[0]))>2.6:
                        label='wing_l' if lo[0]>0 else 'wing_r'
                        groups.setdefault(label,[]).extend(ids)
                        groups[group]=sorted(set(groups[group])-set(ids))
                if excluded: exclusions.append((i, j, excluded))
            if name == 'EXT_AirframeShell':
                tri = P[idx]
                left = (tri[:, :, 0] < -.65).all(1); right = (tri[:, :, 0] > .65).all(1)
                groups = {'wing_l': np.where(left)[0].tolist(), 'wing_r': np.where(right)[0].tolist(),
                          'body': np.where(~(left | right))[0].tolist()}
            for label, ids in groups.items():
                if not ids:
                    continue
                pname = f'{"HUD_GLASS:" if name == "REVI_Combiner" else ""}{name}::p{j}::{label}'
                part = Part(name=pname, group=label, P=P, N=N, UV=pr['UV'], I=idx[ids],
                            mat=material_of(g, pr['material']), src=(type_id, g), mover=mover, module=module)
                parts.append(part)
                meta = dict(source_node=i, source_mesh=g.nodes[i]['mesh'], source_primitive=j,
                            source_name=name, source_faces=ranges(ids), source_role=role,
                            visual_module=module, node_path=Gltf.path(g, i))
                side = -1 if name.endswith('_L') or '_L_' in name else 1 if name.endswith('_R') or '_R_' in name else None
                if label in ('wing_l', 'wing_r'):
                    meta['damage_owner'] = label
                elif side is not None and ('R4M' in name or any(s in name for s in ('Aileron_', 'Flap_', 'Slat_'))):
                    meta['damage_owner'] = 'wing_l' if side < 0 else 'wing_r'
                elif role in ('store', 'mount'):
                    meta['damage_owner'] = 'fuselage'
                if role == 'store':
                    meta.update(store_type='r4m' if 'R4M' in name else 'sc250',
                                store_socket='SOCKET_' + name.removeprefix('STORE_') if 'R4M' in name else 'SOCKET_BombRelease_' + name[-1])
                    meta['store_index'] = ((int(name[-2:]) - 1) + (0 if '_L_' in name else 12)) if 'R4M' in name else (0 if name.endswith('_L') else 1)
                elif role == 'mount':
                    meta['mount_type'] = 'r4m_woodrack' if 'R4M' in name else 'wikingerschiff'
                metadata.append(meta)
                face_ledger.append(dict(part=pname, **meta, group=label, triangles=len(ids),
                                        original_positions_sha256=array_sha(original),
                                        source_indices_sha256=sha(pr['I'][ids].astype('<u4').tobytes()),
                                        repaired=i in repaired, optics_rigid_registration=bool(calibration and name.startswith('REVI_'))))
                if role in ('internal', 'crew'):
                    visual.append(dict(part=pname, source_node=i, module=module, role=role,
                                       approximate_source_layout=g.nodes[i].get('extras', {}).get('approximate_layout', False),
                                       envelope_only=g.nodes[i].get('extras', {}).get('envelope_only', False)))
            nodes.append(dict(node=i, name=name, parent=g.parent.get(i), mesh=g.nodes[i]['mesh'], primitive=j,
                              role=role, module=module, triangles=len(idx), bounds=[P.min(0).tolist(), P.max(0).tolist()],
                              source_world=W[i].tolist(), extras=g.nodes[i].get('extras', {})))
    spec = measure.spec_patch({'wing_root': .65}, [p for p in parts if p.group not in ('internal', 'crew', 'store', 'mount', 'source_excluded')], movers, {})
    shell = measure.all_tris(parts, lambda p: p.name.startswith('EXT_AirframeShell::') and p.group == 'body')
    # Underwing nacelles and the U4's exposed barrel are separate source
    # assemblies. Their overall widths/lengths must not inflate the fuselage.
    spec['fuselage'], spec['fuseY'] = measure.fuselage_envelope(shell, x_half=.65)
    # Source data and authoritative weapon socket order, no inherited old CG.
    sockets = {n: to_game_points(W[i][:3, 3], cg).tolist() for n, i in names.items() if n.startswith('SOCKET_')}
    source_eye = sockets['SOCKET_PilotEye'][:]
    if calibration:
        sockets['SOCKET_PilotEye'] = calibration['eye'][:]
        sockets['SOCKET_SightAxis'] = (np.array(sockets['SOCKET_SightAxis']) + np.asarray(calibration['assemblyOffset'])).tolist()
    gun_sockets = ['SOCKET_Muzzle_' + (s if s == 'MK214A' else 'MK108_' + s) for s in guns]
    gun_kind = 'mk214a' if guns == ['MK214A'] else 'mk108'
    spec['muzzles'] = [sockets[n] + [.30, .025 if gun_kind == 'mk214a' else .015] for n in gun_sockets]
    if gun_kind == 'mk108':
        spec['gunAmmo'] = {gun_kind: [100, 100, 80, 80] if len(guns) == 4 else [100, 100]}
    spec['sourceEye'] = source_eye; spec['eye'] = sockets['SOCKET_PilotEye']; spec['eyeSeated'] = source_eye
    # Eye/sight remains explicitly uncalibrated pending root's source panel/seat
    # review; do not invoke a mesh-warping generic optics calibration routine.
    spec['sourceSockets'] = sockets
    spec['opticsCalibrationPending'] = not bool(calibration)
    spec['stabilator'] = False
    spec['noWingTanks'] = True
    if calibration:
        glass = measure.all_points(parts, lambda p: p.name.startswith('HUD_GLASS:REVI_Combiner'))
        spec['opticsCalibration'] = dict(version=4, sourceEye=source_eye, eyeOffset=(np.asarray(calibration['eye'])-source_eye).tolist(),
            assemblyOffset=calibration['assemblyOffset'], opaqueSupportWarp=False,
            sourceMountAdaptation=mount_audit,
            sourceGlassBounds=[glass.min(0).tolist(), glass.max(0).tolist()],
            sourceGeometry=dict(mesh='REVI_Combiner', node=names['REVI_Combiner'], sourceFaceRanges=[[0,2]],
                                assembly='GROUP_Revi16B', assembly_nodes=[n for n in names if n.startswith('REVI_')]),
            evidence=calibration.get('evidence', {}))
        spec['sight'] = dict(points=np.unique(np.round(glass, 6), axis=0).tolist(), eye=spec['eye'],
                             eyeBox=calibration.get('eyeBox', [.13, .10, .40]), source='Actual REVI_Combiner source indexed triangles under rigid whole-assembly registration')
        if 'cockpitLookDown' in calibration: spec['cockpitLookDown'] = calibration['cockpitLookDown']
    spec['sourceVisualModules'] = visual
    gear = {}
    contacts = []
    for key, wheel in [('main_l', 'EXT_Wheel_Main_L'), ('main_r', 'EXT_Wheel_Main_R'), ('aux', 'EXT_Wheel_Nose')]:
        Ps = [p.P[np.unique(p.I)] for p in parts if p.name.startswith(wheel + '::')]
        P = np.concatenate(Ps); lo, hi = P.min(0), P.max(0)
        contacts.append(dict(name=wheel, low=float(lo[1]), centre=[float((lo[k]+hi[k])/2) for k in range(3)], bounds=[lo.tolist(), hi.tolist()]))
        ctrl = W[names['CTRL_Gear_Nose' if key == 'aux' else 'CTRL_Gear_Main_' + ('L' if key.endswith('_l') else 'R')]][:3, 3]
        pivot = to_game_points(ctrl, cg); radius = float((hi[1]-lo[1])/2)
        gear[key] = dict(x=float(abs((lo[0]+hi[0])/2)), y=float(pivot[1]), z=float((lo[2]+hi[2])/2), r=radius,
                         len=float(pivot[1]-lo[1]-radius), attachment='fuselage')
    spec['gear'] = dict(kind='tricycle', main=gear['main_r'], aux=gear['aux'])
    # Internal accepted box approximations are explicitly source-derived visual
    # envelopes here; root controls the damage catalog's actual authority.
    spec['parts'] = {}
    for module in ['engine_l', 'engine_r', 'fuel_0', 'fuel_1', 'fuel_2', 'fuel_3', 'hydraulics', 'radio', 'pilot']:
        P = measure.all_points(parts, lambda p: p.module == module and p.group in ('internal', 'crew'))
        if len(P):
            spec['parts'][module] = measure.box(P)
    spec['parts']['engine'] = spec['parts'].get('engine_r')
    P = measure.all_points(parts, lambda p: p.module and p.module.startswith('fuel_'))
    if len(P): spec['parts']['fuel'] = measure.box(P)
    P = measure.all_points(parts, lambda p: p.module and p.module.startswith('ammo_'))
    if len(P): spec['parts']['ammo'] = measure.box(P)
    col, nor, white = build_atlas(parts, 2048)
    recs, blob = encode(parts, movers, col.size[0], white)
    assert len(recs) == len(metadata)
    for rec, meta in zip(recs, metadata):
        rec.update(meta)
    cb, nb = io.BytesIO(), io.BytesIO(); col.save(cb, 'WEBP', quality=90, method=6); nor.save(nb, 'WEBP', quality=90, method=6)
    record = dict(version=2, type=type_id, designation=designation, posScale=1/3000,
                  source='User me262_game_v2.zip; original source and supplied approximate internal layout retained',
                  sourceHashes={'archive': ZIP_SHA, 'main': sha(path.read_bytes())}, cg_in_model=cg.tolist(),
                  cg_why='Explicit source GLTF origin, mirrored X; all source sockets and measured metadata use this datum',
                  spec=spec, movers=movers, parts=recs, blob=base64.b64encode(zlib.compress(blob, 9)).decode(),
                  texture='data:image/webp;base64,'+base64.b64encode(cb.getvalue()).decode(),
                  normal='data:image/webp;base64,'+base64.b64encode(nb.getvalue()).decode(),
                  animationContract=dict(version=1, gearAxes=['gear_main', 'gear_nose', 'gear_main_doors', 'gear_nose_door'],
                                         aeroStateSlots={'gear_main':36, 'gear_main_doors':37, 'gear_nose':38, 'gear_nose_door':39},
                                         sequenceConfiguration={'mode':1,'mainSec':3,'noseSec':3,'mainDoorsSec':1,'noseOpenSec':.75,'noseCloseSec':1},
                                         gearValues='0 retracted/closed; 1 down/open; independent sequencing required',
                                         controls='roll/pitch/yaw signed -1..1 with neutral0; flap/slat/canopy0..1',
                                         slatAuthority='visual only, aerodynamic slat effect not implemented'),
                  weaponContract=dict(gunKind=gun_kind, gunSockets=gun_sockets,
                                      sourceMuzzles={gun_kind:[sockets[n] for n in gun_sockets]},
                                      sourceStores=[n for n in sockets if 'R4M' in n or 'BombRelease' in n],
                                      authoritativeFeedsPending=True))
    output.mkdir(parents=True, exist_ok=True)
    target = output / f'{type_id}.json'; target.write_text(json.dumps(record, separators=(',', ':'))+'\n')
    audit = dict(type=type_id, native_sha256=sha(target.read_bytes()), source_glb_sha256=sha(path.read_bytes()),
                 source_triangles=sum(n['triangles'] for n in nodes), encoded_triangles=sum(p['triangles'] for p in recs),
                 rendered_airframe_triangles=sum(p['triangles'] for p in recs if p['group'] not in ('source_excluded', 'internal', 'crew', 'store', 'mount')),
                 group_triangles={x: sum(p['triangles'] for p in recs if p['group'] == x) for x in sorted({p['group'] for p in recs})},
                 face_ledger=face_ledger, source_nodes=nodes, source_sockets=sockets,
                 nose_door_repair=door_audit, wheel_contacts=contacts,
                 optics_registration=calibration, mount_geometry_repair=mount_audit,
                 limitations=['CPU/actual Aircraft posed geometry verification still required',
                              'Root must integrate custom independent gear axes and individual store visibility',
                              'Source internal anatomy is declared schematic/envelopes, not historical engineering CAD',
                              'Visual source meshes do not switch accepted combat contacts to triangles',
                              'Eye and complete Revi assembly calibration pending source seat/panel review'])
    (output / f'{type_id}-ledger.json').write_text(json.dumps(audit, indent=2)+'\n')
    if corrected_output:
        audit['corrected_glb'] = corrected_glb(g, repaired, exclusions, corrected_output / path.name, calibration, cg)
        (output / f'{type_id}-ledger.json').write_text(json.dumps(audit, indent=2)+'\n')
    print(type_id, target.stat().st_size, audit['native_sha256'], audit['group_triangles'])
    return record, audit


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('archive', type=Path); ap.add_argument('--output', type=Path, required=True)
    ap.add_argument('--cg', nargs=3, type=float, default=[0, 0, 0])
    ap.add_argument('--optics', type=Path, help='Root-reviewed whole-Revi assemblyOffset and absolute eye, both in game frame')
    ap.add_argument('--corrected-glb-output', type=Path, help='Optional independent repaired GLBs, original archive is untouched')
    args = ap.parse_args()
    if sha(args.archive.read_bytes()) != ZIP_SHA:
        raise ValueError('Archive hash mismatch; this importer accepts only the reviewed source')
    calibration = json.loads(args.optics.read_text()) if args.optics else None
    if calibration:
        for key in ('assemblyOffset', 'eye'):
            if np.asarray(calibration[key]).shape != (3,) or not np.isfinite(calibration[key]).all():
                raise ValueError('Invalid optics calibration: ' + key)
    with tempfile.TemporaryDirectory(prefix='tf-me262-') as tmp:
        root = Path(tmp)
        with zipfile.ZipFile(args.archive) as z:
            for member in z.namelist():
                if '/models/' in member and member.endswith('.glb'):
                    (root / Path(member).name).write_bytes(z.read(member))
        for type_id, (file, designation, guns) in VARIANTS.items():
            import_variant(root/file, type_id, designation, guns, args.output, np.array(args.cg, float), calibration, args.corrected_glb_output)
        if args.corrected_glb_output:
            # The game's A-1a uses the R4M-capable shared source geometry with
            # individual stores hidden by accepted inventory. Also return the
            # archive's plain A-1a GLB, repaired independently for user review.
            g = Gltf(root/'me262_a1a.glb'); repaired, _ = repair_nose_doors(g); repair_mount(g, repaired, calibration)
            W = g.world(); i = next(i for i,n in enumerate(g.nodes) if n.get('name') == 'EXT_SurfaceFittings')
            pr = g.primitives(i,W[i])[0]
            corrected_glb(g, repaired, [(i,0,thin_strip_ids(pr['P'],pr['I']))], args.corrected_glb_output/'me262_a1a.glb', calibration, np.array(args.cg,float))


if __name__ == '__main__':
    main()
