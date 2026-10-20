#!/usr/bin/env python3
"""VK 30.02 (DB) armour plates (armor.json) fitted to the user's surface-hitbox reference.

    python3 tools/vk3002_plates.py MANIFEST.json HITBOX.bin data/vehicles/de_vk3002_db/armor.json

The reference (VK3002_DB_armor_v1_4.html, schema tankforge.reference.surface-hitbox/1.0) gives every
collision triangle a region (51: armour plates, hatches and covers, modules, fittings) and flags
(1 physical contact, 2 nominal armour-sheet candidate). For each region marked applyAsArmor its
sheet-candidate triangles (else its physical ones) are placed in the vehicle frame at rest (turret
yaw and gun elevation 0: the nodes only translate), grouped by facing (within 20 deg) and cut into
connected pieces (faces sharing a vertex), and every piece of at least 0.02 m2 becomes a plate: the area-weighted centre and normal, the in-plane axis
of largest spread, and half sizes reaching the group's vertices. Only the face of a group that
looks away from the hull's (or the turret's) middle is kept, so a double-sided sheet is one plate.
The thickness is the region's nominal one (the reference's sources and confidence carry over in
'source'); plates of turret parts get turret zones, which the game turns with the turret.
"""
import json, math, struct, sys

ZONES = {  # region -> the core's armour zone (turret_* and gun_mantlet traverse with the turret)
    'hull_front_upper': 'hull_upper_front', 'driver_cover': 'hull_upper_front', 'hull_front_lower': 'hull_lower_front',
    'hull_side_upper_left': 'hull_side', 'hull_side_upper_right': 'hull_side', 'hull_side_lower_left': 'hull_side',
    'hull_side_lower_right': 'hull_side', 'hull_hatch_left': 'hull_side', 'hull_hatch_right': 'hull_side',
    'hull_rear_upper': 'hull_rear', 'hull_rear_lower': 'hull_rear', 'rear_cover_left': 'hull_rear', 'rear_cover_right': 'hull_rear',
    'hull_roof': 'hull_roof', 'engine_service': 'hull_roof', 'hull_belly': 'hull_floor', 'sponson_floor': 'hull_floor',
    'turret_front': 'turret_front', 'turret_side_left': 'turret_side', 'turret_side_right': 'turret_side',
    'turret_hatch_left': 'turret_side', 'turret_hatch_right': 'turret_side', 'turret_rear': 'turret_rear',
    'turret_rear_plug': 'turret_rear', 'turret_roof': 'turret_roof', 'turret_roof_cover': 'turret_roof',
    'turret_floor': 'turret_roof', 'turret_ring': 'turret_side', 'cupola_wall': 'turret_side', 'cupola_lid': 'turret_roof',
    'mantlet': 'gun_mantlet', 'gun_socket': 'gun_mantlet', 'mantlet_pivot': 'gun_mantlet',
}
TURRET_NODES = {'Turret_Yaw', 'Turret_Fittings', 'Cupola_Hatch', 'Gun_Socket', 'Gun_Elevation'}


def sub(a, b): return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
def dot(a, b): return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
def cross(a, b): return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
def norm(a):
    l = math.sqrt(dot(a, a)) or 1.0
    return [a[0] / l, a[1] / l, a[2] / l]


