//! Accepted native projectile contacts must distinguish contained filler from a detonation.
use super::*;
use tg_weapon::ProjectileKind;

fn data() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")
}

fn map(with_facilities: bool) -> Value {
    let mut map = json!({"id":"explosive_fixture","terrain":{
        "width":3,"height":3,"cellX":1000.0,"cellZ":1000.0,
        "x0":-1000.0,"z0":-1000.0,"heights":vec![0.0;9]
    }});
    if with_facilities {
        map["airfields"] = json!([{"id":"F","team":0,"enabled":true,"runway":{
            "center":[0,0],"forward":[0,1],"height":0,
            "lengthMeters":200,"widthMeters":20
        }}]);
    }
    map
}

// Synthetic projectile: the tests make no historical ammunition claim. Identical
// mass/flight with and without filler isolates the world's exterior-blast policy.
fn shell(kind: ProjectileKind, filler_kg: f32) -> ProjectileDef {
    let mut shell = ProjectileDef::generic_ap(155.0, 1000.0);
    shell.id = "native_explosive_fixture".into();
    shell.kind = kind;
    shell.mass_kg = 43.0;
    shell.explosive_mass_kg = filler_kg;
    shell.explosive_type = if filler_kg > 0.0 { "tnt" } else { "none" }.into();
    shell.fuse_sensitivity_mm = 1_000_000.0;
    shell.fuse_delay_s = 0.01;
    shell
}

fn launch(w: &mut SimWorld, shell: ProjectileDef, pos: [f64; 3], velocity: [f64; 3]) {
    w.launch_air_round(9000, 1, shell, pos, velocity, None, "native_fixture", 1)
        .unwrap();
}

fn advance(w: &mut SimWorld, seconds: f64) -> Vec<SimEvent> {
    let mut events = Vec::new();
    for _ in 0..(seconds / FIXED_DT).ceil() as usize {
        events.extend(w.step(FIXED_DT));
    }
    events
}

fn nearby_terrain_contact(kind: ProjectileKind, filler: f32) -> (Value, Value, Vec<SimEvent>) {
    let mut w = SimWorld::load(&data(), &map(false)).unwrap();
    w.spawn_unit(2, "de_pzjg1", 0, [2.5, 0.0, 0.0], 0.0)
        .unwrap();
    let before = json!(w.units[&2].state);
    launch(&mut w, shell(kind, filler), [0.0, 10.0, 0.0], [0.0, -200.0, 0.0]);
    let events = advance(&mut w, 0.15);
    assert!(events.iter().any(|e| e.kind == "terrain_impact"));
    (before, json!(w.units[&2].state), events)
}

#[test]
fn unarmed_kinetic_filler_terrain_contact_does_not_damage_nearby_units() {
    let (before_he, after_he, _) = nearby_terrain_contact(ProjectileKind::He, 5.0);
    assert_ne!(before_he, after_he, "HE control must exercise real nearby blast damage");
    for kind in [ProjectileKind::Aphe, ProjectileKind::Apcbc] {
        let (before, after, events) = nearby_terrain_contact(kind, 5.0);
        assert_eq!(before, after, "unarmed {kind:?} filler fabricated exterior damage");
        assert!(!events.iter().any(|e| e.kind == "blast"));
    }
}

#[test]
fn accepted_terrain_bursts_keep_trusted_shell_kind_and_casing_fragments() {
    let casing = |report: &Value| report["fragments"].as_array().unwrap().iter()
        .any(|f| f["kind"] == "burst" && f["source"] == "casing_fragment");
    // Exercise the actual flattened report leaf against the former kg-only
    // interface too: a pressure-only radius report cannot satisfy this gate.
    let catalog = crate::server::load_combat(&data());
    let target = &catalog.targets["de_pzjg1"];
    let kg_only = tg_combat::splash(target, &target.fresh_state(),
        Vec3::new(-2.5, 0., 0.), 5., 0., 1);
    assert!(!casing(&json!(kg_only)), "kg-only negative control must fail the physical-casing gate");
    for kind in [ProjectileKind::He, ProjectileKind::HeatFs] {
        let (_, _, events) = nearby_terrain_contact(kind, 5.0);
        let blast = events.iter().find(|e| e.kind == "blast" && e.target == Some(2))
            .expect("native accepted burst must reach nearby open vehicle");
        let report = &blast.detail["report"];
        assert_eq!(report["shell_kind"], serde_json::to_value(kind).unwrap(), "accepted projectile identity must reach native near-burst evaluation");
        assert!(casing(report),
            "native terrain burst must carry actual trusted shell casing, not a kg-only radius call");
        assert!(!report["fragments"].as_array().unwrap().iter().any(|f| f["kind"] == "jet"), "nearby target never receives an invented direct shaped-charge jet");
    }
}

