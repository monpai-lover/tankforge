use super::*;
use serde_json::json;

fn config(rear:bool,rate:f64)->Config {
    Config::from_store(&json!({"kind":"aam","guidance":"ir","rear":rear,"mass":105,"d":0.17,"tailFins":0.51,
        "burn":4.5,"dv":800,"lockRange":10000,"fov":25,"gimbal":90,"maxG":40,"life":60,"fuse":8,
        "seeker":{"trackRate":rate,"memory":0.4,"reacquire":0.0}})).unwrap()
}
fn target(pos:[f64;3],velocity:[f64;3])->Target {
    Target{reference:UnitRef{battle:1,unit:2,life:1},team:1,air:true,alive:true,pos,velocity,
        emitting:false,jam_search:0.0,jam_track:0.0}
}
#[test]
fn low_dynamic_pressure_does_not_grant_full_catalog_g() {
    let t=target([100.0,1000.0,100.0],[0.0,0.0,-100.0]);
    let mut m=Missile::launch(config(false,0.0),"r73".into(),t.reference,t);
    let a=m.acceleration([0.0,1000.0,0.0],[0.0,0.0,100.0],0.1,Some(t),true,true);
    let rho=1.225f64*(-1000.0f64/8500.0).exp();let cap=40.0*9.80665*(0.5*rho*100.0f64.powi(2)/60000.0);
    assert!(length(a)<=cap+1e-8,"available aerodynamic control must follow dynamic pressure: {} > {cap}",length(a));
}
#[test]
fn rear_aspect_is_not_lost_as_a_requirement_after_launch() {
    let t=target([0.0,1000.0,1000.0],[0.0,0.0,-200.0]);
    let mut m=Missile::launch(config(true,0.0),"aim9b".into(),t.reference,t);
    m.acceleration([0.0,1000.0,0.0],[0.0,0.0,500.0],0.1,Some(t),true,true);
    assert_eq!(m.last_seen_age,0.0,"front aspect must not refresh an early IR seeker after launch");
}
#[test]
fn catalog_angular_tracking_rate_is_enforced_after_launch() {
    let t=target([0.0,1000.0,1000.0],[300.0,0.0,0.0]);
    let mut m=Missile::launch(config(false,5.0),"fixture".into(),t.reference,t);
    m.acceleration([0.0,1000.0,0.0],[0.0,0.0,500.0],0.1,Some(t),true,true);
    assert_eq!(m.last_seen_age,0.0,"out-of-rate observation must not overwrite the last accepted estimate");
}
#[test]
fn maneuver_drag_is_finite_and_charges_accepted_turn_force() {
    let t=target([0.0,1000.0,1000.0],[0.0,0.0,200.0]);
    let m=Missile::launch(config(false,0.0),"r73".into(),t.reference,t);
    let p=[0.0,1000.0,0.0];let v=[0.0,0.0,500.0];
    assert_eq!(m.maneuver_drag(p,v,[0.0;3],10.0),0.0);
    let support=m.maneuver_drag(p,v,[0.0,9.80665,0.0],10.0);
    let hard=m.maneuver_drag(p,v,[200.0,9.80665,0.0],10.0);
    assert!(hard.is_finite()&&hard>support&&support>0.0);
    assert_eq!(m.maneuver_drag(p,[0.0;3],[200.0,0.0,0.0],10.0),0.0);
}
#[test]
fn invalid_observation_expires_after_bounded_catalog_reacquisition() {
    let t=target([0.0,1000.0,1000.0],[300.0,0.0,0.0]);
    let mut c=config(false,5.0);c.reacquire=2.0;
    let mut m=Missile::launch(c,"fixture".into(),t.reference,t);
    m.acceleration([0.0,1000.0,0.0],[0.0,0.0,500.0],1.0,Some(t),true,true);
    assert!(!m.lost);assert_eq!(m.last_seen_age,0.0);
    m.acceleration([0.0,1000.0,0.0],[0.0,0.0,500.0],2.5,Some(t),true,true);
    assert!(m.lost);assert_eq!(m.phase,"lost");
}
#[test]
fn known_tvc_is_motor_bounded_and_burnout_removes_vector_force() {
    let t=target([0.0,0.0,1000.0],[0.0,0.0,200.0]);
    let mut c=config(false,0.0);c.thrust_vector=true;c.motor_accel=160.0;c.motor_burn=5.0;c.max_g=50.0;c.mass=85.0;c.span=0.45;
    let m=Missile::launch(c,"aim9x".into(),t.reference,t);let p=[0.0;3];let v=[0.0;3];
    assert!((m.available_control_g(p,v,1.0)-32.0/9.80665).abs()<1e-10);
    assert_eq!(m.available_control_g(p,v,5.0),0.0);
    let diverted=m.maneuver_drag(p,v,[32.0,0.0,0.0],1.0);
    assert!((diverted-(160.0f64-(160.0f64.powi(2)-32.0f64.powi(2)).sqrt())).abs()<1e-10);
    assert!(m.available_control_g(p,[0.0,0.0,2000.0],1.0)<=50.0);
}
#[test]
fn native_budget_matches_shared_browser_golden_fixtures() {
    let fixtures:serde_json::Value=serde_json::from_str(include_str!("../../../handoff/qa/aam-budget-fixtures-20261027.json")).unwrap();
    for f in fixtures.as_array().unwrap(){
        let c=Config::from_store(&f["def"]).unwrap();let t=target([0.0,0.0,1000.0],[0.0;3]);
        let m=Missile::launch(c,"fixture".into(),t.reference,t);let p=[0.0,f["altitude"].as_f64().unwrap(),0.0];let v=[0.0,0.0,f["speed"].as_f64().unwrap()];let age=f["age"].as_f64().unwrap();
        let available=m.available_control_g(p,v,age);let normal=200.0f64.min(available*9.80665);
        assert!((available-f["availableG"].as_f64().unwrap()).abs()<1e-9,"{} force",f["name"]);
        assert!((normal-f["normalAcceleration"].as_f64().unwrap()).abs()<1e-9,"{} acceleration",f["name"]);
        assert!((m.maneuver_drag(p,v,[normal,0.0,0.0],age)-f["dragAcceleration"].as_f64().unwrap()).abs()<1e-9,"{} energy",f["name"]);
    }
}
