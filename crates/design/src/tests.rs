//! End-to-end tests on a small hand-built design: a box hull with outboard tracks and a box
//! turret. Each test changes one thing and checks that the consequence shows up where the
//! game would feel it (mass, loads, gun limits, legality, shots).
use crate::model::*;
use crate::trace::{protection_map, shoot, ProtectRequest, ShotRequest, TargetState};
use crate::v3::{v3, V3};
use crate::*;

fn boxm(min: V3, max: V3, tags: [&str; 6]) -> MeshDef {
    let c = |i: usize| v3(if i & 1 == 1 { max.x } else { min.x }, if i & 2 == 2 { max.y } else { min.y }, if i & 4 == 4 { max.z } else { min.z });
    let f = |id: u32, v: [u32; 4], tag: &str| FaceDef { id, v: v.to_vec(), tag: tag.into() };
    MeshDef {
        vertices: (0..8).map(c).collect(),
        faces: vec![
            f(0, [4, 5, 7, 6], tags[0]),
            f(1, [1, 0, 2, 3], tags[1]),
            f(2, [5, 1, 3, 7], tags[2]),
            f(3, [0, 4, 6, 2], tags[3]),
            f(4, [6, 7, 3, 2], tags[4]),
            f(5, [0, 1, 5, 4], tags[5]),
        ],
    }
}

fn plate(body: Body, face: u32, mm: f64) -> ArmorFaceDef {
    ArmorFaceDef { body, face, material: "rha".into(), thickness_mm: mm, vertex_mm: None, map: None }
}

