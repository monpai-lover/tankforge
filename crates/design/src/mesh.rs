//! Polygon-mesh geometry for player designs: triangulation, closedness, orientation,
//! self-intersection, volume, ray casting, inside tests and closest points.
use crate::model::MeshDef;
use crate::v3::{v3, Aabb, V3};
use std::collections::HashMap;

/// One face, prepared for geometry queries.
#[derive(Clone, Debug)]
pub struct GFace {
    pub id: u32,
    pub tag: String,
    /// Vertex indices into `Geo::verts`.
    pub idx: Vec<usize>,
    /// Outward unit normal (Newell; for a folded face the average).
    pub normal: V3,
    pub centroid: V3,
    pub area: f64,
    /// Triangles as indices into `idx` (local corners), so per-corner data maps directly.
    pub tris: Vec<[usize; 3]>,
    /// Horizontal in-plane axis and the axis "up the face".
    pub u: V3,
    pub v: V3,
    /// Largest distance of a corner from the face's best-fit plane, m.
    pub planarity: f64,
    pub bounds: Aabb,
}

impl GFace {
    pub fn corner(&self, g: &Geo, k: usize) -> V3 {
        g.verts[self.idx[k]]
    }
    /// Corner positions in the face's (u, v) frame.
    pub fn corners_2d(&self, g: &Geo) -> Vec<(f64, f64)> {
        self.idx.iter().map(|&i| self.to_2d(g.verts[i])).collect()
    }
    pub fn to_2d(&self, p: V3) -> (f64, f64) {
        let d = p - self.centroid;
        (d.dot(self.u), d.dot(self.v))
    }
    pub fn tri_points(&self, g: &Geo, t: usize) -> [V3; 3] {
        let [a, b, c] = self.tris[t];
        [g.verts[self.idx[a]], g.verts[self.idx[b]], g.verts[self.idx[c]]]
    }
}

/// A mesh body ready for queries, in some space (hull, or turret placed at a yaw).
#[derive(Clone, Debug, Default)]
pub struct Geo {
    pub verts: Vec<V3>,
    pub faces: Vec<GFace>,
    pub bounds: Aabb,
    pub face_index: HashMap<u32, usize>,
}

impl Default for Aabb {
    fn default() -> Self {
        Aabb::EMPTY
    }
}

/// Horizontal axis in the plane with normal n, and the axis up the face.
pub fn face_frame(n: V3) -> (V3, V3) {
    let mut u = V3::Y.cross(n);
    if u.len() < 1e-6 {
        // roof or floor: u along +X
        u = V3::X - n * V3::X.dot(n);
    }
    let u = u.norm();
    (u, n.cross(u).norm())
}

pub fn newell(pts: &[V3]) -> V3 {
    let mut n = V3::ZERO;
    for i in 0..pts.len() {
        let a = pts[i];
        let b = pts[(i + 1) % pts.len()];
        n.x += (a.y - b.y) * (a.z + b.z);
        n.y += (a.z - b.z) * (a.x + b.x);
        n.z += (a.x - b.x) * (a.y + b.y);
    }
    n
}

fn cross2(a: (f64, f64), b: (f64, f64), c: (f64, f64)) -> f64 {
    (b.0 - a.0) * (c.1 - a.1) - (b.1 - a.1) * (c.0 - a.0)
}

