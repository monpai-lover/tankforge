use super::*;
use tg_armor::ArmorKind;
use tg_weapon::CurvePoint;

fn rha() -> Vec<Material> {
    vec![Material { id: "rha".into(), kind: ArmorKind::Rha, density_kg_m3: 7850.0, hardness_bhn: 300.0, kinetic_factor: 1.0, chemical_factor: 1.0 }]
}

fn plate(id: &str, zone: ArmorZone, mm: f32, c: [f32; 3], n: [f32; 3], u: [f32; 3], hu: f32, hv: f32) -> ArmorPlate {
    ArmorPlate { id: id.into(), zone, material: "rha".into(), thickness_mm: mm, center: Vec3::new(c[0], c[1], c[2]), normal: Vec3::new(n[0], n[1], n[2]), axis_u: Vec3::new(u[0], u[1], u[2]), half_u: hu, half_v: hv, curvature: 0.0, polygon: Vec::new(), hinge: None }
}

fn module(id: &str, kind: ModuleKind, c: [f32; 3], h: [f32; 3], hp: f32) -> Module {
    Module { id: id.into(), kind, center: Vec3::new(c[0], c[1], c[2]), half_extents: Vec3::new(h[0], h[1], h[2]), max_health: hp, health: hp, rounds: None, weapon_group: None }
}

fn crew(role: CrewRole, p: [f32; 3]) -> Crew {
    Crew { role, pos: Vec3::new(p[0], p[1], p[2]), radius: 0.28, health: 100.0, also: Vec::new(), pose: None }
}

#[test]
fn launcher_apparatus_has_its_own_damage_kind_and_disables_firing_when_destroyed() {
    let kind: ModuleKind = serde_json::from_str("\"launcher\"").expect("launcher apparatus must deserialize independently of cannon parts");
    assert_eq!(kind.as_str(), "launcher");
    assert!(kind.is_external(), "launch apparatus is exposed to direct impacts");
    let mut target = box_tank(false).def;
    target.modules.retain(|m| !matches!(m.kind, ModuleKind::GunBreech | ModuleKind::GunBarrel));
    target.modules.push(module("launcher", kind, [0.0, 2.5, 0.0], [0.4, 0.1, 0.5], 70.0));
    let target = Target::new(target, &rha());
    let mut state = target.fresh_state();
    assert!(caps(&target, &state).can_fire);
    let index = target.def.modules.len() - 1;
    state.modules[index] = 0.0;
    assert!(!caps(&target, &state).can_fire);
    let mods = target.def.modules.iter().enumerate().map(|(i, m)| { let mut m = m.clone(); m.health = state.modules[i]; m }).collect::<Vec<_>>();
    assert!(!tg_damage::capabilities(&mods, &target.def.crew).can_fire);
    assert!(!caps(&target, &state).ammo_detonated, "apparatus damage does not manufacture a warhead detonation");
    state.modules[index] = 70.0;
    assert!(caps(&target, &state).can_fire);
}

