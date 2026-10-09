//! Headless vertical slice: muzzle -> flight -> plate -> penetration -> spall ->
//! module/crew damage -> ShotEvent. This is exactly what the authoritative server
//! runs per projectile; the client only ever receives the resulting ShotEvent.
use std::collections::BTreeMap;
use tg_armor::{first_hit, ArmorPlate, Material, MaterialDb};
use tg_ballistics::{Atmosphere, BallisticState};
use tg_damage::{capabilities, generate_fragments, propagate, Capabilities, Crew, DamageParams, Module, ModuleKind, TargetRef};
use tg_penetration::{resolve, ImpactContext, PenetrationResult};
use tg_replay::*;
use tg_shared::{Rng, Vec3};
use tg_weapon::ProjectileDef;

pub struct Data {
    pub materials: MaterialDb,
    pub projectile: ProjectileDef,
    pub plates: Vec<ArmorPlate>,
    pub modules: Vec<Module>,
    pub crew: Vec<Crew>,
}

impl Data {
    /// Loads the sample data compiled into the binary. The server loads the same
    /// JSON from disk / PostgreSQL at runtime instead.
    pub fn embedded() -> Data {
        let mats: Vec<Material> = serde_json::from_str(include_str!("../../../data/materials.json")).expect("materials");
        Data {
            materials: MaterialDb::from_vec(mats),
            projectile: serde_json::from_str(include_str!("../../../data/projectiles/ap_75.json")).expect("projectile"),
            plates: serde_json::from_str(include_str!("../../../data/vehicles/proto_a/armor.json")).expect("armor"),
            modules: serde_json::from_str(include_str!("../../../data/vehicles/proto_a/modules.json")).expect("modules"),
            crew: serde_json::from_str(include_str!("../../../data/vehicles/proto_a/crew.json")).expect("crew"),
        }
    }
}

pub struct Scenario {
    pub shooter_pos: Vec3,
    pub aim_point: Vec3,
    pub seed: u64,
}

pub struct ShotResult {
    pub event: ShotEvent,
    pub capabilities: Capabilities,
}

fn crew_name(c: &Crew) -> String {
    format!("crew:{}", c.role.as_str())
}

