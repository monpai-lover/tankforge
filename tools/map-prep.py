#!/usr/bin/env python3
"""Turns a drawn battle map into game map data.

The drawing is a square map with a 10 x 10 grid (row letters down the left, column numbers along
the top), painted in a few flat colours: sea / rivers / lakes (blue), beaches (sand), grass, forest
(dark green), dirt roads (brown) and bare rock (grey-brown). Blue and red tank icons mark where
the two teams start. This tool finds the grid, reads every colour as a ground type, removes the
grid lines, the labels and the icons, and writes:

  classes  1024 x 1024 ground types (0 water, 1 sand, 2 grass, 3 forest, 4 road, 5 rock)
  heights  512 x 512 terrain heights in centimetres: the sea bed and river beds below the water
           level (0 m), beaches rising from it, gentle hills inland, forests on low rises, the
           rock as a knoll; roads are smoothed so they run level, and a road drawn across water
           becomes a causeway (the drawn bridges)
  spawns   the team start points (centre of each tank icon), each facing the other team

Usage: python3 tools/map-prep.py drawing.png data/maps/<id>/map.json [--name 海岸河口] [--size 2000]
Needs numpy, pillow and scipy.
"""
import argparse
import base64
import json
import math
import os
import zlib

import numpy as np
from PIL import Image
from scipy import ndimage as ndi

CLASSES = ["water", "sand", "grass", "forest", "road", "rock"]
PALETTE = np.array([
    (43, 103, 144),   # water
    (216, 198, 140),  # sand
    (150, 172, 88),   # grass
    (100, 130, 62),   # forest
    (108, 84, 60),    # road
    (126, 128, 90),   # rock
], dtype=float)
WATER, SAND, GRASS, FOREST, ROAD, ROCK = range(6)
RES_C = 1024
RES_H = 512


def grid_lines(dark, axis, n=11):
    """Positions (px) of the n grid lines along one axis: runs of mostly-dark columns or rows,
    leaving out the thick border bands at the image edges."""
    frac = dark.mean(axis=axis)
    idx = np.nonzero(frac > 0.5)[0]
    runs = []
    for i in idx:
        if runs and i - runs[-1][-1] <= 1:
            runs[-1].append(i)
        else:
            runs.append([i])
    size = dark.shape[1 - axis] if axis == 0 else dark.shape[0]
    runs = [r for r in runs if r[0] > 2 and r[-1] < size - 3]
    if len(runs) != n:
        raise SystemExit(f"expected {n} grid lines along axis {axis}, found {len(runs)}: {[(r[0], r[-1]) for r in runs]}")
    return np.array([(r[0] + r[-1]) / 2.0 for r in runs])


def classify(rgb):
    """Nearest palette colour per pixel; -1 where the drawing has ink, labels or tank icons."""
    flat = rgb.reshape(-1, 3).astype(float)
    d = ((flat[:, None, :] - PALETTE[None, :, :]) ** 2).sum(axis=2)
    lab = d.argmin(axis=1).reshape(rgb.shape[:2])
    r, g, b = (rgb[..., k].astype(int) for k in range(3))
    ink = (r + g + b) < 200
    blue_icon = (b > 170) & (r < 90) & (g < 150) & (b - g > 70)
    red_icon = (r > 170) & (g < 90) & (b < 90)
    # the anti-aliased edges of lines and letters, and the icons' outlines and drop shadows,
    # are not ground either
    unknown = ndi.binary_dilation(ink, iterations=3) | ndi.binary_dilation(blue_icon | red_icon, iterations=18)
    lab[unknown] = -1
    return lab, blue_icon, red_icon


def fill_unknown(lab):
    """Unknown pixels take the class of the nearest known pixel."""
    unknown = lab < 0
    idx = ndi.distance_transform_edt(unknown, return_distances=False, return_indices=True)
    return lab[idx[0], idx[1]]


def despeckle(lab, size=5):
    """Majority vote in a small window, with roads counted double so the thin lines survive."""
    votes = []
    for c in range(len(CLASSES)):
        v = ndi.uniform_filter((lab == c).astype(np.float32), size=size)
        votes.append(v * (2.0 if c == ROAD else 1.0))
    return np.argmax(np.stack(votes), axis=0)