/// Ear clipping of a 2D polygon (any winding); returns index triples in counter-clockwise order.
pub fn triangulate_2d(p: &[(f64, f64)]) -> Vec<[usize; 3]> {
    let n = p.len();
    if n < 3 {
        return vec![];
    }
    let mut area = 0.0;
    for i in 0..n {
        let (a, b) = (p[i], p[(i + 1) % n]);
        area += a.0 * b.1 - b.0 * a.1;
    }
    let mut idx: Vec<usize> = if area >= 0.0 { (0..n).collect() } else { (0..n).rev().collect() };
    let mut out = Vec::with_capacity(n - 2);
    let mut guard = 0;
    while idx.len() > 3 && guard < 10_000 {
        guard += 1;
        let m = idx.len();
        let mut clipped = false;
        for i in 0..m {
            let (ia, ib, ic) = (idx[(i + m - 1) % m], idx[i], idx[(i + 1) % m]);
            let (a, b, c) = (p[ia], p[ib], p[ic]);
            if cross2(a, b, c) <= 1e-14 {
                continue;
            }
            let ear = idx.iter().all(|&j| {
                j == ia || j == ib || j == ic || !(cross2(a, b, p[j]) >= 0.0 && cross2(b, c, p[j]) >= 0.0 && cross2(c, a, p[j]) >= 0.0)
            });
            if ear {
                out.push([ia, ib, ic]);
                idx.remove(i);
                clipped = true;
                break;
            }
        }
        if !clipped {
            // degenerate (collinear run): fan the rest rather than loop forever
            let m = idx.len();
            for k in 1..m - 1 {
                out.push([idx[0], idx[k], idx[k + 1]]);
            }
            return out;
        }
    }
    if idx.len() == 3 {
        out.push([idx[0], idx[1], idx[2]]);
    }
    out
}

impl Geo {
    /// `xf` maps the mesh's own space to the query space (identity for the hull).
    pub fn build(m: &MeshDef, xf: impl Fn(V3) -> V3) -> Geo {
        let verts: Vec<V3> = m.vertices.iter().map(|&p| xf(p)).collect();
        let mut faces = Vec::with_capacity(m.faces.len());
        let mut bounds = Aabb::EMPTY;
        let mut face_index = HashMap::new();
        for f in &m.faces {
            let idx: Vec<usize> = f.v.iter().map(|&i| i as usize).filter(|&i| i < verts.len()).collect();
            if idx.len() < 3 || idx.len() != f.v.len() {
                continue; // reported by validation; geometry queries skip broken faces
            }
            let pts: Vec<V3> = idx.iter().map(|&i| verts[i]).collect();
            let nw = newell(&pts);
            let normal = nw.norm();
            let mut centroid = V3::ZERO;
            for p in &pts {
                centroid += *p;
            }
            centroid = centroid / pts.len() as f64;
            let (u, v) = face_frame(if normal.len() > 0.5 { normal } else { V3::Y });
            let p2: Vec<(f64, f64)> = pts.iter().map(|p| ((*p - centroid).dot(u), (*p - centroid).dot(v))).collect();
            let tris = triangulate_2d(&p2);
            let mut area = 0.0;
            for t in &tris {
                area += (pts[t[1]] - pts[t[0]]).cross(pts[t[2]] - pts[t[0]]).len() * 0.5;
            }
            let planarity = pts.iter().map(|p| (*p - centroid).dot(normal).abs()).fold(0.0, f64::max);
            let mut fb = Aabb::EMPTY;
            for p in &pts {
                fb.add(*p);
                bounds.add(*p);
            }
            face_index.insert(f.id, faces.len());
            faces.push(GFace { id: f.id, tag: f.tag.clone(), idx, normal, centroid, area, tris, u, v, planarity, bounds: fb });
        }
        Geo { verts, faces, bounds, face_index }
    }

    pub fn face(&self, id: u32) -> Option<&GFace> {
        self.face_index.get(&id).map(|&i| &self.faces[i])
    }

