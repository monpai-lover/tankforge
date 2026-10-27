use super::*;
use std::io::Write;
use std::sync::OnceLock;

const ID: u64 = 71;
const PLAYER: u32 = 7;
const DT: f64 = 1.0 / 120.0;

fn actual_browser_poses(samples: Value, source_mesh: bool) -> Value {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut input = json!({"app":root.join("handoff/bundle/app.js.html"),"samples":samples});
    if source_mesh {
        input["nativeRecord"] =
            json!(root.join("handoff/aircraft_assets/me262-game-v2-20261025/me262.json"));
    }
    let mut child = std::process::Command::new("node")
        .arg(root.join("handoff/tests/flight_model_pose_parity.mjs"))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(serde_json::to_string(&input).unwrap().as_bytes())
        .unwrap();
    let result = child.wait_with_output().unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let result: Value = serde_json::from_slice(&result.stdout).unwrap();
    assert_eq!(result["actualProductionPose"], true);
    result
}

#[test]
fn accepted_model_basis_matches_actual_production_pose_for_all_twenty_six_types() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let catalog: Catalog =
        serde_json::from_slice(&std::fs::read(root.join("aircraft/frontline.json")).unwrap())
            .unwrap();
    let mut samples = Vec::new();
    let mut expected = Vec::new();
    for (id, p) in &catalog.aircraft {
        for (index, (agl, gear, speed, q)) in [
            (2.0, 1.0, 0.0, [0.0, 0.0, 0.0, 1.0]),
            (2.0, 1.0, 0.0, [0.12, 0.17, -0.20, 0.95]),
            (
                2.0,
                1.0,
                p.physics.rotate_kmh / 3.6 * 0.35,
                [-0.16, 0.26, 0.21, 0.92],
            ),
            (
                2.0,
                1.0,
                p.physics.rotate_kmh / 3.6 * 0.6,
                [0.22, -0.31, 0.13, 0.90],
            ),
            (2.15, 1.0, 20.0, [0.12, 0.17, -0.20, 0.95]),
            (2.3, 1.0, 40.0, [-0.16, 0.26, 0.21, 0.92]),
            (2.6, 1.0, 100.0, [0.22, -0.31, 0.13, 0.90]),
            (2.0, 0.89, 10.0, [0.12, 0.17, -0.20, 0.95]),
            (1500.0, 0.0, 180.0, [-0.16, 0.26, 0.21, 0.92]),
        ]
        .into_iter()
        .enumerate()
        {
            // Pose/coordinate fixtures, not forged live flight outcomes. Native
            // impulse/touchdown and weapon/contact behavior are tested separately.
            let mut state = vec![0.0f32; 80];
            state[0] = 27000.125;
            state[1] = 1002.0;
            state[2] = -33444.75;
            let norm = q.iter().map(|v| v * v).sum::<f64>().sqrt();
            state[3..7].copy_from_slice(&q.map(|v| (v / norm) as f32));
            state[13] = speed as f32;
            state[33] = gear;
            state[35] = agl;
            let points = vec![
                [0.0, 0.0, 0.0],
                p.guns.first().map(|g| g.mount).unwrap_or([0.0, 0.0, 4.0]),
                [-3.0, -0.4, -5.0],
                [3.0, 0.7, 5.0],
            ];
            let pose = accepted_model_pose(&p.physics, &state);
            expected.push((id.clone(), index, pose, points.clone()));
            samples.push(json!({"gear":p.physics.gear,"rotateKmh":p.physics.rotate_kmh,"state":state,"points":points}));
        }
    }
    let node = actual_browser_poses(json!(samples), false);
    let mut max_error = 0.0f64;
    for ((id, index, pose, points), other) in
        expected.iter().zip(node["samples"].as_array().unwrap())
    {
        for (actual, js) in pose
            .matrix()
            .iter()
            .zip(other["matrix"].as_array().unwrap())
        {
            let delta = (actual - js.as_f64().unwrap()).abs();
            max_error = max_error.max(delta);
            assert!(
                delta < 1e-6,
                "{id}/{index}: actual Aircraft.pose matrix mismatch {delta}"
            );
        }
        for (local, world) in points.iter().zip(other["points"].as_array().unwrap()) {
            let browser = vector(world).unwrap();
            assert!(
                distance(pose.point(*local), browser) < 1e-6,
                "{id}/{index} source point"
            );
            assert!(
                distance(pose.local_point(browser), *local) < 1e-7,
                "{id}/{index} inverse source point"
            );
        }
    }
    eprintln!(
        "Actual Aircraft.pose basis cases={} types26 max_matrix_error={max_error} app_sha256={}",
        expected.len(),
        node["appSha256"]
    );
}

