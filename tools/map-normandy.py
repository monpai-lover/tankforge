#!/usr/bin/env python3
"""Builds the Normandy battle map from the reference drawings in data/maps/normandy/.

  drawing.png            the tactical map (top view, 7 x 7 squares a-g / 1-7, 200 m each): ground
                         types and colours, roads, the town's blocks, farm buildings, hedgerows,
                         the beach with its obstacles, both teams' start points (blue and red tank
                         icons) and the three capture points A, B, C (white diamonds)
  heights_reference.png  the height sheet: the colour height map gives the shape of the high
                         ground (the ridge west of the town, the hill at C, the rise along the
                         south edge); the sections give the heights: the beach at A a few metres
                         above the sea, the town at B about 30 m, the top of C about 50 m. (The
                         sheet's colour scale reads upside down -- its blue sea would be 60 m -- so
                         only the sections' numbers are taken and the colours are used for shape.)

Writes data/maps/normandy/map.json in the format of tools/map-prep.py, plus:
  (objects: x, z centre; w along the object's local x, d along its local z, h tall; yaw turns
  local +z to (sin yaw, cos yaw) in (east, north), so a house's front faces local +z)
  colors   512 x 512 ground colours taken from the drawing (fields, hedges, roofs as painted)
  objects  buildings (row houses round every town block, the church at B, the farms drawn on the
           map), bunkers on the dune line, steel hedgehogs and concrete walls on the beach
  points   the capture points A, B, C

Usage: python3 tools/map-normandy.py [data/maps/normandy]
"""
import base64
import json
import math
import os
import sys
import zlib

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

SIZE = 1400.0           # 7 squares of 200 m
RES_C = 1024
RES_H = 512
RES_COL = 512
CLASSES = ["water", "sand", "grass", "forest", "road", "rock", "farm", "town"]
WATER, SAND, GRASS, FOREST, ROAD, ROCK, FARM, TOWN = range(8)

# the drawing's grid lines (px): the squares are not drawn quite equal, each maps onto 200 m
XS = np.array([49.0, 240.0, 442.5, 641.0, 836.5, 1031.5, 1232.0, 1477.0])
YS = np.array([0.0, 160.0, 304.5, 444.0, 599.0, 749.5, 900.5, 1056.0])
# the colour height map on the height sheet (px), and its squares
HXS = np.linspace(54.0, 1007.0, 8)
HYS = np.array([693.0, 744.0, 792.0, 835.0, 880.0, 930.0, 986.0, 1043.0])


def pack(arr, dtype):
    raw = np.ascontiguousarray(arr.astype(dtype)).tobytes()
    return base64.b64encode(zlib.compress(raw, 9)).decode("ascii")


def sample_grid(img, xs, ys, res):
    """Resamples img (H x W x C or H x W) onto res x res world squares: row 0 the south edge."""
    n = len(xs) - 1
    u = (np.arange(res) + 0.5) / res * n
    col = np.minimum(u.astype(int), n - 1)
    px = xs[col] + (u - col) * (xs[col + 1] - xs[col])
    v = n - u
    row = np.minimum(v.astype(int), n - 1)
    py = ys[row] + (v - row) * (ys[row + 1] - ys[row])
    pxi = np.clip(np.round(px).astype(int), 0, img.shape[1] - 1)
    pyi = np.clip(np.round(py).astype(int), 0, img.shape[0] - 1)
    return img[pyi[:, None], pxi[None, :]]


def px_to_world(px, py):
    """Drawing pixel (full image) -> world x (east), z (north), m."""
    n = len(XS) - 1

    def along(p, lines):
        i = int(np.clip(np.searchsorted(lines, p) - 1, 0, n - 1))
        return i + (p - lines[i]) / (lines[i + 1] - lines[i])

    return -SIZE / 2 + along(px, XS) * SIZE / n, SIZE / 2 - along(py, YS) * SIZE / n


