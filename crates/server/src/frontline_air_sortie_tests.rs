use super::*;
use std::sync::OnceLock;

const ID: u64 = 671;
const DT: f64 = 1.0 / 120.0;
fn fixture(aircraft: &str, owner: Option<u32>, kind: &str) -> (AirWorld, SimWorld) {
    let data = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let map: Value =
        serde_json::from_slice(&std::fs::read(data.join("frontline/korea.json")).unwrap()).unwrap();
    static TEMPLATE: OnceLock<Arc<AirTemplate>> = OnceLock::new();
    let template = TEMPLATE.get_or_init(|| AirTemplate::load(&data).unwrap());
    let ground = SimWorld::load(&data, &map).unwrap();
    let mut air = template.world(Arc::new(ground.ground.clone()), map);
    air.spawn(
        UnitRef {
            battle: 9,
            unit: ID,
            life: 1,
        },
        aircraft,
        Team::Blue,
        owner,
        kind,
        0,
    )
    .unwrap();
    air.sync_facility_availability(&ground);
    (air, ground)
}
fn plan(air: &AirWorld) -> AiRunway {
    let u = &air.units[&ID];
    let fields = ai_runway_candidates(&air.map, &air.service_availability, &air.ground);
    fields
        .into_iter()
        .find(|f| f.team == u.team && f.forward[0] > 0.0)
        .unwrap()
}
fn tick(air: &mut AirWorld, ground: &mut SimWorld) {
    air.step(DT, ground);
}
fn ammunition(u: &AirUnit) -> u32 {
    u.guns.iter().map(|g| g.ammo).sum()
}

#[test]
fn autonomous_source_korea_sortie_uses_native_landing_taxi_service_and_departure() {
    let (mut air, mut ground) = fixture("f86f", None, "air");
    let runway = plan(&air);
    let reference = air.units[&ID].reference;
    let initial = runway.point(5000.0, 3000.0, 1200.0);
    let speed = ai_reference_speed(&air.units[&ID]);
    // An initial battlefield condition: this aircraft has already spent its
    // ammunition and some fuel. All acceptance-window movement and subsequent
    // resource changes below go through the original plant and native service.
    {
        let u = air.units.get_mut(&ID).unwrap();
        for g in &mut u.guns {
            g.ammo = 0;
        }
        u.fuel *= 0.75;
        u.configure_mass().unwrap();
        u.sortie = Some(AiSortieState::new(false));
    }
    air.test_spawn_at(
        ID,
        FlightSpawn {
            position: initial.map(|v| v as f32),
            heading: (runway.forward[0].atan2(runway.forward[1]) + std::f64::consts::PI) as f32,
            airspeed: (speed * 1.8) as f32,
            on_ground: false,
        },
    );
    let mut phases = std::collections::BTreeSet::new();
    let mut service_started = None;
    let mut service_finished = None;
    let mut previous = air.units[&ID].pos();
    let mut previous_time = air.units[&ID].state[23];
    let mut maximum_ground_lateral = 0.0_f64;
    let mut distance_rolled = 0.0_f64;
    for step in 0..(120 * 1200) {
        tick(&mut air, &mut ground);
        let u = &air.units[&ID];
        let view = u.sortie.as_ref().unwrap().view();
        phases.insert(view.phase);
        assert!(
            u.alive(),
            "native aircraft lost in {} at {:?}: {:?}",
            view.phase,
            u.pos(),
            u.fault
        );
        assert_eq!(u.reference, reference);
        assert!(u.state.iter().all(|v| v.is_finite()));
        // A wall-clock jump or a hidden respawn would break these two checks.
        assert!(
            (u.state[23] - previous_time - DT as f32).abs() < 0.00008,
            "native time jumped"
        );
        assert!(
            distance(previous, u.pos())
                < u.speed().max(air.units[&ID].state[13] as f64) * DT + 0.15,
            "native position jumped"
        );
        if u.state[36] == 4.0 {
            distance_rolled += distance(previous, u.pos());
            maximum_ground_lateral =
                maximum_ground_lateral.max(runway.coordinates(u.pos())[0].abs());
            assert!(air.ground.runway_available_at(u.pos()[0], u.pos()[2]));
        }
        previous = u.pos();
        previous_time = u.state[23];
        if u.service.view.status == "servicing" {
            service_started.get_or_insert(step);
            assert_eq!(
                ammunition(u),
                0,
                "ammunition granted before service completed"
            );
            assert!(
                u.fuel < u.profile.fuel.capacity * 0.8,
                "fuel granted before service completed"
            );
            assert!(u.state[36] == 4.0 && u.speed() < 1.5);
        }
        if u.service.view.status == "complete" && service_finished.is_none() {
            service_finished = Some(step);
            let elapsed = (step - service_started.unwrap()) as f64 * DT;
            assert!(
                (elapsed - AIR_SERVICE_SECONDS).abs() < DT * 2.0,
                "service duration {elapsed}"
            );
            assert_eq!(
                ammunition(u),
                u.profile
                    .guns
                    .iter()
                    .map(|g| g.ammo.round() as u32)
                    .sum::<u32>()
            );
            assert!(u.fuel > u.profile.fuel.capacity - 1.0);
        }
        if view.phase == "patrol" && view.completed_sorties == 1 {
            break;
        }
    }
    let view = air.ai_sortie_view(ID).unwrap();
    assert_eq!(
        (view.phase, view.completed_sorties),
        ("patrol", 1),
        "{view:?}"
    );
    for phase in [
        "return",
        "align",
        "approach",
        "rollout",
        "taxi",
        "servicing",
        "lineup",
        "takeoff",
        "departure",
        "patrol",
    ] {
        assert!(phases.contains(phase), "missing physical phase {phase}");
    }
    assert!(distance_rolled > 2000.0, "no physical rollout/backtaxi");
    assert!(maximum_ground_lateral > 8.0, "no physical parking taxi");
    assert!(service_finished.is_some());
    assert!(air.units[&ID].state[35] > 500.0);
}

