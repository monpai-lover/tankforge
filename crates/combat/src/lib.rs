//! Shots against a vehicle described by its data files (armor.json plates, modules.json,
//! crew.json): which plates the round meets and whether it gets through, what it does inside, and
//! what is left working afterwards. There are no hit points: a vehicle is its modules and its
//! crew, and it is out of the fight when its ammunition goes up or too few of the crew are left.
//!
//! What each kind of round does (all from the shell's own data):
//! - AP / APC / APCBC: the shell goes on through whatever is behind the plate (crew, modules, the
//!   far wall) and the plate's inner face throws a cone of spall.
//! - APHE: as above, and the filler bursts after the fuse delay (if the plate was thick enough to
//!   start the fuse): casing fragments all round, pushed forward by the shell's speed, and a blast
//!   that wounds whoever is close. A fuse that has not run out by the time the shell leaves the
//!   vehicle bursts outside (an over-penetration).
//! - APCR / APDS / APFSDS: only the light core gets through: a narrow cone of a few fragments.
//! - HEAT: the jet goes on for a limited length behind the plate, with a narrow spall cone.
//! - HE: bursts on the first thing it touches. Against armour no thicker than its explosive
//!   penetration the blast breaks in (fragments and overpressure inside); otherwise it wrecks
//!   what is outside within its radius: tracks, the barrel, and the crew of an open vehicle.
//! - HESH: the charge flattens on the plate and knocks a spall scab off the inner face if the plate
//!   is within its rating; otherwise it is an outside blast.
//! - Small-arms bullets: the same rules with their own penetration; no spall worth the name.
//!
//! Everything inside stops or slows fragments: each module soaks up some penetration (an engine
//! block a lot, a fuel tank little) and a fragment that is still going after it goes on with what
//! is left. Fragments stop at the armour from the inside.
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap};
use tg_armor::{ArmorPlate, ArmorZone, Material};
use tg_damage::module_state::{self, apply_health_damage, health_ratio};
pub use tg_damage::{Crew, CrewRole, Module, ModuleKind};
use tg_shared::{rotate_yaw, Rng, Vec3};
use tg_weapon::{ProjectileDef, ProjectileKind};
use tg_penetration::impact::{self, ImpactState, FragmentProvenance, ImpactEvent, EnergyBudget};
mod impact_report;
pub mod geometry;
pub mod surface_armor;
pub mod replay_evidence;
pub mod causes;
pub mod weapon_damage;
mod weapon_mg;
pub mod near_burst;

#[cfg(test)]
mod tests;

/// Seconds a crew member needs to take over an empty seat (gunner, driver, loader, commander).
pub const SWAP_S: f32 = 5.0;
/// How long a fire burns if nobody puts it out.
pub const FIRE_S: f32 = 25.0;
/// Field repairs: a base time and so much per fully broken module's worth of work.
pub const REPAIR_BASE_S: f32 = 6.0;
pub const REPAIR_PER_MODULE_S: f32 = 4.0;

// ------------------------------------------------------------------------- target

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TurretGeom {
    pub pivot: Vec3,
    pub size: Vec3,
}

/// Everything about a vehicle that a shot can meet, in hull space with the turret at yaw 0.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TargetDef {
    pub id: String,
    pub plates: Vec<ArmorPlate>,
    pub modules: Vec<Module>,
    pub crew: Vec<Crew>,
    #[serde(default)]
    pub turret: Option<TurretGeom>,
    #[serde(default)]
    pub open_top: bool,
    /// Rounds the main guns' racks hold in all (0: legacy unknown; authored zero racks stay empty).
    #[serde(default)]
    pub ammo_capacity: u32,
    /// Raw authored instance layout. Missing: retain the legacy vehicle-wide capabilities.
    #[serde(default)]
    pub weapons: serde_json::Value,
    /// Shared machine-gun catalogue array, including measured neutral damage geometry.
    /// Missing/null uses the same embedded catalogue for legacy adapters.
    #[serde(default)]
    pub machine_guns: serde_json::Value,
    /// Only mg_anchors/mg_variants are needed; callers should send a slim object.
    #[serde(default)]
    pub visual: serde_json::Value,
    /// Triangle-surface armour (surface_armor.rs): the drawn model's armour triangles, from the
    /// vehicle's trusted data. With it the plates are normally empty.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub surfaces: Option<surface_armor::SurfaceArmorDef>,
}

#[derive(Clone, Debug)]
pub struct Target {
    pub def: TargetDef,
    pub weapon_bindings: BTreeMap<String, weapon_damage::WeaponBinding>,
    pub binding_errors: BTreeMap<String, String>,
    materials: HashMap<String, Material>,
    turret_plate: Vec<bool>,
    turret_module: Vec<bool>,
    turret_crew: Vec<bool>,
    /// -1 left, +1 right, 0 not a track.
    pub track_side: Vec<i8>,
    pub lo: Vec3,
    pub hi: Vec3,
    /// The triangle-surface armour, when the definition carries it and it loaded.
    pub surf: Option<std::sync::Arc<surface_armor::SurfaceArmor>>,
    pub surface_error: Option<String>,
}

fn is_turret_zone(p: &ArmorPlate) -> bool {
    if p.hinge.is_some() { return false; } // current foldable walls are fixed to the hull
    matches!(p.zone, ArmorZone::TurretFront | ArmorZone::TurretSide | ArmorZone::TurretRear | ArmorZone::TurretRoof | ArmorZone::GunMantlet)
        || p.id.starts_with("turret")
        || p.id.starts_with("mantlet")
}

impl Target {
    pub fn new(mut def: TargetDef, materials: &[Material]) -> Target {
        let weapon_bindings = weapon_damage::register(&mut def);
        let binding_errors = weapon_bindings.iter().filter_map(|(key,b)| b.binding_error.clone().map(|e| (key.clone(),e))).collect();
        let materials: HashMap<String, Material> = materials.iter().map(|m| (m.id.clone(), m.clone())).collect();
        let inside_turret = |p: Vec3| -> bool {
            match &def.turret {
                Some(t) => {
                    let (dx, dz) = (p.x - t.pivot.x, p.z - t.pivot.z);
                    p.y > t.pivot.y - 0.12 && (dx * dx + dz * dz).sqrt() < t.size.x.max(t.size.z) * 0.55
                }
                None => false,
            }
        };
        let turret_plate = def.plates.iter().map(|p| def.turret.is_some() && is_turret_zone(p)).collect();
        let turret_module: Vec<bool> = def
            .modules
            .iter()
            .map(|m| {
                def.turret.is_some()
                    && match m.kind {
                        ModuleKind::MachineGun => m.turret_index.is_some(),
                        ModuleKind::GunBarrel | ModuleKind::GunBreech | ModuleKind::Launcher => true,
                        ModuleKind::VerticalDrive | ModuleKind::TurretDrive | ModuleKind::HorizontalDrive | ModuleKind::AmmoRack | ModuleKind::ApsGun | ModuleKind::ApsRadar => inside_turret(m.center),
                        _ => false,
                    }
            })
            .collect();
        let turret_crew = def.crew.iter().map(|c| matches!(c.role, CrewRole::Commander | CrewRole::Gunner | CrewRole::Loader) && inside_turret(c.pos)).collect();
        let track_side = def.modules.iter().map(|m| if m.kind == ModuleKind::Track { if m.center.x < 0.0 { -1 } else { 1 } } else { 0 }).collect();
        let (surf, surface_error) = match def.surfaces.as_ref().map(surface_armor::SurfaceArmor::new) {
            Some(Ok(a)) => (Some(std::sync::Arc::new(a)), None),
            Some(Err(e)) => (None, Some(e)),
            None => (None, None),
        };
        let mut pts: Vec<Vec3> = Vec::new();
        // the surfaces at every heading of the turret (eight steps cover its swept circle's box)
        if let Some(a) = &surf {
            let pivot = def.turret.as_ref().map(|t| t.pivot).unwrap_or(Vec3::ZERO);
            for k in 0..8 {
                pts.extend(a.corners(k as f32 * std::f32::consts::FRAC_PI_4, pivot));
            }
        }
        for p in &def.plates {
            let v = p.normal.cross(p.axis_u);
            for (a, b) in [(-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0)] {
                pts.push(p.center + p.axis_u * (a * p.half_u) + v * (b * p.half_v));
            }
        }
        for m in &def.modules {
            pts.push(m.center - m.half_extents);
            pts.push(m.center + m.half_extents);
        }
        // Rotating module corners sweep a circle about the parent pivot. Derive the
        // envelope from every box instead of assuming a fixed maximum barrel reach.
        if let Some(t) = &def.turret {
            for (m, &rotates) in def.modules.iter().zip(&turret_module) {
                if rotates {
                    let dx = (m.center.x - t.pivot.x).abs() + m.half_extents.x;
                    let dz = (m.center.z - t.pivot.z).abs() + m.half_extents.z;
                    let radius = dx.hypot(dz);
                    pts.push(Vec3::new(t.pivot.x - radius, m.center.y - m.half_extents.y, t.pivot.z - radius));
                    pts.push(Vec3::new(t.pivot.x + radius, m.center.y + m.half_extents.y, t.pivot.z + radius));
                }
            }
        }
        for c in &def.crew {
            pts.push(c.pos);
        }
        if pts.is_empty() {
            pts.push(Vec3::new(-2.0, 0.0, -3.0));
            pts.push(Vec3::new(2.0, 2.5, 3.0));
        }
        // the turret turns: its reach is the same all round
        if let Some(t) = &def.turret {
            let r = t.size.x.max(t.size.z) * 0.5 + 4.0;
            pts.push(Vec3::new(t.pivot.x - r, t.pivot.y, t.pivot.z - r));
            pts.push(Vec3::new(t.pivot.x + r, t.pivot.y + t.size.y + 0.5, t.pivot.z + r));
        }
        let mut lo = pts[0];
        let mut hi = pts[0];
        for p in &pts {
            lo = Vec3::new(lo.x.min(p.x), lo.y.min(p.y), lo.z.min(p.z));
            hi = Vec3::new(hi.x.max(p.x), hi.y.max(p.y), hi.z.max(p.z));
        }
        let pad = Vec3::new(0.3, 0.3, 0.3);
        Target { def, weapon_bindings, binding_errors, materials, turret_plate, turret_module, turret_crew, track_side, lo: lo - pad, hi: hi + pad, surf, surface_error }
    }

    // Target's authoring fields are public for existing construction adapters.
    // Recompute at the damage boundary so in-place edits cannot retain an old
    // scene's accepted anatomy. Never call this inside individual fragment loops.
    pub fn registration_hash(&self) -> String {
        fn engineering_numbers(v:&mut serde_json::Value) {
            match v {
                serde_json::Value::Array(a)=>for v in a {engineering_numbers(v)},
                serde_json::Value::Object(o)=>for v in o.values_mut(){engineering_numbers(v)},
                serde_json::Value::Number(n) if n.is_f64()=>{
                    let f=n.as_f64().expect("finite JSON number");
                    // Browser JSON loses the spelling distinction 8.0 versus 8.
                    // Only exact safe integers are canonicalized; do not round
                    // fractional values or collapse large native integer IDs.
                    if f.fract()==0. && f.abs()<=9_007_199_254_740_991. {*n=serde_json::Number::from(f as i64);}
                },
                _=>{}
            }
        }
        let mut identity=serde_json::to_value(&self.def).expect("registered target must serialize");
        identity.as_object_mut().unwrap().remove("id");
        let mut materials:Vec<_>=self.materials.values().collect();materials.sort_by(|a,b|a.id.cmp(&b.id));
        let mut record=serde_json::to_value((identity,materials,&self.weapon_bindings,&self.binding_errors,&self.track_side)).expect("registered anatomy must serialize");
        engineering_numbers(&mut record);
        geometry::manifest::sha256(&serde_json::to_vec(&record).expect("registered anatomy must serialize"))
    }

    pub fn fresh_state(&self) -> TargetState {
        let mut st = TargetState {
            modules: self.def.modules.iter().map(|m| m.max_health).collect(),
            crew: self.def.crew.iter().map(|_| 100.0).collect(),
            roles: self.def.crew.iter().map(|c| c.role).collect(),
            extinguishers: 1,
            ..Default::default()
        };
        clear_empty_racks(&self.def, &mut st);
        st
    }

    pub fn has_hinges(&self) -> bool {
        self.def.plates.iter().any(|p| p.hinge.is_some())
    }

    /// A view of the cached neutral target at the defender's current wall fold. Preserve
    /// module/crew ordering for existing damage state, and rebuild the broadphase bounds.
    pub fn folded(&self, fraction: f32) -> Target {
        let t = if fraction.is_finite() { fraction.clamp(0.0, 1.0) } else { 0.0 };
        if t == 0.0 || !self.has_hinges() { return self.clone(); }
        let mut def = self.def.clone();
        for p in &mut def.plates { *p = p.folded(t); }
        let materials: Vec<Material> = self.materials.values().cloned().collect();
        Target::new(def, &materials)
    }

