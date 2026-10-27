use super::*;
#[test]
fn actual_team_support_dispatch_checks_role_life_revision_and_sequence_without_grants() {
    let data = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let mut h = FrontlineHub::new(&data).unwrap();
    h.enable_legacy_ground_for_test();
    let accepted = |out: &[(u32, Update)]| {
        assert!(
            !out.iter().any(|(_, u)| matches!(u, Update::Error { .. })),
            "{out:?}"
        )
    };
    accepted(&h.handle(
        1,
        Command::Create {
            name: "Support admission".into(),
            map: "korea".into(),
            observer: false,
            era: 1986,
        },
        0.0,
    ));
    let room = h.membership[&1];
    accepted(&h.handle(
        2,
        Command::Join {
            room,
            observer: true,
            team: None,
        },
        0.0,
    ));
    accepted(&h.handle(
        3,
        Command::Join {
            room,
            observer: false,
            team: Some(Team::Red),
        },
        0.0,
    ));
    accepted(&h.handle(1, Command::Start, 0.0));
    assert_eq!(
        h.rooms[&room]
            .units
            .values()
            .filter(|u| u.support.is_some())
            .count(),
        16
    );
    let engineer = h.rooms[&room]
        .units
        .values()
        .find(|u| u.team == Team::Blue && u.support.as_ref().is_some_and(|a| a.role == "engineer"))
        .unwrap()
        .reference;
    let facility = h.rooms[&room]
        .sim
        .facility_views()
        .into_iter()
        .find(|f| f.team == Some(0) && f.kind == crate::frontline_facilities::FacilityKind::Fuel)
        .unwrap();
    let before = h.rooms[&room].sim.snapshot(engineer.unit).unwrap();
    let clock = h.rooms[&room].sim.time();
    let command = |unit, kind, revision, seq| Command::SupportOrder {
        unit,
        kind,
        facility_id: facility.facility_id.clone(),
        expected_revision: revision,
        seq,
    };
    accepted(&h.handle(
        1,
        command(engineer, FacilityJobKind::Repair, facility.revision, 7),
        0.0,
    ));
    for (player, unit, kind, revision, seq, code) in [
        (
            3,
            engineer,
            FacilityJobKind::Repair,
            facility.revision,
            8,
            "foreign_support",
        ),
        (
            2,
            engineer,
            FacilityJobKind::Repair,
            facility.revision,
            8,
            "support_not_commandable",
        ),
        (
            1,
            engineer,
            FacilityJobKind::DeliverSupply,
            facility.revision,
            8,
            "support_role",
        ),
        (
            1,
            engineer,
            FacilityJobKind::Repair,
            facility.revision + 1,
            8,
            "stale_facility",
        ),
        (
            1,
            engineer,
            FacilityJobKind::Repair,
            facility.revision,
            7,
            "stale_sequence",
        ),
        (
            1,
            UnitRef {
                life: 2,
                ..engineer
            },
            FacilityJobKind::Repair,
            facility.revision,
            8,
            "foreign_support",
        ),
    ] {
        let out = h.handle(player, command(unit, kind, revision, seq), 0.0);
        assert!(
            out.iter()
                .any(|(_, u)| matches!(u,Update::Error{code:c,..} if c==code)),
            "{out:?}"
        );
    }
    let r = &h.rooms[&room];
    let actor = &r.units[&engineer.unit];
    assert_eq!(actor.last_seq, 7);
    assert_eq!(
        actor
            .support
            .as_ref()
            .unwrap()
            .task
            .as_ref()
            .unwrap()
            .facility_id,
        facility.facility_id
    );
    let after = r.sim.snapshot(engineer.unit).unwrap();
    assert_eq!(before.pos, after.pos);
    assert_eq!(before.ammo_counts, after.ammo_counts);
    assert_eq!(after.ammo, 0);
    assert_eq!(clock, r.sim.time());
    assert!(r.sim.facility_job_views().is_empty());
    assert_eq!(
        r.sim
            .facility_views()
            .into_iter()
            .find(|f| f.facility_id == facility.facility_id)
            .unwrap()
            .revision,
        facility.revision
    );
}