/// A box tank: hull 3 m wide, 6 m long, 0.4..1.8 m high; turret 2 x 2.4 x 0.9 on top.
fn box_tank(open_top: bool) -> Target {
    let x = [1.0, 0.0, 0.0];
    let z = [0.0, 0.0, 1.0];
    let y = [0.0, 1.0, 0.0];
    let mut plates = vec![
        plate("hull_front", ArmorZone::HullUpperFront, 80.0, [0.0, 1.1, 3.0], [0.0, 0.0, 1.0], x, 1.5, 0.7),
        plate("hull_rear", ArmorZone::HullRear, 30.0, [0.0, 1.1, -3.0], [0.0, 0.0, -1.0], x, 1.5, 0.7),
        plate("hull_side_l", ArmorZone::HullSide, 40.0, [-1.5, 1.1, 0.0], [-1.0, 0.0, 0.0], z, 3.0, 0.7),
        plate("hull_side_r", ArmorZone::HullSide, 40.0, [1.5, 1.1, 0.0], [1.0, 0.0, 0.0], z, 3.0, 0.7),
        plate("hull_floor", ArmorZone::HullFloor, 15.0, [0.0, 0.4, 0.0], [0.0, -1.0, 0.0], x, 1.5, 3.0),
    ];
    if !open_top {
        plates.push(plate("hull_roof", ArmorZone::HullRoof, 12.0, [0.0, 1.8, 0.0], [0.0, 1.0, 0.0], x, 1.5, 3.0));
        plates.extend([
            plate("turret_front", ArmorZone::TurretFront, 100.0, [0.0, 2.25, 1.2], [0.0, 0.0, 1.0], x, 1.0, 0.45),
            plate("turret_rear", ArmorZone::TurretRear, 45.0, [0.0, 2.25, -1.2], [0.0, 0.0, -1.0], x, 1.0, 0.45),
            plate("turret_side_l", ArmorZone::TurretSide, 50.0, [-1.0, 2.25, 0.0], [-1.0, 0.0, 0.0], z, 1.2, 0.45),
            plate("turret_side_r", ArmorZone::TurretSide, 50.0, [1.0, 2.25, 0.0], [1.0, 0.0, 0.0], z, 1.2, 0.45),
            plate("turret_roof", ArmorZone::TurretRoof, 10.0, [0.0, 2.7, 0.0], y, x, 1.0, 1.2),
        ]);
    }
    let modules = vec![
        module("engine", ModuleKind::Engine, [0.0, 1.0, -2.0], [0.6, 0.45, 0.7], 160.0),
        module("transmission", ModuleKind::Transmission, [0.0, 0.8, 2.4], [0.5, 0.3, 0.4], 130.0),
        module("fuel_l", ModuleKind::FuelTank, [-1.1, 1.2, -1.6], [0.3, 0.3, 0.5], 50.0),
        module("ammo_r", ModuleKind::AmmoRack, [1.15, 1.0, 0.2], [0.25, 0.35, 0.6], 40.0),
        module("breech", ModuleKind::GunBreech, [0.0, 2.2, 0.4], [0.2, 0.15, 0.5], 120.0),
        module("barrel", ModuleKind::GunBarrel, [0.0, 2.2, 3.2], [0.08, 0.08, 1.9], 110.0),
        module("track_l", ModuleKind::Track, [-1.75, 0.45, 0.0], [0.25, 0.45, 3.2], 90.0),
        module("track_r", ModuleKind::Track, [1.75, 0.45, 0.0], [0.25, 0.45, 3.2], 90.0),
        module("turret_drive", ModuleKind::TurretDrive, [0.5, 1.95, -0.3], [0.15, 0.12, 0.15], 60.0),
    ];
    let crew = vec![
        crew(CrewRole::Driver, [-0.6, 1.1, 1.9]),
        crew(CrewRole::RadioOperator, [0.6, 1.1, 1.9]),
        crew(CrewRole::Gunner, [-0.45, 2.1, 0.3]),
        crew(CrewRole::Commander, [-0.45, 2.3, -0.6]),
        crew(CrewRole::Loader, [0.45, 2.0, -0.2]),
    ];
    let def = TargetDef { id: "box".into(), plates, modules, crew, turret: Some(TurretGeom { pivot: Vec3::new(0.0, 1.8, 0.0), size: Vec3::new(2.0, 0.9, 2.4) }), open_top, ammo_capacity: 0 };
    Target::new(def, &rha())
}

fn shell(kind: ProjectileKind, cal: f32, mass: f32, pen: f32, filler: f32) -> ProjectileDef {
    ProjectileDef {
        id: format!("{:?}", kind).to_lowercase(),
        name: "test".into(),
        kind,
        caliber_mm: cal,
        mass_kg: mass,
        muzzle_velocity_ms: 800.0,
        explosive_mass_kg: filler,
        explosive_type: "tnt".into(),
        penetrator_material: "steel".into(),
        length_mm: 300.0,
        drag_coefficient: 0.3,
        penetration_curve: vec![CurvePoint { distance_m: 0.0, pen_mm: pen }, CurvePoint { distance_m: 2000.0, pen_mm: pen }],
        ricochet_angle_deg: 70.0,
        normalization_deg: 4.0,
        shatter_angle_deg: 90.0,
        fuse_delay_s: 0.0012,
        fuse_sensitivity_mm: 15.0,
    }
}

