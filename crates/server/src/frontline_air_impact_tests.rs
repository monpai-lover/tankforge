//! The actual admitted contact owns both the burst point and its local clock.
use super::*;
use crate::flight_runtime::FlightSpawn;
use std::sync::OnceLock;

#[test]
fn native_aircraft_contact_record_world_position_matches_accepted_pose() {
    let data=Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");
    let map:Value=serde_json::from_slice(&std::fs::read(data.join("frontline/korea.json")).unwrap()).unwrap();
    static TEMPLATE:OnceLock<Arc<AirTemplate>>=OnceLock::new();
    let template=TEMPLATE.get_or_init(||AirTemplate::load(&data).unwrap());
    let ground=SimWorld::load(&data,&map).unwrap();
    let mut air=template.world(Arc::new(ground.ground.clone()),map);
    air.spawn(UnitRef{battle:9,unit:71,life:1},"nf01",Team::Blue,Some(7),"air",0).unwrap();
    air.test_spawn_at(71,FlightSpawn{position:[120.0,2000.0,-430.0],heading:0.7,airspeed:0.0,on_ground:false});
    let unit=&air.units[&71];
    let pose=accepted_model_pose(&unit.profile.physics,&unit.state);
    let c=unit.damage.parts.iter().find(|p|p.def.id=="engine").unwrap().def.c;
    let lo=[c[0],c[1]+10.0,c[2]];let hi=[c[0],c[1]-10.0,c[2]];
    let a=pose.point(lo);let b=pose.point(hi);
    let shell=air.template.shells["hefi_20_sprgr"].clone();
    let report=air.hit(71,a,b,&shell,[0.0,-500.0,0.0],1,31,false).unwrap();
    assert_eq!(report["hit"]["fuze_status"],"contact_detonated");
    let burst=&report["hit"]["bursts"][0];
    let t=report["hit"]["t"].as_f64().unwrap();
    let expected=pose.point(std::array::from_fn(|k|lo[k]+(hi[k]-lo[k])*t));
    let world=vector(&burst["world_position"]).unwrap();
    for k in 0..3 {assert!((world[k]-expected[k]).abs()<1e-9,"Accepted burst drift on axis{k}: {report}");}
    assert_eq!(burst["time_origin"],"first_contact");
    assert_eq!(burst["time_s"],0.0);
    assert!((burst["explosive_kg"].as_f64().unwrap()-shell.explosive_mass_kg as f64).abs()<1e-12);
}
