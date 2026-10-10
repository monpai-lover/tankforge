#!/usr/bin/env python3
"""Imports a War Thunder CDK user-mod vehicle (the .grp resource pack and the vehicle .blk) into the
game's vehicle data, as the mod defines it:

  model.json    the render model (DynModel LOD 0), cut into the pieces the game moves (hull,
                turret, each gun and its recoiling barrel, every road wheel, sprocket and idler)
  armor.json    every armour part of the damage model (the _dm meshes of the collision resource)
                as plates: one per slab, on its outer face, with its exact outline; thickness and
                class from the .blk DamageParts (values inherit down its blocks)
  modules.json  engine, transmission, fuel tanks, ammunition stowages, breeches, barrels, turret
                drives, radio, tracks: boxes round their damage-model meshes
  crew.json     the crew's damage-model figures (roles from tank_crew)
  visual.json   the running gear from the skeleton (wheel centres, sprocket, idler, track)

vehicle.json, weapons.json and engine.json come from the .blk (VehiclePhys, commonWeapons) with
the extra figures the import.json gives (what the mod takes from War Thunder's own files, which a
user mod does not carry: shell data, sight, the gun's rate of fire).

Dagor frames are x forward, y up, z left; the game's are x right, y up, z forward:
(x, y, z)game = (-z, y + ground, x)dagor.

    python3 tools/wt_import.py data/vehicles/su_bmpt34 [--report]
"""
import base64
import io
import json
import math
import os
import sys
import zlib

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import blk_text  # noqa: E402
import dagor_grp as dg  # noqa: E402


def to_game(P, ground):
    P = np.asarray(P, float)
    return np.stack([-P[..., 2], P[..., 1] + ground, P[..., 0]], -1)


def dir_game(N):
    N = np.asarray(N, float)
    return np.stack([-N[..., 2], N[..., 1], N[..., 0]], -1)


def apply_tm(tm, V):
    X, Y, Z, P = (np.array(r, float) for r in tm)
    V = np.asarray(V, float)
    return V[:, 0:1] * X + V[:, 1:2] * Y + V[:, 2:3] * Z + P


def r3(x):
    return round(float(x), 3)


def v3(p):
    return {"x": r3(p[0]), "y": r3(p[1]), "z": r3(p[2])}


# ------------------------------------------------------------------ the damage model's parts


def dm_parts(blk):
    """Every _dm part of DamageParts with the armour class, thickness and hit points it inherits."""
    dp = blk.block("DamageParts")
    out = {}

    def walk(b, cls, mm, hp, group, top):
        cls = b.get("armorClass", cls)
        mm = b.get("armorThickness", mm)
        hp = b.get("hp", hp)
        for name, sub in b.blocks:
            if name.endswith("_dm"):
                out[name] = {"class": sub.get("armorClass", cls), "mm": sub.get("armorThickness", mm), "hp": sub.get("hp", hp), "group": group}
            else:
                walk(sub, cls, mm, hp, name if top else group, False)

    walk(dp, dp.get("armorClass"), dp.get("armorThickness"), dp.get("hp"), None, True)
    return out


def convex_hull(pts):
    pts = sorted(set(map(tuple, np.round(pts, 5))))
    if len(pts) < 3:
        return pts

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower, upper = [], []
    for p in pts:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)
    for p in reversed(pts):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)
    return lower[:-1] + upper[:-1]


