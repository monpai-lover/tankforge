//! Triangle-surface armour (user decision 2026-10-23: the Pantsir's armour from its model's own
//! triangles, not plates; docs/hitbox-conventions.md). The armour-role triangles of the vehicle's drawn
//! model, in hull space with the turret at yaw 0, each bound to a part with its zone, material and
//! authored thickness (a game resistance assignment: the model is one skin, not a measured wall).
//!
//! A shot's or a fragment's line meets them through a BVH (the hull's and the turret's, the turret's
//! posed by its yaw about the pivot). Each crossing becomes, for that line only, an armour plate whose
//! outline is the crossed triangle, so the plate path's penetration, ricochet, spall and HE rules apply
//! unchanged and the contact point and the slope are the model's own. Gaps and apertures stay empty:
//! a line between triangles meets nothing (no box or hull fill behind it).
//!
//! Wall pairing (this owner's rule): crossings of one part closer along the line than its wall depth
//! (twice its thickness, at least 3 cm) are one wall, so seams, rivets and overlapping detail on one
//! skin do not charge the thickness twice. Outward normals: each part's triangles keep their winding
//! when most of them face away from the part group's centroid (hull or turret), else all turn over.
use crate::geometry::bvh::{Bounds, Bvh};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tg_armor::{ArmorPlate, ArmorZone};
use tg_shared::{rotate_yaw, Vec3};

pub const SURFACE_ARMOR_SCHEMA: u32 = 1;
const MAX_TRIANGLES: usize = 400_000;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SurfacePartDef {
    pub id: String,
    pub zone: ArmorZone,
    pub material: String,
    pub thickness_mm: f32,
    /// Turns with the turret (posed by its yaw about the turret pivot).
    #[serde(default)]
    pub turret: bool,
}

/// The trusted build-time data (data/vehicles/<id>/surface_armor.json): positions as little-endian
/// f32 x, y, z and triangles as little-endian u32 a, b, c, part, both base64; geometry_hash is the
/// SHA-256 of the two decoded byte streams in that order (checked on load).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SurfaceArmorDef {
    pub schema: u32,
    pub geometry_hash: String,
    pub parts: Vec<SurfacePartDef>,
    pub positions: String,
    pub triangles: String,
    /// Where the geometry came from (the model file and its hash): carried, not interpreted.
    #[serde(default)]
    pub source: serde_json::Value,
}

#[derive(Debug)]
pub struct SurfaceArmor {
    pub parts: Vec<SurfacePartDef>,
    pos: Vec<[f32; 3]>,
    tris: Vec<[u32; 4]>,
    /// Outward unit normal of each triangle.
    normal: Vec<Vec3>,
    hull: (Bvh, Vec<u32>),
    turret: (Bvh, Vec<u32>),
    /// Bounds of the hull's triangles and of the turret's at yaw 0.
    pub hull_lo: Vec3,
    pub hull_hi: Vec3,
    pub turret_lo: Vec3,
    pub turret_hi: Vec3,
    pub triangle_count: usize,
}

/// One wall on a line: where along it, the crossed triangle and the part.
#[derive(Clone, Copy, Debug)]
pub struct Wall {
    pub t: f32,
    pub tri: u32,
    pub part: u32,
}

