"""Bounded procedural mount repairs; call on individual original source specs.

No file I/O or fleet rebuild occurs here. FlaK 38 overall weapon length is 2.25 m
(Jaeger Platoon, AA_GUNS1.htm). Its original .86 m rear receiver overhang made the
source gun 2.65 m long. Barrel, muzzle and elevation axis remain in their original
rest locations. Carriage spacing/sight detail remain authoring estimates from the
source mechanism, not independently measured manufacturing dimensions.

M901 support follows the erection-arm/hinged-head arrangement illustrated in
TM 9-2350-259-10 C4 pp. 1-15/16 (AFV Database). The outside fork is a simplified
support representation with explicit hinge contact; the head/armor stay intact.
"""


def _position(*values):
    return [round(value, 4) for value in values]


def _named_part(parts, name, definition):
    existing = next((p for p in parts if p.get('name') == name), None)
    if existing is None:
        parts.append(dict(name=name, **definition))
    else:
        existing.clear()
        existing.update(name=name, **definition)


def apply_flak38_mount(spec):
    """Correct shared FlaK rear envelope and clear its fixed supporting carriage."""
    if spec['id'] not in ('de_flakpz38t', 'de_hetzer_flak', 'de_rso_flak'):
        raise ValueError('FlaK mount repair only accepts the three procedural carriers')
    parts = spec['parts']
    start = next(i for i, p in enumerate(parts)
                 if p['type'] == 'cyl' and p.get('mount') == 'turret'
                 and p.get('axis') == 'y' and p.get('r') == .48)
    assembly = parts[start:start+21]
    if len(assembly) != 21 or assembly[11]['type'] != 'box' or assembly[11].get('mount') != 'gun':
        raise ValueError('unexpected FlaK source assembly')
    x, ty, tz = spec['mount']
    base_y, pz = assembly[0]['pos'][1:]
    # Keep side frames supported on the original turntable, outside the magazine
    # and sight sweep. Discs/shafts and the new pin share the original axis.
    assembly[1]['pos'][0] = round(x + .33, 4)
    if spec['id'] in ('de_hetzer_flak', 'de_rso_flak'):
        # The side-frame bottom was 25 mm above the turntable. Keep its upper
        # envelope/hinge clearance and extend only the fixed feet into the plate.
        frame = assembly[1]
        upper = frame['pos'][1] + frame['size'][1] / 2
        lower = base_y + assembly[0]['len'] / 2 - .002
        frame['size'][1] = round(upper - lower, 4)
        frame['pos'][1] = round((upper + lower) / 2, 4)
    assembly[2].update(size=[.66, .10, .10], pos=_position(x, base_y+.10, pz+.495))
    for p in assembly[3:5]:
        p['pos'][0] = round(x + .36, 4)
    assembly[8]['pos'][0] = round(x + .40, 4)
    assembly[9].update(len=.10, pos=_position(x+.37, base_y+.32, pz-.10))
    # 1.79 m original pivot-to-muzzle + .46 m aft receiver = 2.25 m.
    assembly[11].update(name='flak38_receiver', size=[.14, .16, .60],
                        pos=_position(x, ty, tz-.16))
    assembly[12].update(size=[.10, .08, .56], pos=_position(x, ty-.11, tz-.18))
    for index, offset in [(18, -.20), (19, -.20), (20, .01)]:
        assembly[index]['pos'][2] = round(tz + offset, 4)
    _named_part(parts, 'flak38_sight_bracket', {
        'type': 'box', 'mount': 'gun', 'mat': 'steel',
        'size': [.24, .035, .05], 'pos': _position(x+.10, ty+.04, tz-.20),
    })
    _named_part(parts, 'flak38_shield_stays', {
        'type': 'box', 'mount': 'turret', 'mat': 'paint_dark',
        'size': [.04, .04, .26], 'pos': _position(x+.33, base_y+.60, pz+.65),
        'mirror': x == 0,
    })
    # The old chair backrest used the oversized receiver as accidental support.
    # Bridge its existing 22 mm gap with the cushion without moving either seat.
    sx, sy, sz = assembly[5]['pos']
    _named_part(parts, 'flak38_seat_back_bracket', {
        'type': 'box', 'mount': 'turret', 'mat': 'steel',
        'size': [.06, .12, .08], 'pos': _position(sx, sy+.06, sz-.17),
    })
    _named_part(parts, 'flak38_elevation_pins', {
        'type': 'cyl', 'mount': 'gun', 'mat': 'steel', 'axis': 'x',
        'r': .035, 'len': .72, 'pos': _position(x, ty, tz), 'segs': 16,
    })
    # The receiver damage volume follows the corrected visible receiver.
    for module in spec['modules']:
        if module['kind'] == 'gun_breech':
            module['center'] = dict(zip(('x', 'y', 'z'), assembly[11]['pos']))
            module['half_extents'] = {'x': .07, 'y': .08, 'z': .30}
    return spec


