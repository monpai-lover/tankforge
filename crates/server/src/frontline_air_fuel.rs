//! Internal fuel duration uses 100% throttle without afterburner and the existing fuel law.
//! It never changes capacity, external tanks, consumption or flight coefficients.
use super::{fuel_flow, AirProfile};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(try_from = "u16", into = "u16")]
pub struct FuelMinutes(u16);
impl TryFrom<u16> for FuelMinutes {
    type Error = String;
    fn try_from(value: u16) -> Result<Self, Self::Error> {
        if matches!(value, 10 | 20 | 30 | 45) { Ok(Self(value)) }
        else { Err("fuel_minutes must be 10, 20, 30, 45 or null for full".into()) }
    }
}
impl From<FuelMinutes> for u16 { fn from(value: FuelMinutes) -> Self { value.0 } }

pub(super) fn target(profile: &AirProfile, minutes: Option<FuelMinutes>) -> Result<f64, String> {
    let capacity = profile.fuel.capacity;
    if !capacity.is_finite() || capacity <= 0.0 { return Err("invalid_fuel_capacity".into()); }
    let Some(minutes) = minutes else { return Ok(capacity); };
    let nominal = fuel_flow(profile, 1.0);
    if !nominal.is_finite() || nominal <= 0.0 { return Err("invalid_nominal_fuel_flow".into()); }
    Ok((f64::from(minutes.0) * 60.0 * nominal).min(capacity))
}

pub(super) fn options(profile: &AirProfile) -> Value {
    json!({"version":1,"minutes":[10,20,30,45],"capacity_kg":profile.fuel.capacity,
        "nominal_flow_kg_s":fuel_flow(profile,1.0),"reference_throttle":1.0,
        "scope":"internal_only_external_tanks_unchanged"})
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{collections::BTreeMap, path::Path};

    fn profiles() -> BTreeMap<String, AirProfile> {
        let path = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/aircraft/frontline.json");
        let source: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        serde_json::from_value(source["aircraft"].clone()).unwrap()
    }

    #[test]
    fn full_throttle_options_cover_all_28_source_aircraft() {
        let profiles = profiles();
        assert_eq!(profiles.len(), 28);
        for (id, profile) in &profiles {
            let advertised = options(profile);
            assert_eq!(advertised["reference_throttle"], json!(1.0), "{id}");
            assert_eq!(advertised["nominal_flow_kg_s"], json!(fuel_flow(profile, 1.0)), "{id}");
            assert_eq!(advertised["capacity_kg"], json!(profile.fuel.capacity), "{id}");
            assert_eq!(advertised["minutes"], json!([10, 20, 30, 45]), "{id}");
            assert_eq!(advertised["scope"], "internal_only_external_tanks_unchanged", "{id}");
            assert!(fuel_flow(profile, 1.0) > fuel_flow(profile, 0.65), "{id}");
        }
    }

    #[test]
    fn full_throttle_duration_target_clamps_to_internal_capacity_for_all_28_source_aircraft() {
        let profiles = profiles();
        assert_eq!(profiles.len(), 28);
        let mut capped = 0;
        let mut uncapped = 0;
        for (id, profile) in &profiles {
            let mut increased = false;
            let mut selections = Vec::new();
            for minutes in [10_u16, 20, 30, 45] {
                let requested = f64::from(minutes) * 60.0 * fuel_flow(profile, 1.0);
                let expected = requested.min(profile.fuel.capacity);
                let stock = target(profile, Some(FuelMinutes::try_from(minutes).unwrap())).unwrap();
                let cruise_stock = (f64::from(minutes) * 60.0 * fuel_flow(profile, 0.65)).min(profile.fuel.capacity);
                assert_eq!(stock, expected, "{id}: {minutes}");
                assert!(stock >= cruise_stock, "{id}: {minutes}");
                increased |= stock > cruise_stock;
                selections.push(json!({"minutes":minutes,"previous_kg":cruise_stock,"accepted_kg":stock}));
                if requested >= profile.fuel.capacity { capped += 1; } else { uncapped += 1; }
            }
            assert!(increased, "{id}: the same fixed duration choices must increase usable fuel before capacity caps");
            assert_eq!(target(profile, None).unwrap(), profile.fuel.capacity, "{id}: full");
            eprintln!("fuel_100_profile {}", json!({"id":id,"full_capacity_kg":profile.fuel.capacity,"selections":selections}));
        }
        assert!(capped > 0 && uncapped > 0, "exercise both capacity-bound and duration-bound selections");
    }

    #[test]
    fn full_throttle_reference_uses_piston_and_dry_jet_flow_without_entering_afterburner() {
        let profiles = profiles();
        let piston = &profiles["p51d"];
        let jet = &profiles["f86f"];
        let afterburning_jet = &profiles["f4e"];
        assert_eq!(fuel_flow(piston, 1.0), 0.1);
        assert_eq!(fuel_flow(jet, 1.0), jet.fuel.tuple[1] * f64::from(jet.physics.airframe[12]));
        for profile in [piston, jet, afterburning_jet] {
            assert_eq!(options(profile)["nominal_flow_kg_s"], json!(fuel_flow(profile, 1.0)));
            assert!((fuel_flow(profile, 0.65) / fuel_flow(profile, 1.0) - 0.65).abs() < 1e-12);
        }
        let dry = fuel_flow(afterburning_jet, 1.0);
        assert_eq!(dry, fuel_flow(afterburning_jet, 1.005));
        assert!(fuel_flow(afterburning_jet, 1.006) > dry);
        assert!(fuel_flow(afterburning_jet, 1.12) > fuel_flow(afterburning_jet, 1.006));
    }
}
