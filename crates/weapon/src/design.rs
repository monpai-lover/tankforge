//! Gun and shell properties derived from two player choices -- calibre and barrel length --
//! plus the crew-loading model. Everything a workshop-built gun needs comes from these
//! formulas, so a player can only trade one property against another, never type in a number.
//! (client/web/src/sim/design.js mirrors this file until the WASM build replaces it.)
use crate::{CurvePoint, GunDef, ProjectileDef, ProjectileKind};
use tg_shared::Vec3;

const AIR_RHO: f32 = 1.225;
pub const DEMARRE_K: f32 = 2050.0;
pub const SHELL_DRAG: f32 = 0.4;

/// Full-calibre AP shot mass grows with the cube of the calibre. 75 mm -> 6.6 kg, 88 mm -> 10.6 kg.
pub fn shell_mass_kg(cal_mm: f32) -> f32 {
    15.6 * (cal_mm / 100.0).powi(3)
}

/// Muzzle velocity from barrel length in calibres. L/24 -> 516, L/48 -> 732, L/70 -> 930 m/s.
pub fn muzzle_velocity(len_cal: f32) -> f32 {
    (300.0 + 9.0 * len_cal).clamp(350.0, 1150.0)
}

/// Gun mass in kg. 88 mm L/56 -> ~1060, 37 mm L/45 -> ~150.
pub fn gun_mass_kg(cal_mm: f32, len_cal: f32) -> f32 {
    0.003 * cal_mm * cal_mm * len_cal.powf(0.95)
}

pub fn dispersion_mrad(len_cal: f32) -> f32 {
    (2.2 - len_cal * 0.022).clamp(0.5, 2.2)
}

pub fn recoil_mm(cal_mm: f32) -> f32 {
    250.0 + cal_mm * 2.2
}

/// De Marre penetration of homogeneous plate at 0 degrees, mm.
pub fn demarre_mm(velocity: f32, mass_kg: f32, cal_mm: f32, k: f32) -> f32 {
    let d_dm = cal_mm / 100.0;
    ((velocity * mass_kg.sqrt()) / (k * d_dm.powf(0.75))).powf(1.0 / 0.7) * 100.0
}

/// Time for one loader to handle one round at the breech (unstow, lift, ram), seconds.
pub fn handling_time(shell_kg: f32) -> f32 {
    1.6 + 0.22 * shell_kg + 0.012 * shell_kg * shell_kg
}

