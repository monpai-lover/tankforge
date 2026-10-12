use super::*;
use crate::ammo::{AmmoCatalog, AmmoLedger, AmmoMix, AmmoScope, MAX_SAFE_COUNTER};
use serde_json::json;

fn loaded() -> (crate::server::CombatData, crate::missiles::MissileData) {
    let data = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    (
        crate::server::load_combat(&data),
        crate::missiles::load(&data),
    )
}
fn mix(v: Value) -> AmmoMix {
    serde_json::from_value(v).unwrap()
}
fn send(l: &mut Lobby, id: u32, mut v: Value, now: f64) -> Out {
    if v["t"]=="state" {super::gameplay_tests::fixture_state(l,id,&mut v["s"],now);}
    l.handle(id, serde_json::from_value(v).unwrap(), now)
}
fn message(out: &Out, id: u32, kind: &str) -> Value {
    out.iter()
        .filter(|(to, _)| *to == id)
        .map(|(_, m)| serde_json::to_value(m).unwrap())
        .find(|m| m["t"] == kind)
        .unwrap_or(Value::Null)
}
pub(super) fn real_lobby() -> Lobby {
    let (c, m) = loaded();
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let (shells, vehicles, maps) = crate::server::load_catalog(&path);
    Lobby::new(shells, vehicles, maps)
        .with_combat(c.targets, c.projectiles, c.bullets)
        .with_missiles(m)
        .with_points(crate::server::load_points(&path))
}
fn connected(l: &mut Lobby) -> u32 {
    let (id, _) = l.connect();
    send(
        l,
        id,
        json!({"t":"hello","name":"ammo","gameplay_rules_version":GAMEPLAY_RULES_VERSION,"ammo_protocol_version":1}),
        0.0,
    );
    id
}

