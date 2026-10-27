//! Rule fixtures, not certification of a complete three-lane physical theatre.
use super::*;

const BLUE_REAR: &str = "B-C2-TEST";
const CENTRE: &str = "C2";
const RED_REAR: &str = "R-C2-TEST";
const DT: f64 = 0.25;

fn objective(
    id: &str,
    pos: [f64; 3],
    owner: Option<Team>,
    lane: &str,
    radius: f64,
) -> ObjectiveView {
    ObjectiveView {
        id: id.into(),
        name: id.into(),
        pos,
        radius,
        owner,
        progress: match owner {
            Some(Team::Blue) => 1.0,
            Some(Team::Red) => -1.0,
            None => 0.0,
        },
        lane: lane.into(),
        capturable: [false; 2],
        supplied: [false; 2],
        contested: false,
        presence: [0; 2],
        presence_visible: [true; 2],
    }
}

fn point(v: &Value) -> [f64; 3] {
    serde_json::from_value(v.clone()).unwrap()
}

fn fixture() -> (Value, Vec<ObjectiveView>) {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/frontline/korea.json");
    let source: Value = crate::frontline::c2_fixture_map(
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap(),
    )
    .unwrap();
    let road = source["roads"]
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == "centre:C2-local-test")
        .unwrap();
    assert_eq!(road["navEnabled"], true);
    assert_eq!(road["connected"], true);
    let staging = source["staging"].as_array().unwrap();
    let blue = staging.iter().find(|s| s["id"] == BLUE_REAR).unwrap();
    let red = staging.iter().find(|s| s["id"] == RED_REAR).unwrap();
    let middle = source["objectives"]
        .as_array()
        .unwrap()
        .iter()
        .find(|o| o["id"] == CENTRE)
        .unwrap();
    let geometry = road["points"].as_array().unwrap();
    let centre = point(&middle["pos"]);
    let split = (0..geometry.len())
        .min_by(|&a, &b| {
            let a = point(&geometry[a]);
            let b = point(&geometry[b]);
            (a[0] - centre[0])
                .hypot(a[2] - centre[2])
                .total_cmp(&(b[0] - centre[0]).hypot(b[2] - centre[2]))
        })
        .unwrap();
    assert!(split > 0 && split + 1 < geometry.len());
    // Only split the existing connected/enabled C2 corridor. No disabled west,
    // centre or east source road is promoted into an invented physical route.
    let map = json!({"objectives":[{"id":BLUE_REAR,"lane":"centre"},{"id":CENTRE,"lane":"centre"},{"id":RED_REAR,"lane":"centre"}],
        "roads":[
            {"id":"c2-blue","from":BLUE_REAR,"to":CENTRE,"connected":road["connected"],"navEnabled":road["navEnabled"],"sourceRoad":road["id"],"points":geometry[..=split]},
            {"id":"c2-red","from":CENTRE,"to":RED_REAR,"connected":road["connected"],"navEnabled":road["navEnabled"],"sourceRoad":road["id"],"points":geometry[split..]}],
        "campaign":{"supplyEntrypoints":[[BLUE_REAR],[RED_REAR]],"terminalObjectives":[[RED_REAR],[BLUE_REAR]],"captureSeconds":30,"pressureTicketSeconds":10}});
    let radius = middle["radius"].as_f64().unwrap();
    let points = vec![
        objective(
            BLUE_REAR,
            point(&blue["pos"]),
            Some(Team::Blue),
            "centre",
            radius,
        ),
        objective(CENTRE, centre, None, "centre", radius),
        objective(
            RED_REAR,
            point(&red["pos"]),
            Some(Team::Red),
            "centre",
            radius,
        ),
    ];
    (map, points)
}

