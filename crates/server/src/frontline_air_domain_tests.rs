//! Actual Hub commands and shared native world; no client-state/HP shortcuts.
use super::*;
use crate::flight_runtime::FlightSpawn;

fn data_path() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")
}

fn accepted(out: &[(u32, Update)], action: &str) {
    assert!(
        !out.iter().any(|(_, m)| matches!(m, Update::Error { .. })),
        "{action}: {out:?}"
    );
}

fn rejected(out: &[(u32, Update)], expected: &str) {
    assert!(
        out.iter()
            .any(|(_, m)| matches!(m, Update::Error { code, .. } if code == expected)),
        "expected {expected}, got {out:?}"
    );
}

fn hub(observer: bool) -> FrontlineHub {
    hub_for_era(observer, 1985)
}

fn hub_for_era(observer: bool, era: u32) -> FrontlineHub {
    let mut h = FrontlineHub::new(&data_path()).unwrap();
    h.use_c2_test_scene().unwrap();
    accepted(
        &h.handle(
            1,
            Command::Create {
                name: "Actual combined aircraft domain".into(),
                map: "korea".into(),
                observer,
                era,
            },
            0.0,
        ),
        "create",
    );
    accepted(&h.handle(1, Command::Start, 0.0), "start");
    h
}

fn sortie(aircraft: &str, spawn: &str, loadout: u32) -> Command {
    Command::DeployAir {
        aircraft: aircraft.into(),
        spawn: spawn.into(),
        loadout,
        custom: None, fuel_minutes: None,
    }
}

fn deploy_air(
    h: &mut FrontlineHub,
    player: u32,
    aircraft: &str,
    spawn: &str,
    now: f64,
) -> (UnitRef, u64) {
    accepted(
        &h.handle(player, sortie(aircraft, spawn, 0), now),
        "deploy aircraft",
    );
    let p = &h.rooms[&h.membership[&player]].members[&player].view;
    (p.controlled.expect("actual aircraft control"), p.epoch)
}

fn air_view(h: &FrontlineHub, r: UnitRef) -> crate::frontline_air::AirUnitView {
    h.rooms
        .values()
        .find(|room| room.battle == r.battle)
        .unwrap()
        .air
        .views()
        .into_iter()
        .find(|u| u.unit == r)
        .unwrap()
}

fn ammo(v: &crate::frontline_air::AirUnitView) -> u32 {
    v.guns.iter().map(|g| g.ammo).sum()
}

fn intent(r: UnitRef, epoch: u64, seq: u64, aim: [f32; 3], roll: f32, fire: bool) -> Command {
    Command::AirInput {
        unit: r,
        epoch,
        seq,
        aim,
        throttle: 1.0,
        manual_pitch: 0.0,
        manual_roll: roll,
        manual_yaw: 0.0,
        flags: 1,
        fire,
        release: false,
    }
}

fn events(updates: Vec<(Vec<u32>, Update)>) -> Vec<Value> {
    // Audience fanout is one native event, not extra projectiles. Collision
    // fixtures below join a real observer to inspect authorized raw reports.
    if let Some(events) = updates.iter().find_map(|(_, u)| match u {
        Update::Frame {
            events,
            intel: None,
            ..
        } => Some(events.clone()),
        _ => None,
    }) {
        return events;
    }
    updates
        .into_iter()
        .flat_map(|(_, update)| match update {
            Update::Frame { events, .. } => events,
            _ => Vec::new(),
        })
        .collect()
}

fn company_then_return(h: &mut FrontlineHub) -> u64 {
    accepted(
        &h.handle(
            1,
            Command::Deploy {
                vehicle: "su_t72a".into(),
            },
            0.0,
        ),
        "ground company",
    );
    let company = h.rooms[&1].members[&1].view.company.unwrap();
    accepted(
        &h.handle(1, Command::Return, 0.0),
        "stopped tank returns at deployment",
    );
    company
}

fn runway(h: &FrontlineHub, team: Team) -> Value {
    h.maps["korea"]["airfields"]
        .as_array()
        .unwrap()
        .iter()
        .find(|f| f["enabled"] == true && f["team"].as_u64() == Some(team.index() as u64))
        .unwrap()["runway"]
        .clone()
}

