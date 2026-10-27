"""Per type: the package's files, the centre of gravity, how its nodes become the game's parts and movers,
and what the game's spec takes from it (convert.py). Positions in the comments are the package's frame
(metres, +X port, +Y up, +Z nose) unless they say game frame (+X starboard, from the CG)."""
import math
import re

import numpy as np

D2R = math.pi / 180


def control_pieces(P, I):
    """Triangle groups connected through shared (welded) positions: a merged mesh's separate pieces."""
    par = np.arange(len(P))

    def f(x):
        r = x
        while par[r] != r:
            r = par[r]
        while par[x] != r:
            par[x], x = r, par[x]
        return r
    key = {}
    for i, q in enumerate(np.round(P, 4)):
        k = tuple(q)
        if k in key:
            par[f(i)] = f(key[k])
        else:
            key[k] = i
    for a, b, c in I:
        ra = f(a)
        par[f(b)] = ra
        par[f(c)] = ra
    groups = {}
    for t, (a, _, _) in enumerate(I):
        groups.setdefault(f(a), []).append(t)
    return [np.array(v) for v in groups.values()]


def edge_hinge(pts, kind):
    """Hinge point and axis (game frame) of a trailing-edge surface (along its forward edge), a leading-edge
    flap (its aft edge) or an all-moving tailplane (across its pivot, 40% of the root chord); the rudder's
    span is its height."""
    span = (lambda q: q[:, 1]) if kind == 'rudder' else (lambda q: np.abs(q[:, 0]))
    s = span(pts)
    s0, s1 = s.min(), s.max()
    tol = 0.08 * (s1 - s0) + 0.02
    ends = [pts[np.abs(s - s0) < tol], pts[np.abs(s - s1) < tol]]
    pick = []
    for e in ends:
        if kind == 'slat':
            q = e[np.argmin(e[:, 2])]
        elif kind == 'stabilator':
            z0, z1 = e[:, 2].max(), e[:, 2].min()
            q = np.array([e[:, 0].mean(), (e[:, 1].min() + e[:, 1].max()) / 2, z0 - 0.4 * (z0 - z1)])
        else:
            q = e[np.argmax(e[:, 2])].copy()
            if kind != 'rudder':
                q[1] = (e[:, 1].min() + e[:, 1].max()) / 2
        pick.append(q)
    a, b = pick
    axis = (b - a) / (np.linalg.norm(b - a) or 1)
    return (a + b) / 2, axis


def wing_split(parts_iter, test):
    """Split each part's triangles: those `test` puts on a wing (by their centre, game frame) to wing_l /
    wing_r (by side), the rest stays."""
    out = []
    for p in parts_iter:
        if p.group != 'body':
            out.append(p)
            continue
        c = p.P[p.I].mean(axis=1)
        m = test(c)
        if not m.any():
            out.append(p)
            continue
        for grp, sel in (('body', ~m), ('wing_l', m & (c[:, 0] < 0)), ('wing_r', m & (c[:, 0] > 0))):
            if sel.any():
                q = type(p)(**{k: getattr(p, k) for k in p.__slots__})
                q.group, q.I = grp, p.I[sel]
                out.append(q)
    return out


def node_bounds(g, name, cg):
    """A node's mesh bounds in the game frame (lo, hi)."""
    W = g.world()
    i = next(k for k, n in enumerate(g.nodes) if n.get('name') == name)
    pts = (np.concatenate([pr['P'] for pr in g.primitives(i, W[i])]) - np.asarray(cg)) * np.array([-1, 1, 1])
    return pts.min(axis=0), pts.max(axis=0)


def pilot_eye(g, visor_name, cg):
    """The seated pilot's eye (game frame): 3 cm behind his visor's back, at its middle height, on the
    centre line."""
    W = g.world()
    i = next(k for k, n in enumerate(g.nodes) if n.get('name') == visor_name)
    pts = np.concatenate([pr['P'] for pr in g.primitives(i, W[i])])
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    return [0.0, round(float((lo[1] + hi[1]) / 2 - cg[1]), 3), round(float(lo[2] - 0.03 - cg[2]), 3)]


# ---------------------------------------------------------------- shared helpers

def node_index(g, name):
    return next(k for k, n in enumerate(g.nodes) if n.get('name') == name)


def descendants(g, i):
    out = [i]
    for c in g.nodes[i].get('children', []):
        out += descendants(g, c)
    return out


def signed_angle(q, axis):
    """The rotation angle of unit quaternion q (x, y, z, w) about `axis` (its own axis assumed ~ axis)."""
    q = np.asarray(q, float)
    return 2 * math.atan2(float(np.dot(q[:3], axis)), float(q[3]))


# the game's senses (buildFighterGeometry): positive surface values turn a right aileron, a tailplane or
# elevator positively about +x, a rudder positively about +y; flaps go down negatively about +x
SENSE = {'roll': lambda side: side, 'pitch': lambda side: 1, 'yaw': lambda side: 1, 'flap': lambda side: -1, 'slat': lambda side: 1}


def hinge_mover(ctx, name, param, side, pivot, axis, plus, minus=None, kind=None, on='wing'):
    """A hinge mover (game frame): `plus` the angle (rad, about `axis`) at value +1 (flaps, gear, airbrake: at
    1, from 0); `minus` at -1 for the surfaces that go both ways."""
    vals = [(0, 0.0), (1, plus)] if minus is None else [(-1, minus), (0, 0.0), (1, plus)]
    poses = ctx['hinge_poses'](pivot, axis, vals)
    return {'name': name, 'kind': kind or param, 'param': param, 'side': side, 'p': [round(float(c), 4) for c in pivot], 'axis': [round(float(c), 5) for c in axis],
            'poses': [[v, [round(float(c), 6) for c in q], [round(float(c), 4) for c in pv]] for v, q, pv in poses], 'on': on}


def game_axis(axis_model):
    a = np.asarray(axis_model, float) * np.array([-1, 1, 1])
    return a / np.linalg.norm(a)


def clip_hinge(ctx, g, node, clip, samples=61):
    """A control node's hinge from one of the package's clips (game frame): its pivot (the node's rest
    origin), its axis (of the largest rotation the clip makes) and the clip's least and greatest angles
    about it."""
    from convert import game_delta, mat_quat
    cg = ctx['cg']
    chans = g.channels(clip)
    dur = g.duration(clip)
    W0 = g.world()
    qs = []
    for k in range(samples):
        W = g.world(chans, dur * k / (samples - 1))
        Rg, _ = game_delta(W[node] @ np.linalg.inv(W0[node]), cg)
        qs.append(mat_quat(Rg))
    big = min(qs, key=lambda q: abs(q[3]))  # the sample turned furthest
    axis = big[:3] / (np.linalg.norm(big[:3]) or 1)
    angles = [signed_angle(q, axis) for q in qs]
    piv = ctx['to_game_points'](W0[node][:3, 3][None, :], cg)[0]
    return piv, axis, min(angles), max(angles)


def surface_from_clip(ctx, g, node, clip, param, side, name, on='wing', kind=None):
    """A control surface mover from a clip that swings it both ways (or, for flaps, down and back): the
    extreme matching the game's sense at +1, the other at -1."""
    piv, axis, lo, hi = clip_hinge(ctx, g, node, clip)
    ref = 1 if param == 'yaw' else 0
    if axis[ref] < 0:
        axis, lo, hi = -axis, -hi, -lo
    want = SENSE[kind if kind == 'slat' else param](side)
    plus, minus = (hi, lo) if want > 0 else (lo, hi)
    if param == 'flap':
        return hinge_mover(ctx, name, param, side, piv, axis, plus, None, kind=kind, on=on)
    return hinge_mover(ctx, name, param, side, piv, axis, plus, minus, kind=kind, on=on)


def clip_mover(ctx, g, nodes, clip, param, name, n=9, reverse=False):
    """A mover whose poses are the clip's own (the gear's retraction: value 0 at the clip's start, 1 at its
    end, `reverse` the other way), for each of `nodes` (their subtrees move with them): [mover per node]."""
    dur = g.duration(clip)
    samples = [(k / (n - 1), clip, dur * ((1 - k / (n - 1)) if reverse else k / (n - 1))) for k in range(n)]
    out = []
    for nid in nodes:
        piv, poses = ctx['mover_from_clips'](g, [nid], ctx['cg'], samples)
        out.append({'name': f'{name}:{g.nodes[nid].get("name")}', 'kind': param, 'param': param, 'side': 0, 'p': [round(float(c), 4) for c in piv], 'axis': [1, 0, 0],
                    'poses': [[v, [round(float(c), 6) for c in q], [round(float(c), 4) for c in pv]] for v, q, pv in poses[nid]], 'on': 'body'})
    return out


def wing_mac_cg(P_model, frac=0.25, stations=24):
    """The centre of gravity's z (package frame) at `frac` of the mean aerodynamic chord of the port wing's
    triangles P_model (n, 3, 3), and the MAC: the chord-weighted leading edge and the chord's mean square."""
    import measure as M
    secs = M.planform(P_model, stations=stations, side=1)
    ys = np.array([s[0] for s in secs])
    c = np.array([s[3] for s in secs])
    zle = np.array([s[2] for s in secs])
    trap = getattr(np, 'trapezoid', None) or np.trapz
    S_ = trap(c, ys)
    mac = trap(c * c, ys) / S_
    zle_mac = trap(c * zle, ys) / S_
    return zle_mac - frac * mac, mac, zle_mac


def node_tris(g, names, W=None):
    W = W or g.world()
    out = []
    for nm in names:
        i = node_index(g, nm)
        for pr in g.primitives(i, W[i]):
            out.append(pr['P'][pr['I']])
    return np.concatenate(out)


# ---------------------------------------------------------------- MiG-29 9.12 (the user's Falcons remake)

def mig29_build(ctx, gather):
    np_ = ctx['np']
    g = ctx['sources']['main']
    cg = ctx['cg']
    movers, parts = ctx['movers'], ctx['parts']
    W = g.world()

    def cls(g, i):
        n = g.nodes[i]['name']
        ex = g.nodes[i].get('extras') or {}
        if n.startswith('PILOT_') or n == 'EXT_CenterlineDropTank':
            return None
        if n.startswith('GLASS_'):
            return 'glass'
        if n.startswith('COCKPIT_'):
            return 'cockpit'
        if n.startswith('INT_'):
            return ('internal', None, {'id': ex.get('module_id', n), 'category': ex.get('category'), 'label': ex.get('label_zh')})
        if n.startswith('EXT_'):
            return 'body'
        return None
    got = gather(g, None, cg, 'main', cls, movers, W)
    # the control surfaces: one mesh of separate pieces, each its own mover with its hinge measured
    out = []
    for p in got:
        if p.name != 'EXT_ControlSurfaces':
            out.append(p)
            continue
        for k, ts in enumerate(sorted(control_pieces(p.P, p.I), key=lambda ts: -len(ts))):
            tri = p.I[ts]
            pts = p.P[np_.unique(tri)]
            lo, hi = pts.min(axis=0), pts.max(axis=0)
            # an engine's nozzle ring stays airframe
            if hi[2] < -3.3 and abs(lo[0] + hi[0]) / 2 < 1.4 and hi[2] - lo[2] < 0.7:
                kind = None
            elif lo[2] < -6.0:
                kind = 'stabilator'
            elif hi[1] > 1.2:
                kind = 'rudder'
            elif hi[2] > -1.2:
                kind = 'slat'
            elif max(abs(lo[0]), abs(hi[0])) > 4.0:
                kind = 'aileron'
            else:
                kind = 'flap'
            q = type(p)(**{s: getattr(p, s) for s in p.__slots__})
            q.I = tri
            if kind is None:
                q.group = 'body'
                out.append(q)
                continue
            piv, axis = edge_hinge(pts, kind)
            side = 1 if (lo[0] + hi[0]) > 0 else -1
            if kind == 'rudder':
                axis = axis if axis[1] > 0 else -axis
            elif axis[0] < 0:
                axis = -axis
            # the game's own surfaces' senses (buildFighterGeometry: rotations about +x / +y for positive
            # roll, pitch and yaw surface values, flaps down negative about +x) and its travel (aileron
            # 22 deg, stabilator 24 deg, rudder 23 deg, flaps 25 deg); the leading-edge flaps 20 deg down
            if kind == 'aileron':
                param, vals = 'roll', [(-1, -side * 0.38), (1, side * 0.38)]
            elif kind == 'stabilator':
                param, vals = 'pitch', [(-1, -0.42), (1, 0.42)]
            elif kind == 'rudder':
                param, vals = 'yaw', [(-1, -0.4), (1, 0.4)]
            elif kind == 'flap':
                param, vals = 'flap', [(0, 0.0), (1, -0.44)]
            else:
                param, vals = 'flap', [(0, 0.0), (1, 0.35)]
            vals = sorted(set([(v, a) for v, a in vals] + [(0, 0.0)]))
            movers.append({'name': f'{kind}_{"r" if side > 0 else "l"}', 'kind': kind, 'param': param, 'side': side, 'p': [round(float(c), 4) for c in piv],
                           'axis': [round(float(c), 5) for c in axis], 'poses': [[v, [round(float(c), 6) for c in ctx['hinge_poses'](piv, axis, [(v, a)])[0][1]], [round(float(c), 4) for c in piv]] for v, a in vals],
                           'on': 'tail' if kind in ('stabilator', 'rudder') else 'wing'})
            q.group = 'control'
            q.mover = len(movers) - 1
            q.name = f'{p.name}:{kind}_{"r" if side > 0 else "l"}_{k}'
            out.append(q)
    # the wings (outboard of the roots, ahead of the tail) apart from the body
    out = wing_split(out, lambda c: (np_.abs(c[:, 0]) > 1.55) & (c[:, 1] < 0.5) & (c[:, 2] > -3.4))
    parts.extend(out)


