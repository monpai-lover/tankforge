// Fit check of a vehicle's visual parts, headless (the game's own part geometry):
//  - floating: pieces that touch nothing of their group (hull, each turret with its guns) and
//    are not joined to its biggest piece through other pieces
//  - clipping: turret and gun pieces passing through the hull's pieces as the turret swings round
//    (gun level and at full depression), the gun through the turret's own pieces at full
//    depression and elevation, and roof machine guns through the turret as they swing
// Imported models are the authors' own and are not checked; their surfaces near the generated
// pieces count as something those pieces may stand on.
//   node tools/fitcheck.mjs [vehicle ...]      (all vehicles when none is named)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadData } from './load-data.mjs';
import { makeLoadout, depressionAt } from '../src/game/loadout.js';
import { GeoBuilder, STRIDE } from '../src/gfx/geo.js';
import { addPart, materials } from '../src/gfx/tankmodel.js';
import { decodeAllImported } from '../src/gfx/imported.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MG = JSON.parse(fs.readFileSync(path.join(HERE, '../assets/mg_models.json'), 'utf8'));
const EPS = 0.012; // pieces closer than this touch
const CELL = 0.12;

// ---------------------------------------------------------------- geometry
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Squared distance from p to triangle abc (Ericson). */
function ptTri(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  const q = (x) => { const d = sub(p, x); return dot(d, d); };
  if (d1 <= 0 && d2 <= 0) return q(a);
  const bp = sub(p, b), d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return q(b);
  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) { const v = d1 / (d1 - d3); return q([a[0] + ab[0] * v, a[1] + ab[1] * v, a[2] + ab[2] * v]); }
  const cp = sub(p, c), d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return q(c);
  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) { const w = d2 / (d2 - d6); return q([a[0] + ac[0] * w, a[1] + ac[1] * w, a[2] + ac[2] * w]); }
  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && d4 - d3 >= 0 && d5 - d6 >= 0) { const w = (d4 - d3) / (d4 - d3 + (d5 - d6)); return q([b[0] + (c[0] - b[0]) * w, b[1] + (c[1] - b[1]) * w, b[2] + (c[2] - b[2]) * w]); }
  const den = 1 / (va + vb + vc), v = vb * den, w = vc * den;
  return q([a[0] + ab[0] * v + ac[0] * w, a[1] + ab[1] * v + ac[1] * w, a[2] + ab[2] * v + ac[2] * w]);
}

/** The point of triangle abc nearest p (by sampling its plane and edges; enough for a hint). */
function closest(p, [a, b, c]) {
  let best = a, bd = Infinity;
  const n = 12;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
    const u = i / n, v = j / n, w = 1 - u - v;
    const q = [0, 1, 2].map((k) => a[k] * w + b[k] * u + c[k] * v);
    const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
    if (d < bd) { bd = d; best = q; }
  }
  return best;
}

/** Does segment pq cross triangle abc well inside it (not at its rim)? */
function segTri(p, q, a, b, c, m = 0.02) {
  const ab = sub(b, a), ac = sub(c, a), qp = sub(p, q);
  const n = cross(ab, ac);
  const d = dot(qp, n);
  if (Math.abs(d) < 1e-12) return false;
  const ap = sub(p, a);
  let t = dot(ap, n) / d;
  if (t <= m || t >= 1 - m) return false;
  const e = cross(qp, ap);
  let v = dot(ac, e) / d, w = -dot(ab, e) / d;
  return v > m && w > m && v + w < 1 - m;
}

function triTriCross(A, B, m = 0.02) {
  for (let i = 0; i < 3; i++) if (segTri(A[i], A[(i + 1) % 3], B[0], B[1], B[2], m)) return true;
  for (let i = 0; i < 3; i++) if (segTri(B[i], B[(i + 1) % 3], A[0], A[1], A[2], m)) return true;
  return false;
}

