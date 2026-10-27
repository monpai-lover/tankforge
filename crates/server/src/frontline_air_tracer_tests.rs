//! Actual admitted gun input -> native round -> filtered frame display evidence.
use super::*;
use std::collections::BTreeSet;

fn accepted(output:Vec<(u32,Update)>){assert!(!output.iter().any(|(_,u)|matches!(u,Update::Error{..})),"native input rejected: {output:?}");}
struct Fixture {hub:FrontlineHub,reference:UnitRef,epoch:u64,seq:u64,now:f64}
impl Fixture {
 fn new(aircraft:&str)->Self{
  let data=Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");let mut hub=FrontlineHub::new(&data).unwrap();
  accepted(hub.handle(1,Command::Create{name:"Accepted tracer QA".into(),map:"taiwan".into(),observer:true,era:2022},0.));
  accepted(hub.handle(2,Command::Join{room:1,observer:false,team:Some(Team::Blue)},0.));
  accepted(hub.handle(3,Command::Join{room:1,observer:false,team:Some(Team::Red)},0.));
  accepted(hub.handle(1,Command::Start,0.));
  accepted(hub.handle(2,Command::DeployAir{aircraft:aircraft.into(),spawn:"air".into(),loadout:0,custom:None,fuel_minutes:None},0.));
  accepted(hub.handle(3,Command::DeployAir{aircraft:"f16v".into(),spawn:"air".into(),loadout:0,custom:None,fuel_minutes:None},0.));
  let p=&hub.rooms[&1].members[&2].view;let(reference,epoch)=(p.controlled.unwrap(),p.epoch);
  Self{hub,reference,epoch,seq:0,now:0.}
 }
 fn tick(&mut self,fire:bool)->Vec<(Vec<u32>,Update)>{self.seq+=1;accepted(self.hub.handle(2,Command::AirInput{unit:self.reference,epoch:self.epoch,seq:self.seq,aim:[0.,0.,1.],throttle:0.75,manual_pitch:0.,manual_roll:0.,manual_yaw:0.,flags:1,fire,release:false},self.now));self.now+=STEP;self.hub.tick(self.now+1e-8)}
 fn frame(output:&[(Vec<u32>,Update)],player:u32)->Value{output.iter().find_map(|(to,u)|if to.contains(&player)&&matches!(u,Update::Frame{..}){Some(serde_json::to_value(u).unwrap())}else{None}).expect("actual native frame")}
}

#[test]
fn air_tracer_native_f16_rounds_cross_the_frame_with_real_flight_and_no_remote_private_leak(){
 let mut f=Fixture::new("f16v");let mut shots=Vec::new();let mut output=Vec::new();
 for _ in 0..4{output=f.tick(true);let frame=Fixture::frame(&output,1);shots.extend(frame["events"].as_array().unwrap().iter().filter(|e|e["kind"]=="shot"&&e["shooter"]["unit"].as_u64()==Some(f.reference.unit)).cloned());}
 let observer=Fixture::frame(&output,1);let tracers=observer["tracers"].as_array().expect("accepted air-gun tracers are missing from the actual frame");assert!(!tracers.is_empty());
 assert!(tracers.len()<shots.len(),"M61 must keep its one-in-five source cadence, not mark every round");
 let expected:BTreeSet<_>=shots.iter().enumerate().filter(|(i,_)|(i+1)%5==0).map(|(_,e)|e["detail"]["shot_id"].as_u64().unwrap()).collect();
 let actual:BTreeSet<_>=tracers.iter().map(|t|t["shot_id"].as_u64().unwrap()).collect();assert_eq!(actual,expected);
 for t in tracers{assert_eq!(t["shooter"],json!(f.reference));assert_eq!(t["projectile_id"],"hei_20_m56");assert_eq!(t["style"],"bullet");assert_eq!(t["color"],json!([1.,0.6,0.25]));assert!(t["age"].as_f64().unwrap()>0.);let shot=shots.iter().find(|s|s["detail"]["shot_id"]==t["shot_id"]).unwrap();assert_ne!(t["pos"],shot["pos"],"display must use the accepted surviving ballistic round, not just a muzzle flash");}
 let blue=Fixture::frame(&output,2);assert_eq!(blue["tracers"],observer["tracers"]);
 let red=Fixture::frame(&output,3);assert!(red["tracers"].as_array().is_none_or(Vec::is_empty),"a distant hidden enemy cannot receive private projectile coordinates");
}