def main(manifest_path, bin_path, out_path):
    m = json.load(open(manifest_path))
    data = open(bin_path, 'rb').read()
    nodes = m['nodes']

    def origin(i):  # world translation of a node (translation-only hierarchy)
        o = [0.0, 0.0, 0.0]
        while i is not None:
            t = nodes[i].get('translation', [0, 0, 0])
            o = [o[0] + t[0], o[1] + t[1], o[2] + t[2]]
            i = nodes[i].get('parent')
        return o
    regions = {r['index']: r for r in m['regions']}
    tris = {}  # region index -> [(a, b, c, turret, sheet)]
    for col in m['colliders']:
        A = col['arrays']
        o = origin(col['nodeIndex'])
        turret = nodes[col['nodeIndex']]['name'] in TURRET_NODES
        pos = struct.unpack_from('<%df' % (A['positions']['count'] * 3), data, A['positions']['byteOffset'])
        idx = struct.unpack_from('<%dI' % (A['triangles']['count'] * 3), data, A['triangles']['byteOffset'])
        rid = struct.unpack_from('<%dH' % A['regionIds']['count'], data, A['regionIds']['byteOffset'])
        flg = data[A['flags']['byteOffset']:A['flags']['byteOffset'] + A['flags']['count']]
        P = lambda k: [pos[k * 3] + o[0], pos[k * 3 + 1] + o[1], pos[k * 3 + 2] + o[2]]
        for t in range(A['triangles']['count']):
            if not flg[t] & 1:
                continue
            tris.setdefault(rid[t], []).append((P(idx[t * 3]), P(idx[t * 3 + 1]), P(idx[t * 3 + 2]), turret, bool(flg[t] & 2)))
    plates = []
    for ri, r in sorted(regions.items()):
        if not r.get('applyAsArmor') or not tris.get(ri):
            continue
        ts = tris[ri]
        sheet = [t for t in ts if t[4]] or ts
        turret = sum(1 for t in sheet if t[3]) * 2 > len(sheet)
        mid = [0.0, 2.15, 0.32] if turret else [0.0, 1.2, 0.0]
        faces = []
        for a, b, c, _, _ in sheet:
            n = cross(sub(b, a), sub(c, a))
            area = math.sqrt(dot(n, n)) / 2
            if area < 1e-7:
                continue
            g = [(a[k] + b[k] + c[k]) / 3 for k in range(3)]
            faces.append((norm(n), area, g, (a, b, c)))
        groups = []  # greedy by facing, largest faces first
        for f in sorted(faces, key=lambda f: -f[1]):
            for gr in groups:
                if dot(gr['n'], f[0]) > math.cos(math.radians(20)):
                    gr['f'].append(f)
                    s = [gr['n'][k] * gr['a'] + f[0][k] * f[1] for k in range(3)]
                    gr['a'] += f[1]
                    gr['n'] = norm(s)
                    break
            else:
                groups.append({'n': f[0], 'a': f[1], 'f': [f]})
        # each facing group cut into its connected pieces (faces sharing a vertex): the left and the
        # right sponson floors face the same way but are two plates, not one across the belly
        pieces = []
        for gr in groups:
            key = lambda v: (round(v[0], 3), round(v[1], 3), round(v[2], 3))
            parent = list(range(len(gr['f'])))
            def find(i):
                while parent[i] != i:
                    parent[i] = parent[parent[i]]
                    i = parent[i]
                return i
            owner = {}
            for i, f in enumerate(gr['f']):
                for v in f[3]:
                    j = owner.setdefault(key(v), i)
                    parent[find(i)] = find(j)
            comp = {}
            for i, f in enumerate(gr['f']):
                comp.setdefault(find(i), []).append(f)
            for fs in comp.values():
                a = sum(f[1] for f in fs)
                pieces.append({'n': norm([sum(f[0][k] * f[1] for f in fs) for k in range(3)]), 'a': a, 'f': fs})
        groups = pieces
        # the outward face of each sheet: a group facing in toward the middle is that sheet's inner side
        kept = []
        for gr in groups:
            c = [sum(f[2][k] * f[1] for f in gr['f']) / gr['a'] for k in range(3)]
            gr['c'] = c
            if gr['a'] >= 0.02 and dot(gr['n'], sub(c, mid)) > 0:
                kept.append(gr)
        kept.sort(key=lambda g: -g['a'])
        for gi, gr in enumerate(kept):
            n, c = gr['n'], gr['c']
            verts = [v for f in gr['f'] for v in f[3]]
            # in-plane axis of largest spread (2D principal axis of the projected vertices)
            e1 = norm(cross(n, [0, 1, 0])) if abs(n[1]) < 0.9 else norm(cross(n, [1, 0, 0]))
            e2 = cross(n, e1)
            pts = [(dot(sub(v, c), e1), dot(sub(v, c), e2)) for v in verts]
            sxx = sum(p[0] * p[0] for p in pts); syy = sum(p[1] * p[1] for p in pts); sxy = sum(p[0] * p[1] for p in pts)
            th = 0.5 * math.atan2(2 * sxy, sxx - syy)
            u = norm([e1[k] * math.cos(th) + e2[k] * math.sin(th) for k in range(3)])
            v = cross(n, u)
            us = [dot(sub(p, c), u) for p in verts]; vs = [dot(sub(p, c), v) for p in verts]
            # centre on the box the vertices span (the area centroid can sit off a trapezoid's middle)
            du, dv = (max(us) + min(us)) / 2, (max(vs) + min(vs)) / 2
            c = [c[k] + u[k] * du + v[k] * dv for k in range(3)]
            r6 = lambda x: round(x, 4)
            plates.append({
                'id': r['id'] if gi == 0 else f"{r['id']}_{gi + 1}", 'zone': ZONES.get(r['id'], 'other'),
                'material': 'rha', 'thickness_mm': r['nominalThicknessMm'],
                'center': dict(zip('xyz', map(r6, c))), 'normal': dict(zip('xyz', map(r6, n))), 'axis_u': dict(zip('xyz', map(r6, u))),
                'half_u': r6((max(us) - min(us)) / 2), 'half_v': r6((max(vs) - min(vs)) / 2),
                'source': f"reference region {r['id']} ({r.get('label', '')}): {r.get('thicknessBasis')}, confidence {r.get('confidence')}",
            })
    json.dump(plates, open(out_path, 'w'), indent=1, ensure_ascii=False)
    print(len(plates), 'plates')
    for p in plates:
        print(f"  {p['id']:24} {p['zone']:17} {p['thickness_mm']:>4} mm  n={tuple(p['normal'].values())}  {2 * p['half_u']:.2f} x {2 * p['half_v']:.2f} m")


if __name__ == '__main__':
    main(*sys.argv[1:4])
