// Construction-time bearing geometry. Uses fixed render triangles, never the
// nominal hull box, a rotating retained head, or a per-frame terrain probe.
import { GeoBuilder, STRIDE } from '../gfx/geo.js';
import { addPart, materials } from '../gfx/tankmodel.js';

const fixedSurfaces = new WeakMap();
const r4 = v => Math.round(v * 10000) / 10000;

function surfacesOf(base) {
  if (fixedSurfaces.has(base)) return fixedSurfaces.get(base);
  const tris = [], builder = new GeoBuilder(), mats = materials(base.visual.palette || {});
  for (const p of base.visual.parts) if ((p.mount === 'hull' || p.mount == null) && !p.hinge)
    addPart(builder, p, [0, 0, 0], mats);
  for (let i = 0; i < builder.data.length; i += STRIDE * 3)
    tris.push([0, 1, 2].map(k => builder.data.slice(i + k * STRIDE, i + k * STRIDE + 3)));
  for (const p of base.imported?.parts || []) if (p.mount === 'hull' && !p.hinge)
    for (let i = 0; i < p.idx.length; i += 3)
      tris.push([0, 1, 2].map(k => [0, 1, 2].map(a => p.pos[p.idx[i + k] * 3 + a] / 1000)));
  const out = tris.map(([a, b, c]) => ({ a, b, c,
    den: (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]),
    x0: Math.min(a[0], b[0], c[0]), x1: Math.max(a[0], b[0], c[0]),
    z0: Math.min(a[2], b[2], c[2]), z1: Math.max(a[2], b[2], c[2]),
  })).filter(t => Math.abs(t.den) > 1e-12);
  fixedSurfaces.set(base, out);
  return out;
}

function roofAt(tris, x, z, ceiling) {
  let y = null;
  for (const t of tris) {
    if (x < t.x0 - 1e-7 || x > t.x1 + 1e-7 || z < t.z0 - 1e-7 || z > t.z1 + 1e-7) continue;
    const { a, b, c, den } = t;
    const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / den;
    const v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / den;
    if (u < -1e-7 || v < -1e-7 || u + v > 1 + 1e-7) continue;
    const hit = u * a[1] + v * b[1] + (1 - u - v) * c[1];
    if (hit <= ceiling + 1e-5 && (y === null || hit > y)) y = hit;
  }
  return y;
}

/** Hollow collar to the existing head pivot; an unsupported footprint stays explicit. */
export function workshopTurretSeat(base, layout) {
  const [cx, py, cz] = layout.position_m;
  const outer = layout.ring_diameter_m / 2, inner = outer - Math.min(.09, Math.max(.04, outer * .12));
  const tris = surfacesOf(base), n = 32;
  const sample = radius => Array.from({ length: n }, (_, i) => {
    const a = i * Math.PI * 2 / n, x = r4(cx + radius * Math.cos(a)), z = r4(cz - radius * Math.sin(a));
    return { x, z, y: roofAt(tris, x, z, py) };
  });
  const outside = sample(outer), inside = sample(inner), hits = [...outside, ...inside].filter(p => p.y !== null);
  if (!hits.length) return { part: null, support: { status: 'unsupported', samples: 0 } };
  const lowest = Math.min(...hits.map(p => p.y));
  if (py - lowest <= .006) return { part: null, support: { status: 'already_seated', samples: hits.length } };
  // A ring may overhang an edge. Its unsupported arcs terminate at the lowest
  // verified roof height; the sampled supported arcs make the actual contacts.
  const bottom = points => points.map(p => [p.x, r4((p.y ?? lowest) - .002), p.z]);
  const top = points => points.map(p => [p.x, r4(py + .002), p.z]);
  const lower = bottom(outside);
  return {
    part: { type: 'loft', mount: 'hull', mat: 'paint_dark', name: 'workshop_turret_seat',
      rings: [lower, top(outside), top(inside), bottom(inside), lower], crease: 60, caps: [false, false] },
    support: { status: 'supported', samples: hits.length, lowestRoof: r4(lowest) },
  };
}
