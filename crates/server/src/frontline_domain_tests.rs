use super::*;

#[test]
fn nearest_visible_ground_matches_old_native_multi_target_ties_occlusion_and_combat() {
    // The reference is the pre-optimization production filter/LOS/min_by,
    // operating on independent native plants and actual terrain queries.
    fn select<'a>(
        world: &SimWorld,
        bodies: &'a [SimKinematics],
        origin: [f64; 3],
        legacy: bool,
        checks: &mut usize,
    ) -> Option<&'a SimKinematics> {
        let mut los = |t: &SimKinematics| {
            *checks += 1;
            world.line_of_sight(
                [origin[0], origin[1] + 1.8, origin[2]],
                [t.pos[0], t.pos[1] + 1.0, t.pos[2]],
            )
        };
        if legacy {
            bodies
                .iter()
                .filter(|t| t.alive && t.team != 0 && distance(t.pos, origin) < 1800.0)
                .filter(|t| los(t))
                .min_by(|a, b| distance(a.pos, origin).total_cmp(&distance(b.pos, origin)))
        } else {
            nearest_visible_ground(bodies, origin, Team::Blue, los)
        }
    }
    fn step(world: &mut SimWorld, legacy: bool) -> (Option<u64>, Vec<Value>, usize) {
        let bodies = world.kinematics();
        let shooter = bodies.iter().find(|s| s.id == 10).unwrap();
        let mut checks = 0;
        let target = select(world, &bodies, shooter.pos, legacy, &mut checks).copied();
        // These are the actual Room::step aim/fire offsets and mounted fire
        // path. No external round launch, fake LOS, or direct damage setter.
        let mut events = Vec::new();
        if let Some(t) = target {
            if world
                .aim_at(10, [t.pos[0], t.pos[1] + 0.8, t.pos[2]])
                .unwrap()
            {
                if let Ok(event) = world.fire(10, None) {
                    events.push(serde_json::to_value(event).unwrap());
                }
            }
        }
        events.extend(
            world
                .step(STEP)
                .into_iter()
                .map(|e| serde_json::to_value(e).unwrap()),
        );
        (target.map(|t| t.id), events, checks)
    }
    let base = SimWorld::load(
        &data(),
        &json!({"terrain":{"width":121,"height":121,"cellX":40.0,"cellZ":40.0,
            "x0":-2400.0,"z0":-2400.0,"heights":vec![0.0;121*121]}}),
    )
    .unwrap();
    for scene in ["clear", "left_blocked", "all_blocked"] {
        let mut heights = vec![0.0; 121 * 121];
        if scene != "clear" {
            for ix in 0..121 {
                if scene == "all_blocked" || ix < 60 {
                    heights[62 * 121 + ix] = 20.0;
                }
            }
        }
        let map = json!({"terrain":{"width":121,"height":121,"cellX":40.0,"cellZ":40.0,
            "x0":-2400.0,"z0":-2400.0,"heights":heights}});
        let mut optimized = base.for_map(&data(), &map).unwrap();
        for (id, team, pos) in [
            (5, 0, [60.0, 0.0, 0.0]),
            (10, 0, [0.0, 0.0, 0.0]),
            (15, 1, [-100.0, 0.0, 0.0]),
            (20, 1, [-40.0, 0.0, 180.0]),
            (30, 1, [40.0, 0.0, 180.0]),
            (40, 1, [0.0, 0.0, 280.0]),
            (50, 1, [0.0, 0.0, 1900.0]),
        ] {
            optimized.spawn_unit(id, "su_t72a", team, pos, 0.0).unwrap();
            optimized
                .set_input(
                    id,
                    SimInput {
                        brake: 1.0,
                        ..Default::default()
                    },
                )
                .unwrap();
        }
        optimized.destroy_unit_for_frontline_test(15);
        optimized
            .set_input(
                5,
                SimInput {
                    throttle: 0.3,
                    ..Default::default()
                },
            )
            .unwrap();
        let mut reference = optimized.clone();
        let initial = optimized.snapshots();
        let bodies = optimized.kinematics();
        let origin = bodies.iter().find(|s| s.id == 10).unwrap().pos;
        assert_eq!(
            distance(bodies.iter().find(|s| s.id == 20).unwrap().pos, origin).to_bits(),
            distance(bodies.iter().find(|s| s.id == 30).unwrap().pos, origin).to_bits()
        );
        let (mut new_checks, mut old_checks) = (0, 0);
        let actual = select(&optimized, &bodies, origin, false, &mut new_checks).map(|s| s.id);
        let expected = select(&reference, &bodies, origin, true, &mut old_checks).map(|s| s.id);
        assert_eq!(actual, expected, "{scene} original selector");
        assert_eq!(
            actual,
            match scene {
                "clear" => Some(20),
                "left_blocked" => Some(30),
                _ => None,
            }
        );
        if scene != "all_blocked" {
            assert!(
                new_checks < old_checks,
                "{scene}: only dominated LOS queries may be skipped"
            );
        } else {
            assert_eq!(new_checks, old_checks);
        }
        let mut accepted_shots = 0;
        let mut impacts = 0;
        for tick in 0..90 {
            let a = step(&mut optimized, false);
            let b = step(&mut reference, true);
            assert_eq!(a.0, b.0, "{scene} tick{tick} target");
            assert_eq!(a.1, b.1, "{scene} tick{tick} native shots/contacts/damage");
            assert!(
                a.2 <= b.2,
                "Nearest-first never needs additional native LOS queries"
            );
            accepted_shots += a.1.iter().filter(|e| e["kind"] == "shot").count();
            impacts += a.1.iter().filter(|e| e["kind"] == "impact").count();
            assert_eq!(
                serde_json::to_vec(&optimized.snapshots()).unwrap(),
                serde_json::to_vec(&reference.snapshots()).unwrap(),
                "{scene} tick{tick}: all native poses, turret, reload, ammo, damage and caps"
            );
            assert_eq!(optimized.time().to_bits(), reference.time().to_bits());
        }
        let after = optimized.snapshots();
        let mover = after.iter().find(|s| s.id == 5).unwrap();
        assert!(distance(mover.pos, initial.iter().find(|s| s.id == 5).unwrap().pos) > 1.0);
        if scene != "all_blocked" {
            assert!(
                accepted_shots > 0,
                "{scene} actual mounted ammunition must be spent"
            );
            assert!(
                impacts > 0,
                "{scene} actual native plate/box contact must execute"
            );
            assert!(
                after.iter().find(|s| s.id == 10).unwrap().ammo
                    < initial.iter().find(|s| s.id == 10).unwrap().ammo
            );
            assert!(
                after.iter().filter(|s| s.team == 1 && s.id != 15).any(|s| {
                    s.damage != initial.iter().find(|old| old.id == s.id).unwrap().damage
                }),
                "{scene} native damage must change and remain equal to the old path"
            );
        } else {
            assert_eq!(accepted_shots, 0);
        }
        eprintln!("{scene}:90 native20Hz steps, first LOS {new_checks}/{old_checks}, mountedshots{accepted_shots}, nativeimpacts{impacts}, exact accepted state parity");
    }
}

