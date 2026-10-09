//! Content validator. Every rule has a stable code so the editor / admin UI can
//! highlight the offending field and tests can assert on specific failures.
//!
//! Prefixes: L load, T material, J projectile, V vehicle, P plate, M module,
//! C crew, W weapon, G machine gun, E engine/transmission, R terrain (in tg-physics).
use crate::load::*;
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::path::Path;
use tg_armor::{ArmorZone, Material, MaterialDb};
use tg_damage::{CrewRole, ModuleKind};
use crate::files::SightDef;
use tg_weapon::mg::MachineGunDef;
use tg_weapon::{GunDef, ProjectileDef, ProjectileKind};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Severity {
    Error,
    Warning,
}

#[derive(Clone, Debug)]
pub struct Issue {
    pub severity: Severity,
    pub code: &'static str,
    pub path: String,
    pub message: String,
}

impl fmt::Display for Issue {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let tag = if self.severity == Severity::Error { "ERROR" } else { "WARN " };
        write!(f, "[{}] {} {}: {}", tag, self.code, self.path, self.message)
    }
}

#[derive(Clone, Debug, Default)]
pub struct Report {
    pub issues: Vec<Issue>,
}

impl Report {
    pub fn err(&mut self, code: &'static str, path: impl Into<String>, message: impl Into<String>) {
        self.issues.push(Issue { severity: Severity::Error, code, path: path.into(), message: message.into() });
    }
    pub fn warn(&mut self, code: &'static str, path: impl Into<String>, message: impl Into<String>) {
        self.issues.push(Issue { severity: Severity::Warning, code, path: path.into(), message: message.into() });
    }
    pub fn errors(&self) -> usize {
        self.issues.iter().filter(|i| i.severity == Severity::Error).count()
    }
    pub fn warnings(&self) -> usize {
        self.issues.iter().filter(|i| i.severity == Severity::Warning).count()
    }
    pub fn has(&self, code: &str) -> bool {
        self.issues.iter().any(|i| i.code == code)
    }
    pub fn extend(&mut self, other: Report) {
        self.issues.extend(other.issues);
    }
    fn prefixed(mut self, prefix: &str) -> Report {
        for i in &mut self.issues {
            i.path = format!("{}/{}", prefix, i.path);
        }
        self
    }
}

