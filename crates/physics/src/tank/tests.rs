//! The acceptance list for the running gear, on real vehicle data and analytic ground:
//! independent wheels, emergent pitch and roll, weight transfer, rebound that dies out, slip,
//! no penetration, slopes, differential drive and the multiplayer rebuild.
//! (client/web/test/tank.test.mjs runs the same scenarios against the JS mirror.)
use super::terrain::FnGround;
use super::*;
use crate::{load_terrains, TerrainDb, TerrainDef};
use std::path::{Path, PathBuf};

const DT: f64 = 1.0 / 120.0;
const IDLE: Input = Input { throttle: 0.0, steer: 0.0, brake: 0.0, drive_power: None };

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")
}
fn terrain(id: &str) -> TerrainDef {
    TerrainDb::from_vec(load_terrains(&root().join("terrains.json")).unwrap()).get(id).unwrap().clone()
}
fn model(id: &str) -> TankModel {
    let v = tg_vehicle::load_vehicle(&root().join("vehicles").join(id)).unwrap();
    TankModel::from_vehicle(&v, TankOpts::default()).expect("running gear")
}
fn rig(id: &str) -> (TankModel, Tank) {
    let tm = model(id);
    let t = Tank::new(&tm);
    (tm, t)
}
fn run(tm: &TankModel, t: &mut Tank, g: &dyn Ground, input: impl Fn(&Tank) -> Input, secs: f64, mut each: impl FnMut(&TankModel, &Tank)) -> TankInfo {
    let mut info = TankInfo::default();
    for _ in 0..(secs / DT).round() as usize {
        let i = input(t);
        info = step(tm, t, i, g, DT);
        each(tm, t);
    }
    info
}
fn hold(tm: &TankModel, t: &mut Tank, g: &dyn Ground, input: Input, secs: f64) -> TankInfo {
    run(tm, t, g, |_| input, secs, |_, _| {})
}
fn input(throttle: f64, steer: f64, brake: f64) -> Input {
    Input { throttle: throttle as f32, steer: steer as f32, brake: brake as f32, drive_power: None }
}

#[test]
fn damage_power_reduces_real_launch_and_disables_pivot_without_changing_healthy_drive() {
    let road = terrain("road");
    let flat = FnGround { height: |_x: f64, _z: f64| 0.0, surface: &road };
    for id in ["de_hetzer", "us_m4a3_75w"] {
        let accelerate = |power: Option<f32>, steer: f64| {
            let (tm, mut t) = rig(id);
            place(&tm, &mut t, &flat, 0.0, 0.0, 0.0);
            hold(&tm, &mut t, &flat, IDLE, 2.0);
            let mut i = input(if steer == 0.0 { 1.0 } else { 0.0 }, steer, 0.0);
            i.drive_power = power;
            let info = hold(&tm, &mut t, &flat, i, 1.0);
            (info, t.ds)
        };
        let (healthy, _) = accelerate(None, 0.0);
        let (explicit, _) = accelerate(Some(1.0), 0.0);
        assert_eq!(healthy.u, explicit.u);
        let (damaged, _) = accelerate(Some(0.1), 0.0);
        assert!(damaged.u < healthy.u * 0.6, "{id}: low power must reduce first-gear thrust");
        let (stopped, ds) = accelerate(Some(0.0), 1.0);
        assert!(stopped.r.abs() < 0.01 && stopped.u.abs() < 0.05, "{id}: no powered pivot or creep");
        assert_eq!(ds.motor.mean_cap, 0.0); assert_eq!(ds.motor.diff_cap, 0.0);
    }
}
/// A simple driver holding `kmh` (99 = flat out).
fn cruise(tm: &TankModel, kmh: f64) -> impl Fn(&Tank) -> Input + '_ {
    move |t: &Tank| {
        let v = kmh / 3.6;
        let th = if kmh > 90.0 { 1.0 } else { (v / tm.pt.v_top + (v - t.info.u) * 1.5).clamp(-0.2, 1.0) };
        input(th, 0.0, 0.0)
    }
}
fn wave(z: f64) -> f64 {
    if z > 10.0 && z < 70.0 {
        0.12 * (1.0 - ((z - 10.0) / 6.0 * std::f64::consts::TAU).cos())
    } else {
        0.0
    }
}