def planar_faces(W, T):
    """Triangles grouped into planar faces (same plane, connected): [{n, d, tris}]."""
    a = W[T[:, 1]] - W[T[:, 0]]
    b = W[T[:, 2]] - W[T[:, 0]]
    n = np.cross(a, b)
    area = np.linalg.norm(n, axis=1) / 2
    ok = area > 1e-7
    n[ok] /= (2 * area[ok])[:, None]
    planes = []
    for i in np.nonzero(ok)[0]:
        d = float(n[i] @ W[T[i, 0]])
        for pl in planes:
            if pl["n"] @ n[i] > 0.998 and abs(pl["d"] - d) < 0.004:
                pl["tris"].append(i)
                break
        else:
            planes.append({"n": n[i].copy(), "d": d, "tris": [i]})
    faces = []
    key = np.round(W / 1e-3).astype(np.int64)
    for pl in planes:
        tris = pl["tris"]
        # connected pieces of the plane (two separate plates can share a plane)
        parent = list(range(len(tris)))

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        owner = {}
        for k, ti in enumerate(tris):
            for vi in T[ti]:
                kk = tuple(key[vi])
                if kk in owner:
                    ra, rb = find(owner[kk]), find(k)
                    if ra != rb:
                        parent[ra] = rb
                else:
                    owner[kk] = k
        groups = {}
        for k, ti in enumerate(tris):
            groups.setdefault(find(k), []).append(ti)
        for g in groups.values():
            faces.append({"n": pl["n"], "d": pl["d"], "tris": g, "area": float(area[g].sum())})
    return faces


def face_frame(W, T, face):
    """The face's outline in its plane: centre, axis_u, half sizes, polygon (u, v)."""
    n = face["n"]
    P = W[np.unique(T[face["tris"]].ravel())]
    c0 = P.mean(0)
    # in-plane axes by the outline's principal direction
    helper = np.array([0, 1, 0]) if abs(n[1]) < 0.9 else np.array([0, 0, 1])
    e1 = np.cross(helper, n)
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(n, e1)
    uv = np.c_[(P - c0) @ e1, (P - c0) @ e2]
    if len(uv) >= 3:
        cov = np.cov(uv.T)
        w, vecs = np.linalg.eigh(cov)
        main = vecs[:, int(np.argmax(w))]
        au = e1 * main[0] + e2 * main[1]
        au /= np.linalg.norm(au)
    else:
        au = e1
    av = np.cross(n, au)
    uv = np.c_[(P - c0) @ au, (P - c0) @ av]
    lo, hi = uv.min(0), uv.max(0)
    mid = (lo + hi) / 2
    centre = c0 + au * mid[0] + av * mid[1]
    hull = convex_hull(uv - mid)
    return centre, au, (hi - lo) / 2, hull


def armour_plates(coll, parts, ground, turret_parts, materials, centre_hull, centre_turret, report):
    plates = []
    for nd in coll["nodes"]:
        name = nd["name"]
        info = parts.get(name)
        if not info or not info["mm"] or info["class"] not in materials:
            continue
        # armour: the armour groups of DamageParts and the external add-ons (spare track links,
        # shields); modules, crew, wheels and tracks are hit as modules, not as plates
        if info["group"] not in ARMOUR_GROUPS and not name.startswith("ex_"):
            continue
        if not nd["verts"] or not nd["tris"]:
            continue
        W = to_game(apply_tm(nd["tm"], nd["verts"]), ground)
        T = np.array(nd["tris"], int)
        faces = planar_faces(W, T)
        on_turret = name in turret_parts
        centre = centre_turret if on_turret else centre_hull
        # a plate is modelled as two parallel sheets (or as a closed slab): the faces of one
        # plate are parallel, a few centimetres apart and over each other. They are clustered and
        # the plate is kept once, on its outermost face, facing out.
        cents = [W[T[f["tris"]].ravel()].mean(0) for f in faces]
        parent = list(range(len(faces)))

        def find(x):
            while parent[x] != x:
                parent[x] = parent[parent[x]]
                x = parent[x]
            return x

        for i, f in enumerate(faces):
            for j in range(i + 1, len(faces)):
                g = faces[j]
                if abs(f["n"] @ g["n"]) < 0.995:
                    continue
                dc = cents[j] - cents[i]
                if abs(dc @ f["n"]) > 0.25:
                    continue
                lateral = np.linalg.norm(dc - f["n"] * (dc @ f["n"]))
                if lateral > 0.6 * math.sqrt(max(f["area"], g["area"])) + 0.05:
                    continue
                parent[find(i)] = find(j)
        clusters = {}
        for i in range(len(faces)):
            clusters.setdefault(find(i), []).append(i)
        kept = []
        for members in clusters.values():
            best = None
            for i in members:
                f = faces[i]
                n = f["n"] if f["n"] @ (cents[i] - centre) >= 0 else -f["n"]
                out = n @ (cents[i] - centre)
                if best is None or out > best[0] + 1e-4 or (abs(out - best[0]) <= 1e-4 and f["area"] > faces[best[1]]["area"]):
                    best = (out, i, n)
            f = dict(faces[best[1]])
            f["n"] = best[2]
            kept.append(f)
        k = 0
        for f in kept:
            centre_f, au, half, poly = face_frame(W, T, f)
            if min(half) < 0.03 or f["area"] < 0.004:
                continue  # the slab's edges and slivers
            n = f["n"]
            zone = zone_of(name, n, on_turret, info)
            plates.append({
                "id": "%s_%02d" % (name[:-3], k), "zone": zone, "material": materials[info["class"]], "thickness_mm": r3(info["mm"]),
                "center": v3(centre_f), "normal": v3(n), "axis_u": v3(au), "half_u": r3(half[0] + 0.001), "half_v": r3(half[1] + 0.001),
                "polygon": [[r3(p[0]), r3(p[1])] for p in poly],
            })
            k += 1
        if report:
            print("  %-28s %-14s %5.0f mm  %d faces -> %d plates" % (name, info["class"], info["mm"], len(faces), k))
    return plates


