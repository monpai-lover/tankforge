#!/usr/bin/env python3
"""Measure gun/panel clearance from the preserved real triangle geometry.

Collision samples use all edges of every visible traversing/elevating gun piece,
the convex source panel outlines and 25 mm clearance. Panels are measured at
quarter stages, with dense 1/16 fold checks before an interval is released.
"""
import json
import pathlib
import tempfile

import numpy as np

from repair_folding_flaps import source_file, mk103_panels, m46_panels, hull2, dump
from repair_bmp_k64 import ROOT, pieces
from gltf_util import load
from gltf_util import scene_meshes


def axis_rotation(axis, angle):
    x, y, z = axis
    c, s, t = np.cos(angle), np.sin(angle), 1 - np.cos(angle)
    return np.array([[c+x*x*t, x*y*t-z*s, x*z*t+y*s],
                     [y*x*t+z*s, c+y*y*t, y*z*t-x*s],
                     [z*x*t-y*s, z*y*t+x*s, c+z*z*t]])


def panel_shape(panel):
    h = panel['hinge']
    a, b = np.asarray(h['a']), np.asarray(h['b'])
    u = b - a
    u /= np.linalg.norm(u)
    points = np.asarray(panel['surface'])
    upper = points[np.argmax(points[:, 1])]
    n = np.cross(u, upper - a)
    n /= np.linalg.norm(n)
    v = np.cross(n, u)
    plane = points.mean(0)
    q = hull2(np.column_stack(((points - plane) @ u, (points - plane) @ v)))
    return {'a': a, 'angle': h['angle'], 'u': u, 'n': n, 'v': v, 'plane': plane, 'q': q}


def collision(segments, shapes, fold, clearance=.025):
    slo = np.minimum(segments[:, 0], segments[:, 1])
    shi = np.maximum(segments[:, 0], segments[:, 1])
    for p in shapes:
        r = axis_rotation(p['u'], np.deg2rad(p['angle'] * fold))
        n, u, v = (p[k] @ r.T for k in ('n', 'u', 'v'))
        origin = (p['plane'] - p['a']) @ r.T + p['a']
        corners = origin + p['q'][:, :1] * u + p['q'][:, 1:] * v
        pl, ph = corners.min(0) - clearance, corners.max(0) + clearance
        broad = ((slo <= ph) & (shi >= pl)).all(1)
        if not broad.any():
            continue
        candidate = segments[broad]
        d = (candidate - origin) @ n
        mask = (np.minimum(d[:, 0], d[:, 1]) <= clearance) & (np.maximum(d[:, 0], d[:, 1]) >= -clearance)
        if not mask.any():
            continue
        seg, dist = candidate[mask], d[mask]
        delta = dist[:, 0] - dist[:, 1]
        t = np.clip(dist[:, 0] / np.where(abs(delta) > 1e-9, delta, 1), 0, 1)
        point = seg[:, 0] + (seg[:, 1] - seg[:, 0]) * t[:, None]
        q = np.column_stack(((point - origin) @ u, (point - origin) @ v))
        inside = np.ones(len(q), bool)
        for k, a in enumerate(p['q']):
            b = p['q'][(k + 1) % len(p['q'])]
            edge = b - a
            cross = edge[0] * (q[:, 1] - a[1]) - edge[1] * (q[:, 0] - a[0])
            inside &= cross >= -clearance * np.linalg.norm(edge)
        if inside.any():
            return True
    return False


def gun_segments(model):
    out = {'turret': [], 'gun': []}
    for p, pos, nor, uv, idx in pieces(model):
        kind = 'turret' if p['mount'] == 'turret' else 'gun' if p['mount'] in ('gun', 'barrel') else None
        if kind is None:
            continue
        tri = pos[idx]
        out[kind].append(np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]]))
    return {k: np.unique(np.concatenate(v).reshape(-1, 6), axis=0).reshape(-1, 2, 3) for k, v in out.items()}


def pose(segments, pivot, mount, yaw, depression):
    r = axis_rotation([0, 1, 0], np.deg2rad(yaw))
    g = axis_rotation([1, 0, 0], np.deg2rad(depression))
    fixed = (segments['turret'] - pivot) @ r.T + pivot
    moving = ((segments['gun'] - mount) @ g.T + mount - pivot) @ r.T + pivot
    return fixed, moving