/** A piece: its triangles (array of [a,b,c]) and a grid of them. */
function piece(name, tris, extra = {}) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const t of tris) for (const p of t) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
  const grid = new Map();
  tris.forEach((t, i) => {
    const l = [0, 1, 2].map((k) => Math.floor((Math.min(t[0][k], t[1][k], t[2][k]) - EPS) / CELL));
    const h = [0, 1, 2].map((k) => Math.floor((Math.max(t[0][k], t[1][k], t[2][k]) + EPS) / CELL));
    for (let x = l[0]; x <= h[0]; x++) for (let y = l[1]; y <= h[1]; y++) for (let z = l[2]; z <= h[2]; z++) {
      const key = `${x},${y},${z}`;
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }
  });
  return { name, tris, lo, hi, grid, ...extra };
}

const boxesMeet = (a, b, e) => a.lo.every((v, k) => v - e <= b.hi[k] && b.lo[k] - e <= a.hi[k]);

/** Candidate triangles of B near triangle t. */
function near(B, t) {
  const l = [0, 1, 2].map((k) => Math.floor((Math.min(t[0][k], t[1][k], t[2][k]) - EPS) / CELL));
  const h = [0, 1, 2].map((k) => Math.floor((Math.max(t[0][k], t[1][k], t[2][k]) + EPS) / CELL));
  const out = new Set();
  for (let x = l[0]; x <= h[0]; x++) for (let y = l[1]; y <= h[1]; y++) for (let z = l[2]; z <= h[2]; z++) {
    const c = B.grid.get(`${x},${y},${z}`);
    if (c) for (const i of c) out.add(i);
  }
  return out;
}

/** Is p inside the closed surface of B (ray parity along a skewed +x)? */
function inside(p, B) {
  if (p.some((v, k) => v < B.lo[k] || v > B.hi[k])) return false;
  const q = [B.hi[0] + 1, p[1] + 0.000731, p[2] + 0.000419];
  let n = 0;
  for (const t of B.tris) {
    if (Math.max(t[0][1], t[1][1], t[2][1]) < p[1] - 0.01 || Math.min(t[0][1], t[1][1], t[2][1]) > p[1] + 0.01) continue;
    if (Math.max(t[0][2], t[1][2], t[2][2]) < p[2] - 0.01 || Math.min(t[0][2], t[1][2], t[2][2]) > p[2] + 0.01) continue;
    if (segTriAny(p, q, t[0], t[1], t[2])) n++;
  }
  return n % 2 === 1;
}

function segTriAny(p, q, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), qp = sub(p, q);
  const n = cross(ab, ac);
  const d = dot(qp, n);
  if (Math.abs(d) < 1e-14) return false;
  const ap = sub(p, a);
  const t = dot(ap, n) / d;
  if (t < 0 || t > 1) return false;
  const e = cross(qp, ap);
  const v = dot(ac, e) / d, w = -dot(ab, e) / d;
  return v >= 0 && w >= 0 && v + w <= 1;
}

/** Points over a triangle: its corners and a barycentric grid (faces lying flat on each other). */
const SAMPLES = new WeakMap();
function samples(t) {
  let out = SAMPLES.get(t);
  if (out) return out;
  out = [];
  const n = 4;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
    const a = i / n, b = j / n, c = 1 - a - b;
    out.push([0, 1, 2].map((k) => t[0][k] * c + t[1][k] * a + t[2][k] * b));
  }
  SAMPLES.set(t, out);
  return out;
}

function touches(A, B) {
  if (!boxesMeet(A, B, EPS)) return false;
  // one piece wholly inside the other (a barrel's end in its sleeve)
  if (inside(A.tris[0][0], B) || inside(B.tris[0][0], A)) return true;
  const e2 = EPS * EPS;
  for (const t of A.tris) {
    for (const j of near(B, t)) {
      const u = B.tris[j];
      for (const p of samples(t)) if (ptTri(p, u[0], u[1], u[2]) < e2) return true;
      for (const p of samples(u)) if (ptTri(p, t[0], t[1], t[2]) < e2) return true;
      if (triTriCross(t, u, 0)) return true;
    }
  }
  return false;
}

