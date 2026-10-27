use super::*;
use crate::frontline::Command;
use std::sync::OnceLock;

fn world() -> (AirWorld, SimWorld) {
    let data = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let map: Value =
        serde_json::from_slice(&std::fs::read(data.join("frontline/korea.json")).unwrap()).unwrap();
    static TEMPLATE: OnceLock<Arc<AirTemplate>> = OnceLock::new();
    let template = TEMPLATE.get_or_init(|| AirTemplate::load(&data).unwrap());
    let ground = SimWorld::load(&data, &map).unwrap();
    (template.world(Arc::new(ground.ground.clone()), map), ground)
}

#[test]
fn custom_loadout_deploy_protocol_accepts_only_slot_to_store_choices() {
    let result = serde_json::from_value::<Command>(json!({
        "op":"deploy_air", "aircraft":"su25", "spawn":"air", "loadout":0,
        "custom":{"p2":"sppu22","p4":"ptb800"}
    }));
    assert!(
        result.is_ok(),
        "native deployment must accept genuine per-slot choices: {result:?}"
    );
}

#[test]
fn custom_loadout_service_protocol_accepts_slot_choices_with_control_identity() {
    let result = serde_json::from_value::<Command>(json!({
        "op":"service_air", "unit":{"battle":9,"unit":71,"life":1},
        "epoch":2, "seq":1, "loadout":0, "custom":{"p2":"sppu22"}
    }));
    assert!(
        result.is_ok(),
        "15-second service must stage the selected custom configuration: {result:?}"
    );
}

#[test]
fn custom_loadout_options_publish_source_allowed_choices_without_artificial_mode_gates() {
    let (air, _) = world();
    let option = air
        .options(1985)
        .into_iter()
        .find(|o| o.id == "su25")
        .unwrap();
    let wire = serde_json::to_value(option).unwrap();
    let slots = wire["slots"]
        .as_array()
        .expect("native aircraft options must expose real mounting slots");
    let cannon = slots.iter().find(|s| s["key"] == "p2").unwrap();
    assert_eq!(cannon["options"]["sppu22"], 1);
    assert!(cannon["unsupported"].get("sppu22").is_none());
    let missile = slots.iter().find(|s| s["key"] == "p1").unwrap();
    assert!(missile["unsupported"].get("r60m").is_none(),
        "source-allowed missiles are configurable; real seeker readiness is a launch condition");
}

#[test]
fn custom_loadout_fixed_catalog_gunpod_is_a_real_supported_weapon() {
    let (air, _) = world();
    let profile = &air.template.profiles["su25"];
    let pod = profile.stores["loadouts"][4]["items"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["id"] == "sppu22")
        .unwrap();
    assert!(
        air.loadout_supported(&json!({"items":[pod]})),
        "catalog gunpod shell/feed/mount data must enable the actual native gun"
    );
}

#[test]
fn custom_loadout_zero_energy_air_contact_does_not_claim_accepted_damage() {
    let (mut air, _) = world();
    let reference = UnitRef {
        battle: 9,
        unit: 71,
        life: 1,
    };
    air.spawn(reference, "f86f", Team::Blue, Some(7), "air", 0)
        .unwrap();
    let unit = &air.units[&reference.unit];
    let pose = accepted_model_pose(&unit.profile.physics, &unit.state);
    let part = unit
        .damage
        .parts
        .iter()
        .find(|p| p.def.id == "pilot")
        .unwrap()
        .def
        .c;
    let a = pose.point(add(part, [-2.0, 0.0, 0.0]));
    let b = pose.point(add(part, [2.0, 0.0, 0.0]));
    let velocity = [
        unit.state[7] as f64,
        unit.state[8] as f64,
        unit.state[9] as f64,
    ];
    let mut shell = air.template.shells.values().next().unwrap().clone();
    shell.explosive_mass_kg = 0.0;
    let before = unit.damage.revision;
    let hit = air
        .hit(reference.unit, a, b, &shell, velocity, 1, 5, false)
        .unwrap();
    assert_eq!(air.units[&reference.unit].damage.revision, before);
    assert_eq!(
        hit["damage_applied"], false,
        "contact alone cannot earn native damage credit"
    );
    assert_eq!(hit["damage_changed"], false);
}

