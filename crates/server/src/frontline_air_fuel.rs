//! Internal fuel loading uses the existing AI cruise reference and fuel law.
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
    let cruise = fuel_flow(profile, 0.65);
    if !cruise.is_finite() || cruise <= 0.0 { return Err("invalid_nominal_fuel_flow".into()); }
    Ok((f64::from(minutes.0) * 60.0 * cruise).min(capacity))
}

pub(super) fn options(profile: &AirProfile) -> Value {
    json!({"version":1,"minutes":[10,20,30,45],"capacity_kg":profile.fuel.capacity,
        "nominal_flow_kg_s":fuel_flow(profile,0.65),"reference_throttle":0.65,
        "scope":"internal_only_external_tanks_unchanged"})
}
