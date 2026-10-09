// Polygon-mesh editing for the vehicle designer (hull and turret bodies).
//
// A mesh is {vertices: [[x,y,z]...], faces: [{id, v: [i...], tag}]}: closed, faces counter-
// clockwise seen from outside -- the same format as crates/design (MeshDef). Every operation
// here keeps the mesh closed and consistently oriented, keeps face ids stable (armour is keyed
// by them) and never renumbers vertices (it only appends; vertices it no longer uses stay in
// the array unreferenced), so a construction history can be replayed on a regenerated base.
//
// Operations return {mesh, created: [{id, parent}]} or throw an Error with a message for the UI.

export const EPS = 1e-9;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => {
  const l = len(a);
  return l < 1e-12 ? [0, 0, 0] : [a[0] / l, a[1] / l, a[2] / l];
};
export const V = { sub, add, mul, dot, cross, len, norm };

export function cloneMesh(m) {
  return { vertices: m.vertices.map((p) => p.slice()), faces: m.faces.map((f) => ({ id: f.id, v: f.v.slice(), tag: f.tag || '' })) };
}

export function nextFaceId(m) {
  let id = -1;
  for (const f of m.faces) id = Math.max(id, f.id);
  return id + 1;
}

export function findFace(m, id) {
  return m.faces.find((f) => f.id === id) || null;
}

export function newell(pts) {
  const n = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return n;
}

export const facePoints = (m, f) => f.v.map((i) => m.vertices[i]);
export const faceNormal = (m, f) => norm(newell(facePoints(m, f)));
export const faceArea = (m, f) => len(newell(facePoints(m, f))) / 2;
export function faceCentroid(m, f) {
  const c = [0, 0, 0];
  for (const i of f.v) {
    c[0] += m.vertices[i][0];
    c[1] += m.vertices[i][1];
    c[2] += m.vertices[i][2];
  }
  return mul(c, 1 / f.v.length);
}

/** Horizontal in-plane axis u and the axis up the face v (same as crates/design mesh::face_frame). */
export function faceFrame(n) {
  let u = cross([0, 1, 0], n);
  if (len(u) < 1e-6) u = sub([1, 0, 0], mul(n, n[0]));
  u = norm(u);
  return { u, v: norm(cross(n, u)) };
}

// ------------------------------------------------------------------ triangulation

function cross2(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** Ear clipping in 2D; returns triangles as local corner indices, counter-clockwise. */
export function triangulate2d(p) {
  const n = p.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) area += p[i][0] * p[(i + 1) % n][1] - p[(i + 1) % n][0] * p[i][1];
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(area >= 0 ? i : n - 1 - i);
  const out = [];
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    const m = idx.length;
    let clipped = false;
    for (let i = 0; i < m; i++) {
      const ia = idx[(i + m - 1) % m];
      const ib = idx[i];
      const ic = idx[(i + 1) % m];
      const a = p[ia];
      const b = p[ib];
      const c = p[ic];
      if (cross2(a, b, c) <= 1e-14) continue;
      let ear = true;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (cross2(a, b, p[j]) >= 0 && cross2(b, c, p[j]) >= 0 && cross2(c, a, p[j]) >= 0) {
          ear = false;
          break;
        }
      }
      if (!ear) continue;
      out.push([ia, ib, ic]);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) {
      for (let k = 1; k < idx.length - 1; k++) out.push([idx[0], idx[k], idx[k + 1]]);
      return out;
    }
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

/** Triangles of a face as local corner indices (works for concave and slightly folded faces). */
export function faceTriangles(m, f) {
  const pts = facePoints(m, f);
  if (pts.length === 3) return [[0, 1, 2]];
  const n = norm(newell(pts));
  const { u, v } = faceFrame(len(n) > 0.5 ? n : [0, 1, 0]);
  const c = faceCentroid(m, f);
  return triangulate2d(pts.map((p) => [dot(sub(p, c), u), dot(sub(p, c), v)]));
}

// ------------------------------------------------------------------ topology

const ekey = (a, b) => a + ',' + b;

/** Directed edge -> face index. */
export function edgeMap(m) {
  const map = new Map();
  m.faces.forEach((f, fi) => {
    for (let k = 0; k < f.v.length; k++) map.set(ekey(f.v[k], f.v[(k + 1) % f.v.length]), fi);
  });
  return map;
}

