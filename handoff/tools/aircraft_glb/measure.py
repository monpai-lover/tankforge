"""What the game's aircraft type takes from a model, measured on its triangles (game frame: +X starboard,
+Y up, +Z nose, metres from the centre of gravity). The type's spec (AIR_FIGHTERS) drives the damage
model's boxes, the hitbox's piece planes (wing split, tail, fin, tailplane), the gear's ground contact,
the guns' muzzles and the engines' nozzles; for a model used directly these come from the model, so what
is shot, what falls off and where the flame sits agree with what is drawn.

Also used by rebuild.py on the reference models: the same sections, planforms and outlines, from which the
game's own geometry is generated (the reference's triangles are not shipped).
"""
import math

import numpy as np


def quat_mat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def tri_centres(P, I):
    return P[I].mean(axis=1)


def all_points(parts, test):
    pts = [p.P[np.unique(p.I)] for p in parts if test(p) and len(p.I)]
    return np.concatenate(pts) if pts else np.zeros((0, 3))


def all_tris(parts, test):
    tris = [p.P[p.I] for p in parts if test(p) and len(p.I)]
    return np.concatenate(tris) if tris else np.zeros((0, 3, 3))


def box(pts, pad=0.0):
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    return [[round(float((lo[k] + hi[k]) / 2), 3) for k in range(3)], [round(float((hi[k] - lo[k]) / 2 + pad), 3) for k in range(3)]]


def r3(v):
    return [round(float(x), 3) for x in v]


def slab_points(T, axis, at, half):
    """Points of the triangles' edges cut by the plane coordinate[axis] = at, plus the vertices within
    `half` of it (a section's outline from a triangle soup)."""
    a = T[:, :, axis]
    out = []
    for e0, e1 in ((0, 1), (1, 2), (2, 0)):
        u, v = a[:, e0], a[:, e1]
        m = (u - at) * (v - at) < 0
        if m.any():
            t = ((at - u[m]) / (v[m] - u[m]))[:, None]
            out.append(T[m, e0] + (T[m, e1] - T[m, e0]) * t)
    near = T.reshape(-1, 3)
    near = near[np.abs(near[:, axis] - at) < half]
    if len(near):
        out.append(near)
    return np.concatenate(out) if out else np.zeros((0, 3))


def planform(T, span_axis=0, stations=6, side=1, x0=None, x1=None, min_pts=6):
    """Sections [span, y, leading-edge z, chord, half thickness] of a lifting surface's triangles (the
    starboard half: span along +x), from its root to its tip."""
    s = T[:, :, span_axis].reshape(-1) * side
    lo, hi = (x0 if x0 is not None else s.min()), (x1 if x1 is not None else s.max())
    out = []
    for k in range(stations):
        at = lo + (hi - lo) * (0.02 + 0.96 * k / (stations - 1))
        q = slab_points(T * np.array([side, 1, 1]) if span_axis == 0 else T, span_axis, at, (hi - lo) * 0.01 + 0.005)
        if len(q) < min_pts:
            continue
        zle, zte = q[:, 2].max(), q[:, 2].min()
        # the thickness near the quarter chord, the camber line's height
        mid = q[(q[:, 2] < zle - 0.15 * (zle - zte)) & (q[:, 2] > zle - 0.45 * (zle - zte))]
        mid = mid if len(mid) >= 2 else q
        y = float((mid[:, 1].max() + mid[:, 1].min()) / 2)
        th = float((mid[:, 1].max() - mid[:, 1].min()) / 2)
        out.append([round(float(at), 3), round(y, 3), round(float(zle), 3), round(float(zle - zte), 3), round(max(0.006, th), 3)])
    return out


def fin_outline(T, x_at=0.0, x_half=0.25, y_from=None, stations=5):
    """A fin's outline [[y, z], ...] (leading edge root to tip, trailing edge tip to root) from its triangles."""
    c = T.mean(axis=1)
    m = np.abs(c[:, 0] - x_at) < x_half
    if y_from is not None:
        m &= c[:, 1] > y_from
    F = T[m]
    if not len(F):
        return None
    ys = F[:, :, 1].reshape(-1)
    y0, y1 = ys.min(), ys.max()
    le, te = [], []
    for k in range(stations):
        at = y0 + (y1 - y0) * (0.03 + 0.94 * k / (stations - 1))
        q = slab_points(F, 1, at, (y1 - y0) * 0.02 + 0.005)
        if len(q) < 3:
            continue
        le.append([round(float(at), 3), round(float(q[:, 2].max()), 3)])
        te.append([round(float(at), 3), round(float(q[:, 2].min()), 3)])
    return le + te[::-1]