#[test]
fn t72a_actual_c2_catalog_consumption_and_five_second_supply_keep_one_22_set_stock_owner() {
    let mut scenarios=serde_json::Map::new();
    for mode in ["historical","casual"] {
        let mut l=real_lobby();let id=connected(&mut l);
        let catalog=AmmoCatalog::from_target(&l.targets["su_t72a"],None).unwrap();
        assert_eq!(catalog.guns["gun:0:0"].capacity,Some(22));
        assert_eq!(catalog.guns["gun:0:0"].defaults,vec![8,6,8]);
        assert!(catalog.validate_mix(Some(&mix(json!({"gun:0:0":[22,22,0]})))).is_err());
        send(&mut l,id,json!({"t":"create","name":"AZ","map":"coast","max":8,"deploy":true,"gameplay_mode":mode,"gameplay_rules_version":GAMEPLAY_RULES_VERSION}),0.0);
        let room=l.players[&id].room.unwrap();send(&mut l,id,json!({"t":"start"}),0.0);
        let mut phases=serde_json::Map::new();
        record(&mut phases,"deploy",send(&mut l,id,json!({"t":"deploy","vehicle":"su_t72a","ammo_mix":{"gun:0:0":[1,0,0]}}),0.0));
        capture(&mut l,id,room);
        let state=l.players[&id].combat.as_ref().unwrap();
        let caps=serde_json::to_value(tg_combat::caps(&l.targets["su_t72a"],state)).unwrap();
        assert_eq!(caps["weapons"]["gun:0:0"]["mechanized"],true);
        assert_eq!(caps["weapons"]["gun:0:0"]["reload_mult"],1.0);
        let scope=l.ammo_scope(id);let shell="apfsds_125_3bm22";
        record(&mut phases,"first",fire(&mut l,id,41,"gun:0:0",shell,0.0));
        assert_eq!(l.players[&id].ammo.as_ref().unwrap().counts["gun:0:0"],vec![0,0,0]);
        let after=l.players[&id].ammo.clone();fire(&mut l,id,41,"gun:0:0",shell,0.1);
        assert_eq!(l.players[&id].ammo,after,"retry must not charge the carousel twice");
        let denied=fire(&mut l,id,42,"gun:0:0",shell,0.2);
        assert_eq!(message(&denied,id,"fire_rejected")["reason"],"no_ammo");
        record(&mut phases,"empty_reject",denied);
        l.tick_at(0.2);
        for i in 1..=19 {supply_tick(&mut l,id,0.2+i as f64*0.25);}
        assert_eq!(l.players[&id].ammo.as_ref().unwrap().counts["gun:0:0"],vec![0,0,0]);
        record(&mut phases,"at_5",broadcast_out(supply_tick(&mut l,id,5.2)));
        assert_eq!(l.players[&id].ammo.as_ref().unwrap().counts["gun:0:0"],vec![1,0,0]);
        assert_eq!(l.ammo_scope(id),scope);
        let refill=phases["at_5"].as_array().unwrap().iter().find(|e|e[0]==id && e[1]["t"]=="ammo").unwrap();
        assert_eq!(refill[1]["refilled"],true);
        scenarios.insert(mode.into(),json!({"owner":id,"mode":mode,"scope":scope,"caps":caps,"phases":phases}));
    }
    if let Ok(file)=std::env::var("TG_T72A_RECEIPT") {
        let mut sources=source_tags();
        for path in ["crates/weapon/src/loading.rs","crates/vehicle/src/files.rs","crates/vehicle/src/validate.rs",
            "data/vehicles/su_t72a/vehicle.json","data/vehicles/su_t72a/weapons.json","data/vehicles/su_t72a/engine.json",
            "data/vehicles/su_t72a/crew.json","data/vehicles/su_t72a/modules.json","data/vehicles/su_t72a/armor.json",
            "data/vehicles/su_t72a/visual.json","data/projectiles/apfsds_125_3bm22.json","data/projectiles/heatfs_125_3bk14.json",
            "data/projectiles/he_125_3of26.json","data/machine_guns.json"] {
            sources[path]=Value::String(std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..").join(path)).unwrap());
        }
        std::fs::write(file,serde_json::to_vec(&json!({"sources":sources,"scenarios":scenarios,"authority_boundary":"C2 quantity/scope only; conventional cannon cycle remains existing client owner"})).unwrap()).unwrap();
    }
}
fn sortie(l: &mut Lobby, vehicle: &str, selected: Value) -> (u32, u32, Out) {
    let id = connected(l);
    send(
        l,
        id,
        json!({"t":"create","name":"ammo","map":"coast","max":8,"deploy":true,"gameplay_mode":"historical","gameplay_rules_version":GAMEPLAY_RULES_VERSION}),
        0.0,
    );
    let room = l.players[&id].room.unwrap();
    send(l, id, json!({"t":"start"}), 0.0);
    let out = send(
        l,
        id,
        json!({"t":"deploy","vehicle":vehicle,"ammo_mix":selected}),
        0.0,
    );
    send(l, id, json!({"t":"state","s":{"pos":[0,0,0]}}), 0.0);
    (id, room, out)
}
fn pose(l: &mut Lobby, id: u32, now: f64, x: f64, z: f64) {
    send(l, id, json!({"t":"state","s":{"pos":[x,0,z]}}), now);
}
fn fire(l: &mut Lobby, id: u32, seq: u32, instance: &str, shell: &str, now: f64) -> Out {
    let scope = l.ammo_scope(id);
    let pos = l.players[&id].last_pos.unwrap().0;
    send(
        l,
        id,
        json!({"t":"fire","seq":seq,"ammo_scope":scope,"instance":instance,"shell":shell,"o":pos,"d":[0,0,1]}),
        now,
    )
}
fn launch(
    l: &mut Lobby,
    id: u32,
    seq: u32,
    instance: &str,
    missile: &str,
    ammo: &str,
    now: f64,
) -> Out {
    let scope = l.ammo_scope(id);
    let pos = l.players[&id].last_pos.unwrap().0;
    send(
        l,
        id,
        json!({"t":"launch","seq":seq,"ammo_scope":scope,"instance":instance,"missile":missile,"ammo":ammo,"o":[pos[0],2.3,pos[2]],"d":[0,0,1]}),
        now,
    )
}
fn capture(l: &mut Lobby, id: u32, room: u32) {
    let point = l.rooms[&room].points[0].clone();
    pose(l, id, 0.0, point.x, point.z);
    l.conquest(CAPTURE_TIME + 0.01);
    assert_eq!(l.rooms[&room].points[0].owner, Some(Team::Blue));
    l.tick_at(0.0);
}
fn supply_tick(l: &mut Lobby, id: u32, now: f64) -> Broadcast {
    let (pos, _) = l.players[&id].last_pos.unwrap();
    pose(l, id, now, pos[0], pos[2]);
    l.tick_at(now)
}
pub(super) fn source_tags() -> Value {
    json!({
        "Cargo.toml":include_str!("../../../Cargo.toml"),
        "config/gameplay-modes.json":include_str!("../../../config/gameplay-modes.json"),
        "crates/gameplay/Cargo.toml":include_str!("../../gameplay/Cargo.toml"),
        "crates/gameplay/src/lib.rs":include_str!("../../gameplay/src/lib.rs"),
        "crates/server/Cargo.toml":include_str!("../Cargo.toml"),
        "crates/server/src/gameplay.rs":include_str!("gameplay.rs"),
        "crates/server/src/gameplay_tests.rs":include_str!("gameplay_tests.rs"),
        "crates/server/src/lobby.rs":include_str!("lobby.rs"),
        "crates/server/src/missiles.rs":include_str!("missiles.rs"),
        "crates/server/src/server.rs":include_str!("server.rs"),
        "crates/server/src/ammo.rs":include_str!("ammo.rs"),
        "crates/server/src/ammo_tests.rs":include_str!("ammo_tests.rs"),
        "config/ammo-resupply.json":include_str!("../../../config/ammo-resupply.json"),
        "config/stabilizer-drives.json":include_str!("../../../config/stabilizer-drives.json"),
        "crates/combat/src/lib.rs":include_str!("../../combat/src/lib.rs"),
        "crates/combat/src/weapon_damage.rs":include_str!("../../combat/src/weapon_damage.rs"),
        "crates/missile/src/world.rs":include_str!("../../missile/src/world.rs"),
        "crates/missile/src/def.rs":include_str!("../../missile/src/def.rs")
        ,"crates/design-wasm/src/lib.rs":include_str!("../../design-wasm/src/lib.rs")
        ,"crates/missile/src/tests.rs":include_str!("../../missile/src/tests.rs")
    })
}

pub(super) fn actual_short_aps_receipts() -> Value {
    let mut scenarios=serde_json::Map::new();
    for vehicle in ["su_t10m","su_t10m_oplot23"] {for mode in ["historical","casual"] {
        let mut l=real_lobby().with_points(HashMap::from([("coast".into(),vec![CapPoint{id:"A".into(),x:0.0,z:0.0,r:45.0}])]));
        let id=connected(&mut l);let mut phases=serde_json::Map::new();
        record(&mut phases,"welcome",send(&mut l,id,json!({"t":"hello","name":"seven","gameplay_rules_version":GAMEPLAY_RULES_VERSION,"ammo_protocol_version":1}),0.0));
        record(&mut phases,"create",send(&mut l,id,json!({"t":"create","name":"seven","map":"coast","max":8,"deploy":true,"gameplay_mode":mode,"gameplay_rules_version":GAMEPLAY_RULES_VERSION}),0.0));
        let room=l.players[&id].room.unwrap();record(&mut phases,"start",send(&mut l,id,json!({"t":"start"}),0.0));
        let catalog=AmmoCatalog::from_target(&l.targets[vehicle],l.mdata.aps.get(vehicle)).unwrap();let mut selected=catalog.validate_mix(None).unwrap();selected.get_mut("gun:1:0").unwrap().fill(0);selected.get_mut("gun:1:0").unwrap()[0]=7;
        record(&mut phases,"deploy",send(&mut l,id,json!({"t":"deploy","vehicle":vehicle,"ammo_mix":selected}),0.0));
        record(&mut phases,"initial_state",send(&mut l,id,json!({"t":"state","s":{"pos":[0,0,0]}}),0.0));capture(&mut l,id,room);
        record(&mut phases,"automatic",broadcast_out(l.tick_at(0.0)));
        record(&mut phases,"disable",send(&mut l,id,json!({"t":"aps","enabled":false}),0.0));
        let shell=catalog.guns["gun:1:0"].ammo[0].clone();let mut shots=Vec::new();
        for seq in 1..=7 {let out=fire(&mut l,id,seq,"gun:1:0",&shell,0.0);assert!(!message(&out,id,"fire_accepted").is_null());shots.extend(out);}
        record(&mut phases,"manual",shots);assert_eq!(l.players[&id].ammo.as_ref().unwrap().counts["gun:1:0"].iter().sum::<u32>(),0);
        record(&mut phases,"empty_state",send(&mut l,id,json!({"t":"state","s":{"pos":[0,0,0],"t":0.001}}),0.0));
        record(&mut phases,"enable_empty",send(&mut l,id,json!({"t":"aps","enabled":true}),0.0));record(&mut phases,"empty_active",broadcast_out(l.tick_at(0.0)));
        for i in 1..=20 {let now=i as f64*0.25;let heading=0.4*i as f64/20.0;let yaw=0.5*i as f64/20.0;
            send(&mut l,id,json!({"t":"state","s":{"pos":[0,0,0],"ex":[heading.cos(),0,-heading.sin()],"ez":[heading.sin(),0,heading.cos()],"tur":[[yaw,0],[yaw,0]],"t":now}}),now);
            let out=l.tick_at(now);if i==20 {record(&mut phases,"grant",broadcast_out(out));}}
        assert_eq!(l.players[&id].ammo.as_ref().unwrap().counts["gun:1:0"],selected["gun:1:0"]);let until=l.players[&id].aps_reload_until.unwrap();
        record(&mut phases,"request_ready",send(&mut l,id,json!({"t":"aps","enabled":true}),5.0));
        let heading: f64=0.4;let scope=l.ammo_scope(id);let held=json!({"pos":[0,0,0],"ex":[heading.cos(),0,-heading.sin()],"ez":[heading.sin(),0,heading.cos()],"tur":[[0.5,0],[0.5,0]],"ammo_scope":scope,"aps_instance":"gun:1:0","t":until-0.01});
        record(&mut phases,"held_state",send(&mut l,id,json!({"t":"state","s":held.clone()}),until-0.01));record(&mut phases,"before_ready",broadcast_out(l.tick_at(until-0.01)));
        assert!(!l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap().enabled);
        record(&mut phases,"ready",broadcast_out(l.tick_at(until)));assert!(l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap().enabled);
        let a=l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap();assert!((a.yaw-0.9).abs()<1e-8&&a.pitch.abs()<1e-8);assert_eq!(a.rounds,7);
        record(&mut phases,"after_ready",broadcast_out(l.tick_at(until+0.05)));
        scenarios.insert(format!("{vehicle}_{mode}"),json!({"vehicle":vehicle,"mode":mode,"owner":id,"selected":selected,"held":held,"ready_at":until,"phases":phases}));
    }}json!(scenarios)
}

#[test]
fn aps_pose_seven_round_refill_requires_a_fresh_readiness_barrier() {
    let scenarios=actual_short_aps_receipts();for s in scenarios.as_object().unwrap().values() {
        assert!(s["phases"]["ready"].as_array().unwrap().iter().any(|entry|entry[0]==s["owner"]&&entry[1]["t"]=="aps_pose"),"actual reload readiness must publish its accepted pose barrier");
    }
}
pub(super) fn broadcast_out(out: Broadcast) -> Out {
    out.into_iter()
        .flat_map(|(to, msg)| to.into_iter().map(move |id| (id, msg.clone())))
        .collect()
}
fn record(phases: &mut serde_json::Map<String, Value>, name: &str, out: Out) {
    phases.insert(name.into(), serde_json::to_value(out).unwrap());
}

#[test]
fn ammo_resupply_discharge_wire_requires_nested_scope() {
    let scope = AmmoScope { battle: 7, life: 2 };
    for mut request in [
        json!({"t":"fire","seq":41,"shell":"ap","o":[0,0,0],"d":[0,0,1]}),
        json!({"t":"mg_fire","seq":42,"gun":"mg34","o":[0,0,0],"d":[0,0,1]}),
        json!({"t":"launch","seq":43,"missile":"tow","ammo":"heat","o":[0,0,0],"d":[0,0,1]}),
    ] {
        request["battle"] = json!(7);
        request["life"] = json!(2);
        assert!(
            serde_json::from_value::<ClientMsg>(request.clone()).is_err(),
            "flat discharge scope is not authorized"
        );
        request.as_object_mut().unwrap().remove("battle");
        request.as_object_mut().unwrap().remove("life");
        request["ammo_scope"] = json!(scope);
        assert!(serde_json::from_value::<ClientMsg>(request).is_ok());
    }
    for reply in [
        ServerMsg::FireAccepted { seq: 41, scope },
        ServerMsg::FireRejected {
            seq: 42,
            scope,
            reason: "no_ammo".into(),
        },
        ServerMsg::LaunchRejected {
            seq: 43,
            scope,
            reason: "no_ammo".into(),
            retry_after_s: 0.0,
        },
        ServerMsg::Launched {
            from: 1,
            seq: 44,
            scope,
            id: 1,
            missile: "tow".into(),
            o: [0.0; 3],
            d: [0.0, 0.0, 1.0],
            audio_version: 1,
            instance: "gun:0:0".into(),
            weapon: "m220_tow".into(),
            at: 0.0,
        },
    ] {
        let value = serde_json::to_value(reply).unwrap();
        assert_eq!(value["ammo_scope"], json!(scope));
        assert!(value.get("battle").is_none() && value.get("life").is_none());
    }
}

/// The world really acquires and fires at a source TOW, then manual fire drains its
/// remaining mounted stock. No fabricated snapshot stands in for an interception.
fn actual_oplot(mode: &str, vehicle: &str) -> Value {
    let mut l = real_lobby().with_points(HashMap::from([(
        "range".into(),
        vec![CapPoint {
            id: "A".into(),
            x: 0.0,
            z: 0.0,
            r: 45.0,
        }],
    )]));
    let id = connected(&mut l);
    let enemy = connected(&mut l);
    let mut phases = serde_json::Map::new();
    record(
        &mut phases,
        "welcome",
        send(
            &mut l,
            id,
            json!({"t":"hello","name":"owner","gameplay_rules_version":GAMEPLAY_RULES_VERSION,"ammo_protocol_version":1}),
            0.0,
        ),
    );
    record(
        &mut phases,
        "create",
        send(
            &mut l,
            id,
            json!({"t":"create","name":"oplot","map":"range","max":8,"deploy":true,"gameplay_mode":mode,"gameplay_rules_version":GAMEPLAY_RULES_VERSION}),
            0.0,
        ),
    );
    let room = l.players[&id].room.unwrap();
    record(
        &mut phases,
        "join",
        send(&mut l, enemy, json!({"t":"join","room":room}), 0.0),
    );
    record(
        &mut phases,
        "start",
        send(&mut l, id, json!({"t":"start"}), 0.0),
    );
    let catalog = AmmoCatalog::from_target(&l.targets[vehicle], l.mdata.aps.get(vehicle)).unwrap();
    let mut selected = catalog.validate_mix(None).unwrap();
    let values = selected.get_mut("gun:1:0").unwrap();
    values.fill(0);
    values[0] = 100;
    values[1] = 30;
    record(
        &mut phases,
        "deploy",
        send(
            &mut l,
            id,
            json!({"t":"deploy","vehicle":vehicle,"ammo_mix":selected}),
            0.0,
        ),
    );
    let token = l.players[&id].token.clone();
    l.drop_link(id, 0.0);
    let replacement = connected(&mut l);
    let(seat,out)=l.dispatch_socket(replacement,serde_json::from_value(json!({"t":"hello","name":"resume","resume":token,"gameplay_rules_version":GAMEPLAY_RULES_VERSION,"ammo_protocol_version":1})).unwrap(),0.0);
    assert_eq!(seat, id);
    record(&mut phases, "deploy_resume", out);
    record(
        &mut phases,
        "state",
        send(&mut l, id, json!({"t":"state","s":{"pos":[0,0,0]}}), 0.0),
    );
    record(
        &mut phases,
        "enemy_deploy",
        send(
            &mut l,
            enemy,
            json!({"t":"deploy","vehicle":"us_m901_itv","ammo_mix":{"gun:0:0":[2]}}),
            0.0,
        ),
    );
    pose(&mut l, enemy, 0.0, 0.0, 600.0);
    record(
        &mut phases,
        "conquest",
        broadcast_out(l.conquest(CAPTURE_TIME + 0.01)),
    );
    l.tick_at(0.0);
    record(
        &mut phases,
        "manual_off",
        send(&mut l, id, json!({"t":"aps","enabled":false}), 0.0),
    );
    let shell = catalog.guns["gun:1:0"].ammo[0].clone();
    let main = l.players[&id].rounds;
    record(
        &mut phases,
        "manual",
        fire(&mut l, id, 41, "gun:1:0", &shell, 0.0),
    );
    assert_eq!(l.players[&id].rounds, main);
    l.tick_at(0.0);
    record(
        &mut phases,
        "automatic_on",
        send(&mut l, id, json!({"t":"aps","enabled":true}), 0.0),
    );
    let scope = l.ammo_scope(enemy);
    let launched = send(
        &mut l,
        enemy,
        json!({"t":"launch","seq":1,"ammo_scope":scope,"instance":"gun:0:0","missile":"bgm71a_tow","ammo":"heat_152_tow","o":[0,2.3,600],"d":[0,0,-1]}),
        0.0,
    );
    let mid = message(&launched, enemy, "launched")["id"]
        .as_u64()
        .unwrap() as u32;
    record(&mut phases, "hostile_launch", launched);
    let mut now = 0.0;
    let mut actual = false;
    for i in 1..=90 {
        now = i as f64 * 0.05;
        send(
            &mut l,
            enemy,
            json!({"t":"guide","id":mid,"sight":[0,2.3,600],"aim":[0,1.4,0]}),
            now,
        );
        if i % 5 == 0 {
            pose(&mut l, id, now, 0.0, 0.0);
            pose(&mut l, enemy, now, 0.0, 600.0);
        }
        let out = l.tick_at(now);
        actual = out
            .iter()
            .any(|(_, m)| matches!(m,ServerMsg::Snap{fired,..} if !fired.is_empty()));
        if actual {
            record(&mut phases, "automatic", broadcast_out(out));
            break;
        }
    }
    assert!(
        actual,
        "{vehicle}/{mode}: real Lobby missile step must fire APS"
    );
    let after = l.players[&id]
        .ammo
        .as_ref()
        .unwrap()
        .aps_rounds(&catalog)
        .unwrap();
    assert!(after < 129 && after > 0);
    assert_eq!(
        l.rooms[&room]
            .world
            .as_ref()
            .unwrap()
            .aps_of(id)
            .unwrap()
            .rounds,
        after
    );
    send(&mut l, enemy, json!({"t":"missile_end","id":mid}), now);
    record(
        &mut phases,
        "automatic_off",
        send(&mut l, id, json!({"t":"aps","enabled":false}), now),
    );
    let heat = l.rooms[&room]
        .world
        .as_ref()
        .unwrap()
        .aps_of(id)
        .unwrap()
        .heat;
    assert!(heat > 0.0);
    let mut seq = 42;
    let mut manual = Vec::new();
    for (index, ammo) in catalog.guns["gun:1:0"].ammo.iter().enumerate() {
        let count = l.players[&id].ammo.as_ref().unwrap().counts["gun:1:0"][index];
        for _ in 0..count {
            manual.extend(fire(&mut l, id, seq, "gun:1:0", ammo, now));
            seq += 1;
        }
    }
    record(&mut phases, "manual_empty", manual);
    assert_eq!(l.players[&id].rounds, main);
    assert_eq!(
        l.rooms[&room]
            .world
            .as_ref()
            .unwrap()
            .aps_of(id)
            .unwrap()
            .rounds,
        0
    );
    assert_eq!(
        l.rooms[&room]
            .world
            .as_ref()
            .unwrap()
            .aps_of(id)
            .unwrap()
            .heat,
        heat,
        "manual debit preserves actual automatic heat"
    );
    assert!(l.players[&id].aps_reload_until.is_none());
    // Qualification began on the first trusted tick following the first manual deficit.
    let since = l.players[&id].supply_since.unwrap();
    let grant = since + 5.0;
    let mut t = now + 0.25;
    while t < grant - 0.25 {
        supply_tick(&mut l, id, t);
        t += 0.25;
    }
    record(
        &mut phases,
        "at_4_75",
        broadcast_out(supply_tick(&mut l, id, grant - 0.25)),
    );
    record(
        &mut phases,
        "at_5",
        broadcast_out(supply_tick(&mut l, id, grant)),
    );
    assert_eq!(
        l.rooms[&room]
            .world
            .as_ref()
            .unwrap()
            .aps_of(id)
            .unwrap()
            .rounds,
        130
    );
    let until = l.players[&id].aps_reload_until.unwrap();
    assert!((until - (grant + 30.0 / l.rooms[&room].gameplay.rules().fire)).abs() < 1e-8);
    record(
        &mut phases,
        "enable_during_reload",
        send(&mut l, id, json!({"t":"aps","enabled":true}), grant),
    );
    record(
        &mut phases,
        "reload_reject",
        fire(&mut l, id, seq, "gun:1:0", &shell, grant),
    );
    assert!(
        !l.rooms[&room]
            .world
            .as_ref()
            .unwrap()
            .aps_of(id)
            .unwrap()
            .enabled
    );
    let incoming = hostile_launch(&mut l, enemy, 2, grant);
    record(&mut phases, "reload_hostile_launch", incoming.1);
    let (during, shots) = hostile_steps(&mut l, id, enemy, incoming.0, grant, 70, false);
    assert!(
        !shots,
        "{vehicle}/{mode}: replenished stock cannot fire during the belt cycle"
    );
    record(&mut phases, "reload_hostile", during);
    let protected = l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap();
    assert_eq!(protected.rounds, 130);
    assert!(
        protected.tracks.is_empty(),
        "disabled automatic control discards tracks"
    );
    send(
        &mut l,
        enemy,
        json!({"t":"missile_end","id":incoming.0}),
        grant + 3.5,
    );
    record(
        &mut phases,
        "before_ready",
        broadcast_out(l.tick_at(until - 0.01)),
    );
    assert!(
        !l.rooms[&room]
            .world
            .as_ref()
            .unwrap()
            .aps_of(id)
            .unwrap()
            .enabled
    );
    pose(&mut l,id,until,0.0,0.0);
    record(&mut phases, "ready", broadcast_out(l.tick_at(until)));
    assert!(
        l.rooms[&room]
            .world
            .as_ref()
            .unwrap()
            .aps_of(id)
            .unwrap()
            .enabled
    );
    // A new enemy life supplies a fresh real missile without inventing launcher stock.
    send(&mut l, enemy, json!({"t":"respawn"}), until);
    send(
        &mut l,
        enemy,
        json!({"t":"deploy","vehicle":"us_m901_itv","ammo_mix":{"gun:0:0":[2]}}),
        until + 5.0,
    );
    pose(&mut l, enemy, until + 5.0, 0.0, 600.0);
    pose(&mut l, id, until + 5.0, 0.0, 0.0);
    let incoming = hostile_launch(&mut l, enemy, 3, until + 5.0);
    record(&mut phases, "recovery_hostile_launch", incoming.1);
    let (recovered, shots) = hostile_steps(&mut l, id, enemy, incoming.0, until + 5.0, 90, true);
    assert!(
        shots,
        "{vehicle}/{mode}: ready automatic protection must reacquire and fire"
    );
    let protected = l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap();
    assert!(protected.rounds < 130);
    assert!(protected.spin > 0.0);
    assert!(protected.tracks.iter().any(|t| t.firm));
    record(&mut phases, "recovered", recovered);
    json!({"owner":id,"enemy":enemy,"vehicle":vehicle,"mode":mode,"selected":selected,"phases":phases})
}
fn hostile_launch(l: &mut Lobby, enemy: u32, seq: u32, now: f64) -> (u32, Out) {
    pose(l, enemy, now, 0.0, 600.0);
    let scope = l.ammo_scope(enemy);
    let out = send(
        l,
        enemy,
        json!({"t":"launch","seq":seq,"ammo_scope":scope,"instance":"gun:0:0","missile":"bgm71a_tow","ammo":"heat_152_tow","o":[0,2.3,600],"d":[0,0,-1]}),
        now,
    );
    let mid = message(&out, enemy, "launched")["id"]
        .as_u64()
        .unwrap_or_else(|| panic!("actual hostile launch refused: {:?}", out)) as u32;
    (mid, out)
}
fn hostile_steps(
    l: &mut Lobby,
    id: u32,
    enemy: u32,
    mid: u32,
    start: f64,
    steps: u32,
    stop_on_fire: bool,
) -> (Out, bool) {
    let mut packets = Vec::new();
    let mut fired = false;
    for step in 1..=steps {
        let now = start + step as f64 * 0.05;
        send(
            l,
            enemy,
            json!({"t":"guide","id":mid,"sight":[0,2.3,600],"aim":[0,1.4,0]}),
            now,
        );
        if step % 5 == 0 {
            pose(l, id, now, 0.0, 0.0);
            pose(l, enemy, now, 0.0, 600.0);
        }
        let out = l.tick_at(now);
        let shot = out.iter().any(
            |(_, m)| matches!(m,ServerMsg::Snap{fired,..}if fired.iter().any(|f|f["aps"]==id)),
        );
        fired |= shot;
        packets.extend(broadcast_out(out));
        if stop_on_fire && shot {
            break;
        }
    }
    (packets, fired)
}
#[test]
fn ammo_resupply_oplot_manual_auto_share_one_pool_and_preserve_heat() {
    for vehicle in ["su_t10m", "su_t10m_oplot23"] {
        for mode in ["historical", "casual"] {
            actual_oplot(mode, vehicle);
        }
    }
}

fn actual_bmpt(mode: &str) -> Value {
    let mut l = real_lobby().with_points(HashMap::from([(
        "coast".into(),
        vec![CapPoint {
            id: "A".into(),
            x: 0.0,
            z: 0.0,
            r: 45.0,
        }],
    )]));
    let id = connected(&mut l);
    let enemy = connected(&mut l);
    let mut phases = serde_json::Map::new();
    record(
        &mut phases,
        "welcome",
        send(
            &mut l,
            id,
            json!({"t":"hello","name":"owner","gameplay_rules_version":GAMEPLAY_RULES_VERSION,"ammo_protocol_version":1}),
            0.0,
        ),
    );
    record(
        &mut phases,
        "create",
        send(
            &mut l,
            id,
            json!({"t":"create","name":"bmpt","map":"coast","max":8,"deploy":true,"gameplay_mode":mode,"gameplay_rules_version":GAMEPLAY_RULES_VERSION}),
            0.0,
        ),
    );
    let room = l.players[&id].room.unwrap();
    record(
        &mut phases,
        "join",
        send(&mut l, enemy, json!({"t":"join","room":room}), 0.0),
    );
    record(
        &mut phases,
        "start",
        send(&mut l, id, json!({"t":"start"}), 0.0),
    );
    record(
        &mut phases,
        "malformed",
        send(
            &mut l,
            id,
            json!({"t":"deploy","vehicle":"su_bmpt34","ammo_mix":{}}),
            0.0,
        ),
    );
    assert!(l.players[&id].vehicle.is_empty());
    let selected = json!({"gun:0:0":[7,0],"gun:0:1":[0,5],"gun:0:2":[1],"gun:0:3":[0]});
    record(
        &mut phases,
        "deploy",
        send(
            &mut l,
            id,
            json!({"t":"deploy","vehicle":"su_bmpt34","spawn":1,"ammo_mix":selected}),
            0.0,
        ),
    );
    let token = l.players[&id].token.clone();
    l.drop_link(id, 0.0);
    let replacement = connected(&mut l);
    let(seat,out)=l.dispatch_socket(replacement,serde_json::from_value(json!({"t":"hello","name":"resume","resume":token,"gameplay_rules_version":GAMEPLAY_RULES_VERSION,"ammo_protocol_version":1})).unwrap(),0.0);
    assert_eq!(seat, id);
    record(&mut phases, "deploy_resume", out);
    record(
        &mut phases,
        "state",
        send(&mut l, id, json!({"t":"state","s":{"pos":[0,0,0]}}), 0.0),
    );
    record(
        &mut phases,
        "conquest",
        broadcast_out(l.conquest(CAPTURE_TIME + 0.01)),
    );
    l.tick_at(0.0);
    record(
        &mut phases,
        "cannon",
        fire(&mut l, id, 41, "gun:0:0", "apt_25_br132p", 0.0),
    );
    record(
        &mut phases,
        "empty_rail",
        launch(
            &mut l,
            id,
            42,
            "gun:0:3",
            "tt250_rocket",
            "he_420_tt250",
            0.0,
        ),
    );
    record(
        &mut phases,
        "rail",
        launch(
            &mut l,
            id,
            43,
            "gun:0:2",
            "tt250_rocket",
            "he_420_tt250",
            0.0,
        ),
    );
    record(
        &mut phases,
        "rail_retry",
        launch(
            &mut l,
            id,
            43,
            "gun:0:2",
            "tt250_rocket",
            "he_420_tt250",
            0.0,
        ),
    );
    record(
        &mut phases,
        "unchanged_reject",
        fire(&mut l, id, 44, "gun:0:0", "foreign", 0.0),
    );
    record(
        &mut phases,
        "lower",
        fire(&mut l, id, 40, "gun:0:0", "apt_25_br132p", 0.0),
    );
    l.tick_at(0.0);
    for i in 1..=18 {
        supply_tick(&mut l, id, i as f64 * 0.25);
    }
    record(
        &mut phases,
        "at_4_75",
        broadcast_out(supply_tick(&mut l, id, 4.75)),
    );
    record(
        &mut phases,
        "at_5",
        broadcast_out(supply_tick(&mut l, id, 5.0)),
    );
    let token = l.players[&id].token.clone();
    record(&mut phases, "drop", l.drop_link(id, 5.2));
    let replacement = connected(&mut l);
    let msg=serde_json::from_value(json!({"t":"hello","name":"resume","resume":token,"gameplay_rules_version":GAMEPLAY_RULES_VERSION,"ammo_protocol_version":1})).unwrap();
    let (seat, out) = l.dispatch_socket(replacement, msg, 5.3);
    assert_eq!(seat, id);
    record(&mut phases, "resume", out);
    pose(&mut l, id, 5.35, 0.0, 0.0);
    record(
        &mut phases,
        "secondary_cannon",
        fire(&mut l, id, 46, "gun:0:1", "hefi_25_ozr132", 5.35),
    );
    assert_eq!(
        l.players[&id].ammo.as_ref().unwrap().counts["gun:0:1"],
        [0, 4]
    );
    let old = l.ammo_scope(id);
    record(
        &mut phases,
        "scuttle",
        send(&mut l, id, json!({"t":"respawn"}), 5.4),
    );
    let token = l.players[&id].token.clone();
    l.drop_link(id, 5.4);
    let replacement = connected(&mut l);
    let(seat,out)=l.dispatch_socket(replacement,serde_json::from_value(json!({"t":"hello","name":"resume","resume":token,"gameplay_rules_version":GAMEPLAY_RULES_VERSION,"ammo_protocol_version":1})).unwrap(),5.4);
    assert_eq!(seat, id);
    record(&mut phases, "dead_resume", out);
    record(
        &mut phases,
        "new_life",
        send(
            &mut l,
            id,
            json!({"t":"deploy","vehicle":"su_bmpt34","spawn":2,"ammo_mix":selected}),
            10.4,
        ),
    );
    pose(&mut l, id, 10.4, 0.0, 0.0);
    let token = l.players[&id].token.clone();
    l.drop_link(id, 10.4);
    let replacement = connected(&mut l);
    let(seat,out)=l.dispatch_socket(replacement,serde_json::from_value(json!({"t":"hello","name":"resume","resume":token,"gameplay_rules_version":GAMEPLAY_RULES_VERSION,"ammo_protocol_version":1})).unwrap(),10.4);
    assert_eq!(seat, id);
    record(&mut phases, "new_life_resume", out);
    pose(&mut l, id, 10.4, 0.0, 0.0);
    record(
        &mut phases,
        "old_scope",
        send(
            &mut l,
            id,
            json!({"t":"fire","ammo_scope":old,"seq":99,"instance":"gun:0:0","shell":"apt_25_br132p","o":[0,0,0],"d":[0,0,1]}),
            10.5,
        ),
    );
    fire(&mut l, id, 100, "gun:0:0", "apt_25_br132p", 10.5);
    supply_tick(&mut l, id, 10.5);
    record(
        &mut phases,
        "enemy_deploy",
        send(
            &mut l,
            enemy,
            json!({"t":"deploy","vehicle":"su_t34_85"}),
            10.6,
        ),
    );
    pose(&mut l, enemy, 10.6, 0.0, 0.0);
    record(
        &mut phases,
        "contested",
        broadcast_out(supply_tick(&mut l, id, 10.75)),
    );
    assert_eq!(l.players[&id].supply_progress, 0.0);
    // These are the actual accepted-State seams that can interrupt dwell between ticks.
    // Keep the same battle/life as the preceding scenario so browser replay can adopt them.
    pose(&mut l, enemy, 13.0, 45.1, 0.0);
    pose(&mut l, id, 13.0, 44.9, 0.0);
    l.tick_at(13.0);
    for step in 1..=19 {
        let now = 13.0 + step as f64 * 0.25;
        pose(&mut l, enemy, now, 45.1, 0.0);
        let out = supply_tick(&mut l, id, now);
        if step == 19 {
            record(&mut phases, "owner_before_exit", broadcast_out(out));
        }
    }
    record(
        &mut phases,
        "owner_exit",
        send(
            &mut l,
            id,
            json!({"t":"state","s":{"pos":[45.1,0,0]}}),
            17.751,
        ),
    );
    record(
        &mut phases,
        "owner_reentry",
        send(
            &mut l,
            id,
            json!({"t":"state","s":{"pos":[44.9,0,0]}}),
            17.752,
        ),
    );
    record(
        &mut phases,
        "owner_after_reentry",
        broadcast_out(supply_tick(&mut l, id, 18.0)),
    );
    assert_eq!(l.players[&id].rounds, Some(12));
    for step in 1..=18 {
        let now = 18.0 + step as f64 * 0.25;
        pose(&mut l, enemy, now, 45.1, 0.0);
        supply_tick(&mut l, id, now);
    }
    record(
        &mut phases,
        "enemy_before_entry",
        broadcast_out(supply_tick(&mut l, id, 22.502)),
    );
    record(
        &mut phases,
        "enemy_entry",
        send(
            &mut l,
            enemy,
            json!({"t":"state","s":{"pos":[44.9,0,0]}}),
            22.503,
        ),
    );
    record(
        &mut phases,
        "enemy_exit",
        send(
            &mut l,
            enemy,
            json!({"t":"state","s":{"pos":[45.1,0,0]}}),
            22.504,
        ),
    );
    record(
        &mut phases,
        "enemy_after_exit",
        broadcast_out(supply_tick(&mut l, id, 22.75)),
    );
    for step in 1..=14 {
        supply_tick(&mut l, id, 22.75 + step as f64 * 0.25);
    }
    supply_tick(&mut l, id, 26.254);
    record(
        &mut phases,
        "stale_before_refresh",
        broadcast_out(l.tick_at(27.254)),
    );
    record(
        &mut phases,
        "stale_refresh",
        send(
            &mut l,
            id,
            json!({"t":"state","s":{"pos":[44.9,0,0]}}),
            27.504,
        ),
    );
    record(
        &mut phases,
        "stale_after_refresh",
        broadcast_out(supply_tick(&mut l, id, 27.75)),
    );
    for phase in ["owner_exit", "enemy_entry", "stale_refresh"] {
        assert!(
            phases[phase]
                .as_array()
                .unwrap()
                .iter()
                .any(|e| e[0] == id && e[1]["t"] == "ammo" && e[1]["resupply_progress"] == 0.0),
            "{phase}: genuine reset must be serialized"
        );
    }
    assert_eq!(
        l.players[&id].ammo.as_ref().unwrap().counts["gun:0:0"],
        [6, 0]
    );
    let engine = l.targets["su_bmpt34"]
        .def
        .modules
        .iter()
        .position(|m| m.kind == tg_combat::ModuleKind::Engine)
        .unwrap();
    let state = l.players.get_mut(&id).unwrap().combat.as_mut().unwrap();
    state.modules[engine] *= 0.5;
    state.crew[0] = 83.0;
    state.fire_s = 2.0;
    record(
        &mut phases,
        "damage_before_refill",
        send(&mut l, id, json!({"t":"repair"}), 28.0),
    );
    let preserved = serde_json::to_value(l.players[&id].combat.as_ref().unwrap()).unwrap();
    assert!(preserved["repair_s"].as_f64().unwrap() > 0.0);
    for step in 1..=18 {
        supply_tick(&mut l, id, 27.75 + step as f64 * 0.25);
    }
    record(
        &mut phases,
        "damage_refill",
        broadcast_out(supply_tick(&mut l, id, 32.504)),
    );
    let status = phases["damage_refill"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e[0] == id && e[1]["t"] == "status")
        .unwrap();
    for field in ["modules", "crew", "roles", "fire_s", "repair_s"] {
        assert_eq!(status[1]["state"][field], preserved[field]);
    }
    assert_eq!(
        l.players[&id].ammo.as_ref().unwrap().counts["gun:0:0"],
        [7, 0]
    );
    for (name, values) in &phases {
        for entry in values.as_array().unwrap() {
            if entry[1]["t"] == "ammo" {
                assert_eq!(
                    entry[0],
                    if name == "enemy_deploy" {
                        json!(enemy)
                    } else {
                        json!(id)
                    }
                );
            }
        }
    }
    json!({"owner":id,"enemy":enemy,"vehicle":"su_bmpt34","mode":mode,"selected":selected,"phases":phases,"dead_recovery":actual_dead_recovery(mode)})
}
#[test]
fn browser_ammo_resupply_receipt_from_actual_handlers() {
    let mut scenarios = serde_json::Map::new();
    for mode in ["historical", "casual"] {
        scenarios.insert(format!("bmpt_{mode}"), actual_bmpt(mode));
        for vehicle in ["su_t10m", "su_t10m_oplot23"] {
            scenarios.insert(format!("{vehicle}_{mode}"), actual_oplot(mode, vehicle));
        }
    }
    if let Ok(path) = std::env::var("TG_AMMO_RESUPPLY_RECEIPT") {
        std::fs::write(
            path,
            serde_json::to_vec(
                &json!({"ammo_protocol_version":1,"sources":source_tags(),"scenarios":scenarios,"aps_handoffs":super::gameplay_tests::actual_aps_handoffs(),"aps_readiness":super::gameplay_tests::actual_aps_readiness(),"aps_short":actual_short_aps_receipts(),"aps_gyro":super::gameplay_tests::actual_aps_gyro(),"aps_suspensions":super::gameplay_tests::actual_aps_suspensions(),"aps_quantization":super::gameplay_tests::actual_aps_quantization()}),
            )
            .unwrap(),
        )
        .unwrap();
    }
}
fn actual_dead_recovery(mode: &str) -> Value {
    let mut l = real_lobby();
    let id = connected(&mut l);
    let mut phases = serde_json::Map::new();
    record(
        &mut phases,
        "create",
        send(
            &mut l,
            id,
            json!({"t":"create","name":"dead recovery","map":"coast","max":8,"deploy":true,"gameplay_mode":mode,"gameplay_rules_version":GAMEPLAY_RULES_VERSION}),
            0.0,
        ),
    );
    record(
        &mut phases,
        "start",
        send(&mut l, id, json!({"t":"start"}), 0.0),
    );
    let selected = json!({"gun:0:0":[7,0],"gun:0:1":[0,5],"gun:0:2":[1],"gun:0:3":[0]});
    record(
        &mut phases,
        "first_life",
        send(
            &mut l,
            id,
            json!({"t":"deploy","vehicle":"su_bmpt34","spawn":1,"ammo_mix":selected}),
            0.0,
        ),
    );
    send(&mut l, id, json!({"t":"respawn"}), 0.0);
    record(
        &mut phases,
        "missed_life",
        send(
            &mut l,
            id,
            json!({"t":"deploy","vehicle":"su_bmpt34","spawn":2,"ammo_mix":selected}),
            5.0,
        ),
    );
    record(
        &mut phases,
        "death",
        send(&mut l, id, json!({"t":"respawn"}), 5.1),
    );
    let token = l.players[&id].token.clone();
    l.drop_link(id, 5.2);
    let replacement = connected(&mut l);
    let(seat,out)=l.dispatch_socket(replacement,serde_json::from_value(json!({"t":"hello","name":"resume","resume":token,"gameplay_rules_version":GAMEPLAY_RULES_VERSION,"ammo_protocol_version":1})).unwrap(),5.3);
    assert_eq!(seat, id);
    record(&mut phases, "resume", out);
    assert_eq!(l.players[&id].life, 2);
    assert!(!l.players[&id].alive);
    json!({"owner":id,"phases":phases})
}

#[test]
fn ammo_review_rack_mutations_emit_owner_scoped_authoritative_status() {
    for mode in ["historical", "casual"] {
        let scenario = actual_bmpt(mode);
        let owner = scenario["owner"].as_u64().unwrap();
        for phase in ["deploy", "cannon", "rail", "at_5", "resume", "new_life"] {
            let entries = scenario["phases"][phase].as_array().unwrap();
            let status = entries
                .iter()
                .find(|e| e[0] == owner && e[1]["t"] == "status")
                .unwrap_or_else(|| panic!("{mode}/{phase}: missing authoritative rack Status"));
            assert!(status[1]["ammo_scope"]["life"].as_u64().unwrap() > 0);
            if phase == "resume" {
                assert!(status[1].get("ammo_revision").is_none());
            } else {
                assert!(status[1]["ammo_revision"].as_u64().unwrap() > 0);
            }
            assert!(status[1]["state"]["rack_fill"].is_array());
            assert!(status[1]["caps"].is_object());
            assert!(entries
                .iter()
                .filter(|e| e[1]["t"] == "status" && e[1].get("ammo_scope").is_some())
                .all(|e| e[0] == owner));
        }
        for vehicle in ["su_t10m", "su_t10m_oplot23"] {
            let scenario = actual_oplot(mode, vehicle);
            for phase in ["manual", "automatic", "at_5", "recovered"] {
                assert!(
                    scenario["phases"][phase]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|e| e[0] == scenario["owner"] && e[1]["t"] == "status"),
                    "{vehicle}/{mode}/{phase}"
                );
            }
        }
    }
}
#[test]
fn ammo_review_aps_snapshots_keep_rounds_private_for_every_recipient() {
    for mode in ["historical", "casual"] {
        for vehicle in ["su_t10m", "su_t10m_oplot23"] {
            let scenario = actual_oplot(mode, vehicle);
            let owner = scenario["owner"].as_u64().unwrap();
            for entries in scenario["phases"].as_object().unwrap().values() {
                for entry in entries.as_array().unwrap() {
                    if entry[1]["t"] == "ammo" {
                        let expected = if entry[1]["counts"].get("gun:1:0").is_some() {
                            json!(owner)
                        } else {
                            scenario["enemy"].clone()
                        };
                        assert_eq!(entry[0], expected);
                    }
                    if entry[1]["t"] == "status" && entry[1].get("ammo_scope").is_some() {
                        assert_eq!(entry[0], entry[1]["id"]);
                    }
                    for aps in entry[1]["aps"].as_array().into_iter().flatten() {
                        if entry[0] == aps["owner"] {
                            assert!(aps["rounds"].as_u64().is_some());
                        } else {
                            assert!(
                                aps.get("rounds").is_none(),
                                "enemy absolute stock leaked: {entry}"
                            );
                        }
                        for field in ["yaw", "pitch", "heat", "spin"] {
                            assert!(aps[field].is_number());
                        }
                    }
                }
            }
        }
    }
}
#[test]
fn ammo_review_receipt_contains_real_transient_and_stale_interruption_phases() {
    for mode in ["historical", "casual"] {
        let scenario = actual_bmpt(mode);
        for phase in [
            "owner_before_exit",
            "owner_exit",
            "owner_reentry",
            "owner_after_reentry",
            "enemy_before_entry",
            "enemy_entry",
            "enemy_exit",
            "enemy_after_exit",
            "stale_before_refresh",
            "stale_refresh",
            "stale_after_refresh",
        ] {
            assert!(
                scenario["phases"].get(phase).is_some(),
                "missing actual-handler {phase}"
            );
        }
    }
}
#[test]
fn ammo_review_refill_status_changes_only_racks_preserving_damage_and_timers() {
    let mut l = real_lobby();
    let (id, room, _) = sortie(
        &mut l,
        "su_bmpt34",
        json!({"gun:0:0":[7,0],"gun:0:1":[0,5],"gun:0:2":[1],"gun:0:3":[0]}),
    );
    capture(&mut l, id, room);
    fire(&mut l, id, 41, "gun:0:0", "apt_25_br132p", 0.0);
    l.tick_at(0.0);
    for step in 1..=19 {
        supply_tick(&mut l, id, step as f64 * 0.25);
    }
    let engine = l.targets["su_bmpt34"]
        .def
        .modules
        .iter()
        .position(|m| m.kind == tg_combat::ModuleKind::Engine)
        .unwrap();
    let p = l.players.get_mut(&id).unwrap();
    let state = p.combat.as_mut().unwrap();
    state.modules[engine] *= 0.5;
    state.crew[0] = 83.0;
    state.fire_s = 2.0;
    state.repair_s = 3.0;
    let before = serde_json::to_value(&state).unwrap();
    let out = broadcast_out(supply_tick(&mut l, id, 5.0));
    let status = message(&out, id, "status");
    assert!(!status.is_null());
    assert_ne!(status["state"]["rack_fill"], before["rack_fill"]);
    let mut after = status["state"].clone();
    let mut before = before;
    after.as_object_mut().unwrap().remove("rack_fill");
    before.as_object_mut().unwrap().remove("rack_fill");
    assert_eq!(after, before);
    assert_eq!(
        status["state"],
        serde_json::to_value(l.players[&id].combat.as_ref().unwrap()).unwrap()
    );
    assert_eq!(
        status["ammo_revision"],
        message(&out, id, "ammo")["revision"]
    );
    assert_eq!(
        status["caps"],
        serde_json::to_value(tg_combat::caps(
            &l.targets["su_bmpt34"],
            l.players[&id].combat.as_ref().unwrap()
        ))
        .unwrap()
    );
    assert!(out
        .iter()
        .filter(|(_, m)| matches!(
            m,
            ServerMsg::Status {
                ammo_scope: Some(_),
                ..
            }
        ))
        .all(|(to, _)| *to == id));
}
#[test]
fn ammo_review_resume_start_retains_each_accepted_spawn_and_dead_life() {
    let s = actual_bmpt("historical");
    let find = |phase: &str, kind: &str| {
        s["phases"][phase]
            .as_array()
            .unwrap()
            .iter()
            .find(|e| e[0] == s["owner"] && e[1]["t"] == kind)
            .unwrap()[1]
            .clone()
    };
    assert_eq!(
        find("deploy_resume", "start")["spawn"],
        find("deploy", "respawned")["spawn"]
    );
    assert_eq!(find("deploy_resume", "start")["spawn"], 1);
    assert_eq!(
        find("new_life_resume", "start")["spawn"],
        find("new_life", "respawned")["spawn"]
    );
    assert_eq!(find("new_life_resume", "start")["spawn"], 2);
    let dead = find("dead_resume", "start");
    assert_eq!(
        dead["members"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["id"] == s["owner"])
            .unwrap()["alive"],
        false
    );
}
#[test]
fn ammo_review_dead_resume_combat_snapshot_is_not_a_rack_revision() {
    let s = actual_bmpt("historical");
    let status = s["phases"]["dead_resume"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e[0] == s["owner"] && e[1]["t"] == "status")
        .unwrap();
    assert_eq!(status[1]["ammo_scope"]["life"], 1);
    assert_eq!(status[1]["state"]["destroyed"], true);
    assert!(
        status[1].get("ammo_revision").is_none(),
        "a resumed combat snapshot is scoped but is not versioned by ammunition mutations"
    );
}
#[test]
fn ammo_resupply_five_seconds_is_one_grant_and_overlap_does_not_double() {
    let mut l = real_lobby();
    let (id, room, _) = sortie(&mut l, "su_t34_85", json!({"gun:0:0":[20,0,0]}));
    // Two authored point fixtures share a circle; conquest still owns the actual transfer.
    let point = l.rooms[&room].points[0].clone();
    l.rooms.get_mut(&room).unwrap().points.push(PointState {
        id: "overlap".into(),
        owner: None,
        progress: 0.0,
        blue: 0,
        red: 0,
        ..point
    });
    capture(&mut l, id, room);
    fire(&mut l, id, 41, "gun:0:0", "aphe_85_br365", 0.0);
    l.tick_at(0.0);
    for i in 1..=19 {
        let out = supply_tick(&mut l, id, i as f64 * 0.25);
        assert!(out
            .iter()
            .all(|(to, m)| !matches!(m, ServerMsg::Ammo { .. }) || to == &vec![id]));
    }
    assert_eq!(l.players[&id].rounds, Some(19));
    assert_eq!(l.players[&id].supply_progress, 0.95);
    let out = supply_tick(&mut l, id, 5.0);
    assert_eq!(l.players[&id].rounds, Some(20));
    assert_eq!(
        out.iter()
            .filter(|(_, m)| matches!(m,ServerMsg::Ammo{inventory} if inventory.refilled))
            .count(),
        1
    );
    assert_eq!(l.players[&id].supply_progress, 0.0);
    assert!(supply_tick(&mut l, id, 5.25)
        .iter()
        .all(|(_, m)| !matches!(m,ServerMsg::Ammo{inventory} if inventory.refilled)));
}

