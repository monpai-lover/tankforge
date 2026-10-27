//! Cache parity against the unchanged pre-cache obstacle algorithm below.
//! This is a legacy box/outline optimization, not a triangle-contact migration.
use super::*;
use crate::tank::{self, terrain::FnGround, Tank, TankModel, TankOpts};
use crate::{load_terrains, Input, TerrainDb, TerrainDef};
use std::cell::Cell;
use std::path::{Path, PathBuf};

std::thread_local! {
    static ORACLE: Cell<bool> = const { Cell::new(false) };
}

pub(super) fn oracle_enabled() -> bool {
    ORACLE.with(Cell::get)
}

fn with_oracle<R>(run: impl FnOnce() -> R) -> R {
    struct Restore(bool);
    impl Drop for Restore {
        fn drop(&mut self) {
            ORACLE.with(|flag| flag.set(self.0));
        }
    }
    let _restore = Restore(ORACLE.with(|flag| flag.replace(true)));
    run()
}

// Original function SHA256 before renaming: b97b4064e2c101f7d3b954e3e2d888f650dd67c3cbb4d2bdca6a5d0f67d0c0f8
pub(super) fn apply_obstacles_uncached(
    points: &[V3],
    body: &mut VehicleRigidBody,
    boxes: &[Obstacle],
    dt: f64,
) -> usize {
    if boxes.is_empty() {
        return 0;
    }
    let mass = body.mass;
    let o = body.origin();
    let k = K * mass * GRAVITY;
    let c = 2.0 * ZETA * (k * mass / 8.0).sqrt();
    let cap = 4.0 * mass * GRAVITY;
    let mut touched = 0;
    for b in boxes {
        let reach = b.hx.hypot(b.hz) + 8.0;
        if (b.x - o[0]).powi(2) + (b.z - o[2]).powi(2) > reach * reach {
            continue;
        }
        let (sn, cs) = b.yaw.sin_cos();
        for lp in points {
            let p = body.world_point(*lp);
            if p[1] < b.y0 || p[1] > b.y1 {
                continue;
            }
            let (dx, dz) = (p[0] - b.x, p[2] - b.z);
            let u = dx * cs - dz * sn;
            let w = dx * sn + dz * cs;
            let pu = b.hx - u.abs();
            let pw = b.hz - w.abs();
            if pu <= 0.0 || pw <= 0.0 {
                continue;
            }
            let py = b.y1 - p[1];
            let (n, depth) = if py < pu && py < pw {
                ([0.0, 1.0, 0.0], py)
            } else if pu < pw {
                let s = if u >= 0.0 { 1.0 } else { -1.0 };
                ([s * cs, 0.0, -s * sn], pu)
            } else {
                let s = if w >= 0.0 { 1.0 } else { -1.0 };
                ([s * sn, 0.0, s * cs], pw)
            };
            let v = body.point_velocity(p);
            let vn = dot(v, n);
            let fn_ = (k * depth - c * vn).max(0.0).min(cap);
            if fn_ <= 0.0 {
                continue;
            }
            let vt = sub(v, scale(n, vn));
            let st = len(vt);
            let mut f = scale(n, fn_);
            if st > 1e-4 {
                let ft = (MU * fn_).min(st * mass / (8.0 * dt));
                f = madd(f, vt, -ft / st);
            }
            body.add_force_at(f, p);
            touched += 1;
        }
    }
    touched
}

const DT: f64 = 1.0 / 120.0;

fn data() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")
}

fn model(id: &str) -> TankModel {
    let v = tg_vehicle::load_vehicle(&data().join("vehicles").join(id))
        .unwrap_or_else(|e| panic!("{id}: source vehicle loader rejected: {e}"));
    TankModel::from_vehicle(&v, TankOpts::default()).unwrap_or_else(|| {
        panic!("{id}: actual TankModel loader has no supported tracked running gear")
    })
}

fn surface(id: &str) -> TerrainDef {
    TerrainDb::from_vec(load_terrains(&data().join("terrains.json")).unwrap())
        .get(id)
        .unwrap()
        .clone()
}

fn append(bits: &mut Vec<u64>, values: &[f64]) {
    bits.extend(values.iter().map(|v| v.to_bits()));
}

