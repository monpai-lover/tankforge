//! Deterministic wind-load damage, shared with handoff/tools/airframe_limits.js.
//! Limit values/rates are provisional game settings, distinct from sourced
//! performance references. This module never performs damage or flight calls.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub rules: Rules,
    pub aircraft: BTreeMap<String, AircraftLimits>,
}
impl Catalog {
    pub fn bundled() -> Result<Self, serde_json::Error> {
        serde_json::from_str(include_str!("../../../data/aircraft/limits.json"))
    }
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rules {
    pub structural_damage_per_second: f64,
    pub gear_damage_per_second: f64,
}
#[derive(Clone, Debug, Deserialize)]
pub struct AircraftLimits {
    pub structural: StructuralLimit,
    pub gear: GearLimit,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuralLimit {
    pub ias_kmh: f64,
    pub mach: Option<f64>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GearLimit {
    pub ias_kmh: f64,
}
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct AirframeLimitState {
    pub structure_fraction: f64,
    pub gear_fraction: f64,
    pub gear_failed: bool,
}
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Effects {
    /// Fraction of original wing HP to remove deterministically from the
    /// existing wing_l/r damage parts. No added colliders or fire rolls.
    pub structure_delta: f64,
    pub gear_failed_now: bool,
}
pub fn sound_speed(altitude: f64) -> f64 {
    (1.4 * 287.05 * (288.15 - 0.0065 * altitude.clamp(0.0, 11000.0)).max(216.65)).sqrt()
}
fn dose(ratio: f64) -> f64 {
    (ratio * ratio - 1.0).max(0.0).powi(2)
}
/// One accepted constant-state exposure interval. Called on the authority's
/// physics cadence, never from rendering. Damage/failure are monotonic until
/// the domain explicitly replaces the state after service/new life.
pub fn advance(
    state: &mut AirframeLimitState,
    limits: &AircraftLimits,
    rules: &Rules,
    telemetry: &[f32],
    dt: f64,
) -> Effects {
    let mut effects = Effects::default();
    if !dt.is_finite() || dt <= 0.0 || telemetry.len() < 34
        || ![telemetry[1], telemetry[13], telemetry[14], telemetry[33]].iter().all(|v| v.is_finite())
        || !limits.structural.ias_kmh.is_finite() || limits.structural.ias_kmh <= 0.0
        || !limits.gear.ias_kmh.is_finite() || limits.gear.ias_kmh <= 0.0
    {
        return effects;
    }
    let ias = (telemetry[14] as f64).max(0.0) * 3.6;
    let mach = (telemetry[13] as f64).max(0.0) / sound_speed(telemetry[1] as f64);
    let ratio = (ias / limits.structural.ias_kmh).max(
        limits.structural.mach.filter(|v| v.is_finite() && *v > 0.0).map_or(0.0, |v| mach / v)
    );
    let before = state.structure_fraction;
    state.structure_fraction = (before + dt * rules.structural_damage_per_second * dose(ratio)).clamp(0.0, 1.0);
    effects.structure_delta = state.structure_fraction - before;
    let exposure = (telemetry[33] as f64).clamp(0.0, 1.0);
    if !state.gear_failed && exposure > 0.02 {
        state.gear_fraction = (state.gear_fraction + dt * rules.gear_damage_per_second
            * dose(ias / limits.gear.ias_kmh) * exposure * exposure).clamp(0.0, 1.0);
        if state.gear_fraction >= 1.0 {
            state.gear_failed = true;
            effects.gear_failed_now = true;
        }
    }
    effects
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample(ias: f32, gear: f32) -> [f32; 80] {
        let mut out = [0.0; 80];out[13] = ias / 3.6;out[14] = ias / 3.6;out[33] = gear;out
    }
    #[test]
    fn partitioned_exposure_and_gear_failure_are_deterministic() {
        let catalog = Catalog::bundled().unwrap();let limits = &catalog.aircraft["p51d"];
        let s = sample(limits.structural.ias_kmh as f32 * 1.2, 0.0);
        let (mut a, mut b) = (AirframeLimitState::default(), AirframeLimitState::default());
        advance(&mut a, limits, &catalog.rules, &s, 1.0);
        for _ in 0..120 { advance(&mut b, limits, &catalog.rules, &s, 1.0/120.0); }
        assert!((a.structure_fraction-b.structure_fraction).abs()<1e-12);
        assert_eq!(a.gear_fraction,0.0);
        let before=a;advance(&mut a, limits, &catalog.rules, &sample(100.0,1.0),1.0);assert_eq!(a,before);
        let over=sample(limits.gear.ias_kmh as f32*1.5,1.0);
        let first=advance(&mut a, limits,&catalog.rules,&over,1.0);assert!(first.gear_failed_now);
        assert!(!advance(&mut a,limits,&catalog.rules,&over,1.0).gear_failed_now);
        assert!(a.gear_failed);
    }
    #[test]
    fn high_altitude_mach_and_invalid_intervals() {
        let catalog=Catalog::bundled().unwrap();let limits=&catalog.aircraft["f15c"];
        let mut s=sample(700.0,0.0);s[1]=15000.0;s[13]=(sound_speed(15000.0)*limits.structural.mach.unwrap()*1.1) as f32;
        let mut state=AirframeLimitState::default();assert!(advance(&mut state,limits,&catalog.rules,&s,0.1).structure_delta>0.0);
        let before=state;advance(&mut state,limits,&catalog.rules,&s,f64::NAN);assert_eq!(state,before);
    }
}