fn at<'a>(points: &'a [ObjectiveView], id: &str) -> &'a ObjectiveView {
    points.iter().find(|p| p.id == id).unwrap()
}
fn presence(points: &[ObjectiveView], id: &str, team: Team, alive: bool) -> Presence {
    Presence {
        team,
        pos: at(points, id).pos,
        alive,
    }
}
fn run(
    c: &mut Campaign,
    points: &mut [ObjectiveView],
    bodies: &[Presence],
    ticks: usize,
) -> CampaignOutcome {
    let mut total = CampaignOutcome::default();
    for _ in 0..ticks {
        let out = c.step(points, bodies, DT);
        for side in 0..2 {
            total.readiness_cost[side] += out.readiness_cost[side];
        }
        total.events.extend(out.events);
    }
    total
}
fn occupy(
    c: &mut Campaign,
    points: &mut [ObjectiveView],
    id: &str,
    team: Team,
    ticks: usize,
) -> CampaignOutcome {
    let body = presence(points, id, team, true);
    run(c, points, &[body], ticks)
}

#[test]
fn navigation_keeps_the_registered_detour_and_ordered_cursor() {
    // Deliberate rule geometry: the destination is nearby across an unregistered
    // interior. A valid route must retain both bends, not draw the chord.
    let map = json!({"roads":[
        {"id":"a","from":"A","to":"B","lane":"west","halfWidth":8,"connected":true,"navEnabled":true,"points":[[0,0,0],[0,0,100],[100,0,100]]},
        {"id":"b","from":"B","to":"C","lane":"west","halfWidth":8,"connected":true,"navEnabled":true,"points":[[100,0,100],[200,0,100],[200,0,0]]}
    ]});
    let nav = Navigation::load(&map).unwrap();
    let mut plan = nav.plan([0.0, 0.0], [200.0, 0.0], Some("a")).unwrap();
    assert_eq!(plan.roads, vec!["a", "b"]);
    assert_eq!(plan.front, "west");
    assert!((plan.length() - 400.0).abs() < 1e-6);
    assert!(plan.points.contains(&[0.0, 100.0]));
    assert!(plan.points.contains(&[200.0, 100.0]));
    assert_eq!(plan.waypoint([0.0, 0.0, 0.0]), [0.0, 100.0]);
    assert_eq!(plan.waypoint([0.0, 0.0, 99.0]), [100.0, 100.0]);
    assert_eq!(plan.point_after(150.0), [50.0, 100.0]);
    let mut rounded = nav.plan([0.0, 0.0], [200.0, 0.0], Some("a")).unwrap();
    rounded.waypoint([0.0, 0.0, 0.0]);
    assert_eq!(
        rounded.waypoint([5.0, 0.0, 99.0]),
        [100.0, 100.0],
        "Passing the bend on its registered core must not request a reverse to the vertex"
    );
}

#[test]
fn navigation_does_not_join_nearby_or_cross_front_roads_without_connector() {
    let mut map = json!({"roads":[
        {"id":"west","from":"W0","to":"W1","lane":"west","connected":true,"navEnabled":true,"points":[[0,0,0],[100,0,0]]},
        {"id":"east","from":"E0","to":"E1","lane":"east","connected":true,"navEnabled":true,"points":[[0,0,3],[100,0,3]]}
    ]});
    assert!(Navigation::load(&map)
        .unwrap()
        .plan([0.0, 0.0], [100.0, 3.0], Some("west"))
        .is_none());
    map["roads"].as_array_mut().unwrap().push(json!({"id":"registered-connector","from":"W1","to":"E1","lane":"connector","connected":true,"navEnabled":true,"points":[[100,0,0],[100,0,3]]}));
    let plan = Navigation::load(&map)
        .unwrap()
        .plan([0.0, 0.0], [100.0, 3.0], Some("west"))
        .unwrap();
    assert!(plan.roads.contains(&"registered-connector".into()));
    assert_eq!(plan.front, "east");
}

