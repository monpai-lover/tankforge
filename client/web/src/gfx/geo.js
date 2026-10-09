// Geometry builder: turns the primitives used by visual.json (prism / plan / box / cyl)
// into one interleaved vertex buffer per mesh.
// Vertex layout (13 floats): position 3, normal 3, colour 3 (linear), roughness+metalness 2, uv 2.
import { transformPoint, transformDir, norm, cross, sub, m4, mul, compose, rotX, rotZ, scaling } from './math.js';

export const STRIDE = 13;

export function hexToLinear(hex) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.pow(v / 255, 2.2);
  return [f((n >> 16) & 255), f((n >> 8) & 255), f(n & 255)];
}

/** Ear-clipping triangulation of a simple polygon given as [[a,b],...]. Returns index triples. */
export function triangulate(pts) {
  const n = pts.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    area += p[0] * q[1] - q[0] * p[1];
  }
  const idx = [];
  for (let i = 0; i < n; i++) idx.push(area > 0 ? i : n - 1 - i);
  const out = [];
  const crossZ = (a, b, c) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  const inside = (a, b, c, p) => crossZ(a, b, p) >= 0 && crossZ(b, c, p) >= 0 && crossZ(c, a, p) >= 0;
  let guard = 0;
  while (idx.length > 3 && guard++ < 10000) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const a = pts[ia];
      const b = pts[ib];
      const c = pts[ic];
      if (crossZ(a, b, c) <= 1e-12) continue;
      let ear = true;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (inside(a, b, c, pts[j])) {
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
    if (!clipped) idx.splice(0, 1); // degenerate input: drop a vertex rather than loop forever
  }
  if (idx.length === 3) out.push([idx[0], idx[1], idx[2]]);
  return out;
}

export class GeoBuilder {
  constructor() {
    this.data = [];
    this.min = [Infinity, Infinity, Infinity];
    this.max = [-Infinity, -Infinity, -Infinity];
  }

  get vertexCount() {
    return this.data.length / STRIDE;
  }

  _vertex(p, n, mat) {
    const ax = Math.abs(n[0]);
    const ay = Math.abs(n[1]);
    const az = Math.abs(n[2]);
    let u;
    let v;
    if (ay >= ax && ay >= az) {
      u = p[0];
      v = p[2];
    } else if (ax >= az) {
      u = p[2];
      v = p[1];
    } else {
      u = p[0];
      v = p[1];
    }
    this.data.push(p[0], p[1], p[2], n[0], n[1], n[2], mat.color[0], mat.color[1], mat.color[2], mat.rough, mat.metal, u, v);
    for (let i = 0; i < 3; i++) {
      if (p[i] < this.min[i]) this.min[i] = p[i];
      if (p[i] > this.max[i]) this.max[i] = p[i];
    }
  }

  /** Triangle in local space; `normals` optional (flat shading when omitted). `uvs` optional explicit UVs. */
  tri(m, flip, a, b, c, mat, normals, uvs) {
    let pa = transformPoint(m, a);
    let pb = transformPoint(m, b);
    let pc = transformPoint(m, c);
    let na;
    let nb;
    let nc;
    if (normals) {
      na = norm(transformDir(m, normals[0]));
      nb = norm(transformDir(m, normals[1]));
      nc = norm(transformDir(m, normals[2]));
    }
    if (flip) {
      [pb, pc] = [pc, pb];
      if (normals) [nb, nc] = [nc, nb];
      if (uvs) uvs = [uvs[0], uvs[2], uvs[1]];
    }
    if (!normals) {
      const fn = norm(cross(sub(pb, pa), sub(pc, pa)));
      na = nb = nc = fn;
    }
    const start = this.data.length;
    this._vertex(pa, na, mat);
    this._vertex(pb, nb, mat);
    this._vertex(pc, nc, mat);
    if (uvs) {
      for (let i = 0; i < 3; i++) {
        this.data[start + i * STRIDE + 11] = uvs[i][0];
        this.data[start + i * STRIDE + 12] = uvs[i][1];
      }
    }
  }

