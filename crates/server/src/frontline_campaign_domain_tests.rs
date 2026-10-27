//! Campaign rules exercised through the actual Hub/native battle, not widget bars.
use super::*;
use crate::flight_runtime::FlightSpawn;

#[test]
fn native_ground_occupation_changes_shared_ownership_readiness_and_time_winner() {
    let data = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let mut hub = FrontlineHub::new(&data).unwrap();
    hub.use_c2_test_scene().unwrap();
    let ok = |messages: Vec<(u32, Update)>| {
        assert!(
            !messages
                .iter()
                .any(|(_, m)| matches!(m, Update::Error { .. })),
            "{messages:?}"
        )
    };
    ok(hub.handle(
        1,
        Command::Create {
            name: "Native campaign authority".into(),
            map: "korea".into(),
            observer: true,
            era: 1986,
        },
        0.0,
    ));
    ok(hub.handle(1, Command::Start, 0.0));
    {
        let room = hub.rooms.get_mut(&1).unwrap();
        // Accepted native crew-loss fixture removes ground occupation; an actual
        // live aircraft crossing the same objective must not capture land.
        for id in room.units.keys().copied().collect::<Vec<_>>() {
            room.sim.destroy_unit_for_frontline_test(id);
        }
        let p = room.objectives[0].pos;
        let aircraft = room
            .air
            .views()
            .into_iter()
            .find(|a| a.team == Team::Blue)
            .unwrap()
            .unit;
        room.air.test_spawn_at(
            aircraft.unit,
            FlightSpawn {
                position: [p[0] as f32, p[1] as f32 + 10.0, p[2] as f32],
                heading: 0.0,
                airspeed: 0.0,
                on_ground: false,
            },
        );
    }
    hub.tick(0.1);
    assert!(hub.rooms[&1]
        .air
        .views()
        .iter()
        .any(|a| a.team == Team::Blue && a.alive));
    assert_eq!(hub.rooms[&1].objectives[0].progress, 0.0);
    assert_eq!(hub.rooms[&1].objectives[0].presence, [0, 0]);
    ok(hub.handle(
        2,
        Command::Join {
            room: 1,
            observer: false,
            team: Some(Team::Blue),
        },
        0.1,
    ));
    ok(hub.handle(
        2,
        Command::Deploy {
            vehicle: "su_t72a".into(),
        },
        0.1,
    ));
    let company = hub.rooms[&1].members[&2].view.company.unwrap();
    let controlled = hub.rooms[&1].members[&2].view.controlled.unwrap();
    let pos = hub.rooms[&1].sim.snapshot(controlled.unit).unwrap().pos;
    {
        // The policy zone is authored over actual, already spawned native tanks
        // for this fixture. No vehicle body, inventory or damage is teleported.
        let o = &mut hub.rooms.get_mut(&1).unwrap().objectives[0];
        o.pos = pos;
        o.radius = 80.0;
    }
    ok(hub.handle(
        2,
        Command::Order {
            company,
            platoons: vec![0, 1, 2],
            kind: OrderKind::Defend,
            target: [pos[0], pos[2]],
            seq: 1,
        },
        0.1,
    ));
    let red_before = hub.rooms[&1].readiness[1];
    let mut captured = false;
    let mut pressure = false;
    for i in 3..=850 {
        for (_, update) in hub.tick(i as f64 * STEP + 1e-8) {
            if let Update::Frame {
                objectives, events, ..
            } = update
            {
                captured |= objectives.iter().any(|o| {
                    o.owner == Some(Team::Blue)
                        && o.progress == 1.0
                        && o.presence[0] > 0
                        && o.supplied[0]
                });
                pressure |= events.iter().any(|e| {
                    e["kind"] == "frontline_pressure"
                        && e["readiness_cost"][1].as_u64().is_some_and(|v| v > 0)
                });
            }
        }
    }
    assert!(
        captured,
        "actual ground bodies must capture through Room.step"
    );
    assert!(
        pressure && hub.rooms[&1].readiness[1] < red_before,
        "actual owned point must affect accepted team readiness"
    );
    let room = hub.rooms.get_mut(&1).unwrap();
    assert_eq!(room.companies[&company].view.units.len(), 10);
    // Equal-ticket terminal fixture verifies that retained territory decides an
    // otherwise tied time result. It is not a45-minute performance simulation.
    room.readiness = [1000, 1000];
    // Trusted short deadline AFTER the physical capture case, not a fake
    // 45-minute wall jump: the following accepted native tick ends this fixture.
    room.round_seconds = room.sim.time() + STEP / 2.0;
    let end_at = room.last_step + STEP + 1e-8;
    let ended = hub.tick(end_at);
    assert!(ended.iter().any(
        |(_, m)| matches!(m,Update::Ended{winner:Some(Team::Blue),reason,..} if reason=="time")
    ));
}
