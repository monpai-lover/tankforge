//! Explicit no-support contact tests, with the real previous wheel-support
//! function kept as a cfg(test)-only numerical oracle for ordinary ground.
use super::*;
use crate::tank::{
    self,
    road_wheel::{support_under_mode, GroundProfile, Station, BRIDGE},
    Tank, TankModel, TankOpts,
};
use crate::{load_terrains, Input, TerrainDb};
use std::path::Path;

// Exact old function SHA before rename: 7abd94153478f0774f4b125ed71929d134b199fa5db584fba4c4e493555e6127
fn support_before_optional(window: f64, prof: &GroundProfile, s: &Station, bare: bool) -> f64 {
    let zs = &prof.zs;
    let g = &prof.h;
    let mut j = 1;
    while j < zs.len() - 1 && zs[j] < s.z {
        j += 1;
    }
    let u = ((s.z - zs[j - 1]) / (zs[j] - zs[j - 1])).clamp(0.0, 1.0);
    let mut best = g[j - 1] + (g[j] - g[j - 1]) * u;
    for k in 0..zs.len() {
        let dz = (zs[k] - s.z).abs();
        if dz > window || prof.run[k] >= 0.0 || (bare && dz >= s.r) {
            continue;
        }
        let round = if dz < s.r {
            s.r - (s.r * s.r - dz * dz).sqrt()
        } else {
            f64::INFINITY
        };
        let v = g[k] - if bare { round } else { round.min(BRIDGE * dz) };
        if v > best {
            best = v;
        }
    }
    best
}

fn data() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")
}
fn road() -> TerrainDef {
    TerrainDb::from_vec(load_terrains(&data().join("terrains.json")).unwrap())
        .get("road")
        .unwrap()
        .clone()
}
fn model(id: &str) -> TankModel {
    let v = tg_vehicle::load_vehicle(&data().join("vehicles").join(id)).unwrap();
    TankModel::from_vehicle(&v, TankOpts::default()).unwrap()
}

#[test]
fn support_default_profiles_match_actual_previous_wheel_function_bit_for_bit() {
    let road = road();
    let mut queries = 0;
    for id in [
        "su_t72a",
        "su_t34_85",
        "de_pz3_j",
        "de_tiger_e",
        "us_m4a1_76w",
        "de_gepard",
        "de_panther_g",
        "proto_a",
    ] {
        let tm = model(id);
        for case in 0..3 {
            let g = FnGround {
                height: move |x: f64, z: f64| match case {
                    0 => 0.0,
                    1 => 0.13 * x - 0.09 * z,
                    _ => 0.17 * (z * 0.8).sin() + 0.05 * (x * 1.3).sin(),
                },
                surface: &road,
            };
            let mut t = Tank::new(&tm);
            tank::place(&tm, &mut t, &g, 123.25, -67.75, 0.71);
            tm.ct.sample_ground(&mut t.cs, &t.body, &g);
            for prof in &t.cs.prof {
                assert!(prof.supported.iter().all(|v| *v));
                for (p, h) in prof.pts.iter().zip(&prof.h) {
                    assert_eq!(h.to_bits(), g.height(p[0], p[2]).to_bits());
                }
            }
            for station in &tm.sp.stations {
                for bare in [false, true] {
                    let p = &t.cs.prof[si(station.side)];
                    let old = support_before_optional(tm.sp.window, p, station, bare);
                    assert_eq!(
                        support_under_mode(tm.sp.window, p, station, bare)
                            .unwrap()
                            .to_bits(),
                        old.to_bits(),
                        "{id} case{case} station{station:?} bare{bare}"
                    );
                    queries += 1;
                }
            }
        }
    }
    eprintln!("default no-support API pristine scalar parity: {queries} real station queries,8 actual source models,3 grounds; all bits equal frozen old function");
}