pub fn sample() -> VehicleDesign {
    let hull = boxm(v3(-1.0, 0.45, -3.0), v3(1.0, 1.55, 3.0), ["front", "rear", "side_r", "side_l", "roof", "floor"]);
    let turret = boxm(v3(-0.9, 0.0, -1.0), v3(0.9, 0.85, 1.1), ["front", "rear", "side_r", "side_l", "roof", "floor"]);
    let hull_mm = [80.0, 40.0, 45.0, 45.0, 20.0, 20.0];
    let tur_mm = [90.0, 45.0, 50.0, 50.0, 20.0, 15.0];
    let mut armor_faces: Vec<ArmorFaceDef> = (0..6).map(|i| plate(Body::Hull, i, hull_mm[i as usize])).collect();
    armor_faces.extend((0..6).map(|i| plate(Body::Turret, i, tur_mm[i as usize])));
    let module = |id: &str, kind: ModuleKindDef, mount: Body, c: V3, size: Option<V3>| ModuleDef { id: id.into(), kind, mount, center_m: c, size_m: size };
    let crew = |role: CrewRoleDef, mount: Body, p: V3| CrewDef { role, mount, position_m: p };
    VehicleDesign {
        schema: SCHEMA.into(),
        id: "test_box".into(),
        name: "測試箱車".into(),
        hull_geometry: hull,
        turret_geometry: Some(turret),
        armor_faces,
        armor_layers: vec![],
        addons: vec![],
        turret_ring: Some(TurretRingDef { diameter_m: 1.6, position_m: v3(0.0, 1.55, 0.2), rotation_axis: V3::Y, drive: "electric".into() }),
        gun_mount: Some(GunMountDef {
            position_m: v3(0.0, 0.45, 0.95),
            elevation_axis: V3::X,
            min_elevation_deg: -8.0,
            max_elevation_deg: 20.0,
            recoil_distance_m: 0.42,
            mantlet: MantletDef { width_m: 0.6, height_m: 0.45, thickness_mm: 60.0, material: "cha".into(), offset_m: 0.16 },
        }),
        internal_modules: vec![
            module("engine", ModuleKindDef::Engine, Body::Hull, v3(0.0, 0.95, -2.15), None),
            module("transmission", ModuleKindDef::Transmission, Body::Hull, v3(0.0, 0.82, 2.45), None),
            module("fuel_l", ModuleKindDef::FuelTank, Body::Hull, v3(-0.79, 0.95, -2.1), Some(v3(0.3, 0.8, 1.2))),
            module("fuel_r", ModuleKindDef::FuelTank, Body::Hull, v3(0.79, 0.95, -2.1), Some(v3(0.3, 0.8, 1.2))),
            module("rack_floor", ModuleKindDef::AmmoRack, Body::Hull, v3(0.0, 0.66, 0.2), Some(v3(0.9, 0.35, 0.6))),
            module("rack_l", ModuleKindDef::AmmoRack, Body::Hull, v3(-0.75, 0.95, -1.0), Some(v3(0.35, 0.8, 0.6))),
            module("rack_r", ModuleKindDef::AmmoRack, Body::Hull, v3(0.75, 0.95, -1.0), Some(v3(0.35, 0.8, 0.6))),
            module("rack_ready", ModuleKindDef::AmmoRack, Body::Turret, v3(0.4, 0.55, -0.8), Some(v3(0.75, 0.3, 0.25))),
            module("radio", ModuleKindDef::Radio, Body::Hull, v3(0.62, 1.32, 2.2), None),
            module("drive", ModuleKindDef::TurretDrive, Body::Turret, v3(0.6, 0.15, 0.75), None),
        ],
        crew_positions: vec![
            crew(CrewRoleDef::Driver, Body::Hull, v3(-0.5, 1.0, 1.55)),
            crew(CrewRoleDef::RadioOperator, Body::Hull, v3(0.5, 1.0, 1.55)),
            crew(CrewRoleDef::Gunner, Body::Turret, v3(-0.44, 0.1, 0.25)),
            crew(CrewRoleDef::Commander, Body::Turret, v3(-0.45, 0.35, -0.45)),
            crew(CrewRoleDef::Loader, Body::Turret, v3(0.5, 0.1, 0.0)),
        ],
        engine: EngineChoice { kind: "gasoline".into(), power_hp: 500.0 },
        transmission: TransmissionChoice { kind: "synchromesh".into(), forward_gears: 5, gearing_kmh: 42.0, steering: "regenerative".into() },
        suspension: SuspensionChoice { kind: "torsion_bar".into(), stations: 6, wheel_diameter_m: 0.66, front_z_m: 2.2, rear_z_m: -2.2, sprocket: "rear".into() },
        tracks: TracksChoice { width_m: 0.5, center_x_m: 1.33 },
        weapons: Some(WeaponsChoice { caliber_mm: 75.0, length_cal: 48.0, stabilizer: "none".into() }),
        ammunition: vec![AmmoLoad { kind: "apcbc".into(), count: 20 }, AmmoLoad { kind: "he".into(), count: 10 }],
        visual: VisualChoice::default(),
        editor: serde_json::Value::Null,
    }
}

fn codes(r: &DesignReport) -> Vec<String> {
    r.issues.iter().filter(|i| i.severity == validate::Severity::Error).map(|i| format!("{} {}", i.code, i.message)).collect()
}

fn db() -> Db {
    Db::embedded()
}

#[test]
fn sample_design_is_legal_and_plausible() {
    let db = db();
    let r = evaluate(&sample(), &db);
    assert!(r.battle_ready, "{:#?}", codes(&r));
    let t = r.mass.total_kg / 1000.0;
    assert!((15.0..45.0).contains(&t), "mass {} t", t);
    assert!(r.mobility.top_speed_road_kmh > 25.0, "{:?}", r.mobility);
    assert!(r.mobility.accel_0_32_s.is_some());
    assert!(r.volumes.hull_interior_m3 > 8.0 && r.volumes.hull_interior_m3 < r.volumes.hull_m3);
    let g = r.gun.as_ref().unwrap();
    assert!(g.clearance.recoil_fits && g.clearance.max_elevation_deg > 5.0, "{:?}", g.clearance);
    assert!(r.ammunition.capacity >= 30, "{}", r.ammunition.capacity);
    assert!(r.compiled.is_some());
}