#[test]
fn production_three_front_hub_replicates_actual_me262_mechanism_axes() {
    // Use the current15-objective/three-front scenario, not the C2 regression
    // fixture. One real host tick suffices to distinguish the new door-first
    // mechanism from a legacy scalar-only or presentation-owned animation.
    let mut h = FrontlineHub::new(&data_path()).unwrap();
    assert_eq!(
        h.maps["korea"]["initialScene"]["objectiveIds"]
            .as_array()
            .unwrap()
            .len(),
        15
    );
    accepted(
        &h.handle(
            1,
            Command::Create {
                name: "Current three-front air authority".into(),
                map: "korea".into(),
                observer: false,
                era: 1945,
            },
            0.0,
        ),
        "create full scenario",
    );
    accepted(&h.handle(1, Command::Start, 0.0), "start full scenario");
    assert_eq!(
        h.rooms[&1]
            .units
            .values()
            .filter(|u| u.support.is_none())
            .count(),
        60,
        "Both sides keep all three ground companies"
    );
    let (unit, epoch) = deploy_air(&mut h, 1, "me262", "air", 0.0);
    let before = air_view(&h, unit);
    assert_eq!(&before.aero[36..40], &[0.0; 4]);
    accepted(
        &h.handle(
            1,
            Command::AirInput {
                unit,
                epoch,
                seq: 1,
                aim: [before.state[48], before.state[49], before.state[50]],
                throttle: 0.65,
                manual_pitch: 0.0,
                manual_roll: 0.0,
                manual_yaw: 0.0,
                flags: 5,
                fire: false,
                release: false,
            },
            0.0,
        ),
        "accepted native gear request",
    );
    let updates = h.tick(STEP + 1e-8);
    let after = air_view(&h, unit);
    assert_eq!(after.controller, Some(1));
    assert_eq!(after.unit, unit);
    assert!(after.alive && after.fault.is_none());
    assert!((after.state[23] - before.state[23] - STEP as f32).abs() < 1e-5);
    assert_eq!(after.aero[36], 0.0);
    assert_eq!(after.aero[38], 0.0);
    assert_eq!(after.aero[39], 0.0);
    assert!(
        (after.aero[37] - STEP as f32).abs() < 1e-5,
        "Core door actuator advances before either leg"
    );
    let replicated = updates
        .iter()
        .find_map(|(_, u)| match u {
            Update::Frame { aircrafts, .. } => aircrafts.iter().find(|a| a.unit == unit),
            _ => None,
        })
        .unwrap();
    assert_eq!(
        replicated, &after,
        "Actual native80/48 projection is the shared authoritative frame"
    );
}

#[test]
fn one_observer_starts_ground_and_both_teams_real_native_aircraft() {
    let mut h = hub(true);
    assert_eq!(crate::flight_runtime::CORE_VERSION, 215);
    let room = &h.rooms[&1];
    assert_eq!(room.members.len(), 1);
    assert!(room.members[&1].view.observer);
    assert!(room.members[&1].view.controlled.is_none());
    assert_eq!(room.units.len(), 20);
    let before = room.air.views();
    assert_eq!(before.len(), 2, "one actual autonomous aircraft per team");
    for team in [Team::Blue, Team::Red] {
        assert_eq!(before.iter().filter(|u| u.team == team).count(), 1);
    }
    assert!(before
        .iter()
        .all(|u| u.controller.is_none() && u.owner.is_none()));
    let ground_before = room.sim.snapshots();
    for i in 1..=40 {
        h.tick(i as f64 * STEP + 1e-8);
    }
    let after = h.rooms[&1].air.views();
    for a in before {
        let b = after.iter().find(|v| v.unit == a.unit).unwrap();
        assert!(b.alive && b.fault.is_none(), "native aircraft fault: {b:?}");
        assert_eq!(b.state.len(), 80);
        assert_eq!(b.aero.len(), 48);
        assert!(b.state[23] > a.state[23] + 1.5, "actual native kernel time");
        assert!(distance(a.pos, b.pos) > 100.0, "actual native movement");
        assert!(b.fuel["kg"].as_f64().unwrap() < a.fuel["kg"].as_f64().unwrap());
    }
    let ground_after = h.rooms[&1].sim.snapshots();
    for team in [0, 1] {
        assert!(
            ground_before
                .iter()
                .filter(|u| u.team == team)
                .any(|a| ground_after
                    .iter()
                    .find(|b| b.id == a.id)
                    .is_some_and(|b| distance(a.pos, b.pos) > 1.0)),
            "ground and air must advance in the same actual host world"
        );
    }
}

#[test]
fn aircraft_admission_rejects_observer_unknown_future_unsupported_loadout_and_second_role() {
    let mut spectator = hub(true);
    rejected(
        &spectator.handle(1, sortie("f104g", "air", 0), 0.0),
        "observer",
    );
    assert_eq!(spectator.rooms[&1].air.units.len(), 2);
    let autonomous_air = spectator.rooms[&1].air.views()[0].clone();
    rejected(
        &spectator.handle(
            1,
            Command::Takeover {
                unit: autonomous_air.unit,
            },
            0.0,
        ),
        "no_loss_gate",
    );
    assert!(spectator.rooms[&1].members[&1].view.controlled.is_none());
    assert_eq!(air_view(&spectator, autonomous_air.unit).controller, None);
    let mut h = hub(false);
    for (aircraft, loadout) in [
        ("not_an_aircraft", 0),
        ("nf01", 0),
        ("f16v", 0),
        ("su27", 0), //1992 remains later than this1985 room's upper ceiling.
        ("f104g", u32::MAX),
    ] {
        rejected(
            &h.handle(1, sortie(aircraft, "air", loadout), 0.0),
            "era_or_loadout",
        );
        assert_eq!(h.rooms[&1].air.units.len(), 2);
        assert!(h.rooms[&1].members[&1].view.controlled.is_none());
    }
    // The source AIM-9 configuration is now supported by the native guidance
    // runtime and must be available by default, while invalid indices above
    // and future aircraft remain rejected.
    let mut guided = hub(false);
    accepted(
        &guided.handle(1, sortie("f104g", "air", 1), 0.0),
        "source guided loadout is open by default",
    );
    let r = guided.rooms[&1].members[&1].view.controlled.unwrap();
    assert!(air_view(&guided, r).stores.iter().any(|store| {
        store["id"].as_str().is_some_and(|id| id.starts_with("aim9"))
    }));
    rejected(
        &h.handle(1, sortie("f104g", "anywhere", 0), 0.0),
        "air_spawn_failed",
    );
    assert_eq!(h.rooms[&1].air.units.len(), 2);
    let (r, _) = deploy_air(&mut h, 1, "f104g", "air", 0.0);
    rejected(&h.handle(1, sortie("su25", "air", 0), 0.0), "role_gate");
    rejected(
        &h.handle(
            1,
            Command::Deploy {
                vehicle: "su_t72a".into(),
            },
            0.0,
        ),
        "already_controlled",
    );
    rejected(&h.handle(1, Command::Return, 0.0), "not_at_deployment");
    assert_eq!(h.rooms[&1].members[&1].view.controlled, Some(r));
    assert_eq!(h.rooms[&1].air.units.len(), 3);
}