fn data() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")
}
fn hub(observer: bool) -> FrontlineHub {
    let mut h = FrontlineHub::new(&data()).unwrap();
    h.use_c2_test_scene().unwrap();
    let out = h.handle(
        1,
        Command::Create {
            name: "Native domain fixture".into(),
            map: "korea".into(),
            observer,
            era: 1986,
        },
        0.0,
    );
    assert!(
        !out.iter().any(|(_, m)| matches!(m, Update::Error { .. })),
        "create: {out:?}"
    );
    let out = h.handle(1, Command::Start, 0.0);
    assert!(
        !out.iter().any(|(_, m)| matches!(m, Update::Error { .. })),
        "start: {out:?}"
    );
    h
}
fn error(out: &[(u32, Update)], expected: &str) {
    assert!(
        out.iter()
            .any(|(_, m)| matches!(m, Update::Error { code, .. } if code == expected)),
        "expected {expected}, got {out:?}"
    );
}
fn deploy(h: &mut FrontlineHub) -> (u64, UnitRef, u64) {
    let out = h.handle(
        1,
        Command::Deploy {
            vehicle: "su_t72a".into(),
        },
        0.0,
    );
    assert!(
        !out.iter().any(|(_, m)| matches!(m, Update::Error { .. })),
        "deploy: {out:?}"
    );
    let room = &h.rooms[&h.membership[&1]];
    let p = &room.members[&1].view;
    (p.company.unwrap(), p.controlled.unwrap(), p.epoch)
}

fn route_distance(route: &[[f64; 2]], p: [f64; 3]) -> f64 {
    let mut along = 0.0;
    let mut best = (f64::INFINITY, 0.0);
    for segment in route.windows(2) {
        let a = segment[0];
        let b = segment[1];
        let d = [b[0] - a[0], b[1] - a[1]];
        let length = d[0].hypot(d[1]);
        let t = if length > 0.0 {
            (((p[0] - a[0]) * d[0] + (p[2] - a[1]) * d[1]) / (length * length)).clamp(0.0, 1.0)
        } else {
            0.0
        };
        let offset = (p[0] - a[0] - d[0] * t).hypot(p[2] - a[1] - d[1] * t);
        if offset < best.0 {
            best = (offset, along + length * t);
        }
        along += length;
    }
    best.1
}

fn full_hub(observer: bool) -> FrontlineHub {
    let mut h = FrontlineHub::new(&data()).unwrap();
    h.enable_legacy_ground_for_test();
    let out = h.handle(
        1,
        Command::Create {
            name: "Three physical Korean fronts".into(),
            map: "korea".into(),
            observer,
            era: 1986,
        },
        0.0,
    );
    assert!(
        !out.iter().any(|(_, u)| matches!(u, Update::Error { .. })),
        "{out:?}"
    );
    assert_eq!(
        h.rooms[&1].objectives.len(),
        15,
        "The full scenario must not masquerade as the C2 fixture"
    );
    let out = h.handle(1, Command::Start, 0.0);
    assert!(
        !out.iter().any(|(_, u)| matches!(u, Update::Error { .. })),
        "{out:?}"
    );
    h
}