impl fmt::Display for Report {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for i in &self.issues {
            writeln!(f, "{}", i)?;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------- materials

pub fn validate_materials(mats: &[Material]) -> Report {
    let mut r = Report::default();
    let mut seen = HashSet::new();
    for (i, m) in mats.iter().enumerate() {
        let p = format!("materials.json[{}]({})", i, m.id);
        if m.id.is_empty() || !seen.insert(m.id.clone()) {
            r.err("T001", &p, "material id is empty or duplicated");
        }
        if m.density_kg_m3 <= 0.0 {
            r.err("T002", &p, "density must be > 0");
        }
        if m.hardness_bhn <= 0.0 {
            r.err("T003", &p, "hardness must be > 0");
        }
        if m.kinetic_factor <= 0.0 || m.chemical_factor <= 0.0 {
            r.err("T004", &p, "kinetic/chemical factor must be > 0");
        }
        if m.kinetic_factor > 5.0 || m.chemical_factor > 5.0 {
            r.warn("T005", &p, "factor above 5x RHA is suspicious");
        }
    }
    r
}

// -------------------------------------------------------------- projectiles

pub fn validate_projectile(p: &ProjectileDef) -> Report {
    let mut r = Report::default();
    let path = format!("projectile({})", p.id);
    if p.id.is_empty() {
        r.err("J001", &path, "id is empty");
    }
    if p.caliber_mm <= 0.0 || p.mass_kg <= 0.0 || p.muzzle_velocity_ms <= 0.0 || p.length_mm <= 0.0 {
        r.err("J002", &path, "caliber, mass, muzzle velocity and length must be > 0");
    }
    if p.drag_coefficient < 0.0 || p.drag_coefficient > 2.0 {
        r.err("J003", &path, "drag coefficient outside 0..2");
    }
    if p.penetration_curve.is_empty() {
        r.err("J004", &path, "penetration_curve is empty");
    } else {
        for w in p.penetration_curve.windows(2) {
            if w[1].distance_m <= w[0].distance_m {
                r.err("J005", &path, "penetration_curve distances must be strictly ascending");
                break;
            }
        }
        if p.penetration_curve.iter().any(|c| c.pen_mm < 0.0 || c.distance_m < 0.0) {
            r.err("J006", &path, "penetration_curve has negative values");
        }
        if p.penetration_curve.windows(2).any(|w| w[1].pen_mm > w[0].pen_mm + 1e-3) && p.kind.is_kinetic() {
            r.warn("J007", &path, "kinetic penetration increases with distance");
        }
    }
    if p.ricochet_angle_deg <= 0.0 || p.ricochet_angle_deg > 90.0 {
        r.err("J008", &path, "ricochet_angle_deg must be in (0, 90]");
    }
    if p.normalization_deg < 0.0 || p.normalization_deg > 45.0 {
        r.err("J009", &path, "normalization_deg must be in [0, 45]");
    }
    if p.normalization_deg > 0.0 && p.kind.is_chemical() {
        r.warn("J010", &path, "chemical rounds do not use normalization");
    }
    let needs_filler = matches!(p.kind, ProjectileKind::Aphe | ProjectileKind::He | ProjectileKind::Heat | ProjectileKind::HeatFs | ProjectileKind::Hesh);
    if needs_filler && p.explosive_mass_kg <= 0.0 {
        r.warn("J011", &path, "this projectile kind normally carries an explosive filler");
    }
    if p.explosive_mass_kg * 2.0 > p.mass_kg {
        r.err("J012", &path, "explosive mass exceeds half of projectile mass");
    }
    r
}

// ------------------------------------------------------------------ vehicle

type Aabb = ([f32; 3], [f32; 3]);

/// Armoured volume of the vehicle: the hull box plus every turret box (authored at yaw 0).
struct Volume {
    boxes: Vec<Aabb>,
}

impl Volume {
    fn turret_box(pos: [f32; 3], size: [f32; 3]) -> Aabb {
        ([pos[0] - size[0] / 2.0, pos[1], pos[2] - size[2] / 2.0], [pos[0] + size[0] / 2.0, pos[1] + size[1], pos[2] + size[2] / 2.0])
    }
    fn of(v: &LoadedVehicle) -> Volume {
        let (h, t) = (&v.def.hull, &v.def.turret);
        let mut boxes = vec![
            ([-h.size_m[0] / 2.0, 0.0, -h.size_m[2] / 2.0], [h.size_m[0] / 2.0, h.size_m[1], h.size_m[2] / 2.0]),
            Self::turret_box(t.position_m, t.size_m),
        ];
        for x in &v.weapons.extra_turrets {
            boxes.push(Self::turret_box(x.position_m, x.size_m));
        }
        Volume { boxes }
    }
    fn contains(&self, p: [f32; 3], m: f32) -> bool {
        self.boxes.iter().any(|b| (0..3).all(|i| p[i] >= b.0[i] - m && p[i] <= b.1[i] + m))
    }
}

fn check_gun(r: &mut Report, path: &str, g: &GunDef, mount: [f32; 3], muzzle_offset: f32, vol: &Volume, shells: &HashMap<String, ProjectileDef>) {
    if g.caliber_mm <= 0.0 || g.reload_s <= 0.0 || g.traverse_deg_s <= 0.0 || g.elevate_deg_s <= 0.0 || g.rounds_per_min <= 0.0 {
        r.err("W003", path, "caliber, reload, rates must be > 0");
    }
    // a negative depression is a mount that cannot come down to the horizon (a rocket rail that
    // starts at +9 degrees): its lowest elevation is -max_depression_deg
    if g.max_depression_deg < -60.0 || g.max_depression_deg > 30.0 || g.max_elevation_deg <= 0.0 || g.max_elevation_deg > 90.0 || -g.max_depression_deg >= g.max_elevation_deg {
        r.err("W004", path, "depression must be in [-60,30] (below the elevation) and elevation in (0,90]");
    }
    if g.ammo.is_empty() {
        r.err("W005", path, "gun has no ammunition types");
    }
    if !g.ammo_count.is_empty() && g.ammo_count.len() != g.ammo.len() {
        r.err("W005", path, "ammo_count must give one count per ammo type");
    }
    for a in &g.ammo {
        match shells.get(a) {
            None => r.err("W001", path, format!("unknown projectile '{}'", a)),
            Some(p) if (p.caliber_mm - g.caliber_mm).abs() > 1.0 && p.kind != ProjectileKind::Apds && p.kind != ProjectileKind::Apcr && p.kind != ProjectileKind::Apfsds => {
                r.err("W002", path, format!("projectile '{}' caliber {} != gun caliber {}", a, p.caliber_mm, g.caliber_mm));
            }
            _ => {}
        }
    }
    if g.rounds_per_min > 0.0 && g.reload_s > 0.0 && ((60.0 / g.rounds_per_min) - g.reload_s).abs() / g.reload_s > 0.25 {
        r.warn("W008", path, "rounds_per_min and reload_s disagree by more than 25% (reload_s is the one used)");
    }
    if muzzle_offset <= 0.0 || muzzle_offset > g.barrel_length_mm * 0.001 + 0.5 {
        r.err("W010", path, "muzzle offset must be > 0 and not longer than the barrel");
    }
    if !vol.contains(mount, 0.5) {
        r.err("W006", path, "gun mount is far outside its turret");
    }
}

fn check_sight(r: &mut Report, path: &str, sight: &SightDef) {
    if sight.levels.is_empty() {
        r.err("W009", path, "sight needs at least one zoom level");
    }
    if sight.levels.iter().any(|l| l.magnification < 1.0 || l.magnification > 40.0 || l.fov_deg <= 0.0 || l.fov_deg > 90.0) {
        r.err("W009", path, "magnification must be in [1,40] and fov_deg in (0,90]");
    }
    if sight.levels.windows(2).any(|w| w[1].magnification <= w[0].magnification) {
        r.err("W009", path, "zoom levels must be in ascending magnification");
    }
    if let Some(rf) = &sight.rangefinder {
        if rf.time_s <= 0.0 || rf.error_pct < 0.0 || rf.error_pct > 50.0 || rf.max_range_m <= 0.0 {
            r.err("W009", path, "rangefinder needs time_s > 0, error_pct in [0,50] and max_range_m > 0");
        }
    }
}

/// Loader stations and ammo racks referenced by the reload model must be inside the vehicle.
fn check_stations(r: &mut Report, path: &str, loaders: &[[f32; 3]], rack: Option<[f32; 3]>, vol: &Volume) {
    if loaders.iter().any(|p| !vol.contains(*p, 0.1)) || rack.map_or(false, |p| !vol.contains(p, 0.1)) {
        r.err("W012", path, "loader station or ammo rack is outside the hull/turret volume");
    }
}

fn check_arc(r: &mut Report, path: &str, facing_deg: f32, limit: Option<[f32; 2]>) {
    let bad_limit = limit.map_or(false, |l| !(l[0] < l[1]) || l[0] < -180.0 || l[1] > 180.0);
    if !(-180.0..=180.0).contains(&facing_deg) || bad_limit {
        r.err("W013", path, "facing_deg must be in [-180,180] and yaw_limit_deg must be [min,max] with min < max inside [-180,180]");
    }
}

fn zone_matches(zone: ArmorZone, n: tg_shared::Vec3) -> bool {
    use ArmorZone::*;
    match zone {
        HullUpperFront | HullLowerFront | TurretFront | GunMantlet => n.z >= 0.3,
        HullRear | TurretRear => n.z <= -0.3,
        HullSide | TurretSide | Skirt => n.x.abs() >= 0.5,
        HullRoof | TurretRoof => n.y >= 0.5,
        HullFloor => n.y <= -0.5,
        Other => true,
    }
}

fn overlap(a: &tg_damage::Module, b: &tg_damage::Module) -> bool {
    let (ac, ah, bc, bh) = (a.center.to_array(), a.half_extents.to_array(), b.center.to_array(), b.half_extents.to_array());
    (0..3).all(|i| ac[i] - ah[i] < bc[i] + bh[i] && bc[i] - bh[i] < ac[i] + ah[i])
}

pub fn validate_vehicle(v: &LoadedVehicle, mats: &MaterialDb, shells: &HashMap<String, ProjectileDef>) -> Report {
    let mut r = Report::default();
    let d = &v.def;
    let vol = Volume::of(v);

    // ---- identity & body
    if d.id.is_empty() || !d.id.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_') {
        r.err("V001", "vehicle.json:id", "id must be non-empty [a-z0-9_]");
    }
    if d.schema_version != 1 {
        r.err("V002", "vehicle.json:schema_version", format!("unsupported schema_version {}", d.schema_version));
    }
    if d.hull.size_m.iter().chain(d.turret.size_m.iter()).any(|x| *x <= 0.0) {
        r.err("V003", "vehicle.json:hull/turret.size_m", "all dimensions must be > 0");
    }
    if d.hull.mass_kg <= 0.0 {
        r.err("V004", "vehicle.json:hull.mass_kg", "mass must be > 0");
    }
    let com = d.hull.center_of_mass;
    let h = d.hull.size_m;
    if com[0].abs() > h[0] / 2.0 || com[2].abs() > h[2] / 2.0 || com[1] < 0.0 || com[1] > h[1] {
        r.err("V005", "vehicle.json:hull.center_of_mass", "centre of mass is outside the hull box");
    }
    let ring = d.turret.ring_diameter_m;
    if ring <= 0.0 || ring > d.turret.size_m[0].min(d.turret.size_m[2]) {
        r.err("V006", "vehicle.json:turret.ring_diameter_m", "ring must be > 0 and fit inside the turret footprint");
    }
    if ring > h[0] {
        r.warn("V007", "vehicle.json:turret.ring_diameter_m", "ring is wider than the hull");
    }
    let ph = &d.physics;
    if ph.track_width_m <= 0.0 || ph.track_length_m <= 0.0 {
        r.err("V008", "vehicle.json:physics", "track width/length must be > 0");
    } else {
        if 2.0 * ph.track_width_m > h[0] {
            r.warn("V009", "vehicle.json:physics.track_width_m", "both tracks are wider than the hull");
        }
        let kpa = d.hull.mass_kg * 9.81 / (2.0 * ph.track_width_m * ph.track_length_m) / 1000.0;
        if !(10.0..=200.0).contains(&kpa) {
            r.warn("V010", "vehicle.json:physics", format!("ground pressure {:.0} kPa looks unrealistic", kpa));
        }
    }
    if ph.sprocket_radius_m <= 0.0 || ph.drivetrain_efficiency <= 0.0 || ph.drivetrain_efficiency > 1.0
        || ph.max_brake_decel_ms2 <= 0.0 || ph.max_turn_rate_deg_s <= 0.0 || ph.max_reverse_speed_ms <= 0.0
        || ph.min_turn_radius_m < 0.0
    {
        r.err("V014", "vehicle.json:physics", "sprocket radius, brake, turn rate, reverse speed must be > 0, efficiency in (0,1], min_turn_radius >= 0");
    }
    if d.hull.mass_kg > 0.0 {
        let hp_per_t = v.engine.engine.horsepower / (d.hull.mass_kg / 1000.0);
        if !(5.0..=60.0).contains(&hp_per_t) {
            r.warn("V011", "engine.json", format!("power-to-weight {:.1} hp/t looks unrealistic", hp_per_t));
        }
    }
    let has_model = v.dir.join(&d.model).is_file();
    match (&d.files.visual, &v.visual) {
        (Some(name), None) => r.err("V015", "vehicle.json:files.visual", format!("visual file '{}' not found", name)),
        (Some(_), Some(vis)) => {
            if vis.get("schema_version").and_then(|x| x.as_u64()) != Some(1) || !vis.get("parts").map_or(false, |p| p.is_array()) {
                r.err("V016", "visual.json", "need schema_version 1 and a 'parts' array");
            }
        }
        (None, _) => {
            if !has_model {
                r.warn("V012", "vehicle.json:model", format!("no exterior: model file '{}' not found and no visual file", d.model));
            }
        }
    }