def to_world(lab, xs, ys, res):
    """Resamples the drawing onto a res x res world grid. Row 0 is the south edge (bottom of the
    drawing), column 0 the west edge; the grid squares of the drawing map onto equal squares."""
    n = len(xs) - 1
    u = (np.arange(res) + 0.5) / res * n          # grid units from the west / south edge
    col = np.minimum(u.astype(int), n - 1)
    px = xs[col] + (u - col) * (xs[col + 1] - xs[col])
    v = n - u                                     # drawing rows run north to south
    row = np.minimum(v.astype(int), n - 1)
    py = ys[row] + (v - row) * (ys[row + 1] - ys[row])
    pxi = np.clip(np.round(px).astype(int), 0, lab.shape[1] - 1)
    pyi = np.clip(np.round(py).astype(int), 0, lab.shape[0] - 1)
    return lab[pyi[:, None], pxi[None, :]]


def px_to_world(px, py, xs, ys, size):
    n = len(xs) - 1
    def along(p, lines):
        i = int(np.clip(np.searchsorted(lines, p) - 1, 0, n - 1))
        return i + (p - lines[i]) / (lines[i + 1] - lines[i])
    gx = along(px, xs)
    gy = along(py, ys)
    return -size / 2 + gx * size / n, size / 2 - gy * size / n


def smooth_noise(shape, sigma_px, seed):
    rng = np.random.default_rng(seed)
    f = ndi.gaussian_filter(rng.standard_normal(shape), sigma_px, mode="wrap")
    return f / (np.abs(f).max() + 1e-9)


def heights(cls, size):
    """Terrain heights (m) on the class grid, from a signed distance to the shore."""
    texel = size / cls.shape[0]
    water = cls == WATER
    d_land = ndi.distance_transform_edt(~water) * texel   # on land: metres to the nearest water
    d_water = ndi.distance_transform_edt(water) * texel   # in water: metres to the nearest land
    # inland water (lakes, ponds) is a component that does not reach the map edge
    comp, n = ndi.label(water)
    edge = set(np.unique(np.concatenate([comp[0], comp[-1], comp[:, 0], comp[:, -1]]))) - {0}
    inland = water & ~np.isin(comp, list(edge))

    h = np.zeros(cls.shape, dtype=np.float64)
    # beaches rise from the waterline; inland the ground climbs gently, with rolling hills
    s = d_land
    hills = (0.6 * smooth_noise(cls.shape, 60 / texel, 7) + 0.4 * smooth_noise(cls.shape, 22 / texel, 11))
    inland_w = np.clip((s - 30) / 130, 0, 1) ** 1.5
    land = 2.4 * (1 - np.exp(-s / 28)) + np.minimum(0.022 * np.maximum(s - 30, 0), 9.0) + 4.5 * hills * inland_w
    land += 1.2 * ndi.gaussian_filter((cls == FOREST).astype(float), 10 / texel)
    land += 5.0 * ndi.gaussian_filter((cls == ROCK).astype(float), 18 / texel) ** 0.8
    land = np.maximum(land, 0.25 * (1 - np.exp(-s / 6)))
    # sea and river beds: shelving away from the shore; lakes and ponds shallower
    depth = np.minimum(0.35 + 0.065 * d_water, 9.0)
    depth = np.where(inland, np.minimum(0.3 + 0.05 * d_water, 3.5), depth)
    h = np.where(water, -depth, land)
    # roads run level: the ground under them is smoothed, and blended into the sides
    road = ndi.binary_dilation(cls == ROAD, iterations=1)
    even = ndi.gaussian_filter(np.where(water, 0.6, h), 12 / texel)
    even = np.maximum(even, 0.6)   # a road drawn across water is a causeway above it
    blend = np.clip(ndi.gaussian_filter(road.astype(float), 4 / texel) * 2.2, 0, 1)
    h = h * (1 - blend) + even * blend
    h = np.where(road, even, h)
    # a light final smoothing so no texel step shows, keeping the shoreline where it is
    sm = ndi.gaussian_filter(h, 1.2)
    h = np.where(water & ~road, np.minimum(sm, -0.2), np.where(road, h, np.maximum(sm, 0.05)))
    return h