fn selections(pairs: &[(&str, &str)]) -> BTreeMap<String, String> {
    pairs
        .iter()
        .map(|(k, v)| ((*k).into(), (*v).into()))
        .collect()
}

fn reference(id: u64) -> UnitRef {
    UnitRef {
        battle: 9,
        unit: id,
        life: 1,
    }
}

#[test]
fn custom_loadout_mixes_actual_stores_pod_ammunition_and_authoritative_mass() {
    let (mut air, _) = world();
    let custom = selections(&[
        ("p2", "sppu22"),
        ("p3", "ub16"),
        ("p4", "fab500"),
        ("p5", "ptb800"),
    ]);
    air.spawn_configured(
        reference(71),
        "su25",
        Team::Blue,
        Some(7),
        "air",
        0,
        Some(&custom),
    )
    .unwrap();
    let u = &air.units[&71];
    assert_eq!(u.custom.as_ref(), Some(&custom));
    assert_eq!(u.stores.len(), 4);
    let rocket = u.stores.iter().find(|s| s.value["id"] == "ub16").unwrap();
    assert_eq!(
        rocket.count, 16,
        "one selected pod contains its catalog stock, not one rocket"
    );
    let pod = u.guns.iter().find(|g| g.store_index.is_some()).unwrap();
    assert_eq!(pod.ammo, 260);
    assert_eq!(pod.profile.belt, vec!["hei_23_ofz", "api_23_bza"]);
    let loaded = loaded_airframe(&u.profile, u.fuel, &u.stores).unwrap();
    let expected =
        u.profile.physics.airframe[0] as f64 + 290.0 + 57.0 + 16.0 * 3.9 + 500.0 + 100.0 + 650.0;
    assert!((loaded[0] as f64 - expected).abs() < 0.01);
    assert!(loaded[4] > u.profile.physics.airframe[4]);
    let wire = serde_json::to_value(u.view()).unwrap();
    assert_eq!(wire["custom"], json!(custom));
    assert_eq!(wire["stores"].as_array().unwrap().len(), 4);
}

#[test]
fn custom_loadout_remains_per_aircraft_and_survivor_matching_does_not_refill() {
    let (mut air, _) = world();
    let a = selections(&[("p2", "sppu22")]);
    let b = selections(&[("p2", "fab500")]);
    let original_guns = air.template.profiles["su25"].guns.len();
    air.spawn_configured(
        reference(71),
        "su25",
        Team::Blue,
        Some(7),
        "air",
        0,
        Some(&a),
    )
    .unwrap();
    air.units
        .get_mut(&71)
        .unwrap()
        .guns
        .last_mut()
        .unwrap()
        .ammo = 3;
    air.spawn_configured(
        reference(72),
        "su25",
        Team::Blue,
        Some(8),
        "air",
        0,
        Some(&b),
    )
    .unwrap();
    assert_eq!(air.units[&71].custom.as_ref(), Some(&a));
    assert_eq!(air.units[&71].guns.last().unwrap().ammo, 3);
    assert_eq!(air.units[&72].custom.as_ref(), Some(&b));
    assert_eq!(air.units[&72].guns.len(), original_guns);
    assert_eq!(air.template.profiles["su25"].guns.len(), original_guns);
    assert!(air.loadout_matches(71, 0, Some(&a)).unwrap());
    assert!(!air.loadout_matches(71, 0, Some(&b)).unwrap());
    assert!(!air.loadout_matches(71, 0, None).unwrap());
    assert_eq!(air.units[&71].guns.last().unwrap().ammo, 3);
}