#[test]
fn runway_input_timeout_keeps_gear_and_zero_throttle_instead_of_flying_away() {
    let mut h = hub(false);
    let (r, epoch) = deploy_air(&mut h, 1, "f104g", "runway", 0.0);
    let before = air_view(&h, r);
    accepted(
        &h.handle(
            1,
            Command::AirInput {
                unit: r,
                epoch,
                seq: 1,
                aim: [before.state[48], before.state[49], before.state[50]],
                throttle: 0.0,
                manual_pitch: 0.0,
                manual_roll: 0.0,
                manual_yaw: 0.0,
                flags: 1 | 4 | 128 | 16,
                fire: false,
                release: false,
            },
            0.0,
        ),
        "actual runway idle input",
    );
    for i in 1..=25 {
        h.tick(i as f64 * STEP + 1e-8);
    }
    let after = air_view(&h, r);
    assert!(after.alive && after.fault.is_none());
    assert_eq!(after.controller, Some(1));
    assert_eq!(
        after.state[33], before.state[33],
        "timeout must retain extended gear"
    );
    assert!(
        after.state[27] <= before.state[27],
        "timeout must never substitute airborne .78 throttle"
    );
    assert!(after.state[27] < 0.06, "actual idle gate from stepAirFuel");
    assert_eq!(after.fuel["kg"], before.fuel["kg"]);
    assert_eq!(after.fuel["flow"].as_f64(), Some(0.0));
    assert_eq!(ammo(&after), ammo(&before));
    assert!(h.rooms[&1].air.at_friendly_runway(r.unit));
}

#[test]
fn rapid_release_return_and_reconnect_do_not_reset_native_bomb_cooldown() {
    let mut h = hub_for_era(false, 1976);
    accepted(
        &h.handle(1, sortie("f86f", "runway", 1), 0.0),
        "runway AN-M64 loadout",
    );
    let r = h.rooms[&1].members[&1].view.controlled.unwrap();
    let epoch = h.rooms[&1].members[&1].view.epoch;
    let initial = air_view(&h, r);
    let aim = [initial.state[48], initial.state[49], initial.state[50]];
    let remaining = |v: &crate::frontline_air::AirUnitView| -> u64 {
        v.stores
            .iter()
            .filter(|s| s["id"] == "anm64" && s["gone"] != true)
            .map(|s| s["count"].as_u64().unwrap())
            .sum()
    };
    let release = |epoch, seq, held| Command::AirInput {
        unit: r,
        epoch,
        seq,
        aim,
        throttle: 0.0,
        manual_pitch: 0.0,
        manual_roll: 0.0,
        manual_yaw: 0.0,
        flags: 1 | 4 | 128 | 16,
        fire: false,
        release: held,
    };
    let mut store_events = Vec::new();
    accepted(
        &h.handle(1, release(epoch, 1, true), 0.0),
        "first release edge",
    );
    store_events.extend(events(h.tick(STEP + 1e-8)));
    assert_eq!(remaining(&air_view(&h, r)), 1);
    accepted(
        &h.handle(1, Command::Return, STEP),
        "return during mounted release cooldown",
    );
    accepted(
        &h.handle(1, sortie("f86f", "runway", 1), STEP),
        "reuse same cooling aircraft",
    );
    assert_eq!(h.rooms[&1].members[&1].view.controlled, Some(r));
    let returned_epoch = h.rooms[&1].members[&1].view.epoch;
    accepted(
        &h.handle(1, release(returned_epoch, 1, false), STEP),
        "release the trigger",
    );
    store_events.extend(events(h.tick(2.0 * STEP + 1e-8)));
    h.disconnect(1, 2.0 * STEP);
    accepted(
        &h.resume(1, 2.0 * STEP),
        "reconnect during mounted release cooldown",
    );
    let resumed_epoch = h.rooms[&1].members[&1].view.epoch;
    assert!(resumed_epoch > returned_epoch);
    for seq in 1..=8 {
        accepted(
            &h.handle(1, release(resumed_epoch, seq, seq % 2 == 0), 2.0 * STEP),
            "rapid alternating accepted input sequences",
        );
    }
    assert_eq!(
        remaining(&air_view(&h, r)),
        1,
        "commands alone cannot consume stores"
    );
    store_events.extend(events(h.tick(3.0 * STEP + 1e-8)));
    assert_eq!(
        remaining(&air_view(&h, r)),
        1,
        "second rising edge is only .10s after the first, below .15s"
    );
    accepted(
        &h.handle(1, release(resumed_epoch, 9, false), 3.0 * STEP),
        "release after rejected early edge",
    );
    store_events.extend(events(h.tick(4.0 * STEP + 1e-8)));
    accepted(
        &h.handle(1, release(resumed_epoch, 10, true), 4.0 * STEP),
        "release after actual cooldown elapsed",
    );
    store_events.extend(events(h.tick(5.0 * STEP + 1e-8)));
    assert_eq!(remaining(&air_view(&h, r)), 0);
    assert_eq!(ammo(&air_view(&h, r)), ammo(&initial));
    assert_eq!(
        store_events
            .iter()
            .filter(|e| e["kind"] == "shot"
                && e["shooter"]["unit"].as_u64() == Some(r.unit)
                && e["detail"]["store"] == true)
            .count(),
        2
    );
    assert_eq!(
        h.rooms[&1].air.units.len(),
        3,
        "return and resume never clone/rearm the aircraft"
    );
}

