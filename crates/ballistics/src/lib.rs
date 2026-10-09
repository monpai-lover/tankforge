//! External ballistics: gravity + quadratic air drag. Knows nothing about armor.
use std::f32::consts::PI;
use tg_shared::Vec3;
use tg_weapon::ProjectileDef;

#[derive(Clone, Copy, Debug)]
pub struct Atmosphere {
    pub air_density: f32,
    pub gravity: f32,
    pub wind: Vec3,
}

impl Default for Atmosphere {
    fn default() -> Self {
        Self { air_density: 1.225, gravity: 9.80665, wind: Vec3::ZERO }
    }
}

#[derive(Clone, Copy, Debug)]
pub struct BallisticState {
    pub pos: Vec3,
    pub vel: Vec3,
    pub mass_kg: f32,
    pub caliber_mm: f32,
    pub drag_coefficient: f32,
}

impl BallisticState {
    pub fn from_muzzle(pos: Vec3, dir: Vec3, def: &ProjectileDef) -> Self {
        Self {
            pos,
            vel: dir.normalized() * def.muzzle_velocity_ms,
            mass_kg: def.mass_kg,
            caliber_mm: def.caliber_mm,
            drag_coefficient: def.drag_coefficient,
        }
    }
    pub fn cross_section_m2(&self) -> f32 {
        let r = self.caliber_mm * 0.0005;
        PI * r * r
    }
    pub fn speed(&self) -> f32 {
        self.vel.length()
    }
    pub fn energy_j(&self) -> f32 {
        0.5 * self.mass_kg * self.speed().powi(2)
    }
    /// Semi-implicit Euler. Server uses a fixed small `dt` (e.g. 1 ms) plus swept
    /// segment tests, so tunnelling through thin plates is not possible.
    pub fn step(&mut self, dt: f32, atm: &Atmosphere) {
        let rel = self.vel - atm.wind;
        let k = 0.5 * atm.air_density * self.drag_coefficient * self.cross_section_m2() * rel.length() / self.mass_kg;
        let acc = rel * (-k) + Vec3::new(0.0, -atm.gravity, 0.0);
        self.vel = self.vel + acc * dt;
        self.pos = self.pos + self.vel * dt;
    }
}

/// One row of the gunner sight's distance scale.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct RangeSolution {
    pub range_m: f32,
    /// Gun elevation that hits a target at muzzle height at this range.
    pub elevation_rad: f32,
    pub tof_s: f32,
    pub speed_ms: f32,
}

/// Flies a shell fired at `elevation` until it has covered `range` metres horizontally.
/// Returns (height relative to the muzzle, time of flight, remaining speed).
pub fn fly_to(def: &ProjectileDef, elevation: f32, range: f32, dt: f32, atm: &Atmosphere) -> Option<(f32, f32, f32)> {
    let mut s = BallisticState::from_muzzle(Vec3::ZERO, Vec3::new(0.0, elevation.sin(), elevation.cos()), def);
    let mut t = 0.0f32;
    let (mut prev_z, mut prev_y) = (0.0f32, 0.0f32);
    for _ in 0..20000 {
        s.step(dt, atm);
        t += dt;
        if s.pos.z >= range {
            let f = (range - prev_z) / (s.pos.z - prev_z).max(1e-9);
            return Some((prev_y + (s.pos.y - prev_y) * f, t - dt + dt * f, s.speed()));
        }
        if s.vel.z <= 1.0 {
            break;
        }
        prev_z = s.pos.z;
        prev_y = s.pos.y;
    }
    None
}

/// Bisection for the flat-fire elevation. `None` if the range is out of reach.
pub fn elevation_for_range(def: &ProjectileDef, range: f32, atm: &Atmosphere) -> Option<RangeSolution> {
    const DT: f32 = 1.0 / 500.0;
    let (mut lo, mut hi) = (0.0f32, 0.35f32);
    let top = fly_to(def, hi, range, DT, atm)?;
    if top.0 < 0.0 {
        return None;
    }
    let (mut tof, mut speed) = (top.1, top.2);
    for _ in 0..36 {
        let mid = (lo + hi) * 0.5;
        match fly_to(def, mid, range, DT, atm) {
            Some((h, t, v)) if h >= 0.0 => {
                hi = mid;
                tof = t;
                speed = v;
            }
            _ => lo = mid,
        }
    }
    Some(RangeSolution { range_m: range, elevation_rad: hi, tof_s: tof, speed_ms: speed })
}

