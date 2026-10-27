//! Frozen Taiwan source terrain and sampled real native tracked-vehicle cases.
//! No GPU, pose overwrite, collision waiver or whole-40km traversal claim.
use super::*;
use sha2::{Digest, Sha256};
use std::path::PathBuf;

const MAP_SHA: &str = "a319d7f307e4146e5bc139486e3ab45e0eb6229371ddab3c6c35e791f2bd4499";
const CASES_SHA: &str = "65445968b73b5a992b6c98e11f35046ebda17c889a2ed2457914385259c863fb";

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}
fn data() -> PathBuf {
    root().join("data")
}
fn load_map() -> Value {
    let bytes = std::fs::read(data().join("frontline/taiwan.json")).unwrap();
    assert_eq!(format!("{:x}", Sha256::digest(&bytes)), MAP_SHA, "Frozen Taiwan geography changed; revalidate source proof rather than silently change test terrain");
    serde_json::from_slice(&bytes).unwrap()
}
fn load_cases() -> Vec<Value> {
    let bytes =
        std::fs::read(root().join("docs/air-frontline/research/taiwan-runtime-native-cases.json"))
            .unwrap();
    assert_eq!(format!("{:x}", Sha256::digest(&bytes)), CASES_SHA);
    let value: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(value["sourceMapSha256"], MAP_SHA);
    let cases = value["cases"].as_array().unwrap().clone();
    assert_eq!(
        cases.len(),
        27,
        "Do not silently reduce sampled source cases"
    );
    cases
}
fn point(value: &Value) -> [f64; 3] {
    serde_json::from_value(value.clone()).unwrap()
}
fn advance(w: &mut SimWorld, seconds: f64) {
    for _ in 0..(seconds * 20.0).round() as usize {
        w.step(0.05);
    }
}
fn wet(w: &SimWorld, x: f64, z: f64) -> bool {
    w.ground.water_level(x, z).is_some()
}
fn outline_supported(w: &SimWorld, id: u64) -> bool {
    let u = &w.units[&id];
    u.model.plant.collide.iter().all(|p| {
        let p = u.tank.body.world_point(*p);
        w.ground.ground_navigation_allowed(p[0], p[2])
    })
}
fn outline_wet(w: &SimWorld, id: u64) -> bool {
    let u = &w.units[&id];
    u.model.plant.collide.iter().any(|p| {
        let p = u.tank.body.world_point(*p);
        wet(w, p[0], p[2])
    })
}
fn unsupported_outline(w: &SimWorld, id: u64) -> Vec<Value> {
    let u = &w.units[&id];
    u.model
        .plant
        .collide
        .iter()
        .filter_map(|local| {
            let p = u.tank.body.world_point(*local);
            (!w.ground.ground_navigation_allowed(p[0], p[2])).then(|| {
                json!({
                    "local":local,"world":p,"height":w.height(p[0],p[2]),
                    "waterLevel":w.ground.water_level(p[0],p[2])
                })
            })
        })
        .collect()
}
fn road_points(m: &Value, id: &str) -> Vec<[f64; 3]> {
    m["roads"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == id)
        .unwrap()["points"]
        .as_array()
        .unwrap()
        .iter()
        .map(point)
        .collect()
}
fn horizontal(a: [f64; 3], b: [f64; 3]) -> f64 {
    (a[0] - b[0]).hypot(a[2] - b[2])
}
fn road_station(points: &[[f64; 3]], p: [f64; 3]) -> (f64, f64) {
    let (mut along, mut best, mut station) = (0.0, f64::INFINITY, 0.0);
    for edge in points.windows(2) {
        let dx = edge[1][0] - edge[0][0];
        let dz = edge[1][2] - edge[0][2];
        let length = dx.hypot(dz);
        let t = (((p[0] - edge[0][0]) * dx + (p[2] - edge[0][2]) * dz) / (length * length))
            .clamp(0.0, 1.0);
        let distance = (p[0] - edge[0][0] - dx * t).hypot(p[2] - edge[0][2] - dz * t);
        if distance < best {
            best = distance;
            station = along + length * t;
        }
        along += length;
    }
    (station, best)
}
fn point_at(w: &SimWorld, points: &[[f64; 3]], mut distance: f64) -> [f64; 3] {
    for edge in points.windows(2) {
        let length = horizontal(edge[0], edge[1]);
        if distance <= length {
            let t = (distance / length).clamp(0.0, 1.0);
            let x = edge[0][0] + (edge[1][0] - edge[0][0]) * t;
            let z = edge[0][2] + (edge[1][2] - edge[0][2]) * t;
            return [x, w.height(x, z), z];
        }
        distance -= length;
    }
    *points.last().unwrap()
}