  quad(m, flip, a, b, c, d, mat, normals, uvs) {
    this.tri(m, flip, a, b, c, mat, normals && [normals[0], normals[1], normals[2]], uvs && [uvs[0], uvs[1], uvs[2]]);
    this.tri(m, flip, a, c, d, mat, normals && [normals[0], normals[2], normals[3]], uvs && [uvs[0], uvs[2], uvs[3]]);
  }

  box(m, flip, size, mat) {
    const [hx, hy, hz] = [size[0] / 2, size[1] / 2, size[2] / 2];
    const c = (x, y, z) => [x * hx, y * hy, z * hz];
    this.quad(m, flip, c(-1, -1, 1), c(1, -1, 1), c(1, 1, 1), c(-1, 1, 1), mat); // +z
    this.quad(m, flip, c(1, -1, -1), c(-1, -1, -1), c(-1, 1, -1), c(1, 1, -1), mat); // -z
    this.quad(m, flip, c(1, -1, 1), c(1, -1, -1), c(1, 1, -1), c(1, 1, 1), mat); // +x
    this.quad(m, flip, c(-1, -1, -1), c(-1, -1, 1), c(-1, 1, 1), c(-1, 1, -1), mat); // -x
    this.quad(m, flip, c(-1, 1, 1), c(1, 1, 1), c(1, 1, -1), c(-1, 1, -1), mat); // +y
    this.quad(m, flip, c(-1, -1, -1), c(1, -1, -1), c(1, -1, 1), c(-1, -1, 1), mat); // -y
  }

