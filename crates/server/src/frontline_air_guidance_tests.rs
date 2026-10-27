//! End-to-end native missile admission and owner guards; the host remains authoritative.
use super::*;
fn world() -> (AirWorld, SimWorld) {
    let data=Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let map:Value=serde_json::from_slice(&std::fs::read(data.join("frontline/korea.json")).unwrap()).unwrap();
    let template=AirTemplate::load(&data).unwrap();
    let ground=SimWorld::load(&data,&map).unwrap();
    (template.world(Arc::new(ground.ground.clone()),map),ground)
}
#[test]
fn native_guidance_default_admits_all_physically_allowed_catalog_choices() {
    let (air,_)=world();
    for (aircraft,profile) in air.template.profiles.iter(){
        for slot in profile.stores["slots"].as_array().unwrap(){
            for id in slot["options"].as_object().unwrap().keys(){
                assert_eq!(air.store_unsupported_reason(id),None,"all source-allowed choices open by default: {aircraft}/{}:{id}",slot["key"]);
            }
        }
    }
    assert_eq!(air.store_unsupported_reason("nonexistent_store"),Some("unknown_store"));
    assert!(air.accept_loadout("su27",0,Some(&BTreeMap::from([("imaginary_slot".into(),"r73".into())]))).is_err());
    assert!(air.accept_loadout("su27",0,Some(&BTreeMap::from([("inner:-1".into(),"agm65b".into())]))).is_err(),"opening source choices cannot invent an incompatible base-aircraft station");
}
#[test]
fn native_guidance_protocol_carries_only_control_identity_and_target_reference() {
    let value=json!({"op":"air_seeker_control","unit":{"battle":1,"unit":71,"life":1},"epoch":2,"seq":1,"enabled":true,"radar":true,"target":{"battle":1,"unit":72,"life":1}});
    let command=serde_json::from_value::<crate::frontline::Command>(value);
    assert!(command.is_ok(),"the real native protocol must admit seeker intent; client coordinates never authorize a hit: {command:?}");
}
#[test]
fn native_countermeasure_protocol_admits_only_intent_not_release_coordinates() {
    let command=json!({"op":"air_countermeasure","unit":{"battle":1,"unit":71,"life":1},"epoch":2,"seq":1,"kind":"flares"});
    assert!(serde_json::from_value::<crate::frontline::Command>(command.clone()).is_ok(),"the host protocol must admit countermeasure intent");
    let mut forged=command;forged["pos"]=json!([0.0,2000.0,100.0]);
    assert!(serde_json::from_value::<crate::frontline::Command>(forged).is_err(),"a client cannot choose a countermeasure release coordinate");
}

