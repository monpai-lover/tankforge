//! Actual host-command, world, seeker and inventory regression for ground-point AGM capture.
use super::*;
use crate::flight_runtime::FlightSpawn;
use crate::frontline_air::AirUnitView;
use tg_physics::tank::terrain::Ground;

struct Fixture {hub:FrontlineHub,unit:UnitRef,epoch:u64,seq:u64,sight:[f64;3]}
impl Fixture {
    fn new(store:&str)->Self {
        Self::configured("a10a",BTreeMap::from([("p3".into(),store.into()),("p9".into(),if store=="agm65g"{"agm65b".into()}else{"agm65g".into()})]),store)
    }
    fn configured(aircraft:&str,custom:BTreeMap<String,String>,store:&str)->Self{
        let data=Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let mut hub=FrontlineHub::new(&data).unwrap();
        for (player,command) in [
            (1,Command::Create{name:"Native AGM point".into(),map:"taiwan".into(),observer:true,era:2022}),
            (2,Command::Join{room:1,observer:false,team:Some(Team::Blue)}),
            (3,Command::Join{room:1,observer:false,team:Some(Team::Blue)}),
            (1,Command::Start),
            (2,Command::DeployAir{ custom_counts: None,aircraft:if aircraft=="nf02"{"a10a".into()}else{aircraft.into()},spawn:"air".into(),loadout:0,custom:if aircraft=="nf02"{None}else{Some(custom.clone())},fuel_minutes:None}),
        ] {accepted(hub.handle(player,command,0.0));}
        let member=&hub.rooms[&1].members[&2].view;
        let (unit,epoch)=(member.controlled.unwrap(),member.epoch);
        let room=hub.rooms.get_mut(&1).unwrap();
        if aircraft=="nf02"{
            // NF02 is a source beam-controller fixture, not a newly admitted room aircraft.
            room.air.units.remove(&unit.unit);room.air.spawn_configured(unit,"nf02",Team::Blue,Some(2),"air",0,Some(&custom)).unwrap();
            let u=room.air.units.get_mut(&unit.unit).unwrap();u.controller=Some(2);u.epoch=epoch;
        }
        room.air.units.retain(|id,_|*id==unit.unit);
        let map:Value=serde_json::from_slice(&std::fs::read(data.join(format!("frontline/{}.json",room.map))).unwrap()).unwrap();
        room.sim=room.sim.for_map(&data,&map).unwrap();room.sim.set_battle_id(unit.battle).unwrap();
        let p=room.air.units[&unit.unit].pos();let ground=room.sim.ground.height(p[0]+300.0,p[2]+3500.0);
        room.air.test_spawn_at(unit.unit,FlightSpawn{position:[p[0] as f32,(ground+800.0) as f32,p[2] as f32],heading:0.0,airspeed:140.0,on_ground:false});
        let sight=crate::frontline_air::guided::normalize([300.0,-800.0,3500.0]);
        let mut f=Self{hub,unit,epoch,seq:0,sight};f.select(store);f
    }
    fn view(&self)->AirUnitView {self.hub.rooms[&1].air.views().into_iter().find(|v|v.unit==self.unit).unwrap()}
    fn command(&self,sight:Option<[f64;3]>,enabled:bool,seq:u64)->Value {
        let mut v=json!({"op":"air_seeker_control","unit":self.unit,"epoch":self.epoch,"seq":seq,"enabled":enabled,"radar":false,"target":null});
        if let Some(sight)=sight {v["sight"]=json!(sight);}v
    }
    fn send(&mut self,value:Value)->Vec<(u32,Update)> {
        let command=serde_json::from_value(value).expect("host protocol must accept a sight-direction intent without any client target coordinate");
        self.hub.handle(2,command,0.0)
    }
    fn capture(&mut self,sight:Option<[f64;3]>,enabled:bool){self.seq+=1;let v=self.command(sight,enabled,self.seq);accepted(self.send(v));}
    fn designate(&mut self,sight:Option<[f64;3]>,enabled:bool,laser:bool){self.seq+=1;let mut v=self.command(sight,enabled,self.seq);v["laser"]=json!(laser);accepted(self.send(v));}
    fn select(&mut self,store:&str){self.seq+=1;accepted(self.hub.handle(2,Command::AirWeaponControl{unit:self.unit,epoch:self.epoch,seq:self.seq,store_id:Some(store.into()),store_index:None,program:"single".into(),gun_mode:"all".into()},0.0));}
    fn step(&mut self,steps:usize,release:bool)->Vec<crate::frontline_sim::SimEvent>{
        let mut events=Vec::new();let room=self.hub.rooms.get_mut(&1).unwrap();
        for _ in 0..steps {
            let now=room.sim.time();
            room.air.accept_input(self.unit.unit,AirInput{aim:[0.0,0.0,1.0],throttle:0.7,manual_pitch:0.0,manual_roll:0.0,manual_yaw:0.0,flags:1,fire:false,release},now).unwrap();
            events.extend(room.sim.step_combined(1.0/120.0,&mut room.air));
        }events
    }
    fn count(&self,store:&str)->u64 {self.view().stores.iter().filter(|s|s["id"]==store).map(|s|s["count"].as_u64().unwrap()).sum()}
    fn point(&self)->Option<[f64;3]>{serde_json::to_value(self.view().seeker).unwrap()["point"].as_array().map(|p|std::array::from_fn(|i|p[i].as_f64().unwrap()))}
}

