//! Serializable evidence, independent of render objects and admission generation.
use serde::{Deserialize,Serialize};
use serde_json::Value;
use crate::causes::{ActiveCause,CauseTransition};

pub const MAX_SAFE_COUNTER:u64=9_007_199_254_740_991;
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
pub struct ReplayActor {pub battle:u64,pub entity:u32,pub life:u64}
impl ReplayActor {pub fn valid(&self)->bool {self.battle>0&&self.life>0&&self.entity>0&&self.battle<=MAX_SAFE_COUNTER&&self.life<=MAX_SAFE_COUNTER}}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq)]
pub struct ReplayPose {
    pub trust:String,pub hull_origin:[f64;3],pub ex:[f64;3],pub ey:[f64;3],pub ez:[f64;3],
    pub joints:Vec<Value>,pub running_gear:Vec<Value>,pub payload:Vec<Value>,pub variants:Vec<Value>,
    #[serde(default)] pub geometry_instances:Vec<(String,[f64;16])>,
}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq)]
pub struct FlightSample {pub time_s:f64,pub position:[f64;3],pub velocity_m_s:[f64;3]}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq)]
pub struct FlightSegment {pub start_time_s:f64,pub end_time_s:f64,pub from:[f64;3],pub to:[f64;3]}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq)]
pub struct ReplayDischarge {
    pub shooter:ReplayActor,pub shot_id:String,pub weapon_instance:String,pub projectile_id:String,pub seed:String,
    pub launch_time_s:f64,pub origin:[f64;3],pub direction:[f64;3],pub flight:Vec<FlightSample>,pub segments:Vec<FlightSegment>,pub flight_trust:String,
    #[serde(default)] pub flight_compacted_count:u64,#[serde(default)] pub segment_compacted_count:u64,#[serde(default)] pub travelled_distance_m:f64,
}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq)]
pub struct ReplayDeath {
    pub event_id:String,pub commit_seq:u64,pub time_s:f64,pub mechanism_id:String,pub cause_event_id:String,pub reason:String,
    pub state_before_version:u64,pub state_after_version:u64,pub state_after:Value,pub caps_after:Value,pub accepted_terminal_pose:Option<ReplayPose>,
}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq)]
pub struct MechanismRecord {
    pub event_id:String,pub commit_seq:u64,pub time_s:f64,pub dt_s:f64,pub state_before_version:u64,pub state_after_version:u64,
    pub state_before:Value,pub state_after:Value,pub events:Vec<String>,pub transitions:Vec<CauseTransition>,
}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq)]
pub struct ReplayEvidence {
    pub authority:String,
    pub revision:u32,pub actor:ReplayActor,pub shooter:ReplayActor,pub event_id:String,pub commit_seq:u64,pub shot_id:String,
    pub parent_mechanism_id:Option<String>,pub weapon_instance:String,pub projectile_id:String,pub seed:String,
    pub build_hash:String,pub anatomy_hash:String,pub pose_revision:u64,pub geometry_revision:u64,
    pub state_before_version:u64,pub state_after_version:u64,pub state_before:Value,pub launch_time_s:f64,pub impact_time_s:f64,
    pub coordinates:String,pub accepted_pose:ReplayPose,pub flight:Vec<FlightSample>,pub segments:Vec<FlightSegment>,pub flight_trust:String,
    pub report:Value,pub deaths:Vec<ReplayDeath>,pub mechanism_records:Vec<MechanismRecord>,pub capabilities:Vec<String>,
    #[serde(default)] pub flight_compacted_count:u64,#[serde(default)] pub segment_compacted_count:u64,#[serde(default)] pub travelled_distance_m:f64,
    pub mechanism_compaction:Option<MechanismCompaction>,
}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq)]
pub struct MechanismCompaction {pub count:u64,pub covered_through:u64,pub state_version:u64,pub state:Value}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq)]
pub struct ReplayCheckpoint {
    pub actor:ReplayActor,pub baseline_commit:u64,pub covered_through:u64,pub state_version:u64,pub state:Value,
    pub canonical_identity_binding:Vec<(u64,String)>,pub active_causes:Vec<ActiveCause>,
    pub cause_event_id:Option<String>,pub death_event_id:Option<String>,pub replay_available:bool,pub incoming:Vec<ReplayEvidence>,
    pub replay_unavailable:Option<String>,
}
impl ReplayEvidence {
    pub fn validate(&self)->Result<(),&'static str> {
        if self.revision!=1||!self.actor.valid()||!self.shooter.valid() {return Err("invalid_identity");}
        if [self.commit_seq,self.pose_revision,self.geometry_revision,self.state_before_version,self.state_after_version].iter().any(|n|*n>MAX_SAFE_COUNTER)||self.state_after_version<self.state_before_version {return Err("invalid_version");}
        if [&self.event_id,&self.shot_id,&self.weapon_instance,&self.projectile_id,&self.build_hash,&self.anatomy_hash].iter().any(|s|s.is_empty()||s.len()>256) {return Err("invalid_string");}
        if self.seed.parse::<u64>().is_err()||self.seed.starts_with('+') {return Err("invalid_seed");}
        if self.coordinates!="target_hull_metres"||!self.launch_time_s.is_finite()||!self.impact_time_s.is_finite()||self.impact_time_s<self.launch_time_s {return Err("invalid_times");}
        let p=&self.accepted_pose;let dot=|a:[f64;3],b:[f64;3]|a.iter().zip(b).map(|(x,y)|x*y).sum::<f64>();
        if [p.hull_origin,p.ex,p.ey,p.ez].iter().flatten().any(|v|!v.is_finite())||[p.ex,p.ey,p.ez].iter().any(|a|(dot(*a,*a)-1.0).abs()>1e-4)||[dot(p.ex,p.ey),dot(p.ex,p.ez),dot(p.ey,p.ez)].iter().any(|d|d.abs()>1e-4) {return Err("invalid_pose");}
        let cross=[p.ex[1]*p.ey[2]-p.ex[2]*p.ey[1],p.ex[2]*p.ey[0]-p.ex[0]*p.ey[2],p.ex[0]*p.ey[1]-p.ex[1]*p.ey[0]];
        if dot(cross,p.ez)<0.9999 {return Err("invalid_handedness");}
        if p.joints.len()>64||p.running_gear.len()>1024||p.payload.len()>128||p.variants.len()>128||self.flight.len()>256||self.segments.len()>256||self.deaths.len()>1||self.mechanism_records.len()>16 {return Err("resource_limit");}
        if p.geometry_instances.len()>1024 {return Err("geometry_pose_limit");}
        let mut instances=std::collections::HashSet::new();
        for (id,matrix) in &p.geometry_instances {if id.is_empty()||id.len()>256||!instances.insert(id)||crate::geometry::ray::Affine::new(*matrix).is_err(){return Err("invalid_geometry_pose");}}
        if self.report["impact_events"].as_array().is_some_and(|a|a.len()>64)||self.report["fragments"].as_array().is_some_and(|a|a.len()>256) {return Err("report_limit");}
        let mut last=f64::NEG_INFINITY;for q in &self.flight {if !q.time_s.is_finite()||q.time_s<last||q.position.iter().chain(q.velocity_m_s.iter()).any(|v|!v.is_finite()) {return Err("invalid_flight");}last=q.time_s;}
        Ok(())
    }
}

#[cfg(test)]
mod geometry_pose_tests {
    use super::*;
    #[test]
    fn replay_pose_retains_exact_geometry_instance_matrices() {
        let matrix=[1.,0.,0.,0.,0.,1.,0.,0.,0.,0.,1.,0.,0.1,0.2,0.3,1.];
        let input=serde_json::json!({"trust":"accepted","hull_origin":[0,0,0],"ex":[1,0,0],"ey":[0,1,0],"ez":[0,0,1],"joints":[],"running_gear":[],"payload":[],"variants":[],"geometry_instances":[["instance:actual-barrel",matrix]]});
        let pose:ReplayPose=serde_json::from_value(input.clone()).unwrap();
        assert_eq!(serde_json::to_value(pose).unwrap()["geometry_instances"],input["geometry_instances"],"native pose must not discard matrices already used by the damage scene");
    }
}