fn body_pose_bits(b: &VehicleRigidBody) -> Vec<u64> {
    let mut bits = Vec::new();
    for v in [&b.pos, &b.ex, &b.ey, &b.ez, &b.com, &b.inertia, &b.v, &b.w] {
        append(&mut bits, v);
    }
    append(&mut bits, &[b.mass, b.linear_damping, b.angular_damping]);
    if let Some(rg) = &b.running_gear {
        for v in [
            &rg.q,
            &rg.qv,
            &rg.normal_impulse,
            &rg.spring_impulse,
            &rg.rock_impulse,
        ] {
            append(&mut bits, v);
        }
        append(&mut bits, &rg.a);
        append(&mut bits, &rg.s);
        bits.push(rg.remote_pose as u64);
    }
    bits
}

fn force_bits(b: &VehicleRigidBody) -> Vec<u64> {
    let (f, t) = b.accumulated_force_torque();
    f.into_iter().chain(t).map(f64::to_bits).collect()
}

fn compare_call(
    label: &str,
    points: &[V3],
    source: &VehicleRigidBody,
    boxes: &[Obstacle],
    dt: f64,
) -> usize {
    let before = body_pose_bits(source);
    let mut cached = source.clone();
    let mut old = source.clone();
    let touched = apply_obstacles(points, &mut cached, boxes, dt);
    let expected = apply_obstacles_uncached(points, &mut old, boxes, dt);
    assert_eq!(touched, expected, "{label}: contact count/order");
    assert_eq!(
        force_bits(&cached),
        force_bits(&old),
        "{label}: accumulated force/torque bits"
    );
    assert_eq!(
        body_pose_bits(&cached),
        before,
        "{label}: cached call must not alter source pose/velocities/gear"
    );
    assert_eq!(
        body_pose_bits(&old),
        before,
        "{label}: oracle must not alter source pose/velocities/gear"
    );
    assert!(
        cached
            .accumulated_force_torque()
            .0
            .into_iter()
            .chain(cached.accumulated_force_torque().1)
            .all(f64::is_finite),
        "{label}: finite accumulation"
    );
    touched
}

fn boxes_at(body: &VehicleRigidBody, points: &[V3]) -> Vec<Obstacle> {
    let mut boxes = vec![Obstacle {
        x: 200000.0,
        z: -200000.0,
        yaw: 0.8,
        hx: 2.0,
        hz: 3.0,
        y0: -50.0,
        y1: 50.0,
    }];
    for (i, index) in [0, points.len() / 3, points.len() / 2, points.len() - 1]
        .into_iter()
        .enumerate()
    {
        let p = body.world_point(points[index]);
        boxes.push(Obstacle {
            x: p[0],
            z: p[2],
            yaw: i as f64 * 0.47 - 0.41,
            hx: 0.65 + i as f64 * 0.11,
            hz: 1.3,
            y0: p[1] - 0.45,
            y1: p[1] + 0.24,
        });
        // A vertically disjoint, horizontally near box still runs the same
        // height rejection. It must neither filter points out of the cache nor
        // change subsequent box order.
        boxes.push(Obstacle {
            x: p[0],
            z: p[2],
            yaw: -0.29,
            hx: 0.8,
            hz: 0.9,
            y0: p[1] + 50.0,
            y1: p[1] + 60.0,
        });
    }
    boxes
}

