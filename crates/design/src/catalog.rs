//! Designer coefficients (`data/design_catalog.json`). Data, not code: the admin panel can
//! rebalance engines, suspensions or tracks without touching the evaluator.
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CrewCat {
    pub mass_kg: f64,
    pub seated_box_m: [f64; 3],
    pub loader_box_m: [f64; 3],
    pub hit_radius_m: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct EngineCat {
    pub label: String,
    pub kg_per_hp: f64,
    pub base_kg: f64,
    pub m3_per_hp: f64,
    pub base_m3: f64,
    pub max_rpm: f64,
    pub idle_rpm: f64,
    pub sfc_g_kwh: f64,
    pub fuel_density: f64,
    pub torque_rise: f64,
    pub min_hp: f64,
    pub max_hp: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TransmissionCat {
    pub label: String,
    pub efficiency: f64,
    pub shift_time_s: f64,
    pub kg_per_hp: f64,
    pub base_kg: f64,
    pub m3_per_hp: f64,
    pub base_m3: f64,
    pub brake_force_kn: f64,
    pub reverse_speed_ms: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SteeringCat {
    pub label: String,
    pub neutral_steer: bool,
    /// Tightest turn radius as a multiple of the track gauge (0 = pivot in place).
    pub min_radius_gauge: f64,
    pub steer_efficiency: f64,
    pub kg: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SuspensionCat {
    pub label: String,
    /// Rated load of one station (one side) per metre of road-wheel diameter.
    pub rating_kn_per_m: f64,
    pub station_kg: f64,
    pub wheel_kg_per_m2: f64,
    pub travel_m: f64,
    pub freq_hz: f64,
    pub damping: f64,
    pub rolling_resistance: f64,
    pub return_rollers: bool,
    /// Height taken from the hull floor (torsion bars run across it).
    pub floor_m: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TracksCat {
    pub kg_per_m_per_m_width: f64,
    pub min_width_m: f64,
    pub max_width_m: f64,
    pub thickness_m: f64,
    pub sprocket_radius_m: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RingCat {
    pub kg_per_m: f64,
    pub rated_kg_per_m2: f64,
    pub max_overhang: f64,
    pub drive_kg: f64,
    pub traverse_power_w_per_m: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GunCat {
    pub breech_rear_base_m: f64,
    pub breech_rear_per_mm: f64,
    pub breech_width_base_m: f64,
    pub breech_width_per_mm: f64,
    pub breech_height_base_m: f64,
    pub breech_height_per_mm: f64,
    pub min_recoil_fraction: f64,
    pub mount_kg_per_mm: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AmmoCat {
    pub case_mass_fraction: f64,
    pub round_length_cal: f64,
    pub packing: f64,
    pub rack_frame_kg_per_m3: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FuelCat {
    pub fill: f64,
    pub tank_kg_per_m3: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FixedModuleCat {
    pub size_m: [f64; 3],
    pub kg: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ModulesCat {
    pub radio: FixedModuleCat,
    pub turret_drive: FixedModuleCat,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PenCat {
    /// Standard deviation of a round's penetration, as a fraction of its nominal value.
    pub sigma_fraction: f64,
    /// Shaped-charge jet loss per mm of air gap behind the first plate it meets.
    pub heat_gap_loss_per_mm: f64,
    pub heat_gap_max_loss: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct MobilityCat {
    pub air_cd: f64,
    pub turn_mu: f64,
    pub road_rolling: f64,
    pub offroad_rolling: f64,
    pub cruise_fraction: f64,
    pub offroad_speed_fraction: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Catalog {
    pub schema_version: u32,
    #[serde(default)]
    pub notes: String,
    pub crew: CrewCat,
    pub fittings_kg_per_m3: f64,
    pub max_armor_mm: f64,
    pub engines: BTreeMap<String, EngineCat>,
    pub transmissions: BTreeMap<String, TransmissionCat>,
    pub steering: BTreeMap<String, SteeringCat>,
    pub suspensions: BTreeMap<String, SuspensionCat>,
    pub tracks: TracksCat,
    pub turret_ring: RingCat,
    pub gun: GunCat,
    pub ammo: AmmoCat,
    pub fuel: FuelCat,
    pub modules: ModulesCat,
    pub penetration: PenCat,
    pub mobility: MobilityCat,
    #[serde(default)]
    pub stabilizers: BTreeMap<String, StabilizerCat>,
}

/// Gun stabilizer: gyro and servo gear, mass grows with the gun it has to hold.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StabilizerCat {
    pub label: String,
    pub kg_base: f64,
    pub kg_per_mm: f64,
    /// Needs a powered turret drive (it traverses the turret itself).
    #[serde(default)]
    pub powered_traverse: bool,
}

impl Catalog {
    pub fn embedded() -> Catalog {
        serde_json::from_str(include_str!("../../../data/design_catalog.json")).expect("design_catalog.json")
    }
}