#[test]
fn thicker_armour_is_heavier_and_slower() {
    let db = db();
    let base = evaluate(&sample(), &db);
    let mut heavy = sample();
    for a in &mut heavy.armor_faces {
        a.thickness_mm *= 3.0;
    }
    let h = evaluate(&heavy, &db);
    assert!(h.mass.armor_kg > base.mass.armor_kg * 2.5);
    assert!(h.mobility.power_to_weight_hp_t < base.mobility.power_to_weight_hp_t);
    assert!(h.mobility.accel_0_32_s.unwrap_or(99.0) > base.mobility.accel_0_32_s.unwrap());
    assert!(h.mobility.brake_decel_ms2 <= base.mobility.brake_decel_ms2);
    assert!(h.mobility.ground_pressure_kpa > base.mobility.ground_pressure_kpa);
    // the thicker walls eat the interior
    assert!(h.volumes.hull_interior_m3 < base.volumes.hull_interior_m3);
}

#[test]
fn armour_mass_is_area_times_thickness_times_density() {
    let db = db();
    let r = evaluate(&sample(), &db);
    let front = r.armor_faces.iter().find(|f| f.body == Body::Hull && f.id == 0).unwrap();
    // 2.0 m x 1.1 m x 80 mm x 7850
    assert!((front.mass_kg - 2.0 * 1.1 * 0.08 * 7850.0).abs() < 1.0, "{}", front.mass_kg);
}

#[test]
fn front_armour_moves_the_centre_of_mass_and_loads_the_front_wheels() {
    let db = db();
    let base = evaluate(&sample(), &db);
    let mut d = sample();
    d.armor_faces.iter_mut().find(|a| a.body == Body::Hull && a.face == 0).unwrap().thickness_mm = 300.0;
    let r = evaluate(&d, &db);
    assert!(r.center_of_mass.z > base.center_of_mass.z + 0.05);
    assert!(r.suspension.front.load_kn > base.suspension.front.load_kn);
    assert!(r.suspension.front.ratio > r.suspension.rear.ratio);
    // a heavy turret raises it
    let mut t = sample();
    for a in t.armor_faces.iter_mut().filter(|a| a.body == Body::Turret) {
        a.thickness_mm += 120.0;
    }
    let rt = evaluate(&t, &db);
    assert!(rt.center_of_mass.y > base.center_of_mass.y + 0.03);
}

#[test]
fn negative_thickness_and_open_mesh_are_rejected() {
    let db = db();
    let mut d = sample();
    d.armor_faces[2].thickness_mm = -10.0;
    assert!(evaluate(&d, &db).issues.iter().any(|i| i.code == "D010"));
    let mut d = sample();
    d.hull_geometry.faces.remove(4);
    let r = evaluate(&d, &db);
    assert!(r.issues.iter().any(|i| i.code == "D001"));
    assert!(!r.battle_ready);
}

#[test]
fn ring_off_the_hull_and_turret_too_small_for_the_gun_are_errors() {
    let db = db();
    let mut d = sample();
    d.turret_ring.as_mut().unwrap().position_m = v3(0.0, 1.55, 2.8);
    let r = evaluate(&d, &db);
    assert!(r.issues.iter().any(|i| i.code == "D020"), "{:#?}", codes(&r));
    // a tiny turret around a 122 mm gun: the breech and its recoil cannot fit
    let mut d = sample();
    d.turret_geometry = Some(boxm(v3(-0.55, 0.0, -0.5), v3(0.55, 0.6, 0.6), ["front", "rear", "side_r", "side_l", "roof", "floor"]));
    d.turret_ring.as_mut().unwrap().diameter_m = 1.0;
    d.weapons = Some(WeaponsChoice { caliber_mm: 122.0, length_cal: 48.0, stabilizer: "none".into() });
    d.gun_mount.as_mut().unwrap().position_m = v3(0.0, 0.3, 0.45);
    d.gun_mount.as_mut().unwrap().recoil_distance_m = 0.55;
    d.crew_positions.retain(|c| c.mount == Body::Hull);
    d.internal_modules.retain(|m| m.mount == Body::Hull);
    let r = evaluate(&d, &db);
    assert!(r.issues.iter().any(|i| i.code == "D030" || i.code == "D031"), "{:#?}", codes(&r));
    assert!(!r.battle_ready);
}