#[test]
fn custom_loadout_rejects_unknown_slots_incompatible_stores_and_geometry_clashes() {
    let (mut air, _) = world();
    for (plane, picks, reason) in [
        (
            "su25",
            selections(&[("p999", "sppu22")]),
            "unknown_aircraft_slot",
        ),
        (
            "su25",
            selections(&[("p2", "aim120c")]),
            "store_not_allowed",
        ),
        (
            "a10a",
            selections(&[("p5", "mk82"), ("p6", "tank600")]),
            "aircraft_slots_clash",
        ),
        (
            "nf01",
            selections(&[("row:-1", "hvar"), ("inner:-1", "sc250")]),
            "aircraft_slots_clash",
        ),
    ] {
        let error = air
            .spawn_configured(
                reference(71),
                plane,
                Team::Blue,
                Some(7),
                "air",
                0,
                Some(&picks),
            )
            .unwrap_err();
        assert!(error.starts_with(reason), "{plane}: {error}");
        assert!(
            air.units.is_empty(),
            "a rejected candidate cannot create a partial unit"
        );
    }
    assert!(
        serde_json::from_value::<Command>(json!({
            "op":"deploy_air","aircraft":"su25","spawn":"air",
            "custom":{"p2":{"id":"sppu22","count":999,"mass":0,"p":[0,0,0]}}
        }))
        .is_err(),
        "the protocol cannot accept client-authored inventories or transforms"
    );
}

#[test]
fn custom_loadout_preserves_exact_source_sockets_on_either_wing() {
    let (air, _) = world();
    for (plane, station, id, per) in [
        ("me262", "source_r4m", "r4m", 12),
        ("me262a2a", "source_bombs", "sc250", 1),
    ] {
        for side in [-1, 1] {
            let key = format!("{station}:{side}");
            let picks = selections(&[(&key, id)]);
            let accepted = air.accept_loadout(plane, 0, Some(&picks)).unwrap();
            let expected = air.template.profiles[plane].stores["loadouts"][1]["items"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|v| v["side"] == side)
                .cloned()
                .collect::<Vec<_>>();
            assert_eq!(accepted.value["items"], json!(expected));
            assert_eq!(expected.len(), per);
            assert!(expected
                .iter()
                .all(|v| v["sourceStore"].is_object() && v["sourceMount"].is_object()));
        }
    }
}

#[test]
fn custom_loadout_every_supported_catalog_option_has_authoritative_geometry() {
    let (air, _) = world();
    let mut checked = 0;
    for (plane, profile) in air.template.profiles.iter() {
        for slot in profile.stores["slots"].as_array().unwrap() {
            for (id, count) in slot["options"].as_object().unwrap() {
                if air.store_unsupported_reason(id).is_some() {
                    continue;
                }
                let picks = selections(&[(slot["key"].as_str().unwrap(), id)]);
                let accepted = air
                    .accept_loadout(plane, 0, Some(&picks))
                    .unwrap_or_else(|e| panic!("{plane}/{}/{id}: {e}", slot["key"]));
                assert_eq!(
                    accepted.value["items"].as_array().unwrap().len() as u64,
                    count.as_u64().unwrap()
                );
                let stores =
                    stores_from_loadout(&accepted.value, &air.template.definitions).unwrap();
                loaded_airframe(profile, profile.fuel.capacity, &stores).unwrap();
                allocate_loaded_feeds(profile, &stores).unwrap();
                checked += 1;
            }
        }
    }
    assert!(
        checked > 100,
        "coverage must include actual catalog combinations"
    );
}