#[test]
fn real_parked_gun_store_blast_and_contact_share_the_actual_visible_model_frame() {
    let (mut air, mut ground) = fixture_for("me262", "runway", 1);
    let mut input = service_hold_input(&air.units[&ID].state);
    input.fire = true;
    input.release = true;
    air.accept_input(ID, input, air.time).unwrap();
    let events = ground.step_combined(DT, &mut air);
    let u = &air.units[&ID];
    let state = u.state.clone();
    let mut points = u.profile.guns.iter().map(|g| g.mount).collect::<Vec<_>>();
    points.push(vector(&u.profile.stores["loadouts"][1]["items"][0]["p"]).unwrap());
    let engine = u
        .damage
        .parts
        .iter()
        .find(|p| p.def.id == "engine_l")
        .unwrap()
        .def
        .c;
    points.push(add(engine, [0.0, 0.3, 0.0]));
    let node = actual_browser_poses(
        json!([{"gear":u.profile.physics.gear,"rotateKmh":u.profile.physics.rotate_kmh,"state":state,"points":points}]),
        true,
    );
    let projected = node["samples"][0]["points"].as_array().unwrap();
    for (index, g) in u.profile.guns.iter().enumerate() {
        let shot = events
            .iter()
            .find(|e| e.kind == "shot" && e.detail["weapon_instance"] == g.id)
            .unwrap();
        assert!(
            distance(shot.pos, vector(&projected[index]).unwrap()) < 1e-6,
            "Source gun muzzle {}",
            g.id
        );
    }
    let store = events
        .iter()
        .find(|e| e.kind == "shot" && e.detail["store"] == true)
        .unwrap();
    assert!(
        distance(store.pos, vector(&projected[u.profile.guns.len()]).unwrap()) < 1e-6,
        "Actual mounted source-store origin"
    );
    assert_eq!(
        u.runtime.telemetry().unwrap().state,
        state,
        "World-frame projection must not move the WASM plant"
    );
    let mut expected = u.damage.clone();
    let seed = 1221;
    let tnt = 0.00001;
    expected.blast(
        points[points.len() - 1],
        tnt,
        &mut Rng::new(seed ^ ID),
        &mut vec![],
    );
    air.blast(
        vector(projected.last().unwrap()).unwrap(),
        tnt,
        1,
        seed,
        false,
        None,
    );
    for (actual, want) in air.units[&ID].damage.parts.iter().zip(&expected.parts) {
        assert!(
            (actual.hp - want.hp).abs() < 1e-7,
            "Blast must use the source model inverse: {}",
            actual.def.id
        );
    }
    let u = &air.units[&ID];
    let ty = &air.template.damage_types["me262"];
    let model = accepted_model_pose(&u.profile.physics, &u.state);
    let engine = u
        .damage
        .parts
        .iter()
        .find(|p| p.def.id == "engine_l")
        .unwrap();
    let old_local = |point: [f64; 3]| {
        let d = sub(point, u.pos());
        std::array::from_fn(|i| (0..3).map(|k| u.state[42 + i * 3 + k] as f64 * d[k]).sum())
    };
    let ray=node["visibleProbes"].as_array().unwrap().iter().find(|p|{
        let a=vector(&p["a"]).unwrap();let b=vector(&p["b"]).unwrap();
        let legacy_miss=ty.skin.iter().all(|s|crate::aircraft::slab(old_local(a),old_local(b),s.c,s.h).is_none())
            &&u.damage.parts.iter().filter(|p|!p.detached).all(|p|crate::aircraft::slab(old_local(a),old_local(b),p.def.c,p.def.h).is_none());
        let engine_contact=crate::aircraft::slab(model.local_point(a),model.local_point(b),engine.def.c,engine.def.h).is_some();
        p["part"]=="EXT_Nacelle_L"&&legacy_miss&&engine_contact&&air.first_contact(a,b,999).is_some()
    }).expect("Find a finite ray through an actual uploaded source triangle that the old raised plant frame missed");
    let a = vector(&ray["a"]).unwrap();
    let b = vector(&ray["b"]).unwrap();
    assert_eq!(air.first_contact(a, b, 999).unwrap().1, ID);
    // Use the catalog's non-explosive 30mm AP round here: explosive filler stops
    // direct traversal at the first accepted structure before its blast, so
    // the separate AP traversal makes engine contact independently observable.
    let shell = air.template.shells["apt_30_pzgr"].clone();
    assert_eq!(shell.explosive_mass_kg, 0.0);
    let result = air
        .hit(ID, a, b, &shell, [0.0, -505.0, 0.0], 1, seed, false)
        .unwrap();
    assert_eq!(result["damage_applied"], true);
    assert_eq!(result["contact_model"], "accepted_aircraft_boxes");
    assert!(
        result["hit"]["parts"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p == "engine_l"),
        "{result}"
    );
    assert!(result["hit"]["t"].as_f64().unwrap().is_finite());
    eprintln!("Actual visible source triangle ray node={} face={} now contacts shared accepted boxes; no triangle-contact migration",ray["sourceNode"],ray["sourceFace"]);
}

fn fixture() -> (AirWorld, SimWorld) {
    fixture_for("f86f", "runway", 3)
}