ARMOUR_GROUPS = {"hull", "turret", "CHA_armor_parts", "hull_shields", "turret_shields", "body_shields", "mask"}


def zone_of(name, n, on_turret, info):
    """The zone by what the plate faces (its largest component), the mantlet when it faces forward."""
    ax = int(np.argmax(np.abs(n)))
    if "gun_mask" in name and ax == 2 and n[2] > 0:
        return "gun_mantlet"
    if on_turret or "gun_mask" in name:
        if ax == 1:
            return "turret_roof" if n[1] > 0 else "other"
        if ax == 2:
            return "turret_front" if n[2] > 0 else "turret_rear"
        return "turret_side"
    if name.startswith("ex_"):
        return "skirt" if ax == 0 else "other"
    if ax == 1:
        return "hull_roof" if n[1] > 0 else "hull_floor"
    if ax == 2:
        if n[2] < 0:
            return "hull_rear"
        return "hull_upper_front" if n[1] >= 0 else "hull_lower_front"
    return "hull_side"


# ------------------------------------------------------------------ modules and crew


MODULE_KIND = [
    ("engine_dm", "engine", 150), ("transmission_dm", "transmission", 120), ("fuel_tank", "fuel_tank", 50),
    ("ammo_", "ammo_rack", 60), ("cannon_breech", "gun_breech", 70), ("gun_barrel", "gun_barrel", 60),
    ("drive_turret_h", "turret_drive", 70), ("drive_turret_v", "vertical_drive", 50), ("radio_station", "radio", 40),
    ("track_l_dm", "track", 120), ("track_r_dm", "track", 120),
]
CREW_ROLE = {"driver": "driver", "tank_gunner": "gunner", "commander": "commander", "loader": "loader", "radio_gunner": "radio_operator", "machine_gunner": "radio_operator"}