#[test]
fn ammo_resupply_accepted_pose_interruptions_between_ticks_restart_continuous_dwell() {
    for case in ["owner_excursion", "enemy_excursion", "stale_pose_refresh"] {
        let mut l = real_lobby().with_points(HashMap::from([(
            "coast".into(),
            vec![CapPoint {
                id: "A".into(),
                x: 0.0,
                z: 0.0,
                r: 45.0,
            }],
        )]));
        let (id, room, _) = sortie(&mut l, "su_t34_85", json!({"gun:0:0":[20,0,0]}));
        pose(&mut l, id, 0.0, 44.9, 0.0);
        l.conquest(CAPTURE_TIME + 0.01);
        assert_eq!(l.rooms[&room].points[0].owner, Some(Team::Blue));
        fire(&mut l, id, 41, "gun:0:0", "aphe_85_br365", 0.0);
        l.tick_at(0.0);
        for step in 1..=15 {
            supply_tick(&mut l, id, step as f64 * 0.25);
        }
        if case != "stale_pose_refresh" {
            for step in 16..=19 {
                supply_tick(&mut l, id, step as f64 * 0.25);
            }
        } else {
            l.tick_at(4.75);
        }
        assert_eq!(l.players[&id].supply_progress, 0.95);
        match case {
            "owner_excursion" => {
                pose(&mut l, id, 4.751, 45.1, 0.0);
                assert_eq!(l.players[&id].last_pos.unwrap().0[0], 45.1);
                pose(&mut l, id, 4.752, 44.9, 0.0);
            }
            "enemy_excursion" => {
                let enemy = connected(&mut l);
                send(&mut l, enemy, json!({"t":"join","room":room}), 4.75);
                send(
                    &mut l,
                    enemy,
                    json!({"t":"deploy","vehicle":"su_t34_85"}),
                    4.75,
                );
                pose(&mut l, enemy, 4.75, 45.1, 0.0);
                pose(&mut l, enemy, 4.751, 44.9, 0.0);
                pose(&mut l, enemy, 4.752, 45.1, 0.0);
            }
            "stale_pose_refresh" => {
                pose(&mut l, id, 5.0, 44.9, 0.0);
            }
            _ => unreachable!(),
        }
        let out = supply_tick(&mut l, id, 5.0);
        assert_eq!(
            l.players[&id].rounds,
            Some(19),
            "{case}: an accepted loss of qualification restarts five seconds"
        );
        assert!(l.players[&id].supply_progress < 0.1, "{case}");
        assert!(
            out.iter()
                .all(|(_, m)| !matches!(m,ServerMsg::Ammo{inventory}if inventory.refilled)),
            "{case}"
        );
    }
}
#[test]
fn ammo_resupply_rejects_enemy_contested_stale_away_dead_and_finished() {
    for case in ["enemy", "contested", "stale", "away", "dead", "finished"] {
        let mut l = real_lobby();
        let (id, room, _) = sortie(&mut l, "su_t34_85", json!({"gun:0:0":[20,0,0]}));
        capture(&mut l, id, room);
        fire(&mut l, id, 41, "gun:0:0", "aphe_85_br365", 0.0);
        l.tick_at(0.0);
        supply_tick(&mut l, id, 2.0);
        let mut observed = 3.1;
        match case {
            "enemy" | "contested" => {
                let other = connected(&mut l);
                send(&mut l, other, json!({"t":"join","room":room}), 2.0);
                send(
                    &mut l,
                    other,
                    json!({"t":"deploy","vehicle":"su_t34_85"}),
                    2.0,
                );
                let (pos, _) = l.players[&id].last_pos.unwrap();
                pose(&mut l, other, 3.1, pos[0], pos[2]);
                if case == "enemy" {
                    let outside = pos[0] + l.rooms[&room].points[0].r + 1.0;
                    pose(&mut l, id, 21.0, outside, pos[2]);
                    l.conquest(2.0 * CAPTURE_TIME + 0.01);
                    assert_eq!(l.rooms[&room].points[0].owner, Some(Team::Red));
                    pose(&mut l, other, 40.1, outside, pos[2]);
                    observed = 40.1;
                }
                pose(&mut l, id, observed, pos[0], pos[2]);
            }
            "stale" => {}
            "away" => {
                l.drop_link(id, 2.0);
            }
            "dead" => {
                send(&mut l, id, json!({"t":"respawn"}), 2.0);
            }
            "finished" => {
                send(&mut l, id, json!({"t":"end"}), 2.0);
            }
            _ => unreachable!(),
        }
        let out = l.tick_at(observed);
        assert!(
            out.iter()
                .all(|(_, m)| !matches!(m,ServerMsg::Ammo{inventory} if inventory.refilled)),
            "{case}"
        );
        if l.players[&id].ammo.is_some() {
            assert_eq!(
                l.players[&id].ammo.as_ref().unwrap().counts["gun:0:0"],
                [19, 0, 0]
            );
            assert_eq!(l.players[&id].supply_progress, 0.0, "{case}");
        }
    }
}
#[test]
fn ammo_resupply_bmpt_rails_spend_and_refill_independently() {
    let mut l = real_lobby();
    let (id, room, _) = sortie(
        &mut l,
        "su_bmpt34",
        json!({"gun:0:0":[7,0],"gun:0:1":[0,5],"gun:0:2":[1],"gun:0:3":[0]}),
    );
    capture(&mut l, id, room);
    let warhead = l
        .mdata
        .defs
        .iter()
        .find(|d| d.id == "tt250_rocket")
        .unwrap()
        .warhead
        .clone();
    let rejected = launch(&mut l, id, 41, "gun:0:3", "tt250_rocket", &warhead, 0.0);
    assert_eq!(
        message(&rejected, id, "launch_rejected")["reason"],
        "no_ammo"
    );
    let accepted = launch(&mut l, id, 42, "gun:0:2", "tt250_rocket", &warhead, 0.0);
    assert!(!message(&accepted, id, "launched").is_null());
    let before = l.players[&id].ammo.clone();
    let retry = launch(&mut l, id, 42, "gun:0:2", "tt250_rocket", &warhead, 0.1);
    assert!(!message(&retry, id, "launched").is_null());
    assert_eq!(l.players[&id].ammo, before);
    fire(&mut l, id, 43, "gun:0:0", "apt_25_br132p", 0.1);
    l.tick_at(0.1);
    for i in 1..=20 {
        supply_tick(&mut l, id, 0.1 + i as f64 * 0.25);
    }
    let ledger = l.players[&id].ammo.as_ref().unwrap();
    assert_eq!(ledger.counts["gun:0:2"], [1]);
    assert_eq!(ledger.counts["gun:0:3"], [0]);
    assert_eq!(ledger.counts["gun:0:0"], [7, 0]);
    assert_eq!(l.players[&id].missiles_left["tt250_rocket"], 1);
    let mut l = real_lobby();
    let (id, _, _) = sortie(&mut l, "us_m901_itv", json!({"gun:0:0":[1]}));
    assert!(!message(
        &launch(&mut l, id, 1, "gun:0:0", "bgm71a_tow", "heat_152_tow", 0.0),
        id,
        "launched"
    )
    .is_null());
    assert_eq!(
        message(
            &launch(&mut l, id, 2, "gun:0:0", "bgm71a_tow", "heat_152_tow", 1.0),
            id,
            "launch_rejected"
        )["reason"],
        "no_ammo"
    );
}
#[test]
fn ammo_resupply_empty_oplot_waits_for_trusted_source_belt_cycle() {
    for vehicle in ["su_t10m", "su_t10m_oplot23"] {
        for mode in ["historical", "casual"] {
            let mut l = real_lobby();
            let catalog =
                AmmoCatalog::from_target(&l.targets[vehicle], l.mdata.aps.get(vehicle)).unwrap();
            let mut selected = catalog.validate_mix(None).unwrap();
            selected.get_mut("gun:1:0").unwrap().fill(0);
            selected.get_mut("gun:1:0").unwrap()[0] = 1;
            let id = connected(&mut l);
            send(
                &mut l,
                id,
                json!({"t":"create","name":"aps","map":"coast","max":8,"deploy":true,"gameplay_mode":mode,"gameplay_rules_version":GAMEPLAY_RULES_VERSION}),
                0.0,
            );
            let room = l.players[&id].room.unwrap();
            send(&mut l, id, json!({"t":"start"}), 0.0);
            send(
                &mut l,
                id,
                json!({"t":"deploy","vehicle":vehicle,"ammo_mix":selected}),
                0.0,
            );
            capture(&mut l, id, room);
            send(&mut l, id, json!({"t":"aps","enabled":false}), 0.0);
            let shell = catalog.guns["gun:1:0"].ammo[0].clone();
            assert!(!message(
                &fire(&mut l, id, 41, "gun:1:0", &shell, 0.0),
                id,
                "fire_accepted"
            )
            .is_null());
            assert!(l.players[&id].aps_reload_until.is_none());
            send(&mut l, id, json!({"t":"aps","enabled":true}), 0.0);
            l.tick_at(0.0);
            for i in 1..=20 {
                supply_tick(&mut l, id, i as f64 * 0.25);
            }
            let seconds = 30.0 / l.rooms[&room].gameplay.rules().fire;
            assert_eq!(l.players[&id].aps_reload_until, Some(5.0 + seconds));
            assert!(
                !l.rooms[&room]
                    .world
                    .as_ref()
                    .unwrap()
                    .aps_of(id)
                    .unwrap()
                    .enabled
            );
            send(&mut l, id, json!({"t":"aps","enabled":true}), 5.1);
            assert_eq!(
                message(
                    &fire(&mut l, id, 42, "gun:1:0", &shell, 5.1),
                    id,
                    "fire_rejected"
                )["reason"],
                "reloading"
            );
            l.tick_at(5.0 + seconds - 0.01);
            assert!(
                !l.rooms[&room]
                    .world
                    .as_ref()
                    .unwrap()
                    .aps_of(id)
                    .unwrap()
                    .enabled
            );
            pose(&mut l,id,5.0+seconds,0.0,0.0);
            l.tick_at(5.0 + seconds);
            assert!(
                l.rooms[&room]
                    .world
                    .as_ref()
                    .unwrap()
                    .aps_of(id)
                    .unwrap()
                    .enabled
            );
            assert!(l.players[&id].aps_reload_until.is_none());
        }
    }
}
#[test]
fn ammo_resupply_oplot_reload_preserves_off_intent_and_damage_adjusts_remaining_work() {
    for vehicle in ["su_t10m", "su_t10m_oplot23"] {
        for mode in ["historical", "casual"] {
            let mut l = real_lobby();
            let catalog =
                AmmoCatalog::from_target(&l.targets[vehicle], l.mdata.aps.get(vehicle)).unwrap();
            let mut selected = catalog.validate_mix(None).unwrap();
            selected.get_mut("gun:1:0").unwrap().fill(0);
            selected.get_mut("gun:1:0").unwrap()[0] = 1;
            let id = connected(&mut l);
            send(
                &mut l,
                id,
                json!({"t":"create","name":"aps","map":"coast","max":8,"deploy":true,"gameplay_mode":mode,"gameplay_rules_version":GAMEPLAY_RULES_VERSION}),
                0.0,
            );
            let room = l.players[&id].room.unwrap();
            send(&mut l, id, json!({"t":"start"}), 0.0);
            send(
                &mut l,
                id,
                json!({"t":"deploy","vehicle":vehicle,"ammo_mix":selected}),
                0.0,
            );
            capture(&mut l, id, room);
            send(&mut l, id, json!({"t":"aps","enabled":false}), 0.0);
            fire(
                &mut l,
                id,
                41,
                "gun:1:0",
                &catalog.guns["gun:1:0"].ammo[0],
                0.0,
            );
            l.tick_at(0.0);
            for i in 1..=20 {
                supply_tick(&mut l, id, i as f64 * 0.25);
            }
            let initial = 30.0 / l.rooms[&room].gameplay.rules().fire;
            l.tick_at(6.0);
            let remaining = initial - 1.0;
            assert!((l.players[&id].aps_reload_remaining - remaining).abs() < 1e-8);
            let loader = l.targets[vehicle]
                .def
                .crew
                .iter()
                .position(|c| c.role == tg_combat::CrewRole::Loader)
                .unwrap();
            l.players
                .get_mut(&id)
                .unwrap()
                .combat
                .as_mut()
                .unwrap()
                .crew[loader] = 0.0;
            let multiplier =
                tg_combat::caps(&l.targets[vehicle], l.players[&id].combat.as_ref().unwrap())
                    .weapons["gun:1:0"]
                    .reload_mult as f64;
            assert!(multiplier > 1.0);
            l.tick_at(6.0);
            assert!(
                (l.players[&id].aps_reload_until.unwrap() - (6.0 + remaining * multiplier)).abs()
                    < 1e-8
            );
            l.tick_at(7.0);
            let left = remaining - 1.0 / multiplier;
            assert!((l.players[&id].aps_reload_remaining - left).abs() < 1e-8);
            l.players
                .get_mut(&id)
                .unwrap()
                .combat
                .as_mut()
                .unwrap()
                .crew[loader] = 100.0;
            l.tick_at(7.0);
            let until = 7.0 + left;
            assert!((l.players[&id].aps_reload_until.unwrap() - until).abs() < 1e-8);
            l.tick_at(until);
            assert!(l.players[&id].aps_reload_until.is_none());
            assert_eq!(l.players[&id].aps_desired_enabled, false);
            assert!(
                !l.rooms[&room]
                    .world
                    .as_ref()
                    .unwrap()
                    .aps_of(id)
                    .unwrap()
                    .enabled,
                "reload completion preserves explicit off intent"
            );
            pose(&mut l,id,until,0.0,0.0);
            send(&mut l, id, json!({"t":"aps","enabled":true}), until);
            assert!(
                l.rooms[&room]
                    .world
                    .as_ref()
                    .unwrap()
                    .aps_of(id)
                    .unwrap()
                    .enabled
            );
        }
    }
}
#[test]
fn ammo_resupply_resume_keeps_scope_counts_targets_and_proofs() {
    let mut l = real_lobby();
    let (id, room, _) = sortie(&mut l, "su_t34_85", json!({"gun:0:0":[20,0,0]}));
    capture(&mut l, id, room);
    fire(&mut l, id, 41, "gun:0:0", "aphe_85_br365", 0.0);
    l.tick_at(0.0);
    supply_tick(&mut l, id, 2.0);
    let ledger = l.players[&id].ammo.clone().unwrap();
    let proof = l.players[&id].fired[0].seq;
    let token = l.players[&id].token.clone();
    l.drop_link(id, 2.0);
    let replacement = connected(&mut l);
    let msg=serde_json::from_value(json!({"t":"hello","name":"resume","resume":token,"gameplay_rules_version":GAMEPLAY_RULES_VERSION,"ammo_protocol_version":1})).unwrap();
    let (seat, out) = l.dispatch_socket(replacement, msg, 2.1);
    assert_eq!(seat, id);
    let p = &l.players[&id];
    assert_eq!(p.ammo.as_ref().unwrap().scope, ledger.scope);
    assert_eq!(p.ammo.as_ref().unwrap().counts, ledger.counts);
    assert_eq!(p.ammo.as_ref().unwrap().targets, ledger.targets);
    assert_eq!(p.fired[0].seq, proof);
    assert_eq!(p.supply_progress, 0.0);
    assert_eq!(
        message(&out, id, "start")["ammo"]["life"],
        ledger.scope.life
    );
}
#[test]
fn ammo_resupply_invalid_resume_capability_leaves_held_seat_atomic() {
    let mut l = real_lobby();
    let (id, room, _) = sortie(&mut l, "su_t34_85", json!({"gun:0:0":[20,0,0]}));
    fire(&mut l, id, 41, "gun:0:0", "aphe_85_br365", 0.0);
    l.drop_link(id, 0.1);
    let token = l.players[&id].token.clone();
    let ledger = l.players[&id].ammo.clone();
    let members = l.rooms[&room].members.clone();
    for cap in [
        None,
        Some(Value::Null),
        Some(json!("1")),
        Some(json!(0)),
        Some(json!(2)),
        Some(json!(1.5)),
        Some(json!([1])),
    ] {
        let (replacement, _) = l.connect();
        let mut request =
            json!({"t":"hello","name":"replacement","resume":token,"gameplay_rules_version":GAMEPLAY_RULES_VERSION});
        if let Some(cap) = cap {
            request["ammo_protocol_version"] = cap;
        }
        let (seat, out) =
            l.dispatch_socket(replacement, serde_json::from_value(request).unwrap(), 0.2);
        assert_eq!(seat, replacement);
        assert!(!message(&out, replacement, "error").is_null());
        assert!(message(&out, replacement, "welcome").is_null());
        assert_eq!(l.players[&id].token, token);
        assert_eq!(l.players[&id].away, Some(0.1));
        assert_eq!(l.players[&id].ammo, ledger);
        assert_eq!(l.rooms[&room].members, members);
    }
}
#[test]
fn ammo_resupply_old_scope_and_wrong_capability_cannot_mutate_new_life() {
    let mut l = real_lobby();
    let (id, _, _) = sortie(&mut l, "su_t34_85", json!({"gun:0:0":[20,0,0]}));
    let old = l.ammo_scope(id);
    send(&mut l, id, json!({"t":"respawn"}), 0.0);
    send(
        &mut l,
        id,
        json!({"t":"deploy","vehicle":"su_t34_85","ammo_mix":{"gun:0:0":[20,0,0]}}),
        5.0,
    );
    pose(&mut l, id, 5.0, 0.0, 0.0);
    let before = l.players[&id].ammo.clone();
    let stale = send(
        &mut l,
        id,
        json!({"t":"fire","ammo_scope":old,"seq":99,"instance":"gun:0:0","shell":"aphe_85_br365","o":[0,0,0],"d":[0,0,1]}),
        5.1,
    );
    assert_eq!(
        message(&stale, id, "fire_rejected")["reason"],
        "stale_scope"
    );
    assert_eq!(l.players[&id].ammo, before);
    send(
        &mut l,
        id,
        json!({"t":"hello","name":"old","gameplay_rules_version":GAMEPLAY_RULES_VERSION,"ammo_protocol_version":0}),
        5.2,
    );
    let out = fire(&mut l, id, 100, "gun:0:0", "aphe_85_br365", 5.2);
    assert_eq!(
        message(&out, id, "fire_rejected")["reason"],
        "update_needed"
    );
    assert_eq!(l.players[&id].ammo, before);
}
#[test]
fn ammo_resupply_validates_selected_mix_atomically() {
    let mut l = real_lobby();
    let id = connected(&mut l);
    send(
        &mut l,
        id,
        json!({"t":"create","name":"ammo","map":"coast","max":8,"deploy":true,"gameplay_mode":"historical","gameplay_rules_version":GAMEPLAY_RULES_VERSION}),
        0.0,
    );
    send(&mut l, id, json!({"t":"start"}), 0.0);
    for bad in [
        json!({}),
        json!({"gun:0:0":[20]}),
        json!({"gun:0:0":[61,0,0]}),
        json!({"gun:0:0":[20,0,0],"gun:9:0":[0]}),
    ] {
        let out = send(
            &mut l,
            id,
            json!({"t":"deploy","vehicle":"su_t34_85","ammo_mix":bad}),
            0.0,
        );
        assert!(
            !message(&out, id, "error").is_null(),
            "malformed selected mix must be refused before deployment"
        );
        assert!(l.players[&id].vehicle.is_empty());
        assert!(!l.players[&id].alive);
        assert!(l.players[&id].combat.is_none());
    }
    let out = send(
        &mut l,
        id,
        json!({"t":"deploy","vehicle":"su_t34_85","ammo_mix":{"gun:0:0":[20,0,0]}}),
        0.0,
    );
    assert_eq!(
        message(&out, id, "ammo")["counts"]["gun:0:0"],
        json!([20, 0, 0])
    );
}
#[test]
fn ammo_resupply_explicit_null_mix_cannot_default() {
    for t in ["vehicle", "deploy"] {
        let value = if t == "vehicle" {
            json!({"t":t,"id":"su_t34_85","ammo_mix":null})
        } else {
            json!({"t":t,"vehicle":"su_t34_85","ammo_mix":null})
        };
        assert!(
            serde_json::from_value::<ClientMsg>(value).is_err(),
            "present null is not an omitted selected plan"
        );
    }
}
#[test]
fn ammo_resupply_wire_mix_rejects_duplicate_keys_and_malformed_numbers() {
    for t in ["vehicle", "deploy"] {
        let identity = if t == "vehicle" { "id" } else { "vehicle" };
        let duplicate = format!(
            r#"{{"t":"{t}","{identity}":"su_t34_85","ammo_mix":{{"gun:0:0":[20,0,0],"gun:0:0":[1,0,0]}}}}"#
        );
        assert!(
            serde_json::from_str::<ClientMsg>(&duplicate).is_err(),
            "each mounted gun must appear exactly once"
        );
        for bad in [
            json!(-1),
            json!(1.5),
            json!("1"),
            json!(4294967296u64),
            Value::Null,
            json!(true),
        ] {
            let request = json!({"t":t,identity:"su_t34_85","ammo_mix":{"gun:0:0":[bad,0,0]}});
            assert!(
                serde_json::from_value::<ClientMsg>(request).is_err(),
                "malformed number cannot reach lifecycle mutation"
            );
        }
    }
}
#[test]
fn ammo_resupply_join_active_non_deploy_validates_choice_before_seat_mutation() {
    let mut l = real_lobby();
    let host = connected(&mut l);
    send(
        &mut l,
        host,
        json!({"t":"create","name":"battle","map":"coast","max":8,"gameplay_mode":"historical","gameplay_rules_version":GAMEPLAY_RULES_VERSION}),
        0.0,
    );
    send(
        &mut l,
        host,
        json!({"t":"vehicle","id":"su_t34_85","ammo_mix":{"gun:0:0":[20,0,0]}}),
        0.0,
    );
    let room = l.players[&host].room.unwrap();
    send(&mut l, host, json!({"t":"start"}), 0.0);
    let id = connected(&mut l);
    let out = send(&mut l, id, json!({"t":"join","room":room}), 0.1);
    assert!(!message(&out, id, "error").is_null());
    assert_eq!(l.players[&id].room, None);
    assert!(!l.rooms[&room].members.contains(&id));
    assert!(l.players[&id].ammo.is_none());
    send(
        &mut l,
        id,
        json!({"t":"vehicle","id":"su_t34_85","ammo_mix":{"gun:0:0":[7,0,0]}}),
        0.1,
    );
    l.players.get_mut(&id).unwrap().life = MAX_SAFE_COUNTER;
    let out = send(&mut l, id, json!({"t":"join","room":room}), 0.2);
    assert!(!message(&out, id, "error").is_null());
    assert_eq!(l.players[&id].room, None);
    assert!(!l.rooms[&room].members.contains(&id));
    l.players.get_mut(&id).unwrap().life = 0;
    let out = send(&mut l, id, json!({"t":"join","room":room}), 0.3);
    assert_eq!(
        message(&out, id, "ammo")["counts"]["gun:0:0"],
        json!([7, 0, 0])
    );
}
#[test]
fn ammo_resupply_revision_exhaustion_blocks_world_spend_and_progress_mutation() {
    let mut l = real_lobby();
    let id = connected(&mut l);
    let enemy = connected(&mut l);
    send(
        &mut l,
        id,
        json!({"t":"create","name":"exhausted","map":"range","max":8,"deploy":true,"gameplay_mode":"historical","gameplay_rules_version":GAMEPLAY_RULES_VERSION}),
        0.0,
    );
    let room = l.players[&id].room.unwrap();
    send(&mut l, enemy, json!({"t":"join","room":room}), 0.0);
    send(&mut l, id, json!({"t":"start"}), 0.0);
    send(
        &mut l,
        id,
        json!({"t":"deploy","vehicle":"su_t10m_oplot23"}),
        0.0,
    );
    pose(&mut l, id, 0.0, 0.0, 0.0);
    send(
        &mut l,
        enemy,
        json!({"t":"deploy","vehicle":"us_m901_itv"}),
        0.0,
    );
    let p = l.players.get_mut(&id).unwrap();
    p.ammo.as_mut().unwrap().revision = MAX_SAFE_COUNTER;
    p.supply_progress = 0.5;
    p.supply_since = Some(0.0);
    l.reset_supply(id);
    assert_eq!(
        l.players[&id].supply_progress, 0.5,
        "unversioned progress mutation is refused"
    );
    assert!(l.players[&id].supply_since.is_none());
    let before = l.players[&id].ammo.clone();
    let incoming = hostile_launch(&mut l, enemy, 1, 0.0);
    send(&mut l, id, json!({"t":"aps","enabled":true}), 0.0);
    let (_, fired) = hostile_steps(&mut l, id, enemy, incoming.0, 0.0, 70, false);
    assert!(!fired);
    assert_eq!(l.players[&id].ammo, before);
    assert!(
        !l.rooms[&room]
            .world
            .as_ref()
            .unwrap()
            .aps_of(id)
            .unwrap()
            .enabled
    );
}
#[test]
fn ammo_resupply_trusted_timer_preserves_existing_missile_and_capture_steps() {
    let mut l = real_lobby().with_points(HashMap::from([(
        "range".into(),
        vec![CapPoint {
            id: "A".into(),
            x: 0.0,
            z: 0.0,
            r: 45.0,
        }],
    )]));
    let id = connected(&mut l);
    send(
        &mut l,
        id,
        json!({"t":"create","name":"clock","map":"range","max":8,"deploy":true,"gameplay_mode":"historical","gameplay_rules_version":GAMEPLAY_RULES_VERSION}),
        0.0,
    );
    let room = l.players[&id].room.unwrap();
    send(&mut l, id, json!({"t":"start"}), 0.0);
    send(
        &mut l,
        id,
        json!({"t":"deploy","vehicle":"us_m901_itv"}),
        0.0,
    );
    pose(&mut l, id, 0.0, 0.0, 0.0);
    let out = launch(&mut l, id, 41, "gun:0:0", "bgm71a_tow", "heat_152_tow", 0.0);
    let mid = message(&out, id, "launched")["id"].as_u64().unwrap() as u32;
    l.tick_at(10.0);
    assert_eq!(
        l.rooms[&room].points[0].progress, 0.0,
        "trusted ammunition time must not change the existing four-Hz conquest update"
    );
    let missile = l.rooms[&room]
        .world
        .as_ref()
        .unwrap()
        .missile(mid)
        .expect("one existing missile simulation step");
    assert!(missile.pos[2] < 30.0);
    for i in 1..=4 {
        l.tick_at(10.0 + i as f64 * 0.05);
    }
    assert_eq!(
        l.rooms[&room].points[0].progress,
        CONQUEST_DT / CAPTURE_TIME
    );
}
#[test]
fn ammo_resupply_revisions_cover_accept_reject_and_retired_sequences() {
    let mut l = real_lobby();
    let (id, _, out) = sortie(&mut l, "su_t34_85", json!({"gun:0:0":[20,0,0]}));
    assert_eq!(message(&out, id, "ammo")["revision"], 1);
    let fire = |seq, shell| json!({"t":"fire","seq":seq,"ammo_scope":{"battle":1,"life":1},"instance":"gun:0:0","shell":shell,"o":[0,0,0],"d":[0,0,1]});
    let accepted = send(&mut l, id, fire(41, "aphe_85_br365"), 1.0);
    assert_eq!(message(&accepted, id, "ammo")["processed_through"], 41);
    let revision = message(&accepted, id, "ammo")["revision"].clone();
    let retry = send(&mut l, id, fire(41, "aphe_85_br365"), 1.1);
    assert_eq!(message(&retry, id, "ammo")["revision"], revision);
    let rejected = send(&mut l, id, fire(45, "foreign"), 1.2);
    assert_eq!(message(&rejected, id, "ammo")["processed_through"], 45);
    let before = l.players[&id].rounds;
    let lower = send(&mut l, id, fire(44, "aphe_85_br365"), 1.3);
    assert_eq!(
        message(&lower, id, "fire_rejected")["reason"],
        "stale_sequence"
    );
    assert_eq!(l.players[&id].rounds, before);
}
#[test]
fn ammo_resupply_outcome_eviction_and_expiry_never_reopen_covered_sequences() {
    let mut l = real_lobby();
    let (id, room, _) = sortie(&mut l, "su_t34_85", json!({"gun:0:0":[20,0,0]}));
    fire(&mut l, id, 41, "gun:0:0", "aphe_85_br365", 0.0);
    let capacity = l.rooms[&room].gameplay.sequence_capacity();
    for seq in 42..42 + capacity as u32 {
        fire(&mut l, id, seq, "gun:0:0", "foreign", 0.1);
    }
    assert!(l.players[&id].discharge_receipts.len() <= capacity);
    assert!(!l.players[&id].discharge_receipts.contains_key(&41));
    let before = l.players[&id].ammo.clone();
    let retry = fire(&mut l, id, 41, "gun:0:0", "aphe_85_br365", 0.2);
    assert_eq!(
        message(&retry, id, "fire_rejected")["reason"],
        "stale_sequence"
    );
    assert_eq!(l.players[&id].ammo, before);
    let last = 41 + capacity as u32;
    let known = fire(&mut l, id, last, "gun:0:0", "foreign", 0.2);
    assert_eq!(
        message(&known, id, "fire_rejected")["reason"],
        "unknown_ammo"
    );
    assert_eq!(l.players[&id].ammo, before);
    let expired = fire(
        &mut l,
        id,
        last,
        "gun:0:0",
        "foreign",
        LAUNCH_RECEIPT_LIFE + 1.0,
    );
    assert_eq!(
        message(&expired, id, "fire_rejected")["reason"],
        "stale_sequence"
    );
    assert_eq!(l.players[&id].ammo, before);
    fire(
        &mut l,
        id,
        last + 1,
        "gun:0:0",
        "foreign",
        LAUNCH_RECEIPT_LIFE + 1.0,
    );
    assert_eq!(l.players[&id].discharge_receipts.len(), 1);
    assert_eq!(l.players[&id].rounds, Some(19));
}

