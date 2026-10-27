//! Fuel intent admission and resources through the real Hub. These tests compile
//! against the old command schema so the first RED is a behavioral rejection.
use super::*;

fn data() -> std::path::PathBuf { Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data") }
fn accepted(out: Vec<(u32, Update)>) { assert!(!out.iter().any(|(_,u)| matches!(u,Update::Error{..})),"{out:?}"); }
fn setup() -> FrontlineHub {
    let mut h=FrontlineHub::new(&data()).unwrap();h.use_c2_test_scene().unwrap();
    accepted(h.handle(1,Command::Create{name:"Fuel choice".into(),map:"korea".into(),observer:true,era:1976},0.0));
    accepted(h.handle(2,Command::Join{room:1,observer:false,team:Some(Team::Blue)},0.0));
    accepted(h.handle(1,Command::Start,0.0));h
}
fn command(value: Value) -> Command { serde_json::from_value(value).expect("The optional fixed fuel intent must be admitted") }
fn view(h:&FrontlineHub) -> crate::frontline_air::AirUnitView { h.rooms[&1].air.views().into_iter().find(|u|u.owner==Some(2)).unwrap() }
fn deploy(h:&mut FrontlineHub,minutes:Value) {
    accepted(h.handle(2,command(json!({"op":"deploy_air","aircraft":"f86f","spawn":"runway","loadout":0,"fuel_minutes":minutes})),0.0));
}
fn profile() -> crate::frontline_air::AirProfile {
    let value:Value=serde_json::from_slice(&std::fs::read(data().join("aircraft/frontline.json")).unwrap()).unwrap();
    serde_json::from_value(value["aircraft"]["f86f"].clone()).unwrap()
}
fn native_steps(h:&mut FrontlineHub,count:usize) -> Vec<crate::frontline_sim::SimEvent> {
    let room=h.rooms.get_mut(&1).unwrap();let mut events=Vec::new();
    for _ in 0..count { events.extend(room.air.step(1.0/120.0,&mut room.sim)); }
    events
}

#[test]
fn fuel_minutes_protocol_accepts_only_fixed_integer_choices_and_full() {
    for value in [json!(10),json!(20),json!(30),json!(45),Value::Null] {
        command(json!({"op":"deploy_air","aircraft":"f86f","spawn":"air","loadout":0,"fuel_minutes":value}));
        command(json!({"op":"service_air","unit":{"battle":1,"unit":1,"life":1},"epoch":1,"seq":1,"loadout":0,"fuel_minutes":value}));
    }
    for value in [json!(0),json!(15),json!(-10),json!(10.5),json!("10"),json!(true),json!({})] {
        assert!(serde_json::from_value::<Command>(json!({"op":"deploy_air","aircraft":"f86f","spawn":"air","loadout":0,"fuel_minutes":value})).is_err(),"{value}");
    }
    command(json!({"op":"deploy_air","aircraft":"f86f","spawn":"air","loadout":0}));
}

#[test]
fn native_fuel_choice_is_real_internal_stock_and_loaded_airframe_mass() {
    let p=profile();
    for minutes in [10,20,30,45] {
        let mut h=setup();deploy(&mut h,json!(minutes));let u=view(&h);
        let expected=(minutes as f64*60.0*crate::frontline_air::fuel_flow(&p,1.0)).min(p.fuel.capacity);
        assert_eq!(u.fuel["kg"],json!(expected));assert_eq!(u.fuel["max"],json!(p.fuel.capacity));assert_eq!(u.fuel["selected_minutes"],minutes);
        assert!((u.flight.airframe[0]-(p.physics.airframe[0]-(p.fuel.capacity-expected)as f32)).abs()<0.001);
    }
    let mut h=setup();deploy(&mut h,Value::Null);assert_eq!(view(&h).fuel["kg"],json!(p.fuel.capacity));
}

#[test]
fn native_fuel_retake_ignores_replacement_intent_and_keeps_same_life_inventory() {
    let mut h=setup();deploy(&mut h,json!(10));let before=view(&h);
    accepted(h.handle(2,Command::Return,0.0));deploy(&mut h,json!(45));let after=view(&h);
    assert_eq!(after.unit,before.unit);assert_eq!(after.fuel,before.fuel);assert_eq!(after.stores,before.stores);assert_eq!(after.resource_revision,before.resource_revision);
}

#[test]
fn native_fuel_service_stages_selected_target_without_partial_grant_or_duplicate_rewind() {
    let mut h=setup();deploy(&mut h,json!(10));let before=view(&h);let epoch=h.rooms[&1].members[&2].view.epoch;
    let request=|minutes|command(json!({"op":"service_air","unit":before.unit,"epoch":epoch,"seq":minutes,"loadout":0,"fuel_minutes":minutes}));
    accepted(h.handle(2,request(20),0.0));let staged=view(&h);assert_eq!(staged.fuel,before.fuel);assert_eq!(staged.service.status,"servicing");
    let service=serde_json::to_value(&staged.service).unwrap();assert_eq!(service["fuel_minutes"],20);assert_eq!(service["elapsed_s"],0.0);
    let out=h.handle(2,request(30),0.0);assert!(out.iter().any(|(_,u)|matches!(u,Update::Error{code,..}if code=="service_rejected")));
    assert_eq!(view(&h).fuel,before.fuel);
}

#[test]
fn native_fuel_options_advertise_actual_source_full_throttle_consumption_without_profile_rewrite() {
    let h=setup();let options=serde_json::to_value(h.rooms[&1].air.options(1976)).unwrap();let option=options.as_array().unwrap().iter().find(|a|a["id"]=="f86f").unwrap();let p=profile();
    assert_eq!(option["fuel_load"]["version"],1);assert_eq!(option["fuel_load"]["minutes"],json!([10,20,30,45]));assert_eq!(option["fuel_load"]["capacity_kg"],json!(p.fuel.capacity));assert_eq!(option["fuel_load"]["reference_throttle"],1.0);assert_eq!(option["fuel_load"]["nominal_flow_kg_s"],json!(crate::frontline_air::fuel_flow(&p,1.0)));
}

#[test]
fn native_fuel_service_completes_selected_target_once_after_fifteen_native_seconds() {
    let mut h=setup();deploy(&mut h,json!(10));let before=view(&h);let epoch=h.rooms[&1].members[&2].view.epoch;
    accepted(h.handle(2,command(json!({"op":"service_air","unit":before.unit,"epoch":epoch,"seq":1,"loadout":0,"fuel_minutes":20})),0.0));
    assert!(native_steps(&mut h,1799).iter().all(|e|e.kind!="air_service_complete"));
    let waiting=view(&h);assert_eq!(waiting.fuel,before.fuel);assert_eq!(waiting.resource_revision,before.resource_revision);
    assert!(waiting.service.elapsed_s>14.99&&waiting.service.remaining_s>0.0);
    let events=native_steps(&mut h,1);assert_eq!(events.iter().filter(|e|e.kind=="air_service_complete").count(),1);
    let complete=view(&h);let p=profile();let target=(20.0*60.0*crate::frontline_air::fuel_flow(&p,1.0)).min(p.fuel.capacity);
    assert_eq!(complete.unit,before.unit);assert_eq!(complete.fuel["kg"],json!(target));assert_eq!(complete.fuel["max"],json!(p.fuel.capacity));
    assert_eq!(complete.fuel["selected_minutes"],20);assert_eq!(complete.resource_revision,before.resource_revision+1);assert_eq!(complete.service.status,"complete");
    assert!((complete.flight.airframe[0]-(p.physics.airframe[0]-(p.fuel.capacity-target)as f32)).abs()<0.001);
    assert!((complete.state[23]-before.state[23]-15.0).abs()<0.002,"Service keeps the same native plant clock");
    assert!(native_steps(&mut h,3).iter().all(|e|e.kind!="air_service_complete"));assert_eq!(view(&h).fuel,complete.fuel);
    assert_eq!(view(&h).resource_revision,complete.resource_revision);
}

#[test]
fn native_fuel_cancel_discards_pending_choice_without_refilling_or_changing_selection() {
    let mut h=setup();deploy(&mut h,json!(10));let before=view(&h);let epoch=h.rooms[&1].members[&2].view.epoch;
    accepted(h.handle(2,command(json!({"op":"service_air","unit":before.unit,"epoch":epoch,"seq":1,"loadout":0,"fuel_minutes":45})),0.0));
    native_steps(&mut h,120);
    accepted(h.handle(2,Command::CancelAirService{unit:before.unit,epoch,seq:2},1.0));
    let cancelled=view(&h);assert_eq!(cancelled.service.status,"cancelled");assert_eq!(cancelled.fuel,before.fuel);assert_eq!(cancelled.resource_revision,before.resource_revision);
    native_steps(&mut h,1800);let after=view(&h);assert_eq!(after.fuel,before.fuel);assert_eq!(after.resource_revision,before.resource_revision);
}

#[test]
fn native_fuel_selected_stock_burns_by_actual_engine_throttle_and_the_existing_source_law() {
    let p=profile();let mut outcomes=Vec::new();
    for throttle in [0.2,1.0] {
        let mut h=setup();accepted(h.handle(2,command(json!({"op":"deploy_air","aircraft":"f86f","spawn":"air","loadout":0,"fuel_minutes":10})),0.0));
        let initial=view(&h);let epoch=h.rooms[&1].members[&2].view.epoch;
        for seq in 1..=60 {
            let before=view(&h);let now=(seq-1)as f64/120.0;
            accepted(h.handle(2,Command::AirInput{unit:before.unit,epoch,seq,aim:[before.state[48],before.state[49],before.state[50]],throttle,manual_pitch:0.0,manual_roll:0.0,manual_yaw:0.0,flags:1,fire:false,release:false},now));
            native_steps(&mut h,1);let after=view(&h);assert!(after.alive);
            let flow=crate::frontline_air::fuel_flow(&p,after.state[27]as f64);assert_eq!(after.fuel["flow"],json!(flow));
            let burned=before.fuel["kg"].as_f64().unwrap()-after.fuel["kg"].as_f64().unwrap();assert!((burned-flow/120.0).abs()<1e-9);
            assert_eq!(after.fuel["max"],initial.fuel["max"]);assert_eq!(after.fuel["selected_minutes"],10);
        }
        let after=view(&h);outcomes.push((initial.fuel["kg"].as_f64().unwrap()-after.fuel["kg"].as_f64().unwrap(),after.state[27]));
    }
    assert!(outcomes[1].0>outcomes[0].0&&outcomes[1].1>outcomes[0].1,"Higher actual engine throttle consumes more of the same selected stock: {outcomes:?}");
}