#[test]
fn autonomous_service_authority_does_not_include_released_player_aircraft() {
    let (mut air, mut ground) = fixture("f86f", Some(7), "runway");
    let map = air.map.clone();
    let availability = air.service_availability.clone();
    let source = air.ground.clone();
    let defs = air.template.definitions.clone();
    let u = air.units.get_mut(&ID).unwrap();
    u.controller = None;
    u.input = service_hold_input(&u.state);
    assert_eq!(
        begin_ai_service(u, &map, &availability, &source, &defs).unwrap_err(),
        "not_autonomous"
    );
    let fuel = u.fuel;
    let revision = u.resource_revision;
    let service_revision = u.service.view.revision;
    for _ in 0..120 {
        tick(&mut air, &mut ground);
    }
    let u = &air.units[&ID];
    // The existing released-player path may consume native engine fuel. It
    // must never become eligible for this autonomous service authority.
    assert!(u.fuel <= fuel);
    assert_eq!(u.resource_revision, revision);
    assert!(u.sortie.is_none());
    assert_eq!(u.service.view.status, "idle");
    assert_eq!(u.service.view.revision, service_revision);
}

#[test]
fn autonomous_service_still_requires_source_facilities_and_fifteen_native_seconds() {
    let (mut air, mut ground) = fixture("f86f", None, "runway");
    let field = plan(&air).id;
    let map = air.map.clone();
    let source = air.ground.clone();
    let defs = air.template.definitions.clone();
    {
        let u = air.units.get_mut(&ID).unwrap();
        for g in &mut u.guns {
            g.ammo = 0;
        }
        u.fuel *= 0.6;
        u.configure_mass().unwrap();
        u.input = service_hold_input(&u.state);
        u.sortie.as_mut().unwrap().phase = AiSortiePhase::Service;
        begin_ai_service(u, &map, &air.service_availability, &source, &defs).unwrap();
    }
    let initial = air.units[&ID].fuel;
    air.set_clock(1_000_000.0);
    for _ in 0..119 {
        tick(&mut air, &mut ground);
    }
    assert_eq!(ammunition(&air.units[&ID]), 0);
    assert!(air.units[&ID].fuel <= initial);
    assert!(air.units[&ID].service.view.elapsed_s < 1.01);
    let mut unavailable = ServiceAvailability::default();
    unavailable.fuel = false;
    air.set_service_availability(&field, unavailable).unwrap();
    tick(&mut air, &mut ground);
    let u = &air.units[&ID];
    assert_ne!(u.service.view.status, "complete");
    assert_eq!(ammunition(u), 0);
    assert!(u.fuel <= initial);
    assert!(u.state[23] < 1.01);
}

