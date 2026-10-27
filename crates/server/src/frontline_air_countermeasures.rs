//! Accepted host-owned decoys. Dynamics/resistance are declared source game tuning.
use super::AcceptedModelPose;
use crate::frontline::UnitRef;
use serde::{Deserialize,Serialize};
use serde_json::Value;

const RELEASE_INTERVAL:f64=0.15;
const MAX_SAFE_SERIAL:u64=9_007_199_254_740_991;

#[derive(Clone,Copy,Debug,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="snake_case")]
pub enum Kind { Flares, Chaff }
#[derive(Clone,Copy,Debug,PartialEq,Eq,PartialOrd,Ord)]
pub struct DecoyId {pub owner:UnitRef,pub serial:u64}
#[derive(Clone,Copy,Debug,PartialEq,Serialize)]
pub struct Decoy {
    /// The wire key is owner unit/life plus this local serial, never a victim ID.
    pub id:u64,
    #[serde(skip)] pub owner:UnitRef,
    pub kind:Kind,pub pos:[f64;3],pub velocity:[f64;3],pub age:f64,pub ttl:f64,
}
impl Decoy {
    pub fn key(&self)->DecoyId{DecoyId{owner:self.owner,serial:self.id}}
    pub fn view(&self)->DecoyView{DecoyView{id:self.id,kind:self.kind,pos:self.pos,velocity:self.velocity,age:self.age,ttl:self.ttl}}
}
#[derive(Clone,Copy,Debug,PartialEq,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DecoyView {pub id:u64,pub kind:Kind,pub pos:[f64;3],pub velocity:[f64;3],pub age:f64,pub ttl:f64}
impl DecoyView {
    pub fn valid(&self)->bool{self.id>0&&self.id<=MAX_SAFE_SERIAL&&self.age.is_finite()&&self.age>=0.0&&self.ttl.is_finite()&&self.ttl>0.0&&self.ttl<=6.0&&self.age<self.ttl&&self.pos.iter().chain(&self.velocity).all(|v|v.is_finite())}
}
#[derive(Clone,Copy,Debug,Default,PartialEq,Eq,Serialize)]
pub struct Capacity {pub flares:u32,pub chaff:u32}
#[derive(Clone,Debug,Default,PartialEq,Serialize)]
pub struct View {
    pub flares:u32,pub chaff:u32,pub max:Capacity,pub release_seq:u64,pub cooldown_remaining_s:f64,
}
#[derive(Clone,Debug,PartialEq)]
pub struct Countermeasures {
    max:Capacity,stock:Capacity,cooldown:f64,release_seq:u64,next_id:u64,decoys:Vec<Decoy>,
}
impl Countermeasures {
    pub fn new(sensors:&Value)->Self {
        let count=|key:&str|sensors["countermeasures"][key].as_u64().and_then(|v|u32::try_from(v).ok()).unwrap_or(0);
        let max=Capacity{flares:count("flares"),chaff:count("chaff")};
        Self{max,stock:max,cooldown:0.0,release_seq:0,next_id:1,decoys:Vec::new()}
    }
    pub fn view(&self)->View {View{flares:self.stock.flares,chaff:self.stock.chaff,max:self.max,release_seq:self.release_seq,cooldown_remaining_s:self.cooldown}}
    pub fn decoys(&self)->&[Decoy]{&self.decoys}
    /// Only called by the existing successful completed-service resource commit.
    /// Existing airborne decoys and serials retain their identity across rearming.
    pub fn rearm(&mut self){self.stock=self.max;self.cooldown=0.0;}
    pub fn release(&mut self,kind:&str,owner:UnitRef,pose:&AcceptedModelPose,velocity:[f64;3])->Result<(),String>{
        let (flares,chaff)=match kind {"flares"=>(self.stock.flares.min(2),0),"chaff"=>(0,self.stock.chaff.min(2)),"both"=>(self.stock.flares.min(2),self.stock.chaff.min(2)),_=>return Err("invalid_countermeasure_kind".into())};
        if self.cooldown>1e-9{return Err("countermeasure_dispenser_cycling".into());}
        if flares+chaff==0{return Err(if self.max.flares==0&&self.max.chaff==0{"countermeasures_not_fitted"}else{"countermeasures_empty"}.into());}
        let count=(flares+chaff) as u64;
        if self.release_seq>=MAX_SAFE_SERIAL||self.next_id.checked_add(count).is_none_or(|id|id>MAX_SAFE_SERIAL){return Err("countermeasure_serial_exhausted".into());}
        let positions=[pose.point([-0.6,-0.4,-2.0]),pose.point([0.6,-0.4,-2.0])];
        if !positions.iter().flatten().chain(velocity.iter()).all(|v|v.is_finite()){return Err("invalid_accepted_countermeasure_pose".into());}
        // No fallible operation follows the host inventory commit.
        self.stock.flares-=flares;self.stock.chaff-=chaff;self.cooldown=RELEASE_INTERVAL;self.release_seq+=1;
        for (kind,rounds,fraction,ttl) in [(Kind::Flares,flares,0.6,5.0),(Kind::Chaff,chaff,0.3,6.0)] {
            for side in 0..rounds as usize {
                let sign=if side==0{-1.0}else{1.0};
                self.decoys.push(Decoy{id:self.next_id,owner,kind,pos:positions[side],velocity:[velocity[0]*fraction+sign*8.0,velocity[1]*fraction-6.0,velocity[2]*fraction],age:0.0,ttl});
                self.next_id+=1;
            }
        }
        Ok(())
    }
    pub fn step(&mut self,dt:f64){
        if !dt.is_finite()||dt<=0.0{return;}
        self.cooldown=(self.cooldown-dt).max(0.0);
        for d in &mut self.decoys {
            d.age+=dt;
            match d.kind {
                Kind::Flares=>{d.velocity[1]-=9.81*dt*0.5;for v in &mut d.velocity{*v*=(-dt*1.2).exp();}},
                Kind::Chaff=>{for v in &mut d.velocity{*v*=(-dt*3.0).exp();}d.velocity[1]=(d.velocity[1]-9.81*dt*0.15).max(-2.0);},
            }
            for i in 0..3{d.pos[i]+=d.velocity[i]*dt;}
        }
        self.decoys.retain(|d|d.age<d.ttl&&d.pos.iter().chain(&d.velocity).all(|v|v.is_finite()));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn owner()->UnitRef{UnitRef{battle:1,unit:71,life:1}}
    fn pose()->AcceptedModelPose{AcceptedModelPose{position:[100.0,2000.0,300.0],basis:[[0.0,0.0,-1.0],[0.0,1.0,0.0],[1.0,0.0,0.0]]}}
    #[test]
    fn native_countermeasure_inventory_is_atomic_and_emission_uses_accepted_pose(){
        let mut cm=Countermeasures::new(&json!({"countermeasures":{"flares":1,"chaff":3}}));
        cm.release("both",owner(),&pose(),[100.0,20.0,200.0]).unwrap();
        assert_eq!(cm.view().flares,0);assert_eq!(cm.view().chaff,1);assert_eq!(cm.decoys.len(),3,"one remaining round cannot produce a phantom second flare");
        assert_eq!(cm.decoys[0].pos,pose().point([-0.6,-0.4,-2.0]));
        assert_eq!(cm.decoys[0].velocity,[52.0,6.0,120.0]);
        let before=cm.clone();assert!(cm.release("chaff",owner(),&pose(),[0.0;3]).is_err());assert_eq!(cm,before);
        cm.step(0.15);cm.release("chaff",owner(),&pose(),[0.0;3]).unwrap();cm.step(0.15);
        let before=cm.clone();for kind in ["both","flares","chaff","wrong"]{assert!(cm.release(kind,owner(),&pose(),[0.0;3]).is_err());assert_eq!(cm,before);}
    }
    #[test]
    fn native_countermeasure_evolution_expiry_rearm_and_life_reset_are_deterministic(){
        let sensors=json!({"countermeasures":{"flares":4,"chaff":4}});let mut a=Countermeasures::new(&sensors);
        a.release("both",owner(),&pose(),[100.0,0.0,200.0]).unwrap();let mut b=a.clone();
        for _ in 0..600{a.step(0.01);b.step(0.01);}assert_eq!(a,b);
        a.step(0.01);assert!(a.decoys.is_empty());
        a.rearm();assert_eq!(a.view().flares,4);assert_eq!(a.view().release_seq,1);
        a.release("flares",owner(),&pose(),[0.0;3]).unwrap();assert!(a.decoys[0].id>4);
        let fresh=Countermeasures::new(&sensors);assert_eq!(fresh.view().release_seq,0);assert_eq!(fresh.view().flares,4);assert!(fresh.decoys.is_empty());
    }
    #[test]
    fn native_countermeasure_wire_has_distinct_safe_serial_and_no_owner_as_victim(){
        let mut cm=Countermeasures::new(&json!({"countermeasures":{"flares":2}}));cm.release("flares",owner(),&pose(),[0.0;3]).unwrap();
        let decoy=serde_json::to_value(cm.decoys[0]).unwrap();assert!(decoy.get("owner").is_none());assert_eq!(decoy["id"],1);assert_eq!(decoy["kind"],"flares");
        assert_ne!(cm.decoys[0].key().serial,owner().unit);
    }
}