fn flat_world(ridge:bool)->SimWorld{
    let data=Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");let mut heights=vec![0.0;24];
    if ridge{for x in 0..3{heights[4*3+x]=50.0;}}
    let map=json!({"terrain":{"width":3,"height":8,"cellX":1000.0,"cellZ":1000.0,"x0":-1000.0,"z0":-1000.0,"heights":heights,"patches":[],"pads":[]}});
    SimWorld::load(&data,&map).unwrap()
}

#[test]
fn native_agm_point_review_low_angle_ground_endpoint_accepts_clear_ray_but_rejects_ridge(){
    let a=[0.0,20.0,0.0];let b=[0.0,0.0,6000.0];let world=flat_world(false);
    assert!(!world.line_of_sight(a,b),"legacy unit optical margin intentionally rejects this ground endpoint");
    assert!(world.guidance_point_visible(71,a,b),"finite unobstructed ground endpoint must not inherit unit-center optical clearance");
    let hit=world.guidance_point_contact(71,a,crate::frontline_air::guided::normalize(crate::frontline_air::guided::sub(b,a)),6100.0).unwrap().unwrap();
    assert!(crate::frontline_air::guided::length(crate::frontline_air::guided::sub(hit,b))<0.05);
    let ridge=flat_world(true);assert!(!ridge.guidance_point_visible(71,a,b),"real intervening native terrain still blocks the far point");
    let near=ridge.guidance_point_contact(71,a,crate::frontline_air::guided::normalize(crate::frontline_air::guided::sub(b,a)),6100.0).unwrap().unwrap();
    assert!(near[2]<4000.0,"the host accepts the actual near ridge contact, never a point behind it");
}

#[test]
fn native_agm_point_review_repeated_sight_uses_current_bearing_to_fixed_point(){
    let mut f=Fixture::new("agm65b");f.capture(Some(f.sight),true);let point=f.point().unwrap();
    let position=[point[0]+6500.0,point[1]+800.0,point[2]-3500.0];let heading=(-6500.0f64).atan2(3500.0) as f32;
    f.hub.rooms.get_mut(&1).unwrap().air.test_spawn_at(f.unit.unit,FlightSpawn{position:position.map(|v|v as f32),heading,airspeed:140.0,on_ground:false});
    f.capture(Some(f.sight),true);assert_eq!(f.point(),Some(point),"cached old ray is an identity, not a new ray from the moved aircraft");
    f.hub.rooms.get_mut(&1).unwrap().air.test_spawn_at(f.unit.unit,FlightSpawn{position:position.map(|v|v as f32),heading:heading+std::f32::consts::PI,airspeed:140.0,on_ground:false});
    let v=f.command(Some(f.sight),true,f.seq+1);assert!(f.send(v).iter().any(|(_,m)|matches!(m,Update::Error{..})),"the real current point outside the gimbal must still be rejected");
}

