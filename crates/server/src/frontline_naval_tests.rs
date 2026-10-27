use super::*;
use serde_json::json;

fn spec(id: &str, team: u8, model: &str, pos: [f64; 3]) -> VesselSpec {
    serde_json::from_value(
        json!({"id":id,"team":team,"role":if team==0 {"transport"} else {"interceptor"},
        "model":model,"pos":pos,"yaw":0.0,"route":[],"speed_mps":4.0,"ammo":3,
        "shell_id":"he_76_m42a1"}),
    )
    .unwrap()
}
fn world(specs: Vec<VesselSpec>) -> NavalWorld {
    NavalWorld::new(&NavalConfig { vessels: specs }, 7, &mut 100).unwrap()
}
fn shell() -> ProjectileDef {
    serde_json::from_str(include_str!("../../../data/projectiles/he_76_m42a1.json")).unwrap()
}

#[test]
fn naval_contact_keeps_real_hatch_and_bridge_apertures_and_finite_segments() {
    let w = world(vec![spec("ship", 0, "generic_transport", [0.0; 3])]);
    assert!(
        w.first_contact([0.0, 3.0, 0.0], [0.0, 0.5, 0.0], None)
            .is_none(),
        "open cargo hatch must stay open"
    );
    assert!(
        w.first_contact([0.0, 5.5, -3.0], [0.0, 5.5, -4.4], None)
            .is_none(),
        "bridge window aperture must stay open"
    );
    assert!(
        w.first_contact([10.0, 0.0, 0.0], [6.0, 0.0, 0.0], None)
            .is_none(),
        "segment ends before hull"
    );
    let c = w
        .first_contact([10.0, 0.0, 0.0], [-10.0, 0.0, 0.0], None)
        .unwrap();
    assert_eq!(c.part_id, "hull");
    assert!(c.fraction > 0.0 && c.fraction < 1.0);
    assert!(w
        .first_contact([10.0, 0.0, 0.0], [-10.0, 0.0, 0.0], Some(c.unit.unit))
        .is_none());
}