#[test]
fn full_single_observer_starts_sixty_native_tanks_and_each_front_physically_advances() {
    let mut h = full_hub(true);
    let room = &h.rooms[&1];
    assert_eq!(
        room.units.values().filter(|u| u.support.is_none()).count(),
        60
    );
    assert_eq!(room.companies.len(), 6);
    assert_eq!(room.members.len(), 1);
    assert_eq!(
        room.objectives
            .iter()
            .map(|o| o.lane.as_str())
            .collect::<BTreeSet<_>>(),
        BTreeSet::from(["west", "centre", "east"])
    );
    let before = room.sim.snapshots();
    let plans: BTreeMap<_, _> = room
        .units
        .values()
        .filter(|u| u.support.is_none())
        .map(|u| {
            (
                u.reference.unit,
                u.navigation.clone().expect("registered path"),
            )
        })
        .collect();
    let companies = room.company_views();
    for team in [Team::Blue, Team::Red] {
        for front in ["west", "centre", "east"] {
            let group: Vec<_> = companies
                .iter()
                .filter(|c| c.team == team && c.front == front)
                .collect();
            assert_eq!(group.len(), 1);
            assert_eq!(group[0].units.len(), 10);
            assert!(group[0].autonomous && group[0].owner.is_none());
        }
    }
    for i in 1..=160 {
        h.tick(i as f64 * STEP + 1e-8);
    }
    let room = &h.rooms[&1];
    let after = room.sim.snapshots();
    for company in &companies {
        let advanced: BTreeSet<_> = company
            .units
            .iter()
            .filter(|reference| {
                let initial = before.iter().find(|u| u.id == reference.unit).unwrap();
                let current = after.iter().find(|u| u.id == reference.unit).unwrap();
                let path = &plans[&reference.unit].points;
                current.alive
                    && distance(initial.pos, current.pos) > 5.0
                    && route_distance(path, current.pos) - route_distance(path, initial.pos) > 3.0
            })
            .map(|reference| reference.unit)
            .collect();
        assert!(
            advanced.len() >= 3,
            "{:?} {} must physically move three accepted tanks along its own road, got {advanced:?}",
            company.team,
            company.front
        );
        for platoon in &company.platoons {
            assert!(
                platoon.iter().any(|u| advanced.contains(&u.unit)),
                "{:?} {} must advance at least one native body from every actual platoon",
                company.team,
                company.front
            );
        }
        eprintln!("native front {:?}/{}: {}/10 tanks advanced >5m and >3m along registered path, all3platoons", company.team, company.front, advanced.len());
    }
    assert!(room.members[&1].view.observer && room.members[&1].view.controlled.is_none());

    // Closing a registered edge invalidates an existing AI plan. The accepted
    // native brakes, rather than a pose rewrite, must arrest its live vehicles.
    let company = companies
        .iter()
        .find(|c| c.team == Team::Blue && c.front == "west")
        .unwrap();
    let ids: Vec<_> = company.units.iter().map(|u| u.unit).collect();
    let road = plans[&ids[0]].roads[0].clone();
    let room = h.rooms.get_mut(&1).unwrap();
    room.campaign
        .close_route(&road, &mut room.objectives)
        .unwrap();
    for i in 161..=220 {
        h.tick(i as f64 * STEP + 1e-8);
    }
    let room = &h.rooms[&1];
    for id in ids {
        let s = room.sim.snapshot(id).unwrap();
        assert!(
            s.velocity[0].hypot(s.velocity[2]) < 0.3,
            "Closed-route native brakes must stop {id}: {:?}",
            s.velocity
        );
        assert!(
            room.units[&id].navigation.is_none(),
            "A closed route cannot retain an advance plan"
        );
    }
}

#[test]
fn full_deployment_front_and_platoon_path_admission_are_authoritative() {
    let mut h = full_hub(false);
    let (source, foreign) = {
        let room = &h.rooms[&1];
        (
            room.staging
                .iter()
                .find(|s| s.team == Team::Blue && s.front == "west")
                .unwrap()
                .id
                .clone(),
            room.staging
                .iter()
                .find(|s| s.team == Team::Red && s.front == "west")
                .unwrap()
                .id
                .clone(),
        )
    };
    let count = h.rooms[&1].units.len();
    error(
        &h.handle(
            1,
            Command::DeployAt {
                vehicle: "su_t72a".into(),
                staging: foreign,
            },
            0.0,
        ),
        "foreign_staging",
    );
    error(
        &h.handle(
            1,
            Command::DeployAt {
                vehicle: "su_t72a".into(),
                staging: "unknown".into(),
            },
            0.0,
        ),
        "unknown_staging",
    );
    assert_eq!(h.rooms[&1].units.len(), count);
    let out = h.handle(
        1,
        Command::DeployAt {
            vehicle: "su_t72a".into(),
            staging: source.clone(),
        },
        0.0,
    );
    assert!(
        !out.iter().any(|(_, u)| matches!(u, Update::Error { .. })),
        "{out:?}"
    );
    let company = h.rooms[&1].members[&1].view.company.unwrap();
    assert_eq!(h.rooms[&1].companies[&company].view.front, "west");
    assert_eq!(h.rooms[&1].companies[&company].view.staging, source);
    let west = h.rooms[&1]
        .objectives
        .iter()
        .find(|o| o.id == "W2")
        .unwrap()
        .pos;
    let out = h.handle(
        1,
        Command::Order {
            company,
            platoons: vec![0],
            kind: OrderKind::Attack,
            target: [west[0], west[2]],
            seq: 1,
        },
        0.0,
    );
    assert!(
        !out.iter().any(|(_, u)| matches!(u, Update::Error { .. })),
        "{out:?}"
    );
    let order = h.rooms[&1].companies[&company]
        .view
        .orders
        .iter()
        .find(|o| o.platoon == Some(0))
        .unwrap();
    assert_eq!(order.front, "west");
    assert!(order
        .routes
        .iter()
        .all(|id| h.rooms[&1].campaign.route_open(id)));
    let east = h.rooms[&1]
        .objectives
        .iter()
        .find(|o| o.id == "E2")
        .unwrap()
        .pos;
    error(
        &h.handle(
            1,
            Command::Order {
                company,
                platoons: vec![1],
                kind: OrderKind::Attack,
                target: [east[0], east[2]],
                seq: 2,
            },
            0.0,
        ),
        "route_unreachable",
    );
    assert_eq!(
        h.rooms[&1].companies[&company].last_order_seq, 1,
        "Rejected cross-front order must not consume authority sequence"
    );
    let room = h.rooms.get_mut(&1).unwrap();
    let road = room
        .staging
        .iter()
        .find(|s| s.id == source)
        .unwrap()
        .road
        .clone();
    room.campaign
        .close_route(&road, &mut room.objectives)
        .unwrap();
    assert!(!room
        .staging
        .iter()
        .find(|s| s.id == source)
        .is_some_and(|s| room.staging_available(s)));
}