fn countermeasure_flight_fixture()->(AirWorld,SimWorld,guided::Missile,ProjectileDef){
    let (mut air,ground)=world();let target=UnitRef{battle:1,unit:72,life:1};
    air.spawn(target,"su27",Team::Red,Some(8),"air",0).unwrap();
    air.test_spawn_at(72,FlightSpawn{position:[0.0,2000.0,2000.0],heading:0.0,airspeed:140.0,on_ground:false});
    air.units.get_mut(&72).unwrap().controller=Some(8);
    air.release_countermeasure(72,"flares").unwrap();
    let d=&air.template.definitions["r73"];
    let missile=guided::Missile::launch_optional(guided::Config::from_store(d).unwrap(),"r73".into(),UnitRef{battle:1,unit:71,life:1},air.guidance_target(target));
    let shell=air_missile_shell("r73",d).unwrap();
    (air,ground,missile,shell)
}
fn cm_ordnance(guided:guided::Missile)->crate::frontline_sim::AirOrdnance{
    crate::frontline_sim::AirOrdnance{store_id:"r73".into(),cluster:None,ramjet:None,direction:[0.0,0.0,1.0],bomb:false,diameter:0.17,mass:105.0,dv:800.0,burn:4.5,sustain:None,guided:Some(guided)}
}
#[test]
fn native_countermeasure_actual_combined_step_observes_accepted_host_decoys(){
    let (mut air,mut ground,missile,shell)=countermeasure_flight_fixture();
    let damage=air.units[&72].damage.revision;
    ground.launch_air_round(71,0,shell,[0.0,2000.0,0.0],[0.0,0.0,800.0],Some(cm_ordnance(missile)),"store",1).unwrap();
    let events=ground.step_combined(1.0/120.0,&mut air);
    assert_eq!(ground.guided_ordnance_views()[0].phase,"decoy","actual projectile seed and accepted stock-backed decoys must reach the native seeker path");
    assert!(!events.iter().any(|e|e.target==Some(72)));
    assert_eq!(air.units[&72].damage.revision,damage,"seeker seduction itself never grants damage");
}
#[test]
fn native_countermeasure_diverted_missile_can_hit_only_a_real_finite_aircraft_contact(){
    let (mut air,mut ground,mut missile,shell)=countermeasure_flight_fixture();
    let target=air.guidance_target(UnitRef{battle:1,unit:72,life:1}).unwrap();
    let decoys=air.active_countermeasures();
    // The exact seed the first real native projectile will use below.
    let seed=(0x9e3779b97f4a7c15u64^71)^1u64.rotate_left(7);
    missile.observe_countermeasures([0.0,2000.0,0.0],[0.0,0.0,800.0],0.0,Some(target),None,true,&decoys,seed,|_|true);
    assert_eq!(missile.phase,"decoy");
    let a=[0.0,2000.0,1960.0];let b=[0.0,2000.0,2040.0];
    assert!(missile.proximity(a,b,target,1.0/120.0).is_none(),"diversion cannot turn the original reference into a fake fuze victim");
    let (_,victim,entry)=air.first_contact(a,b,71).expect("actual accepted aircraft geometry must intersect the test ray");assert_eq!(victim,72);
    let start=[entry[0],entry[1],entry[2]-0.5];
    ground.launch_air_round(71,0,shell,start,[0.0,0.0,800.0],Some(cm_ordnance(missile)),"store",1).unwrap();
    let events=ground.step_combined(1.0/120.0,&mut air);
    assert!(events.iter().any(|e|e.kind=="impact"&&e.target==Some(72)&&e.detail["report"]["damage_applied"]==true),"existing finite swept contact must still apply actual native damage: {events:?}");
    assert!(!events.iter().any(|e|e.kind=="missile_proximity"));
}
fn missile_fixture(store:&str,slot:&str)->(AirWorld,SimWorld,UnitRef,UnitRef){
    let (mut air,ground)=world();let source=UnitRef{battle:1,unit:71,life:1};let target=UnitRef{battle:1,unit:72,life:1};
    air.spawn_configured(source,"su27",Team::Blue,Some(7),"air",0,Some(&BTreeMap::from([(slot.into(),store.into())]))).unwrap();
    air.spawn(target,"nf01",Team::Red,Some(8),"air",0).unwrap();
    for (reference,position,speed,player) in [(source,[0.0,2500.0,0.0],250.0,7),(target,[0.0,2500.0,2000.0],140.0,8)]{
        air.test_spawn_at(reference.unit,FlightSpawn{position,heading:0.0,airspeed:speed,on_ground:false});
        air.units.get_mut(&reference.unit).unwrap().controller=Some(player);
    }
    air.set_weapon_control(source.unit,Some(store.into()),None,"single".into(),"all".into()).unwrap();
    (air,ground,source,target)
}
fn advance(air:&mut AirWorld,ground:&mut SimWorld,steps:usize,release:bool)->Vec<SimEvent>{
    let mut events=Vec::new();
    for _ in 0..steps{
        let now=air.time;
        for id in [71,72]{if air.units.get(&id).is_some_and(|u|u.alive()){
            air.accept_input(id,AirInput{aim:[0.0,0.0,1.0],throttle:0.7,manual_pitch:0.0,manual_roll:0.0,manual_yaw:0.0,flags:1,fire:false,release:release&&id==71},now).unwrap();
        }}
        events.extend(ground.step_combined(1.0/120.0,air));
    }
    events
}
#[test]
fn native_guidance_actual_ir_acquisition_launch_inventory_swept_fuze_and_damage(){
    let (mut air,mut ground,source,target)=missile_fixture("r73","outer:-1");
    let rejected=advance(&mut air,&mut ground,1,true);
    assert!(!rejected.iter().any(|e|e.kind=="shot"),"seeker-off launch must not manufacture an accepted missile");
    assert_eq!(air.units[&source.unit].stores[0].count,1);
    air.set_seeker_control(source.unit,true,false,Some(target),&ground).unwrap();
    advance(&mut air,&mut ground,220,false);
    assert_eq!(air.units[&source.unit].seeker.status,"track","the actual host must acquire, not trust a client lock flag");
    let launch=advance(&mut air,&mut ground,1,true);
    assert_eq!(launch.iter().filter(|e|e.kind=="shot"&&e.detail["store_id"]=="r73").count(),1);
    assert_eq!(air.units[&source.unit].stores[0].count,0);
    assert_eq!(ground.guided_ordnance_views().len(),1);
    let events=advance(&mut air,&mut ground,1200,false);
    assert!(events.iter().any(|e|e.shooter==Some(source.unit)&&e.target==Some(target.unit)&&(e.kind=="blast"||e.kind=="impact")),"a real swept missile contact/fuze must reach the existing authoritative damage owner");
    assert!(!air.units[&target.unit].alive(),"the accepted R73 warhead must damage the aircraft, not only draw a marker");
    assert!(ground.guided_ordnance_views().is_empty(),"accepted detonation consumes the exterior missile exactly once");
}
#[test]
fn native_guidance_target_reference_and_prep_rejection_preserve_ammunition(){
    let (mut air,ground,source,target)=missile_fixture("r27r","inner:-1");
    let before=air.units[&source.unit].stores[0].count;
    assert!(air.set_seeker_control(source.unit,true,true,Some(UnitRef{life:2,..target}),&ground).is_err());
    assert!(air.set_seeker_control(source.unit,true,true,Some(source),&ground).is_err());
    assert_eq!(air.units[&source.unit].stores[0].count,before);
    air.set_seeker_control(source.unit,true,false,Some(target),&ground).unwrap();
    assert_ne!(air.units[&source.unit].seeker.status,"track","SARH target references cannot grant illumination or skip prep");
}

