use super::*;
use serde_json::json;

fn send(l: &mut Lobby, id: u32, mut value: Value, now: f64) -> Out {
    if value["t"]=="state" {fixture_state(l,id,&mut value["s"],now);}
    if value["t"] == "hello" { value["ammo_protocol_version"] = json!(1); }
    if matches!(value["t"].as_str(), Some("fire"|"launch"|"mg_fire")) {
        let scope=l.ammo_scope(id); value["ammo_scope"]=json!(scope);
        if value["t"]=="launch" {value["ammo"]=json!(l.mdata.defs.iter().find(|def|Some(def.id.as_str())==value["missile"].as_str()).map(|def|def.warhead.clone()).unwrap_or_default());}
    }
    l.handle(id, serde_json::from_value(value).unwrap(), now)
}

/// Pose-poor legacy scenarios obtain the real bound source layout and current
/// native bore. Explicit malformed/scope/joint fields remain untouched.
pub(super) fn fixture_state(l: &Lobby, id: u32, s: &mut Value, now: f64) {
    let Some(p)=l.players.get(&id) else {return};let Some(spec)=l.mdata.aps.get(&p.vehicle) else {return};
    let Some(target)=l.targets.get(&p.vehicle) else {return};let Some(stock)=p.ammo.as_ref() else {return};
    if s.get("ex").is_none() {s["ex"]=p.state.as_ref().and_then(|v|v.get("ex")).cloned().unwrap_or(json!([1,0,0]));}
    if s.get("ez").is_none() {s["ez"]=p.state.as_ref().and_then(|v|v.get("ez")).cloned().unwrap_or(json!([0,0,1]));}
    if s.get("tur").is_none() {
        let w=&target.def.weapons;let mut tur=vec![[w["facing_deg"].as_f64().unwrap_or(0.0).to_radians(),0.0]];
        for layout in w["extra_turrets"].as_array().into_iter().flatten() {
            let parent=layout["parent"].as_u64().and_then(|i|tur.get(i as usize)).map_or(0.0,|v|v[0]);
            tur.push([parent+layout["facing_deg"].as_f64().unwrap_or(0.0).to_radians(),0.0]);
        }
        if let Some(previous)=p.state.as_ref().and_then(|v|v["tur"].as_array()) {for (i,joint) in previous.iter().enumerate() {if let Some(out)=tur.get_mut(i) {if let (Some(y),Some(e))=(joint[0].as_f64(),joint[1].as_f64()) {*out=[y,e];}}}}
        if let Some(a)=p.room.and_then(|r|l.rooms.get(&r)).and_then(|r|r.world.as_ref()).and_then(|w|w.aps_of(id)).filter(|a|a.enabled) {
            let ps=crate::missiles::pose_of(s).expect("actual legal fixture hull");
            let d=[a.yaw.sin()*a.pitch.cos(),a.pitch.sin(),a.yaw.cos()*a.pitch.cos()];let local=ps.local_dir(d);
            tur[spec.turret]=[local[0].atan2(local[2]),local[1].atan2(local[0].hypot(local[2]))];
        }
        s["tur"]=json!(tur);
    }
    if s.get("ammo_scope").is_none() {s["ammo_scope"]=json!(stock.scope);}
    if s.get("aps_instance").is_none() {s["aps_instance"]=json!(format!("gun:{}:0",spec.turret));}
    if s.get("t").is_none() {s["t"]=json!(p.accepted_aps_pose.as_ref().map_or(now,|a|now.max(a.state_t+1e-6)));}
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
fn aps_pose_real_handlers_resume_the_held_parent_carried_bore() {
    for vehicle in ["su_t10m","su_t10m_oplot23"] { for mode in ["historical","casual"] {
        let mut l=real_lobby();let (id,room)=sortie(&mut l,mode,vehicle);
        send(&mut l,id,json!({"t":"aps","enabled":false}),0.1);
        let scope=l.ammo_scope(id);let heading: f64=0.4;
        send(&mut l,id,json!({"t":"state","s":{"pos":[0,0,0],"ex":[heading.cos(),0,-heading.sin()],"ez":[heading.sin(),0,heading.cos()],"tur":[[0.5,0],[0.9,0.2]],"ammo_scope":scope,"aps_instance":"gun:1:0","t":3.0}}),3.0);
        let rounds=l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap().rounds;
        send(&mut l,id,json!({"t":"aps","enabled":true}),3.0);
        let a=l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap();
        assert!((a.yaw-1.3).abs()<1e-8,"{vehicle}/{mode} must adopt held bore, got {}",a.yaw);
        assert!((a.pitch-0.2).abs()<1e-8);assert_eq!(a.rounds,rounds);
    } }
}

#[test]
fn aps_pose_malformed_held_state_cannot_enable() {
    let mut l=real_lobby();let (id,room)=sortie(&mut l,"historical","su_t10m");
    send(&mut l,id,json!({"t":"aps","enabled":false}),0.1);
    let scope=l.ammo_scope(id);
    send(&mut l,id,json!({"t":"state","s":{"pos":[0,0,0],"ex":[1,0,0],"ez":[0,0,1],"tur":[[0,0],[0,2.0]],"ammo_scope":scope,"aps_instance":"gun:1:0","t":1.0}}),1.0);
    send(&mut l,id,json!({"t":"aps","enabled":true}),1.0);
    assert!(!l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap().enabled,"an impossible elevation cannot take ownership");
}

pub(super) fn actual_aps_handoffs() -> Value {
    let mut scenarios=serde_json::Map::new();
    for vehicle in ["su_t10m","su_t10m_oplot23"] {for mode in ["historical","casual"] {
        let mut l=real_lobby();l.shells=crate::server::load_catalog(&std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")).0;
        let (id,_)=l.connect();let mut phases=serde_json::Map::new();
        let mut record=|name:&str,out:Out| {phases.insert(name.into(),serde_json::to_value(out).unwrap());};
        record("welcome",send(&mut l,id,json!({"t":"hello","name":"pose","gameplay_rules_version":1}),0.0));
        record("create",create(&mut l,id,mode));let room=l.players[&id].room.unwrap();
        record("start",send(&mut l,id,json!({"t":"start"}),0.0));
        record("deploy",send(&mut l,id,json!({"t":"deploy","vehicle":vehicle}),0.0));
        record("initial_state",send(&mut l,id,json!({"t":"state","s":{"pos":[0,0,0],"t":0.01}}),0.0));
        let enemy=connected(&mut l,json!(1));send(&mut l,enemy,json!({"t":"join","room":room}),0.0);
        send(&mut l,enemy,json!({"t":"deploy","vehicle":"us_m901_itv"}),0.0);send(&mut l,enemy,json!({"t":"state","s":{"pos":[0,0,600]}}),0.0);
        let launch=send(&mut l,enemy,json!({"t":"launch","seq":1,"instance":"gun:0:0","missile":"bgm71a_tow","o":[0,2.3,600],"d":[0,0,-1]}),0.0);
        let mid=message(&launch,enemy,"launched")["id"].as_u64().unwrap();record("launch",launch);
        let mut now=0.0;let mut warm=false;
        for i in 1..=200 {now=i as f64*0.05;send(&mut l,id,json!({"t":"state","s":{"pos":[0,0,0]}}),now);
            send(&mut l,enemy,json!({"t":"guide","id":mid,"sight":[0,2.3,600],"aim":[0,1.4,0]}),now);
            let out=l.tick_at(now);if out.iter().any(|(_,m)|matches!(m,ServerMsg::Snap{fired,..}if !fired.is_empty())) {
                record("warm",super::ammo_tests::broadcast_out(out));warm=true;break;
            }
        }
        assert!(warm);let a=l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap();assert!(a.heat>0.0&&a.spin>0.0);
        let rate=a.def.rate_range_rpm[0];now+=0.05;
        record("disable",send(&mut l,id,json!({"t":"aps","enabled":false,"rate":rate}),now));
        let shell=l.ammo_catalogs[vehicle].guns["gun:1:0"].ammo[0].clone();
        record("manual",send(&mut l,id,json!({"t":"fire","seq":77,"instance":"gun:1:0","shell":shell,"o":[0,2.7,0],"d":[0,0,1]}),now));
        now+=3.0;let heading: f64=0.4;let scope=l.ammo_scope(id);
        let held=json!({"pos":[0,0,0],"ex":[heading.cos(),0,-heading.sin()],"ez":[heading.sin(),0,heading.cos()],"tur":[[0.5,0],[0.9,0.2]],"ammo_scope":scope,"aps_instance":"gun:1:0","t":now});
        record("held_state",send(&mut l,id,json!({"t":"state","s":held.clone()}),now));
        let before=serde_json::to_value(l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap()).unwrap();
        record("enable",send(&mut l,id,json!({"t":"aps","enabled":true}),now));
        let adopted=l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap();assert!((adopted.yaw-1.3).abs()<1e-8&& (adopted.pitch-0.2).abs()<1e-8);
        assert_eq!(adopted.rounds,before["rounds"].as_u64().unwrap() as u32);assert_eq!(adopted.heat,before["heat"].as_f64().unwrap());assert_eq!(adopted.spin,before["spin"].as_f64().unwrap());
        now+=0.05;record("next_snap",super::ammo_tests::broadcast_out(l.tick_at(now)));
        let a=l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap();assert!((a.yaw-1.3).abs()<=a.def.traverse_deg_s.to_radians()*0.05+1e-8);assert!((a.pitch-0.2).abs()<=a.def.elevate_deg_s.to_radians()*0.05+1e-8);
        let carried_motor=a.yaw-0.4-0.5;let carried_pitch=a.pitch;
        record("carry_disable",send(&mut l,id,json!({"t":"aps","enabled":false}),now));
        now+=3.0;let heading: f64=0.9;
        let carried=json!({"pos":[0,0,0],"ex":[heading.cos(),0,-heading.sin()],"ez":[heading.sin(),0,heading.cos()],"tur":[[0.7,0],[0.7+carried_motor,carried_pitch]],"ammo_scope":scope,"aps_instance":"gun:1:0","t":now});
        record("carry_state",send(&mut l,id,json!({"t":"state","s":carried.clone()}),now));
        record("carry_enable",send(&mut l,id,json!({"t":"aps","enabled":true}),now));
        assert!((l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap().yaw-(1.6+carried_motor)).abs()<1e-8);
        now+=0.05;record("carry_snap",super::ammo_tests::broadcast_out(l.tick_at(now)));
        let token=l.players[&id].token.clone();l.drop_link(id,now);let replacement=connected(&mut l,json!(1));
        let (_,resume)=l.dispatch_socket(replacement,serde_json::from_value(json!({"t":"hello","name":"resumed","resume":token,"gameplay_rules_version":1,"ammo_protocol_version":1})).unwrap(),now+0.2);record("resume",resume);
        let mut restarted=carried.clone();restarted["t"]=json!(0.01);
        record("restarted_state",send(&mut l,id,json!({"t":"state","s":restarted.clone()}),now+0.3));
        assert!(l.players[&id].aps_pose_valid,"authenticated transport can restart its client clock without discarding motor history");
        record("restarted_enable",send(&mut l,id,json!({"t":"aps","enabled":true}),now+0.3));
        record("restarted_snap",super::ammo_tests::broadcast_out(l.tick_at(now+0.35)));
        drop(record);
        scenarios.insert(format!("{vehicle}_{mode}"),json!({"vehicle":vehicle,"mode":mode,"owner":id,"held":held,"carried":carried,"restarted":restarted,"before":before,"phases":phases}));
    }}
    json!(scenarios)
}

/// Server-driven pose loss does not send an explicit client disable. The next
/// held State therefore reaches the auto-enable path before the client's APS request.
pub(super) fn actual_aps_suspensions() -> Value {
    let mut scenarios=serde_json::Map::new();
    for vehicle in ["su_t10m","su_t10m_oplot23"] {for mode in ["historical","casual"] {for cause in ["stale","invalid"] {
        let mut l=super::ammo_tests::real_lobby();let (id,_)=l.connect();let mut phases=serde_json::Map::new();
        let mut record=|name:&str,out:Out| {phases.insert(name.into(),serde_json::to_value(out).unwrap());};
        record("welcome",send(&mut l,id,json!({"t":"hello","name":"suspended","gameplay_rules_version":1}),0.0));
        record("create",create(&mut l,id,mode));let room=l.players[&id].room.unwrap();
        record("start",send(&mut l,id,json!({"t":"start"}),0.0));
        record("deploy",send(&mut l,id,json!({"t":"deploy","vehicle":vehicle}),0.0));
        record("initial_state",send(&mut l,id,json!({"t":"state","s":{"pos":[0,0,0],"t":0.01}}),0.01));
        record("initial_enable",send(&mut l,id,json!({"t":"aps","enabled":true}),0.01));
        record("initial_snap",super::ammo_tests::broadcast_out(l.tick_at(0.06)));
        let enemy=connected(&mut l,json!(1));send(&mut l,enemy,json!({"t":"join","room":room}),0.06);
        send(&mut l,enemy,json!({"t":"deploy","vehicle":"us_m901_itv"}),0.06);
        send(&mut l,enemy,json!({"t":"state","s":{"pos":[0,0,600]}}),0.06);
        let launch=send(&mut l,enemy,json!({"t":"launch","seq":1,"instance":"gun:0:0","missile":"bgm71a_tow","o":[0,2.3,600],"d":[0,0,-1]}),0.06);
        let mid=message(&launch,enemy,"launched")["id"].as_u64().unwrap();record("launch",launch);
        let mut now=0.06;let mut warm=false;
        for i in 1..=200 {now=0.06+i as f64*0.05;
            send(&mut l,id,json!({"t":"state","s":{"pos":[0,0,0]}}),now);
            send(&mut l,enemy,json!({"t":"guide","id":mid,"sight":[0,2.3,600],"aim":[0,1.4,0]}),now);
            let out=l.tick_at(now);if out.iter().any(|(_,m)|matches!(m,ServerMsg::Snap{fired,..}if !fired.is_empty())) {record("warm",super::ammo_tests::broadcast_out(out));warm=true;break;}
        }
        assert!(warm);assert!(l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap().heat>0.0);
        let primary_at=now;let shell=l.ammo_catalogs[vehicle].guns["gun:0:0"].ammo[0].clone();
        let primary=send(&mut l,id,json!({"t":"fire","seq":1,"instance":"gun:0:0","shell":shell,"o":[0,1.5,0],"d":[0,0,1]}),now);
        assert!(!message(&primary,id,"fire_accepted").is_null());record("primary",primary);
        let previous=l.players[&id].accepted_aps_pose.clone().unwrap();let counts=l.players[&id].ammo.as_ref().unwrap().counts.clone();
        if cause=="stale" {now+=2.0;} else {
            now+=0.01;let mut bad=l.players[&id].state.clone().unwrap();bad["t"]=json!(now);bad["tur"][1][1]=json!(2.0);
            record("invalid_state",send(&mut l,id,json!({"t":"state","s":bad}),now));now+=0.01;
        }
        record("off_snap",super::ammo_tests::broadcast_out(l.tick_at(now)));
        assert!(!l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap().enabled);
        assert!(l.players[&id].aps_desired_enabled,"pose suspension does not change the user's automatic preference");
        assert_eq!(l.players[&id].accepted_aps_pose.as_ref().unwrap().at,previous.at,"suspension retains trusted motor history");
        // Even a fresh recovery timestamp cannot erase the parent motor budget.
        let rejected=json!({"pos":[0,0,0],"ex":[1,0,0],"ez":[0,0,1],"tur":[[3.0,0],[3.0+previous.motor_yaw,previous.elevation]],"t":now+0.001});
        record("rejected_recovery",send(&mut l,id,json!({"t":"state","s":rejected}),now+0.001));
        assert!(!l.players[&id].aps_pose_valid);assert_eq!(l.players[&id].accepted_aps_pose.as_ref().unwrap().at,previous.at);
        now+=0.01;let rounded=|v:f64|(v*1e4).round()/1e4;let parent=rounded(previous.parent_yaw+0.002);let scope=l.ammo_scope(id);
        let held=json!({"pos":[0,0,0],"ex":[1,0,0],"ez":[0,0,1],"tur":[[parent,0],[rounded(parent+previous.motor_yaw+0.01),rounded(previous.elevation+0.005)]],"ammo_scope":scope,"aps_instance":"gun:1:0","t":(now*1000.0).round()/1000.0});
        let before=serde_json::to_value(l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap()).unwrap();
        let mut inflight=held.clone();inflight["t"]=json!(held["t"].as_f64().unwrap()-0.001);
        record("inflight_state",send(&mut l,id,json!({"t":"state","s":inflight}),now-0.001));
        let inflight_enabled=l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap().enabled;
        let rate=l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap().rate_rpm;
        record("rate_while_suspended",send(&mut l,id,json!({"t":"aps","enabled":true,"rate":rate}),now-0.001));
        let rate_enabled=l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap().enabled;
        record("recovery_state",send(&mut l,id,json!({"t":"state","s":held.clone()}),now));
        record("recovery_enable",send(&mut l,id,json!({"t":"aps","enabled":true}),now));
        let adopted=serde_json::to_value(l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap()).unwrap();
        assert_eq!(l.players[&id].ammo.as_ref().unwrap().counts,counts);
        assert!(adopted["enabled"].as_bool().unwrap());
        for key in ["rounds","heat","spin","scan","rate_rpm","rng"] {assert_eq!(adopted[key],before[key],"pose recovery cannot reset {key}");}
        record("later_snap",super::ammo_tests::broadcast_out(l.tick_at(now+0.05)));drop(record);
        scenarios.insert(format!("{vehicle}_{mode}_{cause}"),json!({"vehicle":vehicle,"mode":mode,"cause":cause,"owner":id,"primary_at":primary_at,"held":held,"before":before,"adopted":adopted,"counts":counts,"inflight_enabled":inflight_enabled,"rate_enabled":rate_enabled,"phases":phases}));
    }}}json!(scenarios)
}

fn assert_suspension_request(cause:&str) {
    for s in actual_aps_suspensions().as_object().unwrap().values().filter(|s|s["cause"]==cause) {
        assert_eq!(s["inflight_enabled"],false,"in-flight regular State cannot re-arm a suspended writer before the final-State request");
        assert_eq!(s["rate_enabled"],false,"a rate-only Y update cannot re-arm a suspended writer");
        assert!(s["phases"]["recovery_state"].as_array().unwrap().iter().all(|e|e[1]["t"]!="aps_pose"),"final State is held until the explicit ownership request");
        let ack=s["phases"]["recovery_state"].as_array().unwrap().iter().chain(s["phases"]["recovery_enable"].as_array().unwrap()).find(|e|e[0]==s["owner"]&&e[1]["t"]=="aps_pose").expect("current recovery must emit an actual owner ACK");
        assert_eq!(ack[1]["request_t"],s["held"]["t"],"{cause} suspension must correlate the new final State rather than the retired transition");
        assert_eq!(ack[1]["state_t"],s["held"]["t"]);
        let later=s["phases"]["later_snap"].as_array().unwrap().iter().find(|e|e[0]==s["owner"]&&e[1]["t"]=="snap").unwrap();
        assert!(later[1]["tick"].as_u64().unwrap()>ack[1]["tick"].as_u64().unwrap());
    }
}
#[test]
fn aps_pose_stale_suspension_acknowledges_the_new_final_state() {assert_suspension_request("stale");}
#[test]
fn aps_pose_invalid_state_suspension_acknowledges_the_new_final_state() {assert_suspension_request("invalid");}

// Recorded from the exact live aimTurrets + existing State encoder. Node replays
// that same owner and proves byte-valued pose equality before checking admission.
pub(super) fn actual_aps_quantization() -> Value {
    let mut scenarios=serde_json::Map::new();
    for vehicle in ["su_t10m","su_t10m_oplot23"] {for mode in ["historical","casual"] {
        let mut l=super::ammo_tests::real_lobby();let (id,_)=l.connect();let mut phases=serde_json::Map::new();
        let mut record=|name:&str,out:Out|{phases.insert(name.into(),serde_json::to_value(out).unwrap());};
        record("welcome",send(&mut l,id,json!({"t":"hello","name":"rounded","gameplay_rules_version":1}),0.0));
        record("create",create(&mut l,id,mode));let room=l.players[&id].room.unwrap();
        record("start",send(&mut l,id,json!({"t":"start"}),0.0));record("deploy",send(&mut l,id,json!({"t":"deploy","vehicle":vehicle}),0.0));
        record("disable",send(&mut l,id,json!({"t":"aps","enabled":false}),0.0));
        let scope=l.ammo_scope(id);
        let before=json!({"pos":[0,0,0],"ex":[1,0,0],"ez":[0,0,1],"v":[0,0,0],"w":[0,0,0],"track":[0,0],"rpm":0,"gear":0,"tur":[[0,0],[0.0001,0.02]],"fold":0,"t":0.0,"ammo_scope":scope,"aps_instance":"gun:1:0"});
        let mut current=before.clone();current["t"]=json!(0.05);
        current["tur"]=if mode=="historical" {json!([[0.01,0.0044],[-0.0424,0]])} else {json!([[0.01,0.0052],[-0.0581,0]])};
        record("before",send(&mut l,id,json!({"t":"state","s":before.clone()}),0.0));
        let counts=l.players[&id].ammo.as_ref().unwrap().counts.clone();
        record("current",send(&mut l,id,json!({"t":"state","s":current.clone()}),0.05));
        let current_valid=l.players[&id].aps_pose_valid;
        record("enable",send(&mut l,id,json!({"t":"aps","enabled":true}),0.05));
        let adopted=serde_json::to_value(l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap()).unwrap();
        record("snap",super::ammo_tests::broadcast_out(l.tick_at(0.1)));drop(record);
        assert_eq!(l.players[&id].ammo.as_ref().unwrap().counts,counts);
        // Separate actual handler history: the counterfeit goes one wire quantum
        // beyond the legal source endpoint, outside even the finite motor-error bound.
        let mut rejected=super::ammo_tests::real_lobby();let (rejected_id,_)=rejected.connect();
        phases.insert("rejected_welcome".into(),serde_json::to_value(send(&mut rejected,rejected_id,json!({"t":"hello","name":"pending","gameplay_rules_version":1}),0.0)).unwrap());
        phases.insert("rejected_create".into(),serde_json::to_value(create(&mut rejected,rejected_id,mode)).unwrap());let rejected_room=rejected.players[&rejected_id].room.unwrap();
        phases.insert("rejected_start".into(),serde_json::to_value(send(&mut rejected,rejected_id,json!({"t":"start"}),0.0)).unwrap());
        phases.insert("rejected_deploy".into(),serde_json::to_value(send(&mut rejected,rejected_id,json!({"t":"deploy","vehicle":vehicle}),0.0)).unwrap());
        phases.insert("rejected_before".into(),serde_json::to_value(send(&mut rejected,rejected_id,json!({"t":"state","s":before.clone()}),0.0)).unwrap());
        phases.insert("rejected_disable".into(),serde_json::to_value(send(&mut rejected,rejected_id,json!({"t":"aps","enabled":false}),0.0)).unwrap());
        let mut bad=current.clone();bad["tur"][1][0]=json!((current["tur"][1][0].as_f64().unwrap()*1e4-1.0).round()/1e4);
        phases.insert("rejected_current".into(),serde_json::to_value(send(&mut rejected,rejected_id,json!({"t":"state","s":bad.clone()}),0.05)).unwrap());
        let rejected_valid=rejected.players[&rejected_id].aps_pose_valid;assert!(!rejected_valid);
        assert_eq!(rejected.players[&rejected_id].accepted_aps_pose.as_ref().unwrap().at,0.0,"rejection retains the trusted history");
        phases.insert("rejected_enable".into(),serde_json::to_value(send(&mut rejected,rejected_id,json!({"t":"aps","enabled":true}),0.05)).unwrap());
        phases.insert("rejected_snap".into(),serde_json::to_value(super::ammo_tests::broadcast_out(rejected.tick_at(0.05))).unwrap());
        assert!(!rejected.rooms[&rejected_room].world.as_ref().unwrap().aps_of(rejected_id).unwrap().enabled);
        let mut unrelated=Vec::new();let mut poisoned=false;
        for kind in ["wrong_life","wrong_instance","unrelated","stale"] {
            let mut observation=before.clone();observation["t"]=json!(10.0);
            match kind {
                "wrong_life"=>observation["ammo_scope"]["life"]=json!(scope.life+1),
                "wrong_instance"=>observation["aps_instance"]=json!("gun:0:0"),
                "unrelated"=>{observation.as_object_mut().unwrap().remove("ammo_scope");observation.as_object_mut().unwrap().remove("aps_instance");},
                _=>observation["t"]=json!(0.025),
            }
            // Bypass the pose-poor legacy fixture injector: these are deliberately
            // unbound/out-of-order observations, never valid request metadata.
            unrelated.extend(rejected.handle(rejected_id,serde_json::from_value(json!({"t":"state","s":observation})).unwrap(),0.075));
            poisoned|=rejected.players[&rejected_id].aps_pose_valid||rejected.rooms[&rejected_room].world.as_ref().unwrap().aps_of(rejected_id).unwrap().enabled;
        }
        phases.insert("unrelated".into(),serde_json::to_value(unrelated).unwrap());
        let mut later=current.clone();later["t"]=json!(0.1);
        phases.insert("later_current".into(),serde_json::to_value(send(&mut rejected,rejected_id,json!({"t":"state","s":later.clone()}),0.1)).unwrap());
        phases.insert("later_snap".into(),serde_json::to_value(super::ammo_tests::broadcast_out(rejected.tick_at(0.15))).unwrap());
        assert_eq!(rejected.players[&rejected_id].ammo.as_ref().unwrap().counts,counts);
        scenarios.insert(format!("{vehicle}_{mode}"),json!({"vehicle":vehicle,"mode":mode,"owner":id,"before":before,"current":current,"bad":bad,"later":later,"current_valid":current_valid,"rejected_valid":rejected_valid,"poisoned":poisoned,"adopted":adopted,"counts":counts,"phases":phases}));
    }}json!(scenarios)
}

#[test]
fn aps_pose_current_encoder_parented_joint_quantization_is_admitted() {
    for s in actual_aps_quantization().as_object().unwrap().values() {
        assert_eq!(s["current_valid"],true,"actual six-step aimTurrets/State encoder movement is legal at the authored rate");
        let ack=s["phases"]["enable"].as_array().unwrap().iter().find(|e|e[0]==s["owner"]&&e[1]["t"]=="aps_pose").unwrap();
        assert_eq!(ack[1]["request_t"],s["current"]["t"]);assert_eq!(ack[1]["state_t"],s["current"]["t"]);
        assert!(s["adopted"]["enabled"].as_bool().unwrap());
        assert!((s["adopted"]["yaw"].as_f64().unwrap()-s["current"]["tur"][1][0].as_f64().unwrap()).abs()<1e-12);
        assert_eq!(s["rejected_valid"],false);
        for phase in ["rejected_current","rejected_enable"] {assert!(s["phases"][phase].as_array().unwrap().iter().all(|e|e[1]["t"]!="aps_pose"));}
    }
}
#[test]
fn aps_pose_rejected_final_request_resumes_on_a_later_trusted_current_state() {
    for s in actual_aps_quantization().as_object().unwrap().values() {
        assert_eq!(s["poisoned"],false,"wrong-life, wrong-instance, unrelated and stale State cannot poison or satisfy a current request");
        let ack=s["phases"]["later_current"].as_array().unwrap().iter().find(|e|e[0]==s["owner"]&&e[1]["t"]=="aps_pose").expect("a later valid trusted State releases the pending request");
        assert_eq!(ack[1]["request_t"],s["bad"]["t"],"rejected final State remains the current request correlation rather than the previous accepted State");
        assert_eq!(ack[1]["state_t"],s["later"]["t"]);
    }
}

const APS_GYRO_OBSERVATIONS: &str = r#"[{"at":0,"ex":[1,0,0],"ez":[0,0,1],"tur":[[0,0],[0,0]]},{"at":0.05,"ex":[0.9994,0,-0.036],"ez":[0.036,0,0.9994],"tur":[[-0.032,0.0015],[-0.032,0]]},{"at":0.1,"ex":[0.9974,0,-0.0719],"ez":[0.0719,0,0.9974],"tur":[[-0.0738,0.0015],[-0.0738,0]]},{"at":0.15,"ex":[0.9942,0,-0.1078],"ez":[0.1078,0,0.9942],"tur":[[-0.1166,0.0015],[-0.1166,0]]},{"at":0.2,"ex":[0.9896,0,-0.1435],"ez":[0.1435,0,0.9896],"tur":[[-0.1553,0.0015],[-0.1553,0]]},{"at":0.25,"ex":[0.9838,0,-0.179],"ez":[0.179,0,0.9838],"tur":[[-0.1916,0.0015],[-0.1916,0]]},{"at":0.3,"ex":[0.9768,0,-0.2143],"ez":[0.2143,0,0.9768],"tur":[[-0.2275,0.0015],[-0.2275,0]]},{"at":0.35,"ex":[0.9684,0,-0.2493],"ez":[0.2493,0,0.9684],"tur":[[-0.2634,0.0015],[-0.2634,0]]},{"at":0.4,"ex":[0.9588,0,-0.284],"ez":[0.284,0,0.9588],"tur":[[-0.2994,0.0015],[-0.2994,0]]},{"at":0.45,"ex":[0.948,0,-0.3184],"ez":[0.3184,0,0.948],"tur":[[-0.3355,0.0015],[-0.3355,0]]},{"at":0.5,"ex":[0.9359,0,-0.3523],"ez":[0.3523,0,0.9359],"tur":[[-0.3715,0.0015],[-0.3715,0]]},{"at":0.55,"ex":[0.9226,0,-0.3857],"ez":[0.3857,0,0.9226],"tur":[[-0.4075,0.0015],[-0.4075,0]]},{"at":0.6,"ex":[0.9081,0,-0.4187],"ez":[0.4187,0,0.9081],"tur":[[-0.4435,0.0015],[-0.4435,0]]}]"#;

pub(super) fn actual_aps_gyro() -> Value {
    let inputs:Value=serde_json::from_str(APS_GYRO_OBSERVATIONS).unwrap();let mut scenarios=serde_json::Map::new();
    for vehicle in ["su_t10m","su_t10m_oplot23"] {for mode in ["historical","casual"] {
        let mut l=real_lobby();let (id,room)=sortie(&mut l,mode,vehicle);send(&mut l,id,json!({"t":"aps","enabled":false}),0.0);
        let scope=l.ammo_scope(id);let mut phases=serde_json::Map::new();let mut observations=Vec::new();
        for sample in inputs.as_array().unwrap().iter().skip(1) {
            let at=sample["at"].as_f64().unwrap();let state=json!({"pos":[0,0,0],"ex":sample["ex"],"ez":sample["ez"],"tur":sample["tur"],"t":at,"ammo_scope":scope,"aps_instance":"gun:1:0"});
            observations.extend(send(&mut l,id,json!({"t":"state","s":state}),at));
            assert!(l.players[&id].aps_pose_valid,"{vehicle}/{mode}: authentic stabilized motor {at} must be admitted");
            assert_eq!(l.players[&id].accepted_aps_pose.as_ref().unwrap().at,at);
        }
        phases.insert("observations".into(),serde_json::to_value(observations).unwrap());
        phases.insert("enable".into(),serde_json::to_value(send(&mut l,id,json!({"t":"aps","enabled":true}),0.6)).unwrap());
        phases.insert("snap".into(),serde_json::to_value(super::ammo_tests::broadcast_out(l.tick_at(0.65))).unwrap());
        let counts=l.players[&id].ammo.as_ref().unwrap().counts.clone();let mut bad=l.players[&id].state.clone().unwrap();bad["t"]=json!(0.651);bad["ex"]=json!([-1,0,0]);bad["ez"]=json!([0,0,-1]);
        bad["tur"][0][0]=json!(bad["tur"][0][0].as_f64().unwrap()+0.5);bad["tur"][1][0]=bad["tur"][0][0].clone();
        phases.insert("impossible_state".into(),serde_json::to_value(send(&mut l,id,json!({"t":"state","s":bad}),0.651)).unwrap());
        phases.insert("impossible_enable".into(),serde_json::to_value(send(&mut l,id,json!({"t":"aps","enabled":true}),0.651)).unwrap());
        assert!(!l.players[&id].aps_pose_valid&&!l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap().enabled,"raw hull turn cannot grant extra motor travel");assert_eq!(l.players[&id].ammo.as_ref().unwrap().counts,counts);
        let parent_drives=l.targets[vehicle].weapon_bindings["gun:0:0"].traverse.clone();assert!(!parent_drives.is_empty());
        for i in parent_drives {l.players.get_mut(&id).unwrap().combat.as_mut().unwrap().modules[i]=0.0;}
        let damage=tg_combat::caps(&l.targets[vehicle],l.players[&id].combat.as_ref().unwrap()).weapons["gun:0:0"].traverse_mult;assert!(damage<1.0);
        let last=inputs.as_array().unwrap().last().unwrap();let good=json!({"pos":[0,0,0],"ex":last["ex"],"ez":last["ez"],"tur":last["tur"],"t":1.0,"ammo_scope":scope,"aps_instance":"gun:1:0"});
        send(&mut l,id,json!({"t":"state","s":good.clone()}),1.0);assert!(l.players[&id].aps_pose_valid);send(&mut l,id,json!({"t":"aps","enabled":false}),1.0);
        let mut fast=good;fast["t"]=json!(1.05);fast["tur"][0][0]=json!(fast["tur"][0][0].as_f64().unwrap()+0.012);fast["tur"][1][0]=fast["tur"][0][0].clone();
        phases.insert("damaged_parent_state".into(),serde_json::to_value(send(&mut l,id,json!({"t":"state","s":fast}),1.05)).unwrap());
        phases.insert("damaged_parent_enable".into(),serde_json::to_value(send(&mut l,id,json!({"t":"aps","enabled":true}),1.05)).unwrap());
        assert!(!l.players[&id].aps_pose_valid&&!l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap().enabled,"the gyro bound must retain authentic parent damage");assert_eq!(l.players[&id].ammo.as_ref().unwrap().counts,counts);
        scenarios.insert(format!("{vehicle}_{mode}"),json!({"vehicle":vehicle,"mode":mode,"owner":id,"inputs":inputs,"phases":phases}));
    }}json!(scenarios)
}

#[test]
fn aps_pose_authentic_stabilized_parent_states_obey_actual_motor_and_damage_bounds() {actual_aps_gyro();}

pub(super) fn actual_aps_readiness() -> Value {
    let map:Value=serde_json::from_str(&std::fs::read_to_string(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/maps/coast/map.json")).unwrap()).unwrap();
    let spawn=&map["spawns"]["blue"][0];let heading=spawn["heading"].as_f64().unwrap();let rounded=|n:f64|(n*1e4).round()/1e4;
    let mut scenarios=serde_json::Map::new();
    for vehicle in ["su_t10m","su_t10m_oplot23"] {for mode in ["historical","casual"] {
        let mut l=super::ammo_tests::real_lobby();let (id,_)=l.connect();let mut phases=serde_json::Map::new();
        let mut record=|name:&str,out:Out|{phases.insert(name.into(),serde_json::to_value(out).unwrap());};
        record("welcome",send(&mut l,id,json!({"t":"hello","name":"ready","gameplay_rules_version":1}),0.0));
        record("create",send(&mut l,id,json!({"t":"create","name":"ready","map":"coast","max":8,"deploy":true,"gameplay_mode":mode,"gameplay_rules_version":1}),0.0));
        let room=l.players[&id].room.unwrap();record("start",send(&mut l,id,json!({"t":"start"}),0.0));
        record("deploy",send(&mut l,id,json!({"t":"deploy","vehicle":vehicle,"spawn":0}),0.0));
        let scope=l.ammo_scope(id);let state=json!({"pos":[spawn["x"],0,spawn["z"]],"ex":[rounded(heading.cos()),0,rounded(-heading.sin())],"ez":[rounded(heading.sin()),0,rounded(heading.cos())],"tur":[[0,0],[0,0]],"ammo_scope":scope,"aps_instance":"gun:1:0","t":0.01});
        record("pose",send(&mut l,id,json!({"t":"state","s":state.clone()}),0.01));record("enable",send(&mut l,id,json!({"t":"aps","enabled":true}),0.01));record("snap",super::ammo_tests::broadcast_out(l.tick_at(0.06)));
        assert!((l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap().yaw-heading).abs()<1e-4);
        record("leave",send(&mut l,id,json!({"t":"leave"}),0.1));drop(record);
        scenarios.insert(format!("{vehicle}_{mode}"),json!({"owner":id,"vehicle":vehicle,"mode":mode,"state":state,"phases":phases}));
    }}json!(scenarios)
}

#[test]
fn aps_pose_actual_warm_handlers_conserve_stock_and_thermal_state_across_handoffs() {actual_aps_handoffs();}

#[test]
fn aps_pose_rejected_observations_never_enable_or_grant() {
    for kind in ["nonfinite","wrong_life","wrong_instance","wrong_turret","arc","too_fast","parent_fast","stale","away","dead"] {
        let mut l=real_lobby();let (id,room)=sortie(&mut l,"historical","su_t10m");
        send(&mut l,id,json!({"t":"aps","enabled":false}),0.1);let scope=l.ammo_scope(id);
        let good=json!({"pos":[0,0,0],"ex":[1,0,0],"ez":[0,0,1],"tur":[[0,0],[0,0]],"ammo_scope":scope,"aps_instance":"gun:1:0","t":1.0});
        send(&mut l,id,json!({"t":"state","s":good.clone()}),1.0);
        let counts=l.players[&id].ammo.as_ref().unwrap().counts.clone();let mut bad=good.clone();bad["t"]=json!(1.001);
        match kind {"nonfinite"=>bad["tur"][1][0]=Value::Null,"wrong_life"=>bad["ammo_scope"]["life"]=json!(scope.life+1),
            "wrong_instance"=>bad["aps_instance"]=json!("gun:0:0"),"wrong_turret"=>bad["tur"]=json!([[0,0]]),
            "arc"=>bad["tur"][1][1]=json!(-0.3),"too_fast"=>{bad["tur"][1][0]=json!(0.5);bad["t"]=json!(1000000.0);},
            "parent_fast"=>bad["tur"]=json!([[0.5,0],[0.5,0]]),"stale"=>bad["t"]=json!(0.9),
            "away"=>{l.drop_link(id,1.001);},"dead"=>l.players.get_mut(&id).unwrap().alive=false,_=>unreachable!()}
        let state=send(&mut l,id,json!({"t":"state","s":bad}),1.001);
        let enabled=send(&mut l,id,json!({"t":"aps","enabled":true}),1.001);
        assert!(message(&state,id,"aps_pose").is_null() && message(&enabled,id,"aps_pose").is_null(),"{kind} cannot get a pose barrier");
        assert!(!l.rooms[&room].world.as_ref().unwrap().aps_of(id).unwrap().enabled,"{kind}");
        assert_eq!(l.players[&id].ammo.as_ref().unwrap().counts,counts,"{kind} grants nothing");
        assert!(l.players[&id].aps_desired_enabled,"rejection preserves requested U intent");
    }
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
        let now=l.now+0.05;send(&mut l,aps,json!({"t":"state","s":{"pos":[0,0,0]}}),now);
        for (_,msg) in l.tick_at(now) { if let ServerMsg::Snap{fired:rounds,..}=msg { fired |= !rounds.is_empty(); } }
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
    std::fs::write(path,serde_json::to_vec(&json!({"a":a,"b":b,"c":c,"phases":phases,"sources":sources,"aps_handoffs":actual_aps_handoffs(),"aps_readiness":actual_aps_readiness(),"aps_short":super::ammo_tests::actual_short_aps_receipts(),"aps_gyro":actual_aps_gyro(),"aps_suspensions":actual_aps_suspensions(),"aps_quantization":actual_aps_quantization()})).unwrap()).unwrap();
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