def pack(arr, dtype):
    raw = np.ascontiguousarray(arr.astype(dtype)).tobytes()
    return base64.b64encode(zlib.compress(raw, 9)).decode("ascii")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("drawing")
    ap.add_argument("out")
    ap.add_argument("--id", default="coast")
    ap.add_argument("--name", default="海岸河口")
    ap.add_argument("--size", type=float, default=2000.0)
    a = ap.parse_args()

    rgb = np.asarray(Image.open(a.drawing).convert("RGB"))
    dark = rgb.sum(axis=2) < 150
    xs = grid_lines(dark, 0)
    ys = grid_lines(dark, 1)
    lab, blue, red = classify(rgb)
    # grid lines, even where they are faint (a road drawn along a line keeps its pixels)
    band = np.zeros(lab.shape, bool)
    for x in xs:
        band[:, max(0, int(x) - 3):int(x) + 4] = True
    for y in ys:
        band[max(0, int(y) - 3):int(y) + 4, :] = True
    lab[band & (lab != ROAD)] = -1
    # the row / column labels sit in the first row and column: their ink is filled like any other
    lab = despeckle(fill_unknown(lab))
    cls = to_world(lab, xs, ys, RES_C).astype(np.int16)
    # stray bits of road (a faint grid line read as a dirt track) are not part of the network
    comp, n = ndi.label(cls == ROAD)
    sizes = ndi.sum(np.ones_like(comp), comp, index=np.arange(1, n + 1))
    for i, sz in enumerate(sizes, start=1):
        if sz < 150:
            cls[comp == i] = -1
    cls = fill_unknown(cls).astype(np.uint8)
    h = heights(cls, a.size)
    hs = h.reshape(RES_H, RES_C // RES_H, RES_H, RES_C // RES_H).mean(axis=(1, 3))

    def icons(mask):
        comp, n = ndi.label(ndi.binary_closing(mask, iterations=2))
        out = []
        for i in range(1, n + 1):
            yy, xx = np.nonzero(comp == i)
            if len(xx) < 60:
                continue
            out.append(px_to_world(xx.mean(), yy.mean(), xs, ys, a.size))
        return out

    teams = {"blue": icons(blue), "red": icons(red)}
    centre = {k: np.mean(v, axis=0) if v else np.zeros(2) for k, v in teams.items()}
    spawns = {}
    for team, pts in teams.items():
        other = centre["red" if team == "blue" else "blue"]
        spawns[team] = [{"x": round(x, 1), "z": round(z, 1), "heading": round(math.atan2(other[0] - x, other[1] - z), 3)} for x, z in pts]

    counts = {c: round(float((cls == i).mean()) * 100, 1) for i, c in enumerate(CLASSES)}
    out = {
        "id": a.id,
        "name": a.name,
        "size_m": a.size,
        "grid": {"cols": len(xs) - 1, "rows": len(ys) - 1, "col_labels": [str(i + 1) for i in range(len(xs) - 1)], "row_labels": [chr(ord("A") + i) for i in range(len(ys) - 1)]},
        "water_level_m": 0.0,
        "classes": {"res": RES_C, "names": CLASSES, "data": pack(cls, np.uint8)},
        "heights": {"res": RES_H, "scale_m": 0.01, "data": pack(np.round(hs * 100), "<i2")},
        "surfaces": {"water": "mud", "sand": "sand", "grass": "grass", "forest": "grass", "road": "dirt", "rock": "gravel"},
        "spawns": spawns,
        "source": os.path.basename(a.drawing),
        "notes": f"generated by tools/map-prep.py; ground types (% of area): {counts}",
    }
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print("grid x", np.round(xs, 1).tolist())
    print("grid y", np.round(ys, 1).tolist())
    print("ground", counts)
    print("heights %.1f .. %.1f m" % (h.min(), h.max()))
    print("spawns", spawns)


if __name__ == "__main__":
    main()
