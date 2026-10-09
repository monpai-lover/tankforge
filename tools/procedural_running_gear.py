"""Bounded paired-wheel repairs shared by the original vehicle builders.

These functions mutate and return one spec/visual dictionary. They do not read or
write vehicle files, touch simulation tuning, or rebuild unrelated fleet models.
Dimensions of the narrow discs/gap remain modelling estimates; axle locations,
outer tyre envelopes and track dimensions are inherited from the source builders.
"""


def _pair_wheels(rg, station_count, disc_width, offset, style):
    by_z = {}
    for wheel in rg['wheels']:
        key = round(wheel['z'], 3)
        axle = {k: wheel[k] for k in ('z', 'y', 'r')}
        if key in by_z and by_z[key] != axle:
            raise ValueError('paired road-wheel discs must share the same axle')
        by_z[key] = axle
    if len(by_z) != station_count:
        raise ValueError(f'expected {station_count} longitudinal wheel stations')
    stations = sorted(by_z.values(), key=lambda w: -w['z'])
    rg['wheels'] = [dict(axle, w=disc_width, x=x)
                    for axle in stations for x in (-offset, offset)]
    rg['wheel_style'] = style
    return stations


def apply_hvss_running_gear(spec):
    """M4A3(76)W HVSS: 6 axles, 12 narrow road-wheel discs per side.

    Uses the existing per-wheel x offset, station deduplication and wheel motion
    contract. The narrow central arm and raised horizontal spring bodies follow
    the arrangement in the original HVSS parts illustrations (Figures 13-1/2);
    fixed hull hardware remains an approximation of the articulated linkage.
    """
    rg = spec['running_gear']
    stations = _pair_wheels(rg, 6, .16, .13, 'hvss_dish')
    tx = rg['track_x']
    parts = [p for p in spec['parts']
             if not p.get('name', '').startswith('hvss_swing_arm_')]
    for p in parts:
        if p.get('mount') != 'hull' or not p.get('mirror'):
            continue
        if (p['type'] == 'cyl' and p.get('axis') == 'z'
                and p.get('len') == .46 and p.get('r') == .075
                and abs(p['pos'][0] - tx) < 1e-6):
            # The original y=.44 spring cut into the tyre/disc envelope.
            p['pos'][1] = .66
        if (p['type'] == 'box' and p.get('size') in ([.50, .30, .16], [.50, .06, .14])
                and abs(p['pos'][0] - tx) < 1e-6):
            # A thin transverse mount joins the inboard hull bracket and spring,
            # above the road wheels; the old deep block clipped their edges.
            p['size'] = [.50, .06, .14]
            p['pos'][1] = .68
    for side in (1, -1):
        for index, wheel in enumerate(stations):
            z, y = wheel['z'], wheel['y']
            profile = [(z-.045, y-.045), (z+.045, y-.045),
                       (z+.065, .43), (z+.075, .66),
                       (z+.035, .73), (z-.035, .73),
                       (z-.075, .66), (z-.065, .43)]
            parts.append({'name': f'hvss_swing_arm_{side}_{index}',
                          'type': 'prism', 'mount': 'hull', 'mat': 'paint_dark',
                          'w': .05, 'x': side*tx,
                          'profile': [[round(a, 4), round(b, 4)] for a, b in profile]})
    spec['parts'] = parts
    return spec


def apply_m113_running_gear(spec):
    """M901/M113: 5 axles, 10 rubber-tired discs per side, original .30m envelope."""
    _pair_wheels(spec['running_gear'], 5, .09, .105, 'rubber_dish')
    return spec