#[test]
fn breech_limits_elevation_and_barrel_limits_depression() {
    let db = db();
    let mut d = sample();
    // gun high in a low turret: depressing swings the breech into the roof
    d.gun_mount.as_mut().unwrap().position_m = v3(0.0, 0.62, 0.95);
    d.gun_mount.as_mut().unwrap().min_elevation_deg = -15.0;
    let r = evaluate(&d, &db);
    let c = &r.gun.as_ref().unwrap().clearance;
    assert!(c.max_depression_deg < 15.0, "{:?}", c);
    assert!(r.issues.iter().any(|i| i.code == "D033"));
}

#[test]
fn modules_must_fit_inside_the_armour_and_not_overlap() {
    let db = db();
    let mut d = sample();
    d.internal_modules[2].center_m = v3(-0.9, 0.95, -2.1); // fuel tank pushed into the side wall
    let r = evaluate(&d, &db);
    assert!(r.issues.iter().any(|i| i.code == "D040"), "{:#?}", codes(&r));
    let mut d = sample();
    d.internal_modules[4].center_m = v3(0.0, 1.0, -2.0); // ammo rack inside the engine
    let r = evaluate(&d, &db);
    assert!(r.issues.iter().any(|i| i.code == "D041" && i.message.contains("engine")), "{:#?}", codes(&r));
    let mut d = sample();
    d.crew_positions[3].position_m = v3(0.0, 0.35, -0.2); // commander sitting behind the breech
    let r = evaluate(&d, &db);
    assert!(r.issues.iter().any(|i| i.code == "D034"), "{:#?}", codes(&r));
}

#[test]
fn tracks_through_the_hull_and_overload_are_errors() {
    let db = db();
    let mut d = sample();
    d.tracks.center_x_m = 0.9;
    assert!(evaluate(&d, &db).issues.iter().any(|i| i.code == "D050"));
    let mut d = sample();
    for a in &mut d.armor_faces {
        a.thickness_mm = 400.0;
    }
    let r = evaluate(&d, &db);
    assert!(r.issues.iter().any(|i| i.code == "D060" || i.code == "D013"), "{:#?}", codes(&r));
}

#[test]
fn client_supplied_results_are_refused_and_recomputed() {
    let db = db();
    let mut v = serde_json::to_value(sample()).unwrap();
    v["mass_kg"] = serde_json::json!(1000);
    let e = accept_submission(&v.to_string(), &db).unwrap_err();
    assert_eq!(e.code, "D100");
    let mut v = serde_json::to_value(sample()).unwrap();
    v["engine"]["horsepower_result"] = serde_json::json!(5000);
    assert_eq!(accept_submission(&v.to_string(), &db).unwrap_err().code, "D100");
    let ok = accept_submission(&serde_json::to_string(&sample()).unwrap(), &db).map_err(|e| e.message).unwrap();
    assert!(ok.battle_ready && ok.report.mass.total_kg > 10_000.0);
    assert_eq!(ok.design_hash, eval::design_hash(&sample()));
    // unknown fields (typos, smuggled values) are refused by the strict format
    let mut v = serde_json::to_value(sample()).unwrap();
    v["hull_geometry"]["armor_bonus"] = serde_json::json!(2);
    assert_eq!(accept_submission(&v.to_string(), &db).unwrap_err().code, "D101");
}

