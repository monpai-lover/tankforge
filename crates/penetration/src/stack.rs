//! Layered armour: a round meets several plates in a row (add-on plate, air gap, skirt,
//! composite, main plate...). Each plate eats part of the remaining penetration; the round
//! stops in the first plate it cannot beat. Same per-plate rules as [`crate::resolve`]:
//! overmatch, ricochet, shatter, normalization, LOS x material factor.
use crate::PenetrationResult;
use serde::{Deserialize, Serialize};
use tg_armor::Material;
use tg_weapon::ProjectileDef;

/// One plate on the shot line, in the order the round meets it.
#[derive(Clone, Debug)]
pub struct PlateCrossing<'a> {
    pub material: &'a Material,
    /// Nominal plate thickness (normal to the plate).
    pub thickness_mm: f32,
    /// Geometric length of the shot line inside the plate. Shorter than thickness/cos when the
    /// line only clips a corner.
    pub path_mm: f32,
    /// Angle between the shot line and the plate normal.
    pub incidence_deg: f32,
    /// Air between the previous plate (or the muzzle, for the first one) and this plate.
    pub gap_before_mm: f32,
}

#[derive(Clone, Copy, Debug)]
pub struct StackParams {
    /// Shaped-charge jet loss per mm of air gap after the first plate.
    pub heat_gap_loss_per_mm: f32,
    pub heat_gap_max_loss: f32,
}

