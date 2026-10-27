//! Real C214 native-world acceptance. No client telemetry or invented actuator.
use super::*;
use crate::flight_runtime::FlightSpawn;
use std::sync::OnceLock;

const ID: u64 = 71;
const DT: f64 = 1.0 / 120.0;
fn fixture(speed: f32) -> (AirWorld, SimWorld) {
    let data=Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let map:Value=serde_json::from_slice(&std::fs::read(data.join("frontline/korea.json")).unwrap()).unwrap();
    static TEMPLATE:OnceLock<Arc<AirTemplate>>=OnceLock::new();
    let template=TEMPLATE.get_or_init(||AirTemplate::load(&data).unwrap());
    let ground=SimWorld::load(&data,&map).unwrap();
    let mut air=template.world(Arc::new(ground.ground.clone()),map);
    air.spawn(UnitRef{battle:9,unit:ID,life:1},"nf01",Team::Blue,Some(7),"air",0).unwrap();
    air.test_spawn_at(ID,FlightSpawn{position:[0.0,2000.0,0.0],heading:0.0,airspeed:speed,on_ground:false});
    let u=air.units.get_mut(&ID).unwrap();u.controller=Some(7);
    u.input=AirInput{aim:[0.0,0.0,1.0],throttle:0.7,manual_pitch:0.0,manual_roll:0.0,manual_yaw:0.0,flags:1,fire:false,release:false};
    (air,ground)
}
fn view(air:&AirWorld)->Value {serde_json::to_value(air.units[&ID].view()).unwrap()}
fn advance(air:&mut AirWorld,ground:&mut SimWorld,steps:usize,gear:bool) {
    for _ in 0..steps {
        let now=air.time;
        let mut input=air.units[&ID].input.clone();input.flags=if gear {1|4}else{1};
        if air.units[&ID].alive(){air.accept_input(ID,input,now).unwrap();}
        ground.step_combined(DT,air);
    }
}

#[test]
fn native_airframe_limits_exposed_gear_blows_off_and_public_pose_reports_failure_without_hp() {
    let (mut air,mut ground)=fixture(220.0);
    advance(&mut air,&mut ground,720,true);
    let snapshot=view(&air);
    assert_eq!(snapshot["airframe_limits"]["gear_failed"],true,"Real extended-gear wind exposure must fail gear");
    assert_eq!(snapshot["state"][33],0.0,"Failed gear support is removed immediately in accepted kernel telemetry");
    let public=serde_json::to_value(crate::frontline_perception::project_air(&air.units[&ID].view()).unwrap()).unwrap();
    assert_eq!(public["gear_failed"],true);assert!(public.get("airframe_limits").is_none());
    assert!(public.get("structure_fraction").is_none());assert!(air.units[&ID].alive());
    let before=snapshot["airframe_limits"].clone();
    air.units.get_mut(&ID).unwrap().configure_mass().unwrap();
    advance(&mut air,&mut ground,120,true);
    assert_eq!(view(&air)["airframe_limits"]["gear_failed"],true);
    assert_eq!(view(&air)["state"][33],0.0,"Reconfiguration and pilot gear intent cannot repair the latch");
    assert_eq!(before["gear_fraction"],view(&air)["airframe_limits"]["gear_fraction"]);
}

#[test]
fn native_airframe_limits_retracted_gear_has_no_wind_damage_and_constant_wing_hp() {
    let (mut air,mut ground)=fixture(200.0);let damage=air.units[&ID].damage.snapshot();
    advance(&mut air,&mut ground,720,false);
    let snapshot=view(&air);
    assert_eq!(snapshot["airframe_limits"]["gear_failed"],false);
    assert_eq!(snapshot["airframe_limits"]["gear_fraction"],0.0);
    assert_eq!(snapshot["damage"],{let mut d=damage;for key in ["part_ids","part_max_hp","visual_aliases"]{d[key]=snapshot["damage"][key].clone();}d});
}

#[test]
fn native_airframe_limits_severe_real_impulse_detaches_original_wings_once_without_fire() {
    let (mut air,mut ground)=fixture(200.0);
    {let u=air.units.get_mut(&ID).unwrap();for _ in 0..90 {u.runtime.impulse([0.0,0.0,5.0],[0.0;3]).unwrap();}}
    advance(&mut air,&mut ground,240,false);
    let u=&air.units[&ID];
    assert!(u.damage.gone("wing_l")&&u.damage.gone("wing_r"),
        "Overspeed must use existing native wing damage/detachment: {}",serde_json::to_value(u.view()).unwrap());
    assert!(u.damage.broken);assert!(!u.alive());assert_eq!(u.damage.fire,0.0);
    let revision=u.damage.revision;
    advance(&mut air,&mut ground,60,false);assert_eq!(air.units[&ID].damage.revision,revision,"Already failed structure cannot fail repeatedly");
}

#[test]
fn native_airframe_limits_only_completed_airport_service_clears_accumulated_load() {
    let (mut air,mut ground)=fixture(220.0);
    advance(&mut air,&mut ground,60,true);
    let before=view(&air)["airframe_limits"].clone();
    assert!(before["gear_fraction"].as_f64().unwrap_or(0.0)>0.0);
    assert_eq!(before["gear_failed"],false,"This surviving partial-load fixture can still land for service");
    let runway=air.map["airfields"].as_array().unwrap().iter().find(|f|f["enabled"]==true&&f["team"]==0).unwrap()["runway"].clone();
    let center=runway["center"].as_array().unwrap();let x=center[0].as_f64().unwrap();let z=center[1].as_f64().unwrap();
    air.test_spawn_at(ID,FlightSpawn{position:[x as f32,0.0,z as f32],heading:0.0,airspeed:0.0,on_ground:true});
    {let u=air.units.get_mut(&ID).unwrap();u.input=service_hold_input(&u.state);}
    air.request_service(ID,0,air.time).unwrap();
    for _ in 0..600 {let u=air.units.get_mut(&ID).unwrap();u.last_input=air.time;ground.step_combined(DT,&mut air);}
    assert_eq!(view(&air)["airframe_limits"],before,"An incomplete service clock never repairs wind-load state");
    for _ in 0..1260 {let u=air.units.get_mut(&ID).unwrap();u.last_input=air.time;ground.step_combined(DT,&mut air);}
    let after=view(&air);assert_eq!(after["service"]["status"],"complete");
    assert_eq!(after["airframe_limits"]["gear_fraction"],0.0);assert_eq!(after["airframe_limits"]["structure_fraction"],0.0);
    assert_eq!(after["airframe_limits"]["gear_failed"],false);
}

#[test]
fn native_airframe_limits_forged_client_failure_or_repair_fields_cannot_mutate_accepted_state() {
    let (mut air,mut ground)=fixture(220.0);advance(&mut air,&mut ground,720,true);
    let before=view(&air);assert_eq!(before["airframe_limits"]["gear_failed"],true);
    let input:AirInput=serde_json::from_value(json!({"aim":[0,0,1],"throttle":0.5,"manual_pitch":0,"manual_roll":0,"manual_yaw":0,
        "flags":5,"fire":false,"release":false,"gear_failed":false,"airframe_limits":{"structure_fraction":0,"gear_fraction":0,"gear_failed":false},"damage":{"parts":[]}})).unwrap();
    air.accept_input(ID,input,air.time).unwrap();
    assert_eq!(view(&air)["airframe_limits"],before["airframe_limits"]);assert_eq!(view(&air)["damage"],before["damage"]);
}
