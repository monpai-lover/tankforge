use super::*;
fn data()->std::path::PathBuf {Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data")}
fn world()->SimWorld {
    let map=json!({"terrain":{"width":3,"height":3,"cellX":1000.,"cellZ":1000.,"x0":-1000.,"z0":-1000.,"heights":vec![-20.;9]}});
    let mut world=SimWorld::load(&data(),&map).unwrap();
    let config=serde_json::from_value(json!({"vessels":[{"id":"target","team":0,"role":"transport","model":"generic_transport","pos":[0,0,0],"yaw":0,"route":[],"speed_mps":0,"ammo":0,"shell_id":"he_76_m42a1"}]})).unwrap();
    let mut next=20;world.install_naval(&config,&mut next).unwrap();world
}
#[test]
fn accepted_aircraft_projectile_hits_actual_naval_triangles_and_keeps_first_contact() {
    let mut world=world();let mut shell=tg_weapon::ProjectileDef::generic_ap(20.,820.);shell.mass_kg=0.1;
    world.launch_air_round(9000,1,shell,[-80.,1.,0.],[820.,0.,0.],None,"actual_aircraft_gun",1).unwrap();
    let events:Vec<_>=(0..30).flat_map(|_|world.step(FIXED_DT)).collect();
    let impacts:Vec<_>=events.iter().filter(|e|e.kind=="impact"&&e.target==Some(20)).collect();
    assert_eq!(impacts.len(),1,"one actual exterior projectile is consumed by one first triangle hit");
    assert_eq!(impacts[0].detail["contact_model"],"same_visible_float32_naval_triangles");
    assert!(impacts[0].detail["contact"]["geometry_hash"].as_str().is_some());
}
#[test]
fn real_naval_triangle_miss_does_not_mint_damage_or_contacts() {
    let mut world=world();let shell=tg_weapon::ProjectileDef::generic_ap(20.,820.);
    world.launch_air_round(9000,1,shell,[-80.,30.,0.],[820.,0.,0.],None,"actual_aircraft_gun",1).unwrap();
    let events:Vec<_>=(0..30).flat_map(|_|world.step(FIXED_DT)).collect();
    assert!(!events.iter().any(|e|e.target==Some(20)),"box vicinity cannot synthesize a naval contact");
}
#[test]
fn accepted_bomb_and_guided_agm_use_the_same_naval_triangle_contact_owner() {
    let source:Value=serde_json::from_slice(&std::fs::read(data().join("aircraft/frontline.json")).unwrap()).unwrap();
    for (id,bomb,guided) in [("he_agm45",true,false),("heat_305_agm65",false,true)] {
        let mut world=world();let shell:ProjectileDef=serde_json::from_value(source["shells"][id].clone()).unwrap();
        let target=world.guidance_targets().into_iter().find(|t|t.reference.unit==20).unwrap();
        assert!(!target.air&&target.alive,"registered vessel is an actual supported non-air guidance target");
        let missile=guided.then(||{
            let config=crate::frontline_air::guided::Config::from_store(&source["storeDefinitions"]["agm65b"]).unwrap();
            crate::frontline_air::guided::Missile::launch_optional(config,"agm65b".into(),UnitRef{battle:1,unit:9000,life:1},Some(target))
        });
        let air=AirOrdnance{store_id:if bomb{"test_bomb"}else{"agm65b"}.into(),cluster:None,ramjet:None,direction:[0.,-1.,0.],bomb,
            diameter:0.3,mass:shell.mass_kg as f64,dv:0.,burn:0.,sustain:None,guided:missile};
        world.launch_air_round(9000,1,shell,[3.,30.,0.],[0.,-200.,0.],Some(air),"accepted_air_store",1).unwrap();
        let events:Vec<_>=(0..60).flat_map(|_|world.step(FIXED_DT)).collect();
        assert!(events.iter().any(|e|e.kind=="impact"&&e.target==Some(20)&&e.detail["naval"]==true),"{id}: {events:?}");
    }
}
#[test]
fn facility_wall_contact_detonation_cannot_skip_its_exit_wall_toward_a_ship() {
    let mut world=world();
    let source=json!({"id":"blast_los_fixture","airfields":[{"id":"F","team":0,"enabled":true,"runway":{"center":[200,0],"forward":[0,1],"height":0,"lengthMeters":200,"widthMeters":20}}]});
    world.facilities=FacilityWorld::from_map(&source,|_,_|0.).unwrap();
    let catalog=world.facilities.geometry_catalog();
    let box_geometry=catalog.iter().find(|g|g.bounds[1][1]-g.bounds[0][1]>1.).unwrap();
    let [lo,hi]=box_geometry.bounds;let a=[lo[0],(lo[1]+hi[1])*0.5,(lo[2]+hi[2])*0.5];
    let behind=[hi[0]+5.,a[1],a[2]];let outside=[lo[0]-5.,a[1],a[2]];
    assert!(!world.blast_visible(9000,a,behind),"actual first wall at t=0 cannot authorize pressure through its back wall");
    assert!(world.blast_visible(9000,a,outside),"pressure moving away from the actual outer wall stays exposed");
}