def launcher_modules(guns):
    """Exposed firing apparatus measured from each missile/rocket's source mount and tube."""
    modules = []
    for instance, mount in enumerate(guns):
        gun = mount["gun"]
        if not gun.get("missile"):
            continue
        vectors = gun.get("launcher", {}).get("muzzle_vectors_m") or [gun.get("muzzle_vector_m", [0, 0, mount["muzzle_offset_m"]])]
        radius, length = gun["caliber_mm"] / 2000 + 0.03, gun["barrel_length_mm"] / 1000
        lo = [min(v[k] - (length if k == 2 else radius) for v in vectors) for k in range(3)]
        hi = [max(v[k] + (0 if k == 2 else radius) for v in vectors) for k in range(3)]
        c = [r3(mount["mount_m"][k] + (lo[k] + hi[k]) / 2) for k in range(3)]
        h = [r3((hi[k] - lo[k]) / 2) for k in range(3)]
        modules.append({"id": "launcher_" + gun["id"], "kind": "launcher", "center": dict(zip(("x", "y", "z"), c)),
                        "half_extents": dict(zip(("x", "y", "z"), h)), "max_health": 70, "health": 70, "weapon_group": "launcher_mount_" + str(instance)})
    return modules


def box_of(W):
    lo, hi = W.min(0), W.max(0)
    return (lo + hi) / 2, (hi - lo) / 2


def modules_and_crew(coll, blk, ground, rounds_by_part, report):
    nodes = {nd["name"]: nd for nd in coll["nodes"]}
    modules = []
    for nd in coll["nodes"]:
        name = nd["name"]
        if not name.endswith("_dm") or not nd["verts"]:
            continue
        for prefix, kind, hp in MODULE_KIND:
            if name.startswith(prefix):
                W = to_game(apply_tm(nd["tm"], nd["verts"]), ground)
                c, h = box_of(W)
                m = {"id": name[:-3], "kind": kind, "center": v3(c), "half_extents": v3(np.maximum(h, 0.03)), "max_health": hp, "health": hp}
                if kind == "ammo_rack" and name in rounds_by_part:
                    m["rounds"] = rounds_by_part[name]
                modules.append(m)
                break
    crew = []
    tc = blk.block("tank_crew")
    for _seat, b in tc.blocks:
        part = b.get("dmPart")
        roles = [CREW_ROLE.get(r) for r in b.all("role") if CREW_ROLE.get(r)]
        nd = nodes.get(part)
        if not nd or not roles:
            continue
        W = to_game(apply_tm(nd["tm"], nd["verts"]), ground)
        c, h = box_of(W)
        # the figure's chest: a little above the middle of its box
        pos = [c[0], c[1] + h[1] * 0.25, c[2]]
        entry = {"role": roles[0], "pos": v3(pos), "radius": 0.28, "health": 100.0}
        also = [r for r in roles[1:] if r != roles[0]]
        if also:
            entry["also"] = also
        crew.append(entry)
    if report:
        print("  modules:", [(m["id"], m["kind"]) for m in modules])
        print("  crew:", [(c["role"], c.get("also")) for c in crew])
    return modules, crew


# ------------------------------------------------------------------ the render model


def color_texture(hex_color):
    img = Image.new("RGB", (8, 8), tuple(int(hex_color[i:i + 2], 16) for i in (1, 3, 5)))
    buf = io.BytesIO()
    img.save(buf, "JPEG", quality=90)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode()