#[test]
fn ammo_resupply_catalog_validates_real_selected_vectors_and_capacity() {
    let (data, missiles) = loaded();
    for (id, target) in &data.targets {
        let catalog = AmmoCatalog::from_target(target, missiles.aps.get(id)).unwrap();
        let defaults = catalog.validate_mix(None).unwrap();
        assert_eq!(
            catalog.validate_mix(Some(&defaults)).unwrap(),
            defaults,
            "{id}"
        );
    }
    let catalog = AmmoCatalog::from_target(&data.targets["su_bmpt34"], None).unwrap();
    let selected = mix(json!({"gun:0:0":[840,0],"gun:0:1":[0,7],"gun:0:2":[1],"gun:0:3":[0]}));
    assert_eq!(catalog.validate_mix(Some(&selected)).unwrap(), selected);
    for bad in [
        json!({}),
        json!({"gun:0:0":[840,1],"gun:0:1":[0,7],"gun:0:2":[1],"gun:0:3":[0]}),
        json!({"gun:0:0":[1],"gun:0:1":[0,7],"gun:0:2":[1],"gun:0:3":[0]}),
        json!({"gun:0:0":[1,0],"gun:0:1":[0,7],"gun:0:2":[1],"gun:0:3":[0],"gun:9:0":[0]}),
    ] {
        assert!(catalog.validate_mix(Some(&mix(bad))).is_err());
    }
    for bad in [
        json!({"gun:0:0":[-1]}),
        json!({"gun:0:0":[1.5]}),
        json!({"gun:0:0":["1"]}),
        json!({"gun:0:0":[4294967296u64]}),
    ] {
        assert!(serde_json::from_value::<AmmoMix>(bad).is_err());
    }
}

