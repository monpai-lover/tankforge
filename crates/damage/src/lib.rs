//! DamageEngine: spall generation, fragment propagation through the interior,
//! per-module / per-crew damage, and derived vehicle capabilities.
use serde::{Deserialize, Serialize};
use tg_shared::{Rng, Vec3};
use tg_penetration::impact::{self, FragmentProvenance, FragmentSource, PhysicalFragment, ImpactSnapshot, ImpactTransition};
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

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Fragment {
    pub origin: Vec3,
    pub dir: Vec3,
    pub energy_j: f32,
    pub damage: f32,
    pub is_penetrator: bool,
    #[serde(default, flatten)]
    pub provenance: FragmentProvenance,
    #[serde(default)]
    pub remaining_pen_mm: Option<f64>,
    #[serde(default)] pub impact_state: Option<impact::ImpactState>,
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
    generate_fragments_legacy(exit_point, dir, residual_energy_j, residual_mm, p, rng)
}

/// Explicit legacy/nonkinetic adapter; its heuristic split has no P1 kinetic ledger.
pub fn generate_fragments_legacy(exit_point: Vec3, dir: Vec3, residual_energy_j: f32, residual_mm: f32, p: &DamageParams, rng: &mut Rng) -> Vec<Fragment> {
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
        provenance: FragmentProvenance::default(), remaining_pen_mm: None, impact_state: None,
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
            provenance: FragmentProvenance::default(), remaining_pen_mm: None, impact_state: None,
        });
    }
    out
}

