"""Bounded hull/detail repairs for the original procedural builders.

Each helper mutates and returns a source spec and performs no file I/O. Fold
stops and tiny fittings are engineering adaptations to the existing model;
their exact dimensions have not been independently measured from factory plans.
"""

import math
import copy


def _named_part(parts, name, part):
    old = next((p for p in parts if p.get('name') == name), None)
    if old is None:
        parts.append(dict(part, name=name))
    else:
        old.clear()
        old.update(part, name=name)


def apply_flak38t_fold_clearance(spec):
    """Separate the deck-facing front board stop from the outward side boards.

    Praga's folded Sd.Kfz.140 photo shows the side boards beside the fixed lower
    walls and the front board above the engine deck. It does not establish a
    universal horizontal platform or exact stop angles. The 116 degree front
    rotation is bounded by this model's deck, with the other original 168 degree
    rotations retained. An antenna is moved forward on the same engine deck and
    the aft can moved lower onto a small bracket outside the rear wall.
    """
    if spec['id'] != 'de_flakpz38t' or spec.get('model'):
        return spec
    parts = spec['parts']
    boards = [p for p in parts if p.get('hinge')]
    if len(boards) != 8:
        raise ValueError('Flak38(t) repair expects eight original upper boards')
    for index, board in enumerate(boards):
        board['name'] = f'flak38t_upper_board_{index}'
        # Board 6 is the long straight front edge, distinct from both chamfers.
        board['hinge']['angle'] = 116 if index == 6 else 168
    for p in parts:
        if p.get('mount') != 'hull':
            continue
        if p['type'] == 'cyl' and p.get('axis') == 'y' and p.get('r') in (.04, .007) and p['pos'][0] == -.55:
            p['pos'][2] = .80
            p['name'] = 'flak38t_antenna_base' if p['r'] == .04 else 'flak38t_antenna'
        if p['type'] == 'box' and p.get('size') == [.14, .38, .24] and p.get('rot') == [0.0, 35.0, 0.0]:
            p['pos'] = [.86, .95, -2.46]
            p['name'] = 'flak38t_rear_can'
    _named_part(parts, 'flak38t_rear_can_bracket', {
        'type': 'box', 'mount': 'hull', 'mat': 'paint_dark',
        'size': [.22, .035, .37], 'pos': [.77, .84, -2.32],
    })
    return spec


def _dt_barrel(x, y, rear, mouth):
    """Tiny open tube; hull weapons do not use the main-gun bore renderer rule."""
    n, outer, bore = 12, .016, .00381
    vertices = []
    for z, radius in ((rear, outer), (mouth, outer), (rear, bore), (mouth, bore)):
        for i in range(n):
            a = 2 * math.pi * i / n
            vertices.append([round(x + radius * math.cos(a), 4),
                             round(y + radius * math.sin(a), 4), round(z, 4)])
    faces = []
    for i in range(n):
        j = (i + 1) % n
        faces.extend(([i, j, n+j, n+i], [2*n+i, 3*n+i, 3*n+j, 2*n+j],
                      [n+i, n+j, 3*n+j, 3*n+i], [i, 2*n+i, 2*n+j, j]))
    return {'type': 'mesh', 'mount': 'hull', 'mat': 'steel',
            'vertices': vertices, 'faces': faces}


def apply_is2_hull_mg(spec):
    """Fit the fixed DT beside the right ring shoulder, not the central glacis.

    Factory #200's 1944 sketch (CAMD RF 38-11355-2245 pp.240-241) establishes
    the right shoulder opening. This bounded fit uses the current side surface;
    its x/y/z are not claimed as measurements of that sketch. The small dark
    opening and tube stay separate from the original hull envelope and armor.
    """
    if spec['id'] != 'su_is2' or spec.get('model'):
        return spec
    parts = spec['parts']
    old = next((p for p in parts if p.get('name') == 'is2_shoulder_dt_barrel' or
                (p['type'] == 'cyl' and p.get('mount') == 'hull' and p.get('axis') == 'z'
                 and p.get('r') == .02 and p.get('len') == .2 and p.get('pos') == [.6, 1.28, 2.78])), None)
    if old is None:
        raise ValueError('IS-2 repair cannot identify the original fixed DT barrel')
    old.clear()
    old.update(_dt_barrel(1.335, 1.49, 1.405, 1.605), name='is2_shoulder_dt_barrel')
    _named_part(parts, 'is2_shoulder_dt_opening', {
        'type': 'cyl', 'mount': 'hull', 'mat': 'black', 'r': .031,
        'axis': 'z', 'len': .025, 'pos': [1.335, 1.49, 1.4], 'segs': 12,
    })
    mg = next(m for m in spec['secondary'] if m['id'] == 'bow_dt')
    # The existing hull-MG path adds .30m from this data pivot to its fire mouth.
    mg['position_m'] = [1.335, 1.49, 1.305]
    return spec


