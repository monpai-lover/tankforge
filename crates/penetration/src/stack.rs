//! Layered armour: a round meets several plates in a row (add-on plate, air gap, skirt,
//! composite, main plate...). Each plate eats part of the remaining penetration; the round
//! stops in the first plate it cannot beat. Same per-plate rules as [`crate::resolve`]:
//! overmatch, ricochet, shatter, normalization, LOS x material factor.
use crate::PenetrationResult;
use serde::{Deserialize, Serialize};
use tg_armor::Material;
use tg_weapon::ProjectileDef;
use crate::impact::{self, ImpactState, ImpactTransition, ImpactVerdict, DeclaredLayerContact};
use tg_shared::Vec3;

#[derive(Clone, Debug)]
pub struct LayerIdentity { pub layer_id: String, pub traversal_id: u32 }
#[derive(Clone,Debug)]
pub struct StackTraversalProgress {pub identity:LayerIdentity,pub cumulative_required_mm:f64}

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
    #[serde(default)]
    pub impacts: Vec<ImpactTransition>,
    #[serde(default)]
    pub impact_state: Option<ImpactState>,
    #[serde(default)] pub rejected_contact: bool,
}

/// Walks the plates with `pen_mm` of penetration (nominal, or a server-side roll).
pub fn resolve_stack(p: &ProjectileDef, plates: &[PlateCrossing], pen_mm: f32, sp: &StackParams) -> StackReport {
    let mut state = impact::initialize_impact(p, Vec3::new(0.0, 0.0, p.muzzle_velocity_ms), pen_mm as f64, "core").ok();
    let ids: Vec<_> = plates.iter().enumerate().map(|(i, _)| LayerIdentity { layer_id: format!("plate:{i}"), traversal_id: 0 }).collect();
    resolve_stack_inner(p, plates, pen_mm, sp, state.as_mut(), &ids,None)
}

pub fn resolve_stack_with_state(p: &ProjectileDef, plates: &[PlateCrossing], sp: &StackParams, state: &mut ImpactState, identities: &[LayerIdentity]) -> StackReport {
    resolve_stack_inner(p, plates, state.remaining_pen_mm as f32, sp, Some(state), identities,None)
}

/// Subdivision adapter: every crossing retains the complete layer's thickness,
/// path and material; progress carries the separate cumulative resistance.
pub fn resolve_stack_with_progress(p:&ProjectileDef,plates:&[PlateCrossing],sp:&StackParams,state:&mut ImpactState,progress:&[StackTraversalProgress])->Result<StackReport,impact::ImpactError>{
    if !p.kind.is_kinetic(){return Err(impact::ImpactError::InvalidInput);}
    state.validate()?;
    if progress.len()!=plates.len() || progress.iter().any(|p|!p.cumulative_required_mm.is_finite() || p.cumulative_required_mm<0.0){return Err(impact::ImpactError::InvalidTraversal);}
    let identities:Vec<_>=progress.iter().map(|p|p.identity.clone()).collect();
    let checkpoint=state.clone();
    let report=resolve_stack_inner(p,plates,state.remaining_pen_mm as f32,sp,Some(state),&identities,Some(progress));
    if report.rejected_contact {*state=checkpoint;Err(impact::ImpactError::InvalidTraversal)}else{Ok(report)}
}

