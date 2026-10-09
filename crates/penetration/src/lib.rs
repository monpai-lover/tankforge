//! PenetrationEngine: one plate, one projectile, one impact -> one verdict.
//! Pure function of data; no world access, so it is trivially unit-testable.
use serde::{Deserialize, Serialize};
use tg_armor::{los_thickness_mm, ArmorPlate, Material};
use tg_weapon::ProjectileDef;

pub mod stack;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "result", rename_all = "snake_case")]
pub enum PenetrationResult {
    Ricochet,
    Stopped,
    Shattered,
    Penetrated { residual_mm: f32, speed_fraction: f32 },
}

#[derive(Clone, Copy, Debug)]
pub struct ImpactContext {
    /// Angle between the shell path and the plate normal, degrees.
    pub incidence_deg: f32,
    /// Distance travelled since the muzzle, metres.
    pub distance_m: f32,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct PenetrationReport {
    pub incidence_deg: f32,
    pub effective_angle_deg: f32,
    pub los_mm: f32,
    /// LOS thickness x material factor: what the round must beat.
    pub required_mm: f32,
    pub penetration_mm: f32,
    pub overmatch: bool,
    pub result: PenetrationResult,
}

/// Rules, in order:
/// 1. Overmatch (kinetic only): caliber >= 3x plate thickness disables ricochet.
/// 2. Ricochet: raw incidence >= projectile ricochet angle.
/// 3. Shatter: brittle round vs hard plate at high angle.
/// 4. Normalization (kinetic): effective angle = incidence - normalization.
/// 5. Compare curve penetration against LOS thickness x material factor.
/// Residual penetration = pen - required; exit speed fraction = sqrt(1 - (req/pen)^2).
pub fn resolve(p: &ProjectileDef, plate: &ArmorPlate, mat: &Material, ctx: ImpactContext) -> PenetrationReport {
    let chemical = p.kind.is_chemical();
    let penetration_mm = p.pen_at(ctx.distance_m);
    let effective_angle_deg = if chemical {
        ctx.incidence_deg
    } else {
        (ctx.incidence_deg - p.normalization_deg).max(0.0)
    };
    let los_mm = los_thickness_mm(plate.thickness_mm, effective_angle_deg);
    let factor = if chemical { mat.chemical_factor } else { mat.kinetic_factor };
    let required_mm = los_mm * factor;
    let overmatch = !chemical && p.caliber_mm >= 3.0 * plate.thickness_mm;

    let result = if !overmatch && ctx.incidence_deg >= p.ricochet_angle_deg {
        PenetrationResult::Ricochet
    } else if !chemical && ctx.incidence_deg >= p.shatter_angle_deg && mat.hardness_bhn >= 350.0 {
        PenetrationResult::Shattered
    } else if penetration_mm >= required_mm {
        let ratio = if penetration_mm > 0.0 { required_mm / penetration_mm } else { 1.0 };
        PenetrationResult::Penetrated {
            residual_mm: penetration_mm - required_mm,
            speed_fraction: (1.0 - ratio * ratio).max(0.0).sqrt(),
        }
    } else {
        PenetrationResult::Stopped
    };

    PenetrationReport {
        incidence_deg: ctx.incidence_deg,
        effective_angle_deg,
        los_mm,
        required_mm,
        penetration_mm,
        overmatch,
        result,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tg_armor::{ArmorKind, ArmorZone};
    use tg_shared::Vec3;

    fn rha() -> Material {
        Material {
            id: "rha".into(),
            kind: ArmorKind::Rha,
            density_kg_m3: 7850.0,
            hardness_bhn: 300.0,
            kinetic_factor: 1.0,
            chemical_factor: 1.0,
        }
    }

    fn plate(mm: f32) -> ArmorPlate {
        ArmorPlate {
            id: "t".into(),
            zone: ArmorZone::HullSide,
            material: "rha".into(),
            thickness_mm: mm,
            center: Vec3::ZERO,
            normal: Vec3::new(0.0, 0.0, 1.0),
            axis_u: Vec3::new(1.0, 0.0, 0.0),
            half_u: 1.0,
            half_v: 1.0,
            curvature: 0.0,
            polygon: Vec::new(),
            hinge: None,
        }
    }

    fn shoot(cal: f32, pen: f32, mm: f32, angle: f32) -> PenetrationReport {
        resolve(&ProjectileDef::generic_ap(cal, pen), &plate(mm), &rha(), ImpactContext { incidence_deg: angle, distance_m: 0.0 })
    }

    #[test]
    fn rha100_pen150_at_0_penetrates() {
        assert!(matches!(shoot(75.0, 150.0, 100.0, 0.0).result, PenetrationResult::Penetrated { .. }));
    }

    #[test]
    fn rha100_pen90_at_0_is_stopped() {
        assert_eq!(shoot(75.0, 90.0, 100.0, 0.0).result, PenetrationResult::Stopped);
    }

    #[test]
    fn rha80_at_60_uses_los_with_normalization() {
        // normalization 5 deg -> 55 deg effective -> LOS ~139.5 mm
        let r = shoot(75.0, 150.0, 80.0, 60.0);
        assert!((r.los_mm - 139.46).abs() < 0.1, "los {}", r.los_mm);
        assert!(matches!(r.result, PenetrationResult::Penetrated { .. }));
        assert_eq!(shoot(75.0, 130.0, 80.0, 60.0).result, PenetrationResult::Stopped);
    }

    #[test]
    fn steep_angle_ricochets_but_overmatch_prevents_it() {
        assert_eq!(shoot(75.0, 500.0, 80.0, 70.0).result, PenetrationResult::Ricochet);
        // 150 mm shell vs 40 mm plate: overmatch, no ricochet
        let r = shoot(150.0, 500.0, 40.0, 70.0);
        assert!(r.overmatch);
        assert!(!matches!(r.result, PenetrationResult::Ricochet));
    }

    #[test]
    fn residual_speed_grows_with_margin() {
        let a = shoot(75.0, 110.0, 100.0, 0.0);
        let b = shoot(75.0, 300.0, 100.0, 0.0);
        let f = |r: PenetrationReport| match r.result {
            PenetrationResult::Penetrated { speed_fraction, .. } => speed_fraction,
            _ => panic!("expected pen"),
        };
        assert!(f(b) > f(a));
    }
}