  /**
   * Cylinder / cone frustum along local +Y from -len/2 (radius r) to +len/2 (radius r2), smooth sides, flat caps.
   * Callers orient it with the matrix.
   */
  cylY(m, flip, r, r2, len, segs, mat, capMat, hole = 0, holeMat = null) {
    const h = len / 2;
    const slope = (r - r2) / len;
    capMat = capMat || mat;
    if (hole > 0 && hole < Math.min(r, r2) - 0.002) {
      // a tube: ring-shaped ends and a dark bore inside (a gun barrel open at the muzzle)
      const hm = holeMat || capMat;
      for (let i = 0; i < segs; i++) {
        const a0 = (i / segs) * Math.PI * 2;
        const a1 = ((i + 1) / segs) * Math.PI * 2;
        const [c0, s0, c1, s1] = [Math.cos(a0), Math.sin(a0), Math.cos(a1), Math.sin(a1)];
        const o = (rr, y, c, sn) => [rr * sn, y, rr * c];
        const n0 = [s0, slope, c0];
        const n1 = [s1, slope, c1];
        this.quad(m, flip, o(r, -h, c0, s0), o(r, -h, c1, s1), o(r2, h, c1, s1), o(r2, h, c0, s0), mat, [n0, n1, n1, n0]);
        // the ends: rings from the bore to the outside
        this.quad(m, flip, o(hole, h, c0, s0), o(r2, h, c0, s0), o(r2, h, c1, s1), o(hole, h, c1, s1), capMat);
        this.quad(m, flip, o(hole, -h, c1, s1), o(r, -h, c1, s1), o(r, -h, c0, s0), o(hole, -h, c0, s0), capMat);
        // the bore, facing inwards
        this.quad(m, flip, o(hole, h, c0, s0), o(hole, h, c1, s1), o(hole, -h, c1, s1), o(hole, -h, c0, s0), hm, [
          [-s0, 0, -c0],
          [-s1, 0, -c1],
          [-s1, 0, -c1],
          [-s0, 0, -c0],
        ]);
      }
      return;
    }
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2;
      const a1 = ((i + 1) / segs) * Math.PI * 2;
      const c0 = Math.cos(a0);
      const s0 = Math.sin(a0);
      const c1 = Math.cos(a1);
      const s1 = Math.sin(a1);
      const b0 = [r * s0, -h, r * c0];
      const b1 = [r * s1, -h, r * c1];
      const t0 = [r2 * s0, h, r2 * c0];
      const t1 = [r2 * s1, h, r2 * c1];
      const n0 = [s0, slope, c0];
      const n1 = [s1, slope, c1];
      this.quad(m, flip, b0, b1, t1, t0, mat, [n0, n1, n1, n0]);
      if (r2 > 1e-4) this.tri(m, flip, [0, h, 0], t0, t1, capMat);
      if (r > 1e-4) this.tri(m, flip, [0, -h, 0], b1, b0, capMat);
    }
  }

  /** Cylinder with its axis along 'x' | 'y' | 'z'; r at the negative end, r2 at the positive end. */
  cyl(m, flip, axis, r, r2, len, segs, mat, capMat, hole = 0, holeMat = null) {
    let mm = m;
    if (axis === 'x') mm = mul(m, rotZ(-Math.PI / 2));
    else if (axis === 'z') mm = mul(m, rotX(Math.PI / 2));
    this.cylY(mm, flip, r, r2, len, segs, mat, capMat, hole, holeMat);
  }

  /**
   * Side profile [[z,y],...] extruded across X. Width w at the lowest profile point, wt at the highest
   * (linear in between), centred on x0.
   */
  prism(m, flip, profile, w, wt, x0, mat) {
    let ymin = Infinity;
    let ymax = -Infinity;
    for (const p of profile) {
      ymin = Math.min(ymin, p[1]);
      ymax = Math.max(ymax, p[1]);
    }
    const half = (y) => {
      const k = ymax > ymin ? (y - ymin) / (ymax - ymin) : 0;
      return (w + (wt - w) * k) / 2;
    };
    // triangulate in (z, y); make the polygon counter-clockwise in that plane
    const tris = triangulate(profile);
    let area = 0;
    for (let i = 0; i < profile.length; i++) {
      const p = profile[i];
      const q = profile[(i + 1) % profile.length];
      area += p[0] * q[1] - q[0] * p[1];
    }
    const ccw = area > 0;
    const R = (i) => [x0 + half(profile[i][1]), profile[i][1], profile[i][0]];
    const L = (i) => [x0 - half(profile[i][1]), profile[i][1], profile[i][0]];
    for (const [a, b, c] of tris) {
      // triangulate() returns triangles that are CCW in (z,y); seen from +X that is clockwise, so reverse
      this.tri(m, flip, R(a), R(c), R(b), mat);
      this.tri(m, flip, L(a), L(b), L(c), mat);
    }
    const n = profile.length;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      if (ccw) this.quad(m, flip, L(i), R(i), R(j), L(j), mat);
      else this.quad(m, flip, R(i), L(i), L(j), R(j), mat);
    }
  }

  /**
   * Top-view outline [[x,z],...] extruded from y0 to y1. The top ring is scaled about `origin`
   * and shifted, which gives sloped (cast) turret walls. smooth = rounded walls.
   */
  plan(m, flip, outline, y0, y1, scaleTop, shiftTop, origin, smooth, mat, hollow = 0) {
    const n = outline.length;
    let cx = 0;
    let cz = 0;
    if (origin) {
      cx = origin[0];
      cz = origin[1];
    } else {
      let minx = Infinity;
      let maxx = -Infinity;
      let minz = Infinity;
      let maxz = -Infinity;
      for (const p of outline) {
        minx = Math.min(minx, p[0]);
        maxx = Math.max(maxx, p[0]);
        minz = Math.min(minz, p[1]);
        maxz = Math.max(maxz, p[1]);
      }
      cx = (minx + maxx) / 2;
      cz = (minz + maxz) / 2;
    }
    const B = (i) => [outline[i][0], y0, outline[i][1]];
    const T = (i) => [cx + (outline[i][0] - cx) * scaleTop[0] + shiftTop[0], y1, cz + (outline[i][1] - cz) * scaleTop[1] + shiftTop[1]];
    let area = 0;
    for (let i = 0; i < n; i++) {
      const p = outline[i];
      const q = outline[(i + 1) % n];
      area += p[0] * q[1] - q[0] * p[1];
    }
    // In (x, z) with +Y up, a polygon that is counter-clockwise in the (x,z) plane is clockwise seen from above.
    const ccw = area > 0;
    const tris = triangulate(outline);
    for (const [a, b, c] of tris) {
      if (!hollow) this.tri(m, flip, T(a), T(c), T(b), mat); // top faces +Y
      this.tri(m, flip, B(a), B(b), B(c), mat); // bottom faces -Y
    }
    if (hollow) {
      // open top: the wall gets an inside face, a rim on top and a floor
      const inner = [];
      for (let i = 0; i < n; i++) {
        const p = outline[i];
        const a = outline[(i + n - 1) % n];
        const b = outline[(i + 1) % n];
        const e0 = norm([p[0] - a[0], 0, p[1] - a[1]]);
        const e1 = norm([b[0] - p[0], 0, b[1] - p[1]]);
        // outward normals of the two edges that meet here (in the x,z plane)
        const s = ccw ? 1 : -1;
        const n0 = [s * e0[2], -s * e0[0]];
        const n1 = [s * e1[2], -s * e1[0]];
        let mx = n0[0] + n1[0];
        let mz = n0[1] + n1[1];
        const ml = Math.hypot(mx, mz) || 1;
        mx /= ml;
        mz /= ml;
        const k = hollow / Math.max(0.35, mx * n0[0] + mz * n0[1]);
        inner.push([p[0] - mx * k, p[1] - mz * k]);
      }
      const floorY = y0 + Math.min(0.03, (y1 - y0) * 0.2);
      const IB = (i) => [inner[i][0], floorY, inner[i][1]];
      const IT = (i) => [cx + (inner[i][0] - cx) * scaleTop[0] + shiftTop[0], y1, cz + (inner[i][1] - cz) * scaleTop[1] + shiftTop[1]];
      for (const [a, b, c] of triangulate(inner)) this.tri(m, flip, IB(a), IB(c), IB(b), mat); // floor faces +Y
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (ccw) {
          this.quad(m, flip, IB(i), IB(j), IT(j), IT(i), mat);
          this.quad(m, flip, T(i), T(j), IT(j), IT(i), mat);
        } else {
          this.quad(m, flip, IB(j), IB(i), IT(i), IT(j), mat);
          this.quad(m, flip, T(j), T(i), IT(i), IT(j), mat);
        }
      }
    }
    // outward wall normals (for smooth shading), averaged per vertex
    const faceN = [];
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      let e = sub(B(j), B(i));
      let up = sub(T(i), B(i));
      let fn = norm(cross(e, up));
      if (!ccw) fn = [-fn[0], -fn[1], -fn[2]];
      faceN.push(fn);
    }
    const vertN = (i) => norm([faceN[i][0] + faceN[(i + n - 1) % n][0], faceN[i][1] + faceN[(i + n - 1) % n][1], faceN[i][2] + faceN[(i + n - 1) % n][2]]);
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const normals = smooth ? (ccw ? [vertN(j), vertN(i), vertN(i), vertN(j)] : [vertN(i), vertN(j), vertN(j), vertN(i)]) : undefined;
      if (ccw) this.quad(m, flip, B(j), B(i), T(i), T(j), mat, normals);
      else this.quad(m, flip, B(i), B(j), T(j), T(i), mat, normals);
    }
  }

  /**
   * Lofted surface through stacked rings (cast turrets, rounded hulls, rockets): `rings` is a list
   * of closed rings, each [[x,y,z]...] with the same point count, ordered bottom to top (or tail
   * to nose); ring k point i joins ring k+1 point i. Each ring winds clockwise seen from the end
   * the next ring lies toward (tools/gen_vehicles.py loft() orients them). Normals are averaged over the faces round a vertex that bend
   * less than `creaseDeg` from the face being drawn: smooth castings, sharp welded edges. caps:
   * [first, last] closes the end rings with flat faces.
   */
  loft(m, flip, rings, mat, creaseDeg = 35, caps = [true, true]) {
    const R = rings.length;
    const n = rings[0].length;
    if (R < 2 || n < 3) return;
    const P = (k, i) => rings[k][((i % n) + n) % n];
    // outward face normal of the quad (k,i)-(k+1,i+1)
    const fn = [];
    for (let k = 0; k < R - 1; k++) {
      fn.push([]);
      for (let i = 0; i < n; i++) {
        const a = P(k, i);
        const b = P(k, i + 1);
        const c = P(k + 1, i + 1);
        const d = P(k + 1, i);
        // the same winding as tri(a, b, c): (b - a) x (c - a)
        let f = cross(sub(c, a), sub(d, b));
        const l = Math.hypot(f[0], f[1], f[2]);
        fn[k].push(l > 1e-12 ? [f[0] / l, f[1] / l, f[2] / l] : null);
      }
    }
    const cosC = Math.cos((creaseDeg * Math.PI) / 180);
    // the normal at ring k point i as seen from face (fk, fi)
    const vn = (k, i, fk, fi) => {
      const own = fn[fk][fi];
      if (!own) return [0, 1, 0];
      const acc = [0, 0, 0];
      for (const kk of [k - 1, k]) {
        if (kk < 0 || kk >= R - 1) continue;
        for (const ii of [i - 1, i]) {
          const f = fn[kk][((ii % n) + n) % n];
          if (f && f[0] * own[0] + f[1] * own[1] + f[2] * own[2] >= cosC) {
            acc[0] += f[0];
            acc[1] += f[1];
            acc[2] += f[2];
          }
        }
      }
      return norm(acc);
    };
    for (let k = 0; k < R - 1; k++) {
      for (let i = 0; i < n; i++) {
        if (!fn[k][i]) continue;
        const j = (i + 1) % n;
        const ns = [vn(k, i, k, i), vn(k, j, k, i), vn(k + 1, j, k, i), vn(k + 1, i, k, i)];
        this.quad(m, flip, P(k, i), P(k, j), P(k + 1, j), P(k + 1, i), mat, ns);
      }
    }
    // end caps, triangulated in the ring's own plane
    const cap = (ring, reverse) => {
      const c = [0, 0, 0];
      for (const p of ring) {
        c[0] += p[0] / n;
        c[1] += p[1] / n;
        c[2] += p[2] / n;
      }
      for (let i = 0; i < n; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % n];
        if (reverse) this.tri(m, flip, c, a, b, mat);
        else this.tri(m, flip, c, b, a, mat);
      }
    };
    if (caps[0]) cap(rings[0], false);
    if (caps[1]) cap(rings[R - 1], true);
  }

  /**
   * Free polygon mesh (designer hulls and turrets): vertices [[x,y,z]...], faces [[i...]...] each
   * counter-clockwise from outside. Every face is triangulated in its own plane, flat shaded.
   */
  polyMesh(m, flip, vertices, faces, mat) {
    for (const f of faces) {
      if (f.length < 3) continue;
      const pts = f.map((i) => vertices[i]);
      const n = [0, 0, 0];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        n[0] += (a[1] - b[1]) * (a[2] + b[2]);
        n[1] += (a[2] - b[2]) * (a[0] + b[0]);
        n[2] += (a[0] - b[0]) * (a[1] + b[1]);
      }
      const nn = norm(n);
      let u = cross([0, 1, 0], nn);
      if (Math.hypot(u[0], u[1], u[2]) < 1e-6) u = [1, 0, 0];
      u = norm(u);
      const v = cross(nn, u);
      const p2 = pts.map((p) => [p[0] * u[0] + p[1] * u[1] + p[2] * u[2], p[0] * v[0] + p[1] * v[1] + p[2] * v[2]]);
      for (const [a, b, c] of triangulate(p2)) this.tri(m, flip, pts[a], pts[b], pts[c], mat);
    }
  }

  build() {
    return new Float32Array(this.data);
  }
}

/** Matrix for a part: translation + XYZ Euler rotation in degrees, optionally mirrored across X. */
export function partMatrix(pos, rotDeg, mirrored) {
  const r = rotDeg ? [(rotDeg[0] * Math.PI) / 180, (rotDeg[1] * Math.PI) / 180, (rotDeg[2] * Math.PI) / 180] : null;
  const m = compose(pos, r);
  return mirrored ? mul(scaling(-1, 1, 1), m) : m;
}

export const IDENTITY = m4();
