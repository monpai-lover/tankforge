"""Model-frame alignment shared by imported aircraft. All exported points use the mesh's CG transform.

Opaque source names in the eight-aircraft pack require explicit optical regions. These boxes select
existing triangles, not replacement glass; the rest of a combined canopy/lamp mesh stays intact.
"""
import re
import numpy as np

# Source coordinates, metres (+X port, +Y up, +Z nose); measured on supplied GLBs.
OPTICS = {
    'f4e': ('cockpit_source_m6_c0', (-.10, .65, 4.90), (.10, .79, 5.05)),
    'f15c': ('cockpit_source_m03_c000', (-.16, .50, 5.57), (.16, .73, 5.73)),
    'a10a': ('body_source_16', (-.15, .13, 5.75), (.15, .43, 6.07)),
    'f16v': ('body_source33', (-.10, .00, 3.79), (.10, .20, 4.02)),
    'su25': ('glass_source_38', (-.10, .29, 3.91), (.09, .45, 4.04)),
    'mig21': ('glass_source15', (-.13, .26, 3.26), (.13, .41, 3.41)),
    'mig17f': ('glass_source_13', (-.06, .82, 2.25), (.03, .90, 2.35)),
}
SIGHT = re.compile(r'A4Reflector|SightGlass|Reflector_Glass|sight_combiner|^hud__|GLASS_HUD|cristal_hud', re.I)


def prepare(parts, ctx, type_id):
    from convert import Part, to_game_points
    region = OPTICS.get(type_id)
    if not region:
        return
    name, a, b = region
    corners = to_game_points(np.array([a, b]), ctx['cg'])
    lo, hi = corners.min(0) - .002, corners.max(0) + .002
    added = []
    for p in parts:
        if p.name != name or p.mover is not None:
            continue
        t = p.P[p.I]
        selected = ((t >= lo).all(2) & (t <= hi).all(2)).all(1)
        if not selected.any():
            continue
        q = Part(**{k: getattr(p, k) for k in Part.__slots__})
        q.I, q.name, q.group = p.I[selected], 'HUD_GLASS:' + name, 'glass'
        q.mat = {**p.mat, 'alpha': .12, 'blend': True, 'tex': None, 'ntex': None, 'metal': 0.0, 'rough': .08}
        p.I = p.I[~selected]
        added.append(q)
    if not added:
        raise ValueError(f'{type_id}: configured combiner has no source triangles')
    parts[:] = [p for p in parts if len(p.I)] + added


def surface_y(tris, x, z, default):
    """Vertical intersection with the actual mesh; use the lowest local face (including a fixed pylon)."""
    a, u, v = tris[:, 0], tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0]
    den = u[:, 0] * v[:, 2] - u[:, 2] * v[:, 0]
    ok = np.abs(den) > 1e-10
    den = np.where(ok, den, 1)
    dx, dz = x - a[:, 0], z - a[:, 2]
    s = (dx * v[:, 2] - dz * v[:, 0]) / den
    t = (u[:, 0] * dz - u[:, 2] * dx) / den
    ok &= (s >= -1e-5) & (t >= -1e-5) & (s + t <= 1.00001)
    ys = (a[:, 1] + s * u[:, 1] + t * v[:, 1])[ok]
    # An aperture can leave only the dorsal face under the ray; it is not an underside attachment.
    return min(float(ys.min()), float(default)) if len(ys) else float(default)


def shift_optical_assembly(parts, bounds, offset):
    for p in parts:
        if p.mover is None and p.group == 'glass' and (p.name.startswith('HUD_GLASS:') or SIGHT.search(p.name)):
            p.P = p.P + np.array([0, offset, 0])


def shift_ufc(parts, dy):
    for p in parts:
        if p.name == 'A10C_UFC':
            p.P=p.P+np.array([0,dy,0])