fn b64(s: &str) -> Result<Vec<u8>, String> {
    let val = |c: u8| -> Result<u32, String> {
        Ok(match c {
            b'A'..=b'Z' => (c - b'A') as u32,
            b'a'..=b'z' => (c - b'a' + 26) as u32,
            b'0'..=b'9' => (c - b'0' + 52) as u32,
            b'+' => 62,
            b'/' => 63,
            _ => return Err("surface armour: invalid base64".into()),
        })
    };
    let bytes: Vec<u8> = s.bytes().filter(|c| !c.is_ascii_whitespace() && *c != b'=').collect();
    let mut out = Vec::with_capacity(bytes.len() * 3 / 4);
    for chunk in bytes.chunks(4) {
        let mut acc = 0u32;
        for (i, &c) in chunk.iter().enumerate() {
            acc |= val(c)? << (18 - 6 * i);
        }
        let n = chunk.len();
        if n < 2 {
            return Err("surface armour: truncated base64".into());
        }
        out.push((acc >> 16) as u8);
        if n > 2 {
            out.push((acc >> 8) as u8);
        }
        if n > 3 {
            out.push(acc as u8);
        }
    }
    Ok(out)
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn v3(p: [f32; 3]) -> Vec3 {
    Vec3::new(p[0], p[1], p[2])
}

/// Möller–Trumbore: the distance along `d` (unit) from `o` to the triangle, if within (0, max].
fn ray_triangle(o: Vec3, d: Vec3, a: Vec3, b: Vec3, c: Vec3, max_t: f32) -> Option<f32> {
    let e1 = b - a;
    let e2 = c - a;
    let p = d.cross(e2);
    let det = e1.dot(p);
    if det.abs() < 1e-12 {
        return None;
    }
    let inv = 1.0 / det;
    let s = o - a;
    let u = s.dot(p) * inv;
    if !(-1e-6..=1.0 + 1e-6).contains(&u) {
        return None;
    }
    let q = s.cross(e1);
    let v = d.dot(q) * inv;
    if v < -1e-6 || u + v > 1.0 + 1e-6 {
        return None;
    }
    let t = e2.dot(q) * inv;
    (t > 1e-5 && t <= max_t).then_some(t)
}

fn build_bvh(pos: &[[f32; 3]], tris: &[[u32; 4]], ids: Vec<u32>) -> Result<(Bvh, Vec<u32>), String> {
    if ids.is_empty() {
        return Ok((Bvh { nodes: vec![], order: vec![] }, ids));
    }
    let items: Vec<Bounds> = ids
        .iter()
        .map(|&i| {
            let t = tris[i as usize];
            let mut b = Bounds::empty();
            for k in 0..3 {
                let p = pos[t[k] as usize];
                b = b.union(Bounds::point([p[0] as f64, p[1] as f64, p[2] as f64]));
            }
            b
        })
        .collect();
    Ok((Bvh::build(&items)?, ids))
}

impl SurfaceArmor {
    pub fn new(def: &SurfaceArmorDef) -> Result<SurfaceArmor, String> {
        if def.schema != SURFACE_ARMOR_SCHEMA {
            return Err(format!("surface armour: unsupported schema {}", def.schema));
        }
        let pb = b64(&def.positions)?;
        let tb = b64(&def.triangles)?;
        let mut h = Sha256::new();
        h.update(&pb);
        h.update(&tb);
        let hash = hex(&h.finalize());
        if hash != def.geometry_hash {
            return Err(format!("surface armour: geometry hash mismatch ({hash})"));
        }
        if pb.len() % 12 != 0 || tb.len() % 16 != 0 {
            return Err("surface armour: stream length".into());
        }
        let pos: Vec<[f32; 3]> = pb
            .chunks(12)
            .map(|c| std::array::from_fn(|k| f32::from_le_bytes([c[k * 4], c[k * 4 + 1], c[k * 4 + 2], c[k * 4 + 3]])))
            .collect();
        let tris: Vec<[u32; 4]> = tb
            .chunks(16)
            .map(|c| std::array::from_fn(|k| u32::from_le_bytes([c[k * 4], c[k * 4 + 1], c[k * 4 + 2], c[k * 4 + 3]])))
            .collect();
        if tris.is_empty() || tris.len() > MAX_TRIANGLES {
            return Err("surface armour: triangle count".into());
        }
        if pos.iter().any(|p| p.iter().any(|v| !v.is_finite())) {
            return Err("surface armour: non-finite position".into());
        }
        for t in &tris {
            if t[..3].iter().any(|&i| i as usize >= pos.len()) || t[3] as usize >= def.parts.len() {
                return Err("surface armour: index out of range".into());
            }
        }
        for p in &def.parts {
            if !(p.thickness_mm.is_finite() && p.thickness_mm > 0.0) {
                return Err(format!("surface armour: part {} has no thickness", p.id));
            }
        }
        // the centroid of each group (hull, turret): the reference for the outward side
        let turret_of = |t: &[u32; 4]| def.parts[t[3] as usize].turret;
        let mut sum = [Vec3::ZERO; 2];
        let mut n = [0f32; 2];
        let mut lo = [Vec3::new(f32::INFINITY, f32::INFINITY, f32::INFINITY); 2];
        let mut hi = [Vec3::new(f32::NEG_INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY); 2];
        for t in &tris {
            let g = turret_of(t) as usize;
            for k in 0..3 {
                let p = v3(pos[t[k] as usize]);
                sum[g] = sum[g] + p;
                n[g] += 1.0;
                lo[g] = Vec3::new(lo[g].x.min(p.x), lo[g].y.min(p.y), lo[g].z.min(p.z));
                hi[g] = Vec3::new(hi[g].x.max(p.x), hi[g].y.max(p.y), hi[g].z.max(p.z));
            }
        }
        let centroid = [sum[0] * (1.0 / n[0].max(1.0)), sum[1] * (1.0 / n[1].max(1.0))];
        let raw: Vec<Vec3> = tris
            .iter()
            .map(|t| {
                let (a, b, c) = (v3(pos[t[0] as usize]), v3(pos[t[1] as usize]), v3(pos[t[2] as usize]));
                let nn = (b - a).cross(c - a);
                let l = nn.length();
                if l > 0.0 { nn * (1.0 / l) } else { Vec3::new(0.0, 1.0, 0.0) }
            })
            .collect();
        // each part's winding kept or turned over by its majority
        let mut votes = vec![0i64; def.parts.len()];
        for (i, t) in tris.iter().enumerate() {
            let c = (v3(pos[t[0] as usize]) + v3(pos[t[1] as usize]) + v3(pos[t[2] as usize])) * (1.0 / 3.0);
            let out = c - centroid[turret_of(t) as usize];
            votes[t[3] as usize] += if raw[i].dot(out) >= 0.0 { 1 } else { -1 };
        }
        let normal = tris.iter().zip(&raw).map(|(t, &nn)| if votes[t[3] as usize] >= 0 { nn } else { -nn }).collect();
        let (hull_ids, turret_ids): (Vec<u32>, Vec<u32>) = (0..tris.len() as u32).partition(|&i| !turret_of(&tris[i as usize]));
        let hull = build_bvh(&pos, &tris, hull_ids)?;
        let turret = build_bvh(&pos, &tris, turret_ids)?;
        Ok(SurfaceArmor {
            parts: def.parts.clone(),
            triangle_count: tris.len(),
            pos,
            tris,
            normal,
            hull,
            turret,
            hull_lo: lo[0],
            hull_hi: hi[0],
            turret_lo: lo[1],
            turret_hi: hi[1],
        })
    }

    pub fn has_turret(&self) -> bool {
        !self.turret.1.is_empty()
    }

    fn crossings(&self, group: &(Bvh, Vec<u32>), o: Vec3, d: Vec3, max_t: f32, out: &mut Vec<Wall>) {
        let (bvh, ids) = group;
        if ids.is_empty() {
            return;
        }
        let e = o + d * max_t;
        let (mut stack, mut cand) = (Vec::new(), Vec::new());
        if bvh
            .candidates([o.x as f64, o.y as f64, o.z as f64], [e.x as f64, e.y as f64, e.z as f64], &mut stack, &mut cand, ids.len())
            .is_err()
        {
            return;
        }
        for &k in &cand {
            let i = ids[k as usize];
            let t = self.tris[i as usize];
            let (a, b, c) = (v3(self.pos[t[0] as usize]), v3(self.pos[t[1] as usize]), v3(self.pos[t[2] as usize]));
            if let Some(dist) = ray_triangle(o, d, a, b, c, max_t) {
                out.push(Wall { t: dist, tri: i, part: t[3] });
            }
        }
    }

    /// The walls along `o + d t`, t in (0, max_t] (d a unit vector, hull space), in order, the turret
    /// turned to `yaw` about `pivot`; one per wall (pairing above).
    pub fn walls(&self, o: Vec3, d: Vec3, max_t: f32, yaw: f32, pivot: Vec3) -> Vec<Wall> {
        let mut out = Vec::new();
        self.crossings(&self.hull, o, d, max_t, &mut out);
        if self.has_turret() {
            // the line in the turret's own frame (yaw 0)
            let ol = pivot + rotate_yaw(o - pivot, -yaw);
            let dl = rotate_yaw(d, -yaw);
            self.crossings(&self.turret, ol, dl, max_t, &mut out);
        }
        out.sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap_or(std::cmp::Ordering::Equal));
        let mut kept: Vec<Wall> = Vec::with_capacity(out.len());
        for w in out {
            let depth = (self.parts[w.part as usize].thickness_mm * 2e-3).max(0.03);
            if kept.iter().rev().take_while(|k| w.t - k.t < depth).any(|k| k.part == w.part) {
                continue;
            }
            kept.push(w);
        }
        kept
    }

    /// The distance to the nearest wall along the line (a fragment inside stops at the armour), the
    /// wall it started from excepted (`skip`: its plate id).
    pub fn nearest(&self, o: Vec3, d: Vec3, max_t: f32, yaw: f32, pivot: Vec3, skip: Option<&str>, min_t: f32) -> Option<f32> {
        self.walls(o, d, max_t, yaw, pivot)
            .into_iter()
            .find(|w| w.t > min_t && skip.map_or(true, |s| s != Self::plate_id(&self.parts[w.part as usize].id, w.tri)))
            .map(|w| w.t)
    }

    pub fn plate_id(part: &str, tri: u32) -> String {
        format!("surf:{part}:{tri}")
    }

    /// The crossed triangle as an armour plate (its outline, its outward normal), posed with the turret.
    pub fn plate(&self, w: Wall, yaw: f32, pivot: Vec3) -> ArmorPlate {
        let t = self.tris[w.tri as usize];
        let part = &self.parts[t[3] as usize];
        let mut v = [v3(self.pos[t[0] as usize]), v3(self.pos[t[1] as usize]), v3(self.pos[t[2] as usize])];
        let mut n = self.normal[w.tri as usize];
        if part.turret && yaw != 0.0 {
            for p in &mut v {
                *p = pivot + rotate_yaw(*p - pivot, yaw);
            }
            n = rotate_yaw(n, yaw);
        }
        let c = (v[0] + v[1] + v[2]) * (1.0 / 3.0);
        let u = {
            let e = v[1] - v[0];
            let e = e - n * e.dot(n);
            let l = e.length();
            if l > 1e-9 { e * (1.0 / l) } else { n.any_perpendicular() }
        };
        let vv = n.cross(u);
        // the outline grown by 1 mm about its centre: a line through an edge still meets the plate
        let polygon: Vec<[f32; 2]> = v
            .iter()
            .map(|p| {
                let r = *p - c;
                let (a, b) = (r.dot(u), r.dot(vv));
                let l = (a * a + b * b).sqrt().max(1e-6);
                let k = (l + 1e-3) / l;
                [a * k, b * k]
            })
            .collect();
        let half_u = polygon.iter().map(|p| p[0].abs()).fold(0.0, f32::max) + 1e-4;
        let half_v = polygon.iter().map(|p| p[1].abs()).fold(0.0, f32::max) + 1e-4;
        ArmorPlate {
            id: Self::plate_id(&part.id, w.tri),
            zone: part.zone,
            material: part.material.clone(),
            thickness_mm: part.thickness_mm,
            center: c,
            normal: n,
            axis_u: u,
            half_u,
            half_v,
            curvature: 0.0,
            polygon,
            hinge: None,
        }
    }

    /// The corners of everything at `yaw` (bounds of the posed surfaces).
    pub fn corners(&self, yaw: f32, pivot: Vec3) -> Vec<Vec3> {
        let mut out = Vec::new();
        let boxes = [(self.hull_lo, self.hull_hi, false), (self.turret_lo, self.turret_hi, true)];
        for (lo, hi, turret) in boxes {
            if !lo.x.is_finite() {
                continue;
            }
            for x in [lo.x, hi.x] {
                for y in [lo.y, hi.y] {
                    for z in [lo.z, hi.z] {
                        let p = Vec3::new(x, y, z);
                        out.push(if turret { pivot + rotate_yaw(p - pivot, yaw) } else { p });
                    }
                }
            }
        }
        out
    }
}

/// The trusted data's encoding (for tools and tests): positions and triangles to base64 and the hash.
pub fn encode(positions: &[[f32; 3]], triangles: &[[u32; 4]]) -> (String, String, String) {
    let pb: Vec<u8> = positions.iter().flat_map(|p| p.iter().flat_map(|v| v.to_le_bytes())).collect();
    let tb: Vec<u8> = triangles.iter().flat_map(|t| t.iter().flat_map(|v| v.to_le_bytes())).collect();
    let mut h = Sha256::new();
    h.update(&pb);
    h.update(&tb);
    let enc = |b: &[u8]| -> String {
        const A: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut s = String::with_capacity(b.len() * 4 / 3 + 4);
        for c in b.chunks(3) {
            let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
            for i in 0..4 {
                if i <= c.len() {
                    s.push(A[(n >> (18 - 6 * i) & 63) as usize] as char);
                } else {
                    s.push('=');
                }
            }
        }
        s
    };
    (enc(&pb), enc(&tb), hex(&h.finalize()))
}