#[test]
fn actual_hub_air_starts_are_separated_and_full_slots_wait_for_physical_clearance() {
    let mut h = hub(false);
    let (first, _) = deploy_air(&mut h, 1, "f104g", "air", 0.0);
    accepted(
        &h.handle(
            2,
            Command::Join {
                room: 1,
                observer: false,
                team: Some(Team::Blue),
            },
            0.0,
        ),
        "second pilot",
    );
    let (second, _) = deploy_air(&mut h, 2, "f104g", "air", 0.0);
    let blue = h.rooms[&1]
        .air
        .views()
        .into_iter()
        .filter(|u| u.team == Team::Blue)
        .collect::<Vec<_>>();
    for (i, a) in blue.iter().enumerate() {
        for b in blue.iter().skip(i + 1) {
            let separation = (a.pos[0] - b.pos[0])
                .hypot(a.pos[1] - b.pos[1])
                .hypot(a.pos[2] - b.pos[2]);
            assert!(
                separation >= 60.0,
                "actual accepted spawn clearance, not visual pixel size"
            );
        }
    }
    let mut blocker = None;
    // Fill the remaining authored native air-start slots without manufacturing
    // human members; the rejection and retry still use actual Hub admission.
    for index in blue.len()..32 {
        let r = UnitRef {
            battle: h.rooms[&1].battle,
            unit: 20_000 + index as u64,
            life: 1,
        };
        h.rooms
            .get_mut(&1)
            .unwrap()
            .air
            .spawn(r, "f104g", Team::Blue, None, "air", 0)
            .unwrap();
        blocker = Some(r);
    }
    let before_count = h.rooms[&1].air.units.len();
    accepted(
        &h.handle(
            3,
            Command::Join {
                room: 1,
                observer: false,
                team: Some(Team::Blue),
            },
            0.0,
        ),
        "waiting pilot",
    );
    rejected(
        &h.handle(3, sortie("f104g", "air", 0), 0.0),
        "air_spawn_failed",
    );
    assert_eq!(h.rooms[&1].air.units.len(), before_count);
    assert!(h.rooms[&1].members[&3].view.controlled.is_none());
    let blocker = blocker.unwrap();
    let old = air_view(&h, blocker);
    h.rooms.get_mut(&1).unwrap().air.test_spawn_at(
        blocker.unit,
        FlightSpawn {
            position: [
                (old.pos[0] + 2000.0) as f32,
                (old.pos[1] + 100.0) as f32,
                old.pos[2] as f32,
            ],
            heading: old.yaw as f32,
            airspeed: 210.0,
            on_ground: false,
        },
    );
    let (admitted, _) = deploy_air(&mut h, 3, "f104g", "air", 0.0);
    assert_ne!(admitted, first);
    assert_ne!(admitted, second);
    assert_eq!(h.rooms[&1].air.units.len(), before_count + 1);
    assert!(
        distance(air_view(&h, admitted).pos, old.pos) < 0.01,
        "retry occupies the physically cleared authored slot"
    );
}