    pub fn triangles(&self) -> impl Iterator<Item = (usize, [V3; 3])> + '_ {
        self.faces.iter().enumerate().flat_map(move |(fi, f)| (0..f.tris.len()).map(move |t| (fi, f.tri_points(self, t))))
    }

    /// Signed volume (positive for an outward-facing closed mesh) and its centroid.
    pub fn volume(&self) -> (f64, V3) {
        let mut vol = 0.0;
        let mut c = V3::ZERO;
        for (_, [a, b, d]) in self.triangles() {
            let v6 = a.dot(b.cross(d));
            vol += v6;
            c += (a + b + d) * v6;
        }
        let v = vol / 6.0;
        let centroid = if vol.abs() > 1e-12 { c / (4.0 * vol) } else { self.bounds.center() };
        (v, centroid)
    }

    pub fn surface_area(&self) -> f64 {
        self.faces.iter().map(|f| f.area).sum()
    }

    /// Every hit of the infinite ray o + d t (t > 0), nearest first. `front` = the ray enters
    /// the body through this face.
    pub fn ray_hits(&self, o: V3, d: V3) -> Vec<RayHit> {
        let mut out = vec![];
        if self.bounds.is_empty() {
            return out;
        }
        let pad = Aabb { min: self.bounds.min - v3(1e-6, 1e-6, 1e-6), max: self.bounds.max + v3(1e-6, 1e-6, 1e-6) };
        if pad.ray(o, d).is_none() {
            return out;
        }
        for (fi, f) in self.faces.iter().enumerate() {
            if f.bounds.is_empty() || (Aabb { min: f.bounds.min - v3(1e-6, 1e-6, 1e-6), max: f.bounds.max + v3(1e-6, 1e-6, 1e-6) }).ray(o, d).is_none() {
                continue;
            }
            for t in 0..f.tris.len() {
                let [a, b, c] = f.tri_points(self, t);
                if let Some((tt, n)) = ray_tri(o, d, a, b, c) {
                    if tt > 1e-9 {
                        out.push(RayHit { t: tt, face: fi, point: o + d * tt, normal: n, front: n.dot(d) < 0.0 });
                    }
                }
            }
        }
        out.sort_by(|a, b| a.t.total_cmp(&b.t));
        // a ray through a shared edge hits both neighbouring triangles: keep one
        out.dedup_by(|b, a| (b.t - a.t).abs() < 1e-9 && b.front == a.front);
        out
    }

    /// Generalized winding number: ~1 inside, ~0 outside, robust for any closed mesh.
    pub fn winding(&self, p: V3) -> f64 {
        let mut w = 0.0;
        for (_, [a, b, c]) in self.triangles() {
            let (ra, rb, rc) = (a - p, b - p, c - p);
            let (la, lb, lc) = (ra.len(), rb.len(), rc.len());
            if la < 1e-12 || lb < 1e-12 || lc < 1e-12 {
                return 0.5;
            }
            let num = ra.dot(rb.cross(rc));
            let den = la * lb * lc + ra.dot(rb) * lc + rb.dot(rc) * la + rc.dot(ra) * lb;
            w += 2.0 * num.atan2(den);
        }
        w / (4.0 * std::f64::consts::PI)
    }

    pub fn contains(&self, p: V3) -> bool {
        if self.bounds.is_empty() || p.x < self.bounds.min.x || p.x > self.bounds.max.x || p.y < self.bounds.min.y || p.y > self.bounds.max.y || p.z < self.bounds.min.z || p.z > self.bounds.max.z {
            return false;
        }
        self.winding(p) > 0.5
    }

    /// Closest point on face `fi` to p and the distance.
    pub fn face_distance(&self, fi: usize, p: V3) -> (f64, V3) {
        let f = &self.faces[fi];
        let mut best = (f64::INFINITY, f.centroid);
        for t in 0..f.tris.len() {
            let [a, b, c] = f.tri_points(self, t);
            let q = closest_point_tri(p, a, b, c);
            let d = (q - p).len();
            if d < best.0 {
                best = (d, q);
            }
        }
        best
    }
}

#[derive(Clone, Copy, Debug)]
pub struct RayHit {
    pub t: f64,
    /// Index into Geo::faces.
    pub face: usize,
    pub point: V3,
    /// Geometric normal of the triangle hit (outward).
    pub normal: V3,
    pub front: bool,
}

/// Möller–Trumbore, double sided. Returns (t, outward triangle normal).
pub fn ray_tri(o: V3, d: V3, a: V3, b: V3, c: V3) -> Option<(f64, V3)> {
    let e1 = b - a;
    let e2 = c - a;
    let p = d.cross(e2);
    let det = e1.dot(p);
    if det.abs() < 1e-14 {
        return None;
    }
    let inv = 1.0 / det;
    let s = o - a;
    let u = s.dot(p) * inv;
    if !(-1e-9..=1.0 + 1e-9).contains(&u) {
        return None;
    }
    let q = s.cross(e1);
    let v = d.dot(q) * inv;
    if v < -1e-9 || u + v > 1.0 + 1e-9 {
        return None;
    }
    let t = e2.dot(q) * inv;
    Some((t, e1.cross(e2).norm()))
}