#[test]
fn naval_geometry_catalog_is_exact_float32_contact_source_with_stable_identity() {
    let w = world(vec![spec("ship", 0, "generic_transport", [0.0; 3])]);
    let catalog = w.geometry_catalog();
    assert_eq!(catalog.len(), 3);
    let g = catalog
        .iter()
        .find(|g| g["id"] == "generic_transport")
        .unwrap();
    let c = w
        .first_contact([10.0, 0.0, 0.0], [-10.0, 0.0, 0.0], None)
        .unwrap();
    assert_eq!(g["hash"].as_str(), Some(c.geometry_hash.as_str()));
    let p = g["parts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == c.part_id)
        .unwrap();
    let tri = p["triangles"][c.triangle_index].as_array().unwrap();
    assert_eq!(tri.len(), 9);
    let vs = std::array::from_fn(|i| std::array::from_fn(|j| tri[i * 3 + j].as_f64().unwrap()));
    let hit = tg_combat::geometry::ray::triangle([10.0, 0.0, 0.0], [-10.0, 0.0, 0.0], vs)
        .unwrap()
        .unwrap();
    assert_eq!(hit.t, c.fraction);
    assert_eq!(catalog, world(vec![]).geometry_catalog());
}

#[test]
fn naval_contact_follows_accepted_ship_pose_and_rejects_invalid_configuration() {
    let mut s = spec("rotated", 0, "generic_interceptor", [100.0, 2.0, 50.0]);
    s.yaw = std::f64::consts::FRAC_PI_2;
    let w = world(vec![s]);
    let c = w
        .first_contact([100.0, 2.0, 60.0], [100.0, 2.0, 40.0], None)
        .unwrap();
    assert!(c.pos[2] > 50.0 && c.pos[2] < 55.0);
    assert!(w
        .first_contact([100.0, 10.0, 60.0], [100.0, 10.0, 40.0], None)
        .is_none());
    let mut bad = spec("bad", 0, "made_up_ship", [0.0; 3]);
    assert!(NavalWorld::new(
        &NavalConfig {
            vessels: vec![bad.clone()]
        },
        7,
        &mut 0
    )
    .is_err());
    bad.model = "generic_transport".into();
    bad.pos[0] = f64::NAN;
    assert!(NavalWorld::new(&NavalConfig { vessels: vec![bad] }, 7, &mut 0).is_err());
}

#[test]
fn naval_fixed_motion_is_bounded_deterministic_and_order_independent() {
    let mut a = spec("a", 0, "generic_transport", [0.0; 3]);
    a.route = vec![[0.0, 100.0], [100.0, 100.0]];
    a.ammo = 0;
    let mut b = spec("b", 1, "generic_escort", [100.0, 0.0, 0.0]);
    b.route = vec![[100.0, 100.0]];
    b.ammo = 0;
    let mut x = world(vec![a.clone(), b.clone()]);
    let mut y = world(vec![b, a]);
    for _ in 0..120 {
        let before = x.views();
        x.step(1.0 / 60.0, |_, _, _, _| true);
        y.step(1.0 / 60.0, |_, _, _, _| true);
        for (old, new) in before.iter().zip(x.views()) {
            let speed = dot(new.velocity, new.velocity).sqrt();
            assert!(speed <= 4.0 + 1e-9);
            assert!((speed - dot(old.velocity, old.velocity).sqrt()).abs() <= 0.8 / 60.0 + 1e-9);
            assert!((new.yaw - old.yaw).abs() <= 0.22 / 60.0 + 1e-9);
            assert_eq!(new.pos[1], old.pos[1]);
        }
    }
    assert_eq!(x.views(), y.views());
    assert!(x.views()[0].pos[2] > 0.0);
    let before = x.views();
    assert!(x.step(f64::NAN, |_, _, _, _| true).is_empty());
    assert_eq!(before, x.views());
}

#[test]
fn naval_fire_requires_enemy_los_real_ammo_and_cooldown() {
    let mut a = spec("a", 0, "generic_escort", [0.0; 3]);
    a.ammo = 2;
    let mut b = spec("b", 1, "generic_interceptor", [0.0, 0.0, 500.0]);
    b.ammo = 0;
    let mut w = world(vec![a, b]);
    assert!(w.step(1.0 / 60.0, |_, _, _, _| false).is_empty());
    assert_eq!(w.views()[0].ammo, 2);
    let shots = w.step(1.0 / 60.0, |_, _, _, _| true);
    assert_eq!(shots.len(), 1);
    assert_eq!(shots[0].ammo_revision, 1);
    assert_eq!(w.views()[0].ammo, 1);
    assert!(shots[0].velocity[2] > 600.0 && shots[0].velocity[1] > 0.0);
    assert!(w.step(1.0 / 60.0, |_, _, _, _| true).is_empty());
    let mut count = 1;
    for _ in 0..1000 {
        count += w.step(1.0 / 60.0, |_, _, _, _| true).len();
    }
    assert_eq!(count, 2);
    assert_eq!(w.views()[0].ammo, 0);
    let mut f = world(vec![
        spec("a", 0, "generic_escort", [0.0; 3]),
        spec("b", 0, "generic_interceptor", [0.0, 0.0, 100.0]),
    ]);
    assert!(f.step(1.0 / 60.0, |_, _, _, _| true).is_empty());
}

#[test]
fn naval_damage_requires_valid_surface_energy_and_respects_friendly_policy() {
    let mut w = world(vec![spec("ship", 0, "generic_transport", [0.0; 3])]);
    let c = w
        .first_contact([10.0, 0.0, 0.0], [-10.0, 0.0, 0.0], None)
        .unwrap();
    let initial = w.views();
    assert!(!w.impact(&c, &shell(), [-800.0, 0.0, 0.0], 0, false));
    assert_eq!(initial, w.views());
    let mut fake = c.clone();
    fake.pos = [0.0, 100.0, 0.0];
    assert!(!w.impact(&fake, &shell(), [-800.0, 0.0, 0.0], 1, true));
    assert_eq!(initial, w.views());
    let inert = ProjectileDef::generic_ap(76.0, 100.0);
    assert!(!w.impact(&c, &inert, [0.0; 3], 1, true));
    assert!(w.impact(&c, &shell(), [-800.0, 0.0, 0.0], 1, true));
    assert!(w.views()[0].health < initial[0].health);
}

#[test]
fn naval_sunk_life_never_moves_fires_reappears_or_takes_repeat_damage() {
    let mut s = spec("ship", 0, "generic_interceptor", [0.0; 3]);
    s.route = vec![[0.0, 100.0]];
    let mut w = world(vec![
        s,
        spec("enemy", 1, "generic_interceptor", [0.0, 0.0, 300.0]),
    ]);
    let c = w
        .first_contact([10.0, 0.0, 0.0], [-10.0, 0.0, 0.0], None)
        .unwrap();
    let mut heavy = shell();
    heavy.mass_kg = 10000.0;
    heavy.explosive_mass_kg = 10000.0;
    assert!(w.impact(&c, &heavy, [-1000.0, 0.0, 0.0], 1, true));
    let sunk = w.views().into_iter().find(|v| v.id == "ship").unwrap();
    assert!(!sunk.alive);
    assert_eq!(sunk.health, 0.0);
    assert!(!w.impact(&c, &heavy, [-1000.0, 0.0, 0.0], 1, true));
    for _ in 0..120 {
        assert!(w
            .step(1.0 / 60.0, |_, _, _, _| true)
            .iter()
            .all(|s| s.shooter != sunk.unit));
    }
    assert_eq!(
        w.views().into_iter().find(|v| v.id == "ship").unwrap(),
        sunk
    );
    assert!(w
        .first_contact([10.0, 0.0, 0.0], [-10.0, 0.0, 0.0], None)
        .is_none());
}

#[test]
fn naval_blast_measures_geometry_exposure_distance_and_friendly_policy() {
    let specs = vec![
        spec("a", 0, "generic_transport", [0.0; 3]),
        spec("b", 1, "generic_interceptor", [1000.0, 0.0, 0.0]),
    ];
    let mut w = world(specs.clone());
    let before = w.views();
    assert!(w.blast([6.0, 0.0, 0.0], 5.0, 0, false, None).is_empty());
    assert_eq!(before, w.views());
    let changed = w.blast([6.0, 0.0, 0.0], 5.0, 1, false, None);
    assert_eq!(changed, vec![100]);
    assert!(w.views()[0].health < before[0].health);
    assert_eq!(w.views()[1], before[1]);
    let mut excluded = world(specs);
    assert!(excluded
        .blast([6.0, 0.0, 0.0], 5.0, 1, true, Some(100))
        .is_empty());
}

#[test]
fn naval_blast_geometry_blocks_vessel_behind_front_hull() {
    let mut w = world(vec![
        spec("shield", 0, "generic_transport", [0.0; 3]),
        spec("behind", 1, "generic_interceptor", [0.0, 0.0, 35.0]),
    ]);
    let before = w.views();
    w.blast([0.0, 0.0, -30.0], 100.0, 2, true, None);
    assert!(w.views()[1].health < before[1].health);
    assert_eq!(
        w.views()[0],
        before[0],
        "front ship triangle surfaces must shield the ship behind"
    );
}

#[test]
fn naval_fixed_motion_is_invariant_to_equal_elapsed_time_partition() {
    let mut s = spec("a", 0, "generic_transport", [0.0; 3]);
    s.ammo = 0;
    s.route = vec![[0.0, 100.0]];
    let mut a = world(vec![s.clone()]);
    let mut b = world(vec![s]);
    for _ in 0..60 {
        a.step(1.0 / 60.0, |_, _, _, _| true);
    }
    for _ in 0..20 {
        b.step(0.05, |_, _, _, _| true);
    }
    assert_eq!(a.views(), b.views());
}

#[test]
fn naval_gun_contact_uses_same_pivot_and_accepted_articulated_pose_as_catalog() {
    let mut a = spec("a", 0, "generic_escort", [0.0; 3]);
    a.ammo = 10;
    let mut b = spec("b", 1, "generic_interceptor", [500.0, 0.0, 0.0]);
    b.ammo = 0;
    let mut w = world(vec![a, b]);
    for _ in 0..180 {
        w.step(1.0 / 60.0, |_, _, _, _| true);
    }
    let v = w.views()[0].clone();
    assert!(v.gun_yaw > 1.0);
    let catalog = w.geometry_catalog();
    let g = catalog
        .iter()
        .find(|g| g["id"] == "generic_escort")
        .unwrap();
    let p = g["parts"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["id"] == "gun_barrel")
        .unwrap();
    assert_eq!(p["pose_group"], "gun");
    let pivot: [f64; 3] = std::array::from_fn(|i| p["pivot"][i].as_f64().unwrap());
    let flat = p["triangles"][0].as_array().unwrap();
    let t: [[f64; 3]; 3] =
        std::array::from_fn(|i| std::array::from_fn(|j| flat[i * 3 + j].as_f64().unwrap()));
    let rotate = |p: [f64; 3]| {
        let d = tg_combat::geometry::ray::sub(p, pivot);
        let (sp, cp) = v.gun_pitch.sin_cos();
        let (sy, cy) = v.gun_yaw.sin_cos();
        let d = [d[0], cp * d[1] + sp * d[2], -sp * d[1] + cp * d[2]];
        let d = [cy * d[0] + sy * d[2], d[1], -sy * d[0] + cy * d[2]];
        std::array::from_fn(|i| d[i] + pivot[i])
    };
    let t = t.map(rotate);
    let c: [f64; 3] = std::array::from_fn(|i| (t[0][i] + t[1][i] + t[2][i]) / 3.0);
    let n = tg_combat::geometry::ray::cross(
        tg_combat::geometry::ray::sub(t[1], t[0]),
        tg_combat::geometry::ray::sub(t[2], t[0]),
    );
    let l = dot(n, n).sqrt();
    let a = std::array::from_fn(|i| c[i] + n[i] / l * 0.01);
    let b = std::array::from_fn(|i| c[i] - n[i] / l * 0.01);
    let hit = w.first_contact(a, b, None).unwrap();
    assert_eq!(hit.part_id, "gun_barrel");
    assert_eq!(hit.triangle_index, 0);
    assert_eq!(hit.geometry_revision, 1);
}

#[test]
fn naval_shooter_selects_nearest_visible_enemy_with_stable_tie_order() {
    let mut a = spec("a", 0, "generic_escort", [0.0; 3]);
    a.ammo = 1;
    let mut b = spec("b", 1, "generic_interceptor", [-10.0, 0.0, 300.0]);
    b.ammo = 0;
    let mut c = spec("c", 1, "generic_interceptor", [10.0, 0.0, 300.0]);
    c.ammo = 0;
    let mut w = world(vec![c, a, b]);
    let mut shots = vec![];
    for _ in 0..20 {
        shots.extend(w.step(1.0 / 60.0, |_, target, _, _| target != 101));
    }
    assert_eq!(shots.len(), 1);
    assert!(
        shots[0].velocity[0] > 0.0,
        "blocked equal-distance enemy cannot be picked"
    );
}

#[test]
fn naval_convoy_brakes_without_teleporting_or_stacking_at_shared_endpoint() {
    let mut front = spec("a-front", 0, "generic_transport", [0.0, 0.0, 150.0]);
    front.ammo = 0;
    let mut middle = spec("b-middle", 0, "generic_transport", [0.0, 0.0, 60.0]);
    middle.route = vec![[0.0, 150.0]];
    middle.speed_mps = 8.0;
    middle.ammo = 0;
    let mut rear = spec("c-rear", 0, "generic_transport", [0.0; 3]);
    rear.route = vec![[0.0, 150.0]];
    rear.speed_mps = 8.0;
    rear.ammo = 0;
    let mut w = world(vec![front, middle, rear]);
    for _ in 0..2000 {
        let old = w.views();
        w.step(0.05, |_, _, _, _| false);
        let now = w.views();
        for (a, b) in old.iter().zip(&now) {
            assert!(
                (b.velocity[2] - a.velocity[2]).abs() <= ACCEL * 0.05 + 1e-8,
                "waiting uses bounded acceleration"
            );
            assert!(
                (b.pos[2] - a.pos[2]).abs() <= 8.0 * 0.05 + 1e-8,
                "no position projection or teleport"
            );
        }
        for pair in now.windows(2) {
            assert!(
                pair[0].pos[2] - pair[1].pos[2] >= 36.0,
                "actual 36m hulls overlap: {:?}",
                now.iter().map(|v| v.pos).collect::<Vec<_>>()
            );
        }
    }
    assert!(w.views()[1].velocity[2] < 0.05 && w.views()[2].velocity[2] < 0.05);
    assert!(w.views()[1].pos[2] > 60.0 && w.views()[2].pos[2] > 0.0);
}

#[test]
fn naval_unarmed_aphe_and_shaped_charge_do_not_invent_immediate_tnt_blast() {
    let base = spec("ship", 0, "generic_transport", [0.0; 3]);
    let mut ap = ProjectileDef::generic_ap(76.0, 100.0);
    ap.explosive_mass_kg = 10.0;
    let mut result = vec![];
    for kind in [
        tg_weapon::ProjectileKind::Ap,
        tg_weapon::ProjectileKind::Aphe,
        tg_weapon::ProjectileKind::Heat,
        tg_weapon::ProjectileKind::He,
    ] {
        let mut w = world(vec![base.clone()]);
        let c = w
            .first_contact([10.0, 0.0, 0.0], [-10.0, 0.0, 0.0], None)
            .unwrap();
        ap.kind = kind;
        assert!(w.impact(&c, &ap, [-800.0, 0.0, 0.0], 1, false));
        result.push(w.views()[0].health);
    }
    assert_eq!(result[0], result[1]);
    assert_eq!(result[0], result[2]);
    assert!(result[3] < result[0]);
}

#[test]
fn naval_scenario_actual_hull_footprints_remain_in_water_and_reach_safe_final_stops() {
    let source: serde_json::Value = serde_json::from_str(include_str!(
        "../../../data/frontline/scenarios/taiwan-landing-escort.json"
    ))
    .unwrap();
    let mut config: NavalConfig = serde_json::from_value(source["naval"].clone()).unwrap();
    for s in &mut config.vessels {
        s.ammo = 0;
    }
    let mut next = 100;
    let mut w = NavalWorld::new(&config, 7, &mut next).unwrap();
    let map: serde_json::Value =
        serde_json::from_str(include_str!("../../../data/frontline/taiwan-escort.json")).unwrap();
    let ground = crate::frontline_sim::MapGround::load(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../data")
            .as_path(),
        &map,
    )
    .unwrap();
    for _ in 0..1800 {
        w.step(0.5, |_, _, _, _| false);
        for v in w.views() {
            let hull = &w.geometries[&v.model].parts[0];
            for i in 0..hull.triangles.len() {
                for p in hull.triangle(i).map(|p| part_world(&v, hull, p)) {
                    assert!(
                        p[0] < 366.69,
                        "actual hull crossed near-shore limit: {} {:?}",
                        v.id,
                        p
                    );
                    assert!(
                        ground.water_level(p[0], p[2]).is_some(),
                        "actual hull left canonical water: {} {:?}",
                        v.id,
                        p
                    );
                }
            }
        }
    }
    assert!(w
        .views()
        .iter()
        .all(|v| dot(v.velocity, v.velocity).sqrt() < 0.05));
    let t = w
        .views()
        .into_iter()
        .find(|v| v.role == "transport")
        .unwrap();
    assert!(
        (t.pos[0] - 280.0).hypot(t.pos[2] + 100.0) < 30.0,
        "transport must remain able to unload after escorts park: {:?}",
        t.pos
    );
}

#[test]
fn naval_visible_hull_and_deck_triangles_have_exterior_winding() {
    let w = world(vec![]);
    for g in w.geometries.values() {
        for p in g.parts.iter().filter(|p| p.id == "hull" || p.id == "deck") {
            for i in 0..p.triangles.len() {
                let t = p.triangle(i);
                let n = cross(sub(t[1], t[0]), sub(t[2], t[0]));
                let c = std::array::from_fn(|j| (t[0][j] + t[1][j] + t[2][j]) / 3.0);
                assert!(dot(n, c) > 0.0, "inward {} {} triangle {}", g.id, p.id, i);
            }
        }
    }
}

#[test]
fn naval_blast_cannot_charge_hidden_internal_surfaces_behind_its_own_hull() {
    let mut base = world(vec![spec("ship", 0, "generic_transport", [0.0; 3])]);
    let mut with_internal = base.clone();
    let g = Arc::make_mut(&mut with_internal.geometries)
        .get_mut("generic_transport")
        .unwrap();
    let mut hidden = Part::new("internal_bulkheads", "hull", [0.3; 3], [0.0; 3], false);
    for _ in 0..20 {
        hidden.quad(
            [0.0, -1.0, -5.0],
            [0.0, 1.0, -5.0],
            [0.0, 1.0, 5.0],
            [0.0, -1.0, 5.0],
        );
    }
    g.parts.push(hidden);
    g.hash = sha256(&serde_json::to_vec(&json!({"id":g.id,"parts":g.parts})).unwrap());
    with_internal
        .units
        .get_mut(&100)
        .unwrap()
        .view
        .geometry_hash = g.hash.clone();
    base.blast([20.0, 0.0, 0.0], 10.0, 1, false, None);
    with_internal.blast([20.0, 0.0, 0.0], 10.0, 1, false, None);
    assert_eq!(
        base.views()[0].health,
        with_internal.views()[0].health,
        "hidden compartment surfaces must not increase exposed area"
    );
}

#[test]
fn naval_gun_cannot_fire_through_friendly_hull_when_external_los_is_clear() {
    let mut a = spec("a", 0, "generic_escort", [0.0; 3]);
    a.ammo = 1;
    let mut b = spec("b", 0, "generic_escort", [0.0, 0.0, 200.0]);
    b.ammo = 0;
    let mut c = spec("c", 1, "generic_interceptor", [0.0, 0.0, 500.0]);
    c.ammo = 0;
    let mut w = world(vec![a, b, c]);
    for _ in 0..120 {
        assert!(w.step(1.0 / 60.0, |_, _, _, _| true).is_empty());
    }
    assert_eq!(w.views()[0].ammo, 1, "blocked shot cannot consume a round");
}

#[test]
fn naval_authored_convoy_routes_park_without_stacking_and_keep_transport_access() {
    let source: Value = serde_json::from_str(include_str!(
        "../../../data/frontline/scenarios/taiwan-landing-escort.json"
    ))
    .unwrap();
    let mut config: NavalConfig = serde_json::from_value(source["naval"].clone()).unwrap();
    for s in &mut config.vessels {
        s.ammo = 0;
    }
    let mut next = 100;
    let mut w = NavalWorld::new(&config, 7, &mut next).unwrap();
    for _ in 0..1800 {
        w.step(0.5, |_, _, _, _| false);
        let views = w.views();
        for a in &views {
            for b in &views {
                if a.unit < b.unit && a.team == b.team {
                    let d = (a.pos[0] - b.pos[0]).hypot(a.pos[2] - b.pos[2]);
                    let minimum =
                        (w.geometries[&a.model].length + w.geometries[&b.model].length) * 0.5;
                    assert!(
                        d >= minimum,
                        "convoy hulls overlap: {} {} d{}",
                        a.id,
                        b.id,
                        d
                    );
                }
            }
        }
    }
    let t = w
        .views()
        .into_iter()
        .find(|v| v.role == "transport")
        .unwrap();
    assert!(
        (t.pos[0] - 280.0).hypot(t.pos[2] + 100.0) < 30.0,
        "transport cannot access landing: {:?}",
        w.views()
            .iter()
            .map(|v| (&v.id, v.pos, v.velocity))
            .collect::<Vec<_>>()
    );
    assert!(dot(t.velocity, t.velocity).sqrt() < 0.05);
}

#[test]
fn naval_blast_respects_injected_exact_external_terrain_and_facility_occlusion() {
    let mut w = world(vec![spec("ship", 0, "generic_transport", [0.0; 3])]);
    let initial = w.views();
    let mut probes = 0;
    let changed = w.blast_with_los([20.0, 0.0, 0.0], 10.0, 1, false, None, |a, b| {
        probes += 1;
        assert_eq!(a, [20.0, 0.0, 0.0]);
        assert!(ray::finite(b));
        false
    });
    assert!(probes > 0);
    assert!(changed.is_empty());
    assert_eq!(initial, w.views());
    assert_eq!(
        w.blast_with_los([20.0, 0.0, 0.0], 10.0, 1, false, None, |_, _| true),
        vec![100]
    );
    assert!(w.views()[0].health < initial[0].health);
}