impl Default for StackParams {
    fn default() -> Self {
        Self { heat_gap_loss_per_mm: 0.0009, heat_gap_max_loss: 0.6 }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LayerOutcome {
    Passed,
    Stopped,
    Ricochet,
    Shattered,
    /// Not reached: the round stopped or bounced earlier.
    NotReached,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct LayerResult {
    pub index: usize,
    pub incidence_deg: f32,
    pub effective_angle_deg: f32,
    /// Effective line-of-sight thickness after normalization.
    pub los_mm: f32,
    pub required_mm: f32,
    pub pen_before_mm: f32,
    pub pen_after_mm: f32,
    pub overmatch: bool,
    pub outcome: LayerOutcome,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StackReport {
    pub penetration_mm: f32,
    pub total_required_mm: f32,
    pub layers: Vec<LayerResult>,
    pub result: PenetrationResult,
    /// Index of the plate where the round stopped / bounced, if it did.
    pub stopped_at: Option<usize>,
}

/// Walks the plates with `pen_mm` of penetration (nominal, or a server-side roll).
pub fn resolve_stack(p: &ProjectileDef, plates: &[PlateCrossing], pen_mm: f32, sp: &StackParams) -> StackReport {
    let chemical = p.kind.is_chemical();
    let mut pen = pen_mm.max(0.0);
    let mut layers = Vec::with_capacity(plates.len());
    let mut total = 0.0;
    let mut stopped_at = None;
    let mut result = None;
    let mut first = true;
    for (i, pl) in plates.iter().enumerate() {
        if result.is_some() {
            layers.push(LayerResult { index: i, incidence_deg: pl.incidence_deg, effective_angle_deg: 0.0, los_mm: 0.0, required_mm: 0.0, pen_before_mm: 0.0, pen_after_mm: 0.0, overmatch: false, outcome: LayerOutcome::NotReached });
            continue;
        }
        // a shaped-charge jet spreads out over every gap after it formed on the first plate
        if chemical && !first && pl.gap_before_mm > 0.0 {
            pen *= 1.0 - (pl.gap_before_mm * sp.heat_gap_loss_per_mm).min(sp.heat_gap_max_loss);
        }
        // a new impact (first plate, or after an air gap) can bounce or break the round
        let fresh = first || pl.gap_before_mm > 5.0;
        first = false;
        let overmatch = !chemical && p.caliber_mm >= 3.0 * pl.thickness_mm;
        let eff = if chemical { pl.incidence_deg } else { (pl.incidence_deg - p.normalization_deg).max(0.0) };
        let nominal_los = pl.thickness_mm / eff.to_radians().cos().max(0.05);
        let los = nominal_los.min(pl.path_mm.max(0.0)).max(0.0);
        let factor = if chemical { pl.material.chemical_factor } else { pl.material.kinetic_factor };
        let required = los * factor;
        total += required;
        let before = pen;
        let mut lr = LayerResult { index: i, incidence_deg: pl.incidence_deg, effective_angle_deg: eff, los_mm: los, required_mm: required, pen_before_mm: before, pen_after_mm: before, overmatch, outcome: LayerOutcome::Passed };
        if fresh && !overmatch && pl.incidence_deg >= p.ricochet_angle_deg {
            lr.outcome = LayerOutcome::Ricochet;
            result = Some(PenetrationResult::Ricochet);
        } else if fresh && !chemical && pl.incidence_deg >= p.shatter_angle_deg && pl.material.hardness_bhn >= 350.0 {
            lr.outcome = LayerOutcome::Shattered;
            result = Some(PenetrationResult::Shattered);
        } else if pen >= required {
            pen -= required;
            lr.pen_after_mm = pen;
        } else {
            lr.outcome = LayerOutcome::Stopped;
            lr.pen_after_mm = 0.0;
            result = Some(PenetrationResult::Stopped);
        }
        if result.is_some() {
            stopped_at = Some(i);
        }
        layers.push(lr);
    }
    let result = result.unwrap_or_else(|| {
        let used = (pen_mm - pen).max(0.0);
        let ratio = if pen_mm > 0.0 { used / pen_mm } else { 1.0 };
        PenetrationResult::Penetrated { residual_mm: pen, speed_fraction: (1.0 - ratio * ratio).max(0.0).sqrt() }
    });
    StackReport { penetration_mm: pen_mm, total_required_mm: total, layers, result, stopped_at }
}

/// Smallest penetration that defeats the whole stack, or None when the round bounces or
/// shatters whatever its penetration (those depend on angle only).
pub fn min_pen_to_defeat(p: &ProjectileDef, plates: &[PlateCrossing], sp: &StackParams) -> Option<f32> {
    let probe = resolve_stack(p, plates, 1.0e6, sp);
    match probe.result {
        PenetrationResult::Ricochet | PenetrationResult::Shattered => return None,
        _ => {}
    }
    let (mut lo, mut hi) = (0.0f32, probe.total_required_mm.max(1.0) * 2.0 + 10.0);
    while !matches!(resolve_stack(p, plates, hi, sp).result, PenetrationResult::Penetrated { .. }) {
        hi *= 2.0;
        if hi > 1.0e7 {
            return None;
        }
    }
    for _ in 0..40 {
        let mid = 0.5 * (lo + hi);
        if matches!(resolve_stack(p, plates, mid, sp).result, PenetrationResult::Penetrated { .. }) {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    Some(hi)
}

/// Standard normal CDF.
pub fn normal_cdf(x: f32) -> f32 {
    // Abramowitz-Stegun 7.1.26 on erf
    let z = (x as f64) / std::f64::consts::SQRT_2;
    let t = 1.0 / (1.0 + 0.3275911 * z.abs());
    let y = 1.0 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * (-z * z).exp();
    let erf = if z >= 0.0 { y } else { -y };
    (0.5 * (1.0 + erf)) as f32
}

/// Probability that a round with nominal penetration `pen_mm` (std dev `sigma_fraction` of it)
/// defeats the stack.
pub fn penetration_probability(p: &ProjectileDef, plates: &[PlateCrossing], pen_mm: f32, sigma_fraction: f32, sp: &StackParams) -> f32 {
    match min_pen_to_defeat(p, plates, sp) {
        None => 0.0,
        Some(need) => {
            let sigma = (pen_mm * sigma_fraction).max(1e-3);
            1.0 - normal_cdf((need - pen_mm) / sigma)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tg_armor::ArmorKind;
    use tg_weapon::ProjectileKind;

    fn mat(id: &str, k: f32, c: f32) -> Material {
        Material { id: id.into(), kind: ArmorKind::Rha, density_kg_m3: 7850.0, hardness_bhn: 300.0, kinetic_factor: k, chemical_factor: c }
    }

    fn plate(m: &Material, t: f32, inc: f32, gap: f32) -> PlateCrossing<'_> {
        PlateCrossing { material: m, thickness_mm: t, path_mm: t / inc.to_radians().cos(), incidence_deg: inc, gap_before_mm: gap }
    }

    #[test]
    fn layers_are_beaten_in_order_and_residual_shrinks() {
        let rha = mat("rha", 1.0, 1.0);
        let shell = ProjectileDef::generic_ap(75.0, 150.0);
        // 20 mm + 100 mm air + 80 mm: 100 mm of LOS in total at 0 degrees
        let plates = [plate(&rha, 20.0, 0.0, 0.0), plate(&rha, 80.0, 0.0, 100.0)];
        let r = resolve_stack(&shell, &plates, 150.0, &StackParams::default());
        assert!(matches!(r.result, PenetrationResult::Penetrated { residual_mm, .. } if (residual_mm - 50.0).abs() < 1e-3));
        assert!((r.layers[1].pen_before_mm - 130.0).abs() < 1e-3);
        let r = resolve_stack(&shell, &plates, 90.0, &StackParams::default());
        assert_eq!(r.result, PenetrationResult::Stopped);
        assert_eq!(r.stopped_at, Some(1));
        assert_eq!(r.layers[1].outcome, LayerOutcome::Stopped);
    }

    #[test]
    fn single_plate_matches_the_single_plate_engine() {
        let rha = mat("rha", 1.0, 1.0);
        let shell = ProjectileDef::generic_ap(75.0, 150.0);
        let r = resolve_stack(&shell, &[plate(&rha, 80.0, 60.0, 0.0)], 150.0, &StackParams::default());
        assert!((r.total_required_mm - 139.46).abs() < 0.1, "{}", r.total_required_mm);
    }

    #[test]
    fn heat_jet_loses_to_spaced_armour_but_kinetic_does_not() {
        let rha = mat("rha", 1.0, 1.0);
        let mut heat = ProjectileDef::generic_ap(75.0, 110.0);
        heat.kind = ProjectileKind::Heat;
        heat.normalization_deg = 0.0;
        heat.ricochet_angle_deg = 85.0;
        let solid = [plate(&rha, 10.0, 0.0, 0.0), plate(&rha, 80.0, 0.0, 0.0)];
        let spaced = [plate(&rha, 10.0, 0.0, 0.0), plate(&rha, 80.0, 0.0, 400.0)];
        let sp = StackParams::default();
        assert!(matches!(resolve_stack(&heat, &solid, 110.0, &sp).result, PenetrationResult::Penetrated { .. }));
        assert_eq!(resolve_stack(&heat, &spaced, 110.0, &sp).result, PenetrationResult::Stopped);
        let ap = ProjectileDef::generic_ap(75.0, 110.0);
        assert!(matches!(resolve_stack(&ap, &spaced, 110.0, &sp).result, PenetrationResult::Penetrated { .. }));
    }

    #[test]
    fn ricochet_only_on_fresh_impacts_and_probability_is_monotone() {
        let rha = mat("rha", 1.0, 1.0);
        let shell = ProjectileDef::generic_ap(75.0, 300.0);
        assert_eq!(resolve_stack(&shell, &[plate(&rha, 30.0, 75.0, 0.0)], 300.0, &StackParams::default()).result, PenetrationResult::Ricochet);
        assert!(min_pen_to_defeat(&shell, &[plate(&rha, 30.0, 75.0, 0.0)], &StackParams::default()).is_none());
        let plates = [plate(&rha, 100.0, 0.0, 0.0)];
        let need = min_pen_to_defeat(&shell, &plates, &StackParams::default()).unwrap();
        assert!((need - 100.0).abs() < 0.01, "{}", need);
        let sp = StackParams::default();
        let p90 = penetration_probability(&shell, &plates, 90.0, 0.06, &sp);
        let p100 = penetration_probability(&shell, &plates, 100.0, 0.06, &sp);
        let p120 = penetration_probability(&shell, &plates, 120.0, 0.06, &sp);
        assert!(p90 < 0.1 && (p100 - 0.5).abs() < 0.02 && p120 > 0.99, "{} {} {}", p90, p100, p120);
    }
}