#[test]
fn stands_level_on_its_springs_every_wheel_loaded_nothing_in_the_ground() {
    let road = terrain("road");
    let flat = FnGround { height: |_x: f64, _z: f64| 0.0, surface: &road };
    for id in ["de_tiger_e", "su_t34_85", "us_m4a3_75w", "us_m4a3_76w_hvss"] {
        let (tm, mut t) = rig(id);
        place(&tm, &mut t, &flat, 0.0, 0.0, 0.0);
        let info = hold(&tm, &mut t, &flat, IDLE, 3.0);
        assert!(info.pitch.abs() < 0.002 && info.roll.abs() < 0.002, "{id} level {} {}", info.pitch, info.roll);
        let total: f64 = t.ss.load.iter().sum();
        assert!((total / (tm.mass * GRAVITY) - 1.0).abs() < 0.02, "{id} carries its weight {total}");
        let n = t.ss.load.len() as f64;
        assert!(t.ss.load.iter().all(|l| *l > 0.3 * tm.mass * GRAVITY / n), "{id} every wheel loaded {:?}", t.ss.load);
        assert!(t.contacts.iter().all(|c| c.p[1] > -0.01), "{id} contacts above ground");
        assert!(t.body.origin()[1].abs() < 0.01, "{id} rides at its static height {}", t.body.origin()[1]);
    }
}

#[test]
fn over_sine_waves_the_wheels_rise_in_turn_the_hull_follows_slower_and_settles() {
    let dirt = terrain("dirt");
    let waves = FnGround { height: |_x: f64, z: f64| wave(z), surface: &dirt };
    for kmh in [5.0f64, 15.0, 30.0, 99.0] {
        let (tm, mut t) = rig("de_tiger_e");
        place(&tm, &mut t, &waves, 0.0, 0.0, 0.0);
        hold(&tm, &mut t, &waves, IDLE, 1.0);
        let n = tm.sp.per_side();
        let mut rise: [Option<f64>; 3] = [None; 3];
        let (mut hi, mut lo, mut wheel_rate, mut hull_rate, mut pen) = (0.0f64, 0.0f64, 0.0f64, 0.0f64, 0.0f64);
        let mut prev: Option<Vec<f64>> = None;
        let mut after = Vec::new();
        let secs = 75.0 / (kmh / 3.6).max(2.5) + 5.0;
        run(&tm, &mut t, &waves, cruise(&tm, kmh), secs, |tm, t| {
            let o = t.body.origin();
            for (slot, k) in [0, n / 2, n - 1].into_iter().enumerate() {
                if rise[slot].is_none() && t.ss.support[k] > 0.05 {
                    rise[slot] = Some(o[2]);
                }
            }
            hi = hi.max(t.info.pitch);
            lo = lo.min(t.info.pitch);
            let comp = t.ss.comp[..n].to_vec();
            if let Some(p) = &prev {
                for (c, q) in comp.iter().zip(p) {
                    wheel_rate = wheel_rate.max((c - q).abs() / DT);
                }
            }
            prev = Some(comp);
            hull_rate = hull_rate.max(t.body.v[1].abs());
            if o[2] > 72.0 && o[2] < 95.0 {
                after.push(t.info.pitch.abs());
            }
            for (i, _) in tm.sp.stations.iter().enumerate() {
                let p = t.ss.contact[i];
                pen = pen.max(wave(p[2]) - p[1]);
            }
        });
        let [f, m, r] = rise.map(|x| x.unwrap_or(f64::NAN));
        assert!(f < m && m < r, "{kmh} km/h: wheels rise front {f} mid {m} rear {r}");
        assert!(hi > 0.01 && lo < -0.01, "{kmh} km/h: pitch both ways {hi} {lo}");
        assert!(wheel_rate > 1.5 * hull_rate, "{kmh} km/h: wheels {wheel_rate} faster than the hull {hull_rate}");
        assert!(pen < 0.01, "{kmh} km/h: no wheel in the ground {pen}");
        if after.len() > 20 {
            let late = &after[after.len() * 6 / 10..];
            let worst = late.iter().cloned().fold(0.0, f64::max);
            assert!(worst < 0.006, "{kmh} km/h: the bouncing dies out {worst}");
        }
    }
}