#[test]
fn native_guidance_cluster_opens_into_actual_catalog_child_projectiles_once(){
    for (plane,slot,store,child,count) in [("a10a","p2","cbu87","heat_64_blu97",36),("su25","p3","rbk500","heat_42_ptab1m",40)] {
        let (mut air,mut ground)=world();let source=UnitRef{battle:1,unit:71,life:1};
        air.spawn_configured(source,plane,Team::Blue,Some(7),"air",0,Some(&BTreeMap::from([(slot.into(),store.into())]))).unwrap();
        air.test_spawn_at(71,FlightSpawn{position:[0.0,250.0,0.0],heading:0.0,airspeed:150.0,on_ground:false});
        air.units.get_mut(&71).unwrap().controller=Some(7);
        air.set_weapon_control(71,Some(store.into()),None,"single".into(),"all".into()).unwrap();
        let mut events=advance(&mut air,&mut ground,1,true);
        events.extend(advance(&mut air,&mut ground,300,false));
        assert_eq!(events.iter().filter(|e|e.kind=="cluster_open").count(),1,"{store}: parent must open exactly once and be consumed");
        assert_eq!(events.iter().filter(|e|e.kind=="shot"&&e.detail["projectile_id"]==child).count(),count,"{store}: actual catalog child shells, not an enlarged parent explosion");
        assert_eq!(air.units[&71].stores[0].count,0);
    }
}

#[test]
fn native_guidance_spent_store_lock_cannot_authorize_a_different_guidance_config(){
    let (mut air,mut ground)=world();let source=UnitRef{battle:1,unit:71,life:1};let target=UnitRef{battle:1,unit:72,life:1};
    air.spawn(source,"su27",Team::Blue,Some(7),"air",1).unwrap();
    air.spawn(target,"nf01",Team::Red,Some(8),"air",0).unwrap();
    for (reference,position,speed,player) in [(source,[0.0,6000.0,0.0],250.0,7),(target,[0.0,6000.0,15000.0],140.0,8)]{
        air.test_spawn_at(reference.unit,FlightSpawn{position,heading:0.0,airspeed:speed,on_ground:false});
        air.units.get_mut(&reference.unit).unwrap().controller=Some(player);
    }
    assert!(air.units[&71].weapon_control.is_none(),"this exercises the real default mixed-loadout path");
    air.set_seeker_control(71,true,true,Some(target),&ground).unwrap();
    advance(&mut air,&mut ground,120,false);assert_eq!(air.units[&71].seeker.status,"track","actual source preset must first acquire its first R27R: {:?}",air.units[&71].seeker);
    let first=advance(&mut air,&mut ground,1,true);
    assert_eq!(first.iter().filter(|e|e.kind=="shot"&&e.detail["store_id"]=="r27r").count(),1);
    advance(&mut air,&mut ground,60,false);
    let second=advance(&mut air,&mut ground,1,true);
    assert_eq!(second.iter().filter(|e|e.kind=="shot"&&e.detail["store_id"]=="r27r").count(),1);
    advance(&mut air,&mut ground,60,false);
    let third=advance(&mut air,&mut ground,1,true);
    assert!(!third.iter().any(|e|e.kind=="shot"&&e.detail["store_id"]=="r27t"),"15km radar lock cannot authorize a 12km IR seeker");
    assert_eq!(air.units[&71].stores.iter().filter(|s|s.value["id"]=="r27t").map(|s|s.count).sum::<u32>(),2);
    air.set_seeker_control(71,false,true,Some(target),&ground).unwrap();
    advance(&mut air,&mut ground,240,false);
    let sarh=ground.guided_ordnance_views().into_iter().find(|v|v.store_id=="r27r").unwrap();
    assert_ne!(sarh.phase,"lost","preparing the next store must preserve the in-flight radar missile's independent support");
}

#[test]
fn native_guidance_inherited_variant_damage_view_declares_source_visual_aliases(){
    let (mut air,_)=world();let reference=UnitRef{battle:1,unit:71,life:1};
    air.spawn(reference,"su27skm",Team::Blue,Some(7),"air",0).unwrap();
    let view=serde_json::to_value(air.units[&71].view()).unwrap();
    assert_eq!(view["damage"]["visual_aliases"]["fin"],"tail","inherited Su27 mesh must retain the source's explicit limited damage projection");
}