#[test]
fn native_countermeasure_only_completed_service_rearms_the_same_life(){
    let (mut air,mut ground)=fixture_for("su27","runway",0);
    let initial=air.units[&ID].countermeasures.view();assert!(initial.flares>=2);
    air.release_countermeasure(ID,"flares").unwrap();
    let spent=air.units[&ID].countermeasures.view();assert_eq!(spent.flares,initial.flares-2);
    let identity=air.units[&ID].reference;
    air.request_service(ID,0,0.0).unwrap();
    assert!(air.release_countermeasure(ID,"chaff").is_err());
    assert_eq!(air.units[&ID].countermeasures.view(),spent,"a request cannot grant stock or skip the dispenser interval");
    air.cancel_service(ID).unwrap();assert_eq!(air.units[&ID].countermeasures.view().flares,spent.flares);
    air.request_service(ID,0,0.0).unwrap();
    ticks(&mut air,&mut ground,1799);assert_eq!(air.units[&ID].countermeasures.view().flares,spent.flares);
    ticks(&mut air,&mut ground,1);
    let completed=air.units[&ID].countermeasures.view();assert_eq!(completed.flares,initial.flares);assert_eq!(completed.chaff,initial.chaff);
    assert_eq!(completed.release_seq,1);assert_eq!(air.units[&ID].reference,identity);assert!(air.units[&ID].countermeasures.decoys().is_empty());
}

#[test]
fn lightweight_ai_target_projection_matches_full_native_snapshots_and_trajectory() {
    for air_target in [false, true] {
        let (mut light, mut ground) = fixture_for("me262", "air", 0);
        let (mut old, mut old_ground) = fixture_for("me262", "air", 0);
        old.legacy_target_oracle = true;
        light.timings = Some(AirTimings::default());
        old.timings = None;
        for (world, tanks) in [(&mut light, &mut ground), (&mut old, &mut old_ground)] {
            let source = world.map["staging"]
                .as_array()
                .unwrap()
                .iter()
                .find(|s| s["enabled"] == true && s["team"] == 1)
                .unwrap();
            let p = vector(&source["pos"]).unwrap();
            tanks.spawn_unit(900, "su_t72a", 1, p, 0.0).unwrap();
            world.units.get_mut(&ID).unwrap().controller = None;
            world.test_spawn_at(
                ID,
                FlightSpawn {
                    position: [p[0] as f32, p[1] as f32 + 800.0, p[2] as f32 - 600.0],
                    heading: 0.0,
                    airspeed: 160.0,
                    on_ground: false,
                },
            );
            if air_target {
                world
                    .spawn(
                        UnitRef {
                            battle: 9,
                            unit: 72,
                            life: 1,
                        },
                        "f86f",
                        Team::Red,
                        None,
                        "air",
                        0,
                    )
                    .unwrap();
                world.test_spawn_at(
                    72,
                    FlightSpawn {
                        position: [
                            p[0] as f32 + 100.0,
                            p[1] as f32 + 850.0,
                            p[2] as f32 + 600.0,
                        ],
                        heading: std::f32::consts::PI,
                        airspeed: 160.0,
                        on_ground: false,
                    },
                );
            }
        }
        for _ in 0..120 {
            // This is the previous full projection, retained solely as the test
            // oracle. It is never used by the production120Hz targeting path.
            let views = old
                .views()
                .iter()
                .map(|v| AirKinematics {
                    team: v.team,
                    alive: v.alive,
                    pos: v.pos,
                    velocity: [v.state[7] as f64, v.state[8] as f64, v.state[9] as f64],
                })
                .collect::<Vec<_>>();
            let tanks = old_ground
                .snapshots()
                .iter()
                .map(|v| SimKinematics {
                    id: v.id,
                    team: v.team,
                    alive: v.alive,
                    pos: v.pos,
                    velocity: v.velocity,
                })
                .collect::<Vec<_>>();
            assert_eq!(views, light.kinematics());
            assert!(tanks == ground.kinematics());
            let actual = light.step(DT, &mut ground);
            let expected = old.step_with_kinematics(DT, &mut old_ground, views, tanks);
            assert_eq!(
                serde_json::to_string(&actual).unwrap(),
                serde_json::to_string(&expected).unwrap()
            );
            assert_eq!(serde_json::to_string(&light.views()).unwrap(),serde_json::to_string(&old.views()).unwrap(),"AI target selection, lead, inputs, accepted128floats and finite resources must remain identical");
        }
        let timing = light.timings().unwrap();
        assert_eq!(timing.steps, 120);
        assert!(timing.runtime_ns > 0 && timing.targeting_ns > 0);
        assert!(old.timings().is_none());
    }
}

