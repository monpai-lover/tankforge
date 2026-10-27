//! Short native-duration rule fixtures, not a full45-minute endurance claim.
use super::*;
fn data() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")
}
fn accepted(out: &[(u32, Update)]) {
    assert!(
        !out.iter().any(|(_, u)| matches!(u, Update::Error { .. })),
        "{out:?}"
    );
}
fn setup(round: f64, intermission: f64) -> FrontlineHub {
    let mut h = FrontlineHub::new(&data()).unwrap();
    h.set_round_timing_for_test(round, intermission).unwrap();
    h.use_c2_test_scene().unwrap();
    accepted(&h.handle(
        1,
        Command::Create {
            name: "Native round fixture".into(),
            map: "korea".into(),
            era: 1986,
            observer: true,
        },
        0.0,
    ));
    for (id, team) in [(2, Team::Blue), (3, Team::Red)] {
        accepted(&h.handle(
            id,
            Command::Join {
                room: 1,
                observer: false,
                team: Some(team),
            },
            0.0,
        ));
    }
    accepted(&h.handle(1, Command::Start, 0.0));
    h
}
#[test]
fn huge_wall_jump_cannot_finish_a_live_native_battle_or_shorten_its_resources() {
    let mut h = setup(10.0, 0.2);
    let battle = h.rooms[&1].battle;
    let events = h.tick(10000.0);
    let room = &h.rooms[&1];
    assert!(room.started && !room.finished);
    assert_eq!(room.battle, battle);
    assert!(room.sim.time() <= 0.21);
    assert!(events
        .iter()
        .all(|(_, u)| !matches!(u, Update::Ended { .. })));
    assert_eq!(room.view().round_elapsed_s, room.sim.time());
    let before = room.sim.time();
    let _ = h.snapshot_for(2).unwrap();
    let _ = h.handle(2, Command::Snapshot, 10000.1);
    assert_eq!(h.rooms[&1].sim.time(), before);
}
#[test]
fn next_round_uses_fresh_native_world_preserves_members_and_rejects_old_control_and_company() {
    let mut h = setup(0.3, 0.2);
    accepted(&h.handle(
        2,
        Command::Deploy {
            vehicle: "su_t72a".into(),
        },
        0.0,
    ));
    let old_unit = h.rooms[&1].members[&2].view.controlled.unwrap();
    let old_company = h.rooms[&1].members[&2].view.company.unwrap();
    let old_epoch = h.rooms[&1].members[&2].view.epoch;
    let stock = h.rooms[&1].sim.snapshot(old_unit.unit).unwrap().ammo;
    accepted(&h.handle(
        2,
        Command::Input {
            unit: old_unit,
            epoch: old_epoch,
            seq: 1,
            throttle: 0.0,
            steer: 0.0,
            brake: 1.0,
            turret_yaw: 0.0,
            gun_pitch: 0.0,
            fire: true,
        },
        0.0,
    ));
    let mut ended = Vec::new();
    let mut now = 0.0;
    for i in 1..=10 {
        now = i as f64 * STEP + 1e-8;
        ended = h.tick(now);
        if h.rooms[&1].finished {
            break;
        }
    }
    let old = &h.rooms[&1];
    assert!(old.finished);
    assert!(old.sim.snapshot(old_unit.unit).unwrap().ammo < stock);
    let battle = old.battle;
    let elapsed = old.sim.time();
    let deadline = old.restart_at.unwrap();
    let identities: BTreeSet<_> = old
        .units
        .values()
        .map(|u| u.reference)
        .chain(old.air.units.values().map(|u| u.reference))
        .collect();
    assert_eq!(
        ended
            .iter()
            .filter(|(_, u)| matches!(u, Update::Ended { .. }))
            .count(),
        1
    );
    assert_eq!(old.view().round_state, "intermission");
    assert_eq!(old.view().result.as_ref().unwrap().reason, "time");
    assert!(old.members.values().all(|p| p.view.controlled.is_none()));
    h.tick(deadline - 0.01);
    assert_eq!(h.rooms[&1].sim.time(), elapsed);
    assert_eq!(h.rooms[&1].battle, battle);
    let reset = h.tick(deadline + 0.001);
    let room = &h.rooms[&1];
    assert!(room.started && !room.finished);
    assert_eq!(room.round_number, 2);
    assert_ne!(room.battle, battle);
    assert_eq!(room.sim.time(), 0.0);
    assert_eq!(room.tick, 0);
    assert_eq!(room.readiness, [1000, 1000]);
    assert_eq!((room.id, room.map.as_str(), room.era), (1, "korea", 1986));
    assert!(room.result.is_none());
    assert!(room.departed.is_empty());
    assert!(room.perception.frame().is_none());
    for (id, team, observer) in [
        (1, Team::Blue, true),
        (2, Team::Blue, false),
        (3, Team::Red, false),
    ] {
        let p = &room.members[&id];
        assert_eq!(
            (p.view.team, p.view.observer, p.view.connected),
            (team, observer, true)
        );
        assert_eq!(p.gate, Gate::Initial);
        assert!(p.view.controlled.is_none() && p.view.company.is_none() && p.resume_unit.is_none());
    }
    assert!(room.members[&2].view.epoch > old_epoch);
    assert!(room
        .units
        .values()
        .all(|u| !identities.contains(&u.reference) && u.reference.battle == room.battle));
    assert!(room.sim.snapshots().iter().all(|u| u.ammo == stock));
    assert!(room
        .sim
        .facility_views()
        .iter()
        .all(|f| f.hp == f.max_hp && f.supplied));
    for player in [1, 2, 3] {
        assert_eq!(
            reset
                .iter()
                .filter(|(ids, u)| ids == &vec![player] && matches!(u, Update::Snapshot { .. }))
                .count(),
            1
        );
    }
    accepted(&h.handle(
        2,
        Command::Deploy {
            vehicle: "su_t72a".into(),
        },
        deadline + 0.001,
    ));
    let room = &h.rooms[&1];
    let fresh = room.members[&2].view.controlled.unwrap();
    let new_company = room.members[&2].view.company.unwrap();
    assert_ne!(new_company, old_company);
    let fresh_stock = room.sim.snapshot(fresh.unit).unwrap().ammo_counts;
    for command in [
        Command::Input {
            unit: old_unit,
            epoch: old_epoch,
            seq: 999,
            throttle: 1.0,
            steer: 1.0,
            brake: 0.0,
            turret_yaw: 0.0,
            gun_pitch: 0.0,
            fire: true,
        },
        Command::Order {
            company: old_company,
            platoons: vec![0, 1, 2],
            kind: OrderKind::Attack,
            target: [0.0, 0.0],
            seq: 999,
        },
    ] {
        let out = h.handle(2, command, deadline + 0.002);
        assert!(
            out.iter().any(|(_, u)| matches!(u, Update::Error { .. })),
            "{out:?}"
        );
    }
    assert_eq!(
        h.rooms[&1].sim.snapshot(fresh.unit).unwrap().ammo_counts,
        fresh_stock
    );
    assert_eq!(h.rooms[&1].members[&2].view.controlled, Some(fresh));
    let _ = now;
}
#[test]
fn intermission_countdown_never_runs_physics_or_moves_backwards_and_offline_members_resume_clean() {
    let mut h = setup(0.1, 0.3);
    for i in 1..=5 {
        let _ = h.tick(i as f64 * STEP + 1e-8);
        if h.rooms[&1].finished {
            break;
        }
    }
    let room = &h.rooms[&1];
    let deadline = room.restart_at.unwrap();
    let elapsed = room.sim.time();
    h.disconnect(3, deadline - 0.25);
    h.tick(deadline - 0.15);
    let before = h.rooms[&1].view();
    h.tick(deadline - 0.2);
    assert_eq!(h.rooms[&1].view(), before);
    assert_eq!(h.rooms[&1].sim.time(), elapsed);
    h.tick(deadline + 0.001);
    assert!(!h.rooms[&1].members[&3].view.connected);
    let resumed = h.resume(3, deadline + 0.002);
    assert!(resumed
        .iter()
        .all(|(_, u)| !matches!(u, Update::Error { .. })));
    let member = &h.rooms[&1].members[&3];
    assert!(
        member.view.connected && member.view.controlled.is_none() && member.view.company.is_none()
    );
    assert_eq!(member.gate, Gate::Initial);
}