def fuselage_envelope(T, stations=12, x_half=None):
    """[[z, rx, ry]] (half width, half height about y = 0 of the section's middle), and the sections'
    middle heights: the damage model's fuselage boxes (the lathe the game keeps for them)."""
    c = T.mean(axis=1)
    if x_half is not None:
        T = T[np.abs(c[:, 0]) < x_half]
    zs = T[:, :, 2].reshape(-1)
    z0, z1 = zs.min(), zs.max()
    env, mids = [], []
    for k in range(stations):
        at = z0 + (z1 - z0) * (0.01 + 0.98 * k / (stations - 1))
        q = slab_points(T, 2, at, (z1 - z0) * 0.01)
        if len(q) < 3:
            continue
        env.append([round(float(at), 3), round(float(np.abs(q[:, 0]).max()), 3), round(float((q[:, 1].max() - q[:, 1].min()) / 2), 3)])
        mids.append(float((q[:, 1].max() + q[:, 1].min()) / 2))
    return env, (float(np.median(mids)) if mids else 0.0)


def mover_tris(parts, movers, test):
    return all_tris(parts, lambda p: p.mover is not None and test(movers[p.mover]))


def control_spec(parts, movers):
    """aileron {x, y, z, w, d}, htail {p, sections} and fin {twin?, pts, rudder {p, pts}} from the moving
    surfaces and the fixed fin around them (the starboard ones: +x)."""
    out = {}
    ail = mover_tris(parts, movers, lambda m: m['param'] == 'roll' and m.get('side', 1) > 0 and m.get('on') != 'tail' and not m.get('cockpit'))
    if len(ail):
        pts = ail.reshape(-1, 3)
        lo, hi = pts.min(axis=0), pts.max(axis=0)
        out['aileron'] = {'x': round(float((lo[0] + hi[0]) / 2), 3), 'y': round(float((lo[1] + hi[1]) / 2), 3), 'z': round(float(hi[2]), 3), 'w': round(float(hi[0] - lo[0]), 3), 'd': round(float(hi[2] - lo[2]), 3)}
    ht = mover_tris(parts, movers, lambda m: m['param'] == 'pitch' and m.get('side', 1) >= 0 and not m.get('cockpit'))
    ht = ht[ht.mean(axis=1)[:, 0] > 0] if len(ht) else ht  # the starboard half (one all-moving T-tail is both)
    if len(ht):
        # elevators: the fixed tailplane ahead of them (flat airframe triangles in their span and height)
        e = ht.reshape(-1, 3)
        body = all_tris(parts, lambda p: p.group == 'body')
        c = body.mean(axis=1)
        nrm = np.cross(body[:, 1] - body[:, 0], body[:, 2] - body[:, 0])
        flat = np.abs(nrm[:, 1]) > 0.7 * (np.linalg.norm(nrm, axis=1) + 1e-12)
        sel = flat & (c[:, 0] > e[:, 0].min() - 0.3) & (c[:, 0] < e[:, 0].max() + 0.1) & (np.abs(c[:, 1] - e[:, 1].mean()) < 0.25) & (c[:, 2] > e[:, 2].min() - 3.0) & (c[:, 2] < e[:, 2].max() + 0.1)
        sel &= c[:, 0] > 0
        if sel.sum() >= 20:
            ht = np.concatenate([ht, body[sel]])
    if len(ht):
        y = float(ht[:, :, 1].mean())
        secs = planform(ht, stations=4)
        out['htail'] = {'p': [0, round(y, 3), 0], 'sections': [[s[0], round(s[1] - y, 3), s[2], s[3], s[4]] for s in secs]}
    rud = [m for m in movers if m['param'] == 'yaw' and m.get('side', 1) >= 0 and not m.get('cockpit')]
    if rud:
        m = max(rud, key=lambda m: m['p'][0])
        R = mover_tris(parts, movers, lambda q: q is m).reshape(-1, 3)
        lo, hi = R.min(axis=0), R.max(axis=0)
        ax = np.asarray(m['axis'], float)
        cant = math.atan2(abs(ax[0]), abs(ax[1]))
        x_root = float(lo[0]) if lo[0] > 0.05 else 0.0
        twin = x_root > 0.3
        y_root = float(lo[1]) - 0.1
        # the fixed fin: airframe triangles above the root along the rudder's plane
        body = all_tris(parts, lambda p: p.group == 'body')
        c = body.mean(axis=1)
        xf = (x_root if twin else 0.0) + (c[:, 1] - y_root) * math.tan(cant) * (1 if twin else 0)
        nrm = np.cross(body[:, 1] - body[:, 0], body[:, 2] - body[:, 0])
        side_on = np.abs(nrm[:, 0]) > 0.75 * (np.linalg.norm(nrm, axis=1) + 1e-12)
        sel = body[(c[:, 1] > y_root) & (np.abs(c[:, 0] - xf) < 0.18) & (c[:, 2] < hi[2] + 3.0) & (c[:, 2] > lo[2] - 0.6) & side_on]
        outline = fin_outline(sel, x_at=0, x_half=1e9, stations=5) if len(sel) else None
        if outline:
            base = y_root
            fin = {'pts': [[round(y - base, 3), z] for y, z in outline]}
            if twin:
                fin['twin'] = {'x': round(x_root, 3), 'y': round(base, 3), 'cant': round(cant, 3)}
            fin['rudder'] = {'p': [0, round(float(lo[1]), 3), round(float(hi[2]), 3)], 'pts': [[0, 0], [round(float(hi[1] - lo[1]), 3), 0], [round(float(hi[1] - lo[1]), 3), round(float(lo[2] - hi[2]), 3)], [0, round(float(lo[2] - hi[2]), 3)]]}
            if not twin:
                fin['pts'] = [[round(y, 3), z] for y, z in outline]
            out['fin'] = fin
    return out


