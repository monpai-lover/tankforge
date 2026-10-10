"""Five measured support gaps; display collars do not change combat coordinates."""
import math

TARGETS = {'de_tiger_e', 'de_panther_g', 'de_panther_f', 'us_m4a1_76w', 'us_m4a3_76w_hvss'}


def apply_turret_seat(spec):
    vid = spec['id']
    if vid not in TARGETS or any(p.get('name') == 'turret_seat_collar' for p in spec['parts']):
        return
    cx, roof_y, cz = spec['turret_pos']
    parts = spec['parts']
    if vid.startswith('us_m4'):
        # Existing 60 mm seat touches the hull but stops 52 mm below the cast
        # shell. Replace that solid disc with a hollow collar reaching the shell.
        seat = next(p for p in parts if p['type'] == 'cyl' and p.get('mount') == 'turret'
                    and p.get('axis') == 'y' and p['r'] > .9 and p['len'] == .06)
        shell = next(p for p in parts if p['type'] == 'loft' and p.get('mount') == 'turret')
        y0 = seat['pos'][1] - seat['len'] / 2
        y1 = min(v[1] for ring in shell['rings'] for v in ring) + .002
        outer, inner = seat['r'], .84
    else:
        # The authored roof faces are flat at the pivot; the existing shell
        # deliberately begins 30/40 mm higher but had no bearing beneath it.
        shell = next(p for p in parts if p['type'] == 'plan' and p.get('mount') == 'turret')
        y0, y1 = roof_y - .002, shell['y0'] + .002
        outer = spec['ring'] / 2
        inner = outer - .055
        seat = None

    def circle(r, y):
        return [[round(cx + r * math.cos(2 * math.pi * i / 32), 4), round(y, 4),
                 round(cz - r * math.sin(2 * math.pi * i / 32), 4)] for i in range(32)]

    lower = circle(outer, y0)
    collar = {'type': 'loft', 'mount': 'turret', 'mat': 'paint_dark', 'name': 'turret_seat_collar',
              'rings': [lower, circle(outer, y1), circle(inner, y1), circle(inner, y0), lower],
              'crease': 60, 'caps': [False, False]}
    if seat is None:
        parts.append(collar)
    else:
        parts[parts.index(seat)] = collar
