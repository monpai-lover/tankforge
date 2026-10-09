//! Double-precision 3-vector for design geometry. Meshes edited by players can have long thin
//! faces and near-coincident vertices, so the designer works in f64 and converts to the
//! engine's f32 `Vec3` only at the boundary to the damage / replay crates.
use serde::{Deserialize, Serialize};
use std::ops::{Add, AddAssign, Div, Index, Mul, Neg, Sub};
use tg_shared::Vec3;

#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(from = "[f64; 3]", into = "[f64; 3]")]
pub struct V3 {
    pub x: f64,
    pub y: f64,
    pub z: f64,
}

impl From<[f64; 3]> for V3 {
    fn from(a: [f64; 3]) -> Self {
        V3::new(a[0], a[1], a[2])
    }
}
impl From<V3> for [f64; 3] {
    fn from(v: V3) -> Self {
        [v.x, v.y, v.z]
    }
}

pub const fn v3(x: f64, y: f64, z: f64) -> V3 {
    V3 { x, y, z }
}

impl V3 {
    pub const ZERO: V3 = v3(0.0, 0.0, 0.0);
    pub const X: V3 = v3(1.0, 0.0, 0.0);
    pub const Y: V3 = v3(0.0, 1.0, 0.0);
    pub const Z: V3 = v3(0.0, 0.0, 1.0);

    pub const fn new(x: f64, y: f64, z: f64) -> Self {
        V3 { x, y, z }
    }
    pub fn dot(self, o: V3) -> f64 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }
    pub fn cross(self, o: V3) -> V3 {
        v3(self.y * o.z - self.z * o.y, self.z * o.x - self.x * o.z, self.x * o.y - self.y * o.x)
    }
    pub fn len(self) -> f64 {
        self.dot(self).sqrt()
    }
    pub fn len2(self) -> f64 {
        self.dot(self)
    }
    pub fn norm(self) -> V3 {
        let l = self.len();
        if l < 1e-12 {
            V3::ZERO
        } else {
            self * (1.0 / l)
        }
    }
    pub fn min(self, o: V3) -> V3 {
        v3(self.x.min(o.x), self.y.min(o.y), self.z.min(o.z))
    }
    pub fn max(self, o: V3) -> V3 {
        v3(self.x.max(o.x), self.y.max(o.y), self.z.max(o.z))
    }
    pub fn is_finite(self) -> bool {
        self.x.is_finite() && self.y.is_finite() && self.z.is_finite()
    }
    pub fn to_f32(self) -> Vec3 {
        Vec3::new(self.x as f32, self.y as f32, self.z as f32)
    }
    pub fn from_f32(v: Vec3) -> V3 {
        v3(v.x as f64, v.y as f64, v.z as f64)
    }
    pub fn arr(self) -> [f64; 3] {
        [self.x, self.y, self.z]
    }
    /// Rotation about +Y; positive turns +Z towards +X (clockwise seen from above), the same
    /// convention as vehicle heading and turret yaw everywhere else in the project.
    pub fn rot_y(self, a: f64) -> V3 {
        let (s, c) = a.sin_cos();
        v3(self.x * c + self.z * s, self.y, -self.x * s + self.z * c)
    }
    /// Rotation about +X; positive lifts +Z towards +Y (gun elevation).
    pub fn rot_x(self, a: f64) -> V3 {
        let (s, c) = a.sin_cos();
        v3(self.x, self.y * c + self.z * s, -self.y * s + self.z * c)
    }
    /// Unit vector perpendicular to self (assumed non-zero).
    pub fn any_perp(self) -> V3 {
        let a = if self.x.abs() < 0.9 { V3::X } else { V3::Y };
        self.cross(a).norm()
    }
}