#[test]
fn obstacle_cache_matches_old_force_and_pose_bits_on_all_source_running_gears() {
    let road = surface("road");
    let slope = FnGround {
        height: |x: f64, z: f64| 0.13 * x - 0.09 * z,
        surface: &road,
    };
    let mut paths: Vec<_> = std::fs::read_dir(data().join("vehicles"))
        .unwrap()
        .map(|p| p.unwrap().path())
        .filter(|p| p.join("vehicle.json").is_file())
        .collect();
    paths.sort();
    let mut tested = Vec::new();
    let mut rejected_loader = Vec::new();
    let mut unsupported_plant = Vec::new();
    let mut contacts = 0;
    for path in paths {
        let id = path.file_name().unwrap().to_str().unwrap();
        let v = match tg_vehicle::load_vehicle(&path) {
            Ok(v) => v,
            Err(error) => {
                rejected_loader.push((id.to_owned(), error.to_string()));
                continue;
            }
        };
        let Some(tm) = TankModel::from_vehicle(&v, TankOpts::default()) else {
            unsupported_plant.push(id.to_owned());
            continue;
        };
        assert!(!tm.collide.is_empty(), "{id}");
        let mut t = Tank::new(&tm);
        for (case, yaw, velocity, omega) in [
            ("standing", 0.0, [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]),
            (
                "rotated-sloped-friction",
                0.71,
                [5.7, -0.3, 9.3],
                [0.14, -0.47, 0.19],
            ),
            (
                "high-speed-cap",
                -1.23,
                [80.0, -35.0, -45.0],
                [-1.2, 2.8, 0.9],
            ),
        ] {
            tank::place(&tm, &mut t, &slope, 123.25, -67.75, yaw);
            t.body.v = velocity;
            t.body.w = omega;
            // Existing accumulators are intentionally nonzero: a cache must
            // not clear, reorder, or replace previously applied forces.
            t.body.add_force_at(
                [1234.5, -4567.25, 678.125],
                t.body.world_point([0.3, 0.7, -0.2]),
            );
            let boxes = boxes_at(&t.body, &tm.collide);
            let label = format!("{id}/{case}");
            contacts += compare_call(&label, &tm.collide, &t.body, &boxes, DT);
            let mut reversed = boxes.clone();
            reversed.reverse();
            contacts += compare_call(
                &format!("{label}/reversed-source-order"),
                &tm.collide,
                &t.body,
                &reversed,
                DT / 2.0,
            );
        }
        tested.push(id.to_owned());
    }
    for expected in [
        "su_t72a",
        "su_t34_85",
        "de_pz3_j",
        "de_tiger_e",
        "us_m4a1_76w",
        "de_gepard",
        "de_panther_g",
        "proto_a",
    ] {
        assert!(
            tested.iter().any(|id| id == expected),
            "Required current native vehicle {expected} was not tested"
        );
    }
    assert!(contacts > 0);
    eprintln!(
        "obstacle-cache all-source parity: models={} scenarios={} actual contacts={contacts}",
        tested.len(),
        tested.len() * 6
    );
    eprintln!("obstacle-cache tested actual native tracked model IDs: {tested:?}");
    eprintln!("obstacle-cache explicitly excluded source loader errors (not certified): {rejected_loader:?}");
    eprintln!("obstacle-cache explicitly excluded unsupported plants (not certified): {unsupported_plant:?}");
}

#[test]
fn obstacle_cache_preserves_faces_height_edges_friction_threshold_and_force_cap() {
    let mut b = VehicleRigidBody::new(43000.0, [58000.0, 99000.0, 47000.0], [0.0; 3]);
    let low = 0.25_f64;
    let high = 1.5_f64;
    let points = vec![
        [0.0, low, 0.0],
        [0.0, f64::from_bits(low.to_bits() - 1), 0.0],
        [0.0, high, 0.0],
        [0.0, f64::from_bits(high.to_bits() + 1), 0.0],
        [2.0, 0.8, 0.0],
        [-2.0, 0.8, 0.0],
        [0.0, 0.8, 3.0],
        [0.0, 0.8, -3.0],
        [f64::from_bits(2.0_f64.to_bits() - 1), 0.8, 0.0],
        [0.1, 1.2, 0.3],
        [-0.4, 0.7, -0.2],
        [0.0, 0.75, 0.0],
    ];
    let near = Obstacle {
        x: 0.0,
        z: 0.0,
        yaw: 0.0,
        hx: 2.0,
        hz: 3.0,
        y0: low,
        y1: high,
    };
    let deep = Obstacle {
        x: 0.0,
        z: 0.0,
        yaw: 0.0,
        hx: 20.0,
        hz: 30.0,
        y0: -50.0,
        y1: 50.0,
    };
    let mut contacts = 0;
    for (case, v, w, dt) in [
        ("zero", [0.0, 0.0, 0.0], [0.0; 3], DT),
        ("exact-tangent-threshold", [1e-4, -0.5, 0.0], [0.0; 3], DT),
        (
            "above-tangent-threshold",
            [f64::from_bits(1e-4_f64.to_bits() + 1), -0.5, 0.0],
            [0.0; 3],
            DT,
        ),
        ("separating-zero-spring", [0.0, 400.0, 0.0], [0.0; 3], DT),
        (
            "high-speed-normal-and-friction-cap",
            [170.0, -200.0, -130.0],
            [2.0, -3.0, 1.0],
            DT / 2.0,
        ),
    ] {
        b.v = v;
        b.w = w;
        contacts += compare_call(case, &points, &b, &[near, deep, near], dt);
    }
    assert!(contacts > 0);
    let p = [[0.0, 0.5, 0.0]];
    b.v = [0.0; 3];
    b.w = [0.0; 3];
    let mut capped = b.clone();
    let top_cap = Obstacle { y1: 5.0, ..deep };
    assert_eq!(apply_obstacles(&p, &mut capped, &[top_cap], DT), 1);
    assert_eq!(
        capped.accumulated_force_torque().0[1].to_bits(),
        (4.0 * b.mass * GRAVITY).to_bits(),
        "Actual original per-contact cap remains exact"
    );
}

