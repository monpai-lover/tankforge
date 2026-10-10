//! DamageEngine: spall generation, fragment propagation through the interior,
//! per-module / per-crew damage, and derived vehicle capabilities.
use serde::{Deserialize, Serialize};
use tg_shared::{Rng, Vec3};
pub mod module_state;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ModuleKind {
    Engine,
    Transmission,
    FuelTank,
    AmmoRack,
    GunBreech,
    GunBarrel,
    /// Missile/rocket launch rails, tubes and firing apparatus; no cannon breech or recoil unit.
    Launcher,
    /// Machine-gun receiver or barrel; per-module external metadata distinguishes them.
    MachineGun,
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
            ModuleKind::Launcher => "launcher",
            ModuleKind::MachineGun => "machine_gun",
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
        matches!(self, ModuleKind::GunBarrel | ModuleKind::Launcher | ModuleKind::Track | ModuleKind::ApsGun | ModuleKind::ApsRadar)
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
    /// Mounted weapon instance: every critical launcher part in the same assembly shares it.
    /// None preserves legacy data by treating all ungrouped launcher parts as one assembly.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weapon_group: Option<String>,
    /// Overrides kind defaults for mixed internal/external assemblies (e.g. coax MG).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external: Option<bool>,
    /// Parent turret in neutral vehicle space; absent preserves legacy kind/geometry rules.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub turret_index: Option<usize>,
}

