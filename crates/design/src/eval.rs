//! `evaluate`: every derived number of a design, recomputed from the raw design data.
//! This is what the server runs on submission; the editor runs the same code (WASM) for its
//! live readouts, so what a player sees while designing is what the server will accept.
use crate::armor::{stack_at, wall_depth_mm};
use crate::compile::{compile, CompiledVehicle};
use crate::drive::{engine_file, mobility_runs, MobilityReport};
use crate::gun::{gun_clearance, turret_sweep, GunClearance, TurretSweep};
use crate::layout::{rack_capacity, round_mass, BoxKind, Model, PlacedBox};
use crate::mesh::Geo;
use crate::model::*;
use crate::v3::{v3, solve3, Aabb, V3};
use crate::validate::{validate, Issue};
use crate::Db;
use serde::Serialize;
use std::collections::HashMap;
use tg_weapon::ProjectileDef;

const G: f64 = 9.81;

#[derive(Clone, Debug, Default, Serialize)]
pub struct Extent {
    pub min: V3,
    pub max: V3,
    pub length_m: f64,
    pub width_m: f64,
    pub height_m: f64,
}

impl Extent {
    fn of(b: &Aabb) -> Extent {
        if b.is_empty() {
            return Extent::default();
        }
        let s = b.size();
        Extent { min: b.min, max: b.max, length_m: s.z, width_m: s.x, height_m: s.y }
    }
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Dimensions {
    pub hull: Extent,
    pub turret: Extent,
    pub overall_length_m: f64,
    pub overall_width_m: f64,
    pub overall_height_m: f64,
    pub ground_clearance_m: f64,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct Volumes {
    pub hull_m3: f64,
    pub turret_m3: f64,
    pub hull_interior_m3: f64,
    pub turret_interior_m3: f64,
    pub interior_m3: f64,
    pub modules_m3: f64,
    pub crew_m3: f64,
    pub free_m3: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct LayerOut {
    pub material: String,
    pub thickness_mm: f64,
    pub depth_mm: f64,
    pub span_mm: f64,
    pub main: bool,
    pub density: f64,
    pub hardness: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct ArmorFaceReport {
    pub id: u32,
    pub body: Body,
    pub tag: String,
    /// Corner positions in the body's own space (turret space for turret faces).
    pub vertices: Vec<V3>,
    pub normal: V3,
    pub area_m2: f64,
    pub material: String,
    pub density: f64,
    pub hardness: f64,
    pub thickness_mm: f64,
    pub min_mm: f64,
    pub max_mm: f64,
    pub variable: bool,
    pub layers: Vec<LayerOut>,
    pub wall_mm: f64,
    pub mass_kg: f64,
    pub areal_density_kg_m2: f64,
    /// Plate angle from vertical (0 = vertical plate, 90 = roof/floor).
    pub slope_deg: f64,
    pub rha_equiv_mm: f64,
    pub planarity_mm: f64,
    pub has_armor: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct AddonReport {
    pub id: String,
    pub kind: AddonKind,
    pub body: Body,
    pub mass_kg: f64,
    /// Slab centre and corners in the body's own space.
    pub center: V3,
    pub corners: Vec<V3>,
    pub area_m2: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct MassItem {
    pub key: String,
    pub label: String,
    pub kg: f64,
    pub com: V3,
    pub rotating: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct MassReport {
    pub total_kg: f64,
    pub armor_kg: f64,
    pub hull_armor_kg: f64,
    pub turret_armor_kg: f64,
    pub addon_kg: f64,
    pub turret_rotating_kg: f64,
    pub items: Vec<MassItem>,
    pub inertia_yaw_kg_m2: f64,
    /// About the centre of mass along the hull axes [x (pitch), y (yaw), z (roll)].
    pub inertia_kg_m2: [f64; 3],
}

#[derive(Clone, Debug, Serialize)]
pub struct StationLoad {
    pub side: i8,
    pub index: usize,
    pub z: f64,
    pub load_kn: f64,
    pub rating_kn: f64,
    pub ratio: f64,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct GroupLoad {
    pub stations: usize,
    pub load_kn: f64,
    pub rating_kn: f64,
    pub ratio: f64,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct SuspensionReport {
    pub kind: String,
    pub label: String,
    pub stations: Vec<StationLoad>,
    pub front: GroupLoad,
    pub middle: GroupLoad,
    pub rear: GroupLoad,
    pub max_ratio: f64,
    pub mean_ratio: f64,
    /// Some station would have to pull the hull down: the centre of mass is outside the wheels.
    pub lifted: bool,
    pub travel_m: f64,
    pub com_offset_m: f64,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct TurretReport {
    pub ring_diameter_m: f64,
    pub ring_position_m: V3,
    pub ring_on_hull: bool,
    pub ring_outside_points: usize,
    pub ring_buried_points: usize,
    pub ring_covered: bool,
    pub mass_kg: f64,
    pub ring_capacity_kg: f64,
    pub overhang_ratio: f64,
    pub traverse_deg_s: f64,
    pub sweep: TurretSweep,
    pub wider_than_hull_m: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct ShellReport {
    pub def: ProjectileDef,
    pub pen_mm: [f64; 4],
    pub round_kg: f64,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct GunReport {
    pub caliber_mm: f64,
    pub length_cal: f64,
    pub gun_kg: f64,
    pub mount_kg: f64,
    pub recoil_m: f64,
    pub recoil_default_m: f64,
    pub breech_m: [f64; 3],
    pub barrel_m: f64,
    pub muzzle_velocity_ms: f64,
    pub clearance: GunClearance,
    pub shells: Vec<ShellReport>,
    pub reload_s: f64,
    pub reload_distance_m: f64,
    pub loaders: usize,
    pub dispersion_mrad: f64,
    pub trunnion_hull_m: V3,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct AmmoReport {
    pub rounds: u32,
    pub capacity: u32,
    pub mass_kg: f64,
    pub racks: Vec<(String, u32)>,
    pub invalid_kinds: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct BoxReport {
    pub id: String,
    pub kind: String,
    pub crew: bool,
    pub mount: Body,
    pub center: V3,
    pub size: V3,
    pub mass_kg: f64,
    /// Hull-space box at turret yaw 0.
    pub hull_min: V3,
    pub hull_max: V3,
    pub inside: bool,
    pub outside_points: usize,
    pub collisions: Vec<String>,
    pub capacity: Option<f64>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct InteriorReport {
    pub boxes: Vec<BoxReport>,
    pub collisions: Vec<(String, String)>,
    /// Turret-mounted item that sweeps through a hull item when the turret turns.
    pub sweep_hits: Vec<(String, String)>,
    /// Crew / modules inside the space the breech and its recoil sweep.
    pub breech_hits: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct GearReport {
    pub stations: Vec<[f64; 3]>,
    pub sprocket: [f64; 3],
    pub idler: [f64; 3],
    pub rollers: Vec<[f64; 3]>,
    pub track_x_m: f64,
    pub track_width_m: f64,
    pub contact_length_m: f64,
    pub loop_length_m: f64,
    pub track_kg: f64,
    pub envelope_min: V3,
    pub envelope_max: V3,
    pub hull_clash_points: usize,
    pub gap_to_hull_m: f64,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct EngineReport {
    pub kind: String,
    pub label: String,
    pub power_hp: f64,
    pub mass_kg: f64,
    pub size_m: V3,
    pub max_rpm: f64,
    pub torque_curve: Vec<[f32; 2]>,
    pub gear_ratios: Vec<f32>,
    pub final_drive: f64,
    pub transmission_label: String,
    pub steering_label: String,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct InnerShell {
    pub hull: Vec<V3>,
    pub turret: Vec<V3>,
}

#[derive(Clone, Debug, Serialize)]
pub struct DesignReport {
    pub design_id: String,
    pub design_hash: String,
    pub dimensions: Dimensions,
    pub volumes: Volumes,
    pub armor_faces: Vec<ArmorFaceReport>,
    pub addons: Vec<AddonReport>,
    pub inner: InnerShell,
    pub mass: MassReport,
    pub center_of_mass: V3,
    pub suspension: SuspensionReport,
    pub mobility: MobilityReport,
    pub turret: Option<TurretReport>,
    pub gun: Option<GunReport>,
    pub ammunition: AmmoReport,
    pub interior: InteriorReport,
    pub running_gear: GearReport,
    pub engine: EngineReport,
    pub issues: Vec<Issue>,
    pub errors: usize,
    pub warnings: usize,
    pub battle_ready: bool,
    #[serde(skip)]
    pub compiled: Option<CompiledVehicle>,
}

/// FNV-1a over the canonical JSON of the design without its editor state.
pub fn design_hash(d: &VehicleDesign) -> String {
    let mut c = d.clone();
    c.editor = serde_json::Value::Null;
    let s = serde_json::to_string(&c).unwrap_or_default();
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{:016x}", h)
}

/// Inner surface of the armour: every vertex pulled in along its faces' normals by their wall
/// depths (least squares, so it works at any vertex valence).
pub fn inner_vertices(g: &Geo, wall_m: &[f64]) -> Vec<V3> {
    let mut adj: Vec<Vec<usize>> = vec![vec![]; g.verts.len()];
    for (fi, f) in g.faces.iter().enumerate() {
        for &i in &f.idx {
            adj[i].push(fi);
        }
    }
    g.verts
        .iter()
        .enumerate()
        .map(|(vi, &v)| {
            if adj[vi].is_empty() {
                return v;
            }
            let eps = 1e-3;
            let mut m = [[eps, 0.0, 0.0], [0.0, eps, 0.0], [0.0, 0.0, eps]];
            let mut b = [eps * v.x, eps * v.y, eps * v.z];
            for &fi in &adj[vi] {
                let n = g.faces[fi].normal;
                let rhs = n.dot(v) - wall_m[fi];
                let na = [n.x, n.y, n.z];
                for r in 0..3 {
                    for c in 0..3 {
                        m[r][c] += na[r] * na[c];
                    }
                    b[r] += na[r] * rhs;
                }
            }
            solve3(m, b).map(V3::from).unwrap_or(v)
        })
        .collect()
}

fn inner_volume(g: &Geo, inner: &[V3]) -> (f64, V3, bool) {
    let mut vol = 0.0;
    let mut c = V3::ZERO;
    let mut inverted = false;
    for f in &g.faces {
        let pts: Vec<V3> = f.idx.iter().map(|&i| inner[i]).collect();
        let n = crate::mesh::newell(&pts);
        if n.dot(f.normal) < 0.0 {
            inverted = true;
        }
        for t in &f.tris {
            let (a, b, d) = (pts[t[0]], pts[t[1]], pts[t[2]]);
            let v6 = a.dot(b.cross(d));
            vol += v6;
            c += (a + b + d) * v6;
        }
    }
    let v = vol / 6.0;
    (v, if vol.abs() > 1e-12 { c / (4.0 * vol) } else { g.bounds.center() }, inverted)
}

pub(crate) struct Ctx<'a> {
    pub model: Model<'a>,
    pub hull_inverted: bool,
    pub turret_inverted: bool,
}

pub fn evaluate(d: &VehicleDesign, db: &Db) -> DesignReport {
    evaluate_with(d, db, true)
}

/// `mobility_sim` = run the full-throttle physics runs (skipped for quick interactive previews).
pub fn evaluate_with(d: &VehicleDesign, db: &Db, mobility_sim: bool) -> DesignReport {
    let cat = &db.catalog;
    let m = Model::new(d, db);

    // ---------------------------------------------------------------- armour faces
    let mut armor_faces = vec![];
    let mut push_faces = |g: &Geo, body: Body, masses: &[crate::armor::FaceMass], to_local: &dyn Fn(V3) -> V3| {
        for (fi, f) in g.faces.iter().enumerate() {
            let fa = m.face_armor(body, f.id);
            let mm = &masses[fi];
            let main = fa.map(|a| a.main);
            let mat = main.and_then(|a| db.materials.get(&a.material));
            let layers = fa
                .map(|fa| {
                    stack_at(g, f, fa, f.centroid)
                        .into_iter()
                        .map(|l| {
                            let lm = db.materials.get(&l.material);
                            LayerOut { density: lm.map(|x| x.density_kg_m3 as f64).unwrap_or(0.0), hardness: lm.map(|x| x.hardness_bhn as f64).unwrap_or(0.0), material: l.material, thickness_mm: l.thickness_mm, depth_mm: l.depth_mm, span_mm: l.span_mm, main: l.main }
                        })
                        .collect()
                })
                .unwrap_or_default();
            armor_faces.push(ArmorFaceReport {
                id: f.id,
                body,
                tag: f.tag.clone(),
                vertices: f.idx.iter().map(|&i| to_local(g.verts[i])).collect(),
                normal: f.normal,
                area_m2: f.area,
                material: main.map(|a| a.material.clone()).unwrap_or_default(),
                density: mat.map(|x| x.density_kg_m3 as f64).unwrap_or(0.0),
                hardness: mat.map(|x| x.hardness_bhn as f64).unwrap_or(0.0),
                thickness_mm: mm.main_mean_mm,
                min_mm: mm.main_min_mm,
                max_mm: mm.main_max_mm,
                variable: main.map(|a| a.vertex_mm.is_some() || a.map.is_some()).unwrap_or(false),
                layers,
                wall_mm: mm.wall_mean_mm,
                mass_kg: mm.mass_kg,
                areal_density_kg_m2: if f.area > 0.0 { mm.mass_kg / f.area } else { 0.0 },
                slope_deg: f.normal.y.clamp(-1.0, 1.0).asin().to_degrees().abs(),
                rha_equiv_mm: mm.rha_equiv_mm,
                planarity_mm: f.planarity * 1000.0,
                has_armor: fa.is_some(),
            });
        }
    };
    push_faces(&m.hull, Body::Hull, &m.hull_face_mass, &|p| p);
    let ring_pos = m.ring.as_ref().map(|r| r.pos).unwrap_or(V3::ZERO);
    if let Some(t) = &m.turret {
        push_faces(t, Body::Turret, &m.turret_face_mass, &|p| p - ring_pos);
    }

    // ---------------------------------------------------------------- inner shell & volumes
    let walls = |g: &Geo, body: Body| -> Vec<f64> { g.faces.iter().map(|f| m.face_armor(body, f.id).map(|fa| wall_depth_mm(g, f, fa, f.centroid)).unwrap_or(0.0) * 0.001).collect() };
    let hull_inner = inner_vertices(&m.hull, &walls(&m.hull, Body::Hull));
    let (hull_in_vol, hull_in_c, hull_inverted) = inner_volume(&m.hull, &hull_inner);
    let (hull_vol, _) = m.hull.volume();
    let (turret_inner, turret_in_vol, turret_inverted, turret_vol) = match &m.turret {
        Some(t) => {
            let inner = inner_vertices(t, &walls(t, Body::Turret));
            let (v, _, inv) = inner_volume(t, &inner);
            (inner.into_iter().map(|p| p - ring_pos).collect(), v, inv, t.volume().0)
        }
        None => (vec![], 0.0, false, 0.0),
    };

    // ---------------------------------------------------------------- masses
    let mut items: Vec<MassItem> = vec![];
    let mut add = |key: &str, label: &str, kg: f64, com: V3, rotating: bool| {
        if kg > 0.0 && kg.is_finite() {
            items.push(MassItem { key: key.into(), label: label.into(), kg, com, rotating });
        }
    };
    let sum_faces = |masses: &[crate::armor::FaceMass]| -> (f64, V3) {
        let kg: f64 = masses.iter().map(|x| x.mass_kg).sum();
        let mut c = V3::ZERO;
        for x in masses {
            c += x.com * x.mass_kg;
        }
        (kg, if kg > 0.0 { c / kg } else { V3::ZERO })
    };
    let (hull_armor_kg, hc) = sum_faces(&m.hull_face_mass);
    add("hull_armor", "車體裝甲", hull_armor_kg, hc, false);
    let (turret_armor_kg, tc) = sum_faces(&m.turret_face_mass);
    add("turret_armor", "炮塔裝甲", turret_armor_kg, tc, true);

    let mut addon_reports = vec![];
    let mut addon_kg = 0.0;
    for a in &d.addons {
        let rho = db.materials.get(&a.material).map(|x| x.density_kg_m3 as f64).unwrap_or(7850.0);
        let area = a.size_m[0].max(0.0) * a.size_m[1].max(0.0);
        let kg = area * a.thickness_mm.max(0.0) * 0.001 * rho;
        let (center, corners) = addon_box(a);
        let com_h = m.to_hull(a.body, center, 0.0);
        add(&format!("addon:{}", a.id), "附加裝甲", kg, com_h, a.body == Body::Turret);
        addon_kg += kg;
        addon_reports.push(AddonReport { id: a.id.clone(), kind: a.kind, body: a.body, mass_kg: kg, center, corners, area_m2: area });
    }
    let mut mantlet_kg = 0.0;
    if let Some(g) = &m.gun {
        let mt = &g.mount.mantlet;
        let rho = db.materials.get(&mt.material).map(|x| x.density_kg_m3 as f64).unwrap_or(7850.0);
        mantlet_kg = mt.width_m.max(0.0) * mt.height_m.max(0.0) * mt.thickness_mm.max(0.0) * 0.001 * rho;
        add("mantlet", "炮盾", mantlet_kg, m.turret_to_hull(g.trunnion + v3(0.0, 0.0, mt.offset_m + mt.thickness_mm * 0.0005), 0.0), true);
        // gun mass sits a little ahead of the trunnion
        add("gun", "火炮與炮架", g.gun_kg + g.mount_kg, m.turret_to_hull(g.trunnion + v3(0.0, 0.0, g.muzzle * 0.18), 0.0), true);
        if let Some(sc) = d.weapons.as_ref().and_then(|w| cat.stabilizers.get(&w.stabilizer)) {
            let kg = sc.kg_base + sc.kg_per_mm * g.cal;
            if kg > 0.0 {
                add("stabilizer", "火炮穩定器", kg, m.turret_to_hull(g.trunnion - v3(0.0, 0.2, 0.3), 0.0), true);
            }
        }
    }
    for b in &m.boxes {
        let com = m.to_hull(b.mount, b.center, 0.0);
        let rot = b.mount == Body::Turret;
        match b.kind {
            BoxKind::Module(ModuleKindDef::Engine) => add("engine", "引擎", b.mass_kg, com, false),
            BoxKind::Module(ModuleKindDef::Transmission) => add("transmission", "傳動與轉向", b.mass_kg, com, false),
            BoxKind::Module(ModuleKindDef::FuelTank) => add(&format!("fuel:{}", b.id), "油箱與燃油", b.mass_kg, com, rot),
            BoxKind::Module(ModuleKindDef::AmmoRack) => add(&format!("rack:{}", b.id), "彈藥架", b.mass_kg, com, rot),
            BoxKind::Module(ModuleKindDef::Radio) => add(&format!("radio:{}", b.id), "無線電", b.mass_kg, com, rot),
            BoxKind::Module(ModuleKindDef::TurretDrive) => add(&format!("drive:{}", b.id), "炮塔驅動", b.mass_kg, com, rot),
            BoxKind::Crew(_) => add(&format!("crew:{}", b.id), "乘員", b.mass_kg, com, rot),
            BoxKind::Breech => {}
        }
    }
    // ammunition: rounds fill the racks in order
    let mut ammo = AmmoReport::default();
    let gun_cal = m.gun.as_ref().map(|g| g.cal).unwrap_or(0.0);
    let racks: Vec<&PlacedBox> = m.boxes.iter().filter(|b| b.kind == BoxKind::Module(ModuleKindDef::AmmoRack)).collect();
    let caps: Vec<u32> = racks.iter().map(|b| rack_capacity(cat, b.size, gun_cal)).collect();
    ammo.capacity = caps.iter().sum();
    ammo.racks = racks.iter().zip(caps.iter()).map(|(b, c)| (b.id.clone(), *c)).collect();
    let mut queue: Vec<f64> = vec![];
    for a in &d.ammunition {
        let shell = m.gun.as_ref().and_then(|g| g.shells.iter().find(|s| s.id.starts_with(&format!("{}_design", a.kind))));
        match shell {
            Some(s) => {
                ammo.rounds += a.count;
                for _ in 0..a.count.min(10_000) {
                    queue.push(round_mass(cat, s));
                }
            }
            None => {
                if a.count > 0 {
                    ammo.invalid_kinds.push(a.kind.clone())
                }
            }
        }
    }
    let mut qi = 0;
    for (b, cap) in racks.iter().zip(caps.iter()) {
        let take = (*cap as usize).min(queue.len() - qi);
        let kg: f64 = queue[qi..qi + take].iter().sum();
        qi += take;
        ammo.mass_kg += kg;
        add(&format!("ammo:{}", b.id), "彈藥", kg, m.to_hull(b.mount, b.center, 0.0), b.mount == Body::Turret);
    }
    if qi < queue.len() {
        // rounds that have no rack still weigh something: stowed loose at the hull centre
        let kg: f64 = queue[qi..].iter().sum();
        ammo.mass_kg += kg;
        add("ammo:loose", "未上架彈藥", kg, v3(0.0, hull_in_c.y, hull_in_c.z), false);
    }
    // turret ring and drive
    if let Some(r) = &m.ring {
        let kg = cat.turret_ring.kg_per_m * std::f64::consts::PI * r.d + cat.turret_ring.drive_kg;
        add("ring", "炮塔座圈與驅動", kg, r.pos, false);
    }
    // running gear
    let s_cat = m.susp_cat;
    let n = m.gear.stations.len();
    if let Some(sc) = s_cat {
        let wheel_kg = sc.station_kg + sc.wheel_kg_per_m2 * d.suspension.wheel_diameter_m.powi(2);
        let zc = m.gear.stations.iter().map(|w| w.z).sum::<f64>() / n.max(1) as f64;
        add("suspension", "懸掛與負重輪", wheel_kg * n as f64 * 2.0 + 4.0 * 180.0, v3(0.0, m.gear.stations.first().map(|w| w.y).unwrap_or(0.4), zc), false);
    }
    let track_kg = 2.0 * m.gear.loop_length * d.tracks.width_m * cat.tracks.kg_per_m_per_m_width;
    add("tracks", "履帶", track_kg, v3(0.0, m.gear.envelope.center().y, m.gear.envelope.center().z), false);
    add("fittings", "內部配件", (hull_in_vol.max(0.0) + turret_in_vol.max(0.0)) * cat.fittings_kg_per_m3, hull_in_c, false);

    let total: f64 = items.iter().map(|i| i.kg).sum();
    let mut com = V3::ZERO;
    for i in &items {
        com += i.com * i.kg;
    }
    com = if total > 0.0 { com / total } else { V3::ZERO };
    // inertia tensor (diagonal, hull axes) about the centre of mass: every mass item as a point,
    // plus a box-shaped share for the distributed hull (plates, fittings are not points)
    let mut tensor = [0.0f64; 3];
    for i in &items {
        let r = i.com - com;
        tensor[0] += i.kg * (r.y * r.y + r.z * r.z);
        tensor[1] += i.kg * (r.x * r.x + r.z * r.z);
        tensor[2] += i.kg * (r.x * r.x + r.y * r.y);
    }
    let hb = m.hull.bounds.size();
    let share = total * 0.35 / 12.0;
    tensor[0] += share * (hb.y * hb.y + hb.z * hb.z);
    tensor[1] += share * (hb.x * hb.x + hb.z * hb.z);
    tensor[2] += share * (hb.x * hb.x + hb.y * hb.y);
    let inertia = tensor[1];
    let rotating: f64 = items.iter().filter(|i| i.rotating).map(|i| i.kg).sum::<f64>() + if m.ring.is_some() { 0.0 } else { 0.0 };
    let mass = MassReport { total_kg: total, armor_kg: hull_armor_kg + turret_armor_kg + addon_kg + mantlet_kg, hull_armor_kg, turret_armor_kg, addon_kg, turret_rotating_kg: rotating, items, inertia_yaw_kg_m2: inertia, inertia_kg_m2: tensor };

    // ---------------------------------------------------------------- suspension loads
    let mut susp = SuspensionReport { kind: d.suspension.kind.clone(), label: s_cat.map(|c| c.label.clone()).unwrap_or_default(), ..Default::default() };
    let rating = s_cat.map(|c| c.rating_kn_per_m * d.suspension.wheel_diameter_m).unwrap_or(0.0);
    if n > 0 && total > 0.0 {
        let w = total * G / 1000.0; // kN
        let zs: Vec<f64> = m.gear.stations.iter().map(|w| w.z).collect();
        let zbar = zs.iter().sum::<f64>() / n as f64;
        let szz: f64 = zs.iter().map(|z| (z - zbar).powi(2)).sum::<f64>() * 2.0;
        let tx = d.tracks.center_x_m.abs().max(0.1);
        let sxx = 2.0 * n as f64 * tx * tx;
        let nn = 2.0 * n as f64;
        for side in [1i8, -1] {
            for (i, z) in zs.iter().enumerate() {
                let x = side as f64 * tx;
                let mut load = w / nn;
                if szz > 1e-9 {
                    load += w * (com.z - zbar) * (z - zbar) / szz;
                }
                load += w * com.x * x / sxx;
                if load < 0.0 {
                    susp.lifted = true;
                }
                susp.stations.push(StationLoad { side, index: i, z: *z, load_kn: load, rating_kn: rating, ratio: if rating > 0.0 { load / rating } else { 0.0 } });
            }
        }
        let third = n.div_ceil(3);
        let group = |range: std::ops::Range<usize>| -> GroupLoad {
            let st: Vec<&StationLoad> = susp.stations.iter().filter(|s| range.contains(&s.index)).collect();
            let load: f64 = st.iter().map(|s| s.load_kn).sum();
            let rat: f64 = st.iter().map(|s| s.rating_kn).sum();
            GroupLoad { stations: st.len(), load_kn: load, rating_kn: rat, ratio: if rat > 0.0 { load / rat } else { 0.0 } }
        };
        let (f_end, r_start) = if n >= 3 { (third, n - third) } else { (1.min(n), n.saturating_sub(1).max(1)) };
        susp.front = group(0..f_end);
        susp.middle = group(f_end..r_start);
        susp.rear = group(r_start..n);
        susp.max_ratio = susp.stations.iter().map(|s| s.ratio).fold(0.0, f64::max);
        susp.mean_ratio = susp.stations.iter().map(|s| s.ratio).sum::<f64>() / nn;
        susp.com_offset_m = com.z - zbar;
    }
    let over = (susp.max_ratio - 1.0).max(0.0);
    susp.travel_m = s_cat.map(|c| c.travel_m * (1.0 - 0.6 * over).clamp(0.3, 1.0)).unwrap_or(0.0);

    // ---------------------------------------------------------------- turret
    let sweep = turret_sweep(&m);
    let turret = m.ring.as_ref().map(|r| {
        let mut tr = TurretReport { ring_diameter_m: r.d, ring_position_m: r.pos, sweep: sweep.clone().unwrap_or_default(), ..Default::default() };
        let rad = r.d * 0.5;
        for k in 0..24 {
            let a = k as f64 / 24.0 * std::f64::consts::TAU;
            let p = r.pos + v3(rad * a.cos(), 0.0, rad * a.sin());
            if !m.hull.contains(p - v3(0.0, 0.04, 0.0)) {
                tr.ring_outside_points += 1;
            } else if m.hull.contains(p + v3(0.0, 0.04, 0.0)) {
                tr.ring_buried_points += 1;
            }
        }
        tr.ring_on_hull = tr.ring_outside_points == 0 && tr.ring_buried_points == 0;
        tr.ring_covered = match &m.turret_local {
            Some(tl) => (0..24).all(|k| {
                let a = k as f64 / 24.0 * std::f64::consts::TAU;
                tl.contains(v3(rad * a.cos(), 0.03, rad * a.sin()))
            }),
            None => false,
        };
        tr.mass_kg = rotating;
        tr.ring_capacity_kg = cat.turret_ring.rated_kg_per_m2 * r.d * r.d;
        let tb = m.turret_local.as_ref().map(|t| t.bounds).unwrap_or(Aabb::EMPTY);
        if !tb.is_empty() {
            tr.overhang_ratio = tb.size().z.max(tb.size().x) / r.d.max(0.1);
            let hb = m.hull.bounds;
            tr.wider_than_hull_m = ((r.pos.x + tb.max.x) - hb.max.x).max(hb.min.x - (r.pos.x + tb.min.x)).max(0.0);
        }
        let guns_kg = m.gun.as_ref().map(|g| g.gun_kg).unwrap_or(0.0);
        let drive = match r.drive.as_str() {
            "manual" => 0.35,
            "hydraulic" => 1.15,
            _ => 1.0,
        };
        let load = (tr.ring_capacity_kg * 0.6 / rotating.max(1.0)).min(1.0).sqrt();
        tr.traverse_deg_s = (tg_weapon::design::traverse_rate(r.d as f32, guns_kg as f32) as f64 * drive * load).clamp(2.0, 45.0);
        tr
    });

    // ---------------------------------------------------------------- gun
    let clearance = gun_clearance(&m);
    let gun = m.gun.as_ref().map(|g| {
        let loaders: Vec<V3> = d.crew_positions.iter().filter(|c| c.role == CrewRoleDef::Loader).map(|c| m.to_hull(c.mount, c.position_m, 0.0)).collect();
        let gunner: Vec<V3> = d.crew_positions.iter().filter(|c| c.role == CrewRoleDef::Gunner).map(|c| m.to_hull(c.mount, c.position_m, 0.0)).collect();
        let tr_h = m.turret_to_hull(g.trunnion, 0.0);
        let breech = tr_h - v3(0.0, 0.0, 0.4);
        let rack = racks.iter().map(|b| m.to_hull(b.mount, b.center, 0.0)).min_by(|a, b| (*a - breech).len().total_cmp(&(*b - breech).len()));
        let main_shell = g.shells.iter().find(|s| s.id == g.def.ammo.first().cloned().unwrap_or_default()).or(g.shells.first());
        let shell_kg = main_shell.map(|s| s.mass_kg).unwrap_or(5.0);
        let (reload, dist) = match (rack, loaders.first().or(gunner.first())) {
            (Some(rk), Some(l)) => {
                let r = tg_weapon::design::layout_reload_time(shell_kg, l.to_f32(), rk.to_f32(), breech.to_f32());
                let k = if loaders.is_empty() { 1.6 } else { 1.0 };
                (r.total as f64 * k, r.distance as f64)
            }
            _ => (tg_weapon::design::handling_time(shell_kg) as f64 * 2.0, 0.0),
        };
        GunReport {
            caliber_mm: g.cal,
            length_cal: g.len,
            gun_kg: g.gun_kg,
            mount_kg: g.mount_kg,
            recoil_m: g.recoil,
            recoil_default_m: g.recoil_default,
            breech_m: [g.width, g.height, g.rear],
            barrel_m: g.muzzle,
            muzzle_velocity_ms: g.def.caliber_mm as f64 * 0.0 + g.shells.first().map(|s| s.muzzle_velocity_ms as f64).unwrap_or(0.0),
            clearance: clearance.clone().unwrap_or_default(),
            shells: g.shells.iter().map(|s| ShellReport { pen_mm: [0.0, 500.0, 1000.0, 2000.0].map(|r| s.pen_at(r) as f64), round_kg: round_mass(cat, s), def: s.clone() }).collect(),
            reload_s: reload,
            reload_distance_m: dist,
            loaders: loaders.len(),
            dispersion_mrad: g.def.dispersion_mrad as f64,
            trunnion_hull_m: tr_h,
        }
    });

    // ---------------------------------------------------------------- interior
    let mut interior = InteriorReport::default();
    let mut boxes: Vec<BoxReport> = m
        .boxes
        .iter()
        .map(|b| {
            let outside = b.sample_points().iter().filter(|p| !m.in_mount_space(b.mount, **p)).count();
            let hb = m.box_aabb(b, 0.0);
            let capacity = match b.kind {
                BoxKind::Module(ModuleKindDef::AmmoRack) => Some(rack_capacity(cat, b.size, gun_cal) as f64),
                BoxKind::Module(ModuleKindDef::FuelTank) => Some(b.size.x * b.size.y * b.size.z * cat.fuel.fill * 1000.0),
                _ => None,
            };
            BoxReport {
                id: b.id.clone(),
                kind: b.kind.label().into(),
                crew: matches!(b.kind, BoxKind::Crew(_)),
                mount: b.mount,
                center: b.center,
                size: b.size,
                mass_kg: b.mass_kg,
                hull_min: hb.min,
                hull_max: hb.max,
                inside: outside == 0,
                outside_points: outside,
                collisions: vec![],
                capacity,
            }
        })
        .collect();
    let nb = m.boxes.len();
    for i in 0..nb {
        for j in i + 1..nb {
            let (a, b) = (&m.boxes[i], &m.boxes[j]);
            if a.kind == BoxKind::Breech || b.kind == BoxKind::Breech {
                continue; // the breech is checked with its whole swept volume below
            }
            if m.box_aabb(a, 0.0).overlaps(&m.box_aabb(b, 0.0), 0.005) {
                interior.collisions.push((a.id.clone(), b.id.clone()));
                boxes[i].collisions.push(b.id.clone());
                boxes[j].collisions.push(a.id.clone());
            }
        }
    }
    // breech sweep (elevation range + recoil) against everything in the turret space
    if let (Some(cl), Some(_)) = (&clearance, &m.ring) {
        if let Some(sw) = &cl.breech_sweep {
            for (i, b) in m.boxes.iter().enumerate() {
                if b.kind == BoxKind::Breech {
                    continue;
                }
                let local = match b.mount {
                    Body::Turret => b.local_aabb(),
                    Body::Hull => {
                        let r = m.ring.as_ref().unwrap().pos;
                        let a = b.local_aabb();
                        Aabb { min: a.min - r, max: a.max - r }
                    }
                };
                if sw.overlaps(&local, 0.005) {
                    interior.breech_hits.push(b.id.clone());
                    boxes[i].collisions.push("gun_breech".into());
                }
            }
        }
    }
    // turret items below the ring sweep a cylinder through the hull as the turret turns
    if let Some(r) = &m.ring {
        let mut sweepers: Vec<(String, f64, f64)> = vec![]; // id, radius, lowest local y
        for b in m.boxes.iter().filter(|b| b.mount == Body::Turret) {
            let a = b.local_aabb();
            if a.min.y < 0.0 {
                let rad = a.corners().iter().map(|c| (c.x * c.x + c.z * c.z).sqrt()).fold(0.0, f64::max);
                sweepers.push((b.id.clone(), rad, a.min.y));
            }
        }
        if let Some(sw) = clearance.as_ref().and_then(|c| c.breech_sweep) {
            if sw.min.y < 0.0 {
                let rad = sw.corners().iter().map(|c| (c.x * c.x + c.z * c.z).sqrt()).fold(0.0, f64::max);
                sweepers.push(("gun_breech".into(), rad, sw.min.y));
            }
        }
        for (sid, rad, low) in &sweepers {
            for (i, b) in m.boxes.iter().enumerate() {
                if b.mount != Body::Hull {
                    continue;
                }
                let a = b.local_aabb();
                if a.max.y <= r.pos.y + low || a.min.y >= r.pos.y {
                    continue;
                }
                let cx = r.pos.x.clamp(a.min.x, a.max.x);
                let cz = r.pos.z.clamp(a.min.z, a.max.z);
                if ((cx - r.pos.x).powi(2) + (cz - r.pos.z).powi(2)).sqrt() < *rad - 0.005 {
                    interior.sweep_hits.push((sid.clone(), b.id.clone()));
                    boxes[i].collisions.push(format!("{}（迴轉）", sid));
                }
            }
        }
    }
    interior.boxes = boxes;

    let module_vol: f64 = m.boxes.iter().filter(|b| matches!(b.kind, BoxKind::Module(_))).map(|b| b.size.x * b.size.y * b.size.z).sum();
    let crew_vol: f64 = m.boxes.iter().filter(|b| matches!(b.kind, BoxKind::Crew(_))).map(|b| b.size.x * b.size.y * b.size.z).sum();
    let interior_vol = hull_in_vol.max(0.0) + turret_in_vol.max(0.0);
    let volumes = Volumes {
        hull_m3: hull_vol,
        turret_m3: turret_vol,
        hull_interior_m3: hull_in_vol.max(0.0),
        turret_interior_m3: turret_in_vol.max(0.0),
        interior_m3: interior_vol,
        modules_m3: module_vol,
        crew_m3: crew_vol,
        free_m3: interior_vol - module_vol - crew_vol,
    };

    // ---------------------------------------------------------------- running gear
    let gear = &m.gear;
    let mut clash = 0;
    let env = gear.envelope;
    for side in [1.0, -1.0] {
        for i in 0..5 {
            for j in 0..4 {
                for k in 0..12 {
                    let p = v3(env.min.x + (env.max.x - env.min.x) * (i as f64 / 4.0), env.min.y + 0.02 + (env.max.y - env.min.y - 0.04) * (j as f64 / 3.0), env.min.z + (env.max.z - env.min.z) * (k as f64 / 11.0));
                    if m.hull.contains(v3(p.x * side, p.y, p.z)) {
                        clash += 1;
                    }
                }
            }
        }
    }
    // gap between the inner edge of the right track and the hull beside it, at axle height
    let inner_x = env.min.x;
    let probe_y = gear.stations.first().map(|w| w.y + w.r * 0.5).unwrap_or(0.5);
    let mut hull_x = f64::NEG_INFINITY;
    for k in 0..9 {
        let z = env.min.z + (env.max.z - env.min.z) * (0.1 + 0.8 * k as f64 / 8.0);
        for h in m.hull.ray_hits(v3(inner_x + 5.0, probe_y, z), v3(-1.0, 0.0, 0.0)) {
            if !h.front {
                continue;
            }
            hull_x = hull_x.max(h.point.x.min(inner_x + 0.5));
            break;
        }
    }
    let running_gear = GearReport {
        stations: gear.stations.iter().map(|w| [w.z, w.y, w.r]).collect(),
        sprocket: [gear.sprocket.z, gear.sprocket.y, gear.sprocket.r],
        idler: [gear.idler.z, gear.idler.y, gear.idler.r],
        rollers: gear.rollers.iter().map(|w| [w.z, w.y, w.r]).collect(),
        track_x_m: gear.track_x,
        track_width_m: gear.track_w,
        contact_length_m: gear.contact_length,
        loop_length_m: gear.loop_length,
        track_kg,
        envelope_min: env.min,
        envelope_max: env.max,
        hull_clash_points: clash,
        gap_to_hull_m: if hull_x.is_finite() { inner_x - hull_x } else { f64::INFINITY },
    };

    // ---------------------------------------------------------------- dimensions
    let mut overall = m.hull.bounds;
    if let Some(t) = &m.turret {
        overall.add(t.bounds.min);
        overall.add(t.bounds.max);
    }
    overall.add(v3(gear.track_x + gear.track_w * 0.5, 0.0, env.max.z));
    overall.add(v3(-(gear.track_x + gear.track_w * 0.5), 0.0, env.min.z));
    if let Some(g) = &gun {
        overall.add(g.trunnion_hull_m + v3(0.0, 0.0, m.gun.as_ref().unwrap().muzzle));
    }
    let dims = Dimensions {
        hull: Extent::of(&m.hull.bounds),
        turret: m.turret_local.as_ref().map(|t| Extent::of(&t.bounds)).unwrap_or_default(),
        overall_length_m: overall.size().z,
        overall_width_m: overall.size().x,
        overall_height_m: overall.max.y.max(0.0),
        ground_clearance_m: if m.hull.bounds.is_empty() { 0.0 } else { m.hull.bounds.min.y },
    };

    // ---------------------------------------------------------------- engine + physics
    let mut engine = EngineReport { kind: d.engine.kind.clone(), power_hp: d.engine.power_hp, ..Default::default() };
    if let Some(c) = m.engine_cat {
        engine.label = c.label.clone();
        engine.max_rpm = c.max_rpm;
        let (s, kg) = crate::layout::engine_box(c, d.engine.power_hp);
        engine.size_m = s;
        engine.mass_kg = kg;
    }
    engine.transmission_label = m.trans_cat.map(|c| c.label.clone()).unwrap_or_default();
    engine.steering_label = cat.steering.get(&d.transmission.steering).map(|c| c.label.clone()).unwrap_or_default();
    let ef = engine_file(d, cat, total.max(1000.0));
    if let Some(ef) = &ef {
        engine.torque_curve = ef.engine.torque_curve.clone();
        engine.gear_ratios = ef.transmission.gear_ratios.clone();
        engine.final_drive = ef.transmission.final_drive_ratio as f64;
    }

    let mut report = DesignReport {
        design_id: d.id.clone(),
        design_hash: design_hash(d),
        dimensions: dims,
        volumes,
        armor_faces,
        addons: addon_reports,
        inner: InnerShell { hull: hull_inner, turret: turret_inner },
        mass,
        center_of_mass: com,
        suspension: susp,
        mobility: MobilityReport::default(),
        turret,
        gun,
        ammunition: ammo,
        interior,
        running_gear,
        engine,
        issues: vec![],
        errors: 0,
        warnings: 0,
        battle_ready: false,
        compiled: None,
    };

    // physics parameters, the game-format vehicle, and the mobility runs on it
    let compiled = compile(&m, &report, ef.as_ref());
    if let Some(c) = &compiled {
        let ph = &c.vehicle.physics;
        let mob = &mut report.mobility;
        let tons = total / 1000.0;
        mob.power_to_weight_hp_t = if tons > 0.0 { d.engine.power_hp / tons } else { 0.0 };
        mob.ground_pressure_kpa = tg_physics::terra::ground_pressure(total as f32, ph.track_width_m, ph.track_length_m) as f64 / 1000.0;
        mob.max_turn_rate_deg_s = ph.max_turn_rate_deg_s as f64;
        mob.min_turn_radius_m = ph.min_turn_radius_m as f64;
        mob.neutral_steer = ph.min_turn_radius_m <= 0.0;
        mob.brake_decel_ms2 = ph.max_brake_decel_ms2 as f64;
        mob.stopping_distance_40_m = (40.0f64 / 3.6).powi(2) / (2.0 * mob.brake_decel_ms2.max(0.1));
        mob.length_to_gauge = gear.contact_length / (2.0 * gear.track_x).max(0.1);
        let lv = c.loaded();
        let params = tg_physics::VehicleParams::from_vehicle(&lv);
        mob.gearing_top_speed_kmh = params.v_top as f64 * 3.6;
        if mobility_sim {
            let (t32, road, dirt, mud, climb) = mobility_runs(&params, &db.terrains);
            mob.accel_0_32_s = t32;
            mob.top_speed_road_kmh = road;
            mob.top_speed_dirt_kmh = dirt;
            mob.top_speed_mud_kmh = mud;
            mob.max_climb_deg = climb;
        }
        // fuel: steady cruise on road and off road, from the engine's specific consumption
        if let Some(ec) = m.engine_cat {
            let fuel_l: f64 = m.boxes.iter().filter(|b| b.kind == BoxKind::Module(ModuleKindDef::FuelTank)).map(|b| b.size.x * b.size.y * b.size.z * cat.fuel.fill * 1000.0).sum();
            mob.fuel_l = fuel_l;
            let mc = &cat.mobility;
            let eff = m.trans_cat.map(|t| t.efficiency).unwrap_or(0.8);
            let cda = mc.air_cd * dims_cda(&report.dimensions);
            let per_100 = |v: f64, roll_k: f64| -> f64 {
                let p = (ph.rolling_resistance as f64 * roll_k * total * G + 0.5 * 1.225 * cda * v * v) * v / eff + d.engine.power_hp * 745.7 * 0.08;
                let kg_h = ec.sfc_g_kwh * p / 1000.0 / 1000.0;
                let l_h = kg_h / ec.fuel_density;
                l_h / (v * 3.6) * 100.0
            };
            let vroad = (params.v_top as f64 * mc.cruise_fraction).max(1.0);
            let voff = (params.v_top as f64 * mc.offroad_speed_fraction).max(1.0);
            mob.fuel_l_per_100km_road = per_100(vroad, mc.road_rolling);
            mob.fuel_l_per_100km_offroad = per_100(voff, mc.offroad_rolling);
            mob.range_road_km = fuel_l / mob.fuel_l_per_100km_road.max(1e-6) * 100.0;
            mob.range_offroad_km = fuel_l / mob.fuel_l_per_100km_offroad.max(1e-6) * 100.0;
        }
    }
    report.compiled = compiled;

    let ctx = Ctx { model: m, hull_inverted, turret_inverted };
    report.issues = validate(&ctx, &report);
    report.errors = report.issues.iter().filter(|i| i.severity == crate::validate::Severity::Error).count();
    report.warnings = report.issues.len() - report.errors;
    report.battle_ready = report.errors == 0 && report.compiled.is_some();
    report
}

fn dims_cda(d: &Dimensions) -> f64 {
    d.overall_width_m * (d.hull.height_m + 0.6 * d.turret.height_m)
}

/// Slab centre and its 8 corners for an add-on, in its body's space.
pub fn addon_box(a: &AddonDef) -> (V3, Vec<V3>) {
    let n = a.normal.norm();
    let u = (a.u_axis - n * a.u_axis.dot(n)).norm();
    let w = n.cross(u);
    let t = a.thickness_mm.max(0.0) * 0.001;
    let c = a.anchor_m + n * (a.standoff_mm.max(0.0) * 0.001 + t * 0.5);
    let (hu, hw, ht) = (a.size_m[0] * 0.5, a.size_m[1] * 0.5, t * 0.5);
    let mut corners = vec![];
    for k in 0..8 {
        let su = if k & 1 == 1 { hu } else { -hu };
        let sw = if k & 2 == 2 { hw } else { -hw };
        let st = if k & 4 == 4 { ht } else { -ht };
        corners.push(c + u * su + w * sw + n * st);
    }
    (c, corners)
}

/// Lookup of face reports by (body, face id).
pub fn face_report_map(r: &DesignReport) -> HashMap<(Body, u32), &ArmorFaceReport> {
    r.armor_faces.iter().map(|f| ((f.body, f.id), f)).collect()
}
