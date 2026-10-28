//! Real installed scene, room lifecycle, native projectile and audience paths.
use super::*;
fn data()->std::path::PathBuf{Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")}
fn accepted(out:&[(u32,Update)]){assert!(!out.iter().any(|(_,m)|matches!(m,Update::Error{..})),"{out:?}");}
fn waiting()->(FrontlineHub,u32){
    let mut h=FrontlineHub::new(&data()).unwrap();
    accepted(&h.handle(1,Command::Create{name:"Actual naval escort".into(),map:"taiwan-escort".into(),observer:true,era:1995},0.));
    let id=h.membership[&1];(h,id)
}
fn hub()->(FrontlineHub,u32){let(mut h,id)=waiting();accepted(&h.handle(1,Command::Start,0.));(h,id)}
#[test]
fn installed_escort_scene_owns_unique_lives_geometry_and_skips_old_land_ai() {
    let (mut h,id)=hub();let room=&h.rooms[&id];
    assert!(room.scenario.is_some());assert!(room.units.is_empty());assert!(room.companies.is_empty());
    let ships=room.sim.naval_views();assert_eq!(ships.len(),14);
    let ids:BTreeSet<_>=ships.iter().map(|s|s.unit).collect();assert_eq!(ids.len(),14);assert!(ids.iter().all(|s|s.battle==room.battle&&s.life==1));
    let snapshot=serde_json::to_value(room.snapshot()).unwrap();assert_eq!(snapshot["naval_geometry_catalog"].as_array().unwrap().len(),6);
    h.rooms.get_mut(&id).unwrap().team_score=[9999,0];
    let output=h.tick(0.05);assert!(!output.iter().any(|(_,u)|matches!(u,Update::Ended{..})),"legacy score cannot finish convoy mission");
    assert!(h.rooms[&id].started);
}
#[test]
fn actual_room_navals_fire_real_accepted_projectiles_and_audience_views_hide_resources() {
    let (mut h,id)=hub();let before:u32=h.rooms[&id].sim.naval_views().iter().map(|s|s.ammo).sum();
    let mut fired=false;
    // Geography expands, while vessel speed and the 1800m gun range remain
    // metric. Allow the authored fleets to approach before expecting fire.
    for tick in 1..=20000 {
        let output=h.tick(tick as f64*0.05);
        fired|=output.iter().any(|(_,u)|match u{Update::Frame{events,..}=>events.iter().any(|e|e["kind"]=="shot"&&e["detail"]["naval"]==true),_=>false});
        if fired {println!("actual 1:10 naval AI first accepted fire at {}s",tick as f64*0.05);break;}
    }
    assert!(fired,"accepted AI fire must enter the shared physical round queue");
    let room=&h.rooms[&id];let after:u32=room.sim.naval_views().iter().map(|s|s.ammo).sum();assert!(after<before);
    let side=room.vessel_views_for(Some(Team::Blue));
    assert!(side.iter().any(|s|s["team"]==1),"at least one actual detected enemy exercises resource redaction");
    for s in side {if s["team"]==0 {assert!(s.get("ammo").is_some());}else{assert!(s.get("ammo").is_none());assert!(s.get("health").is_none());}}
}
#[test]
fn escort_timeout_uses_only_scenario_result_and_is_published_once() {
    let (mut h,id)=hub();h.rooms.get_mut(&id).unwrap().scenario.as_mut().unwrap().config.timeout_seconds=0.1;
    let mut ended=0;let mut reason=String::new();
    for tick in 1..=4 {for (_,u) in h.tick(tick as f64*0.05){if let Update::Ended{winner,reason:r,..}=u {assert_eq!(winner,Some(Team::Red));ended+=1;reason=r;}}}
    assert_eq!(ended,1);assert_eq!(reason,"landing_timeout");assert!(h.rooms[&id].finished);
}
#[test]
fn native_room_accepts_fifteen_seconds_of_live_transport_unloading_as_blue_victory() {
    let(mut h,id)=waiting();
    let scenario=h.rooms.get_mut(&id).unwrap().scenario.as_mut().unwrap();
    let landing=scenario.config.landing_zone.center;
    for s in &mut scenario.config.naval.vessels {s.ammo=0;if s.role=="transport" {s.pos=[landing[0],0.,landing[1]];s.route.clear();}}
    accepted(&h.handle(1,Command::Start,0.));
    let mut ended=Vec::new();for tick in 1..=301 {ended.extend(h.tick(tick as f64*0.05).into_iter().filter_map(|(_,u)|if let Update::Ended{winner,reason,..}=u{Some((winner,reason))}else{None}));}
    assert_eq!(ended,vec![(Some(Team::Blue),"landing_completed".into())]);
    assert_eq!(h.rooms[&id].scenario_status().unwrap()["unloading_s"],15.);
}
#[test]
fn native_projectiles_must_sink_both_transports_and_escorts_to_end_the_fleet_mission() {
    let(mut h,id)=waiting();for s in &mut h.rooms.get_mut(&id).unwrap().scenario.as_mut().unwrap().config.naval.vessels{s.ammo=0;}
    accepted(&h.handle(1,Command::Start,0.));
    let mut tick=0;
    for role in ["transport","escort"] {
        let ships=h.rooms[&id].sim.naval_views();
        for s in ships.iter().filter(|s|s.team==0&&s.role==role) {
            // Synthetic kinetic fixture, not a claimed historical weapon. It
            // enters the real round queue and hits one accepted visible wall.
            let mut shell=tg_weapon::ProjectileDef::generic_ap(200.,2000.);shell.mass_kg=1000.;
            let p=[s.pos[0]-s.yaw.sin()*10.,s.pos[1]+30.,s.pos[2]-s.yaw.cos()*10.];
            h.rooms.get_mut(&id).unwrap().sim.launch_air_round(9000,1,shell,p,[0.,-2000.,0.],None,"native_kinetic_test",1).unwrap();
        }
        for _ in 0..4 {tick+=1;h.tick(tick as f64*0.05);}
        if role=="transport" {assert!(h.rooms[&id].started,"surviving escorts keep the fleet mission running");}
    }
    let result=h.rooms[&id].result.as_ref().expect("all attacker vessels were physically sunk");
    assert_eq!(result.winner,Some(Team::Red));assert_eq!(result.reason,"attacker_fleet_annihilated");
}
#[test]
fn scenario_actual_air_sorties_use_authored_position_heading_and_speed_for_both_factions() {
    let(mut h,id)=hub();let map:Value=serde_json::from_str(h.map_source("taiwan-escort").unwrap()).unwrap();
    assert!((map["coordinateFrame"]["worldScale"].as_f64().unwrap()-1.0/10.0).abs()<1e-15);
    for (player,team) in [(2,Team::Blue),(3,Team::Red)] {
        accepted(&h.handle(player,Command::Join{room:id,observer:false,team:Some(team)},0.));
        accepted(&h.handle(player,Command::DeployAir{ custom_counts: None,aircraft:"f86f".into(),spawn:"air".into(),loadout:0,custom:None,fuel_minutes:None},0.));
        let view=h.rooms[&id].air.views().into_iter().find(|v|v.owner==Some(player)).unwrap();
        let source=map["airspawns"].as_array().unwrap().iter().find(|s|s["team"]==team.index()).unwrap();
        let expected=if team==Team::Blue {[-17500.,650.,-13000.]}else{[7000.+2000./3.,650.,5000.-4000./3.]};
        assert_eq!(point(&source["pos"]).unwrap(),expected,"world airport expands to 1:10; local airborne offsets/650m altitude stay metric");
        let pos=point(&source["pos"]).unwrap();for k in 0..3 {assert!((view.pos[k]-pos[k]).abs()<0.001,"faction {team:?} axis{k}: {:?} vs {pos:?}",view.pos);}
        assert!((view.yaw-source["yawRad"].as_f64().unwrap()).abs()<1e-5);
        let speed=view.state[7..10].iter().map(|v|f64::from(*v).powi(2)).sum::<f64>().sqrt();
        assert!((speed-source["speed"].as_f64().unwrap()).abs()<0.001);
    }
}
#[test]
fn scenario_actual_runway_sorties_use_same_native_five_metre_game_airport_surface() {
    let(mut h,id)=hub();let map:Value=serde_json::from_str(h.map_source("taiwan-escort").unwrap()).unwrap();
    for (player,team) in [(2,Team::Blue),(3,Team::Red)] {
        accepted(&h.handle(player,Command::Join{room:id,observer:false,team:Some(team)},0.));
        accepted(&h.handle(player,Command::DeployAir{ custom_counts: None,aircraft:"f86f".into(),spawn:"runway".into(),loadout:0,custom:None,fuel_minutes:None},0.));
        let room=&h.rooms[&id];let view=room.air.views().into_iter().find(|v|v.owner==Some(player)).unwrap();
        let field=map["airfields"].as_array().unwrap().iter().find(|f|f["enabled"]==true&&f["team"]==team.index()).unwrap();
        let height=field["runway"]["height"].as_f64().unwrap();assert_eq!(height,5.);
        assert_eq!(field["runway"]["lengthMeters"],1600);assert_eq!(field["runway"]["widthMeters"],45);
        let center=[field["runway"]["center"][0].as_f64().unwrap(),field["runway"]["center"][1].as_f64().unwrap()];
        for dx in [-22.,0.,22.] {for dz in [-799.,0.,799.] {
            assert!((room.sim.height(center[0]+dx,center[1]+dz)-height).abs()<0.001,"native 1600x45m runway must share one 5m surface at every sampled edge and center");
        }}
        assert!((room.sim.height(view.pos[0],view.pos[2])-height).abs()<0.001);
        assert!((view.pos[1]-(height+2.)).abs()<0.001,"accepted runway CG at authored surface+2m");
        // The unchanged flight kernel's parked spawn uses 0.1m/s forward
        // (flight_core.c:spawn), independent of the airborne source speed.
        let parked_speed=view.state[7..10].iter().map(|v|f64::from(*v).powi(2)).sum::<f64>().sqrt();
        assert!((parked_speed-0.1).abs()<0.001);
    }
}