fn ap() -> ProjectileDef {
    shell(ProjectileKind::Apcbc, 75.0, 6.8, 110.0, 0.0)
}
fn aphe() -> ProjectileDef {
    shell(ProjectileKind::Aphe, 85.0, 9.2, 120.0, 0.048)
}
fn he() -> ProjectileDef {
    shell(ProjectileKind::He, 75.0, 6.3, 10.0, 0.68)
}

/// From the right, level, at the middle of the hull side.
fn side_shot(s: ProjectileDef, seed: u64) -> Shot {
    Shot { shell: s, origin: Vec3::new(30.0, 1.15, 0.1), dir: Vec3::new(-1.0, 0.0, 0.0), speed_ms: 700.0, distance_m: 500.0, seed, turret_yaw: 0.0 }
}

#[test]
fn solid_shot_through_the_side_sprays_spall_and_hurts_what_is_inside() {
    let t = box_tank(false);
    let st = t.fresh_state();
    let r = shoot(&t, &st, &side_shot(ap(), 7));
    assert_eq!(r.outcome, Outcome::Penetrated);
    assert_eq!(r.plate.as_deref(), Some("hull_side_r"));
    assert!(r.layers[0].passed && r.layers[0].angle_deg < 1.0);
    assert!(r.fragments.iter().filter(|f| f.kind == "spall").count() >= 5);
    // the ammunition beside the right wall is right behind the plate
    assert!(r.modules.iter().any(|m| m.id == "ammo_r"));
    assert!(r.bursts.is_empty());
    // the state carries over: the next shot finds the damage already done
    assert!(r.state.modules[3] < 40.0);
    assert_eq!(r.path.first().copied(), r.impact);
}

#[test]
fn thick_front_stops_the_round_and_steep_hits_glance_off() {
    let t = box_tank(false);
    let st = t.fresh_state();
    let front = Shot { origin: Vec3::new(0.3, 1.1, 40.0), dir: Vec3::new(0.0, 0.0, -1.0), ..side_shot(shell(ProjectileKind::Apcbc, 75.0, 6.8, 70.0, 0.0), 3) };
    let r = shoot(&t, &st, &front);
    assert_eq!(r.outcome, Outcome::Stopped);
    assert!(r.modules.is_empty() && r.crew.is_empty());
    assert_eq!(r.title, "未擊穿");
    // 75 degrees off the side plate's normal
    let a = 75f32.to_radians();
    let glance = Shot { origin: Vec3::new(1.5 + 20.0 * a.cos(), 1.1, 20.0 * a.sin()), dir: Vec3::new(-a.cos(), 0.0, -a.sin()), ..side_shot(ap(), 3) };
    let r = shoot(&t, &st, &glance);
    assert_eq!(r.outcome, Outcome::Ricochet);
    assert!(r.ricochet_dir.unwrap().x > 0.0);
}

#[test]
fn aphe_bursts_inside_and_kills_more_than_solid_shot() {
    let t = box_tank(false);
    let st = t.fresh_state();
    let turret_side = |s: ProjectileDef, seed| Shot { origin: Vec3::new(30.0, 2.2, 0.0), dir: Vec3::new(-1.0, 0.0, 0.0), ..side_shot(s, seed) };
    let (mut solid, mut burst) = (0usize, 0usize);
    for seed in 1..40u64 {
        let r = shoot(&t, &st, &turret_side(aphe(), seed));
        assert!(r.bursts.iter().any(|b| b.inside), "seed {seed}: {:?}", r.events);
        burst += r.crew.iter().filter(|c| c.killed).count();
        let r = shoot(&t, &st, &turret_side(ap(), seed));
        solid += r.crew.iter().filter(|c| c.killed).count();
    }
    assert!(burst > solid, "aphe {burst} vs solid {solid}");
}