#[test]
fn nearest_visible_native_targets_preserve_ties_occlusion_and_old_store_trajectories() {
    let data = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let template = fixture_for("me262", "air", 0).0.template.clone();
    for scene in ["clear", "left_blocked", "all_blocked"] {
        let mut heights = vec![0.0; 9 * 13];
        if scene == "left_blocked" {
            heights[5 * 9 + 3] = 500.0;
        }
        if scene == "all_blocked" {
            for x in 0..9 {
                heights[5 * 9 + x] = 500.0;
            }
        }
        // Explicit test terrain is sampled by the actual native LOS and flight
        // imports. Accepted states are initialized through independent WASM
        // spawn calls, never by editing telemetry arrays or faking a LOS result.
        let map = json!({"terrain":{"width":9,"height":13,"cellX":100.0,"cellZ":100.0,"x0":-400.0,"z0":0.0,"heights":heights},
            "objectives":[{"id":"C2","pos":[0,0,1200]}],"airfields":[],
            "airspawns":[{"enabled":true,"team":0,"pos":[0,200,0]},{"enabled":true,"team":1,"pos":[0,200,1100]}]});
        let make = |legacy| {
            let mut ground = SimWorld::load(&data, &map).unwrap();
            ground.set_battle_id(9).unwrap();
            let mut world = template.world(Arc::new(ground.ground.clone()), map.clone());
            world.legacy_target_oracle = legacy;
            for (id, team, aircraft, p) in [
                (71, Team::Blue, "me262", [0.0, 200.0, 0.0]),
                (72, Team::Red, "f86f", [-200.0, 200.0, 1000.0]),
                (73, Team::Red, "f86f", [200.0, 200.0, 1000.0]),
                (74, Team::Red, "f86f", [0.0, 200.0, 1100.0]),
            ] {
                world
                    .spawn(
                        UnitRef {
                            battle: 9,
                            unit: id,
                            life: 1,
                        },
                        aircraft,
                        team,
                        None,
                        "air",
                        0,
                    )
                    .unwrap();
                world.test_spawn_at(
                    id,
                    FlightSpawn {
                        position: p,
                        heading: 0.0,
                        airspeed: 160.0,
                        on_ground: false,
                    },
                );
            }
            for (id, p) in [
                (900, [-200.0, 0.0, 1000.0]),
                (901, [200.0, 0.0, 1000.0]),
                (902, [0.0, 0.0, 1100.0]),
            ] {
                ground.spawn_unit(id, "su_t72a", 1, p, 0.0).unwrap();
            }
            (world, ground)
        };
        let (mut new, mut ground) = make(false);
        let (mut old, mut old_ground) = make(true);
        let origin = new.units[&71].pos();
        let views = new.kinematics();
        let tanks = ground.kinematics();
        assert_eq!(
            distance(origin, views[1].pos),
            distance(origin, views[2].pos)
        );
        let (mut new_checks, mut old_checks) = (0, 0);
        let a = nearest_visible(
            &views,
            origin,
            12000.0,
            |v| v.team == Team::Red && v.alive,
            |v| v.pos,
            |v| {
                new_checks += 1;
                ground.line_of_sight(origin, v.pos)
            },
            false,
        );
        let b = nearest_visible(
            &views,
            origin,
            12000.0,
            |v| v.team == Team::Red && v.alive,
            |v| v.pos,
            |v| {
                old_checks += 1;
                ground.line_of_sight(origin, v.pos)
            },
            true,
        );
        assert_eq!(a.map(|v| v.pos), b.map(|v| v.pos), "{scene} air oracle");
        if scene == "clear" {
            assert_eq!(
                a.unwrap().pos[0],
                -200.0,
                "Rust min_by first-equal behavior must remain stable"
            );
        }
        if scene != "all_blocked" {
            assert!(new_checks < old_checks);
        } else {
            assert!(a.is_none());
        }
        let a = nearest_visible(
            &tanks,
            origin,
            7000.0,
            |v| v.team == 1 && v.alive,
            |v| v.pos,
            |v| ground.line_of_sight(origin, [v.pos[0], v.pos[1] + 1.0, v.pos[2]]),
            false,
        );
        let b = nearest_visible(
            &tanks,
            origin,
            7000.0,
            |v| v.team == 1 && v.alive,
            |v| v.pos,
            |v| ground.line_of_sight(origin, [v.pos[0], v.pos[1] + 1.0, v.pos[2]]),
            true,
        );
        assert_eq!(
            a.map(|v| v.id),
            b.map(|v| v.id),
            "{scene} actual native tank oracle"
        );
        for _ in 0..90 {
            let actual = new.step(DT, &mut ground);
            let expected = old.step(DT, &mut old_ground);
            assert_eq!(
                serde_json::to_string(&actual).unwrap(),
                serde_json::to_string(&expected).unwrap(),
                "{scene} physical shot events"
            );
            assert_eq!(
                serde_json::to_string(&new.views()).unwrap(),
                serde_json::to_string(&old.views()).unwrap(),
                "{scene} independent native stores, fuel/ammo/damage/accepted128floats"
            );
            for (id, u) in &new.units {
                let other = &old.units[id];
                assert_eq!(u.input.flight(), other.input.flight());
                assert_eq!(
                    (u.input.fire, u.input.release),
                    (other.input.fire, other.input.release)
                );
            }
        }
    }
}
fn fixture_for(aircraft: &str, spawn: &str, loadout: u32) -> (AirWorld, SimWorld) {
    let data = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let map: Value =
        serde_json::from_slice(&std::fs::read(data.join("frontline/korea.json")).unwrap()).unwrap();
    static TEMPLATE: OnceLock<Arc<AirTemplate>> = OnceLock::new();
    let template = TEMPLATE.get_or_init(|| AirTemplate::load(&data).unwrap());
    let ground = SimWorld::load(&data, &map).unwrap();
    let mut air = template.world(Arc::new(ground.ground.clone()), map);
    air.spawn(
        UnitRef {
            battle: 9,
            unit: ID,
            life: 1,
        },
        aircraft,
        Team::Blue,
        Some(PLAYER),
        spawn,
        loadout,
    )
    .unwrap();
    let u = air.units.get_mut(&ID).unwrap();
    u.controller = Some(PLAYER);
    u.input = service_hold_input(&u.state);
    (air, ground)
}