/// Choose an actually wet segment within the specified original deck group.
/// The centre case is a583m canal/deck group: its representative point itself
/// is dry. Selecting its nearest wet member makes the test exercise real water
/// support instead of incorrectly treating a group label as a water crossing.
fn wet_deck_sample(w: &SimWorld, case: &Value) -> [f64; 3] {
    let bridge = w
        .ground
        .policy
        .as_ref()
        .unwrap()
        .bridges
        .iter()
        .find(|b| b.id == case["bridgeId"].as_str().unwrap())
        .unwrap();
    let beds = w.ground.roadbeds.as_ref().unwrap();
    let representative = point(&case["point"]);
    bridge
        .segments
        .iter()
        .filter_map(|&i| {
            let s = &beds.segments[i];
            let (x, z) = ((s[0] + s[3]) / 2.0, (s[1] + s[4]) / 2.0);
            (wet(w, x, z) && w.ground.ground_navigation_allowed(x, z)).then_some([
                x,
                w.height(x, z),
                z,
            ])
        })
        .min_by(|a, b| horizontal(*a, representative).total_cmp(&horizontal(*b, representative)))
        .expect("Specified real deck group must include an actually wet supported road segment")
}

/// The same production route planner and native throttle/brake/steering driver
/// used by Hub AI. Only controls are sent; accepted native poses are observed.
fn drive_registered(
    w: &mut SimWorld,
    m: &Value,
    id: u64,
    road: &str,
    start: [f64; 3],
    end: [f64; 3],
    seconds: f64,
    whole_outline: bool,
) -> usize {
    let mut plan = crate::frontline_campaign::NavigationPlan::registered_test_plan(
        m,
        [start[0], start[2]],
        [end[0], end[2]],
        road,
    );
    let initial = w.snapshot(id).unwrap();
    let mut wet_frames = 0;
    let mut reached = false;
    for _ in 0..(seconds * 20.0).round() as usize {
        let s = w.snapshot(id).unwrap();
        let goal = plan.waypoint(s.pos);
        if plan.current_index() + 1 == plan.points.len() && horizontal(s.pos, end) < 3.0 {
            reached = true;
            break;
        }
        let controls = w.navigation_input(id, goal, plan.next_waypoint()).unwrap();
        w.set_input(id, controls).unwrap();
        w.step(0.05);
        assert!(
            w.snapshot(id).unwrap().alive,
            "{road}: native body must survive navigation"
        );
        if whole_outline {
            assert!(
                outline_supported(w, id),
                "{road}: accepted native hull/track outline left supported cores at {:?}; heading={}; actualUnsupported={:?}",
                w.snapshot(id).unwrap().pos, w.snapshot(id).unwrap().heading, unsupported_outline(w,id)
            );
        }
        wet_frames += usize::from(outline_wet(w, id));
    }
    let final_state = w.snapshot(id).unwrap();
    assert!(reached, "{road}: real native route did not finish {:?}->{:?}; target={end:?}, heading={}, v={:?}, cursor={}, input={:?}, contacts={:?}",
        initial.pos, final_state.pos, final_state.heading, final_state.velocity,
        plan.current_index(), w.units[&id].input, w.units[&id].tank.obstacles);
    assert_eq!(
        final_state.ammo, initial.ammo,
        "Navigation must preserve mounted ammunition"
    );
    wet_frames
}