/// Simulates one shell against the target in `data` (mutating its modules/crew).
pub fn run_shot(sc: &Scenario, data: &mut Data) -> ShotResult {
    let atm = Atmosphere::default();
    let dir0 = (sc.aim_point - sc.shooter_pos).normalized();
    let mut st = BallisticState::from_muzzle(sc.shooter_pos, dir0, &data.projectile);
    let dt = 0.001;
    let mut t = 0.0f32;
    let mut path = vec![PathPoint { t, pos: st.pos }];
    let mut hit = None;

    for step in 0..5000 {
        let prev = st.pos;
        st.step(dt, &atm);
        t += dt;
        let seg = st.pos - prev;
        let len = seg.length();
        if len > 0.0 {
            if let Some(h) = first_hit(&data.plates, prev, seg * (1.0 / len), len) {
                hit = Some(h);
                break;
            }
        }
        if step % 10 == 0 {
            path.push(PathPoint { t, pos: st.pos });
        }
        if st.pos.y < 0.0 {
            break;
        }
    }

    let mut ev = ShotEvent {
        shot_id: sc.seed,
        tick: 0,
        seed: sc.seed,
        shooter_id: 1,
        target_id: 2,
        projectile_type: data.projectile.id.clone(),
        muzzle_position: sc.shooter_pos,
        impact_position: st.pos,
        impact_normal: Vec3::ZERO,
        armor_plate: String::new(),
        armor_thickness_mm: 0.0,
        impact_angle_deg: 0.0,
        effective_thickness_mm: 0.0,
        penetration_value_mm: 0.0,
        penetration_result: PenetrationOutcome::Miss,
        projectile_path: path,
        fragments: vec![],
        damaged_modules: vec![],
        damaged_crew: vec![],
        outcomes: vec![ShotOutcome::Miss],
    };

    if let Some((idx, h)) = hit {
        let plate = &data.plates[idx];
        let mat = data.materials.get(&plate.material).expect("material");
        let rep = resolve(&data.projectile, plate, mat, ImpactContext { incidence_deg: h.incidence_deg, distance_m: (h.point - sc.shooter_pos).length() });
        ev.impact_position = h.point;
        ev.impact_normal = h.facing_normal;
        ev.armor_plate = plate.id.clone();
        ev.armor_thickness_mm = plate.thickness_mm;
        ev.impact_angle_deg = rep.incidence_deg;
        ev.effective_thickness_mm = rep.required_mm;
        ev.penetration_value_mm = rep.penetration_mm;
        ev.projectile_path.push(PathPoint { t, pos: h.point });
        ev.outcomes.clear();

        match rep.result {
            PenetrationResult::Ricochet => {
                ev.penetration_result = PenetrationOutcome::Ricochet;
                ev.outcomes.push(ShotOutcome::Ricochet);
            }
            PenetrationResult::Stopped => {
                ev.penetration_result = PenetrationOutcome::Stopped;
                ev.outcomes.push(ShotOutcome::Stopped);
            }
            PenetrationResult::Shattered => {
                ev.penetration_result = PenetrationOutcome::Shattered;
                ev.outcomes.push(ShotOutcome::Shattered);
            }
            PenetrationResult::Penetrated { residual_mm, speed_fraction } => {
                ev.penetration_result = PenetrationOutcome::Penetrated;
                let v = st.speed() * speed_fraction;
                let energy = 0.5 * st.mass_kg * v * v;
                let dir = st.vel.normalized();
                let exit = h.point + dir * (plate.thickness_mm * 0.001);
                let params = DamageParams::default();
                let mut rng = Rng::new(sc.seed);
                let frags = generate_fragments(exit, dir, energy, residual_mm, &params, &mut rng);
                let summary = propagate(&frags, &mut data.modules, &mut data.crew, &params);

                for (f, tr) in frags.iter().zip(summary.traces.iter()) {
                    ev.fragments.push(FragmentRecord {
                        origin: tr.origin,
                        end: tr.end,
                        energy_j: f.energy_j,
                        damage: tr.damage,
                        is_penetrator: tr.is_penetrator,
                        hit: tr.target.map(|t| match t {
                            TargetRef::Module(i) => data.modules[i].id.clone(),
                            TargetRef::Crew(i) => crew_name(&data.crew[i]),
                        }),
                    });
                }
                let mut md: BTreeMap<usize, f32> = BTreeMap::new();
                for (i, d) in &summary.module_damage {
                    *md.entry(*i).or_default() += d;
                }
                for (i, d) in md {
                    let m = &data.modules[i];
                    let destroyed = summary.newly_destroyed_modules.contains(&i);
                    ev.damaged_modules.push(DamagedModule { id: m.id.clone(), kind: m.kind.as_str().to_string(), damage: d, destroyed });
                    ev.outcomes.push(if destroyed {
                        match m.kind {
                            ModuleKind::AmmoRack => ShotOutcome::AmmoDetonation,
                            ModuleKind::FuelTank => ShotOutcome::FuelFire,
                            ModuleKind::Engine => ShotOutcome::EngineDamaged,
                            ModuleKind::GunBarrel => ShotOutcome::BarrelDamaged,
                            ModuleKind::GunBreech => ShotOutcome::BreechDamaged,
                            ModuleKind::Track => ShotOutcome::TrackBroken,
                            _ => ShotOutcome::ModuleDamaged,
                        }
                    } else {
                        ShotOutcome::ModuleDamaged
                    });
                }
                let mut cd: BTreeMap<usize, f32> = BTreeMap::new();
                for (i, d) in &summary.crew_damage {
                    *cd.entry(*i).or_default() += d;
                }
                for (i, d) in cd {
                    let killed = summary.newly_killed_crew.contains(&i);
                    ev.damaged_crew.push(DamagedCrew { role: data.crew[i].role.as_str().to_string(), damage: d, killed });
                    ev.outcomes.push(if killed { ShotOutcome::CrewKilled } else { ShotOutcome::CrewInjured });
                }
                if ev.outcomes.is_empty() {
                    ev.outcomes.push(ShotOutcome::PenetratedNoDamage);
                }
            }
        }
    }
    let cap = capabilities(&data.modules, &data.crew);
    ShotResult { event: ev, capabilities: cap }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn side_shot(seed: u64) -> Scenario {
        Scenario { shooter_pos: Vec3::new(101.1, 1.6, 0.2), aim_point: Vec3::new(1.1, 1.6, 0.2), seed }
    }

    #[test]
    fn full_chain_penetrates_and_generates_spall() {
        let mut d = Data::embedded();
        let r = run_shot(&side_shot(1234), &mut d);
        assert_eq!(r.event.penetration_result, PenetrationOutcome::Penetrated);
        assert_eq!(r.event.armor_plate, "turret_side_r");
        assert!(r.event.fragments.len() > 5);
        assert!(r.event.projectile_path.len() > 2);
        assert!(r.event.impact_angle_deg < 1.0);
    }

    #[test]
    fn same_seed_same_event() {
        let (mut a, mut b) = (Data::embedded(), Data::embedded());
        let (ea, eb) = (run_shot(&side_shot(99), &mut a).event, run_shot(&side_shot(99), &mut b).event);
        assert_eq!(ea.fragments.len(), eb.fragments.len());
        assert_eq!(ea.outcomes, eb.outcomes);
    }

    #[test]
    fn weak_gun_is_stopped_by_armor() {
        let mut d = Data::embedded();
        d.projectile.penetration_curve.iter_mut().for_each(|p| p.pen_mm = 40.0);
        let r = run_shot(&side_shot(5), &mut d);
        assert_eq!(r.event.penetration_result, PenetrationOutcome::Stopped);
        assert!(r.event.fragments.is_empty());
    }

    #[test]
    fn shot_that_misses_reports_miss() {
        let mut d = Data::embedded();
        let r = run_shot(&Scenario { shooter_pos: Vec3::new(101.1, 1.6, 50.0), aim_point: Vec3::new(1.1, 1.6, 50.0), seed: 3 }, &mut d);
        assert_eq!(r.event.penetration_result, PenetrationOutcome::Miss);
    }
}