    // ---- armor
    let mut seen = HashSet::new();
    for (i, p) in v.plates.iter().enumerate() {
        let path = format!("armor.json[{}]({})", i, p.id);
        if !seen.insert(p.id.clone()) {
            r.err("P005", &path, "duplicate plate id");
        }
        if mats.get(&p.material).is_none() {
            r.err("P001", &path, format!("unknown material '{}'", p.material));
        }
        if !(p.thickness_mm > 0.0 && p.thickness_mm <= 1000.0) {
            r.err("P002", &path, "thickness_mm must be in (0, 1000]");
        }
        if (p.normal.length() - 1.0).abs() > 0.01 || (p.axis_u.length() - 1.0).abs() > 0.01 {
            r.err("P003", &path, "normal and axis_u must be unit vectors");
        } else if p.normal.dot(p.axis_u).abs() > 0.01 {
            r.err("P004", &path, "axis_u must be perpendicular to normal");
        } else if !zone_matches(p.zone, p.normal) {
            r.warn("P006", &path, format!("normal does not match zone {:?} (forward=+Z, side=±X, up=+Y)", p.zone));
        }
        if p.half_u <= 0.0 || p.half_v <= 0.0 {
            r.err("P007", &path, "half_u / half_v must be > 0");
        }
        if !vol.contains(p.center.to_array(), 0.1) {
            r.err("P008", &path, "plate centre lies outside the hull/turret volume");
        }
    }
    if v.plates.is_empty() {
        r.err("P009", "armor.json", "vehicle has no armor plates");
    }