def apply_rso_drive_roles(spec):
    """RSO/01-family rear drive and toothed front tensioner, same wheel axes.

    The 1945 Ordnance catalog describes the shaft/reduction gearing driving the
    rear end. PaK40/4 sources confirm that same chassis arrangement. Retain the
    independently authored end-wheel heights and radii; tooth count remains the
    original renderer estimate, not a newly established historical measurement.
    """
    if spec['id'] not in ('de_rso_flak', 'de_rso_pak40') or spec.get('model'):
        return spec
    rg = spec['running_gear']
    if rg['sprocket']['z'] > rg['idler']['z']:
        front, rear = dict(rg['sprocket']), dict(rg['idler'])
        rear['teeth'] = front.get('teeth', 12)
        front['teeth'] = rear['teeth']
        rg['sprocket'], rg['idler'] = rear, front
    else:
        rg['idler']['teeth'] = rg['sprocket'].get('teeth', 12)
    return spec


def _thin_polygon(points, offset):
    """Closed thin panel with its front/back/edge faces wound outwards."""
    n = len(points)
    vertices = [[round(v, 4) for v in p] for p in points]
    vertices += [[round(v + offset[k], 4) for k, v in enumerate(p)] for p in points]
    faces = [list(range(n)), list(reversed(range(n, n * 2)))]
    faces += [[i, (i + 1) % n, (i + 1) % n + n, i + n] for i in range(n)]
    center = [sum(p[k] for p in points) / n + offset[k] / 2 for k in range(3)]
    for face in faces:
        normal = [0., 0., 0.]
        for i, index in enumerate(face):
            a, b = vertices[index], vertices[face[(i + 1) % len(face)]]
            normal[0] += (a[1] - b[1]) * (a[2] + b[2])
            normal[1] += (a[2] - b[2]) * (a[0] + b[0])
            normal[2] += (a[0] - b[0]) * (a[1] + b[1])
        centroid = [sum(vertices[i][k] for i in face) / len(face) for k in range(3)]
        if sum(normal[k] * (centroid[k] - center[k]) for k in range(3)) < 0:
            face.reverse()
    return {'vertices': vertices, 'faces': faces}


def _roof_regions(holes, half_width, rear, front):
    """Seven rectangles cover the roof around the two retained lid footprints."""
    regions, cursor = [], -half_width
    for h in sorted(holes, key=lambda h: h['x0']):
        if h['x0'] > cursor:
            regions.append((cursor, h['x0'], rear, front))
        if h['z0'] > rear:
            regions.append((h['x0'], h['x1'], rear, h['z0']))
        if h['z1'] < front:
            regions.append((h['x0'], h['x1'], h['z1'], front))
        cursor = h['x1']
    if cursor < half_width:
        regions.append((cursor, half_width, rear, front))
    return regions


def _rso_open_cab(cab, regions):
    profile = cab['profile']
    low, high = min(p[1] for p in profile), max(p[1] for p in profile)
    def corner(z, y, side):
        half = (cab['w'] + (cab['wt'] - cab['w']) * ((y - low) / (high - low))) / 2
        return [side * half, y, z]
    panels = [_thin_polygon([corner(z, y, side) for z, y in profile], [-side * .003, 0, 0])
              for side in (1, -1)]
    for i, (z, y) in enumerate(profile):
        zz, yy = profile[(i + 1) % len(profile)]
        if y == yy == high:
            continue  # replace continuous roof with the frame around both wells
        dz, dy = zz - z, yy - y
        length = math.hypot(dz, dy)
        panels.append(_thin_polygon([corner(z, y, -1), corner(z, y, 1),
                                     corner(zz, yy, 1), corner(zz, yy, -1)],
                                    [0, -abs(dz) / length * .003,
                                     -math.copysign(abs(dy) / length * .003, dy)]))
    panels += [_thin_polygon([[x0, high, z0], [x1, high, z0],
                              [x1, high, z1], [x0, high, z1]], [0, -.003, 0])
               for x0, x1, z0, z1 in regions]
    out = {'name': 'rso_pak40_open_cab', 'type': 'mesh', 'mount': 'hull', 'mat': cab['mat'],
           'vertices': [], 'faces': []}
    for panel in panels:
        start = len(out['vertices'])
        out['vertices'].extend(panel['vertices'])
        out['faces'].extend([[i + start for i in face] for face in panel['faces']])
    return out