#[test]
fn aphe_through_thin_plate_does_not_start_its_fuse() {
    let t = box_tank(false);
    let st = t.fresh_state();
    // straight down through the 10 mm turret roof: under the 15 mm sensitivity
    let r = shoot(&t, &st, &Shot { origin: Vec3::new(0.2, 20.0, 0.5), dir: Vec3::new(0.0, -1.0, 0.0), ..side_shot(aphe(), 5) });
    assert_eq!(r.plate.as_deref(), Some("turret_roof"));
    assert!(r.bursts.iter().all(|b| !b.inside || r.layers.iter().any(|l| l.thickness_mm >= 15.0 && l.passed)));
}

#[test]
fn he_bursts_outside_heavy_armour_but_wrecks_the_track_it_lands_on() {
    let t = box_tank(false);
    let st = t.fresh_state();
    let r = shoot(&t, &st, &side_shot(he(), 9));
    assert_eq!(r.outcome, Outcome::Blast);
    assert!(r.crew.is_empty(), "a closed vehicle's crew is safe from an outside burst");
    // low on the side: the burst is on the track itself
    let low = Shot { origin: Vec3::new(30.0, 0.5, 0.0), ..side_shot(he(), 9) };
    let r = shoot(&t, &st, &low);
    assert!(r.events.iter().any(|e| e == "track_right"), "{:?}", r.events);
    assert!(!r.caps.track_right && r.caps.track_left);
    assert_eq!(r.title, "右履帶斷裂");
}

#[test]
fn big_he_breaks_in_through_thin_roof_armour() {
    let t = box_tank(false);
    let st = t.fresh_state();
    let big = shell(ProjectileKind::He, 152.0, 43.0, 45.0, 5.9);
    let r = shoot(&t, &st, &Shot { origin: Vec3::new(-0.3, 20.0, 0.0), dir: Vec3::new(0.0, -1.0, 0.0), ..side_shot(big, 2) });
    assert_eq!(r.outcome, Outcome::Overpressure);
    assert!(r.crew.iter().filter(|c| c.killed).count() >= 2, "{:?}", r.crew);
    assert!(he_pen_mm(0.68) > 9.0 && he_pen_mm(0.68) < 11.0);
    assert!(he_pen_mm(3.6) > 29.0 && he_pen_mm(3.6) < 33.0);
}

#[test]
fn a_dead_engine_stops_the_vehicle_until_it_is_repaired() {
    let t = box_tank(false);
    let st = t.fresh_state();
    // from behind, through the 30 mm rear plate into the engine
    let r = shoot(&t, &st, &Shot { origin: Vec3::new(0.0, 1.0, -30.0), dir: Vec3::new(0.0, 0.0, 1.0), ..side_shot(ap(), 4) });
    assert!(r.events.iter().any(|e| e == "engine"), "{:?}", r.events);
    assert!(!r.caps.can_move && r.caps.engine_power == 0.0);
    let mut s = r.state.clone();
    assert!(start_repair(&t, &mut s));
    assert!(!caps(&t, &s).can_move, "no driving off while the crew is at work");
    let total = s.repair_s;
    let mut done = false;
    let mut k = 0;
    while k < 1000 && !done {
        done = advance(&t, &mut s, 0.5, k).iter().any(|e| e == "repaired");
        k += 1;
    }
    assert!(done && (k as f32) * 0.5 >= total - 0.5);
    let c = caps(&t, &s);
    assert!(c.can_move && c.engine_power > 0.0);
}