#[test]
fn owned_air_input_rolls_and_burns_real_fuel_ammo_and_can_order_retained_tanks() {
    let mut h = hub(false);
    let company = company_then_return(&mut h);
    let (r, epoch) = deploy_air(&mut h, 1, "f104g", "air", 0.0);
    accepted(
        &h.handle(
            2,
            Command::Join {
                room: 1,
                observer: false,
                team: Some(Team::Red),
            },
            0.0,
        ),
        "foreign player joins",
    );
    let before = air_view(&h, r);
    let profile: Value = serde_json::from_slice(
        &std::fs::read(data_path().join("aircraft/frontline.json")).unwrap(),
    )
    .unwrap();
    let configured: u32 = profile["aircraft"]["f104g"]["guns"]
        .as_array()
        .unwrap()
        .iter()
        .map(|g| g["ammo"].as_u64().unwrap() as u32)
        .sum();
    assert_eq!(ammo(&before), configured);
    assert_eq!(configured, 725);
    let f = [before.state[48], before.state[49], before.state[50]];
    rejected(
        &h.handle(2, intent(r, epoch, 1, f, 0.0, true), 0.0),
        "stale_control",
    );
    rejected(
        &h.handle(1, intent(r, epoch - 1, 1, f, 0.0, true), 0.0),
        "stale_control",
    );
    let wrong_life = UnitRef {
        life: r.life + 1,
        ..r
    };
    rejected(
        &h.handle(1, intent(wrong_life, epoch, 1, f, 0.0, true), 0.0),
        "stale_control",
    );
    rejected(
        &h.handle(1, intent(r, epoch, 1, [f32::NAN, 0.0, 1.0], 0.0, true), 0.0),
        "invalid_input",
    );
    assert_eq!(
        ammo(&air_view(&h, r)),
        ammo(&before),
        "rejected commands cannot spend ammunition"
    );
    assert_eq!(air_view(&h, r).resource_revision, before.resource_revision);
    let p = [f[0] + 0.2, 0.03, f[2]];
    let length = (p[0] * p[0] + p[1] * p[1] + p[2] * p[2]).sqrt();
    let aim = p.map(|v| v / length);
    let mut shots = Vec::new();
    for i in 1..=40 {
        let now = i as f64 * STEP;
        accepted(
            &h.handle(1, intent(r, epoch, i, aim, 0.35, true), now),
            "accepted actual aircraft input",
        );
        shots.extend(events(h.tick(now + 1e-8)));
    }
    let after = air_view(&h, r);
    assert!(after.alive && after.fault.is_none());
    assert!(distance(before.pos, after.pos) > 100.0);
    assert!(
        wrap(after.state[20] as f64 - before.state[20] as f64).abs() > 0.02,
        "native manual roll must change attitude"
    );
    assert!(after.fuel["kg"].as_f64().unwrap() < before.fuel["kg"].as_f64().unwrap());
    assert!(ammo(&after) < ammo(&before));
    assert!(
        shots.iter().any(|e| e["kind"] == "shot"
            && e["shooter"]["unit"].as_u64() == Some(r.unit)
            && e["detail"]["airborne"] == true),
        "real mounted fire must enter the shared projectile world"
    );
    rejected(
        &h.handle(1, intent(r, epoch, 40, aim, 0.0, true), 2.0),
        "stale_input",
    );
    let current = air_view(&h, r);
    assert_eq!(ammo(&current), ammo(&after));
    let target = h.rooms[&1].target(Team::Blue);
    accepted(
        &h.handle(
            1,
            Command::Order {
                company,
                platoons: vec![0, 2],
                kind: OrderKind::Attack,
                target,
                seq: 1,
            },
            2.0,
        ),
        "airborne commander orders owned company",
    );
    assert_eq!(h.rooms[&1].companies[&company].view.units.len(), 10);
    assert_eq!(h.rooms[&1].members[&1].view.company, Some(company));
    assert_eq!(h.rooms[&1].members[&1].view.controlled, Some(r));
    assert!(h.rooms[&1].companies[&company]
        .view
        .orders
        .iter()
        .any(|o| o.platoon == Some(2) && o.kind == OrderKind::Attack));
}

#[test]
fn aircraft_disconnect_and_explicit_rejoin_preserve_real_resources_damage_pose_and_life() {
    let mut h = hub(false);
    let (r, epoch) = deploy_air(&mut h, 1, "f104g", "air", 0.0);
    accepted(
        &h.handle(
            9,
            Command::Join {
                room: 1,
                observer: true,
                team: None,
            },
            0.0,
        ),
        "keep an actual observer",
    );
    let f = air_view(&h, r).state;
    for i in 1..=8 {
        let now = i as f64 * STEP;
        accepted(
            &h.handle(
                1,
                intent(r, epoch, i, [f[48], f[49], f[50]], 0.0, true),
                now,
            ),
            "mounted fire before disconnect",
        );
        h.tick(now + 1e-8);
    }
    let pristine = air_view(&h, r);
    // Actual accepted blast damage at the left wing; no test-only HP assignment.
    let local = [-1.95, -0.34, -0.51];
    let blast = std::array::from_fn(|i| {
        pristine.pos[i]
            + pristine.state[42 + i] as f64 * local[0]
            + pristine.state[45 + i] as f64 * local[1]
            + pristine.state[48 + i] as f64 * local[2]
    });
    h.rooms
        .get_mut(&1)
        .unwrap()
        .air
        .blast(blast, 0.001, 1, 97, false, None);
    let damaged = air_view(&h, r);
    assert!(damaged.alive);
    assert_ne!(damaged.damage, pristine.damage);
    h.disconnect(1, 0.4);
    assert!(h.contains(1));
    assert_eq!(air_view(&h, r).controller, None);
    for i in 9..=18 {
        h.tick(i as f64 * STEP + 1e-8);
    }
    let before = air_view(&h, r);
    assert!(
        distance(damaged.pos, before.pos) > 10.0,
        "disconnected aircraft remains a physical native actor"
    );
    accepted(&h.resume(1, 1.0), "resume owned aircraft");
    let resumed = air_view(&h, r);
    assert_eq!(resumed.unit, r);
    assert_eq!(resumed.controller, Some(1));
    assert!(resumed.epoch > epoch);
    assert_eq!(resumed.state, before.state);
    assert_eq!(resumed.damage, before.damage);
    assert_eq!(ammo(&resumed), ammo(&before));
    assert_eq!(resumed.fuel, before.fuel);
    rejected(
        &h.handle(
            1,
            intent(r, epoch, 99, [f[48], f[49], f[50]], 0.0, true),
            1.0,
        ),
        "stale_control",
    );
    h.leave(1);
    let departed = air_view(&h, r);
    rejected(
        &h.handle(
            1,
            Command::Join {
                room: 1,
                observer: true,
                team: None,
            },
            1.1,
        ),
        "owned_company",
    );
    accepted(
        &h.handle(
            1,
            Command::Join {
                room: 1,
                observer: false,
                team: Some(Team::Red),
            },
            1.1,
        ),
        "explicit aircraft owner rejoin",
    );
    let rejoined = air_view(&h, r);
    assert_eq!(rejoined.unit, r);
    assert_eq!(rejoined.team, Team::Blue);
    assert_eq!(rejoined.controller, Some(1));
    assert!(rejoined.epoch > resumed.epoch);
    assert_eq!(rejoined.state, departed.state);
    assert_eq!(rejoined.damage, departed.damage);
    assert_eq!(ammo(&rejoined), ammo(&departed));
    assert_eq!(rejoined.fuel, departed.fuel);
    assert_eq!(h.rooms[&1].air.units.len(), 3, "no rejoin clone/rearm");
}