def mig29_measure(parts, movers, ctx, out):
    import measure as M
    res = {}
    # the engines' nozzles: the starboard exhaust's exit (the port one mirrors it)
    ex = M.all_points(parts, lambda p: p.name == 'EXT_Exhaust_L')  # +X port in the package = -x here
    lo, hi = ex.min(axis=0), ex.max(axis=0)
    res['jet'] = {'nozzle': round(float(lo[2] + 0.05), 3), 'r': round(float((hi[1] - lo[1]) / 2 * 0.92), 3), 'twin': round(float(abs(lo[0] + hi[0]) / 2), 3), 'y': round(float((lo[1] + hi[1]) / 2), 3)}
    # the gear (not in the model: the game draws it): main wheels at the main bays' aft end, 3.09 m track,
    # 840 mm main and 570 mm nose wheels; the ground 4.73 m (the type's height) under the fin's top
    fin_top = max(float(p.P[np.unique(p.I)][:, 1].max()) for p in parts if p.group in ('body', 'control'))
    ground = fin_top - 4.73
    bay = M.all_points(parts, lambda p: p.module and p.module.get('id') == 'INT_GearBay_Main_L')
    nose = M.all_points(parts, lambda p: p.module and p.module.get('id') == 'INT_GearBay_Nose')
    by, ny = float(bay[:, 1].min()), float(nose[:, 1].min())
    res['gear'] = {'kind': 'tricycle',
                   'main': {'x': 1.545, 'y': round(by, 3), 'z': round(float(bay[:, 2].min()) + 0.05, 3), 'len': round(by - (ground + 0.42), 3), 'r': 0.42, 'attachment': 'fuselage'},
                   'aux': {'y': round(ny, 3), 'z': round(float(bay[:, 2].min()) + 0.05 + 3.645, 3), 'len': round(ny - (ground + 0.285), 3), 'r': 0.285}}
    res['ground'] = round(ground, 3)
    res['eye'] = pilot_eye(ctx['sources']['main'], 'PILOT_Visor', ctx['cg'])
    # the centreline station where the package hangs its drop tank (its top, its middle)
    lo, hi = node_bounds(ctx['sources']['main'], 'EXT_CenterlineDropTank', ctx['cg'])
    res['stations'] = {'center': {'y': round(float(hi[1]), 3), 'z': round(float((lo[2] + hi[2]) / 2), 3)}}
    return res


def package_hinge_mover(ctx, name, param, pivot_m, axis_m, angle, n=5, on='body'):
    """A mover turning about a hinge given in the package's frame (pivot, axis by the right-hand rule there),
    0 at value 0 and `angle` (rad) at value 1, sampled at n values: what a package without the motion gets
    (the gear's retraction, an airbrake), worked out in its own frame and taken into the game's."""
    from convert import game_delta, mat_quat
    cg = ctx['cg']
    piv_m = np.asarray(pivot_m, float)
    piv = ctx['to_game_points'](piv_m[None, :], cg)[0]
    poses = []
    for k in range(n):
        v = k / (n - 1)
        R = axis_angle_m(axis_m, angle * v)
        D = np.eye(4)
        D[:3, :3] = R
        D[:3, 3] = piv_m - R @ piv_m
        Rg, dg = game_delta(D, cg)
        poses.append([round(v, 4), [round(float(c), 6) for c in mat_quat(Rg)], [round(float(c), 4) for c in Rg @ piv + dg]])
    return {'name': name, 'kind': param, 'param': param, 'side': 0, 'p': [round(float(c), 4) for c in piv], 'axis': [1, 0, 0], 'poses': poses, 'on': on}


def axis_angle_m(axis, ang):
    from gltf import quat_matrix
    a = np.asarray(axis, float)
    a = a / np.linalg.norm(a)
    x, y, z = a * math.sin(ang / 2)
    return quat_matrix((x, y, z, math.cos(ang / 2)))


def mac_cg(source, wing_nodes, y_m, why, frac=0.25):
    """cg(sources) for a type: `frac` of the port wing's mean aerodynamic chord, at height y_m (package frame)."""
    def f(sources):
        g = sources[source]
        z, mac, zle = wing_mac_cg(node_tris(g, wing_nodes), frac)
        return [0.0, y_m, round(float(z), 4)], f'{why} MAC {mac:.2f} m, its leading edge at z {zle:.2f}: the centre of gravity at {int(frac * 100)}% of it (z {z:.2f}), height {y_m} m.'
    return f


def wheel_spec(parts, names, attachment=None):
    """A wheel's {x, y, z, len, r} (game frame) from its tyre's parts: centre, radius (half its height); the leg
    1 m (the built gear is not drawn when the model has its own; only the lowest point counts)."""
    import measure as M
    pts = M.all_points(parts, lambda p: p.name in names)
    lo, hi = pts.min(axis=0), pts.max(axis=0)
    # a wheel is round in its y-z plane: its radius half its length (a node may carry its fork or brake
    # above it), its centre that far above its lowest point
    r = float(min(hi[1] - lo[1], hi[2] - lo[2]) / 2)
    c = [(lo[0] + hi[0]) / 2, lo[1] + r, (lo[2] + hi[2]) / 2]
    out = {'x': round(float(abs(c[0])), 3), 'y': round(float(c[1]) + 1.0, 3), 'z': round(float(c[2]), 3), 'len': 1.0, 'r': round(r, 3)}
    if attachment:
        out['attachment'] = attachment
    return out


# ---------------------------------------------------------------- the gear's legs from their stowed pose

def leg_rotation(pivot, tip, axle, down=(0, -1, 0), axle_to=(1, 0, 0)):
    """The rigid rotation (package frame) taking a stowed leg (pivot -> wheel centre `tip`, its wheel's
    axle along `axle`) to its extended pose: the leg along `down`, the axle along `axle_to` (the wheel
    upright, rolling fore and aft). A package whose gear is modelled retracted only gets its extension so."""
    def frame(a, b):
        a = np.asarray(a, float) / np.linalg.norm(a)
        b = np.asarray(b, float)
        b = b - (b @ a) * a
        b = b / np.linalg.norm(b)
        return np.stack([a, b, np.cross(a, b)], axis=1)
    A = frame(np.asarray(tip, float) - np.asarray(pivot, float), axle)
    B = frame(down, axle_to)
    return B @ A.T


def leg_mover(ctx, name, pivot_m, R, n=9, on='body'):
    """A gear mover from a stowed leg (the package's rest pose, value 1: gear up) to its extension by R about
    the pivot (value 0: gear down), along the one rotation between them."""
    from convert import game_delta, mat_quat
    cg = ctx['cg']
    piv_m = np.asarray(pivot_m, float)
    piv = ctx['to_game_points'](piv_m[None, :], cg)[0]
    # R's axis and angle
    ang = math.acos(max(-1.0, min(1.0, (np.trace(R) - 1) / 2)))
    ax = np.array([R[2, 1] - R[1, 2], R[0, 2] - R[2, 0], R[1, 0] - R[0, 1]])
    ax = ax / (np.linalg.norm(ax) or 1)
    poses = []
    for k in range(n):
        v = k / (n - 1)
        Rv = axis_angle_m(ax, ang * (1 - v))
        D = np.eye(4)
        D[:3, :3] = Rv
        D[:3, 3] = piv_m - Rv @ piv_m
        Rg, dg = game_delta(D, cg)
        poses.append([round(v, 4), [round(float(c), 6) for c in mat_quat(Rg)], [round(float(c), 4) for c in Rg @ piv + dg]])
    return {'name': name, 'kind': 'gear', 'param': 'gear', 'side': 0, 'p': [round(float(c), 4) for c in piv], 'axis': [1, 0, 0], 'poses': poses, 'on': on}


def take_region(parts, names, test, mover, name, cg):
    """The triangles of the named parts whose centres (package frame) pass `test`, moved into a part of
    their own driven by `mover`; the rest stay."""
    from convert import Part
    out = []
    for p in parts:
        if p.name not in names:
            out.append(p)
            continue
        c = p.P[p.I].mean(axis=1) * np.array([-1, 1, 1]) + np.asarray(cg)
        m = test(c)
        if m.any():
            q = Part(**{a: getattr(p, a) for a in Part.__slots__})
            q.I, q.group, q.mover, q.name, q.module = p.I[m], 'control', mover, name, None
            out.append(q)
        if (~m).any():
            p.I = p.I[~m]
            out.append(p)
    return out


def wheel_part(g, cg, centre_m, r, width, axle_m, mover, name, colour=(0.05, 0.05, 0.05)):
    """A tyre (a closed cylinder, 20 sides) at its stowed place: for a leg modelled without its wheel."""
    a = np.asarray(axle_m, float) / np.linalg.norm(axle_m)
    u = np.cross(a, [0, 1, 0] if abs(a[1]) < 0.9 else [1, 0, 0])
    u /= np.linalg.norm(u)
    w = np.cross(a, u)
    n = 20
    P, N, I = [], [], []
    for side in (-1, 1):
        for k in range(n):
            t = 2 * math.pi * k / n
            P.append(np.asarray(centre_m) + a * side * width / 2 + (u * math.cos(t) + w * math.sin(t)) * r)
            N.append(u * math.cos(t) + w * math.sin(t))
    for k in range(n):
        k2 = (k + 1) % n
        I += [[k, k2, n + k2], [k, n + k2, n + k]]
    # the side discs
    for side, base in ((-1, 0), (1, n)):
        c = len(P)
        P.append(np.asarray(centre_m) + a * side * width / 2)
        N.append(a * side)
        for k in range(n):
            I.append([c, base + (k + 1) % n, base + k] if side > 0 else [c, base + k, base + (k + 1) % n])
    from convert import Part, to_game_points, to_game_dirs
    P, N, I = np.array(P), np.array(N), np.array(I)
    mat = {'name': name, 'colour': list(colour), 'alpha': 1.0, 'blend': False, 'mask': False, 'tex': None, 'ntex': None, 'rough': 0.8, 'metal': 0.0, 'unlit': False}
    return Part(name=name, group='control', P=to_game_points(P, cg), N=to_game_dirs(N), UV=None, I=I[:, [0, 2, 1]], mat=mat, src=('main', g), mover=mover, module=None)


def extended_wheel(ctx, pivot_m, R, centre_m, r, attachment=None):
    """The gear spec's wheel ({x, y, z, len, r}, game frame, the leg 1 m as wheel_spec) at its extension."""
    c = R @ (np.asarray(centre_m, float) - pivot_m) + np.asarray(pivot_m, float)
    q = ctx['to_game_points'](c[None, :], ctx['cg'])[0]
    out = {'x': round(float(abs(q[0])), 3), 'y': round(float(q[1]) + 1.0, 3), 'z': round(float(q[2]), 3), 'len': 1.0, 'r': r}
    if attachment:
        out['attachment'] = attachment
    return out




def legs_gear(ctx, attachment):
    """The gear spec from the legs' extensions (ctx['legs']: kind, pivot, R, wheel centre, radius)."""
    out = {'kind': 'tricycle'}
    for kind, piv, R, tip, r in ctx['legs']:
        if kind not in out:
            out[kind] = extended_wheel(ctx, piv, R, tip, r, attachment if kind == 'main' else None)
    return out

# ---------------------------------------------------------------- Hawker Hunter F.4 (the user's RAF remake)