def apply_m901_mount(spec):
    """Keep the armored hammerhead intact and support its original elevation axis."""
    if spec['id'] != 'us_m901_itv':
        raise ValueError('M901 repair only accepts the original procedural vehicle')
    parts = spec['parts']
    x, ty, tz = spec['mount']
    # All central members end below the complete -30/+35 degree swept head.
    # Only the outside fork reaches the hinge, so no central cap obstructs it.
    parts[17].update(len=.37, pos=_position(x, ty-.625, tz-.07))
    parts[18].update(size=[.20, .29, .20], pos=_position(x, ty-.585, tz-.05))
    parts[18].pop('rot', None)
    parts[19].update(size=[1.38, .08, .16], pos=_position(x, ty-.48, tz))
    _named_part(parts, 'm901_elevation_fork', {
        'type': 'box', 'mount': 'turret', 'mat': 'paint_dark',
        'size': [.08, .44, .14], 'pos': _position(x+.67, ty-.24, tz), 'mirror': True,
    })
    _named_part(parts, 'm901_elevation_pins', {
        'type': 'cyl', 'mount': 'turret', 'mat': 'steel', 'axis': 'x',
        'r': .065, 'len': .10, 'pos': _position(x+.63, ty, tz), 'mirror': True, 'segs': 16,
    })
    # The black inset represents the mouth, not a plug floating 10 mm beyond the
    # existing per-tube firing vector. Keep those vectors and the outer tubes.
    for index, vector in zip((26, 25), spec['gun']['launcher']['muzzle_vectors_m']):
        parts[index]['pos'][2] = round(tz + vector[2] - parts[index]['len']/2, 4)
    return spec


def apply_pak40_support(spec):
    """Join the original RSO PaK pivot/cradle to its 110 mm lower pedestal gap."""
    if spec['id'] != 'de_rso_pak40':
        return
    x, y, z = spec['mount']
    parts = spec['parts']
    pedestal = next(p for p in parts if p.get('mount') == 'turret' and p['type'] == 'box'
                    and p['size'] == [0.5, 0.3, 0.5])
    floor = pedestal['pos'][1] + pedestal['size'][1] / 2 - .002
    top = y + .035
    _named_part(parts, 'pak40_elevation_fork', {
        'type': 'box', 'mount': 'turret', 'mat': 'paint_dark', 'mirror': True,
        'size': [.045, round(top - floor, 4), .12], 'pos': _position(x + .24, (top + floor) / 2, z),
    })
    _named_part(parts, 'pak40_elevation_pins', {
        'type': 'cyl', 'mount': 'turret', 'mat': 'steel', 'axis': 'x', 'mirror': True,
        'r': .035, 'len': .20, 'pos': _position(x + .17, y, z), 'segs': 16,
    })
    # Fixed shield stays avoid using its accidental neutral-pose intersection
    # with the elevating recuperator as its only support.
    _named_part(parts, 'pak40_shield_stays', {
        'type': 'box', 'mount': 'turret', 'mat': 'paint_dark', 'mirror': True,
        'size': [.12, .045, .615], 'pos': _position(x + .275, 1.395, -.3425),
    })