def render_model(dm, skel, ground, cfg, wheel_index, mount_origin):
    by_name = {n["name"]: n for n in skel}
    mounts = cfg.get("mounts", {})
    mount_of = {}
    for key, names in mounts.items():
        for n in names:
            mount_of[n] = key
    # what is not named rides where the skeleton hangs it: under bone_turret it traverses
    # (or is left out, for a hull taken without its turret)
    for i, nd in enumerate(skel):
        j = nd["parent"]
        while j >= 0:
            if skel[j]["name"] == "bone_turret":
                mount_of.setdefault(nd["name"], "drop" if cfg.get("drop_turret") else "turret")
                break
            j = skel[j]["parent"]
    if cfg.get("drop_turret"):
        mount_of["bone_turret"] = "drop"
    colors = cfg["material_colors"]
    drop_mat = set(cfg.get("drop_materials", []))
    # the mod carries no textures: each node may be painted its own colour (a trailing * matches a
    # prefix) over its material's, glass and lamp materials kept; wheels may be split by radius
    # into tyre and disc
    node_colors = cfg.get("node_colors", {})
    keep_mats = set(cfg.get("keep_material_colors", []))
    radial = cfg.get("radial_colors", {})

    def match(table, name):
        if name in table:
            return table[name]
        best = None
        for k, v in table.items():
            if k.endswith("*") and name.startswith(k[:-1]) and (best is None or len(k) > len(best[0])):
                best = (k, v)
        return best[1] if best else None
    textures = []
    tex_of = {}
    groups = {}
    for rg in dm["rigids"]:
        name = rg["name"]
        key = mount_of.get(name)
        if key is None:
            key = wheel_index.get(name, "hull")
        if key == "drop":
            continue
        node = by_name.get(name)
        if node is None:
            continue
        for e in rg["elems"]:
            if e["mat"] in drop_mat or not e["tris"]:
                continue
            col = colors.get(str(e["mat"]), "#5a6640")
            own = match(node_colors, name)
            if own and e["mat"] not in keep_mats:
                col = own
            P = to_game(apply_tm(node["wtm"], e["positions"]), ground)
            Nm = np.array(node["wtm"][:3], float)
            N = dir_game(np.asarray(e["normals"], float) @ Nm)
            N /= np.maximum(1e-6, np.linalg.norm(N, axis=1))[:, None]
            T = np.array(e["tris"], int)
            if cfg.get("flip_winding", False):
                T = T[:, [0, 2, 1]]
            # the colour of each triangle: the node's, or by radius from the wheel's axis
            tri_col = [col] * len(T)
            rule = match(radial, name)
            if rule:
                L = np.asarray(e["positions"], float)
                c0 = (L.min(0) + L.max(0)) / 2
                ax = int(np.argmin(L.max(0) - L.min(0)))
                other = [k for k in range(3) if k != ax]
                rad = np.linalg.norm((L - c0)[:, other], axis=1)
                rmax = rad.max()
                cen = rad[T].mean(1)
                outer = rad[T].min(1) >= rule["r_frac"] * rmax
                tri_col = [rule["color"] if o else (rule.get("inner") or col) for o in outer]
                if rule.get("hub_frac"):
                    tri_col = [rule.get("hub", col) if cen[i] < rule["hub_frac"] * rmax else tri_col[i] for i in range(len(T))]
            for cc in sorted(set(tri_col)):
                if cc not in tex_of:
                    tex_of[cc] = len(textures)
                    textures.append({"src": color_texture(cc), "size": [8, 8], "image": len(textures), "alpha": False})
                sel = T[np.array([c == cc for c in tri_col])]
                # only the vertices this colour's triangles use
                used, inv = np.unique(sel.reshape(-1), return_inverse=True)
                sel = inv.reshape(-1, 3)
                g = groups.setdefault((key, tex_of[cc]), {"P": [], "N": [], "UV": [], "I": [], "n": 0})
                g["P"].append(P[used])
                g["N"].append(N[used])
                g["UV"].append(np.full((len(used), 2), 0.5))
                g["I"].append(sel + g["n"])
                g["n"] += len(used)
    blob = bytearray()

    def put(arr):
        o = len(blob)
        blob.extend(np.ascontiguousarray(arr).tobytes())
        while len(blob) % 4:
            blob.append(0)
        return o

    parts = []
    lo_all = np.full(3, np.inf)
    hi_all = np.full(3, -np.inf)
    tur_lo = np.full(3, np.inf)
    tur_hi = np.full(3, -np.inf)
    counts = {}
    for (key, tex), g in sorted(groups.items()):
        P = np.concatenate(g["P"])
        N = np.concatenate(g["N"])
        UV = np.concatenate(g["UV"])
        I = np.concatenate(g["I"])
        base = key.split(":")[0]
        if base in ("hull", "turret", "gun", "barrel"):
            lo_all = np.minimum(lo_all, P.min(0))
            hi_all = np.maximum(hi_all, P.max(0))
        if base in ("turret", "gun"):
            tur_lo = np.minimum(tur_lo, P.min(0))
            tur_hi = np.maximum(tur_hi, P.max(0))
        idx32 = len(P) > 65535
        part = {"mount": base, "texture": tex, "normal": -1, "vertices": int(len(P)), "triangles": int(len(I)), "idx32": bool(idx32),
                "pos": put(np.round(P * 1000).astype(np.int16)), "nor": put(np.round(N * 127).astype(np.int8)),
                "uv": put(np.round(UV * 65535).astype(np.uint16)), "idx": put(I.reshape(-1).astype(np.uint32 if idx32 else np.uint16))}
        bits = key.split(":")
        if base in ("gun", "barrel"):
            part["gun"] = int(bits[1]) if len(bits) > 1 else 0
        elif len(bits) == 3:
            part["side"] = int(bits[1])
            part["index"] = int(bits[2])
        parts.append(part)
        counts[base] = counts.get(base, 0) + int(len(I))
    out = {"version": 1, "source": cfg.get("source", ""), "bounds": [lo_all.round(3).tolist(), hi_all.round(3).tolist()],
           "textures": textures, "parts": parts, "blob": base64.b64encode(zlib.compress(bytes(blob), 9)).decode(), "blob_size": len(blob)}
    return out, counts, tur_lo, tur_hi


