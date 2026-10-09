"""Bounded firing-position corrections for the nine procedural roof-gun mounts.

Hinge heights are clearance-derived modelling estimates, not manufacturer
dimensions. The base of each existing post stays in place; weapon assets,
ballistics, and unrelated source geometry are untouched. See the accompanying
2026-10-10 pintle repair note for sources and measured sweep limits.
"""

# 5-degree traverse sweep, legal depression and up to full elevation; rounded
# up with a 6 mm margin above the measured zero-crossing threshold.
_HINGE_Y = {
    'su_is2': 3.046,
    'su_t54': 2.555,
    'us_m8': 2.654,
    'us_m10': 2.993,
    'us_m4a2': 3.193,
    'us_m4a3_75w': 3.193,
    'us_m4a1_76w': 3.453,
    'us_m4a3_76w_hvss': 3.323,
    'de_hetzer': 2.229,
}


def apply_procedural_pintles(spec):
    """Mutate and return one source spec; leave every unlisted family unchanged."""
    vehicle_id = spec['id']
    if vehicle_id not in _HINGE_Y:
        return spec
    for gun in spec.get('secondary', []):
        if gun.get('mount') != 'pintle':
            continue
        lift = max(0, _HINGE_Y[vehicle_id] - gun['position_m'][1])
        gun['position_m'][1] = round(gun['position_m'][1] + lift, 3)
        gun['post_m'] = round(gun.get('post_m', .34) + lift, 3)
        if vehicle_id == 'de_hetzer':
            spec.setdefault('mg_variants', {})[gun['id']] = 'mg34_remote'
    return spec