#[test]
fn navigation_rejects_missing_physical_geometry_and_false_junctions() {
    let missing =
        json!({"roads":[{"id":"a","from":"A","to":"B","connected":true,"navEnabled":true}]});
    assert!(Navigation::load(&missing).is_err());
    let mut gap = json!({"roads":[
        {"id":"a","from":"A","to":"B","connected":true,"navEnabled":true,"points":[[0,0,0],[100,0,0]]},
        {"id":"b","from":"B","to":"C","connected":true,"navEnabled":true,"points":[[110,0,0],[200,0,0]]}
    ]});
    assert!(Navigation::load(&gap).is_err());
    gap["roads"][1]["navEnabled"] = json!(false);
    let nav = Navigation::load(&gap).unwrap();
    assert!(nav.plan([0.0, 0.0], [200.0, 0.0], None).is_none());
    assert!(
        nav.plan([0.0, 30.0], [100.0, 0.0], None).is_none(),
        "An off-road source is not silently snapped across unregistered terrain"
    );
}

#[test]
fn closed_route_cuts_native_navigation_as_well_as_supply() {
    let (map, mut points) = fixture();
    let mut campaign = Campaign::load(&map, &mut points).unwrap();
    let blue = at(&points, BLUE_REAR).pos;
    let red = at(&points, RED_REAR).pos;
    let plan = campaign.plan_route(blue, [red[0], red[2]], None).unwrap();
    assert!(campaign.plan_open(&plan));
    campaign.close_route("c2-blue", &mut points).unwrap();
    assert!(!campaign.plan_open(&plan));
    assert!(campaign.plan_route(blue, [red[0], red[2]], None).is_none());
    assert!(!at(&points, CENTRE).capturable[0]);
}

#[test]
fn repaired_facility_cannot_reopen_an_independent_route_closure() {
    let (map, mut points) = fixture();
    let mut campaign = Campaign::load(&map, &mut points).unwrap();
    campaign
        .set_facility_route_open("c2-blue", false, &mut points)
        .unwrap();
    assert!(!campaign.route_open("c2-blue"));
    campaign.close_route("c2-blue", &mut points).unwrap();
    campaign
        .set_facility_route_open("c2-blue", true, &mut points)
        .unwrap();
    assert!(!campaign.route_open("c2-blue"));
    campaign
        .set_route_open("c2-blue", true, &mut points)
        .unwrap();
    assert!(campaign.route_open("c2-blue"));
    campaign
        .set_facility_route_open("c2-blue", false, &mut points)
        .unwrap();
    campaign
        .set_route_open("c2-blue", true, &mut points)
        .unwrap();
    assert!(!campaign.route_open("c2-blue"));
}

#[test]
fn actual_enabled_corridor_graph_grants_only_the_next_supplied_objective() {
    let (map, mut points) = fixture();
    let mut c = Campaign::load(&map, &mut points).unwrap();
    assert!(at(&points, BLUE_REAR).supplied[0]);
    assert!(at(&points, RED_REAR).supplied[1]);
    assert_eq!(at(&points, CENTRE).capturable, [true, true]);
    assert!(!at(&points, RED_REAR).capturable[0]);
    assert_eq!(
        c.target(&points, Team::Blue),
        Some([at(&points, CENTRE).pos[0], at(&points, CENTRE).pos[2]])
    );
    let previous = at(&points, RED_REAR).clone();
    occupy(&mut c, &mut points, RED_REAR, Team::Blue, 160);
    assert_eq!(at(&points, RED_REAR).owner, previous.owner);
    assert_eq!(
        at(&points, RED_REAR).progress,
        previous.progress,
        "garrison cannot skip an unowned supply neighbour"
    );
    occupy(&mut c, &mut points, CENTRE, Team::Blue, 120);
    assert_eq!(at(&points, CENTRE).owner, Some(Team::Blue));
    assert!(at(&points, CENTRE).supplied[0]);
    assert!(at(&points, RED_REAR).capturable[0]);
    assert_eq!(
        c.target(&points, Team::Blue),
        Some([at(&points, RED_REAR).pos[0], at(&points, RED_REAR).pos[2]])
    );
}

