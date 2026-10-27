//! Facility domain/geometry regression cases.
use super::*;

fn identity(unit: u64, life: u64) -> UnitRef {
    UnitRef {
        battle: 7,
        unit,
        life,
    }
}
fn fixture() -> Value {
    let outer = [[-1.2, 0.2], [-1.2, 1.2], [-0.2, 1.2], [-0.2, 0.2]];
    let inner = [[-0.9, 0.5], [-0.9, 0.9], [-0.5, 0.9], [-0.5, 0.5]];
    let mut triangles = Vec::new();
    for i in 0..4 {
        let j = (i + 1) % 4;
        for mut t in [
            [outer[i], outer[j], inner[j]],
            [outer[i], inner[j], inner[i]],
        ] {
            if area(&t) > 0.0 {
                t.swap(1, 2);
            }
            triangles.push(t.into_iter().flatten().collect::<Vec<_>>());
        }
    }
    let mut ring = outer.to_vec();
    ring.push(outer[0]);
    let mut hole = inner.to_vec();
    hole.push(inner[0]);
    json!({"id":"fixture","terrain":{"roadbeds":{"segments":[[0,-20,10,0,0,10,2,2],[0,0,10,20,0,10,2,2]]},
        "bridges":[{"id":"B","roadId":"r1","roadIds":["r1","r2"],"roadbedSegments":[0,1],"halfWidth":2,"deckThickness":1,
            "jointGeometry":{"version":1,"source":{"kind":"authored_internal_deck_joint_wedges"},
            "sharedVertices":[{"point":[0,0],"roadbedSegments":[0,1]}],"polygons":[{"ring":ring,"holes":[hole]}],"triangles":triangles}}],
        "pads":[{"id":"pad","halfSize":[48,65]}]},
        "airfields":[{"id":"F","team":0,"enabled":true,"runway":{"center":[200,0],"forward":[0,1],"height":10,"lengthMeters":200,"widthMeters":20}},
                     {"id":"disabled","enabled":false}],
        "staging":[{"id":"S","team":0,"enabled":true,"pos":[100,10,100],"roadId":"r1","padId":"pad","spawnSlots":[{"yawRad":0}]}]})
}
fn world() -> FacilityWorld {
    FacilityWorld::from_map(&fixture(), |_, _| 10.0).unwrap()
}
fn ray_at(w: &FacilityWorld, x: f64, z: f64) -> FacilityContact {
    w.first_contact([x, 30.0, z], [x, 0.0, z]).unwrap().unwrap()
}
fn damage(w: &mut FacilityWorld, id: u64, x: f64, z: f64, tnt: f64) -> Vec<FacilityEvent> {
    let c = ray_at(w, x, z);
    w.impact(
        &c,
        &FacilityImpact {
            event_id: id,
            team: 1,
            energy_j: 0.0,
            tnt_kg: tnt,
            friendly_damage: false,
        },
    )
    .unwrap()
}
fn engineer() -> FacilityWorker {
    FacilityWorker {
        unit: identity(10, 1),
        team: 0,
        alive: true,
        pos: [-8.0, 10.0, -5.0],
        speed_mps: 0.0,
        engineer: true,
        supply: false,
        combat: false,
    }
}
fn advance(w: &mut FacilityWorld, steps: usize, workers: &[FacilityWorker]) -> Vec<FacilityEvent> {
    let mut events = Vec::new();
    for _ in 0..steps {
        events.extend(w.step(w.native_time() + 0.05, 0.05, workers).unwrap());
    }
    events
}