/** Unique undirected edges [a, b] with a < b. */
export function edges(m) {
  const seen = new Set();
  const out = [];
  for (const f of m.faces) {
    for (let k = 0; k < f.v.length; k++) {
      const a = f.v[k];
      const b = f.v[(k + 1) % f.v.length];
      const key = a < b ? ekey(a, b) : ekey(b, a);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(a < b ? [a, b] : [b, a]);
    }
  }
  return out;
}

/** {open, repeated} directed edges; both empty for a closed, consistently oriented mesh. */
export function checkClosed(m) {
  const count = new Map();
  for (const f of m.faces) {
    for (let k = 0; k < f.v.length; k++) {
      const key = ekey(f.v[k], f.v[(k + 1) % f.v.length]);
      count.set(key, (count.get(key) || 0) + 1);
    }
  }
  const open = [];
  const repeated = [];
  for (const [key, c] of count) {
    const [a, b] = key.split(',').map(Number);
    if (c > 1) repeated.push([a, b]);
    if (!count.has(ekey(b, a))) open.push([a, b]);
  }
  return { open, repeated, closed: open.length === 0 && repeated.length === 0 };
}

export function signedVolume(m) {
  let v = 0;
  for (const f of m.faces) {
    const pts = facePoints(m, f);
    for (const [a, b, c] of faceTriangles(m, f)) v += dot(pts[a], cross(pts[b], pts[c]));
  }
  return v / 6;
}

export function usedVertices(m) {
  const s = new Set();
  for (const f of m.faces) for (const i of f.v) s.add(i);
  return s;
}

export function bounds(m) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const i of usedVertices(m)) {
    const p = m.vertices[i];
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p[k]);
      max[k] = Math.max(max[k], p[k]);
    }
  }
  return { min, max };
}

/** Faces sharing an edge with face fi (indices). */
function connectedComponents(m, faceIdxs) {
  const set = new Set(faceIdxs);
  const em = edgeMap(m);
  const seen = new Set();
  const comps = [];
  for (const start of faceIdxs) {
    if (seen.has(start)) continue;
    const comp = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const fi = stack.pop();
      comp.push(fi);
      const f = m.faces[fi];
      for (let k = 0; k < f.v.length; k++) {
        const t = em.get(ekey(f.v[(k + 1) % f.v.length], f.v[k]));
        if (t != null && set.has(t) && !seen.has(t)) {
          seen.add(t);
          stack.push(t);
        }
      }
    }
    comps.push(comp);
  }
  return comps;
}

// ------------------------------------------------------------------ transforms

export function centroidOf(m, verts) {
  const c = [0, 0, 0];
  for (const i of verts) {
    c[0] += m.vertices[i][0];
    c[1] += m.vertices[i][1];
    c[2] += m.vertices[i][2];
  }
  return verts.length ? mul(c, 1 / verts.length) : c;
}

export function move(m, verts, d) {
  for (const i of verts) m.vertices[i] = add(m.vertices[i], d);
}

/** Rodrigues rotation of the vertices about `axis` through `pivot`. */
export function rotate(m, verts, axis, angle, pivot) {
  const k = norm(axis);
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  for (const i of verts) {
    const p = sub(m.vertices[i], pivot);
    const r = add(add(mul(p, c), mul(cross(k, p), s)), mul(k, dot(k, p) * (1 - c)));
    m.vertices[i] = add(pivot, r);
  }
}

export function scale(m, verts, s, pivot) {
  for (const i of verts) {
    const p = sub(m.vertices[i], pivot);
    m.vertices[i] = [pivot[0] + p[0] * s[0], pivot[1] + p[1] * s[1], pivot[2] + p[2] * s[2]];
  }
}

// ------------------------------------------------------------------ extrude

/**
 * Extrudes the selected faces as regions (faces that share edges move together) along each
 * region's average normal. The faces keep their ids and become the caps; new side faces are
 * created along the region boundary.
 */