#[test]
fn catalog_rejects_stale_kernel_identity_and_invalid_source_mechanisms() {
    let data = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let source: Value =
        serde_json::from_slice(&std::fs::read(data.join("aircraft/frontline.json")).unwrap())
            .unwrap();
    let parsed: Catalog = serde_json::from_value(source.clone()).unwrap();
    crate::frontline_catalog_test_contract::assert_ids(parsed.aircraft.keys().map(String::as_str));
    validate_catalog_source(&parsed).unwrap();
    for (path, value) in [
        ("/source/flightCoreVersion", json!(212)),
        ("/source/flightWasmSha256", json!("0".repeat(64))),
        ("/aircraft/me262/physics/gearSequence/0", json!(0.5)),
        ("/aircraft/me262/physics/gearSequence/1", json!(0.01)),
        ("/aircraft/me262/physics/surfaces/16", json!(0.2)),
        ("/aircraft/me262/physics/gear/h", json!(1e30)),
    ] {
        let mut bad = source.clone();
        *bad.pointer_mut(path).unwrap() = value;
        let parsed: Catalog = serde_json::from_value(bad).unwrap();
        assert!(
            validate_catalog_source(&parsed).is_err(),
            "invalid source field {path} was admitted"
        );
    }
}

#[test]
fn me262_four_native_axes_survive_actual_rocket_mass_change_and_reverse() {
    let (mut air, mut ground) = fixture_for("me262", "air", 1);
    // Exercise the intact source mechanism below its real IAS gear limit. The
    // normal 210 m/s jet air start is unsuitable for deliberately extending it.
    air.test_spawn_at(ID, FlightSpawn {
        position: [0.0, 2000.0, 0.0],
        heading: 0.0,
        airspeed: 90.0,
        on_ground: false,
    });
    assert_eq!(&air.units[&ID].aero[36..40], &[0.0; 4]);
    let mut command = service_hold_input(&air.units[&ID].state);
    command.flags = 5;
    command.throttle = 0.65;
    for tick in 0..650 {
        if tick % 12 == 0 {
            air.accept_input(ID, command.clone(), air.time).unwrap();
        }
        ground.step_combined(DT, &mut air);
    }
    let u = &air.units[&ID];
    assert!(!u.airframe_limits.gear_failed, "Intact-axis fixture exceeded its gear limit");
    let before = u.runtime.telemetry().unwrap();
    assert_eq!(before.aero[36], 1.0);
    assert_eq!(before.aero[37], 1.0);
    assert_eq!(before.aero[39], 1.0);
    assert!(
        before.aero[38] > 0.1 && before.aero[38] < 0.5,
        "Actual nose phase after five seconds"
    );
    let reference = u.reference;
    let mass = loaded_airframe(&u.profile, u.fuel, &u.stores).unwrap()[0];
    let payload = u
        .stores
        .iter()
        .filter(|s| !s.gone)
        .map(|s| s.count)
        .sum::<u32>();
    assert_eq!(payload, 24);
    command.release = true;
    air.accept_input(ID, command.clone(), air.time).unwrap();
    let events = ground.step_combined(DT, &mut air);
    assert!(events
        .iter()
        .any(|e| e.kind == "shot" && e.detail["store"] == true));
    let u = &air.units[&ID];
    let after = u.runtime.telemetry().unwrap();
    assert_eq!(u.reference, reference);
    assert_eq!(u.loadout, 1);
    assert!(u.fault.is_none());
    assert_eq!(
        u.stores
            .iter()
            .filter(|s| !s.gone)
            .map(|s| s.count)
            .sum::<u32>(),
        23
    );
    assert!(loaded_airframe(&u.profile, u.fuel, &u.stores).unwrap()[0] < mass - 3.0);
    assert!(
        (after.state[23] - before.state[23] - DT as f32).abs() < 1e-5,
        "No hidden clock reset on actual store release"
    );
    assert!(
        (after.aero[38] - before.aero[38] - DT as f32 / 3.0).abs() < 1e-5,
        "Mass update must not rewind/complete nose phase"
    );
    assert_eq!(&after.aero[36..38], &[1.0, 1.0]);
    command.release = false;
    command.flags = 1;
    air.accept_input(ID, command, air.time).unwrap();
    ground.step_combined(DT, &mut air);
    let u = &air.units[&ID];
    assert!(u.aero[36] < after.aero[36]);
    assert_eq!(u.aero[38], after.aero[38]);
    assert!(u.alive() && u.fault.is_none());
}