    // ---- modules
    let mut seen = HashSet::new();
    for (i, m) in v.modules.iter().enumerate() {
        let path = format!("modules.json[{}]({})", i, m.id);
        if m.id.is_empty() || !seen.insert(m.id.clone()) {
            r.err("M001", &path, "module id empty or duplicated");
        }
        if m.max_health <= 0.0 || m.health <= 0.0 || m.health > m.max_health {
            r.err("M002", &path, "need 0 < health <= max_health");
        }
        let he = m.half_extents.to_array();
        if he.iter().any(|x| *x <= 0.0) {
            r.err("M003", &path, "half_extents must be > 0");
        }
        let c = m.center.to_array();
        let all_in = (0..8).all(|k| {
            let s = |bit: usize, i: usize| if (k >> bit) & 1 == 1 { c[i] + he[i] } else { c[i] - he[i] };
            vol.contains([s(0, 0), s(1, 1), s(2, 2)], 0.05)
        });
        if m.kind.is_external() {
            // barrel / tracks live outside the armoured volume; only sanity-check the distance
            if c.iter().any(|x| x.abs() > 12.0) {
                r.err("M004", &path, "external module is implausibly far from the vehicle");
            }
        } else if !all_in {
            r.err("M004", &path, "module box sticks out of the hull/turret volume");
        }
    }
    let has = |k: ModuleKind| v.modules.iter().any(|m| m.kind == k);
    for (k, name) in [(ModuleKind::Engine, "engine"), (ModuleKind::GunBreech, "gun_breech")] {
        if !has(k) {
            r.err("M005", "modules.json", format!("required module '{}' is missing", name));
        }
    }
    for (k, name) in [(ModuleKind::Transmission, "transmission"), (ModuleKind::FuelTank, "fuel_tank"), (ModuleKind::AmmoRack, "ammo_rack"), (ModuleKind::GunBarrel, "gun_barrel")] {
        if !has(k) {
            r.warn("M007", "modules.json", format!("module '{}' is missing; its failure modes cannot occur", name));
        }
    }
    // an imported damage model's modules are boxes round real meshes that interlock (a breech
    // round its elevating gear, an engine against its gearbox): their overlap is no data error
    let imported = v.def.meta.as_ref().is_some_and(|m| m.outline == "model");
    for i in 0..v.modules.len() {
        for j in (i + 1)..v.modules.len() {
            if imported || v.modules[i].kind.is_external() || v.modules[j].kind.is_external() {
                continue;
            }
            if overlap(&v.modules[i], &v.modules[j]) {
                r.warn("M006", "modules.json", format!("modules '{}' and '{}' overlap", v.modules[i].id, v.modules[j].id));
            }
        }
    }

