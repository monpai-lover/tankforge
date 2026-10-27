//! Deterministic native seekers and bounded missile steering. Store coefficients and
//! seeker defaults are the existing browser catalog's game estimates, not measured data.
#[cfg(test)]
#[path = "frontline_air_realism_tests.rs"]
mod realism_tests;
#[cfg(test)]
#[path = "frontline_air_countermeasure_seeker_tests.rs"]
mod countermeasure_tests;
use crate::frontline::UnitRef;
use super::countermeasures::{Decoy,DecoyId,Kind as CountermeasureKind};
use serde::Serialize;
use serde_json::Value;
// Public TVC capability; allocation fraction is explicit game calibration.
const TVC_FRACTION:f64=0.2;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Mode { Ir, Sarh, Arh, Aim54, Tv, Iir, Laser, Beam, Radio, Arm }
#[derive(Clone, Debug)]
pub struct Config {
    pub mode:Mode,pub air_target:bool,pub bomb:bool,pub range:f64,pub min_range:f64,
    pub fov:f64,pub gimbal:f64,pub max_g:f64,pub life:f64,pub memory:f64,pub prep:f64,
    pub capture:f64,pub active_range:f64,pub active_fov:f64,pub rear_only:bool,pub fuse:f64,
    pub loal:bool,pub reacquire:f64,pub control_range:f64,pub control_sight:f64,pub last_position:bool,
    pub mass:f64,pub span:f64,pub track_rate:f64,
    pub thrust_vector:bool,pub motor_accel:f64,pub motor_burn:f64,
    pub flare_resist:f64,pub chaff_resist:f64,
}
impl Config {
    pub fn from_store(d:&Value)->Result<Self,&'static str>{
        let mode=match d["guidance"].as_str(){Some("ir")=>Mode::Ir,Some("sarh")=>Mode::Sarh,Some("arh")=>Mode::Arh,Some("aim54")=>Mode::Aim54,Some("tv")=>Mode::Tv,Some("iir")=>Mode::Iir,Some("laser")=>Mode::Laser,Some("beam")=>Mode::Beam,Some("radio")=>Mode::Radio,Some("arm")=>Mode::Arm,_=>return Err("unsupported_authoritative_guidance")};
        let air_target=match d["kind"].as_str(){Some("aam")=>true,Some("agm"|"bomb")=>false,_=>return Err("unsupported_authoritative_guidance")};
        let bomb=d["kind"]=="bomb";
        if air_target!=matches!(mode,Mode::Ir|Mode::Sarh|Mode::Arh|Mode::Aim54)||d["ground"]==true||bomb&&mode!=Mode::Laser{return Err("unsupported_authoritative_guidance");}
        let required=|key:&str|d[key].as_f64().filter(|v|v.is_finite()&&*v>0.0).ok_or("invalid_authoritative_guidance");
        required("mass")?;required("d")?;if !bomb{required("burn")?;required("dv")?;}
        let (prep,capture,memory)=match mode{Mode::Ir=>(1.0,0.45,0.4),Mode::Sarh=>(0.6,0.0,1.5),Mode::Arh|Mode::Aim54=>(0.6,0.0,2.0),Mode::Tv|Mode::Iir=>(1.5,0.8,1.2),Mode::Laser=>(1.0,0.0,1.0),_=>(0.5,0.0,0.3)};
        let optional=|key:&str,fallback:f64|d["seeker"][key].as_f64().filter(|v|v.is_finite()&&*v>=0.0).unwrap_or(fallback);
        let manual=matches!(mode,Mode::Beam|Mode::Radio);
        let arm_memory=d["seeker"]["arm"]["memory"].as_str().unwrap_or("lose");
        let c=Self{mode,air_target,bomb,range:required("lockRange")?,min_range:d["minRange"].as_f64().unwrap_or(0.0),fov:if manual{std::f64::consts::PI}else{required("fov")?.to_radians()},gimbal:if manual{15f64.to_radians()}else{required("gimbal")?.to_radians()},max_g:required("maxG")?,life:if bomb{d["life"].as_f64().unwrap_or(120.0)}else{required("life")?},memory:if mode==Mode::Beam{optional("beamLost",2.0)}else if mode==Mode::Arm{if arm_memory=="last"{300.0}else{d["seeker"]["arm"]["gap"].as_f64().unwrap_or(2.0)}}else{optional("memory",memory)},prep:optional("prep",prep),capture:optional("capture",capture),active_range:optional("activeRange",8000.0),active_fov:optional("activeFov",25.0).to_radians(),rear_only:d["rear"]==true,fuse:d["fuse"].as_f64().unwrap_or(0.0),loal:d["seeker"]["loal"]==true,reacquire:optional("reacquire",0.0),control_range:optional("control",10000.0),control_sight:optional("sight",60.0).to_radians(),last_position:mode==Mode::Arm&&arm_memory!="lose",mass:required("mass")?,span:["wings","canards","tailFins"].iter().filter_map(|key|d[*key].as_f64().filter(|v|v.is_finite()&&*v>0.0)).fold(required("d")?*2.0,f64::max),track_rate:optional("trackRate",0.0).to_radians(),thrust_vector:matches!(d["model"].as_str(),Some("aim9x"|"irist"|"r73"|"r73e")),motor_accel:if bomb{0.0}else{required("dv")?/required("burn")?},motor_burn:if bomb{0.0}else{required("burn")?},flare_resist:0.0,chaff_resist:0.2};
        if !c.min_range.is_finite()||c.min_range<0.0||c.min_range>=c.range||c.fov>std::f64::consts::PI||c.gimbal>std::f64::consts::PI||c.max_g>150.0||!c.life.is_finite()||c.life<=0.0||c.life>300.0||!c.fuse.is_finite()||c.fuse<0.0{return Err("invalid_authoritative_guidance");}
        let mut c=c;
        c.flare_resist=d["flareResist"].as_f64().filter(|v|v.is_finite()).unwrap_or(0.0).clamp(0.0,1.0);
        c.chaff_resist=d["chaffResist"].as_f64().filter(|v|v.is_finite()).unwrap_or(0.2).clamp(0.0,1.0);
        Ok(c)
    }
    pub fn radar(&self)->bool{matches!(self.mode,Mode::Sarh|Mode::Arh|Mode::Aim54)}
}
#[derive(Clone, Copy, Debug)]
pub struct Target {pub reference:UnitRef,pub team:u8,pub air:bool,pub alive:bool,pub pos:[f64;3],pub velocity:[f64;3],pub emitting:bool,pub jam_search:f64,pub jam_track:f64}
/// Physical units, accepted fixed points and countermeasure observations never share identities.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum TargetBinding {Unit(UnitRef),Point([f64;3])}
#[derive(Clone, Debug, PartialEq)]
pub struct PointRequest {pub sight:[f64;3],pub point:[f64;3],pub store:String}
#[derive(Clone, Copy, Debug)]
pub struct Support {pub radar:bool,pub laser:bool,pub beam:bool,pub position:[f64;3],pub nose:[f64;3],pub aim:[f64;3],pub manual:[f64;2]}
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Seeker {
    pub enabled:bool,pub radar:bool,pub laser:bool,pub ecm:bool,pub manual:[f64;2],
    pub requested:Option<UnitRef>,pub target:Option<UnitRef>,pub point:Option<[f64;3]>,pub accepted_capture_seq:u64,pub status:&'static str,pub reason:Option<&'static str>,pub progress_s:f64,
    #[serde(skip)] pub store:Option<String>,#[serde(skip)] pub armed_s:f64,
    // Hardware tracks outlive preparation/selection of a particular carried weapon.
    #[serde(skip)] pub radar_target:Option<UnitRef>,#[serde(skip)] pub laser_target:Option<UnitRef>,
    #[serde(skip)] pub point_request:Option<PointRequest>,#[serde(rename="designation_point")] pub laser_point:Option<[f64;3]>,
}
impl Seeker {
    pub fn reset_track(&mut self){self.target=None;self.point=None;self.progress_s=0.0;self.status=if self.enabled{"search"}else{"off"}.into();}
    pub fn clear_point(&mut self){self.accepted_capture_seq=0;if self.point_request.take().is_some()||self.point.is_some(){self.reset_track();}}
    pub fn request_point(&mut self,sight:[f64;3],point:[f64;3],store:String){
        let request=PointRequest{sight,point,store};
        if self.point_request.as_ref()!=Some(&request){self.reset_track();self.armed_s=0.0;self.point_request=Some(request);}
        self.requested=None;self.target=None;self.point=Some(point);
    }
    pub fn set(&mut self,enabled:bool,radar:bool,target:Option<UnitRef>){
        if target.is_some()||!enabled{self.clear_point();}
        if self.requested!=target{self.radar_target=None;self.laser_target=None;}
        if self.enabled!=enabled||self.requested!=target{self.reset_track();}
        self.enabled=enabled;self.radar=radar;self.requested=target;
        if !radar{self.radar_target=None;}
        if !enabled{self.armed_s=0.0;self.reset_track();self.reason=None;}
    }
    pub fn track_point(&mut self,store:&str,c:&Config,pos:[f64;3],nose:[f64;3],dt:f64,visible:bool){
        if self.store.as_deref()!=Some(store){self.store=Some(store.into());self.armed_s=0.0;self.reset_track();}
        if !self.enabled{self.status="off";return;}
        let Some(request)=self.point_request.as_ref().filter(|p|p.store==store) else{self.clear_point();return;};
        let point=request.point;
        if matches!(c.mode,Mode::Laser|Mode::Beam)&&!self.laser{self.reset_track();self.reason=Some("laser_designator_required");return;}
        self.armed_s=(self.armed_s+dt).min(c.prep);
        if !visible||!point_eligible(c,pos,nose,sub(point,pos),point){self.reset_track();self.reason=Some("no_valid_point_in_seeker");return;}
        self.target=None;self.point=Some(point);self.progress_s=(self.progress_s+dt).min(c.prep+c.capture);
        self.status=if self.progress_s+1e-9>=c.prep+c.capture{"track"}else if self.progress_s<c.prep{"prep"}else{"capturing"};self.reason=None;
        if self.status=="track"&&matches!(c.mode,Mode::Laser|Mode::Beam){self.laser_point=Some(point);self.laser_target=None;}
    }
    pub fn track(&mut self,store:&str,c:&Config,team:u8,pos:[f64;3],nose:[f64;3],aim:[f64;3],targets:&[Target],dt:f64,visible:impl Fn(&Target)->bool){
        if self.store.as_deref()!=Some(store){self.store=Some(store.into());self.armed_s=0.0;self.reset_track();}
        if !self.enabled{self.status="off".into();return;}
        if c.radar()&&!self.radar{self.reset_track();self.reason=Some("radar_required".into());return;}
        if matches!(c.mode,Mode::Laser|Mode::Beam)&&!self.laser{self.reset_track();self.reason=Some("laser_designator_required".into());return;}
        self.armed_s=(self.armed_s+dt).min(c.prep);
        if c.mode==Mode::Radio{self.progress_s=self.armed_s;self.status=if self.armed_s+1e-9>=c.prep{"ready"}else{"prep"}.into();self.reason=None;return;}
        let candidate=targets.iter().filter(|t|self.requested.is_none_or(|id|id==t.reference))
            .filter(|t|eligible(c,team,pos,nose,aim,t)&&visible(t))
            .min_by(|a,b|angle(aim,sub(a.pos,pos)).total_cmp(&angle(aim,sub(b.pos,pos))));
        if let Some(t)=candidate{
            if self.target!=Some(t.reference){self.target=Some(t.reference);self.progress_s=0.0;}
            self.progress_s=(self.progress_s+dt).min(c.prep+c.capture);
            self.status=if self.progress_s+1e-9>=c.prep+c.capture{"track"}else if self.progress_s<c.prep{"prep"}else{"capturing"}.into();self.reason=None;
            if self.status=="track"{
                if c.radar(){self.radar_target=Some(t.reference);}
                if matches!(c.mode,Mode::Laser|Mode::Beam){self.laser_target=Some(t.reference);self.laser_point=None;}
            }
        }else{self.reset_track();self.status=if c.loal&&self.armed_s+1e-9>=c.prep{"ready"}else{"search"}.into();self.reason=Some("no_valid_target_in_seeker".into());}
    }
}
fn radar_factor(fraction:f64)->f64{if fraction>0.0{fraction.clamp(0.05,1.0)}else{1.0}}
pub fn eligible(c:&Config,team:u8,pos:[f64;3],nose:[f64;3],aim:[f64;3],t:&Target)->bool{
    let line=sub(t.pos,pos);let range=length(line);let radar_range=if c.radar(){c.range*radar_factor(t.jam_search)}else{c.range};
    if !t.alive||t.team==team||c.mode!=Mode::Arm&&t.air!=c.air_target||c.mode==Mode::Arm&&!t.emitting||range<c.min_range||range>radar_range||angle(nose,line)>c.gimbal||angle(aim,line)>c.fov*0.5{return false;}
    if c.rear_only&&dot(normalize(t.velocity),normalize(line))<0.5{return false;}
    !(c.mode==Mode::Ir&&!c.rear_only&&dot(normalize(t.velocity),normalize(line))<0.0&&range>c.range*0.5)
}
pub fn point_eligible(c:&Config,pos:[f64;3],nose:[f64;3],aim:[f64;3],point:[f64;3])->bool{
    let line=sub(point,pos);let range=length(line);
    !c.air_target&&matches!(c.mode,Mode::Tv|Mode::Iir|Mode::Laser|Mode::Beam)&&point.iter().all(|v|v.is_finite())
        &&range>=c.min_range&&range<=c.range&&angle(nose,line)<=c.gimbal&&angle(aim,line)<=c.fov*0.5
}
#[derive(Clone, Debug)]
pub struct Missile {pub config:Config,pub store_id:String,pub launcher:UnitRef,pub target:Option<UnitRef>,pub binding:Option<TargetBinding>,pub phase:String,pub estimate:Option<Target>,pub last_seen_age:f64,pub lost:bool,
    cm_lock:Option<DecoyId>,cm_estimate:Option<DecoyEstimate>,cm_tried:Vec<DecoyId>}