/** How many of A's triangles cut through B's surface. */
function crossings(A, B) {
  if (!boxesMeet(A, B, 0)) return 0;
  let n = 0;
  for (const t of A.tris) {
    for (const j of near(B, t)) if (triTriCross(t, B.tris[j])) { n++; break; }
  }
  return n;
}

// ---------------------------------------------------------------- vehicle pieces
function trisOf(b) {
  const d = b.data, out = [];
  for (let i = 0; i < d.length; i += STRIDE * 3) {
    const v = (k) => [d[i + k * STRIDE], d[i + k * STRIDE + 1], d[i + k * STRIDE + 2]];
    out.push([v(0), v(1), v(2)]);
  }
  return out;
}

function partLabel(p, i) {
  const at = p.pos ? ` @(${p.pos.map((v) => v.toFixed(2)).join(', ')})` : p.y0 != null ? ` y${p.y0.toFixed(2)}..${p.y1.toFixed(2)}` : '';
  const size = p.size ? ` ${p.size.map((v) => v.toFixed(2)).join('x')}` : p.r ? ` r${p.r} l${p.len}` : '';
  return `#${i} ${p.type}${p.mount !== 'hull' ? ' ' + p.mount : ''}${p.hinge ? ' hinged' : ''} ${p.mat || 'paint'}${size}${at}`;
}

const rotY = (p, c, a) => {
  const s = Math.sin(a), k = Math.cos(a), x = p[0] - c[0], z = p[2] - c[2];
  return [c[0] + x * k + z * s, p[1], c[2] - x * s + z * k];
};
const rotX = (p, c, a) => {
  // elevation: positive raises the muzzle (+z end goes up)
  const s = Math.sin(a), k = Math.cos(a), y = p[1] - c[1], z = p[2] - c[2];
  return [p[0], c[1] + y * k + z * s, c[2] - y * s + z * k];
};
const moved = (P, f) => piece(P.name, P.tris.map((t) => t.map(f)), { part: P.part, group: P.group, gun: P.gun });

