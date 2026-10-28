use super::*;
use crate::frontline_air::AirServiceView;
use serde_json::json;

fn reference(id: u64) -> UnitRef {
    UnitRef {
        battle: 17,
        unit: id,
        life: 1,
    }
}
fn actor(id: u64, team: Team, x: f64) -> PerceptionActor {
    PerceptionActor {
        unit: reference(id),
        team,
        kind: ActorKind::Ground,
        alive: true,
        pos: [x, 4.0, 0.0],
        event_locus: false,
    }
}
fn world() -> PerceptionWorld {
    PerceptionWorld::new(17, PerceptionConfig::default()).unwrap()
}
fn ground(a: PerceptionActor) -> UnitView {
    UnitView {
        unit: a.unit,
        vehicle: "su_t72a".into(),
        role: "combat".into(),
        campaign_conversion: None,
        support_task: None,
        support_order_seq: 0,
        team: a.team,
        company: 901,
        platoon: Some(2),
        controller: Some(48),
        epoch: 73,
        alive: a.alive,
        pos: a.pos,
        yaw: 0.75,
        turret_yaw: -0.2,
        gun_pitch: 0.05,
        ammo: 37,
        ammo_revision: 9001,
        damage: json!({"engine_hp":0.125,"private_penetration_report":["secret"]}),
        caps: json!({"drive_power":0.25}),
        net: json!({"pos":a.pos,"ex":[1.0,0.0,0.0],"ez":[0.0,0.0,1.0],"v":[1.25,0.0,2.5],"w":[0.0,0.125,0.0],"track":[1.25,2.5],"rpm":1873,"gear":4,
            "rg":{"version":1,"q":[0.125,-0.0,0.5],"qv":[1.0,0.25,-0.125]},"private_extension":{"ammo":919}}),
        navigation: json!({"target":[9182,6173],"secret":"attack_here"}),
        reinforcing: false,
    }
}
fn air(a: PerceptionActor) -> AirUnitView {
    let mut s = vec![0.0f32; 80];
    let mut aero = vec![0.0f32; 48];
    for (i, v) in a.pos.iter().enumerate() {
        s[i] = *v as f32;
    }
    s[6] = 1.0;
    s[13] = 172.125;
    s[15] = 0.14;
    s[23] = 91.25;
    s[24] = -0.125;
    s[25] = 0.5;
    s[26] = -0.25;
    s[27] = 0.9;
    s[33] = 1.0;
    s[34] = 0.375;
    s[35] = 2.0;
    s[48] = 0.987;
    s[49] = 0.111;
    s[50] = -0.259;
    s[75] = 42.25;
    aero[23] = 0.75;
    aero[36..40].copy_from_slice(&[1.0, 0.125, 0.875, 0.25]);
    let catalog:Value=serde_json::from_str(&std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/aircraft/frontline.json")).unwrap()).unwrap();
    let profile:crate::frontline_air::AirProfile=serde_json::from_value(catalog["aircraft"]["me262"].clone()).unwrap();
    AirUnitView {
        unit: a.unit,
        aircraft: "me262".into(),
        loadout: 3,
        custom: None,
        custom_counts: None,
        weapon_control: None,
        seeker: crate::frontline_air::guided::Seeker::default(),
        countermeasures: crate::frontline_air::countermeasures::View::default(),
        decoys: vec![],
        team: a.team,
        owner: Some(48),
        controller: Some(48),
        epoch: 12,
        alive: a.alive,
        pos: [s[0] as f64, s[1] as f64, s[2] as f64],
        yaw: 2.5,
        state: s,
        aero,
        airframe_limits: crate::airframe_limits::AirframeLimitState::default(),
        flight: crate::frontline_air::AirFlightView {airframe:profile.physics.airframe,configure:profile.physics.configure,
            control:profile.physics.control,envelope:profile.physics.envelope,surfaces:profile.physics.surfaces,
            gear_sequence:profile.physics.gear_sequence,factors:[1.0;6]},
        damage: json!({"part_ids":["wing_l","engine"],"parts":[[0.25,1],[0.125,0]],"part_max_hp":[1,1],"visual_aliases":{"engine_l":"engine","engine_r":"engine"},"fire":true,"down":false,"secret_penetration":"no"}),
        guns: vec![],
        fuel: json!({"kg":27.125,"flow":0.999}),
        stores: vec![
            json!({"id":"r4m","station":"source_r4m","p":[3,-0.3,0],"owner":"wing_r","count":1,"fuel":0,"gone":false,
            "sourceStore":{"id":"SOCKET_R4M_R_01","sourceParts":["STORE_R4M_R_01::store"]},
            "sourceMount":{"id":"MOUNT_R4M_WoodRack_R","sourceParts":["MOUNT_R4M_WoodRack_R::mount"]}}),
        ],
        resource_revision: 772,
        service_revision: 98,
        service: AirServiceView {
            status: "servicing".into(),
            revision: 98,
            airfield: Some("secret_airport".into()),
            loadout: Some(3),
            custom: None,
            custom_counts: None,
            elapsed_s: 7.3,
            fuel_minutes: None,
            duration_s: 15.0,
            remaining_s: 7.7,
            reason: None,
        },
        fault: None,
    }
}
fn contact(view: &PerceptionFrame, team: Team, id: u64) -> &Contact {
    view.team(team)
        .contacts
        .iter()
        .find(|c| c.unit.unit == id)
        .unwrap()
}
fn poses(w: &mut PerceptionWorld, tick: u64, actors: &[PerceptionActor]) -> PerceptionFrame {
    let g = actors
        .iter()
        .filter(|a| a.kind == ActorKind::Ground)
        .map(|a| project_ground(&ground(*a)).unwrap())
        .collect::<Vec<_>>();
    let a = actors
        .iter()
        .filter(|a| a.kind == ActorKind::Air)
        .map(|a| project_air(&air(*a)).unwrap())
        .collect::<Vec<_>>();
    w.cache_public_poses(tick, &g, &a).unwrap()
}

#[test]
fn one_living_native_sensor_discovers_for_whole_team_with_range_los_and_dead_sensor_gates() {
    let mut w = world();
    let mut a = [
        actor(1, Team::Blue, 0.0),
        actor(2, Team::Blue, 500.0),
        actor(3, Team::Red, 2000.0),
    ];
    let mut calls = Vec::new();
    let f = w
        .advance(1, 0.0, &a, |s, t| {
            calls.push((s.unit.unit, t.unit.unit));
            s.unit.unit == 2
        })
        .unwrap();
    assert_eq!(
        f.team(Team::Blue).friendlies,
        vec![reference(1), reference(2)]
    );
    assert_eq!(f.team(Team::Blue).visible_enemies, vec![reference(3)]);
    assert_eq!(contact(&f, Team::Blue, 3).pos, a[2].pos);
    assert!(
        !calls.contains(&(1, 3)),
        "out-of-game-optical-range sensors cannot query/discover"
    );
    assert!(f.team(Team::Red).contacts.is_empty());
    a[1].alive = false;
    let f = w.advance(2, 0.25, &a, |_, _| true).unwrap();
    assert!(f.team(Team::Blue).visible_enemies.is_empty());
    assert_eq!(contact(&f, Team::Blue, 3).status, ContactStatus::LastKnown);
    assert!(
        f.team(Team::Blue).friendlies.contains(&reference(2)),
        "friendly terminal state remains a friendly full view"
    );
    a[0].pos = [-20.0, 4.0, 2.0];
    let f = w
        .advance(3, 0.3, &a, |_, _| {
            panic!("no new optical scan before period")
        })
        .unwrap();
    assert_eq!(f.team(Team::Blue).friendlies.len(), 2);
    assert_eq!(contact(&f, Team::Blue, 3).last_seen_at, 0.0);
}

#[test]
fn sampled_public_poses_freeze_between_scans_and_lost_targets_never_update_to_secret_truth() {
    let mut w = world();
    let mut a = [actor(1, Team::Blue, 0.0), actor(2, Team::Red, 100.0)];
    w.advance(1, 0.0, &a, |_, _| true).unwrap();
    let seen = poses(&mut w, 1, &a);
    let original = seen.team(Team::Blue).visible_ground[0].clone();
    a[1].pos = [777.0, 4.0, 123.0];
    let between = w
        .advance(2, 0.05, &a, |_, _| panic!("4Hz not 20Hz LOS"))
        .unwrap();
    assert_eq!(
        between.team(Team::Blue).visible_ground,
        vec![original.clone()]
    );
    assert_eq!(contact(&between, Team::Blue, 2).pos, [100.0, 4.0, 0.0]);
    let secret = project_ground(&ground(a[1])).unwrap();
    assert!(
        w.cache_public_poses(2, &[secret], &[]).is_err(),
        "a prior discovery is not live-truth admission"
    );
    let lost = w.advance(3, 0.25, &a, |_, _| false).unwrap();
    assert!(lost.team(Team::Blue).visible_ground.is_empty());
    assert!(lost.team(Team::Blue).visible_enemies.is_empty());
    assert_eq!(contact(&lost, Team::Blue, 2).pos, original.pos);
    assert_eq!(contact(&lost, Team::Blue, 2).last_seen_tick, 1);
    assert_eq!(
        contact(&lost, Team::Blue, 2).status,
        ContactStatus::LastKnown
    );
    // Omniscient death/movement/removal must not replace the last seen life.
    a[1].alive = false;
    a[1].pos = [999.0, -15.0, 400.0];
    let lost = w.advance(4, 0.5, &a, |_, _| false).unwrap();
    assert!(contact(&lost, Team::Blue, 2).observed_alive);
    assert_eq!(contact(&lost, Team::Blue, 2).pos, original.pos);
    let gone = w.advance(5, 29.99, &a[..1], |_, _| false).unwrap();
    assert_eq!(gone.team(Team::Blue).contacts.len(), 1);
    let expired = w.advance(6, 30.0, &a[..1], |_, _| false).unwrap();
    assert!(expired.team(Team::Blue).contacts.is_empty());
}

#[test]
fn actual_visible_wreck_is_observed_but_new_life_never_inherits_an_old_detection() {
    let mut w = world();
    let mut a = [actor(1, Team::Blue, 0.0), actor(2, Team::Red, 100.0)];
    w.advance(1, 0.0, &a, |_, _| true).unwrap();
    poses(&mut w, 1, &a);
    a[1].alive = false;
    let wreck = w.advance(2, 0.25, &a, |_, _| true).unwrap();
    assert!(
        !contact(&wreck, Team::Blue, 2).observed_alive,
        "only real LOS may reveal death"
    );
    a[1].unit.life = 2;
    a[1].alive = true;
    a[1].pos = [1100.0, 4.0, 0.0];
    let hidden = w.advance(3, 0.5, &a, |_, _| false).unwrap();
    assert!(hidden.team(Team::Blue).visible_enemies.is_empty());
    assert!(hidden
        .team(Team::Blue)
        .contacts
        .iter()
        .all(|c| c.unit.life == 1));
    let seen = w.advance(4, 0.75, &a, |_, _| true).unwrap();
    assert_eq!(seen.team(Team::Blue).visible_enemies, vec![a[1].unit]);
    let seen = poses(&mut w, 4, &a);
    assert_eq!(seen.team(Team::Blue).visible_ground[0].unit.life, 2);
    assert_eq!(
        seen.team(Team::Blue).visible_ground[0].pos,
        [1100.0, 4.0, 0.0]
    );
    assert_eq!(
        seen.team(Team::Blue)
            .contacts
            .iter()
            .find(|c| c.unit.life == 1)
            .unwrap()
            .pos,
        [100.0, 4.0, 0.0]
    );
}

#[test]
fn no_live_team_sensor_retires_visible_models_immediately_without_revealing_enemy_changes() {
    let mut w = world();
    let mut a = [actor(1, Team::Blue, 0.0), actor(2, Team::Red, 100.0)];
    w.advance(1, 0.0, &a, |_, _| true).unwrap();
    poses(&mut w, 1, &a);
    a[0].alive = false;
    a[1].pos[0] = 900.0;
    let f = w
        .advance(2, 0.05, &a, |_, _| panic!("no scan needed"))
        .unwrap();
    assert!(f.team(Team::Blue).visible_ground.is_empty());
    assert!(f.team(Team::Blue).visible_enemies.is_empty());
    assert_eq!(contact(&f, Team::Blue, 2).status, ContactStatus::LastKnown);
    assert_eq!(contact(&f, Team::Blue, 2).pos, [100.0, 4.0, 0.0]);
}

#[test]
fn invalid_inputs_are_atomic_and_worlds_reject_other_battles_duplicate_slots_and_clock_rollback() {
    let mut w = world();
    let a = [actor(1, Team::Blue, 0.0), actor(2, Team::Red, 100.0)];
    w.advance(10, 1.0, &a, |_, _| true).unwrap();
    let saved = poses(&mut w, 10, &a);
    let mut cross = a;
    cross[1].unit.battle = 18;
    assert!(w
        .advance(11, 1.25, &cross, |_, _| panic!("validate before LOS"))
        .is_err());
    let mut duplicate = a;
    duplicate[1].unit.unit = 1;
    duplicate[1].unit.life = 2;
    assert!(w.advance(11, 1.25, &duplicate, |_, _| true).is_err());
    let mut nonfinite = a;
    nonfinite[1].pos[2] = f64::NAN;
    assert!(w.advance(11, 1.25, &nonfinite, |_, _| true).is_err());
    assert!(w.advance(10, 1.25, &a, |_, _| true).is_err());
    assert!(w.advance(11, 0.99, &a, |_, _| true).is_err());
    assert!(w.advance(11, f64::INFINITY, &a, |_, _| true).is_err());
    assert_eq!(w.frame().unwrap(), &saved);
    let mut other = PerceptionWorld::new(18, PerceptionConfig::default()).unwrap();
    assert!(other.advance(1, 0.0, &a, |_, _| true).is_err());
    assert!(PerceptionWorld::new(0, PerceptionConfig::default()).is_err());
    let bad = PerceptionConfig {
        scan_period_s: 0.0,
        ..PerceptionConfig::default()
    };
    assert!(PerceptionWorld::new(17, bad).is_err());
}

#[test]
fn public_pose_binding_is_same_tick_complete_atomic_and_single_grant() {
    let mut w = world();
    let a = [actor(1, Team::Blue, 0.0), actor(2, Team::Red, 100.0)];
    let pending = w.advance(1, 0.0, &a, |_, _| true).unwrap();
    let g = a.map(|a| project_ground(&ground(a)).unwrap());
    assert!(w.cache_public_poses(2, &g, &[]).is_err());
    assert!(
        w.cache_public_poses(1, &g[..1], &[]).is_err(),
        "missing red sample cannot half-publish blue"
    );
    let mut changed = g.clone();
    changed[1].pos[0] = 101.0;
    assert!(w.cache_public_poses(1, &changed, &[]).is_err());
    let mut changed = g.clone();
    changed[1].unit.life = 2;
    assert!(w.cache_public_poses(1, &changed, &[]).is_err());
    let duplicate = [g[0].clone(), g[1].clone(), g[1].clone()];
    assert!(w.cache_public_poses(1, &duplicate, &[]).is_err());
    assert_eq!(w.frame().unwrap(), &pending);
    let committed = w.cache_public_poses(1, &g, &[]).unwrap();
    assert_eq!(
        committed.team(Team::Blue).visible_ground,
        vec![g[1].clone()]
    );
    assert_eq!(committed.team(Team::Red).visible_ground, vec![g[0].clone()]);
    assert!(
        w.cache_public_poses(1, &g, &[]).is_err(),
        "same scan cannot refresh secretly after initial publication"
    );
}

#[test]
fn ground_whitelist_retains_exact_native_mesh_kinematics_and_discards_all_private_fields() {
    let a = actor(2, Team::Red, 100.0);
    let mut view = ground(a);
    let public = project_ground(&view).unwrap();
    assert_eq!(public.net.ex, [1.0, 0.0, 0.0]);
    assert_eq!(public.net.ez, [0.0, 0.0, 1.0]);
    assert_eq!(public.net.track, [1.25, 2.5]);
    assert_eq!(
        public.net.rg.as_ref().unwrap().q[1].to_bits(),
        (-0.0f64).to_bits()
    );
    view.ammo = 0;
    view.ammo_revision += 100;
    view.damage = json!({"secret_hp":1234});
    view.caps = json!({"secret":true});
    view.company = 99;
    view.controller = None;
    view.epoch += 99;
    view.navigation = json!({"target":[999,888]});
    view.net["rpm"] = json!(9000);
    view.net["gear"] = json!(7);
    view.net["private_extension"] = json!(["new secret"]);
    assert_eq!(project_ground(&view).unwrap(), public);
    let value = serde_json::to_value(&public).unwrap();
    let text = value.to_string();
    for forbidden in [
        "ammo",
        "damage",
        "caps",
        "company",
        "controller",
        "epoch",
        "navigation",
        "rpm",
        "private_extension",
    ] {
        assert!(
            !text.contains(forbidden),
            "private {forbidden} must not serialize"
        );
    }
    assert_eq!(
        serde_json::from_value::<PublicGroundPose>(value.clone()).unwrap(),
        public
    );
    let mut injected = value;
    injected["ammo"] = json!(123);
    assert!(serde_json::from_value::<PublicGroundPose>(injected).is_err());
    view.net["rg"]["qv"] = json!([0.0]);
    assert!(project_ground(&view).is_err());
}

#[test]
fn support_projection_keeps_only_visible_role_and_explicit_game_conversion_identity() {
    let mut v = ground(actor(2, Team::Red, 100.0));
    v.vehicle = "su_att_m46".into();
    v.role = "engineer".into();
    v.campaign_conversion = Some(
        json!({"kind":"campaign_support_conversion","role":"engineer","chassis":"su_att_m46","prototype":true,"mass_basis":"registered_chassis",
        "private_stock":500,"secret_destination":[100,999],"repair_progress":0.9}),
    );
    v.support_task =
        Some(json!({"kind":"repair_bridge","target":"secret_bridge","stock":500,"remaining_s":27}));
    let public = project_ground(&v).unwrap();
    assert_eq!(public.role, "engineer");
    assert_eq!(
        public.campaign_conversion.as_ref().unwrap().chassis,
        "su_att_m46"
    );
    let value = serde_json::to_value(&public).unwrap();
    let text = value.to_string();
    for field in [
        "support_task",
        "private_stock",
        "secret_destination",
        "repair_progress",
        "secret_bridge",
        "remaining_s",
    ] {
        assert!(!text.contains(field));
    }
    v.support_task = None;
    assert_eq!(project_ground(&v).unwrap(), public);
    v.role = "supply".into();
    assert!(
        project_ground(&v).is_err(),
        "visual role and actual conversion must agree"
    );
    v.campaign_conversion.as_mut().unwrap()["role"] = json!("supply");
    assert_eq!(project_ground(&v).unwrap().role, "supply");
    v.campaign_conversion.as_mut().unwrap()["prototype"] = json!(false);
    assert!(project_ground(&v).is_err());
}

#[test]
fn air_whitelist_preserves_actual_surface_and_four_axis_values_but_no_aim_inventory_or_internal_health(
) {
    let mut a = actor(8, Team::Red, 120.0);
    a.kind = ActorKind::Air;
    let mut view = air(a);
    let public = project_air(&view).unwrap();
    assert_eq!(public.gear_axes, [1.0, 0.125, 0.875, 0.25]);
    assert_eq!(public.quaternion, [0.0, 0.0, 0.0, 1.0]);
    assert_eq!(
        (
            public.pitch_surface,
            public.roll_surface,
            public.yaw_surface
        ),
        (-0.125, 0.5, -0.25)
    );
    assert_eq!(public.detached_parts, vec!["wing_l"]);
    assert_eq!(
        (public.pos, public.speed, public.agl),
        ([120.0, 4.0, 0.0], 172.125, 2.0)
    );
    view.loadout = 77;
    view.owner = None;
    view.controller = None;
    view.epoch += 73;
    view.fuel = json!({"kg":0});
    view.stores[0]["count"] = json!(999);
    view.stores[0]["fuel"] = json!(987.125);
    view.stores[0]["private_feed"] = json!({"ammo":17,"belt":"secret"});
    view.resource_revision += 1;
    view.service_revision += 1;
    view.service.status = "secret".into();
    view.damage["parts"][0][0] = json!(0.001);
    view.damage["parts"][1][0] = json!(0.999);
    view.damage["fire"] = json!(false);
    view.state[48] = -0.999;
    view.state[49] = 0.888;
    view.state[50] = 0.777;
    view.state[27] = 0.125;
    assert_eq!(project_air(&view).unwrap(), public);
    let value = serde_json::to_value(&public).unwrap();
    let text = value.to_string();
    for forbidden in [
        "state",
        "aero",
        "fuel",
        "guns",
        "ammo",
        "loadout",
        "controller",
        "epoch",
        "aim",
        "part_max_hp",
        "service",
        "revision",
        "throttle",
    ] {
        assert!(
            !text.contains(&format!("\"{forbidden}\"")),
            "private {forbidden} must not serialize"
        );
    }
    assert!(
        value.get("owner").is_none(),
        "store.owner is a source part carrier, aircraft player owner must be absent"
    );
    assert_eq!(
        serde_json::from_value::<PublicAirPose>(value).unwrap(),
        public
    );
    view.damage["parts"][1][1] = json!(1);
    assert_eq!(
        project_air(&view).unwrap().detached_parts,
        vec!["engine", "engine_l", "engine_r", "wing_l"]
    );
    view.damage["visual_aliases"]["unknown"] = json!("not_a_part");
    assert!(project_air(&view).is_err());
    view = air(a);
    view.state[0] = 999.0;
    assert!(project_air(&view).is_err());
}

#[test]
fn external_single_weapons_hide_individually_but_empty_pod_tank_and_racks_keep_only_visible_geometry(
) {
    let mut a = actor(8, Team::Red, 120.0);
    a.kind = ActorKind::Air;
    let mut v = air(a);
    v.stores.push(json!({"id":"b8m1","station":"p2","p":[4,-0.4,0],"owner":"wing_r","count":20,"fuel":0,"gone":false,"pylon":[[4,0,0],[4,-0.2,0]]}));
    v.stores.push(json!({"id":"ptb800","station":"p3","p":[5,-0.5,0],"owner":"wing_r","count":1,"fuel":500,"gone":false}));
    let before = project_air_with_store_lengths(&v, |_| Some(2.0)).unwrap();
    assert_eq!(before.stores.len(), 3);
    assert_eq!(before.stores[1].pylon_length, Some(1.1));
    assert!(
        project_air(&v).is_err(),
        "unknown pylon length must not be invented"
    );
    v.stores[1]["count"] = json!(0);
    v.stores[2]["fuel"] = json!(0);
    assert_eq!(
        project_air_with_store_lengths(&v, |_| Some(2.0)).unwrap(),
        before,
        "opaque pod contents and tank fuel cannot be inferred from appearance updates"
    );
    v.stores[0]["count"] = json!(0);
    v.stores[0]["gone"] = json!(true);
    let after = project_air_with_store_lengths(&v, |_| Some(2.0)).unwrap();
    let rack = &after.stores[0];
    assert_eq!(rack.weapon_instance, "store:0");
    assert!(!rack.present);
    assert!(rack.mount_present);
    assert!(
        rack.id.is_none() && rack.p.is_none() && rack.source_store.is_none(),
        "empty mount must not reveal previously carried weapon/centroid"
    );
    assert_eq!(
        rack.source_mount.as_ref().unwrap().id,
        "MOUNT_R4M_WoodRack_R"
    );
    v.stores[2]["gone"] = json!(true);
    let after = project_air_with_store_lengths(&v, |_| Some(2.0)).unwrap();
    assert_eq!(
        after
            .stores
            .iter()
            .map(|s| s.weapon_instance.as_str())
            .collect::<Vec<_>>(),
        vec!["store:0", "store:1"],
        "gone unmounted store is omitted without renumbering other source sockets"
    );
    v.damage["part_ids"] = json!(["wing_l", "engine", "wing_r"]);
    v.damage["parts"] = json!([[0.25, 1], [1, 0], [0, 1]]);
    assert!(
        project_air_with_store_lengths(&v, |_| Some(2.0))
            .unwrap()
            .stores
            .is_empty(),
        "carrier detachment removes actual store AND mounts"
    );
}

#[test]
fn actual_original_and_inherited_source_layouts_project_socket_geometry_without_copying_any_inventory() {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/aircraft/frontline.json");
    let catalog: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let types = catalog["aircraft"].as_object().unwrap();
    crate::frontline_catalog_test_contract::assert_ids(types.keys().map(String::as_str));
    let mut physical = 0;
    let mut source = 0;
    let mut empty_pods = 0;
    for profile in types.values() {
        for loadout in profile["stores"]["loadouts"].as_array().unwrap() {
            let mut stores = loadout["items"].as_array().unwrap().clone();
            for item in &mut stores {
                item["gone"] = json!(false);
                item["fuel"] = json!(123.125);
            }
            let lengths = |id: &str| catalog["storeDefinitions"][id]["len"].as_f64();
            let projected = project_visual_stores(&stores, &BTreeSet::new(), &lengths).unwrap();
            assert_eq!(projected.len(), stores.len());
            physical += projected.len();
            for (index, (public, raw)) in projected.iter().zip(&stores).enumerate() {
                assert_eq!(public.weapon_instance, format!("store:{index}"));
                assert!(public.present);
                assert_eq!(public.id.as_deref(), raw["id"].as_str());
                assert_eq!(
                    public.p,
                    Some(serde_json::from_value::<[f64; 3]>(raw["p"].clone()).unwrap())
                );
                if public.source_store.is_some() {
                    source += 1;
                }
                let value = serde_json::to_value(public).unwrap();
                for key in ["count", "fuel", "rocketMass", "feed", "ammo"] {
                    assert!(value.get(key).is_none());
                }
            }
            for item in &mut stores {
                if catalog["storeDefinitions"][item["id"].as_str().unwrap()]["kind"] == "pod" {
                    item["count"] = json!(0);
                    empty_pods += 1;
                }
            }
            assert_eq!(
                project_visual_stores(&stores, &BTreeSet::new(), &lengths).unwrap(),
                projected
            );
        }
    }
    assert!(
        physical > 100 && source >= 24 && empty_pods > 0,
        "real source layouts include finite single sockets and opaque pod containers"
    );
}

#[test]
fn mixed_ground_air_sightings_cache_real_model_types_and_are_shared_only_to_authorized_team() {
    let mut a = [
        actor(1, Team::Blue, 0.0),
        actor(2, Team::Red, 100.0),
        actor(3, Team::Red, 3000.0),
    ];
    a[2].kind = ActorKind::Air;
    let mut w = world();
    w.advance(1, 0.0, &a, |_, _| true).unwrap();
    let f = poses(&mut w, 1, &a);
    assert_eq!(f.team(Team::Blue).visible_ground[0].vehicle, "su_t72a");
    assert_eq!(f.team(Team::Blue).visible_aircrafts[0].aircraft, "me262");
    assert!(f.team(Team::Red).visible_aircrafts.is_empty());
    assert!(f
        .team(Team::Blue)
        .visible_ground
        .iter()
        .all(|p| p.team == Team::Red));
    let before = f.team(Team::Blue).visible_aircrafts[0].clone();
    a[2].pos = [3900.0, 200.0, 50.0];
    let f = w
        .advance(2, 0.05, &a, |_, _| panic!("no extra scan"))
        .unwrap();
    assert_eq!(f.team(Team::Blue).visible_aircrafts, vec![before]);
}

#[test]
fn native_countermeasure_public_decoys_follow_aircraft_visibility_without_stock_leak(){
    let mut a=[actor(1,Team::Blue,0.0),actor(2,Team::Red,100.0)];a[1].kind=ActorKind::Air;
    let mut enemy=air(a[1]);
    enemy.decoys=vec![crate::frontline_air::countermeasures::DecoyView{id:1,kind:crate::frontline_air::countermeasures::Kind::Flares,pos:[100.0,4.0,-2.0],velocity:[0.0,-6.0,0.0],age:0.1,ttl:5.0}];
    let public=project_air(&enemy).unwrap();let wire=serde_json::to_value(&public).unwrap();
    assert_eq!(wire["decoys"][0]["id"],1);assert!(wire.get("countermeasures").is_none());assert!(wire["decoys"][0].get("owner").is_none());
    let mut w=world();w.advance(1,0.0,&a,|_,_|true).unwrap();
    let seen=w.cache_public_poses(1,&[project_ground(&ground(a[0])).unwrap()],&[public]).unwrap();assert_eq!(seen.team(Team::Blue).visible_aircrafts[0].decoys.len(),1);
    let hidden=w.advance(2,0.25,&a,|_,_|false).unwrap();assert!(hidden.team(Team::Blue).visible_aircrafts.is_empty(),"a hidden aircraft cannot keep broadcasting live decoy positions");
}

fn shot(tick: u64, source: UnitRef, target: UnitRef) -> EventCandidate {
    EventCandidate {
        kind: PublicEventKind::Shot,
        kind_hint: ActorKind::Ground,
        tick,
        pos: [1.0, 5.0, 0.0],
        shooter: Some(source),
        target: Some(target),
        shot: Some(PublicShotEffect {
            shot_id: 12,
            velocity: [0.0, 0.0, 900.0],
            caliber_mm: Some(125.0),
            airborne: false,
            store: false,
            weapon_instance: Some("gun:0:0".into()),
        }),
    }
}
#[test]
fn allied_shots_keep_effects_but_hidden_targets_and_enemy_incoming_details_do_not_leak() {
    let mut w = world();
    let a = [actor(1, Team::Blue, 0.0), actor(2, Team::Red, 100.0)];
    w.advance(1, 0.0, &a, |_, _| true).unwrap();
    poses(&mut w, 1, &a);
    let event = shot(1, reference(1), reference(2));
    let views = w.project_event(&event, |_, _| false).unwrap();
    let own = views[0].as_ref().unwrap();
    assert_eq!(own.shooter, Some(reference(1)));
    assert_eq!(own.target, None);
    assert!(own.shot.is_some());
    assert!(views[1].is_none());
    let incoming = EventCandidate {
        kind: PublicEventKind::Impact,
        kind_hint: ActorKind::Ground,
        tick: 1,
        pos: a[0].pos,
        shooter: Some(reference(2)),
        target: Some(reference(1)),
        shot: event.shot.clone(),
    };
    let views = w.project_event(&incoming, |_, _| false).unwrap();
    let own = views[0].as_ref().unwrap();
    assert_eq!(own.shooter, None);
    assert_eq!(own.target, Some(reference(1)));
    assert!(own.shot.is_none());
    assert!(
        views[1].is_none(),
        "friendly firing must not disclose a distant hidden impact"
    );
    let hidden_death = EventCandidate {
        kind: PublicEventKind::Destroyed,
        kind_hint: ActorKind::Ground,
        tick: 1,
        pos: a[1].pos,
        shooter: Some(reference(1)),
        target: Some(reference(2)),
        shot: None,
    };
    let views = w.project_event(&hidden_death, |_, _| false).unwrap();
    assert!(
        views[0].is_none(),
        "old detected IDs must not reveal a death behind LOS obstruction"
    );
    assert!(views[1].is_some());
    let witnessed = w.project_event(&hidden_death, |_, _| true).unwrap();
    assert_eq!(witnessed[0].as_ref().unwrap().target, Some(reference(2)));
}

#[test]
fn native_event_parser_discards_arbitrary_reports_and_requires_scoped_identity() {
    let mut w = world();
    let a = [actor(1, Team::Blue, 0.0), actor(2, Team::Red, 100.0)];
    w.advance(1, 0.0, &a, |_, _| false).unwrap();
    let mut raw = json!({"kind":"shot","shooter":reference(1),"target":reference(2),"pos":[1,5,0],
        "detail":{"shot_id":12,"velocity":[0,0,900],"caliber_mm":125,"airborne":false,"store":false,
            "ammo_revision":987,"target_position":[999,444,777],"report":{"modules":{"engine":{"hp":0.123}}},"private_belt":"secret","seed":"server_rng"}});
    let e = EventCandidate::from_native(1, ActorKind::Ground, &raw)
        .unwrap()
        .unwrap();
    let public = w.project_event(&e, |_, _| false).unwrap()[0]
        .clone()
        .unwrap();
    let value = serde_json::to_value(public).unwrap();
    let text = value.to_string();
    assert_eq!(value["detail"]["shot_id"], 12);
    assert_eq!(value["target"], Value::Null);
    for forbidden in [
        "ammo_revision",
        "target_position",
        "report",
        "modules",
        "hp",
        "private_belt",
        "seed",
        "999",
        "444",
        "777",
    ] {
        assert!(!text.contains(forbidden));
    }
    raw["target"] = json!(2);
    assert!(EventCandidate::from_native(1, ActorKind::Ground, &raw).is_err());
    assert!(EventCandidate::from_native(
        1,
        ActorKind::Ground,
        &json!({"kind":"reinforcement_batch","secret_order":[1,2]})
    )
    .unwrap()
    .is_none());
    let mut wrong = shot(1, reference(1), reference(2));
    wrong.target.as_mut().unwrap().battle = 18;
    assert!(w.project_event(&wrong, |_, _| true).is_err());
    wrong = shot(0, reference(1), reference(2));
    assert!(w.project_event(&wrong, |_, _| true).is_err());
}

#[test]
fn event_witness_requires_living_native_sensor_even_when_last_scan_saw_the_enemy() {
    let mut w = world();
    let mut a = [actor(1, Team::Blue, 0.0), actor(2, Team::Red, 100.0)];
    w.advance(1, 0.0, &a, |_, _| true).unwrap();
    a[0].alive = false;
    w.advance(2, 0.05, &a, |_, _| false).unwrap();
    let event = EventCandidate {
        kind: PublicEventKind::Explosion,
        kind_hint: ActorKind::Ground,
        tick: 2,
        pos: [100.0, 5.0, 0.0],
        shooter: None,
        target: Some(reference(2)),
        shot: None,
    };
    let views = w.project_event(&event, |_, _| true).unwrap();
    assert!(views[0].is_none());
    assert!(views[1].is_some());
}

#[test]
fn native_effect_loci_preserve_actual_positions_and_exclude_only_their_real_endpoint_body() {
    let mut w = world();
    let a = [actor(1, Team::Blue, 0.0), actor(2, Team::Red, 100.0)];
    w.advance(1, 0.0, &a, |_, _| true).unwrap();
    let impact = EventCandidate {
        kind: PublicEventKind::Impact,
        kind_hint: ActorKind::Ground,
        tick: 1,
        pos: [100.1, 4.75, 0.0],
        shooter: Some(reference(1)),
        target: Some(reference(2)),
        shot: None,
    };
    let mut points = Vec::new();
    let view = w
        .project_event(&impact, |_, target| {
            if target.event_locus {
                points.push((target.unit, target.pos));
            }
            true
        })
        .unwrap();
    assert_eq!(view[0].as_ref().unwrap().pos, [100.1, 4.75, 0.0]);
    assert!(!points.is_empty());
    assert!(points
        .iter()
        .all(|&(unit, pos)| unit == reference(2) && pos == impact.pos));
    let shot = shot(1, reference(1), reference(2));
    points.clear();
    w.project_event(&shot, |_, target| {
        if target.event_locus {
            points.push((target.unit, target.pos));
        }
        true
    })
    .unwrap();
    assert!(points
        .iter()
        .all(|&(unit, pos)| unit == reference(1) && pos == shot.pos));
    let mut fake = a;
    fake[0].event_locus = true;
    assert!(
        w.advance(2, 0.25, &fake, |_, _| true).is_err(),
        "event pseudoactors cannot become native discovery sensors"
    );
}

#[test]
fn fitted_mount_public_projection_preserves_only_the_accepted_authored_key() {
    let raw=json!({"id":"hvar","station":"p2","owner":"wing_l","p":[-2.25,-0.4,0.75],"gone":false,
        "fittedMountKey":"f4e:0","count":17,"fuel":123.0,"private_feed":{"ammo":99},"custom":{"secret":true},"weapon_control":{"program":"all"}});
    let public=project_visual_stores(&[raw],&BTreeSet::new(),&|_|None).unwrap();
    assert_eq!(public.len(),1);
    let value=serde_json::to_value(&public[0]).unwrap();
    assert_eq!(value["fittedMountKey"],"f4e:0","public adapter identity must come from the accepted native store");
    assert_eq!(value["p"],json!([-2.25,-0.4,0.75]));
    assert_eq!(value["owner"],"wing_l");
    for field in ["count","fuel","private_feed","custom","weapon_control"] {assert!(value.get(field).is_none(),"private {field} must not leak");}
    assert_eq!(serde_json::from_value::<PublicVisualStore>(value).unwrap(),public[0]);
}

#[test]
fn fitted_mount_public_projection_keeps_empty_adapter_without_a_generic_pylon_or_rack() {
    let raw=json!({"id":"hvar","station":"p2","owner":"wing_l","p":[-2.25,-0.4,0.75],"gone":true,
        "fittedMountKey":"f4e:0","count":0,"fuel":0.0,"sourceStore":{"id":"SECRET_RELEASED_WEAPON","sourceParts":["SECRET_WEAPON"]}});
    let public=project_visual_stores(&[raw.clone()],&BTreeSet::new(),&|_|None).unwrap();
    assert_eq!(public.len(),1,"released weapon must retain its carrier-mounted authored adapter");
    let value=serde_json::to_value(&public[0]).unwrap();
    assert_eq!(value["fittedMountKey"],"f4e:0");
    assert_eq!(value["weapon_instance"],"store:0");
    assert_eq!(value["present"],false);
    assert_eq!(value["mount_present"],true);
    for field in ["id","p","sourceStore"] {assert!(value[field].is_null(),"absent weapon's {field} must remain absent");}
    assert!(value.get("count").is_none());
    assert!(!value.to_string().contains("SECRET_WEAPON"));
    assert!(project_visual_stores(&[raw],&BTreeSet::from(["wing_l".into()]),&|_|None).unwrap().is_empty(),"detached carrier cannot retain an adapter in the public scene");
}

#[test]
fn fitted_mount_public_projection_rejects_invalid_authored_keys_without_inventing_a_binding() {
    let base=json!({"id":"hvar","station":"p2","owner":"body","p":[0.0,-0.4,0.75],"gone":false});
    for invalid in [json!(""),json!(17),json!(false),json!([]),json!({"preset":1})] {
        let mut raw=base.clone();raw["fittedMountKey"]=invalid;
        assert!(project_visual_stores(&[raw],&BTreeSet::new(),&|_|None).is_err(),"malformed accepted fitted key must fail closed");
    }
    for absent in [base.clone(),{let mut raw=base;raw["fittedMountKey"]=Value::Null;raw}] {
        let public=project_visual_stores(&[absent],&BTreeSet::new(),&|_|None).unwrap();
        let value=serde_json::to_value(&public[0]).unwrap();
        assert!(value.get("fittedMountKey").is_none_or(Value::is_null),"no key can be derived from store ID or index");
    }
}
