use super::*;
use serde_json::{json, Value};
use std::{
    io::Write,
    process::{Command, Stdio},
    sync::OnceLock,
    time::Instant,
};

const DT: f32 = 1.0 / 120.0;
const NF01: [f32; 14] = [
    3200.0, 22.0, 2.1, 11.0, 14000.0, 21000.0, 6500.0, 0.026, 0.065, 4.5, 0.28, 0.0, 15500.0, 0.0,
];
const NF02: [f32; 14] = [
    9000.0, 30.0, 3.4, 9.9, 120000.0, 150000.0, 10000.0, 0.021, 0.12, 3.6, 0.33, 1.0, 48000.0, 0.5,
];

fn root() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap()
}
fn ground() -> Arc<MapGround> {
    static GROUND: OnceLock<Arc<MapGround>> = OnceLock::new();
    GROUND
        .get_or_init(|| {
            let data = root().join("data");
            let map: Value =
                serde_json::from_slice(&std::fs::read(data.join("frontline/korea.json")).unwrap())
                    .unwrap();
            Arc::new(MapGround::load(&data, &map).unwrap())
        })
        .clone()
}
fn module() -> Arc<FlightModule> {
    static MODULE: OnceLock<Arc<FlightModule>> = OnceLock::new();
    MODULE
        .get_or_init(|| FlightModule::bundled().unwrap())
        .clone()
}
fn surfaces(frame: &[f32; 14]) -> [f32; 15] {
    [
        frame[3] * 0.05,
        frame[3] * 0.5,
        0.0,
        0.0,
        -frame[3] * 0.4,
        frame[1] * 0.16,
        -frame[3] * 0.38,
        frame[1] * 0.1,
        0.38,
        0.42,
        0.42,
        0.4,
        0.7,
        0.0,
        0.6,
    ]
}
fn configure(runtime: &mut FlightRuntime, frame: &[f32; 14]) {
    runtime.configure_airframe(frame).unwrap();
    runtime
        .configure_surfaces(&surfaces(frame), frame[11] > 0.0, false)
        .unwrap();
    runtime.configure(7.0, 45.0, 1.0, 7.5, true).unwrap();
    runtime.configure_control(1, false, 0.22, 1.0).unwrap();
    runtime.configure_envelope(7.5, -3.0, 0.0, 0.0).unwrap();
}
fn airborne(frame: &[f32; 14]) -> FlightRuntime {
    let mut runtime = module().instantiate(ground(), vec![]).unwrap();
    configure(&mut runtime, frame);
    runtime
        .spawn(FlightSpawn {
            position: [100.0, 3500.0, -1000.0],
            heading: 0.0,
            airspeed: 180.0,
            on_ground: false,
        })
        .unwrap();
    runtime
}

#[test]
fn pinned_module_checks_identity_abi_memory_and_rejects_invalid_admission() {
    assert!(FlightModule::load(&root().join("handoff/flight/flight_core.wasm")).is_ok());
    let mut bad = BUNDLED_WASM.to_vec();
    bad[12] ^= 1;
    assert!(FlightModule::from_bytes(&bad).is_err());
    assert!(checked_region(-4, 80).is_err());
    assert!(checked_region((MEMORY_BYTES - 4) as i32, 80).is_err());
    let invalid = LandingArea {
        center: [0.0, 0.0],
        forward: [0.0, 0.0],
        half_width: 20.0,
        half_length: 100.0,
    };
    assert!(module().instantiate(ground(), vec![invalid]).is_err());
    let mut runtime = airborne(&NF01);
    assert_eq!(runtime.memory_bytes(), MEMORY_BYTES);
    let before = runtime.telemetry().unwrap();
    assert_eq!(before.state.len(), 80);
    assert_eq!(before.aero.len(), 48);
    assert!(runtime.step(0.05, &FlightInput::default()).is_err());
    assert!(runtime
        .step(
            DT,
            &FlightInput {
                roll: f32::NAN,
                ..Default::default()
            }
        )
        .is_err());
    assert!(runtime
        .step(
            DT,
            &FlightInput {
                flags: 256,
                ..Default::default()
            }
        )
        .is_err());
    assert!(runtime.set_damage([1.1; 6]).is_err());
    assert!(!runtime.is_faulted());
    assert_eq!(before, runtime.telemetry().unwrap());
    assert_eq!(
        before,
        serde_json::from_str::<FlightTelemetry>(&serde_json::to_string(&before).unwrap()).unwrap()
    );
}

