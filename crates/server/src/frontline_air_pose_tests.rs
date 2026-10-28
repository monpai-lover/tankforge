//! Local flight changes movement, never accepted ammunition/damage/ownership.
use super::*;
use crate::frontline_air::AirUnitView;

struct Fixture { hub: FrontlineHub, unit: UnitRef, epoch: u64 }
impl Fixture {
    fn new() -> Self {
        let data=Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let mut hub=FrontlineHub::new(&data).unwrap();
        for (player,command) in [
            (1,Command::Create{name:"Local flight pose".into(),map:"taiwan".into(),observer:true,era:2022}),
            (2,Command::Join{room:1,observer:false,team:Some(Team::Blue)}),
            (1,Command::Start),
            (2,Command::DeployAir{ custom_counts: None,aircraft:"me262".into(),spawn:"air".into(),loadout:0,custom:None, fuel_minutes: None})
        ] { let out=hub.handle(player,command,0.0);assert!(!out.iter().any(|(_,u)|matches!(u,Update::Error{..})),"{out:?}"); }
        let member=&hub.rooms[&1].members[&2].view;
        Self{unit:member.controlled.unwrap(),epoch:member.epoch,hub}
    }
    fn view(&self)->AirUnitView {self.hub.rooms[&1].air.views().into_iter().find(|u|u.unit==self.unit).unwrap()}
    fn proposal(&self,seq:u64,dt:f32)->Value {
        let s=self.view().state;
        json!({"op":"air_pose","unit":self.unit,"epoch":self.epoch,"seq":seq,"pose":{
            "position":[s[0]+s[7]*dt,s[1]+s[8]*dt,s[2]+s[9]*dt],
            "quaternion":[s[3],s[4],s[5],s[6]],"velocity":[s[7],s[8],s[9]],
            "angular_velocity":[s[10],s[11],s[12]],"sample_time_s":s[23]+dt}})
    }
    fn send(&mut self,player:u32,value:Value,now:f64)->Vec<(u32,Update)> {
        let command:Command=serde_json::from_value(value).expect("native protocol must admit scoped local flight pose");
        self.hub.handle(player,command,now)
    }
}
fn rejected(out:&[(u32,Update)])->bool {out.iter().any(|(_,u)|matches!(u,Update::Error{..}))}

#[test]
fn air_pose_accepts_local_motion_without_mutating_native_resources() {
    let mut f=Fixture::new();let before=f.view();let value=f.proposal(1,0.05);let proposed=value["pose"]["position"].as_array().unwrap().iter().map(|x|x.as_f64().unwrap()).collect::<Vec<_>>();
    let out=f.send(2,value,0.05);assert!(!rejected(&out),"{out:?}");let after=f.view();
    for i in 0..3 {assert!((after.state[i] as f64-proposed[i]).abs()<0.01);}
    assert_eq!(after.unit,before.unit);let a=serde_json::to_value(&after).unwrap();let b=serde_json::to_value(&before).unwrap();
    for field in ["guns","stores","fuel","damage","airframe_limits"]{assert_eq!(a[field],b[field],"pose cannot mutate {field}");}
    assert!(out.iter().any(|(_,u)|serde_json::to_value(u).unwrap()["op"]=="air_pose_accepted"));
}
#[test]
fn air_pose_rejects_foreign_owner_epoch_life_and_battle_without_moving_actor() {
    let mut f=Fixture::new();let before=f.view();
    for (player,field,value) in [(1,"epoch",json!(f.epoch)),(2,"epoch",json!(f.epoch+1)),(2,"battle",json!(f.unit.battle+1)),(2,"life",json!(f.unit.life+1))] {
        let mut p=f.proposal(1,0.05);if field=="epoch"{p["epoch"]=value}else{p["unit"][field]=value;}
        assert!(rejected(&f.send(player,p,0.05)));assert_eq!(f.view().state,before.state);
    }
}
#[test]
fn air_pose_rejects_teleport_velocity_and_invalid_rotation_atomically() {
    let mut f=Fixture::new();let before=f.view();
    for (field,value) in [("position",json!([1e6,2000,1e6])),("velocity",json!([0,0,10000])),("quaternion",json!([0,0,0,0])),("angular_velocity",json!([20,0,0]))] {
        let mut p=f.proposal(1,0.05);p["pose"][field]=value;let out=f.send(2,p,0.05);assert!(rejected(&out));
        assert!(out.iter().any(|(_,u)|matches!(u,Update::Snapshot{..})),"rejected motion must provide a native rebase");assert_eq!(f.view().state,before.state);
    }
}
#[test]
fn air_pose_rejects_stale_sequences_and_client_time_jumps() {
    let mut f=Fixture::new();let accepted=f.proposal(1,0.05);assert!(!rejected(&f.send(2,accepted.clone(),0.05)));let before=f.view();
    assert!(rejected(&f.send(2,accepted,0.1)));let mut jump=f.proposal(2,0.05);jump["pose"]["sample_time_s"]=json!(1000.0);assert!(rejected(&f.send(2,jump,0.1)));assert_eq!(f.view().state,before.state);
}
#[test]
fn air_pose_cannot_move_below_native_terrain_or_after_returned_control() {
    let mut f=Fixture::new();let before=f.view();let mut below=f.proposal(1,0.05);below["pose"]["position"][1]=json!(-10000.0);assert!(rejected(&f.send(2,below,0.05)));assert_eq!(f.view().state,before.state);
    f.hub.leave(2);let old=f.proposal(2,0.1);assert!(rejected(&f.send(2,old,0.1)));
}
#[test]
fn air_pose_delayed_initial_snapshot_is_admitted_even_after_input_heartbeat() {
    let mut f=Fixture::new();let delayed=f.proposal(2,0.05);
    for k in 1..=6 {f.hub.tick(k as f64*STEP+1e-8);}
    let input:Command=serde_json::from_value(json!({"op":"air_input","unit":f.unit,"epoch":f.epoch,"seq":1,"aim":[0,0,1],"throttle":0.78,"manual_pitch":0,"manual_roll":0,"manual_yaw":0,"flags":1,"fire":false,"release":false})).unwrap();
    f.hub.handle(2,input,0.29);
    let out=f.send(2,delayed,0.30);assert!(!rejected(&out),"bounded initial network lag must not strand local flight: {out:?}");
}
#[test]
fn air_pose_pause_recovery_accepts_a_reseed_near_the_current_native_predictor() {
    let mut f=Fixture::new();let first=f.proposal(1,0.05);assert!(!rejected(&f.send(2,first,0.05)));
    for k in 1..=24 {f.hub.tick(k as f64*STEP+1e-8);}
    let reseed=f.proposal(2,0.05);let out=f.send(2,reseed,1.25);assert!(!rejected(&out),"a fresh bounded native rebase must recover after a pause: {out:?}");
}
