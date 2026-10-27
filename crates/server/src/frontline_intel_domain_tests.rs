//! Real Hub audience paths. C2 is an explicit bounded physical fixture;
//! production map/front counts are checked separately by registry tests.
use super::*;
use crate::frontline_perception::OpticalRanges;

fn data() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")
}
fn accepted(out: &[(u32, Update)]) {
    assert!(
        !out.iter().any(|(_, u)| matches!(u, Update::Error { .. })),
        "{out:?}"
    );
}
fn setup(ranges: f64, scan: f64) -> (FrontlineHub, u32) {
    let mut hub = FrontlineHub::new(&data()).unwrap();
    hub.use_c2_test_scene().unwrap();
    accepted(&hub.handle(
        1,
        Command::Create {
            name: "Audience native fixture".into(),
            map: "korea".into(),
            observer: true,
            era: 1986,
        },
        0.0,
    ));
    let id = hub.membership[&1];
    for (player, team) in [(2, Team::Blue), (3, Team::Red)] {
        accepted(&hub.handle(
            player,
            Command::Join {
                room: id,
                observer: false,
                team: Some(team),
            },
            0.0,
        ));
    }
    accepted(&hub.handle(1, Command::Start, 0.0));
    let room = hub.rooms.get_mut(&id).unwrap();
    room.perception = PerceptionWorld::new(
        room.battle,
        PerceptionConfig {
            scan_period_s: scan,
            last_known_s: 30.0,
            optical: OpticalRanges {
                ground_to_ground: ranges,
                ground_to_air: ranges,
                air_to_ground: ranges,
                air_to_air: ranges,
            },
        },
    )
    .unwrap();
    (hub, id)
}
fn snapshot(hub: &FrontlineHub, player: u32) -> Value {
    serde_json::to_value(hub.snapshot_for(player).unwrap()).unwrap()
}
fn assert_team(value: &Value, team: Team) {
    for key in ["units", "companies", "aircrafts"] {
        assert!(
            value[key]
                .as_array()
                .unwrap()
                .iter()
                .all(|u| u["team"] == json!(team)),
            "{key}: {value}"
        );
    }
    let intel = &value["intel"];
    assert!(intel["visible_ground"].as_array().unwrap().is_empty());
    assert!(intel["visible_aircrafts"].as_array().unwrap().is_empty());
    assert!(intel["contacts"].as_array().unwrap().is_empty());
    for objective in value["objectives"].as_array().unwrap() {
        assert!(objective["presence"][1 - team.index()].is_null());
        assert!(objective["presence"][team.index()].is_u64());
    }
    for f in value["facilities"].as_array().unwrap() {
        if f["team"] != json!(team.index()) {
            for key in ["hp", "max_hp", "supplied"] {
                assert!(f.get(key).is_none(), "enemy/neutral facility {key}");
            }
            for key in ["fuel", "arming", "repair", "supply"] {
                assert!(f["capabilities"].get(key).is_none());
            }
        }
    }
    assert!(value["facility_jobs"]
        .as_array()
        .unwrap()
        .iter()
        .all(|j| j["team"] == json!(team.index())));
}

#[test]
fn actual_hub_all_team_paths_hide_unobserved_truth_and_readonly_reset_never_scans() {
    let (mut hub, id) = setup(0.0, 1.0);
    let frames = hub.tick(0.051);
    assert!(hub.rooms[&id].perception_error.is_none());
    for (player, team) in [(2, Team::Blue), (3, Team::Red)] {
        let frame = frames
            .iter()
            .find(|(players, u)| players.contains(&player) && matches!(u, Update::Frame { .. }))
            .unwrap();
        assert_team(&serde_json::to_value(&frame.1).unwrap(), team);
        assert_team(&snapshot(&hub, player), team);
        let command = hub.handle(player, Command::Snapshot, 0.051);
        accepted(&command);
        assert_team(&serde_json::to_value(&command[0].1).unwrap(), team);
    }
    let truth = snapshot(&hub, 1);
    assert_eq!(truth["units"].as_array().unwrap().len(), 20);
    assert_eq!(truth["aircrafts"].as_array().unwrap().len(), 2);
    assert!(truth.get("intel").is_none());
    assert!(truth["units"]
        .as_array()
        .unwrap()
        .iter()
        .all(|u| u.get("ammo").is_some() && u.get("damage").is_some()));
    assert!(!truth["facility_geometry_catalog"]
        .as_array()
        .unwrap()
        .is_empty());
    let native_frame = hub.rooms[&id].perception.frame().cloned();
    let clock = hub.rooms[&id].sim.time();
    let native = hub.rooms[&id].unit_views();
    for player in [2, 3] {
        for _ in 0..3 {
            let _ = hub.snapshot_for(player).unwrap();
        }
        let listed = hub.handle(player, Command::List, 0.052);
        for (_, u) in listed {
            if let Update::Rooms { rooms } = u {
                let r = rooms.iter().find(|r| r.id == id).unwrap();
                assert!(r
                    .staging
                    .iter()
                    .all(|s| s.team == hub.rooms[&id].members[&player].view.team));
                for m in &r.members {
                    if m.team != hub.rooms[&id].members[&player].view.team {
                        assert!(m.controlled.is_none() && m.company.is_none() && m.epoch == 0);
                    }
                }
            }
        }
        hub.disconnect(player, 0.053);
        let resumed = hub.resume(player, 0.054);
        assert!(resumed
            .iter()
            .any(|(_, u)| matches!(u, Update::Snapshot { .. })));
        for (_, u) in resumed {
            if matches!(u, Update::Snapshot { .. }) {
                assert_team(
                    &serde_json::to_value(u).unwrap(),
                    if player == 2 { Team::Blue } else { Team::Red },
                );
            }
        }
    }
    assert_eq!(hub.rooms[&id].perception.frame(), native_frame.as_ref());
    assert_eq!(hub.rooms[&id].sim.time().to_bits(), clock.to_bits());
    assert_eq!(hub.rooms[&id].unit_views(), native);
}

