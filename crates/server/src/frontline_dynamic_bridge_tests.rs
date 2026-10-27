//! Native mutable deck/contact tests. Source maps and immutable policy caches
//! remain unchanged; no client pose, invented riverbed or automatic repair.
use super::*;
use crate::flight_runtime::{FlightInput, FlightModule, FlightSpawn, LandingArea};
use crate::frontline::{ObjectiveView, Team};
use crate::frontline_campaign::Campaign;
use std::sync::OnceLock;

fn data() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")
}
fn flat_map() -> Value {
    json!({"terrain":{"width":3,"height":3,"cellX":2000.0,"cellZ":2000.0,"x0":-2000.0,"z0":-2000.0,"heights":vec![0.0;9],"patches":[],"pads":[]}})
}
fn wet_map() -> Value {
    let mut map = flat_map();
    map["terrain"]["heights"] = json!(vec![3.0; 9]);
    map["terrain"]["roadbeds"] = json!({"cellSize":256,"segments":[[0,-100,3,0,100,3,8,8]],"cells":{"-1,-1":[0],"-1,0":[0],"0,-1":[0],"0,0":[0]}});
    map["roads"] = json!([{"id":"road","from":"A","to":"B","lane":"west","connected":true,"navEnabled":true,"halfWidth":8,"roadbedSegments":[0],"points":[[0,3,-100],[0,3,100]]}]);
    map["terrain"]["waterAreas"] = json!([{"id":"river","ring":[[-30,20],[30,20],[30,40],[-30,40],[-30,20]],"holes":[],"level":0}]);
    map["terrain"]["bridges"] = json!([{"id":"deck-A","roadbedSegments":[0],"halfWidth":8,"deckThickness":1,"waterAreaIds":["river"],"authored":true}]);
    map["navigation"]["hydroCoverage"] =
        json!([{"bounds":{"minX":-500,"maxX":500,"minZ":-500,"maxZ":500}}]);
    map
}
fn template() -> &'static SimWorld {
    static WORLD: OnceLock<SimWorld> = OnceLock::new();
    WORLD.get_or_init(|| SimWorld::load(&data(), &flat_map()).unwrap())
}
fn world(map: &Value, battle: u64) -> SimWorld {
    let mut w = template().for_map(&data(), map).unwrap();
    w.set_battle_id(battle).unwrap();
    w
}
fn tick(w: &mut SimWorld, seconds: f64) {
    for _ in 0..(seconds * 20.0).round() as usize {
        w.step(0.05);
    }
}