#[test]
fn registered_visible_float32_geometry_retains_holes_shells_winding_and_content_hash() {
    let a = world();
    let b = world();
    assert_eq!(a.views().len(), 7);
    assert_eq!(
        serde_json::to_vec(&a.geometry_catalog()).unwrap(),
        serde_json::to_vec(&b.geometry_catalog()).unwrap()
    );
    let bridge = a
        .geometry_catalog()
        .into_iter()
        .find(|g| g.facility_id == "fixture:bridge:B")
        .unwrap();
    assert_eq!(
        bridge.triangles.len(),
        56,
        "Both registered rect solids and explicit holed joint top/bottom/sides retained"
    );
    assert!(
        a.first_contact([-0.7, 12.0, 0.7], [-0.7, 8.0, 0.7])
            .unwrap()
            .is_none(),
        "An AABB hit through the source hole remains a triangle miss"
    );
    let hit = a
        .first_contact([-1.1, 12.0, 0.7], [-1.1, 8.0, 0.7])
        .unwrap()
        .unwrap();
    assert_eq!(hit.facility_id, "fixture:bridge:B");
    assert_eq!(hit.position[1], 10.0);
    assert!(hit.normal[1] > 0.99);
    let bottom = a
        .first_contact([-1.1, 8.0, 0.7], [-1.1, 12.0, 0.7])
        .unwrap()
        .unwrap();
    assert_eq!(bottom.position[1], 9.0);
    assert!(bottom.normal[1] < -0.99);
    assert!(
        a.first_contact([-1.1, 12.0, 0.7], [-1.1, 10.1, 0.7])
            .unwrap()
            .is_none(),
        "Finite ray does not reach the deck"
    );
    assert!(a.first_contact([f64::NAN, 0.0, 0.0], [0.0; 3]).is_err());
    for g in a.geometry_catalog() {
        let bytes: Vec<_> = g
            .triangles
            .iter()
            .flatten()
            .flatten()
            .flat_map(|v| (*v as f32).to_bits().to_le_bytes())
            .collect();
        assert_eq!(sha256(&bytes), g.geometry_hash);
        assert!(g
            .triangles
            .iter()
            .flatten()
            .flatten()
            .all(|v| *v == *v as f32 as f64));
        if g.facility_id.contains(":runway:") {
            assert!(g
                .triangles
                .iter()
                .all(|t| ray::cross(ray::sub(t[1], t[0]), ray::sub(t[2], t[0]))[1] > 0.0));
        }
        assert_eq!(g.source["kind"], "authored_campaign");
    }
}

#[test]
fn source_registration_rejects_hole_fill_bad_binding_duplicate_identity_and_false_runway_plane() {
    let mut map = fixture();
    map["terrain"]["bridges"][0]["roadbedSegments"] = json!([0, 99]);
    assert!(FacilityWorld::from_map(&map, |_, _| 10.0).is_err());
    let mut map = fixture();
    map["terrain"]["bridges"][0]["jointGeometry"]["triangles"]
        .as_array_mut()
        .unwrap()
        .push(json!([-0.9, 0.5, -0.5, 0.9, -0.5, 0.5]));
    assert!(FacilityWorld::from_map(&map, |_, _| 10.0).is_err());
    let mut map = fixture();
    let duplicate = map["terrain"]["bridges"][0].clone();
    map["terrain"]["bridges"]
        .as_array_mut()
        .unwrap()
        .push(duplicate);
    assert!(FacilityWorld::from_map(&map, |_, _| 10.0).is_err());
    assert!(FacilityWorld::from_map(&fixture(), |_, _| 11.0).is_err());
    let mut map = fixture();
    map["airfields"][0]["team"] = json!(3);
    assert!(FacilityWorld::from_map(&map, |_, _| 10.0).is_err());
}

