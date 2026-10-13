//! Mechanism ownership is bound before damage; ordinary hits never replace fire ownership.
use serde::{Deserialize,Serialize};
use crate::replay_evidence::ReplayActor;

#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
pub struct ActiveCause {
    pub mechanism_id:String,
    pub source_event_id:String,
    pub source_shot_id:String,
    pub shooter:ReplayActor,
    pub accepted_pose_revision:u64,
    pub accepted_geometry_revision:u64,
}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
#[serde(tag="kind",rename_all="snake_case")]
pub enum CauseTransition {
    Started {mechanism_id:String,source_event_id:String},
    Replaced {mechanism_id:String,source_event_id:String},
    Ended {mechanism_id:String},
    Death {death_event_id:String,mechanism_id:String,cause_event_id:String},
}
#[derive(Clone,Debug,Serialize,Deserialize)]
pub struct DamageContext {
    pub actor:ReplayActor,
    pub event_id:String,
    pub shot_id:String,
    pub shooter:ReplayActor,
    pub pose_revision:u64,
    pub geometry_revision:u64,
}
impl DamageContext {
    pub fn valid(&self)->bool {self.actor.valid()&&self.shooter.valid()&&self.actor.battle==self.shooter.battle&&[&self.event_id,&self.shot_id].iter().all(|s|!s.is_empty()&&s.len()<=256&&!s.chars().any(char::is_control))&&[self.pose_revision,self.geometry_revision].iter().all(|n|*n<=crate::replay_evidence::MAX_SAFE_COUNTER)}
    pub fn cause(&self,kind:&str)->ActiveCause {
        ActiveCause {mechanism_id:format!("{}:{kind}",self.event_id),source_event_id:self.event_id.clone(),source_shot_id:self.shot_id.clone(),shooter:self.shooter.clone(),accepted_pose_revision:self.pose_revision,accepted_geometry_revision:self.geometry_revision}
    }
}

#[derive(Clone,Debug,Serialize,Deserialize)]
pub struct AdvanceResult {pub events:Vec<String>,pub transitions:Vec<CauseTransition>,pub death_cause:Option<ActiveCause>}