def hunter_build(ctx, gather):
    g = ctx['sources']['main']
    gi = ctx['sources']['internals']
    cg = ctx['cg']
    movers, parts = ctx['movers'], ctx['parts']
    meta = {s['node']: s for s in ctx['meta']['controls']}
    owner = {}
    # control surfaces from the package's hinge data (axis, pivot, travel)
    for node, m in meta.items():
        side = 1 if node.endswith('_R') else -1 if node.endswith('_L') else 0
        kind = m['kind']
        param = {'aileron': 'roll', 'elevator': 'pitch', 'rudder': 'yaw', 'flap': 'flap'}[kind]
        piv = ctx['to_game_points'](np.asarray(m['pivot_m'])[None, :], cg)[0]
        axis = game_axis(m['axis'])
        ref = 1 if param == 'yaw' else 0
        if axis[ref] < 0:
            axis = -axis
        lo, hi = m['minimum_deg'] * D2R, m['maximum_deg'] * D2R
        big, small = max(abs(lo), abs(hi)), min(abs(lo), abs(hi))
        if param == 'flap':
            mv = hinge_mover(ctx, node, 'flap', side, piv, axis, -big, None, on='wing')
        elif param == 'roll':
            mv = hinge_mover(ctx, node, 'roll', side, piv, axis, side * big, -side * big, on='wing')
        elif param == 'pitch':
            # trailing edge up (nose up) the larger travel
            mv = hinge_mover(ctx, node, 'pitch', side, piv, axis, max(abs(lo), abs(hi)), -small, on='tail')
        else:
            mv = hinge_mover(ctx, node, 'yaw', side, piv, axis, big, -big, on='tail')
        movers.append(mv)
        for d in descendants(g, node_index(g, node)):
            owner[d] = len(movers) - 1
    # the canopy: slides back (the package's open-and-close clip up to its open moment)
    for nid, m in clip_range_movers(ctx, g, 'canopy_open_close', 'canopy', end=clip_extreme_time(g, 'canopy_open_close')):
        movers.append(m)
        for d in descendants(g, nid):
            owner[d] = len(movers) - 1
    # the airbrake under the rear fuselage: hinged at its front edge, 60 deg down
    ab = node_index(g, 'control__airbrake')
    movers.append(package_hinge_mover(ctx, 'airbrake', 'airbrake', [0, -0.3, -2.54], [1, 0, 0], -60 * D2R))
    owner[ab] = len(movers) - 1
    # the gear (the package has it down only): the main legs fold inward into the wings, the nose leg forward
    W = g.world()
    gear_nodes = {k: [] for k in ('L', 'R', 'nose', 'doors_L', 'doors_R')}
    for i in g.mesh_nodes():
        n = g.nodes[i]['name']
        mm = re.match(r'gear__(L|R|nose)__', n)
        if not mm:
            continue
        pts = np.concatenate([pr['P'] for pr in g.primitives(i, W[i])])
        key = mm.group(1)
        if key in 'LR' and abs(pts[:, 0].mean()) < 1.2:
            key = 'doors_' + key
        gear_nodes[key].append(i)
    for key, sgn in (('L', 1), ('R', -1)):
        # the oleo's top (package frame): +x port; folding inward turns the leg toward the centre line
        top = [sgn * 2.21, -0.13, 0.15]
        movers.append(package_hinge_mover(ctx, f'gear_{key}', 'gear', top, [0, 0, 1], -sgn * 88 * D2R, n=9))
        for i in gear_nodes[key]:
            owner[i] = len(movers) - 1
        # its inner doors close up against the fuselage (hinged along their outer top edge)
        movers.append(package_hinge_mover(ctx, f'gear_door_{key}', 'gear', [sgn * 0.74, -0.40, 0.4], [0, 0, 1], -sgn * 80 * D2R))
        for i in gear_nodes['doors_' + key]:
            owner[i] = len(movers) - 1
    movers.append(package_hinge_mover(ctx, 'gear_nose', 'gear', [0, -0.42, 5.1], [1, 0, 0], -100 * D2R, n=9))
    for i in gear_nodes['nose']:
        owner[i] = len(movers) - 1

    def cls(g, i):
        n = g.nodes[i]['name']
        ex = (g.nodes[i].get('extras') or {}).get('tankforge', {})
        layer = ex.get('layer')
        if layer in ('crew', 'stores') or n.startswith('camera'):
            return None
        mv = owner.get(i)
        if mv is not None and 'glass' in n:
            return ('glass', mv, None)
        if mv is not None and layer in ('cockpit', 'canopy_interior'):
            return ('cockpit', mv, None)
        if layer == 'controls' or layer == 'landing_gear' or mv is not None:
            return ('control', mv, None) if mv is not None else None
        if 'glass' in n:
            return 'glass'
        if layer in ('cockpit', 'canopy_interior'):
            return 'cockpit'
        if layer in ('airframe', 'weapons', 'markings'):
            if n.startswith('exterior__wing_') or n.startswith('exterior__nav_'):
                return 'wing_l' if n.endswith(('_L', 'nav_L')) else 'wing_r'
            return 'body'
        return None
    got = gather(g, None, cg, 'main', cls, movers, W)
    # the markings on the wings (roundels) go with their wing
    got = wing_split(got, lambda c: (np.abs(c[:, 0]) > 0.75) & (c[:, 1] > -0.6) & (c[:, 1] < 0.45) & (c[:, 2] > -3.2) & (c[:, 2] < 3.2) & (np.abs(c[:, 0]) < 5.2))
    parts.extend(got)

    def icls(g, i):
        n = g.nodes[i]['name']
        if not n.startswith('internal__'):
            return None
        mid = re.sub(r'__(engine|darkmetal|hotmetal|silver|fuel|steel|copper|black|paint|primer|green|red|blue|white|yellow|grey|gray|brass)$', '', n[len('internal__'):])
        return ('internal', None, {'id': mid, 'category': mid.split('_')[0], 'label': mid})
    parts.extend(gather(gi, None, cg, 'internals', icls, movers, gi.world()))


def hunter_measure(parts, movers, ctx, out):
    import measure as M
    res = {}
    ex = M.all_points(parts, lambda p: p.name == 'exterior__jetpipe')
    lo, hi = ex.min(axis=0), ex.max(axis=0)
    res['jet'] = {'nozzle': round(float(lo[2]), 3), 'r': round(float((hi[0] - lo[0]) / 2 * 0.9), 3), 'y': round(float((lo[1] + hi[1]) / 2), 3)}
    res['gear'] = {'kind': 'tricycle', 'main': wheel_spec(parts, ['gear__R__Torus07-FACES'], 'wing'), 'aux': wheel_spec(parts, ['gear__nose__Torus03-FACES'])}
    # the four ADEN muzzles (game order: port upper, starboard upper, port lower, starboard lower)
    mz = []
    for nm in ('weapons__aden_muzzle_3', 'weapons__aden_muzzle_4', 'weapons__aden_muzzle_1', 'weapons__aden_muzzle_2'):
        q = M.all_points(parts, lambda p, nm=nm: p.name == nm)
        lo, hi = q.min(axis=0), q.max(axis=0)
        mz.append([round(float((lo[0] + hi[0]) / 2), 3), round(float((lo[1] + hi[1]) / 2), 3), round(float(hi[2]), 3), 0.3, 0.035])
    res['muzzles'] = mz
    res['eye'] = [0.0, round(float(ctx['camera_eye'][1]), 3), round(float(ctx['camera_eye'][2]), 3)] if ctx.get('camera_eye') is not None else None
    return {k: v for k, v in res.items() if v is not None}


def clip_pair_movers(ctx, g, pos_clip, neg_clip, param, ref_node, ref_side, names, on='wing'):
    """Movers driven both ways by a pair of the package's clips (its positive and negative swings, each
    from rest at its start to full travel at its end): every animated node of the pair, its poses at -1,
    -0.5, 0, 0.5, 1. Which clip is the game's +1 comes from the reference surface (`ref_node` on side
    `ref_side`) against the game's sense, so the cockpit's stick and pedals move with the surfaces."""
    from convert import game_delta, mat_quat
    cg = ctx['cg']
    W0 = g.world()
    cp, cn = g.channels(pos_clip), g.channels(neg_clip)
    dp, dn = g.duration(pos_clip), g.duration(neg_clip)
    ri = node_index(g, ref_node)
    Rg, _ = game_delta(g.world(cp, dp)[ri] @ np.linalg.inv(W0[ri]), cg)
    q = mat_quat(Rg)
    ax = np.array([0, 1, 0]) if param == 'yaw' else np.array([1, 0, 0])
    swap = (signed_angle(q, ax) > 0) != (SENSE[param](ref_side) > 0)
    plus, minus = ((cn, dn), (cp, dp)) if swap else ((cp, dp), (cn, dn))
    out = []
    for nid in sorted(set(cp) | set(cn)):
        piv = ctx['to_game_points'](W0[nid][:3, 3][None, :], cg)[0]
        poses = []
        for v, (ch, d) in ((-1, minus), (-0.5, minus), (0, (None, 0)), (0.5, plus), (1, plus)):
            W = g.world(ch, d * abs(v)) if ch else W0
            Rg, dg = game_delta(W[nid] @ np.linalg.inv(W0[nid]), cg)
            poses.append([v, [round(float(c), 6) for c in mat_quat(Rg)], [round(float(c), 4) for c in Rg @ piv + dg]])
        nm = g.nodes[nid].get('name')
        side = 1 if nm.endswith(('_right', '_R')) else -1 if nm.endswith(('_left', '_L')) else 0
        out.append((nid, {'name': names.get(nm, nm), 'kind': param, 'param': param, 'side': side, 'p': [round(float(c), 4) for c in piv], 'axis': [1, 0, 0], 'poses': poses, 'on': on, 'node': nid}))
    return out


def clip_extreme_time(g, clip, samples=81):
    """The time in a clip where its nodes are furthest from rest (an open-and-close clip's open moment)."""
    ch, d = g.channels(clip), g.duration(clip)
    W0 = g.world()
    best = (0, 0.0)
    for k in range(samples):
        t = d * k / (samples - 1)
        W = g.world(ch, t)
        dev = sum(float(np.abs(W[n] - W0[n]).sum()) for n in ch)
        best = max(best, (dev, t))
    return best[1]


def clip_range_movers(ctx, g, clip, param, n=9, on='body', end=None):
    """Movers from one clip running a part from rest (value 0, the clip's start) to full travel (1, its end,
    or `end` s): the gear's retraction, the flaps, the airbrakes, a canopy opening."""
    from convert import game_delta, mat_quat
    cg = ctx['cg']
    W0 = g.world()
    ch, d = g.channels(clip), (end if end is not None else g.duration(clip))
    out = []
    for nid in sorted(ch):
        piv = ctx['to_game_points'](W0[nid][:3, 3][None, :], cg)[0]
        poses = []
        for k in range(n):
            v = k / (n - 1)
            Rg, dg = game_delta(g.world(ch, d * v)[nid] @ np.linalg.inv(W0[nid]), cg)
            poses.append([round(v, 4), [round(float(c), 6) for c in mat_quat(Rg)], [round(float(c), 4) for c in Rg @ piv + dg]])
        nm = g.nodes[nid].get('name')
        side = 1 if nm.endswith(('_right', '_R')) else -1 if nm.endswith(('_left', '_L')) else 0
        out.append((nid, {'name': nm, 'kind': param, 'param': param, 'side': side, 'p': [round(float(c), 4) for c in piv], 'axis': [1, 0, 0], 'poses': poses, 'on': on, 'node': nid}))
    return out


def shell_cg(source, node_filter, test, y_m, why, frac=0.25):
    """cg(sources) from the wing triangles among the shell nodes (`test` on their centres, package frame)."""
    def f(sources):
        g = sources[source]
        W = g.world()
        tris = []
        for i in g.mesh_nodes():
            if not node_filter(g, i):
                continue
            for pr in g.primitives(i, W[i]):
                T = pr['P'][pr['I']]
                tris.append(T[test(T.mean(axis=1))])
        T = np.concatenate(tris)
        T = T[T.mean(axis=1)[:, 0] > 0]  # the port wing (+x)
        z, mac, zle = wing_mac_cg(T, frac)
        return [0.0, y_m, round(float(z), 4)], f'{why} MAC {mac:.2f} m, its leading edge at z {zle:.2f}: the centre of gravity at {int(frac * 100)}% of it (z {z:.2f}), height {y_m} m.'
    return f


# ---------------------------------------------------------------- MiG-15bis (the user's remake, Soviet "23")

def mig15_build(ctx, gather):
    g = ctx['sources']['main']
    cg = ctx['cg']
    movers, parts = ctx['movers'], ctx['parts']
    owner = {}

    def take(pairs):
        for nid, m in pairs:
            movers.append(m)
            for d in descendants(g, nid):
                # the deepest mover owns a mesh (the stick's grip: its pitch node inside its roll node)
                if d not in owner or len(g.ancestors(d)) - len(g.ancestors(movers[owner[d]]['node'])) > len(g.ancestors(d)) - len(g.ancestors(nid)):
                    owner[d] = len(movers) - 1
    take(clip_pair_movers(ctx, g, 'ailerons_positive', 'ailerons_negative', 'roll', 'aileron_right', 1, {}))
    take(clip_pair_movers(ctx, g, 'elevators_positive', 'elevators_negative', 'pitch', 'elevator_right', 1, {}, on='tail'))
    take(clip_pair_movers(ctx, g, 'rudder_positive', 'rudder_negative', 'yaw', 'rudder_lower', 0, {}, on='tail'))
    take(clip_range_movers(ctx, g, 'flaps_down', 'flap', on='wing'))
    take(clip_range_movers(ctx, g, 'airbrakes_open', 'airbrake'))
    take(clip_range_movers(ctx, g, 'gear_retract', 'gear'))
    take(clip_range_movers(ctx, g, 'canopy_open', 'canopy'))
    W = g.world()
    top = {}
    for i, n in enumerate(g.nodes):
        for c in n.get('children', []):
            top[c] = i

    def group_of(i):
        names = [g.nodes[a].get('name') for a in [i] + g.ancestors(i)]
        return names

    def cls(g, i):
        names = group_of(i)
        if any(n in ('stores_tanks_300l', 'stores_fab100', 'stores_clean') for n in names) or 'internals' in names and False:
            return None
        if 'internals' in names:
            n = g.nodes[i]['name']
            return ('internal', None, {'id': n, 'category': n.split('_')[0], 'label': n})
        mv = owner.get(i)
        if 'cockpit' in names:
            return ('cockpit', mv, None)
        if mv is not None:
            return ('glass' if 'glass' in g.nodes[i]['name'] else 'control', mv, None)
        if any(n in ('canopy_fixed', 'canopy_slide') for n in names):
            return 'glass' if 'glass' in g.nodes[i]['name'] else 'body'
        if any(n.startswith('weapon_') for n in names) or 'exterior_shell' in names or 'decals' in names:
            return 'body'
        return None
    got = gather(g, None, cg, 'main', cls, movers, W)
    got = wing_split(got, lambda c: (np.abs(c[:, 0]) > 0.72) & (c[:, 1] < 0.55) & (c[:, 2] > -3.3))
    parts.extend(got)
    # the cockpit movers are the cockpit's (shown in the cockpit view), its stick's roll node too
    for m in movers:
        if 'cockpit' in [g.nodes[a].get('name') for a in g.ancestors(m['node'])]:
            m['cockpit'] = True