#[test]
fn observer_starts_two_real_ai_companies_without_player_vehicles() {
    let mut h = hub(true);
    let room = &h.rooms[&1];
    assert_eq!(room.units.len(), 20);
    assert_eq!(room.members.len(), 1);
    assert!(room
        .companies
        .values()
        .all(|c| c.view.autonomous && c.view.owner.is_none()));
    assert!(room.units.values().all(|u| u.controller.is_none()));
    let route = room.route.clone();
    let target = room.target(Team::Blue);
    let goal = route_distance(&route, [target[0], 0.0, target[1]]);
    let before = room.sim.snapshots();
    for i in 1..=160 {
        h.tick(i as f64 * STEP + 1e-8);
    }
    let after = h.rooms[&1].sim.snapshots();
    for team in [0, 1] {
        let progress: Vec<_> = before
            .iter()
            .filter(|u| u.team == team)
            .map(|initial| {
                let current = after.iter().find(|u| u.id == initial.id).unwrap();
                let gained = (goal - route_distance(&route, initial.pos)).abs()
                    - (goal - route_distance(&route, current.pos)).abs();
                (initial.id, distance(initial.pos, current.pos), gained)
            })
            .collect();
        assert!(progress.iter().filter(|(_, horizontal, gained)| *horizontal > 5.0 && *gained > 3.0).count() >= 3,
            "team {team} must physically advance at least three tanks along the native road toward C2 over 8 s, rather than merely settle: {progress:?}");
    }
    error(
        &h.handle(
            1,
            Command::Deploy {
                vehicle: "su_t72a".into(),
            },
            1.0,
        ),
        "observer",
    );
    assert_eq!(h.rooms[&1].units.len(), 20);
}

#[test]
fn human_ownership_stale_epochs_and_three_platoon_orders_use_real_hub_dispatch() {
    let mut h = hub(false);
    let (company, unit, epoch) = deploy(&mut h);
    assert_eq!(h.rooms[&1].units.len(), 30);
    assert_eq!(
        h.rooms[&1].companies[&company]
            .view
            .platoons
            .clone()
            .map(|p| p.len()),
        [3, 3, 3]
    );
    let survivor = h.rooms[&1].companies[&company].view.units[1];
    error(
        &h.handle(1, Command::Takeover { unit: survivor }, 0.0),
        "no_loss_gate",
    );
    h.handle(
        2,
        Command::Join {
            room: 1,
            observer: false,
            team: Some(Team::Red),
        },
        0.0,
    );
    let input = |epoch, seq| Command::Input {
        unit,
        epoch,
        seq,
        throttle: 0.5,
        steer: 0.0,
        brake: 0.0,
        turret_yaw: 0.0,
        gun_pitch: 0.0,
        fire: true,
    };
    error(&h.handle(2, input(epoch, 1), 0.1), "stale_control");
    error(&h.handle(1, input(epoch - 1, 1), 0.1), "stale_control");
    assert!(h.handle(1, input(epoch, 1), 0.1).is_empty());
    error(&h.handle(1, input(epoch, 1), 0.1), "stale_input");
    error(
        &h.handle(
            2,
            Command::Order {
                company,
                platoons: vec![0],
                kind: OrderKind::Move,
                target: [1490.0, -3717.0],
                seq: 1,
            },
            0.1,
        ),
        "not_owner",
    );
    assert!(!h
        .handle(
            1,
            Command::Order {
                company,
                platoons: vec![0, 2],
                kind: OrderKind::Defend,
                target: [1490.0, -3717.0],
                seq: 1
            },
            0.1
        )
        .is_empty());
    assert_eq!(h.rooms[&1].members[&1].view.controlled, Some(unit));
    assert_eq!(h.rooms[&1].units[&unit.unit].controller, Some(1));
}