#[test]
fn ammo_resupply_ledger_spends_independent_bmpt_rails_and_keeps_zero_selection() {
    let (data, _) = loaded();
    let catalog = AmmoCatalog::from_target(&data.targets["su_bmpt34"], None).unwrap();
    let plan = mix(json!({"gun:0:0":[7,0],"gun:0:1":[0,5],"gun:0:2":[1],"gun:0:3":[0]}));
    let mut ledger = AmmoLedger::new(AmmoScope::new(7, 2).unwrap(), &catalog, Some(&plan)).unwrap();
    let shell = &catalog.guns["gun:0:2"].ammo[0];
    assert!(ledger.spend(&catalog, "gun:0:3", shell).is_err());
    assert_eq!(ledger.counts, plan);
    ledger.spend(&catalog, "gun:0:2", shell).unwrap();
    assert_eq!(ledger.counts["gun:0:2"], [0]);
    assert!(ledger.spend(&catalog, "gun:0:2", shell).is_err());
    assert!(ledger.missing());
    assert!(ledger.refill().unwrap());
    assert_eq!(ledger.counts, plan);
    assert!(!ledger.refill().unwrap());
    assert_eq!(ledger.counts["gun:0:3"], [0]);
}

#[test]
fn ammo_resupply_ledger_aps_declared_order_manual_pool_and_atomic_overconsume() {
    let (data, missiles) = loaded();
    for id in ["su_t10m", "su_t10m_oplot23"] {
        let catalog = AmmoCatalog::from_target(&data.targets[id], missiles.aps.get(id)).unwrap();
        assert!(catalog.guns["gun:1:0"].aps);
        assert!(!catalog.guns["gun:0:0"].aps);
        let mut ledger = AmmoLedger::new(AmmoScope::new(1, 1).unwrap(), &catalog, None).unwrap();
        let source = ledger.counts["gun:1:0"].clone();
        let main = ledger.counts["gun:0:0"].clone();
        ledger
            .spend(&catalog, "gun:1:0", &catalog.guns["gun:1:0"].ammo[1])
            .unwrap();
        ledger.consume_aps(&catalog, source[0] + 2).unwrap();
        let mut expected = source.clone();
        expected[0] = 0;
        expected[1] -= 3;
        assert_eq!(ledger.counts["gun:1:0"], expected);
        assert_eq!(ledger.counts["gun:0:0"], main);
        let before = ledger.clone();
        assert!(ledger.consume_aps(&catalog, u32::MAX).is_err());
        assert_eq!(ledger, before);
        ledger.refill().unwrap();
        assert_eq!(ledger.counts["gun:1:0"], source);
    }
}