#[test]
fn obstacle_cache_empty_far_then_near_and_each_new_pose_do_not_reuse_stale_points() {
    let tm = model("su_t72a");
    let mut body = Tank::new(&tm).body;
    let far = Obstacle {
        x: 5000.0,
        z: 5000.0,
        yaw: 0.1,
        hx: 2.0,
        hz: 3.0,
        y0: -1.0,
        y1: 100.0,
    };
    assert_eq!(compare_call("empty-boxes", &tm.collide, &body, &[], DT), 0);
    assert_eq!(
        compare_call("all-far", &tm.collide, &body, &[far, far], DT),
        0
    );
    assert_eq!(compare_call("empty-points", &[], &body, &[far], DT), 0);
    let mut contacts = 0;
    for (i, yaw) in [0.0, 0.4, -1.7, 3.12].into_iter().enumerate() {
        body.place([i as f64 * 13.0, 0.5, i as f64 * -9.0], yaw);
        body.v = [3.0, -2.0, 4.0];
        body.w = [0.1, 0.3, -0.2];
        contacts += compare_call(
            "reposed/far-before-near",
            &tm.collide,
            &body,
            &boxes_at(&body, &tm.collide),
            DT,
        );
    }
    assert!(contacts > 0);
}

fn tank_bits(t: &Tank) -> Vec<u64> {
    let mut out = body_pose_bits(&t.body);
    out.extend(force_bits(&t.body));
    append(&mut out, &t.travel);
    append(&mut out, &[t.rut]);
    for v in [
        &t.ss.comp,
        &t.ss.support,
        &t.ss.load,
        &t.ss.unit_x,
        &t.ss.unit_v,
        &t.ss.spring,
        &t.ss.damper,
        &t.ss.force,
    ] {
        append(&mut out, v);
    }
    for v in &t.ss.contact {
        append(&mut out, v);
    }
    out.extend(t.ss.grounded.iter().map(|v| *v as u64));
    append(&mut out, &t.ds.target);
    append(&mut out, &t.ds.drive);
    append(&mut out, &t.ds.brakes);
    append(
        &mut out,
        &[
            t.ds.gearbox.rpm,
            t.ds.gearbox.shift_timer,
            t.ds.f_eng,
            t.ds.load,
            t.ds.drive_force,
            t.ds.drive_direction,
        ],
    );
    out.extend([
        t.ds.gearbox.gear as u64,
        t.ds.reversing as u64,
        t.ds.braking as u64,
    ]);
    for belt in &t.ds.belts {
        append(&mut out, &[belt.v, belt.m]);
    }
    let mo = t.ds.motor;
    append(
        &mut out,
        &[
            mo.mean,
            mo.mean_cap,
            mo.diff,
            mo.diff_cap,
            mo.f_mean,
            mo.f_steer,
        ],
    );
    out.extend([
        mo.pushing as u64,
        mo.broken[0] as u64,
        mo.broken[1] as u64,
        t.broken[0] as u64,
        t.broken[1] as u64,
    ]);
    for c in &t.contacts {
        for v in [&c.p, &c.n, &c.tl, &c.tt] {
            append(&mut out, v);
        }
        append(
            &mut out,
            &[
                c.load,
                c.grip.traction_mu,
                c.grip.lateral_mu,
                c.grip.shear_k.unwrap_or(-1.0),
                c.z.unwrap_or(-999.0),
                c.slip,
                c.fl,
                c.ft,
            ],
        );
        out.push(c.side as i64 as u64);
    }
    out
}