#[test]
fn actual_runway_spawn_height_occupancy_and_return_preserve_aircraft_and_company() {
    let mut h = hub(false);
    let company = company_then_return(&mut h);
    let original_tanks = h.rooms[&1].companies[&company].view.units.clone();
    let (r, epoch) = deploy_air(&mut h, 1, "f104g", "runway", 0.0);
    let v = air_view(&h, r);
    let runway = runway(&h, Team::Blue);
    let terrain = h.rooms[&1].sim.height(v.pos[0], v.pos[2]);
    assert!(
        (terrain - runway["height"].as_f64().unwrap()).abs() < 1e-3,
        "same canonical graded surface"
    );
    assert!(
        (v.pos[1] - terrain - v.state[35] as f64).abs() < 0.01,
        "native AGL and canonical ground must agree"
    );
    assert!(v.pos[1] > terrain && v.pos[1] - terrain < 3.0);
    assert!(h.rooms[&1].air.at_friendly_runway(r.unit));
    accepted(
        &h.handle(
            2,
            Command::Join {
                room: 1,
                observer: false,
                team: Some(Team::Blue),
            },
            0.0,
        ),
        "same-team runway user",
    );
    rejected(
        &h.handle(2, sortie("f104g", "runway", 0), 0.0),
        "air_spawn_failed",
    );
    assert_eq!(
        h.rooms[&1].air.units.len(),
        3,
        "occupied runway must not mint a unit"
    );
    accepted(
        &h.handle(1, Command::Return, 0.0),
        "actual stopped friendly-airfield return",
    );
    assert!(h.rooms[&1].members[&1].view.controlled.is_none());
    assert_eq!(h.rooms[&1].companies[&company].view.units, original_tanks);
    let parked = air_view(&h, r);
    accepted(
        &h.handle(1, sortie("f104g", "runway", 0), 0.0),
        "reuse surviving returned aircraft",
    );
    let reused = air_view(&h, r);
    assert_eq!(reused.unit, r);
    assert!(reused.epoch > epoch);
    assert_eq!(reused.state, parked.state);
    assert_eq!(reused.fuel, parked.fuel);
    assert_eq!(ammo(&reused), ammo(&parked));
    assert_eq!(reused.damage, parked.damage);
    assert_eq!(h.rooms[&1].air.units.len(), 3);
    assert_eq!(h.rooms[&1].members[&1].view.company, Some(company));
}

#[test]
fn all_original_and_inherited_native_catalog_types_preserve_total_source_ammunition() {
    let mut h = hub(true);
    let profile: Value = serde_json::from_slice(
        &std::fs::read(data_path().join("aircraft/frontline.json")).unwrap(),
    )
    .unwrap();
    let types = profile["aircraft"].as_object().unwrap();
    crate::frontline_catalog_test_contract::assert_ids(types.keys().map(String::as_str));
    // Catalog-construction fixture only. Unknown-era NF types remain denied by
    // the real Hub admission test; this does not add them to an admitted pool.
    for (index, (id, source)) in types.iter().enumerate() {
        let reference = UnitRef {
            battle: h.rooms[&1].battle,
            unit: 10_000 + index as u64,
            life: 1,
        };
        h.rooms
            .get_mut(&1)
            .unwrap()
            .air
            .spawn(reference, id, Team::Blue, None, "air", 0)
            .unwrap_or_else(|error| panic!("actual native catalog spawn {id}: {error}"));
        let native = air_view(&h, reference);
        let exact_source_total: f64 = source["guns"]
            .as_array()
            .unwrap()
            .iter()
            .map(|g| g["ammo"].as_f64().unwrap())
            .sum();
        assert_eq!(
            ammo(&native),
            exact_source_total.round() as u32,
            "{id}: integer host feeds must conserve the real complete aircraft stock"
        );
        assert_eq!(
            native.guns.len(),
            source["guns"].as_array().unwrap().len(),
            "{id}: muzzle/barrel count must not manufacture logical feeds"
        );
        assert!(native.alive && native.fault.is_none(), "{id}");
    }
}