#[derive(Clone,Copy,Debug)]
struct DecoyEstimate {pos:[f64;3],velocity:[f64;3],last_seen_age:f64}
impl Missile {
    /// Same 60 kPa reference as the browser's existing aerodynamic budget.
    /// This is a declared game envelope, not a manufacturer performance curve.
    pub fn available_g(&self,pos:[f64;3],velocity:[f64;3])->f64 {
        let rho=1.225*(-pos[1].max(0.0)/8500.0).exp();
        self.config.max_g*(0.5*rho*dot(velocity,velocity)/60000.0).clamp(0.0,1.0)
    }
    /// Finite-wing induced-drag principle with a declared 0.7 game efficiency.
    /// Only the accepted normal-control force is charged, never target intent.
    pub fn maneuver_drag(&self,pos:[f64;3],velocity:[f64;3],normal:[f64;3],age:f64)->f64 {
        if !self.config.air_target{return 0.0;}
        let rho=1.225*(-pos[1].max(0.0)/8500.0).exp();let q=0.5*rho*dot(velocity,velocity);
        let aero_limit=self.available_g(pos,velocity)*9.80665;let motor=self.motor_control_acceleration(age);
        let actual=length(normal).min((aero_limit+motor*TVC_FRACTION).min(self.config.max_g*9.80665));
        let aero_used=actual.min(aero_limit);let vector_used=(actual-aero_used).max(0.0);
        let induced=if q>1e-6{self.config.mass*aero_used*aero_used/(q*std::f64::consts::PI*0.7*self.config.span*self.config.span)}else{0.0};
        let diverted=if motor>0.0{motor-(motor*motor-vector_used*vector_used).max(0.0).sqrt()}else{0.0};
        induced+diverted
    }
    fn motor_control_acceleration(&self,age:f64)->f64 {
        if self.config.thrust_vector&&age>=0.0&&age<self.config.motor_burn{self.config.motor_accel}else{0.0}
    }
    pub fn available_control_g(&self,pos:[f64;3],velocity:[f64;3],age:f64)->f64 {
        (self.available_g(pos,velocity)+self.motor_control_acceleration(age)*TVC_FRACTION/9.80665).min(self.config.max_g)
    }
    fn observation_allowed(&self,pos:[f64;3],velocity:[f64;3],target:&Target)->bool {
        if !self.config.air_target{return true;}
        let line=sub(target.pos,pos);let range=length(line);
        if self.config.mode==Mode::Ir {
            let aspect=dot(normalize(target.velocity),normalize(line));
            if self.config.rear_only&&aspect<0.5{return false;}
            if !self.config.rear_only&&aspect<0.0&&range>self.config.range*0.5{return false;}
        }
        self.config.track_rate<=0.0||length(cross(line,sub(target.velocity,velocity)))/range.powi(2).max(1.0)<=self.config.track_rate
    }
    #[cfg(test)]
    pub fn launch(config:Config,store_id:String,launcher:UnitRef,target:Target)->Self{Self::launch_optional(config,store_id,launcher,Some(target))}
    pub fn launch_optional(config:Config,store_id:String,launcher:UnitRef,target:Option<Target>)->Self{
        let phase=match config.mode{Mode::Ir=>"ir",Mode::Sarh=>"sarh",Mode::Arh|Mode::Aim54=>"datalink",Mode::Tv=>"tv",Mode::Iir=>"iir",Mode::Laser=>"laser",Mode::Beam=>"beam",Mode::Radio=>"radio",Mode::Arm=>"arm"}.into();
        Self{config,store_id,launcher,target:target.map(|t|t.reference),binding:target.map(|t|TargetBinding::Unit(t.reference)),phase,estimate:target,last_seen_age:0.0,lost:false,cm_lock:None,cm_estimate:None,cm_tried:Vec::new()}
    }
    pub fn launch_point(config:Config,store_id:String,launcher:UnitRef,point:[f64;3])->Result<Self,&'static str>{
        if config.air_target||!matches!(config.mode,Mode::Tv|Mode::Iir|Mode::Laser|Mode::Beam)||!point.iter().all(|v|v.is_finite()){return Err("unsupported_point_guidance");}
        let mut missile=Self::launch_optional(config,store_id,launcher,None);missile.binding=Some(TargetBinding::Point(point));Ok(missile)
    }
    pub fn acquire(&mut self,target:Target){if self.binding.is_none()&&!self.lost{self.target=Some(target.reference);self.binding=Some(TargetBinding::Unit(target.reference));self.estimate=Some(target);}}
    #[cfg(test)]
    pub fn acceleration(&mut self,pos:[f64;3],velocity:[f64;3],age:f64,target:Option<Target>,illuminated:bool,los:bool)->[f64;3]{
        self.acceleration_control(pos,velocity,age,target,Some(Support{radar:illuminated,laser:illuminated,beam:illuminated,position:pos,nose:normalize(velocity),aim:normalize(velocity),manual:[0.0;2]}),los)
    }
    pub fn acceleration_control(&mut self,pos:[f64;3],velocity:[f64;3],age:f64,target:Option<Target>,support:Option<Support>,los:bool)->[f64;3]{
        if self.lost{return[0.0;3];}
        if self.cm_lock.is_some(){
            let Some(estimate)=self.cm_estimate else{return[0.0;3];};
            let coast=(age-estimate.last_seen_age).max(0.0);
            if coast>self.config.memory+self.config.reacquire.min(4.0){self.lost=true;self.phase="lost".into();return[0.0;3];}
            return self.pn_acceleration(pos,velocity,age,estimate.pos,estimate.velocity,coast);
        }
        if matches!(self.config.mode,Mode::Radio|Mode::Beam){
            let valid=support.filter(|s|length(sub(pos,s.position))<=self.config.control_range&&angle(s.nose,sub(pos,s.position))<=self.config.control_sight);
            let raw=if let Some(s)=valid{
                if self.config.mode==Mode::Radio{let right=normalize(cross([0.0,1.0,0.0],velocity));let up=normalize(cross(velocity,right));self.last_seen_age=age;add(scale(up,s.manual[0]*self.config.max_g*9.80665),scale(right,s.manual[1]*self.config.max_g*9.80665))}
                else if s.beam&&los{self.last_seen_age=age;let range=length(sub(pos,s.position));let error=sub(add(s.position,scale(normalize(s.aim),range)),pos);let vhat=normalize(s.aim);let lateral=sub(velocity,scale(vhat,dot(velocity,vhat)));sub(scale(error,4.0),scale(lateral,2.0))}
                else{[0.0;3]}
            }else{[0.0;3]};
            if age-self.last_seen_age>self.config.memory{self.lost=true;self.phase="lost".into();return[0.0;3];}
            return bounded(raw,velocity,self.config.max_g);
        }
        if let Some(TargetBinding::Point(point))=self.binding{
            let seen=los&&length(sub(point,pos))<=self.config.range*1.5&&angle(velocity,sub(point,pos))<=self.config.gimbal
                &&(self.config.mode!=Mode::Laser||support.is_some_and(|s|s.laser));
            if seen{self.last_seen_age=age;}else if age-self.last_seen_age>self.config.memory{self.lost=true;self.phase="lost".into();return[0.0;3];}
            return self.pn_acceleration(pos,velocity,age,point,[0.0;3],0.0);
        }
        let Some(estimate)=self.estimate else {if age>self.config.reacquire{self.lost=true;self.phase="lost".into();}return[0.0;3];};
        let active=matches!(self.config.mode,Mode::Arh|Mode::Aim54);
        if active&&self.phase=="datalink"&&length(sub(estimate.pos,pos))<=self.config.active_range{self.phase="active".into();}
        let supporting=match self.config.mode{Mode::Sarh=>support.is_some_and(|s|s.radar),Mode::Arh|Mode::Aim54 if self.phase=="datalink"=>support.is_some_and(|s|s.radar),Mode::Laser=>support.is_some_and(|s|s.laser),Mode::Arm=>target.is_some_and(|t|t.emitting),_=>true};
        let seen=target.filter(|t|t.alive&&Some(t.reference)==self.target&&los&&supporting&&length(sub(t.pos,pos))<=self.config.range*1.5*(if self.config.radar(){radar_factor(t.jam_track)}else{1.0})&&angle(velocity,sub(t.pos,pos))<=if self.phase=="active"{self.config.active_fov*0.5}else{self.config.gimbal}).filter(|t|self.observation_allowed(pos,velocity,t));
        if let Some(t)=seen{self.estimate=Some(t);self.last_seen_age=age;}
        else if !(active&&self.phase=="datalink")&&age-self.last_seen_age>self.config.memory+(if self.config.air_target{self.config.reacquire.min(4.0)}else{0.0}){self.lost=true;self.phase="lost".into();return[0.0;3];}
        let estimate=self.estimate.unwrap();let coast=if self.config.last_position{0.0}else{(age-self.last_seen_age).max(0.0)};
        self.pn_acceleration(pos,velocity,age,estimate.pos,estimate.velocity,coast)
    }
    fn pn_acceleration(&self,pos:[f64;3],velocity:[f64;3],age:f64,estimate_pos:[f64;3],estimate_velocity:[f64;3],coast:f64)->[f64;3]{
        let line=sub(add(estimate_pos,scale(estimate_velocity,coast)),pos);let range=length(line).max(1.0);let relative=sub(estimate_velocity,velocity);let closing=(-dot(relative,normalize(line))).max(0.0);
        let omega=scale(cross(line,relative),1.0/(range*range));let mut raw=scale(cross(omega,normalize(velocity)),3.5*closing);
        if self.config.bomb||self.config.air_target{raw=add(raw,[0.0,9.80665,0.0]);}
        bounded(raw,velocity,if self.config.air_target{self.available_control_g(pos,velocity,age)}else{self.config.max_g})
    }
    /// Decoy observations have their own identity/estimate, never a fabricated Target.
    pub fn observe_countermeasures(&mut self,pos:[f64;3],velocity:[f64;3],age:f64,target:Option<Target>,support:Option<Support>,target_los:bool,decoys:&[Decoy],seed:u64,visible:impl Fn(&Decoy)->bool){
        if self.lost||!self.config.air_target{return;}
        let supported=self.config.mode!=Mode::Sarh||support.is_some_and(|s|s.radar);
        if let Some(key)=self.cm_lock {
            if let Some(d)=decoys.iter().find(|d|d.key()==key&&supported&&self.decoy_observation_allowed(pos,velocity,d)&&visible(d)){
                self.cm_estimate=Some(DecoyEstimate{pos:d.pos,velocity:d.velocity,last_seen_age:age});self.last_seen_age=age;
            }
            return;
        }
        let Some(target)=target.filter(|t|t.alive&&t.air&&Some(t.reference)==self.target&&target_los&&self.observation_allowed(pos,velocity,t)) else{return;};
        if matches!(self.config.mode,Mode::Arh|Mode::Aim54)&&self.phase=="datalink"&&self.estimate.is_some_and(|estimate|length(sub(estimate.pos,pos))<=self.config.active_range){self.phase="active".into();}
        let kind=match self.config.mode {
            Mode::Ir=>CountermeasureKind::Flares,
            Mode::Sarh if supported=>CountermeasureKind::Chaff,
            Mode::Arh|Mode::Aim54 if self.phase=="active"=>CountermeasureKind::Chaff,
            _=>return,
        };
        let target_line=sub(target.pos,pos);let half=(self.config.fov*0.5).max(4f64.to_radians());
        if angle(velocity,target_line)>self.config.gimbal{return;}
        for d in decoys {
            if d.owner!=target.reference||d.kind!=kind||self.cm_tried.contains(&d.key())||self.cm_tried.len()>=8192
                ||!self.decoy_observation_allowed(pos,velocity,d)||angle(target_line,sub(d.pos,pos))>half||!visible(d){continue;}
            // Trial only after all geometric/visibility gates. No per-frame rerolls.
            self.cm_tried.push(d.key());
            let resistance=if kind==CountermeasureKind::Flares{self.config.flare_resist}else{self.config.chaff_resist};
            let chance=(1.0-resistance).powi(2)/if kind==CountermeasureKind::Flares{4.0}else{3.0};
            if decoy_draw(seed,d.key())<chance{
                self.cm_lock=Some(d.key());self.cm_estimate=Some(DecoyEstimate{pos:d.pos,velocity:d.velocity,last_seen_age:age});self.last_seen_age=age;self.phase="decoy".into();return;
            }
        }
    }
    fn decoy_observation_allowed(&self,pos:[f64;3],velocity:[f64;3],d:&Decoy)->bool{
        if !d.view().valid(){return false;}
        let line=sub(d.pos,pos);let range=length(line);
        let aperture=if matches!(self.config.mode,Mode::Arh|Mode::Aim54){self.config.active_fov*0.5}else{self.config.gimbal};
        range>=1.0&&range<=self.config.range*1.5&&angle(velocity,line)<=aperture
            &&(self.config.track_rate<=0.0||length(cross(line,sub(d.velocity,velocity)))/range.powi(2).max(1.0)<=self.config.track_rate)
    }
    pub fn proximity(&self,a:[f64;3],b:[f64;3],target:Target,dt:f64)->Option<[f64;3]>{
        if self.cm_lock.is_some()||!self.config.air_target||self.config.fuse<=0.0||!target.alive||Some(target.reference)!=self.target{return None;}
        let a0=sub(a,sub(target.pos,scale(target.velocity,dt)));let d=sub(sub(b,target.pos),a0);let u=(-dot(a0,d)/dot(d,d).max(1e-12)).clamp(0.0,1.0);let miss=length(add(a0,scale(d,u)));
        (miss<self.config.fuse&&(u<1.0||miss<1.5)).then(||add(a,scale(sub(b,a),u)))
    }
}
/// Deterministic single trial keyed by projectile seed and the distinct decoy life.
fn decoy_draw(seed:u64,key:DecoyId)->f64{
    let mut x=seed^key.owner.battle.rotate_left(11)^key.owner.unit.rotate_left(23)^key.owner.life.rotate_left(37)^key.serial.wrapping_mul(0x9e3779b97f4a7c15);
    x=(x^(x>>30)).wrapping_mul(0xbf58476d1ce4e5b9);x=(x^(x>>27)).wrapping_mul(0x94d049bb133111eb);x^=x>>31;
    (x>>11) as f64/9_007_199_254_740_992.0
}
fn bounded(raw:[f64;3],velocity:[f64;3],max_g:f64)->[f64;3]{let vhat=normalize(velocity);let lateral=sub(raw,scale(vhat,dot(raw,vhat)));let cap=max_g*9.80665;scale(lateral,(cap/length(lateral).max(cap)).min(1.0))}
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct View {pub shot_id:u64,pub shooter:u64,pub team:u8,pub store_id:String,pub pos:[f64;3],pub velocity:[f64;3],pub age:f64,pub phase:String}
pub fn add(a:[f64;3],b:[f64;3])->[f64;3]{std::array::from_fn(|i|a[i]+b[i])}
pub fn sub(a:[f64;3],b:[f64;3])->[f64;3]{std::array::from_fn(|i|a[i]-b[i])}
pub fn scale(v:[f64;3],s:f64)->[f64;3]{v.map(|x|x*s)}
pub fn dot(a:[f64;3],b:[f64;3])->f64{a.iter().zip(b).map(|(x,y)|x*y).sum()}
pub fn cross(a:[f64;3],b:[f64;3])->[f64;3]{[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]}
pub fn length(v:[f64;3])->f64{dot(v,v).sqrt()}
pub fn normalize(v:[f64;3])->[f64;3]{scale(v,1.0/length(v).max(1e-12))}
pub fn angle(a:[f64;3],b:[f64;3])->f64{dot(normalize(a),normalize(b)).clamp(-1.0,1.0).acos()}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn config(mode:&str)->Config{Config::from_store(&json!({"kind":if matches!(mode,"tv"|"iir"){"agm"}else{"aam"},"guidance":mode,"mass":100,"d":0.17,"burn":4,"dv":800,"lockRange":10000,"minRange":100,"fov":30,"gimbal":60,"maxG":20,"life":60,"fuse":8})).unwrap()}
    fn target()->Target{Target{reference:UnitRef{battle:1,unit:2,life:1},team:1,air:true,alive:true,pos:[0.0,2000.0,2000.0],velocity:[200.0,0.0,0.0],emitting:false,jam_search:0.0,jam_track:0.0}}
    #[test]fn native_guidance_g_force_is_bounded_and_has_no_instant_velocity_snap(){let mut m=Missile::launch(config("ir"),"r73".into(),UnitRef{battle:1,unit:1,life:1},target());let a=m.acceleration([0.0,2000.0,0.0],[0.0,0.0,800.0],0.0,Some(target()),true,true);assert!(a[0]>0.0);assert!(length(a)<=20.0*9.80665+1e-9);assert!(dot(a,[0.0,0.0,800.0]).abs()<1e-8);}
    #[test]fn native_guidance_sarh_loses_illumination_but_terminal_arh_is_autonomous(){let t=target();let mut s=Missile::launch(config("sarh"),"r27r".into(),t.reference,t);assert_eq!(s.acceleration([0.0,2000.0,0.0],[0.0,0.0,800.0],4.0,Some(t),false,true),[0.0;3]);assert!(s.lost);let mut a=Missile::launch(config("arh"),"aim120a".into(),t.reference,t);assert!(length(a.acceleration([0.0,2000.0,0.0],[0.0,0.0,800.0],4.0,Some(t),false,true))>0.0);assert_eq!(a.phase,"active");}
    #[test]fn native_guidance_wrong_life_or_blocked_los_cannot_refresh_memory(){let mut m=Missile::launch(config("ir"),"r73".into(),target().reference,target());let mut other=target();other.reference.life=2;m.acceleration([0.0,2000.0,0.0],[0.0,0.0,800.0],3.0,Some(other),true,true);assert!(m.lost);}
    #[test]fn native_guidance_acquisition_checks_team_domain_fov_range_and_aspect(){let c=config("ir");let t=target();assert!(eligible(&c,0,[0.0,2000.0,0.0],[0.0,0.0,1.0],[0.0,0.0,1.0],&t));let mut same=t;same.team=0;assert!(!eligible(&c,0,[0.0,2000.0,0.0],[0.0,0.0,1.0],[0.0,0.0,1.0],&same));assert!(!eligible(&config("tv"),0,[0.0,2000.0,0.0],[0.0,0.0,1.0],[0.0,0.0,1.0],&t));}
    #[test]fn native_guidance_swept_proximity_uses_relative_motion(){let mut t=target();t.pos=[0.0,2000.0,10.0];let m=Missile::launch(config("ir"),"r73".into(),t.reference,t);assert!(m.proximity([0.0,2000.0,0.0],[0.0,2000.0,20.0],t,1.0/120.0).is_some());let mut far=t;far.pos[0]=20.0;assert!(m.proximity([0.0,2000.0,0.0],[0.0,2000.0,20.0],far,1.0/120.0).is_none());}
}