def classify(rgb):
    """Ground type per drawing pixel, -1 where markers, labels and grid lines are."""
    r, g, b = (rgb[..., k].astype(float) for k in range(3))
    br = rgb.mean(axis=2)
    mx = rgb.max(axis=2).astype(float)
    mn = rgb.min(axis=2).astype(float)
    sat = (mx - mn) / np.maximum(mx, 1)
    yy = np.arange(rgb.shape[0])[:, None] * np.ones((1, rgb.shape[1]))
    water = (b > r + 35) & (b > 60)
    road = (sat < 0.12) & (br > 112) & (br < 200)
    grayish = (sat < 0.3) & (br > 45) & (br < 125)
    dense = ndi.uniform_filter(grayish.astype(float), 25)
    town = (dense > 0.55) & (yy > 330) & (yy < 660)
    sandy = (r > 125) & (r - b > 55) & (g > 95)
    dark_green = (g >= r) & (br < 62) & ~water
    lab = np.full(rgb.shape[:2], GRASS, np.int16)
    lab[sandy] = FARM
    lab[dark_green] = FOREST
    lab[grayish & ~town] = ROCK
    lab[town] = TOWN
    lab[road] = ROAD
    lab[water] = WATER
    # the beach: sand-coloured ground that reaches the shore band (the rest is farmland)
    comp, n = ndi.label(lab == FARM)
    shore = set(np.unique(comp[(yy < 300) & (comp > 0)]))
    lab[np.isin(comp, list(shore)) & (comp > 0)] = SAND
    # markers: tank icons and their brackets, the capture diamonds, labels; and the grid lines
    blue = (b > 150) & (r < 90) & (b - g > 50)
    red = (r > 170) & (g < 70) & (b < 70)
    yellow = (r > 190) & (g > 170) & (b < 80)
    white = (br > 215) & (sat < 0.12)
    marks = ndi.binary_dilation(blue | red | yellow | white, iterations=6)
    lab[marks] = -1
    for x in XS[1:-1]:
        lab[:, int(x) - 2:int(x) + 3] = np.where(lab[:, int(x) - 2:int(x) + 3] == ROAD, ROAD, -1)
    for y in YS[1:-1]:
        lab[int(y) - 2:int(y) + 3, :] = np.where(lab[int(y) - 2:int(y) + 3, :] == ROAD, ROAD, -1)
    return lab, (blue, red, white, yellow)


def fill_unknown(lab):
    unknown = lab < 0
    idx = ndi.distance_transform_edt(unknown, return_distances=False, return_indices=True)
    return lab[idx[0], idx[1]]


def despeckle(lab, size=5):
    votes = []
    for c in range(len(CLASSES)):
        v = ndi.uniform_filter((lab == c).astype(np.float32), size=size)
        votes.append(v * (2.0 if c in (ROAD, FOREST) else 1.0))
    return np.argmax(np.stack(votes), axis=0)


def warmth(rgb):
    """How far the height sheet's colour is from green towards red (0 green or blue, 1 deep red)."""
    hsv = np.asarray(Image.fromarray(rgb.astype(np.uint8)).convert("HSV")).astype(float)
    hue = hsv[..., 0] / 255.0 * 360.0
    sat = hsv[..., 1] / 255.0
    w = np.clip((70.0 - hue) / 65.0, 0, 1)
    w[hue > 300] = 1.0
    return w * np.clip(sat * 1.6, 0, 1)


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


def heights(cls, warm):
    """Terrain heights (m) on the class grid."""
    texel = SIZE / cls.shape[0]
    water = cls == WATER
    d_land = ndi.distance_transform_edt(~water) * texel
    d_water = ndi.distance_transform_edt(water) * texel
    rng = np.random.default_rng(1944)
    roll = ndi.gaussian_filter(rng.standard_normal(cls.shape), 40 / texel)
    roll /= np.abs(roll).max() + 1e-9
    # the beach a few metres up from the tide line, then the slope up to the town's plateau (~28 m)
    land = 4.0 * (1 - np.exp(-d_land / 50)) + 24.0 * smoothstep(100, 560, d_land)
    # the high ground from the height sheet (south of the beach): the ridge west of the town, the
    # hill at C (~50 m) and the rise along the south edge
    inland = smoothstep(380, 620, d_land)
    land += 24.0 * ndi.gaussian_filter(warm, 14 / texel) * inland
    land += 1.6 * roll * smoothstep(60, 200, d_land)
    # the rocky headland at a2 stands up out of the sea
    rock = ndi.gaussian_filter((cls == ROCK).astype(float), 6 / texel)
    land += 7.0 * rock * (d_land < 260)
    land = np.maximum(land, 0.3 * (1 - np.exp(-d_land / 6)))
    depth = np.minimum(0.4 + 0.05 * d_water, 8.0)
    h = np.where(water, -depth, land)
    # roads run level; the town stands on smoothed ground so its houses sit straight
    road = ndi.binary_dilation(cls == ROAD, iterations=1)
    even = ndi.gaussian_filter(np.where(water, 0.6, h), 12 / texel)
    even = np.maximum(even, 0.6)
    blend = np.clip(ndi.gaussian_filter(road.astype(float), 4 / texel) * 2.2, 0, 1)
    h = h * (1 - blend) + even * blend
    h = np.where(road, even, h)
    town = ndi.binary_dilation(cls == TOWN, iterations=3)
    flat = ndi.gaussian_filter(h, 20 / texel)
    tb = np.clip(ndi.gaussian_filter(town.astype(float), 6 / texel) * 1.6, 0, 1)
    h = h * (1 - tb) + flat * tb
    sm = ndi.gaussian_filter(h, 1.2)
    h = np.where(water & ~road, np.minimum(sm, -0.2), np.where(road, h, np.maximum(sm, 0.05)))
    return h