#[test]
fn native_agm_point_review_laser_hardware_survives_aam_unit_selection_and_exports_designation(){
    let mut f=Fixture::configured("a10a",BTreeMap::from([("p5".into(),"gbu12".into()),("p10".into(),"litening".into()),("p1".into(),"aim9l".into())]),"gbu12");
    f.designate(Some(f.sight),true,true);f.step(150,false);let point=f.point().unwrap();
    assert_eq!(f.view().seeker.status,"track");let before=f.count("gbu12");let launched=f.step(1,true);
    assert!(launched.iter().any(|e|e.kind=="shot"&&e.shooter==Some(f.unit.unit)));assert_eq!(f.count("gbu12"),before-1);
    f.step(1,false);f.select("aim9l");
    let target=UnitRef{battle:f.unit.battle,unit:777,life:1};let p=f.view().pos;
    let room=f.hub.rooms.get_mut(&1).unwrap();room.air.spawn(target,"nf01",Team::Red,Some(3),"air",0).unwrap();
    room.air.test_spawn_at(target.unit,FlightSpawn{position:[p[0] as f32,p[1] as f32,(p[2]+1500.0) as f32],heading:0.0,airspeed:140.0,on_ground:false});
    f.seq+=1;let mut command=f.command(None,true,f.seq);command["laser"]=json!(true);command["target"]=json!(target);accepted(f.send(command));
    assert!(f.hub.rooms[&1].air.guidance_point_support(f.unit,point).unwrap().laser,"ordinary AAM UnitRef selection must not redirect the independent pod designation");
    assert_eq!(serde_json::to_value(f.view().seeker).unwrap()["designation_point"],json!(point),"fresh rejoin gets accepted hardware point even without carried point");
    let data=Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");let catalog:Value=serde_json::from_slice(&std::fs::read(data.join("aircraft/frontline.json")).unwrap()).unwrap();
    let public=serde_json::to_value(crate::frontline_perception::project_air_with_store_lengths(&f.view(),|id|catalog["storeDefinitions"][id]["len"].as_f64()).unwrap()).unwrap();
    assert!(public.get("seeker").is_none()&&public.get("designation_point").is_none()&&public.get("accepted_capture_seq").is_none(),"enemy public aircraft projection contains no private guidance state");
    f.step(140,false);assert!(f.hub.rooms[&1].sim.guided_ordnance_views().iter().any(|m|m.shooter==f.unit.unit&&m.store_id=="gbu12"&&m.phase!="lost"));
    f.designate(None,false,false);f.step(140,false);assert!(f.hub.rooms[&1].sim.guided_ordnance_views().iter().any(|m|m.shooter==f.unit.unit&&m.store_id=="gbu12"&&m.phase=="lost"),"closing laser ends actual airborne point support after source memory");
}

#[test]
fn native_agm_point_review_rejected_fresh_capture_cannot_release_the_old_point(){
    for bad_sight in [[0.0,0.0,-1.0],crate::frontline_air::guided::normalize([0.0,0.3,1.0])]{
        let mut f=Fixture::new("agm65b");f.capture(Some(f.sight),true);f.step(330,false);assert_eq!(f.view().seeker.status,"track");
        let count=f.count("agm65b");let request=f.command(Some(bad_sight),true,f.seq+1);
        assert!(f.send(request).iter().any(|(_,m)|matches!(m,Update::Error{..})),"invalid new capture must be rejected");
        let events=f.step(1,true);assert!(!events.iter().any(|e|e.kind=="shot"&&e.shooter==Some(f.unit.unit)),"a rejected new capture must not release at the formerly tracked point");
        assert_eq!(f.count("agm65b"),count);assert_eq!(f.point(),None);
        assert_eq!(serde_json::to_value(f.view().seeker).unwrap()["accepted_capture_seq"],0);
    }
}

#[test]
fn native_agm_point_review_capture_ack_is_the_successful_host_sequence(){
    let mut f=Fixture::new("agm65b");f.capture(Some(f.sight),true);
    assert_eq!(serde_json::to_value(f.view().seeker).unwrap()["accepted_capture_seq"],f.seq,"successful sight gets a host capture ACK, not generic last-input seq");
    let seq=f.seq;f.capture(None,true);assert_eq!(serde_json::to_value(f.view().seeker).unwrap()["accepted_capture_seq"],seq,"ordinary control updates cannot fabricate a capture ACK");
    f.select("agm65g");assert_eq!(serde_json::to_value(f.view().seeker).unwrap()["accepted_capture_seq"],0);
}