export function extrude(m, faceIds, dist) {
  const created = [];
  let next = nextFaceId(m);
  const idxs = faceIds.map((id) => m.faces.findIndex((f) => f.id === id)).filter((i) => i >= 0);
  if (!idxs.length) throw new Error('沒有選取面');
  for (const comp of connectedComponents(m, idxs)) {
    const set = new Set(comp);
    const em = edgeMap(m);
    let n = [0, 0, 0];
    for (const fi of comp) n = add(n, mul(faceNormal(m, m.faces[fi]), faceArea(m, m.faces[fi])));
    n = norm(n);
    if (len(n) < 0.5) throw new Error('選取的面方向互相抵消，無法擠出');
    const remap = new Map();
    const dup = (i) => {
      if (!remap.has(i)) {
        remap.set(i, m.vertices.length);
        m.vertices.push(add(m.vertices[i], mul(n, dist)));
      }
      return remap.get(i);
    };
    const sides = [];
    for (const fi of comp) {
      const f = m.faces[fi];
      for (let k = 0; k < f.v.length; k++) {
        const a = f.v[k];
        const b = f.v[(k + 1) % f.v.length];
        const twin = em.get(ekey(b, a));
        if (twin == null || !set.has(twin)) sides.push({ a, b, parent: f.id, tag: f.tag });
      }
    }
    for (const fi of comp) m.faces[fi].v = m.faces[fi].v.map(dup);
    for (const s of sides) {
      const id = next++;
      m.faces.push({ id, v: [s.a, s.b, remap.get(s.b), remap.get(s.a)], tag: (s.tag || 'face') + '_ext' });
      created.push({ id, parent: s.parent });
    }
  }
  return { mesh: m, created };
}

// ------------------------------------------------------------------ inset

/** Insets each selected face by `amount` metres (in its own plane): a smaller copy of the face plus a ring of new faces. */
export function inset(m, faceIds, amount) {
  const created = [];
  let next = nextFaceId(m);
  for (const id of faceIds) {
    const f = findFace(m, id);
    if (!f) continue;
    const P = facePoints(m, f);
    const N = faceNormal(m, f);
    const n = P.length;
    const W = [];
    for (let i = 0; i < n; i++) {
      const prev = P[(i + n - 1) % n];
      const cur = P[i];
      const nxt = P[(i + 1) % n];
      const ip = norm(cross(N, sub(cur, prev)));
      const inx = norm(cross(N, sub(nxt, cur)));
      const k = 1 + dot(ip, inx);
      if (k < 0.05) throw new Error('面的轉角太尖，無法內插');
      W.push(add(cur, mul(add(ip, inx), amount / k)));
    }
    // the inner polygon must keep the orientation of every edge
    for (let i = 0; i < n; i++) {
      const e0 = sub(P[(i + 1) % n], P[i]);
      const e1 = sub(W[(i + 1) % n], W[i]);
      if (dot(e0, e1) <= 1e-9) throw new Error('內插距離太大（超過面的一半寬度）');
    }
    const base = m.vertices.length;
    for (const w of W) m.vertices.push(w);
    const outer = f.v.slice();
    f.v = W.map((_, i) => base + i);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const nid = next++;
      m.faces.push({ id: nid, v: [outer[i], outer[j], base + j, base + i], tag: (f.tag || 'face') + '_rim' });
      created.push({ id: nid, parent: f.id });
    }
  }
  return { mesh: m, created };
}

// ------------------------------------------------------------------ split (knife)

/** Inserts vertex `nv` between a and b in every face that walks the edge b->a (the twin of a->b). */
function insertInTwin(m, a, b, nv, skipFace) {
  for (const g of m.faces) {
    if (g === skipFace) continue;
    for (let k = 0; k < g.v.length; k++) {
      if (g.v[k] === b && g.v[(k + 1) % g.v.length] === a) {
        g.v.splice(k + 1, 0, nv);
        return;
      }
    }
  }
}

/**
 * Cuts face `id` with the plane through `p0` with normal `pn` (the plane must cross the face).
 * The piece on the negative side keeps the id; returns the new piece's id, or null if the plane
 * does not split the face into two.
 */
