use super::*;
use crate::frontline::Command;
use std::sync::OnceLock;

fn world() -> (AirWorld, SimWorld) {
    let data = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let map: Value = serde_json::from_slice(&std::fs::read(data.join("frontline/korea.json")).unwrap()).unwrap();
    static TEMPLATE: OnceLock<Arc<AirTemplate>> = OnceLock::new();
    let template = TEMPLATE.get_or_init(|| AirTemplate::load(&data).unwrap());
    let ground = SimWorld::load(&data, &map).unwrap();
    (template.world(Arc::new(ground.ground.clone()), map), ground)
}
fn picks() -> BTreeMap<String, String> {
    BTreeMap::from([("mid:-1".into(), "aim9l".into()), ("mid:1".into(), "aim9l".into())])
}
fn counts(n: u32) -> BTreeMap<String, u32> {
    BTreeMap::from([("mid:-1".into(), n), ("mid:1".into(), n)])
}
fn reference(unit: u64) -> UnitRef { UnitRef { battle: 1, unit, life: 1 } }

#[test]
fn custom_count_protocol_retains_explicit_quantities_instead_of_silently_ignoring_them() {
    let command: Command = serde_json::from_value(json!({
        "op":"deploy_air", "aircraft":"f15c", "spawn":"air", "loadout":0,
        "custom":{"mid:-1":"aim9l"}, "custom_counts":{"mid:-1":1}
    })).unwrap();
    assert!(format!("{command:?}").contains("custom_counts: Some"),
        "normal custom quantity intent must survive native protocol decoding");
}

#[test]
fn custom_count_uses_only_advertised_positive_catalog_bounded_quantities() {
    let (air, _) = world();
    let option = serde_json::to_value(air.options(2022).into_iter().find(|a| a.id == "f15c").unwrap()).unwrap();
    assert_eq!(option["custom_counts_version"], 1);
    let slot = option["slots"].as_array().unwrap().iter().find(|s| s["key"] == "mid:-1").unwrap();
    assert_eq!(slot["quantity_options"]["aim9l"], json!([1, 2]));
    for count in [0, 3, u32::MAX] {
        assert!(air.accept_loadout_counts("f15c", 0, Some(&picks()), Some(&counts(count))).is_err());
    }
    assert!(air.accept_loadout_counts("f15c", 0, None, Some(&counts(1))).is_err());
    assert!(air.accept_loadout_counts("f15c", 0, Some(&picks()), Some(&BTreeMap::from([("unknown".into(), 1)]))).is_err());
    let bomb = BTreeMap::from([("inner:-1".into(), "mk82".into())]);
    assert!(air.accept_loadout_counts("f15c", 0, Some(&bomb), Some(&BTreeMap::from([("inner:-1".into(), 1)]))).is_err(),
        "A count cannot rewrite an unadjustable rack or pod's catalog contents");
    let old = air.accept_loadout("f15c", 0, Some(&picks())).unwrap();
    assert_eq!(old.value["items"].as_array().unwrap().len(), 4, "old clients keep their catalog defaults");
    assert!(air.accept_loadout_counts("f15c", 1, None, None).is_ok(), "presets are unchanged");
}

#[test]
fn custom_count_materializes_exact_quantity_and_survivor_matching_never_refills_it() {
    let (mut air, _) = world();
    air.spawn_configured_counts_fuel(reference(71), "f15c", Team::Blue, Some(7), "air", 0, Some(&picks()), Some(&counts(1)), None).unwrap();
    let u = air.units.get_mut(&71).unwrap();
    assert_eq!(u.stores.len(), 2);
    assert!(u.stores.iter().all(|s| s.value["id"] == "aim9l" && s.count == 1));
    assert_eq!(serde_json::to_value(u.view()).unwrap()["custom_counts"], json!(counts(1)));
    u.stores[0].count = 0; u.stores[0].gone = true;
    u.guns[0].ammo = 11; u.fuel -= 20.0;
    let before = (u.guns[0].ammo, u.fuel, u.resource_revision, u.damage.revision);
    assert!(air.loadout_matches_counts(71, 0, Some(&picks()), Some(&counts(1))).unwrap());
    assert!(!air.loadout_matches_counts(71, 0, Some(&picks()), Some(&counts(2))).unwrap());
    let u = &air.units[&71];
    assert_eq!((u.guns[0].ammo, u.fuel, u.resource_revision, u.damage.revision), before);
    assert_eq!(u.stores[0].count, 0);
    assert!(u.stores[0].gone);
}

#[test]
fn custom_count_airport_service_is_atomic_after_fifteen_seconds_and_cancel_keeps_current_stores() {
    let (mut air, mut ground) = world();
    let empty = BTreeMap::new();
    air.spawn_configured(reference(71), "f15c", Team::Blue, Some(7), "runway", 0, Some(&empty)).unwrap();
    let u = air.units.get_mut(&71).unwrap();
    u.controller = Some(7); u.input = service_hold_input(&u.state); u.guns[0].ammo = 11;
    let revision = u.resource_revision;
    let request = air.request_service_counts_fuel(71, 0, Some(&picks()), Some(&counts(1)), None, 0.0).unwrap();
    assert_eq!(request.custom_counts, Some(counts(1)));
    for _ in 0..1799 { air.step(1.0 / 120.0, &mut ground); }
    assert!(air.units[&71].stores.is_empty());
    assert_eq!(air.units[&71].guns[0].ammo, 11);
    assert_eq!(air.units[&71].resource_revision, revision);
    air.step(1.0 / 120.0, &mut ground);
    assert_eq!(air.units[&71].stores.len(), 2);
    assert_eq!(air.units[&71].accepted_loadout.custom_counts, Some(counts(1)));
    assert_eq!(air.units[&71].resource_revision, revision + 1);
    let accepted = air.units[&71].view();
    air.request_service_counts_fuel(71, 0, Some(&picks()), Some(&counts(2)), None, 15.0).unwrap();
    air.cancel_service(71).unwrap();
    for _ in 0..1800 { air.step(1.0 / 120.0, &mut ground); }
    assert_eq!(air.units[&71].stores.len(), accepted.stores.len());
    assert_eq!(air.units[&71].accepted_loadout.custom_counts, Some(counts(1)));
    assert_eq!(air.units[&71].resource_revision, revision + 1);
}