#[test]
fn native_agm_point_review_scene_first_contact_obeys_facility_geometry_and_unit_occlusion(){
    let data=Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let map:Value=serde_json::from_slice(&std::fs::read(data.join("frontline/taiwan.json")).unwrap()).unwrap();
    let world=SimWorld::load(&data,&map).unwrap();let views=world.facility_views();
    let geometry=world.facility_geometry_catalog().into_iter().find(|g|views.iter().any(|v|v.facility_id==g.facility_id&&v.kind==crate::frontline_facilities::FacilityKind::Fuel)).unwrap();
    let x=(geometry.bounds[0][0]+geometry.bounds[1][0])*0.5;let z=(geometry.bounds[0][2]+geometry.bounds[1][2])*0.5;
    let hit=world.guidance_point_contact(71,[x,geometry.bounds[1][1]+30.0,z],[0.0,-1.0,0.0],100.0).unwrap().unwrap();
    assert!((hit[1]-geometry.bounds[1][1]).abs()<0.02,"accepted visible facility roof is first, not terrain behind it");
    let mut world=flat_world(false);world.set_battle_id(1).unwrap();world.spawn_unit(72,"de_pz3_j",1,[0.0,0.0,3000.0],0.0).unwrap();
    let a=[0.0,3.0,0.0];let b=[0.0,0.0,6000.0];
    assert!(!world.guidance_point_visible(71,a,b),"an intervening accepted unit cannot be treated as a point endpoint exemption");
    assert_eq!(world.guidance_point_contact(71,a,crate::frontline_air::guided::normalize(crate::frontline_air::guided::sub(b,a)),6100.0).unwrap_err(),"point_blocked");
}

#[test]
fn native_agm_point_review_beam_requires_live_designator_and_never_a_fake_unit(){
    let mut f=Fixture::configured("nf02",BTreeMap::from([("tip:-1".into(),"vikhr".into())]),"vikhr");
    f.designate(Some(f.sight),true,true);f.step(120,false);assert_eq!(f.view().seeker.status,"track");let point=f.point().unwrap();let before=f.count("vikhr");
    let events=f.step(1,true);assert!(events.iter().any(|e|e.kind=="shot"&&e.shooter==Some(f.unit.unit)));assert_eq!(f.count("vikhr"),before-1);
    f.designate(None,false,true);assert_eq!(f.point(),None);assert_eq!(serde_json::to_value(f.view().seeker).unwrap()["designation_point"],json!(point));
    f.step(15,false);assert!(f.hub.rooms[&1].sim.guided_ordnance_views().iter().any(|m|m.shooter==f.unit.unit&&m.phase=="beam"),"cancelling carried seeker does not close the pod");
    f.designate(None,false,false);f.step(250,false);
    assert!(f.hub.rooms[&1].sim.guided_ordnance_views().iter().any(|m|m.shooter==f.unit.unit&&m.phase=="lost"),"beamLost source memory expires after the real designator closes");
}

#[test]
fn native_agm_point_review_minimum_range_and_finite_horizon_do_not_capture(){
    let mut f=Fixture::new("agm65b");let p=f.view().pos;let height=f.hub.rooms[&1].sim.height(p[0],p[2]);
    f.hub.rooms.get_mut(&1).unwrap().air.test_spawn_at(f.unit.unit,FlightSpawn{position:[p[0] as f32,(height+20.0) as f32,p[2] as f32],heading:0.0,airspeed:140.0,on_ground:false});
    let v=f.command(Some(crate::frontline_air::guided::normalize([0.0,-0.5,1.0])),true,f.seq+1);
    let out=f.send(v);assert!(out.iter().any(|(_,m)|matches!(m,Update::Error{message,..} if message=="point_below_minimum_range")),"minimum range uses actual host contact: {out:?}");
    f.hub.rooms.get_mut(&1).unwrap().air.test_spawn_at(f.unit.unit,FlightSpawn{position:[p[0] as f32,20000.0,p[2] as f32],heading:0.0,airspeed:140.0,on_ground:false});
    let v=f.command(Some([0.0,0.0,1.0]),true,f.seq+1);let out=f.send(v);
    assert!(out.iter().any(|(_,m)|matches!(m,Update::Error{message,..} if message=="point_no_surface_contact")),"a finite clear horizon is not a fabricated far target");
    assert_eq!(f.point(),None);
}
fn accepted(out:Vec<(u32,Update)>){assert!(!out.iter().any(|(_,v)|matches!(v,Update::Error{..})),"native command rejected: {out:?}");}

#[test]
fn native_agm_point_wire_accepts_only_sight_direction_and_rejects_contact_coordinates(){
    let value=json!({"op":"air_seeker_control","unit":{"battle":1,"unit":71,"life":1},"epoch":1,"seq":1,"enabled":true,"radar":false,"sight":[0.0,-0.2,0.9797958971132712]});
    assert!(serde_json::from_value::<Command>(value.clone()).is_ok(),"ground-point capture must be a real protocol intent");
    for key in ["point","pos","hit"]{let mut forged=value.clone();forged[key]=json!([0.0,0.0,1000.0]);assert!(serde_json::from_value::<Command>(forged).is_err(),"client {key} cannot authorize a point/hit");}
}