#[test]
fn autonomous_return_replans_closed_runways_and_never_teleports_or_treats_enemies_as_fields() {
    let (mut air, mut ground) = fixture("f86f", None, "air");
    let runway = plan(&air);
    let mut forbidden = ServiceAvailability::default();
    forbidden.runway = false;
    air.set_service_availability(&runway.id, forbidden).unwrap();
    {
        let u = air.units.get_mut(&ID).unwrap();
        for g in &mut u.guns {
            g.ammo = 0;
        }
        u.sortie.as_mut().unwrap().plan = Some(runway);
        u.sortie.as_mut().unwrap().phase = AiSortiePhase::Approach;
    }
    let before = air.units[&ID].pos();
    tick(&mut air, &mut ground);
    let u = &air.units[&ID];
    let view = air.ai_sortie_view(ID).unwrap();
    assert_eq!(view.phase, "holding_for_runway");
    assert!(view.airfield.is_none());
    assert!(distance(before, u.pos()) < 3.0);
    assert_eq!(u.service.view.status, "idle");
    for _ in 0..120 {
        tick(&mut air, &mut ground);
    }
    assert_eq!(
        air.ai_sortie_view(ID).unwrap().reason.as_deref(),
        Some("no_usable_friendly_runway")
    );
    assert!(air.units[&ID].alive());
}

#[test]
fn autonomous_ground_departure_keeps_native_runway_heading_and_checks_real_traffic() {
    let (air, _) = fixture("f104g", None, "runway");
    let u = &air.units[&ID];
    let fields = ai_runway_candidates(&air.map, &air.service_availability, &air.ground);
    let r = ai_choose_runway(u, &fields).unwrap();
    assert!(
        dot(
            [u.state[48] as f64, 0.0, u.state[50] as f64],
            [r.forward[0], 0.0, r.forward[1]]
        ) > 0.99
    );
    let occupied = AiTraffic {
        id: ID + 1,
        pos: r.point(0.0, 0.0, 2.0),
        alive: true,
        span: 12.0,
    };
    assert!(ai_runway_busy(u, &r, &[occupied]));
    assert!(!ai_runway_busy(
        u,
        &r,
        &[AiTraffic {
            alive: false,
            ..occupied
        }]
    ));
    let short = AiRunway {
        interval: [-500.0, 500.0],
        ..r
    };
    assert!(ai_choose_runway(u, &[short]).is_none());
}

#[test]
fn autonomous_planner_reads_partial_source_runway_closure_intervals() {
    let (air, _) = fixture("f86f", None, "air");
    let r = plan(&air);
    air.ground
        .set_runway_closures(vec![crate::frontline_facilities::RunwayClosedRegion {
            facility_id: "fixture-damaged-middle".into(),
            airfield: r.id.clone(),
            center: r.center,
            forward: r.forward,
            half: [r.half_width, 300.0],
            revision: 1,
        }])
        .unwrap();
    let intervals = air.ground.runway_open_intervals(&r.id);
    assert_eq!(intervals.len(), 2);
    assert!(intervals
        .iter()
        .all(|i| i[1] - i[0] < ai_required_strip(&air.units[&ID])));
    let intact = r.point(0.0, -800.0, 0.0);
    assert!(air.ground.runway_available_at(intact[0], intact[2]));
    let candidates = ai_runway_candidates(&air.map, &air.service_availability, &air.ground);
    assert!(ai_choose_runway(&air.units[&ID], &candidates).is_none());
    air.ground.set_runway_closures(Vec::new()).unwrap();
    let candidates = ai_runway_candidates(&air.map, &air.service_availability, &air.ground);
    assert!(ai_choose_runway(&air.units[&ID], &candidates).is_some());
}