#[test]
fn contested_and_dead_ground_presences_do_not_capture_and_bonus_saturates_at_three() {
    let (map, mut points) = fixture();
    let mut c = Campaign::load(&map, &mut points).unwrap();
    // Presence is the accepted-ground-body input. Actual AirUnitView exclusion
    // belongs to the Room adapter test; this rule fixture creates no aircraft.
    let blue = presence(&points, CENTRE, Team::Blue, true);
    let red = presence(&points, CENTRE, Team::Red, true);
    let out = run(&mut c, &mut points, &[blue, red], 160);
    assert_eq!(at(&points, CENTRE).presence, [1, 1]);
    assert!(at(&points, CENTRE).contested);
    assert_eq!(at(&points, CENTRE).progress, 0.0);
    assert_eq!(out.readiness_cost, [0, 0]);
    let dead = presence(&points, CENTRE, Team::Blue, false);
    run(&mut c, &mut points, &[dead], 160);
    assert_eq!(at(&points, CENTRE).presence, [0, 0]);
    assert_eq!(at(&points, CENTRE).owner, None);
    let mut progress = Vec::new();
    for count in [1usize, 3, 30] {
        let (map, mut p) = fixture();
        let mut campaign = Campaign::load(&map, &mut p).unwrap();
        let bodies = vec![presence(&p, CENTRE, Team::Blue, true); count];
        run(&mut campaign, &mut p, &bodies, 4);
        assert_eq!(
            at(&p, CENTRE).owner,
            None,
            "one second never instantly captures"
        );
        progress.push(at(&p, CENTRE).progress);
    }
    assert!((progress[0] - 1.0 / 30.0).abs() < 1e-12);
    assert!((progress[1] - progress[0] * 1.5).abs() < 1e-12);
    assert_eq!(
        progress[1], progress[2],
        "extra bodies above three cannot multiply capture speed"
    );
}

#[test]
fn hostile_occupation_retains_owner_until_neutral_then_requires_the_second_capture_half() {
    let (map, mut points) = fixture();
    let middle = points.iter_mut().find(|p| p.id == CENTRE).unwrap();
    middle.owner = Some(Team::Blue);
    middle.progress = 1.0;
    let mut c = Campaign::load(&map, &mut points).unwrap();
    let half = occupy(&mut c, &mut points, CENTRE, Team::Red, 60);
    assert_eq!(at(&points, CENTRE).owner, Some(Team::Blue));
    assert!((at(&points, CENTRE).progress - 0.5).abs() < 1e-12);
    assert!(half
        .events
        .iter()
        .all(|e| e["kind"] != "objective_owner_changed"));
    let neutral = occupy(&mut c, &mut points, CENTRE, Team::Red, 60);
    assert_eq!(
        at(&points, CENTRE).owner,
        None,
        "thirty actual seconds neutralises, including normal f64 accumulation error"
    );
    assert!(at(&points, CENTRE).progress.abs() < 1e-9);
    assert_eq!(
        neutral
            .events
            .iter()
            .filter(|e| e["kind"] == "objective_owner_changed")
            .count(),
        1
    );
    occupy(&mut c, &mut points, CENTRE, Team::Red, 119);
    assert_eq!(at(&points, CENTRE).owner, None);
    let captured = occupy(&mut c, &mut points, CENTRE, Team::Red, 1);
    assert_eq!(at(&points, CENTRE).owner, Some(Team::Red));
    assert_eq!(at(&points, CENTRE).progress, -1.0);
    assert_eq!(
        captured
            .events
            .iter()
            .filter(|e| e["kind"] == "objective_owner_changed")
            .count(),
        1
    );
}

