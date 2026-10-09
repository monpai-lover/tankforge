//! DamageEngine: spall generation, fragment propagation through the interior,
//! per-module / per-crew damage, and derived vehicle capabilities.
use serde::{Deserialize, Serialize};
use tg_shared::{Rng, Vec3};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModuleKind {
    Engine,
    Transmission,
    FuelTank,
    AmmoRack,
    GunBreech,
    GunBarrel,
    TurretDrive,
    HorizontalDrive,
    VerticalDrive,
    Radio,
    Track,
    /// An active protection system's gun and its radar (outside the armour, on the roof).
    ApsGun,
    ApsRadar,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CrewRole {
    Commander,
    Gunner,
    Loader,
    Driver,
    RadioOperator,
}

impl ModuleKind {
    /// Same spelling as the JSON data.
    pub fn as_str(self) -> &'static str {
        match self {
            ModuleKind::Engine => "engine",
            ModuleKind::Transmission => "transmission",
            ModuleKind::FuelTank => "fuel_tank",
            ModuleKind::AmmoRack => "ammo_rack",
            ModuleKind::GunBreech => "gun_breech",
            ModuleKind::GunBarrel => "gun_barrel",
            ModuleKind::TurretDrive => "turret_drive",
            ModuleKind::HorizontalDrive => "horizontal_drive",
            ModuleKind::VerticalDrive => "vertical_drive",
            ModuleKind::Radio => "radio",
            ModuleKind::Track => "track",
            ModuleKind::ApsGun => "aps_gun",
            ModuleKind::ApsRadar => "aps_radar",
        }
    }
    /// Modules mounted outside the armoured volume (not reachable by interior spall).
    pub fn is_external(self) -> bool {
        matches!(self, ModuleKind::GunBarrel | ModuleKind::Track | ModuleKind::ApsGun | ModuleKind::ApsRadar)
    }
}