export function splitFaceByPlane(m, id, p0, pn) {
  const f = findFace(m, id);
  if (!f) return null;
  const tol = 1e-7;
  const s = f.v.map((i) => dot(sub(m.vertices[i], p0), pn));
  const list = [];
  const cuts = [];
  for (let k = 0; k < f.v.length; k++) {
    const a = f.v[k];
    const b = f.v[(k + 1) % f.v.length];
    const sa = s[k];
    const sb = s[(k + 1) % f.v.length];
    list.push(a);
    if (Math.abs(sa) <= tol) cuts.push(list.length - 1);
    if ((sa > tol && sb < -tol) || (sa < -tol && sb > tol)) {
      const t = sa / (sa - sb);
      const nv = m.vertices.length;
      m.vertices.push(add(m.vertices[a], mul(sub(m.vertices[b], m.vertices[a]), t)));
      insertInTwin(m, a, b, nv, f);
      list.push(nv);
      cuts.push(list.length - 1);
    }
  }
  if (cuts.length !== 2) return null;
  const [k1, k2] = cuts;
  if (k2 - k1 < 2 && !(k1 === 0 && k2 === list.length - 1)) return null;
  if (k1 === 0 && k2 === list.length - 1) return null; // cut along an existing edge
  const A = list.slice(k1, k2 + 1);
  const B = list.slice(k2).concat(list.slice(0, k1 + 1));
  if (A.length < 3 || B.length < 3) return null;
  // the piece on the negative side keeps the original id
  const side = (poly) => {
    let acc = 0;
    for (const i of poly) acc += dot(sub(m.vertices[i], p0), pn);
    return acc;
  };
  const [keep, other] = side(A) <= side(B) ? [A, B] : [B, A];
  f.v = keep;
  const nid = nextFaceId(m);
  m.faces.push({ id: nid, v: other, tag: f.tag });
  return nid;
}

/**
 * Armour split tool: cuts a face into pieces across its horizontal ('u') or vertical ('v')
 * extent at the given fractions (0..1). Returns the ids of all pieces, ordered along the axis.
 */
export function splitFace(m, id, axis, fractions) {
  const f = findFace(m, id);
  if (!f) throw new Error('找不到這個面');
  const n = faceNormal(m, f);
  const fr = faceFrame(n);
  const dir = axis === 'v' ? fr.v : fr.u;
  const pts = facePoints(m, f);
  const proj = pts.map((p) => dot(p, dir));
  const lo = Math.min(...proj);
  const hi = Math.max(...proj);
  const pieces = [id];
  const created = [];
  for (const t of fractions.slice().sort((a, b) => a - b)) {
    if (t <= 0.001 || t >= 0.999) continue;
    const at = lo + (hi - lo) * t;
    const p0 = mul(dir, at);
    // the piece that straddles this cut
    for (const pid of pieces) {
      const pf = findFace(m, pid);
      const pr = pf.v.map((i) => dot(m.vertices[i], dir));
      if (Math.min(...pr) < at - 1e-6 && Math.max(...pr) > at + 1e-6) {
        const nid = splitFaceByPlane(m, pid, p0, dir);
        if (nid != null) {
          pieces.push(nid);
          created.push({ id: nid, parent: id });
        }
        break;
      }
    }
  }
  const mid = (pid) => {
    const pf = findFace(m, pid);
    return dot(faceCentroid(m, pf), dir);
  };
  pieces.sort((a, b) => mid(a) - mid(b));
  return { mesh: m, created, pieces };
}

// ------------------------------------------------------------------ bevel

/** Fills every hole (loop of edges without a twin) with one new face. */
function fillHoles(m, tag, parent) {
  const created = [];
  for (let guard = 0; guard < 16; guard++) {
    const { open } = checkClosed(m);
    if (!open.length) break;
    // open edge x->y needs a face with y->x; walk the hole: next(x) = z where z->x is open
    const into = new Map();
    for (const [a, b] of open) into.set(b, a);
    const [x0, y0] = open[0];
    const loop = [y0, x0];
    let cur = x0;
    for (let k = 0; k < 1000; k++) {
      const z = into.get(cur);
      if (z == null || z === y0) break;
      loop.push(z);
      cur = z;
    }
    if (loop.length < 3) break;
    const id = nextFaceId(m);
    m.faces.push({ id, v: loop, tag });
    created.push({ id, parent });
  }
  return created;
}

/**
 * Bevels (chamfers) an edge: the two faces meeting at it are cut back by `width` and the gap is
 * closed with a new face. Works on any vertex valence; corner faces get the new vertices.
 */
