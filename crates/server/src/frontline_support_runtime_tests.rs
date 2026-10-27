//! Actual native units, mounted feeds, admitted rounds and fixed-step facility jobs.
use super::*;
fn data() -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")
}
fn map() -> Value {
    json!({"id":"support_runtime","terrain":{"width":3,"height":3,"cellX":1000.0,"cellZ":1000.0,"x0":-1000.0,"z0":-1000.0,"heights":vec![0.0;9]},
    "airfields":[{"id":"F","team":0,"enabled":true,"runway":{"center":[0,0],"forward":[0,1],"height":0,"lengthMeters":200,"widthMeters":20}}]})
}
fn role(engineer: bool) -> FacilityWorkerRoles {
    FacilityWorkerRoles {
        engineer,
        supply: !engineer,
        combat: false,
    }
}
fn advance(w: &mut SimWorld, seconds: f64) -> Vec<SimEvent> {
    let mut events = Vec::new();
    for _ in 0..(seconds * 20.0).ceil() as usize {
        events.extend(w.step(0.05));
    }
    events
}
fn hit(w: &mut SimWorld, team: u8, x: f64, z: f64) -> Vec<SimEvent> {
    let shell = w.projectiles.get("apfsds_125_3bm22").unwrap().clone();
    w.launch_air_round(
        9000,
        team,
        shell,
        [x, 30.0, z],
        [0.0, -500.0, 0.0],
        None,
        "native_fixture_admission",
        1,
    )
    .unwrap();
    advance(w, 0.15)
}
#[test]
fn actual_support_conversions_strip_weapon_contacts_and_have_no_fire_stock_or_capture_presence() {
    let mut w = SimWorld::load(&data(), &map()).unwrap();
    w.set_battle_id(7).unwrap();
    for (i, vehicle) in ["de_pzjg1", "de_rso_pak40", "su_att_m46"]
        .into_iter()
        .enumerate()
    {
        let id = i as u64 + 1;
        w.spawn_support_unit(
            id,
            vehicle,
            0,
            [-120.0 + i as f64 * 30.0, 0.0, -150.0],
            0.0,
            role(true),
        )
        .unwrap();
        assert_eq!(w.snapshot(id).unwrap().ammo, 0);
        assert!(w.fire(id, None).is_err());
        let u = &w.units[&id];
        assert!(u.model.target.def.turret.is_none());
        assert_eq!(u.model.target.def.ammo_capacity, 0);
        assert!(u.model.target.def.modules.iter().all(|m| !matches!(
            m.kind,
            tg_combat::ModuleKind::GunBarrel
                | tg_combat::ModuleKind::GunBreech
                | tg_combat::ModuleKind::AmmoRack
        )));
        assert!(u.ammo.counts.values().flatten().all(|n| *n == 0));
        assert!(u
            .model
            .target
            .def
            .plates
            .iter()
            .all(|p| !p.id.contains("mantlet")
                && !p.id.contains("gun")
                && !p.id.contains("shield")));
    }
    advance(&mut w, 1.0);
    assert!(w.capture_presence().is_empty());
}
#[test]
fn admitted_native_round_hits_uploaded_runway_surface_before_terrain_and_closure_is_shared() {
    let mut w = SimWorld::load(&data(), &map()).unwrap();
    w.set_battle_id(7).unwrap();
    let shared = w.ground.clone();
    let events = hit(&mut w, 1, 0.0, -50.0);
    let contact = events
        .iter()
        .find(|e| e.kind == "facility_impact")
        .expect("Real finite projectile must hit the source runway triangles");
    assert_eq!(
        contact.detail["contact"]["facility_id"],
        "support_runtime:runway:F:patch:000"
    );
    assert!(
        contact.detail["contact"]["geometry_hash"]
            .as_str()
            .unwrap()
            .len()
            == 64
    );
    assert!(!shared.runway_available_at(0.0, -50.0));
    assert!(shared.runway_available_at(0.0, 50.0));
    let id = "support_runtime:runway:F:patch:001";
    let before = w.facilities.view(id).unwrap();
    let friend = hit(&mut w, 0, 0.0, 50.0);
    assert!(friend.iter().any(|e| e.kind == "facility_friendly_block"));
    assert_eq!(w.facilities.view(id).unwrap().hp, before.hp);
    assert!(shared.runway_available_at(0.0, 50.0));
    assert_eq!(w.active_projectiles(), 0);
}
#[test]
fn actual_stopped_engineer_repairs_then_actual_supply_delivery_restores_airport_function() {
    let mut w = SimWorld::load(&data(), &map()).unwrap();
    w.set_battle_id(7).unwrap();
    hit(&mut w, 1, 70.0, -70.0);
    let id = "support_runtime:fuel:F";
    let damaged = w.facilities.view(id).unwrap();
    assert!(damaged.hp > 0.0 && damaged.hp < damaged.max_hp && !damaged.supplied);
    w.spawn_support_unit(10, "su_att_m46", 0, [90.0, 0.0, -85.0], 0.0, role(true))
        .unwrap();
    w.spawn_support_unit(11, "su_att_m46", 0, [90.0, 0.0, -60.0], 0.0, role(false))
        .unwrap();
    for id in [10, 11] {
        w.set_input(
            id,
            SimInput {
                brake: 1.0,
                ..Default::default()
            },
        )
        .unwrap();
    }
    advance(&mut w, 2.0);
    let worker = UnitRef {
        battle: 7,
        unit: 10,
        life: 1,
    };
    assert!(w
        .request_facility_job(
            FacilityJobKind::Repair,
            id,
            damaged.revision,
            UnitRef { life: 2, ..worker },
            0
        )
        .is_err());
    assert!(w
        .request_facility_job(
            FacilityJobKind::Repair,
            id,
            damaged.revision,
            UnitRef { unit: 11, ..worker },
            0
        )
        .is_err());
    let job = w
        .request_facility_job(FacilityJobKind::Repair, id, damaged.revision, worker, 0)
        .unwrap();
    advance(&mut w, job.duration_s + 1.0);
    let repaired = w.facilities.view(id).unwrap();
    assert_eq!(
        w.facility_job_views()
            .iter()
            .find(|j| j.job_id == job.job_id)
            .unwrap()
            .status,
        "complete"
    );
    assert_eq!(repaired.hp, repaired.max_hp);
    assert!(
        !repaired.capabilities.fuel,
        "Structural work cannot invent a supply delivery"
    );
    let delivery = w
        .request_facility_job(
            FacilityJobKind::DeliverSupply,
            id,
            repaired.revision,
            UnitRef { unit: 11, ..worker },
            0,
        )
        .unwrap();
    advance(&mut w, delivery.duration_s + 1.0);
    assert!(w.facility_airfield_capabilities("F").unwrap().fuel);
    assert!(w
        .facility_job_views()
        .iter()
        .any(|j| j.job_id == delivery.job_id && j.status == "complete"));
}
#[test]
fn registered_airport_slots_and_local_routes_preserve_actual_chassis_footprints() {
    let mut w = SimWorld::load(&data(), &map()).unwrap();
    w.set_battle_id(7).unwrap();
    let sources = w.airport_support_sources(0, "su_att_m46");
    assert_eq!(sources.len(), 1);
    assert!(sources[0].1.len() >= 2);
    assert!(w.airport_support_sources(1, "su_att_m46").is_empty());
    let (p, yaw) = sources[0].1[0];
    w.spawn_support_unit(10, "su_att_m46", 0, p, yaw, role(true))
        .unwrap();
    let points = w.support_local_route(10, "support_runtime:fuel:F").unwrap();
    let safe = w.support_route_prefix(10, &points);
    assert!(safe.len() > 1);
    let end = *safe.last().unwrap();
    assert!(
        w.facility_work_distance(
            "support_runtime:fuel:F",
            [end[0], w.height(end[0], end[1]), end[1]]
        )
        .unwrap()
            <= 25.0
    );
    let forbidden = w.support_route_prefix(10, &[[f64::NAN, 0.0]]);
    assert_eq!(forbidden.len(), 1);
}