impl CrewRole {
    pub fn as_str(self) -> &'static str {
        match self {
            CrewRole::Commander => "commander",
            CrewRole::Gunner => "gunner",
            CrewRole::Loader => "loader",
            CrewRole::Driver => "driver",
            CrewRole::RadioOperator => "radio_operator",
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Module {
    pub id: String,
    pub kind: ModuleKind,
    pub center: Vec3,
    pub half_extents: Vec3,
    pub max_health: f32,
    pub health: f32,
    /// Rounds an ammo rack holds when full (from the model's damage parts); None: its share of
    /// the vehicle's racks by volume.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rounds: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Crew {
    pub role: CrewRole,
    pub pos: Vec3,
    pub radius: f32,
    pub health: f32,
    /// Duties this crew member also carries (a gunner who is also the commander): the vehicle
    /// has that seat in them, not a seat of its own.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub also: Vec<CrewRole>,
    /// How the figure is drawn ("seated" / "standing"); none: by role (a loader stands).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pose: Option<String>,
}

/// All tuning knobs live in data (balance panel in the admin UI edits this).
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DamageParams {
    pub base_frag_count: u32,
    pub frags_per_residual_mm: f32,
    pub max_frags: u32,
    /// Share of residual energy given to spall; the rest stays with the penetrator.
    pub frag_energy_fraction: f32,
    pub cone_half_angle_deg: f32,
    pub energy_to_damage: f32,
    pub max_frag_damage: f32,
    pub penetrator_damage_multiplier: f32,
    pub frag_range_m: f32,
}

impl Default for DamageParams {
    fn default() -> Self {
        Self {
            base_frag_count: 6,
            frags_per_residual_mm: 0.25,
            max_frags: 60,
            frag_energy_fraction: 0.35,
            cone_half_angle_deg: 30.0,
            energy_to_damage: 0.001,
            max_frag_damage: 40.0,
            penetrator_damage_multiplier: 4.0,
            frag_range_m: 4.0,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Fragment {
    pub origin: Vec3,
    pub dir: Vec3,
    pub energy_j: f32,
    pub damage: f32,
    pub is_penetrator: bool,
}

/// Penetrator core (index 0) + spall cone. `exit_point` is just inside the plate.
pub fn generate_fragments(
    exit_point: Vec3,
    dir: Vec3,
    residual_energy_j: f32,
    residual_mm: f32,
    p: &DamageParams,
    rng: &mut Rng,
) -> Vec<Fragment> {
    let dir = dir.normalized();
    let n = ((p.base_frag_count as f32 + residual_mm * p.frags_per_residual_mm) as u32).min(p.max_frags).max(1);
    let spall_energy = residual_energy_j * p.frag_energy_fraction;
    let per = spall_energy / n as f32;
    let u = dir.any_perpendicular();
    let v = dir.cross(u);
    let cone = p.cone_half_angle_deg.to_radians();

    let mut out = Vec::with_capacity(n as usize + 1);
    out.push(Fragment {
        origin: exit_point,
        dir,
        energy_j: residual_energy_j - spall_energy,
        damage: ((residual_energy_j - spall_energy) * p.energy_to_damage)
            .min(p.max_frag_damage * p.penetrator_damage_multiplier),
        is_penetrator: true,
    });
    for _ in 0..n {
        let a = rng.next_f32().sqrt() * cone; // sqrt: uniform over the cone's solid angle
        let az = rng.next_f32() * std::f32::consts::TAU;
        let d = (dir * a.cos() + (u * az.cos() + v * az.sin()) * a.sin()).normalized();
        out.push(Fragment {
            origin: exit_point,
            dir: d,
            energy_j: per,
            damage: (per * p.energy_to_damage).min(p.max_frag_damage),
            is_penetrator: false,
        });
    }
    out
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TargetRef {
    Module(usize),
    Crew(usize),
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct FragmentTrace {
    pub origin: Vec3,
    pub end: Vec3,
    pub target: Option<TargetRef>,
    pub damage: f32,
    pub is_penetrator: bool,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct DamageSummary {
    pub traces: Vec<FragmentTrace>,
    pub module_damage: Vec<(usize, f32)>,
    pub crew_damage: Vec<(usize, f32)>,
    pub newly_destroyed_modules: Vec<usize>,
    pub newly_killed_crew: Vec<usize>,
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
    if t >= 0.0 { Some(t) } else { None }
}

fn ray_aabb(o: Vec3, d: Vec3, c: Vec3, h: Vec3, max_t: f32) -> Option<f32> {
    let (o, d, c, h) = (o.to_array(), d.to_array(), c.to_array(), h.to_array());
    let (mut tmin, mut tmax) = (0.0f32, max_t);
    for i in 0..3 {
        let (lo, hi) = (c[i] - h[i], c[i] + h[i]);
        if d[i].abs() < 1e-9 {
            if o[i] < lo || o[i] > hi {
                return None;
            }
        } else {
            let (mut t1, mut t2) = ((lo - o[i]) / d[i], (hi - o[i]) / d[i]);
            if t1 > t2 {
                std::mem::swap(&mut t1, &mut t2);
            }
            tmin = tmin.max(t1);
            tmax = tmax.min(t2);
            if tmin > tmax {
                return None;
            }
        }
    }
    Some(tmin)
}

/// Each fragment stops at the first living crew member / intact module on its ray.
pub fn propagate(frags: &[Fragment], modules: &mut [Module], crew: &mut [Crew], p: &DamageParams) -> DamageSummary {
    let mut s = DamageSummary::default();
    for f in frags {
        let mut best: Option<(f32, TargetRef)> = None;
        for (i, c) in crew.iter().enumerate() {
            if c.health <= 0.0 {
                continue;
            }
            if let Some(t) = ray_sphere(f.origin, f.dir, c.pos, c.radius) {
                if t <= p.frag_range_m && best.map_or(true, |(bt, _)| t < bt) {
                    best = Some((t, TargetRef::Crew(i)));
                }
            }
        }
        for (i, m) in modules.iter().enumerate() {
            if m.health <= 0.0 {
                continue;
            }
            if let Some(t) = ray_aabb(f.origin, f.dir, m.center, m.half_extents, p.frag_range_m) {
                if best.map_or(true, |(bt, _)| t < bt) {
                    best = Some((t, TargetRef::Module(i)));
                }
            }
        }
        match best {
            Some((t, target)) => {
                match target {
                    TargetRef::Crew(i) => {
                        let was = crew[i].health > 0.0;
                        crew[i].health -= f.damage;
                        s.crew_damage.push((i, f.damage));
                        if was && crew[i].health <= 0.0 {
                            s.newly_killed_crew.push(i);
                        }
                    }
                    TargetRef::Module(i) => {
                        let was = modules[i].health > 0.0;
                        modules[i].health -= f.damage;
                        s.module_damage.push((i, f.damage));
                        if was && modules[i].health <= 0.0 {
                            s.newly_destroyed_modules.push(i);
                        }
                    }
                }
                s.traces.push(FragmentTrace {
                    origin: f.origin,
                    end: f.origin + f.dir * t,
                    target: Some(target),
                    damage: f.damage,
                    is_penetrator: f.is_penetrator,
                });
            }
            None => s.traces.push(FragmentTrace {
                origin: f.origin,
                end: f.origin + f.dir * p.frag_range_m,
                target: None,
                damage: 0.0,
                is_penetrator: f.is_penetrator,
            }),
        }
    }
    s
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Capabilities {
    pub can_fire: bool,
    pub can_move: bool,
    pub reload_multiplier: f32,
    pub spotting_multiplier: f32,
    pub on_fire: bool,
    pub ammo_detonated: bool,
}

/// A role only constrains the vehicle if the vehicle has that role at all.
fn role_ok(crew: &[Crew], role: CrewRole) -> bool {
    let mut any = false;
    for c in crew.iter().filter(|c| c.role == role || c.also.contains(&role)) {
        any = true;
        if c.health > 0.0 {
            return true;
        }
    }
    !any
}

fn kind_ok(modules: &[Module], kind: ModuleKind) -> bool {
    modules.iter().filter(|m| m.kind == kind).all(|m| m.health > 0.0)
}

pub fn capabilities(modules: &[Module], crew: &[Crew]) -> Capabilities {
    Capabilities {
        can_fire: role_ok(crew, CrewRole::Gunner) && kind_ok(modules, ModuleKind::GunBreech) && kind_ok(modules, ModuleKind::GunBarrel),
        can_move: role_ok(crew, CrewRole::Driver) && kind_ok(modules, ModuleKind::Engine) && kind_ok(modules, ModuleKind::Transmission),
        reload_multiplier: if role_ok(crew, CrewRole::Loader) { 1.0 } else { 2.0 },
        spotting_multiplier: if role_ok(crew, CrewRole::Commander) { 1.0 } else { 0.5 },
        on_fire: modules.iter().any(|m| m.kind == ModuleKind::FuelTank && m.health <= 0.0),
        ammo_detonated: modules.iter().any(|m| m.kind == ModuleKind::AmmoRack && m.health <= 0.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn crew(role: CrewRole, z: f32) -> Crew {
        Crew { role, pos: Vec3::new(0.0, 0.0, z), radius: 0.3, health: 100.0, also: Vec::new(), pose: None }
    }

    fn module(kind: ModuleKind) -> Module {
        Module { id: "m".into(), kind, center: Vec3::new(5.0, 0.0, 0.0), half_extents: Vec3::new(0.2, 0.2, 0.2), max_health: 100.0, health: 100.0, rounds: None }
    }

    #[test]
    fn generation_is_deterministic_and_conserves_energy() {
        let p = DamageParams::default();
        let a = generate_fragments(Vec3::ZERO, Vec3::new(0.0, 0.0, -1.0), 1.0e6, 70.0, &p, &mut Rng::new(7));
        let b = generate_fragments(Vec3::ZERO, Vec3::new(0.0, 0.0, -1.0), 1.0e6, 70.0, &p, &mut Rng::new(7));
        assert_eq!(a.len(), b.len());
        assert!(a.len() > 10 && a[0].is_penetrator);
        let total: f32 = a.iter().map(|f| f.energy_j).sum();
        assert!((total - 1.0e6).abs() < 1.0e3);
    }

    #[test]
    fn fragment_kills_crew_in_its_path_and_stops_there() {
        let mut crew = vec![crew(CrewRole::Gunner, -1.0), crew(CrewRole::Loader, -2.0)];
        let mut mods: Vec<Module> = vec![];
        let f = Fragment { origin: Vec3::ZERO, dir: Vec3::new(0.0, 0.0, -1.0), energy_j: 1.0, damage: 150.0, is_penetrator: true };
        let s = propagate(&[f], &mut mods, &mut crew, &DamageParams::default());
        assert_eq!(s.newly_killed_crew, vec![0]);
        assert_eq!(crew[1].health, 100.0); // shielded by the gunner
    }

    #[test]
    fn dead_gunner_disables_firing_dead_loader_slows_reload() {
        let mods = vec![module(ModuleKind::GunBreech), module(ModuleKind::GunBarrel)];
        let mut c = vec![crew(CrewRole::Gunner, 0.0), crew(CrewRole::Loader, 1.0)];
        assert!(capabilities(&mods, &c).can_fire);
        c[0].health = 0.0;
        assert!(!capabilities(&mods, &c).can_fire);
        c[1].health = 0.0;
        assert_eq!(capabilities(&mods, &c).reload_multiplier, 2.0);
    }

    #[test]
    fn destroyed_breech_disables_firing_and_ammo_rack_detonates() {
        let mut mods = vec![module(ModuleKind::GunBreech), module(ModuleKind::AmmoRack)];
        let c = vec![crew(CrewRole::Gunner, 0.0)];
        mods[0].health = 0.0;
        mods[1].health = 0.0;
        let cap = capabilities(&mods, &c);
        assert!(!cap.can_fire && cap.ammo_detonated);
    }

    #[test]
    fn aabb_module_is_hit() {
        let mut mods = vec![module(ModuleKind::Engine)];
        let f = Fragment { origin: Vec3::ZERO, dir: Vec3::new(1.0, 0.0, 0.0), energy_j: 1.0, damage: 30.0, is_penetrator: false };
        let s = propagate(&[f], &mut mods, &mut [], &DamageParams { frag_range_m: 10.0, ..Default::default() });
        assert_eq!(s.module_damage.len(), 1);
        assert_eq!(mods[0].health, 70.0);
    }
}