#[test]
fn engine_block_shields_what_is_behind_it() {
    let t = box_tank(false);
    let mut st = t.fresh_state();
    let p = t.posed(0.0);
    let mut w = Work { t: &t, p, st: st.clone(), rng: Rng::new(1), rep: shoot(&t, &st, &side_shot(ap(), 1)), mod_dmg: HashMap::new(), crew_dmg: HashMap::new(), newly_destroyed: vec![], newly_killed: vec![] };
    w.rep.fragments.clear();
    // a fragment straight through the engine towards the rear wall stops in the block
    w.fragment(Vec3::new(0.0, 1.0, -0.8), Vec3::new(0.0, 0.0, -1.0), 8000.0, "spall", 4.0);
    let f = &w.rep.fragments[0];
    assert_eq!(f.hit.as_deref(), Some("engine"));
    assert!((f.to.z - (-1.3)).abs() < 0.05, "stopped at the face of the block, not at the wall: {:?}", f.to);
    st = w.st;
    assert!(st.modules[0] < 160.0);
}

#[test]
fn ammunition_that_goes_up_destroys_the_vehicle() {
    let t = box_tank(false);
    let mut st = t.fresh_state();
    st.modules[3] = 1.0; // the rack is all but gone
    let mut detonated = 0;
    for seed in 1..30u64 {
        let r = shoot(&t, &st, &side_shot(ap(), seed));
        if r.events.iter().any(|e| e == "ammo_detonation") {
            detonated += 1;
            assert!(r.caps.destroyed && r.events.iter().any(|e| e == "destroyed"));
            assert_eq!(r.title, "彈藥殉爆　擊毀");
        }
    }
    assert!(detonated > 10, "{detonated}");
}

#[test]
fn an_empty_rack_cannot_go_up() {
    let mut t = box_tank(false);
    // a second rack low on the floor: a short load keeps its rounds there
    t.def.modules.push(module("ammo_floor", ModuleKind::AmmoRack, [0.0, 0.5, 0.0], [0.5, 0.15, 0.5], 40.0));
    t.def.ammo_capacity = 60;
    let t = Target::new(t.def, &rha());
    let fill = rack_fill(&t.def, 20, 60);
    assert_eq!(fill[3], 0.0, "the side rack is emptied first: {fill:?}");
    assert!(fill[9] > 0.0 && fill[0] == 1.0);
    let mut st = t.fresh_state();
    load_ammo(&t, &mut st, 20);
    st.modules[3] = 1.0;
    for seed in 1..30u64 {
        let r = shoot(&t, &st, &side_shot(ap(), seed));
        assert!(r.modules.iter().all(|m| m.id != "ammo_r"), "an empty rack takes no hits");
        // only the floor rack (the one with rounds in it) can set the load off
        assert!(!r.events.iter().any(|e| e == "ammo_detonation") || r.modules.iter().any(|m| m.id == "ammo_floor" && m.destroyed), "seed {seed}");
    }
    // a full load: the same rack goes up again
    load_ammo(&t, &mut st, 60);
    assert!((1..30u64).any(|seed| shoot(&t, &st, &side_shot(ap(), seed)).events.iter().any(|e| e == "ammo_detonation")));
}

#[test]
fn someone_takes_over_the_gunners_seat() {
    let t = box_tank(false);
    let mut st = t.fresh_state();
    st.crew[2] = 0.0; // gunner
    plan_swaps(&t, &mut st);
    assert!(!caps(&t, &st).gunner && !caps(&t, &st).can_fire);
    // the radio operator moves up first
    assert_eq!(st.swaps[0].crew, 1);
    let mut k = 0;
    while caps(&t, &st).can_fire == false && k < 100 {
        advance(&t, &mut st, 0.5, k);
        k += 1;
    }
    assert!(caps(&t, &st).gunner && (k as f32) * 0.5 >= SWAP_S - 0.01);
    assert_eq!(st.roles[1], CrewRole::Gunner);
}

#[test]
fn losing_all_but_one_of_the_crew_puts_the_vehicle_out() {
    let t = box_tank(false);
    let mut st = t.fresh_state();
    for i in 0..4 {
        st.crew[i] = 0.0;
    }
    assert!(check_destroyed(&mut st));
}