export function bevelEdge(m, a, b, width) {
  const em = edgeMap(m);
  let f1i = em.get(ekey(a, b));
  let f2i = em.get(ekey(b, a));
  if (f1i == null || f2i == null) throw new Error('這條邊不存在');
  const f1 = m.faces[f1i];
  const f2 = m.faces[f2i];
  const pa = m.vertices[a];
  const pb = m.vertices[b];
  const n1 = faceNormal(m, f1);
  const n2 = faceNormal(m, f2);
  if (dot(n1, n2) > 0.999) throw new Error('兩個面在同一平面，不需要倒角');
  // inward directions of the two faces, perpendicular to the edge
  const in1 = norm(cross(n1, sub(pb, pa)));
  const in2 = norm(cross(n2, sub(pa, pb)));
  const s1 = splitFaceByPlane(m, f1.id, add(pa, mul(in1, width)), mul(in1, -1));
  const s2 = splitFaceByPlane(m, f2.id, add(pa, mul(in2, width)), mul(in2, -1));
  if (s1 == null || s2 == null) throw new Error('倒角寬度超過相鄰面的寬度');
  // the strips are the pieces that still contain both a and b
  const strip = (id1, id2) => [findFace(m, id1), findFace(m, id2)].find((f) => f && f.v.includes(a) && f.v.includes(b));
  const st1 = strip(f1.id, s1);
  const st2 = strip(f2.id, s2);
  if (!st1 || !st2) throw new Error('倒角失敗');
  const parent = f1.id === st1.id ? f1.id : f1.id;
  m.faces = m.faces.filter((f) => f !== st1 && f !== st2);
  for (const f of m.faces) f.v = f.v.filter((i) => i !== a && i !== b);
  m.faces = m.faces.filter((f) => f.v.length >= 3);
  const created = fillHoles(m, 'bevel', parent);
  // the strip faces lost their ids; if one of them was the original face, the remaining piece
  // took over the id already (splitFaceByPlane keeps the id on the strip side), so give the
  // outer pieces their old ids back
  for (const [orig, piece] of [[f1.id, s1], [f2.id, s2]]) {
    if (!findFace(m, orig)) {
      const p = findFace(m, piece);
      if (p) p.id = orig;
    }
  }
  return { mesh: m, created };
}

// ------------------------------------------------------------------ mirror helpers

/** For each vertex, the index of its mirror image across x = 0 (or -1). */
export function mirrorMap(m, tol = 1e-4) {
  const used = [...usedVertices(m)];
  const out = new Array(m.vertices.length).fill(-1);
  for (const i of used) {
    const p = m.vertices[i];
    let best = -1;
    let bd = tol;
    for (const j of used) {
      const q = m.vertices[j];
      const d = Math.hypot(p[0] + q[0], p[1] - q[1], p[2] - q[2]);
      if (d < bd) {
        bd = d;
        best = j;
      }
    }
    out[i] = best;
  }
  return out;
}

/** Mirror face of each face id (by mirrored vertex set), or undefined. */
export function mirrorFaces(m) {
  const mm = mirrorMap(m);
  const byKey = new Map();
  for (const f of m.faces) byKey.set(f.v.slice().sort((x, y) => x - y).join(','), f.id);
  const out = new Map();
  for (const f of m.faces) {
    const mv = f.v.map((i) => mm[i]);
    if (mv.some((i) => i < 0)) continue;
    const id = byKey.get(mv.sort((x, y) => x - y).join(','));
    if (id != null) out.set(f.id, id);
  }
  return out;
}

/** Ray against the mesh: nearest hit {t, face (id), point, normal} or null. */
export function raycast(m, o, d) {
  let best = null;
  for (const f of m.faces) {
    const pts = facePoints(m, f);
    for (const [ia, ib, ic] of faceTriangles(m, f)) {
      const a = pts[ia];
      const b = pts[ib];
      const c = pts[ic];
      const e1 = sub(b, a);
      const e2 = sub(c, a);
      const p = cross(d, e2);
      const det = dot(e1, p);
      if (Math.abs(det) < 1e-14) continue;
      const inv = 1 / det;
      const s = sub(o, a);
      const u = dot(s, p) * inv;
      if (u < -1e-9 || u > 1 + 1e-9) continue;
      const q = cross(s, e1);
      const v = dot(d, q) * inv;
      if (v < -1e-9 || u + v > 1 + 1e-9) continue;
      const t = dot(e2, q) * inv;
      if (t > 1e-6 && (!best || t < best.t)) best = { t, face: f.id, point: add(o, mul(d, t)), normal: norm(cross(e1, e2)) };
    }
  }
  return best;
}

/** Height of the mesh's top surface above (x, z), or null. */
export function topAt(m, x, z) {
  const h = raycast(m, [x, 100, z], [0, -1, 0]);
  return h ? h.point[1] : null;
}