    /// Hull-space contact envelope at the current main turret yaw and wall fold. This
    /// simple OBB proxy is separate from the cached all-rotation ray broadphase, and
    /// does not allocate or mutate the target. Extra turret and gun pitch sync are outside it.
    pub fn contact_bounds(&self, yaw: f32, fold: f32) -> (Vec3, Vec3) {
        let yaw = if yaw.is_finite() { yaw } else { 0.0 };
        let pivot = self.def.turret.as_ref().map(|t| t.pivot).unwrap_or(Vec3::ZERO);
        let turn = |p: Vec3| pivot + rotate_yaw(p - pivot, yaw);
        let mut lo = Vec3::new(f32::INFINITY, f32::INFINITY, f32::INFINITY);
        let mut hi = Vec3::new(f32::NEG_INFINITY, f32::NEG_INFINITY, f32::NEG_INFINITY);
        let mut add = |p: Vec3| {
            lo = Vec3::new(lo.x.min(p.x), lo.y.min(p.y), lo.z.min(p.z));
            hi = Vec3::new(hi.x.max(p.x), hi.y.max(p.y), hi.z.max(p.z));
        };
        for (p, &rotates) in self.def.plates.iter().zip(&self.turret_plate) {
            let (center, normal, u) = p.folded_geometry(fold);
            let v = normal.cross(u);
            for (a,b) in [(-1.0,-1.0),(1.0,-1.0),(1.0,1.0),(-1.0,1.0)] {
                let point = center + u * (a * p.half_u) + v * (b * p.half_v);
                add(if rotates { turn(point) } else { point });
            }
        }
        for (m, &rotates) in self.def.modules.iter().zip(&self.turret_module) {
            for x in [-1.0,1.0] { for y in [-1.0,1.0] { for z in [-1.0,1.0] {
                let point = m.center + Vec3::new(x*m.half_extents.x,y*m.half_extents.y,z*m.half_extents.z);
                add(if rotates { turn(point) } else { point });
            } } }
        }
        for (c,&rotates) in self.def.crew.iter().zip(&self.turret_crew) { add(if rotates { turn(c.pos) } else { c.pos }); }
        if let Some(a) = &self.surf { for p in a.corners(yaw, pivot) { add(p); } }
        if let Some(t) = &self.def.turret {
            for x in [-0.5,0.5] { for y in [0.0,1.0] { for z in [-0.5,0.5] {
                add(turn(t.pivot + Vec3::new(x*t.size.x,y*t.size.y,z*t.size.z)));
            } } }
        }
        if !lo.x.is_finite() { (Vec3::new(-2.0,0.0,-3.0),Vec3::new(2.0,2.5,3.0)) } else { (lo,hi) }
    }

    fn material(&self, id: &str) -> Material {
        self.materials.get(id).cloned().unwrap_or(Material {
            id: id.into(),
            kind: tg_armor::ArmorKind::Rha,
            density_kg_m3: 7850.0,
            hardness_bhn: 300.0,
            kinetic_factor: 1.0,
            chemical_factor: 1.0,
        })
    }

    /// Plates, module boxes and crew positions with the turret turned to `yaw` (radians).
    fn posed(&self, yaw: f32) -> Posed {
        let pivot = self.def.turret.as_ref().map(|t| t.pivot).unwrap_or(Vec3::ZERO);
        let turn = |p: Vec3| -> Vec3 {
            let r = rotate_yaw(Vec3::new(p.x - pivot.x, p.y, p.z - pivot.z), yaw);
            Vec3::new(r.x + pivot.x, r.y, r.z + pivot.z)
        };
        let plates = self
            .def
            .plates
            .iter()
            .zip(&self.turret_plate)
            .map(|(p, &t)| if t && yaw != 0.0 { ArmorPlate { center: turn(p.center), normal: rotate_yaw(p.normal, yaw), axis_u: rotate_yaw(p.axis_u, yaw), ..p.clone() } } else { p.clone() })
            .collect();
        let boxes = self
            .def
            .modules
            .iter()
            .zip(&self.turret_module)
            .map(|(m, &t)| {
                ModuleBox { center: if t { turn(m.center) } else { m.center }, half_extents: m.half_extents, yaw: if t { yaw } else { 0.0 } }
            })
            .collect();
        let crew = self.def.crew.iter().zip(&self.turret_crew).map(|(c, &t)| if t && yaw != 0.0 { turn(c.pos) } else { c.pos }).collect();
        Posed { plates, boxes, crew, yaw, pivot }
    }
}

struct Posed {
    plates: Vec<ArmorPlate>,
    boxes: Vec<ModuleBox>,
    crew: Vec<Vec3>,
    yaw:f32,
    pivot:Vec3,
}

/// Exact local module box; the target's cached bounds remain the conservative broadphase.
#[derive(Clone, Copy)]
struct ModuleBox {
    center: Vec3,
    half_extents: Vec3,
    yaw: f32,
}

impl ModuleBox {
    fn local_point(self, p: Vec3) -> Vec3 {
        rotate_yaw(p - self.center, -self.yaw)
    }

    fn intersect(self, origin: Vec3, dir: Vec3) -> Option<(f32, f32)> {
        ray_box(self.local_point(origin), rotate_yaw(dir, -self.yaw), Vec3::ZERO, self.half_extents)
    }

    fn contains(self, p: Vec3) -> bool {
        let p = self.local_point(p);
        let h = self.half_extents;
        p.x.abs() <= h.x && p.y.abs() <= h.y && p.z.abs() <= h.z
    }

    fn distance(self, p: Vec3) -> f32 {
        let p = self.local_point(p);
        let h = self.half_extents;
        Vec3::new((p.x.abs() - h.x).max(0.0), (p.y.abs() - h.y).max(0.0), (p.z.abs() - h.z).max(0.0)).length()
    }
}

// -------------------------------------------------------------------------- state

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Swap {
    pub crew: usize,
    pub role: CrewRole,
    pub left_s: f32,
}

/// What is left of one vehicle: module and crew health, who sits where, fire, repairs.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TargetState {
    #[serde(default)] pub active_fire_cause: Option<causes::ActiveCause>,
    pub modules: Vec<f32>,
    pub crew: Vec<f32>,
    /// The seat each crew member is in now (the gunner's seat taken over by the loader, ...).
    pub roles: Vec<CrewRole>,
    #[serde(default)]
    pub swaps: Vec<Swap>,
    #[serde(default)]
    pub fire_s: f32,
    #[serde(default)]
    pub fire_at: Option<Vec3>,
    #[serde(default)]
    pub ammo_detonated: bool,
    #[serde(default)]
    pub destroyed: bool,
    #[serde(default)]
    pub repair_s: f32,
    /// Fixed selection for this repair. None preserves old states' completion behavior.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repair_targets: Option<Vec<usize>>,
    #[serde(default)]
    pub extinguishers: u32,
    /// How full each ammo rack is (0..1 by module index); missing: full except authored zero racks.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rack_fill: Vec<f32>,
}

impl TargetState {
    fn alive(&self, i: usize) -> bool {
        self.crew.get(i).map(|h| *h > 0.0).unwrap_or(false)
    }

    /// Share of its rounds module `i` holds (1 for anything that is not an ammo rack).
    pub fn rack(&self, i: usize) -> f32 {
        self.rack_fill.get(i).copied().unwrap_or(1.0)
    }
}

/// An ammo rack with no rounds in it: an empty frame, nothing to hit and nothing to set off.
fn empty_rack(t: &Target, st: &TargetState, i: usize) -> bool {
    t.def.modules.get(i).is_some_and(|m| m.kind == ModuleKind::AmmoRack && (m.rounds == Some(0) || st.rack(i) <= 0.0))
}

/// Explicit zero rounds override even an old/missing or stale full-rack state.
fn clear_empty_racks(def: &TargetDef, st: &mut TargetState) {
    for (i, m) in def.modules.iter().enumerate() {
        if m.kind == ModuleKind::AmmoRack && m.rounds == Some(0) {
            if i >= st.rack_fill.len() { st.rack_fill.resize(def.modules.len(), 1.0); }
            st.rack_fill[i] = 0.0;
        }
    }
}

/// How full each ammo rack is (0..1 by module index, 1 for every other module) when the vehicle
/// carries `carried` of its `capacity` rounds. The racks are filled from the bottom up: the floor
/// and lower hull racks hold the last rounds, the turret, sponson and upper racks are the ones a
/// short load leaves empty (War Thunder's rack order). A rack's size is its own `rounds` when the
/// model gives it, its share of the rack volume otherwise.
pub fn rack_fill(def: &TargetDef, carried: u32, capacity: u32) -> Vec<f32> {
    let mut fill = vec![1.0; def.modules.len()];
    let mut racks: Vec<usize> = (0..def.modules.len()).filter(|&i| {
        let m = &def.modules[i];
        if m.kind == ModuleKind::AmmoRack && m.rounds == Some(0) { fill[i] = 0.0; }
        m.kind == ModuleKind::AmmoRack && m.rounds != Some(0)
    }).collect();
    if capacity == 0 || racks.is_empty() || carried >= capacity {
        return fill;
    }
    let size = |i: usize| -> f32 {
        let m = &def.modules[i];
        match m.rounds {
            Some(r) => r as f32,
            None => (m.half_extents.x * m.half_extents.y * m.half_extents.z).max(1e-4) * 1000.0,
        }
    };
    let total: f32 = racks.iter().map(|i| size(*i)).sum();
    let mut hold = total * carried as f32 / capacity as f32;
    racks.sort_by(|a, b| def.modules[*a].center.y.partial_cmp(&def.modules[*b].center.y).unwrap_or(std::cmp::Ordering::Equal).then(a.cmp(b)));
    for i in racks {
        let s = size(i);
        let f = if hold <= 1e-6 { 0.0 } else { (hold / s).min(1.0) };
        hold -= s * f;
        fill[i] = f;
    }
    fill
}

/// Rounds every main gun's racks hold together, from a vehicle's weapons.json (as the client's
/// loadout counts them: `ammo_count` per type, 40 of a type without one).
pub fn ammo_capacity(weapons: &serde_json::Value) -> u32 {
    let gun = |g: &serde_json::Value| -> u32 {
        let types = g["ammo"].as_array().map(|a| a.len()).unwrap_or(0).max(1);
        (0..types).map(|i| g["ammo_count"][i].as_u64().unwrap_or(40) as u32).sum()
    };
    let mut n = if weapons["main_gun"].is_object() { gun(&weapons["main_gun"]) } else { 0 };
    for g in weapons["extra_guns"].as_array().into_iter().flatten() {
        n += gun(&g["gun"]);
    }
    for t in weapons["extra_turrets"].as_array().into_iter().flatten() {
        for g in t["guns"].as_array().into_iter().flatten() {
            n += gun(&g["gun"]);
        }
    }
    n
}

