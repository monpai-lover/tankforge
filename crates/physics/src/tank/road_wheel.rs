//! RoadWheelSystem: where each road wheel is. One station per road-wheel axle and side; the wheel
//! stands on the track, not on the bare ground: the track bridges a dip narrower than the wheel
//! spacing and wraps round a hump before the wheel reaches it ([`BRIDGE`]). Wheels have no mass
//! of their own, so they follow the ground at once while the hull, with all the mass, follows
//! through the springs (wheel response is faster than hull response).
//! (client/web/src/sim/tank/suspension.js mirrors this file and suspension.rs.)
use super::math::*;

/// How steeply the track can drop away from a high point between two wheels.
pub const BRIDGE: f64 = 0.6;

/// A wheel in the hull's z-y plane: centre z, centre y, radius.
#[derive(Clone, Copy, Debug, PartialEq, Default)]
pub struct Wheel {
    pub z: f64,
    pub y: f64,
    pub r: f64,
}

/// Running-gear geometry of one side (both sides alike), from visual.json `running_gear`.
#[derive(Clone, Debug, PartialEq)]
pub struct GearGeometry {
    /// One per axle, front first (interleaved wheels on one axle count once).
    pub stations: Vec<Wheel>,
    pub track_x: f64,
    pub track_width: f64,
    pub thickness: f64,
    pub sprocket: Wheel,
    pub idler: Wheel,
    /// Return rollers (empty: the upper run rests on the road wheels).
    pub rollers: Vec<Wheel>,
    /// Droop of the upper run per square metre of free span, 1/m.
    pub sag: f64,
}

impl GearGeometry {
    /// From a visual.json `running_gear` block; None when it is missing or has no wheels.
    pub fn from_visual(rg: &serde_json::Value) -> Option<Self> {
        let num = |v: &serde_json::Value, k: &str| v.get(k).and_then(|x| x.as_f64());
        let wheel = |v: &serde_json::Value| -> Option<Wheel> { Some(Wheel { z: num(v, "z")?, y: num(v, "y")?, r: num(v, "r")? }) };
        let mut stations: Vec<Wheel> = Vec::new();
        for w in rg.get("wheels")?.as_array()? {
            let w = wheel(w)?;
            if !stations.iter().any(|s| (s.z - w.z).abs() < 5e-4) {
                stations.push(w);
            }
        }
        if stations.is_empty() {
            return None;
        }
        stations.sort_by(|a, b| b.z.total_cmp(&a.z));
        let rollers: Vec<Wheel> = rg.get("rollers").and_then(|r| r.as_array()).map(|a| a.iter().filter_map(wheel).collect()).unwrap_or_default();
        let sag = num(rg, "track_sag").unwrap_or(if rollers.is_empty() { 0.03 } else { 0.012 });
        Some(Self {
            stations,
            track_x: num(rg, "track_x")?,
            track_width: num(rg, "track_width")?,
            thickness: num(rg, "track_thickness").unwrap_or(0.08),
            sprocket: wheel(rg.get("sprocket")?)?,
            idler: wheel(rg.get("idler")?)?,
            rollers,
            sag,
        })
    }
}

/// One road-wheel station of one side, in the hull frame (right side first in every list).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Station {
    pub z: f64,
    pub y: f64,
    pub r: f64,
    pub x: f64,
    pub side: i8,
}

/// Index of a side in two-element arrays: 0 = left (-1), 1 = right (+1).
#[inline]
pub fn si(side: i8) -> usize {
    if side > 0 {
        1
    } else {
        0
    }
}

/// The ground under one track: hull-frame z of each sample (rear to front), the track's height
/// above the ground line there (< 0 on the ground run, >= 0 on the runs up to the end wheels),
/// the world height of the ground and the world point sampled.
#[derive(Clone, Debug, Default)]
pub struct GroundProfile {
    pub zs: Vec<f64>,
    pub run: Vec<f64>,
    pub h: Vec<f64>,
    pub pts: Vec<V3>,
}

/// Height of the track under station `s` (world y): the highest of the ground under the wheel
/// and the ground nearby, falling away round the wheel's rim and then at the bridging angle.
pub fn support_under(window: f64, prof: &GroundProfile, s: &Station) -> f64 {
    let zs = &prof.zs;
    let g = &prof.h;
    let mut j = 1;
    while j < zs.len() - 1 && zs[j] < s.z {
        j += 1;
    }
    let u = ((s.z - zs[j - 1]) / (zs[j] - zs[j - 1])).clamp(0.0, 1.0);
    let mut best = g[j - 1] + (g[j] - g[j - 1]) * u;
    for k in 0..zs.len() {
        let dz = (zs[k] - s.z).abs();
        if dz > window || prof.run[k] >= 0.0 {
            continue;
        }
        let round = if dz < s.r { s.r - (s.r * s.r - dz * dz).sqrt() } else { f64::INFINITY };
        let v = g[k] - round.min(BRIDGE * dz);
        if v > best {
            best = v;
        }
    }
    best
}

/// Rotation of a wheel of radius `r` after the track has run `travel` metres (radians, + forward).
/// Road wheels, sprocket and idler all turn with the track, so they never disagree with it.
pub fn wheel_angle(travel: f64, r: f64) -> f64 {
    travel / r.max(1e-3)
}

/// The angle a wheel turns in one step at track speed `v`.
pub fn wheel_spin(v: f64, r: f64, dt: f64) -> f64 {
    v * dt / r.max(1e-3)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_track_bridges_a_narrow_dip_and_wraps_a_hump() {
        let zs: Vec<f64> = (0..41).map(|i| -2.0 + i as f64 * 0.1).collect();
        let flat = GroundProfile { run: vec![-1.0; zs.len()], h: vec![0.0; zs.len()], pts: vec![], zs: zs.clone() };
        let s = Station { z: 0.0, y: 0.5, r: 0.35, x: 1.0, side: 1 };
        assert_eq!(support_under(0.6, &flat, &s), 0.0);
        // a 0.2 m wide, 0.3 m deep slot right under the wheel: the track spans it
        let mut dip = flat.clone();
        for (k, z) in zs.iter().enumerate() {
            if z.abs() < 0.11 {
                dip.h[k] = -0.3;
            }
        }
        let d = support_under(0.6, &dip, &s);
        assert!(d > -0.08 && d < 0.0, "the wheel dips {d} into a 0.3 m slot");
        // a 10 cm bump 0.2 m ahead lifts the wheel before it gets there, less than the bump
        let mut bump = flat.clone();
        for (k, z) in zs.iter().enumerate() {
            if (z - 0.2).abs() < 0.05 {
                bump.h[k] = 0.1;
            }
        }
        let lift = support_under(0.6, &bump, &s);
        assert!(lift > 0.0 && lift < 0.1, "{lift}");
        assert!((wheel_angle(2.0 * std::f64::consts::PI * 0.4, 0.4) - 2.0 * std::f64::consts::PI).abs() < 1e-12);
    }
}
