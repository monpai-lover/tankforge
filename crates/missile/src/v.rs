//! Small f64 vector helpers on `[f64; 3]` (game frame: x right, y up, z forward, metres).

pub type V3 = [f64; 3];

pub const G: f64 = 9.80665;

pub fn add(a: V3, b: V3) -> V3 {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
pub fn sub(a: V3, b: V3) -> V3 {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
pub fn mul(a: V3, k: f64) -> V3 {
    [a[0] * k, a[1] * k, a[2] * k]
}
pub fn dot(a: V3, b: V3) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
pub fn cross(a: V3, b: V3) -> V3 {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
pub fn len(a: V3) -> f64 {
    dot(a, a).sqrt()
}
pub fn norm(a: V3) -> V3 {
    let l = len(a);
    if l < 1e-12 {
        [0.0, 0.0, 1.0]
    } else {
        mul(a, 1.0 / l)
    }
}
pub fn dist(a: V3, b: V3) -> f64 {
    len(sub(a, b))
}
pub fn finite(a: V3) -> bool {
    a.iter().all(|v| v.is_finite())
}

/// Unit direction from a bearing (clockwise from +z) and an elevation (up positive).
pub fn dir_of(yaw: f64, pitch: f64) -> V3 {
    let c = pitch.cos();
    [yaw.sin() * c, pitch.sin(), yaw.cos() * c]
}

/// Bearing and elevation of a direction.
pub fn yaw_pitch(d: V3) -> (f64, f64) {
    (d[0].atan2(d[2]), d[1].atan2(d[0].hypot(d[2])))
}

/// Angle wrapped into (-pi, pi].
pub fn wrap(a: f64) -> f64 {
    let mut a = a % std::f64::consts::TAU;
    if a > std::f64::consts::PI {
        a -= std::f64::consts::TAU;
    }
    if a <= -std::f64::consts::PI {
        a += std::f64::consts::TAU;
    }
    a
}

/// Moves `cur` towards `want` by no more than `step` (angles wrap when `angular`).
pub fn approach(cur: f64, want: f64, step: f64, angular: bool) -> f64 {
    let d = if angular { wrap(want - cur) } else { want - cur };
    if d.abs() <= step {
        if angular {
            wrap(cur + d)
        } else {
            want
        }
    } else {
        let n = cur + step * d.signum();
        if angular {
            wrap(n)
        } else {
            n
        }
    }
}

/// Small deterministic generator (mulberry32): the same stream wherever a seed is replayed.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Rng(pub u32);

impl Rng {
    pub fn new(seed: u32) -> Rng {
        Rng(seed)
    }
    pub fn next_u32(&mut self) -> u32 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        t ^ (t >> 14)
    }
    /// Uniform in [0, 1).
    pub fn f(&mut self) -> f64 {
        self.next_u32() as f64 / 4_294_967_296.0
    }
    /// Roughly normal, mean 0, deviation 1 (sum of four uniforms).
    pub fn gauss(&mut self) -> f64 {
        (self.f() + self.f() + self.f() + self.f() - 2.0) * 1.732_050_8
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bearing_round_trip_and_wrap() {
        let d = dir_of(0.7, -0.2);
        let (y, p) = yaw_pitch(d);
        assert!((y - 0.7).abs() < 1e-12 && (p + 0.2).abs() < 1e-12);
        assert!((wrap(3.5 * std::f64::consts::PI) - std::f64::consts::PI * -0.5).abs() < 1e-12);
        assert_eq!(approach(0.0, 1.0, 0.25, false), 0.25);
        // the short way from 3 to -3 rad is across pi (0.28 rad): it gets there in one step
        assert!((approach(3.0, -3.0, 0.5, true) + 3.0).abs() < 1e-12);
    }
    #[test]
    fn rng_is_repeatable_and_spread() {
        let mut a = Rng::new(7);
        let mut b = Rng::new(7);
        let xs: Vec<f64> = (0..1000).map(|_| a.f()).collect();
        assert!(xs.iter().zip((0..1000).map(|_| b.f())).all(|(x, y)| *x == y));
        let mean = xs.iter().sum::<f64>() / 1000.0;
        assert!((mean - 0.5).abs() < 0.03 && xs.iter().all(|x| (0.0..1.0).contains(x)));
    }
}