#[test]
fn ammo_resupply_ledger_terminal_highwater_and_safe_revision_exhaustion() {
    let (data, _) = loaded();
    let catalog = AmmoCatalog::from_target(&data.targets["us_m901_itv"], None).unwrap();
    let mut ledger = AmmoLedger::new(AmmoScope::new(7, 2).unwrap(), &catalog, None).unwrap();
    assert_eq!(ledger.revision, 1);
    ledger.terminal(41).unwrap();
    assert_eq!(ledger.revision, 2);
    assert_eq!(ledger.processed_through, 41);
    let before = ledger.clone();
    assert!(ledger.terminal(40).is_err());
    assert_eq!(ledger, before);
    ledger.revision = MAX_SAFE_COUNTER;
    let before = ledger.clone();
    assert!(ledger.terminal(42).is_err());
    assert_eq!(ledger, before);
    assert!(AmmoScope::new(MAX_SAFE_COUNTER + 1, 1).is_err());
    assert!(AmmoScope::new(1, 0).is_err());
}

#[test]
fn ammo_resupply_catalog_explicit_zero_and_unknown_legacy_remain_distinct() {
    let (data, _) = loaded();
    let mut target = data.targets["su_t34_85"].clone();
    target.def.weapons["main_gun"]["ammo_count"] = json!([0, 0, 0]);
    target.def.ammo_capacity = 0;
    let catalog = AmmoCatalog::from_target(&target, None).unwrap();
    assert_eq!(catalog.guns["gun:0:0"].capacity, Some(0));
    assert_eq!(catalog.validate_mix(None).unwrap()["gun:0:0"], [0, 0, 0]);
    target.def.weapons["main_gun"]
        .as_object_mut()
        .unwrap()
        .remove("ammo_count");
    let catalog = AmmoCatalog::from_target(&target, None).unwrap();
    assert_eq!(catalog.guns["gun:0:0"].capacity, None);
    assert!(catalog.validate_mix(None).unwrap().is_empty());
    assert!(catalog
        .validate_mix(Some(&mix(json!({"gun:0:0":[1,0,0]}))))
        .is_err());
    let mut ledger = AmmoLedger::new(AmmoScope::new(1, 1).unwrap(), &catalog, None).unwrap();
    ledger
        .spend(&catalog, "gun:0:0", &catalog.guns["gun:0:0"].ammo[0])
        .unwrap();
    assert!(!ledger.missing());
}