#[test]
fn native_loss_then_takeover_preserves_survivor_state_and_charges_once() {
    let mut h = hub(false);
    let (company, lost, old_epoch) = deploy(&mut h);
    let survivor = h.rooms[&1].companies[&company].view.units[1];
    {
        let room = h.rooms.get_mut(&1).unwrap();
        room.sim
            .set_input(
                survivor.unit,
                SimInput {
                    throttle: 0.5,
                    steer: 0.0,
                    brake: 0.0,
                    turret_yaw: None,
                    gun_pitch: None,
                },
            )
            .unwrap();
        room.sim.fire(survivor.unit, None).unwrap();
        room.sim.step(0.05);
        room.sim.damage_unit_for_frontline_test(survivor.unit);
        // A test-only native crew-loss fixture; production destruction still comes from combat.
        room.sim.destroy_unit_for_frontline_test(lost.unit);
    }
    h.tick(0.05 + 1e-8);
    let before = h.rooms[&1].sim.snapshot(survivor.unit).unwrap();
    assert_eq!(h.rooms[&1].members[&1].gate, Gate::Loss);
    assert_eq!(h.rooms[&1].readiness, [990, 1000]);
    let out = h.handle(1, Command::Takeover { unit: survivor }, 0.06);
    assert!(
        !out.iter().any(|(_, m)| matches!(m, Update::Error { .. })),
        "{out:?}"
    );
    let room = &h.rooms[&1];
    let after = room.sim.snapshot(survivor.unit).unwrap();
    assert_eq!(before.pos, after.pos);
    assert_eq!(before.ammo_counts, after.ammo_counts);
    assert_eq!(before.damage, after.damage);
    assert_eq!(before.ammo_revision, after.ammo_revision);
    assert_eq!(before.reload_s, after.reload_s);
    assert_eq!(before.caps, after.caps);
    assert!(before.caps["drive_power"].as_f64().is_some_and(|v| v < 1.0));
    assert_eq!(room.members[&1].view.controlled, Some(survivor));
    assert!(room.members[&1].view.epoch > old_epoch);
    assert_eq!(
        room.companies[&company]
            .view
            .units
            .iter()
            .filter(|r| room.sim.snapshot(r.unit).unwrap().alive)
            .count(),
        9
    );
    h.tick(0.1 + 1e-8);
    assert_eq!(h.rooms[&1].readiness, [990, 1000]);
    assert_eq!(h.rooms[&1].units.len(), 30);
}

#[test]
fn disconnect_beyond_legacy_grace_resumes_same_company_without_rearm_or_clone() {
    let mut h = hub(false);
    let (company, unit, epoch) = deploy(&mut h);
    h.rooms
        .get_mut(&1)
        .unwrap()
        .sim
        .fire(unit.unit, None)
        .unwrap();
    let before = h.rooms[&1].sim.snapshot(unit.unit).unwrap();
    h.disconnect(1, 0.1);
    assert!(h.contains(1));
    assert_eq!(h.rooms[&1].units[&unit.unit].controller, None);
    let out = h.resume(1, 30.0);
    assert!(out
        .iter()
        .any(|(_, m)| matches!(m, Update::Control { unit: Some(r), .. } if *r == unit)));
    let room = &h.rooms[&1];
    let after = room.sim.snapshot(unit.unit).unwrap();
    assert_eq!(room.members[&1].view.company, Some(company));
    assert!(room.members[&1].view.epoch > epoch);
    assert_eq!(before.pos, after.pos);
    assert_eq!(before.ammo_counts, after.ammo_counts);
    assert_eq!(before.damage, after.damage);
    assert_eq!(room.units.len(), 30);
    error(
        &h.handle(
            1,
            Command::Deploy {
                vehicle: "su_t72a".into(),
            },
            30.0,
        ),
        "already_controlled",
    );
}

#[test]
fn explicit_leave_rejoin_keeps_the_same_control_or_loss_gate_without_role_escape() {
    let mut h = hub(false);
    let (company, original, epoch) = deploy(&mut h);
    h.handle(
        2,
        Command::Join {
            room: 1,
            observer: true,
            team: None,
        },
        0.0,
    );
    h.rooms
        .get_mut(&1)
        .unwrap()
        .sim
        .fire(original.unit, None)
        .unwrap();
    let before = h.rooms[&1].sim.snapshot(original.unit).unwrap();
    h.leave(1);
    assert!(!h.contains(1));
    assert_eq!(h.rooms[&1].units.len(), 30);
    error(
        &h.handle(
            1,
            Command::Join {
                room: 1,
                observer: true,
                team: None,
            },
            0.1,
        ),
        "owned_company",
    );
    h.handle(
        1,
        Command::Join {
            room: 1,
            observer: false,
            team: Some(Team::Red),
        },
        0.1,
    );
    let room = &h.rooms[&1];
    let p = &room.members[&1];
    assert_eq!(p.view.team, Team::Blue);
    assert_eq!(p.view.controlled, Some(original));
    assert_eq!(p.view.company, Some(company));
    assert!(p.view.epoch > epoch);
    let restored = room.sim.snapshot(original.unit).unwrap();
    assert_eq!(before.pos, restored.pos);
    assert_eq!(before.ammo_counts, restored.ammo_counts);
    let survivor = room.companies[&company].view.units[1];
    error(
        &h.handle(1, Command::Takeover { unit: survivor }, 0.1),
        "no_loss_gate",
    );
    error(
        &h.handle(
            1,
            Command::Input {
                unit: original,
                epoch,
                seq: 99,
                throttle: 1.0,
                steer: 0.0,
                brake: 0.0,
                turret_yaw: 0.0,
                gun_pitch: 0.0,
                fire: true,
            },
            0.1,
        ),
        "stale_control",
    );
    h.leave(1);
    h.rooms
        .get_mut(&1)
        .unwrap()
        .sim
        .destroy_unit_for_frontline_test(original.unit);
    h.tick(0.15);
    assert_eq!(h.rooms[&1].departed[&1].gate, Gate::Loss);
    h.handle(
        1,
        Command::Join {
            room: 1,
            observer: false,
            team: None,
        },
        0.16,
    );
    assert_eq!(h.rooms[&1].members[&1].gate, Gate::Loss);
    let out = h.handle(1, Command::Takeover { unit: survivor }, 0.16);
    assert!(
        !out.iter().any(|(_, m)| matches!(m, Update::Error { .. })),
        "{out:?}"
    );
    assert_eq!(h.rooms[&1].members[&1].view.controlled, Some(survivor));
    assert_eq!(h.rooms[&1].units.len(), 30);
    assert_eq!(h.rooms[&1].readiness, [990, 1000]);
}