#[test]
fn me262_native_runway_hop_accepts_locked_legs_and_rejects_unlocked_average_above_point_nine() {
    for locked in [true, false] {
        let (mut air, mut ground) = fixture_for("me262", "runway", 0);
        assert_eq!(&air.units[&ID].aero[36..40], &[1.0; 4]);
        let reference = air.units[&ID].reference;
        let mut command = service_hold_input(&air.units[&ID].state);
        if !locked {
            command.flags &= !4;
        }
        air.accept_input(ID, command.clone(), 0.0).unwrap();
        let u = air.units.get_mut(&ID).unwrap();
        u.runtime.impulse([0.0, 2.0, 0.0], [0.0; 3]).unwrap();
        let t = u.runtime.telemetry().unwrap();
        u.state = t.state;
        u.aero = t.aero;
        let mut airborne = false;
        let mut touchdown = false;
        let mut last_gear = 1.0;
        for tick in 0..100 {
            if tick % 12 == 0 {
                air.accept_input(ID, command.clone(), air.time).unwrap();
            }
            ground.step_combined(DT, &mut air);
            let u = &air.units[&ID];
            airborne |= u.state[35] > 2.05;
            if u.state[22] > 0.5 {
                assert!(!locked);
                assert!(
                    last_gear > 0.9,
                    "Failure must isolate actual leg locks, not old scalar threshold"
                );
                break;
            }
            if airborne && u.state[36] == 4.0 && (u.state[35] - 2.0).abs() < 0.01 {
                touchdown = true;
                break;
            }
            last_gear = u.state[33];
        }
        let u = &air.units[&ID];
        assert!(airborne, "Actual WASM velocity must leave source runway");
        assert_eq!(u.reference, reference);
        if locked {
            assert!(touchdown && u.alive());
            assert_eq!(&u.aero[36..40], &[1.0; 4]);
        } else {
            assert_eq!(u.state[22], 1.0);
            assert!(!u.alive());
        }
    }
}

#[test]
fn me262_service_rejects_native_unlocked_legs_and_real_ground_retraction_loss() {
    for hop in [false, true] {
        let (mut air, mut ground) = fixture_for("me262", "runway", 0);
        let before = inventory(&air);
        if hop {
            // A real native velocity impulse, with no accepted-state assignment.
            air.units
                .get_mut(&ID)
                .unwrap()
                .runtime
                .impulse([0.0, 2.0, 0.0], [0.0; 3])
                .unwrap();
        }
        let mut retract = service_hold_input(&air.units[&ID].state);
        retract.flags &= !4;
        air.accept_input(ID, retract, air.time).unwrap();
        ground.step_combined(DT, &mut air);
        let u = &air.units[&ID];
        assert!(u.state[33] > 0.9);
        assert!(u.aero[36] < 0.999 && u.aero[38] >= 0.999);
        assert_eq!(u.alive(),hop,"Ground retraction is a native loss; a real short hop isolates the per-leg service eligibility guard");
        if hop {
            // Returning the lever down cannot instantly relock the native main legs.
            let hold = service_hold_input(&u.state);
            air.accept_input(ID, hold, air.time).unwrap();
        }
        assert_eq!(
            air.request_service(ID, 0, air.time).unwrap_err(),
            if hop {
                "gear_not_down"
            } else {
                "aircraft_lost"
            }
        );
        assert_eq!(inventory(&air), before);
        assert_eq!(air.units[&ID].service.view.status, "idle");
    }
}

#[test]
fn me262_fifteen_second_service_keeps_native_locks_time_life_and_actual_variant_inventory() {
    let (mut air, mut ground) = fixture_for("me262", "runway", 0);
    let mut command = service_hold_input(&air.units[&ID].state);
    command.fire = true;
    air.accept_input(ID, command, 0.0).unwrap();
    ground.step_combined(DT, &mut air);
    assert!(air.units[&ID].guns.iter().map(|g| g.ammo).sum::<u32>() < 360);
    let hold = service_hold_input(&air.units[&ID].state);
    air.accept_input(ID, hold, air.time).unwrap();
    let reference = air.units[&ID].reference;
    let time = air.units[&ID].state[23];
    air.request_service(ID, 1, 1e9).unwrap();
    ticks(&mut air, &mut ground, 1799);
    assert_eq!(air.units[&ID].loadout, 0);
    assert!(air.units[&ID].stores.is_empty());
    let events = ticks(&mut air, &mut ground, 1);
    assert_eq!(
        events
            .iter()
            .filter(|e| e.kind == "air_service_complete")
            .count(),
        1
    );
    let u = &air.units[&ID];
    assert_eq!(u.reference, reference);
    assert_eq!(u.loadout, 1);
    assert!((u.state[23] - time - 15.0).abs() < 0.002);
    assert_eq!(&u.runtime.telemetry().unwrap().aero[36..40], &[1.0; 4]);
    assert_eq!(
        u.guns.iter().map(|g| g.ammo).collect::<Vec<_>>(),
        vec![100, 100, 80, 80]
    );
    assert_eq!(u.stores.len(), 24);
    assert!(u.stores.iter().all(|s| s.count == 1 && !s.gone));
    assert!(u.alive() && u.fault.is_none());
}
fn inventory(air: &AirWorld) -> Value {
    let u = air.units[&ID].view();
    json!({"loadout":u.loadout,"guns":u.guns,"stores":u.stores,"fuel":u.fuel["total_kg"],"resource_revision":u.resource_revision})
}
fn ticks(air: &mut AirWorld, ground: &mut SimWorld, count: usize) -> Vec<SimEvent> {
    let mut events = Vec::new();
    for _ in 0..count {
        events.extend(air.step(DT, ground));
    }
    events
}

