#!/usr/bin/env python3
"""The reference models rebuilt as the game's own geometry (user decision 2026-10-22/23: "recreate, not use
directly"): a reference GLB is only measured; what goes into data.line ("aircraftRebuilds"[TYPE]) is the
type's spec, from which the game builds its own airframe (buildFighterGeometry: a lofted fuselage, its
wings, tailplane and fin with their moving surfaces, canopy, intakes, nozzles), plus the cockpit template
and internal layout it fits inside. None of the reference's triangles, textures or UVs are shipped.

    python3 -I rebuild.py TYPE REFERENCE_GLB DATA_LINE [--preview DIR]

Measured (game frame: +X starboard, +Y up, +Z nose, metres from the centre of gravity, the model scaled to
the type's published length):
- the fuselage: sections every ~1/30 of its length, each the outline of the centre body (its half width
  where the section stops being tall enough to be fuselage rather than wing) as radii at 24 angles about
  its centre: the loft;
- the wing, the tailplane and the fin(s): planform sections [span, height, leading edge, chord, half
  thickness] of the points outboard of the fuselage in each one's band; twin fins with their cant;
- the canopy (the transparent materials' box), the nozzles (the rearmost sections' openings), the
  centre of gravity at 25% of the wing's mean aerodynamic chord.
The previews (top, side, front silhouettes of the reference with the measured outlines over them) are for
checking a type's settings.
"""
import json, math, os, site, sys

sys.path.append(site.getusersitepackages())
import numpy as np  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from gltf import Gltf  # noqa: E402
import measure as M  # noqa: E402

ANGLES = 24


def load_tris(path, frame, scale, skip=(), only=None):
    """All opaque triangles of the reference (n, 3, 3) in the game frame (not yet centred), the glass apart."""
    g = Gltf(path)
    W = g.world()
    opaque, glass = [], []
    for i in g.mesh_nodes():
        n = g.nodes[i].get('name', '')
        if n in skip or (only and n not in only):
            continue
        for pr in g.primitives(i, W[i]):
            T = pr['P'][pr['I']]
            mat = g.j['materials'][pr['material']] if pr['material'] is not None else {}
            transparent = mat.get('alphaMode') == 'BLEND' or 'glass' in (mat.get('name') or '').lower()
            (glass if transparent else opaque).append(T)
    def conv(Ts):
        if not Ts:
            return np.zeros((0, 3, 3))
        T = np.concatenate(Ts)
        x, y, z = (T[..., frame[k][0]] * frame[k][1] for k in range(3))
        return np.stack([x, y, z], axis=-1) * scale
    return conv(opaque), conv(glass)


def body_half_width(q, y_min_thick, frac=0.32, window=0.04):
    """A section's fuselage half width: outward from the centre line in 4 cm bins until a bin's vertical
    extent drops below `frac` of the centre's (or y_min_thick): the wing root."""
    if not len(q):
        return 0.0
    ax = np.abs(q[:, 0])
    centre = q[ax < 0.15]
    h0 = (centre[:, 1].max() - centre[:, 1].min()) if len(centre) else (q[:, 1].max() - q[:, 1].min())
    lim = max(y_min_thick, frac * h0)
    w, step = 0.0, 0.04
    while w < ax.max():
        b = q[(ax >= w) & (ax < w + window)]
        # (a low-poly reference's sections have few points: an empty or single-point bin says nothing)
        if len(b) >= 2 and b[:, 1].max() - b[:, 1].min() < lim:
            break
        w += step
    return w


