use super::*;
use std::path::PathBuf;
fn data() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")
}
fn map() -> Value {
    json!({"terrain":{"width":3,"height":3,"cellX":2000.0,"cellZ":2000.0,"x0":-2000.0,"z0":-2000.0,"heights":vec![0.0;9],"patches":[],"pads":[]}})
}
fn world() -> SimWorld {
    SimWorld::load(&data(), &map()).unwrap()
}
fn advance(w: &mut SimWorld, seconds: f64) -> Vec<SimEvent> {
    let mut events = vec![];
    for _ in 0..(seconds * 20.0).round() as usize {
        events.extend(w.step(0.05))
    }
    events
}
fn aim(w: &mut SimWorld, id: u64, p: [f64; 3]) {
    for _ in 0..160 {
        if w.aim_at(id, p).unwrap() {
            return;
        }
        w.step(0.05);
    }
    panic!("native turret failed to slew to target")
}

fn wet_fixture(bridge: bool, height: f64) -> Value {
    let mut m = map();
    m["terrain"]["heights"] = json!(vec![3.0; 9]);
    m["terrain"]["roadbeds"] = json!({"cellSize":256,"segments":[[0,-100,height,0,100,height,8,8]],"cells":{"-1,-1":[0],"-1,0":[0],"0,-1":[0],"0,0":[0]}});
    m["roads"] = json!([{"id":"road","from":"A","to":"B","connected":true,"navEnabled":true,"halfWidth":8,"roadbedSegments":[0],"points":[[0,height,-100],[0,height,100]]}]);
    m["terrain"]["waterAreas"] = json!([{"id":"river","ring":[[-30,20],[30,20],[30,40],[-30,40],[-30,20]],"holes":[],"level":0}]);
    m["terrain"]["bridges"] = if bridge {
        json!([{"id":"registered-deck","roadbedSegments":[0],"halfWidth":8,"deckThickness":1,"waterAreaIds":["river"],"authored":true}])
    } else {
        json!([])
    };
    m["navigation"]["hydroCoverage"] =
        json!([{"bounds":{"minX":-500,"maxX":500,"minZ":-500,"maxZ":500}}]);
    m
}

#[test]
fn roadbed_weighted_height_negative_cells_and_incomplete_index_are_verified() {
    let mut m = wet_fixture(false, 13.0);
    m["navigation"] = json!({});
    let g = MapGround::load(&data(), &m).unwrap();
    assert!((g.height(-12.0, -10.0) - 8.0).abs() < 1e-9);
    assert!((g.height(12.0, -10.0) - 8.0).abs() < 1e-9);
    let beds = m["terrain"]["roadbeds"].as_object_mut().unwrap();
    beds["segments"]
        .as_array_mut()
        .unwrap()
        .push(json!([0, -100, 23, 0, 100, 23, 8, 8]));
    for ids in beds["cells"].as_object_mut().unwrap().values_mut() {
        *ids = json!([0, 1]);
    }
    let g = MapGround::load(&data(), &m).unwrap();
    assert!(
        (g.height(-0.1, -0.1) - 18.0).abs() < 1e-9,
        "Overlap uses weighted average/max influence, in stable segment order"
    );
    m["terrain"]["roadbeds"]["cells"]
        .as_object_mut()
        .unwrap()
        .remove("-1,-1");
    assert!(MapGround::load(&data(), &m).is_err());
}

#[test]
fn wet_holes_deck_core_clearance_and_whole_native_spawn_footprint_are_enforced() {
    let mut m = wet_fixture(false, 3.0);
    m["terrain"]["waterAreas"][0]["holes"] =
        json!([[[-1, 29], [1, 29], [1, 31], [-1, 31], [-1, 29]]]);
    let mut w = SimWorld::load(&data(), &m).unwrap();
    assert!(w.ground.ground_navigation_allowed(0.0, 30.0));
    assert!(
        !w.ground.ground_navigation_allowed(1.0, 30.0),
        "Hole boundary remains conservatively wet"
    );
    assert!(
        w.spawn_unit(1, "su_t72a", 0, [0.0, 3.0, 30.0], 0.0)
            .is_err(),
        "Dry centre alone cannot admit wet tracks/hull"
    );
    let m = wet_fixture(true, 3.0);
    let mut w = SimWorld::load(&data(), &m).unwrap();
    assert!(w.ground.ground_navigation_allowed(0.0, 30.0));
    assert!(
        !w.ground.ground_navigation_allowed(9.0, 30.0),
        "Blend shoulder is not deck core"
    );
    assert!(
        !w.ground.ground_navigation_allowed(0.0, 600.0),
        "Outside hydro coverage fails closed"
    );
    w.spawn_unit(1, "su_t72a", 0, [0.0, 3.0, 30.0], 0.0)
        .unwrap();
    let mut low = SimWorld::load(&data(), &wet_fixture(true, 1.5)).unwrap();
    assert!(
        low.spawn_unit(1, "su_t72a", 0, [0.0, 1.5, 30.0], 0.0)
            .is_err(),
        "A registered name cannot exempt a deck below water+2m"
    );
}

#[test]
fn explicit_internal_deck_wedge_supports_only_its_polygon_and_valid_shared_source() {
    let mut m = wet_fixture(true, 3.0);
    m["terrain"]["roadbeds"]["segments"] =
        json!([[0, -100, 3, 0, 30, 3, 8, 8], [0, 30, 3, 50, 30, 3, 8, 8]]);
    for ids in m["terrain"]["roadbeds"]["cells"]
        .as_object_mut()
        .unwrap()
        .values_mut()
    {
        *ids = json!([0, 1]);
    }
    m["roads"][0]["points"] = json!([[0, 3, -100], [0, 3, 30], [50, 3, 30]]);
    m["roads"][0]["roadbedSegments"] = json!([0, 1]);
    m["terrain"]["bridges"][0]["roadbedSegments"] = json!([0, 1]);
    m["terrain"]["waterAreas"][0]["ring"] =
        json!([[-50, -120], [80, -120], [80, 80], [-50, 80], [-50, -120]]);
    assert!(!MapGround::load(&data(), &m)
        .unwrap()
        .ground_navigation_allowed(-1.0, 31.0));
    m["terrain"]["bridges"][0]["jointGeometry"] = json!({
        "version":1,"source":{"kind":"authored_internal_deck_joint_wedges"},
        "sharedVertices":[{"point":[0,30],"roadbedSegments":[0,1]}],
        "polygons":[{"ring":[[0,30],[-2,30],[-2,32],[0,30]],"holes":[]}],
        "triangles":[[0,30,-2,30,-2,32]]
    });
    let g = MapGround::load(&data(), &m).unwrap();
    assert!(
        g.ground_navigation_allowed(-1.0, 31.0),
        "The exact registered wedge boundary is a physical support"
    );
    assert!(
        !g.ground_navigation_allowed(-3.0, 33.0),
        "An internal joint does not imply an analytical full disc"
    );
    assert!(
        !g.ground_navigation_allowed(-1.0, -105.0),
        "A dangling segment end never gains an unregistered cap"
    );
    let mut bad = m.clone();
    bad["terrain"]["bridges"][0]["jointGeometry"]["sharedVertices"][0]["point"] = json!([0, 31]);
    assert!(
        MapGround::load(&data(), &bad).is_err(),
        "Declared joint must match the actual shared source endpoint"
    );
    let mut bad = m.clone();
    bad["terrain"]["bridges"][0]["jointGeometry"]["triangles"][0] = json!([0, 30, -4, 30, -2, 32]);
    assert!(
        MapGround::load(&data(), &bad).is_err(),
        "Rendered triangle coverage cannot silently exceed the registered polygon"
    );
}