fn net_bits(t: &Tank) -> Vec<u64> {
    let n = tank::net_state(t);
    let mut out = Vec::new();
    for v in [&n.pos[..], &n.ex, &n.ez, &n.v, &n.w, &n.track] {
        out.extend(v.iter().map(|v| v.to_bits() as u64));
    }
    out.extend([n.rpm.to_bits() as u64, n.gear as u64]);
    if let Some(rg) = n.rg {
        out.push(rg.version as u64);
        append(&mut out, &rg.q);
        append(&mut out, &rg.qv);
    }
    out
}

#[test]
fn obstacle_cache_actual_tank_steps_net_and_running_gear_stay_bit_exact() {
    let ids = [
        "su_t72a",
        "su_t34_85",
        "de_pz3_j",
        "de_tiger_e",
        "us_m4a1_76w",
        "de_gepard",
        "de_panther_g",
        "proto_a",
    ];
    let mut step_pairs = 0;
    for id in ids {
        let tm = model(id);
        for case in 0..3 {
            let road = surface(["road", "dirt", "mud"][case]);
            let g = FnGround {
                height: move |x: f64, z: f64| match case {
                    0 => 0.0,
                    1 => 0.08 * z - 0.04 * x,
                    _ => 0.11 * (z * 0.9).sin() + 0.06 * (x * 1.3).sin(),
                },
                surface: &road,
            };
            let mut cached = Tank::new(&tm);
            tank::place(&tm, &mut cached, &g, 0.0, 0.0, [0.0, 0.71, -0.37][case]);
            if case > 0 {
                cached.body.v = scale(cached.body.ez, [0.0, 9.0, 24.0][case]);
                cached.body.w = [0.03, -0.15, 0.02];
                for belt in &mut cached.ds.belts {
                    belt.v = [0.0, 9.0, 24.0][case];
                }
            }
            cached.obstacles = vec![
                Obstacle {
                    x: 0.0,
                    z: 5.0,
                    yaw: 0.17,
                    hx: 6.0,
                    hz: 0.7,
                    y0: -3.0,
                    y1: 4.5,
                },
                Obstacle {
                    x: 2.7,
                    z: 1.5,
                    yaw: -0.11,
                    hx: 0.6,
                    hz: 8.0,
                    y0: -3.0,
                    y1: 5.0,
                },
                Obstacle {
                    x: -2.6,
                    z: -2.0,
                    yaw: 0.31,
                    hx: 0.8,
                    hz: 4.0,
                    y0: -3.0,
                    y1: 5.0,
                },
                Obstacle {
                    x: -1.0,
                    z: 3.0,
                    yaw: -0.27,
                    hx: 1.0,
                    hz: 1.0,
                    y0: 20.0,
                    y1: 25.0,
                },
                Obstacle {
                    x: 300.0,
                    z: -500.0,
                    yaw: 0.43,
                    hx: 8.0,
                    hz: 10.0,
                    y0: -2.0,
                    y1: 3.0,
                },
            ];
            let mut old = Tank::new(&tm);
            tank::place(&tm, &mut old, &g, 0.0, 0.0, [0.0, 0.71, -0.37][case]);
            old.body.v = cached.body.v;
            old.body.w = cached.body.w;
            for (a, b) in old.ds.belts.iter_mut().zip(&cached.ds.belts) {
                a.v = b.v;
            }
            old.obstacles = cached.obstacles.clone();
            for tick in 0..180 {
                let input = match tick / 45 {
                    0 => Input {
                        throttle: 0.8,
                        steer: 0.17,
                        brake: 0.0,
                        drive_power: None,
                    },
                    1 => Input {
                        throttle: 0.5,
                        steer: -0.4,
                        brake: 0.0,
                        drive_power: Some(0.73),
                    },
                    2 => Input {
                        throttle: 0.0,
                        steer: 0.0,
                        brake: 1.0,
                        drive_power: None,
                    },
                    _ => Input {
                        throttle: -0.6,
                        steer: 0.31,
                        brake: 0.0,
                        drive_power: None,
                    },
                };
                let got = tank::step(&tm, &mut cached, input, &g, DT);
                let want = with_oracle(|| tank::step(&tm, &mut old, input, &g, DT));
                assert_eq!(tank_bits(&cached), tank_bits(&old), "{id} case{case} tick{tick}: complete sampled f64 trajectory/suspension/track/contact bits");
                assert_eq!(
                    net_bits(&cached),
                    net_bits(&old),
                    "{id} case{case} tick{tick}: authoritative f32 net and f64 gear hint bits"
                );
                assert_eq!(
                    serde_json::to_string(&got).unwrap(),
                    serde_json::to_string(&want).unwrap(),
                    "{id} case{case} tick{tick}: actual TankInfo"
                );
                assert!(
                    cached
                        .body
                        .pos
                        .into_iter()
                        .chain(cached.body.v)
                        .chain(cached.body.w)
                        .all(f64::is_finite),
                    "{id} case{case} tick{tick}"
                );
                step_pairs += 1;
            }
        }
    }
    eprintln!("obstacle-cache actual tank::step parity: {step_pairs} pairs,8 vehicles,3 grounds,180 steps/case,120Hz and actual substeps");
}

