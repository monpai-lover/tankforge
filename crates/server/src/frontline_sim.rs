//! Native ground adapter for the combined scenario. Each world unit owns an independent
//! six-DOF tracked plant, native module/crew damage and mounted ammunition ledger.
//! Vehicle contacts deliberately retain the existing plate/box combat model; this is not
//! a claim of a visible-triangle migration. The host owns identity/epochs and era policy.
use crate::ammo::{AmmoCatalog, AmmoLedger, AmmoMix, AmmoScope};
use crate::frontline::UnitRef;
use crate::frontline_facilities::{
    FacilityEvent, FacilityGeometry, FacilityImpact, FacilityJobKind, FacilityJobView,
    FacilityKind, FacilityView, FacilityWorker, FacilityWorld, RunwayClosedRegion,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Instant;
use std::{collections::BTreeMap, path::Path, sync::Arc};
use tg_combat::{Target, TargetState};
use tg_physics::{
    tank::{self, obstacle::Obstacle, terrain::Ground, Tank, TankModel, TankOpts},
    TerrainDef,
};
use tg_shared::{Rng, Vec3};
use tg_vehicle::LoadedVehicle;
use tg_weapon::{
    fire::{self, GunState},
    turret::{self, TurretState},
    GunDef, ProjectileDef,
};

pub const FIXED_DT: f64 = 1.0 / 120.0;
const MAIN: &str = "gun:0:0";
pub(crate) fn native_timing_enabled() -> bool {
    std::env::var_os("TANKFORGE_NATIVE_TIMING").is_some_and(|v| v == "1")
        || std::env::var_os("TF_FRONTLINE_PROFILE").is_some_and(|v| v == "1")
}
#[derive(Clone, Copy, Debug, Default, Serialize)]
pub struct SimTimings {
    pub fixed_steps: u64,
    pub air_ns: u64,
    pub ground_ns: u64,
    pub tank_physics_ns: u64,
    pub tank_detail: tank::TankStepTimings,
    pub contact_prep_ns: u64,
    pub ground_combat_ns: u64,
    pub projectile_ns: u64,
    /// Last actual worker count; never a replicated simulation setting.
    pub unit_workers: u64,
    pub parallel_fixed_steps: u64,
    /// Critical-path wall time including worker scheduling and ordered joins.
    pub unit_phase_wall_ns: u64,
    /// Sum of per-unit elapsed intervals across workers (not OS CPU time).
    /// tank_detail and per-unit phase counters likewise overlap in wall time.
    pub summed_unit_elapsed_ns: u64,
}
impl SimTimings {
    fn add_unit_timings(&mut self, other: &Self) {
        self.tank_physics_ns += other.tank_physics_ns;
        self.contact_prep_ns += other.contact_prep_ns;
        self.ground_combat_ns += other.ground_combat_ns;
        self.summed_unit_elapsed_ns += other.summed_unit_elapsed_ns;
        macro_rules! add_detail {
            ($($field:ident),+ $(,)?) => {$(self.tank_detail.$field += other.tank_detail.$field;)+};
        }
        add_detail!(
            calls,
            substeps,
            sample_ground_ns,
            obstacles_ns,
            inertia_suspension_ns,
            rigid_contacts_ns,
            powertrain_ns,
            friction_prepare_ns,
            friction_solve_ns,
            integrate_pose_ns,
            report_ns
        );
    }
}

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize)]
pub struct SimInput {
    pub throttle: f32,
    pub steer: f32,
    pub brake: f32,
    #[serde(default)]
    pub turret_yaw: Option<f64>,
    #[serde(default)]
    pub gun_pitch: Option<f64>,
}
#[derive(Clone, Debug, Serialize)]
pub struct SimSnapshot {
    pub id: u64,
    pub vehicle: String,
    pub team: u8,
    pub pos: [f64; 3],
    pub heading: f64,
    pub pitch: f64,
    pub roll: f64,
    pub velocity: [f64; 3],
    pub turret_yaw: f64,
    pub gun_pitch: f64,
    pub alive: bool,
    pub caps: Value,
    pub damage: Value,
    /// Remaining primary gun:0:0 rounds across its mounted ammunition types.
    /// Other mounted guns stay visible in ammo_counts and native rack accounting.
    pub ammo: u32,
    pub ammo_counts: AmmoMix,
    pub ammo_revision: u64,
    pub reload_s: f64,
    pub net: Value,
}
/// Accepted native kinematics for fixed-step AI/contact queries. Networking,
/// damage presentation and ammunition serialization stay at their existing rate.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct SimKinematics {
    pub id: u64,
    pub team: u8,
    pub alive: bool,
    pub pos: [f64; 3],
    pub velocity: [f64; 3],
}
/// Read-only accepted air bodies for ground crews. This is not a sensor report;
/// the room must apply its team discovery/line-of-sight policy before aiming.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AirTarget {
    pub unit: UnitRef,
    pub team: u8,
    pub alive: bool,
    pub pos: [f64; 3],
    pub velocity: [f64; 3],
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum GroundCombatRole {
    AirDefense,
    FireSupport,
}
/// The vehicle and weapon remain exactly their source identities. Role ranges
/// are campaign engagement tuning, not a claim of radar or historical accuracy.
#[derive(Clone, Debug, Serialize)]
pub struct GroundRoleOption {
    pub vehicle: String,
    pub role: GroundCombatRole,
    pub year: u32,
    pub source_class: String,
    pub prototype: bool,
    pub air_range_m: f64,
    pub ground_range_m: f64,
}
#[derive(Clone, Debug, Serialize)]
pub struct SimEvent {
    pub kind: String,
    pub shooter: Option<u64>,
    pub target: Option<u64>,
    pub pos: [f64; 3],
    pub detail: Value,
}