def mig15_measure(parts, movers, ctx, out):
    import measure as M
    res = {}
    g = ctx['sources']['main']
    # the jet pipe: the internal exhaust's exit
    ex = M.all_points(parts, lambda p: p.group == 'internal' and p.name.startswith('Exhaust'))
    a, b = ex.min(axis=0), ex.max(axis=0)
    res['jet'] = {'nozzle': round(float(a[2]), 3), 'r': round(float((b[1] - a[1]) / 2), 3), 'y': round(float((a[1] + b[1]) / 2), 3)}
    # the guns: N-37D (starboard) then the two NR-23 (port) (AIR_ATTACHMENT_OWNERS.mig15: n37 [0], nr23 [1, 2])
    mz = []
    for nm in ('weapon_n37d_muzzle_brake', 'weapon_nr23_left_inboard_muzzle_brake', 'weapon_nr23_left_outboard_muzzle_brake'):
        q = M.all_points(parts, lambda p, nm=nm: p.name == nm)
        a, b = q.min(axis=0), q.max(axis=0)
        mz.append([round(float((a[0] + b[0]) / 2), 3), round(float((a[1] + b[1]) / 2), 3), round(float(b[2]), 3), 0.3, round(float((b[1] - a[1]) / 2), 3)])
    res['muzzles'] = mz
    # the wheels (the gear's own parts, the tyres the lowest of each leg)
    def wheel(prefix, attachment=None):
        pts = M.all_points(parts, lambda p: p.group == 'control' and movers[p.mover]['name'] == prefix)
        lo, hi = pts.min(axis=0), pts.max(axis=0)
        low = pts[pts[:, 1] < lo[1] + 0.05]
        r = 0.33 if prefix != 'gear_nose' else 0.24
        c = [float(np.median(low[:, 0])), float(lo[1]) + r, float(np.median(low[:, 2]))]
        o = {'x': round(abs(c[0]), 3), 'y': round(c[1] + 1.0, 3), 'z': round(c[2], 3), 'len': 1.0, 'r': r}
        if attachment:
            o['attachment'] = attachment
        return o
    res['gear'] = {'kind': 'tricycle', 'main': wheel('gear_right', 'wing'), 'aux': wheel('gear_nose')}
    i = node_index(g, 'Pilot_Eye_Reference')
    res['eye'] = [0.0] + [round(float(v), 3) for v in ctx['to_game_points'](g.world()[i][:3, 3][None, :], ctx['cg'])[0][1:]]
    return res


# ---------------------------------------------------------------- Dassault Mirage 5F (the user's remake)

def mirage_build(ctx, gather):
    g = ctx['sources']['main']
    cg = ctx['cg']
    movers, parts = ctx['movers'], ctx['parts']
    W = g.world()
    surf = {}

    def cls(g, i):
        n = g.nodes[i]['name']
        ex = g.nodes[i].get('extras') or {}
        cat = ex.get('category')
        if cat in ('Pilot', 'Stores', 'WeaponMounts') or n.startswith(('PILOT_', 'Store_', 'Pylon_', 'Rail_')):
            return None
        if n.startswith('SURF_'):
            return ('control', None, {'surface': n})
        if n == 'CANOPY_Glass' or n == 'COCKPIT_SightGlass':
            return 'glass'
        if cat == 'Cockpit':
            return 'cockpit'
        if n == 'GEAR_RetractedAssembly':
            return None  # A merged, stowed-only mesh: it cannot rotate as a rigid landing leg.
        if n in ('EXTERIOR_Airframe', 'ENGINE_OriginalAfterburner', 'GEAR_ThinPanels') or n.startswith('Weapon_DEFA'):
            return 'body'
        if cat:
            return ('internal', None, {'id': ex.get('module_id', n), 'category': cat, 'label': ex.get('label_zh')})
        return None
    got = gather(g, None, cg, 'main', cls, movers, W)
    out = []
    for p in got:
        if p.group != 'control':
            out.append(p)
            continue
        n = p.module['surface']
        p.module = None
        pts = p.P[np.unique(p.I)]
        side = 1 if '_R_' in n else -1 if '_L_' in n else 0
        if n == 'SURF_Rudder':
            piv, axis = edge_hinge(pts, 'rudder')
            axis = axis if axis[1] > 0 else -axis
            movers.append(hinge_mover(ctx, n, 'yaw', 0, piv, axis, 0.4, -0.4, on='tail'))
        else:
            piv, axis = edge_hinge(pts, 'aileron')
            axis = axis if axis[0] > 0 else -axis
            # elevons: pitch on all but the inner trim tabs, roll on the outer ones (game values: pitch 24 deg, roll 22)
            mix = {'pitch': 0.0 if 'Inner' in n else 0.42, 'roll': side * 0.38 if 'Outer' in n else 0.0}
            m = hinge_mover(ctx, n, 'elevon', side, piv, axis, 0.42, -0.42, on='wing')
            m['mix'] = mix
            movers.append(m)
        p.mover = len(movers) - 1
        out.append(p)
    # The source has no gear clip and merges the closed doors, wheels and struts. Rotating that whole
    # region used to swing door fragments below the tyres and twist a single leg by ~145 degrees.
    # Reconstruct coherent struts at the source bay fittings; doors have their own hinges. All visible
    # tyres below are also the wheel-contact source. Original airframe, bays and cockpit stay intact.
    legs = ctx['legs'] = []
    def rod(a,b,r,mover,name,colour=(.55,.58,.60)):
        a,b=np.asarray(a,float),np.asarray(b,float)
        q=wheel_part(g,cg,(a+b)/2,r,float(np.linalg.norm(b-a)),b-a,mover,name,colour)
        q.mat.update(rough=.32,metal=.65)
        out.append(q)
    def assembly(piv,axle,r,width,mover,name):
        piv,axle=np.asarray(piv,float),np.asarray(axle,float)
        lower=piv*.25+axle*.75
        rod(piv,lower,.047,mover,name+'_oleo')
        rod(lower,axle+[0,.08,0],.031,mover,name+'_piston',(.75,.78,.80))
        for sign in [-1,1]:
            rod(axle+[sign*width*.56,.22,.035],axle+[sign*width*.56,0,0],.025,mover,name+'_fork')
        rod(axle+[-width*.65,0,0],axle+[width*.65,0,0],.035,mover,name+'_axle')
        rod(lower,lower+[0,-.12,.13],.018,mover,name+'_torque_upper')
        rod(lower+[0,-.12,.13],axle+[0,.18,0],.018,mover,name+'_torque_lower')
        out.append(wheel_part(g,cg,axle,r,width,[1,0,0],mover,name+'_tyre'))
        hub=wheel_part(g,cg,axle,r*.53,width+.012,[1,0,0],mover,name+'_hub',(.42,.44,.46))
        hub.mat.update(rough=.38,metal=.65);out.append(hub)
    for side, key in ((1, 'L'), (-1, 'R')):  # +x the package's port
        piv=np.array([side*1.29,-.55,-.26]);tip=np.array([side*1.49,-1.65,-.31])
        m=package_hinge_mover(ctx,f'gear_{key}','gear',piv,[0,0,1],-side*95*D2R,n=25)
        m['side']=-side;m['on']='wing';movers.append(m)
        assembly(piv,tip,.33,.22,len(movers)-1,f'gear_{key}')
        legs.append(('main',piv,np.eye(3),tip,.33))
        dp=np.array([side*.843,-.614,.2]);R=axis_angle_m([0,0,1],side*80*D2R)
        m=leg_mover(ctx,f'gear_door_{key}',dp,R,n=25,on='wing');m['side']=-side;movers.append(m)
        out=take_region(out,{'GEAR_ThinPanels'},lambda c,side=side:c[:,0]*side>0,len(movers)-1,f'gear_door_{key}',cg)
    piv=np.array([0,-.70,4.20]);tip=np.array([0,-1.74,4.02])
    movers.append(package_hinge_mover(ctx,'gear_nose','gear',piv,[1,0,0],95*D2R,n=25))
    assembly(piv,tip,.24,.14,len(movers)-1,'gear_nose')
    legs.append(('aux',piv,np.eye(3),tip,.24))
    ctx['gear_reconstruction']=True
    out = wing_split(out, lambda c: (np.abs(c[:, 0]) > 0.8) & (c[:, 1] < 0.1) & (c[:, 2] > -4.2) & (c[:, 2] < 3.2))
    parts.extend(out)


def mirage_measure(parts, movers, ctx, out):
    import measure as M
    res = {}
    g = ctx['sources']['main']
    glass = M.all_points(parts, lambda p: p.group == 'glass' and p.name == 'CANOPY_Glass')
    glass = glass[(glass[:, 2] > ctx['to_game_points'](np.array([[0, 0, 4.2]]), ctx['cg'])[0][2]) & (glass[:, 1] > ctx['to_game_points'](np.array([[0, 0.05, 0]]), ctx['cg'])[0][1])]
    res['canopy'] = M.box(glass)
    ab = M.all_points(parts, lambda p: p.name == 'ENGINE_OriginalAfterburner')
    a, b = ab.min(axis=0), ab.max(axis=0)
    res['jet'] = {'nozzle': round(float(a[2]), 3), 'r': round(float((b[1] - a[1]) / 2 * 0.9), 3), 'y': round(float((a[1] + b[1]) / 2), 3)}
    mz = []
    for nm in ('Weapon_DEFA552_R', 'Weapon_DEFA552_L'):
        q = M.all_points(parts, lambda p, nm=nm: p.name == nm)
        a, b = q.min(axis=0), q.max(axis=0)
        mz.append([round(float((a[0] + b[0]) / 2), 3), round(float((a[1] + b[1]) / 2), 3), round(float(b[2]), 3), 0.3, 0.05])
    res['muzzles'] = sorted(mz, key=lambda m: m[0])
    i = node_index(g, 'CAM_PilotEye')
    res['eye'] = [0.0] + [round(float(v), 3) for v in ctx['to_game_points'](g.world()[i][:3, 3][None, :], ctx['cg'])[0][1:]]
    # the gear (retracted in the model; the game draws it): Mirage 5 main wheels 3.15 m apart, 0.66 m,
    # nose wheel 0.48 m, at the retracted assembly's bays; the ground 4.5 m under the fin's top
    res['gear'] = legs_gear(ctx, 'wing')
    res['gearAnimation']={'source':'reconstructed hinges at source bay fittings; supplied GLB has no gear animation',
                          'parameter':'1 - accepted gear extension','separateDoors':True}
    res['tailless'] = True
    return res


def clip_poly(poly, f):
    """Sutherland-Hodgman: the part of a polygon (list of (P, N, UV) vertices) where f(P) >= 0."""
    out = []
    for k in range(len(poly)):
        a, b = poly[k], poly[(k + 1) % len(poly)]
        fa, fb = f(a[0]), f(b[0])
        if fa >= 0:
            out.append(a)
        if (fa >= 0) != (fb >= 0):
            t = fa / (fa - fb)
            out.append(tuple(a[i] + (b[i] - a[i]) * t for i in range(3)))
    return out


def cut_part(p, inside):
    """Split a part along the planes of a convex region (inside: [f(P) >= 0 ...], game frame): the triangles
    within it (cut cleanly along the planes, normals and texture coordinates interpolated) and the rest.
    Returns (in_part, out_part), either None when empty."""
    T = p.P[p.I]
    vals = np.stack([np.stack([f(T[:, k]) for f in inside], 1) for k in range(3)], 1)  # (m, 3, planes)
    all_in = (vals >= 0).all(axis=(1, 2))
    all_out = (vals < 0).all(axis=1).any(axis=1)
    cross = ~all_in & ~all_out
    uv = p.UV if p.UV is not None else np.zeros((len(p.P), 2))
    newP, newN, newUV, tin, tout = [], [], [], [], []

    def emit(poly, dest):
        if len(poly) < 3:
            return
        base = len(p.P) + len(newP)
        for P_, N_, U_ in poly:
            newP.append(P_)
            newN.append(N_)
            newUV.append(U_)
        for k in range(1, len(poly) - 1):
            dest.append([base, base + k, base + k + 1])
    for t in np.nonzero(cross)[0]:
        tri = [(p.P[i], p.N[i], uv[i]) for i in p.I[t]]
        poly_in = tri
        for f in inside:
            poly_in = clip_poly(poly_in, lambda q, f=f: float(f(q[None, :])[0]))
        emit(poly_in, tin)
        # the rest: the triangle outside each plane in turn (the region is convex)
        rest = tri
        for f in inside:
            emit(clip_poly(rest, lambda q, f=f: -float(f(q[None, :])[0])), tout)
            rest = clip_poly(rest, lambda q, f=f: float(f(q[None, :])[0]))
    P2 = np.concatenate([p.P, np.array(newP).reshape(-1, 3)]) if newP else p.P
    N2 = np.concatenate([p.N, np.array(newN).reshape(-1, 3)]) if newN else p.N
    UV2 = np.concatenate([uv, np.array(newUV).reshape(-1, 2)]) if newUV else uv
    I_in = np.concatenate([p.I[all_in], np.array(tin, dtype=np.int64).reshape(-1, 3)])
    I_out = np.concatenate([p.I[all_out], np.array(tout, dtype=np.int64).reshape(-1, 3)])

    def make(I):
        if not len(I):
            return None
        q = type(p)(**{k: getattr(p, k) for k in p.__slots__})
        q.P, q.N, q.UV, q.I = P2, N2, (UV2 if p.UV is not None else None), I
        return q
    return make(I_in), make(I_out)


def te_surface_region(side, x0, x1, hinge_a, hinge_b, y_lo=-9, y_hi=9):
    """A trailing-edge surface's region (game frame): side's span between |x| x0..x1, aft of the hinge line
    through hinge_a = (|x|, z) and hinge_b, within y_lo..y_hi."""
    (xa, za), (xb, zb) = hinge_a, hinge_b
    k = (zb - za) / (xb - xa)
    return [lambda P: side * P[:, 0] - x0, lambda P: x1 - side * P[:, 0], lambda P: (za + k * (side * P[:, 0] - xa)) - P[:, 2],
            lambda P: P[:, 1] - y_lo, lambda P: y_hi - P[:, 1]]


def region_hinge(part, side):
    """The hinge (game frame) of a surface cut out by te_surface_region: along its forward edge."""
    pts = part.P[np.unique(part.I)]
    piv, axis = edge_hinge(pts, 'aileron')
    return piv, (axis if axis[0] > 0 else -axis)


# ---------------------------------------------------------------- Me 262 A-1a "Yellow 7" (the user's remake)

