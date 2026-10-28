//! Shared frontline domain. Unit lives belong to the room, never to legacy Player seats.
//! Ground-first integration: the native adapter owns motion, mounted ammunition and damage.
use crate::frontline_air::{AirInput, AirOption, AirPose, AirTemplate, AirUnitView, AirWorld};
use crate::frontline_campaign::{Campaign, NavigationPlan};
use crate::frontline_facilities::{FacilityJobKind, FacilityView};
use crate::frontline_perception::{
    ActorKind, EventCandidate, PerceptionActor, PerceptionConfig, PerceptionWorld,
    TeamPerceptionView,
};
use crate::frontline_sim::{FacilityWorkerRoles, SimInput, SimKinematics, SimWorld};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::time::Instant;

pub const PROTOCOL_VERSION: u32 = 1;
const MAX_ROOMS: usize = 8;
const TEAM_PLAYERS: usize = 12;
const TEAM_COMPANIES: usize = 12;
const STEP: f64 = 0.05;
const ROUND_SECONDS: f64 = 45.0 * 60.0;
const INTERMISSION_SECONDS: f64 = 20.0;
const LOSS_COST: u32 = 10;
const INPUT_TIMEOUT: f64 = 0.5;
const WAITING_ROOM_GRACE: f64 = 120.0;
const REINFORCEMENT_INTERVAL: f64 = 45.0;
const REINFORCEMENT_BATCH: usize = 3;
const AIR_SCORE_LIMIT: u32 = 1000;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub struct UnitRef {
    pub battle: u64,
    pub unit: u64,
    pub life: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Team {
    Blue,
    Red,
}
impl Team {
    fn index(self) -> usize {
        if self == Self::Blue {
            0
        } else {
            1
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OrderKind {
    Move,
    Attack,
    Defend,
}

fn default_era() -> u32 {
    1986
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case", deny_unknown_fields)]
pub enum Command {
    Create {
        name: String,
        map: String,
        #[serde(default)]
        observer: bool,
        #[serde(default = "default_era")]
        era: u32,
    },
    List,
    Join {
        room: u32,
        #[serde(default)]
        observer: bool,
        #[serde(default)]
        team: Option<Team>,
    },
    Start,
    Deploy {
        vehicle: String,
    },
    DeployAt {
        vehicle: String,
        staging: String,
    },
    DeployAir {
        aircraft: String,
        spawn: String,
        #[serde(default)]
        loadout: u32,
        #[serde(default)]
        custom: Option<BTreeMap<String, String>>,
        #[serde(default)]
        custom_counts: Option<BTreeMap<String, u32>>,
        #[serde(default)]
        fuel_minutes: Option<crate::frontline_air::FuelMinutes>,
    },
    ServiceAir {
        unit: UnitRef,
        epoch: u64,
        seq: u64,
        loadout: u32,
        #[serde(default)]
        custom: Option<BTreeMap<String, String>>,
        #[serde(default)]
        custom_counts: Option<BTreeMap<String, u32>>,
        #[serde(default)]
        fuel_minutes: Option<crate::frontline_air::FuelMinutes>,
    },
    AirWeaponControl {
        unit: UnitRef,
        epoch: u64,
        seq: u64,
        #[serde(default)]
        store_id: Option<String>,
        #[serde(default)]
        store_index: Option<usize>,
        program: String,
        gun_mode: String,
    },
    AirSeekerControl {
        unit: UnitRef,
        epoch: u64,
        seq: u64,
        enabled: bool,
        radar: bool,
        #[serde(default)]
        target: Option<UnitRef>,
        #[serde(default)]
        sight: Option<[f64;3]>,
        #[serde(default)]
        laser: bool,
        #[serde(default)]
        ecm: bool,
        #[serde(default)]
        manual: [f64;2],
    },
    AirCountermeasure {
        unit: UnitRef,
        epoch: u64,
        seq: u64,
        kind: String,
    },
    CancelAirService {
        unit: UnitRef,
        epoch: u64,
        seq: u64,
    },
    AirPose {
        unit: UnitRef,
        epoch: u64,
        seq: u64,
        pose: AirPose,
    },
    AirInput {
        unit: UnitRef,
        epoch: u64,
        seq: u64,
        aim: [f32; 3],
        throttle: f32,
        manual_pitch: f32,
        manual_roll: f32,
        manual_yaw: f32,
        flags: u32,
        #[serde(default)]
        fire: bool,
        #[serde(default)]
        release: bool,
    },
    Input {
        unit: UnitRef,
        epoch: u64,
        seq: u64,
        throttle: f64,
        steer: f64,
        brake: f64,
        turret_yaw: f64,
        gun_pitch: f64,
        #[serde(default)]
        fire: bool,
    },
    Order {
        company: u64,
        #[serde(default)]
        platoons: Vec<u8>,
        kind: OrderKind,
        target: [f64; 2],
        seq: u64,
    },
    SupportOrder {
        unit: UnitRef,
        kind: FacilityJobKind,
        facility_id: String,
        expected_revision: u64,
        seq: u64,
    },
    Takeover {
        unit: UnitRef,
    },
    Return,
    Observe,
    Snapshot,
    Leave,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct MemberView {
    pub player: u32,
    pub name: String,
    pub team: Team,
    pub observer: bool,
    pub connected: bool,
    pub company: Option<u64>,
    pub controlled: Option<UnitRef>,
    pub epoch: u64,
    pub air_sorties_remaining: u8,
    pub air_sortie_eligible: bool,
}
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct PlayerScore {
    pub player: u32,
    pub name: String,
    pub score: u32,
    pub air_kills: u32,
    pub ground_kills: u32,
    pub deaths: u32,
}
#[derive(Clone, Copy)]
struct DamageCredit {
    player: u32,
    team: Team,
    at: f64,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RoomView {
    pub id: u32,
    pub name: String,
    pub map: String,
    pub map_revision: String,
    pub era: u32,
    pub host: u32,
    pub battle: u64,
    pub started: bool,
    pub battle_mode: &'static str,
    pub player_ground_allowed: bool,
    pub scoreboard: Vec<PlayerScore>,
    pub team_score: [u32; 2],
    pub score_limit: u32,
    pub round_number: u32,
    pub round_state: String,
    pub round_elapsed_s: f64,
    pub next_round_s: Option<f64>,
    pub result: Option<RoundResult>,
    pub intelligence_version: u32,
    pub facility_layout_version: u32,
    pub facility_layout_hash: String,
    pub support_deployments: Vec<Value>,
    pub members: Vec<MemberView>,
    pub readiness: [u32; 2],
    pub staging: Vec<StagingView>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct RoundResult {
    pub battle: u64,
    pub winner: Option<Team>,
    pub reason: String,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct StagingView {
    pub id: String,
    pub team: Team,
    pub front: String,
    pub objective: Option<String>,
    pub road: String,
    pub pos: [f64; 3],
    pub radius: f64,
    pub available: bool,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct VehicleOption {
    pub id: String,
    pub name: String,
    pub year: u32,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct OrderView {
    pub platoon: Option<u8>,
    pub kind: OrderKind,
    pub target: [f64; 2],
    pub seq: u64,
    pub front: String,
    pub routes: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ReinforcementView {
    pub pending: u8,
    pub incoming: u8,
    /// Accepted simulation seconds remaining, never a browser countdown authority.
    pub next_batch_s: f64,
    pub batch_interval_s: f64,
    pub max_batch: u8,
    pub status: String,
    pub source: String,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct CompanyView {
    pub id: u64,
    pub owner: Option<u32>,
    pub team: Team,
    pub autonomous: bool,
    pub units: Vec<UnitRef>,
    pub platoons: [Vec<UnitRef>; 3],
    pub orders: Vec<OrderView>,
    pub staging: String,
    pub front: String,
    pub reinforcement: ReinforcementView,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct UnitView {
    pub unit: UnitRef,
    pub vehicle: String,
    pub team: Team,
    pub role: String,
    pub campaign_conversion: Option<Value>,
    pub support_task: Option<Value>,
    pub support_order_seq: u64,
    pub company: u64,
    pub platoon: Option<u8>,
    pub controller: Option<u32>,
    pub epoch: u64,
    pub alive: bool,
    pub pos: [f64; 3],
    pub yaw: f64,
    pub turret_yaw: f64,
    pub gun_pitch: f64,
    pub ammo: u32,
    pub ammo_revision: u64,
    pub damage: Value,
    pub caps: Value,
    pub net: Value,
    pub navigation: Value,
    pub reinforcing: bool,
}
#[derive(Clone, Debug, PartialEq)]
pub struct ObjectiveView {
    pub id: String,
    pub name: String,
    pub pos: [f64; 3],
    pub radius: f64,
    pub owner: Option<Team>,
    pub progress: f64,
    pub lane: String,
    pub capturable: [bool; 2],
    pub supplied: [bool; 2],
    pub contested: bool,
    pub presence: [u16; 2],
    /// Wire disclosure only. Campaign calculations always retain true counts.
    pub presence_visible: [bool; 2],
}
impl Serialize for ObjectiveView {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("ObjectiveView", 11)?;
        state.serialize_field("id", &self.id)?;
        state.serialize_field("name", &self.name)?;
        state.serialize_field("pos", &self.pos)?;
        state.serialize_field("radius", &self.radius)?;
        state.serialize_field("owner", &self.owner)?;
        state.serialize_field("progress", &self.progress)?;
        state.serialize_field("lane", &self.lane)?;
        state.serialize_field("capturable", &self.capturable)?;
        state.serialize_field("supplied", &self.supplied)?;
        state.serialize_field("contested", &self.contested)?;
        let presence: [Option<u16>; 2] =
            std::array::from_fn(|i| self.presence_visible[i].then_some(self.presence[i]));
        state.serialize_field("presence", &presence)?;
        state.end()
    }
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "op", rename_all = "snake_case")]
pub enum Update {
    Rooms {
        rooms: Vec<RoomView>,
    },
    Room {
        room: RoomView,
    },
    Snapshot {
        room: RoomView,
        units: Vec<UnitView>,
        companies: Vec<CompanyView>,
        vehicles: Vec<VehicleOption>,
        objectives: Vec<ObjectiveView>,
        aircraft_options: Vec<AirOption>,
        aircrafts: Vec<AirUnitView>,
        missiles: Vec<crate::frontline_air::guided::View>,
        tracers: Vec<crate::frontline_sim::AirGunTracerView>,
        facilities: Vec<Value>,
        facility_jobs: Vec<Value>,
        facility_geometry_catalog: Vec<Value>,
        vessels: Vec<Value>,
        naval_geometry_catalog: Vec<Value>,
        scenario: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        intel: Option<TeamPerceptionView>,
    },
    Frame {
        battle: u64,
        tick: u64,
        units: Vec<UnitView>,
        companies: Vec<CompanyView>,
        readiness: [u32; 2],
        objectives: Vec<ObjectiveView>,
        events: Vec<Value>,
        aircrafts: Vec<AirUnitView>,
        missiles: Vec<crate::frontline_air::guided::View>,
        tracers: Vec<crate::frontline_sim::AirGunTracerView>,
        staging: Vec<StagingView>,
        facilities: Vec<Value>,
        facility_jobs: Vec<Value>,
        vessels: Vec<Value>,
        scenario: Option<Value>,
        #[serde(skip_serializing_if = "Option::is_none")]
        intel: Option<TeamPerceptionView>,
    },
    Control {
        unit: Option<UnitRef>,
        epoch: u64,
        reason: String,
    },
    AirPoseAccepted {
        unit: UnitRef,
        epoch: u64,
        seq: u64,
        pose: AirPose,
    },
    OrderAccepted {
        company: u64,
        seq: u64,
    },
    Ended {
        battle: u64,
        winner: Option<Team>,
        reason: String,
    },
    Error {
        code: String,
        message: String,
    },
    Left,
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Gate {
    Initial,
    Returned,
    Loss,
    None,
}
#[derive(Clone)]
struct Participant {
    view: MemberView,
    gate: Gate,
    resume_unit: Option<UnitRef>,
    air_sortie_used: bool,
}
struct Unit {
    reference: UnitRef,
    company: u64,
    platoon: Option<u8>,
    team: Team,
    controller: Option<u32>,
    epoch: u64,
    last_seq: u64,
    last_input: f64,
    fire: bool,
    loss_counted: bool,
    navigation: Option<NavigationPlan>,
    reinforcing: bool,
    support: Option<SupportActor>,
}
#[derive(Clone)]
struct SupportTask {
    kind: FacilityJobKind,
    facility_id: String,
    expected_revision: u64,
    status: String,
    reason: Option<String>,
    job_id: Option<u64>,
    retry_at: f64,
    automatic: bool,
}
struct SupportActor {
    role: String,
    source: String,
    task: Option<SupportTask>,
    next_auto: f64,
}
#[derive(Clone)]
struct SupportDeployment {
    source: String,
    team: Team,
    role: String,
    slots: Vec<([f64; 3], f64)>,
}
struct Company {
    view: CompanyView,
    last_order_seq: u64,
    vehicle: String,
    reinforcement_next: f64,
    reinforcement_retry: f64,
    reinforcement_status: String,
}
#[derive(Clone)]
struct Staging {
    id: String,
    team: Team,
    front: String,
    objective: Option<String>,
    road: String,
    pos: [f64; 3],
    radius: f64,
    slots: Vec<[f64; 3]>,
    headings: Vec<f64>,
    entry: Vec<[f64; 2]>,
    support_slots: Vec<([f64; 3], f64)>,
}
struct Room {
    player_ground_allowed: bool,
    scores: BTreeMap<u32, PlayerScore>,
    damage_credit: BTreeMap<UnitRef, DamageCredit>,
    settled_losses: BTreeSet<UnitRef>,
    scored_contacts: BTreeSet<(u64, UnitRef)>,
    ground_hit_points: BTreeMap<UnitRef, u32>,
    team_score: [u32; 2],
    zone_seconds: [f64; 2],
    id: u32,
    name: String,
    map: String,
    map_revision: String,
    era: u32,
    host: u32,
    battle: u64,
    started: bool,
    members: BTreeMap<u32, Participant>,
    // Explicitly departed commanders keep their gate/epoch with the existing company.
    // These are ownership records, not active human/observer seats or network actors.
    departed: BTreeMap<u32, Participant>,
    companies: BTreeMap<u64, Company>,
    units: BTreeMap<u64, Unit>,
    sim: SimWorld,
    air: AirWorld,
    scenario: Option<crate::frontline_scenario::ScenarioState>,
    naval_public: [Vec<Value>;2],
    perception: PerceptionWorld,
    perception_events: [Vec<Value>; 2],
    perception_error: Option<String>,
    vehicles: Vec<VehicleOption>,
    staging: Vec<Staging>,
    ai_staging: Vec<String>,
    pending_support: Vec<SupportDeployment>,
    support_retry: f64,
    facility_catalog: Vec<Value>,
    facility_layout_hash: String,
    route: Vec<[f64; 2]>,
    objectives: Vec<ObjectiveView>,
    campaign: Campaign,
    readiness: [u32; 2],
    started_at: f64,
    last_step: f64,
    tick: u64,
    bounds: [f64; 4],
    finished: bool,
    round_number: u32,
    round_seconds: f64,
    intermission_seconds: f64,
    restart_at: Option<f64>,
    next_round_s: Option<f64>,
    result: Option<RoundResult>,
    unobserved_since: Option<f64>,
    timing: Option<RoomTimings>,
}
#[derive(Clone, Copy, Debug, Default, Serialize)]
struct RoomTimings {
    steps: u64,
    ground_ai_ns: u64,
    simulation_ns: u64,
    campaign_reinforcement_ns: u64,
    views_ns: u64,
}

pub struct FrontlineHub {
    templates: BTreeMap<String, SimWorld>,
    air_template: std::sync::Arc<AirTemplate>,
    maps: BTreeMap<String, Value>,
    map_sources: BTreeMap<String, String>,
    map_revisions: BTreeMap<String, String>,
    catalog: Vec<VehicleOption>,
    rooms: BTreeMap<u32, Room>,
    membership: BTreeMap<u32, u32>,
    nicknames: BTreeMap<u32, String>,
    #[cfg(test)]
    test_ground_allowed: bool,
    next_room: u32,
    next_battle: u64,
    next_company: u64,
    next_unit: u64,
    round_seconds: f64,
    intermission_seconds: f64,
}

/// Explicit test-scene selection keeps legacy native fixtures bounded without
/// making the production Korean campaign silently fall back to its old C2 slice.
#[cfg(test)]
pub(crate) fn c2_fixture_map(mut map: Value) -> Result<Value, String> {
    if map["initialScene"]["objectiveIds"]
        .as_array()
        .is_some_and(|ids| ids.len() == 1)
    {
        return Ok(map);
    }
    let fixture = map["fixtures"]["c2"].clone();
    if !fixture["initialScene"].is_object() || !fixture["campaign"].is_object() {
        return Err("Full map must retain the explicit native C2 test scene".into());
    }
    map["initialScene"] = fixture["initialScene"].clone();
    map["campaign"] = fixture["campaign"].clone();
    let road = map["initialScene"]["roadId"]
        .as_str()
        .ok_or("C2 fixture has no road")?
        .to_owned();
    let staging: Vec<_> = map["initialScene"]["stagingIds"]
        .as_array()
        .ok_or("C2 fixture has no sources")?
        .iter()
        .filter_map(Value::as_str)
        .map(str::to_owned)
        .collect();
    for r in map["roads"].as_array_mut().ok_or("Missing roads")? {
        r["navEnabled"] = json!(r["id"] == road && r["connected"] == true);
    }
    for s in map["staging"].as_array_mut().ok_or("Missing sources")? {
        s["enabled"] = json!(s["id"]
            .as_str()
            .is_some_and(|id| staging.iter().any(|key| key == id)));
    }
    Ok(map)
}

fn failure(code: &str, message: impl Into<String>) -> Update {
    Update::Error {
        code: code.into(),
        message: message.into(),
    }
}
fn perception_los(sim: &SimWorld, observer: &PerceptionActor, target: &PerceptionActor) -> bool {
    let mut eye = observer.pos;
    let mut locus = target.pos;
    // Explicit game optical observation loci. Native hulls/terrain occlude the
    // ray; these offsets are not historical optics, radar or sensor profiles.
    eye[1] += if observer.kind == ActorKind::Ground {
        2.2
    } else {
        1.0
    };
    if !target.event_locus {
        locus[1] += if target.kind == ActorKind::Ground {
            1.0
        } else {
            0.0
        };
    }
    sim.perception_los(observer.unit.unit, target.unit.unit, eye, locus)
}
fn point(v: &Value) -> Option<[f64; 3]> {
    let a = v.as_array()?;
    let p = [
        a.first()?.as_f64()?,
        a.get(1)?.as_f64()?,
        a.get(2)?.as_f64()?,
    ];
    p.iter().all(|v| v.is_finite()).then_some(p)
}
fn distance(a: [f64; 3], b: [f64; 3]) -> f64 {
    (a[0] - b[0]).hypot(a[2] - b[2])
}
// Preserve the old 2D range and first-equal minimum while querying visibility
// only until the nearest visible eligible body is found. The sort is stable;
// inputs retain the authoritative BTreeMap unit order.
fn nearest_visible_ground<'a>(
    bodies: &'a [SimKinematics],
    origin: [f64; 3],
    team: Team,
    mut visible: impl FnMut(&SimKinematics) -> bool,
) -> Option<&'a SimKinematics> {
    let mut ranked: Vec<_> = bodies
        .iter()
        .filter_map(|body| {
            if !body.alive || body.team as usize == team.index() {
                return None;
            }
            let range = distance(body.pos, origin);
            (range < 1800.0).then_some((range, body))
        })
        .collect();
    ranked.sort_by(|a, b| a.0.total_cmp(&b.0));
    ranked
        .into_iter()
        .find(|(_, body)| visible(body))
        .map(|(_, body)| body)
}
#[cfg(test)]
fn wrap(a: f64) -> f64 {
    (a + std::f64::consts::PI).rem_euclid(std::f64::consts::TAU) - std::f64::consts::PI
}
impl FrontlineHub {
    /// Short native-duration rule fixtures only; never a remote command or
    /// production environment switch which can shorten advertised battles.
    #[cfg(test)]
    pub(crate) fn set_round_timing_for_test(
        &mut self,
        round_seconds: f64,
        intermission_seconds: f64,
    ) -> Result<(), String> {
        if !self.rooms.is_empty()
            || ![round_seconds, intermission_seconds]
                .iter()
                .all(|s| s.is_finite() && *s >= STEP)
        {
            return Err("Timing policy requires finite positive durations before rooms".into());
        }
        self.round_seconds = round_seconds;
        self.intermission_seconds = intermission_seconds;
        Ok(())
    }
    #[cfg(test)]
    pub(crate) fn use_c2_test_scene(&mut self) -> Result<(), String> {
        self.enable_legacy_ground_for_test();
        let map = self.maps.get("korea").ok_or("Korean map missing")?.clone();
        let map = c2_fixture_map(map)?;
        self.templates
            .get_mut("korea")
            .ok_or("Korean native template missing")?
            .ground
            .select_navigation_scene(&map)?;
        let source = serde_json::to_string(&map).map_err(|e| e.to_string())?;
        self.map_revisions.insert(
            "korea".into(),
            tg_combat::geometry::manifest::sha256(source.as_bytes()),
        );
        self.map_sources.insert("korea".into(), source);
        self.maps.insert("korea".into(), map);
        Ok(())
    }
    pub fn new(data_path: &Path) -> Result<Self, String> {
        let mut maps = BTreeMap::new();
        let mut map_sources = BTreeMap::new();
        let mut map_revisions = BTreeMap::new();
        // Only explicit installed theatre IDs are addressable. An optional file
        // may be absent; a present invalid asset must fail closed at startup.
        for id in ["korea", "taiwan", "taiwan-escort"] {
            let path = data_path.join("frontline").join(format!("{id}.json"));
            let source = match std::fs::read_to_string(&path) {
                Ok(s) => s,
                Err(e) if id != "korea" && e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => return Err(format!("{}: {e}", path.display())),
            };
            let map: Value = serde_json::from_str(&source)
                .map_err(|e| format!("Invalid {id} frontline data: {e}"))?;
            if map["id"].as_str() != Some(id) {
                return Err(format!("Frontline map id must be {id}"));
            }
            maps.insert(id.to_owned(), map);
            map_revisions.insert(
                id.to_owned(),
                tg_combat::geometry::manifest::sha256(source.as_bytes()),
            );
            map_sources.insert(id.to_owned(), source);
        }
        let mut catalog = Vec::new();
        for entry in std::fs::read_dir(data_path.join("vehicles"))
            .map_err(|e| e.to_string())?
            .flatten()
        {
            let p = entry.path().join("vehicle.json");
            let Ok(bytes) = std::fs::read(p) else {
                continue;
            };
            let Ok(v) = serde_json::from_slice::<Value>(&bytes) else {
                continue;
            };
            let Some(year) = v["meta"]["year"]
                .as_u64()
                .filter(|v| (1900..=2100).contains(v))
            else {
                continue;
            };
            let Some(id) = entry.file_name().to_str().map(String::from) else {
                continue;
            };
            catalog.push(VehicleOption {
                name: v["name"].as_str().unwrap_or(&id).into(),
                id,
                year: year as u32,
            });
        }
        catalog.sort_by(|a, b| a.id.cmp(&b.id));
        // Validate the actual native terrain/catalog at startup, then share loaded models
        // through the adapter's Arc-backed clone rather than reparsing every room.
        let template = SimWorld::load(data_path, &maps["korea"])
            .map_err(|e| format!("Invalid korea native world: {e}"))?;
        let air_template = AirTemplate::load(data_path)?;
        let mut templates = BTreeMap::new();
        for (id, map) in &maps {
            let native = if id == "korea" {
                template.clone()
            } else {
                template
                    .for_map(data_path, map)
                    .map_err(|e| format!("Invalid {id} native world: {e}"))?
            };
            // Validate objectives, supply graph, pads, source bindings and
            // before publishing the raw asset through HTTP. AirWorld receives
            // this same map and canonical ground; spawn admission remains native.
            let air = air_template.world(std::sync::Arc::new(native.ground.clone()), map.clone());
            Room::new(
                0,
                1,
                "map validation".into(),
                id.clone(),
                map_revisions[id].clone(),
                1986,
                0,
                true,
                native.clone(),
                air,
                catalog.clone(),
                map,
            )
            .map_err(|e| format!("Invalid {id} campaign: {e}"))?;
            templates.insert(id.clone(), native);
        }
        Ok(Self {
            templates,
            air_template,
            maps,
            map_sources,
            map_revisions,
            catalog,
            rooms: BTreeMap::new(),
            membership: BTreeMap::new(),
            nicknames: BTreeMap::new(),
            #[cfg(test)]
            test_ground_allowed: false,
            next_room: 1,
            next_battle: 1,
            next_company: 1,
            next_unit: 1,
            round_seconds: ROUND_SECONDS,
            intermission_seconds: INTERMISSION_SECONDS,
        })
    }
    #[cfg(test)]
    pub(crate) fn enable_legacy_ground_for_test(&mut self) {
        self.test_ground_allowed = true;
    }
    pub fn set_nickname(&mut self, player: u32, name: String) {
        self.nicknames.insert(player, name.clone());
        for room in self.rooms.values_mut() {
            if let Some(p) = room.members.get_mut(&player) {
                p.view.name = name.clone();
            }
            if let Some(p) = room.departed.get_mut(&player) {
                p.view.name = name.clone();
            }
            if let Some(s) = room.scores.get_mut(&player) {
                s.name = name.clone();
            }
        }
    }
    pub fn contains(&self, player: u32) -> bool {
        self.membership.contains_key(&player)
    }
    /// Transport cache reset only: reading a snapshot cannot resume control,
    /// advance a simulation clock or change life/epoch/resource ownership.
    pub fn snapshot_for(&self, player: u32) -> Option<Update> {
        self.membership
            .get(&player)
            .and_then(|id| self.rooms.get(id))
            .filter(|room| room.members.get(&player).is_some_and(|p| p.view.connected))
            .and_then(|room| room.command_update_for(player, room.snapshot()))
    }
    /// Diagnostic counters only; no simulation or authority mutation.
    pub fn timing_snapshot(&self) -> Vec<Value> {
        self.rooms.values().filter_map(|room|room.timing.map(|timing|json!({
            "room":room.id,"map":room.map,"ground_units":room.units.len(),"air_units":room.air.units.len(),
            "simulation_seconds":room.sim.time(),"room_timings":timing,"sim":room.sim.timings(),"air":room.air.timings()
        }))).collect()
    }
    pub fn map_json(&self, map: &str) -> Option<String> {
        self.map_source(map).map(str::to_owned)
    }
    pub fn map_source(&self, map: &str) -> Option<&str> {
        self.map_sources.get(map).map(String::as_str)
    }
    pub fn map_options(&self) -> Vec<Value> {
        self.maps.iter().map(|(id,m)|json!({"id":id,"name":m["name"].as_str().unwrap_or(id),"path":format!("/frontline/{id}.json"),"sha256":self.map_revisions[id]})).collect()
    }
    fn list(&self) -> Update {
        Update::Rooms {
            rooms: self.rooms.values().map(Room::view).collect(),
        }
    }
    pub fn resume(&mut self, player: u32, now: f64) -> Vec<(u32, Update)> {
        let Some(room) = self
            .membership
            .get(&player)
            .and_then(|id| self.rooms.get_mut(id))
        else {
            return Vec::new();
        };
        let Some(p) = room.members.get_mut(&player) else {
            return Vec::new();
        };
        p.view.connected = true;
        room.unobserved_since = None;
        let resume = p.resume_unit.take();
        if let Some(reference) = resume.filter(|_| !room.finished) {
            if room.air.units.get(&reference.unit).is_some_and(|u| {
                u.reference == reference
                    && u.owner == Some(player)
                    && u.alive()
                    && u.controller.is_none()
            }) {
                room.acquire_air(player, reference, now);
            } else if room
                .air
                .units
                .get(&reference.unit)
                .is_some_and(|u| u.reference == reference && !u.alive())
            {
                room.members.get_mut(&player).unwrap().gate = Gate::Loss;
            } else if room.valid_survivor(player, reference)
                && room.sim.snapshot(reference.unit).is_some_and(|s| s.alive)
            {
                room.acquire(player, reference, now);
            } else if room.sim.snapshot(reference.unit).is_some_and(|s| !s.alive) {
                room.members.get_mut(&player).unwrap().gate = Gate::Loss;
            }
        }
        vec![
            (player, room.snapshot()),
            (player, room.control(player, "resume")),
        ]
        .into_iter()
        .filter_map(|(player, message)| {
            room.command_update_for(player, message)
                .map(|m| (player, m))
        })
        .collect()
    }
    pub fn disconnect(&mut self, player: u32, now: f64) -> Vec<(u32, Update)> {
        let Some(room) = self
            .membership
            .get(&player)
            .and_then(|id| self.rooms.get_mut(id))
        else {
            return Vec::new();
        };
        if let Some(p) = room.members.get_mut(&player) {
            p.view.connected = false;
            p.resume_unit = p.view.controlled;
        }
        if !room.started && !room.finished {
            room.last_step = now;
            if room.host == player {
                if let Some(next) = room.members.values().find(|p| p.view.connected) {
                    room.host = next.view.player;
                }
            }
        }
        room.release(player, now);
        if room.members.values().all(|p| !p.view.connected) {
            room.unobserved_since.get_or_insert(now);
        }
        room.broadcast(Update::Room { room: room.view() })
    }
    pub fn leave(&mut self, player: u32) -> Vec<(u32, Update)> {
        let Some(id) = self.membership.remove(&player) else {
            return vec![(player, Update::Left)];
        };
        let mut out = vec![(player, Update::Left)];
        if let Some(room) = self.rooms.get_mut(&id) {
            if let Some(p) = room.members.get_mut(&player) {
                p.resume_unit = p.resume_unit.or(p.view.controlled);
            }
            room.release(player, room.last_step);
            if let Some(mut p) = room.members.remove(&player) {
                if p.view.company.is_some()
                    || room.air.units.values().any(|u| u.owner == Some(player))
                {
                    p.view.connected = false;
                    room.departed.insert(player, p);
                }
            }
            if room.host == player {
                room.host = room
                    .members
                    .values()
                    .find(|p| p.view.connected && !p.view.observer)
                    .or_else(|| room.members.values().find(|p| p.view.connected))
                    .or_else(|| room.members.values().next())
                    .map(|p| p.view.player)
                    .unwrap_or(0);
            }
            if room.members.values().all(|p| !p.view.connected) {
                room.unobserved_since.get_or_insert(room.last_step);
            }
            out.extend(room.broadcast(Update::Room { room: room.view() }));
            // Explicit last departure retires the unobserved battle. Dropped sockets
            // still have retained members and can reconnect beyond transport grace.
            if room.members.is_empty() {
                self.rooms.remove(&id);
            }
        }
        out
    }
    pub fn handle(&mut self, player: u32, command: Command, now: f64) -> Vec<(u32, Update)> {
        let output = self.handle_truth(player, command, now);
        self.authorize_commands(output)
    }
    fn authorize_commands(&self, output: Vec<(u32, Update)>) -> Vec<(u32, Update)> {
        output
            .into_iter()
            .filter_map(|(player, mut message)| {
                if let Update::Rooms { rooms } = &mut message {
                    for view in rooms {
                        if let Some(room) = self.rooms.get(&view.id) {
                            room.sanitize_room_for(player, view);
                        }
                    }
                    return Some((player, message));
                }
                let room_id = match &message {
                    Update::Snapshot { room, .. } | Update::Room { room } => Some(room.id),
                    _ => self.membership.get(&player).copied(),
                };
                if let Some(room) = room_id.and_then(|id| self.rooms.get(&id)) {
                    room.command_update_for(player, message)
                        .map(|m| (player, m))
                } else if matches!(
                    message,
                    Update::Snapshot { .. } | Update::Room { .. } | Update::Frame { .. }
                ) {
                    None
                } else {
                    Some((player, message))
                }
            })
            .collect()
    }
    fn handle_truth(&mut self, player: u32, command: Command, now: f64) -> Vec<(u32, Update)> {
        if !now.is_finite() || now < 0.0 {
            return vec![(player, failure("invalid_clock", "Invalid server clock"))];
        }
        match command {
            Command::List => return vec![(player, self.list())],
            Command::Leave => return self.leave(player),
            Command::Create {
                name,
                map,
                observer,
                era,
            } => {
                if self.contains(player) {
                    return vec![(
                        player,
                        failure("already_joined", "Leave the current frontline room first"),
                    )];
                }
                if self.rooms.len() >= MAX_ROOMS {
                    return vec![(
                        player,
                        failure("rooms_full", "Frontline room limit reached"),
                    )];
                }
                if !(1940..=2026).contains(&era) {
                    return vec![(
                        player,
                        failure("invalid_era", "Era year must be between 1940 and 2026"),
                    )];
                }
                let Some(data) = self.maps.get(&map) else {
                    return vec![(player, failure("unknown_map", "Unknown frontline map"))];
                };
                let Some(template) = self.templates.get(&map) else {
                    return vec![(
                        player,
                        failure("unknown_map", "Native theatre template is unavailable"),
                    )];
                };
                let mut sim = template.clone();
                let id = self.next_room;
                let battle = self.next_battle;
                if let Err(e) = sim.set_battle_id(battle) {
                    return vec![(player, failure("invalid_battle", e))];
                }
                let air = self.air_template
                    .world(std::sync::Arc::new(sim.ground.clone()), data.clone());
                #[cfg(test)]
                let legacy_ground = self.test_ground_allowed;
                #[cfg(not(test))]
                let legacy_ground = false;
                if !legacy_ground && air.options(era).is_empty() {
                    return vec![(player, failure("era_unavailable",
                        "No verified native aircraft is available for this era"))];
                }
                let supported: BTreeSet<String> = sim.available_vehicles().into_iter().collect();
                let mut vehicles: Vec<_> = self
                    .catalog
                    .iter()
                    .filter(|v| {
                        supported.contains(&v.id)
                            && v.year <= era
                            && v.year >= era.saturating_sub(25)
                    })
                    .cloned()
                    .collect();
                if !legacy_ground && vehicles.is_empty() {
                    // Ground actors are autonomous targets and capture forces.
                    // Their closest supported historical generation must not
                    // reject an otherwise admitted modern aircraft theatre.
                    if let Some(year) = self.catalog.iter()
                        .filter(|v| supported.contains(&v.id) && v.year <= era)
                        .map(|v| v.year).max() {
                        vehicles = self.catalog.iter()
                            .filter(|v| supported.contains(&v.id) && v.year <= year
                                && v.year >= year.saturating_sub(25))
                            .cloned().collect();
                    }
                }
                if vehicles.is_empty() {
                    return vec![(
                        player,
                        failure(
                            "era_unavailable",
                            "No verified native ground vehicle is available for this era",
                        ),
                    )];
                }
                let revision = self.map_revisions[&map].clone();
                let mut room = match Room::new(
                    id, battle, name, map, revision, era, player, observer, sim, air, vehicles,
                    data,
                ) {
                    Ok(r) => r,
                    Err(e) => return vec![(player, failure("invalid_map", e))],
                };
                room.round_seconds = self.round_seconds;
                room.intermission_seconds = self.intermission_seconds;
                #[cfg(test)]
                {
                    room.player_ground_allowed = self.test_ground_allowed;
                    room.campaign
                        .set_air_frontline(&mut room.objectives, !room.player_ground_allowed);
                }
                if let Some(p) = room.members.get_mut(&player) {
                    p.view.name = self
                        .nicknames
                        .get(&player)
                        .cloned()
                        .unwrap_or_else(|| format!("玩家{player}"));
                }
                self.next_room += 1;
                self.next_battle += 1;
                self.rooms.insert(id, room);
                self.membership.insert(player, id);
                let room = &self.rooms[&id];
                return vec![(player, room.snapshot())];
            }
            Command::Join {
                room: id,
                observer,
                team,
            } => {
                if let Some(current) = self.membership.get(&player) {
                    if *current == id {
                        return self.resume(player, now);
                    }
                    return vec![(
                        player,
                        failure("already_joined", "Leave the current frontline room first"),
                    )];
                }
                let Some(room) = self.rooms.get_mut(&id) else {
                    return vec![(
                        player,
                        failure("unknown_room", "Frontline room does not exist"),
                    )];
                };
                let retained = room
                    .companies
                    .values()
                    .find(|c| c.view.owner == Some(player))
                    .map(|c| (c.view.id, c.view.team));
                let retired_team = room.departed.get(&player).map(|p| p.view.team);
                let team = retained
                    .map(|(_, t)| t)
                    .or(retired_team)
                    .or(team)
                    .unwrap_or_else(|| {
                        if room.player_count(Team::Blue) <= room.player_count(Team::Red) {
                            Team::Blue
                        } else {
                            Team::Red
                        }
                    });
                if !observer && room.player_count(team) >= TEAM_PLAYERS {
                    return vec![(
                        player,
                        failure("team_full", "This team has twelve human participants"),
                    )];
                }
                if observer && room.members.values().filter(|p| p.view.observer).count() >= 16 {
                    return vec![(
                        player,
                        failure("observer_full", "Observer capacity reached"),
                    )];
                }
                if observer
                    && (retained.is_some()
                        || room.air.units.values().any(|u| u.owner == Some(player)))
                {
                    return vec![(player, failure("owned_company", "Rejoin as your company commander; retained companies cannot acquire observer seats"))];
                }
                let mut participant =
                    room.departed
                        .remove(&player)
                        .unwrap_or_else(|| Participant {
                            view: MemberView {
                                player,
                                name: self
                                    .nicknames
                                    .get(&player)
                                    .cloned()
                                    .unwrap_or_else(|| format!("玩家{player}")),
                                team,
                                observer,
                                connected: true,
                                company: retained.map(|(id, _)| id),
                                controlled: None,
                                epoch: 1,
                                air_sorties_remaining: u8::from(!observer),
                                air_sortie_eligible: !observer,
                            },
                            gate: if retained.is_some() {
                                Gate::None
                            } else {
                                Gate::Initial
                            },
                            resume_unit: None,
                            air_sortie_used: false,
                        });
                participant.view.connected = true;
                room.members.insert(player, participant);
                room.unobserved_since = None;
                self.membership.insert(player, id);
                let mut out = self.resume(player, now);
                let room = &self.rooms[&id];
                out.extend(room.broadcast(Update::Room { room: room.view() }));
                return out;
            }
            _ => {}
        }
        let Some(id) = self.membership.get(&player).copied() else {
            return vec![(player, failure("not_joined", "Join a frontline room first"))];
        };
        let room = self.rooms.get_mut(&id).expect("frontline membership");
        if let Some(p) = room.members.get_mut(&player) {
            p.view.connected = true;
        }
        let requested_staging = match &command {
            Command::DeployAt { staging, .. } => Some(staging.clone()),
            _ => None,
        };
        let result: Result<Vec<(u32, Update)>, Update> = (|| {
            if !room.player_ground_allowed
                && matches!(
                    &command,
                    Command::Deploy { .. }
                        | Command::DeployAt { .. }
                        | Command::Input { .. }
                        | Command::Takeover { .. }
                        | Command::Order { .. }
                        | Command::SupportOrder { .. }
                )
            {
                return Err(failure(
                    "air_only",
                    "本模式玩家只驾驶飞机，地面部队由AI指挥",
                ));
            }
            if room.finished && !matches!(command, Command::Snapshot) {
                return Err(failure(
                    "round_ended",
                    "This battle has ended; create a new frontline room for another round",
                ));
            }
            match command {
                Command::Snapshot => Ok(vec![(player, room.snapshot())]),
                Command::Start => {
                    if room.host != player {
                        return Err(failure("not_host", "Only the frontline host may start"));
                    }
                    if room.started {
                        return Ok(vec![(player, room.snapshot())]);
                    }
                    room.start_round(&mut self.next_company, &mut self.next_unit, now)?;
                    Ok(room.members.keys().map(|p| (*p, room.snapshot())).collect())
                }
                Command::DeployAir {
                    aircraft,
                    spawn,
                    loadout,
                    custom,
                    custom_counts,
                    fuel_minutes,
                } => {
                    if !room.started {
                        return Err(failure("not_started", "Start the frontline battle first"));
                    }
                    let p = &room.members[&player];
                    if p.view.observer {
                        return Err(failure("observer", "Observers cannot deploy aircraft"));
                    }
                    if p.view.controlled.is_some() || p.gate == Gate::None {
                        return Err(failure("role_gate","Return to friendly deployment or lose the controlled vehicle before changing role"));
                    }
                    if room.player_ground_allowed && room.readiness[p.view.team.index()] == 0 {
                        return Err(failure(
                            "readiness_exhausted",
                            "Team readiness is exhausted",
                        ));
                    }
                    if !room.air.options(room.era).iter().any(|a| {
                        a.id == aircraft
                            && (custom.is_some() || a.loadouts
                                .iter()
                                .any(|l| l["index"].as_u64() == Some(loadout as u64)))
                    }) {
                        return Err(failure(
                            "era_or_loadout",
                            "Aircraft/loadout is not available in this room's admitted pool",
                        ));
                    }
                    // A returned aircraft remains in the world. Reuse it at the runway rather
                    // than minting a fresh full-fuel/ammunition copy through the role menu.
                    let parked = room
                        .air
                        .units
                        .values()
                        .find(|u| {
                            u.owner == Some(player)
                                && u.alive()
                                && u.aircraft == aircraft
                                && u.controller.is_none()
                                && room.air.at_friendly_runway(u.reference.unit)
                        })
                        .map(|u| u.reference);
                    let reference = if let Some(r) = parked {
                        if !room.air.loadout_matches_counts(r.unit, loadout, custom.as_ref(), custom_counts.as_ref())
                            .map_err(|e| failure("era_or_loadout", e))? {
                            return Err(failure("service_required", "Rejoin the surviving aircraft with its current loadout, then complete15-second friendly-airfield service to change its stores"));
                        }
                        r
                    } else {
                        if room
                            .air
                            .units
                            .values()
                            .any(|u| u.owner == Some(player) && u.alive())
                        {
                            return Err(failure("owned_aircraft_active","Your surviving aircraft remains in this battle; return to it at the friendly runway"));
                        }
                        if !room.player_ground_allowed && p.air_sortie_used {
                            return Err(failure("air_sortie_spent", "本局出击飞机已损失，请观战等待下一局"));
                        }
                        let reference = UnitRef {
                            battle: room.battle,
                            unit: self.next_unit,
                            life: 1,
                        };
                        room.air
                            .spawn_configured_counts_fuel(
                                reference,
                                &aircraft,
                                p.view.team,
                                Some(player),
                                &spawn,
                                loadout,
                                custom.as_ref(),
                                custom_counts.as_ref(),
                                fuel_minutes,
                            )
                            .map_err(|e| failure("air_spawn_failed", e))?;
                        self.next_unit += 1;
                        room.members.get_mut(&player).unwrap().air_sortie_used = true;
                        reference
                    };
                    room.acquire_air(player, reference, now);
                    Ok(vec![
                        (player, room.snapshot()),
                        (player, room.control(player, "aircraft_sortie")),
                    ])
                }
                Command::ServiceAir {
                    unit,
                    epoch,
                    seq,
                    loadout,
                    custom,
                    custom_counts,
                    fuel_minutes,
                } => {
                    room.validate_air_control(player, unit, epoch, seq)?;
                    let aircraft = &room.air.units[&unit.unit].aircraft;
                    if !room.air.options(room.era).iter().any(|a| {
                        a.id == *aircraft
                            && (custom.is_some() || a.loadouts
                                .iter()
                                .any(|l| l["index"].as_u64() == Some(loadout as u64)))
                    }) {
                        return Err(failure(
                            "era_or_loadout",
                            "Requested airfield configuration is not in this room's admitted pool",
                        ));
                    }
                    room.air
                        .request_service_counts_fuel(unit.unit, loadout, custom.as_ref(), custom_counts.as_ref(), fuel_minutes, now)
                        .map_err(|e| failure("service_rejected", e))?;
                    room.air.units.get_mut(&unit.unit).unwrap().last_seq = seq;
                    Ok(vec![(player, room.snapshot())])
                }
                Command::CancelAirService { unit, epoch, seq } => {
                    room.validate_air_control(player, unit, epoch, seq)?;
                    room.air
                        .cancel_service(unit.unit)
                        .map_err(|e| failure("service_rejected", e))?;
                    room.air.units.get_mut(&unit.unit).unwrap().last_seq = seq;
                    Ok(vec![(player, room.snapshot())])
                }
                Command::AirWeaponControl { unit, epoch, seq, store_id, store_index, program, gun_mode } => {
                    room.validate_air_control(player, unit, epoch, seq)?;
                    room.air.set_weapon_control(unit.unit, store_id, store_index, program, gun_mode)
                        .map_err(|reason| failure("weapon_control_rejected", reason))?;
                    room.air.units.get_mut(&unit.unit).unwrap().last_seq = seq;
                    Ok(vec![(player, room.snapshot())])
                }
                Command::AirSeekerControl { unit, epoch, seq, enabled, radar, target, sight, laser, ecm, manual } => {
                    room.validate_air_control(player, unit, epoch, seq)?;
                    room.air.set_guidance_control_with_sight(unit.unit,enabled,radar,target,sight,laser,ecm,manual,&room.sim)
                        .map_err(|reason|failure("seeker_control_rejected",reason))?;
                    if sight.is_some(){room.air.acknowledge_point_capture(unit.unit,seq);}
                    room.air.units.get_mut(&unit.unit).unwrap().last_seq=seq;
                    Ok(vec![(player,room.snapshot())])
                }
                Command::AirCountermeasure { unit, epoch, seq, kind } => {
                    room.validate_air_control(player,unit,epoch,seq)?;
                    room.air.release_countermeasure(unit.unit,&kind)
                        .map_err(|reason|failure("countermeasure_rejected",reason))?;
                    room.air.units.get_mut(&unit.unit).unwrap().last_seq=seq;
                    Ok(vec![(player,room.snapshot())])
                }
                Command::AirPose { unit, epoch, seq, pose } => {
                    room.validate_air_control(player, unit, epoch, seq)?;
                    let accepted = match room.air.accept_pose(unit.unit, epoch, pose, now) {
                        Ok(pose)=>pose,
                        Err(reason)=>return Ok(vec![(player,failure("air_pose_rejected",reason)),(player,room.snapshot())]),
                    };
                    room.air.units.get_mut(&unit.unit).unwrap().last_seq = seq;
                    Ok(vec![(player, Update::AirPoseAccepted { unit, epoch, seq, pose: accepted })])
                }
                Command::AirInput {
                    unit,
                    epoch,
                    seq,
                    aim,
                    throttle,
                    manual_pitch,
                    manual_roll,
                    manual_yaw,
                    flags,
                    fire,
                    release,
                } => {
                    let input = AirInput {
                        aim,
                        throttle,
                        manual_pitch,
                        manual_roll,
                        manual_yaw,
                        flags,
                        fire,
                        release,
                    };
                    if !input.valid() {
                        return Err(failure("invalid_input", "Invalid aircraft control intent"));
                    }
                    let Some(u) = room.air.units.get(&unit.unit) else {
                        return Err(failure("unknown_unit", "Aircraft does not exist"));
                    };
                    if u.reference != unit
                        || u.controller != Some(player)
                        || u.epoch != epoch
                        || room.members[&player].view.controlled != Some(unit)
                    {
                        return Err(failure(
                            "stale_control",
                            "Aircraft life/control epoch is no longer owned",
                        ));
                    }
                    if seq <= u.last_seq || seq > 9_007_199_254_740_991 {
                        return Err(failure(
                            "stale_input",
                            "Aircraft input sequence must increase",
                        ));
                    }
                    room.air
                        .accept_input(unit.unit, input, now)
                        .map_err(|e| failure("input_rejected", e))?;
                    room.air.units.get_mut(&unit.unit).unwrap().last_seq = seq;
                    Ok(Vec::new())
                }
                Command::Deploy { vehicle } | Command::DeployAt { vehicle, .. } => {
                    if !room.started {
                        return Err(failure("not_started", "Start the frontline battle first"));
                    }
                    let p = &room.members[&player];
                    if p.view.observer {
                        return Err(failure(
                            "observer",
                            "Observers do not deploy or own companies",
                        ));
                    }
                    if p.view.controlled.is_some() {
                        return Err(failure("already_controlled", "Return to friendly deployment or lose the controlled tank before selecting a role"));
                    }
                    if !room.vehicles.iter().any(|v| v.id == vehicle) {
                        return Err(failure(
                            "era_or_vehicle",
                            "Vehicle is not in this room's verified native era pool",
                        ));
                    }
                    let source = room
                        .select_staging(p.view.team, requested_staging.as_deref(), p.view.company)?
                        .clone();
                    if let Some(company) = p.view.company {
                        if p.gate == Gate::Loss {
                            return Err(failure("choose_survivor", "Choose an owned surviving tank or an aircraft sortie; missing tanks arrive physically in rear-source reinforcement batches"));
                        }
                        let candidate = room
                            .companies
                            .get(&company)
                            .into_iter()
                            .flat_map(|c| &c.view.units)
                            .copied()
                            .find(|u| {
                                room.sim.snapshot(u.unit).is_some_and(|s| {
                                    s.alive
                                        && s.vehicle == vehicle
                                        && distance(s.pos, source.pos) <= source.radius
                                }) && room
                                    .units
                                    .get(&u.unit)
                                    .is_some_and(|u| u.controller.is_none())
                            });
                        let Some(unit) = candidate else {
                            return Err(failure("no_deployment_survivor", "No owned surviving tank is physically available at deployment; no new company was created"));
                        };
                        room.acquire(player, unit, now);
                        return Ok(vec![
                            (player, room.snapshot()),
                            (player, room.control(player, "deployment_return")),
                        ]);
                    }
                    let team = p.view.team;
                    if room
                        .companies
                        .values()
                        .filter(|c| c.view.team == team && !c.view.autonomous)
                        .count()
                        >= TEAM_COMPANIES
                    {
                        return Err(failure(
                            "company_slots_full",
                            "Team company slots remain occupied by their persistent units",
                        ));
                    }
                    if room.readiness[team.index()] == 0 {
                        return Err(failure(
                            "readiness_exhausted",
                            "Team readiness is exhausted",
                        ));
                    }
                    let company = room
                        .spawn_company(
                            Some(player),
                            team,
                            &vehicle,
                            false,
                            Some(&source.id),
                            &mut self.next_company,
                            &mut self.next_unit,
                            now,
                        )
                        .map_err(|e| failure("deployment_busy", e))?;
                    let unit = room.companies[&company].view.units[0];
                    room.members.get_mut(&player).unwrap().view.company = Some(company);
                    room.acquire(player, unit, now);
                    Ok(room.broadcast(room.snapshot()))
                }
                Command::Input {
                    unit,
                    epoch,
                    seq,
                    throttle,
                    steer,
                    brake,
                    turret_yaw,
                    gun_pitch,
                    fire,
                } => {
                    if ![throttle, steer, brake, turret_yaw, gun_pitch]
                        .iter()
                        .all(|v| v.is_finite())
                        || throttle.abs() > 1.0
                        || steer.abs() > 1.0
                        || !(0.0..=1.0).contains(&brake)
                        || turret_yaw.abs() > 1e4
                        || gun_pitch.abs() > std::f64::consts::PI
                    {
                        return Err(failure(
                            "invalid_input",
                            "Nonfinite or out-of-range control input",
                        ));
                    }
                    let Some(u) = room.units.get_mut(&unit.unit) else {
                        return Err(failure("unknown_unit", "Unit does not exist"));
                    };
                    if u.reference != unit
                        || u.controller != Some(player)
                        || u.epoch != epoch
                        || room.members[&player].view.controlled != Some(unit)
                    {
                        return Err(failure(
                            "stale_control",
                            "Unit life or control epoch is no longer owned",
                        ));
                    }
                    if seq <= u.last_seq || seq > 9_007_199_254_740_991 {
                        return Err(failure(
                            "stale_input",
                            "Control sequence must increase within this ownership epoch",
                        ));
                    }
                    if !room.sim.snapshot(unit.unit).is_some_and(|s| s.alive) {
                        return Err(failure("destroyed", "The controlled unit was destroyed"));
                    }
                    u.last_seq = seq;
                    u.last_input = now;
                    u.fire = fire;
                    room.sim
                        .set_input(
                            unit.unit,
                            SimInput {
                                throttle: throttle as f32,
                                steer: steer as f32,
                                brake: brake as f32,
                                turret_yaw: Some(turret_yaw),
                                gun_pitch: Some(gun_pitch),
                            },
                        )
                        .map_err(|e| failure("input_rejected", e))?;
                    Ok(Vec::new())
                }
                Command::Order {
                    company,
                    platoons,
                    kind,
                    target,
                    seq,
                } => {
                    if !target.iter().all(|v| v.is_finite()) || !room.in_bounds(target) {
                        return Err(failure(
                            "invalid_target",
                            "Order target is outside the accepted map",
                        ));
                    }
                    let Some(c) = room.companies.get(&company) else {
                        return Err(failure("unknown_company", "Company does not exist"));
                    };
                    if c.view.owner != Some(player) || room.members[&player].view.observer {
                        return Err(failure(
                            "not_owner",
                            "Only the owning commander may order this company",
                        ));
                    }
                    if seq <= c.last_order_seq || seq > 9_007_199_254_740_991 {
                        return Err(failure(
                            "stale_order",
                            "Company order sequence must increase",
                        ));
                    }
                    let indices: BTreeSet<u8> = if platoons.is_empty() {
                        [0, 1, 2].into_iter().collect()
                    } else {
                        platoons.into_iter().collect()
                    };
                    if indices.iter().any(|p| *p > 2) {
                        return Err(failure(
                            "unknown_platoon",
                            "Platoons are numbered 0, 1 and 2",
                        ));
                    }
                    let mut accepted = Vec::new();
                    let mut plans = Vec::new();
                    for &index in &indices {
                        let mut routes = BTreeSet::new();
                        let mut front = None;
                        for reference in &c.view.platoons[index as usize] {
                            let Some(state) = room.sim.snapshot(reference.unit).filter(|s| s.alive)
                            else {
                                continue;
                            };
                            let plan=room.plan_navigation(state.pos,target,c.view.team,None)
                                .ok_or_else(||failure("route_unreachable","No registered physical route connects this platoon to the target; cross-front movement needs a registered connector"))?;
                            front = Some(plan.front.clone());
                            routes.extend(plan.roads.iter().cloned());
                            plans.push((reference.unit, plan));
                        }
                        let front = front.ok_or_else(|| {
                            failure(
                                "no_survivors",
                                "This platoon has no surviving native vehicles",
                            )
                        })?;
                        accepted.push((index, front, routes.into_iter().collect::<Vec<_>>()));
                    }
                    let c = room.companies.get_mut(&company).unwrap();
                    for (index, front, routes) in accepted {
                        c.view.orders.retain(|o| o.platoon != Some(index));
                        c.view.orders.push(OrderView {
                            platoon: Some(index),
                            kind,
                            target,
                            seq,
                            front,
                            routes,
                        });
                    }
                    c.last_order_seq = seq;
                    for (unit, plan) in plans {
                        room.units.get_mut(&unit).unwrap().navigation = Some(plan);
                    }
                    Ok(room.broadcast(Update::OrderAccepted { company, seq }))
                }
                Command::SupportOrder {
                    unit,
                    kind,
                    facility_id,
                    expected_revision,
                    seq,
                } => {
                    let member = &room.members[&player].view;
                    if member.observer || !room.started {
                        return Err(failure(
                            "support_not_commandable",
                            "Join a running team to command support",
                        ));
                    }
                    let actor = room
                        .units
                        .get(&unit.unit)
                        .filter(|u| {
                            u.reference == unit
                                && u.team == member.team
                                && u.support.is_some()
                                && room.sim.unit_alive(unit.unit)
                        })
                        .ok_or_else(|| {
                            failure(
                                "foreign_support",
                                "Choose a living support unit belonging to your team",
                            )
                        })?;
                    if seq <= actor.last_seq {
                        return Err(failure(
                            "stale_sequence",
                            "Support command sequence must increase",
                        ));
                    }
                    let role = &actor.support.as_ref().unwrap().role;
                    if (kind == FacilityJobKind::Repair && role != "engineer")
                        || (kind == FacilityJobKind::DeliverSupply && role != "supply")
                    {
                        return Err(failure(
                            "support_role",
                            "This support conversion cannot perform that task",
                        ));
                    }
                    let facility = room
                        .sim
                        .facility_views()
                        .into_iter()
                        .find(|f| f.facility_id == facility_id)
                        .ok_or_else(|| {
                            failure("unknown_facility", "Unknown registered facility")
                        })?;
                    if facility
                        .team
                        .is_some_and(|t| t != member.team.index() as u8)
                    {
                        return Err(failure(
                            "foreign_facility",
                            "Enemy facilities cannot receive this team's work",
                        ));
                    }
                    if expected_revision != facility.revision {
                        return Err(failure(
                            "stale_facility",
                            "Facility changed; select its current revision",
                        ));
                    }
                    room.assign_support(unit, kind, facility_id, expected_revision, seq);
                    Ok(vec![(player, room.snapshot())])
                }
                Command::Takeover { unit } => {
                    if room.members[&player].gate != Gate::Loss
                        || room.members[&player].view.controlled.is_some()
                    {
                        return Err(failure(
                            "no_loss_gate",
                            "Survivor takeover is available only after controlled-tank loss",
                        ));
                    }
                    if !room.valid_survivor(player, unit)
                        || !room.sim.snapshot(unit.unit).is_some_and(|s| s.alive)
                    {
                        return Err(failure(
                            "invalid_survivor",
                            "Choose a living AI tank from your own company",
                        ));
                    }
                    room.acquire(player, unit, now);
                    Ok(vec![
                        (player, room.snapshot()),
                        (player, room.control(player, "survivor_takeover")),
                    ])
                }
                Command::Return => {
                    let p = &room.members[&player];
                    let Some(unit) = p.view.controlled else {
                        return Err(failure("no_control", "No controlled vehicle to return"));
                    };
                    if room.air.reference(unit.unit) == Some(unit) {
                        if !room.air.at_friendly_runway(unit.unit) {
                            return Err(failure(
                                "not_at_deployment",
                                "Stop on a friendly runway before changing role",
                            ));
                        }
                        room.release(player, now);
                        room.members.get_mut(&player).unwrap().gate = Gate::Returned;
                        return Ok(vec![
                            (player, room.snapshot()),
                            (player, room.control(player, "friendly_airfield_return")),
                        ]);
                    }
                    let Some(s) = room.sim.snapshot(unit.unit) else {
                        return Err(failure("unknown_unit", "Controlled unit is unavailable"));
                    };
                    if !s.alive
                        || !room.staging.iter().any(|source| {
                            source.team == p.view.team
                                && room.staging_available(source)
                                && distance(s.pos, source.pos) <= source.radius
                        })
                        || s.velocity.iter().map(|v| v * v).sum::<f64>().sqrt() > 1.5
                    {
                        return Err(failure(
                            "not_at_deployment",
                            "Stop inside friendly deployment before returning",
                        ));
                    }
                    room.release(player, now);
                    room.members.get_mut(&player).unwrap().gate = Gate::Returned;
                    Ok(vec![
                        (player, room.snapshot()),
                        (player, room.control(player, "friendly_return")),
                    ])
                }
                Command::Observe => {
                    let p = room.members.get_mut(&player).unwrap();
                    if p.view.company.is_some()
                        || p.view.controlled.is_some()
                        || room.air.units.values().any(|u| u.owner == Some(player))
                    {
                        return Err(failure("owns_company", "A company commander retains the company; use friendly return rather than acquiring an observer seat"));
                    }
                    p.view.observer = true;
                    Ok(room.broadcast(Update::Room { room: room.view() }))
                }
                _ => unreachable!("handled before room lookup"),
            }
        })();
        result.unwrap_or_else(|error| vec![(player, error)])
    }

    fn reset_round(&mut self, id: u32, now: f64) -> Result<Vec<(Vec<u32>, Update)>, String> {
        let old = self.rooms.get(&id).ok_or("Round room disappeared")?;
        if !old.finished || !old.members.values().any(|p| p.view.connected) {
            return Ok(Vec::new());
        }
        let battle = self.next_battle;
        if battle == 0 || battle >= 9_007_199_254_740_991 {
            return Err("Battle identity capacity reached".into());
        }
        let next_round = old
            .round_number
            .checked_add(1)
            .ok_or("Round number exhausted")?;
        let mut members = old.members.clone();
        for p in members.values_mut() {
            p.view.epoch = p
                .view
                .epoch
                .checked_add(1)
                .filter(|e| *e <= 9_007_199_254_740_991)
                .ok_or("Control epoch exhausted")?;
            p.view.controlled = None;
            p.view.company = None;
            p.resume_unit = None;
            p.gate = Gate::Initial;
            p.air_sortie_used = false;
        }
        let host = members
            .get(&old.host)
            .filter(|p| p.view.connected)
            .or_else(|| {
                members
                    .values()
                    .find(|p| p.view.connected && !p.view.observer)
            })
            .or_else(|| members.values().find(|p| p.view.connected))
            .ok_or("No connected next-round participant")?
            .view
            .player;
        let data = &self.maps[&old.map];
        let mut sim = self.templates[&old.map].clone();
        sim.set_battle_id(battle)?;
        let air = self
            .air_template
            .world(std::sync::Arc::new(sim.ground.clone()), data.clone());
        let mut fresh = Room::new(
            id,
            battle,
            old.name.clone(),
            old.map.clone(),
            old.map_revision.clone(),
            old.era,
            host,
            members[&host].view.observer,
            sim,
            air,
            old.vehicles.clone(),
            data,
        )?;
        fresh.members = members;
        fresh.player_ground_allowed = old.player_ground_allowed;
        fresh.campaign.set_air_frontline(&mut fresh.objectives, !old.player_ground_allowed);
        fresh.round_number = next_round;
        fresh.round_seconds = old.round_seconds;
        fresh.intermission_seconds = old.intermission_seconds;
        fresh
            .start_round(&mut self.next_company, &mut self.next_unit, now)
            .map_err(|e| format!("Next round start rejected: {e:?}"))?;
        self.next_battle += 1;
        let snapshots = fresh
            .members
            .values()
            .filter(|p| p.view.connected)
            .filter_map(|p| {
                fresh
                    .command_update_for(p.view.player, fresh.snapshot())
                    .map(|m| (vec![p.view.player], m))
            })
            .collect();
        self.rooms.insert(id, fresh);
        Ok(snapshots)
    }
    fn advance_intermission(&mut self, now: f64) -> Vec<(Vec<u32>, Update)> {
        let ids: Vec<_> = self
            .rooms
            .values()
            .filter(|r| r.finished && r.members.values().any(|p| p.view.connected))
            .map(|r| r.id)
            .collect();
        let mut output = Vec::new();
        for id in ids {
            {
                let r = self.rooms.get_mut(&id).unwrap();
                if now < r.last_step {
                    continue;
                }
                r.last_step = now;
            }
            let due = self.rooms[&id]
                .restart_at
                .is_some_and(|deadline| now >= deadline);
            if due {
                match self.reset_round(id, now) {
                    Ok(messages) => output.extend(messages),
                    Err(error) => {
                        eprintln!("frontline next-round {id}: {error}");
                        let r = self.rooms.get_mut(&id).unwrap();
                        r.restart_at = Some(now + 5.0);
                        r.next_round_s = Some(5.0);
                        output.extend(
                            r.broadcast(failure(
                                "round_restart_pending",
                                "下一局准备暂时受阻，正在重试",
                            ))
                            .into_iter()
                            .map(|(p, m)| (vec![p], m)),
                        );
                    }
                }
            } else {
                let room = self.rooms.get_mut(&id).unwrap();
                let remaining = room.restart_at.map(|deadline| (deadline - now).max(0.0));
                if remaining.map(f64::ceil) != room.next_round_s.map(f64::ceil) {
                    room.next_round_s = remaining;
                    output.extend(
                        room.broadcast(Update::Room { room: room.view() })
                            .into_iter()
                            .map(|(p, m)| (vec![p], m)),
                    );
                }
            }
        }
        output
    }
    pub fn tick(&mut self, now: f64) -> Vec<(Vec<u32>, Update)> {
        if !now.is_finite() {
            return Vec::new();
        }
        let mut output = self.advance_intermission(now);
        for room in self.rooms.values_mut().filter(|r| r.started) {
            if now < room.last_step + STEP {
                continue;
            }
            let steps = (((now - room.last_step) / STEP).floor() as usize).min(4);
            let bindings: BTreeMap<_, _> = room
                .members
                .iter()
                .map(|(id, p)| (*id, (p.view.controlled, p.view.epoch)))
                .collect();
            let mut events = Vec::new();
            let mut air_outcome = None;
            for _ in 0..steps {
                room.last_step += STEP;
                events.extend(room.step(&mut self.next_unit));
                if room.scenario.is_some() || !room.player_ground_allowed {
                    air_outcome = if let Some(scenario)=&room.scenario {
                        scenario.outcome().map(|(team,reason)|(Some(if team==0 {Team::Blue}else{Team::Red}),reason))
                    }else{room.air_round_outcome()};
                    if air_outcome.is_some() {
                        break;
                    }
                }
            }
            if now - room.last_step > 0.5 {
                room.last_step = now;
            }
            let recipients = room
                .members
                .values()
                .filter(|p| p.view.connected)
                .map(|p| p.view.player)
                .collect::<Vec<_>>();
            for (player, p) in &room.members {
                if p.view.connected
                    && bindings.get(player) != Some(&(p.view.controlled, p.view.epoch))
                {
                    output.push((vec![*player], room.control(*player, "controlled_loss")));
                }
            }
            let views_start = room.timing.as_ref().map(|_| Instant::now());
            let units = room.unit_views();
            let aircrafts = room.air.views();
            room.update_perception(&units, &aircrafts, &events);
            let frame = Update::Frame {
                battle: room.battle,
                tick: room.tick,
                units,
                companies: room.company_views(),
                readiness: room.readiness,
                objectives: room.public_objectives(),
                events,
                aircrafts,
                missiles:room.sim.guided_ordnance_views(),
                tracers:room.sim.air_gun_tracer_views(),
                staging: room.staging_views(),
                facilities: room.facility_views_for(None),
                facility_jobs: room.facility_jobs_for(None),
                vessels: room.vessel_views_for(None),
                scenario: room.scenario_status(),
                intel: None,
            };
            if let (Some(t), Some(start)) = (room.timing.as_mut(), views_start) {
                t.views_ns += start.elapsed().as_nanos() as u64;
            }
            // Serialize each authorized audience separately. Observer truth is
            // never a player's v1 payload or v2 full/delta/reset baseline.
            for audience in [None, Some(Team::Blue), Some(Team::Red)] {
                let audience_players: Vec<_> = room
                    .members
                    .values()
                    .filter(|p| {
                        p.view.connected
                            && if let Some(team) = audience {
                                !p.view.observer && p.view.team == team
                            } else {
                                p.view.observer
                            }
                    })
                    .map(|p| p.view.player)
                    .collect();
                if !audience_players.is_empty() {
                    output.push((audience_players, room.frame_for(audience, frame.clone())));
                }
            }
            let terminal_winner = room.campaign.terminal_winner(&room.objectives);
            if air_outcome.is_some()
                || room.scenario.is_none() && room.player_ground_allowed && (terminal_winner.is_some()
                    || room.readiness.contains(&0)
                    || room.sim.time() >= room.round_seconds)
            {
                room.started = false;
                room.finished = true;
                let players: Vec<_> = room.members.keys().copied().collect();
                for player in players {
                    room.release(player, now);
                    room.members.get_mut(&player).unwrap().resume_unit = None;
                    if room.members[&player].view.connected {
                        output.push((vec![player], room.control(player, "round_ended")));
                    }
                }
                let winner = if let Some((winner, _)) = air_outcome {
                    winner
                } else if terminal_winner.is_some() {
                    terminal_winner
                } else if room.readiness[0] == room.readiness[1] {
                    room.campaign.tiebreak(&room.objectives)
                } else if room.readiness[0] > room.readiness[1] {
                    Some(Team::Blue)
                } else {
                    Some(Team::Red)
                };
                let reason = if let Some((_, reason)) = air_outcome {
                    reason
                } else if terminal_winner.is_some() {
                    "frontline"
                } else if room.sim.time() >= room.round_seconds {
                    "time"
                } else {
                    "readiness"
                };
                room.result = Some(RoundResult {
                    battle: room.battle,
                    winner,
                    reason: reason.into(),
                });
                room.restart_at = Some(now + room.intermission_seconds);
                room.next_round_s = Some(room.intermission_seconds);
                output.push((
                    recipients,
                    Update::Ended {
                        battle: room.battle,
                        winner,
                        reason: reason.into(),
                    },
                ));
                output.extend(
                    room.broadcast(Update::Room { room: room.view() })
                        .into_iter()
                        .map(|(p, m)| (vec![p], m)),
                );
            } else if room.tick % 20 == 0 {
                output.extend(
                    room.broadcast(Update::Room { room: room.view() })
                        .into_iter()
                        .map(|(p, m)| (vec![p], m)),
                );
            }
        }
        let expired: Vec<_> = self
            .rooms
            .values()
            .filter(|r| {
                r.members.values().all(|p| !p.view.connected)
                    && (r.finished
                        || (!r.started && now - r.last_step > WAITING_ROOM_GRACE)
                        || r.unobserved_since
                            .is_some_and(|since| now - since >= r.round_seconds))
            })
            .map(|r| r.id)
            .collect();
        for id in expired {
            self.rooms.remove(&id);
            self.membership.retain(|_, room| *room != id);
        }
        output
    }
}

#[cfg(test)]
#[path = "frontline_air_domain_tests.rs"]
mod air_domain_tests;
#[cfg(test)]
#[path = "frontline_air_fuel_domain_tests.rs"]
mod air_fuel_domain_tests;
#[cfg(test)]
#[path = "frontline_air_mode_tests.rs"]
mod air_mode_tests;
#[cfg(test)]
#[path = "frontline_air_ground_ai_tests.rs"]
mod air_ground_ai_tests;
#[cfg(test)]
#[path = "frontline_air_era_policy_tests.rs"]
mod air_era_policy_tests;
#[cfg(test)]
#[path = "frontline_air_weapon_control_tests.rs"]
mod air_weapon_control_tests;
#[cfg(test)]
#[path = "frontline_air_tracer_tests.rs"]
mod air_tracer_tests;
#[cfg(test)]
#[path = "frontline_air_countermeasure_domain_tests.rs"]
mod air_countermeasure_domain_tests;
#[cfg(test)]
#[path = "frontline_air_point_tests.rs"]
mod air_point_tests;
#[cfg(test)]
#[path = "frontline_air_pose_tests.rs"]
mod air_pose_tests;
#[cfg(test)]
#[path = "frontline_air_service_domain_tests.rs"]
mod air_service_domain_tests;
#[cfg(test)]
#[path = "frontline_campaign_domain_tests.rs"]
mod campaign_domain_tests;
#[cfg(test)]
#[path = "frontline_domain_tests.rs"]
mod domain_tests;
#[cfg(test)]
#[path = "frontline_intel_domain_tests.rs"]
mod intel_domain_tests;
#[cfg(test)]
#[path = "frontline_map_domain_tests.rs"]
mod map_domain_tests;
#[cfg(test)]
#[path = "frontline_round_domain_tests.rs"]
mod round_domain_tests;
#[cfg(test)]
#[path = "frontline_support_domain_tests.rs"]
mod support_domain_tests;
#[cfg(test)]
#[path = "frontline_naval_domain_tests.rs"]
mod naval_domain_tests;

impl Room {
    #[allow(clippy::too_many_arguments)]
    fn new(
        id: u32,
        battle: u64,
        name: String,
        map: String,
        map_revision: String,
        era: u32,
        host: u32,
        observer: bool,
        sim: SimWorld,
        air: AirWorld,
        vehicles: Vec<VehicleOption>,
        data: &Value,
    ) -> Result<Self, String> {
        let active_staging: BTreeSet<_> = data["initialScene"]["stagingIds"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect();
        let full_scene = data["initialScene"]["objectiveIds"]
            .as_array()
            .is_some_and(|ids| ids.len() > 1);
        let mut staging = Vec::new();
        for stage in data["staging"]
            .as_array()
            .ok_or("Missing physical deployment sources")?
        {
            let id = stage["id"].as_str().ok_or("Deployment source has no ID")?;
            if stage["enabled"] != true || !active_staging.contains(id) {
                continue;
            }
            let team = match stage["team"].as_u64() {
                Some(0) => Team::Blue,
                Some(1) => Team::Red,
                _ => return Err("Invalid deployment team".into()),
            };
            let pos = point(&stage["pos"]).ok_or("Invalid deployment position")?;
            let radius = stage["radius"]
                .as_f64()
                .filter(|r| r.is_finite() && *r >= 20.0)
                .ok_or("Invalid deployment radius")?;
            let slots: Vec<_> = stage["spawnSlots"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|v| point(&v["pos"]))
                .collect();
            if slots.len() != 10 {
                return Err(
                    "Deployment source must provide ten explicit physical spawn slots".into(),
                );
            }
            if slots.iter().any(|s| distance(*s, pos) > radius) {
                return Err("Deployment slots exceed their accepted source".into());
            }
            let headings: Vec<_> = stage["spawnSlots"]
                .as_array()
                .unwrap()
                .iter()
                .map(|slot| {
                    slot["yawRad"]
                        .as_f64()
                        .filter(|v| v.is_finite())
                        .ok_or("Invalid deployment heading")
                })
                .collect::<Result<_, _>>()?;
            for (i, a) in slots.iter().enumerate() {
                if slots[i + 1..].iter().any(|b| distance(*a, *b) < 8.0) {
                    return Err("Deployment slots overlap".into());
                }
            }
            let road = stage["roadId"]
                .as_str()
                .or_else(|| {
                    (!full_scene)
                        .then(|| data["initialScene"]["roadId"].as_str())
                        .flatten()
                })
                .ok_or("Deployment source needs a registered roadId")?
                .to_owned();
            let objective = if full_scene {
                stage["objectiveId"].as_str().map(str::to_owned)
            } else {
                None
            };
            if full_scene && objective.is_none() {
                return Err("Multi-front source needs an objectiveId supply anchor".into());
            }
            let mut entry = stage["entryPoints"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|v| {
                    point(v)
                        .map(|p| [p[0], p[2]])
                        .ok_or("Invalid deployment entry point")
                })
                .collect::<Result<Vec<_>, _>>()?;
            if entry.is_empty() {
                entry.push([pos[0], pos[2]]);
            }
            if entry
                .iter()
                .any(|p| (p[0] - pos[0]).hypot(p[1] - pos[2]) > radius * 3.0)
            {
                return Err("Deployment entry exceeds the authored local access area".into());
            }
            // Reserved corners of the SAME authored cleared pad. Actual native
            // whole-hull and occupancy validation remains the admission gate.
            let mut support_slots = Vec::new();
            if let Some(pad) = data["terrain"]["pads"]
                .as_array()
                .and_then(|pads| pads.iter().find(|p| p["id"] == stage["padId"]))
            {
                if let (Some(cx), Some(cz), Some(hx), Some(hz)) = (
                    pad["center"][0].as_f64(),
                    pad["center"][1].as_f64(),
                    pad["halfSize"][0].as_f64(),
                    pad["halfSize"][1].as_f64(),
                ) {
                    for (sx, sz) in [(-1.0, -1.0), (1.0, 1.0), (-1.0, 1.0), (1.0, -1.0)] {
                        let x = cx + sx * (hx - 12.0).max(0.0);
                        let z = cz + sz * (hz - 17.0).max(0.0);
                        if (x - pos[0]).hypot(z - pos[2]) <= radius {
                            support_slots.push(([x, sim.height(x, z), z], headings[0]));
                        }
                    }
                }
            }
            staging.push(Staging {
                id: id.into(),
                team,
                front: stage["lane"].as_str().unwrap_or("centre").into(),
                objective,
                road,
                pos,
                radius,
                slots,
                headings,
                entry,
                support_slots,
            });
        }
        if [Team::Blue, Team::Red]
            .iter()
            .any(|team| !staging.iter().any(|s| s.team == *team))
        {
            return Err("Both teams need physical deployment sources".into());
        }
        if staging.iter().map(|s| &s.id).collect::<BTreeSet<_>>().len() != staging.len() {
            return Err("Duplicate deployment source".into());
        }
        let active_objectives = data["initialScene"]["objectiveIds"]
            .as_array()
            .ok_or("Missing initial objective IDs")?;
        let mut objectives = data["objectives"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|o| active_objectives.iter().any(|id| id == &o["id"]))
            .filter_map(|o| {
                Some(ObjectiveView {
                    id: o["id"].as_str()?.into(),
                    name: o["name"].as_str().unwrap_or("Frontline objective").into(),
                    pos: point(&o["pos"])?,
                    radius: o["radius"].as_f64().filter(|r| r.is_finite() && *r > 0.0)?,
                    owner: match o["owner"].as_u64() {
                        Some(0) => Some(Team::Blue),
                        Some(1) => Some(Team::Red),
                        _ => None,
                    },
                    progress: match o["owner"].as_u64() {
                        Some(0) => 1.0,
                        Some(1) => -1.0,
                        _ => 0.0,
                    },
                    lane: o["lane"].as_str().unwrap_or("centre").into(),
                    capturable: [false; 2],
                    supplied: [false; 2],
                    contested: false,
                    presence: [0; 2],
                    presence_visible: [true; 2],
                })
            })
            .collect::<Vec<_>>();
        if objectives.is_empty() {
            return Err("Frontline map has no accepted objective".into());
        }
        let mut campaign = Campaign::load(data, &mut objectives)?;
        campaign.set_air_frontline(&mut objectives, true);
        for source in &staging {
            if campaign.route_front(&source.road) != Some(source.front.as_str()) {
                return Err(format!(
                    "Deployment {} has no enabled same-front route",
                    source.id
                ));
            }
            let last = *source.entry.last().unwrap();
            if campaign
                .plan_route([last[0], source.pos[1], last[1]], last, Some(&source.road))
                .is_none()
            {
                return Err(format!(
                    "Deployment {} entry misses its registered road",
                    source.id
                ));
            }
            if source.objective.as_ref().is_some_and(|id| {
                !objectives.iter().any(|o| {
                    o.id == *id
                        && o.lane == source.front
                        && o.owner == Some(source.team)
                        && o.supplied[source.team.index()]
                })
            }) {
                return Err(format!(
                    "Deployment {} is not anchored to friendly supply",
                    source.id
                ));
            }
        }
        let ai_staging: Vec<_> = data["initialScene"]["aiStagingIds"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
        let ai_staging = if ai_staging.is_empty() {
            staging.iter().map(|s| s.id.clone()).collect()
        } else {
            ai_staging
        };
        if ai_staging
            .iter()
            .any(|id| !staging.iter().any(|s| s.id == *id))
            || ai_staging.iter().collect::<BTreeSet<_>>().len() != ai_staging.len()
        {
            return Err("Invalid initial AI deployment sources".into());
        }
        let b = &data["bounds"];
        let bounds = [
            b["minX"].as_f64(),
            b["maxX"].as_f64(),
            b["minZ"].as_f64(),
            b["maxZ"].as_f64(),
        ]
        .map(|v| v.unwrap_or(f64::NAN));
        if !bounds.iter().all(|v| v.is_finite()) || bounds[0] >= bounds[1] || bounds[2] >= bounds[3]
        {
            return Err("Invalid map bounds".into());
        }
        let road_id = if full_scene {
            staging[0].road.as_str()
        } else {
            data["initialScene"]["roadId"]
                .as_str()
                .unwrap_or(&staging[0].road)
        };
        let road = data["roads"]
            .as_array()
            .and_then(|roads| {
                roads.iter().find(|r| {
                    r["id"].as_str() == Some(road_id) && r["navEnabled"].as_bool() == Some(true)
                })
            })
            .ok_or("Initial road is not enabled for native navigation")?;
        let route: Vec<_> = road["points"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(point)
            .map(|p| [p[0], p[2]])
            .collect();
        if route.len() < 2 {
            return Err("Initial road has no usable physical path".into());
        }
        let timing = sim.timings().is_some().then(RoomTimings::default);
        let mut geometry = sim.facility_geometry_catalog();
        geometry.sort_by(|a, b| a.facility_id.cmp(&b.facility_id));
        let mut layout = Vec::new();
        for item in &geometry {
            layout.extend_from_slice(item.facility_id.as_bytes());
            layout.push(0);
            layout.extend_from_slice(item.geometry_hash.as_bytes());
            layout.push(0);
        }
        let facility_layout_hash = tg_combat::geometry::manifest::sha256(&layout);
        let facility_catalog = geometry
            .into_iter()
            .map(|g| serde_json::to_value(g).expect("finite native facility geometry"))
            .collect();
        Ok(Self {
            player_ground_allowed: false,
            scores: BTreeMap::new(),
            damage_credit: BTreeMap::new(),
            settled_losses: BTreeSet::new(),
            scored_contacts: BTreeSet::new(),
            ground_hit_points: BTreeMap::new(),
            team_score: [0; 2],
            zone_seconds: [0.0; 2],
            id,
            name: name.chars().filter(|c| !c.is_control()).take(48).collect(),
            map,
            map_revision,
            era,
            host,
            battle,
            started: false,
            members: BTreeMap::from([(
                host,
                Participant {
                    view: MemberView {
                        player: host,
                        name: format!("玩家{host}"),
                        team: Team::Blue,
                        observer,
                        connected: true,
                        company: None,
                        controlled: None,
                        epoch: 1,
                        air_sorties_remaining: u8::from(!observer),
                        air_sortie_eligible: !observer,
                    },
                    gate: Gate::Initial,
                    resume_unit: None,
                    air_sortie_used: false,
                },
            )]),
            companies: BTreeMap::new(),
            departed: BTreeMap::new(),
            units: BTreeMap::new(),
            sim,
            air,
            scenario: crate::frontline_scenario::ScenarioState::for_map(data)?,
            naval_public: Default::default(),
            perception: PerceptionWorld::new(battle, PerceptionConfig::default())?,
            perception_events: Default::default(),
            perception_error: None,
            vehicles,
            staging,
            ai_staging,
            pending_support: Vec::new(),
            support_retry: 0.0,
            facility_catalog,
            facility_layout_hash,
            route,
            objectives,
            campaign,
            readiness: [1000; 2],
            started_at: 0.0,
            last_step: 0.0,
            tick: 0,
            bounds,
            finished: false,
            round_number: 1,
            round_seconds: ROUND_SECONDS,
            intermission_seconds: INTERMISSION_SECONDS,
            restart_at: None,
            next_round_s: None,
            result: None,
            unobserved_since: None,
            timing,
        })
    }
    fn start_round(
        &mut self,
        next_company: &mut u64,
        next_unit: &mut u64,
        now: f64,
    ) -> Result<(), Update> {
        if let Some(scenario)=&self.scenario {
            self.sim.install_naval(&scenario.config.naval,next_unit).map_err(|e|failure("naval_spawn_failed",e))?;
            self.started=true;self.started_at=now;self.last_step=now;
            self.round_seconds=scenario.config.timeout_seconds;
            return Ok(());
        }
        let vehicle = self
            .vehicles
            .iter()
            .find(|v| v.id == "su_t72a")
            .or_else(|| self.vehicles.first())
            .unwrap()
            .id
            .clone();
        let before: BTreeSet<_> = self.companies.keys().copied().collect();
        for staging in self.ai_staging.clone() {
            let team = self
                .staging
                .iter()
                .find(|s| s.id == staging)
                .expect("validated AI source")
                .team;
            if let Err(error) = self.spawn_company(
                None,
                team,
                &vehicle,
                true,
                Some(&staging),
                next_company,
                next_unit,
                now,
            ) {
                let rollback: Vec<_> = self
                    .companies
                    .keys()
                    .copied()
                    .filter(|c| !before.contains(c))
                    .collect();
                for c in rollback {
                    self.remove_company(c);
                }
                return Err(failure("spawn_failed", error));
            }
        }
        self.started = true;
        self.started_at = now;
        self.last_step = now;
        // AirFrontline keeps autonomous ground attackers only. The unexposed
        // legacy combined-mode fixture retains its original aircraft opponents.
        if self.player_ground_allowed {
            let mut options = self.air.options(self.era);
            if let Some(newest) = options.iter().map(|a| a.year).max() {
                let earliest = self.era.saturating_sub(25).min(newest);
                options.retain(|a| a.year >= earliest);
            }
            if let Some(option) = options
                .iter()
                .find(|a| a.id == "su25")
                .or_else(|| options.iter().find(|a| a.id == "f86f"))
                .or(options.first())
            {
                for team in [Team::Blue, Team::Red] {
                    let reference = UnitRef {
                        battle: self.battle,
                        unit: *next_unit,
                        life: 1,
                    };
                    if let Err(e) = self.air.spawn(reference, &option.id, team, None, "air", 0) {
                        self.started = false;
                        for c in self.companies.keys().copied().collect::<Vec<_>>() {
                            self.remove_company(c);
                        }
                        self.air.units.clear();
                        return Err(failure("air_spawn_failed", e));
                    }
                    *next_unit += 1;
                }
            }
        }
        self.queue_front_support();
        self.spawn_pending_support(next_unit);
        Ok(())
    }
    fn player_count(&self, team: Team) -> usize {
        self.members
            .values()
            .filter(|p| !p.view.observer && p.view.team == team)
            .count()
    }
    fn staging_views(&self) -> Vec<StagingView> {
        self.staging
            .iter()
            .map(|s| StagingView {
                id: s.id.clone(),
                team: s.team,
                front: s.front.clone(),
                objective: s.objective.clone(),
                road: s.road.clone(),
                pos: s.pos,
                radius: s.radius,
                available: self.staging_available(s),
            })
            .collect()
    }
    fn public_objectives(&self) -> Vec<ObjectiveView> {
        self.objectives
            .iter()
            .filter(|o| self.player_ground_allowed || matches!(o.id.as_str(), "W2" | "C2" | "E2"))
            .map(|o| {
                let mut public = o.clone();
                if !self.player_ground_allowed {
                    public.name = match o.id.as_str() { "W2" => "A", "C2" => "B", "E2" => "C", _ => &o.name }.into();
                }
                public
            })
            .collect()
    }
    fn scoreboard(&self) -> Vec<PlayerScore> {
        let mut scores = self.scores.clone();
        for p in self.members.values().chain(self.departed.values()) {
            if !p.view.observer {
                scores.entry(p.view.player).or_insert_with(|| PlayerScore {
                    player: p.view.player,
                    name: p.view.name.clone(),
                    ..Default::default()
                });
            }
        }
        let mut list: Vec<_> = scores.into_values().collect();
        list.sort_by(|a, b| b.score.cmp(&a.score).then_with(|| a.player.cmp(&b.player)));
        list
    }
    fn score_mut(&mut self, player: u32) -> &mut PlayerScore {
        let name = self
            .members
            .get(&player)
            .or_else(|| self.departed.get(&player))
            .map(|p| p.view.name.clone())
            .unwrap_or_else(|| format!("玩家{player}"));
        self.scores.entry(player).or_insert(PlayerScore {
            player,
            name,
            ..Default::default()
        })
    }
    fn award_points(&mut self, player: u32, team: Team, victim: UnitRef, points: u32, reason: &str, events: &mut Vec<Value>) {
        self.team_score[team.index()] = self.team_score[team.index()].saturating_add(points);
        let team_score = self.team_score;
        let score = self.score_mut(player);
        score.score = score.score.saturating_add(points);
        events.push(json!({"kind":"player_score","player":player,"victim":victim,"reason":reason,"points":points,"totals":score,"team_score":team_score}));
    }
    fn record_damage(&mut self, native: &[crate::frontline_sim::SimEvent], events: &mut Vec<Value>) {
        if self.player_ground_allowed { return; }
        for event in native {
            let changed = event.detail["damage_changed"] == true
                || event.detail["report"]["damage_changed"] == true;
            let suppressed = event.detail["damage_applied"] == false
                || event.detail["report"]["damage_applied"] == false;
            if !changed || suppressed { continue; }
            let (Some(shooter), Some(target), Some(shot)) =
                (event.shooter, event.target, event.detail["shot_id"].as_u64()) else { continue; };
            if shooter == target { continue; }
            let victim = self.units.get(&target)
                .filter(|u| u.support.is_none())
                .map(|u| (u.reference, u.team, false, self.sim.unit_alive(target)))
                .or_else(|| self.air.units.get(&target).map(|u| (u.reference, u.team, true, u.alive())));
            let Some((reference, target_team, airborne, alive)) = victim else { continue; };
            let attacker = self.air.units.get(&shooter).map(|u| (u.team, u.owner))
                .or_else(|| self.units.get(&shooter).map(|u| (u.team, None)));
            let Some((team, player)) = attacker else { continue; };
            if team == target_team || self.settled_losses.contains(&reference)
                || !self.scored_contacts.insert((shot, reference)) { continue; }
            // Only the last accepted enemy damaging source can own a later loss.
            // AI finishing a previously damaged target cannot mint a human kill.
            let Some(player) = player else {
                self.damage_credit.remove(&reference);
                continue;
            };
            self.damage_credit.insert(reference, DamageCredit { player, team, at: self.sim.time() });
            // Inspect the accepted end-of-step life, not the contact's hypothetical
            // report: a lethal multi-contact batch earns its kill without extra hits.
            if !airborne && alive {
                let used = self.ground_hit_points.entry(reference).or_default();
                let points = 5.min(25u32.saturating_sub(*used));
                *used += points;
                if points > 0 { self.award_points(player, team, reference, points, "ground_hit", events); }
            }
        }
    }
    fn settle_loss(&mut self, victim: UnitRef, owner: Option<u32>, airborne: bool, events: &mut Vec<Value>) {
        if !airborne && self.units.get(&victim.unit)
            .is_some_and(|u| u.reference == victim && u.support.is_some()) {
            self.damage_credit.remove(&victim);
            return;
        }
        if self.player_ground_allowed || !self.settled_losses.insert(victim) { return; }
        if let Some(player) = owner {
            let score = self.score_mut(player);
            score.deaths = score.deaths.saturating_add(1);
            events.push(json!({"kind":"player_score","player":player,"reason":"death","points":0,"totals":score}));
        }
        if let Some(credit) = self.damage_credit.remove(&victim)
            .filter(|c| (0.0..=60.0).contains(&(self.sim.time() - c.at))) {
            let score = self.score_mut(credit.player);
            if airborne { score.air_kills = score.air_kills.saturating_add(1); }
            else { score.ground_kills = score.ground_kills.saturating_add(1); }
            self.award_points(credit.player, credit.team, victim, if airborne {300} else {100},
                if airborne {"air_kill"} else {"ground_kill"}, events);
        }
    }
    fn score_zones(&mut self, events: &mut Vec<Value>) {
        if self.player_ground_allowed { return; }
        for zone in self.objectives.iter().filter(|o| matches!(o.id.as_str(), "W2" | "C2" | "E2") && !o.contested) {
            if let Some(team) = zone.owner { self.zone_seconds[team.index()] += STEP; }
        }
        let previous = self.team_score;
        for side in 0..2 {
            let points = (self.zone_seconds[side] + 1e-9).floor() as u32;
            self.zone_seconds[side] -= f64::from(points);
            self.team_score[side] = self.team_score[side].saturating_add(points);
        }
        if previous != self.team_score {
            events.push(json!({"kind":"team_score","team_score":self.team_score,"score_limit":AIR_SCORE_LIMIT,"reason":"zone_control"}));
        }
    }
    fn air_round_outcome(&self) -> Option<(Option<Team>, &'static str)> {
        // Only player air lives count here. Owned aircraft remain lives while
        // disconnected, returned or in service; an unused first sortie also
        // establishes that player's team without creating an aircraft actor.
        let mut established = [false; 2];
        let mut surviving = [false; 2];
        for aircraft in self.air.units.values().filter(|u| u.owner.is_some()) {
            established[aircraft.team.index()] = true;
            surviving[aircraft.team.index()] |= aircraft.alive();
        }
        for participant in self.members.values() {
            if !participant.view.observer {
                established[participant.view.team.index()] = true;
                if !participant.air_sortie_used {
                    surviving[participant.view.team.index()] = true;
                }
            }
        }
        if established == [true, true] {
            match surviving {
                [true, false] => return Some((Some(Team::Blue), "air_elimination")),
                [false, true] => return Some((Some(Team::Red), "air_elimination")),
                [false, false] => return Some((None, "air_elimination")),
                _ => {}
            }
        }
        if self.team_score.iter().any(|score| *score >= AIR_SCORE_LIMIT)
            || self.sim.time() >= self.round_seconds {
            let winner = match self.team_score[0].cmp(&self.team_score[1]) {
                std::cmp::Ordering::Greater => Some(Team::Blue),
                std::cmp::Ordering::Less => Some(Team::Red),
                std::cmp::Ordering::Equal => None,
            };
            return Some((winner, if self.sim.time() >= self.round_seconds {"time"} else {"score_limit"}));
        }
        None
    }
    fn view(&self) -> RoomView {
        RoomView {
            id: self.id,
            name: self.name.clone(),
            map: self.map.clone(),
            map_revision: self.map_revision.clone(),
            era: self.era,
            host: self.host,
            battle: self.battle,
            started: self.started,
            battle_mode:if self.player_ground_allowed{"combined_frontline"}else{"air_frontline"},
            player_ground_allowed:self.player_ground_allowed,
            scoreboard:self.scoreboard(),
            team_score:self.team_score,
            score_limit:AIR_SCORE_LIMIT,
            round_number: self.round_number,
            round_state: if self.finished {"intermission"}else if self.started{"battle"}else{"waiting"}.into(),
            round_elapsed_s: self.sim.time(),
            next_round_s: self.next_round_s,
            result: self.result.clone(),
            intelligence_version: 1,
            facility_layout_version: 1,
            facility_layout_hash: self.facility_layout_hash.clone(),
            support_deployments: self.pending_support.iter().map(|s|json!({"source":s.source,"team":s.team,"role":s.role,"status":"queued","reason":"no_clear_registered_spawn"})).collect(),
            members: self.members.values().map(|p| {
                let mut view = p.view.clone();
                view.air_sorties_remaining = u8::from(!view.observer && !p.air_sortie_used);
                view.air_sortie_eligible = !view.observer && (!p.air_sortie_used
                    || self.air.units.values().any(|u| u.owner == Some(view.player) && u.alive()));
                view
            }).collect(),
            readiness: self.readiness,
            staging: self.staging_views(),
        }
    }
    fn company_views(&self) -> Vec<CompanyView> {
        self.companies
            .values()
            .map(|c| {
                let mut view = c.view.clone();
                let alive = c
                    .view
                    .units
                    .iter()
                    .filter(|r| self.sim.unit_alive(r.unit))
                    .count();
                let incoming = c
                    .view
                    .units
                    .iter()
                    .filter(|r| {
                        self.sim.unit_alive(r.unit)
                            && self.units.get(&r.unit).is_some_and(|u| u.reinforcing)
                    })
                    .count();
                view.reinforcement.pending = (10usize.saturating_sub(alive)) as u8;
                view.reinforcement.incoming = incoming as u8;
                view.reinforcement.next_batch_s = (c.reinforcement_next - self.sim.time()).max(0.0);
                view.reinforcement.status = if alive == 10 && incoming == 0 {
                    "full".into()
                } else if alive == 10 {
                    "waiting".into()
                } else {
                    c.reinforcement_status.clone()
                };
                view
            })
            .collect()
    }
    fn unit_views(&self) -> Vec<UnitView> {
        self.units
            .values()
            .filter_map(|u| {
                let s = self.sim.snapshot(u.reference.unit)?;
                Some(UnitView {
                    unit: u.reference,
                    vehicle: s.vehicle.clone(),
                    team: u.team,
                    role: u.support.as_ref().map(|s|s.role.as_str()).unwrap_or("combat").into(),
                    campaign_conversion: u.support.as_ref().map(|a|json!({"kind":"campaign_support_conversion","role":a.role,"chassis":s.vehicle,"prototype":true,"mass_basis":"registered_chassis"})),
                    support_task: u.support.as_ref().and_then(|a|a.task.as_ref()).map(|t|json!({"kind":t.kind,"facility_id":t.facility_id,"expected_revision":t.expected_revision,"status":t.status,"reason":t.reason,"job_id":t.job_id})),
                    support_order_seq: if u.support.is_some(){u.last_seq}else{0},
                    company: u.company,
                    platoon: u.platoon,
                    controller: u.controller,
                    epoch: u.epoch,
                    alive: s.alive,
                    pos: s.pos,
                    yaw: s.heading,
                    turret_yaw: s.turret_yaw,
                    gun_pitch: s.gun_pitch,
                    ammo: s.ammo,
                    ammo_revision: s.ammo_revision,
                    damage: s.damage.clone(),
                    caps: s.caps.clone(),
                    net: s.net.clone(),
                    navigation: u.navigation.as_ref().map(|p|json!({"front":p.front,"routes":p.roads,"target":p.target,"waypoint":p.points[p.current_index()],"index":p.current_index(),"total":p.points.len()})).unwrap_or(Value::Null),
                    reinforcing: u.reinforcing,
                })
            })
            .collect()
    }
    fn scenario_status(&self)->Option<Value> {
        self.scenario.as_ref().map(|s|s.status(&self.sim.naval_views()))
    }
    fn vessel_views_for(&self, team:Option<Team>)->Vec<Value> {
        let mut ships=self.sim.naval_views();
        if let Some(scenario)=&self.scenario {scenario.decorate(&mut ships);}
        let mut values:Vec<_>=ships.into_iter().filter(|s|team.is_none_or(|t|s.team==t.index() as u8))
            .map(|s|serde_json::to_value(s).expect("finite accepted naval view")).collect();
        if let Some(team)=team {values.extend(self.naval_public[team.index()].iter().cloned());}
        values
    }
    fn update_naval_public(&mut self) {
        if !self.perception.frame().is_some_and(|f|f.scanned) {return;}
        let ships=self.sim.naval_views();
        for side in 0..2 {
            let mut observers:Vec<_>=self.air.combat_targets().into_iter().filter(|s|s.alive&&s.team==side as u8).map(|s|(s.unit.unit,s.pos)).collect();
            observers.extend(self.sim.kinematics().into_iter().filter(|s|s.alive&&s.team==side as u8).map(|s|(s.id,[s.pos[0],s.pos[1]+2.2,s.pos[2]])));
            observers.extend(ships.iter().filter(|s|s.alive&&s.team==side as u8).map(|s|(s.unit.unit,[s.pos[0],s.pos[1]+3.,s.pos[2]])));
            self.naval_public[side]=ships.iter().filter(|s|s.team!=side as u8&&observers.iter().any(|(id,p)|{
                let target=[s.pos[0],s.pos[1]+2.,s.pos[2]];
                distance(*p,target)<=12000.&&self.sim.perception_los(*id,s.unit.unit,*p,target)
            })).map(|s|{
                let mut value=serde_json::to_value(s).expect("finite naval public pose");
                if let Some(o)=value.as_object_mut(){for key in ["health","max_health","ammo","ammo_revision","unloading_s"]{o.remove(key);}}
                value
            }).collect();
        }
    }
    fn snapshot(&self) -> Update {
        Update::Snapshot {
            room: self.view(),
            units: self.unit_views(),
            companies: self.company_views(),
            vehicles: self.vehicles.clone(),
            objectives: self.public_objectives(),
            aircraft_options: self.air.options(self.era),
            aircrafts: self.air.views(),
            missiles:self.sim.guided_ordnance_views(),
            tracers:self.sim.air_gun_tracer_views(),
            facilities: self.facility_views_for(None),
            facility_jobs: self.facility_jobs_for(None),
            facility_geometry_catalog: self.facility_catalog.clone(),
            vessels: self.vessel_views_for(None),
            naval_geometry_catalog: self.sim.naval_geometry_catalog(),
            scenario: self.scenario_status(),
            intel: None,
        }
    }
    fn sanitize_room_for(&self, player: u32, view: &mut RoomView) {
        let member = self.members.get(&player);
        if member.is_some_and(|p| p.view.observer) {
            return;
        }
        let team = member.map(|p| p.view.team);
        view.staging.retain(|s| Some(s.team) == team);
        view.support_deployments
            .retain(|s| team.is_some_and(|t| s["team"] == json!(t)));
        for other in &mut view.members {
            if Some(other.team) != team && other.player != player {
                other.controlled = None;
                other.company = None;
                other.epoch = 0;
            }
        }
    }
    fn missile_views_for(&self,team:Team)->Vec<crate::frontline_air::guided::View>{
        let mut observers:Vec<_>=self.air.combat_targets().into_iter().filter(|t|t.alive&&t.team==team.index() as u8).map(|t|(t.unit.unit,t.pos)).collect();
        observers.extend(self.sim.kinematics().into_iter().filter(|t|t.alive&&t.team==team.index() as u8).map(|t|(t.id,t.pos)));
        self.sim.guided_ordnance_views().into_iter().filter(|m|m.team==team.index() as u8||observers.iter().any(|(id,p)|{
            let distance=p.iter().zip(m.pos).map(|(a,b)|(a-b).powi(2)).sum::<f64>().sqrt();
            distance<12000.0&&self.sim.perception_los(*id,0,*p,m.pos)
        })).collect()
    }
    fn tracer_views_for(&self,team:Team)->Vec<crate::frontline_sim::AirGunTracerView>{
        let mut observers:Vec<_>=self.air.combat_targets().into_iter().filter(|t|t.alive&&t.team==team.index() as u8).map(|t|(t.unit.unit,t.pos)).collect();
        observers.extend(self.sim.kinematics().into_iter().filter(|t|t.alive&&t.team==team.index() as u8).map(|t|(t.id,t.pos)));
        // Current-point visibility applies to both teams. A friendly muzzle
        // event does not grant visibility through later terrain/facilities.
        self.sim.air_gun_tracer_views().into_iter().filter(|trace|observers.iter().any(|(id,p)|{
            let distance=p.iter().zip(trace.pos).map(|(a,b)|(a-b).powi(2)).sum::<f64>().sqrt();
            distance<12000.0&&self.sim.perception_los(*id,0,*p,trace.pos)
        })).collect()
    }
    fn facility_views_for(&self, team: Option<Team>) -> Vec<Value> {
        self.sim
            .facility_views()
            .into_iter()
            .map(|f| {
                if team.is_none() || f.team == team.map(|t| t.index() as u8) {
                    serde_json::to_value(f).expect("finite native facility state")
                } else {
                    // Geography and global physical bridge/strip damage are public
                    // infrastructure rules. HP, stores, supply and enemy work are not.
                    let mut public = json!({"facility_id":f.facility_id,"team":f.team,"kind":f.kind,
                    "source_id":f.source_id,"airfield":f.airfield,"road_ids":f.road_ids,
                    "geometry_hash":f.geometry_hash,"geometry_revision":f.geometry_revision,
                    "damage_state":f.damage_state,
                    "capabilities":{"geometry_active":f.capabilities.geometry_active,
                        "passable":f.capabilities.passable,"landable":f.capabilities.landable}});
                    // Neutral bridge repair needs an opaque CAS token; foreign
                    // facility HP/job revision changes are not a public feed.
                    if f.team.is_none() {
                        public["revision"] = json!(f.revision);
                    }
                    public
                }
            })
            .collect()
    }
    fn facility_jobs_for(&self, team: Option<Team>) -> Vec<Value> {
        self.sim
            .facility_job_views()
            .into_iter()
            .filter(|j| team.is_none_or(|t| j.team == t.index() as u8))
            .map(|j| serde_json::to_value(j).expect("finite native facility job"))
            .collect()
    }
    fn team_intel(&self, team: Team) -> TeamPerceptionView {
        let mut view = if self.perception_error.is_none() {
            self.perception
                .frame()
                .filter(|f| f.tick == self.tick)
                .map(|f| f.team(team).clone())
                .unwrap_or_else(|| TeamPerceptionView::empty(team))
        } else {
            TeamPerceptionView::empty(team)
        };
        // Deploy/rejoin commands can occur between accepted simulation ticks.
        // Friendly identity updates never require (or trigger) an enemy scan.
        view.friendlies = self
            .units
            .values()
            .filter(|u| u.team == team)
            .map(|u| u.reference)
            .chain(
                self.air
                    .units
                    .values()
                    .filter(|u| u.team == team)
                    .map(|u| u.reference),
            )
            .collect();
        view.friendlies.sort();
        view.friendlies.extend(self.sim.naval_views().into_iter().filter(|s|s.team==team.index() as u8).map(|s|s.unit));
        for ship in &self.naval_public[team.index()] {
            if let Ok(id)=serde_json::from_value::<UnitRef>(ship["unit"].clone()) {view.visible_enemies.push(id);}
        }
        view.friendlies.sort();view.visible_enemies.sort();view.visible_enemies.dedup();
        view
    }
    fn command_update_for(&self, player: u32, mut message: Update) -> Option<Update> {
        let member = self.members.get(&player)?;
        if member.view.observer {
            return Some(message);
        }
        let team = member.view.team;
        match &mut message {
            Update::Snapshot {
                room,
                units,
                companies,
                aircrafts,
                vessels,
                missiles,
                tracers,
                objectives,
                facilities,
                facility_jobs,
                intel,
                ..
            } => {
                self.sanitize_room_for(player, room);
                units.retain(|u| u.team == team);
                companies.retain(|c| c.team == team);
                aircrafts.retain(|u| u.team == team);
                *vessels=self.vessel_views_for(Some(team));
                *missiles=self.missile_views_for(team);
                *tracers=self.tracer_views_for(team);
                for objective in objectives {
                    objective.presence_visible[1 - team.index()] = false;
                }
                *intel = Some(self.team_intel(team));
                *facilities = self.facility_views_for(Some(team));
                *facility_jobs = self.facility_jobs_for(Some(team));
            }
            Update::Room { room } => self.sanitize_room_for(player, room),
            Update::OrderAccepted { company, .. } => {
                if !self
                    .companies
                    .get(company)
                    .is_some_and(|c| c.view.team == team)
                {
                    return None;
                }
            }
            _ => {}
        }
        Some(message)
    }
    fn frame_for(&self, team: Option<Team>, mut frame: Update) -> Update {
        let Some(team) = team else {
            return frame;
        };
        if let Update::Frame {
            units,
            companies,
            aircrafts,
            vessels,
            missiles,
            tracers,
            staging,
            events,
            objectives,
            facilities,
            facility_jobs,
            intel,
            ..
        } = &mut frame
        {
            units.retain(|u| u.team == team);
            companies.retain(|c| c.team == team);
            aircrafts.retain(|u| u.team == team);
            *vessels=self.vessel_views_for(Some(team));
            *missiles=self.missile_views_for(team);
            *tracers=self.tracer_views_for(team);
            staging.retain(|s| s.team == team);
            for objective in objectives {
                objective.presence_visible[1 - team.index()] = false;
            }
            *events = self.perception_events[team.index()].clone();
            *intel = Some(self.team_intel(team));
            *facilities = self.facility_views_for(Some(team));
            *facility_jobs = self.facility_jobs_for(Some(team));
        }
        frame
    }
    fn update_perception(
        &mut self,
        units: &[UnitView],
        aircrafts: &[AirUnitView],
        events: &[Value],
    ) {
        let actors: Vec<_> = units
            .iter()
            .map(PerceptionActor::ground)
            .chain(aircrafts.iter().map(PerceptionActor::air))
            .collect();
        let result = (|| -> Result<(), String> {
            let sim = &self.sim;
            let frame = self
                .perception
                .advance(self.tick, sim.time(), &actors, |a, b| {
                    perception_los(sim, a, b)
                })?;
            if frame.scanned {
                // Project only the actual scan's visible enemies. The full
                // private views are never stored in a public perception cache.
                let wanted: BTreeSet<_> = frame
                    .teams
                    .iter()
                    .flat_map(|t| t.visible_enemies.iter().copied())
                    .collect();
                let ground = units
                    .iter()
                    .filter(|u| wanted.contains(&u.unit))
                    .map(crate::frontline_perception::project_ground)
                    .collect::<Result<Vec<_>, _>>()?;
                let air = aircrafts
                    .iter()
                    .filter(|u| wanted.contains(&u.unit))
                    .map(|u| {
                        crate::frontline_perception::project_air_with_store_lengths(u, |id| {
                            self.air.store_len(id)
                        })
                    })
                    .collect::<Result<Vec<_>, _>>()?;
                self.perception
                    .cache_public_poses(self.tick, &ground, &air)?;
            }
            Ok(())
        })();
        if let Err(error) = result {
            if self.perception_error.as_ref() != Some(&error) {
                eprintln!("frontline perception {}: {}", self.id, error);
            }
            self.perception_error = Some(error);
            self.perception_events = Default::default();
            self.naval_public = Default::default();
            return;
        }
        self.perception_error = None;
        self.update_naval_public();
        self.perception_events = Default::default();
        for event in events {
            let kind = event["kind"].as_str().unwrap_or("");
            if event["detail"]["naval"]==true {
                let ships=self.sim.naval_views();
                for team in [Team::Blue,Team::Red] {
                    let ship_ids=self.vessel_views_for(Some(team));
                    let visible=|unit:&Value|unit.is_null()||ship_ids.iter().any(|s|s["unit"]==*unit)
                        || self.air.units.values().any(|u|u.team==team&&json!(u.reference)==*unit);
                    let own=|unit:&Value|ships.iter().any(|s|s.team==team.index() as u8&&json!(s.unit)==*unit);
                    let witnessed=point(&event["pos"]).is_some_and(|p|{
                        let mut eyes:Vec<_>=self.air.combat_targets().into_iter().filter(|s|s.alive&&s.team==team.index() as u8).map(|s|(s.unit.unit,s.pos)).collect();
                        eyes.extend(ships.iter().filter(|s|s.alive&&s.team==team.index() as u8).map(|s|(s.unit.unit,[s.pos[0],s.pos[1]+3.,s.pos[2]])));
                        let target=event["target"]["unit"].as_u64().unwrap_or(0);
                        eyes.into_iter().any(|(id,eye)|distance(eye,p)<=12000.&&self.sim.perception_los(id,target,eye,p))
                    });
                    if if kind=="shot" {own(&event["shooter"])||visible(&event["shooter"])}else{own(&event["target"])||witnessed} {
                        let detail:serde_json::Map<_,_>=["shot_id","projectile_id","caliber_mm","velocity","naval","world_bursts"].iter()
                            .filter_map(|k|event["detail"].get(*k).map(|v|((*k).to_owned(),v.clone()))).collect();
                        self.perception_events[team.index()].push(json!({"kind":kind,"shooter":if visible(&event["shooter"]){event["shooter"].clone()}else{Value::Null},
                            "target":if visible(&event["target"]){event["target"].clone()}else{Value::Null},"pos":event["pos"],"detail":detail}));
                    }
                }
                continue;
            }
            if matches!(kind, "player_score" | "team_score") {
                for side in &mut self.perception_events {
                    side.push(event.clone());
                }
                continue;
            }
            if matches!(
                kind,
                "shot"
                    | "impact"
                    | "facility_impact"
                    | "terrain_impact"
                    | "explosion"
                    | "destroyed"
            ) {
                let air_target = event["target"]["unit"]
                    .as_u64()
                    .is_some_and(|id| self.air.reference(id).is_some());
                let air_shot =
                    kind == "shot" && event["detail"]["airborne"].as_bool() == Some(true);
                let hint = if air_target || air_shot {
                    ActorKind::Air
                } else {
                    ActorKind::Ground
                };
                if let Ok(Some(candidate)) = EventCandidate::from_native(self.tick, hint, event) {
                    if let Ok(projected) = self
                        .perception
                        .project_event(&candidate, |a, b| perception_los(&self.sim, a, b))
                    {
                        for (index, public) in projected.into_iter().enumerate() {
                            if let Some(public) = public {
                                self.perception_events[index]
                                    .push(serde_json::to_value(public).unwrap_or(Value::Null));
                            }
                        }
                    }
                }
                // A malformed spatial event cannot fall through to a raw
                // company announcement and disclose a native combat report.
                continue;
            }
            // Strategic point announcements are common game rules. Company
            // activity/loss messages are private to that company's team.
            let public_objective = matches!(kind, "frontline_pressure" | "objective_owner_changed");
            for team in [Team::Blue, Team::Red] {
                if kind == "air_service_complete"
                    && event["target"]["unit"]
                        .as_u64()
                        .and_then(|id| self.air.units.get(&id))
                        .is_some_and(|u| u.team == team)
                {
                    let keys = [
                        "unit",
                        "loadout",
                        "resource_revision",
                        "service_revision",
                        "service",
                    ];
                    let detail: serde_json::Map<_, _> = keys
                        .into_iter()
                        .filter_map(|key| {
                            event["detail"]
                                .get(key)
                                .map(|v| (key.to_owned(), v.clone()))
                        })
                        .collect();
                    self.perception_events[team.index()].push(json!({"kind":kind,"shooter":event["shooter"],"target":event["target"],"pos":event["pos"],"detail":detail}));
                }
                let own_company = matches!(kind, "reinforcement_batch" | "reinforcement_joined")
                    && event["company"]
                        .as_u64()
                        .and_then(|id| self.companies.get(&id))
                        .is_some_and(|c| c.view.team == team);
                let own_loss = kind == "unit_lost" && event["team"] == json!(team);
                if public_objective || own_company || own_loss {
                    let keys: &[&str] = match kind {
                        "frontline_pressure" => &["kind", "readiness_cost"],
                        "objective_owner_changed" => {
                            &["kind", "objective", "previous", "owner", "progress"]
                        }
                        "reinforcement_batch" => &[
                            "kind",
                            "company",
                            "team",
                            "source",
                            "accepted",
                            "next_batch_s",
                        ],
                        "reinforcement_joined" => &["kind", "company", "unit", "platoon", "pos"],
                        "unit_lost" => &["kind", "unit", "team", "readiness_cost"],
                        _ => &[],
                    };
                    let sanitized: serde_json::Map<_, _> = keys
                        .iter()
                        .filter_map(|key| {
                            event
                                .get(*key)
                                .map(|value| ((*key).to_owned(), value.clone()))
                        })
                        .collect();
                    self.perception_events[team.index()].push(Value::Object(sanitized));
                }
            }
        }
    }
    fn broadcast(&self, message: Update) -> Vec<(u32, Update)> {
        self.members
            .values()
            .filter(|p| p.view.connected)
            .filter_map(|p| {
                self.command_update_for(p.view.player, message.clone())
                    .map(|m| (p.view.player, m))
            })
            .collect()
    }
    fn control(&self, player: u32, reason: &str) -> Update {
        let p = &self.members[&player];
        Update::Control {
            unit: p.view.controlled,
            epoch: p.view.epoch,
            reason: reason.into(),
        }
    }
    fn in_bounds(&self, p: [f64; 2]) -> bool {
        p[0] >= self.bounds[0]
            && p[0] <= self.bounds[1]
            && p[1] >= self.bounds[2]
            && p[1] <= self.bounds[3]
    }
    fn valid_survivor(&self, player: u32, reference: UnitRef) -> bool {
        self.units.get(&reference.unit).is_some_and(|u| {
            u.reference == reference
                && u.controller.is_none()
                && self
                    .companies
                    .get(&u.company)
                    .is_some_and(|c| c.view.owner == Some(player))
        })
    }
    fn validate_air_control(
        &self,
        player: u32,
        reference: UnitRef,
        epoch: u64,
        seq: u64,
    ) -> Result<(), Update> {
        if !self.started {
            return Err(failure("not_started", "Start the frontline battle first"));
        }
        let participant = &self.members[&player];
        if participant.view.observer {
            return Err(failure("observer", "Observers cannot service aircraft"));
        }
        let u = self
            .air
            .units
            .get(&reference.unit)
            .ok_or_else(|| failure("unknown_unit", "Aircraft does not exist"))?;
        if u.reference != reference
            || u.controller != Some(player)
            || u.epoch != epoch
            || participant.view.controlled != Some(reference)
        {
            return Err(failure(
                "stale_control",
                "Aircraft life/control epoch is no longer owned",
            ));
        }
        if seq <= u.last_seq || seq > 9_007_199_254_740_991 {
            return Err(failure(
                "stale_input",
                "Aircraft action sequence must increase",
            ));
        }
        if !u.alive() {
            return Err(failure("destroyed", "The controlled aircraft was lost"));
        }
        Ok(())
    }
    fn release(&mut self, player: u32, now: f64) {
        self.air.release(player, now);
        if let Some(p) = self.members.get_mut(&player) {
            if let Some(unit) = p
                .view
                .controlled
                .take()
                .and_then(|r| self.units.get_mut(&r.unit))
            {
                unit.controller = None;
                unit.epoch += 1;
                unit.fire = false;
                unit.last_seq = 0;
                unit.last_input = now;
                let _ = self.sim.set_input(
                    unit.reference.unit,
                    SimInput {
                        throttle: 0.0,
                        steer: 0.0,
                        brake: 1.0,
                        turret_yaw: None,
                        gun_pitch: None,
                    },
                );
            }
            p.view.epoch += 1;
        }
    }
    fn acquire_air(&mut self, player: u32, reference: UnitRef, now: f64) {
        self.release(player, now);
        self.air.unpark(reference.unit);
        let epoch = self.members[&player].view.epoch;
        let u = self
            .air
            .units
            .get_mut(&reference.unit)
            .expect("validated owned aircraft");
        u.controller = Some(player);
        u.epoch = u.epoch.max(epoch) + 1;
        u.last_seq = 0;
        u.last_input = now;
        let p = self.members.get_mut(&player).unwrap();
        p.view.controlled = Some(reference);
        p.view.epoch = u.epoch;
        p.gate = Gate::None;
        p.resume_unit = None;
    }
    fn acquire(&mut self, player: u32, reference: UnitRef, now: f64) {
        self.release(player, now);
        let participant_epoch = self.members[&player].view.epoch;
        let u = self
            .units
            .get_mut(&reference.unit)
            .expect("validated takeover unit");
        u.controller = Some(player);
        u.epoch = u.epoch.max(participant_epoch) + 1;
        u.last_seq = 0;
        u.last_input = now;
        u.fire = false;
        let p = self
            .members
            .get_mut(&player)
            .expect("validated participant");
        p.view.controlled = Some(reference);
        p.view.epoch = u.epoch;
        p.gate = Gate::None;
        p.resume_unit = None;
    }
    #[cfg(test)]
    fn target(&self, team: Team) -> [f64; 2] {
        if let Some(target) = self.campaign.target(&self.objectives, team) {
            return target;
        }
        let objective = self
            .objectives
            .iter()
            .find(|o| o.id == "C2" || o.id == "c2")
            .unwrap_or(&self.objectives[self.objectives.len() / 2]);
        [objective.pos[0], objective.pos[2]]
    }
    fn staging_available(&self, source: &Staging) -> bool {
        self.campaign.route_open(&source.road)
            && self.sim.source_supply_open(&source.id).unwrap_or(true)
            && source.objective.as_ref().is_none_or(|id| {
                self.objectives.iter().any(|o| {
                    o.id == *id
                        && o.owner == Some(source.team)
                        && o.supplied[source.team.index()]
                        && !o.contested
                })
            })
    }
    fn sync_facility_routes(&mut self) {
        // Sim aggregates ALL physical bridges on a registered road. Never
        // reopen a multi-bridge edge from one repair-complete announcement.
        for (road, open) in self.sim.facility_route_states() {
            let _ = self
                .campaign
                .set_facility_route_open(&road, open, &mut self.objectives);
        }
    }
    fn support_chassis(&self) -> &'static str {
        if self.era < 1942 {
            "de_pzjg1"
        } else if self.era < 1950 {
            "de_rso_pak40"
        } else {
            "su_att_m46"
        }
    }
    fn queue_front_support(&mut self) {
        // C2 is an explicitly selected legacy domain fixture, not production.
        if !self.player_ground_allowed || self.objectives.len() <= 1 {
            return;
        }
        for id in &self.ai_staging {
            let s = self
                .staging
                .iter()
                .find(|s| s.id == *id)
                .expect("validated source");
            for role in ["engineer", "supply"] {
                self.pending_support.push(SupportDeployment {
                    source: id.clone(),
                    team: s.team,
                    role: role.into(),
                    slots: s.support_slots.clone(),
                });
            }
        }
        for team in [Team::Blue, Team::Red] {
            for (field, slots) in self
                .sim
                .airport_support_sources(team.index() as u8, self.support_chassis())
            {
                for role in ["engineer", "supply"] {
                    self.pending_support.push(SupportDeployment {
                        source: format!("airfield:{field}"),
                        team,
                        role: role.into(),
                        slots: slots.clone(),
                    });
                }
            }
        }
    }
    fn spawn_pending_support(&mut self, next_unit: &mut u64) {
        if !self.player_ground_allowed {
            self.pending_support.clear();
            return;
        }
        if self.pending_support.is_empty() || self.sim.time() < self.support_retry {
            return;
        }
        self.support_retry = self.sim.time() + 1.0;
        let chassis = self.support_chassis();
        let pending = std::mem::take(&mut self.pending_support);
        for intent in pending {
            let roles = FacilityWorkerRoles {
                engineer: intent.role == "engineer",
                supply: intent.role == "supply",
                combat: false,
            };
            let admitted = intent.slots.iter().find_map(|&(p, yaw)| {
                self.sim
                    .spawn_support_unit(
                        *next_unit,
                        chassis,
                        intent.team.index() as u8,
                        p,
                        yaw,
                        roles,
                    )
                    .ok()
            });
            if admitted.is_none() {
                self.pending_support.push(intent);
                continue;
            }
            let reference = UnitRef {
                battle: self.battle,
                unit: *next_unit,
                life: 1,
            };
            *next_unit += 1;
            self.units.insert(
                reference.unit,
                Unit {
                    reference,
                    company: 0,
                    platoon: None,
                    team: intent.team,
                    controller: None,
                    epoch: 1,
                    last_seq: 0,
                    last_input: self.last_step,
                    fire: false,
                    loss_counted: false,
                    navigation: None,
                    reinforcing: false,
                    support: Some(SupportActor {
                        role: intent.role,
                        source: intent.source,
                        task: None,
                        next_auto: 0.0,
                    }),
                },
            );
        }
    }
    fn assign_support(
        &mut self,
        unit: UnitRef,
        kind: FacilityJobKind,
        facility_id: String,
        expected_revision: u64,
        seq: u64,
    ) {
        let u = self.units.get_mut(&unit.unit).expect("checked support");
        let actor = u.support.as_mut().expect("checked support");
        if let Some(job) = actor.task.as_ref().and_then(|t| t.job_id) {
            let _ = self.sim.cancel_facility_job(job, unit);
        }
        u.last_seq = seq;
        u.navigation = None;
        actor.task = Some(SupportTask {
            kind,
            facility_id,
            expected_revision,
            status: "queued".into(),
            reason: None,
            job_id: None,
            retry_at: 0.0,
            automatic: false,
        });
    }
    fn support_plan(&self, reference: UnitRef, facility: &FacilityView) -> Option<NavigationPlan> {
        let s = self.sim.snapshot(reference.unit)?;
        let target = self
            .sim
            .support_destination(reference.unit, &facility.facility_id)?;
        if let Some(points) = self
            .sim
            .support_local_route(reference.unit, &facility.facility_id)
        {
            let safe = self.sim.support_route_prefix(reference.unit, &points);
            return NavigationPlan::support_prefix(
                safe,
                Vec::new(),
                "airfield_service".into(),
                5.0,
            );
        }
        let team = self.units[&reference.unit].team;
        let mut candidate = self.plan_navigation(s.pos, target, team, None);
        if candidate.is_none() {
            let source = self
                .staging
                .iter()
                .find(|p| p.team == team && distance(p.pos, s.pos) <= p.radius);
            for road in &facility.road_ids {
                let at = source
                    .map(|p| *p.entry.last().unwrap())
                    .unwrap_or([s.pos[0], s.pos[2]]);
                if let Some(mut plan) =
                    self.campaign
                        .plan_recovery_route([at[0], s.pos[1], at[1]], target, road)
                {
                    if let Some(source) = source {
                        let mut entry = vec![[s.pos[0], s.pos[2]], [source.pos[0], source.pos[2]]];
                        entry.extend_from_slice(&source.entry);
                        plan.prepend(&entry);
                    }
                    candidate = Some(plan);
                    break;
                }
            }
        }
        let candidate = candidate?;
        let safe = self
            .sim
            .support_route_prefix(reference.unit, &candidate.points);
        NavigationPlan::support_prefix(safe, candidate.roads, candidate.front, candidate.half_width)
    }
    fn hold_support(&mut self, id: u64) {
        let _ = self.sim.set_input(
            id,
            SimInput {
                brake: 1.0,
                ..Default::default()
            },
        );
    }
    fn step_support(&mut self, reference: UnitRef, s: &SimKinematics) {
        if !self.player_ground_allowed {
            // Defensive handling for a retained historical actor: it cannot
            // continue a facility job or navigate as an engineer/supply AI.
            let actor = self.units.get_mut(&reference.unit).unwrap().support.as_mut().unwrap();
            if let Some(job) = actor.task.take().and_then(|task| task.job_id) {
                let _ = self.sim.cancel_facility_job(job, reference);
            }
            self.hold_support(reference.unit);
            return;
        }
        let now = self.sim.time();
        let actor = self.units[&reference.unit].support.as_ref().unwrap();
        if actor.task.is_none() {
            if now < actor.next_auto {
                self.hold_support(reference.unit);
                return;
            }
            let team = self.units[&reference.unit].team;
            let kind = if actor.role == "engineer" {
                FacilityJobKind::Repair
            } else {
                FacilityJobKind::DeliverSupply
            };
            let local_airfield = actor.source.strip_prefix("airfield:");
            let mut candidates: Vec<_> = self
                .sim
                .facility_views()
                .into_iter()
                .filter(|f| {
                    f.team.is_none_or(|t| t == team.index() as u8)
                        && match local_airfield {
                            Some(id) => f.airfield.as_deref() == Some(id),
                            None => f.airfield.is_none(),
                        }
                        && if kind == FacilityJobKind::Repair {
                            f.hp < f.max_hp
                        } else {
                            f.hp > 0.0 && !f.supplied
                        }
                })
                .filter_map(|f| {
                    self.sim
                        .facility_work_distance(&f.facility_id, s.pos)
                        .map(|d| (d, f))
                })
                .collect();
            candidates.sort_by(|a, b| {
                a.0.total_cmp(&b.0)
                    .then_with(|| a.1.facility_id.cmp(&b.1.facility_id))
            });
            // An unreachable job is queued, never falsely marked as arrived.
            // Prefer a currently admissible registered route when one exists.
            let selected = candidates
                .iter()
                .find(|(_, f)| self.support_plan(reference, f).is_some())
                .or(candidates.first())
                .map(|(_, f)| f.clone());
            let actor = self
                .units
                .get_mut(&reference.unit)
                .unwrap()
                .support
                .as_mut()
                .unwrap();
            actor.next_auto = now + 1.0;
            if let Some(f) = selected {
                actor.task = Some(SupportTask {
                    kind,
                    facility_id: f.facility_id,
                    expected_revision: f.revision,
                    status: "queued".into(),
                    reason: None,
                    job_id: None,
                    retry_at: 0.0,
                    automatic: true,
                });
            } else {
                self.hold_support(reference.unit);
                return;
            }
        }
        let mut task = self.units[&reference.unit]
            .support
            .as_ref()
            .unwrap()
            .task
            .clone()
            .unwrap();
        if let Some(job_id) = task.job_id {
            if let Some(job) = self
                .sim
                .facility_job_views()
                .into_iter()
                .find(|j| j.job_id == job_id)
            {
                task.status = job.status.clone();
                if job.status.starts_with("restart_required")
                    || job.status.starts_with("cancelled_unit")
                {
                    let _ = self.sim.cancel_facility_job(job_id, reference);
                    task.status = "interrupted".into();
                    task.reason = Some("stale_facility".into());
                    task.job_id = None;
                    self.hold_support(reference.unit);
                    let actor = self
                        .units
                        .get_mut(&reference.unit)
                        .unwrap()
                        .support
                        .as_mut()
                        .unwrap();
                    actor.task = if task.automatic { None } else { Some(task) };
                    actor.next_auto = now + 1.0;
                    return;
                }
                if matches!(job.status.as_str(), "complete" | "cancelled") {
                    task.reason =
                        (job.status == "cancelled").then(|| "native_job_cancelled".into());
                    self.units.get_mut(&reference.unit).unwrap().navigation = None;
                    self.hold_support(reference.unit);
                    let actor = self
                        .units
                        .get_mut(&reference.unit)
                        .unwrap()
                        .support
                        .as_mut()
                        .unwrap();
                    actor.task = if task.automatic { None } else { Some(task) };
                    actor.next_auto = now + 1.0;
                    return;
                }
            }
            // Native work progress only runs while the actual plant is alive,
            // stopped and within the source geometry's working distance.
            self.hold_support(reference.unit);
            self.units
                .get_mut(&reference.unit)
                .unwrap()
                .support
                .as_mut()
                .unwrap()
                .task = Some(task);
            return;
        }
        let Some(facility) = self
            .sim
            .facility_views()
            .into_iter()
            .find(|f| f.facility_id == task.facility_id)
        else {
            task.status = "queued".into();
            task.reason = Some("facility_unavailable".into());
            self.hold_support(reference.unit);
            self.units
                .get_mut(&reference.unit)
                .unwrap()
                .support
                .as_mut()
                .unwrap()
                .task = Some(task);
            return;
        };
        if facility.revision != task.expected_revision {
            task.status = "interrupted".into();
            task.reason = Some("stale_facility".into());
            self.hold_support(reference.unit);
            let actor = self
                .units
                .get_mut(&reference.unit)
                .unwrap()
                .support
                .as_mut()
                .unwrap();
            actor.task = if task.automatic { None } else { Some(task) };
            actor.next_auto = now + 1.0;
            return;
        }
        let work_distance = self
            .sim
            .facility_work_distance(&task.facility_id, s.pos)
            .unwrap_or(f64::INFINITY);
        if work_distance <= 25.0 {
            self.hold_support(reference.unit);
            if s.velocity.iter().map(|v| v * v).sum::<f64>().sqrt() <= 0.5 {
                match self.sim.request_facility_job(
                    task.kind,
                    &task.facility_id,
                    task.expected_revision,
                    reference,
                    self.units[&reference.unit].team.index() as u8,
                ) {
                    Ok(job) => {
                        task.job_id = Some(job.job_id);
                        task.status = job.status;
                        task.reason = None;
                    }
                    Err(reason) => {
                        task.status = "queued".into();
                        task.reason = Some(reason);
                    }
                }
            } else {
                task.status = "stopping".into();
            }
        } else {
            let need = self.units[&reference.unit].navigation.is_none()
                || (now >= task.retry_at && task.reason.is_some());
            if need {
                let plan = self.support_plan(reference, &facility);
                self.units.get_mut(&reference.unit).unwrap().navigation = plan;
                task.retry_at = now + 1.0;
            }
            if let Some(plan) = self
                .units
                .get_mut(&reference.unit)
                .unwrap()
                .navigation
                .as_mut()
            {
                let waypoint = plan.waypoint(s.pos);
                let next = plan.next_waypoint();
                let range = (s.pos[0] - plan.target[0]).hypot(s.pos[2] - plan.target[1]);
                if range < 2.0 {
                    task.status = "queued".into();
                    task.reason = Some("no_safe_working_approach".into());
                    self.hold_support(reference.unit);
                } else if let Ok(input) = self.sim.navigation_input(reference.unit, waypoint, next)
                {
                    let _ = self.sim.set_input(reference.unit, input);
                    task.status = "travelling".into();
                    task.reason = None;
                }
            } else {
                task.status = "queued".into();
                task.reason = Some("no_registered_dry_route".into());
                self.hold_support(reference.unit);
            }
        }
        self.units
            .get_mut(&reference.unit)
            .unwrap()
            .support
            .as_mut()
            .unwrap()
            .task = Some(task);
    }
    fn select_staging(
        &self,
        team: Team,
        requested: Option<&str>,
        company: Option<u64>,
    ) -> Result<&Staging, Update> {
        let requested = requested.or_else(|| {
            company
                .and_then(|id| self.companies.get(&id))
                .map(|c| c.view.staging.as_str())
        });
        if let Some(id) = requested {
            let source = self
                .staging
                .iter()
                .find(|s| s.id == id)
                .ok_or_else(|| failure("unknown_staging", "Unknown deployment source"))?;
            if source.team != team {
                return Err(failure(
                    "foreign_staging",
                    "Deployment source belongs to the other team",
                ));
            }
            if !self.staging_available(source) {
                return Err(failure(
                    "staging_unavailable",
                    "Deployment source has lost supply or its registered route",
                ));
            }
            return Ok(source);
        }
        self.staging
            .iter()
            .filter(|s| s.team == team && self.staging_available(s))
            .min_by(|a, b| {
                (a.front != "centre")
                    .cmp(&(b.front != "centre"))
                    .then_with(|| a.id.cmp(&b.id))
            })
            .ok_or_else(|| {
                failure(
                    "staging_unavailable",
                    "No supplied physical deployment source is available",
                )
            })
    }
    fn plan_navigation(
        &self,
        position: [f64; 3],
        target: [f64; 2],
        team: Team,
        preferred_road: Option<&str>,
    ) -> Option<NavigationPlan> {
        let source = self.staging.iter().find(|s| {
            s.team == team
                && distance(s.pos, position) <= s.radius
                && self.staging_available(s)
                && preferred_road.is_none_or(|road| s.road == road)
        });
        let destination = self.staging.iter().find(|s| {
            s.team == team
                && (s.pos[0] - target[0]).hypot(s.pos[2] - target[1]) <= s.radius
                && self.staging_available(s)
        });
        let from = source
            .map(|s| *s.entry.last().unwrap())
            .unwrap_or([position[0], position[2]]);
        let to = destination
            .map(|s| *s.entry.last().unwrap())
            .unwrap_or(target);
        // A unit already on an actual registered road should continue from its
        // projection, even while still inside a deployment radius. In particular
        // a moving platoon anchor must not send reinforcements back to pad centre
        // whenever their goal is refreshed.
        let direct = preferred_road
            .is_none()
            .then(|| self.campaign.plan_route(position, to, None))
            .flatten();
        let from_pad = direct.is_none();
        let mut plan = direct.or_else(|| {
            self.campaign.plan_route(
                [from[0], position[1], from[1]],
                to,
                source.map(|s| s.road.as_str()).or(preferred_road),
            )
        })?;
        if let Some(source) = source.filter(|_| from_pad) {
            let mut entry = vec![[position[0], position[2]], [source.pos[0], source.pos[2]]];
            entry.extend_from_slice(&source.entry);
            plan.prepend(&entry);
        }
        if let Some(destination) = destination {
            let mut entry = destination.entry.clone();
            entry.reverse();
            entry.push([destination.pos[0], destination.pos[2]]);
            entry.push(target);
            plan.append(&entry);
            plan.front = destination.front.clone();
        }
        plan.target = target;
        Some(plan)
    }
    fn spawn_company(
        &mut self,
        owner: Option<u32>,
        team: Team,
        vehicle: &str,
        autonomous: bool,
        staging_id: Option<&str>,
        next_company: &mut u64,
        next_unit: &mut u64,
        now: f64,
    ) -> Result<u64, String> {
        let source = self
            .select_staging(team, staging_id, None)
            .map_err(|e| match e {
                Update::Error { message, .. } => message,
                _ => "Deployment unavailable".into(),
            })?
            .clone();
        let target = self
            .campaign
            .front_target(&self.objectives, team, &source.front)
            .unwrap_or([source.pos[0], source.pos[2]]);
        let initial_plan = self
            .plan_navigation(source.pos, target, team, Some(&source.road))
            .ok_or("No registered route from deployment to this front")?;
        let positions = if autonomous {
            (0..10)
                .map(|i| {
                    let p = initial_plan.point_after(140.0 + i as f64 * 14.0);
                    [p[0], source.pos[1], p[1]]
                })
                .collect::<Vec<_>>()
        } else {
            source.slots.iter().take(10).copied().collect()
        };
        let existing = self.sim.kinematics();
        if positions.iter().any(|p| {
            existing
                .iter()
                .any(|u| u.alive && distance(u.pos, *p) < 8.0)
        }) {
            return Err(
                "Deployment source is occupied; wait for its physical queue to clear".into(),
            );
        }
        let mut prepared = Vec::new();
        for (index, pos) in positions.iter().copied().enumerate() {
            if positions[index + 1..]
                .iter()
                .any(|other| distance(pos, *other) < 8.0)
            {
                return Err("Deployment route cannot separate its physical company".into());
            }
            let plan = self
                .plan_navigation(pos, target, team, None)
                .ok_or("Physical spawn misses registered navigation")?;
            let ahead = plan
                .points
                .iter()
                .find(|p| (p[0] - pos[0]).hypot(p[1] - pos[2]) > 0.5)
                .copied()
                .unwrap_or(target);
            let heading = if autonomous {
                (ahead[0] - pos[0]).atan2(ahead[1] - pos[2])
            } else {
                source.headings[index]
            };
            prepared.push((pos, heading, plan));
        }
        let id = *next_company;
        *next_company += 1;
        let mut spawned = Vec::new();
        let mut members = Vec::new();
        let mut platoons: [Vec<UnitRef>; 3] = Default::default();
        for (index, (pos, heading, plan)) in prepared.into_iter().enumerate() {
            let unit = *next_unit;
            *next_unit += 1;
            if let Err(e) = self
                .sim
                .spawn_unit(unit, vehicle, team.index() as u8, pos, heading)
            {
                for unit in spawned {
                    self.sim.remove_unit(unit);
                }
                return Err(e);
            }
            spawned.push(unit);
            let reference = UnitRef {
                battle: self.battle,
                unit,
                life: 1,
            };
            let platoon = if index == 0 {
                None
            } else {
                Some(((index - 1) / 3) as u8)
            };
            if let Some(p) = platoon {
                platoons[p as usize].push(reference);
            }
            members.push((reference, platoon, plan));
        }
        for (reference, platoon, plan) in &members {
            self.units.insert(
                reference.unit,
                Unit {
                    reference: *reference,
                    company: id,
                    platoon: *platoon,
                    team,
                    controller: None,
                    epoch: 1,
                    last_seq: 0,
                    last_input: now,
                    fire: false,
                    loss_counted: false,
                    navigation: Some(plan.clone()),
                    reinforcing: false,
                    support: None,
                },
            );
        }
        self.companies.insert(
            id,
            Company {
                view: CompanyView {
                    id,
                    owner,
                    team,
                    autonomous,
                    units: members.iter().map(|(u, _, _)| *u).collect(),
                    platoons,
                    orders: (0..3)
                        .map(|p| OrderView {
                            platoon: Some(p),
                            kind: OrderKind::Attack,
                            target,
                            seq: 0,
                            front: source.front.clone(),
                            routes: initial_plan.roads.clone(),
                        })
                        .collect(),
                    staging: source.id.clone(),
                    front: source.front.clone(),
                    reinforcement: ReinforcementView {
                        pending: 0,
                        incoming: 0,
                        next_batch_s: REINFORCEMENT_INTERVAL,
                        batch_interval_s: REINFORCEMENT_INTERVAL,
                        max_batch: REINFORCEMENT_BATCH as u8,
                        status: "full".into(),
                        source: source.id.clone(),
                    },
                },
                last_order_seq: 0,
                vehicle: vehicle.into(),
                reinforcement_next: self.sim.time() + REINFORCEMENT_INTERVAL,
                reinforcement_retry: 0.0,
                reinforcement_status: "waiting".into(),
            },
        );
        Ok(id)
    }
    fn remove_company(&mut self, id: u64) {
        if let Some(c) = self.companies.remove(&id) {
            // Retired slot references include old wrecks. Round/start rollback
            // removes the whole company; ordinary reinforcement never does.
            let ids: Vec<_> = self
                .units
                .values()
                .filter(|u| u.company == c.view.id)
                .map(|u| u.reference.unit)
                .collect();
            for id in ids {
                self.units.remove(&id);
                self.sim.remove_unit(id);
            }
        }
    }
    fn company_order_target(&self, company: u64, platoon: Option<u8>) -> Option<[f64; 2]> {
        let c = self.companies.get(&company)?;
        let order = c
            .view
            .orders
            .iter()
            .find(|o| o.platoon == platoon)
            .or_else(|| c.view.orders.iter().find(|o| o.platoon == Some(0)))?;
        if order.seq > 0 {
            Some(order.target)
        } else {
            self.campaign
                .front_target(&self.objectives, c.view.team, &order.front)
        }
    }
    fn reinforcement_goal(
        &self,
        company: u64,
        platoon: Option<u8>,
        from: [f64; 3],
        snapshots: &[crate::frontline_sim::SimKinematics],
    ) -> Option<([f64; 2], f64)> {
        let c = self.companies.get(&company)?;
        let anchor = c
            .view
            .units
            .iter()
            .filter_map(|r| {
                let u = self.units.get(&r.unit)?;
                if u.reinforcing {
                    return None;
                }
                let priority = if u.platoon == platoon {
                    0
                } else if u.platoon.is_none() {
                    1
                } else {
                    2
                };
                snapshots
                    .iter()
                    .find(|s| s.id == r.unit && s.alive)
                    .map(|s| (priority, s))
            })
            .min_by(|a, b| {
                a.0.cmp(&b.0)
                    .then_with(|| distance(a.1.pos, from).total_cmp(&distance(b.1.pos, from)))
                    .then_with(|| a.1.id.cmp(&b.1.id))
            });
        if let Some((_, anchor)) = anchor {
            // Regroup at the living company command/another platoon if this
            // platoon was wiped; only a fully wiped company uses its last order.
            Some(([anchor.pos[0], anchor.pos[2]], 24.0))
        } else {
            self.company_order_target(company, platoon)
                .map(|target| (target, 18.0))
        }
    }
    fn reinforce_companies(&mut self, next_unit: &mut u64, events: &mut Vec<Value>) {
        // This clock advances only through accepted fixed native steps. A late
        // room broadcast/wall-clock jump cannot mint several overdue batches.
        let clock = self.sim.time();
        let companies: Vec<_> = self.companies.keys().copied().collect();
        for company in companies {
            let c = &self.companies[&company];
            let vacancies: Vec<_> = c
                .view
                .units
                .iter()
                .copied()
                .enumerate()
                .filter(|(_, r)| !self.sim.unit_alive(r.unit))
                .take(REINFORCEMENT_BATCH)
                .collect();
            if clock + 1e-8 < c.reinforcement_next || clock + 1e-8 < c.reinforcement_retry {
                continue;
            }
            if vacancies.is_empty() {
                let c = self.companies.get_mut(&company).unwrap();
                c.reinforcement_next = clock + REINFORCEMENT_INTERVAL;
                c.reinforcement_status = "waiting".into();
                continue;
            }
            let team = c.view.team;
            let original_source = c.view.staging.clone();
            let vehicle = c.vehicle.clone();
            let failure = if self.readiness[team.index()] == 0 {
                Some("readiness_exhausted")
            } else if !self.staging.iter().any(|s| {
                s.id == original_source
                    && s.team == team
                    && s.front == c.view.front
                    && self.staging_available(s)
            }) {
                Some("source_unavailable")
            } else {
                None
            };
            if let Some(status) = failure {
                let c = self.companies.get_mut(&company).unwrap();
                c.reinforcement_status = status.into();
                c.reinforcement_retry = clock + 1.0;
                continue;
            }
            let source = self
                .staging
                .iter()
                .find(|s| s.id == original_source)
                .unwrap()
                .clone();
            let snapshots = self.sim.kinematics();
            // Wrecks retain obstruction, so they also occupy a rear slot.
            let free: Vec<_> = source
                .slots
                .iter()
                .copied()
                .zip(source.headings.iter().copied())
                .filter(|(p, _)| !snapshots.iter().any(|u| distance(u.pos, *p) < 8.0))
                .take(vacancies.len())
                .collect();
            if free.is_empty() {
                let c = self.companies.get_mut(&company).unwrap();
                c.reinforcement_status = "source_occupied".into();
                c.reinforcement_retry = clock + 1.0;
                continue;
            }
            let mut prepared = Vec::new();
            let expected = free.len();
            for ((slot, old), (pos, heading)) in vacancies.into_iter().zip(free) {
                let platoon = self.units.get(&old.unit).and_then(|u| u.platoon);
                let Some((target, _)) = self.reinforcement_goal(company, platoon, pos, &snapshots)
                else {
                    break;
                };
                let Some(plan) = self.plan_navigation(pos, target, team, Some(&source.road)) else {
                    break;
                };
                prepared.push((slot, old, platoon, pos, heading, plan));
            }
            // Keep a blocked batch pending; never substitute a direct chord.
            if prepared.len() != expected {
                let c = self.companies.get_mut(&company).unwrap();
                c.reinforcement_status = "route_blocked".into();
                c.reinforcement_retry = clock + 1.0;
                continue;
            }
            let mut spawned = Vec::new();
            let mut spawn_failed = false;
            for (_, _, _, pos, heading, _) in &prepared {
                let id = *next_unit;
                *next_unit += 1;
                if self
                    .sim
                    .spawn_unit(id, &vehicle, team.index() as u8, *pos, *heading)
                    .is_err()
                {
                    spawn_failed = true;
                    break;
                }
                spawned.push(id);
            }
            if spawn_failed {
                for id in spawned {
                    self.sim.remove_unit(id);
                }
                let c = self.companies.get_mut(&company).unwrap();
                c.reinforcement_status = "source_occupied".into();
                c.reinforcement_retry = clock + 1.0;
                continue;
            }
            let mut accepted = Vec::new();
            for ((slot, old, platoon, _, _, plan), id) in prepared.into_iter().zip(spawned) {
                let reference = UnitRef {
                    battle: self.battle,
                    unit: id,
                    life: 1,
                };
                self.units.insert(
                    id,
                    Unit {
                        reference,
                        company,
                        platoon,
                        team,
                        controller: None,
                        epoch: 1,
                        last_seq: 0,
                        last_input: self.last_step,
                        fire: false,
                        loss_counted: false,
                        navigation: Some(plan),
                        reinforcing: true,
                        support: None,
                    },
                );
                let c = self.companies.get_mut(&company).unwrap();
                c.view.units[slot] = reference;
                if let Some(p) = platoon {
                    if let Some(r) = c.view.platoons[p as usize].iter_mut().find(|r| **r == old) {
                        *r = reference;
                    }
                }
                accepted.push(json!({"unit":reference,"replaces":old,"platoon":platoon}));
            }
            let c = self.companies.get_mut(&company).unwrap();
            c.reinforcement_next = clock + REINFORCEMENT_INTERVAL;
            c.reinforcement_retry = 0.0;
            c.reinforcement_status = "waiting".into();
            events.push(json!({"kind":"reinforcement_batch","company":company,"team":team,"source":source.id,"accepted":accepted,"next_batch_s":REINFORCEMENT_INTERVAL}));
        }
    }
    fn step(&mut self, next_unit: &mut u64) -> Vec<Value> {
        let ai_start = self.timing.as_ref().map(|_| Instant::now());
        let loss_cost = if self.player_ground_allowed { LOSS_COST } else { 0 };
        self.tick += 1;
        self.sync_facility_routes();
        self.spawn_pending_support(next_unit);
        let now = self.last_step;
        let snapshots = self.sim.kinematics();
        let mut events = Vec::new();
        let controls: Vec<_> = self
            .units
            .values()
            .map(|u| {
                (
                    u.reference,
                    u.company,
                    u.platoon,
                    u.team,
                    u.controller,
                    u.fire && now - u.last_input <= INPUT_TIMEOUT,
                    now - u.last_input > INPUT_TIMEOUT,
                )
            })
            .collect();
        for (reference, company, platoon, team, controller, fire, timed_out) in controls {
            let Some(s) = snapshots.iter().find(|s| s.id == reference.unit && s.alive) else {
                continue;
            };
            if self.units[&reference.unit].support.is_some() {
                self.step_support(reference, s);
                continue;
            }
            let join = self.units[&reference.unit]
                .reinforcing
                .then(|| self.reinforcement_goal(company, platoon, s.pos, &snapshots))
                .flatten();
            if let Some((target, radius)) = join {
                if (target[0] - s.pos[0]).hypot(target[1] - s.pos[2]) < radius {
                    self.units.get_mut(&reference.unit).unwrap().reinforcing = false;
                    events.push(json!({"kind":"reinforcement_joined","company":company,"unit":reference,"platoon":platoon,"pos":s.pos}));
                }
            }
            if controller.is_some() {
                if timed_out {
                    let _ = self.sim.set_input(
                        reference.unit,
                        SimInput {
                            throttle: 0.0,
                            steer: 0.0,
                            brake: 1.0,
                            turret_yaw: None,
                            gun_pitch: None,
                        },
                    );
                }
                if fire {
                    if let Ok(event) = self.sim.fire(reference.unit, None) {
                        events.push(self.event(serde_json::to_value(event).unwrap_or(Value::Null)));
                    }
                }
                continue;
            }
            let c = &self.companies[&company];
            let order = c
                .view
                .orders
                .iter()
                .find(|o| o.platoon == platoon)
                .or_else(|| c.view.orders.iter().find(|o| o.platoon == Some(0)))
                .cloned();
            let target = if self.units[&reference.unit].reinforcing {
                let requested = join.map(|j| j.0).unwrap_or([s.pos[0], s.pos[2]]);
                // Follow a moving real platoon without rebuilding its long path
                // for every centimetre of movement. Arrival uses the live body.
                self.units[&reference.unit]
                    .navigation
                    .as_ref()
                    .filter(|p| {
                        self.campaign.plan_open(p)
                            && (p.target[0] - requested[0]).hypot(p.target[1] - requested[1]) < 12.0
                    })
                    .map(|p| p.target)
                    .unwrap_or(requested)
            } else {
                order
                    .as_ref()
                    .filter(|o| o.seq > 0)
                    .map(|o| o.target)
                    .unwrap_or_else(|| {
                        self.campaign
                            .front_target(
                                &self.objectives,
                                team,
                                order
                                    .as_ref()
                                    .map(|o| o.front.as_str())
                                    .unwrap_or(&c.view.front),
                            )
                            .unwrap_or([s.pos[0], s.pos[2]])
                    })
            };
            let replan = self.units[&reference.unit]
                .navigation
                .as_ref()
                .is_none_or(|p| p.target != target || !self.campaign.plan_open(p));
            if replan {
                let plan = self.plan_navigation(s.pos, target, team, None);
                self.units.get_mut(&reference.unit).unwrap().navigation = plan;
            }
            let Some(plan) = self
                .units
                .get_mut(&reference.unit)
                .unwrap()
                .navigation
                .as_mut()
            else {
                let _ = self.sim.set_input(
                    reference.unit,
                    SimInput {
                        throttle: 0.0,
                        steer: 0.0,
                        brake: 1.0,
                        turret_yaw: None,
                        gun_pitch: None,
                    },
                );
                continue;
            };
            let waypoint = plan.waypoint(s.pos);
            let next_waypoint = plan.next_waypoint();
            let routes = plan.roads.clone();
            if order
                .as_ref()
                .is_some_and(|o| o.seq == 0 && o.target != target)
            {
                if let Some(saved) = self.companies.get_mut(&company).and_then(|c| {
                    c.view
                        .orders
                        .iter_mut()
                        .find(|o| o.platoon == order.as_ref().unwrap().platoon)
                }) {
                    saved.target = target;
                    saved.routes = routes;
                }
            }
            let range = (target[0] - s.pos[0]).hypot(target[1] - s.pos[2]);
            let enemy = nearest_visible_ground(&snapshots, s.pos, team, |t| {
                self.sim.line_of_sight(
                    [s.pos[0], s.pos[1] + 1.8, s.pos[2]],
                    [t.pos[0], t.pos[1] + 1.0, t.pos[2]],
                )
            });
            let fighting = enemy.is_some_and(|t| distance(t.pos, s.pos) < 900.0);
            let hold = range
                < if matches!(order.as_ref().map(|o| o.kind), Some(OrderKind::Defend)) {
                    70.0
                } else {
                    18.0
                };
            if let Ok(mut input) =
                self.sim
                    .navigation_input(reference.unit, waypoint, next_waypoint)
            {
                if hold || fighting {
                    input.throttle = 0.0;
                    input.steer = 0.0;
                    input.brake = 1.0;
                }
                let _ = self.sim.set_input(reference.unit, input);
            }
            if let Some(t) = enemy {
                if self
                    .sim
                    .aim_at(reference.unit, [t.pos[0], t.pos[1] + 0.8, t.pos[2]])
                    .unwrap_or(false)
                {
                    if let Ok(event) = self.sim.fire(reference.unit, None) {
                        events.push(self.event(serde_json::to_value(event).unwrap_or(Value::Null)));
                    }
                }
            }
        }
        if let (Some(t), Some(start)) = (self.timing.as_mut(), ai_start) {
            t.ground_ai_ns += start.elapsed().as_nanos() as u64;
        }
        let sim_start = self.timing.as_ref().map(|_| Instant::now());
        self.air.set_clock(now - STEP);
        let native_events = self.sim.step_combined(STEP, &mut self.air);
        self.record_damage(&native_events, &mut events);
        for event in native_events {
            events.push(self.event(serde_json::to_value(event).unwrap_or(Value::Null)));
        }
        self.sync_facility_routes();
        if let (Some(t), Some(start)) = (self.timing.as_mut(), sim_start) {
            t.simulation_ns += start.elapsed().as_nanos() as u64;
        }
        let campaign_start = self.timing.as_ref().map(|_| Instant::now());
        let dead: Vec<_> = self
            .units
            .values()
            .filter(|u| !u.loss_counted && self.sim.unit_dead(u.reference.unit))
            .map(|u| (u.reference, u.team, u.controller))
            .collect();
        for (reference, team, controller) in dead {
            let u = self.units.get_mut(&reference.unit).unwrap();
            u.loss_counted = true;
            u.reinforcing = false;
            self.settle_loss(reference, None, false, &mut events);
            if self.player_ground_allowed {
                self.readiness[team.index()] = self.readiness[team.index()].saturating_sub(LOSS_COST);
            }
            if let Some(player) = controller {
                self.release(player, now);
                self.members.get_mut(&player).unwrap().gate = Gate::Loss;
            }
            for p in self
                .members
                .values_mut()
                .chain(self.departed.values_mut())
                .filter(|p| p.resume_unit == Some(reference))
            {
                p.resume_unit = None;
                p.gate = Gate::Loss;
            }
            events.push(
                json!({"kind":"unit_lost","unit":reference,"team":team,"readiness_cost":loss_cost}),
            );
        }
        let air_losses: Vec<_> = self
            .air
            .units
            .values()
            .filter(|u| !u.loss_counted && !u.alive())
            .map(|u| (u.reference, u.team, u.controller, u.owner))
            .collect();
        for (reference, team, controller, owner) in air_losses {
            self.settle_loss(reference, owner, true, &mut events);
            self.air
                .units
                .get_mut(&reference.unit)
                .unwrap()
                .loss_counted = true;
            if self.player_ground_allowed {
                self.readiness[team.index()] = self.readiness[team.index()].saturating_sub(LOSS_COST);
            }
            if let Some(player) = controller {
                self.release(player, now);
                self.members.get_mut(&player).unwrap().gate = Gate::Loss;
            }
            for p in self
                .members
                .values_mut()
                .chain(self.departed.values_mut())
                .filter(|p| p.resume_unit == Some(reference))
            {
                p.resume_unit = None;
                p.gate = Gate::Loss;
            }
            events.push(
                json!({"kind":"unit_lost","unit":reference,"team":team,"readiness_cost":loss_cost}),
            );
        }
        if let Some(scenario)=self.scenario.as_mut() {
            scenario.step(STEP,self.sim.time(),&self.sim.naval_views());
            return events;
        }
        let bodies = self.sim.capture_presence();
        let outcome = self.campaign.step(&mut self.objectives, &bodies, STEP);
        for (side, cost) in outcome.readiness_cost.into_iter().enumerate() {
            self.readiness[side] = self.readiness[side].saturating_sub(cost);
        }
        events.extend(outcome.events);
        self.score_zones(&mut events);
        self.reinforce_companies(next_unit, &mut events);
        if let Some(t) = self.timing.as_mut() {
            t.steps += 1;
            if let Some(start) = campaign_start {
                t.campaign_reinforcement_ns += start.elapsed().as_nanos() as u64;
            }
        }
        events
    }
    fn event(&self, mut value: Value) -> Value {
        for key in ["shooter", "target"] {
            if let Some(id) = value[key].as_u64() {
                value[key] = self
                    .units
                    .get(&id)
                    .map(|u| json!(u.reference))
                    .or_else(|| self.air.reference(id).map(|r| json!(r)))
                    .or_else(|| self.sim.naval_views().iter().find(|s|s.unit.unit==id).map(|s|json!(s.unit)))
                    .unwrap_or(Value::Null);
            }
        }
        value
    }
}