#[test]
fn dynamic_bridge_shared_ground_cas_restore_and_pristine_cache_are_room_local() {
    let map = wet_map();
    let mut template = world(&map, 100);
    let mut a = template.clone();
    a.set_battle_id(101).unwrap();
    let mut b = template.clone();
    b.set_battle_id(102).unwrap();
    let air_ground = Arc::new(a.ground.clone());
    let original = a.ground.height(0.0, 30.0).to_bits();
    assert!(Arc::ptr_eq(
        a.ground.policy.as_ref().unwrap(),
        b.ground.policy.as_ref().unwrap()
    ));
    assert!(!Arc::ptr_eq(
        &a.ground.bridge_states,
        &b.ground.bridge_states
    ));
    assert_eq!(a.ground.bridge_state("deck-A").unwrap().revision, 1);
    let lost = a.ground.set_bridge_destroyed("deck-A", 1, true).unwrap();
    assert_eq!(lost.revision, 2);
    assert!(lost.destroyed);
    assert_eq!(air_ground.height(0.0, 30.0), 0.0);
    assert_eq!(air_ground.support_height(0.0, 30.0), None);
    assert!(!air_ground.ground_navigation_allowed(0.0, 30.0));
    assert_eq!(b.ground.height(0.0, 30.0).to_bits(), original);
    assert_eq!(template.ground.height(0.0, 30.0).to_bits(), original);
    assert!(b.ground.has_support(0.0, 30.0));
    // Repeating an empty room's already assigned identity must preserve the
    // actual aircraft clone's shared state, rather than silently detach it.
    a.set_battle_id(101).unwrap();
    assert!(Arc::ptr_eq(
        &a.ground.bridge_states,
        &air_ground.bridge_states
    ));
    let damaged_again = a.ground.set_bridge_destroyed("deck-A", 2, true).unwrap();
    assert_eq!(damaged_again.revision, 3);
    assert!(a.ground.set_bridge_destroyed("deck-A", 2, false).is_err());
    assert!(air_ground.bridge_state("deck-A").unwrap().destroyed);
    let repaired = a.ground.set_bridge_destroyed("deck-A", 3, false).unwrap();
    assert_eq!(repaired.revision, 4);
    assert_eq!(air_ground.height(0.0, 30.0).to_bits(), original);
    assert_eq!(
        air_ground.support_height(0.0, 30.0).unwrap().to_bits(),
        original
    );
    assert!(air_ground.ground_navigation_allowed(0.0, 30.0));
    let fresh = MapGround::load(&data(), &map).unwrap();
    // A bounded global cache may have evicted this source while other rooms
    // compile. Recompilation must preserve immutable policy content, not an
    // allocation address that the cache never promises to retain forever.
    assert_eq!(format!("{:?}",fresh.policy.as_ref().unwrap()),
        format!("{:?}",a.ground.policy.as_ref().unwrap()));
    assert_eq!(fresh.bridge_state("deck-A").unwrap().revision, 1);
    assert_eq!(fresh.height(0.0, 30.0).to_bits(), original);
    assert!(a
        .ground
        .set_bridge_destroyed("forged-source-id", 1, true)
        .is_err());
    assert_eq!(a.ground.terrain, map["terrain"]);
    // Independent source scene policy recompilation also ignores mutable
    // state when making globally cached barriers.
    template.ground.select_navigation_scene(&map).unwrap();
    assert_eq!(template.ground.height(0.0, 30.0).to_bits(), original);
}

#[test]
fn concurrent_ground_policy_compilers_publish_one_cached_arc_and_keep_the_four_entry_bound() {
    let map = wet_map();
    let ground = MapGround::load(&data(),&map).unwrap();
    let compile = || {
        let mut policy = GroundPolicy::load(&map,&ground).unwrap();
        policy.barriers(&ground);
        Arc::new(policy)
    };
    // Deterministic real interleaving: A and B both finish compiling a cold
    // source before either publishes. The real production publish operation
    // runs under its mutex; the second publisher must adopt the accepted Arc.
    let first = compile();
    let second = compile();
    assert!(!Arc::ptr_eq(&first,&second));
    let key = serde_json::to_vec(&map).unwrap();
    let mut entries = Vec::new();
    let accepted = publish_ground_policy(&mut entries,key.clone(),first);
    let raced = publish_ground_policy(&mut entries,key.clone(),second);
    assert!(Arc::ptr_eq(&accepted,&raced),"a duplicate compiler must return the existing published policy");
    assert_eq!(entries.len(),1);
    assert_eq!(entries[0].0,key);
    for serial in 0..5 { publish_ground_policy(&mut entries,vec![serial],accepted.clone()); }
    assert_eq!(entries.len(),4,"concurrent deduplication cannot make the cache unbounded");
    assert_eq!(entries.iter().map(|(key,_)|key.clone()).collect::<Vec<_>>(),vec![vec![1],vec![2],vec![3],vec![4]]);
}