def me262_build(ctx, gather):
    g = ctx['sources']['main']
    cg = ctx['cg']
    movers, parts = ctx['movers'], ctx['parts']
    W = g.world()
    owner = {}
    # the gear (down in the model): the main legs fold inward into the fuselage, the nose leg aft
    for key, sgn in (('L', 1), ('R', -1)):
        movers.append(package_hinge_mover(ctx, f'gear_{key}', 'gear', [sgn * 1.38, -0.36, 0.03], [0, 0, 1], -sgn * 90 * D2R, n=9))
        for nm in (f'EXT_Gear_Main_{key}', f'EXT_Wheel_Main_{key}'):
            owner[node_index(g, nm)] = len(movers) - 1
    movers.append(package_hinge_mover(ctx, 'gear_nose', 'gear', [0, -0.36, 3.45], [1, 0, 0], 90 * D2R, n=9))
    for nm in ('EXT_Gear_Nose', 'EXT_Wheel_Nose'):
        owner[node_index(g, nm)] = len(movers) - 1

    def cls(g, i):
        n = g.nodes[i]['name']
        ex = g.nodes[i].get('extras') or {}
        cat = ex.get('category')
        if n.startswith(('PILOT_', 'STORE_', 'MOUNT_')) or cat in ('Pilot', 'Stores', 'WeaponMounts'):
            return None
        if i in owner:
            return ('control', owner[i], None)
        if n == 'GLASS_Canopy':
            return 'glass'
        if n.startswith('COCKPIT_') or cat == 'Cockpit':
            return 'cockpit'
        if n.startswith('EXT_'):
            return 'body'
        if cat:
            return ('internal', None, {'id': ex.get('module_id', n), 'category': cat, 'label': ex.get('label_zh')})
        return None
    got = gather(g, None, cg, 'main', cls, movers, W)
    to = lambda q: ctx['to_game_points'](np.asarray(q, float)[None, :], cg)[0]
    out = []
    # the canopy (open in the model, hinged on its starboard sill): its moving glass and frame on one mover,
    # 62.85 deg open at rest (value 1) and closed at value 0. Fitted (user report: it did not close
    # properly; the earlier hinge left its front and rear edges 18.5 cm off the windshield's and the rear
    # glazing's frames): closed, the hood is the mirror of itself and its edges meet the fixed frames
    # (2.8 cm median)
    hinge, OPEN = [-0.337, 0.532, 0.0], 62.85 * D2R
    cmv = package_hinge_mover(ctx, 'canopy', 'canopy', hinge, [0, 0, 1], OPEN, n=7)
    # (the mover turns from closed to the model's open pose: shift the samples by the open angle)
    import copy
    closed = package_hinge_mover(ctx, 'canopy', 'canopy', hinge, [0, 0, 1], -OPEN, n=7)
    cmv['poses'] = [[round(1 - v, 4), q, pv] for v, q, pv in closed['poses']][::-1]
    movers.append(cmv)
    canopy_mover = len(movers) - 1
    zlo, zhi = to([0, 0, -0.9])[2], to([0, 0, 0.32])[2]
    for p in got:
        if p.name in ('GLASS_Canopy', 'EXT_CanopyFrame', 'COCKPIT_OriginalInterior'):
            # the opened hood's pieces: swung out to starboard (game +x) between the windshield and the rear
            # glazing; in the interior, the hood's inner frame (above the sill, user report: it stayed up
            # when the canopy closed)
            mov, fix = [], []
            for ts in control_pieces(p.P, p.I):
                pts = p.P[np.unique(p.I[ts])]
                lo, hi = pts.min(axis=0), pts.max(axis=0)
                cz = pts[:, 2].mean()
                hood = zlo < cz < zhi and (hi[0] > 0.36 or lo[0] > 0.02)
                if p.name == 'COCKPIT_OriginalInterior':
                    hood = hood and lo[1] > to([0, 0.6, 0])[1] and lo[0] > 0.02
                (mov if hood else fix).append(ts)
            for sel, moving in ((mov, True), (fix, False)):
                if not sel:
                    continue
                q = type(p)(**{k: getattr(p, k) for k in p.__slots__})
                q.I = p.I[np.concatenate(sel)]
                if moving:
                    q.mover = canopy_mover
                    q.group = 'glass' if p.name == 'GLASS_Canopy' else 'cockpit' if p.name == 'COCKPIT_OriginalInterior' else 'control'
                out.append(q)
            continue
        out.append(p)
    got, out = out, []
    # the tail: its separate pieces (the fin and tailplane fixed; the rudder, the elevators with their tabs)
    for p in got:
        if p.name != 'EXT_TailSurfaces':
            out.append(p)
            continue
        for ts in control_pieces(p.P, p.I):
            q = type(p)(**{k: getattr(p, k) for k in p.__slots__})
            q.I = p.I[ts]
            pts = p.P[np.unique(q.I)]
            lo, hi = pts.min(axis=0), pts.max(axis=0)
            if abs(lo[0]) < 0.12 and abs(hi[0]) < 0.12 and hi[2] < to([0, 0, -5.65])[2] and hi[1] - lo[1] > 1.0:
                kind = 'rudder'
            elif hi[2] < to([0, 0, -5.3])[2] and max(abs(lo[0]), abs(hi[0])) > 0.3 and hi[1] - lo[1] < 0.2:
                kind = 'elevator'
            else:
                q.group = 'body'
                out.append(q)
                continue
            q.group = 'control'
            q.name = f'EXT_TailSurfaces:{kind}_{len(out)}'
            q.module = {'kind': kind, 'side': 1 if (lo[0] + hi[0]) > 0 else -1}
            out.append(q)
    # elevators (tabs with their elevator) and the rudder, hinged on their forward edges
    for side in (-1, 1):
        el = [q for q in out if q.group == 'control' and q.module and q.module.get('kind') == 'elevator' and q.module['side'] == side]
        if el:
            pts = np.concatenate([q.P[np.unique(q.I)] for q in el])
            piv, axis = edge_hinge(pts, 'elevator')
            axis = axis if axis[0] > 0 else -axis
            movers.append(hinge_mover(ctx, f'elevator_{"r" if side > 0 else "l"}', 'pitch', side, piv, axis, 0.42, -0.35, on='tail'))
            for q in el:
                q.mover, q.module = len(movers) - 1, None
    rd = [q for q in out if q.group == 'control' and q.module and q.module.get('kind') == 'rudder']
    if rd:
        pts = np.concatenate([q.P[np.unique(q.I)] for q in rd])
        piv, axis = edge_hinge(pts, 'rudder')
        axis = axis if axis[1] > 0 else -axis
        movers.append(hinge_mover(ctx, 'rudder', 'yaw', 0, piv, axis, 0.4, -0.4, on='tail'))
        for q in rd:
            q.mover, q.module = len(movers) - 1, None
    # the ailerons: cut from the wing skin outboard of the nacelles, aft of a hinge at 75% of the chord
    shell = [q for q in out if q.name == 'EXT_AirframeShell']
    rest = [q for q in out if q.name != 'EXT_AirframeShell']
    import measure as M
    for side in (-1, 1):
        wing = shell[0].P[shell[0].I]
        wing = wing[(side * wing.mean(axis=1)[:, 0] > 3.0)]
        secs = M.planform(wing * np.array([side, 1, 1]), stations=8)
        sec_at = lambda x: min(secs, key=lambda s_: abs(s_[0] - x))
        x0, x1 = 3.85, 5.95
        ha, hb = sec_at(x0), sec_at(x1)
        hinge_a = (x0, ha[2] - ha[3] * 0.75)
        hinge_b = (x1, hb[2] - hb[3] * 0.75)
        a, b = cut_part(shell[0], te_surface_region(side, x0, x1, hinge_a, hinge_b, y_lo=-0.6, y_hi=0.4))
        shell = [b]
        if a is not None:
            piv, axis = region_hinge(a, side)
            movers.append(hinge_mover(ctx, f'aileron_{"r" if side > 0 else "l"}', 'roll', side, piv, axis, side * 0.35, -side * 0.35, on='wing'))
            a.group, a.mover, a.name = 'control', len(movers) - 1, f'aileron_{"r" if side > 0 else "l"}'
            rest.append(a)
    out = rest + shell
    out = wing_split(out, lambda c: (np.abs(c[:, 0]) > 0.62) & (c[:, 1] < 0.35) & (c[:, 2] > to([0, 0, -3.0])[2]) & (c[:, 2] < to([0, 0, 3.0])[2]))
    for q in out:
        if q.group == 'control' and q.module:
            q.module = None
    parts.extend(out)


def me262_measure(parts, movers, ctx, out):
    import measure as M
    res = {}
    g = ctx['sources']['main']
    res['gear'] = {'kind': 'tricycle', 'main': wheel_spec(parts, ['EXT_Wheel_Main_R'], 'wing'), 'aux': wheel_spec(parts, ['EXT_Wheel_Nose'])}
    # the four MK 108 muzzles (the nose gun ports)
    mz = []
    for nm in ('WPN_MK108_Upper_R', 'WPN_MK108_Upper_L', 'WPN_MK108_Lower_R', 'WPN_MK108_Lower_L'):
        q = M.all_points(parts, lambda p, nm=nm: p.name == nm)
        if not len(q):
            continue
        a, b = q.min(axis=0), q.max(axis=0)
        mz.append([round(float((a[0] + b[0]) / 2), 3), round(float((a[1] + b[1]) / 2), 3), round(float(b[2]) + 0.25, 3), 0.3, 0.05])
    if mz:
        res['muzzles'] = mz
    # the engines: Jumo 004 in the nacelles (the pods' axis, intake, nozzle)
    nac = M.all_points(parts, lambda p: p.name.startswith('EXT_Nacelle'))
    nr = nac[nac[:, 0] > 0]
    a, b = nr.min(axis=0), nr.max(axis=0)
    r = float((b[1] - a[1]) / 2)
    res['jet'] = {'nozzle': round(float(a[2]), 3), 'r': round(r * 0.6, 3), 'pods': [[round(float((a[0] + b[0]) / 2), 3), round(float((a[1] + b[1]) / 2), 3), round(float(b[2]), 3), round(float(a[2]), 3), round(r, 3)]]}
    i = node_index(g, 'PILOT_Goggles') if any(n.get('name') == 'PILOT_Goggles' for n in g.nodes) else None
    eyes = [n.get('name') for n in g.nodes if (n.get('name') or '').startswith('PILOT_') and any(k in n.get('name') for k in ('Goggle', 'Visor', 'Face', 'Head'))]
    if eyes:
        res['eye'] = pilot_eye(g, eyes[0], ctx['cg'])
    return res


# ---------------------------------------------------------------- F-86F-25 Sabre (the user's remake)