#[test]
fn taiwan_native_map_matches_129_source_height_probes_and_all60_source_slots() {
    let m = load_map();
    let proof: Value = serde_json::from_slice(
        &std::fs::read(
            root().join("docs/air-frontline/research/taiwan-runtime-geography-proof.json"),
        )
        .unwrap(),
    )
    .unwrap();
    assert_eq!(proof["sourceMapSha256"], MAP_SHA);
    assert_eq!(proof["pass"], true);
    let mut w = SimWorld::load(&data(), &m)
        .expect("Frozen Taiwan map must load its own native terrain/policy");
    let probes = proof["heightProbes"].as_array().unwrap();
    assert_eq!(probes.len(), 129);
    for p in probes {
        let [x, y, z] = point(&p["pos"]);
        assert!(
            (w.height(x, z) - y).abs() < 0.00011,
            "{} source/native height mismatch at {x},{z}: {} vs {y}",
            p["id"],
            w.height(x, z)
        );
    }
    // WGS84 references transformed by the asset's actual retained AEQD frame.
    // Ocean metadata is globally available while tank navigation outside the
    // registered hydro/road/pad coverage remains fail-closed.
    for (name, x, z) in [
        ("strait119.5E24.5N", -58279.366605, -47193.972123),
        ("southSea120.3E21.7N", 23289.155486, 262995.483014),
        ("eastSea122.2E24.0N", 216214.357020, 6672.710057),
    ] {
        assert_eq!(
            w.ground.water_level(x, z),
            Some(0.0),
            "{name}: independent strategic ocean polygon, not height==0 inference"
        );
        assert!(
            !w.ground.ground_navigation_allowed(x, z),
            "{name}: full world extent cannot become a cross-water tank route"
        );
    }
    for (name, x, z) in [
        ("taiwanLand120.7E23.8N", 63692.790417, 30317.057057),
        ("mainlandLand118E25.3N", -208967.809105, -137259.534867),
    ] {
        assert_eq!(
            w.ground.water_level(x, z),
            None,
            "{name}: land holes must survive the global water index"
        );
        assert!(
            !w.ground.ground_navigation_allowed(x, z),
            "Unregistered land is also closed to this native ground slice"
        );
    }
    let mut spawned = 0;
    for stage in m["staging"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|s| s["enabled"] == true)
    {
        for slot in stage["spawnSlots"].as_array().unwrap() {
            spawned += 1;
            w.spawn_unit(
                spawned,
                "su_t72a",
                stage["team"].as_u64().unwrap() as u8,
                point(&slot["pos"]),
                slot["yawRad"].as_f64().unwrap(),
            )
            .unwrap_or_else(|e| panic!("{} slot{}: {e}", stage["id"], slot["index"]));
            assert!(outline_supported(&w, spawned));
        }
    }
    assert_eq!(spawned, 60);
    assert_eq!(w.snapshots().len(), 60);
    eprintln!("Taiwan native129 source-height probes and60 actual nonoverlapping full-outline source spawns passed; map={MAP_SHA}");
}

#[test]
fn taiwan_actual_twelve_uphill_samples_use_native_powertrain_and_map_contacts() {
    let m = load_map();
    let mut w = SimWorld::load(&data(), &m).unwrap();
    let mut checked = 0;
    for (i, case) in load_cases()
        .iter()
        .enumerate()
        .filter(|(_, c)| c["kind"] == "slope")
    {
        let (mut a, mut b) = (point(&case["start"]), point(&case["end"]));
        if a[1] > b[1] {
            std::mem::swap(&mut a, &mut b);
        }
        assert!(b[1] > a[1], "Actual source uphill case must rise");
        let heading = (b[0] - a[0]).atan2(b[2] - a[2]);
        let id = i as u64 + 1;
        w.spawn_unit(id, "su_t72a", 0, a, heading)
            .unwrap_or_else(|e| {
                panic!(
                    "{} native uphill spawn rejected at {a:?}, heading={heading}: {e}",
                    case["id"]
                )
            });
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
            "{} actual uphill native progress {gain}: {:?}->{:?}",
            case["id"],
            before.pos,
            after.pos
        );
        assert_eq!(after.ammo, before.ammo);
        eprintln!(
            "{} grade={} actualXZGain={gain}",
            case["id"], case["gradePercent"]
        );
        checked += 1;
        w.remove_unit(id);
    }
    assert_eq!(checked, 12);
}

#[test]
fn taiwan_actual_twelve_registered_tight_turns_use_production_native_driver() {
    let m = load_map();
    let mut w = SimWorld::load(&data(), &m).unwrap();
    let mut checked = 0;
    for (i, case) in load_cases()
        .iter()
        .enumerate()
        .filter(|(_, c)| c["kind"] == "turn")
    {
        let (a, b, c) = (
            point(&case["approach"]),
            point(&case["corner"]),
            point(&case["departure"]),
        );
        let heading = (b[0] - a[0]).atan2(b[2] - a[2]);
        let id = i as u64 + 1;
        w.spawn_unit(id, "su_t72a", 0, a, heading)
            .unwrap_or_else(|e| {
                panic!(
                    "{} native turn spawn rejected at {a:?}, heading={heading}: {e}",
                    case["id"]
                )
            });
        advance(&mut w, 0.3);
        drive_registered(
            &mut w,
            &m,
            id,
            case["roadId"].as_str().unwrap(),
            a,
            c,
            30.0,
            false,
        );
        checked += 1;
        eprintln!(
            "{} actual native turn={}degrees passed",
            case["id"], case["turnDegrees"]
        );
        w.remove_unit(id);
    }
    assert_eq!(checked, 12);
}