/// Segment p->q against triangle; returns the fraction along the segment.
pub fn segment_tri(p: V3, q: V3, a: V3, b: V3, c: V3) -> Option<f64> {
    let d = q - p;
    let len = d.len();
    if len < 1e-12 {
        return None;
    }
    let (t, _) = ray_tri(p, d / len, a, b, c)?;
    if t > 1e-9 && t < len - 1e-9 {
        Some(t / len)
    } else {
        None
    }
}

/// True if two triangles cross (an edge of one passes through the other). Touching along a
/// shared edge or vertex is not an intersection.
pub fn tri_tri(a: [V3; 3], b: [V3; 3]) -> bool {
    for i in 0..3 {
        if segment_tri(a[i], a[(i + 1) % 3], b[0], b[1], b[2]).is_some() {
            return true;
        }
        if segment_tri(b[i], b[(i + 1) % 3], a[0], a[1], a[2]).is_some() {
            return true;
        }
    }
    false
}

/// Ericson, Real-Time Collision Detection 5.1.5.
pub fn closest_point_tri(p: V3, a: V3, b: V3, c: V3) -> V3 {
    let ab = b - a;
    let ac = c - a;
    let ap = p - a;
    let d1 = ab.dot(ap);
    let d2 = ac.dot(ap);
    if d1 <= 0.0 && d2 <= 0.0 {
        return a;
    }
    let bp = p - b;
    let d3 = ab.dot(bp);
    let d4 = ac.dot(bp);
    if d3 >= 0.0 && d4 <= d3 {
        return b;
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        return a + ab * (d1 / (d1 - d3));
    }
    let cp = p - c;
    let d5 = ab.dot(cp);
    let d6 = ac.dot(cp);
    if d6 >= 0.0 && d5 <= d6 {
        return c;
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        return a + ac * (d2 / (d2 - d6));
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
        return b + (c - b) * ((d4 - d3) / ((d4 - d3) + (d5 - d6)));
    }
    let denom = 1.0 / (va + vb + vc);
    a + ab * (vb * denom) + ac * (vc * denom)
}

/// Mean value coordinates of p inside a planar polygon (2D). Weights sum to 1; exact at
/// corners and along edges.
pub fn mean_value_weights(poly: &[(f64, f64)], p: (f64, f64)) -> Vec<f64> {
    let n = poly.len();
    let mut w = vec![0.0; n];
    let s: Vec<(f64, f64)> = poly.iter().map(|q| (q.0 - p.0, q.1 - p.1)).collect();
    let r: Vec<f64> = s.iter().map(|q| (q.0 * q.0 + q.1 * q.1).sqrt()).collect();
    for i in 0..n {
        if r[i] < 1e-10 {
            w[i] = 1.0;
            return w;
        }
    }
    // on an edge: linear between its two corners
    for i in 0..n {
        let j = (i + 1) % n;
        let cr = s[i].0 * s[j].1 - s[i].1 * s[j].0;
        let dt = s[i].0 * s[j].0 + s[i].1 * s[j].1;
        if cr.abs() < 1e-10 * (r[i] * r[j]).max(1e-12) && dt < 0.0 {
            let k = r[i] / (r[i] + r[j]);
            w[i] = 1.0 - k;
            w[j] = k;
            return w;
        }
    }
    let mut tan_half = vec![0.0; n];
    for i in 0..n {
        let j = (i + 1) % n;
        let cr = s[i].0 * s[j].1 - s[i].1 * s[j].0;
        let dt = s[i].0 * s[j].0 + s[i].1 * s[j].1;
        // tan(alpha/2) = (r_i r_j - dot) / cross, signed for concave polygons
        tan_half[i] = (r[i] * r[j] - dt) / cr;
    }
    let mut sum = 0.0;
    for i in 0..n {
        let prev = (i + n - 1) % n;
        w[i] = (tan_half[prev] + tan_half[i]) / r[i];
        sum += w[i];
    }
    if sum.abs() < 1e-12 || !sum.is_finite() {
        let k = 1.0 / n as f64;
        return vec![k; n];
    }
    for x in &mut w {
        *x /= sum;
    }
    w
}

