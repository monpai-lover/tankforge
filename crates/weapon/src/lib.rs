//! Projectile and gun definitions, plus the gun-handling logic that depends only on them:
//! turret/gun aiming (`turret`) and fire control (`fire`).
use serde::{Deserialize, Serialize};

pub mod design;
pub mod fire;
pub mod loading;
pub mod mg;
pub mod turret;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProjectileKind {
    Ap,
    Aphe,
    Apcbc,
    Apcr,
    Apds,
    Apfsds,
    He,
    Heat,
    HeatFs,
    Hesh,
    Smoke,
}

impl ProjectileKind {
    /// Shaped-charge rounds: penetration independent of velocity, no normalization.
    pub fn is_chemical(self) -> bool {
        matches!(self, ProjectileKind::Heat | ProjectileKind::HeatFs)
    }
    pub fn is_kinetic(self) -> bool {
        matches!(
            self,
            ProjectileKind::Ap | ProjectileKind::Aphe | ProjectileKind::Apcbc
                | ProjectileKind::Apcr | ProjectileKind::Apds | ProjectileKind::Apfsds
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct CurvePoint {
    pub distance_m: f32,
    pub pen_mm: f32,
}

fn default_shatter() -> f32 {
    90.0
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ProjectileDef {
    pub id: String,
    pub name: String,
    pub kind: ProjectileKind,
    pub caliber_mm: f32,
    pub mass_kg: f32,
    pub muzzle_velocity_ms: f32,
    pub explosive_mass_kg: f32,
    pub explosive_type: String,
    pub penetrator_material: String,
    pub length_mm: f32,
    pub drag_coefficient: f32,
    /// Penetration of RHA at 0 degrees vs distance, ascending by distance.
    pub penetration_curve: Vec<CurvePoint>,
    pub ricochet_angle_deg: f32,
    /// Degrees by which a kinetic round turns toward the plate normal on impact.
    #[serde(default)]
    pub normalization_deg: f32,
    /// Brittle rounds shatter on hard plates at or above this angle. 90 = never.
    #[serde(default = "default_shatter")]
    pub shatter_angle_deg: f32,
    pub fuse_delay_s: f32,
    pub fuse_sensitivity_mm: f32,
}

impl ProjectileDef {
    /// Linear interpolation of the penetration curve; clamped at both ends.
    pub fn pen_at(&self, distance_m: f32) -> f32 {
        let c = &self.penetration_curve;
        if c.is_empty() {
            return 0.0;
        }
        if distance_m <= c[0].distance_m {
            return c[0].pen_mm;
        }
        for w in c.windows(2) {
            if distance_m <= w[1].distance_m {
                let span = (w[1].distance_m - w[0].distance_m).max(1e-6);
                let k = (distance_m - w[0].distance_m) / span;
                return w[0].pen_mm + (w[1].pen_mm - w[0].pen_mm) * k;
            }
        }
        c[c.len() - 1].pen_mm
    }

    /// Convenience constructor for tests and tooling: a flat-curve AP round.
    pub fn generic_ap(caliber_mm: f32, pen_mm: f32) -> Self {
        ProjectileDef {
            id: "generic_ap".into(),
            name: "Generic AP".into(),
            kind: ProjectileKind::Ap,
            caliber_mm,
            mass_kg: 6.8,
            muzzle_velocity_ms: 800.0,
            explosive_mass_kg: 0.0,
            explosive_type: "none".into(),
            penetrator_material: "steel".into(),
            length_mm: 300.0,
            drag_coefficient: 0.3,
            penetration_curve: vec![CurvePoint { distance_m: 0.0, pen_mm }],
            ricochet_angle_deg: 68.0,
            normalization_deg: 5.0,
            shatter_angle_deg: 90.0,
            fuse_delay_s: 0.0,
            fuse_sensitivity_mm: 0.0,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GunDef {
    pub id: String,
    pub caliber_mm: f32,
    pub barrel_length_mm: f32,
    pub recoil_mm: f32,
    pub rounds_per_min: f32,
    pub reload_s: f32,
    pub traverse_deg_s: f32,
    pub elevate_deg_s: f32,
    pub max_depression_deg: f32,
    pub max_elevation_deg: f32,
    pub dispersion_mrad: f32,
    pub mass_kg: f32,
    pub ammo: Vec<String>,
    /// Rounds carried of each entry of `ammo` (same order); empty = not stated.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub ammo_count: Vec<u32>,
    /// An automatic gun fed from a belt or magazine: fires while the trigger is held.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub autocannon: Option<AutocannonDef>,
    /// Flight definition for a missile/rocket launcher; absent for a conventional cannon.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub missile: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weapon_group: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub damage: Option<WeaponDamageRefs>,
}

/// Explicit authored damage dependencies. Empty laying/feed lists clear those dependencies;
/// an explicit critical list must identify at least one physical firing part.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WeaponDamageRefs {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub critical: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub traverse: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub elevation: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ammo_racks: Option<Vec<String>>,
}

/// The feed of an automatic gun: cyclic rate, rounds per belt (or magazine), time to change it,
/// and for a rotary gun the time the barrel cluster takes to come up to speed.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct AutocannonDef {
    pub rate_rpm: f32,
    pub belt_rounds: u32,
    pub belt_reload_s: f32,
    #[serde(default)]
    pub spin_up_s: f32,
}

impl AutocannonDef {
    /// Seconds between rounds once up to speed.
    pub fn interval_s(&self) -> f32 {
        60.0 / self.rate_rpm.max(1.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn curve_interpolates_and_clamps() {
        let mut p = ProjectileDef::generic_ap(75.0, 150.0);
        p.penetration_curve = vec![
            CurvePoint { distance_m: 0.0, pen_mm: 150.0 },
            CurvePoint { distance_m: 1000.0, pen_mm: 100.0 },
        ];
        assert_eq!(p.pen_at(-5.0), 150.0);
        assert!((p.pen_at(500.0) - 125.0).abs() < 1e-3);
        assert_eq!(p.pen_at(5000.0), 100.0);
    }
}