#[test]
fn mounted_cannon_rounds_physically_contact_an_enemy_aircraft_in_the_same_world() {
    let mut h = hub(false);
    accepted(
        &h.handle(
            99,
            Command::Join {
                room: 1,
                observer: true,
                team: None,
            },
            0.0,
        ),
        "real report observer",
    );
    let (shooter, epoch) = deploy_air(&mut h, 1, "f104g", "air", 0.0);
    accepted(
        &h.handle(
            2,
            Command::Join {
                room: 1,
                observer: false,
                team: Some(Team::Red),
            },
            0.0,
        ),
        "enemy pilot",
    );
    let (target, target_epoch) = deploy_air(&mut h, 2, "su25", "air", 0.0);
    // This fixture calls the actual native spawn ABI, preserving resources/damage.
    // The following shot is accepted only through the real Hub input path.
    h.rooms.get_mut(&1).unwrap().air.test_spawn_at(
        shooter.unit,
        FlightSpawn {
            position: [0.0, 1500.0, 0.0],
            heading: 0.0,
            airspeed: 0.0,
            on_ground: false,
        },
    );
    h.rooms.get_mut(&1).unwrap().air.test_spawn_at(
        target.unit,
        FlightSpawn {
            position: [0.0, 1500.0, 150.0],
            heading: 0.0,
            airspeed: 0.0,
            on_ground: false,
        },
    );
    let before = air_view(&h, target);
    let mut contacts = Vec::new();
    for i in 1..=8 {
        let now = i as f64 * STEP;
        accepted(
            &h.handle(
                1,
                intent(shooter, epoch, i, [0.0, 0.0, 1.0], 0.0, true),
                now,
            ),
            "mounted cannon trigger",
        );
        // Keep the target's real body level, without steering/position writes.
        accepted(
            &h.handle(
                2,
                intent(target, target_epoch, i, [0.0, 0.0, 1.0], 0.0, false),
                now,
            ),
            "target neutral pilot",
        );
        contacts.extend(events(h.tick(now + 1e-8)));
        if !air_view(&h, target).alive {
            break;
        }
    }
    assert!(
        contacts.iter().any(|e| e["kind"] == "impact"
            && e["shooter"]["unit"].as_u64() == Some(shooter.unit)
            && e["target"]["unit"].as_u64() == Some(target.unit)
            && e["detail"]["report"]["contact_model"] == "accepted_aircraft_boxes"),
        "actual integrated projectile contacts: {contacts:?}"
    );
    assert!(ammo(&air_view(&h, shooter)) < 725);
    assert_ne!(
        air_view(&h, target).damage,
        before.damage,
        "damage must come from actual mounted projectiles, not range/HP shortcuts"
    );
}