/// Range table for the sight graduations; stops at the first unreachable range.
pub fn range_table(def: &ProjectileDef, ranges: &[f32], atm: &Atmosphere) -> Vec<RangeSolution> {
    let mut out = Vec::with_capacity(ranges.len());
    for r in ranges {
        match elevation_for_range(def, *r, atm) {
            Some(s) => out.push(s),
            None => break,
        }
    }
    out
}

/// Elevation (rad) for an arbitrary range by linear interpolation of a range table (ascending
/// ranges); 0 at range 0, clamped to the last row beyond the table. Used for the sight setting.
pub fn elevation_at(table: &[RangeSolution], range: f32) -> f32 {
    if table.is_empty() || range <= 0.0 {
        return 0.0;
    }
    let (mut prev_r, mut prev_e) = (0.0f32, 0.0f32);
    for row in table {
        if range <= row.range_m {
            return prev_e + (row.elevation_rad - prev_e) * (range - prev_r) / (row.range_m - prev_r);
        }
        prev_r = row.range_m;
        prev_e = row.elevation_rad;
    }
    prev_e
}

#[cfg(test)]
mod tests {
    use super::*;

    fn state() -> BallisticState {
        BallisticState::from_muzzle(Vec3::ZERO, Vec3::new(0.0, 0.0, 1.0), &ProjectileDef::generic_ap(75.0, 100.0))
    }

    #[test]
    fn vacuum_drop_matches_half_g_t_squared() {
        let atm = Atmosphere { air_density: 0.0, ..Default::default() };
        let mut s = state();
        for _ in 0..1000 {
            s.step(0.001, &atm);
        }
        assert!((s.pos.y + 0.5 * 9.80665).abs() < 0.02, "drop {}", s.pos.y);
        assert!((s.vel.z - 800.0).abs() < 1e-2);
    }

    #[test]
    fn vacuum_elevation_matches_closed_form_and_drag_needs_more() {
        let def = ProjectileDef::generic_ap(75.0, 100.0);
        let vac = elevation_for_range(&def, 1000.0, &Atmosphere { air_density: 0.0, ..Default::default() }).unwrap();
        let closed = 0.5 * (9.80665f32 * 1000.0 / (800.0 * 800.0)).asin();
        assert!((vac.elevation_rad - closed).abs() < 5e-5, "{} vs {}", vac.elevation_rad, closed);
        let air = elevation_for_range(&def, 1000.0, &Atmosphere::default()).unwrap();
        assert!(air.elevation_rad > vac.elevation_rad && air.speed_ms < 800.0);
    }

    #[test]
    fn range_table_is_monotonic_and_stops_when_out_of_reach() {
        let def = ProjectileDef::generic_ap(75.0, 100.0);
        let t = range_table(&def, &[200.0, 400.0, 800.0, 1200.0, 1600.0, 2000.0], &Atmosphere::default());
        assert_eq!(t.len(), 6);
        assert!(t.windows(2).all(|w| w[1].elevation_rad > w[0].elevation_rad && w[1].tof_s > w[0].tof_s));
        let far = range_table(&def, &[1000.0, 90000.0, 2000.0], &Atmosphere::default());
        assert_eq!(far.len(), 1);
    }

    #[test]
    fn elevation_at_interpolates_the_table() {
        let row = |r: f32, e: f32| RangeSolution { range_m: r, elevation_rad: e, tof_s: 0.0, speed_ms: 0.0 };
        let t = [row(100.0, 0.001), row(200.0, 0.0021)];
        assert_eq!(elevation_at(&t, 0.0), 0.0);
        assert!((elevation_at(&t, 50.0) - 0.0005).abs() < 1e-7);
        assert!((elevation_at(&t, 150.0) - 0.00155).abs() < 1e-7);
        assert_eq!(elevation_at(&t, 900.0), 0.0021);
        assert_eq!(elevation_at(&[], 500.0), 0.0);
    }

    #[test]
    fn drag_slows_the_projectile() {
        let mut s = state();
        for _ in 0..1000 {
            s.step(0.001, &Atmosphere::default());
        }
        assert!(s.vel.z < 800.0 && s.vel.z > 400.0);
    }
}