function checkVehicle(id, data) {
  const bundle = data.vehicles[id];
  if (!bundle) throw new Error(`no vehicle ${id}`);
  const lo = makeLoadout(id, { ...bundle, imported: bundle.model || null }, data.projectiles, data.machineGuns);
  const mats = materials(bundle.visual.palette || {});
  const pieces = [];
  const fold = Number(process.env.FITCHECK_FOLD || 0);
  bundle.visual.parts.forEach((p, i) => {
    const b = new GeoBuilder();
    addPart(b, p, [0, 0, 0], mats);
    let tris = trisOf(b);
    // a flap on its hinge, folded as far as FITCHECK_FOLD (0 raised .. 1 folded)
    if (p.hinge && fold) {
      const { a, b: e, angle } = p.hinge;
      const k = sub(e, a), l = Math.hypot(...k), u = k.map((v) => v / l);
      const th = (angle * Math.PI * fold) / 180, c = Math.cos(th), sn = Math.sin(th);
      const rot = (v) => {
        const r = sub(v, a), kd = dot(u, r), kx = cross(u, r);
        return [0, 1, 2].map((j) => a[j] + r[j] * c + kx[j] * sn + u[j] * kd * (1 - c));
      };
      tris = tris.map((t) => t.map(rot));
    }
    if (!tris.length) return;
    const group = p.mount === 'turret' || p.mount === 'gun' ? `turret${p.turret || 0}` : 'hull';
    pieces.push(piece(partLabel(p, i), tris, { part: p, group, gun: p.mount === 'gun' ? p.gun || 0 : null }));
  });
  // an imported model's triangles near the generated pieces of the same group: anchors only
  if (bundle.imported) {
    const reach = 0.15;
    for (const ip of bundle.imported.parts) {
      const group = ip.mount === 'hull' ? 'hull' : ['turret', 'gun', 'barrel'].includes(ip.mount) ? `turret${ip.turret || 0}` : null;
      if (!group) continue;
      const mine = pieces.filter((P) => P.group === group);
      if (!mine.length) continue;
      const tris = [];
      const v = (i) => [ip.pos[i * 3] / 1000, ip.pos[i * 3 + 1] / 1000, ip.pos[i * 3 + 2] / 1000];
      for (let t = 0; t < ip.idx.length; t += 3) {
        const tri = [v(ip.idx[t]), v(ip.idx[t + 1]), v(ip.idx[t + 2])];
        const lo3 = [0, 1, 2].map((k) => Math.min(tri[0][k], tri[1][k], tri[2][k]));
        const hi3 = [0, 1, 2].map((k) => Math.max(tri[0][k], tri[1][k], tri[2][k]));
        if (mine.some((P) => [0, 1, 2].every((k) => lo3[k] <= P.hi[k] + reach && hi3[k] >= P.lo[k] - reach))) tris.push(tri);
      }
      if (tris.length) pieces.push(piece(`imported ${ip.mount} part`, tris, { group, anchor: true, part: { type: 'imported' } }));
    }
  }
  // roof machine guns: the post and the gun on the first turret
  const mgs = [];
  for (const m of lo.machineGuns) {
    if (m.mount !== 'pintle') continue;
    const [x, y, z] = m.pos;
    const b = new GeoBuilder();
    b.cyl([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y - m.post / 2, z, 1], false, 'y', 0.035, 0.028, m.post, 10, mats.steel);
    const post = piece(`${m.id} post (${x}, ${(y - m.post).toFixed(2)}..${y}, ${z})`, trisOf(b), { group: 'turret0', part: {} });
    pieces.push(post);
    const a = MG[m.weapon];
    if (a) {
      const tris = [];
      for (let t = 0; t < a.triangles; t++) {
        const o = t * 9;
        tris.push([0, 1, 2].map((k) => [x + a.pos[o + k * 3] / 1000, y + a.pos[o + k * 3 + 1] / 1000, z + a.pos[o + k * 3 + 2] / 1000]));
      }
      const gun = piece(`${m.id} gun`, tris, { group: 'turret0', part: {} });
      pieces.push(gun);
      mgs.push({ m, gun });
    }
  }

  const report = { id, floating: [], clipping: [], surface: [] };
  // FITCHECK_DUMP=dir: every piece's triangles, for drawing sections over a reference's
  if (process.env.FITCHECK_DUMP) {
    const out = pieces.map((P) => ({ name: P.name, group: P.group, gun: P.gun, t: P.tris.flat(2).map((v) => Math.round(v * 1000)) }));
    fs.writeFileSync(path.join(process.env.FITCHECK_DUMP, `${id}.json`), JSON.stringify(out));
  }
  // FITCHECK_SURFACE="x,z;x,z": the height of the highest surface of the hull and turret there
  for (const q of (process.env.FITCHECK_SURFACE || '').split(';').filter(Boolean)) {
    const [x, z] = q.split(',').map(Number);
    let top = -Infinity, who = '';
    for (const P of pieces) {
      if (P.part && !P.part.type) continue; // the machine guns themselves
      for (const [a, b, c] of P.tris) {
        const d = (b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2]);
        if (Math.abs(d) < 1e-12) continue;
        const u = ((x - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (z - a[2])) / d;
        const v = ((b[0] - a[0]) * (z - a[2]) - (x - a[0]) * (b[2] - a[2])) / d;
        if (u < 0 || v < 0 || u + v > 1) continue;
        const y = a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v;
        if (y > top) { top = y; who = P.name; }
      }
    }
    report.surface.push(`surface at (${x}, ${z}): y ${top.toFixed(3)} on ${who}`);
  }
  // ---- floating: connected components per group
  const groups = [...new Set(pieces.map((p) => p.group))];
  for (const g of groups) {
    const ps = pieces.filter((p) => p.group === g);
    const n = ps.length;
    const parent = ps.map((_, i) => i);
    const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
      if (find(i) === find(j)) continue;
      if (touches(ps[i], ps[j])) parent[find(i)] = find(j);
    }
    // the main body: the component with the biggest piece (by box volume)
    const vol = (p) => (p.hi[0] - p.lo[0]) * (p.hi[1] - p.lo[1]) * (p.hi[2] - p.lo[2]);
    let big = 0;
    ps.forEach((p, i) => { if (vol(p) > vol(ps[big])) big = i; });
    const comps = new Map();
    ps.forEach((p, i) => { const r = find(i); if (!comps.has(r)) comps.set(r, []); comps.get(r).push(p); });
    for (const [r, list] of comps) {
      if (r === find(big)) continue;
      if (list.every((p) => p.anchor)) continue;
      // a turret's loose pieces may stand on the hull (a ring) - those are not floating
      if (g !== 'hull' && list.some((p) => pieces.some((h) => h.group === 'hull' && touches(p, h)))) continue;
      // the nearest piece of the rest of the vehicle, and how far
      let best = { d: Infinity, name: '' };
      for (const p of list) {
        for (const q of pieces) {
          if (list.includes(q)) continue;
          const gap = Math.max(0, ...[0, 1, 2].map((k) => Math.max(p.lo[k] - q.hi[k], q.lo[k] - p.hi[k])));
          if (gap > Math.min(best.d, 0.5)) continue;
          for (const t of p.tris) for (const v of t) for (const u of q.tris) {
            const d = ptTri(v, u[0], u[1], u[2]);
            if (d < best.d * best.d || best.d === Infinity) {
              const r = Math.sqrt(d);
              if (r < best.d) best = { d: r, name: q.name, from: v, tri: u };
            }
          }
        }
      }
      // the way to move the loose pieces to close the gap (towards the nearest point found)
      let move = '';
      if (best.tri) {
        const c = closest(best.from, best.tri);
        move = `  move (${c.map((v, k) => (v - best.from[k]).toFixed(3)).join(', ')})`;
      }
      report.floating.push({ group: g, pieces: list.map((p) => p.name), near: best.d < Infinity ? `${best.d.toFixed(3)} m from ${best.name}${move}` : '' });
    }
  }

  // ---- clipping: the turret swinging round over the hull, gun level and depressed
  lo.turrets.forEach((t, ti) => {
    const g = `turret${ti}`;
    const own = pieces.filter((p) => p.group === g && !p.anchor);
    if (!own.length) return;
    const hull = pieces.filter((p) => p.group === 'hull' && !p.anchor);
    const limit = t.limit || [-Math.PI, Math.PI];
    const facing = t.facing || 0;
    const hits = new Map();
    const dep = ((t.guns[0]?.def?.max_depression_deg ?? 0) * Math.PI) / 180;
    const ele = ((t.guns[0]?.def?.max_elevation_deg ?? 0) * Math.PI) / 180;
    for (let k = 0; k <= 24; k++) {
      const yaw = limit[0] + ((limit[1] - limit[0]) * k) / 24;
      const d = (depressionAt(t, yaw, (dep * 180) / Math.PI) * Math.PI) / 180;
      for (const pitch of [0, -d]) {
        for (const P of own) {
          const tr = t.guns[P.gun ?? 0]?.trunnion;
          const f = (p) => rotY(P.gun != null && tr ? rotX(p, tr, pitch) : p, t.pivot, yaw + facing);
          const Q = moved(P, f);
          for (const H of hull) {
            const c = crossings(Q, H);
            const key = `${P.name}|${H.name}`;
            if (c > 0) {
              const r = hits.get(key) || { a: P.name, b: H.name, at: [], max: 0 };
              r.at.push(`${Math.round((yaw * 180) / Math.PI)}°${pitch ? ' dep' : ''}`);
              r.max = Math.max(r.max, c);
              hits.set(key, r);
            }
          }
        }
      }
    }
    // FITCHECK_DEPTABLE: the deepest the gun may dip at each 10 degrees without cutting the hull
    if (process.env.FITCHECK_DEPTABLE && ti === 0) {
      const gunParts = own.filter((P) => P.gun != null);
      const cuts = (yaw, pitch) => {
        for (const P of gunParts) {
          const tr = t.guns[P.gun]?.trunnion;
          if (!tr) continue;
          const at = (q) => moved(P, (p) => rotY(rotX(p, tr, q), t.pivot, yaw + facing));
          const Q = at(pitch), R = at(0);
          for (const H of hull) if (crossings(Q, H) > crossings(R, H)) return true;
        }
        return false;
      };
      const full = (dep * 180) / Math.PI;
      const tab = [];
      for (let b = 0; b < 36; b++) {
        const yaw = (b * 10 * Math.PI) / 180;
        let d = full;
        while (d > -10 && cuts(yaw, (-d * Math.PI) / 180)) d -= 0.5;
        tab.push([b * 10, d]);
      }
      tab.push([360, tab[0][1]]);
      report.surface.push(`dep_table ${JSON.stringify(tab)}`);
    }
    // a piece cutting the hull at every bearing sits in the ring: report only partial sweeps
    const sweeps = 2 * 25;
    for (const r of hits.values()) if (r.at.length < sweeps) report.clipping.push({ what: `${r.a}  x  hull ${r.b}`, at: compact(r.at), tris: r.max });
    // the gun through its own turret at full depression and elevation
    const guns = own.filter((p) => p.gun != null && p.part.recoil);
    const shell = own.filter((p) => p.gun == null);
    for (const P of guns) {
      const tr = t.guns[P.gun]?.trunnion;
      if (!tr) continue;
      for (const [pitch, tag] of [[-dep, 'depressed'], [ele, 'elevated']]) {
        const Q = moved(P, (p) => rotX(p, tr, pitch));
        for (const S of shell) {
          const rest = crossings(P, S);
          const c = crossings(Q, S);
          if (c > rest) report.clipping.push({ what: `${P.name}  x  turret ${S.name}`, at: tag, tris: c });
        }
      }
    }
  });
  // roof machine guns swinging round on their posts, through the turret and its fittings
  for (const { m, gun } of mgs) {
    const shell = pieces.filter((p) => p.group === 'turret0' && p !== gun && !p.name.startsWith(m.id));
    const at = new Map();
    for (let k = 0; k < 24; k++) {
      const yaw = (k / 24) * Math.PI * 2;
      const Q = moved(gun, (p) => rotY(p, m.pos, yaw));
      for (const S of shell) if (crossings(Q, S) > 0) { if (!at.has(S.name)) at.set(S.name, []); at.get(S.name).push(`${k * 15}°`); }
    }
    for (const [s, list] of at) report.clipping.push({ what: `${m.id} gun  x  ${s}`, at: compact(list), tris: 0 });
  }
  return report;
}

function compact(list) {
  return list.length > 6 ? `${list.slice(0, 3).join(' ')} … ${list.slice(-2).join(' ')} (${list.length} poses)` : list.join(' ');
}

const data = loadData();
const ids = process.argv.slice(2).length ? process.argv.slice(2) : data.order;
await decodeAllImported(data.vehicles);
let bad = 0;
for (const id of ids) {
  const r = checkVehicle(id, data);
  const n = r.floating.length + r.clipping.length;
  bad += n;
  console.log(`== ${id}: ${r.floating.length} floating, ${r.clipping.length} clipping`);
  for (const f of r.floating) console.log(`  floating [${f.group}] ${f.pieces.join(' + ')}${f.near ? `\n      gap ${f.near}` : ''}`);
  for (const q of r.surface) console.log(`  ${q}`);
  for (const c of r.clipping) console.log(`  clipping ${c.what}  at ${c.at}${c.tris ? `  (${c.tris} tris)` : ''}`);
}
process.exitCode = bad ? 1 : 0;
