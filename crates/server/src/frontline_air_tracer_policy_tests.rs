use super::*;
#[test]
fn air_tracer_policy_matches_mounted_source_cadence_and_cannon_opt_out(){
 let data=Path::new(env!("CARGO_MANIFEST_DIR")).join("../../data");let t=AirTemplate::load(&data).unwrap();
 let reference=UnitRef{battle:1,unit:2,life:3};
 for (id,cadence) in [("p51d",3),("f16v",5)] {
  let gun=&t.profiles[id].guns[0];let shell=&t.shells[&gun.belt[0]];
  for n in 1..=15 {let style=gun_tracer_style(gun,shell,n,false,reference);assert_eq!(style.is_some(),n%cadence==0,"{id} accepted shot {n}");}
 }
 let gun=t.profiles["me262"].guns[0].clone();let mut shell=t.shells[&gun.belt[0]].clone();
 assert!(t.shell_tracers[&shell.id],"unflagged delivered cannon defaults to visible");
 assert!(gun_tracer_style(&gun,&shell,1,false,reference).is_none(),"explicit shell false disables only presentation");
 for (kind,color,width) in [
  (tg_weapon::ProjectileKind::He,[1.0,0.62,0.22],1.2),
  (tg_weapon::ProjectileKind::Aphe,[1.0,0.4,0.14],1.0),
  (tg_weapon::ProjectileKind::Apcr,[1.0,0.85,0.6],0.7),
  (tg_weapon::ProjectileKind::Heat,[1.0,0.72,0.3],1.1),
  (tg_weapon::ProjectileKind::Smoke,[1.0,0.55,0.2],1.0),
 ] {shell.kind=kind;let style=gun_tracer_style(&gun,&shell,1,true,reference).unwrap();assert_eq!(style.style,"shell");assert_eq!(style.color,color);assert_eq!(style.width_scale,width);}
}
