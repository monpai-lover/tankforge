//! Track / soil interaction after Bekker and Wong (see SOURCES.md).
//!
//! * pressure-sinkage       `p = (kc / b + kphi) * z^n`
//! * compaction resistance  `Rc = b * (kc / b + kphi) * z^(n+1) / (n+1)` (per track)
//! * shear (Janosi-Hanamoto) `F = Fmax * (1 - K/(i L) * (1 - exp(-i L / K)))`,
//!   `Fmax = c A + W tan(phi)`
//!
//! Units follow the published tables: `kc` in kN/m^(n+1), `kphi` in kN/m^(n+2), `c` in kPa,
//! `K` in metres. (client/web/src/sim/terra.js mirrors this file until the WASM build exists.)
use serde::{Deserialize, Serialize};

const G: f32 = 9.81;
/// Ground pressure the terrain multipliers in terrains.json are calibrated for.
pub const REFERENCE_PRESSURE_PA: f32 = 80e3;
/// Shear deformation modulus used on hard ground (no soil data).
pub const HARD_GROUND_K: f32 = 0.006;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SoilDef {
    /// Sinkage exponent.
    pub n: f32,
    pub kc: f32,
    pub kphi: f32,
    /// Cohesion, kPa.
    pub c: f32,
    pub phi_deg: f32,
    /// Shear deformation modulus, m.
    #[serde(rename = "K")]
    pub k: f32,
    /// Depth of the soft layer.
    #[serde(default = "default_max_sinkage")]
    pub max_sinkage_m: f32,
}

fn default_max_sinkage() -> f32 {
    0.5
}

/// Mean ground pressure under the tracks, Pa.
pub fn ground_pressure(mass_kg: f32, track_width: f32, contact_length: f32) -> f32 {
    mass_kg * G / (2.0 * track_width * contact_length)
}

/// Static sinkage in metres for a track of width `b` carrying `pressure_pa`.
pub fn sinkage(soil: Option<&SoilDef>, pressure_pa: f32, b: f32) -> f32 {
    match soil {
        None => 0.0,
        Some(s) => {
            let k = s.kc / b + s.kphi;
            (pressure_pa / 1000.0 / k).powf(1.0 / s.n).min(s.max_sinkage_m)
        }
    }
}

/// Force needed to press one track's rut into the soil, N.
pub fn compaction_resistance(soil: Option<&SoilDef>, z: f32, b: f32) -> f32 {
    match soil {
        None => 0.0,
        Some(s) => b * (s.kc / b + s.kphi) * z.powf(s.n + 1.0) / (s.n + 1.0) * 1000.0,
    }
}

/// Largest thrust the soil can carry under contact area `area` (m^2) and weight `weight_n`.
pub fn max_traction(soil: &SoilDef, area: f32, weight_n: f32) -> f32 {
    soil.c * 1000.0 * area + weight_n * soil.phi_deg.to_radians().tan()
}

fn shear_curve(x: f64) -> f64 {
    1.0 - (1.0 - (-x).exp()) / x
}

/// Share of the maximum thrust developed at slip `slip` (0..1) for contact length `l`.
pub fn shear_ratio(slip: f32, k: f32, l: f32) -> f32 {
    let x = (slip * l / k) as f64;
    if x < 1e-6 {
        0.0
    } else {
        shear_curve(x) as f32
    }
}

/// Inverse of [`shear_ratio`]: the slip a track needs to deliver `ratio` of its maximum thrust.
pub fn slip_for_ratio(ratio: f32, k: f32, l: f32) -> f32 {
    let r = (ratio as f64).clamp(0.0, 0.9999);
    if r <= 0.0 {
        return 0.0;
    }
    let (mut lo, mut hi) = (0.0f64, 1.0f64);
    while shear_curve(hi) < r && hi < 1e6 {
        hi *= 2.0;
    }
    for _ in 0..40 {
        let mid = 0.5 * (lo + hi);
        if shear_curve(mid) < r {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    ((0.5 * (lo + hi)) as f32 * k / l).min(1.0)
}

/// How much harder (or easier) soft ground is for this vehicle than for the reference one.
/// Compaction resistance grows with z^(n+1) and z with p^(1/n), so it scales with p^((n+1)/n).
pub fn pressure_factor(soil: Option<&SoilDef>, pressure_pa: f32) -> f32 {
    match soil {
        None => 1.0,
        Some(s) => {
            let e = ((s.n + 1.0) / s.n).min(3.0);
            (pressure_pa / REFERENCE_PRESSURE_PA).powf(e).clamp(0.6, 1.8)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const MUD: SoilDef = SoilDef { n: 0.5, kc: 13.19, kphi: 692.15, c: 4.14, phi_deg: 13.0, k: 0.03, max_sinkage_m: 0.3 };
    const SAND: SoilDef = SoilDef { n: 1.1, kc: 0.99, kphi: 1528.43, c: 1.04, phi_deg: 28.0, k: 0.025, max_sinkage_m: 0.2 };

    #[test]
    fn sinkage_follows_the_pressure_sinkage_relation() {
        assert!(sinkage(Some(&MUD), 107e3, 0.725) > sinkage(Some(&MUD), 80e3, 0.5));
        let b = 0.6;
        let z = sinkage(Some(&SAND), 100e3, b);
        assert!(z > 0.02 && z < 0.2, "sand sinkage {z}");
        assert_eq!(sinkage(None, 100e3, b), 0.0);
        let p = (SAND.kc / b + SAND.kphi) * z.powf(SAND.n) * 1000.0;
        assert!((p - 100e3).abs() < 200.0, "p {p}");
        let rc = 2.0 * compaction_resistance(Some(&SAND), z, b);
        assert!(rc > 1000.0 && rc < 0.1 * 100e3 * 2.0 * b * 3.6, "rc {rc}");
    }

    #[test]
    fn shear_curve_saturates_and_inverts() {
        let mut last = 0.0;
        for i in [0.01f32, 0.05, 0.1, 0.3, 0.6, 1.0] {
            let r = shear_ratio(i, 0.025, 3.6);
            assert!(r > last && r < 1.0);
            assert!((slip_for_ratio(r, 0.025, 3.6) - i).abs() < 2e-3, "inverse at {i}");
            last = r;
        }
        assert!(slip_for_ratio(0.5, 0.025, 3.6) < 0.03);
        assert!(slip_for_ratio(0.97, 0.025, 3.6) > 0.15);
    }

    #[test]
    fn pressure_factor_is_one_at_the_reference_pressure() {
        assert!((pressure_factor(Some(&MUD), REFERENCE_PRESSURE_PA) - 1.0).abs() < 1e-6);
        assert!(pressure_factor(Some(&MUD), 107e3) > 1.5 && pressure_factor(Some(&MUD), 60e3) < 1.0);
        assert_eq!(pressure_factor(None, 200e3), 1.0);
        assert!(max_traction(&MUD, 5.0, 500e3) > 100e3);
    }
}