#[test]
fn spaced_armour_stops_heat_and_stack_order_matters() {
    let db = db();
    let mut d = sample();
    d.armor_faces.iter_mut().find(|a| a.body == Body::Hull && a.face == 2).unwrap().thickness_mm = 75.0;
    let heat = shells::design_shell("heat", 75.0, 24.0).unwrap();
    let side = |m: &layout::Model| {
        shoot(m, &TargetState::default(), &ShotRequest { shell: heat.clone(), origin: v3(20.0, 1.0, -0.5), dir: v3(-1.0, 0.0, 0.0), speed_ms: 400.0, distance_m: 200.0, seed: 7, turret_yaw_deg: 0.0, gun_elevation_deg: 0.0, path: vec![] })
    };
    let m = layout::Model::new(&d, &db);
    let bare = side(&m);
    assert_eq!(bare.event.penetration_result, tg_replay::PenetrationOutcome::Penetrated, "{}", bare.note);
    drop(m);
    // 8 mm skirt 400 mm out from the 45 mm side
    d.addons.push(AddonDef { id: "skirt_r".into(), kind: AddonKind::Skirt, body: Body::Hull, face: Some(2), anchor_m: v3(1.0, 1.0, -0.5), normal: V3::X, u_axis: V3::Z, size_m: [4.0, 0.9], material: "skirt".into(), thickness_mm: 8.0, standoff_mm: 600.0 });
    d.armor_faces.iter_mut().find(|a| a.body == Body::Hull && a.face == 2).unwrap().thickness_mm = 75.0;
    let m = layout::Model::new(&d, &db);
    let skirted = side(&m);
    assert_eq!(skirted.layers.len(), 2);
    assert_eq!(skirted.layers[0].crossing.kind, "addon");
    assert!(skirted.layers[1].crossing.gap_before_mm > 500.0);
    assert_ne!(skirted.event.penetration_result, tg_replay::PenetrationOutcome::Penetrated, "{}", skirted.note);
}

#[test]
fn penetrating_shot_damages_the_interior_and_is_reproducible() {
    let db = db();
    let d = sample();
    let m = layout::Model::new(&d, &db);
    let ap = shells::design_shell("aphe", 88.0, 56.0).unwrap();
    let req = ShotRequest { shell: ap, origin: v3(30.0, 0.95, -0.9), dir: v3(-1.0, 0.0, 0.0), speed_ms: 780.0, distance_m: 300.0, seed: 42, turret_yaw_deg: 0.0, gun_elevation_deg: 0.0, path: vec![] };
    let a = shoot(&m, &TargetState::default(), &req);
    let b = shoot(&m, &TargetState::default(), &req);
    assert_eq!(a.event.penetration_result, tg_replay::PenetrationOutcome::Penetrated, "{}", a.note);
    assert!(!a.event.fragments.is_empty());
    assert!(!a.event.damaged_modules.is_empty(), "{:?}", a.event.damaged_modules);
    // spall stays inside the armour: nothing outside (tracks, barrel) is touched
    assert!(a.event.damaged_modules.iter().all(|x| x.kind != "track" && x.kind != "gun_barrel"), "{:?}", a.event.damaged_modules);
    assert!(a.event.fragments.iter().all(|f| f.end.x.abs() < 1.01), "fragment left the hull");
    assert_eq!(a.event.fragments.len(), b.event.fragments.len());
    assert_eq!(a.event.outcomes, b.event.outcomes);
    assert_eq!(a.timeline.len(), 4);
    // damage carries over to the next shot
    assert!(a.state.module_health.values().any(|h| *h < 60.0));
}

#[test]
fn protection_map_shows_thin_sides_and_thick_front() {
    let db = db();
    let d = sample();
    let m = layout::Model::new(&d, &db);
    let shell = shells::design_shell("apcbc", 75.0, 48.0).unwrap(); // ~120 mm at 500 m
    let front = protection_map(&m, &ProtectRequest { shell: shell.clone(), distance_m: 500.0, azimuth_deg: 0.0, elevation_deg: 0.0, turret_yaw_deg: 0.0, cols: 40, rows: 24 });
    let side = protection_map(&m, &ProtectRequest { shell, distance_m: 500.0, azimuth_deg: 90.0, elevation_deg: 0.0, turret_yaw_deg: 0.0, cols: 40, rows: 24 });
    assert!(!front.cells.is_empty() && !side.cells.is_empty());
    assert!(side.mean_probability > front.mean_probability, "side {} front {}", side.mean_probability, front.mean_probability);
    assert!(front.descent_deg >= 0.0 && front.pen_mm > 80.0);
}