#[test]
fn dynamic_bridge_explicit_joint_and_overlapping_live_deck_have_real_support_membership() {
    let mut map = wet_map();
    map["terrain"]["roadbeds"]["segments"] =
        json!([[0, -100, 3, 0, 100, 3, 8, 8], [0, 100, 3, 50, 100, 3, 8, 8]]);
    for indices in map["terrain"]["roadbeds"]["cells"]
        .as_object_mut()
        .unwrap()
        .values_mut()
    {
        *indices = json!([0, 1]);
    }
    map["roads"][0]["roadbedSegments"] = json!([0, 1]);
    map["roads"][0]["points"] = json!([[0, 3, -100], [0, 3, 100], [50, 3, 100]]);
    map["terrain"]["waterAreas"][0]["ring"] =
        json!([[-30, 80], [80, 80], [80, 120], [-30, 120], [-30, 80]]);
    let bridge = &mut map["terrain"]["bridges"][0];
    bridge["roadbedSegments"] = json!([0, 1]);
    bridge["jointGeometry"] = json!({"version":1,"source":{"kind":"authored_internal_deck_joint_wedges"},"sharedVertices":[{"point":[0,100],"roadbedSegments":[0,1]}],"polygons":[{"ring":[[0,100],[-4,104],[0,104],[0,100]],"holes":[]}],"triangles":[[0,100,-4,104,0,104]]});
    let g = MapGround::load(&data(), &map).unwrap();
    let q = [-1.0, 103.0];
    assert!(g.ground_navigation_allowed(q[0], q[1]));
    let source = g.height(q[0], q[1]).to_bits();
    g.set_bridge_destroyed("deck-A", 1, true).unwrap();
    assert!(!g.ground_navigation_allowed(q[0], q[1]));
    assert_eq!(g.height(q[0], q[1]), 0.0);
    assert_eq!(g.support_height(q[0], q[1]), None);
    g.set_bridge_destroyed("deck-A", 2, false).unwrap();
    assert_eq!(g.height(q[0], q[1]).to_bits(), source);
    assert!(g.has_support(q[0], q[1]));
    let mut duplicate = map["terrain"]["bridges"][0].clone();
    duplicate["id"] = json!("deck-B");
    map["terrain"]["bridges"]
        .as_array_mut()
        .unwrap()
        .push(duplicate);
    let g = MapGround::load(&data(), &map).unwrap();
    g.set_bridge_destroyed("deck-A", 1, true).unwrap();
    assert!(
        g.has_support(q[0], q[1]),
        "The remaining registered deck really covers this joint"
    );
    assert_eq!(g.height(q[0], q[1]).to_bits(), source);
    g.set_bridge_destroyed("deck-B", 1, true).unwrap();
    assert!(!g.has_support(q[0], q[1]));
    assert_eq!(g.height(q[0], q[1]), 0.0);
}

#[test]
fn dynamic_bridge_native_tank_falls_below_water_and_cannot_drive_on_an_invisible_water_floor() {
    let map = wet_map();
    let mut w = world(&map, 201);
    w.spawn_unit(1, "su_t72a", 0, [0.0, 3.0, 30.0], 0.0)
        .unwrap();
    w.set_input(
        1,
        SimInput {
            brake: 1.0,
            ..Default::default()
        },
    )
    .unwrap();
    tick(&mut w, 0.75);
    let start = w.units[&1].tank.body.origin();
    let ammo = w.snapshot(1).unwrap().ammo;
    assert!(start[1] > 2.5);
    w.ground.set_bridge_destroyed("deck-A", 1, true).unwrap();
    w.set_input(
        1,
        SimInput {
            throttle: 1.0,
            ..Default::default()
        },
    )
    .unwrap();
    tick(&mut w, 1.5);
    let u = &w.units[&1];
    let after = u.tank.body.origin();
    assert!(
        after[1] < -2.0,
        "Actual six-DOF body must fall THROUGH water plane: {start:?} -> {after:?}"
    );
    assert!(
        after[2] < 35.0,
        "Track motors cannot drive to the opposite shore without contact: {after:?}"
    );
    assert!(u.tank.ss.load.iter().all(|n| *n == 0.0));
    assert!(u.tank.ss.grounded.iter().all(|v| !v));
    assert!(u.tank.contacts.is_empty());
    assert_eq!(u.tank.cs.belly, 0.0);
    assert!(u
        .tank
        .cs
        .prof
        .iter()
        .all(|p| p.supported.iter().all(|v| !v) && p.h.iter().all(|h| h.is_finite())));
    assert_eq!(w.snapshot(1).unwrap().ammo, ammo);
    assert!(after
        .into_iter()
        .chain(u.tank.body.v)
        .chain(u.tank.body.w)
        .all(f64::is_finite));
    eprintln!("dynamic_bridge actual native fall: start={start:?} end={after:?}; water=0; loads/contact/belly=0; input=real full throttle");
}