#[test]
fn accepted_human_throttle_and_inertia_meet_native_wet_contacts_while_deck_crosses() {
    let mut blocked = SimWorld::load(&data(), &wet_fixture(false, 3.0)).unwrap();
    blocked
        .spawn_unit(1, "su_t72a", 0, [0.0, 3.0, 0.0], 0.0)
        .unwrap();
    blocked
        .set_input(
            1,
            SimInput {
                throttle: 1.0,
                ..Default::default()
            },
        )
        .unwrap();
    let ammo = blocked.snapshot(1).unwrap().ammo;
    for _ in 0..400 {
        blocked.step(0.05);
        let u = &blocked.units[&1];
        assert!(
            u.model.plant.collide.iter().all(|p| {
                let v = u.tank.body.world_point(*p);
                blocked.ground.ground_navigation_allowed(v[0], v[2])
            }),
            "Actual native outline must remain on the dry side under accepted input"
        );
    }
    assert!(blocked.snapshot(1).unwrap().pos[2] > 5.0);
    assert!(blocked.snapshot(1).unwrap().pos[2] < 20.0);
    assert_eq!(blocked.snapshot(1).unwrap().ammo, ammo);
    let mut impulse = SimWorld::load(&data(), &wet_fixture(false, 3.0)).unwrap();
    impulse
        .spawn_unit(1, "su_t72a", 0, [0.0, 3.0, 0.0], 0.0)
        .unwrap();
    advance(&mut impulse, 0.5);
    impulse.units.get_mut(&1).unwrap().tank.body.v = [0.0, 0.0, 18.0];
    advance(&mut impulse, 3.0);
    assert!(
        impulse.snapshot(1).unwrap().pos[2] < 20.0,
        "No input gate can replace native inertial contact"
    );
    let mut bridge = SimWorld::load(&data(), &wet_fixture(true, 3.0)).unwrap();
    bridge
        .spawn_unit(1, "su_t72a", 0, [0.0, 3.0, 0.0], 0.0)
        .unwrap();
    bridge
        .set_input(
            1,
            SimInput {
                throttle: 1.0,
                ..Default::default()
            },
        )
        .unwrap();
    advance(&mut bridge, 20.0);
    assert!(
        bridge.snapshot(1).unwrap().pos[2] > 45.0,
        "Accepted native powertrain must cross the actual registered deck core"
    );
}

#[test]
fn actual_source_hydro_probes_and_each_route_uphill_probe_use_native_ground() {
    let m: Value =
        serde_json::from_slice(&std::fs::read(data().join("frontline/korea.json")).unwrap())
            .unwrap();
    let mut w = SimWorld::load(&data(), &m).unwrap();
    let policy = w.ground.policy.as_ref().expect("Full theatre hydro policy");
    for p in m["sampling"]["wetValidationProbes"].as_array().unwrap() {
        let x = p["x"].as_f64().unwrap();
        let z = p["z"].as_f64().unwrap();
        assert_eq!(
            policy.water.iter().any(|a| a.contains(x, z)),
            p["expectedWet"].as_bool().unwrap()
        );
        assert_eq!(
            w.ground.ground_navigation_allowed(x, z),
            p["expectedSupported"].as_bool().unwrap(),
            "{p}"
        );
    }
    let proofs = m["navigation"]["routeSurfaceProofs"].as_array().unwrap();
    assert_eq!(proofs.len(), 12);
    for (i, proof) in proofs.iter().enumerate() {
        let p = &proof["worstNativeProbe"];
        let mut a: [f64; 3] = serde_json::from_value(p["start"].clone()).unwrap();
        let mut b: [f64; 3] = serde_json::from_value(p["end"].clone()).unwrap();
        if a[1] > b[1] {
            std::mem::swap(&mut a, &mut b);
        }
        let heading = (b[0] - a[0]).atan2(b[2] - a[2]);
        let id = i as u64 + 1;
        w.spawn_unit(id, "su_t72a", 0, a, heading).unwrap();
        advance(&mut w, 0.3);
        let before = w.snapshot(id).unwrap();
        w.set_input(
            id,
            SimInput {
                throttle: 0.8,
                ..Default::default()
            },
        )
        .unwrap();
        advance(&mut w, 4.0);
        let after = w.snapshot(id).unwrap();
        let gain = (after.pos[0] - before.pos[0]) * heading.sin()
            + (after.pos[2] - before.pos[2]) * heading.cos();
        assert!(
            after.alive && gain > 1.0,
            "{} actual native uphill progress {gain}: {:?}->{:?}",
            proof["roadId"],
            before.pos,
            after.pos
        );
        w.remove_unit(id);
    }
}