#[test]
fn triangle_hits_disable_only_their_runway_region_and_friendly_buildings_still_block() {
    let mut w = world();
    let contact = ray_at(&w, 200.0, -50.0);
    assert_eq!(contact.facility_id, "fixture:runway:F:patch:000");
    assert!(w.runway_open_at("F", 200.0, -50.0));
    assert!(w.runway_open_at("F", 200.0, 50.0));
    w.impact(
        &contact,
        &FacilityImpact {
            event_id: 1,
            team: 1,
            energy_j: 200_000.0,
            tnt_kg: 0.0,
            friendly_damage: false,
        },
    )
    .unwrap();
    assert!(!w.runway_open_at("F", 200.0, -50.0));
    assert!(
        !w.runway_open_at("F", 200.0, 0.0),
        "Damaged patch boundary fails closed"
    );
    assert!(w.runway_open_at("F", 200.0, 50.0));
    assert!(w.airfield_capabilities("F").unwrap().runway);
    assert_eq!(w.full_runway_available("F"), Some(false));
    let fuel = ray_at(&w, 270.0, -70.0);
    assert_eq!(fuel.facility_id, "fixture:fuel:F");
    let hp = w.view(&fuel.facility_id).unwrap().hp;
    let events = w
        .impact(
            &fuel,
            &FacilityImpact {
                event_id: 2,
                team: 0,
                energy_j: 1e9,
                tnt_kg: 100.0,
                friendly_damage: false,
            },
        )
        .unwrap();
    assert_eq!(events[0].kind, "facility_friendly_block");
    assert_eq!(w.view(&fuel.facility_id).unwrap().hp, hp);
    assert!(w
        .first_contact([270.0, 30.0, -70.0], [270.0, 0.0, -70.0])
        .unwrap()
        .is_some());
    damage(&mut w, 3, 270.0, -70.0, 100.0);
    assert!(!w.airfield_capabilities("F").unwrap().fuel);
    assert!(w.airfield_capabilities("F").unwrap().arming);
    assert!(w.source_supply_open("S").unwrap());
    damage(&mut w, 4, 160.0, 100.0, 100.0);
    assert!(!w.source_supply_open("S").unwrap());
}

#[test]
fn direct_and_blast_receipts_are_separate_but_embedded_explosion_never_double_grants_damage() {
    let mut w = world();
    let c = ray_at(&w, 270.0, -70.0);
    let id = c.facility_id.clone();
    let hp = w.view(&id).unwrap().hp;
    let kinetic = FacilityImpact {
        event_id: 7,
        team: 1,
        energy_j: 200_000.0,
        tnt_kg: 0.0,
        friendly_damage: false,
    };
    w.impact(&c, &kinetic).unwrap();
    w.impact(&c, &kinetic).unwrap();
    w.blast(c.position, 1.0, 1, false, 7, None).unwrap();
    let after = w.view(&id).unwrap().hp;
    assert!((after - (hp - 5.0)).abs() < 1e-8);
    w.blast(c.position, 1.0, 1, false, 7, None).unwrap();
    assert_eq!(w.view(&id).unwrap().hp, after);
    let c = ray_at(&w, 270.0, -70.0);
    w.impact(
        &c,
        &FacilityImpact {
            event_id: 8,
            team: 1,
            energy_j: 0.0,
            tnt_kg: 10000.0,
            friendly_damage: false,
        },
    )
    .unwrap();
    let revision = w.view(&id).unwrap().revision;
    let neighbors = w.blast(c.position, 10000.0, 1, false, 8, None).unwrap();
    assert_eq!(w.view(&id).unwrap().revision, revision);
    assert!(neighbors
        .iter()
        .any(|e| e.facility_id == "fixture:arming:F"));
    let bridge = ray_at(&w, 0.0, -10.0);
    w.impact(
        &bridge,
        &FacilityImpact {
            event_id: 9,
            team: 0,
            energy_j: 0.0,
            tnt_kg: 100.0,
            friendly_damage: false,
        },
    )
    .unwrap();
    assert_eq!(
        w.bridge_open("B"),
        Some(false),
        "Public neutral bridge can be destroyed by either team"
    );
    assert!(w
        .impact(
            &bridge,
            &FacilityImpact {
                event_id: 9,
                team: 0,
                energy_j: 0.0,
                tnt_kg: 100.0,
                friendly_damage: false
            }
        )
        .unwrap()
        .is_empty());
}