#[test]
fn a_stabilizer_weighs_something_needs_power_and_reaches_the_weapons_file() {
    let db = db();
    let base = evaluate(&sample(), &db);
    assert!(!base.mass.items.iter().any(|i| i.key == "stabilizer"));
    let mut d = sample();
    d.weapons.as_mut().unwrap().stabilizer = "vertical".into();
    let r = evaluate(&d, &db);
    let kg = r.mass.items.iter().find(|i| i.key == "stabilizer").map(|i| i.kg).unwrap_or(0.0);
    assert!(kg > 50.0 && kg < 300.0, "stabilizer {kg} kg");
    assert!(!codes(&r).iter().any(|c| c.starts_with("D039")), "{:?}", codes(&r));
    assert_eq!(r.compiled.as_ref().unwrap().weapons.stabilizer.as_deref(), Some("vertical"));
    // a two-plane stabilizer traverses the turret itself: not with a hand-cranked ring
    d.weapons.as_mut().unwrap().stabilizer = "two_plane".into();
    d.turret_ring.as_mut().unwrap().drive = "manual".into();
    let r2 = evaluate(&d, &db);
    assert!(codes(&r2).iter().any(|c| c.starts_with("D039")), "{:?}", codes(&r2));
    d.weapons.as_mut().unwrap().stabilizer = "gyro9000".into();
    assert!(codes(&evaluate(&d, &db)).iter().any(|c| c.starts_with("D039")));
}

#[test]
fn compiled_vehicle_loads_through_the_content_pipeline() {
    let db = db();
    let r = evaluate(&sample(), &db);
    let c = r.compiled.as_ref().unwrap();
    let files = c.files();
    // round-trip through the strict loader types
    let v: tg_vehicle::VehicleDef = serde_json::from_value(files["vehicle.json"].clone()).unwrap();
    assert!((v.hull.mass_kg as f64 - r.mass.total_kg).abs() < 1.0);
    let _: tg_vehicle::WeaponsFile = serde_json::from_value(files["weapons.json"].clone()).unwrap();
    let _: tg_vehicle::EngineFile = serde_json::from_value(files["engine.json"].clone()).unwrap();
    assert_eq!(c.weapons.main_gun.max_depression_deg as f64, r.gun.as_ref().unwrap().clearance.frontal_depression_deg);
}

#[test]
#[ignore]
fn print_sample_summary() {
    let db = db();
    let r = evaluate(&sample(), &db);
    println!("mass {:.1} t armor {:.1} t com {:?}", r.mass.total_kg / 1000.0, r.mass.armor_kg / 1000.0, r.center_of_mass);
    for i in &r.mass.items {
        println!("  {:<14} {:>8.0} kg", i.key, i.kg);
    }
    println!("mobility {:#?}", r.mobility);
    println!("susp front {:?} mid {:?} rear {:?} max {:.2}", r.suspension.front, r.suspension.middle, r.suspension.rear, r.suspension.max_ratio);
    println!("volumes {:?}", r.volumes);
    let g = r.gun.as_ref().unwrap();
    println!("gun elev {:.1} dep {:.1} frontal {:.1} reload {:.1}s traverse {:.1}", g.clearance.max_elevation_deg, g.clearance.max_depression_deg, g.clearance.frontal_depression_deg, g.reload_s, r.turret.as_ref().unwrap().traverse_deg_s);
    for s in &g.shells {
        println!("  {} pen {:?}", s.def.name, s.pen_mm);
    }
    println!("ammo {:?}", r.ammunition);
    println!("engine {:?}", r.engine);
    for i in &r.issues {
        println!("{:?} {} {}", i.severity, i.code, i.message);
    }
}
