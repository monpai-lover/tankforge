//! Campaign-authored facilities. The exact emitted triangle list is shared by
//! presentation and finite-segment contacts; bounds never substitute for a hit.
//! This module owns no vehicles, clocks, ammunition or projectile admission.
use crate::frontline::UnitRef;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;
use tg_combat::geometry::{manifest::sha256, ray};

pub type Point = [f64; 3];
pub type Triangle = [Point; 3];
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FacilityKind {
    Bridge,
    RunwayPatch,
    SupplyNode,
    Fuel,
    Arming,
    Repair,
}
#[derive(Clone, Debug, Serialize)]
pub struct FacilityGeometry {
    pub facility_id: String,
    pub geometry_hash: String,
    /// Uploaded Float32 coordinates, promoted losslessly for native queries.
    pub triangles: Vec<Triangle>,
    pub triangle_roles: Vec<String>,
    pub bounds: [Point; 2],
    pub source: Value,
}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct FacilityCapabilities {
    pub geometry_active: bool,
    pub passable: bool,
    pub landable: bool,
    pub supply: bool,
    pub fuel: bool,
    pub arming: bool,
    pub repair: bool,
}
#[derive(Clone, Debug, Serialize)]
pub struct FacilityView {
    pub facility_id: String,
    pub team: Option<u8>,
    pub kind: FacilityKind,
    pub source_id: String,
    pub airfield: Option<String>,
    pub road_ids: Vec<String>,
    pub geometry_hash: String,
    pub geometry_revision: u64,
    pub revision: u64,
    pub hp: f64,
    pub max_hp: f64,
    pub supplied: bool,
    pub damage_state: String,
    pub capabilities: FacilityCapabilities,
}
#[derive(Clone, Debug)]
struct Facility {
    view: FacilityView,
    geometry: Arc<FacilityGeometry>,
    triangle_bounds: Arc<Vec<[Point; 2]>>,
    seen_damage: BTreeSet<(u64, u8)>,
    direct_explosions: BTreeSet<u64>,
    runway: Option<RunwayRect>,
    visible_solid_box: Option<[Point; 2]>,
}
/// This box is the exact solid primitive used to emit twelve visible triangles.
/// It is never derived as a collision approximation for a general mesh.
#[derive(Clone, Debug, Serialize)]
pub struct FacilityBlockingBox {
    pub facility_id: String,
    pub team: Option<u8>,
    pub geometry_hash: String,
    pub geometry_revision: u64,
    pub revision: u64,
    pub bounds: [Point; 2],
}
#[derive(Clone, Debug, Serialize)]
pub struct RunwayClosedRegion {
    pub facility_id: String,
    pub airfield: String,
    pub center: [f64; 2],
    pub forward: [f64; 2],
    /// Source half width and half length, excluding grading shoulders.
    pub half: [f64; 2],
    /// Facility state revision, not geometry revision; always nonzero.
    pub revision: u64,
}
const RUNWAY_CLOSED_MARGIN_M: f64 = 1e-6;
const RUNWAY_INTERVAL_MARGIN_M: f64 = 1e-5;
#[derive(Clone, Copy, Debug)]
struct RunwayRect {
    center: [f64; 2],
    forward: [f64; 2],
    half: [f64; 2],
    longitudinal: [f64; 2],
}
#[derive(Clone, Debug, Serialize)]
pub struct FacilityContact {
    pub facility_id: String,
    pub geometry_revision: u64,
    pub geometry_hash: String,
    pub triangle_id: usize,
    pub position: Point,
    pub normal: Point,
    pub fraction: f64,
    pub distance: f64,
    // Callers cannot construct a contact from an AABB/claimed client hit.
    #[serde(skip)]
    _verified: (),
}
#[derive(Clone, Copy, Debug)]
pub struct FacilityImpact {
    pub event_id: u64,
    pub team: u8,
    pub energy_j: f64,
    pub tnt_kg: f64,
    pub friendly_damage: bool,
}
#[derive(Clone, Debug, Serialize)]
pub struct FacilityEvent {
    pub kind: String,
    pub facility_id: String,
    pub revision: u64,
    pub geometry_revision: u64,
    pub detail: Value,
}
/// Explicit gameplay tuning, not structural/historical engineering estimates.
#[derive(Clone, Debug)]
pub struct FacilityTuning {
    pub runway_patch_m: f64,
    pub joules_per_hp: f64,
    pub tnt_kg_per_hp: f64,
    pub engineer_range_m: f64,
    pub supply_range_m: f64,
    pub escort_range_m: f64,
    pub stopped_speed_mps: f64,
    pub escorted_supply_multiplier: f64,
    pub bridge_repair_s: f64,
    pub runway_repair_s: f64,
    pub facility_repair_s: f64,
    pub supply_delivery_s: f64,
    pub maximum_step_s: f64,
}
impl Default for FacilityTuning {
    fn default() -> Self {
        Self {
            runway_patch_m: 100.0,
            joules_per_hp: 200_000.0,
            tnt_kg_per_hp: 0.25,
            engineer_range_m: 25.0,
            supply_range_m: 30.0,
            escort_range_m: 60.0,
            stopped_speed_mps: 1.5,
            escorted_supply_multiplier: 2.0,
            bridge_repair_s: 120.0,
            runway_repair_s: 60.0,
            facility_repair_s: 45.0,
            supply_delivery_s: 10.0,
            maximum_step_s: 0.05,
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FacilityJobKind {
    Repair,
    DeliverSupply,
}
/// These facts must be projected by the native host, never deserialized from a
/// client's claimed arrival. Roles come from the host's admitted force roster.
#[derive(Clone, Debug)]
pub struct FacilityWorker {
    pub unit: UnitRef,
    pub team: u8,
    pub alive: bool,
    pub pos: Point,
    pub speed_mps: f64,
    pub engineer: bool,
    pub supply: bool,
    pub combat: bool,
}
#[derive(Clone, Debug, Serialize)]
pub struct FacilityJobView {
    pub job_id: u64,
    pub facility_id: String,
    pub kind: FacilityJobKind,
    pub worker_unit: UnitRef,
    pub team: u8,
    pub expected_revision: u64,
    pub elapsed_s: f64,
    pub duration_s: f64,
    pub status: String,
    pub boosted: bool,
}
#[derive(Clone, Debug, Default, Serialize)]
pub struct AirfieldFacilityCapabilities {
    /// At least one intact patch exists. Local service must also check
    /// runway_open_at; takeoff must admit a long enough open interval.
    pub runway: bool,
    pub fuel: bool,
    pub arming: bool,
    pub repair: bool,
    pub supply: bool,
}
#[derive(Clone, Debug)]
pub struct FacilityWorld {
    facilities: BTreeMap<String, Facility>,
    jobs: BTreeMap<u64, FacilityJobView>,
    job_serial: u64,
    native_time: f64,
    revision: u64,
    tuning: FacilityTuning,
}
impl FacilityWorld {
    /// Explicit non-campaign physics fixtures can own an empty facility scene.
    /// Production map registration must call strict from_map instead.
    pub fn empty() -> Self {
        Self {
            facilities: BTreeMap::new(),
            jobs: BTreeMap::new(),
            job_serial: 0,
            native_time: 0.0,
            revision: 1,
            tuning: FacilityTuning::default(),
        }
    }
    pub fn tuning(&self) -> &FacilityTuning {
        &self.tuning
    }
    pub fn revision(&self) -> u64 {
        self.revision
    }
    pub fn has_active_jobs(&self) -> bool {
        self.jobs.values().any(|j| {
            matches!(
                j.status.as_str(),
                "working" | "waiting_for_unit" | "paused_unit_away"
            )
        })
    }
    pub fn from_map(map: &Value, height: impl Fn(f64, f64) -> f64) -> Result<Self, String> {
        Self::from_map_with_tuning(map, height, FacilityTuning::default())
    }
    pub fn from_map_with_tuning(
        map: &Value,
        height: impl Fn(f64, f64) -> f64,
        tuning: FacilityTuning,
    ) -> Result<Self, String> {
        let mut world = Self {
            facilities: BTreeMap::new(),
            jobs: BTreeMap::new(),
            job_serial: 0,
            native_time: 0.0,
            revision: 1,
            tuning,
        };
        world.validate_tuning()?;
        let map_id = text(&map["id"])?;
        let segments: Vec<[f64; 8]> = serde_json::from_value(
            map["terrain"]
                .get("roadbeds")
                .and_then(|r| r.get("segments"))
                .cloned()
                .unwrap_or(json!([])),
        )
        .map_err(|e| e.to_string())?;
        for bridge in array_or_empty(map["terrain"].get("bridges"))? {
            let id = text(&bridge["id"])?;
            let width = positive(&bridge["halfWidth"])?;
            let thickness = positive(&bridge["deckThickness"])?;
            let ids: Vec<usize> = serde_json::from_value(bridge["roadbedSegments"].clone())
                .map_err(|e| e.to_string())?;
            if ids.is_empty() || ids.iter().copied().collect::<BTreeSet<_>>().len() != ids.len() {
                return Err("Bridge needs distinct source segments".into());
            }
            let mut triangles = Vec::new();
            let mut roles = Vec::new();
            for &index in &ids {
                let s = segments.get(index).ok_or("Unknown bridge source segment")?;
                if !s.iter().all(|v| v.is_finite()) {
                    return Err("Nonfinite bridge segment".into());
                }
                let dx = s[3] - s[0];
                let dz = s[4] - s[1];
                let length = dx.hypot(dz);
                if length < 0.001 {
                    return Err("Degenerate bridge segment".into());
                }
                let nx = -dz / length * width;
                let nz = dx / length * width;
                let ring = vec![
                    [s[0] + nx, s[1] + nz],
                    [s[3] + nx, s[4] + nz],
                    [s[3] - nx, s[4] - nz],
                    [s[0] - nx, s[1] - nz],
                ];
                solid_triangle(
                    [ring[0], ring[1], ring[2]],
                    thickness,
                    &height,
                    &mut triangles,
                    &mut roles,
                )?;
                solid_triangle(
                    [ring[0], ring[2], ring[3]],
                    thickness,
                    &height,
                    &mut triangles,
                    &mut roles,
                )?;
                side_faces(&ring, thickness, false, &height, &mut triangles, &mut roles)?;
            }
            if let Some(joint) = bridge.get("jointGeometry") {
                if joint["version"] != 1
                    || joint["source"]["kind"] != "authored_internal_deck_joint_wedges"
                {
                    return Err("Unknown bridge joint contract".into());
                }
                let mut shared = Vec::new();
                for v in array_required(&joint["sharedVertices"])? {
                    let p = point2(&v["point"])?;
                    let refs: Vec<usize> = serde_json::from_value(v["roadbedSegments"].clone())
                        .map_err(|e| e.to_string())?;
                    if refs.len() < 2 || refs.windows(2).any(|p| p[0] >= p[1]) {
                        return Err("Joint needs sorted shared segments".into());
                    }
                    for i in refs {
                        let s = segments.get(i).ok_or("Bad shared segment")?;
                        if !ids.contains(&i) || (!near(p, [s[0], s[1]]) && !near(p, [s[3], s[4]])) {
                            return Err("Joint is not a registered internal endpoint".into());
                        }
                    }
                    shared.push(p);
                }
                let mut polygons = Vec::new();
                for p in array_required(&joint["polygons"])? {
                    let ring = closed_ring(&p["ring"])?;
                    let holes = array_or_empty(p.get("holes"))?
                        .iter()
                        .map(closed_ring)
                        .collect::<Result<Vec<_>, _>>()?;
                    if ring
                        .iter()
                        .chain(holes.iter().flatten())
                        .any(|p| !shared.iter().any(|s| dist2(*p, *s) <= width + 2e-6))
                    {
                        return Err("Joint extends outside its registered internal vertex".into());
                    }
                    polygons.push((ring, holes));
                }
                let mut total_area = 0.0;
                for t in array_required(&joint["triangles"])? {
                    let flat: [f64; 6] =
                        serde_json::from_value(t.clone()).map_err(|e| e.to_string())?;
                    if !flat.iter().all(|v| v.is_finite()) {
                        return Err("Nonfinite joint triangle".into());
                    }
                    let p = [[flat[0], flat[1]], [flat[2], flat[3]], [flat[4], flat[5]]];
                    let area = area(&p);
                    if area >= -1e-10 || !polygons.iter().any(|(r, h)| triangle_in_polygon(p, r, h))
                    {
                        return Err(
                            "Joint triangle is degenerate or crosses a supplied hole/boundary"
                                .into(),
                        );
                    }
                    total_area -= area;
                    solid_triangle(p, thickness, &height, &mut triangles, &mut roles)?;
                }
                let expected: f64 = polygons
                    .iter()
                    .map(|(r, h)| area(r).abs() - h.iter().map(|v| area(v).abs()).sum::<f64>())
                    .sum();
                if (total_area - expected).abs() > 1e-5_f64.max(expected.abs() * 1e-7) {
                    return Err("Joint triangles do not cover supplied polygons".into());
                }
                for (r, h) in polygons {
                    side_faces(&r, thickness, false, &height, &mut triangles, &mut roles)?;
                    for hole in h {
                        side_faces(&hole, thickness, true, &height, &mut triangles, &mut roles)?;
                    }
                }
            }
            let mut roads: Vec<String> = array_or_empty(bridge.get("roadIds"))?
                .iter()
                .map(|v| text(v).map(str::to_owned))
                .collect::<Result<_, _>>()?;
            if roads.is_empty() {
                roads.push(text(&bridge["roadId"])?.to_owned());
            }
            world.register(format!("{map_id}:bridge:{id}"),FacilityKind::Bridge,None,id.to_owned(),None,roads,250.0,triangles,roles,
                json!({"kind":"authored_campaign","sourceBridge":bridge,"geometryRecipe":"buildFrontlineBridgeGeometry rectangles+explicit_joint_v1; Float32 upload positions"}),None)?;
        }
        for field in array_or_empty(map.get("airfields"))?
            .iter()
            .filter(|f| f["enabled"] == true)
        {
            let id = text(&field["id"])?;
            let team = team(&field["team"])?;
            let runway = &field["runway"];
            let center = point2(&runway["center"])?;
            let forward = point2(&runway["forward"])?;
            if (forward[0].hypot(forward[1]) - 1.0).abs() > 1e-6 {
                return Err("Invalid runway direction".into());
            }
            let length = positive(&runway["lengthMeters"])?;
            let width = positive(&runway["widthMeters"])?;
            let h = number(&runway["height"])?;
            let count = (length / world.tuning.runway_patch_m).ceil() as usize;
            if count == 0 || count > 512 {
                return Err("Runway patch count outside bound".into());
            }
            for i in 0..count {
                let a = -length / 2.0 + i as f64 * world.tuning.runway_patch_m;
                let b = (-length / 2.0 + (i + 1) as f64 * world.tuning.runway_patch_m)
                    .min(length / 2.0);
                let c = [
                    center[0] + forward[0] * (a + b) / 2.0,
                    center[1] + forward[1] * (a + b) / 2.0,
                ];
                let ring = oriented_rect(c, forward, width / 2.0, (b - a) / 2.0);
                for p in &ring {
                    if (height(p[0], p[1]) - h).abs() > 1e-4 {
                        return Err("Runway plane differs from canonical source height".into());
                    }
                }
                let triangles = vec![
                    [
                        [ring[0][0], h, ring[0][1]],
                        [ring[1][0], h, ring[1][1]],
                        [ring[2][0], h, ring[2][1]],
                    ],
                    [
                        [ring[0][0], h, ring[0][1]],
                        [ring[2][0], h, ring[2][1]],
                        [ring[3][0], h, ring[3][1]],
                    ],
                ];
                world.register(format!("{map_id}:runway:{id}:patch:{i:03}"),FacilityKind::RunwayPatch,Some(team),id.into(),Some(id.into()),vec![],120.0,triangles,vec!["runway_top".into();2],json!({"kind":"authored_campaign","sourceAirfield":id,"patchIndex":i,"longitudinalMeters":[a,b],"sourceHeight":h}),Some(RunwayRect {center:c,forward,half:[width/2.0,(b-a)/2.0],longitudinal:[a,b]}))?;
            }
            for (kind, label, offset, hp) in [
                (FacilityKind::Fuel, "fuel", -70.0, 120.0),
                (FacilityKind::Arming, "arming", 0.0, 140.0),
                (FacilityKind::Repair, "repair", 70.0, 160.0),
            ] {
                let c = [
                    center[0] + forward[1] * (width / 2.0 + 60.0) + forward[0] * offset,
                    center[1] - forward[0] * (width / 2.0 + 60.0) + forward[1] * offset,
                ];
                let y = height(c[0], c[1]);
                if !y.is_finite() {
                    return Err("Nonfinite authored airport facility height".into());
                }
                let triangles = box_triangles([c[0], y, c[1]], [6.0, 6.0, 4.0]);
                world.register(format!("{map_id}:{label}:{id}"),kind,Some(team),id.into(),Some(id.into()),vec![],hp,triangles,vec!["authored_visible_structure".into();12],json!({"kind":"authored_campaign","sourceAirfield":id,"measuredBuilding":false,"placement":"60m outside runway edge; longitudinal -70/0/+70m","dimensionsMeters":[12,6,8]}),None)?;
            }
        }
        for source in array_or_empty(map.get("staging"))?
            .iter()
            .filter(|s| s["enabled"] == true)
        {
            let id = text(&source["id"])?;
            let t = team(&source["team"])?;
            let pos = point3(&source["pos"])?;
            let yaw = number(&source["spawnSlots"][0]["yawRad"])?;
            if !yaw.is_finite() {
                return Err("Nonfinite staging heading".into());
            }
            let half = map["terrain"]["pads"]
                .as_array()
                .into_iter()
                .flatten()
                .find(|p| p["id"] == source["padId"])
                .and_then(|p| p["halfSize"][0].as_f64())
                .filter(|x| x.is_finite() && *x > 0.0)
                .ok_or("Enabled source needs its registered pad width")?;
            let c = [
                pos[0] + yaw.cos() * (half + 12.0),
                pos[2] - yaw.sin() * (half + 12.0),
            ];
            let y = height(c[0], c[1]);
            world.register(format!("{map_id}:supply:{id}"),FacilityKind::SupplyNode,Some(t),id.into(),None,vec![text(&source["roadId"] )?.into()],100.0,box_triangles([c[0],y,c[1]],[4.0,3.0,3.0]),vec!["authored_visible_structure".into();12],json!({"kind":"authored_campaign","sourceStaging":id,"measuredBuilding":false,"placement":"12m outside source pad right edge; avoids reserved native slots","dimensionsMeters":[8,3,6]}),None)?;
        }
        Ok(world)
    }
    fn validate_tuning(&self) -> Result<(), String> {
        let t = &self.tuning;
        if ![
            t.runway_patch_m,
            t.joules_per_hp,
            t.tnt_kg_per_hp,
            t.engineer_range_m,
            t.supply_range_m,
            t.escort_range_m,
            t.stopped_speed_mps,
            t.escorted_supply_multiplier,
            t.bridge_repair_s,
            t.runway_repair_s,
            t.facility_repair_s,
            t.supply_delivery_s,
            t.maximum_step_s,
        ]
        .iter()
        .all(|v| v.is_finite() && *v > 0.0)
            || t.maximum_step_s > 0.05
            || t.escorted_supply_multiplier < 1.0
            || t.escorted_supply_multiplier > 4.0
        {
            return Err("Invalid campaign facility tuning".into());
        }
        Ok(())
    }
    #[allow(clippy::too_many_arguments)]
    fn register(
        &mut self,
        id: String,
        kind: FacilityKind,
        team: Option<u8>,
        source_id: String,
        airfield: Option<String>,
        road_ids: Vec<String>,
        max_hp: f64,
        triangles: Vec<Triangle>,
        roles: Vec<String>,
        mut source: Value,
        runway: Option<RunwayRect>,
    ) -> Result<(), String> {
        if self.facilities.contains_key(&id)
            || triangles.is_empty()
            || triangles.len() != roles.len()
            || triangles
                .iter()
                .flatten()
                .flatten()
                .any(|v| !v.is_finite() || !(*v as f32).is_finite())
        {
            return Err("Duplicate/invalid facility geometry".into());
        }
        let triangles: Vec<_> = triangles
            .into_iter()
            .map(|t| t.map(|p| p.map(|v| v as f32 as f64)))
            .collect();
        let mut bytes = Vec::new();
        let mut bounds = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
        for (tri, role) in triangles.iter().zip(&roles) {
            let _ = role;
            for p in tri {
                for k in 0..3 {
                    bounds[0][k] = bounds[0][k].min(p[k]);
                    bounds[1][k] = bounds[1][k].max(p[k]);
                    bytes.extend_from_slice(&(p[k] as f32).to_bits().to_le_bytes());
                }
            }
        }
        let hash = sha256(&bytes);
        let visible_solid_box = if matches!(
            kind,
            FacilityKind::Fuel
                | FacilityKind::Arming
                | FacilityKind::Repair
                | FacilityKind::SupplyNode
        ) {
            let center = [
                (bounds[0][0] + bounds[1][0]) / 2.0,
                bounds[0][1],
                (bounds[0][2] + bounds[1][2]) / 2.0,
            ];
            let half = [
                (bounds[1][0] - bounds[0][0]) / 2.0,
                bounds[1][1] - bounds[0][1],
                (bounds[1][2] - bounds[0][2]) / 2.0,
            ];
            if triangles != box_triangles(center, half) {
                return Err(
                    "Authored solid facility must retain its exact twelve visible box triangles"
                        .into(),
                );
            }
            source["visiblePrimitive"] = json!({"kind":"axis_aligned_solid_cuboid","bounds":bounds,"sameTwelveVisibleAndBlockingFaces":true});
            Some(bounds)
        } else {
            None
        };
        let triangle_bounds = triangles
            .iter()
            .map(|t| {
                let mut b = [[f64::INFINITY; 3], [f64::NEG_INFINITY; 3]];
                for p in t {
                    for k in 0..3 {
                        b[0][k] = b[0][k].min(p[k]);
                        b[1][k] = b[1][k].max(p[k]);
                    }
                }
                b
            })
            .collect();
        let geometry = FacilityGeometry {
            facility_id: id.clone(),
            geometry_hash: hash.clone(),
            triangles,
            triangle_roles: roles,
            bounds,
            source,
        };
        let mut f = Facility {
            view: FacilityView {
                facility_id: id.clone(),
                team,
                kind,
                source_id,
                airfield,
                road_ids,
                geometry_hash: hash,
                geometry_revision: 1,
                revision: 1,
                hp: max_hp,
                max_hp,
                supplied: true,
                damage_state: "intact".into(),
                capabilities: empty_caps(),
            },
            geometry: Arc::new(geometry),
            triangle_bounds: Arc::new(triangle_bounds),
            seen_damage: BTreeSet::new(),
            direct_explosions: BTreeSet::new(),
            runway,
            visible_solid_box,
        };
        refresh(&mut f);
        self.facilities.insert(id, f);
        Ok(())
    }
    pub fn views(&self) -> Vec<FacilityView> {
        self.facilities.values().map(|f| f.view.clone()).collect()
    }
    pub fn view(&self, id: &str) -> Option<FacilityView> {
        self.facilities.get(id).map(|f| f.view.clone())
    }
    pub fn position(&self, id: &str) -> Option<Point> {
        self.facilities.get(id).map(|f| {
            std::array::from_fn(|k| (f.geometry.bounds[0][k] + f.geometry.bounds[1][k]) / 2.0)
        })
    }
    pub fn bounds(&self, id: &str) -> Option<[Point;2]> {
        self.facilities.get(id).map(|f|f.geometry.bounds)
    }
    pub fn distance_to(&self, id: &str, pos: Point) -> Option<f64> {
        finite(pos)
            .then(|| self.facilities.get(id).map(|f| facility_distance(f, pos)))
            .flatten()
    }
    pub fn geometry_catalog(&self) -> Vec<FacilityGeometry> {
        self.facilities
            .values()
            .map(|f| (*f.geometry).clone())
            .collect()
    }
    pub fn job_views(&self) -> Vec<FacilityJobView> {
        self.jobs.values().cloned().collect()
    }
    pub fn blocking_boxes(&self) -> Vec<FacilityBlockingBox> {
        self.facilities
            .values()
            .filter(|f| f.view.capabilities.geometry_active)
            .filter_map(|f| {
                f.visible_solid_box.map(|bounds| FacilityBlockingBox {
                    facility_id: f.view.facility_id.clone(),
                    team: f.view.team,
                    geometry_hash: f.view.geometry_hash.clone(),
                    geometry_revision: f.view.geometry_revision,
                    revision: f.view.revision,
                    bounds,
                })
            })
            .collect()
    }
    pub fn runway_closed_regions(&self) -> Vec<RunwayClosedRegion> {
        self.facilities
            .values()
            .filter(|f| !f.view.capabilities.landable)
            .filter_map(|f| {
                Some(RunwayClosedRegion {
                    facility_id: f.view.facility_id.clone(),
                    airfield: f.view.airfield.clone()?,
                    center: f.runway?.center,
                    forward: f.runway?.forward,
                    half: f.runway?.half,
                    revision: f.view.revision,
                })
            })
            .collect()
    }
    /// Intact continuous source-axis intervals. At a damaged neighbouring patch
    /// the returned endpoint is inset by10micrometres, beyond the closed-region
    /// boundary tolerance. Undamaged original strip ends remain exact.
    pub fn runway_open_intervals(&self, airfield: &str) -> Vec<[f64; 2]> {
        let mut patches: Vec<_> = self
            .facilities
            .values()
            .filter(|f| f.view.airfield.as_deref() == Some(airfield))
            .filter_map(|f| {
                f.runway
                    .map(|r| (r.longitudinal, f.view.capabilities.landable))
            })
            .collect();
        patches.sort_by(|a, b| a.0[0].total_cmp(&b.0[0]));
        let mut intervals: Vec<[f64; 2]> = Vec::new();
        for &(range, open) in &patches {
            if open {
                if let Some(last) = intervals.last_mut().filter(|last| last[1] == range[0]) {
                    last[1] = range[1];
                } else {
                    intervals.push(range);
                }
            }
        }
        for range in &mut intervals {
            if patches
                .iter()
                .any(|(closed, open)| !*open && closed[1] == range[0])
            {
                range[0] += RUNWAY_INTERVAL_MARGIN_M;
            }
            if patches
                .iter()
                .any(|(closed, open)| !*open && closed[0] == range[1])
            {
                range[1] -= RUNWAY_INTERVAL_MARGIN_M;
            }
        }
        intervals.retain(|r| r[0] < r[1]);
        intervals
    }
    /// Full original-strip condition; deliberately separate from local service.
    pub fn full_runway_available(&self, airfield: &str) -> Option<bool> {
        let patches: Vec<_> = self
            .facilities
            .values()
            .filter(|f| f.view.airfield.as_deref() == Some(airfield) && f.runway.is_some())
            .collect();
        (!patches.is_empty()).then(|| patches.iter().all(|f| f.view.capabilities.landable))
    }
    pub fn native_time(&self) -> f64 {
        self.native_time
    }
    pub fn bridge_open(&self, source_id: &str) -> Option<bool> {
        self.facilities
            .values()
            .find(|f| f.view.kind == FacilityKind::Bridge && f.view.source_id == source_id)
            .map(|f| f.view.capabilities.passable)
    }
    pub fn source_supply_open(&self, source_id: &str) -> Option<bool> {
        self.facilities
            .values()
            .find(|f| f.view.kind == FacilityKind::SupplyNode && f.view.source_id == source_id)
            .map(|f| f.view.capabilities.supply)
    }
    pub fn runway_open_at(&self, airfield: &str, x: f64, z: f64) -> bool {
        if !x.is_finite() || !z.is_finite() {
            return false;
        }
        if self.facilities.values().any(|f| {
            f.view.airfield.as_deref() == Some(airfield)
                && !f.view.capabilities.landable
                && f.runway
                    .is_some_and(|r| r.contains_margin(x, z, RUNWAY_CLOSED_MARGIN_M))
        }) {
            return false;
        }
        let covering: Vec<_> = self
            .facilities
            .values()
            .filter(|f| {
                f.view.airfield.as_deref() == Some(airfield)
                    && f.runway.is_some_and(|r| r.contains(x, z))
            })
            .collect();
        !covering.is_empty() && covering.iter().all(|f| f.view.capabilities.landable)
    }
    pub fn airfield_capabilities(&self, id: &str) -> Option<AirfieldFacilityCapabilities> {
        let f: Vec<_> = self
            .facilities
            .values()
            .filter(|f| f.view.airfield.as_deref() == Some(id))
            .collect();
        if f.is_empty() {
            return None;
        }
        Some(AirfieldFacilityCapabilities {
            runway: f
                .iter()
                .filter(|f| f.view.kind == FacilityKind::RunwayPatch)
                .any(|f| f.view.capabilities.landable),
            fuel: f.iter().any(|f| f.view.capabilities.fuel),
            arming: f.iter().any(|f| f.view.capabilities.arming),
            repair: f.iter().any(|f| f.view.capabilities.repair),
            supply: f.iter().all(|f| f.view.supplied),
        })
    }
    pub fn first_contact(&self, a: Point, b: Point) -> Result<Option<FacilityContact>, String> {
        if !finite(a) || !finite(b) || !finite(ray::sub(b, a)) {
            return Err("Nonfinite facility contact segment".into());
        }
        let mut best: Option<FacilityContact> = None;
        for f in self
            .facilities
            .values()
            .filter(|f| f.view.capabilities.geometry_active)
        {
            if !segment_bounds(a, b, f.geometry.bounds) {
                continue;
            }
            for (i, &tri) in f.geometry.triangles.iter().enumerate() {
                if !segment_bounds(a, b, f.triangle_bounds[i]) {
                    continue;
                }
                if let Some(hit) = ray::triangle(a, b, tri)? {
                    if best.as_ref().is_none_or(|v| hit.t < v.fraction) {
                        let n = ray::cross(ray::sub(tri[1], tri[0]), ray::sub(tri[2], tri[0]));
                        let len = ray::dot(n, n).sqrt();
                        if len == 0.0 {
                            continue;
                        }
                        best = Some(FacilityContact {
                            facility_id: f.view.facility_id.clone(),
                            geometry_revision: f.view.geometry_revision,
                            geometry_hash: f.view.geometry_hash.clone(),
                            triangle_id: i,
                            position: ray::point_at(a, b, hit.t),
                            normal: n.map(|v| v / len),
                            fraction: hit.t,
                            distance: distance(a, b) * hit.t,
                            _verified: (),
                        });
                    }
                }
            }
        }
        Ok(best)
    }
    pub fn is_terrain_surface(&self, c: &FacilityContact) -> bool {
        self.facilities
            .get(&c.facility_id)
            .and_then(|f| f.geometry.triangle_roles.get(c.triangle_id))
            .is_some_and(|role| matches!(role.as_str(), "bridge_top" | "runway_top"))
    }
    pub fn impact(
        &mut self,
        c: &FacilityContact,
        input: &FacilityImpact,
    ) -> Result<Vec<FacilityEvent>, String> {
        validate_impact(input)?;
        let f = self
            .facilities
            .get(&c.facility_id)
            .ok_or("Unknown facility")?;
        if f.seen_damage.contains(&(input.event_id, 0)) {
            return Ok(vec![]);
        }
        if c.geometry_revision != f.view.geometry_revision
            || c.geometry_hash != f.view.geometry_hash
            || c.triangle_id >= f.geometry.triangles.len()
            || !f.view.capabilities.geometry_active
        {
            return Err("Stale facility geometry contact".into());
        }
        let amount =
            input.energy_j / self.tuning.joules_per_hp + input.tnt_kg / self.tuning.tnt_kg_per_hp;
        if !amount.is_finite() {
            return Err("Accepted facility energy arithmetic overflow".into());
        }
        if input.tnt_kg > 0.0 {
            self.facilities
                .get_mut(&c.facility_id)
                .unwrap()
                .direct_explosions
                .insert(input.event_id);
        }
        self.damage(
            &c.facility_id,
            input.event_id,
            input.team,
            input.friendly_damage,
            amount,
            "direct",
        )
    }
    pub fn blast(
        &mut self,
        pos: Point,
        tnt_kg: f64,
        team: u8,
        friendly_damage: bool,
        event_id: u64,
        exclude: Option<&str>,
    ) -> Result<Vec<FacilityEvent>, String> {
        validate_impact(&FacilityImpact {
            event_id,
            team,
            energy_j: 0.0,
            tnt_kg,
            friendly_damage,
        })?;
        if !finite(pos) {
            return Err("Nonfinite facility blast".into());
        }
        if tnt_kg == 0.0 {
            return Ok(vec![]);
        }
        if !(tnt_kg / self.tuning.tnt_kg_per_hp).is_finite() {
            return Err("Accepted facility blast arithmetic overflow".into());
        }
        let radius = (8.0 * tnt_kg.cbrt()).max(3.0);
        let mut pending = Vec::new();
        for (id, f) in &self.facilities {
            if exclude == Some(id.as_str())
                || (f.seen_damage.contains(&(event_id, 1))
                    || f.direct_explosions.contains(&event_id))
            {
                continue;
            }
            let d = facility_distance(f, pos);
            if d < radius {
                pending.push((
                    id.clone(),
                    tnt_kg / self.tuning.tnt_kg_per_hp * (1.0 - d / radius).powi(2),
                ));
            }
        }
        let mut events = Vec::new();
        for (id, amount) in pending {
            events.extend(self.damage(&id, event_id, team, friendly_damage, amount, "blast")?);
        }
        Ok(events)
    }
    fn damage(
        &mut self,
        id: &str,
        event: u64,
        team: u8,
        friendly: bool,
        amount: f64,
        mechanism: &str,
    ) -> Result<Vec<FacilityEvent>, String> {
        if !amount.is_finite() || amount < 0.0 {
            return Err("Invalid accepted facility damage".into());
        }
        let f = self.facilities.get_mut(id).ok_or("Unknown facility")?;
        if !f
            .seen_damage
            .insert((event, u8::from(mechanism == "blast")))
        {
            return Ok(vec![]);
        }
        if f.view.team == Some(team) && !friendly {
            return Ok(vec![event_of(
                f,
                "facility_friendly_block",
                json!({"event_id":event,"mechanism":mechanism}),
            )]);
        }
        if amount == 0.0 {
            return Ok(vec![]);
        }
        let was = f.view.capabilities.geometry_active;
        f.view.hp = (f.view.hp - amount).max(0.0);
        // Lightweight logistics: an accepted hit interrupts this installation's
        // supply function. Structural repair alone cannot create a delivery.
        if matches!(f.view.kind,FacilityKind::Fuel|FacilityKind::Arming|FacilityKind::Repair|FacilityKind::SupplyNode) {
            f.view.supplied=false;
        }
        f.view.revision += 1;
        self.revision += 1;
        refresh(f);
        if was != f.view.capabilities.geometry_active {
            f.view.geometry_revision += 1;
        }
        for j in self
            .jobs
            .values_mut()
            .filter(|j| j.facility_id == id && j.status != "complete" && j.status != "cancelled")
        {
            j.elapsed_s = 0.0;
            j.status = "restart_required_new_damage".into();
            j.boosted = false;
        }
        Ok(vec![event_of(
            f,
            "facility_damaged",
            json!({"event_id":event,"mechanism":mechanism,"damage_hp":amount,"hp":f.view.hp,"capabilities":f.view.capabilities}),
        )])
    }
    pub fn set_supplied(
        &mut self,
        id: &str,
        expected_revision: u64,
        supplied: bool,
    ) -> Result<FacilityView, String> {
        let f = self.facilities.get_mut(id).ok_or("Unknown facility")?;
        if f.view.revision != expected_revision {
            return Err("Stale facility revision".into());
        }
        if f.view.supplied != supplied {
            f.view.supplied = supplied;
            f.view.revision += 1;
            self.revision += 1;
            refresh(f);
        }
        Ok(f.view.clone())
    }
    pub fn request_job(
        &mut self,
        kind: FacilityJobKind,
        id: &str,
        expected_revision: u64,
        worker_unit: UnitRef,
        team: u8,
    ) -> Result<FacilityJobView, String> {
        self.validate_tuning()?;
        let f = self.facilities.get(id).ok_or("Unknown facility")?;
        if (worker_unit.unit == 0 || worker_unit.battle == 0 || worker_unit.life == 0)
            || team > 1
            || f.view.team.is_some_and(|t| t != team)
        {
            return Err("Invalid facility job owner/worker".into());
        }
        if f.view.revision != expected_revision {
            return Err("Stale facility revision".into());
        }
        if kind == FacilityJobKind::Repair && f.view.hp == f.view.max_hp {
            return Err("Facility does not need repair".into());
        }
        if kind == FacilityJobKind::DeliverSupply && f.view.hp <= 0.0 {
            return Err("Facility must be physically repaired before supply delivery".into());
        }
        if let Some(job) = self.jobs.values().find(|j| {
            j.facility_id == id
                && matches!(
                    j.status.as_str(),
                    "working" | "waiting_for_unit" | "paused_unit_away"
                )
        }) {
            if job.worker_unit == worker_unit
                && job.kind == kind
                && job.expected_revision == expected_revision
            {
                return Ok(job.clone());
            }
            return Err("Facility already has an active job".into());
        }
        let duration = if kind == FacilityJobKind::DeliverSupply {
            self.tuning.supply_delivery_s
        } else {
            match f.view.kind {
                FacilityKind::Bridge => self.tuning.bridge_repair_s,
                FacilityKind::RunwayPatch => self.tuning.runway_repair_s,
                _ => self.tuning.facility_repair_s,
            }
        };
        self.job_serial += 1;
        let j = FacilityJobView {
            job_id: self.job_serial,
            facility_id: id.into(),
            kind,
            worker_unit,
            team,
            expected_revision,
            elapsed_s: 0.0,
            duration_s: duration,
            status: "waiting_for_unit".into(),
            boosted: false,
        };
        self.jobs.insert(j.job_id, j.clone());
        Ok(j)
    }
    pub fn cancel_job(&mut self, id: u64) -> Result<FacilityJobView, String> {
        let j = self.jobs.get_mut(&id).ok_or("Unknown facility job")?;
        if j.status != "complete" {
            j.status = "cancelled".into();
            j.elapsed_s = 0.0;
            j.boosted = false;
        }
        Ok(j.clone())
    }
    pub fn step(
        &mut self,
        native_time: f64,
        dt: f64,
        workers: &[FacilityWorker],
    ) -> Result<Vec<FacilityEvent>, String> {
        self.validate_tuning()?;
        if !native_time.is_finite()
            || native_time < self.native_time
            || !dt.is_finite()
            || dt < 0.0
            || dt > self.tuning.maximum_step_s
            || (native_time - self.native_time - dt).abs() > 1e-6
        {
            return Err("Facility work requires consecutive accepted native steps".into());
        }
        let mut actual = BTreeMap::new();
        let mut identities = BTreeSet::new();
        for w in workers {
            if (w.unit.unit == 0 || w.unit.battle == 0 || w.unit.life == 0)
                || w.team > 1
                || !finite(w.pos)
                || !w.speed_mps.is_finite()
                || w.speed_mps < 0.0
                || !identities.insert((w.unit.battle, w.unit.unit))
                || actual.insert(w.unit, w).is_some()
            {
                return Err("Invalid/duplicate native facility worker".into());
            }
        }
        if dt == 0.0 {
            return Ok(vec![]);
        }
        self.native_time = native_time;
        let mut events = Vec::new();
        for j in self.jobs.values_mut() {
            if matches!(
                j.status.as_str(),
                "complete" | "cancelled" | "cancelled_unit_lost" | "cancelled_unit_replaced"
            ) || j.status.starts_with("restart_required")
            {
                continue;
            }
            let f = self
                .facilities
                .get_mut(&j.facility_id)
                .ok_or("Job facility disappeared")?;
            if f.view.revision != j.expected_revision {
                j.status = "restart_required_revision".into();
                j.elapsed_s = 0.0;
                j.boosted = false;
                continue;
            }
            let Some(w) = actual.get(&j.worker_unit) else {
                j.status = if actual
                    .keys()
                    .any(|u| u.unit == j.worker_unit.unit && *u != j.worker_unit)
                {
                    "cancelled_unit_replaced"
                } else {
                    "waiting_for_unit"
                }
                .into();
                j.elapsed_s = 0.0;
                j.boosted = false;
                continue;
            };
            if !w.alive {
                j.status = "cancelled_unit_lost".into();
                j.elapsed_s = 0.0;
                j.boosted = false;
                continue;
            }
            let role = if j.kind == FacilityJobKind::Repair {
                w.engineer
            } else {
                w.supply
            };
            let range = if j.kind == FacilityJobKind::Repair {
                self.tuning.engineer_range_m
            } else {
                self.tuning.supply_range_m
            };
            if w.team != j.team
                || !role
                || w.speed_mps > self.tuning.stopped_speed_mps
                || facility_distance(f, w.pos) > range
            {
                j.status = "paused_unit_away".into();
                j.elapsed_s = 0.0;
                j.boosted = false;
                continue;
            }
            j.boosted = j.kind == FacilityJobKind::Repair
                && actual.values().any(|s| {
                    s.alive
                        && s.team == j.team
                        && s.supply
                        && s.speed_mps <= self.tuning.stopped_speed_mps
                        && facility_distance(f, s.pos) <= self.tuning.supply_range_m
                        && actual.values().any(|e| {
                            e.unit != s.unit
                                && e.unit != j.worker_unit
                                && e.alive
                                && e.team == j.team
                                && e.combat
                                && distance(e.pos, s.pos) <= self.tuning.escort_range_m
                        })
                });
            j.status = "working".into();
            j.elapsed_s = (j.elapsed_s
                + dt * if j.boosted {
                    self.tuning.escorted_supply_multiplier
                } else {
                    1.0
                })
            .min(j.duration_s);
            if j.elapsed_s + 1e-9 >= j.duration_s {
                let was = f.view.capabilities.geometry_active;
                if j.kind == FacilityJobKind::Repair {
                    f.view.hp = f.view.max_hp;
                } else {
                    f.view.supplied = true;
                }
                f.view.revision += 1;
                self.revision += 1;
                refresh(f);
                if was != f.view.capabilities.geometry_active {
                    f.view.geometry_revision += 1;
                }
                j.status = "complete".into();
                events.push(event_of(
                    f,
                    "facility_job_complete",
                    json!({"job":j,"hp":f.view.hp,"capabilities":f.view.capabilities}),
                ));
            }
        }
        Ok(events)
    }
}
impl RunwayRect {
    fn contains(&self, x: f64, z: f64) -> bool {
        self.contains_margin(x, z, 0.0)
    }
    fn contains_margin(&self, x: f64, z: f64, margin: f64) -> bool {
        let dx = x - self.center[0];
        let dz = z - self.center[1];
        (dx * self.forward[1] - dz * self.forward[0]).abs() <= self.half[0] + margin
            && (dx * self.forward[0] + dz * self.forward[1]).abs() <= self.half[1] + margin
    }
}
fn refresh(f: &mut Facility) {
    let alive = f.view.hp > 0.0;
    let available = alive && f.view.supplied;
    let k = f.view.kind;
    f.view.damage_state = if !alive {
        "destroyed"
    } else if f.view.hp < f.view.max_hp {
        "damaged"
    } else {
        "intact"
    }
    .into();
    f.view.capabilities = FacilityCapabilities {
        geometry_active: alive,
        passable: k == FacilityKind::Bridge && alive,
        landable: k == FacilityKind::RunwayPatch && f.view.hp == f.view.max_hp,
        supply: k == FacilityKind::SupplyNode && available,
        fuel: k == FacilityKind::Fuel && available,
        arming: k == FacilityKind::Arming && available,
        repair: k == FacilityKind::Repair && available,
    };
}
fn empty_caps() -> FacilityCapabilities {
    FacilityCapabilities {
        geometry_active: false,
        passable: false,
        landable: false,
        supply: false,
        fuel: false,
        arming: false,
        repair: false,
    }
}
fn event_of(f: &Facility, kind: &str, detail: Value) -> FacilityEvent {
    FacilityEvent {
        kind: kind.into(),
        facility_id: f.view.facility_id.clone(),
        revision: f.view.revision,
        geometry_revision: f.view.geometry_revision,
        detail,
    }
}
fn validate_impact(i: &FacilityImpact) -> Result<(), String> {
    if i.event_id == 0
        || i.team > 1
        || !i.energy_j.is_finite()
        || i.energy_j < 0.0
        || !i.tnt_kg.is_finite()
        || i.tnt_kg < 0.0
    {
        return Err("Invalid accepted facility impact".into());
    }
    Ok(())
}
fn text(v: &Value) -> Result<&str, String> {
    v.as_str()
        .filter(|s| !s.is_empty() && s.len() < 256 && !s.chars().any(char::is_control))
        .ok_or("Missing/invalid facility source ID".into())
}
fn number(v: &Value) -> Result<f64, String> {
    v.as_f64()
        .filter(|v| v.is_finite())
        .ok_or("Nonfinite/missing facility number".into())
}
fn positive(v: &Value) -> Result<f64, String> {
    number(v).and_then(|v| {
        if v > 0.0 {
            Ok(v)
        } else {
            Err("Nonpositive facility dimension".into())
        }
    })
}
fn team(v: &Value) -> Result<u8, String> {
    v.as_u64()
        .filter(|t| *t <= 1)
        .map(|t| t as u8)
        .ok_or("Enabled facility needs source team0/1".into())
}
fn point2(v: &Value) -> Result<[f64; 2], String> {
    let p: [f64; 2] = serde_json::from_value(v.clone()).map_err(|e| e.to_string())?;
    if p.iter().all(|v| v.is_finite()) {
        Ok(p)
    } else {
        Err("Nonfinite facility point".into())
    }
}
fn point3(v: &Value) -> Result<Point, String> {
    let p: Point = serde_json::from_value(v.clone()).map_err(|e| e.to_string())?;
    if finite(p) {
        Ok(p)
    } else {
        Err("Nonfinite facility point".into())
    }
}
fn array_required(v: &Value) -> Result<&Vec<Value>, String> {
    v.as_array().ok_or("Facility source array missing".into())
}
fn array_or_empty(v: Option<&Value>) -> Result<&[Value], String> {
    match v {
        None => Ok(&[]),
        Some(v) => v
            .as_array()
            .map(Vec::as_slice)
            .ok_or("Facility source array invalid".into()),
    }
}
fn finite(p: Point) -> bool {
    p.iter().all(|v| v.is_finite())
}
fn distance(a: Point, b: Point) -> f64 {
    let d = ray::sub(a, b);
    ray::dot(d, d).sqrt()
}
fn dist2(a: [f64; 2], b: [f64; 2]) -> f64 {
    (a[0] - b[0]).hypot(a[1] - b[1])
}
fn near(a: [f64; 2], b: [f64; 2]) -> bool {
    dist2(a, b) <= 1e-6
}
fn area(r: &[[f64; 2]]) -> f64 {
    let o = r[0];
    r.iter()
        .enumerate()
        .map(|(i, a)| {
            let b = r[(i + 1) % r.len()];
            (a[0] - o[0]) * (b[1] - o[1]) - (b[0] - o[0]) * (a[1] - o[1])
        })
        .sum::<f64>()
        / 2.0
}
fn closed_ring(v: &Value) -> Result<Vec<[f64; 2]>, String> {
    let mut r: Vec<[f64; 2]> = serde_json::from_value(v.clone()).map_err(|e| e.to_string())?;
    if r.len() < 4 || r.iter().flatten().any(|v| !v.is_finite()) || !near(r[0], *r.last().unwrap())
    {
        return Err("Facility joint ring must be finite and closed".into());
    }
    r.pop();
    if area(&r).abs() < 1e-10 {
        return Err("Degenerate facility ring".into());
    }
    Ok(r)
}
fn relation(p: [f64; 2], r: &[[f64; 2]]) -> u8 {
    let mut inside = false;
    for i in 0..r.len() {
        let a = r[i];
        let b = r[(i + 1) % r.len()];
        let dx = b[0] - a[0];
        let dz = b[1] - a[1];
        let l = dx.hypot(dz);
        if l > 0.0
            && ((p[0] - a[0]) * dz - (p[1] - a[1]) * dx).abs() <= 1e-6 * l
            && (p[0] - a[0]) * (p[0] - b[0]) + (p[1] - a[1]) * (p[1] - b[1]) <= 1e-12
        {
            return 2;
        }
        if (a[1] > p[1]) != (b[1] > p[1])
            && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]
        {
            inside = !inside;
        }
    }
    u8::from(inside)
}
fn orient(a: [f64; 2], b: [f64; 2], c: [f64; 2]) -> f64 {
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
}
fn triangle_in_polygon(t: [[f64; 2]; 3], r: &[[f64; 2]], holes: &[Vec<[f64; 2]>]) -> bool {
    let inside = |p| relation(p, r) > 0 && !holes.iter().any(|h| relation(p, h) == 1);
    let mut probes = t.to_vec();
    probes.push([
        (t[0][0] + t[1][0] + t[2][0]) / 3.0,
        (t[0][1] + t[1][1] + t[2][1]) / 3.0,
    ]);
    for i in 0..3 {
        probes.push([
            (t[i][0] + t[(i + 1) % 3][0]) / 2.0,
            (t[i][1] + t[(i + 1) % 3][1]) / 2.0,
        ]);
    }
    if !probes.into_iter().all(inside) {
        return false;
    }
    for ring in std::iter::once(r).chain(holes.iter().map(Vec::as_slice)) {
        for i in 0..ring.len() {
            for k in 0..3 {
                let a = t[k];
                let b = t[(k + 1) % 3];
                let c = ring[i];
                let d = ring[(i + 1) % ring.len()];
                if orient(a, b, c) * orient(a, b, d) < -1e-18
                    && orient(c, d, a) * orient(c, d, b) < -1e-18
                {
                    return false;
                }
            }
        }
    }
    for h in holes {
        if h.iter().any(|&p| {
            let o = [
                orient(t[0], t[1], p),
                orient(t[1], t[2], p),
                orient(t[2], t[0], p),
            ];
            o.iter().all(|v| *v > 1e-10) || o.iter().all(|v| *v < -1e-10)
        }) {
            return false;
        }
    }
    true
}
fn oriented_rect(c: [f64; 2], f: [f64; 2], hw: f64, hl: f64) -> Vec<[f64; 2]> {
    [(-1.0, -1.0), (-1.0, 1.0), (1.0, 1.0), (1.0, -1.0)]
        .into_iter()
        .map(|(x, z)| {
            [
                c[0] + f[1] * hw * x + f[0] * hl * z,
                c[1] - f[0] * hw * x + f[1] * hl * z,
            ]
        })
        .collect()
}
fn solid_triangle(
    p: [[f64; 2]; 3],
    thickness: f64,
    h: &impl Fn(f64, f64) -> f64,
    tri: &mut Vec<Triangle>,
    roles: &mut Vec<String>,
) -> Result<(), String> {
    let t = p.map(|p| [p[0], h(p[0], p[1]), p[1]]);
    if t.iter().flatten().any(|v| !v.is_finite()) {
        return Err("Nonfinite canonical facility surface".into());
    }
    tri.push(t);
    roles.push("bridge_top".into());
    tri.push([
        t[0].map_with_y(-thickness),
        t[2].map_with_y(-thickness),
        t[1].map_with_y(-thickness),
    ]);
    roles.push("bridge_bottom".into());
    Ok(())
}
trait OffsetY {
    fn map_with_y(self, dy: f64) -> Self;
}
impl OffsetY for Point {
    fn map_with_y(self, dy: f64) -> Self {
        [self[0], self[1] + dy, self[2]]
    }
}
fn side_faces(
    r: &[[f64; 2]],
    thickness: f64,
    hole: bool,
    h: &impl Fn(f64, f64) -> f64,
    tri: &mut Vec<Triangle>,
    roles: &mut Vec<String>,
) -> Result<(), String> {
    let mut r = r.to_vec();
    if (area(&r) < 0.0) == hole {
        r.reverse();
    }
    for i in 0..r.len() {
        let a = r[i];
        let b = r[(i + 1) % r.len()];
        if near(a, b) {
            continue;
        }
        let a = [a[0], h(a[0], a[1]), a[1]];
        let b = [b[0], h(b[0], b[1]), b[1]];
        if !finite(a) || !finite(b) {
            return Err("Nonfinite facility side".into());
        }
        tri.push([a, a.map_with_y(-thickness), b.map_with_y(-thickness)]);
        tri.push([a, b.map_with_y(-thickness), b]);
        roles.extend(["bridge_side".into(), "bridge_side".into()]);
    }
    Ok(())
}
fn box_triangles(center: Point, half: [f64; 3]) -> Vec<Triangle> {
    let [x, y, z] = center;
    let [hx, height, hz] = half;
    let v = [
        [x - hx, y, z - hz],
        [x + hx, y, z - hz],
        [x + hx, y, z + hz],
        [x - hx, y, z + hz],
        [x - hx, y + height, z - hz],
        [x + hx, y + height, z - hz],
        [x + hx, y + height, z + hz],
        [x - hx, y + height, z + hz],
    ];
    [
        [0, 2, 1],
        [0, 3, 2],
        [4, 5, 6],
        [4, 6, 7],
        [0, 1, 5],
        [0, 5, 4],
        [1, 2, 6],
        [1, 6, 5],
        [2, 3, 7],
        [2, 7, 6],
        [3, 0, 4],
        [3, 4, 7],
    ]
    .map(|t| [v[t[0]], v[t[2]], v[t[1]]])
    .to_vec()
}
fn segment_bounds(a: Point, b: Point, bounds: [Point; 2]) -> bool {
    let (mut lo, mut hi) = (0.0_f64, 1.0_f64);
    for k in 0..3 {
        let d = b[k] - a[k];
        if d == 0.0 {
            if a[k] < bounds[0][k] || a[k] > bounds[1][k] {
                return false;
            }
        } else {
            let margin = 1e-9
                + 128.0
                    * f64::EPSILON
                    * (a[k]
                        .abs()
                        .max(b[k].abs())
                        .max(bounds[0][k].abs())
                        .max(bounds[1][k].abs()));
            let x = (bounds[0][k] - margin - a[k]) / d;
            let y = (bounds[1][k] + margin - a[k]) / d;
            lo = lo.max(x.min(y));
            hi = hi.min(x.max(y));
            if lo > hi {
                return false;
            }
        }
    }
    true
}
fn facility_distance(f: &Facility, p: Point) -> f64 {
    f.geometry
        .triangles
        .iter()
        .map(|t| point_triangle_distance(p, *t))
        .fold(f64::INFINITY, f64::min)
}
fn point_triangle_distance(p: Point, t: Triangle) -> f64 {
    let [a, b, c] = t;
    let ab = ray::sub(b, a);
    let ac = ray::sub(c, a);
    let normal = ray::cross(ab, ac);
    if ray::dot(normal, normal) == 0.0 {
        return [(a, b), (b, c), (c, a)]
            .into_iter()
            .map(|(a, b)| {
                let d = ray::sub(b, a);
                let length = ray::dot(d, d);
                let q = if length > 0.0 {
                    ray::point_at(a, b, (ray::dot(ray::sub(p, a), d) / length).clamp(0.0, 1.0))
                } else {
                    a
                };
                distance(p, q)
            })
            .fold(f64::INFINITY, f64::min);
    }
    let ap = ray::sub(p, a);
    let d1 = ray::dot(ab, ap);
    let d2 = ray::dot(ac, ap);
    if d1 <= 0.0 && d2 <= 0.0 {
        return distance(p, a);
    }
    let bp = ray::sub(p, b);
    let d3 = ray::dot(ab, bp);
    let d4 = ray::dot(ac, bp);
    if d3 >= 0.0 && d4 <= d3 {
        return distance(p, b);
    }
    let vc = d1 * d4 - d3 * d2;
    if vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0 {
        return distance(p, ray::point_at(a, b, d1 / (d1 - d3)));
    }
    let cp = ray::sub(p, c);
    let d5 = ray::dot(ab, cp);
    let d6 = ray::dot(ac, cp);
    if d6 >= 0.0 && d5 <= d6 {
        return distance(p, c);
    }
    let vb = d5 * d2 - d1 * d6;
    if vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0 {
        return distance(p, ray::point_at(a, c, d2 / (d2 - d6)));
    }
    let va = d3 * d6 - d5 * d4;
    if va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0 {
        return distance(p, ray::point_at(b, c, (d4 - d3) / ((d4 - d3) + (d5 - d6))));
    }
    let denom = va + vb + vc;
    if denom == 0.0 {
        return distance(p, a).min(distance(p, b)).min(distance(p, c));
    }
    let v = vb / denom;
    let w = vc / denom;
    distance(
        p,
        [
            a[0] + ab[0] * v + ac[0] * w,
            a[1] + ab[1] * v + ac[1] * w,
            a[2] + ab[2] * v + ac[2] * w,
        ],
    )
}

#[cfg(test)]
#[path = "frontline_facilities_tests.rs"]
mod tests;