#[test]
fn last_explicit_leave_and_unobserved_retention_retire_worlds_without_faking_a_round() {
    let mut h = hub(true);
    h.leave(1);
    assert!(h.rooms.is_empty());
    assert!(!h.contains(1));
    let mut h = hub(false);
    deploy(&mut h);
    h.disconnect(1, 0.1);
    assert!(h.contains(1));
    assert_eq!(h.rooms.len(), 1);
    h.tick(ROUND_SECONDS + 0.1);
    assert!(h.rooms.is_empty());
    assert!(!h.contains(1));
    error(
        &h.handle(1, Command::Snapshot, ROUND_SECONDS + 0.2),
        "not_joined",
    );
    // A room that never started has no round clock to retire it. Preserve the
    // retry window, but do not hold empty waiting-room capacity forever.
    let mut h = FrontlineHub::new(&data()).unwrap();
    h.handle(
        1,
        Command::Create {
            name: "Waiting".into(),
            map: "korea".into(),
            observer: true,
            era: 1986,
        },
        10.0,
    );
    h.disconnect(1, 11.0);
    h.tick(11.0 + WAITING_ROOM_GRACE - 1.0);
    assert!(h.contains(1));
    h.tick(11.0 + WAITING_ROOM_GRACE + 1.0);
    assert!(h.rooms.is_empty());
    assert!(!h.contains(1));
}

// Isolate one real company for long accepted-clock fixtures. Production startup
// remains covered separately by the sixty-body/three-front tests above.
fn reinforcement_hub() -> (FrontlineHub, u64, UnitRef, u64) {
    let mut h = hub(false);
    let ids: Vec<_> = h.rooms[&1].companies.keys().copied().collect();
    let room = h.rooms.get_mut(&1).unwrap();
    for id in ids {
        room.remove_company(id);
    }
    room.air.units.clear();
    let (company, unit, epoch) = deploy(&mut h);
    (h, company, unit, epoch)
}
fn no_error(messages: &[(u32, Update)]) {
    assert!(
        !messages
            .iter()
            .any(|(_, m)| matches!(m, Update::Error { .. })),
        "{messages:?}"
    );
}
fn reinforcement(h: &FrontlineHub, company: u64) -> ReinforcementView {
    h.rooms[&1]
        .company_views()
        .into_iter()
        .find(|c| c.id == company)
        .unwrap()
        .reinforcement
}

