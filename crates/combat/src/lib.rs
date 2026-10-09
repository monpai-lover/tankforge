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
use std::collections::HashMap;
use tg_armor::{ArmorPlate, ArmorZone, Material};
pub use tg_damage::{Crew, CrewRole, Module, ModuleKind};
use tg_shared::{rotate_yaw, Rng, Vec3};
use tg_weapon::{ProjectileDef, ProjectileKind};

#[cfg(test)]
mod tests;

/// Seconds a crew member needs to take over an empty seat (gunner, driver, loader, commander).
pub const SWAP_S: f32 = 5.0;
/// How long a fire burns if nobody puts it out.
pub const FIRE_S: f32 = 25.0;
/// Field repairs: a base time and so much per broken module.
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
    /// Rounds the main guns' racks hold in all (0: unknown, every rack is always full).
    #[serde(default)]
    pub ammo_capacity: u32,
}

#[derive(Clone, Debug)]
pub struct Target {
    pub def: TargetDef,
    materials: HashMap<String, Material>,
    turret_plate: Vec<bool>,
    turret_module: Vec<bool>,
    turret_crew: Vec<bool>,
    /// -1 left, +1 right, 0 not a track.
    pub track_side: Vec<i8>,
    pub lo: Vec3,
    pub hi: Vec3,
}

fn is_turret_zone(p: &ArmorPlate) -> bool {
    if p.hinge.is_some() { return false; } // current foldable walls are fixed to the hull
    matches!(p.zone, ArmorZone::TurretFront | ArmorZone::TurretSide | ArmorZone::TurretRear | ArmorZone::TurretRoof | ArmorZone::GunMantlet)
        || p.id.starts_with("turret")
        || p.id.starts_with("mantlet")
}

impl Target {
    pub fn new(def: TargetDef, materials: &[Material]) -> Target {
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
        let turret_module = def
            .modules
            .iter()
            .map(|m| {
                def.turret.is_some()
                    && match m.kind {
                        ModuleKind::GunBarrel | ModuleKind::GunBreech => true,
                        ModuleKind::VerticalDrive | ModuleKind::TurretDrive | ModuleKind::HorizontalDrive | ModuleKind::AmmoRack | ModuleKind::ApsGun | ModuleKind::ApsRadar => inside_turret(m.center),
                        _ => false,
                    }
            })
            .collect();
        let turret_crew = def.crew.iter().map(|c| matches!(c.role, CrewRole::Commander | CrewRole::Gunner | CrewRole::Loader) && inside_turret(c.pos)).collect();
        let track_side = def.modules.iter().map(|m| if m.kind == ModuleKind::Track { if m.center.x < 0.0 { -1 } else { 1 } } else { 0 }).collect();
        let mut pts: Vec<Vec3> = Vec::new();
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
        Target { def, materials, turret_plate, turret_module, turret_crew, track_side, lo: lo - pad, hi: hi + pad }
    }

    pub fn fresh_state(&self) -> TargetState {
        TargetState {
            modules: self.def.modules.iter().map(|m| m.max_health).collect(),
            crew: self.def.crew.iter().map(|_| 100.0).collect(),
            roles: self.def.crew.iter().map(|c| c.role).collect(),
            extinguishers: 1,
            ..Default::default()
        }
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
                if t && yaw != 0.0 {
                    let (s, c) = yaw.sin_cos();
                    let h = m.half_extents;
                    (turn(m.center), Vec3::new(h.x * c.abs() + h.z * s.abs(), h.y, h.x * s.abs() + h.z * c.abs()))
                } else {
                    (m.center, m.half_extents)
                }
            })
            .collect();
        let crew = self.def.crew.iter().zip(&self.turret_crew).map(|(c, &t)| if t && yaw != 0.0 { turn(c.pos) } else { c.pos }).collect();
        Posed { plates, boxes, crew }
    }
}

struct Posed {
    plates: Vec<ArmorPlate>,
    boxes: Vec<(Vec3, Vec3)>,
    crew: Vec<Vec3>,
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
    #[serde(default)]
    pub extinguishers: u32,
    /// How full each ammo rack is (0..1 by module index, see `rack_fill`); empty: all full.
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
    t.def.modules.get(i).is_some_and(|m| m.kind == ModuleKind::AmmoRack) && st.rack(i) <= 0.0
}