#[test]
fn unarmed_kinetic_vehicle_contact_does_not_damage_the_second_vehicle() {
    let run = |kind| {
        let mut w = SimWorld::load(&data(), &map(false)).unwrap();
        w.spawn_unit(1, "su_t72a", 0, [0.0; 3], 0.0).unwrap();
        w.spawn_unit(2, "de_pzjg1", 0, [3.3, 0.0, 0.0], 0.0).unwrap();
        let before = json!(w.units[&2].state);
        launch(&mut w, shell(kind, 5.0), [0.2, 10.0, 0.5], [0.0, -500.0, 0.0]);
        let events = advance(&mut w, 0.1);
        let impact = events.iter().find(|e| e.kind == "impact" && e.target == Some(1))
            .expect("fixture must contact the first real vehicle");
        (before, json!(w.units[&2].state), impact.detail.clone(), events)
    };
    let (before_he, after_he, _, _) = run(ProjectileKind::He);
    assert_ne!(before_he, after_he, "vehicle-contact HE control must blast the second vehicle");
    let (before, after, impact, events) = run(ProjectileKind::Aphe);
    assert!(impact["report"]["bursts"].as_array().unwrap().is_empty(),
        "fixture must prove the direct native APHE report has no detonation");
    assert_eq!(before, after, "contained filler from a direct hit fabricated nearby damage");
    assert!(!events.iter().any(|e| e.kind == "blast" && e.target == Some(2)));
}

#[test]
fn unarmed_kinetic_filler_does_not_add_facility_explosive_damage() {
    let run = |filler| {
        let mut w = SimWorld::load(&data(), &map(true)).unwrap();
        let id = "explosive_fixture:fuel:F";
        let before = w.facilities.view(id).unwrap().hp;
        launch(&mut w, shell(ProjectileKind::Aphe, filler), [70.0, 30.0, -70.0], [0.0, -100.0, 0.0]);
        let events = advance(&mut w, 0.5);
        assert!(events.iter().any(|e| e.kind == "facility_impact" && e.detail["contact"]["facility_id"] == id));
        (before, w.facilities.view(id).unwrap().hp)
    };
    let (before, solid) = run(0.0);
    let (_, filled) = run(5.0);
    assert!(solid < before && solid > 0.0, "fixture must retain measurable kinetic facility damage");
    assert_eq!(filled, solid, "unarmed filler was admitted as contact TNT");
}

#[test]
fn accepted_ground_aphe_bursts_keep_metadata_and_impact_time_world_position() {
    let mut w = SimWorld::load(&data(), &map(false)).unwrap();
    w.spawn_unit(1, "su_t72a", 0, [120.0, 0.0, -80.0], 0.7).unwrap();
    let mut round = shell(ProjectileKind::Aphe, 0.1);
    round.fuse_sensitivity_mm = 1.0;
    round.fuse_delay_s = 0.0005;
    let body = &w.units[&1].tank.body;
    let origin = body.world_point([0.2, 10.0, 0.5]);
    let velocity = body.world_dir([0.0, -500.0, 0.0]);
    launch(&mut w, round, origin, velocity);
    let mut accepted = None;
    for _ in 0..30 {
        let events = w.step(FIXED_DT);
        if let Some(impact) = events.into_iter().find(|e| e.kind == "impact" && e.target == Some(1)) {
            accepted = Some((impact, w.units[&1].tank.body.clone()));
            break;
        }
    }
    let (impact, accepted_body) = accepted.expect("admitted APHE must contact the translated, rotated tank");
    let bursts = impact.detail["report"]["bursts"].as_array().unwrap();
    assert!(!bursts.is_empty(), "fixture must produce a genuine armed APHE burst: {}", impact.detail["report"]);
    let world_bursts = impact.detail["world_bursts"].as_array()
        .expect("ground event must carry accepted world bursts");
    assert_eq!(world_bursts.len(), bursts.len());
    for (burst, world) in bursts.iter().zip(world_bursts) {
        for (key, value) in burst.as_object().unwrap() {
            assert_eq!(&world[key], value, "accepted world burst lost original {key}");
        }
        assert_eq!(world["mechanism"], "delayed_aphe");
        assert!(world["time_s"].as_f64().unwrap() >= 0.0);
        let local = ["x", "y", "z"].map(|axis| burst["pos"][axis].as_f64().unwrap());
        let expected = accepted_body.world_point(local);
        let actual = world["world_position"].as_array().unwrap();
        for axis in 0..3 {
            assert!((actual[axis].as_f64().unwrap() - expected[axis]).abs() < 1e-6);
        }
    }
}

#[test]
fn accepted_he_terrain_and_facility_contacts_publish_explicit_world_bursts() {
    for facilities in [false, true] {
        let mut w = SimWorld::load(&data(), &map(facilities)).unwrap();
        let pos = if facilities { [70.0, 30.0, -70.0] } else { [20.0, 10.0, 30.0] };
        launch(&mut w, shell(ProjectileKind::He, 5.0), pos, [0.0, -200.0, 0.0]);
        let events = advance(&mut w, 0.3);
        let kind = if facilities { "facility_impact" } else { "terrain_impact" };
        let impact = events.iter().find(|e| e.kind == kind).expect("actual accepted contact");
        let bursts = impact.detail["world_bursts"].as_array().expect("HE contact needs explicit detonation evidence");
        assert_eq!(bursts.len(), 1);
        assert_eq!(bursts[0]["world_position"], json!(impact.pos));
        assert_eq!(bursts[0]["mechanism"], "immediate_he");
        assert_eq!(bursts[0]["time_origin"], "first_contact");
        assert_eq!(bursts[0]["time_s"], 0.0);
        assert_eq!(bursts[0]["raw_explosive_kg"], 5.0);
    }
}