/// Pixel centres: row-major increasing +z. The Korean source uses north=-z.
#[derive(Clone, Debug, Deserialize)]
pub struct HeightGrid {
    pub width: usize,
    pub height: usize,
    #[serde(rename = "cellX")]
    pub cell_x: f64,
    #[serde(rename = "cellZ")]
    pub cell_z: f64,
    pub x0: f64,
    pub z0: f64,
    pub heights: Vec<f64>,
}
impl HeightGrid {
    fn valid(&self) -> bool {
        self.width >= 2
            && self.height >= 2
            && self.width.checked_mul(self.height) == Some(self.heights.len())
            && [self.cell_x, self.cell_z]
                .iter()
                .all(|v| v.is_finite() && *v > 0.0)
            && [self.x0, self.z0].iter().all(|v| v.is_finite())
            && self.heights.iter().all(|v| v.is_finite())
    }
    pub fn sample(&self, x: f64, z: f64) -> f64 {
        let u = ((x - self.x0) / self.cell_x).clamp(0.0, (self.width - 1) as f64);
        let v = ((z - self.z0) / self.cell_z).clamp(0.0, (self.height - 1) as f64);
        let i = (u.floor() as usize).min(self.width - 2);
        let j = (v.floor() as usize).min(self.height - 2);
        let a = u - i as f64;
        let b = v - j as f64;
        let at = |i: usize, j: usize| self.heights[j * self.width + i];
        (at(i, j) * (1.0 - a) + at(i + 1, j) * a) * (1.0 - b)
            + (at(i, j + 1) * (1.0 - a) + at(i + 1, j + 1) * a) * b
    }
}
#[derive(Clone, Debug)]
pub struct MapGround {
    pub grid: HeightGrid,
    /// Registered road corridors use the source road friction coefficients.
    /// The dry/deck policy restricts this non-amphibious native slice; it does
    /// not certify off-road soil or implement hydrodynamic buoyancy.
    surface: TerrainDef,
    /// Canonical source JSON is also served to the client.
    pub terrain: Value,
    patches: Vec<(HeightGrid, f64)>,
    pads: Vec<GroundPad>,
    runways: Vec<RunwayPad>,
    roadbeds: Option<Arc<Roadbeds>>,
    policy: Option<Arc<GroundPolicy>>,
    /// Room-owned mutable deck state. MapGround clones used by that room's
    /// aircraft share it; immutable global source-policy caches never own it.
    bridge_states: Arc<DynamicBridges>,
    runway_sources: BTreeMap<String, crate::flight_runtime::LandingArea>,
    /// Campaign local service area derived from an enabled source runway.
    /// It grants no road connection to the distant ground front, and retains
    /// the canonical terrain height and full-theatre water exclusions.
    airport_support: BTreeMap<String, (u8, crate::flight_runtime::LandingArea)>,
    runway_closures: Arc<std::sync::RwLock<Vec<RunwayClosedRegion>>>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub(crate) struct BridgeStateView {
    pub id: String,
    pub destroyed: bool,
    pub revision: u64,
}

#[derive(Debug)]
struct DynamicBridges {
    ids: BTreeMap<String, usize>,
    /// One atomic commits revision and destroyed together. Initial revision1.
    words: Vec<AtomicU64>,
    /// Monotonic fast gate, published BEFORE any mutation. Never clearing this
    /// avoids a race where a reader could overlook an already destroyed deck.
    changed: AtomicBool,
    battle: AtomicU64,
}
impl DynamicBridges {
    fn new(ids: impl IntoIterator<Item = String>) -> Self {
        let ids: BTreeMap<_, _> = ids.into_iter().enumerate().map(|(i, id)| (id, i)).collect();
        Self {
            words: (0..ids.len()).map(|_| AtomicU64::new(2)).collect(),
            ids,
            changed: AtomicBool::new(false),
            battle: AtomicU64::new(0),
        }
    }
    fn independent(&self) -> Self {
        Self {
            ids: self.ids.clone(),
            words: self
                .words
                .iter()
                .map(|w| AtomicU64::new(w.load(Ordering::Acquire)))
                .collect(),
            changed: AtomicBool::new(self.changed.load(Ordering::Acquire)),
            battle: AtomicU64::new(self.battle.load(Ordering::Acquire)),
        }
    }
    fn intact(&self, index: usize) -> bool {
        self.words
            .get(index)
            .is_none_or(|w| w.load(Ordering::Acquire) & 1 == 0)
    }
    fn view(&self, id: &str) -> Option<BridgeStateView> {
        let word = self.words[*self.ids.get(id)?].load(Ordering::Acquire);
        Some(BridgeStateView {
            id: id.into(),
            destroyed: word & 1 != 0,
            revision: word >> 1,
        })
    }
    fn set(
        &self,
        id: &str,
        expected_revision: u64,
        destroyed: bool,
    ) -> Result<BridgeStateView, String> {
        let index = *self.ids.get(id).ok_or("unknown registered bridge")?;
        let cell = &self.words[index];
        let old = cell.load(Ordering::Acquire);
        if old >> 1 != expected_revision {
            return Err("stale bridge revision".into());
        }
        let revision = expected_revision
            .checked_add(1)
            .filter(|r| *r <= u64::MAX >> 1)
            .ok_or("bridge revision exhausted")?;
        self.changed.store(true, Ordering::Release);
        let next = (revision << 1) | u64::from(destroyed);
        cell.compare_exchange(old, next, Ordering::AcqRel, Ordering::Acquire)
            .map_err(|_| "stale bridge revision")?;
        Ok(BridgeStateView {
            id: id.into(),
            destroyed,
            revision,
        })
    }
}
#[derive(Clone, Debug, Deserialize)]
struct Roadbeds {
    #[serde(rename = "cellSize")]
    cell_size: f64,
    segments: Vec<[f64; 8]>,
    cells: BTreeMap<String, Vec<usize>>,
    #[serde(skip)]
    index: BTreeMap<(i64, i64), Vec<usize>>,
    #[serde(skip)]
    fine_index: BTreeMap<(i64, i64), Vec<usize>>,
    #[cfg(test)]
    #[serde(skip)]
    coarse_oracle: bool,
}
const ROADBED_FINE_CELL: f64 = 32.0;
impl Roadbeds {
    fn compile_index(&mut self) -> Result<(), String> {
        self.index = self
            .cells
            .iter()
            .map(|(key, ids)| {
                let (x, z) = key
                    .split_once(',')
                    .ok_or("Invalid native roadbed cell key")?;
                Ok((
                    (
                        x.parse::<i64>()
                            .map_err(|_| "Invalid native roadbed cell X")?,
                        z.parse::<i64>()
                            .map_err(|_| "Invalid native roadbed cell Z")?,
                    ),
                    ids.clone(),
                ))
            })
            .collect::<Result<_, String>>()?;
        // Runtime-only acceleration; the authored 256m cells and their full
        // completeness validation remain authoritative. A 32m cell may omit
        // only segments whose expanded influence AABB cannot reach it. IDs
        // are appended in the original global order, never spatially reordered.
        self.fine_index.clear();
        for (id, s) in self.segments.iter().enumerate() {
            let reach = s[6] + s[7] + 1e-6;
            let x0 = ((s[0].min(s[3]) - reach) / ROADBED_FINE_CELL).floor() as i64;
            let x1 = ((s[0].max(s[3]) + reach) / ROADBED_FINE_CELL).floor() as i64;
            let z0 = ((s[1].min(s[4]) - reach) / ROADBED_FINE_CELL).floor() as i64;
            let z1 = ((s[1].max(s[4]) + reach) / ROADBED_FINE_CELL).floor() as i64;
            for x in x0..=x1 {
                for z in z0..=z1 {
                    // Both grids share zero origin and 256/32=8. Euclidean
                    // division preserves floor semantics at negative cells.
                    if self
                        .index
                        .get(&(x.div_euclid(8), z.div_euclid(8)))
                        .is_some_and(|ids| ids.binary_search(&id).is_ok())
                    {
                        self.fine_index.entry((x, z)).or_default().push(id);
                    }
                }
            }
        }
        Ok(())
    }
    fn valid(&self) -> bool {
        if !self.cell_size.is_finite() || self.cell_size != 256.0 {
            return false;
        }
        if self.segments.iter().any(|s| {
            !s.iter().all(|v| v.is_finite())
                || (s[3] - s[0]).hypot(s[4] - s[1]) < 0.001
                || s[6] <= 0.0
                || s[7] <= 0.0
        }) {
            return false;
        }
        for ids in self.cells.values() {
            if ids.iter().any(|i| *i >= self.segments.len()) || ids.windows(2).any(|p| p[0] >= p[1])
            {
                return false;
            }
        }
        // Reject incomplete acceleration data rather than silently sample a different road surface.
        for (i, s) in self.segments.iter().enumerate() {
            let r = s[6] + s[7];
            let x0 = ((s[0].min(s[3]) - r) / self.cell_size).floor() as i64;
            let x1 = ((s[0].max(s[3]) + r) / self.cell_size).floor() as i64;
            let z0 = ((s[1].min(s[4]) - r) / self.cell_size).floor() as i64;
            let z1 = ((s[1].max(s[4]) + r) / self.cell_size).floor() as i64;
            if x1 - x0 > 1024 || z1 - z0 > 1024 {
                return false;
            }
            for x in x0..=x1 {
                for z in z0..=z1 {
                    if !self
                        .cells
                        .get(&format!("{x},{z}"))
                        .is_some_and(|v| v.binary_search(&i).is_ok())
                    {
                        return false;
                    }
                }
            }
        }
        true
    }
    fn candidates(&self, x: f64, z: f64) -> &[usize] {
        #[cfg(test)]
        if self.coarse_oracle {
            return self.coarse_candidates(x, z);
        }
        self.fine_index
            .get(&(
                (x / ROADBED_FINE_CELL).floor() as i64,
                (z / ROADBED_FINE_CELL).floor() as i64,
            ))
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }
    #[cfg(test)]
    fn coarse_candidates(&self, x: f64, z: f64) -> &[usize] {
        self.index
            .get(&(
                (x / self.cell_size).floor() as i64,
                (z / self.cell_size).floor() as i64,
            ))
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }
    fn projection(s: &[f64; 8], x: f64, z: f64) -> (f64, f64) {
        let dx = s[3] - s[0];
        let dz = s[4] - s[1];
        let t = (((x - s[0]) * dx + (z - s[1]) * dz) / (dx * dx + dz * dz)).clamp(0.0, 1.0);
        ((x - s[0] - dx * t).hypot(z - s[1] - dz * t), t)
    }
    fn sample(&self, old: f64, x: f64, z: f64) -> f64 {
        let (mut sum_w, mut sum_h, mut max_w) = (0.0f64, 0.0f64, 0.0f64);
        for &i in self.candidates(x, z) {
            let s = &self.segments[i];
            let (d, t) = Self::projection(s, x, z);
            let w = (1.0 - (d - s[6]).max(0.0) / s[7]).clamp(0.0, 1.0);
            sum_w += w;
            sum_h += w * (s[2] + t * (s[5] - s[2]));
            max_w = max_w.max(w);
        }
        if sum_w > 0.0 {
            old * (1.0 - max_w) + sum_h / sum_w * max_w
        } else {
            old
        }
    }
    fn core(&self, x: f64, z: f64) -> bool {
        self.candidates(x, z).iter().any(|&i| {
            let s = &self.segments[i];
            Self::projection(s, x, z).0 <= s[6]
        })
    }
}
#[derive(Clone, Debug, Deserialize)]
struct WaterArea {
    id: String,
    ring: Vec<[f64; 2]>,
    #[serde(default)]
    holes: Vec<Vec<[f64; 2]>>,
    level: f64,
}
#[derive(Clone, Debug, Deserialize)]
struct HydroBounds {
    #[serde(rename = "minX")]
    min_x: f64,
    #[serde(rename = "maxX")]
    max_x: f64,
    #[serde(rename = "minZ")]
    min_z: f64,
    #[serde(rename = "maxZ")]
    max_z: f64,
}
impl HydroBounds {
    fn contains(&self, x: f64, z: f64) -> bool {
        x >= self.min_x && x <= self.max_x && z >= self.min_z && z <= self.max_z
    }
    fn valid(&self) -> bool {
        [self.min_x, self.max_x, self.min_z, self.max_z]
            .iter()
            .all(|v| v.is_finite())
            && self.min_x < self.max_x
            && self.min_z < self.max_z
    }
}
#[derive(Clone, Debug, Deserialize)]
struct HydroCoverage {
    bounds: HydroBounds,
}
#[derive(Clone, Debug, Deserialize)]
struct GroundBridge {
    id: String,
    #[serde(rename = "roadbedSegments")]
    segments: Vec<usize>,
    #[serde(rename = "halfWidth")]
    half_width: f64,
    #[serde(rename = "waterAreaIds")]
    water_ids: Vec<String>,
    #[serde(default, rename = "jointGeometry")]
    joints: Option<BridgeJointGeometry>,
    authored: bool,
}
#[derive(Clone, Debug, Deserialize)]
struct BridgeJointGeometry {
    version: u32,
    source: Value,
    #[serde(rename = "sharedVertices")]
    shared: Vec<BridgeJointSource>,
    polygons: Vec<BridgeJointPolygon>,
    triangles: Vec<[f64; 6]>,
}
#[derive(Clone, Debug, Deserialize)]
struct BridgeJointSource {
    point: [f64; 2],
    #[serde(rename = "roadbedSegments")]
    segments: Vec<usize>,
}
#[derive(Clone, Debug, Deserialize)]
struct BridgeJointPolygon {
    ring: Vec<[f64; 2]>,
    #[serde(default)]
    holes: Vec<Vec<[f64; 2]>>,
}
impl BridgeJointPolygon {
    fn contains(&self, x: f64, z: f64) -> bool {
        joint_ring_relation(&self.ring, x, z) > 0
            && !self.holes.iter().any(|h| joint_ring_relation(h, x, z) == 1)
    }
}
// Exact authored polygon boundaries, with the shared renderer contract's1µm
// tolerance. This does not infer a circular/end-cap bridge surface.
fn joint_ring_relation(ring: &[[f64; 2]], x: f64, z: f64) -> u8 {
    let mut inside = false;
    for e in ring.windows(2) {
        let (a, b) = (e[0], e[1]);
        let dx = b[0] - a[0];
        let dz = b[1] - a[1];
        let square = dx * dx + dz * dz;
        if square > 0.0 {
            let t = (((x - a[0]) * dx + (z - a[1]) * dz) / square).clamp(0.0, 1.0);
            if (x - a[0] - t * dx).hypot(z - a[1] - t * dz) <= 1e-6 {
                return 2;
            }
        }
        if (a[1] > z) != (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0] {
            inside = !inside;
        }
    }
    if inside {
        1
    } else {
        0
    }
}
fn valid_bridge_joints(bridge: &GroundBridge, beds: &Roadbeds) -> bool {
    let Some(g) = &bridge.joints else {
        return true;
    };
    if g.version != 1 || g.source["kind"] != "authored_internal_deck_joint_wedges" {
        return false;
    }
    if g.polygons.is_empty() {
        return g.triangles.is_empty();
    }
    if g.shared.is_empty() || g.triangles.is_empty() {
        return false;
    }
    for source in &g.shared {
        if !source.point.iter().all(|v| v.is_finite())
            || source.segments.len() < 2
            || source.segments.windows(2).any(|v| v[0] >= v[1])
        {
            return false;
        }
        for i in &source.segments {
            if !bridge.segments.contains(i) {
                return false;
            }
            let s = &beds.segments[*i];
            if (source.point[0] - s[0]).hypot(source.point[1] - s[1]) > 1e-6
                && (source.point[0] - s[3]).hypot(source.point[1] - s[4]) > 1e-6
            {
                return false;
            }
        }
    }
    let bounded = |p: [f64; 2]| {
        p.iter().all(|v| v.is_finite())
            && g.shared
                .iter()
                .any(|s| (p[0] - s.point[0]).hypot(p[1] - s.point[1]) <= bridge.half_width + 1e-6)
    };
    let ring_area = |r: &[[f64; 2]]| {
        let o = r[0];
        r.windows(2)
            .map(|p| (p[0][0] - o[0]) * (p[1][1] - o[1]) - (p[1][0] - o[0]) * (p[0][1] - o[1]))
            .sum::<f64>()
            .abs()
            * 0.5
    };
    let mut polygon_area = 0.0;
    for p in &g.polygons {
        for r in std::iter::once(&p.ring).chain(p.holes.iter()) {
            if r.len() < 4
                || (r[0][0] - r.last().unwrap()[0]).hypot(r[0][1] - r.last().unwrap()[1]) > 1e-6
                || !r.iter().copied().all(bounded)
            {
                return false;
            }
            for e in r.windows(2) {
                if !bounded([(e[0][0] + e[1][0]) * 0.5, (e[0][1] + e[1][1]) * 0.5]) {
                    return false;
                }
            }
        }
        let area = ring_area(&p.ring) - p.holes.iter().map(|h| ring_area(h)).sum::<f64>();
        if area <= 0.0 {
            return false;
        }
        polygon_area += area;
    }
    let mut triangle_area = 0.0;
    for t in &g.triangles {
        if !t.iter().all(|v| v.is_finite()) {
            return false;
        }
        let points = [[t[0], t[1]], [t[2], t[3]], [t[4], t[5]]];
        let area = ((t[2] - t[0]) * (t[5] - t[1]) - (t[4] - t[0]) * (t[3] - t[1])).abs() * 0.5;
        if area <= 1e-12 {
            return false;
        }
        triangle_area += area;
        for p in points.into_iter().chain(std::iter::once([
            (t[0] + t[2] + t[4]) / 3.0,
            (t[1] + t[3] + t[5]) / 3.0,
        ])) {
            if !bounded(p) || !g.polygons.iter().any(|poly| poly.contains(p[0], p[1])) {
                return false;
            }
        }
    }
    (triangle_area - polygon_area).abs() <= 1e-5_f64.max(polygon_area * 1e-6)
}
#[derive(Clone, Debug)]
struct SurfaceRoute {
    points: Vec<[f64; 2]>,
    half_width: f64,
    fallback: bool,
}
impl SurfaceRoute {
    fn core(&self, x: f64, z: f64) -> bool {
        self.points.windows(2).any(|p| {
            Roadbeds::projection(
                &[
                    p[0][0],
                    p[0][1],
                    0.0,
                    p[1][0],
                    p[1][1],
                    0.0,
                    self.half_width,
                    1.0,
                ],
                x,
                z,
            )
            .0 <= self.half_width
        })
    }
}
#[derive(Clone, Debug)]
struct GroundPolicy {
    water: Vec<WaterArea>,
    water_cells: BTreeMap<(i64, i64), Vec<usize>>,
    global_water_cells: BTreeMap<(i64, i64), Vec<usize>>,
    global_water_large: Vec<usize>,
    coverage: Vec<HydroCoverage>,
    bridges: Vec<GroundBridge>,
    bridge_cells: BTreeMap<(i64, i64), Vec<usize>>,
    bridge_water: Vec<Vec<usize>>,
    routes: Vec<SurfaceRoute>,
    enabled_beds: Vec<bool>,
    pads: Vec<GroundPad>,
    banks: Vec<Obstacle>,
    bank_cells: BTreeMap<(i64, i64), Vec<usize>>,
}
type CachedGroundPolicies = Vec<(Vec<u8>, Arc<GroundPolicy>)>;
fn publish_ground_policy(entries: &mut CachedGroundPolicies, key: Vec<u8>, policy: Arc<GroundPolicy>) -> Arc<GroundPolicy> {
    // Another compiler can publish this immutable source while our expensive
    // compilation runs outside the cache lock. Adopt that accepted allocation.
    if let Some((_, existing)) = entries.iter().find(|(k, _)| k == &key) { return existing.clone(); }
    if entries.len() >= 4 { entries.remove(0); }
    entries.push((key, policy.clone()));
    policy
}
fn ring_relation(ring: &[[f64; 2]], x: f64, z: f64) -> u8 {
    let mut inside = false;
    for p in ring.windows(2) {
        let a = p[0];
        let b = p[1];
        let dx = b[0] - a[0];
        let dz = b[1] - a[1];
        let length = dx.hypot(dz);
        let cross = (x - a[0]) * dz - (z - a[1]) * dx;
        if length > 0.0
            && cross.abs() <= 1e-7 * length
            && (x - a[0]) * (x - b[0]) + (z - a[1]) * (z - b[1]) <= 1e-7
        {
            return 2;
        }
        if (a[1] > z) != (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0] {
            inside = !inside;
        }
    }
    if inside {
        1
    } else {
        0
    }
}
impl WaterArea {
    fn contains(&self, x: f64, z: f64) -> bool {
        ring_relation(&self.ring, x, z) > 0
            && !self.holes.iter().any(|r| ring_relation(r, x, z) == 1)
    }
}
fn clip_to_bounds(
    a: [f64; 2],
    b: [f64; 2],
    bounds: &HydroBounds,
    margin: f64,
) -> Option<([f64; 2], [f64; 2])> {
    let mut lo: f64 = 0.0;
    let mut hi: f64 = 1.0;
    for (axis, min, max) in [
        (0, bounds.min_x - margin, bounds.max_x + margin),
        (1, bounds.min_z - margin, bounds.max_z + margin),
    ] {
        let d = b[axis] - a[axis];
        if d.abs() < 1e-12 {
            if a[axis] < min || a[axis] > max {
                return None;
            }
        } else {
            let x = (min - a[axis]) / d;
            let y = (max - a[axis]) / d;
            lo = lo.max(x.min(y));
            hi = hi.min(x.max(y));
            if lo > hi {
                return None;
            }
        }
    }
    Some((
        [a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo],
        [a[0] + (b[0] - a[0]) * hi, a[1] + (b[1] - a[1]) * hi],
    ))
}
impl GroundPolicy {
    fn load(map: &Value, ground: &MapGround) -> Result<Self, String> {
        let coverage: Vec<HydroCoverage> =
            serde_json::from_value(map["navigation"]["hydroCoverage"].clone())
                .map_err(|e| format!("Invalid hydro coverage: {e}"))?;
        if coverage.is_empty() || coverage.iter().any(|c| !c.bounds.valid()) {
            return Err("Hydro coverage must be finite and nonempty".into());
        }
        let water: Vec<WaterArea> = serde_json::from_value(ground.terrain["waterAreas"].clone())
            .map_err(|e| format!("Invalid water areas: {e}"))?;
        let ring_ok = |ring: &Vec<[f64; 2]>| {
            ring.len() >= 4
                && ring.iter().flatten().all(|v| v.is_finite())
                && (ring[0][0] - ring.last().unwrap()[0])
                    .hypot(ring[0][1] - ring.last().unwrap()[1])
                    < 1e-6
        };
        if water.iter().any(|a| {
            !a.level.is_finite() || !ring_ok(&a.ring) || a.holes.iter().any(|r| !ring_ok(r))
        }) {
            return Err("Water polygons require finite closed rings".into());
        }
        let ids: std::collections::BTreeSet<_> = water.iter().map(|a| a.id.as_str()).collect();
        if ids.len() != water.len() {
            return Err("Duplicate water area identity".into());
        }
        let bridges: Vec<GroundBridge> =
            serde_json::from_value(ground.terrain.get("bridges").cloned().unwrap_or(json!([])))
                .map_err(|e| e.to_string())?;
        let beds = ground
            .roadbeds
            .as_ref()
            .ok_or("Hydro policy needs registered roadbeds")?;
        let mut routes = Vec::new();
        let mut enabled_beds = vec![false; beds.segments.len()];
        for road in map["roads"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|r| r["connected"] == true && r["navEnabled"] == true)
        {
            let width = road["halfWidth"]
                .as_f64()
                .filter(|v| v.is_finite() && *v >= 3.0)
                .ok_or("Physical route needs its explicit core halfWidth")?;
            let mut points = Vec::new();
            for p in road["points"]
                .as_array()
                .ok_or("Physical route needs points")?
            {
                let a = p
                    .as_array()
                    .filter(|a| a.len() == 3)
                    .ok_or("Physical route needs x/y/z")?;
                let q = [
                    a[0].as_f64().ok_or("Bad route X")?,
                    a[2].as_f64().ok_or("Bad route Z")?,
                ];
                if !q.iter().all(|v| v.is_finite()) {
                    return Err("Nonfinite physical route".into());
                }
                if points
                    .last()
                    .is_none_or(|last: &[f64; 2]| (last[0] - q[0]).hypot(last[1] - q[1]) > 0.001)
                {
                    points.push(q);
                }
            }
            if points.len() < 2 {
                return Err("Degenerate physical route".into());
            }
            let mut registered = false;
            for i in road["roadbedSegments"].as_array().into_iter().flatten() {
                let i = i.as_u64().ok_or("Invalid physical roadbed binding")? as usize;
                if i >= enabled_beds.len() {
                    return Err("Road binds an unknown roadbed segment".into());
                }
                enabled_beds[i] = true;
                registered = true;
            }
            if !registered
                && map["initialScene"]["objectiveIds"]
                    .as_array()
                    .is_some_and(|v| v.len() > 1)
            {
                return Err(format!(
                    "Production route {} needs explicit roadbedSegments",
                    road["id"].as_str().unwrap_or("<unknown>")
                ));
            }
            routes.push(SurfaceRoute {
                points,
                half_width: width,
                fallback: !registered,
            });
        }
        if routes.is_empty() {
            return Err("Hydro scene needs registered physical routes".into());
        }
        let active = map["initialScene"]["stagingIds"].as_array();
        let pad_ids: std::collections::BTreeSet<_> = map["staging"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|s| {
                s["enabled"] == true && active.is_none_or(|ids| ids.iter().any(|id| id == &s["id"]))
            })
            .filter_map(|s| s["padId"].as_str())
            .collect();
        let pads: Vec<GroundPad> = ground
            .pads
            .iter()
            .filter(|p| pad_ids.contains(p.id.as_str()))
            .cloned()
            .collect();
        if bridges.iter().any(|b| {
            !b.authored
                || b.id.is_empty()
                || !b.half_width.is_finite()
                || b.half_width <= 0.0
                || b.segments.is_empty()
                || b.water_ids.is_empty()
                || b.water_ids.iter().any(|id| !ids.contains(id.as_str()))
                || b.segments
                    .iter()
                    .any(|i| *i >= beds.segments.len() || b.half_width > beds.segments[*i][6])
                || !valid_bridge_joints(b, beds)
        }) {
            return Err(
                "Bridge must reference actual roadbed segments and known water areas".into(),
            );
        }
        if bridges
            .iter()
            .map(|b| b.id.as_str())
            .collect::<std::collections::BTreeSet<_>>()
            .len()
            != bridges.len()
        {
            return Err("Duplicate registered bridge identity".into());
        }
        let water_ids: BTreeMap<_, _> = water
            .iter()
            .enumerate()
            .map(|(i, w)| (w.id.as_str(), i))
            .collect();
        let bridge_water = bridges
            .iter()
            .map(|b| {
                b.water_ids
                    .iter()
                    .map(|id| water_ids[id.as_str()])
                    .collect()
            })
            .collect();
        let mut bridge_cells: BTreeMap<(i64, i64), Vec<usize>> = BTreeMap::new();
        for (i, bridge) in bridges.iter().enumerate() {
            let min_x = bridge
                .segments
                .iter()
                .map(|&i| beds.segments[i][0].min(beds.segments[i][3]))
                .fold(f64::INFINITY, f64::min)
                - bridge.half_width
                - 1e-6;
            let max_x = bridge
                .segments
                .iter()
                .map(|&i| beds.segments[i][0].max(beds.segments[i][3]))
                .fold(f64::NEG_INFINITY, f64::max)
                + bridge.half_width
                + 1e-6;
            let min_z = bridge
                .segments
                .iter()
                .map(|&i| beds.segments[i][1].min(beds.segments[i][4]))
                .fold(f64::INFINITY, f64::min)
                - bridge.half_width
                - 1e-6;
            let max_z = bridge
                .segments
                .iter()
                .map(|&i| beds.segments[i][1].max(beds.segments[i][4]))
                .fold(f64::NEG_INFINITY, f64::max)
                + bridge.half_width
                + 1e-6;
            let (x0, x1, z0, z1) = (
                (min_x / 32.0).floor() as i64,
                (max_x / 32.0).floor() as i64,
                (min_z / 32.0).floor() as i64,
                (max_z / 32.0).floor() as i64,
            );
            if x1.saturating_sub(x0) > 4096 || z1.saturating_sub(z0) > 4096 {
                return Err("Registered bridge exceeds bounded native deck index".into());
            }
            for x in x0..=x1 {
                for z in z0..=z1 {
                    bridge_cells.entry((x, z)).or_default().push(i);
                }
            }
        }
        let mut water_cells: BTreeMap<(i64, i64), Vec<usize>> = BTreeMap::new();
        let mut global_water_cells: BTreeMap<(i64, i64), Vec<usize>> = BTreeMap::new();
        let mut global_water_large = Vec::new();
        // Ground permission is already fail-closed outside registered cores and
        // coverage. Index only cells which could admit a ground footprint, while
        // retaining a separate full-theatre water query for aircraft/ocean use.
        let mut ground_cells: std::collections::BTreeSet<(i64, i64)> = beds
            .cells
            .keys()
            .map(|key| {
                key.split_once(',')
                    .and_then(|(x, z)| Some((x.parse::<i64>().ok()?, z.parse::<i64>().ok()?)))
                    .ok_or("Invalid native roadbed cell key")
            })
            .collect::<Result<_, _>>()?;
        for p in &pads {
            let x0 = ((p.center[0] - p.half_size[0]) / 256.0).floor() as i64;
            let x1 = ((p.center[0] + p.half_size[0]) / 256.0).floor() as i64;
            let z0 = ((p.center[1] - p.half_size[1]) / 256.0).floor() as i64;
            let z1 = ((p.center[1] + p.half_size[1]) / 256.0).floor() as i64;
            if x1 - x0 > 2048 || z1 - z0 > 2048 {
                return Err("Deployment pad exceeds bounded native index".into());
            }
            for x in x0..=x1 {
                for z in z0..=z1 {
                    ground_cells.insert((x, z));
                }
            }
        }
        ground_cells.retain(|&(x, z)| {
            coverage.iter().any(|c| {
                (x as f64 + 1.0) * 256.0 >= c.bounds.min_x
                    && x as f64 * 256.0 <= c.bounds.max_x
                    && (z as f64 + 1.0) * 256.0 >= c.bounds.min_z
                    && z as f64 * 256.0 <= c.bounds.max_z
            })
        });
        for (i, a) in water.iter().enumerate() {
            let min_x = a.ring.iter().map(|p| p[0]).fold(f64::INFINITY, f64::min);
            let max_x = a
                .ring
                .iter()
                .map(|p| p[0])
                .fold(f64::NEG_INFINITY, f64::max);
            let min_z = a.ring.iter().map(|p| p[1]).fold(f64::INFINITY, f64::min);
            let max_z = a
                .ring
                .iter()
                .map(|p| p[1])
                .fold(f64::NEG_INFINITY, f64::max);
            for &(x, z) in &ground_cells {
                let ax = x as f64 * 256.0;
                let az = z as f64 * 256.0;
                if ax + 256.0 < min_x || ax > max_x || az + 256.0 < min_z || az > max_z {
                    continue;
                }
                // A large ocean polygon's island hole must not make every
                // inland height/contact query scan the complete coastline.
                let boundary = std::iter::once(&a.ring).chain(a.holes.iter()).any(|r| {
                    r.windows(2).any(|e| {
                        e[0][0].min(e[1][0]) <= ax + 256.0
                            && e[0][0].max(e[1][0]) >= ax
                            && e[0][1].min(e[1][1]) <= az + 256.0
                            && e[0][1].max(e[1][1]) >= az
                    })
                });
                if boundary || a.contains(ax + 128.0, az + 128.0) {
                    water_cells.entry((x, z)).or_default().push(i);
                }
            }
            const GLOBAL_CELL: f64 = 16384.0;
            let (x0, x1, z0, z1) = (
                (min_x / GLOBAL_CELL).floor() as i64,
                (max_x / GLOBAL_CELL).floor() as i64,
                (min_z / GLOBAL_CELL).floor() as i64,
                (max_z / GLOBAL_CELL).floor() as i64,
            );
            if x1.saturating_sub(x0) > 64 || z1.saturating_sub(z0) > 64 {
                global_water_large.push(i);
                continue;
            }
            for x in x0..=x1 {
                for z in z0..=z1 {
                    global_water_cells.entry((x, z)).or_default().push(i);
                }
            }
        }
        Ok(Self {
            water,
            water_cells,
            global_water_cells,
            global_water_large,
            coverage,
            bridges,
            bridge_cells,
            bridge_water,
            routes,
            enabled_beds,
            pads,
            banks: vec![],
            bank_cells: BTreeMap::new(),
        })
    }
    fn water_level(&self, x: f64, z: f64) -> Option<f64> {
        if !x.is_finite() || !z.is_finite() {
            return None;
        }
        let cell = ((x / 16384.0).floor() as i64, (z / 16384.0).floor() as i64);
        self.global_water_cells
            .get(&cell)
            .into_iter()
            .flatten()
            .chain(self.global_water_large.iter())
            .filter_map(|&i| self.water[i].contains(x, z).then_some(self.water[i].level))
            .max_by(f64::total_cmp)
    }
    fn bridge_clear(
        &self,
        ground: &MapGround,
        area: &WaterArea,
        x: f64,
        z: f64,
        height: f64,
        dynamic: bool,
    ) -> bool {
        if height < area.level + 2.0 {
            return false;
        }
        let beds = ground.roadbeds.as_ref().unwrap();
        self.bridge_candidates(x, z).iter().any(|&i| {
            let b = &self.bridges[i];
            b.water_ids.contains(&area.id)
                && (!dynamic || ground.bridge_states.intact(i))
                && Self::deck_contains(b, beds, x, z)
        })
    }
    fn bridge_candidates(&self, x: f64, z: f64) -> &[usize] {
        self.bridge_cells
            .get(&((x / 32.0).floor() as i64, (z / 32.0).floor() as i64))
            .map(Vec::as_slice)
            .unwrap_or(&[])
    }
    fn deck_contains(b: &GroundBridge, beds: &Roadbeds, x: f64, z: f64) -> bool {
        b.segments.iter().any(|&i| {
            let s = &beds.segments[i];
            let dx = s[3] - s[0];
            let dz = s[4] - s[1];
            let raw = ((x - s[0]) * dx + (z - s[1]) * dz) / (dx * dx + dz * dz);
            (0.0..=1.0).contains(&raw) && Roadbeds::projection(s, x, z).0 <= b.half_width
        }) || b
            .joints
            .as_ref()
            .is_some_and(|g| g.polygons.iter().any(|p| p.contains(x, z)))
    }
    /// Only the exact lost physical footprint is removed. Known water level
    /// remains a flight/camera surface; it is NOT tank support or a river bed.
    fn destroyed_water_surface(
        &self,
        ground: &MapGround,
        x: f64,
        z: f64,
        canonical: f64,
    ) -> Option<f64> {
        if !ground.bridge_states.changed.load(Ordering::Acquire) {
            return None;
        }
        let beds = ground.roadbeds.as_ref()?;
        let mut level: Option<f64> = None;
        for &i in self.bridge_candidates(x, z) {
            if ground.bridge_states.intact(i) || !Self::deck_contains(&self.bridges[i], beds, x, z)
            {
                continue;
            }
            for &w in &self.bridge_water[i] {
                let area = &self.water[w];
                if area.contains(x, z) && !self.bridge_clear(ground, area, x, z, canonical, true) {
                    level = Some(level.map_or(area.level, |l| l.max(area.level)));
                }
            }
        }
        level
    }
    fn allowed(&self, ground: &MapGround, x: f64, z: f64) -> bool {
        self.allowed_with_bridges(ground, x, z, true)
    }
    fn allowed_with_bridges(&self, ground: &MapGround, x: f64, z: f64, dynamic: bool) -> bool {
        if !x.is_finite()
            || !z.is_finite()
            || !self.coverage.iter().any(|c| c.bounds.contains(x, z))
        {
            return false;
        }
        let beds = ground.roadbeds.as_ref().unwrap();
        let core = beds.candidates(x, z).iter().any(|&i| {
            self.enabled_beds[i]
                && Roadbeds::projection(&beds.segments[i], x, z).0 <= beds.segments[i][6]
        }) || (self
            .routes
            .iter()
            .filter(|r| r.fallback)
            .any(|r| r.core(x, z))
            && beds.core(x, z))
            || self.pads.iter().any(|p| {
                (x - p.center[0]).abs() <= p.half_size[0]
                    && (z - p.center[1]).abs() <= p.half_size[1]
            });
        if !core {
            return false;
        }
        let cell = ((x / 256.0).floor() as i64, (z / 256.0).floor() as i64);
        let height = if dynamic {
            ground.height(x, z)
        } else {
            ground.canonical_height(x, z)
        };
        self.water_cells.get(&cell).into_iter().flatten().all(|&i| {
            let area = &self.water[i];
            !area.contains(x, z) || self.bridge_clear(ground, area, x, z, height, dynamic)
        })
    }
    fn barriers(&mut self, ground: &MapGround) {
        let beds = ground.roadbeds.as_ref().unwrap();
        let mut lines = Vec::new();
        let mut vertices: BTreeMap<(i64, i64), ([f64; 2], f64, Vec<[f64; 2]>)> = BTreeMap::new();
        for s in self.routes.iter().flat_map(|r| {
            r.points.windows(2).map(move |p| {
                [
                    p[0][0],
                    p[0][1],
                    0.0,
                    p[1][0],
                    p[1][1],
                    0.0,
                    r.half_width,
                    1.0,
                ]
            })
        }) {
            let length = (s[3] - s[0]).hypot(s[4] - s[1]);
            let tangent = [(s[3] - s[0]) / length, (s[4] - s[1]) / length];
            let normal = [-tangent[1], tangent[0]];
            for sign in [-1.0, 1.0] {
                lines.push((
                    [
                        s[0] + normal[0] * s[6] * sign,
                        s[1] + normal[1] * s[6] * sign,
                    ],
                    [
                        s[3] + normal[0] * s[6] * sign,
                        s[4] + normal[1] * s[6] * sign,
                    ],
                ));
            }
            for (p, d) in [
                ([s[0], s[1]], tangent),
                ([s[3], s[4]], [-tangent[0], -tangent[1]]),
            ] {
                let key = (
                    (p[0] * 1000.0).round() as i64,
                    (p[1] * 1000.0).round() as i64,
                );
                let v = vertices.entry(key).or_insert((p, s[6], vec![]));
                v.1 = v.1.max(s[6]);
                v.2.push(d);
            }
        }
        for (_, (p, r, directions)) in vertices {
            if directions.len() == 2
                && directions[0][0] * directions[1][0] + directions[0][1] * directions[1][1]
                    < -0.999
            {
                continue;
            }
            let count = (std::f64::consts::TAU * r / 2.0).ceil() as usize;
            for i in 0..count {
                let a = std::f64::consts::TAU * i as f64 / count as f64;
                let b = std::f64::consts::TAU * (i + 1) as f64 / count as f64;
                lines.push((
                    [p[0] + r * a.cos(), p[1] + r * a.sin()],
                    [p[0] + r * b.cos(), p[1] + r * b.sin()],
                ));
            }
        }
        for a in &self.water {
            for ring in std::iter::once(&a.ring).chain(a.holes.iter()) {
                for edge in ring.windows(2) {
                    lines.push((edge[0], edge[1]));
                }
            }
        }
        for bridge in &self.bridges {
            for &i in &bridge.segments {
                let s = &beds.segments[i];
                let length = (s[3] - s[0]).hypot(s[4] - s[1]);
                let normal = [-(s[4] - s[1]) / length, (s[3] - s[0]) / length];
                let w = bridge.half_width;
                let corners = [
                    [s[0] + normal[0] * w, s[1] + normal[1] * w],
                    [s[3] + normal[0] * w, s[4] + normal[1] * w],
                    [s[3] - normal[0] * w, s[4] - normal[1] * w],
                    [s[0] - normal[0] * w, s[1] - normal[1] * w],
                    [s[0] + normal[0] * w, s[1] + normal[1] * w],
                ];
                for edge in corners.windows(2) {
                    lines.push((edge[0], edge[1]));
                }
            }
            if let Some(g) = &bridge.joints {
                for p in &g.polygons {
                    for ring in std::iter::once(&p.ring).chain(p.holes.iter()) {
                        for e in ring.windows(2) {
                            lines.push((e[0], e[1]));
                        }
                    }
                }
            }
        }
        for c in &self.coverage {
            let b = &c.bounds;
            let ring = [
                [b.min_x, b.min_z],
                [b.max_x, b.min_z],
                [b.max_x, b.max_z],
                [b.min_x, b.max_z],
                [b.min_x, b.min_z],
            ];
            for e in ring.windows(2) {
                lines.push((e[0], e[1]));
            }
        }
        for p in &self.pads {
            let [x, z] = p.center;
            let [hx, hz] = p.half_size;
            let ring = [
                [x - hx, z - hz],
                [x + hx, z - hz],
                [x + hx, z + hz],
                [x - hx, z + hz],
                [x - hx, z - hz],
            ];
            for e in ring.windows(2) {
                lines.push((e[0], e[1]));
            }
        }
        let mut seen = std::collections::BTreeSet::new();
        let lines: Vec<_> = lines
            .into_iter()
            .flat_map(|(a, b)| {
                self.coverage
                    .iter()
                    .filter_map(move |c| clip_to_bounds(a, b, &c.bounds, 2.0))
            })
            .collect();
        for (a, b) in lines {
            let length = (b[0] - a[0]).hypot(b[1] - a[1]);
            if length < 1e-6 {
                continue;
            }
            let tangent = [(b[0] - a[0]) / length, (b[1] - a[1]) / length];
            let normal = [-tangent[1], tangent[0]];
            let count = (length / 2.0).ceil() as usize;
            for i in 0..count {
                let t = (i as f64 + 0.5) / count as f64;
                let p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
                // The globally cached barriers are source geometry only. A
                // room's mutable bridge losses must never alter this cache.
                let left = self.allowed_with_bridges(
                    ground,
                    p[0] + normal[0] * 0.4,
                    p[1] + normal[1] * 0.4,
                    false,
                );
                let right = self.allowed_with_bridges(
                    ground,
                    p[0] - normal[0] * 0.4,
                    p[1] - normal[1] * 0.4,
                    false,
                );
                if left == right {
                    continue;
                }
                let sign = if left { -1.0 } else { 1.0 };
                let x = p[0] + normal[0] * 0.15 * sign;
                let z = p[1] + normal[1] * 0.15 * sign;
                let yaw = tangent[0].atan2(tangent[1]);
                if !seen.insert((
                    (x * 10.0).round() as i64,
                    (z * 10.0).round() as i64,
                    (yaw * 1000.0).round() as i64,
                )) {
                    continue;
                }
                let h = ground.canonical_height(x, z);
                let bank = Obstacle {
                    x,
                    z,
                    yaw,
                    hx: 0.65,
                    hz: length / count as f64 * 0.5 + 0.2,
                    y0: h - 3.0,
                    y1: h + 5.0,
                };
                let index = self.banks.len();
                self.banks.push(bank);
                // Short segments fit wholly in this conservative64m contact index halo.
                for cx in ((x - 4.0) / 64.0).floor() as i64..=((x + 4.0) / 64.0).floor() as i64 {
                    for cz in ((z - 4.0) / 64.0).floor() as i64..=((z + 4.0) / 64.0).floor() as i64
                    {
                        self.bank_cells.entry((cx, cz)).or_default().push(index);
                    }
                }
            }
        }
    }
    fn nearby(&self, x: f64, z: f64, radius: f64) -> Vec<Obstacle> {
        let mut ids = std::collections::BTreeSet::new();
        for cx in ((x - radius) / 64.0).floor() as i64..=((x + radius) / 64.0).floor() as i64 {
            for cz in ((z - radius) / 64.0).floor() as i64..=((z + radius) / 64.0).floor() as i64 {
                if let Some(v) = self.bank_cells.get(&(cx, cz)) {
                    ids.extend(v.iter().copied());
                }
            }
        }
        ids.into_iter()
            .filter_map(|i| {
                let b = self.banks[i];
                ((x - b.x).hypot(z - b.z) <= radius + b.hx.hypot(b.hz)).then_some(b)
            })
            .collect()
    }
}
impl MapGround {
    pub fn load(data: &Path, map: &Value) -> Result<Self, String> {
        if map["initialScene"]["objectiveIds"]
            .as_array()
            .is_some_and(|ids| ids.len() > 1)
            && map["navigation"].get("hydroCoverage").is_none()
        {
            return Err("Multi-objective native theatre requires explicit hydro coverage".into());
        }
        let terrain = map.get("terrain").cloned().ok_or("missing terrain")?;
        let grid: HeightGrid =
            serde_json::from_value(terrain.clone()).map_err(|e| e.to_string())?;
        if !grid.valid() {
            return Err("invalid canonical terrain grid".into());
        }
        let surfaces =
            tg_physics::load_terrains(&data.join("terrains.json")).map_err(|e| e.to_string())?;
        let surface = surfaces
            .into_iter()
            .find(|s| s.id == "road")
            .ok_or("missing road surface")?;
        let mut patches = vec![];
        for value in terrain["patches"].as_array().into_iter().flatten() {
            let grid: HeightGrid =
                serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
            let blend = value["blendMeters"]
                .as_f64()
                .ok_or("missing patch blendMeters")?;
            if !grid.valid() || !blend.is_finite() || blend <= 0.0 {
                return Err("invalid terrain patch".into());
            }
            patches.push((grid, blend));
        }
        let pads: Vec<GroundPad> =
            serde_json::from_value(terrain.get("pads").cloned().unwrap_or(json!([])))
                .map_err(|e| e.to_string())?;
        if pads.iter().any(|p| {
            !p.height.is_finite()
                || !p
                    .center
                    .iter()
                    .chain(p.half_size.iter())
                    .all(|v| v.is_finite())
                || p.half_size.iter().any(|v| *v <= 0.0)
                || !p.blend.is_finite()
                || p.blend <= 0.0
        }) {
            return Err("invalid authored terrain pad".into());
        }
        let runways: Vec<RunwayPad> =
            serde_json::from_value(terrain.get("runways").cloned().unwrap_or(json!([])))
                .map_err(|e| e.to_string())?;
        if runways.iter().any(|p| !p.valid()) {
            return Err("invalid authored runway grading".into());
        }
        let mut roadbeds = terrain
            .get("roadbeds")
            .filter(|v| !v.is_null())
            .map(|v| serde_json::from_value::<Roadbeds>(v.clone()).map_err(|e| e.to_string()))
            .transpose()?;
        if roadbeds.as_ref().is_some_and(|r| !r.valid()) {
            return Err("Invalid/incomplete canonical roadbed index".into());
        }
        if let Some(r) = roadbeds.as_mut() {
            r.compile_index()?;
        }
        let mut ground = Self {
            grid,
            surface,
            terrain,
            patches,
            pads,
            runways,
            roadbeds: roadbeds.map(Arc::new),
            policy: None,
            bridge_states: Arc::new(DynamicBridges::new(std::iter::empty())),
            runway_sources: map["airfields"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|f| f["enabled"] == true)
                .filter_map(|f| {
                    let id = f["id"].as_str()?.to_owned();
                    let r = &f["runway"];
                    Some((
                        id,
                        crate::flight_runtime::LandingArea {
                            center: serde_json::from_value(r["center"].clone()).ok()?,
                            forward: serde_json::from_value(r["forward"].clone()).ok()?,
                            half_width: r["widthMeters"].as_f64()? / 2.0,
                            half_length: r["lengthMeters"].as_f64()? / 2.0,
                        },
                    ))
                })
                .collect(),
            runway_closures: Arc::new(std::sync::RwLock::new(Vec::new())),
            airport_support: map["airfields"]
                .as_array()
                .into_iter()
                .flatten()
                .filter(|f| f["enabled"] == true)
                .filter_map(|f| {
                    let id = f["id"].as_str()?.to_owned();
                    let team = f["team"].as_u64()?;
                    if team > 1 {
                        return None;
                    }
                    let r = &f["runway"];
                    Some((
                        id,
                        (
                            team as u8,
                            crate::flight_runtime::LandingArea {
                                center: serde_json::from_value(r["center"].clone()).ok()?,
                                forward: serde_json::from_value(r["forward"].clone()).ok()?,
                                half_width: r["widthMeters"].as_f64()? / 2.0 + 100.0,
                                half_length: r["lengthMeters"].as_f64()? / 2.0 + 20.0,
                            },
                        ),
                    ))
                })
                .collect(),
        };
        ground.select_navigation_scene(map)?;
        Ok(ground)
    }
    pub(crate) fn select_navigation_scene(&mut self, map: &Value) -> Result<(), String> {
        if map.get("terrain") != Some(&self.terrain) {
            return Err("Navigation scene cannot replace canonical terrain".into());
        }
        if map["navigation"].get("hydroCoverage").is_some() {
            // A bounded immutable cache shares expensive source-derived contacts across rooms/tests.
            // The full canonical bytes are compared, not a lossy coordinate or hash-only identity.
            static CACHE: std::sync::OnceLock<std::sync::Mutex<CachedGroundPolicies>> =
                std::sync::OnceLock::new();
            let key = serde_json::to_vec(&json!([
                &self.terrain,
                &map["navigation"]["hydroCoverage"],
                &map["roads"],
                &map["initialScene"]["stagingIds"],
                &map["staging"]
            ]))
            .map_err(|e| e.to_string())?;
            let cache = CACHE.get_or_init(|| std::sync::Mutex::new(Vec::new()));
            let cached = cache
                .lock()
                .map_err(|_| "Hydro cache poisoned")?
                .iter()
                .find(|(k, _)| k == &key)
                .map(|(_, p)| p.clone());
            let policy = if let Some(policy) = cached {
                policy
            } else {
                let mut policy = GroundPolicy::load(map, self)?;
                policy.barriers(self);
                let policy = Arc::new(policy);
                let mut entries = cache.lock().map_err(|_| "Hydro cache poisoned")?;
                publish_ground_policy(&mut entries, key, policy)
            };
            let ids: BTreeMap<_, _> = policy
                .bridges
                .iter()
                .enumerate()
                .map(|(i, b)| (b.id.clone(), i))
                .collect();
            if self.bridge_states.ids != ids {
                self.bridge_states = Arc::new(DynamicBridges::new(
                    policy.bridges.iter().map(|b| b.id.clone()),
                ));
            }
            self.policy = Some(policy);
        } else {
            self.policy = None;
        }
        Ok(())
    }
    pub fn contains(&self, x: f64, z: f64) -> bool {
        x.is_finite()
            && z.is_finite()
            && x >= self.grid.x0
            && z >= self.grid.z0
            && x <= self.grid.x0 + self.grid.cell_x * (self.grid.width - 1) as f64
            && z <= self.grid.z0 + self.grid.cell_z * (self.grid.height - 1) as f64
    }
    pub fn ground_navigation_allowed(&self, x: f64, z: f64) -> bool {
        self.contains(x, z)
            && (self.airport_support.values().any(|(_, a)| {
                let dx = x - a.center[0];
                let dz = z - a.center[1];
                (dx * a.forward[1] - dz * a.forward[0]).abs() <= a.half_width
                    && (dx * a.forward[0] + dz * a.forward[1]).abs() <= a.half_length
                    && self.water_level(x, z).is_none()
            }) || self
                .policy
                .as_ref()
                .is_none_or(|policy| policy.allowed(self, x, z)))
    }
    /// Full-theatre wet geometry, independent of ground route/hydro permission.
    /// A missing ground navigation cell never turns the sea into dry land.
    pub fn water_level(&self, x: f64, z: f64) -> Option<f64> {
        self.policy.as_ref().and_then(|p| p.water_level(x, z))
    }
    pub(crate) fn bridge_state(&self, id: &str) -> Option<BridgeStateView> {
        self.bridge_states.view(id)
    }
    pub(crate) fn bridge_states(&self) -> Vec<BridgeStateView> {
        self.bridge_states
            .ids
            .keys()
            .filter_map(|id| self.bridge_state(id))
            .collect()
    }
    /// Native owner only. A later damage acceptance advances revision even if
    /// already destroyed, invalidating an older asynchronous repair job.
    pub(crate) fn set_bridge_destroyed(
        &self,
        id: &str,
        expected_revision: u64,
        destroyed: bool,
    ) -> Result<BridgeStateView, String> {
        self.bridge_states.set(id, expected_revision, destroyed)
    }
    fn bind_bridge_battle(&mut self, battle: u64) {
        // Hub assigns identity after cloning its pristine template and BEFORE
        // creating AirWorld's shared MapGround. Repeating that same identity
        // must not detach an aircraft clone already owned by this battle.
        if self.bridge_states.battle.load(Ordering::Acquire) != battle {
            let closures = self
                .runway_closures
                .read()
                .expect("runway closure lock")
                .clone();
            self.runway_closures = Arc::new(std::sync::RwLock::new(closures));
            let independent = self.bridge_states.independent();
            independent.battle.store(battle, Ordering::Release);
            self.bridge_states = Arc::new(independent);
        }
    }
    fn native_navigation_contacts(&self, x: f64, z: f64, radius: f64) -> Vec<Obstacle> {
        self.policy
            .as_ref()
            .map(|policy| policy.nearby(x, z, radius))
            .unwrap_or_default()
    }
    pub fn set_runway_closures(&self, regions: Vec<RunwayClosedRegion>) -> Result<(), String> {
        let mut ids = std::collections::BTreeSet::new();
        for r in &regions {
            let source = self
                .runway_sources
                .get(&r.airfield)
                .ok_or("Unknown runway closure airfield")?;
            if r.facility_id.is_empty()
                || !ids.insert(r.facility_id.clone())
                || r.revision == 0
                || !r
                    .center
                    .iter()
                    .chain(&r.forward)
                    .chain(&r.half)
                    .all(|v| v.is_finite())
                || r.half.iter().any(|v| *v <= 0.0)
                || (r.forward[0].hypot(r.forward[1]) - 1.0).abs() > 1e-6
                || (r.forward[0] - source.forward[0]).hypot(r.forward[1] - source.forward[1]) > 1e-6
            {
                return Err("Invalid runway closure source/geometry".into());
            }
            for x in [-1.0, 1.0] {
                for z in [-1.0, 1.0] {
                    let p = [
                        r.center[0] + r.forward[1] * r.half[0] * x + r.forward[0] * r.half[1] * z,
                        r.center[1] - r.forward[0] * r.half[0] * x + r.forward[1] * r.half[1] * z,
                    ];
                    let dx = p[0] - source.center[0];
                    let dz = p[1] - source.center[1];
                    if (dx * source.forward[1] - dz * source.forward[0]).abs()
                        > source.half_width + 1e-5
                        || (dx * source.forward[0] + dz * source.forward[1]).abs()
                            > source.half_length + 1e-5
                    {
                        return Err("Closure extends outside source runway strip".into());
                    }
                }
            }
        }
        *self
            .runway_closures
            .write()
            .map_err(|_| "Runway closure lock poisoned")? = regions;
        Ok(())
    }
    pub fn runway_available_at(&self, x: f64, z: f64) -> bool {
        x.is_finite()
            && z.is_finite()
            && !self
                .runway_closures
                .read()
                .expect("runway closure lock")
                .iter()
                .any(|r| {
                    let dx = x - r.center[0];
                    let dz = z - r.center[1];
                    (dx * r.forward[1] - dz * r.forward[0]).abs() <= r.half[0] + 1e-6
                        && (dx * r.forward[0] + dz * r.forward[1]).abs() <= r.half[1] + 1e-6
                })
    }
    pub fn runway_source_registered(&self, id: &str) -> bool {
        self.runway_sources.contains_key(id)
    }
    pub fn runway_open_intervals(&self, airfield: &str) -> Vec<[f64; 2]> {
        let Some(r) = self.runway_sources.get(airfield) else {
            return Vec::new();
        };
        let regions = self.runway_closures.read().expect("runway closure lock");
        let mut closed: Vec<[f64; 2]> = regions
            .iter()
            .filter(|p| p.airfield == airfield)
            .map(|p| {
                let d = (p.center[0] - r.center[0]) * r.forward[0]
                    + (p.center[1] - r.center[1]) * r.forward[1];
                [
                    (d - p.half[1] - 1e-5).max(-r.half_length),
                    (d + p.half[1] + 1e-5).min(r.half_length),
                ]
            })
            .collect();
        closed.sort_by(|a, b| a[0].total_cmp(&b[0]));
        let mut cursor = -r.half_length;
        let mut result = Vec::new();
        for c in closed {
            if c[0] > cursor {
                result.push([cursor, c[0]]);
            }
            cursor = cursor.max(c[1]);
        }
        if cursor < r.half_length {
            result.push([cursor, r.half_length]);
        }
        result
    }
    fn fork_world(&self) -> Self {
        let mut copy = self.clone();
        copy.bridge_states = Arc::new(self.bridge_states.independent());
        copy.runway_closures = Arc::new(std::sync::RwLock::new(
            self.runway_closures
                .read()
                .expect("runway closure lock")
                .clone(),
        ));
        copy
    }
}
#[derive(Clone, Debug, Deserialize)]
struct GroundPad {
    #[serde(default)]
    id: String,
    center: [f64; 2],
    #[serde(rename = "halfSize")]
    half_size: [f64; 2],
    height: f64,
    #[serde(rename = "blendMeters")]
    blend: f64,
}
#[derive(Clone, Debug, Deserialize)]
struct RunwayPad {
    center: [f64; 2],
    forward: [f64; 2],
    #[serde(rename = "halfSize")]
    half_size: [f64; 2],
    height: f64,
    #[serde(rename = "blendMeters")]
    blend: f64,
}
impl RunwayPad {
    fn valid(&self) -> bool {
        self.center
            .iter()
            .chain(&self.forward)
            .chain(&self.half_size)
            .all(|v| v.is_finite())
            && self.height.is_finite()
            && self.blend.is_finite()
            && self.blend > 0.0
            && self.half_size.iter().all(|v| *v > 0.0)
            && (self.forward[0].hypot(self.forward[1]) - 1.0).abs() < 1e-6
    }
}
impl MapGround {
    fn canonical_height(&self, x: f64, z: f64) -> f64 {
        let mut h = self.grid.sample(x, z);
        for (g, blend) in &self.patches {
            let xmax = g.x0 + g.cell_x * (g.width - 1) as f64;
            let zmax = g.z0 + g.cell_z * (g.height - 1) as f64;
            if x >= g.x0 && x <= xmax && z >= g.z0 && z <= zmax {
                let d = (x - g.x0).min(xmax - x).min(z - g.z0).min(zmax - z);
                let w = (d / blend).clamp(0.0, 1.0);
                h = h * (1.0 - w) + g.sample(x, z) * w;
            }
        }
        if let Some(roadbeds) = &self.roadbeds {
            h = roadbeds.sample(h, x, z);
        }
        for p in &self.pads {
            let d = ((x - p.center[0]).abs() - p.half_size[0])
                .max((z - p.center[1]).abs() - p.half_size[1])
                .max(0.0);
            let w = (1.0 - d / p.blend).clamp(0.0, 1.0);
            h = h * (1.0 - w) + p.height * w;
        }
        for p in &self.runways {
            let dx = x - p.center[0];
            let dz = z - p.center[1];
            let lateral = dx * p.forward[1] - dz * p.forward[0];
            let longitudinal = dx * p.forward[0] + dz * p.forward[1];
            let d = (lateral.abs() - p.half_size[0])
                .max(longitudinal.abs() - p.half_size[1])
                .max(0.0);
            let w = (1.0 - d / p.blend).clamp(0.0, 1.0);
            h = h * (1.0 - w) + p.height * w;
        }
        h
    }
}
impl Ground for MapGround {
    fn height(&self, x: f64, z: f64) -> f64 {
        let canonical = self.canonical_height(x, z);
        self.policy
            .as_ref()
            .and_then(|p| p.destroyed_water_surface(self, x, z, canonical))
            .unwrap_or(canonical)
    }
    fn has_support(&self, x: f64, z: f64) -> bool {
        if !self.bridge_states.changed.load(Ordering::Acquire) {
            return true;
        }
        let Some(policy) = &self.policy else {
            return true;
        };
        if !policy
            .bridge_candidates(x, z)
            .iter()
            .any(|&i| !self.bridge_states.intact(i))
        {
            return true;
        }
        let canonical = self.canonical_height(x, z);
        policy
            .destroyed_water_surface(self, x, z, canonical)
            .is_none()
    }
    fn surface(&self, _x: f64, _z: f64) -> &TerrainDef {
        &self.surface
    }
}
#[derive(Clone, Debug)]
struct Model {
    vehicle: LoadedVehicle,
    plant: TankModel,
    target: Target,
    ammo: AmmoCatalog,
    collide_radius: f64,
    mounted: Vec<MountedGun>,
}
#[derive(Clone, Debug)]
struct MountedGun {
    instance: String,
    gun: GunDef,
    trunnion: [f32; 3],
    muzzle_vector: [f32; 3],
}
#[derive(Clone, Debug, Default)]
struct MountedFeed {
    selected_ammo: usize,
    belt_left: u32,
    next_shot: f64,
    belt_ready: f64,
    spin: f64,
}
#[derive(Clone, Copy, Debug)]
struct AimTrack {
    direction: [f64; 3],
    direction_rate: [f64; 3],
    sampled_at: f64,
}
#[derive(Clone, Debug)]
struct Unit {
    id: u64,
    team: u8,
    model: Arc<Model>,
    tank: Tank,
    state: TargetState,
    ammo: AmmoLedger,
    gun: GunState,
    turret: TurretState,
    input: SimInput,
    life: u64,
    facility_roles: FacilityWorkerRoles,
    submerged_s: f64,
    is_support: bool,
    weapon_trigger: bool,
    mounted_feeds: Vec<MountedFeed>,
    aim_track: Option<AimTrack>,
}
#[derive(Clone, Debug)]
struct Round {
    id: u64,
    shooter: u64,
    team: u8,
    shell: ProjectileDef,
    pos: [f64; 3],
    velocity: [f64; 3],
    age: f64,
    distance: f64,
    seed: u64,
    air: Option<AirOrdnance>,
    gun_tracer: Option<AirGunTracerStyle>,
}
/// Display provenance set only after an aircraft gun round was accepted.
#[derive(Clone, Debug)]
pub(crate) struct AirGunTracerStyle {
    pub shooter: UnitRef,
    pub color: [f64; 3],
    pub style: &'static str,
    pub width_scale: f64,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AirGunTracerView {
    pub shot_id: u64,
    pub shooter: UnitRef,
    pub team: u8,
    pub projectile_id: String,
    pub pos: [f64; 3],
    pub velocity: [f64; 3],
    pub age: f64,
    pub distance_m: f64,
    pub color: [f64; 3],
    pub caliber_mm: f32,
    pub style: &'static str,
    pub width_scale: f64,
}
/// Host-admitted store dynamics. Guided stores retain the same projectile/contact owner.
#[derive(Clone, Debug)]
pub struct AirOrdnance {
    pub store_id:String,
    pub cluster:Option<ClusterPayload>,
    pub ramjet:Option<[f64;3]>,
    pub direction: [f64; 3],
    pub bomb: bool,
    pub diameter: f64,
    pub mass: f64,
    pub dv: f64,
    pub burn: f64,
    pub sustain: Option<[f64;2]>,
    pub guided: Option<crate::frontline_air::guided::Missile>,
}
#[derive(Clone, Debug)]
pub struct ClusterPayload {pub shell:ProjectileDef,pub store_id:String,pub count:u32,pub open:f64,pub spread:f64,pub mass:f64,pub diameter:f64}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct FacilityWorkerRoles {
    pub engineer: bool,
    pub supply: bool,
    pub combat: bool,
}
impl Default for FacilityWorkerRoles {
    fn default() -> Self {
        Self {
            engineer: false,
            supply: false,
            combat: true,
        }
    }
}
#[derive(Debug)]
pub struct SimWorld {
    models: BTreeMap<String, Arc<Model>>,
    units: BTreeMap<u64, Unit>,
    naval: Option<crate::frontline_naval::NavalWorld>,
    pub ground: MapGround,
    facilities: FacilityWorld,
    facility_boxes: Vec<Obstacle>,
    facility_applied_revision: u64,
    materials: Arc<Vec<tg_armor::Material>>,
    projectiles: Arc<std::collections::HashMap<String, ProjectileDef>>,
    rounds: Vec<Round>,
    accumulator: f64,
    now: f64,
    serial: u64,
    battle_id: u64,
    pub friendly_damage: bool,
    timing: Option<SimTimings>,
    unit_worker_capacity: usize,
    #[cfg(test)]
    forced_unit_workers: Option<usize>,
}
impl Clone for SimWorld {
    fn clone(&self) -> Self {
        Self {
            models: self.models.clone(),
            units: self.units.clone(),
            naval: self.naval.clone(),
            ground: self.ground.fork_world(),
            facilities: self.facilities.clone(),
            facility_boxes: self.facility_boxes.clone(),
            facility_applied_revision: self.facility_applied_revision,
            materials: self.materials.clone(),
            projectiles: self.projectiles.clone(),
            rounds: self.rounds.clone(),
            accumulator: self.accumulator,
            now: self.now,
            serial: self.serial,
            battle_id: self.battle_id,
            friendly_damage: self.friendly_damage,
            timing: self.timing,
            unit_worker_capacity: self.unit_worker_capacity,
            #[cfg(test)]
            forced_unit_workers: self.forced_unit_workers,
        }
    }
}
fn load_facilities(map: &Value, ground: &MapGround) -> Result<FacilityWorld, String> {
    if map.get("id").is_none() {
        Ok(FacilityWorld::empty())
    } else {
        FacilityWorld::from_map(map, |x, z| ground.canonical_height(x, z))
    }
}
fn facility_obstacles(world: &FacilityWorld) -> Vec<Obstacle> {
    world
        .blocking_boxes()
        .iter()
        .map(|b| Obstacle {
            x: (b.bounds[0][0] + b.bounds[1][0]) / 2.0,
            z: (b.bounds[0][2] + b.bounds[1][2]) / 2.0,
            yaw: 0.0,
            hx: (b.bounds[1][0] - b.bounds[0][0]) / 2.0,
            hz: (b.bounds[1][2] - b.bounds[0][2]) / 2.0,
            y0: b.bounds[0][1],
            y1: b.bounds[1][1],
        })
        .collect()
}

// Each invocation owns exactly one Unit. Cross-unit bodies were captured before
// any unit advance; ground/model data and the obstacle slice are immutable.
// Air and projectiles remain outside this function in their original order.
fn step_native_unit(
    u: &mut Unit,
    ground: &MapGround,
    obstacles: &[(u64, Obstacle)],
    now: f64,
    mut timing: Option<&mut SimTimings>,
) -> Option<SimEvent> {
    let mut event = None;
    let combat_start = timing.as_ref().map(|_| Instant::now());
    let was_alive = !u.state.destroyed;
    tg_combat::advance(
        &u.model.target,
        &mut u.state,
        FIXED_DT as f32,
        (now * 120.0) as u64 ^ u.id,
    );
    let caps = tg_combat::caps(&u.model.target, &u.state);
    u.tank.broken = [!caps.track_left, !caps.track_right];
    if let (Some(t), Some(start)) = (timing.as_deref_mut(), combat_start) {
        t.ground_combat_ns += start.elapsed().as_nanos() as u64;
    }
    let prep_start = timing.as_ref().map(|_| Instant::now());
    u.tank.obstacles = obstacles
        .iter()
        .filter(|(id, _)| *id != u.id)
        .map(|(_, o)| *o)
        .collect();
    let origin = u.tank.body.origin();
    let radius = u.model.collide_radius + length(u.tank.body.v) * FIXED_DT + 0.25;
    // The same native spring/damper contacts as vehicle bodies resist
    // human input, AI input and inertia. No throttle-only gate, pose
    // rollback, fake HP or post-step teleport implements this policy.
    u.tank
        .obstacles
        .extend(ground.native_navigation_contacts(origin[0], origin[2], radius));
    let input = tg_physics::Input {
        throttle: if caps.can_move { u.input.throttle } else { 0.0 },
        steer: if caps.can_move { u.input.steer } else { 0.0 },
        brake: if caps.can_move { u.input.brake } else { 1.0 },
        drive_power: Some(if caps.can_move { caps.drive_power } else { 0.0 }),
    };
    if let (Some(t), Some(start)) = (timing.as_deref_mut(), prep_start) {
        t.contact_prep_ns += start.elapsed().as_nanos() as u64;
    }
    let physics_start = timing.as_ref().map(|_| Instant::now());
    if let Some(timing) = timing.as_deref_mut() {
        tank::step_with_timings(
            &u.model.plant,
            &mut u.tank,
            input,
            ground,
            FIXED_DT,
            &mut timing.tank_detail,
        );
    } else {
        tank::step(&u.model.plant, &mut u.tank, input, ground, FIXED_DT);
    }
    let mut submerged_loss = false;
    let origin = u.tank.body.origin();
    let submerged = ground
        .water_level(origin[0], origin[2])
        .is_some_and(|water| {
            !ground.has_support(origin[0], origin[2])
                && !u.model.target.def.crew.is_empty()
                && u.model.target.def.crew.iter().all(|c| {
                    u.tank.body.world_point(c.pos.to_array().map(|v| v as f64))[1] < water - 0.2
                })
        });
    if was_alive && submerged {
        u.submerged_s += FIXED_DT;
    } else {
        u.submerged_s = 0.0;
    }
    if was_alive && u.submerged_s >= 2.0 {
        u.state.crew.fill(0.0);
        u.state.destroyed = true;
        u.state.repair_s = 0.0;
        u.state.repair_targets = None;
        submerged_loss = true;
    }
    if let (Some(t), Some(start)) = (timing.as_deref_mut(), physics_start) {
        t.tank_physics_ns += start.elapsed().as_nanos() as u64;
    }
    let combat_start = timing.as_ref().map(|_| Instant::now());
    if let Some(track) = u.aim_track {
        let age = (now - track.sampled_at).max(0.0);
        if age <= 0.5 {
            request_native_aim(
                u,
                add(track.direction, scale(track.direction_rate, age)),
                0.0025,
            );
        }
    }
    let w = &u.model.vehicle.weapons;
    let wc = caps.weapons.get(MAIN);
    let yaw = u.input.turret_yaw.unwrap_or(u.turret.yaw as f64) as f32;
    turret::traverse_limited(
        &mut u.turret,
        yaw,
        w.facing_deg.to_radians(),
        w.yaw_limit_deg
            .map(|[a, b]| (a.to_radians(), b.to_radians())),
        w.main_gun.traverse_deg_s.to_radians()
            * wc.map(|c| c.traverse_mult).unwrap_or(caps.traverse_mult),
        FIXED_DT as f32,
    );
    let desired_pitch = u.input.gun_pitch.unwrap_or(u.turret.pitch as f64) as f32;
    turret::elevate(
        &w.main_gun,
        &mut u.turret.pitch,
        desired_pitch,
        wc.map(|c| c.elevate_mult).unwrap_or(caps.elevate_mult),
        FIXED_DT as f32,
    );
    fire::tick_reload(&mut u.gun, FIXED_DT as f32);
    for (mounted, feed) in u.model.mounted.iter().zip(&mut u.mounted_feeds) {
        if let Some(automatic) = &mounted.gun.autocannon {
            if automatic.spin_up_s > 0.0 {
                let delta = FIXED_DT / automatic.spin_up_s as f64;
                feed.spin = (feed.spin
                    + if u.weapon_trigger && !u.state.destroyed {
                        delta
                    } else {
                        -2.0 * delta
                    })
                .clamp(0.0, 1.0);
            } else {
                feed.spin = 1.0;
            }
        }
    }
    if was_alive && u.state.destroyed {
        event = Some(SimEvent {
            kind: "destroyed".into(),
            shooter: None,
            target: Some(u.id),
            pos: u.tank.body.origin(),
            detail: json!({"cause":if submerged_loss {"native_submersion"}else{"native_damage_advance"},"submerged_seconds":u.submerged_s}),
        })
    }
    if let (Some(t), Some(start)) = (timing.as_deref_mut(), combat_start) {
        t.ground_combat_ns += start.elapsed().as_nanos() as u64;
    }
    event
}
struct UnitBatch {
    events: Vec<SimEvent>,
    timing: Option<SimTimings>,
}
fn mounted_guns(vehicle: &LoadedVehicle, target: &Target) -> Vec<MountedGun> {
    let w = &vehicle.weapons;
    let muzzle = |raw: &Value, gun: &GunDef, offset: f32| -> [f32; 3] {
        raw.get("muzzle_vector_m")
            .or_else(|| raw.get("main_gun").and_then(|g| g.get("muzzle_vector_m")))
            .or_else(|| raw.get("gun").and_then(|g| g.get("muzzle_vector_m")))
            .and_then(|v| serde_json::from_value::<[f32; 3]>(v.clone()).ok())
            .filter(|p| p.iter().all(|v| v.is_finite()))
            .unwrap_or([
                0.0,
                0.0,
                if offset.is_finite() {
                    offset
                } else {
                    gun.barrel_length_mm * 0.001
                },
            ])
    };
    let mut result = vec![MountedGun {
        instance: MAIN.into(),
        gun: w.main_gun.clone(),
        trunnion: w.mount_m,
        muzzle_vector: muzzle(&target.def.weapons, &w.main_gun, w.muzzle_offset()),
    }];
    // These sources share the primary turret and elevation axis. Extra turrets
    // remain outside this adapter until each independent native pose is owned.
    for (i, g) in w.extra_guns.iter().enumerate() {
        if g.gun.missile.is_some() {
            continue;
        }
        result.push(MountedGun {
            instance: format!("gun:0:{}", i + 1),
            gun: g.gun.clone(),
            trunnion: g.mount_m,
            muzzle_vector: muzzle(
                &target.def.weapons["extra_guns"][i],
                &g.gun,
                g.muzzle_offset(),
            ),
        });
    }
    result
}
fn feed_stock(u: &Unit, index: usize) -> u32 {
    u.ammo
        .counts
        .get(&u.model.mounted[index].instance)
        .map(|c| c.iter().copied().sum())
        .unwrap_or(0)
}
fn aim_selection(
    u: &Unit,
    projectiles: &std::collections::HashMap<String, ProjectileDef>,
    he_only: bool,
) -> Option<(usize, usize)> {
    let caps = tg_combat::caps(&u.model.target, &u.state);
    u.model
        .mounted
        .iter()
        .enumerate()
        .find_map(|(index, mount)| {
            if !caps
                .weapons
                .get(&mount.instance)
                .map(|c| c.can_fire)
                .unwrap_or(index == 0 && caps.can_fire)
            {
                return None;
            }
            let available = |selection: usize| {
                mount.gun.ammo.get(selection).is_some_and(|id| {
                    u.ammo.available(&u.model.ammo, &mount.instance, id)
                        && projectiles.get(id).is_some_and(|p| {
                            !he_only
                                || (p.kind == tg_weapon::ProjectileKind::He
                                    && p.explosive_mass_kg > 0.0)
                        })
                })
            };
            let remembered = if index == 0 {
                u.gun.selected_ammo
            } else {
                u.mounted_feeds[index].selected_ammo
            };
            let selected = if available(remembered) {
                Some(remembered)
            } else {
                (0..mount.gun.ammo.len()).find(|s| available(*s))
            }?;
            Some((index, selected))
        })
}
fn mounted_muzzle(u: &Unit, index: usize) -> turret::Muzzle {
    let mount = &u.model.mounted[index];
    let pivot = vec3(u.model.vehicle.def.turret.position_m.map(|v| v as f64));
    let trunnion =
        pivot + tg_shared::rotate_yaw(vec3(mount.trunnion.map(|v| v as f64)) - pivot, u.turret.yaw);
    let [x, y, z] = mount.muzzle_vector;
    let (sp, cp) = u.turret.pitch.sin_cos();
    let offset = Vec3::new(x, y * cp + z * sp, z * cp - y * sp);
    turret::Muzzle {
        trunnion,
        pos: trunnion + tg_shared::rotate_yaw(offset, u.turret.yaw),
        dir: turret::gun_dir_local(&u.turret),
    }
}
/// The same fixed-step exterior dynamics as a native ground round. This is a
/// fire-control prediction only; it neither queries a target collider nor
/// changes a physical projectile, target state or damage result.
fn predicted_ground_round(
    shell: &ProjectileDef,
    origin: [f64; 3],
    platform_velocity: [f64; 3],
    yaw: f64,
    pitch: f64,
    time: f64,
) -> ([f64; 3], [f64; 3]) {
    let cp = pitch.cos();
    let dir = [yaw.sin() * cp, pitch.sin(), yaw.cos() * cp];
    let mut p = origin;
    let mut v = add(
        scale(dir, shell.muzzle_velocity_ms as f64),
        platform_velocity,
    );
    let area = std::f64::consts::PI * (shell.caliber_mm as f64 * 0.0005).powi(2);
    let drag =
        0.5 * 1.225 * area * shell.drag_coefficient as f64 / (shell.mass_kg as f64).max(0.001);
    let mut remaining = time;
    while remaining > 1e-10 {
        let dt = remaining.min(FIXED_DT);
        let a = add(scale(v, -drag * length(v)), [0.0, -9.81, 0.0]);
        p = add(p, add(scale(v, dt), scale(a, 0.5 * dt * dt)));
        v = add(v, scale(a, dt));
        remaining -= dt;
    }
    (p, v)
}
fn cross(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0],
    ]
}
/// Constant-velocity crew prediction with numerical correction for the actual
/// source shell's drag and gravity. No sensor/radar capability is implied;
/// callers must supply an admitted, observed target themselves.
fn ballistic_lead(
    shell: &ProjectileDef,
    origin: [f64; 3],
    platform_velocity: [f64; 3],
    target: [f64; 3],
    target_velocity: [f64; 3],
) -> Result<[f64; 3], String> {
    let speed = shell.muzzle_velocity_ms as f64;
    if !speed.is_finite()
        || speed <= 0.0
        || !shell.drag_coefficient.is_finite()
        || shell.drag_coefficient < 0.0
        || !shell.mass_kg.is_finite()
        || shell.mass_kg <= 0.0
    {
        return Err("invalid source ballistic projectile".into());
    }
    let relative = sub(target, origin);
    let relative_velocity = sub(target_velocity, platform_velocity);
    let a = dot(relative_velocity, relative_velocity) - speed * speed;
    let b = 2.0 * dot(relative, relative_velocity);
    let c = dot(relative, relative);
    if c < 1.0 {
        return Err("ballistic aim target too close".into());
    }
    let mut time = if a.abs() < 1e-8 {
        if b < 0.0 {
            -c / b
        } else {
            f64::INFINITY
        }
    } else {
        let disc = b * b - 4.0 * a * c;
        if disc < 0.0 {
            return Err("ballistic target cannot be intercepted".into());
        }
        [
            (-b - disc.sqrt()) / (2.0 * a),
            (-b + disc.sqrt()) / (2.0 * a),
        ]
        .into_iter()
        .filter(|t| *t > 0.0)
        .fold(f64::INFINITY, f64::min)
    };
    if !time.is_finite() || time > 20.0 {
        return Err("ballistic target exceeds native round lifetime".into());
    }
    let initial = add(
        add(relative, scale(relative_velocity, time)),
        [0.0, 4.905 * time * time, 0.0],
    );
    let mut yaw = initial[0].atan2(initial[2]);
    let mut pitch = initial[1].atan2(initial[0].hypot(initial[2]));
    for _ in 0..9 {
        let (p, v) = predicted_ground_round(shell, origin, platform_velocity, yaw, pitch, time);
        let error = sub(p, add(target, scale(target_velocity, time)));
        if length(error) < 0.25 {
            return Ok([
                yaw.sin() * pitch.cos(),
                pitch.sin(),
                yaw.cos() * pitch.cos(),
            ]);
        }
        let epsilon = 0.0005;
        let dy = scale(
            sub(
                predicted_ground_round(
                    shell,
                    origin,
                    platform_velocity,
                    yaw + epsilon,
                    pitch,
                    time,
                )
                .0,
                p,
            ),
            1.0 / epsilon,
        );
        let dp = scale(
            sub(
                predicted_ground_round(
                    shell,
                    origin,
                    platform_velocity,
                    yaw,
                    pitch + epsilon,
                    time,
                )
                .0,
                p,
            ),
            1.0 / epsilon,
        );
        let dt = sub(v, target_velocity);
        let det = dot(dy, cross(dp, dt));
        if !det.is_finite() || det.abs() < 1e-8 {
            return Err("ballistic firing solution singular".into());
        }
        let correction = scale(error, -1.0);
        yaw += (dot(correction, cross(dp, dt)) / det).clamp(-0.3, 0.3);
        pitch += (dot(dy, cross(correction, dt)) / det).clamp(-0.3, 0.3);
        time +=
            (dot(dy, cross(dp, correction)) / det).clamp(-time.max(0.2) * 0.5, time.max(0.2) * 0.5);
        if !yaw.is_finite()
            || !pitch.is_finite()
            || !(0.001..=20.0).contains(&time)
            || pitch.abs() > std::f64::consts::FRAC_PI_2
        {
            return Err("ballistic firing solution unreachable".into());
        }
    }
    Err("ballistic firing solution did not converge".into())
}
fn request_native_aim(u: &mut Unit, direction: [f64; 3], tolerance: f64) -> bool {
    let d = u.tank.body.local_dir(direction);
    let yaw = d[0].atan2(d[2]);
    let pitch = d[1].atan2(d[0].hypot(d[2]));
    let w = &u.model.vehicle.weapons;
    let gun = &w.main_gun;
    let in_elevation = pitch >= -(gun.max_depression_deg as f64).to_radians()
        && pitch <= (gun.max_elevation_deg as f64).to_radians();
    let in_traverse = w.yaw_limit_deg.is_none_or(|[lo, hi]| {
        let relative = turret::wrap_pi(yaw as f32 - w.facing_deg.to_radians());
        relative >= lo.to_radians() && relative <= hi.to_radians()
    });
    // Keep the requested angle, so the source limiter may turn to its real
    // mechanical stop; a clamped request must never be reported as ready.
    u.input.turret_yaw = Some(yaw);
    u.input.gun_pitch = Some(pitch);
    in_elevation
        && in_traverse
        && (turret::wrap_pi(yaw as f32 - u.turret.yaw) as f64).abs() < tolerance
        && (pitch - u.turret.pitch as f64).abs() < tolerance
}
fn tracked_trigger_ready(u: &Unit, now: f64) -> bool {
    let Some(track) = u.aim_track else {
        return true;
    };
    let age = now - track.sampled_at;
    if !(0.0..=0.5).contains(&age) {
        return false;
    }
    let want = add(track.direction, scale(track.direction_rate, age));
    let length = length(want);
    let dir = u.tank.body.world_dir(
        turret::gun_dir_local(&u.turret)
            .to_array()
            .map(|v| v as f64),
    );
    length > 1e-9 && dot(dir, want) / length > 0.003f64.cos()
}
fn step_native_batch(
    units: &mut [&mut Unit],
    ground: &MapGround,
    obstacles: &[(u64, Obstacle)],
    now: f64,
    profile: bool,
) -> UnitBatch {
    let mut batch = UnitBatch {
        events: Vec::new(),
        timing: profile.then(SimTimings::default),
    };
    for unit in units {
        let started = batch.timing.as_ref().map(|_| Instant::now());
        if let Some(event) = step_native_unit(unit, ground, obstacles, now, batch.timing.as_mut()) {
            batch.events.push(event);
        }
        if let (Some(timing), Some(started)) = (batch.timing.as_mut(), started) {
            timing.summed_unit_elapsed_ns += started.elapsed().as_nanos() as u64;
        }
    }
    batch
}