def calibrate_optics(spec, parts, ctx, type_id):
    """Register the eye to native optics, with forward clearance from the helmet/coaming.

    Authored camera nodes are hints, not surveyed design-eye positions. Keep the original glass,
    frames and opaque panel intact; the eye looks through the upper part of the actual aperture.
    The generated A-10C UFC incorrectly covers its HUD: move that complete console below the glass,
    as shown in the cockpit reference, rather than drawing reticles over an opaque instrument box.
    """
    if spec.get('opticsCalibration'):
        return
    optics = [p for p in parts if p.mover is None and p.group == 'glass' and
              (p.name.startswith('HUD_GLASS:') or SIGHT.search(p.name))]
    if not optics:
        return
    points = np.concatenate([p.P[np.unique(p.I)] for p in optics])
    lo, hi = points.min(0), points.max(0)
    source_eye = list(spec.get('eyeSeated', spec['eye']))
    forward={'a10a':.15,'f15c':.35,'f104g':.10}.get(type_id,0)
    eye=[source_eye[0],round(float(lo[1]+.78*(hi[1]-lo[1])),6),round(source_eye[2]+forward,6)]
    eye_offset=[round(v-s,6) for v,s in zip(eye,source_eye)]
    ufc_offset=0
    if type_id=='a10a':
        ufc=[p.P[np.unique(p.I)] for p in parts if p.name=='A10C_UFC']
        if ufc:
            top=max(float(p[:,1].max()) for p in ufc)
            ufc_offset=min(0,float(lo[1])-.02-top)
            shift_ufc(parts,ufc_offset)
    spec['eyeSeated'] = source_eye[:]
    spec['eye'] = eye[:]
    if type_id in ('a10a','f15c','f104g'):
        spec['cockpitLookDown']=.12
    spec['opticsCalibration'] = {'version':4,'assemblyOffset':[0,0,0],'ufcOffset':round(ufc_offset,6),
                                'sourceEye':source_eye[:],'eyeOffset':eye_offset,'opaqueSupportWarp':False,
                                'sourceGlassBounds':[lo.tolist(),hi.tolist()]}
    # These imported panes continue into their opaque projector housing. Use the exposed aperture.
    housing_fraction={'a10a':.26714,'f16v':.14,'su27':.14,'mig29':.14}.get(type_id)
    if housing_fraction is not None:
        spec['opticsCalibration']['clearLowerY']=round(float(lo[1]+housing_fraction*(hi[1]-lo[1])),6)