#[test]
fn machine_gun_bullets_bounce_off_armour_but_hit_an_open_crew() {
    let closed = box_tank(false);
    let open = box_tank(true);
    let mg = shell(ProjectileKind::Ap, 12.7, 0.046, 22.0, 0.0);
    let into_turret = |seed| Shot { origin: Vec3::new(30.0, 2.3, -0.6), dir: Vec3::new(-1.0, 0.0, 0.0), speed_ms: 820.0, ..side_shot(mg.clone(), seed) };
    let r = shoot(&closed, &closed.fresh_state(), &into_turret(1));
    assert_eq!(r.outcome, Outcome::Stopped, "{:?} {:?}", r.plate, r.layers);
    let r = shoot(&open, &open.fresh_state(), &into_turret(1));
    assert_eq!(r.outcome, Outcome::Unarmoured, "{:?} {:?} {:?} {:?}", r.hit, r.crew, r.fragments, (open.lo, open.hi));
    assert!(r.crew.iter().any(|c| c.role == CrewRole::Commander && c.damage > 50.0), "{:?}", r.crew);
    assert!(r.fragments.iter().all(|f| f.kind != "spall"));
}

#[test]
fn the_turret_turns_its_armour_with_it() {
    let t = box_tank(false);
    let st = t.fresh_state();
    let at_turret = |yaw| Shot { origin: Vec3::new(30.0, 2.25, 0.5), dir: Vec3::new(-1.0, 0.0, 0.0), turret_yaw: yaw, ..side_shot(ap(), 2) };
    assert_eq!(shoot(&t, &st, &at_turret(0.0)).plate.as_deref(), Some("turret_side_r"));
    // turned 90 degrees to the right: the 100 mm front now faces this way
    let r = shoot(&t, &st, &at_turret(std::f32::consts::FRAC_PI_2));
    assert_eq!(r.plate.as_deref(), Some("turret_front"));
    assert_eq!(r.layers[0].thickness_mm, 100.0);
}

#[test]
fn the_same_seed_gives_the_same_shot() {
    let t = box_tank(false);
    let st = t.fresh_state();
    let a = serde_json::to_string(&shoot(&t, &st, &side_shot(aphe(), 11))).unwrap();
    let b = serde_json::to_string(&shoot(&t, &st, &side_shot(aphe(), 11))).unwrap();
    assert_eq!(a, b);
}

#[test]
fn fire_burns_out_or_is_put_out() {
    let t = box_tank(false);
    let mut st = t.fresh_state();
    st.fire_s = FIRE_S;
    st.fire_at = Some(Vec3::new(-1.1, 1.2, -1.6));
    assert!(caps(&t, &st).on_fire);
    assert!(extinguish(&mut st));
    assert!(!extinguish(&mut st), "one extinguisher");
    let ev = advance(&t, &mut st, 2.0, 1);
    assert!(ev.iter().any(|e| e == "fire_out") && !caps(&t, &st).on_fire);
}

#[test]
fn an_he_shell_landing_beside_an_open_vehicle_hurts_its_crew() {
    let open = box_tank(true);
    let r = splash(&open, &open.fresh_state(), Vec3::new(2.4, 0.3, 0.0), 0.68, 0.0, 3);
    assert!(r.crew.iter().any(|c| c.damage > 0.0) || r.modules.iter().any(|m| m.id == "track_r"));
    let closed = box_tank(false);
    let r = splash(&closed, &closed.fresh_state(), Vec3::new(2.4, 0.3, 0.0), 0.68, 0.0, 3);
    assert!(r.crew.is_empty());
}