#[test]
fn dynamic_bridge_same_actual_flight_store_requeries_shared_room_ground_after_loss_and_repair() {
    let map = wet_map();
    let w = world(&map, 301);
    let air_ground = Arc::new(w.ground.clone());
    let module = FlightModule::bundled().unwrap();
    let mut runtime = module
        .instantiate(
            air_ground,
            vec![LandingArea {
                center: [0.0, 30.0],
                forward: [0.0, 1.0],
                half_width: 20.0,
                half_length: 100.0,
            }],
        )
        .unwrap();
    runtime
        .configure_airframe(&[
            3200.0, 22.0, 2.1, 11.0, 14000.0, 21000.0, 6500.0, 0.026, 0.065, 4.5, 0.28, 0.0,
            15500.0, 0.0,
        ])
        .unwrap();
    let spawn = FlightSpawn {
        position: [0.0, 100.0, 30.0],
        heading: 0.0,
        airspeed: 0.0,
        on_ground: true,
    };
    runtime.spawn(spawn.clone()).unwrap();
    assert_eq!(runtime.telemetry().unwrap().state[1], 5.0);
    w.ground.set_bridge_destroyed("deck-A", 1, true).unwrap();
    // This is the SAME actual wasm Store and imported Arc, not reinstantiation
    // or a client buffer write. Spawn directly exercises the native ground import.
    runtime
        .step(
            1.0 / 120.0,
            &FlightInput {
                throttle: 0.0,
                ..Default::default()
            },
        )
        .unwrap();
    runtime.spawn(spawn.clone()).unwrap();
    assert_eq!(runtime.telemetry().unwrap().state[1], 2.0);
    w.ground.set_bridge_destroyed("deck-A", 2, false).unwrap();
    runtime.spawn(spawn).unwrap();
    assert_eq!(runtime.telemetry().unwrap().state[1], 5.0);
}