    // ---- crew
    if v.crew.is_empty() {
        r.err("C001", "crew.json", "vehicle has no crew");
    }
    for (i, c) in v.crew.iter().enumerate() {
        let path = format!("crew.json[{}]({:?})", i, c.role);
        if c.radius <= 0.0 || c.health <= 0.0 {
            r.err("C002", &path, "radius and health must be > 0");
        }
        if !vol.contains(c.pos.to_array(), 0.05) {
            r.err("C003", &path, "crew position is outside the hull/turret volume");
        }
    }
    // a small gun (50 mm and under) was loaded by the commander or the gunner: no loader is needed
    let small_gun = v.weapons.main_gun.caliber_mm <= 50.0;
    for (role, name) in [(CrewRole::Commander, "commander"), (CrewRole::Gunner, "gunner"), (CrewRole::Loader, "loader"), (CrewRole::Driver, "driver")] {
        if role == CrewRole::Loader && small_gun {
            continue;
        }
        if !v.crew.iter().any(|c| c.role == role || c.also.contains(&role)) {
            r.warn("C004", "crew.json", format!("no {}: that role's penalties are ignored for this vehicle", name));
        }
    }

    // ---- weapons: primary turret, then extra guns and extra turrets under the same rules
    let w = &v.weapons;
    check_gun(&mut r, "weapons.json:main_gun", &w.main_gun, w.mount_m, w.muzzle_offset(), &vol, shells);
    if let Some(sight) = &w.sight {
        check_sight(&mut r, "weapons.json:sight", sight);
    }
    check_stations(&mut r, "weapons.json", &w.loaders_m, w.rack_m, &vol);
    check_arc(&mut r, "weapons.json", w.facing_deg, w.yaw_limit_deg);
    if !w.depression_by_bearing_deg.is_empty() && (w.depression_by_bearing_deg.len() != 36 || w.depression_by_bearing_deg.iter().any(|d| !d.is_finite() || *d < -10.0 || *d > 90.0)) {
        r.err("W011", "weapons.json", "depression_by_bearing_deg needs 36 values (every 10 degrees) in -10..90");
    }
    for (i, gm) in w.extra_guns.iter().enumerate() {
        let path = format!("weapons.json:extra_guns[{}]", i);
        check_gun(&mut r, &path, &gm.gun, gm.mount_m, gm.muzzle_offset(), &vol, shells);
        check_stations(&mut r, &path, &[], gm.rack_m, &vol);
    }
    let mut turret_ids = HashSet::new();
    for (i, t) in w.extra_turrets.iter().enumerate() {
        let path = format!("weapons.json:extra_turrets[{}]({})", i, t.id);
        if t.id.is_empty() || t.id == "main" || !turret_ids.insert(t.id.clone()) {
            r.err("W011", &path, "turret id is empty, duplicated or 'main'");
        }
        if t.size_m.iter().any(|x| *x <= 0.0) || t.ring_diameter_m <= 0.0 || t.ring_diameter_m > t.size_m[0].min(t.size_m[2]) || t.traverse_deg_s <= 0.0 {
            r.err("W011", &path, "size, ring and traverse must be > 0 and the ring must fit the turret footprint");
        }
        if t.guns.is_empty() {
            r.err("W011", &path, "turret has no guns");
        }
        check_arc(&mut r, &path, t.facing_deg, t.yaw_limit_deg);
        // a turret rides on the main one or on an extra one listed before it
        if t.parent.is_some_and(|p| p > i) {
            r.err("W011", &path, "parent must be 0 (the main turret) or an extra turret listed before this one");
        }
        if !t.depression_by_bearing_deg.is_empty() && (t.depression_by_bearing_deg.len() != 36 || t.depression_by_bearing_deg.iter().any(|d| !d.is_finite() || *d < -10.0 || *d > 90.0)) {
            r.err("W011", &path, "depression_by_bearing_deg needs 36 values (every 10 degrees) in -10..90");
        }
        if let Some(sight) = &t.sight {
            check_sight(&mut r, &path, sight);
        }
        check_stations(&mut r, &path, &t.loaders_m, None, &vol);
        for (j, gm) in t.guns.iter().enumerate() {
            let gp = format!("{}.guns[{}]", path, j);
            check_gun(&mut r, &gp, &gm.gun, gm.mount_m, gm.muzzle_offset(), &vol, shells);
            check_stations(&mut r, &gp, &[], gm.rack_m, &vol);
        }
    }
    for (i, s) in v.weapons.secondary.iter().enumerate() {
        if !vol.contains(s.position_m, 0.5) {
            r.err("W007", format!("weapons.json:secondary[{}]", i), "secondary weapon is far outside the vehicle");
        }
    }