def verify_m46_storage(panels):
    """The retained side rack must clear every board, the running gear and crew."""
    vdir = ROOT / 'data/vehicles/su_att_m46'
    model = json.loads((vdir / 'model.json').read_text())
    tool = []
    for part, pos, _, _, idx in pieces(model):
        if part.get('source_node') == 'front_stowed_tool':
            tri = pos[idx]
            tool.append(np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]]))
    tool = np.concatenate(tool)
    _, binary = source_file('m46')
    gear = []
    with tempfile.TemporaryDirectory() as task_tmp:
        source = pathlib.Path(task_tmp) / 'source.glb'
        source.write_bytes(binary)
        j, accessor, _ = load(source)
        for _, _, pos, _, _, idx, names in scene_meshes(j, accessor, with_nodes=True):
            if not any(name.startswith(('Track_', 'Wheel_')) for name in names):
                continue
            tri = pos[:, [2, 1, 0]][idx]
            gear.append(np.concatenate([tri[:, [0, 1]], tri[:, [1, 2]], tri[:, [2, 0]]]))
    gear = np.concatenate(gear)
    shapes = [panel_shape(p) for p in panels.values()]
    crew = json.loads((vdir / 'crew.json').read_text())
    for fold in np.linspace(0, 1, 65):
        for title, edges in [('tool/frame/chain', tool), ('source tracks and wheels', gear)]:
            if collision(edges, shapes, float(fold)):
                raise AssertionError(f'M46 {title} touches a panel at fold {fold}')
        for person in crew:
            center = np.array([person['pos'][k] for k in 'xyz'])
            radius = person['radius'] + .025
            for panel in shapes:
                r = axis_rotation(panel['u'], np.deg2rad(panel['angle'] * fold))
                n, u, v = (panel[k] @ r.T for k in ('n', 'u', 'v'))
                origin = (panel['plane'] - panel['a']) @ r.T + panel['a']
                d = center - origin
                if abs(d @ n) > radius:
                    continue
                q = np.array([d @ u, d @ v])
                inside = True
                for k, a in enumerate(panel['q']):
                    edge = panel['q'][(k + 1) % len(panel['q'])] - a
                    inside &= edge[0] * (q[1] - a[1]) - edge[1] * (q[0] - a[0]) >= -radius * np.linalg.norm(edge)
                if inside:
                    raise AssertionError(f'M46 {person["role"]} touches a panel at fold {fold}')
    tool_lo = tool.reshape(-1, 3).min(0)
    tool_hi = tool.reshape(-1, 3).max(0)
    gear_hi = gear.reshape(-1, 3).max(0)
    assert tool_lo[0] - gear_hi[0] > .025, 'right-side tool remains outside all source running gear'
    return {'result': 'PASS', 'clearance_m': .025, 'fold_samples': 65,
            'panel_count': len(panels), 'tool_triangles': len(tool) // 3,
            'tool_bounds_m': [tool_lo.tolist(), tool_hi.tolist()],
            'method': 'Every retained tool/frame/chain and source wheel/track triangle edge against six convex panel outlines; each crew collision sphere expanded by 25 mm',
            'tool_to_running_gear_lateral_gap_m': float(tool_lo[0] - gear_hi[0]),
            'hinge_source': 'Cab_Cut_Down lower painted edges; Rear_Bed lower board edges, with fixed lower keepers retained'}