#[test]
fn obstacle_cache_oracle_scope_restores_on_panic_without_affecting_other_threads() {
    assert!(!oracle_enabled());
    with_oracle(|| {
        assert!(oracle_enabled());
        assert!(!std::thread::spawn(oracle_enabled).join().unwrap());
    });
    assert!(!oracle_enabled());
    let caught =
        std::panic::catch_unwind(|| with_oracle(|| panic!("test-only oracle restoration")));
    assert!(caught.is_err());
    assert!(!oracle_enabled());
}

#[test]
#[ignore = "Explicit release-only local microdiagnostic; not a whole-world budget/performance gate"]
fn obstacle_cache_microtiming_near_bank_many_boxes() {
    use std::hint::black_box;
    use std::time::Instant;
    let tm = model("su_t72a");
    let mut source = Tank::new(&tm).body;
    source.place([36505.535778880185, 8.1, 4882.417758686332], 0.71);
    source.v = [5.7, -0.3, 9.3];
    source.w = [0.14, -0.47, 0.19];
    let bank = boxes_at(&source, &tm.collide);
    let near: Vec<_> = bank.iter().copied().skip(1).collect();
    const CALLS: usize = 1200;
    for count in [1, 4, 12] {
        let mut boxes: Vec<_> = near.iter().copied().cycle().take(count).collect();
        boxes.extend((0..40).map(|i| Obstacle {
            x: 200000.0 + i as f64 * 11.0,
            z: -200000.0,
            yaw: 0.8,
            hx: 2.0,
            hz: 3.0,
            y0: -50.0,
            y1: 50.0,
        }));
        compare_call(
            "microdiagnostic parity before timing",
            &tm.collide,
            &source,
            &boxes,
            DT,
        );
        let mut timing = [Vec::new(), Vec::new()];
        for round in 0..6 {
            for which in if round % 2 == 0 { [0, 1] } else { [1, 0] } {
                let mut body = source.clone();
                let started = Instant::now();
                let mut touched = 0;
                for _ in 0..CALLS {
                    body.clear_forces();
                    touched += if which == 0 {
                        apply_obstacles_uncached(
                            black_box(&tm.collide),
                            black_box(&mut body),
                            black_box(&boxes),
                            DT,
                        )
                    } else {
                        apply_obstacles(
                            black_box(&tm.collide),
                            black_box(&mut body),
                            black_box(&boxes),
                            DT,
                        )
                    };
                }
                let ns = started.elapsed().as_nanos() as f64 / CALLS as f64;
                black_box((touched, body.accumulated_force_torque()));
                timing[which].push(ns);
            }
        }
        for samples in &mut timing {
            samples.sort_by(f64::total_cmp);
        }
        let median = |v: &[f64]| (v[2] + v[3]) / 2.0;
        eprintln!("obstacle_cache_microtiming {{\"scope\":\"one fixed real T72 source outline at near-bank pose; no integration/world/network/GPU\",\"points\":{},\"nearBoxes\":{count},\"farBoxes\":40,\"callsPerRound\":{CALLS},\"rounds\":6,\"oldMedianNs\":{:.3},\"cachedMedianNs\":{:.3},\"ratioCachedOverOld\":{:.6},\"oldWorldPointCallsPerApply\":{},\"cachedWorldPointCallsPerApply\":{}}}", tm.collide.len(), median(&timing[0]), median(&timing[1]), median(&timing[1]) / median(&timing[0]), count * tm.collide.len(), tm.collide.len());
    }
}