def f86_build(ctx, gather):
    g = ctx['sources']['main']
    cg = ctx['cg']
    movers, parts = ctx['movers'], ctx['parts']
    W = g.world()
    authored = any(a.get('name') == 'gear_extend' for a in g.j.get('animations', []))
    gear_owner = {}
    if authored:
        ctx['gear_clip'] = 'gear_extend'
        # The new source extends from up to down; TankForge's mover parameter is retraction.
        got, _ = clip_param_movers(ctx, g, 'gear_extend', 'gear', 193, False, reverse=True, affine=True)
        for nid, m in got:
            m['on'] = 'wing' if 'Main_' in m['name'] or 'Door_L_' in m['name'] or 'Door_R_' in m['name'] else 'body'
            movers.append(m)
            for dd in descendants(g, nid):
                if dd not in gear_owner or len(g.ancestors(nid)) > len(g.ancestors(movers[gear_owner[dd]]['node'])):
                    gear_owner[dd] = len(movers)-1

    def cls(g, i):
        n = g.nodes[i]['name']
        if authored and n.startswith('GEAR_'):
            return ('control', gear_owner[i], None) if i in gear_owner else 'body'
        ex = g.nodes[i].get('extras') or {}
        cat = ex.get('category')
        if n.startswith(('PILOT_', 'STORES_', 'MOUNT_')) or cat in ('Pilot', 'Stores', 'WeaponMounts'):
            return None
        if n == 'CANOPY_Glass' or n == 'COCKPIT_A4Reflector':
            return 'glass'
        if n.startswith('CANOPY_'):
            return 'body'
        if n.startswith('COCKPIT_') or cat == 'Cockpit':
            return 'cockpit'
        if n.startswith('EXT_') or n == 'GEAR_OriginalRetractedAssembly':
            return 'body'
        if cat or n.startswith('INT_'):
            return ('internal', None, {'id': ex.get('module_id', n), 'category': cat or 'Weapons', 'label': ex.get('label_zh')})
        return None
    got = gather(g, None, cg, 'main', cls, movers, W)
    to = lambda q: ctx['to_game_points'](np.asarray(q, float)[None, :], cg)[0]
    out = []
    shell = None
    for p in got:
        if p.name != 'EXT_Airframe':
            out.append(p)
            continue
        comps = control_pieces(p.P, p.I)
        main = max(comps, key=len)
        rest = []
        tail = {(-1): [], 1: []}
        rudder = []
        for ts in comps:
            if ts is main:
                continue
            pts = p.P[np.unique(p.I[ts])]
            lo, hi = pts.min(axis=0), pts.max(axis=0)
            if hi[2] < to([0, 0, -4.9])[2] and lo[1] > 0.2 and hi[1] - lo[1] < 0.4 and hi[0] - lo[0] > 1.0:
                tail[1 if lo[0] + hi[0] > 0 else -1].append(ts)  # a flying tail half and its elevator
            elif abs(lo[0]) < 0.12 and abs(hi[0]) < 0.12 and hi[1] - lo[1] > 1.5 and hi[2] < to([0, 0, -5.6])[2]:
                rudder.append(ts)
            else:
                rest.append(ts)

        def sub(tss, **k):
            q = type(p)(**{a: getattr(p, a) for a in p.__slots__})
            q.I = p.I[np.concatenate(tss)]
            for a, v in k.items():
                setattr(q, a, v)
            return q
        shell = sub([main] + rest)
        for side, tss in tail.items():
            if not tss:
                continue
            q = sub(tss, group='control', name=f'flying_tail_{"r" if side > 0 else "l"}')
            pts = q.P[np.unique(q.I)]
            piv, axis = edge_hinge(pts, 'stabilator')
            axis = axis if axis[0] > 0 else -axis
            # the F-86F's flying tail: the whole tailplane turns (its elevator with it), 10 deg nose up, 5 down
            movers.append(hinge_mover(ctx, q.name, 'pitch', side, piv, axis, 0.26, -0.14, on='tail'))
            q.mover = len(movers) - 1
            out.append(q)
        if rudder:
            q = sub(rudder, group='control', name='rudder')
            piv, axis = edge_hinge(q.P[np.unique(q.I)], 'rudder')
            axis = axis if axis[1] > 0 else -axis
            movers.append(hinge_mover(ctx, 'rudder', 'yaw', 0, piv, axis, 0.4, -0.4, on='tail'))
            q.mover = len(movers) - 1
            out.append(q)
    # ailerons (outboard) and flaps (inboard) cut from the wing skin aft of a hinge at 75% / 78% of the chord
    import measure as M
    for side in (-1, 1):
        wing = shell.P[shell.I]
        wing = wing[(side * wing.mean(axis=1)[:, 0] > 0.8) & (wing.mean(axis=1)[:, 1] < 0.3)]
        secs = M.planform(wing * np.array([side, 1, 1]), stations=10)
        sec_at = lambda x: min(secs, key=lambda s_: abs(s_[0] - x))
        for name, param, x0, x1, frac in (('aileron', 'roll', 2.75, 5.35, 0.75), ('flap', 'flap', 0.78, 2.65, 0.76)):
            a_, b_ = sec_at(x0), sec_at(x1)
            ha, hb = (x0, a_[2] - a_[3] * frac), (x1, b_[2] - b_[3] * frac)
            a, b = cut_part(shell, te_surface_region(side, x0, x1, ha, hb, y_lo=-0.7, y_hi=0.3))
            shell = b
            if a is None:
                continue
            piv, axis = region_hinge(a, side)
            nm = f'{name}_{"r" if side > 0 else "l"}'
            if param == 'roll':
                movers.append(hinge_mover(ctx, nm, 'roll', side, piv, axis, side * 0.3, -side * 0.3, on='wing'))
            else:
                movers.append(hinge_mover(ctx, nm, 'flap', side, piv, axis, -0.65, None, on='wing'))
            a.group, a.mover, a.name = 'control', len(movers) - 1, nm
            out.append(a)
    out.append(shell)
    if authored:
        out = wing_split(out, lambda c: (np.abs(c[:, 0]) > 0.72) & (c[:, 1] < 0.3) & (c[:, 2] > to([0, 0, -3.6])[2]) & (c[:, 2] < to([0, 0, 2.6])[2]))
        parts.extend(out)
        return
    # the gear (modelled retracted, user request: its own gear, extended and retracted): the main legs
    # hinged at the wing's root fold inward, their wheels flat in the fuselage's belly; the nose leg folds
    # aft into the nose. Extended: the legs down, the wheels upright.
    legs = ctx['legs'] = []
    names = {'GEAR_OriginalRetractedAssembly'}
    for side, key in ((1, 'L'), (-1, 'R')):  # +x the package's port
        # Actual tyre centre from the supplied assembly (334-triangle tyre, axle along Y).
        # The previous guessed tip was 21 cm below the wheel centre and gave the wrong contact plane.
        piv, tip = np.array([side * 1.50, -0.57, -0.52]), np.array([side * 0.446, -0.409, -0.365])
        R = leg_rotation(piv, tip, [0, 1, 0])
        movers.append(leg_mover(ctx, f'gear_{key}', piv, R, on='wing'))
        out = take_region(out, names, lambda c, side=side: (side * c[:, 0] > 0.0) & (side * c[:, 0] < 1.62) & (c[:, 2] > -0.85) & (c[:, 2] < 0.05) & (c[:, 1] < -0.2), len(movers) - 1, f'gear_{key}', cg)
        legs.append(('main', piv, R, tip, 0.313))
    piv, tip = np.array([0.0, -0.42, 3.85]), np.array([0.0, -0.461, 2.836])
    R = leg_rotation(piv, tip, [1, 0, 0], down=[0, -1, 0.08])
    movers.append(leg_mover(ctx, 'gear_nose', piv, R))
    out = take_region(out, names, lambda c: (np.abs(c[:, 0]) < 0.36) & (c[:, 2] > 2.3) & (c[:, 2] < 3.95), len(movers) - 1, 'gear_nose', cg)
    legs.append(('aux', piv, R, tip, 0.253))
    out = wing_split(out, lambda c: (np.abs(c[:, 0]) > 0.72) & (c[:, 1] < 0.3) & (c[:, 2] > to([0, 0, -3.6])[2]) & (c[:, 2] < to([0, 0, 2.6])[2]))
    parts.extend(out)


def f86_measure(parts, movers, ctx, out):
    import measure as M
    res = {}
    g = ctx['sources']['main']
    ex = M.all_points(parts, lambda p: p.name == 'Exhaust_Fixed_Nozzle')
    a, b = ex.min(axis=0), ex.max(axis=0)
    res['jet'] = {'nozzle': round(float(a[2]), 3), 'r': round(float((b[1] - a[1]) / 2 * 0.9), 3), 'y': round(float((a[1] + b[1]) / 2), 3)}
    mz = []
    for nm in ('INT_ANM3_L_1', 'INT_ANM3_L_2', 'INT_ANM3_L_3', 'INT_ANM3_R_1', 'INT_ANM3_R_2', 'INT_ANM3_R_3'):
        q = M.all_points(parts, lambda p, nm=nm: p.name == nm)
        a, b = q.min(axis=0), q.max(axis=0)
        mz.append([round(float((a[0] + b[0]) / 2), 3), round(float((a[1] + b[1]) / 2), 3), round(float(b[2]) + 0.2, 3), 0.12, 0.03])
    res['muzzles'] = mz
    res['eye'] = pilot_eye(g, 'PILOT_Goggles_B8', ctx['cg'])
    # the gear (retracted in the model; the game draws it): F-86F 2.36 m track, 26 in main and 18 in nose
    # wheels; the ground 4.5 m under the fin's top (the type's height)
    down = {'main': [], 'aux': []}
    if ctx.get('gear_clip'):
        W = g.world(g.channels(ctx['gear_clip']), g.duration(ctx['gear_clip']))
        res['gear'] = {'kind': 'tricycle'}
        for kind, name in [('main','GEAR_main_l_wheel_GEAR_OriginalRetractedAssembly'),('main','GEAR_main_r_wheel_GEAR_OriginalRetractedAssembly'),('aux','GEAR_nose_wheel_GEAR_OriginalRetractedAssembly')]:
            i = node_index(g, name)
            q = np.concatenate([pr['P'] for pr in g.primitives(i,W[i])])
            q = ctx['to_game_points'](q,ctx['cg']);down[kind].append(q)
            lo, hi = q.min(0),q.max(0);r=float(hi[1]-lo[1])/2
            low = q[q[:,1]<lo[1]+.015]
            wheel = {'x':round(abs(float(np.median(low[:,0]))),4),'y':round(float(lo[1])+r+1,5),
                     'z':round(float(np.median(low[:,2])),5),'len':1.,'r':round(r,6)}
            if kind=='main':wheel['attachment']='wing'
            res['gear'].setdefault(kind,wheel)
        res['gearAnimation'] = {'clip':'gear_extend','duration':g.duration('gear_extend'),'channels':sum(len(c) for c in g.channels('gear_extend').values()),'parameter':'1 - accepted gear extension'}
    else:
        res['gear'] = legs_gear(ctx, 'wing')
        for name, (kind, pivot, R, _, _) in zip(('gear_L', 'gear_R', 'gear_nose'), ctx['legs']):
            q = M.all_points(parts, lambda p: p.mover is not None and movers[p.mover]['name'] == name)
            pg = ctx['to_game_points'](np.asarray(pivot)[None, :], ctx['cg'])[0]
            mirror = np.diag([-1, 1, 1])
            down[kind].append((q - pg) @ (mirror @ R @ mirror).T + pg)
    # Park on the actual deployed tyre surfaces, including their small left/right asymmetry.
    main, aux = (np.concatenate(down[k]) for k in ('main', 'aux'))
    def lowest(q, theta):
        return float(np.min(q[:, 1] * math.cos(theta) + q[:, 2] * math.sin(theta)))
    a, b = -.25, .25
    if (lowest(main,a)-lowest(aux,a)) * (lowest(main,b)-lowest(aux,b)) >= 0:
        raise ValueError('F-86: deployed gear cannot share a runway within 14 degrees of level')
    for _ in range(48):
        t = (a+b)/2
        if lowest(main,t) > lowest(aux,t):
            a = t
        else:
            b = t
    res['groundPitch'] = round((a+b)/2, 7)
    res['groundHeight'] = round(-lowest(main, res['groundPitch']), 5)
    return res


# ---------------------------------------------------------------- F-104G Starfighter (the user's package)

def f104_build(ctx, gather):
    g = ctx['sources']['main']
    cg = ctx['cg']
    movers, parts = ctx['movers'], ctx['parts']
    W = g.world()
    rig = ctx['meta']['rig']
    owner = {}

    def own(nid, k):
        for d in descendants(g, nid):
            owner[d] = k
    # flight controls: hinges at the nodes' rest origins (the source's bone pivots), axes and travel from
    # the package's joint map; its "L" / "R" are the package's -x / +x
    for node, param in (('AILERON_L', 'roll'), ('AILERON_R', 'roll'), ('FLAP_L', 'flap'), ('FLAP_R', 'flap'), ('STABILATOR', 'pitch'), ('RUDDER', 'yaw')):
        j = rig[node]
        i = node_index(g, node)
        piv = ctx['to_game_points'](W[i][:3, 3][None, :], cg)[0]
        axis = game_axis(j['axis_game'])
        ref = 1 if param == 'yaw' else 0
        if axis[ref] < 0:
            axis = -axis
        pts = np.concatenate([pr['P'] for d in descendants(g, i) if 'mesh' in g.nodes[d] for pr in g.primitives(d, W[d])])
        side = 0 if param in ('pitch', 'yaw') else (1 if ctx['to_game_points'](pts.mean(axis=0)[None, :], cg)[0][0] > 0 else -1)
        a = j['max_angle_rad']
        if param == 'roll':
            mv = hinge_mover(ctx, node, 'roll', side, piv, axis, side * a, -side * a, on='wing')
        elif param == 'flap':
            mv = hinge_mover(ctx, node, 'flap', side, piv, axis, -a, None, on='wing')
        elif param == 'pitch':
            mv = hinge_mover(ctx, node, 'pitch', 0, piv, axis, a, -a, on='tail')
        else:
            mv = hinge_mover(ctx, node, 'yaw', 0, piv, axis, a, -a, on='tail')
        movers.append(mv)
        own(i, len(movers) - 1)
    for nid, m in clip_range_movers(ctx, g, 'airbrake_open', 'airbrake'):
        movers.append(m)
        own(nid, len(movers) - 1)
    for nid, m in clip_range_movers(ctx, g, 'gear_retract', 'gear', n=13):
        movers.append(m)
        own(nid, len(movers) - 1)
    for nid, m in clip_range_movers(ctx, g, 'canopy_open', 'canopy'):
        movers.append(m)
        own(nid, len(movers) - 1)
    # deepest mover owns a mesh (a door inside its leg's subtree): re-own by depth
    for k, m in enumerate(movers):
        pass

    def cls(g, i):
        n = g.nodes[i]['name']
        ex = g.nodes[i].get('extras') or {}
        role, mod = ex.get('role'), ex.get('module_id')
        if role in ('effect', 'weapon'):
            return None
        mv = owner.get(i)
        if role == 'canopy':
            return ('glass' if 'glass' in n else 'control' if mv is not None else 'body', mv, None)
        if role == 'instrument_display':
            return ('cockpit',mv,{'instrument':{'id':ex.get('instrument_id',n),
                    'field':ex.get('telemetry_field'),'kind':ex.get('display_kind')}})
        if role == 'cockpit' or n == 'hud' or role == 'hud':
            return ('cockpit', mv, None)
        if mv is not None:
            return ('control', mv, None)
        if role == 'exterior':
            return 'body'
        if role in ('internal', 'engine'):
            return ('internal', None, {'id': mod or n, 'category': mod or role, 'label': n})
        # (user report: the F-104 had holes) flaps, airbrake panels and gear doors without a motion of their own
        if role in ('control_surface', 'landing_gear'):
            return 'body'
        return None
    got = gather(g, None, cg, 'main', cls, movers, W)
    # the source model's own inner parts seen from outside (user report: the intakes and the tail were
    # empty): the intake ducts, the J79 and its nozzle, the bays; drawn with the airframe as well as in
    # the X-ray (the generated system boxes stay X-ray only)
    from convert import Part
    seen = {g.nodes[i].get('name') for i in g.mesh_nodes() if (g.nodes[i].get('extras') or {}).get('role') in ('internal', 'engine') and not (g.nodes[i].get('extras') or {}).get('generated')}
    got += [Part(**{**{a: getattr(p, a) for a in Part.__slots__}, 'group': 'body', 'module': None}) for p in got if p.group == 'internal' and p.name in seen]
    to = lambda q: ctx['to_game_points'](np.asarray(q, float)[None, :], cg)[0]
    got = wing_split(got, lambda c: (np.abs(c[:, 0]) > 0.78) & (c[:, 1] < to([0, 1.25, 0])[1]) & (c[:, 2] > to([0, 0, -4.3])[2]) & (c[:, 2] < to([0, 0, -0.5])[2]))
    # The supplied INSTRUMENT_* faces explicitly overlay the original blank caps. Quantization and
    # the world camera's depth precision otherwise make those almost-coplanar layers alternate.
    eye = ctx['to_game_points'](np.asarray(next(s for s in ctx['meta']['sockets'] if s['node'] == 'PILOT_VIEW')['position_game'])[None, :], cg)[0]
    for p in got:
        if not p.name.startswith('INSTRUMENT_'):
            continue
        points = p.P[np.unique(p.I)]
        centre = points.mean(0)
        _, _, vh = np.linalg.svd(points-centre, full_matrices=False)
        normal = vh[-1]
        if np.dot(normal, eye-centre) < 0:
            normal = -normal
        p.P = p.P + normal * .003
    parts.extend(got)