#[test]
fn one_track_on_a_kerb_rolls_the_hull_and_staggered_waves_roll_it_both_ways() {
    let road = terrain("road");
    let kerb = FnGround { height: |x: f64, z: f64| if x < 0.0 && z > 5.0 { 0.3 } else { 0.0 }, surface: &road };
    let (tm, mut t) = rig("us_m4a3_76w_hvss");
    place(&tm, &mut t, &kerb, 0.0, 0.0, 0.0);
    hold(&tm, &mut t, &kerb, input(0.3, 0.0, 0.0), 6.0);
    let roll = t.body.attitude().roll;
    assert!(roll < -0.04, "left side up is negative roll: {roll}");

    let dirt = terrain("dirt");
    let stag = FnGround {
        height: |x: f64, z: f64| if z > 10.0 && z < 70.0 { 0.12 * (1.0 - ((z - 10.0) / 6.0 * std::f64::consts::TAU + if x > 0.0 { std::f64::consts::PI } else { 0.0 }).cos()) } else { 0.0 },
        surface: &dirt,
    };
    let (tm, mut t) = rig("su_t34_85");
    place(&tm, &mut t, &stag, 0.0, 0.0, 0.0);
    let (mut hi, mut lo) = (0.0f64, 0.0f64);
    run(&tm, &mut t, &stag, cruise(&tm, 12.0), 12.0, |_, t| {
        hi = hi.max(t.info.roll);
        lo = lo.min(t.info.roll);
    });
    assert!(hi > 0.01 && lo < -0.01, "rolls both ways {hi} {lo}");
}

#[test]
fn weight_moves_back_accelerating_forward_braking_and_onto_the_low_end_of_a_slope() {
    let road = terrain("road");
    let flat = FnGround { height: |_x: f64, _z: f64| 0.0, surface: &road };
    let (tm, mut t) = rig("de_tiger_e");
    place(&tm, &mut t, &flat, 0.0, 0.0, 0.0);
    hold(&tm, &mut t, &flat, IDLE, 2.0);
    let n = tm.sp.per_side();
    let fr = |t: &Tank| (t.ss.load[0], t.ss.load[n - 1]);
    let (f0, b0) = fr(&t);
    hold(&tm, &mut t, &flat, input(1.0, 0.0, 0.0), 1.2);
    let (f1, b1) = fr(&t);
    assert!(f1 < f0 && b1 > b0, "accelerating: front {f0}->{f1}, rear {b0}->{b1}");
    hold(&tm, &mut t, &flat, input(1.0, 0.0, 0.0), 10.0);
    hold(&tm, &mut t, &flat, input(0.0, 0.0, 1.0), 0.5);
    let (f2, b2) = fr(&t);
    assert!(f2 > f0 && b2 < b0, "braking: front {f2} rear {b2}");

    let tan = 12f64.to_radians().tan();
    let slope = FnGround { height: move |_x: f64, z: f64| z * tan, surface: &road };
    let (tm, mut t) = rig("de_tiger_e");
    place(&tm, &mut t, &slope, 0.0, 0.0, 0.0);
    let z0 = t.body.origin()[2];
    hold(&tm, &mut t, &slope, input(0.0, 0.0, 1.0), 4.0);
    assert!((t.body.origin()[2] - z0).abs() < 0.1, "braked on 12 degrees it holds");
    assert!(t.ss.load[n - 1] > t.ss.load[0] * 1.5, "the rear (downhill) wheels carry more");
    let climb = hold(&tm, &mut t, &slope, input(1.0, 0.0, 0.0), 8.0);
    assert!(climb.speed_kmh > 2.0, "climbs it {}", climb.speed_kmh);
}

