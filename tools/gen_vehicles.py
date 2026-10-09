#!/usr/bin/env python3
"""Generates the historical-vehicle data folders under data/vehicles/ and their shells.

Everything here is *data authoring*, not game logic: it turns a compact per-tank spec
(dimensions and armour from public historical sources, see SOURCES.md) into the JSON
files the engine loads.  Re-run after editing a spec:

    python3 tools/gen_vehicles.py

Vehicle space: +Z forward, +X right, +Y up, origin on the ground under the hull centre.
Exterior shapes are original procedural geometry (prisms / plan extrusions / boxes /
cylinders) built from those dimensions -- no third-party meshes are used.
"""
import json, math, os, sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
DATA = os.path.join(ROOT, "data")


def r3(v):
    return round(float(v), 4)


def v3(x, y, z):
    return {"x": r3(x), "y": r3(y), "z": r3(z)}


def sind(a):
    return math.sin(math.radians(a))


def cosd(a):
    return math.cos(math.radians(a))


def tand(a):
    return math.tan(math.radians(a))


# --------------------------------------------------------------------------- armour

def plate(pid, zone, mat, mm, c, n, u, hu, hv):
    l = math.sqrt(sum(k * k for k in n))
    n = [k / l for k in n]
    return {"id": pid, "zone": zone, "material": mat, "thickness_mm": mm,
            "center": v3(*c), "normal": v3(*n), "axis_u": v3(*u), "half_u": r3(hu), "half_v": r3(hv)}


def hull_plates(s):
    W, H, L, c = s["body_w"], s["H"], s["L"], s["clear"]
    a = s["armor"]
    yn = s["nose_y"]
    out = []
    mm, ang, mat = a["upper_front"]
    span = H - yn
    run = min(span * tand(ang), L * 0.45)
    out.append(plate("hull_upper_front", "hull_upper_front", mat, mm, (0, yn + span / 2, L / 2 - run / 2),
                     (0, sind(ang), cosd(ang)), (1, 0, 0), W / 2, span / 2 / max(cosd(ang), 0.2)))
    if "glacis" in a:  # near-horizontal plate between nose and driver's plate
        mm, zlen, mat = a["glacis"]
        out.append(plate("hull_glacis", "hull_roof", mat, mm, (0, yn, L / 2 - zlen / 2 - 0.05),
                         (0, 1, 0), (1, 0, 0), W / 2, zlen / 2))
    mm, ang, mat = a["lower_front"]
    span = yn - c
    run = span * tand(ang)
    out.append(plate("hull_lower_front", "hull_lower_front", mat, mm, (0, c + span / 2, L / 2 - run / 2),
                     (0, -sind(ang), cosd(ang)), (1, 0, 0), W / 2, span / 2 / max(cosd(ang), 0.2)))
    mm, ang, mat = a["side"]
    for sx, nm in ((1, "r"), (-1, "l")):
        inset = (H - c) / 2 * tand(ang) / 2
        out.append(plate("hull_side_" + nm, "hull_side", mat, mm, (sx * (W / 2 - inset), (c + H) / 2, 0),
                         (sx * cosd(ang), sind(ang), 0), (0, 0, 1), L / 2 - 0.15, (H - c) / 2 / cosd(ang)))
    mm, ang, mat = a["rear"]
    # a negative angle is an undercut plate (top further back than the bottom)
    out.append(plate("hull_rear", "hull_rear", mat, mm, (0, (c + H) / 2, -L / 2 + 0.05 + (H - c) / 2 * abs(tand(ang)) / 2),
                     (0, sind(ang), -cosd(ang)), (1, 0, 0), W / 2, (H - c) / 2 / cosd(ang)))
    out.append(plate("hull_roof", "hull_roof", "rha", a["roof"], (0, H, -0.3), (0, 1, 0), (1, 0, 0), W / 2, L / 2 - 0.9))
    out.append(plate("hull_floor", "hull_floor", "rha", a["floor"], (0, c, 0), (0, -1, 0), (1, 0, 0), W / 2 - 0.3, L / 2 - 0.3))
    return out


def turret_plates(s):
    px, py, pz = s["turret_pos"]
    tw, th, tl = s["turret_size"]
    a = s["turret_armor"]
    ty = s["mount"][1]
    out = []
    mm, ang, mat = a["front"]
    out.append(plate("turret_front", "turret_front", mat, mm, (0, py + th / 2, pz + tl / 2 - 0.03),
                     (0, sind(ang), cosd(ang)), (1, 0, 0), tw / 2, th / 2))
    mm, mw, mh, mat = a["mantlet"]
    out.append(plate("gun_mantlet", "gun_mantlet", mat, mm, (0, ty, pz + tl / 2 + 0.06), (0, 0, 1), (1, 0, 0), mw / 2, mh / 2))
    mm, ang, mat = a["side"]
    for sx, nm in ((1, "r"), (-1, "l")):
        out.append(plate("turret_side_" + nm, "turret_side", mat, mm, (sx * (tw / 2 - 0.02), py + th / 2, pz),
                         (sx * cosd(ang), sind(ang), 0), (0, 0, 1), tl / 2, th / 2 / cosd(ang)))
    mm, mat = a["rear"]
    out.append(plate("turret_rear", "turret_rear", mat, mm, (0, py + th / 2, pz - tl / 2 + 0.03), (0, 0, -1), (1, 0, 0), tw / 2, th / 2))
    if not s.get("open_top"):
        out.append(plate("turret_roof", "turret_roof", "rha", a["roof"], (0, py + th, pz), (0, 1, 0), (1, 0, 0), tw / 2 - 0.1, tl / 2 - 0.1))
    return out


# -------------------------------------------------------------------------- outlines

def ellipse(cx, cz, rx, rz_front, rz_rear=None, n=28):
    rz_rear = rz_front if rz_rear is None else rz_rear
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x, z = math.sin(t), math.cos(t)
        pts.append([r3(cx + rx * x), r3(cz + (rz_front if z >= 0 else rz_rear) * z)])
    return pts


def superellipse(cx, cz, rx, rz_front, rz_rear, p=2.6, n=32):
    pts = []
    for i in range(n):
        t = 2 * math.pi * i / n
        s, c = math.sin(t), math.cos(t)
        x = math.copysign(abs(s) ** (2 / p), s)
        z = math.copysign(abs(c) ** (2 / p), c)
        pts.append([r3(cx + rx * x), r3(cz + (rz_front if z >= 0 else rz_rear) * z)])
    return pts


def horseshoe(cx, cz_front, hx, z_straight_end, n=14):
    """Flat front, straight sides, semicircular rear (clockwise seen from above)."""
    pts = [[r3(cx - hx), r3(cz_front)], [r3(cx + hx), r3(cz_front)], [r3(cx + hx), r3(z_straight_end)]]
    for i in range(1, n):
        t = math.pi * i / n
        pts.append([r3(cx + hx * math.cos(t)), r3(z_straight_end - hx * math.sin(t))])
    pts.append([r3(cx - hx), r3(z_straight_end)])
    return pts


def chamfer_rect(cx, z0, z1, hx, ch):
    return [[r3(cx - hx + ch), r3(z1)], [r3(cx + hx - ch), r3(z1)], [r3(cx + hx), r3(z1 - ch)], [r3(cx + hx), r3(z0 + ch)],
            [r3(cx + hx - ch), r3(z0)], [r3(cx - hx + ch), r3(z0)], [r3(cx - hx), r3(z0 + ch)], [r3(cx - hx), r3(z1 - ch)]]


# ------------------------------------------------------------------------ primitives

def prism(profile, w, wt=None, mount="hull", mat="paint", x=0.0):
    d = {"type": "prism", "mount": mount, "mat": mat, "profile": [[r3(z), r3(y)] for z, y in profile], "w": r3(w)}
    if wt is not None:
        d["wt"] = r3(wt)
    if x:
        d["x"] = r3(x)
    return d


def plan(outline, y0, y1, scale_top=(1, 1), shift_top=(0, 0), origin=None, mount="turret", mat="paint", smooth=False, hollow=None):
    """hollow = wall thickness (m): no roof, the walls get an inside face and the floor shows."""
    d = {"type": "plan", "mount": mount, "mat": mat, "outline": outline, "y0": r3(y0), "y1": r3(y1)}
    if hollow:
        d["hollow"] = r3(hollow)
    if tuple(scale_top) != (1, 1):
        d["scale_top"] = [r3(scale_top[0]), r3(scale_top[1])]
    if tuple(shift_top) != (0, 0):
        d["shift_top"] = [r3(shift_top[0]), r3(shift_top[1])]
    if origin is not None:
        d["origin"] = [r3(origin[0]), r3(origin[1])]
    if smooth:
        d["smooth"] = True
    return d


def box(size, pos, rot=None, mount="hull", mat="paint", mirror=False):
    d = {"type": "box", "mount": mount, "mat": mat, "size": [r3(k) for k in size], "pos": [r3(k) for k in pos]}
    if rot:
        d["rot"] = [r3(k) for k in rot]
    if mirror:
        d["mirror"] = True
    return d


def cyl(r, length, axis, pos, r2=None, segs=18, mount="hull", mat="paint", mirror=False, rot=None):
    d = {"type": "cyl", "mount": mount, "mat": mat, "r": r3(r), "len": r3(length), "axis": axis, "pos": [r3(k) for k in pos], "segs": segs}
    if r2 is not None:
        d["r2"] = r3(r2)
    if rot:
        d["rot"] = [r3(k) for k in rot]
    if mirror:
        d["mirror"] = True
    return d


def barrel(mount_pt, z_from, z_to, r_base, r_tip, mat="paint"):
    """Tapered tube along +Z, positions relative to nothing: absolute vehicle space at yaw 0."""
    mid = (z_from + z_to) / 2
    d = cyl(r_base, z_to - z_from, "z", (mount_pt[0], mount_pt[1], mid), r2=r_tip, segs=20, mount="gun", mat=mat)
    d["recoil"] = True
    return d


def recoil(d):
    """Marks a gun part as sliding back with the barrel when the gun fires."""
    d["recoil"] = True
    return d


def mg(sid, weapon, mount, pos, arc=None, post=None, shield=None):
    """Machine gun mount. mount: coax (follows the main gun) | hull (ball mount, limited arc) |
    pintle (on the turret roof, free traverse). arc = [yaw half-angle, depression, elevation] deg."""
    d = {"id": sid, "weapon": weapon, "mount": mount, "position_m": [r3(k) for k in pos]}
    if arc:
        d["arc_deg"] = [r3(k) for k in arc]
    if post is not None:
        d["post_m"] = r3(post)
    if shield is not None:
        d["shield_m"] = [r3(k) for k in shield]
    return d


def dome(cx, cz, rx, rz_front, rz_rear, y0, y1, tiers=3, p=2.3, flat=0.45, mount="turret", mat="paint"):
    """Rounded cast turret: stacked plan rings following a quarter-ellipse, flat top of `flat` x the base."""
    parts = []
    for i in range(tiers):
        a0 = (math.pi / 2) * i / tiers
        a1 = (math.pi / 2) * (i + 1) / tiers
        k0 = flat + (1 - flat) * math.cos(a0)
        k1 = flat + (1 - flat) * math.cos(a1)
        ya = y0 + (y1 - y0) * math.sin(a0)
        yb = y0 + (y1 - y0) * math.sin(a1)
        ring = superellipse(cx, cz, rx * k0, rz_front * k0, rz_rear * k0, p=p)
        parts.append(plan(ring, ya, yb, scale_top=(k1 / k0, k1 / k0), origin=(cx, cz), mount=mount, mat=mat, smooth=True))
    return parts


def muzzle_brake(mount_pt, z_tip, r, length=0.46, mat="paint_dark"):
    """Double-baffle muzzle brake ending at z_tip."""
    x, y = mount_pt[0], mount_pt[1]
    return [recoil(cyl(r * 0.8, length, "z", (x, y, z_tip - length / 2), mount="gun", mat=mat)),
            recoil(cyl(r, 0.06, "z", (x, y, z_tip - length * 0.82), mount="gun", mat=mat)),
            recoil(cyl(r, 0.06, "z", (x, y, z_tip - length * 0.3), mount="gun", mat=mat)),
            recoil(cyl(r * 0.86, 0.04, "z", (x, y, z_tip - 0.02), mount="gun", mat=mat))]


def cupola(x, y, z, r, h, blocks=0):
    parts = [cyl(r, h, "y", (x, y + h / 2, z), r2=r * 0.93, mount="turret", segs=22),
             cyl(r * 0.66, 0.035, "y", (x, y + h + 0.017, z), mount="turret", mat="paint_dark")]
    for i in range(blocks):
        a = 2 * math.pi * i / blocks
        parts.append(box((0.12, 0.06, 0.08), (x + r * 0.88 * math.sin(a), y + h + 0.01, z + r * 0.88 * math.cos(a)),
                         rot=(0, math.degrees(a), 0), mount="turret", mat="paint_dark"))
    return parts


def module(mid, kind, c, he, hp):
    return {"id": mid, "kind": kind, "center": v3(*c), "half_extents": v3(*he), "max_health": hp, "health": hp}


def crew(role, pos):
    return {"role": role, "pos": v3(*pos), "radius": 0.25, "health": 100}


def tracks_modules(s):
    x = s["running_gear"]["track_x"]
    hw = s["running_gear"]["track_width"] / 2
    return [module("track_l", "track", (-x, 0.45, 0), (hw, 0.45, s["L"] / 2 - 0.2), 120),
            module("track_r", "track", (x, 0.45, 0), (hw, 0.45, s["L"] / 2 - 0.2), 120)]


# ----------------------------------------------------------------------------- shells

AIR_RHO = 1.225


def demarre_mm(v, mass_kg, cal_mm, k):
    d_dm = cal_mm / 100.0
    return ((v * math.sqrt(mass_kg)) / (k * d_dm ** 0.75)) ** (1 / 0.7) * 100.0


def shell(pid, name, kind, cal, mass, v0, filler, filler_type, k, norm, ricochet=70.0, cd=0.40):
    area = math.pi * (cal * 0.0005) ** 2
    kk = 0.5 * AIR_RHO * cd * area / mass  # dv/dx = -kk * v
    curve = []
    for dist in (0, 100, 500, 1000, 1500, 2000, 2500):
        v = v0 * math.exp(-kk * dist)
        curve.append({"distance_m": dist, "pen_mm": round(demarre_mm(v, mass, cal, k), 1)})
    return {"id": pid, "name": name, "kind": kind, "caliber_mm": cal, "mass_kg": mass, "muzzle_velocity_ms": v0,
            "explosive_mass_kg": filler, "explosive_type": filler_type, "penetrator_material": "steel",
            "length_mm": round(cal * 3.7), "drag_coefficient": cd, "penetration_curve": curve,
            "ricochet_angle_deg": ricochet, "normalization_deg": norm, "fuse_delay_s": 0.0024 if filler > 0 else 0.0,
            "fuse_sensitivity_mm": 15 if filler > 0 else 0}


def shell_pen0(pid, name, kind, cal, mass, v0, filler, filler_type, pen0, norm, ricochet=70.0, cd=0.40):
    """A kinetic round whose 0 m penetration is the published figure: k is solved from it."""
    k = v0 * math.sqrt(mass) / ((cal / 100.0) ** 0.75 * (pen0 / 100.0) ** 0.7)
    sh = shell(pid, name, kind, cal, mass, v0, filler, filler_type, k, norm, ricochet, cd)
    if kind in ("apcr", "apds", "apfsds"):
        sh["penetrator_material"] = "tungsten"
        sh["shatter_angle_deg"] = 62.0 if kind != "apfsds" else 75.0
    if kind in ("apds", "apfsds"):
        # a sub-calibre penetrator: long for its width, the sabot gone at the muzzle
        sh["length_mm"] = round(cal * (4.5 if kind == "apds" else 12.0))
    return sh


def flat_shell(pid, name, kind, cal, mass, v0, filler, filler_type, pen, cd=0.42):
    """HE and HEAT: penetration does not depend on the striking velocity."""
    curve = [{"distance_m": d, "pen_mm": round(pen, 1)} for d in (0, 100, 500, 1000, 1500, 2000, 2500)]
    return {"id": pid, "name": name, "kind": kind, "caliber_mm": cal, "mass_kg": mass, "muzzle_velocity_ms": v0,
            "explosive_mass_kg": filler, "explosive_type": filler_type, "penetrator_material": "steel",
            "length_mm": round(cal * (4.2 if kind in ("heat", "heat_fs") else 4.0)), "drag_coefficient": cd, "penetration_curve": curve,
            "ricochet_angle_deg": 80.0 if kind in ("heat", "heat_fs") else 79.0, "normalization_deg": 0.0,
            "fuse_delay_s": 0.0, "fuse_sensitivity_mm": 0.1}


def he_shell(pid, name, cal, mass, v0, filler, filler_type="tnt"):
    # an HE shell defeats thin plate by blast and fragments only: about 14 mm per sqrt(kg) of filler
    return flat_shell(pid, name, "he", cal, mass, v0, filler, filler_type, 14.0 * math.sqrt(filler))


SHELLS = [
    # De Marre constant k is tuned per shell so the 0 deg figure lands inside the spread of
    # published firing-table values; nothing here is taken from any game.
    shell("apcbc_88_l56", "8.8 cm Pzgr. 39 (APCBC)", "apcbc", 88.0, 10.2, 773.0, 0.059, "amatol", 2000, 4.0),
    shell("aphe_85_br365", "85 mm BR-365 (APHE)", "aphe", 85.0, 9.2, 792.0, 0.164, "tnt", 2150, 5.0, ricochet=68.0),
    shell("apcbc_76_m62", "76 mm M62 (APCBC)", "apcbc", 76.2, 7.0, 792.0, 0.065, "explosive_d", 2050, 4.0),
    shell("apcbc_75_m61", "75 mm M61 shot (APCBC)", "apcbc", 75.0, 6.8, 610.0, 0.0, "none", 2050, 4.0),
    shell("apcbc_75_m61_m3", "75 mm M61 (APCBC), gun M3", "apcbc", 75.0, 6.63, 618.0, 0.065, "explosive_d", 2050, 4.0),
    shell("apc_50_pzgr39", "5 cm Pzgr. 39 (APC)", "apcbc", 50.0, 2.06, 835.0, 0.017, "petn", 2250, 4.0),
    shell("apcbc_75_pzgr39", "7.5 cm Pzgr. 39 (APCBC)", "apcbc", 75.0, 6.8, 790.0, 0.017, "petn", 2050, 4.0),
    shell("apcbc_75_pzgr39_42", "7.5 cm Pzgr. 39/42 (APCBC)", "apcbc", 75.0, 6.8, 935.0, 0.017, "petn", 2050, 4.0),
    shell("aphe_122_br471", "122 mm BR-471 (APHE)", "aphe", 121.92, 25.0, 795.0, 0.156, "tnt", 2400, 5.0, ricochet=68.0),
    shell("apbc_100_br412", "100 mm BR-412B (APBC)", "aphe", 100.0, 15.88, 895.0, 0.065, "a_ix_2", 2200, 5.0, ricochet=68.0),
    # The other rounds each gun carried. Masses, velocities and fillers are the service figures;
    # kinetic rounds are fixed by their published 0 m penetration (firing tables, 0 deg RHA).
    shell_pen0("apcr_88_pzgr40", "8.8 cm Pzgr. 40 (APCR)", "apcr", 88.0, 7.3, 930.0, 0.0, "none", 171.0, 2.0, 66.0, 0.45),
    he_shell("he_88_sprgr", "8.8 cm Sprgr. L/4.5 (HE)", 88.0, 9.0, 820.0, 0.698, "amatol"),
    shell_pen0("apcr_75_pzgr40_42", "7.5 cm Pzgr. 40/42 (APCR)", "apcr", 75.0, 4.75, 1120.0, 0.0, "none", 226.0, 2.0, 66.0, 0.45),
    he_shell("he_75_sprgr42", "7.5 cm Sprgr. 42 (HE)", 75.0, 5.74, 700.0, 0.725, "amatol"),
    shell_pen0("apcr_75_pzgr40", "7.5 cm Pzgr. 40 (APCR), KwK 40 L/48", "apcr", 75.0, 4.1, 990.0, 0.0, "none", 158.0, 2.0, 66.0, 0.45),
    he_shell("he_75_sprgr34", "7.5 cm Sprgr. 34 (HE), KwK 40 L/48", 75.0, 5.74, 550.0, 0.686, "amatol"),
    flat_shell("heat_75_gr38c", "7.5 cm Gr. 38 Hl/C (HEAT)", "heat", 75.0, 4.8, 450.0, 0.48, "hexogen", 100.0, 0.5),
    shell_pen0("apcbc_75_pzgr39_l43", "7.5 cm Pzgr. 39 (APCBC), KwK 40 L/43", "apcbc", 75.0, 6.8, 740.0, 0.017, "petn", 126.0, 4.0),
    shell_pen0("apcr_75_pzgr40_l43", "7.5 cm Pzgr. 40 (APCR), KwK 40 L/43", "apcr", 75.0, 4.1, 920.0, 0.0, "none", 143.0, 2.0, 66.0, 0.45),
    he_shell("he_75_sprgr34_l43", "7.5 cm Sprgr. 34 (HE), KwK 40 L/43", 75.0, 5.74, 485.0, 0.686, "amatol"),
    flat_shell("heat_75_gr38b", "7.5 cm Gr. 38 Hl/B (HEAT)", "heat", 75.0, 4.57, 450.0, 0.44, "hexogen", 80.0, 0.5),
    shell_pen0("apcr_50_pzgr40", "5 cm Pzgr. 40 (APCR)", "apcr", 50.0, 0.925, 1180.0, 0.0, "none", 130.0, 2.0, 66.0, 0.45),
    he_shell("he_50_sprgr38", "5 cm Sprgr. 38 (HE)", 50.0, 1.82, 550.0, 0.165, "amatol"),
    shell_pen0("apcr_85_br365p", "85 mm BR-365P (APCR)", "apcr", 85.0, 4.99, 1050.0, 0.0, "none", 180.0, 2.0, 66.0, 0.45),
    he_shell("he_85_o365k", "85 mm O-365K (HE)", 85.0, 9.54, 793.0, 0.741),
    he_shell("he_122_of471", "122 mm OF-471 (HE)", 121.92, 25.0, 800.0, 3.6),
    he_shell("he_100_of412", "100 mm OF-412 (HE)", 100.0, 15.6, 900.0, 1.46),
    he_shell("he_75_m48", "75 mm M48 (HE)", 75.0, 6.67, 463.0, 0.67),
    shell_pen0("ap_75_m72", "75 mm M72 shot (AP)", "ap", 75.0, 6.32, 619.0, 0.0, "none", 101.0, 4.0, 68.0),
    shell_pen0("apcr_76_m93", "76 mm M93 shot (HVAP)", "apcr", 76.2, 4.26, 1036.0, 0.0, "none", 221.0, 2.0, 66.0, 0.45),
    he_shell("he_76_m42a1", "76 mm M42A1 (HE)", 76.2, 5.84, 820.0, 0.39),
    # 76 mm L-11 (T-34 1940): BR-350A at the L-11's lower muzzle velocity, OF-350
    shell_pen0("aphe_76_br350a_l11", "76 mm BR-350A (APHE), L-11", "aphe", 76.2, 6.3, 612.0, 0.155, "tnt", 70.0, 5.0, 68.0),
    he_shell("he_76_of350_l11", "76 mm OF-350 (HE), L-11", 76.2, 6.2, 625.0, 0.71),
    shell_pen0("apc_90_m318", "90 mm M318 (APC)", "apcbc", 90.0, 10.9, 914.0, 0.0, "none", 185.0, 4.0),
    shell_pen0("apcr_90_m304", "90 mm M304 shot (HVAP)", "apcr", 90.0, 7.62, 1021.0, 0.0, "none", 300.0, 2.0, 66.0, 0.45),
    he_shell("he_90_m71", "90 mm M71 (HE)", 90.0, 10.55, 823.0, 0.93),
    flat_shell("heat_90_m348", "90 mm M348 (HEAT)", "heat", 90.0, 5.85, 853.0, 0.9, "comp_b", 305.0, 0.45),
    # 37 mm gun M6 (M8 armoured car): TM 9-1904 / FM 23-81 service figures
    shell_pen0("apcbc_37_m51", "37 mm M51B1 (APC)", "apcbc", 37.0, 0.87, 884.0, 0.0, "none", 78.0, 4.0),
    shell_pen0("ap_37_m74", "37 mm M74 shot (AP)", "ap", 37.0, 0.87, 884.0, 0.0, "none", 74.0, 4.0, 68.0),
    he_shell("he_37_m63", "37 mm M63 (HE)", 37.0, 0.73, 792.0, 0.039),
    # 3 cm MK 103 (Hetzer anti-aircraft variant)
    he_shell("he_30_mgesch", "3 cm M-Gesch. (HE)", 30.0, 0.33, 860.0, 0.072, "petn"),
    shell_pen0("apt_30_pzgr", "3 cm Pzgr. (AP-T)", "ap", 30.0, 0.355, 800.0, 0.0, "none", 52.0, 4.0, 68.0, 0.34),
    shell_pen0("apcr_30_pzgr40", "3 cm Pzgr. 40 (APCR)", "apcr", 30.0, 0.30, 960.0, 0.0, "none", 80.0, 0.0, 70.0, 0.38),
    # Ordnance QF 6-pounder 7 cwt Mk II (L/43)
    shell_pen0("ap_57_mk7", "57 mm Shot Mk.7 (AP)", "ap", 57.0, 2.86, 853.0, 0.0, "none", 103.0, 4.0, 68.0),
    shell_pen0("apcbc_57_mk9", "57 mm Shot Mk.9T (APCBC)", "apcbc", 57.0, 3.23, 831.0, 0.0, "none", 100.0, 4.0),
    he_shell("he_57_mk10", "57 mm Shell Mk.10T (HE)", 57.0, 2.95, 820.0, 0.09),
    # 122 mm M-62-T2 (T-10M): the long gun's higher velocity; BK-7M figures are approximate
    # BR-472: the blunt APHE with a ballistic cap (APHEBC); 295 mm at the muzzle and the drag of
    # the cap give 275 / 256 / 222 mm at 500 / 1000 / 2000 m
    shell_pen0("aphe_122_br472", "122 mm BR-472 (APHEBC)", "aphe", 121.92, 25.0, 950.0, 0.156, "tnt", 295.0, 5.0, 70.0, cd=0.347),
    # the later rounds of the M-62-T2: 3BM-11 sub-calibre (APDS) and 3BK-9 fin-stabilised HEAT
    shell_pen0("apds_122_3bm11", "122 mm 3BM-11 (APDS)", "apds", 50.0, 4.5, 1620.0, 0.0, "none", 408.0, 0.0, 75.0, 0.30),
    flat_shell("heatfs_122_3bk9", "122 mm 3BK-9 (HEAT-FS)", "heat_fs", 121.92, 18.4, 920.0, 2.12, "a_ix_1", 400.0, 0.36),
    he_shell("he_122_of472", "122 mm OF-472 (HE)", 121.92, 27.3, 905.0, 3.0),
    flat_shell("heat_122_bk7m", "122 mm BK-7M (HEAT)", "heat", 121.92, 12.6, 900.0, 1.4, "a_ix_1", 400.0, 0.42),
    # 14.5 mm (KPV family) for the Oplot-MO six-barrel gun: B-32 and BZT-44 steel-cored
    # incendiary rounds, BS-41 with a tungsten-carbide core
    shell_pen0("api_145_b32", "14.5 mm B-32 (API)", "ap", 14.5, 0.064, 1000.0, 0.0, "none", 32.0, 4.0, 70.0, 0.30),
    shell_pen0("apit_145_bzt44", "14.5 mm BZT-44 (API-T)", "ap", 14.5, 0.0596, 1005.0, 0.0, "none", 28.0, 4.0, 70.0, 0.30),
    shell_pen0("apcr_145_bs41", "14.5 mm BS-41 (API, WC core)", "apcr", 14.5, 0.0646, 976.0, 0.0, "none", 40.0, 2.0, 66.0, 0.30),
    # 25 mm 72-K (BMPT-34): BR-132P armour-piercing tracer and OZR-132 fragmentation-incendiary;
    # the mod's 250 kg heavy rocket (fired off the turret's rails, HE)
    shell_pen0("apt_25_br132p", "25 mm BR-132P (AP-T)", "ap", 25.0, 0.288, 900.0, 0.0, "none", 52.0, 4.0, 68.0, 0.32),
    he_shell("hefi_25_ozr132", "25 mm OZR-132 (HEF-I)", 25.0, 0.288, 900.0, 0.013, "a_ix_2"),
    he_shell("he_300_tt_rocket", "250 kg TT rocket (HE)", 300.0, 250.0, 180.0, 50.0),
    # 35 mm KDA (L/90) family for the wheeled 35 mm prototype. The service rounds are the
    # Oerlikon/Rheinmetall ones (HEI-T 1175 m/s, APDS-T 1385 m/s, PMC 287 APFSDS-T 1440 m/s); the
    # capped AP round with a filler and the fin-stabilised HEAT are what the request asked for and
    # are given plausible figures (no such 35 mm rounds were fielded). Sub-calibre rounds fly on
    # their penetrator's width (22 mm APDS core, 14 mm rod), which is what their drag sees.
    shell_pen0("apds_35_kda", "35 mm APDS-T (KDA)", "apds", 22.0, 0.38, 1385.0, 0.0, "none", 120.0, 0.0, 75.0, 0.28),
    shell_pen0("apfsds_35_pmc287", "35 mm PMC 287 APFSDS-T", "apfsds", 14.0, 0.296, 1440.0, 0.0, "none", 145.0, 0.0, 78.0, 0.22),
    flat_shell("heatfs_35", "35 mm HEAT-FS", "heat_fs", 35.0, 0.45, 1000.0, 0.055, "comp_b", 95.0, 0.30),
    # a short base fuze: the small filler goes off about a metre behind the plate, inside
    dict(shell_pen0("apcbche_35", "35 mm APCBC-HE (SAPHEI-T)", "apcbc", 35.0, 0.55, 1175.0, 0.022, "hexogen", 72.0, 4.0, 71.0, 0.30),
         fuse_delay_s=0.0008, fuse_sensitivity_mm=8),
    he_shell("hei_35_kda", "35 mm HEI-T (KDA)", 35.0, 0.55, 1175.0, 0.112, "hexogen"),
    # warheads of the missiles and rockets in data/missiles.json (what they do on impact; the
    # flight is the missile's own): the BGM-71A's 152 mm shaped charge (about 430 mm), the
    # TT-250 'tank torpedo' of the RBT-5 project (420 mm, 250 kg, about 130 kg of TNT)
    # 78 mm design study: fin-stabilised sabot (a 26 mm tungsten rod), HEAT-FS and HE-FS
    shell_pen0("apfsds_78_xp", "78 mm APFSDS-T (試驗)", "apfsds", 26.0, 3.6, 1650.0, 0.0, "none", 330.0, 0.0, 78.0, 0.26),
    flat_shell("heatfs_78_xp", "78 mm HEAT-FS (試驗)", "heat_fs", 78.0, 5.8, 1150.0, 0.62, "comp_b", 320.0, 0.30),
    he_shell("he_78_xp", "78 mm HE-FS (試驗)", 78.0, 7.2, 950.0, 0.95, "comp_b"),
    # 4.7 cm PaK(t) (Skoda A5): the capped AP shell, 1.65 kg at 775 m/s, about 63 mm at 100 m
    shell("apcbc_47_pak36t", "4.7 cm Pzgr. 36(t) (APCBC)", "apcbc", 47.0, 1.65, 775.0, 0.018, "tnt", 2150, 4.0),
    he_shell("he_47_pak36t", "4.7 cm Sprgr. 36(t) (HE)", 47.0, 2.3, 450.0, 0.24),
    # 2 cm FlaK 38 / KwK 30: the tracer AP, the tungsten-cored Pzgr. 40, the HE tracer
    shell_pen0("apt_20_pzgr39", "2 cm Pzgr. 39 (AP-T)", "ap", 20.0, 0.148, 830.0, 0.0, "none", 30.0, 4.0, 68.0, 0.34),
    shell_pen0("apcr_20_pzgr40", "2 cm Pzgr. 40 (APCR)", "apcr", 20.0, 0.100, 1050.0, 0.0, "none", 49.0, 0.0, 70.0, 0.38),
    he_shell("hefi_20_sprgr", "2 cm Sprgr. (HEF-T)", 20.0, 0.119, 900.0, 0.006, "petn"),
    # 20 mm Rh 202 (K-64): DM43 sub-calibre, DM?? AP tracer, DM51 high explosive
    shell_pen0("apds_20_dm43", "20 mm DM43 (APDS-T)", "apds", 12.0, 0.11, 1150.0, 0.0, "none", 66.0, 0.0, 75.0, 0.30),
    shell_pen0("apt_20_rh202", "20 mm AP-T (Rh 202)", "ap", 20.0, 0.12, 1050.0, 0.0, "none", 40.0, 4.0, 68.0, 0.32),
    he_shell("hei_20_dm51", "20 mm DM51 (HEI-T)", 20.0, 0.12, 1045.0, 0.011, "petn"),
    flat_shell("heat_152_tow", "BGM-71A TOW (HEAT)", "heat_fs", 152.0, 18.9, 300.0, 2.4, "comp_b", 430.0, 0.45),
    # the BMP-K-64's missiles: the 9M113 Konkurs (135 mm, about 600 mm) of the first ATGM
    # version, the 9M133 Kornet's tandem charge (152 mm, about 1,000 mm behind ERA) of the
    # launcher kit
    flat_shell("heat_135_konkurs", "9M113 Konkurs (HEAT)", "heat_fs", 135.0, 14.6, 208.0, 2.7, "comp_b", 600.0, 0.45),
    flat_shell("heat_152_kornet", "9M133 Kornet (tandem HEAT)", "heat_fs", 152.0, 27.0, 300.0, 4.6, "comp_b", 1000.0, 0.45),
    # 130 mm M-46 field gun: the BR-482B capped AP (33.4 kg at 1,050 m/s, about 250 mm at
    # 1 km on the tables) and the OF-482M HE (33.4 kg, 4.6 kg of TNT)
    shell("apcbc_130_br482b", "130 mm BR-482B (APCBC)", "apcbc", 130.0, 33.4, 1050.0, 0.12, "tnt", 2400, 4.0, ricochet=68.0),
    he_shell("he_130_of482m", "130 mm OF-482M (HE)", 130.0, 33.4, 930.0, 4.63),
    # (sources give about 130 kg of TNT; taken as 125 kg, half the round)
    he_shell("he_420_tt250", "TT-250 tank torpedo (HE)", 420.0, 250.0, 135.0, 125.0),
]

# Missiles and rockets: their flight (crates/missile). Sources: the BGM-71A's published figures
# (Wikipedia / designation-systems: 18.9 kg, 152 mm, 1.17 m, boost to about 300 m/s, 65-3750 m,
# wire guided SACLOS); the TT-250 of the RBT-5 tank (War Thunder wiki and armedconflicts.com:
# 420 mm, 250 kg, about 130 kg of TNT, 135 m/s, 350-1800 m, launcher +9..+50 deg). Hit points are bullet hits the
# body takes before it breaks up; a hit on the warhead section may set it off.
MISSILES = [
    {"id": "bgm71a_tow", "name": "BGM-71A TOW", "guidance": "saclos", "mass_kg": 18.9, "caliber_mm": 152.0, "length_m": 1.17,
     "span_m": 0.46, "launch_speed_ms": 70.0, "max_speed_ms": 300.0, "boost_s": 1.6, "burn_s": 1.6, "drag_k": 1.8e-4,
     "max_range_m": 3750.0, "min_range_m": 65.0, "turn_accel_ms2": 60.0, "lift": True, "hp": 3.0, "warhead_share": 0.35,
     "fuse_chance": 0.65, "control_loss_chance": 0.45, "warhead": "heat_152_tow", "guidance_lag_s": 0.25, "smoke": 1.0},
    {"id": "tt250_rocket", "name": "TT-250 tank torpedo", "guidance": "none", "mass_kg": 250.0, "caliber_mm": 420.0, "length_m": 2.25,
     "span_m": 0.62, "launch_speed_ms": 60.0, "max_speed_ms": 135.0, "boost_s": 1.0, "burn_s": 2.5, "drag_k": 2.0e-5,
     "max_range_m": 1800.0, "min_range_m": 0.0, "turn_accel_ms2": 0.0, "lift": False, "hp": 8.0, "warhead_share": 0.45,
     "fuse_chance": 0.4, "control_loss_chance": 0.0, "warhead": "he_420_tt250", "guidance_lag_s": 0.25, "smoke": 2.5},
    # 9M113 Konkurs: 14.6 kg, 135 mm, 1.165 m, about 208 m/s, 75-4000 m, wire SACLOS;
    # 9M133 Kornet: 27 kg, 152 mm, 1.2 m, about 300 m/s, 100-5500 m, laser beam riding SACLOS
    {"id": "9m113_konkurs", "name": "9M113 Konkurs", "guidance": "saclos", "mass_kg": 14.6, "caliber_mm": 135.0, "length_m": 1.165,
     "span_m": 0.47, "launch_speed_ms": 80.0, "max_speed_ms": 208.0, "boost_s": 1.2, "burn_s": 2.0, "drag_k": 1.8e-4,
     "max_range_m": 4000.0, "min_range_m": 75.0, "turn_accel_ms2": 50.0, "lift": True, "hp": 3.0, "warhead_share": 0.35,
     "fuse_chance": 0.65, "control_loss_chance": 0.45, "warhead": "heat_135_konkurs", "guidance_lag_s": 0.25, "smoke": 1.0},
    {"id": "9m133_kornet", "name": "9M133 Kornet", "guidance": "saclos", "mass_kg": 27.0, "caliber_mm": 152.0, "length_m": 1.20,
     "span_m": 0.46, "launch_speed_ms": 90.0, "max_speed_ms": 300.0, "boost_s": 1.5, "burn_s": 2.5, "drag_k": 1.6e-4,
     "max_range_m": 5500.0, "min_range_m": 100.0, "turn_accel_ms2": 60.0, "lift": True, "hp": 4.0, "warhead_share": 0.35,
     "fuse_chance": 0.65, "control_loss_chance": 0.35, "warhead": "heat_152_kornet", "guidance_lag_s": 0.2, "smoke": 1.2},
]

# Rounds carried: (shell id, count) per vehicle, in the order the gunner's selector lists them.
# Totals are the stowage of each vehicle; the split follows period loading tables (roughly half
# armour-piercing and half HE, with the few tungsten rounds that were issued).
AMMO = {
    "de_pz3_j": [("apc_50_pzgr39", 42), ("he_50_sprgr38", 36), ("apcr_50_pzgr40", 6)],
    "de_pz4_h": [("apcbc_75_pzgr39", 40), ("he_75_sprgr34", 40), ("apcr_75_pzgr40", 4), ("heat_75_gr38c", 3)],
    "de_tiger_e": [("apcbc_88_l56", 46), ("he_88_sprgr", 40), ("apcr_88_pzgr40", 6)],
    "de_panther_g": [("apcbc_75_pzgr39_42", 40), ("he_75_sprgr42", 38), ("apcr_75_pzgr40_42", 4)],
    "de_panther_f": [("apcbc_75_pzgr39_42", 40), ("he_75_sprgr42", 35), ("apcr_75_pzgr40_42", 4)],
    "su_t10m": [("aphe_122_br472", 10), ("apds_122_3bm11", 5), ("heatfs_122_3bk9", 5), ("he_122_of472", 10)],
    "su_t34_85": [("aphe_85_br365", 24), ("he_85_o365k", 31), ("apcr_85_br365p", 5)],
    "su_t34_1940": [("aphe_76_br350a_l11", 30), ("he_76_of350_l11", 47)],
    "de_gepard": [("hei_35_kda", 320), ("apds_35_kda", 20)],
    "su_is2": [("aphe_122_br471", 12), ("he_122_of471", 16)],
    "su_t54": [("apbc_100_br412", 14), ("he_100_of412", 20)],
    "us_m4a3_75w": [("apcbc_75_m61_m3", 44), ("he_75_m48", 52), ("ap_75_m72", 8)],
    "us_m4a2": [("apcbc_75_m61_m3", 44), ("he_75_m48", 49), ("ap_75_m72", 4)],
    "us_m4a3_76w_hvss": [("apcbc_76_m62", 33), ("he_76_m42a1", 32), ("apcr_76_m93", 6)],
    "us_m4a1_76w": [("apcbc_76_m62", 35), ("he_76_m42a1", 32), ("apcr_76_m93", 4)],
    "us_m10": [("apcbc_76_m62", 26), ("he_76_m42a1", 24), ("apcr_76_m93", 4)],
    "uk_cromwell_iv": [("apcbc_75_m61", 30), ("he_75_m48", 34)],
    "de_hetzer_mk103": [("he_30_mgesch", 300), ("apt_30_pzgr", 160), ("apcr_30_pzgr40", 40)],
    "de_vk1602": [("apc_50_pzgr39", 30), ("he_50_sprgr38", 20), ("apcr_50_pzgr40", 6)],
    "uk_cmp_portee": [("ap_57_mk7", 40), ("apcbc_57_mk9", 20), ("he_57_mk10", 20)],
    "de_rso_pak40": [("apcbc_75_pzgr39", 20), ("he_75_sprgr34", 12), ("apcr_75_pzgr40", 4)],
    "de_rso_flak": [("hefi_20_sprgr", 400), ("apt_20_pzgr39", 240), ("apcr_20_pzgr40", 80)],
    "de_aufkl_panther": [("apc_50_pzgr39", 30), ("he_50_sprgr38", 20), ("apcr_50_pzgr40", 6)],
    "us_m8": [("apcbc_37_m51", 40), ("he_37_m63", 30), ("ap_37_m74", 10)],
    "de_sdkfz234_2": [("apc_50_pzgr39", 30), ("he_50_sprgr38", 20), ("apcr_50_pzgr40", 5)],
    "de_flakpz38t": [("hefi_20_sprgr", 560), ("apt_20_pzgr39", 340), ("apcr_20_pzgr40", 140)],
    "de_sdkfz140_1": [("hefi_20_sprgr", 140), ("apt_20_pzgr39", 130), ("apcr_20_pzgr40", 60)],
    "de_hetzer": [("apcbc_75_pzgr39", 26), ("he_75_sprgr34", 15)],
    "de_hetzer_flak": [("hefi_20_sprgr", 480), ("apt_20_pzgr39", 300), ("apcr_20_pzgr40", 120)],
    "de_pzjg1": [("apcbc_47_pak36t", 54), ("he_47_pak36t", 32)],
    "xp_w78": [("apfsds_78_xp", 18), ("heatfs_78_xp", 10), ("he_78_xp", 10)],
    "su_att_m46": [("apcbc_130_br482b", 6), ("he_130_of482m", 12)],
    "xp_kda35": [("apcbche_35", 100), ("hei_35_kda", 100), ("apds_35_kda", 80), ("apfsds_35_pmc287", 60), ("heatfs_35", 60)],
}

# Machine guns. Rates, muzzle velocities and bullet masses are the commonly published service
# figures; belt length is what the vehicle mount fed from. heat_rounds (continuous fire until the
# barrel is too hot) and cool_s are a simplified heat model, not measured values. Tracer colours
# are for telling the guns apart on screen, and tracer_every is denser than a service belt so
# that the fall of shot can be followed.
MACHINE_GUNS = [
    # KPVT 14.5 mm: the B-32 API at 1,000 m/s, about 32 mm at 100 m (BTR and tank coaxial gun)
    {"id": "kpvt", "name": "KPVT (14.5 mm)", "caliber_mm": 14.5, "rate_rpm": 600, "muzzle_velocity_ms": 1000, "bullet_mass_g": 64.0,
     "drag_coefficient": 0.30, "belt_rounds": 50, "reload_s": 8.0, "dispersion_mrad": 1.4, "tracer_every": 3,
     "pen_mm_100m": 32, "heat_rounds": 150, "cool_s": 120, "tracer_rgb": [1.0, 0.5, 0.3]},
    {"id": "mg34", "name": "MG 34 (7.92 mm)", "caliber_mm": 7.92, "rate_rpm": 850, "muzzle_velocity_ms": 755, "bullet_mass_g": 12.8,
     "drag_coefficient": 0.30, "belt_rounds": 150, "reload_s": 6.0, "dispersion_mrad": 1.6, "tracer_every": 3,
     "pen_mm_100m": 10, "heat_rounds": 250, "cool_s": 100, "tracer_rgb": [1.0, 0.86, 0.45]},
    {"id": "dt", "name": "DT (7.62 mm)", "caliber_mm": 7.62, "rate_rpm": 600, "muzzle_velocity_ms": 840, "bullet_mass_g": 9.6,
     "drag_coefficient": 0.32, "belt_rounds": 63, "reload_s": 4.0, "dispersion_mrad": 1.8, "tracer_every": 3,
     "pen_mm_100m": 9, "heat_rounds": 190, "cool_s": 100, "tracer_rgb": [0.45, 1.0, 0.5]},
    {"id": "sgmt", "name": "SGMT (7.62 mm)", "caliber_mm": 7.62, "rate_rpm": 650, "muzzle_velocity_ms": 800, "bullet_mass_g": 11.8,
     "drag_coefficient": 0.31, "belt_rounds": 250, "reload_s": 7.0, "dispersion_mrad": 1.6, "tracer_every": 3,
     "pen_mm_100m": 9, "heat_rounds": 500, "cool_s": 110, "tracer_rgb": [0.45, 1.0, 0.5]},
    {"id": "dshk", "name": "DShK (12.7 mm)", "caliber_mm": 12.7, "rate_rpm": 600, "muzzle_velocity_ms": 850, "bullet_mass_g": 48.3,
     "drag_coefficient": 0.30, "belt_rounds": 50, "reload_s": 9.0, "dispersion_mrad": 1.4, "tracer_every": 2,
     "pen_mm_100m": 20, "heat_rounds": 120, "cool_s": 120, "tracer_rgb": [0.45, 1.0, 0.5]},
    {"id": "m1919a4", "name": "M1919A4 (.30)", "caliber_mm": 7.62, "rate_rpm": 500, "muzzle_velocity_ms": 853, "bullet_mass_g": 9.7,
     "drag_coefficient": 0.32, "belt_rounds": 250, "reload_s": 7.0, "dispersion_mrad": 1.6, "tracer_every": 3,
     "pen_mm_100m": 10, "heat_rounds": 300, "cool_s": 100, "tracer_rgb": [1.0, 0.42, 0.2]},
    {"id": "m2hb", "name": "M2HB (.50)", "caliber_mm": 12.7, "rate_rpm": 520, "muzzle_velocity_ms": 890, "bullet_mass_g": 45.8,
     "drag_coefficient": 0.30, "belt_rounds": 100, "reload_s": 9.0, "dispersion_mrad": 1.3, "tracer_every": 2,
     "pen_mm_100m": 22, "heat_rounds": 150, "cool_s": 120, "tracer_rgb": [1.0, 0.42, 0.2]},
    {"id": "besa", "name": "Besa (7.92 mm)", "caliber_mm": 7.92, "rate_rpm": 700, "muzzle_velocity_ms": 823, "bullet_mass_g": 12.8,
     "drag_coefficient": 0.30, "belt_rounds": 225, "reload_s": 7.0, "dispersion_mrad": 1.6, "tracer_every": 3,
     "pen_mm_100m": 10, "heat_rounds": 300, "cool_s": 100, "tracer_rgb": [1.0, 0.5, 0.25]},
    {"id": "mg42", "name": "MG 42 (7.92 mm)", "caliber_mm": 7.92, "rate_rpm": 1200, "muzzle_velocity_ms": 755, "bullet_mass_g": 12.8,
     "drag_coefficient": 0.30, "belt_rounds": 150, "reload_s": 6.0, "dispersion_mrad": 1.8, "tracer_every": 3,
     "pen_mm_100m": 10, "heat_rounds": 250, "cool_s": 90, "tracer_rgb": [1.0, 0.86, 0.45]},
    {"id": "mg_proto", "name": "Prototype MG (7.62 mm)", "caliber_mm": 7.62, "rate_rpm": 600, "muzzle_velocity_ms": 830, "bullet_mass_g": 10.0,
     "drag_coefficient": 0.32, "belt_rounds": 200, "reload_s": 6.0, "dispersion_mrad": 1.6, "tracer_every": 3,
     "pen_mm_100m": 9, "heat_rounds": 250, "cool_s": 100, "tracer_rgb": [0.6, 0.85, 1.0]},
]

# --------------------------------------------------------------------------- vehicles


def wheel_row(zs, y, r, w, x=0.0):
    return [{"z": r3(z), "y": r3(y), "r": r3(r), "w": r3(w), "x": r3(x)} for z in zs]


def tiger_turret_outline(pz, n=16):
    """Tiger turret plan traced from the top view: flat front 1.6 m wide, walls opening out to the
    full 2.17 m at the ring centre, semicircular rear. Clockwise seen from above."""
    r = 1.085
    pts = [[-0.80, r3(pz + 1.26)], [0.80, r3(pz + 1.26)], [1.0, r3(pz + 0.62)], [r, r3(pz)]]
    for i in range(1, n):
        t = math.pi * i / n
        pts.append([r3(r * math.cos(t)), r3(pz - r * math.sin(t))])
    pts += [[-r, r3(pz)], [-1.0, r3(pz + 0.62)]]
    return pts


def tiger():
    # Outline traced from a four-view general-arrangement drawing (side view scale 75.6 px/m
    # along the hull, 78 px/m vertically; front view 159 px/m). Origin: middle of the 6.316 m
    # overall hull length (which includes the rear mudguards), on the ground.
    L, W, H, c = 6.316, 3.56, 1.80, 0.47
    piv = (0, H, 0.05)
    mount = (0, 2.19, 1.22)
    muzzle_z = L / 2 + (8.45 - 6.316)
    tx = W / 2 - 0.725 / 2
    tt = 0.085                               # track thickness incl. grousers
    axles = [1.99 - i * 0.516 for i in range(8)]
    wy = 0.40 + tt
    wheels = []
    for i, z in enumerate(axles):
        offs = (0.24, -0.10) if i % 2 == 0 else (0.07, -0.27)
        for o in offs:
            wheels += wheel_row([z], wy, 0.40, 0.11, o)
    pz = piv[2]
    roof = 2.58
    parts = [
        # lower hull between the tracks: belly, 65 deg lower nose, 25 deg upper nose, 9 deg rear plate
        prism([(-2.50, c), (2.50, c), (3.16, 1.01), (3.10, 1.31), (-2.64, 1.31)], 1.82),
        # glacis (front roof), rising gently to the driver's plate
        prism([(2.34, 1.31), (3.10, 1.31), (2.34, 1.40)], 1.82),
        # superstructure over the tracks: driver's plate 9 deg, vertical sides, sloped rear
        prism([(-2.64, 1.31), (2.38, 1.31), (2.30, H), (-2.70, H)], 3.14),
        # mudguards: front flaps, side strips, rear flaps
        box((0.72, 0.03, 0.62), (1.42, 1.32, 2.69), mirror=True, mat="paint_dark"),
        box((0.72, 0.03, 0.26), (1.42, 1.28, 3.09), rot=(18, 0, 0), mirror=True, mat="paint_dark"),
        box((0.29, 0.025, 5.0), (1.715, 1.30, -0.12), mirror=True, mat="paint_dark"),
        box((0.72, 0.03, 0.5), (1.42, 1.255, -2.885), rot=(-16, 0, 0), mirror=True, mat="paint_dark"),
        # driver's visor block with its slit, bow MG ball mount
        box((0.62, 0.26, 0.10), (-0.48, 1.57, 2.37), rot=(-9, 0, 0)),
        box((0.34, 0.05, 0.03), (-0.48, 1.59, 2.43), rot=(-9, 0, 0), mat="black"),
        cyl(0.19, 0.10, "z", (0.56, 1.58, 2.37), r2=0.15),
        cyl(0.11, 0.10, "z", (0.56, 1.58, 2.44), r2=0.07, mat="paint_dark"),
        cyl(0.022, 0.36, "z", (0.56, 1.58, 2.66), mat="steel"),
        # crew hatches, headlight, hull roof ventilator
        cyl(0.27, 0.03, "y", (0.85, H + 0.015, 1.83), mirror=True, mat="paint_dark"),
        cyl(0.05, 0.05, "y", (0.85, H + 0.05, 1.99), mirror=True, mat="paint_dark"),
        cyl(0.085, 0.06, "y", (0.0, H + 0.03, 2.16), mat="paint_dark"),
        cyl(0.07, 0.01, "y", (0.0, H + 0.064, 2.16), mat="black"),
        # engine deck: centre hatch, radiator and fan grilles
        box((1.16, 0.03, 1.36), (0.0, H + 0.015, -1.82), mat="paint_dark"),
        cyl(0.2, 0.03, "y", (0.0, H + 0.015, -1.55), mat="paint_dark"),
        box((0.92, 0.025, 0.78), (1.08, H + 0.013, -1.42), mirror=True, mat="black"),
        box((0.92, 0.025, 0.52), (1.08, H + 0.013, -2.34), mirror=True, mat="black"),
        box((0.96, 0.02, 0.06), (1.08, H + 0.02, -1.92), mirror=True, mat="paint_dark"),
        # rear plate: exhaust mufflers with their sheet-metal shields, starter cover, jack
        cyl(0.14, 0.62, "y", (0.42, 1.42, -2.80), mirror=True, mat="steel"),
        cyl(0.05, 0.14, "y", (0.42, 1.80, -2.80), mirror=True, mat="black"),
        box((0.37, 0.66, 0.035), (0.42, 1.42, -2.955), mirror=True, mat="paint_dark"),
        box((0.035, 0.66, 0.32), (0.62, 1.42, -2.80), mirror=True, mat="paint_dark"),
        cyl(0.16, 0.07, "z", (0.0, 0.98, -2.62), mat="paint_dark"),
        box((0.5, 0.1, 0.1), (0.0, 1.22, -2.67), mat="steel"),
        # tow shackles
        box((0.07, 0.24, 0.2), (0.74, 1.0, 3.2), mirror=True, mat="steel"),
        box((0.07, 0.2, 0.18), (0.74, 0.9, -2.66), mirror=True, mat="steel"),
        # turret shell: vertical 80 mm walls, flat roof
        plan(tiger_turret_outline(pz), H + 0.04, roof),
        # mantlet with the gun sleeve boss, sight and coax apertures
        box((1.60, 0.62, 0.20), (0, 2.18, pz + 1.36), mount="gun"),
        cyl(0.30, 0.22, "z", (0, 2.19, pz + 1.53), r2=0.24, mount="gun"),
        cyl(0.032, 0.03, "z", (-0.42, 2.30, pz + 1.47), mount="gun", mat="black"),
        cyl(0.032, 0.03, "z", (-0.52, 2.30, pz + 1.47), mount="gun", mat="black"),
        cyl(0.03, 0.1, "z", (0.36, 2.19, pz + 1.49), mount="gun", mat="black"),
        # 8.8 cm KwK 36: armoured sleeve, two barrel steps, double-baffle muzzle brake
        barrel(mount, pz + 1.6, 2.50, 0.17, 0.16),
        barrel(mount, 2.50, 3.28, 0.115, 0.11),
        barrel(mount, 3.28, muzzle_z - 0.48, 0.088, 0.078),
        recoil(cyl(0.12, 0.48, "z", (0, 2.19, muzzle_z - 0.24), mount="gun", mat="paint_dark")),
        recoil(cyl(0.15, 0.06, "z", (0, 2.19, muzzle_z - 0.40), mount="gun", mat="paint_dark")),
        recoil(cyl(0.15, 0.06, "z", (0, 2.19, muzzle_z - 0.14), mount="gun", mat="paint_dark")),
        recoil(cyl(0.13, 0.04, "z", (0, 2.19, muzzle_z - 0.02), mount="gun", mat="paint_dark")),
        # commander's cupola (cast type) with periscope blocks and hatch, loader's hatch, ventilator
        cyl(0.42, 0.20, "y", (-0.62, roof + 0.10, pz - 0.37), r2=0.39, mount="turret", segs=24),
        cyl(0.27, 0.035, "y", (-0.62, roof + 0.215, pz - 0.37), mount="turret", mat="paint_dark"),
    ]
    for i in range(7):
        a = 2 * math.pi * i / 7
        parts.append(box((0.13, 0.07, 0.09), (-0.62 + 0.36 * math.sin(a), roof + 0.215, pz - 0.37 + 0.36 * math.cos(a)),
                         rot=(0, math.degrees(a), 0), mount="turret", mat="paint_dark"))
    parts += [
        box((0.50, 0.035, 0.46), (0.66, roof + 0.018, pz - 0.10), mount="turret", mat="paint_dark"),
        cyl(0.15, 0.07, "y", (0.0, roof + 0.035, pz - 0.05), mount="turret", mat="paint_dark"),
        # stowage bin on the turret rear
        box((1.26, 0.66, 0.50), (0, 2.21, pz - 1.34), mount="turret", mat="paint_dark"),
        box((1.30, 0.03, 0.54), (0, 2.555, pz - 1.34), mount="turret"),
    ]
    # spare track links hung on the turret sides
    for side in (-1, 1):
        for k in range(5):
            zo = 0.38 - k * 0.165
            wx = 1.085 - 0.085 * zo / 0.62 if zo >= 0 else math.sqrt(1.085 ** 2 - zo * zo)
            parts.append(box((0.07, 0.5, 0.13), (side * (wx + 0.03), 2.2, pz + zo), mount="turret", mat="track"))
    return {
        "id": "de_tiger_e", "name": "Tiger I (Pz.Kpfw. VI Ausf. E)", "nation": "germany",
        "based_on": "Panzerkampfwagen VI Tiger Ausf. E, late production (cast cupola, steel-rimmed wheels)",
        "notes": "Gear ratios are derived from the published per-gear road speeds. Turret ring diameter and interior layout are estimates.",
        "L": L, "W": W, "H": H, "clear": c, "body_w": 3.14, "nose_y": 1.30, "mass": 57000, "com": (0, 0.95, 0.0),
        "turret_pos": piv, "turret_size": (2.17, 0.78, 2.85), "ring": 1.85, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "armor": {"upper_front": (100, 9, "rha"), "glacis": (60, 1.3, "rha"), "lower_front": (100, 25, "rha"),
                  "side": (80, 0, "rha"), "rear": (80, 9, "rha"), "roof": 25, "floor": 25},
        "turret_armor": {"front": (100, 5, "rha"), "mantlet": (120, 1.84, 0.84, "cha"), "side": (80, 0, "rha"), "rear": (80, "rha"), "roof": 25},
        "gun": {"id": "kwk36_88_l56", "caliber_mm": 88.0, "barrel_length_mm": 4930, "recoil_mm": 580, "rounds_per_min": 8.0,
                "reload_s": 7.5, "traverse_deg_s": 9.0, "elevate_deg_s": 4.0, "max_depression_deg": 8.0, "max_elevation_deg": 15.0,
                "dispersion_mrad": 0.8, "mass_kg": 1310, "ammo": ["apcbc_88_l56"]},
        "sight": {"name": "TZF 9b", "levels": [{"magnification": 2.5, "fov_deg": 23.0}]},
        "cls": "heavy", "year": 1943, "outline": "traced",
        "dep_table": [(0, 8), (140, 8), (150, 7), (210, 7), (220, 8), (360, 8)],
        "secondary": [mg("coax_mg34", "mg34", "coax", (0.36, 2.19, piv[2] + 1.55)), mg("bow_mg34", "mg34", "hull", (0.56, 1.58, 2.84), (15, 7, 20))],
        "engine": {"horsepower": 690, "max_rpm": 3000, "idle_rpm": 800, "weight_kg": 1200,
                   "torque_curve": [[800, 1500], [1500, 1780], [2100, 1850], [3000, 1639]]},
        "transmission": {"forward_gears": 8, "reverse_gears": 4, "gear_ratios": [15.99, 10.46, 7.35, 4.95, 3.22, 2.172, 1.489, 1.0],
                         "final_drive_ratio": 10.46, "shift_time_s": 0.25},
        "physics": {"track_width_m": 0.725, "track_length_m": 3.605, "suspension": {"travel_m": 0.22, "stiffness": 420000, "damping": 30000},
                    "rolling_resistance": 0.045, "sprocket_radius_m": 0.42, "drivetrain_efficiency": 0.80, "max_brake_decel_ms2": 5.0,
                    "max_turn_rate_deg_s": 20.0, "max_reverse_speed_ms": 3.0, "min_turn_radius_m": 0.0},
        "modules": [
            module("engine", "engine", (0, 1.0, -1.82), (0.55, 0.42, 0.68), 160),
            module("transmission", "transmission", (0, 0.85, 2.0), (0.45, 0.3, 0.55), 130),
            module("fuel_tank_l", "fuel_tank", (-1.05, 1.5, -1.9), (0.3, 0.2, 0.55), 50),
            module("fuel_tank_r", "fuel_tank", (1.05, 1.5, -1.9), (0.3, 0.2, 0.55), 50),
            module("ammo_rack_l", "ammo_rack", (-1.25, 1.38, 0.2), (0.28, 0.25, 0.9), 60),
            module("ammo_rack_r", "ammo_rack", (1.25, 1.38, 0.2), (0.28, 0.25, 0.9), 60),
            module("breech", "gun_breech", (0, 2.19, 0.60), (0.2, 0.2, 0.4), 110),
            module("gun_barrel", "gun_barrel", (0, 2.19, 3.3), (0.1, 0.1, 2.0), 140),
            module("turret_drive", "turret_drive", (0, 1.6, 0.1), (0.3, 0.12, 0.3), 80),
            module("vertical_drive", "vertical_drive", (-0.42, 1.95, 0.85), (0.1, 0.1, 0.15), 60),
            module("radio", "radio", (0.0, 1.2, 2.75), (0.25, 0.12, 0.15), 40),
        ],
        "crew": [crew("driver", (-0.6, 1.15, 1.2)), crew("radio_operator", (0.6, 1.15, 1.2)), crew("gunner", (-0.55, 2.05, 0.75)),
                 crew("commander", (-0.5, 2.25, -0.45)), crew("loader", (0.55, 2.05, -0.1))],
        "palette": {"paint": "#9a8f66", "paint_dark": "#746b4b"},
        "parts": parts,
        "running_gear": {"track_width": 0.725, "track_thickness": tt, "track_x": r3(tx), "link_pitch": 0.13, "link_style": "twin_guide", "track_sag": 0.034,
                         "sprocket": {"z": 2.68, "y": 0.73, "r": 0.40, "teeth": 20}, "idler": {"z": -2.26, "y": 0.565, "r": 0.30},
                         "wheels": wheels, "rollers": [], "wheel_style": "steel_dish"},
    }


def with_wt_hull(s):
    """A vehicle whose hull and running gear are an imported model (tools/wt_import.py with
    render_only writes model.json and wt_hull.json next to its data): the procedural hull parts
    go, the running gear is the model's own (so its wheels turn on the right axles)."""
    path = os.path.join(DATA, "vehicles", s["id"], "wt_hull.json")
    if not os.path.exists(path):
        return s
    wt = json.load(open(path))
    s["parts"] = [p for p in s["parts"] if p.get("mount", "hull") != "hull"]
    s["running_gear"] = wt["running_gear"]
    s["model"] = "model.json"
    s["notes"] = s["notes"] + " Hull and running gear: " + wt["source"] + "."
    return s


def polar_ring(y, cx, cz, radii, n=36, k=1.0, dz=0.0):
    """A cast turret's plan section at height y from its radius every 360/len(radii) degrees,
    starting straight behind and going round by the left (x right, z forward; measured on the
    reference sections), scaled by k about (cx, cz + dz), wound as loft() wants for rings
    stacked upwards."""
    m = len(radii)
    out = []
    for i in range(n):
        t = 2 * math.pi * i / n
        x, z = math.cos(t), -math.sin(t)
        th = math.atan2(x, z)
        f = (th + math.pi) / (2 * math.pi) * m
        a = int(math.floor(f)) % m
        b = (a + 1) % m
        w = f - math.floor(f)
        r = (radii[a] * (1 - w) + radii[b] * w) * k
        out.append([cx + r * x, y, cz + dz + r * z])
    return out


def rrect_ring(z, cx, cy, hw, hh, n=24, p=4.0):
    """A rounded-rectangle cross-section at z (a mantlet casting), wound like section_ring."""
    out = []
    for i in range(n):
        t = -math.pi / 2 + 2 * math.pi * i / n
        c, s = math.cos(t), math.sin(t)
        out.append([cx + hw * math.copysign(abs(c) ** (2 / p), c), cy + hh * math.copysign(abs(s) ** (2 / p), s), z])
    return out


# The T-34-85 (1944) cast turret: radius from the ring centre (z 0.54) every 10 degrees from
# straight behind round by the left, at seven heights from the lip to the roof; measured off the
# reference model's sections.
T3485_POLAR = [
    (1.66, [1.4, 1.45, 1.49, 1.44, 1.29, 1.18, 1.08, 1.01, 0.96, 0.93, 0.92, 0.93, 0.97, 1.02, 1.13, 1.08, 1.08, 0.95, 0.95, 0.95, 1.09, 1.14, 1.12, 1.02, 0.96, 0.93, 0.92, 0.92, 0.96, 1.01, 1.07, 1.17, 1.29, 1.43, 1.43, 1.45]),
    (1.80, [1.5, 1.55, 1.5, 1.5, 1.33, 1.22, 1.13, 1.06, 1.01, 0.98, 0.94, 0.94, 0.98, 1.05, 1.2, 1.2, 1.2, 0.99, 0.99, 1.0, 1.19, 1.19, 1.19, 1.05, 0.97, 0.94, 0.93, 0.97, 1.0, 1.04, 1.11, 1.22, 1.33, 1.49, 1.5, 1.52]),
    (1.95, [1.57, 1.58, 1.54, 1.45, 1.27, 1.18, 1.12, 1.06, 0.99, 0.92, 0.88, 0.89, 0.94, 1.0, 1.13, 1.13, 1.13, 1.04, 1.03, 1.04, 1.13, 1.13, 1.13, 1.0, 0.92, 0.88, 0.87, 0.91, 0.98, 1.05, 1.12, 1.18, 1.27, 1.43, 1.54, 1.58]),
    (2.10, [1.46, 1.48, 1.51, 1.38, 1.23, 1.13, 1.06, 1.0, 0.93, 0.86, 0.82, 0.82, 0.88, 0.95, 1.06, 1.06, 1.06, 1.01, 0.99, 1.01, 1.06, 1.06, 1.06, 0.95, 0.87, 0.82, 0.82, 0.85, 0.93, 0.99, 1.06, 1.12, 1.19, 1.38, 1.51, 1.51]),
    (2.22, [1.44, 1.45, 1.49, 1.34, 1.16, 1.07, 1.01, 0.95, 0.87, 0.81, 0.77, 0.78, 0.83, 0.91, 1.02, 1.02, 1.02, 0.95, 0.94, 0.95, 1.01, 1.01, 1.01, 0.9, 0.82, 0.78, 0.77, 0.81, 0.87, 0.95, 1.01, 1.07, 1.15, 1.34, 1.49, 1.49]),
    (2.29, [1.43, 1.48, 1.48, 1.32, 1.14, 1.03, 0.99, 0.92, 0.84, 0.78, 0.75, 0.76, 0.79, 0.86, 0.92, 0.95, 0.92, 0.9, 0.89, 0.91, 0.92, 0.95, 0.92, 0.86, 0.79, 0.76, 0.74, 0.78, 0.83, 0.92, 0.98, 1.02, 1.13, 1.25, 1.47, 1.48]),
]


def t34_85():
    """T-34-85 (1944), built from the four-view drawing and the reference model's measurements:
    the welded hull with the 60-degree glacis carrying the driver's hatch and the bow MG's ball
    mount, the 40-degree sides over the tracks, the raised engine deck and the 47-degree upper rear
    plate with the round transmission hatch and the exhausts; the cast turret through its measured
    sections, the mantlet casting round the trunnions, the commander's cupola on the left and the
    loader's hatch on the right, the MK-4 periscopes and the two ventilator domes; five large road
    wheels with rubber tyres on the Christie springs, the front idler and the rear sprocket."""
    L, W, H, c = 6.10, 3.00, 1.52, 0.39
    pz = 0.54
    piv = (0, H, pz)
    mount = (0, 1.97, 1.40)
    muzzle_z = 4.97
    tx = 1.265
    wz = [1.87, 0.94, -0.10, -0.97, -1.84]
    roof = 2.31

    def sec(b, top):
        # belly between the tracks; the sponson floor out to the fender lip; the side plates
        # leaning in 40 degrees from the lip to the roof edge
        su = min(1.07, top - 0.03)
        lip = min(1.10, top - 0.01)
        if top >= 1.42:
            side = [(1.31, 1.11), (1.03, 1.42), (1.03, top - 0.01)]
        else:
            k = max(0.0, (top - 1.11) / 0.31)
            side = [(1.31, min(1.11, top)), (1.31 - 0.28 * k, top - 0.005)]
        return [(0, b), (0.93, b), (0.93, max(b, su))] + [(1.54, max(b, su)), (1.54, max(b, lip))] + side + [(0, top)]

    def ring(z, b, top):
        pts = sec(b, top)
        # the loft wants the same point count in every section
        while len(pts) < 9:
            pts.insert(-1, pts[-2])
        return section_ring(z, pts)

    hull = loft([
        ring(-2.92, 0.82, 0.89), ring(-2.72, 0.63, 1.09), ring(-2.52, 0.44, 1.26), ring(-2.32, c, 1.44),
        ring(-2.12, c, 1.59), ring(-0.36, c, 1.60), ring(-0.30, c, H), ring(1.30, c, H),
        ring(2.40, c, 0.93), ring(2.88, 0.66, 0.70),
    ], crease=25)
    fender = [(2.05, 1.07), (2.05, 1.10), (2.90, 1.08), (3.06, 1.00), (3.10, 0.92), (3.05, 0.92), (2.98, 1.00), (2.86, 1.05)]
    parts = [hull]
    parts += [
        # the front mudguards, the rear mud flaps
        prism(fender, 0.50, x=tx, mat="paint"),
        prism(fender, 0.50, x=-tx, mat="paint"),
        box((0.50, 0.25, 0.02), (tx, 0.95, -2.95), mirror=True, mat="paint_dark"),
        # the glacis: the driver's hatch with its two periscopes (left), the bow DT in its ball
        # mount under an armoured hood (right), the headlamp and horn, the tow hooks, spare links
        box((0.56, 0.05, 0.62), (-0.30, 1.175, 2.00), rot=(-27.5, 0, 0), mat="paint_dark"),
        box((0.14, 0.08, 0.10), (-0.40, 1.30, 1.80), rot=(-27.5, 0, 0), mat="black"),
        box((0.14, 0.08, 0.10), (-0.18, 1.30, 1.80), rot=(-27.5, 0, 0), mat="black"),
        cyl(0.18, 0.16, "z", (0.52, 1.15, 2.10), r2=0.13, mat="paint_dark", segs=18),
        cyl(0.13, 0.08, "z", (0.52, 1.15, 2.20), mat="paint_dark", segs=16),
        cyl(0.09, 0.10, "z", (-0.75, 1.20, 2.00), mat="paint_dark"),
        cyl(0.07, 0.02, "z", (-0.75, 1.20, 2.06), mat="lamp"),
        cyl(0.05, 0.10, "z", (-0.55, 1.17, 2.05), r2=0.03, mat="paint_dark"),
        box((0.10, 0.16, 0.18), (0.62, 0.80, 2.88), mirror=True, mat="steel"),
        box((0.32, 0.03, 0.20), (0.0, 0.89, 2.55), rot=(-27.5, 0, 0), mat="track"),
        box((0.32, 0.03, 0.20), (0.36, 0.89, 2.55), rot=(-27.5, 0, 0), mat="track"),
        box((0.32, 0.03, 0.20), (-0.36, 0.89, 2.55), rot=(-27.5, 0, 0), mat="track"),
        # handrails along the hull sides, the tow cable, the external fuel tanks (two right, one
        # left), the spare track links on the sides
        cyl(0.012, 1.60, "z", (1.17, 1.28, 0.55), mirror=True, mat="steel", segs=6),
        cyl(0.018, 3.0, "z", (1.12, 1.33, -0.40), rot=(0, 0, 0), mat="steel", segs=6),
        cyl(0.19, 0.78, "z", (1.24, 1.30, -0.90), mat="paint_dark", segs=16),
        cyl(0.19, 0.78, "z", (1.24, 1.30, -1.75), mat="paint_dark", segs=16),
        cyl(0.19, 0.78, "z", (-1.24, 1.30, -1.75), mat="paint_dark", segs=16),
        box((0.03, 0.22, 0.34), (1.17, 1.25, 0.10), rot=(0, 0, 40), mirror=True, mat="track"),
        # the engine deck: the access hatch with its louvres either side, the radiator grilles
        box((0.92, 0.04, 0.90), (0, 1.62, -1.00), mat="paint_dark"),
        box((0.32, 0.025, 1.10), (0.70, 1.61, -1.05), mirror=True, mat="black"),
        box((1.70, 0.025, 0.40), (0, 1.60, -1.90), mat="black"),
        # the upper rear plate: the round transmission hatch, the two exhausts, the smoke drums
        cyl(0.33, 0.05, "z", (0, 1.15, -2.70), rot=(-47, 0, 0), mat="paint_dark", segs=24),
        cyl(0.07, 0.30, "z", (0.52, 1.07, -2.86), rot=(-20, 0, 0), mirror=True, mat="steel"),
        cyl(0.10, 0.36, "x", (0.85, 1.00, -2.95), mirror=True, mat="paint_dark", segs=14),
    ]
    # the cast turret: the ring collar, the sections, the roof
    rings = [polar_ring(y, 0.0, pz, r) for y, r in T3485_POLAR]
    rings.append(polar_ring(roof + 0.02, 0.0, pz, T3485_POLAR[-1][1], k=0.94))
    parts.append(loft(rings, mount="turret", crease=40))
    parts += [
        cyl(0.92, 0.16, "y", (0, H + 0.07, pz), mount="turret", mat="paint_dark", segs=40),
        # the mantlet casting: wide over the trunnions, rounded, narrowing forward; the gun sleeve
        # and the barrel
        loft([rrect_ring(1.46, 0, 1.97, 0.40, 0.30), rrect_ring(1.60, 0, 1.97, 0.38, 0.28), rrect_ring(1.72, 0, 1.97, 0.31, 0.19)],
             mount="gun", crease=50),
        cyl(0.165, 0.38, "z", (0, mount[1], 1.89), r2=0.15, mount="gun", segs=22),
        cyl(0.115, 0.06, "z", (0, mount[1], 2.10), mount="gun", segs=20),
        barrel(mount, 2.13, 3.40, 0.068, 0.066),
        barrel(mount, 3.40, muzzle_z - 0.02, 0.065, 0.062),
        cyl(0.03, 0.08, "z", (0.28, mount[1] + 0.02, 1.74), mount="gun", mat="black"),
        box((0.10, 0.10, 0.10), (-0.30, mount[1] + 0.10, 1.70), mount="gun", mat="black"),
        # the commander's cupola (left) with its five vision slits and split hatch; the loader's
        # hatch (right); the MK-4 periscopes; the two ventilator domes at the back of the roof
        cyl(0.34, 0.20, "y", (-0.37, roof + 0.10, 0.14), r2=0.32, mount="turret", segs=24),
        cyl(0.28, 0.06, "y", (-0.37, roof + 0.23, 0.14), r2=0.24, mount="turret", mat="paint_dark", segs=24),
        cyl(0.07, 0.04, "y", (-0.37, roof + 0.28, 0.14), mount="turret", mat="paint_dark", segs=12),
        cyl(0.27, 0.035, "y", (0.40, roof + 0.02, 0.10), mount="turret", mat="paint_dark", segs=22),
        box((0.12, 0.10, 0.16), (0.40, roof + 0.05, 0.42), mount="turret", mat="paint_dark"),
        box((0.12, 0.10, 0.16), (-0.55, roof + 0.05, 0.55), mount="turret", mat="paint_dark"),
        box((0.10, 0.10, 0.18), (0.45, roof + 0.05, 0.92), mount="turret", mat="paint_dark"),
        box((0.08, 0.03, 0.02), (0.40, roof + 0.07, 0.505), mount="turret", mat="glass"),
        box((0.08, 0.03, 0.02), (-0.55, roof + 0.07, 0.635), mount="turret", mat="glass"),
        cyl(0.13, 0.08, "y", (0.20, roof, -0.42), r2=0.08, mount="turret", segs=16),
        cyl(0.13, 0.08, "y", (-0.20, roof, -0.42), r2=0.08, mount="turret", segs=16),
        # the pistol ports and handrails on the sides, the lifting eyes, the aerial
        cyl(0.05, 0.04, "x", (0.99, 2.00, 0.30), mirror=True, mount="turret", mat="paint_dark"),
        cyl(0.012, 0.70, "z", (0.92, 2.18, -0.05), mirror=True, mount="turret", mat="steel", segs=6),
        box((0.06, 0.08, 0.10), (0.55, roof + 0.03, 1.15), mirror=True, mount="turret", mat="paint_dark"),
        cyl(0.04, 0.10, "y", (0.60, roof, -0.05), mount="turret", mat="paint_dark"),
        cyl(0.007, 1.70, "y", (0.60, roof + 0.90, -0.05), mount="turret", mat="black", segs=6),
    ]
    for k in range(5):
        a = math.radians(-150 + 60 * k)
        parts.append(box((0.10, 0.04, 0.03), (-0.37 + 0.335 * math.sin(a), roof + 0.16, 0.14 + 0.335 * math.cos(a)),
                         rot=(0, math.degrees(a), 0), mount="turret", mat="glass"))
    return {
        "id": "su_t34_85", "name": "T-34-85", "nation": "ussr",
        "based_on": "T-34-85 with 85 mm ZiS-S-53, 1944 production",
        "notes": "Hull, turret and running gear built from the four-view drawing and the measurements of the reference model supplied with the request (hull heights and plate angles, the turret's sections, the mantlet, wheel stations). Gear ratios are estimates chosen to match the published top speed; turret traverse rate and interior layout are estimates.",
        "L": L, "W": W, "H": H, "clear": c, "body_w": 2.06, "nose_y": 0.70, "mass": 32000, "com": (0, 0.85, 0.0),
        "turret_pos": piv, "turret_size": (2.10, 0.86, 2.70), "ring": 1.6, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "armor": {"upper_front": (45, 60, "rha"), "lower_front": (45, 53, "rha"), "side": (45, 40, "rha"), "rear": (45, 47, "rha"),
                  "roof": 20, "floor": 20},
        "turret_armor": {"front": (90, 5, "cha"), "mantlet": (90, 0.80, 0.60, "cha"), "side": (75, 20, "cha"), "rear": (52, "cha"), "roof": 20},
        "gun": {"id": "zis_s_53_85", "caliber_mm": 85.0, "barrel_length_mm": 4645, "recoil_mm": 320, "rounds_per_min": 7.5,
                "reload_s": 8.0, "traverse_deg_s": 22.0, "elevate_deg_s": 6.0, "max_depression_deg": 5.0, "max_elevation_deg": 20.0,
                "dispersion_mrad": 1.1, "mass_kg": 1150, "ammo": ["aphe_85_br365"]},
        "sight": {"name": "TSh-16", "levels": [{"magnification": 4.0, "fov_deg": 16.0}]},
        "cls": "medium", "year": 1944, "outline": "traced",
        "secondary": [mg("coax_dt", "dt", "coax", (0.28, mount[1] + 0.02, 1.80)), mg("bow_dt", "dt", "hull", (0.52, 1.15, 2.26), (12, 6, 16))],
        "engine": {"horsepower": 500, "max_rpm": 1900, "idle_rpm": 600, "weight_kg": 750,
                   "torque_curve": [[600, 1900], [1100, 2200], [1500, 2150], [1800, 1978], [1900, 1700]]},
        "transmission": {"forward_gears": 5, "reverse_gears": 1, "gear_ratios": [6.8, 3.6, 2.2, 1.45, 1.0],
                         "final_drive_ratio": 3.98, "shift_time_s": 0.5},
        "physics": {"track_width_m": 0.5, "track_length_m": 3.85, "suspension": {"travel_m": 0.24, "stiffness": 220000, "damping": 16000},
                    "rolling_resistance": 0.04, "sprocket_radius_m": 0.32, "drivetrain_efficiency": 0.82, "max_brake_decel_ms2": 6.0,
                    "max_turn_rate_deg_s": 30.0, "max_reverse_speed_ms": 2.0, "min_turn_radius_m": 1.3},
        "modules": [
            module("engine", "engine", (0, 0.95, -1.45), (0.5, 0.4, 0.65), 150),
            module("transmission", "transmission", (0, 0.85, -2.45), (0.55, 0.3, 0.28), 120),
            module("fuel_tank_l", "fuel_tank", (-0.95, 0.95, 0.3), (0.2, 0.28, 0.8), 50),
            module("fuel_tank_r", "fuel_tank", (0.95, 0.95, 0.3), (0.2, 0.28, 0.8), 50),
            module("ammo_floor", "ammo_rack", (0, 0.55, 0.7), (0.5, 0.12, 0.7), 60),
            module("ammo_ready", "ammo_rack", (0.0, 1.95, pz - 0.80), (0.45, 0.14, 0.18), 40),
            module("breech", "gun_breech", (0, mount[1], 1.00), (0.18, 0.18, 0.40), 100),
            module("gun_barrel", "gun_barrel", (0, mount[1], 3.50), (0.08, 0.08, 1.40), 130),
            module("turret_drive", "turret_drive", (-0.6, 1.70, 1.10), (0.15, 0.12, 0.15), 70),
            module("radio", "radio", (-0.80, 1.90, 0.10), (0.1, 0.12, 0.2), 40),
        ],
        "crew": [crew("driver", (-0.36, 0.95, 1.85)), crew("radio_operator", (0.5, 0.95, 1.85)), crew("gunner", (-0.5, 1.80, 0.95)),
                 crew("commander", (-0.40, 1.95, 0.20)), crew("loader", (0.5, 1.80, 0.75))],
        "palette": {"paint": "#56643c", "paint_dark": "#3f4a2d"},
        "parts": parts,
        "running_gear": {"track_width": 0.50, "track_thickness": 0.065, "track_x": tx, "link_pitch": 0.172, "link_style": "center_guide", "track_sag": 0.036,
                         "sprocket": {"z": -2.61, "y": 0.60, "r": 0.32, "teeth": 0}, "idler": {"z": 2.65, "y": 0.66, "r": 0.26},
                         "wheels": wheel_row(wz, 0.415 + 0.065, 0.415, 0.30), "rollers": [], "wheel_style": "spoked"},
    }



# The T-34 (1940)'s welded turret, measured on the reference model (numbers only): at each station
# along the hull the right half of the section, bottom centre to roof centre -- the floor edge,
# the side plate at 1.62, 1.85 and 2.05 m, the roof edge and the roof.
T34_1940_TURRET = [
    (-0.58, [(0, 1.68), (0.28, 1.68), (0.31, 1.72), (0.33, 1.85), (0.25, 1.90), (0.15, 1.92), (0, 1.93)]),
    (-0.30, [(0, 1.62), (0.35, 1.62), (0.42, 1.66), (0.54, 1.85), (0.42, 2.05), (0.30, 2.13), (0, 2.15)]),
    (0.05, [(0, 1.535), (0.60, 1.535), (0.63, 1.62), (0.65, 1.85), (0.52, 2.05), (0.42, 2.17), (0, 2.19)]),
    (0.50, [(0, 1.535), (0.86, 1.535), (0.85, 1.62), (0.76, 1.85), (0.71, 2.05), (0.55, 2.19), (0, 2.20)]),
    (0.90, [(0, 1.535), (0.84, 1.535), (0.82, 1.62), (0.67, 1.85), (0.55, 2.05), (0.45, 2.15), (0, 2.17)]),
    (1.20, [(0, 1.535), (0.70, 1.535), (0.72, 1.62), (0.56, 1.85), (0.45, 2.05), (0.32, 2.13), (0, 2.14)]),
    (1.45, [(0, 1.56), (0.62, 1.56), (0.66, 1.62), (0.53, 1.85), (0.40, 2.05), (0.28, 2.08), (0, 2.09)]),
    (1.56, [(0, 1.70), (0.48, 1.70), (0.50, 1.74), (0.47, 1.85), (0.38, 1.95), (0.25, 1.99), (0, 2.00)]),
]


def t34_1940():
    """T-34 (1940): the T-34-85's hull (the same welded hull, without the external fuel tanks) with
    the early welded turret, its plates and rear overhang measured on the reference model, and the
    76 mm L-11 in its cast mantlet with the recuperator housing over the barrel."""
    g = t34_85()
    H = g["H"]
    pz = 0.68
    piv = (0, H, pz)
    mount = (0, 1.765, 1.25)
    muzzle_z = 2.99
    hull = [p for p in g["parts"] if p.get("mount", "hull") == "hull"
            and not (p["type"] == "cyl" and p.get("r") == 0.19 and abs(p.get("len", 0) - 0.78) < 1e-6)]
    parts = hull + [
        cyl(0.71, 0.10, "y", (0, H + 0.04, pz), mount="turret", mat="paint_dark", segs=36),
        loft([section_ring(z, half) for z, half in T34_1940_TURRET], mount="turret", crease=30),
        # the L-11's cast mantlet, the recuperator housing over the barrel, the sleeve, the barrel
        loft([rrect_ring(1.44, 0, 1.84, 0.31, 0.23, p=5), rrect_ring(1.62, 0, 1.84, 0.27, 0.21, p=5),
              rrect_ring(1.72, 0, 1.86, 0.17, 0.17, p=4)], mount="gun", crease=50),
        cyl(0.10, 0.30, "z", (0, 1.93, 1.75), r2=0.08, mount="gun", segs=18),
        cyl(0.11, 0.16, "z", (0, mount[1], 1.82), r2=0.085, mount="gun", segs=20),
        barrel(mount, 1.90, muzzle_z, 0.056, 0.052),
        cyl(0.03, 0.06, "z", (0.24, 1.80, 1.66), mount="gun", mat="black"),
        cyl(0.03, 0.05, "z", (-0.20, 1.92, 1.66), mount="gun", mat="black"),
        # the big hatch on the roof's front half, the PT-6 periscope and the vision blocks, the
        # ventilator and the pistol ports
        box((0.90, 0.035, 0.62), (0, 2.205, 0.86), rot=(-3, 0, 0), mount="turret", mat="paint_dark"),
        cyl(0.07, 0.10, "y", (0.30, 2.24, 1.05), mount="turret", mat="paint_dark", segs=14),
        box((0.10, 0.05, 0.12), (0.30, 2.30, 1.08), mount="turret", mat="black"),
        cyl(0.10, 0.08, "y", (0, 2.20, 0.32), r2=0.07, mount="turret", segs=14),
        box((0.04, 0.10, 0.18), (0.695, 1.95, 0.85), rot=(0, 0, 20), mirror=True, mount="turret", mat="paint_dark"),
        cyl(0.04, 0.04, "x", (0.62, 1.80, 0.10), mirror=True, mount="turret", mat="paint_dark"),
        cyl(0.03, 0.10, "y", (-0.55, 2.19, 0.20), mount="turret", mat="paint_dark"),
    ]
    g.update({
        "id": "su_t34_1940", "name": "T-34 (1940)", "year": 1940, "outline": "traced",
        "based_on": "T-34 model 1940 with the welded turret and the 76 mm L-11",
        "notes": "Hull as the T-34-85 build (drawing and reference measurements). The welded turret's sections and the L-11 mantlet were measured on the reference model supplied with the request (numbers only). Gear ratios, turret traverse and interior layout are estimates.",
        "mass": 26800, "turret_pos": piv, "turret_size": (1.72, 0.68, 2.14), "ring": 1.42, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "parts": parts,
    })
    g["armor"] = dict(g["armor"], roof=16, floor=15)
    g["turret_armor"] = {"front": (45, 30, "rha"), "mantlet": (40, 0.62, 0.46, "cha"), "side": (45, 30, "rha"), "rear": (45, "rha"), "roof": 16}
    g["gun"] = {"id": "l11_76", "caliber_mm": 76.2, "barrel_length_mm": 2324, "recoil_mm": 500, "rounds_per_min": 8.0,
                "reload_s": 7.0, "traverse_deg_s": 24.0, "elevate_deg_s": 5.0, "max_depression_deg": 5.0, "max_elevation_deg": 25.0,
                "dispersion_mrad": 1.2, "mass_kg": 550, "ammo": ["aphe_76_br350a_l11"]}
    g["sight"] = {"name": "TOD-6", "levels": [{"magnification": 2.5, "fov_deg": 26.0}]}
    g["dep_table"] = [(0, 5), (140, 5), (155, 2.5), (205, 2.5), (220, 5), (360, 5)]
    g["secondary"] = [mg("coax_dt", "dt", "coax", (0.24, 1.80, 1.70)), mg("bow_dt", "dt", "hull", (0.52, 1.15, 2.26), (12, 6, 16))]
    g["modules"] = [m for m in g["modules"] if m["kind"] not in ("gun_breech", "gun_barrel", "turret_drive", "radio") and m["id"] != "ammo_ready"] + [
        module("ammo_rear", "ammo_rack", (0.0, 1.85, 0.0), (0.30, 0.12, 0.15), 40),
        module("breech", "gun_breech", (0, mount[1], 0.90), (0.15, 0.15, 0.32), 90),
        module("gun_barrel", "gun_barrel", (0, mount[1], 2.40), (0.07, 0.07, 0.55), 110),
        module("turret_drive", "turret_drive", (-0.45, 1.65, 1.05), (0.12, 0.10, 0.12), 60),
        module("radio", "radio", (0.60, 1.25, 1.55), (0.12, 0.12, 0.18), 40),
    ]
    g["crew"] = [crew("driver", (-0.36, 0.95, 1.85)), crew("radio_operator", (0.5, 0.95, 1.85)),
                 dict(crew("commander", (-0.40, 1.72, 0.55)), also=["gunner"]), crew("loader", (0.40, 1.72, 0.45))]
    return g


# ---- Flakpanzer Gepard -------------------------------------------------------------------------
# Measured on the reference model supplied with the request (numbers only, its units scaled to the
# Gepard's 3.27 m width): hull heights along the centre line and over the sponsons, the cross-
# sections, the road wheel, idler, sprocket and return roller stations; the turret's sections, the
# gun housings, the barrels, the tracking radar in front and the search radar on its mast behind.
GEPARD_TURRET = [
    (-1.92, [(0, 1.85), (0.60, 1.85), (0.95, 2.05), (0.95, 2.50), (0.60, 2.62), (0, 2.62)]),
    (-1.20, [(0, 1.74), (0.67, 1.74), (1.02, 2.00), (1.00, 2.52), (0.66, 2.70), (0, 2.70)]),
    (-0.95, [(0, 1.72), (0.70, 1.72), (1.00, 2.00), (0.98, 2.52), (0.66, 2.70), (0, 2.70)]),
    (-0.85, [(0, 1.58), (0.70, 1.58), (0.72, 2.00), (0.72, 2.52), (0.66, 2.70), (0, 2.70)]),
    (1.30, [(0, 1.56), (0.70, 1.56), (0.72, 2.00), (0.72, 2.52), (0.66, 2.70), (0, 2.70)]),
    (1.52, [(0, 1.60), (0.62, 1.60), (0.64, 2.00), (0.62, 2.45), (0.55, 2.60), (0, 2.62)]),
]


def gepard_hull_ring(z, b, top):
    sf = 1.0
    half = [(0, b), (1.05, b), (1.05, max(b, sf)), (1.55, max(b, sf)), (1.55, max(b + 0.01, min(1.38, top - 0.05))), (1.30, top), (0, top)]
    return section_ring(z, half)


def gepard():
    L, W, H, c = 6.85, 3.27, 1.50, 0.44
    pz = 0.50
    piv = (0, H, pz)
    gx, gy, gz = 0.84, 2.30, -0.05
    muzzle_z = 3.66
    tx = 1.295
    tt = 0.08
    wz = [2.06, 1.375, 0.705, -0.01, -0.685, -1.36, -2.03]
    hull = loft([gepard_hull_ring(z, b, t) for z, b, t in [
        (-3.40, 0.80, 1.60), (-3.36, 0.70, 1.65), (-3.00, c, 1.65), (-1.10, c, 1.65), (-0.95, c, H),
        (1.95, c, H), (2.35, c, 1.38), (3.14, 1.06, 1.14)]], crease=25)
    parts = [hull]
    parts += [
        # rubber side skirts on the sponson edge, the front mudguards, the rear stowage bin
        box((0.03, 0.30, 5.10), (1.57, 1.15, -0.10), mirror=True, mat="black"),
        box((0.55, 0.03, 0.55), (1.30, 1.06, 2.82), rot=(15, 0, 0), mirror=True, mat="paint_dark"),
        box((1.90, 0.45, 0.30), (0, 1.32, -3.55), mat="paint_dark"),
        # headlights in their guards, tow hooks, the driver's hatch and periscopes
        box((0.17, 0.20, 0.20), (0.79, 1.20, 2.88), rot=(-16, 0, 0), mirror=True, mat="paint_dark"),
        cyl(0.05, 0.03, "z", (0.79, 1.22, 2.99), mirror=True, mat="lamp"),
        box((0.08, 0.16, 0.18), (0.55, 0.98, 3.02), mirror=True, mat="steel"),
        box((0.55, 0.03, 0.50), (-0.55, H + 0.01, 1.62), mat="paint_dark"),
        box((0.10, 0.06, 0.08), (-0.55, H + 0.04, 1.92), mat="black"),
        # the engine deck: the air intake and fan grilles, the exhaust grilles on the rear corners
        box((1.80, 0.025, 1.10), (0, 1.66, -1.85), mat="black"),
        box((1.20, 0.025, 0.70), (0, 1.66, -2.75), mat="black"),
        box((0.40, 0.025, 1.20), (1.30, 1.635, -2.55), mirror=True, mat="black"),
        box((0.40, 0.04, 0.60), (1.30, 1.665, -1.35), mirror=True, mat="paint_dark"),
    ]
    # the turret: the hull's ring, the body through its sections with the radar bustle
    parts += [
        cyl(0.98, 0.08, "y", (0, H + 0.03, pz), mount="turret", mat="paint_dark", segs=36),
        loft([section_ring(z, half) for z, half in GEPARD_TURRET], mount="turret", crease=30),
        # the tracking radar ahead of the front plate, on its arm
        cyl(0.20, 0.32, "z", (0, 2.235, 1.66), mount="turret", mat="paint_dark", segs=20),
        cyl(0.34, 0.12, "z", (0, 2.235, 1.98), r2=0.30, mount="turret", segs=28),
        cyl(0.24, 0.10, "z", (0, 2.235, 1.88), r2=0.30, mount="turret", mat="paint_dark", segs=24),
        # the search radar: its pedestal and mast on the bustle, the curved dish, the IFF array
        cyl(0.20, 0.14, "y", (0, 2.75, -1.62), mount="turret", mat="paint_dark", segs=18),
        cyl(0.08, 0.30, "y", (0, 2.97, -1.62), mount="turret", mat="steel", segs=12),
        box((0.24, 0.14, 0.24), (0, 3.15, -1.62), mount="turret", mat="paint_dark"),
        box((0.50, 1.05, 0.05), (0, 3.62, -1.66), rot=(-8, 0, 0), mount="turret", mat="paint"),
        box((0.46, 1.00, 0.05), (0.45, 3.62, -1.60), rot=(-8, -24, 0), mirror=True, mount="turret", mat="paint"),
        box((0.10, 0.08, 0.30), (0, 3.15, -1.45), mount="turret", mat="steel"),
        # the commander's sight head and the roof hatch, the aerials, the smoke dischargers
        box((0.97, 0.03, 0.57), (0, 2.715, 0.52), mount="turret", mat="paint_dark"),
        cyl(0.13, 0.12, "y", (-0.28, 2.76, 0.98), mount="turret", mat="paint_dark", segs=14),
        box((0.20, 0.16, 0.20), (-0.28, 2.88, 0.98), mount="turret", mat="paint_dark"),
        box((0.12, 0.05, 0.02), (-0.28, 2.90, 1.08), mount="turret", mat="glass"),
        cyl(0.03, 0.20, "y", (0.95, 2.55, -1.28), mirror=True, mount="turret", mat="paint_dark"),
        cyl(0.008, 1.30, "y", (0.95, 3.30, -1.28), mirror=True, mount="turret", mat="black", segs=6),
    ]
    for k in range(4):
        parts.append(cyl(0.04, 0.24, "z", (0.66, 1.78 + 0.07 * (k % 2), 1.18 + 0.08 * (k // 2)), rot=(-25, 22, 0),
                         mirror=True, mount="turret", mat="paint_dark", segs=10))
    # the two gun housings, each elevating with its KDA: the box round the cradle, the tapered nose,
    # the barrel with the muzzle-velocity ring and the muzzle brake
    for gi, sx in enumerate((-1, 1)):
        cx = sx * 0.97
        bx = sx * gx
        parts += [
            loft([rrect_ring(-0.55, cx, gy - 0.02, 0.24, 0.30, p=6), rrect_ring(0.55, cx, gy - 0.02, 0.24, 0.30, p=6),
                  rrect_ring(0.84, (cx + bx) / 2, gy, 0.16, 0.18, p=5), rrect_ring(0.98, bx, gy, 0.07, 0.07, p=4)], mount="gun", mat="paint"),
            cyl(0.045, 2.20, "z", (bx, gy, 2.06), r2=0.038, mount="gun", mat="paint_dark", segs=14),
            cyl(0.060, 0.12, "z", (bx, gy, 3.20), mount="gun", mat="steel", segs=14),
            cyl(0.038, 0.24, "z", (bx, gy, 3.38), mount="gun", mat="paint_dark", segs=14),
            cyl(0.075, 0.16, "z", (bx, gy, 3.58), mount="gun", mat="steel", segs=14),
            box((0.20, 0.02, 0.14), (bx, gy, 3.58), mount="gun", mat="steel"),
        ]
        for part in parts[-6:]:
            part["gun"] = gi
    kda = {"id": "kda_35_gepard", "caliber_mm": 35.0, "barrel_length_mm": 3850, "recoil_mm": 60, "rounds_per_min": 550,
           "reload_s": 0.11, "traverse_deg_s": 90.0, "elevate_deg_s": 56.0, "max_depression_deg": 10.0, "max_elevation_deg": 85.0,
           "dispersion_mrad": 1.0, "mass_kg": 670, "ammo": ["hei_35_kda", "apds_35_kda"], "ammo_count": [320, 20],
           "autocannon": {"rate_rpm": 550, "belt_rounds": 320, "belt_reload_s": 20.0}}
    # the model itself: Scout's "Flakpanzer Gepard | High-Quality model" (CC-BY-4.0), its units
    # scaled to the published 3.27 m width; its materials carry placeholder colours only, so each
    # is given the Bundeswehr's RAL 6014 Gelboliv (the guns a little darker, the mesh screens dark)
    turret_nodes = ["bone_turret_bone_turret_0", "bone_turret_bone_turret_0.001", "bone_turret_bone_turret_0.002",
                    "bone_turret_bone_turret_0.003", "antenna_01_antenna_01_0", "antenna_02_antenna_02_0", "hatch_01_hatch_01_0",
                    "antenna_target_tagging_mount_antenna_target_tagging_mount_0", "antenna_target_tagging_antenna_target_tagging_0",
                    "antenna_target_location_mount_antenna_target_location_mount_0", "antenna_target_location_antenna_target_location_0",
                    "bone_commander_sight_h_bone_commander_sight_h_0"]
    gun_nodes = ["bone_gun_bone_gun_0", "bone_gun_bone_gun_0.001", "gun_barrel_01_gun_barrel_01_0", "gun_barrel_02_gun_barrel_02_0"]
    olive = [0.068, 0.072, 0.040]
    imp = {"glb": UPLOADS + "de0f50fd-flakpanzer_gepard__high-quality_model.glb",
           "source": "\"Flakpanzer Gepard | High-Quality model\" by Scout (https://sketchfab.com/scout.), CC-BY-4.0 (https://creativecommons.org/licenses/by/4.0/); scaled, its placeholder colours replaced",
           "scale": 0.024, "offset": [0, 0.018, 0], "drop_materials": [5, 6],
           "turret_nodes": turret_nodes, "gun_nodes": gun_nodes,
           "barrel_extra_nodes": ["gun_barrel_01_gun_barrel_01_0", "gun_barrel_02_gun_barrel_02_0"],
           "gun_index_nodes": {"1": ["bone_gun_bone_gun_0", "gun_barrel_02_gun_barrel_02_0"]},
           "material_colours": {"flakpz_i_gepard_body_c": {"colour": olive, "rough": 0.78, "metal": 0.1},
                                "flakpz_i_gepard_turret_c": {"colour": olive, "rough": 0.78, "metal": 0.1},
                                "flakpz_i_gepard_gun_c": {"colour": [0.052, 0.056, 0.032], "rough": 0.62, "metal": 0.3},
                                "net_f_c": {"colour": [0.028, 0.028, 0.024], "rough": 0.9, "metal": 0.0},
                                "headlight_glass_c": {"colour": [0.55, 0.55, 0.5], "rough": 0.2, "metal": 0.0}},
           # the torsion bars put the right side's wheels a little behind the left's
           "stagger": {"1": {"road_wheel": -0.105, "return_roller": [-0.08, -0.09, -0.12, -0.065]}},
           "normal_maps": False}
    return {
        "id": "de_gepard", "model": "model.json", "import": imp, "name": "Flakpanzer Gepard", "nation": "germany", "cls": "spaa", "year": 1976, "outline": "model",
        "based_on": "Flakpanzer Gepard 1A1: Leopard 1 chassis, twin 35 mm Oerlikon KDA, search and tracking radars",
        "notes": "Exterior: Scout's 'Flakpanzer Gepard | High-Quality model' (CC-BY-4.0), used 1:1 at the request of the user, scaled to the published 3.27 m width and cut into its moving pieces by tools/glb-vehicle.py; its placeholder colours replaced by RAL 6014 Gelboliv. MTU MB 838 CaM-500, 830 hp; gear ratios are estimates chosen to match the published 65 km/h. The radars are shown but not simulated; armour and interior are estimates.",
        "L": L, "W": W, "H": H, "clear": c, "body_w": 3.10, "nose_y": 1.10, "mass": 47300, "com": (0, 1.05, -0.2),
        "turret_pos": piv, "turret_size": (2.0, 1.20, 3.4), "ring": 1.9, "mount": (-gx, gy, gz), "muzzle_offset": muzzle_z - gz,
        "extra_guns": [{"gun": kda, "mount_m": [gx, gy, gz], "muzzle_offset_m": r3(muzzle_z - gz)}],
        "armor": {"upper_front": (70, 60, "rha"), "lower_front": (70, 55, "rha"), "side": (35, 0, "rha"), "rear": (25, 0, "rha"),
                  "roof": 15, "floor": 15},
        "turret_armor": {"front": (40, 10, "rha"), "mantlet": (20, 0.48, 0.60, "rha"), "side": (20, 10, "rha"), "rear": (20, "rha"), "roof": 15},
        "gun": dict(kda),
        "dep_table": [(0, 10), (125, 10), (135, 7), (225, 7), (235, 10), (360, 10)],
        "sight": {"name": "PERI (Gepard)", "levels": [{"magnification": 1.5, "fov_deg": 50.0}, {"magnification": 6.0, "fov_deg": 12.0}]},
        "secondary": [],
        "engine": {"horsepower": 830, "max_rpm": 2200, "idle_rpm": 650, "weight_kg": 1920,
                   "torque_curve": [[650, 2200], [1200, 2750], [1600, 2700], [2200, 2650]]},
        "transmission": {"forward_gears": 4, "reverse_gears": 2, "gear_ratios": [4.6, 2.6, 1.55, 1.0], "final_drive_ratio": 4.0, "shift_time_s": 0.3},
        "physics": {"track_width_m": 0.55, "track_length_m": 4.24, "suspension": {"travel_m": 0.30, "stiffness": 380000, "damping": 26000},
                    "rolling_resistance": 0.04, "sprocket_radius_m": 0.33, "drivetrain_efficiency": 0.82, "max_brake_decel_ms2": 6.5,
                    "max_turn_rate_deg_s": 34.0, "max_reverse_speed_ms": 6.0, "min_turn_radius_m": 0.0},
        "modules": [
            module("engine", "engine", (0, 1.05, -2.25), (0.65, 0.42, 0.55), 150),
            module("transmission", "transmission", (0, 0.85, -3.05), (0.70, 0.30, 0.20), 120),
            module("fuel_tank_l", "fuel_tank", (-1.25, 1.20, -1.40), (0.25, 0.18, 0.55), 50),
            module("fuel_tank_r", "fuel_tank", (1.25, 1.20, -1.40), (0.25, 0.18, 0.55), 50),
            module("ammo_drum", "ammo_rack", (0, 1.05, pz), (0.55, 0.25, 0.50), 60),
            module("breech", "gun_breech", (-gx, gy, gz - 0.25), (0.10, 0.12, 0.35), 80),
            module("breech_r", "gun_breech", (gx, gy, gz - 0.25), (0.10, 0.12, 0.35), 80),
            module("gun_barrel", "gun_barrel", (-gx, gy, 2.20), (0.05, 0.05, 1.30), 90),
            module("gun_barrel_r", "gun_barrel", (gx, gy, 2.20), (0.05, 0.05, 1.30), 90),
            module("turret_drive", "turret_drive", (0.35, 1.75, pz + 0.55), (0.15, 0.10, 0.15), 70),
            module("radio", "radio", (0, 2.15, -1.00), (0.40, 0.15, 0.20), 40),
        ],
        "crew": [crew("driver", (-0.55, 1.05, 2.05)), crew("commander", (-0.35, 2.05, 0.55)), crew("gunner", (0.35, 2.05, 0.55))],
        "palette": {"paint": "#5b6046", "paint_dark": "#454a35", "glass": "#1c252b", "lamp": "#e6e4da"},
        "parts": [],
        "running_gear": {"track_width": 0.55, "track_thickness": tt, "track_x": tx, "link_pitch": 0.18, "link_style": "rubber_block", "track_sag": 0.02,
                         "sprocket": {"z": -2.705, "y": 0.735, "r": 0.325, "teeth": 11}, "idler": {"z": 2.71, "y": 0.77, "r": 0.31},
                         "wheels": wheel_row(wz, 0.31 + tt, 0.31, 0.27),
                         "rollers": [{"z": z, "y": 0.92, "r": 0.105, "w": 0.12} for z in (1.67, 1.02, -0.33, -1.69)], "wheel_style": "rubber_dish"},
    }

# ---- M4 family ---------------------------------------------------------------------------------
# Hull outline and VVSS running gear traced from a four-view general-arrangement drawing of the
# M4A3 (75 mm): side view 90.35 px/m by the drawing's own scale bar. Origin: middle of the 5.93 m
# hull, on the ground. The same lower hull carries the M10.
M4_C = 0.43
# heights of the welded hull checked against the M4A2 reference model (its sections at the
# centre line, over the tracks and across the hull): the sponson floor and the roof
M4_SPONSON = 1.16
M4_ROOF = 1.80
M4_BOGIES = (1.445, 0.0, -1.445)
# the cast nose rounds up from the belly to its lip under the glacis (reference sections)
M4_LOWER = [(-2.72, M4_C), (2.36, M4_C), (2.62, 0.56), (2.72, 0.70), (2.72, 0.80), (2.68, 0.875), (2.236, M4_SPONSON),
            (-2.92, M4_SPONSON), (-2.88, 0.80)]
M4_GLACIS_TOP = 1.54   # where the 47-degree glacis meets the roof
M4_DECK_END = (-2.83, 1.57)   # the engine deck's rear edge


def m4_glacis(z):
    return M4_SPONSON + (2.236 - z) * (M4_ROOF - M4_SPONSON) / (2.236 - M4_GLACIS_TOP)


def m4_deck(z):
    """Engine deck height at z: level to -1.0, then falling to the rear edge."""
    if z >= -1.0:
        return M4_ROOF
    return M4_ROOF - (-1.0 - z) * (M4_ROOF - M4_DECK_END[1]) / (-1.0 - M4_DECK_END[0])


def m4_upper_ring(z, top):
    """The upper hull's cross-section at z: vertical sides over the tracks, and at the rear the
    corner plates of the engine deck leaning in (an inclined plane measured on the reference at
    two heights: the deck narrows from the full 2.62 m to 1.7 m at the rear edge)."""
    sp, side = M4_SPONSON, 1.31
    x155 = min(side, 1.30 + (z + 1.60) * 0.36)
    x170 = min(side, 1.24 + (z + 0.475) * 0.30)
    k = (x170 - x155) / 0.15
    yk = 1.55 + (side - x155) / k if k < -1e-6 else 9.0
    if yk >= top - 0.003:
        half = [(0, sp), (side, sp), (side, top - 0.003), (side - 0.003, top), (0, top)]
    else:
        yk = max(yk, sp + 0.02)
        half = [(0, sp), (side, sp), (side, yk), (max(0.3, x155 + (top - 1.55) * k), top), (0, top)]
    return section_ring(z, half)


def m4_lower_hull(tx, track_w):
    return [
        # between the tracks; the one-piece cast nose is part of the outline
        prism(M4_LOWER, 1.62),
        # final-drive housings beside the nose, tow lugs
        cyl(0.27, 0.16, "x", (0.87, 0.57, 2.45), mirror=True, segs=18),
        box((0.06, 0.2, 0.2), (0.5, 0.80, 2.70), mirror=True, mat="steel"),
        # track guards over the sprockets, hung from the sponsons' front edge
        box((track_w + 0.05, 0.025, 0.5), (tx, 1.0, 2.74), rot=(34, 0, 0), mirror=True, mat="paint_dark"),
        box((track_w + 0.05, 0.025, 0.36), (tx, M4_SPONSON - 0.0125, 2.42), rot=(8, 0, 0), mirror=True, mat="paint_dark"),
    ]


def m4a3_upper_hull():
    deck, glacis = m4_deck, m4_glacis
    zs = [1.0, 0.0, -0.475, -0.8, -1.0, -1.3, -1.6, -1.9, -2.2, -2.5]
    rings = [m4_upper_ring(2.236, M4_SPONSON + 0.006), m4_upper_ring(M4_GLACIS_TOP, M4_ROOF)]
    rings += [m4_upper_ring(z, deck(z)) for z in zs]
    rings += [m4_upper_ring(M4_DECK_END[0], M4_DECK_END[1]), m4_upper_ring(-2.92, M4_SPONSON + 0.006)]
    return [
        # over the tracks: 47-degree glacis, flat roof, the engine deck falling to the rear between
        # its leaning corner plates, the rear plate
        loft(list(reversed(rings)), crease=25),
        # driver's and assistant driver's hatches with periscopes, roof ventilator
        box((0.56, 0.026, 0.48), (0.64, M4_ROOF + 0.012, 1.08), mirror=True, mat="paint_dark"),
        box((0.14, 0.07, 0.1), (0.64, M4_ROOF + 0.06, 1.16), mirror=True, mat="paint_dark"),
        cyl(0.12, 0.026, "y", (0.0, M4_ROOF + 0.012, 1.14), mat="paint_dark"),
        # bow machine gun ball mount, headlights
        cyl(0.16, 0.12, "z", (0.62, glacis(1.95) + 0.01, 1.95), rot=(-43, 0, 0), mat="paint_dark"),
        cyl(0.022, 0.42, "z", (0.62, glacis(1.95) + 0.08, 2.14), mat="steel"),
        cyl(0.07, 0.10, "z", (0.98, glacis(1.82) + 0.05, 1.84), mirror=True, mat="black"),
        # engine deck: grille doors and filler caps
        box((1.46, 0.03, 1.0), (0, deck(-1.75) + 0.012, -1.75), rot=(-7.2, 0, 0), mat="paint_dark"),
        box((1.1, 0.025, 0.5), (0, deck(-1.62) + 0.030, -1.62), rot=(-7.2, 0, 0), mat="black"),
        cyl(0.06, 0.04, "y", (0.72, deck(-1.3) + 0.02, -1.3), mirror=True, mat="paint_dark"),
        # rear: engine access doors and the exhaust deflector under the overhang
        box((1.2, 0.5, 0.05), (0, 0.98, -2.93), mat="paint_dark"),
        box((1.9, 0.2, 0.08), (0, 1.30, -2.93), mat="paint_dark"),
    ]


M2_POST_75 = 0.28
M2_POST_76 = 0.27
# the gun clears the engine deck only about level over the rear
M4_DEP_TABLE = [(0, 10), (120, 10), (150, 0), (210, 0), (240, 10), (360, 10)]


def m4_bow_mg():
    return mg("bow_m1919", "m1919a4", "hull", (0.62, m4_glacis(1.95) + 0.08, 2.35), (15, 10, 20))


def vvss(tx):
    parts = []
    for bz in M4_BOGIES:
        parts += [
            box((0.30, 0.38, 0.30), (tx, 0.60, bz), mirror=True, mat="paint_dark"),          # volute spring housing
            box((0.14, 0.30, 0.40), (0.86, 0.66, bz), mirror=True, mat="paint_dark"),        # its bracket on the hull side
            box((0.06, 0.10, 0.92), (tx - 0.17, 0.38, bz), mirror=True, mat="paint_dark"),   # suspension arms
            box((0.20, 0.03, 0.34), (tx, 0.815, bz + 0.2), mirror=True, mat="steel"),        # track skid
        ]
    return parts


def m4_vvss_gear(tx):
    wz = [1.86, 1.03, 0.41, -0.42, -1.03, -1.87]
    return {"track_width": 0.421, "track_thickness": 0.055, "track_x": r3(tx), "link_pitch": 0.152, "link_style": "rubber_block", "track_sag": 0.01,
            "sprocket": {"z": 2.45, "y": 0.57, "r": 0.30, "teeth": 13}, "idler": {"z": -2.60, "y": 0.66, "r": 0.25},
            "wheels": wheel_row(wz, 0.254 + 0.055, 0.254, 0.23),
            "rollers": [{"z": z, "y": 0.76, "r": 0.08, "w": 0.18} for z in M4_BOGIES], "wheel_style": "rubber_dish"}


M4_ENGINE = {"horsepower": 500, "max_rpm": 2600, "idle_rpm": 600, "weight_kg": 650,
             "torque_curve": [[600, 1300], [1400, 1500], [2200, 1546], [2600, 1369]]}
M4_GEARS = [7.56, 3.11, 1.78, 1.11, 0.73]


def m4_modules(breech_z, gun_y):
    return [
        module("engine", "engine", (0, 1.0, -2.0), (0.5, 0.45, 0.7), 150),
        module("transmission", "transmission", (0, 0.85, 2.3), (0.55, 0.3, 0.4), 120),
        module("fuel_tank_l", "fuel_tank", (-0.95, 1.5, -2.0), (0.25, 0.2, 0.6), 50),
        module("fuel_tank_r", "fuel_tank", (0.95, 1.5, -2.0), (0.25, 0.2, 0.6), 50),
        module("ammo_wet_floor", "ammo_rack", (0, 0.62, -0.1), (0.6, 0.15, 0.6), 80),
        module("breech", "gun_breech", (0, gun_y, breech_z), (0.17, 0.17, 0.4), 100),
        module("radio", "radio", (0, gun_y - 0.02, -1.15), (0.3, 0.15, 0.15), 40),
    ]


# The M4's cast turrets, measured off the reference models: radius from the ring centre every 10
# degrees (from straight behind, round by the left) at six heights (the reference heights raised
# 0.10 m to sit on this hull's roof). The 75 mm turret (rounded front, the bustle at the back)
# and the T23 (the high, long bustle).
M4_75_POLAR = [
    (1.94, [0.96, 0.96, 0.97, 0.97, 0.98, 0.98, 0.99, 1.0, 1.01, 1.02, 1.03, 1.04, 1.05, 1.06, 1.06, 1.07, 1.07, 1.02, 1.01, 1.03, 1.07, 1.07, 1.06, 1.06, 1.05, 1.04, 1.03, 1.02, 1.01, 1.0, 0.99, 0.98, 0.98, 0.97, 0.97, 0.96]),
    (2.05, [1.12, 1.15, 1.15, 1.2, 1.06, 1.01, 1.01, 1.01, 1.01, 1.02, 1.03, 1.03, 1.04, 1.05, 1.05, 1.06, 1.06, 0.99, 0.86, 0.99, 1.06, 1.06, 1.05, 1.05, 1.04, 1.03, 1.03, 1.02, 1.01, 1.0, 0.99, 0.99, 1.06, 1.2, 1.21, 1.16]),
    (2.20, [1.12, 1.14, 1.14, 1.19, 1.13, 1.02, 1.04, 1.05, 1.0, 1.01, 1.02, 1.03, 1.03, 1.03, 1.02, 1.11, 1.11, 1.07, 0.79, 1.07, 1.11, 1.11, 1.02, 1.03, 1.03, 1.03, 1.02, 1.01, 1.0, 0.99, 0.99, 0.98, 1.13, 1.19, 1.21, 1.16]),
    (2.35, [1.26, 1.26, 1.26, 1.19, 1.05, 1.0, 1.05, 1.05, 0.99, 1.0, 1.0, 1.01, 1.01, 1.0, 0.97, 1.07, 1.06, 1.03, 0.72, 1.03, 1.06, 1.07, 0.97, 1.0, 1.01, 1.01, 1.0, 1.0, 0.99, 0.99, 0.99, 0.98, 1.05, 1.13, 1.21, 1.13]),
    (2.48, [1.03, 1.06, 1.06, 1.06, 1.04, 0.98, 0.97, 0.97, 0.98, 0.98, 0.99, 0.99, 0.98, 0.96, 0.91, 0.81, 0.75, 0.71, 0.68, 0.71, 0.75, 0.81, 0.91, 0.96, 0.98, 0.99, 0.99, 0.98, 0.98, 0.98, 0.98, 0.98, 1.04, 1.15, 1.14, 1.11]),
    (2.57, [0.98, 1.0, 1.03, 1.03, 1.03, 0.97, 0.94, 0.94, 0.94, 0.94, 0.94, 0.93, 0.92, 0.89, 0.83, 0.72, 0.66, 0.62, 0.65, 0.62, 0.65, 0.72, 0.83, 0.89, 0.92, 0.93, 0.94, 0.94, 0.94, 0.97, 0.99, 0.98, 1.04, 0.98, 0.95, 0.9]),
]
M4_T23_POLAR = [
    (2.02, [1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.01, 1.0, 1.0, 1.0, 1.0]),
    (2.15, [1.12, 1.12, 1.12, 1.11, 1.05, 1.02, 1.01, 1.01, 1.01, 1.01, 1.01, 1.02, 1.02, 1.03, 1.05, 1.05, 1.06, 0.98, 0.96, 0.98, 1.06, 1.05, 1.05, 1.03, 1.02, 1.02, 1.01, 1.01, 1.01, 1.03, 1.03, 1.03, 1.06, 1.11, 1.12, 1.12]),
    (2.30, [1.32, 1.32, 1.32, 1.29, 1.15, 1.07, 1.07, 1.05, 0.99, 0.98, 0.98, 0.98, 0.99, 0.99, 1.05, 1.09, 1.09, 1.09, 1.06, 1.09, 1.09, 1.09, 1.06, 0.99, 0.99, 0.98, 0.98, 0.98, 1.0, 1.03, 1.06, 1.08, 1.15, 1.29, 1.32, 1.32]),
    (2.45, [1.48, 1.45, 1.37, 1.32, 1.16, 1.07, 1.06, 1.03, 0.97, 0.96, 0.94, 0.94, 0.95, 0.97, 1.03, 1.1, 1.1, 1.1, 1.07, 1.08, 1.08, 1.08, 1.04, 0.97, 0.95, 0.95, 0.95, 0.96, 0.98, 1.03, 1.06, 1.08, 1.17, 1.32, 1.37, 1.45]),
    (2.58, [1.48, 1.45, 1.37, 1.31, 1.16, 1.06, 1.0, 0.97, 0.96, 0.93, 0.92, 0.91, 0.92, 0.93, 0.93, 0.93, 0.92, 0.86, 0.84, 0.86, 0.92, 0.93, 0.93, 0.93, 0.92, 0.91, 0.92, 0.94, 0.97, 1.03, 1.06, 1.08, 1.16, 1.31, 1.37, 1.45]),
    (2.68, [1.36, 1.36, 1.36, 1.3, 1.15, 1.05, 1.0, 0.97, 0.94, 0.92, 0.89, 0.89, 0.9, 0.9, 0.9, 0.81, 0.7, 0.66, 0.7, 0.66, 0.7, 0.81, 0.9, 0.9, 0.9, 0.89, 0.89, 0.92, 0.96, 1.03, 1.06, 1.07, 1.15, 1.3, 1.36, 1.36]),
]


def m4a3_75w():
    L, W, H, c = 5.93, 2.62, M4_ROOF, M4_C
    piv = (0, H, -0.10)
    # the turret and gun at the M4A2 reference's heights (gun axis 2.10)
    dy = -0.11
    mount = (0, 2.10, 0.74)
    muzzle_z = 2.70
    tx = 1.054
    # turret plan traced from the top view (half-widths scaled to the 2.2 m of the front view)
    full = [[-0.60, 0.80], [0.60, 0.80], [0.82, 0.65], [1.03, 0.34], [1.10, -0.10], [1.06, -0.54], [0.93, -1.04], [0.63, -1.405],
            [0.0, -1.45], [-0.63, -1.405], [-0.93, -1.04], [-1.06, -0.54], [-1.10, -0.10], [-1.03, 0.34], [-0.82, 0.65]]
    front = [[-0.60, 0.80], [0.60, 0.80], [0.82, 0.65], [1.03, 0.34], [1.10, -0.10], [1.06, -0.54], [0.96, -0.95],
             [-0.96, -0.95], [-1.06, -0.54], [-1.10, -0.10], [-1.03, 0.34], [-0.82, 0.65]]
    roof = 2.63 + dy
    rings = [polar_ring(y + dy, 0.0, piv[2], r) for y, r in M4_75_POLAR]
    rings.append(polar_ring(roof, 0.0, piv[2], M4_75_POLAR[-1][1], k=0.80, dz=-0.10))
    parts = m4_lower_hull(tx, 0.421) + m4a3_upper_hull() + vvss(tx) + [
        cyl(0.95, 0.06, "y", (0, H + 0.028, piv[2]), mount="turret", segs=28, mat="paint_dark"),
        # cast turret through its measured sections, the bustle hanging clear of the engine deck
        loft(rings, mount="turret", crease=40),
        # M34A1 mount, measured on the reference: the wide rotor shield behind, the outer shield
        # rounded over the top and drawn back at its edges, the square barrel sleeve, the sight and
        # coaxial MG apertures
        loft([rrect_ring(0.71, 0, 2.10, 0.60, 0.22, p=6), rrect_ring(0.90, 0, 2.10, 0.59, 0.22, p=6)], mount="gun", mat="paint"),
        loft([rrect_ring(0.80, 0, 2.18, 0.51, 0.26, p=5), rrect_ring(0.93, 0, 2.17, 0.50, 0.25, p=5),
              rrect_ring(1.00, 0, 2.12, 0.40, 0.15, p=5)], mount="gun", mat="paint"),
        loft([rrect_ring(0.99, 0, 2.105, 0.14, 0.135, p=5), rrect_ring(1.23, 0, 2.105, 0.12, 0.12, p=5)], mount="gun", mat="paint"),
        cyl(0.03, 0.04, "z", (0.30, 2.27, 0.985), mount="gun", mat="black"),
        cyl(0.03, 0.12, "z", (-0.30, mount[1], 0.98), mount="gun", mat="black"),
        barrel(mount, 1.22, muzzle_z, 0.062, 0.052),
        # commander's vision cupola, loader's hatch, ventilator on the bustle
        box((0.50, 0.04, 0.44), (-0.42, roof + 0.02, -0.38), mount="turret", mat="paint_dark"),
        cyl(0.13, 0.06, "y", (0.0, roof + 0.03, -0.98), mount="turret", mat="paint_dark"),
    ] + cupola(0.42, roof, -0.42, 0.35, 0.20, blocks=6)
    return {
        "id": "us_m4a3_75w", "name": "M4A3(75)W", "nation": "usa", "cls": "medium", "year": 1944, "outline": "traced",
        "based_on": "Medium Tank M4A3(75)W, late production with the vision cupola",
        "notes": "Hull, running gear and turret outline traced from a four-view drawing. final_drive_ratio combines the 3.53 bevel gear and the 2.84 final drive. Interior layout is an estimate.",
        "L": L, "W": W, "H": H, "clear": c, "body_w": 2.62, "nose_y": M4_SPONSON, "mass": 31600, "com": (0, 1.0, 0.0),
        "turret_pos": piv, "turret_size": (2.2, 0.75, 2.7), "ring": 1.753, "mount": mount, "muzzle_offset": muzzle_z - mount[2], "dep_table": M4_DEP_TABLE,
        "armor": {"upper_front": (63.5, 47, "rha"), "lower_front": (108, 20, "cha"), "side": (38, 0, "rha"), "rear": (38, 15, "rha"),
                  "roof": 19, "floor": 25},
        "turret_armor": {"front": (76, 30, "cha"), "mantlet": (89, 1.10, 0.60, "cha"), "side": (51, 5, "cha"), "rear": (51, "cha"), "roof": 25},
        "gun": {"id": "m3_75", "caliber_mm": 75.0, "barrel_length_mm": 3000, "recoil_mm": 305, "rounds_per_min": 12.0,
                "reload_s": 5.0, "traverse_deg_s": 24.0, "elevate_deg_s": 8.0, "max_depression_deg": 10.0, "max_elevation_deg": 25.0,
                "dispersion_mrad": 1.1, "mass_kg": 405, "ammo": ["apcbc_75_m61_m3"]},
        "sight": {"name": "M70F", "levels": [{"magnification": 3.0, "fov_deg": 12.3}]},
        # the .50 on the commander's cupola ring, where the reference carries it
        "secondary": [mg("coax_m1919", "m1919a4", "coax", (-0.30, mount[1], 1.04)), m4_bow_mg(),
                      mg("aa_m2", "m2hb", "pintle", (0.46, 2.80, -0.02), post=M2_POST_75)],
        "engine": dict(M4_ENGINE),
        "transmission": {"forward_gears": 5, "reverse_gears": 1, "gear_ratios": M4_GEARS, "final_drive_ratio": 10.03, "shift_time_s": 0.4},
        "physics": {"track_width_m": 0.421, "track_length_m": 3.73, "suspension": {"travel_m": 0.11, "stiffness": 300000, "damping": 20000},
                    "rolling_resistance": 0.04, "sprocket_radius_m": 0.318, "drivetrain_efficiency": 0.82, "max_brake_decel_ms2": 6.0,
                    "max_turn_rate_deg_s": 26.0, "max_reverse_speed_ms": 1.4, "min_turn_radius_m": 9.45},
        "modules": m4_modules(0.3, mount[1]) + [
            module("ammo_ready", "ammo_rack", (-0.7, 2.04, -0.5), (0.15, 0.12, 0.2), 40),
            module("gun_barrel", "gun_barrel", (0, mount[1], 1.95), (0.07, 0.07, 0.75), 110),
            module("turret_drive", "turret_drive", (0.75, 1.99, 0.3), (0.12, 0.1, 0.15), 70),
        ],
        "crew": [crew("driver", (-0.6, 1.25, 1.5)), crew("radio_operator", (0.6, 1.25, 1.5)), crew("gunner", (0.45, 2.09, 0.2)),
                 crew("commander", (0.45, 2.19, -0.45)), crew("loader", (-0.5, 2.09, -0.1))],
        "palette": {"paint": "#555338", "paint_dark": "#3e3d29"},
        "parts": parts,
        "running_gear": m4_vvss_gear(tx),
    }


def t23_turret(piv, dy, roof, mount, muzzle_z):
    """The T23 turret with the M62 mount and the 76 mm M1, dy the shift of the reference's heights."""
    oz = piv[2] + 0.05   # the mount's fittings are placed for the ring at z -0.05
    rings = [polar_ring(y + dy, 0.0, piv[2], r) for y, r in M4_T23_POLAR]
    rings.append(polar_ring(roof, 0.0, piv[2], M4_T23_POLAR[-1][1], k=0.86, dz=-0.10))
    return [
        cyl(0.95, 0.06, "y", (0, piv[1] + 0.028, piv[2]), mount="turret", segs=28, mat="paint_dark"),
        # the cast T23 turret through its measured sections, the high bustle at the back
        loft(rings, mount="turret", crease=40),
        # the M62 mount, measured on the reference: the rotor's rounded top lip, the broad plate
        # with its rounded edges, the raised front face and the barrel sleeve
        loft([rrect_ring(oz + 0.80, 0, 2.42 + dy, 0.62, 0.09, p=4), rrect_ring(oz + 0.92, 0, 2.42 + dy, 0.62, 0.09, p=4)], mount="gun", mat="paint"),
        loft([rrect_ring(oz + 0.90, 0, 2.27 + dy, 0.635, 0.27, p=7), rrect_ring(oz + 1.08, 0, 2.27 + dy, 0.635, 0.27, p=7)], mount="gun", mat="paint"),
        loft([rrect_ring(oz + 1.07, 0, 2.28 + dy, 0.54, 0.16, p=6), rrect_ring(oz + 1.16, 0, 2.28 + dy, 0.52, 0.15, p=6)], mount="gun", mat="paint"),
        loft([rrect_ring(oz + 1.15, 0, mount[1], 0.128, 0.128, p=3), rrect_ring(oz + 1.25, 0, mount[1], 0.12, 0.12, p=3)], mount="gun", mat="paint"),
        barrel(mount, oz + 1.24, muzzle_z - 0.28, 0.072, 0.052),
        recoil(cyl(0.085, 0.28, "z", (0, mount[1], muzzle_z - 0.14), mount="gun", mat="paint_dark")),
        recoil(cyl(0.10, 0.05, "z", (0, mount[1], muzzle_z - 0.03), mount="gun", mat="paint_dark")),
        cyl(0.03, 0.1, "z", (-0.36, mount[1], oz + 1.17), mount="gun", mat="black"),
        box((0.50, 0.05, 0.62), (-0.42, roof + 0.02, piv[2] - 0.25), mount="turret", mat="paint_dark"),
    ] + cupola(0.42, roof, piv[2] - 0.30, 0.34, 0.20, blocks=6)


def sherman():
    # The M4A3 hull above with the wider HVSS suspension and the T23 turret (76 mm). Hull traced;
    # turret and HVSS from published dimensions.
    L, W, H, c = 5.93, 3.00, M4_ROOF, M4_C
    piv = (0, H, -0.05)
    # the T23 turret lowered with the hull roof to the reference's heights
    dy = -0.11
    mount = (0, 2.25 + dy, piv[2] + 0.98)
    muzzle_z = -L / 2 + 7.54
    tx = W / 2 - 0.292
    wz = [1.72, 1.12, 0.32, -0.28, -1.08, -1.68]
    roof = 2.76 + dy
    parts = m4_lower_hull(tx, 0.584) + m4a3_upper_hull() + t23_turret(piv, dy, roof, mount, muzzle_z) + [
        box((0.60, 0.025, 4.9), (tx, M4_SPONSON - 0.0125, -0.35), mirror=True, mat="paint_dark"),
        # HVSS bogies: the brackets on the hull side, the springs between each wheel pair
        box((0.20, 0.30, 0.34), (0.90, 0.62, 1.42), mirror=True, mat="paint_dark"),
        box((0.20, 0.30, 0.34), (0.90, 0.62, 0.02), mirror=True, mat="paint_dark"),
        box((0.20, 0.30, 0.34), (0.90, 0.62, -1.38), mirror=True, mat="paint_dark"),
        cyl(0.075, 0.46, "z", (tx, 0.44, 1.42), mirror=True, mat="paint_dark", segs=12),
        cyl(0.075, 0.46, "z", (tx, 0.44, 0.02), mirror=True, mat="paint_dark", segs=12),
        cyl(0.075, 0.46, "z", (tx, 0.44, -1.38), mirror=True, mat="paint_dark", segs=12),
        box((0.50, 0.30, 0.16), (tx, 0.56, 1.42), mirror=True, mat="paint_dark"),
        box((0.50, 0.30, 0.16), (tx, 0.56, 0.02), mirror=True, mat="paint_dark"),
        box((0.50, 0.30, 0.16), (tx, 0.56, -1.38), mirror=True, mat="paint_dark"),
    ]
    return {
        "id": "us_m4a3_76w_hvss", "name": "M4A3(76)W HVSS", "nation": "usa", "cls": "medium", "year": 1945, "outline": "traced",
        "based_on": "Medium Tank M4A3(76)W HVSS",
        "notes": "Hull traced from a four-view drawing of the M4A3; the T23 turret and the HVSS suspension are built from published dimensions. final_drive_ratio combines the 3.53 bevel gear and the 2.84 final drive. Interior layout is an estimate.",
        "L": L, "W": W, "H": H, "clear": c, "body_w": 2.62, "nose_y": M4_SPONSON, "mass": 33650, "com": (0, 1.0, 0.0),
        "turret_pos": piv, "turret_size": (2.1, 0.82, 2.9), "ring": 1.753, "mount": mount, "muzzle_offset": muzzle_z - mount[2], "dep_table": M4_DEP_TABLE,
        "armor": {"upper_front": (63.5, 47, "rha"), "lower_front": (108, 20, "cha"), "side": (38, 0, "rha"), "rear": (38, 15, "rha"),
                  "roof": 19, "floor": 25},
        "turret_armor": {"front": (63.5, 40, "cha"), "mantlet": (89, 1.16, 0.74, "cha"), "side": (63.5, 8, "cha"), "rear": (63.5, "cha"), "roof": 25},
        "gun": {"id": "m1a2_76", "caliber_mm": 76.2, "barrel_length_mm": 3962, "recoil_mm": 305, "rounds_per_min": 10.0,
                "reload_s": 6.0, "traverse_deg_s": 24.0, "elevate_deg_s": 8.0, "max_depression_deg": 10.0, "max_elevation_deg": 25.0,
                "dispersion_mrad": 0.9, "mass_kg": 517, "ammo": ["apcbc_76_m62"]},
        "sight": {"name": "M71D", "levels": [{"magnification": 5.0, "fov_deg": 13.0}]},
        # the .50 on its pintle between the hatches at the back, where the reference carries it
        "secondary": [mg("coax_m1919", "m1919a4", "coax", (-0.36, mount[1], 1.22)), m4_bow_mg(),
                      mg("aa_m2", "m2hb", "pintle", (0.0, 3.03 + dy, -0.78), post=M2_POST_76)],
        "engine": dict(M4_ENGINE),
        "transmission": {"forward_gears": 5, "reverse_gears": 1, "gear_ratios": M4_GEARS, "final_drive_ratio": 10.03, "shift_time_s": 0.4},
        "physics": {"track_width_m": 0.584, "track_length_m": 3.84, "suspension": {"travel_m": 0.20, "stiffness": 240000, "damping": 18000},
                    "rolling_resistance": 0.04, "sprocket_radius_m": 0.318, "drivetrain_efficiency": 0.82, "max_brake_decel_ms2": 6.0,
                    "max_turn_rate_deg_s": 26.0, "max_reverse_speed_ms": 1.4, "min_turn_radius_m": 9.45},
        "modules": m4_modules(0.45, mount[1]) + [
            module("ammo_ready", "ammo_rack", (-0.7, 2.09, -0.6), (0.15, 0.15, 0.2), 40),
            module("gun_barrel", "gun_barrel", (0, mount[1], 2.75), (0.08, 0.08, 1.45), 120),
            module("turret_drive", "turret_drive", (0.75, 2.04, 0.6), (0.12, 0.12, 0.15), 70),
        ],
        "crew": [crew("driver", (-0.6, 1.25, 1.5)), crew("radio_operator", (0.6, 1.25, 1.5)), crew("gunner", (0.45, 2.14, 0.3)),
                 crew("commander", (0.45, 2.27, -0.4)), crew("loader", (-0.5, 2.14, 0.0))],
        "palette": {"paint": "#555338", "paint_dark": "#3e3d29"},
        "parts": parts,
        "running_gear": {"track_width": 0.584, "track_thickness": 0.055, "track_x": r3(tx), "link_pitch": 0.152, "link_style": "center_guide", "track_sag": 0.01,
                         "sprocket": {"z": 2.45, "y": 0.57, "r": 0.30, "teeth": 13}, "idler": {"z": -2.60, "y": 0.66, "r": 0.27},
                         "wheels": wheel_row(wz, 0.26 + 0.055, 0.26, 0.42),
                         "rollers": [{"z": 1.0, "y": 0.76, "r": 0.08, "w": 0.2}, {"z": -0.4, "y": 0.76, "r": 0.08, "w": 0.2},
                                     {"z": -1.7, "y": 0.76, "r": 0.08, "w": 0.2}],
                         "wheel_style": "rubber_dish"},
    }



# ---- M4A1(76)W: the cast hull ------------------------------------------------------------------
# Cross-sections of the one-piece cast upper hull measured on the M4A1(76)W reference model (the
# numbers only; the model itself is not used): at each station the sponson floor, the half-width
# of the vertical side, the height where the side starts to round over, the crown of the roof and
# the squareness of that rounding (superellipse exponent).
M4A1_CAST = [
    (2.30, 1.10, 0.92, 1.16, 1.25, 4.0),
    (2.10, M4_SPONSON, 0.97, 1.26, 1.53, 4.0),
    (1.95, M4_SPONSON, 1.12, 1.40, 1.65, 3.5),
    (1.80, M4_SPONSON, 1.25, 1.50, 1.75, 3.0),
    (1.60, M4_SPONSON, 1.30, 1.56, 1.85, 3.0),
    (1.40, M4_SPONSON, 1.31, 1.60, 1.91, 3.0),
    (1.00, M4_SPONSON, 1.31, 1.62, 1.95, 4.0),
    (-1.00, M4_SPONSON, 1.31, 1.55, 1.93, 4.0),
    (-1.80, M4_SPONSON, 1.31, 1.50, 1.79, 3.0),
    (-2.30, M4_SPONSON, 1.31, 1.42, 1.75, 1.6),
    (-2.70, M4_SPONSON, 1.28, 1.44, 1.70, 1.6),
    (-2.90, M4_SPONSON, 1.27, 1.32, 1.64, 1.6),
    (-2.96, M4_SPONSON, 1.25, M4_SPONSON + 0.01, M4_SPONSON + 0.02, 1.6),
]


def m4a1_cast_ring(z, sp, w, ys, top, p, n=8):
    half = [(0, sp), (w, sp), (w, ys)]
    for k in range(1, n):
        t = (math.pi / 2) * k / n
        half.append((w * math.cos(t) ** (2 / p), ys + (top - ys) * math.sin(t) ** (2 / p)))
    half.append((0, top))
    return section_ring(z, half)


def m4a1_cast_top(x, z):
    """Height of the cast hull's top at (x, z), interpolated between the stations."""
    st = sorted(M4A1_CAST)
    for a, b in zip(st, st[1:]):
        if a[0] <= z <= b[0]:
            t = (z - a[0]) / (b[0] - a[0])
            v = [a[k] + (b[k] - a[k]) * t for k in range(6)]
            break
    else:
        v = list(st[0] if z < st[0][0] else st[-1])
    _, sp, w, ys, top, p = v
    u = min(1.0, abs(x) / w)
    return ys + (top - ys) * (1 - u ** p) ** (1 / p)


def m4a1_76w():
    L, W, H, c = 5.84, 2.62, 1.93, M4_C
    piv = (0, H, -0.25)
    dy = H - M4_ROOF - 0.11
    mount = (0, 2.25 + dy, piv[2] + 0.98)
    muzzle_z = 3.94
    tx = 1.054
    roof = 2.76 + dy
    top = m4a1_cast_top
    gl = lambda z: top(0.62, z)
    parts = m4_lower_hull(tx, 0.421) + [
        # the cast upper hull through its measured sections, rear to front
        loft([m4a1_cast_ring(*st) for st in reversed(M4A1_CAST)], crease=30),
        # the sponson lips in front of the tracks
        box((0.36, 0.025, 0.55), (1.12, M4_SPONSON - 0.0125, 2.05), mirror=True, mat="paint_dark"),
        # driver's and assistant driver's hatches with periscopes, the ventilator between them
        box((0.56, 0.026, 0.48), (0.64, top(0.64, 1.08) + 0.006, 1.08), mirror=True, mat="paint_dark"),
        box((0.14, 0.07, 0.1), (0.64, top(0.64, 1.16) + 0.04, 1.16), mirror=True, mat="paint_dark"),
        cyl(0.12, 0.026, "y", (0.0, top(0, 1.20) + 0.004, 1.20), mat="paint_dark"),
        # bow machine gun ball, headlights in their guards, the cast lifting rings
        cyl(0.16, 0.12, "z", (0.62, gl(1.95) - 0.01, 1.98), rot=(-36, 0, 0), mat="paint_dark"),
        cyl(0.022, 0.42, "z", (0.62, gl(1.95) + 0.06, 2.16), mat="steel"),
        cyl(0.07, 0.10, "z", (0.86, top(0.86, 2.02) - 0.02, 2.06), mirror=True, mat="black"),
        box((0.04, 0.16, 0.16), (0.98, top(0.98, 1.92) + 0.02, 1.92), mirror=True, mat="steel"),
        # engine deck: grille doors, filler caps; the rear plate's doors and exhaust deflector
        box((1.46, 0.03, 1.0), (0, top(0, -1.75) - 0.005, -1.75), rot=(-8, 0, 0), mat="paint_dark"),
        box((1.1, 0.025, 0.5), (0, top(0, -1.62) + 0.008, -1.62), rot=(-8, 0, 0), mat="black"),
        cyl(0.06, 0.04, "y", (0.72, top(0.72, -1.3) + 0.01, -1.3), mirror=True, mat="paint_dark"),
        box((1.2, 0.5, 0.05), (0, 0.98, -2.93), mat="paint_dark"),
        box((1.9, 0.2, 0.08), (0, 1.30, -2.95), mat="paint_dark"),
    ] + vvss(tx) + t23_turret(piv, dy, roof, mount, muzzle_z)
    # spare track blocks hung on the hull sides, two rows behind the hatches
    for zk in range(6):
        z = 0.85 - zk * 0.155
        for y in (1.36, 1.52):
            parts.append(box((0.035, 0.14, 0.13), (1.32, y, z), mirror=True, mat="track"))
    return {
        "id": "us_m4a1_76w", "name": "M4A1(76)W", "nation": "usa", "cls": "medium", "year": 1944, "outline": "traced",
        "based_on": "Medium Tank M4A1(76)W: the cast hull, T23 turret, VVSS",
        "notes": "Cast upper hull built from cross-sections measured on a reference model (numbers only); lower hull and VVSS as the M4A3 drawing. Continental R975-C4 radial; final_drive_ratio combines the 3.53 bevel gear and the 2.84 final drive. Interior layout is an estimate.",
        "L": L, "W": W, "H": H, "clear": c, "body_w": 2.62, "nose_y": M4_SPONSON, "mass": 32000, "com": (0, 1.0, 0.0),
        "turret_pos": piv, "turret_size": (2.1, 0.82, 2.9), "ring": 1.753, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "armor": {"upper_front": (51, 47, "cha"), "lower_front": (108, 20, "cha"), "side": (38, 10, "cha"), "rear": (38, 15, "cha"),
                  "roof": 19, "floor": 25},
        "turret_armor": {"front": (63.5, 40, "cha"), "mantlet": (89, 1.16, 0.74, "cha"), "side": (63.5, 8, "cha"), "rear": (63.5, "cha"), "roof": 25},
        "gun": {"id": "m1a1_76", "caliber_mm": 76.2, "barrel_length_mm": 3962, "recoil_mm": 305, "rounds_per_min": 10.0,
                "reload_s": 6.0, "traverse_deg_s": 24.0, "elevate_deg_s": 8.0, "max_depression_deg": 10.0, "max_elevation_deg": 25.0,
                "dispersion_mrad": 0.9, "mass_kg": 517, "ammo": ["apcbc_76_m62"]},
        "sight": {"name": "M71D", "levels": [{"magnification": 5.0, "fov_deg": 13.0}]},
        "secondary": [mg("coax_m1919", "m1919a4", "coax", (-0.36, mount[1], piv[2] + 1.27)),
                      mg("bow_m1919", "m1919a4", "hull", (0.62, gl(1.95) + 0.06, 2.37), (15, 10, 20)),
                      mg("aa_m2", "m2hb", "pintle", (0.0, 3.03 + dy, piv[2] - 0.73), post=M2_POST_76)],
        "engine": {"horsepower": 400, "max_rpm": 2400, "idle_rpm": 800, "weight_kg": 520,
                   "torque_curve": [[800, 1000], [1400, 1200], [1800, 1272], [2400, 1187]]},
        "transmission": {"forward_gears": 5, "reverse_gears": 1, "gear_ratios": M4_GEARS, "final_drive_ratio": 9.35, "shift_time_s": 0.4},
        "physics": {"track_width_m": 0.421, "track_length_m": 3.73, "suspension": {"travel_m": 0.11, "stiffness": 300000, "damping": 20000},
                    "rolling_resistance": 0.04, "sprocket_radius_m": 0.318, "drivetrain_efficiency": 0.82, "max_brake_decel_ms2": 6.0,
                    "max_turn_rate_deg_s": 26.0, "max_reverse_speed_ms": 1.4, "min_turn_radius_m": 9.45},
        "modules": m4_modules(piv[2] + 0.50, mount[1]) + [
            module("ammo_ready", "ammo_rack", (-0.7, mount[1] - 0.05, piv[2] - 0.55), (0.15, 0.15, 0.2), 40),
            module("gun_barrel", "gun_barrel", (0, mount[1], (mount[2] + muzzle_z) / 2 + 0.3), (0.08, 0.08, (muzzle_z - mount[2]) / 2 - 0.3), 120),
            module("turret_drive", "turret_drive", (0.75, mount[1] - 0.10, piv[2] + 0.65), (0.12, 0.12, 0.15), 70),
        ],
        "crew": [crew("driver", (-0.6, 1.25, 1.5)), crew("radio_operator", (0.6, 1.25, 1.5)), crew("gunner", (0.45, mount[1] - 0.12, piv[2] + 0.35)),
                 crew("commander", (0.45, mount[1], piv[2] - 0.35)), crew("loader", (-0.5, mount[1] - 0.12, piv[2] + 0.05))],
        "palette": {"paint": "#555338", "paint_dark": "#3e3d29"},
        "parts": parts,
        "running_gear": m4_vvss_gear(tx),
    }


def m4a2():
    """M4A2: the welded hull above (its heights were measured on the M4A2 reference) with the
    GM 6046 twin diesel, spare track blocks on the glacis and the sponsons as the reference
    carries them, and the M4A2's rear plate with its exhaust deflector."""
    g = m4a3_75w()
    tx = 1.054
    extra = []
    for x in (-0.70, -0.27, 0.16):
        for k in range(4):
            z = 2.12 - k * 0.155
            extra.append(box((0.36, 0.035, 0.13), (x, m4_glacis(z) + 0.02, z), rot=(-43, 0, 0), mat="track"))
    for zk in range(7):
        z = 0.30 - zk * 0.155
        for y in (1.40, 1.58):
            extra.append(box((0.035, 0.14, 0.13), (1.325, y, z), mirror=True, mat="track"))
    extra += [
        # the twin exhausts under the deflector on the rear plate
        cyl(0.07, 0.30, "y", (0.45, 1.05, -2.98), mirror=True, mat="black"),
        box((1.60, 0.06, 0.30), (0, 1.22, -3.06), rot=(-30, 0, 0), mat="paint_dark"),
    ]
    g.update({
        "id": "us_m4a2", "name": "M4A2", "year": 1943,
        "based_on": "Medium Tank M4A2 (welded hull, 47-degree glacis) with the 75 mm M3",
        "notes": "Hull and turret as the M4A3(75)W build, whose heights were measured on the M4A2 reference (numbers only). GM 6046 twin diesel (two 6-71s, 410 hp); final_drive_ratio combines the 3.53 bevel gear and the 2.84 final drive. Interior layout is an estimate.",
        "mass": 31800,
        "engine": {"horsepower": 410, "max_rpm": 2900, "idle_rpm": 500, "weight_kg": 2300,
                   "torque_curve": [[500, 900], [1200, 1250], [1900, 1288], [2900, 1007]]},
        "parts": g["parts"] + extra,
    })
    g["gun"] = dict(g["gun"], traverse_deg_s=18.0)
    g["transmission"] = dict(g["transmission"], final_drive_ratio=9.42)
    g["sight"] = {"name": "M70F", "levels": [{"magnification": 3.0, "fov_deg": 12.3}]}
    return g

def m10():
    # M4A2 chassis (the lower hull and VVSS traced above) with the sloped upper hull and the
    # open-topped five-sided turret, both from published dimensions.
    L, W, H, c = 5.93, 3.05, 1.80, M4_C
    pz = 0.20
    piv = (0, H, pz)
    mount = (0, 2.20, pz + 0.92)
    muzzle_z = -L / 2 + 6.83
    tx = 1.054
    outline = [[-0.52, pz + 1.02], [0.52, pz + 1.02], [1.10, pz + 0.15], [0.72, pz - 1.36], [-0.72, pz - 1.36], [-1.10, pz + 0.15]]
    top = 2.56
    parts = m4_lower_hull(tx, 0.421) + vvss(tx) + [
        # upper hull: every plate sloped (the sides lean in 38 degrees)
        prism([(-2.92, M4_SPONSON), (2.30, M4_SPONSON), (1.35, H), (-1.75, H), (-2.80, 1.50)], 3.05, wt=2.05),
        # bosses for the add-on armour, hatches, engine deck grilles, tool stowage
        box((0.52, 0.04, 0.46), (0.52, H + 0.02, 1.02), mirror=True, mat="paint_dark"),
        box((1.3, 0.03, 0.9), (0, H - 0.5 * 0.3 / 1.05 + 0.012, -2.25), rot=(-16, 0, 0), mat="black"),
        box((1.2, 0.5, 0.05), (0, 1.0, -2.94), mat="paint_dark"),
        cyl(0.07, 0.10, "z", (0.86, 1.52, 1.86), mirror=True, mat="black"),
        box((0.05, 0.05, 2.6), (1.36, 1.38, -0.2), rot=(0, 0, 38), mirror=True, mat="steel"),
        cyl(1.0, 0.05, "y", (0, H + 0.025, pz), mount="turret", segs=28, mat="paint_dark"),
        # open-topped turret: thin walls, no roof, wedge counterweights on the rear
        plan(outline, H + 0.05, top, scale_top=(0.92, 0.95), origin=(0, pz), hollow=0.035),
        box((0.62, 0.34, 0.30), (0.37, 2.28, pz - 1.50), rot=(-12, 0, 0), mount="turret", mirror=True, mat="paint_dark"),
        # gun shield and the 3-inch M7
        box((1.00, 0.62, 0.10), (0, 2.20, pz + 1.08), rot=(-14, 0, 0), mount="gun"),
        cyl(0.19, 0.34, "z", (0, 2.20, pz + 1.30), r2=0.13, mount="gun"),
        barrel(mount, pz + 1.44, 2.60, 0.085, 0.07),
        barrel(mount, 2.60, muzzle_z, 0.07, 0.058),
        # breech ring and recoil guard seen through the open top
        box((0.34, 0.34, 0.5), (0, 2.20, pz + 0.45), mount="gun", mat="steel"),
        box((0.26, 0.26, 0.36), (0, 2.20, pz + 0.85), mount="gun", mat="paint_dark"),
        box((0.03, 0.26, 0.7), (0.185, 2.10, pz + 0.0), mount="gun", mirror=True, mat="paint_dark"),
    ]
    return {
        "id": "us_m10", "name": "M10 GMC", "nation": "usa", "cls": "td", "year": 1942, "outline": "dimensions",
        "based_on": "3-inch Gun Motor Carriage M10",
        "notes": "Lower hull and suspension are the traced M4 chassis; upper hull and turret are built from published dimensions. Turret traverse was by hand, about 80 s for a full turn. final_drive_ratio is chosen to match the published top speed; gun elevation limits and the interior layout are estimates.",
        "open_top": True,
        "L": L, "W": W, "H": H, "clear": c, "body_w": 2.5, "nose_y": M4_SPONSON, "mass": 29600, "com": (0, 0.95, 0.0),
        "turret_pos": piv, "turret_size": (2.2, 0.76, 2.9), "ring": 1.753, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "armor": {"upper_front": (38, 55, "rha"), "lower_front": (51, 20, "cha"), "side": (19, 38, "rha"), "rear": (19, 38, "rha"),
                  "roof": 10, "floor": 13},
        "turret_armor": {"front": (57, 45, "cha"), "mantlet": (57, 1.0, 0.62, "cha"), "side": (25, 15, "rha"), "rear": (25, "rha"), "roof": 1},
        "gun": {"id": "m7_3in", "caliber_mm": 76.2, "barrel_length_mm": 3810, "recoil_mm": 305, "rounds_per_min": 10.0,
                "reload_s": 6.0, "traverse_deg_s": 4.5, "elevate_deg_s": 6.0, "max_depression_deg": 10.0, "max_elevation_deg": 30.0,
                "dispersion_mrad": 0.9, "mass_kg": 900, "ammo": ["apcbc_76_m62"]},
        "sight": {"name": "M70G", "levels": [{"magnification": 3.0, "fov_deg": 12.3}]},
        "secondary": [mg("aa_m2", "m2hb", "pintle", (0.0, top + 0.04, pz - 1.28), post=0.06)],
        "engine": {"horsepower": 375, "max_rpm": 2100, "idle_rpm": 500, "weight_kg": 2320,
                   "torque_curve": [[500, 1200], [1300, 1500], [1800, 1420], [2100, 1271]]},
        "transmission": {"forward_gears": 5, "reverse_gears": 1, "gear_ratios": M4_GEARS, "final_drive_ratio": 6.83, "shift_time_s": 0.4},
        "physics": {"track_width_m": 0.421, "track_length_m": 3.73, "suspension": {"travel_m": 0.11, "stiffness": 300000, "damping": 20000},
                    "rolling_resistance": 0.04, "sprocket_radius_m": 0.318, "drivetrain_efficiency": 0.82, "max_brake_decel_ms2": 6.0,
                    "max_turn_rate_deg_s": 26.0, "max_reverse_speed_ms": 1.4, "min_turn_radius_m": 9.45},
        "modules": [
            module("engine", "engine", (0, 1.0, -2.0), (0.5, 0.45, 0.7), 150),
            module("transmission", "transmission", (0, 0.85, 2.3), (0.55, 0.3, 0.4), 120),
            module("fuel_tank_l", "fuel_tank", (-0.95, 1.45, -2.0), (0.22, 0.18, 0.55), 50),
            module("fuel_tank_r", "fuel_tank", (0.95, 1.45, -2.0), (0.22, 0.18, 0.55), 50),
            module("ammo_sponson_l", "ammo_rack", (-1.05, 1.5, 0.3), (0.2, 0.18, 0.6), 60),
            module("ammo_sponson_r", "ammo_rack", (1.05, 1.5, 0.3), (0.2, 0.18, 0.6), 60),
            module("ammo_ready", "ammo_rack", (0.0, 2.2, pz - 1.1), (0.4, 0.14, 0.12), 40),
            module("breech", "gun_breech", (0, 2.20, pz + 0.45), (0.17, 0.17, 0.4), 100),
            module("gun_barrel", "gun_barrel", (0, 2.20, 2.6), (0.08, 0.08, 1.3), 120),
            module("turret_drive", "turret_drive", (-0.72, 2.0, pz + 0.3), (0.12, 0.1, 0.15), 70),
            module("radio", "radio", (0.75, 1.5, 1.35), (0.15, 0.15, 0.2), 40),
        ],
        "crew": [crew("driver", (-0.6, 1.25, 1.5)), crew("radio_operator", (0.6, 1.25, 1.5)), crew("gunner", (-0.5, 2.15, pz + 0.3)),
                 crew("commander", (0.5, 2.2, pz + 0.2)), crew("loader", (0.15, 2.2, pz - 0.6))],
        "palette": {"paint": "#555338", "paint_dark": "#3e3d29"},
        "parts": parts,
        "running_gear": m4_vvss_gear(tx),
    }


# ---- German ------------------------------------------------------------------------------------

HL120 = {"horsepower": 300, "max_rpm": 3000, "idle_rpm": 800, "weight_kg": 920,
         "torque_curve": [[800, 640], [1600, 790], [2150, 800], [2600, 770], [3000, 702]]}


def pz3j():
    L, W, H, c = 5.52, 2.95, 1.52, 0.385
    pz = 0.15
    piv = (0, H, pz)
    mount = (0, 1.80, pz + 0.85)
    muzzle_z = -L / 2 + 6.28
    tx = 1.245
    wz = [1.45, 0.87, 0.29, -0.29, -0.87, -1.45]
    outline = [[-0.60, pz + 0.85], [0.60, pz + 0.85], [0.92, pz + 0.10], [0.90, pz - 0.50], [0.55, pz - 0.98],
               [-0.55, pz - 0.98], [-0.90, pz - 0.50], [-0.92, pz + 0.10]]
    roof = 2.12
    parts = [
        prism([(-2.55, c), (2.25, c), (2.70, 0.72), (2.62, 1.02), (-2.70, 1.02), (-2.74, 0.70)], 1.84),
        prism([(1.42, 1.02), (2.62, 1.02), (1.42, 1.16)], 1.84),
        # superstructure: vertical driver's plate, engine deck a step lower
        prism([(-2.70, 1.02), (1.42, 1.02), (1.36, H), (-1.00, H), (-1.20, 1.42), (-2.66, 1.38)], 2.86),
        box((0.50, 0.025, 5.3), (tx, 1.04, -0.05), mirror=True, mat="paint_dark"),
        box((0.50, 0.025, 0.4), (tx, 0.97, 2.76), rot=(30, 0, 0), mirror=True, mat="paint_dark"),
        # driver's visor, bow MG ball mount, brake access hatches on the glacis
        box((0.44, 0.22, 0.08), (-0.52, 1.34, 1.42), mat="paint_dark"),
        box((0.26, 0.04, 0.03), (-0.52, 1.36, 1.47), mat="black"),
        cyl(0.15, 0.10, "z", (0.52, 1.30, 1.42), r2=0.11, mat="paint_dark"),
        cyl(0.02, 0.32, "z", (0.52, 1.30, 1.62), mat="steel"),
        box((0.5, 0.025, 0.5), (0.46, 1.105, 2.0), rot=(6.7, 0, 0), mirror=True, mat="paint_dark"),
        # engine deck hatches, air intakes, rear
        box((0.7, 0.03, 0.9), (0.42, 1.42, -1.9), mirror=True, mat="paint_dark"),
        box((0.36, 0.2, 1.3), (1.2, 1.2, -1.9), mirror=True, mat="black"),
        cyl(0.11, 0.8, "x", (0, 0.86, -2.84), mat="steel"),
        # turret
        plan(outline, H, roof, scale_top=(0.84, 0.90)),
        box((0.95, 0.48, 0.14), (0, 1.80, pz + 0.90), mount="gun"),
        cyl(0.15, 0.30, "z", (0, 1.80, pz + 1.10), r2=0.10, mount="gun"),
        barrel(mount, pz + 1.22, muzzle_z, 0.055, 0.042),
        cyl(0.025, 0.1, "z", (0.26, 1.80, pz + 0.98), mount="gun", mat="black"),
        # stowage bin on the turret rear
        box((1.0, 0.42, 0.42), (0, 1.86, pz - 1.16), mount="turret", mat="paint_dark"),
    ] + cupola(0.0, roof, pz - 0.52, 0.32, 0.30, blocks=5)
    return {
        "id": "de_pz3_j", "name": "Pz.Kpfw. III Ausf. J (L/60)", "nation": "germany", "cls": "medium", "year": 1942, "outline": "dimensions",
        "based_on": "Panzerkampfwagen III Ausf. J with 5 cm KwK 39 L/60",
        "notes": "Built from published dimensions, not from a drawing. Turret traverse was by hand (the rate is an estimate); gear ratios are estimates chosen to match the published top speed; interior layout is an estimate.",
        "L": L, "W": W, "H": H, "clear": c, "body_w": 2.86, "nose_y": 1.02, "mass": 21500, "com": (0, 0.85, 0.0),
        "turret_pos": piv, "turret_size": (1.86, 0.60, 2.5), "ring": 1.52, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "armor": {"upper_front": (50, 9, "rha"), "glacis": (25, 1.1, "rha"), "lower_front": (50, 21, "rha"), "side": (30, 0, "rha"),
                  "rear": (50, 10, "rha"), "roof": 17, "floor": 16},
        "turret_armor": {"front": (57, 15, "rha"), "mantlet": (50, 0.95, 0.48, "rha"), "side": (30, 25, "rha"), "rear": (30, "rha"), "roof": 10},
        "gun": {"id": "kwk39_50_l60", "caliber_mm": 50.0, "barrel_length_mm": 3000, "recoil_mm": 285, "rounds_per_min": 15.0,
                "reload_s": 4.0, "traverse_deg_s": 10.0, "elevate_deg_s": 6.0, "max_depression_deg": 10.0, "max_elevation_deg": 20.0,
                "dispersion_mrad": 1.0, "mass_kg": 435, "ammo": ["apc_50_pzgr39"]},
        "sight": {"name": "TZF 5e", "levels": [{"magnification": 2.5, "fov_deg": 25.0}]},
        "secondary": [mg("coax_mg34", "mg34", "coax", (0.26, 1.80, pz + 1.08)), mg("bow_mg34", "mg34", "hull", (0.52, 1.30, 1.80), (15, 10, 20))],
        "engine": dict(HL120),
        "transmission": {"forward_gears": 6, "reverse_gears": 1, "gear_ratios": [9.0, 4.5, 2.9, 1.9, 1.3, 1.0],
                         "final_drive_ratio": 8.06, "shift_time_s": 0.35},
        "physics": {"track_width_m": 0.40, "track_length_m": 2.86, "suspension": {"travel_m": 0.20, "stiffness": 180000, "damping": 14000},
                    "rolling_resistance": 0.04, "sprocket_radius_m": 0.30, "drivetrain_efficiency": 0.82, "max_brake_decel_ms2": 6.0,
                    "max_turn_rate_deg_s": 30.0, "max_reverse_speed_ms": 1.8, "min_turn_radius_m": 5.8},
        "modules": [
            module("engine", "engine", (0, 0.95, -1.9), (0.45, 0.4, 0.6), 140),
            module("transmission", "transmission", (0, 0.75, 1.7), (0.45, 0.28, 0.5), 110),
            module("fuel_tank", "fuel_tank", (0.7, 0.75, -1.9), (0.18, 0.28, 0.45), 50),
            module("ammo_rack_l", "ammo_rack", (-0.68, 1.15, 0.0), (0.18, 0.2, 0.55), 50),
            module("ammo_rack_r", "ammo_rack", (0.68, 1.15, 0.0), (0.18, 0.2, 0.55), 50),
            module("breech", "gun_breech", (0, 1.80, pz + 0.45), (0.13, 0.13, 0.32), 90),
            module("gun_barrel", "gun_barrel", (0, 1.80, 2.4), (0.06, 0.06, 1.1), 100),
            module("turret_drive", "turret_drive", (-0.6, 1.62, pz + 0.3), (0.1, 0.08, 0.12), 60),
            module("radio", "radio", (0.62, 1.2, 1.0), (0.14, 0.12, 0.2), 40),
        ],
        "crew": [crew("driver", (-0.52, 1.0, 1.0)), crew("radio_operator", (0.2, 1.0, 1.0)), crew("gunner", (-0.45, 1.72, pz + 0.3)),
                 crew("commander", (0.0, 1.82, pz - 0.5)), crew("loader", (0.48, 1.72, pz + 0.1))],
        "palette": {"paint": "#5c5f5a", "paint_dark": "#44474a"},
        "parts": parts,
        "running_gear": {"track_width": 0.40, "track_thickness": 0.05, "track_x": tx, "link_pitch": 0.12, "link_style": "center_guide", "track_sag": 0.014,
                         "sprocket": {"z": 2.32, "y": 0.68, "r": 0.30, "teeth": 21}, "idler": {"z": -2.32, "y": 0.62, "r": 0.28},
                         "wheels": wheel_row(wz, 0.26 + 0.05, 0.26, 0.20),
                         "rollers": [{"z": z, "y": 0.90, "r": 0.155, "w": 0.16} for z in (1.1, 0.0, -1.1)], "wheel_style": "rubber_dish"},
    }


def pz4h():
    L, W, H, c = 5.92, 2.88, 1.68, 0.40
    pz = 0.25
    piv = (0, H, pz)
    mount = (0, 1.98, pz + 0.95)
    muzzle_z = -L / 2 + 7.02
    tx = 1.23
    wz = [1.74, 1.24, 0.78, 0.28, -0.18, -0.68, -1.14, -1.64]
    outline = [[-0.62, pz + 0.95], [0.62, pz + 0.95], [0.98, pz + 0.20], [0.98, pz - 0.55], [0.60, pz - 1.05],
               [-0.60, pz - 1.05], [-0.98, pz - 0.55], [-0.98, pz + 0.20]]
    roof = 2.30
    bogies = [(wz[i] + wz[i + 1]) / 2 for i in range(0, 8, 2)]
    parts = [
        prism([(-2.55, c), (2.45, c), (2.94, 0.78), (2.84, 1.10), (-2.90, 1.10), (-2.96, 0.75)], 1.80),
        prism([(1.72, 1.10), (2.84, 1.10), (1.72, 1.24)], 1.80),
        # superstructure overhanging the tracks, vertical 80 mm driver's plate
        prism([(-2.80, 1.10), (1.72, 1.10), (1.66, H), (-2.74, 1.60)], 2.86),
        box((0.50, 0.025, 5.7), (tx, 1.12, 0.0), mirror=True, mat="paint_dark"),
        box((0.50, 0.025, 0.42), (tx, 1.04, 2.98), rot=(28, 0, 0), mirror=True, mat="paint_dark"),
        # hull side skirts (Schuerzen) on their rails
        box((0.008, 0.86, 4.5), (1.63, 1.28, -0.1), mirror=True, mat="paint_dark"),
        box((0.03, 0.03, 4.5), (1.6, 1.70, -0.1), mirror=True, mat="steel"),
    ] + [box((0.21, 0.14, 0.05), (1.505, 1.63, z), mirror=True, mat="steel") for z in (-2.0, -0.8, 0.4, 1.5)] + [
        # driver's visor, bow MG, brake hatches, spare links on the nose
        box((0.44, 0.22, 0.08), (-0.56, 1.46, 1.72), mat="paint_dark"),
        box((0.26, 0.04, 0.03), (-0.56, 1.48, 1.77), mat="black"),
        cyl(0.16, 0.10, "z", (0.56, 1.44, 1.72), r2=0.12, mat="paint_dark"),
        cyl(0.02, 0.32, "z", (0.56, 1.44, 1.92), mat="steel"),
        box((0.5, 0.025, 0.46), (0.46, 1.18, 2.24), rot=(7.3, 0, 0), mirror=True, mat="paint_dark"),
        box((1.3, 0.12, 0.05), (0, 0.98, 2.905), rot=(-14, 0, 0), mat="track"),
        # engine deck, exhaust and auxiliary muffler on the rear plate
        box((0.8, 0.03, 0.9), (0.45, 1.62, -2.1), mirror=True, mat="paint_dark"),
        box((0.3, 0.16, 1.0), (1.22, 1.38, -2.1), mirror=True, mat="black"),
        cyl(0.12, 1.0, "x", (0, 0.82, -3.02), mat="steel"),
        cyl(0.07, 0.4, "x", (-0.6, 1.0, -3.0), mat="steel"),
    ]
    for bz in bogies:
        parts.append(box((0.08, 0.10, 0.62), (tx - 0.29, 0.36, bz), mirror=True, mat="paint_dark"))  # leaf spring
    parts += [
        plan(outline, H, roof, scale_top=(0.86, 0.90)),
        box((0.90, 0.50, 0.15), (0, 1.98, pz + 1.00), mount="gun"),
        cyl(0.17, 0.36, "z", (0, 1.98, pz + 1.24), r2=0.11, mount="gun"),
        barrel(mount, pz + 1.40, muzzle_z - 0.42, 0.075, 0.055),
        cyl(0.025, 0.1, "z", (0.28, 1.98, pz + 1.08), mount="gun", mat="black"),
        box((1.1, 0.40, 0.46), (0, 2.02, pz - 1.25), mount="turret", mat="paint_dark"),
        box((0.42, 0.03, 0.5), (0.66, roof + 0.012, pz + 0.05), mount="turret", mirror=True, mat="paint_dark"),
    ] + muzzle_brake(mount, muzzle_z, 0.11, 0.42) + cupola(0.0, roof, pz - 0.62, 0.33, 0.34, blocks=5)
    return {
        "id": "de_pz4_h", "name": "Pz.Kpfw. IV Ausf. H", "nation": "germany", "cls": "medium", "year": 1943, "outline": "dimensions",
        "based_on": "Panzerkampfwagen IV Ausf. H with 7.5 cm KwK 40 L/48",
        "notes": "Built from published dimensions, not from a drawing. Gear ratios are estimates chosen to match the published top speed; interior layout is an estimate.",
        "L": L, "W": W, "H": H, "clear": c, "body_w": 2.86, "nose_y": 1.10, "mass": 25000, "com": (0, 0.9, 0.0),
        "turret_pos": piv, "turret_size": (1.98, 0.62, 2.7), "ring": 1.60, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "armor": {"upper_front": (80, 10, "rha"), "glacis": (20, 1.0, "rha"), "lower_front": (80, 14, "rha"), "side": (30, 0, "rha"),
                  "rear": (20, 10, "rha"), "roof": 12, "floor": 10},
        "turret_armor": {"front": (50, 10, "rha"), "mantlet": (50, 0.90, 0.50, "rha"), "side": (30, 25, "rha"), "rear": (30, "rha"), "roof": 15},
        "gun": {"id": "kwk40_75_l48", "caliber_mm": 75.0, "barrel_length_mm": 3600, "recoil_mm": 480, "rounds_per_min": 10.0,
                "reload_s": 6.0, "traverse_deg_s": 14.0, "elevate_deg_s": 5.0, "max_depression_deg": 8.0, "max_elevation_deg": 20.0,
                "dispersion_mrad": 0.9, "mass_kg": 750, "ammo": ["apcbc_75_pzgr39"]},
        "sight": {"name": "TZF 5f", "levels": [{"magnification": 2.5, "fov_deg": 25.0}]},
        "secondary": [mg("coax_mg34", "mg34", "coax", (0.28, 1.98, pz + 1.18)), mg("bow_mg34", "mg34", "hull", (0.56, 1.44, 2.10), (15, 10, 20))],
        "engine": dict(HL120),
        "transmission": {"forward_gears": 6, "reverse_gears": 1, "gear_ratios": [9.2, 4.6, 2.95, 1.95, 1.35, 1.0],
                         "final_drive_ratio": 8.76, "shift_time_s": 0.35},
        "physics": {"track_width_m": 0.40, "track_length_m": 3.52, "suspension": {"travel_m": 0.13, "stiffness": 220000, "damping": 15000},
                    "rolling_resistance": 0.045, "sprocket_radius_m": 0.31, "drivetrain_efficiency": 0.80, "max_brake_decel_ms2": 5.5,
                    "max_turn_rate_deg_s": 28.0, "max_reverse_speed_ms": 1.8, "min_turn_radius_m": 5.9},
        "modules": [
            module("engine", "engine", (0, 1.0, -2.1), (0.45, 0.4, 0.6), 140),
            module("transmission", "transmission", (0, 0.78, 1.9), (0.45, 0.28, 0.55), 110),
            module("fuel_tank_l", "fuel_tank", (-0.42, 0.56, 0.1), (0.36, 0.12, 0.5), 50),
            module("fuel_tank_r", "fuel_tank", (0.42, 0.56, 0.1), (0.36, 0.12, 0.5), 50),
            module("ammo_rack_l", "ammo_rack", (-1.1, 1.38, -0.5), (0.22, 0.2, 0.6), 50),
            module("ammo_rack_r", "ammo_rack", (1.1, 1.38, -0.5), (0.22, 0.2, 0.6), 50),
            module("breech", "gun_breech", (0, 1.98, pz + 0.5), (0.16, 0.16, 0.36), 100),
            module("gun_barrel", "gun_barrel", (0, 1.98, 2.7), (0.08, 0.08, 1.3), 110),
            module("turret_drive", "turret_drive", (-0.66, 1.80, pz + 0.3), (0.1, 0.08, 0.12), 60),
            module("radio", "radio", (0.75, 1.3, 1.25), (0.16, 0.12, 0.2), 40),
        ],
        "crew": [crew("driver", (-0.56, 1.1, 1.15)), crew("radio_operator", (0.3, 1.1, 1.15)), crew("gunner", (-0.48, 1.9, pz + 0.3)),
                 crew("commander", (0.0, 2.0, pz - 0.6)), crew("loader", (0.5, 1.9, pz + 0.1))],
        "palette": {"paint": "#9a8f66", "paint_dark": "#746b4b"},
        "parts": parts,
        "running_gear": {"track_width": 0.40, "track_thickness": 0.05, "track_x": tx, "link_pitch": 0.12, "link_style": "center_guide", "track_sag": 0.014,
                         "sprocket": {"z": 2.55, "y": 0.70, "r": 0.31, "teeth": 18}, "idler": {"z": -2.62, "y": 0.62, "r": 0.30},
                         "wheels": wheel_row(wz, 0.235 + 0.05, 0.235, 0.18),
                         "rollers": [{"z": z, "y": 0.88, "r": 0.125, "w": 0.14} for z in (1.45, 0.5, -0.45, -1.4)], "wheel_style": "rubber_dish"},
    }


def panther_g():
    L, W, H, c = 6.87, 3.27, 1.87, 0.56
    pz = -0.05
    piv = (0, H, pz)
    mount = (0, 2.31, pz + 1.02)
    muzzle_z = -L / 2 + 8.66
    tx = 1.305
    tt = 0.08
    axles = [1.96 - i * 0.56 for i in range(8)]
    wy = 0.43 + tt
    wheels = []
    for i, z in enumerate(axles):
        offs = (0.21, -0.09) if i % 2 == 0 else (0.06, -0.24)
        for o in offs:
            wheels += wheel_row([z], wy, 0.43, 0.10, o)
    outline = [[-0.72, pz + 1.05], [0.72, pz + 1.05], [1.14, pz - 0.20], [1.02, pz - 1.25], [-1.02, pz - 1.25], [-1.14, pz - 0.20]]
    roof = 2.67
    parts = [
        # lower hull: 55-degree lower nose, the rear plate undercut 30 degrees
        prism([(-2.68, c), (2.87, c), (3.435, 0.95), (3.078, 1.20), (-3.05, 1.20)], 1.85),
        # upper hull: one-piece 55-degree glacis, sides leaning in 30 degrees
        prism([(-3.05, 1.20), (3.078, 1.20), (2.12, H), (-3.435, H)], 3.27, wt=2.50),
        box((0.66, 0.025, 0.7), (tx, 1.19, 2.75), rot=(20, 0, 0), mirror=True, mat="paint_dark"),
        # side skirts hung from the sponson edge
        box((0.008, 0.42, 5.2), (1.638, 1.005, -0.1), mirror=True, mat="paint_dark"),
        # bow MG ball mount (Kugelblende), driver's periscope hood, hatches
        cyl(0.20, 0.14, "z", (0.60, 1.48, 2.70), rot=(-35, 0, 0), r2=0.14, mat="paint_dark"),
        cyl(0.02, 0.32, "z", (0.60, 1.56, 2.90), mat="steel"),
        box((0.3, 0.07, 0.16), (-0.60, H + 0.035, 1.86), mat="paint_dark"),
        box((0.52, 0.03, 0.42), (0.62, H + 0.015, 1.50), mirror=True, mat="paint_dark"),
        # engine deck: centre hatch, radiator and fan grilles
        box((0.9, 0.03, 1.3), (0.0, H + 0.015, -2.5), mat="paint_dark"),
        box((0.62, 0.025, 0.5), (0.86, H + 0.013, -1.95), mirror=True, mat="black"),
        box((0.62, 0.025, 0.5), (0.86, H + 0.013, -3.0), mirror=True, mat="black"),
        cyl(0.26, 0.03, "y", (0.86, H + 0.015, -2.48), mirror=True, mat="black"),
        # rear plate: exhaust pipes and stowage bins
        cyl(0.06, 0.7, "y", (0.22, 1.72, -3.36), mirror=True, mat="steel"),
        box((0.46, 0.62, 0.22), (1.0, 1.30, -3.24), rot=(30, 0, 0), mirror=True, mat="paint_dark"),
        # turret: sides leaning in 25 degrees
        plan(outline, H + 0.03, roof, scale_top=(0.76, 0.92), origin=(0, pz)),
        cyl(0.38, 1.50, "x", (0, 2.31, pz + 1.10), mount="gun", segs=22),
        cyl(0.19, 0.34, "z", (0, 2.31, pz + 1.56), r2=0.13, mount="gun"),
        cyl(0.03, 0.04, "z", (-0.42, 2.40, pz + 1.50), mount="gun", mat="black"),
        cyl(0.03, 0.08, "z", (0.38, 2.31, pz + 1.50), mount="gun", mat="black"),
        barrel(mount, pz + 1.70, 3.6, 0.105, 0.085),
        barrel(mount, 3.6, muzzle_z - 0.46, 0.085, 0.062),
        cyl(0.24, 0.03, "y", (0.5, roof + 0.012, pz - 0.75), mount="turret", mat="paint_dark"),
        cyl(0.24, 0.04, "z", (0, 2.26, pz - 1.23), mount="turret", mat="paint_dark"),
    ] + muzzle_brake(mount, muzzle_z, 0.115) + cupola(-0.52, roof, pz - 0.55, 0.39, 0.27, blocks=7)
    return {
        "id": "de_panther_g", "name": "Panther Ausf. G", "nation": "germany", "cls": "medium", "year": 1944, "outline": "dimensions",
        "based_on": "Panzerkampfwagen V Panther Ausf. G",
        "notes": "Built from published dimensions, not from a drawing. Gear ratios are the published AK 7-200 values; final_drive_ratio folds the steering unit in and is chosen to match the published top speed. One plate stands for the whole hull side. Interior layout is an estimate.",
        "L": L, "W": W, "H": H, "clear": c, "body_w": 2.9, "nose_y": 0.95, "mass": 44800, "com": (0, 1.0, 0.0),
        "turret_pos": piv, "turret_size": (2.3, 0.80, 2.6), "ring": 1.65, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "armor": {"upper_front": (80, 55, "rha"), "lower_front": (60, 55, "rha"), "side": (50, 30, "rha"), "rear": (40, -30, "rha"),
                  "roof": 16, "floor": 16},
        "turret_armor": {"front": (100, 12, "cha"), "mantlet": (100, 1.50, 0.80, "cha"), "side": (45, 25, "rha"), "rear": (45, "rha"), "roof": 16},
        "gun": {"id": "kwk42_75_l70", "caliber_mm": 75.0, "barrel_length_mm": 5250, "recoil_mm": 420, "rounds_per_min": 8.0,
                "reload_s": 7.0, "traverse_deg_s": 15.0, "elevate_deg_s": 4.0, "max_depression_deg": 8.0, "max_elevation_deg": 18.0,
                "dispersion_mrad": 0.7, "mass_kg": 1000, "ammo": ["apcbc_75_pzgr39_42"]},
        "sight": {"name": "TZF 12a", "levels": [{"magnification": 2.5, "fov_deg": 28.0}, {"magnification": 5.0, "fov_deg": 14.0}]},
        "dep_table": [(0, 8), (150, 8), (160, 7.5), (200, 7.5), (210, 8), (360, 8)],
        "secondary": [mg("coax_mg34", "mg34", "coax", (0.38, 2.31, pz + 1.56)), mg("bow_mg34", "mg34", "hull", (0.60, 1.56, 3.06), (10, 10, 15))],
        "engine": {"horsepower": 700, "max_rpm": 3000, "idle_rpm": 800, "weight_kg": 1200,
                   "torque_curve": [[800, 1500], [1500, 1780], [2100, 1850], [3000, 1639]]},
        "transmission": {"forward_gears": 7, "reverse_gears": 1, "gear_ratios": [9.21, 4.56, 2.87, 1.83, 1.27, 0.90, 0.68],
                         "final_drive_ratio": 12.06, "shift_time_s": 0.3},
        "physics": {"track_width_m": 0.66, "track_length_m": 3.92, "suspension": {"travel_m": 0.25, "stiffness": 340000, "damping": 26000},
                    "rolling_resistance": 0.045, "sprocket_radius_m": 0.42, "drivetrain_efficiency": 0.80, "max_brake_decel_ms2": 5.5,
                    "max_turn_rate_deg_s": 24.0, "max_reverse_speed_ms": 1.1, "min_turn_radius_m": 0.0},
        "modules": [
            module("engine", "engine", (0, 1.05, -2.45), (0.5, 0.42, 0.65), 160),
            module("transmission", "transmission", (0, 0.92, 2.2), (0.45, 0.3, 0.6), 130),
            module("fuel_tank_l", "fuel_tank", (-0.85, 1.05, -2.45), (0.25, 0.4, 0.55), 50),
            module("fuel_tank_r", "fuel_tank", (0.85, 1.05, -2.45), (0.25, 0.4, 0.55), 50),
            module("ammo_rack_l", "ammo_rack", (-1.25, 1.5, 0.3), (0.2, 0.2, 0.9), 60),
            module("ammo_rack_r", "ammo_rack", (1.25, 1.5, 0.3), (0.2, 0.2, 0.9), 60),
            module("breech", "gun_breech", (0, 2.31, pz + 0.5), (0.17, 0.17, 0.4), 110),
            module("gun_barrel", "gun_barrel", (0, 2.31, 3.4), (0.09, 0.09, 1.8), 130),
            module("turret_drive", "turret_drive", (0, 1.7, pz), (0.3, 0.1, 0.3), 80),
            module("vertical_drive", "vertical_drive", (-0.4, 2.02, pz + 0.7), (0.1, 0.1, 0.15), 60),
            module("radio", "radio", (0.75, 1.2, 1.7), (0.18, 0.12, 0.25), 40),
        ],
        "crew": [crew("driver", (-0.6, 1.2, 1.35)), crew("radio_operator", (0.6, 1.2, 1.0)), crew("gunner", (-0.55, 2.1, pz + 0.55)),
                 crew("commander", (-0.5, 2.3, pz - 0.55)), crew("loader", (0.55, 2.1, pz - 0.2))],
        "palette": {"paint": "#9a8f66", "paint_dark": "#746b4b"},
        "parts": parts,
        "running_gear": {"track_width": 0.66, "track_thickness": tt, "track_x": tx, "link_pitch": 0.15, "link_style": "twin_guide", "track_sag": 0.035,
                         "sprocket": {"z": 2.72, "y": 0.80, "r": 0.40, "teeth": 17}, "idler": {"z": -2.62, "y": 0.62, "r": 0.30},
                         "wheels": wheels, "rollers": [], "wheel_style": "rubber_dish"},
    }


# ---- Soviet ------------------------------------------------------------------------------------

V2_520 = {"horsepower": 520, "max_rpm": 2000, "idle_rpm": 600, "weight_kg": 1000,
          "torque_curve": [[600, 1900], [1200, 2250], [1600, 2150], [2000, 1851]]}


def is2():
    L, W, H, c = 6.77, 3.09, 1.58, 0.42
    pz = 0.75
    piv = (0, H, pz)
    mount = (0, 2.02, pz + 1.05)
    muzzle_z = -L / 2 + 9.90
    tx = 1.22
    wz = [1.95, 1.17, 0.39, -0.39, -1.17, -1.95]
    roof = 2.42
    parts = [
        # lower hull: 30-degree lower nose plate, rounded tail
        prism([(-3.05, c), (3.10, c), (3.385, 0.90), (3.21, 1.0), (-3.33, 1.0), (-3.385, 0.85)], 1.76),
        # upper hull: straight 60-degree glacis (1944 hull), sides leaning in over the tracks
        prism([(-3.33, 1.0), (3.21, 1.0), (2.20, H), (-2.40, H), (-3.10, 1.30)], 3.05, wt=2.55),
        box((0.66, 0.025, 6.2), (tx, 1.02, 0.0), mirror=True, mat="paint_dark"),
        # driver's vision block, fixed bow MG, spare links on the lower nose
        box((0.34, 0.12, 0.10), (0.0, 1.50, 2.36), rot=(-30, 0, 0), mat="paint_dark"),
        box((0.22, 0.03, 0.03), (0.0, 1.52, 2.42), rot=(-30, 0, 0), mat="black"),
        cyl(0.02, 0.2, "z", (0.6, 1.28, 2.78), mat="steel"),
        box((1.3, 0.14, 0.05), (0, 0.66, 3.28), rot=(30, 0, 0), mat="track"),
        # engine deck: domed access hatch, mesh grilles, external fuel drums
        cyl(0.42, 0.05, "y", (0, H + 0.025, -1.55), mat="paint_dark"),
        box((0.62, 0.025, 1.3), (0.9, H + 0.013, -1.6), mirror=True, mat="black"),
        box((1.9, 0.03, 0.5), (0, 1.44, -2.76), rot=(-22, 0, 0), mat="black"),
        cyl(0.2, 0.8, "z", (1.36, 1.26, -0.9), mirror=True, mat="paint_dark", segs=16),
        cyl(0.2, 0.8, "z", (1.36, 1.26, -1.85), mirror=True, mat="paint_dark", segs=16),
    ]
    parts += dome(0, pz - 0.15, 1.12, 1.15, 1.50, H, roof, tiers=3, p=2.6, flat=0.62)
    parts += [
        cyl(0.42, 1.30, "x", (0, 2.02, pz + 1.02), mount="gun", segs=22),
        cyl(0.24, 0.50, "z", (0, 2.02, pz + 1.50), r2=0.17, mount="gun"),
        cyl(0.03, 0.08, "z", (0.36, 2.02, pz + 1.42), mount="gun", mat="black"),
        barrel(mount, pz + 1.74, 4.3, 0.125, 0.105),
        barrel(mount, 4.3, muzzle_z - 0.52, 0.105, 0.088),
        cyl(0.26, 0.03, "y", (0.48, roof + 0.012, pz - 0.2), mount="turret", mat="paint_dark"),
        # rear ball mount for the turret-rear MG
        cyl(0.13, 0.08, "z", (-0.3, 2.05, pz - 1.60), mount="turret", mat="paint_dark"),
    ] + muzzle_brake(mount, muzzle_z, 0.17, 0.52) + cupola(-0.45, roof, pz - 0.50, 0.37, 0.20, blocks=6)
    return {
        "id": "su_is2", "name": "IS-2 (1944)", "nation": "ussr", "cls": "heavy", "year": 1944, "outline": "dimensions",
        "based_on": "IS-2, 1944 production with the straight glacis and 122 mm D-25T",
        "notes": "Built from published dimensions, not from a drawing. Gear ratios are estimates chosen to match the published top speed; turret traverse and elevation rates and the interior layout are estimates.",
        "L": L, "W": W, "H": H, "clear": c, "body_w": 2.6, "nose_y": 0.90, "mass": 46000, "com": (0, 0.95, 0.0),
        "turret_pos": piv, "turret_size": (2.24, 0.84, 3.3), "ring": 1.80, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "armor": {"upper_front": (100, 60, "rha"), "lower_front": (100, 30, "rha"), "side": (90, 0, "rha"), "rear": (60, 40, "rha"),
                  "roof": 30, "floor": 20},
        "turret_armor": {"front": (100, 10, "cha"), "mantlet": (120, 1.30, 0.80, "cha"), "side": (90, 20, "cha"), "rear": (90, "cha"), "roof": 30},
        "gun": {"id": "d25t_122", "caliber_mm": 121.92, "barrel_length_mm": 5250, "recoil_mm": 550, "rounds_per_min": 2.7,
                "reload_s": 22.0, "traverse_deg_s": 13.0, "elevate_deg_s": 3.0, "max_depression_deg": 3.0, "max_elevation_deg": 20.0,
                "dispersion_mrad": 0.9, "mass_kg": 2420, "ammo": ["aphe_122_br471"]},
        "sight": {"name": "TSh-17", "levels": [{"magnification": 4.0, "fov_deg": 16.0}]},
        "secondary": [mg("coax_dt", "dt", "coax", (0.36, 2.02, pz + 1.48)), mg("bow_dt", "dt", "hull", (0.6, 1.28, 2.90), (2, 2, 2)),
                      mg("aa_dshk", "dshk", "pintle", (-0.45, roof + 0.475, pz - 0.50), post=0.25)],
        "engine": dict(V2_520),
        "transmission": {"forward_gears": 8, "reverse_gears": 2, "gear_ratios": [13.0, 8.2, 5.6, 3.9, 2.9, 2.0, 1.4, 1.0],
                         "final_drive_ratio": 6.97, "shift_time_s": 0.5},
        "physics": {"track_width_m": 0.65, "track_length_m": 4.30, "suspension": {"travel_m": 0.16, "stiffness": 420000, "damping": 30000},
                    "rolling_resistance": 0.045, "sprocket_radius_m": 0.36, "drivetrain_efficiency": 0.80, "max_brake_decel_ms2": 5.0,
                    "max_turn_rate_deg_s": 20.0, "max_reverse_speed_ms": 2.0, "min_turn_radius_m": 0.0},
        "modules": [
            module("engine", "engine", (0, 0.95, -1.5), (0.5, 0.42, 0.75), 160),
            module("transmission", "transmission", (0, 0.85, -2.72), (0.6, 0.3, 0.32), 130),
            module("fuel_tank_l", "fuel_tank", (-0.62, 0.9, 1.9), (0.22, 0.3, 0.45), 50),
            module("fuel_tank_r", "fuel_tank", (0.62, 0.9, 1.9), (0.22, 0.3, 0.45), 50),
            module("ammo_charges", "ammo_rack", (0, 0.62, 0.6), (0.6, 0.14, 0.7), 70),
            module("ammo_shells", "ammo_rack", (0.0, 2.0, pz - 1.25), (0.6, 0.16, 0.22), 60),
            module("breech", "gun_breech", (0, 2.02, pz + 0.45), (0.22, 0.22, 0.45), 120),
            module("gun_barrel", "gun_barrel", (0, 2.02, 4.2), (0.11, 0.11, 2.2), 150),
            module("turret_drive", "turret_drive", (-0.72, 1.75, pz + 0.5), (0.14, 0.1, 0.16), 80),
            module("radio", "radio", (-0.8, 2.0, pz - 0.5), (0.1, 0.12, 0.2), 40),
        ],
        "crew": [crew("driver", (0.0, 0.98, 2.3)), crew("gunner", (-0.55, 1.95, pz + 0.5)),
                 crew("commander", (-0.45, 2.08, pz - 0.5)), crew("loader", (0.55, 1.95, pz + 0.0))],
        "palette": {"paint": "#56643c", "paint_dark": "#3f4a2d"},
        "parts": parts,
        "running_gear": {"track_width": 0.65, "track_thickness": 0.07, "track_x": tx, "link_pitch": 0.162, "link_style": "center_guide", "track_sag": 0.02,
                         "sprocket": {"z": -2.92, "y": 0.72, "r": 0.36, "teeth": 14}, "idler": {"z": 2.78, "y": 0.66, "r": 0.275},
                         "wheels": wheel_row(wz, 0.275 + 0.07, 0.275, 0.36),
                         "rollers": [{"z": z, "y": 0.93, "r": 0.14, "w": 0.3} for z in (1.3, 0.0, -1.3)], "wheel_style": "steel_dish"},
    }


def panther_f():
    """Panther Ausf. F with the Schmalturm, traced from the Panzer Tracts drawing (2006): the
    side view and the plan give the turret's outline, mantlet, rangefinder hoods and cupola at
    about 120 px per metre; the hull is the Ausf. G's (published dimensions) with the 40 mm roof."""
    g = panther_g()
    L, H = g["L"], g["H"]
    pz = -0.09
    roof = 2.62
    mount = (0, 2.24, 0.95)
    muzzle_z = -L / 2 + 8.66
    piv = (0, H, pz)
    # plan of the Schmalturm (hull frame, x right, z forward): narrow 1.7 m front plate, widest
    # 2.36 m over the rangefinder hoods, chamfered rear corners
    outline = [[-0.85, 1.10], [0.85, 1.10], [1.18, -0.52], [0.71, -1.27], [-0.71, -1.27], [-1.18, -0.52]]
    hull_parts = [p for p in g["parts"] if p.get("mount", "hull") == "hull"]
    parts = hull_parts + [
        plan(outline, H + 0.03, roof, scale_top=(0.80, 0.95), origin=(0, pz)),
        # the Saukopf mantlet: a cone round the gun
        cyl(0.31, 0.50, "z", (0, mount[1], 1.35), r2=0.17, mount="gun", segs=24),
        cyl(0.03, 0.06, "z", (0.30, 2.26, 1.22), mount="gun", mat="black"),
        barrel(mount, 1.58, 3.5, 0.10, 0.085),
        barrel(mount, 3.5, muzzle_z, 0.085, 0.064),
        cyl(0.075, 0.12, "z", (0, mount[1], muzzle_z - 0.06), mount="gun", mat="paint_dark"),
        # the stereoscopic rangefinder's armoured hoods on either side
        cyl(0.11, 0.20, "x", (1.10, 2.46, -0.45), mount="turret", mat="paint_dark", mirror=True),
        cyl(0.24, 0.03, "y", (0.45, roof + 0.012, -0.65), mount="turret", mat="paint_dark"),
        box((0.5, 0.04, 0.3), (0.0, roof + 0.02, -0.95), mount="turret", mat="paint_dark"),
    ] + cupola(-0.37, roof, -0.44, 0.33, 0.20, blocks=7)
    g.update({
        "id": "de_panther_f", "name": "Panther Ausf. F", "year": 1945, "outline": "traced",
        "based_on": "Panzerkampfwagen V Panther Ausf. F with the Schmalturm and 7.5 cm KwK 44/1 L/70",
        "notes": "Turret traced from the Panzer Tracts drawing (Schmalturm plan and side view); hull as the Ausf. G with the Ausf. F's 40 mm roof. Rangefinder figures and the TZF 13 magnifications are estimates.",
        "mass": 45500, "turret_pos": piv, "turret_size": (2.36, roof - H, 2.37), "ring": 1.65, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "parts": parts,
    })
    g["dep_table"] = [(0, 8), (150, 8), (160, 6), (200, 6), (210, 8), (360, 8)]
    g["armor"] = dict(g["armor"], roof=40)
    g["turret_armor"] = {"front": (120, 20, "rha"), "mantlet": (150, 0.62, 0.62, "cha"), "side": (60, 25, "rha"), "rear": (60, "rha"), "roof": 40}
    g["gun"] = dict(g["gun"], id="kwk44_1_75_l70", traverse_deg_s=16.0)
    g["sight"] = {"name": "TZF 13 + EM 1.32 m R", "levels": [{"magnification": 2.5, "fov_deg": 28.0}, {"magnification": 5.0, "fov_deg": 14.0}],
                  "rangefinder": {"time_s": 3.0, "error_pct": 2.0, "max_range_m": 4000}}
    g["secondary"] = [mg("coax_mg42", "mg42", "coax", (0.30, 2.26, 1.25)), mg("bow_mg34", "mg34", "hull", (0.60, 1.56, 3.06), (10, 10, 15))]
    g["modules"] = [m for m in g["modules"] if m["kind"] not in ("gun_breech", "vertical_drive", "turret_drive")] + [
        module("breech", "gun_breech", (0, mount[1], pz + 0.45), (0.17, 0.17, 0.4), 110),
        module("turret_drive", "turret_drive", (0, 1.7, pz), (0.3, 0.1, 0.3), 80),
        module("vertical_drive", "vertical_drive", (-0.4, 1.98, pz + 0.7), (0.1, 0.1, 0.15), 60),
    ]
    g["crew"] = [crew("driver", (-0.6, 1.2, 1.35)), crew("radio_operator", (0.6, 1.2, 1.0)), crew("gunner", (-0.5, 2.05, pz + 0.55)),
                 crew("commander", (-0.37, 2.25, pz - 0.40)), crew("loader", (0.55, 2.05, pz - 0.2))]
    return g


# The Oplot-MO anti-missile machine-gun complex on the T-10M (1960s trials): a six-barrel 14.5 mm
# gun in its own small turret on the right of the main turret's roof. How far it can dip at each
# bearing (main gun level), from the drawing "Схема максимально возможных углов снижения
# установки шестиствольного 14,5-мм пулемета на танке Т-10М": -6 deg over the main gun, -15 to
# the right front, -20 over the right side, -15 to the rear, -5 over the cupola on the left,
# -10 to the left front.
OPLOT_DEPRESSION = [(0, 6), (45, 15), (95, 20), (165, 15), (265, 5), (315, 10), (360, 6)]


def depression_table(points):
    out = []
    for i in range(36):
        b = i * 10.0
        for (b0, d0), (b1, d1) in zip(points, points[1:]):
            if b0 <= b <= b1:
                out.append(round(d0 + (d1 - d0) * (b - b0) / (b1 - b0), 1))
                break
    return out


def loft(rings, mount="hull", mat="paint", crease=35, caps=(True, True)):
    """A lofted surface through stacked closed rings (client/web/src/gfx/geo.js loft): each ring a
    list of [x, y, z] with the same point count, ordered from the first to the last ring."""
    return {"type": "loft", "mount": mount, "mat": mat, "rings": [[[r3(k) for k in p] for p in r] for r in rings],
            "crease": crease, "caps": list(caps)}


def plan_ring(y, zf, zr, w, n=40, p=2.3, x=0.0):
    """A cast turret's horizontal section at height y: front at zf, rear at zr, half-width w,
    a superellipse wound as loft() wants for rings stacked upwards."""
    zc = (zf + zr) / 2
    out = []
    for i in range(n):
        t = 2 * math.pi * i / n
        cx, cz = math.cos(t), -math.sin(t)
        sx = math.copysign(abs(cx) ** (2 / p), cx)
        sz = math.copysign(abs(cz) ** (2 / p), cz)
        out.append([x + w * sx, y, zc + sz * ((zf - zc) if sz >= 0 else (zc - zr))])
    return out


def mesh_part(verts, faces, inside, mount="hull", mat="paint", mirror_x=True):
    """A polygon mesh (client/web GeoBuilder.polyMesh) from the right half's vertices and faces,
    each face turned to face away from `inside`, mirrored to the left when mirror_x."""
    def newell(pts):
        n = [0.0, 0.0, 0.0]
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            n[0] += (a[1] - b[1]) * (a[2] + b[2])
            n[1] += (a[2] - b[2]) * (a[0] + b[0])
            n[2] += (a[0] - b[0]) * (a[1] + b[1])
        return n
    V = [list(v) for v in verts]
    F = []
    for f in faces:
        pts = [V[i] for i in f]
        n = newell(pts)
        c = [sum(p[k] for p in pts) / len(pts) for k in range(3)]
        out = sum(n[k] * (c[k] - inside[k]) for k in range(3))
        F.append(list(f) if out > 0 else list(reversed(f)))
    if mirror_x:
        k = len(V)
        V += [[-x, y, z] for x, y, z in verts]
        F += [[i + k for i in reversed(f)] for f in F]
    return {"type": "mesh", "mount": mount, "mat": mat, "vertices": [[r3(a) for a in v] for v in V], "faces": F}


def egg_ring(y, table, n=36):
    """A turret's plan section at height y from (z, half-width) pairs listed nose to tail (widths
    0 at both ends), wound as loft() wants for rings stacked upwards."""
    zf, zr = table[0][0], table[-1][0]
    zc, hz = (zf + zr) / 2, (zf - zr) / 2

    def width(z):
        for (z0, w0), (z1, w1) in zip(table, table[1:]):
            if z1 <= z <= z0:
                f = (z0 - z) / (z0 - z1) if z0 != z1 else 0
                # rounded between the samples: a quarter-circle blend at the ends
                return w0 + (w1 - w0) * f
        return 0.0
    out = []
    for i in range(n):
        t = 2 * math.pi * i / n
        z = zc - hz * math.sin(t)
        c = math.cos(t)
        w = width(z) * (1 if c >= 0 else -1)
        # ends: keep a little width so the end faces round off instead of pinching
        out.append([w if abs(c) > 1e-6 else 0.0, y, z])
    return out


def flat_ring(cx, cz, r_out, r_in, y0, y1, n=32, mount="turret", mat="paint_dark"):
    """An open ring (a skate rail, a hatch rim): its outer wall, top and inner wall."""
    def circ(r, y):
        return [[cx + r * math.cos(2 * math.pi * i / n), y, cz - r * math.sin(2 * math.pi * i / n)] for i in range(n)]
    return loft([circ(r_out, y0), circ(r_out, y1), circ(r_in, y1), circ(r_in, y0)], mount=mount, mat=mat, crease=60, caps=(False, False))


def section_ring(z, half):
    """A hull's cross-section at z from its right half (x, y) listed bottom centre to top centre,
    mirrored, wound as loft() wants for rings stacked forwards."""
    pts = [(x, y) for x, y in half] + [(-x, y) for x, y in reversed(half[1:-1])]
    return [[x, y, z] for x, y in pts]


# The T-10M's cast turret: its radius from the ring centre every 10 degrees (from straight behind,
# round by the left) at six heights, from the general-view drawing's sections and the reference
# model's.
T10M_POLAR = [
    (1.45, [0.99, 0.99, 1.0, 1.01, 1.02, 1.04, 1.06, 1.09, 1.11, 1.13, 1.16, 1.18, 1.2, 1.22, 1.24, 1.26, 1.27, 1.27, 1.28, 1.27, 1.27, 1.26, 1.24, 1.22, 1.2, 1.18, 1.16, 1.13, 1.11, 1.09, 1.06, 1.04, 1.02, 1.01, 1.0, 0.99]),
    (1.68, [1.43, 1.43, 1.44, 1.46, 1.47, 1.47, 1.47, 1.44, 1.42, 1.38, 1.38, 1.4, 1.43, 1.47, 1.5, 1.54, 1.57, 1.6, 1.6, 1.6, 1.57, 1.54, 1.5, 1.47, 1.43, 1.4, 1.38, 1.38, 1.42, 1.44, 1.47, 1.47, 1.47, 1.46, 1.44, 1.43]),
    (1.82, [1.43, 1.44, 1.44, 1.47, 1.48, 1.48, 1.46, 1.42, 1.37, 1.32, 1.32, 1.34, 1.37, 1.39, 1.42, 1.46, 1.51, 1.62, 1.62, 1.62, 1.51, 1.46, 1.42, 1.39, 1.37, 1.34, 1.32, 1.32, 1.37, 1.42, 1.46, 1.48, 1.48, 1.47, 1.44, 1.44]),
    (1.96, [1.34, 1.35, 1.36, 1.37, 1.37, 1.37, 1.35, 1.3, 1.24, 1.2, 1.2, 1.22, 1.24, 1.25, 1.33, 1.33, 1.48, 1.54, 1.54, 1.54, 1.48, 1.3, 1.3, 1.25, 1.24, 1.22, 1.2, 1.2, 1.24, 1.3, 1.37, 1.38, 1.37, 1.37, 1.37, 1.35]),
    (2.08, [1.23, 1.24, 1.25, 1.25, 1.24, 1.24, 1.22, 1.17, 1.16, 1.06, 1.11, 1.07, 1.08, 1.08, 1.13, 1.18, 1.19, 1.18, 1.19, 1.18, 1.18, 1.15, 1.11, 1.08, 1.07, 1.06, 1.11, 1.06, 1.16, 1.17, 1.28, 1.25, 1.24, 1.25, 1.25, 1.24]),
    (2.18, [1.15, 1.14, 1.14, 1.14, 1.13, 1.12, 1.1, 1.06, 0.99, 0.94, 0.91, 0.99, 0.97, 0.91, 0.92, 0.93, 0.91, 0.89, 0.87, 0.89, 0.91, 0.92, 0.92, 0.91, 0.89, 0.89, 0.9, 0.94, 0.99, 1.06, 1.17, 1.14, 1.13, 1.14, 1.14, 1.14]),
]


def t10m():
    """T-10M with the Oplot-MO, rebuilt from the general-view drawing "Общий вид танка Т-10М
    оснащенного комплексом пулеметной противоракетной защиты по теме НИР «Оплот-МО»": the side
    view gridded at 127.6 px per metre from the ground line, the plan view at the same scale and
    the front view at 126 px per metre (its 3300 mm overall height and 880 mm Oplot-MO height).
    Hull: lofted sections through the pike nose, the overhanging upper sides and the rear plate;
    cast turret: lofted plan sections; seven road wheels at 0.76 m, three return rollers, idler,
    sprocket; the M-62-T2 with its sleeve, bore evacuator and multi-baffle brake."""
    L, W, H, c = 6.90, 3.52, 1.56, 0.46
    pz = 0.45
    piv = (0, H, pz)
    mount = (0, 1.80, 1.55)   # the reference model's gun axis
    muzzle_z = 6.80
    tx = 1.30
    tt = 0.07
    wz = [2.28, 1.52, 0.76, 0.0, -0.76, -1.52, -2.28]
    roof = 2.34

    def mid(yb=0.46):
        return [(0, yb), (0.80, yb), (0.88, max(yb, 0.56)), (0.88, 1.08), (1.30, 1.08), (1.42, 1.50), (1.40, H), (0, H)]

    # Hull, after the reference model's sections: the body lofted between the nose and the rear;
    # the pike nose of two upper plates in one plane each (through the ridge from the roof at
    # z 2.14 to the tip at 3.58, falling to the sides, so the roof's front edge runs back on a
    # diagonal to the hull side at z 1.15), the lower plates rising from the belly to the chine;
    # at the back the upper rear plate sloping 36 degrees from the roof down to y 0.93 with the
    # corners of the overhanging sides cut off, the lower rear plate tucked under it
    ZN, ZR = 1.15, -2.20
    parts = [loft([section_ring(ZR, mid()), section_ring(ZN, mid())], crease=25)]
    r = [(x, y, ZN) for x, y in mid()]
    plane = lambda x, z: H - (0.4085 * x + 0.597 * (z - 2.14)) / 1.651   # the upper plate's height
    zat = lambda x, y: 2.14 + (1.651 * (H - y) - 0.4085 * x) / 0.597       # where it is at (x, y)
    nose = r + [
        (0, H, 2.14), (1.42, 1.50, zat(1.42, 1.50)), (1.30, 1.08, zat(1.30, 1.08)), (0.88, 1.08, zat(0.88, 1.08)),  # 8-11
        (0.89, 0.88, 3.27), (0, 1.04, 3.58), (0.84, 0.48, 2.84), (0, 0.50, 2.98),  # 12-15 chine, tip, belly's front edge
    ]
    nose_faces = [[8, 6, 9, 10, 11, 12, 13], [7, 6, 8], [4, 10, 9, 5], [5, 9, 6], [3, 11, 10, 4], [2, 3, 11, 12, 14],
                  [0, 1, 14, 15], [1, 2, 14], [15, 14, 12, 13], [0, 1, 2, 3, 4, 5, 6, 7]]
    parts.append(mesh_part(nose, nose_faces, (0, 0.9, 1.9)))
    r = [(x, y, ZR) for x, y in mid()]
    rear = r + [
        (0, H, -2.55), (0.95, H, -2.55), (0, 0.93, -3.42), (0.88, 0.93, -3.42),  # 8-11 the upper rear plate
        (0.88, 1.08, -3.21), (1.30, 1.08, -2.60), (1.42, 1.50, -2.30),  # 12-14 its side edge, the cut corner
        (0, 0.50, -3.25), (0.80, 0.50, -3.25), (0.88, 0.56, -3.27),  # 15-17 the belly's rear edge
    ]
    rear_faces = [[7, 6, 9, 8], [8, 9, 12, 11, 10], [6, 14, 13, 12, 9], [4, 13, 14, 5], [5, 14, 6], [3, 12, 13, 4],
                  [2, 3, 12, 11, 17], [0, 15, 16, 1], [1, 16, 17, 2], [15, 10, 11, 17, 16], [0, 1, 2, 3, 4, 5, 6, 7]]
    parts.append(mesh_part(rear, rear_faces, (0, 0.9, -2.6)))
    parts += [
        # track guards along the whole hull and their front ends turned down over the idlers
        box((0.88, 0.022, 6.45), (tx + 0.02, 1.07, -0.18), mirror=True, mat="paint_dark"),
        box((0.80, 0.022, 0.42), (tx + 0.02, 1.01, 3.18), rot=(16, 0, 0), mirror=True, mat="paint_dark"),
        # stowage boxes on the guards (side view): ahead of the turret, three along the side, one
        # by the engine deck and the long louvred one at the rear
        box((0.49, 0.39, 0.42), (1.515, 1.275, 2.61), mirror=True),
        box((0.40, 0.39, 0.40), (1.56, 1.275, 2.19), mirror=True),
        box((0.36, 0.37, 0.57), (1.57, 1.265, 1.115), mirror=True),
        box((0.36, 0.37, 0.61), (1.57, 1.265, 0.405), mirror=True),
        box((0.36, 0.37, 0.57), (1.57, 1.265, -0.485), mirror=True),
        box((0.36, 0.37, 0.59), (1.57, 1.265, -1.635), mirror=True),
        box((0.38, 0.47, 1.13), (1.57, 1.315, -2.815), mirror=True),
    ]
    # the louvred front faces of the front bins (front view)
    for xb in (1.33, 1.46, 1.59, 1.72):
        parts.append(box((0.05, 0.28, 0.012), (xb, 1.275, 2.825), mirror=True, mat="black"))
    for k in range(4):
        parts.append(box((0.012, 0.03, 0.95), (1.765, 1.20 + 0.075 * k, -2.815), mirror=True, mat="black"))
    for zb in (1.115, 0.405, -0.485, -1.635):
        parts.append(box((0.012, 0.05, 0.40), (1.755, 1.33, zb), mirror=True, mat="paint_dark"))
    parts += [
        # front lights on the guard boxes and on the glacis edges, the tow hooks on the nose
        cyl(0.075, 0.08, "z", (0.88, plane(0.88, 2.47) + 0.06, 2.47), mirror=True, mat="paint_dark"),
        cyl(0.055, 0.02, "z", (0.88, plane(0.88, 2.47) + 0.06, 2.52), mirror=True, mat="steel"),
        cyl(0.07, 0.08, "z", (1.62, 1.53, 2.80), mirror=True, mat="paint_dark"),
        box((0.10, 0.12, 0.10), (0.50, 0.86, 3.36), mirror=True, mat="steel"),
        # driver's hatch and periscopes ahead of the turret
        # the driver's periscopes in the top of the glacis, under the gun
        box((0.12, 0.05, 0.06), (0.36, plane(0.36, 2.25) + 0.01, 2.25), rot=(20, 25, 0), mat="black"),
        box((0.12, 0.05, 0.06), (-0.36, plane(0.36, 2.25) + 0.01, 2.25), rot=(20, -25, 0), mat="black"),
        # turret ring guard
        cyl(1.44, 0.05, "y", (0, H + 0.025, pz), mat="paint_dark", segs=40),
        # engine deck: the grilles, the access plates and the exhaust louvres at the rear
        box((2.2, 0.02, 0.95), (0, H + 0.01, -1.55), mat="black"),
        box((2.2, 0.02, 0.32), (0, H + 0.01, -2.36), mat="black"),
        box((0.85, 0.03, 0.65), (0.5, H + 0.016, -2.0), mirror=True, mat="paint_dark"),

        # the external fuel drums across the rear, on their brackets
        cyl(0.22, 0.56, "x", (0.62, 1.30, -3.12), mirror=True, mat="paint_dark", segs=20),
        cyl(0.23, 0.035, "x", (0.62, 1.30, -3.12), mirror=True, mat="steel", segs=20),
        box((0.05, 0.40, 0.30), (0.95, 1.26, -3.06), mirror=True, mat="steel"),
        box((0.05, 0.40, 0.30), (0.29, 1.26, -3.06), mirror=True, mat="steel"),
        # unditching log rails and the rear towing eyes
        box((0.10, 0.12, 0.14), (0.65, 0.80, -3.36), mirror=True, mat="steel"),
    ]
    # the cast turret through its measured sections
    rings = [polar_ring(y, 0.0, pz, r) for y, r in T10M_POLAR]
    rings.append(polar_ring(roof - 0.06, 0.0, pz, T10M_POLAR[-1][1], k=0.88, dz=-0.04))
    rings.append(polar_ring(roof, 0.0, pz, T10M_POLAR[-1][1], k=0.62, dz=-0.10))
    parts.append(loft(rings, mount="turret", crease=40))
    parts += [
        # the gun mask casting with its rounded top, the cast trunk below and around the barrel
        # forward of it, the sleeve tapering to the tube (measured on the reference; all elevate)
        loft([rrect_ring(1.80, 0, 1.90, 0.44, 0.18, p=5), rrect_ring(2.10, 0, 1.89, 0.44, 0.18, p=5)], mount="gun"),
        loft([rrect_ring(2.09, -0.01, 1.84, 0.42, 0.24, p=3), rrect_ring(2.32, -0.01, 1.83, 0.27, 0.20, p=2.6)], mount="gun"),
        cyl(0.19, 0.40, "z", (0, mount[1], 2.50), r2=0.15, mount="gun", segs=24),
        cyl(0.04, 0.06, "z", (0.27, 1.95, 2.11), mount="gun", mat="black"),
        # the M-62-T2: sleeve, tube, bore evacuator, tube, the long multi-baffle brake
        barrel(mount, 2.68, 4.10, 0.105, 0.088),
        barrel(mount, 4.10, 5.30, 0.086, 0.080),
        recoil(cyl(0.122, 0.34, "z", (0, mount[1], 5.47), mount="gun", segs=22)),
        recoil(cyl(0.10, 0.04, "z", (0, mount[1], 5.28), mount="gun", segs=22, r2=0.122)),
        recoil(cyl(0.122, 0.04, "z", (0, mount[1], 5.66), mount="gun", segs=22, r2=0.10)),
        barrel(mount, 5.64, 6.06, 0.080, 0.078),
        recoil(cyl(0.098, 0.74, "z", (0, mount[1], 6.43), mount="gun", mat="paint_dark", segs=22)),
    ]
    for k in range(6):
        parts.append(recoil(cyl(0.118, 0.035, "z", (0, mount[1], 6.12 + 0.13 * k), mount="gun", mat="paint_dark", segs=22)))
    parts += [
        # the sight aperture and the searchlight on the right of the mask, the gunner's periscope
        cyl(0.135, 0.10, "z", (0.62, 1.94, 1.93), mount="turret", mat="paint_dark", segs=20),
        cyl(0.10, 0.02, "z", (0.62, 1.94, 1.99), mount="turret", mat="black", segs=20),
        box((0.20, 0.10, 0.16), (-0.48, roof - 0.01, 1.05), mount="turret", mat="paint_dark"),
        # loader's hatch, the aerial base and whip, lifting eyes
        cyl(0.24, 0.035, "y", (0.48, roof - 0.04, -0.42), mount="turret", mat="paint_dark", segs=22),
        cyl(0.04, 0.10, "y", (-0.804, 2.274, -0.297), mount="turret", mat="paint_dark"),
        cyl(0.007, 0.80, "y", (-0.804, 2.724, -0.297), mount="turret", mat="black", segs=6),
        box((0.05, 0.08, 0.12), (0.932, 2.195, 0.922), mount="turret", mirror=True, mat="paint_dark"),
        # handrails along the turret sides
        cyl(0.014, 0.55, "z", (1.012, 2.168, 0.392), mount="turret", mirror=True, mat="steel", segs=6),
        cyl(0.014, 0.55, "z", (1.326, 1.88, 0.40), mount="turret", mirror=True, mat="steel", segs=6),
        # the tarpaulin roll strapped across the turret rear
        cyl(0.14, 1.05, "x", (0.10, 2.078, -0.947), mount="turret", mat="paint_dark", segs=16),
        cyl(0.145, 0.03, "x", (-0.30, 2.078, -0.947), mount="turret", mat="black", segs=16),
        cyl(0.145, 0.03, "x", (0.50, 2.078, -0.947), mount="turret", mat="black", segs=16),
    ]
    # the commander's cupola with its vision blocks and the sight head (front view)
    parts += cupola(-0.40, roof - 0.04, 0.02, 0.33, 0.12, blocks=8)
    parts += [cyl(0.08, 0.14, "y", (-0.42, roof + 0.185, 0.08), mount="turret", mat="paint_dark"),
              cyl(0.09, 0.06, "z", (-0.42, roof + 0.275, 0.12), mount="turret", mat="steel", segs=18)]
    # ---- the Oplot-MO turret (turret 1, riding on turret 0) and its gun
    # the Oplot-MO is the user's own model (Oplot_MO_Vehicle_Module.glb, used unchanged): its
    # flange on the turret roof, the ring, carriage and drive turning on its yaw pivot, the
    # receiver, ammunition box and sensors elevating on its pitch pivot, the six barrels turning
    # on their spin axis. The model faces -z: it is turned round and set on the roof here.
    op = (0.52, roof - 0.03, 0.12)
    op_mount = (r3(op[0] - 0.018), r3(op[1] + 0.405), r3(op[2] + 0.437))
    reach = 1.135  # trunnion to the muzzle cluster's end (the model's pitch pivot to its muzzles)
    oplot_gun = {"id": "oplot_mo_14_5x6", "caliber_mm": 14.5, "barrel_length_mm": 1350, "recoil_mm": 5, "rounds_per_min": 3000,
                 "reload_s": 0.02, "traverse_deg_s": 60.0, "elevate_deg_s": 40.0, "max_depression_deg": 20.0, "max_elevation_deg": 70.0,
                 "dispersion_mrad": 2.4, "mass_kg": 200,
                 "ammo": ["api_145_b32", "apit_145_bzt44", "apcr_145_bs41"], "ammo_count": [400, 300, 200],
                 "autocannon": {"rate_rpm": 10000, "belt_rounds": 900, "belt_reload_s": 30.0, "spin_up_s": 0.35}}
    # The Oplot-MO as an automatic system (crates/missile ApsDef): a centimetre-wave radar that
    # sees 2 km, the six-barrel 14.5 mm gun at 9,000-11,000 rds/min with 900 rounds, firing
    # inside 200 m and stopping at 20 m; its depression at each bearing from the drawing.
    oplot_aps = {
        "name": "奧普洛特-MO", "turret": 1, "gun_module": "oplot_gun", "radar_module": "oplot_radar",
        "radar_range_m": 2000.0, "radar_rate_hz": 25.0, "radar_elevation_deg": [-10.0, 30.0],
        "angle_noise_mrad": 1.5, "range_noise_m": 1.0, "detect_chance_far": 0.55, "confirm_hits": 3, "drop_after_s": 0.6,
        "min_threat_speed_ms": 40.0, "max_threat_speed_ms": 650.0, "threat_miss_m": 6.0,
        "engage_range_m": 200.0, "stop_range_m": 20.0,
        "rate_rpm": 10000.0, "rate_range_rpm": [9000.0, 11000.0], "rounds": 900, "spin_up_s": 0.35,
        "traverse_deg_s": 180.0, "elevate_deg_s": 120.0, "max_elevation_deg": 70.0,
        "depression_by_bearing_deg": depression_table(OPLOT_DEPRESSION), "max_depression_deg": 20.0,
        "servo_lag_s": 0.06, "dispersion_mrad": 2.0, "fire_window_mrad": 6.0, "barrel_m": reach,
        "bullet_speed_ms": 990.0, "bullet_mass_kg": 0.064, "bullet_caliber_mm": 14.5, "bullet_drag": 0.30, "tracer_every": 3,
        "heat_rounds": 600.0, "cool_per_s": 0.12, "resume_heat": 0.5,
    }
    return {
        "id": "su_t10m", "name": "T-10M (Oplot-MO)", "nation": "ussr", "cls": "heavy", "year": 1962, "outline": "traced",
        "model": "model.json",
        "import": {"glb": UPLOADS + "33925874-Oplot_MO_Vehicle_Module.glb",
                   "source": "Oplot-MO module: the user's own model (Oplot_MO_Vehicle_Module.glb), used unchanged with the user's permission",
                   "mirror_x": False, "rotate_180": True, "offset": [r3(k) for k in op],
                   "turret_nodes": ["FixedMount", "YawPivot"], "gun_nodes": ["PitchPivot"], "barrel_extra_nodes": ["BarrelSpinPivot"],
                   "turret_index_nodes": {"1": ["YawPivot"]}, "normal_maps": False,
                   "textures": {"0": 512, "1": 512, "2": 256, "3": 512, "4": 512}},
        "based_on": "T-10M (Object 272) fitted with the Oplot-MO anti-missile machine-gun complex",
        "notes": "Rebuilt from the general-view drawing of the T-10M with the Oplot-MO (side, plan and front views, gridded at their scales): lofted hull sections and cast turret sections, running gear positions, the M-62-T2 and the Oplot-MO housing as drawn; the coaxial KPVT is removed as the drawing's table lists. The Oplot-MO gun's dip by bearing is from the drawing of its depression limits. Gear ratios are estimates chosen to match the published 50 km/h; the 3BM-11, 3BK-9 and the Oplot-MO's rate of fire are approximate.",
        "L": L, "W": W, "H": H, "clear": c, "body_w": 2.84, "nose_y": 1.05, "mass": 52200, "com": (0, 0.98, 0.1),
        "turret_pos": piv, "turret_size": (2.80, roof - H, 3.0), "ring": 2.16, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        # measured with tools/fitcheck.mjs: the trunk clears the glacis ridge by 4 deg, the engine deck by 2
        "dep_table": [(0, 4), (10, 5), (110, 5), (120, 4), (140, 3.5), (150, 2), (210, 2), (220, 3.5), (240, 4), (250, 5), (350, 5), (360, 4)],
        "armor": {"upper_front": (120, 57, "rha"), "lower_front": (120, 50, "rha"), "side": (80, 15, "rha"), "rear": (60, 0, "rha"),
                  "roof": 40, "floor": 20},
        "turret_armor": {"front": (230, 20, "cha"), "mantlet": (250, 0.86, 0.46, "cha"), "side": (160, 30, "cha"), "rear": (80, "cha"), "roof": 40},
        "gun": {"id": "m62_t2_122", "caliber_mm": 121.92, "barrel_length_mm": 5600, "recoil_mm": 450, "rounds_per_min": 4.0,
                "reload_s": 15.0, "traverse_deg_s": 18.0, "elevate_deg_s": 5.0, "max_depression_deg": 5.0, "max_elevation_deg": 17.0,
                "dispersion_mrad": 0.8, "mass_kg": 2650, "ammo": ["aphe_122_br472"]},
        "sight": {"name": "T2S-29-14", "levels": [{"magnification": 3.1, "fov_deg": 22.0}, {"magnification": 7.9, "fov_deg": 8.5}]},
        "secondary": [],
        "extra_turrets": [{
            "id": "oplot_mo", "parent": 0, "position_m": [r3(k) for k in op], "ring_diameter_m": 0.9, "size_m": [0.9, 0.9, 1.5],
            "traverse_deg_s": 60.0, "facing_deg": 0.0,
            "sight": {"name": "奧普洛特-MO 瞄準具", "levels": [{"magnification": 1.5, "fov_deg": 40.0}, {"magnification": 4.0, "fov_deg": 15.0}]},
            "depression_by_bearing_deg": depression_table(OPLOT_DEPRESSION),
            "guns": [{"gun": oplot_gun, "mount_m": [r3(k) for k in op_mount], "muzzle_offset_m": reach}],
        }],
        "engine": {"horsepower": 750, "max_rpm": 2100, "idle_rpm": 600, "weight_kg": 1020,
                   "torque_curve": [[600, 2200], [1300, 2800], [1700, 2750], [2100, 2540]]},
        "transmission": {"forward_gears": 8, "reverse_gears": 2, "gear_ratios": [12.0, 7.8, 5.4, 3.8, 2.8, 2.0, 1.4, 1.0],
                         "final_drive_ratio": 4.65, "shift_time_s": 0.45},
        "physics": {"track_width_m": 0.72, "track_length_m": 4.84, "suspension": {"travel_m": 0.20, "stiffness": 480000, "damping": 34000},
                    "rolling_resistance": 0.045, "sprocket_radius_m": 0.31, "drivetrain_efficiency": 0.80, "max_brake_decel_ms2": 5.0,
                    "max_turn_rate_deg_s": 22.0, "max_reverse_speed_ms": 2.8, "min_turn_radius_m": 0.0},
        "modules": [
            module("engine", "engine", (0, 0.98, -1.85), (0.55, 0.42, 0.78), 170),
            module("transmission", "transmission", (0, 0.85, -3.0), (0.7, 0.3, 0.28), 130),
            module("fuel_tank_l", "fuel_tank", (-0.95, 0.95, 2.3), (0.3, 0.32, 0.45), 50),
            module("fuel_tank_r", "fuel_tank", (0.95, 0.95, 2.3), (0.3, 0.32, 0.45), 50),
            module("ammo_charges", "ammo_rack", (0, 0.65, 0.4), (0.7, 0.14, 0.6), 70),
            module("ammo_shells", "ammo_rack", (0.0, 2.05, pz - 1.15), (0.7, 0.15, 0.2), 60),
            module("breech", "gun_breech", (0, mount[1], pz + 0.35), (0.24, 0.24, 0.5), 130),
            module("gun_barrel", "gun_barrel", (0, mount[1], 4.6), (0.12, 0.12, 2.0), 160),
            module("turret_drive", "turret_drive", (-0.85, 1.75, pz + 0.4), (0.14, 0.1, 0.16), 80),
            module("vertical_drive", "vertical_drive", (-0.35, 1.80, pz + 0.85), (0.1, 0.1, 0.15), 60),
            module("radio", "radio", (-0.95, 2.0, pz - 0.6), (0.1, 0.12, 0.2), 40),
            # the Oplot-MO on the roof: its gun in the housing, its radar on top
            module("oplot_gun", "aps_gun", (op_mount[0], op_mount[1], op_mount[2] + 0.57), (0.10, 0.10, 0.57), 60),
            module("oplot_radar", "aps_radar", (op_mount[0] + 0.22, op_mount[1] + 0.30, op_mount[2] + 0.19), (0.10, 0.10, 0.08), 25),
        ],
        "aps": oplot_aps,
        "crew": [crew("driver", (0.0, 1.0, 2.40)), crew("gunner", (-0.6, 1.85, pz + 0.5)),
                 crew("commander", (-0.45, 2.05, pz - 0.40)), crew("loader", (0.6, 1.85, pz - 0.2))],
        "palette": {"paint": "#5a6640", "paint_dark": "#434d30"},
        "parts": parts,
        "running_gear": {"track_width": 0.72, "track_thickness": tt, "track_x": tx, "link_pitch": 0.16, "link_style": "center_guide", "track_sag": 0.02,
                         "sprocket": {"z": -3.0, "y": 0.66, "r": 0.31, "teeth": 14}, "idler": {"z": 2.97, "y": 0.72, "r": 0.31},
                         "wheels": wheel_row(wz, 0.28 + tt, 0.28, 0.40),
                         "rollers": [{"z": z, "y": 0.84, "r": 0.14, "w": 0.3} for z in (1.10, -0.42, -1.98)], "wheel_style": "steel_dish"},
    }


# T-54 (1951) sections measured on the three-view drawing (side and plan at 230.6 px per metre
# from the 6.04 m hull, which gives the 3.27 m width and the 2.40 m height to the cupola):
# (height, front, rear, half-width) of the cast dome over its ring.
T54_TURRET = [(1.33, 1.48, -1.18, 1.18), (1.60, 1.70, -1.28, 1.20), (1.80, 1.63, -1.25, 1.16), (1.96, 1.50, -1.16, 1.06),
              (2.08, 1.25, -1.05, 0.94), (2.17, 0.95, -0.95, 0.80), (2.23, 0.45, -0.85, 0.62), (2.27, -0.05, -0.75, 0.40)]


def pzjg1():
    """Panzerjäger I: the 4.7 cm PaK(t) L/43.4 behind a three-sided shield on the Panzer I Ausf. B
    chassis, rebuilt from the four-view drawing (front, rear, plan, side; its scale bar gives
    184 px per metre, the 4.42 m length and 2.06 m width check; heights brought to the published
    2.25 m): front sprocket, five road wheels on the leaf-sprung bogies, four return rollers, the
    raised rear idler, the shield of a front plate and two side wings, the fighting compartment's
    box, the engine deck with its louvres and the wire stowage frame."""
    L, W, H, c = 4.42, 2.06, 1.10, 0.28
    pz = 0.15
    mount = (0, 1.69, 0.40)
    muzzle_z = 2.09
    tx = 0.85
    wz = [1.20, 0.65, 0.10, -0.45, -1.00]

    def sec(b, top):
        return [(0, b), (0.60, b), (0.64, max(b, 0.40)), (0.64, max(b, 1.0)), (1.02, max(b, 1.0)), (1.02, max(top, 1.0)), (0, top)]

    # hull heights from the reference model: the engine deck at 1.25 m, the front deck falling
    # from 1.0 m to the nose
    parts = [loft([section_ring(-2.22, sec(0.72, 1.13)), section_ring(-2.00, sec(0.30, 1.25)), section_ring(-0.60, sec(c, 1.25)),
                   section_ring(-0.55, sec(c, 1.05)), section_ring(1.25, sec(c, 0.97)), section_ring(1.81, sec(0.40, 0.82)),
                   section_ring(2.05, sec(0.72, 0.77))], crease=25)]
    # the shield, measured off the reference model: a narrow front plate, cheeks angled back to
    # the sides, the back ends turned in, all leaning in towards the top; open at the back
    lo = comp_ring(1.37, 0.82, -0.53, 0.88, (0.32, 0.53), (0.26, 0.32))
    hi = comp_ring(2.13, 0.48, -0.43, 0.67, (0.10, 0.21), (0.19, 0.30))
    for i in range(8):
        if i == 2:
            continue
        j = (i + 1) % 8
        a_, b_ = lo[i], lo[j]
        ex, ez = b_[0] - a_[0], b_[2] - a_[2]
        el = math.hypot(ex, ez)
        nx, nz = -ez / el, ex / el
        mx, mz = (a_[0] + b_[0]) / 2, (a_[2] + b_[2]) / 2 - pz
        if nx * (0 - mx) + nz * (0 - mz) < 0:
            nx, nz = -nx, -nz
        parts.append(slab([[a_, b_, hi[j], hi[i]]], (nx * 0.0145, 0, nz * 0.0145), mount="turret", mirror_x=False))
    parts += [
        # the fighting compartment's box under the shield, its vision ports
        prism([(0.82, 1.02), (-0.53, 1.02), (-0.53, 1.37), (0.72, 1.37), (0.82, 1.25)], 1.76),
        box((0.30, 0.10, 0.04), (0.42, 1.28, 0.80), rot=(-40, 0, 0), mirror=True, mat="paint_dark"),
        box((0.03, 0.09, 0.28), (0.885, 1.20, 0.10), mirror=True, mat="paint_dark"),
        # the front: the driver's visor, the headlamps, the tow hooks and the track guards
        box((0.36, 0.10, 0.04), (0.0, 0.95, 1.55), rot=(-70, 0, 0), mat="paint_dark"),
        cyl(0.06, 0.08, "z", (-0.60, 1.05, 1.62), mat="lamp"),
        cyl(0.06, 0.08, "z", (0.60, 1.05, 1.62), mat="lamp"),
        box((0.08, 0.10, 0.08), (0.45, 0.68, 2.08), mirror=True, mat="steel"),
        box((0.40, 0.02, 4.10), (tx + 0.02, 1.0, -0.05), mirror=True, mat="paint_dark"),
        box((0.38, 0.02, 0.45), (tx + 0.02, 0.86, 2.08), rot=(35, 0, 0), mirror=True, mat="paint_dark"),
        # the outside girder over the rear four wheels, the spring of the front wheel
        box((0.05, 0.07, 2.20), (tx + 0.16, 0.58, -0.05), mirror=True, mat="paint_dark"),
        box((0.40, 0.06, 0.06), (tx - 0.03, 0.58, 0.80), mirror=True, mat="paint_dark"),
        box((0.40, 0.06, 0.06), (tx - 0.03, 0.58, -0.90), mirror=True, mat="paint_dark"),
        cyl(0.05, 0.25, "y", (tx - 0.16, 0.68, 1.26), mirror=True, mat="steel", segs=10),
        # the engine deck: hatches, the louvres, the exhaust and silencer, the stowage frame
        box((0.95, 0.025, 0.85), (0.05, 1.262, -1.00), mat="paint_dark"),
        box((0.28, 0.02, 0.40), (-0.36, 1.262, -1.75), mat="black"),
        box((0.28, 0.02, 0.40), (0.40, 1.262, -1.75), mat="black"),
        cyl(0.07, 0.55, "z", (0.85, 1.12, -1.70), mat="steel"),
        box((0.85, 0.22, 0.45), (0.0, 1.36, -1.35), mat="black"),
        box((0.86, 0.23, 0.012), (0.0, 1.36, -1.12), mat="paint_dark"),
        cyl(0.04, 0.10, "y", (0.85, 1.295, -0.757), mat="paint_dark"),
        cyl(0.007, 1.80, "y", (0.85, 2.225, -0.757), mat="black", segs=6),
        # the gun: the mantlet box in the shield's front plate, the cradle, the recuperator over
        # the barrel, the barrel and its muzzle collar
        box((0.30, 0.36, 0.14), (0, mount[1] + 0.05, 0.84), mount="gun", mat="paint_dark"),
        box((0.22, 0.20, 0.70), (0, mount[1] - 0.04, 0.30), mount="gun", mat="paint_dark"),
        cyl(0.045, 0.84, "z", (0, mount[1] + 0.11, 1.00), mount="gun"),
        cyl(0.052, 0.06, "z", (0, mount[1] + 0.11, 1.42), mount="gun", mat="paint_dark"),
        barrel(mount, 0.90, muzzle_z - 0.12, 0.042, 0.036),
        recoil(cyl(0.048, 0.12, "z", (0, mount[1], muzzle_z - 0.06), mount="gun", mat="paint_dark")),
        cyl(0.05, 0.36, "x", (0, mount[1] - 0.02, 0.10), mount="gun", mat="steel"),
    ]
    return {
        "id": "de_pzjg1", "name": "Panzerjäger I", "nation": "germany", "cls": "tank_destroyer", "year": 1940, "outline": "traced",
        "based_on": "Panzerjäger I: 4.7 cm PaK(t) on the Panzer I Ausf. B chassis",
        "notes": "Rebuilt from the four-view drawing supplied with the request (scale bar 184 px/m) and refined against the reference model and photographs (hull heights, the shield's plan and height, the gun and its recuperator, the wheel stations); the gun traverses 17.5 degrees either side behind its fixed shield.",
        "L": L, "W": W, "H": H, "clear": c, "body_w": 1.28, "nose_y": 0.95, "mass": 6400, "com": (0, 0.85, 0.0),
        "turret_pos": (0, H, pz), "turret_size": (1.76, 1.03, 1.36), "ring": 0.9, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "open_top": True, "yaw_limit": [-17.5, 17.5],
        "armor": {"upper_front": (13, 22, "rha"), "lower_front": (13, 25, "rha"), "side": (13, 0, "rha"), "rear": (13, 0, "rha"),
                  "roof": 6, "floor": 5},
        "turret_armor": {"front": (14.5, 30, "rha"), "mantlet": (14.5, 0.36, 0.30, "rha"), "side": (14.5, 5, "rha"), "rear": (6, "rha"), "roof": 6},
        "gun": {"id": "pak36t_47", "caliber_mm": 47.0, "barrel_length_mm": 2040, "recoil_mm": 300, "rounds_per_min": 13.0,
                "reload_s": 4.5, "traverse_deg_s": 12.0, "elevate_deg_s": 6.0, "max_depression_deg": 8.0, "max_elevation_deg": 12.0,
                "dispersion_mrad": 0.9, "mass_kg": 290, "ammo": ["apcbc_47_pak36t"]},
        "sight": {"name": "Sfl.Z.F.", "levels": [{"magnification": 2.5, "fov_deg": 24.0}, {"magnification": 5.0, "fov_deg": 12.0}]},
        "secondary": [],
        "engine": {"horsepower": 100, "max_rpm": 3000, "idle_rpm": 600, "weight_kg": 300,
                   "torque_curve": [[600, 210], [1600, 290], [2400, 280], [3000, 240]]},
        "transmission": {"forward_gears": 5, "reverse_gears": 1, "gear_ratios": [6.5, 3.8, 2.4, 1.5, 1.0],
                         "final_drive_ratio": 5.4, "shift_time_s": 0.5},
        "physics": {"track_width_m": 0.28, "track_length_m": 2.45, "suspension": {"travel_m": 0.12, "stiffness": 70000, "damping": 6000},
                    "rolling_resistance": 0.04, "sprocket_radius_m": 0.26, "drivetrain_efficiency": 0.82, "max_brake_decel_ms2": 6.0,
                    "max_turn_rate_deg_s": 30.0, "max_reverse_speed_ms": 2.0, "min_turn_radius_m": 0.0},
        "modules": [
            module("engine", "engine", (0, 0.72, -1.45), (0.40, 0.25, 0.42), 90),
            module("transmission", "transmission", (0, 0.62, 1.55), (0.35, 0.18, 0.25), 80),
            module("fuel_tank", "fuel_tank", (0.35, 0.72, -0.80), (0.18, 0.20, 0.20), 40),
            module("ammo", "ammo_rack", (-0.42, 0.80, 0.05), (0.16, 0.18, 0.40), 50),
            module("breech", "gun_breech", (0, mount[1], 0.05), (0.10, 0.10, 0.25), 70),
            module("gun_barrel", "gun_barrel", (0, mount[1], 1.45), (0.05, 0.05, 0.60), 70),
            module("radio", "radio", (0.42, 1.0, -0.45), (0.12, 0.08, 0.12), 30),
        ],
        "crew": [crew("driver", (0.0, 0.85, 1.20)), crew("gunner", (-0.30, 1.45, -0.20)), crew("commander", (0.32, 1.45, -0.30))],
        "palette": {"paint": "#6c6a5a", "paint_dark": "#4d4c40"},
        "parts": parts,
        "running_gear": {"track_width": 0.28, "track_thickness": 0.06, "track_x": tx, "link_pitch": 0.09, "link_style": "center_guide", "track_sag": 0.03,
                         "sprocket": {"z": 1.80, "y": 0.62, "r": 0.24, "teeth": 22}, "idler": {"z": -1.78, "y": 0.60, "r": 0.26},
                         "wheels": wheel_row(wz, 0.27 + 0.06, 0.27, 0.20),
                         "rollers": [{"z": z, "y": 0.80, "r": 0.08, "w": 0.16} for z in (0.92, 0.38, -0.18, -0.72)], "wheel_style": "spoked"},
    }


def octa_ring(y, z0, z1, hx, ch, x=0.0):
    """An eight-sided ring (a box with its corners cut by ch) at height y, wound for loft()."""
    pts = [(hx, z1 - ch), (hx, z0 + ch), (hx - ch, z0), (-hx + ch, z0), (-hx, z0 + ch), (-hx, z1 - ch), (-hx + ch, z1), (hx - ch, z1)]
    # loft() wants (cos t, -sin t): start at +x and turn towards -z, as plan_ring() does
    return [[x + px, y, pz] for px, pz in pts]


def comp_ring(y, zf, zr, hx, cf, cr, x=0.0):
    """The plan of an open fighting compartment at height y: sides at +-hx between the front
    (zf) and the back (zr), the front corners cut by cf = (dx, dz) and the back ones by cr; wound
    as octa_ring() (start at +x, front end of the right side, going back)."""
    pts = [(hx, zf - cf[1]), (hx, zr + cr[1]), (hx - cr[0], zr), (-hx + cr[0], zr), (-hx, zr + cr[1]), (-hx, zf - cf[1]),
           (-hx + cf[0], zf), (hx - cf[0], zf)]
    return [[x + px, y, pz] for px, pz in pts]


def flak38t():
    """Flakpanzer 38(t) (Sd.Kfz. 140), rebuilt to the reference model supplied with the request
    (taken as exact): the 38(t) chassis with the engine amidships under the raised deck, the
    front sprocket, four large road wheels, a return roller and the rear idler; at the back the
    open eight-sided fighting compartment overhanging the hull, its lower walls fixed and flaring
    a little, its upper walls eight hinged flaps that fold down outside (key I) to clear the
    gun's arc; in it the 2 cm FlaK 38 on its pedestal (flak38_parts)."""
    L, W, H, c = 5.30, 2.15, 1.40, 0.40
    pz = -1.50
    base_y = 1.445
    tx = 0.905
    wz = [1.70, 0.85, -0.10, -0.94]

    def sec(b, top):
        return [(0, b), (0.66, b), (0.70, max(b, 0.48)), (0.70, max(b, 1.0)), (1.0, max(b, 1.0)), (1.0, max(top, 1.0)), (0, top)]

    parts = [loft([section_ring(-2.16, sec(0.80, 1.02)), section_ring(-1.85, sec(c, 1.02)), section_ring(-0.16, sec(c, 1.02)),
                   section_ring(-0.10, sec(c, H)), section_ring(1.76, sec(c, H)), section_ring(2.44, sec(0.45, 1.12)),
                   section_ring(2.66, sec(0.80, 0.98))], crease=25)]
    # the fighting compartment's fixed lower walls, outside and in, and its floor
    lo = comp_ring(1.00, -0.16, -2.12, 1.03, (0.25, 0.50), (0.30, 0.30))
    hi = comp_ring(1.57, -0.23, -2.63, 1.09, (0.30, 0.60), (0.44, 0.50))
    lo_in = comp_ring(1.00, -0.172, -2.108, 1.018, (0.25, 0.50), (0.30, 0.30))
    hi_in = comp_ring(1.57, -0.242, -2.618, 1.078, (0.30, 0.60), (0.44, 0.50))
    parts.append(loft([lo, hi], crease=25, caps=(False, False)))
    parts.append(loft([list(reversed(r)) for r in (lo_in, hi_in)], mat="paint_dark", crease=25, caps=(False, False)))
    parts.append(box((1.95, 0.03, 1.90), (0, 1.02, -1.15), mat="paint_dark"))
    # the eight upper flaps, each hinged along the top edge of the wall below it
    top = comp_ring(1.92, -0.27, -2.58, 1.05, (0.30, 0.58), (0.42, 0.48))
    for i in range(8):
        j = (i + 1) % 8
        a, b = hi[i], hi[j]
        ex, ez = b[0] - a[0], b[2] - a[2]
        el = math.hypot(ex, ez)
        # inward: the edge's normal turned towards the middle
        nx, nz = -ez / el, ex / el
        mx, mz = (a[0] + b[0]) / 2, (a[2] + b[2]) / 2 + 1.40
        if nx * (0 - mx) + nz * (0 - mz) < 0:
            nx, nz = -nx, -nz
        flap = slab([[a, b, top[j], top[i]]], (nx * 0.010, 0, nz * 0.010), mirror_x=False)
        flap["hinge"] = {"a": [r3(k) for k in a], "b": [r3(k) for k in b], "angle": 168}
        parts.append(flap)
    for k in range(9):
        z = -0.85 - k * 0.15
        parts.append(cyl(0.016, 0.012, "x", (1.086, 1.50, z), mirror=True, mat="steel", segs=6))
    for k in range(10):
        # 20-round magazines standing in the racks
        parts.append(box((0.05, 0.16, 0.09), (0.875, 1.32, -0.75 - k * 0.12), mirror=True, mat="black"))
    parts += [
        # hinges along the flaps' lower edges
        cyl(0.02, 1.0, "z", (1.09, 1.57, -1.33), mirror=True, mat="steel", segs=8),
        # the deck over the engine amidships: louvres, the access hatches; the driver's front
        # plate with the visor, the headlamp, the tow hooks
        box((0.012, 0.22, 1.0), (1.005, 1.20, 0.65), mirror=True, mat="black"),
        box((0.80, 0.03, 0.70), (0, H + 0.015, 0.55), mat="paint_dark"),
        box((0.60, 0.025, 0.40), (0, H + 0.013, -0.20 + 0.40), mat="black"),
        box((0.40, 0.08, 0.04), (0.40, 1.27, 2.12), rot=(-23, 0, 0), mat="paint_dark"),
        box((0.36, 0.035, 0.30), (0.35, H + 0.015, 1.50), mat="paint_dark"),
        cyl(0.06, 0.08, "z", (0.62, 1.12, 2.56), mat="lamp"),
        box((0.08, 0.10, 0.08), (0.48, 0.70, 2.62), mirror=True, mat="steel"),
        cyl(0.04, 0.10, "y", (-0.55, H + 0.05, 0.10), mat="paint_dark"),
        cyl(0.007, 0.9, "y", (-0.55, H + 0.55, 0.10), mat="black", segs=6),
        # the track guards, the silencer under the compartment's overhang, the jerrycans
        box((0.34, 0.02, 4.55), (tx + 0.02, 1.0, 0.25), mirror=True, mat="paint_dark"),
        cyl(0.11, 1.10, "x", (0, 0.86, -2.26), mat="steel", segs=16),
        box((0.14, 0.38, 0.24), (0.86, 1.30, -2.46), rot=(0, 35, 0), mat="paint_dark"),
        # inside: the magazine racks along both walls and across the back, the crew's seats
        box((0.10, 0.24, 1.30), (0.95, 1.24, -1.30), mirror=True, mat="paint_dark"),
        box((0.90, 0.24, 0.10), (0, 1.24, -2.22), mat="paint_dark"),
        box((0.30, 0.05, 0.28), (0.62, 1.30, -0.62), mirror=True, mat="black"),
        # the pedestal's foot
        cyl(0.12, 0.42, "y", (0, 1.23, pz), mat="paint_dark", segs=16),
        cyl(0.25, 0.03, "y", (0, 1.035, pz), mat="paint_dark", segs=18),
    ]
    gun_parts, mount, muzzle_z = flak38_parts(pz, base_y)
    parts += gun_parts
    plates = [
        plate("hull_upper_front", "hull_upper_front", "rha", 15, (0, 1.22, 2.18), (0, 0.92, 0.39), (1, 0, 0), 0.70, 0.45),
        plate("hull_lower_front", "hull_lower_front", "rha", 15, (0, 0.70, 2.55), (0, -0.6, 0.8), (1, 0, 0), 0.70, 0.22),
        plate("hull_side_r", "hull_side", "rha", 15, (1.0, 0.95, 0.40), (1, 0, 0), (0, 0, 1), 1.60, 0.30),
        plate("hull_side_l", "hull_side", "rha", 15, (-1.0, 0.95, 0.40), (-1, 0, 0), (0, 0, 1), 1.60, 0.30),
        plate("hull_rear", "hull_rear", "rha", 10, (0, 0.80, -2.16), (0, 0, -1), (1, 0, 0), 0.70, 0.25),
        plate("hull_roof", "hull_roof", "rha", 8, (0, H, 0.80), (0, 1, 0), (1, 0, 0), 0.70, 0.90),
        plate("hull_floor", "hull_floor", "rha", 8, (0, c, 0.20), (0, -1, 0), (1, 0, 0), 0.60, 2.00),
        plate("comp_side_r", "hull_side", "rha", 10, (1.06, 1.29, -1.25), (1, 0.05, 0), (0, 0, 1), 0.70, 0.29),
        plate("comp_side_l", "hull_side", "rha", 10, (-1.06, 1.29, -1.25), (-1, 0.05, 0), (0, 0, 1), 0.70, 0.29),
        plate("comp_front", "turret_front", "rha", 10, (0, 1.29, -0.19), (0, 0, 1), (1, 0, 0), 0.60, 0.29),
        plate("comp_rear", "turret_rear", "rha", 10, (0, 1.29, -2.38), (0, 0.4, -0.92), (1, 0, 0), 0.62, 0.30),
        plate("flap_side_r", "turret_side", "rha", 10, (1.07, 1.75, -1.25), (0.99, 0.11, 0), (0, 0, 1), 0.70, 0.18),
        plate("flap_side_l", "turret_side", "rha", 10, (-1.07, 1.75, -1.25), (-0.99, 0.11, 0), (0, 0, 1), 0.70, 0.18),
        plate("flap_front", "turret_front", "rha", 10, (0, 1.75, -0.25), (0, 0.11, 0.99), (1, 0, 0), 0.75, 0.18),
        plate("flap_rear", "turret_rear", "rha", 10, (0, 1.75, -2.60), (0, 0.11, -0.99), (1, 0, 0), 0.62, 0.18),
        plate("gun_shield", "gun_mantlet", "rha", 8, (0, base_y + 0.40, pz + 0.75), (0, 0.2, 0.98), (1, 0, 0), 0.55, 0.40),
    ]
    return {
        "id": "de_flakpz38t", "name": "Flakpanzer 38(t)", "own_breech": True, "nation": "germany", "cls": "spaa", "year": 1943, "outline": "traced",
        "based_on": "Flakpanzer 38(t) Ausf. L (Sd.Kfz. 140) with the 2 cm FlaK 38",
        "notes": "Rebuilt to the reference model supplied with the request (hull and compartment proportions, wheel stations, the FlaK 38's layout), cross-checked against the four-view drawing. The upper walls of the compartment are hinged flaps that fold down (key I); the FlaK 38 traverses all round.",
        "L": L, "W": W, "H": H, "clear": c, "mass": 9800, "com": (0, 0.95, -0.20),
        "turret_pos": (0, 1.02, pz), "turret_size": (2.20, 1.30, 2.40), "ring": 0.9, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        # with the flaps raised the gun clears them only about level; folded down (I) it dips fully
        "dep_table": [(0, 1.0), (360, 1.0)],
        "open_top": True, "plates": plates,
        "gun": {"id": "flak38_20", "caliber_mm": 20.0, "barrel_length_mm": 1300, "recoil_mm": 30, "rounds_per_min": 420,
                "reload_s": 0.143, "traverse_deg_s": 40.0, "elevate_deg_s": 30.0, "max_depression_deg": 5.0, "max_elevation_deg": 90.0,
                "dispersion_mrad": 1.4, "mass_kg": 420, "ammo": ["hefi_20_sprgr"],
                "autocannon": {"rate_rpm": 420, "belt_rounds": 20, "belt_reload_s": 3.5}},
        "sight": {"name": "Flakvisier 38", "levels": [{"magnification": 1.0, "fov_deg": 45.0}, {"magnification": 3.0, "fov_deg": 15.0}]},
        "secondary": [],
        "engine": {"horsepower": 150, "max_rpm": 2600, "idle_rpm": 600, "weight_kg": 400,
                   "torque_curve": [[600, 330], [1400, 440], [2000, 430], [2600, 390]]},
        "transmission": {"forward_gears": 5, "reverse_gears": 1, "gear_ratios": [6.8, 3.9, 2.4, 1.5, 1.0],
                         "final_drive_ratio": 5.8, "shift_time_s": 0.5},
        "physics": {"track_width_m": 0.29, "track_length_m": 3.00, "suspension": {"travel_m": 0.14, "stiffness": 100000, "damping": 8000},
                    "rolling_resistance": 0.04, "sprocket_radius_m": 0.26, "drivetrain_efficiency": 0.82, "max_brake_decel_ms2": 6.0,
                    "max_turn_rate_deg_s": 30.0, "max_reverse_speed_ms": 2.0, "min_turn_radius_m": 0.0},
        "modules": [
            module("engine", "engine", (0, 0.85, 0.45), (0.45, 0.30, 0.50), 100),
            module("transmission", "transmission", (0, 0.70, 2.15), (0.40, 0.20, 0.25), 90),
            module("fuel_tank", "fuel_tank", (-0.45, 0.72, -0.70), (0.20, 0.20, 0.25), 45),
            module("ammo_l", "ammo_rack", (-0.80, 1.25, -1.70), (0.12, 0.15, 0.35), 40),
            module("ammo_r", "ammo_rack", (0.80, 1.25, -1.70), (0.12, 0.15, 0.35), 40),
            module("breech", "gun_breech", (0, mount[1], mount[2] - 0.36), (0.07, 0.08, 0.20), 60),
            module("gun_barrel", "gun_barrel", (0, mount[1], mount[2] + 1.20), (0.03, 0.03, 0.55), 60),
            module("radio", "radio", (0.45, 1.15, 1.20), (0.12, 0.10, 0.12), 30),
        ],
        "crew": [crew("driver", (0.35, 0.95, 1.65)), crew("gunner", (0.0, base_y + 0.30, pz - 0.45)),
                 crew("commander", (-0.65, 1.45, -1.05)), crew("loader", (0.65, 1.45, -1.25))],
        "palette": {"paint": "#7c7a62", "paint_dark": "#55543f"},
        "parts": parts,
        "running_gear": {"track_width": 0.29, "track_thickness": 0.06, "track_x": tx, "link_pitch": 0.105, "link_style": "center_guide", "track_sag": 0.03,
                         "sprocket": {"z": 2.36, "y": 0.62, "r": 0.26, "teeth": 19}, "idler": {"z": -1.54, "y": 0.55, "r": 0.25},
                         "wheels": wheel_row(wz, 0.385 + 0.06, 0.385, 0.25),
                         "rollers": [{"z": 0.39, "y": 0.86, "r": 0.08, "w": 0.15}], "wheel_style": "rubber_dish"},
    }


# Jagdpanzer 38(t) Hetzer, from the four-view drawing (122 px per metre: the 4.87 m hull; the
# view marked front at the lower left is the rear): the roof of the casemate at 1.89 m, its sides
# sloping in from the sponsons' edges at +-1.29 m (1.27 m up) to +-0.745 m, the long glacis from
# the nose at 2.45 m to the roof at 0.85 m, the engine deck falling to the rear.
def hz_roof(z):
    if z >= 0.85:
        return 1.89 - (z - 0.85) / 2.39
    if z >= -1.20:
        return 1.89
    return 1.89 - (-1.20 - z) * 0.62 / 1.21


def hz_ring(y, close=False):
    w = 1.29 - (y - 1.27) * 0.879
    zf = 2.33 - (y - 1.27) * 2.39
    zr = -2.41 + (y - 1.27) * 1.95
    ch = 0.45 - (y - 1.27) * 0.40
    return octa_ring(y, zr, zf, w, ch)


def hetzer(variant):
    L, W, c = 4.87, 2.63, 0.40
    tx = 1.15
    wz = [1.24, 0.47, -0.47, -1.35]

    def low(z):
        # the lower hull between the tracks and the sponsons out over them, up to 1.27 m
        belly = 0.40
        if z > 2.20:
            belly = 0.40 + (z - 2.20) / 0.25 * 0.70
        elif z < -2.20:
            belly = 0.40 + (-2.20 - z) / 0.25 * 0.50
        top = min(1.27, hz_roof(z)) if z > 2.0 else 1.27
        return [(0, belly), (0.68, belly), (0.68, max(belly, 1.02)), (1.29, max(belly, 1.02)), (1.29, max(top, 1.03)), (0, max(top, 1.03))]

    parts = [loft([section_ring(z, low(z)) for z in (-2.45, -2.20, 2.20, 2.33, 2.45)], crease=25)]
    open_top = variant == "flak"
    cut = 1.68
    if open_top:
        parts.append(loft([hz_ring(1.27), hz_ring(cut)], crease=25, caps=(False, False)))
        inner = [[[x * 0.975, y, z * 0.985] for x, y, z in hz_ring(yy)] for yy in (1.27, cut)]
        parts.append(loft([list(reversed(r)) for r in inner], mat="paint_dark", crease=25, caps=(False, False)))
        rr = hz_ring(cut)
        parts += [
            # the top edge of the walls, the compartment floor, the engine deck plate at the rear
            box((0.04, 0.03, 3.20), (rr[0][0] - 0.02, cut, -0.10), mirror=True, mat="paint_dark"),
            box((1.30, 0.03, 3.6), (0, 1.12, -0.05), mat="paint_dark"),
            box((1.30, 0.04, 1.05), (0, cut - 0.035, -1.62), mat="paint"),
            box((0.55, 0.01, 0.40), (0, cut - 0.0125, -1.70), mat="black"),
            # the grab handles on the walls (the render's yellow lifting eyes), the ammunition
            box((0.04, 0.16, 0.04), (0.98, 1.60, 0.90), mirror=True, mat="steel"),
            box((0.30, 0.22, 0.40), (0.62, 1.25, -0.80), mat="paint_dark"),
            box((0.30, 0.22, 0.40), (-0.62, 1.25, -0.80), mat="paint_dark"),
        ]
    else:
        parts.append(loft([hz_ring(1.27), hz_ring(1.89)], crease=25))
    parts += [
        # front: the track guards and their sloped front plates, tow shackles, the headlamp
        box((0.36, 0.02, 0.50), (1.13, 1.04, 2.30), rot=(25, 0, 0), mirror=True, mat="paint_dark"),
        box((0.36, 0.02, 0.45), (1.13, 1.02, -2.30), rot=(-25, 0, 0), mirror=True, mat="paint_dark"),
        box((0.10, 0.12, 0.12), (0.45, 0.80, 2.42), mirror=True, mat="steel"),
        cyl(0.05, 0.08, "y", (-0.85, 1.45, 1.75), mat="paint_dark"),
        # the hull's side rails with the tools, the jack and the spare track links on the rear
        cyl(0.012, 3.2, "z", (1.30, 1.22, -0.20), mirror=True, mat="steel", segs=6),
        box((0.06, 0.06, 1.10), (1.31, 1.15, 0.20), mat="paint_dark"),
        cyl(0.07, 0.40, "y", (-1.31, 1.12, -1.20), mat="black"),
        # the exhaust silencer across the rear and its tail pipe, the rear lamp
        cyl(0.12, 0.95, "x", (0.0, 1.12, -2.56), mat="steel", segs=16),
        cyl(0.04, 0.30, "z", (0.55, 1.12, -2.60), mat="black"),
        box((0.10, 0.06, 0.04), (-0.70, 1.28, -2.44), mat="orange"),
    ]
    common = {
        "nation": "germany", "outline": "traced",
        "L": L, "W": W, "clear": c, "body_w": 1.36, "nose_y": 1.10,
        "engine": {"horsepower": 160, "max_rpm": 2600, "idle_rpm": 600, "weight_kg": 420,
                   "torque_curve": [[600, 350], [1400, 470], [2000, 460], [2600, 420]]},
        "transmission": {"forward_gears": 5, "reverse_gears": 1, "gear_ratios": [6.8, 3.9, 2.4, 1.5, 1.0],
                         "final_drive_ratio": 7.0, "shift_time_s": 0.5},
        "physics": {"track_width_m": 0.35, "track_length_m": 2.85, "suspension": {"travel_m": 0.15, "stiffness": 160000, "damping": 12000},
                    "rolling_resistance": 0.04, "sprocket_radius_m": 0.30, "drivetrain_efficiency": 0.82, "max_brake_decel_ms2": 6.0,
                    "max_turn_rate_deg_s": 28.0, "max_reverse_speed_ms": 2.0, "min_turn_radius_m": 0.0},
        "palette": {"paint": "#8a8463", "paint_dark": "#5c5944"},
        "running_gear": {"track_width": 0.35, "track_thickness": 0.06, "track_x": tx, "link_pitch": 0.104, "link_style": "center_guide", "track_sag": 0.03,
                         "sprocket": {"z": 1.98, "y": 0.74, "r": 0.30, "teeth": 19}, "idler": {"z": -2.01, "y": 0.64, "r": 0.27},
                         "wheels": wheel_row(wz, 0.41 + 0.06, 0.41, 0.28),
                         "rollers": [{"z": -0.01, "y": 0.86, "r": 0.09, "w": 0.15}], "wheel_style": "rubber_dish"},
    }
    gl = math.hypot(1.48, 0.62)
    sd = math.hypot(0.545, 0.62)
    rs = math.hypot(1.21, 0.62)
    top = cut if open_top else 1.89
    hv = (top - 1.27) / 2
    sy = 1.27 + hv
    plates = [
        plate("hull_upper_front", "hull_upper_front", "rha", 60, (0, 1.27 + hv, 2.33 - hv * 2.39), (0, 1.48 / gl, 0.62 / gl), (1, 0, 0), 1.0, hv / (0.62 / gl)),
        plate("hull_lower_front", "hull_lower_front", "rha", 60, (0, 0.83, 2.33), (0, -0.414, 0.91), (1, 0, 0), 0.68, 0.30),
        plate("hull_side_r", "hull_side", "rha", 20, (1.29 - hv * 0.879, sy, -0.05), (0.62 / sd, 0.545 / sd, 0), (0, 0, 1), 1.9, hv / (0.62 / sd)),
        plate("hull_side_l", "hull_side", "rha", 20, (-1.29 + hv * 0.879, sy, -0.05), (-0.62 / sd, 0.545 / sd, 0), (0, 0, 1), 1.9, hv / (0.62 / sd)),
        plate("hull_sponson_r", "hull_side", "rha", 20, (1.29, 1.145, 0.0), (1, 0, 0), (0, 0, 1), 2.25, 0.12),
        plate("hull_sponson_l", "hull_side", "rha", 20, (-1.29, 1.145, 0.0), (-1, 0, 0), (0, 0, 1), 2.25, 0.12),
        plate("hull_lower_side_r", "hull_side", "rha", 20, (0.68, 0.71, 0.0), (1, 0, 0), (0, 0, 1), 2.2, 0.30),
        plate("hull_lower_side_l", "hull_side", "rha", 20, (-0.68, 0.71, 0.0), (-1, 0, 0), (0, 0, 1), 2.2, 0.30),
        plate("hull_rear", "hull_rear", "rha", 8, (0, sy, -2.41 + hv * 1.95), (0, 1.21 / rs, -0.62 / rs), (1, 0, 0), 0.85, hv / (0.62 / rs)),
        plate("hull_rear_lower", "hull_rear", "rha", 20, (0, 0.80, -2.36), (0, -0.2, -0.98), (1, 0, 0), 0.68, 0.30),
        plate("hull_floor", "hull_floor", "rha", 10, (0, c, 0), (0, -1, 0), (1, 0, 0), 0.66, 2.0),
    ]
    if not open_top:
        plates.append(plate("hull_roof", "hull_roof", "rha", 8, (0, 1.89, -0.17), (0, 1, 0), (1, 0, 0), 0.72, 1.0))
    if variant == "jagd":
        H = 1.89
        # gun axis 1.44 m up, as on the reference model
        mount = (0.38, 1.44, 1.45)
        muzzle_z = 3.82
        parts += [
            # the gun mount: the cast collar in the glacis, the Saukopf mantlet, the barrel
            box((0.62, 0.52, 0.30), (0.38, 1.47, 1.95), rot=(-28, 0, 0), mount="turret", mat="paint_dark"),
            # the Saukopf through the reference model's sections: round where it sits in the
            # collar, tapering forward and dropping onto the barrel's axis
            loft([rrect_ring(z, 0.386, cy, r, r, n=28, p=2) for z, cy, r in
                  ((1.62, 1.52, 0.31), (1.75, 1.53, 0.30), (1.95, 1.50, 0.23), (2.12, 1.44, 0.175), (2.28, 1.43, 0.14), (2.32, 1.43, 0.10))],
                 mount="gun", crease=60),
            barrel(mount, 2.30, muzzle_z - 0.09, 0.054, 0.047),
            recoil(cyl(0.058, 0.10, "z", (0.38, mount[1], muzzle_z - 0.05), mount="gun", segs=18)),
            # the roof: the loader's hatch (the remote MG's shield turns with it), the commander's scissor
            # periscope and hatch, the driver's periscopes, ventilator, aerial
            box((0.55, 0.03, 0.55), (-0.45, H + 0.015, -0.05), mat="paint_dark"),
            box((0.45, 0.03, 0.45), (0.40, H + 0.015, -0.55), mat="paint_dark"),
            cyl(0.03, 0.22, "y", (0.48, H + 0.11, -0.30), mat="black"),
            box((0.10, 0.06, 0.10), (-0.40, 1.62, 1.45), rot=(-30, 0, 0), mat="black"),
            box((0.10, 0.06, 0.10), (-0.18, 1.62, 1.45), rot=(-30, 0, 0), mat="black"),
            cyl(0.07, 0.06, "y", (0.10, H + 0.03, 0.25), mat="paint_dark"),
            cyl(0.04, 0.10, "y", (-0.65, 1.77, -1.30), mat="paint_dark"),
            cyl(0.007, 1.0, "y", (-0.65, 2.30, -1.30), mat="black", segs=6),
            # the engine deck: the louvred grilles on the rear slope
            box((0.85, 0.02, 0.50), (0, 1.62, -1.75), rot=(27, 0, 0), mat="black"),
        ]
        plates.append(plate("gun_mantlet", "gun_mantlet", "cha", 60, (0.38, 1.52, 2.20), (0, 0, 1), (1, 0, 0), 0.24, 0.22))
        return dict(common, **{
            "id": "de_hetzer", "name": "Jagdpanzer 38(t) Hetzer", "cls": "tank_destroyer", "year": 1944,
            "based_on": "Jagdpanzer 38(t) Hetzer with the 7.5 cm PaK 39 L/48",
            "notes": "Rebuilt from the four-view drawing supplied with the request (122 px per metre): the casemate's measured slopes, the gun offset 0.38 m to the right in the Saukopf mantlet, traverse 5 degrees left and 11 right, the remote MG 34 on the loader's side of the roof.",
            "H": H, "mass": 15750, "com": (0, 0.95, 0.15), "plates": plates,
            "turret_pos": (0.38, 1.27, 1.55), "turret_size": (0.70, 0.62, 1.10), "ring": 0.5, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
            "yaw_limit": [-5.0, 11.0],
            "gun": {"id": "pak39_75_l48", "caliber_mm": 75.0, "barrel_length_mm": 3600, "recoil_mm": 400, "rounds_per_min": 8.0,
                    "reload_s": 7.5, "traverse_deg_s": 6.0, "elevate_deg_s": 4.0, "max_depression_deg": 6.0, "max_elevation_deg": 12.0,
                    "dispersion_mrad": 0.8, "mass_kg": 900, "ammo": ["apcbc_75_pzgr39"]},
            "sight": {"name": "Sfl.Z.F. 1a", "levels": [{"magnification": 5.0, "fov_deg": 8.0}, {"magnification": 10.0, "fov_deg": 4.0}]},
            "secondary": [mg("roof_mg34", "mg34", "pintle", (-0.52, H + 0.106, -0.05), post=0.07, shield=(0.28, 0.22, 0.41))],
            "modules": [
                module("engine", "engine", (0, 0.95, -1.75), (0.45, 0.35, 0.40), 110),
                module("transmission", "transmission", (0, 0.72, 1.90), (0.45, 0.20, 0.22), 100),
                module("fuel_tank_l", "fuel_tank", (-0.48, 0.80, -0.95), (0.18, 0.25, 0.25), 45),
                module("fuel_tank_r", "fuel_tank", (0.48, 0.80, -0.95), (0.18, 0.25, 0.25), 45),
                module("ammo_l", "ammo_rack", (-0.55, 0.85, 0.40), (0.12, 0.25, 0.40), 60),
                module("ammo_r", "ammo_rack", (0.90, 1.12, -0.20), (0.18, 0.10, 0.45), 60),
                module("breech", "gun_breech", (0.38, mount[1], 1.05), (0.15, 0.15, 0.40), 100),
                module("gun_barrel", "gun_barrel", (0.38, mount[1], 3.05), (0.06, 0.06, 0.70), 90),
                module("radio", "radio", (-0.62, 1.42, -0.90), (0.12, 0.10, 0.15), 30),
            ],
            "crew": [crew("driver", (-0.45, 0.95, 1.45)), crew("gunner", (-0.45, 1.15, 0.75)),
                     crew("loader", (-0.40, 1.20, -0.15)), crew("commander", (0.40, 1.25, -0.45))],
            "parts": parts,
        })
    # the 2 cm FlaK 38 on its pedestal in the open compartment (Bergepanzer 38(t) mit 2 cm FlaK)
    pz = -0.25
    parts += [
        cyl(0.18, 0.50, "y", (0, 1.37, pz), mat="paint_dark", segs=16),
        cyl(0.26, 0.03, "y", (0, 1.13, pz), mat="paint_dark", segs=18),
    ]
    fp, mount, muzzle_z = flak38_parts(pz, 1.64)
    parts += fp
    return dict(common, **{
        "id": "de_hetzer_flak", "name": "Hetzer 2 cm FlaK", "own_breech": True, "cls": "spaa", "year": 1945,
        "based_on": "Bergepanzer 38(t) Hetzer with a 2 cm FlaK 38 in the open compartment",
        "notes": "The Hetzer hull of the four-view drawing cut down to the open compartment of the Bergepanzer 38(t), as in the render supplied with the request, with the 2 cm FlaK 38 on its pedestal.",
        "H": cut, "mass": 13800, "com": (0, 0.92, -0.05), "plates": plates, "open_top": True,
        "turret_pos": (0, 1.27, pz), "turret_size": (1.60, 1.10, 2.20), "ring": 0.8, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "gun": {"id": "flak38_20", "caliber_mm": 20.0, "barrel_length_mm": 1300, "recoil_mm": 30, "rounds_per_min": 420,
                "reload_s": 0.143, "traverse_deg_s": 40.0, "elevate_deg_s": 30.0, "max_depression_deg": 5.0, "max_elevation_deg": 90.0,
                "dispersion_mrad": 1.4, "mass_kg": 420, "ammo": ["hefi_20_sprgr"],
                "autocannon": {"rate_rpm": 420, "belt_rounds": 20, "belt_reload_s": 3.5}},
        "sight": {"name": "Flakvisier 38", "levels": [{"magnification": 1.0, "fov_deg": 45.0}, {"magnification": 3.0, "fov_deg": 15.0}]},
        "secondary": [],
        "modules": [
            module("engine", "engine", (0, 0.95, -1.75), (0.45, 0.35, 0.40), 110),
            module("transmission", "transmission", (0, 0.72, 1.90), (0.45, 0.20, 0.22), 100),
            module("fuel_tank_l", "fuel_tank", (-0.48, 0.80, -1.05), (0.18, 0.25, 0.20), 45),
            module("fuel_tank_r", "fuel_tank", (0.48, 0.80, -1.05), (0.18, 0.25, 0.20), 45),
            module("ammo_l", "ammo_rack", (-0.62, 1.25, -0.55), (0.15, 0.11, 0.20), 40),
            module("ammo_r", "ammo_rack", (0.62, 1.25, -0.55), (0.15, 0.11, 0.20), 40),
            module("breech", "gun_breech", (0, mount[1], -0.15), (0.07, 0.08, 0.20), 60),
            module("gun_barrel", "gun_barrel", (0, mount[1], 0.70), (0.03, 0.03, 0.55), 60),
            module("radio", "radio", (0.45, 1.35, 1.20), (0.12, 0.10, 0.12), 30),
        ],
        "crew": [crew("driver", (-0.45, 0.95, 1.45)), crew("gunner", (0.0, 1.45, -0.75)),
                 crew("commander", (-0.55, 1.40, 0.40)), crew("loader", (0.55, 1.40, 0.30))],
        "parts": parts,
    })


def hetzer_jagd():
    return hetzer("jagd")


def hetzer_flak():
    return hetzer("flak")


# The T-54 (1951) cast turret: its radius from the ring centre every 10 degrees (from straight
# behind, round by the left), at six heights; measured off the reference model's sections, the
# fittings (handrails, stowage) standing proud of the casting left out.
T54_POLAR = [
    (1.42, [1.47, 1.51, 1.56, 1.56, 1.55, 1.52, 1.47, 1.41, 1.34, 1.27, 1.22, 1.18, 1.2, 1.22, 1.24, 1.25, 1.26, 1.24, 1.23, 1.25, 1.24, 1.23, 1.2, 1.17, 1.14, 1.13, 1.16, 1.21, 1.28, 1.34, 1.41, 1.47, 1.51, 1.53, 1.53, 1.51]),
    (1.55, [1.47, 1.51, 1.55, 1.55, 1.54, 1.5, 1.45, 1.39, 1.32, 1.25, 1.18, 1.15, 1.16, 1.19, 1.21, 1.21, 1.21, 1.27, 1.27, 1.28, 1.21, 1.19, 1.17, 1.14, 1.11, 1.09, 1.13, 1.19, 1.25, 1.32, 1.39, 1.45, 1.5, 1.53, 1.52, 1.5]),
    (1.70, [1.46, 1.49, 1.52, 1.52, 1.5, 1.45, 1.39, 1.31, 1.24, 1.16, 1.11, 1.08, 1.1, 1.12, 1.14, 1.14, 1.13, 1.2, 1.21, 1.21, 1.14, 1.12, 1.1, 1.07, 1.04, 1.02, 1.05, 1.1, 1.23, 1.25, 1.32, 1.39, 1.45, 1.51, 1.48, 1.48]),
    (1.85, [1.41, 1.43, 1.45, 1.52, 1.52, 1.49, 1.41, 1.34, 1.15, 1.14, 1.08, 1.05, 1.05, 1.01, 1.06, 1.07, 1.01, 1.08, 1.08, 1.09, 1.04, 1.03, 0.98, 1.0, 1.0, 0.99, 1.01, 1.07, 1.09, 1.13, 1.2, 1.28, 1.36, 1.42, 1.42, 1.42]),
    (1.95, [1.32, 1.38, 1.36, 1.35, 1.3, 1.25, 1.19, 1.1, 1.02, 0.94, 0.88, 0.84, 0.84, 0.86, 0.87, 0.88, 0.87, 1.0, 1.0, 1.0, 1.01, 0.87, 0.83, 0.8, 0.78, 0.79, 0.82, 0.88, 0.95, 1.03, 1.1, 1.19, 1.26, 1.33, 1.33, 1.33]),
    (2.02, [1.25, 1.26, 1.28, 1.26, 1.23, 1.21, 1.15, 1.02, 0.92, 0.75, 0.73, 0.6, 0.59, 0.6, 0.65, 0.71, 0.83, 0.88, 0.88, 0.9, 0.88, 0.67, 0.59, 0.55, 0.53, 0.54, 0.65, 0.68, 0.64, 0.82, 1.03, 1.13, 1.17, 1.26, 1.26, 1.26]),
]


def t54():
    """T-54 model 1951, rebuilt from the three-view drawing and refined against the reference
    model and the photographs supplied with the request: the hull's 60-degree glacis running
    full width from the roof (1.40 m) to the nose, the lower nose plate, the sponsons over the
    tracks and the rounded rear; the asymmetric cast turret through its measured sections (the
    left cheek fuller than the right), the canvas-covered mantlet, the commander's cupola on the
    left and the loader's hatch with the DShK ring on the right, the ventilator dome and the
    sight hoods; five road wheels with the wide gap behind the first, the front idler and the rear
    sprocket; the rounded front mudguards, the fender stowage and fuel tanks, the splash board on
    the glacis, the tow hooks, and the two fuel drums on the rear plate."""
    L, W, H, c = 6.04, 3.27, 1.40, 0.42
    pz = 0.17
    piv = (0, H, pz)
    mount = (0, 1.67, 1.10)
    muzzle_z = 5.40
    tx = 1.325
    wz = [1.85, 0.75, -0.08, -0.90, -1.75]
    roof = 2.10

    def sec(b, top):
        # the belly between the tracks, the hull side up to the sponson, the sponson out over
        # the track, its side up to the roof edge
        su = min(1.08, top - 0.02)
        return [(0, b), (1.02, b), (1.05, max(b, min(0.60, su))), (1.05, max(b, su)), (1.50, max(b, su)), (1.50, top - 0.02), (1.47, top), (0, top)]

    hull = loft([
        section_ring(-3.06, sec(0.88, 1.04)), section_ring(-2.96, sec(0.76, 1.24)), section_ring(-2.80, sec(0.62, 1.38)),
        section_ring(-2.60, sec(0.52, 1.42)), section_ring(-2.10, sec(c, 1.42)), section_ring(1.95, sec(c, H)),
        section_ring(2.35, sec(c, 1.15)), section_ring(2.95, sec(0.74, 0.78)),
    ], crease=25)
    fender_front = [(2.30, 1.03), (2.30, 1.065), (2.80, 1.06), (3.00, 0.99), (3.12, 0.87), (3.16, 0.74), (3.11, 0.72),
                    (3.07, 0.85), (2.96, 0.96), (2.78, 1.025)]
    parts = [hull]
    parts += [
        # track guards, the rounded front mudguards, the rear mud flaps
        box((0.62, 0.025, 5.4), (tx + 0.04, 1.05, -0.40), mirror=True, mat="paint_dark"),
        prism(fender_front, 0.62, x=tx + 0.04, mat="paint_dark"),
        prism(fender_front, 0.62, x=-tx - 0.04, mat="paint_dark"),
        box((0.62, 0.30, 0.02), (tx + 0.04, 0.90, -3.10), mirror=True, mat="paint_dark"),
        # right guard: stowage boxes; left guard: boxes, the external fuel tanks
        box((0.48, 0.24, 0.73), (tx + 0.06, 1.19, 1.50), mat="paint_dark"),
        box((0.48, 0.24, 0.49), (tx + 0.06, 1.19, 0.62), mat="paint_dark"),
        box((0.48, 0.26, 0.72), (tx + 0.06, 1.20, -0.55), mat="paint_dark"),
        box((0.48, 0.26, 0.75), (tx + 0.06, 1.20, -1.30), mat="paint_dark"),
        box((0.48, 0.24, 0.73), (-tx - 0.06, 1.19, 1.50), mat="paint_dark"),
        box((0.48, 0.34, 0.95), (-tx - 0.06, 1.21, -0.15), mat="paint_dark"),
        box((0.48, 0.34, 0.80), (-tx - 0.06, 1.21, -1.20), mat="paint_dark"),
        box((0.50, 0.02, 0.04), (-tx - 0.06, 1.385, -0.15), mat="steel"),
        box((0.50, 0.02, 0.04), (-tx - 0.06, 1.385, -1.20), mat="steel"),
        # the stiffeners pressed in the box lids
        box((0.40, 0.01, 0.03), (tx + 0.06, 1.315, 1.50), rot=(0, 35, 0), mat="black"),
        box((0.40, 0.01, 0.03), (tx + 0.06, 1.315, 1.50), rot=(0, -35, 0), mat="black"),
        box((0.40, 0.01, 0.03), (tx + 0.06, 1.335, -0.55), rot=(0, 35, 0), mat="black"),
        box((0.40, 0.01, 0.03), (tx + 0.06, 1.335, -0.55), rot=(0, -35, 0), mat="black"),
        # the glacis: the splash board, the lifting eyes, the headlamp in its guard and the fixed
        # bow MG's port; the driver's hatch and periscopes on the roof at the left
        box((1.60, 0.20, 0.04), (0.10, 1.16, 2.33), rot=(-20, 0, 0), mat="wood"),
        box((0.05, 0.14, 0.10), (0.75, 1.10, 2.40), rot=(-60, 0, 0), mirror=True, mat="paint_dark"),
        cyl(0.09, 0.12, "z", (-0.95, 1.23, 2.24), mat="paint_dark"),
        cyl(0.07, 0.02, "z", (-0.95, 1.23, 2.31), mat="lamp"),
        box((0.22, 0.02, 0.02), (-0.95, 1.32, 2.28), mat="steel"),
        cyl(0.025, 0.08, "z", (0.30, 1.02, 2.62), rot=(-30, 0, 0), mat="black"),
        box((0.52, 0.02, 0.46), (-0.55, H, 1.72), mat="paint_dark"),
        box((0.14, 0.07, 0.07), (-0.43, H + 0.05, 1.98), mat="black"),
        box((0.14, 0.07, 0.07), (-0.67, H + 0.05, 1.98), mat="black"),
        # the nose: the tow hooks and the row of brackets along the nose edge
        box((0.10, 0.16, 0.14), (0.62, 0.76, 2.98), mirror=True, mat="steel"),
        cyl(0.06, 0.12, "x", (0.62, 0.68, 3.04), mirror=True, mat="steel"),
    ]
    for k in range(6):
        parts.append(box((0.08, 0.06, 0.08), (0.18 + 0.27 * k - 0.80, 0.80, 2.96), mat="paint_dark"))
    parts += [
        # the engine deck: louvred grilles, the access plates, the exhaust louvre over the rear
        box((1.75, 0.025, 0.85), (0, 1.43, -1.95), mat="black"),
        box((1.20, 0.02, 0.45), (0, 1.41, -1.10), mat="paint_dark"),
        box((1.60, 0.025, 0.25), (0, 1.40, -2.72), rot=(-25, 0, 0), mat="black"),
        # the rear plate: the transmission access cover, tow hooks, the two fuel drums on their
        # brackets, the smoke pots
        box((0.42, 0.40, 0.03), (0.0, 0.82, -3.02), rot=(15, 0, 0), mat="paint_dark"),
        box((0.10, 0.16, 0.14), (0.62, 0.80, -3.02), mirror=True, mat="steel"),
        cyl(0.29, 0.88, "x", (0.55, 1.28, -3.36), mirror=True, mat="black", segs=20),
        box((0.06, 0.40, 0.40), (0.98, 1.16, -3.25), mirror=True, mat="paint_dark"),
        box((0.06, 0.40, 0.40), (0.12, 1.16, -3.25), mirror=True, mat="paint_dark"),
        cyl(0.10, 0.36, "x", (0.86, 1.02, -3.08), mirror=True, mat="paint_dark", segs=14),
    ]
    # the cast turret through its measured sections, closed by the roof
    rings = [polar_ring(y, 0.0, pz, r) for y, r in T54_POLAR]
    rings.append(polar_ring(2.08, 0.0, pz, T54_POLAR[-1][1], k=0.82, dz=-0.05))
    rings.append(polar_ring(roof, 0.0, pz, T54_POLAR[-1][1], k=0.62, dz=-0.10))
    parts.append(loft(rings, mount="turret", crease=40))
    parts += [
        cyl(1.12, 0.05, "y", (0, H + 0.025, pz), mount="turret", mat="paint_dark", segs=40),
        # the mantlet under its canvas cover, the barrel with its thicker breech end and the
        # muzzle collar, the coaxial MG's port
        cyl(0.24, 0.40, "z", (0, mount[1], 1.52), r2=0.20, mount="gun", mat="canvas", segs=22),
        cyl(0.20, 0.22, "z", (0, mount[1], 1.82), r2=0.12, mount="gun", mat="canvas", segs=20),
        barrel(mount, 1.92, 3.30, 0.085, 0.070),
        barrel(mount, 3.30, muzzle_z - 0.10, 0.068, 0.062),
        recoil(cyl(0.072, 0.10, "z", (0, mount[1], muzzle_z - 0.05), mount="gun", mat="paint", segs=20)),
        cyl(0.03, 0.06, "z", (0.20, mount[1], 1.70), mount="gun", mat="black"),
        # the loader's hatch with the DShK's ring on the right, the commander's cupola on the
        # left (below), the ventilator dome, the two sight hoods
        cyl(0.33, 0.05, "y", (0.42, roof + 0.0, -0.40), mount="turret", mat="paint_dark", segs=24),
        cyl(0.36, 0.04, "y", (0.42, roof - 0.02, -0.40), mount="turret", mat="paint_dark", segs=24),
        cyl(0.20, 0.10, "y", (0.23, roof - 0.03, 0.22), r2=0.12, mount="turret", mat="paint_dark", segs=18),
        box((0.14, 0.10, 0.16), (0.60, roof - 0.05, 0.13), mount="turret", mat="paint_dark"),
        box((0.14, 0.10, 0.16), (-0.62, roof - 0.05, 0.13), mount="turret", mat="paint_dark"),
        box((0.10, 0.04, 0.02), (0.60, roof - 0.03, 0.215), mount="turret", mat="glass"),
        box((0.10, 0.04, 0.02), (-0.62, roof - 0.03, 0.215), mount="turret", mat="glass"),
        # handrails on the sides, the aerial base, stowage on the turret rear
        cyl(0.012, 0.90, "z", (1.10, 1.93, 0.05), mount="turret", mirror=True, mat="steel", segs=6),
        cyl(0.04, 0.10, "y", (-0.83, 2.00, 0.0), mount="turret", mat="paint_dark"),
        cyl(0.007, 0.9, "y", (-0.83, 2.50, 0.0), mount="turret", mat="black", segs=6),
        box((0.70, 0.22, 0.20), (0.0, 1.80, -1.30), mount="turret", mat="paint_dark"),
    ] + cupola(-0.54, roof - 0.03, -0.39, 0.37, 0.14, blocks=5)
    head = {
        "id": "su_t54", "name": "T-54 (1951)", "nation": "ussr", "cls": "medium", "year": 1951, "outline": "traced",
        "based_on": "T-54 model 1951 with 100 mm D-10T",
        "notes": "Rebuilt from the three-view drawing supplied with the request and refined against the reference model and photographs (hull heights and glacis, wheel, idler and sprocket positions, the turret's sections and roof fittings). final_drive_ratio is chosen to match the published top speed; interior layout is an estimate.",
    }
    return dict(head, **{
        "L": L, "W": W, "H": H, "clear": c, "body_w": 2.0, "nose_y": 0.78, "mass": 36000, "com": (0, 0.88, 0.0),
        "turret_pos": piv, "turret_size": (2.60, 0.75, 3.0), "ring": 1.825, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        # the gun clears the engine deck and the fuel drums only level over the rear
        "dep_table": [(0, 5), (110, 5), (140, 0), (220, 0), (250, 5), (360, 5)],
        "armor": {"upper_front": (100, 60, "rha"), "lower_front": (100, 55, "rha"), "side": (79, 0, "rha"), "rear": (60, 17, "rha"),
                  "roof": 30, "floor": 20},
        "turret_armor": {"front": (205, 10, "cha"), "mantlet": (205, 0.60, 0.50, "cha"), "side": (130, 20, "cha"), "rear": (60, "cha"), "roof": 30},
        "gun": {"id": "d10t_100", "caliber_mm": 100.0, "barrel_length_mm": 5350, "recoil_mm": 570, "rounds_per_min": 7.0,
                "reload_s": 8.5, "traverse_deg_s": 10.0, "elevate_deg_s": 4.0, "max_depression_deg": 5.0, "max_elevation_deg": 18.0,
                "dispersion_mrad": 0.8, "mass_kg": 1950, "ammo": ["apbc_100_br412"]},
        "sight": {"name": "TSh-2-22", "levels": [{"magnification": 3.5, "fov_deg": 18.0}, {"magnification": 7.0, "fov_deg": 9.0}]},
        "secondary": [mg("coax_sgmt", "sgmt", "coax", (0.20, mount[1], 1.72)), mg("bow_sgmt", "sgmt", "hull", (0.30, 1.02, 2.66), (2, 2, 2)),
                      mg("aa_dshk", "dshk", "pintle", (0.93, 2.25, -0.40), post=0.29)],
        "engine": dict(V2_520),
        "transmission": {"forward_gears": 5, "reverse_gears": 1, "gear_ratios": [6.0, 2.8, 2.0, 1.43, 0.9],
                         "final_drive_ratio": 5.25, "shift_time_s": 0.45},
        "physics": {"track_width_m": 0.58, "track_length_m": 3.84, "suspension": {"travel_m": 0.20, "stiffness": 300000, "damping": 22000},
                    "rolling_resistance": 0.04, "sprocket_radius_m": 0.32, "drivetrain_efficiency": 0.82, "max_brake_decel_ms2": 6.0,
                    "max_turn_rate_deg_s": 28.0, "max_reverse_speed_ms": 1.9, "min_turn_radius_m": 0.0},
        "modules": [
            module("engine", "engine", (0, 0.90, -1.7), (0.75, 0.36, 0.45), 150),
            module("transmission", "transmission", (0, 0.84, -2.55), (0.6, 0.3, 0.3), 120),
            module("fuel_tank_front", "fuel_tank", (0.52, 0.85, 1.75), (0.3, 0.32, 0.4), 50),
            module("ammo_front", "ammo_rack", (0.52, 0.85, 0.75), (0.3, 0.3, 0.45), 70),
            module("ammo_ready", "ammo_rack", (0.0, 1.62, pz - 0.95), (0.5, 0.12, 0.18), 50),
            module("breech", "gun_breech", (0, mount[1], 0.55), (0.2, 0.2, 0.42), 110),
            module("gun_barrel", "gun_barrel", (0, mount[1], 3.65), (0.09, 0.09, 1.75), 140),
            module("turret_drive", "turret_drive", (-0.78, 1.55, pz + 0.45), (0.12, 0.1, 0.15), 70),
            module("radio", "radio", (-0.85, 1.75, pz - 0.6), (0.1, 0.12, 0.2), 40),
        ],
        "crew": [crew("driver", (-0.55, 0.95, 1.75)), crew("gunner", (-0.5, 1.60, pz + 0.45)),
                 crew("commander", (-0.54, 1.75, pz - 0.50)), crew("loader", (0.5, 1.62, pz + 0.0))],
        "palette": {"paint": "#56604a", "paint_dark": "#434b39", "canvas": "#3f4633"},
        "parts": parts,
        "running_gear": {"track_width": 0.58, "track_thickness": 0.06, "track_x": tx, "link_pitch": 0.137, "link_style": "center_guide", "track_sag": 0.04,
                         "sprocket": {"z": -2.45, "y": 0.69, "r": 0.32, "teeth": 13}, "idler": {"z": 2.64, "y": 0.79, "r": 0.26},
                         "wheels": wheel_row(wz, 0.41 + 0.06, 0.41, 0.34), "rollers": [], "wheel_style": "starfish"},
    })


def cromwell():
    L, W, H, c = 6.35, 2.908, 1.60, 0.41
    piv = (0, H, 0.35)
    mount = (0, 1.98, piv[2] + 0.98)
    muzzle_z = L / 2 + 0.10
    tx = W / 2 - 0.197
    wz = [1.98, 1.02, 0.06, -0.90, -1.86]
    bolts = []
    for z in (0.75, 0.25, -0.25, -0.75):
        for y in (1.80, 2.14):
            bolts.append(cyl(0.055, 0.05, "x", (0.985, y, piv[2] + z), r2=0.03, mirror=True, mount="turret", mat="paint_dark", segs=8))
    for x in (-0.72, 0.72):
        for y in (1.78, 2.16):
            bolts.append(cyl(0.055, 0.05, "z", (x, y, piv[2] + 1.075), r2=0.03, mount="turret", mat="paint_dark", segs=8))
    parts = [
        prism([(-2.95, c), (2.66, c), (3.08, 0.76), (3.08, 0.98), (1.78, 1.06), (-3.10, 1.06), (-3.10, 0.66)], 1.74),
        prism([(-3.12, 1.04), (1.80, 1.04), (1.80, H), (-2.92, H), (-3.12, 1.32)], 2.16),
        # full-length track guards with stowage bins
        box((0.40, 0.03, 6.0), (tx, 1.085, -0.05), mirror=True, mat="paint_dark"),
        box((0.40, 0.03, 0.42), (tx, 1.00, 3.10), rot=(32, 0, 0), mirror=True, mat="paint_dark"),
        box((0.32, 0.26, 1.25), (tx - 0.02, 1.23, 0.55), mirror=True, mat="paint_dark"),
        box((0.32, 0.22, 0.9), (tx - 0.02, 1.21, -1.2), mirror=True, mat="paint_dark"),
        # driver's visor (right), hull MG (left), headlights
        box((0.42, 0.26, 0.07), (0.52, 1.36, 1.83), mat="paint_dark"),
        cyl(0.14, 0.12, "z", (-0.52, 1.34, 1.84), mat="paint_dark"),
        cyl(0.022, 0.34, "z", (-0.52, 1.34, 2.05), mat="steel"),
        cyl(0.08, 0.1, "z", (0.86, 1.30, 1.84), mirror=True, mat="black"),
        # engine deck and rear
        box((1.6, 0.03, 1.6), (0, H + 0.015, -1.9), mat="paint_dark"),
        box((0.6, 0.025, 1.2), (0.62, H + 0.03, -1.9), mirror=True, mat="black"),
        box((1.5, 0.3, 0.08), (0, 1.25, -3.16), mat="paint_dark"),
        # turret: flat-sided box with bolted applique plates
        plan(chamfer_rect(0, piv[2] - 1.20, piv[2] + 1.05, 0.96, 0.16), H, 2.32),
        box((0.56, 0.44, 0.05), (0.0, 1.98, piv[2] + 1.07), mount="turret", mat="black"),
        cyl(0.19, 0.30, "z", (0, 1.98, piv[2] + 1.16), r2=0.15, mount="gun"),
        barrel(mount, piv[2] + 1.30, muzzle_z - 0.24, 0.062, 0.052),
        recoil(cyl(0.085, 0.24, "z", (0, 1.98, muzzle_z - 0.12), mount="gun", mat="paint_dark")),
        recoil(cyl(0.10, 0.05, "z", (0, 1.98, muzzle_z - 0.03), mount="gun", mat="paint_dark")),
        cyl(0.03, 0.22, "z", (0.30, 1.98, piv[2] + 1.16), mount="gun", mat="black"),
        cyl(0.33, 0.14, "y", (-0.30, 2.39, piv[2] - 0.35), mount="turret", segs=20),
        cyl(0.24, 0.03, "y", (-0.30, 2.47, piv[2] - 0.35), mount="turret", mat="paint_dark"),
        box((0.50, 0.035, 0.56), (0.42, 2.335, piv[2] - 0.2), mount="turret", mat="paint_dark"),
        box((1.30, 0.36, 0.36), (0, 2.02, piv[2] - 1.39), mount="turret", mat="paint_dark"),
    ] + bolts
    return {
        "id": "uk_cromwell_iv", "name": "Cromwell Mk IV", "nation": "uk",
        "based_on": "Cruiser Mk VIII Cromwell IV (A27M) with QF 75 mm",
        "notes": "Hull side/rear and turret side/rear armour, turret traverse rate, sight model and gear ratios are estimates; only overall dimensions, front armour, engine and top speed were checked against a source.",
        "L": L, "W": W, "H": H, "clear": c, "body_w": 2.16, "nose_y": 1.05, "mass": 28000, "com": (0, 0.9, 0.0),
        "turret_pos": piv, "turret_size": (1.95, 0.72, 2.3), "ring": 1.52, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "armor": {"upper_front": (64, 0, "rha"), "glacis": (25, 1.2, "rha"), "lower_front": (57, 25, "rha"), "side": (32, 0, "rha"),
                  "rear": (32, 0, "rha"), "roof": 20, "floor": 8},
        "turret_armor": {"front": (76, 0, "rha"), "mantlet": (76, 0.6, 0.46, "rha"), "side": (63, 0, "rha"), "rear": (57, "rha"), "roof": 20},
        "gun": {"id": "qf_75_mk5", "caliber_mm": 75.0, "barrel_length_mm": 2743, "recoil_mm": 290, "rounds_per_min": 12.0,
                "reload_s": 5.0, "traverse_deg_s": 24.0, "elevate_deg_s": 10.0, "max_depression_deg": 12.5, "max_elevation_deg": 20.0,
                "dispersion_mrad": 1.2, "mass_kg": 315, "ammo": ["apcbc_75_m61"]},
        "sight": {"name": "No. 50 x3", "levels": [{"magnification": 3.0, "fov_deg": 13.0}]},
        "dep_table": [(0, 12.5), (145, 12.5), (155, 7), (205, 7), (215, 12.5), (360, 12.5)],
        "cls": "medium", "year": 1944, "outline": "dimensions",
        "secondary": [mg("coax_besa", "besa", "coax", (0.30, 1.98, piv[2] + 1.28)), mg("bow_besa", "besa", "hull", (-0.52, 1.34, 2.22), (15, 8, 17))],
        "engine": {"horsepower": 600, "max_rpm": 2550, "idle_rpm": 600, "weight_kg": 740,
                   "torque_curve": [[600, 1700], [1500, 1966], [2000, 1900], [2550, 1675]]},
        "transmission": {"forward_gears": 5, "reverse_gears": 1, "gear_ratios": [7.5, 3.9, 2.3, 1.5, 1.0],
                         "final_drive_ratio": 4.956, "shift_time_s": 0.35},
        "physics": {"track_width_m": 0.394, "track_length_m": 3.75, "suspension": {"travel_m": 0.25, "stiffness": 200000, "damping": 15000},
                    "rolling_resistance": 0.04, "sprocket_radius_m": 0.33, "drivetrain_efficiency": 0.85, "max_brake_decel_ms2": 6.5,
                    "max_turn_rate_deg_s": 34.0, "max_reverse_speed_ms": 1.0, "min_turn_radius_m": 0.0},
        "modules": [
            module("engine", "engine", (0, 1.0, -1.6), (0.5, 0.42, 0.75), 150),
            module("transmission", "transmission", (0, 0.85, -2.75), (0.5, 0.3, 0.3), 120),
            module("fuel_tank_l", "fuel_tank", (-0.75, 1.0, -1.5), (0.15, 0.3, 0.6), 50),
            module("fuel_tank_r", "fuel_tank", (0.75, 1.0, -1.5), (0.15, 0.3, 0.6), 50),
            module("ammo_rack_l", "ammo_rack", (-0.7, 0.95, 0.3), (0.2, 0.3, 0.6), 60),
            module("ammo_rack_r", "ammo_rack", (0.7, 0.95, 0.3), (0.2, 0.3, 0.6), 60),
            module("breech", "gun_breech", (0, 1.98, 0.95), (0.16, 0.16, 0.35), 100),
            module("gun_barrel", "gun_barrel", (0, 1.98, 2.3), (0.07, 0.07, 0.95), 110),
            module("turret_drive", "turret_drive", (-0.7, 1.75, 1.1), (0.12, 0.1, 0.15), 70),
            module("radio", "radio", (0, 2.0, -0.6), (0.3, 0.15, 0.15), 40),
        ],
        "crew": [crew("driver", (0.5, 1.08, 1.3)), crew("radio_operator", (-0.5, 1.08, 1.3)), crew("gunner", (-0.5, 1.95, 0.85)),
                 crew("commander", (-0.3, 2.05, -0.1)), crew("loader", (0.5, 1.95, 0.4))],
        "palette": {"paint": "#4f5a3c", "paint_dark": "#394229"},
        "parts": parts,
        "running_gear": {"track_width": 0.394, "track_thickness": 0.05, "track_x": r3(tx), "link_pitch": 0.10, "link_style": "center_guide", "track_sag": 0.03,
                         "sprocket": {"z": -2.84, "y": 0.64, "r": 0.33, "teeth": 20}, "idler": {"z": 2.84, "y": 0.58, "r": 0.27},
                         "wheels": wheel_row(wz, 0.40 + 0.05, 0.40, 0.26), "rollers": [], "wheel_style": "rubber_dish"},
    }

# ------------------------------------------------------------------- wheeled vehicles
#
# Armoured cars run on the wheeled-vehicle physics (client/web/src/sim/wheeled): running_gear has
# kind "wheels" and one entry per axle (x = half the tread to the tyre's middle, y = axle height
# at static load, z, tyre r and w, steer: 1 steered, -1 counter-steered rear, 0 fixed; driven).
# Their armour is written plate by plate ("plates") instead of the tank generators above.


def axle(z, y, r, w, x, steer=0, driven=True):
    return {"z": r3(z), "y": r3(y), "r": r3(r), "w": r3(w), "x": r3(x), "steer": steer, "driven": driven}


def wheels_modules(s):
    """The running gear as the damage model sees it: the wheels of each side (a 'track' module:
    shot up, that side drags a ruined tyre)."""
    rg = s["running_gear"]
    x = max(a["x"] for a in rg["axles"])
    zs = [a["z"] for a in rg["axles"]]
    r = rg["axles"][0]["r"]
    w = rg["axles"][0]["w"]
    mid = (max(zs) + min(zs)) / 2
    half = (max(zs) - min(zs)) / 2 + r
    return [module("wheels_l", "track", (-x, r, mid), (w / 2, r, half), 90),
            module("wheels_r", "track", (x, r, mid), (w / 2, r, half), 90)]


def m8():
    # Side profile and plan traced from the Russian three-view drawing of the M8 (1 m scale bar,
    # 206 px/m; ground, axles and the turret ring read off a grid laid over it): the tub between
    # the wheels, the sponsons with their skirts hanging over the centre and rear wheels, the
    # three-plate nose (lower plate near vertical, middle at 60 deg, upper at 45 deg from the
    # vertical), the hull sides leaning in above the fenders, and the round open turret on a 1.45 m
    # ring; axles, tread and clearance from TM 9-743 (front to centre axle 80 in, front to rear
    # 128 in, tread 76 in, 11.5 in under the axles).
    L, W, H, c = 4.78, 2.54, 1.50, 0.48
    tz = -0.02
    piv = (0, H, tz)
    mount = (0, 1.77, 0.50)
    muzzle_z = 2.12
    tread = 1.93 / 2
    zf, zm, zr = 1.55, 1.55 - 2.03, 1.55 - 3.25
    r = 0.47

    def sec(z, yb, tw, ys, skin, yk, skout, yc, rw, yr):
        # bottom centre, the tub's floor and side, the sponson's underside, the skirt, the crease
        # at the fender line and the hull side leaning in to the roof edge
        return section_ring(z, [(0, yb), (tw, yb), (tw, ys), (skin, ys), (skin, yk), (skout, yk), (skout, yc), (rw, yr), (0, yr)])
    hull = loft([
        sec(-2.37, 0.76, 0.60, 1.00, 1.08, 0.74, 1.10, 0.98, 0.80, 1.41),
        sec(-2.22, 0.50, 0.60, 1.02, 1.09, 0.70, 1.12, 0.98, 0.82, 1.42),
        sec(-0.90, 0.48, 0.60, 1.02, 1.09, 0.70, 1.12, 0.98, 0.82, 1.46),
        sec(0.93, 0.48, 0.60, 1.02, 1.09, 0.70, 1.12, 0.98, 0.82, 1.50),
        sec(0.95, 0.48, 0.60, 1.02, 1.09, 1.02, 1.12, 0.98, 0.82, 1.50),
        sec(1.40, 0.48, 0.60, 1.02, 1.09, 1.02, 1.12, 0.98, 0.84, 1.55),
        sec(1.88, 0.48, 0.62, 1.02, 1.04, 1.02, 1.06, 0.98, 0.85, 1.19),
        sec(2.12, 0.52, 0.70, 0.62, 0.86, 0.62, 0.90, 0.92, 0.80, 1.07),
        sec(2.40, 0.74, 0.70, 0.74, 0.74, 0.74, 0.77, 0.86, 0.74, 0.95),
    ], crease=30)
    T = dict(mount="turret")
    G = dict(mount="gun")
    parts = [
        hull,
        # front fenders over the steered wheels, flaring out to 2.54 m
        prism([(0.98, 0.98), (1.06, 1.03), (1.96, 1.03), (2.30, 0.84), (2.22, 0.78), (1.95, 0.98)], 0.20, x=1.17),
        prism([(0.98, 0.98), (1.06, 1.03), (1.96, 1.03), (2.30, 0.84), (2.22, 0.78), (1.95, 0.98)], 0.20, x=-1.17),
        # the stowage boxes in the skirts between the front and centre wheels, the skirt ribs
        box((0.05, 0.30, 0.95), (1.135, 0.84, 0.46), mirror=True, mat="paint_dark"),
        box((0.03, 0.03, 1.85), (1.13, 0.90, -1.30), mirror=True, mat="paint_dark"),
        box((0.03, 0.03, 1.85), (1.13, 0.80, -1.30), mirror=True, mat="paint_dark"),
        # driver's and co-driver's visor hatches on the upper front plate, headlights in guards
        box((0.50, 0.28, 0.05), (0.42, 1.38, 1.62), rot=(-45, 0, 0), mirror=True, mat="paint_dark"),
        box((0.36, 0.05, 0.05), (0.42, 1.33, 1.67), rot=(-45, 0, 0), mirror=True, mat="black"),
        cyl(0.075, 0.08, "z", (0.70, 0.98, 2.30), mirror=True, mat="black"),
        cyl(0.012, 0.22, "y", (0.70, 1.03, 2.39), mirror=True, mat="steel"),
        # tow hooks and the bumper bar, the engine deck grilles, tail lights and lifting rings
        box((1.30, 0.07, 0.07), (0, 0.80, 2.42), mat="steel"),
        cyl(0.05, 0.10, "z", (0.55, 0.70, 2.45), mirror=True, mat="steel"),
        box((0.55, 0.025, 0.60), (0.36, 1.452, -1.55), mirror=True, mat="black"),
        cyl(0.04, 0.05, "z", (0.66, 1.08, -2.39), mirror=True, mat="black"),
        cyl(0.06, 0.03, "x", (0.70, 1.48, -2.30), mirror=True, mat="steel"),
        box((0.08, 0.06, 1.1), (0.0, 0.95, -2.40), rot=(0, 0, 90), mat="steel"),
        # the whip aerial on its base behind the turret
        cyl(0.05, 0.12, "y", (-0.80, 1.52, -0.98), mat="paint_dark"),
        cyl(0.008, 1.10, "y", (-0.80, 2.13, -0.98), mat="black"),
        # the open turret: 19 mm walls sloped in all round, the ring of the .50's skate rail
        plan(superellipse(0, tz, 0.76, 0.76, 0.76, p=2.0, n=36), H, 2.00, scale_top=(0.87, 0.87), origin=(0, tz), hollow=0.04),
        # the .50's skate rail: a ring raised on four posts above the open top
        flat_ring(0, tz, 0.71, 0.67, 2.17, 2.22),
        box((0.04, 0.22, 0.04), (0.47, 2.09, tz + 0.47), mirror=True, mount="turret", mat="paint_dark"),
        box((0.04, 0.22, 0.04), (0.47, 2.09, tz - 0.47), mirror=True, mount="turret", mat="paint_dark"),
        # the 25 mm gun shield, rounded at the top, the 37 mm M6 and the coaxial .30
        box((0.62, 0.30, 0.08), (0, 1.75, 0.82), **G, mat="paint"),
        cyl(0.15, 0.62, "x", (0, 1.88, 0.80), **G),
        box((0.20, 0.20, 0.30), (0, 1.77, 0.70), **G, mat="paint_dark"),
        cyl(0.072, 0.20, "z", (0, 1.77, 0.94), r2=0.06, **G),
        barrel(mount, 1.04, muzzle_z, 0.034, 0.030),
        recoil(cyl(0.040, 0.06, "z", (0, 1.77, muzzle_z - 0.03), **G, mat="paint_dark")),
        cyl(0.018, 0.40, "z", (-0.17, 1.77, 0.98), **G, mat="black"),
        # the 37 mm breech and the gunner's sight inside the turret
        box((0.16, 0.16, 0.42), (0, 1.77, 0.38), **G, mat="steel"),
        cyl(0.03, 0.40, "z", (-0.20, 1.86, 0.55), **G, mat="black"),
    ]
    rg = {"kind": "wheels", "tyre_style": "military",
          "axles": [axle(zf, r, r, 0.24, tread, steer=1), axle(zm, r, r, 0.24, tread), axle(zr, r, r, 0.24, tread)]}
    plates = [
        plate("hull_lower_front", "hull_lower_front", "rha", 15.9, (0, 0.63, 2.26), (0, -0.5, 0.866), (1, 0, 0), 0.72, 0.15),
        plate("hull_middle_front", "hull_upper_front", "rha", 12.7, (0, 1.07, 2.14), (0, 0.866, 0.5), (1, 0, 0), 0.80, 0.28),
        plate("hull_upper_front", "hull_upper_front", "rha", 19.05, (0, 1.37, 1.64), (0, 0.707, 0.707), (1, 0, 0), 0.84, 0.26),
        plate("hull_side_r", "hull_side", "rha", 9.5, (0.97, 1.24, -0.4), (0.866, 0.5, 0), (0, 0, 1), 2.0, 0.30),
        plate("hull_side_l", "hull_side", "rha", 9.5, (-0.97, 1.24, -0.4), (-0.866, 0.5, 0), (0, 0, 1), 2.0, 0.30),
        plate("hull_side_low_r", "hull_side", "rha", 9.5, (1.12, 0.85, -0.65), (1, 0, 0), (0, 0, 1), 1.6, 0.14),
        plate("hull_side_low_l", "hull_side", "rha", 9.5, (-1.12, 0.85, -0.65), (-1, 0, 0), (0, 0, 1), 1.6, 0.14),
        plate("hull_rear", "hull_rear", "rha", 9.5, (0, 1.08, -2.37), (0, 0, -1), (1, 0, 0), 0.95, 0.33),
        plate("hull_roof", "hull_roof", "rha", 6.4, (0, 1.47, -0.5), (0, 1, 0), (1, 0, 0), 0.8, 1.8),
        plate("hull_floor", "hull_floor", "rha", 6.4, (0, c, 0), (0, -1, 0), (1, 0, 0), 0.6, 2.1),
        plate("turret_front", "turret_front", "rha", 19.05, (0, 1.75, tz + 0.71), (0, 0.276, 0.961), (1, 0, 0), 0.55, 0.25),
        plate("gun_shield", "gun_mantlet", "rha", 25.4, (0, 1.77, 0.86), (0, 0, 1), (1, 0, 0), 0.31, 0.15),
        plate("turret_side_r", "turret_side", "rha", 19.05, (0.71, 1.75, tz), (0.966, 0.259, 0), (0, 0, 1), 0.6, 0.25),
        plate("turret_side_l", "turret_side", "rha", 19.05, (-0.71, 1.75, tz), (-0.966, 0.259, 0), (0, 0, 1), 0.6, 0.25),
        plate("turret_rear", "turret_rear", "rha", 19.05, (0, 1.75, tz - 0.71), (0, 0.276, -0.961), (1, 0, 0), 0.55, 0.25),
    ]
    return {
        "id": "us_m8", "name": "M8 Greyhound", "nation": "usa", "cls": "armored_car", "year": 1943, "outline": "traced",
        "based_on": "Light Armored Car M8 (6x6) with the 37 mm gun M6 in the M23A1 open turret",
        "notes": "Hull and turret traced from a Russian three-view drawing with a 1 m scale bar; axles, tread, clearance, armour and the Warner Gear ratios (6.499 / 3.543 / 1.752 / 1.0, reverse 6.987; axle 6.66) from TM 9-743 / TM 9-1743 and afvdatabase.com. Front axle steered, all six wheels driven (the transfer case's front declutch is left engaged). Interior layout and the side profile above the fenders are estimates.",
        "L": L, "W": W, "H": H, "clear": c, "mass": 7440, "com": (0, 0.92, -0.25),
        "turret_pos": piv, "turret_size": (1.52, 0.50, 1.72), "ring": 1.45, "mount": mount, "muzzle_offset": muzzle_z - mount[2], "dep_table": [(0, 10), (20, 10), (30, 9), (40, 10), (320, 10), (330, 9), (340, 10), (360, 10)],
        "open_top": True, "plates": plates,
        "gun": {"id": "m6_37mm", "caliber_mm": 37.0, "barrel_length_mm": 2094, "recoil_mm": 200, "rounds_per_min": 20.0,
                "reload_s": 3.0, "traverse_deg_s": 20.0, "elevate_deg_s": 12.0, "max_depression_deg": 10.0, "max_elevation_deg": 20.0,
                "dispersion_mrad": 0.9, "mass_kg": 87, "ammo": ["apcbc_37_m51"]},
        "sight": {"name": "M70D", "levels": [{"magnification": 3.0, "fov_deg": 12.3}]},
        "secondary": [mg("coax_m1919", "m1919a4", "coax", (-0.17, 1.77, 1.18)), mg("aa_m2", "m2hb", "pintle", (0.0, 2.30, tz - 0.66))],
        "engine": {"horsepower": 110, "max_rpm": 3200, "idle_rpm": 550, "weight_kg": 420,
                   "torque_curve": [[550, 250], [1150, 298], [2200, 285], [3200, 245]]},
        "transmission": {"forward_gears": 4, "reverse_gears": 1, "gear_ratios": [6.499, 3.543, 1.752, 1.0],
                         "final_drive_ratio": 6.66, "shift_time_s": 0.45},
        "physics": {"drive": "wheeled", "track_width_m": 0.24, "track_length_m": 3.25,
                    "suspension": {"kind": "leaf_spring", "travel_m": 0.20}, "suspension_freq_hz": 1.4, "suspension_damping": 0.35,
                    "rolling_resistance": 0.015, "sprocket_radius_m": r, "drivetrain_efficiency": 0.9, "max_brake_decel_ms2": 6.0,
                    "max_turn_rate_deg_s": 30.0, "max_reverse_speed_ms": 4.0, "min_turn_radius_m": 8.0, "max_steer_deg": 30.0},
        "modules": [
            module("engine", "engine", (0, 0.95, -1.75), (0.38, 0.30, 0.42), 120),
            module("transmission", "transmission", (0, 0.78, -1.10), (0.28, 0.2, 0.18), 100),
            module("fuel_tank", "fuel_tank", (0.62, 1.06, -1.30), (0.2, 0.2, 0.32), 45),
            module("ammo_rack_l", "ammo_rack", (-0.78, 0.86, 0.15), (0.14, 0.22, 0.4), 50),
            module("ammo_rack_r", "ammo_rack", (0.78, 0.86, 0.15), (0.14, 0.22, 0.4), 50),
            module("ammo_ready", "ammo_rack", (0.42, 1.58, tz - 0.45), (0.16, 0.08, 0.12), 30),
            module("breech", "gun_breech", (0, 1.77, 0.38), (0.08, 0.08, 0.22), 80),
            module("gun_barrel", "gun_barrel", (0, 1.77, 1.55), (0.04, 0.04, 0.57), 90),
            module("turret_drive", "turret_drive", (0.38, 1.56, tz + 0.3), (0.08, 0.06, 0.08), 50),
            module("radio", "radio", (-0.42, 1.12, -0.70), (0.2, 0.14, 0.12), 40),
        ],
        "crew": [crew("driver", (-0.45, 1.05, 1.05)), crew("radio_operator", (0.45, 1.05, 1.05)),
                 crew("gunner", (-0.34, 1.66, tz + 0.12)), crew("commander", (0.34, 1.68, tz - 0.12))],
        "palette": {"paint": "#545a3a", "paint_dark": "#3c4129"},
        "parts": parts,
        "running_gear": rg,
    }


def puma():
    # Side profile traced from the Imperial War Museum's broadside photograph of a captured
    # Sd.Kfz. 234/2 (Wikimedia Commons "Sd.Kfz 234-2 side view.jpg", 141 px/m, ground at 430 px):
    # axles at +2.11 / +0.72 / -0.76 / -2.12 m, 1.08 m tyres, nose 1.17 m up, roof 1.79 m, turret
    # roof 2.32 m, bore 2.04 m; widths and armour from published data (hull 2.36 m wide; 30 mm
    # front, 8 mm sides, turret 30 mm front at 20 deg and 10 mm sides at 25 deg).
    L, W, H, c = 5.88, 2.36, 1.79, 0.40
    tz = 0.58
    piv = (0, H, tz)
    mount = (0, 2.09, 1.20)
    muzzle_z = 3.70
    tread = 1.95 / 2
    r = 0.52
    tur = [[-0.50, tz + 0.87], [0.50, tz + 0.87], [0.80, tz + 0.30], [0.74, tz - 0.62], [0.55, tz - 0.87],
           [-0.55, tz - 0.87], [-0.74, tz - 0.62], [-0.80, tz + 0.30]]
    parts = [
        # the boat hull: lower part with its sides flaring out, upper part with them leaning in
        prism([(-2.60, c), (2.45, c), (2.94, 1.10), (2.94, 1.17), (-2.94, 1.06), (-2.94, 0.92)], 1.30, wt=2.10),
        prism([(-2.94, 1.06), (2.94, 1.17), (1.92, 1.56), (1.92, H), (-0.35, H), (-0.45, 1.56), (-2.40, 1.56), (-2.91, 1.30)], 2.10, wt=1.62),
        # long stowage bins along both sides and the wheel arches' lips
        box((0.16, 0.36, 3.6), (1.06, 1.24, -0.05), mirror=True, mat="paint_dark"),
        box((0.20, 0.04, 1.1), (1.0, 1.08, 1.42), mirror=True),
        box((0.20, 0.04, 1.1), (1.0, 1.08, -1.45), mirror=True),
        # driver's visor and the rear driver's, headlights, the nose tow bracket
        box((0.50, 0.12, 0.05), (-0.38, 1.70, 1.94), mat="black"),
        cyl(0.07, 0.08, "z", (0.72, 1.24, 2.70), mirror=True, mat="black"),
        box((0.40, 0.06, 0.16), (0, 1.015, 2.975), mat="steel"),
        # engine deck grilles and mufflers
        box((1.20, 0.03, 1.40), (0, 1.575, -1.55), mat="black"),
        cyl(0.11, 0.70, "x", (0, 1.22, -2.96), mat="paint_dark"),
        # the closed turret, the Saukopf mantlet and the 5 cm KwK 39/1 L/60
        plan(tur, H, 2.32, scale_top=(0.86, 0.9), origin=(0, tz)),
        cyl(0.235, 0.42, "z", (0, 2.09, tz + 1.08), r2=0.12, mount="gun"),
        barrel(mount, tz + 1.28, muzzle_z - 0.16, 0.052, 0.045),
        recoil(cyl(0.075, 0.18, "z", (0, 2.09, muzzle_z - 0.09), mount="gun", mat="paint_dark")),
        recoil(cyl(0.085, 0.04, "z", (0, 2.09, muzzle_z - 0.15), mount="gun", mat="paint_dark")),
        cyl(0.02, 0.30, "z", (0.20, 2.09, tz + 1.05), mount="gun", mat="black"),
        # smoke dischargers on the turret front corners, the commander's periscopes
        cyl(0.045, 0.22, "z", (0.52, 2.22, tz + 0.72), rot=(-35, 0, 0), mirror=True, mount="turret", mat="paint_dark"),
        cyl(0.045, 0.22, "z", (0.60, 2.22, tz + 0.66), rot=(-35, 0, 0), mirror=True, mount="turret", mat="paint_dark"),
        cyl(0.045, 0.22, "z", (0.68, 2.22, tz + 0.60), rot=(-35, 0, 0), mirror=True, mount="turret", mat="paint_dark"),
        box((0.22, 0.08, 0.14), (0.30, 2.36, tz - 0.20), mount="turret", mat="paint_dark"),
    ]
    rg = {"kind": "wheels", "tyre_style": "military",
          "axles": [axle(2.11, r, r, 0.27, tread, steer=1), axle(0.72, r, r, 0.27, tread, steer=1),
                    axle(-0.76, r, r, 0.27, tread, steer=-1), axle(-2.12, r, r, 0.27, tread, steer=-1)]}
    plates = [
        plate("hull_upper_front", "hull_upper_front", "rha", 30, (0, 1.365, 2.43), (0, 0.934, 0.357), (1, 0, 0), 0.92, 0.55),
        plate("hull_lower_front", "hull_lower_front", "rha", 30, (0, 0.785, 2.695), (0, -0.843, 0.537), (1, 0, 0), 0.75, 0.46),
        plate("hull_driver_plate", "hull_upper_front", "rha", 15, (0, 1.675, 1.92), (0, 0.5, 0.866), (1, 0, 0), 0.8, 0.12),
        plate("hull_side_r", "hull_side", "rha", 8, (0.93, 1.38, 0), (0.819, 0.574, 0), (0, 0, 1), 2.55, 0.24),
        plate("hull_side_l", "hull_side", "rha", 8, (-0.93, 1.38, 0), (-0.819, 0.574, 0), (0, 0, 1), 2.55, 0.24),
        plate("hull_side_low_r", "hull_side", "rha", 8, (0.85, 0.76, 0), (0.866, -0.5, 0), (0, 0, 1), 2.45, 0.40),
        plate("hull_side_low_l", "hull_side", "rha", 8, (-0.85, 0.76, 0), (-0.866, -0.5, 0), (0, 0, 1), 2.45, 0.40),
        plate("hull_rear", "hull_rear", "rha", 10, (0, 1.17, -2.92), (0, 0.3, -0.954), (1, 0, 0), 0.9, 0.3),
        plate("hull_roof", "hull_roof", "rha", 10, (0, H, 0.78), (0, 1, 0), (1, 0, 0), 0.8, 1.12),
        plate("hull_deck", "hull_roof", "rha", 5, (0, 1.56, -1.4), (0, 1, 0), (1, 0, 0), 0.82, 1.0),
        plate("hull_floor", "hull_floor", "rha", 5, (0, c, 0), (0, -1, 0), (1, 0, 0), 0.62, 2.5),
        plate("turret_front", "turret_front", "rha", 30, (0, 2.08, tz + 0.85), (0, 0.342, 0.94), (1, 0, 0), 0.5, 0.27),
        plate("gun_mantlet", "gun_mantlet", "rha", 40, (0, 2.09, tz + 1.12), (0, 0, 1), (1, 0, 0), 0.26, 0.26),
        plate("turret_side_r", "turret_side", "rha", 10, (0.72, 2.06, tz - 0.15), (0.906, 0.423, 0), (0, 0, 1), 0.72, 0.29),
        plate("turret_side_l", "turret_side", "rha", 10, (-0.72, 2.06, tz - 0.15), (-0.906, 0.423, 0), (0, 0, 1), 0.72, 0.29),
        plate("turret_rear", "turret_rear", "rha", 10, (0, 2.06, tz - 0.85), (0, 0.3, -0.954), (1, 0, 0), 0.55, 0.27),
        plate("turret_roof", "turret_roof", "rha", 10, (0, 2.32, tz), (0, 1, 0), (1, 0, 0), 0.55, 0.7),
    ]
    return {
        "id": "de_sdkfz234_2", "name": "Sd.Kfz. 234/2 Puma", "nation": "germany", "cls": "armored_car", "year": 1944, "outline": "traced",
        "based_on": "Schwerer Panzerspähwagen (5 cm) Sd.Kfz. 234/2 'Puma', 8x8, with the 5 cm KwK 39/1 L/60",
        "notes": "Side profile and axle positions traced from the IWM broadside photograph (public domain, Wikimedia Commons). Tatra 103 V12 diesel 210 hp; six gears forward and six reverse (a second driver at the rear), eight-wheel drive and eight-wheel steering (front pair one way, rear pair the other). Gear ratios are chosen to match the published 90 km/h; interior layout is an estimate.",
        "L": L, "W": W, "H": H, "clear": c, "mass": 11500, "com": (0, 1.05, -0.1),
        "turret_pos": piv, "turret_size": (1.60, 0.53, 2.30), "ring": 1.45, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "plates": plates,
        "gun": {"id": "kwk39_1", "caliber_mm": 50.0, "barrel_length_mm": 3000, "recoil_mm": 330, "rounds_per_min": 15.0,
                "reload_s": 4.0, "traverse_deg_s": 16.0, "elevate_deg_s": 8.0, "max_depression_deg": 10.0, "max_elevation_deg": 20.0,
                "dispersion_mrad": 0.9, "mass_kg": 400, "ammo": ["apc_50_pzgr39"]},
        "sight": {"name": "TZF 4b", "levels": [{"magnification": 2.4, "fov_deg": 25.0}]},
        "secondary": [mg("coax_mg42", "mg42", "coax", (0.20, 2.09, tz + 1.25))],
        "engine": {"horsepower": 210, "max_rpm": 2250, "idle_rpm": 600, "weight_kg": 900,
                   "torque_curve": [[600, 600], [1500, 790], [1900, 740], [2250, 665]]},
        "transmission": {"forward_gears": 6, "reverse_gears": 6, "gear_ratios": [8.2, 5.4, 3.6, 2.4, 1.55, 1.0],
                         "final_drive_ratio": 4.9, "shift_time_s": 0.4},
        "physics": {"drive": "wheeled", "track_width_m": 0.27, "track_length_m": 4.23,
                    "suspension": {"kind": "leaf_spring", "travel_m": 0.22}, "suspension_freq_hz": 1.3, "suspension_damping": 0.35,
                    "rolling_resistance": 0.015, "sprocket_radius_m": r, "drivetrain_efficiency": 0.9, "max_brake_decel_ms2": 6.0,
                    "max_turn_rate_deg_s": 30.0, "max_reverse_speed_ms": 20.0, "min_turn_radius_m": 6.5, "max_steer_deg": 28.0},
        "modules": [
            module("engine", "engine", (0, 1.0, -1.85), (0.55, 0.35, 0.6), 140),
            module("transmission", "transmission", (0, 0.72, -0.95), (0.4, 0.22, 0.25), 110),
            module("fuel_tank_l", "fuel_tank", (-0.62, 1.12, -0.95), (0.18, 0.22, 0.25), 45),
            module("fuel_tank_r", "fuel_tank", (0.62, 1.12, -0.95), (0.18, 0.22, 0.25), 45),
            module("ammo_rack_l", "ammo_rack", (-0.62, 1.1, 0.5), (0.16, 0.25, 0.45), 55),
            module("ammo_rack_r", "ammo_rack", (0.62, 1.1, 0.5), (0.16, 0.25, 0.45), 55),
            module("breech", "gun_breech", (0, 2.09, 0.62), (0.12, 0.12, 0.3), 90),
            module("gun_barrel", "gun_barrel", (0, 2.09, 2.7), (0.05, 0.05, 1.0), 100),
            module("turret_drive", "turret_drive", (-0.45, 1.95, 0.85), (0.1, 0.08, 0.1), 60),
            module("radio", "radio", (0.4, 1.95, tz - 0.6), (0.2, 0.12, 0.12), 40),
        ],
        "crew": [crew("driver", (-0.38, 1.25, 1.55)), crew("radio_operator", (0.38, 1.25, -0.3)),
                 crew("gunner", (-0.35, 1.98, 0.85)), crew("commander", (0.35, 2.02, 0.40))],
        "palette": {"paint": "#857a52", "paint_dark": "#5d553a"},
        "parts": parts,
        "running_gear": rg,
    }



# The 4x4 test vehicles, rebuilt from the four-view render supplied with the request (side, plan,
# front and rear; side and plan at 152 px per metre from 1.18 m tyres, heights from the side
# view; the front view's widths scaled so the hull is 2.55 m across, the render's views not quite
# agreeing with each other): wheelbase 3.40 m, the hull a long box whose sides fold in above a
# crease at 1.05 m, a long shallow glacis from the roof at 2.13 m to a 1.32 m nose, wheel arches,
# the driver's glazed cab on the glacis, the turret a long six-sided box on a wide ring, its front
# folding to a narrow face. Two variants: the 35 mm Oerlikon KDA in the Gepard's gun housing on
# the turret's right side (the gun pod and barrel taken from the Gepard model supplied, see
# tools/glb_parts.py), and a 78 mm low-recoil gun firing fin-stabilised sabot from the turret front.
W4_ZF, W4_ZR, W4_R = 1.69, -1.71, 0.59
W4_TRACK = 0.95
W4_TZ = -0.30


def w4_roof(z):
    return 2.0 + 0.13 * (z + 3.19) / 3.74 if z <= 0.55 else 2.13 - (z - 0.55) * 0.81 / 2.52


def w4_section(z):
    """The hull's half-section at z (bottom centre to top centre), its wheel arch cut in."""
    # the belly: the rear plate's lower bevel, the flat floor, the nose's lower plate
    if z < -3.0:
        belly = 1.05 + (0.79 - 1.05) * (z + 3.19) / 0.19
    elif z < -2.9:
        belly = 0.79 + (0.72 - 0.79) * (z + 3.0) / 0.1
    elif z <= 2.85:
        belly = 0.72
    else:
        belly = 0.72 + (z - 2.85) / 0.27 * 0.23
    crease_w = 1.28 if z <= 2.6 else 1.28 - (z - 2.6) / 0.52 * 0.23
    roof = w4_roof(z)
    roof_w = min(1.10, crease_w - 0.15)
    # the arch round each wheel: 0.68 m round the axle
    a = 0.75
    for zc in (W4_ZF, W4_ZR):
        d = abs(z - zc)
        if d < 0.68:
            a = max(a, W4_R + math.sqrt(0.68 ** 2 - d * d))
    a = min(a, 1.27)
    low_x = 1.18 + 0.10 * min(1.0, (a - 0.75) / 0.30)
    crease_y = max(1.05, a + 0.02)
    return [(0, belly), (0.64, belly), (0.66, max(belly, a)), (low_x, max(belly, a)), (crease_w, crease_y), (roof_w + 0.03, roof - 0.03), (roof_w, roof), (0, roof)]


def w4_turret_section(z):
    # (rear .. nose) width, bottom, top from the side and plan views
    pts = [(-2.55, 0.55, 2.52, 2.96), (-1.40, 0.80, 2.42, 3.02), (-0.05, 0.88, 2.30, 3.09), (0.35, 0.88, 2.36, 3.12),
           (0.62, 0.62, 2.43, 2.98), (0.86, 0.34, 2.50, 2.80)]
    for (z0, w0, b0, t0), (z1, w1, b1, t1) in zip(pts, pts[1:]):
        if z0 <= z <= z1:
            f = (z - z0) / (z1 - z0)
            w, b, t = w0 + (w1 - w0) * f, b0 + (b1 - b0) * f, t0 + (t1 - t0) * f
            m = b + 0.40 * (t - b)
            return [(0, b), (w * 0.84, b), (w, m), (w * 0.66, t), (0, t)]
    raise ValueError(z)


def w4x4(variant):
    L, W, H, c = 6.30, 2.55, 2.06, 0.72
    piv = (0, H, W4_TZ)
    zs = [-3.19, -3.0, -2.9] + [W4_ZR + 0.70 * k / 4 for k in range(-4, 5)] + [-0.6, 0.55] + [W4_ZF + 0.70 * k / 4 for k in range(-4, 5)] + [2.6, 2.85, 3.0, 3.12]
    hull = loft([section_ring(z, w4_section(z)) for z in sorted(set(round(z, 3) for z in zs))], crease=28)
    parts = [hull]
    tz = [-2.55, -1.40, -0.05, 0.35, 0.62, 0.86]
    parts.append(loft([section_ring(z, w4_turret_section(z)) for z in tz], mount="turret", crease=28))
    parts += [
        # chassis rails, axles and differentials, the transfer case and the exhaust under the hull
        box((0.90, 0.16, 5.0), (0, 0.66, -0.15), mat="black"),
        cyl(0.075, 1.50, "x", (0, W4_R, W4_ZF), mat="black"),
        cyl(0.075, 1.50, "x", (0, W4_R, W4_ZR), mat="black"),
        cyl(0.17, 0.30, "x", (0.05, W4_R, W4_ZF), mat="black"),
        cyl(0.17, 0.30, "x", (0.05, W4_R, W4_ZR), mat="black"),
        box((0.30, 0.22, 0.40), (0, 0.62, 0.05), mat="black"),
        cyl(0.04, 3.2, "z", (-0.30, 0.62, 0.0), mat="black"),
        # the turret ring under the turret
        cyl(0.95, 0.24, "y", (0, 2.20, W4_TZ), mat="paint_dark", segs=36),
        # the driver's glazed cab on the glacis: frame, windscreen, side windows, roof
        prism([(0.95, 1.99), (2.05, 1.65), (2.05, 1.98), (1.62, 2.34), (0.95, 2.34)], 1.24, wt=1.18),
        box((1.10, 0.36, 0.02), (0, 2.16, 1.84), rot=(-50, 0, 0), mat="glass"),
        box((0.02, 0.24, 0.52), (0.611, 2.17, 1.30), mat="glass", mirror=True),
        box((0.03, 0.40, 0.03), (0, 2.16, 1.85), rot=(-50, 0, 0), mat="paint_dark"),
        cyl(0.012, 0.32, "x", (0.30, 2.06, 2.03), rot=(0, 0, 70), mat="black"),
        cyl(0.012, 0.32, "x", (-0.30, 2.06, 2.03), rot=(0, 0, -70), mat="black"),
        # mirrors and their arms by the cab
        box((0.02, 0.12, 0.09), (0.72, 2.30, 1.92), mirror=True, mat="black"),
        cyl(0.01, 0.30, "y", (0.70, 2.12, 1.90), mirror=True, mat="steel"),
        cyl(0.01, 0.13, "x", (0.645, 2.00, 1.90), mirror=True, mat="steel"),
        # nose: the radiator grille, headlamps in their guards, indicators, tow eyes and shackles
        box((1.10, 0.30, 0.03), (0, 1.05, 3.115), mat="black"),
        box((0.30, 0.24, 0.10), (0.86, 1.06, 3.08), mirror=True, mat="steel"),
        cyl(0.075, 0.05, "z", (0.82, 1.08, 3.13), mirror=True, mat="lamp"),
        cyl(0.04, 0.04, "z", (0.96, 0.99, 3.13), mirror=True, mat="lamp"),
        box((0.06, 0.05, 0.03), (0.98, 1.16, 3.13), mirror=True, mat="orange"),
        box((0.10, 0.10, 0.10), (0.55, 0.84, 3.10), mirror=True, mat="steel"),
        cyl(0.012, 0.85, "y", (1.15, 1.47, 2.915), mirror=True, mat="lamp"),
        # marker lights along the sides
        box((0.02, 0.05, 0.14), (1.226, 1.238, 2.67), mirror=True, mat="orange"),
        box((0.02, 0.05, 0.14), (1.276, 1.158, 0.103), mirror=True, mat="orange"),
        box((0.02, 0.05, 0.14), (1.262, 1.229, -2.926), mirror=True, mat="orange"),
        # roof: the louvres by the cab, the hatches and the grilles of the rear deck
        box((0.16, 0.02, 0.95), (1.05, w4_roof(1.35) + 0.01, 1.35), rot=(-18, 0, 0), mirror=True, mat="black"),
        box((0.52, 0.02, 1.05), (-0.86, 2.02, -2.60), mat="black"),
        box((0.55, 0.03, 0.60), (0.55, 2.03, -2.55), mat="paint_dark"),
        box((0.40, 0.03, 0.30), (0.45, 2.10, -0.95), mat="paint_dark"),
        cyl(0.07, 0.10, "y", (-0.70, 2.10, -1.95), mat="paint_dark"),
        # the rear: the engine grille, the lights, the tow shackles and the jerrycan rack
        box((1.05, 0.38, 0.03), (0, 1.12, -3.205), mat="black"),
        box((0.20, 0.10, 0.03), (0.95, 1.05, -3.205), mirror=True, mat="orange"),
        box((0.08, 0.10, 0.031), (0.88, 1.05, -3.21), mirror=True, mat="lamp"),
        box((0.10, 0.10, 0.10), (0.578, 0.884, -3.166), mirror=True, mat="steel"),
        box((1.20, 0.65, 0.04), (0, 1.40, -3.195), mat="paint"),
        # the turret's roof: the hatches with their handles, the round sight head, the aerial
        box((0.60, 0.03, 0.55), (0, 3.08, -0.80), mount="turret", mat="paint_dark"),
        box((0.55, 0.03, 0.50), (0, 3.04, -1.75), mount="turret", mat="paint_dark"),
        box((0.20, 0.03, 0.02), (0, 3.11, -0.60), mount="turret", mat="steel"),
        cyl(0.14, 0.10, "y", (0.25, 3.15, 0.30), mount="turret", mat="paint_dark"),
        box((0.14, 0.06, 0.06), (0.25, 3.18, 0.42), mount="turret", mat="glass"),
        cyl(0.04, 0.12, "y", (-0.36, 3.025, -2.40), mount="turret", mat="paint_dark"),
        cyl(0.008, 1.0, "y", (-0.36, 3.58, -2.40), mount="turret", mat="black", segs=6),
        # vision blocks on the turret's front corners, smoke dischargers on the rear sides
        box((0.03, 0.14, 0.26), (0.50, 2.71, 0.62), rot=(0, 47, 0), mirror=True, mount="turret", mat="glass"),
        cyl(0.04, 0.22, "z", (0.508, 2.88, -2.30), rot=(-20, 0, 0), mirror=True, mount="turret", mat="paint_dark"),
        cyl(0.04, 0.22, "z", (0.566, 2.80, -2.30), rot=(-20, 0, 0), mirror=True, mount="turret", mat="paint_dark"),
    ]
    # rivets and bolts along the hull's crease, a few each side (the render's panel bolting)
    for z in (-2.6, -1.2, -0.5, 0.2, 0.9, 2.3):
        parts.append(cyl(0.02, 0.012, "x", (1.284, 1.08, z), mirror=True, mat="steel", segs=6))
    rg = {"kind": "wheels", "tyre_style": "military",
          "axles": [axle(W4_ZF, W4_R, W4_R, 0.45, W4_TRACK, steer=1), axle(W4_ZR, W4_R, W4_R, 0.45, W4_TRACK)]}
    gl = math.hypot(2.52, 0.81)
    plates = [
        plate("hull_glacis", "hull_upper_front", "rha", 20, (0, 1.72, 1.81), (0, 2.52 / gl, 0.81 / gl), (1, 0, 0), 1.12, gl / 2),
        plate("hull_nose", "hull_lower_front", "rha", 16, (0, 1.13, 3.10), (0, 0, 1), (1, 0, 0), 1.05, 0.18),
        plate("hull_lower_front", "hull_lower_front", "rha", 12, (0, 0.84, 2.99), (0, -0.65, 0.76), (1, 0, 0), 1.0, 0.18),
        plate("hull_side_r", "hull_side", "rha", 12, (1.21, 1.53, -0.30), (0.988, 0.156, 0), (0, 0, 1), 2.85, 0.48),
        plate("hull_side_l", "hull_side", "rha", 12, (-1.21, 1.53, -0.30), (-0.988, 0.156, 0), (0, 0, 1), 2.85, 0.48),
        plate("hull_lower_side_r", "hull_side", "rha", 10, (1.22, 0.90, -0.30), (0.90, -0.436, 0), (0, 0, 1), 2.85, 0.16),
        plate("hull_lower_side_l", "hull_side", "rha", 10, (-1.22, 0.90, -0.30), (-0.90, -0.436, 0), (0, 0, 1), 2.85, 0.16),
        plate("hull_rear", "hull_rear", "rha", 10, (0, 1.52, -3.19), (0, 0, -1), (1, 0, 0), 1.15, 0.47),
        plate("hull_roof", "hull_roof", "rha", 8, (0, 2.05, -1.30), (0, 1, 0), (1, 0, 0), 1.05, 1.85),
        plate("hull_floor", "hull_floor", "rha", 8, (0, c, 0), (0, -1, 0), (1, 0, 0), 0.60, 2.85),
        plate("turret_front", "turret_front", "rha", 25, (0, 2.65, 0.86), (0, 0, 1), (1, 0, 0), 0.34, 0.15),
        plate("turret_cheek_r", "turret_front", "rha", 20, (0.61, 2.65, 0.60), (0.687, 0, 0.727), (0.727, 0, -0.687), 0.37, 0.30),
        plate("turret_cheek_l", "turret_front", "rha", 20, (-0.61, 2.65, 0.60), (-0.687, 0, 0.727), (0.727, 0, 0.687), 0.37, 0.30),
        plate("turret_front_upper", "turret_front", "rha", 16, (0, 2.96, 0.60), (0, 0.847, 0.531), (1, 0, 0), 0.55, 0.30),
        plate("turret_side_r", "turret_side", "rha", 15, (0.86, 2.70, -0.90), (0.97, 0.243, 0), (0, 0, 1), 1.55, 0.33),
        plate("turret_side_l", "turret_side", "rha", 15, (-0.86, 2.70, -0.90), (-0.97, 0.243, 0), (0, 0, 1), 1.55, 0.33),
        plate("turret_rear", "turret_rear", "rha", 12, (0, 2.74, -2.55), (0, 0, -1), (1, 0, 0), 0.55, 0.22),
        plate("turret_roof", "turret_roof", "rha", 10, (0, 3.07, -1.0), (0, 1, 0), (1, 0, 0), 0.62, 1.40),
    ]
    modules = [
        module("engine", "engine", (0, 1.30, -2.40), (0.55, 0.32, 0.55), 140),
        module("transmission", "transmission", (0, 0.98, -1.60), (0.32, 0.18, 0.22), 110),
        module("fuel_tank_l", "fuel_tank", (-0.80, 1.35, -1.25), (0.25, 0.25, 0.30), 45),
        module("fuel_tank_r", "fuel_tank", (0.80, 1.35, -1.25), (0.25, 0.25, 0.30), 45),
        module("radio", "radio", (-0.70, 1.75, 0.30), (0.20, 0.15, 0.15), 40),
        module("turret_drive", "turret_drive", (0.45, 2.45, -0.10), (0.12, 0.08, 0.12), 60),
    ]
    crew_list = [crew("driver", (0.0, 1.75, 1.35)), crew("gunner", (-0.42, 2.55, -0.35)), crew("commander", (0.40, 2.62, -0.95))]
    common = {
        "nation": "fictional", "cls": "armored_car", "year": 1982, "outline": "traced",
        "L": L, "W": W, "H": H, "clear": c, "com": (0, 1.35, -0.05),
        "turret_pos": piv, "ring": 1.70, "plates": plates,
        "sight": {"name": "periscope sight", "levels": [{"magnification": 3.0, "fov_deg": 20.0}, {"magnification": 8.0, "fov_deg": 7.5}]},
        "secondary": [],
        "engine": {"horsepower": 400, "max_rpm": 2600, "idle_rpm": 650, "weight_kg": 1000,
                   "torque_curve": [[650, 1050], [1400, 1450], [2000, 1380], [2600, 1180]]},
        "transmission": {"forward_gears": 6, "reverse_gears": 1, "gear_ratios": [7.6, 4.9, 3.2, 2.1, 1.4, 1.0],
                         "final_drive_ratio": 5.6, "shift_time_s": 0.45},
        "physics": {"drive": "wheeled", "track_width_m": 0.45, "track_length_m": 3.4,
                    "suspension": {"kind": "leaf_spring", "travel_m": 0.26}, "suspension_freq_hz": 1.3, "suspension_damping": 0.35,
                    "rolling_resistance": 0.015, "sprocket_radius_m": W4_R, "drivetrain_efficiency": 0.9, "max_brake_decel_ms2": 6.0,
                    "max_turn_rate_deg_s": 30.0, "max_reverse_speed_ms": 6.0, "min_turn_radius_m": 8.0, "max_steer_deg": 32.0},
        "palette": {"paint": "#6b6e4f", "paint_dark": "#4e5139", "orange": "#e38a1e", "glass": "#1c252b", "lamp": "#e6e4da"},
        "running_gear": rg,
    }
    if variant == "kda35":
        # the KDA in the middle of the turret front: the nose of the Gepard's gun housing and
        # the barrel come out of a mantlet plate; the sight window beside it
        gm = (0, 2.64, 0.46)
        parts += [
            box((0.60, 0.40, 0.10), (0, 2.64, 0.90), mount="gun", mat="paint_dark"),
            box((0.24, 0.14, 0.02), (0.48, 2.70, 0.915), mount="turret", mat="glass"),
            box((0.30, 0.20, 0.06), (0.48, 2.70, 0.89), mount="turret", mat="paint_dark"),
        ]
        modules += [
            module("ammo_hull_l", "ammo_rack", (-0.55, 1.20, -0.50), (0.30, 0.25, 0.30), 60),
            module("ammo_hull_r", "ammo_rack", (0.55, 1.20, -0.50), (0.30, 0.25, 0.30), 60),
            module("breech", "gun_breech", (gm[0], gm[1], gm[2] - 0.15), (0.13, 0.13, 0.40), 90),
            module("gun_barrel", "gun_barrel", (gm[0], gm[1], 2.85), (0.06, 0.06, 1.35), 90),
        ]
        return dict(common, **{
            "id": "xp_kda35", "name": "35 mm 輪式試驗車", "mass": 15200, "model": "model.json",
            "based_on": "4x4 wheeled prototype from the user's four-view render, armed with a 35 mm Oerlikon KDA L/90 in the middle of the turret front",
            "notes": "Hull, turret, cab and details rebuilt from the four-view render supplied with the request; the views of the render differ a little, so heights follow the side view and widths the front view scaled to a 2.55 m hull. The barrel and the nose of the gun housing are the Gepard's, taken from 'Flakpanzer Gepard | High-Quality model' by Scout (CC-BY-4.0) with tools/glb_parts.py. The capped AP with a filler and the HEAT-FS rounds were never issued for this gun and are given plausible figures; engine, armour and interior are estimates.",
            "turret_size": (2.60, 1.10, 4.70), "mount": gm, "muzzle_offset": 3.79,
            "gun": {"id": "kda_35", "caliber_mm": 35.0, "barrel_length_mm": 3850, "recoil_mm": 60, "rounds_per_min": 550,
                    "reload_s": 0.11, "traverse_deg_s": 50.0, "elevate_deg_s": 40.0, "max_depression_deg": 6.0, "max_elevation_deg": 70.0,
                    "dispersion_mrad": 1.0, "mass_kg": 670, "ammo": ["apcbche_35"],
                    "autocannon": {"rate_rpm": 550, "belt_rounds": 100, "belt_reload_s": 8.0}},
            "modules": modules, "crew": crew_list, "parts": parts,
        })
    # the 78 mm gun: mantlet, sleeve, bore evacuator, the tube and its muzzle brake
    mount = (0, 2.65, 0.55)
    bore = mount[1]
    parts += [
        box((0.60, 0.43, 0.14), (0, 2.64, 0.92), mount="gun", mat="paint_dark"),
        cyl(0.085, 0.30, "z", (0, bore, 1.12), r2=0.072, mount="gun"),
        barrel(mount, 1.27, 2.10, 0.060, 0.056),
        recoil(cyl(0.072, 0.50, "z", (0, bore, 1.60), mount="gun", segs=22)),
        barrel(mount, 2.10, 3.33, 0.055, 0.050),
        recoil(cyl(0.064, 0.20, "z", (0, bore, 3.43), mount="gun", mat="paint_dark", segs=22)),
        recoil(cyl(0.068, 0.03, "z", (0, bore, 3.36), mount="gun", mat="paint_dark", segs=22)),
        recoil(cyl(0.068, 0.03, "z", (0, bore, 3.51), mount="gun", mat="paint_dark", segs=22)),
        cyl(0.03, 0.06, "z", (0.22, 2.75, 0.99), mount="gun", mat="black"),
    ]
    modules += [
        module("ammo_turret", "ammo_rack", (0, 2.65, -1.70), (0.45, 0.20, 0.40), 60),
        module("ammo_hull", "ammo_rack", (0, 1.20, -0.55), (0.45, 0.25, 0.30), 60),
        module("breech", "gun_breech", (0, bore, 0.05), (0.15, 0.15, 0.45), 100),
        module("gun_barrel", "gun_barrel", (0, bore, 2.30), (0.06, 0.06, 1.05), 90),
    ]
    return dict(common, **{
        "id": "xp_w78", "name": "78 mm 輪式試驗車", "mass": 15800,
        "based_on": "4x4 wheeled prototype from the user's four-view render, armed with a 78 mm low-recoil gun firing fin-stabilised sabot",
        "notes": "Hull, turret, cab and gun rebuilt from the four-view render supplied with the request (see the 35 mm variant). The 78 mm gun and its rounds are a design study: a high-velocity small-calibre gun for sabot, its figures plausible for the calibre (cf. the 75 mm ARES and 76 mm guns), not a service weapon.",
        "turret_size": (1.80, 1.10, 4.70), "mount": mount, "muzzle_offset": 3.53 - mount[2],
        "gun": {"id": "xp_78_lr", "caliber_mm": 78.0, "barrel_length_mm": 3000, "recoil_mm": 520, "rounds_per_min": 12.0,
                "reload_s": 5.0, "traverse_deg_s": 40.0, "elevate_deg_s": 25.0, "max_depression_deg": 8.0, "max_elevation_deg": 25.0,
                "dispersion_mrad": 0.4, "mass_kg": 1100, "ammo": ["apfsds_78_xp"]},
        "modules": modules, "crew": crew_list + [crew("loader", (0.40, 2.55, -1.65))], "parts": parts,
    })


def kda35():
    return w4x4("kda35")


def w78():
    return w4x4("w78")


def m113_tow():
    """M113A1 with the TOW 'hammerhead' launcher erected (M901 ITV): the aluminium box hull of the
    M113 (4.86 m long, 2.69 m over the tracks, roof 1.83 m, 0.43 m clearance; upper glacis at 45 deg,
    the hinged trim vane folded on it, the rear ramp), five road wheels a side with the sprocket in
    front and the idler behind, and on the roof the launcher arm carrying the two TOW tubes with the
    sight between them. Figures from the M113A1 / M901 published data (no drawing was supplied):
    5083 aluminium 44 mm upper sides, 38 mm front and rear, 32 mm lower sides; Detroit 6V53, 212 hp;
    Allison TX-100, 3 forward gears; 64 km/h; 12 missiles (2 in the tubes, 10 stowed)."""
    L, W, H, c = 4.86, 2.54, 1.83, 0.43
    tx = 1.08
    tt = 0.05
    pz = -0.30
    piv = (0, H, pz)
    head_y = 2.72
    mount = (0, head_y, pz + 0.05)
    muzzle_z = pz + 0.55
    wz = [1.30, 0.63, -0.04, -0.71, -1.38]
    hull = [(-2.43, c), (1.95, c), (2.43, 0.86), (2.43, 0.96), (1.55, H), (-2.40, H), (-2.43, 1.70)]
    parts = [
        # the box hull, aluminium plate: sides straight down to the track line
        prism(hull, W),
        # trim vane folded flat on the upper glacis, its hinge brackets; headlight guards
        box((2.10, 0.04, 0.62), (0, 1.43, 1.98), rot=(-45, 0, 0), mat="paint_dark"),
        box((0.08, 0.10, 0.10), (0.95, 1.18, 2.24), mirror=True, mat="paint_dark"),
        box((0.18, 0.14, 0.04), (1.02, 1.02, 2.43), mirror=True, mat="black"),
        cyl(0.06, 0.05, "z", (1.02, 1.04, 2.45), mirror=True, mat="steel"),
        box((0.10, 0.08, 0.10), (0.75, 0.62, 2.12), mirror=True, mat="steel"),
        # the rear ramp and its hinges, tail lights, the exhaust on the right of the glacis
        box((1.90, 1.12, 0.04), (0, 1.02, -2.44), mat="paint_dark"),
        cyl(0.03, 1.6, "x", (0, 0.50, -2.45), mat="steel"),
        box((0.10, 0.12, 0.03), (1.05, 1.55, -2.45), mirror=True, mat="black"),
        cyl(0.07, 0.55, "y", (0.95, 1.70, 1.62), mat="black"),
        # roof: driver's hatch and periscopes (left front), commander's cupola (right), cargo hatch
        cyl(0.30, 0.06, "y", (-0.75, H + 0.03, 1.28), mat="paint_dark"),
        box((0.40, 0.08, 0.10), (-0.75, H + 0.07, 1.55), mat="black"),
        cyl(0.36, 0.18, "y", (0.72, H + 0.09, 0.95), r2=0.33),
        box((0.30, 0.08, 0.08), (0.72, H + 0.21, 1.22), mat="black"),
        box((1.30, 0.04, 1.10), (0, H + 0.02, -1.55), mat="paint_dark"),
        # stowage: the side boxes over the tracks at the rear, spare missiles' tubes under a cover
        box((0.10, 0.32, 1.30), (1.30, 1.45, -1.40), mirror=True, mat="paint_dark"),
        # the launcher: pedestal ring, the arm up to the hammerhead
        cyl(0.36, 0.10, "y", (0, H + 0.05, pz), mount="turret", mat="paint_dark", segs=24),
        cyl(0.17, 0.60, "y", (0, H + 0.38, pz - 0.02), r2=0.13, mount="turret", segs=16),
        box((0.20, 0.55, 0.22), (0, H + 0.65, pz - 0.18), rot=(18, 0, 0), mount="turret"),
        box((0.52, 0.10, 0.24), (0, head_y - 0.30, pz + 0.02), mount="turret", mat="paint_dark"),
        # the hammerhead: two tubes either side, the sight in the middle, the armoured box round them
        box((1.22, 0.44, 0.86), (0, head_y, pz + 0.08), mount="gun"),
        box((0.30, 0.30, 0.10), (0, head_y + 0.02, pz + 0.53), mount="gun", mat="paint_dark"),
        box((0.20, 0.12, 0.02), (0, head_y + 0.04, pz + 0.585), mount="gun", mat="black"),
        cyl(0.115, 0.14, "z", (0.42, head_y, pz + 0.55), mount="gun", mat="paint_dark", segs=20),
        cyl(0.115, 0.14, "z", (-0.42, head_y, pz + 0.55), mount="gun", mat="paint_dark", segs=20),
        cyl(0.09, 0.02, "z", (0.42, head_y, pz + 0.625), mount="gun", mat="black", segs=20),
        cyl(0.09, 0.02, "z", (-0.42, head_y, pz + 0.625), mount="gun", mat="black", segs=20),
        cyl(0.115, 0.10, "z", (0.42, head_y, pz - 0.40), mount="gun", mat="paint_dark", segs=20),
        cyl(0.115, 0.10, "z", (-0.42, head_y, pz - 0.40), mount="gun", mat="paint_dark", segs=20),
    ]
    plates = [
        plate("hull_upper_front", "hull_upper_front", "aluminium", 38, (0, 1.40, 1.99), (0, 0.707, 0.707), (1, 0, 0), 1.25, 0.62),
        plate("hull_lower_front", "hull_lower_front", "aluminium", 38, (0, 0.65, 2.19), (0, -0.678, 0.735), (1, 0, 0), 1.25, 0.32),
        plate("hull_side_r", "hull_side", "aluminium", 44, (1.27, 1.40, 0), (1, 0, 0), (0, 0, 1), 2.40, 0.43),
        plate("hull_side_l", "hull_side", "aluminium", 44, (-1.27, 1.40, 0), (-1, 0, 0), (0, 0, 1), 2.40, 0.43),
        plate("hull_side_low_r", "hull_side", "aluminium", 32, (1.27, 0.70, 0), (1, 0, 0), (0, 0, 1), 2.20, 0.27),
        plate("hull_side_low_l", "hull_side", "aluminium", 32, (-1.27, 0.70, 0), (-1, 0, 0), (0, 0, 1), 2.20, 0.27),
        plate("hull_rear", "hull_rear", "aluminium", 38, (0, 1.10, -2.42), (0, 0, -1), (1, 0, 0), 1.25, 0.66),
        plate("hull_roof", "hull_roof", "aluminium", 38, (0, H, -0.45), (0, 1, 0), (1, 0, 0), 1.25, 1.95),
        plate("hull_floor", "hull_floor", "aluminium", 28, (0, c, 0), (0, -1, 0), (1, 0, 0), 1.25, 2.20),
        plate("turret_front", "turret_front", "rha", 12, (0, head_y, pz + 0.51), (0, 0, 1), (1, 0, 0), 0.61, 0.22),
        plate("turret_side_r", "turret_side", "rha", 8, (0.61, head_y, pz + 0.08), (1, 0, 0), (0, 0, 1), 0.43, 0.22),
        plate("turret_side_l", "turret_side", "rha", 8, (-0.61, head_y, pz + 0.08), (-1, 0, 0), (0, 0, 1), 0.43, 0.22),
        plate("turret_rear", "turret_rear", "rha", 8, (0, head_y, pz - 0.35), (0, 0, -1), (1, 0, 0), 0.61, 0.22),
        plate("turret_roof", "turret_roof", "rha", 8, (0, head_y + 0.22, pz + 0.08), (0, 1, 0), (1, 0, 0), 0.61, 0.43),
    ]
    return {
        "id": "us_m901_itv", "name": "M901 ITV（M113 TOW）", "nation": "usa", "cls": "tank_destroyer", "year": 1979, "outline": "dimensions",
        "based_on": "M113A1 armoured personnel carrier with the M27 TOW launcher ('hammerhead') of the M901 Improved TOW Vehicle",
        "notes": "Built to the M113A1's published dimensions (length 4.86 m, width 2.69 m, roof 1.83 m, clearance 0.43 m) and the M901's launcher; no drawing was supplied, so details are placed from photographs in general terms. Armour is 5083 aluminium. The TOW is wire guided: keep the sight on the target until it strikes.",
        "L": L, "W": W, "H": H, "clear": c, "mass": 11800, "com": (0, 0.95, 0.15),
        "turret_pos": piv, "turret_size": (1.30, 1.15, 1.00), "ring": 0.72, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "plates": plates,
        "gun": {"id": "m220_tow", "caliber_mm": 152.0, "barrel_length_mm": 1270, "recoil_mm": 0, "rounds_per_min": 5.0,
                "reload_s": 12.0, "traverse_deg_s": 25.0, "elevate_deg_s": 12.0, "max_depression_deg": 30.0, "max_elevation_deg": 35.0,
                "dispersion_mrad": 0.0, "mass_kg": 95, "ammo": ["heat_152_tow"], "ammo_count": [12],
                "missile": "bgm71a_tow", "guided": True},
        "sight": {"name": "M27 TOW sight", "levels": [{"magnification": 3.0, "fov_deg": 22.0}, {"magnification": 13.0, "fov_deg": 4.4}]},
        "secondary": [],
        "engine": {"horsepower": 212, "max_rpm": 2800, "idle_rpm": 600, "weight_kg": 590,
                   "torque_curve": [[600, 430], [1400, 590], [2200, 560], [2800, 470]]},
        "transmission": {"forward_gears": 3, "reverse_gears": 1, "gear_ratios": [3.8, 2.0, 1.0], "final_drive_ratio": 4.45, "shift_time_s": 0.5},
        "physics": {"track_width_m": 0.381, "track_length_m": 2.67, "suspension": {"travel_m": 0.18, "stiffness": 140000, "damping": 10000},
                    "rolling_resistance": 0.04, "sprocket_radius_m": 0.27, "drivetrain_efficiency": 0.8, "max_brake_decel_ms2": 5.5,
                    "max_turn_rate_deg_s": 40.0, "max_reverse_speed_ms": 4.0, "min_turn_radius_m": 0.0},
        "modules": [
            module("engine", "engine", (0.55, 0.95, 1.40), (0.38, 0.32, 0.45), 120),
            module("transmission", "transmission", (0.0, 0.70, 2.05), (0.55, 0.20, 0.18), 100),
            module("fuel_tank", "fuel_tank", (-0.85, 0.95, -1.95), (0.25, 0.40, 0.35), 50),
            module("missile_rack_l", "ammo_rack", (-0.85, 0.90, -0.75), (0.22, 0.28, 0.65), 45),
            module("missile_rack_r", "ammo_rack", (0.85, 0.90, -0.75), (0.22, 0.28, 0.65), 45),
            module("launcher", "gun_breech", (0, head_y, pz + 0.05), (0.18, 0.15, 0.35), 70),
            module("tubes", "gun_barrel", (0, head_y, pz + 0.12), (0.55, 0.12, 0.45), 70),
            module("launcher_drive", "turret_drive", (0, H - 0.15, pz), (0.15, 0.10, 0.15), 50),
            module("radio", "radio", (-0.80, 1.40, 0.40), (0.18, 0.14, 0.14), 40),
        ],
        "crew": [crew("driver", (-0.75, 1.20, 1.25)), crew("commander", (0.72, 1.45, 0.95)),
                 crew("gunner", (0.0, 1.50, pz - 0.05)), crew("loader", (0.0, 1.05, -1.20))],
        "palette": {"paint": "#5b6342", "paint_dark": "#454c33"},
        "parts": parts,
        "running_gear": {"track_width": 0.381, "track_thickness": tt, "track_x": tx, "link_pitch": 0.152, "link_style": "center_guide", "track_sag": 0.015,
                         "sprocket": {"z": 1.98, "y": 0.62, "r": 0.27, "teeth": 10}, "idler": {"z": -2.08, "y": 0.52, "r": 0.24},
                         "wheels": wheel_row(wz, 0.305 + tt, 0.305, 0.30),
                         "rollers": [], "wheel_style": "steel_dish"},
    }


def slab(quads, off, mount="hull", mat="paint", mirror_x=True):
    """A thin bent plate (a gun shield) from the quads of its front face, given as the right half's
    corner points, thickened by the vector off toward its back; each face turned away from the
    plate's middle, mirrored to the left when mirror_x."""
    V, F, ins = [], [], []

    def vid(p):
        p = [r3(k) for k in p]
        if p not in V:
            V.append(p)
        return V.index(p)
    for q in quads:
        back = [[a + b for a, b in zip(p, off)] for p in q]
        mid = [sum(p[k] for p in q) / 4 + off[k] / 2 for k in range(3)]
        f, b = [vid(p) for p in q], [vid(p) for p in back]
        F.append(f)
        ins.append(mid)
        F.append(list(reversed(b)))
        ins.append(mid)
        for i in range(4):
            j = (i + 1) % 4
            F.append([f[i], f[j], b[j], b[i]])
            ins.append(mid)

    def newell(pts):
        n = [0.0, 0.0, 0.0]
        for i in range(len(pts)):
            a, b = pts[i], pts[(i + 1) % len(pts)]
            n[0] += (a[1] - b[1]) * (a[2] + b[2])
            n[1] += (a[2] - b[2]) * (a[0] + b[0])
            n[2] += (a[0] - b[0]) * (a[1] + b[1])
        return n
    out = []
    for f, c0 in zip(F, ins):
        pts = [V[i] for i in f]
        n = newell(pts)
        c = [sum(p[k] for p in pts) / len(pts) for k in range(3)]
        out.append(f if sum(n[k] * (c[k] - c0[k]) for k in range(3)) > 0 else list(reversed(f)))
    if mirror_x:
        k = len(V)
        V = V + [[-x, y, z] for x, y, z in V]
        out += [[i + k for i in reversed(f)] for f in out]
    return {"type": "mesh", "mount": mount, "mat": mat, "vertices": V, "faces": out}


def flak38_parts(pz, base_y, x=0.0):
    """The 2 cm FlaK 38 on its turntable, measured off the reference model (the same gun goes
    on every vehicle that carries it): the turntable plate on the pedestal at (x, base_y, pz),
    the upper carriage's side frames with the elevating arcs, the gunner's seat and handwheels at
    the back, the bent shield split by the gun's slot, and on the trunnions (0.24 m ahead of the
    pivot, 0.525 m above the plate) the receiver with the 20-round magazine on the left, the
    recoil jacket, the barrel and its flash hider, and the Flakvisier 38 reflex sight.
    Returns (parts, mount, muzzle_z)."""
    tz = pz + 0.24
    ty = base_y + 0.525
    mount = (x, ty, tz)
    muzzle_z = tz + 1.79
    T = dict(mount="turret")
    G = dict(mount="gun")
    shield = [[[x, base_y + 0.03, pz + 0.68], [x + 0.55, base_y + 0.03, pz + 0.68], [x + 0.55, ty, pz + 0.85], [x + 0.07, ty, pz + 0.85]],
              [[x + 0.07, ty, pz + 0.85], [x + 0.55, ty, pz + 0.85], [x + 0.50, base_y + 0.855, pz + 0.52], [x + 0.07, base_y + 0.855, pz + 0.52]]]
    parts = [
        # the turntable plate, the carriage's side frames, the cross member, the elevating arcs
        cyl(0.48, 0.05, "y", (x, base_y, pz), segs=28, mat="paint_dark", **T),
        box((0.03, 0.62, 0.95), (x + 0.20, base_y + 0.36, pz + 0.07), mirror=x == 0, mat="paint_dark", **T),
        box((0.40, 0.10, 0.50), (x, base_y + 0.10, pz + 0.10), mat="paint_dark", **T),
        cyl(0.23, 0.03, "x", (x + 0.235, ty, tz), segs=24, mirror=x == 0, **T),
        cyl(0.19, 0.035, "x", (x + 0.235, ty, tz), segs=24, mirror=x == 0, mat="black", **T),
        # the gunner's seat and backrest, the traverse and elevation handwheels
        box((0.36, 0.06, 0.30), (x, base_y + 0.30, pz - 0.45), mat="black", **T),
        box((0.36, 0.25, 0.04), (x, base_y + 0.45, pz - 0.62), rot=(10, 0, 0), mat="black", **T),
        cyl(0.03, 0.30, "y", (x, base_y + 0.15, pz - 0.45), mat="steel", **T),
        cyl(0.08, 0.02, "x", (x + 0.25, base_y + 0.32, pz - 0.10), segs=14, mirror=x == 0, mat="steel", **T),
        cyl(0.012, 0.06, "x", (x + 0.225, base_y + 0.32, pz - 0.10), mirror=x == 0, mat="steel", **T),
        # the shield: the lower half leaning forward, the upper half back, the slot for the gun
        slab(shield, (0, 0, -0.012), mount="turret", mirror_x=True) if x == 0 else slab(shield, (0, 0, -0.012), mount="turret", mirror_x=False),
        # the receiver, the magazine on the left, the cradle under it, the recoil jacket, the
        # barrel and the flash hider
        box((0.14, 0.16, 1.00), (x, ty, tz - 0.36), mat="paint_dark", **G),
        box((0.10, 0.08, 0.80), (x, ty - 0.11, tz - 0.30), mat="paint_dark", **G),
        box((0.20, 0.07, 0.26), (x - 0.17, ty - 0.05, tz + 0.10), mat="black", **G),
        cyl(0.05, 0.42, "z", (x, ty, tz + 0.345), r2=0.045, **G),
        cyl(0.045, 0.15, "z", (x, ty, tz + 0.625), r2=0.035, **G),
        barrel(mount, tz + 0.70, muzzle_z - 0.14, 0.022, 0.020),
        recoil(cyl(0.026, 0.14, "z", (x, ty, muzzle_z - 0.07), r2=0.036, mat="black", **G)),
        # the Flakvisier 38 on its arm over the right of the receiver
        box((0.05, 0.22, 0.05), (x + 0.20, ty + 0.15, tz - 0.55), mat="steel", **G),
        box((0.10, 0.12, 0.22), (x + 0.22, ty + 0.30, tz - 0.55), mat="black", **G),
        cyl(0.04, 0.20, "z", (x + 0.22, ty + 0.32, tz - 0.34), r2=0.065, mat="black", **G),
    ]
    return parts, mount, muzzle_z


def rso(variant):
    """Raupenschlepper Ost, rebuilt from the three-view drawing supplied with the request (its
    3 m scale bar gives 362 px per metre; the 1.99 m width checks): the steel-tracked tractor with
    the front sprocket, four large disc wheels and the rear idler, the frame rails along the
    sides, the bed with its drop sides; 'flak' keeps the timber-and-pressed-steel cab and carries
    the 2 cm FlaK 38 on its pedestal amidships, 'pak' has the armoured, wedge-nosed cab of the
    7.5 cm PaK 40/4 Selbstfahrlafette and the gun on its turntable behind it."""
    pak = variant == "pak"
    L, W, c = 4.06 if pak else 3.98, 1.99, 0.45
    H = 2.0 if not pak else 1.62
    tx = 0.82
    wz = [0.97, 0.33, -0.30, -0.92]
    pz = -0.85
    parts = [
        # the lower hull between the tracks, the frame rails with their row of lightening holes
        prism([(-1.95, 0.52), (1.62, 0.52), (1.90, 0.78), (1.90, 0.90), (-2.00, 0.90), (-2.00, 0.66)], 1.20),
        box((1.98, 0.10, 3.92), (0, 0.86, -0.04), mat="paint_dark"),
    ]
    for k in range(8):
        parts.append(cyl(0.022, 0.012, "x", (0.995, 0.86, 1.25 - k * 0.075), mirror=True, mat="black", segs=8))
    parts += [
        # the tow hooks front and rear, the rear coupling and its lamp
        cyl(0.05, 0.08, "x", (0.70, 0.84, 1.98), mirror=True, mat="steel"),
        box((0.14, 0.12, 0.16), (0, 0.80, -2.04), mat="steel"),
        cyl(0.07, 0.05, "z", (0.55, 0.62, -2.02), mat="lamp"),
        # the bed: floor, the drop sides and tailboard, the stakes
        box((1.96, 0.05, 2.62), (0, 0.935, -0.66), mat="wood"),
        box((0.03, 0.40, 2.62), (0.965, 1.17, -0.66), mirror=True, mat="wood"),
        box((1.96, 0.40, 0.03), (0, 1.17, -1.965), mat="wood"),
        box((1.96, 0.40, 0.03), (0, 1.17, 0.645), mat="wood"),
        box((0.04, 0.04, 2.66), (0.98, 1.36, -0.66), mirror=True, mat="steel"),
    ]
    for z in (0.58, -0.10, -0.88, -1.62):
        parts.append(box((0.05, 0.46, 0.05), (0.99, 1.16, z), mirror=True, mat="steel"))
    if pak:
        cab = [(1.83, 0.88), (2.03, 1.10), (1.31, 1.38), (0.71, 1.38), (0.71, 0.92)]
        parts += [
            # the armoured cab: lower nose plate, the long upper plate, the flat roof with its hatches
            prism(cab, 1.94, wt=1.90),
            box((0.50, 0.02, 0.36), (0.52, 1.39, 0.98), mat="paint_dark"),
            box((0.44, 0.02, 0.30), (-0.50, 1.39, 1.02), mat="paint_dark"),
            box((0.50, 0.10, 0.03), (0.42, 1.30, 1.53), rot=(-62, 0, 0), mat="black"),
            box((0.30, 0.10, 0.03), (-0.45, 1.30, 1.53), rot=(-62, 0, 0), mat="black"),
            box((0.02, 0.22, 0.30), (0.975, 1.12, 1.30), mirror=True, mat="paint_dark"),
            cyl(0.04, 0.08, "y", (-0.80, 1.42, 0.80), mat="paint_dark"),
        ]
        mount = (0, 1.63, -0.60)
        muzzle_z = 2.18
        # the PaK 40's shield: the middle plate leaning back 25 deg and the wings swept back, two
        # layers of 4 mm spaced apart
        shield = [[[0, 1.35, -0.03], [0.25, 1.35, -0.03], [0.22, 1.97, -0.32], [0, 1.97, -0.32]],
                  [[0.25, 1.35, -0.03], [0.70, 1.35, -0.62], [0.62, 1.97, -0.70], [0.22, 1.97, -0.32]]]
        parts += [
            cyl(0.42, 0.05, "y", (0, 0.99, pz), mat="paint_dark", segs=24),
            cyl(0.48, 0.05, "y", (0, 1.05, pz), mount="turret", mat="paint_dark", segs=24),
            box((0.50, 0.30, 0.50), (0, 1.22, pz + 0.05), mount="turret", mat="paint_dark"),
            slab(shield, (0, 0, -0.04), mount="turret"),
            box((0.36, 0.08, 0.04), (0, 1.40, -0.07), mount="turret", mat="black"),
            # the cradle with the recuperator over the barrel, the breech, the elevating gear
            box((0.24, 0.22, 1.10), (0, mount[1] - 0.04, mount[2] - 0.20), mount="gun", mat="paint_dark"),
            cyl(0.06, 0.95, "z", (0, mount[1] + 0.12, mount[2] + 0.20), mount="gun"),
            box((0.20, 0.22, 0.28), (0, mount[1], mount[2] - 0.80), mount="gun", mat="steel"),
            cyl(0.10, 0.04, "x", (0.27, 1.25, mount[2] - 0.30), mount="turret", mat="black"),
            box((0.06, 0.10, 0.20), (-0.15, mount[1] + 0.06, mount[2] - 0.15), mount="gun", mat="black"),
            barrel(mount, mount[2] + 0.30, 1.40, 0.060, 0.050),
            barrel(mount, 1.40, muzzle_z - 0.24, 0.050, 0.044),
            recoil(cyl(0.085, 0.24, "z", (0, mount[1], muzzle_z - 0.12), mount="gun", mat="paint_dark")),
            recoil(cyl(0.095, 0.03, "z", (0, mount[1], muzzle_z - 0.20), mount="gun", mat="paint_dark")),
            # the ammunition lockers along the bed
            box((0.30, 0.30, 0.90), (0.72, 1.12, -1.40), mirror=True, mat="paint_dark"),
        ]
    else:
        cab = [(1.94, 0.92), (1.95, 1.05), (1.92, 1.25), (1.83, 1.42), (1.66, 1.54), (1.45, 1.94), (1.40, 2.0), (0.75, 2.0), (0.67, 1.96), (0.67, 0.92)]
        parts += [
            # the cab of pressed steel and timber, its windscreen, side windows, door handles
            prism(cab, 1.90, wt=1.82),
            box((1.56, 0.36, 0.02), (0, 1.75, 1.555), rot=(-24, 0, 0), mat="glass"),
            box((0.02, 0.30, 0.60), (0.94, 1.73, 1.10), mirror=True, mat="glass"),
            box((0.03, 0.02, 0.10), (0.955, 1.48, 0.80), mirror=True, mat="steel"),
            cyl(0.07, 0.05, "z", (0.72, 1.20, 1.96), mirror=True, mat="lamp"),
            box((0.30, 0.86, 0.38), (-0.70, 1.395, 0.34), mat="paint_dark"),
            # the FlaK 38's cross base on the bed and its column
            box((1.00, 0.06, 0.12), (0, 0.99, pz), mat="paint_dark"),
            box((0.12, 0.06, 1.00), (0, 0.99, pz), mat="paint_dark"),
            cyl(0.10, 0.55, "y", (0, 1.28, pz), mat="paint_dark"),
        ]
        fp, mount, muzzle_z = flak38_parts(pz, 1.58)
        parts += fp

    plates = [
        plate("hull_front", "hull_lower_front", "skirt", 5, (0, 0.70, 1.78), (0, -0.7, 0.7), (1, 0, 0), 0.6, 0.2),
        plate("hull_side_r", "hull_side", "skirt", 5, (0.60, 0.70, -0.1), (1, 0, 0), (0, 0, 1), 1.8, 0.18),
        plate("hull_side_l", "hull_side", "skirt", 5, (-0.60, 0.70, -0.1), (-1, 0, 0), (0, 0, 1), 1.8, 0.18),
        plate("hull_rear", "hull_rear", "skirt", 5, (0, 0.72, -2.0), (0, 0, -1), (1, 0, 0), 0.6, 0.18),
        plate("hull_floor", "hull_floor", "skirt", 4, (0, 0.52, 0), (0, -1, 0), (1, 0, 0), 0.6, 1.7),
        plate("bed_side_r", "hull_side", "skirt", 3, (0.965, 1.17, -0.66), (1, 0, 0), (0, 0, 1), 1.3, 0.2),
        plate("bed_side_l", "hull_side", "skirt", 3, (-0.965, 1.17, -0.66), (-1, 0, 0), (0, 0, 1), 1.3, 0.2),
        plate("bed_rear", "hull_rear", "skirt", 3, (0, 1.17, -1.965), (0, 0, -1), (1, 0, 0), 0.97, 0.2),
    ]
    if pak:
        plates += [
            plate("cab_lower_front", "hull_lower_front", "rha", 10, (0, 0.99, 1.93), (0, -0.67, 0.74), (1, 0, 0), 0.95, 0.15),
            plate("cab_upper_front", "hull_upper_front", "rha", 10, (0, 1.24, 1.67), (0, 0.93, 0.36), (1, 0, 0), 0.95, 0.39),
            plate("cab_side_r", "hull_side", "rha", 5, (0.965, 1.15, 1.30), (1, 0, 0), (0, 0, 1), 0.6, 0.22),
            plate("cab_side_l", "hull_side", "rha", 5, (-0.965, 1.15, 1.30), (-1, 0, 0), (0, 0, 1), 0.6, 0.22),
            plate("cab_roof", "hull_roof", "rha", 5, (0, 1.38, 1.0), (0, 1, 0), (1, 0, 0), 0.95, 0.3),
            plate("cab_rear", "hull_rear", "rha", 5, (0, 1.15, 0.71), (0, 0, -1), (1, 0, 0), 0.95, 0.22),
            plate("shield_front", "gun_mantlet", "spaced", 8, (0, 1.66, -0.18), (0, 0.42, 0.91), (1, 0, 0), 0.25, 0.33),
            plate("shield_r", "turret_front", "spaced", 8, (0.46, 1.66, -0.42), (0.75, 0.30, 0.59), (0.62, 0, -0.785), 0.30, 0.33),
            plate("shield_l", "turret_front", "spaced", 8, (-0.46, 1.66, -0.42), (-0.75, 0.30, 0.59), (0.62, 0, 0.785), 0.30, 0.33),
        ]
    else:
        plates += [
            plate("cab_front", "hull_upper_front", "skirt", 2, (0, 1.30, 1.88), (0, 0.3, 0.954), (1, 0, 0), 0.9, 0.35),
            plate("cab_side_r", "hull_side", "skirt", 2, (0.95, 1.45, 1.30), (1, 0, 0), (0, 0, 1), 0.6, 0.5),
            plate("cab_side_l", "hull_side", "skirt", 2, (-0.95, 1.45, 1.30), (-1, 0, 0), (0, 0, 1), 0.6, 0.5),
            plate("cab_roof", "hull_roof", "skirt", 2, (0, 2.0, 1.07), (0, 1, 0), (1, 0, 0), 0.9, 0.33),
            plate("cab_rear", "hull_rear", "skirt", 2, (0, 1.45, 0.67), (0, 0, -1), (1, 0, 0), 0.9, 0.5),
            plate("gun_shield", "turret_front", "rha", 8, (0, 1.95, -0.16), (0, 0.15, 0.99), (1, 0, 0), 0.5, 0.33),
        ]
    if pak:
        gun = {"id": "pak40_75", "caliber_mm": 75.0, "barrel_length_mm": 3450, "recoil_mm": 700, "rounds_per_min": 10.0,
               "reload_s": 6.0, "traverse_deg_s": 10.0, "elevate_deg_s": 5.0, "max_depression_deg": 5.0, "max_elevation_deg": 22.0,
               "dispersion_mrad": 0.7, "mass_kg": 1425, "ammo": ["apcbc_75_pzgr39"]}
        sight = {"name": "ZF 3x8", "levels": [{"magnification": 3.0, "fov_deg": 8.0}]}
        crew_list = [crew("driver", (-0.45, 1.10, 1.25)), crew("commander", (0.45, 1.10, 1.25)),
                     crew("gunner", (-0.45, 1.35, -1.15)), crew("loader", (0.45, 1.35, -1.20))]
        modules = [
            module("ammo_l", "ammo_rack", (-0.72, 1.12, -1.40), (0.15, 0.15, 0.45), 40),
            module("ammo_r", "ammo_rack", (0.72, 1.12, -1.40), (0.15, 0.15, 0.45), 40),
            module("breech", "gun_breech", (0, mount[1], mount[2] - 0.80), (0.10, 0.11, 0.16), 80),
            module("gun_barrel", "gun_barrel", (0, mount[1], 0.90), (0.05, 0.05, 1.25), 80),
            module("radio", "radio", (-0.55, 1.18, 0.85), (0.12, 0.10, 0.10), 30),
        ]
    else:
        gun = {"id": "flak38_20", "caliber_mm": 20.0, "barrel_length_mm": 1300, "recoil_mm": 30, "rounds_per_min": 420,
               "reload_s": 0.143, "traverse_deg_s": 40.0, "elevate_deg_s": 30.0, "max_depression_deg": 10.0, "max_elevation_deg": 90.0,
               "dispersion_mrad": 1.4, "mass_kg": 420, "ammo": ["hefi_20_sprgr"],
               "autocannon": {"rate_rpm": 420, "belt_rounds": 20, "belt_reload_s": 3.5}}
        sight = {"name": "Flakvisier 38", "levels": [{"magnification": 1.0, "fov_deg": 45.0}, {"magnification": 3.0, "fov_deg": 15.0}]}
        crew_list = [crew("driver", (-0.45, 1.35, 1.10)), crew("commander", (0.45, 1.35, 1.10)),
                     crew("gunner", (0.0, 1.80, -1.30)), crew("loader", (0.62, 1.35, -0.40))]
        modules = [
            module("ammo_l", "ammo_rack", (-0.70, 1.12, -1.50), (0.15, 0.15, 0.30), 40),
            module("ammo_r", "ammo_rack", (0.70, 1.12, -1.50), (0.15, 0.15, 0.30), 40),
            module("breech", "gun_breech", (0, mount[1], -0.80), (0.07, 0.08, 0.20), 60),
            module("gun_barrel", "gun_barrel", (0, mount[1], 0.20), (0.03, 0.03, 0.60), 60),
        ]
    modules = [
        module("engine", "engine", (0, 1.20, 1.45), (0.40, 0.25, 0.35), 90),
        module("transmission", "transmission", (0, 0.70, 1.50), (0.35, 0.14, 0.22), 80),
        module("fuel_tank", "fuel_tank", (0.40, 0.72, -0.60), (0.18, 0.14, 0.40), 40),
    ] + modules
    vid, name = ("de_rso_pak40", "RSO PaK 40") if pak else ("de_rso_flak", "RSO 2 cm FlaK 38")
    return {
        "id": vid, "name": name, "own_breech": True, "nation": "germany", "cls": "tank_destroyer" if pak else "spaa", "year": 1943 if pak else 1944, "outline": "traced",
        "based_on": ("7.5 cm PaK 40/4 auf Raupenschlepper Ost (Sfl.), the armoured cab and the PaK 40 on a turntable" if pak
                     else "Raupenschlepper Ost with the 2 cm FlaK 38 on its pedestal in the bed"),
        "notes": "Rebuilt from the three-view drawing supplied with the request (3 m scale bar: 362 px per metre). Steyr 1500A V8 of 85 hp, 17 km/h on the road; the gun fires forward over the cab" + (" and traverses 30 deg either side on its turntable." if pak else ", the FlaK 38 all round."),
        "L": L, "W": W, "H": H, "clear": c, "mass": 5900 if pak else 5100, "com": (0, 0.95, 0.10),
        "turret_pos": (0, 0.95, pz), "turret_size": (1.60, 1.60 if not pak else 1.10, 2.20), "ring": 0.9, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "open_top": True, "plates": plates, "yaw_limit": [-30, 30] if pak else None,
        # the gun clears the cab only about level over the front
        "dep_table": [(0, 1), (20, 1), (30, 3), (40, 10), (320, 10), (330, 3), (340, 1), (360, 1)] if not pak else [(0, 5), (320, 5), (330, 1), (340, 3), (350, 5), (360, 5)],
        "gun": gun, "sight": sight, "secondary": [],
        "engine": {"horsepower": 85, "max_rpm": 3000, "idle_rpm": 550, "weight_kg": 300,
                   "torque_curve": [[550, 180], [1400, 230], [2200, 220], [3000, 200]]},
        "transmission": {"forward_gears": 4, "reverse_gears": 1, "gear_ratios": [6.5, 3.4, 1.9, 1.0],
                         "final_drive_ratio": 13.4, "shift_time_s": 0.6},
        "physics": {"track_width_m": 0.34, "track_length_m": 2.20, "suspension": {"travel_m": 0.12, "stiffness": 90000, "damping": 7000},
                    "rolling_resistance": 0.05, "sprocket_radius_m": 0.20, "drivetrain_efficiency": 0.80, "max_brake_decel_ms2": 5.0,
                    "max_turn_rate_deg_s": 28.0, "max_reverse_speed_ms": 1.5, "min_turn_radius_m": 0.0},
        "modules": modules, "crew": crew_list,
        "palette": {"paint": "#857f60", "paint_dark": "#5e5a44"},
        "parts": parts,
        "running_gear": {"track_width": 0.34, "track_thickness": 0.05, "track_x": tx, "link_pitch": 0.13, "link_style": "center_guide", "track_sag": 0.04,
                         "sprocket": {"z": 1.62, "y": 0.56, "r": 0.20, "teeth": 12}, "idler": {"z": -1.51, "y": 0.58, "r": 0.20},
                         "wheels": wheel_row(wz, 0.29 + 0.05, 0.29, 0.30), "rollers": [], "wheel_style": "steel_dish"},
    }


def rso_flak():
    return rso("flak")


def rso_pak40():
    return rso("pak")


def cmp_portee():
    """Chevrolet C60L (CMP) 3-ton 4x4 portee with the 6-pounder, rebuilt from the four-view drawing
    supplied with the request (no scale bar: the 158 in wheelbase gives 233 px per metre, and the
    2.0 m width and 0.47 m tyres check): the No. 13 cab cut down open, the bonnet and the big
    rounded front wings, the two loading channels standing behind the cab, the flat bed with its
    perforated bins over the rear wheels, and the gun carried on its carriage facing the tail,
    fired over the tailboard."""
    L, W, H, c = 6.00, 2.00, 1.75, 0.42
    zf, zr = 2.30, -1.68
    r = 0.47
    tread = 0.82
    pz = -1.00
    mount = (0, 1.64, pz)
    muzzle_z = pz + 2.27   # drawn facing forward: the turret rests at 180 deg
    parts = [
        # the chassis frame rails, the front bumper bar, the cab floor
        box((0.10, 0.16, 5.90), (0.42, 0.66, 0.0), mirror=True, mat="paint_dark"),
        # the cab's mounting blocks on the rails, the bed's bearers
        box((1.0, 0.07, 0.10), (0, 0.77, 1.45), mat="paint_dark"),
        box((1.0, 0.07, 0.10), (0, 0.77, 1.95), mat="paint_dark"),
        box((1.90, 0.10, 0.10), (0, 0.78, 3.00), mat="paint_dark"),
        box((0.12, 0.22, 0.14), (0.62, 0.66, 2.90), mirror=True, mat="paint_dark"),
        # the bonnet and radiator grille, the scuttle, the open cab's sides and back
        prism([(1.28, 0.80), (2.77, 0.80), (2.77, 1.55), (2.65, 1.62), (2.20, 1.68), (2.05, 1.72), (1.33, 1.72), (1.28, 1.70)], 1.10, wt=1.04),
        box((0.80, 0.70, 0.02), (0, 1.15, 2.78), mat="black"),
        prism([(1.33, 0.80), (2.05, 0.80), (2.05, 1.72), (1.33, 1.72)], 0.03, x=0.95),
        prism([(1.33, 0.80), (2.05, 0.80), (2.05, 1.72), (1.33, 1.72)], 0.03, x=-0.95),
        box((1.92, 0.92, 0.04), (0, 1.26, 1.33), mat="paint"),
        box((1.92, 0.04, 0.80), (0, 0.82, 1.70), mat="paint_dark"),
        box((1.70, 0.40, 0.03), (0, 1.91, 2.05), rot=(10, 0, 0), mat="glass"),
        box((0.04, 0.42, 0.04), (0.86, 1.91, 2.05), mirror=True, mat="paint_dark"),
        # the seats, the steering wheel
        box((0.55, 0.10, 0.45), (0.45, 1.10, 1.60), mirror=True, mat="canvas"),
        cyl(0.20, 0.03, "y", (0.45, 1.45, 1.90), rot=(-50, 0, 0), mat="black"),
        # the front wings arched over the wheels, the headlamps and the side lamps
        prism([(1.62, 0.88), (1.60, 0.96), (1.85, 1.15), (2.30, 1.27), (2.70, 1.18), (2.92, 0.98), (2.95, 0.90), (2.85, 0.90), (2.65, 1.08),
               (2.30, 1.16), (1.90, 1.07), (1.70, 0.88)], 0.42, x=0.79),
        prism([(1.62, 0.88), (1.60, 0.96), (1.85, 1.15), (2.30, 1.27), (2.70, 1.18), (2.92, 0.98), (2.95, 0.90), (2.85, 0.90), (2.65, 1.08),
               (2.30, 1.16), (1.90, 1.07), (1.70, 0.88)], 0.42, x=-0.79),
        cyl(0.11, 0.10, "z", (0.72, 1.30, 2.66), mirror=True, mat="lamp"),
        cyl(0.05, 0.06, "z", (0.88, 1.22, 2.62), mirror=True, mat="orange"),
        cyl(0.006, 2.2, "y", (-0.80, 2.70, 2.0), mat="black", segs=6),
        # the two loading channels standing up behind the cab, the locker between them
        box((0.05, 1.22, 0.06), (0.96, 1.40, 1.08), mirror=True, mat="steel"),
        box((0.05, 1.22, 0.06), (0.96, 1.40, 0.43), mirror=True, mat="steel"),
        box((1.98, 0.04, 0.04), (0, 1.955, 0.75), mat="steel"),
    ]
    for k in range(6):
        parts.append(box((0.05, 0.04, 0.62), (0.96, 0.92 + k * 0.2, 0.75), mirror=True, mat="steel"))
    parts += [
        box((1.80, 0.50, 0.62), (0, 1.25, 0.75), mat="paint_dark"),
        # the bed: the steel floor, the lockers under it, the jerrycans
        box((1.98, 0.06, 4.15), (0, 0.98, -0.88), mat="paint_dark"),
        box((1.0, 0.21, 0.08), (0, 0.845, 0.3), mat="paint_dark"),
        box((1.0, 0.21, 0.08), (0, 0.845, -0.6), mat="paint_dark"),
        box((1.0, 0.21, 0.08), (0, 0.845, -1.5), mat="paint_dark"),
        box((1.0, 0.21, 0.08), (0, 0.845, -2.4), mat="paint_dark"),
        box((0.40, 0.36, 0.95), (0.80, 0.78, -0.40), mirror=True, mat="paint"),
        box((0.10, 0.34, 0.22), (0.96, 0.76, 0.40), mirror=True, mat="paint_dark"),
        # the perforated bins over the rear wheels and the rear wings, the tailboard
        box((0.36, 0.26, 1.85), (0.80, 1.10, -2.03), mirror=True, mat="paint"),
        box((1.98, 0.30, 0.04), (0, 0.78, -2.97), mat="paint_dark"),
        cyl(0.05, 0.05, "z", (0.80, 0.82, -3.00), mirror=True, mat="lamp"),
    ]
    for k in range(8):
        for j in range(2):
            parts.append(cyl(0.025, 0.01, "x", (0.985, 1.04 + j * 0.12, -1.25 - k * 0.22 - j * 0.11), mirror=True, mat="black", segs=8))
    parts += [
        # the bedrolls lashed beside the gun, the spare wheel flat on the bed
        cyl(0.20, 1.25, "z", (0.62, 1.20, -2.30), mirror=True, mat="canvas", segs=14),
        cyl(0.36, 0.20, "y", (0, 1.11, -2.65), mat="rubber", segs=20),
        # the 6-pounder: the carriage on its axle, the split trails, the curved shield bent at the
        # top, the cradle and recuperator, the breech, the barrel and its muzzle brake
        box((1.20, 0.10, 0.12), (0, 1.18, pz), mount="turret", mat="paint_dark"),
        cyl(0.20, 0.10, "x", (0.62, 1.18, pz), mirror=True, mount="turret", mat="rubber", segs=16),
        box((0.10, 0.10, 0.92), (0.20, 1.10, pz - 0.47), rot=(0, -12, 0), mirror=True, mount="turret", mat="paint_dark"),
        box((0.26, 0.30, 0.30), (0, 1.35, pz), mount="turret", mat="paint_dark"),
        slab([[[0, 1.25, pz + 0.07], [0.30, 1.25, pz + 0.04], [0.30, 1.80, pz + 0.00], [0, 1.80, pz + 0.03]],
              [[0.30, 1.25, pz + 0.04], [0.72, 1.25, pz - 0.12], [0.72, 1.80, pz - 0.16], [0.30, 1.80, pz + 0.00]],
              [[0, 1.80, pz + 0.03], [0.30, 1.80, pz + 0.00], [0.28, 1.92, pz - 0.10], [0, 1.92, pz - 0.07]],
              [[0.30, 1.80, pz + 0.00], [0.72, 1.80, pz - 0.16], [0.68, 1.92, pz - 0.26], [0.28, 1.92, pz - 0.10]]],
             (0, 0, -0.025), mount="turret"),
        box((0.20, 0.18, 0.95), (0, mount[1] - 0.10, pz - 0.15), mount="gun", mat="paint_dark"),
        box((0.18, 0.20, 0.24), (0, mount[1], pz - 0.75), mount="gun", mat="steel"),
        box((0.05, 0.08, 0.30), (-0.16, mount[1] + 0.06, pz - 0.10), mount="gun", mat="black"),
        barrel(mount, pz + 0.10, muzzle_z - 0.20, 0.050, 0.040),
        recoil(cyl(0.065, 0.20, "z", (0, mount[1], muzzle_z - 0.10), mount="gun", mat="paint_dark")),
        recoil(cyl(0.075, 0.03, "z", (0, mount[1], muzzle_z - 0.17), mount="gun", mat="paint_dark")),
    ]
    rg = {"kind": "wheels", "tyre_style": "military",
          "axles": [axle(zf, r, r, 0.30, tread, steer=1), axle(zr, r, r, 0.30, tread)]}
    plates = [
        plate("bonnet_front", "hull_upper_front", "skirt", 2, (0, 1.18, 2.77), (0, 0, 1), (1, 0, 0), 0.55, 0.38),
        plate("bonnet_side_r", "hull_side", "skirt", 2, (0.55, 1.25, 2.05), (1, 0, 0), (0, 0, 1), 0.72, 0.42),
        plate("bonnet_side_l", "hull_side", "skirt", 2, (-0.55, 1.25, 2.05), (-1, 0, 0), (0, 0, 1), 0.72, 0.42),
        plate("bonnet_top", "hull_roof", "skirt", 2, (0, 1.70, 2.15), (0, 1, 0), (1, 0, 0), 0.52, 0.6),
        plate("cab_side_r", "hull_side", "skirt", 2, (0.95, 1.26, 1.69), (1, 0, 0), (0, 0, 1), 0.36, 0.45),
        plate("cab_side_l", "hull_side", "skirt", 2, (-0.95, 1.26, 1.69), (-1, 0, 0), (0, 0, 1), 0.36, 0.45),
        plate("cab_back", "hull_rear", "skirt", 2, (0, 1.26, 1.33), (0, 0, -1), (1, 0, 0), 0.96, 0.45),
        plate("bed_floor", "hull_floor", "skirt", 4, (0, 0.95, -0.88), (0, -1, 0), (1, 0, 0), 0.98, 2.07),
        plate("bin_r", "hull_side", "skirt", 2, (0.98, 1.10, -2.03), (1, 0, 0), (0, 0, 1), 0.92, 0.13),
        plate("bin_l", "hull_side", "skirt", 2, (-0.98, 1.10, -2.03), (-1, 0, 0), (0, 0, 1), 0.92, 0.13),
        plate("tailboard", "hull_rear", "skirt", 3, (0, 0.78, -2.97), (0, 0, -1), (1, 0, 0), 0.98, 0.15),
        # the gun's shield (drawn at the turret's 0 deg; the turret rests turned to the tail)
        plate("gun_shield", "turret_front", "rha", 12, (0, 1.55, pz + 0.04), (0, 0, 1), (1, 0, 0), 0.70, 0.30),
        plate("gun_shield_top", "turret_front", "rha", 12, (0, 1.86, pz - 0.03), (0, 0.64, 0.77), (1, 0, 0), 0.70, 0.08),
    ]
    return {
        "id": "uk_cmp_portee", "name": "CMP 6-pdr Portee", "own_breech": True, "nation": "uk", "cls": "tank_destroyer", "year": 1942, "outline": "traced",
        "based_on": "Chevrolet C60L 3-ton 4x4 (Canadian Military Pattern) portee carrying the Ordnance QF 6-pounder",
        "notes": "Rebuilt from the four-view drawing supplied with the request; its scale is taken from the C60L's 158 in wheelbase. The gun rides on its own carriage facing the tail and fires over the tailboard, 40 degrees either side. Chevrolet 216 six of 85 hp; four gears and the transfer case's high range.",
        "L": L, "W": W, "H": H, "clear": c, "mass": 6400, "com": (0, 0.95, 0.15),
        "turret_pos": (0, 0.98, pz), "turret_size": (1.50, 1.00, 2.20), "ring": 1.0, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "open_top": True, "plates": plates, "facing": 180, "yaw_limit": [-40, 40],
        # over the cab (behind the gun as it rests) it barely dips
        "dep_table": [(0, 5), (140, 5), (150, 1.5), (210, 1.5), (220, 5), (360, 5)],
        "gun": {"id": "qf6pdr_mk2", "caliber_mm": 57.0, "barrel_length_mm": 2565, "recoil_mm": 600, "rounds_per_min": 15.0,
                "reload_s": 4.0, "traverse_deg_s": 12.0, "elevate_deg_s": 6.0, "max_depression_deg": 5.0, "max_elevation_deg": 15.0,
                "dispersion_mrad": 0.8, "mass_kg": 1140, "ammo": ["ap_57_mk7"]},
        "sight": {"name": "Telescope No. 22C", "levels": [{"magnification": 1.9, "fov_deg": 23.0}]},
        "secondary": [],
        "engine": {"horsepower": 85, "max_rpm": 3400, "idle_rpm": 500, "weight_kg": 290,
                   "torque_curve": [[500, 200], [1200, 235], [2000, 230], [3400, 180]]},
        "transmission": {"forward_gears": 4, "reverse_gears": 1, "gear_ratios": [7.06, 3.48, 1.71, 1.0],
                         "final_drive_ratio": 8.6, "shift_time_s": 0.6},
        "physics": {"drive": "wheeled", "track_width_m": 0.30, "track_length_m": 3.98,
                    "suspension": {"kind": "leaf_spring", "travel_m": 0.18}, "suspension_freq_hz": 1.5, "suspension_damping": 0.3,
                    "rolling_resistance": 0.018, "sprocket_radius_m": r, "drivetrain_efficiency": 0.88, "max_brake_decel_ms2": 5.5,
                    "max_turn_rate_deg_s": 28.0, "max_reverse_speed_ms": 4.0, "min_turn_radius_m": 8.5, "max_steer_deg": 32.0},
        "modules": [
            module("engine", "engine", (0, 1.15, 2.30), (0.35, 0.30, 0.40), 80),
            module("transmission", "transmission", (0, 0.85, 1.55), (0.20, 0.14, 0.20), 70),
            module("fuel_tank", "fuel_tank", (0.80, 0.78, -0.40), (0.18, 0.16, 0.45), 40),
            module("ammo_l", "ammo_rack", (-0.80, 0.78, -0.40), (0.18, 0.16, 0.45), 40),
            module("ammo_ready", "ammo_rack", (0, 1.25, 0.75), (0.85, 0.22, 0.28), 40),
            module("breech", "gun_breech", (0, mount[1], pz - 0.75), (0.09, 0.10, 0.14), 70),
            module("gun_barrel", "gun_barrel", (0, mount[1], pz + 1.20), (0.05, 0.05, 1.0), 70),
        ],
        "crew": [crew("driver", (0.45, 1.30, 1.60)), crew("commander", (-0.45, 1.30, 1.60)),
                 crew("gunner", (-0.40, 1.40, pz - 0.60)), dict(crew("loader", (0.40, 1.40, pz - 0.70)), pose="seated")],
        "palette": {"paint": "#b8a57c", "paint_dark": "#8d7d5c", "canvas": "#9a8f6c"},
        "parts": parts,
        "running_gear": rg,
    }


def aufkl_panther():
    """Aufklärungspanzer Panther: the Panther hull and running gear carrying the VK 16.02
    Leopard's turret with the 5 cm KwK 39/1 L/60, as the 1943 proposal had it. The turret, its
    gun and their materials are the user's own Leopard model (VK1602_Leopard_v1_1.glb, its
    Turret_Yaw and Gun_Elevation nodes), set on the Panther's ring; the hull is the generator's
    Panther, with the star aerial on the engine deck."""
    g = panther_g()
    g.pop("dep_table")
    H = g["H"]
    pz = -0.10
    dy = H - 1.72
    mount = (0, 1.72 + 0.285 + dy, 0.825 + pz)
    muzzle_z = 3.27 + pz
    hull_parts = [p for p in g["parts"] if p.get("mount", "hull") == "hull"]
    parts = hull_parts + [
        cyl(0.07, 0.25, "y", (0.95, H + 0.12, -2.95), mat="paint_dark"),
        cyl(0.008, 1.40, "y", (0.95, H + 0.95, -2.95), mat="black", segs=6),
    ]
    for k in range(4):
        a = math.radians(45 + 90 * k)
        parts.append(cyl(0.005, 0.45, "y", (0.95 + 0.10 * math.cos(a), H + 1.78, -2.95 + 0.10 * math.sin(a)),
                         rot=(math.degrees(0.42) * math.sin(a), 0, -math.degrees(0.42) * math.cos(a)), mat="black", segs=5))
    g.update({
        "id": "de_aufkl_panther", "name": "Aufklärungspanzer Panther", "cls": "light", "year": 1943, "outline": "model",
        "based_on": "Aufklärungspanzer Panther: the Panther hull with the VK 16.02 Leopard's turret and the 5 cm KwK 39/1 L/60",
        "notes": "Hull and running gear: the Panther's. Turret, gun and their materials: the user's own VK 16.02 Leopard model, set on the Panther's ring (tools/glb-vehicle.py). Turret armour and rates are estimates.",
        "model": "model.json",
        "mass": 42000, "turret_pos": (0, H, pz), "turret_size": (1.95, 0.70, 1.90), "ring": 1.60, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "parts": parts,
    })
    g["turret_armor"] = {"front": (80, 20, "rha"), "mantlet": (100, 0.55, 0.50, "cha"), "side": (60, 25, "rha"), "rear": (60, "rha"), "roof": 20}
    g["gun"] = {"id": "kwk39_1", "caliber_mm": 50.0, "barrel_length_mm": 3000, "recoil_mm": 330, "rounds_per_min": 15.0,
                "reload_s": 4.0, "traverse_deg_s": 24.0, "elevate_deg_s": 8.0, "max_depression_deg": 8.0, "max_elevation_deg": 20.0,
                "dispersion_mrad": 0.9, "mass_kg": 400, "ammo": ["apc_50_pzgr39"]}
    g["sight"] = {"name": "TZF 4b", "levels": [{"magnification": 2.4, "fov_deg": 25.0}]}
    g["secondary"] = [mg("coax_mg42", "mg42", "coax", (0.20, mount[1], mount[2] + 0.12)), mg("bow_mg34", "mg34", "hull", (0.60, 1.56, 3.06), (10, 10, 15))]
    g["modules"] = [m for m in g["modules"] if m["kind"] not in ("gun_breech", "gun_barrel", "vertical_drive", "turret_drive")] + [
        module("breech", "gun_breech", (0, mount[1], mount[2] - 0.45), (0.10, 0.10, 0.25), 90),
        module("gun_barrel", "gun_barrel", (0, mount[1], mount[2] + 1.40), (0.05, 0.05, 1.00), 90),
        module("turret_drive", "turret_drive", (0, H + 0.10, pz), (0.25, 0.08, 0.25), 70),
    ]
    g["crew"] = [crew("driver", (-0.6, 1.2, 1.35)), crew("radio_operator", (0.6, 1.2, 1.0)),
                 crew("gunner", (-0.40, H + 0.15, pz + 0.25)), crew("commander", (0.35, H + 0.20, pz - 0.40))]
    # the hull in the Leopard model's base colour (its dark yellow, sampled off the camouflage map)
    g["palette"] = {"paint": "#b0aa8b", "paint_dark": "#7c7559"}
    return g


def vk1602():
    """VK 16.02 Leopard: the user's own model (VK1602_Leopard_v1_1.glb), used as it is: hull,
    turret on its yaw node, the gun on its elevation node (trunnion), the wheels on their axles,
    textures and material colours; tools/glb-vehicle.py cuts it into the moving pieces. The
    model's track belts are left out for the game's running tracks."""
    L, W, H, c = 5.40, 3.16, 1.72, 0.47
    piv = (0, H, 0.0)
    mount = (0, H + 0.285, 0.825)
    muzzle_z = 3.27
    wz = [1.32, 0.725, 0.13, -0.465, -1.06]
    wheels = [{"z": z, "y": 0.56, "r": 0.43 if k % 2 == 0 else 0.46, "w": 0.18, "x": 0.0} for k, z in enumerate(wz)]
    return {
        "id": "de_vk1602", "name": "VK 16.02 Leopard", "nation": "germany", "cls": "light", "year": 1943, "outline": "model",
        "based_on": "VK 16.02 Leopard reconnaissance tank (1942-43 design) with the 5 cm KwK 39/1 L/60",
        "notes": "Exterior: the user's own model (VK1602_Leopard_v1_1.glb), used unchanged and cut into its moving pieces by tools/glb-vehicle.py. Figures: about 26 t, Maybach HL 157 P of 550 hp, 60 km/h; 80 mm front, 60 mm sides; turret 80 mm with a 100 mm mantlet. Gear ratios, suspension rates and the interior are estimates.",
        "model": "model.json", "hull_bottom": c,
        "L": L, "W": W, "H": H, "clear": c, "body_w": 2.2, "nose_y": 1.0, "mass": 26000, "com": (0, 1.0, 0.0),
        "turret_pos": piv, "turret_size": (1.95, 0.70, 1.90), "ring": 1.6, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "armor": {"upper_front": (80, 50, "rha"), "lower_front": (80, 50, "rha"), "side": (60, 25, "rha"), "rear": (60, 15, "rha"),
                  "roof": 20, "floor": 20},
        "turret_armor": {"front": (80, 20, "rha"), "mantlet": (100, 0.55, 0.50, "cha"), "side": (60, 25, "rha"), "rear": (60, "rha"), "roof": 20},
        "gun": {"id": "kwk39_1", "caliber_mm": 50.0, "barrel_length_mm": 3000, "recoil_mm": 330, "rounds_per_min": 15.0,
                "reload_s": 4.0, "traverse_deg_s": 24.0, "elevate_deg_s": 8.0, "max_depression_deg": 8.0, "max_elevation_deg": 20.0,
                "dispersion_mrad": 0.9, "mass_kg": 400, "ammo": ["apc_50_pzgr39"]},
        "sight": {"name": "TZF 4b", "levels": [{"magnification": 2.4, "fov_deg": 25.0}]},
        "secondary": [mg("coax_mg42", "mg42", "coax", (0.20, mount[1], 0.95))],
        "engine": {"horsepower": 550, "max_rpm": 3500, "idle_rpm": 700, "weight_kg": 900,
                   "torque_curve": [[700, 1050], [1500, 1260], [2500, 1200], [3500, 1100]]},
        "transmission": {"forward_gears": 7, "reverse_gears": 1, "gear_ratios": [9.21, 4.56, 2.87, 1.83, 1.27, 0.90, 0.68],
                         "final_drive_ratio": 12.9, "shift_time_s": 0.3},
        "physics": {"track_width_m": 0.60, "track_length_m": 2.90, "suspension": {"travel_m": 0.25, "stiffness": 230000, "damping": 17000},
                    "rolling_resistance": 0.045, "sprocket_radius_m": 0.40, "drivetrain_efficiency": 0.82, "max_brake_decel_ms2": 6.0,
                    "max_turn_rate_deg_s": 30.0, "max_reverse_speed_ms": 2.0, "min_turn_radius_m": 0.0},
        "modules": [
            module("engine", "engine", (0, 1.05, -1.75), (0.50, 0.35, 0.50), 140),
            module("transmission", "transmission", (0, 0.85, 2.05), (0.45, 0.25, 0.30), 110),
            module("fuel_tank_l", "fuel_tank", (-0.75, 0.95, -1.20), (0.20, 0.30, 0.35), 45),
            module("fuel_tank_r", "fuel_tank", (0.75, 0.95, -1.20), (0.20, 0.30, 0.35), 45),
            module("ammo_rack_l", "ammo_rack", (-0.95, 1.35, 0.25), (0.15, 0.18, 0.55), 55),
            module("ammo_rack_r", "ammo_rack", (0.95, 1.35, 0.25), (0.15, 0.18, 0.55), 55),
            module("breech", "gun_breech", (0, mount[1], 0.40), (0.10, 0.10, 0.25), 90),
            module("gun_barrel", "gun_barrel", (0, mount[1], 2.20), (0.05, 0.05, 1.00), 90),
            module("turret_drive", "turret_drive", (0, H + 0.10, 0.0), (0.25, 0.08, 0.25), 70),
            module("radio", "radio", (0.55, 1.30, 1.15), (0.14, 0.12, 0.14), 40),
        ],
        "crew": [crew("driver", (-0.55, 1.05, 1.60)), crew("radio_operator", (0.55, 1.05, 1.60)),
                 crew("gunner", (-0.40, H + 0.15, 0.25)), crew("commander", (0.35, H + 0.20, -0.40))],
        "palette": {"paint": "#7d7a5c", "paint_dark": "#55533e"},
        "parts": [],
        "running_gear": {"track_width": 0.60, "track_thickness": 0.09, "track_x": 1.225, "link_pitch": 0.13, "link_style": "twin_guide", "track_sag": 0.03,
                         "sprocket": {"z": 2.12, "y": 0.815, "r": 0.40, "teeth": 18}, "idler": {"z": -1.80, "y": 0.70, "r": 0.33},
                         "wheels": wheels, "rollers": [], "wheel_style": "steel_dish"},
    }


def hetzer_mk103():
    """Hetzer anti-aircraft variant with the 3 cm MK 103: the user's own model
    (flak38t-urban-gray.glb) with the refined interior of Hetzer_Flak_Interior_Refined.glb added
    (the receiver's latches and feed, the traverse gearbox and linkages, the adjustable seat and
    pedals, the radios and the ammunition rack clasps and extinguisher), both used unchanged: the casemate cut down with its folding upper plates,
    the mount on its traverse pivot, the cannon on its elevation pivot, the wheels on their axles;
    the model's track belts are left out for the game's running tracks. The hull's figures and
    armour are the Hetzer's."""
    s = hetzer("flak")
    piv = (0, 1.575, 0.20)
    mount = (0, 1.575 + 0.59, 0.26)
    muzzle_z = 2.06
    wz = [1.397, 0.499, -0.469, -1.367]
    s.update({
        "id": "de_hetzer_mk103", "name": "Hetzer 3 cm MK 103", "cls": "spaa", "year": 1945, "outline": "model", "own_breech": True,
        "based_on": "Hetzer chassis with an open fighting compartment and the 3 cm MK 103 on a pedestal",
        "notes": "Exterior: the user's own model (flak38t-urban-gray.glb); interior: the refined pieces of the user's Hetzer_Flak_Interior_Refined.glb; both used unchanged and cut into their moving pieces by tools/glb-vehicle.py. Hull figures and armour as the Hetzer's; the MK 103's rounds are the service 3 cm types, their penetration estimated.",
        "model": "model.json", "hull_bottom": 0.53, "parts": [],
        "import": {"glb": UPLOADS + "7449fd4f-flak38t-urban-gray.glb",
                   "source": "Hetzer 3 cm MK 103: the user's own models (flak38t-urban-gray.glb, with the interior of Hetzer_Flak_Interior_Refined.glb), used unchanged with the user's permission",
                   "mirror_x": False, "offset": [0, 0, 0], "drop_wide": {"meshes": [12, 13], "x_extent_ge": 0.3},
                   "turret_meshes": [14, 16, 17], "gun_meshes": [15], "barrel_meshes": [15], "barrel_min_length": 1.0,
                   "normal_maps": False, "textures": {"0": 1024},
                   # the refined interior only: the refined file's conversion sits 63 mm lower
                   "add": [{"glb": UPLOADS + "07d74613-Hetzer_Flak_Interior_Refined.glb", "offset": [0, 0.063, 0],
                            "only_nodes": ["Refinement - receiver latches, feed magazine and recoil hardware",
                                           "Refinement - traverse gearbox, elevation spring and control linkages",
                                           "Refinement - adjustable seat, pedal rails and safety fittings",
                                           "Refinement - two radio units, face instruments and wiring",
                                           "Refinement - ammunition rack clasps, fire extinguisher and floor hardware"],
                            "turret_meshes": [], "gun_meshes": [], "barrel_meshes": [], "drop_wide": {}, "drop_meshes": [],
                            "turret_nodes": ["Gun traverse pivot"], "gun_nodes": ["Cannon elevation pivot"], "textures": {}}]},
        "L": 4.85, "W": 2.63, "H": 1.96, "clear": 0.53,
        "turret_pos": piv, "turret_size": (1.30, 1.10, 1.40), "ring": 0.9, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "gun": {"id": "mk103_30", "caliber_mm": 30.0, "barrel_length_mm": 1338, "recoil_mm": 40, "rounds_per_min": 400,
                "reload_s": 0.15, "traverse_deg_s": 40.0, "elevate_deg_s": 30.0, "max_depression_deg": 5.0, "max_elevation_deg": 80.0,
                "dispersion_mrad": 1.3, "mass_kg": 600, "ammo": ["he_30_mgesch"],
                "autocannon": {"rate_rpm": 400, "belt_rounds": 40, "belt_reload_s": 6.0}},
        "sight": {"name": "Flakvisier 38", "levels": [{"magnification": 1.0, "fov_deg": 45.0}, {"magnification": 3.0, "fov_deg": 15.0}]},
        "secondary": [],
        "running_gear": dict(s["running_gear"], track_width=0.40, track_thickness=0.085, track_x=1.045,
                             sprocket={"z": 1.991, "y": 0.813, "r": 0.36, "teeth": 19}, idler={"z": -1.993, "y": 0.689, "r": 0.31},
                             wheels=[{"z": z, "y": 0.503, "r": 0.415, "w": 0.30, "x": 0.0} for z in wz], rollers=[]),
    })
    s["modules"] = [m for m in s["modules"] if m["kind"] not in ("gun_breech", "gun_barrel")] + [
        module("breech", "gun_breech", (0, mount[1], mount[2] - 0.30), (0.08, 0.09, 0.25), 60),
        module("gun_barrel", "gun_barrel", (0, mount[1], mount[2] + 1.10), (0.04, 0.04, 0.55), 60),
    ]
    return s



# Exhaust outlets (hull frame, pointing the way the gas leaves): the T-34-85's two pipes on the
# upper rear plate, the T-54's on the left rear fender, the Shermans' under the deflector of the
# rear overhang, the Hetzer's silencer on the rear plate
EXHAUSTS = {
    "su_t34_85": [{"pos": [x, 1.04, -2.98], "dir": [0, -0.25, -1]} for x in (-0.52, 0.52)],
    "su_t34_1940": [{"pos": [x, 1.04, -2.98], "dir": [0, -0.25, -1]} for x in (-0.52, 0.52)],
    "de_gepard": [{"pos": [x, 1.62, -2.75], "dir": [x, 0.6, -0.4]} for x in (-1.30, 1.30)],
    "su_t54": [{"pos": [-1.30, 1.12, -2.70], "dir": [-0.25, 0.05, -1]}],
    "us_m4a3_75w": [{"pos": [x, 1.20, -2.97], "dir": [0, -0.6, -0.8]} for x in (-0.5, 0.5)],
    "us_m4a3_76w_hvss": [{"pos": [x, 1.20, -2.97], "dir": [0, -0.6, -0.8]} for x in (-0.5, 0.5)],
    "us_m4a1_76w": [{"pos": [x, 1.20, -2.99], "dir": [0, -0.6, -0.8]} for x in (-0.5, 0.5)],
    "us_m4a2": [{"pos": [x, 0.92, -3.00], "dir": [0, -0.7, -0.6]} for x in (-0.45, 0.45)],
    "de_hetzer": [{"pos": [0.0, 1.05, -2.48], "dir": [0, 0.3, -1]}],
    "de_hetzer_flak": [{"pos": [0.0, 1.05, -2.48], "dir": [0, 0.3, -1]}],
    "su_t10m": [{"pos": [x, 1.15, -3.10], "dir": [0, 0.4, -1]} for x in (-0.62, 0.62)],
}


UPLOADS = "/root/.claude/uploads/f0f8a1dd-9cbc-5e68-8a44-696e7e3710e9/"


def bmp_k64(variant):
    """BMP-K-64, a fictional 1964 8x8 armoured personnel carrier: the user's own models, used as
    they are and cut into their moving pieces by tools/glb-vehicle.py. 'base' carries a KPVT in
    its small cupola; 'atgm' the first missile version with two Konkurs tubes on the cupola;
    'kit' the launcher kit: the pedestal with two Kornet canisters, the sight and the thermal
    imager, bolted on in place of the cupola (one of the vehicle's modifications)."""
    L, W, H, c = 6.00, 3.10, 1.86, 0.45
    glb = {"base": "5e9b732b-BMP_K_64.glb", "atgm": "5376b5a5-BMP_K_64_ATGM.glb", "kit": "41334067-BMP_K_64_ATGM.glb"}[variant]
    if variant == "kit":
        piv, mount, muzzle = (0, 2.02, -0.45), (0, 2.48, -0.45), 0.23
        imp = {"turret_nodes": ["ATGM_Yaw"], "gun_nodes": ["ATGM_Elevation"], "level_nodes": ["ATGM_Elevation"]}
    else:
        piv, mount = (0, 1.885, -0.45), (-0.115, 2.205, -0.28)
        muzzle = 1.03 if variant == "base" else 0.45
        imp = {"turret_nodes": ["Turret_Yaw"], "gun_nodes": ["Gun_Elevation"]}
    rg = {"kind": "wheels", "tyre_style": "military",
          "axles": [axle(2.04, 0.58, 0.58, 0.43, 1.315, steer=1), axle(0.72, 0.58, 0.58, 0.43, 1.315, steer=1),
                    axle(-0.64, 0.58, 0.58, 0.43, 1.315), axle(-2.00, 0.58, 0.58, 0.43, 1.315)]}
    guns = {
        "base": {"id": "kpvt_145", "caliber_mm": 14.5, "barrel_length_mm": 1350, "recoil_mm": 5, "rounds_per_min": 600,
                 "reload_s": 0.1, "traverse_deg_s": 35.0, "elevate_deg_s": 30.0, "max_depression_deg": 5.0, "max_elevation_deg": 30.0,
                 "dispersion_mrad": 1.2, "mass_kg": 52, "ammo": ["api_145_b32", "apit_145_bzt44", "apcr_145_bs41"], "ammo_count": [200, 200, 100],
                 "autocannon": {"rate_rpm": 600, "belt_rounds": 50, "belt_reload_s": 8.0}},
        "atgm": {"id": "9p135_konkurs", "caliber_mm": 135.0, "barrel_length_mm": 1200, "recoil_mm": 0, "rounds_per_min": 3.0,
                 "reload_s": 18.0, "traverse_deg_s": 25.0, "elevate_deg_s": 12.0, "max_depression_deg": 10.0, "max_elevation_deg": 20.0,
                 "dispersion_mrad": 0.0, "mass_kg": 90, "ammo": ["heat_135_konkurs"], "ammo_count": [8], "missile": "9m113_konkurs", "guided": True},
        "kit": {"id": "9p163_kornet", "caliber_mm": 152.0, "barrel_length_mm": 1200, "recoil_mm": 0, "rounds_per_min": 4.0,
                "reload_s": 15.0, "traverse_deg_s": 30.0, "elevate_deg_s": 15.0, "max_depression_deg": 10.0, "max_elevation_deg": 25.0,
                "dispersion_mrad": 0.0, "mass_kg": 110, "ammo": ["heat_152_kornet"], "ammo_count": [10], "missile": "9m133_kornet", "guided": True},
    }
    names = {"base": "BMP-K-64", "atgm": "BMP-K-64 ATGM（9M113）", "kit": "BMP-K-64 ATGM 套件（9M133）"}
    years = {"base": 1964, "atgm": 1974, "kit": 1994}
    return {
        "id": {"base": "xp_bmp_k64", "atgm": "xp_bmp_k64_atgm", "kit": "xp_bmp_k64_kornet"}[variant],
        "name": names[variant], "nation": "fictional", "cls": "armored_car" if variant == "base" else "tank_destroyer",
        "year": years[variant], "outline": "model",
        "based_on": "BMP-K-64: a fictional 8x8 armoured personnel carrier prototype",
        "notes": f"Exterior: the user's own model ({glb.split('-', 1)[1]}), used unchanged and cut into its moving pieces by tools/glb-vehicle.py. Built on T-64 components: the hull armour is the T-64A's (80 mm steel + 105 mm glass-textolite + 20 mm steel upper front at 68 degrees, 80 mm sides, 45 mm rear) and the 5TDF of 700 hp; 60 km/h on the road as the user specified. The interior is an estimate.",
        "model": "model.json", "hull_bottom": c,
        "import": dict({"glb": UPLOADS + glb, "source": f"BMP-K-64: the user's own model ({glb.split('-', 1)[1]}), used unchanged with the user's permission",
                        "mirror_x": False, "offset": [0, 0, 0], "barrel_meshes": [], "normal_maps": False,
                        "textures": {"0": 1024, "1": 512, "2": 512}}, **imp,
                       # the missile versions are the same vehicle: their hull and wheels are the base's
                       **({} if variant == "base" else {"share": {"from": "xp_bmp_k64", "mounts": ["hull", "road_wheel"], "keep_nodes": ["ATGM_Base"]}})),
        "L": L, "W": W, "H": H, "clear": c, "body_w": 2.4, "nose_y": 1.30, "mass": 26000, "com": (0, 1.20, 0.10),
        "turret_pos": piv, "turret_size": (1.06, 0.74, 1.40), "ring": 0.90, "mount": mount, "muzzle_offset": muzzle - mount[2],
        # the T-64A hull's armour (the vehicle is built on T-64 components)
        "armor": {"upper_front": (205, 68, "composite"), "lower_front": (80, 60, "rha"), "side": (80, 0, "rha"), "rear": (45, 0, "rha"),
                  "roof": 20, "floor": 20},
        "turret_armor": {"front": (10, 20, "rha"), "mantlet": (10, 0.30, 0.25, "rha"), "side": (8, 15, "rha"), "rear": (7, "rha"), "roof": 6},
        "gun": guns[variant],
        "sight": {"name": "PP-61" if variant == "base" else ("9Sh119" if variant == "atgm" else "1P45 + thermal"),
                  "levels": [{"magnification": 2.6, "fov_deg": 23.0}, {"magnification": 8.0 if variant == "kit" else 6.0, "fov_deg": 6.0}]},
        "secondary": [],
        # the T-64's 5TDF two-stroke opposed-piston diesel; geared for 60 km/h
        "engine": {"horsepower": 700, "max_rpm": 2800, "idle_rpm": 800, "weight_kg": 1040,
                   "torque_curve": [[800, 1650], [1600, 2050], [2200, 1950], [2800, 1780]]},
        "transmission": {"forward_gears": 7, "reverse_gears": 1, "gear_ratios": [8.2, 4.6, 3.2, 2.3, 1.7, 1.3, 1.0], "final_drive_ratio": 9.69, "shift_time_s": 0.4},
        "physics": {"drive": "wheeled", "track_width_m": 0.43, "track_length_m": 4.04,
                    "suspension": {"kind": "torsion_bar", "travel_m": 0.30}, "suspension_freq_hz": 1.2, "suspension_damping": 0.35,
                    "rolling_resistance": 0.018, "sprocket_radius_m": 0.58, "drivetrain_efficiency": 0.86, "max_brake_decel_ms2": 6.0,
                    "max_turn_rate_deg_s": 28.0, "max_reverse_speed_ms": 5.0, "min_turn_radius_m": 9.5, "max_steer_deg": 30.0},
        "modules": [
            module("engine", "engine", (0.30, 1.15, 1.55), (0.45, 0.30, 0.50), 120),
            module("transmission", "transmission", (0.0, 0.85, 0.55), (0.35, 0.20, 0.30), 100),
            module("fuel_tank_l", "fuel_tank", (-0.85, 1.05, -1.70), (0.25, 0.30, 0.40), 40),
            module("fuel_tank_r", "fuel_tank", (0.85, 1.05, -1.70), (0.25, 0.30, 0.40), 40),
            module("ammo_rack", "ammo_rack", (0.0, 1.30, -0.90), (0.35, 0.20, 0.30), 50),
            module("breech", "gun_breech", (mount[0], mount[1] - 0.05, mount[2] - 0.20), (0.08, 0.08, 0.20), 50),
            module("gun_barrel", "gun_barrel", (mount[0], mount[1], (mount[2] + muzzle) / 2), (0.04, 0.04, (muzzle - mount[2]) / 2), 50),
            module("radio", "radio", (-0.70, 1.40, 0.90), (0.18, 0.14, 0.14), 40),
            module("turret_drive", "turret_drive", (0.0, piv[1] - 0.10, piv[2]), (0.15, 0.08, 0.15), 50),
        ],
        "crew": [crew("driver", (-0.67, 1.45, 0.45)), crew("commander", (0.67, 1.45, 0.45)), crew("gunner", (0.0, piv[1] - 0.20, piv[2] - 0.05))] + ([] if variant == "base" else [crew("loader", (0.0, 1.40, -1.55))]),
        "palette": {"paint": "#5f6640", "paint_dark": "#434a2e"},
        "parts": [],
        "running_gear": rg,
    }


def att_m46():
    """AT-T heavy artillery tractor carrying a 130 mm M-46 field gun on its bed (a field
    conversion): the user's own model (AT_T_M46_130mm_PhotoReplica.glb), used as it is. The model
    runs along its +x, so its x and z trade places; the gun, modelled at 28 degrees, is set level
    for the game to elevate; the track belts are left out for the game's running tracks."""
    L, W, H, c = 6.99, 3.18, 3.00, 0.42
    piv = (0, 1.59, -0.58)
    mount = (0, 2.77, -0.45)
    muzzle_z = 6.09
    wz = [1.91, 0.973, 0.036, -0.901, -1.838]
    return {
        "id": "su_att_m46", "name": "AT-T 130 mm 自走炮（M-46）", "nation": "ussr", "cls": "spg", "year": 1960, "outline": "model",
        "based_on": "AT-T heavy artillery tractor with a 130 mm M-46 field gun mounted on its bed (an improvised self-propelled gun)",
        "notes": "Exterior: the user's own model (AT_T_M46_130mm_PhotoReplica.glb), used unchanged and cut into its moving pieces by tools/glb-vehicle.py. AT-T: about 20 t, A-401 diesel of 415 hp, 35 km/h; M-46: 130 mm L/55, -2.5..+45 degrees, separate loading, up to 6 rds/min. The gun's traverse on the bed, the crew's protection (none but the shield) and the interior are estimates.",
        "model": "model.json", "hull_bottom": 0.54, "own_breech": True, "open_top": True,
        "import": {"glb": UPLOADS + "4a174728-AT_T_M46_130mm_PhotoReplica.glb",
                   "source": "AT-T with the 130 mm M-46: the user's own model (AT_T_M46_130mm_PhotoReplica.glb), used unchanged with the user's permission",
                   "swap_xz": True, "mirror_x": False, "offset": [0, 0, 0], "drop_nodes": ["Track_L", "Track_R"],
                   "turret_nodes": ["Gun_Traverse"], "gun_nodes": ["Gun_Elevation"], "barrel_nodes": ["Gun_Elevation"], "barrel_min_length": 3.0, "barrel_ahead_z": 0.6,
                   "level_nodes": ["Gun_Elevation"], "normal_maps": False, "textures": {"0": 1024, "1": 1024, "2": 1024}},
        "L": L, "W": W, "H": H, "clear": c, "body_w": 2.2, "nose_y": 1.30, "mass": 28500, "com": (0, 1.25, 0.10),
        "turret_pos": piv, "turret_size": (2.60, 1.70, 2.20), "ring": 1.6, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "yaw_limit": [-25, 25],
        "armor": {"upper_front": (6, 30, "rha"), "lower_front": (6, 20, "rha"), "side": (4, 0, "rha"), "rear": (4, 0, "rha"),
                  "roof": 3, "floor": 4},
        "turret_armor": {"front": (6, 15, "rha"), "mantlet": (6, 0.80, 1.00, "rha"), "side": (1, 0, "rha"), "rear": (1, "rha"), "roof": 1},
        "gun": {"id": "m46_130", "caliber_mm": 130.0, "barrel_length_mm": 7600, "recoil_mm": 1000, "rounds_per_min": 6.0,
                "reload_s": 10.0, "traverse_deg_s": 3.0, "elevate_deg_s": 3.0, "max_depression_deg": 2.5, "max_elevation_deg": 45.0,
                "dispersion_mrad": 0.5, "mass_kg": 7700, "ammo": ["apcbc_130_br482b"]},
        "sight": {"name": "OP4M-35", "levels": [{"magnification": 5.5, "fov_deg": 11.0}]},
        "secondary": [],
        "engine": {"horsepower": 415, "max_rpm": 1700, "idle_rpm": 500, "weight_kg": 1500,
                   "torque_curve": [[500, 1700], [1000, 2000], [1400, 1950], [1700, 1750]]},
        "transmission": {"forward_gears": 5, "reverse_gears": 1, "gear_ratios": [6.3, 3.7, 2.3, 1.5, 1.0], "final_drive_ratio": 9.0, "shift_time_s": 0.6},
        "physics": {"track_width_m": 0.50, "track_length_m": 3.75, "suspension": {"travel_m": 0.20, "stiffness": 320000, "damping": 22000},
                    "rolling_resistance": 0.045, "sprocket_radius_m": 0.42, "drivetrain_efficiency": 0.8, "max_brake_decel_ms2": 5.0,
                    "max_turn_rate_deg_s": 22.0, "max_reverse_speed_ms": 2.0, "min_turn_radius_m": 0.0},
        "modules": [
            module("engine", "engine", (0, 1.30, 2.10), (0.55, 0.40, 0.65), 150),
            module("transmission", "transmission", (0, 0.95, 3.10), (0.50, 0.25, 0.28), 120),
            module("fuel_tank_l", "fuel_tank", (-0.95, 1.30, 0.20), (0.25, 0.25, 0.45), 50),
            module("fuel_tank_r", "fuel_tank", (0.95, 1.30, 0.20), (0.25, 0.25, 0.45), 50),
            module("ammo_rack", "ammo_rack", (0, 1.80, -2.20), (0.80, 0.25, 0.50), 80),
            module("breech", "gun_breech", (0, mount[1], mount[2] - 1.0), (0.22, 0.22, 0.45), 150),
            module("gun_barrel", "gun_barrel", (0, mount[1], mount[2] + 3.6), (0.09, 0.09, 2.9), 160),
            module("turret_drive", "turret_drive", (0.40, piv[1] + 0.15, piv[2]), (0.15, 0.12, 0.15), 70),
        ],
        "crew": [crew("driver", (-0.55, 1.95, 0.55)), crew("commander", (0.55, 1.95, 0.55)),
                 crew("gunner", (-0.65, 2.15, -0.90)), crew("loader", (0.55, 2.05, -1.80))],
        "palette": {"paint": "#56603d", "paint_dark": "#3c432a"},
        "parts": [],
        "running_gear": {"track_width": 0.50, "track_thickness": 0.08, "track_x": 1.318, "link_pitch": 0.16, "link_style": "twin_guide", "track_sag": 0.03,
                         "sprocket": {"z": 2.79, "y": 0.955, "r": 0.42, "teeth": 14}, "idler": {"z": -2.70, "y": 0.89, "r": 0.36},
                         "wheels": [{"z": z, "y": 0.58, "r": 0.47, "w": 0.30, "x": 0.0} for z in wz], "rollers": [], "wheel_style": "spoked"},
    }


def hetzer_mk103_camo():
    """The 3 cm MK 103 Hetzer in its three-colour camouflage: the user's own model
    (flak38t-reconstruction-v2.glb), the same vehicle as the grey one, used as it is."""
    s = hetzer_mk103()
    s.update({
        "id": "de_hetzer_mk103_camo", "name": "Hetzer 3 cm MK 103（三色迷彩）",
        "notes": s["notes"].replace("flak38t-urban-gray.glb", "flak38t-reconstruction-v2.glb, three-colour camouflage"),
    })
    s["notes"] = s["notes"].replace("flak38t-urban-gray.glb", "flak38t-reconstruction-v2.glb, three-colour camouflage")
    s["import"] = {"glb": UPLOADS + "9a01732b-flak38t-reconstruction-v2.glb",
                   "source": "Hetzer 3 cm MK 103 (camouflage): the user's own model (flak38t-reconstruction-v2.glb), used unchanged with the user's permission",
                   "mirror_x": False, "offset": [0, 0, 0], "drop_wide": {"meshes": [12, 13], "x_extent_ge": 0.3},
                   "turret_meshes": [14, 16, 17], "gun_meshes": [15], "barrel_meshes": [15], "barrel_min_length": 1.0,
                   "normal_maps": False, "textures": {"0": 2048}, "add": hetzer_mk103()["import"]["add"]}
    s["running_gear"] = dict(s["running_gear"], track_width=0.40, track_thickness=0.085, track_x=1.045,
                             sprocket={"z": 1.991, "y": 0.813, "r": 0.36, "teeth": 19}, idler={"z": -1.993, "y": 0.689, "r": 0.31},
                             wheels=[{"z": z, "y": 0.503, "r": 0.415, "w": 0.30, "x": 0.0} for z in (1.397, 0.499, -0.469, -1.367)])
    return s


def sdkfz1401():
    """Sd.Kfz. 140/1 Aufklärungspanzer 38(t): the late Panzer 38(t) chassis with the open-topped
    Hängelafette 38 turret (2 cm KwK 38 and a coaxial MG 42 under its wire-mesh screens). The
    user's own model (Sdkfz1401_Material_Refined.glb), with its refined interior and materials,
    used unchanged; it faces -z, so it is turned half round; its track belts are left out for the
    game's running tracks and its road wheels turn on their axles."""
    L, W, H, c = 4.61, 2.15, 1.48, 0.38
    pz = 0.35
    piv = (0, H, pz)
    mount = (0, 1.90, 0.34)
    muzzle_z = 2.21
    wz = [1.29, 0.46, -0.47, -1.31]
    return {
        "id": "de_sdkfz140_1", "name": "Sd.Kfz. 140/1 Aufklärungspanzer 38(t)", "nation": "germany", "cls": "light", "year": 1944,
        "outline": "model", "own_breech": True, "open_top": True,
        "based_on": "Aufklärungspanzer 38(t) (Sd.Kfz. 140/1) with the Hängelafette 38: 2 cm KwK 38 and MG 42",
        "notes": "Exterior and interior: the user's own model (Sdkfz1401_Material_Refined.glb), used unchanged and cut into its moving pieces by tools/glb-vehicle.py. Figures: about 9.75 t, Praga AC of 160 hp, 42 km/h; 15 mm hull front, 10 mm sides; the turret 30 mm at the front. Gear ratios and the interior layout are estimates.",
        "model": "model.json", "hull_bottom": c, "parts": [],
        "import": {"glb": UPLOADS + "4de8d9e9-Sdkfz1401_Material_Refined.glb",
                   "source": "Sd.Kfz. 140/1: the user's own model (Sdkfz1401_Material_Refined.glb), used unchanged with the user's permission",
                   "mirror_x": False, "rotate_180": True, "offset": [0, 0, 0], "drop_meshes": [2, 3],
                   "turret_nodes": ["vertices.002", "DETAIL / Turret inner race, ring teeth and lubrication fittings",
                                    "DETAIL / Combined handwheel slider, coupling and Bowden trigger cables",
                                    "DETAIL / Magazine retention lips and spring catch detail",
                                    "DETAIL / Seat height clamps, collars and pan underside fasteners",
                                    "DETAIL / Lower crew footrest plates and anti-slip floor inserts",
                                    "DETAIL / KwK 38 canvas case bag and retaining flange",
                                    "DETAIL / MG42 spent case box pressed ribs and latch",
                                    "DETAIL / Existing optical sight diopter rings and protective fittings",
                                    "DETAIL / Cradle bearing lubrication, lid hinge keepers and tether chains"],
                   "gun_nodes": ["gun_shape", "DETAIL / KwK 38 receiver locking pins, recoil seals and cradle clamps"],
                   "normal_maps": False, "textures": {"0": 1024, "2": 1024, "6": 2048}},
        "L": L, "W": W, "H": H, "clear": c, "body_w": 2.0, "nose_y": 1.05, "mass": 9750, "com": (0, 0.95, 0.0),
        "turret_pos": piv, "turret_size": (1.70, 0.80, 1.80), "ring": 1.30, "mount": mount, "muzzle_offset": muzzle_z - mount[2],
        "armor": {"upper_front": (15, 30, "rha"), "lower_front": (15, 20, "rha"), "side": (10, 0, "rha"), "rear": (10, 10, "rha"),
                  "roof": 8, "floor": 8},
        "turret_armor": {"front": (30, 25, "rha"), "mantlet": (30, 0.40, 0.30, "rha"), "side": (10, 25, "rha"), "rear": (10, "rha"), "roof": 0},
        "gun": {"id": "kwk38_20", "caliber_mm": 20.0, "barrel_length_mm": 1900, "recoil_mm": 30, "rounds_per_min": 450,
                "reload_s": 0.133, "traverse_deg_s": 20.0, "elevate_deg_s": 20.0, "max_depression_deg": 4.0, "max_elevation_deg": 70.0,
                "dispersion_mrad": 1.4, "mass_kg": 110, "ammo": ["hefi_20_sprgr"],
                "autocannon": {"rate_rpm": 450, "belt_rounds": 10, "belt_reload_s": 3.0}},
        "sight": {"name": "TZF 3a", "levels": [{"magnification": 2.5, "fov_deg": 25.0}]},
        "secondary": [mg("coax_mg42", "mg42", "coax", (-0.40, 1.83, 1.25))],
        "engine": {"horsepower": 160, "max_rpm": 2600, "idle_rpm": 600, "weight_kg": 410,
                   "torque_curve": [[600, 350], [1400, 465], [2000, 455], [2600, 415]]},
        "transmission": {"forward_gears": 5, "reverse_gears": 1, "gear_ratios": [6.8, 3.9, 2.4, 1.5, 1.0], "final_drive_ratio": 7.6, "shift_time_s": 0.5},
        "physics": {"track_width_m": 0.29, "track_length_m": 2.95, "suspension": {"travel_m": 0.14, "stiffness": 100000, "damping": 8000},
                    "rolling_resistance": 0.04, "sprocket_radius_m": 0.34, "drivetrain_efficiency": 0.82, "max_brake_decel_ms2": 6.0,
                    "max_turn_rate_deg_s": 32.0, "max_reverse_speed_ms": 2.0, "min_turn_radius_m": 0.0},
        "modules": [
            module("engine", "engine", (0, 0.85, -1.45), (0.45, 0.35, 0.50), 120),
            module("transmission", "transmission", (0, 0.70, 1.85), (0.45, 0.25, 0.30), 100),
            module("fuel_tank", "fuel_tank", (0.55, 0.80, -0.55), (0.20, 0.25, 0.15), 40),
            module("ammo_rack", "ammo_rack", (-0.50, 1.30, 0.15), (0.12, 0.15, 0.20), 40),
            module("ammo_turret", "ammo_rack", (0.0, 1.62, -0.10), (0.20, 0.06, 0.10), 30),
            module("breech", "gun_breech", (0, mount[1], mount[2] - 0.25), (0.06, 0.07, 0.25), 50),
            module("gun_barrel", "gun_barrel", (0, mount[1], (mount[2] + muzzle_z) / 2 + 0.25), (0.03, 0.03, (muzzle_z - mount[2]) / 2 - 0.25), 50),
            module("radio", "radio", (0.55, 1.30, 0.20), (0.10, 0.15, 0.15), 40),
            module("turret_drive", "turret_drive", (0.30, 1.60, 0.35), (0.12, 0.12, 0.12), 40),
        ],
        "crew": [crew("driver", (0.45, 1.00, 1.30)), crew("radio_operator", (-0.45, 1.00, 1.30)),
                 crew("commander", (-0.30, 1.55, 0.10)), crew("gunner", (0.30, 1.55, 0.20))],
        "palette": {"paint": "#6f6a4a", "paint_dark": "#4f4b34"},
        "running_gear": {"track_width": 0.29, "track_thickness": 0.04, "track_x": 0.90, "link_pitch": 0.10, "link_style": "center_guide", "track_sag": 0.02,
                         "sprocket": {"z": 1.92, "y": 0.75, "r": 0.34, "teeth": 19}, "idler": {"z": -1.97, "y": 0.57, "r": 0.27},
                         "wheels": [{"z": z, "y": 0.43, "r": 0.39, "w": 0.20, "x": 0.0} for z in wz],
                         "rollers": [{"z": 0.0, "y": 0.83, "r": 0.10, "w": 0.10}, {"z": 0.89, "y": 0.89, "r": 0.10, "w": 0.10}],
                         "wheel_style": "rubber_dish"},
    }

def proto_visual():
    """Simple exterior for the fictional proto_a vehicle (its other files are hand-written)."""
    c, H = 0.40, 1.10
    piv = (0, 1.1, 0.2)
    mount = (0, 1.6, 1.5)
    muzzle_z = mount[2] + 3.3
    tx = 1.25
    return {
        "palette": {"paint": "#5d6872", "paint_dark": "#414a52"},
        "parts": [
            prism([(-2.9, c), (2.5, c), (3.1, 0.75), (2.4, H), (-2.9, H), (-3.1, 0.8)], 1.9),
            prism([(-3.0, 0.82), (3.0, 0.82), (2.4, H), (-2.9, H)], 3.0, wt=2.7),
            box((0.52, 0.03, 5.8), (tx, 0.86, 0), mirror=True, mat="paint_dark"),
            box((1.6, 0.03, 1.4), (0, H + 0.015, -2.0), mat="black"),
            plan(superellipse(0, piv[2] + 0.05, 1.08, 1.25, 1.3, p=3.2), H, 2.0, scale_top=(0.82, 0.85), smooth=True),
            box((1.0, 0.6, 0.14), (0, 1.6, piv[2] + 1.27), mount="gun"),
            barrel(mount, piv[2] + 1.3, muzzle_z - 0.3, 0.07, 0.055),
            recoil(cyl(0.09, 0.3, "z", (0, 1.6, muzzle_z - 0.15), mount="gun", mat="paint_dark")),
            cyl(0.32, 0.16, "y", (-0.4, 2.08, piv[2] - 0.3), mount="turret"),
        ],
        "running_gear": {"track_width": 0.50, "track_thickness": 0.055, "track_x": tx, "link_pitch": 0.14, "link_style": "center_guide", "track_sag": 0.012,
                         "sprocket": {"z": -2.66, "y": 0.47, "r": 0.30, "teeth": 14}, "idler": {"z": 2.66, "y": 0.46, "r": 0.26},
                         "wheels": wheel_row([2.0, 1.2, 0.4, -0.4, -1.2, -2.0], 0.33 + 0.055, 0.33, 0.30),
                         "rollers": [{"z": 1.3, "y": 0.69, "r": 0.08, "w": 0.2}, {"z": 0.0, "y": 0.69, "r": 0.08, "w": 0.2},
                                     {"z": -1.3, "y": 0.69, "r": 0.08, "w": 0.2}], "wheel_style": "rubber_dish"},
    }


BASE_PALETTE = {"steel": "#6a6d70", "rubber": "#1c1c1d", "track": "#4a4743", "black": "#151515"}

# -------------------------------------------------------------------------- checking


def inside(spec, p, m):
    W, H, L = spec["W"], spec["H"], spec["L"]
    px, py, pz = spec["turret_pos"]
    tw, th, tl = spec["turret_size"]
    hull = abs(p[0]) <= W / 2 + m and -m <= p[1] <= H + m and abs(p[2]) <= L / 2 + m
    tur = abs(p[0] - px) <= tw / 2 + m and py - m <= p[1] <= py + th + m and abs(p[2] - pz) <= tl / 2 + m
    return hull or tur


def check(spec, plates, modules, crew_list):
    """Mirror of the geometric rules in crates/vehicle validate.rs (P003/P004/P008/M004/M006/C003)."""
    problems = []
    for p in plates:
        c, n, u = p["center"], p["normal"], p["axis_u"]
        if abs(math.sqrt(n["x"] ** 2 + n["y"] ** 2 + n["z"] ** 2) - 1) > 0.01:
            problems.append("P003 " + p["id"])
        if abs(n["x"] * u["x"] + n["y"] * u["y"] + n["z"] * u["z"]) > 0.01:
            problems.append("P004 " + p["id"])
        if not inside(spec, (c["x"], c["y"], c["z"]), 0.1):
            problems.append("P008 " + p["id"])
    ext = ("gun_barrel", "track", "aps_gun", "aps_radar")
    for m in modules:
        if m["kind"] in ext:
            continue
        c, h = m["center"], m["half_extents"]
        for k in range(8):
            q = (c["x"] + (h["x"] if k & 1 else -h["x"]), c["y"] + (h["y"] if k & 2 else -h["y"]), c["z"] + (h["z"] if k & 4 else -h["z"]))
            if not inside(spec, q, 0.05):
                problems.append("M004 %s corner %s" % (m["id"], q))
                break
    for i, a in enumerate(modules):
        for b in modules[i + 1:]:
            if a["kind"] in ext or b["kind"] in ext:
                continue
            if all(abs(a["center"][k] - b["center"][k]) < a["half_extents"][k] + b["half_extents"][k] for k in "xyz"):
                problems.append("M006 %s/%s overlap" % (a["id"], b["id"]))
    for cm in crew_list:
        p = cm["pos"]
        if not inside(spec, (p["x"], p["y"], p["z"]), 0.05):
            problems.append("C003 " + cm["role"])
    return problems


def dump(path, obj, compact_lists=True):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    text = json.dumps(obj, indent=1, ensure_ascii=False)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text + "\n")


# Suspension type of each vehicle (the ride model pairs the wheels of bogie kinds on one arm) and
# the gun stabilizer it carried (the M4A3 W tanks had the Westinghouse vertical gyrostabilizer).
SUSPENSION_KIND = {
    "de_panther_g": "interleaved", "de_tiger_e": "interleaved", "de_pz3_j": "torsion_bar", "de_pz4_h": "leaf_bogie",
    "su_is2": "torsion_bar", "su_t54": "torsion_bar", "su_t34_85": "christie", "su_t34_1940": "christie", "uk_cromwell_iv": "christie",
    "us_m10": "volute", "us_m4a3_75w": "volute", "us_m4a3_76w_hvss": "hvss", "proto_a": "torsion_bar",
    "us_m4a1_76w": "volute", "us_m4a2": "volute", "de_gepard": "torsion_bar",
    "de_panther_f": "interleaved", "de_sdkfz140_1": "leaf_bogie", "su_t10m": "torsion_bar", "us_m901_itv": "torsion_bar",
}
STABILIZER = {"de_gepard": "two_plane", "us_m4a3_75w": "vertical", "us_m4a3_76w_hvss": "vertical", "us_m4a1_76w": "vertical", "us_m4a2": "vertical", "su_t10m": "two_plane", "xp_kda35": "two_plane", "xp_w78": "two_plane"}


def with_kind(vid, physics):
    p = dict(physics)
    if vid in SUSPENSION_KIND:
        p["suspension"] = dict({"kind": SUSPENSION_KIND[vid]}, **p["suspension"])
    return p


def write_vehicle(s):
    d = os.path.join(DATA, "vehicles", s["id"])
    plates = s["plates"] if "plates" in s else hull_plates(s) + turret_plates(s)
    wheeled = s["running_gear"].get("kind") == "wheels"
    modules = s["modules"] + (wheels_modules(s) if wheeled else tracks_modules(s))
    problems = check(s, plates, modules, s["crew"])
    vehicle = {
        "id": s["id"], "name": s["name"], "schema_version": 1, "model": s.get("model", "model.glb"),
        "meta": {"nation": s["nation"], "class": s["cls"], "year": s["year"], "outline": s["outline"],
                 "based_on": s["based_on"], "notes": s["notes"]},
        "files": {"armor": "armor.json", "weapons": "weapons.json", "engine": "engine.json", "crew": "crew.json",
                  "modules": "modules.json", "visual": "visual.json"},
        "hull": {"size_m": [s["W"], s["H"], s["L"]], "mass_kg": s["mass"], "center_of_mass": list(s["com"])},
        "turret": {"size_m": list(s["turret_size"]), "ring_diameter_m": s["ring"], "position_m": [r3(k) for k in s["turret_pos"]]},
        "physics": with_kind(s["id"], s["physics"]),
    }
    if s.get("open_top"):
        vehicle["turret"]["open_top"] = True
    if s["id"] in AMMO:
        s["gun"]["ammo"] = [a for a, _ in AMMO[s["id"]]]
        s["gun"]["ammo_count"] = [n for _, n in AMMO[s["id"]]]
    weapons = {"main_gun": s["gun"], "mount_m": [r3(k) for k in s["mount"]], "muzzle_offset_m": r3(s["muzzle_offset"]),
               "sight": s["sight"], "secondary": s["secondary"]}
    if s["id"] in STABILIZER:
        weapons = {k: v for k, v in list(weapons.items())[:4]} | {"stabilizer": STABILIZER[s["id"]]} | {"secondary": s["secondary"]}
    if s.get("facing"):
        # a gun carried facing another way (a portee's over the tail)
        weapons["facing_deg"] = r3(s["facing"])
    if s.get("dep_table"):
        weapons["depression_by_bearing_deg"] = depression_table(s["dep_table"])
    if s.get("yaw_limit"):
        # a casemate or shielded mount: the gun traverses only this far either side
        weapons["yaw_limit_deg"] = [r3(k) for k in s["yaw_limit"]]
    if s.get("aps"):
        weapons["aps"] = s["aps"]
    if s.get("extra_guns"):
        weapons["extra_guns"] = s["extra_guns"]
    if s.get("extra_turrets"):
        weapons["extra_turrets"] = s["extra_turrets"]
    visual = {"schema_version": 1, "palette": dict(BASE_PALETTE, **s["palette"]), "parts": s["parts"], "running_gear": s["running_gear"]}
    if s.get("hull_bottom") is not None:
        visual["hull_bottom"] = s["hull_bottom"]
    if s.get("own_breech"):
        # the open mount's gun is modelled in full: no generic breech drawn over it
        visual["own_breech"] = True
    dump(os.path.join(d, "vehicle.json"), vehicle)
    dump(os.path.join(d, "armor.json"), plates)
    dump(os.path.join(d, "weapons.json"), weapons)
    dump(os.path.join(d, "engine.json"), {"engine": s["engine"], "transmission": s["transmission"]})
    dump(os.path.join(d, "crew.json"), s["crew"])
    dump(os.path.join(d, "modules.json"), modules)
    # the engine's exhaust: the vehicle's own outlets where they are known, and its fuel
    diesel = s["id"].startswith("su_") or s["id"].startswith("xp_") or s["id"] in ("us_m10", "us_m901_itv", "us_m4a2", "de_gepard")
    visual["exhaust"] = dict({"fuel": "diesel" if diesel else "petrol"}, **({"outlets": EXHAUSTS[s["id"]]} if s["id"] in EXHAUSTS else {}))
    dump(os.path.join(d, "visual.json"), visual)
    if s.get("import"):
        dump(os.path.join(d, "import.json"), s["import"])
    return problems


def patch_proto():
    d = os.path.join(DATA, "vehicles", "proto_a")
    v = json.load(open(os.path.join(d, "vehicle.json")))
    v["files"]["visual"] = "visual.json"
    v["meta"] = {"nation": "fictional", "class": "prototype", "year": 0, "outline": "original",
                 "based_on": "original design", "notes": "Test vehicle used by the unit tests."}
    v["physics"] = with_kind("proto_a", {k: val for k, val in v["physics"].items()} | {"suspension": {k: val for k, val in v["physics"]["suspension"].items() if k != "kind"}})
    dump(os.path.join(d, "vehicle.json"), v)
    w = json.load(open(os.path.join(d, "weapons.json")))
    w["muzzle_offset_m"] = 3.3
    w["secondary"] = [mg("coax_mg", "mg_proto", "coax", (0.3, 1.6, 1.62))]
    w["sight"] = {"name": "Prototype sight", "levels": [{"magnification": 3.0, "fov_deg": 18.0}, {"magnification": 6.0, "fov_deg": 9.0}]}
    dump(os.path.join(d, "weapons.json"), w)
    pv = proto_visual()
    dump(os.path.join(d, "visual.json"), {"schema_version": 1, "palette": dict(BASE_PALETTE, **pv["palette"]),
                                          "parts": pv["parts"], "running_gear": pv["running_gear"]})


def main():
    bad = 0
    for sh in SHELLS:
        dump(os.path.join(DATA, "projectiles", sh["id"] + ".json"), sh)
        print("shell %-14s pen@0m %.0f mm, @1000m %.0f mm" % (sh["id"], sh["penetration_curve"][0]["pen_mm"], sh["penetration_curve"][3]["pen_mm"]))
    dump(os.path.join(DATA, "machine_guns.json"), MACHINE_GUNS)
    dump(os.path.join(DATA, "missiles.json"), MISSILES)
    for build in (pz3j, pz4h, tiger, panther_g, panther_f, t34_85, t34_1940, is2, gepard, t10m, t54, m4a3_75w, sherman, m4a1_76w, m4a2, m10, cromwell, m8, puma, kda35, w78, m113_tow, pzjg1, flak38t, hetzer_jagd, hetzer_flak, rso_flak, rso_pak40, cmp_portee, aufkl_panther, vk1602, hetzer_mk103, hetzer_mk103_camo, sdkfz1401,
                  lambda: bmp_k64("base"), lambda: bmp_k64("atgm"), lambda: bmp_k64("kit"), att_m46):
        s = build()
        problems = write_vehicle(s)
        if s["running_gear"].get("kind") == "wheels":
            # tyre ground pressure: the load of one wheel on its contact patch (~ width x 0.6 r)
            ax = s["running_gear"]["axles"]
            kpa = s["mass"] * 9.81 / (2 * len(ax) * ax[0]["w"] * ax[0]["r"] * 0.6) / 1000
        else:
            kpa = s["mass"] * 9.81 / (2 * s["physics"]["track_width_m"] * s["physics"]["track_length_m"]) / 1000
        print("%-18s parts=%d ground pressure %.0f kPa, %.1f hp/t %s" % (s["id"], len(s["parts"]), kpa,
              s["engine"]["horsepower"] / (s["mass"] / 1000), "OK" if not problems else problems))
        bad += len(problems)
    patch_proto()
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