# ------------------------------------------------------------------ main


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    report = "--report" in sys.argv
    vdir = args[0]
    cfg = json.load(open(os.path.join(vdir, "import.json")))
    data = open(os.path.join(vdir, cfg["grp"]), "rb").read()
    blk = blk_text.parse(open(os.path.join(vdir, cfg["blk"]), encoding="utf-8", errors="replace").read())
    res = {r["name"]: r for r in dg.grp_resources(data)}
    model = cfg["model"]
    coll = dg.read_collision(data, res[model + "_collision"]["offset"])
    skel = dg.read_skeleton(data, res[model + "_skeleton"]["offset"])
    dmskel = dg.read_skeleton(data, res[model + "_dm_skeleton"]["offset"])
    dm = dg.read_dynmodel(data, res[model]["offset"], res[model]["size"])
    sk = {n["name"]: n for n in skel}
    ground = cfg["ground"]
    pos = lambda name: to_game(np.array(sk[name]["wtm"][3]), ground)  # noqa: E731

    # what rides on the turret: descendants of bone_turret in the damage-model skeleton
    turret_parts = set()
    for i, n in enumerate(dmskel):
        j = n["parent"]
        while j >= 0:
            if dmskel[j]["name"] == "bone_turret":
                turret_parts.add(n["name"])
                break
            j = dmskel[j]["parent"]
    turret_parts |= set(cfg.get("turret_parts", []))

    parts = dm_parts(blk)
    pivot = pos("bone_turret")
    dm_turret_boxes = []
    for nd in coll["nodes"]:
        if nd["name"] in turret_parts and nd["verts"]:
            Wt = to_game(apply_tm(nd["tm"], nd["verts"]), ground)
            dm_turret_boxes.append((Wt.min(0), Wt.max(0)))
    centre_hull = np.array([0, 0.9, 0.0])
    centre_turret = pivot + np.array([0, 0.45, 0])
    plates = armour_plates(coll, parts, ground, turret_parts, cfg["armour_materials"], centre_hull, centre_turret, report)

    # ammunition: rounds per stowage part (ammoStowages)
    rounds = {}
    st = blk.block("ammoStowages")
    for _n, b in (st.blocks if st else []):
        sh = b.block("shells")
        for pname, pb in (sh.blocks if sh else []):
            rounds[pname] = pb.get("count", 0)
    modules, crew = modules_and_crew(coll, blk, ground, rounds, report)

    # running gear from the skeleton
    rgc = cfg["running_gear"]
    wheels = []
    wheel_index = {}
    right = rgc["road_wheels"]["right"]
    left = rgc["road_wheels"]["left"]
    track_x = abs(float(pos(right[0])[0]))
    for k, (rn, ln) in enumerate(zip(right, left)):
        p = pos(rn)
        wheels.append({"z": r3(p[2]), "y": r3(p[1]), "r": rgc["wheel_r"], "w": rgc["wheel_w"], "x": 0.0})
        wheel_index[rn] = "road_wheel:1:%d" % k
        wheel_index[ln] = "road_wheel:-1:%d" % k
    sp = pos(rgc["sprocket"]["right"])
    idl = pos(rgc["idler"]["right"])
    wheel_index[rgc["sprocket"]["right"]] = "sprocket:1:0"
    wheel_index[rgc["sprocket"]["left"]] = "sprocket:-1:0"
    wheel_index[rgc["idler"]["right"]] = "idler:1:0"
    wheel_index[rgc["idler"]["left"]] = "idler:-1:0"
    running_gear = {"track_width": rgc["track_width"], "track_thickness": rgc["track_thickness"], "track_x": r3(track_x), "link_pitch": rgc["link_pitch"],
                    "link_style": rgc.get("link_style", "center_guide"), "track_sag": rgc.get("track_sag", 0.03),
                    "sprocket": {"z": r3(sp[2]), "y": r3(sp[1]), "r": rgc["sprocket_r"], "teeth": rgc.get("sprocket_teeth", 0)},
                    "idler": {"z": r3(idl[2]), "y": r3(idl[1]), "r": rgc["idler_r"]},
                    "wheels": wheels, "rollers": [], "wheel_style": rgc.get("wheel_style", "rubber_dish")}

    imported, counts, tur_lo, tur_hi = render_model(dm, skel, ground, cfg["render"], wheel_index, None)
    if cfg.get("render_only"):
        # another vehicle's hull: the model and what its data needs to sit on it (running gear,
        # the turret ring) -- tools/gen_vehicles.py reads hull.json
        with open(os.path.join(vdir, "model.json"), "w") as f:
            json.dump(imported, f, separators=(",", ":"))
        hull = {"source": cfg["render"].get("source", ""), "running_gear": running_gear, "turret_ring": [r3(x) for x in pivot],
                "bounds": imported["bounds"], "triangles": counts}
        with open(os.path.join(vdir, "wt_hull.json"), "w") as f:
            json.dump(hull, f, indent=1)
        print("wrote %s/model.json (%d KB) and wt_hull.json: triangles %s" % (vdir, os.path.getsize(os.path.join(vdir, "model.json")) // 1024, counts))
        return
    for lo, hi in dm_turret_boxes:
        tur_lo = np.minimum(tur_lo, lo)
        tur_hi = np.maximum(tur_hi, hi)
    if report:
        print("  render triangles by mount:", counts, "bounds", imported["bounds"])
        print("  plates:", len(plates), "modules:", len(modules), "crew:", len(crew))

    # vehicle.json / weapons.json / engine.json from the blk and the config
    vp = blk.block("VehiclePhys")
    mass = vp.block("Mass")
    eng = vp.block("engine")
    mech = vp.block("mechanics")
    ratios = mech.block("gearRatios").all("ratio")
    fwd = [r for r in ratios if r > 0]
    rev = [r for r in ratios if r < 0]
    final = mech.get("mainGearRatio", 1.0) * mech.get("sideGearRatio", 1.0)
    cog = to_game(np.array(mass.get("CenterOfGravity", [0, 0.5, 0])), ground)
    v = cfg["vehicle"]
    hull_lo, hull_hi = np.array(imported["bounds"][0]), np.array(imported["bounds"][1])
    vehicle = {
        "id": v["id"], "name": v["name"], "schema_version": 1, "model": "model.json",
        "meta": v["meta"],
        "files": {"armor": "armor.json", "weapons": "weapons.json", "engine": "engine.json", "crew": "crew.json", "modules": "modules.json", "visual": "visual.json"},
        "hull": {"size_m": v.get("hull_size_m", [r3(hull_hi[0] - hull_lo[0]), v["hull_height_m"], r3(hull_hi[2] - hull_lo[2])]),
                 "mass_kg": mass.get("TakeOff", mass.get("Empty")), "center_of_mass": [r3(cog[0]), r3(cog[1]), r3(cog[2])]},
        # the turret's box round everything that traverses (the validator's volume for its parts)
        "turret": {"size_m": [r3(2 * max(abs(tur_lo[0] - pivot[0]), abs(tur_hi[0] - pivot[0]))), r3(tur_hi[1] - pivot[1]),
                              r3(2 * max(abs(tur_lo[2] - pivot[2]), abs(tur_hi[2] - pivot[2])))],
                   "ring_diameter_m": v["ring_diameter_m"], "position_m": [r3(x) for x in pivot], "open_top": v.get("open_top", False)},
        "physics": dict(v["physics"], track_width_m=vp.block("tracks").get("width", 0.5), sprocket_radius_m=r3(mech.get("driveGearRadius", 0.3))),
    }
    hp = eng.get("horsePowers")
    max_rpm = eng.get("maxRPM")
    engine = {"engine": {"horsepower": hp, "max_rpm": max_rpm, "idle_rpm": eng.get("minRPM"), "weight_kg": v.get("engine_weight_kg", 1000),
                         "torque_curve": [[int(rpm), round(k * hp * 745.7 / (max_rpm * 2 * math.pi / 60))] for rpm, k in v["torque_shape"]]},
              "transmission": {"forward_gears": len(fwd), "reverse_gears": len(rev), "gear_ratios": fwd, "final_drive_ratio": round(final, 3),
                               "shift_time_s": v.get("shift_time_s", 0.5)}}

    w = cfg["weapons"]

    def gun_entry(spec):
        # a mount beside its node (a rocket on one side of a twin launcher)
        at = pos(spec["trunnion_node"]) + np.array(spec.get("mount_offset_m", [0, 0, 0]), float)
        out = {"gun": spec["gun"], "mount_m": [r3(x) for x in at]}
        muzzle = pos(spec["muzzle_node"]) if spec.get("muzzle_node") else None
        out["muzzle_offset_m"] = r3(np.linalg.norm(muzzle - pos(spec["trunnion_node"]))) if muzzle is not None else spec["muzzle_offset_m"]
        return out

    guns = [gun_entry(s) for s in w["guns"]]
    modules.extend(launcher_modules(guns))
    weapons = {"main_gun": guns[0]["gun"], "mount_m": guns[0]["mount_m"], "muzzle_offset_m": guns[0]["muzzle_offset_m"], "sight": w["sight"],
               "secondary": w.get("secondary", [])}
    if w.get("stabilizer"):
        weapons["stabilizer"] = w["stabilizer"]
    if len(guns) > 1:
        weapons["extra_guns"] = guns[1:]
    visual = {"schema_version": 1, "palette": cfg.get("palette", {"paint": "#5a6640", "paint_dark": "#434d30", "steel": "#6a6d70", "rubber": "#1c1c1d", "track": "#4a4743", "black": "#151515"}),
              "parts": cfg.get("visual_parts", []), "running_gear": running_gear, "hull_bottom": cfg.get("hull_bottom", 0.4)}

    def dump(name, obj, compact=False):
        with open(os.path.join(vdir, name), "w", encoding="utf-8") as f:
            if compact:
                json.dump(obj, f, separators=(",", ":"))
            else:
                json.dump(obj, f, indent=1, ensure_ascii=False)
                f.write("\n")

    dump("vehicle.json", vehicle)
    dump("armor.json", plates)
    dump("modules.json", modules)
    dump("crew.json", crew)
    dump("weapons.json", weapons)
    dump("engine.json", engine)
    dump("visual.json", visual)
    dump("model.json", imported, compact=True)
    print("wrote %s: %d plates, %d modules, %d crew, model %d KB" % (vdir, len(plates), len(modules), len(crew), os.path.getsize(os.path.join(vdir, "model.json")) // 1024))


if __name__ == "__main__":
    main()