#[test]
fn custom_loadout_native_gunpod_consumes_feed_and_stops_when_gone_or_disabled() {
    for disabled in [false, true] {
        let (mut air, mut ground) = world();
        let picks = selections(&[("p2", "sppu22")]);
        air.spawn_configured(
            reference(71),
            "su25",
            Team::Blue,
            Some(7),
            "air",
            0,
            Some(&picks),
        )
        .unwrap();
        let u = air.units.get_mut(&71).unwrap();
        u.controller = Some(7);
        for g in &mut u.guns {
            if g.store_index.is_none() {
                g.ammo = 0;
            }
        }
        let mut input = service_hold_input(&u.state);
        input.flags = 1;
        input.throttle = 0.65;
        input.fire = true;
        air.accept_input(71, input, air.time).unwrap();
        let events = air.step(1.0 / 120.0, &mut ground);
        assert!(events
            .iter()
            .any(|e| e.kind == "shot" && e.detail["weapon_instance"] == "air_pod_2_-1"));
        let u = air.units.get_mut(&71).unwrap();
        let pod = u.guns.iter_mut().find(|g| g.store_index.is_some()).unwrap();
        assert!(pod.ammo < 260);
        let stock = pod.ammo;
        pod.cool = 0.0;
        if disabled {
            u.damage
                .parts
                .iter_mut()
                .find(|p| p.def.id == "ammo")
                .unwrap()
                .hp = 0.0;
        } else {
            u.stores[pod.store_index.unwrap()].gone = true;
        }
        let events = air.step(1.0 / 120.0, &mut ground);
        assert_eq!(
            air.units[&71]
                .guns
                .iter()
                .find(|g| g.store_index.is_some())
                .unwrap()
                .ammo,
            stock
        );
        assert!(events
            .iter()
            .all(|e| e.detail["weapon_instance"] != "air_pod_2_-1"));
    }
}

#[test]
fn custom_loadout_service_stages_configuration_until_actual_fifteen_second_commit() {
    let (mut air, mut ground) = world();
    let empty = BTreeMap::new();
    let picks = selections(&[("inner:-1", "anm64"), ("outer:1", "tank120")]);
    air.spawn_configured(
        reference(71),
        "f86f",
        Team::Blue,
        Some(7),
        "runway",
        0,
        Some(&empty),
    )
    .unwrap();
    let u = air.units.get_mut(&71).unwrap();
    u.controller = Some(7);
    u.input = service_hold_input(&u.state);
    u.guns[0].ammo = 11;
    u.fuel -= 100.0;
    u.configure_mass().unwrap();
    let revision = u.resource_revision;
    let clock = u.state[23];
    let started = air
        .request_service_configured(71, 0, Some(&picks), 0.0)
        .unwrap();
    assert_eq!(started.custom.as_ref(), Some(&picks));
    assert_eq!(
        air.request_service_configured(71, 0, Some(&picks), 0.0)
            .unwrap(),
        started
    );
    assert_eq!(
        air.request_service_configured(71, 0, Some(&empty), 0.0)
            .unwrap_err(),
        "service_already_active"
    );
    for _ in 0..1799 {
        air.step(1.0 / 120.0, &mut ground);
    }
    let u = &air.units[&71];
    assert_eq!(u.custom.as_ref(), Some(&empty));
    assert!(u.stores.is_empty());
    assert_eq!(u.guns[0].ammo, 11);
    assert_eq!(u.resource_revision, revision);
    assert_eq!(u.service.view.status, "servicing");
    assert!(
        u.state[23] > clock + 14.0,
        "native flight clock continues during service"
    );
    let events = air.step(1.0 / 120.0, &mut ground);
    let u = &air.units[&71];
    assert_eq!(u.custom.as_ref(), Some(&picks));
    assert_eq!(u.stores.len(), 2);
    assert_eq!(
        u.guns.iter().map(|g| g.ammo).sum::<u32>(),
        u.profile
            .guns
            .iter()
            .map(|g| g.ammo.round() as u32)
            .sum::<u32>()
    );
    assert_eq!(u.fuel, u.profile.fuel.capacity);
    assert_eq!(u.resource_revision, revision + 1);
    assert_eq!(u.service.view.status, "complete");
    assert!(u.service.pending_loadout.is_none());
    assert_eq!(
        events
            .iter()
            .filter(|e| e.kind == "air_service_complete")
            .count(),
        1
    );
}