#[test]
fn repair_requires_actual_stopped_unit_full_life_and_consecutive_native_time() {
    let mut w = world();
    let old_contact = ray_at(&w, 0.0, -10.0);
    damage(&mut w, 1, 0.0, -10.0, 100.0);
    let id = "fixture:bridge:B";
    let rev = w.view(id).unwrap().revision;
    let mut worker = engineer();
    let job = w
        .request_job(FacilityJobKind::Repair, id, rev, worker.unit, 0)
        .unwrap();
    assert!(w
        .request_job(FacilityJobKind::Repair, id, rev - 1, worker.unit, 0)
        .is_err());
    assert!(w.step(1000.0, 1000.0, &[worker.clone()]).is_err());
    assert!(w.step(10.0, 0.05, &[worker.clone()]).is_err());
    assert_eq!(w.native_time(), 0.0);
    advance(&mut w, 20, &[]);
    assert_eq!(w.job_views()[0].elapsed_s, 0.0);
    assert_eq!(w.bridge_open("B"), Some(false));
    worker.speed_mps = 2.0;
    advance(&mut w, 20, &[worker.clone()]);
    assert_eq!(w.job_views()[0].elapsed_s, 0.0);
    worker.speed_mps = 0.0;
    advance(&mut w, 20, &[worker.clone()]);
    assert!(w.job_views()[0].elapsed_s > 0.9);
    assert_eq!(
        w.request_job(FacilityJobKind::Repair, id, rev, worker.unit, 0)
            .unwrap()
            .job_id,
        job.job_id,
        "Duplicate request preserves actual work instead of restarting/duplicating"
    );
    let mut replacement = worker.clone();
    replacement.unit.life += 1;
    let clock = w.native_time();
    assert!(
        w.step(clock + 0.05, 0.05, &[worker.clone(), replacement.clone()])
            .is_err(),
        "Two lives of the same native unit cannot both be projected as current workers"
    );
    assert_eq!(w.native_time(), clock);
    advance(&mut w, 1, &[replacement]);
    assert_eq!(w.job_views()[0].status, "cancelled_unit_replaced");
    assert_eq!(w.job_views()[0].elapsed_s, 0.0);
    let mut worker = engineer();
    worker.unit = identity(11, 1);
    let job = w
        .request_job(FacilityJobKind::Repair, id, rev, worker.unit, 0)
        .unwrap();
    advance(&mut w, 10, &[worker.clone()]);
    worker.pos[0] = 1000.0;
    advance(&mut w, 1, &[worker.clone()]);
    assert_eq!(w.jobs[&job.job_id].elapsed_s, 0.0);
    worker.pos = engineer().pos;
    advance(&mut w, 2399, &[worker.clone()]);
    assert!(!w.bridge_open("B").unwrap());
    let done = advance(&mut w, 1, &[worker.clone()]);
    assert_eq!(
        done.iter()
            .filter(|e| e.kind == "facility_job_complete")
            .count(),
        1
    );
    assert!(w.bridge_open("B").unwrap());
    assert!(
        w.impact(
            &old_contact,
            &FacilityImpact {
                event_id: 50,
                team: 1,
                energy_j: 200000.0,
                tnt_kg: 0.0,
                friendly_damage: false
            }
        )
        .is_err(),
        "Restored same-content geometry still rejects the old geometry revision"
    );
    assert!(advance(&mut w, 20, &[worker]).is_empty());
}