/// Mesh topology report: closed, consistently oriented 2-manifold?
#[derive(Clone, Debug, Default)]
pub struct Topology {
    /// Directed edges with no opposite (holes).
    pub open_edges: Vec<(usize, usize)>,
    /// Directed edges used by more than one face (non-manifold or flipped face).
    pub repeated_edges: Vec<(usize, usize)>,
    pub bad_faces: Vec<u32>,
    pub duplicate_ids: Vec<u32>,
}

impl Topology {
    pub fn closed(&self) -> bool {
        self.open_edges.is_empty() && self.repeated_edges.is_empty() && self.bad_faces.is_empty()
    }
}

pub fn topology(m: &MeshDef) -> Topology {
    let mut t = Topology::default();
    let mut count: HashMap<(usize, usize), u32> = HashMap::new();
    let mut ids = std::collections::HashSet::new();
    for f in &m.faces {
        if !ids.insert(f.id) {
            t.duplicate_ids.push(f.id);
        }
        let n = f.v.len();
        let mut seen = std::collections::HashSet::new();
        if n < 3 || f.v.iter().any(|&i| i as usize >= m.vertices.len() || !seen.insert(i)) {
            t.bad_faces.push(f.id);
            continue;
        }
        for k in 0..n {
            let e = (f.v[k] as usize, f.v[(k + 1) % n] as usize);
            *count.entry(e).or_default() += 1;
        }
    }
    let mut keys: Vec<_> = count.keys().copied().collect();
    keys.sort();
    for e in keys {
        let c = count[&e];
        if c > 1 {
            t.repeated_edges.push(e);
        }
        if !count.contains_key(&(e.1, e.0)) {
            t.open_edges.push(e);
        }
    }
    t
}