#[test]
fn taiwan_actual_three_wet_deck_samples_support_full_native_outline_while_driving() {
    let m = load_map();
    let mut w = SimWorld::load(&data(), &m).unwrap();
    let mut checked = 0;
    for (i, case) in load_cases()
        .iter()
        .enumerate()
        .filter(|(_, c)| c["kind"] == "wet_bridge")
    {
        let road = case["roadId"].as_str().unwrap();
        let points = road_points(&m, road);
        let selected = wet_deck_sample(&w, case);
        let (station, gap) = road_station(&points, selected);
        assert!(
            gap < 0.01,
            "Actual wet deck must lie on its registered source path"
        );
        let length: f64 = points.windows(2).map(|p| horizontal(p[0], p[1])).sum();
        let a = point_at(&w, &points, (station - 35.0).max(0.0));
        let b = point_at(&w, &points, (station - 30.0).max(0.0));
        let end = point_at(&w, &points, (station + 35.0).min(length));
        let id = i as u64 + 1;
        w.spawn_unit(id, "su_t72a", 0, a, (b[0] - a[0]).atan2(b[2] - a[2]))
            .unwrap();
        advance(&mut w, 0.3);
        let frames = drive_registered(&mut w, &m, id, road, a, end, 45.0, true);
        assert!(
            frames > 0,
            "{} must actually support wet hull/track probes, not only a bridge label",
            case["id"]
        );
        eprintln!("{} sampled70m actual native deck drive; wetFrames={frames}; selectedWetPointOffsetFromRepresentative={}m", case["id"], horizontal(selected, point(&case["point"])));
        checked += 1;
        w.remove_unit(id);
    }
    assert_eq!(checked, 3);
}

#[test]
fn taiwan_real_wet_tracks_are_rejected_even_with_dry_centre_when_decks_are_removed() {
    let m = load_map();
    let mut positive = SimWorld::load(&data(), &m).unwrap();
    let mut without_decks = m.clone();
    without_decks["terrain"]["bridges"] = json!([]);
    let mut negative = SimWorld::load(&data(), &without_decks).unwrap();
    let mut found = None;
    'cases: for case in load_cases().iter().filter(|c| c["kind"] == "wet_bridge") {
        let road = road_points(&m, case["roadId"].as_str().unwrap());
        let middle = wet_deck_sample(&positive, case);
        let (station, _) = road_station(&road, middle);
        for offset in -30..=30 {
            let p = point_at(&positive, &road, (station + offset as f64 * 2.0).max(0.0));
            if wet(&positive, p[0], p[2]) || !negative.ground.ground_navigation_allowed(p[0], p[2])
            {
                continue;
            }
            let next = point_at(&positive, &road, station + offset as f64 * 2.0 + 1.0);
            let heading = (next[0] - p[0]).atan2(next[2] - p[2]);
            if positive.spawn_unit(1, "su_t72a", 0, p, heading).is_err() {
                continue;
            }
            if outline_wet(&positive, 1) && outline_supported(&positive, 1) {
                found = Some((p, heading));
                break 'cases;
            }
            positive.remove_unit(1);
        }
    }
    let (p, heading) = found.expect(
        "Actual registered Taiwan crossing must expose a dry-centre/wet-native-outline case",
    );
    assert!(
        negative.ground.ground_navigation_allowed(p[0], p[2]),
        "Dry centre alone is allowed"
    );
    assert!(negative.spawn_unit(1, "su_t72a", 0, p, heading).is_err(), "Original native hull/track footprint must reject unsupported water even though centre is dry");
    assert!(negative.snapshots().is_empty());
    assert!(outline_wet(&positive, 1) && outline_supported(&positive, 1));
    eprintln!("Taiwan original terrain/roadbeds unchanged: registered deck supports real wet native outline; removing only deck registration rejects dry-centre spawn");
}