#[test]
fn differential_drive_turns_pivots_and_a_fast_turn_slides() {
    let road = terrain("road");
    let flat = FnGround { height: |_x: f64, _z: f64| 0.0, surface: &road };
    let (tm, mut t) = rig("de_tiger_e");
    place(&tm, &mut t, &flat, 0.0, 0.0, 0.0);
    let piv = hold(&tm, &mut t, &flat, input(0.0, 1.0, 0.0), 4.0);
    assert!(piv.yaw_rate_deg > 8.0 && piv.track_speed_left > 0.1 && piv.track_speed_right < -0.1 && piv.speed_kmh.abs() < 1.0, "pivot {piv:?}");

    let (tm, mut t) = rig("su_t34_85");
    place(&tm, &mut t, &flat, 0.0, 0.0, 0.0);
    hold(&tm, &mut t, &flat, input(1.0, 0.0, 0.0), 20.0);
    let fast = hold(&tm, &mut t, &flat, input(1.0, 1.0, 0.0), 3.0);
    assert!(fast.yaw_rate_deg > 10.0 && fast.w.abs() > 0.2, "slides sideways in a fast turn {}", fast.w);
    assert!(fast.roll > 0.005, "leans out of the turn {}", fast.roll);

    // straight on a road the tracks run at the ground speed
    let (tm, mut t) = rig("us_m4a3_75w");
    place(&tm, &mut t, &flat, 0.0, 0.0, 0.0);
    let cruise = hold(&tm, &mut t, &flat, input(0.6, 0.0, 0.0), 15.0);
    assert!((cruise.track_speed_left - cruise.u).abs() < 0.05 * cruise.u.abs() + 0.05, "track {} ground {}", cruise.track_speed_left, cruise.u);

    // pulling away at full throttle the tracks slip far more in mud than on a road
    let launch = |surface: &str| {
        let s = terrain(surface);
        let g = FnGround { height: |_x: f64, _z: f64| 0.0, surface: &s };
        let (tm, mut t) = rig("su_t34_85");
        place(&tm, &mut t, &g, 0.0, 0.0, 0.0);
        hold(&tm, &mut t, &g, IDLE, 1.0);
        // Isolate fully engaged terrain traction. The separate driveline launch test
        // starts with zero take-up and checks the real W-key force buildup.
        t.ds.drive_force = tm.mass * 9.81;
        t.ds.drive_direction = 1.0;
        let mut worst = 0.0f64;
        run(&tm, &mut t, &g, |_| input(1.0, 0.0, 0.0), 1.0, |_, t| worst = worst.max(t.info.track_slip));
        worst
    };
    let (mud, road_slip) = (launch("mud"), launch("road"));
    assert!(mud > 0.15 && mud > 2.0 * road_slip, "launch slip mud {mud} road {road_slip}");
}

#[test]
fn driveline_launch_builds_force_and_restarts_without_reusing_the_previous_peak() {
    let road = terrain("road");
    let flat = FnGround { height: |_x: f64, _z: f64| 0.0, surface: &road };
    for id in ["de_flakpz38t", "de_hetzer", "de_tiger_e"] {
        let (tm, mut t) = rig(id);
        place(&tm, &mut t, &flat, 0.0, 0.0, 0.0);
        hold(&tm, &mut t, &flat, IDLE, 2.0);
        let first = step(&tm, &mut t, input(1.0, 0.0, 0.0), &flat, DT);
        assert!(first.ax.abs() < 1.0, "{id}: abrupt first-frame acceleration {}", first.ax);
        let mut max_pitch = 0.0f64;
        run(&tm, &mut t, &flat, |_| input(1.0, 0.0, 0.0), 2.0, |_, t| {
            max_pitch = max_pitch.max(t.info.pitch);
        });
        if id == "de_flakpz38t" {
            assert!(max_pitch.to_degrees() < 3.5 && max_pitch > 0.005,
                "natural nose rise remains, without the launch jolt: {max_pitch}");
        }
        step(&tm, &mut t, input(-1.0, 0.0, 0.0), &flat, DT);
        assert_eq!(t.ds.drive_direction, -1.0);
        assert!(t.ds.drive_force <= tm.mass * 4.0 * DT + 1e-6);
        hold(&tm, &mut t, &flat, input(0.0, 0.0, 1.0), 3.0);
        assert!(t.info.u.abs() < 0.1);
        assert_eq!(t.ds.drive_force, 0.0);
        let again = step(&tm, &mut t, input(1.0, 0.0, 0.0), &flat, DT);
        assert!(again.ax.abs() < 1.0, "{id}: relaunch reused the previous force");
    }
}