#[test]
fn disabled_or_closed_registered_routes_cut_capture_and_pressure_without_erasing_the_garrison() {
    let (mut disabled, mut p) = fixture();
    disabled["roads"][0]["navEnabled"] = json!(false);
    let mut withheld = Campaign::load(&disabled, &mut p).unwrap();
    assert!(!at(&p, CENTRE).capturable[0]);
    let out = occupy(&mut withheld, &mut p, CENTRE, Team::Blue, 160);
    assert_eq!(at(&p, CENTRE).progress, 0.0);
    assert_eq!(out.readiness_cost, [0, 0]);
    let (map, mut points) = fixture();
    let mut c = Campaign::load(&map, &mut points).unwrap();
    occupy(&mut c, &mut points, CENTRE, Team::Blue, 120);
    occupy(&mut c, &mut points, RED_REAR, Team::Blue, 20);
    let hostile_progress = at(&points, RED_REAR).progress;
    assert!(hostile_progress > -1.0 && hostile_progress < 0.0);
    c.close_route("c2-blue", &mut points).unwrap();
    assert_eq!(at(&points, CENTRE).owner, Some(Team::Blue));
    assert!(!at(&points, CENTRE).supplied[0]);
    assert!(!at(&points, RED_REAR).capturable[0]);
    let out = occupy(&mut c, &mut points, RED_REAR, Team::Blue, 160);
    assert_eq!(
        at(&points, RED_REAR).progress,
        hostile_progress,
        "existing forward bodies cannot advance an isolated front"
    );
    assert_eq!(
        out.readiness_cost,
        [0, 0],
        "isolated captured point cannot create ticket pressure"
    );
    let before = points.clone();
    assert!(c.close_route("unregistered-shortcut", &mut points).is_err());
    assert_eq!(points, before);
}

#[test]
fn pressure_is_earned_by_supplied_new_capture_and_invalid_or_zero_time_cannot_mint_tickets() {
    let (map, mut points) = fixture();
    let mut c = Campaign::load(&map, &mut points).unwrap();
    let rear = [
        presence(&points, BLUE_REAR, Team::Blue, true),
        presence(&points, RED_REAR, Team::Red, true),
    ];
    assert_eq!(
        run(&mut c, &mut points, &rear, 160).readiness_cost,
        [0, 0],
        "initial friendly rear ownership has no earned pressure"
    );
    let captured = occupy(&mut c, &mut points, CENTRE, Team::Blue, 120);
    assert_eq!(captured.readiness_cost, [0, 0]);
    assert_eq!(
        occupy(&mut c, &mut points, CENTRE, Team::Blue, 36).readiness_cost,
        [0, 0],
        "nine seconds cannot grant an immediate ticket"
    );
    let earned = occupy(&mut c, &mut points, CENTRE, Team::Blue, 8);
    assert_eq!(earned.readiness_cost[0], 0);
    assert_eq!(
        earned.readiness_cost[1], 1,
        "accumulated pressure reaches one ten-second ticket"
    );
    let owned = points
        .iter()
        .map(|p| (p.owner, p.progress))
        .collect::<Vec<_>>();
    for dt in [0.0, f64::NAN, f64::INFINITY, -0.1, 1.0, 86_400.0] {
        for _ in 0..20 {
            let out = c.step(&mut points, &[], dt);
            assert_eq!(out.readiness_cost, [0, 0]);
            assert!(out.events.is_empty());
        }
    }
    assert_eq!(
        points
            .iter()
            .map(|p| (p.owner, p.progress))
            .collect::<Vec<_>>(),
        owned
    );
    // Isolate enemy-point pressure from the earlier neutral-point pressure:
    // this separate campaign starts with its middle already friendly-owned.
    let (map, mut enemy_points) = fixture();
    let middle = enemy_points.iter_mut().find(|p| p.id == CENTRE).unwrap();
    middle.owner = Some(Team::Blue);
    middle.progress = 1.0;
    let mut enemy_campaign = Campaign::load(&map, &mut enemy_points).unwrap();
    assert_eq!(
        occupy(
            &mut enemy_campaign,
            &mut enemy_points,
            RED_REAR,
            Team::Blue,
            240
        )
        .readiness_cost,
        [0, 0]
    );
    let enemy = occupy(
        &mut enemy_campaign,
        &mut enemy_points,
        RED_REAR,
        Team::Blue,
        40,
    );
    assert_eq!(enemy.readiness_cost[0], 0);
    assert!(enemy.readiness_cost[1] > 0);
}