def f104_measure(parts, movers, ctx, out):
    import measure as M
    res = {}
    sockets = {s_['node']: s_ for s_ in ctx['meta']['sockets']}
    P = lambda q: ctx['to_game_points'](np.asarray(q, float)[None, :], ctx['cg'])[0]
    ex = P(sockets['ENGINE_EXIT']['position_game'])
    eng = M.all_points(parts, lambda p: p.group == 'body' and p.name.startswith(('engine_housing', 'end_fuslage')))
    tail = eng[(eng[:, 2] < ex[2] + 0.5) & (np.abs(eng[:, 0]) < 0.8)]
    res['jet'] = {'nozzle': round(float(ex[2]), 3), 'r': round(float(np.abs(tail[:, 0]).max() * 0.8), 3), 'y': round(float(ex[1]), 3)}
    gm = P(sockets['GUN_MUZZLE']['position_game'])
    res['muzzles'] = [[round(float(gm[0]), 3), round(float(gm[1]), 3), round(float(gm[2]), 3), 0.15, 0.05]]
    eye = P(sockets['PILOT_VIEW']['position_game'])
    res['eye'] = [0.0, round(float(eye[1]), 3), round(float(eye[2]), 3)]
    # the wheels: the gear's lowest points, gear down (the rest pose)
    def wheel(test, attachment=None):
        pts = M.all_points(parts, lambda p: p.group == 'control' and p.mover is not None and movers[p.mover]['param'] == 'gear' and test(p))
        lo, hi = pts.min(axis=0), pts.max(axis=0)
        low = pts[pts[:, 1] < lo[1] + 0.04]
        r = 0.3 if attachment else 0.23
        o = {'x': round(float(abs(np.median(low[:, 0]))), 3), 'y': round(float(lo[1]) + r + 1.0, 3), 'z': round(float(np.median(low[:, 2])), 3), 'len': 1.0, 'r': r}
        if attachment:
            o['attachment'] = attachment
        return o
    res['gear'] = {'kind': 'tricycle', 'main': wheel(lambda p: p.P[np.unique(p.I)][:, 0].mean() > 0.1, 'fuselage'), 'aux': wheel(lambda p: 'NOSE' in movers[p.mover]['name'])}
    return res


TYPES = {
    'mig29': {
        'source': {'title': "MiG-29 Ukrainian Falcons, the user's remake", 'author': '42manako (source model), the user (remake)', 'license': 'CC BY 4.0 (source)', 'package': 'Desktop/mig29_viewer.html (the GLB it embeds; the zip was truncated)'},
        'files': {'main': 'mig29/mig29_remake.glb'},
        'cg': [0.0, 0.25, -0.25],
        'cg_why': ("MiG-29 9.12: main wheels at the main gear bays' aft end (model z -0.55) and the nose wheel ahead of the intakes, the real "
                   "3.645 m wheelbase; the centre of gravity 0.3 m ahead of the main wheels (z -0.25, ~25% of the mean aerodynamic chord); "
                   "height on the engines' axis + 0.25 m"),
        'build': mig29_build,
        'measure': mig29_measure,
        'wing_root': 1.55,
        'fuselage_half_width': 1.6,
        'module_kinds': {'engine': ['engine'], 'fuel': ['int_fuel_0', 'int_fuel_3a'], 'radar': ['radar']},
        # the cockpit view's cockpit: the package's at full detail on its own atlas; from outside simplified
        'budgets': {'cockpit': 30000},
        'cockpit_hi': 4096,
        'atlas': 2048,
    },
    'hunter6': {
        'source': {'title': "Hawker Hunter F.4 (RAF, TF004), the user's remake", 'author': 'manilov.ap (source model), the user (remake)', 'license': 'CC BY 4.0 (source)', 'package': 'Desktop/Hunter_F4_TankForge.zip'},
        'files': {'main': 'Hunter_F4_TankForge/Hunter_F4_TankForge/hunter.glb', 'internals': 'Hunter_F4_TankForge/Hunter_F4_TankForge/hunter_internals.glb'},
        'meta_files': {'controls': ('Hunter_F4_TankForge/Hunter_F4_TankForge/control_surfaces.json', 'surfaces')},
        'cg': mac_cg('main', ['exterior__wing_L'], 0.0, 'Hunter F.4: the wing (exterior__wing_L, the port panel, 45 deg swept)'),
        'cg_why': '',
        'build': hunter_build,
        'measure': hunter_measure,
        'eye_camera': 'camera__cockpit',
        'wing_root': 0.6,
        'fuselage_half_width': 0.75,
        'module_kinds': {'engine': ['engine_avon'], 'fuel': ['fuel_fuselage'], 'ammo': ['ammo', 'aden']},
        # the cockpit view's cockpit: the package's at full detail on its own atlas; from outside simplified
        'budgets': {'cockpit': 30000},
        'cockpit_hi': 4096,
        'atlas': 2048,
    },
    'mig15': {
        'source': {'title': "MiG-15bis (Soviet '23'), the user's remake", 'author': 'Pixel / stefan.lengyel1 (source model, Mig-15 low poly), the user (remake)', 'license': 'CC BY 4.0 (source)', 'package': 'Desktop/MiG15bis_TankForge_Complete.zip'},
        'files': {'main': 'MiG15bis_TankForge_Complete/MiG15bis_TankForge/MiG15bis_ussr_23_TankForge.glb'},
        'cg': shell_cg('main', lambda g, i: 'exterior_shell' in [g.nodes[a].get('name') for a in g.ancestors(i)], lambda c: (np.abs(c[:, 0]) > 0.72) & (c[:, 1] < 0.55) & (c[:, 2] > -3.3), 0.0,
                       'MiG-15bis: the wing (the shell outboard of the fuselage, 35 deg swept)'),
        'cg_why': '',
        'build': mig15_build,
        'measure': mig15_measure,
        'wing_root': 0.75,
        'fuselage_half_width': 0.75,
        'module_kinds': {'engine': ['vk1'], 'fuel': ['fuel'], 'ammo': ['ammo', 'magazine', 'belt']},
        # the cockpit view's cockpit: the package's at full detail on its own atlas; from outside simplified
        'budgets': {'cockpit': 30000},
        'cockpit_hi': 4096,
        'atlas': 2048,
    },
    'mirage3e': {
        'source': {'title': "Dassault Mirage 5F, the user's remake", 'author': 'KojfDiscord (source parts), the user (remake)', 'license': 'see the package (CC BY 4.0 source parts)', 'package': 'Desktop/mirage5f_viewer.html (the GLB it embeds)'},
        'files': {'main': 'mirage/mirage5f.glb'},
        'cg': shell_cg('main', lambda g, i: g.nodes[i].get('name') == 'EXTERIOR_Airframe', lambda c: (np.abs(c[:, 0]) > 0.8) & (c[:, 1] < 0.1) & (c[:, 2] > -4.2) & (c[:, 2] < 3.2), 0.0,
                       'Mirage 5F: the delta wing (the airframe outboard of the fuselage)'),
        'cg_why': '',
        'build': mirage_build,
        'measure': mirage_measure,
        'wing_root': 0.8,
        'fuselage_half_width': 0.8,
        'module_kinds': {'engine': ['engine_atar'], 'fuel': ['fuel_forward', 'fuel_rearcockpit', 'fuel_upper'], 'ammo': ['weapon_ammo']},
        # the cockpit view's cockpit: the package's at full detail on its own atlas; from outside simplified
        'budgets': {'cockpit': 30000},
        'cockpit_hi': 4096,
        'atlas': 2048,
    },
    'me262': {
        'source': {'title': "Me 262 A-1a 'Yellow 7', the user's remake", 'author': 'Helijah (source model), the user (remake)', 'license': 'see the package (CREDITS_AND_LICENSES.md)', 'package': 'Desktop/me262_remake_complete.zip'},
        'files': {'main': 'me262_remake_complete/me262-remake/me262_a1a_remake.glb'},
        'cg': shell_cg('main', lambda g, i: g.nodes[i].get('name') == 'EXT_AirframeShell', lambda c: (np.abs(c[:, 0]) > 0.62) & (c[:, 1] < 0.35) & (c[:, 2] > -3.0) & (c[:, 2] < 3.0), 0.0,
                       'Me 262 A-1a: the wing (the airframe skin outboard of the fuselage, 18.5 deg swept)'),
        'cg_why': '',
        'build': me262_build,
        'measure': me262_measure,
        'wing_root': 0.62,
        'fuselage_half_width': 0.62,
        'module_kinds': {'engine': ['engine', 'jumo'], 'fuel': ['fuel'], 'ammo': ['ammo']},
        # the cockpit view's cockpit: the package's at full detail on its own atlas; from outside simplified
        'budgets': {'cockpit': 30000},
        'cockpit_hi': 4096,
        'atlas': 2048,
    },
    'f86f': {
        'source': {'title': "F-86F-25 Sabre, the user's animated landing-gear update", 'author': 'KojfDiscord (source model), the user (remake and gear)', 'license': 'see the package (CREDITS.txt)', 'package': 'Desktop/f86_gear_update.zip'},
        'files': {'main': 'f86_gear_update/F86_Gear_Update/f86f25_remake.glb'},
        'cg': shell_cg('main', lambda g, i: g.nodes[i].get('name') == 'EXT_Airframe', lambda c: (np.abs(c[:, 0]) > 0.72) & (c[:, 1] < 0.3) & (c[:, 2] > -3.6) & (c[:, 2] < 2.6), 0.0,
                       'F-86F-25: the wing (the airframe skin outboard of the fuselage, 35 deg swept)'),
        'cg_why': '',
        'build': f86_build,
        'measure': f86_measure,
        'wing_root': 0.72,
        'fuselage_half_width': 0.72,
        'module_kinds': {'engine': ['engine_j47'], 'fuel': ['fuel_forward', 'fuel_aft'], 'ammo': ['ammobox']},
        # the cockpit view's cockpit: the package's at full detail on its own atlas; from outside simplified
        'budgets': {'cockpit': 30000},
        'cockpit_hi': 4096,
        'atlas': 2048,
    },
    'f104g': {
        'source': {'title': "F-104G Starfighter, the user's TankForge package", 'author': '42manako (source model, German F-104G), the user (package)', 'license': 'CC BY 4.0 (source)', 'package': 'Desktop/F104G_TankForge_Complete.zip'},
        'files': {'main': 'F104G_TankForge_Complete/F104G_TankForge_Complete/assets/f104g_lod1.glb'},
        'meta_files': {'rig': ('F104G_TankForge_Complete/F104G_TankForge_Complete/assets/scene_manifest.json', 'rig_joint_map'),
                       'sockets': ('F104G_TankForge_Complete/F104G_TankForge_Complete/assets/scene_manifest.json', 'sockets')},
        'cg': shell_cg('main', lambda g, i: (g.nodes[i].get('extras') or {}).get('role') == 'exterior', lambda c: (np.abs(c[:, 0]) > 0.78) & (c[:, 1] < 1.25) & (c[:, 2] > -4.3) & (c[:, 2] < -0.5), 1.17,
                       'F-104G: the wing (the exterior outboard of the fuselage, a thin straight trapezoid)'),
        'cg_why': '',
        'build': f104_build,
        'measure': f104_measure,
        'wing_root': 0.78,
        'fuselage_half_width': 0.78,
        'module_kinds': {'engine': ['engine'], 'fuel': ['fuel'], 'ammo': ['gun'], 'radar': ['radar']},
        'budgets': {'cockpit': 45000, 'control': 26000},
        # the package's full cockpit (356,197 source triangles, kept at every LOD): for the cockpit view
        'cockpit_hi': 4096,
        'atlas': 2048,
    },
}


# ---------------------------------------------------------------- the user's eight-aircraft pack (2026-10-23)
#
# TankForge_8_Aircraft_20261023.zip: aircraft/<id>/model.glb, each with its clips roll / pitch / yaw (negative
# limit -> neutral at the clip's middle -> positive limit), flap (up -> down), gear (down -> up), its
# COCKPIT_EYE node; the package's tools and its native records are not used (its scripts are untrusted
# data; the records are its converter's): the GLB is converted here as the others are.

