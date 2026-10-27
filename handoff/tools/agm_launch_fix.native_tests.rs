// Include as a cfg(test) child module of frontline_air.rs. Exercises the real
// accepted store, seeker intent, world step, inventory and launch owners.
use super::*;

#[test]
fn native_agm_maverick_captured_ground_reference_cues_tv_iir_and_releases_once() {
    for store in ["agm65b", "agm65d", "agm65g"] {
        let data=Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
        let map:Value=serde_json::from_slice(&std::fs::read(data.join("frontline/korea.json")).unwrap()).unwrap();
        let mut ground=SimWorld::load(&data,&map).unwrap();ground.set_battle_id(1).unwrap();
        let slot=map["staging"].as_array().unwrap().iter().find(|s|s["enabled"]==true&&s["team"]==1)
            .and_then(|s|s["spawnSlots"].as_array()).and_then(|s|s.first()).unwrap();
        let target_pos=vector(&slot["pos"]).unwrap();
        ground.spawn_unit(72,"de_pz3_j",1,target_pos,0.0).unwrap();
        let target=ground.guidance_targets().into_iter().find(|t|t.reference.unit==72).unwrap();
        let template=AirTemplate::load(&data).unwrap();let mut air=template.world(Arc::new(ground.ground.clone()),map);
        let source=UnitRef{battle:1,unit:71,life:1};
        air.spawn_configured(source,"a10a",Team::Blue,Some(7),"air",0,
            Some(&BTreeMap::from([("p3".into(),store.into())]))).unwrap();
        air.test_spawn_at(71,FlightSpawn{position:[(target.pos[0]-500.0) as f32,(target.pos[1]+1000.0) as f32,(target.pos[2]-6000.0) as f32],
            heading:0.0,airspeed:140.0,on_ground:false});
        air.units.get_mut(&71).unwrap().controller=Some(7);
        air.set_weapon_control(71,Some(store.into()),None,"single".into(),"all".into()).unwrap();
        let before=air.units[&71].stores[0].count;
        air.accept_input(71,AirInput{aim:[0.0,0.0,1.0],throttle:0.7,manual_pitch:0.0,manual_roll:0.0,manual_yaw:0.0,
            flags:1,fire:false,release:true},air.time).unwrap();
        let denied=ground.step_combined(1.0/120.0,&mut air);
        assert!(!denied.iter().any(|e|e.kind=="shot"),"{store}: seeker-off release cannot create a missile");
        assert_eq!(air.units[&71].stores[0].count,before);
        air.set_guidance_control(71,true,false,Some(target.reference),false,false,[0.0;2],&ground).unwrap();
        for _ in 0..360 {
            air.accept_input(71,AirInput{aim:[0.0,0.0,1.0],throttle:0.7,manual_pitch:0.0,manual_roll:0.0,manual_yaw:0.0,
                flags:1,fire:false,release:false},air.time).unwrap();
            ground.step_combined(1.0/120.0,&mut air);
        }
        assert_eq!(air.units[&71].seeker.status,"track",
            "{store}: the captured valid ground UnitRef must cue the TV/IIR seeker within its gimbal even when aircraft aim remains level: {:?}",air.units[&71].seeker);
        let accepted=air.units[&71].seeker.clone();
        let config=guided::Config::from_store(&air.units[&71].stores[0].def).unwrap();
        air.accept_input(71,AirInput{aim:[0.0,0.0,1.0],throttle:0.7,manual_pitch:0.0,manual_roll:0.0,manual_yaw:0.0,
            flags:1,fire:false,release:true},air.time).unwrap();
        let launched=ground.step_combined(1.0/120.0,&mut air);
        assert_eq!(launched.iter().filter(|e|e.kind=="shot"&&e.detail["store_id"]==store).count(),1);
        assert_eq!(air.units[&71].stores[0].count,before-1);
        assert_eq!(ground.guided_ordnance_views().iter().filter(|m|m.store_id==store).count(),1);
        let stale_rejected=air.set_guidance_control(71,true,false,Some(UnitRef{life:target.reference.life+1,..target.reference}),false,false,[0.0;2],&ground).is_err();
        assert!(stale_rejected,
            "A stale captured target still cannot authorize guidance");
        println!("{}",json!({"schema":"AgmNativeCapturedGroundLaunchProofV1","store":store,"aircraft":"a10a","slot":"p3",
            "nativeConfig":{"mode":format!("{:?}",config.mode),"fovRad":config.fov,"gimbalRad":config.gimbal,"range":config.range,"minRange":config.min_range,"prepSeconds":config.prep,"captureSeconds":config.capture},
            "aircraftAim":[0.0,0.0,1.0],"acceptedSeeker":accepted,"target":target.reference,
            "seekerOffDenied":!denied.iter().any(|e|e.kind=="shot"),"staleLifeRejected":stale_rejected,
            "nativeShotEvents":launched.iter().filter(|e|e.kind=="shot"&&e.detail["store_id"]==store).count(),
            "inventoryBefore":before,"inventoryAfter":air.units[&71].stores[0].count,"acceptedMissiles":ground.guided_ordnance_views()}));
    }
}