#[test]
fn actual_f86_mounted_bomb_falls_into_shared_ground_combat_and_damages_native_tank() {
    let mut h = hub_for_era(false, 1976);
    accepted(
        &h.handle(
            99,
            Command::Join {
                room: 1,
                observer: true,
                team: None,
            },
            0.0,
        ),
        "real report observer",
    );
    accepted(
        &h.handle(
            2,
            Command::Join {
                room: 1,
                observer: false,
                team: Some(Team::Red),
            },
            0.0,
        ),
        "enemy tanker",
    );
    let enemy_vehicle = h.rooms[&1]
        .vehicles
        .iter()
        .find(|v| v.id.contains("t54") || v.id.contains("t55"))
        .unwrap_or(&h.rooms[&1].vehicles[0])
        .id
        .clone();
    accepted(
        &h.handle(
            2,
            Command::Deploy {
                vehicle: enemy_vehicle,
            },
            0.0,
        ),
        "actual enemy tank deployment",
    );
    let tank_ref = h.rooms[&1].members[&2].view.controlled.unwrap();
    let tank_before = h.rooms[&1].sim.snapshot(tank_ref.unit).unwrap();
    accepted(
        &h.handle(1, sortie("f86f", "air", 1), 0.0),
        "actual two AN-M64 bomb loadout",
    );
    let r = h.rooms[&1].members[&1].view.controlled.unwrap();
    let epoch = h.rooms[&1].members[&1].view.epoch;
    let initial = air_view(&h, r);
    let bombs = |v: &crate::frontline_air::AirUnitView| -> u32 {
        v.stores
            .iter()
            .filter(|s| s["id"] == "anm64" && s["gone"] != true)
            .map(|s| s["count"].as_u64().unwrap() as u32)
            .sum()
    };
    assert_eq!(bombs(&initial), 2);
    let first = initial.stores.iter().find(|s| s["id"] == "anm64").unwrap();
    let p: [f64; 3] = serde_json::from_value(first["p"].clone()).unwrap();
    // Align the actual first mounted bomb above the real enemy tank. Only the
    // native spawn ABI poses the aircraft; the bomb must still leave its mount.
    h.rooms.get_mut(&1).unwrap().air.test_spawn_at(
        r.unit,
        FlightSpawn {
            position: [
                (tank_before.pos[0] - p[0]) as f32,
                (tank_before.pos[1] + 90.0) as f32,
                (tank_before.pos[2] - p[2]) as f32,
            ],
            heading: 0.0,
            airspeed: 0.0,
            on_ground: false,
        },
    );
    let stock = ammo(&air_view(&h, r));
    let mut all_events = Vec::new();
    let release = |seq, held| Command::AirInput {
        unit: r,
        epoch,
        seq,
        aim: [0.0, 0.0, 1.0],
        throttle: 0.0,
        manual_pitch: 0.0,
        manual_roll: 0.0,
        manual_yaw: 0.0,
        flags: 1,
        fire: false,
        release: held,
    };
    for i in 1..=120 {
        let now = i as f64 * STEP;
        let a = air_view(&h, r);
        if a.alive && a.controller == Some(1) {
            // Holding through several fixed steps must still consume just one bomb.
            accepted(
                &h.handle(1, release(i, i <= 3), now),
                "actual mounted bomb release intent",
            );
        }
        all_events.extend(events(h.tick(now + 1e-8)));
        if i == 1 {
            assert_eq!(bombs(&air_view(&h, r)), 1);
        }
        let after = h.rooms[&1].sim.snapshot(tank_ref.unit).unwrap();
        if (after.damage["modules"] != tank_before.damage["modules"]
            || after.damage["crew"] != tank_before.damage["crew"])
            && all_events.iter().any(|e| {
                e["shooter"]["unit"].as_u64() == Some(r.unit)
                    && e["target"]["unit"].as_u64() == Some(tank_ref.unit)
                    && (e["kind"] == "impact" || e["kind"] == "blast")
            })
        {
            break;
        }
    }
    let after = h.rooms[&1].sim.snapshot(tank_ref.unit).unwrap();
    assert_eq!(
        bombs(&air_view(&h, r)),
        1,
        "one release rising edge, not one bomb per physics substep"
    );
    assert_eq!(
        ammo(&air_view(&h, r)),
        stock,
        "bomb release cannot borrow cannon ammunition"
    );
    let shots: Vec<_> = all_events
        .iter()
        .filter(|e| {
            e["kind"] == "shot"
                && e["shooter"]["unit"].as_u64() == Some(r.unit)
                && e["detail"]["store"] == true
        })
        .collect();
    assert_eq!(
        shots.len(),
        1,
        "actual mounted store must create exactly one authoritative projectile"
    );
    let shot_id = shots[0]["detail"]["shot_id"].as_u64().unwrap();
    assert!(
        all_events
            .iter()
            .any(|e| (e["kind"] == "impact" || e["kind"] == "terrain_impact")
                && e["detail"]["shot_id"].as_u64() == Some(shot_id)),
        "actual falling bomb must reach native vehicle/terrain contact"
    );
    assert!(
        all_events
            .iter()
            .any(|e| (e["kind"] == "impact" || e["kind"] == "blast")
                && e["target"]["unit"].as_u64() == Some(tank_ref.unit)
                && e["detail"]["shot_id"].as_u64() == Some(shot_id)
                && ["modules", "crew"]
                    .iter()
                    .any(|field| e["detail"]["report"][*field]
                        .as_array()
                        .is_some_and(|v| !v.is_empty()))),
        "module/crew damage must be reported for this mounted bomb's shot ID and actual enemy tank"
    );
    assert!(
        after.damage["modules"] != tank_before.damage["modules"]
            || after.damage["crew"] != tank_before.damage["crew"],
        "native tank modules/crew must change through the mounted bomb's integrated combat path"
    );
}

#[test]
fn actual_mig17_rocket_pods_consume_payloads_one_edge_at_a_time_and_keep_empty_containers() {
    let mut h = hub_for_era(false, 1976);
    accepted(
        &h.handle(1, sortie("mig17f", "air", 2), 0.0),
        "actual UB-16 pod loadout",
    );
    let r = h.rooms[&1].members[&1].view.controlled.unwrap();
    let epoch = h.rooms[&1].members[&1].view.epoch;
    let initial = air_view(&h, r);
    let pods: Vec<_> = initial
        .stores
        .iter()
        .filter(|s| s["id"] == "ub16")
        .collect();
    assert_eq!(pods.len(), 2);
    let rockets: u32 = pods
        .iter()
        .map(|s| s["count"].as_u64().unwrap() as u32)
        .sum();
    assert_eq!(rockets, 32);
    let stock = ammo(&initial);
    let forward = [initial.state[48], initial.state[49], initial.state[50]];
    let mut released = Vec::new();
    for seq in 1..=(rockets as u64 * 2) {
        let held = seq % 2 == 1;
        accepted(
            &h.handle(
                1,
                Command::AirInput {
                    unit: r,
                    epoch,
                    seq,
                    aim: forward,
                    throttle: 0.8,
                    manual_pitch: 0.0,
                    manual_roll: 0.0,
                    manual_yaw: 0.0,
                    flags: 1,
                    fire: false,
                    release: held,
                },
                seq as f64 * STEP,
            ),
            "actual pod release edge",
        );
        released.extend(events(h.tick(seq as f64 * STEP + 1e-8)));
        let v = air_view(&h, r);
        let remaining: u32 = v
            .stores
            .iter()
            .filter(|s| s["id"] == "ub16")
            .map(|s| s["count"].as_u64().unwrap() as u32)
            .sum();
        assert_eq!(remaining, rockets - seq.div_ceil(2) as u32);
        assert!(
            v.stores
                .iter()
                .filter(|s| s["id"] == "ub16")
                .all(|s| s["gone"] == false),
            "empty mounted pod is still a physical container"
        );
        assert_eq!(ammo(&v), stock);
    }
    assert_eq!(
        released
            .iter()
            .filter(|e| e["kind"] == "shot"
                && e["shooter"]["unit"].as_u64() == Some(r.unit)
                && e["detail"]["store"] == true)
            .count(),
        rockets as usize
    );
}