def town_houses(cls, h, rng):
    """Row houses round the edge of every town block, facing the street, gardens behind."""
    texel = SIZE / cls.shape[0]
    town = cls == TOWN
    inner = ndi.distance_transform_edt(town) * texel           # m in from the block's edge
    gy, gx = np.gradient(ndi.gaussian_filter(inner, 2))
    out = []
    taken = []
    step = 2.0
    ys, xs = np.nonzero(town & (inner > 3.5) & (inner < 6.5))
    order = rng.permutation(len(xs))
    for k in order:
        i, j = ys[k], xs[k]
        x = -SIZE / 2 + (j + 0.5) * texel
        z = -SIZE / 2 + (i + 0.5) * texel
        if any((x - a) ** 2 + (z - b) ** 2 < 8.5 ** 2 for a, b in taken):
            continue
        # facing out of the block: along the distance field's slope (rows run north here)
        nx, nz = -gx[i, j], -gy[i, j]
        l = math.hypot(nx, nz)
        if l < 1e-6:
            continue
        yaw = math.atan2(nx / l, nz / l)
        w = float(rng.uniform(7.5, 11.5))
        d = float(rng.uniform(8.0, 10.5))
        storeys = int(rng.integers(2, 4))
        taken.append((x, z))
        out.append({"kind": "house", "x": round(x, 2), "z": round(z, 2), "w": round(w, 2), "d": round(d, 2), "h": round(storeys * 3.1, 2), "yaw": round(yaw, 3), "roof": int(rng.integers(0, 3)), "wall": int(rng.integers(0, 4))})
    return out


def farm_buildings(rgb, lab, rng):
    """The small dark buildings drawn outside the town (farms, barns)."""
    br = rgb.mean(axis=2)
    mx = rgb.max(axis=2).astype(float)
    mn = rgb.min(axis=2).astype(float)
    sat = (mx - mn) / np.maximum(mx, 1)
    dark = (br < 70) & (sat < 0.25) & (lab != TOWN) & (lab != WATER) & (lab != SAND)
    comp, n = ndi.label(dark)
    out = []
    for i, sl in enumerate(ndi.find_objects(comp), start=1):
        if sl is None:
            continue
        ys, xs = np.nonzero(comp[sl] == i)
        if not (14 <= len(xs) <= 500):
            continue
        ys = ys + sl[0].start
        xs = xs + sl[1].start
        cx, cy = xs.mean(), ys.mean()
        # long axis of the blob: the building's length
        cov = np.cov(np.stack([xs - cx, ys - cy])) if len(xs) > 2 else np.eye(2)
        ev, evec = np.linalg.eigh(cov)
        ax = evec[:, 1]
        wx, wz = px_to_world(cx + XS[0] * 0 + 0, cy)
        # pixel spans to metres (squares about 200 px wide, 150 px tall)
        sx = SIZE / 7 / np.mean(np.diff(XS))
        sz = SIZE / 7 / np.mean(np.diff(YS))
        length = float(np.clip(4 * math.sqrt(max(ev[1], 1)) * math.hypot(ax[0] * sx, ax[1] * sz), 8, 26))
        width = float(np.clip(4 * math.sqrt(max(ev[0], 1)) * math.hypot(ax[1] * sx, ax[0] * sz), 6, 12))
        # local x (the building's length) along the long axis: x -> (cos yaw, -sin yaw)
        yaw = math.atan2(ax[1] * sz, ax[0] * sx)
        out.append({"kind": "house", "x": round(wx, 2), "z": round(wz, 2), "w": round(length, 2), "d": round(width, 2), "h": round(float(rng.uniform(5.5, 8.0)), 2), "yaw": round(yaw, 3), "roof": int(rng.integers(0, 3)), "wall": int(rng.integers(0, 4)), "farm": True})
    return out