#[test]
fn actual_native_objective_counts_survive_projection_as_enemy_null() {
    let (mut hub, id) = setup(0.0, 1.0);
    // Explicit capture-zone fixture; actual native contacting bodies remain
    // the presence source. No synthetic presence/count/pose writes.
    hub.rooms.get_mut(&id).unwrap().objectives[0].radius = 2500.0;
    for i in 1..=8 {
        let _ = hub.tick(i as f64 * 0.051);
    }
    let counts = hub.rooms[&id].objectives[0].presence;
    assert!(
        counts[0] > 0 && counts[1] > 0,
        "native physical presence: {counts:?}"
    );
    let observer = snapshot(&hub, 1);
    assert_eq!(observer["objectives"][0]["presence"], json!(counts));
    for (player, team) in [(2, Team::Blue), (3, Team::Red)] {
        assert_team(&snapshot(&hub, player), team);
        assert_eq!(hub.rooms[&id].objectives[0].presence, counts);
    }
}

#[test]
fn actual_accepted_motion_does_not_refresh_public_pose_between_scans() {
    let (mut hub, id) = setup(1_000_000.0, 1.0);
    let _ = hub.tick(0.051);
    let room = &hub.rooms[&id];
    assert!(
        room.perception_error.is_none(),
        "{:?}",
        room.perception_error
    );
    let old = room.team_intel(Team::Blue);
    assert!(
        !old.visible_ground.is_empty() || !old.visible_aircrafts.is_empty(),
        "source native LOS must expose at least one real moving target"
    );
    let before_ground = room.unit_views();
    let before_air = room.air.views();
    let _ = hub.tick(0.102);
    let room = &hub.rooms[&id];
    assert!(!room.perception.frame().unwrap().scanned);
    let next = room.team_intel(Team::Blue);
    assert_eq!(next.visible_ground, old.visible_ground);
    assert_eq!(next.visible_aircrafts, old.visible_aircrafts);
    let after_ground = room.unit_views();
    let after_air = room.air.views();
    let moved = old.visible_ground.iter().any(|p| {
        before_ground.iter().find(|u| u.unit == p.unit).unwrap().pos
            != after_ground.iter().find(|u| u.unit == p.unit).unwrap().pos
    }) || old.visible_aircrafts.iter().any(|p| {
        before_air.iter().find(|u| u.unit == p.unit).unwrap().pos
            != after_air.iter().find(|u| u.unit == p.unit).unwrap().pos
    });
    assert!(
        moved,
        "freeze is meaningful only while accepted native truth moves"
    );
    let projected = snapshot(&hub, 2);
    let private = [
        "ammo",
        "ammo_revision",
        "damage",
        "caps",
        "resource_revision",
        "guns",
        "fuel",
        "company",
        "support_task",
    ];
    for key in ["visible_ground", "visible_aircrafts"] {
        for pose in projected["intel"][key].as_array().unwrap() {
            for field in private {
                assert!(pose.get(field).is_none(), "public {key}.{field}");
            }
        }
    }
}

#[test]
fn actual_native_shot_reports_are_whitelisted_and_hidden_for_unobserving_enemy() {
    let (mut hub, id) = setup(0.0, 1.0);
    let room = hub.rooms.get_mut(&id).unwrap();
    let shooter = room
        .units
        .values()
        .find(|u| u.team == Team::Blue)
        .unwrap()
        .reference;
    let native = room.sim.fire(shooter.unit, None).unwrap();
    let mut shot = room.event(serde_json::to_value(native).unwrap());
    // A metadata sentinel tests fail-closed projection. The shot/muzzle/ammo
    // admission above remains the real native weapon path.
    shot["private_report"] = json!({"armor":999,"crew":["secret"]});
    shot["detail"]["private_report"] = json!("never_public");
    let unknown =
        json!({"kind":"future_private_report","pos":[123,456,789],"damage":{"secret":true}});
    room.update_perception(
        &room.unit_views(),
        &room.air.views(),
        &[shot.clone(), unknown],
    );
    assert!(room.perception_error.is_none());
    let own = &room.perception_events[0];
    assert!(
        own.iter().any(|e| e["kind"] == "shot"),
        "actual owning-team shot should remain visible: {own:?}"
    );
    let serialized = serde_json::to_string(own).unwrap();
    assert!(
        !serialized.contains("private_report")
            && !serialized.contains("never_public")
            && !serialized.contains("future_private_report")
    );
    assert!(
        room.perception_events[1].is_empty(),
        "no enemy sensor within zero-range fixture"
    );
    assert!(
        shot.get("private_report").is_some(),
        "observer native truth is never destructively redacted"
    );
}