def probe(vid, panels):
    vdir = ROOT / 'data/vehicles' / vid
    model = json.loads((vdir / 'model.json').read_text())
    vehicle = json.loads((vdir / 'vehicle.json').read_text())
    weapons = json.loads((vdir / 'weapons.json').read_text())
    segments = gun_segments(model)
    print(vid, 'gun segments', {k: len(v) for k, v in segments.items()}, flush=True)
    shapes = [panel_shape(p) for p in panels.values()]
    pivot, mount = np.asarray(vehicle['turret']['position_m']), np.asarray(weapons['mount_m'])
    cache = {}
    def safe(fold, yaw, depression):
        key = (fold, yaw, depression)
        if key not in cache:
            fixed, moving = pose(segments, pivot, mount, yaw, depression)
            cache[key] = not (collision(fixed, shapes, fold) or collision(moving, shapes, fold))
        return cache[key]
    max_dep = 2.5 if vid == 'su_att_m46' else 10
    stages = []
    for fold in [0, .25, .5, .75, 1]:
        row = []
        for yaw in range(0, 360, 10):
            # Start within the source gun's usable depression; permit signed
            # minima where a sloped flap temporarily lifts during movement.
            cap = min(max_dep, 5) if fold == 0 else max_dep
            candidates = np.arange(cap, -15.01, -.5)
            found = next((float(d) for d in candidates if safe(fold, yaw, float(d))), -15.)
            row.append(found)
        stages.append({'fold': fold, 'angles': row})
        print(vid, fold, row, flush=True)
    # Validate the conservative intersection used by the runtime, including
    # intermediate bearings. Lower the earlier stage if a panel reaches a
    # higher point between its endpoints.
    for k in range(4):
        a, b = stages[k], stages[k + 1]
        for i in range(36):
            dep = min(a['angles'][i], b['angles'][i], a['angles'][(i+1)%36], b['angles'][(i+1)%36])
            folds = np.linspace(a['fold'], b['fold'], 5)
            yaws = [i * 10, i * 10 + 5, i * 10 + 10]
            while dep > -15 and any(not safe(float(f), y, dep) for f in folds for y in yaws):
                dep -= .5
            if dep < min(a['angles'][i], b['angles'][i]):
                a['angles'][i] = min(a['angles'][i], dep)
    weapons.update(depression_by_bearing_deg=stages[0]['angles'], folded_depression_by_bearing_deg=stages[-1]['angles'],
                   fold_depression_stages=stages)
    if vid == 'su_att_m46':
        yaw_stages = []
        for fold in [0, .25, .5, .75, 1]:
            limit = 25 if fold == 0 else 90
            # A traversing shield also has to clear the bed boards, regardless
            # of barrel elevation. Keep a connected safe interval about forward.
            allowed = 0
            for yaw in range(0, limit + 1, 5):
                if not all(safe(fold, sign * yaw, 0) for sign in [-1, 1]):
                    break
                allowed = yaw
            yaw_stages.append({'fold': fold, 'limits': [-allowed, allowed]})
        weapons['folded_yaw_limit_deg'] = yaw_stages[-1]['limits']
        weapons['fold_yaw_limit_stages'] = yaw_stages
        print('M46 yaw', yaw_stages, flush=True)
    else:
        weapons['main_gun']['max_depression_deg'] = 10
    dump(vdir / 'weapons.json', weapons)
    receipt = json.loads((vdir / 'folding-source.json').read_text())
    receipt.update(clearance_m=.025, fold_depression_stages=stages,
                   folded_yaw_limit_deg=weapons.get('folded_yaw_limit_deg'),
                   fold_yaw_limit_stages=weapons.get('fold_yaw_limit_stages'),
                   clearance_method='All preserved weapon triangle edges against convex source panel outlines; 1/16 fold and 5 degree bearing checks')
    dump(vdir / 'folding-source.json', receipt)