#[test]
fn new_damage_death_and_live_escorted_supply_control_repair_without_wall_grants() {
    let mut w = world();
    damage(&mut w, 1, 270.0, -70.0, 1.0);
    let id = "fixture:fuel:F";
    let rev = w.view(id).unwrap().revision;
    let mut worker = engineer();
    worker.pos = [280.0, 10.0, -70.0];
    let first = w
        .request_job(FacilityJobKind::Repair, id, rev, worker.unit, 0)
        .unwrap();
    advance(&mut w, 10, &[worker.clone()]);
    damage(&mut w, 2, 270.0, -70.0, 1.0);
    assert_eq!(w.jobs[&first.job_id].status, "restart_required_new_damage");
    assert_eq!(w.jobs[&first.job_id].elapsed_s, 0.0);
    assert!(w
        .request_job(FacilityJobKind::Repair, id, rev, worker.unit, 0)
        .is_err());
    let rev = w.view(id).unwrap().revision;
    let next = w
        .request_job(FacilityJobKind::Repair, id, rev, worker.unit, 0)
        .unwrap();
    worker.alive = false;
    advance(&mut w, 1, &[worker.clone()]);
    assert_eq!(w.jobs[&next.job_id].status, "cancelled_unit_lost");
    worker.alive = true;
    worker.unit = identity(12, 1);
    w.request_job(FacilityJobKind::Repair, id, rev, worker.unit, 0)
        .unwrap();
    let mut base = w.clone();
    let supply = FacilityWorker {
        unit: identity(20, 1),
        team: 0,
        alive: true,
        pos: [290.0, 10.0, -70.0],
        speed_mps: 0.0,
        engineer: false,
        supply: true,
        combat: false,
    };
    let escort = FacilityWorker {
        unit: identity(21, 1),
        team: 0,
        alive: true,
        pos: [300.0, 10.0, -70.0],
        speed_mps: 0.0,
        engineer: false,
        supply: false,
        combat: true,
    };
    advance(
        &mut w,
        449,
        &[worker.clone(), supply.clone(), escort.clone()],
    );
    advance(&mut base, 449, &[worker.clone(), supply.clone()]);
    assert!(w.view(id).unwrap().hp < w.view(id).unwrap().max_hp);
    assert!(w.job_views().last().unwrap().boosted);
    assert!(!base.job_views().last().unwrap().boosted);
    advance(&mut w, 1, &[worker.clone(), supply, escort]);
    assert_eq!(w.view(id).unwrap().hp, w.view(id).unwrap().max_hp);
    assert!(base.view(id).unwrap().hp < base.view(id).unwrap().max_hp);
    let mut missing = w.clone();
    let id = "fixture:arming:F";
    let rev = missing.view(id).unwrap().revision;
    missing.set_supplied(id, rev, false).unwrap();
    assert!(!missing.airfield_capabilities("F").unwrap().arming);
    let rev = missing.view(id).unwrap().revision;
    let mut delivery = worker;
    delivery.unit = identity(22, 1);
    delivery.engineer = false;
    delivery.supply = true;
    delivery.pos = [280.0, 10.0, 0.0];
    missing
        .request_job(FacilityJobKind::DeliverSupply, id, rev, delivery.unit, 0)
        .unwrap();
    advance(&mut missing, 199, &[delivery.clone()]);
    assert!(!missing.airfield_capabilities("F").unwrap().arming);
    advance(&mut missing, 1, &[delivery]);
    assert!(missing.airfield_capabilities("F").unwrap().arming);
}

#[test]
fn both_actual_maps_register_all_source_bridges_enabled_airfields_and_staging() {
    use crate::frontline_sim::MapGround;
    use tg_physics::tank::terrain::Ground;
    let data = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    for name in ["korea", "taiwan"] {
        let map: Value = serde_json::from_slice(
            &std::fs::read(data.join(format!("frontline/{name}.json"))).unwrap(),
        )
        .unwrap();
        let ground = MapGround::load(&data, &map).unwrap();
        let w = FacilityWorld::from_map(&map, |x, z| ground.height(x, z)).unwrap();
        let views = w.views();
        assert_eq!(
            views
                .iter()
                .filter(|f| f.kind == FacilityKind::Bridge)
                .count(),
            map["terrain"]["bridges"].as_array().unwrap().len()
        );
        assert_eq!(
            views
                .iter()
                .filter(|f| f.kind == FacilityKind::SupplyNode)
                .count(),
            6
        );
        let fields: Vec<_> = map["airfields"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|f| f["enabled"] == true)
            .collect();
        assert_eq!(fields.len(), 2);
        for f in fields {
            let id = f["id"].as_str().unwrap();
            let n = (f["runway"]["lengthMeters"].as_f64().unwrap() / 100.0).ceil() as usize;
            assert_eq!(
                views
                    .iter()
                    .filter(|v| v.kind == FacilityKind::RunwayPatch
                        && v.airfield.as_deref() == Some(id))
                    .count(),
                n
            );
            let cap = w.airfield_capabilities(id).unwrap();
            assert!(cap.runway && cap.fuel && cap.arming && cap.repair && cap.supply);
        }
        eprintln!("{name}:{} stable actual source facilities,{} Float32 visible/contact triangles; domain registration only, actual shots/workers are separate integration",views.len(),w.geometry_catalog().iter().map(|g|g.triangles.len()).sum::<usize>());
    }
}