impl Add for V3 {
    type Output = V3;
    fn add(self, o: V3) -> V3 {
        v3(self.x + o.x, self.y + o.y, self.z + o.z)
    }
}
impl AddAssign for V3 {
    fn add_assign(&mut self, o: V3) {
        self.x += o.x;
        self.y += o.y;
        self.z += o.z;
    }
}
impl Sub for V3 {
    type Output = V3;
    fn sub(self, o: V3) -> V3 {
        v3(self.x - o.x, self.y - o.y, self.z - o.z)
    }
}
impl Mul<f64> for V3 {
    type Output = V3;
    fn mul(self, k: f64) -> V3 {
        v3(self.x * k, self.y * k, self.z * k)
    }
}
impl Div<f64> for V3 {
    type Output = V3;
    fn div(self, k: f64) -> V3 {
        v3(self.x / k, self.y / k, self.z / k)
    }
}
impl Neg for V3 {
    type Output = V3;
    fn neg(self) -> V3 {
        v3(-self.x, -self.y, -self.z)
    }
}
impl Index<usize> for V3 {
    type Output = f64;
    fn index(&self, i: usize) -> &f64 {
        match i {
            0 => &self.x,
            1 => &self.y,
            _ => &self.z,
        }
    }
}

/// Axis-aligned box.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Aabb {
    pub min: V3,
    pub max: V3,
}

impl Aabb {
    pub const EMPTY: Aabb = Aabb { min: v3(f64::INFINITY, f64::INFINITY, f64::INFINITY), max: v3(f64::NEG_INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY) };
    pub fn from_center(c: V3, size: V3) -> Aabb {
        Aabb { min: c - size * 0.5, max: c + size * 0.5 }
    }
    pub fn add(&mut self, p: V3) {
        self.min = self.min.min(p);
        self.max = self.max.max(p);
    }
    pub fn size(&self) -> V3 {
        self.max - self.min
    }
    pub fn center(&self) -> V3 {
        (self.min + self.max) * 0.5
    }
    pub fn is_empty(&self) -> bool {
        self.min.x > self.max.x
    }
    pub fn overlaps(&self, o: &Aabb, margin: f64) -> bool {
        self.min.x < o.max.x - margin
            && o.min.x < self.max.x - margin
            && self.min.y < o.max.y - margin
            && o.min.y < self.max.y - margin
            && self.min.z < o.max.z - margin
            && o.min.z < self.max.z - margin
    }
    pub fn corners(&self) -> [V3; 8] {
        let (a, b) = (self.min, self.max);
        [
            v3(a.x, a.y, a.z),
            v3(b.x, a.y, a.z),
            v3(a.x, b.y, a.z),
            v3(b.x, b.y, a.z),
            v3(a.x, a.y, b.z),
            v3(b.x, a.y, b.z),
            v3(a.x, b.y, b.z),
            v3(b.x, b.y, b.z),
        ]
    }
    pub fn volume(&self) -> f64 {
        let s = self.size();
        (s.x * s.y * s.z).max(0.0)
    }
    /// Slab test; returns (t_enter, t_exit) for the ray o + d t, t >= 0.
    pub fn ray(&self, o: V3, d: V3) -> Option<(f64, f64)> {
        let (mut t0, mut t1) = (0.0f64, f64::INFINITY);
        for i in 0..3 {
            let (lo, hi, oi, di) = (self.min[i], self.max[i], o[i], d[i]);
            if di.abs() < 1e-12 {
                if oi < lo || oi > hi {
                    return None;
                }
            } else {
                let (mut a, mut b) = ((lo - oi) / di, (hi - oi) / di);
                if a > b {
                    std::mem::swap(&mut a, &mut b);
                }
                t0 = t0.max(a);
                t1 = t1.min(b);
                if t0 > t1 {
                    return None;
                }
            }
        }
        Some((t0, t1))
    }
}

/// Solves the 3x3 system m * x = b (row-major); None if singular.
pub fn solve3(m: [[f64; 3]; 3], b: [f64; 3]) -> Option<[f64; 3]> {
    let det = m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
        + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    if det.abs() < 1e-14 {
        return None;
    }
    let mut out = [0.0; 3];
    for (k, o) in out.iter_mut().enumerate() {
        let mut mk = m;
        for r in 0..3 {
            mk[r][k] = b[r];
        }
        let dk = mk[0][0] * (mk[1][1] * mk[2][2] - mk[1][2] * mk[2][1]) - mk[0][1] * (mk[1][0] * mk[2][2] - mk[1][2] * mk[2][0])
            + mk[0][2] * (mk[1][0] * mk[2][1] - mk[1][1] * mk[2][0]);
        *o = dk / det;
    }
    Some(out)
}