#[cfg(test)]
mod expanded_mode_tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn native_guidance_all_source_air_modes_and_guided_bombs_have_native_configs(){
        for (mode,kind) in [("aim54","aam"),("laser","agm"),("beam","agm"),("radio","agm"),("arm","agm"),("laser","bomb")] {
            let manual=matches!(mode,"beam"|"radio");
            let c=Config::from_store(&json!({"kind":kind,"guidance":mode,"mass":200,"d":0.3,
                "burn":4,"dv":600,"lockRange":10000,"minRange":100,"fov":if manual{0}else{20},
                "gimbal":if manual{0}else{60},"maxG":12,"life":60,"fuse":8}));
            assert!(c.is_ok(),"actual source mode must have native guidance, not just an open loadout gate: {mode}/{kind}: {c:?}");
        }
        assert!(Config::from_store(&json!({"kind":"agm","guidance":"imaginary"})).is_err());
        assert_eq!(source_config("vikhr").memory,2.0,"beam interruption uses source beamLost, not the separate seeker memory");
    }

    fn source_config(id:&str)->Config{
        let path=std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/aircraft/frontline.json");
        let data:Value=serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        Config::from_store(&data["storeDefinitions"][id]).unwrap()
    }
    fn ground_target()->Target{Target{reference:UnitRef{battle:1,unit:2,life:1},team:1,air:false,alive:true,pos:[300.0,0.0,3000.0],velocity:[0.0;3],emitting:false,jam_search:0.0,jam_track:0.0}}
    fn support()->Support{Support{radar:true,laser:true,beam:true,position:[0.0;3],nose:[0.0,0.0,1.0],aim:normalize([300.0,0.0,3000.0]),manual:[1.0,1.0]}}
    #[test]
    fn native_guidance_laser_requires_real_designation_and_loses_after_source_memory(){
        let c=source_config("kh25ml");let t=ground_target();let mut seeker=Seeker::default();seeker.set(true,false,Some(t.reference));
        seeker.track("kh25ml",&c,0,[0.0;3],[0.0,0.0,1.0],normalize(t.pos),&[t],3.0,|_|true);
        assert_ne!(seeker.status,"track");assert_eq!(seeker.reason.as_deref(),Some("laser_designator_required"));
        seeker.laser=true;seeker.track("kh25ml",&c,0,[0.0;3],[0.0,0.0,1.0],normalize(t.pos),&[t],3.0,|_|true);
        assert_eq!(seeker.status,"track");let mut m=Missile::launch(c,"kh25ml".into(),t.reference,t);
        assert!(length(m.acceleration_control([0.0;3],[0.0,0.0,500.0],0.1,Some(t),Some(support()),true))>0.0);
        m.acceleration_control([0.0;3],[0.0,0.0,500.0],3.0,Some(t),None,true);
        assert!(m.lost,"the native laser missile must not receive an autonomous target-position update with the designator gone");
        let gbu=source_config("gbu12");assert!(gbu.bomb);assert_eq!(gbu.max_g,2.5);
    }
    #[test]
    fn native_guidance_radio_needs_no_fake_target_and_manual_acceleration_stays_bounded(){
        let c=source_config("agm12b");let mut seeker=Seeker::default();seeker.set(true,false,None);
        seeker.track("agm12b",&c,0,[0.0;3],[0.0,0.0,1.0],[0.0,0.0,1.0],&[],1.0,|_|true);
        assert_eq!(seeker.status,"ready");let cap=c.max_g*9.80665;
        let mut m=Missile::launch_optional(c,"agm12b".into(),ground_target().reference,None);
        let a=m.acceleration_control([0.0,0.0,10.0],[0.0,0.0,500.0],0.1,None,Some(support()),true);
        assert!(a[0]>0.0&&a[1]>0.0);assert!(length(a)<=cap+1e-9);assert_eq!(m.target,None);
        m.acceleration_control([0.0,0.0,10.0],[0.0,0.0,500.0],3.0,None,None,true);assert!(m.lost);
    }
    #[test]
    fn native_guidance_arm_observes_emission_and_source_memory_policies(){
        let mut t=ground_target();let c=source_config("agm45a");
        assert!(!eligible(&c,0,[0.0;3],[0.0,0.0,1.0],normalize(t.pos),&t));t.emitting=true;
        assert!(eligible(&c,0,[0.0;3],[0.0,0.0,1.0],normalize(t.pos),&t));
        for (id,age,lost) in [("agm45a",3.0,true),("kh31p",7.0,true),("agm88b",20.0,false)]{
            let mut m=Missile::launch(source_config(id),id.into(),t.reference,t);let mut stopped=t;stopped.emitting=false;
            m.acceleration_control([0.0;3],[0.0,0.0,700.0],age,Some(stopped),None,true);
            assert_eq!(m.lost,lost,"{id}: native source emission memory policy");assert_eq!(m.last_seen_age,0.0,"a switched-off emitter cannot refresh a position estimate");
        }
    }
    #[test]
    fn native_guidance_real_ecm_degrades_radar_range_but_does_not_disable_ir(){
        let mut t=ground_target();t.air=true;t.pos=[0.0,0.0,9000.0];t.velocity=[100.0,0.0,0.0];t.jam_search=0.45;t.jam_track=0.6;
        let radar=source_config("r27r");assert!(!eligible(&radar,0,[0.0;3],[0.0,0.0,1.0],[0.0,0.0,1.0],&t));
        let ir=source_config("r73");assert!(eligible(&ir,0,[0.0;3],[0.0,0.0,1.0],[0.0,0.0,1.0],&t));
    }
}