#[test]
fn global_water_callbacks_reject_sea_but_allow_dry_airports_outside_ground_routes() {
    let map = json!({
        "terrain":{
            "width":5,"height":5,"cellX":20000.0,"cellZ":20000.0,
            "x0":-40000.0,"z0":-40000.0,"heights":vec![-8.0;25],
            "pads":[{"id":"dry-airfield","center":[2000.0,0.0],"halfSize":[100.0,100.0],"height":4.0,"blendMeters":10.0}],
            "roadbeds":{"cellSize":256,"segments":[[0,-100,3,0,100,3,8,8]],"cells":{"-1,-1":[0],"-1,0":[0],"0,-1":[0],"0,0":[0]}},
            "waterAreas":[{"id":"ocean","ring":[[-50000,-50000],[50000,-50000],[50000,50000],[-50000,50000],[-50000,-50000]],"holes":[[[900,-100],[1100,-100],[1100,100],[900,100],[900,-100]]],"level":0}]
        },
        "roads":[{"id":"ground-only-route","from":"A","to":"B","connected":true,"navEnabled":true,"halfWidth":8,"roadbedSegments":[0],"points":[[0,3,-100],[0,3,100]]}],
        "navigation":{"hydroCoverage":[{"bounds":{"minX":-500,"maxX":500,"minZ":-500,"maxZ":500}}]}
    });
    let ground = Arc::new(MapGround::load(&root().join("data"), &map).unwrap());
    assert!(!ground.ground_navigation_allowed(2000.0, 0.0));
    assert_eq!(ground.water_level(20000.0, 0.0), Some(0.0));
    assert_eq!(
        ground.water_level(1000.0, 0.0),
        None,
        "Retain source polygon holes"
    );
    // Explicit test-authorized runway rectangles at all probes demonstrate
    // that a rectangle alone cannot authorize a submerged ocean landing.
    let landing = [2000.0, 20000.0, 45000.0].map(|x| LandingArea {
        center: [x, 0.0],
        forward: [0.0, 1.0],
        half_width: 80.0,
        half_length: 120.0,
    });
    let mut runtime = module()
        .instantiate(ground.clone(), landing.into())
        .unwrap();
    configure(&mut runtime, &NF01);
    for (x, height, dry) in [
        (2000.0, 4.0, true),
        (20000.0, 0.0, false),
        (45000.0, 0.0, false),
    ] {
        runtime
            .spawn(FlightSpawn {
                position: [x, 100.0, 0.0],
                heading: 0.0,
                airspeed: 0.0,
                on_ground: true,
            })
            .unwrap();
        let spawned = runtime.telemetry().unwrap();
        assert_eq!(
            spawned.state[1],
            height + 2.0,
            "Actual WASM ground import at x={x}"
        );
        runtime
            .step(
                DT,
                &FlightInput {
                    throttle: 0.0,
                    flags: 1 | 4 | 16,
                    ..Default::default()
                },
            )
            .unwrap();
        let stepped = runtime.telemetry().unwrap();
        assert_eq!(
            stepped.state[22] > 0.5,
            !dry,
            "Actual WASM landable import at x={x}"
        );
        if dry {
            assert_eq!(stepped.state[36], 4.0);
        }
    }
}

#[test]
fn two_different_airframes_interleaved_match_their_independent_execution() {
    let input_a = FlightInput {
        aim: [0.2, 0.02, 0.98],
        roll: 0.6,
        ..Default::default()
    };
    let input_b = FlightInput {
        aim: [-0.2, 0.04, 0.97],
        roll: -0.4,
        ..Default::default()
    };
    let mut a = airborne(&NF01);
    let mut b = airborne(&NF02);
    let mut isolated_a = airborne(&NF01);
    let mut isolated_b = airborne(&NF02);
    for _ in 0..80 {
        isolated_a.step(DT, &input_a).unwrap();
    }
    for _ in 0..80 {
        isolated_b.step(DT, &input_b).unwrap();
    }
    for i in 0..80 {
        if i % 2 == 0 {
            a.step(DT, &input_a).unwrap();
            b.step(DT, &input_b).unwrap();
        } else {
            b.step(DT, &input_b).unwrap();
            a.step(DT, &input_a).unwrap();
        }
    }
    assert_eq!(a.telemetry().unwrap(), isolated_a.telemetry().unwrap());
    assert_eq!(b.telemetry().unwrap(), isolated_b.telemetry().unwrap());
    assert_ne!(a.telemetry().unwrap().state, b.telemetry().unwrap().state);
}