#[test]
fn custom_loadout_cancelled_service_cannot_apply_its_pending_configuration() {
    let (mut air, mut ground) = world();
    air.spawn(reference(71), "f86f", Team::Blue, Some(7), "runway", 0)
        .unwrap();
    let u = air.units.get_mut(&71).unwrap();
    u.controller = Some(7);
    u.input = service_hold_input(&u.state);
    let picks = selections(&[("inner:-1", "anm64")]);
    air.request_service_configured(71, 0, Some(&picks), 0.0)
        .unwrap();
    for _ in 0..120 {
        air.step(1.0 / 120.0, &mut ground);
    }
    air.cancel_service(71).unwrap();
    assert!(air.units[&71].service.pending_loadout.is_none());
    for _ in 0..1800 {
        air.step(1.0 / 120.0, &mut ground);
    }
    let u = &air.units[&71];
    assert!(u.custom.is_none() && u.stores.is_empty());
    assert_eq!(u.resource_revision, 1);
}

#[test]
fn custom_loadout_blast_reports_only_actual_live_allowed_damage() {
    let (mut air, _) = world();
    air.spawn(reference(71), "f86f", Team::Blue, Some(7), "air", 0)
        .unwrap();
    let pos = air.units[&71].pos();
    assert!(
        air.blast(pos, 1.0, 0, 5, false, None).is_empty(),
        "friendly blast is suppressed"
    );
    assert!(air
        .blast(add(pos, [10000.0, 0.0, 0.0]), 1.0, 1, 5, false, None)
        .is_empty());
    assert!(air.blast(pos, 0.0, 1, 5, false, None).is_empty());
    assert!(air.blast(pos, 1.0, 1, 5, false, Some(71)).is_empty());
    assert_eq!(air.blast(pos, 0.00001, 1, 5, false, None), vec![71]);
    air.units.get_mut(&71).unwrap().damage.break_up();
    assert!(
        air.blast(pos, 1.0, 1, 5, false, None).is_empty(),
        "a dead life cannot earn damage credit again"
    );
}

fn exact_f16_mk84_item() -> Value {
    json!({"id":"mk84","station":"inner",
        "p":[-1.8451666666666666,-0.9933333333333334,0.4493666666666667],
        "mount":[-1.8451666666666666,-0.7648333333333334,0.14216666666666672],
        "nativePylon":true,"pylon":null,"side":-1,"owner":"wing_r","count":1,
        "modelHardpoint":"left_inner_pylon_lower_rail",
        "modelMountBasis":"whole_mesh_clearance_with_physical_airframe_adapter",
        "modelOwnerBinding":"source_wing_group","fittedMountKey":"f16v:2",
        "mountFitVersion":"mounted-details-v3"})
}

#[test]
fn custom_slot_geometry_table_preserves_exact_accepted_f16_mk84_item() {
    let (air, _) = world();
    let mut profile = air.template.profiles["f16v"].clone();
    let exact = exact_f16_mk84_item();
    profile.stores["slotItems"] = json!({"inner:-1":{"mk84":[exact.clone()]}});
    let slot = profile.stores["slots"].as_array().unwrap().iter()
        .find(|s| s["key"] == "inner:-1").unwrap();
    assert_eq!(slot_items(&profile, slot, "mk84", 1, &air.template.definitions,
        &air.template.damage_types["f16v"].parts).unwrap(), vec![exact]);
}

#[test]
fn custom_slot_geometry_malformed_present_table_never_uses_preset_fallback() {
    let (air, _) = world();
    let original = &air.template.profiles["f16v"];
    let slot = original.stores["slots"].as_array().unwrap().iter()
        .find(|s| s["key"] == "inner:-1").unwrap();
    let mut cases = vec![Value::Null, json!([]), json!({"inner:-1":[]}),
        json!({"inner:-1":{"mk84":null}}), json!({"inner:-1":{"mk84":[]}}),
        json!({"inner:-1":{"mk84":[exact_f16_mk84_item(),exact_f16_mk84_item()]}})];
    for (key, bad) in [
        ("id",json!("mk82")), ("station",json!("outer")), ("side",json!(1)),
        ("p",json!([0,0])), ("p",json!([0,0,0,0])),
        ("p",json!([0,null,0])), ("p",json!([0,"NaN",0])),
        ("owner",json!("invented_wing")), ("owner",Value::Null),
        ("fittedMountKey",json!("")), ("fittedMountKey",json!(1)),
    ] {
        let mut item = exact_f16_mk84_item();
        item[key] = bad;
        cases.push(json!({"inner:-1":{"mk84":[item]}}));
    }
    for table in cases {
        let mut profile = original.clone();
        // A valid preset deliberately makes accidental fallback observable.
        profile.stores["loadouts"] = json!([{"items":[exact_f16_mk84_item()]}]);
        profile.stores["slotItems"] = table.clone();
        assert!(slot_items(&profile, slot, "mk84", 1, &air.template.definitions,
            &air.template.damage_types["f16v"].parts).is_err(),
            "malformed authoritative slot layout silently fell back: {table}");
    }
}