#[test]
fn native_agm_point_tv_iir_capture_is_fixed_and_actual_launch_spends_once(){
    for store in ["agm65b","agm65d","agm65g"]{
        let mut f=Fixture::new(store);let before=f.count(store);f.capture(Some(f.sight),true);
        assert!(!f.step(1,true).iter().any(|e|e.kind=="shot"&&e.shooter==Some(f.unit.unit)),"preparation cannot be bypassed");
        let initial=f.point().expect("actual host terrain/facility ray must publish its accepted point");
        f.step(180,false);let progress=f.view().seeker.progress_s;
        f.capture(Some(f.sight),true);assert_eq!(f.point(),Some(initial),"same sight must not recast from a moving aircraft");assert_eq!(f.view().seeker.progress_s,progress);
        f.capture(None,true);assert_eq!(f.point(),Some(initial),"rejoin/ECM/radar updates with no new sight preserve the point");
        f.step(160,false);assert_eq!(f.view().seeker.status,"track");assert!(f.view().seeker.target.is_none(),"a terrain point is not a UnitRef");
        let events=f.step(1,true);assert_eq!(events.iter().filter(|e|e.kind=="shot"&&e.shooter==Some(f.unit.unit)).count(),1,"{store}: actual native release");
        assert_eq!(f.count(store),before-1);assert!(!f.step(45,true).iter().any(|e|e.kind=="shot"&&e.shooter==Some(f.unit.unit)),"held duplicate input is not a second release");
        let mut impact=None;
        for _ in 0..3000{
            impact=f.step(1,false).into_iter().find(|e|e.shooter==Some(f.unit.unit)&&matches!(e.kind.as_str(),"terrain_impact"|"facility_impact"));
            if impact.is_some(){break;}
            if !f.hub.rooms[&1].sim.guided_ordnance_views().iter().any(|m|m.shooter==f.unit.unit){break;}
        }
        let impact=impact.expect("point missile must retain real finite terrain/facility collision");
        assert!(impact.target.is_none(),"point cannot invent a victim unit");assert!(impact.pos.iter().all(|v|v.is_finite()));
        assert!(crate::frontline_air::guided::length(crate::frontline_air::guided::sub(impact.pos,initial))<250.0,"{store}: actual finite impact must approach the accepted fixed point: {:?} / {:?}",impact.pos,initial);
    }
}

#[test]
fn native_agm_point_control_life_sequence_and_cancel_are_guarded(){
    let mut f=Fixture::new("agm65b");f.capture(Some(f.sight),true);assert!(f.point().is_some());
    let before=serde_json::to_value(f.view()).unwrap();
    for (player,life,epoch,seq) in [(3,f.unit.life,f.epoch,f.seq+1),(2,f.unit.life+1,f.epoch,f.seq+1),(2,f.unit.life,f.epoch+1,f.seq+1),(2,f.unit.life,f.epoch,f.seq)]{
        let mut v=f.command(Some(f.sight),true,seq);v["unit"]["life"]=json!(life);v["epoch"]=json!(epoch);
        let out=f.hub.handle(player,serde_json::from_value(v).unwrap(),0.0);assert!(out.iter().any(|(_,m)|matches!(m,Update::Error{..})));assert_eq!(serde_json::to_value(f.view()).unwrap(),before);
    }
    for sight in [[0.0;3],[0.0,0.0,2.0],[0.0,1.0,0.0],[0.0,0.0,-1.0]]{
        let v=f.command(Some(sight),true,f.seq+1);let out=f.send(v);assert!(out.iter().any(|(_,m)|matches!(m,Update::Error{..})),"invalid/horizon/gimbal sight must fail");assert_eq!(f.point(),None,"an explicit failed new capture cancels the carried lock");f.capture(Some(f.sight),true);
    }
    f.capture(None,false);assert_eq!(f.point(),None);assert!(f.view().seeker.target.is_none());
    f.capture(Some(f.sight),true);f.select("agm65g");assert_eq!(f.point(),None,"changing selected stores retires the point lock");
    f.select("agm65b");f.capture(Some(f.sight),true);
    f.hub.rooms.get_mut(&1).unwrap().air.release(2,0.0);assert_eq!(f.point(),None,"releasing the controlled life clears point support");
}