#[test]
fn actual_world_sampling_parked_controls_and_airborne_roll_are_connected() {
    let map: Value =
        serde_json::from_slice(&std::fs::read(root().join("data/frontline/korea.json")).unwrap())
            .unwrap();
    let p = &map["staging"]
        .as_array()
        .unwrap()
        .iter()
        .find(|p| p["enabled"] == true)
        .unwrap()["pos"];
    let x = p[0].as_f64().unwrap() as f32;
    let z = p[2].as_f64().unwrap() as f32;
    // An explicit test-only landing policy on an authored pad, not airport certification.
    let area = LandingArea {
        center: [x as f64, z as f64],
        forward: [1.0, 1.0],
        half_width: 80.0,
        half_length: 120.0,
    };
    assert!(area.contains(x as f64 + 5.0, z as f64));
    assert!(!area.contains(x as f64 + 500.0, z as f64));
    let mut parked = module().instantiate(ground(), vec![area]).unwrap();
    configure(&mut parked, &NF02);
    for roll in [-1.0, 1.0] {
        parked
            .spawn(FlightSpawn {
                position: [x, 0.0, z],
                heading: 0.0,
                airspeed: 0.0,
                on_ground: true,
            })
            .unwrap();
        let sample = parked.telemetry().unwrap();
        assert!(
            (sample.state[1] - (ground().height(x as f64, z as f64) as f32 + 2.0)).abs() < 0.00001
        );
        assert!((sample.state[35] - 2.0).abs() < 0.00001);
        for _ in 0..60 {
            parked
                .step(
                    DT,
                    &FlightInput {
                        throttle: 0.0,
                        roll,
                        flags: 1 | 4 | 16,
                        ..Default::default()
                    },
                )
                .unwrap();
        }
        let state = parked.telemetry().unwrap().state;
        assert_eq!(state[22], 0.0);
        assert_eq!(state[36], 4.0);
        assert!(state[25] * roll > 0.9);
    }
    let mut a = airborne(&NF02);
    let mut d = airborne(&NF02);
    for _ in 0..100 {
        a.step(
            DT,
            &FlightInput {
                roll: -1.0,
                flags: 0,
                ..Default::default()
            },
        )
        .unwrap();
        d.step(
            DT,
            &FlightInput {
                roll: 1.0,
                flags: 0,
                ..Default::default()
            },
        )
        .unwrap();
    }
    let sa = a.telemetry().unwrap();
    let sd = d.telemetry().unwrap();
    assert!(sa.state[25] < -0.9 && sd.state[25] > 0.9);
    assert!(
        sa.state[20] * sd.state[20] < 0.0 && sa.state[20].abs() > 0.01 && sd.state[20].abs() > 0.01,
        "actual bank: A={} D={}",
        sa.state[20],
        sd.state[20]
    );
}

#[test]
fn accepted_damage_reduces_real_kernel_thrust_and_impulse_changes_plant() {
    let mut intact = airborne(&NF02);
    let mut damaged = airborne(&NF02);
    damaged.set_damage([0.2, 1.0, 1.0, 1.0, 1.0, 1.0]).unwrap();
    let input = FlightInput {
        throttle: 0.9,
        flags: 0,
        ..Default::default()
    };
    for _ in 0..30 {
        intact.step(DT, &input).unwrap();
        damaged.step(DT, &input).unwrap();
    }
    let a = intact.telemetry().unwrap();
    let b = damaged.telemetry().unwrap();
    assert!(a.state[37] > 1000.0 && b.state[37] < a.state[37] * 0.25);
    assert!(b.state[13] < a.state[13]);
    intact.impulse([1.0, 0.0, 0.0], [0.02, 0.0, 0.0]).unwrap();
    let c = intact.telemetry().unwrap();
    assert!((c.state[7] - a.state[7] - 1.0).abs() < 1e-5);
    assert!((c.state[10] - a.state[10] - 0.02).abs() < 1e-5);
}