def beach_objects(rgb, lab, rng):
    """Steel hedgehogs (the X marks on the sand), the concrete walls (dashed lines on the beach)
    and bunkers along the dune line."""
    br = rgb.mean(axis=2)
    beach = lab == SAND
    dark = (br < 80) & ndi.binary_dilation(beach, iterations=4)
    comp, n = ndi.label(dark)
    hedgehogs, walls = [], []
    for i, sl in enumerate(ndi.find_objects(comp), start=1):
        if sl is None:
            continue
        ys, xs = np.nonzero(comp[sl] == i)
        if len(xs) < 4:
            continue
        ys = ys + sl[0].start
        xs = xs + sl[1].start
        w = xs.max() - xs.min() + 1
        hgt = ys.max() - ys.min() + 1
        cx, cy = xs.mean(), ys.mean()
        x, z = px_to_world(cx, cy)
        if w > 30 and hgt < 12:
            # a dashed wall: a low concrete wall the length of the dashes
            x0, _ = px_to_world(xs.min(), cy)
            x1, _ = px_to_world(xs.max(), cy)
            walls.append({"kind": "wall", "x": round(x, 2), "z": round(z, 2), "w": round(x1 - x0, 2), "d": 0.8, "h": 1.4, "yaw": 0.0})
        elif w < 16 and hgt < 16 and len(xs) < 80:
            hedgehogs.append({"kind": "hedgehog", "x": round(x, 2), "z": round(z, 2), "yaw": round(float(rng.uniform(0, math.pi)), 3)})
    return hedgehogs, walls


def dune_bunkers(cls, h):
    """Concrete bunkers on the dune line above the beach, about every 180 m."""
    texel = SIZE / cls.shape[0]
    out = []
    for x in np.arange(-SIZE / 2 + 110, SIZE / 2 - 60, 185.0):
        j = int((x + SIZE / 2) / texel)
        col = cls[:, j]
        # from the north edge (last rows) southwards: the first grass after the sand
        top = None
        for i in range(cls.shape[0] - 1, 0, -1):
            if col[i] == SAND and col[i - 1] in (GRASS, FOREST, ROCK, FARM):
                top = i - 3
                break
        if top is None:
            continue
        z = -SIZE / 2 + (top + 0.5) * texel
        out.append({"kind": "bunker", "x": round(float(x), 2), "z": round(float(z), 2), "w": 7.0, "d": 6.0, "h": 2.6, "yaw": 0.0})
    return out