#[test]
fn actual_registered_turns_and_three_wet_deck_segments_are_driven_by_native_tanks() {
    let m: Value =
        serde_json::from_slice(&std::fs::read(data().join("frontline/korea.json")).unwrap())
            .unwrap();
    let cases: Value = serde_json::from_slice(
        &std::fs::read(
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../docs/air-frontline/research/korea-runtime-native-cases.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let mut w = SimWorld::load(&data(), &m).unwrap();
    let mut checked = [0, 0];
    for (i, case) in cases["cases"].as_array().unwrap().iter().enumerate() {
        let kind = case["kind"].as_str().unwrap();
        if kind != "turn" && kind != "bridge" {
            continue;
        }
        let keys = if kind == "turn" {
            vec!["approach", "corner", "departure"]
        } else {
            vec!["start", "end"]
        };
        let path: Vec<[f64; 3]> = keys
            .iter()
            .map(|key| serde_json::from_value(case[*key].clone()).unwrap())
            .collect();
        let heading = (path[1][0] - path[0][0]).atan2(path[1][2] - path[0][2]);
        let id = i as u64 + 1;
        w.spawn_unit(id, "su_t72a", 0, path[0], heading).unwrap();
        advance(&mut w, 0.3);
        let initial = w.snapshot(id).unwrap();
        let end = *path.last().unwrap();
        let mut plan = crate::frontline_campaign::NavigationPlan::registered_test_plan(
            &m,
            [path[0][0], path[0][2]],
            [end[0], end[2]],
            case["roadId"].as_str().unwrap(),
        );
        let mut reached = false;
        for _ in 0..600 {
            let s = w.snapshot(id).unwrap();
            let goal = plan.waypoint(s.pos);
            if plan.current_index() + 1 == plan.points.len()
                && (end[0] - s.pos[0]).hypot(end[2] - s.pos[2]) < 3.0
            {
                reached = true;
                break;
            }
            let input = w.navigation_input(id, goal, plan.next_waypoint()).unwrap();
            w.set_input(id, input).unwrap();
            w.step(0.05);
        }
        let final_state = w.snapshot(id).unwrap();
        assert!(
            reached && final_state.alive,
            "{} native route did not finish: {:?} -> {:?}; heading={}, velocity={:?}, index={}, path={:?}, input={:?}, contacts={:?}",
            case["id"],
            initial.pos,
            final_state.pos,
            final_state.heading,
            final_state.velocity,
            plan.current_index(),
            path,
            w.units[&id].input,
            w.units[&id].tank.obstacles
        );
        assert_eq!(
            final_state.ammo, initial.ammo,
            "Navigation does not manufacture or consume weapon resources"
        );
        checked[if kind == "turn" { 0 } else { 1 }] += 1;
        w.remove_unit(id);
    }
    assert_eq!(
        checked,
        [12, 3],
        "Source steep/turn/deck fixture count must not silently shrink"
    );
}

#[test]
fn real_tanks_move_independently_and_bad_controls_are_rejected() {
    let mut w = world();
    assert!(w.available_vehicles().contains(&"su_t72a".into()));
    w.spawn_unit(1, "su_t72a", 0, [0.0, 999.0, 0.0], 0.0)
        .unwrap();
    w.spawn_unit(2, "su_t34_85", 0, [25.0, 0.0, 0.0], 0.0)
        .unwrap();
    advance(&mut w, 1.0);
    let a = w.snapshot(1).unwrap();
    let b = w.snapshot(2).unwrap();
    assert!(
        a.pos[1].abs() < 5.0,
        "canonical terrain, not client Y, must place tank"
    );
    assert!(w
        .set_input(
            1,
            SimInput {
                throttle: f32::NAN,
                ..Default::default()
            }
        )
        .is_err());
    w.set_input(
        1,
        SimInput {
            throttle: 0.8,
            ..Default::default()
        },
    )
    .unwrap();
    advance(&mut w, 4.0);
    let moved = w.snapshot(1).unwrap();
    let idle = w.snapshot(2).unwrap();
    assert!(
        moved.pos[2] - a.pos[2] > 2.0,
        "actual suspension/powertrain must move: {:?}",
        moved.pos
    );
    assert!(
        (idle.pos[2] - b.pos[2]).abs() < 1.0,
        "other tank must not receive first input"
    );
    assert!(moved
        .velocity
        .iter()
        .chain(moved.pos.iter())
        .all(|v| v.is_finite()));
    assert!(
        w.spawn_unit(3, "su_t72a", 0, moved.pos, moved.heading)
            .is_err(),
        "spawn cannot overlap physical body"
    );
}

#[test]
fn source_ammo_reload_and_actual_native_impact_are_unit_owned() {
    let mut w = world();
    w.spawn_unit(1, "su_t72a", 0, [0.0, 0.0, 0.0], 0.0).unwrap();
    w.spawn_unit(
        2,
        "su_t34_85",
        1,
        [0.0, 0.0, 90.0],
        std::f64::consts::FRAC_PI_2,
    )
    .unwrap();
    advance(&mut w, 1.0);
    let before = w.snapshot(1).unwrap();
    let victim = w.snapshot(2).unwrap();
    let engine = w.units[&2].tank.body.world_point([0.0, 0.95, -1.45]);
    aim(&mut w, 1, engine);
    let shot = w.fire(1, Some("apfsds_125_3bm22")).unwrap();
    assert_eq!(shot.kind, "shot");
    assert_eq!(w.snapshot(1).unwrap().ammo, before.ammo - 1);
    assert_eq!(w.snapshot(2).unwrap().ammo, victim.ammo);
    assert!(w.snapshot(1).unwrap().ammo_revision > before.ammo_revision);
    assert!(w.fire(1, None).unwrap_err().contains("reloading"));
    let events = advance(&mut w, 1.0);
    let hit = events
        .iter()
        .find(|e| e.kind == "impact" && e.target == Some(2))
        .expect("real finite projectile flight must hit native side armour");
    assert_eq!(hit.detail["report"]["hit"], true);
    assert_ne!(
        w.snapshot(2).unwrap().damage,
        victim.damage,
        "native modules/crew must change from accepted impact"
    );
    assert!(
        !hit.detail["report"]["layers"]
            .as_array()
            .unwrap()
            .is_empty(),
        "impact must use source armour, not range kill"
    );
    assert_eq!(
        w.snapshot(1).unwrap().damage["modules"],
        before.damage["modules"],
        "target damage cannot mutate shooter modules"
    );
    assert_eq!(
        w.snapshot(1).unwrap().damage["crew"],
        before.damage["crew"],
        "target damage cannot mutate shooter crew"
    );
    assert_eq!(w.active_projectiles(), 0);
}

#[test]
fn friendly_damage_off_keeps_real_ballistic_obstruction() {
    let mut w = world();
    w.spawn_unit(1, "su_t72a", 0, [0.0, 0.0, 0.0], 0.0).unwrap();
    w.spawn_unit(
        2,
        "su_t34_85",
        0,
        [0.0, 0.0, 40.0],
        std::f64::consts::FRAC_PI_2,
    )
    .unwrap();
    w.spawn_unit(
        3,
        "su_t34_85",
        1,
        [0.0, 0.0, 90.0],
        std::f64::consts::FRAC_PI_2,
    )
    .unwrap();
    advance(&mut w, 1.0);
    let ally = w.snapshot(2).unwrap();
    let enemy = w.snapshot(3).unwrap();
    aim(&mut w, 1, [0.0, ally.pos[1] + 1.0, 90.0]);
    w.fire(1, Some("apfsds_125_3bm22")).unwrap();
    let events = advance(&mut w, 1.0);
    let hit = events
        .iter()
        .find(|e| e.kind == "impact")
        .expect("physical friendly contact");
    assert_eq!(hit.target, Some(2));
    assert_eq!(hit.detail["friendly_block"], true);
    assert_eq!(w.snapshot(2).unwrap().damage, ally.damage);
    assert_eq!(w.snapshot(3).unwrap().damage, enemy.damage);
    assert_eq!(
        w.active_projectiles(),
        0,
        "friendly body must stop exterior flight"
    );
}

#[test]
fn canonical_grid_patch_and_authored_pad_share_exact_height_formula() {
    let mut m = map();
    m["terrain"]["heights"] = json!(vec![10.0; 9]);
    m["terrain"]["patches"] = json!([{"width":3,"height":3,"cellX":20.0,"cellZ":20.0,"x0":-20.0,"z0":-20.0,"heights":vec![30.0;9],"blendMeters":10.0}]);
    m["terrain"]["pads"] = json!([{"id":"test","center":[60.0,0.0],"halfSize":[5.0,5.0],"height":50.0,"blendMeters":10.0,"authored":true}]);
    let g = MapGround::load(&data(), &m).unwrap();
    assert_eq!(g.height(0.0, 0.0), 30.0);
    assert_eq!(g.height(-20.0, 0.0), 10.0);
    assert_eq!(g.height(-15.0, 0.0), 20.0);
    assert_eq!(g.height(60.0, 0.0), 50.0);
    assert_eq!(g.height(70.0, 0.0), 30.0);
    assert_eq!(g.height(80.0, 0.0), 10.0);
}

#[test]
fn allied_hulls_obstruct_native_driving_not_only_spawn_queries() {
    let mut w = world();
    w.spawn_unit(1, "su_t72a", 0, [0.0, 0.0, 0.0], 0.0).unwrap();
    w.spawn_unit(2, "su_t72a", 0, [0.0, 0.0, 22.0], 0.0)
        .unwrap();
    advance(&mut w, 1.0);
    w.set_input(
        1,
        SimInput {
            throttle: 0.7,
            ..Default::default()
        },
    )
    .unwrap();
    w.set_input(
        2,
        SimInput {
            brake: 1.0,
            ..Default::default()
        },
    )
    .unwrap();
    for _ in 0..260 {
        w.step(0.05);
        let a = w.snapshot(1).unwrap();
        let b = w.snapshot(2).unwrap();
        assert!(
            a.pos[2] < b.pos[2] - 3.0,
            "native hull must remain obstructed {:?} {:?}",
            a.pos,
            b.pos
        );
    }
    assert!(
        w.snapshot(1).unwrap().pos[2] > 8.0,
        "tank should actually approach the obstruction"
    );
}

#[test]
fn actual_korean_staging_uses_the_client_canonical_source_elevations() {
    let path = data().join("frontline/korea.json");
    let m: Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let g = MapGround::load(&data(), &m).unwrap();
    for p in m["sampling"]["validationProbes"].as_array().unwrap() {
        let x = p["x"].as_f64().unwrap();
        let z = p["z"].as_f64().unwrap();
        let y = p["height"].as_f64().unwrap();
        assert!(
            (g.height(x, z) - y).abs() < 0.001,
            "source native/edge-blend probe parity"
        );
    }
    let mut checked = 0;
    for source in m["staging"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["enabled"] == true)
    {
        for slot in source["spawnSlots"].as_array().unwrap() {
            checked += 1;
            let a = slot["pos"].as_array().unwrap();
            let x = a[0].as_f64().unwrap();
            let y = a[1].as_f64().unwrap();
            let z = a[2].as_f64().unwrap();
            assert!(
                (g.height(x, z) - y).abs() < 0.001,
                "same map/contact height required at {x},{z}: native={} source={y}",
                g.height(x, z)
            );
        }
    }
    assert_eq!(
        checked, 60,
        "six active front/team company sources require ten native-ground slots"
    );
}

#[test]
fn depleted_primary_round_switches_to_a_real_remaining_mounted_type() {
    let mut w = world();
    w.spawn_unit(1, "su_t72a", 0, [0.0, 0.0, 0.0], 0.0).unwrap();
    w.units
        .get_mut(&1)
        .unwrap()
        .ammo
        .counts
        .get_mut(MAIN)
        .unwrap()[0] = 0;
    let before = w.snapshot(1).unwrap();
    let shot = w.fire(1, None).unwrap();
    assert_eq!(shot.detail["projectile_id"], "heatfs_125_3bk14");
    assert_eq!(w.snapshot(1).unwrap().ammo, before.ammo - 1);
    assert_eq!(w.snapshot(1).unwrap().ammo_counts[MAIN][0], 0);
    assert_eq!(
        w.snapshot(1).unwrap().ammo_counts[MAIN][1],
        before.ammo_counts[MAIN][1] - 1
    );
}

#[test]
fn snapshot_primary_ammunition_excludes_an_actual_second_gun_pool() {
    let mut w = world();
    w.spawn_unit(1, "de_gepard", 0, [0.0, 0.0, 0.0], 0.0)
        .unwrap();
    let before = w.snapshot(1).unwrap();
    let main: u32 = before.ammo_counts[MAIN].iter().sum();
    let other: u32 = before.ammo_counts["gun:0:1"].iter().sum();
    assert_eq!(
        main, 340,
        "source Gepard main gun carries 320 HEI and 20 APDS"
    );
    assert_eq!(other, 340, "source second gun has a distinct carried pool");
    assert_eq!(
        before.ammo, main,
        "UI primary count must exclude the second gun"
    );
    assert_eq!(
        w.units[&1].ammo.finite_total().unwrap(),
        main + other,
        "native full mounted stock remains intact"
    );
    w.fire(1, Some("hei_35_kda")).unwrap();
    let after = w.snapshot(1).unwrap();
    assert_eq!(after.ammo, main - 1);
    assert_eq!(after.ammo_counts["gun:0:1"], before.ammo_counts["gun:0:1"]);
    assert_eq!(w.units[&1].ammo.finite_total().unwrap(), main + other - 1);
}

#[test]
fn lightweight_native_kinematics_and_cached_model_radius_match_existing_accepted_state() {
    let mut w = world();
    w.spawn_unit(11, "su_t72a", 0, [0.0, 0.0, 0.0], 0.4)
        .unwrap();
    w.spawn_unit(19, "su_t34_85", 1, [25.0, 0.0, 5.0], -0.5)
        .unwrap();
    w.set_input(
        11,
        SimInput {
            throttle: 0.7,
            steer: 0.3,
            ..Default::default()
        },
    )
    .unwrap();
    w.set_input(
        19,
        SimInput {
            throttle: 0.4,
            steer: -0.5,
            ..Default::default()
        },
    )
    .unwrap();
    advance(&mut w, 1.0);
    w.damage_unit_for_frontline_test(11);
    w.destroy_unit_for_frontline_test(19);
    advance(&mut w, 0.05);
    let full = w.snapshots();
    let clock = w.time();
    let light = w.kinematics();
    assert_eq!(full.len(), light.len());
    for (a, b) in full.iter().zip(&light) {
        assert_eq!((a.id, a.team, a.alive), (b.id, b.team, b.alive));
        assert_eq!(w.unit_dead(a.id), !a.alive);
        for (x, y) in a.pos.iter().zip(b.pos) {
            assert_eq!(x.to_bits(), y.to_bits());
        }
        for (x, y) in a.velocity.iter().zip(b.velocity) {
            assert_eq!(x.to_bits(), y.to_bits());
        }
    }
    assert!(
        !w.unit_dead(999999),
        "Unknown units preserve the previous snapshot(None) loss-check semantics"
    );
    assert_eq!(w.time(), clock);
    assert_eq!(
        serde_json::to_value(&full).unwrap(),
        serde_json::to_value(w.snapshots()).unwrap(),
        "Read-only kinematics cannot mutate ammo/damage/physics"
    );
    for model in w.models.values() {
        let original = model
            .plant
            .collide
            .iter()
            .map(|p| p[0].hypot(p[2]))
            .fold(0.0f64, f64::max);
        assert_eq!(model.collide_radius.to_bits(), original.to_bits());
    }
}

#[test]
fn tuple_roadbed_cache_matches_old_raw_lookup_order_and_height_bits_at_source_and_boundary_cells() {
    fn previous_raw_sample(r: &Roadbeds, old: f64, x: f64, z: f64) -> f64 {
        // Frozen previous sampler: string-key lookup and unchanged published
        // ordered weighted-height formula, independent of the new tuple cache.
        let key = format!(
            "{},{}",
            (x / r.cell_size).floor() as i64,
            (z / r.cell_size).floor() as i64
        );
        let ids = r.cells.get(&key).map(Vec::as_slice).unwrap_or(&[]);
        let (mut sum_w, mut sum_h, mut max_w) = (0.0f64, 0.0f64, 0.0f64);
        for &i in ids {
            let s = &r.segments[i];
            let (d, t) = Roadbeds::projection(s, x, z);
            let w = (1.0 - (d - s[6]).max(0.0) / s[7]).clamp(0.0, 1.0);
            sum_w += w;
            sum_h += w * (s[2] + t * (s[5] - s[2]));
            max_w = max_w.max(w);
        }
        if sum_w > 0.0 {
            old * (1.0 - max_w) + (sum_h / sum_w) * max_w
        } else {
            old
        }
    }
    for name in ["korea", "taiwan"] {
        let m: Value = serde_json::from_slice(
            &std::fs::read(data().join(format!("frontline/{name}.json"))).unwrap(),
        )
        .unwrap();
        let g = MapGround::load(&data(), &m).unwrap();
        let r = g.roadbeds.as_ref().unwrap();
        let mut positions = Vec::new();
        for &(cx, cz) in r.index.keys() {
            for vx in [cx, cx + 1] {
                for vz in [cz, cz + 1] {
                    for dx in [-1e-7, 0.0, 1e-7] {
                        for dz in [-1e-7, 0.0, 1e-7] {
                            positions.push([vx as f64 * 256.0 + dx, vz as f64 * 256.0 + dz]);
                        }
                    }
                }
            }
        }
        if name == "korea" {
            positions.extend(
                m["sampling"]["validationProbes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| [p["x"].as_f64().unwrap(), p["z"].as_f64().unwrap()]),
            );
        } else {
            let proof: Value = serde_json::from_slice(
                &std::fs::read(
                    data()
                        .join("../docs/air-frontline/research/taiwan-runtime-geography-proof.json"),
                )
                .unwrap(),
            )
            .unwrap();
            positions.extend(
                proof["heightProbes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| [p["pos"][0].as_f64().unwrap(), p["pos"][2].as_f64().unwrap()]),
            );
        }
        for [x, z] in &positions {
            let key = format!(
                "{},{}",
                (x / r.cell_size).floor() as i64,
                (z / r.cell_size).floor() as i64
            );
            assert_eq!(
                r.coarse_candidates(*x, *z),
                r.cells.get(&key).map(Vec::as_slice).unwrap_or(&[]),
                "{name} exact candidate order at {x},{z}"
            );
            for old in [g.grid.sample(*x, *z), -37.123456789] {
                assert_eq!(
                    r.sample(old, *x, *z).to_bits(),
                    previous_raw_sample(r, old, *x, *z).to_bits(),
                    "{name} preserved height bits at {x},{z}"
                );
            }
        }
        eprintln!(
            "{name}: {} exact source/boundary roadbed candidate+height-bit parity positions",
            positions.len()
        );
    }
}

#[test]
fn fine_roadbed_index_preserves_source_weight_order_and_height_bits_at_segments_and_cells() {
    fn rng(seed: &mut u64) -> f64 {
        *seed = seed
            .wrapping_mul(6364136223846793005)
            .wrapping_add(1442695040888963407);
        (*seed >> 11) as f64 / ((1u64 << 53) as f64)
    }
    for name in ["korea", "taiwan"] {
        let map: Value = serde_json::from_slice(
            &std::fs::read(data().join(format!("frontline/{name}.json"))).unwrap(),
        )
        .unwrap();
        let ground = MapGround::load(&data(), &map).unwrap();
        let fine = ground.roadbeds.as_ref().unwrap();
        let mut coarse = (**fine).clone();
        coarse.coarse_oracle = true;
        let mut positions = Vec::new();
        let eps = 1e-7;
        for s in &fine.segments {
            let dx = s[3] - s[0];
            let dz = s[4] - s[1];
            let length = dx.hypot(dz);
            let normal = [-dz / length, dx / length];
            let reach = s[6] + s[7];
            for t in [0.0, 0.5, 1.0] {
                for offset in [
                    -reach - eps,
                    -reach,
                    -reach + eps,
                    -s[6] - eps,
                    -s[6],
                    -s[6] + eps,
                    0.0,
                    s[6] - eps,
                    s[6],
                    s[6] + eps,
                    reach - eps,
                    reach,
                    reach + eps,
                ] {
                    positions.push([
                        s[0] + t * dx + normal[0] * offset,
                        s[1] + t * dz + normal[1] * offset,
                    ]);
                }
            }
            // Actual segment ends and round influence caps, approached from
            // outside as well as exactly on each source width/blend boundary.
            for (x, z, sign) in [(s[0], s[1], -1.0), (s[3], s[4], 1.0)] {
                for d in [
                    -eps,
                    0.0,
                    eps,
                    s[6] - eps,
                    s[6],
                    s[6] + eps,
                    reach - eps,
                    reach,
                    reach + eps,
                ] {
                    positions.push([x + sign * dx / length * d, z + sign * dz / length * d]);
                }
            }
        }
        let mut seed = 0x9e3779b97f4a7c15;
        for (cell, index) in [(256.0, &fine.index), (ROADBED_FINE_CELL, &fine.fine_index)] {
            for &(cx, cz) in index.keys() {
                // Both sides of every occupied fine/coarse cell edge,
                // including negative cells, plus deterministic interior probes.
                for shift in [0.0, 1.0] {
                    for delta in [-eps, 0.0, eps] {
                        positions.push([
                            (cx as f64 + shift) * cell + delta,
                            (cz as f64 + rng(&mut seed)) * cell,
                        ]);
                        positions.push([
                            (cx as f64 + rng(&mut seed)) * cell,
                            (cz as f64 + shift) * cell + delta,
                        ]);
                    }
                }
                for _ in 0..3 {
                    positions.push([
                        (cx as f64 + rng(&mut seed)) * cell,
                        (cz as f64 + rng(&mut seed)) * cell,
                    ]);
                }
            }
        }
        let mut source_probes: Vec<[f64; 2]> = map["sampling"]["validationProbes"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|p| [p["x"].as_f64().unwrap(), p["z"].as_f64().unwrap()])
            .collect();
        if name == "taiwan" {
            let proof: Value = serde_json::from_slice(
                &std::fs::read(
                    data()
                        .join("../docs/air-frontline/research/taiwan-runtime-geography-proof.json"),
                )
                .unwrap(),
            )
            .unwrap();
            source_probes.extend(
                proof["heightProbes"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|p| [p["pos"][0].as_f64().unwrap(), p["pos"][2].as_f64().unwrap()]),
            );
        }
        positions.extend(source_probes.iter().copied());
        let (mut coarse_count, mut fine_count, mut active_count) = (0, 0, 0);
        for &[x, z] in &positions {
            let old_ids = coarse.candidates(x, z);
            let ids = fine.candidates(x, z);
            assert!(ids.windows(2).all(|p| p[0] < p[1]));
            assert!(ids.iter().all(|id| old_ids.binary_search(id).is_ok()),
                "{name} fine candidates must be an ordered subset of the original authored cell at{x},{z}");
            let positive = |ids: &[usize]| {
                ids.iter()
                    .copied()
                    .filter(|&i| {
                        let s = &fine.segments[i];
                        let (d, _) = Roadbeds::projection(s, x, z);
                        (1.0 - (d - s[6]).max(0.0) / s[7]).clamp(0.0, 1.0) > 0.0
                    })
                    .collect::<Vec<_>>()
            };
            let old_positive = positive(old_ids);
            assert_eq!(
                positive(ids),
                old_positive,
                "{name} cannot drop or reorder any positive-weight segment at{x},{z}"
            );
            active_count += old_positive.len();
            coarse_count += old_ids.len();
            fine_count += ids.len();
            for old_height in [ground.grid.sample(x, z), -37.123456789] {
                assert_eq!(
                    fine.sample(old_height, x, z).to_bits(),
                    coarse.sample(old_height, x, z).to_bits(),
                    "{name} exact ordered weighted-height bits at{x},{z}"
                );
            }
            assert_eq!(fine.core(x, z), coarse.core(x, z));
        }
        let mut old_ground = ground.clone();
        Arc::make_mut(old_ground.roadbeds.as_mut().unwrap()).coarse_oracle = true;
        for [x, z] in source_probes
            .iter()
            .copied()
            .chain(positions.iter().step_by(128).copied())
        {
            assert_eq!(
                ground.height(x, z).to_bits(),
                old_ground.height(x, z).to_bits(),
                "{name} complete canonical overlay height bits at{x},{z}"
            );
        }
        assert!(fine_count < coarse_count);
        eprintln!("{name}:{} source/segment/core/blend/endcap/32m+256m boundary/random probes; coarse candidates{coarse_count},fine{fine_count},positive{active_count}; exact weight order/core/height bits",positions.len());
    }
}

#[test]
fn fine_roadbed_index_preserves_native_full_footprints_wet_navigation_and_motion() {
    let base = world();
    for name in ["korea", "taiwan"] {
        let map: Value = serde_json::from_slice(
            &std::fs::read(data().join(format!("frontline/{name}.json"))).unwrap(),
        )
        .unwrap();
        let mut fine = base.for_map(&data(), &map).unwrap();
        let mut coarse = fine.clone();
        Arc::make_mut(coarse.ground.roadbeds.as_mut().unwrap()).coarse_oracle = true;
        let model = fine.models["su_t72a"].clone();
        let mut footprint_points = 0;
        let mut check_pose = |pos: [f64; 3], heading: f64| {
            let mut a = Tank::new(&model.plant);
            let mut b = Tank::new(&model.plant);
            tank::place(&model.plant, &mut a, &fine.ground, pos[0], pos[2], heading);
            tank::place(
                &model.plant,
                &mut b,
                &coarse.ground,
                pos[0],
                pos[2],
                heading,
            );
            assert_eq!(
                format!("{:?}", a),
                format!("{:?}", b),
                "{name}: native placement unchanged"
            );
            for local in &model.plant.collide {
                let p = a.body.world_point(*local);
                assert_eq!(
                    fine.ground.height(p[0], p[2]).to_bits(),
                    coarse.ground.height(p[0], p[2]).to_bits()
                );
                assert_eq!(
                    fine.ground.water_level(p[0], p[2]),
                    coarse.ground.water_level(p[0], p[2])
                );
                assert_eq!(fine.ground.ground_navigation_allowed(p[0],p[2]),coarse.ground.ground_navigation_allowed(p[0],p[2]),
                    "{name}: entire actual native hull/track outline wet/deck/nav semantics at{p:?}");
                footprint_points += 1;
            }
        };
        let staging: Vec<_> = map["staging"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|s| s["enabled"] == true)
            .collect();
        assert_eq!(staging.len(), 6);
        for source in &staging {
            let slots = source["spawnSlots"].as_array().unwrap();
            assert_eq!(slots.len(), 10);
            for slot in slots {
                check_pose(
                    serde_json::from_value(slot["pos"].clone()).unwrap(),
                    slot["yawRad"].as_f64().unwrap(),
                );
            }
        }
        let cases: Value = serde_json::from_slice(
            &std::fs::read(data().join(format!(
                "../docs/air-frontline/research/{name}-runtime-native-cases.json"
            )))
            .unwrap(),
        )
        .unwrap();
        // Include real source maximum-grade/turn/deck poses. Navigation is
        // compared even on a legitimately unsupported point; no exemption.
        for case in cases["cases"].as_array().unwrap() {
            let p = case
                .get("start")
                .or_else(|| case.get("point"))
                .or_else(|| case.get("approach"));
            if let (Some(p), Some(yaw)) = (p, case["yawRad"].as_f64()) {
                check_pose(serde_json::from_value(p.clone()).unwrap(), yaw);
            }
        }
        drop(check_pose);
        for (i, source) in staging.iter().enumerate() {
            let slot = &source["spawnSlots"][0];
            let pos = serde_json::from_value(slot["pos"].clone()).unwrap();
            let heading = slot["yawRad"].as_f64().unwrap();
            for w in [&mut fine, &mut coarse] {
                w.spawn_unit(
                    i as u64 + 1,
                    "su_t72a",
                    source["team"].as_u64().unwrap() as u8,
                    pos,
                    heading,
                )
                .unwrap();
                w.set_input(
                    i as u64 + 1,
                    SimInput {
                        throttle: 0.4,
                        steer: 0.1,
                        ..Default::default()
                    },
                )
                .unwrap();
            }
        }
        for tick in 0..20 {
            assert_eq!(
                serde_json::to_vec(&fine.step(0.05)).unwrap(),
                serde_json::to_vec(&coarse.step(0.05)).unwrap()
            );
            assert_eq!(
                serde_json::to_vec(&fine.snapshots()).unwrap(),
                serde_json::to_vec(&coarse.snapshots()).unwrap(),
                "{name} tick{tick}: source accepted native movement/ammo/damage"
            );
            for (id, u) in &fine.units {
                assert_eq!(
                    format!("{:?}", u.tank),
                    format!("{:?}", coarse.units[id].tank),
                    "{name} tick{tick} id{id}: all native suspension/gear/contact/force state"
                );
            }
        }
        eprintln!("{name}:{footprint_points} actual source+case native hull/track probes exact height/water/nav parity;6 independent tank plants*20 actual20Hz steps identical complete native state");
    }
}

#[test]
fn scoped_native_unit_workers_match_serial_complete_state_contacts_combat_and_order() {
    fn identical(serial: &SimWorld, parallel: &SimWorld, scene: &str, tick: usize) {
        assert_eq!(serial.time().to_bits(), parallel.time().to_bits());
        assert_eq!(serial.accumulator.to_bits(), parallel.accumulator.to_bits());
        assert_eq!(serial.serial, parallel.serial);
        assert_eq!(
            format!("{:?}", serial.rounds),
            format!("{:?}", parallel.rounds)
        );
        assert_eq!(
            serde_json::to_vec(&serial.snapshots()).unwrap(),
            serde_json::to_vec(&parallel.snapshots()).unwrap(),
            "{scene} tick{tick}: accepted native pose/net/ammo/reload/damage/caps"
        );
        for (id, u) in &serial.units {
            let v = &parallel.units[id];
            assert!(
                u.tank
                    .body
                    .pos
                    .iter()
                    .chain(&u.tank.body.v)
                    .chain(&u.tank.body.w)
                    .chain(&u.tank.body.ex)
                    .chain(&u.tank.body.ey)
                    .chain(&u.tank.body.ez)
                    .all(|x| x.is_finite()),
                "{scene} tick{tick} id{id}: equivalence cannot certify nonfinite native motion"
            );
            assert_eq!(format!("{:?}",(&u.tank,&u.state,&u.ammo,&u.gun,&u.turret,&u.input)),
                format!("{:?}",(&v.tank,&v.state,&v.ammo,&v.gun,&v.turret,&v.input)),
                "{scene} tick{tick} id{id}: every rigid-body/gear/suspension/contact/resource/damage state bit");
        }
    }
    let base = world();
    let flat = map();
    let mut slope = json!({"terrain":{"width":21,"height":21,"cellX":20.0,"cellZ":20.0,
        "x0":-200.0,"z0":-200.0,"heights":[]}});
    slope["terrain"]["heights"] = json!((0..21)
        .flat_map(|z| (0..21)
            .map(move |x| { (x as f64 * 20.0 - 200.0) * 0.04 + (z as f64 * 20.0 - 200.0) * 0.07 }))
        .collect::<Vec<_>>());
    for (scene, map) in [
        ("near_body_contacts", flat.clone()),
        ("slope_and_native_shots", slope),
        ("registered_wet_bridge", wet_fixture(true, 3.0)),
        ("simultaneous_native_deaths", flat),
    ] {
        let mut serial = base.for_map(&data(), &map).unwrap();
        // Intentionally non-sorted admission; phase/events must nevertheless
        // retain the original BTreeMap ID order across the worker boundary.
        for id in [8, 3, 6, 1, 7, 4, 2, 5] {
            let (pos, heading, team, input) = match scene {
                "near_body_contacts" => {
                    let pair = (id - 1) / 2;
                    let front = id % 2 == 1;
                    (
                        [
                            pair as f64 * 20.0 - 30.0,
                            0.0,
                            if front { -4.5 } else { 4.5 },
                        ],
                        if front { 0.0 } else { std::f64::consts::PI },
                        u8::from(!front),
                        SimInput {
                            throttle: 0.7,
                            ..Default::default()
                        },
                    )
                }
                "registered_wet_bridge" => (
                    [0.0, 3.0, -46.0 + (id - 1) as f64 * 12.0],
                    0.0,
                    (id % 2) as u8,
                    SimInput {
                        throttle: 0.45,
                        ..Default::default()
                    },
                ),
                _ => {
                    let pos = if id == 1 {
                        [0.0, 0.0, -60.0]
                    } else if id == 2 {
                        [0.0, 0.0, 80.0]
                    } else {
                        [(id as f64 - 5.0) * 24.0, 0.0, -110.0]
                    };
                    (
                        pos,
                        0.0,
                        u8::from(id == 2),
                        if id <= 2 {
                            SimInput {
                                brake: 1.0,
                                ..Default::default()
                            }
                        } else {
                            SimInput {
                                throttle: 0.35,
                                steer: 0.08,
                                ..Default::default()
                            }
                        },
                    )
                }
            };
            serial
                .spawn_unit(id, "su_t72a", team, pos, heading)
                .unwrap();
            serial.set_input(id, input).unwrap();
        }
        if scene == "simultaneous_native_deaths" {
            for id in [7, 2, 4] {
                let u = serial.units.get_mut(&id).unwrap();
                // Source crew/fire fixture enters the actual native advance
                // during this step. No runtime HP/destroy shortcut is used.
                u.state.crew.fill(0.0);
                u.state.fire_s = 0.1;
                u.state.fire_at = u.model.target.def.crew.first().map(|c| c.pos);
                assert!(!u.state.destroyed);
            }
        }
        serial.forced_unit_workers = Some(1);
        serial.timing = None;
        let mut parallel = serial.clone();
        parallel.forced_unit_workers = Some(4);
        parallel.timing = Some(SimTimings::default());
        assert_eq!(serial.native_unit_workers(), 1);
        assert_eq!(parallel.native_unit_workers(), 4);
        let initial = serial.snapshots();
        let mut deaths = Vec::new();
        let mut impacts = 0;
        let mut shots = 0;
        let mut body_contact_seen = false;
        let mut wet_outline_seen = false;
        for tick in 0..100 {
            let mut accepted = [Vec::new(), Vec::new()];
            for (which, w) in [&mut serial, &mut parallel].into_iter().enumerate() {
                if scene == "slope_and_native_shots" {
                    let target = w.snapshot(2).unwrap();
                    if w.aim_at(1, [target.pos[0], target.pos[1] + 0.8, target.pos[2]])
                        .unwrap()
                    {
                        if let Ok(e) = w.fire(1, None) {
                            accepted[which].push(e);
                        }
                    }
                }
                let dt = [0.05, 0.017, 0.003, 0.03, 0.025, 0.0][tick % 6];
                accepted[which].extend(w.step(dt));
            }
            assert_eq!(
                serde_json::to_vec(&accepted[0]).unwrap(),
                serde_json::to_vec(&accepted[1]).unwrap(),
                "{scene} tick{tick}: worker completion order must never reorder accepted events"
            );
            identical(&serial, &parallel, scene, tick);
            deaths.extend(
                accepted[0]
                    .iter()
                    .filter(|e| e.kind == "destroyed")
                    .filter_map(|e| e.target),
            );
            impacts += accepted[0].iter().filter(|e| e.kind == "impact").count();
            shots += accepted[0].iter().filter(|e| e.kind == "shot").count();
            if scene == "near_body_contacts" {
                for u in serial.units.values() {
                    let mut body = u.tank.body.clone();
                    body_contact_seen |= tank::obstacle::apply_obstacles(
                        &u.model.plant.collide,
                        &mut body,
                        &u.tank.obstacles,
                        FIXED_DT,
                    ) > 0;
                }
            }
            if scene == "registered_wet_bridge" {
                for u in serial.units.values() {
                    for local in &u.model.plant.collide {
                        let p = u.tank.body.world_point(*local);
                        wet_outline_seen |= serial.ground.water_level(p[0], p[2]).is_some();
                        assert!(serial.ground.ground_navigation_allowed(p[0],p[2]),
                            "The complete actual native footprint must remain supported by the registered deck");
                    }
                }
            }
        }
        let timing = parallel.timings().unwrap();
        assert_eq!(timing.unit_workers, 4);
        assert_eq!(timing.parallel_fixed_steps, timing.fixed_steps);
        assert!(timing.unit_phase_wall_ns > 0 && timing.summed_unit_elapsed_ns > 0);
        assert!(serial.timings().is_none());
        match scene {
            "near_body_contacts" => assert!(
                body_contact_seen,
                "Actual native point/OBB contacts must execute"
            ),
            "slope_and_native_shots" => {
                assert!(
                    shots > 0 && impacts > 0,
                    "Actual mounted fire and native plate/box contacts must execute"
                );
                assert!(
                    serial.snapshot(1).unwrap().ammo
                        < initial.iter().find(|s| s.id == 1).unwrap().ammo
                );
                assert_ne!(
                    serial.snapshot(2).unwrap().damage,
                    initial.iter().find(|s| s.id == 2).unwrap().damage
                );
            }
            "registered_wet_bridge" => assert!(
                wet_outline_seen,
                "Dry bridge naming is not a wet contact test"
            ),
            _ => assert_eq!(
                deaths,
                vec![2, 4, 7],
                "Same-step destruction events retain original global ID order"
            ),
        }
        eprintln!("{scene}:8 actual native plants,{} fixed120Hz steps, forced1vs4 workers, exact complete state/events/resources/clock parity;shots{shots},impacts{impacts},deaths{deaths:?}",timing.fixed_steps);
    }
}

#[test]
fn native_unit_worker_policy_keeps_small_worlds_and_single_cpu_serial() {
    let mut w = world();
    w.unit_worker_capacity = 4;
    assert_eq!(w.native_unit_workers(), 1);
    for id in 1..=16 {
        w.spawn_unit(id, "su_t72a", 0, [-150.0 + id as f64 * 18.0, 0.0, 0.0], 0.0)
            .unwrap();
        assert_eq!(w.native_unit_workers(), if id < 16 { 1 } else { 4 });
    }
    w.unit_worker_capacity = 1;
    assert_eq!(
        w.native_unit_workers(),
        1,
        "A single-CPU host must never spawn extra workers"
    );
    w.unit_worker_capacity = 8;
    assert_eq!(
        w.native_unit_workers(),
        4,
        "The platform count never creates more than four batches"
    );
    assert!(
        w.forced_unit_workers.is_none(),
        "Production policy does not depend on the test-only override"
    );
}

#[test]
fn diagnostic_sim_timing_is_authority_neutral_for_real_motion_fire_and_damage() {
    let mut plain = world();
    plain
        .spawn_unit(1, "su_t72a", 0, [0.0, 0.0, 0.0], 0.0)
        .unwrap();
    plain
        .spawn_unit(2, "su_t72a", 1, [0.0, 0.0, 300.0], std::f64::consts::PI)
        .unwrap();
    plain.timing = None;
    let mut profiled = plain.clone();
    profiled.timing = Some(SimTimings::default());
    for w in [&mut plain, &mut profiled] {
        w.set_input(
            1,
            SimInput {
                throttle: 0.3,
                steer: 0.05,
                ..Default::default()
            },
        )
        .unwrap();
        w.fire(1, None).unwrap();
    }
    for _ in 0..40 {
        let a = plain.step(0.05);
        let b = profiled.step(0.05);
        assert_eq!(
            serde_json::to_value(a).unwrap(),
            serde_json::to_value(b).unwrap()
        );
        assert_eq!(
            serde_json::to_value(plain.snapshots()).unwrap(),
            serde_json::to_value(profiled.snapshots()).unwrap(),
            "Diagnostics cannot alter accepted motion/resources/damage"
        );
        assert_eq!(plain.time().to_bits(), profiled.time().to_bits());
        for (id, unit) in &plain.units {
            assert_eq!(
                format!("{:?}", unit.tank),
                format!("{:?}", profiled.units[id].tank),
                "Fine diagnostics preserve every native rigid-body, suspension, track, gearbox and contact state"
            );
        }
    }
    assert!(plain.timings().is_none());
    let t = profiled.timings().unwrap();
    assert_eq!(t.fixed_steps, 240);
    assert_eq!(t.air_ns, 0);
    assert!(
        t.tank_physics_ns > 0
            && t.contact_prep_ns > 0
            && t.ground_combat_ns > 0
            && t.projectile_ns > 0
    );
    assert!(t.ground_ns >= t.tank_physics_ns);
    assert_eq!(t.tank_detail.calls, 480);
    assert!(t.tank_detail.substeps >= t.tank_detail.calls);
    assert!(t.tank_detail.sample_ground_ns > 0);
    assert!(t.tank_detail.obstacles_ns > 0);
    assert!(t.tank_detail.inertia_suspension_ns > 0);
    assert!(t.tank_detail.rigid_contacts_ns > 0);
    assert!(t.tank_detail.powertrain_ns > 0);
    assert!(t.tank_detail.friction_prepare_ns > 0);
    assert!(t.tank_detail.friction_solve_ns > 0);
    assert!(t.tank_detail.integrate_pose_ns > 0);
    assert!(t.tank_detail.report_ns > 0);
}
