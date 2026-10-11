//! PenetrationEngine: one plate, one projectile, one impact -> one verdict.
//! Pure function of data; no world access, so it is trivially unit-testable.
use serde::{Deserialize, Serialize};
use tg_armor::{los_thickness_mm, ArmorPlate, Material};
use tg_weapon::ProjectileDef;

pub mod stack;
pub mod impact;
#[cfg(test)]
mod impact_tests;

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
    #[serde(default)] pub rejected_input: bool,
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
    if p.kind.is_kinetic() {
        if let Ok(mut state) = impact::initialize_impact(p, tg_shared::Vec3::new(0.0, 0.0, p.muzzle_velocity_ms), p.pen_at(ctx.distance_m) as f64, "core") {
            if let Ok((report, _)) = resolve_with_state(p, plate, mat, ctx, &mut state, &plate.id, 0) { return report; }
        }
        return PenetrationReport{rejected_input:true,incidence_deg:0.0,effective_angle_deg:0.0,los_mm:0.0,required_mm:0.0,penetration_mm:0.0,overmatch:false,result:PenetrationResult::Stopped};
    }
    resolve_verdict(p, plate, mat, ctx, p.pen_at(ctx.distance_m))
}

/// Stateful kinetic adapter. Declared layer/traversal identity comes from geometry,
/// not the RNG seed or a triangle index. Legacy chemical verdicts remain P3.
pub fn resolve_with_state(p: &ProjectileDef, plate: &ArmorPlate, mat: &Material, ctx: ImpactContext, state: &mut impact::ImpactState, layer_id: &str, traversal_id: u32) -> Result<(PenetrationReport, impact::ImpactTransition), impact::ImpactError> {
    let full=resolve_verdict(p,plate,mat,ctx,state.remaining_pen_mm as f32);
    resolve_with_state_progress(p,plate,mat,ctx,state,&LayerProgress{layer_id,traversal_id,cumulative_required_mm:full.required_mm as f64})
}

/// Fixed complete physical-layer geometry plus independent cumulative progress.
/// Geometry subdivision must advance this resistance cursor, never resize the
/// plate or assign a fresh identity for a triangle/primitive/substep.
pub struct LayerProgress<'a> {pub layer_id:&'a str,pub traversal_id:u32,pub cumulative_required_mm:f64}
pub fn validate_kinetic_contact(p:&ProjectileDef,thickness_mm:f32,mat:&Material,ctx:ImpactContext)->Result<(),impact::ImpactError>{
    if !p.kind.is_kinetic() || [ctx.incidence_deg,ctx.distance_m,p.normalization_deg,p.ricochet_angle_deg,p.shatter_angle_deg].iter().any(|v|!v.is_finite()) || ctx.incidence_deg<0.0 || ctx.distance_m<0.0
        || [thickness_mm,mat.kinetic_factor,mat.density_kg_m3,mat.hardness_bhn].iter().any(|v|!v.is_finite() || *v<0.0){return Err(impact::ImpactError::InvalidInput);}
    Ok(())
}
pub fn resolve_with_state_progress(p:&ProjectileDef,plate:&ArmorPlate,mat:&Material,ctx:ImpactContext,state:&mut impact::ImpactState,progress:&LayerProgress<'_>)->Result<(PenetrationReport,impact::ImpactTransition),impact::ImpactError>{
    validate_kinetic_contact(p,plate.thickness_mm,mat,ctx)?;
    let LayerProgress{layer_id,traversal_id,cumulative_required_mm}=*progress;
    let available=state.traversal.as_ref().filter(|c|c.layer_id==layer_id && c.traversal_id==traversal_id).map(|c|c.entry.remaining_pen_mm).unwrap_or(state.remaining_pen_mm);
    let entry_energy=state.traversal.as_ref().filter(|c|c.layer_id==layer_id && c.traversal_id==traversal_id).map(|c|c.entry.energy_j()).unwrap_or(state.energy_j());
    let mut report = resolve_verdict(p, plate, mat, ctx, available as f32);
    if !report.required_mm.is_finite() || !cumulative_required_mm.is_finite() || cumulative_required_mm<0.0 || cumulative_required_mm>report.required_mm as f64+1e-5 {return Err(impact::ImpactError::InvalidTraversal);}
    report.required_mm=cumulative_required_mm as f32;
    if !matches!(report.result,PenetrationResult::Ricochet | PenetrationResult::Shattered) {
        report.result=if available>=cumulative_required_mm && (entry_energy>0.0 || cumulative_required_mm==0.0) {PenetrationResult::Penetrated{residual_mm:(available-cumulative_required_mm) as f32,speed_fraction:0.0}}else{PenetrationResult::Stopped};
    }
    let verdict = match report.result {
        PenetrationResult::Penetrated { .. } => impact::ImpactVerdict::Passed,
        PenetrationResult::Ricochet => impact::ImpactVerdict::Ricochet,
        PenetrationResult::Shattered => impact::ImpactVerdict::Shattered,
        PenetrationResult::Stopped => impact::ImpactVerdict::Stopped,
    };
    let tr = impact::advance_kinetic_layer(state, &impact::DeclaredLayerContact {
        layer_id: layer_id.into(), traversal_id, cumulative_required_mm,
        thickness_mm: plate.thickness_mm as f64, density_kg_m3: mat.density_kg_m3 as f64,
        verdict, emit_spall: p.caliber_mm >= 20.0,
    })?;
    if matches!(report.result, PenetrationResult::Penetrated { .. }) {
        report.result = PenetrationResult::Penetrated { residual_mm: state.remaining_pen_mm as f32,
            speed_fraction: if tr.entry.energy_j() > 0.0 { (tr.output.energy_j()/tr.entry.energy_j()).sqrt() as f32 } else { 0.0 } };
    }
    Ok((report, tr))
}

fn resolve_verdict(p: &ProjectileDef, plate: &ArmorPlate, mat: &Material, ctx: ImpactContext, penetration_mm: f32) -> PenetrationReport {
    let chemical = p.kind.is_chemical();
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
        rejected_input:false,
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
