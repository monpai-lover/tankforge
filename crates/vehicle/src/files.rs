//! Typed views of the per-vehicle JSON files. `deny_unknown_fields` turns typos in
//! user-authored data ("hul", "thicknes_mm") into load errors instead of silent defaults.
use serde::{Deserialize, Serialize};
use tg_weapon::GunDef;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VehicleFiles {
    pub armor: String,
    pub weapons: String,
    pub engine: String,
    pub crew: String,
    pub modules: String,
    /// Procedural exterior description (see schemas/visual.schema.json). Client-side only.
    #[serde(default)]
    pub visual: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HullDef {
    pub size_m: [f32; 3],
    pub mass_kg: f32,
    pub center_of_mass: [f32; 3],
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TurretDef {
    pub size_m: [f32; 3],
    pub ring_diameter_m: f32,
    /// Base-centre of the turret box (x, y, z) in vehicle space.
    pub position_m: [f32; 3],
    /// No roof (tank destroyers, anti-aircraft mounts): the crew is exposed from above.
    #[serde(default)]
    pub open_top: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SuspensionDef {
    pub travel_m: f32,
    /// Spring rate (N/m) and damping (N s/m) of one road-wheel station. A wheeled vehicle
    /// leaves them out and gives `suspension_freq_hz` / `suspension_damping` instead.
    #[serde(default)]
    pub stiffness: f32,
    #[serde(default)]
    pub damping: f32,
    /// torsion_bar | interleaved | christie | volute | hvss | leaf_bogie. The bogie kinds
    /// (volute, hvss, leaf_bogie) carry two neighbouring wheels on one pivoting arm.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PhysicsDef {
    pub track_width_m: f32,
    pub track_length_m: f32,
    pub suspension: SuspensionDef,
    pub rolling_resistance: f32,
    /// Drive sprocket radius; converts engine torque to track force.
    #[serde(default = "d_sprocket")]
    pub sprocket_radius_m: f32,
    #[serde(default = "d_efficiency")]
    pub drivetrain_efficiency: f32,
    #[serde(default = "d_brake")]
    pub max_brake_decel_ms2: f32,
    /// Maximum yaw rate commanded by full steering input.
    #[serde(default = "d_turn")]
    pub max_turn_rate_deg_s: f32,
    #[serde(default = "d_reverse")]
    pub max_reverse_speed_ms: f32,
    /// 0 = can neutral-steer (pivot in place). > 0 = tightest turn radius; the vehicle
    /// must be moving to turn (clutch-brake or controlled-differential steering).
    #[serde(default)]
    pub min_turn_radius_m: f32,
    /// Ride: natural frequency and damping ratio of the sprung hull (client suspension
    /// animation). Absent = the animation's defaults.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suspension_freq_hz: Option<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub suspension_damping: Option<f32>,
    /// Moments of inertia about the centre of mass along the hull axes [x (pitch), y (yaw),
    /// z (roll)], kg m^2. Absent = estimated from the hull box.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inertia_kgm2: Option<[f32; 3]>,
    /// "wheeled" for an armoured car on tyres (the running gear is axles, not tracks); absent
    /// for a tracked vehicle.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub drive: Option<String>,
    /// Wheeled: the front wheels' full lock.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max_steer_deg: Option<f32>,
}

fn d_sprocket() -> f32 { 0.35 }
fn d_efficiency() -> f32 { 0.85 }
fn d_brake() -> f32 { 6.0 }
fn d_turn() -> f32 { 45.0 }
fn d_reverse() -> f32 { 4.0 }
fn d_shift() -> f32 { 0.35 }

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VehicleMeta {
    #[serde(default)]
    pub nation: String,
    /// light | medium | heavy | td | spaa | prototype (garage grouping only).
    #[serde(default)]
    pub class: String,
    /// Year the modelled version entered service; 0 = not a historical vehicle.
    #[serde(default)]
    pub year: u32,
    /// How the exterior was made: "traced" from a general-arrangement drawing, built from
    /// published "dimensions", or an "original" design.
    #[serde(default)]
    pub outline: String,
    #[serde(default)]
    pub based_on: String,
    #[serde(default)]
    pub notes: String,
}

/// Vehicle space: +Z forward, +X right, +Y up, origin on the ground at the hull centre.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct VehicleDef {
    pub id: String,
    pub name: String,
    pub schema_version: u32,
    pub model: String,
    #[serde(default)]
    pub meta: Option<VehicleMeta>,
    pub files: VehicleFiles,
    pub hull: HullDef,
    pub turret: TurretDef,
    pub physics: PhysicsDef,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SecondaryDef {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weapon_group: Option<String>,
    /// Muzzle of a coaxial or hull gun, pivot of a roof gun; vehicle space, turret yaw 0.
    pub position_m: [f32; 3],
    /// Optional shared elevation hinge for an off-axis coax muzzle, in vehicle space.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub elevation_pivot_m: Option<[f32; 3]>,
    /// Id in `machine_guns.json`. Absent = listed for reference only, cannot be fired.
    #[serde(default)]
    pub weapon: Option<String>,
    #[serde(default)]
    pub mount: Option<MgMount>,
    /// [yaw half-angle, depression, elevation] in degrees for hull and pintle mounts.
    #[serde(default)]
    pub arc_deg: Option<[f32; 3]>,
    /// Pintle mounts: length of the post from the pivot down to the roof or ring it stands on.
    #[serde(default)]
    pub post_m: Option<f32>,
    /// Pintle mounts: a shield turning with the gun, [width, height, distance ahead of the pivot]
    /// in metres, slotted for the barrel.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shield_m: Option<[f32; 3]>,
}

/// How a machine gun is carried.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MgMount {
    /// Rigid with the main gun of the primary turret.
    Coax,
    /// Ball mount in the hull, laid by hand inside a small arc.
    Hull,
    /// On a pintle on the primary turret's roof, free traverse.
    Pintle,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SightLevel {
    pub magnification: f32,
    /// True field of view (diameter of the sight picture), degrees.
    pub fov_deg: f32,
}

/// How range is measured from this sight. Absent = crew estimation with default values.
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RangefinderDef {
    pub time_s: f32,
    /// Maximum error of a measurement, percent of the true range.
    pub error_pct: f32,
    pub max_range_m: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SightDef {
    pub name: String,
    /// Zoom levels, ascending magnification. One entry = fixed-power sight.
    pub levels: Vec<SightLevel>,
    #[serde(default)]
    pub rangefinder: Option<RangefinderDef>,
}

/// One gun and where it sits (vehicle space, turret yaw 0).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GunMount {
    pub gun: GunDef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weapon_group: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub damage: Option<tg_weapon::WeaponDamageRefs>,
    /// Trunnion (elevation pivot).
    pub mount_m: [f32; 3],
    #[serde(default)]
    pub muzzle_offset_m: Option<f32>,
    /// Ammo rack this gun is fed from. Together with the turret's `loaders_m` it makes the
    /// reload time layout-driven (see tg_weapon::design) instead of the gun's `reload_s`.
    #[serde(default)]
    pub rack_m: Option<[f32; 3]>,
}

impl GunMount {
    pub fn muzzle_offset(&self) -> f32 {
        self.muzzle_offset_m.unwrap_or(self.gun.barrel_length_mm * 0.001)
    }
}

/// An additional turret (the primary one is described by vehicle.json `turret` and the
/// top-level fields of weapons.json). Geometry is authored at yaw 0, i.e. pointing forward;
/// `facing_deg` is where it rests and the centre of its arc.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TurretMount {
    pub id: String,
    /// Ring centre (base of the turret box).
    pub position_m: [f32; 3],
    pub ring_diameter_m: f32,
    pub size_m: [f32; 3],
    pub traverse_deg_s: f32,
    #[serde(default)]
    pub facing_deg: f32,
    /// (min, max) offsets from `facing_deg`. Absent = full 360 degree traverse.
    #[serde(default)]
    pub yaw_limit_deg: Option<[f32; 2]>,
    /// Loader stations. Each loader serves one gun at a time.
    #[serde(default)]
    pub loaders_m: Vec<[f32; 3]>,
    #[serde(default)]
    pub sight: Option<SightDef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stabilizer: Option<String>,
    #[serde(default)]
    pub open_top: bool,
    pub guns: Vec<GunMount>,
    /// A turret riding on another (index into the vehicle's turrets: 0 the main one, 1.. the
    /// extra ones before this): its ring turns with that turret and `facing_deg` and
    /// `yaw_limit_deg` are measured from that turret's bearing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<usize>,
    /// How far the guns may dip at each bearing (36 entries, every 10 degrees clockwise from the
    /// turret's front; relative to the parent turret for a turret that rides on one), where the
    /// roof, the cupola or the main gun are in the way. Empty = the gun's own limit all round.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub depression_by_bearing_deg: Vec<f32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FoldDepressionStage {
    pub fold: f32,
    /// 36 bearings. Negative depression requires a positive minimum elevation.
    pub angles: Vec<f32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FoldYawLimitStage {
    pub fold: f32,
    pub limits: [f32; 2],
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WeaponsFile {
    pub main_gun: GunDef,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weapon_group: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub damage: Option<tg_weapon::WeaponDamageRefs>,
    /// Gun trunnion (elevation pivot) at turret yaw 0, vehicle space.
    pub mount_m: [f32; 3],
    /// Distance from the trunnion to the muzzle. Defaults to the full barrel length.
    #[serde(default)]
    pub muzzle_offset_m: Option<f32>,
    #[serde(default)]
    pub sight: Option<SightDef>,
    /// Gun stabilizer: none (default) | vertical | two_plane. Without one the gun is carried
    /// by the hull as it pitches and turns, and the gunner can only lay it back by hand.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub stabilizer: Option<String>,
    pub secondary: Vec<SecondaryDef>,
    /// Layout-driven reload for the main gun (see `GunMount::rack_m`).
    #[serde(default)]
    pub rack_m: Option<[f32; 3]>,
    #[serde(default)]
    pub loaders_m: Vec<[f32; 3]>,
    #[serde(default)]
    pub facing_deg: f32,
    #[serde(default)]
    pub yaw_limit_deg: Option<[f32; 2]>,
    /// How far the main gun may dip at each bearing (36 entries, every 10 degrees clockwise from
    /// the turret's front) where the engine deck or the hull's fittings are in the way. Empty =
    /// the gun's own limit all round.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub depression_by_bearing_deg: Vec<f32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub folded_depression_by_bearing_deg: Vec<f32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fold_depression_stages: Vec<FoldDepressionStage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub folded_yaw_limit_deg: Option<[f32; 2]>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub fold_yaw_limit_stages: Vec<FoldYawLimitStage>,
    /// Further guns in the primary turret.
    #[serde(default)]
    pub extra_guns: Vec<GunMount>,
    /// An active protection system (crates/missile ApsDef, plus which turret it drives and
    /// which modules are its gun and radar).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub aps: Option<serde_json::Value>,
    /// Further turrets.
    #[serde(default)]
    pub extra_turrets: Vec<TurretMount>,
}

impl WeaponsFile {
    pub fn muzzle_offset(&self) -> f32 {
        self.muzzle_offset_m.unwrap_or(self.main_gun.barrel_length_mm * 0.001)
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EngineDef {
    pub horsepower: f32,
    pub max_rpm: f32,
    pub idle_rpm: f32,
    pub weight_kg: f32,
    /// (rpm, torque) pairs, ascending rpm.
    pub torque_curve: Vec<[f32; 2]>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TransmissionDef {
    pub forward_gears: u32,
    pub reverse_gears: u32,
    pub gear_ratios: Vec<f32>,
    pub final_drive_ratio: f32,
    /// Power is cut for this long on every up-shift.
    #[serde(default = "d_shift")]
    pub shift_time_s: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EngineFile {
    pub engine: EngineDef,
    pub transmission: TransmissionDef,
}

#[cfg(test)]
mod tests {
    use super::{SecondaryDef, WeaponsFile};

    #[test]
    fn authored_weapon_damage_metadata_loads_from_an_actual_vehicle_folder() {
        let root=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/vehicles/de_hetzer");
        let dir=std::env::temp_dir().join(format!("tankforge-authored-weapon-loader-{}",std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        for file in ["vehicle.json","armor.json","crew.json","modules.json","engine.json","visual.json"] { std::fs::copy(root.join(file),dir.join(file)).unwrap(); }
        let mut w:serde_json::Value=serde_json::from_str(&std::fs::read_to_string(root.join("weapons.json")).unwrap()).unwrap();
        let damage=serde_json::json!({"critical":["breech","gun_barrel"],"traverse":[],"elevation":[],"ammo_racks":["ammo_l"]});
        w["damage"]=damage.clone();w["weapon_group"]=serde_json::json!("authored_main");
        w["main_gun"]["damage"]=damage.clone();w["main_gun"]["weapon_group"]=serde_json::json!("authored_gun");
        w["extra_guns"]=serde_json::json!([{"gun":w["main_gun"],"mount_m":w["mount_m"],"damage":damage,"weapon_group":"authored_extra"}]);
        w["secondary"][0]["weapon_group"]=serde_json::json!("authored_roof_assembly");
        std::fs::write(dir.join("weapons.json"),serde_json::to_string(&w).unwrap()).unwrap();
        let loaded=crate::load::load_vehicle(&dir).expect("typed file loading must preserve optional associations");
        let roundtrip=serde_json::to_value(loaded.weapons).unwrap();
        for path in ["damage","weapon_group"] { assert_eq!(roundtrip[path],w[path]); assert_eq!(roundtrip["main_gun"][path],w["main_gun"][path]); assert_eq!(roundtrip["extra_guns"][0][path],w["extra_guns"][0][path]); }
        assert_eq!(roundtrip["secondary"][0]["weapon_group"],"authored_roof_assembly");
    }

    #[test]
    fn fold_safe_weapon_stages_roundtrip_negative_depression_and_default_for_legacy_data() {
        let source = include_str!("../../../data/vehicles/de_hetzer/weapons.json");
        let legacy: WeaponsFile = serde_json::from_str(source).unwrap();
        assert!(legacy.fold_depression_stages.is_empty());
        assert!(legacy.fold_yaw_limit_stages.is_empty());
        assert_eq!(legacy.folded_yaw_limit_deg, None);
        let mut value: serde_json::Value = serde_json::from_str(source).unwrap();
        value["folded_depression_by_bearing_deg"] = serde_json::json!(vec![6.0; 36]);
        value["fold_depression_stages"] = serde_json::json!([
            { "fold": 0.0, "angles": vec![0.0; 36] },
            { "fold": 0.5, "angles": vec![-8.0; 36] },
            { "fold": 1.0, "angles": vec![6.0; 36] }
        ]);
        value["folded_yaw_limit_deg"] = serde_json::json!([-75.0, 75.0]);
        value["fold_yaw_limit_stages"] = serde_json::json!([
            { "fold": 0.0, "limits": [-20.0, 20.0] },
            { "fold": 1.0, "limits": [-75.0, 75.0] }
        ]);
        let weapons: WeaponsFile = serde_json::from_value(value).unwrap();
        assert_eq!(weapons.fold_depression_stages[1].angles[0], -8.0);
        assert_eq!(weapons.folded_yaw_limit_deg, Some([-75.0, 75.0]));
        let restored: WeaponsFile = serde_json::from_str(&serde_json::to_string(&weapons).unwrap()).unwrap();
        assert_eq!(restored.fold_depression_stages[1].angles[0], -8.0);
        assert_eq!(restored.fold_yaw_limit_stages[1].limits, [-75.0, 75.0]);
    }

    #[test]
    fn source_conversion_coax_hinge_survives_weapon_roundtrip() {
        let source = include_str!("../../../data/vehicles/de_hetzer_sdkfz1401/weapons.json");
        let weapons: WeaponsFile = serde_json::from_str(source).unwrap();
        let hinge = weapons.secondary[0].elevation_pivot_m.unwrap();
        for (actual, expected) in hinge.into_iter().zip([0.006439672, 2.2742, 0.13780131]) {
            assert!((actual - expected).abs() < 1e-6, "source hinge coordinates must survive f32 decoding");
        }
        let restored: WeaponsFile = serde_json::from_str(&serde_json::to_string(&weapons).unwrap()).unwrap();
        assert_eq!(restored.secondary[0].elevation_pivot_m, weapons.secondary[0].elevation_pivot_m);
    }

    #[test]
    fn legacy_secondary_without_hinge_still_loads() {
        let gun: SecondaryDef = serde_json::from_str(r#"{"id":"coax","position_m":[0,1,2]}"#).unwrap();
        assert_eq!(gun.elevation_pivot_m, None);
        assert!(!serde_json::to_value(gun).unwrap().as_object().unwrap().contains_key("elevation_pivot_m"));
    }
}