def spec_patch(T, parts, movers, ctx):
    """The type's measured spec: whatever T['measure'] (the type's own hook) returns on top of the common
    measures: canopy, wing, tail, fin, fuselage envelope, damage parts from the internal modules."""
    out = {}
    body = all_tris(parts, lambda p: p.group == 'body')
    # canopy: the glass parts (not lenses or the HUD combiner)
    from alignment import SIGHT
    glass = all_points(parts, lambda p: p.group == 'glass' and p.mover is None and not SIGHT.search(p.name) and not p.name.lower().startswith(('hud_glass:', 'glass_hud', 'glass_lens', 'glass_irst')) and 'hud' not in p.name.lower() and not p.name.endswith('_away'))
    # a canopy that opens is measured closed (its mover's pose at 0)
    for p in parts:
        if p.group == 'glass' and p.mover is not None and movers[p.mover]['param'] == 'canopy':
            v, q, pv = min(movers[p.mover]['poses'], key=lambda s_: abs(s_[0]))
            R = quat_mat(q)
            pts = (p.P[np.unique(p.I)] - movers[p.mover]['p']) @ R.T + pv
            glass = np.concatenate([glass, pts]) if len(glass) else pts
    if len(glass):
        out['canopy'] = box(glass)
    # wing: the starboard wing's fixed and moving parts
    wing = all_tris(parts, lambda p: p.group == 'wing_r' or (p.mover is not None and movers[p.mover]['param'] in ('roll', 'flap', 'slat') and p.P[p.I].mean(axis=(0, 1))[0] > 0 and movers[p.mover].get('on') != 'tail'))
    if len(wing):
        x0 = T.get('wing_root', float(np.abs(wing[:, :, 0]).min()))
        out['wing'] = planform(wing, x0=x0, stations=6)
    env, mid = fuselage_envelope(body, x_half=T.get('fuselage_half_width'))
    if env:
        out['fuselage'] = env
        out['fuseY'] = round(mid, 3)
    out.update(control_spec(parts, movers))
    for k, v in (T.get('measure') or (lambda parts, movers, ctx, out: {}))(parts, movers, ctx, out).items():
        out[k] = v
    # the damage parts from the internal modules (their union box per kind)
    kinds = T.get('module_kinds', {})
    found = {}
    for p in parts:
        if p.group != 'internal' or not p.module:
            continue
        kind = next((k for k, pat in kinds.items() if any(s in (p.module.get('id', '') + ' ' + (p.module.get('category') or '')).lower() for s in pat)), None)
        if kind:
            found.setdefault(kind, []).append(p.P[np.unique(p.I)])
    if found:
        out['parts'] = {k: box(np.concatenate(v)) for k, v in found.items()}
    return out