#[test]
fn heavy_tanks_shift_up_in_mud_instead_of_crawling_in_first() {
    let mud = terrain("mud");
    let g = FnGround { height: |_x: f64, _z: f64| 0.0, surface: &mud };
    let (tm, mut t) = rig("de_tiger_e");
    place(&tm, &mut t, &g, 0.0, 0.0, 0.0);
    let info = hold(&tm, &mut t, &g, input(1.0, 0.0, 0.0), 10.0);
    assert!(info.gear >= 2 && info.speed_kmh > 6.0, "gear {} speed {}", info.gear, info.speed_kmh);
}

#[test]
fn a_remote_client_rebuilds_the_wheels_from_the_sent_hull_pose() {
    let dirt = terrain("dirt");
    let waves = FnGround { height: |_x: f64, z: f64| wave(z), surface: &dirt };
    let (tm, mut t) = rig("de_tiger_e");
    place(&tm, &mut t, &waves, 0.0, 0.0, 0.0);
    run(&tm, &mut t, &waves, cruise(&tm, 15.0), 6.0, |_, _| {});
    let sent: NetState = serde_json::from_str(&serde_json::to_string(&net_state(&t)).unwrap()).unwrap();
    let mut remote = Tank::new(&tm);
    apply_net_state(&mut remote, &sent);
    reconstruct_running_gear(&tm, &mut remote, &waves, 1.0 / 60.0);
    let err = t.ss.comp.iter().zip(&remote.ss.comp).map(|(a, b)| (a - b).abs()).fold(0.0, f64::max);
    assert!(err < 0.03, "wheel positions within 3 cm: {err}");
    assert_eq!(remote.ds.belts[0].v, sent.track[0] as f64);
    assert!(len(sub(remote.body.origin(), t.body.origin())) < 1e-4);
}

#[test]
fn the_simulation_is_deterministic() {
    let dirt = terrain("dirt");
    let waves = FnGround { height: |x: f64, z: f64| wave(z) + 0.02 * (x * 0.7).sin(), surface: &dirt };
    let go = || {
        let (tm, mut t) = rig("su_t34_85");
        place(&tm, &mut t, &waves, 0.0, 0.0, 0.3);
        hold(&tm, &mut t, &waves, input(0.8, 0.4, 0.0), 6.0);
        (t.body.pos, t.body.ez, t.ss.comp.clone(), t.ds.belts)
    };
    let (a, b) = (go(), go());
    assert_eq!(a.0, b.0);
    assert_eq!(a.1, b.1);
    assert_eq!(a.2, b.2);
    assert_eq!(a.3, b.3);
}

#[test]
fn design_inertia_is_used_when_given() {
    let mut v = tg_vehicle::load_vehicle(&root().join("vehicles").join("su_t34_85")).unwrap();
    let boxed = TankModel::from_vehicle(&v, TankOpts::default()).unwrap().inertia;
    v.def.physics.inertia_kgm2 = Some([1.0e5, 2.0e5, 3.0e4]);
    let given = TankModel::from_vehicle(&v, TankOpts::default()).unwrap().inertia;
    assert_eq!(given, [1.0e5, 2.0e5, 3.0e4]);
    assert!(boxed[1] > boxed[0] && boxed[1] > boxed[2], "yaw is the largest box moment {boxed:?}");
}

