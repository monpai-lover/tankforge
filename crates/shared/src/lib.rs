//! Shared math + deterministic RNG. No game logic lives here.
use serde::{Deserialize, Serialize};
use std::ops::{Add, Mul, Neg, Sub};

/// Right-handed, Y-up, metres.
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Vec3 {
    pub x: f32,
    pub y: f32,
    pub z: f32,
}

impl Vec3 {
    pub const ZERO: Vec3 = Vec3 { x: 0.0, y: 0.0, z: 0.0 };
    pub const fn new(x: f32, y: f32, z: f32) -> Self {
        Self { x, y, z }
    }
    pub fn dot(self, o: Vec3) -> f32 {
        self.x * o.x + self.y * o.y + self.z * o.z
    }
    pub fn cross(self, o: Vec3) -> Vec3 {
        Vec3::new(
            self.y * o.z - self.z * o.y,
            self.z * o.x - self.x * o.z,
            self.x * o.y - self.y * o.x,
        )
    }
    pub fn length(self) -> f32 {
        self.dot(self).sqrt()
    }
    pub fn normalized(self) -> Vec3 {
        let l = self.length();
        if l < 1e-9 {
            Vec3::ZERO
        } else {
            self * (1.0 / l)
        }
    }
    pub fn to_array(self) -> [f32; 3] {
        [self.x, self.y, self.z]
    }
    /// Any unit vector perpendicular to `self` (assumed non-zero).
    pub fn any_perpendicular(self) -> Vec3 {
        let a = if self.x.abs() < 0.9 { Vec3::new(1.0, 0.0, 0.0) } else { Vec3::new(0.0, 1.0, 0.0) };
        self.cross(a).normalized()
    }
}

impl Add for Vec3 {
    type Output = Vec3;
    fn add(self, o: Vec3) -> Vec3 {
        Vec3::new(self.x + o.x, self.y + o.y, self.z + o.z)
    }
}
impl Sub for Vec3 {
    type Output = Vec3;
    fn sub(self, o: Vec3) -> Vec3 {
        Vec3::new(self.x - o.x, self.y - o.y, self.z - o.z)
    }
}
impl Mul<f32> for Vec3 {
    type Output = Vec3;
    fn mul(self, k: f32) -> Vec3 {
        Vec3::new(self.x * k, self.y * k, self.z * k)
    }
}
impl Neg for Vec3 {
    type Output = Vec3;
    fn neg(self) -> Vec3 {
        Vec3::new(-self.x, -self.y, -self.z)
    }
}

/// Small deterministic xorshift64* RNG. The server seeds it per shot and records the
/// seed, so any shot can be re-simulated bit-for-bit (anti-cheat audits, tests).
#[derive(Clone, Debug)]
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Rng(seed.max(1))
    }
    pub fn next_u64(&mut self) -> u64 {
        let mut x = self.0;
        x ^= x >> 12;
        x ^= x << 25;
        x ^= x >> 27;
        self.0 = x;
        x.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    /// Uniform in [0, 1).
    pub fn next_f32(&mut self) -> f32 {
        ((self.next_u64() >> 40) as f32) / ((1u64 << 24) as f32)
    }
}

pub type EntityId = u64;

/// Rotate about +Y, clockwise seen from above, so +Z (forward) turns towards +X (right).
pub fn rotate_yaw(v: Vec3, yaw: f32) -> Vec3 {
    let (s, c) = yaw.sin_cos();
    Vec3::new(v.x * c + v.z * s, v.y, -v.x * s + v.z * c)
}

/// Planar hull pose: position of the vehicle origin and heading (clockwise from +Z).
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct HullPose {
    pub pos: Vec3,
    pub heading: f32,
}

impl HullPose {
    pub fn to_world_point(&self, p: Vec3) -> Vec3 {
        self.pos + rotate_yaw(p, self.heading)
    }
    pub fn to_world_dir(&self, d: Vec3) -> Vec3 {
        rotate_yaw(d, self.heading)
    }
    pub fn to_local_point(&self, p: Vec3) -> Vec3 {
        rotate_yaw(p - self.pos, -self.heading)
    }
    pub fn to_local_dir(&self, d: Vec3) -> Vec3 {
        rotate_yaw(d, -self.heading)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cross_and_normalize() {
        let c = Vec3::new(1.0, 0.0, 0.0).cross(Vec3::new(0.0, 1.0, 0.0));
        assert_eq!(c, Vec3::new(0.0, 0.0, 1.0));
        assert!((Vec3::new(3.0, 4.0, 0.0).normalized().length() - 1.0).abs() < 1e-6);
    }
    #[test]
    fn hull_pose_round_trips_and_turns_clockwise() {
        let pose = HullPose { pos: Vec3::new(10.0, 0.0, 5.0), heading: std::f32::consts::FRAC_PI_2 };
        let w = pose.to_world_point(Vec3::new(0.0, 1.6, 5.1));
        assert!((w - Vec3::new(15.1, 1.6, 5.0)).length() < 1e-4, "{:?}", w);
        let back = pose.to_local_point(w);
        assert!((back - Vec3::new(0.0, 1.6, 5.1)).length() < 1e-4);
        assert!((pose.to_world_dir(Vec3::new(0.0, 0.0, 1.0)) - Vec3::new(1.0, 0.0, 0.0)).length() < 1e-6);
    }

    #[test]
    fn rng_is_deterministic_and_in_range() {
        let mut a = Rng::new(42);
        let mut b = Rng::new(42);
        for _ in 0..100 {
            let (x, y) = (a.next_f32(), b.next_f32());
            assert_eq!(x, y);
            assert!((0.0..1.0).contains(&x));
        }
    }
}