fn accepted_damage_changed(before: &TargetState, after: &TargetState) -> bool {
    !before.destroyed && (before.modules != after.modules
        || before.crew != after.crew
        || before.destroyed != after.destroyed
        || before.ammo_detonated != after.ammo_detonated
        || after.fire_s > before.fire_s)
}
// Kinetic filler remains contained until native combat records a real delayed
// detonation. That report is target-local: cross-entity APHE exit flight and blast
// propagation are not implemented here, so filler alone must never create them.
fn has_immediate_contact_explosion(shell: &ProjectileDef) -> bool {
    !shell.kind.is_kinetic() && shell.explosive_mass_kg > 0.0
}
fn accepted_world_bursts(
    report: &tg_combat::Report,
    shell: &ProjectileDef,
    world_point: impl Fn([f64; 3]) -> [f64; 3],
) -> Vec<Value> {
    report.bursts.iter().map(|burst| {
        // Preserve the native detonation's IDs, timing, position, charge and
        // mechanism rather than reconstructing its physics from the hit point.
        let mut record = serde_json::to_value(burst).expect("native burst serializes");
        record["world_position"] = json!(world_point(burst.pos.to_array().map(|v| v as f64)));
        record["raw_explosive_kg"] = json!(burst.explosive_kg);
        record["tnt_equivalent_kg"] = json!(burst.explosive_kg * tg_weapon::explosive_re_factor(&shell.explosive_type));
        record["explosive_type"] = json!(shell.explosive_type);
        if burst.mechanism.is_none() && has_immediate_contact_explosion(shell) {
            record["mechanism"] = json!("immediate_he");
            record["time_origin"] = json!("first_contact");
            if burst.time_s.is_none() {
                record["time_s"] = json!(0.0);
            }
        }
        record
    }).collect()
}
fn immediate_world_bursts(shell: &ProjectileDef, pos: [f64; 3]) -> Vec<Value> {
    if !has_immediate_contact_explosion(shell) {
        return Vec::new();
    }
    vec![json!({
        "world_position": pos,
        "mechanism": "immediate_he",
        "time_origin": "first_contact",
        "time_s": 0.0,
        "explosive_kg": shell.explosive_mass_kg,
        "raw_explosive_kg": shell.explosive_mass_kg,
        "tnt_equivalent_kg": shell.tnt_equivalent_kg(),
        "explosive_type": shell.explosive_type
    })]
}
fn accepted_air_blast(
    scene: &mut crate::frontline_air::AirWorld,
    r: &Round,
    pos: [f64; 3],
    friendly_damage: bool,
    exclude: Option<u64>,
    events: &mut Vec<SimEvent>,
) {
    for target in scene.blast(
        pos,
        r.shell.tnt_equivalent_kg() as f64,
        r.team,
        r.seed,
        friendly_damage,
        exclude,
    ) {
        events.push(SimEvent{kind:"blast".into(),shooter:Some(r.shooter),target:Some(target),pos,detail:json!({"shot_id":r.id,"damage_applied":true,"damage_changed":true,"airborne":true})});
    }
}
impl SimWorld {
    pub(crate) fn install_naval(&mut self, config: &crate::frontline_naval::NavalConfig, next: &mut u64) -> Result<(), String> {
        if self.naval.is_some() {return Err("naval fleet already installed".into());}
        for ship in &config.vessels {
            if !self.projectiles.contains_key(&ship.shell_id) || !self.ground.contains(ship.pos[0],ship.pos[2])
                || ship.route.iter().any(|p|!self.ground.contains(p[0],p[1])) {return Err("invalid naval source weapon/route".into());}
        }
        self.naval=Some(crate::frontline_naval::NavalWorld::new(config,self.battle_id,next)?);Ok(())
    }
    pub(crate) fn naval_views(&self) -> Vec<crate::frontline_naval::VesselView> {
        self.naval.as_ref().map(|n|n.views()).unwrap_or_default()
    }
    pub(crate) fn naval_geometry_catalog(&self) -> Vec<Value> {
        self.naval.as_ref().map(|n|n.geometry_catalog()).unwrap_or_default()
    }
    fn step_naval(&mut self, events:&mut Vec<SimEvent>) {
        let Some(mut naval)=self.naval.take() else{return;};
        let shots=naval.step(FIXED_DT,|observer,target,a,b|self.perception_los(observer,target,a,b));
        self.naval=Some(naval);
        for shot in shots {
            let Some(shell)=self.projectiles.get(&shot.shell_id).cloned() else{continue;};
            if let Ok(mut event)=self.launch_air_round(shot.shooter.unit,shot.team,shell,shot.pos,shot.velocity,None,"naval_gun",shot.ammo_revision) {
                event.detail["airborne"]=json!(false);event.detail["naval"]=json!(true);events.push(event);
            }
        }
    }
    pub fn load(data: &Path, map: &Value) -> Result<Self, String> {
        let ground = MapGround::load(data, map)?;
        let facilities = load_facilities(map, &ground)?;
        let materials = Arc::new(
            serde_json::from_slice(
                &std::fs::read(data.join("materials.json")).map_err(|e| e.to_string())?,
            )
            .map_err(|e| e.to_string())?,
        );
        let combat = crate::server::load_combat(data);
        let mut models = BTreeMap::new();
        for (id, target) in combat.targets {
            let Ok(vehicle) = tg_vehicle::load_vehicle(&data.join("vehicles").join(&id)) else {
                continue;
            };
            let Some(plant) = TankModel::from_vehicle(
                &vehicle,
                TankOpts {
                    substeps: 1,
                    ..Default::default()
                },
            ) else {
                continue;
            };
            let Ok(ammo) = AmmoCatalog::from_target(&target, None) else {
                continue;
            };
            // Registered tracked ballistic guns only. Missile and wheeled-only
            // vehicles never appear as a working native tracked substitute.
            if vehicle.weapons.main_gun.missile.is_some()
                || vehicle
                    .weapons
                    .main_gun
                    .ammo
                    .iter()
                    .any(|id| !combat.projectiles.contains_key(id))
            {
                continue;
            }
            let collide_radius = plant
                .collide
                .iter()
                .map(|p| p[0].hypot(p[2]))
                .fold(0.0f64, f64::max);
            let mounted = mounted_guns(&vehicle, &target);
            if mounted.iter().any(|g| {
                g.gun
                    .ammo
                    .iter()
                    .any(|id| !combat.projectiles.contains_key(id))
            }) {
                continue;
            }
            models.insert(
                id,
                Arc::new(Model {
                    vehicle,
                    plant,
                    target,
                    ammo,
                    collide_radius,
                    mounted,
                }),
            );
        }
        if models.is_empty() {
            return Err("no supported native tracked vehicle models".into());
        }
        Ok(Self {
            models,
            units: BTreeMap::new(),
            naval: None,
            facility_boxes: facility_obstacles(&facilities),
            facility_applied_revision: facilities.revision(),
            facilities,
            materials,
            ground,
            projectiles: Arc::new(combat.projectiles),
            rounds: vec![],
            accumulator: 0.0,
            now: 0.0,
            serial: 0,
            battle_id: 1,
            friendly_damage: false,
            timing: native_timing_enabled().then(SimTimings::default),
            unit_worker_capacity: std::thread::available_parallelism()
                .map(|n| n.get().min(4))
                .unwrap_or(1),
            #[cfg(test)]
            forced_unit_workers: None,
        })
    }
    /// Distinct terrain/navigation and mutable lives per theatre, sharing only
    /// immutable accepted vehicle models and projectile definitions.
    pub(crate) fn for_map(&self, data: &Path, map: &Value) -> Result<Self, String> {
        let ground = MapGround::load(data, map)?;
        let facilities = load_facilities(map, &ground)?;
        Ok(Self {
            models: self.models.clone(),
            units: BTreeMap::new(),
            naval: None,
            ground,
            facility_boxes: facility_obstacles(&facilities),
            facility_applied_revision: facilities.revision(),
            facilities,
            materials: self.materials.clone(),
            projectiles: self.projectiles.clone(),
            rounds: vec![],
            accumulator: 0.0,
            now: 0.0,
            serial: 0,
            battle_id: 1,
            friendly_damage: self.friendly_damage,
            timing: self.timing.map(|_| SimTimings::default()),
            unit_worker_capacity: self.unit_worker_capacity,
            #[cfg(test)]
            forced_unit_workers: self.forced_unit_workers,
        })
    }
    fn native_unit_workers(&self) -> usize {
        #[cfg(test)]
        if let Some(forced) = self.forced_unit_workers {
            return forced.clamp(1, 4).min(self.units.len().max(1));
        }
        if self.units.len() < 16 {
            1
        } else {
            self.unit_worker_capacity.clamp(1, 4)
        }
    }
    pub fn set_battle_id(&mut self, battle: u64) -> Result<(), String> {
        AmmoScope::new(battle, 1)?;
        if !self.units.is_empty() || !self.rounds.is_empty() {
            return Err("battle identity cannot change in an active native world".into());
        }
        self.ground.bind_bridge_battle(battle);
        self.battle_id = battle;
        Ok(())
    }
    pub fn facility_views(&self) -> Vec<FacilityView> {
        self.facilities.views()
    }
    pub fn facility_geometry_catalog(&self) -> Vec<FacilityGeometry> {
        self.facilities.geometry_catalog()
    }
    pub fn facility_job_views(&self) -> Vec<FacilityJobView> {
        self.facilities.job_views()
    }
    pub fn facility_position(&self, id: &str) -> Option<[f64; 3]> {
        self.facilities.position(id)
    }
    pub fn facility_work_distance(&self, id: &str, p: [f64; 3]) -> Option<f64> {
        self.facilities.distance_to(id, p)
    }
    fn support_pose_clear(
        &self,
        model: &Model,
        x: f64,
        z: f64,
        yaw: f64,
        ignore: Option<u64>,
    ) -> bool {
        if ![x, z, yaw].iter().all(|v| v.is_finite()) {
            return false;
        }
        let mut tank = Tank::new(&model.plant);
        tank::place(&model.plant, &mut tank, &self.ground, x, z, yaw);
        if model.plant.collide.iter().any(|p| {
            let p = tank.body.world_point(*p);
            !self.ground.ground_navigation_allowed(p[0], p[2])
                || !self.ground.has_support(p[0], p[2])
        }) {
            return false;
        }
        let body = obstacle_for(&tank, &model.vehicle);
        !self.facility_boxes.iter().any(|b| boxes_overlap(body, *b))
            && !self.units.values().any(|u| {
                Some(u.id) != ignore && boxes_overlap(body, obstacle_for(&u.tank, &u.model.vehicle))
            })
    }
    pub(crate) fn airport_support_sources(
        &self,
        team: u8,
        chassis: &str,
    ) -> Vec<(String, Vec<([f64; 3], f64)>)> {
        let Some(model) = self.models.get(chassis) else {
            return Vec::new();
        };
        self.ground
            .airport_support
            .iter()
            .filter(|(_, a)| a.0 == team)
            .map(|(id, (_, apron))| {
                let strip = &self.ground.runway_sources[id];
                let f = apron.forward;
                let yaw = f[0].atan2(f[1]);
                let mut slots = Vec::new();
                for longitudinal in [-120.0, -100.0, -80.0, 80.0, 100.0, 120.0] {
                    let lateral = strip.half_width + 25.0;
                    let x = apron.center[0] + f[1] * lateral + f[0] * longitudinal;
                    let z = apron.center[1] - f[0] * lateral + f[1] * longitudinal;
                    if self.support_pose_clear(model, x, z, yaw, None) {
                        slots.push(([x, self.ground.height(x, z), z], yaw));
                    }
                }
                (id.clone(), slots)
            })
            .collect()
    }
    pub(crate) fn support_destination(&self, id: u64, facility: &str) -> Option<[f64; 2]> {
        let u = self.units.get(&id)?;
        if !u.is_support {
            return None;
        }
        let f = self.facilities.view(facility)?;
        if f.team.is_some_and(|team| team != u.team) {
            return None;
        }
        let p = u.tank.body.origin();
        let bounds = self.facilities.bounds(facility)?;
        let center = [
            (bounds[0][0] + bounds[1][0]) / 2.0,
            (bounds[0][2] + bounds[1][2]) / 2.0,
        ];
        let mut candidates = Vec::new();
        if f.kind == FacilityKind::Bridge {
            if let (Some(policy), Some(beds)) = (&self.ground.policy, &self.ground.roadbeds) {
                if let Some(bridge) = policy.bridges.iter().find(|b| b.id == f.source_id) {
                    for &index in &bridge.segments {
                        let s = beds.segments[index];
                        let length = (s[3] - s[0]).hypot(s[4] - s[1]);
                        if length < 1e-6 {
                            continue;
                        }
                        for sign in [-1.0, 1.0] {
                            let endpoint = if sign < 0.0 {
                                [s[0], s[1]]
                            } else {
                                [s[3], s[4]]
                            };
                            for offset in [8.0, 14.0, 20.0] {
                                candidates.push([
                                    endpoint[0] + sign * (s[3] - s[0]) / length * offset,
                                    endpoint[1] + sign * (s[4] - s[1]) / length * offset,
                                ]);
                            }
                        }
                    }
                }
            }
        }
        for radius in [12.0, 18.0, 22.0] {
            for i in 0..24 {
                let angle = i as f64 * std::f64::consts::TAU / 24.0;
                candidates.push([
                    center[0] + radius * angle.sin(),
                    center[1] + radius * angle.cos(),
                ]);
            }
        }
        candidates
            .into_iter()
            .filter(|at| {
                let yaw = (at[0] - p[0]).atan2(at[1] - p[2]);
                self.facilities
                    .distance_to(facility, [at[0], self.ground.height(at[0], at[1]), at[1]])
                    .is_some_and(|d| d <= 24.0)
                    && self.support_pose_clear(&u.model, at[0], at[1], yaw, Some(id))
            })
            .min_by(|a, b| {
                (a[0] - p[0])
                    .hypot(a[1] - p[2])
                    .total_cmp(&(b[0] - p[0]).hypot(b[1] - p[2]))
            })
    }
    pub(crate) fn support_local_route(&self, id: u64, facility: &str) -> Option<Vec<[f64; 2]>> {
        let u = self.units.get(&id)?;
        let f = self.facilities.view(facility)?;
        let field = f.airfield?;
        let (team, apron) = self.ground.airport_support.get(&field)?;
        if *team != u.team {
            return None;
        }
        let at = u.tank.body.origin();
        let dx = at[0] - apron.center[0];
        let dz = at[2] - apron.center[1];
        let forward = apron.forward;
        let along = dx * forward[0] + dz * forward[1];
        let lateral = dx * forward[1] - dz * forward[0];
        if lateral.abs() > apron.half_width || along.abs() > apron.half_length {
            return None;
        }
        let target = self.support_destination(id, facility)?;
        let target_along =
            (target[0] - apron.center[0]) * forward[0] + (target[1] - apron.center[1]) * forward[1];
        let lane = self.ground.runway_sources[&field].half_width + 25.0;
        let point = |long: f64| {
            [
                apron.center[0] + forward[1] * lane + forward[0] * long,
                apron.center[1] - forward[0] * lane + forward[1] * long,
            ]
        };
        Some(vec![
            [at[0], at[2]],
            point(along),
            point(target_along),
            target,
        ])
    }
    /// Admit only a consecutive prefix whose actual native plant footprint is
    /// clear. A bridge hole or road boundary cannot be skipped to reach a job.
    pub(crate) fn support_route_prefix(&self, id: u64, points: &[[f64; 2]]) -> Vec<[f64; 2]> {
        let Some(u) = self.units.get(&id) else {
            return Vec::new();
        };
        if !u.is_support || points.len() > 16384 {
            return Vec::new();
        }
        let p = u.tank.body.origin();
        let mut at = [p[0], p[2]];
        let mut result = vec![at];
        let mut total = 0.0;
        for &target in points {
            let length = (target[0] - at[0]).hypot(target[1] - at[1]);
            if !length.is_finite() {
                break;
            }
            if length < 1e-6 {
                continue;
            }
            total += length;
            if total > 200_000.0 {
                break;
            }
            let heading = (target[0] - at[0]).atan2(target[1] - at[1]);
            let samples = (length / 1.0).ceil() as usize;
            let start = at;
            for i in 1..=samples {
                let t = i as f64 / samples as f64;
                let next = [
                    start[0] + (target[0] - start[0]) * t,
                    start[1] + (target[1] - start[1]) * t,
                ];
                if !self.support_pose_clear(&u.model, next[0], next[1], heading, Some(id)) {
                    if at != *result.last().unwrap() {
                        result.push(at);
                    }
                    return result;
                }
                at = next;
            }
            result.push(at);
        }
        result
    }
    pub fn source_supply_open(&self, id: &str) -> Option<bool> {
        self.facilities.source_supply_open(id)
    }
    pub fn facility_airfield_capabilities(
        &self,
        id: &str,
    ) -> Option<crate::frontline_facilities::AirfieldFacilityCapabilities> {
        self.facilities.airfield_capabilities(id)
    }
    pub fn facility_route_states(&self) -> Vec<(String, bool)> {
        let mut routes = BTreeMap::new();
        for f in self
            .facilities
            .views()
            .iter()
            .filter(|f| f.kind == FacilityKind::Bridge)
        {
            for r in &f.road_ids {
                let open = routes.entry(r.clone()).or_insert(true);
                *open &= f.capabilities.passable;
            }
        }
        routes.into_iter().collect()
    }
    fn checked_native_ref(&self, r: UnitRef) -> Result<&Unit, String> {
        let u = self.units.get(&r.unit).ok_or("Unknown native worker")?;
        if r.battle != self.battle_id || r.life != u.life {
            return Err("Stale/foreign native worker identity".into());
        }
        Ok(u)
    }
    pub fn set_facility_worker_roles(
        &mut self,
        r: UnitRef,
        roles: FacilityWorkerRoles,
    ) -> Result<(), String> {
        let u = self.checked_native_ref(r)?;
        if !u.is_support || roles.combat || roles.engineer == roles.supply {
            return Err("Worker roles require a real admitted unarmed support conversion".into());
        }
        self.units.get_mut(&r.unit).unwrap().facility_roles = roles;
        Ok(())
    }
    pub fn spawn_support_unit(
        &mut self,
        id: u64,
        vehicle: &str,
        team: u8,
        pos: [f64; 3],
        heading: f64,
        roles: FacilityWorkerRoles,
    ) -> Result<(), String> {
        if !matches!(vehicle, "de_pzjg1" | "de_rso_pak40" | "su_att_m46")
            || roles.combat
            || roles.engineer == roles.supply
        {
            return Err("Unsupported campaign support conversion/role".into());
        }
        let base = self
            .models
            .get(vehicle)
            .ok_or("Missing support native chassis")?
            .clone();
        let mut model = (*base).clone();
        let mut def = model.target.def.clone();
        if def.surfaces.is_some() {
            return Err("Support conversion requires explicit source surface ownership".into());
        }
        def.plates.retain(|p| {
            !matches!(
                p.zone,
                tg_armor::ArmorZone::TurretFront
                    | tg_armor::ArmorZone::TurretSide
                    | tg_armor::ArmorZone::TurretRear
                    | tg_armor::ArmorZone::TurretRoof
                    | tg_armor::ArmorZone::GunMantlet
            ) && !p.id.contains("turret")
                && !p.id.contains("mantlet")
                && !p.id.contains("shield")
                && !p.id.contains("gun")
        });
        def.modules.retain(|m| {
            !matches!(
                m.kind,
                tg_combat::ModuleKind::GunBarrel
                    | tg_combat::ModuleKind::GunBreech
                    | tg_combat::ModuleKind::Launcher
                    | tg_combat::ModuleKind::AmmoRack
                    | tg_combat::ModuleKind::MachineGun
                    | tg_combat::ModuleKind::TurretDrive
                    | tg_combat::ModuleKind::HorizontalDrive
                    | tg_combat::ModuleKind::VerticalDrive
                    | tg_combat::ModuleKind::ApsGun
                    | tg_combat::ModuleKind::ApsRadar
            )
        });
        def.crew.retain(|c| {
            !matches!(
                c.role,
                tg_combat::CrewRole::Gunner | tg_combat::CrewRole::Loader
            )
        });
        def.turret = None;
        def.ammo_capacity = 0;
        def.weapons = json!({"mount_m":[0,0,0],"main_gun":{"id":"campaign_unarmed","ammo":[],"ammo_capacity":0,"damage":{"critical":[]}}});
        def.machine_guns = json!([]);
        def.visual = json!({});
        model.target = Target::new(def, &self.materials);
        self.spawn_unit(id, vehicle, team, pos, heading)?;
        let u = self.units.get_mut(&id).unwrap();
        u.model = Arc::new(model);
        u.state = u.model.target.fresh_state();
        u.is_support = true;
        u.facility_roles = roles;
        for counts in u
            .ammo
            .targets
            .values_mut()
            .chain(u.ammo.counts.values_mut())
        {
            counts.fill(0);
        }
        u.ammo.bump()?;
        tg_combat::load_ammo(&u.model.target, &mut u.state, 0);
        Ok(())
    }
    pub fn request_facility_job(
        &mut self,
        kind: FacilityJobKind,
        id: &str,
        expected_revision: u64,
        r: UnitRef,
        team: u8,
    ) -> Result<FacilityJobView, String> {
        let u = self.checked_native_ref(r)?;
        if u.state.destroyed
            || u.team != team
            || !u.is_support
            || !(if kind == FacilityJobKind::Repair {
                u.facility_roles.engineer
            } else {
                u.facility_roles.supply
            })
        {
            return Err("Native support worker/role not eligible".into());
        }
        self.facilities
            .request_job(kind, id, expected_revision, r, team)
    }
    pub fn cancel_facility_job(&mut self, id: u64, r: UnitRef) -> Result<FacilityJobView, String> {
        self.checked_native_ref(r)?;
        if !self
            .facilities
            .job_views()
            .iter()
            .any(|j| j.job_id == id && j.worker_unit == r)
        {
            return Err("Foreign facility job".into());
        }
        self.facilities.cancel_job(id)
    }
    fn native_facility_workers(&self) -> Vec<FacilityWorker> {
        self.units
            .values()
            .map(|u| FacilityWorker {
                unit: UnitRef {
                    battle: self.battle_id,
                    unit: u.id,
                    life: u.life,
                },
                team: u.team,
                alive: !u.state.destroyed,
                pos: u.tank.body.origin(),
                speed_mps: length(u.tank.body.v),
                engineer: u.facility_roles.engineer,
                supply: u.facility_roles.supply,
                combat: u.facility_roles.combat,
            })
            .collect()
    }
    fn accept_facility_events(
        &mut self,
        accepted: Vec<FacilityEvent>,
        shooter: u64,
        events: &mut Vec<SimEvent>,
    ) {
        for e in accepted {
            events.push(SimEvent {
                kind: e.kind.clone(),
                shooter: (shooter != 0).then_some(shooter),
                target: None,
                pos: self.facilities.position(&e.facility_id).unwrap_or([0.0; 3]),
                detail: json!(e),
            });
        }
        self.sync_facilities();
    }
    fn sync_facilities(&mut self) {
        if self.facility_applied_revision == self.facilities.revision() {
            return;
        }
        for f in self
            .facilities
            .views()
            .iter()
            .filter(|f| f.kind == FacilityKind::Bridge)
        {
            if let Some(state) = self.ground.bridge_state(&f.source_id) {
                if state.destroyed == f.capabilities.passable {
                    self.ground
                        .set_bridge_destroyed(
                            &f.source_id,
                            state.revision,
                            !f.capabilities.passable,
                        )
                        .expect("accepted facility/source bridge binding");
                }
            }
        }
        self.ground
            .set_runway_closures(self.facilities.runway_closed_regions())
            .expect("validated facility runway regions");
        self.facility_boxes = facility_obstacles(&self.facilities);
        self.facility_applied_revision = self.facilities.revision();
    }
    /// Domain lifecycle fixture only: accepted native crew loss makes a unit terminal.
    /// No executable runtime command or fake hit-point counter is exposed.
    #[cfg(test)]
    pub(crate) fn destroy_unit_for_frontline_test(&mut self, id: u64) {
        let u = self
            .units
            .get_mut(&id)
            .expect("existing fixture native unit");
        u.state.crew.fill(0.0);
        // advance evaluates terminal crew loss while resolving an active native fire.
        u.state.fire_s = 0.1;
        u.state.fire_at = u.model.target.def.crew.first().map(|c| c.pos);
        tg_combat::advance(&u.model.target, &mut u.state, FIXED_DT as f32, id);
        assert!(
            u.state.destroyed,
            "native crew-loss rule must terminate the fixture"
        );
    }
    /// Partial source-module damage for control-transfer preservation tests only.
    #[cfg(test)]
    pub(crate) fn damage_unit_for_frontline_test(&mut self, id: u64) {
        let u = self
            .units
            .get_mut(&id)
            .expect("existing fixture native unit");
        let index = u
            .model
            .target
            .def
            .modules
            .iter()
            .position(|m| m.kind == tg_combat::ModuleKind::Engine)
            .expect("source engine module");
        u.state.modules[index] = u.model.target.def.modules[index].max_health * 0.45;
        assert!(!u.state.destroyed);
        assert!(tg_combat::caps(&u.model.target, &u.state).drive_power < 1.0);
    }
    pub fn available_vehicles(&self) -> Vec<String> {
        self.models.keys().cloned().collect()
    }
    pub fn ground_role_options(&self, era: u32) -> Vec<GroundRoleOption> {
        self.models
            .iter()
            .filter_map(|(id, model)| {
                let meta = model.vehicle.def.meta.as_ref()?;
                if meta.year == 0
                    || meta.year > era
                    || !model.vehicle.weapons.extra_turrets.is_empty()
                {
                    return None;
                }
                let (role, prototype, air_range_m, ground_range_m) = match id.as_str() {
                    "de_flakpz38t" | "de_rso_flak" => {
                        (GroundCombatRole::AirDefense, false, 2200.0, 1400.0)
                    }
                    "de_gepard" => (GroundCombatRole::AirDefense, false, 3500.0, 2000.0),
                    "us_m10" => (GroundCombatRole::FireSupport, false, 0.0, 3500.0),
                    "su_att_m46" => (GroundCombatRole::FireSupport, true, 0.0, 6000.0),
                    _ => return None,
                };
                Some(GroundRoleOption {
                    vehicle: id.clone(),
                    role,
                    year: meta.year,
                    source_class: meta.class.clone(),
                    prototype,
                    air_range_m,
                    ground_range_m,
                })
            })
            .collect()
    }
    pub fn exists(&self, id: u64) -> bool {
        self.units.contains_key(&id)
    }
    pub fn remove_unit(&mut self, id: u64) -> bool {
        self.units.remove(&id).is_some()
    }
    pub fn spawn_unit(
        &mut self,
        id: u64,
        vehicle: &str,
        team: u8,
        pos: [f64; 3],
        heading: f64,
    ) -> Result<(), String> {
        if id == 0 || self.units.contains_key(&id) {
            return Err("duplicate or invalid sim unit ID".into());
        }
        if team > 1
            || !pos.iter().all(|x| x.is_finite())
            || !heading.is_finite()
            || !self.ground.contains(pos[0], pos[2])
        {
            return Err("invalid spawn pose/team or outside canonical terrain".into());
        }
        let model = self
            .models
            .get(vehicle)
            .ok_or("unsupported native vehicle")?
            .clone();
        let mut tank = Tank::new(&model.plant);
        tank::place(
            &model.plant,
            &mut tank,
            &self.ground,
            pos[0],
            pos[2],
            heading,
        );
        if let Some(local) = model.plant.collide.iter().find(|p| {
            let world = tank.body.world_point(**p);
            !self.ground.ground_navigation_allowed(world[0], world[2])
        }) {
            #[cfg(test)]
            {
                let world = tank.body.world_point(*local);
                eprintln!("native spawn footprint rejected: id={id} vehicle={vehicle} origin={pos:?} heading={heading} local={local:?} world={world:?} canonical={} water={:?}",self.ground.height(world[0],world[2]),self.ground.water_level(world[0],world[2]));
            }
            #[cfg(not(test))]
            let _ = local;
            return Err(
                "Native hull/track footprint touches wet, unknown or unregistered ground".into(),
            );
        }
        let candidate = obstacle_for(&tank, &model.vehicle);
        if self
            .facility_boxes
            .iter()
            .any(|b| boxes_overlap(candidate, *b))
        {
            return Err("spawn overlaps an authored visible facility".into());
        }
        for u in self.units.values() {
            let other = obstacle_for(&u.tank, &u.model.vehicle);
            if boxes_overlap(candidate, other) {
                return Err("spawn overlaps existing physical unit".into());
            }
        }
        let ammo = AmmoLedger::new(AmmoScope::new(self.battle_id, id)?, &model.ammo, None)?;
        let mut state = model.target.fresh_state();
        tg_combat::load_ammo(&model.target, &mut state, ammo.finite_total()?);
        let mounted_feeds = model
            .mounted
            .iter()
            .map(|g| MountedFeed {
                belt_left: g
                    .gun
                    .autocannon
                    .as_ref()
                    .map(|a| {
                        a.belt_rounds.min(
                            ammo.counts
                                .get(&g.instance)
                                .map(|n| n.iter().copied().sum())
                                .unwrap_or(0),
                        )
                    })
                    .unwrap_or(0),
                ..Default::default()
            })
            .collect();
        self.units.insert(
            id,
            Unit {
                id,
                team,
                model,
                tank,
                state,
                ammo,
                gun: GunState::default(),
                turret: TurretState::default(),
                input: SimInput::default(),
                life: 1,
                facility_roles: FacilityWorkerRoles::default(),
                submerged_s: 0.0,
                is_support: false,
                weapon_trigger: false,
                mounted_feeds,
                aim_track: None,
            },
        );
        Ok(())
    }
    pub fn set_input(&mut self, id: u64, input: SimInput) -> Result<(), String> {
        if ![input.throttle, input.steer, input.brake]
            .iter()
            .all(|x| x.is_finite())
            || ![input.turret_yaw, input.gun_pitch]
                .iter()
                .flatten()
                .all(|x| x.is_finite())
        {
            return Err("nonfinite native input".into());
        }
        let u = self.units.get_mut(&id).ok_or("unknown sim unit")?;
        if input.turret_yaw.is_some() || input.gun_pitch.is_some() {
            u.aim_track = None;
        }
        u.input = SimInput {
            throttle: input.throttle.clamp(-1.0, 1.0),
            steer: input.steer.clamp(-1.0, 1.0),
            brake: input.brake.clamp(0.0, 1.0),
            turret_yaw: input.turret_yaw.or(u.input.turret_yaw),
            gun_pitch: input.gun_pitch.or(u.input.gun_pitch),
        };
        Ok(())
    }
    /// A driver asks the native gearbox/brakes to slow before a registered bend.
    /// In particular, do not carry straight-road speed into a near-right-angle turn
    /// and then depend on the roadside contacts to redirect the body.
    pub(crate) fn navigation_input(
        &self,
        id: u64,
        waypoint: [f64; 2],
        next: Option<[f64; 2]>,
    ) -> Result<SimInput, String> {
        let u = self.units.get(&id).ok_or("unknown sim unit")?;
        let p = u.tank.body.origin();
        let heading = u.tank.body.ez[0].atan2(u.tank.body.ez[2]);
        let dx = waypoint[0] - p[0];
        let dz = waypoint[1] - p[2];
        let distance = dx.hypot(dz);
        let mut steering_point = waypoint;
        if let Some(next) = next {
            let length = (next[0] - waypoint[0]).hypot(next[1] - waypoint[1]);
            if length > 1e-6 && distance < 12.0 {
                // The hull's nose reaches a bend before its origin does. Follow
                // a short section of the registered outgoing segment early;
                // this is a steering request, never a pose/path shortcut.
                let t = ((12.0 - distance) / length).clamp(0.0, 1.0);
                steering_point = [
                    waypoint[0] + (next[0] - waypoint[0]) * t,
                    waypoint[1] + (next[1] - waypoint[1]) * t,
                ];
            }
        }
        let error = turret::wrap_pi(
            ((steering_point[0] - p[0]).atan2(steering_point[1] - p[2]) - heading) as f32,
        ) as f64;
        let speed = u.tank.body.v[0].hypot(u.tank.body.v[2]);
        let mut desired_speed: f64 = 6.0;
        if let Some(next) = next {
            let turn = turret::wrap_pi(
                ((next[0] - waypoint[0]).atan2(next[1] - waypoint[1]) - dx.atan2(dz)) as f32,
            )
            .abs() as f64;
            if turn > 0.35 {
                // Stop/creep before a sharp bend, leaving room for the real hull.
                desired_speed = desired_speed.min((1.0 + 2.0 * (distance - 4.0).max(0.0)).sqrt());
            }
        }
        let turning = error.abs() > 0.25;
        if turning {
            desired_speed = desired_speed.min(1.0);
        }
        let brake = if speed > desired_speed + 0.35 {
            1.0
        } else {
            0.0
        };
        let throttle = if turning || brake > 0.0 {
            0.0
        } else {
            (desired_speed / u.model.plant.pt.v_top.max(1.0) + 0.12 * (desired_speed - speed))
                .clamp(0.0, 0.65) as f32
        };
        Ok(SimInput {
            throttle,
            steer: (error * 1.8).clamp(-1.0, 1.0) as f32,
            brake,
            ..Default::default()
        })
    }
    /// Set desired aim through the actual hull frame; real slew occurs in fixed steps.
    /// Gravity compensation uses the currently selected source projectile speed, not a hit guarantee.
    pub fn aim_at(&mut self, id: u64, target: [f64; 3]) -> Result<bool, String> {
        if !target.iter().all(|x| x.is_finite()) {
            return Err("nonfinite aim point".into());
        }
        let u = self.units.get_mut(&id).ok_or("unknown sim unit")?;
        u.aim_track = None;
        if let Some(index) = available_selection(u) {
            u.gun.selected_ammo = index;
        }
        let mount = u.model.vehicle.weapons.mount_m.map(|v| v as f64);
        let local = u.tank.body.local_point(target);
        let d = sub(local, mount);
        let range = d[0].hypot(d[2]);
        let shell = u
            .model
            .vehicle
            .weapons
            .main_gun
            .ammo
            .get(u.gun.selected_ammo)
            .and_then(|id| self.projectiles.get(id));
        let speed = shell.map(|p| p.muzzle_velocity_ms as f64).unwrap_or(800.0);
        let yaw = d[0].atan2(d[2]);
        let pitch = (d[1] + 4.905 * (range / speed).powi(2)).atan2(range);
        u.input.turret_yaw = Some(yaw);
        u.input.gun_pitch = Some(pitch);
        Ok((turret::wrap_pi(yaw as f32 - u.turret.yaw)).abs() < 0.006
            && (pitch as f32 - u.turret.pitch).abs() < 0.006)
    }
    /// Lead an observed moving aircraft/ground target using the selected native
    /// projectile, platform velocity, gravity and drag. Actual slew and firing
    /// are separate fixed-step operations; readiness is not a promised hit.
    pub fn aim_at_moving(
        &mut self,
        id: u64,
        target: [f64; 3],
        velocity: [f64; 3],
    ) -> Result<bool, String> {
        if !target.iter().chain(&velocity).all(|v| v.is_finite()) {
            return Err("nonfinite moving aim target".into());
        }
        let u = self.units.get_mut(&id).ok_or("unknown sim unit")?;
        if u.state.destroyed || u.is_support {
            return Err("native weapon disabled".into());
        }
        let (index, selection) = aim_selection(u, &self.projectiles, false)
            .ok_or("no available native mounted gun/ammunition")?;
        let shell = self
            .projectiles
            .get(&u.model.mounted[index].gun.ammo[selection])
            .ok_or("missing source projectile")?;
        let muzzle = mounted_muzzle(u, index);
        let origin = u
            .tank
            .body
            .world_point(muzzle.pos.to_array().map(|v| v as f64));
        let direction = ballistic_lead(shell, origin, u.tank.body.v, target, velocity)?;
        let future_direction = ballistic_lead(
            shell,
            add(origin, scale(u.tank.body.v, 0.05)),
            u.tank.body.v,
            add(target, scale(velocity, 0.05)),
            velocity,
        )
        .unwrap_or(direction);
        u.aim_track = Some(AimTrack {
            direction,
            direction_rate: scale(sub(future_direction, direction), 20.0),
            sampled_at: self.now,
        });
        if index == 0 {
            u.gun.selected_ammo = selection;
        }
        u.mounted_feeds[index].selected_ammo = selection;
        Ok(request_native_aim(u, direction, 0.0025))
    }
    /// Source HE fire support over an intervening obstruction. The supported
    /// solution is the low arc within the source gun's actual mechanical stops
    /// and native20s exterior-round lifetime. It does not bypass terrain or
    /// create an impact at the requested coordinate.
    pub fn aim_indirect(&mut self, id: u64, target: [f64; 3]) -> Result<bool, String> {
        if !target.iter().all(|v| v.is_finite()) {
            return Err("nonfinite indirect aim target".into());
        }
        let u = self.units.get_mut(&id).ok_or("unknown sim unit")?;
        if u.state.destroyed || u.is_support {
            return Err("native weapon disabled".into());
        }
        if length(u.tank.body.v) > 0.5 {
            return Err("fire-support platform must stop to lay the gun".into());
        }
        let (index, selection) =
            aim_selection(u, &self.projectiles, true).ok_or("no source HE ammunition")?;
        let shell = &self.projectiles[&u.model.mounted[index].gun.ammo[selection]];
        let muzzle = mounted_muzzle(u, index);
        let origin = u
            .tank
            .body
            .world_point(muzzle.pos.to_array().map(|v| v as f64));
        let direction = ballistic_lead(shell, origin, u.tank.body.v, target, [0.0; 3])?;
        u.aim_track = Some(AimTrack {
            direction,
            direction_rate: [0.0; 3],
            sampled_at: self.now,
        });
        if index == 0 {
            u.gun.selected_ammo = selection;
        }
        u.mounted_feeds[index].selected_ammo = selection;
        Ok(request_native_aim(u, direction, 0.0015))
    }
    pub fn fire(&mut self, id: u64, ammo: Option<&str>) -> Result<SimEvent, String> {
        self.fire_mounted(id, 0, ammo)
    }
    /// A native held trigger, independent of the20Hz network/AI request rate.
    /// Admission never emits a round or spends inventory until a fixed step.
    pub fn set_weapon_trigger(&mut self, id: u64, held: bool) -> Result<(), String> {
        let u = self.units.get_mut(&id).ok_or("unknown sim unit")?;
        if held && (u.is_support || u.state.destroyed) {
            return Err("native weapon disabled".into());
        }
        u.weapon_trigger = held;
        Ok(())
    }
    fn fire_mounted(
        &mut self,
        id: u64,
        index: usize,
        ammo: Option<&str>,
    ) -> Result<SimEvent, String> {
        if self.rounds.len() >= 20_000 {
            return Err("native projectile capacity".into());
        }
        let u = self.units.get_mut(&id).ok_or("unknown sim unit")?;
        if u.is_support || u.facility_roles.engineer || u.facility_roles.supply {
            return Err("unarmed campaign support conversion cannot fire".into());
        }
        let mount = u
            .model
            .mounted
            .get(index)
            .ok_or("unknown native mounted gun")?
            .clone();
        let gun = &mount.gun;
        let instance = &mount.instance;
        if gun.missile.is_some() {
            return Err("guided mounted weapon not admitted as a ballistic gun".into());
        }
        let remembered = if index == 0 {
            u.gun.selected_ammo
        } else {
            u.mounted_feeds[index].selected_ammo
        };
        let selected = match ammo {
            Some(a) => gun
                .ammo
                .iter()
                .position(|x| x == a)
                .ok_or("wrong mounted projectile")?,
            None => gun
                .ammo
                .get(remembered)
                .filter(|sid| u.ammo.available(&u.model.ammo, instance, sid))
                .map(|_| remembered)
                .or_else(|| {
                    gun.ammo
                        .iter()
                        .position(|sid| u.ammo.available(&u.model.ammo, instance, sid))
                })
                .ok_or("no_ammo")?,
        };
        let sid = gun.ammo.get(selected).ok_or("no selected projectile")?;
        let shell = self
            .projectiles
            .get(sid)
            .ok_or("missing projectile definition")?
            .clone();
        let caps = tg_combat::caps(&u.model.target, &u.state);
        let cap = caps.weapons.get(instance);
        if index > 0 && cap.is_none() {
            return Err("unregistered mounted damage owner".into());
        }
        let can_fire = cap.map(|w| w.can_fire).unwrap_or(caps.can_fire);
        if !can_fire || u.state.destroyed {
            return Err("native weapon disabled".into());
        }
        if u.turret.pitch < -gun.max_depression_deg.to_radians() - 1e-5
            || u.turret.pitch > gun.max_elevation_deg.to_radians() + 1e-5
        {
            return Err("outside native mounted elevation arc".into());
        }
        if !u.ammo.available(&u.model.ammo, instance, sid) {
            return Err("no_ammo".into());
        }
        let mut candidate_feed = u.mounted_feeds[index].clone();
        let feed = &mut candidate_feed;
        if self.now + 1e-9 < feed.next_shot {
            return Err("reloading".into());
        }
        if let Some(automatic) = &gun.autocannon {
            if automatic.belt_rounds == 0
                || !automatic.rate_rpm.is_finite()
                || automatic.rate_rpm <= 0.0
                || !automatic.belt_reload_s.is_finite()
                || automatic.belt_reload_s < 0.0
            {
                return Err("invalid source automatic feed".into());
            }
            if automatic.spin_up_s > 0.0 && feed.spin < 0.15 {
                return Err("spinning_up".into());
            }
            if feed.belt_left == 0 {
                if feed.belt_ready <= 0.0 || self.now + 1e-9 < feed.belt_ready {
                    return Err("reloading".into());
                }
                let stock = feed_stock(u, index);
                feed.belt_left = automatic.belt_rounds.min(stock);
                feed.belt_ready = 0.0;
                if stock == 0 {
                    return Err("no_ammo".into());
                }
            }
        }
        let serial = self.serial.checked_add(1).ok_or("shot serial exhausted")?;
        let seed = serial.wrapping_mul(0x9e3779b97f4a7c15) ^ id;
        let local = mounted_muzzle(u, index);
        let spread = cap.map(|w| w.dispersion_mult).unwrap_or(1.0);
        let dir = fire::disperse(local.dir, gun.dispersion_mrad * spread, &mut Rng::new(seed));
        let pos = u
            .tank
            .body
            .world_point(local.pos.to_array().map(|x| x as f64));
        let dir = u.tank.body.world_dir(dir.to_array().map(|x| x as f64));
        let velocity = add(scale(dir, shell.muzzle_velocity_ms as f64), u.tank.body.v);
        if !pos.iter().chain(&velocity).all(|v| v.is_finite()) {
            return Err("nonfinite native discharge pose".into());
        }
        // A rejected revision/capacity operation must not consume a shell or
        // advance its feed. All mounted stock is one authoritative transaction.
        let mut inventory = u.ammo.clone();
        inventory.spend(&u.model.ammo, instance, sid)?;
        inventory.bump()?;
        let total = inventory.finite_total()?;
        let reload_mult = cap.map(|w| w.reload_mult).unwrap_or(caps.reload_mult) as f64;
        let feed = &mut candidate_feed;
        feed.selected_ammo = selected;
        let interval = gun
            .autocannon
            .as_ref()
            .map(|a| {
                a.interval_s() as f64 * reload_mult
                    / if a.spin_up_s > 0.0 {
                        feed.spin.max(0.15)
                    } else {
                        1.0
                    }
            })
            .unwrap_or(gun.reload_s as f64 * reload_mult);
        feed.next_shot = if feed.next_shot <= 0.0 || feed.next_shot < self.now - FIXED_DT * 1.1 {
            self.now + interval
        } else {
            feed.next_shot + interval
        };
        if let Some(automatic) = &gun.autocannon {
            feed.belt_left -= 1;
            if feed.belt_left == 0 {
                feed.belt_ready = self.now + automatic.belt_reload_s as f64 * reload_mult;
                feed.next_shot = feed.next_shot.max(feed.belt_ready);
            }
        }
        if index == 0 {
            u.gun.selected_ammo = selected;
            u.gun.reload_remaining_s = (feed.next_shot - self.now).max(0.0) as f32;
        }
        u.mounted_feeds[index] = candidate_feed;
        self.serial = serial;
        u.ammo = inventory;
        tg_combat::load_ammo(&u.model.target, &mut u.state, total);
        let detail = json!({"shot_id":serial,"weapon_instance":instance,"projectile_id":sid,"caliber_mm":shell.caliber_mm,"velocity":velocity,"seed":seed.to_string(),"ammo_revision":u.ammo.revision,"contact_model":"native_legacy_plates_boxes"});
        self.rounds.push(Round {
            id: serial,
            shooter: id,
            team: u.team,
            shell,
            pos,
            velocity,
            age: 0.0,
            distance: 0.0,
            seed,
            air: None,
            gun_tracer: None,
        });
        Ok(SimEvent {
            kind: "shot".into(),
            shooter: Some(id),
            target: None,
            pos,
            detail,
        })
    }
    pub fn snapshot(&self, id: u64) -> Option<SimSnapshot> {
        self.units.get(&id).map(snapshot)
    }
    /// Called only by the authoritative mounted aircraft weapon owner after admission.
    pub fn launch_air_round(
        &mut self,
        shooter: u64,
        team: u8,
        shell: ProjectileDef,
        pos: [f64; 3],
        velocity: [f64; 3],
        air: Option<AirOrdnance>,
        weapon: &str,
        revision: u64,
    ) -> Result<SimEvent, String> {
        if shooter == 0
            || team > 1
            || !self.ground.contains(pos[0], pos[2])
            || !pos.iter().chain(&velocity).all(|v| v.is_finite())
            || shell.mass_kg <= 0.0
            || self.rounds.len() >= 20000
        {
            return Err("invalid/over-capacity authoritative air projectile".into());
        }
        if air.as_ref().is_some_and(|a| {
            !a.direction
                .iter()
                .chain([&a.mass, &a.diameter, &a.dv, &a.burn])
                .all(|v| v.is_finite())
                || a.mass <= 0.0
                || a.diameter <= 0.0
                || a.burn < 0.0
                || a.dv < 0.0
        }) {
            return Err("invalid air store dynamics".into());
        }
        self.serial = self.serial.checked_add(1).ok_or("shot serial exhausted")?;
        let detail = json!({"shot_id":self.serial,"weapon_instance":weapon,"projectile_id":shell.id,"caliber_mm":shell.caliber_mm,"velocity":velocity,"ammo_revision":revision,"airborne":true,"store":air.is_some(),"store_id":air.as_ref().map(|a|a.store_id.as_str()),"guidance":air.as_ref().and_then(|a|a.guided.as_ref()).map(|g|g.phase.as_str()),"contact_model":"native_legacy_plates_boxes_and_accepted_aircraft_boxes"});
        self.rounds.push(Round {
            id: self.serial,
            shooter,
            team,
            shell,
            pos,
            velocity,
            age: 0.0,
            distance: 0.0,
            seed: self.serial.wrapping_mul(0x9e3779b97f4a7c15) ^ shooter,
            air,
            gun_tracer: None,
        });
        Ok(SimEvent {
            kind: "shot".into(),
            shooter: Some(shooter),
            target: None,
            pos,
            detail,
        })
    }
    pub fn snapshots(&self) -> Vec<SimSnapshot> {
        self.units.values().map(snapshot).collect()
    }
    /// Metadata never launches, advances, contacts or removes a combat round.
    pub(crate) fn mark_air_gun_tracer(&mut self, shot_id: u64, style: AirGunTracerStyle) {
        if let Some(round) = self.rounds.last_mut().filter(|r| r.id == shot_id
            && r.shooter == style.shooter.unit && r.air.is_none()
            && style.shooter.battle == self.battle_id) {
            round.gun_tracer = Some(style);
        }
    }
    pub fn kinematics(&self) -> Vec<SimKinematics> {
        self.units
            .values()
            .map(|u| SimKinematics {
                id: u.id,
                team: u.team,
                alive: !u.state.destroyed,
                pos: u.tank.body.origin(),
                velocity: u.tank.body.v,
            })
            .collect()
    }
    pub(crate) fn guidance_targets(&self)->Vec<crate::frontline_air::guided::Target>{
        let mut targets:Vec<_>=self.units.values().map(|u|crate::frontline_air::guided::Target{
            reference:UnitRef{battle:self.battle_id,unit:u.id,life:u.life},team:u.team,air:false,alive:!u.state.destroyed,
            pos:u.tank.body.world_point(((u.model.target.lo+u.model.target.hi)*0.5).to_array().map(|x|x as f64)),
            velocity:u.tank.body.v,emitting:false,jam_search:0.0,jam_track:0.0,
        }).collect();
        targets.extend(self.naval_views().into_iter().map(|u|crate::frontline_air::guided::Target{
            reference:u.unit,team:u.team,air:false,alive:u.alive,pos:[u.pos[0],u.pos[1]+1.5,u.pos[2]],velocity:u.velocity,
            emitting:false,jam_search:0.,jam_track:0.}));targets
    }
    pub(crate) fn guidance_target(&self,reference:UnitRef)->Option<crate::frontline_air::guided::Target>{
        self.guidance_targets().into_iter().find(|t|t.reference==reference)
    }
    pub(crate) fn guided_ordnance_views(&self)->Vec<crate::frontline_air::guided::View>{
        self.rounds.iter().filter_map(|r|{let d=r.air.as_ref()?;Some(crate::frontline_air::guided::View{shot_id:r.id,shooter:r.shooter,team:r.team,store_id:d.store_id.clone(),pos:r.pos,velocity:r.velocity,age:r.age,phase:d.guided.as_ref().map(|g|g.phase.as_str()).unwrap_or("ballistic").into()})}).collect()
    }
    pub(crate) fn air_gun_tracer_views(&self)->Vec<AirGunTracerView>{
        // Newest surviving native rounds have priority under the display cap.
        self.rounds.iter().rev().filter_map(|r| {
            let d=r.gun_tracer.as_ref()?;
            let lifetime=if d.style=="bullet" {3.2}else{15.0};
            (r.age<=lifetime).then(||AirGunTracerView {
                shot_id:r.id,shooter:d.shooter,team:r.team,projectile_id:r.shell.id.clone(),
                pos:r.pos,velocity:r.velocity,age:r.age,distance_m:r.distance,
                color:d.color,caliber_mm:r.shell.caliber_mm,style:d.style,width_scale:d.width_scale,
            })
        }).take(512).collect()
    }
    pub(crate) fn has_radio_missile(&self,launcher:UnitRef)->bool{
        self.rounds.iter().any(|r|r.air.as_ref().and_then(|d|d.guided.as_ref()).is_some_and(|g|g.launcher==launcher&&g.config.mode==crate::frontline_air::guided::Mode::Radio&&!g.lost))
    }
    pub(crate) fn unit_alive(&self, id: u64) -> bool {
        self.units.get(&id).is_some_and(|u| !u.state.destroyed)
    }
    pub(crate) fn unit_dead(&self, id: u64) -> bool {
        self.units.get(&id).is_some_and(|u| u.state.destroyed)
    }
    pub fn capture_presence(&self) -> Vec<crate::frontline_campaign::Presence> {
        self.units
            .values()
            .filter(|u| {
                !u.state.destroyed
                    && u.facility_roles.combat
                    && u.tank.contacts.iter().any(|c| c.load > 1.0)
            })
            .map(|u| crate::frontline_campaign::Presence {
                team: if u.team == 0 {
                    crate::frontline::Team::Blue
                } else {
                    crate::frontline::Team::Red
                },
                pos: u.tank.body.origin(),
                alive: true,
            })
            .collect()
    }
    pub fn time(&self) -> f64 {
        self.now
    }
    pub fn timings(&self) -> Option<SimTimings> {
        self.timing
    }
    pub fn active_projectiles(&self) -> usize {
        self.rounds.len()
    }
    pub fn height(&self, x: f64, z: f64) -> f64 {
        self.ground.height(x, z)
    }
    pub fn line_of_sight(&self, a: [f64; 3], b: [f64; 3]) -> bool {
        let n = (length(sub(b, a)) / 15.0).ceil().max(2.0) as usize;
        (1..n).all(|i| {
            let p = add(a, scale(sub(b, a), i as f64 / n as f64));
            p[1] > self.ground.height(p[0], p[2]) + 0.15
        })
    }
    /// Perception-only source scene: existing terrain and accepted native
    /// vehicle bounds. Endpoint units do not occlude their own sight segment.
    /// Retained wreck bodies still occlude; this remains the legacy box scene,
    /// not a claim of uploaded/render-triangle contact migration.
    pub(crate) fn perception_los(
        &self,
        observer: u64,
        target: u64,
        a: [f64; 3],
        b: [f64; 3],
    ) -> bool {
        self.perception_segment_los(observer,Some(target),a,b)
    }
    /// A point has no endpoint UnitRef to exempt from occlusion.
    pub(crate) fn guidance_point_visible(&self,observer:u64,a:[f64;3],b:[f64;3])->bool{
        if !a.iter().chain(&b).all(|v|v.is_finite()){return false;}
        let distance=length(sub(b,a));
        self.guidance_terrain_contact(a,b).is_none_or(|(_,d)|d>=distance-0.02)
            &&self.facilities.first_contact(a,b).is_ok_and(|hit|hit.is_none_or(|h|h.fraction<=1e-6||h.distance>=distance-0.02))
            &&self.units.iter().all(|(&id,unit)|id==observer||!segment_box(unit.tank.body.local_point(a),unit.tank.body.local_point(b),
                unit.model.target.lo.to_array().map(|v|v as f64),unit.model.target.hi.to_array().map(|v|v as f64)))
            &&self.naval.as_ref().is_none_or(|n|n.first_contact(a,b,Some(observer)).is_none_or(|h|length(sub(h.pos,a))>=distance-0.02))
    }
    fn perception_segment_los(&self,observer:u64,target:Option<u64>,a:[f64;3],b:[f64;3])->bool{
        a.iter().chain(&b).all(|v| v.is_finite())
            && self.line_of_sight(a, b)
            && self
                .facilities
                .first_contact(a, b)
                .is_ok_and(|hit| hit.is_none_or(|h| h.fraction <= 1e-6 || h.fraction >= 1.0 - 1e-6))
            && self.naval.as_ref().is_none_or(|n|n.first_contact(a,b,Some(observer)).is_none_or(|h|Some(h.unit.unit)==target))
            && self.units.iter().all(|(&id, unit)| {
                id == observer
                    || Some(id) == target
                    || !segment_box(
                        unit.tank.body.local_point(a),
                        unit.tank.body.local_point(b),
                        unit.model.target.lo.to_array().map(|v| v as f64),
                        unit.model.target.hi.to_array().map(|v| v as f64),
                    )
            })
    }
    /// Resolve the first finite accepted terrain/facility contact. Long sight rays
    /// are split into bounded short segments before using the projectile terrain query.
    pub(crate) fn guidance_point_contact(&self,observer:u64,a:[f64;3],sight:[f64;3],range:f64)->Result<Option<[f64;3]>,String>{
        if !a.iter().chain(&sight).all(|v|v.is_finite())||!range.is_finite()||range<=0.0{return Err("invalid_point_sight".into());}
        let b=add(a,scale(sight,range));
        let facility=self.facilities.first_contact(a,b)?;
        let terrain=self.guidance_terrain_contact(a,b);
        let mut point=match (terrain,facility){
            (Some((p,d)),Some(h))=>Some(if h.distance<=d{h.position}else{p}),
            (Some((p,_)),None)=>Some(p),(None,Some(h))=>Some(h.position),(None,None)=>None,
        };
        if let Some(hit)=self.naval.as_ref().and_then(|n|n.first_contact(a,b,Some(observer))) {
            if point.is_none_or(|p|length(sub(hit.pos,a))<length(sub(p,a))) {point=Some(hit.pos);}
        }
        if point.is_some_and(|p|!self.guidance_point_visible(observer,a,p)){return Err("point_blocked".into());}
        Ok(point)
    }
    fn guidance_terrain_contact(&self,a:[f64;3],b:[f64;3])->Option<([f64;3],f64)>{
        let steps=(length(sub(b,a))/15.0).ceil().clamp(1.0,4096.0) as usize;let mut prior=a;
        for i in 1..=steps{
            let next=add(a,scale(sub(b,a),i as f64/steps as f64));
            if let Some((point,_))=self.ground_intersection(prior,next){return Some((point,length(sub(point,a))));}
            prior=next;
        }None
    }
    /// Fixed120Hz nested in the host's20Hz tick; a backlog is retained, never time-scaled.
    pub fn step(&mut self, dt: f64) -> Vec<SimEvent> {
        if !dt.is_finite() || dt < 0.0 || dt > 0.25 {
            return vec![];
        }
        self.accumulator += dt;
        let mut events = vec![];
        while self.accumulator + 1e-10 >= FIXED_DT {
            self.accumulator -= FIXED_DT;
            self.now += FIXED_DT;
            self.step_naval(&mut events);
            self.fixed_step(&mut events, None)
        }
        events
    }
    pub fn step_combined(
        &mut self,
        dt: f64,
        air: &mut crate::frontline_air::AirWorld,
    ) -> Vec<SimEvent> {
        if !dt.is_finite() || !(0.0..=0.25).contains(&dt) {
            return vec![];
        }
        self.accumulator += dt;
        let mut events = Vec::new();
        while self.accumulator + 1e-10 >= FIXED_DT {
            self.accumulator -= FIXED_DT;
            self.now += FIXED_DT;
            self.step_naval(&mut events);
            let air_start = self.timing.as_ref().map(|_| Instant::now());
            air.sync_facility_availability(self);
            events.extend(air.step(FIXED_DT, self));
            if let (Some(t), Some(start)) = (self.timing.as_mut(), air_start) {
                t.air_ns += start.elapsed().as_nanos() as u64;
            }
            self.fixed_step(&mut events, Some(air));
        }
        events
    }
    fn fixed_step(
        &mut self,
        events: &mut Vec<SimEvent>,
        mut air: Option<&mut crate::frontline_air::AirWorld>,
    ) {
        let fixed_start = self.timing.as_ref().map(|_| Instant::now());
        let prep_start = self.timing.as_ref().map(|_| Instant::now());
        let mut obstacles: Vec<_> = self
            .units
            .values()
            .map(|u| (u.id, obstacle_for(&u.tank, &u.model.vehicle)))
            .collect();
        obstacles.extend(self.facility_boxes.iter().map(|o| (0, *o)));
        if let (Some(t), Some(start)) = (self.timing.as_mut(), prep_start) {
            t.contact_prep_ns += start.elapsed().as_nanos() as u64;
        }
        let profile = self.timing.is_some();
        let unit_phase_start = profile.then(Instant::now);
        let workers = self.native_unit_workers();
        let ground = &self.ground;
        let now = self.now;
        // BTreeMap order is retained in contiguous, disjoint mutable slices.
        // Workers never read the post-step pose of a neighbouring unit.
        let mut units: Vec<_> = self.units.values_mut().collect();
        let batches = if workers == 1 {
            vec![step_native_batch(
                &mut units, ground, &obstacles, now, profile,
            )]
        } else {
            let chunk_size = units.len().div_ceil(workers);
            std::thread::scope(|scope| {
                let mut chunks = units.chunks_mut(chunk_size);
                let main = chunks.next().unwrap();
                let handles: Vec<_> = chunks
                    .map(|chunk| {
                        let obstacles = &obstacles;
                        scope.spawn(move || {
                            step_native_batch(chunk, ground, obstacles, now, profile)
                        })
                    })
                    .collect();
                let mut batches = Vec::with_capacity(workers);
                batches.push(step_native_batch(main, ground, &obstacles, now, profile));
                // Concatenate only after joining in the original ID order.
                // There is no concurrently appended shared event buffer.
                for handle in handles {
                    batches.push(
                        handle
                            .join()
                            .unwrap_or_else(|panic| std::panic::resume_unwind(panic)),
                    );
                }
                batches
            })
        };
        let actual_workers = batches.len();
        for batch in batches {
            events.extend(batch.events);
            if let (Some(timing), Some(unit_timing)) = (self.timing.as_mut(), batch.timing) {
                timing.add_unit_timings(&unit_timing);
            }
        }
        if let (Some(timing), Some(started)) = (self.timing.as_mut(), unit_phase_start) {
            timing.unit_workers = actual_workers as u64;
            timing.parallel_fixed_steps += u64::from(actual_workers > 1);
            timing.unit_phase_wall_ns += started.elapsed().as_nanos() as u64;
        }
        let held: Vec<_> = self
            .units
            .values()
            .filter(|u| {
                u.weapon_trigger
                    && !u.state.destroyed
                    && !u.is_support
                    && tracked_trigger_ready(u, self.now)
            })
            .map(|u| (u.id, u.model.mounted.len()))
            .collect();
        for (id, count) in held {
            for index in 0..count {
                // A source rate may exceed120 rounds/s. Bounded catch-up
                // retains fractional phase without producing a late burst
                // after the trigger was released or the weapon was disabled.
                for _ in 0..8 {
                    match self.fire_mounted(id, index, None) {
                        Ok(event) => events.push(event),
                        Err(_) => break,
                    }
                }
            }
        }
        let projectile_start = self.timing.as_ref().map(|_| Instant::now());
        let rounds = std::mem::take(&mut self.rounds);
        // Reserve every unprocessed round until its contact/lifetime decision; taking the
        // queue must not make its surviving projectiles disappear from admission accounting.
        let mut pending_rounds=rounds.len();
        let mut guidance_targets=self.guidance_targets();
        if let Some(scene)=air.as_deref(){guidance_targets.extend(scene.combat_targets().into_iter().filter_map(|t|scene.guidance_target(t.unit)));}
        let countermeasures=air.as_deref().map(|scene|scene.active_countermeasures()).unwrap_or_default();
        for mut r in rounds {
            pending_rounds=pending_rounds.saturating_sub(1);
            let a=r.pos;
            if let Some(cluster)=r.air.as_ref().and_then(|d|d.cluster.as_ref()).filter(|c|
                r.age>1.0&&a[1]-self.ground.height(a[0],a[2])<c.open&&a[1]>self.ground.height(a[0],a[2])){
                let cluster=cluster.clone();let mut rng=Rng::new(r.seed);
                let child_count=cluster.count.min(20000usize.saturating_sub(self.rounds.len()+pending_rounds) as u32);
                let fall=((a[1]-self.ground.height(a[0],a[2]))/(-r.velocity[1]+15.0).max(20.0)).max(2.0);
                events.push(SimEvent{kind:"cluster_open".into(),shooter:Some(r.shooter),target:None,pos:a,
                    detail:json!({"shot_id":r.id,"store_id":r.air.as_ref().unwrap().store_id,"child_store_id":cluster.store_id,"child_count":child_count,"spread_m":cluster.spread})});
                for index in 0..child_count{
                    let angle=rng.next_f32() as f64*std::f64::consts::TAU;
                    let radius=(rng.next_f32() as f64).sqrt()*cluster.spread/fall;
                    let pos=std::array::from_fn(|i|a[i]+(rng.next_f32() as f64-0.5)*2.0);
                    let velocity=add(r.velocity,[angle.cos()*radius,(rng.next_f32() as f64-0.5)*4.0,angle.sin()*radius]);
                    let child=AirOrdnance{store_id:cluster.store_id.clone(),cluster:None,ramjet:None,direction:r.air.as_ref().unwrap().direction,bomb:true,diameter:cluster.diameter,mass:cluster.mass,dv:0.0,burn:0.0,sustain:None,guided:None};
                    if let Ok(mut event)=self.launch_air_round(r.shooter,r.team,cluster.shell.clone(),pos,velocity,Some(child),"cluster_child",0){
                        event.detail["parent_shot_id"]=json!(r.id);event.detail["child_index"]=json!(index);events.push(event);
                    }
                }
                continue;
            }
            let guidance_acceleration=if let Some(g)=r.air.as_mut().and_then(|a|a.guided.as_mut()){
                if g.binding.is_none()&&g.config.loal&&r.age<=g.config.reacquire{
                    let candidate=guidance_targets.iter().filter(|t|crate::frontline_air::guided::eligible(&g.config,r.team,a,r.velocity,r.velocity,t)&&self.perception_los(r.shooter,t.reference.unit,a,t.pos))
                        .min_by(|x,y|crate::frontline_air::guided::angle(r.velocity,sub(x.pos,a)).total_cmp(&crate::frontline_air::guided::angle(r.velocity,sub(y.pos,a))));
                    if let Some(target)=candidate{g.acquire(*target);}
                }
                let target=guidance_targets.iter().find(|t|Some(t.reference)==g.target).copied();
                let point=match g.binding{Some(crate::frontline_air::guided::TargetBinding::Point(p))=>Some(p),_=>None};
                let support=air.as_deref().and_then(|scene|if let Some(p)=point{scene.guidance_point_support(g.launcher,p)}else{scene.guidance_support(g.launcher,target)}).map(|mut support|{
                    let target_visible=if let Some(p)=point{self.guidance_point_visible(r.shooter,support.position,p)}else{target.is_some_and(|t|self.perception_los(r.shooter,t.reference.unit,support.position,t.pos))};
                    support.radar&=target_visible;support.laser&=target_visible;
                    support.beam&=target_visible&&if point.is_some(){self.guidance_point_visible(r.shooter,support.position,a)}else{self.perception_los(r.shooter,g.launcher.unit,support.position,a)};support
                });
                let los=if let Some(p)=point{self.guidance_point_visible(r.shooter,a,p)}else{target.is_some_and(|t|self.perception_los(r.shooter,t.reference.unit,a,t.pos))};
                g.observe_countermeasures(a,r.velocity,r.age,target,support,los,&countermeasures,r.seed^r.id.rotate_left(7),
                    |d|self.perception_los(r.shooter,d.owner.unit,a,d.pos));
                g.acceleration_control(a,r.velocity,r.age,target,support,los)
            }else{[0.0;3]};
            let speed = length(r.velocity);
            let area = std::f64::consts::PI * (r.shell.caliber_mm as f64 * 0.0005).powi(2);
            let drag = 0.5 * 1.225 * area * r.shell.drag_coefficient as f64
                / (r.shell.mass_kg as f64).max(0.001);
            let mut acc = add(scale(r.velocity, -drag * speed), [0.0, -9.81, 0.0]);
            if let Some(d) = &r.air {
                let rho = 1.225 * (-a[1].max(0.0) / 8500.0).exp();
                let cd = if d.bomb {
                    0.3
                } else if speed > 300.0 {
                    0.55
                } else {
                    0.45
                };
                let k = 0.5
                    * rho
                    * cd
                    * std::f64::consts::PI
                    * (d.diameter / 2.0).powi(2)
                    * 1.6
                    * speed
                    / d.mass;
                let thrust = if !d.bomb && r.age < d.burn && d.burn > 0.0 {
                    d.dv / d.burn
                } else if let Some([duration,acceleration])=d.sustain.filter(|[duration,_]|r.age<d.burn+duration) {
                    let _=duration;acceleration
                } else if let Some([target_speed,duration,k])=d.ramjet.filter(|[_,duration,_]|r.age<d.burn+duration){
                    let _=duration;(target_speed-speed).max(0.0)*k
                } else {
                    0.0
                };
                acc = add(
                    add(add(scale(if d.guided.is_some(){crate::frontline_air::guided::normalize(r.velocity)}else{d.direction}, thrust), scale(r.velocity, -k)),guidance_acceleration),
                    [0.0, -9.81, 0.0],
                );
                if let Some(g)=d.guided.as_ref().filter(|g|g.config.air_target) {
                    let induced=g.maneuver_drag(a,r.velocity,guidance_acceleration,r.age);
                    acc=sub(acc,scale(crate::frontline_air::guided::normalize(r.velocity),induced));
                }
            }
            let b = if r.air.is_some() {
                add(a, scale(add(r.velocity, scale(acc, FIXED_DT)), FIXED_DT))
            } else {
                add(
                    a,
                    add(
                        scale(r.velocity, FIXED_DT),
                        scale(acc, 0.5 * FIXED_DT * FIXED_DT),
                    ),
                )
            };
            r.velocity = add(r.velocity, scale(acc, FIXED_DT));
            let segment = length(sub(b, a));
            let ground_hit = self.ground_intersection(a, b);
            let facility_hit = match self.facilities.first_contact(a, b) {
                Ok(hit) => hit,
                Err(reason) => {
                    events.push(SimEvent {
                        kind: "facility_geometry_query_rejected".into(),
                        shooter: Some(r.shooter),
                        target: None,
                        pos: a,
                        detail: json!({"shot_id":r.id,"reason":reason}),
                    });
                    continue;
                }
            };
            let air_hit = air
                .as_deref()
                .and_then(|scene| scene.first_contact(a, b, r.shooter));
            let naval_hit=self.naval.as_ref().and_then(|n|n.first_contact(a,b,Some(r.shooter)));
            let naval_distance=naval_hit.as_ref().map(|h|h.fraction*segment);
            let mut contact: Option<(f64, u64, tg_combat::Report, [f64; 3])> = None;
            for (id, u) in &self.units {
                if *id == r.shooter {
                    continue;
                }
                let lo = u.tank.body.local_point(a);
                let end = u.tank.body.local_point(b);
                if !segment_box(
                    lo,
                    end,
                    u.model.target.lo.to_array().map(|x| x as f64),
                    u.model.target.hi.to_array().map(|x| x as f64),
                ) {
                    continue;
                }
                let local_dir = u.tank.body.local_dir(sub(b, a));
                let shot = tg_combat::Shot {
                    shell: r.shell.clone(),
                    origin: vec3(lo),
                    dir: vec3(local_dir).normalized(),
                    speed_ms: speed as f32,
                    distance_m: r.distance as f32,
                    seed: r.seed,
                    turret_yaw: u.turret.yaw,
                };
                let report = tg_combat::shoot(&u.model.target, &u.state, &shot);
                let Some(p) = report.impact else { continue };
                if !report.hit {
                    continue;
                }
                let p = u.tank.body.world_point(p.to_array().map(|x| x as f64));
                let along = dot(sub(p, a), sub(b, a)) / (segment * segment).max(1e-12);
                if !(-0.0001..=1.0001).contains(&along) {
                    continue;
                }
                let distance = length(sub(p, a));
                if ground_hit.is_some_and(|(_, g)| g < distance) {
                    continue;
                }
                if contact.as_ref().is_none_or(|(d, _, _, _)| distance < *d) {
                    contact = Some((distance, *id, report, p))
                }
            }
            let facility_first = facility_hit.filter(|hit| {
                let quant_tie = self.facilities.is_terrain_surface(hit)
                    && (hit.position[1] - self.ground.height(hit.position[0], hit.position[2]))
                        .abs()
                        <= 2e-4
                            + 4.0
                                * f32::EPSILON as f64
                                * (hit.position[1].abs()
                                    + 0.2 * (hit.position[0].abs() + hit.position[2].abs()));
                (ground_hit.is_none_or(|(_, g)| hit.distance <= g) || quant_tie)
                    && naval_distance.is_none_or(|d|hit.distance<d)
                    && air_hit.as_ref().is_none_or(|(d, _, _)| hit.distance < *d)
                    && contact
                        .as_ref()
                        .is_none_or(|(d, _, _, _)| hit.distance < *d)
            });
            let proximity=r.air.as_ref().and_then(|d|d.guided.as_ref()).and_then(|g|{
                let target=guidance_targets.iter().find(|t|Some(t.reference)==g.target).copied()?;
                let pos=g.proximity(a,b,target,FIXED_DT)?;let distance=length(sub(pos,a));
                (ground_hit.is_none_or(|(_,d)|distance<d)
                    &&naval_distance.is_none_or(|d|distance<d)
                    &&facility_first.as_ref().is_none_or(|h|distance<h.distance)
                    &&air_hit.as_ref().is_none_or(|(d,_,_)|distance<*d)
                    &&contact.as_ref().is_none_or(|(d,_,_,_)|distance<*d)
                    &&self.perception_los(r.shooter,target.reference.unit,a,pos)).then_some(pos)
            });
            if let Some(pos)=proximity{
                events.push(SimEvent{kind:"missile_proximity".into(),shooter:Some(r.shooter),target:None,pos,
                    detail:json!({"shot_id":r.id,"projectile_id":r.shell.id,"store_id":r.air.as_ref().and_then(|d|d.guided.as_ref()).map(|g|g.store_id.as_str()),"mechanism":"swept_aircraft_proximity_fuze","world_bursts":immediate_world_bursts(&r.shell,pos)})});
                self.splash(&r,pos,events,None);
                if let Some(scene)=air.as_deref_mut(){accepted_air_blast(scene,&r,pos,self.friendly_damage,None,events);}
                continue;
            }
            if let Some(hit)=naval_hit.filter(|h|{
                let d=h.fraction*segment;
                ground_hit.is_none_or(|(_,g)|d<g)&&facility_first.as_ref().is_none_or(|f|d<f.distance)
                    &&air_hit.as_ref().is_none_or(|(a,_,_)|d<*a)&&contact.as_ref().is_none_or(|(c,_,_,_)|d<*c)
            }) {
                let naval=self.naval.as_mut().unwrap();
                let alive=naval.views().iter().any(|s|s.unit==hit.unit&&s.alive);
                let changed=naval.impact(&hit,&r.shell,r.velocity,r.team,self.friendly_damage);
                let sunk=alive&&naval.views().iter().any(|s|s.unit==hit.unit&&!s.alive);
                events.push(SimEvent{kind:"impact".into(),shooter:Some(r.shooter),target:Some(hit.unit.unit),pos:hit.pos,
                    detail:json!({"shot_id":r.id,"projectile_id":r.shell.id,"naval":true,"contact_model":"same_visible_float32_naval_triangles",
                        "contact":hit,"damage_applied":changed,"damage_changed":changed,"world_bursts":immediate_world_bursts(&r.shell,hit.pos)})});
                if sunk {events.push(SimEvent{kind:"destroyed".into(),shooter:Some(r.shooter),target:Some(hit.unit.unit),pos:hit.pos,detail:json!({"shot_id":r.id,"naval":true})});}
                if has_immediate_contact_explosion(&r.shell) {
                    self.splash(&r,hit.pos,events,Some(hit.unit.unit));
                    if let Some(scene)=air.as_deref_mut(){accepted_air_blast(scene,&r,hit.pos,self.friendly_damage,None,events);}
                }
                continue;
            }
            if let Some(hit) = facility_first {
                let effect = self.facilities.impact(
                    &hit,
                    &FacilityImpact {
                        event_id: r.id,
                        team: r.team,
                        energy_j: 0.5 * r.shell.mass_kg as f64 * speed * speed,
                        tnt_kg: if has_immediate_contact_explosion(&r.shell) {
                            r.shell.tnt_equivalent_kg() as f64
                        } else { 0.0 },
                        friendly_damage: self.friendly_damage,
                    },
                );
                match effect {
                    Ok(effect) => self.accept_facility_events(effect, r.shooter, events),
                    Err(reason) => events.push(SimEvent {
                        kind: "facility_impact_rejected".into(),
                        shooter: Some(r.shooter),
                        target: None,
                        pos: hit.position,
                        detail: json!({"shot_id":r.id,"reason":reason}),
                    }),
                }
                events.push(SimEvent{kind:"facility_impact".into(),shooter:Some(r.shooter),target:None,pos:hit.position,detail:json!({"shot_id":r.id,"contact":hit,"projectile_id":r.shell.id,"contact_model":"same_visible_float32_facility_triangles","world_bursts":immediate_world_bursts(&r.shell,hit.position)})});
                if has_immediate_contact_explosion(&r.shell) {
                    self.splash(&r, hit.position, events, None);
                    if let Some(scene) = air.as_deref_mut() {
                        accepted_air_blast(
                            scene,
                            &r,
                            hit.position,
                            self.friendly_damage,
                            None,
                            events,
                        );
                    }
                }
                continue;
            }
            if let Some((d, id, pos)) = air_hit.filter(|(d, _, _)| {
                ground_hit.is_none_or(|(_, g)| *d < g)
                    && contact.as_ref().is_none_or(|(g, _, _, _)| *d < *g)
            }) {
                let _ = d;
                let scene = air.as_deref_mut().unwrap();
                if let Some(report) = scene.hit(
                    id,
                    a,
                    b,
                    &r.shell,
                    r.velocity,
                    r.team,
                    r.seed,
                    self.friendly_damage,
                ) {
                    events.push(SimEvent {
                        kind: "impact".into(),
                        shooter: Some(r.shooter),
                        target: Some(id),
                        pos,
                        detail: json!({"shot_id":r.id,"report":report}),
                    });
                }
                if has_immediate_contact_explosion(&r.shell) {
                    self.splash(&r, pos, events, None);
                    accepted_air_blast(scene, &r, pos, self.friendly_damage, Some(id), events);
                }
                continue;
            }
            if let Some((_, id, mut report, pos)) = contact {
                let u = self.units.get_mut(&id).unwrap();
                let shot=tg_combat::Shot {shell:r.shell.clone(),origin:vec3(u.tank.body.local_point(a)),
                    dir:vec3(u.tank.body.local_dir(sub(b,a))).normalized(),speed_ms:speed as f32,
                    distance_m:r.distance as f32,seed:r.seed,turret_yaw:u.turret.yaw};
                report=crate::he_effects::contact(&u.model.target,&u.state,&shot,report);
                let friendly = u.team == r.team;
                let alive = !u.state.destroyed;
                let damage_changed = (!friendly || self.friendly_damage)
                    && accepted_damage_changed(&u.state, &report.state);
                if !friendly || self.friendly_damage {
                    u.state = report.state.clone()
                } else {
                    // Only accepted state may cross the event channel. The contact is real,
                    // but native hypothetical damage is suppressed by the room rule.
                    report.state = u.state.clone();
                    report.caps = tg_combat::caps(&u.model.target, &u.state);
                    report.modules.clear();
                    report.crew.clear();
                    report.cause_transitions.clear();
                    report.events = vec!["friendly_damage_suppressed".into()];
                }
                let world_bursts = accepted_world_bursts(&report, &r.shell, |local| u.tank.body.world_point(local));
                events.push(SimEvent{kind:"impact".into(),shooter:Some(r.shooter),target:Some(id),pos,detail:json!({"shot_id":r.id,"friendly_block":friendly&&!self.friendly_damage,"damage_applied":!friendly||self.friendly_damage,"damage_changed":damage_changed,"contact_model":"native_legacy_plates_boxes","report":report,"world_bursts":world_bursts})});
                if alive && u.state.destroyed {
                    events.push(SimEvent {
                        kind: "destroyed".into(),
                        shooter: Some(r.shooter),
                        target: Some(id),
                        pos,
                        detail: json!({"shot_id":r.id}),
                    })
                }
                if has_immediate_contact_explosion(&r.shell) {
                    // Only an immediate contact explosive supplies this exterior blast.
                    // Delayed APHE detonation evidence stays in the native report above.
                    self.splash(&r, pos, events, Some(id));
                    if let Some(scene) = air.as_deref_mut() {
                        accepted_air_blast(scene, &r, pos, self.friendly_damage, None, events);
                    }
                }
                // First accepted physical target consumes the exterior flight. Native combat
                // traces its penetration/spall internally; multi-vehicle exit flight is pending.
                continue;
            }
            if let Some((pos, _)) = ground_hit {
                events.push(SimEvent {
                    kind: "terrain_impact".into(),
                    shooter: Some(r.shooter),
                    target: None,
                    pos,
                    detail: json!({"shot_id":r.id,"projectile_id":r.shell.id,"world_bursts":immediate_world_bursts(&r.shell,pos)}),
                });
                if has_immediate_contact_explosion(&r.shell) {
                    self.splash(&r, pos, events, None);
                    if let Some(scene) = air.as_deref_mut() {
                        accepted_air_blast(scene, &r, pos, self.friendly_damage, None, events);
                    }
                }
                continue;
            }
            r.pos = b;
            r.age += FIXED_DT;
            r.distance += segment;
            if r.age < r.air.as_ref().and_then(|d|d.guided.as_ref()).map(|g|g.config.life).unwrap_or(if r.air.is_some() { 120.0 } else { 20.0 })
                && self.ground.contains(b[0], b[2])
            {
                self.rounds.push(r)
            }
        }
        let workers = if self.facilities.has_active_jobs() {
            self.native_facility_workers()
        } else {
            Vec::new()
        };
        let work = self
            .facilities
            .step(self.now, FIXED_DT, &workers)
            .expect("consecutive native facility clock");
        self.accept_facility_events(work, 0, events);
        if let Some(scene) = air.as_deref_mut() {
            scene.sync_facility_availability(self);
        }
        if let Some(t) = self.timing.as_mut() {
            t.fixed_steps += 1;
            if let Some(start) = projectile_start {
                t.projectile_ns += start.elapsed().as_nanos() as u64;
            }
            if let Some(start) = fixed_start {
                t.ground_ns += start.elapsed().as_nanos() as u64;
            }
        }
    }
    fn ground_intersection(&self, a: [f64; 3], b: [f64; 3]) -> Option<([f64; 3], f64)> {
        for i in 1..=4 {
            let p = add(a, scale(sub(b, a), i as f64 / 4.0));
            if p[1] <= self.ground.height(p[0], p[2]) {
                let mut lo = (i - 1) as f64 / 4.0;
                let mut hi = i as f64 / 4.0;
                for _ in 0..12 {
                    let mid = (lo + hi) * 0.5;
                    let q = add(a, scale(sub(b, a), mid));
                    if q[1] <= self.ground.height(q[0], q[2]) {
                        hi = mid
                    } else {
                        lo = mid
                    }
                }
                let q = add(a, scale(sub(b, a), hi));
                return Some((q, length(sub(q, a))));
            }
        }
        None
    }
    fn blast_visible(&self,shooter:u64,a:[f64;3],b:[f64;3])->bool {
        let delta=sub(b,a);let span=length(delta);
        if !span.is_finite()||span<=0. {return false;}
        // A detonation can be exactly on an accepted facility surface. Move
        // only the visibility origin ten micrometres toward this sample: an
        // inward ray must then encounter the real exit wall, while an outward
        // ray is not rejected by its own t=0 impact. The detonation is unchanged.
        let shifted=add(a,scale(delta,(1e-5_f64).min(span*0.25)/span));
        self.guidance_point_visible(shooter,shifted,b)
    }
    fn splash(
        &mut self,
        r: &Round,
        pos: [f64; 3],
        events: &mut Vec<SimEvent>,
        exclude: Option<u64>,
    ) {
        if let Some(mut naval)=self.naval.take() {
            let before=naval.views();
            for id in naval.blast_with_los(pos,r.shell.tnt_equivalent_kg() as f64,r.team,self.friendly_damage,exclude,
                |a,b|self.blast_visible(r.shooter,a,b)) {
                events.push(SimEvent{kind:"blast".into(),shooter:Some(r.shooter),target:Some(id),pos,
                    detail:json!({"shot_id":r.id,"naval":true,"damage_applied":true,"damage_changed":true})});
                if before.iter().any(|s|s.unit.unit==id&&s.alive)&&naval.views().iter().any(|s|s.unit.unit==id&&!s.alive) {
                    events.push(SimEvent{kind:"destroyed".into(),shooter:Some(r.shooter),target:Some(id),pos,detail:json!({"shot_id":r.id,"naval":true})});
                }
            }
            self.naval=Some(naval);
        }
        let facility_blast = self
            .facilities
            .blast(
                pos,
                r.shell.tnt_equivalent_kg() as f64,
                r.team,
                self.friendly_damage,
                r.id,
                None,
            )
            .expect("accepted native TNT finite");
        self.accept_facility_events(facility_blast, r.shooter, events);
        // Candidate radius only. Per-station declared geometry and individual
        // physical casing paths decide damage; the sphere itself never kills.
        let radius = (12.0 + 8.0 * r.shell.tnt_equivalent_kg().cbrt()).min(60.0) as f64 + 8.0;
        for u in self.units.values_mut() {
            if exclude == Some(u.id)
                || (!self.friendly_damage && u.team == r.team)
                || length(sub(u.tank.body.origin(), pos)) > radius
            {
                continue;
            }
            let alive = !u.state.destroyed;
            let Ok(report) = tg_combat::near_burst::evaluate(
                &u.model.target,
                &u.state,
                vec3(u.tank.body.local_point(pos)),
                &r.shell,
                u.turret.yaw,
                r.seed ^ u.id,
                None,
                None,
            ) else {continue;};
            let damage_changed = accepted_damage_changed(&u.state, &report.state);
            u.state = report.state.clone();
            if !report.modules.is_empty() || !report.crew.is_empty() {
                events.push(SimEvent {
                    kind: "blast".into(),
                    shooter: Some(r.shooter),
                    target: Some(u.id),
                    pos,
                    detail: json!({"shot_id":r.id,"report":report,"damage_applied":true,"damage_changed":damage_changed}),
                })
            }
            if alive && u.state.destroyed {
                events.push(SimEvent {
                    kind: "destroyed".into(),
                    shooter: Some(r.shooter),
                    target: Some(u.id),
                    pos,
                    detail: json!({"shot_id":r.id}),
                })
            }
        }
    }
}
fn available_selection(u: &Unit) -> Option<usize> {
    let ammo = &u.model.vehicle.weapons.main_gun.ammo;
    if ammo
        .get(u.gun.selected_ammo)
        .is_some_and(|id| u.ammo.available(&u.model.ammo, MAIN, id))
    {
        return Some(u.gun.selected_ammo);
    }
    ammo.iter()
        .position(|id| u.ammo.available(&u.model.ammo, MAIN, id))
}
fn snapshot(u: &Unit) -> SimSnapshot {
    let a = u.tank.body.attitude();
    let pos = u.tank.body.origin();
    SimSnapshot {
        id: u.id,
        vehicle: u.model.vehicle.def.id.clone(),
        team: u.team,
        pos,
        heading: a.heading,
        pitch: a.pitch,
        roll: a.roll,
        velocity: u.tank.body.v,
        turret_yaw: u.turret.yaw as f64,
        gun_pitch: u.turret.pitch as f64,
        alive: !u.state.destroyed,
        caps: json!(tg_combat::caps(&u.model.target, &u.state)),
        damage: json!(u.state),
        ammo: u
            .ammo
            .counts
            .get(MAIN)
            .map(|counts| counts.iter().sum())
            .unwrap_or(0),
        ammo_counts: u.ammo.counts.clone(),
        ammo_revision: u.ammo.revision,
        reload_s: u.gun.reload_remaining_s as f64,
        net: json!(tank::net_state(&u.tank)),
    }
}
fn obstacle_for(t: &Tank, v: &LoadedVehicle) -> Obstacle {
    let p = t.body.origin();
    Obstacle {
        x: p[0],
        z: p[2],
        yaw: t.body.attitude().heading,
        hx: v.def.hull.size_m[0] as f64 * 0.5,
        hz: v.def.hull.size_m[2] as f64 * 0.5,
        y0: p[1] + 0.05,
        y1: p[1] + v.def.hull.size_m[1] as f64,
    }
}
fn boxes_overlap(a: Obstacle, b: Obstacle) -> bool {
    for yaw in [a.yaw, b.yaw] {
        for axis in [[yaw.cos(), -yaw.sin()], [yaw.sin(), yaw.cos()]] {
            let project = |o: Obstacle| {
                o.hx * (axis[0] * o.yaw.cos() - axis[1] * o.yaw.sin()).abs()
                    + o.hz * (axis[0] * o.yaw.sin() + axis[1] * o.yaw.cos()).abs()
            };
            if ((a.x - b.x) * axis[0] + (a.z - b.z) * axis[1]).abs()
                >= project(a) + project(b) + 0.2
            {
                return false;
            }
        }
    }
    true
}
fn segment_box(a: [f64; 3], b: [f64; 3], lo: [f64; 3], hi: [f64; 3]) -> bool {
    let mut near: f64 = 0.0;
    let mut far: f64 = 1.0;
    for k in 0..3 {
        let d = b[k] - a[k];
        if d.abs() < 1e-12 {
            if a[k] < lo[k] || a[k] > hi[k] {
                return false;
            }
        } else {
            let x = (lo[k] - a[k]) / d;
            let y = (hi[k] - a[k]) / d;
            near = near.max(x.min(y));
            far = far.min(x.max(y));
            if near > far {
                return false;
            }
        }
    }
    true
}
fn add(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn scale(a: [f64; 3], s: f64) -> [f64; 3] {
    a.map(|v| v * s)
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn length(a: [f64; 3]) -> f64 {
    dot(a, a).sqrt()
}
fn vec3(a: [f64; 3]) -> Vec3 {
    Vec3::new(a[0] as f32, a[1] as f32, a[2] as f32)
}

#[cfg(test)]
#[path = "frontline_sim_adapter_tests.rs"]
mod adapter_tests;
#[cfg(test)]
#[path = "frontline_sim_taiwan_tests.rs"]
mod taiwan_surface_tests;

#[cfg(test)]
#[path = "frontline_dynamic_bridge_tests.rs"]
mod dynamic_bridge_tests;
#[cfg(test)]
#[path = "frontline_ground_roles_tests.rs"]
mod ground_roles_tests;
#[cfg(test)]
#[path = "frontline_support_runtime_tests.rs"]
mod support_runtime_tests;
#[cfg(test)]
#[path = "frontline_sim_explosive_tests.rs"]
mod explosive_contact_tests;
#[cfg(test)]
#[path = "frontline_naval_integration_tests.rs"]
mod naval_integration_tests;

#[cfg(test)]
mod native_guidance_capacity_tests {
    use super::*;
    #[test]
    fn native_guidance_cluster_expansion_counts_pending_survivors_against_projectile_cap(){
        let data=Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let map=json!({"terrain":{"width":3,"height":3,"cellX":2000.0,"cellZ":2000.0,"x0":-2000.0,"z0":-2000.0,"heights":vec![0.0;9],"patches":[],"pads":[]}});
        let mut world=SimWorld::load(&data,&map).unwrap();
        let catalog:Value=serde_json::from_slice(&std::fs::read(data.join("aircraft/frontline.json")).unwrap()).unwrap();
        let shell:ProjectileDef=serde_json::from_value(catalog["shells"]["heat_64_blu97"].clone()).unwrap();
        let cluster=ClusterPayload{shell:shell.clone(),store_id:"blu97".into(),count:36,open:300.0,spread:45.0,mass:1.54,diameter:0.064};
        let parent=AirOrdnance{store_id:"cbu87".into(),cluster:Some(cluster),ramjet:None,direction:[0.0,0.0,1.0],bomb:true,diameter:0.4,mass:430.0,dv:0.0,burn:0.0,sustain:None,guided:None};
        world.launch_air_round(71,0,shell.clone(),[0.0,250.0,0.0],[0.0,-1.0,20.0],Some(parent),"store",1).unwrap();
        world.rounds[0].age=2.0;
        for _ in 1..20000 {world.launch_air_round(71,0,shell.clone(),[0.0,250.0,0.0],[0.0,0.0,20.0],None,"gun",1).unwrap();}
        assert_eq!(world.rounds.len(),20000);
        let events=world.step(FIXED_DT);
        assert!(events.iter().any(|e|e.kind=="cluster_open"));
        assert!(world.rounds.len()<=20000,"pending survivors are still active rounds and must count against admission: {}",world.rounds.len());
    }
}