def finish(spec, parts, ctx, type_id):
    from measure import all_points, all_tris, r3
    from muzzle_alignment import finish_muzzles
    from instrument_alignment import finish_instruments
    finish_muzzles(spec,parts,ctx,type_id)
    finish_instruments(spec,parts,type_id)
    glass = all_points(parts, lambda p: p.mover is None and p.group == 'glass' and
                       (p.name.startswith('HUD_GLASS:') or SIGHT.search(p.name)))
    if len(glass):
        lo, hi = glass.min(0), glass.max(0)
        c = (lo + hi) / 2
        seated = spec.get('eyeSeated', spec['eye'])[:]
        spec['eyeSeated'] = seated
        if not spec.get('opticsCalibration'):
            spec['eye'] = [round(float(c[0]), 4), round(float(c[1]), 4), seated[2]]
        # A physical aperture at its actual model location. No arbitrary 15 cm eye-height clamp.
        spec['sight'] = {'points': np.unique(np.round(glass, 5), axis=0).tolist(),
                         'eye': spec['eye'][:], 'eyeBox': [.13, .10, .40], 'source': 'model triangles'}

    wing = spec.get('wing')
    if not wing:
        return
    fixed = all_tris(parts, lambda p: p.group in ('body', 'wing_l', 'wing_r'))
    def at(x):
        k = min(len(wing) - 2, max(0, int(np.searchsorted([s[0] for s in wing], x)) - 1))
        a, b = np.array(wing[k]), np.array(wing[k + 1])
        return a + (b - a) * np.clip((x - a[0]) / max(1e-6, b[0] - a[0]), 0, 1)
    def under(f):
        x = wing[0][0] + (wing[-1][0] - wing[0][0]) * f
        s = at(x); z = s[2] - s[3] * .42
        return dict(x=round(x, 3), y=round(surface_y(fixed, x, z, s[1] - s[4]), 3), z=round(float(z), 3), wing=True)
    stations = {k: under(f) for k, f in [('inner', .32), ('mid', .56), ('outer', .78)]}
    stations['row'] = [under(.30), under(.84)]
    # Under-fuselage stations are remeasured rather than inherited from another aircraft's old origin.
    env = spec.get('fuselage', [])
    if env:
        z = float(np.clip(.3, env[0][0], env[-1][0]))
        e = min(env, key=lambda q: abs(q[0] - z)); fy = spec.get('fuseY', 0)
        stations['center'] = dict(x=0, y=round(surface_y(fixed, 0, z, fy-e[2]), 3), z=round(z, 3))
        zs = [1.2, -1.2]; x = min(e[1]*.65, 1.15)
        stations['belly'] = dict(x=round(x, 3), y=round(min(surface_y(fixed, x, q, fy-e[2]) for q in zs), 3), z=zs)
    stations.update(spec.get('stations', {}))
    if type_id == 'mig17f':
        # Preserve the authored wing/pylon/rail chain. The old converter removed these together with
        # the source's preinstalled weapons, then invented a second mount beside the wheel well.
        rail = all_tris(parts, lambda p: p.name == 'body_source_11' and p.group == 'wing_r')
        support = all_points(parts, lambda p: p.name == 'body_source_12' and p.group == 'wing_r')
        if not len(rail) or not len(support):
            raise ValueError('MiG-17: missing original wing pylon / rail')
        lo, hi = support.min(0), support.max(0)
        x, z = (lo[0]+hi[0])/2, (lo[2]+hi[2])/2
        y = surface_y(rail, x, z, 10)
        stations['inner'] = dict(x=round(float(x),4),y=round(y,4),z=round(float(z),4),
                                 wing=True,modelPylon=True)
    # F-86 mounts are explicitly provided by the user. Select their actual attachment surfaces.
    if type_id == 'f86f':
        g = ctx['sources']['main']; W = g.world()
        for key, name in [('inner','MOUNT_Inboard_L'), ('mid','MOUNT_Outboard_L'), ('outer','MOUNT_Outboard_L')]:
            i = next(i for i,n in enumerate(g.nodes) if n.get('name') == name)
            q = np.concatenate([p['P'] for p in g.primitives(i, W[i])]); lo,hi=q.min(0),q.max(0)
            p = ctx['to_game_points'](np.array([[(lo[0]+hi[0])/2,hi[1],(lo[2]+hi[2])/2]]),ctx['cg'])[0]
            stations[key] = dict(x=round(abs(float(p[0])),3),y=round(float(p[1]),3),z=round(float(p[2]),3),wing=True)
    spec['stations'] = stations
    if type_id in ('a10a', 'su25'):
        xs = ([7.4, 6.1, 4.8, 3.3, .75, 0, .75, 3.3, 4.8, 6.1, 7.4] if type_id == 'a10a'
              else [6.6, 5.6, 4.5, 3.3, 2.15, 2.15, 3.3, 4.5, 5.6, 6.6])
        points = {}
        for k, x in enumerate(xs):
            side = -1 if k < len(xs)//2 else 1
            x *= side
            s = at(abs(x))
            z = float(s[2] - s[3]*.42) if abs(x) > wing[0][0] else .4-float(ctx['cg'][2])
            points[str(k+1)] = r3([x, surface_y(fixed,x,z,s[1]-s[4]),z])
        spec['pylonPoints'] = points
    spec['alignmentVersion'] = 2 if spec.get('opticsCalibration') else 1