def clip_param_movers(ctx, g, clip, param, n, two_way, reverse=False, affine=False):
    """Movers for every node a clip animates. two_way: values -1..1 over the clip (neutral at its middle),
    the clip's direction turned to the game's sense (SENSE) on the starboard-most node; else 0..1 over it.
    A node animated inside another node of the same clip gets its pose relative to that node (the game
    hangs it under it)."""
    from convert import game_delta, mat_quat, to_game_points
    cg = ctx['cg']
    ch = g.channels(clip)
    d = g.duration(clip)
    W0 = g.world()
    nodes = sorted(ch)
    piv = {nid: to_game_points(W0[nid][:3, 3][None, :], cg)[0] for nid in nodes}
    sgn = 1.0
    if two_way:
        ref = max(nodes, key=lambda nid: piv[nid][0])
        Rg, _ = game_delta(g.world(ch, d)[ref] @ np.linalg.inv(W0[ref]), cg)
        ax = np.array([0, 1, 0]) if param == 'yaw' else np.array([1, 0, 0])
        side = 1 if piv[ref][0] > 0.05 else 0
        want = SENSE[param](side if param == 'roll' else 1)
        sgn = 1.0 if (signed_angle(mat_quat(Rg), ax) > 0) == (want > 0) else -1.0
        values = [-1, -0.5, 0, 0.5, 1]
        times = [d / 2 * (1 + sgn * v) for v in values]
    else:
        values = [k / (n - 1) for k in range(n)]
        times = [d * (1-v if reverse else v) for v in values]
    Ws = [g.world(ch, t) for t in times]
    poses = {nid: [] for nid in nodes}
    for v, W in zip(values, Ws):
        for nid in nodes:
            Rg, dg = game_delta(W[nid] @ np.linalg.inv(W0[nid]), cg)
            poses[nid].append((v, Rg, Rg @ piv[nid] + dg))
    out = []
    for nid in nodes:
        par = next((a for a in g.ancestors(nid) if a in ch), None)
        ps = []
        for k, (v, Rc, tc) in enumerate(poses[nid]):
            if par is not None:
                _, Rp, tp = poses[par][k]
                inv = np.linalg.inv(Rp)
                Rc, tc = inv @ Rc, inv @ (tc - tp) + piv[par]
            pose = [round(v, 7), [0,0,0,1] if affine else [round(float(c), 6) for c in mat_quat(Rc)], [round(float(c), 6) for c in tc]]
            # Object-space nonuniform stretch becomes a full affine delta after baking to aircraft
            # coordinates. Keep it: decomposing it as a rotation lost the hydraulic rods' extension.
            if affine:
                pose.append([round(float(c),8) for c in Rc.reshape(-1)])
            ps.append(pose)
        nm = g.nodes[nid].get('name')
        side = 1 if piv[nid][0] > 0.05 else -1 if piv[nid][0] < -0.05 else 0
        on = 'wing' if param in ('roll', 'flap') else 'tail' if param in ('pitch', 'yaw') else 'body'
        out.append((nid, {'name': nm, 'kind': param, 'param': param, 'side': side, 'p': [round(float(c), 4) for c in piv[nid]], 'axis': [1, 0, 0], 'poses': ps, 'on': on, 'node': nid}))
    return out, sgn


def pack8_cg(T):
    """cg(sources): 25% of the main wing's mean aerodynamic chord (its triangles: T['wing_box'] on their centres,
    package frame, the stores left out), height T['cg_y']."""
    def f(sources):
        g = sources['main']
        W = g.world()
        x0, z0, z1, y0, y1 = T['wing_box']
        tris = []
        for i in g.mesh_nodes():
            n = g.nodes[i].get('name', '')
            if n in T.get('cg_drop', T.get('drop', ())):
                continue
            for pr in g.primitives(i, W[i]):
                t = pr['P'][pr['I']]
                c = t.mean(axis=1)
                tris.append(t[(c[:, 0] > x0) & (c[:, 2] > z0) & (c[:, 2] < z1) & (c[:, 1] > y0) & (c[:, 1] < y1)])
        z, mac, zle = wing_mac_cg(np.concatenate(tris))
        return [0.0, T.get('cg_y', (y0 + y1) / 2), round(float(z), 4)], f'{T["source"]["title"]}: the wing (|x| > {x0}, z {z0}..{z1}) MAC {mac:.2f} m, its leading edge at z {zle:.2f}: the centre of gravity at 25% of it (z {z:.2f}).'
    return f


def pack8_build(ctx, gather):
    g = ctx['sources']['main']
    cg = ctx['cg']
    T = ctx['type']
    movers, parts = ctx['movers'], ctx['parts']
    owner = {}
    ctx['senses'] = {}
    names = [a.get('name') for a in g.j.get('animations', [])]
    for clip, param, n, two in (('roll', 'roll', 5, True), ('pitch', 'pitch', 5, True), ('yaw', 'yaw', 5, True), ('flap', 'flap', 9, False), ('gear', 'gear', 13, False)):
        if clip not in names:
            continue
        got, sgn = clip_param_movers(ctx, g, clip, param, n, two)
        ctx['senses'][clip] = sgn
        for nid, m in got:
            movers.append(m)
            for dd in descendants(g, nid):
                # the deepest mover owns a mesh
                if dd not in owner or len(g.ancestors(nid)) > len(g.ancestors(movers[owner[dd]]['node'])):
                    owner[dd] = len(movers) - 1
    cockpit_re = re.compile(T.get('cockpit_re', r'^(cockpit|A10C_|F16_|F16V_|seats_|hatch_|Object04)'), re.I)
    glass_re = re.compile(r'glass|windshield|cristal', re.I)

    def cls(g, i):
        n = g.nodes[i].get('name', '')
        if n in T.get('drop', ()) or n.startswith('COCKPIT_EYE'):
            return None
        mv = owner.get(i)
        if glass_re.search(n):
            return ('glass', mv, None)
        if cockpit_re.search(n):
            return ('cockpit', mv, None)
        if mv is not None:
            return ('control', mv, None)
        if n.lower().startswith('wing_l'):
            return 'wing_l'
        if n.lower().startswith('wing_r'):
            return 'wing_r'
        return 'body'
    got = gather(g, None, cg, 'main', cls, movers, g.world())
    # the glass away from the cockpit (nav lights, lenses, antenna wires) drawn with the airframe
    i = node_index(g, 'COCKPIT_EYE')
    eye = ctx['to_game_points'](g.world()[i][:3, 3][None, :], cg)[0]
    from convert import Part
    out = []
    for p in got:
        if p.group == 'glass' and p.mover is None:
            c = p.P[p.I].mean(axis=1)
            near = (np.abs(c[:, 0]) < 0.9) & (np.abs(c[:, 2] - eye[2]) < T.get('canopy_reach', 2.6)) & (c[:, 1] > eye[1] - 0.8)
            if (~near).any():
                # (still glass: the antenna wires and lenses are see-through, user report: a wire drawn as a black
                # bar; '_away' keeps them out of the canopy's measure)
                q = Part(**{a: getattr(p, a) for a in Part.__slots__})
                q.I, q.name = p.I[~near], p.name + '_away'
                out.append(q)
                p.I = p.I[near]
            if len(p.I):
                out.append(p)
            continue
        out.append(p)
    # the main wing apart from the body (its panels shot away with it): the wing box, game frame
    x0, z0, z1, y0, y1 = T['wing_box']
    toz = lambda z: z - cg[2]
    toy = lambda y: y - cg[1]
    out = wing_split(out, lambda c: (np.abs(c[:, 0]) > x0) & (c[:, 2] > toz(z0)) & (c[:, 2] < toz(z1)) & (c[:, 1] > toy(y0)) & (c[:, 1] < toy(y1)))
    parts.extend(out)


def pack8_measure(parts, movers, ctx, out):
    import measure as M
    T = ctx['type']
    g = ctx['sources']['main']
    res = {}
    P = lambda q: ctx['to_game_points'](np.asarray(q, float)[None, :], ctx['cg'])[0]
    W = g.world()
    e = P(W[node_index(g, 'COCKPIT_EYE')][:3, 3])
    res['eye'] = [0.0, round(float(e[1]), 3), round(float(e[2]), 3)]
    z_, y_, r_, *tw = T['jet']
    jp = P([0, y_, z_])
    res['jet'] = {'nozzle': round(float(jp[2]), 3), 'r': r_, 'y': round(float(jp[1]), 3)}
    if tw:
        res['jet']['twin'] = tw[0]
    # the wheels: the gear's lowest points, gear down (the rest pose)
    gear = lambda p: p.mover is not None and movers[p.mover]['param'] == 'gear'

    def wheel(test, r, attachment=None):
        pts = M.all_points(parts, lambda p: gear(p) and test(p))
        lo = pts.min(axis=0)
        low = pts[pts[:, 1] < lo[1] + 0.04]
        o = {'x': round(float(abs(np.median(low[:, 0]))), 3), 'y': round(float(lo[1]) + r + 1.0, 3), 'z': round(float(np.median(low[:, 2])), 3), 'len': 1.0, 'r': r}
        if attachment:
            o['attachment'] = attachment
        return o
    mid = lambda p: p.P[np.unique(p.I)].mean(axis=0)
    rm, rn = T['wheels']
    res['gear'] = {'kind': 'tricycle', 'main': wheel(lambda p: mid(p)[0] > 0.35, rm, T['attachment']), 'aux': wheel(lambda p: abs(mid(p)[0]) < 0.35 and mid(p)[2] > 0, rn)}
    res['ground'] = round(float(M.all_points(parts, gear)[:, 1].min()), 3)
    # the damage parts (the model has no internals of its own; the X-ray draws these): the engines along the
    # jet pipes' axes, the fuel in the fuselage over the wing
    env = out.get('fuselage') or []
    fy = out.get('fuseY', 0.0)
    at = lambda z: min(env, key=lambda e: abs(e[0] - z)) if env else [z, 0.6, 0.6]
    zn, r, jy, tw = res['jet']['nozzle'], res['jet']['r'], res['jet']['y'], res['jet'].get('twin', 0)
    L = T.get('engine_len', 4.2)
    res['parts'] = {'engine': [[0.0, round(jy, 3), round(zn + L / 2 + 0.3, 3)], [round(tw + r * 1.1, 3), round(r * 1.1, 3), round(L / 2, 3)]]}
    e = at(0.3)
    res['parts']['fuel'] = [[0.0, round(fy, 3), 0.3], [round(min(e[1] * 0.6, 1.2), 3), round(min(e[2] * 0.45, 0.6), 3), 1.4]]
    return res


def _pack8(id_, title, author, lic, **k):
    T = {'source': {'title': title, 'author': author + ' (source model), the user (pack: movers, clips, cockpit)', 'license': lic, 'package': 'Desktop/TankForge_8_Aircraft_20261023.zip'},
         'files': {'main': f'pack8/TankForge_Aircraft_Pack/aircraft/{id_}/model.glb'},
         'cg_why': '', 'build': pack8_build, 'measure': pack8_measure, 'module_kinds': {},
         'budgets': {'cockpit': 30000}, 'cockpit_hi': 4096, 'atlas': 2048}
    T.update(k)
    T['wing_root'] = T['fuselage_half_width'] = k['wing_box'][0]
    T['cg'] = pack8_cg(T)
    return T


TYPES.update({
    'f15c': _pack8('f15e', 'F-15E Strike Eagle', 'bohmerang', 'CC BY-NC-SA 4.0', wing_box=(2.0, -5.7, 0.6, -0.7, 0.3), jet=(-8.0, -0.25, 0.48, 0.85), wheels=(0.42, 0.28), attachment='fuselage'),
    'a10a': _pack8('a10c', 'A-10C Thunderbolt II', 'VTX', 'CC BY-NC-SA 4.0', wing_box=(0.8, -1.5, 1.4, -1.0, 0.1),
                   drop=('body_source_00', 'body_source_01', 'body_source_03', 'body_source_04', 'body_source_06', 'body_source_11', 'body_source_12', 'body_source_13', 'body_source_14', 'body_source_15', 'body_source_17', 'body_source_18', 'body_source_21', 'body_source_42'),
                   jet=(-4.6, 0.75, 0.45, 1.2), wheels=(0.45, 0.36), attachment='wing'),
    'f4e': _pack8('f4e', 'F-4E Phantom II', 'Kenny3D89', 'CC BY 4.0', wing_box=(1.4, -4.9, 1.0, -0.9, 0.1), jet=(-6.0, -0.3, 0.45, 0.55), wheels=(0.4, 0.25), attachment='wing'),
    'su27': _pack8('su27ubk', 'Su-27UBK', 'Rhine_Lab_Muelsyse', 'CC BY 4.0', wing_box=(2.4, -6.4, 0.2, -0.8, 0.1),
                   drop=('AAM_wings_Material #73_0', 'BOMB1_Material #73_0', 'BOMB2_Material #73_0', 'BOMB3_Material #73_0', 'ECM_Material #73_0'),
                   jet=(-9.0, -0.4, 0.55, 0.85), wheels=(0.45, 0.33), attachment='fuselage'),
    # 11/12 are the fixed wing pylons and their rails, not removable ordnance. 14 is the old store.
    'mig17f': _pack8('mig17f', 'MiG-17', 'KojfDiscord', 'CC BY 4.0', wing_box=(0.8, -3.9, 1.7, -0.7, 0.4), drop=('body_source_00', 'body_source_14'),
                     cg_drop=('body_source_00', 'body_source_11', 'body_source_12', 'body_source_14'),measure_exclude=('body_source_11','body_source_12'),
                     jet=(-5.6, 0.35, 0.36), wheels=(0.33, 0.24), attachment='wing'),
    'mig21': _pack8('mig21mf', 'MiG-21MF', 'KojfDiscord', 'CC BY 4.0', wing_box=(0.65, -3.4, 1.8, -0.9, -0.2), drop=('wing_l_source21', 'wing_l_source22', 'wing_r_source20', 'wing_r_source23'),
                    jet=(-6.2, 0.0, 0.45), wheels=(0.33, 0.25), attachment='fuselage'),
    'su25': _pack8('su25', 'Su-25', 'KojfDiscord', 'CC BY 4.0', wing_box=(1.35, -2.4, 1.5, -0.6, 0.6), drop=('body_source_02', 'body_source_03', 'body_source_04', 'body_source_05', 'body_source_06', 'body_source_07'),
                   jet=(-4.0, -0.05, 0.38, 0.7), wheels=(0.42, 0.3), attachment='fuselage'),
    'f16v': _pack8('f16v', 'ROCAF F-16V Viper', 'KojfDiscord', 'CC BY 4.0', wing_box=(1.1, -3.8, 2.4, -1.0, -0.4), drop=('body_source04', 'wing_l_source34', 'wing_r_source35'),
                   jet=(-7.2, -0.75, 0.5), wheels=(0.35, 0.23), attachment='fuselage'),
})