def finalize_limits(vid, panels):
    """Bound unreachable fixed-mount bearings, then verify actual interval limits."""
    vdir = ROOT / 'data/vehicles' / vid
    model = json.loads((vdir / 'model.json').read_text())
    vehicle = json.loads((vdir / 'vehicle.json').read_text())
    w = json.loads((vdir / 'weapons.json').read_text())
    segments = gun_segments(model)
    shapes = [panel_shape(p) for p in panels.values()]
    pivot, mount = np.asarray(vehicle['turret']['position_m']), np.asarray(w['mount_m'])
    limits = []
    stages = w['fold_depression_stages']
    for stage in stages:
        fold = stage['fold']
        maximum = 25 if vid == 'su_att_m46' and fold == 0 else 90 if vid == 'su_att_m46' else 180
        ends = []
        for sign in [-1, 1]:
            allowed = 0
            for yaw in range(0, maximum + 1, 5):
                fixed, _ = pose(segments, pivot, mount, sign * yaw, 0)
                if collision(fixed, shapes, fold):
                    break
                allowed = yaw
            ends.append(sign * allowed)
        limits.append({'fold': fold, 'limits': ends})
        for i, value in enumerate(stage['angles']):
            yaw = i * 10 if i <= 18 else i * 10 - 360
            if not ends[0] <= yaw <= ends[1]:
                # This bearing is mechanically gated by the real fixed mount;
                # no sentinel elevation is permitted to bypass that gate.
                stage['angles'][i] = 2.5 if vid == 'su_att_m46' else (5 if fold == 0 else 10)
            else:
                cap = 2.5 if vid == 'su_att_m46' else 5 if fold == 0 else 10
                resolved = None
                for dep in np.arange(cap, -14.01, -.5):
                    fixed, gun = pose(segments, pivot, mount, yaw, float(dep))
                    if not (collision(fixed, shapes, fold) or collision(gun, shapes, fold)):
                        resolved = float(dep)
                        break
                if resolved is None:
                    raise SystemExit(f'{vid}: unresolved source collision at fold {fold}, bearing {yaw}')
                stage['angles'][i] = resolved
    def table_at(row, yaw):
        offset = (yaw % 360) / 10
        i = int(offset)
        return row[i] + (row[(i + 1) % 36] - row[i]) * (offset - i)
    for k in range(4):
        a, b = stages[k], stages[k + 1]
        low = max(limits[k]['limits'][0], limits[k+1]['limits'][0])
        high = min(limits[k]['limits'][1], limits[k+1]['limits'][1])
        for yaw in np.arange(low, high + .01, 5):
            dep = min(table_at(a['angles'], yaw), table_at(b['angles'], yaw))
            for fold in np.linspace(a['fold'], b['fold'], 5):
                fixed, gun = pose(segments, pivot, mount, float(yaw), dep)
                if collision(fixed, shapes, float(fold)):
                    # Limit the complete interval, not just its endpoints.
                    if yaw >= 0:
                        limits[k]['limits'][1] = min(limits[k]['limits'][1], float(yaw - 5))
                    else:
                        limits[k]['limits'][0] = max(limits[k]['limits'][0], float(yaw + 5))
                    break
                while collision(gun, shapes, float(fold)) and dep > -14:
                    dep -= .5
                    _, gun = pose(segments, pivot, mount, float(yaw), dep)
                i = int((yaw % 360) // 10)
                if dep < min(table_at(a['angles'], yaw), table_at(b['angles'], yaw)):
                    a['angles'][i] = min(a['angles'][i], dep)
                    a['angles'][(i + 1) % 36] = min(a['angles'][(i + 1) % 36], dep)
        print(vid, 'safe interval', a['fold'], b['fold'], limits[k]['limits'], flush=True)
    w.update(depression_by_bearing_deg=stages[0]['angles'], folded_depression_by_bearing_deg=stages[-1]['angles'],
             fold_depression_stages=stages, fold_yaw_limit_stages=limits,
             folded_yaw_limit_deg=limits[-1]['limits'], yaw_limit_deg=limits[0]['limits'])
    dump(vdir / 'weapons.json', w)
    receipt = json.loads((vdir / 'folding-source.json').read_text())
    receipt.update(fold_depression_stages=stages, fold_yaw_limit_stages=limits, folded_yaw_limit_deg=limits[-1]['limits'],
                   unsafe_fixed_mount_policy='Bearings where original traverse hardware intersects a raised panel are gated; no sentinel elevation bypass')
    if vid == 'su_att_m46':
        receipt['storage_sweep_clearance'] = verify_m46_storage(panels)
    dump(vdir / 'folding-source.json', receipt)
    print(vid, 'FINAL yaw', limits, flush=True)


def main():
    for kind, ids in [('m46', ['su_att_m46']), ('mk103', ['de_hetzer_mk103', 'de_hetzer_mk103_camo'])]:
        archive, binary = source_file(kind)
        with tempfile.TemporaryDirectory() as task_tmp:
            p = pathlib.Path(task_tmp) / 'source.glb'
            p.write_bytes(binary)
            j, accessor, _ = load(p)
            panels = m46_panels(j, accessor) if kind == 'm46' else mk103_panels(j, accessor)
        for vid in ids:
            if '--finalize' not in __import__('sys').argv:
                probe(vid, panels)
            finalize_limits(vid, panels)


if __name__ == '__main__':
    main()
