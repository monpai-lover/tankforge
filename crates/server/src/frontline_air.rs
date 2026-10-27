//! Aircraft in the same authoritative world as the ground companies. Motion uses the
//! delivered flight WASM; ammunition, resource loss and contacts are owned by the host.
//! Existing accepted aircraft skin/part boxes remain the contact model here.
use crate::aircraft::{AirDamage, AirData, AirType, Rng};
use crate::airframe_limits::{self, AirframeLimitState};
use crate::flight_runtime::{FlightInput, FlightModule, FlightRuntime, FlightSpawn, LandingArea};
use crate::frontline::{Team, UnitRef};
use crate::frontline_sim::{SimEvent, SimKinematics, SimWorld};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeMap, path::Path, sync::Arc, time::Instant};
use tg_physics::tank::terrain::Ground;
use tg_weapon::ProjectileDef;
#[path = "frontline_air_missiles.rs"]
pub(crate) mod guided;
#[path = "frontline_air_countermeasures.rs"]
pub(crate) mod countermeasures;

#[path = "frontline_air_pose.rs"]
mod local_pose;
pub use local_pose::AirPose;
#[path = "frontline_air_fuel.rs"]
mod fuel_load;
pub use fuel_load::FuelMinutes;

#[derive(Clone, Deserialize)]
pub struct AirProfile {
    pub metadata: Value,
    pub physics: Physics,
    pub fuel: FuelProfile,
    pub guns: Vec<GunProfile>,
    pub stores: Value,
    #[serde(default)]
    pub sensors: Value,
}
#[derive(Clone, Deserialize)]
pub struct Physics {
    pub airframe: [f32; 14],
    pub configure: [f32; 5],
    pub control: [f32; 4],
    pub envelope: [f32; 4],
    pub surfaces: Option<[f32; 17]>,
    #[serde(default, rename = "gearSequence")]
    pub gear_sequence: Option<[f32; 6]>,
    pub gear: GearFrame,
    #[serde(rename = "rotateKmh")]
    pub rotate_kmh: f64,
}
#[derive(Clone, Deserialize, Serialize)]
pub struct GearFrame {
    pub kind: String,
    pub h: Option<f64>,
    pub pitch: Option<f64>,
    pub main: Option<[f64; 2]>,
    pub aux: Option<[f64; 2]>,
}
/// Model body frame consumed by the production Aircraft.pose root matrix.
/// The WASM plant remains at its accepted position; weapons and accepted legacy
/// contact boxes use this same source-grounded model frame as the visible mesh.
#[derive(Clone, Debug, Serialize)]
pub(crate) struct AcceptedModelPose {
    pub position: [f64; 3],
    pub basis: [[f64; 3]; 3],
}
impl AcceptedModelPose {
    pub fn vector(&self, local: [f64; 3]) -> [f64; 3] {
        std::array::from_fn(|i| (0..3).map(|k| self.basis[k][i] * local[k]).sum())
    }
    pub fn point(&self, local: [f64; 3]) -> [f64; 3] {
        add(self.position, self.vector(local))
    }
    pub fn local_point(&self, world: [f64; 3]) -> [f64; 3] {
        // Invert the actual Float32 renderer basis, including its tiny rounding
        // error, instead of assuming its quantized columns remain orthonormal.
        let d = sub(world, self.position);
        let cross = |a: [f64; 3], b: [f64; 3]| {
            [
                a[1] * b[2] - a[2] * b[1],
                a[2] * b[0] - a[0] * b[2],
                a[0] * b[1] - a[1] * b[0],
            ]
        };
        let rows = [
            cross(self.basis[1], self.basis[2]),
            cross(self.basis[2], self.basis[0]),
            cross(self.basis[0], self.basis[1]),
        ];
        let determinant = dot(self.basis[0], rows[0]);
        rows.map(|row| dot(row, d) / determinant)
    }
    #[cfg(test)]
    pub fn matrix(&self) -> [f64; 16] {
        let mut out = [0.0; 16];
        for col in 0..3 {
            for row in 0..3 {
                out[col * 4 + row] = self.basis[col][row];
            }
        }
        out[12..15].copy_from_slice(&self.position);
        out[15] = 1.0;
        out
    }
}
pub(crate) fn accepted_model_pose(physics: &Physics, state: &[f32]) -> AcceptedModelPose {
    let gear = &physics.gear;
    let mut position = [state[0] as f64, state[1] as f64, state[2] as f64];
    // Canonical accepted (alpha1) pose uses the source quaternion, normalized
    // as Aircraft.pose's identical-sample aqSlerp does. No telemetry is changed.
    let mut q = [
        state[3] as f64,
        state[4] as f64,
        state[5] as f64,
        state[6] as f64,
    ];
    let norm = q.iter().map(|v| v * v).sum::<f64>().sqrt();
    let norm = if norm == 0.0 { 1.0 } else { norm };
    q = q.map(|v| v / norm);
    let ground =
        ((2.6 - state[35] as f64) / 0.6).clamp(0.0, 1.0) * if state[33] >= 0.9 { 1.0 } else { 0.0 };
    let mut theta = 0.0;
    if ground > 0.0 {
        let height = if gear.kind == "tricycle" {
            theta = gear.pitch.unwrap_or_else(|| match (gear.main, gear.aux) {
                (Some(main), Some(aux)) => (main[0] - aux[0]).atan2(aux[1] - main[1]),
                _ => 0.0,
            }) * ground;
            if gear.pitch.is_some() {
                gear.h.unwrap()
            } else if let Some(main) = gear.main {
                -(main[0] * theta.cos() + main[1] * theta.sin())
            } else {
                gear.h.unwrap()
            }
        } else {
            // Exact production NF01 defaults when a source type has no authored
            // contacts; authored taildraggers use their own main/aux datum.
            let main = gear.main.unwrap_or([-1.57, 0.14]);
            let aux = gear.aux.unwrap_or([-0.79, -4.16]);
            let three = (aux[0] - main[0]).atan2(main[1] - aux[1]);
            let rotation = if physics.rotate_kmh == 0.0 {
                190.0
            } else {
                physics.rotate_kmh
            } / 3.6;
            let (lift0, lift1) = if gear.main.is_some() {
                (rotation * 0.35, rotation * 0.6)
            } else {
                (22.0, 40.0)
            };
            let tail = 1.0 - ((state[13] as f64 - lift0) / (lift1 - lift0)).clamp(0.0, 1.0);
            theta = three * tail * ground;
            -(main[0] * theta.cos() + main[1] * theta.sin())
        };
        position[1] -= (2.0 - height) * ground;
    }
    if theta != 0.0 {
        let s = (-theta * 0.5).sin();
        let c = (-theta * 0.5).cos();
        let [x, y, z, w] = q;
        q = [w * s + x * c, y * c + z * s, z * c - y * s, w * c - x * s];
    }
    let [x, y, z, w] = q;
    let xx = x * x;
    let yy = y * y;
    let zz = z * z;
    let basis = [
        [
            1.0 - 2.0 * (yy + zz),
            2.0 * (x * y + z * w),
            2.0 * (x * z - y * w),
        ],
        [
            2.0 * (x * y - z * w),
            1.0 - 2.0 * (xx + zz),
            2.0 * (y * z + x * w),
        ],
        [
            2.0 * (x * z + y * w),
            2.0 * (y * z - x * w),
            1.0 - 2.0 * (xx + yy),
        ],
    ];
    // quatMatrix uploads a Float32 root transform. Native contacts and muzzle
    // positions consume these same matrix coefficients, not a separate basis.
    AcceptedModelPose {
        position: position.map(|v| v as f32 as f64),
        basis: basis.map(|a| a.map(|v| v as f32 as f64)),
    }
}
#[derive(Clone, Deserialize)]
pub struct FuelProfile {
    #[serde(rename = "capacityKg")]
    pub capacity: f64,
    #[serde(rename = "sourceTuple")]
    pub tuple: Vec<f64>,
}
#[derive(Clone, Deserialize)]
pub struct GunProfile {
    pub id: String,
    #[serde(default = "body_owner", deserialize_with = "gun_owner")]
    pub owner: String,
    /// The legacy constructor divides some finite stocks evenly across barrels.
    /// Host allocation below preserves the rounded total using discrete rounds.
    pub ammo: f64,
    pub rpm: f64,
    pub mount: [f64; 3],
    pub mounts: Vec<[f64; 3]>,
    pub directions: Vec<[f64; 3]>,
    pub belt: Vec<String>,
}
#[derive(Deserialize)]
struct Catalog {
    #[serde(rename = "schemaVersion")]
    schema_version: u32,
    source: CatalogSource,
    aircraft: BTreeMap<String, AirProfile>,
    shells: BTreeMap<String, Value>,
    #[serde(rename = "storeDefinitions")]
    store_definitions: BTreeMap<String, Value>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CatalogSource {
    flight_core_version: u32,
    flight_wasm_sha256: String,
}
fn validate_catalog_source(catalog: &Catalog) -> Result<(), String> {
    if catalog.schema_version != 1
        || catalog.source.flight_core_version != crate::flight_runtime::CORE_VERSION
        || catalog.source.flight_wasm_sha256
            != tg_combat::geometry::manifest::sha256(crate::flight_runtime::BUNDLED_WASM)
    {
        return Err("Aircraft profiles do not match the compiled flight core/schema".into());
    }
    for (id, p) in &catalog.aircraft {
        let physics = &p.physics;
        let bit = |v: f32| v == 0.0 || v == 1.0;
        let gear = &physics.gear;
        if !matches!(gear.kind.as_str(), "tricycle" | "taildragger")
            || gear.kind == "tricycle"
                && !gear
                    .h
                    .is_some_and(|h| h.is_finite() && h > 0.0 && h <= 10000.0)
            || gear
                .pitch
                .is_some_and(|v| !v.is_finite() || v.abs() > std::f64::consts::PI)
            || gear
                .main
                .iter()
                .chain(gear.aux.iter())
                .flatten()
                .any(|v| !v.is_finite() || v.abs() > 10000.0)
            || !physics.rotate_kmh.is_finite()
            || physics.rotate_kmh < 0.0
            || !bit(physics.airframe[11])
            || !bit(physics.configure[4])
            || !bit(physics.control[0])
            || !bit(physics.control[1])
            || physics.surfaces.is_some_and(|s| {
                s.iter().any(|v| !v.is_finite())
                    || !bit(s[15])
                    || !bit(s[16])
                    || s[1] <= s[0]
                    || s[5] <= 0.0
                    || s[7] <= 0.0
            })
            || physics.gear_sequence.is_some_and(|s| {
                !bit(s[0])
                    || s[1..]
                        .iter()
                        .any(|v| !v.is_finite() || !(0.05..=60.0).contains(v))
            })
        {
            return Err(format!(
                "Invalid optional geometry/mechanism or native flags for {id}"
            ));
        }
    }
    Ok(())
}
pub struct AirTemplate {
    module: Arc<FlightModule>,
    profiles: Arc<BTreeMap<String, AirProfile>>,
    shells: Arc<BTreeMap<String, ProjectileDef>>,
    definitions: Arc<BTreeMap<String, Value>>,
    damage_types: Arc<std::collections::HashMap<String, AirType>>,
    limits: Arc<airframe_limits::Catalog>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AirOption {
    pub id: String,
    pub name: String,
    pub year: u32,
    pub loadouts: Vec<Value>,
    /// Fixed catalog slots. Unavailable stores remain visible with an explicit
    /// `unsupported` reason; a browser never invents an attachment or quantity.
    pub slots: Vec<Value>,
    pub fuel_load: Value,
}
#[derive(Clone, Debug, Deserialize)]
pub struct AirInput {
    pub aim: [f32; 3],
    pub throttle: f32,
    pub manual_pitch: f32,
    pub manual_roll: f32,
    pub manual_yaw: f32,
    pub flags: u32,
    pub fire: bool,
    pub release: bool,
}
impl AirInput {
    pub fn valid(&self) -> bool {
        self.aim
            .iter()
            .chain([
                &self.throttle,
                &self.manual_pitch,
                &self.manual_roll,
                &self.manual_yaw,
            ])
            .all(|v| v.is_finite())
            && (0.5..=1.5).contains(&self.aim.iter().map(|v| v * v).sum::<f32>().sqrt())
            && self.aim.iter().all(|v| v.abs() <= 1.01)
            && (0.0..=1.12).contains(&self.throttle)
            && [self.manual_pitch, self.manual_roll, self.manual_yaw]
                .iter()
                .all(|v| v.abs() <= 1.0)
            && self.flags & !255 == 0
    }
    fn flight(&self) -> FlightInput {
        FlightInput {
            aim: self.aim,
            throttle: self.throttle,
            pitch: self.manual_pitch,
            roll: self.manual_roll,
            yaw: self.manual_yaw,
            flags: self.flags,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct GunView {
    pub id: String,
    pub owner: String,
    pub ammo: u32,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AirWeaponControlView {
    pub store_id: Option<String>,
    pub store_index: Option<usize>,
    pub program: String,
    pub gun_mode: String,
}
pub const AIR_SERVICE_SECONDS: f64 = 15.0;

/// Host-owned availability gates for light logistics. These are not airport stocks
/// or a claim that damaged facilities, transport and engineering are implemented.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct ServiceAvailability {
    pub runway: bool,
    pub fuel: bool,
    pub arming: bool,
    pub repair: bool,
    pub supply: bool,
}
impl Default for ServiceAvailability {
    fn default() -> Self {
        Self {
            runway: true,
            fuel: true,
            arming: true,
            repair: true,
            supply: true,
        }
    }
}
impl ServiceAvailability {
    fn available(self) -> bool {
        self.runway && self.fuel && self.arming && self.repair && self.supply
    }
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AirServiceView {
    pub status: String,
    pub revision: u64,
    pub airfield: Option<String>,
    pub loadout: Option<u32>,
    pub custom: Option<BTreeMap<String, String>>,
    pub elapsed_s: f64,
    pub duration_s: f64,
    pub remaining_s: f64,
    pub fuel_minutes: Option<FuelMinutes>,
    pub reason: Option<String>,
}
struct AirServiceState {
    view: AirServiceView,
    damage_revision: u64,
    pending_loadout: Option<AcceptedAirLoadout>,
    pending_fuel_minutes: Option<FuelMinutes>,
}
#[derive(Clone, Debug, PartialEq)]
struct AcceptedAirLoadout {
    index: u32,
    custom: Option<BTreeMap<String, String>>,
    value: Value,
}
#[derive(Clone, Copy, Debug, PartialEq)]
struct AirKinematics {
    team: Team,
    alive: bool,
    pos: [f64; 3],
    velocity: [f64; 3],
}
#[derive(Clone, Copy, Debug, Default, Serialize)]
pub struct AirTimings {
    pub steps: u64,
    pub kinematics_ns: u64,
    pub targeting_ns: u64,
    pub runtime_ns: u64,
    pub weapons_ns: u64,
    pub damage_service_ns: u64,
}

// Stable distance order preserves Iterator::min_by's first equal minimum.
// Visibility checks stop at the nearest actual visible candidate; positions,
// range comparisons and the exact native LOS query are unchanged.
fn nearest_visible<'a, T>(
    items: &'a [T],
    origin: [f64; 3],
    range: f64,
    eligible: impl Fn(&T) -> bool,
    position: impl Fn(&T) -> [f64; 3],
    mut visible: impl FnMut(&T) -> bool,
    #[allow(unused_variables)] legacy_oracle: bool,
) -> Option<&'a T> {
    #[cfg(test)]
    if legacy_oracle {
        return items
            .iter()
            .filter(|v| eligible(v) && distance(origin, position(v)) < range && visible(v))
            .min_by(|a, b| {
                distance(origin, position(a)).total_cmp(&distance(origin, position(b)))
            });
    }
    let mut ranked = items
        .iter()
        .filter_map(|v| {
            if !eligible(v) {
                return None;
            }
            let d = distance(origin, position(v));
            (d < range).then_some((d, v))
        })
        .collect::<Vec<_>>();
    ranked.sort_by(|a, b| a.0.total_cmp(&b.0));
    ranked.into_iter().find(|(_, v)| visible(v)).map(|(_, v)| v)
}
impl Default for AirServiceState {
    fn default() -> Self {
        Self {
            view: AirServiceView {
                status: "idle".into(),
                revision: 0,
                airfield: None,
                loadout: None,
                custom: None,
                elapsed_s: 0.0,
                duration_s: AIR_SERVICE_SECONDS,
                remaining_s: 0.0,
                fuel_minutes: None,
                reason: None,
            },
            damage_revision: 0,
            pending_loadout: None,
            pending_fuel_minutes: None,
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AirFlightView {
    pub airframe: [f32; 14],
    pub configure: [f32; 5],
    pub control: [f32; 4],
    pub envelope: [f32; 4],
    pub surfaces: Option<[f32; 17]>,
    pub gear_sequence: Option<[f32; 6]>,
    pub factors: [f32; 6],
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AirUnitView {
    pub unit: UnitRef,
    pub aircraft: String,
    pub loadout: u32,
    pub custom: Option<BTreeMap<String, String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub weapon_control: Option<AirWeaponControlView>,
    pub seeker: guided::Seeker,
    pub countermeasures: countermeasures::View,
    pub decoys: Vec<countermeasures::DecoyView>,
    pub team: Team,
    pub owner: Option<u32>,
    pub controller: Option<u32>,
    pub epoch: u64,
    pub alive: bool,
    pub pos: [f64; 3],
    pub yaw: f64,
    pub state: Vec<f32>,
    pub aero: Vec<f32>,
    pub damage: Value,
    pub airframe_limits: AirframeLimitState,
    pub flight: AirFlightView,
    pub guns: Vec<GunView>,
    pub fuel: Value,
    pub stores: Vec<Value>,
    pub resource_revision: u64,
    pub service_revision: u64,
    pub service: AirServiceView,
    pub fault: Option<String>,
}
struct Gun {
    profile: GunProfile,
    ammo: u32,
    cool: f64,
    fired: u64,
    /// A pod feed belongs to one accepted mounted item, not the global type.
    store_index: Option<usize>,
}
struct Store {
    value: Value,
    def: Value,
    count: u32,
    gone: bool,
    fuel: f64,
}
#[derive(Clone, Copy)]
enum ReleaseKind { Bomb, Rocket, Missile }
#[derive(Clone, Copy)]
struct ReleaseProgram {
    count: u32,
    together: u32,
    interval: f64,
    held: bool,
}
fn release_program(kind: ReleaseKind, name: &str) -> Option<ReleaseProgram> {
    let (count, together, interval, held) = match (kind, name) {
        (ReleaseKind::Bomb, "single") => (1, 1, 0.28, false),
        (ReleaseKind::Bomb, "pair") => (2, 2, 0.28, false),
        (ReleaseKind::Bomb, "s4") => (4, 1, 0.2, false),
        (ReleaseKind::Bomb, "all") => (u32::MAX, 1, 0.15, false),
        (ReleaseKind::Rocket, "held") => (1, 1, 0.11, true),
        (ReleaseKind::Rocket, "single") => (1, 1, 0.2, false),
        (ReleaseKind::Rocket, "s4") => (4, 1, 0.08, false),
        (ReleaseKind::Rocket, "s8") => (8, 1, 0.08, false),
        (ReleaseKind::Missile, "single") => (1, 1, 0.3, false),
        _ => return None,
    };
    Some(ReleaseProgram { count, together, interval, held })
}
fn store_selected(control: Option<&AirWeaponControlView>, index: usize, store: &Store) -> bool {
    match control {
        None => true,
        Some(control) => {
            (control.store_index.is_some() || control.store_id.is_some())
                && control.store_index.is_none_or(|chosen| index == chosen)
                && control.store_id.as_deref().is_none_or(|id| store.value["id"] == id)
        }
    }
}
fn selected_release_kind(stores: &[Store], control: Option<&AirWeaponControlView>, definitions: &BTreeMap<String, Value>) -> Option<ReleaseKind> {
    stores.iter().enumerate().find_map(|(index, store)| {
        if !store_selected(control, index, store) || control.is_none() && (store.gone || store.count == 0) { return None; }
        match payload(&store.def, definitions)?["kind"].as_str()? {
            "bomb" => Some(ReleaseKind::Bomb),
            "rocket" => Some(ReleaseKind::Rocket),
            "aam" | "agm" => Some(ReleaseKind::Missile),
            _ => None,
        }
    })
}
fn available_selected_rounds(stores: &[Store], control: Option<&AirWeaponControlView>, definitions: &BTreeMap<String, Value>) -> u32 {
    stores.iter().enumerate().filter(|(index, store)| store_selected(control, *index, store)
        && !store.gone && store.count > 0 && payload(&store.def, definitions).is_some())
        .fold(0u32, |total, (_, store)| total.saturating_add(store.count))
}
pub struct AirUnit {
    pub reference: UnitRef,
    pub aircraft: String,
    loadout: u32,
    custom: Option<BTreeMap<String, String>>,
    accepted_loadout: AcceptedAirLoadout,
    pub team: Team,
    pub owner: Option<u32>,
    pub controller: Option<u32>,
    pub epoch: u64,
    pub last_seq: u64,
    pub last_input: f64,
    pub loss_counted: bool,
    runtime: FlightRuntime,
    profile: AirProfile,
    damage: AirDamage,
    airframe_limits: AirframeLimitState,
    input: AirInput,
    state: Vec<f32>,
    aero: Vec<f32>,
    guns: Vec<Gun>,
    stores: Vec<Store>,
    fuel: f64,
    flow: f64,
    mass_fuel: f64,
    fuel_minutes: Option<FuelMinutes>,
    resource_revision: u64,
    release_held: bool,
    release_cooldown: f64,
    weapon_control: Option<AirWeaponControlView>,
    seeker: guided::Seeker,
    countermeasures: countermeasures::Countermeasures,
    release_remaining: u32,
    release_last_side: i64,
    fault: Option<String>,
    parked: bool,
    service: AirServiceState,
    /// Only unowned autonomous aircraft receive this lifecycle. A disconnected
    /// or returned player's aircraft cannot acquire free automatic servicing.
    sortie: Option<AiSortieState>,
    pose_admission: Option<local_pose::PoseAdmission>,
    flight_airframe: [f32; 14],
}
impl AirUnit {
    pub fn loadout(&self) -> u32 {
        self.loadout
    }
    pub fn alive(&self) -> bool {
        self.fault.is_none() && self.state[22] < 0.5 && !self.damage.down()
    }
    pub fn pos(&self) -> [f64; 3] {
        [
            self.state[0] as f64,
            self.state[1] as f64,
            self.state[2] as f64,
        ]
    }
    pub fn speed(&self) -> f64 {
        self.state[75] as f64
    }
    fn autonomous_service_authorized(&self) -> bool {
        self.owner.is_none()
            && self
                .sortie
                .as_ref()
                .is_some_and(|s| s.phase == AiSortiePhase::Service)
    }
    fn view(&self) -> AirUnitView {
        let mut damage = self.damage.snapshot();
        damage["part_ids"] = json!(self
            .damage
            .parts
            .iter()
            .map(|p| p.def.id.as_str())
            .collect::<Vec<_>>());
        damage["part_max_hp"] = json!(self
            .damage
            .parts
            .iter()
            .map(|p| p.def.hp)
            .collect::<Vec<_>>());
        // The legacy accepted catalog has aggregate engines/tail for these two
        // types. Declare the limited visual projection explicitly; this does
        // not manufacture separate native damage parts or collision surfaces.
        let has = |id: &str| self.damage.parts.iter().any(|p| p.def.id == id);
        let mut aliases = serde_json::Map::new();
        let source_id=self.profile.metadata["inheritedModelId"].as_str().unwrap_or(self.aircraft.as_str());
        if source_id == "f4e" && has("engine") && !has("engine_l") && !has("engine_r") {
            aliases.insert("engine_l".into(), json!("engine"));
            aliases.insert("engine_r".into(), json!("engine"));
        }
        if source_id == "su27" && !has("fin") && has("tail") {
            aliases.insert("fin".into(), json!("tail"));
        }
        damage["visual_aliases"] = Value::Object(aliases);
        let mut factors=damage_flight(&self.damage);
        if self.fuel+self.stores.iter().filter(|s|!s.gone).map(|s|s.fuel).sum::<f64>()<=0.0 {factors[0]=0.0;}
        AirUnitView {
            unit: self.reference,
            aircraft: self.aircraft.clone(),
            loadout: self.loadout,
            custom: self.custom.clone(),
            weapon_control: self.weapon_control.clone(),
            seeker: self.seeker.clone(),
            countermeasures: self.countermeasures.view(),
            decoys: self.countermeasures.decoys().iter().map(|d|d.view()).collect(),
            team: self.team,
            owner: self.owner,
            controller: self.controller,
            epoch: self.epoch,
            alive: self.alive(),
            pos: self.pos(),
            yaw: self.state[18] as f64,
            state: self.state.clone(),
            aero: self.aero.clone(),
            damage,
            airframe_limits: self.airframe_limits,
            flight: AirFlightView { airframe:self.flight_airframe,configure:self.profile.physics.configure,
                control:self.profile.physics.control,envelope:self.profile.physics.envelope,
                surfaces:self.profile.physics.surfaces,gear_sequence:self.profile.physics.gear_sequence,factors },
            guns: self
                .guns
                .iter()
                .map(|g| GunView {
                    id: g.profile.id.clone(),
                    owner: g.profile.owner.clone(),
                    ammo: g.ammo,
                })
                .collect(),
            fuel: json!({"kg":self.fuel,"max":self.profile.fuel.capacity,"flow":self.flow,"selected_minutes":self.fuel_minutes,
                "total_kg":self.fuel+self.stores.iter().filter(|s| !s.gone).map(|s| s.fuel).sum::<f64>()}),
            stores: self
                .stores
                .iter()
                .map(|s| {
                    let mut v = s.value.clone();
                    v["count"] = json!(s.count);
                    v["gone"] = json!(s.gone);
                    v["fuel"] = json!(s.fuel);
                    v
                })
                .collect(),
            resource_revision: self.resource_revision,
            service_revision: self.service.view.revision,
            service: self.service.view.clone(),
            fault: self.fault.clone(),
        }
    }
    fn configure_mass(&mut self) -> Result<(), String> {
        let af = loaded_airframe(&self.profile, self.fuel, &self.stores)?;
        self.configure_loaded_airframe(&af)?;
        self.mass_fuel = self.fuel;
        Ok(())
    }
    fn configure_loaded_airframe(&mut self, af: &[f32; 14]) -> Result<(), String> {
        self.runtime
            .configure_airframe(af)
            .map_err(|e| e.to_string())?;
        if let Some(s) = self.profile.physics.surfaces {
            let floats = s[..15].try_into().unwrap();
            self.runtime
                .configure_surfaces(&floats, s[15] != 0.0, s[16] != 0.0)
                .map_err(|e| e.to_string())?;
        }
        if let Some(s) = self.profile.physics.gear_sequence {
            let seconds = s[1..].try_into().unwrap();
            self.runtime
                .configure_gear_sequence(s[0] != 0.0, &seconds)
                .map_err(|e| e.to_string())?;
        }
        if self.airframe_limits.gear_failed {
            self.runtime.set_gear_failure(true).map_err(|e| e.to_string())?;
        }
        self.flight_airframe=*af;
        Ok(())
    }
    fn servicing(&self) -> bool {
        self.service.view.status == "servicing"
    }
    fn cancel_service(&mut self, reason: &str) {
        if self.servicing() {
            let v = &mut self.service.view;
            v.status = "cancelled".into();
            v.revision += 1;
            v.elapsed_s = 0.0;
            v.remaining_s = AIR_SERVICE_SECONDS;
            v.reason = Some(reason.into());
            self.service.pending_loadout = None;
            self.service.pending_fuel_minutes = None;
        }
    }
    /// Stage all host resources before touching the kernel or accepted inventory.
    /// Reconfigure the existing instance; never spawn/reset hidden flight state.
    fn complete_service(
        &mut self,
        accepted: AcceptedAirLoadout,
        stores: Vec<Store>,
        fuel_minutes: Option<FuelMinutes>,
    ) -> Result<(), String> {
        if !self.alive() {
            return Err("aircraft_lost".into());
        }
        let mut repaired = self.damage.clone();
        for p in &mut repaired.parts {
            p.hp = p.def.hp;
            p.detached = false;
        }
        repaired.fire = 0.0;
        repaired.fire_at = None;
        repaired.revision += 1;
        let guns = allocate_loaded_feeds(&self.profile, &stores)?;
        let fuel = fuel_load::target(&self.profile, fuel_minutes)?;
        let af = loaded_airframe(&self.profile, fuel, &stores)?;
        self.configure_loaded_airframe(&af)?;
        self.runtime
            .set_damage(damage_flight(&repaired))
            .map_err(|e| e.to_string())?;
        // The completed host service is the only same-life repair. Refresh
        // accepted telemetry before committing so failures cannot half-grant it.
        self.runtime.set_gear_failure(false).map_err(|e| e.to_string())?;
        let telemetry = self.runtime.telemetry().map_err(|e| e.to_string())?;
        // No fallible operation follows this accepted host resource commit.
        self.damage = repaired;
        self.airframe_limits = AirframeLimitState::default();
        self.state = telemetry.state;
        self.aero = telemetry.aero;
        self.guns = guns;
        self.fuel = fuel;
        self.fuel_minutes = fuel_minutes;
        self.flow = 0.0;
        self.mass_fuel = fuel;
        self.stores = stores;
        self.countermeasures.rearm();
        if let Some(control) = &mut self.weapon_control {
            let valid = match (control.store_index, control.store_id.as_deref()) {
                (Some(index), id) => self.stores.get(index)
                    .is_some_and(|store| id.is_none_or(|id| store.value["id"] == id)),
                (None, Some(id)) => self.stores.iter().any(|store| store.value["id"] == id),
                (None, None) => true,
            };
            if !valid { control.store_id = None; control.store_index = None; }
        }
        self.release_remaining = 0;
        self.release_last_side = 0;
        self.loadout = accepted.index;
        self.custom = accepted.custom.clone();
        self.accepted_loadout = accepted;
        self.service.pending_loadout = None;
        self.service.pending_fuel_minutes = None;
        self.release_cooldown = 0.0;
        self.release_held = false;
        self.input.fire = false;
        self.input.release = false;
        self.resource_revision += 1;
        let v = &mut self.service.view;
        v.status = "complete".into();
        v.revision += 1;
        v.elapsed_s = AIR_SERVICE_SECONDS;
        v.remaining_s = 0.0;
        v.reason = None;
        Ok(())
    }
}
pub struct AirWorld {
    template: Arc<AirTemplate>,
    ground: Arc<crate::frontline_sim::MapGround>,
    map: Value,
    pub units: BTreeMap<u64, AirUnit>,
    time: f64,
    service_availability: BTreeMap<String, ServiceAvailability>,
    timings: Option<AirTimings>,
    #[cfg(test)]
    legacy_target_oracle: bool,
}
impl AirTemplate {
    pub fn load(data: &Path) -> Result<Arc<Self>, String> {
        let catalog: Catalog = serde_json::from_slice(
            &std::fs::read(data.join("aircraft/frontline.json")).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        validate_catalog_source(&catalog)?;
        let limits = airframe_limits::Catalog::bundled().map_err(|e| e.to_string())?;
        let damage: AirData = serde_json::from_slice(
            &std::fs::read(data.join("aircraft/aircraft.json")).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
        let mut shells = BTreeMap::new();
        for (id, value) in catalog.shells {
            let shell: ProjectileDef =
                serde_json::from_value(value).map_err(|e| format!("air projectile {id}: {e}"))?;
            shells.insert(id, shell);
        }
        for (id, p) in &catalog.aircraft {
            if !limits.aircraft.contains_key(id) {
                return Err(format!("missing accepted aircraft structural limits {id}"));
            }
            if !damage.types.contains_key(id) {
                return Err(format!("missing accepted aircraft damage type {id}"));
            }
            if !p
                .physics
                .airframe
                .iter()
                .chain(&p.physics.configure)
                .chain(&p.physics.control)
                .chain(&p.physics.envelope)
                .all(|v| v.is_finite())
                || p.fuel.capacity <= 0.0
                || !p.fuel.capacity.is_finite()
            {
                return Err(format!("invalid flight profile {id}"));
            }
            for g in &p.guns {
                if g.belt.is_empty()
                    || g.belt.iter().any(|s| !shells.contains_key(s))
                    || !g.rpm.is_finite()
                    || g.rpm <= 0.0
                    || !g.ammo.is_finite()
                    || g.ammo < 0.0
                {
                    return Err(format!("invalid mounted air gun {id}/{}", g.id));
                }
            }
        }
        Ok(Arc::new(Self {
            module: FlightModule::bundled().map_err(|e| e.to_string())?,
            profiles: Arc::new(catalog.aircraft),
            shells: Arc::new(shells),
            definitions: Arc::new(catalog.store_definitions),
            damage_types: Arc::new(damage.types),
            limits: Arc::new(limits),
        }))
    }
    pub fn world(
        self: &Arc<Self>,
        ground: Arc<crate::frontline_sim::MapGround>,
        map: Value,
    ) -> AirWorld {
        AirWorld {
            template: self.clone(),
            ground,
            map,
            units: BTreeMap::new(),
            time: 0.0,
            service_availability: BTreeMap::new(),
            timings: crate::frontline_sim::native_timing_enabled().then(AirTimings::default),
            #[cfg(test)]
            legacy_target_oracle: false,
        }
    }
}
impl AirWorld {
    pub(crate) fn combat_targets(&self) -> Vec<crate::frontline_sim::AirTarget> {
        self.units
            .values()
            .map(|u| crate::frontline_sim::AirTarget {
                unit: u.reference,
                team: if u.team == Team::Blue { 0 } else { 1 },
                alive: u.alive(),
                pos: u.pos(),
                velocity: [u.state[7] as f64, u.state[8] as f64, u.state[9] as f64],
            })
            .collect()
    }
    pub(crate) fn ai_sortie_view(&self, id: u64) -> Option<AiSortieView> {
        self.units
            .get(&id)?
            .sortie
            .as_ref()
            .map(AiSortieState::view)
    }
    pub fn timings(&self) -> Option<AirTimings> {
        self.timings
    }
    pub fn sync_facility_availability(&mut self, ground: &SimWorld) {
        let fields: Vec<_> = self.map["airfields"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|f| f["enabled"] == true)
            .filter_map(|f| f["id"].as_str())
            .map(str::to_owned)
            .collect();
        for id in fields {
            if let Some(c) = ground.facility_airfield_capabilities(&id) {
                let availability = ServiceAvailability {
                    runway: c.runway,
                    fuel: c.fuel,
                    arming: c.arming,
                    repair: c.repair,
                    supply: c.supply,
                };
                if self.service_availability.get(&id) != Some(&availability) {
                    self.set_service_availability(&id, availability)
                        .expect("source airfield facility binding");
                }
            }
        }
    }
    pub fn set_clock(&mut self, now: f64) {
        self.time = now;
    }
    pub fn options(&self, era: u32) -> Vec<AirOption> {
        self.template
            .profiles
            .iter()
            .filter_map(|(id, p)| {
                let year = p.metadata["year"]
                    .as_u64()
                    .or_else(|| p.metadata["era"].as_str()?.parse().ok())?
                    as u32;
                if year > era {
                    return None;
                }
                Some(AirOption {
                    id: id.clone(),
                    fuel_load: fuel_load::options(p),
                    name: p.metadata["name"].as_str().unwrap_or(id).into(),
                    year,
                    loadouts: p.stores["loadouts"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .filter(|lo| self.loadout_supported(lo))
                        .cloned()
                        .collect(),
                    slots: p.stores["slots"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|slot| {
                            let mut out = slot.clone();
                            let mut unsupported = serde_json::Map::new();
                            for (store, count) in slot["options"].as_object().into_iter().flatten()
                            {
                                let reason = self
                                    .store_unsupported_reason(store)
                                    .map(str::to_owned)
                                    .or_else(|| {
                                        slot_items(
                                            p,
                                            slot,
                                            store,
                                            count.as_u64().unwrap_or(0),
                                            &self.template.definitions,
                                            &self.template.damage_types[id].parts,
                                        )
                                        .err()
                                    });
                                if let Some(reason) = reason {
                                    unsupported.insert(store.clone(), json!(reason));
                                }
                            }
                            out["unsupported"] = Value::Object(unsupported);
                            out
                        })
                        .collect(),
                })
            })
            .collect()
    }
    fn loadout_supported(&self, lo: &Value) -> bool {
        lo["items"].as_array().is_some_and(|items| {
            items.iter().all(|s| {
                s["id"]
                    .as_str()
                    .is_some_and(|id| self.store_unsupported_reason(id).is_none())
            })
        })
    }
    fn store_unsupported_reason(&self, id: &str) -> Option<&'static str> {
        let Some(def) = self.template.definitions.get(id) else {
            return Some("unknown_store");
        };
        match def["kind"].as_str() {
            Some("tank") => None,
            Some("gunpod") => {
                let gun = &def["gun"];
                let valid = gun["rounds"]
                    .as_u64()
                    .is_some_and(|n| n > 0 && n <= u32::MAX as u64)
                    && gun["rpm"]
                        .as_f64()
                        .is_some_and(|n| n.is_finite() && n > 0.0)
                    && gun["belt"].as_array().is_some_and(|belt| {
                        !belt.is_empty()
                            && belt.iter().all(|s| {
                                s.as_str()
                                    .is_some_and(|id| self.template.shells.contains_key(id))
                            })
                    });
                (!valid).then_some("invalid_authoritative_gunpod")
            }
            Some("aam" | "agm") => {
                if def["kind"]=="agm" && !def["warhead"]["id"].as_str().is_some_and(|id|self.template.shells.contains_key(id)) {Some("missing_authoritative_projectile")}
                else if def["kind"]=="aam" && !def["tnt"].as_f64().is_some_and(|v|v.is_finite()&&v>0.0) {Some("missing_authoritative_projectile")} else {None}
            },
            Some("ecm" | "sensorpod") => None,
            Some("bomb" | "rocket" | "pod") => {
                let Some(p) = payload(def, &self.template.definitions) else {
                    return Some("missing_authoritative_payload");
                };
                if !p["warhead"]["id"]
                    .as_str()
                    .is_some_and(|id| self.template.shells.contains_key(id))
                {
                    Some("missing_authoritative_projectile")
                } else {
                    None
                }
            }
            _ => Some("unsupported_authoritative_store"),
        }
    }
    fn accept_loadout(
        &self,
        aircraft: &str,
        loadout: u32,
        custom: Option<&BTreeMap<String, String>>,
    ) -> Result<AcceptedAirLoadout, String> {
        let profile = self
            .template
            .profiles
            .get(aircraft)
            .ok_or("unknown_aircraft")?;
        let Some(custom) = custom else {
            let lo = profile.stores["loadouts"]
                .as_array()
                .and_then(|v| {
                    v.iter()
                        .find(|lo| lo["index"].as_u64() == Some(loadout as u64))
                })
                .ok_or("unknown_loadout")?;
            for item in lo["items"].as_array().ok_or("invalid_loadout")? {
                let id = item["id"].as_str().ok_or("invalid_store")?;
                if let Some(reason) = self.store_unsupported_reason(id) {
                    return Err(format!("{reason}:{id}"));
                }
            }
            return Ok(AcceptedAirLoadout {
                index: loadout,
                custom: None,
                value: lo.clone(),
            });
        };
        let slots = profile.stores["slots"]
            .as_array()
            .ok_or("missing_aircraft_slots")?;
        if custom.len() > slots.len()
            || custom.keys().any(|key| {
                !slots
                    .iter()
                    .any(|s| s["key"].as_str() == Some(key.as_str()))
            })
        {
            return Err("unknown_aircraft_slot".into());
        }
        let selected = slots
            .iter()
            .filter(|slot| {
                slot["key"]
                    .as_str()
                    .is_some_and(|key| custom.contains_key(key))
            })
            .collect::<Vec<_>>();
        for (i, a) in selected.iter().enumerate() {
            if selected.iter().skip(i + 1).any(|b| slots_clash(a, b)) {
                return Err("aircraft_slots_clash".into());
            }
        }
        let mut items = Vec::new();
        let mut entries = Vec::new();
        for slot in selected {
            let key = slot["key"].as_str().ok_or("invalid_aircraft_slot")?;
            let id = &custom[key];
            let count = slot["options"]
                .get(id)
                .and_then(Value::as_u64)
                .filter(|n| *n > 0)
                .ok_or_else(|| format!("store_not_allowed:{key}:{id}"))?;
            if let Some(reason) = self.store_unsupported_reason(id) {
                return Err(format!("{reason}:{key}:{id}"));
            }
            items.extend(slot_items(
                profile,
                slot,
                id,
                count,
                &self.template.definitions,
                &self.template.damage_types[aircraft].parts,
            )?);
            entries.push(json!([id, count, slot["station"], slot["side"]]));
        }
        Ok(AcceptedAirLoadout {
            index: 0,
            custom: Some(custom.clone()),
            value: json!({"index":0,"name":"自訂","entries":entries,"items":items}),
        })
    }
    /// Compare approved configuration identities, never spent inventories. A
    /// parked survivor cannot gain a fresh aircraft or stores from deployment.
    pub fn loadout_matches(
        &self,
        id: u64,
        loadout: u32,
        custom: Option<&BTreeMap<String, String>>,
    ) -> Result<bool, String> {
        let u = self.units.get(&id).ok_or("unknown_aircraft")?;
        let accepted = self.accept_loadout(&u.aircraft, loadout, custom)?;
        Ok(u.loadout == accepted.index && u.custom == accepted.custom)
    }
    pub fn reference(&self, id: u64) -> Option<UnitRef> {
        self.units.get(&id).map(|u| u.reference)
    }
    /// Immutable authored store dimensions for public pylon geometry. This is
    /// never an inventory, fuel or feed query.
    pub(crate) fn store_len(&self, id: &str) -> Option<f64> {
        self.template
            .definitions
            .get(id)?
            .get("len")?
            .as_f64()
            .filter(|n| n.is_finite() && *n > 0.0)
    }
    pub fn views(&self) -> Vec<AirUnitView> {
        self.units.values().map(AirUnit::view).collect()
    }
    pub fn service_view(&self, id: u64) -> Option<AirServiceView> {
        self.units.get(&id).map(|u| u.service.view.clone())
    }
    /// The Hub checks owner, controller, UnitRef, epoch and command sequence.
    /// The air world independently checks the accepted plant and source runway.
    pub fn request_service(
        &mut self,
        id: u64,
        loadout: u32,
        now: f64,
    ) -> Result<AirServiceView, String> {
        self.request_service_configured(id, loadout, None, now)
    }
    pub fn request_service_configured(
        &mut self,
        id: u64,
        loadout: u32,
        custom: Option<&BTreeMap<String, String>>,
        now: f64,
    ) -> Result<AirServiceView, String> {
        self.request_service_fuel(id, loadout, custom, None, now)
    }
    pub fn request_service_fuel(
        &mut self,
        id: u64,
        loadout: u32,
        custom: Option<&BTreeMap<String, String>>,
        fuel_minutes: Option<FuelMinutes>,
        now: f64,
    ) -> Result<AirServiceView, String> {
        if !now.is_finite() || now < 0.0 {
            return Err("invalid_service_time".into());
        }
        let u = self.units.get(&id).ok_or("unknown_aircraft")?;
        if u.controller.is_none() {
            return Err("not_controlled".into());
        }
        let field = service_location(u, &self.map, &self.service_availability, &self.ground)?;
        let accepted = self.accept_loadout(&u.aircraft, loadout, custom)?;
        // Validate the whole candidate before recording a service request. The
        // actual resources/loadout remain unchanged until completion.
        let candidate = stores_from_loadout(&accepted.value, &self.template.definitions)?;
        allocate_loaded_feeds(&u.profile, &candidate)?;
        let target_fuel = fuel_load::target(&u.profile, fuel_minutes)?;
        loaded_airframe(&u.profile, target_fuel, &candidate)?;
        let u = self.units.get_mut(&id).unwrap();
        if u.servicing() {
            if u.service.pending_loadout.as_ref() == Some(&accepted) && u.service.pending_fuel_minutes == fuel_minutes {
                return Ok(u.service.view.clone());
            }
            return Err("service_already_active".into());
        }
        u.service.damage_revision = u.damage.revision;
        u.release_remaining = 0;
        u.service.pending_loadout = Some(accepted.clone());
        u.service.pending_fuel_minutes = fuel_minutes;
        let revision = u.service.view.revision + 1;
        u.service.view = AirServiceView {
            status: "servicing".into(),
            revision,
            airfield: Some(field),
            loadout: Some(accepted.index),
            custom: accepted.custom,
            fuel_minutes,
            elapsed_s: 0.0,
            duration_s: AIR_SERVICE_SECONDS,
            remaining_s: AIR_SERVICE_SECONDS,
            reason: None,
        };
        // The request timestamp cannot grant elapsed work or rewind any clock.
        Ok(u.service.view.clone())
    }
    pub fn cancel_service(&mut self, id: u64) -> Result<AirServiceView, String> {
        let u = self.units.get_mut(&id).ok_or("unknown_aircraft")?;
        u.cancel_service("cancelled");
        Ok(u.service.view.clone())
    }
    pub fn set_service_availability(
        &mut self,
        airfield: &str,
        availability: ServiceAvailability,
    ) -> Result<(), String> {
        if !self.map["airfields"]
            .as_array()
            .into_iter()
            .flatten()
            .any(|f| f["id"].as_str() == Some(airfield))
        {
            return Err("unknown_airfield".into());
        }
        self.service_availability
            .insert(airfield.into(), availability);
        if !availability.available() {
            for u in self
                .units
                .values_mut()
                .filter(|u| u.service.view.airfield.as_deref() == Some(airfield))
            {
                u.cancel_service("availability_unavailable");
            }
        }
        Ok(())
    }
    pub fn spawn(
        &mut self,
        reference: UnitRef,
        aircraft: &str,
        team: Team,
        owner: Option<u32>,
        kind: &str,
        loadout: u32,
    ) -> Result<(), String> {
        self.spawn_configured(reference, aircraft, team, owner, kind, loadout, None)
    }
    pub fn spawn_configured(
        &mut self,
        reference: UnitRef,
        aircraft: &str,
        team: Team,
        owner: Option<u32>,
        kind: &str,
        loadout: u32,
        custom: Option<&BTreeMap<String, String>>,
    ) -> Result<(), String> {
        self.spawn_configured_fuel(reference, aircraft, team, owner, kind, loadout, custom, None)
    }
    pub fn spawn_configured_fuel(
        &mut self,
        reference: UnitRef,
        aircraft: &str,
        team: Team,
        owner: Option<u32>,
        kind: &str,
        loadout: u32,
        custom: Option<&BTreeMap<String, String>>,
        fuel_minutes: Option<FuelMinutes>,
    ) -> Result<(), String> {
        if self.units.contains_key(&reference.unit) {
            return Err("duplicate air unit".into());
        }
        let profile = self
            .template
            .profiles
            .get(aircraft)
            .ok_or("unknown aircraft")?
            .clone();
        let accepted = self.accept_loadout(aircraft, loadout, custom)?;
        let ti = if team == Team::Blue { 0 } else { 1 };
        let fields = self.map["airfields"]
            .as_array()
            .ok_or("missing airfields")?;
        let landings = fields
            .iter()
            .filter(|v| v["enabled"] == true)
            .filter_map(landing)
            .collect();
        let mut runtime = self
            .template
            .module
            .instantiate(self.ground.clone(), landings)
            .map_err(|e| e.to_string())?;
        let stores = stores_from_loadout(&accepted.value, &self.template.definitions)?;
        let guns = allocate_loaded_feeds(&profile, &stores)?;
        let target = self.map["objectives"]
            .as_array()
            .and_then(|v| v.iter().find(|o| o["id"] == "C2"))
            .and_then(|v| vector(&v["pos"]))
            .ok_or("missing air mission objective")?;
        let (position, heading, speed, on_ground) = match kind {
            "air" => {
                let source = self.map["airspawns"]
                    .as_array()
                    .and_then(|v| {
                        v.iter()
                            .find(|s| s["enabled"] == true && s["team"].as_u64() == Some(ti))
                    })
                    .ok_or("no enabled rear air start")?;
                let base = vector(&source["pos"]).ok_or("invalid air start")?;
                let forward = normalize([target[0] - base[0], 0.0, target[2] - base[2]]);
                let p = (0..32)
                    .map(|slot| {
                        let row = (slot / 8) as f64;
                        let lateral = ((slot % 8) as f64 - 3.5) * 80.0;
                        [
                            base[0] + forward[2] * lateral - forward[0] * row * 180.0,
                            base[1] + row * 40.0,
                            base[2] - forward[0] * lateral - forward[2] * row * 180.0,
                        ]
                    })
                    .find(|p| {
                        self.ground.contains(p[0], p[2])
                            && self
                                .units
                                .values()
                                .all(|u| !u.alive() || distance(u.pos(), *p) >= 60.0)
                    })
                    .ok_or("rear air-start slots are occupied; wait for clearance")?;
                (
                    p,
                    (target[0] - p[0]).atan2(target[2] - p[2]),
                    if profile.physics.airframe[11] != 0.0 {
                        210.0
                    } else {
                        110.0
                    },
                    false,
                )
            }
            "runway" => {
                let source = fields
                    .iter()
                    .find(|s| s["enabled"] == true && s["team"].as_u64() == Some(ti))
                    .ok_or("no accepted friendly runway")?;
                let l = landing(source).ok_or("invalid runway")?;
                let height = source["runway"]["height"]
                    .as_f64()
                    .ok_or("missing runway height")?;
                let intervals = if self
                    .ground
                    .runway_source_registered(source["id"].as_str().unwrap_or(""))
                {
                    self.ground
                        .runway_open_intervals(source["id"].as_str().unwrap_or(""))
                } else {
                    vec![[-l.half_length, l.half_length]]
                };
                let required = (if profile.physics.airframe[11] != 0.0 {
                    1200.0_f64
                } else {
                    600.0
                })
                .min(l.half_length * 2.0);
                let segment = intervals
                    .iter()
                    .find(|r| r[1] - r[0] >= required)
                    .ok_or("No sufficiently long intact runway segment")?;
                let p = [
                    l.center[0] + l.forward[0] * (segment[0] + 140.0),
                    height + 2.0,
                    l.center[1] + l.forward[1] * (segment[0] + 140.0),
                ];
                if !self.ground.runway_available_at(p[0], p[2]) {
                    return Err("runway spawn lies in a closed patch".into());
                }
                if self
                    .units
                    .values()
                    .any(|u| u.alive() && distance(u.pos(), p) < 35.0)
                {
                    return Err("runway spawn is physically occupied; wait for it to clear".into());
                }
                (p, l.forward[0].atan2(l.forward[1]), 0.0, true)
            }
            _ => return Err("spawn must be air or runway".into()),
        };
        let c = profile.physics.configure;
        runtime
            .configure(c[0], c[1], c[2], c[3], c[4] != 0.0)
            .map_err(|e| e.to_string())?;
        let c = profile.physics.control;
        runtime
            .configure_control(c[0] as u8, c[1] != 0.0, c[2], c[3])
            .map_err(|e| e.to_string())?;
        let e = profile.physics.envelope;
        runtime
            .configure_envelope(e[0], e[1], e[2], e[3])
            .map_err(|e| e.to_string())?;
        let mut unit = AirUnit {
            reference,
            aircraft: aircraft.into(),
            loadout: accepted.index,
            custom: accepted.custom.clone(),
            accepted_loadout: accepted,
            team,
            owner,
            controller: None,
            epoch: 1,
            last_seq: 0,
            last_input: self.time,
            loss_counted: false,
            damage: AirDamage::new(&self.template.damage_types[aircraft]),
            airframe_limits: AirframeLimitState::default(),
            runtime,
            profile: profile.clone(),
            state: vec![0.0; 80],
            aero: vec![0.0; 48],
            guns,
            stores,
            fuel: fuel_load::target(&profile, fuel_minutes)?,
            flow: 0.0,
            mass_fuel: fuel_load::target(&profile, fuel_minutes)?,
            fuel_minutes,
            resource_revision: 1,
            release_held: false,
            release_cooldown: 0.0,
            weapon_control: None,
            seeker: guided::Seeker::default(),
            countermeasures: countermeasures::Countermeasures::new(&profile.sensors),
            release_remaining: 0,
            release_last_side: 0,
            fault: None,
            parked: false,
            service: AirServiceState::default(),
            sortie: owner.is_none().then(|| AiSortieState::new(on_ground)),
            pose_admission: None,
            flight_airframe: profile.physics.airframe,
            input: AirInput {
                aim: [heading.sin() as f32, 0.0, heading.cos() as f32],
                throttle: if on_ground { 0.05 } else { 0.78 },
                manual_pitch: 0.0,
                manual_roll: 0.0,
                manual_yaw: 0.0,
                flags: if on_ground { 1 | 4 | 128 } else { 1 },
                fire: false,
                release: false,
            },
        };
        unit.configure_mass()?;
        unit.runtime
            .spawn(FlightSpawn {
                position: position.map(|v| v as f32),
                heading: heading as f32,
                airspeed: speed,
                on_ground,
            })
            .map_err(|e| e.to_string())?;
        let t = unit.runtime.telemetry().map_err(|e| e.to_string())?;
        unit.state = t.state;
        unit.aero = t.aero;
        self.units.insert(reference.unit, unit);
        Ok(())
    }
    pub(crate) fn active_countermeasures(&self)->Vec<countermeasures::Decoy>{
        self.units.values().flat_map(|u|u.countermeasures.decoys().iter().copied()).collect()
    }
    pub fn release_countermeasure(&mut self,id:u64,kind:&str)->Result<(),String>{
        let u=self.units.get_mut(&id).ok_or("unknown_aircraft")?;
        if !u.alive()||u.controller.is_none(){return Err("aircraft_not_controlled".into());}
        if u.servicing(){return Err("aircraft_servicing".into());}
        let pose=accepted_model_pose(&u.profile.physics,&u.state);
        let velocity=[u.state[7] as f64,u.state[8] as f64,u.state[9] as f64];
        u.countermeasures.release(kind,u.reference,&pose,velocity)?;
        u.resource_revision+=1;
        Ok(())
    }
    pub(crate) fn guidance_target(&self,reference:UnitRef)->Option<guided::Target>{
        let u=self.units.get(&reference.unit)?;
        let (jam_search,jam_track)=if u.seeker.ecm{u.stores.iter().filter(|s|!s.gone&&s.def["kind"]=="ecm")
            .fold((0.0f64,0.0f64),|(a,b),s|(a.max(s.def["jam"]["search"].as_f64().unwrap_or(0.0)),b.max(s.def["jam"]["track"].as_f64().unwrap_or(0.0))))}else{(0.0,0.0)};
        (u.reference==reference).then(||guided::Target{reference:u.reference,team:if u.team==Team::Blue{0}else{1},air:true,alive:u.alive(),pos:u.pos(),velocity:[u.state[7] as f64,u.state[8] as f64,u.state[9] as f64],
            emitting:u.seeker.radar&&unit_has_radar(u)&&u.alive(),jam_search,jam_track})
    }
    pub(crate) fn guidance_support(&self,launcher:UnitRef,target:Option<guided::Target>)->Option<guided::Support>{
        let u=self.units.get(&launcher.unit)?;
        if u.reference!=launcher||!u.alive()||u.controller.is_none(){return None;}
        let pose=accepted_model_pose(&u.profile.physics,&u.state);let reference=target.map(|t|t.reference);
        let input_aim=u.input.aim.map(|v|v as f64);
        let aim=target.map(|t|guided::normalize(guided::sub(t.pos,pose.position))).unwrap_or(input_aim);
        let radar_track=reference.is_some()&&u.seeker.requested.or(u.seeker.radar_target)==reference;
        let laser_track=reference.is_some()&&u.seeker.requested.or(u.seeker.laser_target)==reference;
        let pod=unit_pod(u);
        let radar_geometry=target.is_some_and(|t|sensor_can_see(&u.profile.sensors["radar"],pose.position,&pose,t.pos,input_aim,true));
        let pod_geometry=target.is_some_and(|t|pod.is_some_and(|p|sensor_can_see(p,pose.position,&pose,t.pos,aim,false)));
        Some(guided::Support{radar:u.seeker.radar&&unit_has_radar(u)&&radar_track&&radar_geometry,
            laser:u.seeker.laser&&pod.is_some_and(|p|p["laser"]==true)&&laser_track&&pod_geometry,
            beam:u.seeker.laser&&pod.is_some_and(|p|p["beam"]==true)&&laser_track&&pod_geometry,
            position:pose.position,nose:pose.vector([0.0,0.0,1.0]),aim,manual:u.seeker.manual})
    }
    pub(crate) fn guidance_point_support(&self,launcher:UnitRef,point:[f64;3])->Option<guided::Support>{
        let u=self.units.get(&launcher.unit)?;
        if u.reference!=launcher||!u.alive()||u.controller.is_none(){return None;}
        let pose=accepted_model_pose(&u.profile.physics,&u.state);let aim=guided::normalize(guided::sub(point,pose.position));
        let pod=unit_pod(u);let tracked=u.seeker.laser_point==Some(point);
        let geometry=pod.is_some_and(|p|sensor_can_see(p,pose.position,&pose,point,aim,false));
        Some(guided::Support{radar:false,laser:u.seeker.laser&&tracked&&geometry&&pod.is_some_and(|p|p["laser"]==true),
            beam:u.seeker.laser&&tracked&&geometry&&pod.is_some_and(|p|p["beam"]==true),
            position:pose.position,nose:pose.vector([0.0,0.0,1.0]),aim,manual:u.seeker.manual})
    }
    #[cfg(test)]
    pub fn set_seeker_control(&mut self,id:u64,enabled:bool,radar:bool,target:Option<UnitRef>,ground:&SimWorld)->Result<guided::Seeker,String>{
        self.set_guidance_control(id,enabled,radar,target,false,false,[0.0;2],ground)
    }
    pub fn set_guidance_control(&mut self,id:u64,enabled:bool,radar:bool,target:Option<UnitRef>,laser:bool,ecm:bool,manual:[f64;2],ground:&SimWorld)->Result<guided::Seeker,String>{
        self.set_guidance_control_with_sight(id,enabled,radar,target,None,laser,ecm,manual,ground)
    }
    pub fn set_guidance_control_with_sight(&mut self,id:u64,enabled:bool,radar:bool,target:Option<UnitRef>,sight:Option<[f64;3]>,laser:bool,ecm:bool,manual:[f64;2],ground:&SimWorld)->Result<guided::Seeker,String>{
        let u=self.units.get(&id).ok_or("unknown_aircraft")?;
        if !u.alive()||u.controller.is_none(){return Err("aircraft_not_controlled".into());}
        let fresh_point_attempt=sight.is_some_and(|s|u.seeker.point_request.as_ref().is_none_or(|p|p.sight!=s));
        if fresh_point_attempt{
            // An authorized new capture attempt retires the old carried lock even
            // when its new geometry/hardware checks fail; airborne pod support stays.
            let u=self.units.get_mut(&id).unwrap();u.seeker.clear_point();u.seeker.reset_track();u.seeker.requested=None;u.release_remaining=0;
        }
        let u=self.units.get(&id).unwrap();
        if !manual.iter().all(|v|v.is_finite()&&v.abs()<=1.0){return Err("invalid_manual_missile_control".into());}
        if radar&&!unit_has_radar(u){return Err("radar_not_fitted_or_destroyed".into());}
        if laser&&!unit_pod(u).is_some_and(|p|p["laser"]==true||p["beam"]==true){return Err("laser_designator_not_fitted_or_destroyed".into());}
        if ecm&&!u.stores.iter().any(|s|!s.gone&&s.def["kind"]=="ecm"){return Err("ecm_not_fitted_or_destroyed".into());}
        if target.is_some()&&sight.is_some(){return Err("conflicting_point_target".into());}
        if let Some(reference)=target{
            let t=self.guidance_target(reference).or_else(||ground.guidance_target(reference)).ok_or("stale_seeker_target")?;
            if reference.battle!=u.reference.battle||!t.alive||t.team==if u.team==Team::Blue{0}else{1}{return Err("invalid_seeker_target".into());}
        }
        let point_result:Result<_,String>=(||{Ok(if let Some(sight)=sight{
            if !enabled||!sight.iter().all(|v|v.is_finite())||(guided::length(sight)-1.0).abs()>1e-4{return Err("invalid_point_sight".into());}
            let (store,config)=u.stores.iter().enumerate().find_map(|(i,s)|{
                if !store_selected(u.weapon_control.as_ref(),i,s)||s.gone||s.count==0{return None;}
                guided::Config::from_store(&s.def).ok().map(|c|(s.value["id"].as_str().unwrap_or(""),c))
            }).ok_or("point_guidance_unsupported")?;
            if config.air_target||!matches!(config.mode,guided::Mode::Tv|guided::Mode::Iir|guided::Mode::Laser|guided::Mode::Beam){return Err("point_guidance_unsupported".into());}
            let pose=accepted_model_pose(&u.profile.physics,&u.state);let nose=pose.vector([0.0,0.0,1.0]);
            let prior=u.seeker.point_request.as_ref().filter(|p|p.store==store&&p.sight==sight);
            let p=if let Some(prior)=prior{prior.point}else{
                if guided::angle(nose,sight)>config.gimbal{return Err("point_outside_gimbal".into());}
                ground.guidance_point_contact(id,pose.position,sight,config.range)?.ok_or("point_no_surface_contact")?
            };
            if guided::length(guided::sub(p,pose.position))<config.min_range{return Err("point_below_minimum_range".into());}
            if guided::angle(nose,guided::sub(p,pose.position))>config.gimbal{return Err("point_outside_gimbal".into());}
            if !guided::point_eligible(&config,pose.position,nose,guided::sub(p,pose.position),p){return Err("no_valid_point_in_seeker".into());}
            Some((sight,p,store.to_owned()))
        }else{None})})();
        let point=point_result?;
        let redirects_designator=target.is_some()&&u.stores.iter().enumerate().find_map(|(i,s)|{
            if !store_selected(u.weapon_control.as_ref(),i,s)||s.gone||s.count==0{return None;}
            guided::Config::from_store(&s.def).ok().map(|c|c.mode)
        }).is_some_and(|mode|matches!(mode,guided::Mode::Laser|guided::Mode::Beam));
        let u=self.units.get_mut(&id).unwrap();u.seeker.set(enabled,radar,target);u.seeker.laser=laser;u.seeker.ecm=ecm;u.seeker.manual=manual;
        if redirects_designator{u.seeker.laser_point=None;}
        if let Some((sight,p,store))=point{
            if u.seeker.point_request.as_ref().is_none_or(|old|old.point!=p||old.store!=store){u.seeker.laser_point=None;}
            u.seeker.request_point(sight,p,store);u.seeker.laser_target=None;
        }
        if !laser{u.seeker.laser_target=None;u.seeker.laser_point=None;}
        Ok(u.seeker.clone())
    }
    pub(crate) fn acknowledge_point_capture(&mut self,id:u64,seq:u64){
        if let Some(u)=self.units.get_mut(&id){if u.seeker.point_request.is_some(){u.seeker.accepted_capture_seq=seq;}}
    }
    pub fn set_weapon_control(&mut self, id: u64, mut store_id: Option<String>, store_index: Option<usize>, program: String, gun_mode: String) -> Result<AirWeaponControlView, String> {
        if !matches!(program.as_str(), "single" | "pair" | "held" | "s4" | "s8" | "all") {
            return Err("unsupported_release_program".into());
        }
        if !matches!(gun_mode.as_str(), "all" | "cannon") { return Err("unsupported_gun_mode".into()); }
        let unit = self.units.get(&id).ok_or("unknown_aircraft")?;
        if !unit.alive() { return Err("aircraft_lost".into()); }
        if unit.controller.is_none() { return Err("not_controlled".into()); }
        if let Some(index) = store_index {
            let store = unit.stores.get(index).ok_or("unknown_accepted_store_index")?;
            let actual = store.value["id"].as_str().ok_or("invalid_accepted_store")?;
            if store_id.as_deref().is_some_and(|id| id != actual) { return Err("store_id_index_mismatch".into()); }
            store_id = Some(actual.into());
        }
        if store_id.as_deref().is_some_and(|id| !unit.stores.iter().any(|store| store.value["id"] == id)) {
            return Err("unknown_accepted_store_id".into());
        }
        let control = AirWeaponControlView { store_id, store_index, program, gun_mode };
        if let Some(kind) = selected_release_kind(&unit.stores, Some(&control), &self.template.definitions) {
            if release_program(kind, &control.program).is_none() { return Err("release_program_not_valid_for_store_kind".into()); }
        } else if control.store_id.is_some() || control.store_index.is_some() {
            return Err("selected_store_has_no_native_release_payload".into());
        }
        let unit = self.units.get_mut(&id).unwrap();
        if unit.weapon_control.as_ref().is_none_or(|old| old.store_id != control.store_id
            || old.store_index != control.store_index || old.program != control.program) {
            unit.release_remaining = 0;
            unit.seeker.clear_point();
            unit.seeker.reset_track();
        }
        unit.weapon_control = Some(control.clone());
        // Selection is not a trigger edge, an inventory grant, or a flight input.
        Ok(control)
    }
    pub fn accept_input(&mut self, id: u64, input: AirInput, now: f64) -> Result<(), String> {
        if !input.valid() {
            return Err("invalid aircraft control intent".into());
        }
        let u = self.units.get_mut(&id).ok_or("unknown aircraft")?;
        if !u.alive() {
            return Err("aircraft lost".into());
        }
        if u.servicing() && !service_controls_safe(&input) {
            u.cancel_service("unsafe_controls");
        }
        u.input = input;
        u.last_input = now;
        Ok(())
    }
    pub fn release(&mut self, player: u32, now: f64) {
        let parked: Vec<_> = self
            .units
            .values()
            .filter(|u| u.controller == Some(player) && self.at_friendly_runway(u.reference.unit))
            .map(|u| u.reference.unit)
            .collect();
        for u in self
            .units
            .values_mut()
            .filter(|u| u.controller == Some(player))
        {
            u.cancel_service("control_released");
            u.parked = parked.contains(&u.reference.unit);
            u.controller = None;
            u.epoch += 1;
            u.pose_admission = None;
            u.last_seq = 0;
            u.last_input = now;
            u.input.fire = false;
            u.input.release = false;
            u.release_remaining = 0;
            u.seeker.set(false,false,None);u.seeker.laser=false;u.seeker.laser_point=None;u.seeker.ecm=false;u.seeker.manual=[0.0;2];
        }
    }
    pub fn unpark(&mut self, id: u64) {
        if let Some(u) = self.units.get_mut(&id) {
            u.parked = false;
        }
    }
    #[cfg(test)]
    pub(crate) fn test_spawn_at(&mut self, id: u64, spawn: FlightSpawn) {
        let u = self.units.get_mut(&id).unwrap();
        u.runtime.spawn(spawn).unwrap();
        let t = u.runtime.telemetry().unwrap();
        u.state = t.state;
        u.aero = t.aero;
    }
    pub fn step(&mut self, dt: f64, ground: &mut SimWorld) -> Vec<SimEvent> {
        if !dt.is_finite() || dt <= 0.0 || dt > 0.025 {
            return Vec::new();
        }
        let started = self.timings.as_ref().map(|_| Instant::now());
        let views = self.kinematics();
        let tanks = ground.kinematics();
        if let (Some(t), Some(start)) = (self.timings.as_mut(), started) {
            t.kinematics_ns += start.elapsed().as_nanos() as u64;
        }
        self.step_with_kinematics(dt, ground, views, tanks)
    }
    fn kinematics(&self) -> Vec<AirKinematics> {
        self.units
            .values()
            .map(|u| AirKinematics {
                team: u.team,
                alive: u.alive(),
                pos: u.pos(),
                velocity: [u.state[7] as f64, u.state[8] as f64, u.state[9] as f64],
            })
            .collect()
    }
    fn step_with_kinematics(
        &mut self,
        dt: f64,
        ground: &mut SimWorld,
        views: Vec<AirKinematics>,
        tanks: Vec<SimKinematics>,
    ) -> Vec<SimEvent> {
        self.time += dt;
        if let Some(t) = self.timings.as_mut() {
            t.steps += 1;
        }
        #[cfg(not(test))]
        let legacy_oracle = false;
        #[cfg(test)]
        let legacy_oracle = self.legacy_target_oracle;
        let mut events = Vec::new();
        let mut guidance_targets:Vec<_>=self.units.values().filter_map(|u|self.guidance_target(u.reference)).collect();
        guidance_targets.extend(ground.guidance_targets());
        let target = self.map["objectives"]
            .as_array()
            .and_then(|v| v.iter().find(|o| o["id"] == "C2"))
            .and_then(|v| vector(&v["pos"]))
            .unwrap();
        let fields = ai_runway_candidates(&self.map, &self.service_availability, &self.ground);
        let traffic: Vec<_> = self
            .units
            .values()
            .map(|u| AiTraffic {
                id: u.reference.unit,
                pos: u.pos(),
                alive: u.alive(),
                span: u.profile.physics.airframe[3] as f64,
            })
            .collect();
        for u in self.units.values_mut() {
            // Existing emitted decoys expire even after their aircraft is lost.
            u.countermeasures.step(dt);
            if u.fault.is_some() || u.state[22] > 0.5 {
                u.cancel_service("aircraft_lost");
                u.release_remaining = 0;
                u.flow = 0.0;
                continue;
            }
            let damage_start = self.timings.as_ref().map(|_| Instant::now());
            let mut rng = Rng::new(u.reference.unit ^ ((self.time * 120.0) as u64));
            u.damage.step(dt, &mut rng);
            if u.servicing() {
                let reason = if u.controller.is_none() && !u.autonomous_service_authorized() {
                    Some("control_released".to_string())
                } else if u.damage.revision != u.service.damage_revision {
                    Some("new_damage".to_string())
                } else {
                    service_location(u, &self.map, &self.service_availability, &self.ground)
                        .and_then(|field| {
                            if Some(field.as_str()) == u.service.view.airfield.as_deref() {
                                Ok(field)
                            } else {
                                Err("left_service_area".into())
                            }
                        })
                        .err()
                };
                if let Some(reason) = reason {
                    u.cancel_service(&reason);
                }
            }
            if let (Some(t), Some(start)) = (self.timings.as_mut(), damage_start) {
                t.damage_service_ns += start.elapsed().as_nanos() as u64;
            }
            let targeting_start = self.timings.as_ref().map(|_| Instant::now());
            if u.servicing() {
                // The same original aircraft plant still runs at120Hz. There is
                // no parked/spawn shortcut or resource grant while it waits.
                u.input = service_hold_input(&u.state);
                u.release_remaining = 0;
            } else if u.controller.is_none() && u.parked {
                u.release_remaining = 0;
                u.input = AirInput {
                    aim: [u.state[48], u.state[49], u.state[50]],
                    throttle: 0.0,
                    manual_pitch: 0.0,
                    manual_roll: 0.0,
                    manual_yaw: 0.0,
                    flags: 1 | 4 | 128 | 16,
                    fire: false,
                    release: false,
                };
            } else if u.controller.is_none()
                && control_ai_sortie(
                    u,
                    dt,
                    &fields,
                    &traffic,
                    target,
                    &self.map,
                    &self.service_availability,
                    &self.ground,
                    &self.template.definitions,
                )
            {
                // The lifecycle assigned ordinary pilot controls. The same
                // FlightRuntime below still owns every movement and contact.
            } else if u.controller.is_none() {
                let pos = u.pos();
                let enemy = nearest_visible(
                    &views,
                    pos,
                    12000.0,
                    |v| v.team != u.team && v.alive,
                    |v| v.pos,
                    |v| ground.line_of_sight(pos, v.pos),
                    legacy_oracle,
                );
                let victim = nearest_visible(
                    &tanks,
                    pos,
                    7000.0,
                    |v| v.team != (if u.team == Team::Blue { 0 } else { 1 }) && v.alive,
                    |v| v.pos,
                    |v| ground.line_of_sight(pos, [v.pos[0], v.pos[1] + 1.0, v.pos[2]]),
                    legacy_oracle,
                );
                let aim_at = if let Some(e) = enemy {
                    let lead = distance(pos, e.pos) / 800.0;
                    [
                        e.pos[0] + e.velocity[0] * lead,
                        e.pos[1] + e.velocity[1] * lead,
                        e.pos[2] + e.velocity[2] * lead,
                    ]
                } else if let Some(e) = victim {
                    [e.pos[0], e.pos[1] + 1.0, e.pos[2]]
                } else {
                    [target[0], target[1] + 1600.0, target[2]]
                };
                let mut direction = normalize(sub(aim_at, pos));
                if u.state[35] < 450.0 {
                    direction = normalize([direction[0], 0.6, direction[2]]);
                }
                let forward = [u.state[48] as f64, u.state[49] as f64, u.state[50] as f64];
                let firing = (enemy.is_some() || victim.is_some())
                    && distance(pos, aim_at) < 1800.0
                    && dot(forward, direction) > 0.998
                    && u.state[35] > 250.0;
                u.input = AirInput {
                    aim: direction.map(|v| v as f32),
                    throttle: 0.85,
                    manual_pitch: 0.0,
                    manual_roll: 0.0,
                    manual_yaw: 0.0,
                    flags: 1,
                    fire: firing,
                    release: false,
                };
            } else if self.time - u.last_input > 0.5 {
                u.release_remaining = 0;
                let near_ground = u.state[35] < 3.0 && u.state[75] < 30.0;
                let retained_flags = u.input.flags & (4 | 8 | 16 | 64 | 128);
                u.input = AirInput {
                    aim: normalize([u.state[48] as f64, 0.0, u.state[50] as f64]).map(|v| v as f32),
                    throttle: if near_ground { 0.0 } else { 0.78 },
                    manual_pitch: 0.0,
                    manual_roll: 0.0,
                    manual_yaw: 0.0,
                    flags: if near_ground {
                        1 | 4 | 128 | 16
                    } else {
                        1 | 32 | retained_flags
                    },
                    fire: false,
                    release: false,
                };
            }
            if let (Some(t), Some(start)) = (self.timings.as_mut(), targeting_start) {
                t.targeting_ns += start.elapsed().as_nanos() as u64;
            }
            let preparation_start = self.timings.as_ref().map(|_| Instant::now());
            let mut changed = false;
            for s in &mut u.stores {
                let owner = s.value["owner"].as_str().unwrap_or("body");
                if !s.gone && owner != "body" && (u.damage.dead(owner) || u.damage.gone(owner)) {
                    s.gone = true;
                    s.count = 0;
                    s.fuel = 0.0;
                    changed = true;
                }
            }
            let total = u.fuel
                + u.stores
                    .iter()
                    .filter(|s| !s.gone)
                    .map(|s| s.fuel)
                    .sum::<f64>();
            let mut factors = damage_flight(&u.damage);
            if total <= 0.0 {
                factors[0] = 0.0;
            }
            if let (Some(t), Some(start)) = (self.timings.as_mut(), preparation_start) {
                t.damage_service_ns += start.elapsed().as_nanos() as u64;
            }
            let runtime_start = self.timings.as_ref().map(|_| Instant::now());
            let outcome = (|| -> Result<(), String> {
                if changed || (u.mass_fuel - u.fuel).abs() > 25.0 {
                    u.configure_mass()?;
                }
                u.runtime.set_damage(factors).map_err(|e| e.to_string())?;
                u.runtime
                    .step(dt as f32, &u.input.flight())
                    .map_err(|e| e.to_string())?;
                let t = u.runtime.telemetry().map_err(|e| e.to_string())?;
                u.state = t.state;
                u.aero = t.aero;
                // Accepted C214 telemetry alone owns wind-load exposure. A
                // browser's damage/repair fields never enter this calculation.
                let effects = airframe_limits::advance(
                    &mut u.airframe_limits,
                    &self.template.limits.aircraft[&u.aircraft],
                    &self.template.limits.rules,
                    &u.state,
                    dt,
                );
                if effects.structure_delta > 0.0 && !u.damage.broken {
                    for id in ["wing_l", "wing_r"] {
                        if let Some(amount) = u.damage.parts.iter()
                            .find(|p| p.def.id == id).map(|p| {
                                // End the original part's HP exactly at full
                                // exposure; fractional subtraction can leave
                                // positive roundoff before break_up zeros HP.
                                if u.airframe_limits.structure_fraction >= 1.0 { p.hp }
                                else { p.def.hp * effects.structure_delta }
                            }) {
                            u.damage.structural_harm(id, amount);
                        }
                    }
                    if u.airframe_limits.structure_fraction >= 1.0 {
                        u.damage.break_up();
                    }
                    factors = damage_flight(&u.damage);
                    if total <= 0.0 { factors[0] = 0.0; }
                    u.runtime.set_damage(factors).map_err(|e| e.to_string())?;
                }
                if effects.gear_failed_now {
                    u.runtime.set_gear_failure(true).map_err(|e| e.to_string())?;
                    let t = u.runtime.telemetry().map_err(|e| e.to_string())?;
                    u.state = t.state;
                    u.aero = t.aero;
                    u.resource_revision += 1;
                }
                Ok(())
            })();
            if let (Some(t), Some(start)) = (self.timings.as_mut(), runtime_start) {
                t.runtime_ns += start.elapsed().as_nanos() as u64;
            }
            if let Err(e) = outcome {
                u.cancel_service("runtime_fault");
                u.fault = Some(e);
                continue;
            }
            let weapons_start = self.timings.as_ref().map(|_| Instant::now());
            u.flow = if total > 0.0
                && !u.damage.broken
                && !u.damage.dead("engine")
                && !u.damage.dead("prop")
                && !(u.state[35] < 2.3 && u.state[27] < 0.06)
            {
                fuel_flow(&u.profile, u.state[27] as f64)
            } else {
                0.0
            };
            let mut burn = u.flow * dt;
            for s in u.stores.iter_mut().filter(|s| !s.gone && s.fuel > 0.0) {
                let take = burn.min(s.fuel);
                s.fuel -= take;
                burn -= take;
            }
            u.fuel = (u.fuel - burn).max(0.0);
            if !u.alive() {
                u.input.fire = false;
                u.input.release = false;
                u.release_remaining = 0;
            }
            let cannon_only = u.weapon_control.as_ref().is_some_and(|control| control.gun_mode == "cannon");
            let pose = u.state.clone();
            let model_pose = accepted_model_pose(&u.profile.physics, &pose);
            if !u.alive()||u.controller.is_none(){u.seeker.clear_point();u.seeker.laser_point=None;}
            if u.seeker.laser_point.is_some()&&!unit_pod(u).is_some_and(|p|p["laser"]==true||p["beam"]==true){u.seeker.laser_point=None;}
            let selected_guided=u.stores.iter().enumerate().find_map(|(i,s)|{
                // Preparation belongs only to a live carried store. In-flight weapons
                // retain independent source radar/designator tracks, even after X cancels preparation.
                if !store_selected(u.weapon_control.as_ref(),i,s)||s.gone||s.count==0{return None;}
                guided::Config::from_store(&s.def).ok().map(|c|(s.value["id"].as_str().unwrap_or(""),c))
            });
            if let Some((store_id,config))=selected_guided{
                let pos=model_pose.position;let nose=model_pose.vector([0.0,0.0,1.0]);let input_aim=u.input.aim.map(|v|v as f64);let team=if u.team==Team::Blue{0}else{1};
                // A pod's requested UnitRef is a pointing intent independent of the
                // aircraft flight director. Resolve the bearing here; never accept a hit coordinate.
                let aim=if matches!(config.mode,guided::Mode::Laser|guided::Mode::Beam|guided::Mode::Tv|guided::Mode::Iir){
                    u.seeker.requested.and_then(|r|guidance_targets.iter().find(|t|t.reference==r&&t.alive))
                        .map(|t|guided::normalize(guided::sub(t.pos,pos))).unwrap_or(input_aim)
                }else{input_aim};
                let blocked=if config.radar()&&!unit_has_radar(u){Some("radar_not_fitted_or_destroyed")}
                    else if config.mode==guided::Mode::Aim54&&u.profile.sensors["radar"]["phoenix"]!=true{Some("phoenix_radar_required")}
                    else if config.mode==guided::Mode::Laser&&!unit_pod(u).is_some_and(|p|p["laser"]==true){Some("laser_designator_not_fitted_or_destroyed")}
                    else if config.mode==guided::Mode::Beam&&!unit_pod(u).is_some_and(|p|p["beam"]==true){Some("beam_sight_not_fitted_or_destroyed")}else{None};
                if let Some(reason)=blocked{u.seeker.reset_track();u.seeker.reason=Some(reason.into());}
                else{
                    let sensor=if config.radar(){Some(&u.profile.sensors["radar"])}else if matches!(config.mode,guided::Mode::Laser|guided::Mode::Beam){profile_pod(&u.profile,&u.stores)}else{None};
                    if let Some(point)=u.seeker.point_request.as_ref().map(|p|p.point){
                        let point_aim=guided::normalize(guided::sub(point,pos));
                        let visible=sensor.is_none_or(|sensor|sensor_can_see(sensor,pos,&model_pose,point,point_aim,false))
                            &&ground.guidance_point_visible(u.reference.unit,pos,point);
                        u.seeker.track_point(store_id,&config,pos,nose,dt,visible);
                    }else{
                        u.seeker.track(store_id,&config,team,pos,nose,aim,&guidance_targets,dt,|target|
                            sensor.is_none_or(|sensor|sensor_can_see(sensor,model_pose.position,&model_pose,target.pos,aim,config.radar()))
                            &&ground.perception_los(u.reference.unit,target.reference.unit,pos,target.pos));
                    }
                }
            }else {u.seeker.clear_point();u.seeker.reset_track();}
            for g in &mut u.guns {
                g.cool -= dt;
                if !u.input.fire
                    || g.ammo == 0
                    || cannon_only && (g.profile.belt.is_empty() || !g.profile.belt.iter()
                        .all(|id| self.template.shells.get(id).is_some_and(|shell| shell.caliber_mm >= 20.0)))
                    || g.store_index.is_some_and(|index| {
                        u.stores.get(index).is_none_or(|s| s.gone || s.count == 0)
                            || u.damage.dead("ammo")
                            || u.damage.dead("gun")
                    })
                    || g.profile.owner != "body"
                        && (u.damage.dead(&g.profile.owner) || u.damage.gone(&g.profile.owner))
                {
                    g.cool = g.cool.max(0.0);
                    continue;
                }
                while g.cool <= 0.0 && g.ammo > 0 {
                    let sid = &g.profile.belt[g.fired as usize % g.profile.belt.len()];
                    let shell = self.template.shells[sid].clone();
                    let mi = g.fired as usize % g.profile.mounts.len().max(1);
                    let local = g.profile.mounts.get(mi).copied().unwrap_or(g.profile.mount);
                    let dir = model_pose.vector(
                        g.profile
                            .directions
                            .get(mi)
                            .copied()
                            .unwrap_or([0.0, 0.0, 1.0]),
                    );
                    let p = model_pose.point(local);
                    let velocity = add(
                        [pose[7] as f64, pose[8] as f64, pose[9] as f64],
                        scale(dir, shell.muzzle_velocity_ms as f64),
                    );
                    if let Ok(event) = ground.launch_air_round(
                        u.reference.unit,
                        if u.team == Team::Blue { 0 } else { 1 },
                        shell,
                        p,
                        velocity,
                        None,
                        &g.profile.id,
                        u.resource_revision + 1,
                    ) {
                        events.push(event);
                        g.ammo -= 1;
                        g.fired += 1;
                        g.cool += 60.0 / g.profile.rpm;
                        u.resource_revision += 1;
                    } else {
                        g.cool = 0.0;
                        break;
                    }
                }
            }
            u.release_cooldown = (u.release_cooldown - dt).max(0.0);
            let kind = selected_release_kind(&u.stores, u.weapon_control.as_ref(), &self.template.definitions);
            let program = kind.and_then(|kind| {
                if let Some(control) = &u.weapon_control { release_program(kind, &control.program) }
                else { Some(ReleaseProgram { count:1, together:1, interval:match kind {ReleaseKind::Bomb=>0.15,ReleaseKind::Rocket=>0.08,ReleaseKind::Missile=>0.3}, held:false }) }
            });
            if let Some(program) = program {
                let available = available_selected_rounds(&u.stores, u.weapon_control.as_ref(), &self.template.definitions);
                if u.input.release && !u.release_held && (u.weapon_control.is_some() || u.release_cooldown <= 0.0) {
                    u.release_remaining = program.count.min(available);
                }
                if u.release_cooldown <= 0.0 && (u.release_remaining > 0 || program.held && u.input.release) {
                    let together = if u.release_remaining > 0 { program.together.min(u.release_remaining) } else {1};
                    for _ in 0..together {
                        let eligible = |index:usize,store:&Store| store_selected(u.weapon_control.as_ref(),index,store)
                            && !store.gone && store.count > 0 && payload(&store.def,&self.template.definitions).is_some();
                        let desired_side = if u.release_last_side == 0 {-1} else {-u.release_last_side};
                        let alternate = u.weapon_control.as_ref().is_some_and(|control|control.store_index.is_none());
                        let index = u.stores.iter().enumerate()
                            .find(|(index,store)|eligible(*index,store) && (!alternate || store.value["side"].as_i64()==Some(desired_side)))
                            .or_else(||u.stores.iter().enumerate().find(|(index,store)|eligible(*index,store)))
                            .map(|(index,_)|index);
                        let Some(index) = index else {u.release_remaining=0;break;};
                        let store = &mut u.stores[index];
                        let def = payload(&store.def,&self.template.definitions).unwrap();
                        let kind = def["kind"].as_str().unwrap();
                        let guided=if def["guidance"].as_str().is_some() {
                            let Ok(config)=guided::Config::from_store(def) else {u.seeker.reason=Some("invalid_native_guidance_config".into());u.release_remaining=0;break;};
                            let target=u.seeker.target.filter(|_|u.seeker.status=="track").and_then(|r|guidance_targets.iter().find(|t|t.reference==r&&t.alive)).copied();
                            let point=u.seeker.point.filter(|_|u.seeker.status=="track"&&target.is_none());
                            let same_config=u.seeker.store.as_deref()==store.value["id"].as_str();
                            let allowed=same_config&&(target.is_some()||point.is_some()||u.seeker.status=="ready"&&(config.mode==guided::Mode::Radio||config.loal));
                            if !allowed{u.seeker.reason=Some("seeker_not_locked_or_ready".into());u.release_remaining=0;break;}
                            if config.mode==guided::Mode::Radio&&ground.has_radio_missile(u.reference){u.seeker.reason=Some("radio_missile_already_controlled".into());u.release_remaining=0;break;}
                            Some(if let Some(point)=point{match guided::Missile::launch_point(config,store.value["id"].as_str().unwrap().into(),u.reference,point){
                                Ok(missile)=>missile,Err(reason)=>{u.seeker.reason=Some(reason);u.release_remaining=0;break;}
                            }}else{guided::Missile::launch_optional(config,store.value["id"].as_str().unwrap().into(),u.reference,target)})
                        }else{None};
                        let cluster=def["cluster"].as_object().and_then(|_|{
                            let child=self.template.definitions.get(def["cluster"]["sub"].as_str()?)?;
                            Some(crate::frontline_sim::ClusterPayload{shell:self.template.shells.get(child["warhead"]["id"].as_str()?)?.clone(),
                                store_id:def["cluster"]["sub"].as_str()?.into(),count:def["cluster"]["n"].as_u64()?.min(128) as u32,
                                open:def["cluster"]["open"].as_f64()?,spread:def["cluster"]["spread"].as_f64()?,mass:child["mass"].as_f64()?,diameter:child["d"].as_f64()?})
                        });
                        let shell = if kind=="aam" {air_missile_shell(store.value["id"].as_str().unwrap(),def).expect("admitted finite missile warhead")}
                            else {self.template.shells[def["warhead"]["id"].as_str().unwrap()].clone()};
                        let local = vector(&store.value["p"]).unwrap();
                        let dir = model_pose.vector([0.0,0.0,1.0]);
                        let pos = model_pose.point(local);
                        let velocity = add([u.state[7] as f64,u.state[8] as f64,u.state[9] as f64],
                            if kind=="bomb" {model_pose.vector([0.0,-2.0,0.0])} else {scale(dir,20.0)});
                        let propulsion = crate::frontline_sim::AirOrdnance {
                            store_id:store.value["id"].as_str().unwrap().into(),cluster,
                            ramjet:def["ramjet"].as_object().and_then(|_|Some([def["ramjet"]["speed"].as_f64()?,def["ramjet"]["time"].as_f64()?,def["ramjet"]["k"].as_f64()?])),
                            direction:dir,bomb:kind=="bomb",diameter:def["d"].as_f64().unwrap(),
                            mass:def["mass"].as_f64().unwrap(),dv:def["dv"].as_f64().unwrap_or(0.0),burn:def["burn"].as_f64().unwrap_or(0.0),
                            sustain:def["sustain"].as_array().and_then(|a|Some([a.first()?.as_f64()?,a.get(1)?.as_f64()?])),guided,
                        };
                        match ground.launch_air_round(u.reference.unit,if u.team==Team::Blue {0}else{1},
                            shell,pos,velocity,Some(propulsion),"store",u.resource_revision+1) {
                            Ok(event) => {
                                events.push(event);
                                store.count-=1;
                                if store.count==0 && store.def["kind"]!="pod" {store.gone=true;}
                                let side=store.value["side"].as_i64().unwrap_or(0);
                                if side!=0 {u.release_last_side=side;} else if u.release_last_side==0 {u.release_last_side=1;}
                                u.release_remaining=u.release_remaining.saturating_sub(1);
                                u.resource_revision+=1;
                                u.release_cooldown=program.interval;
                                changed=true;
                                if matches!(def["guidance"].as_str(),Some("ir"|"tv"|"iir")){u.seeker.reset_track();}
                            }
                            Err(_) => {u.release_remaining=0;break;}
                        }
                    }
                }
            } else { u.release_remaining=0; }
            u.release_held = u.input.release;
            if changed {
                u.resource_revision += 1;
                if let Err(e) = u.configure_mass() {
                    u.fault = Some(e);
                }
            }
            if u.servicing() {
                if let Err(reason) =
                    service_location(u, &self.map, &self.service_availability, &self.ground)
                {
                    u.cancel_service(&reason);
                    continue;
                }
                u.service.view.elapsed_s = (u.service.view.elapsed_s + dt).min(AIR_SERVICE_SECONDS);
                u.service.view.remaining_s =
                    (AIR_SERVICE_SECONDS - u.service.view.elapsed_s).max(0.0);
                if u.service.view.elapsed_s + 1e-9 >= AIR_SERVICE_SECONDS {
                    let candidate = u
                        .service
                        .pending_loadout
                        .clone()
                        .ok_or_else(|| "missing_approved_service_loadout".to_string())
                        .and_then(|accepted| {
                            let stores =
                                stores_from_loadout(&accepted.value, &self.template.definitions)?;
                            Ok((accepted, stores))
                        });
                    match candidate
                        .and_then(|(accepted, stores)| u.complete_service(accepted, stores, u.service.pending_fuel_minutes))
                    {
                        Ok(()) => events.push(SimEvent {
                            kind: "air_service_complete".into(),
                            shooter: Some(u.reference.unit),
                            target: Some(u.reference.unit),
                            pos: u.pos(),
                            detail: json!({"unit":u.reference,"loadout":u.loadout,"custom":u.custom,
                                "resource_revision":u.resource_revision,
                                "service_revision":u.service.view.revision,
                                "service":u.service.view}),
                        }),
                        Err(error) => {
                            // A failed reconfigure faults the aircraft and grants
                            // no new inventory; it cannot continue half repaired.
                            u.cancel_service("runtime_fault");
                            u.fault = Some(error);
                        }
                    }
                }
            }
            if let (Some(t), Some(start)) = (self.timings.as_mut(), weapons_start) {
                t.weapons_ns += start.elapsed().as_nanos() as u64;
            }
        }
        events
    }
    pub fn first_contact(
        &self,
        a: [f64; 3],
        b: [f64; 3],
        shooter: u64,
    ) -> Option<(f64, u64, [f64; 3])> {
        self.units
            .values()
            .filter(|u| u.reference.unit != shooter)
            .filter_map(|u| {
                let pose = accepted_model_pose(&u.profile.physics, &u.state);
                let lo = pose.local_point(a);
                let hi = pose.local_point(b);
                let ty = &self.template.damage_types[&u.aircraft];
                ty.skin
                    .iter()
                    .filter_map(|s| crate::aircraft::slab(lo, hi, s.c, s.h))
                    // AirDamage.hit already accepts active module/structure
                    // boxes outside skin (e.g. Me262 underwing engines). The
                    // initial query must reach that same accepted model.
                    .chain(
                        u.damage
                            .parts
                            .iter()
                            .filter(|p| !p.detached)
                            .filter_map(|p| crate::aircraft::slab(lo, hi, p.def.c, p.def.h)),
                    )
                    .min_by(f64::total_cmp)
                    .map(|t| {
                        (
                            distance(a, b) * t,
                            u.reference.unit,
                            add(a, scale(sub(b, a), t)),
                        )
                    })
            })
            .min_by(|a, b| a.0.total_cmp(&b.0))
    }
    pub fn hit(
        &mut self,
        id: u64,
        a: [f64; 3],
        b: [f64; 3],
        shell: &ProjectileDef,
        velocity: [f64; 3],
        team: u8,
        seed: u64,
        friendly_damage: bool,
    ) -> Option<Value> {
        let u = self.units.get_mut(&id)?;
        let friendly = (u.team == Team::Blue) == (team == 0);
        if friendly && !friendly_damage {
            return Some(
                json!({"friendly_block":true,"damage_applied":false,"damage_changed":false,"contact_model":"accepted_aircraft_boxes"}),
            );
        }
        if !u.alive() {
            return Some(
                json!({"dead_target":true,"damage_applied":false,"damage_changed":false,
                "contact_model":"accepted_aircraft_boxes"}),
            );
        }
        let pose = accepted_model_pose(&u.profile.physics, &u.state);
        let lo = pose.local_point(a);
        let hi = pose.local_point(b);
        let mut rng = Rng::new(seed);
        let relative = sub(
            velocity,
            [u.state[7] as f64, u.state[8] as f64, u.state[9] as f64],
        );
        let previous_revision = u.damage.revision;
        let mut hit = u.damage.hit_projectile(
            lo,
            hi,
            0.5 * shell.mass_kg as f64 * dot(relative, relative),
            shell,
            &mut rng,
        )?;
        // Preserve the accepted contact pose with each actual burst. The
        // client cannot reconstruct this from a later interpolated aircraft.
        for burst in hit.bursts.as_mut().into_iter().flatten() {
            if let Some(point)=vector(&burst["point"]) {
                burst["world_position"]=json!(pose.point(point));
            }
        }
        let changed = u.damage.revision != previous_revision;
        if changed {
            u.cancel_service("new_damage");
        }
        Some(
            json!({"hit":hit,"damage":u.damage.snapshot(),"damage_applied":changed,
                "damage_changed":changed,"contact_model":"accepted_aircraft_boxes"}),
        )
    }
    pub fn blast(
        &mut self,
        pos: [f64; 3],
        tnt: f64,
        team: u8,
        seed: u64,
        friendly_damage: bool,
        exclude: Option<u64>,
    ) -> Vec<u64> {
        let mut affected = Vec::new();
        if !tnt.is_finite() || tnt <= 0.0 {
            return affected;
        }
        for u in self.units.values_mut().filter(|u| {
            exclude != Some(u.reference.unit)
                && u.alive()
                && (friendly_damage || (u.team == Team::Blue) != (team == 0))
        }) {
            let pose = accepted_model_pose(&u.profile.physics, &u.state);
            if distance(pose.position, pos) > 80.0_f64.max(tnt.cbrt() * 15.0) {
                continue;
            }
            let local = pose.local_point(pos);
            let previous_revision = u.damage.revision;
            u.damage.blast(
                local,
                tnt,
                &mut Rng::new(seed ^ u.reference.unit),
                &mut vec![],
            );
            if u.damage.revision != previous_revision {
                u.cancel_service("new_damage");
                affected.push(u.reference.unit);
            }
        }
        affected
    }
    pub fn at_friendly_runway(&self, id: u64) -> bool {
        let Some(u) = self.units.get(&id) else {
            return false;
        };
        if !u.alive()
            || u.speed() > 1.5
            || u.state[35] > 3.0
            || !self.ground.runway_available_at(u.pos()[0], u.pos()[2])
        {
            return false;
        }
        self.map["airfields"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|f| {
                f["enabled"] == true
                    && f["team"].as_u64() == Some(if u.team == Team::Blue { 0 } else { 1 })
            })
            .filter_map(landing)
            .any(|l| {
                let p = u.pos();
                let dx = p[0] - l.center[0];
                let dz = p[2] - l.center[1];
                (dx * l.forward[1] - dz * l.forward[0]).abs() <= l.half_width
                    && (dx * l.forward[0] + dz * l.forward[1]).abs() <= l.half_length
            })
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum AiSortiePhase {
    Patrol,
    Return,
    Align,
    Approach,
    Rollout,
    Taxi,
    Service,
    Lineup,
    Takeoff,
    Departure,
    Holding,
}
impl AiSortiePhase {
    fn name(self) -> &'static str {
        match self {
            Self::Patrol => "patrol",
            Self::Return => "return",
            Self::Align => "align",
            Self::Approach => "approach",
            Self::Rollout => "rollout",
            Self::Taxi => "taxi",
            Self::Service => "servicing",
            Self::Lineup => "lineup",
            Self::Takeoff => "takeoff",
            Self::Departure => "departure",
            Self::Holding => "holding_for_runway",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub(crate) struct AiSortieView {
    pub phase: &'static str,
    pub airfield: Option<String>,
    pub completed_sorties: u32,
    pub reason: Option<String>,
}
#[derive(Clone, Debug)]
struct AiRunway {
    id: String,
    team: Team,
    center: [f64; 2],
    forward: [f64; 2],
    height: f64,
    half_width: f64,
    interval: [f64; 2],
    supplied: bool,
}
impl AiRunway {
    fn point(&self, lateral: f64, longitudinal: f64, height: f64) -> [f64; 3] {
        [
            self.center[0] + self.forward[1] * lateral + self.forward[0] * longitudinal,
            self.height + height,
            self.center[1] - self.forward[0] * lateral + self.forward[1] * longitudinal,
        ]
    }
    fn coordinates(&self, p: [f64; 3]) -> [f64; 2] {
        let d = [p[0] - self.center[0], p[2] - self.center[1]];
        [
            d[0] * self.forward[1] - d[1] * self.forward[0],
            d[0] * self.forward[0] + d[1] * self.forward[1],
        ]
    }
    fn reverse(&self) -> Self {
        Self {
            forward: self.forward.map(|x| -x),
            interval: [-self.interval[1], -self.interval[0]],
            ..self.clone()
        }
    }
}
#[derive(Clone, Copy)]
struct AiTraffic {
    id: u64,
    pos: [f64; 3],
    alive: bool,
    span: f64,
}
struct AiSortieState {
    phase: AiSortiePhase,
    clock: f64,
    phase_since: f64,
    plan: Option<AiRunway>,
    next_search: f64,
    throttle_integral: f64,
    pitch_trim: f64,
    roll_trim: f64,
    last_omega: [f64; 3],
    parking: [f64; 2],
    taxi_waypoints: Vec<[f64; 2]>,
    taxi_index: usize,
    completed_sorties: u32,
    reason: Option<String>,
}
impl AiSortieState {
    fn new(on_ground: bool) -> Self {
        Self {
            phase: if on_ground {
                AiSortiePhase::Lineup
            } else {
                AiSortiePhase::Patrol
            },
            clock: 0.0,
            phase_since: 0.0,
            plan: None,
            next_search: 0.0,
            throttle_integral: 0.5,
            pitch_trim: 0.0,
            roll_trim: 0.0,
            last_omega: [0.0; 3],
            parking: [0.0; 2],
            taxi_waypoints: Vec::new(),
            taxi_index: 0,
            completed_sorties: 0,
            reason: None,
        }
    }
    fn transition(&mut self, phase: AiSortiePhase, u: &AirUnit) {
        if self.phase != phase {
            self.phase = phase;
            self.phase_since = self.clock;
        }
        self.last_omega = [u.state[10] as f64, u.state[11] as f64, u.state[12] as f64];
        self.pitch_trim = u.state[24] as f64;
        self.roll_trim = u.state[25] as f64;
    }
    fn view(&self) -> AiSortieView {
        AiSortieView {
            phase: self.phase.name(),
            airfield: self.plan.as_ref().map(|p| p.id.clone()),
            completed_sorties: self.completed_sorties,
            reason: self.reason.clone(),
        }
    }
}
fn ai_runway_candidates(
    map: &Value,
    availability: &BTreeMap<String, ServiceAvailability>,
    ground: &crate::frontline_sim::MapGround,
) -> Vec<AiRunway> {
    let mut result = Vec::new();
    for field in map["airfields"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|f| f["enabled"] == true)
    {
        let (Some(id), Some(team), Some(area), Some(height)) = (
            field["id"].as_str(),
            field["team"].as_u64(),
            landing(field),
            field["runway"]["height"].as_f64(),
        ) else {
            continue;
        };
        if team > 1 {
            continue;
        }
        let state = availability.get(id).copied().unwrap_or_default();
        if !state.runway {
            continue;
        }
        let intervals = if ground.runway_source_registered(id) {
            ground.runway_open_intervals(id)
        } else {
            vec![[-area.half_length, area.half_length]]
        };
        for interval in intervals {
            let runway = AiRunway {
                id: id.into(),
                team: if team == 0 { Team::Blue } else { Team::Red },
                center: area.center,
                forward: area.forward,
                height,
                half_width: area.half_width,
                interval,
                supplied: state.available(),
            };
            result.push(runway.reverse());
            result.push(runway);
        }
    }
    result
}
fn ai_reference_speed(u: &AirUnit) -> f64 {
    // Source airframe coefficients give a game-control estimate, not a claimed
    // historical approach speed or airfoil polar. The actual plant must fly it.
    let a = u.profile.physics.airframe;
    let lift = 0.2 + 0.1 * a[9] as f64 + 0.36;
    let supported = (2.0 * a[0] as f64 * 9.81 / (1.225 * a[1] as f64 * lift)).sqrt() * 1.10;
    (u.profile.physics.rotate_kmh / 3.6 * 1.12)
        .max(supported)
        .max(35.0)
}
fn ai_required_strip(u: &AirUnit) -> f64 {
    // Leave rollout room after the actual 300m touchdown allowance. Native
    // wheel braking is 0.32g; this budget uses 0.28g plus 100m beyond the
    // touchdown allowance. This is a source-plant planning limit.
    let speed = ai_reference_speed(u);
    (speed * speed / (2.0 * 9.81 * 0.28) + 400.0).max(if u.profile.physics.airframe[11] != 0.0 {
        1600.0
    } else {
        900.0
    })
}
fn ai_choose_runway(u: &AirUnit, fields: &[AiRunway]) -> Option<AiRunway> {
    let p = u.pos();
    let forward = [u.state[48] as f64, u.state[50] as f64];
    fields
        .iter()
        .filter(|f| {
            f.team == u.team
                && f.interval[1] - f.interval[0] >= ai_required_strip(u)
                && f.half_width * 2.0 > u.profile.physics.airframe[3] as f64 + 6.0
        })
        .min_by(|a, b| {
            let cost = |r: &AiRunway| {
                if u.state[36] == 4.0 {
                    let at = r.coordinates(p);
                    // A runway-born aircraft uses its accepted heading and
                    // current intact strip; it must never be turned by respawn.
                    return at[0].abs() * 10.0
                        + 100_000.0
                            * (1.0
                                - dot(
                                    [forward[0], 0.0, forward[1]],
                                    [r.forward[0], 0.0, r.forward[1]],
                                ))
                        + (r.interval[0] - at[1]).max(0.0) * 10.0
                        + (at[1] - r.interval[1]).max(0.0) * 10.0;
                }
                let gate = r.point(0.0, r.interval[0] - 6000.0, 450.0);
                distance(p, gate)
                    + if r.supplied { 0.0 } else { 100_000.0 }
                    + 1500.0
                        * (1.0
                            - dot(
                                [forward[0], 0.0, forward[1]],
                                [r.forward[0], 0.0, r.forward[1]],
                            ))
            };
            cost(a).total_cmp(&cost(b))
        })
        .cloned()
}
fn ai_runway_live(plan: &AiRunway, fields: &[AiRunway]) -> bool {
    fields.iter().any(|f| {
        f.id == plan.id
            && f.forward == plan.forward
            && f.interval[0] <= plan.interval[0] + 1e-5
            && f.interval[1] >= plan.interval[1] - 1e-5
    })
}
fn ai_runway_busy(u: &AirUnit, plan: &AiRunway, traffic: &[AiTraffic]) -> bool {
    traffic.iter().any(|t| {
        if !t.alive || t.id == u.reference.unit {
            return false;
        }
        let at = plan.coordinates(t.pos);
        at[0].abs() < (u.profile.physics.airframe[3] as f64 + t.span) / 2.0 + 3.0
            && at[1] >= plan.interval[0] - 1800.0
            && at[1] <= plan.interval[1] + 100.0
            && (t.pos[1] - plan.height).abs() < 120.0
    })
}
fn ai_needs_return(u: &AirUnit, fields: &[AiRunway]) -> bool {
    let stock: u32 = u.guns.iter().map(|g| g.ammo).sum();
    let full: u32 = u.guns.iter().map(|g| g.profile.ammo.round() as u32).sum();
    let fuel = u.fuel
        + u.stores
            .iter()
            .filter(|s| !s.gone)
            .map(|s| s.fuel)
            .sum::<f64>();
    let field_distance = fields
        .iter()
        .filter(|f| f.team == u.team)
        .map(|f| distance(u.pos(), [f.center[0], f.height, f.center[1]]))
        .min_by(f64::total_cmp)
        .unwrap_or(0.0);
    let cruise_flow = fuel_flow(&u.profile, 0.65);
    let reserve = (cruise_flow * (field_distance / u.speed().max(90.0) + 240.0))
        .max(u.profile.fuel.capacity * 0.20);
    (full > 0 && stock <= full / 5)
        || fuel <= reserve
        || u.damage.fire > 0.0
        || damage_flight(&u.damage)[0] < 0.7
}
/// This controller issues normal bounded controls. It measures the accepted
/// angular response to estimate trim rather than editing attitude, velocity,
/// wheel contacts or the instructor's hidden state. Its surface authority is
/// scaled by this exact source airframe's qbar/inertia and accepted coefficients.
fn ai_flight_input(
    u: &AirUnit,
    ai: &mut AiSortieState,
    dt: f64,
    course: [f64; 2],
    vertical_speed: f64,
    speed: f64,
    flags: u32,
    rollout: bool,
) -> AirInput {
    let s = &u.state;
    let a = u.profile.physics.airframe;
    let q = (s[74] as f64).max(40.0);
    let source = u.profile.physics.surfaces;
    let pc = source
        .map(|g| {
            0.26 * (if vertical_speed > s[8] as f64 {
                g[9]
            } else {
                g[10]
            }) as f64
                / 0.42
                * if g[16] != 0.0 { 1.8 } else { 1.0 }
        })
        .unwrap_or(u.aero[12] as f64)
        .max(0.025);
    let rc = (u.aero[13] as f64).max(0.015);
    let yc = (u.aero[14] as f64).max(0.01);
    let ap = q * a[1] as f64 * a[2] as f64 * pc / a[4] as f64;
    let ar = q * a[1] as f64 * a[3] as f64 * rc / a[6] as f64;
    let ay = q * a[1] as f64 * a[3] as f64 * yc / a[5] as f64;
    let omega = [s[10] as f64, s[11] as f64, s[12] as f64];
    let blend = (dt * 8.0).min(1.0);
    let derivative =
        std::array::from_fn::<_, 3, _>(|k| (omega[k] - ai.last_omega[k]) / dt.max(1e-6));
    ai.last_omega = omega;
    ai.pitch_trim +=
        ((s[24] as f64 + derivative[0] / ap.max(0.1)).clamp(-1.0, 1.0) - ai.pitch_trim) * blend;
    ai.roll_trim +=
        ((s[25] as f64 + derivative[2] / ar.max(0.1)).clamp(-1.0, 1.0) - ai.roll_trim) * blend;
    let horizontal = (s[7] as f64).hypot(s[9] as f64).max(30.0);
    let gamma = (s[8] as f64).atan2(horizontal);
    let pitch_error = if rollout {
        -(s[19] as f64)
    } else {
        vertical_speed.atan2(horizontal) - gamma
    };
    let mut pitch_rate = pitch_error.clamp(-0.12, 0.12);
    let ceiling = (a[10] as f64 * 0.85).min(0.28);
    if s[15] as f64 > ceiling && pitch_rate > 0.0 {
        pitch_rate = 0.0;
    }
    let course_heading = course[0].atan2(course[1]);
    let heading_error = wrap_angle(course_heading - s[18] as f64);
    let desired_bank = if rollout {
        0.0
    } else {
        (heading_error * 1.6).clamp(-0.70, 0.70)
    };
    let roll_rate = ((desired_bank - s[20] as f64) * 1.8).clamp(-1.0, 1.0);
    let pitch = (ai.pitch_trim + (pitch_rate + omega[0]) / (ap * 0.35).max(0.4)).clamp(-1.0, 1.0);
    let roll = (ai.roll_trim + (roll_rate + omega[2]) / (ar * 0.18).max(0.8)).clamp(-1.0, 1.0);
    let coordinated = 9.81 / horizontal.max(45.0) * (s[20] as f64).sin();
    let yaw =
        (-1.5 * s[16] as f64 + (coordinated - omega[1]) / (ay * 0.35).max(0.5)).clamp(-0.45, 0.45);
    let error = speed - s[14] as f64;
    ai.throttle_integral = (ai.throttle_integral + error * 0.01 * dt).clamp(0.02, 0.95);
    AirInput {
        aim: [course[0] as f32, 0.0, course[1] as f32],
        throttle: if rollout {
            0.0
        } else {
            (ai.throttle_integral + error * 0.025).clamp(0.0, 1.0) as f32
        },
        manual_pitch: pitch as f32,
        manual_roll: roll as f32,
        manual_yaw: yaw as f32,
        flags,
        fire: false,
        release: false,
    }
}
fn ai_taxi_input(u: &AirUnit, target: [f64; 2], maximum_speed: f64) -> AirInput {
    let p = u.pos();
    let dx = target[0] - p[0];
    let dz = target[1] - p[2];
    let range = dx.hypot(dz);
    let error = wrap_angle(dx.atan2(dz) - u.state[18] as f64);
    let wanted = maximum_speed
        .min((2.0 * 2.2 * (range - 1.0).max(0.0)).sqrt())
        .min(if error.abs() > 1.0 {
            2.5
        } else {
            maximum_speed
        });
    let brake = u.speed() > wanted + 0.25 || range < 1.5;
    let throttle = if brake {
        0.0
    } else {
        (0.06 + (wanted - u.speed()) * 0.045).clamp(0.0, 0.24)
    };
    AirInput {
        aim: [u.state[48], 0.0, u.state[50]],
        throttle: throttle as f32,
        manual_pitch: 0.0,
        manual_roll: 0.0,
        manual_yaw: (error * 1.8 - u.state[11] as f64 * 1.2).clamp(-1.0, 1.0) as f32,
        flags: 4 | if brake { 16 } else { 0 },
        fire: false,
        release: false,
    }
}
fn wrap_angle(angle: f64) -> f64 {
    (angle + std::f64::consts::PI).rem_euclid(std::f64::consts::TAU) - std::f64::consts::PI
}
fn begin_ai_service(
    u: &mut AirUnit,
    map: &Value,
    availability: &BTreeMap<String, ServiceAvailability>,
    ground: &crate::frontline_sim::MapGround,
    definitions: &BTreeMap<String, Value>,
) -> Result<(), String> {
    if u.owner.is_some() || u.controller.is_some() {
        return Err("not_autonomous".into());
    }
    let field = service_location(u, map, availability, ground)?;
    let accepted = u.accepted_loadout.clone();
    let candidate = stores_from_loadout(&accepted.value, definitions)?;
    allocate_loaded_feeds(&u.profile, &candidate)?;
    loaded_airframe(&u.profile, u.profile.fuel.capacity, &candidate)?;
    u.service.damage_revision = u.damage.revision;
    u.service.pending_loadout = Some(accepted);
    u.service.pending_fuel_minutes = None;
    u.service.view = AirServiceView {
        status: "servicing".into(),
        revision: u.service.view.revision + 1,
        airfield: Some(field),
        loadout: Some(u.loadout),
        custom: u.custom.clone(),
        fuel_minutes: None,
        elapsed_s: 0.0,
        duration_s: AIR_SERVICE_SECONDS,
        remaining_s: AIR_SERVICE_SECONDS,
        reason: None,
    };
    Ok(())
}
fn control_ai_sortie(
    u: &mut AirUnit,
    dt: f64,
    fields: &[AiRunway],
    traffic: &[AiTraffic],
    mission: [f64; 3],
    map: &Value,
    availability: &BTreeMap<String, ServiceAvailability>,
    ground: &crate::frontline_sim::MapGround,
    definitions: &BTreeMap<String, Value>,
) -> bool {
    if u.owner.is_some() || u.controller.is_some() || u.sortie.is_none() {
        return false;
    }
    let mut ai = u.sortie.take().unwrap();
    ai.clock += dt;
    let controlled = (|| {
        if ai.phase == AiSortiePhase::Patrol {
            if !ai_needs_return(u, fields) {
                return false;
            }
            ai.transition(AiSortiePhase::Return, u);
            ai.next_search = 0.0;
        }
        if ai.plan.is_none() && ai.clock >= ai.next_search {
            ai.next_search = ai.clock + 1.0;
            ai.plan = ai_choose_runway(u, fields);
            if ai.plan.is_none() {
                ai.phase = AiSortiePhase::Holding;
                ai.reason = Some("no_usable_friendly_runway".into());
            } else if ai.phase == AiSortiePhase::Holding {
                ai.transition(AiSortiePhase::Return, u);
                ai.reason = None;
            }
        }
        let Some(mut plan) = ai.plan.clone() else {
            if u.state[36] == 4.0 {
                u.input = service_hold_input(&u.state);
                return true;
            }
            let angle = ai.clock * 0.025;
            let at = [
                mission[0] + angle.sin() * 5000.0,
                mission[1] + 1400.0,
                mission[2] + angle.cos() * 5000.0,
            ];
            let course = normalize([at[0] - u.pos()[0], 0.0, at[2] - u.pos()[2]]);
            u.input = ai_flight_input(
                u,
                &mut ai,
                dt,
                [course[0], course[2]],
                ((at[1] - u.pos()[1]) * 0.08).clamp(-3.0, 8.0),
                ai_reference_speed(u) * 1.4,
                0,
                false,
            );
            return true;
        };
        if !ai_runway_live(&plan, fields)
            && matches!(
                ai.phase,
                AiSortiePhase::Return
                    | AiSortiePhase::Align
                    | AiSortiePhase::Approach
                    | AiSortiePhase::Takeoff
                    | AiSortiePhase::Departure
            )
        {
            ai.plan = None;
            ai.transition(AiSortiePhase::Holding, u);
            ai.reason = Some("runway_closed".into());
            u.input = AirInput {
                aim: normalize([u.state[48] as f64, 0.15, u.state[50] as f64]).map(|v| v as f32),
                throttle: 0.85,
                manual_pitch: 0.0,
                manual_roll: 0.0,
                manual_yaw: 0.0,
                flags: 1 | 4,
                fire: false,
                release: false,
            };
            return true;
        }
        let p = u.pos();
        let at = plan.coordinates(p);
        let reference = ai_reference_speed(u);
        match ai.phase {
            AiSortiePhase::Patrol => return false,
            AiSortiePhase::Holding | AiSortiePhase::Return => {
                let join = plan.point(2500.0, plan.interval[0] - 13000.0, 650.0);
                if distance(p, join) < 1400.0 {
                    ai.transition(AiSortiePhase::Align, u);
                }
                let direction = normalize([join[0] - p[0], 0.0, join[2] - p[2]]);
                let ahead = [p[0] + direction[0] * 1200.0, p[2] + direction[2] * 1200.0];
                let safe = ground.height(ahead[0], ahead[1]) + 250.0;
                let desired_height = join[1].max(safe).max(ground.height(p[0], p[2]) + 180.0);
                u.input = ai_flight_input(
                    u,
                    &mut ai,
                    dt,
                    [direction[0], direction[2]],
                    ((desired_height - p[1]) * 0.10).clamp(-5.0, 8.0),
                    reference * 1.4,
                    0,
                    false,
                );
            }
            AiSortiePhase::Align => {
                // Intercept the extended centerline instead of chasing a
                // point that a fast jet can circle forever. Keep several km
                // to capture cross-track, heading, speed and actual glidepath.
                let touchdown = plan.interval[0] + 300.0;
                let glide_height = plan.height + 2.0 + (touchdown - at[1]).max(0.0) * 0.045;
                let point = plan.point(0.0, at[1] + 2500.0, 0.0);
                let direction = normalize([point[0] - p[0], 0.0, point[2] - p[2]]);
                let ahead = [p[0] + direction[0] * 1200.0, p[2] + direction[2] * 1200.0];
                let desired_height = glide_height.max(ground.height(ahead[0], ahead[1]) + 80.0);
                let heading =
                    wrap_angle(plan.forward[0].atan2(plan.forward[1]) - u.state[18] as f64).abs();
                if at[0].abs() < 80.0
                    && at[1] < plan.interval[0] - 3500.0
                    && at[1] > plan.interval[0] - 10000.0
                    && heading < 0.12
                    && (p[1] - glide_height).abs() < 60.0
                    && (u.state[14] as f64) < reference * 1.2
                    && !ai_runway_busy(u, &plan, traffic)
                {
                    ai.transition(AiSortiePhase::Approach, u);
                } else if at[1] > plan.interval[0] - 3500.0 {
                    ai.transition(AiSortiePhase::Return, u);
                    ai.reason = Some("approach_not_captured".into());
                }
                u.input = ai_flight_input(
                    u,
                    &mut ai,
                    dt,
                    [direction[0], direction[2]],
                    ((desired_height - p[1]) * 0.15 - reference * 0.045).clamp(-5.0, 5.0),
                    reference * 1.08,
                    0,
                    false,
                );
            }
            AiSortiePhase::Approach => {
                if ai_runway_busy(u, &plan, traffic)
                    || at[1] > plan.interval[1] - 350.0
                    || at[0].abs() > 800.0
                {
                    ai.transition(AiSortiePhase::Return, u);
                    ai.reason = Some("go_around".into());
                    u.input = ai_flight_input(
                        u,
                        &mut ai,
                        dt,
                        plan.forward,
                        8.0,
                        reference * 1.4,
                        4,
                        false,
                    );
                    return true;
                }
                if u.state[36] == 4.0 {
                    ai.transition(AiSortiePhase::Rollout, u);
                }
                let touchdown = plan.interval[0] + 300.0;
                let height = plan.height + 2.0 + (touchdown - at[1]).max(0.0) * 0.045;
                let mut vertical = ((height - p[1]) * 0.25 - u.speed() * 0.045).clamp(-5.0, 4.0);
                if p[1] - plan.height < 8.0 && touchdown - at[1] < 500.0 {
                    vertical = (-0.7 + (plan.height + 2.0 - p[1]) * 0.15).clamp(-1.5, -0.25);
                }
                let point = plan.point(0.0, at[1] + 1200.0, 0.0);
                let d = normalize([point[0] - p[0], 0.0, point[2] - p[2]]);
                let flags = 4
                    | 8
                    | if u.state[14] as f64 > reference + 10.0 {
                        16
                    } else {
                        0
                    };
                u.input = ai_flight_input(
                    u,
                    &mut ai,
                    dt,
                    [d[0], d[2]],
                    vertical,
                    reference,
                    flags,
                    false,
                );
            }
            AiSortiePhase::Rollout => {
                u.input =
                    ai_flight_input(u, &mut ai, dt, plan.forward, 0.0, reference, 4 | 16, true);
                if u.speed() < 45.0 && u.state[36] == 4.0 {
                    u.input = service_hold_input(&u.state);
                }
                if u.speed() < 1.2 && u.state[36] == 4.0 {
                    let lane = (plan.half_width - u.profile.physics.airframe[3] as f64 * 0.5 - 3.0)
                        .max(2.5);
                    ai.parking = [
                        lane,
                        (at[1] + 80.0).clamp(plan.interval[0] + 150.0, plan.interval[1] - 150.0),
                    ];
                    ai.transition(AiSortiePhase::Taxi, u);
                }
            }
            AiSortiePhase::Taxi => {
                let target = plan.point(ai.parking[0], ai.parking[1], 2.0);
                u.input = ai_taxi_input(u, [target[0], target[2]], 4.0);
                if distance(p, target) < 2.5 && u.speed() < 1.2 {
                    u.input = service_hold_input(&u.state);
                    match begin_ai_service(u, map, availability, ground, definitions) {
                        Ok(()) => {
                            ai.transition(AiSortiePhase::Service, u);
                            ai.reason = None;
                        }
                        Err(reason) => {
                            ai.reason = Some(reason);
                        }
                    }
                }
            }
            AiSortiePhase::Service => {
                u.input = service_hold_input(&u.state);
                if u.service.view.status == "complete" {
                    ai.completed_sorties += 1;
                    plan = plan.reverse();
                    ai.plan = Some(plan.clone());
                    let current = plan.coordinates(p);
                    let lane = current[0];
                    let radius = lane.abs().max(5.0) / 2.0;
                    ai.taxi_waypoints = vec![
                        [lane, plan.interval[0] + 200.0],
                        [lane, plan.interval[0] + 120.0],
                        [lane + radius, plan.interval[0] + 120.0 - radius],
                        [0.0, plan.interval[0] + 120.0],
                        [0.0, plan.interval[0] + 230.0],
                    ];
                    ai.taxi_index = 0;
                    ai.transition(AiSortiePhase::Lineup, u);
                    ai.reason = None;
                } else if !u.servicing() {
                    ai.transition(AiSortiePhase::Taxi, u);
                }
            }
            AiSortiePhase::Lineup => {
                if ai.taxi_waypoints.is_empty() {
                    // An actual runway-spawned AI starts with its accepted
                    // heading; there is no alignment/spawn rewrite.
                    ai.transition(AiSortiePhase::Takeoff, u);
                    u.input = service_hold_input(&u.state);
                    return true;
                }
                if ai_runway_busy(u, &plan, traffic) {
                    u.input = service_hold_input(&u.state);
                    ai.reason = Some("runway_occupied".into());
                    return true;
                }
                let waypoint = ai.taxi_waypoints[ai.taxi_index];
                let target = plan.point(waypoint[0], waypoint[1], 2.0);
                u.input = ai_taxi_input(
                    u,
                    [target[0], target[2]],
                    if ai.taxi_index == 0 { 7.0 } else { 3.0 },
                );
                if distance(p, target)
                    < if ai.taxi_index + 1 == ai.taxi_waypoints.len() {
                        4.0
                    } else {
                        3.0
                    }
                {
                    if ai.taxi_index + 1 < ai.taxi_waypoints.len() {
                        ai.taxi_index += 1;
                    } else if wrap_angle(
                        plan.forward[0].atan2(plan.forward[1]) - u.state[18] as f64,
                    )
                    .abs()
                        < 0.15
                    {
                        ai.transition(AiSortiePhase::Takeoff, u);
                        ai.reason = None;
                    }
                }
            }
            AiSortiePhase::Takeoff => {
                if ai_runway_busy(u, &plan, traffic) && u.speed() < 5.0 {
                    u.input = service_hold_input(&u.state);
                    ai.reason = Some("runway_occupied".into());
                    return true;
                }
                let rotate = (u.profile.physics.rotate_kmh / 3.6).max(reference * 0.85);
                let point = plan.point(0.0, at[1] + 1500.0, 0.0);
                let d = normalize([point[0] - p[0], 0.0, point[2] - p[2]]);
                u.input = ai_flight_input(
                    u,
                    &mut ai,
                    dt,
                    [d[0], d[2]],
                    if u.state[14] as f64 >= rotate {
                        reference * 0.10
                    } else {
                        0.0
                    },
                    reference * 1.8,
                    4 | 128,
                    false,
                );
                u.input.throttle = 1.0;
                if u.state[36] == 4.0 && (u.state[14] as f64) < rotate {
                    u.input.manual_pitch = 0.0;
                    u.input.manual_roll = 0.0;
                    u.input.manual_yaw = (wrap_angle(d[0].atan2(d[2]) - u.state[18] as f64) * 2.0)
                        .clamp(-0.4, 0.4) as f32;
                }
                if u.state[35] > 35.0 && u.state[36] != 4.0 {
                    ai.transition(AiSortiePhase::Departure, u);
                }
            }
            AiSortiePhase::Departure => {
                u.input =
                    ai_flight_input(u, &mut ai, dt, plan.forward, 8.0, reference * 1.8, 0, false);
                if u.state[35] > 500.0 && p[1] > plan.height + 500.0 {
                    ai.plan = None;
                    ai.transition(AiSortiePhase::Patrol, u);
                    ai.reason = None;
                }
            }
        }
        true
    })();
    u.sortie = Some(ai);
    controlled
}
fn service_controls_safe(input: &AirInput) -> bool {
    input.throttle <= 0.06
        && !input.fire
        && !input.release
        && [input.manual_pitch, input.manual_roll, input.manual_yaw]
            .iter()
            .all(|v| v.abs() <= 0.05)
}
fn service_hold_input(state: &[f32]) -> AirInput {
    AirInput {
        aim: [state[48], state[49], state[50]],
        throttle: 0.0,
        manual_pitch: 0.0,
        manual_roll: 0.0,
        manual_yaw: 0.0,
        flags: 1 | 4 | 16 | 128,
        fire: false,
        release: false,
    }
}
fn service_location(
    u: &AirUnit,
    map: &Value,
    availability: &BTreeMap<String, ServiceAvailability>,
    ground: &crate::frontline_sim::MapGround,
) -> Result<String, String> {
    if !u.alive() {
        return Err("aircraft_lost".into());
    }
    if u.damage.fire > 0.0 {
        return Err("aircraft_fire".into());
    }
    if !service_controls_safe(&u.input) {
        return Err("unsafe_controls".into());
    }
    let gear_locked = if u.profile.physics.gear_sequence.is_some_and(|s| s[0] != 0.0) {
        // Core213's Me262 mechanism has independently accepted leg locks.
        // An averaged gear scalar can remain above .9 after one leg unlocks.
        u.aero[36] >= 0.999 && u.aero[38] >= 0.999
    } else {
        u.state[33] >= 0.9
    };
    if !gear_locked {
        return Err("gear_not_down".into());
    }
    // Native ground mode4 and its actual velocity/AGL, not client claims or a
    // mere horizontal map overlap. A hovering/falling aircraft cannot service.
    if u.speed() > 1.5 || !(1.5..=2.5).contains(&u.state[35]) || u.state[36] != 4.0 {
        return Err("not_stopped".into());
    }
    let team = if u.team == Team::Blue { 0 } else { 1 };
    let field = map["airfields"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|f| {
            f["enabled"] == true
                && f["team"].as_u64() == Some(team)
                && landing(f).is_some_and(|r| r.contains(u.pos()[0], u.pos()[2]))
        })
        .ok_or("not_friendly_runway")?;
    let id = field["id"].as_str().ok_or("invalid_airfield")?;
    if !ground.runway_available_at(u.pos()[0], u.pos()[2]) {
        return Err("runway_patch_closed".into());
    }
    if !availability
        .get(id)
        .copied()
        .unwrap_or_default()
        .available()
    {
        return Err("availability_unavailable".into());
    }
    Ok(id.into())
}
fn slots_clash(a: &Value, b: &Value) -> bool {
    let (pa, pb) = (&a["pylon"], &b["pylon"]);
    if pa.is_object() || pb.is_object() {
        return pa.is_object()
            && pb.is_object()
            && [(&pa["clash"], &pb["n"]), (&pb["clash"], &pa["n"])]
                .iter()
                .any(|(clash, n)| clash.as_array().is_some_and(|v| v.contains(n)));
    }
    let (sa, sb) = (
        a["station"].as_str().unwrap_or(""),
        b["station"].as_str().unwrap_or(""),
    );
    a["side"] == b["side"]
        && a["side"].as_i64().is_some_and(|s| s != 0)
        && sa != sb
        && (sa == "row") != (sb == "row")
        && !matches!(sa, "tip" | "belly")
        && !matches!(sb, "tip" | "belly")
}

/// Reuse the accepted model sockets verbatim whenever the catalog has them.
/// Only missing numbered-pylon combinations with procedural store geometry may
/// use the original deterministic pylon formula, with a host-owned anchor.
fn slot_items(
    profile: &AirProfile,
    slot: &Value,
    id: &str,
    count: u64,
    definitions: &BTreeMap<String, Value>,
    parts: &[crate::aircraft::PartDef],
) -> Result<Vec<Value>, String> {
    if count == 0 || count > 64 {
        return Err("invalid_catalog_slot_count".into());
    }
    let station = slot["station"].as_str().ok_or("invalid_aircraft_station")?;
    let side = slot["side"].as_i64().ok_or("invalid_aircraft_side")?;
    if let Some(table) = profile.stores.get("slotItems") {
        let table = table.as_object().ok_or("invalid_authoritative_slot_items")?;
        let key = slot["key"].as_str().ok_or("invalid_aircraft_slot")?;
        if let Some(choices) = table.get(key) {
            let choices = choices.as_object().ok_or("invalid_authoritative_slot_items")?;
            if let Some(items) = choices.get(id) {
                let items = items.as_array().ok_or("invalid_authoritative_slot_items")?;
                if items.len() as u64 != count {
                    return Err("invalid_authoritative_slot_items".into());
                }
                for item in items {
                    let position = item["p"].as_array();
                    let valid_position = position.is_some_and(|p| {
                        p.len() == 3 && p.iter().all(|n| n.as_f64().is_some_and(f64::is_finite))
                    });
                    let valid_owner = item["owner"].as_str().is_some_and(|owner| {
                        owner == "body" || parts.iter().any(|part| part.id == owner)
                    });
                    let valid_key = item.get("fittedMountKey").is_none_or(|key| {
                        key.is_null() || key.as_str().is_some_and(|key| !key.is_empty())
                    });
                    if item["id"].as_str() != Some(id)
                        || item["station"].as_str() != Some(station)
                        || item["side"].as_i64() != Some(side)
                        || !valid_position || !valid_owner || !valid_key
                    {
                        return Err("invalid_authoritative_slot_items".into());
                    }
                }
                return Ok(items.clone());
            }
        }
    }
    let loadouts = profile.stores["loadouts"]
        .as_array()
        .ok_or("invalid_aircraft_loadouts")?;
    for lo in loadouts {
        let group = lo["items"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|v| {
                v["id"].as_str() == Some(id)
                    && v["station"].as_str() == Some(station)
                    && v["side"].as_i64() == Some(side)
            })
            .cloned()
            .collect::<Vec<_>>();
        if group.len() as u64 == count {
            return Ok(group);
        }
    }
    if station.starts_with("source_") {
        return Err("missing_authoritative_source_store_geometry".into());
    }
    let pl = &slot["pylon"];
    let number = pl["n"]
        .as_u64()
        .filter(|n| station == format!("p{n}"))
        .ok_or("missing_authoritative_store_geometry")?;
    let def = definitions.get(id).ok_or("unknown_store")?;
    if def.get("model").is_some_and(|v| !v.is_null()) || count > 3 {
        return Err("missing_authoritative_store_socket".into());
    }
    let anchor = loadouts
        .iter()
        .flat_map(|lo| lo["items"].as_array().into_iter().flatten())
        .find(|v| {
            v["station"].as_str() == Some(station)
                && v["side"].as_i64() == Some(side)
                && vector(&v["pylon"][0]).is_some()
        });
    let top = anchor
        .and_then(|v| vector(&v["pylon"][0]))
        .or_else(|| Some([pl["x"].as_f64()?, pl["y"].as_f64()?, pl["z"].as_f64()?]))
        .filter(|p| p.iter().all(|n| n.is_finite()))
        .ok_or("missing_authoritative_pylon_anchor")?;
    let owner = anchor
        .and_then(|v| v["owner"].as_str())
        .or_else(|| (pl["wing"] != true).then_some("body"))
        .ok_or("missing_authoritative_pylon_owner")?;
    let diameter = def["d"]
        .as_f64()
        .filter(|n| n.is_finite() && *n > 0.0)
        .ok_or("invalid_store_dimensions")?;
    let length = def["len"]
        .as_f64()
        .filter(|n| n.is_finite() && *n > 0.0)
        .ok_or("invalid_store_dimensions")?;
    let r = diameter / 2.0;
    let offsets: Vec<[f64; 2]> = match count {
        1 => vec![[0.0, 0.0]],
        2 => vec![[-(r * 1.25 + 0.03), 0.06], [r * 1.25 + 0.03, 0.06]],
        3 => vec![
            [0.0, -r * 1.6],
            [-(r * 2.15 + 0.05), r * 0.5],
            [r * 2.15 + 0.05, r * 0.5],
        ],
        _ => return Err("invalid_catalog_slot_count".into()),
    };
    let ammo = if def["kind"] == "pod" {
        def["count"].as_u64().ok_or("invalid_pod_count")?
    } else {
        1
    };
    Ok(offsets
        .into_iter()
        .map(|[dx, dy]| {
            let bottom = [top[0] + dx, top[1] - 0.14 + dy, top[2]];
            let p = [bottom[0], bottom[1] - r, bottom[2] + length * 0.08];
            json!({"id":id,"station":station,"pylonN":number,"p":p,
            "pylon":[top,bottom],"side":side,"owner":owner,"count":ammo})
        })
        .collect())
}

fn stores_from_loadout(
    lo: &Value,
    definitions: &BTreeMap<String, Value>,
) -> Result<Vec<Store>, String> {
    lo["items"]
        .as_array()
        .ok_or("invalid_loadout")?
        .iter()
        .map(|v| {
            let def = definitions
                .get(v["id"].as_str().ok_or("invalid_store")?)
                .ok_or("unknown_store")?
                .clone();
            let mut value = v.clone();
            if def["kind"] == "pod" {
                value["rocketMass"] = definitions
                    .get(def["rockets"].as_str().ok_or("invalid_pod")?)
                    .ok_or("unknown_pod_rocket")?["mass"]
                    .clone();
            }
            let count = u32::try_from(v["count"].as_u64().unwrap_or(1))
                .map_err(|_| "invalid_store_count")?;
            let fuel = def["fuel"].as_f64().unwrap_or(0.0);
            if !fuel.is_finite() || fuel < 0.0 || vector(&v["p"]).is_none() {
                return Err("invalid_store".into());
            }
            Ok(Store {
                value,
                def,
                count,
                gone: false,
                fuel,
            })
        })
        .collect()
}
fn loaded_airframe(profile: &AirProfile, fuel: f64, stores: &[Store]) -> Result<[f32; 14], String> {
    let mut af = profile.physics.airframe;
    af[0] -= (profile.fuel.capacity - fuel) as f32;
    for s in stores.iter().filter(|s| !s.gone) {
        let mass = store_mass(s);
        let p = vector(&s.value["p"]).ok_or("invalid store position")?;
        af[0] += mass as f32;
        af[4] += (mass * (p[1] * p[1] + p[2] * p[2])) as f32;
        af[5] += (mass * (p[0] * p[0] + p[2] * p[2])) as f32;
        af[6] += (mass * (p[0] * p[0] + p[1] * p[1])) as f32;
        let d = s.def["d"].as_f64().unwrap_or(0.0);
        af[7] += ((0.8 * std::f64::consts::PI * (d / 2.0).powi(2) + 0.02) / af[1] as f64) as f32;
    }
    if af.iter().any(|v| !v.is_finite() || v.abs() > 10_000_000.0)
        || af[..7].iter().any(|v| *v <= 0.0)
    {
        return Err("invalid_loaded_airframe".into());
    }
    Ok(af)
}
fn landing(v: &Value) -> Option<LandingArea> {
    let r = &v["runway"];
    Some(LandingArea {
        center: serde_json::from_value(r["center"].clone()).ok()?,
        forward: serde_json::from_value(r["forward"].clone()).ok()?,
        half_width: r["widthMeters"].as_f64()? / 2.0,
        half_length: r["lengthMeters"].as_f64()? / 2.0,
    })
}
fn body_owner() -> String {
    "body".into()
}
fn allocate_feeds(profiles: &[GunProfile]) -> Vec<Gun> {
    let total = profiles.iter().map(|g| g.ammo).sum::<f64>().round() as u64;
    let mut counts: Vec<u32> = profiles.iter().map(|g| g.ammo.floor() as u32).collect();
    let remainder = total.saturating_sub(counts.iter().map(|v| *v as u64).sum());
    for count in counts.iter_mut().take(remainder as usize) {
        *count += 1;
    }
    profiles
        .iter()
        .cloned()
        .zip(counts)
        .map(|(profile, ammo)| Gun {
            profile,
            ammo,
            cool: 0.0,
            fired: 0,
            store_index: None,
        })
        .collect()
}
fn allocate_loaded_feeds(profile: &AirProfile, stores: &[Store]) -> Result<Vec<Gun>, String> {
    let mut guns = allocate_feeds(&profile.guns);
    for (index, store) in stores
        .iter()
        .enumerate()
        .filter(|(_, s)| s.def["kind"] == "gunpod")
    {
        let def = &store.def["gun"];
        let p = vector(&store.value["p"]).ok_or("invalid_gunpod_mount")?;
        let length = store.def["len"]
            .as_f64()
            .filter(|n| n.is_finite() && *n > 0.0)
            .ok_or("invalid_gunpod_dimensions")?;
        let mount = [p[0], p[1] - 0.06, p[2] + length * 0.5];
        let station = store.value["pylonN"]
            .as_u64()
            .map(|n| n.to_string())
            .or_else(|| store.value["station"].as_str().map(str::to_owned))
            .ok_or("invalid_gunpod_station")?;
        let side = store.value["side"].as_i64().ok_or("invalid_gunpod_side")?;
        let gun = GunProfile {
            id: format!("air_pod_{station}_{side}"),
            owner: store.value["owner"]
                .as_str()
                .ok_or("invalid_gunpod_owner")?
                .into(),
            ammo: def["rounds"]
                .as_u64()
                .filter(|n| *n <= u32::MAX as u64)
                .ok_or("invalid_gunpod_ammo")? as f64,
            rpm: def["rpm"]
                .as_f64()
                .filter(|n| n.is_finite() && *n > 0.0)
                .ok_or("invalid_gunpod_rpm")?,
            mount,
            mounts: vec![mount],
            directions: vec![normalize(sub([0.0, 0.0, 400.0], mount))],
            belt: serde_json::from_value(def["belt"].clone()).map_err(|_| "invalid_gunpod_belt")?,
        };
        if gun.belt.is_empty() {
            return Err("invalid_gunpod_belt".into());
        }
        let mut feed = allocate_feeds(&[gun]).pop().unwrap();
        feed.store_index = Some(index);
        guns.push(feed);
    }
    Ok(guns)
}
fn gun_owner<'de, D: serde::Deserializer<'de>>(d: D) -> Result<String, D::Error> {
    Ok(Option::<String>::deserialize(d)?.unwrap_or_else(body_owner))
}
fn payload<'a>(d: &'a Value, defs: &'a BTreeMap<String, Value>) -> Option<&'a Value> {
    match d["kind"].as_str() {
        Some("bomb" | "rocket" | "aam" | "agm") => Some(d),
        Some("pod") => defs.get(d["rockets"].as_str()?),
        _ => None,
    }
}
fn air_missile_shell(id:&str,d:&Value)->Result<ProjectileDef,serde_json::Error>{
    // The original browser's tnt is its existing blast/fragment game value.
    // Keep it explicit; it is not advertised as measured filler mass.
    serde_json::from_value(json!({"id":format!("air_missile_{id}"),"name":d["name"],"kind":"he",
        "caliber_mm":d["d"].as_f64().unwrap_or(0.0)*1000.0,"mass_kg":d["mass"],"muzzle_velocity_ms":20.0,
        "explosive_mass_kg":d["tnt"],"explosive_type":"tnt","penetrator_material":"steel",
        "length_mm":d["len"].as_f64().unwrap_or(1.0)*1000.0,"drag_coefficient":0.45,
        "penetration_curve":[],"ricochet_angle_deg":90.0,"normalization_deg":0.0,
        "fuse_delay_s":0.0,"fuse_sensitivity_mm":0.0}))
}
fn store_mass(s: &Store) -> f64 {
    match s.def["kind"].as_str() {
        Some("tank") => s.def["mass"].as_f64().unwrap_or(0.0) + s.fuel,
        Some("pod") => {
            s.def["mass"].as_f64().unwrap_or(0.0)
                + s.value["rocketMass"].as_f64().unwrap_or(0.0) * s.count as f64
        }
        _ => s.def["mass"].as_f64().unwrap_or(0.0),
    }
}
pub fn fuel_flow(p: &AirProfile, engine: f64) -> f64 {
    let f = &p.fuel.tuple;
    let eng = engine.max(0.05);
    if let Some(flow) = f.get(3).filter(|x| **x > 0.0) {
        return flow * eng.clamp(0.08, 1.15);
    }
    let dry = f.get(1).copied().unwrap_or(0.0) * p.physics.airframe[12] as f64;
    if eng > 1.005 && f.get(2).is_some_and(|x| *x > 0.0) {
        f[2] * p.physics.airframe[12] as f64
            * (1.0 + p.physics.airframe[13] as f64)
            * ((eng - 1.0) / 0.12).min(1.0)
            + dry
    } else {
        dry * eng.min(1.0)
    }
}
fn damage_flight(d: &AirDamage) -> [f32; 6] {
    if d.broken {
        return [0.0, 0.05, 0.05, 0.0, 0.0, 0.0];
    }
    let part = |id: &str| d.parts.iter().find(|p| p.def.id == id);
    let frac = |id: &str| {
        part(id)
            .map(|p| (p.hp / p.def.hp).clamp(0.0, 1.0))
            .unwrap_or(1.0)
    };
    let live = |id: &str, low: f64| {
        if d.dead(id) {
            0.0
        } else {
            low + (1.0 - low) * frac(id)
        }
    };
    let engines: Vec<_> = d
        .parts
        .iter()
        .filter(|p| p.def.id == "engine" || p.def.id.starts_with("engine_"))
        .collect();
    let thrust = if engines.is_empty() {
        1.0
    } else {
        engines
            .iter()
            .map(|p| {
                if p.hp <= 0.0 {
                    0.0
                } else {
                    0.45 + 0.55 * p.hp / p.def.hp
                }
            })
            .sum::<f64>()
            / engines.len() as f64
    } * if d.dead("prop") {
        0.0
    } else {
        0.6 + 0.4 * frac("prop")
    };
    let runs = if part("controls").is_none() {
        1.0
    } else if d.dead("controls") {
        0.25
    } else {
        0.75 + 0.25 * frac("controls")
    };
    let lift = |side: &str| {
        let w = format!("wing_{side}");
        let o = format!("{w}_out");
        if d.dead(&w) {
            0.08
        } else {
            let inner = 0.6 + 0.4 * frac(&w);
            if part(&o).is_some() {
                0.6 * inner
                    + 0.4
                        * if d.dead(&o) {
                            0.0
                        } else {
                            0.6 + 0.4 * frac(&o)
                        }
            } else {
                inner
            }
        }
    };
    let ail = |side: &str| {
        let a = format!("aileron_{side}");
        if d.dead(&format!("wing_{side}")) || d.gone(&a) {
            0.0
        } else {
            live(&a, 0.4)
        }
    };
    let tail = if d.dead("tail") {
        0.0
    } else {
        0.5 + 0.5 * frac("tail")
    };
    let halves: Vec<_> = ["htail_l", "htail_r"]
        .into_iter()
        .filter(|x| part(x).is_some())
        .collect();
    let stab = if halves.is_empty() {
        1.0
    } else {
        halves
            .iter()
            .map(|x| if d.dead(x) { 0.0 } else { 0.6 + 0.4 * frac(x) })
            .sum::<f64>()
            / halves.len() as f64
    };
    let pitch = if d.dead("tail") || stab == 0.0 {
        0.0
    } else {
        (if d.dead("elevator") {
            0.08
        } else {
            live("elevator", 0.4) * runs
        }) * tail
            * (0.3 + 0.7 * stab)
    };
    let yaw = if part("fin").is_some() && d.dead("fin") {
        0.03
    } else if d.dead("rudder") {
        0.1 * tail
    } else {
        live("rudder", 0.4)
            * tail
            * runs
            * if part("fin").is_some() {
                0.6 + 0.4 * frac("fin")
            } else {
                1.0
            }
    };
    [
        thrust.min(1.0),
        lift("l"),
        lift("r"),
        pitch,
        (ail("l") + ail("r")) / 2.0 * runs,
        yaw,
    ]
    .map(|v| v as f32)
}
fn vector(v: &Value) -> Option<[f64; 3]> {
    let a = v.as_array()?;
    Some([
        a.first()?.as_f64()?,
        a.get(1)?.as_f64()?,
        a.get(2)?.as_f64()?,
    ])
}
fn add(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|i| a[i] + b[i])
}
fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    std::array::from_fn(|i| a[i] - b[i])
}
fn scale(a: [f64; 3], s: f64) -> [f64; 3] {
    a.map(|v| v * s)
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a.iter().zip(b).map(|(a, b)| a * b).sum()
}
fn distance(a: [f64; 3], b: [f64; 3]) -> f64 {
    dot(sub(a, b), sub(a, b)).sqrt()
}
fn normalize(a: [f64; 3]) -> [f64; 3] {
    scale(a, 1.0 / dot(a, a).sqrt().max(1e-8))
}
#[cfg(test)]
#[path = "frontline_air_custom_tests.rs"]
mod custom_tests;
#[cfg(test)]
#[path = "frontline_air_service_tests.rs"]
mod service_tests;
#[cfg(test)]
#[path = "frontline_air_sortie_tests.rs"]
mod sortie_tests;
#[cfg(test)]
#[path = "frontline_air_limits_tests.rs"]
mod limits_tests;
#[cfg(test)]
#[path = "frontline_air_impact_tests.rs"]
mod impact_tests;
#[cfg(test)]
#[path = "frontline_air_guidance_tests.rs"]
mod guidance_tests;

fn unit_has_radar(u:&AirUnit)->bool{u.profile.sensors["radar"].is_object()&&!u.damage.dead("radar")&&!u.damage.gone("radar")}
fn unit_pod(u:&AirUnit)->Option<&Value>{
    if u.damage.dead("pod")||u.damage.gone("pod"){return None;}
    profile_pod(&u.profile,&u.stores)
}
fn profile_pod<'a>(profile:&'a AirProfile,stores:&[Store])->Option<&'a Value>{
    let id=stores.iter().find(|s|!s.gone&&s.def["kind"]=="sensorpod").and_then(|s|s.def["pod"].as_str())
        .or_else(||profile.sensors["equipment"]["pod"].as_str())?;
    profile.sensors["pods"].get(id).filter(|p|p.is_object())
}
fn sensor_can_see(sensor:&Value,pos:[f64;3],pose:&AcceptedModelPose,target:[f64;3],aim:[f64;3],radar:bool)->bool{
    let line=guided::sub(target,pos);let range=guided::length(line);let f=guided::dot(line,pose.vector([0.0,0.0,1.0]));
    let x=guided::dot(line,pose.vector([1.0,0.0,0.0]));let y=guided::dot(line,pose.vector([0.0,1.0,0.0]));
    let az=x.atan2(f).to_degrees().abs();let el=y.atan2((f*f+x*x).sqrt()).to_degrees();
    let max_range=sensor["range"].as_f64().unwrap_or(0.0)*if radar{1000.0}else{1.0};
    range<=max_range&&az<=sensor["az"].as_f64().unwrap_or(180.0)
        &&el<=sensor[if radar{"el"}else{"up"}].as_f64().unwrap_or(90.0)
        &&-el<=sensor[if radar{"el"}else{"down"}].as_f64().unwrap_or(90.0)
        &&(radar||guided::angle(aim,line).to_degrees()<=sensor["gate"].as_f64().unwrap_or(1.4))
}

#[cfg(test)]
#[path = "../../../handoff/tools/agm_launch_fix.native_tests.rs"]
mod agm_launch_fix_tests;