struct VoidGround<'a>(&'a TerrainDef);
impl Ground for VoidGround<'_> {
    fn height(&self, _x: f64, _z: f64) -> f64 {
        0.0
    }
    fn surface(&self, _x: f64, _z: f64) -> &TerrainDef {
        self.0
    }
    fn has_support(&self, _x: f64, _z: f64) -> bool {
        false
    }
}
#[test]
fn no_support_has_no_wheel_run_belly_or_friction_and_actual_body_falls_through_height_plane() {
    let road = road();
    let flat = FnGround {
        height: |_: f64, _: f64| 5.0,
        surface: &road,
    };
    let missing = VoidGround(&road);
    let tm = model("su_t72a");
    let mut t = Tank::new(&tm);
    tank::place(&tm, &mut t, &flat, 0.0, 0.0, 0.0);
    for _ in 0..120 {
        tank::step(
            &tm,
            &mut t,
            Input {
                brake: 1.0,
                ..Default::default()
            },
            &flat,
            1.0 / 120.0,
        );
    }
    let before = t.body.origin();
    for _ in 0..180 {
        tank::step(
            &tm,
            &mut t,
            Input {
                throttle: 1.0,
                ..Default::default()
            },
            &missing,
            1.0 / 120.0,
        );
    }
    let after = t.body.origin();
    assert!(
        after[1] < -2.0,
        "Real freefall through the known y0 plane: {before:?}->{after:?}"
    );
    assert!(t.ss.load.iter().all(|v| *v == 0.0));
    assert!(t.ss.grounded.iter().all(|v| !v));
    assert!(t.contacts.is_empty());
    assert_eq!(t.cs.belly, 0.0);
    assert!(t
        .cs
        .prof
        .iter()
        .all(|p| p.supported.iter().all(|v| !v) && p.h.iter().all(|h| h.is_finite())));
    assert!(t
        .body
        .pos
        .into_iter()
        .chain(t.body.v)
        .chain(t.body.w)
        .all(f64::is_finite));
    assert!(
        after[0].hypot(after[2]) < 0.2,
        "Spinning motors without terrain grip cannot drive on an invisible floor"
    );
}

struct GapGround<'a>(&'a TerrainDef);
impl Ground for GapGround<'_> {
    fn height(&self, _x: f64, _z: f64) -> f64 {
        7.0
    }
    fn surface(&self, _x: f64, _z: f64) -> &TerrainDef {
        self.0
    }
    fn has_support(&self, _x: f64, z: f64) -> bool {
        z.abs() > 1.0
    }
}
#[test]
fn no_support_edge_normals_are_finite_and_contacts_never_interpolate_a_water_floor() {
    let road = road();
    let g = GapGround(&road);
    let tm = model("su_t72a");
    let mut t = Tank::new(&tm);
    tank::place(&tm, &mut t, &g, 0.0, 0.0, 0.0);
    for _ in 0..60 {
        tank::step(&tm, &mut t, Input::default(), &g, 1.0 / 120.0);
    }
    assert!(t.cs.prof.iter().any(|p| p.supported.iter().any(|v| !*v)));
    assert!(t.cs.prof.iter().any(|p| p.supported.iter().any(|v| *v)));
    for side in [1, -1] {
        for z in &tm.ct.cz {
            let n = tm.ct.ground_normal(&t.cs, &t.body, side, *z);
            assert!(n.into_iter().all(f64::is_finite));
            assert!(n[1] > 0.0);
        }
    }
    assert!(t.contacts.iter().all(|c| g.has_support(c.p[0], c.p[2])));
    let p = GroundProfile {
        zs: vec![-2.0, -1.0, 0.0, 1.0, 2.0],
        run: vec![-1.0; 5],
        h: vec![1000.0; 5],
        pts: vec![],
        supported: vec![false; 5],
    };
    assert_eq!(
        support_under_mode(
            0.6,
            &p,
            &Station {
                z: 0.0,
                y: 0.5,
                r: 0.35,
                x: 1.0,
                side: 1
            },
            false
        ),
        None
    );
    assert_eq!(
        p.along_slope(2),
        0.0,
        "Unsupported finite placeholders are never height gradients"
    );
}