#[test]
fn service_requires_full_native_fifteen_seconds_then_atomically_repairs_same_plant() {
    let (mut air, mut ground) = fixture();
    // Spend actual finite feeds through the accepted weapon path before service.
    let mut firing = service_hold_input(&air.units[&ID].state);
    firing.fire = true;
    air.accept_input(ID, firing, 0.0).unwrap();
    assert!(ticks(&mut air, &mut ground, 1)
        .iter()
        .any(|e| e.kind == "shot"));
    let hold = service_hold_input(&air.units[&ID].state);
    air.accept_input(ID, hold, DT).unwrap();
    {
        let u = air.units.get_mut(&ID).unwrap();
        // Test-only partial native damage/resources on the same existing unit.
        u.fuel = 0.0;
        for s in &mut u.stores {
            s.fuel = 0.0;
        }
        let engine = u
            .damage
            .parts
            .iter_mut()
            .find(|p| p.def.id == "engine")
            .unwrap();
        engine.hp = 0.0;
        let control = u
            .damage
            .parts
            .iter_mut()
            .find(|p| p.def.id == "aileron_l")
            .unwrap();
        control.hp = 0.0;
        u.damage.revision += 1;
        assert!(
            u.alive(),
            "A failed engine/control surface is repairable, not a new life"
        );
    }
    let before = inventory(&air);
    let identity = air.units[&ID].reference;
    let epoch = air.units[&ID].epoch;
    let position = air.units[&ID].pos();
    let native_time = air.units[&ID].state[23];
    let initial = air.request_service(ID, 4, 10_000_000.0).unwrap();
    assert_eq!(initial.status, "servicing");
    assert_eq!(initial.elapsed_s, 0.0, "Wall time cannot grant work");
    assert_eq!(inventory(&air), before);
    assert!(ticks(&mut air, &mut ground, 1799)
        .iter()
        .all(|e| e.kind != "air_service_complete"));
    assert_eq!(
        inventory(&air),
        before,
        "No partial refill/loadout grant before 15s"
    );
    let progress = air.service_view(ID).unwrap();
    assert!(progress.elapsed_s > 14.99 && progress.remaining_s > 0.0);
    assert_eq!(
        air.request_service(ID, 4, 99_000_000.0).unwrap(),
        progress,
        "Duplicate request does not rewind/skip service"
    );
    let events = ticks(&mut air, &mut ground, 1);
    assert_eq!(
        events
            .iter()
            .filter(|e| e.kind == "air_service_complete")
            .count(),
        1
    );
    let u = &air.units[&ID];
    assert_eq!(u.reference, identity);
    assert_eq!(u.epoch, epoch);
    assert_eq!(u.loadout(), 4);
    assert!(
        distance(u.pos(), position) < 0.5,
        "Native braking may settle the plant; service must not teleport it"
    );
    assert!(
        (u.state[23] - native_time - 15.0).abs() < 0.002,
        "Existing hidden core clock must not reset"
    );
    assert!(u
        .damage
        .parts
        .iter()
        .all(|p| p.hp == p.def.hp && !p.detached));
    assert_eq!(u.fuel, u.profile.fuel.capacity);
    assert!(u
        .stores
        .iter()
        .any(|s| s.def["kind"] == "tank" && s.fuel > 0.0));
    assert!(u.stores.iter().any(|s| s.def["kind"] == "bomb"));
    let full = allocate_feeds(&u.profile.guns);
    assert_eq!(
        u.guns.iter().map(|g| g.ammo).collect::<Vec<_>>(),
        full.iter().map(|g| g.ammo).collect::<Vec<_>>()
    );
    assert_eq!(
        u.resource_revision,
        before["resource_revision"].as_u64().unwrap() + 1
    );
    assert_eq!(u.service.view.revision, initial.revision + 1);
    assert_eq!(u.service.view.status, "complete");
    let accepted_revision = u.resource_revision;
    assert!(ticks(&mut air, &mut ground, 3)
        .iter()
        .all(|e| e.kind != "air_service_complete"));
    assert_eq!(
        air.units[&ID].resource_revision, accepted_revision,
        "Completed service cannot repeat grants"
    );
    let mut takeoff = service_hold_input(&air.units[&ID].state);
    takeoff.throttle = 0.8;
    air.accept_input(ID, takeoff, air.time).unwrap();
    ticks(&mut air, &mut ground, 30);
    assert!(air.units[&ID].state[37] > 1000.0,
        "After actual empty tanks and a dead engine, repaired/refuelled native plant must make thrust without reset");
    assert!(air.units[&ID].flow > 0.0);
}

