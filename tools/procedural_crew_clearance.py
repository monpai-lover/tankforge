"""Bounded open-platform crew station corrections for the existing posed asset.

Seated feet extend .848 m below the source chest; standing feet extend 1.286 m.
Keep the asset, scale, weapon hinge and motion contracts. These source positions
are clearance authoring estimates, not independently measured historical seats.
"""

STATIONS = {
    'de_flakpz38t': {
        'commander': (.35, 1.88, -1.80, 'seated'),
        'loader': (-.30, 1.88, -1.80, 'seated'),
    },
    'de_hetzer_flak': {
        'commander': (.35, 1.70, -.75, 'seated'),
        'loader': (-.30, 1.75, -.65, 'seated'),
    },
    'de_rso_flak': {'loader': (.24, 1.83, -.85, 'seated')},
    'de_rso_pak40': {
        'gunner': (-.30, 1.83, -1.15, 'seated'),
        'loader': (.32, 1.83, -1.20, 'seated'),
    },
    'uk_cmp_portee': {
        'gunner': (-.30, 1.85, -1.60, 'seated'),
        'loader': (.30, 1.85, -1.70, 'seated'),
    },
    'us_m10': {'loader': (.15, 2.56, -.40, 'standing')},
}

FLOORS = {'de_flakpz38t': 1.02, 'de_hetzer_flak': 1.27,
          'de_rso_flak': .96, 'de_rso_pak40': .96, 'uk_cmp_portee': 1.01}


def _seat(parts, role, station, floor, reuse=None):
    x, chest, z, _ = station
    seat_y = round(chest-.40, 4)
    defs = {
        'cushion': {'type': 'box', 'mount': 'turret', 'mat': 'black',
                    'size': [.30, .05, .28], 'pos': [x, seat_y, z]},
        'post': {'type': 'cyl', 'mount': 'turret', 'mat': 'steel', 'axis': 'y',
                 'r': .025, 'len': round(max(.02, seat_y-.025-floor), 4),
                 'pos': [x, round((floor+seat_y-.025)/2, 4), z], 'segs': 12},
    }
    for suffix, definition in defs.items():
        name = f'crew_clearance_{role}_{suffix}'
        part = next((p for p in parts if p.get('name') == name), None)
        if part is None and suffix == 'cushion' and reuse is not None:
            part = reuse
        if part is None:
            parts.append(dict(name=name, **definition))
        else:
            part.clear()
            part.update(name=name, **definition)


def apply_procedural_crew_clearance(spec):
    """Use supported source poses and stations without changing combat equipment."""
    stations = STATIONS.get(spec['id'], {})
    for crew in spec['crew']:
        if crew['role'] in stations:
            x, y, z, pose = stations[crew['role']]
            crew['pos'].update(x=x, y=y, z=z)
            crew['pose'] = pose
    for role, station in stations.items():
        if station[3] != 'seated':
            continue
        reuse = None
        if spec['id'] == 'de_flakpz38t' and role == 'commander':
            # Reuse the original mirrored auxiliary cushion slot; preserving the
            # source ordering leaves the shared gun assembly indexes untouched.
            reuse = next((p for p in spec['parts'] if p.get('mount') == 'hull'
                          and p.get('mirror') and p.get('mat') == 'black'
                          and p.get('size') == [.30, .05, .28]), None)
        _seat(spec['parts'], role, station, FLOORS[spec['id']], reuse)
    return spec
