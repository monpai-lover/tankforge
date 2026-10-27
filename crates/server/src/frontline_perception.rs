//! Team optical perception and fail-closed public presentation for the shared world.
//!
//! These are tunable GAME optical ranges, not historical radar/avionics models.
//! The caller supplies current accepted actors and the native terrain/vehicle LOS
//! query. No client claim, spectator view, wall clock, ammo or damage report is a
//! detection source. Only a successful scan may replace an enemy presentation.
//!
//! Integration contract:
//! * Advance once per accepted room tick, then (only when `scanned`) call
//!   `cache_public_poses` with projections from that SAME tick's accepted views.
//! * Observer Frame/Snapshot may retain truth. Blue/Red Frame AND Snapshot must
//!   contain full FRIENDLY units/aircraft/companies only, plus this team's cached
//!   `visible_ground`, `visible_aircrafts` and `contacts`. Never allow current full
//!   enemy views through merely because their UnitRef appears in `visible_enemies`.
//! * Room/member/control, staging, objectives, reinforcements and non-spatial
//!   events need their own audience policy. In particular remove enemy companies,
//!   orders/navigation and enemy member controlled/company/epoch links; do not
//!   append raw SimEvent.detail/combat reports to the public event projection.
//! * Build each authorized audience separately BEFORE v1/v2 serialization and
//!   delta baselines. Resync/reconnect rebuild the same authorized Snapshot; they
//!   do not rescan, discover units or upgrade the audience to observer.
//! * Lost contacts are map memories. They never feed live 3D actors, radar/seeker
//!   guidance or AI target truth. AI must separately use native LOS admission.
use crate::frontline::{Team, UnitRef, UnitView};
use crate::frontline_air::AirUnitView;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActorKind {
    Ground,
    Air,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PerceptionActor {
    pub unit: UnitRef,
    pub team: Team,
    pub kind: ActorKind,
    pub alive: bool,
    pub pos: [f64; 3],
    /// Only synthetic event witnesses use an already world-space locus. Native
    /// actor inputs must be false; the LOS host must not add a target eye offset
    /// to a real muzzle/impact/explosion position.
    pub event_locus: bool,
}
impl PerceptionActor {
    pub fn ground(view: &UnitView) -> Self {
        Self {
            unit: view.unit,
            team: view.team,
            kind: ActorKind::Ground,
            alive: view.alive,
            pos: view.pos,
            event_locus: false,
        }
    }
    pub fn air(view: &AirUnitView) -> Self {
        Self {
            unit: view.unit,
            team: view.team,
            kind: ActorKind::Air,
            alive: view.alive,
            pos: view.pos,
            event_locus: false,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OpticalRanges {
    pub ground_to_ground: f64,
    pub ground_to_air: f64,
    pub air_to_ground: f64,
    pub air_to_air: f64,
}
impl OpticalRanges {
    fn range(self, sensor: ActorKind, target: ActorKind) -> f64 {
        match (sensor, target) {
            (ActorKind::Ground, ActorKind::Ground) => self.ground_to_ground,
            (ActorKind::Ground, ActorKind::Air) => self.ground_to_air,
            (ActorKind::Air, ActorKind::Ground) => self.air_to_ground,
            (ActorKind::Air, ActorKind::Air) => self.air_to_air,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PerceptionConfig {
    pub scan_period_s: f64,
    pub last_known_s: f64,
    pub optical: OpticalRanges,
}
impl Default for PerceptionConfig {
    fn default() -> Self {
        Self {
            scan_period_s: 0.25,
            last_known_s: 30.0,
            optical: OpticalRanges {
                ground_to_ground: 1800.0,
                ground_to_air: 5000.0,
                air_to_ground: 7000.0,
                air_to_air: 12000.0,
            },
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ContactStatus {
    Detected,
    LastKnown,
}

/// All fields describe the LAST OBSERVATION, including observed_alive. A hidden
/// target's death/removal/replacement cannot alter this sampled position/state.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Contact {
    pub unit: UnitRef,
    pub team: Team,
    pub kind: ActorKind,
    pub pos: [f64; 3],
    pub observed_alive: bool,
    pub last_seen_tick: u64,
    pub last_seen_at: f64,
    pub status: ContactStatus,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublicRunningGear {
    pub version: u8,
    pub q: Vec<f64>,
    pub qv: Vec<f64>,
}
/// Native presentation kinematics only. No engine RPM, selected gear, health,
/// capability, mounted feed, company, controller or navigation fields.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublicGroundNet {
    pub pos: [f32; 3],
    pub ex: [f32; 3],
    pub ez: [f32; 3],
    pub v: [f32; 3],
    pub w: [f32; 3],
    pub track: [f32; 2],
    pub rg: Option<PublicRunningGear>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublicGroundPose {
    pub unit: UnitRef,
    pub vehicle: String,
    pub role: String,
    pub campaign_conversion: Option<PublicSupportConversion>,
    pub team: Team,
    pub alive: bool,
    pub pos: [f64; 3],
    pub yaw: f64,
    pub turret_yaw: f64,
    pub gun_pitch: f64,
    pub net: PublicGroundNet,
}

/// Visible campaign kit identity only. No repair/supply task, cargo stock,
/// destination, progress, engineering tool state or private source Value.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublicSupportConversion {
    pub kind: String,
    pub role: String,
    pub chassis: String,
    pub prototype: bool,
    pub mass_basis: String,
}

fn project_conversion(
    role: &str,
    chassis: &str,
    raw: Option<&Value>,
) -> Result<Option<PublicSupportConversion>, String> {
    if !matches!(role, "combat" | "engineer" | "supply") {
        return Err("invalid visible ground role".into());
    }
    let Some(raw) = raw else {
        return if role == "combat" {
            Ok(None)
        } else {
            Err("visible support conversion missing".into())
        };
    };
    if role == "combat" {
        return Err("combat actor cannot project a support conversion".into());
    }
    let text = |key: &str| {
        raw.get(key)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or("invalid visible campaign conversion")
    };
    let result = PublicSupportConversion {
        kind: text("kind")?,
        role: text("role")?,
        chassis: text("chassis")?,
        prototype: raw
            .get("prototype")
            .and_then(Value::as_bool)
            .ok_or("invalid visible prototype flag")?,
        mass_basis: text("mass_basis")?,
    };
    if result.kind != "campaign_support_conversion"
        || result.role != role
        || result.chassis != chassis
        || !result.prototype
        || result.mass_basis != "registered_chassis"
    {
        return Err("visible support conversion identity mismatch".into());
    }
    Ok(Some(result))
}

/// Named accepted visual fields, NOT the 80/48 telemetry arrays. pos/quaternion
/// are the source plant datum, so the existing grounded Aircraft.pose adjustment
/// must still use speed/agl/gear and the source type's gear metadata exactly once.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublicAirPose {
    pub unit: UnitRef,
    pub aircraft: String,
    pub team: Team,
    pub alive: bool,
    pub pos: [f64; 3],
    pub quaternion: [f32; 4],
    pub speed: f32,
    pub ground_speed: f32,
    pub agl: f32,
    pub sample_time: f32,
    pub pitch_surface: f32,
    pub roll_surface: f32,
    pub yaw_surface: f32,
    pub gear: f32,
    /// Visible absence of landing gear; never internal stress/HP fractions.
    #[serde(default)]
    pub gear_failed: bool,
    pub flap: f32,
    pub airbrake: f32,
    /// core213: main leg, main doors, nose leg, nose door. Not pilot inputs.
    pub gear_axes: [f32; 4],
    pub slat: f32,
    /// Visible detached part identities only: never HP, internal fire/engine
    /// factors, fuel, inventory, aim, instructor or commanded controls.
    pub detached_parts: Vec<String>,
    /// One physical socket/container per entry; no remaining pod rounds, fuel
    /// content or gun-pod feed is disclosed. Empty containers/racks may persist.
    pub stores: Vec<PublicVisualStore>,
    /// Already emitted visual decoys only; stock and release controls stay private.
    #[serde(default)]
    pub decoys: Vec<crate::frontline_air::countermeasures::DecoyView>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublicSourceGeometry {
    pub id: String,
    #[serde(rename = "sourceParts")]
    pub source_parts: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublicRack {
    pub id: String,
    pub origin: [f64; 3],
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublicVisualStore {
    /// Accepted layout index, also the individual native `store:N` instance.
    pub weapon_instance: String,
    pub id: Option<String>,
    pub station: String,
    pub p: Option<[f64; 3]>,
    /// A model part carrier, never a player owner/controller identity.
    pub owner: String,
    pub present: bool,
    pub mount_present: bool,
    pub pylon: Option<[[f64; 3]; 2]>,
    /// Actual visible fore/aft extrusion, even after its weapon is released.
    /// This deliberately does not retain the absent weapon's type as a proxy.
    pub pylon_length: Option<f64>,
    pub rack: Option<PublicRack>,
    #[serde(rename = "sourceStore")]
    pub source_store: Option<PublicSourceGeometry>,
    #[serde(rename = "sourceMount")]
    pub source_mount: Option<PublicSourceGeometry>,
    /// Authored adapter identity from the accepted store, independent of its weapon.
    #[serde(rename = "fittedMountKey", default, skip_serializing_if = "Option::is_none")]
    pub fitted_mount_key: Option<String>,
}

fn finite(values: impl IntoIterator<Item = f64>) -> bool {
    values.into_iter().all(f64::is_finite)
}
fn validate_ref(unit: UnitRef, battle: u64) -> Result<(), String> {
    if battle == 0 || unit.battle != battle || unit.unit == 0 || unit.life == 0 {
        return Err("perception identity/battle mismatch".into());
    }
    Ok(())
}
fn team_index(team: Team) -> usize {
    if team == Team::Blue {
        0
    } else {
        1
    }
}

/// Explicit input whitelist: serde ignores accepted native rpm/gear and any
/// future private net extension; the returned public struct cannot serialize it.
pub fn project_ground(view: &UnitView) -> Result<PublicGroundPose, String> {
    #[derive(Deserialize)]
    struct NetInput {
        pos: [f32; 3],
        ex: [f32; 3],
        ez: [f32; 3],
        v: [f32; 3],
        w: [f32; 3],
        track: [f32; 2],
        #[serde(default)]
        rg: Option<PublicRunningGear>,
    }
    validate_ref(view.unit, view.unit.battle)?;
    if view.vehicle.is_empty()
        || !finite(
            view.pos
                .into_iter()
                .chain([view.yaw, view.turret_yaw, view.gun_pitch]),
        )
    {
        return Err("invalid accepted ground pose".into());
    }
    let n: NetInput =
        serde_json::from_value(view.net.clone()).map_err(|_| "invalid accepted ground net")?;
    if !finite(
        n.pos
            .into_iter()
            .chain(n.ex)
            .chain(n.ez)
            .chain(n.v)
            .chain(n.w)
            .chain(n.track)
            .map(f64::from),
    ) {
        return Err("nonfinite ground kinematics".into());
    }
    if let Some(rg) = &n.rg {
        if rg.version != 1
            || rg.q.len() != rg.qv.len()
            || rg.q.len() > 4096
            || !finite(rg.q.iter().chain(&rg.qv).copied())
        {
            return Err("invalid visual running gear".into());
        }
    }
    Ok(PublicGroundPose {
        unit: view.unit,
        vehicle: view.vehicle.clone(),
        role: view.role.clone(),
        campaign_conversion: project_conversion(
            &view.role,
            &view.vehicle,
            view.campaign_conversion.as_ref(),
        )?,
        team: view.team,
        alive: view.alive,
        pos: view.pos,
        yaw: view.yaw,
        turret_yaw: view.turret_yaw,
        gun_pitch: view.gun_pitch,
        net: PublicGroundNet {
            pos: n.pos,
            ex: n.ex,
            ez: n.ez,
            v: n.v,
            w: n.w,
            track: n.track,
            rg: n.rg,
        },
    })
}

pub fn project_air(view: &AirUnitView) -> Result<PublicAirPose, String> {
    project_air_with_store_lengths(view, |_| None)
}

/// Supply static source store definition lengths (not mutable inventory). A
/// generic pylon's visible extrusion is min(1.4, def.len * 0.55), matching the
/// production mountStores builder. Without that source, fail instead of guessing
/// or disclosing an absent weapon ID merely so the client can reconstruct it.
pub fn project_air_with_store_lengths(
    view: &AirUnitView,
    store_length: impl Fn(&str) -> Option<f64>,
) -> Result<PublicAirPose, String> {
    validate_ref(view.unit, view.unit.battle)?;
    if view.aircraft.is_empty()
        || view.state.len() != 80
        || view.aero.len() != 48
        || !finite(view.pos)
        || !view.state.iter().chain(&view.aero).all(|v| v.is_finite())
    {
        return Err("invalid accepted aircraft pose".into());
    }
    let s = &view.state;
    if view.pos != [s[0] as f64, s[1] as f64, s[2] as f64]
        || s[3..7].iter().map(|v| (*v as f64).powi(2)).sum::<f64>() < 1e-12
    {
        return Err("aircraft source datum/quaternion mismatch".into());
    }
    let ids = view
        .damage
        .get("part_ids")
        .and_then(Value::as_array)
        .ok_or("missing aircraft visual part IDs")?;
    let parts = view
        .damage
        .get("parts")
        .and_then(Value::as_array)
        .ok_or("missing aircraft visual parts")?;
    if ids.len() != parts.len() {
        return Err("aircraft visual part catalog mismatch".into());
    }
    let mut all = BTreeSet::new();
    let mut detached = BTreeSet::new();
    let mut carrier_gone = BTreeSet::new();
    for (id, part) in ids.iter().zip(parts) {
        let id = id.as_str().ok_or("invalid aircraft visual part ID")?;
        if id.is_empty() || !all.insert(id) {
            return Err("duplicate aircraft visual part ID".into());
        }
        let pair = part
            .as_array()
            .ok_or("invalid aircraft visible detachment")?;
        if pair.len() != 2 {
            return Err("invalid aircraft visible detachment".into());
        }
        let gone = match &pair[1] {
            Value::Bool(b) => *b,
            Value::Number(n) if n.as_u64().is_some_and(|v| v <= 1) => n.as_u64() == Some(1),
            _ => return Err("invalid aircraft visible detachment".into()),
        };
        if gone {
            detached.insert(id.to_owned());
        }
        let hp = pair[0]
            .as_f64()
            .filter(|v| v.is_finite())
            .ok_or("invalid accepted visual carrier health")?;
        if gone || hp <= 0.0 {
            carrier_gone.insert(id.to_owned());
        }
    }
    if let Some(aliases) = view.damage.get("visual_aliases") {
        for (id, source) in aliases
            .as_object()
            .ok_or("invalid aircraft visual aliases")?
        {
            let source = source.as_str().ok_or("invalid aircraft visual alias")?;
            if !all.contains(source) || id.is_empty() {
                return Err("unbound aircraft visual alias".into());
            }
            if detached.contains(source) {
                detached.insert(id.clone());
            }
            if carrier_gone.contains(source) {
                carrier_gone.insert(id.clone());
            }
        }
    }
    if !view.decoys.iter().all(|d|d.valid()){return Err("invalid accepted countermeasure visual".into());}
    let stores = project_visual_stores(&view.stores, &carrier_gone, &store_length)?;
    Ok(PublicAirPose {
        unit: view.unit,
        aircraft: view.aircraft.clone(),
        team: view.team,
        alive: view.alive,
        pos: view.pos,
        quaternion: s[3..7].try_into().unwrap(),
        speed: s[13],
        ground_speed: s[75],
        agl: s[35],
        sample_time: s[23],
        pitch_surface: s[24],
        roll_surface: s[25],
        yaw_surface: s[26],
        gear: s[33],
        gear_failed: view.airframe_limits.gear_failed,
        flap: s[34],
        airbrake: view.aero[23],
        gear_axes: view.aero[36..40].try_into().unwrap(),
        slat: ((s[15] - 0.07) / 0.14).clamp(0.0, 1.0),
        detached_parts: detached.into_iter().collect(),
        stores,
        decoys: view.decoys.clone(),
    })
}

fn project_visual_stores(
    stores: &[Value],
    carrier_gone: &BTreeSet<String>,
    store_length: &impl Fn(&str) -> Option<f64>,
) -> Result<Vec<PublicVisualStore>, String> {
    fn source(v: Option<&Value>) -> Result<Option<PublicSourceGeometry>, String> {
        let Some(v) = v.filter(|v| !v.is_null()) else {
            return Ok(None);
        };
        let id = v
            .get("id")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .ok_or("invalid source store/mount geometry ID")?;
        let parts = v
            .get("sourceParts")
            .and_then(Value::as_array)
            .ok_or("source store/mount part IDs missing")?;
        let source_parts = parts
            .iter()
            .map(|p| {
                p.as_str()
                    .filter(|s| !s.is_empty())
                    .map(str::to_owned)
                    .ok_or("invalid source store/mount part ID")
            })
            .collect::<Result<Vec<_>, _>>()?;
        if source_parts.is_empty()
            || source_parts.len() > 4096
            || source_parts.iter().collect::<BTreeSet<_>>().len() != source_parts.len()
        {
            return Err("invalid source store/mount part IDs".into());
        }
        Ok(Some(PublicSourceGeometry {
            id: id.into(),
            source_parts,
        }))
    }
    stores
        .iter()
        .enumerate()
        .map(|(index, s)| {
            let id = s
                .get("id")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .ok_or("invalid visible store type")?;
            let station = s
                .get("station")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .ok_or("invalid visible store station")?;
            let owner = s
                .get("owner")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .ok_or("invalid visible store carrier")?;
            let p: [f64; 3] = serde_json::from_value(
                s.get("p")
                    .cloned()
                    .ok_or("visible store position missing")?,
            )
            .map_err(|_| "invalid visible store position")?;
            let gone = s
                .get("gone")
                .and_then(Value::as_bool)
                .ok_or("visible store absence missing")?;
            let pylon = match s.get("pylon") {
                None | Some(Value::Null) => None,
                Some(v) => Some(
                    serde_json::from_value::<[[f64; 3]; 2]>(v.clone())
                        .map_err(|_| "invalid visible pylon geometry")?,
                ),
            };
            let rack = match s.get("rack") {
                None | Some(Value::Null) => None,
                Some(v) => {
                    let id = v
                        .get("id")
                        .and_then(Value::as_str)
                        .filter(|s| !s.is_empty())
                        .ok_or("invalid visible rack ID")?;
                    let origin: [f64; 3] = serde_json::from_value(
                        v.get("origin")
                            .cloned()
                            .ok_or("visible rack origin missing")?,
                    )
                    .map_err(|_| "invalid visible rack origin")?;
                    if !finite(origin) {
                        return Err("nonfinite visible rack origin".into());
                    }
                    Some(PublicRack {
                        id: id.into(),
                        origin,
                    })
                }
            };
            if !finite(p)
                || pylon
                    .as_ref()
                    .is_some_and(|p| !finite(p.iter().flatten().copied()))
            {
                return Err("nonfinite visible store geometry".into());
            }
            let mount_present = owner == "body" || !carrier_gone.contains(owner);
            let present = !gone && mount_present;
            let source_mount = source(s.get("sourceMount"))?;
            let fitted_mount_key = match s.get("fittedMountKey") {
                None | Some(Value::Null) => None,
                Some(Value::String(key)) if !key.is_empty() => Some(key.clone()),
                _ => return Err("invalid fitted mount key".into()),
            };
            if !present
                && (!mount_present || pylon.is_none() && rack.is_none() && source_mount.is_none() && fitted_mount_key.is_none())
            {
                return Ok(None);
            }
            let pylon_length = if pylon.is_some() {
                let length = store_length(id)
                    .filter(|v| v.is_finite() && *v > 0.0)
                    .ok_or("generic pylon needs its static source store length")?;
                Some((length * 0.55).min(1.4))
            } else {
                None
            };
            Ok(Some(PublicVisualStore {
                weapon_instance: format!("store:{index}"),
                id: present.then(|| id.into()),
                station: station.into(),
                p: present.then_some(p),
                owner: owner.into(),
                present,
                mount_present,
                pylon,
                pylon_length,
                rack,
                source_store: if present {
                    source(s.get("sourceStore"))?
                } else {
                    None
                },
                source_mount,
                fitted_mount_key,
            }))
        })
        .collect::<Result<Vec<_>, String>>()
        .map(|items| items.into_iter().flatten().collect())
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct TeamPerceptionView {
    pub team: Team,
    /// Upper layer may publish full accepted state for these friendlies only.
    pub friendlies: Vec<UnitRef>,
    /// Means last SCAN saw the unit, not permission to publish its current truth.
    pub visible_enemies: Vec<UnitRef>,
    pub contacts: Vec<Contact>,
    pub visible_ground: Vec<PublicGroundPose>,
    pub visible_aircrafts: Vec<PublicAirPose>,
}
impl TeamPerceptionView {
    pub fn empty(team: Team) -> Self {
        Self {
            team,
            friendlies: Vec::new(),
            visible_enemies: Vec::new(),
            contacts: Vec::new(),
            visible_ground: Vec::new(),
            visible_aircrafts: Vec::new(),
        }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct PerceptionFrame {
    pub battle: u64,
    pub tick: u64,
    pub at: f64,
    pub scanned: bool,
    pub teams: [TeamPerceptionView; 2],
}
impl PerceptionFrame {
    pub fn team(&self, team: Team) -> &TeamPerceptionView {
        &self.teams[team_index(team)]
    }
}

pub struct PerceptionWorld {
    battle: u64,
    config: PerceptionConfig,
    next_scan: Option<f64>,
    contacts: [BTreeMap<UnitRef, Contact>; 2],
    actors: BTreeMap<UnitRef, PerceptionActor>,
    frame: Option<PerceptionFrame>,
    poses_committed: bool,
}
impl PerceptionWorld {
    pub fn new(battle: u64, config: PerceptionConfig) -> Result<Self, String> {
        let r = config.optical;
        if battle == 0
            || !finite([
                config.scan_period_s,
                config.last_known_s,
                r.ground_to_ground,
                r.ground_to_air,
                r.air_to_ground,
                r.air_to_air,
            ])
            || config.scan_period_s <= 0.0
            || config.last_known_s < config.scan_period_s
            || [
                r.ground_to_ground,
                r.ground_to_air,
                r.air_to_ground,
                r.air_to_air,
            ]
            .iter()
            .any(|v| *v < 0.0 || !(v * v).is_finite())
        {
            return Err("invalid perception game tuning/battle".into());
        }
        Ok(Self {
            battle,
            config,
            next_scan: None,
            contacts: std::array::from_fn(|_| BTreeMap::new()),
            actors: BTreeMap::new(),
            frame: None,
            poses_committed: false,
        })
    }
    pub fn frame(&self) -> Option<&PerceptionFrame> {
        self.frame.as_ref()
    }
    pub fn config(&self) -> PerceptionConfig {
        self.config
    }

    /// The callback MUST query accepted native terrain/vehicle LOS. Its two
    /// actors supply exact sample positions and target kind; choose real sensor
    /// eye/visible-locus offsets there, not via clients or this optical tuning.
    /// Stable nearest-sensor ordering avoids unnecessary LOS calls; no invisible
    /// actor's current position ever enters the returned contact/pose caches.
    pub fn advance(
        &mut self,
        tick: u64,
        at: f64,
        actors: &[PerceptionActor],
        mut los: impl FnMut(&PerceptionActor, &PerceptionActor) -> bool,
    ) -> Result<PerceptionFrame, String> {
        if !at.is_finite()
            || at < 0.0
            || self
                .frame
                .as_ref()
                .is_some_and(|f| tick <= f.tick || at < f.at)
        {
            return Err("stale/nonfinite perception clock".into());
        }
        let accepted = validate_actors(self.battle, actors)?;
        for (reference, actor) in &accepted {
            if self
                .actors
                .get(reference)
                .is_some_and(|old| old.team != actor.team || old.kind != actor.kind)
            {
                return Err("team/kind changed within one accepted unit life".into());
            }
        }
        let scanned = self.next_scan.is_none_or(|next| at + 1e-9 >= next);
        let old = self.frame.as_ref();
        for team in [Team::Blue, Team::Red] {
            let index = team_index(team);
            let memory = &mut self.contacts[index];
            memory.retain(|_, c| at - c.last_seen_at < self.config.last_known_s);
            let has_sensor = accepted.values().any(|a| a.team == team && a.alive);
            if scanned || !has_sensor {
                for c in memory.values_mut() {
                    c.status = ContactStatus::LastKnown;
                }
            }
            if scanned && has_sensor {
                for target in accepted.values().filter(|a| a.team != team) {
                    if witnessed(&accepted, team, target, self.config.optical, &mut los) {
                        memory.insert(
                            target.unit,
                            Contact {
                                unit: target.unit,
                                team: target.team,
                                kind: target.kind,
                                pos: target.pos,
                                observed_alive: target.alive,
                                last_seen_tick: tick,
                                last_seen_at: at,
                                status: ContactStatus::Detected,
                            },
                        );
                    }
                }
            }
        }
        let teams = std::array::from_fn(|index| {
            let team = if index == 0 { Team::Blue } else { Team::Red };
            let contacts = self.contacts[index].values().cloned().collect::<Vec<_>>();
            let visible_enemies = contacts
                .iter()
                .filter(|c| c.status == ContactStatus::Detected)
                .map(|c| c.unit)
                .collect::<Vec<_>>();
            let (ground, air) = if scanned {
                (Vec::new(), Vec::new())
            } else if let Some(old) = old {
                (
                    old.teams[index]
                        .visible_ground
                        .iter()
                        .filter(|p| visible_enemies.contains(&p.unit))
                        .cloned()
                        .collect(),
                    old.teams[index]
                        .visible_aircrafts
                        .iter()
                        .filter(|p| visible_enemies.contains(&p.unit))
                        .cloned()
                        .collect(),
                )
            } else {
                (Vec::new(), Vec::new())
            };
            TeamPerceptionView {
                team,
                friendlies: accepted
                    .values()
                    .filter(|a| a.team == team)
                    .map(|a| a.unit)
                    .collect(),
                visible_enemies,
                contacts,
                visible_ground: ground,
                visible_aircrafts: air,
            }
        });
        if scanned {
            self.next_scan = Some(at + self.config.scan_period_s);
        }
        self.actors = accepted;
        self.poses_committed = !scanned;
        let frame = PerceptionFrame {
            battle: self.battle,
            tick,
            at,
            scanned,
            teams,
        };
        self.frame = Some(frame.clone());
        Ok(frame)
    }

    /// Atomically bind same-scan projections. Never call on 20Hz no-scan ticks:
    /// that would continuously disclose live truth after a single detection.
    /// Missing/mismatched/life-stale sources fail without partial publication.
    pub fn cache_public_poses(
        &mut self,
        tick: u64,
        ground: &[PublicGroundPose],
        air: &[PublicAirPose],
    ) -> Result<PerceptionFrame, String> {
        let frame = self.frame.as_ref().ok_or("no accepted perception scan")?;
        if frame.tick != tick || !frame.scanned || self.poses_committed {
            return Err("public poses require an uncommitted same-tick scan".into());
        }
        let mut sources = BTreeMap::new();
        for pose in ground {
            validate_ground(pose)?;
            if sources
                .insert(
                    pose.unit,
                    (ActorKind::Ground, pose.team, pose.alive, pose.pos),
                )
                .is_some()
            {
                return Err("duplicate public pose identity".into());
            }
        }
        for pose in air {
            validate_air(pose)?;
            if sources
                .insert(pose.unit, (ActorKind::Air, pose.team, pose.alive, pose.pos))
                .is_some()
            {
                return Err("duplicate public pose identity".into());
            }
        }
        let required = frame
            .teams
            .iter()
            .flat_map(|t| t.visible_enemies.iter().copied())
            .collect::<BTreeSet<_>>();
        for reference in required {
            let source = sources
                .get(&reference)
                .ok_or("missing detected public pose")?;
            let actor = self
                .actors
                .get(&reference)
                .ok_or("detected actor missing")?;
            if *source != (actor.kind, actor.team, actor.alive, actor.pos) {
                return Err("public pose does not match accepted scan/life".into());
            }
        }
        // Even non-disclosed inputs must belong to this accepted world; stale
        // extra sources must not become a future accidental cache entry.
        for (reference, source) in &sources {
            let actor = self
                .actors
                .get(reference)
                .ok_or("public pose from another world/life")?;
            if *source != (actor.kind, actor.team, actor.alive, actor.pos) {
                return Err("public pose does not match accepted actor".into());
            }
        }
        let mut result = frame.clone();
        for team in &mut result.teams {
            team.visible_ground = ground
                .iter()
                .filter(|p| team.visible_enemies.contains(&p.unit))
                .cloned()
                .collect();
            team.visible_ground.sort_by_key(|p| p.unit);
            team.visible_aircrafts = air
                .iter()
                .filter(|p| team.visible_enemies.contains(&p.unit))
                .cloned()
                .collect();
            team.visible_aircrafts.sort_by_key(|p| p.unit);
        }
        self.poses_committed = true;
        self.frame = Some(result.clone());
        Ok(result)
    }

    /// Spatial effects get a separate CURRENT native LOS check, not permission
    /// from a possibly 0.25s-old optical sample. Own/allied muzzle shots remain
    /// audible/visible regardless of observers; hidden remote impacts/deaths do
    /// not leak through the fact that a friendly fired the projectile.
    pub fn project_event(
        &self,
        event: &EventCandidate,
        mut los: impl FnMut(&PerceptionActor, &PerceptionActor) -> bool,
    ) -> Result<[Option<PublicEvent>; 2], String> {
        let frame = self.frame.as_ref().ok_or("no accepted perception frame")?;
        if event.tick != frame.tick || !finite(event.pos) {
            return Err("stale/nonfinite perception event".into());
        }
        for reference in [event.shooter, event.target].into_iter().flatten() {
            validate_ref(reference, self.battle)?;
        }
        let shot = event.shot.as_ref();
        if shot.is_some_and(|s| {
            !finite(s.velocity) || s.caliber_mm.is_some_and(|c| !c.is_finite() || c <= 0.0)
        }) {
            return Err("invalid public shot effect".into());
        }
        let subject = PerceptionActor {
            unit: (if event.kind == PublicEventKind::Shot {
                event.shooter
            } else {
                event.target
            })
            .unwrap_or(UnitRef {
                battle: self.battle,
                unit: u64::MAX,
                life: 1,
            }),
            team: Team::Blue,
            kind: event.kind_hint,
            alive: false,
            pos: event.pos,
            event_locus: true,
        };
        Ok(std::array::from_fn(|index| {
            let team = if index == 0 { Team::Blue } else { Team::Red };
            let friendly = |r: Option<UnitRef>| {
                r.and_then(|r| self.actors.get(&r))
                    .is_some_and(|a| a.team == team)
            };
            let own_shot = event.kind == PublicEventKind::Shot && friendly(event.shooter);
            let own_victim = matches!(
                event.kind,
                PublicEventKind::Impact | PublicEventKind::Destroyed
            ) && friendly(event.target);
            if !own_shot
                && !own_victim
                && !witnessed(&self.actors, team, &subject, self.config.optical, &mut los)
            {
                return None;
            }
            let mut identity = |reference: Option<UnitRef>| {
                reference.filter(|r| {
                    self.actors.get(r).is_some_and(|a| {
                        a.team == team
                            || witnessed(&self.actors, team, a, self.config.optical, &mut los)
                    })
                })
            };
            let shooter = identity(event.shooter);
            let target = identity(event.target);
            Some(PublicEvent {
                kind: event.kind,
                tick: event.tick,
                pos: event.pos,
                shooter,
                target,
                // Incoming direction/weapon metadata can reveal a hidden firing
                // position. Only publish shot effects when its shooter is known.
                shot: if event.kind == PublicEventKind::Shot && shooter.is_some() {
                    shot.cloned()
                } else {
                    None
                },
            })
        }))
    }
}

fn validate_actors(
    battle: u64,
    actors: &[PerceptionActor],
) -> Result<BTreeMap<UnitRef, PerceptionActor>, String> {
    let mut result = BTreeMap::new();
    let mut slots = BTreeSet::new();
    for actor in actors {
        validate_ref(actor.unit, battle)?;
        if actor.event_locus
            || !finite(actor.pos)
            || !slots.insert(actor.unit.unit)
            || result.insert(actor.unit, *actor).is_some()
        {
            return Err("invalid/duplicate accepted perception actor".into());
        }
    }
    Ok(result)
}
fn witnessed(
    actors: &BTreeMap<UnitRef, PerceptionActor>,
    team: Team,
    target: &PerceptionActor,
    ranges: OpticalRanges,
    los: &mut impl FnMut(&PerceptionActor, &PerceptionActor) -> bool,
) -> bool {
    let mut sensors = actors
        .values()
        .filter(|s| s.team == team && s.alive)
        .filter_map(|s| {
            let d = s
                .pos
                .iter()
                .zip(target.pos)
                .map(|(a, b)| (a - b).powi(2))
                .sum::<f64>();
            let r = ranges.range(s.kind, target.kind);
            (r > 0.0 && d.is_finite() && d <= r * r).then_some((d, s))
        })
        .collect::<Vec<_>>();
    sensors.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.unit.cmp(&b.1.unit)));
    sensors.into_iter().any(|(_, sensor)| los(sensor, target))
}
fn validate_ground(p: &PublicGroundPose) -> Result<(), String> {
    validate_ref(p.unit, p.unit.battle)?;
    let conversion = p
        .campaign_conversion
        .as_ref()
        .map(serde_json::to_value)
        .transpose()
        .map_err(|_| "invalid public conversion")?;
    project_conversion(&p.role, &p.vehicle, conversion.as_ref())?;
    if p.vehicle.is_empty()
        || !finite(p.pos.into_iter().chain([p.yaw, p.turret_yaw, p.gun_pitch]))
        || !finite(
            p.net
                .pos
                .into_iter()
                .chain(p.net.ex)
                .chain(p.net.ez)
                .chain(p.net.v)
                .chain(p.net.w)
                .chain(p.net.track)
                .map(f64::from),
        )
    {
        return Err("invalid public ground pose".into());
    }
    if p.net.rg.as_ref().is_some_and(|r| {
        r.version != 1
            || r.q.len() != r.qv.len()
            || r.q.len() > 4096
            || !finite(r.q.iter().chain(&r.qv).copied())
    }) {
        return Err("invalid public running gear".into());
    }
    Ok(())
}
fn validate_air(p: &PublicAirPose) -> Result<(), String> {
    validate_ref(p.unit, p.unit.battle)?;
    if p.aircraft.is_empty()
        || !finite(p.pos)
        || !finite(
            p.quaternion
                .into_iter()
                .chain([
                    p.speed,
                    p.ground_speed,
                    p.agl,
                    p.sample_time,
                    p.pitch_surface,
                    p.roll_surface,
                    p.yaw_surface,
                    p.gear,
                    p.flap,
                    p.airbrake,
                    p.slat,
                ])
                .chain(p.gear_axes)
                .map(f64::from),
        )
        || p.quaternion
            .iter()
            .map(|v| (*v as f64).powi(2))
            .sum::<f64>()
            < 1e-12
        || p.detached_parts.iter().any(String::is_empty)
        || p.detached_parts.iter().collect::<BTreeSet<_>>().len() != p.detached_parts.len()
        || p.decoys.iter().any(|d|!d.valid())
        || p.decoys.iter().map(|d|d.id).collect::<BTreeSet<_>>().len()!=p.decoys.len()
    {
        return Err("invalid public aircraft pose".into());
    }
    let mut instances = BTreeSet::new();
    for store in &p.stores {
        if store.station.is_empty()
            || store.owner.is_empty()
            || !store.weapon_instance.starts_with("store:")
            || !instances.insert(&store.weapon_instance)
            || store.present != (store.id.is_some() && store.p.is_some())
            || store.id.as_ref().is_some_and(String::is_empty)
            || store.fitted_mount_key.as_ref().is_some_and(String::is_empty)
            || store.p.is_some_and(|p| !finite(p))
            || store.present && !store.mount_present
            || !store.present
                && (store.id.is_some() || store.p.is_some() || store.source_store.is_some())
            || store
                .pylon
                .as_ref()
                .is_some_and(|p| !finite(p.iter().flatten().copied()))
            || store.pylon.is_some() != store.pylon_length.is_some()
            || store
                .pylon_length
                .is_some_and(|l| !l.is_finite() || l <= 0.0 || l > 1.4)
            || store
                .rack
                .as_ref()
                .is_some_and(|r| r.id.is_empty() || !finite(r.origin))
        {
            return Err("invalid public external store appearance".into());
        }
        for source in [&store.source_store, &store.source_mount]
            .into_iter()
            .flatten()
        {
            if source.id.is_empty()
                || source.source_parts.is_empty()
                || source.source_parts.len() > 4096
                || source.source_parts.iter().any(String::is_empty)
                || source.source_parts.iter().collect::<BTreeSet<_>>().len()
                    != source.source_parts.len()
            {
                return Err("invalid public source attachment binding".into());
            }
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PublicEventKind {
    Shot,
    Impact,
    TerrainImpact,
    Explosion,
    Destroyed,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublicShotEffect {
    pub shot_id: u64,
    pub velocity: [f64; 3],
    pub caliber_mm: Option<f64>,
    pub airborne: bool,
    pub store: bool,
    pub weapon_instance: Option<String>,
}
/// Deliberately no arbitrary `detail` or raw combat report field.
pub struct EventCandidate {
    pub kind: PublicEventKind,
    pub kind_hint: ActorKind,
    pub tick: u64,
    pub pos: [f64; 3],
    pub shooter: Option<UnitRef>,
    pub target: Option<UnitRef>,
    pub shot: Option<PublicShotEffect>,
}
impl EventCandidate {
    /// Consume Room::event's already life-scoped native event. Unknown/nonspatial
    /// event kinds return None and need a separate friendly/strategic policy.
    /// Extra native detail is discarded, never flattened into PublicEvent.
    pub fn from_native(
        tick: u64,
        kind_hint: ActorKind,
        value: &Value,
    ) -> Result<Option<Self>, String> {
        let kind = match value.get("kind").and_then(Value::as_str) {
            Some("shot") => PublicEventKind::Shot,
            Some("impact") | Some("facility_impact") => PublicEventKind::Impact,
            Some("terrain_impact") => PublicEventKind::TerrainImpact,
            Some("explosion") => PublicEventKind::Explosion,
            Some("destroyed") => PublicEventKind::Destroyed,
            _ => return Ok(None),
        };
        let pos: [f64; 3] =
            serde_json::from_value(value.get("pos").cloned().ok_or("event position missing")?)
                .map_err(|_| "invalid event position")?;
        let reference = |key: &str| -> Result<Option<UnitRef>, String> {
            match value.get(key) {
                None | Some(Value::Null) => Ok(None),
                Some(v) => serde_json::from_value(v.clone())
                    .map(Some)
                    .map_err(|_| "event requires complete UnitRef".into()),
            }
        };
        let shot = if kind == PublicEventKind::Shot {
            let detail = value.get("detail").ok_or("native shot detail missing")?;
            let velocity = serde_json::from_value(
                detail
                    .get("velocity")
                    .cloned()
                    .ok_or("native shot velocity missing")?,
            )
            .map_err(|_| "invalid native shot velocity")?;
            let caliber_mm = match detail.get("caliber_mm") {
                None | Some(Value::Null) => None,
                Some(c) => Some(c.as_f64().ok_or("invalid native shot caliber")?),
            };
            Some(PublicShotEffect {
                shot_id: detail
                    .get("shot_id")
                    .and_then(Value::as_u64)
                    .ok_or("native shot identity missing")?,
                velocity,
                caliber_mm,
                airborne: detail
                    .get("airborne")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                store: detail
                    .get("store")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                weapon_instance: detail
                    .get("weapon_instance")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            })
        } else {
            None
        };
        Ok(Some(Self {
            kind,
            kind_hint,
            tick,
            pos,
            shooter: reference("shooter")?,
            target: reference("target")?,
            shot,
        }))
    }
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct PublicEvent {
    pub kind: PublicEventKind,
    pub tick: u64,
    pub pos: [f64; 3],
    pub shooter: Option<UnitRef>,
    pub target: Option<UnitRef>,
    /// Existing effect consumers can read `detail`, but it has this fixed public
    /// schema rather than the native hit/module/ammo report.
    #[serde(rename = "detail", skip_serializing_if = "Option::is_none")]
    pub shot: Option<PublicShotEffect>,
}

#[cfg(test)]
#[path = "frontline_perception_tests.rs"]
mod tests;