def loft(T, stations, y_min_thick, max_half=None, window=0.04, half=None, n_exp=2.4):
    """The fuselage loft: [z, cx, cy, [r at ANGLES]] from tail to nose (ascending z, as the game's loft).
    Each section measured as three numbers, robust to what is not the fuselage's skin (antennas, fences,
    ventral fins, the wing's root, the inner parts): its half width (`half`: read off the reference's top
    view; else where the section stops being tall enough to be fuselage), its top and bottom (the medians,
    over narrow bins across the middle of its width, of each bin's highest and lowest points); the three
    smoothed along the length and the ring drawn as a superellipse (exponent n_exp) through them."""
    zs = T[:, :, 2].reshape(-1)
    z0, z1 = zs.min(), zs.max()
    rows = []
    for k in range(stations):
        at = z0 + (z1 - z0) * (0.004 + 0.992 * k / (stations - 1))
        q = M.slab_points(T, 2, at, (z1 - z0) * 0.004)
        if len(q) < 4:
            continue
        w = half(at) if half else body_half_width(q, y_min_thick, window=window)
        if max_half:
            w = min(w, max_half)
        if w < 0.03:
            continue
        ax = np.abs(q[:, 0])
        step = max(0.04, w / 10)
        tops, bots = [], []
        for x in np.arange(0.2 * w, 0.66 * w, step):
            m = (ax >= x) & (ax < x + step)
            if m.sum() >= 2:
                tops.append(q[m, 1].max())
                bots.append(q[m, 1].min())
        if len(tops) < 2:
            m = ax <= w
            if m.sum() < 3:
                continue
            tops, bots = [q[m, 1].max()], [q[m, 1].min()]
        rows.append([at, w, float(np.median(tops)), float(np.median(bots))])
    if len(rows) < 3:
        return []
    A = np.array(rows)
    # along the length: a median over 5, then [1, 2, 1]
    for c in (1, 2, 3):
        v = A[:, c].copy()
        med = np.array([np.median(v[max(0, i - 2):i + 3]) for i in range(len(v))])
        sm = med.copy()
        sm[1:-1] = (med[:-2] + 2 * med[1:-1] + med[2:]) / 4
        A[:, c] = sm
    f = (1 - 0.43 ** n_exp) ** (1 / n_exp)  # the superellipse's height at 43% of its half width
    ang = np.arange(ANGLES) / ANGLES * 2 * math.pi
    ca, sa = np.abs(np.cos(ang)), np.abs(np.sin(ang))
    out = []
    for at, w, top, bot in A:
        hy = max(0.05, (top - bot) / 2 / f)
        cy = (top + bot) / 2
        r = 1 / np.maximum((ca / w) ** n_exp + (sa / hy) ** n_exp, 1e-9) ** (1 / n_exp)
        out.append([round(float(at), 3), 0.0, round(float(cy), 3), [round(float(v), 3) for v in r]])
    return out


def smooth_loft(st, canopy=None):
    """Under the canopy the ring's top held at the canopy's sill (the glass sits on the fuselage, the cockpit
    open under it), and ahead of it the nose's top sloping down from there (the pilot's view over it)."""
    if canopy is None or len(st) < 3:
        return st
    (_, ccy, ccz), (_, hy, hz) = canopy
    sill = ccy - hy * 0.85
    n = len(st[0][3])
    up = np.sin(np.arange(n) / n * 2 * math.pi)
    for s_ in st:
        z = s_[0]
        if z < ccz - hz * 0.95:
            continue
        lim_y = sill if z <= ccz + hz else sill - (z - ccz - hz) * 0.14
        r = np.array(s_[3], float)
        lim = np.where(up > 0.2, (lim_y - s_[2]) / np.maximum(up, 0.2), np.inf)
        s_[3] = [round(float(v), 3) for v in np.minimum(r, np.maximum(lim, 0.12))]
    return st


def close_ends(st, nose_open):
    """The loft's ends: the tail (its first station) the jet pipe's lip, the nose (its last) a point or, for
    a nose intake, its lip."""
    if st:
        st[0][3] = [round(v * 0.92, 3) for v in st[0][3]]
        if not nose_open:
            st[-1][3] = [round(max(v * 0.12, 0.01), 3) for v in st[-1][3]]
    return st