#[test]
fn dynamic_bridge_pristine_and_restored_source_height_bits_match_both_maps_without_json_mutation() {
    for id in ["korea", "taiwan"] {
        let source: Value = serde_json::from_slice(
            &std::fs::read(data().join(format!("frontline/{id}.json"))).unwrap(),
        )
        .unwrap();
        let g = MapGround::load(&data(), &source).unwrap();
        let before = g.terrain.clone();
        let probes: Vec<[f64; 2]> = if id == "korea" {
            source["sampling"]["validationProbes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| [p["x"].as_f64().unwrap(), p["z"].as_f64().unwrap()])
                .collect()
        } else {
            let proof: Value = serde_json::from_slice(
                &std::fs::read(
                    data()
                        .join("../docs/air-frontline/research/taiwan-runtime-geography-proof.json"),
                )
                .unwrap(),
            )
            .unwrap();
            proof["heightProbes"]
                .as_array()
                .unwrap()
                .iter()
                .map(|p| [p["pos"][0].as_f64().unwrap(), p["pos"][2].as_f64().unwrap()])
                .collect()
        };
        let expected: Vec<_> = probes
            .iter()
            .map(|p| {
                let h = g.height(p[0], p[1]);
                assert_eq!(h.to_bits(), g.canonical_height(p[0], p[1]).to_bits());
                h.to_bits()
            })
            .collect();
        let bridge = g.bridge_states().into_iter().next().unwrap();
        g.set_bridge_destroyed(&bridge.id, 1, true).unwrap();
        g.set_bridge_destroyed(&bridge.id, 2, false).unwrap();
        for (p, bits) in probes.iter().zip(expected) {
            assert_eq!(g.height(p[0], p[1]).to_bits(), bits, "{id} restored {p:?}");
        }
        assert_eq!(g.terrain, before);
        assert_eq!(g.terrain, source["terrain"]);
    }
}

fn objective(id: &str, z: f64, team: Team) -> ObjectiveView {
    ObjectiveView {
        id: id.into(),
        name: id.into(),
        pos: [0.0, 3.0, z],
        radius: 30.0,
        owner: Some(team),
        progress: if team == Team::Blue { 1.0 } else { -1.0 },
        lane: "west".into(),
        capturable: [false; 2],
        supplied: [false; 2],
        contested: false,
        presence: [0; 2],
        presence_visible: [true; 2],
    }
}
#[test]
fn dynamic_bridge_campaign_owner_aggregates_all_losses_before_reopening_registered_route() {
    let mut map = wet_map();
    let mut second = map["terrain"]["bridges"][0].clone();
    second["id"] = json!("deck-B");
    map["terrain"]["bridges"]
        .as_array_mut()
        .unwrap()
        .push(second);
    map["campaign"] = json!({"supplyEntrypoints":[["A"],["B"]],"terminalObjectives":[["B"],["A"]]});
    let ground = MapGround::load(&data(), &map).unwrap();
    let mut points = vec![
        objective("A", -100.0, Team::Blue),
        objective("B", 100.0, Team::Red),
    ];
    let mut campaign = Campaign::load(&map, &mut points).unwrap();
    assert!(campaign.route_open("road"));
    ground.set_bridge_destroyed("deck-A", 1, true).unwrap();
    ground.set_bridge_destroyed("deck-B", 1, true).unwrap();
    campaign
        .set_route_open(
            "road",
            ground.bridge_states().iter().all(|b| !b.destroyed),
            &mut points,
        )
        .unwrap();
    assert!(!campaign.route_open("road"));
    ground.set_bridge_destroyed("deck-A", 2, false).unwrap();
    campaign
        .set_route_open(
            "road",
            ground.bridge_states().iter().all(|b| !b.destroyed),
            &mut points,
        )
        .unwrap();
    assert!(
        !campaign.route_open("road"),
        "One repaired bridge cannot clear another accepted loss"
    );
    ground.set_bridge_destroyed("deck-B", 2, false).unwrap();
    campaign
        .set_route_open(
            "road",
            ground.bridge_states().iter().all(|b| !b.destroyed),
            &mut points,
        )
        .unwrap();
    assert!(campaign.route_open("road"));
    assert!(campaign
        .set_route_open("invented-route", true, &mut points)
        .is_err());
    assert!(campaign.route_open("road"));
}

#[test]
fn perception_los_uses_accepted_vehicle_boxes_excludes_endpoints_and_keeps_old_ai_los() {
    let mut w = world(&flat_map(), 401);
    w.spawn_unit(1, "su_t72a", 0, [0.0, 0.0, -25.0], 0.0)
        .unwrap();
    w.spawn_unit(2, "su_t72a", 1, [0.0, 0.0, 25.0], 0.0)
        .unwrap();
    let (a, b) = ([0.0, 1.2, -25.0], [0.0, 1.2, 25.0]);
    assert!(w.line_of_sight(a, b));
    assert!(w.perception_los(1, 2, a, b));
    w.spawn_unit(3, "su_t72a", 1, [0.0, 0.0, 0.0], 0.71)
        .unwrap();
    assert!(
        w.line_of_sight(a, b),
        "Legacy AI function remains terrain-only"
    );
    assert!(
        !w.perception_los(1, 2, a, b),
        "Accepted rotated native hull blocks perception"
    );
    assert!(w.perception_los(1, 2, [10.0, 1.2, -25.0], [10.0, 1.2, 25.0]));
    assert!(!w.perception_los(1, 2, [f64::NAN, 1.2, -25.0], b));
    w.destroy_unit_for_frontline_test(3);
    assert!(
        !w.perception_los(1, 2, a, b),
        "Retained physical wreck does not become transparent"
    );
}