/// Consume only already-debited source allocations. Sample properties belong to
/// individual fragments; P1 samples have weight=1, with unknown area explicit.
pub fn generate_allocated_fragments(exit: Vec3, dir: Vec3, core: Option<&ImpactSnapshot>, transition: &ImpactTransition, p: &DamageParams, rng: &mut Rng) -> Vec<Fragment> {
    let dir = dir.normalized();
    let mut out = Vec::new();
    if let Some(s) = core {
        out.push(Fragment { origin: exit, dir, energy_j: s.energy_j() as f32, damage: 0.0, is_penetrator: true,
            remaining_pen_mm: Some(s.remaining_pen_mm), impact_state: Some(impact::ImpactState {current:s.clone(),traversal:None}), provenance: FragmentProvenance { fragment_id: s.body_id.clone(), parent_event_id: transition.event_id.clone(), source: FragmentSource::Core,
                source_layer_or_module: Some(transition.layer_id.clone()), physical: Some(PhysicalFragment { mass_kg: s.mass_kg, energy_j: s.energy_j(), area_m2:s.effective_diameter_m.map(|d|std::f64::consts::PI*(d*0.5).powi(2)), velocity_m_s: s.velocity_m_s }),
                weight: 1.0, start_s: Some(s.elapsed_s), profile: Some(s.profile.clone()) } });
    }
    for a in &transition.allocations {
        if a.energy_j <= 0.0 || a.mass_kg <= 0.0 { continue; }
        let n = ((p.base_frag_count as f32 + transition.output.remaining_pen_mm as f32 * p.frags_per_residual_mm) as u32).clamp(1, p.max_frags.max(1));
        let energy = a.energy_j/n as f64; let mass = a.mass_kg/n as f64;
        let u = dir.any_perpendicular(); let v = dir.cross(u);
        for i in 0..n {
            let angle = rng.next_f32().sqrt() * p.cone_half_angle_deg.to_radians();
            let az = rng.next_f32() * std::f32::consts::TAU;
            let d = (dir*angle.cos() + (u*az.cos()+v*az.sin())*angle.sin()).normalized();
            let velocity = d * (2.0*energy/mass).sqrt() as f32;
            out.push(Fragment { origin: exit, dir: d, energy_j: energy as f32, damage: 0.0, is_penetrator: false, remaining_pen_mm: None, impact_state: None,
                provenance: FragmentProvenance { fragment_id: format!("{}/{}:{i}", transition.event_id, out.len()), parent_event_id: transition.event_id.clone(), source: a.source,
                    source_layer_or_module: Some(transition.layer_id.clone()), physical: Some(PhysicalFragment { mass_kg: mass, energy_j: energy, area_m2: None, velocity_m_s: velocity }), weight: 1.0, start_s: Some(transition.output.elapsed_s), profile: Some(a.profile.clone()) } });
        }
    }
    out
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum TargetRef {
    Module(usize),
    Crew(usize),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct FragmentTrace {
    pub origin: Vec3,
    pub end: Vec3,
    pub target: Option<TargetRef>,
    pub damage: f32,
    pub is_penetrator: bool,
    #[serde(default)] pub fragment_index: usize,
    #[serde(default)] pub budget: Option<impact::EnergyBudget>,
    #[serde(default)] pub entry_state: Option<ImpactSnapshot>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct DamageSummary {
    #[serde(default)] pub fragment_states: Vec<(usize, impact::ImpactState)>,
    #[serde(default)] pub impact_events: Vec<impact::ImpactEvent>,
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
    for (fragment_index,f) in frags.iter().enumerate() {
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
                    fragment_index, budget: None, entry_state: None,
                    origin: f.origin,
                    end: f.origin + f.dir * t,
                    target: Some(target),
                    damage,
                    is_penetrator: f.is_penetrator,
                });
            }
            None => s.traces.push(FragmentTrace {
                fragment_index, budget: None, entry_state: None,
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

/// Existing named gameplay absorption proxies. No material-strength or human
/// lethality claim is inferred from these millimetre equivalents.
pub fn compatibility_absorb_mm(kind: ModuleKind) -> f64 {
    match kind {
        ModuleKind::Engine => 30.0, ModuleKind::Transmission => 25.0, ModuleKind::GunBreech => 45.0,
        ModuleKind::GunBarrel => 25.0, ModuleKind::Launcher | ModuleKind::MachineGun => 8.0,
        ModuleKind::Track => 20.0, ModuleKind::AmmoRack => 10.0, ModuleKind::FuelTank => 6.0,
        ModuleKind::TurretDrive | ModuleKind::HorizontalDrive | ModuleKind::VerticalDrive => 8.0,
        ModuleKind::Radio => 3.0, ModuleKind::ApsGun => 15.0, ModuleKind::ApsRadar => 4.0,
    }
}
pub const COMPATIBILITY_CREW_ABSORB_MM: f64 = 5.0;
pub fn deposited_crew_damage(energy_j: f64) -> f32 { (25.0*(energy_j.max(0.0)/1000.0).sqrt()).min(300.0) as f32 }
pub fn deposited_module_damage(energy_j: f64) -> f32 { (7.0*(energy_j.max(0.0)/1000.0).powf(0.6)).min(400.0) as f32 }

/// Serial active P1 propagation. Geometry supplies ranges bounded by armour;
/// richer redirected fragment/armour continuation remains P2/X.
pub fn propagate_allocated(frags: &[Fragment], ranges: &[f64], modules: &mut [Module], crew: &mut [Crew], include_external: bool) -> DamageSummary {
    let mut summary = DamageSummary::default();
    for (fi, (f, range)) in frags.iter().zip(ranges).enumerate() {
        let (Some(physical), Some(profile)) = (&f.provenance.physical, &f.provenance.profile) else { continue };
        let pen = f.remaining_pen_mm.unwrap_or(3.5*(physical.energy_j/1000.0).sqrt());
        let state_result = f.impact_state.clone().map(Ok).unwrap_or_else(||impact::fragment_state(physical, pen, &f.provenance.fragment_id, profile));
        let Ok(mut state) = state_result else { continue };
        if let Some(t)=f.provenance.start_s {state.elapsed_s=t;}
        let mut last_distance=0.0;
        let mut last_point=f.origin;
        let mut contacts = Vec::new();
        for (i, c) in crew.iter().enumerate() {
            if c.health > 0.0 { if let Some(t) = ray_sphere(f.origin,f.dir,c.pos,c.radius) { if t as f64 <= *range { contacts.push((t,TargetRef::Crew(i))); } } }
        }
        for (i,m) in modules.iter().enumerate() {
            if (!include_external && m.is_external()) || (m.kind == ModuleKind::AmmoRack && m.rounds == Some(0)) { continue; }
            if let Some(t) = ray_aabb(f.origin,f.dir,m.center,m.half_extents,*range as f32) { contacts.push((t,TargetRef::Module(i))); }
        }
        contacts.sort_by(|a,b| a.0.total_cmp(&b.0));
        let mut recorded = false;
        for (t,target) in contacts {
            if state.energy_j() <= 0.0 { break; }
            let (absorb,id) = match target {
                TargetRef::Module(i) => (compatibility_absorb_mm(modules[i].kind) * if modules[i].health > 0.0 {1.0} else {0.5}, modules[i].id.clone()),
                TargetRef::Crew(i) => { if crew[i].health <= 0.0 { continue; } (COMPATIBILITY_CREW_ABSORB_MM, format!("crew:{i}")) },
            };
            let contact_id = format!("{}/target:{id}",f.provenance.fragment_id);
            let segment_entry=state.current.clone();
            state.advance_time((t-last_distance).max(0.0) as f64);last_distance=t;
            let result = if f.is_penetrator { impact::deposit_contact_energy(&mut state,absorb,&contact_id) } else { impact::deposit_fragment_contact_energy(&mut state,absorb,&contact_id) };
            let Ok(tr) = result else { break };
            let damage = match target {
                TargetRef::Crew(i) => {
                    let was = crew[i].health > 0.0;
                    let damage = module_state::apply_health_damage(&mut crew[i].health,100.0,deposited_crew_damage(tr.budget.target_deposition_j));
                    if damage > 0.0 { summary.crew_damage.push((i,damage)); }
                    if was && crew[i].health <= 0.0 { summary.newly_killed_crew.push(i); }
                    damage
                }
                TargetRef::Module(i) => {
                    let was = modules[i].health > 0.0; let max = modules[i].max_health;
                    let damage = module_state::apply_health_damage(&mut modules[i].health,max,deposited_module_damage(tr.budget.target_deposition_j));
                    if damage > 0.0 { summary.module_damage.push((i,damage)); }
                    if was && modules[i].health <= 0.0 { summary.newly_destroyed_modules.push(i); }
                    damage
                }
            };
            summary.traces.push(FragmentTrace { origin:last_point, end: f.origin+f.dir*t, target: Some(target), damage,
                is_penetrator: f.is_penetrator, fragment_index: fi, budget: Some(tr.budget),entry_state:Some(segment_entry) });
            last_point=f.origin+f.dir*t;
            summary.impact_events.push(impact::ImpactEvent {mechanism_revision:impact::MECHANISM_REVISION.into(),time_s:tr.entry.elapsed_s,
                entry_position:f.origin+f.dir*t,exit_position:f.origin+f.dir*t,normal:Vec3::ZERO,transition:tr});
            recorded = true;
        }
        if !recorded || state.energy_j() > 0.0 {
            summary.traces.push(FragmentTrace { origin:last_point,end:f.origin+f.dir*(*range as f32),target:None,damage:0.0,
                is_penetrator:f.is_penetrator,fragment_index:fi,budget:None,entry_state:Some(state.current.clone()) });
        }
        state.advance_time((*range-last_distance as f64).max(0.0));
        summary.fragment_states.push((fi,state));
    }
    summary
}

pub fn trace_provenance(fragment: &Fragment, trace: &FragmentTrace) -> FragmentProvenance {
    let mut p=fragment.provenance.clone();
    if let (Some(state),Some(physical))=(&trace.entry_state,p.physical.as_mut()) {
        physical.mass_kg=state.mass_kg;physical.energy_j=state.energy_j();physical.velocity_m_s=state.velocity_m_s;
        p.start_s=Some(state.elapsed_s);
    }
    p
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

    fn kinetic_core(energy:f64)->Fragment {
        let physical=PhysicalFragment{mass_kg:0.1,energy_j:energy,area_m2:None,velocity_m_s:Vec3::new(0.0,0.0,(2.0*energy/0.1).sqrt() as f32)};
        let profile=impact::ProfileReference{id:"synthetic_core".into(),revision:impact::MECHANISM_REVISION.into(),source:impact::ProfileSource::Estimated};
        Fragment{origin:Vec3::ZERO,dir:Vec3::new(0.0,0.0,1.0),energy_j:energy as f32,damage:0.0,is_penetrator:true,remaining_pen_mm:Some(150.0),impact_state:None,
            provenance:FragmentProvenance{fragment_id:"core".into(),parent_event_id:"plate:first".into(),source:FragmentSource::Core,source_layer_or_module:None,physical:Some(physical),weight:1.0,start_s:Some(0.02),profile:Some(profile)}}
    }

    #[test]
    fn allocated_serial_contacts_debit_local_energy_and_freeze_pre_hit_absorption() {
        let mut m=module(ModuleKind::Radio);m.center=Vec3::new(0.0,0.0,0.3);m.half_extents=Vec3::new(0.05,0.05,0.05);m.health=0.1;m.max_health=0.1;
        let mut modules=vec![m];let mut crew=vec![crew(CrewRole::Driver,1.0),crew(CrewRole::Gunner,2.0)];
        let f=kinetic_core(500.0);let s=propagate_allocated(&[f.clone()],&[3.0],&mut modules,&mut crew,true);
        let hits:Vec<_>=s.traces.iter().filter(|t|t.budget.is_some()).collect();assert_eq!(hits.len(),3);
        let expected=[10.0,500.0/30.0,500.0/30.0];
        for (trace,deposition) in hits.iter().zip(expected){trace.budget.unwrap().validate().unwrap();assert!((trace.budget.unwrap().target_deposition_j-deposition).abs()<1e-3);}
        assert_eq!(modules[0].health,0.0);
        for c in &crew {assert!((c.health-(100.0-deposited_crew_damage(500.0/30.0))).abs()<1e-3);}
        let first=trace_provenance(&f,hits[0]);let second=trace_provenance(&f,hits[1]);
        assert!(second.start_s.unwrap()>first.start_s.unwrap());
        assert!((second.physical.unwrap().energy_j-hits[0].budget.unwrap().core_out_j).abs()<1e-3);
        let remaining=s.fragment_states[0].1.energy_j();let deposited:f64=hits.iter().map(|t|t.budget.unwrap().target_deposition_j).sum();
        assert!((remaining+deposited-500.0).abs()<1e-3);
    }

    #[test]
    fn zero_energy_allocated_core_does_not_create_solid_damage() {
        let mut crew=vec![crew(CrewRole::Driver,1.0)];let mut modules=vec![];
        let summary=propagate_allocated(&[kinetic_core(0.0)],&[3.0],&mut modules,&mut crew,true);
        assert_eq!(crew[0].health,100.0);assert!(summary.crew_damage.is_empty());assert!(summary.impact_events.is_empty());
    }

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
        let f = Fragment { origin: Vec3::ZERO, dir: Vec3::new(0.0, 0.0, -1.0), energy_j: 1.0, damage: 150.0, is_penetrator: true, provenance: FragmentProvenance::default(), remaining_pen_mm: None, impact_state: None };
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
        let f = Fragment { origin: Vec3::ZERO, dir: Vec3::new(1.0, 0.0, 0.0), energy_j: 1.0, damage: 30.0, is_penetrator: false, provenance: FragmentProvenance::default(), remaining_pen_mm: None, impact_state: None };
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
        let f = Fragment { origin: Vec3::ZERO, dir: Vec3::new(1.0, 0.0, 0.0), energy_j: 1.0, damage: 150.0, is_penetrator: false, provenance: FragmentProvenance::default(), remaining_pen_mm: None, impact_state: None };
        let s = propagate(&[f.clone(), f], &mut mods, &mut crew, &DamageParams { frag_range_m: 10.0, ..Default::default() });
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
            let f = Fragment { origin: Vec3::ZERO, dir: Vec3::new(1.0, 0.0, 0.0), energy_j: 1.0, damage: 30.0, is_penetrator: false, provenance: FragmentProvenance::default(), remaining_pen_mm: None, impact_state: None };
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
        let f = Fragment { origin: Vec3::ZERO, dir: Vec3::new(1.0, 0.0, 0.0), energy_j: 1.0, damage: 30.0, is_penetrator: true, provenance: FragmentProvenance::default(), remaining_pen_mm: None, impact_state: None };
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
            let f = Fragment { origin: Vec3::ZERO, dir: Vec3::new(1.0, 0.0, 0.0), energy_j: 1.0, damage: 150.0, is_penetrator: false, provenance: FragmentProvenance::default(), remaining_pen_mm: None, impact_state: None };
            let s = propagate(&[f.clone(), f], &mut mods, &mut crew, &DamageParams { frag_range_m: 10.0, ..Default::default() });
            assert_eq!(s.module_damage, vec![(0, 10.0)]); assert_eq!(s.newly_destroyed_modules, vec![0]);
            assert_eq!(s.traces[1].target, Some(TargetRef::Module(0))); assert_eq!(s.traces[1].damage, 0.0);
            assert_eq!(crew[0].health, 100.0);
        }
    }

    #[test]
    fn excessive_crew_damage_is_clamped_and_records_actual_loss() {
        let mut crew = vec![crew(CrewRole::Driver, -1.0)];
        crew[0].health = 10.0;
        let f = Fragment { origin: Vec3::ZERO, dir: Vec3::new(0.0, 0.0, -1.0), energy_j: 1.0, damage: 150.0, is_penetrator: false, provenance: FragmentProvenance::default(), remaining_pen_mm: None, impact_state: None };
        let s = propagate(&[f.clone(), f], &mut [], &mut crew, &DamageParams::default());
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