#[test]
fn service_cancel_return_and_repeated_requests_preserve_inventory_and_cooldowns() {
    let (mut air, mut ground) = fixture();
    {
        let u = air.units.get_mut(&ID).unwrap();
        u.guns[0].ammo -= 20;
        u.guns[0].cool = 0.4;
        u.release_cooldown = 0.15;
    }
    let before = inventory(&air);
    let started = air.request_service(ID, 4, 0.0).unwrap();
    assert_eq!(air.units[&ID].guns[0].cool, 0.4);
    assert_eq!(air.units[&ID].release_cooldown, 0.15);
    assert_eq!(
        air.request_service(ID, 3, 0.0).unwrap_err(),
        "service_already_active"
    );
    ticks(&mut air, &mut ground, 2);
    let cooldown = air.units[&ID].guns[0].cool;
    let release_cooldown = air.units[&ID].release_cooldown;
    let cancelled = air.cancel_service(ID).unwrap();
    assert_eq!(cancelled.status, "cancelled");
    assert_eq!(cancelled.elapsed_s, 0.0);
    assert_eq!(cancelled.revision, started.revision + 1);
    assert_eq!(air.cancel_service(ID).unwrap(), cancelled);
    assert_eq!(inventory(&air), before);
    assert_eq!(air.units[&ID].guns[0].cool, cooldown);
    assert_eq!(air.units[&ID].release_cooldown, release_cooldown);
    assert_eq!(air.request_service(ID, 4, 10_000.0).unwrap().elapsed_s, 0.0);
    air.release(PLAYER, 10_000.0);
    let released = air.service_view(ID).unwrap();
    assert_eq!(released.status, "cancelled");
    assert_eq!(released.reason.as_deref(), Some("control_released"));
    assert_eq!(
        air.request_service(ID, 4, 10_001.0).unwrap_err(),
        "not_controlled"
    );
    assert_eq!(inventory(&air), before);
}

#[test]
fn service_new_native_damage_and_actual_motion_abort_without_partial_grant() {
    let (mut air, mut ground) = fixture();
    air.units.get_mut(&ID).unwrap().fuel *= 0.5;
    let before = inventory(&air);
    air.request_service(ID, 4, 0.0).unwrap();
    ticks(&mut air, &mut ground, 2);
    let at = air.units[&ID].pos();
    let revision = air.units[&ID].damage.revision;
    air.blast(at, 0.00001, 1, 33, false, None);
    assert!(
        air.units[&ID].damage.revision > revision,
        "Use the accepted native part damage path"
    );
    assert_eq!(
        air.service_view(ID).unwrap().reason.as_deref(),
        Some("new_damage")
    );
    assert_eq!(inventory(&air), before);
    // A fresh attempt starts at zero, then actual WASM velocity interrupts it.
    air.request_service(ID, 4, 0.1).unwrap();
    let u = air.units.get_mut(&ID).unwrap();
    u.runtime.impulse([2.0, 0.0, 0.0], [0.0; 3]).unwrap();
    u.state = u.runtime.telemetry().unwrap().state;
    ticks(&mut air, &mut ground, 1);
    assert_eq!(
        air.service_view(ID).unwrap().reason.as_deref(),
        Some("not_stopped")
    );
    assert_eq!(inventory(&air), before);
}

#[test]
fn service_requires_friendly_available_ground_plant_and_cannot_revive_lost_units() {
    let (mut air, mut ground) = fixture();
    let before = inventory(&air);
    let field = air.map["airfields"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["enabled"] == true && f["team"] == 0)
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    air.set_service_availability(
        &field,
        ServiceAvailability {
            fuel: false,
            ..Default::default()
        },
    )
    .unwrap();
    assert_eq!(
        air.request_service(ID, 4, 0.0).unwrap_err(),
        "availability_unavailable"
    );
    air.set_service_availability(&field, ServiceAvailability::default())
        .unwrap();
    air.request_service(ID, 4, 0.0).unwrap();
    let mut takeoff = service_hold_input(&air.units[&ID].state);
    takeoff.throttle = 0.6;
    air.accept_input(ID, takeoff, 0.0).unwrap();
    assert_eq!(
        air.service_view(ID).unwrap().reason.as_deref(),
        Some("unsafe_controls")
    );
    assert_eq!(inventory(&air), before);
    let hold = service_hold_input(&air.units[&ID].state);
    air.accept_input(ID, hold, 0.0).unwrap();
    air.units.get_mut(&ID).unwrap().damage.fire = 0.01;
    assert_eq!(
        air.request_service(ID, 4, 0.0).unwrap_err(),
        "aircraft_fire"
    );
    air.units.get_mut(&ID).unwrap().damage.fire = 0.0;
    air.units.get_mut(&ID).unwrap().team = Team::Red;
    assert_eq!(
        air.request_service(ID, 4, 0.0).unwrap_err(),
        "not_friendly_runway"
    );
    air.units.get_mut(&ID).unwrap().team = Team::Blue;
    let pilot = air
        .units
        .get_mut(&ID)
        .unwrap()
        .damage
        .parts
        .iter_mut()
        .find(|p| p.def.id == "pilot")
        .unwrap();
    pilot.hp = 0.0;
    assert_eq!(
        air.request_service(ID, 4, 0.0).unwrap_err(),
        "aircraft_lost"
    );
    assert!(!air.units[&ID].alive());
    assert_eq!(inventory(&air), before);
    assert!(
        air.step(15.0, &mut ground).is_empty(),
        "A caller cannot skip fixed native work with a large dt"
    );
    assert_eq!(inventory(&air), before);
}
