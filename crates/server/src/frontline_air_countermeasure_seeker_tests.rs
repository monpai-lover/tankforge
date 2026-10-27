use super::*;
use serde_json::json;
fn target()->Target {Target{reference:UnitRef{battle:1,unit:72,life:1},team:1,air:true,alive:true,pos:[0.0,2000.0,1000.0],velocity:[0.0,0.0,100.0],emitting:false,jam_search:0.0,jam_track:0.0}}
fn missile(mode:&str)->Missile {
    let config=Config::from_store(&json!({"kind":"aam","guidance":mode,"mass":100,"d":0.17,"burn":4,"dv":800,"lockRange":10000,"minRange":100,"fov":30,"gimbal":60,"maxG":20,"life":60,"fuse":8,"flareResist":0,"chaffResist":0,"seeker":{"activeRange":500,"activeFov":30}})).unwrap();
    Missile::launch(config,"cm_fixture".into(),UnitRef{battle:1,unit:71,life:1},target())
}
fn decoy(kind:CountermeasureKind)->Decoy {Decoy{id:1,owner:target().reference,kind,pos:[10.0,2000.0,1000.0],velocity:[0.0,0.0,60.0],age:0.1,ttl:5.0}}
fn support()->Option<Support> {Some(Support{radar:true,laser:false,beam:false,position:[0.0,2000.0,0.0],nose:[0.0,0.0,1.0],aim:[0.0,0.0,1.0],manual:[0.0;2]})}
fn seed(d:Decoy,success:bool)->u64 {(0..10000).find(|s|(decoy_draw(*s,d.key())<0.25)==success).unwrap()}
fn observe(m:&mut Missile,d:Decoy,seed:u64,visible:bool){m.observe_countermeasures([0.0,2000.0,0.0],[0.0,0.0,800.0],0.2,Some(target()),support(),true,&[d],seed,|_|visible);}

#[test]
fn native_countermeasure_class_owner_visibility_aperture_and_aspect_gate_trials(){
    let flare=decoy(CountermeasureKind::Flares);let good=seed(flare,true);
    for (d,visible) in [
        (decoy(CountermeasureKind::Chaff),true),
        (Decoy{owner:UnitRef{life:2,..target().reference},..flare},true),
        (Decoy{pos:[2000.0,2000.0,100.0],..flare},true),
        (Decoy{age:6.0,..flare},true),
        (flare,false),
    ] {let mut m=missile("ir");observe(&mut m,d,good,visible);assert!(m.cm_lock.is_none());assert!(m.cm_tried.is_empty(),"ineligible observation cannot consume the later valid trial");}
    let mut rear=missile("ir");rear.config.rear_only=true;let mut head=target();head.velocity=[0.0,0.0,-100.0];
    rear.observe_countermeasures([0.0,2000.0,0.0],[0.0,0.0,800.0],0.2,Some(head),support(),true,&[flare],good,|_|true);assert!(rear.cm_tried.is_empty());
    let mut rate=missile("ir");rate.config.track_rate=0.001;observe(&mut rate,Decoy{velocity:[500.0,0.0,0.0],..flare},good,true);assert!(rate.cm_tried.is_empty());
    let mut valid=missile("ir");observe(&mut valid,flare,good,true);assert_eq!(valid.cm_lock,Some(flare.key()));
}

#[test]
fn native_countermeasure_radar_support_and_active_phase_are_required(){
    let d=decoy(CountermeasureKind::Chaff);let good=seed(d,true);
    let mut ir=missile("ir");observe(&mut ir,d,good,true);assert!(ir.cm_lock.is_none());
    let mut sarh=missile("sarh");sarh.observe_countermeasures([0.0,2000.0,0.0],[0.0,0.0,800.0],0.2,Some(target()),None,true,&[d],good,|_|true);assert!(sarh.cm_tried.is_empty());
    observe(&mut sarh,d,good,true);assert_eq!(sarh.cm_lock,Some(d.key()));
    for mode in ["arh","aim54"]{let mut m=missile(mode);observe(&mut m,d,good,true);assert!(m.cm_tried.is_empty());m.phase="active".into();observe(&mut m,d,good,true);assert_eq!(m.cm_lock,Some(d.key()));}
}

#[test]
fn native_countermeasure_trials_are_deterministic_once_per_eligible_decoy(){
    let d=decoy(CountermeasureKind::Flares);let good=seed(d,true);let bad=seed(d,false);
    let mut a=missile("ir");let mut b=a.clone();observe(&mut a,d,good,true);observe(&mut b,d,good,true);assert_eq!(a.cm_lock,b.cm_lock);
    let mut retry=missile("ir");observe(&mut retry,d,bad,true);assert!(retry.cm_lock.is_none());
    observe(&mut retry,d,good,true);assert!(retry.cm_lock.is_none(),"changing seed on a repeated observation cannot reroll the same decoy");assert_eq!(retry.cm_tried.len(),1);
    let mut blocked=missile("ir");observe(&mut blocked,d,good,false);observe(&mut blocked,d,good,true);assert_eq!(blocked.cm_lock,Some(d.key()));
}

#[test]
fn native_countermeasure_diversion_never_proximity_hits_original_aircraft_or_refreshes_from_it(){
    let d=decoy(CountermeasureKind::Flares);let mut m=missile("ir");let a=[0.0,2000.0,990.0];let b=[0.0,2000.0,1010.0];
    assert!(m.proximity(a,b,target(),1.0/120.0).is_some(),"the original real aircraft swept fuze is exercised before diversion");
    observe(&mut m,d,seed(d,true),true);assert_eq!(m.cm_lock,Some(d.key()));assert!(m.proximity(a,b,target(),1.0/120.0).is_none());
    assert_eq!(m.estimate.unwrap().reference,target().reference);assert_eq!(m.estimate.unwrap().pos,target().pos,"a decoy must never overwrite an aircraft Target with a fake position");
    let mut changed=m.clone();let mut forged=target();forged.pos=[9000.0,1000.0,-9000.0];
    let old=m.acceleration_control([0.0,2000.0,0.0],[0.0,0.0,800.0],0.3,Some(target()),support(),true);
    let altered=changed.acceleration_control([0.0,2000.0,0.0],[0.0,0.0,800.0],0.3,Some(forged),support(),true);assert_eq!(old,altered,"real target truth cannot overwrite a diverted estimate");
    assert_eq!(m.acceleration_control(a,[0.0,0.0,800.0],10.0,Some(target()),support(),true),[0.0;3]);assert!(m.lost);assert!(m.proximity(a,b,target(),1.0/120.0).is_none());
}

#[test]
fn native_countermeasure_arh_activation_uses_existing_estimate_without_datalink(){
    for mode in ["arh","aim54"] {
        let mut stale=missile(mode);let mut current=target();current.pos[2]=200.0;
        stale.observe_countermeasures([0.0,2000.0,0.0],[0.0,0.0,800.0],0.2,Some(current),None,true,&[],0,|_|true);
        assert_eq!(stale.phase,"datalink","CM hook cannot activate {mode} from current host target truth when the unsupported missile estimate remains outside active range");
        let mut close=missile(mode);close.estimate.as_mut().unwrap().pos[2]=200.0;
        close.observe_countermeasures([0.0,2000.0,0.0],[0.0,0.0,800.0],0.2,Some(target()),None,true,&[],0,|_|true);
        assert_eq!(close.phase,"active","existing estimate-based activation must remain available");
    }
}