/// The vehicle now carries `carried` rounds. Unknown capacity preserves legacy rack fills;
/// authored zero racks remain empty regardless of capacity or the previous state.
pub fn load_ammo(t: &Target, st: &mut TargetState, carried: u32) {
    if t.def.ammo_capacity > 0 {
        st.rack_fill = rack_fill(&t.def, carried, t.def.ammo_capacity);
    }
    clear_empty_racks(&t.def, st);
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Caps {
    pub can_move: bool,
    /// Engine output alone; driving also includes the transmission factor.
    pub engine_power: f32,
    #[serde(default = "full_factor")]
    pub drive_power: f32,
    pub track_left: bool,
    pub track_right: bool,
    pub can_fire: bool,
    #[serde(default)]
    pub weapons: BTreeMap<String, weapon_damage::WeaponCaps>,
    pub traverse_mult: f32,
    pub elevate_mult: f32,
    pub reload_mult: f32,
    pub driver: bool,
    pub gunner: bool,
    pub loader: bool,
    pub commander: bool,
    pub on_fire: bool,
    pub ammo_detonated: bool,
    pub destroyed: bool,
    pub crew_alive: u32,
    pub crew_total: u32,
    pub repair_s: f32,
}

fn full_factor() -> f32 { 1.0 }

fn module_ok(t: &Target, st: &TargetState, kind: ModuleKind) -> bool {
    t.def.modules.iter().enumerate().filter(|(_, m)| m.kind == kind).all(|(i, _)| st.modules.get(i).copied().unwrap_or(1.0) > 0.0)
}

/// One whole launcher instance must work; shared by capability and server launch checks.
pub fn launcher_groups_operational(t: &Target, st: &TargetState) -> bool {
    tg_damage::launcher_groups_operational(&t.def.modules, |i, m| st.modules.get(i).copied().unwrap_or(m.max_health) > 0.0)
}

fn seat_filled(t: &Target, st: &TargetState, role: CrewRole) -> bool {
    if !t.def.crew.iter().any(|c| c.role == role || c.also.contains(&role)) {
        return true; // the vehicle never had that seat
    }
    // a duty one crew member also carries (the gunner-commander) is done while they live
    st.roles.iter().enumerate().any(|(i, r)| (*r == role || t.def.crew.get(i).is_some_and(|c| c.also.contains(&role))) && st.alive(i))
}

pub fn caps(t: &Target, st: &TargetState) -> Caps {
    let factor = |kinds: &[ModuleKind], curve: fn(f32) -> f32| {
        t.def.modules.iter().enumerate().filter(|(_, m)| kinds.contains(&m.kind))
            .map(|(i, m)| curve(health_ratio(st.modules.get(i).copied().unwrap_or(m.max_health), m.max_health)))
            .fold(1.0f32, f32::min)
    };
    let engine_power = factor(&[ModuleKind::Engine], module_state::engine_power_factor);
    let drive_power = engine_power * factor(&[ModuleKind::Transmission], module_state::transmission_factor);
    let side_ok = |side: i8| t.track_side.iter().enumerate().filter(|(_, s)| **s == side).all(|(i, _)| st.modules.get(i).copied().unwrap_or(1.0) > 0.0);
    let driver = seat_filled(t, st, CrewRole::Driver);
    let gunner = seat_filled(t, st, CrewRole::Gunner);
    let loader = seat_filled(t, st, CrewRole::Loader);
    let commander = seat_filled(t, st, CrewRole::Commander);
    let working = !st.destroyed && st.repair_s <= 0.0;
    let crew_alive = st.crew.iter().filter(|h| **h > 0.0).count() as u32;
    let weapons = weapon_damage::capabilities(t, st, gunner, loader);
    Caps {
        can_move: working && driver && drive_power > 0.0,
        engine_power,
        drive_power,
        track_left: side_ok(-1),
        track_right: side_ok(1),
        can_fire: if weapons.is_empty() { working && gunner && module_ok(t, st, ModuleKind::GunBreech) && module_ok(t, st, ModuleKind::GunBarrel)
            && (t.def.modules.iter().any(|m| matches!(m.kind, ModuleKind::GunBreech | ModuleKind::GunBarrel)) || launcher_groups_operational(t, st)) }
            else { weapons.values().any(|w| w.can_fire) },
        weapons,
        traverse_mult: factor(&[ModuleKind::TurretDrive, ModuleKind::HorizontalDrive], module_state::traverse_factor),
        elevate_mult: factor(&[ModuleKind::VerticalDrive], module_state::elevation_factor),
        reload_mult: if loader { 1.0 } else { 1.6 },
        driver,
        gunner,
        loader,
        commander,
        on_fire: st.fire_s > 0.0,
        ammo_detonated: st.ammo_detonated,
        destroyed: st.destroyed,
        crew_alive,
        crew_total: st.crew.len() as u32,
        repair_s: st.repair_s,
    }
}

/// Out of the fight: the ammunition has gone up, or fewer than two of the crew are left.
fn check_destroyed(st: &mut TargetState) -> bool {
    let alive = st.crew.iter().filter(|h| **h > 0.0).count();
    let total = st.crew.len();
    if st.destroyed || st.ammo_detonated || (total >= 2 && alive < 2) || (total > 0 && alive == 0) {
        st.destroyed = true;
        st.fire_s = st.fire_s.max(if st.ammo_detonated { 60.0 } else { 0.0 });
        st.repair_s = 0.0;
        st.repair_targets = None;
        st.swaps.clear();
    }
    st.destroyed
}

/// Empty key seats are taken over by someone from a less important one.
fn plan_swaps(t: &Target, st: &mut TargetState) {
    if st.destroyed {
        return;
    }
    let order = [CrewRole::Gunner, CrewRole::Driver, CrewRole::Loader, CrewRole::Commander];
    for (rank, role) in order.iter().enumerate() {
        if seat_filled(t, st, *role) || st.swaps.iter().any(|s| s.role == *role) {
            continue;
        }
        // a donor: alive, not already moving, in a seat that matters less
        let donor = (0..st.crew.len()).filter(|&i| st.alive(i) && !st.swaps.iter().any(|s| s.crew == i)).min_by_key(|&i| {
            let r = st.roles[i];
            let held = order.iter().position(|o| *o == r).unwrap_or(order.len());
            // radio operators first, then whoever holds the least important of the key seats
            if r == CrewRole::RadioOperator {
                0
            } else if held > rank {
                10 - held as i32
            } else {
                100
            }
        });
        if let Some(i) = donor {
            let r = st.roles[i];
            let held = order.iter().position(|o| *o == r).unwrap_or(order.len());
            if r == CrewRole::RadioOperator || held > rank {
                st.swaps.push(Swap { crew: i, role: *role, left_s: SWAP_S });
            }
        }
    }
}

/// Time passing for a vehicle: fire, crew changing seats, repairs. Returns what happened.
pub fn advance(t: &Target, st: &mut TargetState, dt: f32, seed: u64) -> Vec<String> {
    let mut out = Vec::new();
    if st.destroyed || st.crew.iter().filter(|h| **h > 0.0).count() < 2 {
        st.repair_s = 0.0;
        st.repair_targets = None;
    }
    if st.fire_s > 0.0 {
        st.fire_s = (st.fire_s - dt).max(0.0);
        if !st.destroyed {
            if let Some(at) = st.fire_at {
                for (i, c) in t.def.crew.iter().enumerate() {
                    if st.alive(i) && (c.pos - at).length() < 1.8 {
                        apply_health_damage(&mut st.crew[i], 100.0, 3.0 * dt);
                        if st.crew[i] <= 0.0 {
                            out.push(format!("crew_burned:{}", c.role.as_str()));
                        }
                    }
                }
                let mut rng = Rng::new(seed);
                for (i, m) in t.def.modules.iter().enumerate() {
                    if (m.center - at).length() < 1.6 && st.modules[i] > 0.0 && !empty_rack(t, st, i) {
                        apply_health_damage(&mut st.modules[i], m.max_health, 2.0 * dt);
                        if m.kind == ModuleKind::AmmoRack && rng.next_f32() < 0.03 * dt * (0.4 + 0.6 * st.rack(i)) {
                            st.ammo_detonated = true;
                            out.push("ammo_detonation".into());
                        }
                    }
                }
            }
            if check_destroyed(st) {
                out.push("destroyed".into());
            }
        }
        if st.fire_s <= 0.0 {
            st.fire_at = None;
            st.active_fire_cause=None;
            out.push("fire_out".into());
        }
    }
    if st.destroyed {
        return out;
    }
    for s in &mut st.swaps {
        s.left_s -= dt;
    }
    let done: Vec<Swap> = st.swaps.iter().filter(|s| s.left_s <= 0.0).cloned().collect();
    st.swaps.retain(|s| s.left_s > 0.0);
    for s in done {
        if st.alive(s.crew) {
            st.roles[s.crew] = s.role;
            out.push(format!("seat:{}", s.role.as_str()));
        }
    }
    // a crew member who died on the way leaves the seat empty: find someone else
    plan_swaps(t, st);
    if st.repair_s > 0.0 {
        st.repair_s = (st.repair_s - dt).max(0.0);
        if st.repair_s <= 0.0 {
            let targets = st.repair_targets.take();
            for (i, m) in t.def.modules.iter().enumerate() {
                if targets.as_ref().map_or(true, |indices| indices.contains(&i)) && repairable(m.kind) && st.modules[i] < m.max_health * 0.6 {
                    st.modules[i] = m.max_health * 0.6;
                }
            }
            out.push("repaired".into());
        }
    }
    out
}

/// Actual timed core mutation, retaining the initiating mechanism even when this tick ends it.
pub fn advance_context(t:&Target,st:&mut TargetState,dt:f32,seed:u64,event_id:&str)->causes::AdvanceResult {
    let source=st.active_fire_cause.clone();let was=st.destroyed;
    let events=advance(t,st,dt,seed);let mut transitions=Vec::new();
    let death_cause=if !was&&st.destroyed {source.clone()} else {None};
    if let Some(c)=death_cause.as_ref() {transitions.push(causes::CauseTransition::Death{death_event_id:event_id.into(),mechanism_id:c.mechanism_id.clone(),cause_event_id:c.source_event_id.clone()});}
    if source.is_some()&&st.active_fire_cause.is_none() {transitions.push(causes::CauseTransition::Ended{mechanism_id:source.unwrap().mechanism_id});}
    causes::AdvanceResult{events,transitions,death_cause}
}

fn repairable(k: ModuleKind) -> bool {
    !matches!(k, ModuleKind::AmmoRack)
}

/// Fix the repair's targets below 60% health and duration; new damage never adds work mid-repair.
pub fn start_repair(t: &Target, st: &mut TargetState) -> bool {
    if st.destroyed || st.repair_s > 0.0 {
        return false;
    }
    let targets: Vec<usize> = t.def.modules.iter().enumerate()
        .filter(|(i, m)| repairable(m.kind) && m.max_health > 0.0 && st.modules[*i] < m.max_health * 0.6)
        .map(|(i, _)| i).collect();
    let alive = st.crew.iter().filter(|h| **h > 0.0).count();
    if targets.is_empty() || alive < 2 {
        return false;
    }
    let missing = st.crew.len() - alive;
    let work: f32 = targets.iter().map(|&i| (0.6 - health_ratio(st.modules[i], t.def.modules[i].max_health)) / 0.6).sum();
    st.repair_s = REPAIR_BASE_S + REPAIR_PER_MODULE_S * work + 2.0 * missing as f32;
    st.repair_targets = Some(targets);
    true
}

/// Puts the fire out with the extinguisher, if there is one left.
pub fn extinguish(st: &mut TargetState) -> bool {
    if st.fire_s <= 0.0 || st.extinguishers == 0 || st.destroyed {
        return false;
    }
    st.extinguishers -= 1;
    st.fire_s = st.fire_s.min(1.5);
    true
}

// ----------------------------------------------------------------------- shooting

#[derive(Clone, Debug, Deserialize)]
pub struct Shot {
    pub shell: ProjectileDef,
    /// A point on the flight line short of the vehicle, and the direction of flight (hull space).
    pub origin: Vec3,
    pub dir: Vec3,
    pub speed_ms: f32,
    pub distance_m: f32,
    #[serde(deserialize_with="replay_seed")]
    pub seed: u64,
    /// Turret yaw against the hull, radians.
    #[serde(default)]
    pub turret_yaw: f32,
}

/// JSON decimal strings preserve all u64 seed bits; numeric legacy inputs remain compatible.
fn replay_seed<'de,D:serde::Deserializer<'de>>(d:D)->Result<u64,D::Error> {
    let v=serde_json::Value::deserialize(d)?;
    match v {serde_json::Value::String(s) if !s.starts_with('+')=>s.parse().map_err(serde::de::Error::custom),serde_json::Value::Number(n)=>n.as_u64().ok_or_else(||serde::de::Error::custom("invalid u64 seed")),_=>Err(serde::de::Error::custom("invalid u64 seed"))}
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Miss,
    Ricochet,
    Shattered,
    Stopped,
    Penetrated,
    /// An explosive round broke in through thin armour.
    Overpressure,
    /// An explosive round burst outside without getting in.
    Blast,
    /// Hit the running gear or the barrel, nothing else.
    External,
    /// Went in (open top, gaps) without having to beat any armour.
    Unarmoured,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Layer {
    pub plate: String,
    pub zone: ArmorZone,
    pub material: String,
    pub thickness_mm: f32,
    pub angle_deg: f32,
    pub los_mm: f32,
    pub required_mm: f32,
    pub pen_before_mm: f32,
    pub pen_after_mm: f32,
    pub passed: bool,
    pub point: Vec3,
    pub entering: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Burst {
    pub pos: Vec3,
    pub radius: f32,
    pub inside: bool,
    pub explosive_kg: f32,
    /// Report-local physical time, using the same clock as ImpactEvent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_s: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub armed_at_s: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delay_s: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detonation_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mechanism: Option<String>,
}

#[derive(Clone, Debug)]
struct DelayedFuse {
    armed_at_s: f64,
    time_s: f64,
    delay_s: f64,
    detonation_id: String,
}
fn arm_aphe_fuse(fuse: &mut Option<DelayedFuse>, state: &mut ImpactState,
    shell: &ProjectileDef, time_s: f64) {
    if fuse.is_some() || state.fuse != impact::FuseState::Unarmed
        || !time_s.is_finite() || !shell.fuse_delay_s.is_finite() || shell.fuse_delay_s < 0.0
        || state.integrity <= 0.0 { return; }
    let Some(charge) = state.charge.as_ref().filter(|c|
        c.disposition == impact::ChargeDisposition::Contained) else { return; };
    let delay_s = shell.fuse_delay_s as f64;
    *fuse = Some(DelayedFuse { armed_at_s: time_s, time_s: time_s+delay_s,
        delay_s, detonation_id: format!("{}/detonation:0", charge.charge_id) });
    state.fuse = impact::FuseState::Armed;
}
fn fail_aphe_fuse(fuse: &mut Option<DelayedFuse>, state: &mut ImpactState) {
    *fuse = None;
    state.fuse = impact::FuseState::Failed;
    if let Some(charge) = state.charge.as_mut() {
        charge.disposition = impact::ChargeDisposition::Failed;
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Frag {
    pub from: Vec3,
    pub to: Vec3,
    pub hit: Option<String>,
    pub damage: f32,
    /// "spall" | "burst" | "jet" | "shell" | "blast"
    pub kind: String,
    #[serde(default,flatten)] pub provenance: FragmentProvenance,
    #[serde(default)] pub budget: Option<EnergyBudget>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ModuleHit {
    pub index: usize,
    pub id: String,
    pub kind: ModuleKind,
    pub damage: f32,
    pub health: f32,
    pub max_health: f32,
    pub destroyed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct CrewHit {
    pub index: usize,
    pub role: CrewRole,
    pub damage: f32,
    pub health: f32,
    pub killed: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Report {
    #[serde(default)] pub geometry_contacts: Vec<serde_json::Value>,
    #[serde(default)] pub primary_geometry_contacts: Vec<serde_json::Value>,
    #[serde(default)] pub primary_module_destructions: Vec<serde_json::Value>,
    #[serde(default)] pub cause_transitions: Vec<causes::CauseTransition>,
    pub hit: bool,
    pub outcome: Outcome,
    pub shell_kind: ProjectileKind,
    pub caliber_mm: f32,
    pub impact: Option<Vec3>,
    pub normal: Option<Vec3>,
    pub plate: Option<String>,
    pub angle_deg: f32,
    pub pen_mm: f32,
    pub layers: Vec<Layer>,
    /// The round (or the jet) through the vehicle: impact first.
    pub path: Vec<Vec3>,
    pub ricochet_dir: Option<Vec3>,
    pub bursts: Vec<Burst>,
    pub fragments: Vec<Frag>,
    pub modules: Vec<ModuleHit>,
    pub crew: Vec<CrewHit>,
    pub events: Vec<String>,
    pub caps: Caps,
    pub state: TargetState,
    pub title: String,
    pub turret_yaw: f32,
    #[serde(default)] pub mechanism_revision: Option<String>,
    #[serde(default)] pub impact_events: Vec<ImpactEvent>,
    #[serde(default)] pub impact_state: Option<ImpactState>,
}

// damage of something moving with `energy_j` to a person and to a machine
fn crew_damage(energy_j: f32) -> f32 {
    (25.0 * (energy_j.max(0.0) / 1000.0).sqrt()).min(300.0)
}
fn module_damage(energy_j: f32) -> f32 {
    (7.0 * (energy_j.max(0.0) / 1000.0).powf(0.6)).min(400.0)
}
/// Penetration (mm) of a fragment of `energy_j`.
fn frag_pen(energy_j: f32) -> f32 {
    3.5 * (energy_j.max(0.0) / 1000.0).sqrt()
}
/// What a module soaks up of a round's or a fragment's penetration (mm of steel).
fn absorb_mm(kind: ModuleKind) -> f32 {
    match kind {
        ModuleKind::Engine => 30.0,
        ModuleKind::Transmission => 25.0,
        ModuleKind::GunBreech => 45.0,
        ModuleKind::GunBarrel => 25.0,
        ModuleKind::Launcher => 8.0,
        ModuleKind::MachineGun => 8.0,
        ModuleKind::Track => 20.0,
        ModuleKind::AmmoRack => 10.0,
        ModuleKind::FuelTank => 6.0,
        ModuleKind::TurretDrive | ModuleKind::HorizontalDrive | ModuleKind::VerticalDrive => 8.0,
        ModuleKind::Radio => 3.0,
        ModuleKind::ApsGun => 15.0,
        ModuleKind::ApsRadar => 4.0,
    }
}
const CREW_ABSORB_MM: f32 = 5.0;

/// Explosive penetration of an HE filler of `kg` (fits 75 mm ~10 mm, 122 mm ~31 mm, 152 mm ~44 mm).
pub fn he_pen_mm(kg: f32) -> f32 {
    13.1 * kg.max(0.0).powf(0.673)
}
/// Radius (m) inside which the blast of `kg` of filler wounds or kills inside a compartment.
pub fn blast_radius_m(kg: f32) -> f32 {
    3.6 * kg.max(0.0).cbrt()
}
/// Radius (m) of an outside burst that wrecks tracks and barrels.
pub fn outside_radius_m(kg: f32) -> f32 {
    1.6 * kg.max(0.0).cbrt() + 0.5
}

fn gauss(rng: &mut Rng) -> f32 {
    let u1 = rng.next_f32().max(1e-6);
    let u2 = rng.next_f32();
    (-2.0 * u1.ln()).sqrt() * (std::f32::consts::TAU * u2).cos()
}

fn random_unit(rng: &mut Rng) -> Vec3 {
    let z = rng.next_f32() * 2.0 - 1.0;
    let a = rng.next_f32() * std::f32::consts::TAU;
    let r = (1.0 - z * z).max(0.0).sqrt();
    Vec3::new(r * a.cos(), z, r * a.sin())
}

fn cone_dir(d: Vec3, half_angle_deg: f32, rng: &mut Rng) -> Vec3 {
    let u = d.any_perpendicular();
    let v = d.cross(u);
    let a = rng.next_f32().sqrt() * half_angle_deg.to_radians();
    let az = rng.next_f32() * std::f32::consts::TAU;
    (d * a.cos() + (u * az.cos() + v * az.sin()) * a.sin()).normalized()
}

fn ray_box(o: Vec3, d: Vec3, c: Vec3, h: Vec3) -> Option<(f32, f32)> {
    let (o, d, c, h) = (o.to_array(), d.to_array(), c.to_array(), h.to_array());
    let (mut t0, mut t1) = (f32::MIN, f32::MAX);
    for i in 0..3 {
        let (lo, hi) = (c[i] - h[i], c[i] + h[i]);
        if d[i].abs() < 1e-9 {
            if o[i] < lo || o[i] > hi {
                return None;
            }
        } else {
            let (mut a, mut b) = ((lo - o[i]) / d[i], (hi - o[i]) / d[i]);
            if a > b {
                std::mem::swap(&mut a, &mut b);
            }
            t0 = t0.max(a);
            t1 = t1.min(b);
            if t0 > t1 {
                return None;
            }
        }
    }
    if t1 < 0.0 {
        None
    } else {
        Some((t0.max(0.0), t1))
    }
}

fn ray_sphere(o: Vec3, d: Vec3, c: Vec3, r: f32) -> Option<f32> {
    let oc = o - c;
    let b = oc.dot(d);
    let disc = b * b - (oc.dot(oc) - r * r);
    if disc < 0.0 {
        return None;
    }
    let s = disc.sqrt();
    let t = if -b - s >= 0.0 { -b - s } else { -b + s };
    if t >= 0.0 {
        Some(t)
    } else {
        None
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum EvKind {
    Plate(usize),
    Module(usize),
    Crew(usize),
    Decoration,
    Unknown,
}

/// One thing in a shot's or a fragment's way.
#[derive(Clone, Debug)]
struct Ev {
    t: f32,
    kind: EvKind,
    contact: Option<geometry::surface::SurfaceCrossingV1>,
    paired_contact: Option<geometry::surface::SurfaceCrossingV1>,
    surface_transit: Option<SurfaceTransit>,
}

/// A registered material interval, distinct from any constructor triangle.
#[derive(Clone, Copy, Debug)]
struct SurfaceTransit {
    id: u32,
    deferred: bool,
    is_exit: bool,
}

enum DeferredSurfaceSpall {
    Kinetic(impact::ImpactTransition),
    Legacy { pen: f32, energy: f32 },
}

/// The work of one shot: the target, its state, and everything recorded along the way.
struct Work<'a> {
    scene: Option<&'a geometry::combat_scene::CombatScene>,
    context: Option<&'a causes::DamageContext>,
    t: &'a Target,
    p: Posed,
    st: TargetState,
    rng: Rng,
    explosive_re_factor: f32,
    rep: Report,
    mod_dmg: HashMap<usize, f32>,
    crew_dmg: HashMap<usize, f32>,
    newly_destroyed: Vec<usize>,
    newly_killed: Vec<usize>,
}

impl<'a> Work<'a> {
    fn kinetic_surface_spall(&mut self, inner:Vec3, dir:Vec3, shell:&ProjectileDef, tr:&impact::ImpactTransition) {
        let params=match shell.kind {
            ProjectileKind::Apcr | ProjectileKind::Apds => tg_damage::DamageParams {
                base_frag_count:2,frags_per_residual_mm:0.05,max_frags:10,cone_half_angle_deg:11.,..Default::default()
            },
            ProjectileKind::Apfsds => tg_damage::DamageParams {
                base_frag_count:3,frags_per_residual_mm:0.05,max_frags:12,cone_half_angle_deg:10.,..Default::default()
            },
            _ => tg_damage::DamageParams {
                base_frag_count:(4.+shell.caliber_mm*0.04)as u32,frags_per_residual_mm:0.12,
                max_frags:36,cone_half_angle_deg:22.,..Default::default()
            },
        };
        for fragment in tg_damage::generate_allocated_fragments(inner,dir,None,tr,&params,&mut self.rng) {
            self.kinetic_fragment(&fragment,4.);
        }
    }
    fn contact_receipt(contact:&geometry::surface::SurfaceCrossingV1)->serde_json::Value {
        let mut receipt=serde_json::to_value(contact).unwrap();
        receipt["schema"]=serde_json::json!("SurfaceContactReceiptV1");
        let keys:Vec<_>=receipt.as_object().unwrap().iter().filter_map(|(k,v)|v.as_str().filter(|s|s.len()>256)
            .map(|s|(k.clone(),geometry::manifest::sha256(s.as_bytes())))).collect();
        for(key,hash)in keys{receipt.as_object_mut().unwrap().remove(&key);receipt[format!("{key}Hash")]=serde_json::json!(hash);}
        receipt
    }
    fn record_primary_contact(&mut self,ev:&Ev){
        self.record_contact(ev);
        for contact in [ev.contact.as_ref(),ev.paired_contact.as_ref()].into_iter().flatten(){
            if self.rep.primary_geometry_contacts.len()>=256{break;}
            self.rep.primary_geometry_contacts.push(Self::contact_receipt(contact));
        }
    }
    fn record_primary_destruction(&mut self,i:usize,before:f32,ev:&Ev){
        if before>0.&&self.st.modules[i]==0.&&self.rep.primary_module_destructions.len()<256{
            if let Some(contact)=&ev.contact {
                self.rep.primary_module_destructions.push(serde_json::json!({"schema":"PrimaryModuleDestructionV1",
                    "moduleRef":self.t.def.modules[i].id,"beforeHealth":before,"afterHealth":0,
                    "contact":Self::contact_receipt(contact)}));
            }
        }
    }
    fn record_contact(&mut self,ev:&Ev) {
        for contact in [ev.contact.as_ref(),ev.paired_contact.as_ref()].into_iter().flatten() {
            if self.rep.geometry_contacts.len()>=256 {break;}
            self.rep.geometry_contacts.push(Self::contact_receipt(contact));
        }
    }
    fn kinetic_fragment(&mut self, f: &tg_damage::Fragment, max_range: f32) {
        let (Some(physical), Some(profile)) = (&f.provenance.physical, &f.provenance.profile) else { return };
        let Ok(mut state) = impact::fragment_state(physical, frag_pen(f.energy_j) as f64, &f.provenance.fragment_id, profile) else { return };
        if let Some(t) = f.provenance.start_s { state.elapsed_s = t; }
        let reach = self.to_kinetic_armour(f,max_range);
        let events = self.events(f.origin,f.dir,reach,false);
        let mut last_t = 0.0;
        let mut last_end = f.origin;
        for ev in events {
            if state.energy_j() <= 0.0 { break; }
            let (absorb,id) = match ev.kind {
                EvKind::Module(i) => {
                    if self.scene.is_none() && self.p.boxes[i].contains(f.origin) { continue; }
                    (absorb_mm(self.t.def.modules[i].kind) as f64 * if self.st.modules[i]>0.0 {1.0} else {0.5},self.t.def.modules[i].id.clone())
                }
                EvKind::Crew(i) => {
                    if self.st.crew[i]<=0.0 || (self.scene.is_none() && (f.origin-self.p.crew[i]).length()<=self.t.def.crew[i].radius) {continue;}
                    (CREW_ABSORB_MM as f64,format!("crew:{i}"))
                }
                EvKind::Unknown => break,
                EvKind::Plate(_) | EvKind::Decoration => continue,
            };
            self.record_contact(&ev);
            let segment_entry=state.current.clone();
            state.advance_time((ev.t-last_t).max(0.0) as f64); last_t=ev.t;
            let contact_id = format!("{}/target:{id}",f.provenance.fragment_id);
            let Ok(tr) = impact::deposit_fragment_contact_energy(&mut state,absorb,&contact_id) else { break };
            let damage = match ev.kind { EvKind::Crew(i) => self.hurt_crew(i,crew_damage(tr.budget.target_deposition_j as f32)), EvKind::Module(i) => self.hurt_module(i,module_damage(tr.budget.target_deposition_j as f32),0.5), _ => 0.0 };
            let end = f.origin+f.dir*ev.t;
            self.rep.fragments.push(Frag { from:last_end,to:end,hit:Some(id),damage,kind:"spall".into(),provenance:impact_report::segment_provenance(&f.provenance,&segment_entry),budget:Some(tr.budget) });
            self.rep.impact_events.push(impact_report::event(tr,end,end,Vec3::ZERO)); last_end=end;
        }
        if state.energy_j()>0.0 || last_end==f.origin {
            self.rep.fragments.push(Frag { from:last_end,to:f.origin+f.dir*reach,hit:None,damage:0.0,kind:"spall".into(),provenance:impact_report::segment_provenance(&f.provenance,&state.current),budget:None });
        }
    }

    /// The surface armour's walls along the shot's line, added as this shot's plates (the plate path
    /// then meets them exactly where the model's triangles are).
    fn add_walls(&mut self, o: Vec3, d: Vec3, max_t: f32) {
        if self.scene.is_some() {return;}
        let Some(a) = self.t.surf.clone() else { return };
        for w in a.walls(o, d, max_t, self.p.yaw, self.p.pivot) {
            self.p.plates.push(a.plate(w, self.p.yaw, self.p.pivot));
        }
    }

    fn to_kinetic_armour(&self,fragment:&tg_damage::Fragment,max:f32)->f32 {
        if let Some(scene)=self.scene {return scene.events(fragment.origin,fragment.dir,max,true).iter().find(|e|matches!(e.kind,EvKind::Plate(_) | EvKind::Unknown) && e.t>1e-5).map_or(max,|e|e.t);}
        let mut best=max;
        if let Some(a)=&self.t.surf {
            let skip=fragment.provenance.source_layer_or_module.as_deref().and_then(|s| s.strip_prefix("plate:"));
            if let Some(t)=a.nearest(fragment.origin,fragment.dir,max,self.p.yaw,self.p.pivot,skip,1e-5){best=best.min(t);}
        }
        for plate in &self.p.plates {
            if fragment.provenance.source_layer_or_module.as_deref()==Some(format!("plate:{}",plate.id).as_str()){continue;}
            if let Some(hit)=plate.intersect(fragment.origin,fragment.dir){if hit.distance>1e-5 {best=best.min(hit.distance);}}
        }
        best
    }

    fn events(&self, o: Vec3, d: Vec3, max_t: f32, plates: bool) -> Vec<Ev> {
        if let Some(scene)=self.scene {return scene.events(o,d,max_t,plates).into_iter().filter(|e|!matches!(e.kind,EvKind::Module(i) if empty_rack(self.t,&self.st,i))).collect();}
        let mut ev = Vec::new();
        if plates {
            for (i, pl) in self.p.plates.iter().enumerate() {
                if let Some(h) = pl.intersect(o, d) {
                    if h.distance <= max_t {
                        ev.push(Ev { t: h.distance, kind: EvKind::Plate(i),contact:None,paired_contact:None,surface_transit:None });
                    }
                }
            }
        }
        for (i, box_) in self.p.boxes.iter().enumerate() {
            if empty_rack(self.t, &self.st, i) {
                continue;
            }
            if let Some((t0, _)) = box_.intersect(o, d) {
                if t0 <= max_t {
                    ev.push(Ev { t: t0, kind: EvKind::Module(i),contact:None,paired_contact:None,surface_transit:None });
                }
            }
        }
        for (i, c) in self.p.crew.iter().enumerate() {
            if let Some(t) = ray_sphere(o, d, *c, self.t.def.crew[i].radius) {
                if t <= max_t {
                    ev.push(Ev { t, kind: EvKind::Crew(i),contact:None,paired_contact:None,surface_transit:None });
                }
            }
        }
        ev.sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap_or(std::cmp::Ordering::Equal));
        ev
    }

    /// Primary plate transit can pass a target's precomputed entrance. Recheck
    /// pending posed volumes at the current cursor and select the next contact.
    /// Removing its one candidate retains one primary traversal per target.
    fn next_kinetic_event(
        &self,
        pending: &mut Vec<Ev>,
        start: Vec3,
        dir: Vec3,
        cursor: f32,
        max_t: f32,
    ) -> Option<Ev> {
        if self.scene.is_some() {
            // The measured finite crossing cannot be moved to a box entrance at
            // the new cursor. Already traversed contacts remain traversed.
            let i=pending.iter().position(|e|e.t>=cursor && e.t<=max_t)?;
            return Some(pending.remove(i));
        }
        let origin = start + dir * cursor;
        let mut next: Option<(usize, Ev)> = None;
        for (index, candidate) in pending.iter().enumerate() {
            let distance = match candidate.kind {
                // Preserve declared plate work/order at a monotonic cursor;
                // this does not replace declared solids with a geometry union.
                EvKind::Plate(_) => Some(candidate.t.max(cursor)),
                EvKind::Unknown | EvKind::Decoration => Some(candidate.t),
                EvKind::Module(i) => {
                    if empty_rack(self.t, &self.st, i) {
                        None
                    } else {
                        self.p.boxes[i]
                            .intersect(origin, dir)
                            .map(|(enter, _)| cursor + enter)
                    }
                }
                EvKind::Crew(i) => {
                    let center = self.p.crew[i];
                    let radius = self.t.def.crew[i].radius;
                    if self.st.crew[i] <= 0.0 {
                        None
                    } else if (origin - center).length() <= radius {
                        Some(cursor)
                    } else {
                        ray_sphere(origin, dir, center, radius).map(|enter| cursor + enter)
                    }
                }
            };
            let Some(t) = distance.filter(|t| *t <= max_t) else {
                continue;
            };
            if next.as_ref().map_or(true, |(_, event)| t < event.t) {
                next = Some((
                    index,
                    Ev {
                        t,
                        kind: candidate.kind,
                        contact:None,
                        paired_contact:None,surface_transit:None,
                    },
                ));
            }
        }
        let (index, event) = next?;
        pending.remove(index);
        Some(event)
    }

    /// Distance from `o` along `d` to the nearest plate (a fragment inside stops at the armour).
    fn to_armour(&self, o: Vec3, d: Vec3, max_t: f32) -> f32 {
        if let Some(scene)=self.scene {return scene.events(o,d,max_t,true).iter().find(|e|matches!(e.kind,EvKind::Plate(_) | EvKind::Unknown) && e.t>0.02).map_or(max_t,|e|e.t);}
        let mut best = max_t;
        if let Some(a) = &self.t.surf {
            if let Some(t) = a.nearest(o, d, max_t, self.p.yaw, self.p.pivot, None, 0.02) {
                best = best.min(t);
            }
        }
        for pl in &self.p.plates {
            if let Some(h) = pl.intersect(o, d) {
                if h.distance > 0.02 && h.distance < best {
                    best = h.distance;
                }
            }
        }
        best
    }

    fn hurt_module(&mut self, i: usize, dmg: f32, ammo_chance: f32) -> f32 {
        if dmg <= 0.0 || i >= self.st.modules.len() || empty_rack(self.t, &self.st, i) {
            return 0.0;
        }
        let was = self.st.modules[i] > 0.0;
        let dmg = apply_health_damage(&mut self.st.modules[i], self.t.def.modules[i].max_health, dmg);
        if dmg <= 0.0 { return 0.0; }
        *self.mod_dmg.entry(i).or_default() += dmg;
        if was && self.st.modules[i] <= 0.0 {
            self.newly_destroyed.push(i);
            let m = &self.t.def.modules[i];
            match m.kind {
                ModuleKind::AmmoRack => {
                    // fewer rounds in the rack, fewer to set off
                    if self.rng.next_f32() < ammo_chance * (0.4 + 0.6 * self.st.rack(i)) {
                        self.st.ammo_detonated = true;
                        self.rep.events.push("ammo_detonation".into());
                    } else {
                        self.start_fire(m.center);
                    }
                }
                ModuleKind::FuelTank => self.start_fire(m.center),
                ModuleKind::Engine => {
                    if self.rng.next_f32() < 0.25 {
                        self.start_fire(m.center);
                    }
                }
                _ => {}
            }
        }
        dmg
    }

    fn start_fire(&mut self, at: Vec3) {
        if let Some(context)=self.context {
            let cause=context.cause("fire");
            self.rep.cause_transitions.push(if self.st.active_fire_cause.is_some() {
                causes::CauseTransition::Replaced {mechanism_id:cause.mechanism_id.clone(),source_event_id:cause.source_event_id.clone()}
            } else {causes::CauseTransition::Started {mechanism_id:cause.mechanism_id.clone(),source_event_id:cause.source_event_id.clone()}});
            self.st.active_fire_cause=Some(cause);
        } else { self.st.active_fire_cause=None; }
        if self.st.fire_s <= 0.0 {
            self.rep.events.push("fire".into());
        }
        self.st.fire_s = self.st.fire_s.max(FIRE_S);
        self.st.fire_at = Some(at);
    }

    fn hurt_crew(&mut self, i: usize, dmg: f32) -> f32 {
        if dmg <= 0.0 || i >= self.st.crew.len() || self.st.crew[i] <= 0.0 {
            return 0.0;
        }
        let dmg = apply_health_damage(&mut self.st.crew[i], 100.0, dmg);
        if dmg <= 0.0 { return 0.0; }
        *self.crew_dmg.entry(i).or_default() += dmg;
        if self.st.crew[i] <= 0.0 {
            self.st.crew[i] = 0.0;
            self.newly_killed.push(i);
        }
        dmg
    }

    /// A fragment from `o` along `d`: hits crew and modules in its way, slowed by each, and stops
    /// at the armour or when it has nothing left.
    fn fragment(&mut self, o: Vec3, d: Vec3, energy_j: f32, kind: &'static str, max_range: f32) {
        let reach = self.to_armour(o, d, max_range);
        // a fragment starting inside a module or a person is not stopped by what it starts in
        let evs: Vec<Ev> = self
            .events(o, d, reach, false)
            .into_iter()
            .filter(|ev| match ev.kind {
                EvKind::Module(i) => self.scene.is_some() || !self.p.boxes[i].contains(o),
                EvKind::Crew(i) => self.scene.is_some() || (o - self.p.crew[i]).length() > self.t.def.crew[i].radius,
                EvKind::Plate(_) | EvKind::Decoration | EvKind::Unknown => true,
            })
            .collect();
        let mut e = energy_j;
        let mut end = o + d * reach;
        let mut hit = None;
        let mut dealt = 0.0;
        for ev in evs {
            if e <= 50.0 {
                break;
            }
            let pen = frag_pen(e);
            self.record_contact(&ev);
            match ev.kind {
                EvKind::Crew(i) => {
                    if self.st.crew[i] <= 0.0 {
                        continue;
                    }
                    let dmg = crew_damage(e);
                    dealt += self.hurt_crew(i, dmg);
                    hit.get_or_insert_with(|| format!("crew:{}", i));
                    end = o + d * ev.t;
                    if pen <= CREW_ABSORB_MM {
                        e = 0.0;
                    } else {
                        e *= (1.0 - CREW_ABSORB_MM / pen).powi(2);
                    }
                }
                EvKind::Module(i) => {
                    let m = &self.t.def.modules[i];
                    let kind_m = m.kind;
                    let dmg = module_damage(e);
                    dealt += self.hurt_module(i, dmg, 0.5);
                    hit.get_or_insert_with(|| self.t.def.modules[i].id.clone());
                    end = o + d * ev.t;
                    let a = absorb_mm(kind_m);
                    if pen <= a {
                        e = 0.0;
                    } else {
                        e *= (1.0 - a / pen).powi(2);
                    }
                }
                EvKind::Unknown => {end=o+d*ev.t;e=0.;break;}
                EvKind::Plate(_) | EvKind::Decoration => {}
            }
        }
        if e > 50.0 {
            end = o + d * reach;
        }
        self.rep.fragments.push(Frag { from: o, to: end, hit, damage: dealt, kind:kind.into(), provenance: Default::default(), budget: None });
    }

    /// The blast of a filler inside a compartment: whoever and whatever is close.
    fn blast_inside(&mut self, at: Vec3, kg: f32) {
        if self.scene.is_some(){self.blast_surface(at,kg,true);return;}
        let equivalent_kg = kg * self.explosive_re_factor;
        let r = blast_radius_m(equivalent_kg);
        // a bigger charge is deadlier at the same share of its radius
        let power = 150.0 * (equivalent_kg.max(0.005) / 0.05).powf(0.25);
        for i in 0..self.p.crew.len() {
            let dist = (self.p.crew[i] - at).length();
            if dist < r {
                let k = 1.0 - (dist / r).powi(2);
                self.hurt_crew(i, power * k);
            }
        }
        for i in 0..self.p.boxes.len() {
            if self.t.def.modules[i].is_external() {
                continue;
            }
            // distance to the box, not to its middle
            let dist = self.p.boxes[i].distance(at);
            if dist < r * 0.8 {
                let k = 1.0 - (dist / (r * 0.8)).powi(2);
                self.hurt_module(i, 70.0 * k, 0.6);
            }
        }
        self.rep.bursts.push(Burst { pos: at, radius: r, inside: true, explosive_kg: kg,
            time_s:None, armed_at_s:None, delay_s:None, detonation_id:None, mechanism:None });
    }

    /// An outside burst: running gear, the barrel, and the crew of an open vehicle.
    fn blast_outside(&mut self, at: Vec3, kg: f32) {
        self.blast_outside_query(at, at, kg);
    }

    /// Keep the actual detonation in the report. A contact can supply a
    /// millimetre exterior query offset without moving that detonation.
    fn blast_outside_query(&mut self, at: Vec3, query_at: Vec3, kg: f32) {
        let equivalent_kg = kg * self.explosive_re_factor;
        let r = outside_radius_m(equivalent_kg);
        self.external_exposure(query_at, equivalent_kg, r);
        self.rep.bursts.push(Burst { pos: at, radius: r, inside: false, explosive_kg: kg,
            time_s:None, armed_at_s:None, delay_s:None, detonation_id:None, mechanism:None });
    }
    /// Existing radial pressure law, now bounded by actual modeled anatomy and
    /// surface line of sight. This is not a pressure-cell/reflection simulation.
    fn blast_surface(&mut self,at:Vec3,kg:f32,inside:bool){
        let scene=self.scene.unwrap();let equivalent_kg=kg*self.explosive_re_factor;
        let r=if inside{blast_radius_m(equivalent_kg)}else{outside_radius_m(equivalent_kg)};
        let exposure=if inside{scene.exposed_anatomy_inside(at,r*1.4)}else{scene.exposed_anatomy(at,r*1.4)};
        let Ok(exposure)=exposure else{return};
        for (kind,dist,contact) in exposure {
            let (damage,hit)=match kind {
                EvKind::Module(i)=>{
                    let module=&self.t.def.modules[i];if module.is_external()==inside || empty_rack(self.t,&self.st,i){continue;}
                    let radius=if inside{r*0.8}else{r};if dist>=radius {continue;}
                    let power=if inside{70.}else{140.*(equivalent_kg/0.7).powf(0.35)};let requested=power*(1.-(dist/radius).powi(2));
                    let name=module.id.clone();(self.hurt_module(i,requested,if inside{0.6}else{0.}),name)
                },
                EvKind::Crew(i)=>{
                    if !inside && !self.t.def.open_top {continue;}
                    let radius=if inside{r}else{r*1.4};if dist>=radius {continue;}
                    let power=if inside{150.*(equivalent_kg.max(0.005)/0.05).powf(0.25)}else{120.*(equivalent_kg/0.7).powf(0.35)};
                    (self.hurt_crew(i,power*(1.-(dist/radius).powi(2))),format!("crew:{i}"))
                },_=>continue,
            };
            let to=Vec3::new(contact.point[0] as f32,contact.point[1] as f32,contact.point[2] as f32);
            self.record_contact(&Ev{t:dist,kind,contact:Some(contact),paired_contact:None,surface_transit:None});
            self.rep.fragments.push(Frag{from:at,to,hit:Some(hit),damage,kind:"blast".into(),provenance:Default::default(),budget:None});
        }
        self.rep.bursts.push(Burst{time_s:None,armed_at_s:None,delay_s:None,detonation_id:None,mechanism:None,pos:at,radius:r,inside,explosive_kg:kg});
    }

    /// The casing of an APHE / HE round bursting at `at`, moving along `d` at `v` m/s.
    fn burst_fragments(&mut self, at: Vec3, d: Vec3, v: f32, shell: &ProjectileDef) {
        let kg = shell.explosive_mass_kg.max(0.005);
        let casing = (shell.mass_kg * 0.85).max(0.05);
        let ratio = kg * self.explosive_re_factor / casing;
        let gurney = 2400.0 * (ratio / (1.0 + 0.5 * ratio)).sqrt();
        let n = (30.0 + kg * 400.0).clamp(30.0, 90.0) as usize;
        let each_mass = casing / n as f32;
        for _ in 0..n {
            let fly = d * (v * 0.5) + random_unit(&mut self.rng) * gurney;
            let speed = fly.length().max(1.0);
            let e = 0.5 * each_mass * speed * speed;
            self.fragment(at, fly.normalized(), e, "burst", 6.0);
        }
        self.blast_inside(at, kg);
    }

    /// One accepted charge release. A stopped body keeps its armed fuse; an
    /// unknown continuation outside this target cannot call this method.
    fn detonate_aphe(&mut self, at: Vec3, d: Vec3, v: f32, shell: &ProjectileDef,
        fuse: DelayedFuse, state: &mut ImpactState, inside: bool) {
        if state.fuse != impact::FuseState::Armed || !state.charge.as_ref()
            .is_some_and(|c| c.disposition == impact::ChargeDisposition::Contained) { return; }
        state.fuse = impact::FuseState::Detonated;
        state.elapsed_s = fuse.time_s;
        state.traversal = None;
        state.charge.as_mut().unwrap().disposition = impact::ChargeDisposition::Released;
        self.rep.events.push("aphe_detonated".into());
        self.rep.path.push(at);
        if inside {
            let kg = shell.explosive_mass_kg;
            let casing = (shell.mass_kg * 0.85).max(0.05);
            let ratio = kg * self.explosive_re_factor / casing;
            let gurney = 2400.0 * (ratio / (1.0 + 0.5 * ratio)).sqrt();
            let n = (30.0 + kg * 400.0).clamp(30.0, 90.0) as usize;
            let each_mass = casing / n as f32;
            for index in 0..n {
                let fly = d * (v * 0.5) + random_unit(&mut self.rng) * gurney;
                let energy = (0.5 * each_mass as f64 *
                    fly.to_array().iter().map(|x| (*x as f64).powi(2)).sum::<f64>()).max(0.0);
                self.fragment(at, fly.normalized(), energy as f32, "burst", 6.0);
                self.rep.fragments.last_mut().unwrap().provenance = FragmentProvenance {
                    fragment_id: format!("{}/casing:{index}", fuse.detonation_id),
                    parent_event_id: fuse.detonation_id.clone(),
                    source: impact::FragmentSource::CasingFragment,
                    source_layer_or_module: Some("projectile_casing".into()),
                    physical: Some(impact::PhysicalFragment { mass_kg: each_mass as f64,
                        energy_j: energy, area_m2:None, velocity_m_s:fly }),
                    weight:1.0, start_s:Some(fuse.time_s),
                    profile:Some(impact::ProfileReference { id:"legacy_gurney_casing".into(),
                        revision:"aphe_delay_v1".into(), source:impact::ProfileSource::Estimated }),
                };
            }
            self.blast_inside(at, kg);
        } else {
            self.blast_outside(at, shell.explosive_mass_kg);
        }
        if let Some(burst) = self.rep.bursts.last_mut() {
            burst.time_s=Some(fuse.time_s); burst.armed_at_s=Some(fuse.armed_at_s);
            burst.delay_s=Some(fuse.delay_s); burst.detonation_id=Some(fuse.detonation_id);
            burst.mechanism=Some("delayed_aphe".into());
        }
    }

    /// Spall off the inside of a plate the round has just come through.
    fn spall(&mut self, at: Vec3, d: Vec3, shell: &ProjectileDef, residual_mm: f32, energy_j: f32) {
        let cal = shell.caliber_mm;
        if cal < 20.0 && !shell.kind.is_chemical() {
            return; // small arms: the bullet itself, nothing else
        }
        let (n, share, cone) = match shell.kind {
            ProjectileKind::Apcr | ProjectileKind::Apds => ((2.0 + residual_mm * 0.05).clamp(2.0, 10.0), 0.12, 11.0),
            ProjectileKind::Apfsds => ((3.0 + residual_mm * 0.05).clamp(3.0, 12.0), 0.15, 10.0),
            ProjectileKind::Heat | ProjectileKind::HeatFs => ((5.0 + residual_mm * 0.08).clamp(5.0, 25.0), 0.0, 14.0),
            _ => ((4.0 + residual_mm * 0.12 + cal * 0.04).clamp(3.0, 36.0), 0.3, 22.0),
        };
        let n = n as usize;
        let each = if shell.kind.is_chemical() { cal * cal * 1.2 } else { energy_j * share / n as f32 };
        for _ in 0..n {
            let dir = cone_dir(d, cone, &mut self.rng);
            self.fragment(at, dir, each, "spall", 4.0);
        }
    }

    fn note_layer(&mut self, i: usize, angle: f32, los: f32, req: f32, before: f32, after: f32, passed: bool, point: Vec3, entering: bool) {
        let pl = &self.p.plates[i];
        self.rep.layers.push(Layer {
            plate: pl.id.clone(),
            zone: pl.zone,
            material: pl.material.clone(),
            thickness_mm: pl.thickness_mm,
            angle_deg: angle,
            los_mm: los,
            required_mm: req,
            pen_before_mm: before,
            pen_after_mm: after,
            passed,
            point,
            entering,
        });
    }
}

/// One round against the target. `st` is the target's state before; the report carries the state after.
pub fn shoot(t: &Target, st: &TargetState, shot: &Shot) -> Report {
    shoot_internal(t,st,shot,None,None)
}
/// Resolve a finite accepted flight segment against posed renderer triangles.
pub fn shoot_surface(t:&Target,st:&TargetState,shot:&Shot,scene:&geometry::combat_scene::CombatScene,end:Vec3,context:Option<&causes::DamageContext>)->Result<Report,String> {
    if !scene.accepts(t) {return Err("invalid finite surface shot identity/segment".into());}
    shoot_surface_registered(t,st,shot,scene,end,context)
}
// The caller has checked this exact immutable borrow in the current synchronous
// transaction. No proof is retained between rounds or across targets.
fn shoot_surface_registered(t:&Target,st:&TargetState,shot:&Shot,scene:&geometry::combat_scene::CombatScene,end:Vec3,context:Option<&causes::DamageContext>)->Result<Report,String> {
    let delta=end-shot.origin;let span=delta.length();let d=shot.dir.normalized();
    if !span.is_finite() || span<=0.0 || (delta-d*span).length()>span*1e-5 || context.is_some_and(|c|!c.valid()) {return Err("invalid finite surface shot identity/segment".into());}
    scene.reset_error();let report=shoot_internal(t,st,shot,context,Some((scene,span)));
    if let Some(error)=scene.take_error(){return Err(error);} Ok(report)
}
/// The incoming ballistic owner proves an actual finite contact first. Only that
/// contact admits bounded internal travel, using the same frozen surface scene.
/// Inside a target the current impact owner follows a straight tangent at fixed
/// pose; this is explicit and does not claim moving-target continuous collision.
pub fn shoot_surface_impact(t:&Target,st:&TargetState,shot:&Shot,scene:&geometry::combat_scene::CombatScene,incoming_end:Vec3,context:Option<&causes::DamageContext>)->Result<Report,String>{
    let delta=incoming_end-shot.origin;let length=delta.length();let dir=shot.dir.normalized();
    if !scene.accepts(t) || !length.is_finite() || length<=0. || (delta-dir*length).length()>length*1e-5 {return Err("invalid incoming surface segment".into());}
    if scene.crossings(shot.origin,incoming_end)?.is_empty(){return shoot_surface_registered(t,st,shot,scene,incoming_end,context);}
    let end=scene.continuation_end(shot.origin,dir)?;
    let mut report=shoot_surface_registered(t,st,shot,scene,end,context)?;
    report.events.push("fixed_pose_internal_surface_continuation".into());Ok(report)
}

pub fn shoot_context(t:&Target,st:&TargetState,shot:&Shot,context:&causes::DamageContext)->Report {
    assert!(context.valid(),"contextual combat requires a validated admitted identity");
    shoot_internal(t,st,shot,Some(context),None)
}
fn shoot_internal<'a>(t: &'a Target, st: &TargetState, shot: &Shot, context:Option<&'a causes::DamageContext>,surface:Option<(&'a geometry::combat_scene::CombatScene,f32)>) -> Report {
    let shell = &shot.shell;
    let d = shot.dir.normalized();
    let mut w = Work {
        scene:surface.map(|(s,_)|s),
        context,
        t,
        p: t.posed(shot.turret_yaw),
        st: st.clone(),
        rng: Rng::new(shot.seed.max(1)),
        explosive_re_factor: tg_weapon::explosive_re_factor(&shell.explosive_type),
        rep: Report {
            geometry_contacts:vec![],primary_geometry_contacts:vec![],primary_module_destructions:vec![],
            cause_transitions:vec![],
            hit: false,
            outcome: Outcome::Miss,
            shell_kind: shell.kind,
            caliber_mm: shell.caliber_mm,
            impact: None,
            normal: None,
            plate: None,
            angle_deg: 0.0,
            pen_mm: 0.0,
            layers: vec![],
            path: vec![],
            ricochet_dir: None,
            bursts: vec![],
            fragments: vec![],
            modules: vec![],
            crew: vec![],
            events: vec![],
            caps: caps(t, st),
            state: st.clone(),
            title: String::new(),
            turret_yaw: shot.turret_yaw,
            mechanism_revision: None,
            impact_events: vec![],
            impact_state: None,
        },
        mod_dmg: HashMap::new(),
        crew_dmg: HashMap::new(),
        newly_destroyed: vec![],
        newly_killed: vec![],
    };
    // only the part of the line that crosses the vehicle's box
    let (start,span)=if let Some((_,span))=surface {(shot.origin,span)} else {
        let Some((t_in,t_out))=ray_box(shot.origin,d,(t.lo+t.hi)*0.5,(t.hi-t.lo)*0.5) else {w.rep.title="未命中".into();return w.rep;};
        (shot.origin+d*(t_in-0.05).max(0.0),t_out-t_in+0.1)
    };
    w.add_walls(start,d,span);
    let mut events = w.events(start, d, span, true);
    let roll = 1.0 + 0.05 * gauss(&mut w.rng).clamp(-2.5, 2.5);
    let mut pen = shell.pen_at(shot.distance_m) * roll;
    w.rep.pen_mm = pen;
    let mut speed = shot.speed_ms;
    let core = match shell.kind {
        ProjectileKind::Apcr => 0.35,
        ProjectileKind::Apds => 0.6,
        _ => 1.0,
    };
    let chemical = shell.kind.is_chemical();
    let kinetic = shell.kind.is_kinetic();
    let mut impact_state = if kinetic {
        match impact::initialize_impact(shell, d * shot.speed_ms, pen as f64, "core") {
            Ok(s) if shot.speed_ms.is_finite() && shot.speed_ms >= 0.0 => Some(s),
            _ => {
                w.rep.events.push("rejected_impact_input".into());
                return w.rep;
            }
        }
    } else {
        None
    };
    if kinetic {
        w.rep.mechanism_revision = Some(impact::MECHANISM_REVISION.into());
    }
    // APHE and every capped round with a filler (APCBC-HE such as the PzGr 39): a delayed burst
    let aphe = kinetic
        && shell.explosive_mass_kg > 0.0
        && !matches!(
            shell.kind,
            ProjectileKind::Apcr | ProjectileKind::Apds | ProjectileKind::Apfsds
        );
    if aphe {
        if let Some(state) = impact_state.as_mut() {
            state.fuse = impact::FuseState::Unarmed;
            if let Some(charge) = state.charge.as_mut() {
                charge.disposition = impact::ChargeDisposition::Contained;
            }
        }
    }
    let he = shell.kind == ProjectileKind::He;
    let hesh = shell.kind == ProjectileKind::Hesh;
    let mut touched = false;
    let mut inside = false;
    let mut delayed_fuse: Option<DelayedFuse> = None;
    let mut jet_end: Option<f32> = None;
    // The ballistic owner has already timed incoming travel to the first
    // physical surface. Impact records start there, without counting it twice.
    let mut last_t = if surface.is_some(){events.first().map_or(0.,|e|e.t)}else{0.};
    let mut core_parent: Option<(Vec3, impact::ImpactTransition)> = None;
    let mut alive = true;
    let mut through_armour = false;
    let mut hit_something = false;
    let energy = |speed: f32| 0.5 * shell.mass_kg * core * speed * speed;
    let first_point =
        |w: &mut Work, p: Vec3, n: Option<Vec3>, plate: Option<String>, angle: f32| {
            if w.rep.impact.is_none() {
                w.rep.impact = Some(p);
                w.rep.normal = n;
                w.rep.plate = plate;
                w.rep.angle_deg = angle;
                w.rep.path.push(p);
            }
        };
    let mut legacy_event = 0;
    let mut deferred_surface_spall:HashMap<u32,DeferredSurfaceSpall>=HashMap::new();
    while legacy_event < events.len() {
        if !alive {
            break;
        }
        let ev = if kinetic {
            let Some(event) = w.next_kinetic_event(&mut events, start, d, last_t, span) else {
                break;
            };
            event
        } else {
            let event = events[legacy_event].clone();
            legacy_event += 1;
            event
        };
        // The fuse measures seconds. Recompute the remaining distance at this
        // segment's actual residual speed after every plate/module/crew contact.
        if let (Some(fuse), Some(state)) = (delayed_fuse.as_ref(), impact_state.as_mut()) {
            let gap = (ev.t-last_t).max(0.0);
            let remaining = (fuse.time_s-state.elapsed_s).max(0.0);
            if remaining <= gap as f64 / (speed as f64).max(1e-12) {
                let at = start+d*(last_t+(remaining*speed as f64) as f32);
                if let Some((origin,parent)) = &core_parent {
                    if (at-*origin).length() > 1e-6 {
                        w.rep.fragments.push(Frag { from:*origin,to:at,hit:None,damage:0.0,
                            kind:"shell".into(),provenance:impact_report::outgoing_core_provenance(parent),budget:None });
                    }
                }
                w.detonate_aphe(at,d,speed,shell,delayed_fuse.take().unwrap(),state,inside);
                alive = false;
                break;
            }
        }
        if let Some(j) = jet_end {
            if ev.t > j {
                w.rep.path.push(start + d * j);
                alive = false;
                break;
            }
        }
        if let Some(state) = impact_state.as_mut() {
            state.advance_time((ev.t - last_t).max(0.0) as f64);
        }
        last_t = last_t.max(ev.t);
        let point = ev.contact.as_ref().map_or(start+d*ev.t,|c|Vec3::new(c.point[0] as f32,c.point[1] as f32,c.point[2] as f32));
        w.record_primary_contact(&ev);
        if let Some(transit)=ev.surface_transit.filter(|t|t.is_exit) {
            // Work was deposited at this interval's entrance. This is its real
            // measured exit, not another armor charge or a rewound contact.
            if let Some((origin,parent))=core_parent.take() {
                if (point-origin).length()>1e-6 {w.rep.fragments.push(Frag {from:origin,to:point,hit:None,damage:0.,
                    kind:"shell".into(),provenance:impact_report::outgoing_core_provenance(&parent),budget:None});}
                core_parent=Some((point,parent));
            }
            if let Some(spall)=deferred_surface_spall.remove(&transit.id) {
                match spall {
                    DeferredSurfaceSpall::Kinetic(mut tr)=>{
                        if let Some(state)=impact_state.as_ref() {tr.output.elapsed_s=state.elapsed_s;}
                        w.kinetic_surface_spall(point,d,shell,&tr);
                    },
                    DeferredSurfaceSpall::Legacy {pen,energy}=>w.spall(point,d,shell,pen,energy),
                }
            }
            w.rep.path.push(point);
            continue;
        }
        match ev.kind {
            EvKind::Decoration => continue,
            EvKind::Unknown => {
                hit_something=true;first_point(&mut w,point,ev.contact.as_ref().map(|c|Vec3::new(c.facing_normal[0] as f32,c.facing_normal[1] as f32,c.facing_normal[2] as f32)),None,0.);
                w.rep.events.push("unsupported_surface_resistance".into());w.rep.outcome=Outcome::Stopped;alive=false;break;
            },
            EvKind::Plate(i) => {
                let mut pl = w.p.plates[i].clone();
                let h=if let Some(contact)=&ev.contact {
                    pl.normal=Vec3::new(contact.geometric_normal[0] as f32,contact.geometric_normal[1] as f32,contact.geometric_normal[2] as f32);
                    let facing=Vec3::new(contact.facing_normal[0] as f32,contact.facing_normal[1] as f32,contact.facing_normal[2] as f32);
                    tg_armor::PlateHit {distance:ev.t,point,facing_normal:facing,incidence_deg:(-d.dot(facing)).clamp(0.,1.).acos().to_degrees()}
                } else {let Some(h)=pl.intersect(start,d) else{continue;};h};
                let entering = ev.contact.as_ref().map_or(d.dot(pl.normal)<0.,|c|c.crossing!="exit");
                let measured_exit=ev.paired_contact.as_ref().map(|c|Vec3::new(c.point[0] as f32,c.point[1] as f32,c.point[2] as f32));
                let traversal_id=ev.surface_transit.map_or(0,|t|t.id);
                let deferred_exit=ev.surface_transit.is_some_and(|t|t.deferred);
                let first = !touched;
                touched = true;
                hit_something = true;
                first_point(
                    &mut w,
                    point,
                    Some(h.facing_normal),
                    Some(pl.id.clone()),
                    h.incidence_deg,
                );
                let mat = t.material(&pl.material);
                let inc = h.incidence_deg;
                if kinetic
                    && tg_penetration::validate_kinetic_contact(
                        shell,
                        pl.thickness_mm,
                        &mat,
                        tg_penetration::ImpactContext {
                            incidence_deg: inc,
                            distance_m: shot.distance_m,
                        },
                    )
                    .is_err()
                {
                    w.rep.events.push("rejected_impact_contact".into());
                    if !through_armour {
                        w.rep.outcome = Outcome::Stopped;
                    }
                    alive = false;
                    break;
                }
                if let Some((origin, parent)) = core_parent.take() {
                    if (point - origin).length() > 1e-6 {
                        w.rep.fragments.push(Frag {
                            from: origin,
                            to: point,
                            hit: None,
                            damage: 0.0,
                            kind: "shell".into(),
                            provenance: impact_report::outgoing_core_provenance(&parent),
                            budget: None,
                        });
                    }
                }
                if he || hesh {
                    // contact fuse: it bursts on the plate
                    w.rep.path.push(point);
                    let kg = shell.explosive_mass_kg.max(0.01);
                    // the data's HE penetration when it gives one, else from the filler
                    let rating = if hesh {
                        pen
                    } else if pen > 0.5 {
                        pen.max(he_pen_mm(kg * w.explosive_re_factor) * 0.8)
                    } else {
                        he_pen_mm(kg * w.explosive_re_factor)
                    };
                    let inner = if ev.contact.is_some(){measured_exit.unwrap_or(point)+d*0.03}else{point + d * (pl.thickness_mm * 0.001 + 0.03)};
                    if pl.zone != ArmorZone::Skirt && rating >= pl.thickness_mm {
                        w.note_layer(
                            i,
                            inc,
                            pl.thickness_mm,
                            pl.thickness_mm,
                            rating,
                            rating - pl.thickness_mm,
                            true,
                            point,
                            entering,
                        );
                        // the blast breaks in: a scab of the plate flies inwards, the shock wounds
                        let n = if hesh { 30 } else { 18 };
                        let each = if hesh {
                            6000.0 * (kg * w.explosive_re_factor / 1.0).sqrt()
                        } else {
                            3000.0 * (kg * w.explosive_re_factor / 0.5).sqrt()
                        };
                        let into = if entering { d } else { -pl.normal };
                        for _ in 0..n {
                            let dir = cone_dir(into, if hesh { 55.0 } else { 60.0 }, &mut w.rng);
                            w.fragment(inner, dir, each, "spall", 4.0);
                        }
                        w.blast_inside(inner, kg * if hesh { 0.4 } else { 0.8 });
                        w.rep.outcome = Outcome::Overpressure;
                    } else {
                        w.note_layer(
                            i,
                            inc,
                            pl.thickness_mm,
                            pl.thickness_mm,
                            rating,
                            0.0,
                            false,
                            point,
                            entering,
                        );
                        w.blast_outside_query(point, point - d * 0.001, kg);
                        w.rep.outcome = Outcome::Blast;
                    }
                    alive = false;
                    break;
                }
                if shell.kind == ProjectileKind::Smoke {
                    w.rep.outcome = Outcome::Stopped;
                    alive = false;
                    break;
                }
                let eff = if chemical {
                    inc
                } else {
                    (inc - shell.normalization_deg).max(0.0)
                };
                let los = pl.thickness_mm / eff.to_radians().cos().max(0.02);
                let factor = if chemical {
                    mat.chemical_factor
                } else {
                    mat.kinetic_factor
                };
                let req = los * factor;
                let overmatch = kinetic && shell.caliber_mm >= 3.0 * pl.thickness_mm;
                if let Some(state) = impact_state.as_mut() {
                    let layer_id = format!("plate:{}", pl.id);
                    let available = state
                        .traversal
                        .as_ref()
                        .filter(|c| c.layer_id == layer_id && c.traversal_id == traversal_id)
                        .map(|c| c.entry.remaining_pen_mm)
                        .unwrap_or(state.remaining_pen_mm);
                    let verdict = if state.energy_j() == 0.0 && req > 0.0 {
                        impact::ImpactVerdict::Stopped
                    } else if first && !overmatch && inc >= shell.ricochet_angle_deg {
                        impact::ImpactVerdict::Ricochet
                    } else if inc >= shell.shatter_angle_deg && mat.hardness_bhn >= 350.0 {
                        impact::ImpactVerdict::Shattered
                    } else if available < req as f64 {
                        impact::ImpactVerdict::Stopped
                    } else {
                        impact::ImpactVerdict::Passed
                    };
                    let before = state.remaining_pen_mm as f32;
                    let Ok(mut tr) = impact::advance_kinetic_layer(
                        state,
                        &impact::DeclaredLayerContact {
                            layer_id,
                            traversal_id,
                            cumulative_required_mm: req as f64,
                            cumulative_path_m: if ev.contact.is_some(){measured_exit.map_or(0.,|p|(p-point).length() as f64)}else{los as f64*0.001},
                            thickness_mm: pl.thickness_mm as f64,
                            density_kg_m3: mat.density_kg_m3 as f64,
                            verdict,
                            emit_spall: entering && shell.caliber_mm >= 20.0,
                        },
                    ) else {
                        w.rep.events.push("rejected_impact_contact".into());
                        if aphe { fail_aphe_fuse(&mut delayed_fuse,state); }
                        alive = false;
                        break;
                    };
                    pen = state.remaining_pen_mm as f32;
                    speed = state.velocity_m_s.length();
                    let passed = verdict == impact::ImpactVerdict::Passed;
                    let inner = if ev.contact.is_some(){measured_exit.unwrap_or(point)}else{point + d * (los * 0.001)};
                    if aphe {
                        if matches!(verdict,impact::ImpactVerdict::Shattered|impact::ImpactVerdict::Ricochet) {
                            fail_aphe_fuse(&mut delayed_fuse,state);
                        } else if pl.zone != ArmorZone::Skirt && pl.thickness_mm >= shell.fuse_sensitivity_mm {
                            arm_aphe_fuse(&mut delayed_fuse,state,shell,tr.entry.elapsed_s);
                        }
                        tr.output = state.current.clone();
                    }
                    // Plate transit is already included in the shared output.
                    // Subsequent free travel begins at the actual plate exit.
                    if passed {
                        last_t = ev.t + (inner-point).length();
                    }
                    w.note_layer(i, inc, los, req, before, pen, passed, point, entering);
                    w.rep.impact_events.push(impact_report::event(
                        tr.clone(),
                        point,
                        if passed { inner } else { point },
                        h.facing_normal,
                    ));
                    if !passed {
                        w.rep.path.push(point);
                        if !through_armour {
                            w.rep.outcome = match verdict {
                                impact::ImpactVerdict::Ricochet => {
                                    w.rep.ricochet_dir = Some(
                                        (d - h.facing_normal * (2.0 * d.dot(h.facing_normal)))
                                            .normalized(),
                                    );
                                    Outcome::Ricochet
                                }
                                impact::ImpactVerdict::Shattered => Outcome::Shattered,
                                _ => Outcome::Stopped,
                            };
                        }
                        alive = false;
                        break;
                    }
                    if let Some(fuse) = delayed_fuse.as_ref().filter(|f| f.time_s <= state.elapsed_s) {
                        let travelled = ((fuse.time_s-tr.entry.elapsed_s).max(0.0)
                            *tr.entry.velocity_m_s.length() as f64) as f32;
                        let at = point+d*travelled.min(los*0.001);
                        w.rep.events.push("aphe_fuse_in_armour".into());
                        w.detonate_aphe(at,d,speed,shell,delayed_fuse.take().unwrap(),state,false);
                        alive=false;
                        break;
                    }
                    if entering {
                        if deferred_exit {deferred_surface_spall.insert(traversal_id,DeferredSurfaceSpall::Kinetic(tr.clone()));}
                        else {w.kinetic_surface_spall(inner,d,shell,&tr);}
                    }
                    core_parent = Some((inner, tr));
                    if pl.zone == ArmorZone::Skirt {
                        if state.energy_j() <= 0.0 {
                            alive = false;
                            break;
                        }
                        continue;
                    }
                    through_armour = true;
                    w.rep.outcome = Outcome::Penetrated;
                    if entering {
                        inside = true;
                        if !deferred_exit {w.rep.path.push(inner);}
                    } else {
                        inside = false;
                    }
                    if state.energy_j() <= 0.0 {
                        alive = false;
                        break;
                    }
                    continue;
                }
                if first && kinetic && !overmatch && inc >= shell.ricochet_angle_deg {
                    w.note_layer(i, inc, los, req, pen, pen, false, point, entering);
                    let r = d - h.facing_normal * (2.0 * d.dot(h.facing_normal));
                    w.rep.ricochet_dir = Some(r.normalized());
                    w.rep.outcome = Outcome::Ricochet;
                    alive = false;
                    break;
                }
                if first && chemical && inc >= 80.0 {
                    w.note_layer(i, inc, los, req, pen, pen, false, point, entering);
                    let r = d - h.facing_normal * (2.0 * d.dot(h.facing_normal));
                    w.rep.ricochet_dir = Some(r.normalized());
                    w.rep.outcome = Outcome::Ricochet;
                    alive = false;
                    break;
                }
                if kinetic && inc >= shell.shatter_angle_deg && mat.hardness_bhn >= 350.0 {
                    w.note_layer(i, inc, los, req, pen, 0.0, false, point, entering);
                    w.rep.outcome = Outcome::Shattered;
                    alive = false;
                    break;
                }
                if pen < req {
                    w.note_layer(i, inc, los, req, pen, 0.0, false, point, entering);
                    if w.rep.outcome != Outcome::Penetrated {
                        w.rep.outcome = Outcome::Stopped;
                    }
                    w.rep.path.push(point);
                    // an APHE fuse started by the blow fires outside the plate: the running gear may suffer
                    if aphe
                        && pl.thickness_mm >= shell.fuse_sensitivity_mm
                        && shell.explosive_mass_kg > 0.0
                    {
                        w.blast_outside_query(point, point - d * 0.001, shell.explosive_mass_kg * 0.5);
                    }
                    alive = false;
                    break;
                }
                let before = pen;
                let ratio = (req / pen.max(1e-3)).min(1.0);
                pen -= req;
                if kinetic {
                    speed *= (1.0 - ratio * ratio).max(0.0).sqrt();
                }
                w.note_layer(i, inc, los, req, before, pen, true, point, entering);
                if pl.zone == ArmorZone::Skirt {
                    continue;
                }
                through_armour = true;
                w.rep.outcome = Outcome::Penetrated;
                if entering {
                    inside = true;
                    let inner = if ev.contact.is_some(){measured_exit.unwrap_or(point)}else{point
                        + d * (pl.thickness_mm * 0.001 / eff.to_radians().cos().max(0.2) + 0.02)};
                    let e = energy(speed);
                    if deferred_exit {
                        deferred_surface_spall.insert(traversal_id,DeferredSurfaceSpall::Legacy{pen,energy:e});
                    } else {
                        w.rep.path.push(inner);
                        w.spall(inner, d, shell, pen, e);
                    }
                    if chemical && jet_end.is_none() {
                        jet_end = Some(ev.t + 0.6 + pen / 120.0);
                    }
                }
            }
            EvKind::Module(i) => {
                let m = t.def.modules[i].clone();
                hit_something = true;
                first_point(&mut w, point, None, None, 0.0);
                if he || hesh {
                    // an open vehicle or the running gear: it bursts on the first thing it touches
                    w.rep.path.push(point);
                    let kg = shell.explosive_mass_kg.max(0.01);
                    if inside || !m.is_external() {
                        w.burst_fragments(point, d, speed * 0.3, shell);
                    } else {
                        w.blast_outside_query(point, point - d * 0.001, kg);
                    }
                    w.rep.outcome = if inside {
                        w.rep.outcome
                    } else {
                        Outcome::Blast
                    };
                    alive = false;
                    break;
                }
                if let Some(state) = impact_state.as_mut() {
                    let absorption =
                        absorb_mm(m.kind) as f64 * if w.st.modules[i] > 0.0 { 1.0 } else { 0.5 };
                    let Ok(tr) = impact::deposit_contact_energy(
                        state,
                        absorption,
                        &format!("core/module:{}", m.id),
                    ) else {
                        alive = false;
                        break;
                    };
                    let health_before=w.st.modules[i];
                    let damage =
                        w.hurt_module(i, module_damage(tr.budget.target_deposition_j as f32), 0.8);
                    w.record_primary_destruction(i,health_before,&ev);
                    let (origin, provenance) = core_parent
                        .as_ref()
                        .map(|(origin, parent)| {
                            (*origin, impact_report::outgoing_core_provenance(parent))
                        })
                        .unwrap_or((point, impact_report::core_provenance(&tr)));
                    w.rep.fragments.push(Frag {
                        from: origin,
                        to: point,
                        hit: Some(m.id.clone()),
                        damage,
                        kind: "shell".into(),
                        provenance,
                        budget: Some(tr.budget),
                    });
                    core_parent = Some((point, tr.clone()));
                    w.rep
                        .impact_events
                        .push(impact_report::event(tr, point, point, Vec3::ZERO));
                    pen = state.remaining_pen_mm as f32;
                    speed = state.velocity_m_s.length();
                    if !through_armour && w.rep.outcome == Outcome::Miss {
                        w.rep.outcome = if m.is_external() {
                            Outcome::External
                        } else {
                            Outcome::Unarmoured
                        };
                    }
                    if pen <= 0.0 {
                        w.rep.path.push(point);
                        alive = false;
                        break;
                    }
                    continue;
                }
                let e = energy(speed);
                let dmg = if chemical {
                    if jet_end.is_some() {
                        150.0
                    } else {
                        60.0
                    }
                } else {
                    module_damage(e)
                };
                let health_before=w.st.modules[i];
                let damage = w.hurt_module(i, dmg, 0.8);
                w.record_primary_destruction(i,health_before,&ev);
                w.rep.fragments.push(Frag {
                    from: point,
                    to: point,
                    hit: Some(m.id.clone()),
                    damage,
                    kind: if chemical {
                        "jet".into()
                    } else {
                        "shell".into()
                    },
                    provenance: Default::default(),
                    budget: None,
                });
                if !through_armour && w.rep.outcome == Outcome::Miss {
                    w.rep.outcome = if m.is_external() {
                        Outcome::External
                    } else {
                        Outcome::Unarmoured
                    };
                }
                let a = absorb_mm(m.kind) * if w.st.modules[i] > 0.0 { 1.0 } else { 0.5 };
                let before = pen;
                pen -= a;
                if pen <= 0.0 {
                    w.rep.path.push(point);
                    alive = false;
                    break;
                }
                if kinetic {
                    speed *= (1.0 - (a / before).min(1.0)).max(0.0).sqrt();
                }
            }
            EvKind::Crew(i) => {
                if w.st.crew[i] <= 0.0 {
                    continue;
                }
                hit_something = true;
                first_point(&mut w, point, None, None, 0.0);
                if he || hesh {
                    w.rep.path.push(point);
                    w.burst_fragments(point, d, speed * 0.3, shell);
                    w.rep.outcome = if through_armour {
                        w.rep.outcome
                    } else {
                        Outcome::Unarmoured
                    };
                    alive = false;
                    break;
                }
                if let Some(state) = impact_state.as_mut() {
                    let Ok(tr) = impact::deposit_contact_energy(
                        state,
                        CREW_ABSORB_MM as f64,
                        &format!("core/crew:{i}"),
                    ) else {
                        alive = false;
                        break;
                    };
                    let damage = w.hurt_crew(i, crew_damage(tr.budget.target_deposition_j as f32));
                    let (origin, provenance) = core_parent
                        .as_ref()
                        .map(|(origin, parent)| {
                            (*origin, impact_report::outgoing_core_provenance(parent))
                        })
                        .unwrap_or((point, impact_report::core_provenance(&tr)));
                    w.rep.fragments.push(Frag {
                        from: origin,
                        to: point,
                        hit: Some(format!("crew:{i}")),
                        damage,
                        kind: "shell".into(),
                        provenance,
                        budget: Some(tr.budget),
                    });
                    core_parent = Some((point, tr.clone()));
                    w.rep
                        .impact_events
                        .push(impact_report::event(tr, point, point, Vec3::ZERO));
                    pen = state.remaining_pen_mm as f32;
                    speed = state.velocity_m_s.length();
                    if !through_armour && w.rep.outcome == Outcome::Miss {
                        w.rep.outcome = Outcome::Unarmoured;
                    }
                    if pen <= 0.0 {
                        w.rep.path.push(point);
                        alive = false;
                        break;
                    }
                    continue;
                }
                let e = energy(speed);
                let dmg = if chemical { 160.0 } else { crew_damage(e) };
                let damage = w.hurt_crew(i, dmg);
                w.rep.fragments.push(Frag {
                    from: point,
                    to: point,
                    hit: Some(format!("crew:{}", i)),
                    damage,
                    kind: if chemical {
                        "jet".into()
                    } else {
                        "shell".into()
                    },
                    provenance: Default::default(),
                    budget: None,
                });
                if !through_armour && w.rep.outcome == Outcome::Miss {
                    w.rep.outcome = Outcome::Unarmoured;
                }
                pen -= CREW_ABSORB_MM;
                if pen <= 0.0 {
                    w.rep.path.push(point);
                    alive = false;
                    break;
                }
            }
        }
    }
    if alive && hit_something {
        let end_distance = jet_end.unwrap_or(span).min(span).max(last_t);
        let mut end = start+d*end_distance;
        if let (Some(fuse),Some(state)) = (delayed_fuse.as_ref(),impact_state.as_mut()) {
            let remaining = (fuse.time_s-state.elapsed_s).max(0.0);
            if remaining <= (end_distance-last_t).max(0.0) as f64/(speed as f64).max(1e-12) {
                end=start+d*(last_t+(remaining*speed as f64) as f32);
                if let Some((origin,parent))=&core_parent {
                    if (end-*origin).length()>1e-6 {
                        w.rep.fragments.push(Frag {from:*origin,to:end,hit:None,damage:0.0,
                            kind:"shell".into(),provenance:impact_report::outgoing_core_provenance(parent),budget:None});
                    }
                }
                w.detonate_aphe(end,d,speed,shell,delayed_fuse.take().unwrap(),state,inside);
                alive=false;
            }
        }
        if alive {
            if let Some((origin,parent))=&core_parent {
                if (end-*origin).length()>1e-6 {
                    w.rep.fragments.push(Frag {from:*origin,to:end,hit:None,damage:0.0,
                        kind:"shell".into(),provenance:impact_report::outgoing_core_provenance(parent),budget:None});
                }
            }
            if let Some(state)=impact_state.as_mut() {
                state.advance_time((end_distance-last_t).max(0.0) as f64);
            }
            w.rep.path.push(end);
            if delayed_fuse.is_some() {
                w.rep.events.push("overpenetration".into());
                w.rep.events.push("aphe_armed_exit_continuation_unresolved".into());
            }
        }
    } else if !alive {
        // Stopping the kinetic core does not stop an already-running fuse.
        // Shatter/ricochet/invalid contacts cancel the fuse before reaching here.
        if let (Some(fuse),Some(state))=(delayed_fuse.take(),impact_state.as_mut()) {
            if state.fuse==impact::FuseState::Armed {
                let at=start+d*last_t;
                w.detonate_aphe(at,d,0.0,shell,fuse,state,inside);
            }
        }
    }
    w.rep.impact_state = impact_state;
    w.rep.hit = hit_something;
    finish(&mut w);
    w.rep
}

/// An HE round landing near the vehicle (`at` in hull space): running gear, barrel, open crew.
pub fn splash(t: &Target, st: &TargetState, at: Vec3, explosive_kg: f32, turret_yaw: f32, seed: u64) -> Report {
    let mut w = Work {
        scene:None,
        context:None,
        t,
        p: t.posed(turret_yaw),
        st: st.clone(),
        rng: Rng::new(seed.max(1)),
        explosive_re_factor: 1.0,
        rep: Report {
            geometry_contacts:vec![],primary_geometry_contacts:vec![],primary_module_destructions:vec![],
            cause_transitions:vec![],
            hit: false,
            outcome: Outcome::Blast,
            shell_kind: ProjectileKind::He,
            caliber_mm: 0.0,
            impact: Some(at),
            normal: None,
            plate: None,
            angle_deg: 0.0,
            pen_mm: 0.0,
            layers: vec![],
            path: vec![at],
            ricochet_dir: None,
            bursts: vec![],
            fragments: vec![],
            modules: vec![],
            crew: vec![],
            events: vec![],
            caps: caps(t, st),
            state: st.clone(),
            title: String::new(),
            turret_yaw,
            mechanism_revision: None, impact_events: vec![], impact_state: None,
        },
        mod_dmg: HashMap::new(),
        crew_dmg: HashMap::new(),
        newly_destroyed: vec![],
        newly_killed: vec![],
    };
    w.blast_outside(at, explosive_kg);
    w.rep.hit = !w.mod_dmg.is_empty() || !w.crew_dmg.is_empty();
    finish(&mut w);
    w.rep
}

fn finish(w: &mut Work) {
    let t = w.t;
    let mut ids: Vec<usize> = w.mod_dmg.keys().copied().collect();
    ids.sort();
    for i in ids {
        let m = &t.def.modules[i];
        let destroyed = w.newly_destroyed.contains(&i);
        w.rep.modules.push(ModuleHit { index: i, id: m.id.clone(), kind: m.kind, damage: w.mod_dmg[&i], health: w.st.modules[i].max(0.0), max_health: m.max_health, destroyed });
        if destroyed {
            let ev = match m.kind {
                ModuleKind::Engine => "engine".to_string(),
                ModuleKind::Transmission => "transmission".into(),
                ModuleKind::Track => if t.track_side[i] < 0 { "track_left".into() } else { "track_right".into() },
                ModuleKind::GunBreech => "breech".into(),
                ModuleKind::GunBarrel => "barrel".into(),
                ModuleKind::Launcher => "launcher".into(),
                ModuleKind::MachineGun => "machine_gun".into(),
                ModuleKind::TurretDrive | ModuleKind::HorizontalDrive => "turret_drive".into(),
                ModuleKind::VerticalDrive => "elevation_drive".into(),
                ModuleKind::FuelTank => "fuel_tank".into(),
                ModuleKind::AmmoRack => "ammo_rack".into(),
                ModuleKind::Radio => "radio".into(),
                ModuleKind::ApsGun => "aps_gun".into(),
                ModuleKind::ApsRadar => "aps_radar".into(),
            };
            if !w.rep.events.contains(&ev) {
                w.rep.events.push(ev);
            }
        }
    }
    let mut ids: Vec<usize> = w.crew_dmg.keys().copied().collect();
    ids.sort();
    for i in ids {
        let killed = w.newly_killed.contains(&i);
        w.rep.crew.push(CrewHit { index: i, role: t.def.crew[i].role, damage: w.crew_dmg[&i], health: w.st.crew[i].max(0.0), killed });
        if killed {
            w.rep.events.push(format!("crew_killed:{}", t.def.crew[i].role.as_str()));
        }
    }
    // an engine hit by a destroyed transmission's neighbour etc. is already counted; now the seats
    w.st.swaps.retain(|s| w.st.crew.get(s.crew).map(|h| *h > 0.0).unwrap_or(false));
    let was = w.st.destroyed;
    if !was && check_destroyed(&mut w.st) {
        w.rep.events.push("destroyed".into());
        if let Some(c)=w.context {w.rep.cause_transitions.push(causes::CauseTransition::Death{death_event_id:c.event_id.clone(),mechanism_id:format!("{}:{}",c.event_id,if w.st.ammo_detonated {"ammo"} else {"direct"}),cause_event_id:c.event_id.clone()});}
    }
    plan_swaps(t, &mut w.st);
    w.rep.caps = caps(t, &w.st);
    w.rep.title = title(&w.rep, was);
    w.rep.state = w.st.clone();
}

fn title(r: &Report, was_destroyed: bool) -> String {
    let has = |e: &str| r.events.iter().any(|x| x == e);
    if r.events.iter().any(|e| e == "destroyed") && !was_destroyed {
        return if has("ammo_detonation") { "彈藥殉爆　擊毀".into() } else { "乘員失去戰鬥力　擊毀".into() };
    }
    let killed = r.crew.iter().filter(|c| c.killed).count();
    if killed > 0 {
        return format!("擊傷乘員 {} 名", killed);
    }
    if has("fire") {
        return "起火".into();
    }
    for (e, label) in [("engine", "引擎損毀"), ("transmission", "傳動損毀"), ("breech", "炮閂損毀"), ("barrel", "炮管損毀"), ("track_left", "左履帶斷裂"), ("track_right", "右履帶斷裂"), ("turret_drive", "炮塔驅動損毀"), ("elevation_drive", "俯仰機構損毀")] {
        if has(e) {
            return label.into();
        }
    }
    match r.outcome {
        Outcome::Miss => "未命中".into(),
        Outcome::Ricochet => "跳彈".into(),
        Outcome::Shattered => "彈體碎裂".into(),
        Outcome::Stopped => "未擊穿".into(),
        Outcome::Penetrated => if r.modules.is_empty() && r.crew.is_empty() { "擊穿　無損傷".into() } else { "擊穿".into() },
        Outcome::Overpressure => "超壓擊穿".into(),
        Outcome::Blast => if r.modules.is_empty() && r.crew.is_empty() { "爆炸　未擊穿".into() } else { "爆炸損傷".into() },
        Outcome::External => if r.modules.is_empty() { "命中".into() } else { "外部模組受損".into() },
        Outcome::Unarmoured => "命中".into(),
    }
}

// -------------------------------------------------------------------------- files

/// Builds a target from a vehicle's data files (vehicle.json, armor.json, modules.json, crew.json).
pub fn target_from_files(id: &str, vehicle: &serde_json::Value, plates: Vec<ArmorPlate>, modules: Vec<Module>, crew: Vec<Crew>) -> TargetDef {
    let tv = &vehicle["turret"];
    let v3 = |v: &serde_json::Value| -> Option<Vec3> {
        let a = v.as_array()?;
        Some(Vec3::new(a.first()?.as_f64()? as f32, a.get(1)?.as_f64()? as f32, a.get(2)?.as_f64()? as f32))
    };
    let ring = tv["ring_diameter_m"].as_f64().unwrap_or(0.0);
    let turret = if ring > 0.0 {
        match (v3(&tv["position_m"]), v3(&tv["size_m"])) {
            (Some(pivot), Some(size)) => Some(TurretGeom { pivot, size }),
            _ => None,
        }
    } else {
        None
    };
    TargetDef {surfaces:None, id: id.into(), plates, modules, crew, turret, open_top: tv["open_top"].as_bool().unwrap_or(false), ammo_capacity: 0,
        weapons: serde_json::Value::Null, machine_guns: serde_json::Value::Null, visual: serde_json::Value::Null }
}