#[test]
fn host_trap_returns_result_and_prevents_continuation_of_partial_state() {
    let mut runtime = airborne(&NF01);
    runtime.store.data_mut().trap_ground = true;
    assert!(matches!(
        runtime.step(DT, &FlightInput::default()),
        Err(FlightError::Runtime(_))
    ));
    assert!(runtime.is_faulted());
    assert!(matches!(runtime.telemetry(), Err(FlightError::Faulted(_))));
    assert!(matches!(
        runtime.step(DT, &FlightInput::default()),
        Err(FlightError::Faulted(_))
    ));
}

#[test]
fn same_wasm_parameters_and_command_sequence_match_node_browser_math() {
    let mut cases = Vec::new();
    let mut rust_samples = Vec::new();
    let started = Instant::now();
    for (id, frame) in [("nf01", NF01), ("nf02", NF02)] {
        let mut runtime = airborne(&frame);
        let mut steps = Vec::new();
        let mut samples = Vec::new();
        for n in 0..40 {
            let input = FlightInput {
                aim: [0.15, 0.02, 0.988],
                throttle: 0.82,
                pitch: if n < 20 { 0.25 } else { -0.15 },
                roll: if n < 15 { 0.4 } else { -0.3 },
                yaw: 0.1,
                flags: 1,
            };
            let damage = (n == 20).then_some([0.7, 0.9, 1.0, 1.0, 1.0, 1.0]);
            let impulse = (n == 10).then_some([0.2, 0.0, -0.1, 0.01, 0.0, 0.02]);
            if let Some(d) = damage {
                runtime.set_damage(d).unwrap();
            }
            if let Some(i) = impulse {
                runtime
                    .impulse([i[0], i[1], i[2]], [i[3], i[4], i[5]])
                    .unwrap();
            }
            runtime.step(DT, &input).unwrap();
            samples.push(runtime.telemetry().unwrap());
            steps.push(json!({"dt":DT,"input":input,"damage":damage,"impulse":impulse}));
        }
        cases.push(json!({"id":id,"airframe":frame,"surfaces":surfaces(&frame),"surfaceFlags":[i32::from(frame[11]>0.0),0],"configure":[7.0,45.0,1.0,7.5,1],"control":[1,0,0.22f32,1.0],"envelope":[7.5,-3.0,0.0,0.0],"spawn":{"position":[100.0,3500.0,-1000.0],"heading":0.0,"airspeed":180.0,"on_ground":false},"steps":steps}));
        rust_samples.push(samples);
    }
    // Actual source-matched Me262 mode1, with enough native time to exercise
    // every independent gear/door phase, reverse, and reconfigure loaded mass.
    let profile: Value = serde_json::from_slice(
        &std::fs::read(root().join("data/aircraft/frontline.json")).unwrap(),
    )
    .unwrap();
    let p: crate::frontline_air::AirProfile =
        serde_json::from_value(profile["aircraft"]["me262"].clone()).unwrap();
    let frame = p.physics.airframe;
    let geometry = p.physics.surfaces.unwrap();
    let gear = p.physics.gear_sequence.unwrap();
    let mut runtime = module().instantiate(ground(), vec![]).unwrap();
    runtime.configure_airframe(&frame).unwrap();
    runtime
        .configure_surfaces(
            &geometry[..15].try_into().unwrap(),
            geometry[15] != 0.0,
            geometry[16] != 0.0,
        )
        .unwrap();
    runtime
        .configure_gear_sequence(true, &gear[1..].try_into().unwrap())
        .unwrap();
    let config = p.physics.configure;
    runtime
        .configure(config[0], config[1], config[2], config[3], config[4] != 0.0)
        .unwrap();
    let control = p.physics.control;
    runtime
        .configure_control(control[0] as u8, control[1] != 0.0, control[2], control[3])
        .unwrap();
    let envelope = p.physics.envelope;
    runtime
        .configure_envelope(envelope[0], envelope[1], envelope[2], envelope[3])
        .unwrap();
    let spawn = FlightSpawn {
        position: [100.0, 20000.0, -1000.0],
        heading: 0.0,
        airspeed: 160.0,
        on_ground: false,
    };
    runtime.spawn(spawn.clone()).unwrap();
    let mut steps = Vec::new();
    let mut samples = Vec::new();
    let mut loaded = frame;
    for n in 0..2000 {
        let input = FlightInput {
            throttle: 0.65,
            flags: if n < 940 { 5 } else { 1 },
            ..Default::default()
        };
        let mass = (n == 650).then(|| {
            loaded[0] += 35.0;
            loaded[4] += 50.0;
            loaded
        });
        if let Some(frame) = mass {
            let before = runtime.telemetry().unwrap();
            runtime.configure_airframe(&frame).unwrap();
            runtime
                .configure_surfaces(
                    &geometry[..15].try_into().unwrap(),
                    geometry[15] != 0.0,
                    geometry[16] != 0.0,
                )
                .unwrap();
            runtime
                .configure_gear_sequence(true, &gear[1..].try_into().unwrap())
                .unwrap();
            let after = runtime.telemetry().unwrap();
            assert_eq!(
                before.state, after.state,
                "Mass reconfigure must preserve the accepted plant/time"
            );
            assert_eq!(
                before.aero[36..40],
                after.aero[36..40],
                "Mass reconfigure must preserve all four in-progress mechanism axes"
            );
        }
        runtime.step(DT, &input).unwrap();
        samples.push(runtime.telemetry().unwrap());
        steps.push(json!({"dt":DT,"input":input,"airframe":mass}));
    }
    assert!(samples[650].aero[38] > 0.0 && samples[650].aero[38] < 1.0);
    assert_eq!(&samples[939].aero[36..40], &[1.0, 1.0, 1.0, 1.0]);
    assert_eq!(&samples[1999].aero[36..40], &[0.0, 0.0, 0.0, 0.0]);
    cases.push(json!({"id":"me262","airframe":frame,"surfaces":geometry[..15],"surfaceFlags":[geometry[15] as i32,geometry[16] as i32],"gearSequence":gear,"configure":config,"control":control,"envelope":envelope,"spawn":spawn,"steps":steps}));
    rust_samples.push(samples);
    let wasm_millis = started.elapsed().as_secs_f64() * 1000.0;
    let input = json!({"wasm":root().join("handoff/flight/flight_core.wasm"),"app":root().join("handoff/bundle/app.js.html"),"map":root().join("data/frontline/korea.json"),"client":root().join("handoff/tools/frontline_client.js"),"landing":[],"cases":cases});
    let mut child = Command::new("node")
        // Node's main-module resolver rejects Windows canonical \\?\ paths.
        // Keep the working directory canonical and pass a portable relative entry.
        .current_dir(root())
        .arg("handoff/tests/flight_runtime_parity.mjs")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Node is required for actual WASM parity");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(serde_json::to_string(&input).unwrap().as_bytes())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let node: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(node["embeddedMatches"], true);
    let mut max_abs = 0.0f64;
    let mut compared = 0;
    for (i, samples) in rust_samples.iter().enumerate() {
        for (j, rust) in samples.iter().enumerate() {
            let other: FlightTelemetry =
                serde_json::from_value(node["cases"][i]["snapshots"][j].clone()).unwrap();
            for (a, b) in rust
                .state
                .iter()
                .chain(&rust.aero)
                .zip(other.state.iter().chain(&other.aero))
            {
                let delta = (*a as f64 - *b as f64).abs();
                max_abs = max_abs.max(delta);
                compared += 1;
                assert!(
                    delta <= 1e-5 + 2e-6 * (*b as f64).abs(),
                    "case{i} step{j}: wasmi={a} node={b} delta={delta}"
                );
            }
        }
    }
    eprintln!("flight{} parity floats={compared} max_abs={max_abs} wasm_sha256={} wasmi_2080_steps_and_instance_setup_ms={wasm_millis:.3}; interpreter micro-probe, not a population/realtime certification",CORE_VERSION,node["wasmSha256"]);
}