#[test]
fn the_js_mirror_and_this_model_stay_in_lockstep() {
    // client/web/tools/tank-lockstep.mjs ran the same inputs through client/web/src/sim/tank
    let fixture: serde_json::Value = serde_json::from_str(include_str!("lockstep.json")).unwrap();
    let dirt = terrain("dirt");
    let g = FnGround {
        height: |x: f64, z: f64| (if z > 4.0 && z < 40.0 { 0.1 * (1.0 - ((z - 4.0) / 5.0 * std::f64::consts::TAU).cos()) } else { 0.0 }) + 0.03 * (x * 0.9).sin(),
        surface: &dirt,
    };
    let v3 = |v: &serde_json::Value| -> V3 { [0, 1, 2].map(|i| v[i].as_f64().unwrap()) };
    for case in fixture["cases"].as_array().unwrap() {
        let id = case["id"].as_str().unwrap();
        let (tm, mut t) = rig(id);
        place(&tm, &mut t, &g, 0.0, 0.0, 0.2);
        for (k, (p, snap)) in case["plan"].as_array().unwrap().iter().zip(case["snaps"].as_array().unwrap()).enumerate() {
            let i = input(p["throttle"].as_f64().unwrap(), p["steer"].as_f64().unwrap(), p["brake"].as_f64().unwrap());
            hold(&tm, &mut t, &g, i, p["secs"].as_f64().unwrap());
            let d = len(sub(t.body.origin(), v3(&snap["origin"])));
            let a = len(sub(t.body.ez, v3(&snap["ez"]))) + len(sub(t.body.ey, v3(&snap["ey"])));
            let comp = snap["comp"].as_array().unwrap().iter().zip(&t.ss.comp).map(|(j, r)| (j.as_f64().unwrap() - r).abs()).fold(0.0, f64::max);
            let belts = snap["belts"].as_array().unwrap().iter().zip(&t.ds.belts).map(|(j, r)| (j.as_f64().unwrap() - r.v).abs()).fold(0.0, f64::max);
            if comp >= 2e-3 { eprintln!("js {:?}\nrs {:?}", snap["comp"], t.ss.comp); }
            assert!(d < 2e-3 && a < 2e-3 && comp < 2e-3 && belts < 1e-2, "{id} step {k}: position {d}, axes {a}, wheels {comp}, tracks {belts}");
            assert_eq!(snap["gear"].as_u64().unwrap() as usize, t.ds.gearbox.gear, "{id} step {k} gear");
        }
    }
}

#[test]
fn the_tracks_and_hull_collide_with_obstacles() {
    let road = terrain("road");
    let flat = FnGround { height: |_x: f64, _z: f64| 0.0, surface: &road };
    let (tm, mut t) = rig("su_t34_85");
    place(&tm, &mut t, &flat, 0.0, 0.0, 0.0);
    t.obstacles = vec![obstacle::Obstacle { x: 0.0, z: 20.0, yaw: 0.0, hx: 6.0, hz: 1.0, y0: -1.0, y1: 3.0 }];
    let mut max_z = f64::NEG_INFINITY;
    run(&tm, &mut t, &flat, |_| input(1.0, 0.0, 0.0), 8.0, |tm, t| {
        for lp in &tm.collide {
            max_z = max_z.max(t.body.world_point(*lp)[2]);
        }
    });
    assert!(max_z < 19.08, "nothing goes through the wall: front reached {max_z}");
    assert!(t.info.u.abs() < 0.5, "it stops against it {}", t.info.u);
}

#[test]
fn a_track_shot_off_leaves_the_vehicle_all_but_stuck() {
    let road = terrain("road");
    let flat = FnGround { height: |_x: f64, _z: f64| 0.0, surface: &road };
    let go = |broken: [bool; 2]| {
        let (tm, mut t) = rig("su_t34_85");
        place(&tm, &mut t, &flat, 0.0, 0.0, 0.0);
        t.broken = broken;
        let info = hold(&tm, &mut t, &flat, input(1.0, 0.0, 0.0), 5.0);
        let o = t.body.origin();
        (info, o[0].hypot(o[2]))
    };
    let (sound, d_sound) = go([false, false]);
    let (left, d_left) = go([true, false]);
    assert!(d_left < d_sound * 0.4 && left.speed_kmh < sound.speed_kmh * 0.4, "{d_left} vs {d_sound}");
    assert!(left.track_speed_left.abs() < 0.05 && left.track_speed_right > 0.2, "{} {}", left.track_speed_left, left.track_speed_right);
}