impl Module {
    pub fn is_external(&self) -> bool { self.external.unwrap_or_else(|| self.kind.is_external()) }
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

/// Each fragment stops at the first living crew member / physical module on its ray.
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
            if m.kind == ModuleKind::AmmoRack && m.rounds == Some(0) {
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
                let damage = match target {
                    TargetRef::Crew(i) => {
                        let was = crew[i].health > 0.0;
                        let damage = module_state::apply_health_damage(&mut crew[i].health, 100.0, f.damage);
                        if damage > 0.0 { s.crew_damage.push((i, damage)); }
                        if was && crew[i].health <= 0.0 {
                            s.newly_killed_crew.push(i);
                        }
                        damage
                    }
                    TargetRef::Module(i) => {
                        let was = modules[i].health > 0.0;
                        let max_health = modules[i].max_health;
                        let damage = module_state::apply_health_damage(&mut modules[i].health, max_health, f.damage);
                        if damage > 0.0 { s.module_damage.push((i, damage)); }
                        if was && modules[i].health <= 0.0 {
                            s.newly_destroyed_modules.push(i);
                        }
                        damage
                    }
                };
                s.traces.push(FragmentTrace {
                    origin: f.origin,
                    end: f.origin + f.dir * t,
                    target: Some(target),
                    damage,
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

fn healthy_multiplier() -> f32 { 1.0 }

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Capabilities {
    pub can_fire: bool,
    pub can_move: bool,
    pub reload_multiplier: f32,
    #[serde(default = "healthy_multiplier")]
    pub engine_power: f32,
    #[serde(default = "healthy_multiplier")]
    pub transmission: f32,
    #[serde(default = "healthy_multiplier")]
    pub drive_power: f32,
    #[serde(default = "healthy_multiplier")]
    pub traverse_multiplier: f32,
    #[serde(default = "healthy_multiplier")]
    pub elevation_multiplier: f32,
    #[serde(default = "healthy_multiplier")]
    pub dispersion_multiplier: f32,
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
    modules.iter().filter(|m| m.kind == kind).all(|m| module_state::health_ratio(m.health,m.max_health) > 0.0)
}

/// At least one complete launcher assembly works. No launcher modules imposes no restriction.
pub fn launcher_groups_operational(modules: &[Module], mut healthy: impl FnMut(usize, &Module) -> bool) -> bool {
    let mut found = false;
    for m in modules.iter().filter(|m| m.kind == ModuleKind::Launcher) {
        found = true;
        if modules.iter().enumerate().filter(|(_, part)| part.kind == ModuleKind::Launcher && part.weapon_group == m.weapon_group).all(|(i, part)| healthy(i, part)) {
            return true;
        }
    }
    !found
}

pub fn capabilities(modules: &[Module], crew: &[Crew]) -> Capabilities {
    let factor = |kinds: &[ModuleKind], curve: fn(f32) -> f32| modules.iter()
        .filter(|m| kinds.contains(&m.kind))
        .map(|m| curve(module_state::health_ratio(m.health, m.max_health))).fold(1.0, f32::min);
    let engine_power = factor(&[ModuleKind::Engine], module_state::engine_power_factor);
    let transmission = factor(&[ModuleKind::Transmission], module_state::transmission_factor);
    let drive_power = engine_power * transmission;
    let feed = modules.iter().filter(|m| m.kind == ModuleKind::AmmoRack && m.rounds != Some(0))
        .map(|m| module_state::ammo_reload_multiplier(module_state::health_ratio(m.health,m.max_health))).fold(1.0, f32::max);
    let dispersion_multiplier = modules.iter().filter(|m| matches!(m.kind,ModuleKind::GunBreech|ModuleKind::GunBarrel))
        .map(|m| module_state::dispersion_multiplier(module_state::health_ratio(m.health,m.max_health))).fold(1.0,f32::max);
    Capabilities {
        can_fire: role_ok(crew, CrewRole::Gunner) && kind_ok(modules, ModuleKind::GunBreech) && kind_ok(modules, ModuleKind::GunBarrel)
            && (modules.iter().any(|m| matches!(m.kind, ModuleKind::GunBreech | ModuleKind::GunBarrel)) || launcher_groups_operational(modules, |_, m| module_state::health_ratio(m.health,m.max_health) > 0.0)),
        can_move: role_ok(crew, CrewRole::Driver) && drive_power > 0.0,
        reload_multiplier: feed * if crew.iter().any(|c| (c.role == CrewRole::Loader || c.also.contains(&CrewRole::Loader)) && c.health > 0.0) { 1.0 } else { 1.6 },
        engine_power, transmission, drive_power, dispersion_multiplier,
        traverse_multiplier: factor(&[ModuleKind::TurretDrive,ModuleKind::HorizontalDrive],module_state::traverse_factor),
        elevation_multiplier: factor(&[ModuleKind::VerticalDrive],module_state::elevation_factor),
        spotting_multiplier: if role_ok(crew, CrewRole::Commander) { 1.0 } else { 0.5 },
        on_fire: modules.iter().any(|m| m.kind == ModuleKind::FuelTank && m.health <= 0.0),
        ammo_detonated: modules.iter().any(|m| m.kind == ModuleKind::AmmoRack && m.rounds != Some(0) && m.health <= 0.0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn crew(role: CrewRole, z: f32) -> Crew {
        Crew { role, pos: Vec3::new(0.0, 0.0, z), radius: 0.3, health: 100.0, also: Vec::new(), pose: None }
    }

    fn module(kind: ModuleKind) -> Module {
        Module { id: "m".into(), kind, center: Vec3::new(5.0, 0.0, 0.0), half_extents: Vec3::new(0.2, 0.2, 0.2), max_health: 100.0, health: 100.0, rounds: None, weapon_group: None, external: None, turret_index: None }
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
        assert_eq!(capabilities(&mods, &c).reload_multiplier, 1.6);
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
    fn independent_launcher_groups_require_every_critical_part_of_one_complete_assembly() {
        let mut mods = (0..4).map(|i| {
            let mut m = module(ModuleKind::Launcher);
            m.weapon_group = Some(if i < 2 { "mount_0" } else { "mount_1" }.into());
            m
        }).collect::<Vec<_>>();
        mods[0].health = 0.0;
        mods[3].health = 0.0;
        assert!(!launcher_groups_operational(&mods, |_, m| m.health > 0.0), "living components from two incomplete assemblies cannot be combined");
        mods[3].health = 100.0;
        assert!(capabilities(&mods, &[]).can_fire, "the second complete assembly works independently");
        for m in &mut mods { m.weapon_group = None; }
        assert!(!capabilities(&mods, &[]).can_fire, "legacy ungrouped critical parts form one conservative assembly");
    }

    #[test]
    fn aabb_module_is_hit() {
        let mut mods = vec![module(ModuleKind::Engine)];
        let f = Fragment { origin: Vec3::ZERO, dir: Vec3::new(1.0, 0.0, 0.0), energy_j: 1.0, damage: 30.0, is_penetrator: false };
        let s = propagate(&[f], &mut mods, &mut [], &DamageParams { frag_range_m: 10.0, ..Default::default() });
        assert_eq!(s.module_damage.len(), 1);
        assert_eq!(mods[0].health, 70.0);
    }

    #[test]
    fn excessive_module_damage_is_clamped_and_destroyed_module_keeps_shielding() {
        let mut mods = vec![module(ModuleKind::Engine)];
        mods[0].health = 10.0;
        let mut crew = vec![crew(CrewRole::Driver, 0.0)];
        crew[0].pos = Vec3::new(6.0, 0.0, 0.0);
        let f = Fragment { origin: Vec3::ZERO, dir: Vec3::new(1.0, 0.0, 0.0), energy_j: 1.0, damage: 150.0, is_penetrator: false };
        let s = propagate(&[f, f], &mut mods, &mut crew, &DamageParams { frag_range_m: 10.0, ..Default::default() });
        assert_eq!(mods[0].health, 0.0);
        assert_eq!(s.module_damage, vec![(0, 10.0)]);
        assert_eq!(s.newly_destroyed_modules, vec![0]);
        assert_eq!(s.traces[0].damage, 10.0);
        assert_eq!(s.traces[1].damage, 0.0);
        assert_eq!(s.traces[1].target, Some(TargetRef::Module(0)));
        assert_eq!(crew[0].health, 100.0);
    }

    #[test]
    fn explicitly_empty_rack_is_not_hit_and_does_not_shield_crew() {
        for health in [100.0, 0.0] {
            let mut rack = module(ModuleKind::AmmoRack);
            rack.rounds = Some(0); rack.health = health;
            let mut mods = vec![rack];
            let mut crew = vec![crew(CrewRole::Driver, 0.0)];
            crew[0].pos = Vec3::new(6.0, 0.0, 0.0);
            let f = Fragment { origin: Vec3::ZERO, dir: Vec3::new(1.0, 0.0, 0.0), energy_j: 1.0, damage: 30.0, is_penetrator: false };
            let s = propagate(&[f], &mut mods, &mut crew, &DamageParams { frag_range_m: 10.0, ..Default::default() });
            assert_eq!(mods[0].health, health, "authored zero rack receives no health damage");
            assert!(s.module_damage.is_empty()); assert!(s.newly_destroyed_modules.is_empty());
            assert_eq!(crew[0].health, 70.0);
            assert_eq!(s.traces[0].target, Some(TargetRef::Crew(0)));
        }
    }

    #[test]
    fn explicitly_empty_rack_does_not_shield_a_module_behind_it() {
        let mut mods = vec![module(ModuleKind::AmmoRack), module(ModuleKind::Engine)];
        mods[0].rounds = Some(0); mods[1].center.x = 6.0;
        let f = Fragment { origin: Vec3::ZERO, dir: Vec3::new(1.0, 0.0, 0.0), energy_j: 1.0, damage: 30.0, is_penetrator: true };
        let s = propagate(&[f], &mut mods, &mut [], &DamageParams { frag_range_m: 10.0, ..Default::default() });
        assert_eq!(mods[0].health, 100.0); assert_eq!(mods[1].health, 70.0);
        assert_eq!(s.module_damage, vec![(1, 30.0)]);
        assert_eq!(s.traces[0].target, Some(TargetRef::Module(1)));
    }

    #[test]
    fn legacy_and_positive_capacity_racks_remain_physical_after_destruction() {
        for rounds in [None, Some(1)] {
            let mut rack = module(ModuleKind::AmmoRack); rack.rounds = rounds; rack.health = 10.0;
            let mut mods = vec![rack];
            let mut crew = vec![crew(CrewRole::Driver, 0.0)]; crew[0].pos = Vec3::new(6.0, 0.0, 0.0);
            let f = Fragment { origin: Vec3::ZERO, dir: Vec3::new(1.0, 0.0, 0.0), energy_j: 1.0, damage: 150.0, is_penetrator: false };
            let s = propagate(&[f, f], &mut mods, &mut crew, &DamageParams { frag_range_m: 10.0, ..Default::default() });
            assert_eq!(s.module_damage, vec![(0, 10.0)]); assert_eq!(s.newly_destroyed_modules, vec![0]);
            assert_eq!(s.traces[1].target, Some(TargetRef::Module(0))); assert_eq!(s.traces[1].damage, 0.0);
            assert_eq!(crew[0].health, 100.0);
        }
    }

    #[test]
    fn excessive_crew_damage_is_clamped_and_records_actual_loss() {
        let mut crew = vec![crew(CrewRole::Driver, -1.0)];
        crew[0].health = 10.0;
        let f = Fragment { origin: Vec3::ZERO, dir: Vec3::new(0.0, 0.0, -1.0), energy_j: 1.0, damage: 150.0, is_penetrator: false };
        let s = propagate(&[f, f], &mut [], &mut crew, &DamageParams::default());
        assert_eq!(crew[0].health, 0.0);
        assert_eq!(s.crew_damage, vec![(0, 10.0)]);
        assert_eq!(s.newly_killed_crew, vec![0]);
        assert_eq!(s.traces[0].damage, 10.0);
    }
    #[test]
    fn workshop_capability_curves_respect_combined_crew_and_empty_racks() {
        let mut mods = vec![module(ModuleKind::Engine),module(ModuleKind::Transmission),module(ModuleKind::HorizontalDrive),module(ModuleKind::VerticalDrive),module(ModuleKind::GunBreech),module(ModuleKind::AmmoRack)];
        for m in &mut mods {m.health=25.0;}
        mods[5].rounds=Some(0);
        mods[5].health=0.0;
        let mut c=vec![crew(CrewRole::Gunner,0.0)];
        c[0].also.push(CrewRole::Loader);
        let cap=capabilities(&mods,&c);
        assert!(!cap.ammo_detonated,"an explicitly empty rack cannot cook off");
        assert_eq!(cap.reload_multiplier,1.0);
        assert!((cap.drive_power-0.6).abs()<1e-5);
        assert!((cap.traverse_multiplier-0.675).abs()<1e-5);
        assert!((cap.elevation_multiplier-0.75).abs()<1e-5);
        assert_eq!(cap.dispersion_multiplier,1.5);
        c[0].health=0.0;
        assert!((capabilities(&mods,&c).reload_multiplier-1.6).abs()<1e-5);
        mods[5].rounds=Some(1);
        mods[5].health=25.0;
        assert!((capabilities(&mods,&c).reload_multiplier-2.0).abs()<1e-5);
    }

    #[test]
    fn a_missing_dedicated_loader_uses_the_same_gunner_loading_fallback() {
        let mods=vec![module(ModuleKind::GunBreech),module(ModuleKind::GunBarrel)];
        let mut c=vec![crew(CrewRole::Gunner,0.0)];
        assert!((capabilities(&mods,&c).reload_multiplier-1.6).abs()<1e-6);
        c[0].also.push(CrewRole::Loader);
        assert_eq!(capabilities(&mods,&c).reload_multiplier,1.0);
    }

    #[test]
    fn unsupported_zero_capacity_weapon_parts_are_not_operational() {
        let mut mods=vec![module(ModuleKind::GunBreech)];mods[0].max_health=0.0;
        assert!(!capabilities(&mods,&[]).can_fire);
        mods[0].kind=ModuleKind::Launcher;
        assert!(!capabilities(&mods,&[]).can_fire);
    }

}