def straighten(secs):
    """A lifting surface's sections [span, height, leading edge, chord, half thickness] with their heights
    (the dihedral) and trailing edge each a straight line fitted through the measured ones: the moving
    surfaces cut from them need a straight hinge."""
    if len(secs) < 3:
        return secs
    a = np.array(secs, float)
    x = a[:, 0]
    y = np.polyval(np.polyfit(x, a[:, 1], 1), x)
    te = np.polyval(np.polyfit(x, a[:, 2] - a[:, 3], 1), x)
    out = []
    for k in range(len(a)):
        ch = max(0.12, a[k, 2] - te[k])
        out.append([round(float(x[k]), 3), round(float(y[k]), 3), round(float(a[k, 2]), 3), round(float(ch), 3), round(float(min(a[k, 4], ch * 0.06)), 3)])
    return out


def band(T, test, shift=None):
    """The triangles whose centres pass `test`, given in the model's frame (scaled, x centred) before the move
    to the centre of gravity (`shift`)."""
    c = T.mean(axis=1)
    if shift is not None:
        c = c + shift
    return T[test(c)]


def preview(T, glass, spec, path):
    """Top, side and front silhouettes of the reference (grey) with the measured outlines (colours)."""
    from PIL import Image, ImageDraw
    S, pad = 60, 20
    lo, hi = T.reshape(-1, 3).min(axis=0), T.reshape(-1, 3).max(axis=0)
    views = [('top', 0, 2), ('side', 2, 1), ('front', 0, 1)]
    out = []
    for name, a, b in views:
        w = int((hi[a] - lo[a]) * S) + 2 * pad
        h = int((hi[b] - lo[b]) * S) + 2 * pad
        im = Image.new('RGB', (w, h), (250, 250, 250))
        dr = ImageDraw.Draw(im)
        P = lambda q: (pad + (q[a] - lo[a]) * S, h - pad - (q[b] - lo[b]) * S)
        for t in T[:: max(1, len(T) // 60000)]:
            dr.polygon([P(t[0]), P(t[1]), P(t[2])], fill=(170, 170, 170))
        for t in glass[:: max(1, len(glass) // 5000)]:
            dr.polygon([P(t[0]), P(t[1]), P(t[2])], fill=(120, 170, 220))
        if name == 'top':
            for s_ in spec.get('wing', []):
                for sg in (1, -1):
                    dr.line([P([sg * s_[0], 0, s_[2]]), P([sg * s_[0], 0, s_[2] - s_[3]])], fill=(220, 40, 40), width=2)
            for s_ in spec.get('htail', {}).get('sections', []):
                for sg in (1, -1):
                    dr.line([P([sg * s_[0], 0, s_[2]]), P([sg * s_[0], 0, s_[2] - s_[3]])], fill=(40, 160, 40), width=2)
            for st in spec.get('loft', [{}])[0].get('stations', []):
                z, cx, cy, r = st
                wx = max(r[0], r[ANGLES // 2])
                dr.line([P([-wx, 0, z]), P([wx, 0, z])], fill=(40, 40, 220), width=1)
        if name == 'side':
            for st in spec.get('loft', [{}])[0].get('stations', []):
                z, cx, cy, r = st
                dr.line([P([0, cy - r[ANGLES * 3 // 4], z]), P([0, cy + r[ANGLES // 4], z])], fill=(40, 40, 220), width=1)
            fin = spec.get('fin')
            if fin:
                y0 = fin.get('twin', {}).get('y', 0)
                pts = [P([0, y0 + y, z]) for y, z in fin['pts']]
                dr.line(pts + [pts[0]], fill=(200, 120, 0), width=2)
        if name == 'front':
            for st in spec.get('loft', [{}])[0].get('stations', [])[::3]:
                z, cx, cy, r = st
                pts = [P([math.cos(k / ANGLES * 2 * math.pi) * r[k], cy + math.sin(k / ANGLES * 2 * math.pi) * r[k], 0]) for k in range(ANGLES)]
                dr.line(pts + [pts[0]], fill=(40, 40, 220), width=1)
        out.append(im)
    W = sum(i.size[0] for i in out) + 10 * len(out)
    H = max(i.size[1] for i in out)
    sheet = Image.new('RGB', (W, H), (255, 255, 255))
    x = 0
    for im in out:
        sheet.paste(im, (x, 0))
        x += im.size[0] + 10
    sheet.save(path)


def main(type_id, ref, data_line, preview_dir=None):
    import rebuild_types
    C = rebuild_types.TYPES[type_id]
    T, glass = load_tris(ref, C['frame'], 1.0, C.get('skip', ()), C.get('only'))
    # scale to the type's length (nose tip to the tail's last point, the pitot left out by `length_from`)
    zs = T[:, :, 2].reshape(-1)
    L = (zs.max() if C.get('length_to') is None else C['length_to'](T)) - zs.min()
    k = C['length_m'] / L
    T, glass = T * k, glass * k
    # centred: x on the centre line, the centre of gravity at 25% of the wing's MAC, y at the fuselage's middle
    cx = (T[:, :, 0].max() + T[:, :, 0].min()) / 2
    T[:, :, 0] -= cx
    glass[..., 0] -= cx if len(glass) else 0
    wing = band(T, C['wing_band'])
    port = wing[wing.mean(axis=1)[:, 0] > 0]
    secs = M.planform(port, stations=24)
    ys = np.array([s[0] for s in secs]); ch = np.array([s[3] for s in secs]); zle = np.array([s[2] for s in secs])
    trap = getattr(np, 'trapezoid', None) or np.trapz
    S_ = trap(ch, ys)
    mac = trap(ch * ch, ys) / S_
    zle_mac = trap(ch * zle, ys) / S_
    cgz = zle_mac - 0.25 * mac
    mid = C.get('cg_y')
    if mid is None:
        q = M.slab_points(T, 2, cgz, 0.05)
        q = q[np.abs(q[:, 0]) < 0.3]
        mid = float((q[:, 1].max() + q[:, 1].min()) / 2)
    shift = np.array([0, mid, cgz])
    if C.get('canopy_at') and len(glass):
        # the type's existing frame (its gear, stations, guns, damage parts and eye are placed in it): the
        # measured canopy's centre moved onto the type's canopy, [y, z]
        g0 = glass.reshape(-1, 3)
        g0 = g0[C['canopy_test'](g0)] if C.get('canopy_test') else g0
        cc = (g0.min(axis=0) + g0.max(axis=0)) / 2
        shift = np.array([0, cc[1] - C['canopy_at'][0], cc[2] - C['canopy_at'][1]])
    T = T - shift
    if len(glass):
        glass = glass - shift
    spec = {}
    body = band(T, C['body_band'], shift)
    half = None
    if C.get('half_width'):
        F_ = C.get('hw_scale', 1.0)
        hz, hw = zip(*sorted(C['half_width']))
        half = lambda at: float(np.interp((at + shift[2]) / F_, hz, hw)) * F_
    stations = loft(body, C.get('stations', 34), C.get('min_thick', 0.3), C.get('max_half'), C.get('hw_window', 0.04), half, C.get('boxy', 2.4))
    # the tail's last thin sections (a fin's bullet, an antenna) are not the fuselage: it ends at its jet pipe
    big = max(float(np.mean(st[3])) for st in stations)
    while len(stations) > 3 and float(np.mean(stations[0][3])) < C.get('tail_cut', 0.3) * big:
        stations.pop(0)
    canopy = None
    if len(glass):
        g = glass.reshape(-1, 3)
        g = g[C['canopy_test'](g + shift)] if C.get('canopy_test') else g
        canopy = M.box(g)
        canopy[0][0] = 0.0
    stations = smooth_loft(stations, canopy)
    stations = close_ends(stations, bool(C.get('nose_intake')))
    spec['loft'] = [{'stations': stations}]
    rear, front = stations[0], stations[-1]
    # the jet pipe's exit: the body's points in its last 0.3 m below the fin
    bp = body.reshape(-1, 3)
    fin_root = C.get('fin_root_y', 9) - shift[1]
    ex = bp[(bp[:, 2] < rear[0] + 0.3) & (bp[:, 1] < fin_root) & (np.abs(bp[:, 0]) < 1.2)]
    if len(ex) > 6:
        jy = float((ex[:, 1].max() + ex[:, 1].min()) / 2)
        jr = float(min(ex[:, 1].max() - ex[:, 1].min(), 2 * np.abs(ex[:, 0]).max()) / 2) * 0.9
    else:
        jy, jr = rear[2], float(np.mean(rear[3])) * 0.85
    jet = {'nozzle': round(float(bp[:, 2].min()) if len(ex) > 6 else rear[0], 3), 'r': round(jr, 3), 'y': round(jy, 3)}
    if C.get('jet_model'):
        # read off the reference's side view (model frame): the exit's z, its centre's height, its radius,
        # the twin engines' half spacing
        z_, y_, r_, *tw = C['jet_model']
        # (z None: the exit at the loft's tail)
        jet = {'nozzle': round(z_ - shift[2], 3) if z_ is not None else rear[0], 'r': r_, 'y': round(y_ - shift[1], 3)}
        if tw:
            jet['twin'] = tw[0]
        if jet['nozzle'] < rear[0] - 0.1:
            # the pipes run on past the fuselage's end (between the tail booms)
            jet['tube'] = round(rear[0] - jet['nozzle'] + 0.3, 3)
    if C.get('intake_model'):
        z_, y_, rx_, ry_ = C['intake_model']
        jet['intake'] = {'z': round(z_ - shift[2], 3), 'y': round(y_ - shift[1], 3), 'rx': rx_, 'ry': ry_, 'splitter': bool(C.get('splitter'))}
    elif C.get('nose_intake'):
        rr = front[3]
        jet['intake'] = {'z': round(front[0] - 0.01, 3), 'y': front[2], 'rx': round(max(rr[0], rr[ANGLES // 2]) * 0.88, 3), 'ry': round(max(rr[ANGLES // 4], rr[3 * ANGLES // 4]) * 0.88, 3), 'splitter': bool(C.get('splitter'))}
    else:
        jet['dropIntake'] = True
    spec['jet'] = jet
    env = [[s[0], round(max(s[3][0], s[3][ANGLES // 2]), 3), round(max(s[3][ANGLES // 4], s[3][3 * ANGLES // 4]), 3)] for s in spec['loft'][0]['stations']]
    spec['fuselage'] = env
    spec['fuseY'] = 0.0
    wing = band(T, C['wing_band'], shift)
    wing = wing[wing.mean(axis=1)[:, 0] > 0]
    spec['wing'] = straighten(M.planform(wing, stations=C.get('wing_stations', 6), x0=C['wing_root'], x1=None))
    ht = band(T, C['htail_band'], shift)
    ht = ht[ht.mean(axis=1)[:, 0] > 0]
    if len(ht):
        secs = straighten(M.planform(ht, stations=4, x0=C.get('htail_root', 0.3)))
        y = float(np.mean([s_[1] for s_ in secs]))
        spec['htail'] = {'p': [0, round(y, 3), 0], 'sections': [[s_[0], round(s_[1] - y, 3), s_[2], s_[3], s_[4]] for s_ in secs]}
    fin = band(T, C['fin_band'], shift)
    if len(fin):
        if C.get('twin_fin'):
            right = fin[fin.mean(axis=1)[:, 0] > 0]
            rp = right.reshape(-1, 3)
            y0 = float(rp[:, 1].min())
            # the cant: the fin's points' x against their height (a straight line through a canted slab)
            slope, x0 = np.polyfit(rp[:, 1] - y0, rp[:, 0], 1)
            cant = math.atan(float(slope))
            outline = M.fin_outline(right, x_at=0, x_half=1e9)
            spec['fin'] = {'pts': [[round(yy - y0, 3), zz] for yy, zz in outline], 'twin': {'x': round(float(x0), 3), 'y': round(y0, 3), 'cant': round(cant, 3)}}
        else:
            outline = M.fin_outline(fin, x_at=0, x_half=1e9)
            spec['fin'] = {'pts': outline}
        pts = spec['fin']['pts']
        yl, yh = min(p[0] for p in pts), max(p[0] for p in pts)
        zte = min(p[1] for p in pts)
        h = yh - yl
        spec['fin']['rudder'] = {'p': [0, round(yl + 0.15 * h + spec['fin'].get('twin', {}).get('y', 0), 3), round(zte + 0.32 * C.get('rudder_chord', 1.0), 3)],
                                 'pts': [[0, 0], [round(0.8 * h, 3), 0], [round(0.8 * h, 3), -round(0.3 * C.get('rudder_chord', 1.0), 3)], [0, -round(0.32 * C.get('rudder_chord', 1.0), 3)]]}
    if canopy:
        spec['canopy'] = canopy
    to = lambda q: [round(float(v), 3) for v in (np.asarray(q, float) - shift)]
    # the intakes' dark faces (mirrored unless on the centre line), the nacelles (fuselage-side engine pods)
    faces = []
    for x_, y_, z_, w_, h_ in C.get('faces_model', []):
        for sg in ((-1, 1) if abs(x_) > 0.05 else (1,)):
            faces.append([to([sg * x_, y_, z_]), [w_, h_, 0.06]])
    if faces:
        spec['faces'] = faces
    nac = []
    for n_ in C.get('nacelles_model', []):
        k_ = n_.get('scale', 1)
        prof = [[round(z * k_ - shift[2], 3), round(r * k_, 3), round(r * k_, 3)] for z, r in n_['profile']]
        nac.append({'x': n_['x'], 'y': round(n_['y'] - shift[1], 3), 'profile': prof,
                    'intake': {'z': prof[-1][0], 'rx': prof[-1][1] * 0.85, 'ry': prof[-1][2] * 0.85, 'depth': 0.6}, 'nozzle': {'z': prof[0][0], 'r': prof[0][1] * 0.85}})
    if nac:
        spec['nacelles'] = nac
    if C.get('cone') and 'intake' in spec.get('jet', {}):
        spec['jet']['intake']['cone'] = True
    if C.get('drop'):
        spec['drop'] = [d for d in C['drop'] if d not in spec]
    spec.update(C.get('fixed', {}))
    if C.get('measure'):
        spec.update(C['measure'](T, glass, spec, shift))
    spec['tailless'] = bool(C.get('tailless'))
    rec = {'version': 1, 'type': type_id, 'source': C['source'], 'scale': round(float(k), 6), 'cg_note': f'25% of the measured wing MAC {mac * k:.2f} m', 'spec': spec,
           'cockpit': C.get('cockpit'), 'internals': C.get('internals')}
    if preview_dir:
        os.makedirs(preview_dir, exist_ok=True)
        preview(T, glass, spec, os.path.join(preview_dir, f'{type_id}_rebuild.png'))
    s = open(data_line, encoding='utf-8').read()
    i, j = s.index('>') + 1, s.rindex('</script>')
    d = json.loads(s[i:j])
    d.setdefault('aircraftRebuilds', {})[type_id] = rec
    out = s[:i] + json.dumps(d, ensure_ascii=False, separators=(',', ':')) + s[j:]
    tmp = data_line + '.tmp'
    open(tmp, 'w', encoding='utf-8').write(out)
    json.loads(open(tmp, encoding='utf-8').read()[i:-(len(s) - j)])
    os.replace(tmp, data_line)
    print(type_id, 'scale', round(k, 4), 'loft stations', len(spec['loft'][0]['stations']), 'wing', spec['wing'][:2], '...')
    return rec


if __name__ == '__main__':
    a = [x for x in sys.argv[1:] if not x.startswith('--')]
    pv = next((sys.argv[i + 1] for i, x in enumerate(sys.argv) if x == '--preview'), None)
    main(a[0], a[1], a[2], pv)