def main():
    base = sys.argv[1] if len(sys.argv) > 1 else "data/maps/normandy"
    rgb_full = np.asarray(Image.open(os.path.join(base, "drawing.png")).convert("RGB"))
    lab, (blue, red, white, yellow) = classify(rgb_full)
    lab = despeckle(fill_unknown(lab))
    cls = sample_grid(lab, XS, YS, RES_C).astype(np.int16)
    comp, n = ndi.label(cls == ROAD)
    sizes = ndi.sum(np.ones_like(comp), comp, index=np.arange(1, n + 1))
    for i, sz in enumerate(sizes, start=1):
        if sz < 120:
            cls[comp == i] = -1
    cls = fill_unknown(cls).astype(np.uint8)

    sheet = np.asarray(Image.open(os.path.join(base, "heights_reference.png")).convert("RGB"))
    warm = sample_grid(warmth(sheet), HXS, HYS, RES_C)
    # the sheet's own labels and diamonds are not ground
    warm = ndi.median_filter(warm, size=9)
    h = heights(cls, warm)
    hs = h.reshape(RES_H, RES_C // RES_H, RES_H, RES_C // RES_H).mean(axis=(1, 3))

    # ground colours as painted (markers and grid lines painted over with their neighbours)
    paint = rgb_full.copy()
    hole = (lab < 0)
    marks = ndi.binary_dilation(blue | red | white | yellow, iterations=8)
    for x in XS[1:-1]:
        marks[:, int(x) - 2:int(x) + 3] = True
    for y in YS[1:-1]:
        marks[int(y) - 2:int(y) + 3, :] = True
    idx = ndi.distance_transform_edt(marks | hole, return_distances=False, return_indices=True)
    paint = paint[idx[0], idx[1]]
    paint = ndi.uniform_filter(paint.astype(float), size=(3, 3, 1))
    colors = sample_grid(paint, XS, YS, RES_COL).astype(np.uint8)

    rng = np.random.default_rng(6061944)
    objects = []
    objects += town_houses(cls, h, rng)
    objects += farm_buildings(rgb_full, lab, rng)
    hedgehogs, walls = beach_objects(rgb_full, lab, rng)
    objects += hedgehogs + walls + dune_bunkers(cls, h)
    # the church in the square at B: nave and tower
    bx, bz = None, None
    comp, n = ndi.label(ndi.binary_closing(white, iterations=2))
    marks_c = []
    for i in range(1, n + 1):
        ys, xs = np.nonzero(comp == i)
        if len(xs) < 300 or ys.mean() < 60:
            continue
        marks_c.append((xs.mean(), ys.mean()))
    marks_c.sort(key=lambda p: p[1])
    points = []
    for letter, (px, py) in zip("ABC", marks_c):
        x, z = px_to_world(px, py)
        points.append({"id": letter, "x": round(x, 1), "z": round(z, 1), "r": 45.0})
        if letter == "B":
            bx, bz = x, z
    if bx is not None:
        # keep the square clear around it, then the church
        objects = [o for o in objects if (o["x"] - bx) ** 2 + (o["z"] - bz) ** 2 > 26 ** 2]
        objects.append({"kind": "church", "x": round(bx, 2), "z": round(bz + 6, 2), "w": 12.0, "d": 28.0, "h": 13.0, "yaw": 0.0})

    def icons(mask):
        comp, n = ndi.label(ndi.binary_closing(mask, iterations=2))
        out = []
        for i in range(1, n + 1):
            yy, xx = np.nonzero(comp == i)
            if len(xx) < 200:
                continue
            out.append(px_to_world(xx.mean(), yy.mean()))
        return out

    teams = {"blue": icons(blue), "red": icons(red)}
    centre = {k: np.mean(v, axis=0) if v else np.zeros(2) for k, v in teams.items()}
    spawns = {}
    for team, pts in teams.items():
        other = centre["red" if team == "blue" else "blue"]
        spawns[team] = [{"x": round(x, 1), "z": round(z, 1), "heading": round(math.atan2(other[0] - x, other[1] - z), 3)} for x, z in pts]

    # nothing stands on a road or in the water
    def clear(o):
        j = int((o["x"] + SIZE / 2) / SIZE * RES_C)
        i = int((o["z"] + SIZE / 2) / SIZE * RES_C)
        if not (0 <= i < RES_C and 0 <= j < RES_C):
            return False
        c = cls[i, j]
        if o["kind"] in ("house", "church"):
            return c not in (ROAD, WATER)
        return c != WATER

    objects = [o for o in objects if clear(o)]
    counts = {c: round(float((cls == i).mean()) * 100, 1) for i, c in enumerate(CLASSES)}
    kinds = {}
    for o in objects:
        kinds[o["kind"]] = kinds.get(o["kind"], 0) + 1
    out = {
        "id": "normandy",
        "name": "諾曼底",
        "size_m": SIZE,
        "grid": {"cols": 7, "rows": 7, "col_labels": [str(i + 1) for i in range(7)], "row_labels": list("abcdefg")},
        "water_level_m": 0.0,
        "classes": {"res": RES_C, "names": CLASSES, "data": pack(cls, np.uint8)},
        "heights": {"res": RES_H, "scale_m": 0.01, "data": pack(np.round(hs * 100), "<i2")},
        "colors": {"res": RES_COL, "data": pack(colors, np.uint8)},
        "surfaces": {"water": "mud", "sand": "sand", "grass": "grass", "forest": "grass", "road": "road", "rock": "gravel", "farm": "dirt", "town": "road"},
        "spawns": spawns,
        "points": points,
        "objects": objects,
        "source": "drawing.png (tactical map), heights_reference.png (height sheet), overview_reference.png",
        "notes": f"generated by tools/map-normandy.py; ground types (% of area): {counts}; objects: {kinds}",
    }
    with open(os.path.join(base, "map.json"), "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
        f.write("\n")
    print("ground", counts)
    print("heights %.1f .. %.1f m" % (h.min(), h.max()))
    for p in points:
        j = int((p["x"] + SIZE / 2) / SIZE * RES_C)
        i = int((p["z"] + SIZE / 2) / SIZE * RES_C)
        print("point", p["id"], p["x"], p["z"], "height %.1f m" % h[i, j])
    print("spawns", spawns)
    print("objects", kinds)
    Image.fromarray(np.flipud(colors)).save(os.path.join(base, "preview_colors.png"))
    hv = np.flipud(np.clip((h + 10) / 70 * 255, 0, 255)).astype(np.uint8)
    Image.fromarray(hv).save(os.path.join(base, "preview_heights.png"))


if __name__ == "__main__":
    main()