#[test]
fn folding_hull_side_armor_changes_shell_and_splash_protection_without_reindexing_the_crew() {
    let mut base = box_tank(true).def;
    let mut flap = plate("fold_side", ArmorZone::TurretSide, 200.0,
        [1.5, 2.2, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0], 3.0, 0.4);
    flap.hinge = Some(tg_armor::ArmorHinge { a: [1.5, 1.8, -3.0], b: [1.5, 1.8, 3.0], angle: -90.0 });
    base.plates.push(flap);
    let upright = Target::new(base, &rha());
    let folded = upright.folded(1.0);
    let idx = folded.def.plates.len() - 1;
    assert!((folded.posed(1.2).plates[idx].center - folded.def.plates[idx].center).length() < 1e-5,
        "a hull-mounted foldable wall must not turn with the gun");
    assert_eq!(upright.def.modules.len(), folded.def.modules.len());
    assert_eq!(upright.def.crew.len(), folded.def.crew.len());
    for (a, b) in upright.def.modules.iter().zip(&folded.def.modules) { assert_eq!(a.id, b.id); }
    for (a, b) in upright.def.crew.iter().zip(&folded.def.crew) { assert_eq!(a.pos, b.pos); }
    let state = upright.fresh_state();
    let shot = Shot { shell: ProjectileDef::generic_ap(75.0, 120.0), origin: Vec3::new(4.0, 2.2, 0.0),
        dir: Vec3::new(-1.0, 0.0, 0.0), speed_ms: 800.0, distance_m: 0.0, seed: 17, turret_yaw: 0.0 };
    let raised_hit = shoot(&upright, &state, &shot);
    let lowered_hit = shoot(&folded, &state, &shot);
    assert_eq!(raised_hit.plate.as_deref(), Some("fold_side"));
    assert_ne!(lowered_hit.plate.as_deref(), Some("fold_side"));
    let blast_at = Vec3::new(2.4, 1.6, 0.0);
    // Keep the burst outside the lowered wall's 2.3 m tip, and close enough to reach the
    // gunner: 0.68 kg only reaches 2.67 m of open crew, short of this 2.91 m line.
    let blast_kg = 1.2;
    assert!((upright.def.crew[2].pos - blast_at).length() < outside_radius_m(blast_kg) * 1.4);
    let raised_blast = splash(&upright, &state, blast_at, blast_kg, 0.0, 31);
    let lowered_blast = splash(&folded, &state, blast_at, blast_kg, 0.0, 31);
    assert!(!raised_blast.crew.iter().any(|c| c.index == 2 && c.damage > 0.0));
    assert!(lowered_blast.crew.iter().any(|c| c.index == 2 && c.damage > 0.0));
    let mut narrow = upright.def.clone();
    narrow.plates = vec![narrow.plates.last().unwrap().clone()];
    narrow.modules.clear(); narrow.crew.clear(); narrow.turret = None;
    let narrow = Target::new(narrow, &rha());
    assert!(narrow.folded(1.0).hi.x > narrow.hi.x + 0.6,
        "folded wall corners must remain inside the shot/missile broadphase bounds");
}

/// Every vehicle in data/ loads as a target and takes a side shot without trouble.
#[test]
fn every_data_vehicle_is_a_target() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let mats: Vec<Material> = serde_json::from_str(&std::fs::read_to_string(root.join("materials.json")).unwrap()).unwrap();
    let mut n = 0;
    for e in std::fs::read_dir(root.join("vehicles")).unwrap().flatten() {
        let dir = e.path();
        let read = |f: &str| std::fs::read_to_string(dir.join(f)).unwrap();
        let vehicle: serde_json::Value = serde_json::from_str(&read("vehicle.json")).unwrap();
        let def = target_from_files(&e.file_name().to_string_lossy(), &vehicle, serde_json::from_str(&read("armor.json")).unwrap(), serde_json::from_str(&read("modules.json")).unwrap(), serde_json::from_str(&read("crew.json")).unwrap());
        let t = Target::new(def, &mats);
        let st = t.fresh_state();
        // level from the right, through the driver's seat
        let c = t.def.crew[0].pos;
        let r = shoot(&t, &st, &Shot { origin: Vec3::new(40.0, c.y, c.z), dir: Vec3::new(-1.0, 0.0, 0.0), ..side_shot(aphe(), 1) });
        assert!(r.hit, "{:?} side shot missed: {:?} {:?}", dir, t.lo, t.hi);
        n += 1;
    }
    assert!(n >= 10);
}