/// Pairs of faces (ids) whose triangles cross each other. Triangles sharing a vertex are
/// skipped (neighbours always touch).
pub fn self_intersections(g: &Geo, limit: usize) -> Vec<(u32, u32)> {
    struct T {
        f: usize,
        p: [V3; 3],
        vi: [usize; 3],
        b: Aabb,
    }
    let mut tris = vec![];
    for (fi, f) in g.faces.iter().enumerate() {
        for t in 0..f.tris.len() {
            let [a, b, c] = f.tris[t];
            let p = f.tri_points(g, t);
            let mut bb = Aabb::EMPTY;
            for q in p {
                bb.add(q);
            }
            tris.push(T { f: fi, p, vi: [f.idx[a], f.idx[b], f.idx[c]], b: bb });
        }
    }
    let mut out: Vec<(u32, u32)> = vec![];
    for i in 0..tris.len() {
        for j in i + 1..tris.len() {
            let (a, b) = (&tris[i], &tris[j]);
            if a.f == b.f {
                continue;
            }
            if a.vi.iter().any(|v| b.vi.contains(v)) {
                continue;
            }
            if !a.b.overlaps(&b.b, -1e-9) {
                continue;
            }
            if tri_tri(a.p, b.p) {
                let pair = (g.faces[a.f].id.min(g.faces[b.f].id), g.faces[a.f].id.max(g.faces[b.f].id));
                if !out.contains(&pair) {
                    out.push(pair);
                    if out.len() >= limit {
                        return out;
                    }
                }
            }
        }
    }
    out
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::model::FaceDef;

    /// Axis-aligned box mesh with outward faces, ids 0..5 (+z, -z, +x, -x, +y, -y).
    pub fn box_mesh(min: V3, max: V3) -> MeshDef {
        let c = |i: usize| v3(if i & 1 == 1 { max.x } else { min.x }, if i & 2 == 2 { max.y } else { min.y }, if i & 4 == 4 { max.z } else { min.z });
        let vertices: Vec<V3> = (0..8).map(c).collect();
        let f = |id: u32, v: [u32; 4], tag: &str| FaceDef { id, v: v.to_vec(), tag: tag.into() };
        MeshDef {
            vertices,
            faces: vec![
                f(0, [4, 5, 7, 6], "front"),
                f(1, [1, 0, 2, 3], "rear"),
                f(2, [5, 1, 3, 7], "side_r"),
                f(3, [0, 4, 6, 2], "side_l"),
                f(4, [6, 7, 3, 2], "roof"),
                f(5, [0, 1, 5, 4], "floor"),
            ],
        }
    }

    #[test]
    fn box_is_closed_with_right_volume_and_outward_normals() {
        let m = box_mesh(v3(-1.0, 0.0, -2.0), v3(1.0, 1.0, 2.0));
        assert!(topology(&m).closed(), "{:?}", topology(&m));
        let g = Geo::build(&m, |p| p);
        let (vol, c) = g.volume();
        assert!((vol - 8.0).abs() < 1e-9, "{}", vol);
        assert!((c - v3(0.0, 0.5, 0.0)).len() < 1e-9);
        assert!((g.face(0).unwrap().normal - V3::Z).len() < 1e-9);
        assert!((g.face(4).unwrap().normal - V3::Y).len() < 1e-9);
        assert!((g.surface_area() - (2.0 * 4.0 * 2.0 + 2.0 * 2.0 * 1.0 + 2.0 * 4.0 * 1.0)).abs() < 1e-9);
    }

    #[test]
    fn open_mesh_and_flipped_face_are_detected() {
        let mut m = box_mesh(v3(-1.0, 0.0, -1.0), v3(1.0, 1.0, 1.0));
        m.faces[0].v.reverse();
        let t = topology(&m);
        assert!(!t.closed() && !t.repeated_edges.is_empty());
        m.faces.remove(0);
        assert!(!topology(&m).open_edges.is_empty());
    }

    #[test]
    fn winding_number_inside_outside() {
        let g = Geo::build(&box_mesh(v3(-1.0, 0.0, -1.0), v3(1.0, 1.0, 1.0)), |p| p);
        assert!(g.contains(v3(0.2, 0.5, 0.3)));
        assert!(!g.contains(v3(1.2, 0.5, 0.3)));
        assert!((g.winding(v3(0.0, 0.5, 0.0)) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn ray_enters_and_leaves() {
        let g = Geo::build(&box_mesh(v3(-1.0, 0.0, -1.0), v3(1.0, 1.0, 1.0)), |p| p);
        let h = g.ray_hits(v3(0.0, 0.5, 10.0), v3(0.0, 0.0, -1.0));
        assert_eq!(h.len(), 2, "{:?}", h);
        assert!(h[0].front && !h[1].front);
        assert!((h[0].t - 9.0).abs() < 1e-9 && (h[1].t - 11.0).abs() < 1e-9);
        assert_eq!(g.faces[h[0].face].id, 0);
    }

    #[test]
    fn mean_value_weights_reproduce_linear_functions() {
        let quad = [(0.0, 0.0), (2.0, 0.0), (2.0, 1.0), (0.0, 1.0)];
        let w = mean_value_weights(&quad, (0.5, 0.25));
        let x: f64 = w.iter().zip(quad.iter()).map(|(w, p)| w * p.0).sum();
        let y: f64 = w.iter().zip(quad.iter()).map(|(w, p)| w * p.1).sum();
        assert!((x - 0.5).abs() < 1e-9 && (y - 0.25).abs() < 1e-9);
        assert_eq!(mean_value_weights(&quad, (2.0, 1.0)), vec![0.0, 0.0, 1.0, 0.0]);
        let e = mean_value_weights(&quad, (1.0, 0.0));
        assert!((e[0] - 0.5).abs() < 1e-9 && (e[1] - 0.5).abs() < 1e-9);
    }

    #[test]
    fn crossing_boxes_self_intersect() {
        let mut m = box_mesh(v3(-1.0, 0.0, -1.0), v3(1.0, 1.0, 1.0));
        assert!(self_intersections(&Geo::build(&m, |p| p), 10).is_empty());
        // pull a roof corner down through the floor
        m.vertices[7] = v3(1.0, -0.5, 1.0);
        let g = Geo::build(&m, |p| p);
        assert!(!self_intersections(&g, 10).is_empty());
    }

    #[test]
    fn concave_polygon_triangulates() {
        let l = [(0.0, 0.0), (2.0, 0.0), (2.0, 1.0), (1.0, 1.0), (1.0, 2.0), (0.0, 2.0)];
        let t = triangulate_2d(&l);
        assert_eq!(t.len(), 4);
        let area: f64 = t.iter().map(|[a, b, c]| cross2(l[*a], l[*b], l[*c]) * 0.5).sum();
        assert!((area - 3.0).abs() < 1e-9);
    }
}