    // ---- engine / transmission
    let e = &v.engine.engine;
    let t = &v.engine.transmission;
    if e.horsepower <= 0.0 || e.weight_kg <= 0.0 {
        r.err("E105", "engine.json:engine", "horsepower and weight must be > 0");
    }
    if e.idle_rpm <= 0.0 || e.idle_rpm >= e.max_rpm {
        r.err("E102", "engine.json:engine", "need 0 < idle_rpm < max_rpm");
    }
    if e.horsepower > 0.0 && e.torque_curve.len() >= 2 {
        let peak_hp = e.torque_curve.iter().map(|p| p[1] * p[0] * std::f32::consts::TAU / 60.0 / 745.7).fold(0.0f32, f32::max);
        if (peak_hp - e.horsepower).abs() / e.horsepower > 0.25 {
            r.warn("E109", "engine.json", format!("torque curve peaks at {:.0} hp but horsepower says {:.0}", peak_hp, e.horsepower));
        }
    }
    if e.torque_curve.len() < 2 {
        r.err("E101", "engine.json:torque_curve", "need at least 2 points");
    } else {
        if e.torque_curve.windows(2).any(|w| w[1][0] <= w[0][0]) {
            r.err("E101", "engine.json:torque_curve", "rpm must be strictly ascending");
        }
        if e.torque_curve.iter().any(|p| p[1] <= 0.0 || p[0] < 0.0 || p[0] > e.max_rpm * 1.01) {
            r.err("E106", "engine.json:torque_curve", "torque must be > 0 and rpm within 0..max_rpm");
        }
    }
    if t.forward_gears == 0 || t.gear_ratios.len() != t.forward_gears as usize {
        r.err("E103", "engine.json:transmission", "gear_ratios length must equal forward_gears (>= 1)");
    } else if t.gear_ratios.windows(2).any(|w| w[1] >= w[0]) || t.gear_ratios.iter().any(|g| *g <= 0.0) {
        r.err("E107", "engine.json:transmission.gear_ratios", "ratios must be > 0 and strictly descending");
    }
    if t.final_drive_ratio <= 0.0 {
        r.err("E104", "engine.json:transmission", "final_drive_ratio must be > 0");
    }
    if !(0.0..=3.0).contains(&t.shift_time_s) {
        r.err("E110", "engine.json:transmission.shift_time_s", "shift time must be in [0, 3] s");
    }
    if t.reverse_gears == 0 {
        r.warn("E108", "engine.json:transmission", "vehicle has no reverse gear");
    }
    r
}

/// Content rules for machine_guns.json (codes G001..G003).
pub fn validate_machine_guns(list: &[MachineGunDef]) -> Report {
    let mut r = Report::default();
    let mut seen = HashSet::new();
    for (i, m) in list.iter().enumerate() {
        let path = format!("machine_guns.json[{}]({})", i, m.id);
        if m.id.is_empty() || !seen.insert(m.id.clone()) {
            r.err("G001", path.clone(), "machine gun id is empty or duplicated");
        }
        let ok = m.caliber_mm > 0.0 && m.caliber_mm <= 20.0 && m.rate_rpm > 0.0 && m.rate_rpm <= 2000.0
            && m.muzzle_velocity_ms > 0.0 && m.bullet_mass_g > 0.0 && m.drag_coefficient > 0.0
            && m.belt_rounds > 0 && m.reload_s > 0.0 && m.dispersion_mrad >= 0.0;
        if !ok {
            r.err("G002", path.clone(), "caliber (0,20], rate (0,2000], velocity, bullet mass, drag, belt and reload must be > 0");
        }
        if m.heat_rounds <= 0.0 || m.cool_s <= 0.0 {
            r.err("G003", path, "heat_rounds and cool_s must be > 0");
        }
    }
    r
}

/// Secondary weapons of one vehicle against the machine-gun catalogue (codes W014, W015).
/// Kept apart from [`validate_vehicle`] so that a vehicle can be checked without the catalogue.
pub fn validate_secondaries(v: &LoadedVehicle, guns: &HashMap<String, MachineGunDef>) -> Report {
    let mut r = Report::default();
    for (i, s) in v.weapons.secondary.iter().enumerate() {
        let path = format!("weapons.json:secondary[{}]({})", i, s.id);
        match (&s.weapon, s.mount) {
            (Some(w), Some(_)) => {
                if !guns.contains_key(w) {
                    r.err("W014", path.clone(), format!("unknown machine gun '{}'", w));
                }
            }
            (None, None) => {}
            _ => r.err("W015", path.clone(), "weapon and mount must be given together"),
        }
        if let Some(a) = s.arc_deg {
            if !(a[0] > 0.0 && a[0] <= 180.0 && (0.0..=90.0).contains(&a[1]) && (0.0..=90.0).contains(&a[2])) {
                r.err("W015", path, "arc_deg must be [yaw half-angle (0,180], depression [0,90], elevation [0,90]]");
            }
        }
    }
    r
}

/// Validates a whole `data/` tree: materials, projectiles, machine guns, every vehicle folder.
pub fn validate_tree(root: &Path) -> Report {
    let mut r = Report::default();

    let mats = match load_materials(&root.join("materials.json")) {
        Ok(m) => m,
        Err(e) => {
            r.err("L001", "materials.json", e.to_string());
            return r;
        }
    };
    r.extend(validate_materials(&mats));
    let db = MaterialDb::from_vec(mats);

    let mut shells = HashMap::new();
    match load_projectiles(&root.join("projectiles")) {
        Ok(list) => {
            for (path, p) in list {
                r.extend(validate_projectile(&p));
                if shells.insert(p.id.clone(), p).is_some() {
                    r.err("J013", path.display().to_string(), "duplicate projectile id");
                }
            }
        }
        Err(e) => {
            r.err("L002", "projectiles/", e.to_string());
            return r;
        }
    }

    let mut guns = HashMap::new();
    match load_machine_guns(&root.join("machine_guns.json")) {
        Ok(list) => {
            r.extend(validate_machine_guns(&list));
            for g in list {
                guns.insert(g.id.clone(), g);
            }
        }
        Err(e) => r.err("L006", "machine_guns.json", e.to_string()),
    }

    match vehicle_dirs(&root.join("vehicles")) {
        Ok(dirs) => {
            for dir in dirs {
                let name = dir.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                match load_vehicle(&dir) {
                    Ok(v) => {
                        if v.def.id != name {
                            r.err("V013", format!("vehicles/{}", name), format!("folder name must equal vehicle id '{}'", v.def.id));
                        }
                        r.extend(validate_vehicle(&v, &db, &shells).prefixed(&format!("vehicles/{}", name)));
                        r.extend(validate_secondaries(&v, &guns).prefixed(&format!("vehicles/{}", name)));
                    }
                    Err(e) => r.err("L003", format!("vehicles/{}", name), e.to_string()),
                }
            }
        }
        Err(e) => r.err("L004", "vehicles/", e.to_string()),
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn data_root() -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")
    }

    fn fixtures() -> (LoadedVehicle, MaterialDb, HashMap<String, ProjectileDef>) {
        let root = data_root();
        let db = MaterialDb::from_vec(load_materials(&root.join("materials.json")).unwrap());
        let shells = load_projectiles(&root.join("projectiles")).unwrap().into_iter().map(|(_, p)| (p.id.clone(), p)).collect();
        (load_vehicle(&root.join("vehicles/proto_a")).unwrap(), db, shells)
    }

    #[test]
    fn shipped_sample_data_is_clean() {
        // Every shipped vehicle, shell and material must pass with no errors and no warnings.
        let r = validate_tree(&data_root());
        assert!(r.issues.is_empty(), "\n{}", r);
    }

    #[test]
    fn unknown_material_and_bad_thickness() {
        let (mut v, db, s) = fixtures();
        v.plates[0].material = "unobtainium".into();
        v.plates[1].thickness_mm = 0.0;
        let r = validate_vehicle(&v, &db, &s);
        assert!(r.has("P001") && r.has("P002"));
    }

    #[test]
    fn zone_normal_mismatch_is_flagged() {
        let (mut v, db, s) = fixtures();
        v.plates[0].zone = tg_armor::ArmorZone::HullRoof;
        assert!(validate_vehicle(&v, &db, &s).has("P006"));
    }

    #[test]
    fn non_unit_or_skewed_axes_are_errors() {
        let (mut v, db, s) = fixtures();
        v.plates[0].normal = tg_shared::Vec3::new(2.0, 0.0, 0.0);
        v.plates[1].axis_u = v.plates[1].normal;
        let r = validate_vehicle(&v, &db, &s);
        assert!(r.has("P003") && r.has("P004"));
    }

    #[test]
    fn module_and_crew_outside_volume() {
        let (mut v, db, s) = fixtures();
        v.modules[0].center.x = 9.0;
        v.crew[0].pos.y = 7.0;
        let r = validate_vehicle(&v, &db, &s);
        assert!(r.has("M004") && r.has("C003"));
    }

    #[test]
    fn required_modules_and_roles() {
        let (mut v, db, s) = fixtures();
        v.modules.retain(|m| m.kind != ModuleKind::Engine);
        v.crew.retain(|c| c.role != CrewRole::Gunner);
        let r = validate_vehicle(&v, &db, &s);
        assert!(r.has("M005") && r.has("C004"));
    }

    #[test]
    fn ammo_must_exist_and_match_caliber() {
        let (mut v, db, mut s) = fixtures();
        v.weapons.main_gun.ammo.push("ghost_round".into());
        assert!(validate_vehicle(&v, &db, &s).has("W001"));
        v.weapons.main_gun.ammo = vec!["ap_75_generic".into()];
        s.get_mut("ap_75_generic").unwrap().caliber_mm = 88.0;
        assert!(validate_vehicle(&v, &db, &s).has("W002"));
    }

    #[test]
    fn engine_and_gearbox_rules() {
        let (mut v, db, s) = fixtures();
        v.engine.transmission.forward_gears = 4;
        v.engine.engine.torque_curve = vec![[2000.0, 100.0], [1000.0, 100.0]];
        v.engine.engine.horsepower = 50_000.0;
        let r = validate_vehicle(&v, &db, &s);
        assert!(r.has("E103") && r.has("E101") && r.has("V011"));
    }

    #[test]
    fn physics_tuning_and_power_consistency() {
        let (mut v, db, s) = fixtures();
        v.def.physics.drivetrain_efficiency = 1.5;
        v.engine.engine.horsepower = 1500.0;
        let r = validate_vehicle(&v, &db, &s);
        assert!(r.has("V014") && r.has("E109"));
    }

    #[test]
    fn external_modules_may_sit_outside_but_internal_ones_may_not() {
        let root = data_root();
        let db = MaterialDb::from_vec(load_materials(&root.join("materials.json")).unwrap());
        let shells: HashMap<String, ProjectileDef> =
            load_projectiles(&root.join("projectiles")).unwrap().into_iter().map(|(_, p)| (p.id.clone(), p)).collect();
        let mut v = load_vehicle(&root.join("vehicles/de_tiger_e")).unwrap();
        assert!(validate_vehicle(&v, &db, &shells).issues.is_empty());
        let i = v.modules.iter().position(|m| m.kind == ModuleKind::Engine).unwrap();
        v.modules[i].center.z = 6.0;
        assert!(validate_vehicle(&v, &db, &shells).has("M004"));
    }

    #[test]
    fn multi_turret_vehicle_is_valid_and_its_rules_bite() {
        let root = data_root();
        let db = MaterialDb::from_vec(load_materials(&root.join("materials.json")).unwrap());
        let shells: HashMap<String, ProjectileDef> =
            load_projectiles(&root.join("projectiles")).unwrap().into_iter().map(|(_, p)| (p.id.clone(), p)).collect();
        let mut v = load_vehicle(&root.join("vehicles/fun_hexa")).unwrap();
        let guns = 1 + v.weapons.extra_guns.len() + v.weapons.extra_turrets.iter().map(|t| t.guns.len()).sum::<usize>();
        assert_eq!(guns, 6);
        let clean = validate_vehicle(&v, &db, &shells);
        assert!(clean.issues.is_empty(), "\n{}", clean);

        v.weapons.extra_turrets[0].yaw_limit_deg = Some([50.0, -50.0]);
        v.weapons.extra_turrets[1].guns.clear();
        v.weapons.extra_guns[0].gun.ammo = vec!["ghost_round".into()];
        v.weapons.loaders_m.push([0.0, 9.0, 0.0]);
        let r = validate_vehicle(&v, &db, &shells);
        assert!(r.has("W013") && r.has("W011") && r.has("W001") && r.has("W012"), "\n{}", r);
    }

    #[test]
    fn sight_reload_and_muzzle_rules() {
        let (mut v, db, s) = fixtures();
        v.weapons.sight.as_mut().unwrap().levels.reverse();
        v.weapons.main_gun.rounds_per_min = 30.0;
        v.weapons.muzzle_offset_m = Some(9.0);
        let r = validate_vehicle(&v, &db, &s);
        assert!(r.has("W008") && r.has("W009") && r.has("W010"));
    }

    #[test]
    fn missing_exterior_is_reported() {
        let (mut v, db, s) = fixtures();
        v.visual = None;
        assert!(validate_vehicle(&v, &db, &s).has("V015"));
        v.def.files.visual = None;
        assert!(validate_vehicle(&v, &db, &s).has("V012"));
    }

    #[test]
    fn center_of_mass_and_ring() {
        let (mut v, db, s) = fixtures();
        v.def.hull.center_of_mass = [0.0, 5.0, 0.0];
        v.def.turret.ring_diameter_m = 5.0;
        let r = validate_vehicle(&v, &db, &s);
        assert!(r.has("V005") && r.has("V006"));
    }

    #[test]
    fn projectile_rules() {
        let mut p = ProjectileDef::generic_ap(75.0, 100.0);
        p.penetration_curve = vec![tg_weapon::CurvePoint { distance_m: 500.0, pen_mm: 10.0 }, tg_weapon::CurvePoint { distance_m: 100.0, pen_mm: 20.0 }];
        p.ricochet_angle_deg = 0.0;
        p.explosive_mass_kg = 5.0;
        let r = validate_projectile(&p);
        assert!(r.has("J005") && r.has("J008") && r.has("J012"));
    }

    #[test]
    fn material_rules() {
        let m = Material { id: "x".into(), kind: tg_armor::ArmorKind::Rha, density_kg_m3: 0.0, hardness_bhn: 300.0, kinetic_factor: 1.0, chemical_factor: -1.0 };
        let r = validate_materials(&[m.clone(), m]);
        assert!(r.has("T001") && r.has("T002") && r.has("T004"));
    }

    #[test]
    fn typo_in_json_is_rejected_by_loader_types() {
        let bad = r#"{"id":"a","name":"a","schema_version":1,"model":"m.glb",
          "files":{"armor":"a","weapons":"w","engine":"e","crew":"c","modules":"m"},
          "hul":{"size_m":[1,1,1],"mass_kg":1,"center_of_mass":[0,0,0]},
          "turret":{"size_m":[1,1,1],"ring_diameter_m":1,"position_m":[0,0,0]},
          "physics":{"track_width_m":1,"track_length_m":1,"suspension":{"travel_m":1,"stiffness":1,"damping":1},"rolling_resistance":0.1}}"#;
        assert!(serde_json::from_str::<crate::files::VehicleDef>(bad).is_err());
    }

    #[test]
    fn path_traversal_in_file_references_is_rejected() {
        let dir = std::env::temp_dir().join(format!("tg_vehicle_traversal_{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let json = r#"{"id":"a","name":"a","schema_version":1,"model":"m.glb",
          "files":{"armor":"../secret.json","weapons":"w","engine":"e","crew":"c","modules":"m"},
          "hull":{"size_m":[1,1,1],"mass_kg":1,"center_of_mass":[0,0,0]},
          "turret":{"size_m":[1,1,1],"ring_diameter_m":1,"position_m":[0,0,0]},
          "physics":{"track_width_m":1,"track_length_m":1,"suspension":{"travel_m":1,"stiffness":1,"damping":1},"rolling_resistance":0.1}}"#;
        std::fs::write(dir.join("vehicle.json"), json).unwrap();
        let err = load_vehicle(&dir).unwrap_err();
        assert!(matches!(err, LoadError::BadPath { .. }), "{}", err);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