/// How full each ammo rack is (0..1 by module index, 1 for every other module) when the vehicle
/// carries `carried` of its `capacity` rounds. The racks are filled from the bottom up: the floor
/// and lower hull racks hold the last rounds, the turret, sponson and upper racks are the ones a
/// short load leaves empty (War Thunder's rack order). A rack's size is its own `rounds` when the
/// model gives it, its share of the rack volume otherwise.
pub fn rack_fill(def: &TargetDef, carried: u32, capacity: u32) -> Vec<f32> {
    let mut fill = vec![1.0; def.modules.len()];
    let mut racks: Vec<usize> = (0..def.modules.len()).filter(|i| def.modules[*i].kind == ModuleKind::AmmoRack).collect();
    if capacity == 0 || racks.is_empty() || carried >= capacity {
        return fill;
    }
    let size = |i: usize| -> f32 {
        let m = &def.modules[i];
        match m.rounds {
            Some(r) if r > 0 => r as f32,
            _ => (m.half_extents.x * m.half_extents.y * m.half_extents.z).max(1e-4) * 1000.0,
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

/// The vehicle now carries `carried` rounds: which racks hold them (no-op without a capacity).
pub fn load_ammo(t: &Target, st: &mut TargetState, carried: u32) {
    if t.def.ammo_capacity > 0 {
        st.rack_fill = rack_fill(&t.def, carried, t.def.ammo_capacity);
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Caps {
    pub can_move: bool,
    /// 0 engine out, 0.6 damaged, 1 sound.
    pub engine_power: f32,
    pub track_left: bool,
    pub track_right: bool,
    pub can_fire: bool,
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

fn module_ok(t: &Target, st: &TargetState, kind: ModuleKind) -> bool {
    t.def.modules.iter().enumerate().filter(|(_, m)| m.kind == kind).all(|(i, _)| st.modules.get(i).copied().unwrap_or(1.0) > 0.0)
}

fn seat_filled(t: &Target, st: &TargetState, role: CrewRole) -> bool {
    if !t.def.crew.iter().any(|c| c.role == role || c.also.contains(&role)) {
        return true; // the vehicle never had that seat
    }
    // a duty one crew member also carries (the gunner-commander) is done while they live
    st.roles.iter().enumerate().any(|(i, r)| (*r == role || t.def.crew.get(i).is_some_and(|c| c.also.contains(&role))) && st.alive(i))
}

pub fn caps(t: &Target, st: &TargetState) -> Caps {
    let mut engine_power: f32 = 1.0;
    for (i, m) in t.def.modules.iter().enumerate() {
        if m.kind == ModuleKind::Engine {
            let h = st.modules.get(i).copied().unwrap_or(m.max_health);
            engine_power = engine_power.min(if h <= 0.0 { 0.0 } else if h < m.max_health * 0.5 { 0.6 } else { 1.0 });
        }
    }
    let side_ok = |side: i8| t.track_side.iter().enumerate().filter(|(_, s)| **s == side).all(|(i, _)| st.modules.get(i).copied().unwrap_or(1.0) > 0.0);
    let driver = seat_filled(t, st, CrewRole::Driver);
    let gunner = seat_filled(t, st, CrewRole::Gunner);
    let loader = seat_filled(t, st, CrewRole::Loader);
    let commander = seat_filled(t, st, CrewRole::Commander);
    let working = !st.destroyed && st.repair_s <= 0.0;
    let crew_alive = st.crew.iter().filter(|h| **h > 0.0).count() as u32;
    Caps {
        can_move: working && driver && engine_power > 0.0 && module_ok(t, st, ModuleKind::Transmission),
        engine_power,
        track_left: side_ok(-1),
        track_right: side_ok(1),
        can_fire: working && gunner && module_ok(t, st, ModuleKind::GunBreech) && module_ok(t, st, ModuleKind::GunBarrel),
        traverse_mult: if module_ok(t, st, ModuleKind::TurretDrive) && module_ok(t, st, ModuleKind::HorizontalDrive) { 1.0 } else { 0.15 },
        elevate_mult: if module_ok(t, st, ModuleKind::VerticalDrive) { 1.0 } else { 0.3 },
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
    if st.ammo_detonated || (total >= 2 && alive < 2) || (total > 0 && alive == 0) {
        st.destroyed = true;
        st.fire_s = st.fire_s.max(if st.ammo_detonated { 60.0 } else { 0.0 });
        st.repair_s = 0.0;
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
    if st.fire_s > 0.0 {
        st.fire_s = (st.fire_s - dt).max(0.0);
        if !st.destroyed {
            if let Some(at) = st.fire_at {
                for (i, c) in t.def.crew.iter().enumerate() {
                    if st.alive(i) && (c.pos - at).length() < 1.8 {
                        st.crew[i] -= 3.0 * dt;
                        if st.crew[i] <= 0.0 {
                            out.push(format!("crew_burned:{}", c.role.as_str()));
                        }
                    }
                }
                let mut rng = Rng::new(seed);
                for (i, m) in t.def.modules.iter().enumerate() {
                    if (m.center - at).length() < 1.6 && st.modules[i] > 0.0 && !empty_rack(t, st, i) {
                        st.modules[i] -= 2.0 * dt;
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
            for (i, m) in t.def.modules.iter().enumerate() {
                if repairable(m.kind) && st.modules[i] < m.max_health * 0.6 {
                    st.modules[i] = m.max_health * 0.6;
                }
            }
            out.push("repaired".into());
        }
    }
    out
}

fn repairable(k: ModuleKind) -> bool {
    !matches!(k, ModuleKind::AmmoRack)
}

/// Starts a field repair of everything broken; false if there is nothing to do or nobody to do it.
pub fn start_repair(t: &Target, st: &mut TargetState) -> bool {
    if st.destroyed || st.repair_s > 0.0 {
        return false;
    }
    let broken = t.def.modules.iter().enumerate().filter(|(i, m)| repairable(m.kind) && st.modules[*i] <= 0.0).count();
    let alive = st.crew.iter().filter(|h| **h > 0.0).count();
    if broken == 0 || alive < 2 {
        return false;
    }
    let missing = st.crew.len() - alive;
    st.repair_s = REPAIR_BASE_S + REPAIR_PER_MODULE_S * broken as f32 + 2.0 * missing as f32;
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
    pub seed: u64,
    /// Turret yaw against the hull, radians.
    #[serde(default)]
    pub turret_yaw: f32,
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

#[derive(Clone, Debug, Serialize)]
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

#[derive(Clone, Debug, Serialize)]
pub struct Burst {
    pub pos: Vec3,
    pub radius: f32,
    pub inside: bool,
    pub explosive_kg: f32,
}

#[derive(Clone, Debug, Serialize)]
pub struct Frag {
    pub from: Vec3,
    pub to: Vec3,
    pub hit: Option<String>,
    pub damage: f32,
    /// "spall" | "burst" | "jet" | "shell" | "blast"
    pub kind: &'static str,
}

#[derive(Clone, Debug, Serialize)]
pub struct ModuleHit {
    pub index: usize,
    pub id: String,
    pub kind: ModuleKind,
    pub damage: f32,
    pub health: f32,
    pub max_health: f32,
    pub destroyed: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct CrewHit {
    pub index: usize,
    pub role: CrewRole,
    pub damage: f32,
    pub health: f32,
    pub killed: bool,
}

#[derive(Clone, Debug, Serialize)]
pub struct Report {
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

#[derive(Clone, Copy, Debug)]
enum EvKind {
    Plate(usize),
    Module(usize),
    Crew(usize),
}

/// One thing in a shot's or a fragment's way.
#[derive(Clone, Copy, Debug)]
struct Ev {
    t: f32,
    kind: EvKind,
}

/// The work of one shot: the target, its state, and everything recorded along the way.
struct Work<'a> {
    t: &'a Target,
    p: Posed,
    st: TargetState,
    rng: Rng,
    rep: Report,
    mod_dmg: HashMap<usize, f32>,
    crew_dmg: HashMap<usize, f32>,
    newly_destroyed: Vec<usize>,
    newly_killed: Vec<usize>,
}

impl<'a> Work<'a> {
    fn events(&self, o: Vec3, d: Vec3, max_t: f32, plates: bool) -> Vec<Ev> {
        let mut ev = Vec::new();
        if plates {
            for (i, pl) in self.p.plates.iter().enumerate() {
                if let Some(h) = pl.intersect(o, d) {
                    if h.distance <= max_t {
                        ev.push(Ev { t: h.distance, kind: EvKind::Plate(i) });
                    }
                }
            }
        }
        for (i, (c, h)) in self.p.boxes.iter().enumerate() {
            if empty_rack(self.t, &self.st, i) {
                continue;
            }
            if let Some((t0, _)) = ray_box(o, d, *c, *h) {
                if t0 <= max_t {
                    ev.push(Ev { t: t0, kind: EvKind::Module(i) });
                }
            }
        }
        for (i, c) in self.p.crew.iter().enumerate() {
            if let Some(t) = ray_sphere(o, d, *c, self.t.def.crew[i].radius) {
                if t <= max_t {
                    ev.push(Ev { t, kind: EvKind::Crew(i) });
                }
            }
        }
        ev.sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap_or(std::cmp::Ordering::Equal));
        ev
    }

    /// Distance from `o` along `d` to the nearest plate (a fragment inside stops at the armour).
    fn to_armour(&self, o: Vec3, d: Vec3, max_t: f32) -> f32 {
        let mut best = max_t;
        for pl in &self.p.plates {
            if let Some(h) = pl.intersect(o, d) {
                if h.distance > 0.02 && h.distance < best {
                    best = h.distance;
                }
            }
        }
        best
    }

    fn hurt_module(&mut self, i: usize, dmg: f32, ammo_chance: f32) {
        if dmg <= 0.0 || i >= self.st.modules.len() || empty_rack(self.t, &self.st, i) {
            return;
        }
        let was = self.st.modules[i] > 0.0;
        self.st.modules[i] -= dmg;
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
    }

    fn start_fire(&mut self, at: Vec3) {
        if self.st.fire_s <= 0.0 {
            self.rep.events.push("fire".into());
        }
        self.st.fire_s = self.st.fire_s.max(FIRE_S);
        self.st.fire_at = Some(at);
    }

    fn hurt_crew(&mut self, i: usize, dmg: f32) {
        if dmg <= 0.0 || i >= self.st.crew.len() || self.st.crew[i] <= 0.0 {
            return;
        }
        self.st.crew[i] -= dmg;
        *self.crew_dmg.entry(i).or_default() += dmg;
        if self.st.crew[i] <= 0.0 {
            self.st.crew[i] = 0.0;
            self.newly_killed.push(i);
        }
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
                EvKind::Module(i) => {
                    let (c, h) = self.p.boxes[i];
                    !((o.x - c.x).abs() <= h.x && (o.y - c.y).abs() <= h.y && (o.z - c.z).abs() <= h.z)
                }
                EvKind::Crew(i) => (o - self.p.crew[i]).length() > self.t.def.crew[i].radius,
                EvKind::Plate(_) => true,
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
            match ev.kind {
                EvKind::Crew(i) => {
                    if self.st.crew[i] <= 0.0 {
                        continue;
                    }
                    let dmg = crew_damage(e);
                    self.hurt_crew(i, dmg);
                    dealt += dmg;
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
                    self.hurt_module(i, dmg, 0.5);
                    dealt += dmg;
                    hit.get_or_insert_with(|| self.t.def.modules[i].id.clone());
                    end = o + d * ev.t;
                    let a = absorb_mm(kind_m);
                    if pen <= a {
                        e = 0.0;
                    } else {
                        e *= (1.0 - a / pen).powi(2);
                    }
                }
                EvKind::Plate(_) => {}
            }
        }
        if e > 50.0 {
            end = o + d * reach;
        }
        self.rep.fragments.push(Frag { from: o, to: end, hit, damage: dealt, kind });
    }

    /// The blast of a filler inside a compartment: whoever and whatever is close.
    fn blast_inside(&mut self, at: Vec3, kg: f32) {
        let r = blast_radius_m(kg);
        // a bigger charge is deadlier at the same share of its radius
        let power = 150.0 * (kg.max(0.005) / 0.05).powf(0.25);
        for i in 0..self.p.crew.len() {
            let dist = (self.p.crew[i] - at).length();
            if dist < r {
                let k = 1.0 - (dist / r).powi(2);
                self.hurt_crew(i, power * k);
            }
        }
        for i in 0..self.p.boxes.len() {
            let (c, h) = self.p.boxes[i];
            if self.t.def.modules[i].kind.is_external() {
                continue;
            }
            // distance to the box, not to its middle
            let q = Vec3::new((at.x - c.x).abs() - h.x, (at.y - c.y).abs() - h.y, (at.z - c.z).abs() - h.z);
            let dist = Vec3::new(q.x.max(0.0), q.y.max(0.0), q.z.max(0.0)).length();
            if dist < r * 0.8 {
                let k = 1.0 - (dist / (r * 0.8)).powi(2);
                self.hurt_module(i, 70.0 * k, 0.6);
            }
        }
        self.rep.bursts.push(Burst { pos: at, radius: r, inside: true, explosive_kg: kg });
    }

    /// An outside burst: running gear, the barrel, and the crew of an open vehicle.
    fn blast_outside(&mut self, at: Vec3, kg: f32) {
        let r = outside_radius_m(kg);
        let power = (kg / 0.7).powf(0.35);
        for i in 0..self.p.boxes.len() {
            let m = &self.t.def.modules[i];
            if !m.kind.is_external() {
                continue;
            }
            let (c, h) = self.p.boxes[i];
            let q = Vec3::new((at.x - c.x).abs() - h.x, (at.y - c.y).abs() - h.y, (at.z - c.z).abs() - h.z);
            let dist = Vec3::new(q.x.max(0.0), q.y.max(0.0), q.z.max(0.0)).length();
            if dist < r {
                let k = 1.0 - (dist / r).powi(2);
                let dmg = 140.0 * k * power;
                self.hurt_module(i, dmg, 0.0);
                self.rep.fragments.push(Frag { from: at, to: c, hit: Some(m.id.clone()), damage: dmg, kind: "blast" });
            }
        }
        if self.t.def.open_top {
            let top = self.t.def.plates.iter().map(|p| p.center.y).fold(0.0f32, f32::max);
            for i in 0..self.p.crew.len() {
                let c = self.p.crew[i];
                let dist = (c - at).length();
                // an open vehicle: the blast reaches whoever it can see over the sides
                if dist < r * 1.4 && (at.y > c.y - 0.2 || at.y > top - 0.3) {
                    let k = 1.0 - (dist / (r * 1.4)).powi(2);
                    let dmg = 120.0 * k * power;
                    self.hurt_crew(i, dmg);
                    self.rep.fragments.push(Frag { from: at, to: c, hit: Some(format!("crew:{}", i)), damage: dmg, kind: "blast" });
                }
            }
        }
        self.rep.bursts.push(Burst { pos: at, radius: r, inside: false, explosive_kg: kg });
    }

    /// The casing of an APHE / HE round bursting at `at`, moving along `d` at `v` m/s.
    fn burst_fragments(&mut self, at: Vec3, d: Vec3, v: f32, shell: &ProjectileDef) {
        let kg = shell.explosive_mass_kg.max(0.005);
        let casing = (shell.mass_kg * 0.85).max(0.05);
        let ratio = kg / casing;
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
    let shell = &shot.shell;
    let d = shot.dir.normalized();
    let mut w = Work {
        t,
        p: t.posed(shot.turret_yaw),
        st: st.clone(),
        rng: Rng::new(shot.seed.max(1)),
        rep: Report {
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
        },
        mod_dmg: HashMap::new(),
        crew_dmg: HashMap::new(),
        newly_destroyed: vec![],
        newly_killed: vec![],
    };
    // only the part of the line that crosses the vehicle's box
    let Some((t_in, t_out)) = ray_box(shot.origin, d, (t.lo + t.hi) * 0.5, (t.hi - t.lo) * 0.5) else {
        w.rep.title = "未命中".into();
        return w.rep;
    };
    let start = shot.origin + d * (t_in - 0.05).max(0.0);
    let span = t_out - t_in + 0.1;
    let events = w.events(start, d, span, true);
    let roll = 1.0 + 0.05 * gauss(&mut w.rng).clamp(-2.5, 2.5);
    let mut pen = shell.pen_at(shot.distance_m) * roll;
    w.rep.pen_mm = pen;
    let mut speed = shot.speed_ms.max(1.0);
    let core = match shell.kind {
        ProjectileKind::Apcr => 0.35,
        ProjectileKind::Apds => 0.6,
        _ => 1.0,
    };
    let chemical = shell.kind.is_chemical();
    let kinetic = shell.kind.is_kinetic();
    // APHE and every capped round with a filler (APCBC-HE such as the PzGr 39): a delayed burst
    let aphe = kinetic && shell.explosive_mass_kg > 0.0 && !matches!(shell.kind, ProjectileKind::Apcr | ProjectileKind::Apds | ProjectileKind::Apfsds);
    let he = shell.kind == ProjectileKind::He;
    let hesh = shell.kind == ProjectileKind::Hesh;
    let mut touched = false;
    let mut inside = false;
    let mut fuse_at: Option<f32> = None;
    let mut jet_end: Option<f32> = None;
    let mut last_t = 0.0f32;
    let mut alive = true;
    let mut through_armour = false;
    let mut hit_something = false;
    let energy = |speed: f32| 0.5 * shell.mass_kg * core * speed * speed;
    let first_point = |w: &mut Work, p: Vec3, n: Option<Vec3>, plate: Option<String>, angle: f32| {
        if w.rep.impact.is_none() {
            w.rep.impact = Some(p);
            w.rep.normal = n;
            w.rep.plate = plate;
            w.rep.angle_deg = angle;
            w.rep.path.push(p);
        }
    };
    for ev in events {
        if !alive {
            break;
        }
        // the fuse runs out before this
        if let Some(f) = fuse_at {
            if ev.t >= f {
                let at = start + d * f;
                w.rep.path.push(at);
                w.burst_fragments(at, d, speed, shell);
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
        last_t = ev.t;
        let point = start + d * ev.t;
        match ev.kind {
            EvKind::Plate(i) => {
                let pl = w.p.plates[i].clone();
                let Some(h) = pl.intersect(start, d) else { continue };
                let entering = d.dot(pl.normal) < 0.0;
                let first = !touched;
                touched = true;
                hit_something = true;
                first_point(&mut w, point, Some(h.facing_normal), Some(pl.id.clone()), h.incidence_deg);
                let mat = t.material(&pl.material);
                let inc = h.incidence_deg;
                if he || hesh {
                    // contact fuse: it bursts on the plate
                    w.rep.path.push(point);
                    let kg = shell.explosive_mass_kg.max(0.01);
                    // the data's HE penetration when it gives one, else from the filler
                    let rating = if hesh { pen } else if pen > 0.5 { pen.max(he_pen_mm(kg) * 0.8) } else { he_pen_mm(kg) };
                    let inner = point + d * (pl.thickness_mm * 0.001 + 0.03);
                    if pl.zone != ArmorZone::Skirt && rating >= pl.thickness_mm {
                        w.note_layer(i, inc, pl.thickness_mm, pl.thickness_mm, rating, rating - pl.thickness_mm, true, point, entering);
                        // the blast breaks in: a scab of the plate flies inwards, the shock wounds
                        let n = if hesh { 30 } else { 18 };
                        let each = if hesh { 6000.0 * (kg / 1.0).sqrt() } else { 3000.0 * (kg / 0.5).sqrt() };
                        let into = if entering { d } else { -pl.normal };
                        for _ in 0..n {
                            let dir = cone_dir(into, if hesh { 55.0 } else { 60.0 }, &mut w.rng);
                            w.fragment(inner, dir, each, "spall", 4.0);
                        }
                        w.blast_inside(inner, kg * if hesh { 0.4 } else { 0.8 });
                        w.rep.outcome = Outcome::Overpressure;
                    } else {
                        w.note_layer(i, inc, pl.thickness_mm, pl.thickness_mm, rating, 0.0, false, point, entering);
                        w.blast_outside(point - d * 0.05, kg);
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
                let eff = if chemical { inc } else { (inc - shell.normalization_deg).max(0.0) };
                let los = pl.thickness_mm / eff.to_radians().cos().max(0.02);
                let factor = if chemical { mat.chemical_factor } else { mat.kinetic_factor };
                let req = los * factor;
                let overmatch = kinetic && shell.caliber_mm >= 3.0 * pl.thickness_mm;
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
                    if aphe && pl.thickness_mm >= shell.fuse_sensitivity_mm && shell.explosive_mass_kg > 0.0 {
                        w.blast_outside(point - d * 0.05, shell.explosive_mass_kg * 0.5);
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
                    let inner = point + d * (pl.thickness_mm * 0.001 / eff.to_radians().cos().max(0.2) + 0.02);
                    w.rep.path.push(inner);
                    let e = energy(speed);
                    w.spall(inner, d, shell, pen, e);
                    if chemical && jet_end.is_none() {
                        jet_end = Some(ev.t + 0.6 + pen / 120.0);
                    }
                    if aphe && fuse_at.is_none() && shell.explosive_mass_kg > 0.0 && pl.thickness_mm >= shell.fuse_sensitivity_mm {
                        fuse_at = Some(ev.t + (speed * shell.fuse_delay_s).max(0.15));
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
                    if inside || !m.kind.is_external() {
                        w.burst_fragments(point, d, speed * 0.3, shell);
                    } else {
                        w.blast_outside(point, kg);
                    }
                    w.rep.outcome = if inside { w.rep.outcome } else { Outcome::Blast };
                    alive = false;
                    break;
                }
                let e = energy(speed);
                let dmg = if chemical { if jet_end.is_some() { 150.0 } else { 60.0 } } else { module_damage(e) };
                w.hurt_module(i, dmg, 0.8);
                w.rep.fragments.push(Frag { from: point, to: point, hit: Some(m.id.clone()), damage: dmg, kind: if chemical { "jet" } else { "shell" } });
                if !through_armour && w.rep.outcome == Outcome::Miss {
                    w.rep.outcome = if m.kind.is_external() { Outcome::External } else { Outcome::Unarmoured };
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
                    w.rep.outcome = if through_armour { w.rep.outcome } else { Outcome::Unarmoured };
                    alive = false;
                    break;
                }
                let e = energy(speed);
                let dmg = if chemical { 160.0 } else { crew_damage(e).max(60.0) };
                w.hurt_crew(i, dmg);
                w.rep.fragments.push(Frag { from: point, to: point, hit: Some(format!("crew:{}", i)), damage: dmg, kind: if chemical { "jet" } else { "shell" } });
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
        // still going: a fuse inside the box bursts there, otherwise the round has gone out
        let exit_t = span;
        match fuse_at {
            Some(f) if f < exit_t => {
                let at = start + d * f;
                w.rep.path.push(at);
                w.burst_fragments(at, d, speed, shell);
            }
            _ => {
                let end = start + d * jet_end.unwrap_or(exit_t).min(exit_t).max(last_t);
                w.rep.path.push(end);
                if fuse_at.is_some() {
                    w.rep.events.push("overpenetration".into());
                }
            }
        }
    }
    let _ = inside;
    w.rep.hit = hit_something;
    finish(&mut w);
    w.rep
}

/// An HE round landing near the vehicle (`at` in hull space): running gear, barrel, open crew.
pub fn splash(t: &Target, st: &TargetState, at: Vec3, explosive_kg: f32, turret_yaw: f32, seed: u64) -> Report {
    let mut w = Work {
        t,
        p: t.posed(turret_yaw),
        st: st.clone(),
        rng: Rng::new(seed.max(1)),
        rep: Report {
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
    TargetDef { id: id.into(), plates, modules, crew, turret, open_top: tv["open_top"].as_bool().unwrap_or(false), ammo_capacity: 0 }
}