def apply_rso_pak40_firing_config(spec):
    """PaK40/4 parked lids -> source-supported open driving wells and360 firing.

    Same-carrier photos rso4/rso6 show the open/closed wells beside the retained
    center engine cover, and floor-flush ammunition lockers. Original cab envelope,
    cover footprints, gun/crew/track coordinates remain authored as before. Front
    cover hinges and180deg stow stops are modelling adaptations, not independently
    measured factory angles. The existing stage API centers the gun before any
    cover motion and exposes full traverse only after opening has completed.
    The shallow rack is a representative damage/display region, not a claim that
    its few rendered rounds represent the vehicle's entire unchanged ammo load.
    """
    if spec['id'] != 'de_rso_pak40' or spec.get('model'):
        return spec
    parts = spec['parts']
    if any(p.get('name') == 'rso_pak40_open_cab' for p in parts):
        return spec
    cab = next(p for p in parts if p['type'] == 'prism' and p.get('w') == 1.94)
    lids = [next(p for p in parts if p['type'] == 'box' and p.get('size') == size)
            for size in ([.50, .02, .36], [.44, .02, .30])]
    holes = [{'x0': p['pos'][0] - p['size'][0] / 2, 'x1': p['pos'][0] + p['size'][0] / 2,
              'z0': p['pos'][2] - p['size'][2] / 2, 'z1': p['pos'][2] + p['size'][2] / 2}
             for p in lids]
    regions = _roof_regions(holes, cab['wt'] / 2, .71, 1.31)
    parts[parts.index(cab)] = _rso_open_cab(cab, regions)
    for index, (lid, hole) in enumerate(zip(lids, holes)):
        lid['name'] = f'rso_pak40_driving_lid_{index}'
        lid['size'][1], lid['pos'][1] = .003, 1.3815
        lid['hinge'] = {'a': [round(hole['x0'], 4), 1.384, round(hole['z1'], 4)],
                        'b': [round(hole['x1'], 4), 1.384, round(hole['z1'], 4)], 'angle': 180}
    ammo = next(p for p in parts if p['type'] == 'box' and p.get('size') == [.30, .30, .90])
    ammo['name'] = 'rso_pak40_floor_ammo_lids'
    ammo['size'][1], ammo['pos'][1] = .025, .9725
    ammo['pos'][0] = .75
    ammo['pos'][2] = -.8
    # Ammunition sits under the matching lid footprint, inside the bed floor.
    for module in spec['modules']:
        if module['id'] in ('ammo_l', 'ammo_r'):
            # A shallow single-layer rack clears compressed road wheels and stays
            # below the existing interior renderer's hull/turret mounting cutoff.
            module['center']['y'] = .829
            module['half_extents']['y'] = .055
            # The floor lockers sit just outside the retained forward fuel tank:
            # fuel ends atx=.58, ammo starts atx=.60. Both remain under the bed.
            module['center']['x'] = -.75 if module['id'] == 'ammo_l' else .75
            # Keep the full rack ahead of the actual rear tooth wrap. With hz=.45
            # its rear frame ends atz=-1.25, ahead of the wheel's -1.2625 envelope.
            module['center']['z'] = -.8

    roof = next(p for p in spec['plates'] if p['id'] == 'cab_roof')
    plates = [p for p in spec['plates'] if p is not roof]
    def roof_cell(pid, x0, x1, z0, z1, y):
        p = copy.deepcopy(roof)
        p.update(id=pid, material='skirt', thickness_mm=3,
                 center={'x': round((x0 + x1) / 2, 4), 'y': y, 'z': round((z0 + z1) / 2, 4)},
                 half_u=round((x1 - x0) / 2, 4), half_v=round((z1 - z0) / 2, 4))
        return p
    for index, r in enumerate(regions):
        plates.append(roof_cell(f'cab_roof_cell_{index}', *r, 1.38))
    for index, (hole, lid) in enumerate(zip(holes, lids)):
        p = roof_cell(f'cab_driving_lid_{index}', hole['x0'], hole['x1'], hole['z0'], hole['z1'], 1.3815)
        p['hinge'] = copy.deepcopy(lid['hinge'])
        plates.append(p)
    spec['plates'] = plates

    # Reverified after the cab/cover changes at every degree of full traverse,
    # 0/.5/1 recoil, level and+22 elevation, plus101 centered fold states.
    # These deck-dependent values are engineering clearance, not gun mechanics.
    depression = [4.25, 3.75, 3.75, 3.75] + [5] * 29 + [3.75] * 3
    spec['yaw_limit'] = [-30, 30]
    spec['depression_by_bearing_deg'] = depression.copy()
    spec['folded_depression_by_bearing_deg'] = depression.copy()
    spec['fold_depression_stages'] = [{'fold': f, 'angles': depression.copy()} for f in (0, .5, 1)]
    spec['folded_yaw_limit_deg'] = [-180, 180]
    spec['fold_yaw_limit_stages'] = [{'fold': 0, 'limits': [-30, 30]},
                                    {'fold': .5, 'limits': [-.05, .05]},
                                    {'fold': 1, 'limits': [-180, 180]}]
    old_note = ' and traverses 30 deg either side on its turntable.'
    spec['notes'] = spec['notes'].replace(old_note,
        '. The two driving covers open with I; full-open firing permits360-degree traverse. '
        'The retained parked arc, transition centering, front-cover hinge stops and '
        'per-bearing depression table are engineering clearance adaptations to this model.')
    return spec