#[test]
fn air_tracer_native_mg_source_cadence_and_real_round_lifetime_are_preserved(){
 let mut f=Fixture::new("p51d");let mut shots=Vec::new();let mut output=Vec::new();
 for _ in 0..6{output=f.tick(true);let frame=Fixture::frame(&output,1);shots.extend(frame["events"].as_array().unwrap().iter().filter(|e|e["kind"]=="shot"&&e["shooter"]["unit"].as_u64()==Some(f.reference.unit)).cloned());}
 let frame=Fixture::frame(&output,1);let tracers=frame["tracers"].as_array().expect("native MG traces must cross the frame");assert!(!tracers.is_empty());
 let mut by_gun:BTreeMap<String,usize>=BTreeMap::new();let expected:BTreeSet<_>=shots.iter().filter_map(|e|{let n=by_gun.entry(e["detail"]["weapon_instance"].as_str().unwrap().into()).or_default();*n+=1;(*n%3==0).then(||e["detail"]["shot_id"].as_u64().unwrap())}).collect();
 assert_eq!(tracers.iter().map(|t|t["shot_id"].as_u64().unwrap()).collect::<BTreeSet<_>>(),expected);
 for _ in 0..70{output=f.tick(false);}let after=Fixture::frame(&output,1);assert!(after["tracers"].as_array().is_none_or(Vec::is_empty),"the existing bullet display lifetime must end without continuing a ghost trace");
}

#[test]
fn air_tracer_native_real_frames_survive_lossless_wire_encoding(){
 let mut f=Fixture::new("f16v");let mut encoder=crate::frontline_wire::FrameEncoder::new(501);
 let mut decoder=crate::frontline_wire::FrameDecoder::default();let mut samples=Vec::new();
 for firing in [true,true,true,true,false] {
  let mut output=f.tick(firing);
  if !firing {for _ in 0..70 {output=f.tick(false);}}
  let frame=output.iter().find_map(|(to,u)|(to.contains(&1)&&matches!(u,Update::Frame{..})).then_some(u)).unwrap();
  let raw=serde_json::to_value(frame).unwrap();let packet=encoder.encode(frame).unwrap();
  assert!(crate::frontline_wire::identical(&raw,&decoder.decode(&packet).unwrap()));
  samples.push(json!({"frame":raw,"packet":packet}));
 }
 assert!(samples[..4].iter().any(|s|!s["frame"]["tracers"].as_array().unwrap().is_empty()));
 assert!(samples.last().unwrap()["frame"]["tracers"].as_array().unwrap().is_empty());
 if let Ok(path)=std::env::var("TF_NATIVE_TRACER_CAPTURE") {std::fs::write(path,serde_json::to_vec(&json!({"origin":"actual FrontlineHub admitted F16 air_input -> SimWorld surviving rounds -> observer Frame -> FrameEncoder", "samples":samples})).unwrap()).unwrap();}
}
#[test]
fn air_tracer_native_cannon_default_uses_each_accepted_shell_without_extra_combat_rounds(){
 let mut f=Fixture::new("me262");let mut accepted_ids=BTreeSet::new();let mut output=Vec::new();
 for _ in 0..4 {output=f.tick(true);let frame=Fixture::frame(&output,1);for event in frame["events"].as_array().unwrap().iter().filter(|e|e["kind"]=="shot"&&e["shooter"]["unit"].as_u64()==Some(f.reference.unit)){accepted_ids.insert(event["detail"]["shot_id"].as_u64().unwrap());}}
 let frame=Fixture::frame(&output,1);let tracers=frame["tracers"].as_array().unwrap();assert!(!tracers.is_empty());
 assert_eq!(tracers.iter().map(|t|t["shot_id"].as_u64().unwrap()).collect::<BTreeSet<_>>(),accepted_ids);
 assert!(tracers.iter().all(|t|t["style"]=="shell"&&t["shooter"]==json!(f.reference)));
}

#[test]
fn air_tracer_native_current_occluded_point_is_private_even_for_a_friendly_shooter(){
 let mut f=Fixture::new("f16v");let room=f.hub.rooms.get_mut(&1).unwrap();
 let pilot=room.air.views().into_iter().find(|u|u.unit==f.reference).unwrap();
 let catalog:Value=serde_json::from_slice(&std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data/aircraft/frontline.json")).unwrap()).unwrap();
 let shell:tg_weapon::ProjectileDef=serde_json::from_value(catalog["shells"]["hei_20_m56"].clone()).unwrap();
 let point=[pilot.pos[0],-100.0,pilot.pos[2]+10.0];
 let event=room.sim.launch_air_round(f.reference.unit,0,shell,point,[0.0,0.0,1000.0],None,"native-tracer-privacy",1).unwrap();
 room.sim.mark_air_gun_tracer(event.detail["shot_id"].as_u64().unwrap(),crate::frontline_sim::AirGunTracerStyle{shooter:f.reference,color:[1.0,0.6,0.25],style:"bullet",width_scale:1.0});
 assert_eq!(room.sim.air_gun_tracer_views().len(),1,"an accepted live native round exists before the next contact step");
 assert!(room.tracer_views_for(Team::Blue).is_empty(),"friendly muzzle knowledge must not expose the later point behind terrain");
}