//! Retain actual admission/world segments. This does not certify absent P5 cannon flight.
use super::*;
use tg_combat::replay_evidence::{ReplayActor,ReplayDischarge,ReplayPose};

pub(super) fn actor(p:&Player)->Option<ReplayActor> {
    let scope=p.ammo.as_ref()?.scope;
    Some(ReplayActor{battle:scope.battle,entity:p.id,life:scope.life})
}
pub(super) fn discharge(p:&mut Player,instance:String,projectile_id:String,seq:u32,now:f64,o:[f64;3],d:[f64;3])->ReplayDischarge {
    p.replay_discharge_serial+=1;
    let shooter=actor(p).expect("accepted discharge requires admitted ammunition scope");
    ReplayDischarge{flight_compacted_count:0,segment_compacted_count:0,travelled_distance_m:0.0,shot_id:format!("{}:{}:{}:{}",shooter.battle,shooter.entity,shooter.life,p.replay_discharge_serial),shooter,weapon_instance:instance,projectile_id,seed:shot_seed(p.id,seq).to_string(),launch_time_s:now,origin:o,direction:d,flight:Vec::new(),segments:Vec::new(),flight_trust:"unknown_cannon_flight".into()}
}
pub(super) fn pose(p:&Player)->Option<ReplayPose> {
    let s=p.state.as_ref()?;let ps=crate::missiles::pose_of(s)?;
    Some(ReplayPose{trust:"legacy_receipt_pose".into(),hull_origin:ps.pos,ex:ps.ex,ey:ps.ey,ez:ps.ez,
        joints:s["tur"].as_array().cloned().unwrap_or_default(),running_gear:Vec::new(),payload:Vec::new(),variants:Vec::new()})
}