/// Time to carry a round over `distance` metres inside the vehicle; heavier rounds move slower.
pub fn carry_time(distance: f32, shell_kg: f32) -> f32 {
    distance * (1.0 + shell_kg / 20.0) / 1.6
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct ReloadBreakdown {
    pub distance: f32,
    pub handling: f32,
    pub carry: f32,
    pub total: f32,
}

/// Reload time for one round: loader station -> ammo rack -> breech.
pub fn layout_reload_time(shell_kg: f32, loader: Vec3, rack: Vec3, breech: Vec3) -> ReloadBreakdown {
    let distance = (rack - loader).length() + (breech - rack).length();
    let handling = handling_time(shell_kg);
    let carry = carry_time(distance, shell_kg);
    ReloadBreakdown { distance, handling, carry, total: handling + carry }
}

/// Turret traverse rate (deg/s) from ring diameter and the mass of the guns it carries.
pub fn traverse_rate(ring_m: f32, guns_mass_kg: f32) -> f32 {
    (42.0 - ring_m * 10.0 - guns_mass_kg / 150.0).clamp(5.0, 40.0)
}

pub fn turret_mass_kg(ring_m: f32, guns_mass_kg: f32) -> f32 {
    2200.0 * ring_m * ring_m + guns_mass_kg
}

fn round_to(x: f32, step: f32) -> f32 {
    (x / step).round() * step
}

/// Complete gun and shell definitions (project data format) for a workshop gun.
pub fn design_gun(cal_mm: f32, len_cal: f32) -> (GunDef, ProjectileDef) {
    let cal = cal_mm.round();
    let len = len_cal.round();
    let mass = shell_mass_kg(cal);
    let v0 = muzzle_velocity(len);
    let area = std::f32::consts::PI * (cal * 0.0005).powi(2);
    let kk = 0.5 * AIR_RHO * SHELL_DRAG * area / mass;
    let curve = [0.0f32, 100.0, 500.0, 1000.0, 1500.0, 2000.0, 2500.0]
        .iter()
        .map(|d| CurvePoint { distance_m: *d, pen_mm: round_to(demarre_mm(v0 * (-kk * d).exp(), mass, cal, DEMARRE_K), 0.1) })
        .collect();
    let id = format!("custom_{}_l{}", cal as i32, len as i32);
    let shell = ProjectileDef {
        id: format!("ap_{}", id),
        name: format!("{} mm AP（L/{}）", cal as i32, len as i32),
        kind: ProjectileKind::Ap,
        caliber_mm: cal,
        mass_kg: round_to(mass, 0.01),
        muzzle_velocity_ms: v0.round(),
        explosive_mass_kg: 0.0,
        explosive_type: "none".into(),
        penetrator_material: "steel".into(),
        length_mm: (cal * 3.7).round(),
        drag_coefficient: SHELL_DRAG,
        penetration_curve: curve,
        ricochet_angle_deg: 68.0,
        normalization_deg: 4.0,
        shatter_angle_deg: 90.0,
        fuse_delay_s: 0.0,
        fuse_sensitivity_mm: 0.0,
    };
    let gun_mass = gun_mass_kg(cal, len);
    let handling = handling_time(mass);
    let gun = GunDef {
        id: format!("gun_{}", id),
        caliber_mm: cal,
        barrel_length_mm: cal * len,
        recoil_mm: recoil_mm(cal).round(),
        rounds_per_min: round_to(60.0 / handling, 0.1),
        reload_s: round_to(handling, 0.1),
        traverse_deg_s: 20.0,
        elevate_deg_s: round_to((16.0 - gun_mass / 200.0).clamp(3.0, 14.0), 0.1),
        max_depression_deg: 8.0,
        max_elevation_deg: 20.0,
        dispersion_mrad: round_to(dispersion_mrad(len), 0.01),
        mass_kg: gun_mass.round(),
        ammo: vec![shell.id.clone()],
        ammo_count: Vec::new(),
        autocannon: None,
    };
    (gun, shell)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn derived_values_land_near_historical_guns() {
        assert!((shell_mass_kg(75.0) - 6.58).abs() < 0.05);
        assert!((shell_mass_kg(88.0) - 10.63).abs() < 0.05);
        assert_eq!(muzzle_velocity(56.0), 804.0);
        assert_eq!(muzzle_velocity(10.0), 390.0);
        assert_eq!(muzzle_velocity(200.0), 1150.0);
        let m = gun_mass_kg(88.0, 56.0);
        assert!(m > 900.0 && m < 1300.0, "{m}");
    }

    #[test]
    fn layout_reload_matches_a_heavy_tank_layout() {
        // loader in the turret, rack in the hull side, breech on the centre line: ~7.5 s for a 10.2 kg round
        let r = layout_reload_time(10.2, Vec3::new(0.5, 2.0, -0.1), Vec3::new(1.25, 1.38, 0.2), Vec3::new(0.0, 2.18, 0.6));
        assert!((r.total - 7.5).abs() < 0.2, "{:?}", r);
        assert!((r.handling - 5.09).abs() < 0.02);
        // a rack further away, or a heavier shell, is slower
        let far = layout_reload_time(10.2, Vec3::new(0.5, 2.0, -0.1), Vec3::new(1.25, 0.5, -2.0), Vec3::new(0.0, 2.18, 0.6));
        assert!(far.total > r.total + 1.0);
        assert!(handling_time(25.0) > 2.0 * handling_time(10.2));
    }

    #[test]
    fn designed_gun_is_self_consistent() {
        let (gun, shell) = design_gun(88.0, 56.0);
        assert_eq!(gun.ammo, vec![shell.id.clone()]);
        assert_eq!(gun.caliber_mm, shell.caliber_mm);
        assert_eq!(gun.barrel_length_mm, 88.0 * 56.0);
        let c = &shell.penetration_curve;
        assert!(c[0].pen_mm > 140.0 && c[0].pen_mm < 190.0, "{}", c[0].pen_mm);
        assert!(c.windows(2).all(|w| w[1].pen_mm < w[0].pen_mm && w[1].distance_m > w[0].distance_m));
        assert!(((60.0 / gun.rounds_per_min) - gun.reload_s).abs() / gun.reload_s < 0.05);
        // longer barrel: faster shell, more penetration, heavier gun
        let (long_gun, long_shell) = design_gun(88.0, 71.0);
        assert!(long_shell.muzzle_velocity_ms > shell.muzzle_velocity_ms);
        assert!(long_shell.penetration_curve[0].pen_mm > c[0].pen_mm);
        assert!(long_gun.mass_kg > gun.mass_kg);
    }

    #[test]
    fn bigger_turrets_with_heavier_guns_turn_slower() {
        assert!(traverse_rate(1.0, 150.0) > traverse_rate(1.85, 1300.0));
        assert_eq!(traverse_rate(3.0, 9000.0), 5.0);
    }
}