#[test]
fn custom_slot_geometry_exported_f16_mk84_is_available_on_both_wings() {
    let (air, _) = world();
    for side in [-1, 1] {
        let key = format!("inner:{side}");
        let exported = &air.template.profiles["f16v"].stores["slotItems"][&key]["mk84"];
        assert!(exported.is_array(), "missing actual F16 model sockets: {key}");
        let picks = selections(&[(&key,"mk84")]);
        let accepted = air.accept_loadout("f16v", 0, Some(&picks)).unwrap();
        assert_eq!(&accepted.value["items"], exported);
    }
}

#[test]
fn custom_slot_geometry_absent_entries_keep_legacy_presets_and_optional_keys() {
    let (air, _) = world();
    let mut profile = air.template.profiles["f16v"].clone();
    let slot = profile.stores["slots"].as_array().unwrap().iter()
        .find(|s| s["key"] == "inner:-1").unwrap().clone();
    let exact = exact_f16_mk84_item();
    profile.stores["loadouts"] = json!([{"items":[exact.clone()]}]);
    for table in [None, Some(json!({})), Some(json!({"inner:-1":{}}))] {
        profile.stores.as_object_mut().unwrap().remove("slotItems");
        if let Some(table) = table { profile.stores["slotItems"] = table; }
        assert_eq!(slot_items(&profile, &slot, "mk84", 1, &air.template.definitions,
            &air.template.damage_types["f16v"].parts).unwrap(), vec![exact.clone()]);
    }
    for key in [None, Some(Value::Null)] {
        let mut item = exact.clone();
        item["owner"] = json!("body");
        item.as_object_mut().unwrap().remove("fittedMountKey");
        if let Some(key) = key { item["fittedMountKey"] = key; }
        profile.stores["slotItems"] = json!({"inner:-1":{"mk84":[item.clone()]}});
        assert_eq!(slot_items(&profile, &slot, "mk84", 1, &air.template.definitions,
            &air.template.damage_types["f16v"].parts).unwrap(), vec![item]);
    }
}

#[test]
fn custom_guided_bombs_and_shared_aam_rails_use_source_choices_and_staged_service() {
    for (plane,picks) in [
        ("f15c",selections(&[("inner:-1","gbu10")])),
        ("f15c",selections(&[("inner:-1","gbu12")])),
        ("f15c",selections(&[("outer:-1","aim9l"),("mid:-1","aim120c")])),
        ("f4e",selections(&[("outer:-1","aim9l"),("mid:-1","aim9l")])),
        ("su25",selections(&[("p1","r60m")])),
        ("a10a",selections(&[("p1","alq131")])),
    ] {
        let (mut air,mut ground)=world();
        air.spawn_configured(reference(72),plane,Team::Blue,Some(8),"air",0,Some(&picks)).unwrap();
        assert_eq!(air.units[&72].custom.as_ref(),Some(&picks));
        let empty=BTreeMap::new();
        air.spawn_configured(reference(71),plane,Team::Blue,Some(7),"runway",0,Some(&empty)).unwrap();
        let unit=air.units.get_mut(&71).unwrap();unit.controller=Some(7);
        unit.input=service_hold_input(&unit.state);unit.guns[0].ammo=3;unit.fuel-=100.0;
        let revision=unit.resource_revision;
        air.request_service_configured(71,0,Some(&picks),0.0).unwrap();
        assert_eq!(air.units[&71].custom.as_ref(),Some(&empty));
        assert!(air.units[&71].stores.is_empty());assert_eq!(air.units[&71].guns[0].ammo,3);
        for _ in 0..1799 {air.step(1.0/120.0,&mut ground);}
        assert_eq!(air.units[&71].custom.as_ref(),Some(&empty));
        assert_eq!(air.units[&71].resource_revision,revision);
        air.step(1.0/120.0,&mut ground);
        assert_eq!(air.units[&71].custom.as_ref(),Some(&picks));
        assert_eq!(air.units[&71].service.view.status,"complete");
        assert_eq!(air.units[&71].resource_revision,revision+1);
    }
}

