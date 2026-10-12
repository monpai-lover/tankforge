use std::{collections::HashMap,path::Path};
use tg_armor::MaterialDb;
use tg_vehicle::{load_materials,load_projectiles,load_vehicle,validate_vehicle};

#[test]
fn t72a_actual_folder_loads_fitted_mechanism_and_preserves_it_through_strict_export() {
    let root=Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let v=load_vehicle(&root.join("data/vehicles/su_t72a")).expect("real T-72A fitted mount must load");
    let w=serde_json::to_value(&v.weapons).unwrap();
    assert_eq!(w["mechanized_loading"]["mechanism"],"az_t72");
    assert_eq!(w["mechanized_loading"]["capacity"],22);
    let mut loading=tg_weapon::loading::Loading::for_mounts(&[v.weapons.main_gun.clone()],0,&[v.weapons.mechanized_loading.clone()]).unwrap();
    loading.fired(0);
    assert!(loading.tick_with_rate(100.0,|_,_|8.0,|_,_|0.0).is_empty());
    assert!(loading.tick(7.99,|_,_|8.0).is_empty());
    assert_eq!(loading.tick(0.01,|_,_|8.0),vec![0]);
    assert_eq!(loading.state[0],tg_weapon::loading::GunLoadState::Ready);
    assert_eq!(v.crew.len(),3);
    let shells:HashMap<_,_>=load_projectiles(&root.join("data/projectiles")).unwrap().into_iter().map(|(_,p)|(p.id.clone(),p)).collect();
    let db=MaterialDb::from_vec(load_materials(&root.join("data/materials.json")).unwrap());
    let report=validate_vehicle(&v,&db,&shells);
    assert_eq!(report.errors(),0,"{report}");
    assert!(!report.has("C004"),"a fitted autoloader must not require a human loader: {report}");
    let mut bad=v.clone(); bad.weapons.main_gun.id="d10t_100".into();
    assert!(validate_vehicle(&bad,&db,&shells).has("W014"));
    bad.weapons.mechanized_loading.as_mut().unwrap().gun_id="d10t_100".into();
    assert!(validate_vehicle(&bad,&db,&shells).has("W014"),"matching edited catalogue IDs cannot manufacture AZ compatibility");
    bad=v.clone(); bad.weapons.main_gun.ammo_count=vec![22,22,0];
    assert!(validate_vehicle(&bad,&db,&shells).has("W014"));
}

#[test]
fn t72a_matching_edited_ammo_lists_cannot_manufacture_typed_az_compatibility() {
    let root=Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let v=load_vehicle(&root.join("data/vehicles/su_t72a")).unwrap();
    let mut bad=v.clone();
    bad.weapons.main_gun.ammo=vec!["he_100_of412".into()];
    bad.weapons.main_gun.ammo_count=vec![22];
    bad.weapons.mechanized_loading.as_mut().unwrap().ammo=bad.weapons.main_gun.ammo.clone();
    assert!(!bad.weapons.mechanized_loading.as_ref().unwrap().valid_for(&bad.weapons.main_gun),
        "matching editable recipe and gun lists must not fit a foreign cartridge");
    assert!(tg_weapon::loading::Loading::for_mounts(&[bad.weapons.main_gun.clone()],0,&[bad.weapons.mechanized_loading.clone()]).is_err());
    let shells:HashMap<_,_>=load_projectiles(&root.join("data/projectiles")).unwrap().into_iter().map(|(_,p)|(p.id.clone(),p)).collect();
    let db=MaterialDb::from_vec(load_materials(&root.join("data/materials.json")).unwrap());
    let report=validate_vehicle(&bad,&db,&shells);
    assert!(report.has("W014"));
    assert!(report.has("W002"),"ordinary projectile-calibre validation remains independent");
    assert_eq!(shells["apfsds_125_3bm22"].caliber_mm,44.0);
    assert!(v.weapons.mechanized_loading.as_ref().unwrap().valid_for(&v.weapons.main_gun));
    assert!(!validate_vehicle(&v,&db,&shells).has("W002"),"subcalibre APFSDS remains valid");
    for ammo in ["apfsds_125_3bm22","heatfs_125_3bk14","he_125_3of26"] {
        let mut supported=v.clone();supported.weapons.main_gun.ammo=vec![ammo.into()];
        supported.weapons.main_gun.ammo_count=vec![22];
        supported.weapons.mechanized_loading.as_mut().unwrap().ammo=supported.weapons.main_gun.ammo.clone();
        assert!(supported.weapons.mechanized_loading.as_ref().unwrap().valid_for(&supported.weapons.main_gun));
        assert_eq!(validate_vehicle(&supported,&db,&shells).errors(),0);
    }
}