fn resolve_stack_inner(p: &ProjectileDef, plates: &[PlateCrossing], pen_mm: f32, sp: &StackParams, mut state: Option<&mut ImpactState>, identities: &[LayerIdentity],progress:Option<&[StackTraversalProgress]>) -> StackReport {
    if p.kind.is_kinetic() && state.is_none(){return StackReport{penetration_mm:0.0,total_required_mm:0.0,layers:vec![],result:PenetrationResult::Stopped,stopped_at:None,impacts:vec![],impact_state:None,rejected_contact:true};}
    let chemical = p.kind.is_chemical();
    let initial_energy = state.as_ref().map(|s| s.energy_j()).unwrap_or(0.0);
    let mut impacts = Vec::new();
    let mut rejected_contact=false;
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
        if [pl.thickness_mm,pl.path_mm,pl.incidence_deg,pl.gap_before_mm,pl.material.kinetic_factor,pl.material.density_kg_m3,pl.material.hardness_bhn].iter().any(|v|!v.is_finite() || *v<0.0)
            || [p.normalization_deg,p.ricochet_angle_deg,p.shatter_angle_deg].iter().any(|v|!v.is_finite()) {
            rejected_contact=true;stopped_at=Some(i);result=Some(PenetrationResult::Stopped);
            layers.push(LayerResult{index:i,incidence_deg:0.0,effective_angle_deg:0.0,los_mm:0.0,required_mm:0.0,pen_before_mm:pen,pen_after_mm:pen,overmatch:false,outcome:LayerOutcome::Stopped});
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
        let full_required = los * factor;
        let required=progress.map(|values|values[i].cumulative_required_mm as f32).unwrap_or(full_required);
        let identity=identities.get(i).cloned().unwrap_or(LayerIdentity{layer_id:format!("plate:{i}"),traversal_id:0});
        let cursor=state.as_ref().and_then(|s|s.traversal.as_ref()).filter(|c|c.layer_id==identity.layer_id && c.traversal_id==identity.traversal_id);
        let available=cursor.map(|c|c.entry.remaining_pen_mm as f32).unwrap_or(pen);
        let entry_energy=cursor.map(|c|c.entry.energy_j()).unwrap_or_else(||state.as_ref().map(|s|s.energy_j()).unwrap_or(0.0));
        total += required-cursor.map(|c|c.cumulative_required_mm as f32).unwrap_or(0.0);
        let before = pen;
        let mut lr = LayerResult { index: i, incidence_deg: pl.incidence_deg, effective_angle_deg: eff, los_mm: los, required_mm: required, pen_before_mm: before, pen_after_mm: before, overmatch, outcome: LayerOutcome::Passed };
        if [pl.thickness_mm,pl.path_mm,pl.incidence_deg,pl.gap_before_mm,p.normalization_deg,p.ricochet_angle_deg,p.shatter_angle_deg].iter().any(|v|!v.is_finite()) || pl.path_mm<0.0 || !required.is_finite() || required<0.0 || required>full_required+1e-5 {
            rejected_contact=true;lr.outcome=LayerOutcome::Stopped;result=Some(PenetrationResult::Stopped);
        }else if fresh && !overmatch && pl.incidence_deg >= p.ricochet_angle_deg {
            lr.outcome = LayerOutcome::Ricochet;
            result = Some(PenetrationResult::Ricochet);
        } else if fresh && !chemical && pl.incidence_deg >= p.shatter_angle_deg && pl.material.hardness_bhn >= 350.0 {
            lr.outcome = LayerOutcome::Shattered;
            result = Some(PenetrationResult::Shattered);
        } else if p.kind.is_kinetic() && entry_energy==0.0 && required>0.0 {
            lr.outcome=LayerOutcome::Stopped;lr.pen_after_mm=0.0;result=Some(PenetrationResult::Stopped);
        } else if available >= required {
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
        if p.kind.is_kinetic() {
            if let Some(s) = state.as_mut() {
                if i>0 {s.advance_time(pl.gap_before_mm.max(0.0) as f64*0.001);}
                if rejected_contact {layers.push(lr);stopped_at=Some(i);break;}
                let id = identity;
                let verdict = match lr.outcome { LayerOutcome::Passed => ImpactVerdict::Passed, LayerOutcome::Ricochet => ImpactVerdict::Ricochet, LayerOutcome::Shattered => ImpactVerdict::Shattered, _ => ImpactVerdict::Stopped };
                match impact::advance_kinetic_layer(s, &DeclaredLayerContact { layer_id: id.layer_id, traversal_id: id.traversal_id,
                    cumulative_required_mm: required as f64, thickness_mm: pl.thickness_mm as f64, density_kg_m3: pl.material.density_kg_m3 as f64, verdict, emit_spall: p.caliber_mm >= 20.0 }) {
                    Ok(tr) => { pen = s.remaining_pen_mm as f32; lr.pen_after_mm = pen; impacts.push(tr); }
                    Err(_) => { rejected_contact=true;lr.outcome = LayerOutcome::Stopped; lr.pen_after_mm = 0.0; pen = 0.0; result = Some(PenetrationResult::Stopped); stopped_at = Some(i); }
                }
            }
        }
        layers.push(lr);
    }
    let result = result.unwrap_or_else(|| {
        let speed_fraction = if p.kind.is_kinetic() {
            if initial_energy > 0.0 { state.as_ref().map(|s| (s.energy_j()/initial_energy).sqrt() as f32).unwrap_or(0.0) } else { 0.0 }
        } else {
            // Explicitly legacy chemical adapter until P3 owns jet energy.
            let ratio = if pen_mm > 0.0 { (pen_mm-pen).max(0.0)/pen_mm } else { 1.0 };
            (1.0-ratio*ratio).max(0.0).sqrt()
        };
        PenetrationResult::Penetrated { residual_mm: pen, speed_fraction }
    });
    StackReport { penetration_mm: pen_mm, total_required_mm: total, layers, result, stopped_at, impacts,
        impact_state: if p.kind.is_kinetic() { state.map(|s| s.clone()) } else { None },rejected_contact }
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
    fn two_physical_plates_use_the_same_energy_law_as_two_single_contacts() {
        let rha = mat("rha", 1.0, 1.0);
        let mut shell = ProjectileDef::generic_ap(10.0, 150.0);
        shell.normalization_deg = 0.0;
        let r = resolve_stack(&shell, &[plate(&rha, 50.0, 0.0, 0.0), plate(&rha, 50.0, 0.0, 100.0)], 150.0, &StackParams::default());
        let fraction = match r.result { PenetrationResult::Penetrated { speed_fraction, .. } => speed_fraction, _ => panic!("passed") };
        // Existing combat multiplies the two single-contact speed fractions:
        // E1/E0=8/9; E2/E1=3/4. The old stack recomputed from total penetration used.
        assert!((fraction * fraction - 2.0 / 3.0).abs() < 1e-6, "two-layer KE/E0={}", fraction * fraction);
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