#[test]
fn physical_reinforcement_batch_waits_forty_five_native_seconds_and_preserves_flying_commanders_company(
) {
    let (mut h, company, original, epoch) = reinforcement_hub();
    let source = h.rooms[&1]
        .staging
        .iter()
        .find(|s| s.id == h.rooms[&1].companies[&company].view.staging)
        .unwrap()
        .clone();
    let target = h.rooms[&1].units[&h.rooms[&1].companies[&company].view.units[5].unit]
        .navigation
        .as_ref()
        .unwrap()
        .point_after(160.0);
    no_error(&h.handle(
        1,
        Command::Order {
            company,
            platoons: vec![0, 1, 2],
            kind: OrderKind::Move,
            target,
            seq: 1,
        },
        0.0,
    ));
    no_error(&h.handle(
        1,
        Command::Input {
            unit: original,
            epoch,
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
    h.tick(STEP + 1e-8);
    let before = h.rooms[&1].sim.snapshot(original.unit).unwrap();
    assert_eq!(
        before.ammo, 21,
        "Actual mounted shot, not an inventory fixture"
    );
    h.rooms
        .get_mut(&1)
        .unwrap()
        .sim
        .damage_unit_for_frontline_test(original.unit);
    let survivor = h.rooms[&1].sim.snapshot(original.unit).unwrap();
    let old = h.rooms[&1].companies[&company].view.units.clone();
    let lost = old[1..5].to_vec();
    for r in &lost {
        h.rooms
            .get_mut(&1)
            .unwrap()
            .sim
            .destroy_unit_for_frontline_test(r.unit);
    }
    no_error(&h.handle(
        1,
        Command::Input {
            unit: original,
            epoch,
            seq: 2,
            throttle: 0.0,
            steer: 0.0,
            brake: 1.0,
            turret_yaw: 0.0,
            gun_pitch: 0.0,
            fire: false,
        },
        STEP,
    ));
    no_error(&h.handle(1, Command::Return, STEP));
    no_error(&h.handle(
        1,
        Command::DeployAir { custom_counts: None,
            aircraft: "mig21".into(),
            spawn: "air".into(),
            loadout: 0,
            custom: None, fuel_minutes: None,
        },
        STEP,
    ));
    let plane = h.rooms[&1].members[&1].view.controlled.unwrap();
    let plane_epoch = h.rooms[&1].members[&1].view.epoch;
    let heading = h.rooms[&1]
        .air
        .views()
        .into_iter()
        .find(|v| v.unit == plane)
        .unwrap()
        .state[20];
    let flight_aim = [heading.sin(), 0.05, heading.cos()];
    let mut batch_events = 0;
    let mut joined = false;
    for i in 2..=900 {
        let now = i as f64 * STEP;
        no_error(&h.handle(
            1,
            Command::AirInput {
                unit: plane,
                epoch: plane_epoch,
                seq: i,
                aim: flight_aim,
                throttle: 0.85,
                manual_pitch: 0.0,
                manual_roll: 0.0,
                manual_yaw: 0.0,
                flags: 1,
                fire: false,
                release: false,
            },
            now,
        ));
        for (_, m) in h.tick(now + 1e-8) {
            if let Update::Frame { events, .. } = m {
                batch_events += events
                    .iter()
                    .filter(|e| e["kind"] == "reinforcement_batch" && e["company"] == company)
                    .count();
            }
        }
        if i < 900 {
            assert_eq!(
                h.rooms[&1].units.len(),
                10,
                "No grant before45 accepted native seconds"
            );
        }
    }
    assert_eq!(batch_events, 1);
    let room = &h.rooms[&1];
    assert_eq!(room.companies.len(), 1);
    assert_eq!(room.companies[&company].view.units.len(), 10);
    assert_eq!(
        room.units.len(),
        13,
        "Three new native bodies; four retained old wrecks"
    );
    assert_eq!(room.readiness[0], 1000 - 4 * LOSS_COST);
    let v = reinforcement(&h, company);
    assert_eq!((v.pending, v.incoming), (1, 3));
    assert!((v.next_batch_s - 45.0).abs() < 1e-6);
    let new: Vec<_> = room.companies[&company]
        .view
        .units
        .iter()
        .copied()
        .filter(|r| !old.contains(r))
        .collect();
    assert_eq!(new.len(), 3);
    let initial: Vec<_> = new
        .iter()
        .map(|r| {
            let s = room.sim.snapshot(r.unit).unwrap();
            assert_eq!(s.ammo, 22);
            assert!(
                source.slots.iter().any(|p| distance(*p, s.pos) < 0.01),
                "Only physical rear source slots grant vehicles"
            );
            assert!(room.units[&r.unit].reinforcing && room.units[&r.unit].platoon == Some(0));
            assert_eq!(r.life, 1);
            assert_eq!(r.battle, original.battle);
            s
        })
        .collect();
    for r in &lost {
        assert!(!room.sim.unit_alive(r.unit));
        assert!(room.units[&r.unit].loss_counted);
    }
    let after = room.sim.snapshot(original.unit).unwrap();
    assert_eq!(after.ammo_counts, survivor.ammo_counts);
    assert_eq!(after.damage["modules"], survivor.damage["modules"]);
    assert_eq!(room.members[&1].view.company, Some(company));
    assert_eq!(room.members[&1].view.controlled, Some(plane));
    assert!(room.air.units[&plane.unit].alive());
    // Duplicate broadcasts and an unchanged clock cannot grant the fourth vacancy.
    for _ in 0..5 {
        h.tick(45.0 + 1e-8);
    }
    assert_eq!(h.rooms[&1].units.len(), 13);
    for i in 901..=1400 {
        let now = i as f64 * STEP;
        no_error(&h.handle(
            1,
            Command::AirInput {
                unit: plane,
                epoch: plane_epoch,
                seq: i,
                aim: flight_aim,
                throttle: 0.85,
                manual_pitch: 0.0,
                manual_roll: 0.0,
                manual_yaw: 0.0,
                flags: 1,
                fire: false,
                release: false,
            },
            now,
        ));
        for (_, m) in h.tick(now + 1e-8) {
            if let Update::Frame { events, .. } = m {
                joined |= events.iter().any(|e| {
                    e["kind"] == "reinforcement_joined" && new.iter().any(|r| e["unit"] == json!(r))
                });
                assert!(!events.iter().any(|e| e["kind"] == "reinforcement_batch"));
            }
        }
    }
    let room = &h.rooms[&1];
    assert!(
        joined,
        "A replacement must reach its actual platoon/order proximity by native driving"
    );
    assert!(
        new.iter()
            .zip(&initial)
            .all(|(r, s)| distance(room.sim.snapshot(r.unit).unwrap().pos, s.pos) > 10.0),
        "All incoming tanks must physically leave the rear source"
    );
    assert_eq!(room.units.len(), 13);
    assert_eq!(reinforcement(&h, company).pending, 1);
    assert_eq!(
        room.readiness[0],
        1000 - 4 * LOSS_COST,
        "No repeated loss charge or personal reinforcement currency"
    );
    let room = h.rooms.get_mut(&1).unwrap();
    room.campaign
        .close_route(&source.road, &mut room.objectives)
        .unwrap();
    for i in 1401..=1460 {
        h.tick(i as f64 * STEP + 1e-8);
    }
    for r in &new {
        let s = h.rooms[&1].sim.snapshot(r.unit).unwrap();
        assert!(
            s.velocity[0].hypot(s.velocity[2]) < 0.3,
            "Real replacement bodies must stop at a closed registered route"
        );
        assert!(h.rooms[&1].units[&r.unit].navigation.is_none());
        assert_eq!(s.ammo, 22);
    }
}

#[test]
fn reinforcement_due_batch_defers_occupied_unsupplied_and_exhausted_sources_without_grant() {
    let (mut h, company, _, _) = reinforcement_hub();
    let dead = h.rooms[&1].companies[&company].view.units[1..4].to_vec();
    for r in &dead {
        h.rooms
            .get_mut(&1)
            .unwrap()
            .sim
            .destroy_unit_for_frontline_test(r.unit);
    }
    // Eligibility fixture is already due; the45-second clock is tested above.
    h.rooms
        .get_mut(&1)
        .unwrap()
        .companies
        .get_mut(&company)
        .unwrap()
        .reinforcement_next = 0.0;
    h.tick(STEP + 1e-8);
    assert_eq!(reinforcement(&h, company).status, "source_occupied");
    assert_eq!(h.rooms[&1].units.len(), 10);
    let room = h.rooms.get_mut(&1).unwrap();
    let road = room
        .staging
        .iter()
        .find(|s| s.id == room.companies[&company].view.staging)
        .unwrap()
        .road
        .clone();
    room.campaign
        .close_route(&road, &mut room.objectives)
        .unwrap();
    room.companies
        .get_mut(&company)
        .unwrap()
        .reinforcement_retry = 0.0;
    h.tick(2.0 * STEP + 1e-8);
    assert_eq!(reinforcement(&h, company).status, "source_unavailable");
    let room = h.rooms.get_mut(&1).unwrap();
    room.readiness[0] = 0;
    room.companies
        .get_mut(&company)
        .unwrap()
        .reinforcement_retry = 0.0;
    h.tick(3.0 * STEP + 1e-8);
    assert_eq!(reinforcement(&h, company).status, "readiness_exhausted");
    assert_eq!(h.rooms[&1].units.len(), 10);
    assert_eq!(h.rooms[&1].companies.len(), 1);
    assert!(dead
        .iter()
        .all(|r| h.rooms[&1].units.contains_key(&r.unit) && !h.rooms[&1].sim.unit_alive(r.unit)));
}

#[test]
fn reinforcement_cannot_follow_a_cut_distant_edge_or_wall_clock_jump() {
    let mut h = full_hub(false);
    let room = h.rooms.get_mut(&1).unwrap();
    for c in room.companies.keys().copied().collect::<Vec<_>>() {
        room.remove_company(c);
    }
    room.air.units.clear();
    no_error(&h.handle(
        1,
        Command::DeployAt {
            vehicle: "su_t72a".into(),
            staging: "B-WEST-FRONT".into(),
        },
        0.0,
    ));
    let company = h.rooms[&1].members[&1].view.company.unwrap();
    let target = h.rooms[&1]
        .objectives
        .iter()
        .find(|o| o.id == "W3")
        .unwrap()
        .pos;
    no_error(&h.handle(
        1,
        Command::Order {
            company,
            platoons: vec![0, 1, 2],
            kind: OrderKind::Attack,
            target: [target[0], target[2]],
            seq: 1,
        },
        0.0,
    ));
    no_error(&h.handle(1, Command::Return, 0.0));
    for i in 1..=200 {
        h.tick(i as f64 * STEP + 1e-8);
    }
    let room = h.rooms.get_mut(&1).unwrap();
    // The original company physically cleared rear slots. A wiped company has
    // no rear survivor to regroup with, so its accepted last order needs the
    // forward edge; a source-side spawn is not a substitute for that route.
    for r in room.companies[&company].view.units.clone() {
        room.sim.destroy_unit_for_frontline_test(r.unit);
    }
    room.campaign
        .close_route("west:W2-W3", &mut room.objectives)
        .unwrap();
    assert!(
        room.staging_views()
            .iter()
            .any(|s| s.id == "B-WEST-FRONT" && s.available),
        "Rear source remains supplied; only the forward join route was cut"
    );
    room.companies.get_mut(&company).unwrap().reinforcement_next = room.sim.time();
    h.tick(201.0 * STEP + 1e-8);
    assert_eq!(reinforcement(&h, company).status, "route_blocked");
    assert_eq!(
        h.rooms[&1]
            .units
            .values()
            .filter(|u| u.support.is_none())
            .count(),
        10
    );
    assert_eq!(
        h.rooms[&1]
            .units
            .values()
            .filter(|u| u.support.is_some())
            .count(),
        16
    );
    // Fresh due schedule: a large wall-now jump executes at most four accepted
    // steps, and cannot fake45 native seconds or award an overdue batch.
    let room = h.rooms.get_mut(&1).unwrap();
    room.companies.get_mut(&company).unwrap().reinforcement_next = room.sim.time() + 45.0;
    let clock = room.sim.time();
    h.tick(10000.0);
    assert!(h.rooms[&1].sim.time() - clock < 0.21);
    assert_eq!(
        h.rooms[&1]
            .units
            .values()
            .filter(|u| u.support.is_none())
            .count(),
        10
    );
}