fn aircraft_fuze_fixture() -> AirWorld {
    let (mut air, _) = world();
    air.spawn(reference(71), "f86f", Team::Blue, Some(7), "air", 0).unwrap();
    let mut ty = air.template.damage_types["f86f"].clone();
    let template = ty.parts[0].clone();
    ty.parts = [("front",[0.0,0.0,-1.0]),("middle",[0.0,0.0,0.0]),
        ("rear",[0.0,0.0,1.0]),("off_axis",[0.5,0.0,-1.0])].into_iter()
        .map(|(id,c)| { let mut p=template.clone();p.id=id.into();p.c=c;p.h=[0.1;3];
            p.hp=10000.0;p.armor=Some(0.7);p.fire=None;p.detach=false;p.parent=None;p.blast_k=Some(1.0);p }).collect();
    ty.skin=vec![crate::aircraft::BoxDef {c:[0.0;3],h:[1.0,1.0,1.3]}];
    air.units.get_mut(&71).unwrap().damage=AirDamage::new(&ty);
    air
}

fn aircraft_fuze_hit(air: &mut AirWorld, shell: &ProjectileDef) -> Value {
    let u=&air.units[&71];
    let pose=accepted_model_pose(&u.profile.physics,&u.state);
    let velocity=add([u.state[7] as f64,u.state[8] as f64,u.state[9] as f64],
        pose.vector([0.0,0.0,835.0]));
    air.hit(71,pose.point([0.0,0.0,-2.0]),pose.point([0.0,0.0,2.0]),shell,
        velocity,1,17,false).unwrap()
}

#[test]
fn aircraft_aphe_native_uncalibrated_skin_does_not_create_contact_blast() {
    let mut air=aircraft_fuze_fixture();
    let shell=air.template.shells["ap_50_mk214a"].clone();
    let before=air.units[&71].damage.parts[3].hp;
    let hit=aircraft_fuze_hit(&mut air,&shell);
    assert_eq!(air.units[&71].damage.parts[3].hp,before,
        "17g PETN APHE cannot detonate merely because an uncalibrated skin box was crossed");
    assert_eq!(hit["hit"]["fuze_status"],"unarmed");
    assert_eq!(hit["hit"]["limitation"],"arming_contact_thickness_unrecorded");
    assert_eq!(hit["hit"]["bursts"],json!([]));
}

#[test]
fn aircraft_aphe_native_unarmed_filler_keeps_multiple_kinetic_part_contacts() {
    let mut air=aircraft_fuze_fixture();
    let shell=air.template.shells["ap_50_mk214a"].clone();
    let hit=aircraft_fuze_hit(&mut air,&shell);
    assert_eq!(hit["hit"]["parts"],json!(["front","middle","rear"]));
    assert!(air.units[&71].damage.parts[..3].iter().all(|p| p.hp<10000.0));
    assert_eq!(air.units[&71].damage.parts[3].hp,10000.0);
}

#[test]
fn aircraft_aphe_native_he_contact_blast_remains_distinct_from_delayed_filler() {
    let mut air=aircraft_fuze_fixture();
    let mut shell=air.template.shells["ap_50_mk214a"].clone();
    shell.kind=tg_weapon::ProjectileKind::He;
    let hit=aircraft_fuze_hit(&mut air,&shell);
    assert!(air.units[&71].damage.parts[3].hp<10000.0,"HE still bursts at accepted skin contact");
    assert_eq!(hit["hit"]["parts"],json!(["front"]));
}
