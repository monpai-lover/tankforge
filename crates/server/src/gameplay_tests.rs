use super::*;
use serde_json::json;

fn send(l: &mut Lobby, id: u32, mut value: Value, now: f64) -> Out {
    if value["t"] == "hello" { value["ammo_protocol_version"] = json!(1); }
    if matches!(value["t"].as_str(), Some("fire"|"launch"|"mg_fire")) {
        let scope=l.ammo_scope(id); value["ammo_scope"]=json!(scope);
        if value["t"]=="launch" {value["ammo"]=json!(l.mdata.defs.iter().find(|def|Some(def.id.as_str())==value["missile"].as_str()).map(|def|def.warhead.clone()).unwrap_or_default());}
    }
    l.handle(id, serde_json::from_value(value).unwrap(), now)
}
fn connected(l: &mut Lobby, capability: Value) -> u32 {
    let (id, _) = l.connect();
    send(l, id, json!({"t":"hello","name":"player","gameplay_rules_version":capability}), 0.0);
    id
}
fn create(l: &mut Lobby, id: u32, mode: &str) -> Out {
    send(l, id, json!({"t":"create","name":"rules","map":"range","max":8,"deploy":true,"gameplay_mode":mode,"gameplay_rules_version":1}), 0.0)
}
fn message(out: &Out, id: u32, kind: &str) -> Value {
    out.iter().filter(|(to,_)| *to == id).map(|(_,m)| serde_json::to_value(m).unwrap()).find(|m| m["t"] == kind).unwrap_or(Value::Null)
}
fn profile(v: &Value, mode: &str) {
    assert_eq!(v["gameplay_mode"], mode);
    assert_eq!(v["gameplay_rules_version"], 1);
}
fn real_lobby() -> Lobby {
    let data = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let c = crate::server::load_combat(&data);
    Lobby::new(HashMap::new(), HashSet::new(), vec!["range".into()])
        .with_combat(c.targets,c.projectiles,c.bullets).with_missiles(crate::missiles::load(&data))
}
fn sortie(l: &mut Lobby, mode: &str, vehicle: &str) -> (u32,u32) {
    let id = connected(l,json!(1));
    create(l,id,mode);
    let room = l.players[&id].room.unwrap();
    send(l,id,json!({"t":"start"}),0.0);
    send(l,id,json!({"t":"deploy","vehicle":vehicle}),0.0);
    send(l,id,json!({"t":"state","s":{"pos":[0,0,0]}}),0.0);
    (id,room)
}
#[test]
fn oplot23_registration_manual_shared_ammo_and_damage_ownership() {
    let mut l=real_lobby();
    l.shells=crate::server::load_catalog(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")).0;
    let vehicle="su_t10m_oplot23";
    assert!(l.targets.contains_key(vehicle),"independent variant must register from its new directory");
    assert!(l.targets.contains_key("su_t10m"));
    assert_eq!(l.shells["api_23_bza"].caliber_mm,23.0);
    assert_eq!(l.shells["hei_23_ofz"].filler_kg,0.0178);
    for shell in ["api_23_bza","hei_23_ofz"] {
        assert_eq!(l.projectiles[shell].mass_kg,0.174);
        assert_eq!(l.projectiles[shell].caliber_mm,23.0);
        assert_eq!(l.projectiles[shell].muzzle_velocity_ms,715.0);
    }
    assert_eq!(l.projectiles["hei_23_ofz"].explosive_mass_kg,0.0178);
    for mode in ["historical","casual"] {
        let (id,room)=sortie(&mut l,mode,vehicle);
        let def=&l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap().def;
        assert_eq!(def.bullet_caliber_mm,23.0); assert_eq!(def.bullet_mass_kg,0.174); assert_eq!(def.bullet_speed_ms,715.0);
        assert_eq!(def.rate_rpm,8000.0*if mode=="casual" {1.2} else {1.0});
        let fire=|seq,shell|json!({"t":"fire","seq":seq,"instance":"gun:1:0","shell":shell,"o":[0,3,0],"d":[0,0,1]});
        assert_eq!(message(&send(&mut l,id,fire(1,"api_23_bza"),1.0),id,"fire_rejected")["reason"],"automatic_protection");
        send(&mut l,id,json!({"t":"aps","enabled":false}),1.1);
        let main_before=l.players[&id].rounds;
        for (seq,shell) in [(2,"api_23_bza"),(3,"hei_23_ofz")] {
            assert!(!message(&send(&mut l,id,fire(seq,shell),1.2+seq as f64*0.1),id,"fire_accepted").is_null());
        }
        assert_eq!(l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap().rounds,498);
        assert_eq!(l.players[&id].rounds,main_before);
        send(&mut l,id,json!({"t":"aps","enabled":true}),2.0);
        assert_eq!(l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap().rounds,498);
        let gun=l.targets[vehicle].def.modules.iter().position(|m|m.id=="oplot_gun").unwrap();
        l.players.get_mut(&id).unwrap().combat.as_mut().unwrap().modules[gun]=0.0;
        send(&mut l,id,json!({"t":"aps","enabled":false}),2.1);
        assert!(!message(&send(&mut l,id,fire(4,"api_23_bza"),2.2),id,"fire_rejected").is_null());
        assert_eq!(l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap().rounds,498);
        l.players.get_mut(&id).unwrap().combat.as_mut().unwrap().modules[gun]=1.0;
        assert!(!message(&send(&mut l,id,fire(5,"api_23_bza"),2.3),id,"fire_accepted").is_null());
        assert_eq!(l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap().rounds,497);
    }
}
#[test]
fn oplot23_native_automatic_bullets_use_new_ballistics_and_real_damage_gates() {
    let l=real_lobby();
    let target=&l.targets["su_t10m_oplot23"];
    let pose=json!({"pos":[0,0,0],"tur":[[0,0],[0,0]]});
    for mode in ["historical","casual"] {
        let gameplay=crate::gameplay::RoomGameplay::parse(json!(mode),json!(1)).unwrap();
        let spec=l.mdata.room_aps("su_t10m_oplot23",gameplay).unwrap();
        for fault in ["healthy","main","oplot","radar","crew","repair"] {
            let mut state=target.fresh_state();
            if let Some(id)=match fault {"main"=>Some("breech"),"oplot"=>Some("oplot_gun"),"radar"=>Some("oplot_radar"),_=>None} {
                let index=target.def.modules.iter().position(|m|m.id==id).unwrap();state.modules[index]=0.0;
            }
            if fault=="crew" {for(i,c)in target.def.crew.iter().enumerate(){if c.role==tg_combat::CrewRole::Gunner {state.crew[i]=0.0;}}}
            if fault=="repair" {state.repair_s=3.0;}
            let actor=crate::missiles::actor_of(1,0,true,&pose,Some(target),Some(&spec),Some(&state)).unwrap();
            let can_fire=matches!(fault,"healthy"|"main"|"radar");
            assert_eq!(actor.aps_gun_ok,can_fire,"{mode}/{fault}");
            let mut world=tg_missile::World::new(l.mdata.defs.clone());
            world.add_aps(1,0,spec.def.clone(),21);
            let id=world.launch("bgm71a_tow",99,1,[0.0,2.0,1000.0],[0.0,-0.0006,-0.99999982],3).unwrap();
            world.guide(id,99,[0.0,2.3,1000.0],[0.0,1.4,0.0]);
            let mut emitted=0;
            for _ in 0..1200 {
                let out=world.step(1.0/120.0,std::slice::from_ref(&actor));
                emitted+=out.fired.len();
                if let Some(f)=out.fired.first() {
                    let speed=f.vel.iter().map(|v|v*v).sum::<f64>().sqrt();assert!((speed-715.0).abs()<1e-6);
                    assert_eq!(world.aps[0].rounds,500-emitted as u32);
                    let b=world.bullets.first().unwrap().clone();
                    world.set_aps(1,false,None);
                    world.step(1.0/120.0,std::slice::from_ref(&actor));
                    let next=&world.bullets[0];
                    let speed=b.vel.iter().map(|v|v*v).sum::<f64>().sqrt();
                    let drag=0.5*1.225*0.30*std::f64::consts::PI*(0.023_f64/2.0).powi(2)/0.174;
                    assert!((next.vel[2]-b.vel[2]*(1.0-drag*speed/120.0)).abs()<1e-8,"actual native flight uses23mm/.174kg drag");
                    break;
                }
            }
            assert_eq!(emitted>0,can_fire&&fault!="radar","{mode}/{fault} actual automatic ownership");
        }
    }
}
#[test]
fn two_room_protection_profiles_are_fresh_source_derived_and_independent() {
    let mut l = real_lobby();
    let source = serde_json::to_value(&l.mdata.aps["su_t10m"].def).unwrap();
    let (a,ar) = sortie(&mut l,"casual","su_t10m");
    let (b,br) = sortie(&mut l,"historical","su_t10m");
    let aa = &l.rooms[&ar].world.as_ref().unwrap().aps_of(a).unwrap().def;
    let ba = &l.rooms[&br].world.as_ref().unwrap().aps_of(b).unwrap().def;
    assert_eq!(aa.rate_rpm,ba.rate_rpm * 1.2);
    assert_eq!(aa.rate_range_rpm,ba.rate_range_rpm.map(|r|r*1.2));
    assert_eq!(aa.traverse_deg_s,ba.traverse_deg_s * 1.3);
    assert_eq!(aa.elevate_deg_s,ba.elevate_deg_s * 1.2);
    let mut expected=source.clone();
    for (field,factor) in [("rate_rpm",1.2),("traverse_deg_s",1.3),("elevate_deg_s",1.2)] { expected[field]=json!(source[field].as_f64().unwrap()*factor); }
    expected["rate_range_rpm"]=json!(ba.rate_range_rpm.map(|r|r*1.2));
    assert_eq!(serde_json::to_value(aa).unwrap(),expected,"only gun rates change; radar, geometry and bullet physics stay original");
    assert_eq!(serde_json::to_value(ba).unwrap(),source);
    assert_eq!(serde_json::to_value(&l.mdata.aps["su_t10m"].def).unwrap(),source);
    send(&mut l,a,json!({"t":"aps","enabled":true,"rate":999999}),1.0);
    assert_eq!(l.rooms[&ar].world.as_ref().unwrap().aps_of(a).unwrap().rate_rpm,expected["rate_range_rpm"][1].as_f64().unwrap());
    assert_eq!(l.rooms[&br].world.as_ref().unwrap().aps_of(b).unwrap().rate_rpm,source["rate_rpm"].as_f64().unwrap());
}
#[test]
fn room_launcher_spacing_and_retry_time_accept_legal_twin_tube_cadence() {
    let mut l = real_lobby();
    for mode in ["casual","historical"] {
        let (id,_) = sortie(&mut l,mode,"us_m901_itv");
        let launch=|seq| json!({"t":"launch","seq":seq,"instance":"gun:0:0","missile":"bgm71a_tow","o":[0,2,0],"d":[0,0,1]});
        assert!(!message(&send(&mut l,id,launch(1),1.0),id,"launched").is_null());
        let interval=if mode=="casual" {0.25/1.2} else {0.25};
        let rejection=message(&send(&mut l,id,launch(2),1.1),id,"launch_rejected");
        assert!((rejection["retry_after_s"].as_f64().unwrap()-(interval-0.1)).abs()<1e-9);
        assert!(!message(&send(&mut l,id,launch(3),1.0+interval+1e-8),id,"launched").is_null());
        assert_eq!(l.players[&id].missiles_left["bgm71a_tow"],10);
        let before=l.players[&id].missiles_left.clone();
        assert!(!message(&send(&mut l,id,launch(3),2.0),id,"launched").is_null());
        assert_eq!(l.players[&id].missiles_left,before,"receipt retry cannot spend twice");
    }
}
#[test]
fn room_fire_and_mg_quotas_and_coarse_speed_bounds_match_legal_throughput() {
    let mut l=real_lobby();
    for (mode,limit,auto,speed) in [("casual",20,720,34.5),("historical",16,600,30.0)] {
        let (id,_) = sortie(&mut l,mode,"de_tiger_e");
        let shot=|seq|json!({"t":"fire","seq":seq,"instance":"gun:0:0","shell":"apcbc_88_l56","o":[0,0,0],"d":[0,0,1]});
        for seq in 1..=limit { assert!(!message(&send(&mut l,id,shot(seq),1.0),id,"fire_accepted").is_null(),"{mode} seq {seq}"); }
        assert_eq!(message(&send(&mut l,id,shot(limit+1),1.0),id,"fire_rejected")["reason"],"rate_limited");
        assert_eq!(message(&send(&mut l,id,shot(1),1.0),id,"fire_accepted")["seq"],1);
        let mg=l.targets["de_tiger_e"].weapon_bindings.values().find(|b|b.kind==WeaponKind::MachineGun && b.model_id=="mg34").unwrap().key.clone();
        for seq in 1000..1000+auto+1 { send(&mut l,id,json!({"t":"mg_fire","seq":seq,"gun":"mg34","instance":mg,"o":[0,0,0],"d":[0,0,1]}),1.0); }
        assert_eq!(l.players[&id].fired.iter().filter(|f| f.kind==WeaponKind::MachineGun).count(),auto as usize);
        send(&mut l,id,json!({"t":"state","s":{"pos":[0,0,0]}}),3.0);
        send(&mut l,id,json!({"t":"state","s":{"pos":[speed-0.1,0,0]}}),4.0);
        assert_eq!(l.players[&id].state.as_ref().unwrap()["pos"][0],speed-0.1);
        send(&mut l,id,json!({"t":"state","s":{"pos":[speed*3.0,0,0]}}),5.0);
        assert_eq!(l.players[&id].state.as_ref().unwrap()["pos"][0],speed-0.1,"over-limit jump retains last valid state");
    }
}
#[test]
fn actual_socket_dispatch_checks_replacement_before_restoring_or_rotating_the_seat() {
    let mut l=real_lobby();
    let (old,room)=sortie(&mut l,"historical","us_m901_itv");
    let token=l.players[&old].token.clone();
    l.drop_link(old,1.0);
    let (placeholder,_) = l.connect();
    for capability in [Value::Null,json!("1"),json!(0),json!(2),json!([1])] {
        let msg=serde_json::from_value(json!({"t":"hello","ammo_protocol_version":1,"name":"replacement","resume":token,"gameplay_rules_version":capability})).unwrap();
        let (seat,out)=l.dispatch_socket(placeholder,msg,2.0);
        assert_eq!(seat,placeholder);
        assert!(message(&out,placeholder,"error")["msg"].as_str().unwrap_or("").contains("更新"));
        assert!(out.iter().all(|(to,m)|*to==placeholder && matches!(m,ServerMsg::Error{..})),"no old-seat or room messages leak");
        assert_eq!(l.players[&old].token,token);
        assert_eq!(l.players[&old].away,Some(1.0));
        assert!(l.players[&placeholder].room.is_none());
    }
    let msg=serde_json::from_value(json!({"t":"hello","ammo_protocol_version":1,"name":"replacement","resume":token,"gameplay_rules_version":1})).unwrap();
    let (seat,out)=l.dispatch_socket(placeholder,msg,2.0);
    assert_eq!(seat,old);
    assert!(!l.players.contains_key(&placeholder));
    assert_eq!(l.players[&old].room,Some(room));
    assert_eq!(l.players[&old].away,None);
    assert_ne!(l.players[&old].token,token);
    assert_eq!(out.iter().filter(|(to,m)|*to==old && matches!(m,ServerMsg::Welcome{..})).count(),1);
    profile(&message(&out,old,"room")["room"],"historical");
    profile(&message(&out,old,"start"),"historical");
}
#[test]
fn casual_keeps_manual_automatic_oplot_ownership_and_independent_damage_and_ammo_gates() {
    let mut l=real_lobby();
    let (id,room)=sortie(&mut l,"casual","su_t10m");
    let fire=|seq,instance,shell|json!({"t":"fire","seq":seq,"instance":instance,"shell":shell,"o":[0,2,0],"d":[0,0,1]});
    let primary=l.targets["su_t10m"].weapon_bindings["gun:0:0"].critical.clone();
    for i in primary { l.players.get_mut(&id).unwrap().combat.as_mut().unwrap().modules[i]=0.0; }
    let before=l.players[&id].rounds;
    assert_eq!(message(&send(&mut l,id,fire(1,"gun:1:0","api_145_b32"),1.0),id,"fire_rejected")["reason"],"automatic_protection");
    send(&mut l,id,json!({"t":"aps","enabled":false}),1.0);
    assert!(!message(&send(&mut l,id,fire(2,"gun:1:0","api_145_b32"),1.1),id,"fire_accepted").is_null());
    assert_eq!(l.players[&id].rounds,before,"independent protection never spends primary ammunition");
    assert_eq!(l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap().rounds,899);
    assert_eq!(message(&send(&mut l,id,fire(2,"gun:1:0","api_145_b32"),1.2),id,"fire_accepted")["seq"],2);
    let own=l.targets["su_t10m"].weapon_bindings["gun:1:0"].critical.clone();
    for &i in &own { l.players.get_mut(&id).unwrap().combat.as_mut().unwrap().modules[i]=0.0; }
    assert_eq!(message(&send(&mut l,id,fire(3,"gun:1:0","api_145_b32"),1.3),id,"fire_rejected")["reason"],"weapon_disabled");
    for i in own { l.players.get_mut(&id).unwrap().combat.as_mut().unwrap().modules[i]=l.targets["su_t10m"].def.modules[i].max_health; }
    l.players.get_mut(&id).unwrap().ammo.as_mut().unwrap().counts.get_mut("gun:1:0").unwrap().fill(0);l.sync_ammo(id);
    assert_eq!(message(&send(&mut l,id,fire(4,"gun:1:0","api_145_b32"),1.4),id,"fire_rejected")["reason"],"no_ammo");
    assert_eq!(message(&send(&mut l,id,fire(5,"gun:99:0","api_145_b32"),1.5),id,"fire_rejected")["reason"],"weapon_disabled");

    // A fresh casual world actually runs the same automatic gun while the primary is broken.
    let mut l=real_lobby();
    let (aps,room)=sortie(&mut l,"casual","su_t10m");
    let launcher=connected(&mut l,json!(1));
    send(&mut l,launcher,json!({"t":"join","room":room}),0.0);
    send(&mut l,launcher,json!({"t":"deploy","vehicle":"us_m901_itv"}),0.0);
    send(&mut l,launcher,json!({"t":"state","s":{"pos":[0,0,600]}}),0.0);
    let main=l.targets["su_t10m"].weapon_bindings["gun:0:0"].critical[0];
    l.players.get_mut(&aps).unwrap().combat.as_mut().unwrap().modules[main]=0.0;
    let launched=message(&send(&mut l,launcher,json!({"t":"launch","seq":5,"instance":"gun:0:0","missile":"bgm71a_tow","o":[0,2.3,600],"d":[0,0,-1]}),1.0),launcher,"launched");
    let mid=launched["id"].as_u64().unwrap();
    let mut fired=false;
    for i in 0..240 {
        send(&mut l,launcher,json!({"t":"guide","id":mid,"sight":[0,2.3,600],"aim":[0,2,0]}),1.0+i as f64/20.0);
        for (_,msg) in l.tick() { if let ServerMsg::Snap{fired:rounds,..}=msg { fired |= !rounds.is_empty(); } }
    }
    assert!(fired,"actual Lobby tick fires the independent automatic protection gun");
    assert!(l.rooms[&room].world.as_ref().unwrap().aps_of(aps).unwrap().rounds<900);
}
#[test]
fn socket_and_bounded_sequence_allowances_follow_room_throughput_without_cross_room_pollution() {
    let mut l=real_lobby();
    for (mode,rate,capacity) in [("historical",240.0,2048),("casual",288.0,2458)] {
        let (id,room)=sortie(&mut l,mode,"de_tiger_e");
        assert_eq!(l.socket_rate(id),rate);
        let mg=l.targets["de_tiger_e"].weapon_bindings.values().find(|b|b.kind==WeaponKind::MachineGun).unwrap().clone();
        for seq in 1..=2600 {
            send(&mut l,id,json!({"t":"mg_fire","seq":seq,"instance":mg.key,"gun":mg.model_id,"o":[0,2,0],"d":[0,0,1]}),seq as f64*0.03);
        }
        assert_eq!(l.players[&id].sequences.len(),capacity);
        assert!(l.players[&id].fired.len()<=l.rooms[&room].gameplay.fire_burst(true));
        send(&mut l,id,json!({"t":"mg_fire","seq":1,"instance":mg.key,"gun":mg.model_id,"o":[0,2,0],"d":[0,0,1]}),90.0);
        assert!(!l.players[&id].fired.iter().any(|f|f.seq==1),"expired proof never reopens sequence");
        send(&mut l,id,json!({"t":"leave"}),90.0);
        assert_eq!(l.socket_rate(id),240.0);
    }
    let bound=crate::gameplay::socket_queue_capacity();
    assert_eq!(bound,615);
    let (tx,_rx)=std::sync::mpsc::sync_channel(bound);
    for _ in 0..bound { tx.try_send(()).unwrap(); }
    assert!(matches!(tx.try_send(()),Err(std::sync::mpsc::TrySendError::Full(_))));
}
#[test]
fn browser_protocol_receipt_from_actual_handlers() {
    // Explicit local integration lane: Node verifies these source/config tags before replay.
    let Ok(path)=std::env::var("TG_GAMEPLAY_NETWORK_RECEIPT") else { return; };
    let mut l=real_lobby();
    let (a,_) = l.connect();
    let (b,_) = l.connect();
    let mut phases=serde_json::Map::new();
    for (name,id) in [("welcome_a",a),("welcome_b",b)] {
        phases.insert(name.into(),serde_json::to_value(send(&mut l,id,json!({"t":"hello","name":name,"gameplay_rules_version":1}),0.0)).unwrap());
    }
    create(&mut l,a,"historical");
    let room=l.players[&a].room.unwrap();
    phases.insert("room".into(),serde_json::to_value(send(&mut l,b,json!({"t":"join","room":room}),0.0)).unwrap());
    phases.insert("start".into(),serde_json::to_value(send(&mut l,a,json!({"t":"start"}),0.0)).unwrap());
    phases.insert("deploy_a".into(),serde_json::to_value(send(&mut l,a,json!({"t":"deploy","vehicle":"de_tiger_e"}),1.0)).unwrap());
    phases.insert("deploy_b".into(),serde_json::to_value(send(&mut l,b,json!({"t":"deploy","vehicle":"su_t34_85"}),1.0)).unwrap());
    send(&mut l,a,json!({"t":"respawn"}),2.0);
    phases.insert("respawn".into(),serde_json::to_value(send(&mut l,a,json!({"t":"deploy","vehicle":"de_tiger_e"}),8.0)).unwrap());
    let token=l.players[&a].token.clone();
    l.drop_link(a,9.0);
    let (replacement,_) = l.connect();
    let (_,out)=l.dispatch_socket(replacement,serde_json::from_value(json!({"t":"hello","ammo_protocol_version":1,"name":"resumed","resume":token,"gameplay_rules_version":1})).unwrap(),10.0);
    phases.insert("resume".into(),serde_json::to_value(out).unwrap());
    phases.insert("leave".into(),serde_json::to_value(send(&mut l,a,json!({"t":"leave"}),11.0)).unwrap());
    let (c,_) = l.connect();
    phases.insert("welcome_c".into(),serde_json::to_value(send(&mut l,c,json!({"t":"hello","name":"casual","gameplay_rules_version":1}),12.0)).unwrap());
    phases.insert("room_c".into(),serde_json::to_value(create(&mut l,c,"casual")).unwrap());
    phases.insert("start_c".into(),serde_json::to_value(send(&mut l,c,json!({"t":"start"}),12.0)).unwrap());
    let sources=super::ammo_tests::source_tags();
    std::fs::write(path,serde_json::to_vec(&json!({"a":a,"b":b,"c":c,"phases":phases,"sources":sources})).unwrap()).unwrap();
}
#[test]
fn room_rules_follow_actual_create_list_join_start_state_deploy_and_respawn() {
    let mut l = Lobby::default();
    let a = connected(&mut l, json!(1));
    let b = connected(&mut l, json!(1));
    let out = create(&mut l, a, "historical");
    let room = l.players[&a].room.unwrap();
    profile(&message(&out,a,"room")["room"], "historical");
    profile(&message(&send(&mut l,b,json!({"t":"list"}),0.0),b,"rooms")["rooms"][0], "historical");
    let joined = send(&mut l,b,json!({"t":"join","room":room}),0.0);
    profile(&message(&joined,b,"room")["room"], "historical");
    let started = send(&mut l,a,json!({"t":"start"}),0.0);
    profile(&message(&started,b,"start"), "historical");
    let deployed = send(&mut l,a,json!({"t":"deploy","vehicle":"test"}),1.0);
    profile(&message(&deployed,a,"respawned"), "historical");
    send(&mut l,a,json!({"t":"state","s":{"pos":[0,0,0],"gameplay_mode":"casual","gameplay_rules_version":99}}),1.0);
    profile(&message(&send(&mut l,b,json!({"t":"join","room":room}),2.0),b,"room")["room"], "historical");
    send(&mut l,a,json!({"t":"respawn"}),2.0);
    let deployed = send(&mut l,a,json!({"t":"deploy","vehicle":"test"}),8.0);
    profile(&message(&deployed,a,"respawned"), "historical");
}
#[test]
fn invalid_create_rules_and_incompatible_join_never_leave_existing_room() {
    let mut l = Lobby::default();
    let a = connected(&mut l,json!(1));
    for (mode,version) in [(json!("bogus"),json!(1)),(json!("casual"),json!(2)),(Value::Null,json!(1)),(json!("historical"),Value::Null),(json!("casual"),json!("1"))] {
        let out = send(&mut l,a,json!({"t":"create","name":"bad","map":"range","max":4,"gameplay_mode":mode,"gameplay_rules_version":version}),0.0);
        assert!(!message(&out,a,"error").is_null(), "invalid rules must reject");
        assert!(l.players[&a].room.is_none());
    }
    create(&mut l,a,"casual");
    let room = l.players[&a].room.unwrap();
    for capability in [Value::Null,json!(0),json!(2),json!("1"),json!([1]),json!({"version":1})] {
        let b = connected(&mut l,capability);
        let out = send(&mut l,b,json!({"t":"join","room":room}),0.0);
        assert!(message(&out,b,"error")["msg"].as_str().unwrap_or("").contains("更新"));
        assert!(l.players[&b].room.is_none());
    }
    send(&mut l,a,json!({"t":"start"}),0.0);
    let out = create(&mut l,a,"historical");
    assert!(!message(&out,a,"error").is_null(), "cannot replace a battle's room profile");
    assert_eq!(l.players[&a].room,Some(room));
}