#[test]
fn terminal_and_time_decisions_are_symmetric_including_simultaneous_terminal_claims() {
    for (attacker, target) in [(Team::Blue, RED_REAR), (Team::Red, BLUE_REAR)] {
        let (map, mut points) = fixture();
        let mut c = Campaign::load(&map, &mut points).unwrap();
        assert_eq!(c.terminal_winner(&points), None);
        assert_eq!(c.tiebreak(&points), None);
        occupy(&mut c, &mut points, CENTRE, attacker, 120);
        occupy(&mut c, &mut points, target, attacker, 240);
        assert_eq!(c.terminal_winner(&points), Some(attacker));
        assert_eq!(c.tiebreak(&points), Some(attacker));
        points.reverse();
        assert_eq!(c.terminal_winner(&points), Some(attacker));
    }
    // A logical two-lane rule fixture, not another enabled geographic road.
    // Opposite advances can finish on the same fixed tick; vector order or the
    // Blue enum position must not select a winner from an exact symmetric tie.
    let mut points = vec![
        objective("A", [0.0, 0.0, 0.0], Some(Team::Blue), "left", 10.0),
        objective("B", [100.0, 0.0, 0.0], None, "left", 10.0),
        objective("C", [200.0, 0.0, 0.0], Some(Team::Red), "left", 10.0),
        objective("D", [0.0, 0.0, 100.0], Some(Team::Blue), "right", 10.0),
        objective("E", [100.0, 0.0, 100.0], None, "right", 10.0),
        objective("F", [200.0, 0.0, 100.0], Some(Team::Red), "right", 10.0),
    ];
    let map = json!({"objectives":points.iter().map(|p|json!({"id":p.id,"lane":p.lane})).collect::<Vec<_>>(),
        "roads":[{"id":"ab","from":"A","to":"B","connected":true,"navEnabled":true,"points":[[0,0,0],[100,0,0]]},{"id":"bc","from":"B","to":"C","connected":true,"navEnabled":true,"points":[[100,0,0],[200,0,0]]},{"id":"de","from":"D","to":"E","connected":true,"navEnabled":true,"points":[[0,0,100],[100,0,100]]},{"id":"ef","from":"E","to":"F","connected":true,"navEnabled":true,"points":[[100,0,100],[200,0,100]]}],
        "campaign":{"supplyEntrypoints":[["A","D"],["C","F"]],"terminalObjectives":[["F"],["A"]],"captureSeconds":30,"pressureTicketSeconds":10}});
    let mut c = Campaign::load(&map, &mut points).unwrap();
    let bodies = [
        presence(&points, "B", Team::Red, true),
        presence(&points, "E", Team::Blue, true),
    ];
    run(&mut c, &mut points, &bodies, 120);
    let bodies = [
        presence(&points, "A", Team::Red, true),
        presence(&points, "F", Team::Blue, true),
    ];
    run(&mut c, &mut points, &bodies, 240);
    assert_eq!(at(&points, "A").owner, Some(Team::Red));
    assert!(at(&points, "A").supplied[1]);
    assert_eq!(at(&points, "F").owner, Some(Team::Blue));
    assert!(at(&points, "F").supplied[0]);
    assert_eq!(
        c.terminal_winner(&points),
        None,
        "simultaneous terminal claims cannot silently prefer Blue"
    );
    assert_eq!(c.tiebreak(&points), None);
    points.reverse();
    assert_eq!(c.terminal_winner(&points), None);
}
